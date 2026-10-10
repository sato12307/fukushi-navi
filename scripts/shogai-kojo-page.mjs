// shogai-kojo-page.mjs — フクシルの追加ページ共通の枠。
// 生成側が2つ（自治体ページと販売ページ）あるので、枠は1か所に置く。
// ヘッダ・フッタ・nav を2回書くと必ずずれる。[[same-question-two-implementations]]

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SITE = 'https://fukushiru.com'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// 段の計測は assets/ev.js が正典。ここで読んで埋め込む（同じ判定を2か所に書かない）。
const EV = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'ev.js'), 'utf8').trim()
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ── 共通の枠 ────────────────────────────────────────────────────────────────
// noindex は「購入者だけが来る画面」に使う（/pack/kanryo/）。
// 特商法表記と規約は買う前に読めることが要件なので、こちらは索引させる。
// buyVer … assets/buy.js の版（キャッシュよけ）。★既定を上げると全ページの書き直しになる（版だけの違いは下の pageDiff が
//   「変わった」と数えないので lastmod は進まない）。
//   新しい商品を buy.js に足したときは、その売り場を作る生成器だけが新しい版を渡す（2026-09-30 県営）。
export const page = ({ title, desc, canonical, depth, body, jsonld, noindex, buyVer = '20260917a' }) => {
  // depth は「サイト根からの階層」。/pack/kanryo/ のような2階層下で '../' を使うと
  // /pack/assets/style.css を見にいって404になる。[[relative-asset-paths-subpages]]
  const up = depth === 0 ? './' : '../'.repeat(depth)
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${SITE}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${up}assets/style.css?v=20260908a">
${jsonld ? `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>` : ''}
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="${up}index.html">フクシル <small>知らないと損する、街ごとの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="${up}index.html">トップ</a>
      <a href="${up}articles/koei-jutaku-bairitsu.html">公営住宅</a>
      <a href="${up}articles/shogai-nenkin-basics.html">障害年金</a>
      <a href="${up}articles/shinkansen-airplane-discount.html">交通割引</a>
      <a href="${up}articles/shogaisha-kojo-tax.html">障害者控除</a>
    </nav>
  </div>
</header>

<main id="main">
  <div class="inner">
${body}
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p>フクシル ／ 出典は各ページ末尾に明記しています。制度の適用可否は必ず各自治体の窓口でご確認ください。</p>
    <p><a href="${up}about.html">このサイトについて</a> ／ <a href="${up}tokushoho/">特定商取引法に基づく表記</a> ／ <a href="${up}kiyaku/">利用規約</a></p>
  </div>
</footer>
<script>
${EV}
</script>
${/* 記事の中の売り場（.offer[data-offer]）の決済と計測。カードが無いページでは即 return するので、
     どのページから読んでも害はない。判定を各ページに写経しないためここ1か所で読む。 */''}
<script src="${up}assets/buy.js?v=${buyVer}" defer></script>
</body>
</html>
`
}

// ── 置いてある面と新しく作った面を比べる（sitemap の lastmod を進めるかどうか）──────────────
// ★改行をそろえてから比べる。この作業ツリーは core.autocrlf=true で、git が取り出した面（checkout・restore・pull）は
//   手元で CRLF になる。生成器が作る中身は LF なので、読んだそのままの文字列と比べると中身が同じでも「変わった」になり、
//   lastmod が今日に進んでいた（2026-09-29 /hikazei/ の1,791枚、2026-10-08 /toei/）。
// ★計測の埋め込み（上の page() が <script> に入れる assets/ev.js）と buy.js の版（?v=）だけの違いは「変わった」と数えない。
//   読み手に見える中身は同じ（assets/ev.js の先頭の決まり）。
// ★この判定は生成器ごとに書かない。ここ1か所に置いて呼ぶ。2026-10-08 まで、lastmod を決める比べ方が10の生成器に
//   別々に書かれていて、改行をそろえていたのは4つ、計測の埋め込みまで外していたのは2つだけだった。[[same-question-two-implementations]]
const readable = (h) => h.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/assets\/buy\.js\?v=\w+/g, 'assets/buy.js')
// 置いてある面を読む。まだ無ければ null。
export const readPrev = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
// 戻り値　'same'＝改行をそろえると同じ（書き直さなくてよい）
// 　　　　'embed'＝計測の埋め込みと buy.js の版だけが違う（書き直すが lastmod は進めない）
// 　　　　'changed'＝読み手に見える中身が違う、または面がまだ無い（lastmod を今日にする）
// norm … その面で「違い」と数えない所を消す関数（例：koei-suii-build.mjs の最終更新の日付）。
export const pageDiff = (prev, html, norm = (h) => h) => {
  if (prev == null) return 'changed'
  const a = norm(prev.replace(/\r\n/g, '\n')), b = norm(html.replace(/\r\n/g, '\n'))
  if (a === b) return 'same'
  return readable(a) === readable(b) ? 'embed' : 'changed'
}
// 面を書き出す（中身が同じなら書かない）。戻り値は pageDiff と同じで、sitemap の lastmod は 'changed' のときだけ進める。
// dates … 面に入れた「作った日」（最終更新・生成日・dateModified など）の正規表現。ここだけが違う面は 'same'＝書き直さない
//         （面の日付も lastmod も前のまま）。計測の埋め込みだけが違って書き直す 'embed' のときも、ここは置いてある面の日付を残す
//         （sitemap の lastmod と面に出す日付を食い違わせない）。koei-suii-build.mjs で決めた形（2026-10-08）を、
//         面に日付を入れる生成器の共通にした（2026-10-11）。
export const writePage = (file, html, dates = []) => {
  const prev = readPrev(file)
  const kind = pageDiff(prev, html, (h) => dates.reduce((s, re) => s.replace(re, ''), h))
  if (kind === 'same') return kind
  let out = html
  if (kind === 'embed') for (const re of dates) { const old = prev.replace(/\r\n/g, '\n').match(re); if (old) out = out.replace(re, () => old[0]) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, out)
  return kind
}
// 取り込み済みの版（git の HEAD）を読む。新しいファイル・git の外なら null。rel はリポジトリの根からの相対（/ 区切り）。
// ★記事に箱を貼り直す stamp-offers.mjs・stamp-kaitei.mjs が、中身が変わったかをこれと比べて決める（2026-10-11）。
//   置いてある記事は、ほかの生成器が作り直した途中の形のことがある。月次の Actions（koei-jutaku.yml）は build_koei_cities.py が
//   koei-tokyo.html を売り場の箱なしで書き直してから stamp-offers.mjs が箱を貼るので、置いてある記事と比べると毎月「変わった」になり、
//   出来上がりが前の月と同じでも lastmod が進んでいた。
export const readCommitted = (rel) => {
  try {
    return execFileSync('git', ['-C', REPO, 'show', `HEAD:${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return null }
}
// 記事の中の before（見出しなど）の直前に箱を入れる。箱の前後の空行は1つにそろえる。before が無ければ null。
// ★前の空行をそろえないと、置いてある記事によって出来上がりが変わる。月次の Actions で build_koei_cities.py が書き直す
//   koei-tokyo.html は見出しの前に空行が2つあり、そこへ貼ると2つ・手元で貼り直すと1つになって、中身が同じでも
//   「変わった」になっていた（2026-10-11）。stamp-offers.mjs・stamp-kaitei.mjs の箱はどれもここで入れる。
export const stampBefore = (s, before, box) => {
  const re = new RegExp(`\\n*(${before.source})`, before.flags.replace('g', ''))
  return re.test(s) ? s.replace(re, (_, m) => `\n\n${box}\n\n${m}`) : null
}

// ── sitemap.xml を読む・書く・自分の行を入れ替える ──────────────────────────────────
// ★改行を LF にそろえて読み、LF で書く（2026-10-11）。git が取り出した sitemap.xml は手元で CRLF になる（core.autocrlf=true）のに、
//   生成器の正規表現は行末を \n と決めて書いてある。CRLF のまま読むと、hikazei-city・jiritsu-build は `\n?` が \r で外れて
//   1URLごとに空行を作り（1回で1,791行。本番の sitemap.xml に2,225行たまっていた）、kenei-build は `.*\n` が見つからずに
//   県営の6URLを末尾に重ねて足し、shogai-kojo-build・houkatsu-build は消した行の \r を残していた。
//   LF で書いても git の上では差分にならない（取り込むときに LF にそろえる）。
// ★sitemap.xml を読み書きする生成器は、どれもここを通す。読み方を生成器ごとに写さない。[[same-question-two-implementations]]
const SITEMAP = path.join(REPO, 'sitemap.xml')
const lf = (s) => s.replace(/\r\n?/g, '\n')
export const readSitemap = () => lf(fs.readFileSync(SITEMAP, 'utf8'))
// 中身が同じなら書かない（改行だけが違う置いてあるファイルにも触らない）
export const writeSitemap = (xml) => {
  const next = lf(xml)
  if (next !== readSitemap()) fs.writeFileSync(SITEMAP, next)
}
// 載っている行の lastmod（loc → 日付）。同じ loc が2行あれば1行目（putUrls が残すほう）
export const sitemapLastmods = (sm) => {
  const m = new Map()
  for (const [, loc, lm] of sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) if (!m.has(loc)) m.set(loc, lm)
  return m
}
// 自分の行を、その場で入れ替える。rows＝[[loc, '<url>…</url>'], …]。載っていない loc は </urlset> の直前に足す。
// own(loc) が true の行で rows に無いもの（作らなくなった面）と、同じ loc の2行目からは消す。
// ★消してから末尾に足す形にしない。ほかの生成器が後ろに足した行と順番が入れ替わり、中身が同じでも毎回差分が出る
//   （2026-10-11 写しで shogai-kojo-build・shogai-kojo-sell・houkatsu-build を回すと69行が動いた）。
export const putUrls = (sm, rows, own = () => false) => {
  const want = new Map(rows), done = new Set()
  let out = lf(sm).replace(/^[ \t]*<url><loc>([^<]+)<\/loc>.*\n/gm, (line, loc) => {
    if (want.has(loc) && !done.has(loc)) { done.add(loc); return `  ${want.get(loc)}\n` }
    return done.has(loc) || own(loc) ? '' : line
  })
  if (!out.includes('</urlset>')) throw new Error('sitemap.xml に </urlset> がありません')
  const rest = [...want].filter(([loc]) => !done.has(loc))
  if (rest.length) out = out.replace('</urlset>', () => `${rest.map(([, r]) => `  ${r}\n`).join('')}</urlset>`)
  return out
}

