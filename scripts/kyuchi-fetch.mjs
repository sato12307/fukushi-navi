// ─────────────────────────────────────────────────────────────────────────────
// kyuchi-fetch.mjs — 級地区分を読むのに要る原典を集める。
//   node scripts/kyuchi-fetch.mjs          # 未取得のものだけ
//   node scripts/kyuchi-fetch.mjs --force  # 取り直す
// そのあと: python scripts/kyuchi-parse.py
//
// 落とすもの
//   ①厚労省「お住まいの地域の級地を確認」kyuchi.3010.pdf
//     ＝級地区分の一覧（平成30年10月1日現在。その後も据え置きで、これが現行）。
//     ★3級地-2は載っていない。「上記に掲げた以外の市町村」がすべて3級地-2。
//   ②日本郵便「郵便番号データ（UTF-8・全国一括）」utf_ken_all.zip
//     ＝**郡→町村** の対応を作るために要る。級地の一覧には「◯◯郡」という行が124あり、
//     展開しないと、たとえば神奈川県三浦郡の葉山町が3級地-2に落ちる。
//     市町村コード表（総務省）には郡が入っていないので、こちらで補う。
//     ★郵便番号データは日本郵便が著作権を主張していない。
//     ★URLが変わっている。旧 zipcode/dl/kogaki/zip/ken_all.zip は404で、
//       いまは service/search/zipcode/download/utf/zip/utf_ken_all.zip。
//
// 市町村コード表（総務省）は scripts/hogo-shinsei-fetch.mjs が落としたものを使い回す。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'kyuchi')
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const FORCE = process.argv.includes('--force')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JOBS = [
  ['kyuchi.pdf', 'https://www.mhlw.go.jp/content/kyuchi.3010.pdf', (b) => b.subarray(0, 4).toString('latin1') === '%PDF'],
  ['utf_ken_all.zip', 'https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip', (b) => b.subarray(0, 2).toString('latin1') === 'PK'],
]

const main = async () => {
  fs.mkdirSync(CACHE, { recursive: true })
  for (const [name, url, ok] of JOBS) {
    const dest = path.join(CACHE, name)
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 10000) { console.log(`skip  ${name}`); continue }
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
    const buf = Buffer.from(await r.arrayBuffer())
    // 拡張子ではなく中身で見る（404がHTMLで200相当に見えることがある）
    if (!ok(buf)) throw new Error(`中身が想定と違う（${buf.length}バイト） ${url}`)
    fs.writeFileSync(dest, buf)
    console.log(`ok    ${name}  ${buf.length}バイト`)
    await sleep(1200)
  }

  // 郡 → 町村 の対応を作る（郵便番号データの「市区町村名」は「余市郡余市町」の形）
  const zip = path.join(CACHE, 'utf_ken_all.zip')
  const out = path.join(CACHE, 'gun.json')
  if (FORCE || !fs.existsSync(out)) {
    const { execFileSync } = await import('node:child_process')
    const py = `
import zipfile,csv,io,json,re
from collections import defaultdict
z=zipfile.ZipFile(r"${zip}")
n=[x for x in z.namelist() if x.upper().endswith(".CSV")][0]
rows=list(csv.reader(io.StringIO(z.read(n).decode("utf-8-sig"))))
m=defaultdict(set)
for r in rows:
    g=re.match(r"^(.+?郡)(.+[町村])$", r[7])
    if g: m[(r[6],g.group(1))].add(g.group(2))
json.dump({f"{p}|{g}":sorted(v) for (p,g),v in m.items()}, open(r"${out}","w",encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"郡 {len(m)} 件ぶんの町村を書き出した")
`
    console.log(execFileSync('python', ['-c', py], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).trim())
  } else console.log('skip  gun.json')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
