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
import { TOEI_PEEK, TOEI_PEEK_NOTE } from './toei-peek.mjs'

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

// ★2026-09-13 入れる前の突き合わせ（node scripts/toei-put-pack.mjs --check でこれだけ走る）
//   有料資料だけ入れ直すと、記事12本の抜粋（「実物の冒頭をそのまま」）と /toei/・トップの説明が古いまま残る。
//   逆に /toei/ だけ公開すると、買った人に古い資料が届く。手元の4つがそろっていなければ KV に入れない。
//   見ているのは手元のファイルで本番ではない。KV への投入と /toei/・記事・トップの公開は同じ回に行うこと。
{
  const packS = html.toString('utf8')
  const bad = []
  const m2 = /病死等があった住宅を除く・([\d,]+)件）/.exec(packS)
  const m6 = /観測できた申込先の索引（([\d,]+)件）/.exec(packS)
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
  if (!m2 || !m6) bad.push('有料資料の2章・6章の見出しが読めない')
  else {
    const free = read('toei/index.html')
    if (!free.includes(`毎回すいている申込先 ${m2[1]}件`)) bad.push(`/toei/ の説明が資料の2章（${m2[1]}件）と違う`)
    if (!free.includes(`${m6[1]}件すべての索引`)) bad.push(`/toei/ の説明が資料の索引（${m6[1]}件）と違う`)
    if (!read('index.html').includes(`${m6[1]}件の申込先`)) bad.push(`トップの案内カードが資料の索引（${m6[1]}件）と違う`)
    if (!TOEI_PEEK.includes(`除く・${m2[1]}件）`)) bad.push('scripts/toei-peek.mjs が資料と違う（node scripts/toei-nerai.mjs を回し直す）')
    if (!flat(packS).includes(flat(TOEI_PEEK.slice(0, TOEI_PEEK.lastIndexOf('<h4'))))) bad.push('抜粋の文字が資料の本文に見つからない')
    // ★選び方を目印コメントから「実際に都営の売り場が入っているか」へ（2026-09-17）。
    //   目印を付けるのは手書き記事へ貼る scripts/stamp-offers.mjs だけで、
    //   scripts/toei-machi.mjs が生成する54本には目印が無い。コメントで選ぶと
    //   **生成した54本が関所を素通りし、古い抜粋のまま「実物の冒頭」を名乗る**。
    //   実測：抜粋の入った記事55本のうち、目印があるのは1本だけだった。
    const arts = fs.readdirSync(path.join(ROOT, 'articles')).filter((f) => f.endsWith('.html'))
      .filter((f) => read(`articles/${f}`).includes('data-offer="toei"'))
    const stale = arts.filter((f) => !read(`articles/${f}`).includes(TOEI_PEEK))
    if (!arts.length) bad.push('都営の売り場が入った記事が0本')
    if (stale.length) bad.push(`記事の抜粋が資料と違う ${stale.length}本（node scripts/stamp-offers.mjs）：${stale.join(', ')}`)
    // 抜粋の表には住宅侵入の件数が載る。率ではない・所在地と一致しない場合がある・出典の注記が枠の外に無い記事は出さない。
    const noNote = arts.filter((f) => !read(`articles/${f}`).includes(TOEI_PEEK_NOTE))
    if (noNote.length) bad.push(`記事の抜粋の下に住環境の数字の注記が無い ${noNote.length}本（node scripts/stamp-offers.mjs）：${noNote.join(', ')}`)
    if (!bad.length) console.log(`突き合わせ OK：資料（2章 ${m2[1]}件・索引 ${m6[1]}件）＝/toei/＝トップのカード＝記事${arts.length}本の抜粋`)
  }
  if (bad.length) { console.error('KV に入れません：\n- ' + bad.join('\n- ')); process.exit(1) }
  if (process.argv.includes('--check')) process.exit(0)
}

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
