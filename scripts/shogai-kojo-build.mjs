// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-build.mjs — 障害者控除対象者認定の「比較表」と「自治体別ページ」を作る。
//
// ★何を出して、何を出さないか
//   出す: 例規・自治体ページから読み取った**判定ランクの下限**（寝たきり度・認知症度・要介護度）と、
//         その根拠（例規名・公布日・最終改正日・原典リンク）。
//   出さない: 条文の写し。原典へのリンクだけ置く。
//   出さない: 「その他市長が認めるもの」のような裁量条項の数値化。運用が外から見えないので、
//             数字にすると基準が緩いと誤読される。
//
// ★読み取れなかった自治体を「公表していない」と書かない
//   当方が読み取れなかったのか、その自治体が公表していないのかは別のこと。
//   大都市レーンで1件ずつ確認した19件だけ「公表していない」と書き、
//   例規レーンで読めなかったものは「当サイトでは読み取れていません」と書く。
//   ここを混ぜると、実名の自治体の隣に嘘が並ぶ。[[same-question-two-answers]]
//
// ★URLに日本語を使わない
//   全国地方公共団体コード（6桁）をファイル名にする。日本語名をURLにすると
//   percent-encoding 由来で本番が全数404になる事故が艦隊で起きている。
//   [[encoded-filename-csv-404]] 読者に見せる名前は title と h1 に置けば足りる。
//
// ★ビルド日を「読み取り日」として出さない
//   収集器はキャッシュ優先で動くので、原典を1件も取りに行かずにビルドし直すことがある。
//   そこで `new Date()` を読み取り日として出すと、**確認していない日に
//   「今日、公表資料を確認した」と書いた438枚が公開される**。艦隊で実測済みの事故型。
//   [[crawl-date-flattening]]
//   ∴ 日付はレコードが持つ fetchedAt（＝収集器が実際に取ってきた日）だけから出す。
//   ∴ このファイルに `new Date()` は無い。増やさないこと。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NINCHI, NETAKIRI, KAIGO, rank } from './shogai-kojo-lib.mjs'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { SEED_READ_DATE, asOf, latestOf } from './shogai-kojo-readdate.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'shogai-kojo')
const OUT = path.join(ROOT, 'shogai-kojo')
fs.mkdirSync(OUT, { recursive: true })

// その自治体の原典を実際に読んだ日。基準を別表（添付のRTF/DOCX）から読んだ自治体は
// 本文と別表で取得日が違うので、**古いほうを採る**。ページは根拠のいちばん古い部分より
// 新しくは名乗れない。収集器より前のレコードは日付を持たないので初回収集日に落とす。
const readAt = (r) => [r.fetchedAt, r.bessiFetchedAt].filter(Boolean).sort()[0] || SEED_READ_DATE


// ── データを1自治体1件に畳む（読めたものを優先）──────────────────────────────
const reiki = JSON.parse(fs.readFileSync(path.join(DATA, 'records.json'), 'utf8')).records
const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities-records.json'), 'utf8')).records
const score = (r) => (/読めた/.test(r.status) ? 100 : 0) + ['shogai', 'tokubetsu'].reduce((a, k) => a + Object.keys(r[k] || {}).length, 0)
const byCode = new Map()
for (const r of [...reiki, ...cities]) {
  const cur = byCode.get(r.code)
  if (!cur || score(r) > score(cur)) byCode.set(r.code, r)
}
const all = [...byCode.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)))
const ok = all.filter((r) => /読めた/.test(r.status))
const notPublished = all.filter((r) => r.status === '判定ランクを公表していない')
const unread = all.filter((r) => !/読めた/.test(r.status) && r.status !== '判定ランクを公表していない')

// ── 「同じ状態の人が街でどうなるか」を数える（比較表の看板）──────────────────
const usersOf = (key) => ok.filter((r) => r.tokubetsu?.[key] || r.shogai?.[key])
const verdictAt = (r, level, list, key) => {
  const i = list.indexOf(level)
  if (r.tokubetsu?.[key] && list.indexOf(r.tokubetsu[key]) <= i) return 'tokubetsu'
  if (r.shogai?.[key] && list.indexOf(r.shogai[key]) <= i) return 'shogai'
  return 'none'
}
const countAt = (level, list, key) => {
  const pool = usersOf(key)
  const c = { tokubetsu: 0, shogai: 0, none: 0, 母数: pool.length }
  for (const r of pool) c[verdictAt(r, level, list, key)]++
  return c
}

const LABEL = { tokubetsu: '特別障害者（所得税40万円）', shogai: '障害者（所得税27万円）', none: '対象外' }
const CLS = { tokubetsu: 'yes', shogai: '', none: 'no' }

// ── 基準を1つの表にする ─────────────────────────────────────────────────────
const critTable = (r) => {
  const row = (label, key, list) => {
    const a = r.shogai?.[key], b = r.tokubetsu?.[key]
    if (!a && !b) return ''
    return `<tr><th>${label}</th><td>${a ? esc(a) + ' 以上' : '<span class="no">この物差しは使われていません</span>'}</td>` +
      `<td>${b ? esc(b) + ' 以上' : '<span class="no">この物差しは使われていません</span>'}</td></tr>`
  }
  const rows = row('要介護度', 'kaigo', KAIGO) + row('認知症高齢者の日常生活自立度<br><small>（認知症度）</small>', 'ninchi', NINCHI) +
    row('障害高齢者の日常生活自立度<br><small>（寝たきり度）</small>', 'netakiri', NETAKIRI)
  if (!rows) return ''
  return `<div class="table-wrap"><table>
<thead><tr><th>判定に使う物差し</th><th>障害者に準ずる<br><small>所得税27万円・住民税26万円</small></th><th>特別障害者に準ずる<br><small>所得税40万円・住民税30万円</small></th></tr></thead>
<tbody>${rows}</tbody></table></div>`
}

// ── ① 自治体別ページ ────────────────────────────────────────────────────────
let made = 0
for (const r of [...ok, ...notPublished]) {
  const name = `${r.pref}${r.city}`
  const at = readAt(r)
  const has = /読めた/.test(r.status)
  const title = has
    ? `${name}の障害者控除対象者認定｜要介護でも対象になる基準（${at.slice(0, 4)}年版）｜フクシル`
    : `${name}の障害者控除対象者認定｜認定基準は公表されていません｜フクシル`
  const desc = has
    ? `${name}で「障害者控除対象者認定」を受けられる基準。要介護認定を受けている65歳以上なら、障害者手帳がなくても所得税27万円・特別障害者なら40万円の控除が使えます。${name}が定めた判定ランクの下限を、根拠の例規リンクつきで掲載。`
    : `${name}は障害者控除対象者認定の判定ランク（日常生活自立度・要介護度）を公表していません。対象かどうかは窓口での確認が必要です。制度の内容と申請先をまとめました。`

  // その自治体の基準だと、どの状態の人がどうなるか
  let verdicts = ''
  if (has) {
    const lines = []
    for (const [key, list, label] of [['ninchi', NINCHI, '認知症度'], ['kaigo', KAIGO, '要介護度'], ['netakiri', NETAKIRI, '寝たきり度']]) {
      if (!r.tokubetsu?.[key] && !r.shogai?.[key]) continue
      const levels = key === 'ninchi' ? ['Ⅰ', 'Ⅱa', 'Ⅲa', 'Ⅳ'] : key === 'kaigo' ? ['要介護1', '要介護2', '要介護3', '要介護4', '要介護5'] : ['J1', 'A1', 'B1', 'C1']
      lines.push(`<h3>${label}で見た場合</h3><div class="table-wrap"><table><thead><tr><th>${label}</th><th>${esc(name)}での扱い</th><th>全国（この物差しを使う${usersOf(key).length}自治体）</th></tr></thead><tbody>` +
        levels.map((lv) => {
          const v = verdictAt(r, lv, list, key)
          const c = countAt(lv, list, key)
          return `<tr><th>${esc(lv)}</th><td class="${CLS[v]}">${LABEL[v]}</td>` +
            `<td><small>特別 ${c.tokubetsu} ／ 障害者 ${c.shogai} ／ 対象外 ${c.none}</small></td></tr>`
        }).join('') + '</tbody></table></div>')
    }
    verdicts = lines.join('\n')
  }

  const src = r.sourceUrl || r.url
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="./index.html">障害者控除の認定基準（自治体別）</a> ＞ ${esc(name)}</p>
  <h1>${esc(name)}の障害者控除対象者認定</h1>
  <p class="updated">最終更新：${at} ／ 出典は${esc(name)}が公開している${r.reikiTitle ? '例規' : 'ページ'}（末尾にリンク）</p>

  <p class="lead">${esc(name)}にお住まいで<strong>65歳以上・要介護認定を受けている</strong>方は、障害者手帳がなくても
  <strong>「障害者控除対象者認定書」</strong>を受けられる場合があります。認定されると、所得税で<strong>27万円</strong>（特別障害者なら<strong>40万円</strong>、
  同居していれば<strong>75万円</strong>）が課税所得から差し引かれます。<strong>この認定の基準は市区町村ごとに違います。</strong></p>

${has ? `  <div class="callout point"><p><span class="tag">${esc(name)}の基準</span>${esc(name)}が定めている判定ランクの下限です。ここに届いていれば対象になり得ますが、<strong>最終的な判断は窓口が行います</strong>。</p></div>
${critTable(r)}
${verdicts}` : `  <div class="callout warn"><p><span class="tag">確認できませんでした</span>${esc(name)}は、対象になる状態を「知的障害者（軽度・中度）に準ずる方」といった区分までは示していますが、
  <strong>実際にどの判定ランク（日常生活自立度・要介護度）から対象になるのかを公表していません</strong>（${at}時点、当サイトが公開ページを確認した範囲）。
  対象かどうかは窓口でご確認ください。他の自治体では公表しているところもあり、その一覧は<a href="./index.html">こちら</a>です。</p></div>`}

  <h2>いくら軽くなるのか</h2>
  <div class="table-wrap"><table>
  <thead><tr><th></th><th>障害者</th><th>特別障害者</th><th>同居特別障害者</th></tr></thead>
  <tbody>
  <tr><th>所得税の所得控除</th><td>27万円</td><td>40万円</td><td class="yes">75万円</td></tr>
  <tr><th>住民税の所得控除</th><td>26万円</td><td>30万円</td><td class="yes">53万円</td></tr>
  </tbody></table></div>
  <p class="note">これは「税金が○万円安くなる」のではなく、<strong>課税所得を減らす</strong>しくみです。実際の減税額は控除額×税率。
  くわしくは<a href="../articles/shogaisha-kojo-tax.html">障害者控除で税金はいくら安くなるか</a>をご覧ください。</p>

  <h2>気をつけること</h2>
  <ul>
  <li><strong>要介護認定を受けていれば自動で対象、ではありません。</strong>要介護認定と障害者控除の認定は別の判断です。申請が必要です。</li>
  <li>ほとんどの自治体の基準には<strong>「その他市（区・町・村）長が認めるもの」という条項</strong>があります。表の下限に届いていなくても、状態によっては認定されることがあります。逆に届いていても認定されないことがあります。</li>
  <li>判定の基準日は、控除を受ける年の<strong>12月31日</strong>です（その年に亡くなった場合はその日）。</li>
  <li><strong>過去の分もさかのぼれる場合があります。</strong>すでに確定申告した年の還付は、原則5年前まで請求できます。</li>
  </ul>

  <div class="callout point"><p><span class="tag">手続きまで進めるなら</span>
  ここまでが無料で読めるところです。実際に認定書をもらって<strong>過去5年分をさかのぼる</strong>には、
  親御さんの自立度ランクが書かれた書類を取り寄せ、還付額を試算し、更正の請求か還付申告を出す必要があります。
  その手順を${esc(name)}の基準に合わせてまとめた資料を用意しています（500円）。
  → <a href="../pack/">5年分さかのぼる手順を見る（500円）</a></p></div>

  <div class="sources">
  <h2>出典</h2>
  <ul>
  ${r.reikiTitle ? `<li>${esc(name)}「${esc(r.reikiTitle)}」${r.announced ? `（${esc(r.announced)} 公布` : ''}${r.updated ? ` ／ ${esc(r.updated)} 最終改正` : ''}${r.announced ? '）' : ''}<br><a href="${esc(src)}" rel="nofollow">${esc(src)}</a></li>` : `<li>${esc(name)}の公開ページ<br><a href="${esc(src)}" rel="nofollow">${esc(src)}</a></li>`}
  ${r.bessiUrl ? `<li>別表：<a href="${esc(r.bessiUrl)}" rel="nofollow">${esc(r.bessiUrl)}</a></li>` : ''}
  <li>国税庁「市町村長等の障害者認定と介護保険法の要介護認定について」<a href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1185.htm" rel="nofollow">タックスアンサー No.1185</a></li>
  </ul>
  <p class="disclaimer">当サイトは${esc(name)}とは関係のない個人が運営しています。掲載内容は上記の公表資料を${at}時点で読み取ったもので、
  制度の適用可否を保証するものではありません。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>


  <p class="related"><a href="./index.html">→ 全国${ok.length}自治体の認定基準を比べる</a></p>
`
  fs.writeFileSync(path.join(OUT, `${r.code}.html`), page({
    title, desc, canonical: `/shogai-kojo/${r.code}.html`, depth: 1, body,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0],
      description: desc, inLanguage: 'ja', datePublished: at, dateModified: at,
      author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' },
      about: { '@type': 'AdministrativeArea', name },
    },
  }))
  made++
}

// ── ② 比較表（ハブ）────────────────────────────────────────────────────────
const byPref = new Map()
for (const r of all) {
  if (!byPref.has(r.pref)) byPref.set(r.pref, [])
  byPref.get(r.pref).push(r)
}
const fmt = (o) => o ? [o.kaigo, o.ninchi ? '認知症度' + o.ninchi : null, o.netakiri ? '寝たきり度' + o.netakiri : null].filter(Boolean).join(' / ') || '—' : '—'

const headline = ['Ⅱa', 'Ⅲa', 'Ⅳ'].map((lv) => {
  const c = countAt(lv, NINCHI, 'ninchi')
  return `<tr><th>認知症度が${lv}</th><td class="yes">${c.tokubetsu}</td><td>${c.shogai}</td><td class="no">${c.none}</td></tr>`
}).join('') + ['要介護1', '要介護3', '要介護4'].map((lv) => {
  const c = countAt(lv, KAIGO, 'kaigo')
  return `<tr><th>${lv}</th><td class="yes">${c.tokubetsu}</td><td>${c.shogai}</td><td class="no">${c.none}</td></tr>`
}).join('')

// ── ②-0 そのまま引用できる数値と、CSVの配布 ────────────────────────────────
// ★S1(引用される統計ページ)の必須要素をこのハブに持たせる。
//   数字は上の集計関数からしか作らない。推定・レンジ補完はしない（間違った数字を
//   引用されたら信用は戻らない）。データが支えない項目はその項目ごと作らない。
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

// ★ハブは全国ぶんをまとめて語るので、日付も「収録した全件をいつ読んだか」で書く。
//   1日で取り切れば1つの日付、取り直しが分かれれば範囲になる。いちばん新しい日だけを
//   出すと、据え置いた自治体まで新しく確認したように読める。
const AS_OF = asOf(all.map(readAt))
const LATEST = latestOf(all.map(readAt))
// 政令市の段は政令市18市についての主張なので、その18市を読んだ日で書く。
const AS_OF_SEIREI = asOf(all.filter((r) => r.kind === '政令市').map(readAt))

// 下限値の分布（読み取れた自治体のうち、その物差しを使っているものだけ）
const distOf = (key, which, list) => {
  const m = new Map()
  for (const r of ok) {
    const v = r[which]?.[key]
    if (!v) continue
    m.set(v, (m.get(v) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => list.indexOf(a[0]) - list.indexOf(b[0]))
}
const distText = (d) => d.map(([v, n]) => `${v} ${n}`).join(' ／ ') || 'なし'

const cN3 = countAt('Ⅲa', NINCHI, 'ninchi')
const cN4 = countAt('Ⅳ', NINCHI, 'ninchi')
const cK1 = countAt('要介護1', KAIGO, 'kaigo')
const cK3 = countAt('要介護3', KAIGO, 'kaigo')
const cK5 = countAt('要介護5', KAIGO, 'kaigo')
const uK = usersOf('kaigo').length, uN = usersOf('ninchi').length, uT = usersOf('netakiri').length

const facts = [
  `${AS_OF}時点、全国${all.length}市区町村の障害者控除対象者認定を収録し、うち<strong>${ok.length}自治体</strong>で判定ランク（要介護度・日常生活自立度）の下限を公表資料から読み取れた（フクシル調べ・N=${all.length}）。`,
  `認知症高齢者の日常生活自立度が<strong>Ⅲa</strong>の人は、この物差しを使う${uN}自治体のうち<strong>${cN3.tokubetsu}自治体で特別障害者（所得税40万円）・${cN3.shogai}自治体で障害者（27万円）・${cN3.none}自治体で対象外</strong>に分かれる（N=${uN}・${AS_OF}時点）。`,
  `同じ物差しで<strong>Ⅳ</strong>（最重度に近い区分）まで進むと、<strong>${cN4.tokubetsu}自治体が特別障害者・${cN4.shogai}自治体が障害者</strong>となり、対象外は${uN}自治体中${cN4.none}自治体まで減る（N=${uN}・${AS_OF}時点）。`,
  `<strong>要介護3</strong>の人は、要介護度を判定に使う${uK}自治体のうち<strong>${cK3.tokubetsu}自治体で特別障害者・${cK3.shogai}自治体で障害者・${cK3.none}自治体で対象外</strong>（N=${uK}・${AS_OF}時点）。`,
  `要介護度で判定する${uK}自治体のうち、<strong>要介護1では${cK1.none}自治体（${pct(cK1.none, uK)}%）が対象外</strong>だが、<strong>要介護5では対象外が${cK5.none}自治体</strong>になる（N=${uK}・${AS_OF}時点）。`,
  `判定に使う物差しは自治体によって違い、読み取れた${ok.length}自治体のうち<strong>要介護度を使うのが${uK}・認知症高齢者の日常生活自立度が${uN}・障害高齢者の日常生活自立度（寝たきり度）が${uT}</strong>（重複あり・N=${ok.length}・${AS_OF}時点）。`,
  `「障害者（27万円）」の下限を要介護度で定めている自治体の内訳は <strong>${distText(distOf('kaigo', 'shogai', KAIGO))}</strong>（自治体数・${AS_OF}時点）。`,
  `「特別障害者（40万円）」の下限を認知症高齢者の日常生活自立度で定めている自治体の内訳は <strong>${distText(distOf('ninchi', 'tokubetsu', NINCHI))}</strong>（自治体数・${AS_OF}時点）。`,
  `判定ランクを<strong>公表していない</strong>と1件ずつ確認できたのは${notPublished.length}自治体、当サイトがまだ読み取れていないものが${unread.length}自治体（N=${all.length}・${AS_OF}時点）。`,
]

// CSV は data/ に置く（この艦の配布物の置き場に合わせる）。
// ファイル名は ASCII。日本語名にすると本番で全数404になる事故が艦隊で起きている。
// [[encoded-filename-csv-404]]
const csvCell = (v) => {
  const t = String(v ?? '')
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
}
const csvRows = [['全国地方公共団体コード', '都道府県', '市区町村', '収録状況',
  '障害者_要介護度の下限', '障害者_認知症度の下限', '障害者_寝たきり度の下限',
  '特別障害者_要介護度の下限', '特別障害者_認知症度の下限', '特別障害者_寝たきり度の下限',
  '根拠（例規名など）', '公布日', '最終改正日', '出典URL', 'データ読み取り日'].join(',')]
for (const r of all) {
  csvRows.push([r.code, r.pref, r.city, r.status,
    r.shogai?.kaigo, r.shogai?.ninchi, r.shogai?.netakiri,
    r.tokubetsu?.kaigo, r.tokubetsu?.ninchi, r.tokubetsu?.netakiri,
    r.reikiTitle, r.announced, r.updated, r.sourceUrl || r.url, readAt(r)].map(csvCell).join(','))
}
fs.writeFileSync(path.join(ROOT, 'data', 'shogai-kojo-kijun.csv'), '\ufeff' + csvRows.join('\n') + '\n')

const citeBlock = `  <h2 id="toukei">そのまま引用できる数値（${ok.length}自治体の実測・CSV配布）</h2>
  <p>障害者控除対象者認定の基準は自治体ごとにバラバラに公表されていて、全国を横断して数えた統計は
  当サイトが探した範囲では国の統計にも見当たりません。以下は当サイトが各自治体の例規・公開ページを読み取って数えた結果を、
  <strong>一文で意味が通る形</strong>に並べたものです。すべて上の表と同じ出典から出しており、推定・補完はしていません。</p>
  <ul class="facts">
${facts.map((f) => `  <li>${f}</li>`).join('\n')}
  </ul>
  <p class="note"><strong>集計の範囲（N）：</strong>全国${all.length}市区町村（うち判定ランクを読み取れたもの ${ok.length}／公表なしと確認できたもの ${notPublished.length}／未読取 ${unread.length}）。
  <strong>データ読み取り日：</strong>${AS_OF}。<strong>更新頻度：</strong>例規データの再取得に合わせて自動で数え直しています。
  ／ <strong><a href="../data/shogai-kojo-kijun.csv" download>全${all.length}自治体のCSVをダウンロード</a></strong>（UTF-8・${csvRows.length - 1}行）</p>

  <h2>このデータについて（引用・転載）</h2>
  <p>この一覧は、自治体ごとにバラバラに公表されている障害者控除対象者認定の基準を、当サイトが横断して整理した一次まとめです。
  <strong>出典を明記していただければ、数字・表・CSVの引用と転載は自由です</strong>（リンクの有無は問いません）。
  推奨する記載例：<strong>「出典: フクシル（障害者控除対象者認定の基準・自治体別） https://fukushiru.com/shogai-kojo/」</strong>。
  基準は自治体の改正で変わるため、<strong>読み取り日（${AS_OF}）も併せて記載</strong>いただけると読者に親切です。
  記事・書籍・研修資料・ケアマネジャーや税理士の実務でご自由にお使いください。
  数字の誤り・古くなった値を見つけられた場合はご連絡ください。確認して直します。</p>
`

const prefBlocks = [...byPref.entries()].map(([pref, list]) => {
  const rows = list.map((r) => {
    const has = /読めた/.test(r.status)
    const linked = has || r.status === '判定ランクを公表していない'
    const cell = has ? `<td>${esc(fmt(r.shogai))}</td><td>${esc(fmt(r.tokubetsu))}</td>`
      : r.status === '判定ランクを公表していない' ? '<td colspan="2" class="no">この自治体は判定ランクを公表していません</td>'
        : `<td colspan="2"><small>当サイトでは読み取れていません（<a href="${esc(r.sourceUrl || r.url)}" rel="nofollow">原文</a>）</small></td>`
    return `<tr><th>${linked ? `<a href="./${r.code}.html">${esc(r.city)}</a>` : esc(r.city)}</th>${cell}</tr>`
  }).join('')
  return `<h3>${esc(pref)}<small>（${list.length}自治体）</small></h3>
<div class="table-wrap"><table><thead><tr><th>市区町村</th><th>障害者になる下限</th><th>特別障害者になる下限</th></tr></thead><tbody>${rows}</tbody></table></div>`
}).join('\n')

const hubBody = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 障害者控除の認定基準（自治体別）</p>
  <h1>障害者控除対象者認定の基準は、街によってこれだけ違う</h1>
  <p class="updated">最終更新：${LATEST} ／ ${all.length}自治体を収録（うち基準を読み取れたもの ${ok.length}）</p>

  <p class="lead">65歳以上で要介護認定を受けている方は、<strong>障害者手帳がなくても</strong>市区町村の認定を受ければ
  所得税・住民税の障害者控除が使えます。ところが<strong>その認定基準は市区町村がそれぞれ決めており、全国で統一されていません</strong>。
  同じ状態の親を持っていても、住んでいる街によって<strong>40万円の控除・27万円の控除・対象外</strong>に分かれます。
  当サイトは各自治体が公表している例規・ページを読み取って、その違いを並べました。</p>

  <div class="callout point"><p><span class="tag">この記事の要点</span>
  同じ「認知症高齢者の日常生活自立度Ⅲ」の人でも、<strong>${countAt('Ⅲa', NINCHI, 'ninchi').tokubetsu}自治体では特別障害者（40万円）、${countAt('Ⅲa', NINCHI, 'ninchi').shogai}自治体では障害者どまり（27万円）、${countAt('Ⅲa', NINCHI, 'ninchi').none}自治体では対象外</strong>です。
  ご自身の街の基準を下の一覧から確認してください。</p></div>

  <h2>同じ状態の人が、街によってどう分かれるか</h2>
  <div class="table-wrap"><table>
  <thead><tr><th>本人の状態</th><th>特別障害者<br><small>40万円</small></th><th>障害者<br><small>27万円</small></th><th>対象外</th></tr></thead>
  <tbody>${headline}</tbody></table></div>
  <p class="note">それぞれの物差しを使っている自治体の中での内訳です（認知症度 ${usersOf('ninchi').length}自治体／要介護度 ${usersOf('kaigo').length}自治体）。
  自治体によって、要介護度で決めるところ・日常生活自立度で決めるところ・両方を使うところがあります。</p>

  <h2>大都市ほど、基準が公表されていない</h2>
  <p>政令指定都市18市のうち、実際の判定ランクを公表していたのは<strong>2市だけ</strong>でした（${AS_OF_SEIREI}時点、当サイトが公開ページを確認した範囲）。
  多くの大都市は「知的障害者（軽度・中度）に準ずる方」といった区分までは示しますが、どのランクから対象かは書いていません。
  人口の多い街ほど、事前に自分が対象か調べにくい状態です。</p>

${citeBlock}  <h2>自治体別の一覧</h2>
  <p class="note">「下限」は、その値<strong>以上</strong>であれば対象になり得るという意味です。表に無い自治体は、例規を公表していないか、当サイトがまだ収録できていません。</p>
${prefBlocks}

  <div class="callout point"><p><span class="tag">手続きまで進めるなら</span>
  この一覧で分かるのは「基準」までです。実際に認定書をもらって過去5年分をさかのぼるには、
  親御さんの自立度ランクが書かれた書類を取り寄せ、還付額を試算し、更正の請求か還付申告を出す必要があります。
  その手順をお住まいの市区町村の基準に合わせてまとめた手引きを用意しています（500円）。
  <strong>買わなくても手続きはできます。</strong>
  → <a href="../pack/">5年分さかのぼる手順を見る（500円）</a></p></div>

  <div class="sources">
  <h2>この一覧の作り方と限界</h2>
  <ul>
  <li>各自治体が公表している例規（要綱・規則など）とWebページを読み取っています。<strong>条文の写しは載せず、判定ランクの下限だけ</strong>を並べています。原文へのリンクは各自治体のページにあります。</li>
  <li>ほとんどの自治体には<strong>「その他長が認めるもの」という裁量条項</strong>があります。運用は外から見えないため、数値化していません。<strong>下限に届いていなくても認定されることがあります。</strong></li>
  <li>読み取れなかった自治体を「公表していない」とは書いていません。<strong>1件ずつ確認して公表がないと分かったものだけ</strong>そう表示しています。</li>
  <li>収録 ${all.length}自治体のうち、基準を読み取れたのは ${ok.length}、公表がないと確認できたのは ${notPublished.length}、当サイトが読み取れていないものが ${unread.length} です。</li>
  <li>国税庁<a href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1185.htm" rel="nofollow">タックスアンサー No.1185</a>／厚生労働省「障害者控除に係る『認定書』の交付事務について」</li>
  </ul>
  <p class="disclaimer">当サイトは各自治体とは関係のない個人が運営しています。制度の適用可否は必ずお住まいの市区町村の窓口でご確認ください。誤りのご指摘は歓迎します。</p>
  </div>


  <p class="related"><a href="../articles/shogaisha-kojo-tax.html">→ 障害者控除で税金はいくら安くなるのか</a></p>
`
fs.writeFileSync(path.join(OUT, 'index.html'), page({
  title: `障害者控除対象者認定の基準｜全国${ok.length}自治体を比較（要介護・認知症）｜フクシル`,
  desc: `要介護認定を受けている65歳以上は、障害者手帳がなくても市区町村の認定で所得税27万円・特別障害者40万円の控除が使えます。ところが認定基準は市区町村ごとにバラバラ。全国${all.length}自治体の判定ランクの下限を、根拠リンクつきで比較しました。`,
  canonical: '/shogai-kojo/', depth: 1, body: hubBody,
  jsonld: {
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: '障害者控除対象者認定の自治体別 認定基準',
    description: `全国${all.length}市区町村について、障害者控除対象者認定の判定ランク（障害高齢者の日常生活自立度・認知症高齢者の日常生活自立度・要介護度）の下限を、各自治体の公表資料から読み取ったもの。`,
    inLanguage: 'ja', dateModified: LATEST, creator: { '@type': 'Organization', name: 'フクシル' },
  },
}))
// ── ③ 取り残しを消す ────────────────────────────────────────────────────────
// ★上書きだけでは、条件から外れた自治体のページが本番に残り続ける。
//   パーサを直すと「前は読めたが今回は弾いた」自治体が出るので、毎回起きる。
//   実際に1回目→2回目で8ページが取り残された（sitemapからは消えるので、
//   誰にも見つからないまま古い数字を出し続ける面になる）。[[build-must-prune-stale-pages]]
const keep = new Set(['index.html', ...[...ok, ...notPublished].map((r) => `${r.code}.html`)])
let pruned = 0
for (const f of fs.readdirSync(OUT)) {
  if (keep.has(f)) continue
  fs.unlinkSync(path.join(OUT, f))
  pruned++
}

// ── ④ sitemap.xml を更新する ───────────────────────────────────────────────
// ★この艦の sitemap は手書きで育ててきたもの。作り直さない。
//   /shogai-kojo/ のぶんだけ入れ替える（毎回消してから足すので何度回しても増えない）。
//   [[stale-production-build-drift]] 生成したのに sitemap に載っていない面は、
//   索引されないまま残る。ここを忘れると416ページが丸ごと無かったことになる。
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
sm = sm.replace(/^\s*<url>(?:(?!<\/url>)[\s\S])*\/shogai-kojo\/[\s\S]*?<\/url>\n?/gm, '')
// lastmod もビルド日にしない。取り直していない面まで「今日更新した」と申告すると、
// 毎回の再クロールを促しておいて中身が同じ、という信号を送り続けることになる。
const urls = [`  <url><loc>${SITE}/shogai-kojo/</loc><lastmod>${LATEST}</lastmod><priority>0.9</priority></url>`]
  .concat([...ok, ...notPublished].map((r) =>
    `  <url><loc>${SITE}/shogai-kojo/${r.code}.html</loc><lastmod>${readAt(r)}</lastmod><priority>0.6</priority></url>`))
sm = sm.replace('</urlset>', urls.join('\n') + '\n</urlset>')
fs.writeFileSync(smPath, sm)
const total = (sm.match(/<url>/g) || []).length

console.log(`自治体別 ${made}ページ ＋ 比較表1ページ → shogai-kojo/（取り残し ${pruned}件を削除）`)
console.log(`sitemap.xml: 全${total}件（うち今回のぶん ${urls.length}）`)
