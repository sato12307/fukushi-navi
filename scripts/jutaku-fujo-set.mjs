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

// --via <県名> <級地> <市名>=<URL...>
//   県が金額を公表していないとき、**県内の市のページ**から取る。
//   住宅扶助の額は「実施機関 × 級地（1/2/3の3段階）」で決まるので、
//   その市の級地が分かっていれば、県のその級地の欄に入れてよい。
//   市の級地は data/kyuchi.json（級地マスタ）で引く。
if (args[0] === '--via') {
  const [, pref, kyuchi, rest] = args
  const i = rest.indexOf('=')
  const city = rest.slice(0, i).trim()
  const urls = rest.slice(i + 1).trim().split(/\s+/).filter(Boolean)
  const t = byName.get(pref)
  if (!t) { console.error(`台帳に無い機関名: ${pref}`); process.exit(1) }
  const ky = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kyuchi.json'), 'utf8')).rows
  const got = ky[`${pref}|${city}`] || '3級地-2'   // 一覧に無い市町村はすべて3級地-2
  if (!got.startsWith(kyuchi)) {
    console.error(`${pref}${city} は ${got}。${kyuchi} の欄には入れられない。`)
    process.exit(1)
  }
  t.helpers = t.helpers || []
  for (const u of urls) if (!t.helpers.some((h) => h.url === u)) t.helpers.push({ kyuchi, city, url: u })
  fs.writeFileSync(P, JSON.stringify(L, null, 1) + String.fromCharCode(10))
  console.log(`${pref} の ${kyuchi} を ${city}（${got}）から取る候補を ${urls.length} 本足した`)
  process.exit(0)
}

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
