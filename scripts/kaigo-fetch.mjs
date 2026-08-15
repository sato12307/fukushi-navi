// ─────────────────────────────────────────────────────────────────────────────
// kaigo-fetch.mjs — 厚労省「介護サービス情報公表システム」オープンデータの
//   2断面（最古＝2020年12月末 / 最新＝2026年6月末）を取得して、
//   事業所番号で突き合わせ「一覧から消えた事業所」を市区町村×サービス種別で数える。
//
// ★この艦が扱うのは「観測」であって「廃業の確定」ではない。
//   一覧から消える理由は廃止・休止・法人名変更・指定更新の遅れ・様式変更など複数あり、
//   公表データのどこにも理由は書かれていない。だから出力にも理由を書かない。
//
// ★公式は半年ごとの全断面を恒久公開している（2020年12月〜）。
//   つまりこの集計は誰でも再現できる＝時間の非対称性は無い。堀は主張しない。
//   価値は「誰も並べていないこと」＝占有がゼロであることのみ。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'kaigo')
const OUT = path.join(ROOT, 'data')
const PAGE = 'https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html'
const BASE = 'https://www.mhlw.go.jp'

// 扱うサービス種別（利用者数が多く、地域の受け皿として意味がある8種に絞る）
const TARGETS = {
  110: '訪問介護',
  130: '訪問看護',
  150: '通所介護',
  160: '通所リハビリテーション',
  210: '短期入所生活介護',
  320: '認知症対応型共同生活介護',
  430: '居宅介護支援',
  780: '地域密着型通所介護',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── ページを断面ごとに切り、各断面の「種別コード → zip URL」を作る
async function snapshots() {
  const html = await (await fetch(PAGE)).text()
  const heads = [...html.matchAll(/(20\d\d)年([０-９\d]{1,2})月末時点/g)]
  const norm = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const secs = []
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index
    const end = i + 1 < heads.length ? heads[i + 1].index : html.length
    const label = `${heads[i][1]}-${String(norm(heads[i][2])).padStart(2, '0')}`
    const body = html.slice(start, end)
    // 断面によって置き方が違う（最新はCSV直置き、過去はZIP）。両方拾う。
    const map = new Map()
    for (const m of body.matchAll(/href="([^"]*jigyosho_(\d+)_all[^"]*\.zip)"/g)) map.set(m[2], m[1])
    for (const m of body.matchAll(/href="([^"]*\/jigyosho_(\d+)\.csv)"/g)) if (!map.has(m[2])) map.set(m[2], m[1])
    secs.push({ label, map })
  }
  return secs.filter((s) => s.map.size > 0)
}

async function grab(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest
  const r = await fetch(BASE + url, { headers: { 'user-agent': 'fukushiru-bot (+https://fukushiru.com/)' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
  await sleep(1500) // 公的サイトなので間隔を空ける
  return dest
}

function decode(buf) {
  let text = buf.toString('utf8')
  if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf)
  return text
}
// zip でも csv でも同じように中身のテキストを返す
function readAny(file, workDir) {
  if (/\.csv$/i.test(file)) return decode(fs.readFileSync(file))
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  execSync(`tar -xf "${file}" -C "${workDir}"`)
  const csv = fs.readdirSync(workDir).find((f) => /\.csv$/i.test(f))
  if (!csv) return null
  return decode(fs.readFileSync(path.join(workDir, csv)))
}

// 引用符に対応した素朴なCSV行分割
function splitCsv(line) {
  const out = []
  let cur = '', q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function parse(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return null
  const head = splitCsv(lines[0]).map((s) => s.replace(/^"|"$/g, '').trim())
  const idx = {
    no: head.findIndex((h) => /事業所番号/.test(h)),
    pref: head.findIndex((h) => /都道府県名/.test(h)),
    city: head.findIndex((h) => /市区町村名/.test(h)),
  }
  if (idx.no < 0) return null
  const rows = []
  for (const l of lines.slice(1)) {
    const c = splitCsv(l)
    const no = (c[idx.no] || '').trim()
    if (!no) continue
    rows.push({ no, pref: (c[idx.pref] || '').trim(), city: (c[idx.city] || '').trim() })
  }
  return rows
}

// ── 実行
const secs = await snapshots()
console.log(`断面: ${secs.map((s) => s.label).join(' / ')}`)
const oldSec = secs[secs.length - 1]
const newSec = secs[0]
console.log(`比較: ${oldSec.label} → ${newSec.label}\n`)

const result = { generated_on: new Date().toISOString().slice(0, 10), from: oldSec.label, to: newSec.label, services: [], byPref: {}, byCity: {} }

for (const [code, name] of Object.entries(TARGETS)) {
  const oldUrl = oldSec.map.get(code), newUrl = newSec.map.get(code)
  if (!oldUrl || !newUrl) { console.log(`  ${code} ${name}: 断面が揃わないので除外`); continue }
  const ext = (u) => (/\.csv$/i.test(u) ? 'csv' : 'zip')
  const oldFile = await grab(oldUrl, path.join(CACHE, `${oldSec.label}_${code}.${ext(oldUrl)}`))
  const newFile = await grab(newUrl, path.join(CACHE, `${newSec.label}_${code}.${ext(newUrl)}`))
  const a = parse(readAny(oldFile, path.join(CACHE, 'w_old')) || '')
  const b = parse(readAny(newFile, path.join(CACHE, 'w_new')) || '')
  if (!a || !b) { console.log(`  ${code} ${name}: CSVを読めないので除外`); continue }

  const nowSet = new Set(b.map((r) => r.no))
  const gone = a.filter((r) => !nowSet.has(r.no))
  const svc = { code, name, old: a.length, now: b.length, gone: gone.length, gonePct: Math.round((gone.length / a.length) * 1000) / 10 }
  result.services.push(svc)
  console.log(`  ${code} ${name.padEnd(18)} ${String(a.length).padStart(6)} → ${String(b.length).padStart(6)} / 消えた ${String(gone.length).padStart(6)} (${svc.gonePct}%)`)

  for (const r of gone) {
    if (!r.pref) continue
    result.byPref[r.pref] ||= { gone: 0, byService: {} }
    result.byPref[r.pref].gone++
    result.byPref[r.pref].byService[name] = (result.byPref[r.pref].byService[name] || 0) + 1
    if (r.city) {
      const key = `${r.pref}|${r.city}`
      result.byCity[key] ||= { gone: 0 }
      result.byCity[key].gone++
    }
  }
  // 現存側も県別に数える（分母がないと「多い/少ない」が言えない）
  for (const r of b) {
    if (!r.pref) continue
    result.byPref[r.pref] ||= { gone: 0, byService: {} }
    result.byPref[r.pref].now = (result.byPref[r.pref].now || 0) + 1
  }
  for (const r of a) {
    if (!r.pref) continue
    result.byPref[r.pref].old = (result.byPref[r.pref].old || 0) + 1
  }
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'kaigo-genshou.json'), JSON.stringify(result, null, 1))
const tot = result.services.reduce((s, x) => s + x.gone, 0)
const totOld = result.services.reduce((s, x) => s + x.old, 0)
console.log(`\n合計: ${totOld.toLocaleString()}事業所のうち ${tot.toLocaleString()}件が一覧から消えた (${(tot / totOld * 100).toFixed(1)}%)`)
console.log(`data/kaigo-genshou.json を書き出しました。`)
