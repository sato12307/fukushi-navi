// ─────────────────────────────────────────────────────────────────────────────
// kokuho-lib.mjs — 国民健康保険（国保）の軽減の線と、保険料の年額の計算（1か所だけ）。
//   使うのは /hikazei/（市区町村ごとの早見表）。同じ計算を2か所に書くと必ずずれるので、式はここにしか書かない。
//   収入 → 所得の換算（給与所得控除・公的年金等控除）は hikazei-lib.mjs のものを使う（ここに書き直さない）。
//
// 材料（判定の線の額・料率・突き合わせの公表値）は data/kokuho.json。
//
// ★軽減（7割・5割・2割）は国の政令で決まる全国共通の線。料率（所得割・均等割・平等割・限度額）は市区町村ごと
//   （大阪府・奈良県のように府県で統一しているところもある）。料率は公式ページで確かめた所だけ載せる。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { kyuyo, nenkin } from './hikazei-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const K = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kokuho.json'), 'utf8'))
const G = K.keigen

// ── 世帯の人（member）＝ { age, sal: 給与収入, pen: 公的年金等収入 } ──────────────────────
//   年齢は所得の年の12月31日（令和8年度なら2025年12月31日）の年齢。給与と年金の両方がある人は扱わない
//   （所得金額調整控除が入って式が変わるため。黙って間違えるより止める）。
const assertMember = (m) => {
  if (!Number.isInteger(m.age)) throw new Error('年齢がありません')
  if ((m.sal || 0) > 0 && (m.pen || 0) > 0) throw new Error('給与と年金の両方がある人はこの計算では扱いません')
}
// 総所得金額等（所得割の基礎と、軽減の判定の両方に使う）
export const shotoku = (m) => {
  assertMember(m)
  if (m.sal) return kyuyo[G.incomePeriod](m.sal)
  if (m.pen) return Math.floor(nenkin(m.pen, m.age >= 65))   // 収入×75%の段は1円未満が出る＝切り捨て
  return 0
}
// 軽減の判定に使う所得＝65歳以上の人は年金の所得から15万円を引く（判定のときだけ。所得割の計算では引かない）
export const hanteiShotoku = (m) => {
  const s = shotoku(m)
  if (m.age >= 65 && m.pen) return Math.max(0, s - G.pension65)
  return s
}
// 給与所得者等＝給与収入55万円超の人・公的年金等の収入が65歳未満60万円超／65歳以上125万円超の人
export const isWorker = (m) => (m.sal || 0) > G.workerSalary || (m.pen || 0) > (m.age >= 65 ? G.workerPension65 : G.workerPension64)

// ── 軽減の割合（0.7／0.5／0.2 を 7／5／2 の整数で返す。0＝軽減なし）──────────────────────
//   「10万円×（給与所得者等の数−1）」は給与所得者等が2人以上のときだけ足す（大阪市のページに明記）。
export const limits = (n, workers) => {
  const w = G.perWorker * Math.max(0, workers - 1)
  return { 7: G.base + w, 5: G.base + G.go * n + w, 2: G.base + G.ni * n + w }
}
export const keigenOf = (members) => {
  const total = members.reduce((a, m) => a + hanteiShotoku(m), 0)
  const L = limits(members.length, members.filter(isWorker).length)
  if (total <= L[7]) return 7
  if (total <= L[5]) return 5
  if (total <= L[2]) return 2
  return 0
}

// ── 線（年収の目安）：稼ぐ人が1人・ほかの人は収入なしの世帯で、その割合の軽減になる最も高い年収（1円単位）──
//   kind＝'sal'（給与だけ）／'pen65'（65歳以上で年金だけ）。n＝国保に入っている人数。
const earner = (kind, x) => (kind === 'sal' ? { age: 45, sal: x } : { age: 70, pen: x })
const others = (kind, n) => Array.from({ length: n - 1 }, () => (kind === 'sal' ? { age: 40 } : { age: 70 }))
export const lineOf = (kind, n, level) => {
  const ok = (x) => keigenOf([earner(kind, x), ...others(kind, n)]) >= level   // 7＞5＞2＞0。「その割合以上の軽減」
  let lo = 0, hi = 20000000
  if (!ok(0)) return null
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (ok(mid)) lo = mid; else hi = mid - 1 }
  return lo
}
// 7>5>2 の順に「その割合以上の軽減になる」上限を出す（2割の線＝軽減が何かしら付く上限）
export const lines = (kind, n) => ({ 7: lineOf(kind, n, 7), 5: lineOf(kind, n, 5), 2: lineOf(kind, n, 2) })

// ── 保険料の年額 ───────────────────────────────────────────────────────────────
//   区分（医療分・後期高齢者支援金分・介護分・子ども・子育て支援金分）ごとに
//     所得割＝（総所得金額等−43万円 を人ごとに足したもの）×率 ／ 均等割×人数 ／ 平等割（世帯に1つ）
//   を足し、区分ごとの限度額で頭打ち。軽減は均等割と平等割に効く（1人・1世帯あたりで1円未満切り捨て）。
//   介護分は40〜64歳の人だけ。子ども・子育て支援金分の均等割は18歳以上の人だけ（18歳未満は全額軽減）で、
//   それとは別に「18歳以上均等割」（kintou18）がある。軽減後の額は、均等割と18歳以上均等割のそれぞれで
//   1円未満を切り捨てる（足立区の軽減後の額の表＝73円の7割軽減後は21円 と一致）。
//   6歳未満（未就学児の軽減）と、市町村が独自に子どもの均等割を軽くしている分は扱わない＝子どもは6〜17歳まで。
export const setOf = (code) => {
  const id = K.muniSets[code] || K.prefSets[code.slice(0, 2)]
  return id ? { id, ...K.rateSets[id] } : null
}
const cut = (yen, lv) => Math.floor((yen * (10 - lv)) / 10)
//   opt.lv を渡すと軽減の割合を決め打ちする（0＝所得の申告をしていなくて軽減されない場合の額を出すとき）。
export const annual = (rs, members, opt = {}) => {
  if (members.some((m) => m.age < 6)) throw new Error('6歳未満の子どもがいる世帯はこの計算では扱いません（未就学児の軽減）')
  const lv = opt.lv ?? keigenOf(members)
  const parts = rs.parts.map((p) => {
    const inPart = p.ages ? members.filter((m) => m.age >= p.ages[0] && m.age <= p.ages[1]) : members
    if (!inPart.length) return { id: p.id, label: p.label, yen: 0, shotokuwari: 0, kintou: 0, byodo: 0 }
    const base = inPart.reduce((a, m) => a + Math.max(0, shotoku(m) - G.base), 0)
    const shotokuwari = Math.floor((base * p.rate) / 100000)      // 率は10万分の1の整数（9.50%＝9500）
    const payers = p.adultsOnly ? inPart.filter((m) => m.age >= 18) : inPart
    const adults = inPart.filter((m) => m.age >= 18)
    const kintou = cut(p.kintou, lv) * payers.length + (p.kintou18 ? cut(p.kintou18, lv) * adults.length : 0)
    const byodo = p.byodo ? cut(p.byodo, lv) : 0
    const yen = Math.min(p.cap, shotokuwari + kintou + byodo)
    return { id: p.id, label: p.label, yen, shotokuwari, kintou, byodo, capped: shotokuwari + kintou + byodo > p.cap }
  })
  return { lv, total: parts.reduce((a, p) => a + p.yen, 0), parts }
}

// ── 表示 ────────────────────────────────────────────────────────────────────
export const yen = (y) => `${y.toLocaleString('ja-JP')}円`
export const rateTxt = (r) => `${(r / 1000).toFixed(3).replace(/0$/, '')}%`   // 9500 → 9.50%・280 → 0.28%・8214 → 8.214%
export const lvTxt = (lv) => (lv ? `${lv}割軽減` : '軽減なし')

// ── 突き合わせ。1円でも違えば呼び出し側を止める ──────────────────────────────────────
export const selfCheck = () => {
  // (1) 線：年金だけの65歳以上の単身は168万円以下で7割（公表の例）
  const p7 = lineOf('pen65', 1, 7)
  if (p7 !== G.check.pension65Single7) return `年金だけの単身の7割軽減の線が公表の例と違います。計算 ${p7} ／ 公表 ${G.check.pension65Single7}`
  // (2) 線の内側と外側：線の額ならその割合、1円上なら1段下がる
  for (const kind of ['sal', 'pen65']) {
    for (const n of [1, 2, 3, 4, 5]) {
      const L = lines(kind, n)
      for (const lv of [7, 5, 2]) {
        const x = L[lv]
        const at = keigenOf([earner(kind, x), ...others(kind, n)])
        const over = keigenOf([earner(kind, x + 1), ...others(kind, n)])
        if (at < lv || over >= lv) return `線の境目がずれています（${kind}・${n}人・${lv}割）：${x}円で${at}、${x + 1}円で${over}`
      }
    }
  }
  // (3) 料率ごとの公表の計算例と1円単位で一致すること
  for (const [id, rs] of Object.entries(K.rateSets)) {
    if (!rs.checks || !rs.checks.length) return `${rs.name}に突き合わせの計算例がありません（公表の計算例か早見表と合わせてから載せる）`
    for (const c of rs.checks) {
      const a = annual(rs, c.members)
      if (c.expect != null && a.total !== c.expect) return `${rs.name}：公表の計算例と年額が違います。計算 ${a.total} ／ 公表 ${c.expect}（${c.src}）`
      for (const [pid, v] of Object.entries(c.expectParts || {})) {
        const got = a.parts.find((p) => p.id === pid)
        if (!got || got.yen !== v) return `${rs.name}：${pid} が公表の値と違います。計算 ${got && got.yen} ／ 公表 ${v}（${c.src}）`
      }
      if (c.expectLv != null && a.lv !== c.expectLv) return `${rs.name}：軽減の割合が公表の例と違います（${c.src}）`
    }
    for (const p of rs.parts) if (!Number.isInteger(p.rate) || !Number.isInteger(p.kintou) || !Number.isInteger(p.byodo) || !Number.isInteger(p.cap) || (p.kintou18 != null && !Number.isInteger(p.kintou18))) return `${rs.name}：${p.label}の料率に欠けがあります`
    if (!rs.sources || !rs.sources.length || !rs.checkedAt) return `${rs.name}：出典か確認日がありません`
  }
  for (const [p2, id] of Object.entries(K.prefSets)) if (!K.rateSets[id]) return `都道府県${p2}の料率 ${id} がありません`
  for (const [code, id] of Object.entries(K.muniSets)) if (!K.rateSets[id]) return `市区町村${code}の料率 ${id} がありません`
  return null
}
