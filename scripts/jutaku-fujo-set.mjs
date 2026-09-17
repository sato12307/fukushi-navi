// jutaku-fujo-set.mjs — 台帳に候補URLを足す小道具。
//   node scripts/jutaku-fujo-set.mjs "秋田県=https://… https://…" "神戸市=https://…"
//   node scripts/jutaku-fujo-set.mjs --clear 秋田県        # 候補を空にする
// 名前は data/jutaku-fujo-targets.json の name と完全一致。合わないものは出して止まる。
//
// ★1本に絞らない。都道府県は「生活保護のしおり」PDFの中に限度額の表を入れていることが多く、
//   検索結果の1位が当たりとは限らない。候補を何本か入れておいて、
//   読めたものを parse 側が採る（picked に残る）。落とすのは安いが、探すのは高い。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = path.join(ROOT, 'data', 'jutaku-fujo-targets.json')
const L = JSON.parse(fs.readFileSync(P, 'utf8'))
const byName = new Map(L.targets.map((t) => [t.name, t]))
const args = process.argv.slice(2)

if (args[0] === '--clear') {
  for (const name of args.slice(1)) {
    const t = byName.get(name)
    if (!t) { console.error(`台帳に無い機関名: ${name}`); process.exit(1) }
    t.urls = []; t.picked = null; t.status = '未調査'; t.note = null
  }
} else {
  for (const a of args) {
    const i = a.indexOf('=')
    const name = a.slice(0, i).trim()
    const t = byName.get(name)
    if (!t) { console.error(`台帳に無い機関名: ${name}`); process.exit(1) }
    const urls = a.slice(i + 1).trim().split(/\s+/).filter(Boolean)
    for (const u of urls) if (!t.urls.includes(u)) t.urls.push(u)
  }
}
fs.writeFileSync(P, JSON.stringify(L, null, 1) + '\n')
const withUrl = L.targets.filter((t) => t.urls.length).length
const done = L.targets.filter((t) => t.status === 'A').length
console.log(`候補あり ${withUrl}/${L.targets.length} ／ 読めた ${done}`)
