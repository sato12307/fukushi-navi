// ─────────────────────────────────────────────────────────────────────────────
// hikazei-lib.mjs — 住民税非課税の線の計算（1か所だけ）。
//   使うのは2つ＝ /mitoshi/hikazei/（年度ごとの記録）と /hikazei/（市区町村ごとの早見表）。
//   同じ計算を2か所に書くと必ずずれるので、式はここにしか書かない。[[same-question-two-implementations]]
//   ★ articles/juminzei-hikazei-check.html の計算機（ブラウザ側のJS）は別実装。
//     scripts/hikazei-city.mjs がその関数を読み込んで、ここと結果が合うかを毎回確かめる。
//
// 材料（線の額・給与所得控除の版・突き合わせの公表値）は data/mitoshi-hikazei.json。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mitoshi-hikazei.json'), 'utf8'))
export const L = D.limits
export const PER = D.periods
export const NS = [0, 1, 2, 3, 4]

// ── 給与所得（給与収入 → 所得）。所得税法別表第五と同じ4,000円刻みの丸めを入れる ─────────
//   国税庁 No.1410 の表と注。660万円未満は別表第五で求める（下の式はその表を再現したもの）。
const floor4k = (x) => Math.floor(x / 4000) * 4000
const upper = (x, A) => (x < 3600000 ? A * 0.7 - 80000 : x < 6600000 ? A * 0.8 - 440000 : x <= 8500000 ? x * 0.9 - 1100000 : x - 1950000)
export const kyuyo = {
  // 令和2〜6年分：最低55万円（162.5万円まで）
  r3: (x) => {
    if (x < 1619000) return Math.max(0, x - 550000)
    if (x < 1620000) return 1069000
    if (x < 1622000) return 1070000
    if (x < 1624000) return 1072000
    if (x < 1628000) return 1074000
    const A = floor4k(x)
    if (x < 1800000) return A * 0.6 + 100000
    return upper(x, A)
  },
  // 令和7年分：最低65万円（190万円まで）
  r8: (x) => (x < 1900000 ? Math.max(0, x - 650000) : upper(x, floor4k(x))),
  // 令和8・9年分：最低74万円（220万円まで）。219.1万〜220万円未満は注2の表。
  r9: (x) => {
    if (x < 2191000) return Math.max(0, x - 740000)
    if (x < 2193000) return 1451000
    if (x < 2196000) return 1453000
    if (x < 2200000) return 1456000
    return upper(x, floor4k(x))
  },
}
// 所得が lim 以下になる、いちばん高い給与収入（1円単位）
export const maxIncome = (pid, lim) => {
  let lo = 0, hi = 20000000
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (kyuyo[pid](mid) <= lim) lo = mid; else hi = mid - 1 }
  return lo
}

// ── 公的年金等の雑所得（年金収入 → 所得）。国税庁 No.1600「令和2年分以後」の速算表 ──────────
//   年金以外の所得が1,000万円以下の人の表。65歳以上かどうかは、その年の12月31日の年齢で決まる。
//   令和7年分・令和8年分の変更は国税庁のページ（令和8年4月1日現在法令等）に無い＝年度で動かない。
//   ★端数：収入×75%の式の段は1円未満が出る。線の目安は「確実に線の内側に入る額」＝切り捨てで出す。
export const nenkin = (x, over65) => {
  if (over65) {
    if (x <= 3300000) return Math.max(0, x - 1100000)
    if (x <= 4100000) return x * 0.75 - 275000
    if (x <= 7700000) return x * 0.85 - 685000
    if (x <= 10000000) return x * 0.95 - 1455000
    return x - 1955000
  }
  if (x <= 1300000) return Math.max(0, x - 600000)
  if (x <= 4100000) return x * 0.75 - 275000
  if (x <= 7700000) return x * 0.85 - 685000
  if (x <= 10000000) return x * 0.95 - 1455000
  return x - 1955000
}
export const maxPension = (over65, lim) => {
  let lo = 0, hi = 20000000
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (nenkin(mid, over65) <= lim) lo = mid; else hi = mid - 1 }
  return lo
}

// ── 非課税の所得の線。n＝扶養している人の数（同一生計配偶者を含む・16歳未満の子も数える）──────
//   base・add を渡すと、その市区町村が条例で定めた額（丸めた額）で計算する。
export const kintouLim = (k, n, base = L.kintou.base[k], add = L.kintou.add[k]) => (n === 0 ? base + L.kintou.plus : base * (1 + n) + L.kintou.plus + add)
export const shotokuLim = (n) => (n === 0 ? L.shotoku.base + L.shotoku.plus : L.shotoku.base * (1 + n) + L.shotoku.plus + L.shotoku.add)
// 障害者・未成年者・ひとり親・寡婦の本人は、前年の合計所得135万円以下なら非課税（地方税法295条1項2号）。級地によらない。
export const SPECIAL_LIM = 1350000

// ── 表示 ────────────────────────────────────────────────────────────────────
export const man = (y) => {   // 1,100,000 → 110万円 ／ 2,059,999 → 205万9,999円
  const m = Math.floor(y / 10000), r = y % 10000
  return r ? `${m.toLocaleString('ja-JP')}万${r.toLocaleString('ja-JP')}円` : `${m.toLocaleString('ja-JP')}万円`
}
// 表の中だけ「万」のあとで折り返せるようにする（360px幅で「205万9,999円」が1行に収まらない）
export const manT = (y) => man(y).replace('万', '万<wbr>')

// ── 突き合わせ（大阪市・名古屋市の公表値）。1円でも違えば呼び出し側を止める ─────────────────
export const selfCheck = () => {
  const c = D.check
  const k = NS.map((n) => maxIncome(c.period, kintouLim('1', n)))
  const s = NS.map((n) => maxIncome(c.period, shotokuLim(n)))
  if (JSON.stringify(k) !== JSON.stringify(c.kintou)) return `均等割の年収の目安が大阪市の公表値と違います。計算 ${k.join(',')} ／ 公表 ${c.kintou.join(',')}`
  if (JSON.stringify(s) !== JSON.stringify(c.shotoku)) return `所得割の年収の目安が大阪市の公表値と違います。計算 ${s.join(',')} ／ 公表 ${c.shotoku.join(',')}`
  const c2 = D.check2
  const k0 = maxIncome(c2.period, kintouLim('1', 0))
  if (k0 !== c2.kintou0) return `令和9年度の単身の目安が名古屋市の公表値と違います。計算 ${k0} ／ 公表 ${c2.kintou0}`
  return null
}
