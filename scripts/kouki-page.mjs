// ─────────────────────────────────────────────────────────────────────────────
// kouki-page.mjs — 後期高齢者医療保険料の計算機（令和8年度・47都道府県）の面 /kouki/ を作る。
//   node scripts/kouki-page.mjs        → kouki/index.html と sitemap.xml の1行
//   node scripts/kouki-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-20 ユーザー「のこった案をすべてフクシルに増床してくれ」＝第191回の条件つきの案）
//   Bing 90日＝後期高齢者医療保険料 23,571・計算方法 2,567・計算 シュミレーション 569・計算シミュレーション 264・早見表 121。
//   フクシルには後期高齢者の保険料の面が無かった。県名つきの語は広域連合の名前への道案内だけ＝県別の面は作らず、全国1枚で受ける。
// ★数字はここに書かない。data/kouki-hokenryo.json（厚労省の47広域連合の料率表・施行令・国税庁の控除の表から写したもの）だけを読む。
// ★計算の式は下の CORE の1か所だけ。node で公式の計算例42例（scripts/kouki-cases.mjs）に通して円まで合うか確かめ、
//   1円でも違えば止める。同じ CORE を面の <script> に埋め込む（式を2回書かない）。
// ★端数の決まりが確かめられていない広域連合（41）と、計算例で照らせていない広域連合は、面にその旨を書く
//   （2026-10-20 ユーザー裁定 2「一円まで合わない場合のみその旨付記する」）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { CASES } from './kouki-cases.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const REL = 'kouki/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kouki-hokenryo.json'), 'utf8'))
const PREF = Object.fromEntries(D.prefs.map((p) => [p.pref, p]))

// ── 計算の式（ここだけ）。収入→所得は shotoku-core.mjs（児童扶養手当と共通）。ブラウザでもそのまま動く書き方にする ─────────────────────────────
const CORE = `${SHOTOKU_CORE}
function koukiCalc(P, D, ps, head) {
  var fl = Math.floor;
  function shotoku(p, age65) { var ky = kyuyoShotoku(p.kyuyo || 0), sonota = p.sonota || 0, nk = age65 ? nenkinShotoku(p.nenkin || 0, ky + sonota, true) : 0;
    var adj = ky > 0 && nk > 0 ? Math.max(0, Math.min(ky, 100000) + Math.min(nk, 100000) - 100000) : 0;
    var sou = nk + ky - adj + sonota;
    return { ky: ky, nk: nk, sou: sou, hantei: sou - Math.min(nk, D.nenkinTokurei),
      kyuyoSha: (p.kyuyo || 0) > D.kyuyoSha.kyuyo || (age65 && (p.nenkin || 0) > D.kyuyoSha.nenkin65) }; }
  var K = D.keigen, ss = ps.map(function (p) { return shotoku(p, true); }), hh = head ? shotoku(head, false) : null;
  var S = 0, cnt = 0; ss.forEach(function (s) { S += s.hantei; if (s.kyuyoSha) cnt++; }); if (hh) { S += hh.hantei; if (hh.kyuyoSha) cnt++; }
  var n = Math.max(cnt, 1) - 1, k = ps.length;
  var kei = S <= K.kiso + K.perKyuyo * n ? 7 : S <= K.kiso + K.go * k + K.perKyuyo * n ? 5 : S <= K.kiso + K.ni * k + K.perKyuyo * n ? 2 : 0;
  var f100 = function (x) { return fl(x / 100) * 100; }, f10 = function (x) { return fl(x / 10) * 10; };
  var out = ps.map(function (p, i) {
    var s = ss[i], fuyou = !!p.fuyou, kk = kei;
    var wI = { 7: K.nana.iryo, 5: K.go_, 2: K.ni_, 0: 100 }[kk], wK = { 7: K.nana.kodomo, 5: K.go_, 2: K.ni_, 0: 100 }[kk];
    if (fuyou && kk !== 7) { wI = D.fuyou.rate; wK = D.fuyou.rate; }
    var kin = fl(P.kin * wI / 100), kinK = fl(P.kodomoKin * wK / 100);
    var base = fuyou ? 0 : Math.max(s.sou - K.kiso, 0);
    var sw = fl(base * P.rateBp / 10000), swK = fl(base * P.kodomoBp / 10000), tg = 0;
    if (P.pref === '東京都' && base > 0) { tg = base <= D.tokyo.p50 ? 50 : base <= D.tokyo.p25 ? 25 : 0; sw -= fl(sw * tg / 100); swK -= fl(swK * tg / 100); }
    var iryo = Math.min(kin + sw, D.gendo.iryo), kodomo = Math.min(kinK + swK, D.gendo.kodomo);
    if (P.round === 'h100') { iryo = f100(iryo); kodomo = f100(kodomo); }
    else if (P.round === 'miyazaki') { iryo = f100(Math.min(f100(kin) + sw, D.gendo.iryo)); kodomo = f100(Math.min(f100(kinK) + swK, D.gendo.kodomo)); }
    else if (P.round === 'y10') { iryo = f10(iryo); kodomo = f10(kodomo); }
    return { iryo: iryo, kodomo: kodomo, total: iryo + kodomo, kin: kin, kinK: kinK, sw: sw, swK: swK, wI: wI, wK: wK, base: base, sou: s.sou, tg: tg, fuyou: fuyou };
  });
  return { kei: kei, S: S, n: n, k: k, persons: out };
}`
const koukiCalc = new Function(`${CORE}\nreturn koukiCalc`)()

// ── 確かめ（写し間違いと式の誤りで止める）───────────────────────────────────────────
if (D.prefs.length !== 47) die('料率が47行ありません')
for (const p of D.prefs) {
  if (!(p.kin > 40000 && p.kin < 80000) || !(p.rateBp > 700 && p.rateBp < 1300) || !(p.kodomoKin > 1000 && p.kodomoKin < 1600) || !(p.kodomoBp >= 15 && p.kodomoBp <= 35)) die(`${p.pref} の料率が範囲の外です（写し間違い？）`)
  // 厚労省の表の「年金収入84万円の医療分の月額」＝均等割×0.28÷12。年額を100円未満切捨てにしたもの・しないもの、÷12 の丸め・切捨てのどれかで合えばよい
  const y = Math.floor(p.kin * D.keigen.nana.iryo / 100), y1 = Math.floor(y / 100) * 100
  const ok = [y, y1].some((a) => Math.round(a / 12) === p.model84 || Math.floor(a / 12) === p.model84)
  if (!ok && p.pref !== '宮崎県') die(`${p.pref} の均等割（${p.kin}）が厚労省の84万円モデル（月${p.model84}円）と合いません（写し間違い？）`)
}
let nCase = 0, nPerson = 0
for (const c of CASES) {
  const P = PREF[c.pref]
  if (!P || P.verified !== '例') die(`計算例の ${c.pref} が「例で照合済み」になっていません`)
  const r = koukiCalc(P, D, c.p, c.head || null)
  const got = r.persons.map((x) => x.total)
  if (c.want) { if (got.join() !== c.want.join()) die(`${c.pref} の計算例（年金${c.p.map((x) => x.nenkin / 10000).join('・')}万円…）が合いません：公式 ${c.want.join('・')}／計算 ${got.join('・')}`) }
  else if (got.reduce((a, b) => a + b, 0) !== c.wantSum) die(`${c.pref} の夫婦の計算例（夫の年金${c.p[0].nenkin / 10000}万円）が合いません：公式 ${c.wantSum}／計算 ${got.join('+')}`)
  nCase++; nPerson += c.p.length
}
const verifiedPrefs = D.prefs.filter((p) => p.verified === '例').map((p) => p.pref)
console.log(`確かめ：料率47行・厚労省の84万円モデルと均等割が合う（宮崎県を除く）／公式の計算例 ${nCase}例（${nPerson}人分）が円まで一致（${verifiedPrefs.join('・')}）`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const zen = D.prefs.find((p) => p.pref === '東京都') // 例の文で使う
const SAMPLE = [80, 100, 125, 150, 168, 180, 200, 220, 250, 300, 400]
const JS = `${CORE}
(function(){var D=${JSON.stringify({ keigen: D.keigen, kyuyoSha: D.kyuyoSha, nenkinTokurei: D.nenkinTokurei, tokyo: D.tokyo, fuyou: D.fuyou, gendo: D.gendo })};
var PR=${JSON.stringify(D.prefs.map((p) => ({ pref: p.pref, kin: p.kin, rateBp: p.rateBp, kodomoKin: p.kodomoKin, kodomoBp: p.kodomoBp, round: p.round, verified: p.verified })))};
var SAMPLE=${JSON.stringify(SAMPLE)};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function v(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');if(s==='')return 0;var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x*10000):0}
function pref(){var p=$('q-pref').value;for(var i=0;i<PR.length;i++)if(PR[i].pref===p)return PR[i];return PR[12]}
var KEI={7:'7割（医療分は7.2割）',5:'5割',2:'2割',0:'なし'};
function note(P){if(P.verified==='例')return '<p class="check-mark">'+P.pref+'は、公式の計算例と1円まで合うことを確かめた式で計算しています。</p>';
 if(P.verified==='決まり')return '<p class="bd">'+P.pref+'は、端数の扱いを公式の案内で確かめましたが、公式の計算例と1円までは照らせていません。</p>';
 return '<p class="bd"><strong>'+P.pref+'は、公式の計算例と1円まで照らせていません。</strong>端数（100円未満を切り捨てるかなど）の決まりも確かめられていないため、ここでは1円単位で出しています。実際の額は、医療分と子ども分それぞれで最大99円ほど少ないことがあります。</p>'}
function line(x,P){return yen(x.total)+'<span class="bd">（医療分 '+yen(x.iryo)+'＋子ども・子育て支援金分 '+yen(x.kodomo)+'）</span>'}
function detail(x,P,nm){var t='<li><strong>'+nm+'</strong>：均等割 '+yen(x.kin)+(x.wI<100?'（'+(x.fuyou&&x.wI===50?'被扶養者だった人の5割軽減':(100-x.wI)/10+'割軽減')+'）':'')+'・所得割 '+yen(x.sw)+'（賦課のもとの所得 '+yen(x.base)+'×'+(P.rateBp/100).toFixed(2)+'%'+(x.tg?'・東京都の独自の軽減で'+x.tg+'%減':'')+(x.fuyou?'・被扶養者だった人は所得割なし':'')+'）／子ども分 均等割 '+yen(x.kinK)+'・所得割 '+yen(x.swK)+'</li>';return t}
function calc(){var P=pref(),two=$('q-two').value==='2',hk=$('q-head').value,o=$('q-out');
 $('q-p2').style.display=two?'':'none';$('q-hd').style.display=hk==='other'?'':'none';
 var ps=[{nenkin:v('q-n1'),kyuyo:v('q-k1'),sonota:v('q-s1'),fuyou:$('q-f1').checked}];
 if(two)ps.push({nenkin:v('q-n2'),kyuyo:v('q-k2'),sonota:v('q-s2'),fuyou:$('q-f2').checked});
 var head=hk==='other'?{kyuyo:v('q-hk'),sonota:v('q-hs')}:null;
 var r=koukiCalc(P,D,ps,head),x=r.persons;
 var h='<p class="total">'+(two?'あなた ':'年額 ')+line(x[0],P)+'</p>';
 if(two)h+='<p class="total">もう1人 '+line(x[1],P)+'</p><p class="bd">2人の合計 '+yen(x[0].total+x[1].total)+'</p>';
 h+='<p class="bd">均等割の軽減：<strong>'+KEI[r.kei]+'</strong>（判定に使う世帯の所得の合計 '+yen(r.S)+'）。月あたりにすると約'+yen(Math.round(x[0].total/12))+(two?'・約'+yen(Math.round(x[1].total/12)):'')+'です（実際は年6回〜の分割で、年金からの天引きか納付書・口座振替で払います）。</p>';
 h+='<ul class="bd">'+detail(x[0],P,two?'あなた':'内訳')+(two?detail(x[1],P,'もう1人'):'')+'</ul>'+note(P);
 o.innerHTML=h;
 var rows='';for(var i=0;i<SAMPLE.length;i++){var y=koukiCalc(P,D,[{nenkin:SAMPLE[i]*10000}],null);rows+='<tr><th>'+SAMPLE[i]+'万円</th><td>'+KEI[y.kei].replace('（医療分は7.2割）','')+'</td><td class="num">'+yen(y.persons[0].total)+'</td><td class="num">'+yen(Math.round(y.persons[0].total/12))+'</td></tr>'}
 $('q-hayami-cap').textContent=P.pref+'・単身・収入は公的年金だけの人の令和8年度の年額（円）';$('q-hayami').innerHTML=rows}
['q-pref','q-two','q-head','q-n1','q-k1','q-s1','q-f1','q-n2','q-k2','q-s2','q-f2','q-hk','q-hs'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const avg = { kin: 56083, rate: '10.17', kk: 1351, kr: '0.25' } // 厚労省の発表の全国平均（data の sources の1つ目）
const rateRows = D.prefs.map((p) => `<tr><th>${esc(p.pref)}</th><td class="num">${num(p.kin)}</td><td class="num">${esc(p.rate)}%</td><td class="num">${num(p.kodomoKin)}</td><td class="num">${esc(p.kodomoRate)}%</td></tr>`).join('\n')
const prefOpts = D.prefs.map((p) => `<option${p.pref === '東京都' ? ' selected' : ''}>${esc(p.pref)}</option>`).join('')
const T = (n) => num(n / 10000) + '万円'
const K = D.keigen
const FAQ = [
  ['後期高齢者医療保険料はいくらですか？', `令和8年度の保険料は、都道府県ごとの「均等割」（1人あたりの定額）と「所得割」（所得に応じた額）の合計です。全国平均の料率は均等割${num(avg.kin)}円・所得割率${avg.rate}%で、令和8年度からは子ども・子育て支援金分（全国平均で均等割${num(avg.kk)}円・所得割率${avg.kr}%）が加わりました。所得が低い世帯は均等割が7割・5割・2割軽減されます。年金収入と都道府県を入れると、このページの計算機で年額が分かります。`],
  ['年金だけの人の保険料はいくらですか？', `所得が低いと均等割が軽くなり、所得割もかからないか小さくなります。たとえば${zen.pref}で単身・年金収入80万円の人は、年額${yen(koukiCalc(zen, D, [{ nenkin: 800000 }], null).persons[0].total)}です（令和8年度・7割軽減）。年金収入200万円なら${yen(koukiCalc(zen, D, [{ nenkin: 2000000 }], null).persons[0].total)}です。ほかの都道府県と年金額は、このページの早見表と計算機で確かめられます。`],
  ['保険料の軽減（7割・5割・2割）の基準は？', `世帯主と世帯の後期高齢者医療の被保険者全員の所得の合計で判定します。令和8年度は、${T(K.kiso)}（＋給与や年金の収入がある人が2人以上なら1人につき${T(K.perKyuyo)}）以下で7割、それに被保険者の数×${T(K.go)}を足した額以下で5割、被保険者の数×${T(K.ni)}を足した額以下で2割です。65歳以上の人の年金所得は、判定のときだけさらに最大${T(D.nenkinTokurei)}を引きます。令和8・9年度は、医療分の7割軽減が7.2割になります。`],
  ['保険料の上限（賦課限度額）はいくらですか？', `令和8年度は、医療分が${T(D.gendo.iryo)}、子ども・子育て支援金分が${T(D.gendo.kodomo)}で、合わせて年${num((D.gendo.iryo + D.gendo.kodomo) / 10000)}万円が上限です（全国共通）。`],
  ['会社の健康保険の扶養に入っていた人の保険料は？', '75歳になるまで会社の健康保険などの被扶養者だった人は、所得割がかからず、加入から2年を経過する月までは均等割が5割軽減されます（7割軽減に当たる人は7割〈令和8・9年度の医療分は7.2割〉が優先）。国民健康保険から移った人は対象外です。'],
]

const body = `  <p class="lead"><strong>後期高齢者医療制度</strong>（75歳以上の人が入る医療保険）の保険料は、<strong>住んでいる都道府県の料率</strong>と<strong>前の年の所得</strong>で決まります。令和8年度（2026年度）は保険料率が改定され、新しく<strong>子ども・子育て支援金分</strong>も加わりました。年金収入などを入れると、${esc(D.nendo)}の年額を、均等割の軽減（7割・5割・2割）込みで計算します。</p>

  <div class="callout point">
    <p><span class="tag">令和8年度の保険料（全国平均の料率）</span><br>医療分：均等割 <strong>${num(avg.kin)}円</strong>＋所得割 <strong>${avg.rate}%</strong><br>子ども・子育て支援金分：均等割 ${num(avg.kk)}円＋所得割 ${avg.kr}%<br>上限：医療分 ${T(D.gendo.iryo)}・子ども分 ${T(D.gendo.kodomo)}／所得が低い世帯は均等割を7割（医療分は7.2割）・5割・2割軽減</p>
  </div>

  <h2 id="keisan">保険料を計算する（${esc(D.nendo)}）</h2>
  <div class="calc">
    <div class="row"><label for="q-pref">住んでいる都道府県</label><select id="q-pref">${prefOpts}</select></div>
    <p class="mini-note">金額は<strong>万円</strong>で入れてください（例：年金が年180万円なら 180）。${esc(D.shotokuNen)}（前の年）の1年分の収入です。遺族年金・障害年金は入れません。</p>
    <div class="row"><label for="q-n1">あなたの公的年金の収入（万円・年）</label><input id="q-n1" type="text" inputmode="decimal" placeholder="例 180"></div>
    <div class="row"><label for="q-k1">あなたの給与の収入（万円・年）</label><input id="q-k1" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label for="q-s1">それ以外の所得（事業・不動産などの所得・万円）</label><input id="q-s1" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label><input id="q-f1" type="checkbox"> 75歳になるまで会社の健康保険などの扶養に入っていた（加入から2年以内）</label></div>
    <div class="row"><label for="q-two">同じ世帯の後期高齢者医療の人</label><select id="q-two"><option value="1">あなただけ</option><option value="2">もう1人いる（配偶者など）</option></select></div>
    <div id="q-p2" style="display:none">
      <div class="row"><label for="q-n2">もう1人の公的年金の収入（万円・年）</label><input id="q-n2" type="text" inputmode="decimal" placeholder="例 80"></div>
      <div class="row"><label for="q-k2">もう1人の給与の収入（万円・年）</label><input id="q-k2" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
      <div class="row"><label for="q-s2">もう1人のそれ以外の所得（万円）</label><input id="q-s2" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
      <div class="row"><label><input id="q-f2" type="checkbox"> もう1人は扶養に入っていた（加入から2年以内）</label></div>
    </div>
    <div class="row"><label for="q-head">住民票の世帯主</label><select id="q-head"><option value="self">あなた（か上のもう1人）</option><option value="other">ほかの人（同居の子など）</option></select></div>
    <div id="q-hd" style="display:none">
      <div class="row"><label for="q-hk">世帯主の給与の収入（万円・年）</label><input id="q-hk" type="text" inputmode="decimal" placeholder="例 400"></div>
      <div class="row"><label for="q-hs">世帯主のそれ以外の所得（万円）</label><input id="q-hs" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    </div>
    <div class="out" id="q-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">世帯主が後期高齢者医療に入っていない人（同居の子など）でも、世帯主の所得は均等割の軽減の判定に入ります。保険料は4月1日の世帯の状況で判定し、年度の途中で加入した人は月割りになります。正式な額は、7月ごろに届く保険料額の決定通知書で確かめてください。</p>

  <h2 id="hayami">年金収入別の早見表（単身・年金だけ）</h2>
  <div class="table-wrap"><table class="fit">
    <caption id="q-hayami-cap"></caption>
    <thead><tr><th>年金収入</th><th>均等割の軽減</th><th class="num">年額</th><th class="num">月あたり</th></tr></thead>
    <tbody id="q-hayami"></tbody>
  </table></div>
  <p class="mini-note">上の計算機で都道府県を選ぶと、この表もその都道府県に変わります。月あたりは年額÷12の目安です。</p>

  <h2 id="shikumi">保険料の決まり方</h2>
  <p>1人ずつの保険料＝<strong>均等割</strong>（全員が同じ額）＋<strong>所得割</strong>（賦課のもとになる所得×所得割率）。医療分と子ども・子育て支援金分を別々に計算して足します。</p>
  <ul>
    <li><strong>賦課のもとになる所得</strong>＝${esc(D.shotokuNen)}の総所得金額等−基礎控除${T(K.kiso)}。年金だけの人は、年金収入から公的年金等控除（65歳以上で年金収入330万円未満なら110万円）を引いた額が所得です。</li>
    <li><strong>均等割の軽減</strong>（世帯の所得の合計で判定）：${T(K.kiso)}＋${T(K.perKyuyo)}×（給与や年金の収入がある人の数−1）以下なら<strong>7割</strong>（令和8・9年度の医療分は7.2割）、それに被保険者の数×${T(K.go)}を足した額以下なら<strong>5割</strong>、被保険者の数×${T(K.ni)}を足した額以下なら<strong>2割</strong>。65歳以上の人の年金所得は、判定のときだけさらに最大${T(D.nenkinTokurei)}を引きます。「給与や年金の収入がある人」は、給与収入が${T(D.kyuyoSha.kyuyo)}を超える人か、65歳以上で年金収入が${T(D.kyuyoSha.nenkin65)}を超える人です。</li>
    <li><strong>上限</strong>：医療分${T(D.gendo.iryo)}・子ども分${T(D.gendo.kodomo)}。</li>
    <li><strong>扶養に入っていた人</strong>：所得割はかからず、加入から2年を経過する月までは均等割が5割軽減（7割に当たる人は7割が優先）。</li>
    <li><strong>東京都</strong>は、広域連合の独自の軽減で、賦課のもとになる所得が15万円以下なら所得割を50%、20万円以下なら25%減らしています（計算機に入れています）。ほかの道府県にも独自の軽減がある場合があり、計算機には入っていません。</li>
  </ul>
  <p class="mini-note">医療分の7.2割軽減は、国が令和8・9年度に7割軽減へ0.2割を上乗せできるようにしたものです（厚生労働省の資料では、47都道府県すべての「年金収入84万円の人」の額がこの割合です）。子ども・子育て支援金分は7割のままです。</p>

  <h2 id="ryoritsu">47都道府県の保険料率（令和8年度）</h2>
  <div class="table-wrap"><table class="fit">
    <caption>均等割（円・年）と所得割率。医療分は令和8・9年度、子ども・子育て支援金分は令和8年度</caption>
    <thead><tr><th>都道府県</th><th class="num">医療分<br>均等割</th><th class="num">医療分<br>所得割率</th><th class="num">子ども分<br>均等割</th><th class="num">子ども分<br>所得割率</th></tr></thead>
    <tbody>
${rateRows}
    </tbody>
  </table></div>
  <p class="mini-note">子ども・子育て支援金分の令和9年度の率は、令和8年度末までに各広域連合の議会が決めます。出典：厚生労働省「後期高齢者医療制度の令和８・９年度の保険料率について」（<a href="${D.sources[0].url}" rel="nofollow">${D.sources[0].url}</a>）を加工して作成。</p>
`

const html = toolPage({
  rel: REL,
  title: `後期高齢者医療保険料の計算（${D.nendo}）｜年金収入から年額・軽減（7割・5割・2割）と47都道府県の保険料率｜フクシル`,
  desc: `75歳以上の後期高齢者医療保険料を、${D.nendo}（2026年度）の都道府県の料率で計算します。年金収入・給与・世帯を入れると、均等割の軽減（7割・5割・2割、医療分は7.2割）と子ども・子育て支援金分を含めた年額が分かります。年金収入別の早見表と、47都道府県の均等割・所得割率の一覧つき。`,
  ogTitle: `後期高齢者医療保険料の計算（${D.nendo}・47都道府県）`,
  published: '2026-10-20',
  crumb: '後期高齢者医療保険料の計算',
  h1: '後期高齢者医療保険料の計算（令和8年度）',
  h1sub: '年金収入から年額・軽減（7割・5割・2割）と47都道府県の保険料率',
  updatedNote: `${D.nendo}の保険料率（厚生労働省の発表）で計算`,
  body,
  faq: FAQ,
  related: '75歳以上の医療費の上限と窓口の負担（1割・2割・3割）は<a href="{{UP}}articles/kougaku-ryouyouhi-2026.html#75ijo">高額療養費の計算機</a>で、住民税が非課税になる年収は<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、65〜74歳の人の介護保険料は<a href="{{UP}}kaigo/hokenryo/">介護保険料の計算</a>で、介護サービスの月の上限は<a href="{{UP}}kaigo/kogaku/">高額介護サービス費の計算</a>で、年金が少ない人の上乗せは<a href="{{UP}}shien-kyufukin/">年金生活者支援給付金の計算</a>で確かめられます。',
  sources: D.sources,
  disclaimer: `このページの計算は、厚生労働省が公表した${D.nendo}の保険料率と、法令（高齢者の医療の確保に関する法律施行令）・国税庁の控除の表にもとづく<strong>目安</strong>です。実際の保険料は、お住まいの都道府県の後期高齢者医療広域連合が決め、市区町村から届く保険料額の決定通知書で確かめてください。所得の計算は、年金と給与と事業などの所得だけを扱い、医療費控除などの各種控除・譲渡所得の特別控除・年度途中の加入や転入（月割り）・合計所得が2,400万円を超える人の基礎控除の減り方は入れていません。`,
  js: JS,
})

if (!html.includes('id="q-hayami"') || !html.includes('function koukiCalc')) die('面の組み立てに失敗しました')
writeTool(REL, html, { dry: DRY })
