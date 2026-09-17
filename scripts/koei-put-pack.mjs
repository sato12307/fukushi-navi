// koei-put-pack.mjs — 政令市の有料資料を KV に入れる。
//
//   node scripts/koei-put-pack.mjs kawasaki --check   # 突き合わせだけ
//   node scripts/koei-put-pack.mjs shizuoka yokohama  # 突き合わせてから入れる
//   node scripts/koei-put-pack.mjs --all
//
// ★public/ に置かない理由
//   置けば誰でも取れて、決済の確認に意味が無くなる。この艦は GitHub Pages で
//   リポジトリ全体が公開されるので、コミットした時点で無料配布になる。
//   （.dist/ は .gitignore に入れてある。外さないこと）
//
// ★meta:<市> も入れる。Worker は meta が無い商品を売らない
//   （用意できていないものを買わせないための鍵）。
//
// ★入れる前の突き合わせ
//   有料資料だけ入れ直すと、無料ページのカードの件数と抜粋が古いまま残る。
//   逆に無料ページだけ公開すると、買った人に古い資料が届く。
//   手元の2つがそろっていなければ KV に入れない。KV への投入と公開は同じ回に行うこと。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CITIES } from './koei-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = path.resolve(ROOT, '..', 'fukushiru-pay')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const keys = args.includes('--all') ? Object.keys(CITIES) : args.filter((a) => !a.startsWith('-'))
if (!keys.length) { console.error('市を指定してください（--all も可）'); process.exit(1) }

const bulk = []
for (const key of keys) {
  const C = CITIES[key]
  if (!C) { console.error(`知らない市です: ${key}`); process.exit(1) }
  const src = path.join(ROOT, '.dist', `${key}-pack.html`)
  if (!fs.existsSync(src)) {
    console.error(`.dist/${key}-pack.html がありません。先に node scripts/koei-nerai.mjs ${key} を回してください。`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${key}-bairitsu.json`), 'utf8'))
  const rounds = new Set(raw.rows.map((r) => r.round)).size
  const html = fs.readFileSync(src)
  const packS = html.toString('utf8')
  const free = fs.readFileSync(path.join(ROOT, key, 'index.html'), 'utf8').replace(/\r\n/g, '\n')
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s/g, '')
  const bad = []
  const m2 = /毎回すいている申込先（([\d,]+)件）/.exec(packS)
  const m6 = /観測できた申込先の索引（([\d,]+)件）/.exec(packS)
  if (!m2 || !m6) bad.push('有料資料の2章・6章の見出しが読めない')
  else {
    if (!free.includes(`のものだけ<strong>${m2[1]}件</strong>`)) bad.push(`/${key}/ のカードが資料の2章（${m2[1]}件）と違う`)
    if (!free.includes(`全申込先の索引${m6[1]}件`)) bad.push(`/${key}/ のカードが資料の索引（${m6[1]}件）と違う`)
    const i = free.indexOf('<div class="peek"')
    const j = free.indexOf('</div>', free.indexOf('</table>', i))
    if (i < 0) bad.push(`/${key}/ に抜粋（.peek）が無い`)
    else if (!flat(packS).includes(flat(free.slice(i, j)))) bad.push(`抜粋の文字が資料の本文に見つからない（node scripts/koei-nerai.mjs ${key} を回し直す）`)
    if ((free.match(new RegExp(`id="offer-${key}"`, 'g')) || []).length !== 1) bad.push(`/${key}/ の売り場カードが1つでない`)
    if ((free.match(/data-buy/g) || []).length !== 1) bad.push(`/${key}/ の買うボタンが1つでない`)
  }
  if (bad.length) { console.error(`${C.city}：KV に入れません：\n- ` + bad.join('\n- ')); process.exit(1) }
  console.log(`${C.city} 突き合わせ OK：資料（2章 ${m2[1]}件・索引 ${m6[1]}件）＝/${key}/ の売り場カードと抜粋`)
  const gz = zlib.gzipSync(html)
  console.log(`  ${(html.length / 1024).toFixed(0)}KB → gzip ${(gz.length / 1024).toFixed(0)}KB`)
  bulk.push({ key: `pack:${key}`, value: gz.toString('base64'), base64: true })
  bulk.push({ key: `meta:${key}`, value: JSON.stringify({ product: key, rounds, readAt: raw.updated }) })
}

if (CHECK) { console.log('\n--check なので KV には入れていません。'); process.exit(0) }

const tmp = path.join(ROOT, '.dist', 'kv-bulk-koei.json')
fs.writeFileSync(tmp, JSON.stringify(bulk))
// ★wrangler は環境変数のトークンがあると account を引けずに落ちる。外して OAuth を使わせる。
execFileSync('npx', ['wrangler@4.120.1', 'kv', 'bulk', 'put', tmp, '--binding', 'PACKS', '--remote'], {
  cwd: WORKER, stdio: 'inherit', shell: true,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined },
})
fs.rmSync(tmp, { force: true })
console.log(`\nKV への投入が終わりました（${keys.map((k) => `pack:${k} / meta:${k}`).join(' ／ ')}）`)
