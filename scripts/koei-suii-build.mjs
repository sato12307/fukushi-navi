// ─────────────────────────────────────────────────────────────────────────────
// koei-suii-build.mjs — 市営住宅の倍率の推移の看板（/koei/bairitsu-suii/）と、市別の記事が読む data/koei-suii.json を作る。
//
//   node scripts/koei-suii-build.mjs          # 看板と data/koei-suii.json を書き、sitemap の1行を足す
//   python tools/build_koei_cities.py         # 市別の記事（articles/koei-<市>.html）に推移の節を入れる（data/koei-suii.json を読む）
//
// ★なぜ（2026-10-04 第169回の生存2本目・ユーザー裁定 v297）
//   実際に来ている語：「札幌市営住宅 倍率 推移」「福岡市営住宅 前回募集時の倍率」「横浜市営住宅 c組でも落選 何年で当選できるの」。
//   前の回まで何回・どれくらいの倍率だったかを、市ごとに1枚で見比べられる面がサイトに無かった。
// ★出すのは実際の倍率だけ（最小・中央値・最大・回ごと）。推計（何回で当たるか・当選の見込み）は出さない。
// ★載せるのは公表の合計と1件まで合った回だけ（数え方は scripts/koei-suii-lib.mjs）。
// ★手書きに近い1枚なので Google にも見せる（stamp-google-noindex.mjs の型の面ではない）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE, readPrev, pageDiff, writePage, readSitemap, writeSitemap } from './shogai-kojo-page.mjs'
import { suiiAll, suiiSummary, suiiTable, suiiDropped, yokohamaYugu, YOKOHAMA_YUGU, SMALL } from './koei-suii-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const f1 = (x) => Number(x).toFixed(1)

const all = suiiAll()
const shown = all.filter((s) => s.stats && s.stats.n >= 3)
const notShown = all.filter((s) => !(s.stats && s.stats.n >= 3))
if (!shown.length) { console.error('載せられる市がありません'); process.exit(1) }

// ── data/koei-suii.json（市別の記事＝Python の生成器が読む。公開してよい回ごとの合計だけ）──────────
const json = {
  _doc: '市営住宅の募集回ごとの回全体の倍率（応募者数÷募集戸数）。公表の合計と当方の読み取りが1件まで合った回だけ。作り方は scripts/koei-suii-lib.mjs。推計は持たない。',
  updated: today,
  hub: '/koei/bairitsu-suii/',
  cities: all.map((s) => ({
    key: s.key, city: s.city, boshu: s.boshu || '', publisher: s.publisher || '', doc: s.doc || '',
    face: s.face || null, article: s.article || null, excluded: s.excluded || null,
    rounds: s.rounds.map((r) => ({ round: r.round, label: r.label, koho: r.koho, mo: r.mo, bairitsu: r.bairitsu, ...(r.sub ? { sub: r.sub } : {}) })),
    dropped: s.dropped, stats: s.stats, allRounds: s.allRounds || 0,
    ...(s.checkNote ? { checkNote: s.checkNote } : {}), ...(s.articleNote ? { articleNote: s.articleNote } : {}), ...(s.articleLink ? { articleLink: s.articleLink } : {}),
    ...(s.key === 'yokohama' ? { yugu: YOKOHAMA_YUGU } : {}),
  })),
}
const jsonPath = path.join(ROOT, 'data', 'koei-suii.json')
const jsonText = JSON.stringify(json, null, 1) + '\n'
// 日付だけの差（と改行だけの差）では書き直さない（lastmod を動かさない）
const strip = (t) => t.replace(/"updated": "[^"]*"/, '')
const jsonKind = pageDiff(readPrev(jsonPath), jsonText, strip)
if (jsonKind !== 'same') fs.writeFileSync(jsonPath, jsonText)

// ── 看板 ────────────────────────────────────────────────────────────────────
const rank = shown.slice().sort((a, b) => b.stats.med - a.stats.med)
const names = rank.map((s) => s.city.replace(/市$/, '')).join('・')
const faceLink = (s) => [
  s.face ? `<a href="../..${s.face}">${esc(s.city)}営住宅の申込先えらび（区分・申込先ごとの相場）</a>` : '',
  s.article ? `<a href="../../articles/${s.article}.html">${esc(s.city)}の市営住宅 当選倍率（住戸別の実例）</a>` : '',
].filter(Boolean).join('／')

// ★列は3つまで（320px で横にはみ出さない・ハブ記事の表と同じ作り）。直近の回と載せた回は折り返しの行へ。
const rankTable = `  <div class="table-wrap">
  <table class="tbl" style="min-width:0">
  <thead><tr><th>市</th><th>中央値</th><th>最小〜最大</th></tr></thead>
  <tbody>
${rank.map((s) => `  <tr><th><a href="#${s.key}">${esc(s.city)}</a></th><td><strong>${f1(s.stats.med)}倍</strong></td><td>${f1(s.stats.min)}〜${f1(s.stats.max)}倍</td></tr>
  <tr><td colspan="3" style="font-size:.85em;color:var(--sub);white-space:normal">載せた回 ${s.stats.n}回（${esc(s.stats.first)}〜${esc(s.stats.last)}）／直近の${esc(s.stats.last)}は${f1(s.stats.latest)}倍</td></tr>`).join('\n')}
  </tbody></table>
  </div>`

const citySection = (s) => `  <h2 id="${s.key}">${esc(s.city)}営住宅：前の回までの倍率</h2>
  <p>${suiiSummary(s)}</p>
${suiiTable(s)}
  <p ${SMALL}>出典＝${esc(s.publisher)}の${esc(s.doc)}。${s.checkNote ? esc(s.checkNote) : '載せたのは、資料の合計（募集戸数・応募者数）と当方の読み取りが<strong>1件まで合った回だけ</strong>です。'}</p>
${suiiDropped(s)}
${s.key === 'yokohama' ? `  <h3>横浜市の優遇（特認組）の決まり</h3>\n${yokohamaYugu()}\n` : ''}${faceLink(s) ? `  <p>${faceLink(s)}</p>\n` : ''}`

const body = `  <p class="breadcrumb"><a href="../../index.html">トップ</a> ＞ <a href="../../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ 市営住宅の倍率の推移</p>

  <h1>市営住宅の倍率は、前の回までどう動いたか<br><small>${esc(names)}の募集回ごとの実際の倍率（公表の合計と1件まで合った回だけ）</small></h1>
  <p class="updated">最終更新：${today} ／ 出典＝各市（または住宅供給公社）が募集回ごとに公表する応募状況・抽選結果の資料</p>

  <p class="lead">「前回の倍率は何倍だったか」「ここ数年で上がっているのか」を、市ごとに募集回を並べて見比べられるようにしました。数字は<strong>その回の応募者数の合計÷募集戸数の合計（回全体の倍率）</strong>で、市（または住宅供給公社・住宅管理公社）が公表した合計と当方の読み取りが<strong>1件まで合った回だけ</strong>を載せています。合わなかった回は、市ごとの表の下に回と理由を書いています。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>${rank.map((s) => `${esc(s.city)}は${s.stats.n}回で<strong>${f1(s.stats.min)}〜${f1(s.stats.max)}倍</strong>（中央値${f1(s.stats.med)}倍）`).join('、')}でした。</p>
  </div>

  <h2 id="rank">市ごとの比較（回全体の倍率の中央値が高い順）</h2>
${rankTable}
  <p ${SMALL}>市によって募集の回数・区分の分け方・資料の作りが違うので、中央値の差がそのまま「入りやすさの差」ではありません。同じ市の中でも、区分や住宅で倍率はこの数字よりずっと高いことも低いこともあります。</p>

${rank.map(citySection).join('\n')}
  <h2 id="nashi">載せていない市と理由</h2>
  <ul>
${notShown.map((s) => `  <li><strong>${esc(s.city)}</strong>：${esc(s.excluded || (s.why || '公表の合計と合った回が3回に満たないため'))}${s.face ? `（区分ごとの相場は<a href="../..${s.face}">${esc(s.city)}営住宅の申込先えらび</a>にあります）` : ''}</li>`).join('\n')}
  </ul>

  <h2 id="genkai">この数字の読み方と限界</h2>
  <ul>
  <li>出しているのは<strong>過去の実際の倍率</strong>だけです。「何回申し込めば当たるか」「当選の見込み」は計算していません。倍率は回ごとに動き、優遇（当選率の優遇・落選回数や連続申込の優遇など）の有無と倍数は申込者ごとに違うためです。</li>
  <li>回全体の倍率は、単身向け・世帯向け・高齢者向けなどの区分をすべて合わせた数字です。申込みの資格は区分ごとに違い、倍率も区分でまるで違います。</li>
  <li>倍率は資料の倍率の列を読まず、<strong>応募者数の合計÷募集戸数の合計</strong>で当方が計算しています（小数第1位まで）。</li>
  <li>当サイトは各市・住宅供給公社とは関係のない個人が運営しています。募集の有無・資格・日程は、必ずその回の公式の募集案内でご確認ください。</li>
  </ul>
  <p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</p>`

const title = `市営住宅の倍率の推移（${names}）｜募集回ごとの実際の倍率｜フクシル`
const desc = `市営住宅の募集回ごとの倍率（応募者数÷募集戸数）を、${names}について並べました。${rank.map((s) => `${s.city}${s.stats.n}回で${f1(s.stats.min)}〜${f1(s.stats.max)}倍`).join('、')}。市や公社が公表した合計と1件まで合った回だけを載せています。`
const html = page({
  title, desc, canonical: '/koei/bairitsu-suii/', depth: 2, body,
  jsonld: {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: '市営住宅の倍率は、前の回までどう動いたか', inLanguage: 'ja', url: `${SITE}/koei/bairitsu-suii/`,
    datePublished: '2026-10-04', dateModified: today,
    author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' },
  },
})
const out = path.join(ROOT, 'koei', 'bairitsu-suii', 'index.html')
// 日付（最終更新・dateModified）だけの差は「同じ」と数えて書き直さない。改行と計測の埋め込みだけの差は書き直すが、
// lastmod も面の日付も前のまま残す（sitemap と面の「最終更新」を食い違わせない）。比べ方は shogai-kojo-page.mjs の pageDiff（2026-10-08）。
// ★2026-10-11 この書き出し方を shogai-kojo-page.mjs の writePage に移し、面に日付を入れるほかの生成器と共通にした。
const DATES = [/最終更新：\d{4}-\d{2}-\d{2}/, /"dateModified": "[^"]*"/]
const kind = writePage(out, html, DATES)
const changed = kind === 'changed'

// ── sitemap（中身が変わったときだけ lastmod を進める）────────────────────────────
// ★読み書きは shogai-kojo-page.mjs の readSitemap・writeSitemap（改行を LF にそろえる・2026-10-11）
{
  const sm = readSitemap()
  const loc = `${SITE}/koei/bairitsu-suii/`
  const entry = `<url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`
  const re = new RegExp(`<url><loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`)
  let next = sm
  if (!re.test(sm)) next = sm.replace('</urlset>', `  ${entry}\n</urlset>`)
  else if (changed) next = sm.replace(re, entry)
  writeSitemap(next)
}

console.log(`■ 看板 /koei/bairitsu-suii/ ${changed ? '書き出し' : kind === 'embed' ? '計測の埋め込みだけ書き直し・lastmod は据え置き' : '変化なし'}（載せた市 ${shown.length}：${rank.map((s) => `${s.city}${s.stats.n}回`).join('・')}）`)
console.log(`  載せていない市：${notShown.map((s) => s.city).join('・') || 'なし'}`)
console.log(`  data/koei-suii.json ${jsonKind !== 'same' ? '書き出し' : '変化なし'}`)
