// ─────────────────────────────────────────────────────────────────────────────
// hasan-fetch.mjs — 自己破産・個人再生を「地方裁判所別」に集める。
//
//   node scripts/hasan-fetch.mjs          # 未取得の年だけ落とす
//   node scripts/hasan-fetch.mjs --force  # 全部落とし直す
//   node scripts/hasan-fetch.mjs --list   # 落とさずに、見つかった年だけ出す
//
// ★何を取っているか
//   ①最高裁判所「司法統計年報 1.民事・行政編」のExcel（年1冊・119シート）。
//     使うのは **第4表「民事・行政事件数―事件の種類及び新受、既済、未済―
//     全地方裁判所及び地方裁判所別」** の1枚だけ。ここに全50地裁ぶんの列があり、
//     行に「破産」「小規模個人再生」「給与所得者等再生」「担保権の実行（不動産）」が並ぶ。
//     ★第105表〜第108表は破産専用だが **全国計しか無い**。地裁別が欲しいなら第4表。
//   ②日本弁護士連合会「弁護士会別会員数」PDF（52会）。人口あたりの弁護士数を出すのに使う。
//
// ★司法統計サイトの落とし穴
//   ・トップの検索画面（/app/sihotokei_jp/…）は**JavaScriptで描いている**ので、
//     HTMLを取ってもファイルのリンクが1本も入っていない。空振りする。
//   ・実体は **/toukei_siryou/shihotokei_search/list/index.html?filter[type]=1
//     &filter[yYear]=<年>&filter[yCategory]=1** の静的HTMLにあり、
//     ここに toukei-excel-<id>.xlsx が1本だけ入っている。**idは年ごとにバラバラで、
//     年の順に並んでもいない**（2023→16598、2025→16675、2024→16687）。
//     だから **idを表に書かず、毎回このページから引く**。
//   ・年は**暦年**（1〜12月）。年度ではない。生活保護や困窮者支援の「年度」と並べない。
//
// ★弁護士会別会員数のPDFは**毎月上書きされる**（URLは同じ）。
//   落としたら .cache に日付つきで残す。基準日はPDFの1行目に入っている（parse 側で読む）。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'hasan')
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const BAR_PDF = 'https://www.nichibenren.or.jp/library/pdf/jfba_info/membership/members.pdf'
const LIST = (y) => 'https://www.courts.go.jp/toukei_siryou/shihotokei_search/list/index.html'
  + `?filter%5Btype%5D=1&filter%5ByYear%5D=${y}&filter%5ByCategory%5D=1`
const ARGS = process.argv.slice(2)
const FORCE = ARGS.includes('--force')
const ONLY_LIST = ARGS.includes('--list')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// どこまで遡るか。第4表の作りは2020年ぶんから同じ。
const FROM = 2020
const TO = new Date().getFullYear()

const isXlsx = (buf) => buf.length > 20000 && buf[0] === 0x50 && buf[1] === 0x4b
const isPdf = (buf) => buf.length > 4000 && buf.slice(0, 5).toString('latin1') === '%PDF-'

const discover = async () => {
  const found = {}
  for (let y = FROM; y <= TO; y++) {
    const html = await (await fetch(LIST(y), { headers: { 'user-agent': UA } })).text()
    const m = html.match(/toukei-excel-(\d+)\.xlsx/)
    await sleep(1000)
    if (!m) continue
    found[y] = `https://www.courts.go.jp/saikosai/vc-files/saikosai/toukei/${m[0]}`
  }
  return found
}

const grab = async (url, dest, check) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (!check(buf)) throw new Error(`中身が想定と違う（${buf.length}バイト） ${url}`)
  fs.writeFileSync(dest, buf)
  return buf.length
}

const main = async () => {
  const found = await discover()
  const years = Object.keys(found).map(Number).sort((a, b) => a - b)
  if (!years.length) throw new Error('司法統計の一覧からExcelが1本も見つからない（ページの作りが変わった可能性）')
  console.log(`見つかった年（暦年）: ${years.join(', ')}`)
  if (ONLY_LIST) {
    for (const y of years) console.log(`  ${y}年  ${found[y]}`)
    return
  }
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(path.join(CACHE, 'manifest.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), shiho: found, bar: BAR_PDF }, null, 2))

  for (const y of years) {
    const dest = path.join(CACHE, `shiho-${y}.xlsx`)
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 20000) { console.log(`skip  shiho-${y}.xlsx`); continue }
    const n = await grab(found[y], dest, isXlsx)
    console.log(`ok    shiho-${y}.xlsx  ${n}バイト`)
    await sleep(1000)
  }

  // 弁護士会別会員数。毎月上書きされるので、基準日は中身から読む（parse 側）。
  const bar = path.join(CACHE, 'bengoshi.pdf')
  if (FORCE || !fs.existsSync(bar) || fs.statSync(bar).size < 4000) {
    const n = await grab(BAR_PDF, bar, isPdf)
    console.log(`ok    bengoshi.pdf  ${n}バイト`)
  } else console.log('skip  bengoshi.pdf')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
