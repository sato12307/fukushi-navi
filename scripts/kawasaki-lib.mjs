// ─────────────────────────────────────────────────────────────────────────────
// kawasaki-lib.mjs — 川崎市営住宅の読み取り結果を、住宅×募集区分ごとに畳むところまで。
//
// ★都営（scripts/toei-lib.mjs）と同じ考え方だが、**写経ではなく別物**。
//   資料の作りが違うので、同じにできない所がある。混ぜないために理由を書いておく。
//     ・川崎の応募状況表には **区（7区）が入っていない**。住宅名だけ。
//       ∴ 都営の「区市町ごとの相場」に当たるものが作れない。代わりに
//       **募集区分ごとの相場**を軸にする（区は住宅名から引けたら後で足す）。
//     ・川崎は「新築／空家」という種別があり、同じ住宅名でも別物として募集される。
//       ∴ 名寄せの鍵は **住宅名 × 種別 × 募集区分** の3つ。
//     ・エレベーター・建築年・間取りは資料に無い（都営にはある）。出せないものは出さない。
//
// ★入力は data/kawasaki-bairitsu.json（.gitignore 済み）。
//   node scripts/kawasaki-fetch.mjs → python scripts/kawasaki-parse.py で作る。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'data', 'kawasaki-bairitsu.json')
if (!fs.existsSync(SRC)) {
  console.error('data/kawasaki-bairitsu.json がありません（公開していない中間ファイルです）。')
  console.error('  node scripts/kawasaki-fetch.mjs && python scripts/kawasaki-parse.py で作ってください。')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))

export const MIN_N = 4        // これ未満の観測しかない申込先は「毎回」と言えないので狙い目に出さない
export const SUKI = 5         // 中央値がこれ未満なら「すいている」
export const BURE = 10        // 最高が最低のこれ倍以上なら「回によって動く」
export const MIN_CAT = 5      // 募集区分ごとの相場は、対象の申込先がこれ以上ある区分だけ出す
export const PRICE = 500
export const SRC_NAME = '川崎市が募集回ごとに公表する「市営住宅入居者募集に係る抽選結果」の応募状況表PDF'
export const INDEX_URL = raw.index
export const READ_AT = raw.updated

export const rows = raw.rows
export const ledger = raw.ledger
export const ROUNDS = [...new Set(rows.map((r) => r.round))].sort()

export const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
export const r1 = (x) => Math.round(x * 10) / 10
export const num = (x) => Number(x).toLocaleString('ja-JP')
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
// 回キー 2026-06 → 令和8年6月（資料も募集案内も和暦なので、読者が突き合わせられるようそろえる）
//   ★令和1年ではなく令和元年。公表資料がそう書いている。
export const WA = (r) => {
  const y = Number(r.slice(0, 4)) - 2018
  return `令和${y === 1 ? '元' : y}年${Number(r.slice(5))}月`
}

// ── 住宅名をそろえる ────────────────────────────────────────────────────────
//   ★回によって全角と半角が混ざる。「大島（1DK）」と「大島（１ＤＫ）」、
//     「南平（EVなし）」と「南平（ＥＶなし）」が別の住宅として数えられていた。
//     実測で **113組・住宅名359→226** に減る。名寄せが割れると中央値が分かれ、
//     「毎回すいている」という判定そのものが壊れる。[[zenkabu-atokabu-uniqueness]]
//   ★NFKCで畳むだけにする。間取り（2DK/3DK）は**落とさない**。
//     同じ団地でも間取りが違えば別の住戸で、倍率もまるで違うため。
//     「南平」と「南平(EVなし)」も別のまま残す（別の棟）。
export const normName = (s) => String(s).normalize('NFKC').replace(/[\s　]/g, '')
// 名前に入っている属性を取り出す（資料に列としては無いが、住宅名に書かれている）
const MADORI = /\(?([0-9][A-Z]{1,3})\)?/
export const attrOf = (name) => ({
  ev: /EVなし/i.test(name) ? '無' : '',
  madori: (MADORI.exec(name) || [])[1] || '',
})

// ★申込者ゼロの判定はこの1本だけ。応募者数が0の行。
//   都営では「申込者数と倍率がともに0」で見たが、川崎は倍率を当方で計算しているので
//   応募者数だけで決まる（ずれる列を読んでいないぶん、ここは素直）。
export const isZero = (r) => r.moushikomi === 0

// ── 住宅×種別×募集区分ごとに畳む ────────────────────────────────────────────
//   ★鍵に種別と募集区分を入れる。同じ住宅名でも「新築の子育て世帯向」と
//     「空家の単身者向」では倍率がまるで違い、混ぜて中央値を取ると別物になる。
//     申し込む側も区分を選んで出すので、区分ごとに数えるのが読者の使い方に合う。
const by = new Map()
for (const r of rows) {
  const k = `${normName(r.name)}|${r.kind}|${r.cat}`
  if (!by.has(k)) by.set(k, [])
  by.get(k).push(r)
}
export const houses = [...by.entries()].map(([k, v]) => {
  const [name, kind, cat] = k.split('|')
  const b = v.map((x) => x.bairitsu)
  return {
    name, kind, cat, ...attrOf(name),
    code: v[v.length - 1].code,
    n: v.length,                                   // 観測できた募集件数（回数ではない）
    rounds: new Set(v.map((x) => x.round)).size,
    med: med(b), min: Math.min(...b), max: Math.max(...b),
    koho: v.reduce((a, x) => a + x.koho, 0),
    zero: v.filter(isZero).length,
    last: v.map((x) => x.round).sort().pop(),
  }
}).sort((a, b2) => a.med - b2.med || b2.n - a.n)

export const enough = houses.filter((h) => h.n >= MIN_N)
export const suki = enough.filter((h) => h.med < SUKI)
export const buread = enough.filter((h) => h.min > 0 && h.max >= h.min * BURE)
export const konde = enough.slice().sort((a, b2) => b2.med - a.med)
export const ALL_MED = med(enough.map((h) => h.med))

// ── 募集区分ごとの相場（無料ページの軸。都営の「区市町ごと」に当たるもの）────
export const CATS = [...new Set(rows.map((r) => `${r.kind}|${r.cat}`))].map((k) => {
  const [kind, cat] = k.split('|')
  const rs = rows.filter((r) => r.kind === kind && r.cat === cat)
  const hs = enough.filter((h) => h.kind === kind && h.cat === cat)
  return {
    kind, cat, label: `${kind}／${cat}`,
    n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
    med: r1(med(rs.map((x) => x.bairitsu))),
    zero: rs.filter(isZero).length,
    houses: hs.length,
    suki: hs.filter((h) => h.med < SUKI).length,
    rounds: new Set(rs.map((r) => r.round)).size,
  }
}).sort((a, b2) => a.med - b2.med)

// ── 回ごと ──────────────────────────────────────────────────────────────────
export const BY_ROUND = ROUNDS.map((round) => {
  const rs = rows.filter((r) => r.round === round)
  return {
    round, n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
    moushikomi: rs.reduce((a, x) => a + x.moushikomi, 0),
    med: r1(med(rs.map((x) => x.bairitsu))),
    zero: rs.filter(isZero).length,
  }
})

// ── 数字は1か所で作る（無料ページと有料資料で違う数を出さないため）────────────
export const F = {
  rows: rows.length,
  rounds: ROUNDS.length,
  all: houses.length,
  enough: enough.length,
  allMed: r1(ALL_MED),
  suki: suki.length,
  sukiPct: Math.round((suki.length / enough.length) * 100),
  buread: buread.length,
  zeroRows: rows.filter(isZero).length,
  zeroHouses: new Set(rows.filter(isZero).map((r) => normName(r.name))).size,
  cats: CATS.length,
  from: ROUNDS[0], to: ROUNDS[ROUNDS.length - 1],
  // 読み取りの限界を面に出すための数字
  usedRounds: ledger.filter((l) => l.used).length,
  skippedRounds: ledger.filter((l) => !l.used).map((l) => l.round),
  matched: ledger.filter((l) => l.match).length,
  explained: ledger.filter((l) => l.used && l.match === false && l.explained).length,
  noNameRows: ledger.reduce((a, l) => a + ((l.noName && l.noName.rows) || 0), 0),
  noNameKoho: ledger.reduce((a, l) => a + ((l.noName && l.noName.koho) || 0), 0),
}
export const RANGE = `${WA(F.from)}〜${WA(F.to)}`
