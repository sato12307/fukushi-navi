// shogai-kojo-page.mjs — フクシルの追加ページ共通の枠。
// 生成側が2つ（自治体ページと販売ページ）あるので、枠は1か所に置く。
// ヘッダ・フッタ・nav を2回書くと必ずずれる。[[same-question-two-implementations]]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITE = 'https://fukushiru.com'

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

