// articles-index.mjs — 記事と計算機の一覧（/articles/）を作る。
//   node scripts/articles-index.mjs        → articles/index.html と sitemap.xml の1行
//   node scripts/articles-index.mjs --dry  → 書かずに、載せた数と載っていない面だけ出す
//
// ★なぜ（2026-10-11 AdSense の審査が「有用性の低いコンテンツ」で不合格。求められた3点の1つが
//   「継続的なキュレーションと構造のメンテナンス」）。それまでサイトには記事の一覧が無く、/articles/ は GitHub の 404 だった。
//   トップのカードは主な記事だけで、どの分野に何があるかを1枚で見渡せる面が無かった。
// ★題と説明は各面の <title>・<meta name="description"> から読む（ここに写さない）。面の題を直せば一覧も次の回で直る。
// ★分野の割り当て（CATS）だけは手で持つ。ここに無い記事（articles/*.html）と、Google に見せている面（型の面でない sitemap の行）で
//   どこにも載っていないものは「そのほか」に自動で足し、名前を出して知らせる（新しい記事が一覧から黙って抜けないように）。
// ★デプロイの直前にも回す（.github/workflows/pages.yml）。記事を足した日に手元で回し忘れても、本番の一覧は最新になる。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE, writePage, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'
import { isBulk } from './bulk-pages.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const OUT = path.join(ROOT, 'articles', 'index.html')
const URL = `${SITE}/articles/`

// 分野ごとの並び。items＝1行ずつ（題＋説明）、groups＝地名だけを1行に並べる束（同じ型の都市別・区別の面）
const CATS = [
  { id: 'seikatsuhogo', name: '生活保護', items: ['articles/seikatsuhogo-keisanki.html', 'seiho/', 'articles/seikatsuhogo-tsuika-kyufu.html', 'tsuika/', 'articles/seikatsuhogo-shinsei-jichitai.html', 'articles/seikatsuhogo-jisshitsu.html', 'articles/muryou-teigaku-shukuhakusho.html', 'articles/jutaku-fujo-jogen.html'] },
  { id: 'zei', name: '税と保険料（住民税非課税・国保・控除）', items: ['articles/juminzei-hikazei-check.html', 'hikazei/', 'mitoshi/hikazei/', 'hikazei/kokuho-tokyo/', 'hikazei/kodomo-shienkin/', 'hikazei/nenkin-ranking/', 'shien-kyufukin/', 'articles/shogaisha-kojo-tax.html', 'shogai-kojo/'] },
  { id: 'iryo', name: '医療費と医療の保険料', items: ['articles/kougaku-ryouyouhi-2026.html', 'mitoshi/kogaku/', 'kouki/', 'jiritsu/', 'articles/jiritsu-ichiran-kawaru.html', 'judo-iryo/'] },
  { id: 'teate', name: '手当（児童扶養手当・障害のある子と家族の手当）', items: ['teate/jido-fuyo/', 'teate/shogai/'] },
  { id: 'shogai', name: '障害年金・障害福祉サービス・就労', items: ['articles/shogai-nenkin-keisanki.html', 'articles/shogai-nenkin-basics.html', 'articles/shogai-nenkin-toukei.html', 'articles/shogai-service-futan.html', 'articles/shurou-ikou-koyou.html'] },
  { id: 'sumai', name: '住まい（公営住宅）', items: ['articles/koei-jutaku-bairitsu.html', 'articles/koei-hairiyasui.html', 'articles/koei-shunyu-kijun.html', 'articles/koei-yachin-keisan.html', 'articles/koei-danchi-ranking.html', 'koei/bairitsu-suii/', 'toei/', 'articles/toei-waku.html'],
    groups: [
      { label: '市営住宅の倍率（都市別）', re: /^articles\/koei-(?!jutaku|hairiyasui|shunyu|yachin|danchi)[a-z]+\.html$/, name: (t) => t.split(/の(市営|都営)住宅/)[0] },
      { label: '県営・市営住宅の倍率と申込先（地域別）', list: ['saitama-ken/', 'aichi-ken/', 'osaka-fu/', 'shiga-ken/', 'miyagi-ken/', 'kochi-ken/', 'yokohama/', 'kawasaki/', 'sagamihara/', 'shizuoka/', 'kobe/'], name: (t) => t.split(/住宅/)[0] + '住宅' },
      { label: '都営住宅の募集区分別', re: /^articles\/toei-waku-[a-z]+\.html$/, name: (t) => t.split('は何倍')[0].replace(/^都営住宅の/, '') },
      { label: '都営住宅の倍率（区市町別）', re: /^articles\/toei-(?!waku)[a-z]+\.html$/, name: (t) => t.split('の都営住宅')[0] },
    ] },
  { id: 'kotsu', name: '障害者手帳の割引と自治体の助成', items: ['articles/shinkansen-airplane-discount.html', 'articles/jichitai-transport-medical.html'] },
  { id: 'okane', name: 'お金の相談（借金・差し押さえ・破産）', items: ['sashiosae/', 'articles/shakkin-kakei-soudan.html', 'articles/jiko-hasan-chizu.html'] },
  { id: 'kaigo', name: '介護', items: ['kaigo/hokenryo/', 'kaigo/kogaku/', 'houkatsu/', 'articles/houkatsu-tantou.html', 'articles/kaigo-jigyosho-genshou.html'] },
  { id: 'kodomo', name: '学校・子ども', items: ['gakko/kyufukin/'] },
  { id: 'yotei', name: '制度が変わる日', items: ['calendar/'] },
]
// 一覧に載せなくてよい面：サイトの決まりごと・売り場・型の面の入口から1つ下の面（入口から辿れる）
const NOT_LISTED = [/^$/, /^about\.html$/, /^privacy\/$/, /^tokushoho\/$/, /^kiyaku\/$/, /^pack\/$/, /^articles\/$/,
  /^shogai-kojo\/\d{6}\.html$/, /^houkatsu\/\d{6}\.html$/, /^hikazei\/\d{5}\/$/, /^jiritsu\/ken\//]

// 面の題と説明を読む
const fileOf = (rel) => path.join(ROOT, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel)
const meta = (rel) => {
  const f = fileOf(rel)
  if (!fs.existsSync(f)) return null
  const h = fs.readFileSync(f, 'utf8')
  const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || rel
  const d = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''
  const dec = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
  return { title: dec(t).replace(/｜フクシル$/, '').trim(), desc: dec(d).trim() }
}
const short = (s, n = 110) => (s.length > n ? s.slice(0, n).replace(/[、。，．・\s]*$/, '') + '…' : s)

// 載せる候補：articles/*.html 全部と、Google に見せている sitemap の面
const articleRels = fs.readdirSync(path.join(ROOT, 'articles')).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => 'articles/' + f)
const smRels = [...readSitemap().matchAll(/<loc>https:\/\/fukushiru\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]).filter((r) => !isBulk(r))
const universe = [...new Set([...articleRels, ...smRels])].filter((r) => !NOT_LISTED.some((re) => re.test(r)) && meta(r))

const used = new Set()
const missing = []
const li = (rel) => {
  const m = meta(rel)
  if (!m) { missing.push(rel); return '' }
  used.add(rel)
  const [head, ...rest] = m.title.split('｜')
  const sub = rest.join('｜')
  return `<li><a href="../${rel}">${esc(head)}</a>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${m.desc ? `<p>${esc(short(m.desc))}</p>` : ''}</li>`
}
const groupLine = (g) => {
  const rels = g.list ? g.list.filter((r) => meta(r)) : universe.filter((r) => g.re.test(r)).sort()
  if (!rels.length) return ''
  for (const r of rels) used.add(r)
  const links = rels.map((r) => `<a href="../${r}">${esc(g.name(meta(r).title))}</a>`).join('／')
  return `<li class="group"><span class="glabel">${esc(g.label)}（${rels.length}）</span><p>${links}</p></li>`
}

const sections = CATS.map((c) => {
  const rows = [...c.items.map(li), ...(c.groups || []).map(groupLine)].filter(Boolean)
  return { ...c, html: `<h2 id="${c.id}">${esc(c.name)}</h2>\n<ul class="idx">\n${rows.join('\n')}\n</ul>`, n: rows.length }
})
const rest = universe.filter((r) => !used.has(r))
if (rest.length) sections.push({ id: 'sonota', name: 'そのほか', html: `<h2 id="sonota">そのほか</h2>\n<ul class="idx">\n${rest.map(li).join('\n')}\n</ul>` })
const count = used.size

const CSS = `<style>
.idx { list-style: none; padding: 0; margin: .6em 0 1.6em; }
.idx li { border-bottom: 1px solid var(--line); padding: .7em 0; }
.idx li > a { font-weight: 700; color: var(--brand-dark); }
.idx .sub { display: block; font-size: .86rem; color: var(--sub); margin-top: .15em; }
.idx p { margin: .3em 0 0; font-size: .9rem; color: var(--sub); }
.idx .glabel { font-weight: 700; color: var(--ink); }
.idx .group p a { display: inline-block; max-width: 100%; }
.toc-cats { display: flex; flex-wrap: wrap; gap: 6px 10px; padding: 0; list-style: none; margin: 1em 0 1.4em; }
.toc-cats a { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 12px; font-size: .9rem; text-decoration: none; }
</style>`

const body = `${CSS}
  <nav class="breadcrumb" aria-label="現在地"><a href="../index.html">トップ</a> › 記事一覧</nav>
  <h1>記事と計算機の一覧</h1>
  <p class="lead">フクシルにある記事・計算機・自治体別の一覧を、分野ごとに並べています（${count}本）。どれも無料で読めます。金額や基準は、各ページの末尾に出典（国・自治体の公表資料や法令）を書いており、改定があれば直しています。</p>
  <ul class="toc-cats">
${sections.map((s) => `    <li><a href="#${s.id}">${esc(s.name.replace(/（.*）$/, ''))}</a></li>`).join('\n')}
  </ul>
${sections.map((s) => s.html).join('\n\n')}

  <p class="mini-note">このサイトの作り方と、誤りを見つけたときの連絡先は<a href="../about.html">このサイトについて</a>にまとめています。</p>
`

const html = page({
  title: '記事と計算機の一覧｜フクシル',
  desc: `フクシルの記事・計算機・自治体別の一覧を分野ごとに（生活保護・住民税非課税と国保・医療費・障害年金・公営住宅・交通割引・お金の相談・介護）。${count}本。`,
  canonical: '/articles/',
  depth: 1,
  body,
  jsonld: {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: '記事と計算機の一覧', url: URL, inLanguage: 'ja', isPartOf: { '@type': 'WebSite', name: 'フクシル', url: SITE + '/' } },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'トップ', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: '記事一覧', item: URL }] },
    ],
  },
})

console.log(`記事一覧：${count}本を${sections.length}分野に${rest.length ? `（そのほか ${rest.length}本：${rest.join(', ')}）` : ''}`)
if (missing.length) { console.error('★一覧に書いてあるのに面が無い：' + missing.join(', ')); process.exit(1) }
if (DRY) process.exit(0)

const kind = writePage(OUT, html)
const sm = readSitemap()
const prev = sitemapLastmods(sm).get(URL)
writeSitemap(putUrls(sm, [[URL, `<url><loc>${URL}</loc><lastmod>${kind === 'changed' || !prev ? TODAY : prev}</lastmod><priority>0.7</priority></url>`]]))
console.log(`${kind === 'changed' ? '書いた' : kind === 'embed' ? '計測の埋め込みだけ書き直した' : '変わらず'}: articles/index.html${prev ? '' : '（sitemap に1行足した）'}`)
