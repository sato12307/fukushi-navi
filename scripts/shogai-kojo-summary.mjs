// shogai-kojo-summary.mjs — 例規レーンと大都市レーンを合わせた最終集計。
// 公開ページを作る前に、ここで分布と取りこぼしを目視できるようにしておく。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const reiki = JSON.parse(fs.readFileSync(path.join(OUT, 'records.json'), 'utf8')).records
const cities = JSON.parse(fs.readFileSync(path.join(OUT, 'cities-records.json'), 'utf8')).records
// ★1自治体に複数の例規が当たる（専用の要綱＋税条例など）。畳まないと分布が
//   自治体数ではなく例規数になり、数字が水増しされる。読めたものを優先して残す。
const score = (r) => (/読めた/.test(r.status) ? 100 : 0) +
  ['shogai', 'tokubetsu'].reduce((a, k) => a + Object.keys(r[k] || {}).length, 0)
const byCode = new Map()
for (const r of [...reiki, ...cities]) {
  const cur = byCode.get(r.code)
  if (!cur || score(r) > score(cur)) byCode.set(r.code, r)
}
const all = [...byCode.values()]
const dropped = reiki.length + cities.length - all.length
const ok = all.filter((r) => /読めた/.test(r.status))

const L = [`例規レーン ${reiki.length}件 ＋ 大都市レーン ${cities.length}件 → 自治体で畳んで ${all.length}自治体（重複 ${dropped}件を統合）`,
  `そのうち基準を読めた: ${ok.length}件（${Math.round(ok.length / all.length * 100)}%）`, '', '-- 状態の内訳 --']
const st = {}
for (const r of all) st[r.status] = (st[r.status] || 0) + 1
for (const [k, v] of Object.entries(st).sort((a, b) => b[1] - a[1])) L.push(`  ${String(k).padEnd(28)}${v}`)

const dist = (label, sel) => {
  const d = {}
  for (const r of ok) { const k = sel(r) || '(この物差しは使っていない)'; d[k] = (d[k] || 0) + 1 }
  L.push('', `-- ${label} --`)
  for (const [k, v] of Object.entries(d).sort((a, b) => b[1] - a[1])) L.push(`  ${String(k).padEnd(28)}${v}`)
}
dist('特別障害者（所得税40万円）になる 認知症度の下限', (r) => r.tokubetsu?.ninchi)
dist('特別障害者になる 寝たきり度の下限', (r) => r.tokubetsu?.netakiri)
dist('特別障害者になる 要介護度の下限', (r) => r.tokubetsu?.kaigo)
dist('障害者（所得税27万円）になる 認知症度の下限', (r) => r.shogai?.ninchi)
dist('障害者になる 寝たきり度の下限', (r) => r.shogai?.netakiri)
dist('障害者になる 要介護度の下限', (r) => r.shogai?.kaigo)

// ★同じ状態の人が、街によってどう変わるか。これが看板になる数字。
const at = (level, list, key) => {
  const idx = list.indexOf(level)
  const has = ok.filter((r) => r.tokubetsu?.[key] || r.shogai?.[key])
  const toku = has.filter((r) => r.tokubetsu?.[key] && list.indexOf(r.tokubetsu[key]) <= idx).length
  const sho = has.filter((r) => !(r.tokubetsu?.[key] && list.indexOf(r.tokubetsu[key]) <= idx)
    && r.shogai?.[key] && list.indexOf(r.shogai[key]) <= idx).length
  return { 母数: has.length, 特別障害者: toku, 障害者どまり: sho, 対象外: has.length - toku - sho }
}
const NINCHI = ['Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M']
const KAIGO = ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5']
L.push('', '-- ★同じ状態でも街で結論が変わる（この物差しを使っている自治体の中で）--')
for (const lv of ['Ⅱa', 'Ⅲa', 'Ⅳ']) L.push(`  認知症度が${lv}の人: ${JSON.stringify(at(lv, NINCHI, 'ninchi'), null, 0)}`)
for (const lv of ['要介護3', '要介護4']) L.push(`  ${lv}の人: ${JSON.stringify(at(lv, KAIGO, 'kaigo'), null, 0)}`)

fs.writeFileSync(path.join(OUT, 'summary.txt'), L.join('\n'))
console.log('-> data/shogai-kojo/summary.txt')
