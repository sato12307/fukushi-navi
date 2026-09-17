// ─────────────────────────────────────────────────────────────────────────────
// koei-lib.mjs — 政令市の市営住宅の読み取り結果を、申込先ごとに畳むところまで。
//
//   import { load } from './koei-lib.mjs'
//   const D = load('kawasaki')
//
// ★なぜ市ごとに書かないか（2026-09-17）
//   川崎で1本書いたあと、静岡と横浜で同じものを2回写経しかけた。名寄せ・中央値・
//   すいている判定・限界の数え方は3市で同じで、**違うのは軸（どの列で切るか）だけ**。
//   写経すると必ずずれる（片方だけ直る）ので、ここ1本にする。
//   [[same-question-two-implementations]]
//
// ★市ごとに違うのは「軸」と「出典」だけ。それを CITIES に書く。
//   川崎 … 区が資料に無い。種別（新築/空家）と募集区分で切る
//   静岡 … 区（葵・駿河・清水）がある。間取りと階数もある
//   横浜 … 18区と募集区分がある。単身可とエレベーターの印もある
//   ★無い列は作らない。都営で持っている「建てられた年」は3市とも資料に無い。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MIN_N = 4        // これ未満の観測しかない申込先は「毎回」と言えないので狙い目に出さない
export const SUKI = 5         // 中央値がこれ未満なら「すいている」
export const BURE = 10        // 最高が最低のこれ倍以上なら「回によって動く」
export const MIN_GROUP = 5    // 軸ごとの相場は、対象の申込先がこれ以上ある区分だけ出す
export const PRICE = 500

// ── 市ごとの設定 ────────────────────────────────────────────────────────────
//   key      … data/<key>-bairitsu.json と URL の /<key>/ に使う
//   axis     … 相場の表の軸。行の中のどの欄で切るか（label はその見出し）
//   keyOf    … 申込先の名寄せの鍵。ここに入れた欄が違えば別の申込先として数える
//   extra    … 索引の表に足す欄（資料にある分だけ）
export const CITIES = {
  kawasaki: {
    key: 'kawasaki', city: '川崎市', short: '川崎',
    src: '川崎市が募集回ごとに公表する「市営住宅入居者募集に係る抽選結果」の応募状況表PDF',
    // ★区が資料に無い。∴ 区ごとの相場は作れない。軸は募集区分にする。
    axis: { label: '募集区分', of: (r) => `${r.kind}／${r.cat}` },
    keyOf: (r) => [r.name, r.kind, r.cat],
    cols: [['name', '住宅'], ['kind', '種別'], ['cat', '募集区分']],
    note: '同じ住宅でも種別（新築／空家）と募集区分が違えば別に数えています。混ぜると、区分によって安かった住宅が「毎回すいている」に化けるためです。',
  },
  shizuoka: {
    key: 'shizuoka', city: '静岡市', short: '静岡',
    src: '静岡市営住宅（指定管理者サイト s-jutaku.com）が募集回ごとに公表する「空家募集の倍率」PDF',
    // ★静岡は区が資料にある。軸は区。間取りは名寄せの鍵に入れる（同じ団地でも別の住戸）。
    axis: { label: '区', of: (r) => r.ku || '（区なし）' },
    keyOf: (r) => [r.ku, r.name, r.madori],
    cols: [['ku', '区'], ['name', '団地'], ['madori', '間取り']],
    note: '同じ団地でも間取りが違えば別に数えています。募集されるのは住戸単位で、間取りが違えば倍率もまるで違うためです。',
  },
  yokohama: {
    key: 'yokohama', city: '横浜市', short: '横浜',
    src: '横浜市が募集回ごとに公表する記者発表「横浜市営住宅の抽選結果について」の応募状況表PDF',
    // ★横浜は18区と募集区分の両方がある。軸は区（読者が住む場所で選ぶため）。
    axis: { label: '区', of: (r) => r.ku || '（区なし）' },
    keyOf: (r) => [r.ku, r.name, r.cat],
    cols: [['ku', '区'], ['name', '住宅'], ['cat', '募集区分'], ['tanshin', '単身可'], ['ev', 'エレベーター']],
    note: '同じ住宅でも募集区分が違えば別に数えています。単身可（※）とエレベーターの印（□△×）は、資料の凡例にある印を住宅名から切り出したものです。',
  },
}

export const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
export const r1 = (x) => Math.round(x * 10) / 10
export const num = (x) => Number(x).toLocaleString('ja-JP')
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
// 回キー 2026-06 → 令和8年6月。★令和1年ではなく令和元年（公表資料がそう書いている）。
export const WA = (r) => {
  const y = Number(r.slice(0, 4)) - 2018
  return `令和${y === 1 ? '元' : y}年${Number(r.slice(5))}月`
}
// ★住宅名の全角と半角をそろえる。回によって混ざり、「大島（1DK）」と「大島（１ＤＫ）」が
//   別の住宅として数えられていた（川崎で実測113組・住宅名359→226）。名寄せが割れると
//   中央値が分かれ、「毎回すいている」という判定そのものが壊れる。
//   ★間取りは落とさない（同じ団地でも別の住戸で倍率がまるで違う）。
export const normName = (s) => String(s ?? '').normalize('NFKC').replace(/[\s　]/g, '')
// 申込者ゼロ＝応募者数が0の行。倍率は当方で計算しているので、これ1本で決まる。
export const isZero = (r) => r.moushikomi === 0

export function load(key) {
  const C = CITIES[key]
  if (!C) throw new Error(`知らない市です: ${key}`)
  const src = path.join(ROOT, 'data', `${key}-bairitsu.json`)
  if (!fs.existsSync(src)) {
    console.error(`data/${key}-bairitsu.json がありません（公開していない中間ファイルです）。`)
    console.error(`  node scripts/${key}-fetch.mjs && python scripts/${key}-parse.py で作ってください。`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'))
  const rows = raw.rows
  const ledger = raw.ledger || []
  const ROUNDS = [...new Set(rows.map((r) => r.round))].sort()

  // ── 申込先ごとに畳む ──────────────────────────────────────────────────────
  const by = new Map()
  for (const r of rows) {
    const k = C.keyOf(r).map((x) => normName(x)).join('|')
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  const houses = [...by.entries()].map(([k, v]) => {
    const parts = k.split('|')
    const o = {}
    C.keyOf(v[0]).forEach((_, i) => { o[C.cols[i][0]] = parts[i] })
    const b = v.map((x) => x.bairitsu)
    return {
      ...o,
      // 索引に出す追加の欄（資料にある分だけ）
      ...Object.fromEntries(C.cols.slice(C.keyOf(v[0]).length).map(([f]) => [f, v[v.length - 1][f] || ''])),
      axis: C.axis.of(v[0]),
      n: v.length,
      rounds: new Set(v.map((x) => x.round)).size,
      med: med(b), min: Math.min(...b), max: Math.max(...b),
      koho: v.reduce((a, x) => a + x.koho, 0),
      zero: v.filter(isZero).length,
      last: v.map((x) => x.round).sort().pop(),
    }
  }).sort((a, b2) => a.med - b2.med || b2.n - a.n)

  const enough = houses.filter((h) => h.n >= MIN_N)
  const suki = enough.filter((h) => h.med < SUKI)
  const buread = enough.filter((h) => h.min > 0 && h.max >= h.min * BURE)
  const konde = enough.slice().sort((a, b2) => b2.med - a.med)
  const ALL_MED = med(enough.map((h) => h.med))

  // ── 軸ごとの相場（無料ページの表）──────────────────────────────────────────
  const GROUPS = [...new Set(rows.map(C.axis.of))].map((label) => {
    const rs = rows.filter((r) => C.axis.of(r) === label)
    const hs = enough.filter((h) => h.axis === label)
    return {
      label, n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
      med: r1(med(rs.map((x) => x.bairitsu))),
      zero: rs.filter(isZero).length,
      houses: hs.length,
      suki: hs.filter((h) => h.med < SUKI).length,
    }
  }).sort((a, b2) => a.med - b2.med)

  const BY_ROUND = ROUNDS.map((round) => {
    const rs = rows.filter((r) => r.round === round)
    return {
      round, n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
      med: r1(med(rs.map((x) => x.bairitsu))),
      zero: rs.filter(isZero).length,
    }
  })

  const F = {
    rows: rows.length, rounds: ROUNDS.length, all: houses.length, enough: enough.length,
    allMed: r1(ALL_MED), suki: suki.length,
    sukiPct: Math.round((suki.length / Math.max(enough.length, 1)) * 100),
    buread: buread.length,
    zeroRows: rows.filter(isZero).length,
    zeroHouses: new Set(rows.filter(isZero).map((r) => normName(r.name))).size,
    zeroHousesEnough: enough.filter((h) => h.zero > 0).length,
    groups: GROUPS.length,
    from: ROUNDS[0], to: ROUNDS[ROUNDS.length - 1],
    // 読み取りの限界を面に出すための数字
    usedRounds: ledger.filter((l) => l.used).length,
    skippedRounds: ledger.filter((l) => !l.used).map((l) => l.round),
    allRounds: ledger.length,
    matched: ledger.filter((l) => l.match).length,
    explained: ledger.filter((l) => l.used && l.match === false && l.explained).length,
    noNameRows: ledger.reduce((a, l) => a + ((l.noName && l.noName.rows) || 0), 0),
    noNameKoho: ledger.reduce((a, l) => a + ((l.noName && l.noName.koho) || 0), 0),
  }
  const RANGE = `${WA(F.from)}〜${WA(F.to)}`
  const shownGroups = GROUPS.filter((g) => g.houses >= MIN_GROUP)

  return {
    C, raw, rows, ledger, ROUNDS, houses, enough, suki, buread, konde,
    GROUPS, shownGroups, BY_ROUND, F, RANGE,
    READ_AT: raw.updated, INDEX_URL: raw.index, SRC_NAME: C.src,
  }
}
