// link-audit.mjs — トップから実際に辿り着けるかを確かめる。
//
// ★なぜ要るか
//   生成しただけ・sitemapに載せただけのページは、内部リンクが無いと
//   索引されにくいうえ、来た人が次に進めない。艦隊で何度も起きている
//   （[[crawled-but-unwired-data]] / 許可アーカイブの /data/ が孤児だった件）。
//   ここでは **トップページから何クリックで届くか**を実際に辿って数える。
//
// ★特商法表記と利用規約は「買う前に読める」ことが要件
//   販売ページからだけでなく、常時どこからでも届く場所（フッタ）に置く。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const norm = (p) => {
  let s = p.replace(/[?#].*$/, '')
  if (s.endsWith('/')) s += 'index.html'
  return s.replace(/^\/+/, '')
}
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))
const linksOf = (rel) => {
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const out = new Set()
  for (const m of t.matchAll(/href="([^"]+)"/g)) {
    const h = m[1]
    if (/^(https?:|mailto:|#|tel:)/.test(h)) continue
    const abs = h.startsWith('/') ? norm(h) : norm(path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), h))
    if (exists(abs)) out.add(abs)
  }
  return [...out]
}

// トップから幅優先で辿る
const start = 'index.html'
const depth = new Map([[start, 0]])
const queue = [start]
while (queue.length) {
  const cur = queue.shift()
  for (const nx of linksOf(cur)) {
    if (depth.has(nx)) continue
    depth.set(nx, depth.get(cur) + 1)
    queue.push(nx)
  }
}

// 見るべきページ
const must = [
  ['index.html', 'トップ'],
  ['shogai-kojo/index.html', '認定基準の比較表'],
  ['pack/index.html', '有料パックの販売ページ'],
  ['tokushoho/index.html', '特定商取引法に基づく表記'],
  ['kiyaku/index.html', '利用規約'],
  ['about.html', 'このサイトについて'],
  ['articles/shogaisha-kojo-tax.html', '障害者控除の記事'],
  ['shogai-kojo/131118.html', '自治体ページ（大田区）'],
]
const L = ['トップからの到達段数（内部リンクだけを辿った結果）', '']
for (const [p, label] of must) {
  const d = depth.get(p)
  L.push(`  ${String(label).padEnd(26)}${d === undefined ? '★到達できない（孤児）' : d + 'クリック'}`)
}

// 全ページのうち孤児になっているもの
const all = []
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'scripts', 'data', 'tools', 'assets'].includes(e.name)) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) walk(rel)
    else if (e.name.endsWith('.html')) all.push(rel)
  }
}
walk('')
const orphans = all.filter((p) => !depth.has(p))
L.push('', `全HTML ${all.length}枚 ／ トップから到達できないもの ${orphans.length}枚`)
for (const o of orphans.slice(0, 20)) L.push(`  ${o}`)
if (orphans.length > 20) L.push(`  …ほか ${orphans.length - 20}枚`)

// 被リンク数（どのページから何本リンクされているか）
const inbound = new Map()
for (const p of all) for (const nx of linksOf(p)) inbound.set(nx, (inbound.get(nx) || 0) + 1)
L.push('', '主要ページの被リンク数')
for (const [p, label] of must) L.push(`  ${String(label).padEnd(26)}${inbound.get(p) || 0}本`)

fs.writeFileSync(path.join(ROOT, 'data', 'shogai-kojo', 'link-audit.txt'), L.join('\n'))
console.log('-> data/shogai-kojo/link-audit.txt')
