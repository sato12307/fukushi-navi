// ─────────────────────────────────────────────────────────────────────────────
// sagamihara-fetch.mjs — 相模原市営住宅の「過去の応募状況」PDFを回ごとに集める。
//
//   node scripts/sagamihara-fetch.mjs            # 未取得の回だけ落とす
//   node scripts/sagamihara-fetch.mjs --list     # 見つけた回を並べるだけ
//
// ★どこから取るか
//   市の「市営住宅について」1ページに、過去の回の応募状況PDFがまとめて並んでいる。
//   消える側の市ではない（令和3年11月ぶんが今も生きている）。∴ 後追いで作れる。
//
// ★回キーは募集の年月。リンクの文字が「過去の応募状況（令和8年5月募集）」。
//   令和N年M月 → 西暦 = N + 2018。年度ではないので付け替えは要らない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'sagamihara')
const INDEX = 'https://www.city.sagamihara.kanagawa.jp/kurashi/1026489/sumai/1026509/1007952.html'
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

const roundKey = (text) => {
  const m = /令和(元|[0-9]+)年\s*([0-9]+)月/.exec(text)
  if (!m) return null
  const y = (m[1] === '元' ? 1 : Number(m[1])) + 2018
  return `${y}-${String(Number(m[2])).padStart(2, '0')}`
}

const html = await get(INDEX)
// ★<base href> があれば従う。無視すると相対リンクの解決先がずれる（京都で1度踏んだ）。
const baseTag = /<base[^>]+href="([^"]+)"/i.exec(html)
const base = baseTag ? new URL(baseTag[1], INDEX).href : INDEX

const rounds = new Map()
for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
  const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/応募状況/.test(text)) continue
  const key = roundKey(text)
  if (!key || rounds.has(key)) continue
  rounds.set(key, { round: key, title: text, pdf: new URL(m[1], base).href })
}
const list = [...rounds.values()].sort((a, b) => a.round.localeCompare(b.round))

if (ARGS.includes('--list')) {
  console.log(`見つけた回 ${list.length}：`)
  for (const r of list) console.log('  ' + r.round + '  ' + r.title.slice(0, 50))
} else {
  fs.mkdirSync(CACHE, { recursive: true })
  const manifest = []
  let got = 0, skipped = 0
  const failed = []
  for (const r of list) {
    const out = path.join(CACHE, `${r.round}.pdf`)
    if (fs.existsSync(out) && !ARGS.includes('--all')) {
      manifest.push({ ...r, file: path.relative(ROOT, out), bytes: fs.statSync(out).size, cached: true })
      skipped++
      continue
    }
    try {
      await sleep(1000)
      const buf = await get(r.pdf, true)
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        failed.push(`${r.round}: PDFではないものが返ってきた（${buf.length}バイト）`)
        continue
      }
      fs.writeFileSync(out, buf)
      manifest.push({ ...r, file: path.relative(ROOT, out), bytes: buf.length })
      got++
      console.log(`取得 ${r.round}  ${(buf.length / 1024).toFixed(0)}KB`)
    } catch (e) {
      failed.push(`${r.round}: ${String(e.message || e)}`)
    }
  }
  manifest.sort((a, b) => a.round.localeCompare(b.round))
  fs.writeFileSync(path.join(CACHE, '_manifest.json'),
    JSON.stringify({ source: INDEX, fetchedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), rounds: manifest }, null, 2) + '\n')
  console.log(`\n見つけた ${list.length}回 ／ 新規取得 ${got} ／ すでにある ${skipped} ／ 手元に ${manifest.length}回`)
  if (failed.length) {
    console.error(`\n★取れなかった回 ${failed.length}：`)
    failed.forEach((f) => console.error('  ' + f))
    process.exitCode = 1
  }
}
