// アフィリエイトのバナー（A8.net）を、決めた記事の決めた位置に入れる（2026-10-19 ユーザー指示
//   「就労支援のアフィリエイトリンクです。フクシルのトップ3記事に実装してくれ」）。
//   node scripts/stamp-affiliate.mjs           … このフォルダの HTML に入れる（.github/workflows/pages.yml がデプロイの直前に回す）
//   node scripts/stamp-affiliate.mjs --check   … 書かずに、入る位置が見つかるかだけ出す
//
// ★トップ3＝Cloudflare の直近14日・日本からの訪問の入口（2026-10-19 `node tools/cf-analytics.mjs --site fukushiru.com --days 14 --jp`）：
//   住民税非課税の判定 770・生活保護の計算機 550・障害者控除 170。記事を入れ替えるときは下の SLOTS を直す。
// ★なぜデプロイの直前に入れるか：この3記事には部分を書き換える台本（keisanki-sync・kinro-kojo-lib・hikazei-lib・stamp-offers など）が
//   多くかかっており、リポジトリの HTML に書くとどれかに剥がされうる。AdSense のタグ（stamp-adsense.mjs）と同じく、公開の直前の1か所で入れる。
//   ＝リポジトリの HTML には入らない（手元で開いた面にはバナーが無い）。本番で確かめること。
// ★置き場所は本文の流れに合う位置で、有料への案内（offer:pack・offer-hub）からは離す（売り場の導線を邪魔しない）。
// ★「広告」と表示する（2023-10 施行の景品表示法のステルスマーケティング規制）。リンクは rel="nofollow sponsored"（Google の推奨）。
//   A8.net の計測の URL（a8mat・バナーと 1x1 の計測画像）は渡されたまま変えない。スマホで横にはみ出さないよう max-width だけ足す。
// ★何度流しても1個（目印 <!-- aff:… --> 〜 <!-- /aff --> の間を差し替える）。位置が見つからないときは入れずに警告を出す（デプロイは止めない）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')

// 就労支援（A8.net・2026-10-19 にユーザーから受け取ったコード）
const SHURO = `<!-- aff:shuro（scripts/stamp-affiliate.mjs が公開の直前に入れる） -->
<aside class="aff" aria-label="広告" style="margin:28px 0;text-align:center">
<p style="margin:0 0 4px;font-size:12px;color:#888;text-align:left">広告</p>
<a href="https://px.a8.net/svt/ejp?a8mat=4B8097+6D7YZU+47GS+BYLJL" rel="nofollow sponsored">
<img border="0" width="468" height="60" alt="就労支援サービス（広告）" src="https://www23.a8.net/svt/bgt?aid=260714059385&wid=004&eno=01&mid=s00000019630002009000&mc=1" style="max-width:100%;height:auto"></a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B8097+6D7YZU+47GS+BYLJL" alt="">
</aside>
<!-- /aff -->
`

// 記事・入れる位置（この正規表現に当たる行の直前に入れる）・バナー
const SLOTS = [
  // 「③ 非課税世帯になると受けられる主なメリット」の後、「④ よくある質問」の前
  { file: 'articles/juminzei-hikazei-check.html', before: /^\s*<h2[^>]*>\s*④\s*よくある質問/m, html: SHURO },
  // 「③ 働いた収入がある場合【差額支給の計算】」（勤労控除の計算）の後、「④ よくある誤解」の前
  { file: 'articles/seikatsuhogo-keisanki.html', before: /^\s*<h2[^>]*>\s*④\s*よくある誤解/m, html: SHURO },
  // 「⑤ 申告方法（年末調整・確定申告）」の後、「よくある質問（FAQ）」の前
  { file: 'articles/shogaisha-kojo-tax.html', before: /^\s*<h2[^>]*>\s*よくある質問（FAQ）/m, html: SHURO },
]

let ok = 0
for (const s of SLOTS) {
  const p = path.join(ROOT, s.file)
  if (!fs.existsSync(p)) { console.log(`::warning::stamp-affiliate: ${s.file} が無い`); continue }
  let html = fs.readFileSync(p, 'utf8').replace(/<!-- aff:[\s\S]*?<!-- \/aff -->\n?/g, '')
  const m = html.match(s.before)
  if (!m) { console.log(`::warning::stamp-affiliate: ${s.file} に入れる位置（${s.before}）が見つからない。見出しが変わった可能性`); continue }
  html = html.slice(0, m.index) + s.html + html.slice(m.index)
  if (!CHECK) fs.writeFileSync(p, html)
  ok++
  console.log(`${CHECK ? '入る' : '入れた'}: ${s.file}`)
}
console.log(`アフィリエイトのバナー: ${ok}/${SLOTS.length}記事`)
