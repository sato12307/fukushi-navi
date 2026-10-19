// ─────────────────────────────────────────────────────────────────────────────
// sashiosae-page.mjs — 差し押さえで手元に残る額の計算機（給料・借金の強制執行と税金・保険料の滞納処分）の面 /sashiosae/ を作る。
//   node scripts/sashiosae-page.mjs        → sashiosae/index.html と sitemap.xml の1行
//   node scripts/sashiosae-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-20 ユーザー裁定 1「あつかう」＝第189回の判断待ち「差し押さえ・滞納の面をフクシルで扱うか」）
//   Bing 90日＝差し押さえ 1,505（第189回の下見）。給料・年金・口座を差し押さえられた人が「手元にいくら残るか」を数字で返す。
//   法律相談にしない＝条文と公式の計算例どおりの一般の計算だけを出し、個別の事情は法テラス・財務局・税務署や市区町村の窓口へ案内する。
//   AdSense の貸金・債務整理の広告を止めるかは、ユーザーが AdSense の管理画面で決める（このページでは何もしない）。
// ★数字はここに書かない。data/sashiosae.json（法令と国税庁の通達から写したもの）だけを読む。
//   税の差押禁止額は 2026-04-01 から本人10万7千円・親族1人4万8千円（10万円・4.5万円は前の額）。
// ★計算の式は CORE の1か所だけ。公式の計算例（東京地裁民事第21部の別紙4件・豊田市・常総市）に通して円まで合わなければ止める。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, esc, num, yen, die, toolPage, writeTool } from './tool-page.mjs'

const DRY = process.argv.includes('--dry')
const REL = 'sashiosae/'
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sashiosae.json'), 'utf8'))

// ── 計算の式（ここだけ）─────────────────────────────────────────────────────
// kind＝ippan（借金など）・yoiku（養育費・婚姻費用など）・zei（税金・保険料の滞納処分）。term＝month・half・jun・day（民事だけ）
// 入力はすべて円。g＝総支給（通勤手当を含む）、tsukin＝通勤手当、shotoku＝所得税、jumin＝給与から引かれる住民税、shaho＝社会保険料、kazoku＝生計を一にする親族の数
const CORE = `function sashiCalc(D, kind, term, x) {
  var fl = Math.floor, g = x.g || 0, tsukin = Math.min(x.tsukin || 0, g), zeiho = (x.shotoku || 0) + (x.jumin || 0) + (x.shaho || 0);
  if (kind === 'zei') {
    var u = D.zei.unit, cut = function (v) { return fl(v / u) * u; }, up = function (v) { return Math.ceil(v / u) * u; };
    var G = cut(g), k1 = up(x.shotoku || 0), k2 = up(x.jumin || 0), k3 = up(x.shaho || 0), k4 = D.zei.base + D.zei.add * (x.kazoku || 0);
    var k5 = Math.min(up(Math.max(0, G - k1 - k2 - k3 - k4) * D.zei.rate5 / 100), k4 * 2);
    var kinshi = k1 + k2 + k3 + k4 + k5, kanou = Math.max(0, G - kinshi);
    return { kind: kind, G: G, k: [k1, k2, k3, k4, k5], kinshi: kinshi, kanou: kanou, tedori: g - zeiho, nokoru: Math.max(0, g - zeiho - kanou) };
  }
  var T = Math.max(0, g - tsukin - zeiho), L = D.minji.L[term] || D.minji.L.month, r = D.minji.keep[kind] || D.minji.keep.ippan;
  var kanou = T * r[0] / r[1] <= L ? fl(T * (r[1] - r[0]) / r[1]) : T - L;
  return { kind: kind, T: T, L: L, kanou: kanou, keep: T - kanou, nokoru: T - kanou + tsukin, tedori: g - zeiho };
}`
const sashiCalc = new Function(`${CORE}\nreturn sashiCalc`)()

// ── 確かめ（公式の計算例と円まで）──────────────────────────────────────────────
if (D.zei.base !== 107000 || D.zei.add !== 48000) die('税の差押禁止額（施行令34条）が 2026-04-01 以降の 107,000円・48,000円 ではありません')
const MAN = 10000
const CASES = [
  // 東京地方裁判所民事第21部「まずお読みください（給料債権の差押え）」の別紙。通勤手当1万円・所得税・住民税・社会保険料は合計3万円
  { kind: 'yoiku', term: 'month', x: { g: 36 * MAN, tsukin: 1 * MAN, shotoku: 3 * MAN }, want: 16 * MAN, src: '東京地裁 別紙A（養育費等・36万円）' },
  { kind: 'yoiku', term: 'month', x: { g: 72 * MAN, tsukin: 1 * MAN, shotoku: 3 * MAN }, want: 35 * MAN, src: '東京地裁 別紙A（養育費等・72万円）' },
  { kind: 'ippan', term: 'month', x: { g: 36 * MAN, tsukin: 1 * MAN, shotoku: 3 * MAN }, want: 8 * MAN, src: '東京地裁 別紙B（一般債権・36万円）' },
  { kind: 'ippan', term: 'month', x: { g: 50 * MAN, tsukin: 1 * MAN, shotoku: 3 * MAN }, want: 13 * MAN, src: '東京地裁 別紙B（一般債権・50万円）' },
  // 豊田市「給与差押等に係る差押可能額の計算」（2026年4月15日更新）・常総市「給与等の差押金額計算書（記載例）」（令和8年4月支給分）
  { kind: 'zei', term: 'month', x: { g: 251234, shotoku: 4123, jumin: 14800, shaho: 45123, kazoku: 1 }, want: 24000, src: '豊田市の計算例' },
  { kind: 'zei', term: 'month', x: { g: 248000, shotoku: 5600, jumin: 7000, shaho: 37123, kazoku: 1 }, want: 33000, src: '常総市の記載例' },
]
for (const c of CASES) { const r = sashiCalc(D, c.kind, c.term, c.x); if (r.kanou !== c.want) die(`${c.src} が合いません：公式 ${c.want}／計算 ${r.kanou}`) }
// 常総市の計算書の別表（4号の額）と同じか
const k4 = [107000, 155000, 203000, 251000, 299000, 347000]
for (let n = 0; n <= 5; n++) if (D.zei.base + D.zei.add * n !== k4[n]) die(`家族${n}人の4号の額が常総市の別表（${k4[n]}）と違います`)
console.log(`確かめ：公式の計算例 ${CASES.length}件（民事4・税2）が円まで一致／税の4号の額は家族0〜5人で常総市の別表と一致`)

// ── 面 ─────────────────────────────────────────────────────────────────────
const JS = `${CORE}
(function(){var D=${JSON.stringify({ minji: D.minji, zei: D.zei })};
var $=function(i){return document.getElementById(i)};function yen(n){return n.toLocaleString('ja-JP')+'円'}
function v(i){var s=($(i).value||'').replace(/[,，円\\s]/g,'');var x=parseInt(s,10);return isFinite(x)&&x>0?x:0}
function calc(){var kind=$('s-kind').value,term=$('s-term').value,o=$('s-out'),zei=kind==='zei';
 $('s-term-row').style.display=zei?'none':'';$('s-kazoku-row').style.display=zei?'':'none';
 var x={g:v('s-g'),tsukin:v('s-tsukin'),shotoku:v('s-shotoku'),jumin:v('s-jumin'),shaho:v('s-shaho'),kazoku:v('s-kazoku')};
 if(!x.g){o.innerHTML='<p class="bd">給与明細の「総支給額」と、引かれている所得税・住民税・社会保険料を入れてください。</p>';return}
 var r=sashiCalc(D,kind,term,x),h;
 if(zei){h='<p class="total">差し押さえられる上限 '+yen(r.kanou)+'</p><p class="bd">税・保険料を引いたあとの手取り '+yen(r.tedori)+' のうち、少なくとも <strong>'+yen(r.nokoru)+'</strong> は手元に残ります（1か月分の給料の場合）。</p>'
  +'<ul class="bd"><li>給料の額（千円未満切捨て）'+yen(r.G)+'</li><li>差し押さえられない額 '+yen(r.kinshi)+'＝所得税 '+yen(r.k[0])+'＋住民税 '+yen(r.k[1])+'＋社会保険料 '+yen(r.k[2])+'（それぞれ千円未満切上げ）＋生活の分 '+yen(r.k[3])+'（'+D.zei.base.toLocaleString('ja-JP')+'円＋'+D.zei.add.toLocaleString('ja-JP')+'円×家族'+(x.kazoku||0)+'人）＋残りの20% '+yen(r.k[4])+'</li></ul>'
  +'<p class="bd">税金・国民健康保険料・介護保険料・後期高齢者医療保険料・国民年金保険料などの滞納処分の式です（国税徴収法76条・同施行令34条、2026年4月1日以降に支払われる給料）。通勤手当も給料に含めて計算します。</p>'}
 else{h='<p class="total">差し押さえられる上限 '+yen(r.kanou)+'</p><p class="bd">手取り（総支給−通勤手当−所得税・住民税・社会保険料）'+yen(r.T)+' のうち、<strong>'+yen(r.keep)+'</strong> は差し押さえられません'+(x.tsukin?'。通勤手当 '+yen(Math.min(x.tsukin,x.g))+' も差し押さえの対象外なので、受け取れるのは '+yen(r.nokoru)+' です':'')+'。</p>'
  +'<p class="bd">'+(kind==='yoiku'?'養育費・婚姻費用などの差し押さえは、手取りの2分の1まで（手取りの2分の1が政令の額 '+yen(r.L)+' を超えると、それを超える分も全部）':'借金などの差し押さえは、手取りの4分の1まで（手取りの4分の3が政令の額 '+yen(r.L)+' を超えると、それを超える分も全部）')+'です（民事執行法152条・同施行令2条）。実際に差し押さえられるのは、残っている借金などの額との小さいほうです。</p>'}
 o.innerHTML=h}
['s-kind','s-term','s-g','s-tsukin','s-shotoku','s-jumin','s-shaho','s-kazoku'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`

const L = D.minji.L, Z = D.zei
const kinshiRows = D.kinshi.map((k) => `<tr><th>${esc(k.name)}</th><td>${esc(k.law)}</td><td>${esc(k.zei)}</td></tr>`).join('\n')
const hRows = D.houterasu.income.map(([n, a, b], i) => `<tr><th>${n}人</th><td class="num">${num(a)}円</td><td class="num">${num(b)}円</td><td class="num">${num(D.houterasu.asset[i][1] / 10000)}万円</td></tr>`).join('\n')
const ex = (kind, x) => sashiCalc(D, kind, 'month', x)
const e1 = ex('ippan', { g: 250000, shotoku: 5000, jumin: 10000, shaho: 35000 }), e2 = ex('zei', { g: 250000, shotoku: 5000, jumin: 10000, shaho: 35000, kazoku: 0 })
const FAQ = [
  ['給料を差し押さえられたら、手元にいくら残りますか？', `借金などの差し押さえでは、手取り（総支給から通勤手当・所得税・住民税・社会保険料を引いた額）の4分の3が残ります。ただし手取りが月44万円を超えると、残るのは33万円で、それを超える分は全部差し押さえの対象です（民事執行法152条・同施行令2条）。たとえば総支給25万円・所得税5千円・住民税1万円・社会保険料3万5千円なら、手取り20万円のうち${yen(e1.keep)}が残ります。`],
  ['税金や国民健康保険料の滞納で給料を差し押さえられたら？', `税金・国民健康保険料・介護保険料などの滞納処分では、所得税・住民税・社会保険料に加えて、本人${num(Z.base)}円＋生計を一にする家族1人につき${num(Z.add)}円と、残りの20%が差し押さえられない額です（国税徴収法76条・同施行令34条。2026年4月1日以降の支給分）。上の例（家族なし）なら、差し押さえられる上限は${yen(e2.kanou)}です。`],
  ['養育費の差し押さえは、どこまで取られますか？', '養育費・婚姻費用などの差し押さえでは、手取りの2分の1まで差し押さえられます。手取りが月66万円を超えると、33万円を超える分は全部対象です（民事執行法152条3項）。'],
  ['年金や生活保護費は差し押さえられますか？', '生活保護費・児童手当・児童扶養手当・障害年金・遺族年金・失業手当などは、法律で差し押さえが禁止されています。老齢年金（国民年金・厚生年金）も借金などの差し押さえはできませんが、税金や保険料の滞納処分では給料と同じ式で差し押さえられます。'],
  ['口座を差し押さえられたら取り戻せますか？', `借金などの差し押さえ（民事）なら、裁判所に「差押禁止債権の範囲変更」を申し立てられます（民事執行法153条。申立手数料はかからず、郵便切手が東京地裁で${num(D.moushitate.stampTokyo)}円分など）。預金は送達から${D.moushitate.yokinWeeks}週間で取り立てられるので、早く申し立て、あわせて支払の一時禁止も求めます。税金・保険料の差し押さえなら、税務署や市区町村に、生活が成り立たないことを伝えて差押えの猶予・解除を相談します。`],
]

const body = `  <p class="lead">給料や口座を差し押さえられても、<strong>生活のための一定の額は、法律で差し押さえが禁止</strong>されています。その額は、<strong>借金などの差し押さえ（民事）</strong>と<strong>税金・保険料の滞納処分</strong>で、計算のしかたが違います。給与明細の数字を入れると、差し押さえられる上限と、手元に残る額が分かります。</p>

  <div class="callout point">
    <p><span class="tag">差し押さえられない額（給料・1か月）</span><br><strong>借金など</strong>：手取りの<strong>4分の3</strong>（手取りが44万円を超えると<strong>33万円</strong>）<br><strong>養育費・婚姻費用など</strong>：手取りの<strong>2分の1</strong>（手取りが66万円を超えると33万円）<br><strong>税金・国保料・介護保険料など</strong>：税・社会保険料＋<strong>${num(Z.base)}円</strong>＋家族1人<strong>${num(Z.add)}円</strong>＋残りの20%（2026年4月から。前は10万円・4万5千円）</p>
  </div>

  <h2 id="keisan">手元に残る額を計算する</h2>
  <div class="calc">
    <div class="row"><label for="s-kind">何の差し押さえか</label><select id="s-kind"><option value="ippan">借金・カードローン・未払いの代金など（裁判所の差押命令）</option><option value="yoiku">養育費・婚姻費用など（裁判所の差押命令）</option><option value="zei">税金・国民健康保険料・介護保険料・年金保険料などの滞納</option></select></div>
    <div class="row" id="s-term-row"><label for="s-term">給料の支払い</label><select id="s-term"><option value="month">毎月（賞与は1回ごと）</option><option value="half">毎半月</option><option value="jun">毎旬（10日ごと）</option><option value="day">毎日</option></select></div>
    <div class="row"><label for="s-g">総支給額（円・通勤手当を含む）</label><input id="s-g" type="text" inputmode="numeric" placeholder="例 250000"></div>
    <div class="row"><label for="s-tsukin">そのうち通勤手当（円）</label><input id="s-tsukin" type="text" inputmode="numeric" placeholder="なければ空欄"></div>
    <div class="row"><label for="s-shotoku">引かれている所得税（円）</label><input id="s-shotoku" type="text" inputmode="numeric" placeholder="例 5000"></div>
    <div class="row"><label for="s-jumin">引かれている住民税（円）</label><input id="s-jumin" type="text" inputmode="numeric" placeholder="例 10000（自分で納めているなら空欄）"></div>
    <div class="row"><label for="s-shaho">引かれている社会保険料（健康保険・厚生年金・雇用保険など・円）</label><input id="s-shaho" type="text" inputmode="numeric" placeholder="例 35000"></div>
    <div class="row" id="s-kazoku-row" style="display:none"><label for="s-kazoku">生計を一にする家族の数（あなたを除く）</label><input id="s-kazoku" type="text" inputmode="numeric" placeholder="例 1（いなければ 0）"></div>
    <div class="out" id="s-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">このページの計算は、法律と、裁判所・国税庁・市が出している計算例どおりの一般の計算です（裁判所の例4件と市の例2件で、1円まで合うことを確かめています）。あなたの事情でどうなるか（差し押さえを止められるか、分けて払えるか）は、下の<a href="#soudan">無料の相談窓口</a>で聞いてください。</p>

  <h2 id="minji">借金などの差し押さえ（民事）のしくみ</h2>
  <ul>
    <li>差し押さえの元になる<strong>手取り</strong>＝給料（基本給と諸手当。通勤手当は除く）−所得税−住民税−社会保険料。裁判所の差押債権目録の書式どおりです。</li>
    <li>差し押さえられるのは手取りの<strong>4分の1</strong>まで。ただし手取りの4分の3が政令の額（毎月${num(L.month)}円・毎半月${num(L.half)}円・毎旬${num(L.jun)}円・毎日${num(L.day)}円・賞与は1回${num(L.bonus)}円）を超えるときは、政令の額を超える分も全部です（民事執行法152条1項・同施行令2条）。</li>
    <li>養育費・婚姻費用・扶養料などは、4分の1でなく<strong>2分の1</strong>まで差し押さえられます（152条3項）。</li>
    <li>退職金は、所得税と住民税だけを引いた残りの4分の1（養育費などは2分の1）まで。上限の額はありません。</li>
    <li>給料などの差し押さえは、差押命令が届いてから<strong>${D.moushitate.kyuyoWeeks}週間</strong>は取り立てられません（養育費などが含まれるときは1週間）。この間に、下の範囲変更の申立てを準備できます（155条2項・2020年の改正）。</li>
  </ul>

  <h2 id="zei">税金・保険料の滞納による差し押さえのしくみ</h2>
  <ul>
    <li>差し押さえられない額＝①所得税②給与から引かれる住民税③社会保険料（どれも実際に引かれた額）④<strong>${num(Z.base)}円＋生計を一にする家族1人につき${num(Z.add)}円</strong>⑤（給料−①〜④）の20%（④の2倍まで）。残りが差し押さえられます（国税徴収法76条・同施行令34条）。</li>
    <li>④は<strong>2026年4月1日以降に支払われる給料から</strong>の額です（前は10万円・4万5千円）。</li>
    <li>計算では、給料は千円未満を切り捨て、①〜⑤は千円未満を切り上げます（国税徴収法基本通達第76条関係3）。<strong>税では通勤手当も給料に含めます</strong>。</li>
    <li>同じ月に給料と賞与が出たときは、合わせて1か月分として計算します（76条3項）。</li>
    <li>老齢年金（国民年金・厚生年金・企業年金など）も、給料と同じ式で差し押さえられます（77条）。障害年金・遺族年金は差し押さえられません。</li>
    <li>この式は、国の税だけでなく、<strong>住民税・固定資産税・国民健康保険税（料）・介護保険料・後期高齢者医療保険料・国民年金保険料</strong>の滞納にも使われます（地方税法331条6項・地方自治法231条の3第3項・国民年金法95条など）。</li>
  </ul>

  <h2 id="kinshi">差し押さえが禁止されているお金</h2>
  <div class="table-wrap"><table class="fit">
    <thead><tr><th>給付</th><th>法律</th><th>税・保険料の滞納では</th></tr></thead>
    <tbody>
${kinshiRows}
    </tbody>
  </table></div>
  <p class="mini-note">表は、受け取る権利（振り込まれる前）についての決まりです。口座に振り込まれたあとの預金は、原則として差し押さえ禁止の性質を引き継がないとされています（下の「口座を差し押さえられたら」）。</p>

  <h2 id="kouza">口座を差し押さえられたら</h2>
  <p><strong>借金などの差し押さえ（民事）</strong>なら、差押命令を出した地方裁判所に<strong>「差押禁止債権の範囲変更」</strong>を申し立てられます（民事執行法153条）。生活保護費や年金が振り込まれる口座が差し押さえられ、生活が成り立たないときなどに、裁判所が差し押さえを取り消すかを決めます。</p>
  <ul>
    <li>申立手数料はかかりません。郵便切手を予納します（東京地裁${num(D.moushitate.stampTokyo)}円分・大阪地裁${num(D.moushitate.stampOsaka)}円分など、裁判所で違います）。</li>
    <li>預金は差押命令が届いてから<strong>${D.moushitate.yokinWeeks}週間</strong>で取り立てられます。取り立てられたあとは申し立てられないので、急いで申し立て、あわせて銀行への支払の一時禁止も求めます。</li>
    <li>家計表・給与明細・通帳のコピー・住民票などを出します。申し立てても必ず認められるわけではなく、認められても借金そのものは減りません（東京地裁の案内）。</li>
  </ul>
  <p><strong>税金・保険料の差し押さえ</strong>には、この裁判所の申立ては使えません。差し押さえた税務署や市区町村に、生活が成り立たないことを伝えて相談します。法律には、生活の維持を困難にするおそれがある財産の<strong>差押えの猶予・解除</strong>（国税徴収法152条2項）、<strong>換価の猶予</strong>（151条の2・納期限から6か月以内の申請）、生活を著しく窮迫させるおそれがあるときの<strong>滞納処分の停止</strong>（153条）があります（地方税は地方税法15条の5〜15条の7）。国税庁の通達も、口座に振り込まれた給料の差押えで生活の維持を困難にするおそれがある額は、差押えを猶予・解除できるとしています。</p>
  <p class="mini-note">裁判の例：児童手当が振り込まれた9分後に、その口座を税の滞納で差し押さえた処分について、広島高等裁判所松江支部は2013年（平成25年）11月27日、児童手当の分（13万円）は実質的に児童手当を受ける権利を差し押さえたのと変わらず違法として、返還を命じました（国税庁 税務大学校論叢第101号の紹介による）。個別の事情で判断が分かれるので、まず相談窓口へ。</p>

  <h2 id="soudan">無料の相談窓口</h2>
  <ul>
    <li><strong>法テラス・サポートダイヤル</strong>：<strong>${esc(D.houterasu.tel)}</strong>（${esc(D.houterasu.hours)}。IP電話などからは ${esc(D.houterasu.telIp)}）。借金・自己破産・任意整理などの相談先を案内します。収入と資産が下の基準以下なら、弁護士・司法書士の<strong>無料法律相談</strong>（1回30分・同じ問題で3回まで）を受けられます。</li>
    <li><strong>財務局の多重債務相談窓口</strong>：借金の返済に困ったときの無料の相談先（金融庁の「多重債務についての相談窓口」から都道府県ごとの番号）。</li>
    <li><strong>税・保険料</strong>：国税は住所を管轄する税務署の徴収担当、住民税・国民健康保険料などは市区町村の納税課（収納課）へ。分けて払う相談や猶予の申請ができます。</li>
  </ul>
  <div class="table-wrap"><table class="fit">
    <caption>法テラスの無料法律相談の基準（手取りの平均月収〈賞与を含む〉と、現金・預貯金）</caption>
    <thead><tr><th>家族</th><th class="num">月収<br>（下記以外）</th><th class="num">月収<br>（東京23区・大阪市など）</th><th class="num">資産</th></tr></thead>
    <tbody>
${hRows}
    </tbody>
  </table></div>
  <p class="mini-note">家族が1人増えるごとに月収の基準は3万円（東京・大阪などは3万3千円）上がります。家賃や住宅ローン・医療費などを払っている場合は、基準を超えても対象になることがあります（法テラスの案内）。</p>
`

const html = toolPage({
  rel: REL,
  title: '差し押さえで手元に残る額の計算｜給料（借金の強制執行・税金や国保料の滞納）と口座・年金｜フクシル',
  desc: `給料を差し押さえられたとき手元に残る額を計算します。借金などは手取りの4分の3（上限33万円）、養育費は2分の1、税金・国民健康保険料などの滞納は所得税・住民税・社会保険料＋${num(Z.base)}円＋家族1人${num(Z.add)}円＋20%（2026年4月から）。差し押さえ禁止の年金・手当の一覧、口座を差し押さえられたときの申立てと猶予、無料の相談窓口。`,
  ogTitle: '差し押さえで手元に残る額の計算（給料・口座・年金）',
  published: '2026-10-20',
  crumb: '差し押さえで手元に残る額の計算',
  h1: '差し押さえで手元に残る額の計算',
  h1sub: '給料（借金の強制執行・税金や国保料の滞納）と口座・年金',
  updatedNote: '2026年4月の税の差押禁止額の改定（10万7千円・4万8千円）に対応',
  body,
  faq: FAQ,
  related: '借金や家計のことは<a href="{{UP}}articles/shakkin-kakei-soudan.html">家計と借金の無料相談（自治体の窓口）</a>も、生活が苦しいときは<a href="{{UP}}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>もどうぞ。',
  sources: D.sources,
  disclaimer: 'このページは、法令（e-Gov 法令検索）・国税庁の通達・裁判所と市の公表している計算例にもとづく<strong>一般的な計算の目安</strong>で、法律相談ではありません。実際に差し押さえられる額は、差押命令や差押調書・債権差押通知書に書かれた内容、残っている債務の額、勤め先の計算で決まります。差し押さえを止められるか・分けて払えるかなど、あなたの事情については法テラス・弁護士・司法書士・税務署や市区町村の窓口に相談してください。法令の条文と国税庁の通達は、e-Gov 法令検索・国税庁ホームページの内容を加工して作成しています（公共データ利用規約 第1.0版）。',
  js: JS,
})
if (!html.includes('function sashiCalc') || !html.includes('id="s-out"')) die('面の組み立てに失敗しました')
writeTool(REL, html, { dry: DRY })
