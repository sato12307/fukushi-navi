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
import { page, esc, SITE, readPrev, pageDiff, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'
import { offerKoeiLeaf, jumpKoei, offerKoeiSell } from './offer-block.mjs'
import { load, loadFrom, OSAKA_FU, KOEI_ALL, MIN_N, SUKI, BURE, MIN_GROUP, PRICE, r1, num, pct, WA, normName } from './koei-lib.mjs'
import { kanryoScript } from './kanryo-script.mjs'
import { suiiOf, suiiSection, SUII_KEYS } from './koei-suii-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const keys = args.includes('--all') ? Object.keys(KOEI_ALL) : args.filter((a) => !a.startsWith('-'))
if (!keys.length) {
  console.error('市を指定してください: node scripts/koei-nerai.mjs kawasaki shizuoka yokohama ／ --all')
  process.exit(1)
}

const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }
const tw = (inner) => `  <div class="table-wrap">\n${inner}\n  </div>`
const tbl = (head, body) => tw(`  <table class="grid">\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${body}\n  </tbody></table>`)

// ── 団地の条件（無料にした市・2026-10-20〜）───────────────────────────────────
//   data/joken-<市>.json … 市の団地一覧から読んだ条件（建設年度・エレベーター・住所）と、倍率側の名前→団地の対応（nameMap）
//   data/joken-geo.json  … 住所から測った最寄り駅と直線距離（scripts/joken-geo.mjs）
//   どちらかが無い市は null（＝条件の列も節も出さない。いままでどおりの面）。
const DIST_MAX = 1000   // 「駅に近い」の線＝ホームまで直線1km（道のりにすると約1.2km＝歩いて15分前後の目安）
const distLabel = (m) => (m == null ? '' : m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)}m` : `${(Math.round(m / 100) / 10).toFixed(1)}km`)
function loadJoken (C) {
  const pj = path.join(ROOT, 'data', `joken-${C.key}.json`)
  const pg = path.join(ROOT, 'data', 'joken-geo.json')
  if (!fs.existsSync(pj) || !fs.existsSync(pg)) return null
  const J = JSON.parse(fs.readFileSync(pj, 'utf8'))
  const G = JSON.parse(fs.readFileSync(pg, 'utf8')).cities?.[C.key]
  if (!G) return null
  const byName = new Map(J.rows.map((r) => [r.name, r]))
  // nameMap の鍵は倍率側の名前（横浜だけ「区|名前」）。申込先の欄は normName 済みなので、鍵もそろえる
  const map = new Map()
  for (const [k, v] of Object.entries(J.nameMap || {})) {
    if (!v) continue
    if (!byName.has(v)) die(`${C.city}：nameMap の行き先「${v}」が団地一覧（data/joken-${C.key}.json）に無い`)
    map.set(k.split('|').map(normName).join('|'), v)
  }
  const withKu = Object.keys(J.nameMap || {}).some((k) => k.includes('|'))
  return {
    builtLabel: J.builtLabel || '建設年度', J, G,
    of (h) {
      const v = map.get(withKu ? `${h.ku || ''}|${h.name}` : h.name)
      if (!v) return null
      const r = byName.get(v), g = G.rows[v]
      return { name: v, built: r.built ?? null, builtNew: r.builtNew ?? null, ev: r.ev ?? null, station: g?.station ?? null, line: g?.line ?? null, distM: g?.level === 'ooaza' ? null : g?.distM ?? null, level: g?.level ?? null,   // 大字の代表点は距離に使わない（joken-geo.mjs）
        // 一覧の備考で「全戸退去済」「返還予定」（借上の返還）の団地。もう募集に出ないか出なくなるので、条件がいい申込先には入れない
        gone: /全戸退去|返還/.test(r.note || '') ? r.note : null }
    },
  }
}

for (const key of keys) {
  const D = load(key)
  const { C, F, RANGE, READ_AT, INDEX_URL, SRC_NAME, enough, suki, buread, konde, shownGroups, BY_ROUND } = D
  const W = C.wa || WA   // 回の呼び方（愛知県営だけ「令和◯年度第◯回」。koei-lib の RANGE と同じ）
  const pending = []
  const U = C.byRounds ? '回' : '件'   // 「毎回」の数え方（byRounds＝募集回の数）
  const BOSHU = C.boshu || '定期募集'   // 募集の呼び方（大阪府営は「総合募集」）
  const write = (rel, html) => pending.push([rel, html])
  const OPEN = !!C.free   // 無料にした市（2026-10-20〜）。下の「無料にした市」の節を参照

  // ── 軸ごとの相場（無料）──────────────────────────────────────────────────
  const groupTable = tbl(
    `<th>${esc(C.axis.label)}</th><th class="num">観測できた募集</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">${SUKI}倍未満</th>`,
    shownGroups.map((g) => `  <tr><th scope="row">${esc(g.label)}</th><td class="num">${num(g.n)}件</td><td class="${g.med < SUKI ? 'lo' : 'num'}">${g.med}倍</td><td class="num">${pct(g.zero, g.n)}%</td><td class="num">${g.houses}件</td><td class="num">${g.suki}件</td></tr>`).join('\n'))
  const LO = shownGroups[0]
  const HI = shownGroups[shownGroups.length - 1]
  const RATIO = Math.round(HI.med / Math.max(LO.med, 0.1))

  // ── 団地の条件（無料にした市だけ・2026-10-20〜）────────────────────────────
  //   ユーザー「エレベーターや築年数、徒歩何分などの変数と倍率を比較したうえでコスパのいい住宅ランキング…既存の有料公営住宅
  //   コンテンツにもいい見本になる」。応募状況表には条件が載っていないので、市の団地一覧（data/joken-<市>.json・scripts/joken-<市>.py）
  //   と、住所から測った最寄り駅までの直線距離（data/joken-geo.json・scripts/joken-geo.mjs）を団地の名前でつなぐ。
  //   ★名前のつなぎは読み取りの段で決めた nameMap だけを使う（ここで似た名前に寄せない＝別の団地の条件を見せない）。
  const J = OPEN ? loadJoken(C) : null
  const jcell = (h) => {
    const a = J && J.of(h)
    if (!a) return '<td></td><td class="num"></td><td></td>'
    const st = a.station ? (a.level === 'ooaza' ? `${esc(a.station)}（距離は測れず）` : `${esc(a.station)} ${distLabel(a.distM)}${a.level === 'choume' ? '†' : ''}`) : ''
    return `<td>${st}</td><td class="num">${a.built ? `${a.built}${a.builtNew && a.builtNew !== a.built ? '〜' : ''}` : ''}</td><td>${esc(a.ev || '')}</td>`
  }

  // ── 表の部品（有料資料と、売り場の抜粋の両方で使う）──────────────────────
  const TH = C.cols.map(([, label]) => `<th>${esc(label)}</th>`).join('') +
    (J ? `<th>最寄り駅（直線）</th><th class="num">${esc(J.builtLabel)}</th><th>エレベーター</th>` : '') +
    '<th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th class="num">のべ戸数</th><th class="num">最後の募集</th>'
  const hrow = (h) => '<tr>' + C.cols.map(([f]) => `<td>${esc(h[f] || '')}</td>`).join('') + (J ? jcell(h) : '') +
    `<td class="num">${r1(h.med)}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td class="num">${h.koho}</td><td class="num">${W(h.last)}</td></tr>`
  const table = (list) => `<table class="grid"><thead><tr>${TH}</tr></thead><tbody>\n${list.map(hrow).join('\n')}\n</tbody></table>`

  // ── 索引の「条件で絞る」（横浜・2026-10-04）────────────────────────────────
  //   単身か（資料の※印）・募集区分（単位×区分＝世帯区分）・区で、有料資料の索引を絞る。資料はその場で開く完結した HTML なので
  //   JavaScript は資料の中に置く（動かなくても索引は全部出ている）。
  //   ★エレベーターでは絞らない。印は9回で40件にしか付かず、印の無い行は「表に書いていない」だけ。絞ると「残った＝エレベーターあり」と読まれる。
  //     代わりに、1階かエレベーター付きが要る人の枠（全市単位の「1階又はEV付き」）の回ごとの倍率を添える。
  const CAT_ORDER = ['一般世帯向（直接建設型）', '一般世帯向（借上型）', '4部屋以上', '単身者可', '子育て世帯専用', '子育て優遇', '車いす用', '単身者用',
    '高齢単身者用（直接建設型）', '高齢単身者用（借上型）', '高齢二人世帯向（直接建設型）', '高齢二人世帯向（借上型）', '行政区単位', '全市単位']
  const filterBlock = (D) => {
    const ord = (c) => (CAT_ORDER.map((x) => x.normalize('NFKC')).indexOf(c.normalize('NFKC')) + 1) || 99
    const cats = [...new Set(enough.map((h) => h.cat))].sort((a, b) => ord(a) - ord(b) || a.localeCompare(b, 'ja'))
    const kus = [...new Set(enough.map((h) => h.ku).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
    const frow = (h) => hrow(h).replace('<tr>', `<tr data-t="${h.tanshin ? '1' : ''}" data-c="${esc(h.cat)}" data-k="${esc(h.ku || '')}">`)
    const evRows = D.rows.filter((r) => r.unit === '全市単位' && /EV付き/.test(r.name))
    const evByRound = D.ROUNDS.map((rd) => {
      const rs = evRows.filter((r) => r.round === rd)
      const k = rs.reduce((a, x) => a + x.koho, 0), m = rs.reduce((a, x) => a + x.moushikomi, 0)
      return k ? `<tr><td>${W(rd)}</td><td>${esc([...new Set(rs.map((r) => r.name))].join('／'))}</td><td class="num">${k}</td><td class="num">${m}</td><td class="num">${r1(m / k).toFixed(1)}</td></tr>` : ''
    }).filter(Boolean).join('\n')
    const evN = D.rows.filter((r) => r.ev).length
    return `<div class="box" id="flt"><p><span class="tag">条件で絞る</span>単身で申し込めるか・募集区分（世帯区分）・区で、下の索引を絞れます。</p>
<p><label><input type="checkbox" id="f-t"> 単身で申し込める申込先だけ（資料の※印。令和4年4月の回は太字。印が回によって違う申込先も残します）</label></p>
<p><label>募集区分 <select id="f-c"><option value="">すべて</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
<label>区 <select id="f-k"><option value="">すべて</option>${kus.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label></p>
<p class="note" id="f-n" aria-live="polite"></p>
<p class="note">エレベーターでは絞れません。エレベーターの印（〇各階に停止・□一部の階に停止・△踊り場に停止・×なし）は、同じ団地が棟で分かれて募集された回にだけ付いていて（${F.rounds}回で${evN}件）、<strong>印の無い申込先は「エレベーターあり」ではなく「表に書いていない」</strong>という意味です。印のある申込先は索引の「エレベーターの印」の欄に出しています。</p>
<noscript><p class="note">絞り込みはブラウザの JavaScript で動きます。動かない場合も、索引は全部この下に出ています。</p></noscript>
</div>
${evByRound ? `<h3>1階かエレベーター付きの住戸が要る場合：全市単位の枠</h3>
<p>横浜市の定期募集には、住宅を決めずに申し込む「全市単位」の枠があり、その中に「1階又はEV付き」の住戸の枠があります（回によって名前が少し違います）。全市単位は申込先ごとの名寄せの対象にしていないので、ここだけ回ごとの倍率を出しています。</p>
<div class="wrap"><table class="grid"><thead><tr><th>募集回</th><th>枠の名前（資料のまま）</th><th class="num">募集戸数</th><th class="num">応募者数</th><th class="num">倍率</th></tr></thead><tbody>
${evByRound}
</tbody></table></div>` : ''}
<div class="wrap"><table class="grid" id="idx"><thead><tr>${TH}</tr></thead><tbody>
${enough.map(frow).join('\n')}
</tbody></table></div>
<script>(function(){var t=document.getElementById('f-t'),c=document.getElementById('f-c'),k=document.getElementById('f-k'),n=document.getElementById('f-n');if(!t||!c||!k)return;var rows=document.querySelectorAll('#idx tbody tr');function go(){var m=0;for(var i=0;i<rows.length;i++){var r=rows[i];var ok=(!t.checked||r.getAttribute('data-t'))&&(!c.value||r.getAttribute('data-c')===c.value)&&(!k.value||r.getAttribute('data-k')===k.value);r.style.display=ok?'':'none';if(ok)m++}n.textContent=m+'件を表示しています（索引の全'+rows.length+'件のうち）'}t.addEventListener('change',go);c.addEventListener('change',go);k.addEventListener('change',go);go()})()</script>`
  }

  const SEC2_TITLE = `2. 毎回すいている申込先（${num(F.suki)}件）`
  const SEC2_LEAD = `${MIN_N}${U}以上${C.byRounds ? 'の募集で' : ''}観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを載せています。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。倍率の低い順。`
  const sukiByGroup = shownGroups.map((g) => {
    const list = suki.filter((h) => h.axis === g.label).sort((a, b) => a.med - b.med || b.n - a.n)
    return list.length ? `  <h3>${esc(g.label)}（${list.length}件）</h3>\n  <div class="wrap">${table(list)}</div>` : ''
  }).filter(Boolean).join('\n')
  if (!sukiByGroup) die(`${C.city}：すいている申込先が1件もありません。読み取りが壊れていないか確かめてください。`)
  // ★2章の見出しの件数（F.suki）は全区分で数えるが、上の表は申込先が MIN_GROUP 件以上ある区分（shownGroups）しか出さない。
  //   小さい区分のすいている申込先が、見出しには数えられて表のどこにも無かった（2026-10-08 の点検。川崎 103件／95行・
  //   横浜 117／114・相模原 24／22・愛知 262／261）。残りは「その他の区分」にまとめ、見出しの件数＝表の行数にする。
  //   売り場のカードの件数（＝見出し）は変わらない。koei-put-pack.mjs も入れる前に同じことを確かめる。
  const shownLabels = new Set(shownGroups.map((g) => g.label))
  const sukiRest = suki.filter((h) => !shownLabels.has(h.axis)).sort((a, b) => a.med - b.med || b.n - a.n)
  const sukiOther = sukiRest.length
    ? `  <h3>その他の区分（${sukiRest.length}件）</h3>\n  <p class="note">申込先が${MIN_GROUP}件未満の${esc(C.axis.label)}（${[...new Set(sukiRest.map((h) => h.axis))].map((a) => esc(a.replace(/^（(.+)）$/, '$1'))).join('・')}）のぶんを、まとめて倍率の低い順に並べています。</p>\n  <div class="wrap">${table(sukiRest)}</div>`
    : ''
  if (suki.filter((h) => shownLabels.has(h.axis)).length + sukiRest.length !== F.suki) die(`${C.city}：2章の表の行数が見出しの件数（${F.suki}件）と合いません。`)

  // ── 混んでいる申込先（実名・無料）───────────────────────────────────────
  const kondeTable = tbl(
    C.cols.slice(0, 3).map(([, l]) => `<th>${esc(l)}</th>`).join('') + '<th class="num">中央値</th><th class="num">最高</th><th class="num">観測</th>',
    konde.slice(0, 12).map((h) => '  <tr>' + C.cols.slice(0, 3).map(([f]) => `<td>${esc(h[f] || '')}</td>`).join('') +
      `<td class="hi">${r1(h.med)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n'))

  const roundTable = tbl(
    '<th>募集回</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th>',
    BY_ROUND.map((r) => `  <tr><th scope="row">${W(r.round)}</th><td class="num">${r.n}件</td><td class="num">${num(r.koho)}戸</td><td class="num">${r.med}倍</td><td class="${r.zero ? 'lo' : 'num'}">${r.zero}件</td></tr>`).join('\n'))

  // ── 限界の説明（無料ページと有料資料で同じ文を使う）──────────────────────
  const skipped = F.skippedRounds.length
    ? `使えなかった${F.skippedRounds.length}回（${F.skippedRounds.map(W).join('・')}）は、${C.skipWhy || 'PDFから住宅名を取り出せませんでした'}。`
    : ''
  // ★突き合わせの中身は市によって違う。ひとつの文で書くと嘘になる（実際になった）。
  //   川崎  … 公表の合計と突き合わせ、差は「住宅名がPDFに入っていない行」の戸数で説明。
  //   相模原… 同じく公表の合計だが、差は「申込住宅不明」の**人数**（戸ではない）。
  //   神戸  … **公表の合計そのものが無い**。資料の中の別の列どうしで辻褄を合わせている。
  //   ∴ 文面の型は CITIES の check に書く。既定は川崎の型。
  const nn = C.check || {}
  const nnLabel = nn.noNameLabel || '住宅名がPDFに入っていない行'
  const nnUnit = nn.noNameUnit || '戸'
  const checked = nn.text ? nn.text(F)
    : F.matched || F.explained
      ? `読み取りは公表表の合計と突き合わせています。<strong>${F.matched}回は合計まで一致</strong>${F.explained ? `、残り${F.explained}回の差は<strong>${nnLabel}（合計${F.noNameRows}件・${F.noNameKoho}${nnUnit}）</strong>でちょうど説明がつきます。そこは住宅が分からないので集計に入れていません` : ''}。`
      : (F.noNameRows ? `${nnLabel}が${F.noNameRows}件あり、住宅が分からないので集計に入れていません。` : '')
  const LIMITS = `  <li>出典＝${esc(SRC_NAME)}（${RANGE}）。読み取り日 ${READ_AT}。<a href="${INDEX_URL}" rel="nofollow">回ごとの公表ページ</a>は${esc(C.pub || `${C.city}（または指定管理者）`)}が公開しています。</li>
  <li>${esc(C.pubShort || '市')}が公開している${F.allRounds ? `<strong>${F.allRounds}回</strong>のうち、` : ''}<strong>${F.rounds}回</strong>を使っています。${skipped}</li>
${checked ? `  <li>${checked}</li>\n` : ''}  <li>${C.calcNote || '倍率は公表表の倍率の列を読まず、<strong>応募者数÷募集戸数</strong>で当方が計算しています。公表列をそのまま読むと、レイアウトが崩れた回に住宅名と倍率の対応がずれて入ることがあり、件数を数えても気づけないためです。'}</li>
${C.thin ? `  <li>${C.thin(F)}</li>
` : ''}
  <li>「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の区分・住戸が募集されることがあり、その1件ずつを数えています。${C.byRounds ? `ただし「毎回すいている」の対象は、<strong>${MIN_N}回以上の募集で観測できた申込先</strong>だけです（同じ回に何戸出ても1回と数えます）。` : ''}</li>
  <li>${esc(C.note)}</li>
  <li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
${J ? `  <li>団地の条件（${esc(J.builtLabel)}・エレベーター・所在地）は、${J.J.sources.map((x) => `<a href="${esc(x.url)}" rel="nofollow">${esc(x.name)}</a>（${esc(x.asof || '')}）`).join('・')}から当方が団地ごとにまとめたものです。棟によって違う団地は、${esc(J.builtLabel)}はいちばん古い棟、エレベーターは全部の棟にあれば「あり」・一部の棟だけなら「一部」としています。応募状況表の住宅名と団地一覧の名前は当方が突き合わせており、つなげられなかった申込先は条件の欄が空いています。</li>
  <li>最寄り駅と直線距離は、団地の所在地を国土交通省「位置参照情報」で位置に直し、国土交通省「国土数値情報（鉄道データ）」の駅のホームまでを測ったものです（どちらも当方で加工）。道のりや所要時間ではありません。</li>
` : ''}  <li>当サイトは${esc(C.orgs || C.city)}とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>`

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
    axis: C.axis.label, only: C.only || `${C.city}営住宅だけ`, minU: U, boshu: BOSHU,
    shikaku: C.shikaku || '市内在住・収入基準など', notIn: C.notIn || '都道府県営住宅や他市の市営住宅', guideOrg: C.guideOrg || C.city,
    // ★索引に「条件で絞る」が付く市（横浜）だけ、売り場の中身の説明に1行足す（offer-block は市ごとの if を持たない）
    extraLi: C.filter ? `<li>索引は<strong>条件で絞れます</strong>（単身で申し込めるか・募集区分（一般世帯向・子育て・高齢単身者用・高齢二人世帯向など）・区。エレベーターの印は付いている申込先にだけ表示）</li>` : '',
  }
  const OFFER = offerKoeiLeaf({ up: '../', facts })

  // ── 無料にした市（C.free・2026-10-20〜）：売っていた一覧の中身（2・3・4・6章）を /<市>/ にそのまま出す ──────────
  //   ユーザー「公営住宅の有料ラインナップを一部無料開放しよう。そのページに就労支援のアフィリエイトを貼ってみて、様子をみましょう」。
  //   表は有料資料と同じ行（hrow・table・filterBlock）から作る。資料の箱（.box・.wrap）はサイトの部品（.callout・.table-wrap）に置き換える。
  //   アフィリエイトのバナーは scripts/stamp-affiliate.mjs が公開の直前に③の前へ入れる。
  //   ★表は1行に収めて横にスクロールさせる（資料と同じ・売り場の抜粋と同じ）。折り返すと320px幅で1行が300px超になる（toei-check.mjs が検知）。
  const fwrap = (s) => s.replace(/<div class="wrap">/g, '<div class="table-wrap">').replace(/<table class="grid"( id="idx")?>/g, '<table class="grid"$1 style="white-space:nowrap">').replace('<div class="box" id="flt">', '<div class="callout note" id="flt">')
  const EVWARN = `  <div class="callout warn"><p><span class="tag">先に知っておいてください</span>
  <strong>倍率が低い申込先だけを並べると、空いている理由がそのまま集まります。</strong>
  都営住宅では同じ集計で確かめられました——毎回すいている595件のうち59%は、エレベーターが無いか築39年より古い住宅でした
  （<a href="../toei/">都営住宅のページ</a>）。<strong>${C.evNote ? esc(C.evNote) : `${C.city}の応募状況表には、エレベーターの有無も建てられた年も載っていません。`}</strong>
  ${C.key === 'shizuoka' || C.key === 'kobe' ? '階だけは資料にありますが、実測では倍率とほとんど関係がありませんでした（エレベーターの有無が分からないため、階だけでは住みやすさを測れません）。' : ''}
  ∴ この一覧は<strong>当たりやすさだけを並べたもの</strong>で、設備や築年数で選り分けてはいません。
  気になる申込先が見つかったら、<strong>その回の募集案内と現地で、エレベーターの有無・階・築年数を必ず確かめてください。</strong></p></div>`
  // 条件をつないだ市は、注意書きを「条件の列を足した・条件もそろう申込先はこちら」に替える
  const EVWARN_J = J ? `  <div class="callout warn"><p><span class="tag">先に知っておいてください</span>
  <strong>倍率が低い申込先だけを並べると、空いている理由がそのまま集まります。</strong>
  都営住宅では同じ集計で確かめられました——毎回すいている595件のうち59%は、エレベーターが無いか築39年より古い住宅でした（<a href="../toei/">都営住宅のページ</a>）。
  ${esc(C.city)}の応募状況表にはエレベーターの有無も建てられた年も載っていないので、<strong>${esc(C.city)}の団地一覧から${esc(J.builtLabel)}とエレベーターを、住所から最寄り駅までの直線距離を</strong>当方で足しました（表の「最寄り駅（直線）」「${esc(J.builtLabel)}」「エレベーター」の欄）。
  倍率と条件の両方がそろう申込先は <a href="#kosupa">倍率のわりに条件がいい申込先</a> にまとめています。
  条件の欄は団地全体の値で、<strong>申し込む住戸の階やエレベーターの止まり方とは限りません</strong>。その回の募集案内と現地で必ず確かめてください。</p></div>` : ''

  // ── 倍率のわりに条件がいい申込先（条件をつないだ市だけ）─────────────────────
  //   県営の無料ページ（kenei-free.mjs の kosupaSection）と同じ考え方：点数は付けず、条件を全部満たすかで切って、倍率の低い順。
  //   ★条件の線：中央値${SUKI}倍未満・駅のホームまで直線${DIST_MAX}m以内・建てた年が真ん中より新しい側・全部の棟にエレベーター。
  //   ★事故住宅（横浜は令和5年10月から「特別空家」）は空いている理由が別にあるので除く。
  let KOSUPA = '', kosupaN = 0
  if (J) {
    const base = enough.filter((h) => !/事故|特別空家/.test(`${h.cat || ''}${h.kind || ''}`))
    const withJ = base.map((h) => [h, J.of(h)]).filter(([, a]) => a)
    const ys = withJ.map(([, a]) => a.built).filter(Boolean).sort((a, b) => a - b)
    const yMed = ys[Math.floor((ys.length - 1) / 2)]
    // 3つの条件。どれを満たすかを申込先ごとに持つ（★点数にはしない。そろった数と、欠けた条件の名前だけ）
    const CONDS = [
      { k: 'near', ok: (a) => a.distM != null && a.distM <= DIST_MAX, head: '新しくてエレベーターもあるが、駅からは遠い（直線1kmより先）' },
      { k: 'new', ok: (a) => a.built != null && a.built >= yMed, head: `駅に近くてエレベーターもあるが、古い（${J.builtLabel}が${yMed}年より前）` },
      { k: 'ev', ok: (a) => a.ev === 'あり', head: '駅に近くて新しいが、エレベーターが無い棟がある' },
    ]
    const cand = withJ.filter(([h, a]) => h.med < SUKI && !a.gone && a.distM != null)   // 距離を測れなかった申込先は「遠い」とも言えないので入れない
      .map(([h, a]) => ({ h, a, met: CONDS.filter((c) => c.ok(a)) }))
    const noDist = withJ.filter(([h, a]) => h.med < SUKI && !a.gone && a.distM == null).length
    const byMed = (x, y) => x.h.med - y.h.med || (x.a.distM ?? 9e9) - (y.a.distM ?? 9e9)
    const all3 = cand.filter((x) => x.met.length === 3).sort(byMed)
    // ★エレベーターが一覧に載っていない団地（横浜の借上住宅など）は「無い」ではなく「分からない」。
    //   「エレベーターが無い棟がある」の表に入れず、駅に近くて新しいものだけ別の表に出す
    const two = cand.filter((x) => x.met.length === 2 && !(x.a.ev == null && !x.met.some((c) => c.k === 'ev'))).sort(byMed)
    const evUnk = cand.filter((x) => x.a.ev == null && x.met.length === 2 && !x.met.some((c) => c.k === 'ev')).sort(byMed)
    const sukiN = base.filter((h) => h.med < SUKI).length
    const shown = [...all3, ...two, ...evUnk]
    const zero = shown.filter((x) => x.h.med === 0).length
    const choumeN = shown.filter((x) => x.a.level === 'choume').length
    kosupaN = shown.length
    const T = (xs) => tw(table(xs.map((x) => x.h)).replace('<table class="grid">', '<table class="grid" style="white-space:nowrap">'))
    const twoGroups = CONDS.map((c) => {
      const xs = two.filter((x) => !x.met.includes(c))
      return xs.length ? `  <h3>${c.head}（${xs.length}件）</h3>\n${T(xs)}` : ''
    }).filter(Boolean).join('\n') + (evUnk.length
      ? `\n  <h3>駅に近くて新しいが、エレベーターの有無が団地一覧に載っていない（${evUnk.length}件）</h3>\n  <p class="note">民間の建物を市が借り上げた住宅などは、市の資料にエレベーターの台数が載っていません。「無い」という意味ではないので、募集案内で確かめてください。</p>\n${T(evUnk)}`
      : '')
    KOSUPA = `  <h2 id="kosupa">倍率のわりに条件がいい申込先（${num(shown.length)}件・無料）</h2>
  <p>倍率の低い順に並べるだけだと、<strong>駅から遠い・階段しかない・古い</strong>といった「空いている理由」のある住宅ばかりが上に来ます。そこで都営住宅の一覧と同じ考え方で、<strong>倍率が比較的ましな申込先</strong>（${MIN_N}${U}以上の募集に出て、倍率の中央値が${SUKI}倍未満。1回だけたまたま空いた住宅は入りません）に、住む条件を3つ当てました。</p>
  <ol>
  <li><strong>駅に近い</strong>：駅のホームまで直線${num(DIST_MAX)}m以内（道のりにするとおおむね1.2km＝歩いて15分前後の目安。住所の位置から測った直線距離で、坂や線路の渡り方は入っていません）</li>
  <li><strong>新しい</strong>：${esc(J.builtLabel)}が${yMed}年以降（条件をつなげられた申込先の真ん中より新しい側。棟によって違う団地は、いちばん古い棟で判定）</li>
  <li><strong>エレベーターあり</strong>：全部の棟にエレベーターがある（一部の棟だけの団地は入れていません）</li>
  </ol>
  <p>${MIN_N}${U}以上観測できた申込先${num(base.length)}件（事故住宅を除く）のうち、団地の条件をつなげられたのが${num(withJ.length)}件、倍率の中央値が${SUKI}倍未満なのは${num(sukiN)}件。そのうち<strong>3つともそろうのが${num(all3.length)}件</strong>、2つそろうのが${num(two.length + evUnk.length)}件です。どちらも倍率の中央値の低い順、同じなら駅に近い順です。${zero ? `中央値が0倍の${zero}件は、<strong>募集された住戸の半分以上で応募が1件も無かった</strong>申込先です。` : ''}${choumeN ? `駅までの距離に†が付いた${choumeN}件は、番地まで位置が当たらず丁目の代表点から測ったもので、数百mずれることがあります。` : ''}${noDist ? `中央値${SUKI}倍未満のうち${noDist}件は、所在地が大字までしか分からず駅までの距離を測れなかったので入れていません（索引の「最寄り駅」の欄に「距離は測れず」と出ています）。` : ''}</p>
  <h3>3つともそろう（${all3.length}件）</h3>
${all3.length ? T(all3) : '  <p>いまの読み取りでは、3つともそろう申込先はありませんでした。下の「2つそろう」から、ご自身にとって欠けても困らない条件の表を見てください。</p>'}
${twoGroups}
  <p class="note">点数は付けていません。どの条件が大事かは読む人によって違う（階段がつらい人にはエレベーター、車の無い人には駅）ので、そろった条件の数と、欠けた条件の名前で分けています。条件の欄は団地全体の値で、申し込む住戸の階やエレベーターの止まり方とは限りません。${esc(C.axis.label)}によって申し込める世帯が違うので、ご自身が申し込める区分かどうかを必ず確かめてください。</p>
`
  }
  const JUMP = OPEN
    ? `  <p><strong>申込先ごとの一覧まで、このページで全部無料で読めます。</strong>→ ${J ? `<a href="#kosupa">倍率のわりに条件がいい申込先（${num(kosupaN)}件）</a> ／ ` : ''}<a href="#suki">毎回すいている申込先（${num(F.suki)}件）</a> ／ <a href="#konde">混んでいる申込先</a> ／ <a href="#bure">回によって動く申込先</a> ／ <a href="#zero">申込者ゼロが出た申込先</a> ／ <a href="#all">申込先の索引（${num(F.enough)}件）</a></p>`
    : jumpKoei({ ...facts, up: '../' })
  const SEC_LIST = OPEN
    ? `  <h2 id="suki">② 毎回すいている申込先（${num(F.suki)}件・無料）</h2>
  <p>${SEC2_LEAD}${esc(C.axis.label)}ごとに分けています。</p>
  <p class="note">申込資格（${esc(C.shikaku ? `${C.shikaku}・世帯構成` : '市内在住・収入基準・世帯構成')}）を満たしていなければ、倍率がいくら低くても申し込めません。資格は${esc(facts.guideOrg)}の募集案内でご確認ください。<strong>対象は${esc(facts.only)}</strong>で、${esc(facts.notIn)}は入っていません。</p>
${J ? EVWARN_J : EVWARN}
${fwrap(sukiByGroup)}${sukiOther ? `\n${fwrap(sukiOther)}` : ''}`
    : `  <h2 id="pack">② 申込先ごとの一覧（${PRICE}円）</h2>
  <p class="offer-lead"><strong>申込書に書けるのは基本的に1回につき1つ</strong>です。${esc(C.axis.label)}ごとの相場が分かっても、最後は申込先を1つに決めることになります。そこだけは申込先ごとの実測が要ります。</p>
${OFFER}`
  const SEC_REST = OPEN
    ? fwrap(`
  <h2 id="bure">回によって当たりやすさが動く申込先（${F.buread}件）</h2>
  <p>最高と最低が${BURE}倍以上ひらいた申込先です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。最低の欄が実際に起きた一番すいていた回の倍率です。</p>
  <div class="table-wrap">${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}</div>

  <h2 id="zero">申込者ゼロが出た申込先（${F.zeroHousesEnough}件）</h2>
  <p>誰も申し込まなかった回がある申込先です。「申込0」の欄がその回数。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません。</p>
  <div class="table-wrap">${table(enough.filter((h) => h.zero > 0).sort((a, b) => b.zero - a.zero || a.med - b.med))}</div>

  <h2 id="all">観測できた申込先の索引（${num(F.enough)}件）</h2>
  <p>中央値の低い順。上の表に出ていない申込先もここには載っています。表の列は、中央値・最低・最高が倍率、観測が募集件数、申込0が申込者ゼロだった回数、のべ戸数が募集戸数の合計です。</p>
${C.filter ? filterBlock(D) : `<div class="wrap">${table(enough)}</div>`}
`)
    : ''

  // ── 無料ページ ──────────────────────────────────────────────────────────
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ ${esc(C.city)}営住宅 申込先えらび</p>

  <h1>${esc(C.city)}営住宅で「毎回すいている申込先」はどこか<br><small>${RANGE}の${BOSHU}${F.rounds}回・${num(F.rows)}件を申込先ごとに名寄せした実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝${esc(C.pub || C.city)}が公表する${esc(C.doc || '応募状況表')}${F.rounds}回分の読み取り</p>

  <p class="lead">${esc(C.city)}は募集回ごとに応募状況を出していますが、<strong>回をまたいで「どの申込先が毎回すいているか」を並べた資料は公表していません</strong>。1回だけたまたま空いた住宅と、いつ見ても空いている住宅は、申し込む側にとってまったく別のものです。ここでは${F.rounds}回分を読み直して、申込先ごとに名寄せしました。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>観測できた募集は<strong>${num(F.rows)}件</strong>、申込先で<strong>${num(F.all)}件</strong>。${MIN_N}件以上観測できた<strong>${num(F.enough)}件</strong>の倍率の中央値は<strong>${F.allMed}倍</strong>で、<strong>${F.suki}件（${F.sukiPct}%）</strong>が${SUKI}倍未満でした。申込者ゼロの募集は<strong>${num(F.zeroRows)}件・${F.zeroHouses}住宅</strong>で出ています。</p>
  </div>

${JUMP}

  <h2 id="axis">① まず「${esc(C.axis.label)}」で倍率が変わる（無料）</h2>
  <p>個々の住宅を選ぶ前に、ここを確かめてください。${RANGE}の全${num(F.rows)}件を${esc(C.axis.label)}ごとに分けると、<strong>${esc(LO.label)}の中央値${LO.med}倍に対して${esc(HI.label)}は${HI.med}倍</strong>で、<strong>${RATIO}倍</strong>ひらいています。申込先が${MIN_GROUP}件以上ある${esc(C.axis.label)}だけを倍率の低い順に並べました。</p>
${groupTable}

${KOSUPA}${SEC_LIST}

  <h2 id="konde">③ 混んでいる申込先（実名・無料）</h2>
  <p>避けるべき相手も無料で出します。${MIN_N}件以上観測できた申込先を、倍率の中央値が高い順に12件。</p>
${kondeTable}

  <h2 id="round">④ 募集回ごとの相場（無料）</h2>
  <p>倍率は回によって動きます。どの回が狙い目だったかの目安。</p>
${roundTable}
${SUII_KEYS.includes(C.key) ? suiiSection(suiiOf(C.key), { up: '../' }) : ''}
${SEC_REST}
  <h2>出典と、この数字の限界</h2>
  <ul>
${LIMITS}
  </ul>
${OPEN ? '' : EVWARN}

  <p class="note"><strong>「倍率が低い＝誰でも入れる」ではありません。</strong>申込資格（市内在住・収入基準・住宅困窮要件など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数・間取り・入居人数の条件が変わります。<strong>過去にあまった住宅が次回も募集に出るとはかぎりません。</strong>申し込む前に、その回の募集案内で必ず条件を確認してください。</p>
  <p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</p>`

  // ── 売り場（1市＝1ページ・2026-09-19 ユーザー裁定）────────────────────────
  //   市の無料ページに埋めていた購入カードをここへ移した。無料ページにはリンクだけ。
  //   ★ここに着いた回数が <市>_view。カードが画面に入っただけの <市>_offer_seen は廃止した。
  // ★無料にした市（C.free）は、古いリンク用の転送（noindex）だけを残す（大阪府営 /osaka-fu/moushikomisaki/ と同じ形）。
  if (OPEN) write(`${C.key}/moushikomisaki/index.html`, `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(C.city)}営住宅の申込先ごとの一覧は無料になりました｜フクシル</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${SITE}/${C.key}/">
<meta http-equiv="refresh" content="0; url=../#suki">
</head>
<body>
<!-- 2026-10-20 ユーザー「公営住宅の有料ラインナップを一部無料開放しよう」。売り場を畳み、一覧は /${C.key}/ に無料で出した。古いリンク用の転送だけを残す。 -->
<p>${esc(C.city)}営住宅の申込先ごとの一覧は、無料で公開しました。<a href="../#suki">${esc(C.city)}営住宅で毎回すいている申込先の一覧へ</a></p>
</body>
</html>
`)
  else write(`${C.key}/moushikomisaki/index.html`, page({
    title: `${C.city}営住宅の申込先ごとの一覧（${PRICE}円）｜${BOSHU}${F.rounds}回の実測｜フクシル`,
    desc: `${C.city}営住宅の${C.doc || '応募状況表'}${F.rounds}回分を申込先ごとに名寄せし、倍率の中央値で「毎回すいている申込先」${num(F.suki)}件を選り分けた一覧です。${C.axis.label}ごとの相場と混んでいる申込先の実名は無料。${PRICE}円。`,
    canonical: `/${C.key}/moushikomisaki/`, depth: 2,
    // ★buy.js に県営（saitama-ken・aichi-ken・osaka-fu）を足した版。古い版がキャッシュから出ると、買うボタンが P[] に無く動かない
    //   （2026-10-01 大阪府営を足したので上げた。売り場を作り直したときだけ新しい版を読む＝ほかの面の lastmod は動かない）
    buyVer: '20261001a',
    body: `  <p class="breadcrumb"><a href="../../index.html">トップ</a> ＞ <a href="../">${esc(C.freeTitle || `${C.city}営住宅 申込先えらび`)}</a> ＞ 申込先ごとの一覧</p>
  <h1>${esc(C.city)}営住宅の申込先ごとの一覧</h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝${esc(C.pub || C.city)}が公表する${esc(C.doc || '応募状況表')}${F.rounds}回分の読み取り</p>
  <p class="lead"><a href="../">${esc(C.freeTitle || `${C.city}営住宅で毎回すいている申込先はどこか`)}</a>のページで、${esc(C.axis.label)}ごとの相場と混んでいる申込先の実名は<strong>全部無料で読めます</strong>。ここで売っているのは、その先＝申込先を1つに決めるための一覧だけです。</p>
${offerKoeiSell({ up: '../../', peek: PEEK, facts })}
  <p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</p>`,
  }))

  if (C.freePage !== false) write(`${C.key}/index.html`, page({
    title: OPEN
      ? `${C.city}営住宅の倍率と、毎回すいている申込先（${BOSHU}${F.rounds}回の実測・一覧まで無料）｜フクシル`
      : `${C.city}営住宅で毎回すいている申込先はどこか｜${BOSHU}${F.rounds}回の実測｜フクシル`,
    desc: `${C.city}営住宅の${C.doc || '応募状況表'}${F.rounds}回分（${RANGE}）を申込先ごとに名寄せしました。観測できた募集${num(F.rows)}件、倍率の中央値は${F.allMed}倍で、${MIN_N}件以上観測できた${num(F.enough)}件のうち${F.suki}件が${SUKI}倍未満。${OPEN ? `毎回すいている申込先${num(F.suki)}件と、申込先ごとの索引${num(F.enough)}件まで全部無料です。` : `${C.axis.label}ごとの相場と混んでいる申込先の実名は無料、申込先ごとの一覧は${PRICE}円です。`}`,
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
    title: 'ご購入ありがとうございます｜フクシル', desc: `${C.city}営住宅 申込先えらびの閲覧画面`,
    canonical: `/${C.key}/kanryo/`, depth: 2, noindex: true,
    body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">資料はこの画面にそのまま開きます。購入から60日間は、このURLで何度でも開けます（ブックマークしておいてください）。</p>
  <p class="buyrow"><a class="btn-primary" id="dl" href="#">資料を開く</a></p>
  <noscript><p class="fine">この画面は、ブラウザの JavaScript を使って資料を開きます。無効になっていると開けません。有効にして読み込み直すか、<a href="mailto:contact@fukushiru.com">contact@fukushiru.com</a> までご連絡ください（購入時のメールアドレスを添えていただけると照合できます）。</p></noscript>
  <p class="fine">開けない・内容が説明と著しく異なる・二重に決済された場合は、購入から14日以内に contact@fukushiru.com までご連絡ください。全額を返金します。</p>
  <p id="msg" class="fine"></p>
  <script>${kanryoScript({ label: '申込先えらびの資料' })}</script>`,
  }))

  // ── 有料資料 ────────────────────────────────────────────────────────────
  const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(C.city)}営住宅 申込先えらび（${BOSHU}${F.rounds}回の実測）｜フクシル</title>
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
<h1>${esc(C.city)}営住宅 申込先えらび<br><small>${RANGE}の${BOSHU}${F.rounds}回・${num(F.rows)}件を申込先ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（${SITE}）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（${esc(C.shikaku ? `${C.shikaku}・世帯構成` : '市内在住・収入基準・世帯構成')}）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は${esc(facts.guideOrg)}の募集案内でご確認ください。この資料は資格の判定をしません。
<strong>対象は${esc(facts.only)}</strong>で、${esc(facts.notIn)}は入っていません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先 <strong>${num(F.all)}件</strong>。うち${MIN_N}${U}以上の募集${C.byRounds ? 'で' : 'が'}観測できた <strong>${num(F.enough)}件</strong>を集計の対象にしています。</li>
<li>${esc(C.note)}</li>
<li>その${num(F.enough)}件の倍率の中央値は <strong>${F.allMed}倍</strong>。中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${F.zeroHousesEnough}件</strong>。</li>
<li>最高と最低が${BURE}倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
</ul>

<h2>${SEC2_TITLE}</h2>
<p>${SEC2_LEAD}</p>
${sukiByGroup}${sukiOther ? `\n${sukiOther}` : ''}

<h2>3. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が${BURE}倍以上ひらいた申込先です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}</div>

<h2>4. 申込者ゼロが出た申込先（${F.zeroHousesEnough}件）</h2>
<p>誰も申し込まなかった回がある申込先です。「申込0」の欄がその回数。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません。</p>
<div class="wrap">${table(enough.filter((h) => h.zero > 0).sort((a, b) => b.zero - a.zero || a.med - b.med))}</div>

<h2>5. ${esc(C.axis.label)}ごとの相場</h2>
<p>申込先が${MIN_GROUP}件以上ある${esc(C.axis.label)}だけ、倍率の低い順。${LO.med > 0 ? `どこで出せるかで${RATIO}倍変わります。` : `中央値が0倍（半分以上の募集で申込みが無い）の${esc(C.axis.label)}もあります。`}</p>
<div class="wrap"><table class="grid"><thead><tr><th>${esc(C.axis.label)}</th><th class="num">観測できた募集</th><th class="num">のべ戸数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th class="num">申込先</th><th class="num">${SUKI}倍未満</th></tr></thead><tbody>
${shownGroups.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${num(g.n)}</td><td class="num">${num(g.koho)}</td><td class="num">${g.med}倍</td><td class="num">${pct(g.zero, g.n)}%</td><td class="num">${g.houses}</td><td class="num">${g.suki}</td></tr>`).join('\n')}
</tbody></table></div>

<h2>6. 観測できた申込先の索引（${num(F.enough)}件）</h2>
<p>中央値の低い順。上の各章に出ていない申込先もここには載っています。</p>
${C.filter ? filterBlock(D) : `<div class="wrap">${table(enough)}</div>`}

<h2>7. 出典と限界</h2>
<ul>
${LIMITS}
</ul>
<p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。
開けない・内容が説明と著しく異なる・二重に決済された場合は、購入から14日以内のご連絡で全額を返金します。</p>
</body></html>
`
  if (!OPEN) write(`.dist/${C.key}-pack.html`, packHtml)   // 無料にした市は資料を作らない（中身は /<市>/ に出ている）

  // ── 関所：抜粋が有料資料の本文とそのまま一致するか ──────────────────────
  {
    const flat = (x) => x.replace(/<[^>]+>/g, '').replace(/\s/g, '')
    if (!flat(packHtml).includes(flat(PEEK))) die(`${C.city}：抜粋が有料資料の本文と一致しません（抜粋の作り方を確認）。`)
  }

  // /<市>/ の中身が変わったか（書き出す前に、置いてある面と比べる）。lastmod はこれが 'changed' のときだけ今日にする
  const freeRel = `${C.key}/index.html`
  const freeKind = C.freePage !== false ? pageDiff(readPrev(path.join(ROOT, freeRel)), pending.find(([rel]) => rel === freeRel)[1]) : null
  for (const [rel, html] of pending) {
    const p = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, html)
  }

  // ── sitemap（/<市>/ の1行。kanryo は購入者専用なので載せない）────────────
  // ★県営（freePage: false）の /<key>/ の行は scripts/kenei-build.mjs が持つ。ここで書くと lastmod が今日に戻る
  // ★2026-10-11 lastmod は /<市>/ の中身が変わったときだけ今日にする（変わらなければ載っている日付のまま）。それまで比べずに
  //   毎回今日にしていた。読み書きと行の入れ替えは shogai-kojo-page.mjs の readSitemap・putUrls・writeSitemap。
  if (C.freePage !== false) {
    const sm = readSitemap()
    const loc = `${SITE}/${C.key}/`
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    const prev = sitemapLastmods(sm).get(loc)
    const entry = `<url><loc>${loc}</loc><lastmod>${freeKind === 'changed' || !prev ? today : prev}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`
    writeSitemap(putUrls(sm, [[loc, entry]]))
  }

  console.log(OPEN ? `■ ${C.city}  /${C.key}/（一覧まで無料・${(Buffer.byteLength(pending.find(([rel]) => rel === freeRel)[1]) / 1024).toFixed(0)}KB）` : `■ ${C.city}  /${C.key}/ と購入後画面・有料資料 .dist/${C.key}-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
  console.log(`   募集${num(F.rows)}件 → 申込先${F.all}件（${MIN_N}件以上観測 ${F.enough}件）`)
  console.log(`   すいている ${F.suki}件（${F.sukiPct}%）・ぶれる ${F.buread}件・申込0あり ${F.zeroHousesEnough}件`)
  console.log(`   軸＝${C.axis.label} ${F.groups}区分（面に出すのは ${shownGroups.length}）／ ${LO.label} ${LO.med}倍 ↔ ${HI.label} ${HI.med}倍 ＝ ${RATIO}倍`)
  console.log(`   読み取り: 使えた${F.rounds}回${F.skippedRounds.length ? ` ／ 使えない${F.skippedRounds.length}回（${F.skippedRounds.join('・')}）` : ''}${F.matched ? ` ／ 公表合計と一致${F.matched}回・差が説明できる${F.explained}回` : ''}`)
  console.log(OPEN ? '   無料（free）：売り場は /moushikomisaki/ の転送だけ・資料と KV は作らない' : `   次に: node scripts/koei-put-pack.mjs ${C.key}`)
}

// ── ハブ記事へ「実測がそろっている市」の表を差し込む ─────────────────────────
// ★なぜ Python 側（tools/build_koei.py）に書かないか
//   同じ数え方を2か所に書くと必ずずれる。数字の正典は koei-lib.mjs ひとつにして、
//   出来上がった表だけをマーカーの間に置く。build_koei.py は自分のマーカーしか
//   触らないので、月次の再生成でこの表が消えることはない。
//   [[same-question-two-implementations]]
// ★この表を入れるまで、4市の面はサイトのどこからもリンクされていなかった（2026-09-17 実測）。
{
  const S = '<!-- KOEI:JISSOKU:START -->'
  const E = '<!-- KOEI:JISSOKU:END -->'
  const hub = path.join(ROOT, 'articles', 'koei-jutaku-bairitsu.html')
  const page = fs.readFileSync(hub, 'utf8')
  if (page.includes(S) && page.includes(E)) {
    // 面が実際にある市だけ載せる（作っていない市を案内しない）
    // ★売っていない面（大阪府営＝2026-10-01「あえての無料公開」、三大都市圏の外の県＝kenei-free の FREE）も同じ数え方なので並べる
    const { FREE, SHIGA_KEN } = await import('./kenei-free.mjs')
    const cfgs = [...Object.values(KOEI_ALL), OSAKA_FU, SHIGA_KEN, ...FREE.filter((c) => !c.hold)]
    const rows = cfgs.filter((c) => fs.existsSync(path.join(ROOT, c.key, 'index.html'))).map((c) => {
      const D = loadFrom(c)
      return { k: c.key, C: c, F: D.F, RANGE: D.RANGE }
    }).sort((a, b) => b.F.rounds - a.F.rounds)
    const body = [
      '  <div class="table-wrap">',   // ★狭い画面は横スクロールにする。包まないと320pxではみ出す
      '  <table class="tbl">',
      // ★列は3つまで。5列にしたら320px幅で横にはみ出した（scripts/toei-check.mjs が検知）。
      //   細かい数字は colspan の折り返し行に落とす。[[mobile-layout-audit]]
      '    <thead><tr><th>自治体</th><th>回数</th><th>毎回すいている</th></tr></thead>',
      '    <tbody>',
      ...rows.flatMap(({ k, C, F, RANGE }) => [
        `      <tr><th><a href="../${k}/">${C.city}</a></th><td>${F.rounds}回</td><td><strong>${num(F.suki)}件</strong>（${F.sukiPct}%）</td></tr>`,
        `      <tr><td colspan="3" style="font-size:.85em;color:var(--sub)">${RANGE}／申込先${num(F.all)}件（${MIN_N}回以上 ${num(F.enough)}件）／申込者ゼロが出た申込先 ${num(F.zeroHousesEnough)}件</td></tr>`,
      ]),
      '    </tbody>',
      '  </table>',
      '  </div>',
      `  <p style="font-size:.88rem;color:var(--sub)">「毎回すいている」は、${MIN_N}回以上募集のあった申込先のうち、倍率の中央値が${SUKI}倍未満のものです。申込先の数え方は市によって違います（${rows.map((r) => `${r.C.short}＝${r.C.axis.label}まで分ける`).join('／')}）。名前をクリックすると、どの申込先かまで見られます。</p>`,
      // ★2026-10-04 市ごとの「前の回まで何回・どれくらいの倍率だったか」（回全体の倍率の推移）の看板へ
      ...(fs.existsSync(path.join(ROOT, 'koei', 'bairitsu-suii', 'index.html'))
        ? ['  <p>募集回ごとの<strong>回全体の倍率の推移</strong>（前の回まで何回・何倍だったか）を市ごとに並べた表は <a href="../koei/bairitsu-suii/">市営住宅の倍率の推移</a> にあります。</p>'] : []),
    ].join('\n')
    const next = page.replace(new RegExp(`${S}[\\s\\S]*?${E}`), `${S}\n${body}\n  ${E}`)
    // ★改行だけの違いでは書き直さない（2026-10-08）。git が取り出した記事は CRLF なので、読んだそのままと比べると毎回
    //   「差し込みました」になり、CRLF と LF の混ざった記事を書いていた（混ざった記事は、10-08 より前の stamp-offers.mjs の
    //   比べ方だと「変わった」になり、lastmod が進む）。
    if (pageDiff(page, next) !== 'same') {
      fs.writeFileSync(hub, next)
      console.log(`\n■ ハブ記事に実測${rows.length}市の表を差し込みました（articles/koei-jutaku-bairitsu.html）`)
    }
  }
}
