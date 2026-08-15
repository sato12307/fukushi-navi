// ─────────────────────────────────────────────────────────────────────────────
// kaigo-build.mjs — data/kaigo-genshou.json から記事1枚を生成する。
//   articles/kaigo-jigyosho-genshou.html
//
// 設計の約束（発案イテレーションの敵対検証で確定した縮小版）:
//   ・法人名・事業所名は一切出さない。市区町村×サービス種別の集計だけ。
//     → 実名を出すと訂正・削除の申し入れが本人に届き、密な直接連絡が発生する。
//   ・「消えた＝廃業」と書かない。公表データに理由は書かれていない。
//   ・公式が全断面を恒久公開している事実を隠さない（誰でも再現できる集計だと明記）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kaigo-genshou.json'), 'utf8'))
const SITE = 'https://fukushiru.com'
const URL = '/articles/kaigo-jigyosho-genshou.html'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v) => Number(v || 0).toLocaleString('ja-JP')
const jp = (ym) => String(ym).replace(/^(\d{4})-(\d{2})$/, '$1年$2月')

const totOld = D.services.reduce((s, x) => s + x.old, 0)
const totNow = D.services.reduce((s, x) => s + x.now, 0)
const totGone = D.services.reduce((s, x) => s + x.gone, 0)
const gonePct = (totGone / totOld * 100).toFixed(1)
const years = (() => {
  const [ay, am] = D.from.split('-').map(Number)
  const [by, bm] = D.to.split('-').map(Number)
  return Math.round(((by - ay) * 12 + (bm - am)) / 12 * 10) / 10
})()

const svc = [...D.services].sort((a, b) => b.gonePct - a.gonePct)
// 純増減と入れ替わりは別物。増えている種別ほどこの差が効く。
const grew = svc.filter((s) => s.now > s.old)

const prefRows = Object.entries(D.byPref)
  .filter(([, v]) => v.old && v.gone)
  .map(([pref, v]) => ({ pref, old: v.old, now: v.now || 0, gone: v.gone, pct: Math.round((v.gone / v.old) * 1000) / 10 }))
  .sort((a, b) => b.pct - a.pct)

const FAQ = [
  ['「一覧から消えた」は廃業という意味ですか？',
    'いいえ。公表データには消えた理由が書かれていません。廃止のほか、休止、法人の合併や名称変更、指定更新の手続き上の遅れ、様式の変更でも一覧から消えます。このページでは理由を推測せず「一覧から消えた」とだけ書いています。'],
  ['どこのデータですか？',
    `厚生労働省「介護サービス情報公表システム」のオープンデータです。${jp(D.from)}末時点と${jp(D.to)}末時点の2つの断面を、事業所番号で突き合わせました。誰でも同じ手順で再現できます（出典は末尾）。`],
  ['事業所が増えている種別もあるのに、なぜ「消えた」数が多いのですか？',
    `新しく指定を受けた事業所と、一覧から消えた事業所の両方が起きているためです。差し引きの増減だけを見ると、この入れ替わりが見えません。たとえば訪問看護は${n(D.services.find((s) => s.name === '訪問看護')?.old)}から${n(D.services.find((s) => s.name === '訪問看護')?.now)}へ増えていますが、同じ期間に${n(D.services.find((s) => s.name === '訪問看護')?.gone)}事業所が一覧から消えています。`],
  ['自分の地域の事業所を個別に調べたいのですが',
    '個別の事業所については、厚生労働省の「介護サービス情報公表システム」で現在の指定状況を確認できます。当ページは地域ごとの集計だけを扱っており、事業所名や法人名は掲載していません。'],
]

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>介護事業所はどれだけ消えたか｜${years}年で${gonePct}%が一覧から消えた（都道府県別・サービス種別）｜フクシル</title>
<meta name="description" content="厚生労働省の介護サービス情報公表システムのオープンデータを${jp(D.from)}末と${jp(D.to)}末で突き合わせ、一覧から消えた事業所を都道府県別・サービス種別に集計。${n(totOld)}事業所のうち${n(totGone)}件（${gonePct}%）が消えました。地域密着型通所介護${svc[0].gonePct}%を筆頭に、増えている種別でも入れ替わりが起きています。事業所名・法人名は掲載していません。">
<link rel="canonical" href="${SITE}${URL}">
<meta property="og:type" content="article">
<meta property="og:title" content="介護事業所はどれだけ消えたか｜${years}年で${gonePct}%が一覧から消えた">
<meta property="og:description" content="厚労省オープンデータの2断面を突き合わせた実測。${n(totOld)}事業所のうち${n(totGone)}件が一覧から消えました。都道府県別・サービス種別の集計。">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${SITE}${URL}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Dataset',
  name: `介護事業所の消失数（${jp(D.from)}末→${jp(D.to)}末・都道府県別・サービス種別）`,
  description: `厚生労働省「介護サービス情報公表システム」のオープンデータ2断面を事業所番号で突き合わせ、一覧から消えた事業所を集計したもの。事業所名・法人名は含まない。`,
  url: SITE + URL,
  creator: { '@type': 'Organization', name: 'フクシル', url: SITE },
  dateModified: D.generated_on,
  isAccessibleForFree: true,
  measurementTechnique: '事業所番号による2断面の集合差分',
  temporalCoverage: `${D.from}/${D.to}`,
})}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
})}</script>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="../index.html">フクシル <small>知らないと損する、街ごとの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="../index.html">トップ</a>
      <a href="koei-jutaku-bairitsu.html">公営住宅</a>
      <a href="shogai-nenkin-basics.html">障害年金</a>
      <a href="shinkansen-airplane-discount.html">交通割引</a>
      <a href="shogaisha-kojo-tax.html">障害者控除</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 介護事業所の増減</p>

  <h1>介護事業所はどれだけ消えたか<br>【${years}年で${gonePct}%が一覧から消えた・都道府県別】</h1>
  <p class="updated">最終更新：${D.generated_on} ／ 出典：厚生労働省「介護サービス情報公表システム」オープンデータ（${jp(D.from)}末・${jp(D.to)}末）</p>

  <p class="lead">主要8サービスの<strong>${n(totOld)}事業所</strong>を${jp(D.from)}末と${jp(D.to)}末で突き合わせたところ、<strong>${n(totGone)}事業所（${gonePct}%）が一覧から消えていました</strong>。同じ期間に新しく指定を受けた事業所もあるため、事業所の総数は${n(totOld)}から${n(totNow)}へと大きくは変わっていません。<strong>総数の増減だけを見ていると、この入れ替わりは見えません。</strong></p>

  <div class="callout">
  <p><strong>「消えた」は廃業という意味ではありません。</strong>公表データには理由が書かれていません。廃止のほか、休止、法人の合併・名称変更、指定更新の手続き上の遅れ、様式の変更でも一覧から消えます。このページでは理由を推測せず、<strong>「一覧から消えた」という観測</strong>だけを扱います。事業所名・法人名も掲載していません。</p>
  </div>

  <h2>サービス種別ごとの入れ替わり</h2>
  <p>消えた割合が高い順です。「現在」は${jp(D.to)}末時点の事業所数で、消えた数を引いた残りではありません（新しく指定された事業所を含みます）。</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>サービス種別</th><th>${jp(D.from)}末</th><th>${jp(D.to)}末</th><th>一覧から消えた</th><th>割合</th></tr></thead>
    <tbody>
${svc.map((s) => `      <tr><td>${esc(s.name)}</td><td>${n(s.old)}</td><td>${n(s.now)}</td><td>${n(s.gone)}</td><td><strong>${s.gonePct}%</strong></td></tr>`).join('\n')}
      <tr><td><strong>合計</strong></td><td><strong>${n(totOld)}</strong></td><td><strong>${n(totNow)}</strong></td><td><strong>${n(totGone)}</strong></td><td><strong>${gonePct}%</strong></td></tr>
    </tbody>
  </table>
  </div>

  <h2>増えている種別でも、中身は入れ替わっている</h2>
  <p>${years}年で事業所数が<strong>増えた</strong>のは次の種別です。それでも、同じ期間にこれだけの事業所が一覧から消えています。</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>サービス種別</th><th>増減</th><th>それでも消えた数</th></tr></thead>
    <tbody>
${grew.map((s) => `      <tr><td>${esc(s.name)}</td><td>+${n(s.now - s.old)}</td><td>${n(s.gone)}（${s.gonePct}%）</td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p class="note">増えているから安心、減っているから危ない、と単純には言えません。<strong>同じ地域で1つ閉じて1つ開いた場合、総数は変わらないのに、利用していた人は移らなければなりません。</strong></p>

  <h2>都道府県別</h2>
  <p>${jp(D.from)}末の事業所数に対して、一覧から消えた割合が高い順です。地域の人口や高齢化の度合いによって事業所数そのものが違うため、<strong>件数ではなく割合で並べています</strong>。</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>都道府県</th><th>${jp(D.from)}末</th><th>${jp(D.to)}末</th><th>一覧から消えた</th><th>割合</th></tr></thead>
    <tbody>
${prefRows.map((r) => `      <tr><td>${esc(r.pref)}</td><td>${n(r.old)}</td><td>${n(r.now)}</td><td>${n(r.gone)}</td><td><strong>${r.pct}%</strong></td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>

  <h2>よくある質問</h2>
${FAQ.map(([q, a]) => `  <h3>${esc(q)}</h3>\n  <p>${esc(a)}</p>`).join('\n')}

  <h2>調べ方</h2>
  <ul>
    <li>厚生労働省「介護サービス情報公表システム」のオープンデータから、${jp(D.from)}末時点と${jp(D.to)}末時点の2つの断面をダウンロードしました。</li>
    <li>対象は主要8サービス（訪問介護・訪問看護・通所介護・通所リハビリテーション・短期入所生活介護・認知症対応型共同生活介護・居宅介護支援・地域密着型通所介護）です。</li>
    <li>両方の断面を<strong>事業所番号</strong>で突き合わせ、古い断面にあって新しい断面に無いものを「一覧から消えた」として数えました。</li>
    <li><strong>この集計は誰でも同じ手順で再現できます。</strong>厚生労働省は2020年12月末以降の全断面を公開し続けているためです。当ページの価値は、その集計を並べている場所が他に見当たらない、という一点にあります。</li>
  </ul>

  <p class="sources">出典：厚生労働省「介護サービス情報公表システム オープンデータ」<a href="https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html" rel="noopener" target="_blank">https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html</a>（${jp(D.from)}末時点・${jp(D.to)}末時点）</p>

  <p class="disclaimer">当ページは公表データを機械的に集計したものです。個々の事業所の現在の指定状況は、厚生労働省の介護サービス情報公表システムでご確認ください。当サイトは事業所の紹介・あっせんは行っていません。</p>

  <div class="related">
    <h2>関連</h2>
    <ul>
      <li><a href="../index.html">くらしの福祉制度ナビ（トップ）</a></li>
      <li><a href="koei-jutaku-bairitsu.html">公営住宅の当選倍率</a></li>
    </ul>
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p>フクシル ／ 出典は各ページ末尾に明記しています。制度の適用可否は必ず各自治体の窓口でご確認ください。</p>
  </div>
</footer>
</body>
</html>
`

const out = path.join(ROOT, 'articles', 'kaigo-jigyosho-genshou.html')
fs.writeFileSync(out, html)
console.log(`articles/kaigo-jigyosho-genshou.html を生成（${(html.length / 1024).toFixed(0)}KB）`)
console.log(`  合計 ${n(totOld)} → ${n(totNow)} / 消えた ${n(totGone)} (${gonePct}%)`)
console.log(`  都道府県 ${prefRows.length}行 / サービス ${svc.length}種別 / 増えた種別 ${grew.length}`)
