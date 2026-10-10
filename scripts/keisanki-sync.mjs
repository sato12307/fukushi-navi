// ─────────────────────────────────────────────────────────────────────────────
// keisanki-sync.mjs — 生活保護の計算機（articles/seikatsuhogo-keisanki.html）の基準額表・早見表・冬季加算の節・よくある質問を、
//   告示の現行の本文から読んだ data/seiho-kokuji.json（scripts/seiho-kokuji-fetch.py）で書き直す。
//   node scripts/keisanki-sync.mjs        → 書く（中身が変わったときだけ・最終更新と dateModified も）
//   node scripts/keisanki-sync.mjs --dry  → 書かずに確かめと主な数字だけ
//
// ★なぜ（2026-10-10 ユーザー裁定 v306「おすすめ通りすすめて」＝冬季加算と12月の期末一時扶助を足す）
//   計算機は表を手で写していて、令和8年10月の告示第245号で経過的加算が1人最大1,000円下がったのを取り込めていなかった
//   （特例加算だけ2,500円に直したので、経過的加算のある世帯で最大1,000円高く出ていた。2026-10-10 に全330区分で確かめた）。
//   ∴表は「告示 → data/seiho-kokuji.json → この台本」の1本道で書き出し、手で直さない。scripts/seiho-area-build.py も同じ JSON を読む。
// ★書き換える場所（目印の間だけ）：①<script> の中の基準額表（「// ====== 生活扶助基準額」から「// 障害者加算（級地グループ別」の手前まで）
//   ②早見表の tbody と、その下の注記の段落 ③冬季加算の節（<!-- touki:start --> 〜 <!-- touki:end -->）④よくある質問の JSON-LD
//   ⑤「最終更新」と Article の dateModified。計算の式（calc()）は HTML の中にあり、表の形（byN・KEIKA[n][年齢帯][級地]）に合わせてある。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const FILE = path.join(ROOT, 'articles', 'seikatsuhogo-keisanki.html')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seiho-kokuji.json'), 'utf8'))
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const num = (n) => Math.round(n).toLocaleString('ja-JP')
const AGE_MAX = [2, 5, 11, 17, 19, 40, 59, 64, 69, 74, 999]
const KY = D.grades
const AREAS = ['Ⅰ区', 'Ⅱ区', 'Ⅲ区', 'Ⅳ区', 'Ⅴ区', 'Ⅵ区']

// ── 確かめ（形）
if (D.k1.length !== 6 || D.k1.some((r) => r.length !== 11)) die('第1類の表の形が違います')
if (D.k2.length !== 10 || D.teigen.length !== 10 || D.kimatsu.length !== 6 || D.kimatsu.some((r) => r.length !== 10)) die('第2類・逓減率・期末一時扶助の表の形が違います')
if (D.keika.length !== 6 || D.keika.some((g) => g.length !== 11 || g.some((r) => r.length !== 10))) die('経過的加算の表の形が違います')
for (const a of AREAS) if (!D.touki[a] || D.touki[a].v.length !== 10) die(`冬季加算 ${a} の表の形が違います`)
if (Object.keys(D.areas).length !== 47) die('冬季加算の地区の区分が47都道府県ではありません')
if (!(D.tokurei > 0)) die('特例加算が読めていません')

// ── 計算（HTML の calc() と同じ式。早見表とよくある質問の数字に使う）
const byN = (arr, n) => (n <= 9 ? arr[n - 1] : arr[8] + (n - 9) * arr[9])
const ageIdx = (age) => AGE_MAX.findIndex((m) => age <= m)
function seikatsu(ki, ages) {
  const n = ages.length
  const k1sum = ages.reduce((s, a) => s + D.k1[ki][ageIdx(a)], 0)
  const keika = ages.reduce((s, a) => s + D.keika[ki][ageIdx(a)][Math.min(n, 10) - 1], 0)
  const base = Math.ceil((k1sum * D.teigen[Math.min(n, 10) - 1] + byN(D.k2, n) + keika) / 10) * 10
  return base + D.tokurei * n
}
const period = (p) => { const m = p.match(/^(\d+)月から(\d+)月まで$/); if (!m) die(`冬季加算の期間が読めません：${p}`); const s = +m[1], e = +m[2]; return { label: `${s}月〜${e}月`, n: ((e - s + 12) % 12) + 1 } }
const TOUKI = Object.fromEntries(AREAS.map((a) => [a, { m: period(D.touki[a].period).label, n: period(D.touki[a].period).n, v: D.touki[a].v }]))
const prefsOf = (a) => Object.keys(D.areas).filter((p) => D.areas[p] === a)

// ── ① 基準額表の JS
const keikaJs = Array.from({ length: 10 }, (_, ni) => `  ${ni + 1}: [${D.keika[0].map((_, ai) => `[${KY.map((__, ki) => D.keika[ki][ai][ni]).join(',')}]`).join(',')}]`).join(',\n')
const TABLE_JS = `// ====== 生活扶助基準額（告示の現行の本文＝data/seiho-kokuji.json から scripts/keisanki-sync.mjs が書く。手で直さない）======
// 出典：生活保護法による保護の基準（昭和38年厚生省告示第158号）別表第1 第1章。${D.amendedBy}まで反映（${D.fetchedAt} 確認）
// 級地index: 0=1級地-1, 1=1級地-2, 2=2級地-1, 3=2級地-2, 4=3級地-1, 5=3級地-2
var K1 = [ // 第1類（年齢帯×級地）
${AGE_MAX.map((m, ai) => `  { max: ${m},${' '.repeat(Math.max(1, 4 - String(m).length))}v: [${KY.map((_, ki) => D.k1[ki][ai]).join(',')}] }`).join(',\n')}
];
var TEIGEN = [${D.teigen.join(', ')}]; // 逓減率（1〜9人・10人以上）
var K2 = [${D.k2.join(', ')}]; // 第2類（1〜9人。最後は10人以上の1人ごとに足す額）
var TOKUREI = ${D.tokurei}; // 特例加算（1人あたり月額・第1章の4）
// 経過的加算: KEIKA[世帯人数（10は10人以上）][年齢帯index][級地index]
var KEIKA = {
${keikaJs}
};
// 地区別冬季加算額（自宅・6級地で同じ額）: v は1〜9人と10人以上の1人ごとに足す額
var TOUKI = {
${AREAS.map((a) => `  '${a}': { m: '${TOUKI[a].m}', n: ${TOUKI[a].n}, v: [${TOUKI[a].v.join(',')}] }`).join(',\n')}
};
// 期末一時扶助費（12月の基準生活費に加える）: [級地][1〜9人と10人以上の1人ごとに足す額]
var KIMATSU = [
${D.kimatsu.map((r) => `  [${r.join(',')}]`).join(',\n')}
];
// 冬季加算の地区（都道府県→区）
var TOUKI_AREA = ${JSON.stringify(D.areas)};
function byN(arr, n){ return n <= 9 ? arr[n - 1] : arr[8] + (n - 9) * arr[9]; }
`

// ── ② 早見表（12都市・単身30歳）
const CITY_PREF = { 東京23区: '東京都', 川崎市: '神奈川県', 横浜市: '神奈川県', さいたま市: '埼玉県', 京都市: '京都府', 大阪市: '大阪府', 神戸市: '兵庫県', 千葉市: '千葉県', 名古屋市: '愛知県', 仙台市: '宮城県', 札幌市: '北海道', 福岡市: '福岡県' }
let html = fs.readFileSync(FILE, 'utf8').replace(/\r/g, '')
const tbA = html.indexOf('<table class="city-table">'), tbB = html.indexOf('<tbody>', tbA), tbC = html.indexOf('</tbody>', tbB)
if (tbA < 0 || tbB < 0 || tbC < 0) die('早見表が見つかりません')
const rows = [...html.slice(tbB, tbC).matchAll(/<tr><th>([^<]+)<\/th><td>([^<]+)<\/td><td>[\d,]+円<\/td><td>([\d,]+)円<\/td><td class="big">[\d,]+円<\/td><\/tr>/g)]
if (rows.length !== 12) die(`早見表の行が12ではありません（${rows.length}）`)
const CITIES = rows.map(([, city, ky, rent]) => {
  const ki = KY.indexOf(ky)
  if (ki < 0) die(`早見表の級地が読めません：${city} ${ky}`)
  if (!CITY_PREF[city]) die(`早見表の都市の都道府県が分かりません：${city}`)
  const s = seikatsu(ki, [30]), r = Number(rent.replace(/,/g, ''))
  return { city, ky, ki, s, rent: r, total: s + r, pref: CITY_PREF[city], area: D.areas[CITY_PREF[city]] }
})
const tbody = '<tbody>\n' + CITIES.map((c) => `      <tr><th>${c.city}</th><td>${c.ky}</td><td>${num(c.s)}円</td><td>${num(c.rent)}円</td><td class="big">${num(c.total)}円</td></tr>`).join('\n') + '\n    '
html = html.slice(0, tbB) + tbody + html.slice(tbC)
html = html.replace(/<caption>単身（20〜40歳）の生活保護 月額目安（[^）]*）<\/caption>/, '<caption>単身（20〜40歳）の生活保護 月額目安（令和8年10月からの基準・冬季加算を除く）</caption>')
const sap = CITIES.find((c) => c.city === '札幌市'), tok = CITIES.find((c) => c.city === '東京23区')
const NOTE = `<p class="mini-note">生活扶助＝第1類＋第2類＋経過的加算（該当分）＋特例加算${num(D.tokurei)}円（告示の現行の表）。家賃上限は単身の基準額で、実際は<strong>払っている家賃の実費</strong>（上限まで）が支給されます。冬に暖房費として上乗せされる<strong>冬季加算</strong>（札幌市の単身なら月${num(TOUKI[sap.area].v[0])}円・${TOUKI[sap.area].m}、東京都・大阪府などは月${num(TOUKI[tok.area].v[0])}円・${TOUKI[tok.area].m}）と12月の期末一時扶助は、この表には含みません（<a href="#touki">冬季加算と期末一時扶助</a>）。医療費（医療扶助）は<strong>別枠で自己負担ゼロ</strong>です。</p>`
const nA = html.indexOf('<p class="mini-note">生活扶助＝第1類＋第2類', tbC), nB = html.indexOf('</p>', nA)
if (nA < 0 || nB < 0) die('早見表の下の注記が見つかりません')
html = html.slice(0, nA) + NOTE + html.slice(nB + 4)

// ── ③ 冬季加算の節
const pick = [1, 2, 4]
const TOUKI_HTML = `<!-- touki:start -->
  <h3 id="touki">冬季加算（冬の暖房費）と12月の期末一時扶助はいくら？</h3>
  <p>冬のあいだは、生活扶助に<strong>冬季加算</strong>が上乗せされます。額は<strong>住んでいる都道府県の地区（Ⅰ区〜Ⅵ区）と世帯の人数</strong>で決まり、級地では変わりません。12月には年末の<strong>期末一時扶助</strong>も加わります。②の計算機は、選んだ地域の冬の月と12月の額も出します。</p>
  <p class="mini-note">地区は都道府県で決まります：${AREAS.map((a) => `${a}＝${a === 'Ⅵ区' ? '上のほかの都府県（東京都・大阪府など）' : prefsOf(a).join('・')}`).join('／')}。</p>
  <div class="table-wrap"><table class="fit">
    <caption>冬季加算の月額（自宅で暮らす人・円）</caption>
    <thead><tr><th>地区</th><th>期間</th>${pick.map((n) => `<th>${n}人</th>`).join('')}</tr></thead>
    <tbody>
      ${AREAS.map((a) => `<tr><th>${a}</th><td>${TOUKI[a].m}</td>${pick.map((n) => `<td>${num(byN(TOUKI[a].v, n))}</td>`).join('')}</tr>`).join('\n      ')}
    </tbody>
  </table></div>
  <div class="table-wrap"><table class="fit">
    <caption>12月の期末一時扶助（円）</caption>
    <thead><tr><th>級地</th>${pick.map((n) => `<th>${n}人</th>`).join('')}</tr></thead>
    <tbody>
      ${KY.map((ky, ki) => `<tr><th>${ky}</th>${pick.map((n) => `<td>${num(byN(D.kimatsu[ki], n))}</td>`).join('')}</tr>`).join('\n      ')}
    </tbody>
  </table></div>
  <p class="mini-note">出典：生活保護法による保護の基準（告示）別表第1 第1章の第2類の表（地区別冬季加算額）・期末一時扶助費の表・地区の区分の表（${D.amendedBy}まで反映・${D.fetchedAt} 確認）。3人や5人以上の額も告示にあり、計算機に入れています。入院している人・施設に入っている人の冬季加算は別の額です。</p>
<!-- touki:end -->`
const tA = html.indexOf('<!-- touki:start -->'), tB = html.indexOf('<!-- touki:end -->')
if (tA >= 0 && tB > tA) html = html.slice(0, tA) + TOUKI_HTML + html.slice(tB + '<!-- touki:end -->'.length)
else {
  const after = html.indexOf('</p>', html.indexOf('<p class="mini-note">生活扶助＝第1類＋第2類', tbC)) + 4
  html = html.slice(0, after) + '\n\n' + TOUKI_HTML + html.slice(after)
}
// 表の CSS（数字は折り返さない。地区の欄は「Ⅰ区」だけにして、都道府県は表の上の一文に出す）
const FIT_CSS = 'table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:6px 5px;white-space:nowrap}table.fit tbody th{text-align:left}'
if (/table\.fit\{[^\n]*/.test(html)) html = html.replace(/table\.fit\{[^\n]*/, FIT_CSS)
else html = html.replace('</style>', FIT_CSS + '\n</style>')

// ── ④ よくある質問（JSON-LD）
const man = (y) => (y / 10000).toFixed(1)
const c = (name) => CITIES.find((x) => x.city === name)
const FAQ = [
  ['生活保護は単身だと月いくらもらえますか？', `20〜40歳の単身の場合、生活費（生活扶助）は東京23区など1級地-1で月約${num(Math.round(tok.s / 1000) * 1000)}円、これに家賃の実費（上限あり・東京23区単身${num(tok.rent)}円）が住宅扶助として加わります。合計の目安は東京23区で月約${man(tok.total)}万円、大阪市で約${man(c('大阪市').total)}万円、名古屋市で約${man(c('名古屋市').total)}万円、札幌市・福岡市で約${man(sap.total)}万円です（令和8年10月からの基準・冬季加算は別）。`],
  ['働いて収入があっても生活保護は受けられますか？', '受けられます。収入が最低生活費を下回っていれば、その差額が支給されます。働いた収入には勤労控除（最低でも月15,200円）があり、その分は収入として数えられないため、働いたほうが手元に残るお金は必ず増える仕組みです。'],
  ['2026年10月から生活保護費は上がりますか？', `特例加算が2026年10月1日から1人あたり月1,500円から${num(D.tokurei)}円に引き上げられました（令和8年6月11日 厚生労働省告示第245号）。ただし同じ告示で経過的加算が1人あたり最大1,000円下がった世帯があり、増える額は世帯で違います（例：1級地-1の単身で20〜40歳は月800円増え、75歳以上は増えません）。このページの計算機と早見表は告示の現行の表で計算しています。`],
  ['貯金や持ち家があると生活保護は受けられませんか？', '資産の活用が先に求められます。おおむね最低生活費の半月〜1か月分を超える預貯金は先に生活費に充てる扱いです。ただし持ち家は住み続けながら受給できる場合があり（ローン残がある場合は原則不可）、自動車も障害や仕事で必要と認められれば保有できる例外があります。一律に「ゼロでないとダメ」ではありません。'],
  ['生活保護の冬季加算はいくらですか？', `住んでいる都道府県の地区（Ⅰ区〜Ⅵ区）と世帯の人数で決まり、級地では変わりません。単身なら北海道・青森県・秋田県（Ⅰ区）で月${num(TOUKI['Ⅰ区'].v[0])}円（${TOUKI['Ⅰ区'].m}）、東京都・大阪府などのⅥ区で月${num(TOUKI['Ⅵ区'].v[0])}円（${TOUKI['Ⅵ区'].m}）です。4人世帯ならⅠ区で月${num(byN(TOUKI['Ⅰ区'].v, 4))}円、Ⅵ区で月${num(byN(TOUKI['Ⅵ区'].v, 4))}円です（生活保護法による保護の基準・告示）。`],
  ['12月の生活保護費はいくら増えますか？', `12月は年末の期末一時扶助が加わります。単身なら1級地-1で${num(D.kimatsu[0][0])}円、3級地-2で${num(D.kimatsu[5][0])}円、4人世帯なら1級地-1で${num(byN(D.kimatsu[0], 4))}円です。12月は冬季加算の期間でもあるので、ふだんの月よりこの2つの分だけ多くなります。`],
]
const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }, null, 2)
const fA = html.indexOf('"@type": "FAQPage"'), fS = html.lastIndexOf('<script type="application/ld+json">', fA), fE = html.indexOf('</script>', fA)
if (fA < 0 || fS < 0 || fE < 0) die('よくある質問の JSON-LD が見つかりません')
html = html.slice(0, fS) + '<script type="application/ld+json">\n' + ld + '\n' + html.slice(fE)

// ── ① の書き込み（script の中の表）
let sA = html.indexOf('// ====== 生活扶助基準額（告示')
if (sA < 0) sA = html.indexOf('// ====== 令和8年4月 生活扶助基準額')
const sB = html.indexOf('// 障害者加算（級地グループ別', sA)
if (sA < 0 || sB < 0) die('script の中の基準額表の目印が見つかりません')
html = html.slice(0, sA) + TABLE_JS + html.slice(sB)

// ── 確かめ：calc() が使う名前がそろっているか
for (const nm of ['byN(K2, n)', 'KEIKA[Math.min(n, 10)]', 'TOUKI_AREA[prefSel.value]', 'byN(KIMATSU[k], n)', "getElementById('g-winter')"]) if (!html.includes(nm)) die(`calc() に ${nm} がありません（HTML の計算の式が古い）`)

console.log(`確かめ：早見表 ${CITIES.map((x) => `${x.city}${num(x.s)}`).join('・')}`)
console.log(`  冬季加算 単身 ${AREAS.map((a) => `${a}${num(TOUKI[a].v[0])}(${TOUKI[a].m})`).join('・')}／期末一時扶助 単身 1級地-1 ${num(D.kimatsu[0][0])}`)
if (DRY) process.exit(0)
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}[^／]*／/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/g, '')
const prev = fs.readFileSync(FILE, 'utf8')
if (strip(prev) === strip(html)) { console.log('変わらず:', FILE); process.exit(0) }
html = html.replace(/最終更新：\d{4}-\d{2}-\d{2}[^／]*／[^<]*<\/p>/, `最終更新：${TODAY}（告示の現行の表で計算・冬季加算と12月の期末一時扶助を追加）／ 厚生労働省「生活保護法による保護の基準」（告示）の表をそのまま実装。すべて<strong>概算</strong>です</p>`)
html = html.replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/, `"dateModified": "${TODAY}"`)
fs.writeFileSync(FILE, html)
console.log('書いた:', FILE)
