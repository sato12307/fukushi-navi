// ─────────────────────────────────────────────────────────────────────────────
// houkatsu-lib.mjs — 担当区域の自由文を「町丁目 × 但し書き」へ展開する。
//
// ★ここが一番事故る場所なので独立させた
//   自治体は担当区域を1つの文で書く。例（大田区）:
//     「大森中1丁目1～21番、大森中2丁目1～12番・19～24番、大森中3丁目1～5番・9～36番、大森東1～3丁目」
//   これを町丁目キーへ割るとき、
//     (a) 丁目のレンジ（1～3丁目）を展開し損ねると面が欠ける
//     (b) 番地の但し書き（1～21番）を落とすと、丁目の一部しか担当していないのに
//         全部を担当しているように見える＝**実名の隣に嘘が並ぶ**
//   艦隊で6回再発している事故型なので、但し書きは必ず持ち回り、
//   1つの町丁目に複数センターが当たったら畳まずに全部残す。[[same-question-two-answers]]
//
// ★キーは漢数字に寄せる
//   自治体の表記は「大森中1丁目」、国勢調査の小地域（living-environments が持つ町丁目）は
//   「大森中一丁目」。突合するので内部キーは漢数字に正規化する。表示は原文のまま。
// ─────────────────────────────────────────────────────────────────────────────

const KAN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** 1..40 を漢数字へ。40を超える丁目は実在しないので数字のまま返す */
export function kanji(n) {
  if (n <= 10) return KAN[n]
  if (n < 20) return '十' + KAN[n - 10]
  if (n % 10 === 0 && n < 100) return KAN[n / 10] + '十'
  if (n < 100) return KAN[Math.floor(n / 10)] + '十' + KAN[n % 10]
  return String(n)
}

/** 漢数字（一〜九十九）を数値へ。丁目の表記ゆれ吸収用 */
export function num(k) {
  if (/^\d+$/.test(k)) return Number(k)
  const one = (c) => KAN.indexOf(c)
  if (!k.includes('十')) return one(k) || 0
  const [a, b] = k.split('十')
  return (a ? one(a) : 1) * 10 + (b ? one(b) : 0)
}

/** 町名＋丁目番号 → 突合キー（「大森中一丁目」） */
export function townKey(town, chome) {
  return chome ? `${town}${kanji(chome)}丁目` : town
}

/**
 * 町名の掃除。
 * ★「羽田旭町全域」のような接尾語を落とす。付けたままにすると存在しない町名になり、
 *   国勢調査の町丁目（living-environments 側）とも突合できなくなる。
 */
function cleanTown(t) {
  return String(t).replace(/[（(].*$/, '').replace(/(全域|地内|の全部)$/, '').trim()
}

/**
 * 担当区域の自由文を展開する。
 * 返り値: [{ town, chome, note }] — chome は数値(丁目) か null、note は番地の但し書き
 */
export function expandArea(text) {
  if (!text) return []
  const out = []
  // 「・」は列挙にも範囲の区切りにも使われるので、まず読点系で割る。
  // ★先に行政の器（特別出張所・地域センターの管内）を落とす。これを町名として拾うと
  //   「大森西特別出張所 管内のうち」という存在しない町丁目が生まれる。
  const chunks = String(text)
    .replace(/[（(]/g, '（').replace(/[）)]/g, '）')
    .replace(/[^、,，]*?(?:特別出張所|出張所|地域センター)\s*管内(?:のうち)?/g, '')
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    // ★番地だけの断片は、直前の町丁目の続き。
    //   例「池上3丁目12番、13番6～11号、21～41番」の後ろ2つは池上三丁目にかかる。
    //   独立した町名として拾うと「13番6～11号」という町丁目が生まれてしまう。
    if (/^[0-9０-９]+[^ぁ-んァ-ヶ一-鿿]*$/.test(chunk.replace(/[番号丁目～~\-・のから終り]/g, '')) &&
        /[番号]/.test(chunk) && !/丁目/.test(chunk)) {
      const prev = out[out.length - 1]
      if (prev) prev.note = prev.note ? `${prev.note}・${chunk}` : chunk
      continue
    }
    // 但し書き（番地）を切り離す。「1～21番」「18番」「1番～49番」「33番1～9」など
    // 丁目より後ろに現れる番地表現をまとめて note にする
    const mBanchi = /丁目(.*)$/.exec(chunk)
    const tail = mBanchi ? mBanchi[1].trim() : ''
    const note = /[0-9０-９]/.test(tail) && /番|号|～/.test(tail) ? tail.replace(/^[・･]/, '') : ''

    // 丁目のレンジ: 「大森東1～3丁目」「代田1～3」
    let m = /^(.+?)([0-9０-９]+)\s*[～~－ー-]\s*([0-9０-９]+)\s*丁目/.exec(chunk)
    if (m) {
      const town = m[1].trim()
      for (let i = z2h(m[2]); i <= z2h(m[3]); i++) out.push({ town: cleanTown(town), chome: i, note })
      continue
    }
    // 漢数字レンジ: 「上島（一丁目～七丁目）」
    m = /^(.+?)（?\s*([一二三四五六七八九十]+)丁目\s*[～~-]\s*([一二三四五六七八九十]+)丁目/.exec(chunk)
    if (m) {
      const town = m[1].replace(/（$/, '').trim()
      for (let i = num(m[2]); i <= num(m[3]); i++) out.push({ town: cleanTown(town), chome: i, note })
      continue
    }
    // 中黒の列挙: 「駒沢1・2」「京町1・2丁目」
    m = /^(.+?)((?:[0-9０-９]+[・･])+[0-9０-９]+)\s*丁目?/.exec(chunk)
    if (m) {
      const town = m[1].trim()
      for (const d of m[2].split(/[・･]/)) out.push({ town: cleanTown(town), chome: z2h(d), note })
      continue
    }
    // 単独の丁目: 「大森中1丁目1～21番」「若林3丁目」
    m = /^(.+?)([0-9０-９]+)\s*丁目/.exec(chunk)
    if (m) { out.push({ town: cleanTown(m[1]), chome: z2h(m[2]), note }); continue }
    m = /^(.+?)([一二三四五六七八九十]+)丁目/.exec(chunk)
    if (m) { out.push({ town: cleanTown(m[1]), chome: num(m[2]), note }); continue }

    // 丁目を持たない町名（千葉市・浜松市はこの形が主）。
    // ★丁目が無くても番地条件は付く（例「北嶺町1番8～17号」）。
    //   切り離さないと「北嶺町1番8～17号」という町名が生まれる。
    const bare = chunk.replace(/（[^）]*）/g, '').trim()
    const mBare = /^(.+?[^0-9０-９])([0-9０-９][0-9０-９～~\-・番号]*)$/.exec(bare)
    if (mBare && /[番号]/.test(mBare[2])) {
      out.push({ town: cleanTown(mBare[1]), chome: null, note: mBare[2] })
      continue
    }
    const t = cleanTown(bare)
    if (t && !/^[0-9０-９]+$/.test(t)) out.push({ town: t, chome: null, note: '' })
  }
  return out
}

function z2h(s) { return Number(String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))) }

/**
 * センター配列 → 町丁目キーごとの担当一覧。
 * 1つのキーに複数センターが当たっても畳まない（畳むと嘘になる）。
 */
export function byTown(centers) {
  const map = new Map()
  for (const c of centers) {
    for (const a of c.areas || []) {
      const key = townKey(a.town, a.chome)
      if (!map.has(key)) map.set(key, { key, town: a.town, chome: a.chome, hits: [] })
      map.get(key).hits.push({ center: c.name, note: a.note || '', ward: c.ward || null })
    }
  }
  for (const v of map.values()) {
    // 同じセンターが複数回出たら但し書きを束ねる
    const merged = new Map()
    for (const h of v.hits) {
      if (!merged.has(h.center)) merged.set(h.center, { center: h.center, ward: h.ward, notes: [] })
      if (h.note) merged.get(h.center).notes.push(h.note)
    }
    v.hits = [...merged.values()]
    // ★2つを分けて持つ。混ぜると仙台のように「ほぼ全部が分割」と出て意味を失う。
    //   multi   = 担当が2つ以上に割れている（読者にとって一番大事な事実）
    //   hasNote = 番地・住居表示番号の但し書きが付いている
    v.multi = v.hits.length > 1
    v.hasNote = v.hits.some((h) => h.notes.length > 0)
  }
  return map
}
