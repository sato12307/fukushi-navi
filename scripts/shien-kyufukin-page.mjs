// ─────────────────────────────────────────────────────────────────────────────
// shien-kyufukin-page.mjs — 年金生活者支援給付金の計算機（令和8年度・老齢／補足的老齢／障害／遺族）の面 /shien-kyufukin/ を作る。
//   node scripts/shien-kyufukin-page.mjs              → shien-kyufukin/index.html と sitemap.xml の1行
//   node scripts/shien-kyufukin-page.mjs --dry        → 書かずに確かめの結果だけ
//   node scripts/shien-kyufukin-page.mjs --out <path> → 面の HTML だけを <path> に書く（sitemap は触らない。中身を見る用）
//
// ★なぜ（2026-10-28 ユーザー「年金生活者支援給付金の計算機の面を1枚足してほしい」）
//   Bing 月間「年金生活者支援給付金」17,542。読み手は住民税非課税ぎりぎりの高齢者・障害年金・遺族年金の受給者とその家族。
//   フクシルには支援給付金の面が無く、障害年金の記事（shogai-nenkin-basics）も給付金の額を【要確認】で保留していた。
// ★数字はここに書かない。data/shien-kyufukin.json（日本年金機構・厚労省のページと e-Gov の法律・施行令から写したもの）だけを読む。
// ★計算の式は下の CORE の1か所だけ（収入→所得は shotoku-core.mjs）。node で公式の計算例（scripts/shien-kyufukin-cases.mjs）に通して
//   円まで合うか確かめ、1円でも違えば止める。同じ CORE を面の <script> に埋め込む（式を2回書かない）。
// ★公式の数字入りの例で照らせていない所（補足的老齢の額・免除期間の端数の扱い・納付猶予の期間）は、面に「確認中」と書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { CASES, EDGES } from './shien-kyufukin-cases.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null })()
if (process.argv.includes('--out') && !OUT) die('--out のあとに書き出す先の道を書いてください')
const REL = 'shien-kyufukin/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'shien-kyufukin.json'), 'utf8'))

// ── 計算の式（ここだけ）。ブラウザでもそのまま動く書き方にする ─────────────────────────────
// x.kind＝rourei（老齢基礎年金）|shogai（障害基礎年金）|izoku（遺族基礎年金）。x.kiso===false＝基礎年金を受けていない（障害厚生3級だけ・遺族厚生だけ）。
// 金額は円。nofu・zen・q は月数。birth・asOf は 'YYYY-MM-DD'。hikazei＝true|false|null（わからない）。
const CORE = `${SHOTOKU_CORE}
function shienCalc(D, x) {
  var fl = Math.floor, mn = Math.min, mx = Math.max;
  function rh(p, q) { return fl((2 * p + q) / (2 * q)); } // p÷q を円に（50銭未満切り捨て・50銭以上切り上げ）
  function ymd(s) { var a = String(s).split('-'); return (+a[0]) * 10000 + (+a[1]) * 100 + (+a[2]); }
  function nextDay(s) { var a = String(s).split('-'), t = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + 1)); return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate(); }
  var b = ymd(x.birth), age = fl((nextDay(x.asOf) - b) / 10000); // 年齢は誕生日の前日に1つ増える
  var R = D.rourei, kyu = b <= ymd(R.kyuBorn), g = kyu ? 'kyu' : 'shin';
  var N = R.tsukisu; for (var i = 0; i < R.tsukisuShuku.length; i++) { if (b <= ymd(R.tsukisuShuku[i][0])) { N = R.tsukisuShuku[i][1]; break; } }
  // 前年の所得：給与所得・公的年金等の雑所得（課税される年金だけ）・その他の所得。給与と年金の両方があれば所得金額調整控除
  var nenkin = x.nenkin || 0, ky = kyuyoShotoku(x.kyuyo || 0), so = x.sonota || 0;
  var nk = nenkinShotoku(nenkin, ky + so, b <= ymd(D.nenkin65Born));
  var adj = ky > 0 && nk > 0 ? mx(0, mn(ky, 100000) + mn(nk, 100000) - 100000) : 0;
  var r = { kind: x.kind, age: age, kyu: kyu, N: N, ky: ky, nk: nk, adj: adj, reasons: [], warn: [], type: null, getsu: 0 };
  if (x.kind === 'rourei') {
    r.sonotaShotoku = ky - adj + so;              // 合計所得金額 − 公的年金等の雑所得（施行令第4条）
    r.total = nenkin + r.sonotaShotoku;           // 前年所得額＝公的年金等の収入＋その他の所得
    r.kijunGaku = R.kijunGaku[g]; r.jogen = R.jogen[g];
    var nofu = mx(0, x.nofu || 0), zen = mx(0, x.zen || 0), q = mx(0, x.q || 0);
    if (nofu + zen + q > N) r.warn.push('tsukisu');
    r.a1 = rh(D.kijun * mn(nofu, N), N);          // 保険料納付済期間に基づく額
    r.a2 = rh(R.menjo[g].zen * zen + R.menjo[g].q * q, N); // 保険料免除期間に基づく額
    if (age < R.age) r.reasons.push('age');
    if (x.hikazei === false) r.reasons.push('kazei');
    if (r.total <= r.kijunGaku) { r.type = 'rourei'; r.getsu = r.a1 + r.a2; }
    else if (r.total <= r.jogen) { r.type = 'hosoku'; r.r1000 = rh((r.jogen - r.total) * 1000, r.jogen - r.kijunGaku); r.getsu = rh(r.a1 * r.r1000, 1000); }
    else r.reasons.push('shotoku');
  } else {
    var S = D.shotokuSeigen, K = D.kojo, f = x.fuyou || {};
    r.kojo = mx(0, x.kojo || 0) + (x.kafu === 'kafu' ? K.kafu : x.kafu === 'hitorioya' ? K.hitorioya : 0);
    r.shotoku = mx(0, nk + ky - adj + so - r.kojo);
    r.limit = S.kiso + S.ippan * (f.ippan || 0) + S.rojin * (f.rojin || 0) + S.tokutei * (f.tokutei || 0);
    if (x.kiso === false) r.reasons.push('kiso');
    if (r.shotoku > r.limit) r.reasons.push('shotoku');
    if (x.kind === 'shogai') { r.type = 'shogai'; r.getsu = x.tokyu === 1 ? rh(D.kijun * D.shogai.kyu1Pct, 100) : D.kijun; }
    else { r.type = 'izoku'; r.getsu = (x.ko || 0) >= 2 ? rh(D.kijun, x.ko) : D.kijun; }
  }
  if (r.reasons.length) r.ok = false; else if (x.kind === 'rourei' && x.hikazei !== true) r.ok = null; else r.ok = true;
  r.futsuki = r.getsu * 2; r.nen = r.getsu * 12;
  return r;
}`
const shienCalc = new Function(`${CORE}\nreturn shienCalc`)()

// ── 確かめ（写し間違いと式の誤りで止める）───────────────────────────────────────────
const R = D.rourei
if (!(D.kijun > 5000 && D.kijun < 7000)) die('給付基準額が範囲の外です（写し間違い？）')
for (const g of ['shin', 'kyu']) {
  if (Math.floor(R.manGaku[g] / 72) !== R.menjo[g].zen || Math.floor(R.manGaku[g] / 144) !== R.menjo[g].q) die(`免除期間の額（${g}）が老齢基礎年金の満額÷12÷6（÷12÷12）と合いません（写し間違い？）`)
  if (R.jogen[g] - R.kijunGaku[g] !== 100000) die(`補足的老齢の上限と所得基準額の差（${g}）が10万円になっていません（写し間違い？）`)
}
if (Math.round(D.kijun * D.shogai.kyu1Pct / 100) !== D.shogai.kyu1 || D.shogai.kyu2 !== D.kijun) die('障害の1級・2級の額が給付基準額（×125%）と合いません')
if (R.tsukisuShuku.length !== 25 || R.tsukisuShuku.some(([, m], i) => m !== 180 + 12 * i)) die('480月を短縮する表が25行・12月刻みになっていません（写し間違い？）')
const V7 = D.verifyOnly.r7
if (Math.floor(V7.manGakuShin / 72) !== V7.menjoShinZen) die('令和7年度の免除期間の額が満額÷72と合いません')
const D7 = { ...D, kijun: V7.kijun, rourei: { ...R, menjo: { ...R.menjo, shin: { zen: V7.menjoShinZen, q: Math.floor(V7.manGakuShin / 144) } } } }
const rows = []
for (const c of CASES) {
  const got = shienCalc(c.nendo === 'r7' ? D7 : D, c.x)
  if (got.ok !== true) die(`公式の計算例（${c.src}）が「対象」になりません：${got.reasons.join('・')}`)
  if (got.getsu !== c.want) die(`公式の計算例（${c.src}・${JSON.stringify(c.x)}）が合いません：公式 ${c.want}円／計算 ${got.getsu}円`)
  rows.push(`${c.src}：${yen(c.want)}`)
}
for (const e of EDGES) {
  const got = shienCalc(D, e.x)
  const t = got.ok === false ? null : got.type
  if (t !== e.want) die(`境目の確かめ（${JSON.stringify(e.x)}）が合いません：期待 ${e.want}／計算 ${t}`)
}
// 年金機構の「11,768円×月数÷480」と、法第3条第2号の文言どおり（満額×月数の6分の1÷480÷12）が何通りでずれるか（報告用）
let zure = 0
for (const g of ['shin', 'kyu']) for (let m = 1; m <= 480; m++) {
  const a = Math.floor((2 * R.menjo[g].zen * m + 480) / 960), b = Math.floor((2 * R.manGaku[g] * m + 34560) / 69120)
  if (a !== b) zure++
}
console.log(`確かめ：公式の計算例 ${CASES.length}例が円まで一致（${rows.join('／')}）`)
console.log(`確かめ：所得基準の境目 ${EDGES.length}通りが「以下・超え」どおり／障害1級＝基準額×125%／免除の額＝満額÷72・÷144／短縮の表25行`)
console.log(`参考：免除期間の額を法の文言どおりに計算すると、全額免除1〜480月×2つの生まれの区分のうち ${zure}通りで案内の式と1円ずれる（計算機は年金機構の案内の式）`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const T = (n) => num(n / 10000) + '万円'
const Y = (n) => num(n) + '円'
const S = D.shotokuSeigen
const sample = (o) => shienCalc(D, { kind: 'rourei', birth: '1958-06-15', asOf: '2026-10-01', nenkin: 780000, hikazei: true, zen: 0, q: 0, ...o })
const NOFU = [480, 450, 420, 360, 300, 240, 180, 120]
const nofuRows = NOFU.map((m) => { const r = sample({ nofu: m }); return `<tr><th>${m}月（${m / 12}年）</th><td class="num">${Y(r.getsu)}</td><td class="num">${Y(r.futsuki)}</td><td class="num">${Y(r.nen)}</td></tr>` }).join('\n')
const HOSOKU = [826500, 830000, 850000, 870000, 890000, 910000, 920000]
const hosokuRows = HOSOKU.map((n) => { const r = sample({ nofu: 480, nenkin: n }); return `<tr><th>${Y(n)}</th><td class="num">${r.type === 'rourei' ? '（老齢）' : (r.r1000 / 1000).toFixed(3)}</td><td class="num">${Y(r.getsu)}</td><td class="num">${Y(r.nen)}</td></tr>` }).join('\n')
const ex4281 = sample({ nofu: 240, zen: 60 })
const kyu1 = shienCalc(D, { kind: 'shogai', tokyu: 1, birth: '1985-05-05', asOf: '2026-10-01' }).getsu

const JD = { kijun: D.kijun, rourei: R, shogai: D.shogai, shotokuSeigen: S, kojo: D.kojo, nenkin65Born: D.nenkin65Born }
const JS = `${CORE}
(function(){var D=${JSON.stringify(JD)};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function v(i){var s=($(i).value||'').replace(/[,，円万\\s]/g,'');if(s==='')return 0;var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x*10000):0}
function m(i){var s=($(i).value||'').replace(/[,，月\\s]/g,'');var x=parseInt(s,10);return isFinite(x)&&x>0?x:0}
function n(i){var x=parseInt($(i).value,10);return isFinite(x)&&x>0?x:0}
function pad(x){return (x<10?'0':'')+x}
function today(){var t=new Date();return t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate())}
var WA=function(y){if(y>=1989)return y===1989?'平成元':'平成'+(y-1988);if(y>=1926)return y===1926?'昭和元':'昭和'+(y-1925);return '大正'+(y-1911)};
(function(){var s='';for(var y=1915;y<=2026;y++)s+='<option value="'+y+'"'+(y===1958?' selected':'')+'>'+y+'年（'+WA(y)+'年）</option>';$('q-by').innerHTML=s;
 var t='';for(var i=1;i<=12;i++)t+='<option value="'+i+'"'+(i===4?' selected':'')+'>'+i+'月</option>';$('q-bm').innerHTML=t;
 var u='';for(var j=1;j<=31;j++)u+='<option value="'+j+'"'+(j===2?' selected':'')+'>'+j+'日</option>';$('q-bd').innerHTML=u})();
var KIND={rourei:'老齢年金生活者支援給付金',hosoku:'補足的老齢年金生活者支援給付金',shogai:'障害年金生活者支援給付金',izoku:'遺族年金生活者支援給付金'};
function why(c,r,k){if(c==='age')return '65歳になっていません（老齢の給付金は65歳から。請求書は65歳になる誕生日の前日から出せます）。';
 if(c==='kazei')return '世帯に住民税がかかっている人がいます。老齢の給付金は、住民票が同じ世帯の全員が住民税非課税であることが条件です。';
 if(c==='kiso')return k==='shogai'?'障害基礎年金を受けていません。障害厚生年金の3級だけの人や障害手当金の人は、障害の給付金の対象外です。':'遺族基礎年金を受けていません。遺族厚生年金だけの人（子のいない配偶者など）は、遺族の給付金の対象外です。';
 if(c==='shotoku')return k==='rourei'?'前年（令和7年）の年金収入とその他の所得の合計 '+yen(r.total)+' が '+yen(r.jogen)+' を超えています。':'前年（令和7年）の所得 '+yen(r.shotoku)+' が上限 '+yen(r.limit)+' を超えています。';return ''}
function calc(){var kd=$('q-kind').value,k=kd.split('-')[0],o=$('q-out');
 $('q-ro').style.display=k==='rourei'?'':'none';$('q-si').style.display=k!=='rourei'?'':'none';$('q-ko-row').style.display=kd==='izoku'?'':'none';
 var by=+$('q-by').value,bm=+$('q-bm').value,bd=+$('q-bd').value,birth=by+'-'+pad(bm)+'-'+pad(bd);
 var hz=$('q-hz').value;
 var x={kind:k,birth:birth,asOf:today(),nenkin:v('q-nen'),kyuyo:v('q-kyu'),sonota:v('q-so'),hikazei:hz==='1'?true:hz==='0'?false:null,
  nofu:m('q-nofu'),zen:m('q-zen'),q:m('q-q'),tokyu:kd==='shogai-1'?1:2,kiso:!(kd==='shogai-3'||kd==='izoku-k'),
  ko:kd==='izoku'&&$('q-who').value==='ko'?n('q-ko'):0,kojo:v('q-kojo'),kafu:$('q-kafu').value,fuyou:{ippan:n('q-f1'),rojin:n('q-f2'),tokutei:n('q-f3')}};
 var r=shienCalc(D,x),h='';
 if(r.ok===false){h+='<p class="total">対象外の見込みです</p><ul class="bd">';for(var i=0;i<r.reasons.length;i++)h+='<li>'+why(r.reasons[i],r,k)+'</li>';h+='</ul>';
  if(r.type&&r.getsu>0&&r.reasons.indexOf('shotoku')<0&&r.reasons.indexOf('kiso')<0)h+='<p class="bd">この条件を満たせば、'+KIND[r.type]+'は月額 '+yen(r.getsu)+' の見込みです。</p>';}
 else{h+='<p class="total">月額 '+yen(r.getsu)+'</p><p class="bd"><strong>'+KIND[r.type]+'</strong>。2か月ごと（偶数月の中旬）に <strong>'+yen(r.futsuki)+'</strong>、1年で '+yen(r.nen)+' です。</p>';
  if(r.ok===null)h+='<p class="bd"><strong>世帯全員が住民税非課税なら</strong>、の見込みです。非課税かどうかは<a href="/articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で確かめられます。</p>';}
 if(k==='rourei'){h+='<ul class="bd"><li>前年（令和7年）の年金収入 '+yen(x.nenkin)+'＋その他の所得 '+yen(r.sonotaShotoku)+'＝<strong>'+yen(r.total)+'</strong>（'+(r.kyu?'昭和31年4月1日以前':'昭和31年4月2日以後')+'生まれの基準：'+yen(r.kijunGaku)+'以下で老齢、'+yen(r.jogen)+'以下で補足的老齢）</li>';
  h+='<li>保険料納付済期間に基づく額 '+yen(r.a1)+'（'+yen(D.kijun)+'×'+Math.min(x.nofu,r.N)+'月÷'+r.N+'月）'+(r.type==='hosoku'?'×調整支給率 '+(r.r1000/1000).toFixed(3):'')+'</li>';
  if(r.type!=='hosoku'&&(x.zen>0||x.q>0))h+='<li>保険料免除期間に基づく額 '+yen(r.a2)+'（'+yen(D.rourei.menjo[r.kyu?'kyu':'shin'].zen)+'×'+x.zen+'月'+(x.q?'＋'+yen(D.rourei.menjo[r.kyu?'kyu':'shin'].q)+'×'+x.q+'月':'')+'÷'+r.N+'月）</li>';
  else if(r.a2>0)h+='<li>補足的老齢の給付金には、保険料免除期間に基づく額はつきません。</li>';
  h+='</ul>';
  if(r.N<480)h+='<p class="bd">昭和16年4月1日以前生まれのため、480月の代わりに'+r.N+'月で割っています。</p>';
  if(r.warn.indexOf('tsukisu')>=0)h+='<p class="bd"><strong>納付済と免除の月数の合計が'+r.N+'月を超えています。</strong>20歳から60歳までの国民年金の月数（年金証書・支給額変更通知書・ねんきんネットの値）を入れ直してください。</p>';
  if(x.nofu===0&&x.zen===0&&x.q===0)h+='<p class="bd">保険料の納付済月数・免除月数を入れると額が出ます（年金証書や支給額変更通知書、ねんきんネットで確かめられます）。</p>';
  if(r.type==='hosoku')h+='<p class="bd">確認中：補足的老齢の額は、政令どおりの式で出していますが、公式の数字入りの計算例と1円まで照らせていません。</p>';
  if(r.type==='rourei'&&(x.zen>0||x.q>0))h+='<p class="bd">確認中：免除期間の額は年金機構の案内の式（'+yen(D.rourei.menjo[r.kyu?'kyu':'shin'].zen)+'×月数÷'+r.N+'）で出しています。法律の文言どおりに計算すると1円違う場合があります。</p>';}
 else{h+='<ul class="bd"><li>前年（令和7年）の所得 '+yen(r.shotoku)+'（給与・課税される年金・その他の所得の合計から、社会保険料など・寡婦／ひとり親の控除 '+yen(r.kojo)+' を引いた額）</li><li>上限 '+yen(r.limit)+'（'+yen(D.shotokuSeigen.kiso)+'＋扶養親族の加算）</li></ul>';
  if(kd==='izoku'&&x.ko>=2)h+='<p class="bd">子が'+x.ko+'人で遺族基礎年金を受けているので、'+yen(D.kijun)+'÷'+x.ko+'＝'+yen(r.getsu)+'が1人ずつに支払われます。</p>';}
 o.innerHTML=h}
['q-kind','q-by','q-bm','q-bd','q-nen','q-kyu','q-so','q-hz','q-nofu','q-zen','q-q','q-who','q-ko','q-kojo','q-kafu','q-f1','q-f2','q-f3'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});
$('q-who').addEventListener('change',function(){$('q-ko').disabled=$('q-who').value!=='ko'});calc()})();`

const FAQ = [
  ['年金生活者支援給付金はいくらですか？（令和8年度）', `令和8年度（令和8年4月分から）の基準額は月額${Y(D.kijun)}です。障害は1級${Y(D.shogai.kyu1)}・2級${Y(D.shogai.kyu2)}、遺族は${Y(D.kijun)}（2人以上の子が遺族基礎年金を受けているときは${Y(D.kijun)}を子の数で割った額）。老齢は${Y(D.kijun)}を上限に、国民年金の保険料を納めた月数と免除された月数で決まります（40年＝480月すべて納めていれば${Y(D.kijun)}、納付済240月・全額免除60月なら${Y(ex4281.getsu)}）。2か月分ずつ、偶数月に年金とは別に振り込まれます。`],
  ['老齢の給付金の対象になるのはどんな人ですか？', `65歳以上で老齢基礎年金を受けていて、①同じ世帯の全員が住民税非課税、②前年の公的年金等の収入とその他の所得の合計が${Y(R.kijunGaku.shin)}以下（昭和31年4月1日以前生まれは${Y(R.kijunGaku.kyu)}以下）の人です。この額を超えても${Y(R.jogen.shin)}以下（同${Y(R.jogen.kyu)}以下）なら、額が少し減る「補足的老齢年金生活者支援給付金」が出ます。令和8年10月分から令和9年9月分までは、令和7年の収入・所得で判定します。`],
  ['年金収入に障害年金や遺族年金は入りますか？', '入りません。障害年金・遺族年金は税金のかからない収入なので、老齢の給付金の「年金収入」にも、障害・遺族の給付金の「所得」にも含めません。入れるのは老齢基礎年金・老齢厚生年金・企業年金など、税金の対象になる年金の収入です。'],
  ['障害年金・遺族年金の給付金に所得制限はありますか？', `あります。前年の所得が${Y(S.kiso)}以下であることが条件で、扶養親族が1人いるごとに${T(S.ippan)}（70歳以上の同一生計配偶者・老人扶養親族は${T(S.rojin)}、16歳以上23歳未満の扶養親族は${T(S.tokutei)}）が足されます。老齢と違い、世帯の住民税が非課税である必要はありません。障害厚生年金の3級だけ・遺族厚生年金だけの人は、障害基礎年金・遺族基礎年金を受けていないので対象外です。`],
  ['手続きは必要ですか？いつから受け取れますか？', '新しく対象になる人には、日本年金機構から「年金生活者支援給付金請求書（はがき型）」が届きます（令和8年度は9月1日から順次）。原則として請求した月の翌月分から支給されるので、届いたら早めに出してください。いちど受け取り始めた人は、翌年からは手続きなしで毎年判定されます。'],
  ['夫婦2人とも受け取れますか？', '受け取れます。年金生活者支援給付金は1人ずつに支払われるもので、夫婦2人とも条件を満たせば、それぞれに支給されます。'],
]

const body = `  <p class="lead"><strong>年金生活者支援給付金</strong>は、年金や所得が少ない人に、年金に上乗せして支給されるお金です（返す必要はありません）。老齢基礎年金を受けている65歳以上の人、障害基礎年金・遺族基礎年金を受けている人が対象で、所得などの条件があります。生年月日・前年の年金収入・保険料を納めた月数などを入れると、${esc(D.nendo)}（${esc(D.kikan)}）の月額と、2か月ごとに振り込まれる額の目安が分かります。</p>

  <div class="callout point">
    <p><span class="tag">令和8年度の年金生活者支援給付金（月額）</span><br>老齢：最大 <strong>${Y(D.kijun)}</strong>（保険料を納めた月数・免除された月数で決まる）<br>障害：1級 <strong>${Y(D.shogai.kyu1)}</strong>／2級 <strong>${Y(D.shogai.kyu2)}</strong><br>遺族：<strong>${Y(D.kijun)}</strong>（子が2人以上で受けるときは子の数で割る）<br>老齢の所得の基準：前年の年金収入＋その他の所得が ${Y(R.kijunGaku.shin)}以下（${Y(R.jogen.shin)}以下なら補足的老齢）・世帯全員が住民税非課税</p>
  </div>

  <h2 id="keisan">給付金を計算する（${esc(D.nendo)}）</h2>
  <div class="calc">
    <div class="row"><label for="q-kind">受けている年金</label><select id="q-kind">
      <option value="rourei">老齢基礎年金（老齢年金）</option>
      <option value="shogai-1">障害基礎年金 1級</option>
      <option value="shogai-2">障害基礎年金 2級</option>
      <option value="shogai-3">障害厚生年金 3級だけ（障害基礎年金なし）</option>
      <option value="izoku">遺族基礎年金</option>
      <option value="izoku-k">遺族厚生年金だけ（遺族基礎年金なし）</option>
    </select></div>
    <div class="row"><label for="q-by">生年月日</label><span><select id="q-by"></select> <select id="q-bm" aria-label="生まれた月"></select> <select id="q-bd" aria-label="生まれた日"></select></span></div>
    <p class="mini-note">金額は<strong>万円</strong>で入れてください（例：年金が年78万円なら 78）。${esc(D.shotokuNen)}（前の年）の1年分です。<strong>障害年金・遺族年金は入れません</strong>（税金のかからない収入なので、判定に含まれません）。</p>
    <div class="row"><label for="q-nen">公的年金の収入（老齢基礎・老齢厚生・企業年金など・万円・年）</label><input id="q-nen" type="text" inputmode="decimal" placeholder="例 78"></div>
    <div class="row"><label for="q-kyu">給与の収入（万円・年）</label><input id="q-kyu" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label for="q-so">それ以外の所得（事業・不動産などの所得・万円）</label><input id="q-so" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div id="q-ro">
      <div class="row"><label for="q-hz">同じ世帯の全員が住民税非課税ですか</label><select id="q-hz"><option value="1">はい（全員非課税）</option><option value="0">いいえ（誰かに住民税がかかっている）</option><option value="">わからない</option></select></div>
      <p class="mini-note">国民年金の保険料の月数（20歳〜60歳）。年金証書・支給額変更通知書・ねんきんネットで確かめられます。学生納付特例の月は入れません（確認中：納付猶予の月も入れない扱いにしています）。</p>
      <div class="row"><label for="q-nofu">保険料納付済の月数</label><input id="q-nofu" type="text" inputmode="numeric" placeholder="例 480" value="480"></div>
      <div class="row"><label for="q-zen">全額免除・4分の3免除・半額免除の月数</label><input id="q-zen" type="text" inputmode="numeric" placeholder="なければ空欄"></div>
      <div class="row"><label for="q-q">4分の1免除の月数</label><input id="q-q" type="text" inputmode="numeric" placeholder="なければ空欄"></div>
    </div>
    <div id="q-si" style="display:none">
      <div class="row"><label for="q-kojo">社会保険料・医療費控除などの合計（万円・年）</label><input id="q-kojo" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
      <div class="row"><label for="q-kafu">寡婦控除・ひとり親控除</label><select id="q-kafu"><option value="">受けていない</option><option value="kafu">寡婦控除を受けている</option><option value="hitorioya">ひとり親控除を受けている</option></select></div>
      <div class="row"><label for="q-f1">扶養親族の数（下の2つ以外）</label><input id="q-f1" type="number" min="0" max="9" value="0"></div>
      <div class="row"><label for="q-f2">うち70歳以上の配偶者・老人扶養親族の数</label><input id="q-f2" type="number" min="0" max="9" value="0"></div>
      <div class="row"><label for="q-f3">うち16歳以上23歳未満の扶養親族の数</label><input id="q-f3" type="number" min="0" max="9" value="0"></div>
      <div class="row" id="q-ko-row"><label for="q-who">遺族基礎年金を受けているのは</label><span><select id="q-who"><option value="oya">配偶者（親）</option><option value="ko">子（子が受けている）</option></select> <input id="q-ko" type="number" min="1" max="9" value="1" disabled aria-label="遺族基礎年金を受けている子の数"> 人</span></div>
    </div>
    <div class="out" id="q-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">今日の日付で年齢を見ています。給付金は請求した月の翌月分からで、年金機構が市区町村から所得の情報を受けて判定します。正式な額は、年金機構から届く支給決定通知書・振込通知書で確かめてください。</p>

  <h2 id="hayami">老齢の給付金の早見表（保険料をすべて納めた月数別）</h2>
  <div class="table-wrap"><table class="fit">
    <caption>昭和16年4月2日以後生まれ・免除の月なし・老齢年金生活者支援給付金の${esc(D.nendo)}の額</caption>
    <thead><tr><th>保険料納付済の月数</th><th class="num">月額</th><th class="num">2か月ごと</th><th class="num">年額</th></tr></thead>
    <tbody>
${nofuRows}
    </tbody>
  </table></div>
  <p class="mini-note">免除された月があると、その分が足されます（全額・4分の3・半額免除は1月あたり${Y(R.menjo.shin.zen)}÷480、4分の1免除は${Y(R.menjo.shin.q)}÷480。昭和31年4月1日以前生まれは${Y(R.menjo.kyu.zen)}・${Y(R.menjo.kyu.q)}）。</p>

  <h2 id="hosoku">年金収入が基準を少し超えたとき（補足的老齢）</h2>
  <p>老齢の給付金は、前年の年金収入とその他の所得の合計が${Y(R.kijunGaku.shin)}を1円でも超えると出なくなるわけではありません。給付金をもらう人ともらわない人の手取りが逆転しないように、${Y(R.jogen.shin)}までは<strong>補足的老齢年金生活者支援給付金</strong>が、収入が増えるほど少しずつ減る形で出ます。</p>
  <div class="table-wrap"><table class="fit">
    <caption>昭和31年4月2日以後生まれ・保険料納付済480月の人の${esc(D.nendo)}の額（その他の所得なし）</caption>
    <thead><tr><th>前年の年金収入</th><th class="num">調整支給率</th><th class="num">月額</th><th class="num">年額</th></tr></thead>
    <tbody>
${hosokuRows}
    </tbody>
  </table></div>
  <p class="mini-note">補足的老齢の額＝${Y(D.kijun)}×納付済月数÷480×調整支給率（＝（${Y(R.jogen.shin)}−前年の年金収入とその他の所得の合計）÷100,000円。小数点以下3位まで）。保険料免除期間に基づく額はつきません。<strong>確認中</strong>：この表は政令どおりの式で出したもので、公式の数字入りの計算例とは照らせていません。</p>

  <h2 id="shikumi">対象になる条件</h2>
  <ul>
    <li><strong>老齢</strong>：65歳以上で老齢基礎年金を受けている／同じ世帯の全員が住民税非課税（${esc(D.kazeiNendo)}）／前年の公的年金等の収入＋その他の所得が${Y(R.kijunGaku.shin)}以下（昭和31年4月1日以前生まれは${Y(R.kijunGaku.kyu)}以下）。${Y(R.jogen.shin)}（同${Y(R.jogen.kyu)}）以下なら補足的老齢。月額＝${Y(D.kijun)}×納付済月数÷480＋${Y(R.menjo.shin.zen)}×免除月数÷480（昭和16年4月1日以前生まれは、生年月日に応じて480月を短くします）。</li>
    <li><strong>障害</strong>：障害基礎年金（1級・2級）を受けている／前年の所得が${Y(S.kiso)}＋扶養親族の加算以下。月額 1級${Y(D.shogai.kyu1)}・2級${Y(D.shogai.kyu2)}。</li>
    <li><strong>遺族</strong>：遺族基礎年金を受けている／前年の所得が${Y(S.kiso)}＋扶養親族の加算以下。月額${Y(D.kijun)}。</li>
    <li>日本に住んでいない・年金が全額止まっている・刑事施設などに入っているときは支給されません。</li>
  </ul>
  <p class="mini-note">「その他の所得」は、住民税の合計所得金額から公的年金等の所得を引いた額です（給与なら給与所得控除後の額）。障害・遺族の「所得」は、住民税の総所得金額などから、社会保険料控除・医療費控除・寡婦（27万円）・ひとり親（35万円）・扶養している障害者の障害者控除（27万円、特別障害者40万円）などを引いた額です。この計算機は、障害者控除・勤労学生控除などの個別の欄を作っていないので、該当する人は「社会保険料・医療費控除などの合計」に足して入れてください。</p>
`

const html = toolPage({
  rel: REL,
  title: `年金生活者支援給付金の計算（${D.nendo}）｜月額・対象になるか・老齢／障害／遺族｜フクシル`,
  desc: `年金生活者支援給付金（${D.nendo}・${D.kikan}）の月額を計算します。老齢は前年の年金収入と保険料の納付済・免除の月数から（基準額 月${num(D.kijun)}円）、障害は1級${num(D.shogai.kyu1)}円・2級${num(D.shogai.kyu2)}円、遺族は${num(D.kijun)}円。所得の基準（${num(R.kijunGaku.shin)}円・補足的老齢${num(R.jogen.shin)}円・障害遺族${num(S.kiso)}円）で対象になるか、外れるならどの条件かも分かります。`,
  ogTitle: `年金生活者支援給付金の計算（${D.nendo}）`,
  published: '2026-10-28',
  crumb: '年金生活者支援給付金の計算',
  h1: '年金生活者支援給付金の計算（令和8年度）',
  h1sub: '月額・対象になるか（老齢・補足的老齢・障害・遺族）',
  updatedNote: `${D.nendo}の額（日本年金機構の公表）で計算`,
  body,
  faq: FAQ,
  related: '世帯が住民税非課税かどうかは<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、障害年金そのものの額は<a href="{{UP}}articles/shogai-nenkin-keisanki.html">障害年金の計算機</a>と<a href="{{UP}}articles/shogai-nenkin-basics.html">障害年金の基礎</a>で、75歳以上の保険料は<a href="{{UP}}kouki/">後期高齢者医療保険料の計算</a>で、65歳以上の介護保険料は<a href="{{UP}}kaigo/hokenryo/">介護保険料の計算</a>で確かめられます。',
  sources: D.sources,
  disclaimer: `このページの計算は、日本年金機構・厚生労働省が公表した${D.nendo}の額と、法令（年金生活者支援給付金の支給に関する法律・同施行令）・国税庁の控除の表にもとづく<strong>目安</strong>です。支給するかどうかと額は日本年金機構が決め、支給決定通知書・振込通知書で知らされます。所得は年金・給与・事業などの所得だけを扱い、譲渡所得・退職所得や一部の控除は入れていません。補足的老齢の額と免除期間の端数の扱いは、公式の数字入りの計算例と1円まで照らせていない部分があります（ページ内に「確認中」と書いています）。困ったときは「給付金専用ダイヤル」0570-05-4092 か、お近くの年金事務所に相談してください。`,
  js: JS,
})

if (!html.includes('id="q-out"') || !html.includes('function shienCalc')) die('面の組み立てに失敗しました')
if (OUT) { fs.writeFileSync(OUT, html); console.log(`--out：${OUT} に書いた（${(html.length / 1024).toFixed(1)}KB・sitemap は触っていない）`) }
else writeTool(REL, html, { dry: DRY })
