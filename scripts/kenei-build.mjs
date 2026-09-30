// ─────────────────────────────────────────────────────────────────────────────
// kenei-build.mjs — 県営住宅（埼玉・愛知）の倍率の無料ページを作る。
//   node scripts/kenei-build.mjs      → saitama-ken/index.html ・ aichi-ken/index.html ・ sitemap.xml
//
// ★2026-09-29 ユーザー裁定 v280（第154回 #171「公営住宅の倍率を県営へ広げる」）。
// ★2026-09-30 ユーザー裁定「県営も売りに出そうか」で有料化した。売り場（/<key>/moushikomisaki/）・購入後画面・有料資料は
//   koei-nerai.mjs が koei-lib の CITIES（freePage: false）から作る。この面は無料のまま、置くのは案内とリンクだけ
//   （2026-09-19 ユーザー裁定「売り場は独自ページだけ」）。件数は koei-lib の load() から取り、売り場・有料資料とずらさない。
// ★倍率は「申込（応募）の合計 ÷ 募集戸数の合計」。公社が公表している倍率と同じ定義で、
//   埼玉は2026年4月の回に公社が載せた種別ごとの倍率と、ここで計算した倍率が一致する。
//   koei-lib の中央値（申込先ごとの倍率の真ん中）とは別の物差しなので混ぜない。
// ★数字は data/kenei-*.json からだけ作る。ビルドのたびに公表の合計と照合し、合わなければ止める。
//   公表の表は丸ごと写さない（両県とも無断転載を断っている）。住宅ごとに出すのは、当方が計算した指標
//   （混んでいる申込先の倍率の中央値・最高・観測件数）だけ。行データ（data/<key>-bairitsu.json）は公開しない。
// ★文の前提（「単身がいちばん高い」など）もビルドのたびに数字で確かめる。
//   データを入れ替えて前提が崩れたら、文を黙って残さずに止める。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { WA, load, MIN_N, SUKI, PRICE, num, r1 } from './koei-lib.mjs'
import { offerKoeiLeaf, jumpKoei } from './offer-block.mjs'
import { FREE, freePage } from './kenei-free.mjs'   // 三大都市圏の外の県＝申込先ごとの一覧まで無料（2026-10-01）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const die = (m) => { console.error(`停止：${m}`); process.exit(1) }
const SA = readJson('data/kenei-saitama.json')
const AI = readJson('data/kenei-aichi.json')
const n = (x) => Number(x).toLocaleString('ja-JP')
const bai = (m, k) => (k ? (m / k).toFixed(2) : '—')
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
const minmax = (xs) => [Math.min(...xs), Math.max(...xs)]
// ★範囲は表と同じ小数2桁で書く。1桁に丸めると端が実際より内側に入る（8.47倍の回があるのに「8.5倍から」と書く）
// 愛知の回キー 2025-3 → 令和7年度 第3回（抽選結果表の題がこう書いている）
const FY = (r) => { const y = Number(r.slice(0, 4)) - 2018; return `令和${y === 1 ? '元' : y}年度` }
const WAN = (r) => `${FY(r)} 第${r.slice(5)}回`

// ── 1. 照合（公表の合計と一の位まで）────────────────────────────────────────
for (const r of SA.rounds) {
  const t = Object.values(r.types)
  if (sum(t, (v) => v.koho) !== r.published.koho || sum(t, (v) => v.moushikomi) !== r.published.moushikomi) die(`埼玉 ${r.round}：住宅種別の和が公表の合計と合わない`)
  for (const [k, v] of Object.entries(r.publishedByType || {})) {
    if (k === '合計') { if (bai(r.published.moushikomi, r.published.koho) !== v.bairitsu) die(`埼玉 ${r.round}：全体の倍率が公社の ${v.bairitsu} と合わない`); continue }
    if (bai(r.types[k].moushikomi, r.types[k].koho) !== v.bairitsu) die(`埼玉 ${r.round} ${k}：計算した倍率が公社の ${v.bairitsu} と合わない`)
  }
}
for (const r of AI.rounds) {
  if (r.ippan.koho + r.fukushi.koho !== sum(r.sections, (s) => s.koho) || r.ippan.oubo + r.fukushi.oubo !== sum(r.sections, (s) => s.oubo)) die(`愛知 ${r.round}：一般＋福祉枠が合計行の和と合わない`)
}

const cell = (m, k, unit) => `<td class="num"><strong>${bai(m, k)}倍</strong><br><small>${n(k)}戸・${n(m)}${unit}</small></td>`
const jsonld = (title, desc, url, checked) => ({ '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}${url}`, datePublished: '2026-09-29', dateModified: checked, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } })
// 書き出し。戻り値＝中身（読み手に見える部分）が変わったか。計測の埋め込み（ev.js）と buy.js の版だけの違いは書き直すが、
// 変わったとは数えない（sitemap の lastmod を進めない）＝hikazei-city.mjs と同じ判定（2026-10-01）。
const readable = (h) => h.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/assets\/buy\.js\?v=\w+/g, 'assets/buy.js')
const write = (dir, html) => {
  const p = path.join(ROOT, dir, 'index.html')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null
  if (old === html) return false
  fs.writeFileSync(p, html)
  return old === null || readable(old) !== readable(html)
}

// ── 有料の一覧への案内（冒頭の1行・混んでいる申込先・申込先ごとの一覧へのリンク）────────────────
// ★「混んでいる申込先の実名は上に全部出しています」と案内の文が言うので、混んでいる申込先の表は案内より上に置く。
const sellParts = (key) => {
  const { C, F, konde } = load(key)
  const U = C.byRounds ? '回' : '件'
  const BOSHU = C.boshu || '定期募集'
  const facts = { price: PRICE, city: C.city, rounds: F.rounds, minN: MIN_N, suki: SUKI, sukiN: num(F.suki), bureN: F.buread, enoughN: num(F.enough), key: C.key, axis: C.axis.label, only: C.only || `${C.city}営住宅だけ`, minU: U, boshu: BOSHU }
  const fields = C.cols.map(([f]) => f)
  const axisField = fields.find((f) => konde.every((h) => h[f] === h.axis))
  if (!axisField) die(`${C.city}：軸の欄が名寄せの鍵に無い（混んでいる申込先の表が作れない）`)
  // 住宅名の欄（大阪府営は団地を住宅コードで見分けるので danchi）。添え書きは名寄せの鍵の残り＋市区町村・最寄り駅だけ（家賃などまで並べると長すぎる）
  const nameField = fields.includes('name') ? 'name' : (fields.includes('danchi') ? 'danchi' : fields[0])
  const keyN = C.keyOf(konde[0] || {}).length
  const rest = [...fields.slice(0, keyN), ...['city', 'access'].filter((f) => fields.includes(f))].filter((f, i, a) => f !== axisField && f !== nameField && a.indexOf(f) === i)
  const top = konde.slice(0, 12)
  const kondeHtml = `  <h2 id="konde">混んでいる申込先（実名・無料）</h2>
  <p>避けるべき相手も無料で出します。${BOSHU}${F.rounds}回を申込先ごとに名寄せし、${MIN_N}${U}以上${C.byRounds ? 'の募集で' : ''}観測できた申込先を、倍率の中央値が高い順に${top.length}件並べました。</p>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>${esc(C.axis.label)}</th><th>住宅</th><th class="num">中央値</th><th class="num">最高</th><th class="num">観測</th></tr></thead>
  <tbody>
${top.map((h) => `  <tr><td>${esc(h[axisField])}</td><td>${esc(h[nameField])}${rest.length ? `<br><small>${rest.map((f) => esc(h[f])).filter(Boolean).join('・')}</small>` : ''}</td><td class="num">${r1(h.med)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="note">中央値・最高は、その申込先の各回の倍率（申込÷募集戸数）から当方が計算したものです。「観測」は募集の件数で、募集回の数ではありません。</p>`
  const leafHtml = `  <h2 id="pack">申込先ごとの一覧（${PRICE}円）</h2>
  <p class="offer-lead"><strong>申込書に書けるのは1回につき1つ</strong>です。${esc(C.axis.label)}ごとの相場が分かっても、最後は申込先を1つに決めることになります。そこだけは申込先ごとの実測が要ります。</p>
${offerKoeiLeaf({ facts, up: '../' })}`
  return { jump: jumpKoei({ ...facts, up: '../' }), konde: kondeHtml, leaf: leafHtml }
}

// ── 2. 埼玉 ────────────────────────────────────────────────────────────────
function saitama () {
  const R = [...SA.rounds].sort((a, b) => b.round.localeCompare(a.round))   // 新しい回を上に
  const COLS = [['一般住宅', '一般'], ['子育て支援住宅', '子育て支援'], ['高齢者・障がい者住宅', '高齢者・<br>障がい者'], ['単身住宅', '単身']]
  const ratio = (r, t) => (r.types[t] ? r.types[t].moushikomi / r.types[t].koho : null)
  const tan = R.map((r) => ratio(r, '単身住宅'))
  const oth = R.flatMap((r) => ['一般住宅', '子育て支援住宅', '高齢者・障がい者住宅'].map((t) => ratio(r, t)))
  const [tMin, tMax] = minmax(tan), [oMin, oMax] = minmax(oth)
  if (!(tMin > oMax)) die('埼玉：「単身住宅はどの回もほかの種別より高い」が崩れた。文を書き直す')
  const latest = R[0]
  const all = (r) => r.published.moushikomi / r.published.koho
  const latestTop = R.every((r) => all(r) <= all(latest)) && R.every((r) => r.published.koho >= latest.published.koho)
  const zero = R.map((r) => sum(Object.values(r.types), (v) => v.zero)), rows = R.map((r) => sum(Object.values(r.types), (v) => v.rows))
  const [zMin, zMax] = minmax(zero), [pMin, pMax] = minmax(zero.map((z, i) => Math.round((z / rows[i]) * 100)))
  const first = R[R.length - 1], N = R.length
  const S = sellParts('saitama-ken')
  const title = `埼玉県営住宅の倍率｜募集回ごと・住宅種別ごと（${WA(first.round)}〜${WA(latest.round)}の${N}回）｜フクシル`
  const desc = `埼玉県営住宅の定期募集${N}回ぶんの申込状況を集計し、一般・子育て支援・高齢者・障がい者・単身の住宅種別ごとに倍率（申込件数÷募集戸数）を並べました。単身住宅は${tMin.toFixed(2)}〜${tMax.toFixed(2)}倍と、ほかの種別よりずっと高くなっています。`
  const rowsHtml = R.map((r) => `  <tr><th scope="row">${WA(r.round)}</th>${cell(r.published.moushikomi, r.published.koho, '件')}${COLS.map(([t]) => (r.types[t] ? cell(r.types[t].moushikomi, r.types[t].koho, '件') : '<td class="num">—</td>')).join('')}</tr>`).join('\n')
  const links = R.map((r) => `<a href="${esc(r.file)}" rel="nofollow">${WA(r.round)}</a>`).join('・')
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ 埼玉県営住宅の倍率</p>
  <h1>埼玉県営住宅の倍率（募集回ごと・住宅種別ごと）</h1>
  <p class="updated">最終確認：${esc(SA.checked)} ／ 埼玉県住宅供給公社が公表している各回の申込状況（${N}回）から計算</p>

  <p class="lead">埼玉県営住宅の定期募集は、1・4・7・10月の年4回です。公社は回ごとに、住宅ごとの募集戸数と申込件数を公表しています。ただしホームページに載るのは直近1年ぶんだけで、ほとんどの回は住宅種別ごとの倍率が出ていません。
  そこで${WA(first.round)}から${WA(latest.round)}までの${N}回を集め、<strong>住宅種別ごとの倍率（申込件数の合計÷募集戸数の合計）</strong>にしました。</p>

  <div class="callout point"><p><span class="tag">要点</span><strong>単身住宅は、${N}回とも${tMin.toFixed(2)}〜${tMax.toFixed(2)}倍</strong>でした。一般・子育て支援・高齢者・障がい者住宅（${oMin.toFixed(2)}〜${oMax.toFixed(2)}倍）より、どの回もずっと高くなっています。${latestTop ? `直近の${WA(latest.round)}は募集が${n(latest.published.koho)}戸と${N}回でいちばん少なく、全体の倍率も${bai(latest.published.moushikomi, latest.published.koho)}倍と${N}回でいちばん高い回でした。` : ''}</p></div>

${S.jump}

  <h2>募集回ごとの倍率</h2>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>募集回</th><th class="num">全体</th>${COLS.map(([, h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
  <tbody>
${rowsHtml}
  </tbody></table></div>
  <p class="note">倍率は申込件数÷募集戸数です。公社が${WA('2026-04')}の回に載せた住宅種別ごとの倍率と同じ計算で、その回は種別ごとの数と倍率がすべて一致します。
  車イス住宅・単身車イス住宅・福島自主避難住宅は募集戸数が少ないので列を作らず、「全体」にだけ入れています。</p>

${S.konde}

${S.leaf}

  <h2>表の読み方</h2>
  <ul>
  <li><strong>同じ種別でも、住宅によって倍率はまるで違います。</strong>どの回にも、申込みが1件もなかった募集（公社の表の行）が${zMin}〜${zMax}件ありました（全体の${pMin}〜${pMax}%）。</li>
  <li><strong>抽せんの番号の数は、住宅種別と世帯の事情で変わります。</strong>基本の数は、一般住宅・子育て支援住宅が5個、高齢者・障がい者住宅・車イス住宅・単身住宅・単身車イス住宅が1個です。世帯の事情によって、ここに個数が足されます。
  たとえば母子・父子世帯は一般・子育て支援で＋2、通算4回落選した世帯は一般で＋1、身体障害者手帳1〜2級などを持つ人がいる世帯は、高齢者・障がい者住宅・単身住宅で＋2です。表の倍率には、この個数の違いは入っていません。</li>
  <li>公社は${WA('2025-10')}の募集から、募集一覧表に載せていた「過去1年の平均倍率」の表記をやめました。いまの一覧表には、過去1年分の申込状況は公社のホームページで見るように、と書かれています。</li>
  </ul>

  <h2>数字の確かめ方</h2>
  <p>各回の申込状況のPDFを2通りの方法で読み、住宅種別ごとの数が一致することを確かめました。そのうえで、合計が公社の表にある合計（募集戸数・申込件数）と一の位まで合うことも確かめています。
  ${WA(latest.round)}の回は、申込状況の表に申込件数の合計しか載っていません。そのため募集戸数は、公社の募集一覧表（${n(latest.published.koho)}戸）と突き合わせました。${latest.prefPressKoho !== latest.published.koho ? `県の報道発表では、この回は${n(latest.prefPressKoho)}戸で、${Math.abs(latest.prefPressKoho - latest.published.koho)}戸の差があります。` : ''}</p>

  <div class="sources">
  <h2>出典</h2>
  <ul>
  <li>埼玉県住宅供給公社「県営住宅」の申込みのページ（過去の申込状況）<br><a href="${esc(SA.page)}" rel="nofollow">${esc(SA.page)}</a></li>
  <li>各回の申込状況（PDF）：${links}<br><small>古い回はホームページのリンクから外れていきます。</small></li>
  <li>埼玉県住宅供給公社「${esc(SA.guide.label)}」<br><a href="${esc(SA.guide.url)}" rel="nofollow">${esc(SA.guide.url)}</a></li>
  </ul>
  <p class="disclaimer">当サイトは埼玉県・埼玉県住宅供給公社とは関係のない個人が運営しています。数字は上記の公表資料を${esc(SA.checked)}時点で集計したもので、当選を保証するものではありません。申込みの資格・募集の内容は、必ず最新の募集案内でご確認ください。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related">関連：<a href="../hikazei/ken/11/">埼玉県の住民税非課税の年収の目安</a> ／ <a href="../articles/koei-saitama.html">さいたま市の市営住宅の当選倍率</a> ／ <a href="../articles/koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまでか</a> ／ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅の当選倍率まとめ</a></p>
`
  return { title, html: page({ title, desc, canonical: '/saitama-ken/', depth: 1, body, jsonld: jsonld(title, desc, '/saitama-ken/', SA.checked) }) }
}

// ── 3. 愛知 ────────────────────────────────────────────────────────────────
function aichi () {
  const R = [...AI.rounds].sort((a, b) => b.round.localeCompare(a.round))
  const first = R[R.length - 1], latest = R[0], N = R.length
  const S = sellParts('aichi-ken')
  const tot = (r) => ({ koho: r.ippan.koho + r.fukushi.koho, oubo: r.ippan.oubo + r.fukushi.oubo })
  const [aMin, aMax] = minmax(R.map((r) => tot(r).oubo / tot(r).koho))
  // 文の前提：最新の年度の回はすべて一般のほうが高い／それより前の年度は福祉枠のほうが高い回が多い
  const fy = latest.round.slice(0, 4)
  const cur = R.filter((r) => r.round.startsWith(fy)), past = R.filter((r) => !r.round.startsWith(fy))
  const cmp = (r) => Math.sign(Number(bai(r.fukushi.oubo, r.fukushi.koho)) - Number(bai(r.ippan.oubo, r.ippan.koho)))
  const curIppan = cur.every((r) => cmp(r) < 0)
  const pastF = past.filter((r) => cmp(r) > 0).length, pastEq = past.filter((r) => cmp(r) === 0).length
  const trend = curIppan && pastF > past.length / 2
    ? `${FY(first.round)}〜${FY(past[0].round)}の${past.length}回は、福祉枠のほうが高い回が${pastF}回${pastEq ? `（同じが${pastEq}回）` : ''}でした。それが${FY(latest.round)}の${cur.length}回は、どれも一般のほうが高くなっています。`
    : ''
  // 管理事務所・支所ごと：最新の年度の回の合計
  const secNames = [...new Set(cur.flatMap((r) => r.sections.map((s) => s.sec)))]
  const secRows = secNames.map((sec) => {
    const xs = cur.map((r) => r.sections.find((s) => s.sec === sec)).filter(Boolean)
    return { sec, koho: sum(xs, (s) => s.koho), oubo: sum(xs, (s) => s.oubo), k: xs.length }
  })
  if (secRows.some((s) => s.k !== cur.length)) die('愛知：最新の年度の回で、管理事務所・支所の顔ぶれがそろっていない。表の作り方を見直す')
  const secLabel = (s) => s.replace(/^名古屋尾張住宅管理事務所（(.+)）$/, '$1<br><small>名古屋尾張住宅管理事務所</small>')
  const title = `愛知県営住宅の倍率｜定期募集の回ごと・一般と福祉枠（${WAN(first.round)}〜${WAN(latest.round)}の${N}回）｜フクシル`
  const desc = `愛知県営住宅の定期募集${N}回ぶんの抽選結果表を集計し、回ごとに一般と福祉枠の倍率（応募者数÷募集戸数）を並べました。全体は${aMin.toFixed(2)}〜${aMax.toFixed(2)}倍。管理事務所・支所ごとの倍率も出しています。`
  const rowsHtml = R.map((r) => { const t = tot(r); return `  <tr><th scope="row">${WAN(r.round)}</th>${cell(t.oubo, t.koho, '人')}${cell(r.ippan.oubo, r.ippan.koho, '人')}${cell(r.fukushi.oubo, r.fukushi.koho, '人')}</tr>` }).join('\n')
  const secHtml = secRows.map((s) => `  <tr><th scope="row">${secLabel(esc(s.sec))}</th>${cell(s.oubo, s.koho, '人')}</tr>`).join('\n')
  const links = R.map((r) => `<a href="${esc(r.file)}" rel="nofollow">${WAN(r.round)}</a>`).join('・')
  const sk = AI.skipped[0]
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ 愛知県営住宅の倍率</p>
  <h1>愛知県営住宅の倍率（定期募集の回ごと・一般と福祉枠）</h1>
  <p class="updated">最終確認：${esc(AI.checked)} ／ 愛知県住宅供給公社が公表している抽選結果表（${N}回）から計算</p>

  <p class="lead">愛知県営住宅の定期募集は年3回です。公社は回ごとに抽選結果表（住宅ごとの募集戸数・応募者数・倍率）を公表しています。
  ${WAN(first.round)}から${WAN(latest.round)}までの${N}回を集め、<strong>回ごとに一般と福祉枠に分けた倍率（応募者数の合計÷募集戸数の合計）</strong>にしました。管理事務所・支所ごとの倍率も出しています。</p>

  <div class="callout point"><p><span class="tag">要点</span>全体の倍率は、${N}回とも<strong>${aMin.toFixed(2)}〜${aMax.toFixed(2)}倍</strong>の間でした。${trend}</p></div>

  <div class="callout warn"><p><span class="tag">2026年9月の募集から変わりました</span>令和8年度第2回（2026年9月受付）から、<strong>部屋ごとの募集</strong>に変わりました。福祉枠に当たる世帯は、事故住宅を除くすべての一般世帯向住宅に申し込めます（福祉枠で申し込むと、抽選番号が2つ届きます）。
  このため、下の表の「一般」と「福祉枠」の倍率は、これからの回とはそのままは比べられません。</p></div>

${S.jump}

  <h2>定期募集の回ごとの倍率</h2>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>募集回</th><th class="num">全体</th><th class="num">一般</th><th class="num">福祉枠</th></tr></thead>
  <tbody>
${rowsHtml}
  </tbody></table></div>
  <p class="note">倍率は応募者数÷募集戸数です（公社の抽選結果表の倍率も同じ計算です）。福祉枠の数は、抽選結果表で（福祉）の印がついた行を足したものです。</p>

  <h2>管理事務所・支所ごとの倍率（${FY(latest.round)}の${cur.length}回の合計）</h2>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>管理事務所・支所</th><th class="num">倍率</th></tr></thead>
  <tbody>
${secHtml}
  </tbody></table></div>
  <p class="note">抽選結果表は、住宅を受け持つ管理事務所・支所ごとに分かれています。数字は、その合計行を${cur.length}回ぶん足したものです。管理事務所・支所の一覧は、申込案内書の49・50ページにあります。</p>

${S.konde}

${S.leaf}

  <h2>表の読み方</h2>
  <ul>
  <li>応募が募集戸数に満たなかった住宅は、抽選日のあとに追加募集が行われます（申込案内書）。</li>
  <li>${WAN(sk.round)}の抽選結果表は、文字の入っていない画像だけのPDFです。こちらで読み取った数が、公表の合計と合わない地区がありました。そのため表には入れていません（<a href="${esc(sk.file)}" rel="nofollow">原本</a>）。</li>
  </ul>

  <h2>数字の確かめ方</h2>
  <p>${N}回とも、読み取った行の和が、抽選結果表にある管理事務所・支所ごとの合計行と一の位まで合うことを確かめています。</p>

  <div class="sources">
  <h2>出典</h2>
  <ul>
  <li>愛知県住宅供給公社「定期募集の抽選結果」<br><a href="${esc(AI.page)}" rel="nofollow">${esc(AI.page)}</a></li>
  <li>各回の抽選結果表（PDF）：${links}</li>
  <li>愛知県住宅供給公社「${esc(AI.guide.label)}」（部屋ごとの募集・福祉枠の申込み方法）<br><a href="${esc(AI.guide.url)}" rel="nofollow">${esc(AI.guide.url)}</a></li>
  </ul>
  <p class="disclaimer">当サイトは愛知県・愛知県住宅供給公社とは関係のない個人が運営しています。数字は上記の公表資料を${esc(AI.checked)}時点で集計したもので、当選を保証するものではありません。申込みの資格・募集の内容は、必ず最新の申込案内書でご確認ください。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related">関連：<a href="../hikazei/ken/23/">愛知県の住民税非課税の年収の目安</a> ／ <a href="../articles/koei-nagoya.html">名古屋市の市営住宅の当選倍率</a> ／ <a href="../articles/koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまでか</a> ／ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅の当選倍率まとめ</a></p>
`
  return { title, html: page({ title, desc, canonical: '/aichi-ken/', depth: 1, body, jsonld: jsonld(title, desc, '/aichi-ken/', AI.checked) }) }
}

// ── 3b. 大阪府（2026-10-01 ユーザー「粒度がいい狙い目の県を追加」＝三大都市圏なので申込先えらびは500円）────
// ★数は data/kenei-osaka.json（公開してよい集計＝回×区分・回×地域・住戸の条件ごと）から。住戸ごとの行は持たない。
// ★「住戸の条件ごとの倍率」は大阪府の資料の粒度だから出せる面の目玉（募集住宅一覧と申込区分コードで住戸ごとに結んだ）。
//   条件どうしは重なり合う（新しい団地ほどエレベーターがある等）ので、どれか1つが倍率を決めているとは書かない。
const OS = readJson('data/kenei-osaka.json')
function osaka () {
  const R = [...OS.rounds].sort((a, b) => b.round.localeCompare(a.round))
  for (const r of R) {
    const cs = Object.values(r.cats), ce = Object.values(r.centers)
    if (sum(cs, (v) => v.koho) !== r.sum.koho || sum(cs, (v) => v.uke) !== r.sum.uke || sum(ce, (v) => v.koho) !== r.sum.koho || sum(ce, (v) => v.uke) !== r.sum.uke) die(`大阪 ${r.round}：区分・地域の和が回の合計と合わない`)
    if (Math.abs(r.sum.koho - r.published.koho) + Math.abs(r.sum.uke - r.published.uke) > 1) die(`大阪 ${r.round}：回の合計が公表の合計と2以上ずれる`)
  }
  const first = R[R.length - 1], latest = R[0], N = R.length
  const S = sellParts('osaka-fu')
  const CATS = [['福祉あき家', '福祉世帯向け'], ['一般あき家', '一般世帯向け'], ['新婚・子育てあき家', '新婚・子育て']]
  const cellU = (v) => (v ? `<td class="num"><strong>${bai(v.uke, v.koho)}倍</strong><br><small>${n(v.koho)}戸・${n(v.uke)}件</small></td>` : '<td class="num">—</td>')
  const rowsHtml = R.map((r) => `  <tr><th scope="row">${WA(r.round)}<br><small>${esc(r.kai)}</small></th>${cellU(r.sum)}${CATS.map(([c]) => cellU(r.cats[c])).join('')}</tr>`).join('\n')
  const centers = {}
  for (const r of R) for (const [c, v] of Object.entries(r.centers)) { const a = centers[c] || (centers[c] = { koho: 0, uke: 0, rows: 0, zero: 0 }); a.koho += v.koho; a.uke += v.uke; a.rows += v.rows; a.zero += v.zero }
  const pctZ = (v) => Math.round((v.zero / v.rows) * 100)
  const tbl = (head, entries) => `  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>${head}</th><th class="num">倍率</th><th class="num">受付0件の住戸</th></tr></thead>
  <tbody>
${entries.map(([k, v]) => `  <tr><th scope="row">${esc(k)}</th>${cellU(v)}<td class="num">${pctZ(v)}%</td></tr>`).join('\n')}
  </tbody></table></div>`
  const order = (m, keys) => keys.filter((k) => m[k]).map((k) => [k, m[k]])
  const centerRows = Object.entries(centers).sort((a, b) => b[1].uke / b[1].koho - a[1].uke / a[1].koho)
  const W = OS.byWalk, E = OS.byEv, B = OS.byBuilt
  const walkKeys = ['徒歩10分以内', '徒歩11〜20分', '徒歩21分以上', 'バス']
  const evKeys = ['2階以上・その階にエレベーターが止まる', '2階以上・エレベーターが止まらない（通過・なし）', '1階']
  const builtKeys = ['2000年以降', '1990年代', '1980年代', '1970年代', '1969年以前']
  const odds = (v) => v.uke / v.koho
  // 文の前提を数字で確かめる（崩れたら文を書き直す）
  if (!(odds(W['徒歩10分以内']) > odds(W['バス']) && odds(E[evKeys[0]]) > odds(E[evKeys[1]]) && odds(B['2000年以降']) > odds(B['1970年代']))) die('大阪：要点の文の前提（駅近・EV・新しい住戸ほど倍率が高い）が崩れた。文を書き直す')
  const tot = OS.rounds.reduce((a, r) => ({ koho: a.koho + r.sum.koho, uke: a.uke + r.sum.uke }), { koho: 0, uke: 0 })
  const zeroAll = Object.values(OS.byWalk).reduce((a, v) => ({ zero: a.zero + v.zero, rows: a.rows + v.rows }), { zero: 0, rows: 0 })
  const title = `大阪府営住宅の倍率｜募集回ごと・区分ごと・駅からの距離やエレベーターごと（${WA(first.round)}〜${WA(latest.round)}の${N}回）｜フクシル`
  const desc = `大阪府営住宅の総合募集${N}回ぶんの受付状況を、同じ回の募集住宅一覧と住戸ごとに結んで集計しました。駅から徒歩10分以内の住戸は${bai(W['徒歩10分以内'].uke, W['徒歩10分以内'].koho)}倍、バス便の住戸は${bai(W['バス'].uke, W['バス'].koho)}倍。区分ごと・地域ごと・エレベーター・完成年度ごとの倍率も並べています。`
  const guide = 'https://www.osaka-fuei.com/pdf/r8_3-1.pdf'
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ 大阪府営住宅の倍率</p>
  <h1>大阪府営住宅の倍率（募集回ごと・区分ごと・住戸の条件ごと）</h1>
  <p class="updated">最終確認：${esc(OS.checked)} ／ 指定管理者3社が公表している総合募集受付状況表（${N}回・8つの管理センター）から計算</p>

  <p class="lead">大阪府営住宅の総合募集は、偶数月に年6回あります。府営住宅を管理する指定管理者（東急コミュニティー・穴吹ハウジングサービス・日本管財）は、回ごと・管理センターごとに、住戸ごとの受付数と倍率を「総合募集受付状況表」で公表しています。
  ${WA(first.round)}から${WA(latest.round)}までの${N}回を集め、同じ回の募集住宅一覧と<strong>住戸ごとに結んで</strong>、区分ごと・地域ごと・住戸の条件（駅からの距離・エレベーター・完成年度）ごとの倍率（受付数の合計÷募集戸数の合計）にしました。</p>

  <div class="callout point"><p><span class="tag">要点</span>${N}回で<strong>${n(tot.koho)}戸</strong>が募集され、受付は${n(tot.uke)}件でした。ただし<strong>受付が0件の住戸が${Math.round((zeroAll.zero / zeroAll.rows) * 100)}%</strong>あり、倍率は住戸の条件で大きく割れます。駅から徒歩10分以内の住戸は<strong>${bai(W['徒歩10分以内'].uke, W['徒歩10分以内'].koho)}倍</strong>、バス便の住戸は<strong>${bai(W['バス'].uke, W['バス'].koho)}倍</strong>。2階以上で<strong>その階にエレベーターが止まる住戸は${bai(E[evKeys[0]].uke, E[evKeys[0]].koho)}倍</strong>、止まらない住戸は${bai(E[evKeys[1]].uke, E[evKeys[1]].koho)}倍でした。</p></div>

${S.jump}

  <h2>募集回ごとの倍率</h2>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>募集回</th><th class="num">全体</th>${CATS.map(([, h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
  <tbody>
${rowsHtml}
  </tbody></table></div>
  <p class="note">倍率は受付数の合計÷募集戸数の合計です。事故住宅・車いす常用者世帯向け・シルバーハウジング・親子近居・子育て世帯向け・新築は募集が少ないので列を作らず、「全体」にだけ入れています。</p>

  <h2>住戸の条件ごとの倍率（${N}回の合計）</h2>
  <p>同じ団地でも、住戸によって階やエレベーターの止まり方が違います。そこで住戸ごとに募集住宅一覧と結んで数えました。</p>
  <h3>駅からの距離</h3>
${tbl('最寄り駅から', order(W, walkKeys))}
  <h3>エレベーター</h3>
${tbl('住戸の階とエレベーター', order(E, evKeys))}
  <h3>完成年度</h3>
${tbl('完成年度', order(B, builtKeys))}
  <p class="note">「駅から」は募集住宅一覧の交通の欄（最初の駅からの徒歩分。バスを使う住戸は「バス」）。「エレベーターが止まる」は、その住戸の階にエレベーターが止まるもの（一覧の「停止」）です。条件どうしは重なり合っていて（新しい団地ほどエレベーターがある、など）、どれか1つが倍率を決めているわけではありません。</p>

  <h2>地域（管理センター）ごとの倍率（${N}回の合計）</h2>
${tbl('管理センター', centerRows)}
  <p class="note">府営住宅は管理センターごとに受付状況表が分かれています。どの市区町村の住宅がどのセンターの受け持ちかは、府の募集案内に載っています。</p>

${S.konde}

${S.leaf}

  <h2>表の読み方</h2>
  <ul>
  <li><strong>倍率は受付数÷募集戸数です</strong>（受付状況表の倍率の列も同じ計算です）。受付数は申込の件数で、資格の審査は当選の後です。</li>
  <li>府の募集案内によると、18歳未満の子どもを3人以上扶養している世帯（多子世帯）は、<strong>抽選番号を2つ</strong>持てます。同じ倍率でも、当たりやすさは世帯によって違います。</li>
  <li>総合募集の申込みの受付は、偶数月の1日から15日です（府の募集案内）。</li>
  <li><strong>「倍率が低い＝誰でも入れる」ではありません。</strong>申込資格（収入基準・世帯の条件など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数が変わります。申し込む前に、その回の募集案内で必ず条件を確かめてください。</li>
  </ul>

  <h2>数字の確かめ方</h2>
  <p>${N}回・8つの管理センターの受付状況表を2通りの方法で読み、全行で値が一致しました。センターごとの表末尾の合計とは、回×センターの72本のうち70本が<strong>一の位まで一致</strong>しています。泉北（令和7年8月）は、無効になった申込1件を表の合計が0と数えている1件差です。布施（令和8年2月）は表に合計の行が無いので、同じ回の募集住宅一覧の戸数と申込区分コードの全件一致、府が公表した年度ごとの住宅別の応募状況との一致で確かめました。住戸の条件は、同じ回の募集住宅一覧と申込区分コードの完全一致だけで結んでいます（結べた割合は全回で100%）。</p>

  <div class="sources">
  <h2>出典</h2>
  <ul>
  <li>東急コミュニティー（千里・高槻・守口・堺東・泉北・岸和田の管理センター）「総合募集受付状況」<br><a href="${esc(OS.pages['千里'])}" rel="nofollow">${esc(OS.pages['千里'])}</a></li>
  <li>あなぶきハウジングサービス（布施管理センター）お知らせ<br><a href="${esc(OS.pages['布施'])}" rel="nofollow">${esc(OS.pages['布施'])}</a></li>
  <li>日本管財（藤井寺管理センター）お知らせ<br><a href="${esc(OS.pages['藤井寺'])}" rel="nofollow">${esc(OS.pages['藤井寺'])}</a></li>
  <li>募集住宅一覧（日本管財のサイトに回ごとに置かれた府内全域版）：${R.slice().reverse().map((r) => (OS.boshuList[r.round] ? `<a href="${esc(OS.boshuList[r.round].url)}" rel="nofollow">${WA(r.round)}</a>` : '')).filter(Boolean).join('・')}</li>
  <li>令和8年度第3回 総合募集の募集案内（多子世帯優遇・受付の期間）<br><a href="${guide}" rel="nofollow">${guide}</a></li>
  </ul>
  <p class="disclaimer">当サイトは大阪府・府営住宅の指定管理者とは関係のない個人が運営しています。数字は上記の公表資料を${esc(OS.checked)}時点で集計したもので、当選を保証するものではありません。申込みの資格・募集の内容は、必ず最新の募集案内でご確認ください。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related">関連：<a href="../hikazei/ken/27/">大阪府の住民税非課税の年収の目安</a> ／ <a href="../articles/koei-osaka.html">大阪市の市営住宅の当選倍率</a> ／ <a href="../articles/koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまでか</a> ／ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅の当選倍率まとめ</a></p>
`
  return { title, html: page({ title, desc, canonical: '/osaka-fu/', depth: 1, body, jsonld: jsonld(title, desc, '/osaka-fu/', OS.checked) }) }
}

// ── 4. 書き出しと sitemap ────────────────────────────────────────────────────
const out = [['saitama-ken', saitama(), SA.checked], ['aichi-ken', aichi(), AI.checked], ['osaka-fu', osaka(), OS.checked], ...FREE.filter((C) => !C.hold).map((C) => { const p = freePage(C); return [C.key, p, p.checked] })]   // hold＝公開保留（宮城）
const changed = out.filter(([dir, p]) => write(dir, p.html)).map(([dir]) => dir)
// sitemap：この2面のぶんだけ入れ替える。lastmod は、この回で中身が変わった面だけ今日（日本時間）にし、
// 変わらなかった面は前の値を残す（初めて載せるときはデータの確認日）。ビルドしただけの日にはしない。
// ★2026-09-30 有料の一覧への案内と混んでいる申込先の表を足した日に、確認日のまま据え置かれていたので直した。
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
for (const [dir, , checked] of out) {
  const loc = `${SITE}/${dir}/`
  const re = new RegExp(`^\\s*<url><loc>${loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</loc><lastmod>([^<]+)</lastmod>.*\\n`, 'm')
  const prev = re.exec(sm)?.[1]
  const lm = changed.includes(dir) ? TODAY : (prev || checked)
  // 載っている面はその場で置き換える（消して末尾に足すと、shogai-kojo-sell.mjs の行と順番が入れ替わり、毎回差分が出る）
  const line = `  <url><loc>${loc}</loc><lastmod>${lm}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`
  sm = re.test(sm) ? sm.replace(re, () => line) : sm.replace('</urlset>', () => `${line}</urlset>`)
}
fs.writeFileSync(smPath, sm)
console.log(`県営住宅の面：${out.map(([d]) => d).join('・')}（書き換え ${changed.length}枚）`)
