// ─────────────────────────────────────────────────────────────────────────────
// jutaku-fujo-fetch.mjs — 住宅扶助（家賃・間代等）の限度額が載っていそうなページを集める。
//
//   node scripts/jutaku-fujo-fetch.mjs                 # 候補URLのあるものを落とす
//   node scripts/jutaku-fujo-fetch.mjs --only 秋田県    # 1機関だけ
//   node scripts/jutaku-fujo-fetch.mjs --force         # 取り直す
//   node scripts/jutaku-fujo-fetch.mjs --todo          # 候補がまだ無い機関を並べる
//
// ★なぜ129機関を1つずつ当たるのか（先に全部潰した・2026-09-17）
//   ・住宅扶助の限度額は「生活保護法による保護の基準 別表第三の二」に基づいて
//     **厚生労働大臣が実施機関ごとに告示で定める**。実施機関＝都道府県・指定都市・中核市の129。
//     市町村ごとには決まらない（町村部はその都道府県の額を使う）。
//   ・全国をまとめた機械可読の公表物は **無い**。
//       - e-Gov法令検索に告示は収録されない（「住宅扶助」で引くと法律・省令だけ22件）。
//       - 厚労省「生活保護実施要領等」PDF（001440015.pdf ほか）は課長通知の問答集で別表なし。
//       - 厚労省の法令等データベースはフレーム+JSで、URLから引けない。
//     ∴ 各実施機関の公表ページを1枚ずつ当たるのが唯一の道。
//
// ★1ページでどれだけ取れるか
//   都道府県のページは **県内の級地別 × 世帯人数5段階** を1枚に載せる
//   （例: 埼玉県 1級地47,700 / 2級地43,000 / 3級地37,000 …）。
//   指定都市・中核市はふつう自分の級地の1行だけ。
//   ∴ **47都道府県を先にやるのが効率がよい**（町村部と一般市が全部埋まる）。
//
// ★候補は1本に絞らない
//   都道府県は独立したページを作らず「生活保護のしおり」PDFの中に表を入れていることが多い。
//   検索の1位が当たりとは限らないので、**候補を何本か落として parse に選ばせる**。
//   落とすのは安い。探すのが高い。
//
// ★礼儀：1本ごとに1.2秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'data', 'jutaku-fujo-targets.json')
const CACHE = path.join(ROOT, '.cache', 'jutaku-fujo')
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const FORCE = ARGS.includes('--force')
const TODO = ARGS.includes('--todo')
const ONLY = ARGS.includes('--only') ? ARGS[ARGS.indexOf('--only') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const L = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))

if (TODO) {
  for (const lv of ['都道府県', '指定都市', '中核市']) {
    const all = L.targets.filter((t) => t.level === lv)
    const todo = all.filter((t) => !t.urls.length).map((t) => t.name)
    const ng = all.filter((t) => t.urls.length && t.status !== 'A').map((t) => t.name)
    console.log(`${lv}  読めた ${all.filter((t) => t.status === 'A').length}/${all.length}`)
    if (todo.length) console.log(`  候補がまだ無い(${todo.length}): ${todo.join(' ')}`)
    if (ng.length) console.log(`  候補はあるが読めない(${ng.length}): ${ng.join(' ')}`)
    console.log('')
  }
  process.exit(0)
}

// 保存先は .cache/jutaku-fujo/<機関名>/<URLのハッシュ8桁>.<html|pdf>
const slot = (t) => path.join(CACHE, t.name)
const hash = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 8)
const already = (t, u) =>
  ['html', 'pdf'].map((e) => path.join(slot(t), `${hash(u)}.${e}`)).find((p) => fs.existsSync(p) && fs.statSync(p).size > 500)

const grab = async (t, u) => {
  const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  // 拡張子ではなく中身で判定する（.html を返す PDF 配信がある）
  const isPdf = buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF'
  fs.mkdirSync(slot(t), { recursive: true })
  const dest = path.join(slot(t), `${hash(u)}.${isPdf ? 'pdf' : 'html'}`)
  fs.writeFileSync(dest, buf)
  // どのファイルがどのURLか分かるようにしておく（後で出典として出す）
  const map = path.join(slot(t), 'urls.json')
  const m = fs.existsSync(map) ? JSON.parse(fs.readFileSync(map, 'utf8')) : {}
  m[path.basename(dest)] = u
  fs.writeFileSync(map, JSON.stringify(m, null, 1))
  return { dest, size: buf.length, isPdf }
}

// ★金額はページ本体ではなくPDFに入っていることが多い（神戸市も松山市もそうだった）。
//   検索で拾ったページから **1段だけ** リンクを辿って、それらしいPDFも落とす。
//   たどる相手は「.pdf で終わるもの」か、リンクの文字に住宅扶助・住居確保・基準・しおりが
//   入っているもの。1ページあたり DEEP_MAX 本まで。これ以上は深追いしない
//   （自治体サイト全体のクロールになってしまう）。
const DEEP_MAX = 8
const DEEP_WORD = /住宅扶助|住居確保|基準額|基準表|しおり|保護費|扶助費/
const deepLinks = (html, base) => {
  const out = []
  for (const m of html.matchAll(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '')
    if (/^(mailto:|javascript:)/i.test(href)) continue
    const isPdf = /\.pdf(\?|$)/i.test(href)
    if (!isPdf && !DEEP_WORD.test(text)) continue
    try {
      const u = new URL(href, base).toString()
      if (!/^https?:/.test(u)) continue
      if (!out.includes(u)) out.push(u)
    } catch { /* 壊れたhrefは飛ばす */ }
    if (out.length >= DEEP_MAX) break
  }
  return out
}

const main = async () => {
  const list = L.targets.filter((t) => t.urls.length && (!ONLY || t.name === ONLY))
  if (!list.length) { console.log('候補URLの入った機関がまだ無い。--todo で穴を見る。'); return }
  let ok = 0
  let ng = 0
  let skip = 0
  for (const t of list) {
    const queue = [...t.urls.map((u) => [u, 0])]
    const seen = new Set()
    while (queue.length) {
      const [u, depth] = queue.shift()
      if (seen.has(u)) continue
      seen.add(u)
      const have = already(t, u)
      if (!FORCE && have) {
        skip++
        // 既に落としてあるHTMLからも、まだ辿っていないリンクは拾う
        if (depth === 0 && have.endsWith('.html')) {
          for (const l of deepLinks(fs.readFileSync(have, 'utf8'), u)) queue.push([l, 1])
        }
        continue
      }
      try {
        const { dest, size, isPdf } = await grab(t, u)
        console.log(`ok    ${t.name.padEnd(8)} ${isPdf ? 'pdf ' : 'html'} ${String(size).padStart(8)}バイト  ${depth ? '└ ' : ''}${u}`)
        ok++
        if (!isPdf && depth === 0) {
          for (const l of deepLinks(fs.readFileSync(dest, 'utf8'), u)) queue.push([l, 1])
        }
      } catch (e) {
        console.log(`NG    ${t.name.padEnd(8)} ${e.message}  ${depth ? '└ ' : ''}${u}`)
        ng++
      }
      await sleep(1200)
    }
    t.checked = new Date().toISOString().slice(0, 10)
  }
  fs.writeFileSync(LEDGER, JSON.stringify(L, null, 1) + '\n')
  console.log(`\n取得 ${ok} / 失敗 ${ng} / 既にある ${skip}`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
