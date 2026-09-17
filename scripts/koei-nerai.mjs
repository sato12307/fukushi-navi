// ─────────────────────────────────────────────────────────────────────────────
// koei-nerai.mjs — 政令市の「申込先えらび」の無料ページと有料資料を作る。
//
//   node scripts/koei-nerai.mjs kawasaki
//   node scripts/koei-nerai.mjs shizuoka yokohama     # まとめて
//   node scripts/koei-nerai.mjs --all
//
// ★何を売って、何を売らないか（都営・川崎と同じ線）
//   売らない: 申込資格・収入基準・制度の説明。募集の日程。混んでいる申込先の実名。
//             軸ごとの相場（区や募集区分）も無料。住宅を選ぶ前に効く話なので。
//   売る:     募集回をまたいで名寄せしたうえでの「毎回すいている申込先はどこか」。
//             1回だけ空いた住宅と、いつ見ても空いている住宅は意思決定がまるで違う。
//             市は回ごとの資料しか出さず、横に並べた集計はどこにも無い。
//
// ★出典側への配慮
//   公表表の行をそのまま並べ直したものは作らない。出すのは当方が計算した指標
//   （中央値・最低・最高・観測件数・申込者ゼロの回数）だけで、どの回にいくつ申し込みが
//   あったかという公表表の中身は再現しない。出所は無料ページ・有料資料の両方に明記する。
//
// ★読み取りの限界をそのまま持ち越す。「読めなかった」を「空いていた」に混ぜない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { offerKoeiLeaf, jumpKoei } from './offer-block.mjs'
import { load, CITIES, MIN_N, SUKI, BURE, MIN_GROUP, PRICE, r1, num, pct, WA } from './koei-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const keys = args.includes('--all') ? Object.keys(CITIES) : args.filter((a) => !a.startsWith('-'))
if (!keys.length) {
  console.error('市を指定してください: node scripts/koei-nerai.mjs kawasaki shizuoka yokohama ／ --all')
  process.exit(1)
}

const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }
const tw = (inner) => `  <div class="table-wrap">\n${inner}\n  </div>`
const tbl = (head, body) => tw(`  <table class="grid">\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${body}\n  </tbody></table>`)

for (const key of keys) {
  const D = load(key)
  const { C, F, RANGE, READ_AT, INDEX_URL, SRC_NAME, enough, suki, buread, konde, shownGroups, BY_ROUND } = D
  const pending = []
  const write = (rel, html) => pending.push([rel, html])

  // ── 軸ごとの相場（無料）──────────────────────────────────────────────────
  const groupTable = tbl(
    `<th>${esc(C.axis.label)}</th><th class="num">観測できた募集</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">${SUKI}倍未満</th>`,
    shownGroups.map((g) => `  <tr><th scope="row">${esc(g.label)}</th><td class="num">${num(g.n)}件</td><td class="${g.med < SUKI ? 'lo' : 'num'}">${g.med}倍</td><td class="num">${pct(g.zero, g.n)}%</td><td class="num">${g.houses}件</td><td class="num">${g.suki}件</td></tr>`).join('\n'))
  const LO = shownGroups[0]
  const HI = shownGroups[shownGroups.length - 1]
  const RATIO = Math.round(HI.med / Math.max(LO.med, 0.1))

  // ── 表の部品（有料資料と、売り場の抜粋の両方で使う）──────────────────────
  const TH = C.cols.map(([, label]) => `<th>${esc(label)}</th>`).join('') +
    '<th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th class="num">のべ戸数</th><th class="num">最後の募集</th>'
  const hrow = (h) => '<tr>' + C.cols.map(([f]) => `<td>${esc(h[f] || '')}</td>`).join('') +
    `<td class="num">${r1(h.med)}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td class="num">${h.koho}</td><td class="num">${WA(h.last)}</td></tr>`
  const table = (list) => `<table class="grid"><thead><tr>${TH}</tr></thead><tbody>\n${list.map(hrow).join('\n')}\n</tbody></table>`

  const SEC2_TITLE = `2. 毎回すいている申込先（${num(F.suki)}件）`
  const SEC2_LEAD = `${MIN_N}件以上観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを載せています。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。倍率の低い順。`
  const sukiByGroup = shownGroups.map((g) => {
    const list = suki.filter((h) => h.axis === g.label).sort((a, b) => a.med - b.med || b.n - a.n)
    return list.length ? `  <h3>${esc(g.label)}（${list.length}件）</h3>\n  <div class="wrap">${table(list)}</div>` : ''
  }).filter(Boolean).join('\n')
  if (!sukiByGroup) die(`${C.city}：すいている申込先が1件もありません。読み取りが壊れていないか確かめてください。`)

  // ── 混んでいる申込先（実名・無料）───────────────────────────────────────
  const kondeTable = tbl(
    C.cols.slice(0, 3).map(([, l]) => `<th>${esc(l)}</th>`).join('') + '<th class="num">中央値</th><th class="num">最高</th><th class="num">観測</th>',
    konde.slice(0, 12).map((h) => '  <tr>' + C.cols.slice(0, 3).map(([f]) => `<td>${esc(h[f] || '')}</td>`).join('') +
      `<td class="hi">${r1(h.med)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n'))

  const roundTable = tbl(
    '<th>募集回</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th>',
    BY_ROUND.map((r) => `  <tr><th scope="row">${WA(r.round)}</th><td class="num">${r.n}件</td><td class="num">${num(r.koho)}戸</td><td class="num">${r.med}倍</td><td class="${r.zero ? 'lo' : 'num'}">${r.zero}件</td></tr>`).join('\n'))

  // ── 限界の説明（無料ページと有料資料で同じ文を使う）──────────────────────
  const skipped = F.skippedRounds.length
    ? `使えなかった${F.skippedRounds.length}回（${F.skippedRounds.map(WA).join('・')}）は、PDFから住宅名を取り出せませんでした。`
    : ''
  const checked = F.matched
    ? `読み取りは公表表の合計と突き合わせています。<strong>${F.matched}回は合計まで一致</strong>${F.explained ? `、残り${F.explained}回の差は<strong>住宅名がPDFに入っていない行（合計${F.noNameRows}件・${F.noNameKoho}戸）</strong>でちょうど説明がつきます。その行は住宅が分からないので集計に入れていません` : ''}。`
    : (F.noNameRows ? `住宅名がPDFに入っていない行が${F.noNameRows}件あり、住宅が分からないので集計に入れていません。` : '')
  const LIMITS = `  <li>出典＝${esc(SRC_NAME)}（${RANGE}）。読み取り日 ${READ_AT}。<a href="${INDEX_URL}" rel="nofollow">回ごとの公表ページ</a>は${esc(C.city)}（または指定管理者）が公開しています。</li>
  <li>市が公開している${F.allRounds ? `<strong>${F.allRounds}回</strong>のうち、` : ''}<strong>${F.rounds}回</strong>を使っています。${skipped}</li>
${checked ? `  <li>${checked}</li>\n` : ''}  <li>倍率は公表表の倍率の列を読まず、<strong>応募者数÷募集戸数</strong>で当方が計算しています（公表表では倍率が住宅名の行からずれて出るため）。</li>
  <li>「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の区分・住戸が募集されることがあり、その1件ずつを数えています。</li>
  <li>${esc(C.note)}</li>
  <li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
  <li>当サイトは${esc(C.city)}とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>`

  // ── 売り場のカード ──────────────────────────────────────────────────────
  //   抜粋は有料資料の本文からそのまま切る。下で突き合わせて、違えば止める。
  const PEEK_ROWS = 3
  const peekGroup = shownGroups.find((g) => suki.some((h) => h.axis === g.label))
  const peekList = suki.filter((h) => h.axis === peekGroup.label).sort((a, b) => a.med - b.med || b.n - a.n)
  const PEEK = `    <h4 class="pk">${SEC2_TITLE}</h4>
    <p>${SEC2_LEAD}</p>
    <h4 class="pk">${esc(peekGroup.label)}（${peekList.length}件）</h4>
    <div class="table-wrap"><table style="white-space:nowrap">
    <thead><tr>${TH}</tr></thead>
    <tbody>
${peekList.slice(0, PEEK_ROWS).map((h) => `    ${hrow(h)}`).join('\n')}
    </tbody></table></div>`
  const facts = {
    price: PRICE, city: C.city, rounds: F.rounds, minN: MIN_N, suki: SUKI,
    sukiN: num(F.suki), bureN: F.buread, enoughN: num(F.enough), key: C.key,
    axis: C.axis.label, only: C.only || `${C.city}営住宅だけ`,
  }
  const OFFER = offerKoeiLeaf({ up: '../', peek: PEEK, facts })

  // ── 無料ページ ──────────────────────────────────────────────────────────
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ ${esc(C.city)}営住宅 申込先えらび</p>

  <h1>${esc(C.city)}営住宅で「毎回すいている申込先」はどこか<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を申込先ごとに名寄せした実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝${esc(C.city)}が公表する応募状況表${F.rounds}回分の読み取り</p>

  <p class="lead">${esc(C.city)}は募集回ごとに応募状況を出していますが、<strong>回をまたいで「どの申込先が毎回すいているか」を並べた資料は公表していません</strong>。1回だけたまたま空いた住宅と、いつ見ても空いている住宅は、申し込む側にとってまったく別のものです。ここでは${F.rounds}回分を読み直して、申込先ごとに名寄せしました。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>観測できた募集は<strong>${num(F.rows)}件</strong>、申込先で<strong>${num(F.all)}件</strong>。${MIN_N}件以上観測できた<strong>${num(F.enough)}件</strong>の倍率の中央値は<strong>${F.allMed}倍</strong>で、<strong>${F.suki}件（${F.sukiPct}%）</strong>が${SUKI}倍未満でした。申込者ゼロの募集は<strong>${num(F.zeroRows)}件・${F.zeroHouses}住宅</strong>で出ています。</p>
  </div>

${jumpKoei(facts)}

  <h2 id="axis">① まず「${esc(C.axis.label)}」で倍率が変わる（無料）</h2>
  <p>個々の住宅を選ぶ前に、ここを確かめてください。${RANGE}の全${num(F.rows)}件を${esc(C.axis.label)}ごとに分けると、<strong>${esc(LO.label)}の中央値${LO.med}倍に対して${esc(HI.label)}は${HI.med}倍</strong>で、<strong>${RATIO}倍</strong>ひらいています。申込先が${MIN_GROUP}件以上ある${esc(C.axis.label)}だけを倍率の低い順に並べました。</p>
${groupTable}

  <h2 id="pack">② 申込先ごとの一覧（${PRICE}円）</h2>
  <p class="offer-lead"><strong>申込書に書けるのは基本的に1回につき1つ</strong>です。${esc(C.axis.label)}ごとの相場が分かっても、最後は申込先を1つに決めることになります。そこだけは申込先ごとの実測が要ります。</p>
${OFFER}

  <h2 id="konde">③ 混んでいる申込先（実名・無料）</h2>
  <p>避けるべき相手も無料で出します。${MIN_N}件以上観測できた申込先を、倍率の中央値が高い順に12件。</p>
${kondeTable}

  <h2 id="round">④ 募集回ごとの相場（無料）</h2>
  <p>倍率は回によって動きます。どの回が狙い目だったかの目安。</p>
${roundTable}

  <h2>出典と、この数字の限界</h2>
  <ul>
${LIMITS}
  </ul>
  <p class="note"><strong>「倍率が低い＝誰でも入れる」ではありません。</strong>申込資格（市内在住・収入基準・住宅困窮要件など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数・間取り・入居人数の条件が変わります。<strong>過去にあまった住宅が次回も募集に出るとはかぎりません。</strong>申し込む前に、その回の募集案内で必ず条件を確認してください。</p>
  <p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</p>`

  write(`${C.key}/index.html`, page({
    title: `${C.city}営住宅で毎回すいている申込先はどこか｜定期募集${F.rounds}回の実測｜フクシル`,
    desc: `${C.city}営住宅の応募状況表${F.rounds}回分（${RANGE}）を申込先ごとに名寄せしました。観測できた募集${num(F.rows)}件、倍率の中央値は${F.allMed}倍で、${MIN_N}件以上観測できた${num(F.enough)}件のうち${F.suki}件が${SUKI}倍未満。${C.axis.label}ごとの相場と混んでいる申込先の実名は無料、申込先ごとの一覧は${PRICE}円です。`,
    canonical: `/${C.key}/`, depth: 1, body,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: `${C.city}営住宅で毎回すいている申込先はどこか`,
      inLanguage: 'ja', url: `${SITE}/${C.key}/`,
      datePublished: READ_AT, dateModified: READ_AT,
      author: { '@type': 'Organization', name: 'フクシル' },
      publisher: { '@type': 'Organization', name: 'フクシル' },
    },
  }))

  write(`${C.key}/kanryo/index.html`, page({
    title: 'ご購入ありがとうございます｜フクシル', desc: `${C.city}営住宅 申込先えらびのダウンロード`,
    canonical: `/${C.key}/kanryo/`, depth: 2, noindex: true,
    body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">下のボタンから資料をダウンロードしてください。購入から60日間は同じリンクで何度でも落とせます。</p>
  <p class="buyrow"><a class="btn-primary" id="dl" href="#">資料をダウンロード</a></p>
  <p class="fine">うまく落とせない・中身が説明と違う場合は、購入から14日以内に contact@fukushiru.com までご連絡ください。全額返金します。</p>
  <script>
  (function () {
    var s = new URLSearchParams(location.search).get('session_id')
    var a = document.getElementById('dl')
    if (!s) { a.textContent = '購入の確認ができません（session_id がありません）'; a.removeAttribute('href'); return }
    a.href = '/api/download?product=${C.key}&session_id=' + encodeURIComponent(s)
  })()
  </script>`,
  }))

  // ── 有料資料 ────────────────────────────────────────────────────────────
  const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(C.city)}営住宅 申込先えらび（定期募集${F.rounds}回の実測）｜フクシル</title>
<style>
body{font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;line-height:1.75;color:#182028;max-width:960px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 .3em}h1 small{display:block;font-size:.95rem;font-weight:400;color:#566;margin-top:.4em}
h2{font-size:1.2rem;margin:2em 0 .5em;padding-bottom:.25em;border-bottom:2px solid #1f6f78}
h3{font-size:1.02rem;margin:1.5em 0 .4em;color:#1a5a62}
.lead{color:#566;font-size:.92rem}
.box{border:1px solid #d7dee2;border-radius:8px;padding:12px 16px;margin:1.2em 0;background:#f7fafb}
.box.warn{background:#fff8f2;border-color:#f0d7c0}
.tag{display:inline-block;font-size:.74rem;font-weight:700;background:#1f6f78;color:#fff;padding:1px 9px;border-radius:999px;margin-right:6px}
.wrap{overflow-x:auto;margin:1em 0}
table.grid{border-collapse:collapse;width:100%;min-width:760px;font-size:.88rem}
table.grid th,table.grid td{border:1px solid #d7dee2;padding:6px 8px;text-align:left;vertical-align:top}
table.grid thead th{background:#eef4f5;white-space:nowrap}
table.grid td.num{text-align:right;white-space:nowrap}
.note{font-size:.86rem;color:#566}
@media print{body{max-width:none}h2{page-break-after:avoid}}
</style></head><body>
<h1>${esc(C.city)}営住宅 申込先えらび<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を申込先ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（${SITE}）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（市内在住・収入基準・世帯構成）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は${esc(C.city)}の募集案内でご確認ください。この資料は資格の判定をしません。
<strong>対象は${esc(facts.only)}</strong>で、都道府県営住宅や他市の市営住宅は入っていません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先 <strong>${num(F.all)}件</strong>。うち${MIN_N}件以上の募集が観測できた <strong>${num(F.enough)}件</strong>を集計の対象にしています。</li>
<li>${esc(C.note)}</li>
<li>その${num(F.enough)}件の倍率の中央値は <strong>${F.allMed}倍</strong>。中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${F.zeroHousesEnough}件</strong>。</li>
<li>最高と最低が${BURE}倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
</ul>

<h2>${SEC2_TITLE}</h2>
<p>${SEC2_LEAD}</p>
${sukiByGroup}

<h2>3. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が${BURE}倍以上ひらいた申込先です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}</div>

<h2>4. 申込者ゼロが出た申込先（${F.zeroHousesEnough}件）</h2>
<p>誰も申し込まなかった回がある申込先です。「申込0」の欄がその回数。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません。</p>
<div class="wrap">${table(enough.filter((h) => h.zero > 0).sort((a, b) => b.zero - a.zero || a.med - b.med))}</div>

<h2>5. ${esc(C.axis.label)}ごとの相場</h2>
<p>申込先が${MIN_GROUP}件以上ある${esc(C.axis.label)}だけ、倍率の低い順。どこで出せるかで${RATIO}倍変わります。</p>
<div class="wrap"><table class="grid"><thead><tr><th>${esc(C.axis.label)}</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">${SUKI}倍未満</th></tr></thead><tbody>
${shownGroups.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${num(g.n)}</td><td class="num">${num(g.koho)}</td><td class="num">${g.med}倍</td><td class="num">${pct(g.zero, g.n)}%</td><td class="num">${g.houses}</td><td class="num">${g.suki}</td></tr>`).join('\n')}
</tbody></table></div>

<h2>6. 観測できた申込先の索引（${num(F.enough)}件）</h2>
<p>中央値の低い順。上の各章に出ていない申込先もここには載っています。</p>
<div class="wrap">${table(enough)}</div>

<h2>7. 出典と限界</h2>
<ul>
${LIMITS}
</ul>
<p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。
開けない・説明と違う場合は購入から14日以内のご連絡で全額返金します。</p>
</body></html>
`
  write(`.dist/${C.key}-pack.html`, packHtml)

  // ── 関所：抜粋が有料資料の本文とそのまま一致するか ──────────────────────
  {
    const flat = (x) => x.replace(/<[^>]+>/g, '').replace(/\s/g, '')
    if (!flat(packHtml).includes(flat(PEEK))) die(`${C.city}：抜粋が有料資料の本文と一致しません（抜粋の作り方を確認）。`)
  }

  for (const [rel, html] of pending) {
    const p = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, html)
  }

  // ── sitemap（/<市>/ の1行。kanryo は購入者専用なので載せない）────────────
  {
    const smPath = path.join(ROOT, 'sitemap.xml')
    const sm = fs.readFileSync(smPath, 'utf8')
    const loc = `${SITE}/${C.key}/`
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    const entry = `<url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`
    const re = new RegExp(`<url><loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`)
    const next = re.test(sm) ? sm.replace(re, entry) : sm.replace('</urlset>', `  ${entry}\n</urlset>`)
    if (next !== sm) fs.writeFileSync(smPath, next)
  }

  console.log(`■ ${C.city}  /${C.key}/ と購入後画面・有料資料 .dist/${C.key}-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
  console.log(`   募集${num(F.rows)}件 → 申込先${F.all}件（${MIN_N}件以上観測 ${F.enough}件）`)
  console.log(`   すいている ${F.suki}件（${F.sukiPct}%）・ぶれる ${F.buread}件・申込0あり ${F.zeroHousesEnough}件`)
  console.log(`   軸＝${C.axis.label} ${F.groups}区分（面に出すのは ${shownGroups.length}）／ ${LO.label} ${LO.med}倍 ↔ ${HI.label} ${HI.med}倍 ＝ ${RATIO}倍`)
  console.log(`   読み取り: 使えた${F.rounds}回${F.skippedRounds.length ? ` ／ 使えない${F.skippedRounds.length}回（${F.skippedRounds.join('・')}）` : ''}${F.matched ? ` ／ 公表合計と一致${F.matched}回・差が説明できる${F.explained}回` : ''}`)
  console.log(`   次に: node scripts/koei-put-pack.mjs ${C.key}`)
}
