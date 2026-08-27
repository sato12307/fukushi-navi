// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-parse.mjs — 集めた原典（各自治体の例規）から認定基準を読み取る。
//
// ★読み取るのは全国共通の3つの物差しだけ
//   (1) 障害高齢者の日常生活自立度（寝たきり度）… J1 J2 A1 A2 B1 B2 C1 C2
//   (2) 認知症高齢者の日常生活自立度（認知症度）… Ⅰ Ⅱa Ⅱb Ⅲa Ⅲb Ⅳ M
//   (3) 要介護度 … 要支援1〜2／要介護1〜5
//   どれも厚労省の通知で定義が全国共通なので、自治体をまたいで比較できる。
//   出すのは「どのランクから対象になるか」＝**しきい値**であって、条文の写しではない。
//
// ★表の形（実物を見て確定させた）
//   ほとんどの要綱は「認定区分 ｜ 障がいの程度 ｜ 認定基準」の3列表を持つ。
//   認定区分のセルは rowspan で縦に結合されているので、**空セルの行は直前の区分を引き継ぐ**。
//   これを忘れると、特別障害者の行が障害者に混ざる（v1で実際に起きた）。
//   例（三郷市）: 障害者→認知症度Ⅱa以上／寝たきり度A1以上
//                特別障害者→認知症度Ⅲa,Ⅲb,Ⅳ,M／寝たきり度B1,B2,C1,C2
//
// ★凡例の表を基準と間違えない
//   多くの例規は末尾に「Ⅰ=…, Ⅱ=…, Ⅲ=…」という判定基準の説明表を持つ。
//   ここを読むと全ランクが並んで「どんな人でも対象」に見える（v1の失敗）。
//   ∴ **見出し行に『認定区分』相当と『基準』相当が両方ある表だけ**を基準表として扱う。
//
// ★数値化しないと決めたもの
//   「その他市長が認めるもの」のような裁量条項。全自治体にほぼ必ずあるが運用が
//   外から見えない。数字にすると「基準が緩い」と誤って読める。原文リンクだけ出す。
//
// ★取りこぼしは隠さない
//   読めなかったものは理由つきで数える。「読めた件数」だけ出すと母数が勝手に縮んで
//   基準の分布が歪む。[[same-question-two-answers]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criteriaFromText, clean as libClean } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const src = JSON.parse(fs.readFileSync(path.join(OUT, 'sources.json'), 'utf8'))

const zen = (s) => String(s).replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
// ★「障がい者」「障碍者」表記が全国で混在する。ここで一本化しないと、ひらがな表記の
//   自治体だけ丸ごと読み落とす（実測でこれが取りこぼしの主因のひとつだった）。
const norm = (s) => s.replace(/障(?:がい|碍)/g, '障害')
const strip = (h) => norm(zen(h.replace(/<[^>]+>/g, '')
  .replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
  .replace(/\s+/g, ' ').trim())

// ── 順序つきの物差し。小さいほど軽い＝しきい値が低い＝対象になりやすい ──────
const NETAKIRI = ['J1', 'J2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const NINCHI = ['Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M']
const KAIGO = ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5']
const rank = (list, v) => list.indexOf(v)

// 「Ⅱa以上」「Ⅲa、Ⅲb、Ⅳ、M」「A1以上」「要介護4又は5」から、最も軽い値を取る。
function lowest(cell, list, re, norm) {
  const found = []
  for (const m of cell.matchAll(re)) {
    const v = norm(m)
    if (v && list.includes(v)) found.push(v)
  }
  if (!found.length) return null
  // 「以上」が付いていれば、書かれた値そのものが下限。無ければ列挙の最小値が下限。
  return found.reduce((a, b) => (rank(list, b) < rank(list, a) ? b : a))
}

const readNinchi = (cell) => lowest(cell, NINCHI, /(Ⅰ|Ⅱ|Ⅲ|Ⅳ|M|Ｍ)\s*([ab])?/g, (m) => {
  let v = m[1] === 'Ｍ' ? 'M' : m[1]
  if (v === 'M' || v === 'Ⅰ' || v === 'Ⅳ') return v
  return v + (m[2] || 'a')            // Ⅱ・Ⅲ を単独で書く例規は a と同じ扱い（軽いほう）
})
const readNetakiri = (cell) => lowest(cell, NETAKIRI, /\b([JABC])\s*([12])?/g, (m) => m[1] + (m[2] || '1'))
const readKaigo = (cell) => {
  // 「要介護1〜3」「要介護4又は5」「要介護3以上」いずれも、書かれた数字の最小を下限とする
  const nums = []
  for (const m of cell.matchAll(/(要介護|要支援)\s*([1-5])(?:\s*(?:～|〜|から|又は|・|、)\s*([1-5]))?/g)) {
    nums.push(m[1] + m[2]); if (m[3]) nums.push(m[1] + m[3])
  }
  if (!nums.length) return null
  return nums.filter((v) => KAIGO.includes(v)).reduce((a, b) => (rank(KAIGO, b) < rank(KAIGO, a) ? b : a), nums[0])
}

// ── 表を行×セルに開く（rowspan の引き継ぎは呼び出し側でやる）─────────────
const tables = (html) => [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
  [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]))))

// ★見出しは1行目とは限らない。g-reiki は表の先頭に列幅指定だけの空行（fixed-colspec）を
//   置くので、rows[0] を見出しとみなすと必ず外れる。実測ではこれが最大の取りこぼしだった。
const headIndex = (rows) => {
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    const h = (rows[i] || []).join(' ')
    if (!h.trim()) continue
    if (/認定区分|区分|認定内容|判定基準/.test(h) && /基準|自立度|状態|程度|要介護/.test(h)) return i
  }
  return -1
}
// 改正履歴の表（◆◇ + 年月日 + 告示第N号）。基準表ではないが、いつ変えたかが判る。
const isHistory = (rows) => rows.length > 0 && rows.every((r) => r.length >= 2 && /[◆◇]/.test(r[0] || ''))

const recs = []
const tally = { 読めた: 0, '要確認(順序が逆転)': 0, 基準表が本文に無い: 0, 表が読めない: 0 }
for (const row of src.rows) {
  const p = path.join(CACHE, row._cache)
  if (!fs.existsSync(p)) continue
  const html = fs.readFileSync(p, 'utf8')
  const tbs = tables(html)

  const hist = tbs.filter(isHistory).flat()
    .map((r) => ({ date: r[1], number: r[2] || '' })).filter((x) => x.date)

  // 基準表＝見出しが取れて、かつ表のどこかに「特別障害者」が出てくるもの。
  // 末尾の凡例表（ランクの説明）は見出しが違うので、これで自然に外れる。
  let crit = null, critHead = -1
  for (const tb of tbs) {
    const hi = headIndex(tb)
    if (hi < 0) continue
    if (!/特別障害者/.test(tb.flat().join(' '))) continue
    crit = tb; critHead = hi; break
  }
  const res = { shogai: {}, tokubetsu: {} }
  let status = '基準表が本文に無い'
  if (crit) {
    status = '読めた'
    let cur = null
    for (const r of crit.slice(critHead + 1)) {
      if (!r.length) continue
      // 先頭セルが区分名ならそれを採用。空／継続なら直前の区分を引き継ぐ（rowspan）。
      if (/特別障害者/.test(r[0])) cur = 'tokubetsu'
      else if (/障害者/.test(r[0])) cur = 'shogai'
      if (!cur) continue
      const cell = r.slice(1).join(' ')
      const n = readNinchi(cell), k = readNetakiri(cell), g = readKaigo(cell)
      const t = res[cur]
      if (n && (!t.ninchi || rank(NINCHI, n) < rank(NINCHI, t.ninchi))) t.ninchi = n
      if (k && (!t.netakiri || rank(NETAKIRI, k) < rank(NETAKIRI, t.netakiri))) t.netakiri = k
      if (g && (!t.kaigo || rank(KAIGO, g) < rank(KAIGO, t.kaigo))) t.kaigo = g
    }
    if (!Object.keys(res.shogai).length && !Object.keys(res.tokubetsu).length) status = '表が読めない'
  }

  // ★表で取れない例規は、地の文に書いていることがある。大都市レーンで効いた手を
  //   例規レーンにも当てる。実測で、残った168件のうち117件は本文にランク記号がある。
  //   埋まった数が多いほうを採る（表で1つだけ当たった時点で打ち切らない）。
  const score = (r) => ['shogai', 'tokubetsu'].reduce((a, k) => a + Object.keys(r[k] || {}).length, 0)
  if (score(res) < 4) {
    const plain = libClean(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/>/gi, ' ')
      .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, ' ').replace(/<[^>]+>/g, ''))
    const rt = criteriaFromText(plain)
    if (score(rt) > score(res)) { res.shogai = rt.shogai; res.tokubetsu = rt.tokubetsu; status = '読めた(本文の文章から)' }
  }

  // ★不変条件：障害者の下限は、特別障害者の下限より軽い（か同じ）はず。
  //   特別障害者のほうが重い状態を指すのだから、これが逆転していたら読み間違えている。
  //   件数では気づけない種類の壊れ方なので、必ずここで弾く。[[same-question-two-answers]]
  //   弾いたものは捨てずに「要確認」として残し、原文リンクだけ出す。
  if (/読めた/.test(status)) {
    const flip = []
    for (const [k, list] of [['ninchi', NINCHI], ['netakiri', NETAKIRI], ['kaigo', KAIGO]]) {
      const a = res.shogai[k], b = res.tokubetsu[k]
      if (a && b && rank(list, a) > rank(list, b)) flip.push(k)
    }
    if (flip.length) { status = '要確認(順序が逆転)'; res._flip = flip }
  }
  tally[status] = (tally[status] || 0) + 1
  recs.push({
    code: row.municipality_id, pref: row.prefecture, city: row.city, type: row.municipality_type,
    reikiTitle: row.title, reikiType: row.type,
    announced: (row.announcement_date || '').slice(0, 10), updated: (row.last_updated_date || '').slice(0, 10),
    amendments: hist.length, sourceUrl: row.original_url,
    status,
    shogai: Object.keys(res.shogai).length ? res.shogai : null,
    tokubetsu: Object.keys(res.tokubetsu).length ? res.tokubetsu : null,
  })
}

fs.writeFileSync(path.join(OUT, 'records.json'), JSON.stringify({ parsedAt: new Date().toISOString(), count: recs.length, tally, records: recs }, null, 1))

// ── 読める形の報告（コンソールは日本語を出せないのでファイルに書く）──────────
const L = [`対象 ${recs.length}件`, '', '-- 読み取りの内訳 --']
for (const [k, v] of Object.entries(tally)) L.push(`  ${k}: ${v}`)
const ok = recs.filter((r) => r.status === '読めた')
const dist = (label, sel) => {
  const d = {}
  for (const r of ok) { const k = sel(r) || '(この物差しは使っていない)'; d[k] = (d[k] || 0) + 1 }
  L.push('', `-- ${label} --`)
  for (const [k, v] of Object.entries(d).sort((a, b) => b[1] - a[1])) L.push(`  ${String(k).padEnd(24)} ${v}`)
}
dist('特別障害者になる 認知症度の下限', (r) => r.tokubetsu?.ninchi)
dist('特別障害者になる 寝たきり度の下限', (r) => r.tokubetsu?.netakiri)
dist('特別障害者になる 要介護度の下限', (r) => r.tokubetsu?.kaigo)
dist('障害者になる 認知症度の下限', (r) => r.shogai?.ninchi)
dist('障害者になる 要介護度の下限', (r) => r.shogai?.kaigo)
L.push('', '-- 見本25件 --')
const f = (o) => o ? [o.kaigo, o.ninchi ? '認' + o.ninchi : null, o.netakiri ? '寝' + o.netakiri : null].filter(Boolean).join('/') || '—' : '—'
for (const r of ok.slice(0, 25)) L.push(`  ${(r.pref + r.city).padEnd(12)} 障害者:${f(r.shogai).padEnd(20)} 特別:${f(r.tokubetsu).padEnd(20)} 改正${r.amendments}回`)
fs.writeFileSync(path.join(OUT, 'parse-report.txt'), L.join('\n'))
console.log(`records=${recs.length} -> data/shogai-kojo/records.json / parse-report.txt`)
