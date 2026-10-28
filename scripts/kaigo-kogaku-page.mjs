// ─────────────────────────────────────────────────────────────────────────────
// kaigo-kogaku-page.mjs — 高額介護サービス費と介護保険の負担割合（1〜3割）の計算機の面 /kaigo/kogaku/ を作る。
//   node scripts/kaigo-kogaku-page.mjs              → kaigo/kogaku/index.html と sitemap.xml の1行
//   node scripts/kaigo-kogaku-page.mjs --dry        → 書かずに確かめの結果だけ
//   node scripts/kaigo-kogaku-page.mjs --out <path> → 面の HTML を <path> にだけ書く（sitemap は触らない。中身を見るとき用）
//
// ★なぜ（2026-10-28 ユーザーの依頼）
//   Bing 月間＝高額介護サービス費 8,552・介護保険 負担割合 3,201。読み手は介護サービスを使う高齢者とその家族で、
//   住民税非課税ぎりぎりの世帯が多い。フクシルには医療の高額療養費（articles/kougaku-ryouyouhi-2026.html）はあったが、
//   介護の側の上限と1〜3割の判定を受ける面が無かった。全国共通（政令）なので全国1枚で受ける。
// ★数字はここに書かない。data/kaigo-kogaku.json（介護保険法施行令 第22条の2・第22条の2の2〈e-Gov〉と厚労省・自治体の案内から写したもの）だけを読む。
// ★計算の式は下の CORE の1か所だけ。収入→所得は shotoku-core.mjs（後期高齢者医療・児童扶養手当と共通）。
//   node で市区町村の公式の計算例（scripts/kaigo-kogaku-cases.mjs）に通して円まで合うか確かめ、1円でも違えば止める。
//   同じ CORE を面の <script> に埋め込む（式を2回書かない）。
// ★確かめられなかったこと（按分の1円未満の端数・負担割合の公式の数字つきの例など）は data の unverified に書き、面にも出す。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { CASES } from './kaigo-kogaku-cases.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null })()
if (process.argv.includes('--out') && !OUT) die('--out の後ろに書き出す先を書いてください')
const REL = 'kaigo/kogaku/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kaigo-kogaku.json'), 'utf8'))
const W = D.wariai, K = D.kogaku

// ── 計算の式（ここだけ）。ブラウザでもそのまま動く書き方にする ─────────────────────────────
// H.kind＝'kazei'（世帯に住民税の課税の人がいる）／'hikazei'（世帯全員が非課税）／'seiho'（生活保護）。
// H.kazei＝世帯の65歳以上のうちいちばん高い住民税の課税所得。H.p＝人（age65・nenkin・kyuyo・sonota・futan・hikazei〈本人が非課税〉・rourei〈老齢福祉年金〉）。
const CORE = `${SHOTOKU_CORE}
function kaigoCalc(D, H) {
  var fl = Math.floor, W = D.wariai, K = D.kogaku, kind = H.kind;
  var ps = H.p.map(function (p) {
    var nen = p.nenkin || 0, so = p.sonota || 0, ky = kyuyoShotoku(p.kyuyo || 0), nk = nenkinShotoku(nen, ky + so, !!p.age65);
    var goukei = Math.max(0, ky + nk - W.chosei) + so;
    var nenSonota = nen + Math.max(0, ky - W.chosei) + so;
    return { age65: !!p.age65, futan: Math.max(0, fl(p.futan || 0)), goukei: goukei, nenSonota: nenSonota, hikazei: kind !== 'kazei' || !!p.hikazei, rourei: !!p.rourei };
  });
  var n65 = 0, NS = 0; ps.forEach(function (x) { if (x.age65) { n65++; NS += x.nenSonota; } });
  var two = n65 >= 2, l3 = two ? W.san.fukusu : W.san.tanshin, l2 = two ? W.ni.fukusu : W.ni.tanshin;
  ps.forEach(function (x) {
    if (!x.age65) { x.wari = 1; x.why = 'dai2go'; }
    else if (kind === 'seiho') { x.wari = 1; x.why = 'seiho'; }
    else if (x.hikazei) { x.wari = 1; x.why = 'hikazei'; }
    else if (x.goukei >= W.san.goukei && NS >= l3) { x.wari = 3; x.why = 'san'; }
    else if (x.goukei >= W.ni.goukei && NS >= l2) { x.wari = 2; x.why = x.goukei >= W.san.goukei ? 'ni_ns3' : 'ni'; }
    else { x.wari = 1; x.why = x.goukei < W.ni.goukei ? 'goukei' : 'ns'; }
  });
  var setai = null, kubun;
  if (kind === 'seiho') kubun = 'seiho';
  else if (kind === 'hikazei') { kubun = 'hikazei'; setai = K.hikazei.setai; }
  else { var k = H.kazei || 0; kubun = k >= K.gen3.kazei ? 'gen3' : k >= K.gen2.kazei ? 'gen2' : 'ippan'; setai = K[kubun].setai; }
  var S = 0; ps.forEach(function (x) { S += x.futan; });
  ps.forEach(function (x) {
    x.dai2 = kind === 'hikazei' && (x.rourei || x.nenSonota <= K.dai2.line);
    if (kind === 'seiho') { x.anbun = 0; x.kojin = Math.max(0, x.futan - K.seiho.kojin); x.refund = x.kojin; return; }
    x.anbun = S > setai && S > 0 ? fl((S - setai) * x.futan / S) : 0;
    x.kojin = x.dai2 ? Math.max(0, x.futan - K.dai2.kojin) : 0;
    x.refund = Math.max(x.anbun, x.kojin);
  });
  var R = 0; ps.forEach(function (x) { R += x.refund; });
  return { kubun: kubun, setai: setai, S: S, R: R, n65: n65, NS: NS, two: two, persons: ps };
}`
const kaigoCalc = new Function(`${CORE}\nreturn kaigoCalc`)()

// ── 確かめ（写し間違いと式の誤りで止める）───────────────────────────────────────────
const inRange = (x, a, b) => Number.isInteger(x) && x >= a && x <= b
if (!inRange(K.gen3.setai, 100000, 200000) || !inRange(K.gen2.setai, 60000, 120000)) die('上限（課税所得380万円以上）が範囲の外です')
if (!inRange(K.ippan.setai, 30000, 60000) || !inRange(K.hikazei.setai, 15000, 40000) || !inRange(K.dai2.kojin, 10000, 20000) || !inRange(K.seiho.kojin, 10000, 20000)) die('上限の額が範囲の外です（写し間違い？）')
if (!(K.gen3.setai > K.gen2.setai && K.gen2.setai > K.ippan.setai && K.ippan.setai > K.hikazei.setai && K.hikazei.setai > K.dai2.kojin)) die('上限の額の大小の順がおかしい')
if (!(K.gen3.kazei > K.gen2.kazei) || !inRange(K.dai2.line, 780000, 900000)) die('課税所得の線か第2段階の線が範囲の外です')
if (!(W.san.goukei > W.ni.goukei && W.san.tanshin > W.ni.tanshin && W.san.fukusu > W.ni.fukusu && W.ni.fukusu > W.ni.tanshin && W.san.fukusu > W.san.tanshin)) die('負担割合の線の大小の順がおかしい')
for (const s of D.sources) if (!/^https:\/\/[^\s]+$/.test(s.url) || !s.checked) die(`出典 ${s.id} の URL か確認日がありません`)
for (const b of [K, W, ...D.kaitei]) for (const id of b.src || []) if (!D.sources.some((s) => s.id === id)) die(`出典 ${id} が sources にありません`)

let nCase = 0, nPerson = 0
for (const c of CASES) {
  const r = kaigoCalc(D, c.H)
  const got = r.persons.map((x) => x.refund)
  if (got.join() !== c.want.join()) die(`${c.src} が合いません：公式 ${c.want.join('・')}／計算 ${got.join('・')}`)
  nCase++; nPerson += c.want.length
}
// 線の目安（公式の例ではない。施行令の線と式が噛み合っているかの確かめ）：65歳以上・単身・公的年金だけ・課税の人
const tan = (y) => kaigoCalc(D, { kind: 'kazei', kazei: 0, p: [{ age65: true, nenkin: y, futan: 0 }] }).persons[0].wari
const fufu = (y) => kaigoCalc(D, { kind: 'kazei', kazei: 0, p: [{ age65: true, nenkin: y, futan: 0 }, { age65: true, nenkin: 0, futan: 0 }] }).persons[0].wari
const sakai = (f, w) => { let lo = 0, hi = 20000000; if (f(hi) < w) return null; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (f(m) >= w) hi = m; else lo = m + 1 } return lo } // 年金収入（円）がいくらから w 割になるか
const L = { t2: sakai(tan, 2), t3: sakai(tan, 3), f2: sakai(fufu, 2), f3: sakai(fufu, 3) }
// 年金だけの人の境目は、施行令の「年金収入＋その他」の線より下にはならない。2割の単身の境目は厚労省の「単身280万円」と同じになるはず（280万円−公的年金等控除110万円−10万円＝合計所得160万円）
if (Object.values(L).some((x) => x === null) || L.t2 !== W.ni.tanshin || L.t3 < W.san.tanshin || L.f2 < W.ni.goukei || L.f3 < W.san.goukei) die(`年金だけの人の2割・3割の境目がおかしい（${JSON.stringify(L)}）`)
console.log(`確かめ：公式の計算例 ${nCase}例（${nPerson}人分）が円まで一致（${[...new Set(CASES.map((c) => c.src.split('・')[0]))].join('・')}）`)
console.log(`線の目安：単身・年金だけ＝2割 ${yen(L.t2)}〜・3割 ${yen(L.t3)}〜／夫婦（相手の年金0円）で本人の年金だけ＝2割 ${yen(L.f2)}〜・3割 ${yen(L.f3)}〜`)
console.log(`確かめられなかったこと ${D.unverified.length}件（面の「確かめられなかったこと」に出す）`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const T = (n) => `${num(n / 10000)}万円`
const Y = (n) => n % 10000 === 0 ? `${num(n / 10000)}万円` : `${num(Math.floor(n / 10000))}万${num(n % 10000)}円`
const T2 = (n) => `${(n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}万円`
const SRC = Object.fromEntries(D.sources.map((s) => [s.id, s]))
const ex1 = kaigoCalc(D, CASES.find((c) => c.src.startsWith('松山市・例3')).H)
const JS = `${CORE}
(function(){var D=${JSON.stringify({ wariai: W, kogaku: K })};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}function man(n){return (Math.round(n/100)/100).toLocaleString('ja-JP')+'万円'}
function v(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');if(s==='')return 0;var x=parseFloat(s);return isFinite(x)&&x>0?x:0}
var KUBUN={gen3:'課税所得690万円以上の人がいる世帯',gen2:'課税所得380万円以上690万円未満の人がいる世帯',ippan:'住民税が課税されている世帯（課税所得380万円未満）',hikazei:'世帯全員が住民税非課税',seiho:'生活保護を受けている'};
function why(x,r){var l2=r.two?D.wariai.ni.fukusu:D.wariai.ni.tanshin,l3=r.two?D.wariai.san.fukusu:D.wariai.san.tanshin,w=r.two?'世帯の65歳以上の人の':'';
 if(x.why==='dai2go')return '40〜64歳（第2号被保険者）の人は、所得にかかわらず1割です。';
 if(x.why==='seiho')return '生活保護を受けている人は1割です。';
 if(x.why==='hikazei')return '住民税が非課税の人は、所得にかかわらず1割です。';
 var g='本人の合計所得金額 '+man(x.goukei)+'、'+w+'「年金収入＋その他の合計所得金額」'+(r.two?'の合計 ':' ')+man(r.NS);
 if(x.why==='san')return g+'。合計所得金額が'+man(D.wariai.san.goukei)+'以上で、'+man(l3)+'以上なので3割です。';
 if(x.why==='ni')return g+'。合計所得金額が'+man(D.wariai.ni.goukei)+'以上で、'+man(l2)+'以上なので2割です。';
 if(x.why==='ni_ns3')return g+'。合計所得金額は'+man(D.wariai.san.goukei)+'以上ですが、'+man(l3)+'に届かないので2割です。';
 if(x.why==='goukei')return g+'。合計所得金額が'+man(D.wariai.ni.goukei)+'未満なので1割です。';
 return g+'。合計所得金額は'+man(D.wariai.ni.goukei)+'以上ですが、'+man(l2)+'に届かないので1割です。'}
function calc(){var kind=$('q-kind').value,two=$('q-n').value==='2',o=$('q-out');
 $('q-kz').style.display=kind==='kazei'?'':'none';$('q-p2').style.display=two?'':'none';
 ['1','2'].forEach(function(i){$('q-hk'+i).style.display=kind==='kazei'?'':'none';$('q-rr'+i).style.display=kind==='hikazei'?'':'none'});
 var ps=[];['1','2'].forEach(function(i){if(i==='2'&&!two)return;ps.push({age65:$('q-a'+i).value==='65',nenkin:Math.round(v('q-nk'+i)*10000),kyuyo:Math.round(v('q-ky'+i)*10000),sonota:Math.round(v('q-so'+i)*10000),futan:Math.round(v('q-f'+i)),hikazei:$('q-hz'+i).checked,rourei:$('q-ro'+i).checked})});
 var r=kaigoCalc(D,{kind:kind,kazei:Math.round(v('q-kazei')*10000),p:ps}),nm=two?['あなた','もう1人']:['あなた'],h='';
 h+='<p class="total">払い戻し（高額介護サービス費） '+yen(r.R)+'</p>';
 h+='<p class="bd">区分：<strong>'+KUBUN[r.kubun]+'</strong>'+(r.setai!==null?'／月の上限 <strong>'+yen(r.setai)+'（世帯）</strong>':'／月の上限 <strong>'+yen(D.kogaku.seiho.kojin)+'（1人ずつ）</strong>')+'。その月の利用者負担の合計 '+yen(r.S)+(r.setai!==null&&r.S>r.setai?'から上限を引いた '+yen(r.S-r.setai)+' が、世帯で戻る額のもとです。':'。')+'</p>';
 h+='<ul class="bd">';r.persons.forEach(function(x,i){
  h+='<li><strong>'+nm[i]+'</strong>：負担割合 <strong>'+x.wari+'割</strong>（'+why(x,r)+'）<br>払い戻し <strong>'+yen(x.refund)+'</strong>';
  if(r.kubun==='seiho')h+='（'+yen(x.futan)+'−個人の上限'+yen(D.kogaku.seiho.kojin)+'）';
  else if(x.dai2)h+='（個人の上限'+yen(D.kogaku.dai2.kojin)+'の人：'+yen(x.futan)+'−'+yen(D.kogaku.dai2.kojin)+'＝'+yen(x.kojin)+'と、世帯の按分 '+yen(x.anbun)+' の多いほう）';
  else if(r.persons.length>1&&r.S>r.setai)h+='（'+yen(r.S-r.setai)+'×'+yen(x.futan)+'÷'+yen(r.S)+'）';
  h+='</li>'});h+='</ul>';
 if(r.persons.length>1&&r.S>r.setai&&r.kubun!=='seiho')h+='<p class="bd">世帯で2人以上が使ったときは、世帯の上限を超えた分を、1人ずつの利用者負担の割合で分けて、それぞれに払い戻します。1円未満の端数の扱いは公式の案内で確かめられなかったので、ここでは切り捨てています（実際は1円ずれることがあります）。</p>';
 if(kind==='hikazei')h+='<p class="bd">世帯全員が非課税で、本人の「公的年金等の収入＋その他の合計所得金額」が'+man(D.kogaku.dai2.line)+'以下の人（2026年8月から。7月までは'+man(D.kogaku.dai2.prevLine)+'）と老齢福祉年金を受けている人は、個人の上限'+yen(D.kogaku.dai2.kojin)+'も使えます。</p>';
 o.innerHTML=h}
['q-kind','q-kazei','q-n','q-a1','q-nk1','q-ky1','q-so1','q-f1','q-hz1','q-ro1','q-a2','q-nk2','q-ky2','q-so2','q-f2','q-hz2','q-ro2'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const person = (i, label) => `
      <div class="row"><label for="q-a${i}">${label}の年齢</label><select id="q-a${i}"><option value="65">65歳以上</option><option value="40">40〜64歳</option></select></div>
      <div class="row"><label for="q-nk${i}">${label}の公的年金の収入（万円・年）</label><input id="q-nk${i}" type="text" inputmode="decimal" placeholder="例 150"></div>
      <div class="row"><label for="q-ky${i}">${label}の給与の収入（万円・年）</label><input id="q-ky${i}" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
      <div class="row"><label for="q-so${i}">${label}のそれ以外の所得（事業・不動産などの所得・万円）</label><input id="q-so${i}" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
      <div class="row" id="q-hk${i}"><label><input id="q-hz${i}" type="checkbox"> ${label}は住民税が非課税（世帯のほかの人は課税）</label></div>
      <div class="row" id="q-rr${i}" style="display:none"><label><input id="q-ro${i}" type="checkbox"> ${label}は老齢福祉年金を受けている</label></div>
      <div class="row"><label for="q-f${i}">${label}のその月の利用者負担（1〜3割の額・円）</label><input id="q-f${i}" type="text" inputmode="numeric" placeholder="例 30000"></div>`

const kubunRows = [
  [`課税所得${T(K.gen3.kazei)}以上の65歳以上の人がいる世帯（年収約1,160万円以上）`, `${yen(K.gen3.setai)}（世帯）`],
  [`課税所得${T(K.gen2.kazei)}以上${T(K.gen3.kazei)}未満の65歳以上の人がいる世帯（年収約770万〜1,160万円）`, `${yen(K.gen2.setai)}（世帯）`],
  [`住民税が課税されている世帯で、上のどちらでもない（課税所得${T(K.gen2.kazei)}未満）`, `${yen(K.ippan.setai)}（世帯）`],
  ['世帯全員が住民税非課税', `${yen(K.hikazei.setai)}（世帯）`],
  [`世帯全員が住民税非課税で、本人の前年の「公的年金等の収入＋その他の合計所得金額」が${T2(K.dai2.line)}以下の人・老齢福祉年金を受けている人`, `${yen(K.dai2.setai)}（世帯）／${yen(K.dai2.kojin)}（個人）`],
  ['生活保護を受けている人など', `${yen(K.seiho.kojin)}（個人）`],
].map(([a, b]) => `<tr><th>${esc(a)}</th><td class="num">${esc(b)}</td></tr>`).join('\n')

const kaiteiRows = D.kaitei.map((k) => `<li><strong>${esc(k.item)}</strong>：${esc(k.status)}${k.from ? `（${esc(k.from)}〜）` : ''}。${esc(k.note)}</li>`).join('\n    ')
const unverifiedRows = D.unverified.map((u) => `<li>${esc(u)}</li>`).join('\n    ')

const FAQ = [
  ['高額介護サービス費とは何ですか？', `1か月（1日〜末日）に払った介護保険の利用者負担（1割・2割・3割の分）の合計が上限を超えたとき、超えた分が市区町村から払い戻される制度です。上限は所得で決まり、住民税が課税されている世帯（課税所得${T(K.gen2.kazei)}未満）は世帯で月${yen(K.ippan.setai)}、世帯全員が住民税非課税なら月${yen(K.hikazei.setai)}です。施設の食費・居住費、福祉用具の購入費・住宅改修費、支給限度額を超えて使った分は含みません。`],
  ['住民税非課税世帯の高額介護サービス費の上限はいくらですか？', `世帯全員が住民税非課税なら、世帯で月${yen(K.hikazei.setai)}です。そのうち、本人の前年の「公的年金等の収入＋その他の合計所得金額」が${T2(K.dai2.line)}以下の人と老齢福祉年金を受けている人は、1人ずつの上限${yen(K.dai2.kojin)}も使えます。${T2(K.dai2.line)}の線は2026年8月利用分からで、7月までは${T2(K.dai2.prevLine)}でした。遺族年金・障害年金は「公的年金等の収入」に入れません。`],
  ['夫婦で介護サービスを使ったら、払い戻しはどう分けますか？', `2人の利用者負担を合わせて世帯の上限と比べ、超えた分を1人ずつの負担の割合で分けます。たとえば非課税世帯（上限${yen(K.hikazei.setai)}）で夫${yen(30000)}・妻${yen(20000)}なら、超えた${yen(50000 - K.hikazei.setai)}を3対2で分けて、夫に${yen(ex1.persons[0].refund)}・妻に${yen(ex1.persons[1].refund)}が払い戻されます（松山市などの計算例と同じ）。`],
  ['介護保険の負担割合（1割・2割・3割）はどう決まりますか？', `65歳以上の人は、本人の合計所得金額と、同じ世帯の65歳以上の人の「年金収入＋その他の合計所得金額」で決まります。合計所得金額が${T(W.san.goukei)}以上で、年金収入＋その他の合計所得金額が単身${T(W.san.tanshin)}・2人以上${T(W.san.fukusu)}以上なら3割。合計所得金額が${T(W.ni.goukei)}以上で、単身${T(W.ni.tanshin)}・2人以上${T(W.ni.fukusu)}以上なら2割。それ以外は1割です。40〜64歳の人、住民税が非課税の人、生活保護の人は1割です。毎年8月1日から1年間の割合を、前年の所得で決めます。`],
  ['年金だけの人は年金がいくらから2割・3割になりますか？', `65歳以上で単身・収入が公的年金だけの人は、年金収入${Y(L.t2)}以上で2割、${Y(L.t3)}以上で3割です（住民税が課税されている場合）。3割の線が${T(W.san.tanshin)}ちょうどでないのは、本人の合計所得金額${T(W.san.goukei)}以上という条件もあるためです。65歳以上の夫婦で相手の年金収入が0円のときは、本人の年金収入${Y(L.f2)}以上で2割、${Y(L.f3)}以上で3割です（令和7年分の公的年金等控除で計算した目安）。このページの計算機で、給与やほかの所得がある場合も確かめられます。`],
  ['2割負担の人が増えるというのは本当ですか？', `2026年10月28日の時点では決まっていません。厚生労働省の社会保障審議会介護保険部会は2025年12月に、2割負担の対象を広げるかどうかを「第10期介護保険事業計画期間の開始（令和9年度〜）の前までに」結論を出すとしました。決まったら、このページの線も直します。`],
  ['医療費と介護費の両方が高いときは？', '医療保険の自己負担と介護保険の利用者負担を1年（8月〜翌7月）で合わせて、上限を超えた分が戻る「高額医療・高額介護合算療養費制度」があります。これは月ごとの高額介護サービス費とは別の制度で、このページの計算機には入っていません。'],
]

const body = `  <p class="lead">介護保険のサービスを使ったときの<strong>利用者負担（1割・2割・3割）</strong>には、1か月の<strong>上限</strong>があります。上限を超えた分は<strong>高額介護サービス費</strong>として市区町村から払い戻されます。年金などの収入と、その月の利用者負担を入れると、<strong>負担割合の判定とその理由</strong>・<strong>所得区分と月の上限</strong>・<strong>払い戻される額</strong>（夫婦などで2人が使ったときの按分も）を計算します。${esc(D.kikan)}の判定（${esc(D.shotokuNen)}の所得）で計算します。</p>

  <div class="callout point">
    <p><span class="tag">高額介護サービス費の月の上限（2026年8月〜）</span><br>住民税が課税されている世帯：<strong>${yen(K.ippan.setai)}</strong>（課税所得${T(K.gen2.kazei)}以上の人がいれば${yen(K.gen2.setai)}・${T(K.gen3.kazei)}以上なら${yen(K.gen3.setai)}）<br>世帯全員が住民税非課税：<strong>${yen(K.hikazei.setai)}</strong>（年金収入など${T2(K.dai2.line)}以下の人は個人${yen(K.dai2.kojin)}）<br>2026年8月から、個人${yen(K.dai2.kojin)}の線が${T2(K.dai2.prevLine)}→<strong>${T2(K.dai2.line)}</strong>に変わりました。</p>
  </div>

  <h2 id="keisan">負担割合と払い戻しを計算する</h2>
  <div class="calc">
    <div class="row"><label for="q-kind">世帯の住民税</label><select id="q-kind"><option value="kazei">世帯に住民税が課税されている人がいる</option><option value="hikazei">世帯全員が住民税非課税</option><option value="seiho">生活保護を受けている</option></select></div>
    <div class="row" id="q-kz"><label for="q-kazei">世帯の65歳以上の人のうち、いちばん高い住民税の課税所得（万円）</label><input id="q-kazei" type="text" inputmode="decimal" placeholder="わからなければ空欄"></div>
    <p class="mini-note">金額は<strong>万円</strong>で入れてください（例：年金が年150万円なら 150）。${esc(D.shotokuNen)}（前の年）の1年分です。遺族年金・障害年金は入れません。利用者負担だけは<strong>円</strong>で、施設の食費・居住費などを除いた1割〜3割の分です。</p>
    <div class="row"><label for="q-n">同じ世帯の65歳以上の人・介護サービスを使う人</label><select id="q-n"><option value="1">あなただけ</option><option value="2">もう1人いる（配偶者など）</option></select></div>
${person('1', 'あなた')}
    <div id="q-p2" style="display:none">${person('2', 'もう1人')}
    </div>
    <div class="out" id="q-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">課税所得は、住民税の課税明細（税額決定通知書）の「課税標準額」の合計です。空欄なら課税所得${T(K.gen2.kazei)}未満として計算します（課税所得${T(K.gen2.kazei)}以上で上限が上がるのは、年収のおよそ770万円以上の人です）。正式な負担割合は、毎年7月ごろに届く<strong>介護保険負担割合証</strong>で、払い戻しは市区町村から届く申請の案内と支給の通知で確かめてください。</p>

  <h2 id="jogen">高額介護サービス費の上限（月額・2026年8月〜）</h2>
  <div class="table-wrap"><table class="fit">
    <caption>所得区分ごとの利用者負担の上限（1か月）</caption>
    <thead><tr><th>所得区分</th><th class="num">上限</th></tr></thead>
    <tbody>
${kubunRows}
    </tbody>
  </table></div>
  <ul class="mini-note">
    <li>「世帯」は住民票の世帯で、その世帯で介護サービスを使った人全員の負担の合計の上限です。「個人」は使った本人の上限です。</li>
    <li>課税所得の線は、同じ世帯の65歳以上の人のうち、いちばん課税所得が高い人で判定します。</li>
    <li>上限は1〜3割のどの人も同じです。2割・3割の人は上限に届きやすくなります。</li>
    <li>8月から翌年7月までは前の年の所得で判定します（1〜7月の利用分は前々年の所得）。</li>
    <li>払い戻しの対象外：施設の食費・居住費（滞在費）、日常生活費、福祉用具の購入費・住宅改修費の自己負担、支給限度額を超えて使った分。</li>
  </ul>

  <h2 id="wariai">負担割合（1割・2割・3割）の決まり方</h2>
  <div class="table-wrap"><table class="fit">
    <caption>65歳以上で住民税が課税されている人（${esc(D.kikan)}）</caption>
    <thead><tr><th>本人の合計所得金額</th><th class="num">世帯の65歳以上が本人だけ</th><th class="num">65歳以上が2人以上</th></tr></thead>
    <tbody>
<tr><th>${T(W.san.goukei)}以上</th><td class="num">${T(W.san.tanshin)}以上で3割<br>${T(W.ni.tanshin)}以上で2割</td><td class="num">${T(W.san.fukusu)}以上で3割<br>${T(W.ni.fukusu)}以上で2割</td></tr>
<tr><th>${T(W.ni.goukei)}以上${T(W.san.goukei)}未満</th><td class="num">${T(W.ni.tanshin)}以上で2割</td><td class="num">${T(W.ni.fukusu)}以上で2割</td></tr>
<tr><th>${T(W.ni.goukei)}未満</th><td class="num">1割</td><td class="num">1割</td></tr>
    </tbody>
  </table></div>
  <p class="mini-note">表の右の2列の額は、同じ世帯の65歳以上の人全員の「年金収入＋その他の合計所得金額」の合計です。どちらの線にも届かなければ1割。40〜64歳の人・住民税が非課税の人・生活保護の人は、所得にかかわらず1割です。</p>
  <ul class="mini-note">
    <li><strong>合計所得金額</strong>＝収入から公的年金等控除・給与所得控除・必要経費を引いた額（基礎控除などの所得控除を引く前）。介護保険の判定では、給与所得と年金の所得の合計からさらに${T(W.chosei)}を引きます。土地を売ったときの特別控除も引きます。</li>
    <li><strong>年金収入＋その他の合計所得金額</strong>＝公的年金等の収入（控除を引く前・遺族年金と障害年金は入れない）に、年金以外の所得を足したもの。給与所得は${T(W.chosei)}を引きます。</li>
    <li>単身・年金だけの人の目安：年金収入${Y(L.t2)}以上で2割、${Y(L.t3)}以上で3割。</li>
  </ul>

  <h2 id="kaitei">決まった改定と、決まっていないこと（2026年10月28日時点）</h2>
  <ul>
    ${kaiteiRows}
  </ul>

  <h2 id="mikakunin">確かめられなかったこと</h2>
  <ul class="mini-note">
    ${unverifiedRows}
  </ul>
  <p class="mini-note">計算の式は、市区町村が公表している高額介護サービス費の計算例${nCase}例（水戸市・岩倉市・南あわじ市・平川市・松山市・江東区・南山城村・更別村）と1円まで合うことを確かめています。</p>
`

const html = toolPage({
  rel: REL,
  title: '高額介護サービス費の計算（2026年8月〜）｜介護保険の負担割合（1割・2割・3割）の判定と払い戻し額｜フクシル',
  desc: `介護保険の高額介護サービス費を計算します。年金などの収入とその月の利用者負担を入れると、負担割合（1割・2割・3割）の判定と理由、所得区分と月の上限（課税世帯${yen(K.ippan.setai)}・非課税世帯${yen(K.hikazei.setai)}・個人${yen(K.dai2.kojin)}）、払い戻される額（夫婦の按分つき）が分かります。2026年8月からの${T2(K.dai2.line)}の線に対応。`,
  ogTitle: '高額介護サービス費と介護保険の負担割合の計算（2026年8月〜）',
  published: '2026-10-28',
  crumb: '高額介護サービス費の計算',
  h1: '高額介護サービス費の計算（2026年8月〜）',
  h1sub: '介護保険の負担割合（1割・2割・3割）の判定と払い戻し額',
  updatedNote: `介護保険法施行令（${D.checkedAt} 照合）の線で計算`,
  body,
  faq: FAQ,
  related: '医療費の月の上限は<a href="{{UP}}articles/kougaku-ryouyouhi-2026.html">高額療養費の計算機</a>で、医療と介護を1年で合わせる制度は<a href="{{UP}}articles/kougaku-ryouyouhi-2026.html#kaigo-gassan">高額介護合算療養費</a>で、世帯が住民税非課税になるかは<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、75歳以上の保険料は<a href="{{UP}}kouki/">後期高齢者医療保険料の計算</a>で、65歳以上の介護保険料は<a href="{{UP}}kaigo/hokenryo/">介護保険料の計算</a>で、年金が少ない人の上乗せは<a href="{{UP}}shien-kyufukin/">年金生活者支援給付金の計算</a>で確かめられます。',
  sources: D.sources,
  disclaimer: `このページの計算は、介護保険法施行令（第22条の2・第22条の2の2）と厚生労働省・市区町村の案内にもとづく<strong>目安</strong>です。負担割合は市区町村から届く<strong>介護保険負担割合証</strong>が、払い戻しの額は市区町村の<strong>支給の通知</strong>が正です。住民税の課税・非課税と課税所得は入力のとおりに扱い、ここでは判定しません。所得の計算は年金・給与・その他の所得だけを扱い、譲渡所得の特別控除・生活保護の境界層・保険料を滞納したときの給付の制限（3割・4割）・月の途中の転入や世帯の変更は入れていません。医療保険の自己負担と合わせる<strong>高額医療・高額介護合算療養費</strong>は別の制度で、この計算には入っていません。払い戻しには市区町村への申請が要ります（最初の1回の申請のあとは自動で振り込む市区町村もあります）。`,
  js: JS,
})

if (!html.includes('id="q-out"') || !html.includes('function kaigoCalc')) die('面の組み立てに失敗しました')
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, html); console.log(`--out：${OUT} にだけ書いた（${(html.length / 1024).toFixed(1)}KB・sitemap は触っていない）`) }
else writeTool(REL, html, { dry: DRY })
