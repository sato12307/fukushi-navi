// ─────────────────────────────────────────────────────────────────────────────
// seiho-city.mjs — 生活保護費の目安を「市区町村ごと」に出す /seiho/ を作る（2026-10-12）。
//   node scripts/seiho-city.mjs        → seiho/index.html・seiho/ken/<県2桁>/・seiho/<市区町村5桁>/ と sitemap.xml
//   node scripts/seiho-city.mjs --dry  → 書かずに件数と確かめの結果だけ出す
//
// ★なぜ（2026-10-12 ユーザー「すすめて。グーグルには見せなくていいです」）
//   フクシルの入口は Bing の2本（住民税非課税の判定・生活保護の計算機）。非課税は 09-23 に市区町村ごとのページ
//   （/hikazei/）を作ってから、まとめページに Bing の検索が立ち、記事から自分の市のページへ移る人も出た（10/5 の週に
//   /hikazei/ 以下で 543PV＝記事とは別の上乗せ）。生活保護の計算機は全国1,747市区町村から級地を選べ、家賃の上限も
//   1,500市区町村ぶんあるのに、市区町村ごとのページが無かった。同じ受け皿を生活保護にも作る。
// ★Google と AdSense には見せない（入口の /seiho/ も含めて scripts/bulk-pages.mjs の型の面）。Bing には sitemap.xml で見せる。
//
// ★式はここに書かない。生活保護の計算機（articles/seikatsuhogo-keisanki.html）の seihoKijun()（seiho-kijun:start〜end）と
//   基準額の表をそのまま vm で読み込んで使う。計算機の答えと、この面の答えは同じ関数から出る。
//   さらに ①計算機の早見表（主要12都市・単身20〜40歳）②data/seiho-ranking.json（Python で別に計算した単身30歳・52市）
//   ③記録している検算の値（大阪市・札幌市の月・冬・12月）と1円でも合わなければ、何も書かずに止める。
// ★地域の台帳は assets/seiho-area.js（scripts/seiho-area-build.py が作る・計算機と同じもの）。級地は data/muni-master.json と
//   全件突き合わせる。家賃の上限が公表資料で確かめられていない市町村は「未確認」と書き、推定しない（計算機と同じ決まり）。
// ★書かないこと：「どこに住めば得か」（生活保護は住む場所を選ぶ制度ではない）・支給が決まるかどうか（決めるのは福祉事務所）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE, readPrev, pageDiff, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const PUBLISHED = '2026-10-12'
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const num = (n) => Math.round(n).toLocaleString('ja-JP')
const yen = (n) => `${num(n)}円`

// ── 1. 計算機の式と基準額の表を読み込む ──────────────────────────────────────────────
const KEISAN = fs.readFileSync(path.join(ROOT, 'articles', 'seikatsuhogo-keisanki.html'), 'utf8').replace(/\r/g, '')
const a = KEISAN.indexOf('// ====== 生活扶助基準額（告示')
const b = KEISAN.indexOf('// ====== 地域（級地と家賃上限）', a)
const f = KEISAN.indexOf('function ageIdx(age)', b)
const s0 = KEISAN.indexOf('// seiho-kijun:start'), s1 = KEISAN.indexOf('// seiho-kijun:end')
if (a < 0 || b < 0 || f < 0 || s0 < 0 || s1 < s0) die('計算機のページから基準額表か seihoKijun() を切り出せません（目印の文が変わった？）')
const X = vm.runInNewContext(`${KEISAN.slice(a, b)}\n${KEISAN.slice(f, KEISAN.indexOf('\n', f))}\n${KEISAN.slice(s0, s1)}\n;({ seihoKijun, TOUKI, TOUKI_AREA, KYOIKU })`)
const CHECKED = (KEISAN.slice(a, b).match(/まで反映（(\d{4}-\d{2}-\d{2}) 確認）/) || [])[1] || die('基準額表の確認日が読めません')
const KOKUJI = readJson('data/seiho-kokuji.json')
const KY = ['1級地-1', '1級地-2', '2級地-1', '2級地-2', '3級地-1', '3級地-2']

// ── 2. 地域の台帳（計算機と同じ assets/seiho-area.js）と市区町村コード ─────────────────────
const areaSrc = fs.readFileSync(path.join(ROOT, 'assets', 'seiho-area.js'), 'utf8')
const AREA = (() => { const w = {}; vm.runInNewContext(areaSrc, { window: w }); return w.SEIHO_AREA })()
if (!AREA || !AREA.p) die('assets/seiho-area.js が読めません')
const M = readJson('data/muni-master.json').rows
const TS = readJson('data/tsuika-jichitai.json').rows
const HS = readJson('data/hogo-shinsei.json').rows
const SR = readJson('data/seiho-ranking.json').rows
const ownOffice = new Set(TS.filter((r) => r.code).map((r) => r.code))   // 追加給付の申出先＝保護の実施機関（自前の福祉事務所）
const seirei = new Set(HS.filter((x) => x.level === '指定都市').map((x) => x.name))
const chukaku = new Set(HS.filter((x) => x.level === '中核市').map((x) => x.name))
const shinseiCity = new Set(HS.filter((x) => x.level !== '都道府県').map((x) => x.name))   // 却下率の記事に載る市

const rows = M.map((r) => {
  const list = AREA.p[r.pref] || []
  const i = list.findIndex((x) => x[0] === r.city)
  if (i < 0) die(`台帳に無い市区町村：${r.pref}${r.city}`)
  const [, k, ri, si] = list[i]
  if (KY[k] !== r.kyuchi) die(`級地が台帳と名簿で違います：${r.pref}${r.city} 台帳 ${KY[k]} ／ 名簿 ${r.kyuchi}`)
  return { ...r, k, idx: i, rent: ri >= 0 ? AREA.r[ri] : null, src: si >= 0 ? AREA.s[si] : null, area: X.TOUKI_AREA[r.pref] || null }
})
const extra = Object.values(AREA.p).flat().length - rows.length
if (!rows.every((r) => r.area)) die('冬季加算の地区が引けない都道府県があります')

// ── 3. 世帯の形（行）と、1行ぶんの数字 ───────────────────────────────────────────────
const HH = [
  { label: 'ひとり暮らし', sub: '20〜40歳', ages: [30] },
  { label: 'ひとり暮らし', sub: '41〜59歳', ages: [50] },
  { label: 'ひとり暮らし', sub: '65〜69歳', ages: [67] },
  { label: 'ひとり暮らし', sub: '75歳以上', ages: [78] },
  { label: '夫婦', sub: '65〜69歳の2人', ages: [68, 66] },
  { label: '夫婦', sub: '75歳以上の2人', ages: [78, 76] },
  { label: '夫婦と子1人', sub: '30代の夫婦・4歳', ages: [35, 33, 4] },
  { label: 'ひとり親と子1人', sub: '30代・小学生', ages: [35, 8], single: true, school: { e: 1 } },
  { label: 'ひとり親と子2人', sub: '30代・中学生と小学生', ages: [38, 13, 9], single: true, school: { e: 1, j: 1 } },
  { label: '障害のあるひとり暮らし', sub: '50歳・障害者加算（1・2級）', ages: [50], shogai: 'g12' },
]
// 家賃の上限の段（計算機の calc() と同じ：[1人, 2人, 3〜5人, 6人, 7人以上]・空の段は手前の段で止める）
const rentCap = (rent, n) => {
  if (!rent) return null
  const band = n === 1 ? 0 : n === 2 ? 1 : n <= 5 ? 2 : n === 6 ? 3 : 4
  for (let i = band; i >= 0; i--) if (rent[i]) return rent[i]
  return null
}
const calcRow = (r, h) => {
  const R = X.seihoKijun(r.k, h.ages, { pref: r.pref, shogai: h.shogai || '', single: !!h.single, school: h.school || {} })
  const life = R.seikatsu + R.kasan + R.kyoiku
  const cap = rentCap(r.rent, R.n)
  const total = life + (cap || 0)
  return { R, life, cap, total, winter: total + R.touki, dec: total + R.touki + R.kimatsu }
}

// ── 4. 確かめ（1円でも合わなければ止める）───────────────────────────────────────────────
const single30 = (k) => X.seihoKijun(k, [30], {}).seikatsu
{ // ① 計算機の早見表（主要12都市・単身20〜40歳）
  const t0 = KEISAN.indexOf('<table class="city-table">'), b0 = KEISAN.indexOf('<tbody>', t0), b1 = KEISAN.indexOf('</tbody>', b0)
  const tr = [...KEISAN.slice(b0, b1).matchAll(/<tr><th>([^<]+)<\/th><td>([^<]+)<\/td><td>([\d,]+)円<\/td>/g)]
  if (tr.length < 10) die(`計算機の早見表が読めません（${tr.length}行）`)
  for (const [, city, k, v] of tr) if (single30(KY.indexOf(k)) !== Number(v.replace(/,/g, ''))) die(`計算機の早見表と合いません：${city}（${k}）表 ${v} ／ 計算 ${single30(KY.indexOf(k))}`)
}
{ // ② data/seiho-ranking.json（scripts/seiho-area-build.py が Python で別に計算した52市の単身30歳）
  //   生活扶助・冬季加算・期末一時扶助・家賃の上限（1人）の4つとも、この面の数字と1円まで合うか
  let n = 0
  for (const x of SR) {
    // 順位表は東京23区を「東京都区部」の1行で持つ（23区は級地も家賃の上限も同じ）→ 新宿区の行で確かめる
    const r = rows.find((y) => y.pref === x.pref && y.city === (x.city === '東京都区部' ? '新宿区' : x.city))
    if (!r) die(`data/seiho-ranking.json の市が名簿にありません：${x.pref}${x.city}`)
    const R = X.seihoKijun(r.k, [30], { pref: r.pref })
    const got = { seikatsu: R.seikatsu, touki: R.touki, kimatsu: R.kimatsu, jutaku: rentCap(r.rent, 1) }
    for (const key of Object.keys(got)) if (x[key] != null && got[key] !== x[key]) die(`data/seiho-ranking.json と合いません：${x.pref}${x.city} ${key} ${x[key]} ／ この面 ${got[key]}`)
    n++
  }
  if (n < 40) die(`data/seiho-ranking.json の行が読めません（${n}件）`)
}
{ // ③ 記録している検算の値（memory：大阪市 月77,220・冬79,850・12月94,350／札幌市 75,810・88,590・102,440）
  const chk = (pref, city, m, w, d) => {
    const r = rows.find((x) => x.pref === pref && x.city === city)
    const R = X.seihoKijun(r.k, [30], { pref })
    if (R.seikatsu !== m || R.seikatsu + R.touki !== w || R.seikatsu + R.touki + R.kimatsu !== d) die(`検算の値と合いません：${city} ${R.seikatsu}/${R.seikatsu + R.touki}/${R.seikatsu + R.touki + R.kimatsu}`)
  }
  chk('大阪府', '大阪市', 77220, 79850, 94350)
  chk('北海道', '札幌市', 75810, 88590, 102440)
}

// ── 5. 表示の部品 ───────────────────────────────────────────────────────────────
const CSS = `<style>table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit tbody th{white-space:nowrap}table.fit th.num{white-space:normal;word-break:keep-all;text-align:right}table.fit td.num{white-space:nowrap;text-align:right}table.fit td.tot small{white-space:normal}table.ken{min-width:560px}.nw{white-space:nowrap}table.fit small{font-weight:400;color:var(--sub)}table.fit thead small{color:inherit;opacity:.85}.mini-note{font-size:.86rem;color:var(--sub)}ul.links{columns:2;column-gap:1.4em;padding-left:1.2em}ul.links li{break-inside:avoid;margin:.15em 0}@media (max-width:520px){ul.links{columns:1}}td.tot strong{font-size:1.02rem}</style>`
const pref2 = (r) => r.code.slice(0, 2)
const PREFS = [...new Map(M.map((r) => [pref2(r), r.pref])).entries()]
const muniOfPref = (p2) => rows.filter((r) => pref2(r) === p2)
const crumbs = (items, up) => `<nav class="breadcrumb" aria-label="現在地">${items.map(([label, href]) => (href ? `<a href="${up}${href}">${esc(label)}</a>` : esc(label))).join(' › ')}</nav>`
const bcLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(href != null ? { item: `${SITE}/${href}` } : {}) })) })
const articleLd = (title, desc, url) => ({ '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}${url}`, datePublished: PUBLISHED, dateModified: CHECKED, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } })
const calcLink = (up, r, ages = [30]) => `${up}articles/seikatsuhogo-keisanki.html#j=${encodeURIComponent('g-pref')}=${encodeURIComponent(r.pref)}&g-muni=${r.idx}&m=${ages.join('.')}`
const orgOf = (r) => (seirei.has(r.city) || chukaku.has(r.city) ? r.city : r.pref)   // 家賃の上限を決める実施機関
const rentTxt = (rent) => ['1人', '2人', '3〜5人', '6人', '7人以上'].map((h, i) => (rent[i] ? `${h} ${yen(rent[i])}` : null)).filter(Boolean).join('・')
const KOKUJI_SRC = `<a href="${KOKUJI.source.url}" rel="noopener">生活保護法による保護の基準（昭和38年厚生省告示第158号）</a>（${esc(KOKUJI.amendedBy)}まで反映・${esc(CHECKED)}確認）`
const KYUCHI_SRC = '<a href="https://www.mhlw.go.jp/content/kyuchi.3010.pdf" rel="noopener">厚生労働省「お住まいの地域の級地を確認」</a>（平成30年10月1日現在・現行）'

const hhTable = (r) => `<div class="table-wrap"><table class="fit">
  <thead><tr><th>世帯</th><th class="num">1か月の合計<br><small>冬の月・12月</small></th><th class="num">生活扶助と加算</th><th class="num">家賃の上限</th></tr></thead>
  <tbody>
${HH.map((h) => {
    const c = calcRow(r, h)
    return `<tr><th scope="row">${esc(h.label)}<br><small>${esc(h.sub)}</small></th><td class="num tot"><strong>${yen(c.total)}</strong><br><small><span class="nw">冬 ${yen(c.winter)}</span>・<span class="nw">12月 ${yen(c.dec)}</span></small></td><td class="num">${yen(c.life)}</td><td class="num">${c.cap ? yen(c.cap) : '<small>未確認</small>'}</td></tr>`
  }).join('\n')}
  </tbody></table></div>`

// ── 6. 市区町村のページ ──────────────────────────────────────────────────────────
const cityPage = (r) => {
  const up = '../../'
  const s = calcRow(r, HH[0]), f2 = calcRow(r, HH[4])
  const T = X.TOUKI[r.area]
  const top = single30(0), mine = single30(r.k)
  const sameK = muniOfPref(pref2(r)).filter((x) => x.k !== r.k)
  const groups = [...new Set(sameK.map((x) => x.k))].sort((p, q) => p - q).map((k) => {
    const g = sameK.filter((x) => x.k === k)
    return `<li><strong>${KY[k]}</strong>（ひとり暮らし20〜40歳の生活扶助 ${yen(single30(k))}）：${g.slice(0, 8).map((x) => `<a href="${up}seiho/${x.code}/">${esc(x.city)}</a>`).join('、')}${g.length > 8 ? ` ほか${g.length - 8}` : ''}</li>`
  }).join('\n')
  const pl = muniOfPref(pref2(r)), pi = pl.findIndex((x) => x.code === r.code)
  const prev = pl[pi - 1], next = pl[pi + 1]
  const isTown = !/[市区]$/.test(r.city)
  const office = !isTown
    ? `${esc(r.city)}の福祉事務所${seirei.has(r.city) ? '（住んでいる区の区役所にある生活保護の窓口）' : '（市役所の生活保護の窓口）'}が受け持ちます。`
    : ownOffice.has(r.code)
      ? `${esc(r.city)}が自前の福祉事務所を置いていて、${esc(r.city)}役場の窓口が受け持ちます。`
      : `${esc(r.city)}は福祉事務所を置いていないので、${esc(r.pref)}の福祉事務所が受け持ちます。<strong>${esc(r.city)}役場を通して申請することもできます</strong>（生活保護法第24条第10項「保護の開始又は変更の申請は、町村長を経由してすることもできる」）。`
  const rentBlock = r.rent
    ? `<p>${esc(r.city)}の家賃の上限（住宅扶助の限度額）は、<strong>${rentTxt(r.rent)}</strong>です。家賃がこれより安ければ実際の家賃まで、高ければ上限までが出ます。上限は${esc(orgOf(r))}が級地ごとに決めていて、${esc(r.city)}は${esc(orgOf(r))}の額です。</p>
  <p class="mini-note">出典：<a href="${esc(r.src.u)}" rel="noopener">${esc(r.src.o)}の公表資料</a>。上限は世帯の人数で決まり、車いすの人がいる・床面積が狭いなどの事情で変わることがあります。</p>`
    : `<p>${esc(r.city)}の家賃の上限（住宅扶助の限度額）は、まだ公表資料で確かめられていません。上限は${esc(orgOf(r))}が決めています。<strong>上の表の「合計」には家賃を入れていません</strong>。実際の上限は福祉事務所で確かめてください。</p>`
  const title = `${r.pref}${r.city}の生活保護費はいくら？ひとり暮らし${s.cap ? `${yen(s.total)}（家賃込み）` : `の生活扶助${yen(s.life)}`}｜${r.kyuchi}（令和8年度）｜フクシル`
  const desc = `${r.pref}${r.city}（${r.kyuchi}・冬季加算${r.area}）の生活保護費の目安を、世帯の形ごとに。ひとり暮らし20〜40歳は生活扶助${yen(s.life)}${s.cap ? `＋家賃の上限${yen(s.cap)}＝月${yen(s.total)}` : ''}、65〜69歳の夫婦は${yen(f2.total)}。冬の月と12月の額、申請の窓口も。`
  const items = [['ホーム', 'index.html'], ['生活保護費の目安（市区町村別）', 'seiho/'], [r.pref, `seiho/ken/${pref2(r)}/`], [r.city, null]]
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)} ／ 生活扶助は告示の表から計算し、<a href="${up}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>と同じ式で出しています</p>
  <h1>${esc(r.pref)}${esc(r.city)}の生活保護費の目安<br><small>世帯の形ごとの最低生活費（生活扶助＋家賃の上限）・冬の月と12月</small></h1>

  <p class="lead">${esc(r.city)}は、生活保護の地域の区分（級地）で<strong>${r.kyuchi}</strong>、冬季加算は<strong>${r.area}</strong>（${T.m}の${T.n}か月）です。${r.k === 0 ? '級地はいちばん高い区分です。' : `ひとり暮らし20〜40歳の生活扶助は${yen(mine)}で、いちばん高い1級地-1（${yen(top)}）より${yen(top - mine)}低くなります。`}収入がまったく無い世帯が受け取れる額の目安（最低生活費）は、次のとおりです。</p>

  <h2>① 世帯の形ごとの目安（令和8年度）</h2>
${hhTable(r)}
  <p class="mini-note">「生活扶助と加算」は、食費・光熱費などの生活費（第1類・第2類・経過的加算・特例加算）に、ひとり親の母子加算・子の児童養育加算・障害者加算・教育扶助（小学生${yen(X.KYOIKU.e)}・中学生${yen(X.KYOIKU.j)}）を足した額です。「合計」は家賃が上限以上の場合で、家賃が安ければその分少なくなります。冬の月は冬季加算（${r.area}）を、12月はさらに期末一時扶助を足しています。医療費は医療扶助で自己負担がありません。</p>
  <p class="mini-note">収入があるときは、最低生活費から収入（働いた収入は勤労控除を引いた残り・年金などは原則として全額）を引いた額が支給されます。収入が最低生活費より多ければ支給はありません。</p>

  <h2>② ${esc(r.city)}の家賃の上限</h2>
  ${rentBlock}

  <h2>③ 自分の世帯で計算する</h2>
  <p><a href="${calcLink(up, r)}"><strong>${esc(r.city)}を選んだ状態で、生活保護の計算機を開く</strong></a>（世帯の人数・年齢・家賃・働いた収入を入れると、支給額の目安が出ます）</p>

  <h2>④ 申請するところ</h2>
  <p>${office}申請は本人のほか、扶養義務者や同居の親族もできます。窓口で「申請します」と伝えれば、申請書を受け取ってもらえます。原則14日以内（長くても30日以内）に、保護するかどうかが書面で届きます。</p>
  <p class="mini-note">福祉事務所の所在地は、厚生労働省が公表している<a href="${up}tsuika/${pref2(r)}/">生活保護の追加給付の申出先（${esc(r.pref)}）</a>にも載っています。${shinseiCity.has(r.city) ? `${esc(r.city)}の申請の却下率は<a href="${up}articles/seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>にあります。` : ''}</p>

  <h2>⑤ ${esc(r.pref)}の中で額が違う市町村</h2>
  ${groups ? `<p>同じ${esc(r.pref)}でも、級地が違うと生活扶助の額が変わります。</p>\n  <ul>\n${groups}\n  </ul>` : `<p>${esc(r.pref)}の市区町村は、どこも${r.kyuchi}です。</p>`}
  <p><a href="${up}seiho/ken/${pref2(r)}/">${esc(r.pref)}の全${pl.length}市区町村の表</a>${prev ? ` ／ <a href="${up}seiho/${prev.code}/">← ${esc(prev.city)}</a>` : ''}${next ? ` ／ <a href="${up}seiho/${next.code}/">${esc(next.city)} →</a>` : ''}</p>

  <h2>あわせて読む</h2>
  <ul>
  <li><a href="${up}hikazei/${r.code}/">${esc(r.city)}の住民税非課税の年収の目安</a>（生活保護の手前で受けられる軽減の線）</li>
  <li><a href="${up}articles/seikatsuhogo-keisanki.html">生活保護はいくらもらえる？支給額の計算機</a>（申請前に知っておくこと・今日食べるものがないときの窓口も）</li>
  <li><a href="${up}articles/seikatsuhogo-tsuika-kyufu.html">生活保護の追加給付</a>（2013年8月〜2026年3月に保護を受けていた世帯）</li>
  <li><a href="${up}articles/muryou-teigaku-shukuhakusho.html">無料低額宿泊所とは</a>（住まいを失いかけて施設を紹介されたら）</li>
  </ul>

  <div class="sources"><h2>出典と、この表の決まりごと</h2><ul>
  <li>生活扶助・冬季加算・期末一時扶助・各加算＝${KOKUJI_SRC}</li>
  <li>級地＝${KYUCHI_SRC}</li>
  <li>家賃の上限＝${r.rent ? `<a href="${esc(r.src.u)}" rel="noopener">${esc(r.src.o)}の公表資料</a>` : '未確認（公表資料で確かめられた実施機関の額だけを載せています）'}</li>
  <li>申請の経由＝生活保護法 第24条第10項（e-Gov法令検索）</li>
  </ul>
  <p class="mini-note">ここの額は、収入も資産も無い世帯の目安です。実際の支給額と、保護するかどうかを決めるのは福祉事務所です。誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。確かめて直します。</p></div>
`
  return page({ title, desc, canonical: `/seiho/${r.code}/`, depth: 2, body, jsonld: [articleLd(title, desc, `/seiho/${r.code}/`), bcLd(items)] })
}

// ── 7. 都道府県のページ ─────────────────────────────────────────────────────────
const kenPage = (p2, pref) => {
  const up = '../../../'
  const list = muniOfPref(p2)
  const area = list[0].area, T = X.TOUKI[area]
  const known = list.filter((r) => r.rent).length
  const tr = list.map((r) => {
    const s = calcRow(r, HH[0]), f2 = calcRow(r, HH[4])
    return `<tr><th scope="row"><a href="${up}seiho/${r.code}/">${esc(r.city)}</a></th><td>${r.kyuchi}</td><td class="num">${yen(s.life)}</td><td class="num">${s.cap ? yen(s.cap) : '<small>未確認</small>'}</td><td class="num">${s.cap ? `<strong>${yen(s.total)}</strong>` : '—'}</td><td class="num">${f2.cap ? yen(f2.total) : '—'}</td></tr>`
  }).join('\n')
  const ks = [...new Set(list.map((r) => r.k))].sort((p, q) => p - q)
  const title = `${pref}の生活保護費の目安｜全${list.length}市区町村の級地・家賃の上限・ひとり暮らしの額（令和8年度）｜フクシル`
  const desc = `${pref}の生活保護費の目安を市区町村ごとに。級地は${ks.map((k) => KY[k]).join('・')}、冬季加算は${area}。ひとり暮らし20〜40歳の生活扶助は${ks.map((k) => yen(single30(k))).join('・')}。家賃の上限は${list.length}市区町村のうち${known}で確認済み。`
  const items = [['ホーム', 'index.html'], ['生活保護費の目安（市区町村別）', 'seiho/'], [pref, null]]
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)}</p>
  <h1>${esc(pref)}の生活保護費の目安<br><small>全${list.length}市区町村・級地と家賃の上限（令和8年度）</small></h1>
  <p class="lead">${esc(pref)}の市区町村の級地は${ks.map((k) => `<strong>${KY[k]}</strong>（${list.filter((r) => r.k === k).length}）`).join('・')}です。冬季加算は<strong>${area}</strong>（${T.m}・ひとり暮らしで月${yen(T.v[0])}）。家賃の上限は、${list.length}市区町村のうち${known}で公表資料を確かめています。</p>
  <div class="table-wrap"><table class="fit ken">
  <thead><tr><th>市区町村</th><th>級地</th><th class="num">ひとり暮らし<br><small>生活扶助</small></th><th class="num">家賃の上限<br><small>1人</small></th><th class="num">ひとり暮らし<br><small>合計</small></th><th class="num">夫婦65〜69歳<br><small>合計</small></th></tr></thead>
  <tbody>
${tr}
  </tbody></table></div>
  <p class="mini-note">ひとり暮らしは20〜40歳。合計＝生活扶助＋家賃の上限（家賃が上限以上の場合）で、冬季加算と12月の期末一時扶助は入れていません。家賃の上限が未確認の市町村は合計を出していません。市区町村の名前から、世帯の形ごとの額・冬と12月の額・申請の窓口のページへ進めます。</p>
  <p><a href="${up}seiho/">ほかの都道府県から探す</a> ／ <a href="${up}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a></p>
  <div class="sources"><h2>出典</h2><ul><li>${KOKUJI_SRC}</li><li>級地＝${KYUCHI_SRC}</li><li>家賃の上限＝各市区町村のページに出典を書いています</li></ul></div>
`
  return page({ title, desc, canonical: `/seiho/ken/${p2}/`, depth: 3, body, jsonld: [articleLd(title, desc, `/seiho/ken/${p2}/`), bcLd(items)] })
}

// ── 8. 入口のページ ─────────────────────────────────────────────────────────────
const hubPage = () => {
  const up = '../'
  const known = rows.filter((r) => r.rent).length
  const grid = KY.map((name, k) => {
    const n = rows.filter((r) => r.k === k).length
    const f2 = X.seihoKijun(k, [68, 66], {}).seikatsu
    return `<tr><th scope="row">${name}<br><small>${n}市区町村</small></th><td class="num">${yen(single30(k))}</td><td class="num">${yen(X.seihoKijun(k, [78], {}).seikatsu)}</td><td class="num">${yen(f2)}</td></tr>`
  }).join('\n')
  const touki = Object.entries(X.TOUKI).map(([ar, t]) => `<tr><th scope="row">${ar}</th><td>${t.m}</td><td class="num">${yen(t.v[0])}</td><td class="mini-note">${PREFS.filter(([, p]) => X.TOUKI_AREA[p] === ar).map(([, p]) => esc(p)).join('・')}</td></tr>`).join('\n')
  const prefLinks = PREFS.map(([p2, pref]) => `<li><a href="${up}seiho/ken/${p2}/">${esc(pref)}</a>（${muniOfPref(p2).length}）</li>`).join('\n')
  const title = '生活保護費の目安を市区町村から｜全国1,741市区町村の級地・家賃の上限・世帯別の額（令和8年度）｜フクシル'
  const desc = `生活保護費の目安を全国1,741市区町村ごとに。生活扶助は級地で6段（ひとり暮らし20〜40歳で${yen(single30(5))}〜${yen(single30(0))}）、家賃の上限は${known}市区町村で公表資料を確認。冬季加算・12月の額・申請の窓口も。`
  const items = [['ホーム', 'index.html'], ['生活保護費の目安（市区町村別）', null]]
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)}</p>
  <h1>生活保護費の目安を、住んでいる市区町村から<br><small>全国1,741市区町村・世帯の形ごと・冬と12月（令和8年度）</small></h1>
  <p class="lead">生活保護費は全国一律ではありません。生活費の部分（生活扶助）は住んでいる市区町村の<strong>級地</strong>で6段に分かれ、家賃（住宅扶助）の上限は都道府県・政令市・中核市が級地ごとに決め、冬季加算は都道府県で決まります。市区町村を選ぶと、その地域の額を世帯の形ごとに見られます。</p>
  <h2>級地ごとの生活扶助（令和8年度・家賃を除く）</h2>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>級地</th><th class="num">ひとり暮らし<br><small>20〜40歳</small></th><th class="num">ひとり暮らし<br><small>75歳以上</small></th><th class="num">夫婦<br><small>65〜69歳の2人</small></th></tr></thead>
  <tbody>
${grid}
  </tbody></table></div>
  <p class="mini-note">告示の表（第1類・第2類・経過的加算・特例加算）から、生活保護の計算機と同じ式で計算しています。家賃の上限は、全国1,741市区町村のうち${known}で公表資料を確かめました（残りは各ページに「未確認」と書いています）。</p>
  <h2>冬季加算（都道府県で決まる）</h2>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>地区</th><th>期間</th><th class="num">ひとり暮らし<br><small>月額</small></th><th>都道府県</th></tr></thead>
  <tbody>
${touki}
  </tbody></table></div>
  <h2>都道府県から探す</h2>
  <ul class="links">
${prefLinks}
  </ul>
  <h2>あわせて読む</h2>
  <ul>
  <li><a href="${up}articles/seikatsuhogo-keisanki.html">生活保護はいくらもらえる？支給額の計算機</a>（世帯の人数・年齢・家賃・働いた収入を入れて計算）</li>
  <li><a href="${up}articles/seikatsuhogo-jisshitsu.html">生活保護費の「実質」はどこが厚いか</a>（物価と電気代で割り戻した52市の比較）</li>
  <li><a href="${up}articles/seikatsuhogo-shinsei-jichitai.html">生活保護の却下率、自治体でこれだけ違う</a></li>
  <li><a href="${up}hikazei/">住民税非課税の年収の目安（市区町村別）</a></li>
  </ul>
  <div class="sources"><h2>出典</h2><ul><li>${KOKUJI_SRC}</li><li>級地＝${KYUCHI_SRC}</li><li>家賃の上限＝各市区町村のページに出典を書いています</li></ul>
  <p class="mini-note">ここの額は、収入も資産も無い世帯の目安です。実際の支給額と、保護するかどうかを決めるのは福祉事務所です。</p></div>
`
  return page({ title, desc, canonical: '/seiho/', depth: 1, body, jsonld: [articleLd(title, desc, '/seiho/'), bcLd(items)] })
}

// ── 9. 書き出し ─────────────────────────────────────────────────────────────────
const out = [['seiho/index.html', '/seiho/', hubPage(), '0.6']]
for (const [p2, pref] of PREFS) out.push([`seiho/ken/${p2}/index.html`, `/seiho/ken/${p2}/`, kenPage(p2, pref), '0.5'])
for (const r of rows) out.push([`seiho/${r.code}/index.html`, `/seiho/${r.code}/`, cityPage(r), '0.4'])

const s0r = rows.find((r) => r.pref === '大阪府' && r.city === '大阪市')
console.log(`ページ ${out.length}枚（入口1・都道府県${PREFS.length}・市区町村${rows.length}）／ 台帳の北方領土など名簿に無い ${extra}件は作らない`)
console.log(`家賃の上限あり ${rows.filter((r) => r.rent).length} ／ 自前の福祉事務所のある町村 ${rows.filter((r) => !/[市区]$/.test(r.city) && ownOffice.has(r.code)).length}`)
console.log(`確かめ：計算機の早見表・seiho-ranking.json・検算の値（大阪市・札幌市）と1円一致 ／ 例 大阪市 ひとり暮らし20〜40歳 合計 ${yen(calcRow(s0r, HH[0]).total)}（生活扶助 ${yen(calcRow(s0r, HH[0]).life)}＋家賃 ${yen(calcRow(s0r, HH[0]).cap)}）`)
if (DRY) process.exit(0)

let changedN = 0, embedN = 0
const changedLocs = new Set()
for (const [rel, loc, html] of out) {
  const p = path.join(ROOT, rel)
  const kind = pageDiff(readPrev(p), html)
  if (kind === 'same') continue
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
  if (kind === 'embed') { embedN++; continue }
  changedN++; changedLocs.add(loc)
}
const known = new Set(M.map((r) => r.code))
const strays = fs.readdirSync(path.join(ROOT, 'seiho')).filter((d) => /^\d{5}$/.test(d) && !known.has(d))
if (strays.length) console.warn(`一覧に無い市区町村のページが残っています（手で確かめて消す）: ${strays.join(', ')}`)

// sitemap.xml：lastmod は中身が変わった日だけ進める。読み書きは shogai-kojo-page.mjs の readSitemap・putUrls・writeSitemap
const sm = readSitemap()
const prevMod = sitemapLastmods(sm)
const entry = (loc, pri) => {
  const full = `${SITE}${loc}`
  const lm = changedLocs.has(loc) || !prevMod.has(full) ? TODAY : prevMod.get(full)
  return `<url><loc>${full}</loc><lastmod>${lm}</lastmod><changefreq>monthly</changefreq><priority>${pri}</priority></url>`
}
const smNext = putUrls(sm, out.map(([, loc, , pri]) => [`${SITE}${loc}`, entry(loc, pri)]), (loc) => loc.startsWith(`${SITE}/seiho/`))
writeSitemap(smNext)
console.log(`書き出し ${changedN}枚${embedN ? `（計測の埋め込みだけ ${embedN}枚）` : ''} ／ sitemap ${smNext !== sm ? '更新' : '変更なし'}（${[...smNext.matchAll(/<loc>/g)].length}URL）`)
