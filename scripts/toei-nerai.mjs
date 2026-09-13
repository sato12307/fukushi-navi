// ─────────────────────────────────────────────────────────────────────────────
// toei-nerai.mjs — 都営住宅「申込先えらび」の無料ページと有料資料を作る。
//
// ★何を売って、何を売らないか
//   売らない: 申込資格・収入基準・制度の説明。無料記事で全部出している。
//             どの住宅が何回あまったか（募集割れ一覧）も無料でCSV配布済み。
//   売る:     募集回をまたいで名寄せしたうえでの「毎回すいている住宅はどこか」。
//             1回だけ空いた住宅と、いつ見ても空いている住宅は意思決定がまるで違う。
//             公表資料は回ごとのPDFしかなく、横に並べた集計はどこにも無い。
//
// ★出典側の規約に触れないための設計（ここが一番大事）
//   倍率表を出しているのは JKK東京。サイトポリシーで「私的使用又は引用等を除き
//   無断で転載等はできない」「無断で改変を行うことはできない」と明記されている。
//   ∴ **公表表の行をそのまま並べ直したものは作らない。**
//     出すのは当方が計算した指標（中央値・最小・最大・観測件数・応募ゼロ回数）だけで、
//     どの回にいくつ申し込みがあったかという公表表の中身は再現しない。
//     数値そのものは事実であって著作物ではないが、表の丸写しは別の話になる。
//   出所は無料ページ・有料資料の両方に明記する。[[per-page-license-override]]
//
// ★読み取りの限界をそのまま持ち越す
//   PDFは回ごとに列の作りが違い、機械で全部は復元できない。行頭に区市町が
//   書かれていた行（city_trusted）だけを使う。母数が減るほうを選ぶ。
//   「読めなかった」を「空いていた」と混ぜない。[[same-question-two-answers]]
//   ★2026-09-13 例外を1つだけ足した。行頭に区市町が無い行でも、住宅名が
//     東京都内でただ1つの区にだけある町丁目名なら、その区の行として数える
//     （姉妹サイト 住環境データ東京 の町丁目台帳で引く）。2つ以上の区にある名前・
//     台帳に無い名前は今までどおり外す。行頭に区市町がある行の区は書き換えない。
//     取り戻した行には city_by:'ledger' と元の区市町（city_orig）を残す。
//   ★2026-09-13(2) 住宅名の頭に区市町名が付いたもの（府中美好町一丁目 など）は、住宅名そのままで台帳に無いときだけ
//     頭の区市町名を外して引く（区名が1文字の北区・港区は外さない）。区市町名の末尾が次の欄にはみ出して
//     読まれた行（「武蔵村」＋「山１人」）は、つなげた名前が台帳の区市町名にちょうど1つ一致するときだけ直す。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRICE = 500
const MIN_N = 4          // これ未満の観測しかない住宅は「毎回」と言えないので狙い目に出さない
const SUKI = 5           // 中央値がこれ未満なら「すいている」
const MIN_CITY = 3       // 区市町ごとの相場は、対象の申込先がこれ以上ある区市町だけ出す
const BURE = 10          // 最高が最低のこれ倍以上なら「回によって動く」
// ★2026-09-13(3) 町全体の合計を出す線（ユーザー判断）。住宅名が町の名前までしか一致しないとき、
//   その町の丁目がこの数以下で、かつ町全体の世帯がこの数未満のときだけ町全体の合計を出す。
//   超える町（光が丘＝7つの丁目・世帯11,933／国領町＝8つの丁目・世帯14,545 など）は、合計が住宅のまわりの
//   様子とかけ離れやすいので数字を出さず、「町が広いため数字なし」と丁目の数を書く。
const TOWN_MAX_CHOME = 3
const TOWN_MAX_SETAI = 5000
const SRC = 'JKK東京（東京都住宅供給公社）が募集回ごとに公表する「申込地区別倍率表」PDF'
const JIKO = '居室内で病死等があった住宅'

// ★data/toei-bairitsu.json は .gitignore に入れてある（読み取りに未修理の取りこぼしがあるため
//   生の中間ファイルは公開しない）。クローンしただけの環境には無いので、まず PDF から作り直すこと。
const SRC_JSON = path.join(ROOT, 'data', 'toei-bairitsu.json')
if (!fs.existsSync(SRC_JSON)) {
  console.error('data/toei-bairitsu.json がありません（公開していない中間ファイルです）。')
  console.error('倍率表PDFから scripts/toei-parse.py で作り直してください。')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'))
const READ_AT = raw.updated
// ── 住環境データ東京の町丁目台帳 ────────────────────────────────────────────
//   姉妹サイト（living-environments.com・ディレクトリ minpaku-envmap）が
//   scripts/export-towns.mjs で書き出す「区市町村＋町名 → 町丁目ごとの世帯数・住宅侵入の件数」。
//   使い道は2つ。
//   (1) 行頭に区市町が無い行（前の行から引き継いだ区市町しか無い行）の区を、
//       住宅名と同じ名前の町丁目で取り戻す。東京都内でただ1つの区にだけある町丁目名のときだけ。
//       2つ以上の区にある名前（西原町一丁目＝府中市と西東京市 など）と台帳に無い名前は外す。
//       行頭に区市町がある行は、台帳と食い違っても書き換えない（数だけ数えてページに出す）。
//   (2) ページに出す住宅に、同じ区の同じ名前の町丁目の数字を添える。
//   ★この台帳もこの環境にしか無い。無ければ止める（黙って台帳なしで作ると、
//     分析の母数が戻った無料ページと有料資料が出てしまう）。
const ENV_JSON = path.resolve(ROOT, '..', 'minpaku-envmap', 'data', 'towns-export.json')
const CITYDICT = path.resolve(ROOT, '..', 'tenpo-rireki', 'scripts', 'lib', 'citydict.mjs')
for (const p of [ENV_JSON, CITYDICT]) {
  if (!fs.existsSync(p)) {
    console.error(`${p} がありません（住環境データ東京の町丁目台帳／表記ゆれの畳み方）。`)
    process.exit(1)
  }
}
const ENV = JSON.parse(fs.readFileSync(ENV_JSON, 'utf8'))
// ヶ/ケ・旧字体の畳み方は tenpo-rireki の1本を呼ぶ（写経しない）。[[same-question-two-implementations]]
//   実測: 畳まないと「桐ケ丘一丁目」「西ケ原一丁目」（北区）の111行を取りこぼす。
const { looseKey } = await import(pathToFileURL(CITYDICT).href)

const KANSUJI = '〇一二三四五六七八九'
const kan = (d) => {
  const n = Number(d)
  if (!(n >= 1 && n < 100)) return d
  const t = Math.floor(n / 10), o = n % 10
  return t === 0 ? KANSUJI[o] : (t > 1 ? KANSUJI[t] : '') + '十' + (o ? KANSUJI[o] : '')
}
// 台帳の名前の鍵（NFKC・空白を詰める・異体字を畳む）
const placeKey = (s) => looseKey(String(s ?? '').normalize('NFKC').replace(/\s+/g, ''))
// 住宅名 → 町丁目名の鍵。住宅名は「港南四丁目第３」「中原四丁目第２」のように
// 町丁目名に「第N」「N号棟」を付けたものが多い。算用数字の丁目は台帳に合わせて漢数字にする。
const houseKey = (name) => placeKey(String(name ?? '').normalize('NFKC').replace(/\s+/g, '')
  .replace(/([0-9]+)丁目/g, (_, d) => kan(d) + '丁目')
  .replace(/(?:第[0-9]+|第[〇一二三四五六七八九十]+|[0-9]+号棟)$/, ''))

const AREA_BY_KEY = new Map()   // 町丁目名の鍵 → [{ ward, area }]
const TOWN_BY_KEY = new Map()   // 区市町村|町名の鍵 → [town]
for (const t of Object.values(ENV.towns)) {
  const tk = `${t.ward}|${placeKey(t.town)}`
  if (!TOWN_BY_KEY.has(tk)) TOWN_BY_KEY.set(tk, [])
  TOWN_BY_KEY.get(tk).push(t)
  for (const a of t.areas) {
    const k = placeKey(a.name)
    if (!AREA_BY_KEY.has(k)) AREA_BY_KEY.set(k, [])
    AREA_BY_KEY.get(k).push({ ward: t.ward, area: a })
  }
}
const WARDS = new Set(Object.values(ENV.towns).map((t) => t.ward))

// ★2026-09-13(2) 住宅名の頭に付いた区市町名
//   JKK は住宅名の頭に区市町名を付けることがある（府中美好町一丁目・東久留米幸町一丁目・練馬関町北三丁目 など）。
//   住宅名そのままでは台帳に無いときだけ、頭の区市町名（末尾の「区・市・町・村」を除いた部分）を外し、
//   その区市町の町丁目名として引き直す。外した後の名前が、外した区市町の中にあるときだけ使う。
//   ★1文字の区名（北区・港区）は外さない。「北砂」「北品川」のように北で始まる町名は他の区にいくらでもあり、
//     行頭に区市町がある行で確かめられた例も1つも無かった。
//   実測（2026-09-13）：2文字以上の区市町名を外して引けた行は、行頭に区市町がある行で2,032行・すべてその行の区市町と一致（食い違い0）。
const STEMS = [...WARDS]
  .map((ward) => ({ ward, stem: placeKey(ward.replace(/(区|市|町|村)$/, '')) }))
  .filter((x) => x.stem.length >= 2)
const STEM_OF = new Map(STEMS.map((x) => [x.ward, x.stem]))
const stripStem = (k, ward) => {
  const s = STEM_OF.get(ward)
  return s && k.length > s.length && k.startsWith(s) ? k.slice(s.length) : null
}
// 住宅名の町丁目名がある区市町。by＝'name'（住宅名そのまま）／'stem'（頭の区市町名を外して）
const wardsNamed = (name) => {
  const k = houseKey(name)
  const full = new Set((AREA_BY_KEY.get(k) || []).map((x) => x.ward))
  if (full.size) return { wards: full, by: 'name' }
  const viaStem = new Set()
  for (const { ward } of STEMS) {
    const rest = stripStem(k, ward)
    if (rest && (AREA_BY_KEY.get(rest) || []).some((x) => x.ward === ward)) viaStem.add(ward)
  }
  return { wards: viaStem, by: 'stem' }
}

// 同じ区の同じ名前の町丁目。無ければ町名まで（丁目を落として）引き、町全体の合計を返す。
//   戻り値 undefined＝見つからない
//          { level:'area' }＝同じ区の同じ名前の町丁目（数字あり）
//          { level:'town' }＝町名までしか一致しない・町が線の内側なので町全体の合計（数字あり・丁目の数つき）
//          { level:'wide' }＝町名までしか一致しない・町が線を超えるので数字なし（丁目の数を理由に添える）
//          { level:'ambiguous' }＝同じ区に同じ名前が2つ以上あって決められない（数字なし）
//   ★2026-09-13(3) 以前は「決められない」も null で、ページでは「見つかりません」と同じ書き方になっていた。分けた。
const envByKey = (city, k) => {
  const hit = (AREA_BY_KEY.get(k) || []).filter((x) => x.ward === city)
  if (hit.length === 1) {
    const a = hit[0].area
    return { level: 'area', label: a.name, setai: a.setai, burglary: a.burglary, path: a.path }
  }
  if (hit.length > 1) return { level: 'ambiguous', label: hit[0].area.name, count: hit.length }
  const town = k.replace(/[〇一二三四五六七八九十]+丁目$/, '')
  const ts = town ? TOWN_BY_KEY.get(`${city}|${town}`) || [] : []
  if (ts.length > 1) return { level: 'ambiguous', label: ts[0].town, count: ts.length }
  if (ts.length === 0) return undefined
  const t = ts[0]
  const chome = t.areas.length
  // 台帳の町の中身はふつう「〇丁目」だけ。丁目の付かない町丁目が混ざる町は「町丁目」と数える。
  const unit = t.areas.every((a) => /丁目$/.test(a.name)) ? '丁目' : '町丁目'
  if (!(chome <= TOWN_MAX_CHOME && Number.isFinite(t.setai) && t.setai < TOWN_MAX_SETAI)) {
    return { level: 'wide', label: t.town, setai: t.setai, chome, unit }
  }
  // ★町の合計は、公表の無い町丁目を飛ばして足してある。1つでも混ざれば件数は出さない（少なく見せない）。
  const partial = t.areas.some((a) => a.burglary == null)
  return { level: 'town', label: t.town, setai: t.setai, burglary: partial ? null : t.burglary, chome, unit }
}
// 数字を出す一致か（同じ名前の町丁目、または線の内側の町全体）
const hasNum = (e) => !!e && (e.level === 'area' || e.level === 'town')
// 住宅名そのまま（町丁目→町）で引き、どちらにも無いときだけ頭の区市町名を外して（町丁目→町）引く。
//   戻り値 null＝どちらでも見つからない
const envOf = (city, name) => {
  const k = houseKey(name)
  const e = envByKey(city, k)
  if (e !== undefined) return e
  const rest = stripStem(k, city)
  const e2 = rest ? envByKey(city, rest) : undefined
  return e2 === undefined ? null : { ...e2, stem: true }
}

// ── 区市町名の読み取り切れ ──────────────────────────────────────────────────
//   ★2026-09-13(2) 行頭の区市町名の末尾が、次の欄（申込区分（人数））にはみ出して読まれた行がある
//     （「武蔵村」＋「山１人」）。つなげて末尾に「市・区・町・村」を足した名前が台帳の区市町に
//     ちょうど1つ一致するときだけ直す。直した行には city_orig / ninzu_orig を残す。
const SPILL = []
const fixSpill = (r) => {
  if (!r.city_trusted || WARDS.has(r.city)) return r
  const m = /^([^0-9０-９（(\s]+)(.*)$/.exec(String(r.ninzu || ''))
  if (!m) return r
  const hits = ['市', '区', '町', '村'].map((s) => r.city + m[1] + s).filter((w) => WARDS.has(w))
  if (hits.length !== 1) return r
  SPILL.push({ round: r.round, city: r.city, head: m[1], ward: hits[0], name: r.name })
  return { ...r, city: hits[0], city_orig: r.city, ninzu: m[2], ninzu_orig: r.ninzu }
}

// ── 集計に使う行 ────────────────────────────────────────────────────────────
//   行頭に区市町が明記されていた行（city_trusted）＋ 上の (1) で区を確定できた行。
const LEDGER = { head: 0, untrusted: 0, recovered: 0, recoveredStem: 0, moved: 0, multi: 0, none: 0, checked: 0, checkedStem: 0, conflict: 0, conflictEx: [] }
const rows = []
for (const r0 of raw.rows) {
  if (!Number.isFinite(r0.bairitsu)) continue
  const r = fixSpill(r0)
  const { wards: w, by: wBy } = wardsNamed(r.name)
  if (r.city_trusted) {
    LEDGER.head++
    if (w.size === 1) {
      LEDGER.checked++
      if (wBy === 'stem') LEDGER.checkedStem++
      if (!w.has(r.city)) {
        LEDGER.conflict++   // 区は書き換えない
        if (LEDGER.conflictEx.length < 5) LEDGER.conflictEx.push(`${r.round} ${r.city} ${r.name}（台帳は${[...w][0]}）`)
      }
    }
    rows.push(r)
    continue
  }
  LEDGER.untrusted++
  if (w.size === 1) {
    const ward = [...w][0]
    rows.push({ ...r, city: ward, city_orig: r.city, city_by: 'ledger' })
    LEDGER.recovered++
    if (wBy === 'stem') LEDGER.recoveredStem++
    if (ward !== r.city) LEDGER.moved++
  } else if (w.size > 1) LEDGER.multi++
  else LEDGER.none++
}
const ROUNDS = [...new Set(rows.map((r) => r.round))].sort()

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const r1 = (x) => Math.round(x * 10) / 10
const mode = (a) => { const c = {}; for (const v of a) c[v] = (c[v] || 0) + 1; return Object.entries(c).sort((p, q) => q[1] - p[1])[0]?.[0] || '' }

// ── 住宅×募集区分ごとに畳む ─────────────────────────────────────────────────
//   ★キーに募集区分を入れる。同じ建物でも「世帯向」と「病死等があった住宅」では
//     倍率がまるで違い、混ぜて中央値を取ると、病死等の回だけ安かった住宅が
//     「毎回すいている」に化ける。申し込む側も区分を選んで出すので、区分ごとに数える。
//   ★地区番号は回ごとに振り直されるのでキーに使わない。
const by = new Map()
for (const r of rows) {
  const k = `${r.city}|${r.name}|${r.cat}`
  if (!by.has(k)) by.set(k, [])
  by.get(k).push(r)
}
const houses = [...by.entries()].map(([k, v]) => {
  const [city, name, cat] = k.split('|')
  const b = v.map((x) => x.bairitsu)
  return {
    city, name, cat,
    n: v.length,                                              // 観測できた募集件数（回数ではない）
    rounds: new Set(v.map((x) => x.round)).size,
    med: med(b), min: Math.min(...b), max: Math.max(...b),
    zero: v.filter((x) => x.moushikomi === 0 && x.bairitsu === 0).length,
    jiko: cat === JIKO,
    ev: mode(v.map((x) => x.ev).filter(Boolean)),
    era: mode(v.map((x) => x.era).filter(Boolean)),
    eras: new Set(v.map((x) => x.era).filter(Boolean)).size,   // 2以上＝号棟などで建てられた年が混ざっている
    ledger: v.filter((x) => x.city_by === 'ledger').length,   // 区を台帳で確定した行の数
    env: envOf(city, name),                                    // 同じ区の同じ名前の町丁目（数字を出すかは hasNum・見つからなければ null）
  }
}).sort((a, b) => a.med - b.med || b.n - a.n)

const enough = houses.filter((h) => h.n >= MIN_N)
const suki = enough.filter((h) => h.med < SUKI)
const sukiIppan = suki.filter((h) => !h.jiko)
const buread = enough.filter((h) => h.min > 0 && h.max >= h.min * BURE)
const konde = enough.filter((h) => !h.jiko).slice().sort((a, b) => b.med - a.med)
const ALL_MED = med(enough.map((h) => h.med))
const CITIES = [...new Set(rows.map((r) => r.city))].sort()

// 区市町ごとの中央値（無料ページに出す。ここまでは「相場」なので無料）
const byCity = CITIES.map((c) => {
  const hs = enough.filter((h) => h.city === c && !h.jiko)
  return { city: c, n: hs.length, med: hs.length ? med(hs.map((h) => h.med)) : null, suki: hs.filter((h) => h.med < SUKI).length }
}).filter((x) => x.n >= MIN_CITY).sort((a, b) => a.med - b.med)

// 条件ごとの効き目（EV・築年・人数区分・募集区分）
// ★表ごとに母数が違う。条件が読み取れなかった行は、その表からだけ外れる。
//   区を台帳で確定した行は人数の区分が空（toei-parse.py が行頭に区市町の無い行で ninzu を読まない）。
//   「募集○件を条件ごとに分けて」とだけ書くと表の母数を大きく見せるので、表ごとに数えて出す。
const cut = (label, keyOf, { min = 0, drop = [] } = {}) => {
  const groups = groupMed(keyOf).filter((x) => x.n >= min && !drop.includes(x.k))
  const shown = new Set(groups.map((g) => g.k))
  const out = rows.filter((r) => !shown.has(keyOf(r)))
  const outLedger = out.filter((r) => r.city_by === 'ledger')
  // 外れた「区を台帳で確定した行」のうち、条件の欄そのものが読み取れていない行（件数が少ない区分で外れた行と分ける）
  const unread = (r) => !keyOf(r) || drop.includes(keyOf(r))
  return { label, groups, min, base: rows.length - out.length, out: out.length, outLedger: outLedger.length, outLedgerUnread: outLedger.filter(unread).length }
}
const eraBand = (e) => {
  const m = /(昭和|平成|令和)\s*([0-9]+)/.exec(e || '')
  if (!m) return '不明'
  const y = { 昭和: 1925, 平成: 1988, 令和: 2018 }[m[1]] + Number(m[2])
  return y < 1980 ? '1979年以前' : y < 1990 ? '1980年代' : y < 2000 ? '1990年代' : y < 2010 ? '2000年代' : '2010年以降'
}
const groupMed = (keyOf, src = rows) => {
  const g = {}
  for (const r of src) { const k = keyOf(r); if (!k) continue; (g[k] = g[k] || []).push(r.bairitsu) }
  return Object.entries(g).map(([k, v]) => ({ k, n: v.length, med: med(v) })).sort((a, b) => a.med - b.med)
}
const cuts = [
  cut('エレベーターの有無', (r) => (r.ev === '有' ? 'エレベーター有' : r.ev === '無' ? 'エレベーター無' : '')),
  cut('建てられた年', (r) => eraBand(r.era), { drop: ['不明'] }),
  cut('申込区分（人数）', (r) => (r.ninzu || '').trim(), { min: 50 }),
  cut('募集区分', (r) => r.cat, { min: 50 }),
]
const cutNote = (c) => c.out
  ? `この表の母数は${num(c.base)}件です。${esc(c.label)}が読み取れなかった行${c.min ? `と、募集件数が${c.min}件に満たない区分` : ''}の${num(c.out)}件${c.outLedger ? `（うち、区を台帳で確定した行 ${num(c.outLedger)}件）` : ''}は入っていません。${
    c.outLedger && c.outLedgerUnread === c.outLedger && c.outLedger === LEDGER.recovered
      ? `区を台帳で確定した行は、もともと行頭に区市町が無かった行で、読み取りの段階で${esc(c.label)}の欄が取れていないため、この表にはすべて入っていません。`
      : c.outLedgerUnread
        ? `区を台帳で確定した行のうち${num(c.outLedgerUnread)}件は、読み取りの段階で${esc(c.label)}の欄が取れていない行です。`
        : ''}`
  : `この表の母数は${num(c.base)}件（集計に使った全件）です。`

// ── 数字を1か所で作る。無料ページと有料資料で違う数を出さないため ──────────────
const F = {
  rows: rows.length, all: houses.length, enough: enough.length, rounds: ROUNDS.length,
  cities: CITIES.length, allMed: r1(ALL_MED), suki: suki.length, sukiIppan: sukiIppan.length,
  sukiPct: Math.round((suki.length / enough.length) * 100), buread: buread.length,
  zeroHouses: enough.filter((h) => h.zero > 0).length,
  from: ROUNDS[0], to: ROUNDS[ROUNDS.length - 1],
  rowsHead: LEDGER.head, rowsLedger: LEDGER.recovered,
  envEnough: enough.filter((h) => hasNum(h.env)).length,
  envTown: enough.filter((h) => h.env && h.env.level === 'town').length,
  envWide: enough.filter((h) => h.env && h.env.level === 'wide').length,
  envAmb: enough.filter((h) => h.env && h.env.level === 'ambiguous').length,
  eraMixed: enough.filter((h) => h.eras > 1).length,
}
const era = (r) => `${r.slice(0, 4)}年${Number(r.slice(5))}月`
const RANGE = `${era(F.from)}〜${era(F.to)}`

// ★書き出しは最後にまとめて行う（flush）。途中の突き合わせ（記事の抜粋・トップのカード・sitemap）で
//   止まったときに、無料ページだけ新しくて資料や抜粋が古い、という半端な状態をディスクに残さないため。
const pending = []
const write = (rel, html) => { pending.push([rel, html]) }
const flush = () => {
  for (const [rel, html] of pending) {
    const p = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, html)
  }
}
const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }
const num = (x) => x.toLocaleString('ja-JP')

// ── 住環境の数字の欄と注記（無料ページと有料資料で同じ文面を使う）──────────────
//   ★件数は率ではない。世帯の多い町ほど大きく出る。住宅名と同じ名前の町丁目の数字であって、
//     建物の所在地を確かめたものではない。この2つを必ず注記に書く。
//   ★burglary が null は「公表なし」。0件と書かない。
const WIN_TXT = `${ENV.window.from}〜${ENV.window.to}年の${ENV.window.n}年間`
const tsu = (n) => (n < 10 ? `${n}つ` : `${n}`)   // 7つの丁目／10の丁目
// free＝無料ページ①の表（見つからない・決められないを文で書く）。有料資料と抜粋は短い書き方。
const envCell = (e, withWin, free = false) => {
  if (!e) return free ? NO_ENV_FREE : '—'
  if (e.level === 'ambiguous') {
    return free
      ? `同じ区に「${esc(e.label)}」が${tsu(e.count)}あり、どれか決められません（数字なし）`
      : `${esc(e.label)}（同じ区に同じ名前が${tsu(e.count)}あり、決められないため数字なし）`
  }
  if (e.level === 'wide') return `${esc(e.label)}（町が広いため数字なし・${tsu(e.chome)}の${e.unit}）`
  const where = e.level === 'area'
    ? `<a href="${esc(ENV.site + e.path)}">${esc(e.label)}</a>`
    : `${esc(e.label)}（町全体・${tsu(e.chome)}の${e.unit}）`
  const setai = Number.isFinite(e.setai) ? `世帯${num(e.setai)}` : '世帯数なし'
  const b = e.burglary == null ? '住宅侵入は公表なし' : `住宅侵入${num(e.burglary)}件${withWin ? `（${WIN_TXT}）` : ''}`
  return `${where}：${setai}・${b}`
}
// 同じ区に同じ名前の町丁目が見つからない住宅の書き方（無料ページ①の表）。「—」だけだと空欄の漏れに見える。
const NO_ENV_FREE = '同じ区に同じ名前の町丁目は見つかりません（数字なし）'
const envNote = (where) => [
  `「住宅と同じ名前の町丁目」の欄は、姉妹サイト<a href="${esc(ENV.site)}/">住環境データ東京</a>が町丁目ごとにまとめた数字です。住宅侵入（空き巣・忍込み・居空き）は${WIN_TXT}の<strong>件数そのもので、率ではありません</strong>。世帯の多い町ほど件数は大きく出ます。<strong>0件は被害がなかったという意味ではありません</strong>（認知件数は、警察に届出があって初めて数えられます）。リンク先の町丁目ページに大きく出ている住宅侵入の件数は、${ENV.window.from}年より前の年も含めた合計なので、ここの${ENV.window.n}年間の件数より大きいことがあります（どちらも同じ警視庁の公表資料から数えたものです）。`,
  `住宅名と同じ名前の町丁目の数字で、<strong>建物の所在地がその町丁目と一致しない場合があります</strong>（町の名前が付いた住宅でも、建物が隣の町丁目に建っていることがあります）。住宅名の頭に区市町名が付いているもの（府中美好町一丁目 など）は、頭の区市町名を外した町丁目名で引いています（北区・港区のように区名が1文字のものは外していません）。町の名前までしか一致しないもの（住宅名に丁目が付いていないもの など）は、<strong>その町の丁目が${TOWN_MAX_CHOME}つ以下で、かつ町全体の世帯が${num(TOWN_MAX_SETAI)}未満のときだけ</strong>町全体の合計を出し、「（町全体・2つの丁目）」のように何丁目ぶんの合計かを添えています。町が大きいほど、町全体の数字は住宅のまわりの様子を表しにくくなるためです。<strong>この線を超える町は数字を出さず</strong>、「（町が広いため数字なし・7つの丁目）」のように丁目の数を書いています（索引${num(F.enough)}件のうち、町全体の合計を出したもの${num(F.envTown)}件・町が広いため数字なしのもの${num(F.envWide)}件）。同じ区に同じ名前の町丁目が見つからないものは数字を付けていません（${where === 'free' ? `①の表では「${NO_ENV_FREE}」と書いています` : '表では「—」'}）。同じ区に同じ名前の町丁目が2つ以上あってどれか決められないものも数字を付けず、見つからないものと分けて「決められません」と書いています（索引のうち${num(F.envAmb)}件）。住宅侵入の件数が公表されていない町丁目（町全体の場合は、公表の無い町丁目を1つでも含む町）は件数を書いていません（0件という意味ではありません）。`,
  `倍率表の行のうち、行頭に区市町が無かった${num(LEDGER.untrusted)}行は、区市町を確かめられないため以前は集計から外していました。このうち<strong>住宅名が東京都内でただ1つの区にだけある町丁目名だった${num(LEDGER.recovered)}行は、その区の住宅として集計に含めています</strong>（住環境データ東京の町丁目台帳で区を確定。${LEDGER.recoveredStem ? `うち${num(LEDGER.recoveredStem)}行は、住宅名の頭に付いた区市町名を外すと、その区市町にだけある町丁目名になるものです。また` : 'うち'}${num(LEDGER.moved)}行は、読み取りで前の行から引き継いでいた区市町とは別の区でした）。2つ以上の区にある名前の${num(LEDGER.multi)}行と、台帳に無い名前の${num(LEDGER.none)}行は、今までどおり含めていません。行頭に区市町があった行で、住宅名の町丁目が別の1つの区にだけあったものは${num(LEDGER.conflict)}行${LEDGER.conflict ? 'で、区は書き換えていません' : 'でした'}。`,
  `住環境の数字の出典＝警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（東京都オープンデータ利用規約に基づき<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" rel="license">クリエイティブ・コモンズ・ライセンス 表示4.0国際（CC BY 4.0）</a>のもとで提供）と、総務省統計局「令和2年国勢調査 小地域集計」（世帯数）。住環境データ東京が町丁目ごとに集計したものを、当サイトが住宅名と突き合わせて加工し掲載しています。警視庁・総務省統計局が作成したものではありません。`,
  ...(SPILL.length ? [`行頭の区市町名の末尾が次の欄（申込区分（人数））にはみ出して読み取られていた${num(SPILL.length)}行は、つなげた名前が台帳の区市町名にちょうど1つ一致したため、その区市町の行として数えています（例：「${esc(SPILL[0].city)}」＋「${esc(SPILL[0].head)}」→ ${esc(SPILL[0].ward)}）。`] : []),
].map((s) => `  <li>${s}</li>`).join('\n')

// ── 無料ページ /toei/ ────────────────────────────────────────────────────────
// ここで出すのは「相場」まで。住宅の実名つきの狙い目一覧が有料の中身。
const cityRows = byCity.map((c) => `<tr><td>${esc(c.city)}</td><td class="num">${c.n}</td><td class="num">${r1(c.med)}倍</td><td class="num">${c.suki}</td></tr>`).join('\n')
const kondeRows = konde.slice(0, 10).map((h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}倍</td><td class="num">${h.n}</td></tr>\n<tr><td colspan="5" style="font-size:.88rem"><span style="color:#566">住宅と同じ名前の町丁目</span>　${envCell(h.env, true, true)}</td></tr>`).join('\n')
const cutBlocks = cuts.map((c) => `  <h3>${esc(c.label)}</h3>
  <p class="note">${cutNote(c)}</p>
  <div class="table-wrap"><table><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>
${c.groups.map((g) => `  <tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}
  </tbody></table></div>`).join('\n\n')

write('toei/index.html', page({
  title: `都営住宅で毎回すいている住宅はどこか｜${F.rounds}回の募集を横に並べた実測｜フクシル`,
  desc: `都営住宅は倍率が高いと言われますが、募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せすると、${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は倍率の中央値が${SUKI}倍未満でした。全体の中央値は${F.allMed}倍です。区市町ごとの相場を無料で公開し、住宅名つきの狙い目一覧を${PRICE}円で配布しています。`,
  canonical: '/toei/', depth: 1,
  body: `  <h1>都営住宅で「毎回すいている住宅」はどこか<br><small>${RANGE}の定期募集${F.rounds}回を、住宅ごとに横に並べた</small></h1>

  <p class="lead">都営住宅は「何十倍で当たらない」と言われます。実際、いちばん混んでいる住宅の倍率の中央値は${r1(konde[0].med)}倍です。
  ところが同じデータを住宅ごとに名寄せすると、<strong>観測できた${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は中央値が${SUKI}倍未満</strong>でした。全体の中央値は<strong>${F.allMed}倍</strong>です。</p>

  <div class="callout point"><p><span class="tag">なぜどこにも無いのか</span>
  倍率表は募集回ごとのPDFでしか公表されておらず、<strong>回をまたいで同じ住宅を追いかけた集計は公表されていません</strong>。
  そのため「たまたま1回だけ空いた住宅」と「いつ見ても空いている住宅」が区別できず、両方まとめて「倍率が高い」と語られています。
  ここでは${RANGE}の${F.rounds}回ぶん、${num(F.rows)}件の募集を住宅名で名寄せして数えました。</p></div>

  <p class="cta-row"><a class="btn-primary" href="#kau">住宅名つきの一覧を${PRICE}円で受け取る&nbsp;→</a> <span class="cta-note">①〜③の相場は無料で、そのまま下に続きます</span></p>

  <h2>① 混んでいる住宅（実名・無料）</h2>
  <p>よく引き合いに出されるのはこちらです。${MIN_N}件以上の募集が観測できた申込先のうち、倍率の中央値が高い順。</p>
  <p class="note">同じ建物でも募集区分が違えば別の申込先として数えています。「世帯向」と「病死等があった住宅」では倍率がまるで違うためです。</p>
  <p class="note">各住宅の下の行は、住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数です（姉妹サイト 住環境データ東京）。読み方と出典はページ末尾の「出典と、この数字の限界」にまとめました。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">倍率の中央値</th><th class="num">観測した募集件数</th></tr></thead><tbody>
${kondeRows}
  </tbody></table></div>

  <h2>② 区市町ごとの相場（無料）</h2>
  <p>${MIN_N}件以上観測できた申込先が${MIN_CITY}件以上ある${byCity.length}区市町。病死等があった住宅は除いてあります。「すいている数」は、中央値が${SUKI}倍未満だった申込先の件数です。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th class="num">対象の申込先</th><th class="num">倍率の中央値</th><th class="num">すいている数</th></tr></thead><tbody>
${cityRows}
  </tbody></table></div>

  <h2>③ 条件を1つ変えると倍率はどう動くか（無料）</h2>
  <p>募集${num(F.rows)}件を条件ごとに分けて、倍率の中央値を出したものです。何をあきらめると何倍ぶん軽くなるかの目安になります。その条件が読み取れなかった行は、その表からだけ外しています（表ごとの母数は各表の上に書きました）。</p>
${cutBlocks}

  <div class="callout point"><p><span class="tag">手続きまで進めるなら</span>
  ここまでが無料で読めるところです。<strong>買わなくても申し込みはできます。</strong>
  上の相場だけでも、どのあたりを狙うかは決められます。</p></div>

  <h2 id="kau">④ 住宅名つきの一覧（${PRICE}円）</h2>
  <div class="offer">
  <p>申込書に書けるのは基本的に<strong>1回につき1つ</strong>です。相場が分かっても、最後は住宅名を1つ選ぶことになります。
  そこを決めるための一覧を用意しました。</p>
  <ul>
  <li><strong>毎回すいている申込先 ${num(F.sukiIppan)}件</strong>（病死等があった住宅を除く）。${MIN_N}件以上観測できて、倍率の中央値が${SUKI}倍未満だったものだけ。<strong>1回だけ空いた住宅は入れていません</strong>——ここが自分で集計すると一番外しやすいところです。</li>
  <li><strong>回によって当たりやすさが大きく動く申込先 ${F.buread}件</strong>。最高と最低が${BURE}倍以上ひらいた住宅です。住宅を変えるのではなく<strong>出す回を変える</strong>ほうが効く相手が分かります。</li>
  <li><strong>申込者ゼロが出た申込先 ${F.zeroHouses}件</strong>と、その回数。</li>
  <li>観測できた<strong>${num(F.enough)}件すべての索引</strong>（区市町・住宅名・募集区分・倍率の中央値／最低／最高・観測件数・エレベーター・建てられた年・住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数）。</li>
  <li>「${JIKO}」${F.suki - F.sukiIppan}件は<strong>別掲</strong>。すいている側にはこの区分が集まるので、知らずに選ぶことがないよう分けました。</li>
  </ul>

  <p class="price"><b>${PRICE}円</b><span>買い切り・税込。HTMLファイル1つ、印刷可</span></p>
  <p><button id="buy" class="btn-primary" type="button">${PRICE}円で一覧を受け取る</button></p>
  <p id="msg" class="note"></p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>上の相場だけでも、どのあたりを狙うかは決められます。</p>
  </div>

  <div class="callout warn"><p><span class="tag">先に読んでください</span>
  これは<strong>過去の実測から作った目安</strong>で、次の募集の倍率を約束するものではありません。募集される住宅は回ごとに変わり、
  ここに載っている住宅が次回も募集されるとは限りません。<strong>申込資格（都内在住・収入基準など）を満たすかどうかは別の話</strong>で、
  そちらは<a href="../articles/koei-tokyo.html">無料の記事</a>と東京都・JKK東京の募集案内でご確認ください。</p></div>

  <p class="note">お読みください：<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../kiyaku/">利用規約</a>。
  当サイトは東京都・JKK東京とは関係のない個人が運営しています。</p>

  <div class="sources">
  <h2>出典と、この数字の限界</h2>
  <ul>
  <li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rowsHead)}行</strong>と、下に書いた方法で<strong>住宅名から区を確定できた${num(F.rowsLedger)}行</strong>の、合わせて${num(F.rows)}行を使っています。したがってここに出ていない住宅も多くあります。</li>
${envNote('free')}
  <li>「観測した募集件数」は募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</li>
  <li>当方が公表表を転載・改変したものではなく、<strong>公表された数値から当方が計算した指標</strong>（中央値・最低・最高・件数）を掲載しています。</li>
  </ul>
  <p class="disclaimer">掲載内容は上記の公表資料を ${READ_AT} 時点で読み取ったもので、当選を保証するものではありません。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related"><a href="../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>
(function(){
  var btn=document.getElementById('buy'), msg=document.getElementById('msg');
  if(!btn) return;
  btn.addEventListener('click', function(){
    if(window.__ev) window.__ev('toei_buy');
    btn.disabled=true; msg.textContent='決済ページへ移動します…';
    fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product:'toei'})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d && d.ok && d.url){ location.href=d.url; return; }
        btn.disabled=false; msg.textContent=(d && d.error) || '決済を開始できませんでした';
      })
      .catch(function(){ btn.disabled=false; msg.textContent='通信に失敗しました。時間をおいてお試しください'; });
  });
})();
</script>
`,
}))

// ── /toei/kanryo/ 購入後の画面（noindex・2階層下）────────────────────────────
write('toei/kanryo/index.html', page({
  title: 'ご購入ありがとうございます｜フクシル',
  desc: '都営住宅 申込先えらびのダウンロード画面です。',
  canonical: '/toei/kanryo/', depth: 2, noindex: true,
  body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">下のボタンからダウンロードしてください。<strong>このページのURLは購入から60日間有効です。</strong>ブックマークしておくと再ダウンロードできます。</p>
  <p><a id="dl" class="card" style="display:inline-block;padding:.8rem 1.6rem;font-weight:600" href="#">一覧をダウンロード（HTML）</a></p>
  <p id="msg" class="note"></p>
  <h2>使い方</h2>
  <ol>
  <li>ダウンロードしたファイルをブラウザで開きます。</li>
  <li>まず「毎回すいている住宅」を自分の通える区市町でしぼってください。</li>
  <li>次の募集案内が出たら、その回に実際に募集されている住宅と突き合わせます。<strong>載っていても、その回に募集が無いことがあります。</strong></li>
  <li>印刷して持っていけます（ブラウザの印刷から「PDFに保存」もできます）。</li>
  </ol>
  <p class="note">開けない・内容が説明と違う・二重に決済された場合は、購入から14日以内に <a href="mailto:contact@fukushiru.com">contact@fukushiru.com</a> までご連絡ください。全額を返金します。
  領収書はStripeから届くメールでご確認いただけます。</p>
  <p class="related"><a href="../../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>
(function(){
  var sid=new URLSearchParams(location.search).get('session_id');
  var a=document.getElementById('dl'), msg=document.getElementById('msg');
  if(!sid){ a.style.display='none'; msg.textContent='購入の情報が見つかりません。購入後に表示されたURLからお越しください。'; return; }
  a.href='/api/pack?session_id='+encodeURIComponent(sid);
})();
</script>
`,
}))

// ── 有料資料 .dist/toei-pack.html ────────────────────────────────────────────
// ★公表表の再現はしない。出すのは当方が計算した指標だけ。
const hrow = (h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td>${esc(h.ev)}</td><td>${esc(h.era)}</td><td>${envCell(h.env, false)}</td></tr>`
const TH = `<th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th>EV</th><th>建築</th><th>同じ名前の町丁目（世帯・住宅侵入 ${WIN_TXT}）</th>`
const table = (list) => `<table class="grid"><thead><tr>${TH}</tr></thead><tbody>
${list.map(hrow).join('\n')}
</tbody></table>`
// 2章の見出しと前置き。記事に貼る抜粋（下の TOEI_PEEK）も同じ文字列から作る。
const SEC2_TITLE = `2. 毎回すいている申込先（病死等があった住宅を除く・${num(F.sukiIppan)}件）`
const SEC2_LEAD = `${MIN_N}件以上観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを載せています。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。区市町ごと、倍率の低い順。`
const sukiCities = [...new Set(sukiIppan.map((h) => h.city))].sort().map((city) => ({
  city, list: sukiIppan.filter((h) => h.city === city).sort((a, b) => a.med - b.med),
}))
const sukiByCity = sukiCities.map((c) => `<h3>${esc(c.city)}（${c.list.length}件）</h3>\n${table(c.list)}`).join('\n\n')

const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>都営住宅 申込先えらび（${RANGE}・${F.rounds}回の実測）｜フクシル</title>
<style>
:root{--ink:#1d2430;--sub:#5b6676;--line:#dfe4ea;--bg:#fff;--accent:#1668a8;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.2rem 4rem;font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  line-height:1.75;color:var(--ink);background:var(--bg);max-width:60rem;margin-inline:auto}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.4rem 0 .6rem;padding-bottom:.3rem;border-bottom:2px solid var(--accent)}
h3{font-size:1rem;margin:1.6rem 0 .4rem;color:var(--accent)}
small{color:var(--sub);font-weight:400}
.lead{color:var(--sub)}
.box{border:1px solid var(--line);border-left:4px solid var(--accent);background:#f7fafc;padding:.8rem 1rem;margin:1rem 0;border-radius:4px}
.box.warn{border-left-color:var(--warn);background:#fff8ed}
.tag{display:inline-block;font-size:.78rem;font-weight:700;color:#fff;background:var(--accent);padding:.1rem .5rem;border-radius:3px;margin-right:.4rem}
.box.warn .tag{background:var(--warn)}
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.grid{border-collapse:collapse;width:100%;font-size:.86rem;margin:.4rem 0 1rem;min-width:44rem}
table.grid th,table.grid td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;white-space:nowrap}
table.grid th{background:#eef3f7;position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:.86rem;color:var(--sub)}
@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}table.grid{font-size:.7rem;min-width:0}.wrap{overflow:visible}}
</style></head><body>

<h1>都営住宅 申込先えらび<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（https://fukushiru.com）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（都内在住・収入基準・世帯構成）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は東京都・JKK東京の募集案内でご確認ください。この資料は資格の判定をしません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先（住宅×募集区分） <strong>${num(F.all)}件</strong>。うち${MIN_N}件以上の募集が観測できた <strong>${num(F.enough)}件</strong>を集計の対象にしています。</li>
<li>同じ建物でも募集区分が違えば別に数えています。混ぜると、病死等があった回だけ安かった住宅が「毎回すいている」に化けるためです。</li>
<li>その${num(F.enough)}件の倍率の中央値は <strong>${F.allMed}倍</strong>。</li>
<li>中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。うち病死等があった住宅を除くと${F.sukiIppan}件。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${F.zeroHouses}件</strong>。</li>
<li>最高と最低が${BURE}倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
<li>表の右端に、住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数（姉妹サイト 住環境データ東京）を添えています（索引${num(F.enough)}件のうち${num(F.envEnough)}件。住宅名が町の名前までしか一致せず、町が広いため数字を付けていないもの${num(F.envWide)}件）。件数は率ではなく、建物の所在地と一致しないことがあります。読み方は7章。</li>
</ul>
<p class="note">「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</p>

<h2>${SEC2_TITLE}</h2>
<p>${SEC2_LEAD}</p>
<div class="wrap">
${sukiByCity}
</div>

<h2>3. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が${BURE}倍以上ひらいた住宅です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。
最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">
${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}
</div>

<h2>4. ${JIKO}（別掲・${suki.length - sukiIppan.length}件）</h2>
<p>すいている住宅にはこの区分が混ざります。知らずに選ぶことがないよう分けました。
家賃が減額される場合があり、条件を承知のうえで選ぶ人には現実的な選択肢です。詳しい条件は募集案内をご確認ください。</p>
<div class="wrap">
${table(suki.filter((h) => h.jiko))}
</div>

<h2>5. 条件を1つ変えたときの効き目</h2>
<p>募集${num(F.rows)}件を条件ごとに分けた倍率の中央値です。何をあきらめると何倍ぶん軽くなるかの目安。その条件が読み取れなかった行は、その表からだけ外しています。</p>
${cuts.map((c) => `<h3>${esc(c.label)}</h3>\n<p class="note">${cutNote(c)}</p>\n<div class="wrap"><table class="grid"><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>\n${c.groups.map((g) => `<tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}\n</tbody></table></div>`).join('\n')}

<h2>6. 観測できた申込先の索引（${num(F.enough)}件）</h2>
<p>中央値の低い順。上の各章に出ていない申込先もここには載っています。</p>
<div class="wrap">
${table(enough)}
</div>

<h2>7. 出典と限界</h2>
<ul>
<li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
<li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rowsHead)}行</strong>と、下に書いた方法で<strong>住宅名から区を確定できた${num(F.rowsLedger)}行</strong>の、合わせて${num(F.rows)}行を使っています。ここに出ていない住宅も多くあります。<strong>「載っていない＝空いていない」ではありません。</strong></li>
${envNote('pack')}
<li>「建築」の欄は、その申込先で観測した募集のうち、いちばん多く書かれていた建てられた年です。同じ住宅名でも号棟によって建てられた年が違うことがあり、索引${num(F.enough)}件のうち${num(F.eraMixed)}件は、観測した募集の中に違う年が混ざっていました。</li>
<li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
<li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
</ul>
<p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。
開けない・説明と違う場合は購入から14日以内のご連絡で全額返金します。</p>

</body></html>
`
write('.dist/toei-pack.html', packHtml)

// ── 記事に貼る抜粋（scripts/toei-peek.mjs）────────────────────────────────────
//   ★2026-09-13 手書きをやめてここで作る。以前は offer-block.mjs に手で切った抜粋を置いていて、
//     資料を作り直したら抜粋だけ古いまま（568件・8列）記事12本に残った。売り場のカードは
//     「実物の冒頭をそのまま」と書いているので、抜粋は資料と同じ見出し・同じ行の関数から作り、
//     下で資料の本文と突き合わせる。記事の見た目に合わせて変えるのは見出しの要素（h2/h3 → h4.pk）と
//     表の外枠だけ（資料の表は折り返さないので、抜粋の表も折り返さない）。文字と数字は変えない。
//   ★ここでは記事に貼らない。貼るのは scripts/stamp-offers.mjs（記事の目印の間だけを差し替える係）。
const PEEK_ROWS = 3
const [peekCity, nextCity] = sukiCities
if (!peekCity || !nextCity) die('抜粋を作れません：すいている申込先のある区市町が2つ未満です。')
const peekBody = `    <h4 class="pk">${SEC2_TITLE}</h4>
    <p>${SEC2_LEAD}</p>
    <h4 class="pk">${esc(peekCity.city)}（${peekCity.list.length}件）</h4>
    <div class="table-wrap"><table style="white-space:nowrap">
    <thead><tr>${TH}</tr></thead>
    <tbody>
${peekCity.list.slice(0, PEEK_ROWS).map((h) => `    ${hrow(h)}`).join('\n')}
    </tbody></table></div>`
const peekNext = `    <h4 class="pk">${esc(nextCity.city)}（${nextCity.list.length}件）</h4>`
const TOEI_PEEK = `${peekBody}\n${peekNext}`
{
  // タグを外した文字の並びが、資料の本文にそのまま入っていること（書き直しが混ざっていないこと）。
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
  const packFlat = flat(packHtml)
  if (!packFlat.includes(flat(peekBody)) || !packFlat.includes(flat(peekNext))) die('抜粋が有料資料の本文と一致しません（抜粋の作り方を確認）。')
}
// ★2026-09-13(2) 抜粋の表には住宅侵入の件数が載る。記事には「率ではない・所在地と一致しない場合がある・0件の意味・出典」が
//   どこにも無かったので、記事の抜粋の枠の外に添える（抜粋の中は資料そのままにするため、枠の中には書き足さない）。
const PEEK_NOTE = `抜粋の表の右端は、住宅名と同じ名前の町丁目の数字です（姉妹サイト<a href="${esc(ENV.site)}/">住環境データ東京</a>が町丁目ごとに集計）。住宅侵入は${WIN_TXT}の<strong>件数そのもので、率ではありません</strong>（世帯の多い町ほど大きく出ます）。<strong>建物の所在地がその町丁目と一致しない場合があります</strong>。「（町全体・2つの丁目）」のように書いたものは、住宅名が町の名前までしか一致しなかったときの、町全体の合計です（丁目が${TOWN_MAX_CHOME}つ以下で、世帯が${num(TOWN_MAX_SETAI)}未満の町だけ）。「数字なし」は、町が広いか、同じ区に同じ名前の町丁目が2つ以上あって決められないため、数字を付けていないという意味です（同じ名前の町丁目が見つからないものは「—」）。0件は被害がなかったという意味ではありません（警察に届出があって初めて数えられます）。出典＝警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（東京都オープンデータ・<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" rel="license">CC BY 4.0</a>）、総務省統計局「令和2年国勢調査 小地域集計」（世帯数）。当サイトが住宅名と突き合わせて加工したもので、警視庁・総務省統計局が作成したものではありません。`
const tpl = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
write('scripts/toei-peek.mjs', `// 自動生成：scripts/toei-nerai.mjs が .dist/toei-pack.html と同じ行から書く。手で直さない。
// 有料資料の2章の冒頭。表は上${PEEK_ROWS}行で切っている。記事への貼り付けは scripts/stamp-offers.mjs。
// 資料＝${RANGE}の定期募集${F.rounds}回・読み取り日 ${READ_AT}
export const TOEI_PEEK = \`${tpl(TOEI_PEEK)}\`
// 抜粋の表の右端（住環境の数字）に添える注記。記事では抜粋の枠の外に置く（scripts/offer-block.mjs）。
export const TOEI_PEEK_NOTE = \`${tpl(PEEK_NOTE)}\`
// 売り場カードの文言に使う数（資料と同じ定数）：観測の下限（募集件数）・すいているの線（倍率）・募集回の数
export const TOEI_FACTS = ${JSON.stringify({ minN: MIN_N, suki: SUKI, rounds: F.rounds })}
`)

// ── トップページ（index.html・手書き）の /toei/ の案内カード ─────────────────────
//   ★2026-09-13 カードの件数が手書きで、母数を戻したら /toei/ と食い違った（13,349件・1,320件・689件のまま）。
//     カードの <p> だけをここで書き換える。見つからない・2つ以上あるときは止める（黙って古いまま出さない）。
{
  const top = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const re = /(<a class="card" href="toei\/">\s*<span class="cat">[^<]*<\/span>\s*<h3>[^<]*<\/h3>\s*<p>)([\s\S]*?)(<\/p>\s*<\/a>)/g
  const hits = top.match(re) || []
  if (hits.length !== 1) die(`index.html の /toei/ の案内カードが ${hits.length} 個見つかりました（1個のはず）。`)
  const card = `定期募集${F.rounds}回・${num(F.rows)}件を住宅と募集区分ごとに名寄せしました。倍率の中央値は${F.allMed}倍で、${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は${SUKI}倍未満。<strong>区市町ごとの相場と条件別の効き目は無料。住宅名つきの一覧が${PRICE}円です。</strong>`
  const next = top.replace(re, (_, a, _b, c) => a + card + c)
  if (next !== top) write('index.html', next)
}

// ── sitemap.xml（この艦のsitemapは手書きで育てたもの。/toei/ の1行だけ書き換える）──
//   ★/toei/kanryo/ は購入者専用（noindex）なので載せない。
//   ★2026-09-13 lastmod を「倍率表の読み取り日」から「/toei/ の中身が変わった日」に変えた。読み取り日のままだと、
//     母数や注記を変えて作り直しても8月の日付のまま残る。中身が変わらなければ前の日付を保つ。
//   ★行を消して末尾に付け直すのをやめ、その場で置き換える（毎回行が動いて差分が読めなくなるため）。
{
  const smPath = path.join(ROOT, 'sitemap.xml')
  const sm = fs.readFileSync(smPath, 'utf8')
  const head = `<url><loc>${SITE}/toei/</loc>`
  const count = sm.split(head).length - 1
  if (count > 1) die(`sitemap.xml に /toei/ が ${count} 行あります（1行のはず）。`)
  const at = sm.indexOf(head)
  const old = at >= 0 ? sm.slice(at, sm.indexOf('</url>', at) + '</url>'.length) : ''
  const prevLastmod = (/<lastmod>([^<]+)<\/lastmod>/.exec(old) || [])[1] || ''
  const freePath = path.join(ROOT, 'toei', 'index.html')
  const freeNew = pending.find(([rel]) => rel === 'toei/index.html')[1]
  const changed = !fs.existsSync(freePath) || fs.readFileSync(freePath, 'utf8') !== freeNew
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)   // 日本時間の日付
  const entry = `<url><loc>${SITE}/toei/</loc><lastmod>${changed ? today : (prevLastmod || READ_AT)}</lastmod><priority>0.9</priority></url>`
  const next = old ? sm.slice(0, at) + entry + sm.slice(at + old.length) : sm.replace('</urlset>', `  ${entry}\n</urlset>`)
  if (next !== sm) write('sitemap.xml', next)
}

flush()
console.log(`無料ページ /toei/ と購入後画面を作成`)
if (SPILL.length) console.log(`  区市町名の読み取り切れを直した行 ${SPILL.length}：${SPILL.map((s) => `${s.round} 「${s.city}」＋「${s.head}」→ ${s.ward}（${s.name}）`).join(' / ')}`)
console.log(`有料資料 .dist/toei-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
console.log(`  募集${num(F.rows)}件 → 住宅${F.all}件（うち${MIN_N}件以上観測 ${F.enough}件）`)
console.log(`  すいている ${F.suki}件（一般${F.sukiIppan}／事故住宅${F.suki - F.sukiIppan}）・ぶれる ${F.buread}件・申込0あり ${F.zeroHouses}件`)
console.log(`  区の取り戻し: 行頭に区市町なし ${LEDGER.untrusted}行 → 台帳で区を確定 ${LEDGER.recovered}行（うち頭の区市町名を外して ${LEDGER.recoveredStem}・引き継ぎの区と違う ${LEDGER.moved}）／複数の区 ${LEDGER.multi}／台帳に無い ${LEDGER.none}`)
console.log(`  行頭に区市町あり ${LEDGER.head}行のうち町丁目名が1区だけ ${LEDGER.checked}行（うち頭の区市町名を外して ${LEDGER.checkedStem}）・食い違い ${LEDGER.conflict}行${LEDGER.conflictEx.length ? '：' + LEDGER.conflictEx.join(' / ') : ''}`)
{
  const byName = new Map(houses.map((h) => [`${h.city}|${h.name}`, h.env]))
  const lv = (list, l) => list.filter((e) => e && e.level === l).length
  const envs = [...byName.values()]
  const idx = enough.map((h) => h.env)
  console.log(`  抜粋 scripts/toei-peek.mjs（2章 ${peekCity.city}の上${PEEK_ROWS}行）／トップのカード・sitemap: ${pending.map(([rel]) => rel).filter((rel) => rel === 'index.html' || rel === 'sitemap.xml').join('・') || '変更なし'}`)
  console.log(`  条件別の表の母数: ${cuts.map((c) => `${c.label} ${c.base}`).join('／')}・建築の年が混ざる ${F.eraMixed}件`)
  console.log(`  次に: node scripts/stamp-offers.mjs（記事12本の抜粋を貼り直す）。KV へは scripts/toei-put-pack.mjs（入れる前に資料・/toei/・トップ・記事を突き合わせる）`)
  console.log(`  住環境の数字: 索引${F.enough}件中 ${F.envEnough}件（頭の区市町名を外して ${enough.filter((h) => hasNum(h.env) && h.env.stem).length}・町丁目 ${lv(idx, 'area')}・町全体 ${lv(idx, 'town')}）・数字なし（町が広い ${lv(idx, 'wide')}・決められない ${lv(idx, 'ambiguous')}・見つからない ${idx.filter((e) => !e).length}）／区×住宅名 ${byName.size}件中 ${envs.filter(hasNum).length}件（町丁目 ${lv(envs, 'area')}・町全体 ${lv(envs, 'town')}・町が広い ${lv(envs, 'wide')}・決められない ${lv(envs, 'ambiguous')}）／無料ページの表 ${konde.slice(0, 10).filter((h) => hasNum(h.env)).length}/10`)
  // 町全体の線で分けた町（索引に出る行の数つき）
  const townList = (l) => {
    const m = new Map()
    for (const h of enough) if (h.env && h.env.level === l) { const k = `${h.city}${h.env.label}（${tsu(h.env.chome)}の${h.env.unit}・世帯${num(h.env.setai)}）`; m.set(k, (m.get(k) || 0) + 1) }
    return [...m].map(([k, n]) => `${k}×${n}`).join(' / ')
  }
  console.log(`  町全体の合計を出した町: ${townList('town') || 'なし'}`)
  console.log(`  町が広いため数字なしにした町: ${townList('wide') || 'なし'}`)
}
