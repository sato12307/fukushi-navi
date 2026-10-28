// ─────────────────────────────────────────────────────────────────────────────
// kaigo-hokenryo-page.mjs — 65歳以上の介護保険料（第1号被保険者・令和8年度）の計算機の面 /kaigo/hokenryo/ を作る。
//   node scripts/kaigo-hokenryo-page.mjs                 → kaigo/hokenryo/index.html と sitemap.xml の1行
//   node scripts/kaigo-hokenryo-page.mjs --dry           → 書かずに確かめの結果だけ
//   node scripts/kaigo-hokenryo-page.mjs --dry --out <パス> → 確かめのうえ、面の HTML を <パス> にだけ書く（sitemap は触らない・中身の目視用）
//
// ★なぜ（2026-10-28 ユーザー「介護保険料の計算機を1枚足す」）
//   Bing 月間「介護保険料」12,801。読み手は年金暮らしの高齢者とその家族。フクシルには65歳以上の介護保険料の面が無かった
//   （/hikazei/〈市区町村〉/ の国保の節は「65〜74歳は介護保険料を別に納める（この表に入っていない）」と書くだけ）。
// ★ユーザーの方針（2026-10-28）
//   ・全国共通の段階判定（国の標準13段階）は必ず出す。
//   ・年額は、主要な市（公式の基準額と段階表を確かめられた所）は選ぶだけで出す。段階の数や倍率が標準と違う市は、その市の表で計算する。
//     写せなかった市は選択肢に入れない（無理に数を揃えない）。
//   ・それ以外は、通知書や市区町村のサイトにある基準額（年額か月額）を入れてもらい、国の標準段階で計算する。
//     「お住まいの市区町村が独自の段階を使っていると金額がずれる」ことをはっきり書く。
// ★数字はここに書かない。data/kaigo-hokenryo.json（e-Gov の介護保険法施行令 第38条・施行規則 第143条、厚労省の第9期の発表、
//   各市の公式ページから写したもの）だけを読む。
// ★計算の式は下の CORE の1か所だけ。収入→所得（公的年金等控除）は shotoku-core.mjs を使う（式を2回書かない）。
//   node で scripts/kaigo-hokenryo-cases.mjs（各市が公表している段階ごとの年額・計算例）に通して円まで合うか確かめ、
//   1円でも違えば止める。同じ CORE を面の <script> に埋め込む。
// ★市の表で「公表の年額と円まで合わなかった市」は選択肢に入れない（data の verified が '表' か '例' の市だけ出す）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { CASES } from './kaigo-hokenryo-cases.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null })()
if (OUT && !DRY) die('--out は --dry と一緒にだけ使えます（本番の書き出しは親が順番にやる）')
const REL = 'kaigo/hokenryo/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kaigo-hokenryo.json'), 'utf8'))

// ── 計算の式（ここだけ）。ブラウザでもそのまま動く書き方にする ─────────────────────────────
// round：y1＝基準額×倍率の1円未満切捨て／y10＝10円未満切捨て／h100＝100円未満切捨て／r1＝四捨五入／c1＝1円未満切上げ／
//   c1y10＝1円未満切上げのあと10円未満切捨て／c10＝10円未満切上げ／c100＝100円未満切上げ／r100＝100円未満四捨五入／
//   m1＝月額（基準額÷12）×倍率の1円未満切捨て×12／m10c＝月額×倍率の10円未満切上げ×12／m10f＝月額×倍率の10円未満切捨て×12
// seihoOnly＝生活保護・老齢福祉年金の人だけの段階（所得の線では入らない。82.65万円以下の人は次の段階）
// T＝段階表 { kijunNen, round, stages:[{ no, bp, seiho, honnin:'hi'|'ka', setai:'hi'|'ka'|null, xMax, gMax, gLe }] }
//   bp＝倍率×10000（0.285→2850）。xMax＝「課税年金収入＋年金以外の合計所得」の上限（以下）。gMax＝合計所得金額の上限（未満。gLe なら以下）。
// q＝{ nenkin: 公的年金等の収入, sonota: 年金以外の合計所得金額, honnin: 'hi'|'ka', setai: 'hi'|'ka', seiho: 生活保護・老齢福祉年金 }
const CORE = `${SHOTOKU_CORE}
function kaigoGaku(kijunNen, bp, round) { var y = kijunNen * bp / 10000, m = kijunNen * bp / 120000, fl = Math.floor, ce = Math.ceil, e = 1e-7;
  if (round === 'm1') return fl(m + e) * 12;
  if (round === 'm10c') return ce(m / 10 - e) * 120;
  if (round === 'm10f') return fl(m / 10 + e) * 120;
  if (round === 'c1') return ce(y - e);
  if (round === 'c1y10') return fl(ce(y - e) / 10 + e) * 10;
  if (round === 'c10') return ce(y / 10 - e) * 10;
  if (round === 'c100') return ce(y / 100 - e) * 100;
  if (round === 'r100') return Math.round(y / 100) * 100;
  if (round === 'h100') return fl(y / 100 + e) * 100;
  if (round === 'y10') return fl(y / 10 + e) * 10;
  if (round === 'r1') return Math.round(y);
  return fl(y + e); }
function kaigoCalc(T, q) {
  var nenkin = Math.max(q.nenkin || 0, 0), sonota = Math.max(q.sonota || 0, 0);
  var nk = nenkinShotoku(nenkin, sonota, true), G = nk + sonota, X = nenkin + sonota;
  var hit = -1, s, i;
  for (i = 0; i < T.stages.length && hit < 0; i++) { s = T.stages[i];
    if (q.seiho) { if (s.seiho) hit = i; continue; }
    if (s.seihoOnly) continue;
    if (q.honnin === 'hi') { if (s.honnin === 'hi' && s.setai === (q.setai === 'ka' ? 'ka' : 'hi') && (s.xMax == null || X <= s.xMax)) hit = i; }
    else if (s.honnin === 'ka' && (s.gMax == null || (s.gLe ? G <= s.gMax : G < s.gMax))) hit = i; }
  if (hit < 0) return null;
  s = T.stages[hit]; var nen = kaigoGaku(T.kijunNen, s.bp, T.round);
  return { i: hit, no: s.no, bp: s.bp, nen: nen, tsuki: nen / 12, kai6: nen / 6, X: X, G: G, nk: nk };
}`
const { kaigoCalc, kaigoGaku } = new Function(`${CORE}\nreturn { kaigoCalc: kaigoCalc, kaigoGaku: kaigoGaku }`)()

// ── 確かめ（写し間違いと式の誤りで止める）───────────────────────────────────────────
const toBp = (s) => { const m = String(s).match(/^(\d+)(?:\.(\d{1,4}))?$/); if (!m) die(`倍率「${s}」が読めません（小数4けたまで）`); return Number(m[1]) * 10000 + Number((m[2] || '').padEnd(4, '0')) }
const KOKU = D.koku
// 国の標準（施行令 第38条第1項・第11〜13項、施行規則 第143条）の形
if (KOKU.stages.length !== 13) die('国の標準段階が13ありません')
const wantBairitsu = ['0.455', '0.685', '0.69', '0.9', '1', '1.2', '1.3', '1.5', '1.7', '1.9', '2.1', '2.3', '2.4']
KOKU.stages.forEach((s, i) => { if (String(s.bairitsuMae ?? s.bairitsu) !== wantBairitsu[i]) die(`国の標準 第${i + 1}段階の倍率（軽減前）が施行令の ${wantBairitsu[i]} ではありません`) })
const kei = KOKU.keigenMax // 公費による軽減の上限（施行令 第38条第11〜13項）
if (toBp(KOKU.stages[0].bairitsuMae) - toBp(KOKU.stages[0].bairitsu) !== toBp(kei[0]) || toBp(KOKU.stages[1].bairitsuMae) - toBp(KOKU.stages[1].bairitsu) !== toBp(kei[1]) || toBp(KOKU.stages[2].bairitsuMae) - toBp(KOKU.stages[2].bairitsu) !== toBp(kei[2])) die('国の標準の軽減後の倍率が「軽減前−軽減の上限」になっていません')
const L = D.lines
if (L.x1 !== 826500 || L.x2 !== 1200000) die('非課税の線（82.65万円・120万円）が施行令の値ではありません')
if (L.g.join() !== '1200000,2100000,3200000,4200000,5200000,6200000,7200000') die('基準所得金額（120・210・320万円＋100万円刻み）が施行規則・施行令の値ではありません')

const table = (c) => ({ city: c.city, kijunNen: c.kijunNen, round: c.round, stages: c.stages.map((s) => ({ no: s.no, bp: toBp(s.bairitsu), seiho: !!s.seiho, seihoOnly: !!s.seihoOnly, honnin: s.honnin, setai: s.setai ?? null, xMax: s.xMax ?? null, gMax: s.gMax ?? null, gLe: !!s.gLe })) })
const KT = table({ city: '国の標準', kijunNen: 0, round: 'y1', stages: KOKU.stages })
// 段階の並びの形（非課税の段階が先、課税の段階は線が上がっていく、最後は上限なし）
const shape = (T, name) => {
  let lastG = -1, seenKa = false
  T.stages.forEach((s, i) => {
    if (!['hi', 'ka'].includes(s.honnin)) die(`${name} ${s.no} の本人課税の印が無い`)
    if (s.honnin === 'hi' && seenKa) die(`${name} ${s.no}：課税の段階のあとに非課税の段階がある`)
    if (s.honnin === 'ka') { seenKa = true; const g = s.gMax ?? Infinity; if (g <= lastG) die(`${name} ${s.no}：合計所得の線が上がっていない`); lastG = g; if (s.gMax == null && i !== T.stages.length - 1) die(`${name} ${s.no}：上限なしの段階が最後ではない`) }
    if (!(s.bp > 0 && s.bp < 100000)) die(`${name} ${s.no}：倍率が範囲の外`)
  })
  if (!T.stages.some((s) => s.seiho)) die(`${name}：生活保護の人の段階が無い`)
  if (T.stages[T.stages.length - 1].gMax != null) die(`${name}：最後の段階に上限がある`)
}
shape(KT, '国の標準')

const CITIES = D.cities.filter((c) => c.verified === '表' || c.verified === '例')
const CT = Object.fromEntries(CITIES.map((c) => [c.city, table(c)]))
for (const c of CITIES) {
  const T = CT[c.city]
  shape(T, c.city)
  if (!c.sources?.length || !c.sources.every((s) => /^https:\/\//.test(s.url))) die(`${c.city} の出典 URL がありません`)
  // 厚労省の第9期の保険者別の基準額（月額）と、市が公表する基準額が合うか（写し間違いの見張り）
  if (c.mhlwGetsu != null && Math.abs(c.kijunNen / 12 - c.mhlwGetsu) >= 1) die(`${c.city} の基準額 年${c.kijunNen}円が厚労省の一覧の月${c.mhlwGetsu}円と合いません`)
}

let nCase = 0, nNen = 0
const casesByCity = {}
for (const k of CASES) {
  const T = CT[k.city]
  if (!T) die(`検算の ${k.city} が選べる市（verified＝表・例）に入っていません`)
  casesByCity[k.city] = (casesByCity[k.city] || 0) + 1
  if (k.stageNen) { // 市が公表している段階ごとの年額（基準額×倍率→端数の決まり）
    if (k.stageNen.length !== T.stages.length) die(`${k.city}：公表の段階の数（${k.stageNen.length}）と data の段階の数（${T.stages.length}）が違います`)
    T.stages.forEach((s, i) => { const got = kaigoGaku(T.kijunNen, s.bp, T.round); if (got !== k.stageNen[i]) die(`${k.city} ${s.no} の年額が合いません：公表 ${k.stageNen[i]}／計算 ${got}（基準額${T.kijunNen}×${s.bp / 10000}・端数${T.round}）`); nNen++ })
  } else { // 計算例（収入と課税の別→段階と年額）
    const r = kaigoCalc(T, k.q)
    if (!r || r.no !== k.want.no || r.nen !== k.want.nen) die(`${k.city} の計算例（年金${(k.q.nenkin || 0) / 10000}万円…）が合いません：公式 ${k.want.no}・${k.want.nen}円／計算 ${r ? `${r.no}・${r.nen}円` : '段階なし'}`)
  }
  nCase++
}
for (const c of CITIES) if (!casesByCity[c.city]) die(`${c.city} は検算のケースが1つも無いのに選べるようになっています`)
// 国の標準：線のちょうど上下で段階が切り替わるか（式の見張り）
const std = (q) => kaigoCalc({ ...KT, kijunNen: 100000 }, { honnin: 'hi', setai: 'hi', ...q })
const chk = [[{ nenkin: L.x1 }, '第1段階'], [{ nenkin: L.x1 + 1 }, '第2段階'], [{ nenkin: L.x2 }, '第2段階'], [{ nenkin: L.x2 + 1 }, '第3段階'], [{ setai: 'ka', nenkin: L.x1 }, '第4段階'], [{ setai: 'ka', nenkin: L.x1 + 1 }, '第5段階'], [{ honnin: 'ka', nenkin: 2300000 - 1 }, '第6段階'], [{ honnin: 'ka', nenkin: 2300000 }, '第7段階'], [{ honnin: 'ka', sonota: 7200000 }, '第13段階'], [{ seiho: true, honnin: 'ka', nenkin: 9000000 }, '第1段階']]
for (const [q, w] of chk) { const r = std(q); if (!r || r.no !== w) die(`国の標準の線の確かめで ${JSON.stringify(q)} が ${w} になりません（${r?.no}）`) }
console.log(`確かめ：国の標準13段階（施行令・施行規則の倍率と線）・線の上下${chk.length}点／選べる市 ${CITIES.length}（${CITIES.map((c) => c.city).join('・')}）／検算 ${nCase}件（段階ごとの公表年額 ${nNen}個）が円まで一致`)
const skipped = D.cities.filter((c) => !(c.verified === '表' || c.verified === '例'))
if (skipped.length) console.log(`選択肢に入れなかった市：${skipped.map((c) => `${c.city}（${c.why || '未照合'}）`).join('・')}`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const T = (n) => (n % 10000 === 0 ? num(n / 10000) : String(n / 10000)) + '万円'
const bair = (bp) => String(bp / 10000)
const AVG = D.kokuAverage
const kijunAvgNen = AVG.getsu * 12
const sampleStd = (q) => kaigoCalc({ ...KT, kijunNen: kijunAvgNen }, q)
const ex80 = sampleStd({ nenkin: 800000, honnin: 'hi', setai: 'hi' })
const ex150 = sampleStd({ nenkin: 1500000, honnin: 'hi', setai: 'hi' })
const ex200 = sampleStd({ nenkin: 2000000, honnin: 'ka' })

const JS = `${CORE}
(function(){var KT=${JSON.stringify(KT)};
var CT=${JSON.stringify(CT)};
var CN=${JSON.stringify(Object.fromEntries(CITIES.map((c) => [c.city, { verified: c.verified, label: c.kijunLabel || '', note: [c.pageNote, c.kijunLabel ? `計算に使う基準額は${num(c.kijunNen)}円（${c.roundNote}）。` : ''].filter(Boolean).join(' ') }])))};
var $=function(i){return document.getElementById(i)};function yen(n){return Math.round(n).toLocaleString('ja-JP')+'円'}
function man(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');if(s==='')return 0;var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x*10000):0}
function en(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');if(s==='')return 0;var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x):0}
function bai(bp){return String(bp/10000)}
function cond(s){if(s.seihoOnly)return '生活保護を受けている人、老齢福祉年金を受けていて世帯全員が住民税非課税の人';if(s.honnin==='hi'){var a=s.setai==='ka'?'本人は住民税非課税・世帯に課税の人がいる':'世帯全員が住民税非課税';return a+(s.xMax!=null?'で、年金収入＋その他の所得が'+(s.xMax/10000)+'万円以下':'で、上の段階に当たらない人')+(s.seiho?'（生活保護を受けている人などを含む）':'')}
 return '本人が住民税課税で、合計所得金額が'+(s.gMax!=null?(s.gMax/10000)+'万円'+(s.gLe?'以下':'未満'):'それより上')}
function calc(){var mode=$('q-city').value,o=$('q-out'),T,manual=mode==='__manual';
 $('q-man').style.display=manual?'':'none';var hk=$('q-honnin').value;$('q-setai-row').style.display=hk==='hi'?'':'none';
 if(manual){var unit=$('q-unit').value,k=en('q-kijun');T={stages:KT.stages,round:'y1',kijunNen:unit==='getsu'?k*12:k}}else T=CT[mode];
 var q={nenkin:man('q-nenkin'),sonota:man('q-sonota'),honnin:hk,setai:$('q-setai').value,seiho:$('q-seiho').checked};
 var r=kaigoCalc(T,q);if(!r){o.innerHTML='<p class="bd">段階を判定できませんでした。入力を確かめてください。</p>';return}
 var s=T.stages[r.i],h='<p class="total">'+r.no+'（基準額×'+bai(r.bp)+'）</p>';
 if(manual&&!T.kijunNen)h+='<p class="bd">基準額を入れると年額を計算します。</p>';
 else h+='<p class="total">年額 '+yen(r.nen)+'</p><p class="bd">月あたり約'+yen(r.tsuki)+'／年金から天引き（年6回）なら1回あたり約'+yen(r.kai6)+'（基準額 '+(!manual&&CN[mode].label?CN[mode].label:'年'+yen(T.kijunNen))+'）</p>';
 var why=q.seiho?'生活保護を受けている（または老齢福祉年金を受けていて世帯全員が非課税）ので、いちばん下の段階です。':
  (hk==='hi'?'判定に使う額＝年金収入 '+yen(q.nenkin)+'＋年金以外の所得 '+yen(q.sonota)+' ＝ <strong>'+yen(r.X)+'</strong>。':'合計所得金額＝年金の所得 '+yen(r.nk)+'（年金収入 '+yen(q.nenkin)+'−公的年金等控除）＋年金以外の所得 '+yen(q.sonota)+' ＝ <strong>'+yen(r.G)+'</strong>。')+' この段階の条件：'+cond(s)+'。';
 h+='<p class="bd"><strong>なぜこの段階か</strong>：'+why+'</p>';
 if(manual)h+='<p class="bd"><strong>国の標準の13段階で計算しています。</strong>お住まいの市区町村が段階の数や倍率を独自に決めていると、金額がずれます（多くの市区町村は独自の段階を使っています）。端数は1円未満切り捨てで出しています。正しい段階と年額は、保険料の決定通知書か市区町村の案内の段階表で確かめてください。</p>';
 else h+='<p class="check-mark">'+mode+'の段階表（令和8年度）で計算しています。'+mode+'が公表している段階ごとの年額と、この計算が全段階で1円まで合うことを確かめています。'+(CN[mode].note?' '+CN[mode].note:'')+'</p>';
 o.innerHTML=h;
 var rows='';for(var i=0;i<T.stages.length;i++){var t=T.stages[i];rows+='<tr'+(i===r.i?' class="hit"':'')+'><th>'+t.no+'</th><td>'+cond(t)+'</td><td class="num">'+bai(t.bp)+'</td><td class="num">'+(T.kijunNen?yen(kaigoGaku(T.kijunNen,t.bp,T.round)):'—')+'</td></tr>'}
 $('q-tbl-cap').textContent=(manual?'国の標準の13段階':mode+'の段階')+'（令和8年度）'+(manual&&T.kijunNen?'・入れた基準額 年'+yen(T.kijunNen)+'で計算':'');$('q-tbl').innerHTML=rows}
['q-city','q-unit','q-kijun','q-nenkin','q-sonota','q-honnin','q-setai','q-seiho'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const cityOpts = CITIES.map((c) => `<option value="${esc(c.city)}">${esc(c.city)}（基準額 ${c.kijunLabel ? esc(c.kijunLabel) : `年${num(c.kijunNen)}円`}）</option>`).join('')
const stdRows = KOKU.stages.map((s, i) => `<tr><th>${esc(s.no)}</th><td>${esc(s.text)}</td><td class="num">${esc(s.bairitsu)}${s.bairitsuMae && s.bairitsuMae !== s.bairitsu ? `<br><small>（軽減前 ${esc(s.bairitsuMae)}）</small>` : ''}</td><td class="num">${yen(kaigoGaku(kijunAvgNen, toBp(s.bairitsu), 'y1'))}</td></tr>`).join('\n')
const cityRows = CITIES.map((c) => `<tr><th>${esc(c.city)}</th><td class="num">${c.kijunLabel ? esc(c.kijunLabel) : num(c.kijunNen)}</td><td class="num">${c.stages.length}</td><td>${c.stages.length === 13 && c.stages.every((s, i) => toBp(s.bairitsu) === toBp(KOKU.stages[i].bairitsu)) ? '国の標準と同じ' : '独自'}</td></tr>`).join('\n')

const FAQ = [
  ['65歳以上の介護保険料はいくらですか？', `住んでいる市区町村の「基準額」に、所得の段階ごとの倍率を掛けた額です。令和6〜8年度（第9期）の基準額の全国平均は月${num(AVG.getsu)}円（年${num(kijunAvgNen)}円）で、市区町村によって大きく違います。国の標準の段階では、倍率は基準額の${KOKU.stages[0].bairitsu}倍から${KOKU.stages[12].bairitsu}倍までの13段階です。このページで市を選ぶか、基準額を入れると年額が分かります。`],
  ['年金だけで暮らしている人の介護保険料は？', `世帯全員が住民税非課税なら第1〜3段階、本人は非課税でも同じ世帯に課税の人がいれば第4・5段階です。たとえば全国平均の基準額（月${num(AVG.getsu)}円）・国の標準の段階で、世帯全員が非課税で年金収入80万円なら${ex80.no}・年${yen(ex80.nen)}、年金収入150万円なら${ex150.no}・年${yen(ex150.nen)}です。本人が課税で年金収入200万円なら${ex200.no}・年${yen(ex200.nen)}です。`],
  ['介護保険料の段階は何で決まりますか？', `その年度の4月1日（賦課期日）の、本人と世帯の住民税が課税か非課税かと、前の年の所得で決まります。本人が非課税の人は「前の年の公的年金等の収入＋年金以外の合計所得金額」が${T(L.x1)}以下か、${T(L.x2)}以下かで分かれます（令和8年度）。本人が課税の人は合計所得金額で、国の標準では${L.g.map(T).join('・')}を線に段階が上がります。遺族年金・障害年金は収入に入れません。`],
  ['第1段階の80.9万円は令和8年度から変わりましたか？', `はい。国の基準（介護保険法施行令）は、令和8年4月1日から第1段階・第4段階の線を80万9千円から${num(L.x1)}円に上げました（令和8年度の保険料から）。このページで選べる市区はどれも令和8年度の表で82万6,500円になっています。ただし市区町村のサイトに古い額（80万9千円・80万円）が残っていることもあるので、通知書の段階表で確かめてください。`],
  ['年金から天引きされる介護保険料は1回いくら？', '年金が年18万円以上の人は、原則として年金から年6回（偶数月）天引きされます（特別徴収）。4・6・8月は前の年度の額をもとにした仮の額（仮徴収）、10・12・2月は年額から仮徴収分を引いた残りを3回で割った額（本徴収）なので、1回の額は年額÷6と一致しないことがあります。'],
  ['令和9年度から介護保険料は変わりますか？', `介護保険料の基準額と段階は3年ごとに見直されます。令和9年度（2027年度）からは第10期（令和9〜11年度）になり、各市区町村が令和9年3月ごろまでに条例で新しい基準額と段階を決めます。${esc(D.next.note)}`],
]

const body = `  <p class="lead"><strong>65歳以上の人（第1号被保険者）の介護保険料</strong>は、<strong>住んでいる市区町村の基準額</strong>に、<strong>本人と世帯の住民税の課税の別・前の年の所得で決まる段階の倍率</strong>を掛けた額です。年金収入などを入れると、${esc(D.nendo)}の段階と年額を計算します。段階の判定は国の標準（全国共通の13段階）で必ず出し、年額は主な市なら選ぶだけ、それ以外は通知書や市区町村のサイトにある基準額を入れて出します。</p>

  <div class="callout point">
    <p><span class="tag">${esc(D.nendo)}の介護保険料（${esc(D.ki)}）</span><br>年額＝<strong>基準額×段階の倍率</strong>（国の標準は${KOKU.stages[0].bairitsu}倍〜${KOKU.stages[12].bairitsu}倍の13段階）<br>基準額の全国平均：<strong>月${num(AVG.getsu)}円</strong>（年${num(kijunAvgNen)}円・第8期は月${num(AVG.prev)}円）<br>世帯全員が非課税で「年金収入＋その他の所得」が${T(L.x1)}以下なら第1段階（令和8年度から${T(L.x1)}）</p>
  </div>

  <h2 id="keisan">介護保険料を計算する（${esc(D.nendo)}）</h2>
  <div class="calc">
    <div class="row"><label for="q-city">住んでいる市区町村</label><select id="q-city">${cityOpts}<option value="__manual" selected>上にない（基準額を入れる・国の標準の段階で計算）</option></select></div>
    <div id="q-man">
      <div class="row"><label for="q-kijun">基準額（通知書・市区町村のサイトに載っている額）</label><input id="q-kijun" type="text" inputmode="numeric" placeholder="例 74700"> <select id="q-unit"><option value="nen">年額（円）</option><option value="getsu">月額（円）</option></select></div>
      <p class="mini-note">基準額は「第5段階（基準額）」「基準月額」などと書かれています。月額で入れると×12で年額にします。<strong>市区町村が段階の数や倍率を独自に決めていると、ここでの金額はずれます。</strong></p>
    </div>
    <p class="mini-note">金額は<strong>万円</strong>で入れてください（例：年金が年150万円なら 150）。${esc(D.shotokuNen)}（前の年）の1年分です。遺族年金・障害年金は入れません。</p>
    <div class="row"><label for="q-nenkin">公的年金等の収入（万円・年）</label><input id="q-nenkin" type="text" inputmode="decimal" placeholder="例 150"></div>
    <div class="row"><label for="q-sonota">年金以外の所得（事業・不動産・給与などの所得の合計・万円）</label><input id="q-sonota" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label for="q-honnin">あなたの住民税（${esc(D.nendo)}）</label><select id="q-honnin"><option value="hi">非課税</option><option value="ka">課税されている</option></select></div>
    <div class="row" id="q-setai-row"><label for="q-setai">同じ世帯（住民票）の人の住民税</label><select id="q-setai"><option value="hi">全員が非課税</option><option value="ka">課税されている人がいる</option></select></div>
    <div class="row"><label><input id="q-seiho" type="checkbox"> 生活保護を受けている（または老齢福祉年金を受けていて世帯全員が非課税）</label></div>
    <div class="out" id="q-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">住民税が課税か非課税か分からないときは、<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で目安が分かります（65歳以上・単身で年金だけなら、1級地で年金収入155万円以下が非課税の目安）。正式な額は、7月ごろに届く介護保険料の決定通知書で確かめてください。</p>

  <h2 id="dankai">段階と年額の表</h2>
  <div class="table-wrap"><table class="fit">
    <caption id="q-tbl-cap"></caption>
    <thead><tr><th>段階</th><th>条件</th><th class="num">倍率</th><th class="num">年額</th></tr></thead>
    <tbody id="q-tbl"></tbody>
  </table></div>
  <p class="mini-note">上の計算機で市を選ぶと、この表もその市の段階に変わります。あなたの段階に色がつきます。</p>

  <h2 id="hyojun">国の標準の13段階（令和6〜8年度）</h2>
  <p>国が示す標準の段階と倍率です（介護保険法施行令 第38条）。第1〜3段階は、公費（消費税）でさらに軽くした後の倍率です。右の年額は、基準額を全国平均（月${num(AVG.getsu)}円＝年${num(kijunAvgNen)}円）としたときの目安です。</p>
  <div class="table-wrap"><table class="fit">
    <caption>国の標準の段階（${esc(D.nendo)}）と、全国平均の基準額での年額の目安</caption>
    <thead><tr><th>段階</th><th>対象</th><th class="num">倍率</th><th class="num">年額の目安</th></tr></thead>
    <tbody>
${stdRows}
    </tbody>
  </table></div>
  <ul>
    <li><strong>「年金収入＋その他の所得」</strong>＝前の年の課税される公的年金等の収入（遺族・障害年金は入れない）＋合計所得金額から年金の所得を除いた額。給与所得がある人は、この判定では給与所得から10万円を引きます。</li>
    <li><strong>合計所得金額</strong>＝年金の所得（年金収入−公的年金等控除。65歳以上で年金収入330万円未満なら110万円を引く）＋ほかの所得。土地・建物を売ったときの特別控除は引きます。</li>
    <li>市区町村は、国の標準と違う段階（段階を増やす・倍率や所得の線を変える）を条例で決めることができ、実際に多くの市区町村が独自の段階を使っています。</li>
  </ul>
  <p class="mini-note">令和8年度は、給与の収入が55.1万〜190万円の人について、令和7年の税制改正（給与所得控除の引き上げ）の影響を消すための特例があります（施行令 附則第24条・第25条）。この計算機は給与の収入を直接扱わないので、この特例は入っていません。給与がある人は通知書の段階で確かめてください。</p>

  <h2 id="shi">選べる市の基準額（令和8年度）</h2>
  <div class="table-wrap"><table class="fit">
    <caption>基準額（年額・円）と段階の数。市が公表している段階ごとの年額と、この計算機の計算が全段階で1円まで合うことを確かめた市だけを載せています</caption>
    <thead><tr><th>市区</th><th class="num">基準額（年額）</th><th class="num">段階の数</th><th>段階と倍率</th></tr></thead>
    <tbody>
${cityRows}
    </tbody>
  </table></div>
  <p class="mini-note">ほかの市区町村は、上の計算機で「上にない」を選び、通知書や市区町村のサイトにある基準額を入れてください。各市の出典はページの下にあります。</p>
`

const sources = [...D.sources, ...CITIES.flatMap((c) => c.sources.map((s) => ({ name: `${c.city}：${s.name}`, url: s.url })))]
const html = toolPage({
  rel: REL,
  title: `介護保険料の計算（65歳以上・${D.nendo}）｜年金収入から段階と年額・国の標準13段階｜フクシル`,
  desc: `65歳以上（第1号被保険者）の介護保険料を、${D.nendo}（2026年度）の段階と基準額で計算します。年金収入・住民税の課税の別を入れると、国の標準13段階のどこに当たるかと、その理由が分かります。主な市は選ぶだけで年額、ほかの市区町村は基準額を入れて計算できます。`,
  ogTitle: `65歳以上の介護保険料の計算（${D.nendo}）`,
  published: '2026-10-28',
  crumb: '65歳以上の介護保険料の計算',
  h1: '65歳以上の介護保険料の計算（令和8年度）',
  h1sub: '年金収入から段階と年額・国の標準13段階',
  updatedNote: `${D.ki}の基準額と段階で計算`,
  body,
  faq: FAQ,
  related: `75歳以上の医療の保険料は<a href="{{UP}}kouki/">後期高齢者医療保険料の計算</a>で、住民税が非課税になる年収は<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、医療費の上限は<a href="{{UP}}articles/kougaku-ryouyouhi-2026.html">高額療養費の計算機</a>で、介護サービスの月の上限と負担割合（1〜3割）は<a href="{{UP}}kaigo/kogaku/">高額介護サービス費の計算</a>で、年金が少ない人の上乗せは<a href="{{UP}}shien-kyufukin/">年金生活者支援給付金の計算</a>で確かめられます。`,
  sources,
  disclaimer: `このページの計算は、介護保険法施行令・施行規則（e-Gov 法令検索）と、各市が公表している令和8年度の段階表にもとづく<strong>目安</strong>です。実際の保険料は、お住まいの市区町村が条例で決め、保険料の決定通知書でお知らせします。「上にない」を選んだときは<strong>国の標準の13段階</strong>で計算しているため、お住まいの市区町村が独自の段階・倍率・所得の線を使っていると<strong>金額がずれます</strong>。年度の途中で65歳になった人・転入した人（月割り）、市区町村独自の減免、令和8年度の給与所得の特例、土地・建物の譲渡所得の特別控除は入れていません。`,
  js: JS,
})

if (!html.includes('id="q-tbl"') || !html.includes('function kaigoCalc')) die('面の組み立てに失敗しました')
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, html); console.log(`--dry --out：${OUT} にだけ書いた（${(html.length / 1024).toFixed(1)}KB・sitemap は触っていない）`) }
writeTool(REL, html, { dry: DRY })
