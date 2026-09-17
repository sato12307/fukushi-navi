// kawasaki-put-pack.mjs — 川崎の有料資料を KV に入れる。
//
//   node scripts/kawasaki-put-pack.mjs --check   # 突き合わせだけ（KVには入れない）
//   node scripts/kawasaki-put-pack.mjs           # 突き合わせてから入れる
//
// ★public/ に置かない理由
//   置けば誰でも取れて、決済の確認に意味が無くなる。この艦は GitHub Pages で
//   リポジトリ全体が公開されるので、コミットした時点で無料配布になる。
//   （.dist/ は .gitignore に入れてある。外さないこと）
//
// ★meta:kawasaki も入れる
//   Worker は meta が無い商品を売らない。用意できていないものを買わせないための鍵。
//
// ★入れる前の突き合わせ
//   有料資料だけ入れ直すと、/kawasaki/ の売り場カードの抜粋（「実物の冒頭をそのまま」）と
//   件数が古いまま残る。逆に /kawasaki/ だけ公開すると、買った人に古い資料が届く。
//   手元の2つがそろっていなければ KV に入れない。見ているのは手元のファイルで本番ではない。
//   KV への投入と /kawasaki/ の公開は同じ回に行うこと。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.resolve(ROOT, '..', 'fukushiru-pay')
const src = path.join(ROOT, '.dist', 'kawasaki-pack.html')
if (!fs.existsSync(src)) {
  console.error('.dist/kawasaki-pack.html がありません。先に node scripts/kawasaki-nerai.mjs を回してください。')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kawasaki-bairitsu.json'), 'utf8'))
const rounds = new Set(raw.rows.map((r) => r.round)).size
const html = fs.readFileSync(src)

{
  const packS = html.toString('utf8')
  const free = fs.readFileSync(path.join(ROOT, 'kawasaki', 'index.html'), 'utf8').replace(/\r\n/g, '\n')
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s/g, '')
  const bad = []
  const m2 = /毎回すいている申込先（([\d,]+)件）/.exec(packS)
  const m6 = /観測できた申込先の索引（([\d,]+)件）/.exec(packS)
  if (!m2 || !m6) bad.push('有料資料の2章・6章の見出しが読めない')
  else {
    // 無料ページのカードに書いてある件数が、資料と同じか
    if (!free.includes(`のものだけ<strong>${m2[1]}件</strong>`)) bad.push(`/kawasaki/ のカードが資料の2章（${m2[1]}件）と違う`)
    if (!free.includes(`全申込先の索引${m6[1]}件`)) bad.push(`/kawasaki/ のカードが資料の索引（${m6[1]}件）と違う`)
    // 抜粋が資料の本文にそのまま在るか（カードは「実物の冒頭をそのまま」と書いている）
    const i = free.indexOf('<div class="peek"')
    const j = free.indexOf('</div>', free.indexOf('</table>', i))
    if (i < 0) bad.push('/kawasaki/ に抜粋（.peek）が無い')
    else if (!flat(packS).includes(flat(free.slice(i, j)))) bad.push('抜粋の文字が資料の本文に見つからない（node scripts/kawasaki-nerai.mjs を回し直す）')
    // 売り場が1つだけ、買うボタンが1つだけ
    if ((free.match(/id="offer-kawasaki"/g) || []).length !== 1) bad.push('/kawasaki/ の売り場カードが1つでない')
    if ((free.match(/data-buy/g) || []).length !== 1) bad.push('/kawasaki/ の買うボタンが1つでない')
    if (!bad.length) console.log(`突き合わせ OK：資料（2章 ${m2[1]}件・索引 ${m6[1]}件）＝/kawasaki/ の売り場カードと抜粋`)
  }
  if (bad.length) { console.error('KV に入れません：\n- ' + bad.join('\n- ')); process.exit(1) }
  if (process.argv.includes('--check')) process.exit(0)
}

const gz = zlib.gzipSync(html)
const bulk = [
  { key: 'pack:kawasaki', value: gz.toString('base64'), base64: true },
  { key: 'meta:kawasaki', value: JSON.stringify({ product: 'kawasaki', rounds, readAt: raw.updated }) },
]
const tmp = path.join(ROOT, '.dist', 'kv-bulk-kawasaki.json')
fs.writeFileSync(tmp, JSON.stringify(bulk))
console.log(`有料資料 ${(html.length / 1024).toFixed(0)}KB → gzip ${(gz.length / 1024).toFixed(0)}KB を KV へ入れます`)

// ★wrangler は大きな bulk で socket closed になることがある（艦隊で実測）。
//   バージョンを固定し、環境変数のトークンを外して OAuth を使わせる。
execFileSync('npx', ['wrangler@4.120.1', 'kv', 'bulk', 'put', tmp, '--binding', 'PACKS', '--remote'], {
  cwd: WORKER, stdio: 'inherit', shell: true,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined },
})
fs.rmSync(tmp, { force: true })
console.log('KV への投入が終わりました（pack:kawasaki / meta:kawasaki）')
