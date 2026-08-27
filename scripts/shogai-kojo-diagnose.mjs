// shogai-kojo-diagnose.mjs — 読み取れなかった例規の理由を分ける診断用。
//
// ★なぜ要るか
//   「読めた件数」だけ見ていると、伸びしろがどこにあるか判らない。
//   本文にランク記号があるのに取れていない（＝パーサの問題）のか、
//   そもそもその自治体が書いていない（＝これ以上は伸びない）のかを分ける。
//   実測（2026-08-27）: 読めなかった168件のうち117件は本文にランク記号があった＝まだ伸ばせる。
//
// ★「日常生活自立度」の語があるだけでは足りない
//   ほとんどの要綱は厚労省通知の**名前として**引用しているだけで、実際のランクは別表にある。
//   語の有無で数えると「基準は書いてあるのに読めていない」を大幅に過大評価する。
//   ランク記号（ランクA／Ⅲ／B1 など）の実在で数えること。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clean } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo')
const BCACHE = path.join(ROOT, '.cache', 'shogai-kojo-bessi')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')

const src = JSON.parse(fs.readFileSync(path.join(OUT, 'sources.json'), 'utf8'))
const rec = JSON.parse(fs.readFileSync(path.join(OUT, 'records.json'), 'utf8'))
const cacheOf = new Map(src.rows.map((r) => [r.municipality_id + r.original_url, r._cache]))
const left = rec.records.filter((r) => !/読めた/.test(r.status))

const text = (p) => clean(fs.readFileSync(p, 'utf8').replace(/<[^>]+>/g, ' '))
const tally = { 'ランク記号がある(=読み取りに失敗)': 0, '自立度の語はあるが、ランクは別表にあって本文に無い': 0, '要介護度だけ書いてある': 0, 'ランクを一切書いていない': 0, '本文が取れていない': 0 }
const samples = { }
for (const r of left) {
  const p = path.join(CACHE, cacheOf.get(r.code + r.sourceUrl) || '')
  if (!fs.existsSync(p)) { tally['本文が取れていない']++; continue }
  let t = text(p)
  // 添付も足して判定する（別表が添付側にある例規があるため）
  for (const f of fs.readdirSync(BCACHE)) {
    if (!f.startsWith(r.code + '-')) continue
    const b = fs.readFileSync(path.join(BCACHE, f))
    if (b.subarray(0, 5).toString('latin1') === '{\\rtf') t += ' ' + b.toString('latin1').replace(/[^\x20-\x7e]/g, ' ')
  }
  // ★「日常生活自立度」の語があるだけでは足りない。ほとんどの要綱は厚労省通知の
  //   名前として引用しているだけで、実際のランクは別表にある。**ランク記号の実在**で数える。
  const hasRank = /ランク\s*[JABCⅠⅡⅢⅣM]|自立度[^。]{0,40}[ⅠⅡⅢⅣ]|[ABC][12][^0-9]/.test(t)
  const mentions = /日常生活自立度|寝たきり度/.test(t)
  const kaigo = /要介護\s*[1-5]/.test(t)
  const k = hasRank ? 'ランク記号がある(=読み取りに失敗)'
    : mentions ? '自立度の語はあるが、ランクは別表にあって本文に無い'
    : kaigo ? '要介護度だけ書いてある' : 'ランクを一切書いていない'
  tally[k]++
  ;(samples[k] ??= []).length < 3 && samples[k].push(`${r.pref}${r.city} ${r.sourceUrl}`)
}
const L = [`本文から基準を読めていない ${left.length}件の内訳`, '']
for (const [k, v] of Object.entries(tally)) L.push(`  ${k}: ${v}`)
L.push('', '-- 見本 --')
for (const [k, v] of Object.entries(samples)) { L.push(`== ${k}`); for (const s of v) L.push('   ' + s) }
fs.writeFileSync(path.join(OUT, 'diagnose.txt'), L.join('\n'))
console.log('-> data/shogai-kojo/diagnose.txt')
