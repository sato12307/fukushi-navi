// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-sokutou.mjs — 障害者控除の記事（articles/shogaisha-kojo-tax.html）の冒頭に「あなたの場合は？4つの問いに即答」の箱を書く。
//   node scripts/shogai-kojo-sokutou.mjs        → 書く（中身が変わったときだけ・最終更新・dateModified・sitemap の lastmod も）
//   node scripts/shogai-kojo-sokutou.mjs --dry  → 書かずに主な数字だけ
//
// ★なぜ（2026-10-11 ユーザー裁定 v308 c＝障害者控除の2面の手入れ）
//   「障害者控除」は Bing 90日2,673回・自艦8位でクリック4（第186回）。冬（年末調整・確定申告）に約2.3倍になる語（第187回）。
//   記事は控除額の表と「控除額×税率」の考え方はあるが、冒頭で「自分の場合」に答えていなかった。
//   全国で同じ答えの2問（控除額・下がる税金の目安）はこの箱で答え、街によって違う2問は街のページへ渡す
//   （住民税の非課税の線＝/hikazei/〈市区町村〉/、手帳が無いときの認定書の基準＝/shogai-kojo/〈コード〉.html）。
// ★数字はここに書かない：障害者本人の非課税の線（合計所得135万円）は scripts/hikazei-lib.mjs の式（大阪市・名古屋市の公表値と1円で照合する
//   selfCheck つき）から、街の一覧は data/shogai-kojo-kijun.csv（418自治体）から作る。所得税の税率の段は国税庁 No.2260。
// ★書き換える場所：<!-- sokutou:start --> 〜 <!-- sokutou:end -->（「この記事の要点」の囲みの直後）と、最終更新・dateModified・sitemap。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PER, SPECIAL_LIM, maxIncome, maxPension, man, selfCheck } from './hikazei-lib.mjs'
import { SITE, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const FILE = path.join(ROOT, 'articles', 'shogaisha-kojo-tax.html')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }

{ const e = selfCheck(); if (e) die('hikazei-lib の式が公表値と合いません：' + e) }
const pNow = PER.find((p) => p.id === 'r8'), pNext = PER.find((p) => p.id === 'r9')
if (!pNow || !pNext) die('hikazei-lib に令和8年度・令和9年度の区分がありません')
const kyuNow = maxIncome('r8', SPECIAL_LIM), kyuNext = maxIncome('r9', SPECIAL_LIM), nen65 = maxPension(true, SPECIAL_LIM)

// 街の一覧（認定書の基準のページがある自治体だけ）
const csv = fs.readFileSync(path.join(ROOT, 'data', 'shogai-kojo-kijun.csv'), 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split('\n').slice(1)
const byPref = new Map()
let nCity = 0
for (const line of csv) {
  const [code, pref, city] = line.split(',')
  if (!/^\d{6}$/.test(code) || !fs.existsSync(path.join(ROOT, 'shogai-kojo', `${code}.html`))) continue
  if (!byPref.has(pref)) byPref.set(pref, [])
  byPref.get(pref).push([code, city])
  nCity++
}
if (nCity < 300) die(`認定書の基準のページがある自治体が少なすぎます（${nCity}）`)
const CITIES = Object.fromEntries(byPref)

const KOJO = [['shogai', '障害者', 270000, 260000], ['tokubetsu', '特別障害者', 400000, 300000], ['dokyo', '同居特別障害者', 750000, 530000]]
const RATES = [[0, '所得税はかかっていない'], [0.05, '5%（課税所得195万円未満）'], [0.1, '10%（195万〜330万円未満）'], [0.2, '20%（330万〜695万円未満）'], [0.23, '23%（695万〜900万円未満）'], [0.33, '33%（900万〜1,800万円未満）'], [0.4, '40%（1,800万〜4,000万円未満）'], [0.45, '45%（4,000万円以上）']]
const yen = (n) => n.toLocaleString('ja-JP') + '円'
const manK = (n) => (n / 10000).toLocaleString('ja-JP') + '万円'

const BOX = `<!-- sokutou:start -->
  <style>
#sokutou{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:1.2em 0;background:var(--soft)}
#sokutou h2{margin:.1em 0 .5em;font-size:1.15rem;border:0;padding:0}
#sokutou ol{margin:.4em 0 0;padding-left:1.4em}
#sokutou li{margin:.7em 0;line-height:1.75}
#sokutou .row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:.4em 0}
#sokutou select{padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:1rem;max-width:100%}
#sokutou .row>*{min-width:0}
#sokutou .out{margin-top:6px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:.95rem}
  </style>
  <div id="sokutou" role="group" aria-label="障害者控除の即答">
    <h2>あなたの場合は？ 4つの問いに即答</h2>
    <p class="mini-note">全国どこでも同じ答えの問いはここで答え、街によって違う問いは、あなたの街のページへご案内します。</p>
    <ol>
      <li><strong>控除はいくら？</strong>（全国同じ）${KOJO.map(([, n, s, j]) => `${n}＝所得税${manK(s)}・住民税${manK(j)}`).join('／')}。家族を扶養している人も、その家族の分を受けられます。</li>
      <li><strong>税金はいくら下がる？</strong>（全国同じ・目安）
        <div class="row">
          <select id="sk-kubun" aria-label="区分">${KOJO.map(([k, n], i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${n}</option>`).join('')}</select>
          <select id="sk-rate" aria-label="所得税の税率">${RATES.map(([r, t]) => `<option value="${r}"${r === 0.05 ? ' selected' : ''}>所得税の税率 ${t}</option>`).join('')}</select>
        </div>
        <div class="out" id="sk-out" aria-live="polite">—</div></li>
      <li><strong>障害者本人の住民税は0になる？</strong>（全国同じ）前年の合計所得が<strong>${manK(SPECIAL_LIM)}以下</strong>なら、住民税はかかりません（地方税法295条）。給与だけなら年収<strong>${man(kyuNow)}</strong>まで（${pNow.label}＝${pNow.incomeYears}）、${pNext.label}からは<strong>${man(kyuNext)}</strong>まで。65歳以上で年金だけなら<strong>${man(nen65)}</strong>まで。家族を扶養している人が非課税になる線は市区町村で違います→<a href="../hikazei/">あなたの市区町村の非課税ライン</a></li>
      <li><strong>手帳がなくても対象になる？</strong>（街によって違う）65歳以上で要介護などの人は、市区町村の「障害者控除対象者認定書」で対象になることがあります。どの状態なら認定されるかは街ごとに違います（自治体ごとに基準をまとめたページがあります）。
        <div class="row">
          <select id="sk-pref" aria-label="都道府県"><option value="">都道府県</option>${[...byPref.keys()].map((p) => `<option>${p}</option>`).join('')}</select>
          <select id="sk-city" aria-label="市区町村"><option value="">市区町村</option></select>
          <a id="sk-go" href="../shogai-kojo/">基準を見る →</a>
        </div></li>
    </ol>
  </div>
  <script>
(function(){
  var KOJO = ${JSON.stringify(KOJO.map(([, n, s, j]) => [n, s, j]))};
  var CITIES = ${JSON.stringify(CITIES)};
  var kubun = document.getElementById('sk-kubun'), rate = document.getElementById('sk-rate'), out = document.getElementById('sk-out');
  var pref = document.getElementById('sk-pref'), city = document.getElementById('sk-city'), go = document.getElementById('sk-go');
  function yen(n){ return Math.round(n).toLocaleString('ja-JP') + '円'; }
  function calc(){
    var k = KOJO[parseInt(kubun.value, 10)], r = parseFloat(rate.value);
    // 所得税は控除額×税率×1.021（復興特別所得税）、住民税は控除額×10%。課税所得が控除額より少ない人は、そのぶん小さくなる
    var it = Math.floor(k[1] * r * 1.021 / 100) * 100, jt = Math.floor(k[2] * 0.1 / 100) * 100;
    out.innerHTML = '所得税 約' + yen(it) + '＋住民税 約' + yen(jt) + '＝<strong>年 約' + yen(it + jt) + '</strong>'
      + '<br><small>控除額×税率で出した目安です（所得税は復興特別所得税を含む）。課税所得が控除額より少ない人は、下がる額もそれまでです。</small>';
  }
  function fillCity(){
    var list = CITIES[pref.value] || [], h = '<option value="">市区町村</option>';
    for (var i = 0; i < list.length; i++) h += '<option value="' + list[i][0] + '">' + list[i][1] + '</option>';
    city.innerHTML = h; go.href = '../shogai-kojo/';
  }
  [kubun, rate].forEach(function(e){ e.addEventListener('change', calc); });
  pref.addEventListener('change', fillCity);
  city.addEventListener('change', function(){ go.href = city.value ? '../shogai-kojo/' + city.value + '.html' : '../shogai-kojo/'; });
  calc();
})();
  </script>
<!-- sokutou:end -->`

let html = fs.readFileSync(FILE, 'utf8').replace(/\r/g, '')
const A = html.indexOf('<!-- sokutou:start -->'), B = html.indexOf('<!-- sokutou:end -->')
if (A < 0 || B < A) die('目印（<!-- sokutou:start --> 〜 <!-- sokutou:end -->）が見つかりません')
html = html.slice(0, A) + BOX + html.slice(B + '<!-- sokutou:end -->'.length)
console.log(`確かめ：障害者本人の非課税の線 給与 ${man(kyuNow)}（${pNow.label}）・${man(kyuNext)}（${pNext.label}）・年金65歳以上 ${man(nen65)}／認定書の基準のページ ${nCity}自治体・${byPref.size}都道府県`)
if (DRY) process.exit(0)

const UPDATED = /最終更新：\d{4}-\d{2}-\d{2} ／ [^<]*<\/p>/
if (!UPDATED.test(html)) die('「最終更新」の行が見つかりません')
html = html.replace(UPDATED, `最終更新：${TODAY} ／ 出典は国税庁ほか公式ページ（記事末尾に一覧）。冒頭に「あなたの場合は？」の即答を追加</p>`)
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/g, '')
const prev = fs.readFileSync(FILE, 'utf8')
const syncSitemap = (page) => {
  const URL = `${SITE}/articles/shogaisha-kojo-tax.html`
  const dm = (page.match(/"dateModified": "(\d{4}-\d{2}-\d{2})"/) || [])[1]
  const sm = readSitemap(), lm = sitemapLastmods(sm).get(URL)
  if (!dm || !lm) die('sitemap の行かページの dateModified が見つかりません')
  if (dm <= lm) return
  const row = sm.match(new RegExp(`<url><loc>${URL.replace(/[.]/g, '\\.')}</loc>.*?</url>`))[0]
  writeSitemap(putUrls(sm, [[URL, row.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${dm}</lastmod>`)]]))
  console.log(`sitemap の lastmod を ${lm} → ${dm} に進めた`)
}
if (strip(prev) === strip(html)) { syncSitemap(prev); console.log('変わらず:', FILE); process.exit(0) }
html = html.replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/, `"dateModified": "${TODAY}"`)
fs.writeFileSync(FILE, html)
syncSitemap(html)
console.log('書いた:', FILE)
