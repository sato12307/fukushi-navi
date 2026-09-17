// ─────────────────────────────────────────────────────────────────────────────
// shizuoka-fetch.mjs — 静岡市営住宅の「空家募集の倍率」PDFを回ごとに集めて .cache に貯める。
//
//   node scripts/shizuoka-fetch.mjs            # 未取得の回だけ落とす
//   node scripts/shizuoka-fetch.mjs --list     # 見つけた回を並べるだけ
//   node scripts/shizuoka-fetch.mjs --pages 40 # お知らせを何ページ目まで見るか（既定34）
//
// ★どこから取るか
//   静岡市の公式サイトではなく、指定管理者のサイト（s-jutaku.com）のお知らせに
//   回ごとの記事がある。「令和◯年度◯月空家募集の倍率及び公開抽選会について」。
//   お知らせは34ページぶん遡れる（2012年から）。
//
// ★年度と月から西暦を出す（ここを間違えると回が1年ずれる）
//   「令和7年度2月」は **2026年2月**。年度は4月始まりなので、
//   月が4以上ならその年度の西暦、3以下なら翌年になる。
//   令和N年度 → 西暦 = N + 2018（4〜12月） / N + 2019（1〜3月）。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shizuoka')
const BASE = 'https://s-jutaku.com'
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const PAGES = Number((ARGS.find((a) => a.startsWith('--pages')) || '').split(/[= ]/)[1]) ||
  Number(ARGS[ARGS.indexOf('--pages') + 1]) || 34
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

// 「令和7年度2月空家募集の倍率」→ 2026-02
const TITLE = /令和(元|[0-9]+)年度\s*([0-9]+)月[^「」]*?倍率/
const roundKey = (title) => {
  const m = TITLE.exec(title)
  if (!m) return null
  const nendo = (m[1] === '元' ? 1 : Number(m[1]))
  const mo = Number(m[2])
  const y = nendo + (mo >= 4 ? 2018 : 2019)
  return `${y}-${String(mo).padStart(2, '0')}`
}

const listRounds = async () => {
  const out = new Map()
  for (let p = 1; p <= PAGES; p++) {
    const url = p === 1 ? `${BASE}/news/` : `${BASE}/news/page/${p}/`
    let html
    try { html = await get(url) } catch { break }          // ページ送りの終わり
    let hit = 0
    for (const m of html.matchAll(/<a href="(https:\/\/s-jutaku\.com\/archives\/news\/\d+)"?[^>]*>([\s\S]{0,400}?)<\/a>/g)) {
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const key = roundKey(title)
      if (!key) continue
      hit++
      if (!out.has(key)) out.set(key, { round: key, title, page: m[1] })
    }
    process.stderr.write(`  お知らせ ${p}ページ目：倍率の記事 ${hit}本（累計 ${out.size}回）\r`)
    await sleep(600)
  }
  process.stderr.write('\n')
  return [...out.values()].sort((a, b) => a.round.localeCompare(b.round))
}

// 記事から倍率PDFを見つける。文言で選び、だめならファイル名に bairitsu を含むもの。
const findPdf = (html, pageUrl) => {
  const links = [...html.matchAll(/href="([^"]+\.pdf)"[^>]*>([^<]*)</g)]
    .map((m) => ({ url: new URL(m[1], pageUrl).href, text: m[2].replace(/\s+/g, '') }))
  const byText = links.find((l) => /倍率/.test(l.text))
  if (byText) return { ...byText, by: '文言' }
  const byName = links.find((l) => /bairitsu/i.test(l.url))
  if (byName) return { ...byName, by: 'ファイル名' }
  return links[0] ? { ...links[0], by: '最初のPDF' } : null
}

const rounds = await listRounds()
if (ARGS.includes('--list')) {
  console.log(`見つけた回 ${rounds.length}：`)
  for (const r of rounds) console.log('  ' + r.round + '  ' + r.title.slice(0, 50))
} else {
  fs.mkdirSync(CACHE, { recursive: true })
  const manifest = []
  let got = 0, skipped = 0
  const failed = []
  for (const r of rounds) {
    const out = path.join(CACHE, `${r.round}.pdf`)
    if (fs.existsSync(out) && !ARGS.includes('--all')) {
      manifest.push({ ...r, file: path.relative(ROOT, out), bytes: fs.statSync(out).size, cached: true })
      skipped++
      continue
    }
    try {
      await sleep(1000)
      const html = await get(r.page)
      const pdf = findPdf(html, r.page)
      if (!pdf) { failed.push(`${r.round}: 倍率のPDFが見つからない ${r.page}`); continue }
      await sleep(1000)
      const buf = await get(pdf.url, true)
      // 中身がPDFであることを確かめてから保存する（エラーページのHTMLを .pdf で保存しない）
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        failed.push(`${r.round}: PDFではないものが返ってきた（${buf.length}バイト） ${pdf.url}`)
        continue
      }
      fs.writeFileSync(out, buf)
      manifest.push({ ...r, pdf: pdf.url, foundBy: pdf.by, file: path.relative(ROOT, out), bytes: buf.length })
      got++
      console.log(`取得 ${r.round}  ${(buf.length / 1024).toFixed(0)}KB  (${pdf.by}で特定)`)
    } catch (e) {
      failed.push(`${r.round}: ${String(e.message || e)}`)
    }
  }
  manifest.sort((a, b) => a.round.localeCompare(b.round))
  fs.writeFileSync(path.join(CACHE, '_manifest.json'),
    JSON.stringify({ source: `${BASE}/news/`, fetchedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), rounds: manifest }, null, 2) + '\n')
  console.log(`\n見つけた ${rounds.length}回 ／ 新規取得 ${got} ／ すでにある ${skipped} ／ 手元に ${manifest.length}回`)
  if (manifest.length) console.log(`  範囲 ${manifest[0].round} 〜 ${manifest[manifest.length - 1].round}`)
  if (failed.length) {
    console.error(`\n★取れなかった回 ${failed.length}：`)
    failed.forEach((f) => console.error('  ' + f))
    process.exitCode = 1
  }
}
