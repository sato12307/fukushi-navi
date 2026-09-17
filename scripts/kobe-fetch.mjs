// ─────────────────────────────────────────────────────────────────────────────
// kobe-fetch.mjs — 神戸市営住宅の定時募集「当選・補欠抽選番号一覧」PDFを回ごとに集める。
//
//   node scripts/kobe-fetch.mjs            # 未取得の回だけ落とす
//   node scripts/kobe-fetch.mjs --list     # 見つけた回を並べるだけ
//
// ★どこから取るか
//   神戸市の公式サイトではなく、指定管理者（神戸市住宅供給公社）のお知らせにある。
//   「市営住宅の募集」の一覧ページに、過去の回の記事へのリンクがそのまま残っている。
//   ∴ 川崎・静岡・横浜と同じく**後追いで一気に作れる側**の市。
//
// ★この市だけの特徴（2026-09-17 実地）
//   資料の粒度が艦隊でいちばん細かい。**住戸単位**（住宅名・棟・部屋番号）で
//   申込者数が出る。1行＝1戸なので、倍率＝申込者数。∴ 割り算をしない唯一の市。
//   申込者ゼロの住戸もそのまま行として載る（申込者数の欄が空）。
//
// ★回キーは「募集した年月」。記事の題が「令和8年8月　神戸市営住宅　定時募集」。
//   年度ではなく**そのままの年月**なので、静岡のような年度→西暦の付け替えは要らない。
//   令和N年M月 → 西暦 = N + 2018。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'kobe')
const BASE = 'https://www.kobe-rma.or.jp'
const INDEX = `${BASE}/individual/municipal/recruitment/`
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

// 「令和8年8月　神戸市営住宅　定時募集　抽選結果発表」→ 2026-08
// ★「未申込住戸再募集」の記事は別物（抽選結果ではない）。題に抽選結果があるものだけ拾う。
const TITLE = /令和(元|[0-9]+)年\s*([0-9]+)月[\s\S]{0,40}?抽選結果/
const roundKey = (title) => {
  const m = TITLE.exec(title)
  if (!m) return null
  const y = (m[1] === '元' ? 1 : Number(m[1])) + 2018
  return `${y}-${String(Number(m[2])).padStart(2, '0')}`
}

const listRounds = async () => {
  const html = await get(INDEX)
  const out = new Map()
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\/information\/\d+\/?)"[^>]*>([\s\S]{0,300}?)<\/a>/g)) {
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const key = roundKey(title)
    if (!key) continue
    if (!out.has(key)) out.set(key, { round: key, title, page: new URL(m[1], INDEX).href })
  }
  return [...out.values()].sort((a, b) => a.round.localeCompare(b.round))
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
      // 記事に載るPDFは基本1本（抽選番号一覧）。複数あれば大きいほうが一覧。
      const links = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => new URL(m[1], r.page).href)
      const uniq = [...new Set(links)]
      if (!uniq.length) { failed.push(`${r.round}: PDFが見つからない ${r.page}`); continue }
      let best = null
      for (const u of uniq) {
        await sleep(1000)
        let buf
        try { buf = await get(u, true) } catch (e) { failed.push(`${r.round}: ${e.message}`); continue }
        // 中身がPDFであることを確かめてから保存する（エラーページのHTMLを .pdf で保存しない）
        if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') continue
        if (!best || buf.length > best.buf.length) best = { url: u, buf }
      }
      if (!best) { failed.push(`${r.round}: PDFとして読めるものが無い ${r.page}`); continue }
      fs.writeFileSync(out, best.buf)
      manifest.push({ ...r, pdf: best.url, file: path.relative(ROOT, out), bytes: best.buf.length })
      got++
      console.log(`取得 ${r.round}  ${(best.buf.length / 1024).toFixed(0)}KB`)
    } catch (e) {
      failed.push(`${r.round}: ${String(e.message || e)}`)
    }
  }
  manifest.sort((a, b) => a.round.localeCompare(b.round))
  fs.writeFileSync(path.join(CACHE, '_manifest.json'),
    JSON.stringify({ source: INDEX, fetchedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), rounds: manifest }, null, 2) + '\n')
  console.log(`\n見つけた ${rounds.length}回 ／ 新規取得 ${got} ／ すでにある ${skipped} ／ 手元に ${manifest.length}回`)
  if (manifest.length) console.log(`  範囲 ${manifest[0].round} 〜 ${manifest[manifest.length - 1].round}`)
  if (failed.length) {
    console.error(`\n★取れなかった回 ${failed.length}：`)
    failed.forEach((f) => console.error('  ' + f))
    process.exitCode = 1
  }
}
