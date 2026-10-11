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
  <p>70歳以上（75歳以上の後期高齢者医療を含む）は、70歳未満と区分が違います。<strong>一般と住民税非課税の人には、通院だけの月に1人ずつかかる「外来」の上限</strong>（外来特例）があり、入院した月や家族の分と合わせるときは「世帯」の上限で計算します。2026年8月から、外来・世帯とも上がりました。</p>
  <div class="table-wrap"><table class="fit">
    <caption>70歳以上の自己負担限度額（月額・〜2026年7月→2026年8月〜。小さい字の「年」は8月〜翌7月の年間上限）</caption>
    <thead><tr><th>区分</th><th>外来<br>（1人）</th><th>世帯<br>（入院も）</th><th>多数回<br>該当</th></tr></thead>
    <tbody>
${G.o70.filter((r) => r.new.gairai).map(oRow).join('\n')}
    </tbody>
  </table></div>
  <p class="mini-note">年収約370万円以上（課税所得145万円以上）の<strong>現役並み所得</strong>の人は外来特例がなく、上限は70歳未満と同じです（現役並みⅢ＝区分ア・Ⅱ＝イ・Ⅰ＝ウ。窓口の負担は3割）。一般と住民税非課税の人の窓口の負担は、70〜74歳が2割・75歳以上が1割（75歳以上でも一定以上の所得があれば2割）です。外来の年間上限は8月〜翌7月の外来の合計に対する上限です。（※）一般のうち年収約200万円以下（健保＝標準報酬月額15万円以下、国保・後期＝課税所得28万円未満）と確かめられた人は、年間上限が${man(O.ip.new.yearLow)}で、2027年8月以降に払い戻されます。2027年8月からは一般の区分がさらに細かく分かれ、外来の上限が変わる人がいます（<a href="../mitoshi/kogaku/">上限額の移り変わり</a>）。出典：<a href="${G.source.url}" rel="nofollow">厚生労働省「高額療養費制度の見直しについて」（患者負担割合及び高額療養費自己負担限度額）</a>（${G.source.checkedAt} 照合）。</p>
<!-- kogaku70:end -->`
const sA = html.indexOf('<!-- kogaku70:start -->'), sB = html.indexOf('<!-- kogaku70:end -->')
if (sA < 0 || sB < sA) die('70歳以上の節の目印（<!-- kogaku70:start --> 〜 <!-- kogaku70:end -->）が見つかりません')
html = html.slice(0, sA) + SEC + html.slice(sB + '<!-- kogaku70:end -->'.length)
// 表の CSS（数字は折り返さない・区分の欄は左寄せ）。生活保護の計算機と同じ
const FIT_CSS = 'table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:6px 5px;white-space:nowrap}table.fit tbody th{text-align:left}'
if (/table\.fit\{[^\n]*/.test(html)) html = html.replace(/table\.fit\{[^\n]*/, FIT_CSS)
else html = html.replace('</style>', FIT_CSS + '\n</style>')
html = html.replace('70歳以上の方・複数月合算・世帯合算の詳細は', '複数月合算・世帯合算の詳細は')

// ── ④ よくある質問（70歳以上の1問）
const Q = '70歳以上の高額療養費の上限はいくらですか？'
const A = `2026年8月診療分から、70歳以上で一般（年収約370万円まで）の人は、通院だけの月が1人${yen(O.ip.new.gairai)}（8月〜翌7月で${yen(O.ip.new.gairaiYear)}まで）、入院を含む世帯の上限が${yen(O.ip.new.fix)}です（改定前は${yen(O.ip.old.gairai)}・${yen(O.ip.old.fix)}）。住民税非課税の人は通院${yen(O.t2.new.gairai)}・世帯${yen(O.t2.new.fix)}、所得が一定以下の人は通院${yen(O.t1.new.gairai)}・世帯${yen(O.t1.new.fix)}です。年収約370万円以上の現役並み所得の人は、70歳未満と同じ額です（厚生労働省）。`
const qLine = `    {\n      "@type": "Question",\n      "name": "${Q}",\n      "acceptedAnswer": { "@type": "Answer", "text": "${A}" }\n    }`
const fA = html.indexOf('"@type": "FAQPage"')
const fEnd = html.indexOf('\n  ]\n}', fA)
if (fA < 0 || fEnd < 0) die('よくある質問（FAQPage）が見つかりません')
const qAt = html.indexOf(`"name": "${Q}"`, fA)
if (qAt > 0 && qAt < fEnd) {
  const s = html.lastIndexOf('\n    {', qAt), e = html.indexOf('\n    }', qAt) + '\n    }'.length
  html = html.slice(0, s + 1) + qLine + html.slice(e)
} else html = html.slice(0, fEnd) + ',\n' + qLine + html.slice(fEnd)
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
