// 全ページの上部メニュー（<nav class="site-nav">）とロゴの添え書きを1つにそろえる（2026-10-11）。
//   node scripts/stamp-site-nav.mjs          … .github/workflows/pages.yml がデプロイの直前に回す
//   node scripts/stamp-site-nav.mjs --check  … 書かずに、そろえる枚数と、いまのメニューの種類の数だけ出す
//
// ★なぜ（2026-10-11 AdSense の審査が「有用性の低いコンテンツ」で不合格。求められた3点の1つが
//   「継続的なキュレーションと構造のメンテナンス」）。ページを書く生成器が十数か所あり、上部メニューが13通りに割れていた。
//   9割のページ（型の面と多くの記事）は8月までの形（公営住宅・障害年金・交通割引・障害者控除）のままで、
//   いま人が来ている生活保護・住民税非課税・高額療養費が載っていなかった。ロゴの添え書きも「街ごとの福祉」「くらしの福祉」の2通り。
// ★stamp-adsense.mjs と同じ理由で、生成器ではなくデプロイの直前のここ1か所で入れる。リポジトリの HTML は前の形のまま。
//   生成器（shogai-kojo-page.mjs の page() ほか）のメニューを直しても本番には効かない（ここで上書きされる）。メニューを変えるときはここを直す。
// ★404.html はどの道でも出るので、リンクを根からの道（/…）で書く。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { relOf } from './bulk-pages.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
export const TAGLINE = '知らないと損する、くらしの福祉'
// トップ（index.html）のメニューと同じ並び＋記事一覧
export const NAV = [
  ['index.html', 'トップ'],
  ['articles/seikatsuhogo-keisanki.html', '生活保護'],
  ['articles/juminzei-hikazei-check.html', '住民税非課税'],
  ['articles/kougaku-ryouyouhi-2026.html', '高額療養費'],
  ['articles/shogaisha-kojo-tax.html', '障害者控除'],
  ['articles/koei-jutaku-bairitsu.html', '公営住宅'],
  ['articles/shogai-nenkin-basics.html', '障害年金'],
  ['articles/', '記事一覧'],
]
export const navHtml = (up, rel) => `<nav class="site-nav" aria-label="主要">\n${NAV.map(([href, label]) => {
  const here = rel === href || (href === 'index.html' && rel === '')
  return `      <a href="${up}${href}"${here ? ' aria-current="page"' : ''}>${label}</a>`
}).join('\n')}\n    </nav>`

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !['node_modules', 'scripts', 'tools', 'data'].includes(e.name)) walk(p) } else if (e.name.endsWith('.html')) files.push(p)
  }
}
walk(ROOT)

const before = new Set()
let changed = 0, noNav = 0
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8')
  const navRe = /<nav class="site-nav" aria-label="主要">[\s\S]*?<\/nav>/
  const m = html.match(navRe)
  if (!m) { noNav++; continue }
  before.add(m[0].replace(/href="[^"]*"/g, '').replace(/\s+/g, ' '))
  const relFile = path.relative(ROOT, f).split(path.sep).join('/')
  const up = relFile === '404.html' ? '/' : '../'.repeat(relFile.split('/').length - 1)
  const rel = relOf(ROOT, f)
  const next = html
    .replace(navRe, () => navHtml(up, rel))
    .replace(/(<a class="brand" href="[^"]*">フクシル <small>)[^<]*(<\/small>)/, (_, a, b) => a + TAGLINE + b)
  if (next === html) continue
  changed++
  if (!CHECK) fs.writeFileSync(f, next)
}
console.log(`上部メニュー：${CHECK ? 'そろえる予定' : 'そろえた'} ${changed}枚 ／ そろえる前のメニューの種類 ${before.size}通り ／ メニューの無い HTML ${noNav}枚`)
