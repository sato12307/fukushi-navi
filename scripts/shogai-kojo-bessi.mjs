// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-bessi.mjs — 本文に基準表が無い例規の「別表」を添付ファイルから取る。
//
// ★なぜ必要か
//   504件の原典のうち、基準表がHTMLの中にあるのは約6割。残りは
//   「別表は別紙のとおり」として **RTF や DOCX で添付**されている。実測の内訳:
//     RTF等の添付(fileDownloadAction) 148 ／ 外部ファイルへのリンク 36
//     ／ 別表の語はあるが添付なし 18 ／ 別表そのものが無い 6 ／ 画像だけ 1
//   つまり **184件は取りに行けば読める**。ここを諦めると全国の4割が欠ける。
//
// ★判定は書かない
//   基準の読み取りは shogai-kojo-lib.mjs に1つだけ置いてある。ここがやるのは
//   「RTF/DOCX を行×セルの表に変換する」ところまで。入口だけ2つ、判定は1つ。
//   [[same-question-two-implementations]]
//
// ★画像だけの1件（日野市）は取れない
//   別表がPNGでしか無い。OCRはしない（読み間違いが実名の自治体の隣に出るのは割に合わない）。
//   「原文を見てください」とリンクだけ出す。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criteriaFromRows, headIndex, flipped, hasAny, rtfToRows, docxToRows } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo')
const BCACHE = path.join(ROOT, '.cache', 'shogai-kojo-bessi')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const UA = 'Mozilla/5.0 (compatible; fukushiru-bot/1.0; +https://fukushiru.com/about.html)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(BCACHE, { recursive: true })

// ── 添付のURLを本文HTMLから拾う ─────────────────────────────────────────────
const attachments = (html, pageUrl) => {
  const urls = new Set()
  for (const m of html.matchAll(/fileDownloadAction2?\('([^']+\.(?:rtf|docx?|xlsx?))'\)/gi)) urls.add(m[1])
  for (const m of html.matchAll(/href="([^"]+\.(?:rtf|docx?))"/gi)) urls.add(m[1])
  return [...urls].map((u) => { try { return new URL(u, pageUrl).href } catch { return null } }).filter(Boolean)
}

const src = JSON.parse(fs.readFileSync(path.join(OUT, 'sources.json'), 'utf8'))
const rec = JSON.parse(fs.readFileSync(path.join(OUT, 'records.json'), 'utf8'))
const cacheOf = new Map(src.rows.map((r) => [r.municipality_id + r.original_url, r._cache]))
// ★本文検索に切り替えて対象が1,124件に増えたが、その多くは税条例などが
//   「障害者控除」に言及しているだけの例規で、添付を追っても基準は出てこない。
//   前回の実測でも、添付186件のうち基準が入っていたのは44件で、残りは申請書の様式だった。
//   ∴ **タイトルが障害者控除の専用例規か、本文に「別表」がある例規だけ**を追う。
//   相手は自治体の共用サーバなので、当たらないと分かっている扉は叩かない。
const worth = (r, html) => /障害者控除|障がい者控除/.test(r.reikiTitle || '') || /別表/.test(html)
const todo = rec.records.filter((r) => !/読めた/.test(r.status))
console.log(`本文で読めなかった ${todo.length}件について、別表の添付を探します`)

let fetched = 0, hit = 0, solved = 0, noAttach = 0, failed = 0, skipped = 0
const fixes = new Map()
for (const r of todo) {
  const cp = path.join(CACHE, cacheOf.get(r.code + r.sourceUrl) || '')
  if (!fs.existsSync(cp)) continue
  const html = fs.readFileSync(cp, 'utf8')
  if (!worth(r, html)) { skipped++; continue }
  const atts = attachments(html, r.sourceUrl)
  if (!atts.length) { noAttach++; continue }

  for (const au of atts.slice(0, 4)) {          // 別表が複数に割れている例規がある
    const bp = path.join(BCACHE, `${r.code}-${au.replace(/\W+/g, '').slice(-44)}`)
    let buf = null
    if (fs.existsSync(bp)) { buf = fs.readFileSync(bp); hit++ }
    else {
      try {
        const resp = await fetch(au, { headers: { 'user-agent': UA, referer: r.sourceUrl }, redirect: 'follow' })
        if (resp.ok) { buf = Buffer.from(await resp.arrayBuffer()); fs.writeFileSync(bp, buf); fetched++ }
        else failed++
      } catch { failed++ }
      await sleep(1100)
    }
    if (!buf || buf.length < 200) continue

    let rows = []
    try {
      if (buf.subarray(0, 2).toString('latin1') === 'PK') rows = docxToRows(buf)
      else if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') rows = rtfToRows(buf.toString('latin1'))
    } catch { /* 壊れた添付は黙って飛ばす。件数は下の solved で判る */ }
    if (!rows.length) continue

    const hi = headIndex(rows)
    // 別表は見出し行が無いこともある。その場合は先頭から読む（区分名は行の先頭にある）。
    const res = criteriaFromRows(rows, hi >= 0 ? hi : -1)
    if (!hasAny(res.shogai) && !hasAny(res.tokubetsu)) continue
    const bad = flipped(res)
    // ★キーは自治体コードではなくレコード単位。本文検索に切り替えて1自治体に
    //   複数の例規が当たるようになったため、コードで持つと別の例規にまで貼ってしまう。
    fixes.set(r.code + r.sourceUrl, {
      shogai: hasAny(res.shogai) ? res.shogai : null,
      tokubetsu: hasAny(res.tokubetsu) ? res.tokubetsu : null,
      status: bad.length ? '要確認(順序が逆転)' : '読めた(別表から)',
      bessiUrl: au,
    })
    break
  }
  if (fixes.has(r.code + r.sourceUrl)) solved++
}
console.log(`添付: 新規取得 ${fetched} / キャッシュ ${hit} / 失敗 ${failed} / 添付なし ${noAttach} / 見込みなしで飛ばした ${skipped}`)
console.log(`別表から基準を読めた: ${solved}件`)

// ── records.json に統合する ─────────────────────────────────────────────────
for (const r of rec.records) {
  const f = fixes.get(r.code + r.sourceUrl)
  if (!f) continue
  r.shogai = f.shogai; r.tokubetsu = f.tokubetsu; r.status = f.status; r.bessiUrl = f.bessiUrl
}
const tally = {}
for (const r of rec.records) tally[r.status] = (tally[r.status] || 0) + 1
rec.tally = tally
rec.bessiAt = new Date().toISOString()
fs.writeFileSync(path.join(OUT, 'records.json'), JSON.stringify(rec, null, 1))
fs.writeFileSync(path.join(OUT, 'tally.txt'), Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join('\n'))
console.log('統合後の内訳 -> data/shogai-kojo/tally.txt')
