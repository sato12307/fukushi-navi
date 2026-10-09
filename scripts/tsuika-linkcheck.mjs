// ─────────────────────────────────────────────────────────────────────────────
// tsuika-linkcheck.mjs — 追加給付の申出先一覧（data/tsuika-jichitai.json）に載っている URL が開けるかを確かめ、
//   開けなかったものだけを data/tsuika-linkcheck.json に書く。scripts/tsuika-page.mjs はそれを読んで、リンクにせず「開けなかった」と書く。
//   node scripts/tsuika-linkcheck.mjs          → 全部の URL を確かめて書く（約800本・6本ずつ・1本ごとに0.3秒あける）
//   node scripts/tsuika-linkcheck.mjs --dry    → 書かずに結果だけ
//
// ★2026-10-09 の初回：785本のうち開けなかったのは6本。5本は市のページが消えていた（404）。宜野湾市の電子申出は
//   厚労省の一覧の URL が試験用の環境（sandbox-ttzk.graffer.jp）を指していた（401）。6本とも PDF の埋め込みリンクそのもので、
//   読み取りの崩れではない。推測で本番の URL に書き換えることはしない（市の案内ページへ誘導する）。
// ★市のサーバに負担をかけないよう、厚労省の一覧が更新されたとき（tsuika-fetch.py で updated が変わったとき）だけ回す。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tsuika-jichitai.json'), 'utf8'))
const OUT = path.join(ROOT, 'data', 'tsuika-linkcheck.json')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

const urls = new Map()
for (const r of D.rows) for (const l of [...r.hp, ...r.ownLinks]) if (!urls.has(l.url)) urls.set(l.url, r.name)
const list = [...urls]
const res = []
let i = 0
async function one([url, name]) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 25000)
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } })
    res.push({ name, url, status: r.status })
    await r.body?.cancel()
  } catch (e) {
    res.push({ name, url, status: 0, err: String(e.cause?.code || e.name || e) })
  } finally { clearTimeout(t) }
}
async function worker() { while (i < list.length) { await one(list[i++]); await new Promise((r) => setTimeout(r, 300)) } }
await Promise.all(Array.from({ length: 6 }, worker))

// 一時的な失敗（0＝つながらない・5xx）は、もう一度だけ確かめる
for (const x of res.filter((x) => x.status === 0 || x.status >= 500)) {
  const k = res.indexOf(x); res.splice(k, 1); await one([x.url, x.name])
}
const bad = res.filter((x) => !(x.status >= 200 && x.status < 400)).sort((a, b) => a.url.localeCompare(b.url))
console.log(`確かめた ${res.length}本・開けなかった ${bad.length}本`)
for (const b of bad) console.log(`  ${b.status}${b.err ? ' ' + b.err : ''} ${b.name} ${b.url}`)
if (DRY) process.exit(0)
fs.writeFileSync(OUT, JSON.stringify({
  note: '追加給付の申出先一覧（data/tsuika-jichitai.json）の URL のうち、開けなかったもの。scripts/tsuika-linkcheck.mjs が書く。status 0 はつながらなかったもの。',
  checkedAt: TODAY, listUpdated: D.updated, checked: res.length,
  bad: bad.map((b) => ({ name: b.name, url: b.url, status: b.status, ...(b.err ? { err: b.err } : {}) })),
}, null, 1) + '\n')
console.log('書いた:', OUT)
