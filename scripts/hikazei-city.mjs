// ─────────────────────────────────────────────────────────────────────────────
// hikazei-city.mjs — 住民税が非課税になる年収の目安を「市区町村ごと」に出す /hikazei/ を作る。
//   node scripts/hikazei-city.mjs        → hikazei/index.html・hikazei/ken/<県2桁>/・hikazei/<市区町村5桁>/ と sitemap.xml
//   node scripts/hikazei-city.mjs --dry  → 書かずに件数と確かめの結果だけ出す
//
// ★この面で言っていること（2026-09-23 着工・発案第142回の生存案・ユーザー「いますぐやってくれ」）
//   住民税の非課税の線は、住んでいる市区町村の「級地」で3段に分かれる（1級地1.0／2級地0.9／3級地0.8）。
//   人が来ている語は「住民税非課税世帯 年収」（Bing 5位）＝線を引きに来ている。全国一律の表か自分の市だけの表は
//   あっても、1,741市区町村×世帯人数×（給与・年金）を1枚ずつ出している所は無い。
//
// ★式はここに書かない。hikazei-lib.mjs の1か所だけ（/mitoshi/hikazei/ と共有）。
//   さらに、計算機の記事（articles/juminzei-hikazei-check.html）のブラウザ側の関数をここで読み込み、
//   全部の世帯×級地×収入の種類で「目安の額なら非課税・1万円上なら非課税でない」が一致するかを毎回確かめる。
//   合わなければ何も書かずに止める（記事とこの面が別のことを言い出すのを防ぐ）。
//
// ★2級地・3級地の額は「率を参酌して」市町村が条例で決める＝丸めている市町村がある。
//   公式ページで確かめた額は data/hikazei-city-checks.json に書き、その市町村はその額で出す。
//   確かめていない市町村は「国の標準の値」と明記し、確かめた範囲で何件が丸めていたかを同じ画面に書く。
//   1級地は政令で額そのものが決まっている（大阪市・名古屋市と1円単位で一致を確認済み）。
//
// ★読む人は暮らしが苦しい人。数字だけで終わらせず、その線で何が変わるか（医療費の上限・給付金）へつなぐ。
//   ただし金額は他の面が正典のものを写さない（高額療養費の額は /mitoshi/kogaku/ にしか書かない）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { D, L, NS, maxIncome, maxPension, kintouLim, shotokuLim, SPECIAL_LIM, man, manT, selfCheck } from './hikazei-lib.mjs'
import { K as KK, selfCheck as kokuhoCheck, lines as kLines, annual as kAnnual, setOf as kSetOf, yen, rateTxt, lvTxt } from './kokuho-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

const M = readJson('data/muni-master.json').rows
const CK = readJson('data/hikazei-city-checks.json')
const JF = readJson('data/jutaku-fujo.json')
const HS = readJson('data/hogo-shinsei.json')
const SR = readJson('data/seiho-ranking.json')
const CHECKED = [D.checked, CK.checked, KK.checked].sort().pop()

// ── 1. 式の確かめ（大阪市・名古屋市の公表値と1円単位）────────────────────────────
{ const e = selfCheck(); if (e) die(e) }
if (M.length !== 1741) die(`市区町村の数が1,741ではありません（${M.length}件）`)
// 国保の軽減の線と年額（式は kokuho-lib.mjs）。公表の計算例と1円でも違えば止める
{ const e = kokuhoCheck(); if (e) die(`国保：${e}`) }

// ── 2. 計算機の記事（別実装）と突き合わせる ───────────────────────────────────────
//   記事は万円で受けて、円の整数どうしで比べる（2026-09-23 に直した。それまでは0.1万円に丸めて比べていて、
//   扶養2人の205万9,999円＝大阪市の公表で非課税 を「課税」と言っていた）。
//   ∴ 1円単位で合うはず：「目安の額なら非課税」「目安＋1円なら非課税でない」の2点で見る。
{
  const art = fs.readFileSync(path.join(ROOT, 'articles', 'juminzei-hikazei-check.html'), 'utf8')
  const src = (art.match(/function salaryShotoku[\s\S]*?function genkaiShotokuwari\(fuyo\)\{[\s\S]*?\n\}/) || [])[0]
  if (!src) die('計算機の記事から判定の関数を読み出せません（記事の書き方が変わった？）')
  const F = vm.runInNewContext(`${src}\n;({ salaryShotoku, pensionShotoku, genkai, genkaiShotokuwari })`)
  const yen = (m) => Math.round(m * 10000)   // 記事の calc() と同じ比べ方
  const bad = []
  // step＝「非課税でない」と言うはずの額までの幅。年金65歳未満の収入×75%の段は1円未満が出て、記事は円に丸め、
  // こちらは切り捨て側（確実に線の内側）で目安を出すので、境目が最大1円ずれる。その段だけ2円で見る。
  const probe = (label, X, shotokuOf, limMan, step = 1) => {
    if (!(yen(shotokuOf(X / 10000)) <= yen(limMan))) bad.push(`${label}: 目安 ${X}円 で記事が非課税と言わない`)
    if (yen(shotokuOf((X + step) / 10000)) <= yen(limMan)) bad.push(`${label}: 目安＋${step}円 ${X + step}円 でも記事が非課税と言う`)
  }
  for (const k of ['1', '2', '3']) {
    for (const n of NS) {
      const lim = kintouLim(k, n), limMan = F.genkai(Number(k), n)
      probe(`${k}級地 扶養${n} 給与`, maxIncome('r8', lim), F.salaryShotoku, limMan)
      probe(`${k}級地 扶養${n} 年金65歳以上`, maxPension(true, lim), (m) => F.pensionShotoku(m, true), limMan)
      probe(`${k}級地 扶養${n} 年金65歳未満`, maxPension(false, lim), (m) => F.pensionShotoku(m, false), limMan, 2)
    }
  }
  for (const n of NS) probe(`所得割 扶養${n} 給与`, maxIncome('r8', shotokuLim(n)), F.salaryShotoku, F.genkaiShotokuwari(n))
  probe('135万円の特例 給与', maxIncome('r8', SPECIAL_LIM), F.salaryShotoku, 135)
  if (bad.length) die(`計算機の記事とこの面で判定が合いません（${bad.length}件）\n  ${bad.slice(0, 12).join('\n  ')}`)
}

// ── 3. 公式ページで確かめた額（丸めている市町村はその額で出す）─────────────────────
const byCode = new Map(M.map((r) => [r.code, r]))
const STD = (k) => ({ base: L.kintou.base[k], add: L.kintou.add[k] })
for (const [code, c] of Object.entries(CK.rows)) {
  const r = byCode.get(code)
  if (!r) die(`確かめた額の表のコード ${code}（${c.name}）が市区町村の一覧にありません`)
  if (`${r.pref}${r.city}` !== c.name) die(`確かめた額の表の名前がずれています: ${code} ${c.name} ／ 一覧は ${r.pref}${r.city}`)
  if (!Number.isInteger(c.base) || !Number.isInteger(c.add) || !c.url || !c.checkedAt) die(`確かめた額の表に欠けがあります: ${code} ${c.name}`)
  if (r.zeiKyuchi === '1' && (c.base !== STD('1').base || c.add !== STD('1').add)) die(`1級地なのに政令と違う額が書かれています: ${c.name}`)
}
const ckOf = (r) => CK.rows[r.code] || null
const statusOf = (r) => {
  const c = ckOf(r)
  if (r.zeiKyuchi === '1') return c ? 'law-checked' : 'law'
  if (!c) return 'standard'
  const s = STD(r.zeiKyuchi)
  return c.base === s.base && c.add === s.add ? 'match' : 'rounded'
}
// 確かめた範囲の数字（2級地・3級地だけ）。ページの文言はここから作る＝手で書かない。
const checked23 = M.filter((r) => r.zeiKyuchi !== '1' && ckOf(r))
const rounded23 = checked23.filter((r) => statusOf(r) === 'rounded')
const lower23 = rounded23.filter((r) => kintouLim(r.zeiKyuchi, 0, ckOf(r).base, ckOf(r).add) < kintouLim(r.zeiKyuchi, 0))
const SURVEY = CK.survey || null   // 標本調査のまとめ（見つからなかった件数など）

// ── 4. 市区町村ごとの数字 ───────────────────────────────────────────────────────
const lines = (r) => {
  const k = r.zeiKyuchi, c = ckOf(r)
  const base = c ? c.base : STD(k).base, add = c ? c.add : STD(k).add
  return NS.map((n) => {
    const lim = kintouLim(k, n, base, add)
    return { n, lim, sal8: maxIncome('r8', lim), sal9: maxIncome('r9', lim), p65: maxPension(true, lim), p64: maxPension(false, lim) }
  })
}
const SHOTOKU = NS.map((n) => { const lim = shotokuLim(n); return { n, lim, sal8: maxIncome('r8', lim), sal9: maxIncome('r9', lim), p65: maxPension(true, lim) } })
const SPECIAL = { sal8: maxIncome('r8', SPECIAL_LIM), sal9: maxIncome('r9', SPECIAL_LIM), p65: maxPension(true, SPECIAL_LIM), p64: maxPension(false, SPECIAL_LIM) }
// 級地ごとの標準（県のページ・入口のページで使う）
const STDLINES = Object.fromEntries(['1', '2', '3'].map((k) => [k, NS.map((n) => { const lim = kintouLim(k, n); return { n, lim, sal8: maxIncome('r8', lim), sal9: maxIncome('r9', lim), p65: maxPension(true, lim), p64: maxPension(false, lim) } })]))

// ── 5. 同じ市区町村の「暮らしの線」（他の面が正典のものはリンクか、データを読むだけ）─────────
const majors = new Set(HS.rows.filter((x) => x.level === '指定都市' || x.level === '中核市').map((x) => x.name))
const nameCount = M.reduce((m, r) => m.set(r.city, (m.get(r.city) || 0) + 1), new Map())
const jutakuOf = (r) => {
  const own = JF.orgs[r.city]
  if (own && own.pref === r.pref && own.level !== '都道府県') return { org: r.city, row: own.rows[0], source: own.source, how: '市の表' }
  if (majors.has(r.city) || nameCount.get(r.city) > 1) return null      // 指定都市・中核市は県の表を使わない（名前が重なる市も安全側で出さない）
  const pf = JF.orgs[r.pref]
  if (!pf || pf.level !== '都道府県') return null
  const row = pf.rows.find((x) => x.kyuchi === `${r.zeiKyuchi}級地`)
  return row ? { org: r.pref, row, source: pf.source, how: `${r.pref}の表・${r.zeiKyuchi}級地` } : null
}
const seihoOf = (r) => SR.rows.find((x) => x.city === r.city && x.pref === r.pref) || null
const KOEI = { '東京都': ['toei/', '都営住宅の倍率と申込先'], '神奈川県|川崎市': ['kawasaki/', '川崎市営住宅の倍率と申込先'], '神奈川県|横浜市': ['yokohama/', '横浜市営住宅の倍率と申込先'], '兵庫県|神戸市': ['kobe/', '神戸市営住宅の倍率と申込先'], '静岡県|静岡市': ['shizuoka/', '静岡市営住宅の倍率と申込先'], '神奈川県|相模原市': ['sagamihara/', '相模原市営住宅の倍率と申込先'] }
const koeiOf = (r) => KOEI[`${r.pref}|${r.city}`] || KOEI[r.pref] || null
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

// ── 6. 表示の部品 ─────────────────────────────────────────────────────────────
const CSS = `<style>table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit tbody th{white-space:nowrap}table.fit td.num,table.fit th.num{white-space:normal;word-break:keep-all}table.fit small{font-weight:400}.mini-note{font-size:.86rem;color:var(--sub)}ul.links{columns:2;column-gap:1.4em;padding-left:1.2em}ul.links li{break-inside:avoid;margin:.15em 0}@media (max-width:620px){ul.links{columns:1}}td.nm{white-space:normal}</style>`
const WHO = ['単身', '扶養1人', '扶養2人', '扶養3人', '扶養4人']
const WHO_SUB = ['扶養なし', '夫婦など', '夫婦＋子1人など', '', '']
const whoTh = (n, lim) => `<th scope="row">${WHO[n]}${WHO_SUB[n] ? `<br><small>${WHO_SUB[n]}</small>` : ''}${lim != null ? `<br><small>所得${man(lim)}以下</small>` : ''}</th>`
const moveTxt = (a, b) => (a === b ? '<strong>動かない</strong>' : `＋${manT(b - a)}`)
const kyuchiName = (k) => `${k}級地`
const pref2 = (r) => r.code.slice(0, 2)
const crumbs = (items, up) => `<nav class="breadcrumb" aria-label="現在地">${items.map(([label, href]) => (href ? `<a href="${up}${href}">${esc(label)}</a>` : esc(label))).join(' › ')}</nav>`
const bcLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(href != null ? { item: `${SITE}/${href}` } : {}) })) })
const articleLd = (title, desc, url) => ({ '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}${url}`, datePublished: '2026-09-23', dateModified: CHECKED, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } })

const PREFS = [...new Map(M.map((r) => [pref2(r), r.pref])).entries()]   // [['01','北海道'], …]
const muniOfPref = (p2) => M.filter((r) => pref2(r) === p2)

// 確かめた範囲の数字を級地ごとに言う（2級地と3級地で丸めの多さがまるで違う＝2026-09-23 実測で2級地17のうち7、3級地27のうち1）
const surveyTxt = (k) => {
  const ks = k ? [k] : ['2', '3']
  const parts = ks.map((g) => {
    const all = checked23.filter((r) => r.zeiKyuchi === g), rd = all.filter((r) => statusOf(r) === 'rounded')
    return all.length ? `${kyuchiNameS(g)}${all.length}のうち${rd.length}` : ''
  }).filter(Boolean)
  if (!parts.length) return ''
  const lowerTxt = lower23.length ? `標準より低い額にしていた市町村も${lower23.length}ありました。` : '標準より低い額にしていた市町村はありません。表の額以下なら非課税の見込みで、表の額を少し超えても非課税のことがあります。'
  return `フクシルが市区町村の公式ページで額を確かめた範囲では、${parts.join('、')}の市町村が標準と違う額（高い側に丸め）にしていました。${lowerTxt}`
}
const kyuchiNameS = (k) => `${k}級地`

const sourcesList = (r, c) => `<div class="sources">
  <h2>出典と、この表の決まりごと</h2>
  <ul>
  <li>級地＝厚生労働省「お住まいの地域の級地を確認」https://www.mhlw.go.jp/content/kyuchi.3010.pdf（平成30年10月1日現在・現行）。住民税の線に効くのは1級地・2級地・3級地の3段で、「-1」「-2」の区別は効きません</li>
  <li>非課税の線（均等割）＝${esc(L.kintou.src)} ${esc(L.kintou.srcUrl)}</li>
  <li>非課税の線（所得割）＝${esc(L.shotoku.src)}</li>
  <li>給与所得控除＝国税庁 タックスアンサーNo.1410 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm（令和7年分・令和8年分の表）</li>
  <li>公的年金等控除＝国税庁 タックスアンサーNo.1600 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1600.htm（令和2年分以後の表・年金以外の所得が1,000万円以下の人）</li>
  ${c ? `<li>${esc(r.pref + r.city)}の公表＝<a href="${esc(c.url)}" rel="nofollow">${esc(c.url)}</a>（${esc(c.nendo || '')}${c.nendo ? '・' : ''}${esc(c.checkedAt)}に確認）</li>` : ''}
  <li>計算の確かめ＝${esc(D.check.src)}（令和8年度・10個）・${esc(D.check2.src)}（令和9年度・単身）と1円単位で一致</li>
  <li>国保の軽減の線＝${esc(KK.keigen.law)}。${KK.keigen.sources.map((x) => `${esc(x.name)} ${esc(x.url)}`).join('／')}</li>
  ${kokuhoSourceLi(r)}
  <li>ここに出したのは<strong>給与だけ・年金だけの人の目安</strong>です。両方ある人、事業などの収入がある人、各種の控除がある人は変わります。実際に課税か非課税かを決めるのは${r ? `${esc(r.city)}` : '市区町村'}です。</li>
  <li>誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。確かめて直します。</li>
  </ul>
  </div>`

// ── 6b. 国民健康保険（国保）の軽減の線と年額（式は kokuho-lib.mjs の1か所だけ）───────────────
//   軽減（7割・5割・2割）の線は全国共通。年額は、料率を公式ページで確かめた所（data/kokuho.json）だけ出す。
//   年額は大人だけの世帯に限る（子どもは未就学児の軽減や市町村独自の軽減があって、1つの式で言い切れない）。
//   ★2026-09-25 ユーザー裁定（発案第143回 #86「これはぜひやろう」）＝料率が取れた市だけ年額を出し、取れない市は線だけ。
const KG = KK.keigen
const KL = { sal: [1, 2, 3, 4, 5].map((n) => kLines('sal', n)), pen: [1, 2].map((n) => kLines('pen65', n)) }
const K7SAL = KL.sal[0][7], K7PEN = KL.pen[0][7]
// 7割の線は人数によらない（稼ぐ人が1人のとき）。人数で変わったら文言が嘘になるので止める
if (KL.sal.some((x) => x[7] !== K7SAL) || KL.pen.some((x) => x[7] !== K7PEN)) die('国保の7割軽減の線が人数で変わっています（ページの文言の前提が崩れた）')
const NIN = ['単身', '2人', '3人', '4人', '5人']
const NIN_SUB = ['', '夫婦など', '夫婦＋子1人など', '夫婦＋子2人など', '夫婦＋子3人など']
const ninTh = (i) => `<th scope="row">${NIN[i]}${NIN_SUB[i] ? `<br><small>${NIN_SUB[i]}</small>` : ''}</th>`
const lineRows = (arr) => arr.map((x, i) => `<tr>${ninTh(i)}<td class="num">${manT(x[5])}</td><td class="num">${manT(x[2])}</td></tr>`).join('\n')
const H0 = KG.history[0], HN = KG.history[KG.history.length - 1]
const kokuhoLines = () => `<p><strong>給与だけの世帯</strong>（給与をもらう人は1人・ほかの人は収入なし）。7割軽減は人数によらず<strong>給与収入${man(K7SAL)}以下</strong>です。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>国保の人数</th><th class="num">5割軽減</th><th class="num">2割軽減</th></tr></thead>
  <tbody>
${lineRows(KL.sal)}
  </tbody></table></div>
  <p><strong>年金だけの世帯</strong>（65〜74歳・年金をもらう人は1人。2人の世帯のもう1人は年金110万円以下）。7割軽減は人数によらず<strong>年金収入${man(K7PEN)}以下</strong>です。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>国保の人数</th><th class="num">5割軽減</th><th class="num">2割軽減</th></tr></thead>
  <tbody>
${lineRows(KL.pen)}
  </tbody></table></div>
  <p class="mini-note">収入が表の額以下なら、その割合の軽減の目安です（2割軽減の列＝何かしら軽減される上限）。「国保の人数」は世帯で国保に入っている人の数で、国保から後期高齢者医療に移った人も数えます。判定に使うのは、世帯主（国保に入っていなくても）と国保の人全員の${esc(KG.incomeYear)}の合計です。給与や年金をもらう人（給与収入55万円超・65歳以上で年金125万円超・65歳未満で年金60万円超）が2人以上いると、1人ふえるごとに線が所得で10万円上がります。65歳以上の年金は、判定のときだけ所得から15万円を引きます。障害年金・遺族年金は収入に数えません。5割・2割の線（1人あたりの所得の額）は毎年上がっていて、${esc(H0.nendo)}の${man(H0.go)}・${man(H0.ni)}から、${esc(HN.nendo)}は${man(HN.go)}・${man(HN.ni)}になりました。</p>
  <div class="callout warn"><p><span class="tag">申告が要ります</span>世帯の誰かが所得の申告をしていないと、軽減されません。<strong>収入が0円の人も</strong>、住民税の申告（または確定申告）をしておく必要があります。</p></div>`
// 年額の表に出す世帯（大人だけ）
const HH = [
  { id: 'sal', title: '単身・40〜64歳・給与だけ', mk: (x) => [{ age: 45, sal: x }], L: KL.sal[0], rows: [0, KL.sal[0][7], KL.sal[0][5], KL.sal[0][2], 2000000, 3000000] },
  { id: 'pen1', title: '単身・65〜74歳・年金だけ', mk: (x) => [{ age: 70, pen: x }], L: KL.pen[0], rows: [1000000, KL.pen[0][7], KL.pen[0][5], KL.pen[0][2], 3000000] },
  { id: 'pen2', title: '夫婦2人・65〜74歳・年金は1人だけ（もう1人は年金110万円以下）', mk: (x) => [{ age: 70, pen: x }, { age: 70 }], L: KL.pen[1], rows: [1000000, KL.pen[1][7], KL.pen[1][5], KL.pen[1][2], 3500000] },
]
const tagOf = (hh, x) => (x === hh.L[7] ? '7割の上限' : x === hh.L[5] ? '5割の上限' : x === hh.L[2] ? '2割の上限' : '')
const annualRows = (rs, hh) => hh.rows.map((x) => {
  const a = kAnnual(rs, hh.mk(x)), tag = tagOf(hh, x)
  return `<tr><th scope="row">${x ? manT(x) : '0円'}${tag ? `<br><small>${tag}</small>` : ''}</th><td>${lvTxt(a.lv)}</td><td class="num">${yen(a.total)}</td></tr>`
}).join('\n')
const rateList = (rs) => rs.parts.map((p) => `<li>${esc(p.label)}：所得割 ${rateTxt(p.rate)}・均等割 ${yen(p.kintou)}${p.kintou18 ? `＋18歳以上均等割 ${yen(p.kintou18)}（18歳以上1人あたり${yen(p.kintou + p.kintou18)}・18歳未満は全額軽減）` : p.adultsOnly ? '（18歳以上1人あたり）' : ''}${p.byodo ? `・平等割 ${yen(p.byodo)}` : '・平等割なし'}・年の上限 ${man(p.cap)}${p.ages ? `（${p.ages[0]}〜${p.ages[1]}歳の人だけ）` : ''}</li>`).join('\n  ')
const COVERED = Object.values(KK.rateSets).map((x) => x.short).join('・')
const kokuhoSourceLi = (r) => {
  const rs = r ? kSetOf(r.code) : null
  if (!rs) return ''
  return `<li>国保の料率＝${rs.sources.map((x) => `${esc(x.name)} <a href="${esc(x.url)}" rel="nofollow">${esc(x.url)}</a>`).join('／')}（${esc(rs.checkedAt)}に確認）。年額の計算は${rs.checks.map((c) => esc(c.src)).join('・')}と1円単位で一致を確かめています</li>`
}
const kokuhoPrefNote = (p2, pref) => {
  const rs = kSetOf(`${p2}000`)
  if (!rs) return ''
  const z = kAnnual(rs, [{ age: 45 }])
  return `<p class="mini-note">国保：${esc(pref)}は国保の保険料を${esc(rs.short)}で統一しています（${esc(rs.nendo)}）。単身・40〜64歳の年額の目安は収入0円で${yen(z.total)}（7割軽減）。市町村名を押すと、国保が7割・5割・2割軽くなる年収と、年収ごとの年額の目安が出ます。</p>`
}
const kokuhoSection = (r, Ls) => {
  const rs = kSetOf(r.code), s = Ls[0].sal8, pn = Ls[0].p65
  const vs = (s > K7SAL
    ? `${esc(r.city)}で住民税が非課税になる給与だけの単身は${man(s)}以下ですが、国保の7割軽減は<strong>${man(K7SAL)}以下</strong>です。給与が${man(K7SAL + 1)}〜${man(s)}の人は、住民税はかからなくても国保は5割軽減です。`
    : `${esc(r.city)}で住民税が非課税になる給与だけの単身（${man(s)}以下）は、全員が国保の7割軽減（給与${man(K7SAL)}以下）に入ります。`)
    + (pn < K7PEN
      ? `年金だけの65歳以上の単身は、住民税が非課税になる線（${man(pn)}以下）より上の<strong>${man(K7PEN)}まで7割軽減</strong>です（国保の判定では、65歳以上の年金の所得から15万円を引くため）。`
      : '')
  const head = `<h2 id="kokuho">⑤ 国民健康保険（国保）が7割・5割・2割軽くなる年収</h2>
  <p>国保に入っている世帯は、前の年の所得が少ないと、保険料のうち人数と世帯にかかる部分（<strong>均等割・平等割</strong>）が7割・5割・2割軽くなります。線は国の政令で決まっていて<strong>全国共通</strong>、申請はいりません。${esc(KG.nendo)}（${esc(KG.years)}の保険料）は${esc(KG.incomeYear)}で決まります。</p>
  <p>${vs}</p>
  ${kokuhoLines()}`
  if (!rs) return `${head}
  <p class="mini-note">${esc(r.city)}の国保料の年額（料率を使った計算）は、まだ載せていません。料率を公式ページで確かめた市区町村から順に足しています（いまは${esc(COVERED)}）。</p>`
  const zero = kAnnual(rs, [{ age: 45 }]), zeroFull = kAnnual(rs, [{ age: 45 }], { lv: 0 })
  const kaigo0 = zero.parts.find((p) => p.id === 'kaigo').yen
  const cliff = (x) => kAnnual(rs, [{ age: 45, sal: x + 1 }]).total - kAnnual(rs, [{ age: 45, sal: x }]).total
  const L1 = KL.sal[0]
  return `${head}
  <h3>${esc(r.city)}の国保料の年額の目安（${esc(rs.nendo)}）</h3>
  <p>${esc(rs.scope)}の料率で計算した、<strong>大人だけの世帯</strong>の年額です。<strong>収入が0円でも、国保は0円になりません</strong>（7割軽減でも${rs.parts.some((p) => p.byodo) ? '均等割・平等割' : '均等割'}の3割はかかります）。単身・40〜64歳なら、収入0円で年${yen(zero.total)}です。</p>
  ${HH.map((hh) => `<p><strong>${esc(hh.title)}</strong></p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>年収</th><th>軽減</th><th class="num">年額</th></tr></thead>
  <tbody>
${annualRows(rs, hh)}
  </tbody></table></div>`).join('\n  ')}
  <p>線を1円でも超えると軽減が1段下がり、保険料が段差で上がります。給与だけの単身（40〜64歳）なら、${man(L1[7])}を超えると年${yen(cliff(L1[7]))}、${man(L1[5])}を超えると年${yen(cliff(L1[5]))}、${man(L1[2])}を超えると年${yen(cliff(L1[2]))}上がります。</p>
  <p class="mini-note">39歳以下の人は介護分がかかりません（収入0円の単身で年${yen(kaigo0)}安い）。65〜74歳の人も国保の介護分はかからず、そのかわり介護保険料を別に納めます（この表に入っていません）。<strong>所得を申告していないと軽減されず、収入0円の単身（40〜64歳）でも年${yen(zeroFull.total)}</strong>になります。表は${esc(KG.incomeYear)}がこの収入だけで、ほかの世帯の人は収入なし（夫婦のもう1人は年金110万円以下）、後期高齢者医療に移った人はいない、減免なしとして計算した目安です。端数は${esc(rs.rounding)}。実際の額は${esc(r.city)}から届く決定通知書で確かめてください。</p>
  <p class="mini-note">使った料率（${esc(rs.nendo)}・${esc(rs.name)}）：</p>
  <ul class="mini-note">
  ${rateList(rs)}
  </ul>`
}

// ── 7. 市区町村のページ ─────────────────────────────────────────────────────────
const muniPage = (r) => {
  const k = r.zeiKyuchi, c = ckOf(r), st = statusOf(r), Ls = lines(r), name = `${r.pref}${r.city}`
  const up = '../../'
  const std0 = kintouLim(k, 0), own0 = Ls[0].lim
  let why
  if (k === '1') why = `1級地の線は政令で額が決まっていて、市区町村による違いはありません。`
  else if (st === 'standard') why = `${kyuchiName(k)}の線は、1級地の額に${k === '2' ? '0.9' : '0.8'}をかけた額を参考に市町村が条例で決めます。下の表はその<strong>国の標準の値</strong>で、${esc(r.city)}が条例で定めた額はまだ確かめていません。${surveyTxt(k)}`
  else if (st === 'match') why = `${kyuchiName(k)}の線は市町村が条例で決めます。${esc(r.city)}が公表している額（単身の所得${man(own0)}以下）は国の標準どおりで、下の表はその額で計算しています。`
  else {
    // 違うのが「1人あたりの額」か「扶養がいるときの加算」かで言い方を変える（真岡市は加算だけ違い、単身の線は標準と同じ）
    const s = STD(k), diffs = []
    if (c.base !== s.base) diffs.push(`1人あたりの額を<strong>${man(c.base)}</strong>（国の標準は${man(s.base)}）`)
    if (c.add !== s.add) diffs.push(`扶養がいる世帯の加算を<strong>${man(c.add)}</strong>（国の標準は${man(s.add)}）`)
    why = `${kyuchiName(k)}の線は市町村が条例で決めます。${esc(r.city)}は${diffs.join('、')}と定めていて、下の表は${esc(r.city)}の額で計算しています（単身の所得の線は${man(own0)}${own0 === std0 ? 'で国の標準と同じ' : `・国の標準は${man(std0)}`}）。`
    // 森林環境税（国の税・年1,000円）の線は国の標準のまま＝線の間の人は住民税はかからず森林環境税だけかかる（その市町村のページに書かれているときだけ言う）
    if (c.shinrin && own0 > std0) why += `ただし森林環境税（国の税・年1,000円）の非課税の線は国の標準のまま（単身${man(std0)}）なので、単身で所得が${man(std0)}を超えて${man(own0)}以下の人は、住民税はかからなくても森林環境税がかかります（${esc(r.city)}のページに書かれています）。`
  }

  const title = `${name}の住民税非課税の年収｜単身${man(Ls[0].sal8)}以下・年金の夫婦${man(Ls[1].p65)}以下（令和8年度）｜フクシル`
  const desc = `${name}（${kyuchiName(k)}）で住民税が非課税になる年収の目安。給与収入だけの単身は${man(Ls[0].sal8)}以下、65歳以上で年金だけの単身は${man(Ls[0].p65)}以下、配偶者を扶養する65歳以上の年金の夫婦は${man(Ls[1].p65)}以下（令和8年度）。令和9年度は給与だけの単身が${man(Ls[0].sal9)}以下に上がります。世帯人数別の表と、障害者・ひとり親の特例、国保が7割軽減になる年収（給与だけの単身${man(K7SAL)}以下）も${kSetOf(r.code) ? `。${r.city}の国保料の年額の目安つき` : ''}。`

  // 表は3列まで（320px幅で4列にすると数字が「148 / 万円」のように割れて読めない＝2026-09-23 撮影で確認）
  const t1 = Ls.map((x) => `<tr>${whoTh(x.n, x.lim)}<td class="num">${manT(x.sal8)}</td><td class="num">${manT(x.p65)}</td></tr>`).join('\n')
  const t1b = Ls.map((x) => `<tr>${whoTh(x.n)}<td class="num">${manT(x.p64)}</td></tr>`).join('\n')
  const t2 = Ls.map((x) => `<tr>${whoTh(x.n)}<td class="num">${manT(x.sal8)}</td><td class="num">${manT(x.sal9)}</td><td class="num">${moveTxt(x.sal8, x.sal9)}</td></tr>`).join('\n')
  const t3 = SHOTOKU.map((x) => `<tr>${whoTh(x.n, x.lim)}<td class="num">${manT(x.sal8)}</td><td class="num">${manT(x.p65)}</td></tr>`).join('\n')
  const t3move = SHOTOKU.filter((x) => x.sal8 !== x.sal9).map((x) => `${WHO[x.n]}は${man(x.sal9)}`)
  const moved = Ls.filter((x) => x.sal8 !== x.sal9).map((x) => WHO[x.n]), still = Ls.filter((x) => x.sal8 === x.sal9).map((x) => WHO[x.n])

  // 暮らしの線
  const life = []
  life.push(`<li><strong>生活保護の級地</strong>：${esc(r.kyuchi)}。生活保護の基準額（生活扶助・住宅扶助）もこの級地で決まります（<a href="${up}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>）。</li>`)
  const sr = seihoOf(r)
  if (sr) life.push(`<li><strong>生活扶助（単身・30歳）</strong>：月${sr.seikatsu.toLocaleString('ja-JP')}円（令和8年4月の基準）。電気代や物価と並べた比較は<a href="${up}articles/seikatsuhogo-jisshitsu.html">生活保護費の「実質」比較</a>。</li>`)
  const jf = jutakuOf(r)
  if (jf) {
    const y = jf.row.yen
    life.push(`<li><strong>住宅扶助（家賃）の上限</strong>：1人 月${y[0].toLocaleString('ja-JP')}円・2人 月${y[1].toLocaleString('ja-JP')}円・3〜5人 月${y[2].toLocaleString('ja-JP')}円（${esc(jf.how)}。<a href="${esc(jf.source)}" rel="nofollow">${esc(jf.org)}の公表</a>）。</li>`)
  }
  const kh = koeiOf(r)
  if (kh && exists(`${kh[0]}index.html`)) life.push(`<li><strong>公営住宅</strong>：<a href="${up}${kh[0]}">${esc(kh[1])}</a>。収入の基準は住民税とは別の物差し（政令月収）です（<a href="${up}articles/koei-jutaku-bairitsu.html">公営住宅の倍率と収入基準</a>）。</li>`)
  if (exists(`shogai-kojo/${r.code6}.html`)) life.push(`<li><strong>障害者控除の認定</strong>：<a href="${up}shogai-kojo/${r.code6}.html">${esc(r.city)}の障害者控除対象者認定</a>（要介護の人が障害者控除を受けると、非課税の線の内側に入ることがあります）。</li>`)
  if (exists(`houkatsu/${r.code6}.html`)) life.push(`<li><strong>地域包括支援センター</strong>：<a href="${up}houkatsu/${r.code6}.html">${esc(r.city)}の担当センターを住所から引く</a>。</li>`)
  life.push(`<li><strong>非課税世帯になると変わること</strong>：医療費の月の上限が「住民税非課税」の区分になります（<a href="${up}mitoshi/kogaku/">高額療養費の上限額の記録</a>）。給付金の対象になることもあります（<a href="${up}articles/juminzei-hikazei-check.html#merit">非課税世帯のおもな得</a>）。</li>`)

  // 同じ県で線が違う市町村
  const same = muniOfPref(pref2(r))
  const groups = ['1', '2', '3'].filter((g) => g !== k).map((g) => [g, same.filter((x) => x.zeiKyuchi === g)]).filter(([, a]) => a.length)
  const idx = same.findIndex((x) => x.code === r.code)
  const prev = same[idx - 1], next = same[idx + 1]
  const groupHtml = groups.map(([g, a]) => {
    const show = a.slice(0, 10)
    return `<p><strong>${kyuchiName(g)}</strong>（給与だけの単身の標準 ${man(STDLINES[g][0].sal8)}以下）：${show.map((x) => `<a href="${up}hikazei/${x.code}/">${esc(x.city)}</a>`).join('、')}${a.length > show.length ? ` ほか${a.length - show.length}` : ''}</p>`
  }).join('\n')

  const items = [['ホーム', 'index.html'], ['住民税非課税の年収（市区町村別）', 'hikazei/'], [r.pref, `hikazei/ken/${pref2(r)}/`], [r.city, null]]
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)} ／ 給与だけ・年金だけの人の目安。式は法令と国税庁の控除の表から計算し、大阪市・名古屋市の公表値と1円単位で一致を確かめています</p>
  <h1>${esc(name)}の住民税非課税の年収の目安<br><small>世帯人数別・給与と年金（令和8年度・令和9年度）と国保の軽減</small></h1>

  <p class="lead">${esc(r.city)}は、住民税の非課税の線を決める地域の区分で<strong>${kyuchiName(k)}</strong>です（生活保護の級地は${esc(r.kyuchi)}）。${why}</p>

  <h2>① 令和8年度に住民税がかからない年収の目安</h2>
  <p>令和8年度（2026年6月から納める分）の住民税は、<strong>2025年1〜12月の収入</strong>で決まります。均等割も所得割もかからない、いちばん下の線です。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>世帯</th><th class="num">給与だけ</th><th class="num">年金だけ<br><small>65歳以上</small></th></tr></thead>
  <tbody>
${t1}
  </tbody></table></div>
  <p>65歳より前から年金を受けている人（繰上げ受給・企業年金など）は、年金から差し引かれる額が小さいので線が下がります。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>世帯</th><th class="num">年金だけ<br><small>65歳未満</small></th></tr></thead>
  <tbody>
${t1b}
  </tbody></table></div>
  <p class="mini-note">収入が上の額<strong>以下</strong>なら非課税の目安です。「扶養」は、生計を一にする配偶者（同一生計配偶者）と扶養親族の合計の人数で、<strong>16歳未満の子も数えます</strong>。年金は老齢年金など税のかかる年金で、<strong>障害年金・遺族年金は収入に数えません</strong>（非課税の収入です）。65歳以上かどうかは、その年の12月31日の年齢で決まります。<strong>世帯の全員</strong>が非課税なら「住民税非課税世帯」です。</p>

  <h2>② 令和9年度は、給与の人の線だけ上がる</h2>
  <p>2026年の給与から、給与から差し引かれる<strong>給与所得控除の最低額が65万円→74万円</strong>に上がります。非課税の所得の線は変わらないので、給与だけの人の年収の目安が上がります。年金の人の目安は変わりません。令和9年度（2027年6月から納める分）は、<strong>2026年1〜12月の収入</strong>で決まります。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>世帯</th><th class="num">令和8年度<br><small>2025年の給与</small></th><th class="num">令和9年度<br><small>2026年の給与</small></th><th class="num">動き</th></tr></thead>
  <tbody>
${t2}
  </tbody></table></div>
  <p>${moved.length ? `動くのは${moved.join('・')}の世帯で、` : ''}${still.length ? `${still.join('・')}の世帯は動きません（年収が控除の最低額の効く範囲を超えるため）。` : ''}年度ごとの動きの記録は<a href="${up}mitoshi/hikazei/">住民税非課税の年収の線は、いつ・いくら動いたか</a>にまとめています。</p>

  <h2>③ 所得割だけかからない線（全国共通）</h2>
  <p>均等割（年に数千円の定額の部分）はかかっても、所得に応じた部分（所得割）はかからない線です。級地によらず全国で同じです。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>世帯</th><th class="num">給与だけ<br><small>令和8年度</small></th><th class="num">年金だけ<br><small>65歳以上</small></th></tr></thead>
  <tbody>
${t3}
  </tbody></table></div>
  ${t3move.length ? `<p class="mini-note">令和9年度は、給与だけの${t3move.join('、')}に上がります（ほかの世帯は同じ）。</p>` : ''}

  <h2>④ 本人が障害者・ひとり親・寡婦・未成年のとき</h2>
  <p>本人がこのどれかに当たる人は、上の線とは別に、<strong>前年の合計所得が135万円以下なら住民税がかかりません</strong>（扶養の人数・級地によらず全国共通）。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>収入の種類</th><th class="num">令和8年度</th><th class="num">令和9年度</th></tr></thead>
  <tbody>
  <tr><th scope="row">給与だけ</th><td class="num">${manT(SPECIAL.sal8)}</td><td class="num">${manT(SPECIAL.sal9)}</td></tr>
  <tr><th scope="row">年金だけ<br><small>65歳以上</small></th><td class="num">${manT(SPECIAL.p65)}</td><td class="num">${manT(SPECIAL.p65)}</td></tr>
  <tr><th scope="row">年金だけ<br><small>65歳未満</small></th><td class="num">${manT(SPECIAL.p64)}</td><td class="num">${manT(SPECIAL.p64)}</td></tr>
  </tbody></table></div>
  <p class="mini-note">障害年金は収入に数えないので、障害年金だけで暮らしている人は所得0円＝非課税です。</p>

  <div class="callout note"><p><span class="tag">自分の収入で確かめる</span>
  年収・扶養の人数・級地を入れて判定できる<a href="${up}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>があります（${esc(r.city)}は「${kyuchiName(k)}」を選んでください${st === 'rounded' ? `。ただし${esc(r.city)}は条例で標準と違う額にしているので、判定の境目がこの表と少しずれます` : ''}）。</p></div>

  ${kokuhoSection(r, Ls)}

  <h2>⑥ ${esc(r.city)}の暮らしの線</h2>
  <ul>
  ${life.join('\n  ')}
  </ul>

  <h2>⑦ ${esc(r.pref)}の中で線が違う市町村</h2>
  ${groups.length ? `<p>同じ${esc(r.pref)}でも、級地が違うと線が変わります。</p>\n  ${groupHtml}` : `<p>${esc(r.pref)}の市町村はすべて${kyuchiName(k)}です。</p>`}
  <p><a href="${up}hikazei/ken/${pref2(r)}/">${esc(r.pref)}の全${same.length}市町村の表</a>${prev ? ` ／ ← <a href="${up}hikazei/${prev.code}/">${esc(prev.city)}</a>` : ''}${next ? ` ／ <a href="${up}hikazei/${next.code}/">${esc(next.city)}</a> →` : ''}</p>

  <p class="mini-note">${esc(r.city)}で実際に課税・非課税を決めるのは、${esc(r.city)}の住民税（市民税・町民税・村民税・特別区民税）の担当課です。条例の額や、給与と年金の両方がある場合の判定は、そちらで確かめてください。</p>

  ${sourcesList(r, c)}
`
  return page({ title, desc, canonical: `/hikazei/${r.code}/`, depth: 2, body, jsonld: [articleLd(title, desc, `/hikazei/${r.code}/`), bcLd(items)] })
}

// ── 8. 都道府県のページ ─────────────────────────────────────────────────────────
const prefPage = (p2, pref) => {
  const a = muniOfPref(p2), up = '../../../'
  const cnt = ['1', '2', '3'].map((k) => [k, a.filter((x) => x.zeiKyuchi === k).length]).filter(([, n]) => n)
  const rows = a.map((r) => {
    const Ls = lines(r), st = statusOf(r)
    const mark = st === 'rounded' ? '<br><small>条例で丸め</small>' : st === 'match' ? '<br><small>公表と一致</small>' : ''
    return `<tr><td class="nm"><a href="${up}hikazei/${r.code}/">${esc(r.city)}</a><br><small>${kyuchiName(r.zeiKyuchi)}</small>${mark}</td><td class="num">${manT(Ls[0].sal8)}</td><td class="num">${manT(Ls[0].p65)}</td><td class="num">${manT(Ls[1].p65)}</td></tr>`
  }).join('\n')
  const title = `${pref}の住民税非課税の年収の目安｜全${a.length}市町村の早見表（令和8年度）｜フクシル`
  const desc = `${pref}の${a.length}市町村それぞれで住民税が非課税になる年収の目安（令和8年度）。${cnt.map(([k, n]) => `${kyuchiName(k)}${n}`).join('・')}。給与だけの単身、65歳以上で年金だけの単身と夫婦の線を市町村ごとに並べました。`
  const items = [['ホーム', 'index.html'], ['住民税非課税の年収（市区町村別）', 'hikazei/'], [pref, null]]
  const has23 = a.some((r) => r.zeiKyuchi !== '1')
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)} ／ 給与だけ・年金だけの人の目安</p>
  <h1>${esc(pref)}の住民税非課税の年収の目安<br><small>全${a.length}市町村の早見表（令和8年度）</small></h1>
  <p class="lead">住民税が非課税になる線は、市町村の「級地」で変わります。${esc(pref)}は${cnt.map(([k, n]) => `<strong>${kyuchiName(k)}が${n}</strong>`).join('・')}です。市町村名を押すと、世帯人数別（扶養4人まで）・令和9年度の見通し・障害者やひとり親の特例まで出ます。</p>
  ${kokuhoPrefNote(p2, pref)}
  ${has23 ? `<p class="mini-note">2級地・3級地の額は、国の標準（1級地の0.9倍・0.8倍）を参考に市町村が条例で決めます。「条例で丸め」「公表と一致」の印が無い市町村は国の標準の値です。${surveyTxt()}</p>` : ''}
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>市町村</th><th class="num">給与だけ<br><small>単身</small></th><th class="num">年金だけ<br><small>65歳以上・単身</small></th><th class="num">年金だけ<br><small>65歳以上・夫婦</small></th></tr></thead>
  <tbody>
${rows}
  </tbody></table></div>
  <p class="mini-note">「夫婦」は配偶者を扶養している世帯（扶養1人）。収入が表の額以下なら非課税の目安です。障害年金・遺族年金は収入に数えません。</p>
  <p><a href="${up}hikazei/">ほかの都道府県から探す</a> ／ <a href="${up}mitoshi/hikazei/">線が年度ごとにどう動いたか</a> ／ <a href="${up}articles/juminzei-hikazei-check.html">自分の収入で判定する</a></p>
  ${sourcesList(null, null)}
`
  return page({ title, desc, canonical: `/hikazei/ken/${p2}/`, depth: 3, body, jsonld: [articleLd(title, desc, `/hikazei/ken/${p2}/`), bcLd(items)] })
}

// ── 9. 入口のページ ─────────────────────────────────────────────────────────────
const hubPage = () => {
  const up = '../'
  const cnt = ['1', '2', '3'].map((k) => [k, M.filter((x) => x.zeiKyuchi === k).length])
  const grid = ['1', '2', '3'].map((k) => {
    const S = STDLINES[k]
    return `<tr><th scope="row">${kyuchiName(k)}<br><small>${cnt.find(([x]) => x === k)[1]}市区町村</small></th><td class="num">${manT(S[0].sal8)}</td><td class="num">${manT(S[0].p65)}</td><td class="num">${manT(S[1].p65)}</td><td class="num">${manT(S[2].sal8)}</td></tr>`
  }).join('\n')
  const prefLinks = PREFS.map(([p2, pref]) => `<li><a href="${up}hikazei/ken/${p2}/">${esc(pref)}</a>（${muniOfPref(p2).length}）</li>`).join('\n')
  const title = '住民税非課税の年収の目安｜全国1,741市区町村の早見表（令和8年度・9年度）｜フクシル'
  const desc = `住民税が非課税になる年収の目安を、全国1,741市区町村ごとに世帯人数別・給与と年金で出しました。線は級地で3段に分かれ、給与だけの単身は1級地${man(STDLINES['1'][0].sal8)}・2級地${man(STDLINES['2'][0].sal8)}・3級地${man(STDLINES['3'][0].sal8)}以下が目安（令和8年度・標準の値）。`
  const items = [['ホーム', 'index.html'], ['住民税非課税の年収（市区町村別）', null]]
  const body = `${CSS}
  ${crumbs(items, up)}
  <p class="updated">最終確認：${esc(CHECKED)}</p>
  <h1>住民税非課税の年収の目安を、住んでいる市区町村から<br><small>全国1,741市区町村・世帯人数別・給与と年金</small></h1>
  <p class="lead">住民税が非課税になる線は全国一律ではありません。住んでいる市区町村の<strong>級地</strong>（生活保護と同じ地域の区分）で3段に分かれ、2級地・3級地では市町村が条例で額を決めます。都道府県を選ぶと、市区町村ごとの表が出ます。</p>
  <h2>級地ごとの線（令和8年度・国の標準の値）</h2>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>級地</th><th class="num">給与だけ<br><small>単身</small></th><th class="num">年金だけ<br><small>65歳以上・単身</small></th><th class="num">年金だけ<br><small>65歳以上・夫婦</small></th><th class="num">給与だけ<br><small>扶養2人</small></th></tr></thead>
  <tbody>
${grid}
  </tbody></table></div>
  <p class="mini-note">収入が表の額以下なら非課税の目安です。「夫婦」は配偶者を扶養している世帯。2級地・3級地は、市町村が条例で丸めていると少し違います。${surveyTxt()}</p>
  <h2 id="kokuho">国民健康保険（国保）が7割・5割・2割軽くなる年収（全国共通・${esc(KG.nendo)}）</h2>
  <p>国保の保険料のうち人数と世帯にかかる部分（均等割・平等割）は、前の年の所得が少ないと7割・5割・2割軽くなります。この線は国の政令で決まっていて全国共通です。住民税の非課税の線とは別の物差しで、たとえば給与だけの単身は、1級地で住民税が非課税になるのは${man(STDLINES['1'][0].sal8)}以下ですが、国保の7割軽減は${man(K7SAL)}以下です。</p>
  ${kokuhoLines()}
  <p>国保料の年額の目安は、料率を公式ページで確かめた市区町村のページに載せています（いまは${esc(COVERED)}）。</p>
  <h2>都道府県から探す</h2>
  <ul class="links">
${prefLinks}
  </ul>
  <h2>あわせて読む</h2>
  <ul>
  <li><a href="${up}mitoshi/hikazei/">住民税非課税の年収の線は、いつ・いくら動いたか</a>（令和3年度〜令和10年度の記録）</li>
  <li><a href="${up}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>（年収・扶養・級地を入れて判定）</li>
  <li><a href="${up}mitoshi/kogaku/">高額療養費の上限額の記録</a>（非課税世帯の区分の額）</li>
  </ul>
  ${sourcesList(null, null)}
`
  return page({ title, desc, canonical: '/hikazei/', depth: 1, body, jsonld: [articleLd(title, desc, '/hikazei/'), bcLd(items)] })
}

// ── 10. 書き出し ──────────────────────────────────────────────────────────────
const out = [['hikazei/index.html', '/hikazei/', hubPage(), '0.8']]
for (const [p2, pref] of PREFS) out.push([`hikazei/ken/${p2}/index.html`, `/hikazei/ken/${p2}/`, prefPage(p2, pref), '0.7'])
for (const r of M) out.push([`hikazei/${r.code}/index.html`, `/hikazei/${r.code}/`, muniPage(r), '0.6'])

const st = M.reduce((m, r) => (m[statusOf(r)] = (m[statusOf(r)] || 0) + 1, m), {})
console.log(`ページ ${out.length}枚（入口1・都道府県${PREFS.length}・市区町村${M.length}）／ 状態 ${JSON.stringify(st)}`)
console.log(`確かめた2級地・3級地 ${checked23.length}（丸め ${rounded23.length}・標準より低い ${lower23.length}）`)
if (DRY) {
  const nag = M.find((r) => r.city === '名古屋市')
  console.log('例: 名古屋市', lines(nag).map((x) => `${WHO[x.n]} 給与${man(x.sal8)}→${man(x.sal9)} 年金65+${man(x.p65)} 年金65-${man(x.p64)}`).join(' / '))
  console.log('特例', JSON.stringify(SPECIAL))
  process.exit(0)
}

let changedN = 0
const changedLocs = new Set()
for (const [rel, loc, html] of out) {
  const p = path.join(ROOT, rel)
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === html) continue
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
  changedN++; changedLocs.add(loc)
}
// 一覧から外れた市区町村のページが残っていないか（消さずに知らせる）
const known = new Set(M.map((r) => r.code))
const strays = fs.readdirSync(path.join(ROOT, 'hikazei')).filter((d) => /^\d{5}$/.test(d) && !known.has(d))
if (strays.length) console.warn(`一覧に無い市区町村のページが残っています（手で確かめて消す）: ${strays.join(', ')}`)

// sitemap.xml：lastmod は中身が変わった日だけ進める（ビルドした日にしない）。[[bing-index-coverage-gap]]
const smPath = path.join(ROOT, 'sitemap.xml')
const sm = fs.readFileSync(smPath, 'utf8')
const prevMod = new Map([...sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]))
const entry = (loc, pri) => {
  const full = `${SITE}${loc}`
  const lm = changedLocs.has(loc) || !prevMod.has(full) ? TODAY : prevMod.get(full)
  return `<url><loc>${full}</loc><lastmod>${lm}</lastmod><changefreq>monthly</changefreq><priority>${pri}</priority></url>`
}
const ours = new Map(out.map(([, loc, , pri]) => [`${SITE}${loc}`, entry(loc, pri)]))
let smNext = sm.replace(/[ \t]*<url><loc>([^<]+)<\/loc>[\s\S]*?<\/url>\n?/g, (whole, loc) => {
  if (!ours.has(loc)) return whole
  const e = ours.get(loc); ours.delete(loc)
  return `  ${e}\n`
})
if (ours.size) smNext = smNext.replace('</urlset>', `${[...ours.values()].map((e) => `  ${e}`).join('\n')}\n</urlset>`)
if (smNext !== sm) fs.writeFileSync(smPath, smNext)
console.log(`書き出し ${changedN}枚 ／ sitemap ${smNext !== sm ? '更新' : '変更なし'}（${[...smNext.matchAll(/<loc>/g)].length}URL）`)
