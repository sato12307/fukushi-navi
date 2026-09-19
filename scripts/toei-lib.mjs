// ─────────────────────────────────────────────────────────────────────────────
// toei-lib.mjs — 都営住宅の倍率表を読んで、住宅×募集区分ごとに畳むところまで。
//
// ★なぜ分けたか（2026-09-17）
//   この読み取り（区市町の取り戻し・町丁目台帳との突き合わせ・住宅×募集区分での名寄せ）を
//   使う生成器が2つになった。
//     scripts/toei-nerai.mjs  … 無料ページ /toei/ と有料資料 .dist/toei-pack.html
//     scripts/toei-machi.mjs  … 区市町別ページ48本と募集区分別ページ
//   写経すると必ずずれる（片方だけ直る）。読み取りの正典はこのファイル1つ。
//   [[same-question-two-implementations]]
//
//   ★ここには「どう出すか」を書かない。出し方は呼ぶ側に置く。
//     ここに入れてよいのは「何件だったか」までで、見出しも文章も持たせない。
//
// 元の説明（読み取りの設計。ここが一番大事なので丸ごと残す）：
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

// ── 築年数と「住みやすさ」の格付け（2026-09-19）────────────────────────────
// ★なぜ足したか
//   商品が「倍率の低い順」だけで選ばせていた。倍率だけで切ると、**空いている理由**が
//   そのまま集まる。実測（この資料の母数そのもので計算）:
//     いま出している「毎回すいている」595件 … EV有 70% / 多摩の市町村 50%
//     逆に混んでいる側          547件 … EV有 92% / 多摩の市町村 18%
//   ∴ 買った人の約半分が「EV無 または 築46年以上」を見せられていた。
//   倍率が低いこと自体は事実だが、それだけを並べるのは芸が無いうえに不親切。
//
// ★築年数と倍率の関係は**単調ではない**（ここが肝）。行ベースの中央値:
//     築0-9年 7.0倍 / 10-19年 10.0倍 / 20-29年 9.0倍 /
//     30-39年 2.5倍 / 40-49年 1.5倍 / **50年以上 7.3倍**
//   古いほど空くのではなく、**築50年超は都心に多いので立地が効いて高い**
//   （渋谷区の築中央56年・大田区55年・品川区56年）。
//   ∴「築年数が浅い＝人気」と単純化して書かない。相関も r=-0.10 しかない。
//   いちばん効く単独の条件は**エレベーター**（EV有6.0倍 ↔ EV無1.3倍・r=+0.31）。
const NOW = new Date(Date.now() + 9 * 3600 * 1000).getFullYear()
const GENGO = { 昭和: 1925, 平成: 1988, 令和: 2018 }
const eraYear = (e) => {
  const m = String(e || '').match(/^(昭和|平成|令和)(\d+)$/)
  return m ? GENGO[m[1]] + Number(m[2]) : null
}
for (const h of houses) {
  h.builtY = eraYear(h.era)
  h.age = h.builtY ? NOW - h.builtY : null
}

const enough = houses.filter((h) => h.n >= MIN_N)
const suki = enough.filter((h) => h.med < SUKI)
const sukiIppan = suki.filter((h) => !h.jiko)

// 築年数の中央値は**申込先ベース**で取る（行ベースだと募集回数の多い住宅に引っ張られる）。
const AGE_MED = med(enough.filter((h) => h.age != null).map((h) => h.age))
// 黄金比＝「当たりやすさ」と「住みやすさ」の両方。ここで使う条件は3つだけ。
//   ① 倍率の中央値が SUKI 倍未満（毎回すいている）
//   ② エレベーターが有る（単独でいちばん効く条件）
//   ③ 築年数が申込先の中央値以下
// ★立地は点数にしない。どこが良いかは読む人が決めることで、こちらが順位を付けるものではない。
//   代わりに区市町で引けるようにして、安く見える申込先が多摩に偏っていることを数字で書く。
const isGold = (h) => h.med < SUKI && h.ev === '有' && h.age != null && h.age <= AGE_MED
for (const h of houses) h.gold = isGold(h)
const gold = sukiIppan.filter((h) => h.gold)
// 黄金比から外れる側＝EVが無い、または築年数が中央値より古い。ここが買った人の落とし穴。
const sukiOff = sukiIppan.filter((h) => !h.gold)
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
// ★cutNote（表の下に出す注記）はここに置かない。文章は呼ぶ側の持ち物で、ここは件数まで。

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
  // 黄金比まわり。本文に直書きすると回が増えたときに古くなるので、ここから引く。
  ageMed: AGE_MED,
  gold: gold.length,
  sukiOff: sukiOff.length,
  sukiOffPct: Math.round((sukiOff.length / sukiIppan.length) * 100),
  // 偏りの実測（本文の「こう偏る」の根拠。負けている側も同じ式で出す）
  sukiEvPct: Math.round((sukiIppan.filter((h) => h.ev === '有').length / sukiIppan.length) * 100),
  kondeEvPct: Math.round((konde.filter((h) => h.med >= SUKI && h.ev === '有').length
    / konde.filter((h) => h.med >= SUKI).length) * 100),
  sukiTamaPct: Math.round((sukiIppan.filter((h) => /(市|町|村)$/.test(h.city)).length / sukiIppan.length) * 100),
  kondeTamaPct: Math.round((konde.filter((h) => h.med >= SUKI && /(市|町|村)$/.test(h.city)).length
    / konde.filter((h) => h.med >= SUKI).length) * 100),
  goldMed: r1(med(gold.map((h) => h.med))),
  goldAgeMed: med(gold.filter((h) => h.age != null).map((h) => h.age)),
  goldCities: new Set(gold.map((h) => h.city)).size,
}
const era = (r) => `${r.slice(0, 4)}年${Number(r.slice(5))}月`
const RANGE = `${era(F.from)}〜${era(F.to)}`

export {
  ROOT,
  PRICE,
  MIN_N,
  SUKI,
  MIN_CITY,
  BURE,
  TOWN_MAX_CHOME,
  TOWN_MAX_SETAI,
  SRC,
  JIKO,
  SRC_JSON,
  raw,
  READ_AT,
  ENV_JSON,
  CITYDICT,
  ENV,
  looseKey,
  KANSUJI,
  kan,
  placeKey,
  houseKey,
  AREA_BY_KEY,
  TOWN_BY_KEY,
  WARDS,
  STEMS,
  STEM_OF,
  stripStem,
  wardsNamed,
  envByKey,
  hasNum,
  envOf,
  SPILL,
  fixSpill,
  LEDGER,
  rows,
  ROUNDS,
  med,
  r1,
  mode,
  by,
  houses,
  enough,
  suki,
  sukiIppan,
  AGE_MED,
  eraYear,
  isGold,
  gold,
  sukiOff,
  buread,
  konde,
  ALL_MED,
  CITIES,
  byCity,
  cut,
  eraBand,
  groupMed,
  cuts,
  F,
  era,
  RANGE,
}
