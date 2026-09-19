// ─────────────────────────────────────────────────────────────────────────────
// konkyu-build.mjs — 「借金と家計の相談は、どこまで受けてもらえるのか」の面を作る。
//   node scripts/konkyu-build.mjs        → articles/shakkin-kakei-soudan.html
//   node scripts/konkyu-build.mjs --dry  → 書かずに主な数字だけ出す
//
// 前に回すもの: node scripts/konkyu-fetch.mjs → python scripts/konkyu-parse.py
//
// ★このページで言ってよいこと・言ってはいけないこと
//   言ってよい：家計改善支援事業の利用件数は自治体でまるで違う（人口10万人あたり0件〜246件）。
//               相談からプラン作成に至る割合は5.1%〜87.6%（年300件以上の機関）。
//               全国の家計改善支援は相談が減っても増え続けており、令和6年度が最多。
//   言ってはいけない：
//     ①「利用0件＝その市には窓口が無い」。**家計改善支援事業の実施率は87%（787自治体）**で、
//       多くは実施しているのに利用計上が0。未実施なのか、実施したが使われていないのか、
//       委託先で別に数えているのかは、この表からは区別できない。断定しない。
//     ②「プラン作成率が低い＝冷たい自治体」。相談の数え方が自治体で違う。
//       電話1本を1件と数える所と、面接に至ったものだけ数える所では分母が別物になる。
//     ③「生活保護に厳しい自治体は困窮者支援にも冷たい」。**実測で相関は r=0.038 ＝ほぼ無関係**。
//       2つの運用は別の軸。ここを混ぜると事実でないことを書くことになる。
//
// ★数字の但し書き
//   ・公表表の「10万人あたり」は**年間でなく1か月あたり**。このページでは使わず、
//     年度累計から自前で年あたりに直して出す（12倍の誤報になるため）。
//   ・都道府県の行に指定都市・中核市は入っていない。「福岡県（福岡市・北九州市・久留米市を除く）」。
//   ・年度累計。相談とプランは同じ人を追っているわけではないので、率は目安。
//   ・件数が少ない機関は率が跳ねるので、ランキングは年300件以上（プランは100件以上）に絞る。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'data', 'konkyu.json')
const HOGO = path.join(ROOT, 'data', 'hogo-shinsei.json')
const OUT = path.join(ROOT, 'articles', 'shakkin-kakei-soudan.html')
const DRY = process.argv.includes('--dry')
const MIN_S = 300 // 相談まわりのランキングに載せる最低の年間相談件数
const MIN_P = 100 // 家計改善まわりのランキングに載せる最低の年間プラン作成件数

const D = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const Y = D.latest_year
const WAREKI = (y) => (y - 2018 === 1 ? '令和元年度' : y >= 2019 ? `令和${y - 2018}年度` : `平成${y - 1988}年度`)
const num = (n) => Number(n).toLocaleString('ja-JP')
const p1 = (x) => (Math.round(x * 10) / 10).toFixed(1)
const p2 = (x) => (Math.round(x * 100) / 100).toFixed(2)
// ★toISOString() はUTC。日本時間の朝は前日になる。JSTに直す。
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

// ---- 指標をつける ----
const rows = D.rows.map((r) => ({
  ...r,
  sp: r.soudan / r.pop * 10000,          // 人口1万あたり 年間相談件数
  pr: r.soudan ? r.plan / r.soudan * 100 : null, // プラン作成率
  kr: r.plan ? r.kakei / r.plan * 100 : null,    // プラン作成者に対する家計改善支援の割合
  k10: r.kakei / r.pop * 100000,          // 人口10万あたり 年間の家計改善支援
}))
const N = D.national
const cur = N[String(Y)]
const hist = D.years.map((y) => ({ y, ...N[String(y)] }))
const h0 = hist[0]
const h1 = hist[hist.length - 1]
const hPeak = hist.reduce((a, b) => (b.soudan > a.soudan ? b : a))

// 都道府県の行から抜けている市（「○○県（△△市を除く）」と書くため）
const exMap = {}
for (const r of rows) {
  if (r.level === '都道府県' || !r.pref) continue
  ;(exMap[r.pref] ||= []).push(r.name)
}
for (const r of rows) if (r.level === '都道府県') r.ex = exMap[r.name] || []

const median = (a) => {
  const s = [...a].filter((x) => x != null).sort((x, y) => x - y)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const bigS = rows.filter((r) => r.soudan >= MIN_S)
const bigP = rows.filter((r) => r.plan >= MIN_P)
const prLo = [...bigS].sort((a, b) => a.pr - b.pr)
const prHi = [...bigS].sort((a, b) => b.pr - a.pr)
const krLo = [...bigP].sort((a, b) => a.kr - b.kr)
const krHi = [...bigP].sort((a, b) => b.kr - a.kr)
const spLo = [...bigS].sort((a, b) => a.sp - b.sp)
const spHi = [...bigS].sort((a, b) => b.sp - a.sp)
const zero = rows.filter((r) => r.kakei === 0)
const PR_HABA = p1(prHi[0].pr / prLo[0].pr)
const medPr = median(bigS.map((r) => r.pr))
const medKr = median(bigP.map((r) => r.kr))
const medSp = median(bigS.map((r) => r.sp))

// 家計改善支援事業の実施率（parse がPDFから取った実数。取れていなければ本文から落とす）
const JI = D.jisshi
// 87.0% ではなく 87% と出す（整数のときは小数点を付けない）
const pct = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : p1(x))
const JI_TXT = JI ? `${num(JI.jichitai)}自治体（実施率${pct(JI.ritsu)}%）` : null

// 人口10万人あたりの年間利用件数の上限（見出しに使う。率の1位とは別の機関になりうる）
const k10Hi = [...rows].sort((a, b) => b.k10 - a.k10)

// 指定都市20だけを抜き出す（読者の大半がここに住んでいる／差が一番はっきり出る）
const sei = rows.filter((r) => r.level === '指定都市').sort((a, b) => b.kr - a.kr)
const seiTop = sei[0]
const seiBtm = sei[sei.length - 1]
// ★上位と下位がたまたま同じ県だった年は、そこが一番効く一文になる。
//   でも来年も同じとは限らないので、実データで一致したときだけ書く。
const seiPrefRow = rows.find((r) => r.level === '都道府県' && r.name === seiTop.pref)
const SEI_SAME_PREF = (seiTop.pref && seiTop.pref === seiBtm.pref)
  ? `この2つは<strong>同じ${seiTop.pref}</strong>です${seiPrefRow ? `（${seiTop.pref}の県所管ぶんは${p1(seiPrefRow.kr)}%）` : ''}。制度は同じ、県も同じ、運用だけが違います。`
  : '制度は全国共通で、違うのは運用だけです。'

// ---- 生活保護の却下率と突き合わせる（同じ129機関なので名前で繋がる）----
let pair = []
let R_HOGO = null
let R_TXT = '—'
if (fs.existsSync(HOGO)) {
  const H = JSON.parse(fs.readFileSync(HOGO, 'utf8'))
  const hm = Object.fromEntries(H.rows.map((r) => [r.name, r]))
  pair = bigS.map((r) => {
    const h = hm[r.name]
    if (!h || h.shinsei < MIN_S) return null
    return { r, kyakka: h.kyakka / h.shinsei * 100 }
  }).filter(Boolean)
  const corr = (a, b) => {
    const ma = a.reduce((s, x) => s + x, 0) / a.length
    const mb = b.reduce((s, x) => s + x, 0) / b.length
    let n = 0; let da = 0; let db = 0
    for (let i = 0; i < a.length; i++) {
      n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2
    }
    return n / Math.sqrt(da * db)
  }
  R_HOGO = corr(pair.map((p) => p.r.pr), pair.map((p) => p.kyakka))
  R_TXT = (R_HOGO >= 0 ? '＋' : '−') + Math.abs(R_HOGO).toFixed(2)
}

if (DRY) {
  console.log(`年度 ${Y} / ${rows.length}機関 / 年度 ${D.years.join(',')}`)
  console.log(`全国 相談${num(cur.soudan)} プラン${num(cur.plan)}(${p1(cur.plan / cur.soudan * 100)}%) 家計改善${num(cur.kakei)} 住居確保${num(cur.jukyo)}`)
  console.log(`プラン作成率 ${p1(prLo[0].pr)}%(${prLo[0].name}) 〜 ${p1(prHi[0].pr)}%(${prHi[0].name}) 中央${p1(medPr)}% 幅${PR_HABA}倍`)
  console.log(`家計改善/プラン ${p1(krLo[0].kr)}%(${krLo[0].name}) 〜 ${p1(krHi[0].kr)}%(${krHi[0].name}) 中央${p1(medKr)}%`)
  console.log(`家計改善0件 ${zero.length}機関: ${zero.map((r) => r.name).join('・')}`)
  console.log(`生活保護却下率との相関 r=${R_TXT}（${pair.length}機関）`)
  console.log(`警告: ${(D.warnings || []).length}件`)
  process.exit(0)
}

const payload = JSON.stringify(rows.map((r) => ({
  n: r.name, lv: r.level, pf: r.pref, ex: r.level === '都道府県' ? r.ex : undefined,
  p: r.pop, s: r.soudan, pl: r.plan, k: r.kakei, j: r.jukyo,
})))

const rank = (list, key, fmt) => list.map((r, i) => `      <tr><td>${i + 1}</td><th>${r.name}${r.level === '都道府県' && r.ex.length ? `<small>${r.ex.length <= 3 ? r.ex.join('・') + 'を除く' : r.ex.length + '市を除く'}</small>` : ''}</th><td>${r.level}</td><td class="n">${num(r.soudan)}</td><td class="n">${num(r.plan)}</td><td class="n"><strong>${fmt(r[key])}</strong></td><td class="n">${num(r.kakei)}</td></tr>`).join('\n')

const CSS = `
.stat-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 1em 0; }
.stat { flex: 1 1 150px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--soft); }
.stat b { display: block; font-size: 1.5rem; font-weight: 800; color: var(--brand-dark); font-variant-numeric: tabular-nums; }
.stat span { font-size: .82rem; color: var(--sub); }
.tbl-ctl { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: .8em 0 .4em; }
.tbl-ctl input, .tbl-ctl select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font-size: 1rem; max-width: 100%; }
#jt, .rank-table, #trend { width: 100%; border-collapse: collapse; font-size: .9rem; }
/* ★本文の内側は726px。8列なので700pxに抑え、狭い画面でだけ横スクロールさせる。
   780pxにすると右端の列が枠の外に出て、机上では気づけない。 */
#jt { min-width: 700px; font-size: .85rem; }
.rank-table { min-width: 640px; }
#trend { min-width: 600px; }
#jt th, #jt td, .rank-table th, .rank-table td, #trend th, #trend td { border-bottom: 1px solid var(--line); padding: 6px 7px; }
#jt th, #jt td { padding: 5px 6px; }
#jt tbody th, #jt thead th:first-child { white-space: normal; width: 126px; }
#jt tbody td:first-of-type { white-space: nowrap; }
/* 129行そのままだと縦が2万px近くなり、下の章まで誰も辿り着かない。枠の中でスクロールさせる。 */
#jt-wrap { max-height: 72vh; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
/* ★共通CSSの thead th は濃い地に白文字。ここで背景だけ薄くすると白文字のまま読めなくなる。 */
#jt thead th { position: sticky; top: 0; z-index: 1; background: var(--brand); color: #fff; cursor: pointer; white-space: nowrap; font-size: .82rem; line-height: 1.35; }
#jt caption, .rank-table caption { caption-side: top; text-align: left; padding: 8px 7px; font-size: .84rem; color: var(--sub); }
#jt thead th.sorted::after { content: " \\25BC"; font-size: .7em; }
#jt thead th.sorted.asc::after { content: " \\25B2"; }
#jt tbody td { white-space: nowrap; }
#jt td.n, #jt th.n, .rank-table td.n, .rank-table th.n, #trend td.n, #trend th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#jt td.big, .rank-table td.big { font-weight: 800; }
#jt tbody th, .rank-table tbody th { text-align: left; font-weight: 600; }
#jt tbody th small, .rank-table tbody th small { font-weight: 400; color: var(--sub); display: block; font-size: .76rem; }
.mini-note { font-size: .84rem; color: var(--sub); }
.pairlist { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin: 1em 0; }
.pairlist div { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: .88rem; }
.pairlist div b { display: block; margin-bottom: 4px; }
`

const JS = `
var D = ${payload};
(function () {
  var rows = D.map(function (r) {
    r.sp = r.s / r.p * 10000;
    r.pr = r.s ? r.pl / r.s * 100 : null;
    r.kr = r.pl ? r.k / r.pl * 100 : null;
    return r;
  });
  var tb = document.getElementById('jtb');
  var q = document.getElementById('q');
  var lv = document.getElementById('lv');
  var cnt = document.getElementById('cnt');
  var ths = document.querySelectorAll('#jt thead th');
  var sortKey = 'kr', sortAsc = false;

  // 大阪府のように別掲の市が多い県は、全部並べると1行が何行ぶんもの高さになる。
  // 3市を超えたら件数にまとめ、全部は title（マウスを載せると出る）に入れる。
  function nm(r) {
    if (r.lv !== '都道府県' || !r.ex || !r.ex.length) return r.n;
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
        + '<td class="n">' + fx(r.sp, 1) + '</td>'
        + '<td class="n">' + fx(r.pr, 1) + '%</td>'
        + '<td class="n">' + ja(r.k) + '</td>'
        + '<td class="n big">' + fx(r.kr, 1) + '%</td>'
        + '<td class="n">' + ja(r.j) + '</td></tr>';
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

const TITLE = `借金と家計の無料相談、自治体でここまで違う【${rows.length}機関・${WAREKI(Y)}】`
const DESC = `市区町村の「家計改善支援事業」は、借金や家計の立て直しを無料で相談できる公的な窓口です。${WAREKI(Y)}の利用は全国${num(cur.kakei)}件。ただし使われ方は自治体で桁違いで、人口10万人あたり0件から${p1(k10Hi[0].k10)}件（${k10Hi[0].name}）まで開いています。厚生労働省の自治体別集計表から${rows.length}機関ぶんを並べ替えできる表にしました。`

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
<link rel="canonical" href="https://fukushiru.com/articles/shakkin-kakei-soudan.html">
<meta property="og:type" content="article">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="家計改善支援事業の利用は全国${num(cur.kakei)}件。${JI ? `実施率${pct(JI.ritsu)}%なのに、` : ''}使われ方は自治体で桁違い。${rows.length}機関の実績を並べ替えできる表にしました。">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="https://fukushiru.com/articles/shakkin-kakei-soudan.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css?v=20260908a">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${TITLE}",
  "description": "厚生労働省「生活困窮者自立支援制度支援状況調査」自治体別集計表から、家計改善支援事業の利用件数・新規相談受付件数・プラン作成件数を都道府県・指定都市・中核市の${rows.length}機関ぶん集計した。",
  "inLanguage": "ja",
  "datePublished": "${TODAY}",
  "dateModified": "${TODAY}",
  "author": { "@type": "Organization", "name": "フクシル" },
  "publisher": { "@type": "Organization", "name": "フクシル" },
  "url": "https://fukushiru.com/articles/shakkin-kakei-soudan.html",
  "mainEntityOfPage": "https://fukushiru.com/articles/shakkin-kakei-soudan.html",
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
      "name": "借金の相談を無料でできる公的な窓口はありますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "市区町村の生活困窮者自立支援制度のなかに「家計改善支援事業」があります。家計の状況を一緒に整理し、必要なら法テラスや弁護士・司法書士、消費生活センターの多重債務相談につないでくれる無料の窓口です。${WAREKI(Y)}の利用は全国${num(cur.kakei)}件、${JI_TXT ? `実施しているのは${JI_TXT}でした。` : ''}窓口の入口は「自立相談支援機関」で、市区町村の福祉課や社会福祉協議会に置かれていることが多いです。" }
    },
    {
      "@type": "Question",
      "name": "家計改善支援事業はどこの市でも同じように使えますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "使われ方には大きな差があります。${WAREKI(Y)}に年${MIN_P}件以上のプランを作っている${bigP.length}機関で見ると、プランを作った人のうち家計改善支援を使った割合は${p1(krLo[0].kr)}%から${p1(krHi[0].kr)}%まで開いています。中央値は${p1(medKr)}%です。利用の計上が0件だった機関も${zero.length}あります。ただし0件は「窓口が無い」とは限らず、実施はしているが利用に至らなかった場合や、委託先で別に数えている場合も含まれます。" }
    },
    {
      "@type": "Question",
      "name": "相談に行けば必ず支援を受けられますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "相談を受けたあと支援プランを作るかどうかは自治体の判断です。${WAREKI(Y)}の全国平均では新規相談${num(cur.soudan)}件に対しプラン作成は${num(cur.plan)}件（${p1(cur.plan / cur.soudan * 100)}%）でした。年${MIN_S}件以上の相談がある${bigS.length}機関では${p1(prLo[0].pr)}%から${p1(prHi[0].pr)}%まで約${PR_HABA}倍の差があります。ただし相談の数え方（電話1本を1件と数えるか、面接に至ったものだけ数えるか）が自治体で違うため、この差をそのまま熱心さの差と読むことはできません。" }
    },
    {
      "@type": "Question",
      "name": "家計改善支援を使うと借金は片づきますか？",
      "acceptedAnswer": { "@type": "Answer", "text": "この事業自体が借金を減らすわけではありません。家計を見える形にして、返せるのか返せないのかを整理し、債務整理が必要なら法テラスや弁護士・司法書士につなぐのが役割です。厚生労働省の調査では、事業を利用した人は利用していない人に比べて「家計の改善」「債務の整理」「精神の安定」「孤独の解消」といった変化が現れた割合が高いと報告されています。" }
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
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ お金の相談 ＞ 家計改善支援の自治体別実績</p>

  <h1>借金と家計の相談は、<br>どこまで受けてもらえるのか</h1>
  <p class="updated">最終更新：${TODAY} ／ 厚生労働省「生活困窮者自立支援制度支援状況調査」自治体別集計表（${WAREKI(D.years[0])}〜${WAREKI(Y)}）を集計。都道府県・指定都市・中核市の${rows.length}機関</p>

  <p class="lead">借金の相談先は弁護士や司法書士だけではありません。市区町村には<strong>家計改善支援事業</strong>という<strong>無料</strong>の窓口があり、家計を一緒に整理して、必要なら法テラスや多重債務相談につないでくれます。${WAREKI(Y)}の利用は全国で<strong>${num(cur.kakei)}件</strong>。${JI_TXT ? `実施しているのは<strong>${JI_TXT}</strong>です。` : ''}<br>ところが<strong>使われ方は自治体で桁が違います</strong>。人口10万人あたりの年間利用件数は<strong>0件から${p1(k10Hi[0].k10)}件（${k10Hi[0].name}）</strong>まで開いています。この数字は国が毎年PDFで出しているのに、<strong>自治体ごとに並べた表はどこにも出ていません</strong>。だから作りました。</p>

  <div class="stat-row">
    <div class="stat"><b>${num(cur.soudan)}件</b><span>${WAREKI(Y)}の新規相談（全国）</span></div>
    <div class="stat"><b>${num(cur.plan)}件</b><span>支援プラン作成（${p1(cur.plan / cur.soudan * 100)}%）</span></div>
    <div class="stat"><b>${num(cur.kakei)}件</b><span>家計改善支援の利用（過去最多）</span></div>
    <div class="stat"><b>${num(cur.jukyo)}件</b><span>住居確保給付金</span></div>
  </div>

  <div class="callout warn">
    <p><span class="tag">先に読んでください</span><strong>「利用0件＝その市に窓口が無い」ではありません。</strong>${JI_TXT ? `家計改善支援事業を実施しているのは<strong>${JI_TXT}</strong>です。` : '家計改善支援事業は多くの自治体が実施しています。'}利用の計上が0件だった${zero.length}機関（${zero.map((r) => r.name).join('・')}）も、<strong>実施はしているが利用に至らなかった</strong>、<strong>委託先で別に数えている</strong>といった可能性があります。この表からは区別できません。<strong>自分の市が0件でも、まず電話してみてください。</strong></p>
  </div>

  <h2>① この窓口は、何をしてくれるところか</h2>
  <p>入口は<strong>自立相談支援機関</strong>です。市区町村の福祉の窓口か、委託を受けた社会福祉協議会などに置かれています。そこで話を聞いたうえで支援プランを作り、必要な事業につなぎます。家計改善支援事業はそのひとつで、<strong>収入と支出と借金を一枚の表にして、返せるのか返せないのかを一緒に見る</strong>のが仕事です。</p>
  <p><strong>この事業そのものが借金を減らすわけではありません。</strong>債務整理が必要だと分かったら、法テラスや弁護士・司法書士につなぎます。厚生労働省の同じ調査によると、新規相談者のつなぎ先として<strong>「法テラス・弁護士・司法書士」が1,347件、「消費生活センター・多重債務者等相談窓口」が364件</strong>記録されています（複数回答・n=45,003）。</p>
  <p>厚生労働省は、この事業を利用した人は利用していない人に比べて<strong>「家計の改善」「債務の整理」「精神の安定」「孤独の解消」</strong>の変化が現れた割合が高い、と報告しています。<strong>借金を抱えた人にとって、いちばん手前にある公的な窓口</strong>だと考えてよい位置づけです。</p>

  <h2>② 相談は減ったのに、家計の相談だけ増え続けている</h2>
  <p>${WAREKI(hPeak.y)}の相談件数<strong>${num(hPeak.soudan)}件</strong>は、コロナ禍で住居確保給付金の窓口が同じ場所だったための一時的な山です（住居確保給付金は${num(hist.find((h) => h.y === hPeak.y).jukyo)}件）。その山は引きました。<strong>それでも家計改善支援の利用だけは減らず、${WAREKI(Y)}が過去最多です。</strong>相談1件あたりで見ると、${WAREKI(h0.y)}の${p2(h0.kakei / h0.soudan * 100)}%から${WAREKI(h1.y)}の${p2(h1.kakei / h1.soudan * 100)}%へ、<strong>濃さが${p1((h1.kakei / h1.soudan) / (h0.kakei / h0.soudan))}倍</strong>になりました。相談の中身が「家賃が払えない」から「家計そのものが回らない」へ移っています。</p>
  <div class="table-wrap">
  <table id="trend">
    <caption>全国の推移（自治体別集計表の合計・年度累計）</caption>
    <thead><tr><th>年度</th><th class="n">新規相談</th><th class="n">プラン作成</th><th class="n">プラン作成率</th><th class="n">家計改善支援</th><th class="n">対プラン</th><th class="n">住居確保給付金</th></tr></thead>
    <tbody>
${hist.map((h) => `      <tr><th>${WAREKI(h.y)}（${h.y}）</th><td class="n">${num(h.soudan)}</td><td class="n">${num(h.plan)}</td><td class="n">${p1(h.plan / h.soudan * 100)}%</td><td class="n"><strong>${num(h.kakei)}</strong></td><td class="n">${p1(h.kakei / h.plan * 100)}%</td><td class="n">${num(h.jukyo)}</td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p class="mini-note">${WAREKI(h0.y)}は${h0.kikan}機関、${WAREKI(h1.y)}は${h1.kikan}機関の合計です（中核市が増えたぶん機関数が動いています）。平成27・28年度は集計表の列の作りが違うので載せていません。</p>

  <h2>③ ${rows.length}機関の全表（並べ替え・絞り込みできます）</h2>
  <p>見出しを押すと並べ替わります。お住まいの自治体名を入れて探せます。<strong>都道府県の行には、その県にある指定都市・中核市は入っていません</strong>（それぞれ別の行として載っています）。たとえば「福岡県」の行は福岡市・北九州市・久留米市を除いた福岡県です。</p>
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
    <caption>${WAREKI(Y)}　生活困窮者自立支援制度の支援状況（厚労省 自治体別集計表）</caption>
    <thead><tr>
      <th data-k="n">自治体</th>
      <th data-k="lv">種別</th>
      <th data-k="s" class="n">新規<br>相談</th>
      <th data-k="sp" class="n">相談<br>万人対</th>
      <th data-k="pr" class="n">プラン<br>作成率</th>
      <th data-k="k" class="n">家計<br>改善</th>
      <th data-k="kr" class="n">対プラン</th>
      <th data-k="j" class="n">住居<br>確保</th>
    </tr></thead>
    <tbody id="jtb"></tbody>
  </table>
  </div>
  <p class="mini-note">表は枠の中でスクロールします（${rows.length}行）。「相談 万人対」は人口1万人あたりの<strong>年間</strong>相談件数です（国の公表欄は1か月あたりの数字なので、年度累計から計算し直しています）。「対プラン」は、支援プランを作った人のうち家計改善支援を使った割合です。</p>

  <h2>④ 家計の相談が使われている自治体・使われていない自治体</h2>
  <p>年${MIN_P}件以上のプランを作っている${bigP.length}機関にしぼっています（プランが少ないと率が跳ねるため）。中央値は${p1(medKr)}%です。</p>
  <h3>よく使われている15機関</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">新規相談</th><th class="n">プラン作成</th><th class="n">対プラン</th><th class="n">家計改善</th></tr></thead>
    <tbody>
${rank(krHi.slice(0, 15), 'kr', (v) => p1(v) + '%')}
    </tbody>
  </table>
  </div>
  <h3>使われていない15機関</h3>
  <div class="table-wrap">
  <table class="rank-table">
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">新規相談</th><th class="n">プラン作成</th><th class="n">対プラン</th><th class="n">家計改善</th></tr></thead>
    <tbody>
${rank(krLo.slice(0, 15), 'kr', (v) => p1(v) + '%')}
    </tbody>
  </table>
  </div>

  <h3>政令指定都市20を並べると、はっきり出ます</h3>
  <p>同じ規模の大都市でも、家計の相談がプランに組み込まれている割合はここまで違います。<strong>${seiTop.name}の${p1(seiTop.kr)}%に対して、${seiBtm.name}は${p1(seiBtm.kr)}%</strong>。${SEI_SAME_PREF}</p>
  <div class="table-wrap">
  <table class="rank-table">
    <caption>指定都市20　プラン作成者に対する家計改善支援の割合（${WAREKI(Y)}）</caption>
    <thead><tr><th>#</th><th>自治体</th><th>種別</th><th class="n">新規相談</th><th class="n">プラン作成</th><th class="n">対プラン</th><th class="n">家計改善</th></tr></thead>
    <tbody>
${rank(sei, 'kr', (v) => p1(v) + '%')}
    </tbody>
  </table>
  </div>

  <h2>⑤ 相談したあと、プランまで作ってもらえるか</h2>
  <p>相談を受けても、支援プランを作るところまで行くとは限りません。全国平均は<strong>${p1(cur.plan / cur.soudan * 100)}%</strong>。年${MIN_S}件以上の相談がある${bigS.length}機関では、<strong>${p1(prLo[0].pr)}%（${prLo[0].name}）から${p1(prHi[0].pr)}%（${prHi[0].name}）まで約${PR_HABA}倍</strong>開いています（中央値${p1(medPr)}%）。</p>
  <div class="callout note">
    <p><span class="tag">読み方の注意</span><strong>この差をそのまま「熱心さの差」と読むことはできません。</strong>いちばん大きい理由は<strong>相談の数え方が自治体で違う</strong>ことです。電話1本・窓口での一言を1件と数える自治体と、面接に至ったものだけを数える自治体では、分母が別物になります。分母が大きい自治体はプラン作成率が自動的に下がります。</p>
  </div>
  <div class="pairlist">
    <div><b>プラン作成率が高い側</b>${prHi.slice(0, 6).map((r) => `${r.name} ${p1(r.pr)}%`).join('／')}</div>
    <div><b>プラン作成率が低い側</b>${prLo.slice(0, 6).map((r) => `${r.name} ${p1(r.pr)}%`).join('／')}</div>
    <div><b>相談が多く起きている（人口1万対・年）</b>${spHi.slice(0, 6).map((r) => `${r.name} ${p1(r.sp)}`).join('／')}</div>
    <div><b>相談が少ない（人口1万対・年）</b>${spLo.slice(0, 6).map((r) => `${r.name} ${p1(r.sp)}`).join('／')}</div>
  </div>
  <p class="mini-note">人口1万人あたりの年間相談件数は中央値${p1(medSp)}件。上下で${p1(spHi[0].sp / spLo[0].sp)}倍の開きがあります。</p>

  <h2>⑥ 「生活保護に厳しい街は、困窮者支援にも冷たい」は成り立たない</h2>
  <p>同じ${rows.length}機関の区切りで、<a href="seikatsuhogo-shinsei-jichitai.html">生活保護の却下率</a>と突き合わせました（両方とも年${MIN_S}件以上ある${pair.length}機関）。</p>
  <p>結果は、<strong>プラン作成率と生活保護の却下率の相関は r=${R_TXT}</strong>。<strong>ほぼ無関係です。</strong>生活保護を通しにくい自治体が困窮者相談でも冷たい、という分かりやすい構図にはなっていません。<strong>この2つは別々に動いている運用</strong>なので、片方から他方を推測することはできません。自分の街について知りたければ、両方の表を別々に見てください。</p>
  <p class="mini-note">相関係数は−1から＋1までの値で、0に近いほど関係が無いことを示します。ここでは0.05にも届いていません。</p>

  <h2>⑦ この数字の限界（大事なところ）</h2>
  <ul>
    <li><strong>「0件」は「窓口が無い」ではありません。</strong>${JI_TXT ? `家計改善支援事業を実施しているのは${JI_TXT}。` : ''}実施していても利用が0、あるいは委託先で別に数えている場合があります。</li>
    <li><strong>相談の数え方が自治体でそろっていません。</strong>だから件数の多い少ないを、そのまま困窮の量や熱心さの差と読めません。</li>
    <li><strong>都道府県の行に指定都市・中核市は含まれません。</strong>県まるごとの数字ではありません。表では「○○市を除く」と書いています。</li>
    <li><strong>年度累計です。</strong>相談した人とプランを作った人、家計改善を使った人は同じ集団ではないので、割合は目安です。</li>
    <li><strong>一般市・町村は個別に載っていません。</strong>都道府県の行にまとめられています。国が自治体別に出しているのは都道府県・指定都市・中核市の${rows.length}機関までです。</li>
    <li><strong>国の公表表の「10万人あたり」は1か月あたりの数字です。</strong>年間と読み違えると12倍ずれます。このページでは年度累計から年あたりに計算し直しています。</li>
  </ul>

  <h2>⑧ 実際に相談するには</h2>
  <ul>
    <li><strong>探し方</strong>：「お住まいの市区町村名＋自立相談支援」で検索するか、市役所・区役所の福祉の窓口に「生活困窮者自立支援の相談窓口はどこですか」と聞いてください。社会福祉協議会に置かれていることも多いです。</li>
    <li><strong>費用</strong>：相談も家計改善支援も<strong>無料</strong>です。生活保護を受けていなくても、働いていても使えます。</li>
    <li><strong>持っていくもの</strong>：家計の話になるので、<strong>借入先と残高が分かるもの</strong>（明細・アプリの画面でも可）、家賃や光熱費が分かるもの、直近の給与明細があると早いです。無くても相談はできます。</li>
    <li><strong>債務整理が必要そうなとき</strong>：窓口から法テラスや弁護士・司法書士につないでもらえます。実際に<a href="jiko-hasan-chizu.html">自己破産や個人再生がどれくらい使われているかは都道府県別に集計しました</a>。法テラスには収入が一定以下の方向けに、費用を立て替える民事法律扶助があります。</li>
    <li><strong>家賃が払えないとき</strong>：同じ窓口で<strong>住居確保給付金</strong>（原則3か月・最長9か月、家賃額を上限に支給）の相談ができます。${WAREKI(Y)}の支給決定は全国${num(cur.jukyo)}件でした。</li>
  </ul>

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>債務整理まで進んだ人がどれくらいいるかは<a href="jiko-hasan-chizu.html">自己破産と個人再生の都道府県別データ</a>で。生活保護までは必要ない方は<a href="juminzei-hikazei-check.html">住民税非課税の判定</a>と<a href="kougaku-ryouyouhi-2026.html">高額療養費の計算機</a>を。生活保護を考えている方は<a href="seikatsuhogo-keisanki.html">支給額シミュレーター</a>と<a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>を。家賃を下げて立て直すなら<a href="koei-jutaku-bairitsu.html">公営住宅の倍率データ</a>と<a href="koei-hairiyasui.html">入りやすい人の条件</a>もどうぞ。</p>
  </div>

  <h2>コメント（自治体ごとの窓口の情報交換）</h2>
  <p class="mini-note">お住まいの自治体の窓口の様子を共有いただけると、同じ立場の方の助けになります。個人が特定される情報や、具体的な借入先・金額はお書きにならないでください。</p>
  <div id="cusdis_thread"
    data-host="https://cusdis.com"
    data-app-id="14dfe8f8-c660-42ee-9cd2-54ee31828ba9"
    data-page-id="shakkin-kakei-soudan"
    data-page-url="https://fukushiru.com/articles/shakkin-kakei-soudan.html"
    data-page-title="借金と家計の相談 自治体別">
  </div>
  <script async defer src="https://cusdis.com/js/cusdis.es.js"></script>

  <h2>出典</h2>
  <ul class="sources">
    <li>厚生労働省「生活困窮者自立支援制度支援状況調査」自治体別集計表（${WAREKI(D.years[0])}〜${WAREKI(Y)}） https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000092189.html</li>
    <li>厚生労働省「生活困窮者自立支援制度支援状況調査」集計結果（${WAREKI(Y)}）※全国合計の検算に使用</li>
    <li>厚生労働省「${WAREKI(Y)}の支援状況」${JI_TXT ? `（家計改善支援事業の実施状況＝${JI_TXT}、つなぎ先の内訳、利用者に見られた変化）` : '（つなぎ先の内訳、利用者に見られた変化）'}</li>
    <li>厚生労働省「被保護者調査（月次調査・確定値）」第18表（生活保護の却下率との突き合わせに使用） https://www.mhlw.go.jp/toukei/list/74-16b.html</li>
    <li>厚生労働省「生活困窮者自立支援制度」 https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000059425.html</li>
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは厚生労働省が公表している集計値をそのまま並べ、割合を計算したものです。<strong>特定の自治体の支援の当否を評価するものではありません。</strong>件数は相談の数え方の違いに左右され、数字だけで「熱心」「冷たい」と判断することはできません。実際に受けられる支援は必ずお住まいの自治体の窓口にご確認ください。<strong>借金の解決方法についての個別の助言はできません。</strong>数字の誤りにお気づきの場合は <a href="../about.html">このサイトについて</a> の連絡先までお知らせください。
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
