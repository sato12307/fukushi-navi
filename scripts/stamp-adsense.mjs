// Google AdSense の読み込みタグを、公開するすべてのページの <head> に入れる（2026-09-28 ユーザー指示「アドセンスのスニペット入れてくれ。審査に出す」）。
//   node scripts/stamp-adsense.mjs            … このフォルダの HTML に入れる（.github/workflows/pages.yml がデプロイの直前に回す）
//   node scripts/stamp-adsense.mjs --check    … 書かずに、入る枚数・入らない枚数だけ出す
//
// ★なぜリポジトリの HTML ではなくデプロイの直前に入れるか
//   ページを書く場所が12か所ある（shogai-kojo-page.mjs の page()・生活保護/破産/困窮/介護の各生成器・toei/koei の生成器・
//   tools/*.py・手書きの記事とトップ）。さらに Actions の月次取得（jiritsu-monthly・koei-jutaku）が面を作り直して push する。
//   1か所ずつ足すと、どれかを直し忘れた面や作り直した面だけ黙って抜ける。デプロイは pages.yml の1本しか無いので、ここで入れれば漏れない。
//   ★リポジトリの HTML には入らない（手元で開いた面にはタグが無い）。本番で確かめること。
// ★入れない面：購入後の閲覧画面（/<商品>/kanryo/）。買った資料をその場に開く画面で、広告を出す場所ではない。
// ★同じタグが既にある面には入れない（何度流しても1個）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const CLIENT = 'ca-pub-8371489006990116'
const TAG = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}" crossorigin="anonymous"></script>`
const SKIP_DIR = new Set(['.git', '.github', '.cache', '.dist', 'node_modules', 'scripts', 'tools', 'data'])
const SKIP_PAGE = /(^|\/)kanryo\//

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name)) } else if (e.name.endsWith('.html')) files.push(path.join(dir, e.name))
  }
}
walk(ROOT)

let added = 0, already = 0, skipped = 0
const noHead = []
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  if (SKIP_PAGE.test(rel)) { skipped++; continue }
  const html = fs.readFileSync(f, 'utf8')
  if (html.includes('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')) { already++; continue }
  const i = html.search(/<\/head>/i)
  if (i < 0) { noHead.push(rel); continue }
  if (!CHECK) fs.writeFileSync(f, html.slice(0, i) + TAG + '\n' + html.slice(i))
  added++
}
console.log(`AdSense のタグ：${CHECK ? '入れる予定' : '入れた'} ${added}枚 ／ 既にある ${already}枚 ／ 入れない（購入後の画面）${skipped}枚 ／ HTML 全${files.length}枚`)
// </head> の無い HTML は Google の確認用ファイル（google*.html）のような断片だけのはず。それ以外が出たら止める。
const odd = noHead.filter((r) => !/^google[0-9a-f]+\.html$/.test(r))
if (noHead.length) console.log(`<head> の無い HTML ${noHead.length}枚：${noHead.slice(0, 5).join(', ')}`)
if (odd.length) { console.error('★<head> の無いページがある（ページの作りが変わった？）: ' + odd.slice(0, 10).join(', ')); process.exit(1) }

// ── フッターに「プライバシーポリシー」を足す（2026-10-02）──────────────────────────
// ★AdSense は、第三者配信の広告 Cookie の開示（/privacy/）を求める。フッターの「利用規約」のあとに1つ足す。
//   フッターを書く所も生成器ごとに散っているので、タグと同じくデプロイの直前のここで入れる（何度流しても1個）。
let linked = 0
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8')
  if (/privacy\/">プライバシーポリシー<\/a>/.test(html)) continue
  const next = html.replace(/<a href="([^"]*)kiyaku\/">利用規約<\/a>/, (m, up) => `${m} ／ <a href="${up}privacy/">プライバシーポリシー</a>`)
  if (next === html) continue
  linked++
  if (!CHECK) fs.writeFileSync(f, next)
}
console.log(`フッターのプライバシーポリシー：${CHECK ? '足す予定' : '足した'} ${linked}枚`)
