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
export const page = ({ title, desc, canonical, depth, body, jsonld, noindex }) => {
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
<link rel="stylesheet" href="${up}assets/style.css?v=20260903d">
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
</body>
</html>
`
}

