// ─────────────────────────────────────────────────────────────────────────────
// kyufukin-page.mjs — 「高校生等奨学給付金（奨学のための給付金）」の面を作る（令和8年度の拡充＝所得割額で判定）。
//   node scripts/kyufukin-page.mjs        → gakko/kyufukin/index.html と sitemap.xml の1行
//   node scripts/kyufukin-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-10 ユーザー裁定 v306 c「おすすめ通りすすめて」・#2「修学で新規ドメインをとるほど厚みがあるかも大切」）
//   修学の分野の厚みを測った結果（proposals/shugaku-depth-2026-10-10.md）＝いまは別ドメインにせず、フクシルの中に
//   「学校のお金」の節（gakko/）として、あとで移せる形で置く。Bing 90日＝高校生等奨学給付金 1,625・奨学のための給付金 1,361・
//   奨学給付金 1,041（山は5〜7月）。条件つきの言い回しは0＝頭の語を取りにいく1枚。
//
// ★額と区分はここに書かない。data/kyufukin-koukou.json（文部科学省のリーフレットと事業の概要の原文から写したもの）だけを読む。
//   拡充の2つの区分の額が「非課税の世帯の額×1/3・×1/4を10円単位に丸めた額」と1円でも違えば、写し間違いとして止める。
// ★都道府県の窓口は、文部科学省の問合せ先一覧（47都道府県）から機械で拾ったもの。拡充（所得割のある世帯）の実施と額は
//   都道府県で違いうるので、言い切らずに県の案内で確かめるよう書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const REL = 'gakko/kyufukin/'
const OUT = path.join(ROOT, REL, 'index.html')
const URL = `https://fukushiru.com/${REL}`
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const PUBLISHED = '2026-10-10'
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const num = (n) => Math.round(n).toLocaleString('ja-JP')
const yen = (n) => `${num(n)}円`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kyufukin-koukou.json'), 'utf8'))
const T = Object.fromEntries(D.tiers.map((t) => [t.id, t]))
const SRC = D.sources

// ── 確かめ（写し間違いで止める）──────────────────────────────────────────────────
for (const id of ['seiho', 'hikazei', 't1', 't2']) if (!T[id]) die(`区分 ${id} がありません`)
const r10 = (x) => Math.round(x / 10) * 10
for (const k of ['zen', 'tsu']) for (const s of ['koku', 'shi']) {
  const h = T.hikazei[k][s]
  if (T.t1[k][s] !== r10(h / 3)) die(`所得割10万5,500円未満の額（${k}・${s}）が非課税の額の1/3（${r10(h / 3)}）と違います：${T.t1[k][s]}`)
  if (T.t2[k][s] !== r10(h / 4)) die(`所得割18万2,500円未満の額（${k}・${s}）が非課税の額の1/4（${r10(h / 4)}）と違います：${T.t2[k][s]}`)
}
if (T.t1.min !== 100 || T.t1.max !== 105499 || T.t2.min !== 105500 || T.t2.max !== 182499) die('所得割額の区分の境目がリーフレットと違います')
if (D.prefs.length !== 47 || D.prefs.some((p) => !p.links.length || p.links.some((l) => !/^https:\/\//.test(l.url)))) die('都道府県の窓口が47そろっていないか、URL が https で始まりません')

// ── 面の部品 ─────────────────────────────────────────────────────────────────
const zenRow = (t) => `<tr><th scope="row">${esc(t.short)}${t.nenshu ? `<br><small>${esc(t.nenshu)}の目安</small>` : ''}</th><td class="num">${num(t.zen.koku)}</td><td class="num">${num(t.zen.shi)}</td></tr>`
const tsuRow = (t) => `<tr><th scope="row">${esc(t.short)}</th><td class="num">${num(t.tsu.koku)}</td><td class="num">${num(t.tsu.shi)}</td></tr>`
const kindTxt = (k) => (k === '国公立' ? '国公立高校の案内' : k === '私立' ? '私立高校の案内' : k === '専攻科' ? '専攻科の案内' : '案内')
const prefList = D.prefs.map((p) => `<li><strong>${esc(p.name)}</strong> ${p.links.map((l) => `<a href="${esc(l.url)}" rel="nofollow">${kindTxt(l.kind)}</a>`).join('・')}</li>`).join('\n    ')
const H = T.hikazei, A = T.t1, B = T.t2, S = T.seiho

const FAQ = [
  ['高校生等奨学給付金はいくらもらえますか？', `${D.nendo}の年額は、住民税の所得割が非課税の世帯で、全日制などの私立${yen(H.zen.shi)}・国公立${yen(H.zen.koku)}です。${D.nendo}から対象が広がり、所得割額が10万5,500円未満の世帯は私立${yen(A.zen.shi)}・国公立${yen(A.zen.koku)}、18万2,500円未満の世帯は私立${yen(B.zen.shi)}・国公立${yen(B.zen.koku)}です。生活保護世帯は私立${yen(S.zen.shi)}・国公立${yen(S.zen.koku)}です。`],
  ['年収いくらまで対象ですか？', `文部科学省の目安では年収約490万円未満までです（${D.nenshuModel}）。実際の判定は年収ではなく、保護者全員の住民税の所得割額（道府県民税と市町村民税の合計）で行い、18万2,500円未満なら対象です。`],
  ['所得割額はどこで分かりますか？', '市区町村の課税証明書（所得証明書）か、マイナポータルの「わたしの情報」で確かめられます。父母など保護者全員の、道府県民税の所得割と市町村民税の所得割を足した額で判定します。'],
  ['就学支援金（授業料の支援）とは違うのですか？', '別の制度です。就学支援金は授業料を支援するもので、奨学給付金は教科書費・教材費・学用品費・通学用品費・修学旅行などの授業料以外の教育費を支援する、返さなくてよい給付金です。申し込みもそれぞれ必要です。'],
  ['第2子以降は額が違いますか？', `${D.nendo}の給付額の表には、第1子と第2子以降の区別はありません。全日制などでは、国公立・私立とも何人目の子でも同じ額です。`],
  ['年度の途中で収入が減ったら受けられますか？', '保護者の失業・病気など、都道府県が定める家計急変の理由で収入が対象の水準まで減ったときは、年度の途中でも申請できます。7月1日までに申請すれば年額、7月2日以降なら年額を月割りにした額です。'],
]

const JS = `(function(){var T=${JSON.stringify(D.tiers.map((t) => ({ id: t.id, label: t.label, nenshu: t.nenshu, share: t.share || '', min: t.min, max: t.max, zen: t.zen, tsu: t.tsu })))};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function calc(){var hh=$('k-hh').value,inc=$('k-wari').value.replace(/[,，円\\s]/g,''),sch=$('k-sch').value,cou=$('k-cou').value,nat=$('k-nat').value,o=$('k-out');
var t=null,why='';
if(hh==='seiho'){t=T[0];why='生活保護（生業扶助の高等学校等就学費）を受けている世帯の額です。'}
else{if(inc===''){o.innerHTML='<p class="bd">所得割額（保護者全員の合計）を入れると、対象かどうかと金額が出ます。非課税なら 0 を入れてください。</p>';return}
var w=parseInt(inc,10);if(!(w>=0)){o.innerHTML='<p class="bd">所得割額は数字で入れてください（例：98000）。</p>';return}
if(w===0){t=T[1];why='所得割が非課税の世帯です。'}else if(w<100){t=T[1];why='所得割額は100円単位なので、0円（非課税）として見ています。'}
else if(w<=T[2].max){t=T[2];why='所得割額が100円以上10万5,500円未満の世帯（'+T[2].share+'）です。'}else if(w<=T[3].max){t=T[3];why='所得割額が10万5,500円以上18万2,500円未満の世帯（'+T[3].share+'）です。'}
else{o.innerHTML='<p class="total">対象外の目安</p><p class="bd">所得割額が18万2,500円以上の世帯は、国の基準では対象になりません（年収の目安で約490万円以上）。都道府県が独自に上乗せしていないかは、県の案内で確かめてください。</p>';return}
if(nat==='other'&&(t.id==='t1'||t.id==='t2')){o.innerHTML='<p class="total">対象外の目安</p><p class="bd">下の②の生徒の世帯は、生活保護世帯と住民税非課税の世帯だけが対象です（所得割のある世帯への拡充は対象外）。</p>';return}}
var a=(cou==='tsu'?t.tsu:t.zen)[sch];
o.innerHTML='<p class="total">年額 '+yen(a)+'</p><p class="bd">'+t.label+'・'+(sch==='shi'?'私立':'国公立')+'・'+(cou==='tsu'?'通信制':'全日制・定時制など')+'。'+why+'お住まいの都道府県または学校に申し込みます（申込みの時期・必要な書類は都道府県で違います）。</p>'}
['k-hh','k-wari','k-sch','k-cou','k-nat'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});
$('k-hh').addEventListener('change',function(){$('k-wari-row').style.display=$('k-hh').value==='seiho'?'none':''});calc()})();`

const title = `高校生等奨学給付金はいくら？${D.nendo}は年収約490万円まで対象に｜所得割額で判定・都道府県の申込先｜フクシル`
const desc = `高校生等奨学給付金（奨学のための給付金）の${D.nendo}の金額と対象。住民税の所得割が非課税なら全日制の私立${yen(H.zen.shi)}・国公立${yen(H.zen.koku)}。${D.nendo}から所得割額18万2,500円未満（年収約490万円未満）まで広がり、私立${yen(A.zen.shi)}・${yen(B.zen.shi)}など。所得割額を入れるだけの判定と、47都道府県の申込先の一覧。`
const ld = [
  { '@context': 'https://schema.org', '@type': 'Article', headline: title.replace(/｜フクシル$/, ''), description: desc, inLanguage: 'ja', datePublished: PUBLISHED, dateModified: TODAY, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' }, url: URL },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'トップ', item: 'https://fukushiru.com/' }, { '@type': 'ListItem', position: 2, name: '高校生等奨学給付金', item: URL }] },
  { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
]

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(`高校生等奨学給付金はいくら？${D.nendo}は年収約490万円まで`)}">
<meta property="og:description" content="${esc(`所得割が非課税なら私立${yen(H.zen.shi)}。${D.nendo}から所得割額18万2,500円未満まで対象に。所得割額を入れるだけの判定と47都道府県の申込先。`)}">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${URL}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../../assets/style.css?v=20260908a">
${ld.map((x) => `<script type="application/ld+json">\n${JSON.stringify(x, null, 1)}\n</script>`).join('\n')}
<style>
table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit td.num,table.fit th.num{text-align:right;white-space:nowrap}table.fit tbody th{text-align:left;font-weight:600;white-space:normal}table.fit small{font-weight:400}
.calc{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:1.2em 0;background:var(--soft)}
.calc .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:.55em 0}
.calc label{font-weight:600;font-size:.9rem;flex:1 1 200px}
.calc input,.calc select{padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:1rem;max-width:100%}
.calc input{width:10em}
.calc .out{margin-top:10px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:8px}
.calc .total{font-size:1.35rem;font-weight:800;color:var(--brand-dark);margin:.1em 0}
.calc .bd{font-size:.88rem;color:var(--sub);margin:.3em 0 0;line-height:1.7}
.mini-note{font-size:.84rem;color:var(--sub)}
ul.prefs{list-style:none;padding:0;columns:2;column-gap:1.4em}ul.prefs li{break-inside:avoid;margin:.2em 0;font-size:.92rem}
@media (max-width:620px){ul.prefs{columns:1}}
</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="../../index.html">フクシル <small>知らないと損する、くらしの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="../../index.html">トップ</a>
      <a href="../../articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>
      <a href="../../articles/juminzei-hikazei-check.html">住民税非課税</a>
      <a href="../../articles/koei-jutaku-bairitsu.html">公営住宅</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="../../index.html">トップ</a> ＞ 学校のお金 ＞ 高校生等奨学給付金</p>

  <h1>高校生等奨学給付金はいくら？<br><small>${esc(D.nendo)}から年収約490万円の世帯まで（所得割額で判定・都道府県の申込先）</small></h1>
  <p class="updated">最終更新：${TODAY} ／ ${esc(D.nendo)}の給付額（文部科学省の資料で確認）</p>

  <p class="lead"><strong>高校生等奨学給付金</strong>（奨学のための給付金）は、教科書費・教材費・学用品費・通学用品費・修学旅行などの<strong>授業料以外の教育費</strong>を支援する、<strong>返さなくてよい給付金</strong>です。${esc(D.nendo)}から対象が広がり、住民税の所得割が非課税の世帯に加えて、<strong>所得割額が18万2,500円未満の世帯</strong>（年収の目安で約490万円未満）も受けられるようになりました。授業料の就学支援金とは<strong>別に申し込み</strong>が必要です。</p>

  <div class="callout point">
    <p><span class="tag">${esc(D.nendo)}の年額（全日制など）</span><br>所得割が非課税：私立 <strong>${yen(H.zen.shi)}</strong>・国公立 ${yen(H.zen.koku)}<br>所得割10万5,500円未満：私立 <strong>${yen(A.zen.shi)}</strong>・国公立 ${yen(A.zen.koku)}<br>所得割18万2,500円未満：私立 <strong>${yen(B.zen.shi)}</strong>・国公立 ${yen(B.zen.koku)}<br>生活保護世帯：私立 ${yen(S.zen.shi)}・国公立 ${yen(S.zen.koku)}</p>
  </div>

  <h2 id="hantei">自分が対象か・いくらかを判定する</h2>
  <div class="calc">
    <div class="row"><label for="k-hh">世帯</label><select id="k-hh"><option value="other">生活保護を受けていない</option><option value="seiho">生活保護を受けている</option></select></div>
    <div class="row" id="k-wari-row"><label for="k-wari">保護者全員の住民税の所得割額の合計（円・年）</label><input id="k-wari" type="text" inputmode="numeric" placeholder="例 98000（非課税なら 0）"></div>
    <div class="row"><label for="k-sch">学校</label><select id="k-sch"><option value="shi">私立</option><option value="koku">国公立</option></select></div>
    <div class="row"><label for="k-cou">課程</label><select id="k-cou"><option value="zen">全日制・定時制など</option><option value="tsu">通信制</option></select></div>
    <div class="row"><label for="k-nat">生徒の国籍・在留資格</label><select id="k-nat"><option value="jp">日本国籍・永住者・定住者など（下の①）</option><option value="other">それ以外（下の②）</option></select></div>
    <div class="out" id="k-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">所得割額は、父母など<strong>保護者全員</strong>の「道府県民税の所得割」と「市町村民税の所得割」を足した額です。市区町村の<strong>課税証明書</strong>か、マイナポータルの「わたしの情報」で確かめられます。年収からの見当は下の「年収の目安」へ。</p>

  <h2 id="gaku">${esc(D.nendo)}の給付額（年額）</h2>
  <div class="table-wrap"><table class="fit">
  <caption>全日制・定時制など（円）</caption>
  <thead><tr><th>世帯</th><th class="num">国公立</th><th class="num">私立</th></tr></thead>
  <tbody>
${[S, H, A, B].map(zenRow).join('\n')}
  </tbody></table></div>
  <div class="table-wrap"><table class="fit">
  <caption>通信制（円）</caption>
  <thead><tr><th>世帯</th><th class="num">国公立</th><th class="num">私立</th></tr></thead>
  <tbody>
${[H, A, B].map(tsuRow).join('\n')}
  </tbody></table></div>
  <p class="mini-note">生活保護世帯は、全日制・通信制の区別なく国公立${yen(S.zen.koku)}・私立${yen(S.zen.shi)}です。拡充の2つの区分は、非課税の世帯の額のそれぞれ3分の1・4分の1です。第1子と第2子以降の区別はありません。</p>

  <h2 id="nenshu">年収の目安</h2>
  <p>文部科学省の目安では、所得割が非課税＝<strong>年収約270万円未満</strong>、所得割10万5,500円未満＝<strong>約270〜380万円</strong>、所得割18万2,500円未満＝<strong>約380〜490万円</strong>です。これは${esc(D.nenshuModel)}です。共働きか、子どもの人数や年齢、社会保険料などで所得割額は変わるので、<strong>判定は課税証明書の所得割額で</strong>行ってください。住民税が非課税になる年収の線は、<a href="../../articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で世帯の人数と住所から確かめられます。</p>

  <h2 id="taisho">対象になる生徒</h2>
  <p>高等学校・中等教育学校（後期課程）・高等専門学校（1〜3年）・専修学校の高等課程などに在学する生徒の世帯が対象です。申し込むのは、お住まいの都道府県（または在学する学校）です。国公立か私立かで担当が分かれている県が多くあります。生徒の国籍・在留資格で、対象になる世帯の範囲が違います。</p>
  <ul>
    <li><strong>①</strong> 日本国籍・特別永住者・永住者・日本人の配偶者等・永住者の配偶者等・定住者のうち将来永住する意思があると認められた人・家族滞在のうち日本の小中学校を卒業して高校等を卒業後に日本で就労・定着する意思があると認められた人＝<strong>4つの区分すべて</strong>が対象</li>
    <li><strong>②</strong> それ以外の生徒、外国人学校の生徒＝<strong>生活保護世帯と住民税非課税の世帯だけ</strong>が対象</li>
  </ul>

  <h2 id="moushikomi">申し込み</h2>
  <ul>
    <li><strong>お住まいの都道府県か、在学する学校</strong>に申し込みます。毎年度の申請が必要です。申込みの時期・必要な書類は都道府県で違います。</li>
    <li><strong>新入生</strong>は、4〜6月に一部を早く受け取る申請（早期支給）ができます。</li>
    <li><strong>家計急変</strong>：保護者の失業・病気など、都道府県が定める理由で収入が対象の水準まで減ったときは、年度の途中でも申請できます。7月1日までに申請すれば年額、7月2日以降なら年額を月割りにした額です。</li>
    <li>授業料を支援する<strong>就学支援金とは別の制度</strong>です。それぞれ申し込みます。</li>
  </ul>
  <div class="callout note">
    <p><span class="tag">注意</span>${esc(D.nendo)}の拡充（所得割のある世帯）を含め、<strong>実施の状況と額は都道府県によって異なることがあります</strong>（文部科学省のリーフレットの注記）。下の一覧から、お住まいの都道府県の公式の案内で確かめてください。</p>
  </div>

  <h2 id="ken">都道府県の申込先（公式の案内）</h2>
  <p class="mini-note">文部科学省の「お問合せ先一覧」に載っている、各都道府県の案内のページです（${esc(D.checkedAt)}に取得）。国公立と私立で担当が分かれている県が多くあります。</p>
  <ul class="prefs">
    ${prefList}
  </ul>

  <h2>よくある質問</h2>
  ${FAQ.map(([q, a]) => `<h3>${esc(q)}</h3>\n  <p>${esc(a)}</p>`).join('\n  ')}

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>住民税が非課税になる年収は<a href="../../articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、市区町村ごとの線は<a href="../../hikazei/">住民税非課税の年収（市区町村別）</a>で確かめられます。生活保護を受けている世帯は<a href="../../articles/seikatsuhogo-keisanki.html">生活保護の支給額シミュレーター</a>もどうぞ。</p>
  </div>

  <h2>出典</h2>
  <ul class="sources">
    ${Object.values(SRC).map((s) => `<li>${esc(s.name)} ${s.url}</li>`).join('\n    ')}
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは文部科学省の資料をもとにした国の基準の額です。実際の対象と額、申込みの時期と書類は、お住まいの都道府県の案内で確かめてください。所得割額による判定は目安で、最終的な判断は都道府県が行います。
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p><strong>フクシル</strong>— 知らないと損する、くらしの福祉制度を当事者目線でまとめる情報サイトです。</p>
    <p><a href="../../index.html">トップへ戻る</a> ／ <a href="../../about.html">このサイトについて</a> ／ <a href="../../tokushoho/">特定商取引法に基づく表記</a> ／ <a href="../../kiyaku/">利用規約</a></p>
    <p>© 2026 フクシル. 本サイトの情報は一般的な参考情報であり、正確性を保証するものではありません。</p>
  </div>
</footer>

<script>${JS}</script>
<script src="../../assets/ev.js?v=20261007a" defer></script>
</body>
</html>
`

console.log(`確かめ：拡充の額＝非課税の額×1/3・1/4（10円単位）と一致・都道府県の窓口47／私立・全日制 非課税 ${yen(H.zen.shi)}・10万5,500円未満 ${yen(A.zen.shi)}・18万2,500円未満 ${yen(B.zen.shi)}`)
if (DRY) process.exit(0)

// 中身が同じなら書き直さない（lastmod を進めない）。改行コードの違いは変更と数えない
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/, '')
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
const changed = !prev || strip(prev) !== strip(html)
if (changed) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, html) }
const SM = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(SM, 'utf8')
const line = `  <url><loc>${URL}</loc><lastmod>${TODAY}</lastmod><priority>0.8</priority></url>`
const re = new RegExp(`  <url><loc>${URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc><lastmod>[^<]+</lastmod>[^\\n]*</url>`)
if (!re.test(sm)) { sm = sm.replace('</urlset>', `${line}\n</urlset>`); fs.writeFileSync(SM, sm); console.log('sitemap に1行足した') }
else if (changed) { sm = sm.replace(re, line); fs.writeFileSync(SM, sm); console.log('sitemap の lastmod を進めた') }
console.log(`${changed ? '書いた' : '変わらず'}: ${OUT}（${(html.length / 1024).toFixed(1)}KB）`)
