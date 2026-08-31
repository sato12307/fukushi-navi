// ─────────────────────────────────────────────────────────────────────────────
// toei-nerai.mjs — 都営住宅「申込先えらび」の無料ページと有料資料を作る。
//
// ★何を売って、何を売らないか
//   売らない: 申込資格・収入基準・制度の説明。無料記事で全部出している。
//             どの住宅が何回あまったか（募集割れ一覧）も無料でCSV配布済み。
//   売る:     募集回をまたいで名寄せしたうえでの「毎回すいている住宅はどこか」。
//             1回だけ空いた住宅と、いつ見ても空いている住宅は意思決定がまるで違う。
//             公表資料は回ごとのPDFしかなく、横に並べた集計はどこにも無い。
//
// ★出典側の規約に触れないための設計（ここが一番大事）
//   倍率表を出しているのは JKK東京。サイトポリシーで「私的使用又は引用等を除き
//   無断で転載等はできない」「無断で改変を行うことはできない」と明記されている。
//   ∴ **公表表の行をそのまま並べ直したものは作らない。**
//     出すのは当方が計算した指標（中央値・最小・最大・観測件数・応募ゼロ回数）だけで、
//     どの回にいくつ申し込みがあったかという公表表の中身は再現しない。
//     数値そのものは事実であって著作物ではないが、表の丸写しは別の話になる。
//   出所は無料ページ・有料資料の両方に明記する。[[per-page-license-override]]
//
// ★読み取りの限界をそのまま持ち越す
//   PDFは回ごとに列の作りが違い、機械で全部は復元できない。行頭に区市町が
//   書かれていた行（city_trusted）だけを使う。母数が減るほうを選ぶ。
//   「読めなかった」を「空いていた」と混ぜない。[[same-question-two-answers]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRICE = 500
const MIN_N = 4          // これ未満の観測しかない住宅は「毎回」と言えないので狙い目に出さない
const SUKI = 5           // 中央値がこれ未満なら「すいている」
const SRC = 'JKK東京（東京都住宅供給公社）が募集回ごとに公表する「申込地区別倍率表」PDF'
const JIKO = '居室内で病死等があった住宅'

// ★data/toei-bairitsu.json は .gitignore に入れてある（読み取りに未修理の取りこぼしがあるため
//   生の中間ファイルは公開しない）。クローンしただけの環境には無いので、まず PDF から作り直すこと。
const SRC_JSON = path.join(ROOT, 'data', 'toei-bairitsu.json')
if (!fs.existsSync(SRC_JSON)) {
  console.error('data/toei-bairitsu.json がありません（公開していない中間ファイルです）。')
  console.error('倍率表PDFから scripts/toei-parse.py で作り直してください。')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'))
const READ_AT = raw.updated
// 行頭に区市町が明記されていた行だけ。引き継ぎ行は区市町を信用できない。
const rows = raw.rows.filter((r) => r.city_trusted && Number.isFinite(r.bairitsu))
const ROUNDS = [...new Set(rows.map((r) => r.round))].sort()

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const r1 = (x) => Math.round(x * 10) / 10
const mode = (a) => { const c = {}; for (const v of a) c[v] = (c[v] || 0) + 1; return Object.entries(c).sort((p, q) => q[1] - p[1])[0]?.[0] || '' }

// ── 住宅×募集区分ごとに畳む ─────────────────────────────────────────────────
//   ★キーに募集区分を入れる。同じ建物でも「世帯向」と「病死等があった住宅」では
//     倍率がまるで違い、混ぜて中央値を取ると、病死等の回だけ安かった住宅が
//     「毎回すいている」に化ける。申し込む側も区分を選んで出すので、区分ごとに数える。
//   ★地区番号は回ごとに振り直されるのでキーに使わない。
const by = new Map()
for (const r of rows) {
  const k = `${r.city}|${r.name}|${r.cat}`
  if (!by.has(k)) by.set(k, [])
  by.get(k).push(r)
}
const houses = [...by.entries()].map(([k, v]) => {
  const [city, name, cat] = k.split('|')
  const b = v.map((x) => x.bairitsu)
  return {
    city, name, cat,
    n: v.length,                                              // 観測できた募集件数（回数ではない）
    rounds: new Set(v.map((x) => x.round)).size,
    med: med(b), min: Math.min(...b), max: Math.max(...b),
    zero: v.filter((x) => x.moushikomi === 0 && x.bairitsu === 0).length,
    jiko: cat === JIKO,
    ev: mode(v.map((x) => x.ev).filter(Boolean)),
    era: mode(v.map((x) => x.era).filter(Boolean)),
  }
}).sort((a, b) => a.med - b.med || b.n - a.n)

const enough = houses.filter((h) => h.n >= MIN_N)
const suki = enough.filter((h) => h.med < SUKI)
const sukiIppan = suki.filter((h) => !h.jiko)
const buread = enough.filter((h) => h.min > 0 && h.max >= h.min * 10)
const konde = enough.filter((h) => !h.jiko).slice().sort((a, b) => b.med - a.med)
const ALL_MED = med(enough.map((h) => h.med))
const CITIES = [...new Set(rows.map((r) => r.city))].sort()

// 区市町ごとの中央値（無料ページに出す。ここまでは「相場」なので無料）
const byCity = CITIES.map((c) => {
  const hs = enough.filter((h) => h.city === c && !h.jiko)
  return { city: c, n: hs.length, med: hs.length ? med(hs.map((h) => h.med)) : null, suki: hs.filter((h) => h.med < SUKI).length }
}).filter((x) => x.n >= 3).sort((a, b) => a.med - b.med)

// 条件ごとの効き目（EV・築年・人数区分・募集区分）
const cut = (label, groups) => ({ label, groups })
const eraBand = (e) => {
  const m = /(昭和|平成|令和)\s*([0-9]+)/.exec(e || '')
  if (!m) return '不明'
  const y = { 昭和: 1925, 平成: 1988, 令和: 2018 }[m[1]] + Number(m[2])
  return y < 1980 ? '1979年以前' : y < 1990 ? '1980年代' : y < 2000 ? '1990年代' : y < 2010 ? '2000年代' : '2010年以降'
}
const groupMed = (keyOf, src = rows) => {
  const g = {}
  for (const r of src) { const k = keyOf(r); if (!k) continue; (g[k] = g[k] || []).push(r.bairitsu) }
  return Object.entries(g).map(([k, v]) => ({ k, n: v.length, med: med(v) })).sort((a, b) => a.med - b.med)
}
const cuts = [
  cut('エレベーターの有無', groupMed((r) => (r.ev === '有' ? 'エレベーター有' : r.ev === '無' ? 'エレベーター無' : ''))),
  cut('建てられた年', groupMed((r) => eraBand(r.era)).filter((x) => x.k !== '不明')),
  cut('申込区分（人数）', groupMed((r) => (r.ninzu || '').trim()).filter((x) => x.n >= 50)),
  cut('募集区分', groupMed((r) => r.cat).filter((x) => x.n >= 50)),
]

// ── 数字を1か所で作る。無料ページと有料資料で違う数を出さないため ──────────────
const F = {
  rows: rows.length, all: houses.length, enough: enough.length, rounds: ROUNDS.length,
  cities: CITIES.length, allMed: r1(ALL_MED), suki: suki.length, sukiIppan: sukiIppan.length,
  sukiPct: Math.round((suki.length / enough.length) * 100), buread: buread.length,
  zeroHouses: enough.filter((h) => h.zero > 0).length,
  from: ROUNDS[0], to: ROUNDS[ROUNDS.length - 1],
}
const era = (r) => `${r.slice(0, 4)}年${Number(r.slice(5))}月`
const RANGE = `${era(F.from)}〜${era(F.to)}`

const write = (rel, html) => {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
}
const num = (x) => x.toLocaleString('ja-JP')

// ── 無料ページ /toei/ ────────────────────────────────────────────────────────
// ここで出すのは「相場」まで。住宅の実名つきの狙い目一覧が有料の中身。
const cityRows = byCity.map((c) => `<tr><td>${esc(c.city)}</td><td class="num">${c.n}</td><td class="num">${r1(c.med)}倍</td><td class="num">${c.suki}</td></tr>`).join('\n')
const kondeRows = konde.slice(0, 10).map((h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}倍</td><td class="num">${h.n}</td></tr>`).join('\n')
const cutBlocks = cuts.map((c) => `  <h3>${esc(c.label)}</h3>
  <div class="table-wrap"><table><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>
${c.groups.map((g) => `  <tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}
  </tbody></table></div>`).join('\n\n')

write('toei/index.html', page({
  title: `都営住宅で毎回すいている住宅はどこか｜${F.rounds}回の募集を横に並べた実測｜フクシル`,
  desc: `都営住宅は倍率が高いと言われますが、募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せすると、${F.enough}件の申込先のうち${F.suki}件（${F.sukiPct}%）は倍率の中央値が${SUKI}倍未満でした。全体の中央値は${F.allMed}倍です。区市町ごとの相場を無料で公開し、住宅名つきの狙い目一覧を${PRICE}円で配布しています。`,
  canonical: '/toei/', depth: 1,
  body: `  <h1>都営住宅で「毎回すいている住宅」はどこか<br><small>${RANGE}の定期募集${F.rounds}回を、住宅ごとに横に並べた</small></h1>

  <p class="lead">都営住宅は「何十倍で当たらない」と言われます。実際、いちばん混んでいる住宅の倍率の中央値は${r1(konde[0].med)}倍です。
  ところが同じデータを住宅ごとに名寄せすると、<strong>観測できた${F.enough}件の申込先のうち${F.suki}件（${F.sukiPct}%）は中央値が${SUKI}倍未満</strong>でした。全体の中央値は<strong>${F.allMed}倍</strong>です。</p>

  <div class="callout point"><p><span class="tag">なぜどこにも無いのか</span>
  倍率表は募集回ごとのPDFでしか公表されておらず、<strong>回をまたいで同じ住宅を追いかけた集計は公表されていません</strong>。
  そのため「たまたま1回だけ空いた住宅」と「いつ見ても空いている住宅」が区別できず、両方まとめて「倍率が高い」と語られています。
  ここでは${RANGE}の${F.rounds}回ぶん、${num(F.rows)}件の募集を住宅名で名寄せして数えました。</p></div>

  <h2>① 混んでいる住宅（実名・無料）</h2>
  <p>よく引き合いに出されるのはこちらです。${MIN_N}件以上の募集が観測できた申込先のうち、倍率の中央値が高い順。</p>
  <p class="note">同じ建物でも募集区分が違えば別の申込先として数えています。「世帯向」と「病死等があった住宅」では倍率がまるで違うためです。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">倍率の中央値</th><th class="num">観測した募集件数</th></tr></thead><tbody>
${kondeRows}
  </tbody></table></div>

  <h2>② 区市町ごとの相場（無料）</h2>
  <p>${MIN_N}件以上観測できた申込先が3件以上ある${byCity.length}区市町。病死等があった住宅は除いてあります。「すいている数」は、中央値が${SUKI}倍未満だった申込先の件数です。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th class="num">対象の申込先</th><th class="num">倍率の中央値</th><th class="num">すいている数</th></tr></thead><tbody>
${cityRows}
  </tbody></table></div>

  <h2>③ 条件を1つ変えると倍率はどう動くか（無料）</h2>
  <p>募集${num(F.rows)}件を条件ごとに分けて、倍率の中央値を出したものです。何をあきらめると何倍ぶん軽くなるかの目安になります。</p>
${cutBlocks}

  <div class="callout point"><p><span class="tag">手続きまで進めるなら</span>
  ここまでが無料で読めるところです。<strong>買わなくても申し込みはできます。</strong>
  上の相場だけでも、どのあたりを狙うかは決められます。</p></div>

  <h2>④ 住宅名つきの一覧（${PRICE}円）</h2>
  <p>申込書に書けるのは基本的に<strong>1回につき1つ</strong>です。相場が分かっても、最後は住宅名を1つ選ぶことになります。
  そこを決めるための一覧を用意しました。</p>
  <ul>
  <li><strong>毎回すいている申込先 ${F.sukiIppan}件</strong>（病死等があった住宅を除く）。${MIN_N}件以上観測できて、倍率の中央値が${SUKI}倍未満だったものだけ。<strong>1回だけ空いた住宅は入れていません</strong>——ここが自分で集計すると一番外しやすいところです。</li>
  <li><strong>回によって当たりやすさが大きく動く申込先 ${F.buread}件</strong>。最高と最低が10倍以上ひらいた住宅です。住宅を変えるのではなく<strong>出す回を変える</strong>ほうが効く相手が分かります。</li>
  <li><strong>申込者ゼロが出た申込先 ${F.zeroHouses}件</strong>と、その回数。</li>
  <li>観測できた<strong>${F.enough}件すべての索引</strong>（区市町・住宅名・募集区分・倍率の中央値／最低／最高・観測件数・エレベーター・建てられた年）。</li>
  <li>「${JIKO}」${F.suki - F.sukiIppan}件は<strong>別掲</strong>。すいている側にはこの区分が集まるので、知らずに選ぶことがないよう分けました。</li>
  </ul>

  <p><button id="buy" class="cta-btn" type="button">${PRICE}円で購入する（HTML・印刷可）</button></p>
  <p id="msg" class="note"></p>

  <div class="callout warn"><p><span class="tag">先に読んでください</span>
  これは<strong>過去の実測から作った目安</strong>で、次の募集の倍率を約束するものではありません。募集される住宅は回ごとに変わり、
  ここに載っている住宅が次回も募集されるとは限りません。<strong>申込資格（都内在住・収入基準など）を満たすかどうかは別の話</strong>で、
  そちらは<a href="../articles/koei-tokyo.html">無料の記事</a>と東京都・JKK東京の募集案内でご確認ください。</p></div>

  <p class="note">お読みください：<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../kiyaku/">利用規約</a>。
  当サイトは東京都・JKK東京とは関係のない個人が運営しています。</p>

  <div class="sources">
  <h2>出典と、この数字の限界</h2>
  <ul>
  <li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rows)}行だけ</strong>を使っています。したがってここに出ていない住宅も多くあります。</li>
  <li>「観測した募集件数」は募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</li>
  <li>当方が公表表を転載・改変したものではなく、<strong>公表された数値から当方が計算した指標</strong>（中央値・最低・最高・件数）を掲載しています。</li>
  </ul>
  <p class="disclaimer">掲載内容は上記の公表資料を ${READ_AT} 時点で読み取ったもので、当選を保証するものではありません。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related"><a href="../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>
(function(){
  var btn=document.getElementById('buy'), msg=document.getElementById('msg');
  if(!btn) return;
  btn.addEventListener('click', function(){
    if(window.__ev) window.__ev('toei_buy');
    btn.disabled=true; msg.textContent='決済ページへ移動します…';
    fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product:'toei'})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d && d.ok && d.url){ location.href=d.url; return; }
        btn.disabled=false; msg.textContent=(d && d.error) || '決済を開始できませんでした';
      })
      .catch(function(){ btn.disabled=false; msg.textContent='通信に失敗しました。時間をおいてお試しください'; });
  });
})();
</script>
`,
}))

// ── /toei/kanryo/ 購入後の画面（noindex・2階層下）────────────────────────────
write('toei/kanryo/index.html', page({
  title: 'ご購入ありがとうございます｜フクシル',
  desc: '都営住宅 申込先えらびのダウンロード画面です。',
  canonical: '/toei/kanryo/', depth: 2, noindex: true,
  body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">下のボタンからダウンロードしてください。<strong>このページのURLは購入から60日間有効です。</strong>ブックマークしておくと再ダウンロードできます。</p>
  <p><a id="dl" class="card" style="display:inline-block;padding:.8rem 1.6rem;font-weight:600" href="#">一覧をダウンロード（HTML）</a></p>
  <p id="msg" class="note"></p>
  <h2>使い方</h2>
  <ol>
  <li>ダウンロードしたファイルをブラウザで開きます。</li>
  <li>まず「毎回すいている住宅」を自分の通える区市町でしぼってください。</li>
  <li>次の募集案内が出たら、その回に実際に募集されている住宅と突き合わせます。<strong>載っていても、その回に募集が無いことがあります。</strong></li>
  <li>印刷して持っていけます（ブラウザの印刷から「PDFに保存」もできます）。</li>
  </ol>
  <p class="note">開けない・内容が説明と違う・二重に決済された場合は、購入から14日以内に <a href="mailto:contact@fukushiru.com">contact@fukushiru.com</a> までご連絡ください。全額を返金します。
  領収書はStripeから届くメールでご確認いただけます。</p>
  <p class="related"><a href="../../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>
(function(){
  var sid=new URLSearchParams(location.search).get('session_id');
  var a=document.getElementById('dl'), msg=document.getElementById('msg');
  if(!sid){ a.style.display='none'; msg.textContent='購入の情報が見つかりません。購入後に表示されたURLからお越しください。'; return; }
  a.href='/api/pack?session_id='+encodeURIComponent(sid);
})();
</script>
`,
}))

// ── 有料資料 .dist/toei-pack.html ────────────────────────────────────────────
// ★公表表の再現はしない。出すのは当方が計算した指標だけ。
const hrow = (h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td>${esc(h.ev)}</td><td>${esc(h.era)}</td></tr>`
const table = (list) => `<table class="grid"><thead><tr><th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th>EV</th><th>建築</th></tr></thead><tbody>
${list.map(hrow).join('\n')}
</tbody></table>`
const sukiByCity = [...new Set(sukiIppan.map((h) => h.city))].sort().map((c) => {
  const hs = sukiIppan.filter((h) => h.city === c).sort((a, b) => a.med - b.med)
  return `<h3>${esc(c)}（${hs.length}件）</h3>\n${table(hs)}`
}).join('\n\n')

const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>都営住宅 申込先えらび（${RANGE}・${F.rounds}回の実測）｜フクシル</title>
<style>
:root{--ink:#1d2430;--sub:#5b6676;--line:#dfe4ea;--bg:#fff;--accent:#1668a8;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.2rem 4rem;font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  line-height:1.75;color:var(--ink);background:var(--bg);max-width:60rem;margin-inline:auto}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.4rem 0 .6rem;padding-bottom:.3rem;border-bottom:2px solid var(--accent)}
h3{font-size:1rem;margin:1.6rem 0 .4rem;color:var(--accent)}
small{color:var(--sub);font-weight:400}
.lead{color:var(--sub)}
.box{border:1px solid var(--line);border-left:4px solid var(--accent);background:#f7fafc;padding:.8rem 1rem;margin:1rem 0;border-radius:4px}
.box.warn{border-left-color:var(--warn);background:#fff8ed}
.tag{display:inline-block;font-size:.78rem;font-weight:700;color:#fff;background:var(--accent);padding:.1rem .5rem;border-radius:3px;margin-right:.4rem}
.box.warn .tag{background:var(--warn)}
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.grid{border-collapse:collapse;width:100%;font-size:.86rem;margin:.4rem 0 1rem;min-width:44rem}
table.grid th,table.grid td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;white-space:nowrap}
table.grid th{background:#eef3f7;position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:.86rem;color:var(--sub)}
@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}table.grid{font-size:.7rem;min-width:0}.wrap{overflow:visible}}
</style></head><body>

<h1>都営住宅 申込先えらび<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（https://fukushiru.com）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（都内在住・収入基準・世帯構成）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は東京都・JKK東京の募集案内でご確認ください。この資料は資格の判定をしません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先（住宅×募集区分） <strong>${F.all}件</strong>。うち${MIN_N}件以上の募集が観測できた <strong>${F.enough}件</strong>を集計の対象にしています。</li>
<li>同じ建物でも募集区分が違えば別に数えています。混ぜると、病死等があった回だけ安かった住宅が「毎回すいている」に化けるためです。</li>
<li>その${F.enough}件の倍率の中央値は <strong>${F.allMed}倍</strong>。</li>
<li>中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。うち病死等があった住宅を除くと${F.sukiIppan}件。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${F.zeroHouses}件</strong>。</li>
<li>最高と最低が10倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
</ul>
<p class="note">「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</p>

<h2>2. 毎回すいている申込先（病死等があった住宅を除く・${F.sukiIppan}件）</h2>
<p>${MIN_N}件以上観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを載せています。
中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。区市町ごと、倍率の低い順。</p>
<div class="wrap">
${sukiByCity}
</div>

<h2>3. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が10倍以上ひらいた住宅です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。
最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">
${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}
</div>

<h2>4. ${JIKO}（別掲・${suki.length - sukiIppan.length}件）</h2>
<p>すいている住宅にはこの区分が混ざります。知らずに選ぶことがないよう分けました。
家賃が減額される場合があり、条件を承知のうえで選ぶ人には現実的な選択肢です。詳しい条件は募集案内をご確認ください。</p>
<div class="wrap">
${table(suki.filter((h) => h.jiko))}
</div>

<h2>5. 条件を1つ変えたときの効き目</h2>
<p>募集${num(F.rows)}件を条件ごとに分けた倍率の中央値です。何をあきらめると何倍ぶん軽くなるかの目安。</p>
${cuts.map((c) => `<h3>${esc(c.label)}</h3>\n<div class="wrap"><table class="grid"><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>\n${c.groups.map((g) => `<tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}\n</tbody></table></div>`).join('\n')}

<h2>6. 観測できた申込先の索引（${F.enough}件）</h2>
<p>中央値の低い順。上の各章に出ていない申込先もここには載っています。</p>
<div class="wrap">
${table(enough)}
</div>

<h2>7. 出典と限界</h2>
<ul>
<li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
<li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rows)}行だけ</strong>を使っています。ここに出ていない住宅も多くあります。<strong>「載っていない＝空いていない」ではありません。</strong></li>
<li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
<li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
</ul>
<p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。
開けない・説明と違う場合は購入から14日以内のご連絡で全額返金します。</p>

</body></html>
`
write('.dist/toei-pack.html', packHtml)

// ── sitemap.xml（この艦のsitemapは手書きで育てたもの。/toei/ のぶんだけ入れ替える）──
//   ★/toei/kanryo/ は購入者専用（noindex）なので載せない。
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
sm = sm.replace(/^\s*<url>(?:(?!<\/url>)[\s\S])*\/toei\/[\s\S]*?<\/url>\n?/gm, '')
sm = sm.replace('</urlset>', `  <url><loc>${SITE}/toei/</loc><lastmod>${READ_AT}</lastmod><priority>0.9</priority></url>\n</urlset>`)
fs.writeFileSync(smPath, sm)

console.log(`無料ページ /toei/ と購入後画面を作成`)
console.log(`有料資料 .dist/toei-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
console.log(`  募集${num(F.rows)}件 → 住宅${F.all}件（うち${MIN_N}件以上観測 ${F.enough}件）`)
console.log(`  すいている ${F.suki}件（一般${F.sukiIppan}／事故住宅${F.suki - F.sukiIppan}）・ぶれる ${F.buread}件・申込0あり ${F.zeroHouses}件`)
