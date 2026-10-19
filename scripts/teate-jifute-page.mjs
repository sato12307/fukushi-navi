// ─────────────────────────────────────────────────────────────────────────────
// teate-jifute-page.mjs — 児童扶養手当の計算機（所得制限・一部支給の月額・年金との差額・扶養義務者）の面 /teate/jido-fuyo/ を作る。
//   node scripts/teate-jifute-page.mjs        → teate/jido-fuyo/index.html と sitemap.xml の1行
//   node scripts/teate-jifute-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-20 ユーザー「のこった案をすべてフクシルに増床してくれ」・裁定 4「（手当の額を）だしてよい」）
//   第189〜192回で4回続けて条件つきで残った案。Bing 90日＝児童扶養手当 所得制限 1,754・母子手当 所得制限 年収 601・児童扶養手当 金額 345。
//   上位は自治体の PDF と解説記事で、条件を入れて月額まで出す計算機が無い。
// ★数字はここに書かない。data/jifute.json（児童扶養手当法・同施行令の現行版から写したもの）だけを読む。
// ★計算の式は CORE の1か所だけ（収入→所得は shotoku-core.mjs）。公式の計算例（神戸市・草加市・東京都中央区・吹田市）と
//   限度額の境目に通して円まで合わなければ止める。子が遺族年金を受けている場合・5年等経過の2分の1停止・災害の特例は扱わない（面に書く）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const REL = 'teate/jido-fuyo/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'jifute.json'), 'utf8'))

// ── 計算の式（ここだけ）─────────────────────────────────────────────────────
const CORE = `${SHOTOKU_CORE}
function jifuteCalc(D, nk, x) {
  var fl = Math.floor, N = D.nendo[nk], L = D.limit, K = D.kojo, kids = Math.max(1, x.kodomo || 1);
  // 10円単位に丸める（5円未満は切り捨て・5円以上は10円に切り上げ）。r10e7 は 1千万分の1円の整数を受ける
  function r10e7(v) { var t = fl(v / 100000000), rem = v - t * 100000000; return (rem >= 50000000 ? t + 1 : t) * 10; }
  function r10(y) { return fl(y / 10) * 10 + (y % 10 >= 5 ? 10 : 0); }
  var yoiku = x.jukyu === 'yoikusha', sho;
  if (x.shotokuGaku != null) sho = x.shotokuGaku;
  else {
    var ky = x.kyuyoShotoku != null ? x.kyuyoShotoku : kyuyoShotoku(x.kyuyo || 0), so = x.sonota || 0;
    var nkS = nenkinShotoku(x.nenkinShunyu || 0, ky + so, !!x.age65);
    var gn = ky + nkS, base = (gn > 0 ? Math.max(0, gn - K.kyuyoNenkin) : 0) + so;
    if (!yoiku) base += Math.round((x.youikuhi || 0) * D.youikuhi / 100);
    var kj = K.shaho + K.shogai * (x.shogai || 0) + K.tokubetsu * (x.tokubetsu || 0) + (x.kinro ? K.kinro : 0) + (x.jitsugaku || 0);
    if (yoiku) kj += (x.kafu ? K.kafu : 0) + (x.hitorioya ? K.hitorioya : 0);
    sho = Math.max(0, base - kj);
  }
  var fu = x.fuyou || 0, add = L.per * fu + L.rojin * (x.rojin || 0) + L.tokutei * (x.tokutei || 0);
  var zenLim = L.zen + add, ichiLim = L.ichibu + add, yoikuLim = L.gimu + L.per * fu + L.gimuRojin * (fu > (x.rojin || 0) ? (x.rojin || 0) : Math.max(0, (x.rojin || 0) - 1));
  var Z = N.zen + N.kasan * (kids - 1), t1, tk, kubun, by = '';
  if (yoiku) { if (sho < yoikuLim) { t1 = N.zen; tk = N.kasan; kubun = 'zen'; } else { t1 = 0; tk = 0; kubun = 'teishi'; by = 'honnin'; } }
  else if (sho < zenLim) { t1 = N.zen; tk = N.kasan; kubun = 'zen'; }
  else if (sho < ichiLim) { var d = sho - zenLim; t1 = N.zen - (r10e7(d * N.c1) + 10); tk = N.kasan - (r10e7(d * N.c2) + 10); kubun = 'ichibu'; }
  else { t1 = 0; tk = 0; kubun = 'teishi'; by = 'honnin'; }
  var total = t1 + tk * (kids - 1), gimuOut = [];
  (x.gimu || []).forEach(function (g) {
    var gs = g.gaku != null ? g.gaku : Math.max(0, (g.shotoku || 0) - (g.kyuyoNenkin ? K.kyuyoNenkin : 0) - K.shaho);
    var gf = g.fuyou || 0, gr = g.rojin || 0, gl = L.gimu + L.per * gf + L.gimuRojin * (gf > gr ? gr : Math.max(0, gr - 1));
    gimuOut.push({ gaku: gs, lim: gl, over: gs >= gl });
    if (gs >= gl && total > 0) { total = 0; kubun = 'teishi'; by = 'gimu'; }
  });
  var before = total, chosei = 0, n = x.nenkin || {};
  if (total > 0 && (n.type === 'shogai' || n.type === 'haigusha')) {
    var per = [], k = Math.min(n.kasanKo || 0, 10);
    for (var i = 0; i < k; i++) per.push(fl((i < 2 ? D.shogaiKasan.first2 : D.shogaiKasan.after) / 12));
    per.sort(function (a, b) { return a - b; });
    var sum = 0; per.forEach(function (v, i) { sum += i === 0 ? v : Math.min(v, D.caps[i === 1 ? 0 : 1]); });
    chosei = r10(sum);
  } else if (total > 0 && n.type === 'sonota') chosei = r10(n.getsugaku || 0);
  if (chosei > 0) { total = Math.max(0, total - chosei); if (total === 0) { kubun = 'teishi'; by = 'nenkin'; } }
  return { kubun: kubun, by: by, sho: sho, zenLim: yoiku ? yoikuLim : zenLim, ichiLim: yoiku ? null : ichiLim, Z: Z, t1: t1, tk: tk, kids: kids, before: before, chosei: chosei, total: total, gimu: gimuOut, yoiku: yoiku };
}`
const jifuteCalc = new Function(`${CORE}\nreturn jifuteCalc`)()

// ── 確かめ（公式の計算例と境目）──────────────────────────────────────────────
const R8 = D.nendo.R8
if (R8.zen !== 48050 || R8.kasan !== 11350) die('令和8年度の手当の額が施行令第2条の2（48,050円・11,350円）と違います')
const CASES = [
  { src: '草加市（所得200万円・児童3人・扶養3人・令和8年度）', nk: 'R8', x: { jukyu: 'haha', kodomo: 3, shotokuGaku: 2000000, fuyou: 3 }, want: 64850, kubun: 'ichibu' },
  { src: '草加市（同・令和7年度）', nk: 'R7', x: { jukyu: 'haha', kodomo: 3, shotokuGaku: 2000000, fuyou: 3 }, want: 63020, kubun: 'ichibu' },
  { src: '東京都中央区（給与収入120万円＝給与所得65万円・扶養1人）', nk: 'R8', x: { jukyu: 'haha', kodomo: 1, kyuyoShotoku: 650000, fuyou: 1 }, want: 48050, kubun: 'zen', sho: 470000 },
  { src: '神戸市1（父・児童3人・父が障害基礎年金2級で3人とも子の加算）', nk: 'R8', x: { jukyu: 'chichi', kodomo: 3, shotokuGaku: 0, fuyou: 3, nenkin: { type: 'shogai', kasanKo: 3 } }, want: 55970 },
  { src: '神戸市2（母・児童2人・母が障害基礎年金1級）', nk: 'R8', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 0, fuyou: 2, nenkin: { type: 'shogai', kasanKo: 2 } }, want: 34080 },
  { src: '神戸市3（母・児童1人・母が遺族年金 月額2万円）', nk: 'R8', x: { jukyu: 'haha', kodomo: 1, shotokuGaku: 0, fuyou: 1, nenkin: { type: 'sonota', getsugaku: 20000 } }, want: 28050 },
  { src: '神戸市5（母・児童1人・父が障害基礎年金1級で子の加算）', nk: 'R8', x: { jukyu: 'haha', kodomo: 1, shotokuGaku: 0, fuyou: 1, nenkin: { type: 'haigusha', kasanKo: 1 } }, want: 27730 },
  { src: '境目（扶養1人・所得1,069,999円・児童2人）', nk: 'R8', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 1069999, fuyou: 1 }, want: 59400, kubun: 'zen' },
  { src: '境目（扶養1人・所得1,070,000円・児童2人）', nk: 'R8', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 1070000, fuyou: 1 }, want: 48040 + 11340, kubun: 'ichibu' },
  { src: '境目（扶養1人・所得2,459,999円・児童2人＝下限）', nk: 'R8', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 2459999, fuyou: 1 }, want: 11340 + 5680, kubun: 'ichibu' },
  { src: '境目（扶養1人・所得2,460,000円）', nk: 'R8', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 2460000, fuyou: 1 }, want: 0, kubun: 'teishi' },
  { src: '境目 令和7年度の下限（扶養1人・所得2,459,999円）', nk: 'R7', x: { jukyu: 'haha', kodomo: 2, shotokuGaku: 2459999, fuyou: 1 }, want: 11010 + 5520 },
  { src: '吹田市の考え方（同居の祖父＝扶養1人・所得2,739,999円）', nk: 'R8', x: { jukyu: 'haha', kodomo: 1, shotokuGaku: 0, fuyou: 1, gimu: [{ gaku: 2739999, fuyou: 1 }] }, want: 48050 },
  { src: '吹田市の考え方（同居の祖父＝扶養1人・所得2,740,000円）', nk: 'R8', x: { jukyu: 'haha', kodomo: 1, shotokuGaku: 0, fuyou: 1, gimu: [{ gaku: 2740000, fuyou: 1 }] }, want: 0, kubun: 'teishi' },
]
for (const c of CASES) {
  const r = jifuteCalc(D, c.nk, c.x)
  if (r.total !== c.want || (c.kubun && r.kubun !== c.kubun) || (c.sho != null && r.sho !== c.sho)) die(`${c.src} が合いません：公式 ${c.want}${c.kubun ? '・' + c.kubun : ''}${c.sho != null ? '・所得' + c.sho : ''}／計算 ${r.total}・${r.kubun}・所得${r.sho}`)
}
{ // 吹田市2：老人扶養1人（48万円で数える）と特定扶養1人（53万円）の限度額＝170万円・309万円
  const r = jifuteCalc(D, 'R8', { jukyu: 'haha', kodomo: 1, shotokuGaku: 0, fuyou: 2, rojin: 1, tokutei: 1 })
  if (r.zenLim !== 1700000 || r.ichiLim !== 3090000) die(`吹田市2の限度額（170万円・309万円）と合いません：${r.zenLim}・${r.ichiLim}`)
}
console.log(`確かめ：公式の計算例と境目 ${CASES.length + 1}件が円まで一致（神戸市4・草加市2・中央区1・吹田市3・境目5）`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const JS = `${CORE}
(function(){var D=${JSON.stringify({ nendo: { R8: D.nendo.R8 }, limit: D.limit, kojo: D.kojo, youikuhi: D.youikuhi, shogaiKasan: D.shogaiKasan, caps: D.caps })};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function m(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x*10000):0}
function c(i){var x=parseInt(($(i).value||'0'),10);return isFinite(x)&&x>0?x:0}
var KB={zen:'全部支給',ichibu:'一部支給',teishi:'支給なし（全部停止）'};
function calc(){var o=$('j-out'),j=$('j-who').value,kids=c('j-kids')||1,nt=$('j-nen').value,gm=$('j-gimu').value==='1';
 $('j-yoiku-row').style.display=j==='yoikusha'?'':'none';$('j-you-row').style.display=j==='yoikusha'?'none':'';
 $('j-kasan-row').style.display=(nt==='shogai'||nt==='haigusha')?'':'none';$('j-getsu-row').style.display=nt==='sonota'?'':'none';$('j-g').style.display=gm?'':'none';
 var x={jukyu:j,kodomo:kids,kyuyo:m('j-kyuyo'),nenkinShunyu:m('j-nenkin'),age65:$('j-65').checked,sonota:m('j-sonota'),youikuhi:m('j-youiku'),
  fuyou:$('j-fuyou').value===''?kids:c('j-fuyou'),rojin:c('j-rojin'),tokutei:c('j-tokutei'),shogai:c('j-shogai'),tokubetsu:c('j-toku'),kinro:$('j-kinro').checked,jitsugaku:m('j-jitsu'),
  kafu:$('j-kafu').checked,hitorioya:$('j-hitori').checked,
  nenkin:{type:nt,kasanKo:$('j-kasanko').value===''?kids:c('j-kasanko'),getsugaku:Math.round(parseFloat(($('j-getsu').value||'0').replace(/[,，円\\s]/g,''))||0)},
  gimu:gm?[{shotoku:m('j-gs'),kyuyoNenkin:$('j-gk').checked,fuyou:c('j-gf'),rojin:c('j-gr')}]:[]};
 var r=jifuteCalc(D,'R8',x),h='<p class="total">'+KB[r.kubun]+(r.total?'　月 '+yen(r.total):'')+'</p>';
 if(r.total)h+='<p class="bd">支給月（1・3・5・7・9・11月）には2か月分の '+yen(r.total*2)+' が振り込まれます。</p>';
 h+='<ul class="bd"><li>手当の計算に使う所得：'+yen(r.sho)+'</li>';
 if(r.yoiku)h+='<li>養育者の限度額（これ以上で支給なし）：'+yen(r.zenLim)+'</li>';
 else h+='<li>全部支給の限度額 '+yen(r.zenLim)+' 未満なら全部支給、一部支給の限度額 '+yen(r.ichiLim)+' 未満なら一部支給（扶養親族等 '+x.fuyou+'人）</li>';
 if(r.kubun==='ichibu')h+='<li>一部支給の額：1人目 '+yen(r.t1)+(r.kids>1?'＋2人目から1人 '+yen(r.tk)+'×'+(r.kids-1)+'人':'')+'</li>';
 if(r.chosei)h+='<li>年金との調整：手当 '+yen(r.before)+' から年金の月額 '+yen(r.chosei)+' を引いた差額を支給'+(r.total?'':'（年金のほうが多いので手当は出ません）')+'</li>';
 r.gimu.forEach(function(g){h+='<li>同居の扶養義務者の所得 '+yen(g.gaku)+'（限度額 '+yen(g.lim)+(g.over?'以上＝手当は全部止まります':'未満')+'）</li>'});
 if(r.kubun==='zen'&&!r.yoiku)h+='<li>所得があと '+yen(r.zenLim-r.sho)+' 増えると一部支給になります。</li>';
 if(r.kubun==='ichibu')h+='<li>所得があと '+yen(r.ichiLim-r.sho)+' 増えると支給なしになります。</li>';
 h+='</ul><p class="bd">'+(r.by==='honnin'?'あなたの所得が限度額以上なので、手当は出ません。':r.by==='gimu'?'同居の扶養義務者の所得が限度額以上なので、手当は出ません。':'')+'正式な額は、市区町村の認定で決まります。</p>';
 o.innerHTML=h}
['j-who','j-kids','j-kyuyo','j-nenkin','j-65','j-sonota','j-youiku','j-fuyou','j-rojin','j-tokutei','j-shogai','j-toku','j-kinro','j-jitsu','j-kafu','j-hitori','j-nen','j-kasanko','j-getsu','j-gimu','j-gs','j-gk','j-gf','j-gr'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const L = D.limit, K = D.kojo
const limRows = [0, 1, 2, 3, 4, 5].map((n) => `<tr><th>${n}人</th><td class="num">${num(L.zen + L.per * n)}</td><td class="num">${num(L.ichibu + L.per * n)}</td><td class="num">${num(L.gimu + L.per * n)}</td></tr>`).join('\n')
const opt = (n, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => `<option>${i + from}</option>`).join('')
const ex1 = jifuteCalc(D, 'R8', { jukyu: 'haha', kodomo: 1, kyuyo: 2000000, fuyou: 1 })
const ex2 = jifuteCalc(D, 'R8', { jukyu: 'haha', kodomo: 2, kyuyo: 2500000, fuyou: 2 })
const FAQ = [
  ['児童扶養手当はいくらもらえますか？（令和8年度）', `2026年4月分からの月額は、子1人で全部支給${yen(R8.zen)}、一部支給${yen(R8.zen - 10)}〜11,340円です。子が2人以上なら、2人目から1人につき全部支給${yen(R8.kasan)}、一部支給11,340円〜5,680円が加わります（児童扶養手当法施行令）。所得が全部支給の限度額未満なら全部支給、一部支給の限度額未満なら所得に応じて10円きざみで減ります。`],
  ['児童扶養手当の所得制限は年収いくらですか？', `所得制限は年収ではなく「所得額」（所得−8万円−諸控除。養育費の8割も足す）で見ます。子1人（扶養親族等1人）なら、全部支給は所得${num(L.zen + L.per)}円未満、一部支給は${num(L.ichibu + L.per)}円未満です。たとえば母・子1人で2025年の給与収入が200万円なら、所得額は${yen(ex1.sho)}で${ex1.kubun === 'zen' ? '全部支給' : ex1.kubun === 'ichibu' ? '一部支給（月' + yen(ex1.total) + '）' : '支給なし'}の目安です。`],
  ['一部支給の額はどう計算しますか？', `1人目の月額＝${yen(R8.zen)}−｛（所得額−全部支給の限度額）×0.0264029を10円単位に四捨五入した額＋10円｝。2人目からの加算は${yen(R8.kasan)}−｛（所得額−全部支給の限度額）×0.0040719（同じ丸め）＋10円｝です（令和8年4月分から）。たとえば子2人・扶養2人で給与収入250万円なら、目安は月${yen(ex2.total)}です。`],
  ['障害年金や遺族年金を受けていても児童扶養手当はもらえますか？', '受けられることがあります。障害基礎年金などを受けている人は、年金の「子の加算」の部分の月額だけが手当から差し引かれ、手当のほうが多ければ差額を受け取れます（2021年3月分から）。遺族年金・老齢年金などは、年金の月額全体と比べて、手当のほうが多ければ差額を受け取れます。申請が必要です。'],
  ['同居している親の収入で止まることはありますか？', `あります。同居して生計を同じくする父母・祖父母・兄弟姉妹などの扶養義務者の所得が限度額（扶養親族0人で${num(L.gimu)}円、1人増えるごとに38万円を足す）以上だと、手当は全部止まります。扶養義務者の判定に養育費は入りません。`],
  ['支給日はいつですか？', `${D.shikyu}が振り込まれます（支払日は市区町村で違います）。`],
]

const body = `  <p class="lead"><strong>児童扶養手当</strong>（いわゆる母子手当・父子手当）は、ひとり親の家庭などに支給される手当です。月額は<strong>あなたの所得と扶養親族の数</strong>で決まり、所得が上がるにつれて10円きざみで減ります。公的年金を受けている人は年金との差額、同居の親などがいる人はその人の所得でも変わります。条件を入れると、${esc(R8.label)}の月額と区分（全部支給・一部支給・支給なし）が分かります。</p>

  <div class="callout point">
    <p><span class="tag">令和8年度の手当の月額（2026年4月分から）</span><br>子1人：全部支給 <strong>${yen(R8.zen)}</strong>・一部支給 ${yen(R8.zen - 10)}〜11,340円<br>2人目から1人につき：全部支給 <strong>${yen(R8.kasan)}</strong>・一部支給 11,340円〜5,680円<br>子1人の所得制限：全部支給は所得${num(L.zen + L.per)}円未満・一部支給は${num(L.ichibu + L.per)}円未満</p>
  </div>

  <h2 id="keisan">月額を計算する</h2>
  <div class="calc">
    <div class="row"><label for="j-who">受け取る人</label><select id="j-who"><option value="haha">母</option><option value="chichi">父</option><option value="yoikusha">祖父母など、父母に代わって育てている人（養育者）</option></select></div>
    <div class="row"><label for="j-kids">育てている子の数（18歳の年度末まで・障害のある子は20歳未満）</label><select id="j-kids">${opt(5, 1)}</select></div>
    <p class="mini-note">収入は<strong>2025年（1〜12月）の年額を万円</strong>で入れてください（2026年11月分〜2027年10月分の手当は2025年の所得で決まります）。</p>
    <div class="row"><label for="j-kyuyo">あなたの給与の収入（万円）</label><input id="j-kyuyo" type="text" inputmode="decimal" placeholder="例 200"></div>
    <div class="row"><label for="j-nenkin">あなたの公的年金の収入（万円）</label><input id="j-nenkin" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label><input id="j-65" type="checkbox"> 2025年12月31日に65歳以上だった</label></div>
    <div class="row"><label for="j-sonota">それ以外の所得（事業・不動産などの所得・万円）</label><input id="j-sonota" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row" id="j-you-row"><label for="j-youiku">受け取った養育費（年額・万円）</label><input id="j-youiku" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label for="j-fuyou">税法上の扶養親族等の数（子を含む）</label><input id="j-fuyou" type="text" inputmode="numeric" placeholder="空欄なら子の数"></div>
    <div class="row"><label for="j-rojin">そのうち70歳以上の人</label><select id="j-rojin">${opt(4)}</select></div>
    <div class="row"><label for="j-tokutei">そのうち16〜22歳の人</label><select id="j-tokutei">${opt(5)}</select></div>
    <div class="row"><label for="j-shogai">障害者控除の対象の人（家族を含む・人数）</label><select id="j-shogai">${opt(4)}</select></div>
    <div class="row"><label for="j-toku">そのうち特別障害者の人</label><select id="j-toku">${opt(4)}</select></div>
    <div class="row"><label><input id="j-kinro" type="checkbox"> 勤労学生控除を受けている</label></div>
    <div class="row"><label for="j-jitsu">医療費控除・小規模企業共済等掛金控除・配偶者特別控除など（実額・万円）</label><input id="j-jitsu" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row" id="j-yoiku-row" style="display:none"><label><input id="j-kafu" type="checkbox"> 寡婦控除を受けている</label> <label><input id="j-hitori" type="checkbox"> ひとり親控除を受けている</label></div>
    <div class="row"><label for="j-nen">公的年金との調整</label><select id="j-nen"><option value="none">年金は受けていない</option><option value="shogai">あなたが障害基礎年金（1・2級）などを受けていて、子の加算がある</option><option value="haigusha">配偶者（子の父または母）が障害基礎年金を受けていて、子の加算がある</option><option value="sonota">あなたが遺族年金・老齢年金などを受けている</option></select></div>
    <div class="row" id="j-kasan-row" style="display:none"><label for="j-kasanko">子の加算の対象になっている子の数</label><input id="j-kasanko" type="text" inputmode="numeric" placeholder="空欄なら子の数"></div>
    <div class="row" id="j-getsu-row" style="display:none"><label for="j-getsu">その年金の月額（年額÷12・円）</label><input id="j-getsu" type="text" inputmode="numeric" placeholder="例 20000"></div>
    <div class="row"><label for="j-gimu">同居して生計を同じくする親・祖父母・兄弟姉妹など</label><select id="j-gimu"><option value="0">いない</option><option value="1">いる</option></select></div>
    <div id="j-g" style="display:none">
      <div class="row"><label for="j-gs">その人の総所得金額等（課税証明書の所得・万円）</label><input id="j-gs" type="text" inputmode="decimal" placeholder="例 250"></div>
      <div class="row"><label><input id="j-gk" type="checkbox"> その所得に給与か年金の所得が含まれる</label></div>
      <div class="row"><label for="j-gf">その人の税法上の扶養親族の数</label><select id="j-gf">${opt(5)}</select></div>
      <div class="row"><label for="j-gr">そのうち70歳以上の人</label><select id="j-gr">${opt(4)}</select></div>
    </div>
    <div class="out" id="j-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">この計算機の式は、児童扶養手当法施行令どおりで、神戸市・草加市・東京都中央区・吹田市が公表している計算例と、所得制限の境目の値で1円まで合うことを確かめています。障害基礎年金などを受けている人は、非課税の障害年金も「公的年金の収入」に入れてください（手当の所得には非課税の年金も含めます）。扶養義務者の所得は、8万円と給与・年金の10万円だけを引いた目安です（医療費控除などは引いていません）。</p>

  <h2 id="seigen">所得制限限度額（2024年11月分から）</h2>
  <div class="table-wrap"><table class="fit">
    <caption>所得額（円）がこの額<strong>未満</strong>なら対象</caption>
    <thead><tr><th>扶養親族等の数</th><th class="num">本人・全部支給</th><th class="num">本人・一部支給</th><th class="num">扶養義務者・配偶者・養育者</th></tr></thead>
    <tbody>
${limRows}
    </tbody>
  </table></div>
  <p class="mini-note">6人以上は1人につき38万円を足します。本人の限度額には、70歳以上の同一生計配偶者・老人扶養親族1人につき10万円、特定扶養親族と16〜18歳の扶養親族1人につき15万円をさらに足します。扶養義務者などの限度額には、老人扶養親族1人につき6万円を足します（老人扶養親族のほかに扶養親族がいないときは1人を除く）。11月分〜翌年10月分の手当を、前の年の所得で判定します。</p>

  <h2 id="shotoku">手当の計算に使う「所得額」</h2>
  <p>所得額＝総所得金額等（給与所得・公的年金等の所得があるときは、その合計から10万円を引く）＋<strong>養育費の8割</strong>（受け取る人が母か父のとき）−<strong>8万円</strong>（社会保険料相当・一律）−諸控除。</p>
  <ul>
    <li>諸控除：障害者控除 1人${num(K.shogai)}円・特別障害者控除 1人${num(K.tokubetsu)}円・勤労学生控除 ${num(K.kinro)}円・雑損控除・医療費控除・小規模企業共済等掛金控除・配偶者特別控除（実額。特定親族特別控除も2026年11月分から）。</li>
    <li>寡婦控除（${num(K.kafu)}円）・ひとり親控除（${num(K.hitorioya)}円）は、受け取る人が母（ひとり親控除は母か父）のときは引きません。養育者や扶養義務者は引きます。</li>
  </ul>

  <h2 id="nenkin">公的年金との調整</h2>
  <ul>
    <li><strong>障害基礎年金など</strong>を受けている人：手当から、年金の<strong>子の加算の部分</strong>の月額（1・2人目は年243,800円÷12、3人目からは年81,300円÷12）だけを引きます。子が2人以上なら、いちばん少ない子はそのまま、2番目の子は5,000円まで、3番目からは3,000円までで数えます。</li>
    <li><strong>遺族年金・老齢年金など</strong>を受けている人：年金の月額全体を手当から引きます。</li>
    <li>引いたあとに手当が残れば、その差額を受け取れます（10円単位）。年金を受け始めたら、手当の申請・届け出が必要です。</li>
  </ul>
  <p class="mini-note">子自身が遺族年金などを受けている場合、受給から5年たったときなどの2分の1の支給停止、災害による特例は、この計算機には入っていません。</p>

  <h2 id="shikyu">支給月</h2>
  <p>${esc(D.shikyu)}が振り込まれます（支払日は市区町村によって違い、土日祝日は前の営業日）。2026年4月分からの新しい額は、5月の支払いから入っています。</p>
`

const html = toolPage({
  rel: REL,
  title: `児童扶養手当の計算｜所得制限と月額（${R8.label.split('（')[0]}）・年金との差額・同居の親｜フクシル`,
  desc: `児童扶養手当（母子手当）の月額を、所得・扶養親族の数・養育費・年金・同居の親の所得から計算します。令和8年度は子1人で全部支給${yen(R8.zen)}、一部支給は所得に応じて11,340円まで。所得制限限度額の表、一部支給の式、障害年金・遺族年金との差額の決まりつき。`,
  ogTitle: '児童扶養手当の計算（令和8年度・所得制限と月額）',
  published: '2026-10-20',
  crumb: '児童扶養手当の計算',
  h1: '児童扶養手当の計算（令和8年度）',
  h1sub: '所得制限と月額・年金との差額・同居の親の所得',
  updatedNote: '令和8年度の額（2026年4月分から）と2024年11月からの所得制限で計算',
  body,
  faq: FAQ,
  related: '住民税が非課税になる年収は<a href="{{UP}}articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で、生活保護の額は<a href="{{UP}}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>で確かめられます。障害のある子の手当は<a href="{{UP}}teate/shogai/">特別児童扶養手当・障害児福祉手当・特別障害者手当</a>へ。',
  sources: D.sources,
  disclaimer: 'このページの計算は、児童扶養手当法・同施行令（e-Gov 法令検索）と、こども家庭庁・日本年金機構・市区町村の公表している資料と計算例にもとづく<strong>目安</strong>です。実際の支給の可否と額は、お住まいの市区町村が、課税台帳の所得・扶養親族の数・世帯の状況から認定します。申請と所得の届け出は市区町村の窓口で行ってください。こども家庭庁の資料は、公共データ利用規約（第1.0版）にもとづき加工して作成しています。',
  js: JS,
})
if (!html.includes('function jifuteCalc') || !html.includes('id="j-out"')) die('面の組み立てに失敗しました')
writeTool(REL, html, { dry: DRY })
