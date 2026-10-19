// ─────────────────────────────────────────────────────────────────────────────
// teate-shogai-page.mjs — 特別児童扶養手当・障害児福祉手当・特別障害者手当（3手当）の月額と所得制限の看板と判定の欄 /teate/shogai/ を作る。
//   node scripts/teate-shogai-page.mjs        → teate/shogai/index.html と sitemap.xml の1行
//   node scripts/teate-shogai-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-20 ユーザー「のこった案をすべてフクシルに増床してくれ」・裁定 4「（支給・停止の判定を）だしてよい」）
//   第190〜192回で残った看板。Bing 90日＝特別児童扶養手当 4,406（所得制限 657・診断書 345）・特別障害者手当 3,860（認定基準 494）・
//   障害児福祉手当 1,069。フクシルにはこの3つが title に入った面が無かった。3手当を1制度1面に割らず1枚で受ける。
// ★数字はここに書かない。data/teate-shogai.json（法・施行令の現行版と厚労省のページから写したもの）だけを読む。
// ★式は CORE の1か所（収入→所得は shotoku-core.mjs）。数字入りの公式の判定の計算例は見つからなかった（80件ほどの公式ページを見た）ので、
//   限度額の表（扶養0〜5人）・限度額ちょうどの扱い（以上／超える）・厚労省の「収入額の目安」との突き合わせで確かめ、
//   面には「公式の計算例と1円までは照らせていない」と書く（2026-10-20 ユーザー裁定 2）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'
import { SHOTOKU_CORE } from './shotoku-core.mjs'

const DRY = process.argv.includes('--dry')
const REL = 'teate/shogai/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'teate-shogai.json'), 'utf8'))

// ── 計算の式（ここだけ）─────────────────────────────────────────────────────
// teate＝tokuji（特別児童扶養手当）・jifuku（障害児福祉手当）・tokusho（特別障害者手当）
// 本人 p：kyuyo・nenkinShunyu・age65・sonota・fuyou・rojin・tokutei・shogai・tokubetsu（控除の対象の障害者の人数）・kafu・hitorioya・kinro・jitsugaku・shaho（2手当の本人だけ使う社会保険料の実額）・shotokuGaku（確かめ用）
// 配偶者・扶養義務者 o：sotoku（総所得金額等）・kyuyoNenkin・fuyou・rojin・gaku（確かめ用）
const CORE = `${SHOTOKU_CORE}
function teateCalc(D, teate, p, others) {
  var L = D.limit, K = D.kojo, nit = teate !== 'tokuji', sho;
  if (p.shotokuGaku != null) sho = p.shotokuGaku;
  else {
    var ky = kyuyoShotoku(p.kyuyo || 0), so = p.sonota || 0, nk = nenkinShotoku(p.nenkinShunyu || 0, ky + so, !!p.age65), gn = ky + nk;
    var base = (gn > 0 ? Math.max(0, gn - K.kyuyoNenkin) : 0) + so;
    var kj = K.shogai * Math.max(0, (p.shogai || 0) - (p.tokubetsu || 0)) + K.tokubetsu * (p.tokubetsu || 0) + (p.kafu ? K.kafu : 0) + (p.hitorioya ? K.hitorioya : 0) + (p.kinro ? K.kinro : 0) + (p.jitsugaku || 0);
    kj += nit ? (p.shaho || 0) : K.shaho;
    sho = Math.max(0, base - kj);
  }
  var add = L.per * (p.fuyou || 0) + L.rojin * (p.rojin || 0) + L.tokutei * (p.tokutei || 0);
  var lim = (nit ? L.nitHonnin : L.tokujiHonnin) + add;
  var over = nit ? sho > lim : sho >= lim;
  var res = { teate: teate, sho: sho, lim: lim, over: over, rule: nit ? 'koeru' : 'ijo', others: [], stop: over ? 'honnin' : '' };
  (others || []).forEach(function (o) {
    var g = o.gaku != null ? o.gaku : Math.max(0, (o.sotoku || 0) - (o.kyuyoNenkin ? K.kyuyoNenkin : 0) - K.shaho);
    var f = o.fuyou || 0, r = Math.min(o.rojin || 0, f);
    var ol = f === 0 ? L.other0 : L.otherBase + L.otherPer * f + L.otherRojin * r - (r === f && r > 0 ? L.otherRojin : 0);
    var ov = g >= ol; res.others.push({ role: o.role || '', gaku: g, lim: ol, over: ov });
    if (ov && !res.stop) res.stop = o.role || 'other';
  });
  return res;
}`
const teateCalc = new Function(`${CORE}\nreturn teateCalc`)()

// ── 確かめ（限度額の表・ちょうどの扱い・厚労省の収入額の目安）────────────────────────
const G = D.gaku.R8, L = D.limit
if (G.tokuji1 !== 58450 || G.tokuji2 !== 38930 || G.jifuku !== 16560 || G.tokusho !== 30450) die('令和8年度の月額が施行令（58,450・38,930・16,560・30,450円）と違います')
const TBL = { tokuji: [4596000, 4976000, 5356000, 5736000, 6116000, 6496000], nit: [3758000, 4138000, 4518000, 4898000, 5278000, 5658000], other: [6287000, 6536000, 6749000, 6962000, 7175000, 7388000] }
for (let f = 0; f <= 5; f++) {
  if (teateCalc(D, 'tokuji', { shotokuGaku: 0, fuyou: f }).lim !== TBL.tokuji[f]) die(`特別児童扶養手当の本人の限度額（扶養${f}人）が厚労省の表と違います`)
  if (teateCalc(D, 'tokusho', { shotokuGaku: 0, fuyou: f }).lim !== TBL.nit[f]) die(`2手当の本人の限度額（扶養${f}人）が厚労省の表と違います`)
  if (teateCalc(D, 'tokuji', { shotokuGaku: 0 }, [{ gaku: 0, fuyou: f }]).others[0].lim !== TBL.other[f]) die(`配偶者・扶養義務者の限度額（扶養${f}人）が厚労省の表と違います`)
}
// 限度額ちょうど：特別児童扶養手当の本人は停止（以上）・2手当の本人は支給（超える）・配偶者等は停止（以上）
if (!teateCalc(D, 'tokuji', { shotokuGaku: L.tokujiHonnin }).over) die('特別児童扶養手当の本人の限度額ちょうどが停止になっていません')
if (teateCalc(D, 'tokusho', { shotokuGaku: L.nitHonnin }).over || !teateCalc(D, 'tokusho', { shotokuGaku: L.nitHonnin + 1 }).over) die('2手当の本人の限度額ちょうど（支給）・1円超え（停止）が違います')
if (!teateCalc(D, 'jifuku', { shotokuGaku: 0 }, [{ gaku: L.other0 }]).others[0].over) die('配偶者・扶養義務者の限度額ちょうどが停止になっていません')
// 老人扶養だけの扶養義務者は1人を除いて6万円（施行令第2条第2項第2号ロ）
if (teateCalc(D, 'tokuji', { shotokuGaku: 0 }, [{ gaku: 0, fuyou: 1, rojin: 1 }]).others[0].lim !== 6536000 || teateCalc(D, 'tokuji', { shotokuGaku: 0 }, [{ gaku: 0, fuyou: 2, rojin: 1 }]).others[0].lim !== 6809000) die('扶養義務者の老人扶養親族の加算（6万円・老人だけのときは1人を除く）が違います')
// 厚労省の「収入額の目安」（給与所得者の例・8万円を引かずに作られている）を式に通すと、限度額のすぐ下に来るか
const ky = (r) => new Function(`${SHOTOKU_CORE}\nreturn kyuyoShotoku`)()(r)
const m = D.mokuyasu
if (ky(m.tokujiHonnin0) - 100000 !== L.tokujiHonnin) die('特別児童扶養手当の本人の収入額の目安（642万円）が式と合いません')
if (ky(m.nitHonnin0) - 100000 > L.nitHonnin || ky(m.nitHonnin0) - 100000 < L.nitHonnin - 1000) die('2手当の本人の収入額の目安（537.2万円）が式と合いません')
if (Math.abs(ky(m.other0) - 100000 - L.other0) > 1000) die('配偶者・扶養義務者の収入額の目安（831.9万円）が式と合いません')
{ const r = teateCalc(D, 'tokuji', { kyuyo: 7000000, fuyou: 2, shogai: 1, tokubetsu: 1 }); if (r.sho !== 4620000) die(`障害者控除（特別障害者1人＝40万円）の引き方が違います：${r.sho}`) }
console.log('確かめ：限度額の表（3種類×扶養0〜5人）・限度額ちょうどの扱い・老人扶養の加算・厚労省の収入額の目安3つと式が一致（公式の判定の計算例は見つかっていない）')

// ── 面 ─────────────────────────────────────────────────────────────────────
const tableHtml = (id, rows) => `<tbody id="${id}">\n${rows.map((v, f) => `<tr data-f="${f}"><th>${f}人</th><td class="num">${num(v)}円</td></tr>`).join('\n')}\n    </tbody>`
const JS = `${CORE}
(function(){var D=${JSON.stringify({ limit: D.limit, kojo: D.kojo, gaku: { R8: D.gaku.R8 } })};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function m(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');var x=parseFloat(s);return isFinite(x)&&x>0?Math.round(x*10000):0}
function c(i){var x=parseInt(($(i).value||'0'),10);return isFinite(x)&&x>0?x:0}
var NM={tokuji:'特別児童扶養手当',jifuku:'障害児福祉手当',tokusho:'特別障害者手当'};
var WHO={tokuji:'あなた（障害のある子を育てている父母など）',jifuku:'障害のある子本人',tokusho:'障害のある本人（20歳以上）'};
function hit(tb,f){var rs=$(tb).getElementsByTagName?$(tb).getElementsByTagName('tr'):[];for(var i=0;i<rs.length;i++){var g=parseInt(rs[i].getAttribute('data-f'),10);rs[i].className=(g===Math.min(f,5))?'hit':''}}
function calc(){var t=$('t-kind').value,o=$('t-out'),nit=t!=='tokuji';
 $('t-who').textContent=WHO[t];$('t-tj').style.display=t==='tokuji'?'':'none';$('t-shaho-row').style.display=nit?'':'none';
 $('t-hg').style.display=t==='jifuku'?'none':'';$('t-ha-in').style.display=$('t-ha').value==='1'&&t!=='jifuku'?'':'none';$('t-gi-in').style.display=$('t-gi').value==='1'?'':'none';
 var p={kyuyo:m('t-kyuyo'),nenkinShunyu:m('t-nenkin'),age65:$('t-65').checked,sonota:m('t-sonota'),fuyou:c('t-fuyou'),rojin:c('t-rojin'),tokutei:c('t-tokutei'),shogai:c('t-shogai'),tokubetsu:c('t-toku'),kafu:$('t-kafu').checked,hitorioya:$('t-hitori').checked,kinro:$('t-kinro').checked,jitsugaku:m('t-jitsu'),shaho:m('t-shaho')};
 var os=[];if($('t-ha').value==='1'&&t!=='jifuku')os.push({role:'haigusha',sotoku:m('t-has'),kyuyoNenkin:$('t-hak').checked,fuyou:c('t-haf'),rojin:c('t-har')});
 if($('t-gi').value==='1')os.push({role:'gimu',sotoku:m('t-gis'),kyuyoNenkin:$('t-gik').checked,fuyou:c('t-gif'),rojin:c('t-gir')});
 var r=teateCalc(D,t,p,os),G=D.gaku.R8,amt=t==='tokuji'?G.tokuji1*c('t-k1')+G.tokuji2*c('t-k2'):t==='jifuku'?G.jifuku:G.tokusho;
 var h='<p class="total">'+NM[t]+'：'+(r.stop?'所得で支給停止の目安':'支給の目安'+(amt?'　月 '+yen(amt):''))+'</p><ul class="bd">';
 h+='<li>'+WHO[t]+'の所得額 '+yen(r.sho)+'（限度額 '+yen(r.lim)+(r.rule==='koeru'?'を超えると停止':'以上で停止')+'）'+(r.over?'＝<strong>'+(r.rule==='koeru'?'限度額を超えています':'限度額以上です')+'</strong>':'')+'</li>';
 r.others.forEach(function(x){h+='<li>'+(x.role==='haigusha'?'配偶者':'扶養義務者')+'の所得額 '+yen(x.gaku)+'（限度額 '+yen(x.lim)+'以上で停止）'+(x.over?'＝<strong>限度額以上です</strong>':'')+'</li>'});
 h+='</ul><p class="bd">所得の判定は人ごとで、1人でも限度額にかかると、その年の8月分から翌年7月分まで支給が止まります。障害の程度の認定（診断書）と申請は市区町村の窓口で行います。</p>';
 o.innerHTML=h;hit(t==='tokuji'?'tb-tj':'tb-nit',c('t-fuyou'));hit('tb-oth',os.length?os[os.length-1].fuyou:-1);
 $('tbw-tj').style.display=t==='tokuji'?'':'none';$('tbw-nit').style.display=nit?'':'none'}
['t-kind','t-k1','t-k2','t-kyuyo','t-nenkin','t-65','t-sonota','t-fuyou','t-rojin','t-tokutei','t-shogai','t-toku','t-kafu','t-hitori','t-kinro','t-jitsu','t-shaho','t-ha','t-has','t-hak','t-haf','t-har','t-gi','t-gis','t-gik','t-gif','t-gir'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const opt = (n, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => `<option>${i + from}</option>`).join('')
const R7 = D.gaku.R7
const sdRows = D.shindansho.tokuji.map((nm, i) => `<tr><th>${esc(nm)}</th><td>第${i + 1}号</td><td>${esc(D.shindansho.nit[i])}</td><td>第${i + 1}号</td><td>第${i + 9}号</td></tr>`).join('\n')
const FAQ = [
  ['特別児童扶養手当はいくらですか？（2026年度）', `2026年4月分から、障害児1人につき1級${yen(G.tokuji1)}・2級${yen(G.tokuji2)}（月額）です（2025年度は${yen(R7.tokuji1)}・${yen(R7.tokuji2)}）。支給は${D.shikyu.tokuji}です。`],
  ['特別児童扶養手当の所得制限はいくらですか？', `受給者本人の所得額が、扶養親族等0人で${num(L.tokujiHonnin)}円以上（1人ふえるごとに38万円を足す）だと、その年の8月分〜翌年7月分は支給されません。配偶者・同居の扶養義務者は0人で${num(L.other0)}円以上で停止です。所得額は、給与所得などから10万円（給与・年金がある人）と一律8万円、障害者控除などを引いた額です。給与収入の目安では、本人・扶養0人で約${num(D.mokuyasu.tokujiHonnin0 / 10000)}万円です。`],
  ['特別障害者手当・障害児福祉手当の所得制限はいくらですか？', `受給資格者本人の所得額が、扶養親族等0人で${num(L.nitHonnin)}円を超えると支給停止です（2026年8月分から。7月分までは${num(L.nitHonninPrev)}円）。配偶者・生計を維持する扶養義務者は0人で${num(L.other0)}円以上で停止です。本人の所得には8万円の控除がなく、社会保険料の実額を引きます。特別障害者手当の本人の所得には、非課税の障害年金なども入れます。`],
  ['特別障害者手当はいくらですか？障害年金と一緒にもらえますか？', `2026年4月分から月${yen(G.tokusho)}です。20歳以上で、日常生活に常時特別の介護を必要とする在宅の人が対象で、障害年金と一緒に受けられます。施設に入所しているときや、病院に3か月を超えて入院しているときは支給されません。`],
  ['障害児福祉手当はいくらですか？', `2026年4月分から月${yen(G.jifuku)}です。20歳未満で、日常生活に常時の介護を必要とする在宅の重度の障害のある子が対象です。障害を理由とする年金を受けられるときや、障害児入所施設などに入所しているときは支給されません。20歳になると資格がなくなり、特別障害者手当は新しく申請します。`],
  ['診断書は手帳があれば省略できますか？', '国の通知では、身体障害者手帳の等級で障害の程度が明らかに当てはまる場合や、判定書で程度が確認できる場合は、認定診断書を省略できることがあります（療育手帳Aは特別児童扶養手当1級として扱える場合あり）。どこまで省略できるかは都道府県・市区町村で運用が違うので、窓口で確かめてください。'],
]

const body = `  <p class="lead">障害のある子や家族を支える3つの手当、<strong>特別児童扶養手当</strong>・<strong>障害児福祉手当</strong>・<strong>特別障害者手当</strong>の月額と所得制限を1枚にまとめました。額は全国一律で、支給されるかは<strong>障害の程度の認定</strong>と<strong>所得</strong>で決まります。所得と扶養親族の数を入れると、支給か停止かの目安が分かり、下の所得制限の表の当てはまる行が光ります。</p>

  <div class="callout point">
    <p><span class="tag">月額（2026年4月分から）</span><br>特別児童扶養手当：1級 <strong>${yen(G.tokuji1)}</strong>・2級 <strong>${yen(G.tokuji2)}</strong>（障害児1人につき・20歳未満の子を育てる父母など）<br>障害児福祉手当：<strong>${yen(G.jifuku)}</strong>（20歳未満の重度の障害のある子本人）<br>特別障害者手当：<strong>${yen(G.tokusho)}</strong>（20歳以上の常時特別の介護が必要な人本人）</p>
  </div>

  <div class="table-wrap"><table class="fit">
    <caption>3手当の月額（円）</caption>
    <thead><tr><th>手当</th><th class="num">2025年度</th><th class="num">2026年度</th><th>受け取る人</th><th>支給月</th></tr></thead>
    <tbody>
      <tr><th>特別児童扶養手当 1級</th><td class="num">${num(R7.tokuji1)}</td><td class="num">${num(G.tokuji1)}</td><td>父母など（障害児を監護）</td><td>4・8・12月</td></tr>
      <tr><th>特別児童扶養手当 2級</th><td class="num">${num(R7.tokuji2)}</td><td class="num">${num(G.tokuji2)}</td><td>同上</td><td>4・8・12月</td></tr>
      <tr><th>障害児福祉手当</th><td class="num">${num(R7.jifuku)}</td><td class="num">${num(G.jifuku)}</td><td>障害のある子本人</td><td>2・5・8・11月</td></tr>
      <tr><th>特別障害者手当</th><td class="num">${num(R7.tokusho)}</td><td class="num">${num(G.tokusho)}</td><td>障害のある本人（20歳以上）</td><td>2・5・8・11月</td></tr>
    </tbody>
  </table></div>

  <h2 id="hantei">所得制限の判定（2026年8月分〜2027年7月分＝2025年の所得）</h2>
  <div class="calc">
    <div class="row"><label for="t-kind">手当</label><select id="t-kind"><option value="tokuji">特別児童扶養手当</option><option value="jifuku">障害児福祉手当</option><option value="tokusho">特別障害者手当</option></select></div>
    <div id="t-tj">
      <div class="row"><label for="t-k1">1級に当たる子の数</label><select id="t-k1">${opt(4)}</select></div>
      <div class="row"><label for="t-k2">2級に当たる子の数</label><select id="t-k2">${opt(4)}</select></div>
    </div>
    <p class="mini-note"><strong id="t-who"></strong>の2025年（1〜12月）の収入を<strong>万円</strong>で入れてください。</p>
    <div class="row"><label for="t-kyuyo">給与の収入（万円）</label><input id="t-kyuyo" type="text" inputmode="decimal" placeholder="例 450"></div>
    <div class="row"><label for="t-nenkin">公的年金の収入（万円・特別障害者手当は非課税の障害年金も）</label><input id="t-nenkin" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label><input id="t-65" type="checkbox"> 65歳以上</label></div>
    <div class="row"><label for="t-sonota">それ以外の所得（事業・不動産などの所得・万円）</label><input id="t-sonota" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row"><label for="t-fuyou">税法上の扶養親族等の数</label><select id="t-fuyou">${opt(6)}</select></div>
    <div class="row"><label for="t-rojin">そのうち70歳以上の人</label><select id="t-rojin">${opt(4)}</select></div>
    <div class="row"><label for="t-tokutei">そのうち16〜22歳の人</label><select id="t-tokutei">${opt(5)}</select></div>
    <div class="row"><label for="t-shogai">障害者控除の対象の家族（特別児童扶養手当は障害のある子も）</label><select id="t-shogai">${opt(4)}</select></div>
    <div class="row"><label for="t-toku">そのうち特別障害者に当たる人</label><select id="t-toku">${opt(4)}</select></div>
    <div class="row"><label><input id="t-kafu" type="checkbox"> 寡婦控除</label> <label><input id="t-hitori" type="checkbox"> ひとり親控除</label> <label><input id="t-kinro" type="checkbox"> 勤労学生控除</label></div>
    <div class="row"><label for="t-jitsu">医療費控除・小規模企業共済等掛金控除・配偶者特別控除など（実額・万円）</label><input id="t-jitsu" type="text" inputmode="decimal" placeholder="なければ空欄"></div>
    <div class="row" id="t-shaho-row"><label for="t-shaho">社会保険料控除の額（万円・障害児福祉手当と特別障害者手当の本人だけ）</label><input id="t-shaho" type="text" inputmode="decimal" placeholder="例 60"></div>
    <div id="t-hg"><div class="row"><label for="t-ha">配偶者</label><select id="t-ha"><option value="0">いない・所得なし</option><option value="1">いる</option></select></div>
      <div id="t-ha-in" style="display:none">
        <div class="row"><label for="t-has">配偶者の総所得金額等（課税証明書の所得・万円）</label><input id="t-has" type="text" inputmode="decimal" placeholder="例 300"></div>
        <div class="row"><label><input id="t-hak" type="checkbox"> 給与か年金の所得を含む</label></div>
        <div class="row"><label for="t-haf">配偶者の扶養親族の数</label><select id="t-haf">${opt(6)}</select></div>
        <div class="row"><label for="t-har">そのうち70歳以上</label><select id="t-har">${opt(4)}</select></div>
      </div></div>
    <div class="row"><label for="t-gi">同居の扶養義務者（父母・祖父母・兄弟姉妹など。障害児福祉手当は生計を維持する父母）</label><select id="t-gi"><option value="0">いない</option><option value="1">いる</option></select></div>
    <div id="t-gi-in" style="display:none">
      <div class="row"><label for="t-gis">その人の総所得金額等（万円）</label><input id="t-gis" type="text" inputmode="decimal" placeholder="例 500"></div>
      <div class="row"><label><input id="t-gik" type="checkbox"> 給与か年金の所得を含む</label></div>
      <div class="row"><label for="t-gif">その人の扶養親族の数</label><select id="t-gif">${opt(6)}</select></div>
      <div class="row"><label for="t-gir">そのうち70歳以上</label><select id="t-gir">${opt(4)}</select></div>
    </div>
    <div class="out" id="t-out" aria-live="polite"></div>
  </div>
  <p class="mini-note"><strong>公式の計算例と1円までは照らせていません。</strong>年収と扶養人数を入れて支給・停止まで示した自治体の計算例が見つからなかったためです（式と限度額は法令どおりで、厚生労働省の限度額の表と「収入額の目安」には合うことを確かめています）。配偶者・扶養義務者の所得は、8万円と給与・年金の10万円だけを引いた目安で、医療費控除などは引いていません。</p>

  <h2 id="seigen">所得制限限度額（所得額）</h2>
  <div class="table-wrap" id="tbw-tj"><table class="fit">
    <caption>特別児童扶養手当の受給者本人（この額<strong>以上</strong>で停止・2021年8月分から）</caption>
    <thead><tr><th>扶養親族等</th><th class="num">所得額</th></tr></thead>
    ${tableHtml('tb-tj', TBL.tokuji)}
  </table></div>
  <div class="table-wrap" id="tbw-nit" style="display:none"><table class="fit">
    <caption>障害児福祉手当・特別障害者手当の本人（この額を<strong>超える</strong>と停止・2026年8月分から）</caption>
    <thead><tr><th>扶養親族等</th><th class="num">所得額</th></tr></thead>
    ${tableHtml('tb-nit', TBL.nit)}
  </table></div>
  <div class="table-wrap"><table class="fit">
    <caption>配偶者・扶養義務者（3手当とも・この額<strong>以上</strong>で停止）</caption>
    <thead><tr><th>扶養親族等</th><th class="num">所得額</th></tr></thead>
    ${tableHtml('tb-oth', TBL.other)}
  </table></div>
  <p class="mini-note">6人以上は、本人は1人につき38万円、配偶者・扶養義務者は1人につき21万3千円を足します。本人の限度額には、70歳以上の同一生計配偶者・老人扶養親族1人につき10万円、16〜22歳の扶養親族1人につき25万円をさらに足します。配偶者・扶養義務者は、老人扶養親族1人につき6万円を足します（老人扶養親族だけのときは1人を除く）。障害児福祉手当・特別障害者手当の本人の限度額は、2025年7月分まで${num(3604000)}円、2025年8月分〜2026年7月分は${num(L.nitHonninPrev)}円（扶養0人）でした。</p>

  <h2 id="shotoku">所得額の出し方</h2>
  <ul>
    <li><strong>特別児童扶養手当（本人・配偶者・扶養義務者）と、2手当の配偶者・扶養義務者</strong>：総所得金額等（給与所得・公的年金等の所得がある人はその合計から10万円を引く）−<strong>8万円</strong>−障害者控除（1人27万円・特別障害者40万円）・寡婦控除27万円・ひとり親控除35万円・勤労学生控除27万円・医療費控除などの実額。</li>
    <li><strong>障害児福祉手当・特別障害者手当の本人</strong>：8万円は引かず、<strong>社会保険料控除の実額</strong>を引きます。本人自身の障害者控除は引きません（同じ世帯の家族の分は引く）。特別障害者手当の本人は、<strong>非課税の障害年金・遺族年金なども所得に入れます</strong>。</li>
    <li>前の年の所得で、その年の8月分から翌年7月分の支給を決めます（1〜6月に新しく申請する人は前々年の所得）。</li>
  </ul>

  <h2 id="joken">支給されないとき・20歳の切り替え</h2>
  <ul>
    <li><strong>特別児童扶養手当</strong>：子が障害を理由とする年金を受けられるとき、子が児童福祉施設など（通所を除く）に入所しているときは支給されません。</li>
    <li><strong>障害児福祉手当</strong>：障害を理由とする年金を受けられるとき、障害児入所施設などに入所しているときは支給されません。<strong>20歳になると資格がなくなります</strong>。</li>
    <li><strong>特別障害者手当</strong>：20歳以上が対象で、障害年金と一緒に受けられます。障害者支援施設などに入所しているとき、病院・診療所（介護老人保健施設などを含む）に<strong>3か月を超えて入院</strong>しているときは支給されません。20歳からは新しく認定の請求が要ります。</li>
  </ul>

  <h2 id="shindan">認定診断書の様式</h2>
  <div class="table-wrap"><table class="fit">
    <thead><tr><th>特別児童扶養手当</th><th>様式</th><th>障害児福祉手当・特別障害者手当</th><th>障害児<br>福祉手当</th><th>特別障害<br>者手当</th></tr></thead>
    <tbody>
${sdRows}
    </tbody>
  </table></div>
  <p class="mini-note">診断書は、申請日（再認定は提出期限）からおおむね2か月以内に作ったものが望ましいとされています。身体障害者手帳の等級で程度が明らかに当てはまるときなどは、診断書を省略できることがあります（運用は都道府県・市区町村で違います）。程度が変わる可能性のある障害は、期間を定めて再認定（診断書の再提出）があります。</p>
`

const html = toolPage({
  rel: REL,
  title: '特別児童扶養手当・障害児福祉手当・特別障害者手当の月額と所得制限（2026年度）｜支給・停止の判定｜フクシル',
  desc: `障害のある子や家族の3つの手当の月額と所得制限を1枚に。2026年4月分から特別児童扶養手当1級${yen(G.tokuji1)}・2級${yen(G.tokuji2)}、障害児福祉手当${yen(G.jifuku)}、特別障害者手当${yen(G.tokusho)}。所得と扶養親族の数を入れると支給か停止かの目安が分かり、所得制限限度額の表の当てはまる行が光ります。診断書の様式と20歳の切り替えも。`,
  ogTitle: '特別児童扶養手当・障害児福祉手当・特別障害者手当（2026年度の月額と所得制限）',
  published: '2026-10-20',
  crumb: '障害のある子・家族の3つの手当',
  h1: '特別児童扶養手当・障害児福祉手当・特別障害者手当',
  h1sub: '月額と所得制限（2026年度）・支給か停止かの判定',
  updatedNote: '2026年4月分からの月額と、2026年8月分からの所得制限で計算',
  body,
  faq: FAQ,
  related: '障害者控除の認定書は<a href="{{UP}}shogai-kojo/">障害者控除対象者認定書（全国418自治体の基準）</a>、ひとり親の手当は<a href="{{UP}}teate/jido-fuyo/">児童扶養手当の計算</a>、医療費の自己負担は<a href="{{UP}}jiritsu/">自立支援医療</a>へ。',
  sources: D.sources,
  disclaimer: 'このページは、特別児童扶養手当等の支給に関する法律・同施行令（e-Gov 法令検索）と厚生労働省のページにもとづく<strong>目安</strong>です。支給されるかは、障害の程度の認定（診断書）と、市区町村が確かめる所得・扶養親族の数で決まります。申請は市区町村の窓口で行ってください。厚生労働省のページの内容は、公共データ利用規約（第1.0版）にもとづき加工して作成しています。',
  js: JS,
  css: '',
})
if (!html.includes('function teateCalc') || !html.includes('id="t-out"')) die('面の組み立てに失敗しました')
writeTool(REL, html, { dry: DRY })
