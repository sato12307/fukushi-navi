// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-cities.mjs — 大都市レーン。例規を持たない自治体の基準をWebページから取る。
//
// ★なぜ別レーンなのか
//   全国1,741自治体の例規を集めたアーカイブで数えると、障害者控除対象者認定の例規を
//   制定しているのは町306・市234・村58に対し、**政令指定都市はわずか3・特別区は6**。
//   大都市は例規を作らず、ふつうのWebページに基準を書いている（実測で確認）。
//   ところが読者が多いのは大都市側なので、ここを落とすと使ってもらえない。
//
// ★URLは1件ずつ検索して確認したものを cities.json に持つ
//   自治体サイトのURLには規則性が無く、機械的に当てられない。
//   増やすときは cities.json に1行足すだけで、この収集器はそのまま動く。
//
// ★読み取りは共有ライブラリに任せる
//   表なら tablesFromHtml → criteriaFromRows、文章なら criteriaFromText。
//   入口は2つでも、ランクの読み方と不変条件は例規レーンとまったく同じものを使う。
//   [[same-question-two-implementations]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tablesFromHtml, criteriaFromRows, criteriaFromText, headIndex, flipped, hasAny, clean } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo-cities')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const UA = 'Mozilla/5.0 (compatible; fukushiru-bot/1.0; +https://fukushiru.com/about.html)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(CACHE, { recursive: true })

const seed = JSON.parse(fs.readFileSync(path.join(OUT, 'cities.json'), 'utf8'))
console.log(`大都市レーン: ${seed.cities.length}自治体`)

const decode = (buf) => {
  const head = buf.subarray(0, 2048).toString('latin1')
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head)
  const enc = (m ? m[1] : 'utf-8').toLowerCase()
  const label = /shift.?jis|windows-31j|ms932|sjis/.test(enc) ? 'shift_jis' : /euc/.test(enc) ? 'euc-jp' : 'utf-8'
  return new TextDecoder(label, { fatal: false }).decode(buf)
}
const toText = (html) => clean(html
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|div|li|tr|h[1-6]|td|th)>/gi, ' ')
  .replace(/<[^>]+>/g, ''))

const recs = []
const tally = {}
let got = 0, hit = 0, ng = 0
for (const c of seed.cities) {
  const p = path.join(CACHE, `${c.code}.html`)
  let html = null
  if (fs.existsSync(p)) { html = fs.readFileSync(p, 'utf8'); hit++ }
  else {
    try {
      const r = await fetch(c.url, { headers: { 'user-agent': UA }, redirect: 'follow' })
      if (r.ok) { html = decode(Buffer.from(await r.arrayBuffer())); fs.writeFileSync(p, html); got++ } else ng++
    } catch { ng++ }
    await sleep(1100)
  }
  if (!html) { recs.push({ ...c, status: '取得できない' }); continue }

  // ★表と地の文の両方を試して、**多く埋まったほうを採る**。
  //   表で1つだけ当たった時点で打ち切ると、地の文にある本命を見落とす。
  //   実際に大田区がそれで、表から「障害者:寝A1」だけ拾って、文章にある
  //   「特別障害者＝ランクB又はC／ローマ数字の3から5」を丸ごと落としていた。
  const score = (r) => ['shogai', 'tokubetsu'].reduce((a, k) => a + Object.keys(r[k] || {}).length, 0)
  let res = { shogai: {}, tokubetsu: {} }, how = null
  for (const tb of tablesFromHtml(html)) {
    const hi = headIndex(tb)
    if (hi < 0 && !/特別障害者/.test(tb.flat().join(' '))) continue
    const r = criteriaFromRows(tb, hi)
    if (score(r) > score(res)) { res = r; how = '表' }
  }
  const rt = criteriaFromText(toText(html))
  if (score(rt) > score(res)) { res = rt; how = '文章' }

  // ★「読めない」と「そもそも公表していない」を分けて数える。
  //   横浜市・名古屋市は「身体障害者3〜6級に準ずる方」までしか書いておらず、
  //   実際の判定ランク（自立度・要介護度）を公表していない。これは抽出の失敗ではなく
  //   **その自治体が基準を出していないという事実**なので、そう記録して読者にもそう伝える。
  const mentions = /日常生活自立度|寝たきり度|認知症高齢者|要介護[1-5]/.test(toText(html))
  let status = how ? `読めた(${how})` : (mentions ? '基準が読み取れない' : '判定ランクを公表していない')
  const bad = how ? flipped(res) : []
  if (bad.length) status = '要確認(順序が逆転)'
  tally[status] = (tally[status] || 0) + 1
  recs.push({
    ...c, status,
    shogai: hasAny(res.shogai) ? res.shogai : null,
    tokubetsu: hasAny(res.tokubetsu) ? res.tokubetsu : null,
  })
}
console.log(`取得: 新規 ${got} / キャッシュ ${hit} / 失敗 ${ng}`)

fs.writeFileSync(path.join(OUT, 'cities-records.json'), JSON.stringify({ parsedAt: new Date().toISOString(), tally, records: recs }, null, 1))
const f = (o) => o ? [o.kaigo, o.ninchi ? '認' + o.ninchi : null, o.netakiri ? '寝' + o.netakiri : null].filter(Boolean).join('/') || '—' : '—'
const L = [`大都市 ${recs.length}件`, '', '-- 内訳 --']
for (const [k, v] of Object.entries(tally)) L.push(`  ${k}: ${v}`)
L.push('', '-- 各市 --')
for (const r of recs) L.push(`  ${(r.pref + r.city).padEnd(14)}${(r.kind || '').padEnd(8)} 障害者:${f(r.shogai).padEnd(18)} 特別:${f(r.tokubetsu).padEnd(18)} ${r.status}`)
fs.writeFileSync(path.join(OUT, 'cities-report.txt'), L.join('\n'))
console.log('-> data/shogai-kojo/cities-records.json / cities-report.txt')
