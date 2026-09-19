// ─────────────────────────────────────────────────────────────────────────────
// konkyu-fetch.mjs — 生活困窮者自立支援制度の「自治体別集計表」を年度ぶん集める。
//
//   node scripts/konkyu-fetch.mjs          # 未取得の年度だけ落とす
//   node scripts/konkyu-fetch.mjs --force  # 全部落とし直す
//   node scripts/konkyu-fetch.mjs --list   # 落とさずに、見つかった年度だけ出す
//
// ★何を取っているか
//   厚生労働省「生活困窮者自立支援制度支援状況調査」の
//     ・自治体別集計表（年度）… 都道府県・指定都市・中核市の129機関 × 18項目
//     ・集計結果（年度）      … 全国計。↑の検算に使う（parse 側の関所）
//   生活保護の第18表（hogo-shinsei）と**同じ129機関の区切り**なので、名前で突き合わせできる。
//
// ★ここでつまずく点
//   ①一覧ページには「自治体別集計表（27年4月分）」のような**月次版が大量に混ざる**。
//     年度版だけを採る。「◯年度」で終わるものだけ。月次を拾うと年度が12重に化ける。
//   ②年度の表記が3種類ある：平成27年度 / 令和元年度 / 令和２年度（全角数字）。
//     全角を半角に直してから読む。「元」は1。
//   ③平成27・28年度だけ列数が違う（24列・26列）。ここでは落とすだけで、
//     採否は parse 側が列数で判定する。**取得側で年度を選り好みしない**
//     （あとで列が揃った年度が増えたとき、取り直しを忘れる）。
//   ④PDFは先頭が %PDF-。HTMLのエラーページを掴んでいないか毎回見る。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'konkyu')
const INDEX = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000092189.html'
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const FORCE = ARGS.includes('--force')
const LIST = ARGS.includes('--list')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 全角数字→半角。「元」は1年。
const z2h = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
// 和暦の年度表記 → 西暦の年度（4月始まりの開始年）
const toYear = (label) => {
  const s = z2h(label).replace(/元年/, '1年')
  let m = s.match(/平成(\d+)年度/)
  if (m) return 1988 + Number(m[1])
  m = s.match(/令和(\d+)年度/)
  if (m) return 2018 + Number(m[1])
  return null
}

const isPdf = (buf) => buf.length > 4000 && buf.slice(0, 5).toString('latin1') === '%PDF-'

const discover = async () => {
  const html = await (await fetch(INDEX, { headers: { 'user-agent': UA } })).text()
  const found = { muni: {}, total: {}, jokyo: {} }
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]{0,140}?)<\/a>/g)) {
    const href = m[1]
    const label = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, '')
    // 「◯年度」が入るものだけ＝年度版。「28年3月分」のような月次版は捨てる。
    const yl = label.match(/（([^（）]*?年度)）/) || label.match(/^((?:令和|平成)[０-９\d元]+年度)の支援状況/)
    if (!yl) continue
    const y = toYear(yl[1])
    if (!y) continue
    const url = href.startsWith('http') ? href : `https://www.mhlw.go.jp${href}`
    if (label.startsWith('自治体別集計表')) found.muni[y] = url
    else if (label.startsWith('集計結果')) found.total[y] = url
    // 「◯年度の支援状況」＝事業ごとの実施率（家計改善支援事業の実施自治体数・実施率）が載る資料。
    // ここを取っておかないと「実施率87%」を本文に手で書くことになり、翌年に古びる。
    else if (label.includes('年度の支援状況')) found.jokyo[y] = url
  }
  return found
}

const grab = async (url, dest) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (!isPdf(buf)) throw new Error(`PDFでない（${buf.length}バイト） ${url}`)
  fs.writeFileSync(dest, buf)
  return buf.length
}

const main = async () => {
  const found = await discover()
  const years = [...new Set([...Object.keys(found.muni), ...Object.keys(found.total)])]
    .map(Number).sort((a, b) => a - b)
  if (!years.length) throw new Error('一覧ページから年度版が1つも見つからない（ページの作りが変わった可能性）')
  console.log(`見つかった年度: ${years.join(', ')}（自治体別${Object.keys(found.muni).length}件 / 集計結果${Object.keys(found.total).length}件 / 支援状況${Object.keys(found.jokyo).length}件）`)
  if (LIST) {
    for (const y of years) console.log(`  ${y}年度  muni=${found.muni[y] || '—'}  total=${found.total[y] || '—'}  jokyo=${found.jokyo[y] || '—'}`)
    return
  }
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(path.join(CACHE, 'manifest.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), index: INDEX, ...found }, null, 2))

  const jobs = []
  for (const y of years) {
    if (found.muni[y]) jobs.push([`muni-${y}.pdf`, found.muni[y]])
    if (found.total[y]) jobs.push([`total-${y}.pdf`, found.total[y]])
    if (found.jokyo[y]) jobs.push([`jokyo-${y}.pdf`, found.jokyo[y]])
  }
  for (const [name, url] of jobs) {
    const dest = path.join(CACHE, name)
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 4000) { console.log(`skip  ${name}`); continue }
    const n = await grab(url, dest)
    console.log(`ok    ${name}  ${n}バイト`)
    await sleep(1000)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
