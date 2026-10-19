// ─────────────────────────────────────────────────────────────────────────────
// kogaku-sync.mjs — 高額療養費の記事（articles/kougaku-ryouyouhi-2026.html）の限度額を、data/kogaku-gendogaku.json から書く。
//   node scripts/kogaku-sync.mjs           → 書く（中身が変わったときだけ・最終更新・dateModified・sitemap の lastmod も）
//   node scripts/kogaku-sync.mjs --dry     → 書かずに確かめだけ
//   node scripts/kogaku-sync.mjs --check   → あわせて厚労省の PDF を取り直し、JSON の数字を PDF の文字と1つずつ照合する
//
// ★なぜ（2026-10-11 ユーザー裁定 v308 b＝70歳以上の区分表と計算機の年齢の欄）
//   記事は70歳未満だけで、「70歳以上は別の区分表（外来特例あり）で、こちらも同時期に改定されています」と書いて終わっていた。
//   「高額療養費制度 自己負担限度額表」は Bing 90日で24,028回・自艦は9.4位でクリック6回（第186回）。
//   表は計算機の JS（BRACKETS）と早見表の HTML に手で2回写してあった＝改定のたびに片方だけ古くなる型。
//   ∴「厚労省の PDF → data/kogaku-gendogaku.json → この台本」の1本道にし、70歳未満の早見表・70歳以上の節・計算機の表を同じ JSON から書く。
// ★書き換える場所（目印の間だけ）：①<script> の中の // kogaku:start 〜 // kogaku:end（BRACKETS・BRACKETS70）
//   ②70歳未満の早見表（table.limit-table）の tbody ③<!-- kogaku70:start --> 〜 <!-- kogaku70:end -->（70歳以上の節）
//   ④よくある質問（FAQPage）の70歳以上の1問 ⑤「最終更新」・dateModified・sitemap の lastmod。計算の式（calc()）は HTML の中。
// ★確かめ：70歳未満の改定前後と多数回該当・年間上限を、別の資料から起こした data/mitoshi-kogaku.json（/mitoshi/kogaku/ の正典）と突き合わせる。
//   70歳以上の現役並みⅠ〜Ⅲは70歳未満のウ・イ・アと同じ額か。--check では PDF の sha1 と、4ページ目の表の数字の並び・6ページ目の一覧の数字。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SITE, readSitemap, writeSitemap, sitemapLastmods, putUrls } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry'), CHECK = process.argv.includes('--check')
const FILE = path.join(ROOT, 'articles', 'kougaku-ryouyouhi-2026.html')
const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kogaku-gendogaku.json'), 'utf8'))
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mitoshi-kogaku.json'), 'utf8'))
// 75歳以上（後期高齢者医療）の節と高額介護合算の欄（2026-10-20 ユーザー「のこった案をすべてフクシルに増床してくれ」＝第192回の条件つきの案）。
//   Bing 90日＝高額医療費制度 75歳以上 3,047・後期高齢者医療制度 高額療養費 1,920・高額介護合算療養費 636。記事に75歳の語の表示は4件しか無かった
//   （節が無いから付かない）。⑥で <!-- kogaku75:start --> 〜 <!-- kogaku75:end --> に書く。
const K75 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kogaku-75.json'), 'utf8'))
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const num = (n) => Number(n).toLocaleString('en-US')
const yen = (n) => num(n) + '円'
const man = (n) => (n / 10000).toLocaleString('ja-JP') + '万円'
const U = Object.fromEntries(G.u70.map((r) => [r.key, r])), O = Object.fromEntries(G.o70.map((r) => [r.key, r]))

// ── 確かめ（形と、別の資料との突き合わせ）
if (G.u70.map((r) => r.key).join() !== 'a,i,u,e,o') die('70歳未満の区分が ア・イ・ウ・エ・オ ではありません')
if (G.o70.map((r) => r.key).join() !== 'g3,g2,g1,ip,t2,t1') die('70歳以上の区分の並びが違います')
for (const r of [...G.u70, ...G.o70]) {
  if (!(r.new.fix > 0 && r.old.fix > 0) || r.new.fix < r.old.fix) die(`${r.name}：改定後の上限が改定前より小さいか、読めていません`)
  if (!r.new.year) die(`${r.name}：年間上限がありません`)
}
const MK = { a: '約1,160万', i: '約770万', u: '約370万' }
for (const [k, lab] of Object.entries({ a: '年収 約1,160万〜約1,410万円', i: '年収 約770万〜約950万円', u: '年収 約370万〜約510万円' })) {
  const row = M.brackets.find((b) => b.label === lab)
  if (!row) die(`mitoshi-kogaku.json に「${lab}」の行がありません`)
  const [gf, gt] = row.v.genko, [kf, kt] = row.v.ketsu2026
  if (U[k].old.fix !== gf || U[k].old.th !== gt || U[k].new.fix !== kf || U[k].new.th !== kt) die(`70歳未満 ${U[k].name}（${MK[k]}）が mitoshi-kogaku.json と合いません`)
}
for (const t of M.tasu.rows) {
  const r = G.u70.find((x) => x.name === t.kubun)
  if (!r || r.old.tasu !== t.genko || r.new.tasu !== t.ketsu2026 || r.new.year !== t.nenkan2026) die(`70歳未満 ${t.kubun} の多数回該当か年間上限が mitoshi-kogaku.json と合いません`)
}
for (const [o, u] of [['g3', 'a'], ['g2', 'i'], ['g1', 'u']]) for (const side of ['old', 'new']) for (const f of ['fix', 'th', 'tasu']) if (O[o][side][f] !== U[u][side][f]) die(`70歳以上 ${O[o].name} の ${side}.${f} が70歳未満の ${U[u].name} と違います`)
// 75歳到達月の額（施行令第15条第2項の条文の額）が、70歳以上の改定後の額のちょうど半分か
if (K75.tokurei.map((r) => r.key).join() !== G.o70.map((r) => r.key).join()) die('kogaku-75.json の75歳到達月の区分の並びが70歳以上と違います')
for (const t of K75.tokurei) for (const f of ['fix', 'th', 'tasu', 'gairai']) {
  const full = O[t.key].new[f]
  if ((full == null) !== (t[f] == null)) die(`75歳到達月 ${O[t.key].name} の ${f} の有無が70歳以上の表と違います`)
  if (full != null && t[f] * 2 !== full) die(`75歳到達月 ${O[t.key].name} の ${f}（${t[f]}）が70歳以上の額（${full}）の半分ではありません`)
}
const KG = K75.kaigoGassan
if (KG.o75.length !== 6 || KG.o70.length !== 6 || KG.u70.length !== 5) die('高額介護合算の区分の数が違います')
for (let i = 0; i < 6; i++) if (KG.o75[i].y !== KG.o70[i].y) die(`高額介護合算の75歳以上と70〜74歳の${i + 1}行目が違います（施行令ではどちらも同じ額）`)
for (const [i, y] of [[0, 2120000], [1, 1410000], [2, 670000]]) if (KG.u70[i].y !== y || KG.o70[i].y !== y) die('高額介護合算の現役並み（ア・イ・ウ）の額が212万・141万・67万ではありません')

// ── --check：PDF の文字と照合
if (CHECK) {
  const cache = path.join(ROOT, '.cache', 'kogaku')
  fs.mkdirSync(cache, { recursive: true })
  const pdf = path.join(cache, path.basename(G.source.url))
  const buf = Buffer.from(await (await fetch(G.source.url, { headers: { 'user-agent': 'Mozilla/5.0 (fukushiru.com)' } })).arrayBuffer())
  fs.writeFileSync(pdf, buf)
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
  if (sha1 !== G.source.sha1) die(`PDF の中身が変わりました（sha1 ${sha1}）＝改定か差し替え。PDF を開いて JSON を写し直す`)
  const py = 'import fitz,sys,json\nd=fitz.open(sys.argv[1])\nprint(json.dumps([p.get_text() for p in d]))'
  const pages = JSON.parse(execFileSync('py', ['-c', py, pdf], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 1 << 26 }))
  const flat = (s) => s.replace(/\s+/g, '')
  const p4 = flat(pages[3]), p6 = flat(pages[5])
  // 4ページ目＝令和8年8月〜令和9年7月の表。2つ目の「所得区分」から後が70歳以上。数字が表の順に並んでいるか
  const cut = p4.indexOf('所得区分', p4.indexOf('所得区分') + 1)
  if (cut < 0) die('PDF 4ページ目に70歳以上の表が見つかりません')
  const seq = (text, nums, label) => { let at = 0; for (const n of nums) { const i = text.indexOf(num(n), at); if (i < 0) die(`PDF（${label}）に ${num(n)} が表の順で見つかりません`); at = i + num(n).length } }
  // 区分エの多数回該当（44,400）は表で上の段とまとめて1つしか書かれていないので、並びの照合から外す
  seq(p4.slice(0, cut), G.u70.flatMap((r) => [r.new.fix, r.new.th, r.key === 'e' ? null : r.new.tasu, r.new.year].filter((x) => x)), '4ページ・70歳未満')
  const o = G.o70
  seq(p4.slice(cut), [O.g3.new.fix, O.g3.new.th, O.g3.new.tasu, O.g3.new.year, O.g2.new.fix, O.g2.new.th, O.g2.new.tasu, O.g2.new.year, O.g1.new.fix, O.g1.new.th, O.g1.new.tasu, O.g1.new.year, O.ip.new.gairai, O.ip.new.gairaiYear, O.ip.new.fix, O.ip.new.year, O.t2.new.gairai, O.t2.new.gairaiYear, O.t2.new.fix, O.t2.new.tasu, O.t2.new.year, O.t1.new.gairai, O.t1.new.fix, O.t1.new.year], '4ページ・70歳以上')
  // 6ページ目＝現行と令和8年8月〜の一覧。改定前の額（現行）と一般の多数回該当・外来の年間上限（万円の表記）
  for (const n of [O.g3.old.fix, O.g2.old.fix, O.g1.old.fix, O.ip.old.fix, O.ip.old.gairai, O.ip.old.tasu, O.t2.old.fix, O.t2.old.gairai, O.t1.old.fix, O.t1.old.gairai, U.o.old.fix]) if (!p6.includes(num(n))) die(`PDF 6ページ目に改定前の ${num(n)} がありません`)
  for (const n of [O.ip.old.gairaiYear, O.ip.new.gairaiYear, O.t2.new.gairaiYear]) if (!p6.includes('年' + (n / 10000) + '万')) die(`PDF 6ページ目に外来の年間上限「年${n / 10000}万」がありません`)
  if (!p6.includes(`${num(O.ip.new.fix)}<${num(O.ip.new.tasu)}>`)) die('PDF 6ページ目に一般の「61,500<44,400>」がありません')
  if (!pages[3].includes('41万円')) die('PDF 4ページ目に年間上限41万円の注がありません')
  console.log('✓ PDF（sha1 同じ）の4ページ目の表の並びと6ページ目の一覧に、JSON の数字がすべてある')
}

// ── ① 計算機の表（JS）
const fmtV = (v) => `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${x === null ? 'null' : x}`).join(', ')} }`
const LAB_U = { a: 'ア：年収 約1,160万円〜', i: 'イ：年収 約770〜1,160万円', u: 'ウ：年収 約370〜770万円', e: 'エ：年収 〜約370万円', o: 'オ：住民税非課税世帯' }
const LAB_O = { g3: '現役並みⅢ：年収 約1,160万円〜（3割）', g2: '現役並みⅡ：年収 約770〜1,160万円（3割）', g1: '現役並みⅠ：年収 約370〜770万円（3割）', ip: '一般：年収 〜約370万円（1〜2割）', t2: '住民税非課税の世帯（低所得Ⅱ）', t1: '住民税非課税で所得が一定以下（低所得Ⅰ）' }
const jsRows = (rows, lab, short) => rows.map((r) => `  ${r.key}: { name: '${short ? short(r) : r.name}', label: '${lab[r.key]}', share: '${r.share || '3割'}', old: ${fmtV(r.old)}, new: ${fmtV(r.new)} }`).join(',\n')
const JS = `// kogaku:start
// ====== 高額療養費の月の上限（data/kogaku-gendogaku.json から scripts/kogaku-sync.mjs が書く。手で直さない）======
// old＝〜2026年7月、new＝2026年8月〜。fix＝定額、th があれば「fix＋(医療費−th)×1%」。tasu＝多数回該当、gairai＝70歳以上の外来（1人ごと）、year＝年間上限
var BRACKETS = {
${jsRows(G.u70, LAB_U)}
};
var BRACKETS70 = {
${jsRows(G.o70, LAB_O)}
};
// kogaku:end`
let html = fs.readFileSync(FILE, 'utf8').replace(/\r/g, '')
const jA = html.indexOf('// kogaku:start'), jB = html.indexOf('// kogaku:end')
if (jA < 0 || jB < jA) die('script の中の目印（// kogaku:start 〜 // kogaku:end）が見つかりません')
html = html.slice(0, jA) + JS + html.slice(jB + '// kogaku:end'.length)

// ── ② 70歳未満の早見表の tbody（いまの書き方のまま）
const fx = (v) => (v.th ? `${yen(v.fix)}＋(医療費−${yen(v.th)})×1%` : yen(v.fix))
const uRow = (r) => `      <tr><th>${r.name}</th><td>${r.key === 'o' ? '<a href="juminzei-hikazei-check.html">住民税非課税世帯</a>' : r.income}</td><td>${fx(r.old)}</td><td class="up">${fx(r.new)}</td><td>${yen(r.new.tasu)}</td><td>${man(r.new.year)}${r.new.yearLow ? '<br><small>（※）</small>' : ''}</td></tr>`
const tA = html.indexOf('<table class="limit-table">'), tB = html.indexOf('<tbody>', tA), tC = html.indexOf('</tbody>', tB)
if (tA < 0 || tB < 0 || tC < 0) die('70歳未満の早見表が見つかりません')
html = html.slice(0, tB) + '<tbody>\n' + G.u70.map(uRow).join('\n') + '\n    ' + html.slice(tC)

// ── ③ 70歳以上の節
const oRow = (r) => {
  // スマホ（375px）で収まるよう、年間上限は別の列にせず、外来と世帯の欄の下に小さく書く
  const g = r.new.gairai ? `${r.old.gairai === r.new.gairai ? yen(r.new.gairai) + '<br><small>据え置き</small>' : `${yen(r.old.gairai)}<br>→<strong>${yen(r.new.gairai)}</strong>`}${r.new.gairaiYear ? `<br><small>年${man(r.new.gairaiYear)}</small>` : ''}` : '—'
  return `      <tr><th>${r.short || r.name}<br><small>${r.sub || r.income}</small></th><td>${g}</td><td>${yen(r.old.fix)}<br>→<strong>${yen(r.new.fix)}</strong><br><small>年${man(r.new.year)}${r.new.yearLow ? '（※）' : ''}</small></td><td>${r.new.tasu ? yen(r.new.tasu) + (r.old.tasu ? '' : '<br><small>新設</small>') : '—'}</td></tr>`
}
const SEC = `<!-- kogaku70:start -->
  <h3 id="70ijo">70歳以上の上限額（2026年8月診療分〜・外来特例あり）</h3>
  <p>70歳以上（75歳以上の後期高齢者医療を含む）は、70歳未満と区分が違います。<strong>一般と住民税非課税の人には、通院だけの月に1人ずつかかる「外来」の上限</strong>（外来特例）があり、入院した月や家族の分と合わせるときは「世帯」の上限で計算します。2026年8月から、所得が一定以下の人の外来（${yen(O.t1.new.gairai)}のまま）を除いて上がりました。</p>
  <div class="table-wrap"><table class="fit">
    <caption>70歳以上の自己負担限度額（月額・〜2026年7月→2026年8月〜。小さい字の「年」は8月〜翌7月の年間上限）</caption>
    <thead><tr><th>区分</th><th>外来<br>（1人）</th><th>世帯<br>（入院も）</th><th>多数回<br>該当</th></tr></thead>
    <tbody>
${G.o70.filter((r) => r.new.gairai).map(oRow).join('\n')}
    </tbody>
  </table></div>
  <p class="mini-note">年収約370万円以上（課税所得145万円以上）の<strong>現役並み所得</strong>の人は外来特例がなく、上限は70歳未満と同じです（現役並みⅢ＝区分ア・Ⅱ＝イ・Ⅰ＝ウ。窓口の負担は3割）。一般と住民税非課税の人の窓口の負担は、70〜74歳が2割・75歳以上が1割（75歳以上でも一定以上の所得があれば2割）です。外来の年間上限は8月〜翌7月の外来の合計に対する上限です。一般の外来の年間上限は2017年からあり（年${man(O.ip.old.gairaiYear)}）、2026年8月に${man(O.ip.new.gairaiYear)}へ上がりました。住民税非課税の人の年${man(O.t2.new.gairaiYear)}と、入院も含めた世帯の年間上限は、2026年8月に新しくできました。（※）一般のうち年収約200万円以下（健保＝標準報酬月額15万円以下、国保・後期＝課税所得28万円未満）と確かめられた人は、年間上限が${man(O.ip.new.yearLow)}で、2027年8月以降に払い戻されます。2027年8月からは一般の区分がさらに細かく分かれ、外来の上限が変わる人がいます（<a href="../mitoshi/kogaku/">上限額の移り変わり</a>）。出典：<a href="${G.source.url}" rel="nofollow">厚生労働省「高額療養費制度の見直しについて」（患者負担割合及び高額療養費自己負担限度額）</a>（${G.source.checkedAt} 照合）。</p>
<!-- kogaku70:end -->`
const sA = html.indexOf('<!-- kogaku70:start -->'), sB = html.indexOf('<!-- kogaku70:end -->')
if (sA < 0 || sB < sA) die('70歳以上の節の目印（<!-- kogaku70:start --> 〜 <!-- kogaku70:end -->）が見つかりません')
html = html.slice(0, sA) + SEC + html.slice(sB + '<!-- kogaku70:end -->'.length)
// 表の CSS（数字は折り返さない・区分の欄は左寄せ）。生活保護の計算機と同じ
const FIT_CSS = 'table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:6px 5px;white-space:nowrap}table.fit tbody th{text-align:left}'
if (/table\.fit\{[^\n]*/.test(html)) html = html.replace(/table\.fit\{[^\n]*/, FIT_CSS)
else html = html.replace('</style>', FIT_CSS + '\n</style>')
html = html.replace('70歳以上の方・複数月合算・世帯合算の詳細は', '複数月合算・世帯合算の詳細は')

// ── ⑥ 75歳以上（後期高齢者医療）の節と、医療と介護の合算（高額介護合算療養費）の欄（70歳以上の節のすぐ後ろ）
const F = K75.futan, TK = Object.fromEntries(K75.tokurei.map((t) => [t.key, t]))
const tkCell = (t) => (t.th ? `${yen(t.fix)}<br><small>＋(医療費−${yen(t.th)})×1%</small>` : yen(t.fix))
const tkRow = (r) => { const t = TK[r.key]; return `      <tr><th>${K75.kubunName75[r.key]}</th><td>${t.gairai ? yen(t.gairai) : '—'}</td><td>${tkCell(t)}</td><td>${t.tasu ? yen(t.tasu) : '—'}</td></tr>` }
const kgRows = (rows) => rows.map((r) => `      <tr><th>${r.name}</th><td class="num">${man(r.y)}</td></tr>`).join('\n')
const K75JS = `(function(){var F=${JSON.stringify({ k3: F.kazei3, k2: F.kazei2, n1: F.nenkin2.one, nm: F.nenkin2.multi, s1: F.shunyu3.one, sm: F.shunyu3.multi })};
var $=function(i){return document.getElementById(i)};function v(i){var s=$(i).value.replace(/[,，円\\s]/g,'');return s===''?null:parseInt(s,10)}function man(n){return (n/10000).toLocaleString('ja-JP')+'万円'}
function calc(){var multi=$('k75-n').value==='2',k=v('k75-kazei'),n=v('k75-nen'),s=v('k75-shu'),o=$('k75-out'),nl=multi?F.nm:F.n1,sl=multi?F.sm:F.s1;
$('k75-shu-row').style.display=(k!==null&&k>=F.k3)?'':'none';
if(k===null){o.innerHTML='<p class="bd">世帯の後期高齢者医療の人のうち、いちばん高い住民税の課税所得を入れてください（0円なら 0）。</p>';return}
var r,why;
if(k>=F.k3&&!(s!==null&&s<sl)){r='3割';why='課税所得が'+man(F.k3)+'以上の人がいる世帯です。'+(s===null?'収入の合計が'+man(sl)+'未満なら、申請で3割にならないことがあります（下の欄に入れると判定します）。':'')}
else if(k>=F.k2){if(n===null){o.innerHTML='<p class="bd">課税所得が'+man(F.k2)+'以上なので、「年金収入＋その他の合計所得金額」（被保険者の合計）を入れると、1割か2割かが分かります。</p>';return}
r=n>=nl?'2割':'1割';why=(k>=F.k3?'収入の合計が'+man(sl)+'未満なので、申請すると3割にならない人です（「基準収入額適用申請」）。':'')+'課税所得が'+man(F.k2)+'以上で、年金収入＋その他の合計所得金額が'+(n>=nl?man(nl)+'以上':man(nl)+'未満')+'（'+(multi?'2人以上の世帯':'1人の世帯')+'）です。'}
else{r='1割';why='世帯の被保険者の課税所得が、どの人も'+man(F.k2)+'未満です。'}
o.innerHTML='<p class="total">窓口の負担 '+r+'の目安</p><p class="bd">'+why+'実際の割合は、毎年8月ごろに届く資格確認書・保険証、またはマイナポータルで確かめてください。</p>'}
['k75-n','k75-kazei','k75-nen','k75-shu'].forEach(function(i){$(i).addEventListener('input',calc);$(i).addEventListener('change',calc)});calc()})();`
const SEC75 = `<!-- kogaku75:start -->
  <h3 id="75ijo">75歳以上（後期高齢者医療）の人の上限と窓口の負担</h3>
  <p>75歳以上の人の月の上限額は、<a href="#70ijo">上の70歳以上の表</a>と同じです。後期高齢者医療では区分の呼び名が違い、一般は窓口の負担で<strong>一般Ⅱ（2割）と一般Ⅰ（1割）</strong>に分かれますが、上限額はどちらも外来${yen(O.ip.new.gairai)}・世帯${yen(O.ip.new.fix)}です。住民税非課税の人は<strong>区分Ⅱ</strong>、そのうち所得が一定以下の人は<strong>区分Ⅰ</strong>です。</p>
  <p><strong>窓口の負担は1割・2割・3割のどれか</strong></p>
  <ul>
    <li><strong>3割</strong>：同じ世帯の後期高齢者医療の被保険者に、住民税の課税所得が${man(F.kazei3)}以上の人がいる。ただし、収入が被保険者1人なら${man(F.shunyu3.one)}未満・2人以上なら合計${man(F.shunyu3.multi)}未満と申請して認められたとき、または基礎控除後の総所得金額等の合計が${man(F.kiso210)}以下のときは、3割になりません。</li>
    <li><strong>2割</strong>：課税所得が${man(F.kazei2)}以上の人がいて、かつ同じ世帯の被保険者の「年金収入＋その他の合計所得金額」が、1人なら${man(F.nenkin2.one)}以上・2人以上なら合計${man(F.nenkin2.multi)}以上。</li>
    <li><strong>1割</strong>：それ以外（住民税非課税の世帯を含む）。</li>
  </ul>
  <div class="calc" id="k75">
    <div class="row"><label for="k75-n">世帯の後期高齢者医療の人</label><select id="k75-n"><option value="1">1人</option><option value="2">2人以上</option></select></div>
    <div class="row"><label for="k75-kazei">そのうち、いちばん高い住民税の課税所得（円・年）</label><input id="k75-kazei" type="text" inputmode="numeric" placeholder="例 300000（0円なら 0）"></div>
    <div class="row"><label for="k75-nen">年金収入＋その他の合計所得金額（被保険者の合計・円）</label><input id="k75-nen" type="text" inputmode="numeric" placeholder="例 2100000"></div>
    <div class="row" id="k75-shu-row" style="display:none"><label for="k75-shu">収入の合計（被保険者・必要経費や控除を引く前・円）</label><input id="k75-shu" type="text" inputmode="numeric" placeholder="例 3500000"></div>
    <div class="out" id="k75-out" aria-live="polite"></div>
  </div>
  <p class="mini-note">判定は${F.kijunbi}します。${F.nenkinNote}。2割の人の外来の負担増を月3,000円までに抑える配慮措置は、2025年9月30日で終わりました。75歳以上の高額療養費は、最初に1回申請すれば、2回目からは申請しなくても口座に振り込まれます（対象になると広域連合から申請の案内が届きます）。外来の年間上限は、基準日（7月31日）に窓口の負担が1割か2割の人が対象で、3割の人は対象外です。</p>
  <p id="75tanjo"><strong>75歳の誕生月は、上限が半分ずつになる</strong></p>
  <p>月の途中で75歳になった月（1日生まれの人を除く）は、それまでの医療保険（国保・会社の健康保険など）と、新しく入る後期高齢者医療の<strong>両方の上限が、それぞれ半分</strong>になります。その人に扶養されていて、同じ月に国保などへ移る家族も同じです。1か月の医療費が2つの制度に分かれるので、ふつうの上限をそのまま当てると払いすぎになります。</p>
  <div class="table-wrap"><table class="fit">
    <caption>75歳の誕生月の後期高齢者医療の上限（月額・2026年8月〜）</caption>
    <thead><tr><th>区分</th><th>外来<br>（1人）</th><th>世帯<br>（入院も）</th><th>多数回<br>該当</th></tr></thead>
    <tbody>
${G.o70.map(tkRow).join('\n')}
    </tbody>
  </table></div>
  <p class="mini-note">それまでの医療保険の側も、その人の区分の上限の半分です。誕生月の扱いが年間上限の計算でどうなるかは、公式の説明が見つからなかったので、加入している保険者に確かめてください。</p>

  <h3 id="kaigo-gassan">医療と介護の合算（高額介護合算療養費）</h3>
  <p>同じ世帯で、8月〜翌7月の1年に払った<strong>医療保険の自己負担と、介護保険の利用者負担を合わせた額</strong>が下の年額を超えたとき、申請すると超えた分が医療と介護のそれぞれの制度から戻ります。高額療養費や高額介護サービス費で戻った分は除いて合算します。医療と介護のどちらかの自己負担が0円なら対象外で、超えた額が${KG.kijun}円以下のときは支給されません。対象になる人には、保険者から申請の案内が届くことが多いです。</p>
  <div class="table-wrap"><table class="fit">
    <caption>70歳以上（75歳以上の後期高齢者医療を含む）の年額</caption>
    <thead><tr><th>区分</th><th class="num">年額</th></tr></thead>
    <tbody>
${KG.o75.map((r, i) => `      <tr><th>${r.name}<br><small>70〜74歳：${KG.o70[i].name}</small></th><td class="num">${man(r.y)}</td></tr>`).join('\n')}
    </tbody>
  </table></div>
  <div class="table-wrap"><table class="fit">
    <caption>70歳未満の年額</caption>
    <thead><tr><th>区分</th><th class="num">年額</th></tr></thead>
    <tbody>
${kgRows(KG.u70)}
    </tbody>
  </table></div>
  <p class="mini-note">${KG.u70MinNote}。70〜74歳と70歳未満が同じ世帯にいるときは、先に70〜74歳の人の分に70歳以上の年額を当て、残りと70歳未満の人の分を合わせて70歳未満の年額を当てます。年額は2026年8月の改定で変わっていません。区分Ⅰ（所得が一定以下）の判定では、2026年8月から公的年金の収入から${yen(K75.t1Kojo.new)}（前は${yen(K75.t1Kojo.old)}）を差し引いて計算します。出典：${K75.sources.slice(0, 3).map((s) => `<a href="${s.url}" rel="nofollow">${s.name.replace(/ e-Gov 法令検索$/, '')}</a>`).join('・')}（${K75.checkedAt} 照合）。</p>
  <script>${K75JS}</script>
<!-- kogaku75:end -->`
{
  const s70 = html.indexOf('<!-- kogaku70:end -->') + '<!-- kogaku70:end -->'.length
  const a = html.indexOf('<!-- kogaku75:start -->'), b = html.indexOf('<!-- kogaku75:end -->')
  if (a >= 0 && b > a) html = html.slice(0, a) + SEC75 + html.slice(b + '<!-- kogaku75:end -->'.length)
  else if (a < 0 && b < 0) html = html.slice(0, s70) + '\n' + SEC75 + html.slice(s70)
  else die('75歳以上の節の目印（<!-- kogaku75:start --> 〜 <!-- kogaku75:end -->）が片方しかありません')
}
// 出典の欄：資料の名前を厚労省のページの名前にそろえ、75歳以上の節の原典を足す（無い行だけ）
html = html.replace('厚生労働省「高額療養費の上限額（令和8年8月〜・令和9年8月〜）」', '厚生労働省「高額療養費制度の見直しについて（令和8年8月診療分から）」')
{
  const h = html.indexOf('<h2>出典（厚生労働省ほか）</h2>'), ul = html.indexOf('</ul>', h)
  if (h < 0 || ul < 0) die('出典の欄が見つかりません')
  const have = html.slice(h, ul)
  const add = K75.sources.filter((s) => !have.includes(s.url)).map((s) => `    <li>${s.name} ${s.url}</li>\n`).join('')
  const at = html.lastIndexOf('\n', ul) + 1   // 「  </ul>」の行の頭
  if (add) html = html.slice(0, at) + add + html.slice(at)
}

// ── ④ よくある質問（70歳以上の1問）
const Q = '70歳以上の高額療養費の上限はいくらですか？'
const A = `2026年8月診療分から、70歳以上で一般（年収約370万円まで）の人は、通院だけの月が1人${yen(O.ip.new.gairai)}（8月〜翌7月で${yen(O.ip.new.gairaiYear)}まで）、入院を含む世帯の上限が${yen(O.ip.new.fix)}です（改定前は${yen(O.ip.old.gairai)}・${yen(O.ip.old.fix)}）。住民税非課税の人は通院${yen(O.t2.new.gairai)}・世帯${yen(O.t2.new.fix)}、所得が一定以下の人は通院${yen(O.t1.new.gairai)}・世帯${yen(O.t1.new.fix)}です。年収約370万円以上の現役並み所得の人は、70歳未満と同じ額です（厚生労働省）。`
// 1問を入れ替える（無ければ末尾に足す）。75歳以上の3問も同じ所で（2026-10-20）
const fA = html.indexOf('"@type": "FAQPage"')
const putFaq = (q, a) => {
  const qLine = `    {\n      "@type": "Question",\n      "name": "${q}",\n      "acceptedAnswer": { "@type": "Answer", "text": "${a}" }\n    }`
  const fEnd = html.indexOf('\n  ]\n}', fA)
  if (fA < 0 || fEnd < 0) die('よくある質問（FAQPage）が見つかりません')
  const qAt = html.indexOf(`"name": "${q}"`, fA)
  if (qAt > 0 && qAt < fEnd) {
    const s = html.lastIndexOf('\n    {', qAt), e = html.indexOf('\n    }', qAt) + '\n    }'.length
    html = html.slice(0, s + 1) + qLine + html.slice(e)
  } else html = html.slice(0, fEnd) + ',\n' + qLine + html.slice(fEnd)
}
putFaq(Q, A)
putFaq('75歳以上の窓口の負担は1割・2割・3割のどれですか？', `同じ世帯の後期高齢者医療の被保険者に住民税の課税所得${man(F.kazei3)}以上の人がいれば3割です（収入が1人${man(F.shunyu3.one)}未満・2人以上で${man(F.shunyu3.multi)}未満と申請して認められれば外れます）。課税所得${man(F.kazei2)}以上の人がいて、年金収入＋その他の合計所得金額が1人${man(F.nenkin2.one)}以上・2人以上で合計${man(F.nenkin2.multi)}以上なら2割、それ以外は1割です。毎年8月1日を基準に前年の所得で判定します。上限額は1割・2割とも同じです。`)
putFaq('75歳の誕生月の高額療養費の上限はどうなりますか？', `月の途中で75歳になった月（1日生まれの人を除く）は、それまでの医療保険と後期高齢者医療の両方の上限が、それぞれ半分になります。2026年8月診療分からの一般の人の後期高齢者医療の側は、世帯${yen(TK.ip.fix)}・外来${yen(TK.ip.gairai)}です（高齢者の医療の確保に関する法律施行令）。`)
putFaq('高額介護合算療養費とは何ですか？いくらから戻りますか？', `同じ世帯で8月〜翌7月に払った医療保険の自己負担と介護保険の利用者負担の合計が、年額の上限を超えたときに、申請で超えた分が戻る制度です。75歳以上の一般の人の年額は${man(KG.o75[3].y)}、住民税非課税の区分Ⅱは${man(KG.o75[4].y)}、区分Ⅰは${man(KG.o75[5].y)}、70歳未満の区分エは${man(KG.u70[3].y)}です。超えた額が${KG.kijun}円以下なら支給されません。`)
JSON.parse(html.slice(html.lastIndexOf('<script type="application/ld+json">', fA) + '<script type="application/ld+json">'.length, html.indexOf('</script>', fA)))

// ── 確かめ：calc() が使う名前がそろっているか
for (const nm of ['BRACKETS70', "getElementById('k-age')", "getElementById('k-kind')", 'b.new.gairai', 'href="#70ijo"']) if (!html.includes(nm)) die(`HTML に ${nm} がありません（計算の式か注記が古い）`)
console.log(`確かめ：70歳以上 一般 外来${yen(O.ip.old.gairai)}→${yen(O.ip.new.gairai)}・世帯${yen(O.ip.old.fix)}→${yen(O.ip.new.fix)}／非課税 外来${yen(O.t2.old.gairai)}→${yen(O.t2.new.gairai)}・世帯${yen(O.t2.old.fix)}→${yen(O.t2.new.fix)}／所得が一定以下 世帯${yen(O.t1.old.fix)}→${yen(O.t1.new.fix)}`)
if (DRY) process.exit(0)

// ── ⑤ 最終更新・dateModified・sitemap
const UPDATED = /最終更新：\d{4}-\d{2}-\d{2} ／ .*?<\/p>/
if (!UPDATED.test(html)) die('「最終更新」の行が見つかりません')
html = html.replace(UPDATED, `最終更新：${TODAY} ／ <strong>2026年8月診療分から新しい上限額が適用されています</strong>（70歳未満・70歳以上）。すべて概算です</p>`)
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/g, '')
const prev = fs.readFileSync(FILE, 'utf8')
const syncSitemap = (page) => {
  const URL = `${SITE}/articles/kougaku-ryouyouhi-2026.html`
  const dm = (page.match(/"dateModified": "(\d{4}-\d{2}-\d{2})"/) || [])[1]
  const sm = readSitemap(), lm = sitemapLastmods(sm).get(URL)
  if (!dm || !lm) die('sitemap の行かページの dateModified が見つかりません')
  if (dm <= lm) return
  const row = sm.match(new RegExp(`<url><loc>${URL.replace(/[.]/g, '\\.')}</loc>.*?</url>`))[0]
  writeSitemap(putUrls(sm, [[URL, row.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${dm}</lastmod>`)]]))
  console.log(`sitemap の lastmod を ${lm} → ${dm} に進めた`)
}
if (strip(prev) === strip(html)) { syncSitemap(prev); console.log('変わらず:', FILE); process.exit(0) }
html = html.replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/, `"dateModified": "${TODAY}"`)
fs.writeFileSync(FILE, html)
syncSitemap(html)
console.log('書いた:', FILE)
