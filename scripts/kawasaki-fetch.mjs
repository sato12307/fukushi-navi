// ─────────────────────────────────────────────────────────────────────────────
// kawasaki-fetch.mjs — 川崎市営住宅の「応募状況表」PDFを回ごとに集めて .cache に貯める。
//
//   node scripts/kawasaki-fetch.mjs            # 未取得の回だけ落とす
//   node scripts/kawasaki-fetch.mjs --all      # 既にある回も取り直す
//   node scripts/kawasaki-fetch.mjs --list     # 一覧に出ている回を並べるだけ（落とさない）
//
// ★なぜ川崎から作るか（2026-09-17）
//   政令市20市を0円検証した結果（data/koei-sources.json）、
//   **住宅名まで分かって、かつ過去回が今も取れる**市は川崎・静岡・横浜の3つだけだった。
//   うち川崎は **29回（令和元年6月〜令和8年6月）** が市サイトに個別ページで残っていて、
//   都営の16回より厚い。∴ 都営と同じ商品（毎回すいている申込先）がそのまま作れる。
//
// ★消える市との違いを忘れないための注記
//   堺は2回・熊本は直近3回・名古屋は前回ぶんだけで、過去回は消える。
//   川崎は残っているので後追いで取れるが、**残っている保証は無い**。
//   ∴ 取ったPDFは .cache に残し、二度目からは取りに行かない（相手のサーバに優しく、
//     かつ市側が消しても手元には残る）。
//
// ★礼儀
//   1本ごとに1秒空ける。市のサイトを叩き続けない。
//   User-Agent に連絡先を書く（誰が取っているか分かるようにする）。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'kawasaki')
const INDEX = 'https://www.city.kawasaki.jp/kurashi/category/24-4-2-2-1-3-0-0-0-0.html'
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const ARGS = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

// 和暦の「令和◯年◯月」→ 西暦の回キー（2026-06）。令和1年=2019年。
const WAREKI = /令和(元|[0-9]+)年([0-9]+)月の市営住宅入居者募集/
const roundKey = (title) => {
  const m = WAREKI.exec(title)
  if (!m) return null
  const y = (m[1] === '元' ? 1 : Number(m[1])) + 2018
  return `${y}-${String(Number(m[2])).padStart(2, '0')}`
}

// ── 一覧から回ごとのページを拾う ────────────────────────────────────────────
//   ★リンクの文言から回を決める。ページ番号（0000189277）には規則性が無く、
//     番号順＝時系列とも限らないので、番号からは回を決めない。
const listRounds = async () => {
  const html = await get(INDEX)
  const out = new Map()
  for (const m of html.matchAll(/href="([^"]*\/500\/page\/[0-9]+\.html)"[^>]*>([^<]+)</g)) {
    const key = roundKey(m[2])
    if (!key) continue
    const url = new URL(m[1], INDEX).href
    if (!out.has(key)) out.set(key, { round: key, title: m[2].trim(), page: url })
  }
  return [...out.values()].sort((a, b) => a.round.localeCompare(b.round))
}

// ── 回のページから「応募状況表」のPDFを見つける ──────────────────────────────
//   ★当選番号表（tousenbangou.pdf）ではないほうを取る。ファイル名で決め打ちせず、
//     リンクの文言で選ぶ（ファイル名は回によって変わりうる）。
//     文言で見つからないときだけ、ファイル名に oubo を含むものへ落ちる。
const findPdf = (html, pageUrl) => {
  const links = [...html.matchAll(/href="([^"]+\.pdf)"[^>]*>([^<]*)</g)]
    .map((m) => ({ url: new URL(m[1], pageUrl).href, text: m[2].replace(/\s+/g, '') }))
  const byText = links.find((l) => /応募状況/.test(l.text))
  if (byText) return { ...byText, by: '文言' }
  const byName = links.find((l) => /oubo/i.test(l.url))
  if (byName) return { ...byName, by: 'ファイル名' }
  return null
}

const rounds = await listRounds()
// ★--list のあとに process.exit(0) を呼ばない。Windowsのnodeが終了処理で
//   「Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)」を吐く。中身は正しく出ているのに
//   壊れたように見えるので、分岐で抜ける。
if (ARGS.includes('--list')) {
  console.log(`一覧に出ている回 ${rounds.length}：`)
  for (const r of rounds) console.log('  ' + r.round + '  ' + r.page)
} else {

  fs.mkdirSync(CACHE, { recursive: true })
  const manifest = []
  let got = 0, skipped = 0
  const failed = []
  for (const r of rounds) {
    const out = path.join(CACHE, `${r.round}.pdf`)
    if (fs.existsSync(out) && !ARGS.includes('--all')) {
      manifest.push({ ...r, file: path.relative(ROOT, out), bytes: fs.statSync(out).size, cached: true })
      skipped++
      continue
    }
    try {
      await sleep(1000)
      const html = await get(r.page)
      const pdf = findPdf(html, r.page)
      if (!pdf) { failed.push(`${r.round}: 応募状況表のリンクが見つからない ${r.page}`); continue }
      await sleep(1000)
      const buf = await get(pdf.url, true)
      // ★中身がPDFであることを確かめてから保存する。相対URLの組み立てを間違えると
      //   エラーページのHTMLが .pdf という名前で保存され、あとで「読めないPDF」に見える。
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        failed.push(`${r.round}: PDFではないものが返ってきた（${buf.length}バイト） ${pdf.url}`)
        continue
      }
      fs.writeFileSync(out, buf)
      manifest.push({ ...r, pdf: pdf.url, foundBy: pdf.by, file: path.relative(ROOT, out), bytes: buf.length })
      got++
      console.log(`取得 ${r.round}  ${(buf.length / 1024).toFixed(0)}KB  (${pdf.by}で特定)`)
    } catch (e) {
      failed.push(`${r.round}: ${String(e.message || e)}`)
    }
  }

  manifest.sort((a, b) => a.round.localeCompare(b.round))
  fs.writeFileSync(path.join(CACHE, '_manifest.json'),
    JSON.stringify({ source: INDEX, fetchedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), rounds: manifest }, null, 2) + '\n')

  console.log(`\n一覧 ${rounds.length}回 ／ 新規取得 ${got} ／ すでにある ${skipped} ／ 手元に ${manifest.length}回`)
  if (manifest.length) console.log(`  範囲 ${manifest[0].round} 〜 ${manifest[manifest.length - 1].round}`)
  if (failed.length) {
    console.error(`\n★取れなかった回 ${failed.length}：`)
    failed.forEach((f) => console.error('  ' + f))
    process.exitCode = 1
  }

}
