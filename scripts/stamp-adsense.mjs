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
// ★2026-10-06 直した：フッター（ページの最後の <footer>…</footer>）の中だけを見て、そこへ足す。
//   10-02 の版はページ全体の「最初の利用規約リンク」の後ろに足していたため、本文に「特定商取引法に基づく表記／利用規約」が
//   ある面（売り場の9枚・/tokushoho/・/privacy/ 自身）では本文の側に入り、フッターには入っていなかった。
//   本文にプライバシーポリシーへのリンクがある面（about.html）は、丸ごと飛ばしていた。
// ★同じ日、フッターに法務のリンクがそもそも無い面（tools/build_koei_*.py・kaigo-build.mjs が書く記事14枚。
//   「トップへ戻る／このサイトについて」だけ、または文だけ）にも、欠けているものを足すようにした。
//   課金サイトのフッターには「このサイトについて／特定商取引法に基づく表記／利用規約／プライバシーポリシー」の4つを
//   全ページにそろえる（scratchpad/legal-pages-2026-10-06.md）。これもタグと同じ理由でここ1か所で入れる。
const LEGAL = [
  ['about.html', 'このサイトについて'],
  ['tokushoho/', '特定商取引法に基づく表記'],
  ['kiyaku/', '利用規約'],
  ['privacy/', 'プライバシーポリシー'],
]
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let linked = 0, filled = 0
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8')
  const s = html.lastIndexOf('<footer')
  const e = s < 0 ? -1 : html.indexOf('</footer>', s)
  if (e < 0) continue   // フッターの無い HTML（google*.html のような確認用ファイル）
  const foot = html.slice(s, e)
  // フッターの中の法務リンクの位置（無ければ -1）。相対パスの深さは面ごとに違うので、../ の数は問わない。
  const at = LEGAL.map(([href, label]) => {
    const m = new RegExp(`<a href="(?:\\./|(?:\\.\\./)*)${reEsc(href)}">${reEsc(label)}</a>`).exec(foot)
    return m ? { end: m.index + m[0].length } : null
  })
  const missing = LEGAL.filter((_, i) => !at[i])
  if (!missing.length) continue
  const rel = path.relative(ROOT, f).split(path.sep).join('/')
  const up = '../'.repeat(rel.split('/').length - 1)
  const links = missing.map(([href, label]) => `<a href="${up}${href}">${label}</a>`).join(' ／ ')
  // 足す場所：フッターにある法務リンクのうち一番後ろのものの直後（ふつうは「利用規約」→ その後ろにプライバシーポリシー）。
  //   法務リンクが1つも無いフッターには、最後の </p> の後ろに1段落を足す（</p> も無ければ </footer> の直前）。
  const last = at.filter(Boolean).reduce((a, b) => (b.end > a ? b.end : a), -1)
  let next
  if (last >= 0) next = foot.slice(0, last) + ' ／ ' + links + foot.slice(last)
  else {
    const p = foot.lastIndexOf('</p>')
    next = p >= 0 ? foot.slice(0, p + 4) + `\n    <p>${links}</p>` + foot.slice(p + 4) : foot + `<p>${links}</p>\n`
  }
  if (missing.some(([href]) => href === 'privacy/')) linked++
  if (missing.some(([href]) => href !== 'privacy/')) filled++
  if (!CHECK) fs.writeFileSync(f, html.slice(0, s) + next + html.slice(e))
}
console.log(`フッターのプライバシーポリシー：${CHECK ? '足す予定' : '足した'} ${linked}枚 ／ ほかの法務リンク（特商法表記・利用規約・このサイトについて）も欠けていた面：${filled}枚`)
