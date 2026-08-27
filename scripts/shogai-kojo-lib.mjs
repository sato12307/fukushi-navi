// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-lib.mjs — 障害者控除対象者認定の「基準の読み取り」を1か所に集めたもの。
//
// ★なぜ切り出したか
//   基準表はHTMLの中にある場合と、別表としてRTF/DOCXで添付されている場合がある。
//   入口が2つあるからといって判定を2回書くと、必ずずれる。艦隊で6回再発した型。
//   [[same-question-two-implementations]] ∴ **入口だけ2つ、判定は1つ。**
//   どちらの入口も「行×セルの二次元配列」に変換してから、この関数に渡す。
//
// ★読み取るのは全国共通の3つの物差しだけ
//   (1) 障害高齢者の日常生活自立度（寝たきり度）… J1 J2 A1 A2 B1 B2 C1 C2
//   (2) 認知症高齢者の日常生活自立度（認知症度）… Ⅰ Ⅱa Ⅱb Ⅲa Ⅲb Ⅳ M
//   (3) 要介護度 … 要支援1〜2／要介護1〜5
//   厚労省の通知で定義が全国共通なので、自治体をまたいで比較できる。ここまでが限界。
// ─────────────────────────────────────────────────────────────────────────────

import zlib from 'node:zlib'

export const NETAKIRI = ['J1', 'J2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
export const NINCHI = ['Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M']
export const KAIGO = ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5']
export const rank = (list, v) => list.indexOf(v)

// 「障がい者」「障碍者」表記が全国で混在する。一本化しないとひらがな表記の自治体を
// 丸ごと読み落とす（実測でこれが取りこぼしの主因のひとつだった）。
export const normWord = (s) => String(s).replace(/障(?:がい|碍)/g, '障害')
export const zen = (s) => String(s).replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
export const clean = (s) => normWord(zen(String(s)))
  .replace(/&nbsp;| |　/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

// 「Ⅱa以上」「Ⅲa、Ⅲb、Ⅳ、M」「A1以上」から、最も軽い（＝対象になりやすい）値を取る。
const lowest = (cell, list, re, norm) => {
  const found = []
  for (const m of cell.matchAll(re)) { const v = norm(m); if (v && list.includes(v)) found.push(v) }
  if (!found.length) return null
  return found.reduce((a, b) => (rank(list, b) < rank(list, a) ? b : a))
}
// ★ローマ数字の書き方が3通りある。読む前に glyph へ寄せる。
//   (1) 全角の Ⅰ Ⅱ Ⅲ Ⅳ            … そのまま
//   (2) ラテン文字の I II III IV     … 奄美市「認知症度がIV又はMの者」など。実在する
//   (3) 「ローマ数字の3」という日本語 … 大田区。これも実在する
//   ここを吸収しないと、その自治体だけ静かに「基準なし」になる。長い順に置換すること
//   （IV より先に I を置換すると壊れる）。
export const romanize = (s) => String(s ?? '')
  .replace(/ローマ数字の?\s*([1-4])/g, (_, n) => ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'][Number(n)])
  .replace(/(?<![A-Za-z])IV(?![A-Za-z])/g, 'Ⅳ')
  .replace(/(?<![A-Za-z])III(?![A-Za-z])/g, 'Ⅲ')
  .replace(/(?<![A-Za-z])II(?![A-Za-z])/g, 'Ⅱ')
  .replace(/(?<![A-Za-z])I(?![A-Za-zVX])/g, 'Ⅰ')

export const readNinchi = (raw) => lowest(romanize(raw), NINCHI, /(Ⅰ|Ⅱ|Ⅲ|Ⅳ|M|Ｍ)\s*([ab])?/g, (m) => {
  const v = m[1] === 'Ｍ' ? 'M' : m[1]
  if (v === 'M' || v === 'Ⅰ' || v === 'Ⅳ') return v
  return v + (m[2] || 'a')      // Ⅱ・Ⅲ を単独で書く例規は a と同じ扱い（軽いほう）
})
export const readNetakiri = (cell) => lowest(cell, NETAKIRI, /\b([JABC])\s*([12])?/g, (m) => m[1] + (m[2] || '1'))
export const readKaigo = (cell) => {
  const nums = []
  for (const m of cell.matchAll(/(要介護|要支援)\s*([1-5])(?:\s*(?:～|〜|から|又は|・|、)\s*([1-5]))?/g)) {
    nums.push(m[1] + m[2]); if (m[3]) nums.push(m[1] + m[3])
  }
  const ok = nums.filter((v) => KAIGO.includes(v))
  if (!ok.length) return null
  return ok.reduce((a, b) => (rank(KAIGO, b) < rank(KAIGO, a) ? b : a))
}

// ★見出しは1行目とは限らない。g-reiki は表の先頭に列幅指定だけの空行（fixed-colspec）を
//   置くので、rows[0] を見出しとみなすと必ず外れる。実測ではこれが最大の取りこぼしだった。
// ★語の中に空白を入れる例規がある（「区 分」「障 害 者」「認 定」）。
//   見出し語も区分名も、比較の前に空白を全部落とす。これを忘れると
//   その自治体だけ丸ごと読めない。実測で16件がこれだけの理由で落ちていた。
export const tight = (s) => String(s ?? '').replace(/[\s　]/g, '')

export const headIndex = (rows) => {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const h = tight((rows[i] || []).join(' '))
    if (!h) continue
    if (/認定区分|区分|認定内容|判定基準|判断基準|認定の基準|認定種別/.test(h) &&
      /基準|自立度|状態|程度|要介護|定義/.test(h)) return i
  }
  return -1
}

// ── 行×セルの表から、障害者／特別障害者それぞれの下限を読む ─────────────────
//   認定区分のセルは rowspan で縦に結合されているので、**区分名が無い行は直前を引き継ぐ**。
//   これを忘れると特別障害者の行が障害者に混ざる（実際に起きた）。
export function criteriaFromRows(rows, headAt) {
  const res = { shogai: {}, tokubetsu: {} }
  let cur = null
  for (const r of rows.slice(headAt + 1)) {
    if (!r || !r.length) continue
    const head = tight(r[0] || '')
    // ★条番号で区分を書く例規が多い。所得税法施行令第10条の
    //   **第1項が障害者・第2項が特別障害者**の範囲を定めている（法の建て付け）。
    //   「障害者」「特別障害者」という語を一度も使わずに条番号だけで書く要綱があり、
    //   これを読めないと鹿児島・熊本あたりがごっそり落ちる。
    if (/特別障害者/.test(head) || /所得税法施行令第10条第2項/.test(head)) cur = 'tokubetsu'
    else if (/障害者/.test(head) || /所得税法施行令第10条第1項/.test(head)) cur = 'shogai'
    if (!cur) continue
    const cell = r.slice(1).join(' ')
    const t = res[cur]
    // ★どの物差しの話なのかを確かめてから読む。
    //   寝たきり度は J/A/B/C の1文字なので、無関係な英字を拾いやすい。実測で
    //   ニセコ町・倶知安町・蘭越町・喜茂別町が「特別障害者＝J1」という
    //   ありえない値になっていた（凡例のJが混じっていた）。
    //   文脈語は行全体で見る（見出し列に物差し名、値の列にランクだけ、という表がある）。
    const ctx = r.join(' ')
    const n = /認知症|痴呆/.test(ctx) ? readNinchi(cell) : null
    const k = /障害高齢者|寝たきり|ねたきり|臥床/.test(ctx) ? readNetakiri(cell) : null
    const g = readKaigo(cell)
    if (n && (!t.ninchi || rank(NINCHI, n) < rank(NINCHI, t.ninchi))) t.ninchi = n
    if (k && (!t.netakiri || rank(NETAKIRI, k) < rank(NETAKIRI, t.netakiri))) t.netakiri = k
    if (g && (!t.kaigo || rank(KAIGO, g) < rank(KAIGO, t.kaigo))) t.kaigo = g
  }
  return res
}

// ★不変条件：障害者の下限は、特別障害者の下限より軽い（か同じ）はず。
//   特別障害者のほうが重い状態を指すのだから、逆転していたら読み間違えている。
//   件数では気づけない壊れ方なので、公開の前に必ず通す。[[same-question-two-answers]]
export function flipped(res) {
  const bad = []
  for (const [k, list] of [['ninchi', NINCHI], ['netakiri', NETAKIRI], ['kaigo', KAIGO]]) {
    const a = res.shogai?.[k], b = res.tokubetsu?.[k]
    if (a && b && rank(list, a) > rank(list, b)) bad.push(k)
  }
  return bad
}

export const hasAny = (o) => !!o && Object.keys(o).length > 0

// ── 地の文から読む（大都市のWebページ用）────────────────────────────────────
// 例規は表で書くが、大都市のふつうのWebページは文章で書いていることが多い。
//   例（大田区）「〇特別障害者に準ずる者 …『認知症高齢者の日常生活自立度』の
//                ランクが、ローマ数字の3から5とみなされる者」
// ローマ数字の寄せ方は上の romanize に1つだけ置いてある（表からも文章からも同じものを使う）。

export function criteriaFromText(rawText) {
  const t = romanize(clean(rawText))
  // ★「ただし、特別障害者に準ずる者を除く。」は見出しではなく除外文。
  //   これを区分の見出しとして拾うと、そのすぐ後ろにある**障害者側の基準を
  //   特別障害者に付けてしまう**。実際に大田区で、障害者の「ローマ数字2以上」を
  //   特別障害者の基準として出しかけた。直後に「除く」が来る出現は捨てる。
  const isExclusion = (at, len) => /除く|除きます|を除いた/.test(t.slice(at + len, at + len + 12))
  const marks = []
  for (const m of t.matchAll(/特別障害者(?:に準ずる|と同様|に該当)/g)) if (!isExclusion(m.index, m[0].length)) marks.push([m.index, 'tokubetsu'])
  for (const m of t.matchAll(/(?<!特別)障害者(?:に準ずる|と同様|に該当)/g)) if (!isExclusion(m.index, m[0].length)) marks.push([m.index, 'shogai'])
  // 「特別障害者の認定基準」「障害者の認定基準」という素直な見出しも拾う。
  for (const m of t.matchAll(/特別障害者の(?:認定)?基準/g)) marks.push([m.index, 'tokubetsu'])
  for (const m of t.matchAll(/(?<!特別)障害者の(?:認定)?基準/g)) marks.push([m.index, 'shogai'])

  // ★条番号で区分を指す型。所得税法施行令第10条は
  //   **第1項が障害者・第2項が特別障害者**の範囲を定めている（法の建て付け）。
  //   「(1) 所得税法施行令第10条第2項第3号…に該当するものは、寝たきり度がB1…の者とする。」
  //   のように、区分名を一度も書かずに条番号で指す要綱が全国にかなりある。
  //
  //   ★ただし**条番号を文末に置く型がある**。
  //     「(2) 特別障害者の認定基準 …ランクB以上… 所得税法施行令第10条第2項…に掲げる者」
  //     この型で条番号を見出しとして使うと、**次の区分の基準を拾って前後が入れ替わる**。
  //     実測でニセコ町・倶知安町・蘭越町・喜茂別町が丸ごと逆転した。
  //   ∴ **条番号は、素直な見出しが1つも無いときだけの最後の手段**にする。
  if (!marks.length) {
    for (const m of t.matchAll(/所得税法施行令第10条第([12])項/g)) {
      marks.push([m.index, m[1] === '2' ? 'tokubetsu' : 'shogai'])
    }
  }
  marks.sort((a, b) => a[0] - b[0])
  if (!marks.length) return { shogai: {}, tokubetsu: {} }
  const res = { shogai: {}, tokubetsu: {} }
  for (let i = 0; i < marks.length; i++) {
    const [at, who] = marks[i]
    // 次の見出しまで、無ければ600字まで。区分の切れ目を跨いで拾わないための上限。
    const end = i + 1 < marks.length ? marks[i + 1][0] : Math.min(t.length, at + 600)
    const seg = t.slice(at, end)
    const target = res[who]
    const n = readNinchi(/認知症|痴呆/.test(seg) ? seg : ''), k = readNetakiri(/障害高齢者|寝たきり/.test(seg) ? seg : ''), g = readKaigo(seg)
    if (n && (!target.ninchi || rank(NINCHI, n) < rank(NINCHI, target.ninchi))) target.ninchi = n
    if (k && (!target.netakiri || rank(NETAKIRI, k) < rank(NETAKIRI, target.netakiri))) target.netakiri = k
    if (g && (!target.kaigo || rank(KAIGO, g) < rank(KAIGO, target.kaigo))) target.kaigo = g
  }
  return res
}

// ── HTML を「行×セル」にする ────────────────────────────────────────────────
export const tablesFromHtml = (html) => [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
  [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1].replace(/<[^>]+>/g, '')))))

// ── RTF を行×セルにする ────────────────────────────────────────────────────
// RTF の日本語は \'xx の連続（既定 cp932）か \uNNNN で入る。表は \cell / \row。
// 連続する \'xx はまとめて復号しないと2バイト文字が壊れる。
export function rtfToRows(rtf) {
  const out = []            // セルの並び
  let row = [], cell = ''
  let bytes = []
  const flushBytes = () => {
    if (!bytes.length) return
    cell += new TextDecoder('shift_jis', { fatal: false }).decode(Uint8Array.from(bytes))
    bytes = []
  }
  let skipDepth = 0         // {\*\... } の読み飛ばし
  let depth = 0
  let uSkip = 0             // \uN の直後に置かれる代替文字の数
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i]
    if (c === '{') { depth++; if (rtf.startsWith('{\\*', i) && !skipDepth) skipDepth = depth; continue }
    if (c === '}') { if (skipDepth && depth === skipDepth) skipDepth = 0; depth--; continue }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)?/.exec(rtf.slice(i))
      if (rtf[i + 1] === "'") { bytes.push(parseInt(rtf.substr(i + 2, 2), 16)); i += 3; continue }
      if (rtf[i + 1] === '\\' || rtf[i + 1] === '{' || rtf[i + 1] === '}') { flushBytes(); cell += rtf[i + 1]; i++; continue }
      if (!m) continue
      const w = m[1], n = m[2] ? Number(m[2]) : null
      i += m[0].length - 1
      if (rtf[i + 1] === ' ') i++
      if (skipDepth) continue
      flushBytes()
      if (w === 'u' && n != null) { cell += String.fromCharCode(n < 0 ? n + 65536 : n); uSkip = 1; continue }
      if (w === 'cell' || w === 'nestcell') { row.push(clean(cell)); cell = ''; continue }
      if (w === 'row' || w === 'nestrow') { if (row.length) out.push(row); row = []; cell = ''; continue }
      if (w === 'par' || w === 'line') { cell += ' '; continue }
      continue
    }
    if (skipDepth) continue
    if (uSkip > 0 && c !== '\n' && c !== '\r') { uSkip--; continue }
    if (c === '\n' || c === '\r') continue
    flushBytes()
    cell += c
  }
  flushBytes()
  if (cell.trim()) row.push(clean(cell))
  if (row.length) out.push(row)
  return out
}

// ── DOCX（zip）から word/document.xml を取り出して行×セルにする ─────────────
// 依存を増やしたくないので zip は最小限だけ自前で読む。中央ディレクトリを末尾から探す。
export function unzipEntry(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) return null
  let off = buf.readUInt32LE(eocd + 16)
  const total = buf.readUInt16LE(eocd + 10)
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return null
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const cmtLen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const fname = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (fname === name) {
      const method = buf.readUInt16LE(lho + 8)
      const csize = buf.readUInt32LE(lho + 18) || buf.readUInt32LE(off + 20)
      const nl = buf.readUInt16LE(lho + 26), el = buf.readUInt16LE(lho + 28)
      const start = lho + 30 + nl + el
      const data = buf.subarray(start, start + csize)
      return method === 0 ? data : zlib.inflateRawSync(data)
    }
    off += 46 + nameLen + extraLen + cmtLen
  }
  return null
}
export function docxToRows(buf) {
  const xml = unzipEntry(buf, 'word/document.xml')
  if (!xml) return []
  const s = xml.toString('utf8')
  return [...s.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((tr) =>
    [...tr[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((tc) =>
      clean([...tc[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(''))))
    .filter((r) => r.length)
}
