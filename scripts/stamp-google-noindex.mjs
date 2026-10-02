// 量産の面（市区町村ごと・都道府県ごとの型の面）を Google にだけ noindex にし、Google 用のサイトマップを作る（2026-10-02）。
//   node scripts/stamp-google-noindex.mjs          … .github/workflows/pages.yml がデプロイの直前に回す
//   node scripts/stamp-google-noindex.mjs --check  … 書かずに、対象の枚数だけ出す
//
// ★なぜ（2026-10-02 ユーザー「評価下げてそうな量産コンテンツをまず外す」「bing はサイトマップそのままでええよな」）
//   GSC/URL検査の台帳では、手書きの記事は 87枚中42枚が登録済みなのに、型の面（非課税の市区町村 1,741・障害者控除 437・
//   自立支援 200・非課税の都道府県 47・地域包括 8）はほぼ全部「検出 - インデックス未登録」で止まっていた。
//   Bing のページ別の数字（GetPageStats・直近約3か月）でも、表示・クリックはほぼ手書きの記事だけ（999/1,007クリック）で、
//   型の面で需要が見えたのは3枚だけ。Google の評価を手書きの面に集めるため、型の面は Google にだけ見せない。
// ★Bing には見せたまま：robots の noindex は Bing も従うので使わず、googlebot だけに効く <meta name="googlebot"> を入れる。
//   サイトマップは、全部入りの sitemap.xml を Bing（登録済みのフィード・IndexNow）に残し、Google には型の面を抜いた
//   sitemap-google.xml を robots.txt で知らせる（GSC に登録していた sitemap.xml は削除した）。
// ★残す面：各区画の入口（/hikazei/・/shogai-kojo/ など）と、Bing で需要が見えた3枚（KEEP）。
// ★stamp-adsense.mjs と同じく、生成器（十数か所）ではなくデプロイの直前のここ1か所で入れる。リポジトリの HTML には入らない。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const SITE = 'https://fukushiru.com/'
const META = '<meta name="googlebot" content="noindex">'
// 型の面（サイトの根からの道）
const BULK = [
  /^hikazei\/\d{5}\/$/,            // 住民税非課税の年収の目安（市区町村）
  /^hikazei\/ken\/\d{2}\/$/,       // 同（都道府県）
  /^shogai-kojo\/\d{6}\.html$/,    // 障害者控除の手順（市区町村）
  /^jiritsu\/ken\/\d{2}\/((\d{5,6}|yakkyoku|houmon)\/)?$/, // 自立支援医療（都道府県・市区町村・薬局・訪問看護）
  /^houkatsu\/\d{6}\.html$/,       // 地域包括支援センター（市区町村）
]
// Bing で需要が見えた型の面（2026-10-02 GetPageStats）。Google にも見せる
const KEEP = new Set(['shogai-kojo/272248.html', 'shogai-kojo/252131.html', 'hikazei/44210/'])

export const isBulk = (rel) => !KEEP.has(rel) && BULK.some((re) => re.test(rel))

// 1. 面に googlebot の noindex を入れる
let stamped = 0, already = 0
const toRel = (file) => {
  const r = path.relative(ROOT, file).split(path.sep).join('/')
  return r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r
}
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !['node_modules', 'scripts', 'tools', 'data'].includes(e.name)) walk(p); continue }
    if (!e.name.endsWith('.html') || !isBulk(toRel(p))) continue
    const html = fs.readFileSync(p, 'utf8')
    if (html.includes(META)) { already++; continue }
    if (!/<head[^>]*>/i.test(html)) continue
    stamped++
    if (!CHECK) fs.writeFileSync(p, html.replace(/<head[^>]*>/i, (m) => `${m}\n${META}`))
  }
}
walk(ROOT)

// 2. Google 用のサイトマップ（型の面を抜く）
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')
let dropped = 0
const out = sm.replace(/^\s*<url><loc>([^<]+)<\/loc>.*\n/gm, (line, loc) => {
  const rel = loc.startsWith(SITE) ? loc.slice(SITE.length) : loc
  if (isBulk(rel)) { dropped++; return '' }
  return line
})
const kept = (out.match(/<url>/g) || []).length
if (!CHECK) fs.writeFileSync(path.join(ROOT, 'sitemap-google.xml'), out)
console.log(`googlebot noindex：入れた ${stamped}枚・既に入っていた ${already}枚 ／ sitemap-google.xml：${kept}URL（型の面 ${dropped}URL を抜いた）${CHECK ? '（--check：書いていない）' : ''}`)
