// toei-put-pack.mjs — 都営住宅の有料資料を KV に入れる。
//
// ★public/ に置かない理由
//   置けば誰でも取れて、決済の確認に意味が無くなる。この艦は GitHub Pages で
//   リポジトリ全体が公開されるので、コミットした時点で無料配布になる。
//   （.dist/ は .gitignore に入れてある。外さないこと）
//
// ★meta:toei も入れる
//   Worker は meta が無い商品を売らない。用意できていないものを買わせないための鍵。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.resolve(ROOT, '..', 'fukushiru-pay')
const src = path.join(ROOT, '.dist', 'toei-pack.html')
if (!fs.existsSync(src)) {
  console.error('.dist/toei-pack.html がありません。先に node scripts/toei-nerai.mjs を回してください。')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'toei-bairitsu.json'), 'utf8'))
const rounds = new Set(raw.rows.map((r) => r.round)).size

const html = fs.readFileSync(src)
const gz = zlib.gzipSync(html)
const bulk = [
  { key: 'pack:toei', value: gz.toString('base64'), base64: true },
  { key: 'meta:toei', value: JSON.stringify({ product: 'toei', rounds, readAt: raw.updated }) },
]
const tmp = path.join(ROOT, '.dist', 'kv-bulk-toei.json')
fs.writeFileSync(tmp, JSON.stringify(bulk))
console.log(`有料資料 ${(html.length / 1024).toFixed(0)}KB → gzip ${(gz.length / 1024).toFixed(0)}KB を KV へ入れます`)

// ★wrangler は大きな bulk で socket closed になることがある（艦隊で実測）。
//   バージョンを固定し、環境変数のトークンを外して OAuth を使わせる。
execFileSync('npx', ['wrangler@4.120.1', 'kv', 'bulk', 'put', tmp, '--binding', 'PACKS', '--remote'], {
  cwd: WORKER, stdio: 'inherit', shell: true,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined },
})
fs.rmSync(tmp, { force: true })
console.log('KV への投入が終わりました（pack:toei / meta:toei）')
