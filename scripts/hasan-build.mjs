// ─────────────────────────────────────────────────────────────────────────────
// hasan-build.mjs — 「自己破産が多い県は、弁護士が多い県ではなかった」の面を作る。
//   node scripts/hasan-build.mjs        → articles/jiko-hasan-chizu.html
//   node scripts/hasan-build.mjs --dry  → 書かずに主な数字だけ出す
//
// 前に回すもの: node scripts/hasan-fetch.mjs → python scripts/hasan-parse.py
//
// ★このページの成り立ち（ここを外すと記事が嘘になる）
//   出発点の仮説は「破産が多い県＝相談できる人が近くにいる県」だった。**実データで否定された。**
//     破産率 vs 生活保護率   r=+0.64  ← いちばん効く
//     破産率 vs 弁護士密度   r=+0.28
//     生活保護率をそろえると 弁護士密度は r=+0.12 まで落ちる（偏相関）
//   だから書くのは「破産の地図は、困窮の地図とかなり重なる。弁護士の多さでは説明できない」。
//   **否定された仮説を、否定されたまま載せる。**これがこのサイトのやり方。
//
//   そのうえで、困窮度とまったく関係しない軸が1つ見つかった＝**破産か再生かの選ばれ方**。
//     再生シェア vs 生活保護率 r=-0.62（収入が残っている地域ほど再生が選ばれる）
//     再生シェア vs 弁護士密度 r=-0.51 だが、弁護士密度と保護率が r=+0.29 で絡むので
//     **弁護士のせいだとは書かない**。
//
// ★言ってはいけないこと
//   ①「◯県は破産が多いから生活が苦しい」。破産件数には**法人が含まれる**
//     （全国では自然人が90.4%だが、地裁別の内訳は公表されていない）。
//   ②「弁護士が少ないから破産できない」。偏相関 r=+0.12 で、そうは言えない。
//   ③「再生のほうが得」。再生は継続的な収入が要る制度で、誰でも選べるものではない。
//   ④年は**暦年**。生活保護・困窮者支援の「年度」と同じ列に並べない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'data', 'hasan.json')
const OUT = path.join(ROOT, 'articles', 'jiko-hasan-chizu.html')
const DRY = process.argv.includes('--dry')

const D = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const Y = D.latest_year
const num = (n) => Number(n).toLocaleString('ja-JP')
const p1 = (x) => (Math.round(x * 10) / 10).toFixed(1)
const p2 = (x) => (Math.round(x * 100) / 100).toFixed(2)
const rr = (x) => (x >= 0 ? '＋' : '−') + Math.abs(x).toFixed(2)
// ★toISOString() はUTC。日本時間の朝は前日になる。JSTに直す。
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

const rows = D.rows.map((r) => {
  const saisei = r.saisei + r.kyuyo
  return {
    ...r, saiseiAll: saisei,
    hr: r.hasan / r.pop * 100000,          // 破産（人口10万対）
    sr: saisei / r.pop * 100000,           // 個人再生（人口10万対）
    br: r.bengoshi / r.pop * 100000,       // 弁護士（人口10万対）
    gr: r.hogo_nin / r.pop * 1000,         // 生活保護率（千対）
    sh: saisei / (r.hasan + saisei) * 100, // 破産＋再生のうち再生を選んだ割合
  }
})
const C = D.corr
const NAT = D.years.map((y) => ({ y, ...D.national[String(y)] }))
const n0 = NAT[0]
const n1 = NAT[NAT.length - 1]
const SHIZEN = n1.shizen // 最新年の自然人の内訳（無い年もある）

const byHr = [...rows].sort((a, b) => b.hr - a.hr)
const bySh = [...rows].sort((a, b) => b.sh - a.sh)
const byBr = [...rows].sort((a, b) => b.br - a.br)
const tokyo = rows.find((r) => r.pref === '東京都')
const tokyoRank = byHr.findIndex((r) => r.pref === '東京都') + 1
const natSh = (n1.saisei + n1.kyuyo) / (n1.hasan + n1.saisei + n1.kyuyo) * 100

if (DRY) {
  console.log(`最新 ${Y}年 / 年 ${D.years.join(',')} / 弁護士 ${D.bar_asof}現在 ${num(D.bar_total)}人`)
  console.log(`全国 破産 ${num(n0.hasan)}(${n0.y}) → ${num(n1.hasan)}(${n1.y})  ${p1((n1.hasan / n0.hasan - 1) * 100)}%増`)
  if (SHIZEN) console.log(`  うち自然人 ${num(SHIZEN.shizen)}（${p1(SHIZEN.shizen / SHIZEN.sou * 100)}%）`)
  console.log(`破産率 ${p1(byHr[byHr.length - 1].hr)}(${byHr[byHr.length - 1].pref}) 〜 ${p1(byHr[0].hr)}(${byHr[0].pref}) ${p2(byHr[0].hr / byHr[byHr.length - 1].hr)}倍`)
  console.log(`東京都は破産率 ${p1(tokyo.hr)}（47中${tokyoRank}位）／弁護士密度 ${p1(tokyo.br)}（1位・最下位${byBr[46].pref}の${p1(tokyo.br / byBr[46].br)}倍）`)
  console.log(`再生シェア 全国${p1(natSh)}%  ${p1(bySh[0].sh)}%(${bySh[0].pref}) 〜 ${p1(bySh[46].sh)}%(${bySh[46].pref})`)
  console.log('相関 ' + Object.entries(C).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' / '))
  console.log(`警告 ${(D.warnings || []).length}件`)
  process.exit(0)
}

const payload = JSON.stringify(rows.map((r) => ({
  n: r.pref, p: r.pop, h: r.hasan, s: r.saiseiAll, b: r.bengoshi, g: r.hogo_nin,
})))

const rankRows = (list, fmt) => list.map((r, i) =>
  `      <tr><td>${i + 1}</td><th>${r.pref}</th><td class="n">${num(r.hasan)}</td><td class="n"><strong>${fmt(r)}</strong></td><td class="n">${p1(r.br)}</td><td class="n">${p1(r.gr)}</td></tr>`).join('\n')

const CSS = `
.stat-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 1em 0; }
.stat { flex: 1 1 150px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--soft); }
.stat b { display: block; font-size: 1.5rem; font-weight: 800; color: var(--brand-dark); font-variant-numeric: tabular-nums; }
.stat span { font-size: .82rem; color: var(--sub); }
.tbl-ctl { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: .8em 0 .4em; }
.tbl-ctl input { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font-size: 1rem; max-width: 100%; }
#jt, .rank-table, #trend, #cor { width: 100%; border-collapse: collapse; font-size: .9rem; }
/* ★本文の内側は726px。7列なので680pxに抑え、狭い画面でだけ横スクロールさせる。 */
#jt { min-width: 680px; font-size: .85rem; }
.rank-table { min-width: 600px; }
#trend { min-width: 560px; }
#cor { min-width: 420px; }
#jt th, #jt td, .rank-table th, .rank-table td, #trend th, #trend td, #cor th, #cor td { border-bottom: 1px solid var(--line); padding: 6px 7px; }
#jt th, #jt td { padding: 5px 6px; }
#jt tbody th, #jt thead th:first-child { white-space: nowrap; }
/* 47行なので枠内スクロールにはしない（全部見えたほうがいい） */
#jt thead th { position: sticky; top: 0; z-index: 1; background: var(--brand); color: #fff; cursor: pointer; white-space: nowrap; font-size: .82rem; line-height: 1.35; }
#jt caption, .rank-table caption, #cor caption { caption-side: top; text-align: left; padding: 8px 7px; font-size: .84rem; color: var(--sub); }
#jt thead th.sorted::after { content: " \\25BC"; font-size: .7em; }
#jt thead th.sorted.asc::after { content: " \\25B2"; }
#jt tbody td { white-space: nowrap; }
#jt td.n, #jt th.n, .rank-table td.n, .rank-table th.n, #trend td.n, #trend th.n, #cor td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#jt td.big { font-weight: 800; }
#jt tbody th, .rank-table tbody th { text-align: left; font-weight: 600; }
.mini-note { font-size: .84rem; color: var(--sub); }
#cor td.r { font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; }
`

const JS = `
var D = ${payload};
(function () {
  var rows = D.map(function (r) {
    r.hr = r.h / r.p * 100000;
    r.sr = r.s / r.p * 100000;
    r.br = r.b / r.p * 100000;
    r.gr = r.g / r.p * 1000;
    r.sh = (r.h + r.s) ? r.s / (r.h + r.s) * 100 : null;
    return r;
  });
  var tb = document.getElementById('jtb');
  var q = document.getElementById('q');
  var cnt = document.getElementById('cnt');
  var ths = document.querySelectorAll('#jt thead th');
  var sortKey = 'hr', sortAsc = false;
  function fx(v, d) { return v == null ? '—' : v.toFixed(d); }
  function ja(n) { return Number(n).toLocaleString('ja-JP'); }
  function draw() {
    var kw = q.value.trim();
    var list = rows.filter(function (r) { return !kw || r.n.indexOf(kw) >= 0; });
    list.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return sortAsc ? x.localeCompare(y, 'ja') : y.localeCompare(x, 'ja');
      return sortAsc ? x - y : y - x;
    });
    tb.innerHTML = list.map(function (r) {
      return '<tr><th>' + r.n + '</th>'
        + '<td class="n">' + ja(r.h) + '</td>'
        + '<td class="n big">' + fx(r.hr, 1) + '</td>'
        + '<td class="n">' + ja(r.s) + '</td>'
        + '<td class="n">' + fx(r.sh, 1) + '%</td>'
        + '<td class="n">' + fx(r.br, 1) + '</td>'
        + '<td class="n">' + fx(r.gr, 1) + '</td></tr>';
    }).join('');
    cnt.textContent = list.length + ' / ' + rows.length + ' 都道府県';
  }
  Array.prototype.forEach.call(ths, function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) sortAsc = !sortAsc;
      else { sortKey = k; sortAsc = (k === 'n'); }
      Array.prototype.forEach.call(ths, function (o) { o.className = o.className.replace(/(^|\\s)(sorted|asc)/g, ''); });
      th.className = (th.className + ' sorted' + (sortAsc ? ' asc' : '')).trim();
      draw();
    });
  });
  q.addEventListener('input', draw);
  draw();
})();
`

const TITLE = `自己破産が多い県は、弁護士が多い県ではなかった【47都道府県・${Y}年】`
const DESC = `「破産が多い地域は、相談できる人が近くにいるからだ」という説明を、司法統計と弁護士会の会員数で実際に確かめました。成り立ちません。破産率と結びついていたのは弁護士の多さ（r=${rr(C.hasan_bengoshi)}）ではなく生活保護率（r=${rr(C.hasan_hogo)}）でした。47都道府県の人口10万人あたり破産件数・個人再生件数・弁護士数を並べ替えできる表にしています。`

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${TITLE}｜フクシル</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="https://fukushiru.com/articles/jiko-hasan-chizu.html">
<meta property="og:type" content="article">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="破産率と結びついていたのは弁護士の多さではなく生活保護率でした（r=${rr(C.hasan_hogo)}）。47都道府県の破産・個人再生・弁護士数を並べた表つき。">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="https://fukushiru.com/articles/jiko-hasan-chizu.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css?v=20260908a">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${TITLE}",
  "description": "最高裁判所「司法統計年報」第4表の地方裁判所別データと日本弁護士連合会「弁護士会別会員数」を都道府県に組み直し、人口あたりの破産件数・個人再生件数・弁護士数・生活保護率の関係を検証した。",
  "inLanguage": "ja",
  "datePublished": "${TODAY}",
  "dateModified": "${TODAY}",
  "author": { "@type": "Organization", "name": "フクシル" },
  "publisher": { "@type": "Organization", "name": "フクシル" },
  "url": "https://fukushiru.com/articles/jiko-hasan-chizu.html",
  "mainEntityOfPage": "https://fukushiru.com/articles/jiko-hasan-chizu.html",
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
      "name": "自己破産が多い都道府県はどこですか？",
      "acceptedAnswer": { "@type": "Answer", "text": "${Y}年の司法統計では、人口10万人あたりの破産新受件数がいちばん多いのは${byHr[0].pref}（${p1(byHr[0].hr)}件）、いちばん少ないのは${byHr[46].pref}（${p1(byHr[46].hr)}件）で、約${p2(byHr[0].hr / byHr[46].hr)}倍の開きがあります。全国では${num(n1.hasan)}件でした。ただしこの件数には法人の破産が含まれます（全国では自然人が${SHIZEN ? p1(SHIZEN.shizen / SHIZEN.sou * 100) : '約90'}%ですが、都道府県別の内訳は公表されていません）。" }
    },
    {
      "@type": "Question",
      "name": "破産が多い地域は、弁護士が多いからですか？",
      "acceptedAnswer": { "@type": "Answer", "text": "違いました。人口あたりの破産件数と弁護士数の相関は r=${rr(C.hasan_bengoshi)} と弱く、生活保護率を同じ条件にそろえて測り直すと r=${rr(C.hasan_bengoshi_partial)} まで落ちます。一方で破産件数と生活保護率の相関は r=${rr(C.hasan_hogo)} あります。破産の地図は、弁護士の分布よりも困窮の分布に重なっています。東京都は人口あたりの弁護士が${byBr[46].pref}の約${p1(tokyo.br / byBr[46].br)}倍いますが、破産率は47都道府県で${tokyoRank}位です。" }
    },
    {
      "@type": "Question",
      "name": "自己破産と個人再生はどう違いますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "自己破産は借金の支払い義務そのものを免除してもらう手続きで、原則として持ち家などの財産は手放します。個人再生は借金を大きく減らしたうえで原則3年で分割して返す手続きで、住宅ローンを払い続けて家を残す特則が使えます。ただし個人再生は減額後を払い切れる継続的な収入があることが条件で、誰でも選べるものではありません。${Y}年は破産${num(n1.hasan)}件に対し個人再生${num(n1.saisei + n1.kyuyo)}件でした。" }
    },
    {
      "@type": "Question",
      "name": "個人再生が選ばれやすい地域はありますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "あります。破産と個人再生の合計に占める個人再生の割合は、全国では${p1(natSh)}%ですが、${bySh[46].pref}の${p1(bySh[46].sh)}%から${bySh[0].pref}の${p1(bySh[0].sh)}%まで約${p2(bySh[0].sh / bySh[46].sh)}倍ひらきます。この割合は生活保護率と r=${rr(C.share_hogo)} の逆相関があり、困窮が重い地域ほど個人再生は選ばれていません。個人再生が継続的な収入を前提とする制度であることと整合します。" }
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
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ お金の相談 ＞ 自己破産の都道府県別データ</p>

  <h1>自己破産が多い県は、<br>弁護士が多い県ではなかった</h1>
  <p class="updated">最終更新：${TODAY} ／ 最高裁判所「司法統計年報 1.民事・行政編」第4表（${D.years[0]}〜${Y}年・暦年）、日本弁護士連合会「弁護士会別会員数」（${D.bar_asof}現在・${num(D.bar_total)}人）を都道府県に組み直して集計</p>

  <p class="lead">「破産が多い地域は、それだけ<strong>相談できる人が近くにいる</strong>からだ」——もっともらしい説明です。<strong>確かめました。成り立ちません。</strong><br>人口あたりの破産件数と弁護士数の相関は <strong>r=${rr(C.hasan_bengoshi)}</strong>。困窮の度合いをそろえて測り直すと <strong>r=${rr(C.hasan_bengoshi_partial)}</strong>、ほぼゼロになります。かわりに強く出たのは<strong>生活保護率との相関 r=${rr(C.hasan_hogo)}</strong> でした。<strong>破産の地図は、弁護士の地図ではなく困窮の地図に重なっています。</strong></p>

  <div class="stat-row">
    <div class="stat"><b>${num(n1.hasan)}件</b><span>${Y}年の破産（新受・全国）</span></div>
    <div class="stat"><b>${p1((n1.hasan / n0.hasan - 1) * 100)}%増</b><span>${n0.y}年の${num(n0.hasan)}件から</span></div>
    <div class="stat"><b>${p2(byHr[0].hr / byHr[46].hr)}倍</b><span>都道府県の開き（人口10万対）</span></div>
    <div class="stat"><b>${num(n1.saisei + n1.kyuyo)}件</b><span>個人再生（${p1(natSh)}%）</span></div>
  </div>

  <div class="callout warn">
    <p><span class="tag">先に読んでください</span>司法統計の「破産」には<strong>法人の破産が含まれます</strong>。${SHIZEN ? `全国では自然人（個人）が${num(SHIZEN.shizen)}件で<strong>${p1(SHIZEN.shizen / SHIZEN.sou * 100)}%</strong>ですが、` : ''}<strong>都道府県ごとの内訳は公表されていません</strong>（自然人・法人の内訳が載る第105表は全国計だけです）。このページの県別の数字は法人込みです。企業の多い都市部はそのぶん上に出ます。</p>
  </div>

  <h2>① 破産は4年で${p1((n1.hasan / n0.hasan - 1) * 100)}%増えている</h2>
  <p>${n0.y}年の${num(n0.hasan)}件から、${Y}年は${num(n1.hasan)}件。個人再生も同じ向きに動いています。</p>
  <div class="table-wrap">
  <table id="trend">
    <caption>全国の新受件数（司法統計年報 第4表・暦年）</caption>
    <thead><tr><th>年</th><th class="n">破産</th><th class="n">小規模個人再生</th><th class="n">給与所得者等再生</th><th class="n">再生が選ばれた割合</th></tr></thead>
    <tbody>
${NAT.map((n) => `      <tr><th>${n.y}年</th><td class="n"><strong>${num(n.hasan)}</strong></td><td class="n">${num(n.saisei)}</td><td class="n">${num(n.kyuyo)}</td><td class="n">${p1((n.saisei + n.kyuyo) / (n.hasan + n.saisei + n.kyuyo) * 100)}%</td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p class="mini-note">「再生が選ばれた割合」は、破産と個人再生の合計に占める個人再生の割合です。年は暦年（1〜12月）で、生活保護や困窮者支援の「年度」とは区切りが違います。</p>

  <h2>② 47都道府県の表（並べ替えできます）</h2>
  <p>見出しを押すと並べ替わります。北海道は札幌・函館・旭川・釧路の4地裁を合わせています。</p>
  <div class="tbl-ctl">
    <input id="q" type="search" placeholder="都道府県名でしぼる" aria-label="都道府県名でしぼる">
    <span class="mini-note" id="cnt"></span>
  </div>
  <div class="table-wrap">
  <table id="jt">
    <caption>${Y}年　破産・個人再生の新受件数と、弁護士数・生活保護率</caption>
    <thead><tr>
      <th data-k="n">都道府県</th>
      <th data-k="h" class="n">破産<br>件数</th>
      <th data-k="hr" class="n">破産<br>10万対</th>
      <th data-k="s" class="n">個人<br>再生</th>
      <th data-k="sh" class="n">再生の<br>割合</th>
      <th data-k="br" class="n">弁護士<br>10万対</th>
      <th data-k="gr" class="n">保護率<br>千対</th>
    </tr></thead>
    <tbody id="jtb"></tbody>
  </table>
  </div>
  <p class="mini-note">「破産10万対」「弁護士10万対」は人口10万人あたり、「保護率 千対」は人口1,000人あたりの生活保護受給者数です。人口は<a href="seikatsuhogo-shinsei-jichitai.html">被保護者調査</a>の保護率からの逆算なので0.5%ほどの誤差を含みます。僅差の順位に意味はありません。</p>

  <h2>③ 何が破産の多さと結びついているのか</h2>
  <p>4つの数字（人口あたりの破産件数・個人再生件数・弁護士数・生活保護率）の相関を、47都道府県で総当たりに測りました。</p>
  <div class="table-wrap">
  <table id="cor">
    <caption>相関係数（47都道府県・${Y}年／弁護士は${D.bar_asof}現在）</caption>
    <thead><tr><th>組み合わせ</th><th class="n">r</th><th>読み方</th></tr></thead>
    <tbody>
      <tr><th>破産率 × 生活保護率</th><td class="r">${rr(C.hasan_hogo)}</td><td>はっきり結びつく</td></tr>
      <tr><th>破産率 × 弁護士密度</th><td class="r">${rr(C.hasan_bengoshi)}</td><td>弱い</td></tr>
      <tr><th>破産率 × 弁護士密度<br><small>（生活保護率をそろえたとき）</small></th><td class="r">${rr(C.hasan_bengoshi_partial)}</td><td><strong>ほぼ無関係</strong></td></tr>
      <tr><th>弁護士密度 × 生活保護率</th><td class="r">${rr(C.bengoshi_hogo)}</td><td>弱く結びつく（都市部の事情）</td></tr>
      <tr><th>個人再生率 × 生活保護率</th><td class="r">${rr(C.saisei_hogo)}</td><td>無関係</td></tr>
      <tr><th>再生が選ばれた割合 × 生活保護率</th><td class="r">${rr(C.share_hogo)}</td><td><strong>逆向きにはっきり結びつく</strong></td></tr>
    </tbody>
  </table>
  </div>
  <p>相関係数は−1から＋1までの値で、0に近いほど関係が無いことを示します。3行目が要点です。<strong>弁護士の多さは、困窮の度合いをそろえてしまうと破産の多さをほとんど説明しません。</strong></p>
  <p>いちばん分かりやすい反例が東京都です。人口10万人あたりの弁護士は<strong>${p1(tokyo.br)}人</strong>で全国1位、最下位の${byBr[46].pref}（${p1(byBr[46].br)}人）の<strong>約${p1(tokyo.br / byBr[46].br)}倍</strong>います。それでも破産率は<strong>${p1(tokyo.hr)}件で47都道府県中${tokyoRank}位</strong>。弁護士が20倍いても、破産が20倍起きているわけではありません。</p>
  <div class="callout note">
    <p><span class="tag">この記事の作り方</span>もともとは「破産が多い県は、理解してくれる人が多い県ではないか」という見立てから調べ始めました。<strong>数字はそれを支持しませんでした。</strong>支持されなかったことを、支持されなかったまま載せています。</p>
  </div>

  <h3>破産率が高い10県</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>都道府県</th><th class="n">破産件数</th><th class="n">人口10万対</th><th class="n">弁護士10万対</th><th class="n">保護率千対</th></tr></thead>
    <tbody>
${rankRows(byHr.slice(0, 10), (r) => p1(r.hr))}
    </tbody>
  </table>
  </div>
  <h3>破産率が低い10県</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>都道府県</th><th class="n">破産件数</th><th class="n">人口10万対</th><th class="n">弁護士10万対</th><th class="n">保護率千対</th></tr></thead>
    <tbody>
${rankRows([...byHr].reverse().slice(0, 10), (r) => p1(r.hr))}
    </tbody>
  </table>
  </div>

  <h2>④ 地域で本当に違うのは「破産か、再生か」の選ばれ方</h2>
  <p>破産の多さは困窮の量でおおむね説明がつきます。では<strong>困窮の量とまったく関係しない軸</strong>はあるのか。ひとつありました。<strong>同じ行き詰まりに対して、破産を選ぶか個人再生を選ぶか</strong>です。</p>
  <p>人口あたりの個人再生件数と生活保護率の相関は <strong>r=${rr(C.saisei_hogo)}</strong>。<strong>まったくの無関係</strong>です。ところが破産と再生の合計に占める再生の割合で見ると、全国${p1(natSh)}%に対し<strong>${bySh[46].pref}の${p1(bySh[46].sh)}%から${bySh[0].pref}の${p1(bySh[0].sh)}%まで約${p2(bySh[0].sh / bySh[46].sh)}倍</strong>ひらき、生活保護率と <strong>r=${rr(C.share_hogo)}</strong> の逆相関が出ます。</p>
  <p><strong>困窮が重い地域ほど、再生ではなく破産になっています。</strong>個人再生は減額後の金額を原則3年で払い切れる<strong>継続的な収入</strong>があることが条件の制度なので、この向きは制度の中身と一致します。言い換えると、<strong>再生を選べるかどうかは、住んでいる場所ではなく、収入が残っているかで決まっている</strong>ということです。</p>
  <div class="table-wrap">
  <table class="rank-table">
    <caption>再生（家を残せる可能性がある手続き）が選ばれた割合の高い10県／低い10県</caption>
    <thead><tr><th>#</th><th>都道府県</th><th class="n">破産件数</th><th class="n">再生の割合</th><th class="n">弁護士10万対</th><th class="n">保護率千対</th></tr></thead>
    <tbody>
${rankRows(bySh.slice(0, 10), (r) => p1(r.sh) + '%')}
      <tr><td colspan="6" class="mini-note">…（中略・全47都道府県は上の表で並べ替えできます）…</td></tr>
${rankRows([...bySh].reverse().slice(0, 10), (r) => p1(r.sh) + '%')}
    </tbody>
  </table>
  </div>
  <p class="mini-note">再生の割合は弁護士密度とも r=${rr(C.share_bengoshi)} の逆相関を示しますが、<strong>弁護士密度と生活保護率自体が r=${rr(C.bengoshi_hogo)} で絡んでいる</strong>ため、これを「弁護士が少ないから」と読むことはできません。このページでは、そう書きません。</p>

  <h2>⑤ 破産と個人再生は何が違うのか</h2>
  <ul>
    <li><strong>自己破産</strong>：支払い義務そのものを免除してもらう手続きです（免責）。原則として持ち家などの財産は手放します。税金・社会保険料・養育費などは免責されません。</li>
    <li><strong>個人再生</strong>：借金を大きく減らしたうえで、<strong>原則3年</strong>で分割して返します。<strong>住宅ローンだけは払い続けて家を残す特則</strong>が使えます。ただし<strong>減額後を払い切れる継続的な収入</strong>が条件です。${Y}年の新受は小規模個人再生${num(n1.saisei)}件・給与所得者等再生${num(n1.kyuyo)}件でした。</li>
    <li><strong>費用が心配なとき</strong>：収入と資産が一定以下なら、法テラスの民事法律扶助で弁護士・司法書士の費用を立て替えてもらえます（あとから分割で返します）。生活保護を受けている間は返済が猶予され、条件を満たせば免除されることがあります。</li>
    <li><strong>その前にできること</strong>：市区町村の<a href="shakkin-kakei-soudan.html">家計改善支援の窓口</a>なら無料で、家計を整理したうえで必要な専門家につないでもらえます。</li>
  </ul>

  <h2>⑥ この数字の限界（大事なところ）</h2>
  <ul>
    <li><strong>破産件数に法人が含まれます。</strong>${SHIZEN ? `全国では自然人が${p1(SHIZEN.shizen / SHIZEN.sou * 100)}%ですが、` : ''}都道府県別の内訳は公表されていません。企業の多い地域は上振れします。</li>
    <li><strong>申し立てた裁判所の場所で数えています。</strong>住んでいる場所とは必ずしも一致しません（法人は本店所在地、個人は住所地が原則です）。</li>
    <li><strong>相関は因果ではありません。</strong>「生活保護率が高いから破産が多い」と言っているのではなく、2つが同じ地図の上で重なっている、と言っています。</li>
    <li><strong>弁護士数は${D.bar_asof}現在の在籍数</strong>で、${Y}年の件数とは時点が1年ほどずれます。司法書士は含みません（簡裁代理権の範囲で債務整理を扱うため、実際の担い手はこれより多いはずです）。</li>
    <li><strong>人口は保護率からの逆算です。</strong>0.5%ほどの誤差を含みます。僅差の順位に意味はありません。</li>
    <li><strong>${D.years[0]}年より前は取っていません。</strong>司法統計のExcelの作りが年によって違い、機械で同じように読めるのがこの範囲でした。</li>
  </ul>

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>借金を抱えてまず相談するなら<a href="shakkin-kakei-soudan.html">借金と家計の無料相談（自治体別の実績）</a>。生活保護を考えているなら<a href="seikatsuhogo-keisanki.html">支給額シミュレーター</a>と<a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>。家賃を下げて立て直すなら<a href="koei-jutaku-bairitsu.html">公営住宅の倍率データ</a>もどうぞ。</p>
  </div>

  <h2>コメント</h2>
  <p class="mini-note">数字の読み方についてのご指摘を歓迎します。<strong>個別の借金についてのご相談にはお答えできません。</strong>個人が特定される情報や、具体的な借入先・金額はお書きにならないでください。</p>
  <div id="cusdis_thread"
    data-host="https://cusdis.com"
    data-app-id="14dfe8f8-c660-42ee-9cd2-54ee31828ba9"
    data-page-id="jiko-hasan-chizu"
    data-page-url="https://fukushiru.com/articles/jiko-hasan-chizu.html"
    data-page-title="自己破産の都道府県別データ">
  </div>
  <script async defer src="https://cusdis.com/js/cusdis.es.js"></script>

  <h2>出典</h2>
  <ul class="sources">
    <li>最高裁判所「司法統計年報 1.民事・行政編」第4表 民事・行政事件数―事件の種類及び新受、既済、未済―全地方裁判所及び地方裁判所別（${D.years[0]}〜${Y}年） https://www.courts.go.jp/toukei_siryou/shihotokei_nenpo/index.html</li>
    <li>最高裁判所「司法統計年報 1.民事・行政編」第105表 破産新受事件数―受理区分別―全地方裁判所（自然人・法人の内訳／全国計のみ）</li>
    <li>日本弁護士連合会「弁護士会別会員数」（${D.bar_asof}現在） https://www.nichibenren.or.jp/jfba_info/membership/about.html</li>
    <li>厚生労働省「被保護者調査（月次調査・確定値）」第9表・第18表（人口と生活保護率） https://www.mhlw.go.jp/toukei/list/74-16b.html</li>
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは公表されている集計値を並べ、割合と相関を計算したものです。<strong>特定の地域や個人を評価するものではありません。</strong>相関は因果関係を示しません。どの手続きが適切かは事情によって変わりますので、実際の判断は法テラス・弁護士・司法書士にご相談ください。数字の誤りにお気づきの場合は <a href="../about.html">このサイトについて</a> の連絡先までお知らせください。
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
console.log(`書いた: ${OUT}  (${(html.length / 1024).toFixed(1)}KB / 47都道府県)`)
