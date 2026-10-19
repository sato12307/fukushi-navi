// ─────────────────────────────────────────────────────────────────────────────
// tool-page.mjs — 計算機つきの1枚の面（手当・保険料・差し押さえなど）の共通の枠と書き出し。
//   使う所：teate-shogai-page.mjs・teate-jifute-page.mjs・kouki-page.mjs・judo-iryo-page.mjs・sashiosae-page.mjs（2026-10-20〜）
//
// ★なぜ（2026-10-20 ユーザー「のこった案をすべてフクシルに増床してくれ」）
//   同じ形の面を5枚まとめて足す。枠（head・JSON-LD・上部メニュー・出典・ご注意・フッタ）を5つの生成器に写すと必ずずれるので、
//   ここ1か所に置く。形は gakko/kyufukin/（kyufukin-page.mjs）にそろえた。上部メニューは本番ではデプロイの直前に
//   stamp-site-nav.mjs が1つの形に書き換える。AdSense のタグも同じくデプロイの直前（stamp-adsense.mjs）。
// ★数字は生成器に書かない。各生成器は data/*.json（公式の原典から写したもの）だけを読み、公式の計算例と円まで照らしてから書く。
//   照らした結果が合わなかった型は、面に「公式の例と1円まで合っていない」旨を書く（2026-10-20 ユーザー裁定 2）。
// ─────────────────────────────────────────────────────────────────────────────
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writePage, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const num = (n) => Math.round(n).toLocaleString('ja-JP')
export const yen = (n) => `${num(n)}円`
export const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }

// 計算機の欄の見た目（kyufukin-page.mjs と同じ）
export const CALC_CSS = `table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit td.num,table.fit th.num{text-align:right;white-space:nowrap}table.fit tbody th{text-align:left;font-weight:600;white-space:normal}table.fit small{font-weight:400}
table.fit tr.hit td,table.fit tr.hit th{background:#fff4c2}
.calc{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:1.2em 0;background:var(--soft)}
.calc .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:.55em 0}
.calc label{font-weight:600;font-size:.9rem;flex:1 1 200px}
.calc input,.calc select{padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:1rem;max-width:100%}
.calc input{width:10em}
.calc .out{margin-top:10px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:8px}
.calc .total{font-size:1.35rem;font-weight:800;color:var(--brand-dark);margin:.1em 0}
.calc .bd{font-size:.88rem;color:var(--sub);margin:.3em 0 0;line-height:1.7}
.mini-note{font-size:.84rem;color:var(--sub)}
.check-mark{font-size:.8rem;color:var(--sub)}`

// 面の HTML。rel＝根からの道（'teate/shogai/' など）。crumb＝パンくずの最後の名前。
export const toolPage = ({ rel, title, desc, ogTitle, ogDesc, published, crumb, h1, h1sub, updatedNote, body, faq = [], sources = [], disclaimer, related, js = '', css = '' }) => {
  const url = `https://fukushiru.com/${rel}`
  const depth = rel.split('/').filter(Boolean).length
  const up = '../'.repeat(depth)
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: title.replace(/｜フクシル$/, ''), description: desc, inLanguage: 'ja', datePublished: published, dateModified: TODAY, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' }, url },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'トップ', item: 'https://fukushiru.com/' }, { '@type': 'ListItem', position: 2, name: crumb, item: url }] },
  ]
  if (faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })
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
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle || title.replace(/｜フクシル$/, ''))}">
<meta property="og:description" content="${esc(ogDesc || desc)}">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${up}assets/style.css?v=20260908a">
${ld.map((x) => `<script type="application/ld+json">\n${JSON.stringify(x, null, 1)}\n</script>`).join('\n')}
<style>
${CALC_CSS}
${css}
</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="${up}index.html">フクシル <small>知らないと損する、くらしの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="${up}index.html">トップ</a>
      <a href="${up}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>
      <a href="${up}articles/juminzei-hikazei-check.html">住民税非課税</a>
      <a href="${up}articles/koei-jutaku-bairitsu.html">公営住宅</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="${up}index.html">トップ</a> ＞ ${esc(crumb)}</p>

  <h1>${esc(h1)}${h1sub ? `<br><small>${esc(h1sub)}</small>` : ''}</h1>
  <p class="updated">最終更新：${TODAY}${updatedNote ? ` ／ ${esc(updatedNote)}` : ''}</p>

${body.replace(/\{\{UP\}\}/g, up)}
${faq.length ? `
  <h2>よくある質問</h2>
  ${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n  <p>${esc(a)}</p>`).join('\n  ')}
` : ''}${related ? `
  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>${related.replace(/\{\{UP\}\}/g, up)}</p>
  </div>
` : ''}
  <h2>出典</h2>
  <ul class="sources">
    ${sources.map((s) => `<li>${esc(s.name)} ${esc(s.url)}</li>`).join('\n    ')}
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>${disclaimer}
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p><strong>フクシル</strong>— 知らないと損する、くらしの福祉制度を当事者目線でまとめる情報サイトです。</p>
    <p><a href="${up}index.html">トップへ戻る</a> ／ <a href="${up}about.html">このサイトについて</a> ／ <a href="${up}tokushoho/">特定商取引法に基づく表記</a> ／ <a href="${up}kiyaku/">利用規約</a></p>
    <p>© 2026 フクシル. 本サイトの情報は一般的な参考情報であり、正確性を保証するものではありません。</p>
  </div>
</footer>
${js ? `\n<script>${js}</script>` : ''}
<script src="${up}assets/ev.js?v=20261007a" defer></script>
</body>
</html>
`
}

// 書き出しと sitemap の1行（中身が同じなら書かない＝lastmod を進めない）
export const writeTool = (rel, html, { dry = false, priority = '0.8' } = {}) => {
  if (dry) { console.log(`--dry：書いていない（${rel}・${(html.length / 1024).toFixed(1)}KB）`); return }
  const url = `https://fukushiru.com/${rel}`
  const kind = writePage(path.join(ROOT, rel, 'index.html'), html, [/最終更新：\d{4}-\d{2}-\d{2}/, /"dateModified": "\d{4}-\d{2}-\d{2}"/])
  const sm = readSitemap()
  const prev = sitemapLastmods(sm).get(url)
  writeSitemap(putUrls(sm, [[url, `<url><loc>${url}</loc><lastmod>${kind === 'changed' || !prev ? TODAY : prev}</lastmod><priority>${priority}</priority></url>`]]))
  console.log(`${kind === 'changed' ? '書いた' : kind === 'embed' ? '計測の埋め込みだけ書き直した' : '変わらず'}: ${rel}（${(html.length / 1024).toFixed(1)}KB）${prev ? '' : '・sitemap に1行足した'}`)
}
