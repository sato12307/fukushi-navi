// ─────────────────────────────────────────────────────────────────────────────
// mutei-page.mjs — 「無料低額宿泊所とは」の面を作る（救護施設・日常生活支援住居施設との違いと、保護費から手元に残る額）。
//   node scripts/mutei-page.mjs        → articles/muryou-teigaku-shukuhakusho.html と sitemap.xml の1行
//   node scripts/mutei-page.mjs --dry  → 書かずに確かめの結果と主な数字だけ
//
// ★なぜ（2026-10-09 ユーザー「フクシルも検索回数を見たうえで実装して」）
//   Bing の90日の実測＝無料低額宿泊所 1,151・無料低額宿泊所とは 213・日常生活支援住居施設 246。関連語に救護施設 1,179。
//   上位は自治体のページと厚労省の PDF で、送客の業者はいない。読む人は住まいを失いかけている生活保護の申請者と家族、支援者。
//   ★施設の実名は出さない（2026-10-09 ユーザー裁定 v303(4)）。並べるのは制度の違い・決まり・級地ごとの生活扶助と計算だけ。
//
// ★生活扶助の式はここに書かない。articles/seikatsuhogo-keisanki.html（生活保護の計算機）の基準額表をそのまま読み込み、
//   単身の額だけを出す。読み込んだ結果が、①計算機のページの早見表 ②data/seiho-ranking.json（scripts/seiho-area-build.py が
//   同じ表の写しで計算した単身30歳の額）の両方と1円まで合わなければ、何も書かずに止める（基準額の改定で片方だけ直したときに気づく）。
//
// ★決まりの文は、どれも条文・通知の原文で確かめたものだけ（2026-10-09 に厚労省の法令等データベースと e-Gov で原文を確認）。
//   言い切らないもの＝住宅扶助の床面積別の減額の割合（原文の表を確かめられていない）・救護施設のお金の細目・施設ごとの利用料の相場。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const SLUG = 'muryou-teigaku-shukuhakusho.html'
const OUT = path.join(ROOT, 'articles', SLUG)
const URL = `https://fukushiru.com/articles/${SLUG}`
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const PUBLISHED = '2026-10-09'
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const num = (n) => Math.round(n).toLocaleString('ja-JP')
const yen = (n) => `${num(n)}円`

// ── 生活扶助の基準額表（生活保護の計算機のページから読み込む）─────────────────────────────
const KEISAN = fs.readFileSync(path.join(ROOT, 'articles', 'seikatsuhogo-keisanki.html'), 'utf8').replace(/\r/g, '')
const a = KEISAN.indexOf('// ====== 令和8年4月 生活扶助基準額')
const b = KEISAN.indexOf('// ====== 地域（級地と家賃上限）', a)
const f = KEISAN.indexOf('function ageIdx(age)', b)
if (a < 0 || b < 0 || f < 0) die('計算機のページから基準額表を切り出せません（見出しの文が変わった？）')
const fEnd = KEISAN.indexOf('\n', f)
const T = vm.runInNewContext(`${KEISAN.slice(a, b)}\n${KEISAN.slice(f, fEnd)}\n;({ K1, TEIGEN, K2, TOKUREI, KEIKA, ageIdx })`)
// 単身（1人世帯）の生活扶助＝計算機の calc() と同じ積み上げ（第1類×逓減率〈1人は1.0〉＋第2類＋経過的加算＋特例加算）
const single = (ki, age) => Math.round(T.K1[T.ageIdx(age)].v[ki] * T.TEIGEN[0]) + T.K2[0] + T.KEIKA[1][T.ageIdx(age)][ki] + T.TOKUREI
const KY = ['1級地-1', '1級地-2', '2級地-1', '2級地-2', '3級地-1', '3級地-2']

// 確かめ①：計算機のページの早見表（単身20〜40歳）と1円まで
{
  const t0 = KEISAN.indexOf('<table class="city-table">'), b0 = KEISAN.indexOf('<tbody>', t0), b1 = KEISAN.indexOf('</tbody>', b0)
  const rows = [...KEISAN.slice(b0, b1).matchAll(/<tr><th>([^<]+)<\/th><td>([^<]+)<\/td><td>([\d,]+)円<\/td>/g)]
  if (rows.length < 10) die(`計算機の早見表が読めません（${rows.length}行）`)
  for (const [, city, k, v] of rows) {
    const ki = KY.indexOf(k)
    if (ki < 0) die(`早見表の級地が読めません：${city} ${k}`)
    if (single(ki, 30) !== Number(v.replace(/,/g, ''))) die(`計算機の早見表と合いません：${city}（${k}）表 ${v} ／ 計算 ${single(ki, 30)}`)
  }
}
// 確かめ②：data/seiho-ranking.json（Python の写しで計算した単身30歳）と1円まで
{
  const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seiho-ranking.json'), 'utf8')).rows
  for (const r of R) {
    const ki = KY.indexOf(r.kyuchi)
    if (single(ki, 30) !== r.seikatsu) die(`生活保護の実質のデータと合いません：${r.city}（${r.kyuchi}）データ ${r.seikatsu} ／ 計算 ${single(ki, 30)}（scripts/seiho-area-build.py の基準額表か特例加算が計算機とずれている）`)
  }
}

// ── 表と計算機に載せる額（単身・大人の年齢帯ごと）──────────────────────────────────────
//   計算機の年齢帯（第1類の行）をそのまま使う。18歳未満は単身の施設入居を扱わない
const BANDS = T.K1.map((row, i) => ({ max: row.max, min: i ? T.K1[i - 1].max + 1 : 0 })).filter((x) => x.max >= 18)
const bandLabel = (x) => (x.max >= 999 ? `${x.min}歳以上` : `${Math.max(18, x.min)}〜${x.max}歳`)
const TBL = BANDS.map((x) => ({ max: x.max, label: bandLabel(x), v: KY.map((_, ki) => single(ki, x.max >= 999 ? 80 : x.max)) }))
// 表に出す年齢帯（スマホで4列に収める）
const SHOW = [40, 59, 69, 999]
const tableRows = KY.map((k, ki) => `<tr><th>${k}</th>${SHOW.map((m) => `<td>${num(TBL.find((x) => x.max === m).v[ki])}</td>`).join('')}</tr>`).join('\n      ')
const top = { y: single(0, 30), o: single(0, 80), low: single(5, 30) }

// ── 出典 ─────────────────────────────────────────────────────────────────────
const SRC = {
  shafuku: { name: '社会福祉法 第2条第3項第8号（e-Gov法令検索）', url: 'https://laws.e-gov.go.jp/law/326AC0000000045' },
  seiho: { name: '生活保護法 第30条・第38条（e-Gov法令検索）', url: 'https://laws.e-gov.go.jp/law/325AC0000000144' },
  kijun: { name: '無料低額宿泊所の設備及び運営に関する基準（令和元年厚生労働省令第34号・厚生労働省 法令等データベース）', url: 'https://www.mhlw.go.jp/web/t_doc?dataId=82ab7151&dataType=0&pageNo=1' },
  nichijo: { name: '日常生活支援住居施設に関する厚生労働省令で定める要件等を定める省令（令和2年厚生労働省令第44号）', url: 'https://www.mhlw.go.jp/web/t_doc?dataId=82ab7435&dataType=0&pageNo=1' },
  jutaku: { name: '「生活保護法による住宅扶助の認定について」（平成27年4月14日 社援保発第414002号・厚生労働省社会・援護局保護課長通知）', url: 'https://www.mhlw.go.jp/web/t_doc?dataId=00tc1033&dataType=1&pageNo=1' },
  kokuji: { name: '生活保護法による保護の基準（告示・特例加算 月額2,500円は令和8年10月1日から）', url: 'https://www.mhlw.go.jp/web/t_doc?dataId=82051000&dataType=0' },
  santei: { name: '厚生労働省「生活保護制度における生活扶助基準額の算出方法（令和8年4月）」', url: 'https://www.mhlw.go.jp/content/001152601.pdf' },
}
const link = (s) => `<a href="${s.url}" rel="nofollow">${s.name}</a>`

// ── よくある質問（本文とJSON-LDで同じ文を使う）──────────────────────────────────────────
const FAQ = [
  ['無料低額宿泊所とは何ですか？', '生計困難者のために、無料または低額な料金で、簡易住宅を貸したり、宿泊所などの施設を利用させたりする事業の施設です（社会福祉法 第2条第3項第8号の第二種社会福祉事業）。国の基準では「基本的に一時的な居住の場」とされ、入居者が自分で暮らせるか常に確かめ、退居を手伝うことが求められています（無料低額宿泊所の設備及び運営に関する基準 第3条）。'],
  ['救護施設との違いは何ですか？', '救護施設は生活保護法の「保護施設」で、身体上または精神上著しい障害があるために日常生活を営むことが困難な人が入所し、施設で生活扶助を受けます（生活保護法 第38条）。無料低額宿泊所は社会福祉法の事業で、入居者と施設が文書で契約し、生活保護を受けている人は保護費から利用料を払います。'],
  ['日常生活支援住居施設とは何ですか？', '無料低額宿泊所などのうち、都道府県知事が認めた施設で、福祉事務所が日常生活上の支援を委託します（生活保護法 第30条）。入るのは、福祉事務所が支援が必要と判断した人で、入所を希望している人です（令和2年厚生労働省令第44号 第7条）。生活支援員は、入所定員15人につき1人以上置く決まりです（同 第10条）。'],
  ['無料低額宿泊所に入ると、生活保護費は手元にいくら残りますか？', `生活扶助から、施設に払う食費・光熱水費・日用品費などを引いた額が残ります。生活扶助はひとり暮らしの20〜40歳で、1級地-1なら月${yen(top.y)}、3級地-2なら月${yen(top.low)}です（令和8年10月から・冬季加算を除く）。居室使用料（家賃）は住宅扶助から払い、上限を超えた分は生活扶助から払うことになります。`],
  ['無料低額宿泊所を出たいときはどうしますか？', '国の基準では、入居者が解約を申し入れたときは速やかに契約を終える旨を、契約に定めなければならないとされています（同基準 第14条第5項）。施設が保証人を立てさせることも禁じられています（同 第6項）。次の住まいは、福祉事務所（担当のケースワーカー）に相談してください。'],
]

// ── 計算機（ブラウザ）。式は持たない＝表の額（ビルドが計算機のページから出した額）と住宅扶助の上限を引き算するだけ ─────
const JS = `(function(){
  var TBL = ${JSON.stringify(TBL.map((x) => [x.max, x.v]))};
  var KYN = ${JSON.stringify(KY)};
  function yen(n){ return Math.round(n).toLocaleString('ja-JP') + '円'; }
  function val(id){ var v = parseFloat(String(document.getElementById(id).value).replace(/,/g, '')); return isNaN(v) ? null : v; }
  var A = null, prefSel = document.getElementById('mt-pref'), muniSel = document.getElementById('mt-muni');
  function rowNow(){ return A ? (A.p[prefSel.value] || [])[parseInt(muniSel.value, 10)] : null; }
  function calc(){
    var out = document.getElementById('mt-out'), row = rowNow();
    var age = parseInt(document.getElementById('mt-age').value, 10);
    if (!row || isNaN(age) || age < 18 || age > 110){ out.innerHTML = '<p class="mini-note">住所と年齢（18歳以上）を入れると、ここに結果が出ます。</p>'; return; }
    var ki = row[1], band = null;
    for (var i = 0; i < TBL.length; i++){ if (age <= TBL[i][0]) { band = TBL[i]; break; } }
    var seikatsu = band[1][ki];
    var fee = val('mt-fee') || 0, rent = val('mt-rent') || 0;
    var cap = row[2] >= 0 ? A.r[row[2]][0] : null;
    var over = cap === null ? 0 : Math.max(0, rent - cap);
    var left = seikatsu - fee - over;
    var h = '<div class="mt-res"><p class="mt-big">手元に残るのは 月 <strong>' + yen(left) + '</strong></p>'
      + '<p class="mini-note">' + row[0] + '（' + KYN[ki] + '）・' + age + '歳・ひとり暮らしの生活扶助 ' + yen(seikatsu)
      + ' − 施設に払う額 ' + yen(fee) + (over ? ' − 家賃が住宅扶助の上限（' + yen(cap) + '）を超える分 ' + yen(over) : '') + '</p>';
    if (cap === null) h += '<p class="mini-note">' + row[0] + 'の住宅扶助の上限は、まだ確かめられていません。家賃が上限の中に収まる前提で計算しています（超えた分は生活扶助から払うことになります）。上限は福祉事務所で確かめてください。</p>';
    else h += '<p class="mini-note">家賃（居室使用料）は住宅扶助から払います。' + row[0] + 'のひとり暮らしの上限は ' + yen(cap) + '（居室が狭いと上限が下がる決まりがあります）。</p>';
    if (left < 0) h += '<p class="mini-note"><strong>生活扶助より施設に払う額のほうが多くなっています。</strong>契約の前に、福祉事務所に費用の中身を確かめてください。</p>';
    out.innerHTML = h + '</div>';
  }
  function fillMunis(){
    muniSel.innerHTML = '';
    (A.p[prefSel.value] || []).forEach(function(row, i){ var o = document.createElement('option'); o.value = i; o.textContent = row[0]; muniSel.appendChild(o); });
    calc();
  }
  function start(){
    A = window.SEIHO_AREA || null;
    if (!A){ document.getElementById('mt-out').innerHTML = '<p class="mini-note">地域の一覧を読み込めませんでした。下の級地の表で確かめてください。</p>'; return; }
    Object.keys(A.p).forEach(function(pn){ var o = document.createElement('option'); o.value = pn; o.textContent = pn; prefSel.appendChild(o); });
    prefSel.value = '東京都'; fillMunis();
    prefSel.addEventListener('change', fillMunis);
    ['mt-muni', 'mt-age', 'mt-fee', 'mt-rent'].forEach(function(id){ document.getElementById(id).addEventListener('input', calc); document.getElementById(id).addEventListener('change', calc); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`

const CSS = `table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit tbody th{white-space:nowrap}table.fit td.num,table.fit th.num{white-space:normal;word-break:keep-all}.mini-note{font-size:.86rem;color:var(--sub)}
.mt-form{background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:10px 14px;margin:12px 0}
.mt-form .row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:8px 0}
.mt-form label{flex:1 1 200px;font-size:.92rem}
.mt-form select,.mt-form input{font:inherit;font-size:16px;padding:6px 8px;border:1px solid #cfd6e0;border-radius:8px;min-width:0;max-width:100%}
.mt-form input{width:8em}
.mt-form select{flex:1 1 200px}
.mt-res{border-left:5px solid #0b6b45;background:#f3faf6;border-radius:10px;padding:10px 14px;margin:10px 0}
.mt-big{font-size:1.08rem;margin:0 0 6px}.mt-big strong{font-size:1.3rem;color:#0b6b45}
.fac h3{margin-top:22px}`

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const TITLE = '無料低額宿泊所とは？救護施設・日常生活支援住居施設との違いと、生活保護費から手元に残る額【2026年度】'
const DESC = `無料低額宿泊所は、生活に困っている人が無料か安い料金で住める施設（社会福祉法の第二種社会福祉事業）です。生活保護を受けて入ると、保護費は本人に支払われ、そこから食費や光熱水費などの利用料を払います。救護施設・日常生活支援住居施設との違い、利用料として払う費用、級地別の生活扶助の額（1級地-1の20〜40歳で月${num(top.y)}円）、手元に残る額の計算を、法令と厚生労働省の通知の原文からまとめました。`

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${TITLE}｜フクシル</title>
<meta name="description" content="${esc(DESC)}">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="article">
<meta property="og:title" content="無料低額宿泊所とは？救護施設との違いと、手元に残る額">
<meta property="og:description" content="${esc(`保護費は本人に支払われ、施設には食費・光熱水費などの利用料を払います。級地別の生活扶助と、手元に残る額の計算。`)}">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${URL}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css?v=20260908a">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: TITLE, description: DESC, inLanguage: 'ja', datePublished: PUBLISHED, dateModified: TODAY, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' }, url: URL, mainEntityOfPage: URL, isPartOf: { '@type': 'WebSite', name: 'フクシル', url: 'https://fukushiru.com/' } }, null, 1)}
</script>
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })) }, null, 1)}
</script>
<style>${CSS}</style>
<script src="../assets/seiho-area.js?v=20260923a"></script>
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
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 生活保護 ＞ 無料低額宿泊所</p>

  <h1>無料低額宿泊所とは？<br>救護施設との違いと、手元に残るお金</h1>
  <p class="updated">最終更新：${TODAY} ／ 法令と厚生労働省の通知の原文で確かめた内容です。生活扶助は令和8年10月からの基準（特例加算2,500円を含む・冬季加算を除く）</p>

  <p class="lead">住まいを失いかけて生活保護を申請すると、<strong>無料低額宿泊所</strong>を紹介されることがあります。どんな施設で、保護費はどう払われ、手元にいくら残るのか。<strong>救護施設</strong>・<strong>日常生活支援住居施設</strong>との違いとあわせて、法令と国の通知の原文からまとめました。<strong>特定の施設の名前や評判は載せていません。</strong></p>

  <div class="callout point">
    <p><span class="tag">まず結論</span><strong>無料低額宿泊所</strong>は、生計困難者のために、無料か低額な料金で宿泊所などを利用させる事業の施設です（社会福祉法 第2条第3項第8号）。国の基準では「<strong>基本的に一時的な居住の場</strong>」とされています（基準 第3条）。</p>
    <p>生活保護を受けて入ると、<strong>保護費は施設でなく本人に支払われ</strong>（厚生労働省の通知）、本人が施設に利用料を払います。手元に残るのは「<strong>生活扶助 − 施設に払う食費・光熱水費など</strong>」です。</p>
    <p><strong>入るかどうかは本人が決めます。</strong>生活保護法は、本人の意に反して施設への入所を強制できないと定めています（生活保護法 第30条第2項）。</p>
  </div>

  <h2>① 3つの施設の違い</h2>
  <div class="fac">
  <h3>無料低額宿泊所</h3>
  <ul>
    <li><strong>根拠</strong>：社会福祉法の第二種社会福祉事業（第2条第3項第8号）。設備と運営は国の基準（令和元年厚生労働省令第34号）をもとに、都道府県などが条例で決めます。</li>
    <li><strong>入り方</strong>：本人と施設が契約します。入る前に重要事項を書いた文書で説明を受け、<strong>居室の契約と、それ以外のサービスの契約を、それぞれ文書で結びます</strong>（基準 第14条第1項）。</li>
    <li><strong>居室</strong>：原則1人1室で、床面積は収納を除いて7.43平方メートル以上（地域の事情があれば4.95平方メートル以上）（基準 第12条）。</li>
    <li><strong>支援</strong>：原則として1日1回以上、居室を訪ねるなどして状況を確かめます（基準 第20条）。</li>
    <li><strong>お金</strong>：生活保護を受けている人は、保護費から利用料を払います（次の②）。</li>
  </ul>
  <h3>日常生活支援住居施設</h3>
  <ul>
    <li><strong>根拠</strong>：無料低額宿泊所などのうち、<strong>都道府県知事が認めた施設</strong>です（生活保護法 第30条第1項・令和2年厚生労働省令第44号）。</li>
    <li><strong>入り方</strong>：福祉事務所が日常生活上の支援を施設に委託します。入るのは、福祉事務所が「この施設で支援を受けることが必要」と判断した人で、<strong>入所を希望している人</strong>です（省令第44号 第7条）。</li>
    <li><strong>支援</strong>：個別支援計画に沿って、家事・服薬などの健康管理・お金の管理・人との交流などを支えます（同 第8条）。生活支援員は入所定員15人につき1人以上（常勤換算）（同 第10条）。目指すのは、できる限り自分の住まいでの暮らしに戻ることです（同 第9条）。</li>
  </ul>
  <h3>救護施設</h3>
  <ul>
    <li><strong>根拠</strong>：生活保護法の「保護施設」の一つです（生活保護法 第38条）。</li>
    <li><strong>入る人</strong>：身体上または精神上著しい障害があるために、日常生活を営むことが困難な人（同 第38条第2項）。</li>
    <li><strong>お金</strong>：施設に入所して生活扶助を受ける施設です（同）。このページの「手元に残る額」の計算は、救護施設には当てはまりません。</li>
  </ul>
  </div>

  <h2>② 施設に払うお金（利用料）</h2>
  <p>国の基準は、無料低額宿泊所が入居者から利用料として受け取れる費用を、次の6つに限っています（基準 第16条。日常生活支援住居施設は、入居者が選んだ支援サービスの費用が7つ目に加わります）。</p>
  <ul>
    <li><strong>食事の費用</strong>：食材費と調理などの費用に相当する額</li>
    <li><strong>居室使用料</strong>（家賃）：施設の整備費・修繕費・管理事務費・地代などをもとに合理的に計算した額。<strong>これとは別に敷金・権利金・謝金などは受け取れません</strong>。</li>
    <li><strong>共益費</strong>：共用部分の掃除や備品の整備などの費用に相当する額</li>
    <li><strong>光熱水費</strong>：居室と共用部分の光熱水費に相当する額</li>
    <li><strong>日用品費</strong>：本人が使う日用品の購入費に相当する額</li>
    <li><strong>基本サービス費</strong>：状況を確かめる仕事などの人件費・事務費に相当する額</li>
  </ul>
  <p>居室使用料は、無料か、生活保護の住宅扶助の基準の額以下であることが、国の基準の条件の一つです（基準 第2条）。生活保護を受けている人は、<strong>居室使用料を住宅扶助から、それ以外の費用を生活扶助から</strong>払う形になります。</p>

  <h2>③ 手元に残る額を計算する</h2>
  <p>住所と年齢、施設に払う額（契約書や料金表に書かれている、居室使用料<strong>以外</strong>の合計）と居室使用料を入れてください。ひとり暮らしの場合の計算です。</p>
  <div class="mt-form">
    <div class="row"><label for="mt-pref">都道府県</label><select id="mt-pref"></select></div>
    <div class="row"><label for="mt-muni">市区町村</label><select id="mt-muni"></select></div>
    <div class="row"><label for="mt-age">年齢</label><input id="mt-age" type="number" inputmode="numeric" min="18" max="110" value="40"> 歳</div>
    <div class="row"><label for="mt-fee">施設に払う額（食費・光熱水費・日用品費・共益費・基本サービス費などの合計）</label><input id="mt-fee" type="number" inputmode="numeric" min="0" placeholder="例 40000"> 円/月</div>
    <div class="row"><label for="mt-rent">居室使用料（家賃）</label><input id="mt-rent" type="number" inputmode="numeric" min="0" placeholder="例 45000"> 円/月</div>
  </div>
  <div id="mt-out" aria-live="polite"><noscript><p class="mini-note">計算は JavaScript を使います。下の級地の表で確かめてください。</p></noscript></div>
  <p class="mini-note">障害者加算などの加算、冬季加算、働いた収入や年金がある場合は入っていません。正確な保護費は福祉事務所の決定で確かめてください。世帯の人数や加算を入れて計算するなら<a href="seikatsuhogo-keisanki.html">生活保護の計算機</a>へ。</p>

  <h2>④ 級地ごとの生活扶助（ひとり暮らし）</h2>
  <p>施設に利用料を払う前の、ひとり暮らしの生活扶助の月額です。住んでいる市区町村の<strong>級地</strong>と年齢で決まります。ここから施設に払う食費・光熱水費などを引いた額が手元に残ります。</p>
  <div class="table-wrap"><table class="fit">
    <caption>ひとり暮らしの生活扶助（月額・円）令和8年10月から・特例加算2,500円を含む・冬季加算を除く</caption>
    <thead><tr><th>級地</th>${SHOW.map((m) => `<th class="num">${TBL.find((x) => x.max === m).label}</th>`).join('')}</tr></thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table></div>
  <p class="mini-note">額は<a href="seikatsuhogo-keisanki.html">生活保護の計算機</a>と同じ基準額表（${link(SRC.santei)}・${link(SRC.kokuji)}）から計算し、計算機の早見表と1円まで合わせています。住んでいる市区町村の級地は、上の計算か計算機で確かめられます。</p>

  <h2>⑤ 契約とお金で気をつけること</h2>
  <ul>
    <li><strong>保護費は本人に支払われます。</strong>国の通知は、無料低額宿泊所などに住む人の保護費を、施設の事業者に直接支払わず、本人へ確実に支払うよう求めています（住宅扶助の認定についての通知 2(1)）。</li>
    <li><strong>お金の管理は本人が原則です。</strong>施設が日常のお金を管理するのは、本人が管理に困っていて、施設による管理を希望した場合だけです（基準 第26条）。</li>
    <li><strong>保証人は要りません。</strong>施設が入居申込者に保証人を立てさせることは禁じられています（基準 第14条第6項）。</li>
    <li><strong>出たいときは出られます。</strong>入居者が解約を申し入れたら速やかに契約を終える旨を、契約に定める決まりです。入居者の権利を不当に狭める解約の条件も禁じられています（基準 第14条第4項・第5項）。</li>
    <li><strong>契約は1年以内です。</strong>更新の前に、施設は本人の意向を確かめ、福祉事務所などと続けて利用する必要があるかを話し合います（基準 第14条第2項・第3項）。</li>
    <li><strong>居室が狭いと住宅扶助の上限が下がる決まりがあります。</strong>ただし、居室の提供以外の支援を受けるための利用が自立のために本当に必要な場合や、住む期間が6か月未満の見込みの場合は、下げない扱いにしてよいとされています（住宅扶助の認定についての通知 1(1)）。</li>
    <li><strong>困ったら福祉事務所へ。</strong>福祉事務所は施設を訪ねて暮らしの様子を確かめ、ひどい状態だと認めたときは転居の指導と必要な支援をすることになっています（同 2(2)）。</li>
  </ul>

  <h2>よくある質問</h2>
  ${FAQ.map(([q, ans]) => `<h3>${esc(q)}</h3>\n  <p>${esc(ans)}</p>`).join('\n  ')}

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>2013年8月〜2026年3月に保護を受けていた人は<a href="seikatsuhogo-tsuika-kyufu.html">生活保護の追加給付（対象・いくら・申出先）</a>を確かめてください。世帯の人数や加算を入れた保護費は<a href="seikatsuhogo-keisanki.html">生活保護の支給額シミュレーター</a>。申請が通るかどうかの目安は<a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>。施設を出て自分の住まいに移るなら<a href="koei-jutaku-bairitsu.html">公営住宅の倍率データ</a>もどうぞ。</p>
  </div>

  <h2>出典</h2>
  <ul class="sources">
    ${Object.values(SRC).map((s) => `<li>${esc(s.name)} ${s.url}</li>`).join('\n    ')}
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは法令と国の通知をまとめたもので、個別の施設や契約の良し悪しを判断するものではありません。都道府県・指定都市・中核市は国の基準をもとに条例で細かい決まりを定めています。実際の保護費と費用は、福祉事務所と契約書で確かめてください。
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
<script src="../assets/ev.js?v=20261007a" defer></script>
</body>
</html>
`

console.log(`確かめ：計算機の早見表・生活保護の実質のデータと1円一致／単身20〜40歳 1級地-1 ${yen(top.y)}・3級地-2 ${yen(top.low)}・75歳以上 1級地-1 ${yen(top.o)}`)
if (DRY) process.exit(0)

// 中身が同じなら書き直さない（lastmod を進めない）。比べるのは「最終更新」と dateModified を除いた本文
// 改行コードの違い（core.autocrlf で取り出すと CRLF になる）は変更と数えない
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/, '')
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
const changed = !prev || strip(prev) !== strip(html)
if (changed) fs.writeFileSync(OUT, html)
// sitemap.xml（手書きで育てているもの）：この1行だけを足すか、中身が変わった日に lastmod を進める
const SM = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(SM, 'utf8')
const line = `  <url><loc>${URL}</loc><lastmod>${TODAY}</lastmod><priority>0.8</priority></url>`
const re = new RegExp(`  <url><loc>${URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc><lastmod>[^<]+</lastmod>[^\\n]*</url>`)
if (!re.test(sm)) { sm = sm.replace('</urlset>', `${line}\n</urlset>`); fs.writeFileSync(SM, sm); console.log('sitemap に1行足した') }
else if (changed) { sm = sm.replace(re, line); fs.writeFileSync(SM, sm); console.log('sitemap の lastmod を進めた') }
console.log(`${changed ? '書いた' : '変わらず'}: ${OUT}（${(html.length / 1024).toFixed(1)}KB）`)
