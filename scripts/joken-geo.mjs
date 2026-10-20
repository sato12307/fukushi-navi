// ─────────────────────────────────────────────────────────────────────────────
// joken-geo.mjs — 市営住宅の団地の住所から、最寄り駅と駅までの直線距離を出す（2026-10-20）
//
//   node scripts/joken-geo.mjs <国のデータを展開したフォルダ> kawasaki yokohama sagamihara kobe
//
// ★なぜ直線距離か
//   ユーザー「駅からの距離は…直線距離でもいいと思います」（2026-10-20）。公式の徒歩分が全団地にそろうのは
//   川崎だけで、横浜・神戸は募集の回に出た住宅だけ、相模原は公式資料に無い。4市を同じ物差しで並べるため、
//   全団地を「住所の位置→いちばん近い駅のホームまでの直線距離」で測る。面には「直線◯m（目安）」と書く。
//
// ★使うデータ（どちらも国土交通省・出典を明記すれば加工・公開してよい）
//   位置参照情報（街区レベル 24.0a・大字町丁目レベル 19.0b）… https://nlftp.mlit.go.jp/isj/
//     例: <dir>/14000-24.0a/14_2025.csv・<dir>/14000-19.0b/14000-19.0b/14_2025.csv（Shift_JIS）
//   国土数値情報 鉄道（N02-25・CC BY 4.0）… https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html
//     例: <dir>/N02-25_GML/N02-25_GML/UTF-8/N02-25_Station.geojson（駅はホームの線で入っている）
//   ★大きいのでリポジトリには入れない。出した結果（data/joken-geo.json）だけを置く。
//   ★座標は面に出さない（出すのは駅名と距離だけ）。
//
// ★住所の当て方
//   1) 市区町村＋大字・丁目＋街区符号（住居表示）または地番で、街区レベルの点に当てる（level: 'gaiku'）
//   2) 当たらなければ、大字・丁目の代表点に当てる（level: 'choume'。数百m ずれることがある）
//   3) それでも駄目なら当てない（null）。当てずっぽうの点で距離を出さない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [GEO_DIR, ...CITY_KEYS] = process.argv.slice(2)
if (!GEO_DIR || !CITY_KEYS.length) {
  console.error('使い方: node scripts/joken-geo.mjs <国のデータのフォルダ> kawasaki yokohama sagamihara kobe')
  process.exit(1)
}
const PREF = { kawasaki: '14', yokohama: '14', sagamihara: '14', kobe: '28', test14: '14', test28: '28' }
const PREF_NAME = { 14: '神奈川県', 28: '兵庫県' }

// ── Shift_JIS の CSV を読む ──────────────────────────────────────────────────
const sjis = new TextDecoder('shift_jis')
const readCsv = (p) => {
  const t = sjis.decode(fs.readFileSync(p))
  return t.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(',').map((s) => s.replace(/^"|"$/g, '')))
}
const findFile = (dir, re) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { const f = findFile(p, re); if (f) return f } else if (re.test(p.replace(/\\/g, '/'))) return p
  }
  return null
}

const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const toKanji = (n) => {
  n = Number(n)
  if (n < 10) return KANJI[n]
  if (n < 20) return '十' + (n % 10 ? KANJI[n % 10] : '')
  return KANJI[Math.floor(n / 10)] + '十' + (n % 10 ? KANJI[n % 10] : '')
}
const kanjiToNum = (s) => {
  if (/^\d+$/.test(s)) return Number(s)
  let n = 0, cur = 0
  for (const ch of s) {
    const d = KANJI.indexOf(ch)
    if (d >= 0) cur = d
    else if (ch === '十') { n += (cur || 1) * 10; cur = 0 }
  }
  return n + cur
}
// 住所の正規化：全角→半角、ヶ/ケ/が・之の揺れ、空白、ハイフンの種類
const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/[‐‑‒–—―−ー－]/g, (c, i, str) => (/\d/.test(str[i - 1] || '') ? '-' : c))
const fold = (s) => norm(s).replace(/[ヶケヵが]/g, 'ケ').replace(/之/g, 'ノ').replace(/の/g, 'ノ')

// ── 位置参照情報を読み込む ───────────────────────────────────────────────────
const gaiku = new Map()   // `${市区町村}|${大字fold}|${街区}` → [lat, lon]
const choume = new Map()  // `${市区町村}|${大字fold}` → [lat, lon]
const ooaza = new Map()   // 市区町村 → 大字の名前（fold）の配列（長い順）
for (const pc of [...new Set(CITY_KEYS.map((k) => PREF[k]).filter(Boolean))]) {
  const fa = findFile(GEO_DIR, new RegExp(`${pc}000-24\\.0a/.*${pc}_\\d+\\.csv$`))
  const fb = findFile(GEO_DIR, new RegExp(`${pc}000-19\\.0b/.*${pc}_\\d+\\.csv$`))
  if (!fa || !fb) { console.error(`位置参照情報（${PREF_NAME[pc]}）が ${GEO_DIR} に見つかりません`); process.exit(1) }
  for (const r of readCsv(fa)) {
    const [, city, oa, koaza, ban, , , , lat, lon, , daihyo] = r
    const k = `${city}|${fold(oa + koaza)}|${norm(ban)}`
    if (!gaiku.has(k) || daihyo === '1') gaiku.set(k, [Number(lat), Number(lon)])
    // 小字を含まない形でも引けるようにする
    const k2 = `${city}|${fold(oa)}|${norm(ban)}`
    if (koaza && !gaiku.has(k2)) gaiku.set(k2, [Number(lat), Number(lon)])
  }
  for (const r of readCsv(fb)) {
    const [, , , city, , oa, lat, lon] = r
    choume.set(`${city}|${fold(oa)}`, [Number(lat), Number(lon)])
    if (!ooaza.has(city)) ooaza.set(city, new Set())
    ooaza.get(city).add(fold(oa))
  }
  for (const r of readCsv(fa)) { if (!ooaza.has(r[1])) ooaza.set(r[1], new Set()); ooaza.get(r[1]).add(fold(r[2])) }
}
for (const [c, s] of ooaza) ooaza.set(c, [...s].sort((a, b) => b.length - a.length))

// 住所 → { lat, lon, level, hit }
function geocode (addr) {
  let a = norm(addr).replace(/^(神奈川県|兵庫県)/, '')
  const m = a.match(/^(横浜市..?区|川崎市..?区|相模原市..?区|神戸市..?区|[^市]+市)/)
  if (!m) return null
  // 区の名前の長さ（中区・北区のような1文字の区がある）を、位置参照情報の市区町村名で確かめる
  let city = null
  for (const c of ooaza.keys()) if (a.startsWith(c) && (!city || c.length > city.length)) city = c
  if (!city) return null
  let rest = fold(a.slice(city.length)).replace(/^字/, '')
  // 「4丁目」「四丁目」→ 漢数字の丁目にそろえる
  rest = rest.replace(/(\d+)丁目/, (_, d) => toKanji(d) + '丁目')
  const names = ooaza.get(city)
  // 1) 「矢向四丁目12番1号」「矢向四丁目12-1」
  for (const oa of names) {
    if (!rest.startsWith(oa)) continue
    const tail = rest.slice(oa.length).replace(/^字/, '')
    const num = tail.match(/^(\d+)/)
    if (num && gaiku.has(`${city}|${oa}|${num[1]}`)) return { ll: gaiku.get(`${city}|${oa}|${num[1]}`), level: 'gaiku', hit: `${city}${oa}${num[1]}` }
    if (choume.has(`${city}|${oa}`)) {
      // 2) 「矢向4-12-1」の形（丁目が数字のまま）：大字の名前＋数字の丁目を試す
      const cm = tail.match(/^(\d+)-(\d+)/)
      if (cm) {
        const oa2 = oa + toKanji(cm[1]) + '丁目'
        if (gaiku.has(`${city}|${oa2}|${cm[2]}`)) return { ll: gaiku.get(`${city}|${oa2}|${cm[2]}`), level: 'gaiku', hit: `${city}${oa2}${cm[2]}` }
        if (choume.has(`${city}|${oa2}`)) return { ll: choume.get(`${city}|${oa2}`), level: 'choume', hit: `${city}${oa2}` }
      }
      return { ll: choume.get(`${city}|${oa}`), level: 'choume', hit: `${city}${oa}` }
    }
  }
  // 3) 大字の名前の後ろに数字の丁目が付く形（「矢向4-12」で「矢向」だけが大字の一覧に無い）
  const cm = rest.match(/^(.+?)(\d+)-(\d+)/)
  if (cm) {
    const oa2 = cm[1] + toKanji(cm[2]) + '丁目'
    if (gaiku.has(`${city}|${oa2}|${cm[3]}`)) return { ll: gaiku.get(`${city}|${oa2}|${cm[3]}`), level: 'gaiku', hit: `${city}${oa2}${cm[3]}` }
    if (choume.has(`${city}|${oa2}`)) return { ll: choume.get(`${city}|${oa2}`), level: 'choume', hit: `${city}${oa2}` }
  }
  return null
}

// ── 駅（ホームの線）までの最短距離 ───────────────────────────────────────────
const stFile = findFile(GEO_DIR, /UTF-8\/N02-\d+_Station\.geojson$/)
if (!stFile) { console.error(`国土数値情報の駅データ（N02_Station.geojson）が ${GEO_DIR} に見つかりません`); process.exit(1) }
const stations = JSON.parse(fs.readFileSync(stFile, 'utf8')).features.map((f) => ({
  name: f.properties.N02_005, line: f.properties.N02_003, op: f.properties.N02_004,
  pts: f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat(),
}))
const R = 6371008.8
// 点から線分までの距離（m）。団地のまわり数km なので、点の緯度で平面に引き延ばして測る（誤差は1m未満）
function distToStation ([lat, lon], st) {
  const kx = Math.cos(lat * Math.PI / 180) * Math.PI / 180 * R, ky = Math.PI / 180 * R
  let best = Infinity
  const P = st.pts.map(([x, y]) => [(x - lon) * kx, (y - lat) * ky])
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[i + 1] || P[i]
    const dx = x2 - x1, dy = y2 - y1
    const t = dx || dy ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy))) : 0
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy))
  }
  return best
}
function nearest (ll) {
  let best = null
  for (const st of stations) {
    const [x, y] = st.pts[0]
    if (Math.abs(y - ll[0]) > 0.05 || Math.abs(x - ll[1]) > 0.06) continue   // 約5km より遠い駅は測らない
    const d = distToStation(ll, st)
    if (!best || d < best.d) best = { d, st }
  }
  return best
}

// 試しの入口：node scripts/joken-geo.mjs <dir> test14 "横浜市鶴見区矢向四丁目12番1号" …（何も書き出さない）
if (CITY_KEYS[0].startsWith('test')) {
  for (const a of CITY_KEYS.slice(1)) { const h = geocode(a); const nb = h && nearest(h.ll); console.log(a, '→', h ? `${h.level} ${h.hit} ${h.ll}` : '当たらない', nb ? `${nb.st.name}（${nb.st.line}）${Math.round(nb.d)}m` : '') }
  process.exit(0)
}

// ── 市ごとに当てる ──────────────────────────────────────────────────────────
const outPath = path.join(ROOT, 'data', 'joken-geo.json')
const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {}
out.note = '団地の住所を国土交通省「位置参照情報」（街区レベル・大字町丁目レベル）で位置に直し、国土交通省「国土数値情報（鉄道データ）」の駅（ホームの線）までの直線距離を測ったもの。座標は面に出さない。scripts/joken-geo.mjs が作る。'
out.sources = [
  { name: '位置参照情報（街区レベル 24.0a・大字町丁目レベル 19.0b）', org: '国土交通省', url: 'https://nlftp.mlit.go.jp/isj/' },
  { name: '国土数値情報（鉄道データ）N02-25', org: '国土交通省', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html', license: 'CC BY 4.0' },
]
out.cities = out.cities || {}
for (const key of CITY_KEYS) {
  const src = path.join(ROOT, 'data', `joken-${key}.json`)
  if (!fs.existsSync(src)) { console.error(`data/joken-${key}.json がありません`); process.exit(1) }
  const J = JSON.parse(fs.readFileSync(src, 'utf8'))
  const res = {}
  const miss = []
  let g = 0, c = 0, o = 0
  for (const r of J.rows) {
    const hit = r.addr ? geocode(r.addr) : null
    if (!hit) { miss.push(`${r.name}（${r.addr || '住所なし'}）`); res[r.name] = null; continue }
    // ★丁目の無い大字（「山田町下谷上」など）の代表点は、実際の団地から何km もずれることがある。
    //   level を 'ooaza' にして、面では距離を条件に使わない（koei-nerai.mjs）。丁目の代表点（'choume'）は数百m のずれで済む
    if (hit.level === 'choume' && !/丁目$/.test(hit.hit)) hit.level = 'ooaza'
    const nb = nearest(hit.ll)
    if (hit.level === 'gaiku') g++; else if (hit.level === 'choume') c++; else o++
    res[r.name] = {
      level: hit.level, hit: hit.hit,
      lat: Number(hit.ll[0].toFixed(6)), lon: Number(hit.ll[1].toFixed(6)),
      station: nb ? nb.st.name : null, line: nb ? nb.st.line : null, op: nb ? nb.st.op : null,
      distM: nb ? Math.round(nb.d) : null,
    }
  }
  out.cities[key] = { updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), rows: res }
  console.log(`■ ${J.city}：${J.rows.length}団地 → 街区で当てた ${g}・丁目の代表点 ${c}・大字の代表点（距離は使わない） ${o}・当たらない ${miss.length}`)
  if (miss.length) console.log('   当たらない: ' + miss.slice(0, 20).join(' ／ ') + (miss.length > 20 ? ` ほか${miss.length - 20}` : ''))
  // 公式の最寄り駅がある市（川崎・神戸）は、こちらの最寄り駅と食い違う件数を出す（当て方の確かめ）
  const off = J.rows.filter((r) => r.station && res[r.name] && res[r.name].station && norm(res[r.name].station) !== norm(r.station))
  const withSt = J.rows.filter((r) => r.station && res[r.name]).length
  if (withSt) console.log(`   公式の最寄り駅と一致 ${withSt - off.length}/${withSt}（食い違いの例: ${off.slice(0, 6).map((r) => `${r.name} 公式${r.station}↔${res[r.name].station}${res[r.name].distM}m`).join('、')}）`)
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(`→ data/joken-geo.json`)
