// ─────────────────────────────────────────────────────────────────────────────
// yokohama-fetch.mjs — 横浜市営住宅の「応募状況表」PDFを回ごとに集めて .cache に貯める。
//
//   node scripts/yokohama-fetch.mjs            # 未取得の回だけ落とす
//   node scripts/yokohama-fetch.mjs --list     # 見つけた回を並べるだけ
//
// ★どこから取るか
//   横浜市の記者発表（建築局）。年ごとのディレクトリに残っている。
//     /city-info/koho-kocho/press/kenchiku/{年}/…shieijutaku….html
//   ファイル名に規則性が無い（0329shieijutaku-2 / 20210927shieijutaku / shieijutaku20240627）
//   ので、**年ディレクトリの索引から shieijutaku を含むリンクを拾う**。
//
// ★回は本文から読む。ファイル名の日付は「抽選会をやった日」で、募集の回ではない。
//   本文に「令和◯年◯月募集」と書いてあるので、そちらを回とする。
//   横浜の定期募集は年2回（4月・10月）。抽選はその約3か月後。
//
// ★記者発表には「募集を始めます」の回もある。応募状況表が付いているものだけ取る。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'yokohama')
const BASE = 'https://www.city.yokohama.lg.jp'
const DIR = '/city-info/koho-kocho/press/kenchiku'
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

// 本文の「令和8年4月募集」→ 2026-04
// ★本文を NFKC で正規化してから当てる。実測で 2022年12月の記者発表が
//   「令和４年10**⽉**募集」と書いており、この「⽉」は **康熙部首（U+2F49）** で
//   ふつうの「月」（U+6708）ではなかった。見た目は同じなので目では分からず、
//   正規化しないとこの回だけ静かに落ちる（実際に1回ぶん取りこぼしていた）。
//   NFKC は康熙部首も全角数字も一度に畳む。
const ROUND = /令和(元|[0-9]+)年([0-9]+)月募集/
const roundOf = (text) => {
  const m = ROUND.exec(text.normalize('NFKC').replace(/\s/g, ''))
  if (!m) return null
  const y = (m[1] === '元' ? 1 : Number(m[1])) + 2018
  return `${y}-${String(Number(m[2])).padStart(2, '0')}`
}

const listPages = async () => {
  const out = []
  for (const y of YEARS) {
    let html
    try { html = await get(`${BASE}${DIR}/${y}/`) } catch { continue }
    for (const m of html.matchAll(/href="([^"]*shieijutaku[^"]*\.html)"/g)) {
      out.push({ year: y, page: new URL(m[1], `${BASE}${DIR}/${y}/`).href })
    }
    await sleep(600)
  }
  // 同じページが2つの年から拾えることがある
  return [...new Map(out.map((x) => [x.page, x])).values()]
}

const pages = await listPages()
process.stderr.write(`記者発表 ${pages.length}本を見ます\n`)

const rounds = new Map()
const notResult = []
for (const p of pages) {
  await sleep(1000)
  let html
  try { html = await get(p.page) } catch (e) { notResult.push(`${p.page}: ${e.message}`); continue }
  const text = html.replace(/<[^>]+>/g, ' ')
  // 抽選結果の回だけ。「募集します」の回には応募状況表が付かない。
  if (!/抽選結果/.test(text.normalize('NFKC'))) { notResult.push(`${p.page}（抽選結果ではない）`); continue }
  const round = roundOf(text)
  if (!round) { notResult.push(`${p.page}（本文に「令和◯年◯月募集」が無い）`); continue }
  const pdfs = [...html.matchAll(/href="([^"]+\.pdf)"/g)].map((m) => new URL(m[1], p.page).href)
  if (!pdfs.length) { notResult.push(`${p.page}（PDFが無い）`); continue }
  if (!rounds.has(round)) rounds.set(round, { round, page: p.page, pdfs })
}

const list = [...rounds.values()].sort((a, b) => a.round.localeCompare(b.round))
if (ARGS.includes('--list')) {
  console.log(`抽選結果の回 ${list.length}：`)
  for (const r of list) console.log(`  ${r.round}  PDF${r.pdfs.length}本  ${r.page}`)
  if (notResult.length) console.log(`\n抽選結果ではなかった/取れなかった ${notResult.length}本`)
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
    // ★応募状況表がどのPDFかは名前から決められない（0002_ / 0004_ / 日付だけ など）。
    //   ∴ 落としてみて「応募状況表」という語が中にあるものを採る。
    let saved = false
    for (const u of r.pdfs) {
      await sleep(1000)
      let buf
      try { buf = await get(u, true) } catch { continue }
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') continue
      fs.writeFileSync(out, buf)
      manifest.push({ ...r, pdf: u, file: path.relative(ROOT, out), bytes: buf.length })
      saved = true
      got++
      console.log(`取得 ${r.round}  ${(buf.length / 1024).toFixed(0)}KB`)
      break
    }
    if (!saved) failed.push(`${r.round}: PDFを落とせなかった ${r.page}`)
  }
  manifest.sort((a, b) => a.round.localeCompare(b.round))
  fs.writeFileSync(path.join(CACHE, '_manifest.json'),
    JSON.stringify({ source: `${BASE}${DIR}/`, fetchedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), rounds: manifest, notResult }, null, 2) + '\n')
  console.log(`\n抽選結果の回 ${list.length} ／ 新規取得 ${got} ／ すでにある ${skipped} ／ 手元に ${manifest.length}回`)
  if (manifest.length) console.log(`  範囲 ${manifest[0].round} 〜 ${manifest[manifest.length - 1].round}`)
  if (failed.length) { console.error(`\n★取れなかった回 ${failed.length}：`); failed.forEach((f) => console.error('  ' + f)); process.exitCode = 1 }
}
