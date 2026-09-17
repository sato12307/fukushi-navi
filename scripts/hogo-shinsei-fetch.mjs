// ─────────────────────────────────────────────────────────────────────────────
// hogo-shinsei-fetch.mjs — 生活保護の「申請・取下げ・却下」を自治体別に集める。
//
//   node scripts/hogo-shinsei-fetch.mjs           # 未取得の年度だけ落とす
//   node scripts/hogo-shinsei-fetch.mjs --force   # 全部落とし直す
//   node scripts/hogo-shinsei-fetch.mjs --discover 000001229625   # 新年度のIDを探す
//
// ★何を取っているか
//   厚生労働省「被保護者調査（月次調査・確定値）」の
//     第18表 保護の申請、取下げ、却下、未処理件数、保護開始世帯数…，
//            都道府県－指定都市－中核市×市部－郡部別
//   これが「どこの自治体で何件申請され、何件が却下されたか」を年度単位で持つ
//   唯一の公表物。130機関（全国1＋都道府県47＋指定都市20＋中核市62）が1枚に載る。
//   あわせて第9表（被保護実人員数及び保護率）も取る。人口を逆算するのに要る。
//
// ★e-Stat から機械で落とすときの作法（ここで3回つまずいた）
//   ①ダウンロードURLは fileKind で形式が変わる。**この表は xlsx しか無いので fileKind=0**。
//     fileKind=1 はCSVだが、CSVを持たない表では 404（HTMLのエラーページが200バイト超で返る）。
//     → 拡張子でなく **file(1) で中身がxlsxか**を見て判定する。
//   ②統計表の statInfId は、検索ページ
//       https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=00450312
//         &tstat=<年度>&cycle=8&tclass1=<月次調査>&tclass2=<確定値>
//     のHTMLに **そのまま埋まっている**（`statInfId=0000…`）。JS描画で空になるのは
//     `stat_infid=`（小文字）で探した場合。--discover はこの探し方をなぞる。
//   ③**年度の対応表を目で作ると必ず1年ずれる**。e-Statの一覧は見出しと tstat の並びが
//     ずれて見える。だから落としたあと **ファイルのA1セル（「令和◯年度被保護者調査」）で
//     年度を検算する**（parse 側でやる）。IDを信じない。
//
// ★礼儀：1本ごとに1秒空ける。User-Agent に連絡先を書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'hogo-shinsei')
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const DL = (id) => `https://www.e-stat.go.jp/stat-search/file-download?statInfId=${id}&fileKind=0`
const ARGS = process.argv.slice(2)
const FORCE = ARGS.includes('--force')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 年度（西暦・4月始まり）→ 第18表の statInfId。
// 新年度が出たら --discover で足す。取り違えは parse 側のA1検算で落ちる。
const T18 = {
  2019: '000032062386',
  2020: '000032172597',
  2021: '000040020093',
  2022: '000040150965',
  2023: '000040255689',
  2024: '000040417808',
}
// 第9表（被保護実人員数及び保護率）。人口の逆算に使うので最新年度だけでよい。
const T9 = { 2024: '000040417777' }

// 総務省「全国地方公共団体コード」。市→都道府県の対応に使う。
//   第18表の都道府県の行には指定都市・中核市が入っていないので、
//   「秋田県（秋田市を除く）」と書くために、どの市がどの県から抜けているかが要る。
const MUNI_CODE_URL = 'https://www.soumu.go.jp/main_content/000925835.xlsx'

// xlsx は ZIP。先頭が PK でなければ e-Stat のエラーページを掴んでいる。
const isXlsx = (buf) => buf.length > 4000 && buf[0] === 0x50 && buf[1] === 0x4b

const grab = async (id, dest) => {
  const r = await fetch(DL(id), { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${id}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (!isXlsx(buf)) throw new Error(`xlsxでない（${buf.length}バイト・エラーページの可能性） id=${id}`)
  fs.writeFileSync(dest, buf)
  return buf.length
}

// --discover <tstat>: その年度の統計表一覧を舐めて、第18表の statInfId を出す。
const discover = async (tstat) => {
  const top = await (await fetch(
    `https://www.e-stat.go.jp/stat-search/files?page=1&toukei=00450312&tstat=${tstat}`,
    { headers: { 'user-agent': UA } },
  )).text()
  const c1 = [...new Set([...top.matchAll(/tclass1=(\d+)/g)].map((m) => m[1]))]
  const c2 = [...new Set([...top.matchAll(/tclass2=(\d+)/g)].map((m) => m[1]))]
  for (const a of c1) {
    for (const b of c2) {
      const url = `https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=00450312`
        + `&tstat=${tstat}&cycle=8&tclass1=${a}&tclass2=${b}&tclass3val=0`
      const html = await (await fetch(url, { headers: { 'user-agent': UA } })).text()
      await sleep(600)
      for (const m of html.matchAll(/statInfId=(\d+)/g)) {
        const seg = html.slice(Math.max(0, m.index - 3000), m.index + 300)
        if (/保護の申請、取下げ、却下/.test(seg) && /都道府県/.test(seg) && !/再掲/.test(seg)) {
          console.log(`第18表 statInfId=${m[1]}  (tclass1=${a} tclass2=${b})`)
          return m[1]
        }
      }
    }
  }
  console.log('見つからなかった（確定値がまだ出ていない年度かもしれない）')
  return null
}

const main = async () => {
  const i = ARGS.indexOf('--discover')
  if (i >= 0) { await discover(ARGS[i + 1]); return }

  fs.mkdirSync(CACHE, { recursive: true })
  const jobs = [
    ...Object.entries(T18).map(([y, id]) => [`t18-${y}.xlsx`, id]),
    ...Object.entries(T9).map(([y, id]) => [`t9-${y}.xlsx`, id]),
  ]
  {
    const dest = path.join(CACHE, 'muni-code.xlsx')
    if (FORCE || !fs.existsSync(dest) || fs.statSync(dest).size < 4000) {
      const r = await fetch(MUNI_CODE_URL, { headers: { 'user-agent': UA } })
      const buf = Buffer.from(await r.arrayBuffer())
      if (!isXlsx(buf)) throw new Error('全国地方公共団体コードが xlsx で返ってこない')
      fs.writeFileSync(dest, buf)
      console.log(`ok    muni-code.xlsx  ${buf.length}バイト`)
      await sleep(1000)
    } else console.log('skip  muni-code.xlsx')
  }

  for (const [name, id] of jobs) {
    const dest = path.join(CACHE, name)
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 4000) {
      console.log(`skip  ${name}`); continue
    }
    const n = await grab(id, dest)
    console.log(`ok    ${name}  ${n}バイト`)
    await sleep(1000)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
