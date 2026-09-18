// ─────────────────────────────────────────────────────────────────────────────
// hogo-shinsei-build.mjs — 「生活保護の申請は、どこで何割が却下されているか」の面を作る。
//   node scripts/hogo-shinsei-build.mjs        → articles/seikatsuhogo-shinsei-jichitai.html
//   node scripts/hogo-shinsei-build.mjs --dry  → 書かずに主な数字だけ出す
//
// 前に回すもの: node scripts/hogo-shinsei-fetch.mjs → python scripts/hogo-shinsei-parse.py
//
// ★このページで言ってよいこと・言ってはいけないこと（ここを外すと嘘になる）
//   言ってよい：却下率（＝却下件数÷申請件数）は自治体で1.7%〜23.4%と14倍ひらいている。
//               全国の却下率は2019年度6.73%から2024年度8.28%まで6年連続で上がっている。
//   言ってはいけない：「却下率が低い自治体は審査が甘い」。
//     ①申請までたどり着けなかった人は分母に入らない。窓口で引き取らせていれば却下率は下がる。
//     ②申請者の顔ぶれが違えば却下率も変わる（資産や収入のある人の申請が多ければ上がる）。
//     ③実測: 人口千人あたりの申請件数と却下率の相関は **−0.15 しかない**（ほぼ無関係）。
//        つまり「申請が起きやすいか」と「出した申請が通るか」は別の軸。
//        だから2つを必ず同じ画面に並べ、片方から他方を推測しないよう書く。
//
// ★数字の但し書き（表に必ず添える）
//   ・都道府県の行に指定都市・中核市は入っていない。「秋田県（秋田市を除く）」と書く。
//   ・年度累計。未処理件数だけは年度末時点の残。
//   ・人口は保護率からの逆算なので0.5%ほどの丸め誤差がある。順位争いには使わない。
//   ・申請が少ない機関は率が跳ねるので、ランキングは年300件以上に絞る。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'data', 'hogo-shinsei.json')
const OUT = path.join(ROOT, 'articles', 'seikatsuhogo-shinsei-jichitai.html')
const DRY = process.argv.includes('--dry')
const MIN_N = 300 // ランキングに載せる最低の年間申請件数

const D = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const Y = D.latest_year
// 2019年度は「令和1年度」ではなく「令和元年度」。厚労省の表題もこの年だけ「2019年度」表記。
const WAREKI = (y) => (y - 2018 === 1 ? '令和元年度' : `令和${y - 2018}年度`)
const num = (n) => Number(n).toLocaleString('ja-JP')
const p1 = (x) => (Math.round(x * 10) / 10).toFixed(1)
const p2 = (x) => (Math.round(x * 100) / 100).toFixed(2)
// ★toISOString() はUTC。日本時間の朝は前日の日付になる。JSTに直す。
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

// ---- 指標をつける ----
const rows = D.rows.map((r) => ({
  ...r,
  kr: (r.kyakka / r.shinsei) * 100, // 却下率
  tr: (r.torisage / r.shinsei) * 100, // 取下げ率
  sp: r.jinko ? (r.shinsei / r.jinko) * 1000 : null, // 人口千人あたり申請件数
}))
const N = D.national
const nkr = (N.kyakka / N.shinsei) * 100
const ntr = (N.torisage / N.shinsei) * 100

const big = rows.filter((r) => r.shinsei >= MIN_N && r.sp != null)
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const medSp = median(big.map((r) => r.sp))
const medKr = median(big.map((r) => r.kr))
const krLo = [...big].sort((a, b) => a.kr - b.kr)
const krHi = [...big].sort((a, b) => b.kr - a.kr)
const trHi = [...big].sort((a, b) => b.tr - a.tr)
const HABA = p1(krHi[0].kr / krLo[0].kr)

// 相関（ピアソン）。本文に実数で書くので、ここで出した値をそのまま載せる。
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let n = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return n / Math.sqrt(da * db)
}
const rSpKr = corr(big.map((r) => r.sp), big.map((r) => r.kr))
const R_TXT = rSpKr.toFixed(2)

// 4象限（中央値で割るだけ）。3=申請多×却下低 … 0=申請少×却下高
const quad = (r) => (r.sp >= medSp ? 2 : 0) + (r.kr < medKr ? 1 : 0)
const qCount = [0, 0, 0, 0]
for (const r of big) qCount[quad(r)]++
// 各象限の代表例は、申請件数の多い順に3つ拾う（恣意的に選ばない）
const qSample = (i) =>
  big.filter((r) => quad(r) === i).sort((a, b) => b.shinsei - a.shinsei).slice(0, 3).map((r) => r.name).join('・')
const medKrLo = median(big.filter((r) => r.sp < medSp).map((r) => r.kr))
const medKrHi = median(big.filter((r) => r.sp >= medSp).map((r) => r.kr))

// 全国の推移
const hist = D.years.map((y) => {
  const h = N.hist[String(y)]
  return { y, ...h, kr: (h.kyakka / h.shinsei) * 100, tr: (h.torisage / h.shinsei) * 100 }
})
const h0 = hist[0]
const h1 = hist[hist.length - 1]

// 表の1行（都道府県は別掲されている市を明示する）
const label = (r) => {
  if (r.level !== '都道府県' || !r.excluded?.length) return r.name
  const all = r.excluded.join('・')
  const short = r.excluded.length <= 4 ? `${all}を除く` : `${r.excluded.length}市を除く`
  return `${r.name}<small title="${all}を除く">（${short}）</small>`
}

const rankRows = (list, key) =>
  list
    .map(
      (r, i) =>
        `      <tr><td>${i + 1}</td><th>${label(r)}</th><td>${r.level}</td>` +
        `<td class="n">${num(r.shinsei)}</td><td class="n big">${p1(r[key])}%</td>` +
        `<td class="n">${p2(r.sp)}</td><td class="n">${p1(r.hogo_ritsu)}</td></tr>`,
    )
    .join('\n')

if (DRY) {
  console.log(`${WAREKI(Y)}  申請${num(N.shinsei)}件 / 却下${num(N.kyakka)}件(${p2(nkr)}%) / 取下げ${num(N.torisage)}件(${p2(ntr)}%)`)
  console.log(`却下率の幅 ${p1(krLo[0].kr)}%（${krLo[0].name}）〜 ${p1(krHi[0].kr)}%（${krHi[0].name}）＝${HABA}倍`)
  console.log(`却下率 ${WAREKI(h0.y)} ${p2(h0.kr)}% → ${WAREKI(h1.y)} ${p2(h1.kr)}%`)
  console.log(`相関(人口千対申請, 却下率) = ${R_TXT} / 中央値 申請${p2(medSp)} 却下率${p2(medKr)}%`)
  console.log(`四象限 申請多×却下低 ${qCount[3]}(${qSample(3)}) / 申請多×却下高 ${qCount[2]}(${qSample(2)})`)
  console.log(`       申請少×却下低 ${qCount[1]}(${qSample(1)}) / 申請少×却下高 ${qCount[0]}(${qSample(0)})`)
  process.exit(0)
}

// ブラウザに渡すデータ（表の並べ替え・絞り込みに使う）
const payload = JSON.stringify({
  y: Y,
  rows: rows.map((r) => ({
    n: r.name,
    lv: r.level,
    ex: r.excluded?.length ? r.excluded : null,
    pf: r.pref || null,
    s: r.shinsei,
    k: r.kyakka,
    t: r.torisage,
    o: r.kaishi_setai,
    m: r.mishori,
    j: r.jinko,
    hr: r.hogo_ritsu,
  })),
})

const CSS = `
.stat-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 1em 0; }
.stat { flex: 1 1 150px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--soft); }
.stat b { display: block; font-size: 1.5rem; font-weight: 800; color: var(--brand-dark); font-variant-numeric: tabular-nums; }
.stat span { font-size: .82rem; color: var(--sub); }
.tbl-ctl { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: .8em 0 .4em; }
.tbl-ctl input, .tbl-ctl select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font-size: 1rem; max-width: 100%; }
#jt, .rank-table, #trend { width: 100%; border-collapse: collapse; font-size: .9rem; }
/* 既定の min-width:520px は9列の表には狭すぎて、320px幅で数字が潰れる。
   ★ただし本文の幅は --maxw:760px（内側は726px）しかない。780pxにすると
     右端の「未処理」列がちょうど枠の外に出て、机上では気づけない（実際に隠れた）。
     本文に収まる700pxにして、狭い画面でだけ横スクロールさせる。 */
#jt { min-width: 700px; }
.rank-table { min-width: 620px; }
#trend { min-width: 560px; }
#jt th, #jt td, .rank-table th, .rank-table td, #trend th, #trend td { border-bottom: 1px solid var(--line); padding: 6px 7px; }
/* 9列ある表なので、既定の padding だと横910pxに収まらず右端の列が隠れる。 */
#jt { font-size: .85rem; }
#jt th, #jt td { padding: 5px 6px; }
/* 自治体名の列が広がると右端の「未処理」が枠からはみ出す。名前だけ折り返しを許して幅を抑える。 */
#jt tbody th, #jt thead th:first-child { white-space: normal; width: 128px; }
#jt tbody td:first-of-type { white-space: nowrap; }  /* 種別＝「都道府県」を2行に割らない */
/* 129行をそのまま流すと縦21,000pxになり、下の章まで誰も辿り着かない。
   枠の中でスクロールさせる。見出しは枠に対して sticky なので固定されたまま残る。 */
#jt-wrap { max-height: 72vh; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
/* ★共通CSSの thead th は 濃い地に白文字。ここで背景だけ薄い色に変えると
   文字が白のまま残って読めなくなる（実際に真っ白で出た）。地の色は共通のまま使う。 */
#jt thead th { position: sticky; top: 0; z-index: 1; background: var(--brand); color: #fff; cursor: pointer; white-space: nowrap; font-size: .82rem; line-height: 1.35; }
#jt caption { caption-side: top; text-align: left; padding: 8px 7px; font-size: .84rem; color: var(--sub); }
#jt thead th.sorted::after { content: " \\25BC"; font-size: .7em; }
#jt thead th.sorted.asc::after { content: " \\25B2"; }
#jt tbody td { white-space: nowrap; }
#jt td.n, #jt th.n, .rank-table td.n, .rank-table th.n, #trend td.n, #trend th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#jt td.big, .rank-table td.big { font-weight: 800; }
#jt tbody th, .rank-table tbody th { text-align: left; font-weight: 600; }
#jt tbody th small, .rank-table tbody th small { font-weight: 400; color: var(--sub); display: block; font-size: .76rem; }
.quad { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; margin: 1em 0; }
.quad div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: .88rem; }
.quad div b { display: block; margin-bottom: 4px; }
.mini-note { font-size: .84rem; color: var(--sub); }
`

const JS = `
var D = ${payload};
(function () {
  var rows = D.rows.map(function (r) {
    r.kr = r.k / r.s * 100;
    r.tr = r.t / r.s * 100;
    r.sp = r.j ? r.s / r.j * 1000 : null;
    return r;
  });
  var tb = document.getElementById('jtb');
  var q = document.getElementById('q');
  var lv = document.getElementById('lv');
  var cnt = document.getElementById('cnt');
  var ths = document.querySelectorAll('#jt thead th');
  var sortKey = 'kr', sortAsc = false;

  // 大阪府は9市が別掲されている。全部並べると1行が9行ぶんの高さになるので、
  // 3市を超えたら件数にまとめ、全部は title（マウスを載せると出る）に入れる。
  function nm(r) {
    if (r.lv !== '都道府県' || !r.ex) return r.n;
    var t = r.ex.join('・');
    var label = r.ex.length <= 3 ? t + 'を除く' : r.ex.length + '市を除く';
    return r.n + '<small title="' + t + 'を除く">' + label + '</small>';
  }
  function fx(v, d) { return v == null ? '—' : v.toFixed(d); }
  function ja(n) { return Number(n).toLocaleString('ja-JP'); }

  function draw() {
    var kw = q.value.trim();
    var k = lv.value;
    var list = rows.filter(function (r) {
      if (k && r.lv !== k) return false;
      if (kw && r.n.indexOf(kw) < 0 && !(r.pf && r.pf.indexOf(kw) >= 0)) return false;
      return true;
    });
    list.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return sortAsc ? x.localeCompare(y, 'ja') : y.localeCompare(x, 'ja');
      if (x == null) return 1;
      if (y == null) return -1;
      return sortAsc ? x - y : y - x;
    });
    tb.innerHTML = list.map(function (r) {
      return '<tr><th>' + nm(r) + '</th><td>' + r.lv + '</td>'
        + '<td class="n">' + ja(r.s) + '</td>'
        + '<td class="n big">' + fx(r.kr, 1) + '%</td>'
        + '<td class="n">' + fx(r.tr, 1) + '%</td>'
        + '<td class="n">' + ja(r.o) + '</td>'
        + '<td class="n">' + fx(r.sp, 2) + '</td>'
        + '<td class="n">' + fx(r.hr, 1) + '</td>'
        + '<td class="n">' + ja(r.m) + '</td></tr>';
    }).join('');
    cnt.textContent = list.length + ' / ' + rows.length + ' 機関';
  }

  Array.prototype.forEach.call(ths, function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) sortAsc = !sortAsc;
      else { sortKey = k; sortAsc = (k === 'n' || k === 'lv'); }
      Array.prototype.forEach.call(ths, function (o) { o.className = o.className.replace(/(^|\\s)(sorted|asc)/g, ''); });
      th.className = (th.className + ' sorted' + (sortAsc ? ' asc' : '')).trim();
      draw();
    });
  });
  q.addEventListener('input', draw);
  lv.addEventListener('change', draw);
  draw();
})();
`

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>生活保護の却下率、自治体でこれだけ違う【${rows.length}機関・${WAREKI(Y)}】｜フクシル</title>
<meta name="description" content="生活保護の申請が何件出され、何件が却下されたかを、厚生労働省の被保護者調査から都道府県・指定都市・中核市の${rows.length}機関ぶん並べました。${WAREKI(Y)}の却下率は全国${p2(nkr)}%ですが、自治体では${p1(krLo[0].kr)}%から${p1(krHi[0].kr)}%まで約${HABA}倍ひらいています。申請の起きやすさ（人口千人あたり申請件数）と並べて見られる、並べ替え可能な表つき。">
<link rel="canonical" href="https://fukushiru.com/articles/seikatsuhogo-shinsei-jichitai.html">
<meta property="og:type" content="article">
<meta property="og:title" content="生活保護の却下率、自治体でこれだけ違う【${rows.length}機関・${WAREKI(Y)}】">
<meta property="og:description" content="却下率は全国${p2(nkr)}%。自治体では${p1(krLo[0].kr)}%〜${p1(krHi[0].kr)}%と約${HABA}倍の差。厚労省の被保護者調査を${rows.length}機関ぶん、並べ替えできる表にしました。">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="https://fukushiru.com/articles/seikatsuhogo-shinsei-jichitai.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css?v=20260908a">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "生活保護の却下率、自治体でこれだけ違う【${rows.length}機関・${WAREKI(Y)}】",
  "description": "厚生労働省「被保護者調査」第18表から、生活保護の申請件数・取下げ件数・却下件数を都道府県・指定都市・中核市の${rows.length}機関ぶん集計し、却下率と人口千人あたり申請件数を並べた。",
  "inLanguage": "ja",
  "datePublished": "${TODAY}",
  "dateModified": "${TODAY}",
  "author": { "@type": "Organization", "name": "フクシル" },
  "publisher": { "@type": "Organization", "name": "フクシル" },
  "url": "https://fukushiru.com/articles/seikatsuhogo-shinsei-jichitai.html",
  "mainEntityOfPage": "https://fukushiru.com/articles/seikatsuhogo-shinsei-jichitai.html",
  "isPartOf": { "@type": "WebSite", "name": "フクシル", "url": "https://fukushiru.com/" }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "生活保護の申請は何割くらい却下されますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "${WAREKI(Y)}は全国で${num(N.shinsei)}件の申請があり、${num(N.kyakka)}件（${p2(nkr)}%）が却下されました。ほかに${num(N.torisage)}件（${p2(ntr)}%）が取り下げられています。残りのおおむね9割弱は保護の開始に至っています。" }
    },
    {
      "@type": "Question",
      "name": "生活保護が通りやすい自治体はありますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "却下率には自治体差があり、${WAREKI(Y)}で年${MIN_N}件以上の申請がある機関では${p1(krLo[0].kr)}%（${krLo[0].name}）から${p1(krHi[0].kr)}%（${krHi[0].name}）まで約${HABA}倍ひらいています。ただし却下率が低いことは審査が甘いことを意味しません。申請までたどり着けなかった人は分母に入らないためです。人口千人あたりの申請件数と却下率の相関は${R_TXT}しかなく、ほぼ別々の指標として見る必要があります。" }
    },
    {
      "@type": "Question",
      "name": "生活保護の却下率は年々上がっていますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "上がっています。全国の却下率は${WAREKI(h0.y)}の${p2(h0.kr)}%から${WAREKI(h1.y)}の${p2(h1.kr)}%まで上昇しました。同じ期間に申請件数も${num(h0.shinsei)}件から${num(h1.shinsei)}件へ増えています。" }
    },
    {
      "@type": "Question",
      "name": "生活保護の申請が却下されたらどうすればいいですか？",
      "acceptedAnswer": { "@type": "Answer", "text": "却下の通知書を受け取った日の翌日から3か月以内に、都道府県知事あてに審査請求ができます（生活保護法第64条・行政不服審査法）。また、審査請求とは別に、事情が変われば再申請はいつでもできます。申請権に回数制限はありません。" }
    }
  ]
}
</script>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="../index.html">フクシル <small>知らないと損する、くらしの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="../index.html">トップ</a>
      <a href="seikatsuhogo-keisanki.html">生活保護の計算機</a>
      <a href="juminzei-hikazei-check.html">住民税非課税</a>
      <a href="kougaku-ryouyouhi-2026.html">高額療養費</a>
      <a href="koei-jutaku-bairitsu.html">公営住宅</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 生活保護 ＞ 自治体別の却下率</p>

  <h1>生活保護の申請は、<br>どこで何割が却下されているか</h1>
  <p class="updated">最終更新：${TODAY} ／ 厚生労働省「被保護者調査（月次調査・確定値）」第18表・第9表（${WAREKI(Y)}）を集計。都道府県・指定都市・中核市の${rows.length}機関</p>

  <p class="lead">生活保護は国の制度で、基準も全国同じです。それでも<strong>申請が却下される割合は自治体でまるで違います</strong>。${WAREKI(Y)}の全国平均は<strong>${p2(nkr)}%</strong>ですが、年${MIN_N}件以上の申請がある機関で見ると<strong>${p1(krLo[0].kr)}%から${p1(krHi[0].kr)}%まで約${HABA}倍</strong>の開きがあります。この数字は厚生労働省が毎年公表しているのに、<strong>自治体ごとに並べた表はどこにも出ていません</strong>。だから作りました。</p>

  <div class="stat-row">
    <div class="stat"><b>${num(N.shinsei)}件</b><span>${WAREKI(Y)}の申請件数（全国）</span></div>
    <div class="stat"><b>${p2(nkr)}%</b><span>却下（${num(N.kyakka)}件）</span></div>
    <div class="stat"><b>${p2(ntr)}%</b><span>取下げ（${num(N.torisage)}件）</span></div>
    <div class="stat"><b>${num(N.kaishi_setai)}世帯</b><span>保護開始</span></div>
  </div>

  <div class="callout warn">
    <p><span class="tag">先に読んでください</span><strong>「却下率が低い＝審査が甘い」ではありません。</strong>却下率の分母は<strong>申請までたどり着いた人</strong>だけです。窓口で申請書を渡さずに帰した場合、その人は分母にも分子にも入らないので、<strong>却下率はかえって下がります</strong>。逆に、申請を広く受け付けている自治体では、通らない見込みの申請も受理されるぶん却下率は上がります。</p>
    <p>だからこのページは、却下率と一緒に<strong>「人口千人あたり何件の申請が起きているか」</strong>を必ず並べています。実測すると、この2つの相関は<strong>${R_TXT}</strong>しかありません（ほぼ無関係）。<strong>片方から、もう片方を推測することはできません。</strong></p>
  </div>

  <h2>① 全国の却下率は6年上がり続けている</h2>
  <p>申請そのものも増えていますが、却下はそれ以上のペースで増えています。取下げは逆に減っています。</p>
  <div class="table-wrap">
  <table id="trend">
    <caption>全国の申請・取下げ・却下（被保護者調査 第18表・年度累計）</caption>
    <thead><tr><th>年度</th><th class="n">申請件数</th><th class="n">取下げ</th><th class="n">取下げ率</th><th class="n">却下</th><th class="n">却下率</th></tr></thead>
    <tbody>
${hist.map((h) => `      <tr><th>${WAREKI(h.y)}（${h.y}）</th><td class="n">${num(h.shinsei)}</td><td class="n">${num(h.torisage)}</td><td class="n">${p2(h.tr)}%</td><td class="n">${num(h.kyakka)}</td><td class="n"><strong>${p2(h.kr)}%</strong></td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p class="mini-note">${WAREKI(h0.y)}から${WAREKI(h1.y)}で、申請は${num(h0.shinsei)}件→${num(h1.shinsei)}件（${p1(((h1.shinsei / h0.shinsei) - 1) * 100)}%増）、却下率は${p2(h0.kr)}%→${p2(h1.kr)}%。取下げ率は${p2(h0.tr)}%→${p2(h1.tr)}%と下がりました。</p>

  <h2>② ${rows.length}機関の全表（並べ替え・絞り込みできます）</h2>
  <p>見出しを押すと並べ替わります。お住まいの自治体名を入れて探せます。<strong>都道府県の行には、その県にある指定都市・中核市は入っていません</strong>（それぞれ別の行として載っています）。たとえば「秋田県」の行は秋田市を除いた秋田県です。</p>
  <div class="tbl-ctl">
    <input id="q" type="search" placeholder="自治体名でしぼる" aria-label="自治体名でしぼる">
    <select id="lv" aria-label="種別でしぼる">
      <option value="">すべての種別</option>
      <option value="都道府県">都道府県（政令市・中核市を除く）</option>
      <option value="指定都市">指定都市</option>
      <option value="中核市">中核市</option>
    </select>
    <span class="mini-note" id="cnt"></span>
  </div>
  <div id="jt-wrap">
  <table id="jt">
    <caption>${WAREKI(Y)}　生活保護の申請・取下げ・却下（厚労省 被保護者調査 第18表）</caption>
    <thead><tr>
      <th data-k="n">自治体</th>
      <th data-k="lv">種別</th>
      <th data-k="s" class="n">申請<br>件数</th>
      <th data-k="kr" class="n">却下率</th>
      <th data-k="tr" class="n">取下げ率</th>
      <th data-k="o" class="n">開始<br>世帯数</th>
      <th data-k="sp" class="n">申請<br>千対</th>
      <th data-k="hr" class="n">保護率<br>千対</th>
      <th data-k="m" class="n">未処理<br>年度末</th>
    </tr></thead>
    <tbody id="jtb"></tbody>
  </table>
  </div>
  <p class="mini-note">表は枠の中でスクロールします（${rows.length}行）。</p>
  <p class="mini-note">「申請（人口千対）」は、その自治体の人口1,000人あたり年に何件の申請が起きたか。人口は保護率からの逆算なので0.5%ほどの誤差を含みます。「年度末未処理」は年度をまたいで審査中だった件数です。</p>

  <h2>③ 却下率が高い自治体・低い自治体</h2>
  <p>年${MIN_N}件以上の申請がある${big.length}機関にしぼっています（件数が少ないと率が跳ねるため）。</p>
  <h3>却下率が高い15機関</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">申請件数</th><th class="n">却下率</th><th class="n">申請(人口千対)</th><th class="n">保護率</th></tr></thead>
    <tbody>
${rankRows(krHi.slice(0, 15), 'kr')}
    </tbody>
  </table>
  </div>
  <h3>却下率が低い15機関</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">申請件数</th><th class="n">却下率</th><th class="n">申請(人口千対)</th><th class="n">保護率</th></tr></thead>
    <tbody>
${rankRows(krLo.slice(0, 15), 'kr')}
    </tbody>
  </table>
  </div>

  <h2>④ 「取り下げ」も見ておく</h2>
  <p>申請を出したあとに取り下げた件数です。全国では申請の${p2(ntr)}%。他の制度が使えることになった、転居した、といった理由もありますが、<strong>取下げは福祉事務所の側から促すこともできる</strong>手続きです。ここが高い機関は、却下率だけを見ると実態より穏やかに見えます。</p>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">申請件数</th><th class="n">取下げ率</th><th class="n">申請(人口千対)</th><th class="n">保護率</th></tr></thead>
    <tbody>
${rankRows(trHi.slice(0, 12), 'tr')}
    </tbody>
  </table>
  </div>

  <h2>⑤ 2つの軸で置くと、4つの型に分かれる</h2>
  <p>横軸に「申請の起きやすさ（人口千対${p2(medSp)}件が中央値）」、縦軸に「却下率（中央値${p2(medKr)}%）」を取ると、${big.length}機関は4つに分かれます。<strong>どれが良い・悪いと決められるものではありません</strong>が、自分の住む街がどこにいるかは知っておいて損がありません。かっこ内は各型で申請件数が多い順の3機関です。</p>
  <div class="quad">
    <div><b>申請が多く、却下は少ない（${qCount[3]}機関）</b>${qSample(3)} など。生活保護が身近で、出せば通っている。</div>
    <div><b>申請が多く、却下も多い（${qCount[2]}機関）</b>${qSample(2)} など。窓口には来られているが、通らない申請も多い。</div>
    <div><b>申請が少なく、却下も少ない（${qCount[1]}機関）</b>${qSample(1)} など。そもそも申請が起きていないが、出たものは通っている。</div>
    <div><b>申請が少なく、却下は多い（${qCount[0]}機関）</b>${qSample(0)} など。二重に狭い門になっている。</div>
  </div>
  <p class="mini-note">中央値で割っただけの分類です。申請が少ない側の却下率の中央値は${p1(medKrLo)}%、多い側は${p1(medKrHi)}%。差はありますが相関は${R_TXT}と弱く、「申請が少ない地域は必ず却下も多い」とは言えません。</p>

  <h2>⑥ 却下されたときにできること</h2>
  <ul>
    <li><strong>審査請求</strong>：却下の通知書を受け取った日の翌日から<strong>3か月以内</strong>に、<strong>都道府県知事あて</strong>に審査請求ができます（生活保護法第64条・行政不服審査法第18条）。市・区の福祉事務所が出した却下でも、宛先は市ではなく<strong>その上の都道府県</strong>です（政令市・中核市の処分も同じ）。書式は自由で、費用はかかりません。</li>
    <li><strong>再申請はいつでもできる</strong>：申請権に回数制限はありません。収入が減った・貯金が尽きた・病気になったなど<strong>事情が変われば、何度でも出せます</strong>。</li>
    <li><strong>通知書をもらう</strong>：却下は必ず<strong>書面</strong>で通知されます。口頭で「無理です」と言われただけなら、それは却下処分ではありません。申請書を出し、書面で結果を受け取るところまでが手続きです。</li>
    <li><strong>決定の期限</strong>：申請から原則<strong>14日以内</strong>（調査に時間がかかる場合は最長30日）に通知が来ます。この表の「年度末未処理」は、年度をまたいで審査中だった件数です。</li>
    <li><strong>ひとりで行かない</strong>：お住まいの地域の生活困窮者自立支援の相談窓口、法テラス、支援団体に同行を頼めます。</li>
  </ul>

  <h2>⑦ この数字の限界（大事なところ）</h2>
  <ul>
    <li><strong>申請に至らなかった相談は数字に出ません。</strong>この表にあるのは「申請書が受理された件数」です。窓口での相談件数は被保護者調査では公表されていません。</li>
    <li><strong>申請者の顔ぶれの違いが入ります。</strong>資産や収入のある人の申請が多ければ、審査の姿勢が同じでも却下率は上がります。</li>
    <li><strong>都道府県の行に指定都市・中核市は含まれません。</strong>県まるごとの数字ではありません。表では「○○を除く」と書いています。</li>
    <li><strong>年度累計です。</strong>申請した月と結果が出た月がずれるため、「申請件数＝却下＋取下げ＋開始」にはぴったり一致しません。</li>
    <li><strong>保護開始には申請によらないものが混ざりえます。</strong>だから開始÷申請を主役の指標にしていません。</li>
    <li><strong>人口は保護率からの逆算です。</strong>保護率は小数第1位までの公表なので、人口千対の値は0.5%ほどの誤差を含みます。僅差の順位に意味はありません。</li>
  </ul>

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>実際にいくら受け取れるかは<a href="seikatsuhogo-keisanki.html">生活保護の支給額シミュレーター</a>で。家賃を下げて立て直すなら<a href="koei-jutaku-bairitsu.html">公営住宅の倍率データ</a>と<a href="koei-hairiyasui.html">入りやすい人の条件</a>、生活保護までは必要ない方は<a href="juminzei-hikazei-check.html">住民税非課税の判定</a>と<a href="kougaku-ryouyouhi-2026.html">高額療養費の計算機</a>もどうぞ。</p>
  </div>

  <h2>コメント（自治体ごとの運用の情報交換）</h2>
  <p class="mini-note">申請時の体験や、お住まいの自治体の窓口の様子を共有いただけると、同じ立場の方の助けになります。個人が特定される情報はお書きにならないでください。</p>
  <div id="cusdis_thread"
    data-host="https://cusdis.com"
    data-app-id="14dfe8f8-c660-42ee-9cd2-54ee31828ba9"
    data-page-id="seikatsuhogo-shinsei-jichitai"
    data-page-url="https://fukushiru.com/articles/seikatsuhogo-shinsei-jichitai.html"
    data-page-title="生活保護の申請・却下率 自治体別">
  </div>
  <script async defer src="https://cusdis.com/js/cusdis.es.js"></script>

  <h2>出典</h2>
  <ul class="sources">
    <li>厚生労働省「被保護者調査（月次調査・確定値）」第18表 保護の申請、取下げ、却下、未処理件数、保護開始世帯数…，都道府県－指定都市－中核市×市部－郡部別（${WAREKI(D.years[0])}〜${WAREKI(Y)}） https://www.mhlw.go.jp/toukei/list/74-16b.html</li>
    <li>厚生労働省「被保護者調査（月次調査・確定値）」第9表 被保護実人員数及び保護率（人口千対），都道府県－指定都市－中核市×月・１か月平均別（${WAREKI(Y)}）</li>
    <li>総務省「全国地方公共団体コード」（市がどの都道府県にあるかの対応に使用） https://www.soumu.go.jp/denshijiti/code.html</li>
    <li>厚生労働省「生活保護制度」 https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/seikatsuhogo/seikatuhogo/index.html</li>
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは厚生労働省が公表している集計値をそのまま並べ、割合を計算したものです。<strong>特定の自治体の審査の当否を評価するものではありません。</strong>却下率は申請者の事情や地域の状況によっても変わり、数字だけで「厳しい」「甘い」と判断することはできません。受給の可否は必ずお住まいの福祉事務所にご確認ください。数字の誤りにお気づきの場合は <a href="../about.html">このサイトについて</a> の連絡先までお知らせください。
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p><strong>フクシル</strong>— 知らないと損する、くらしの福祉制度を当事者目線でまとめる情報サイトです。</p>
    <p><a href="../index.html">トップへ戻る</a> ／ <a href="../about.html">このサイトについて</a> ／ <a href="../tokushoho/">特定商取引法に基づく表記</a> ／ <a href="../kiyaku/">利用規約</a></p>
    <p>© 2026 フクシル. 本サイトの情報は一般的な参考情報であり、正確性を保証するものではありません。</p>
  </div>
</footer>

<script>${JS}</script>
</body>
</html>
`

fs.writeFileSync(OUT, html)
console.log(`書いた: ${OUT}  (${(html.length / 1024).toFixed(1)}KB / ${rows.length}機関)`)
