// ─────────────────────────────────────────────────────────────────────────────
// mitoshi-hikazei.mjs — 住民税非課税の年収の線の「年度ごとの記録」 /mitoshi/hikazei/ を作る。
//   node scripts/mitoshi-hikazei.mjs        → mitoshi/hikazei/index.html と sitemap.xml の1行
//   node scripts/mitoshi-hikazei.mjs --dry  → 書かずに表だけ出す
//
// ★この面で言っていること（2026-09-22 着工・ユーザー承認）
//   非課税の「所得の線」（45万円／35万円×人数＋31万円 など）は令和3年度から動いていない。
//   動くのは給与の「年収の目安」だけで、動くのは給与所得控除の最低額が上がった年だけ。
//   しかも動くのは**単身と扶養の少ない世帯だけ**で、扶養が多い世帯はほとんど動かない。
//   ∴主役は「推移」ではなく「**自分の世帯の線は動くのか・動かないのか**」。
//
// ★計算機は作らない（判定は既存記事 articles/juminzei-hikazei-check.html と競合が持っている）。
//
// ★数字はすべて式から出す。本文に年収を直書きしない。
//   ただし式が正しいかは、大阪市が公表している令和8年度の目安（10個）と名古屋市の令和9年度の単身の目安で
//   1円単位まで突き合わせる。1つでも違えば止める。
//
// ★2級地・3級地は「率を参酌して条例で定める」。率どおりの標準の値を出し、市によって丸め方が違う実例を並べる。
//   ★年金の人・事業所得の人の線はこの面では扱わない（給与収入だけの人の目安）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mitoshi-hikazei.json'), 'utf8'))
const OUT_REL = 'mitoshi/hikazei/index.html'
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }

// ── 給与所得（給与収入 → 所得）。所得税法別表第五と同じ4,000円刻みの丸めを入れる ─────────
//   国税庁 No.1410 の表と注。660万円未満は別表第五で求める（下の式はその表を再現したもの）。
const floor4k = (x) => Math.floor(x / 4000) * 4000
const upper = (x, A) => (x < 3600000 ? A * 0.7 - 80000 : x < 6600000 ? A * 0.8 - 440000 : x <= 8500000 ? x * 0.9 - 1100000 : x - 1950000)
const kyuyo = {
  // 令和2〜6年分：最低55万円（162.5万円まで）
  r3: (x) => {
    if (x < 1619000) return Math.max(0, x - 550000)
    if (x < 1620000) return 1069000
    if (x < 1622000) return 1070000
    if (x < 1624000) return 1072000
    if (x < 1628000) return 1074000
    const A = floor4k(x)
    if (x < 1800000) return A * 0.6 + 100000
    return upper(x, A)
  },
  // 令和7年分：最低65万円（190万円まで）
  r8: (x) => (x < 1900000 ? Math.max(0, x - 650000) : upper(x, floor4k(x))),
  // 令和8・9年分：最低74万円（220万円まで）。219.1万〜220万円未満は注2の表。
  r9: (x) => {
    if (x < 2191000) return Math.max(0, x - 740000)
    if (x < 2193000) return 1451000
    if (x < 2196000) return 1453000
    if (x < 2200000) return 1456000
    return upper(x, floor4k(x))
  },
}
// 所得が lim 以下になる、いちばん高い給与収入（1円単位）
const maxIncome = (pid, lim) => {
  let lo = 0, hi = 20000000
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (kyuyo[pid](mid) <= lim) lo = mid; else hi = mid - 1 }
  return lo
}
// 非課税の所得の線。n＝扶養している人の数（同一生計配偶者を含む）
const L = D.limits
const kintouLim = (k, n, base = L.kintou.base[k], add = L.kintou.add[k]) => (n === 0 ? base + L.kintou.plus : base * (1 + n) + L.kintou.plus + add)
const shotokuLim = (n) => (n === 0 ? L.shotoku.base + L.shotoku.plus : L.shotoku.base * (1 + n) + L.shotoku.plus + L.shotoku.add)
const NS = [0, 1, 2, 3, 4]
const PER = D.periods

// ── 突き合わせ（大阪市・名古屋市の公表値）──────────────────────────────────
{
  const c = D.check
  const k = NS.map((n) => maxIncome(c.period, kintouLim('1', n)))
  const s = NS.map((n) => maxIncome(c.period, shotokuLim(n)))
  if (JSON.stringify(k) !== JSON.stringify(c.kintou)) die(`均等割の年収の目安が大阪市の公表値と違います。計算 ${k.join(',')} ／ 公表 ${c.kintou.join(',')}`)
  if (JSON.stringify(s) !== JSON.stringify(c.shotoku)) die(`所得割の年収の目安が大阪市の公表値と違います。計算 ${s.join(',')} ／ 公表 ${c.shotoku.join(',')}`)
  const c2 = D.check2
  const k0 = maxIncome(c2.period, kintouLim('1', 0))
  if (k0 !== c2.kintou0) die(`令和9年度の単身の目安が名古屋市の公表値と違います。計算 ${k0} ／ 公表 ${c2.kintou0}`)
}

const man = (y) => {   // 1,100,000 → 110万円 ／ 2,059,999 → 205万9,999円
  const m = Math.floor(y / 10000), r = y % 10000
  return r ? `${m.toLocaleString('ja-JP')}万${r.toLocaleString('ja-JP')}円` : `${m.toLocaleString('ja-JP')}万円`
}
// 表の中だけ「万」のあとで折り返せるようにする（360px幅で「205万9,999円」が1行に収まらない）
const manT = (y) => man(y).replace('万', '万<wbr>')
const WHO = ['単身（扶養なし）', '扶養1人（夫婦など）', '扶養2人（夫婦＋子1人など）', '扶養3人', '扶養4人']
const WHO_S = ['単身', '扶養1人', '扶養2人', '扶養3人', '扶養4人']   // 表の中は短く（4列を360px幅に収める）
const moveTxt = (a, b) => (a === b ? '<strong>動かない</strong>' : `＋${manT(b - a)}`)

// 世帯×年度の表（級地 k の均等割＝住民税が全部かからない線／所得割＝所得割だけかからない線）
const grid = (limFn) => NS.map((n) => PER.map((p) => maxIncome(p.id, limFn(n))))
const G1 = grid((n) => kintouLim('1', n))
const S1 = grid((n) => shotokuLim(n))
const G2 = grid((n) => kintouLim('2', n))
const G3 = grid((n) => kintouLim('3', n))

const tableOf = (G) => NS.map((n, i) => {
  const r = G[i]
  return `<tr><th scope="row">${esc(WHO_S[n])}</th>${r.map((y, j) => `<td class="num">${manT(y)}${j ? `<br><small>${moveTxt(r[j - 1], y)}</small>` : ''}</td>`).join('')}</tr>`
}).join('\n')
const HEAD = `<tr><th>世帯</th>${PER.map((p) => `<th class="num">${esc(p.label)}<br><small>${esc(p.incomeYears)}</small></th>`).join('')}</tr>`

// 動く・動かないの要約（1級地・均等割）
const moved = NS.filter((n, i) => G1[i][0] !== G1[i][PER.length - 1])
const still = NS.filter((n, i) => G1[i][0] === G1[i][PER.length - 1])
const firstStill8 = NS.find((n, i) => G1[i][0] === G1[i][1])   // 令和8年度で動かない最初の世帯

// 丸めの実例（単身の所得の線と、令和8年度の年収の目安）
const roundRows = D.rounding.rows.map((r) => {
  const lim0 = r.base + L.kintou.plus
  const std = kintouLim(String(r.kyuchi), 0)
  return `<tr><th scope="row"><a href="${esc(r.url)}" rel="nofollow">${esc(r.city)}</a><br><small>${r.kyuchi}級地</small></th><td class="num">${man(lim0)}${lim0 !== std ? `<br><small>標準の値は${man(std)}</small>` : '<br><small>標準の値どおり</small>'}</td><td class="num">${man(maxIncome('r8', lim0))}</td></tr>`
}).join('\n')

const title = '住民税非課税の年収の線は、いつ・いくら動いたか｜世帯ごとに「動く・動かない」を年度別に並べた記録｜フクシル'
const desc = `住民税が非課税になる年収の目安（給与収入のみ・1級地）は、単身で令和7年度まで${man(G1[0][0])}、令和8年度${man(G1[0][1])}、令和9・10年度${man(G1[0][2])}。所得の線そのものは令和3年度から変わらず、動くのは給与所得控除の最低額が上がった年の年収の目安だけで、扶養の多い世帯はほとんど動きません。世帯ごと・級地ごとに年度別に並べました。`

const FIT_CSS = `<style>table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit tbody th{white-space:nowrap}table.fit td.num,table.fit th.num{white-space:normal;word-break:keep-all}</style>`
const body = `${FIT_CSS}
  <p class="updated">最終確認：${D.checked} ／ 給与収入だけの人の目安。計算は法令の式と国税庁の給与所得控除の表から行い、大阪市・名古屋市の公表値と1円単位で一致を確かめています</p>
  <h1>住民税非課税の年収の線は、いつ・いくら動いたか<br><small>自分の世帯の線は動くのか、動かないのかを年度ごとに</small></h1>

  <p class="lead">住民税が非課税になるかどうかの<strong>線（所得の額）は、${esc(D.plusFrom)}から1円も変わっていません</strong>。
  それでも「非課税の年収が上がった」と言われるのは、給料から差し引かれる<strong>給与所得控除の最低額</strong>が上がり、同じ所得の線に届く<strong>年収</strong>が高くなったからです。
  そのため、動くのは<strong>${moved.map((n) => esc(WHO[n].replace(/（.*）/, ''))).join('・')}</strong>の世帯の年収の目安で、<strong>${still.map((n) => esc(WHO[n].replace(/（.*）/, ''))).join('・')}の世帯は動きません</strong>（1級地・住民税が全部かからない線）。</p>

  <h2>① 住民税が全部かからない年収の目安（1級地）</h2>
  <p>均等割も所得割もかからない線です。東京23区・大阪市・名古屋市などの大都市（1級地）。下の小さい字は、1つ前の年度からの動きです。</p>
  <div class="table-wrap"><table class="fit">
  <thead>${HEAD}</thead>
  <tbody>
${tableOf(G1)}
  </tbody></table></div>
  <p class="mini-note">「扶養1人」は夫婦（配偶者を扶養）など、「扶養2人」は夫婦＋子1人などです。「扶養」は、生計を一にする配偶者（同一生計配偶者）と扶養親族の合計の人数です。給与収入が上の額<strong>以下</strong>なら非課税の目安です。障害者・ひとり親・寡婦・未成年の本人は、これとは別に前年の合計所得135万円以下なら非課税になる特例があります。</p>

  <div class="callout note"><p><span class="tag">なぜ扶養が多い世帯は動かないのか</span>
  給与所得控除の最低額が上がって効くのは、年収が一定の額（令和7年分は190万円、令和8・9年分は220万円）までの人だけです。それより年収が高いと、控除は「年収×30%＋8万円」の段で決まり、この段の式は変わっていません。
  扶養が${firstStill8 != null ? `${firstStill8}人` : '多い'}以上の世帯は、所得の線に届く年収がその段に入るので、控除の最低額が上がっても年収の目安は動かない（または少ししか動かない）のです。</p></div>

  <h2>② 所得割だけかからない年収の目安（全国共通）</h2>
  <p>均等割（数千円の定額部分）はかかっても、所得に応じた部分（所得割）はかからない線です。こちらは級地によらず全国で同じです。</p>
  <div class="table-wrap"><table class="fit">
  <thead>${HEAD}</thead>
  <tbody>
${tableOf(S1)}
  </tbody></table></div>

  <h2>③ 2級地・3級地の場合（標準の値）</h2>
  <p>2級地・3級地では、均等割の線は1級地の額に0.9・0.8をかけた額を<strong>参考に市町村が条例で決めます</strong>。下は率どおりの標準の値です。</p>
  <h3>2級地（県庁所在地クラスの市など）</h3>
  <div class="table-wrap"><table class="fit">
  <thead>${HEAD}</thead>
  <tbody>
${tableOf(G2)}
  </tbody></table></div>
  <h3>3級地（その他の市町村）</h3>
  <div class="table-wrap"><table class="fit">
  <thead>${HEAD}</thead>
  <tbody>
${tableOf(G3)}
  </tbody></table></div>
  <p>実際には、率どおりにせず丸めている市があります。単身の線の実例です（各市の公式ページ）。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>市</th><th class="num">単身の所得の線</th><th class="num">令和8年度の年収の目安</th></tr></thead>
  <tbody>
${roundRows}
  </tbody></table></div>
  <p class="mini-note">自分の市区町村の線は、市区町村の税務課のページで確かめてください。級地は<a href="../../articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で選べます。</p>

  <h2>④ 線が動いた年の記録</h2>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>年度</th><th>何が変わったか</th></tr></thead>
  <tbody>
  <tr><th scope="row">${esc(D.plusFrom)}</th><td>非課税の所得の線に10万円が足された（単身は35万円→45万円）。給与所得控除の最低額は65万円→55万円に下がったので、単身の年収の目安は100万円のまま。</td></tr>
${PER.slice(1).map((p, i) => `  <tr><th scope="row">${esc(p.label)}</th><td>給与所得控除の最低額が${man(PER[i].minDed)}→${man(p.minDed)}（${esc(p.incomeYears)}）。所得の線は変わらず、単身の年収の目安が${man(G1[0][i])}→${man(G1[0][i + 1])}。<br><small><a href="${esc(p.srcUrl)}" rel="nofollow">${esc(p.src)}</a></small></td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="mini-note">令和11年度以降の給与所得控除の最低額は、国税庁のページにまだ載っていないため、この記録には入れていません。決まったら版を足します。</p>

  <div class="callout note"><p><span class="tag">自分が非課税になるか確かめる</span>
  年収・扶養の人数・地域を入れて判定できる<a href="../../articles/juminzei-hikazei-check.html">住民税非課税の判定</a>があります。非課税だと高額療養費の上限は「住民税非課税」の区分になります（<a href="../kogaku/">高額療養費の上限額の記録</a>）。</p></div>

  <div class="sources">
  <h2>出典と、この記録の決まりごと</h2>
  <ul>
  <li>非課税の線（均等割）＝${esc(L.kintou.src)} ${esc(L.kintou.srcUrl)}</li>
  <li>非課税の線（所得割）＝${esc(L.shotoku.src)}</li>
  <li>給与所得控除＝国税庁 タックスアンサーNo.1410 ${esc(PER[0].srcUrl)}（令和2〜6年分・令和7年分・令和8・9年分の表と注）</li>
  <li>計算の確かめ＝${esc(D.check.src)} ${esc(D.check.srcUrl)}（令和8年度・10個の目安が1円単位で一致）、${esc(D.check2.src)} ${esc(D.check2.srcUrl)}（令和9年度・単身）</li>
  <li>ここに出したのは<strong>給与収入だけの人の目安</strong>です。年金・事業などの収入がある人、各種の控除がある人は結果が変わります。実際の課税・非課税は市区町村が決めます。</li>
  <li>誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</li>
  </ul>
  </div>
`

if (DRY) {
  for (const [name, G] of [['1級地 均等割', G1], ['所得割', S1], ['2級地', G2], ['3級地', G3]]) {
    console.log(name); NS.forEach((n, i) => console.log(`  ${WHO[n]}: ${G[i].map(man).join(' → ')}`))
  }
  process.exit(0)
}

const html = page({
  title, desc, canonical: '/mitoshi/hikazei/', depth: 2, body,
  jsonld: [
    { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/mitoshi/hikazei/`, datePublished: '2026-09-22', dateModified: D.checked, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } },
  ],
})

const smPath = path.join(ROOT, 'sitemap.xml')
const sm = fs.readFileSync(smPath, 'utf8')
const loc = `<loc>${SITE}/mitoshi/hikazei/</loc>`
const outPath = path.join(ROOT, OUT_REL)
const changed = !fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== html
const prev = sm.includes(loc) ? ((/<lastmod>([^<]+)<\/lastmod>/.exec(sm.slice(sm.indexOf(loc))) || [])[1] || TODAY) : TODAY
const entry = `<url>${loc}<lastmod>${changed ? TODAY : prev}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
let smNext
if (sm.includes(loc)) {
  const at = sm.lastIndexOf('<url>', sm.indexOf(loc))
  smNext = sm.slice(0, at) + entry + sm.slice(sm.indexOf('</url>', at) + '</url>'.length)
} else smNext = sm.replace('</urlset>', `  ${entry}\n</urlset>`)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, html)
if (smNext !== sm) fs.writeFileSync(smPath, smNext)
console.log(`${OUT_REL}（${changed ? '更新' : '変更なし'}）／ 動く世帯 ${moved.map((n) => WHO[n]).join('・')}／動かない ${still.map((n) => WHO[n]).join('・')}`)
