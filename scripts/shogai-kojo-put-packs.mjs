// shogai-kojo-put-packs.mjs — 生成した有料パックを KV に入れる。
//
// ★public/ に置かない理由
//   置けば誰でも取れて、決済の確認に意味が無くなる。しかもこの艦は GitHub Pages で
//   リポジトリ全体が公開されるので、コミットした時点で無料配布になる。
//   （.dist/ は .gitignore に入れてある。外さないこと）
//
// ★gzip で入れる
//   1件12KBほどだが、437件ぶんの転送とKVの上限に余裕を持たせる。
//   取り出し側（Worker）は DecompressionStream で展開して素のHTMLとして返す。
//
// ★meta も入れる
//   決済の前に「その自治体のパックが実在するか」を確かめるため。
//   買えないものを買わせないための鍵。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKS = path.join(ROOT, '.dist', 'packs')
const WORKER = path.resolve(ROOT, '..', 'fukushiru-pay')
const idx = JSON.parse(fs.readFileSync(path.join(PACKS, '_index.json'), 'utf8'))

// wrangler の bulk put は JSON ファイルで渡す。base64 でバイナリ（gzip）も入る。
const bulk = []
for (const it of idx.items) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join(PACKS, `${it.code}.html`)))
  bulk.push({ key: `pack:${it.code}`, value: gz.toString('base64'), base64: true })
  bulk.push({ key: `meta:${it.code}`, value: JSON.stringify({ pref: it.pref, city: it.city, has: it.has }) })
}
const tmp = path.join(ROOT, '.dist', 'kv-bulk.json')
fs.writeFileSync(tmp, JSON.stringify(bulk))
const mb = (fs.statSync(tmp).size / 1024 / 1024).toFixed(1)
console.log(`${idx.items.length}自治体ぶん（キー${bulk.length}件・${mb}MB）を KV へ入れます`)

// ★wrangler は大きな bulk で socket closed になることがある（艦隊で実測）。
//   バージョンを固定し、環境変数のトークンを外して OAuth を使わせる。
execFileSync('npx', ['wrangler@4.120.1', 'kv', 'bulk', 'put', tmp, '--binding', 'PACKS', '--remote'], {
  cwd: WORKER, stdio: 'inherit', shell: true,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined },
})
fs.rmSync(tmp, { force: true })
console.log('KV への投入が終わりました')
