// jiritsu-merge-survey.mjs — 都道府県・指定都市の調査結果（scratchpad/jiritsu-survey/part-*.json）を data/jiritsu/authorities.json にまとめる。
//   node scripts/jiritsu-merge-survey.mjs            → 67機関そろっていれば書く（足りなければ足りない機関を出して止める）
//   node scripts/jiritsu-merge-survey.mjs --partial  → そろっていなくても書く（読み取りの試験用）
// 都道府県のコードは2桁、指定都市は市区町村コード5桁（data/muni-master.json から名前で引く）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SURVEY = path.resolve(ROOT, '..', 'jiritsu-ledger', 'survey')   // 調査の原本（scratchpad は同期されないので写しを置く）
const OUT = path.resolve(ROOT, '..', 'jiritsu-ledger', 'authorities.json')   // 調査のメモ（規約の判定）を含むので、公開されるフクシルの data/ には置かない
const PARTIAL = process.argv.includes('--partial')
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'muni-master.json'), 'utf8')).rows

const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
const CITIES = ['札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '川崎市', '相模原市', '新潟市', '静岡市', '浜松市', '名古屋市', '京都市', '大阪市', '堺市', '神戸市', '岡山市', '広島市', '北九州市', '福岡市', '熊本市']
const cityCode = (name) => { const r = M.find((x) => x.city === name); if (!r) throw new Error('市のコードが引けません: ' + name); return r.code }

const all = []
for (const f of fs.readdirSync(SURVEY).filter((f) => /^part-.*\.json$/.test(f)).sort()) {
  const arr = JSON.parse(fs.readFileSync(path.join(SURVEY, f), 'utf8'))
  for (const x of Array.isArray(arr) ? arr : []) all.push({ ...x, _from: f })
}
const byName = new Map()
for (const x of all) {
  const name = x.authority
  const isPref = PREFS.includes(name), isCity = CITIES.includes(name)
  if (!isPref && !isCity) { console.warn('知らない機関名（捨てる）:', name, x._from); continue }
  const code = isPref ? String(PREFS.indexOf(name) + 1).padStart(2, '0') : cityCode(name)
  const prev = byName.get(name)
  // 同じ機関が2回出たら、ファイルが多いほう・新しい part を採る
  if (prev && (prev.files || []).length > (x.files || []).length) continue
  byName.set(name, { code, authority: name, type: isPref ? 'pref' : 'city', pageUrl: x.pageUrl || null, pageTitle: x.pageTitle || null, files: (x.files || []).filter((f) => f && f.url), includesDesignatedCities: x.includesDesignatedCities ?? null, termsUrl: x.termsUrl || null, termsQuote: x.termsQuote || null, reuse: x.reuse || 'unclear', wayback: x.wayback || null, notes: x.notes || null })
}
// 調査結果に上書きする判断（data/jiritsu/overrides.json・理由つき）
const OV_PATH = path.resolve(ROOT, '..', 'jiritsu-ledger', 'overrides.json')
if (fs.existsSync(OV_PATH)) {
  const OV = JSON.parse(fs.readFileSync(OV_PATH, 'utf8'))
  for (const [name, o] of Object.entries(OV)) {
    if (name.startsWith('_') || !byName.has(name)) continue
    const a = byName.get(name)
    if (o.reuse) a.reuse = o.reuse
    if (o.license) a.license = o.license
    if (o.keepFormats) a.files = a.files.filter((f) => o.keepFormats.includes(f.format))
    a.override = o.why
  }
}
const missing = [...PREFS, ...CITIES].filter((n) => !byName.has(n))
if (missing.length && !PARTIAL) { console.error(`まだ無い機関 ${missing.length}：${missing.join('・')}`); process.exit(1) }
const order = (a) => (a.type === 'pref' ? PREFS.indexOf(a.authority) : 100 + CITIES.indexOf(a.authority))
const out = [...byName.values()].sort((a, b) => order(a) - order(b))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
const cnt = (k) => out.filter((a) => a.reuse === k).length
console.log(`書いた ${out.length}機関${missing.length ? `（まだ無い ${missing.length}）` : ''}／再利用 ok ${cnt('ok')}・prohibited ${cnt('prohibited')}・unclear ${cnt('unclear')}`)
