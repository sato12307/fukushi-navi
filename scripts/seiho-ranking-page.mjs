// ─────────────────────────────────────────────────────────────────────────────
// seiho-ranking-page.mjs — 「生活保護費の実質はどこが厚いか」の面を作る。
//   node scripts/seiho-ranking-page.mjs        → articles/seikatsuhogo-jisshitsu.html
//   node scripts/seiho-ranking-page.mjs --dry  → 書かずに主な数字だけ
//
// 前に回すもの: python scripts/seiho-area-build.py（data/seiho-ranking.json を作る）
//
// ★この面で言っていること
//   生活扶助の額は級地で決まる。級地は昭和62年から指定替えがされていない。
//   一方で物価も電気代も動く。だから「同じ級地でも実際に買える量は違う」。
//   ・生活扶助そのものの幅は 72,930〜76,420円（4.8%）しかない。
//   ・**電気代の幅は 9,610〜17,974円（1.87倍）** で、こちらのほうがずっと大きい。
//   ・電気代を払ったあとを全国平均の物価に直すと 55,000〜67,000円台まで開く。
//
// ★言ってはいけないこと
//   ①「ここに住めば得」— 生活保護は住む場所を選べる制度ではない。引っ越しには
//     福祉事務所の判断が要る。この面は**制度のゆがみを見るための物差し**であって、
//     引っ越し先の推薦ではない。そう書く。
//   ②**冬季加算を含んでいない**。11月〜3月などに地区別で上乗せがある。
//     寒い地域ほど厚いので、この表は寒冷地を実際より低く見せている。金額は出さない
//     （地区別の表を一次情報で取れていないため。推定して書かない）。
//   ③電気代は家計調査の**二人以上世帯**の値で、単身の額ではない。地域を比べるための
//     ものさしとして使っている。使用量の差（寒い地域は多く使う）も入っている。
//
// ★数字の出どころは艦隊の中にある
//   電気代＝発電ベンチ（hatsudenbench.com）が持っている家計調査の県庁所在市別。
//   東京の町ごとの暮らし＝住環境データ東京（living-environments.com）。どちらへも導線を張る。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'data', 'seiho-ranking.json')
const OUT = path.join(ROOT, 'articles', 'seikatsuhogo-jisshitsu.html')
const DRY = process.argv.includes('--dry')
// ★toISOString() はUTC。日本時間の朝は前日の日付になる（実際に1日ずれた）。JSTに直す。
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

const D = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const num = (n) => Number(Math.round(n)).toLocaleString('ja-JP')
const p1 = (x) => (Math.round(x * 10) / 10).toFixed(1)

const rows = D.rows.map((r) => ({
  ...r,
  real: r.seikatsu / (r.bukka / 100),                                   // 物価で割り戻した生活扶助
  afterE: r.denkiMonth ? (r.seikatsu - r.denkiMonth) / (r.bukka / 100) : null, // 電気代を払ったあと
})).filter((r) => r.afterE != null)
rows.sort((a, b) => b.afterE - a.afterE)

const top = rows[0]
const bottom = rows[rows.length - 1]
const gap = top.afterE - bottom.afterE
const sMin = Math.min(...rows.map((r) => r.seikatsu))
const sMax = Math.max(...rows.map((r) => r.seikatsu))
const eMin = rows.reduce((a, b) => (a.denkiMonth < b.denkiMonth ? a : b))
const eMax = rows.reduce((a, b) => (a.denkiMonth > b.denkiMonth ? a : b))
// 級地が下なのに実質が上、という組（制度のゆがみがいちばん見える例）
let flip = null
for (const a of rows) {
  for (const b of rows) {
    if (a.kyuchi > b.kyuchi && a.afterE > b.afterE + 1000) { flip = [a, b]; break }
  }
  if (flip) break
}
const withRent = rows.filter((r) => r.jutaku)

if (DRY) {
  console.log(`${rows.length}市 / 電気代を引いた実質 ${num(bottom.afterE)}〜${num(top.afterE)}（差 ${num(gap)}円）`)
  console.log(`生活扶助 ${num(sMin)}〜${num(sMax)}（${p1((sMax / sMin - 1) * 100)}%） / 電気代 ${num(eMin.denkiMonth)}（${eMin.city}）〜${num(eMax.denkiMonth)}（${eMax.city}）＝${p1(eMax.denkiMonth / eMin.denkiMonth)}倍`)
  if (flip) console.log(`逆転: ${flip[0].city}(${flip[0].kyuchi}) ${num(flip[0].afterE)} > ${flip[1].city}(${flip[1].kyuchi}) ${num(flip[1].afterE)}`)
  console.log(`家賃上限まである市 ${withRent.length}`)
  process.exit(0)
}

const payload = JSON.stringify({
  rows: rows.map((r) => ({
    c: r.city, p: r.pref, k: r.kyuchi, s: r.seikatsu, b: r.bukka,
    e: r.denkiMonth, j: r.jutaku, u: r.jukyo, r: Math.round(r.real), a: Math.round(r.afterE),
  })),
})

const CSS = `
.stat-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 1em 0; }
.stat { flex: 1 1 165px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--soft); }
.stat b { display: block; font-size: 1.4rem; font-weight: 800; color: var(--brand-dark); font-variant-numeric: tabular-nums; }
.stat span { font-size: .82rem; color: var(--sub); }
#rt-wrap { max-height: 72vh; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
#rt { width: 100%; border-collapse: collapse; font-size: .85rem; min-width: 700px; }
#rt th, #rt td { border-bottom: 1px solid var(--line); padding: 5px 6px; }
#rt thead th { position: sticky; top: 0; z-index: 1; background: var(--brand); color: #fff; cursor: pointer; white-space: nowrap; font-size: .8rem; line-height: 1.35; }
#rt thead th.sorted::after { content: " \\25BC"; font-size: .7em; }
#rt thead th.sorted.asc::after { content: " \\25B2"; }
#rt td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#rt td.big { font-weight: 800; }
#rt tbody th { text-align: left; font-weight: 600; white-space: nowrap; }
#rt tbody td { white-space: nowrap; }
.mini-note { font-size: .84rem; color: var(--sub); }
`

const JS = `
var R = ${payload}.rows;
(function () {
  var tb = document.getElementById('rtb');
  var ths = document.querySelectorAll('#rt thead th');
  var key = 'a', asc = false;
  function ja(n) { return n == null ? '—' : Number(n).toLocaleString('ja-JP'); }
  function draw() {
    var list = R.slice().sort(function (x, y) {
      var a = x[key], b = y[key];
      if (typeof a === 'string') return asc ? a.localeCompare(b, 'ja') : b.localeCompare(a, 'ja');
      if (a == null) return 1; if (b == null) return -1;
      return asc ? a - b : b - a;
    });
    tb.innerHTML = list.map(function (r, i) {
      return '<tr><td class="n">' + (i + 1) + '</td><th>' + r.c + '</th><td>' + r.k + '</td>'
        + '<td class="n">' + ja(r.s) + '</td><td class="n">' + r.b + '</td><td class="n">' + ja(r.r) + '</td>'
        + '<td class="n">' + ja(r.e) + '</td><td class="n big">' + ja(r.a) + '</td>'
        + '<td class="n">' + ja(r.j) + '</td><td class="n">' + (r.u == null ? '—' : r.u) + '</td></tr>';
    }).join('');
  }
  Array.prototype.forEach.call(ths, function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (key === k) asc = !asc; else { key = k; asc = (k === 'c' || k === 'k'); }
      Array.prototype.forEach.call(ths, function (o) { o.className = o.className.replace(/(^|\\s)(sorted|asc)/g, ''); });
      th.className = (th.className + ' sorted' + (asc ? ' asc' : '')).trim();
      draw();
    });
  });
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
<title>生活保護費の「実質」はどこが厚いか【${rows.length}市・物価と電気代で割り戻し】｜フクシル</title>
<meta name="description" content="生活扶助の額は級地で決まりますが、級地は昭和62年から指定替えがされていません。全国${rows.length}市について、生活扶助を地域の物価（家賃を除く総合）で割り戻し、電気代を払ったあとに残る額を並べました。生活扶助そのものの差は${p1((sMax / sMin - 1) * 100)}%ですが、電気代の差は${p1(eMax.denkiMonth / eMin.denkiMonth)}倍あり、実質では月${num(gap)}円ひらきます。">
<link rel="canonical" href="https://fukushiru.com/articles/seikatsuhogo-jisshitsu.html">
<meta property="og:type" content="article">
<meta property="og:title" content="生活保護費の「実質」はどこが厚いか【${rows.length}市】">
<meta property="og:description" content="生活扶助の差は${p1((sMax / sMin - 1) * 100)}%。でも電気代の差は${p1(eMax.denkiMonth / eMin.denkiMonth)}倍。物価と電気代で割り戻すと月${num(gap)}円ひらきます。">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="https://fukushiru.com/articles/seikatsuhogo-jisshitsu.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css?v=20260908a">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "生活保護費の「実質」はどこが厚いか【${rows.length}市・物価と電気代で割り戻し】",
  "description": "生活扶助を地域の消費者物価地域差指数で割り戻し、電気代を差し引いた実質額を全国${rows.length}市で比較した。",
  "inLanguage": "ja",
  "datePublished": "${TODAY}",
  "dateModified": "${TODAY}",
  "author": { "@type": "Organization", "name": "フクシル" },
  "publisher": { "@type": "Organization", "name": "フクシル" },
  "url": "https://fukushiru.com/articles/seikatsuhogo-jisshitsu.html",
  "mainEntityOfPage": "https://fukushiru.com/articles/seikatsuhogo-jisshitsu.html",
  "isPartOf": { "@type": "WebSite", "name": "フクシル", "url": "https://fukushiru.com/" }
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
      <a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>
      <a href="juminzei-hikazei-check.html">住民税非課税</a>
      <a href="koei-jutaku-bairitsu.html">公営住宅</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 生活保護 ＞ 実質の比較</p>

  <h1>生活保護費の「実質」は<br>どこが厚いか</h1>
  <p class="updated">最終更新：${TODAY} ／ 生活扶助＝厚生労働省 令和8年度基準（単身30歳）、物価＝総務省 小売物価統計調査（構造編）2024年、電気代＝総務省 家計調査（<a href="https://hatsudenbench.com/denkidai/">発電ベンチ</a>の集計）</p>

  <p class="lead">生活扶助の額は<strong>級地</strong>で決まります。ところが級地の指定は<strong>昭和62年から替わっていません</strong>。物価も電気代もその間に動いています。そこで、全国${rows.length}市について<strong>生活扶助を地域の物価で割り戻し、電気代を払ったあとに何円残るか</strong>を並べました。</p>

  <div class="stat-row">
    <div class="stat"><b>${p1((sMax / sMin - 1) * 100)}%</b><span>生活扶助そのものの差（${num(sMin)}〜${num(sMax)}円）</span></div>
    <div class="stat"><b>${p1(eMax.denkiMonth / eMin.denkiMonth)}倍</b><span>電気代の差（${eMin.city}${num(eMin.denkiMonth)}円〜${eMax.city}${num(eMax.denkiMonth)}円）</span></div>
    <div class="stat"><b>${num(gap)}円</b><span>実質でひらく差（月あたり）</span></div>
    <div class="stat"><b>${rows.length}市</b><span>県庁所在市と政令市</span></div>
  </div>

  <div class="callout warn">
    <p><span class="tag">先に読んでください</span><strong>これは「どこに住めば得か」の表ではありません。</strong>生活保護は住む場所を選べる制度ではなく、転居には福祉事務所の判断が要ります。この表は<strong>「同じ制度なのに、実際に買える量がどれだけ違うか」を見るための物差し</strong>です。</p>
    <p><strong>冬季加算を含んでいません。</strong>11月〜3月などの期間、地区別に暖房費の上乗せがあります。寒い地域ほど厚いので、<strong>この表は寒冷地を実際より低く見せています</strong>。金額は地区と世帯人員で決まるため、ここでは金額を出していません（一次情報で地区別の表を確認できていないので、推定して書きません）。お住まいの地区の額は福祉事務所で確認してください。</p>
  </div>

  <h2>① 生活扶助の差より、電気代の差のほうが大きい</h2>
  <p>級地で決まる生活扶助は、${num(sMin)}円（2級地-1）から${num(sMax)}円（1級地-1）まで<strong>${p1((sMax / sMin - 1) * 100)}%</strong>しか違いません。ところが同じ月の電気代は<strong>${eMin.city}の${num(eMin.denkiMonth)}円から${eMax.city}の${num(eMax.denkiMonth)}円まで${p1(eMax.denkiMonth / eMin.denkiMonth)}倍</strong>ひらきます。<strong>制度が地域差として認めている幅より、電気代の地域差のほうがずっと大きい</strong>ということです。</p>
  ${flip ? `<p>その結果、<strong>級地が下なのに実質は上</strong>という組み合わせが起きます。たとえば<strong>${flip[0].city}（${flip[0].kyuchi}）は${num(flip[0].afterE)}円</strong>で、<strong>${flip[1].city}（${flip[1].kyuchi}）の${num(flip[1].afterE)}円</strong>を上回ります。級地は${flip[1].city}のほうが上なのに、電気代と物価まで見ると逆になります。</p>` : ''}

  <h2>② ${rows.length}市の表（見出しを押すと並べ替わります）</h2>
  <p>「実質の生活扶助」は<strong>生活扶助 ÷ 物価指数</strong>。「電気代を引いた実質」は<strong>（生活扶助 − 電気代）÷ 物価指数</strong>です。物価指数は全国平均を100とした値で、家賃を除いた総合を使っています（家賃は住宅扶助で別に出るため）。</p>
  <div id="rt-wrap">
  <table id="rt">
    <thead><tr>
      <th data-k="a">#</th>
      <th data-k="c">市</th>
      <th data-k="k">級地</th>
      <th data-k="s">生活扶助</th>
      <th data-k="b">物価<br>(家賃除く)</th>
      <th data-k="r">実質の<br>生活扶助</th>
      <th data-k="e">電気代<br>(月)</th>
      <th data-k="a">電気代を<br>引いた実質</th>
      <th data-k="j">家賃上限<br>(単身)</th>
      <th data-k="u">住居の<br>物価</th>
    </tr></thead>
    <tbody id="rtb"></tbody>
  </table>
  </div>
  <p class="mini-note">家賃上限は公表を確認できた${withRent.length}市だけ入っています（<a href="seikatsuhogo-keisanki.html">計算機のページ</a>と同じ数字）。「住居の物価」は都道府県の値です（市別の公表がないため）。電気代は<strong>二人以上世帯</strong>の値で、単身の額ではありません。地域を比べるためのものさしとして使っています。</p>

  <h2>③ 実質が厚い5市・薄い5市</h2>
  <div class="table-wrap">
  <table>
    <caption>電気代を引いた実質（単身30歳・月額）</caption>
    <thead><tr><th>#</th><th>市</th><th>級地</th><th>生活扶助</th><th>物価</th><th>電気代</th><th>電気代を引いた実質</th></tr></thead>
    <tbody>
${rows.slice(0, 5).map((r, i) => `      <tr><td>${i + 1}</td><th>${r.city}</th><td>${r.kyuchi}</td><td>${num(r.seikatsu)}円</td><td>${r.bukka}</td><td>${num(r.denkiMonth)}円</td><td><strong>${num(r.afterE)}円</strong></td></tr>`).join('\n')}
      <tr><td colspan="7" style="text-align:center">…</td></tr>
${rows.slice(-5).map((r, i) => `      <tr><td>${rows.length - 4 + i}</td><th>${r.city}</th><td>${r.kyuchi}</td><td>${num(r.seikatsu)}円</td><td>${r.bukka}</td><td>${num(r.denkiMonth)}円</td><td><strong>${num(r.afterE)}円</strong></td></tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p class="mini-note">下位に並ぶのは雪の多い地域です。<strong>ここには冬季加算が乗ります</strong>（この表には入れていません）。上の差がそのまま暮らしの差になるわけではない、という点は繰り返しておきます。</p>

  <h2>④ この数字の限界</h2>
  <ul>
    <li><strong>冬季加算を含んでいません。</strong>寒い地域ほど上乗せがあるので、寒冷地は実際より低く出ています。</li>
    <li><strong>電気代は二人以上世帯の値です。</strong>単身の額ではありません。また価格差だけでなく<strong>使用量の差</strong>（寒い地域は多く使う）も入っています。</li>
    <li><strong>物価指数と電気代は一部が重なります。</strong>「家賃を除く総合」には光熱・水道の価格も含まれるので、電気代を実額で引いたうえで物価で割ると、電気の価格差がやや二重に効きます。だから<strong>電気代を引く前の「実質の生活扶助」も並べて</strong>います。</li>
    <li><strong>対象は県庁所在市と政令市だけです。</strong>物価の地域差指数がこの単位でしか公表されていないためです。</li>
    <li><strong>家賃上限は${withRent.length}市ぶんしかありません。</strong>住宅扶助の限度額は国が実施機関ごとに定めていますが、Webに出していない自治体が多くあります。</li>
    <li><strong>単身30歳の場合の計算です。</strong>世帯人数や年齢が変われば額も変わります。<a href="seikatsuhogo-keisanki.html">計算機</a>でご自身の世帯の額を出せます。</li>
  </ul>

  <div class="callout note">
    <p><span class="tag">もっと細かく見る</span>電気代の地域差は<a href="https://hatsudenbench.com/denkidai/">発電ベンチ（電気代のページ）</a>に、県庁所在市ごとの使用量と単価まで出ています。東京にお住まいなら、<a href="https://living-environments.com/">住環境データ東京</a>で<strong>町丁目ごとの世帯数・住宅侵入の件数</strong>まで見られます。どちらも当方が作っている無料のサイトです。</p>
  </div>

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>ご自身の世帯の額は<a href="seikatsuhogo-keisanki.html">生活保護の支給額シミュレーター</a>（全国の市区町村に対応）。申請が通るかどうかは<a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>で。家賃を下げるなら<a href="koei-jutaku-bairitsu.html">公営住宅の倍率データ</a>もどうぞ。</p>
  </div>

  <h2>出典</h2>
  <ul class="sources">
    <li>厚生労働省「生活保護制度における生活扶助基準額の算出方法（令和8年4月）」 https://www.mhlw.go.jp/content/001152601.pdf</li>
    <li>厚生労働省「お住まいの地域の級地を確認」（級地区分・平成30年10月1日現在） https://www.mhlw.go.jp/content/kyuchi.3010.pdf</li>
    <li>総務省統計局「小売物価統計調査（構造編）2024年 消費者物価地域差指数」 https://www.stat.go.jp/data/kouri/kouzou/index.html</li>
    <li>総務省統計局「家計調査（家計収支編・二人以上の世帯）品目別 都道府県庁所在市及び政令指定都市ランキング」 https://www.stat.go.jp/data/kakei/5.html （集計は<a href="https://hatsudenbench.com/denkidai/">発電ベンチ</a>）</li>
    <li>住宅扶助の限度額：各都道府県・指定都市・中核市の公表資料（<a href="seikatsuhogo-keisanki.html">計算機のページ</a>に自治体ごとの出典）</li>
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは公開されている統計を組み合わせた<strong>試算</strong>です。実際に受け取る額は世帯の事情によって決まり、冬季加算・一時扶助・各種加算はここに入っていません。<strong>住む場所を勧めるものではありません</strong>。受給の可否や金額は必ずお住まいの福祉事務所でご確認ください。
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
console.log(`書いた: ${OUT}  (${(html.length / 1024).toFixed(1)}KB / ${rows.length}市)`)
