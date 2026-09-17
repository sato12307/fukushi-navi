// ─────────────────────────────────────────────────────────────────────────────
// kawasaki-nerai.mjs — 川崎市営住宅「申込先えらび」の無料ページ /kawasaki/ と有料資料を作る。
//
//   node scripts/kawasaki-nerai.mjs
//
// ★何を売って、何を売らないか（都営と同じ線）
//   売らない: 申込資格・収入基準・制度の説明。募集の日程。混んでいる住宅の実名。
//             募集区分ごとの相場も無料（どの枠で出すかは、住宅を選ぶ前に効く話なので）。
//   売る:     募集回をまたいで名寄せしたうえでの「毎回すいている申込先はどこか」。
//             1回だけ空いた住宅と、いつ見ても空いている住宅は意思決定がまるで違う。
//             川崎市は回ごとのPDFしか出さず、横に並べた集計はどこにも無い。
//
// ★出典側への配慮
//   公表表の行をそのまま並べ直したものは作らない。出すのは当方が計算した指標
//   （中央値・最低・最高・観測件数・申込者ゼロの回数）だけで、どの回にいくつ申し込みが
//   あったかという公表表の中身は再現しない。出所は無料ページ・有料資料の両方に明記する。
//
// ★読み取りの限界をそのまま持ち越す
//   29回のうち2回はPDFに日本語が入っておらず使えない。6回は公表の合計と差があり、
//   その差は「住宅名がPDFに入っていない行」で説明がつく。**どちらも面に書く。**
//   「読めなかった」を「空いていた」に混ぜない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { offerKawasakiLeaf, jumpKawasaki } from './offer-block.mjs'
import {
  MIN_N, SUKI, BURE, MIN_CAT, PRICE, SRC_NAME, INDEX_URL, READ_AT,
  rows, ledger, ROUNDS, med, r1, num, pct, WA,
  houses, enough, suki, buread, konde, CATS, BY_ROUND, F, RANGE,
} from './kawasaki-lib.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
const pending = []
const write = (rel, html) => pending.push([rel, html])
const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }

const tw = (inner) => `  <div class="table-wrap">\n${inner}\n  </div>`
const tbl = (head, body) => tw(`  <table class="grid">\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${body}\n  </tbody></table>`)

// ── 募集区分ごとの相場（無料）────────────────────────────────────────────────
const shownCats = CATS.filter((c) => c.houses >= MIN_CAT)
const catTable = tbl(
  '<th>募集区分</th><th class="num">観測できた募集</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">5倍未満</th>',
  shownCats.map((c) => `  <tr><th scope="row">${esc(c.label)}</th><td class="num">${num(c.n)}件</td><td class="${c.med < SUKI ? 'lo' : 'num'}">${c.med}倍</td><td class="num">${pct(c.zero, c.n)}%</td><td class="num">${c.houses}件</td><td class="num">${c.suki}件</td></tr>`).join('\n'))

const CAT_LO = shownCats[0]
const CAT_HI = shownCats[shownCats.length - 1]
const CAT_RATIO = Math.round(CAT_HI.med / Math.max(CAT_LO.med, 0.1))

// ── 混んでいる住宅（実名・無料）──────────────────────────────────────────────
const kondeTable = tbl(
  '<th>住宅</th><th>募集区分</th><th class="num">中央値</th><th class="num">最高</th><th class="num">観測</th>',
  konde.slice(0, 12).map((h) => `  <tr><th scope="row">${esc(h.name)}</th><td>${esc(h.kind)}／${esc(h.cat)}</td><td class="hi">${r1(h.med)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n'))

// ── 回ごと（無料）───────────────────────────────────────────────────────────
const roundTable = tbl(
  '<th>募集回</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th>',
  BY_ROUND.map((r) => `  <tr><th scope="row">${WA(r.round)}</th><td class="num">${r.n}件</td><td class="num">${num(r.koho)}戸</td><td class="num">${r.med}倍</td><td class="${r.zero ? 'lo' : 'num'}">${r.zero}件</td></tr>`).join('\n'))

// ── 限界の説明（無料ページと有料資料で同じ文を使う）──────────────────────────
const LIMITS = `  <li>出典＝${esc(SRC_NAME)}（${RANGE}）。読み取り日 ${READ_AT}。<a href="${INDEX_URL}" rel="nofollow">回ごとの抽選結果の一覧</a>は川崎市が公開しています。</li>
  <li>市が公開している<strong>${ROUNDS.length + F.skippedRounds.length}回</strong>のうち、<strong>${F.rounds}回</strong>を使っています。使えなかった${F.skippedRounds.length}回（${F.skippedRounds.map(WA).join('・')}）は、PDFに日本語の文字が入っておらず住宅名が取り出せませんでした。</li>
  <li>読み取りは公表表の合計と突き合わせています。<strong>${F.matched}回は合計まで一致</strong>、残り${F.explained}回の差は<strong>住宅名がPDFに入っていない行（合計${F.noNameRows}件・${F.noNameKoho}戸）</strong>でちょうど説明がつきます。その行は住宅が分からないので集計に入れていません。</li>
  <li>倍率は公表表の倍率の列を読まず、<strong>応募者数÷募集戸数</strong>で当方が計算しています（公表表では倍率が住宅名の行からずれて出るため）。</li>
  <li>「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の区分が募集されることがあり、その1件ずつを数えています。</li>
  <li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
  <li>当サイトは川崎市とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>`

// ── 有料資料の表の部品（売り場の抜粋も同じ関数から作るので先に置く）──────────
const hrow = (h) => `<tr><td>${esc(h.name)}</td><td>${esc(h.kind)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td class="num">${h.koho}</td><td class="num">${WA(h.last)}</td></tr>`
const TH = '<th>住宅</th><th>種別</th><th>募集区分</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th class="num">のべ戸数</th><th class="num">最後の募集</th>'
const table = (list) => `<table class="grid"><thead><tr>${TH}</tr></thead><tbody>\n${list.map(hrow).join('\n')}\n</tbody></table>`

const SEC2_TITLE = `2. 毎回すいている申込先（${num(F.suki)}件）`
const SEC2_LEAD = `${MIN_N}件以上観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを載せています。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。倍率の低い順。`

// ── 売り場のカード ──────────────────────────────────────────────────────────
//   ★抜粋は有料資料の本文からそのまま切る。宣伝用に書き直さない。
//     下で資料の本文と突き合わせ、一致しなければ止める（[[paywall-teaser-note-style]]）。
const PEEK_ROWS = 3
const peekCat = shownCats.find((c) => suki.some((h) => h.kind === c.kind && h.cat === c.cat))
const peekList = suki.filter((h) => h.kind === peekCat.kind && h.cat === peekCat.cat).sort((a, b) => a.med - b.med || b.n - a.n)
const PEEK = `    <h4 class="pk">${SEC2_TITLE}</h4>
    <p>${SEC2_LEAD}</p>
    <h4 class="pk">${esc(peekCat.label)}（${peekList.length}件）</h4>
    <div class="table-wrap"><table style="white-space:nowrap">
    <thead><tr>${TH}</tr></thead>
    <tbody>
${peekList.slice(0, PEEK_ROWS).map((h) => `    ${hrow(h)}`).join('\n')}
    </tbody></table></div>`
const OFFER = offerKawasakiLeaf({
  up: '../',
  peek: PEEK,
  facts: {
    price: PRICE, rounds: F.rounds, minN: MIN_N, suki: SUKI,
    sukiN: num(F.suki), bureN: F.buread, enoughN: num(F.enough),
  },
})

// ── 無料ページ /kawasaki/ ───────────────────────────────────────────────────
const freeBody = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ 川崎市営住宅 申込先えらび</p>

  <h1>川崎市営住宅で「毎回すいている申込先」はどこか<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を住宅と募集区分ごとに名寄せした実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝川崎市「市営住宅入居者募集に係る抽選結果」応募状況表${F.rounds}回分の読み取り</p>

  <p class="lead">川崎市は募集回ごとに応募状況表を出していますが、<strong>回をまたいで「どの住宅が毎回すいているか」を並べた資料は公表していません</strong>。1回だけたまたま空いた住宅と、いつ見ても空いている住宅は、申し込む側にとってまったく別のものです。ここでは${F.rounds}回分を読み直して、住宅と募集区分ごとに名寄せしました。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>観測できた募集は<strong>${num(F.rows)}件</strong>、住宅×募集区分で<strong>${num(F.all)}件</strong>。${MIN_N}件以上観測できた<strong>${num(F.enough)}件</strong>の倍率の中央値は<strong>${F.allMed}倍</strong>で、<strong>${F.suki}件（${F.sukiPct}%）</strong>が${SUKI}倍未満でした。申込者ゼロの募集は<strong>${num(F.zeroRows)}件・${F.zeroHouses}住宅</strong>で出ています。</p>
  </div>

${jumpKawasaki({ rounds: F.rounds, price: PRICE })}

  <h2 id="waku">① まず「どの区分で出すか」で倍率が変わる（無料）</h2>
  <p>住宅を選ぶ前に、ここを確かめてください。${RANGE}の全${num(F.rows)}件を募集区分ごとに分けると、<strong>${esc(CAT_LO.label)}の中央値${CAT_LO.med}倍に対して${esc(CAT_HI.label)}は${CAT_HI.med}倍</strong>で、<strong>${CAT_RATIO}倍</strong>ひらいています。申込先が${MIN_CAT}件以上ある区分だけを倍率の低い順に並べました。</p>
${catTable}
  <p class="note">区分は自分で選べるものではなく、世帯構成や年齢などの資格で決まります。2つ以上の資格に当てはまる場合だけ、どちらで出すかを選べます。「新築」は新しく建てた住宅、「空家」は退去が出た住宅です。</p>

  <h2 id="pack">② 住宅名つきの一覧（${PRICE}円）</h2>
  <p class="offer-lead"><strong>申込書に書けるのは基本的に1回につき1つ</strong>です。区分ごとの相場が分かっても、最後は住宅名を1つに決めることになります。そこだけは住宅ごとの実測が要ります。</p>
${OFFER}
  <p class="note">※この資料に載るのは川崎市営住宅だけです。神奈川県営住宅・都営住宅は入っていません（都営は<a href="../toei/">別の資料</a>があります）。</p>


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

write('kawasaki/index.html', page({
  title: `川崎市営住宅で毎回すいている申込先はどこか｜定期募集${F.rounds}回の実測｜フクシル`,
  desc: `川崎市営住宅の応募状況表${F.rounds}回分（${RANGE}）を住宅と募集区分ごとに名寄せしました。観測できた募集${num(F.rows)}件、倍率の中央値は${F.allMed}倍で、${MIN_N}件以上観測できた${num(F.enough)}件のうち${F.suki}件が${SUKI}倍未満。募集区分ごとの相場と混んでいる住宅の実名は無料、住宅名つきの一覧は${PRICE}円です。`,
  canonical: '/kawasaki/', depth: 1, body: freeBody,
  jsonld: {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: `川崎市営住宅で毎回すいている申込先はどこか`,
    inLanguage: 'ja', url: `${SITE}/kawasaki/`,
    datePublished: READ_AT, dateModified: READ_AT,
    author: { '@type': 'Organization', name: 'フクシル' },
    publisher: { '@type': 'Organization', name: 'フクシル' },
  },
}))

// ── 購入後の画面 ────────────────────────────────────────────────────────────
write('kawasaki/kanryo/index.html', page({
  title: 'ご購入ありがとうございます｜フクシル', desc: '川崎市営住宅 申込先えらびのダウンロード',
  canonical: '/kawasaki/kanryo/', depth: 2, noindex: true,
  body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">下のボタンから資料をダウンロードしてください。購入から60日間は同じリンクで何度でも落とせます。</p>
  <p class="buyrow"><a class="btn-primary" id="dl" href="#">資料をダウンロード</a></p>
  <p class="fine">うまく落とせない・中身が説明と違う場合は、購入から14日以内に contact@fukushiru.com までご連絡ください。全額返金します。</p>
  <script>
  (function () {
    var s = new URLSearchParams(location.search).get('session_id')
    var a = document.getElementById('dl')
    if (!s) { a.textContent = '購入の確認ができません（session_id がありません）'; a.removeAttribute('href'); return }
    a.href = '/api/download?product=kawasaki&session_id=' + encodeURIComponent(s)
  })()
  </script>`,
}))

// ── 有料資料 .dist/kawasaki-pack.html ───────────────────────────────────────
const sukiByCat = shownCats.map((c) => {
  const list = suki.filter((h) => h.kind === c.kind && h.cat === c.cat).sort((a, b) => a.med - b.med || b.n - a.n)
  return list.length ? `  <h3>${esc(c.label)}（${list.length}件）</h3>\n  <div class="wrap">${table(list)}</div>` : ''
}).filter(Boolean).join('\n')
if (!sukiByCat) die('すいている申込先が1件もありません。読み取りが壊れていないか確かめてください。')

const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>川崎市営住宅 申込先えらび（定期募集${F.rounds}回の実測）｜フクシル</title>
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
<h1>川崎市営住宅 申込先えらび<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を住宅と募集区分ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（${SITE}）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（市内在住・収入基準・世帯構成）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は川崎市の募集案内でご確認ください。この資料は資格の判定をしません。
<strong>対象は川崎市営住宅だけ</strong>で、神奈川県営住宅・都営住宅は入っていません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先（住宅×種別×募集区分） <strong>${num(F.all)}件</strong>。うち${MIN_N}件以上の募集が観測できた <strong>${num(F.enough)}件</strong>を集計の対象にしています。</li>
<li>同じ住宅でも種別（新築／空家）と募集区分が違えば別に数えています。混ぜると、区分によって安かった住宅が「毎回すいている」に化けるためです。</li>
<li>その${num(F.enough)}件の倍率の中央値は <strong>${F.allMed}倍</strong>。中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${enough.filter((h) => h.zero > 0).length}件</strong>。</li>
<li>最高と最低が${BURE}倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
</ul>

<h2>${SEC2_TITLE}</h2>
<p>${SEC2_LEAD}</p>
${sukiByCat}

<h2>3. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が${BURE}倍以上ひらいた住宅です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}</div>

<h2>4. 申込者ゼロが出た申込先（${enough.filter((h) => h.zero > 0).length}件）</h2>
<p>誰も申し込まなかった回がある申込先です。「申込0」の欄がその回数。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません。</p>
<div class="wrap">${table(enough.filter((h) => h.zero > 0).sort((a, b) => b.zero - a.zero || a.med - b.med))}</div>

<h2>5. 募集区分ごとの相場</h2>
<p>申込先が${MIN_CAT}件以上ある区分だけ、倍率の低い順。どの枠で出せるかで${CAT_RATIO}倍変わります。</p>
<div class="wrap"><table class="grid"><thead><tr><th>募集区分</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">5倍未満</th></tr></thead><tbody>
${shownCats.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${num(c.n)}</td><td class="num">${num(c.koho)}</td><td class="num">${c.med}倍</td><td class="num">${pct(c.zero, c.n)}%</td><td class="num">${c.houses}</td><td class="num">${c.suki}</td></tr>`).join('\n')}
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
write('.dist/kawasaki-pack.html', packHtml)

// ── 関所：抜粋が有料資料の本文とそのまま一致するか ──────────────────────────
//   売り場のカードは「実物の冒頭をそのまま」と書いている。宣伝用に書き直したものを
//   そこに置くと嘘になるので、タグを外した文字の並びが資料の本文に在ることを確かめる。
//   ★資料を作り直したのに抜粋だけ古い、という事故を都営で実際に踏んでいる。
{
  const flat = (x) => x.replace(/<[^>]+>/g, '').replace(/\s/g, '')
  if (!flat(packHtml).includes(flat(PEEK))) die('抜粋が有料資料の本文と一致しません（抜粋の作り方を確認）。')
}

// ── 書き出し ────────────────────────────────────────────────────────────────
for (const [rel, html] of pending) {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
}

// ── sitemap（/kawasaki/ の1行。/kawasaki/kanryo/ は購入者専用なので載せない）──
{
  const smPath = path.join(ROOT, 'sitemap.xml')
  const sm = fs.readFileSync(smPath, 'utf8')
  const loc = `${SITE}/kawasaki/`
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  const entry = `<url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`
  const re = new RegExp(`<url><loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`)
  const next = re.test(sm) ? sm.replace(re, entry) : sm.replace('</urlset>', `  ${entry}\n</urlset>`)
  if (next !== sm) fs.writeFileSync(smPath, next)
}

console.log(`無料ページ /kawasaki/ と購入後画面を作成`)
console.log(`有料資料 .dist/kawasaki-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
console.log(`  募集${num(F.rows)}件 → 申込先${F.all}件（うち${MIN_N}件以上観測 ${F.enough}件）`)
console.log(`  すいている ${F.suki}件・ぶれる ${F.buread}件・申込0あり ${enough.filter((h) => h.zero > 0).length}件`)
console.log(`  募集区分 ${F.cats}（うち申込先${MIN_CAT}件以上で面に出すのは ${shownCats.length}）`)
console.log(`  いちばん低い ${CAT_LO.label} ${CAT_LO.med}倍 ↔ いちばん高い ${CAT_HI.label} ${CAT_HI.med}倍 ＝ ${CAT_RATIO}倍`)
console.log(`  読み取り: 使えた${F.rounds}回 ／ 使えない${F.skippedRounds.length}回（${F.skippedRounds.join('・')}） ／ 公表合計と一致${F.matched}回・差が説明できる${F.explained}回`)
console.log(`  次に: node scripts/kawasaki-put-pack.mjs（KVへ）`)
