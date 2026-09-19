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
import { TOEI_PEEK, TOEI_PEEK_NOTE, TOEI_PEEK_BODY, TOEI_PEEK_NEXT } from './toei-peek.mjs'

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
  // ★2026-09-19 2章を「黄金比」に差し替え、旧2章は3章へ落とした。章番号も1つずつ繰り下がっている。
  //   見出しの文言で拾っているので、章の順番を変えるときはここも必ず直す。
  const m2 = /当たりやすさと住みやすさが両方そろう申込先（([\d,]+)件）/.exec(packS)
  const m3 = /条件を承知のうえで選ぶ申込先（([\d,]+)件）/.exec(packS)
  const m6 = /観測できた申込先の索引（([\d,]+)件）/.exec(packS)
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
  if (!m2 || !m3 || !m6) bad.push('有料資料の2章・3章・索引の見出しが読めない')
  else {
    const free = read('toei/index.html')
    if (!free.includes(`当たりやすさと住みやすさが両方そろう申込先 ${m2[1]}件`)) bad.push(`/toei/ の説明が資料の2章（${m2[1]}件）と違う`)
    if (!free.includes(`条件を承知のうえで選ぶ申込先 ${m3[1]}件`)) bad.push(`/toei/ の説明が資料の3章（${m3[1]}件）と違う`)
    if (!free.includes(`${m6[1]}件すべての索引`)) bad.push(`/toei/ の説明が資料の索引（${m6[1]}件）と違う`)
    if (!read('index.html').includes(`${m6[1]}件の申込先`)) bad.push(`トップの案内カードが資料の索引（${m6[1]}件）と違う`)
    if (!TOEI_PEEK.includes(`両方そろう申込先（${m2[1]}件）`)) bad.push('scripts/toei-peek.mjs が資料と違う（node scripts/toei-nerai.mjs を回し直す）')
    // ★本体と「続きの区市町の見出し」を分けて確かめる。資料では見出しと見出しの間に表が挟まるので、
    //   つなげた1本の文字列は資料の本文と一致しない（まとめて確かめると必ず落ちる）。
    //   分け方は生成側（scripts/toei-nerai.mjs）が書き出したものをそのまま使う。組み直さない。
    if (!flat(packS).includes(flat(TOEI_PEEK_BODY))) bad.push('抜粋の本体が資料の本文に見つからない')
    for (const h of TOEI_PEEK_NEXT) {
      if (!flat(packS).includes(flat(h))) bad.push(`抜粋の見出しが資料の本文に見つからない: ${flat(h)}`)
    }
    if (!TOEI_PEEK.includes(TOEI_PEEK_BODY)) bad.push('抜粋の本体と全体が食い違う（node scripts/toei-nerai.mjs を回し直す）')
    // ★2026-09-19 抜粋の置き場所が変わった。コミット 7d96f35 で記事の購入カードを撤去し、
    //   抜粋は売り場 /toei/ にだけ置く形になった（記事はリンクだけ）。
    //   それなのにこの関所は記事の中の data-offer="toei" を数え続けていて、
    //   **その日から「都営の売り場が入った記事が0本」で落ち、KVに入れられない状態**だった。
    //   ∴ 抜粋は /toei/ で確かめ、記事は「リンクの文言が資料と合っているか」だけ見る。
    if (!free.includes(TOEI_PEEK)) bad.push('/toei/ の抜粋が資料と違う（node scripts/toei-nerai.mjs を回し直す）')
    if (!free.includes(TOEI_PEEK_NOTE)) bad.push('/toei/ の抜粋の下に住環境の数字の注記が無い')
    // 記事に残っているのはリンクだけ。件数が古いまま残ると、押した先と数が食い違う。
    const arts = fs.readdirSync(path.join(ROOT, 'articles')).filter((f) => f.endsWith('.html'))
      .filter((f) => read(`articles/${f}`).includes('<!-- offer:toei -->'))
    if (!arts.length) bad.push('都営への案内が入った記事が0本（node scripts/stamp-offers.mjs）')
    const stale = arts.filter((f) => !read(`articles/${f}`).includes(`申込先${m2[1]}件`))
    if (stale.length) bad.push(`記事の案内が資料の2章（${m2[1]}件）と違う ${stale.length}本（node scripts/stamp-offers.mjs）：${stale.join(', ')}`)
    if (!bad.length) console.log(`突き合わせ OK：資料（2章 ${m2[1]}件・3章 ${m3[1]}件・索引 ${m6[1]}件）＝/toei/＝トップのカード＝記事${arts.length}本の案内`)
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
