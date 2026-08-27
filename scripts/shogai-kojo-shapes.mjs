// 使い捨て：不変条件で弾かれた例規の、判定の根拠になった文を目で見る。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clean, romanize } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const src = JSON.parse(fs.readFileSync(path.join(OUT, 'sources.json'), 'utf8'))
const rec = JSON.parse(fs.readFileSync(path.join(OUT, 'records.json'), 'utf8'))
const cacheOf = new Map(src.rows.map((r) => [r.municipality_id + r.original_url, r._cache]))

const L = []
for (const r of rec.records.filter((x) => /逆転/.test(x.status))) {
  const p = path.join(CACHE, cacheOf.get(r.code + r.sourceUrl) || '')
  if (!fs.existsSync(p)) continue
  const t = romanize(clean(fs.readFileSync(p, 'utf8').replace(/<[^>]+>/g, ' ')))
  L.push(`\n${'='.repeat(70)}\n${r.pref}${r.city}  障害者:${JSON.stringify(r.shogai)}  特別:${JSON.stringify(r.tokubetsu)}`)
  // 区分の見出しがどこに何個あるか
  const marks = []
  for (const m of t.matchAll(/特別障害者(?:に準ずる|と同様|に該当)/g)) marks.push([m.index, '特別'])
  for (const m of t.matchAll(/(?<!特別)障害者(?:に準ずる|と同様|に該当)/g)) marks.push([m.index, '障害者'])
  for (const m of t.matchAll(/所得税法施行令第10条第([12])項/g)) marks.push([m.index, m[1] === '2' ? '特別(条番号)' : '障害者(条番号)'])
  marks.sort((a, b) => a[0] - b[0])
  L.push(`  見出し ${marks.length}個: ${marks.map((x) => x[1]).join(' → ')}`)
  for (let i = 0; i < Math.min(marks.length, 6); i++) {
    const end = i + 1 < marks.length ? marks[i + 1][0] : Math.min(t.length, marks[i][0] + 300)
    L.push(`   [${marks[i][1]}] ${t.slice(marks[i][0], end).slice(0, 220)}`)
  }
}
fs.writeFileSync(path.join(OUT, 'shapes.txt'), L.join('\n'))
console.log('-> data/shogai-kojo/shapes.txt')
