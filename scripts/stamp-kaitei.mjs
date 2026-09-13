// 手書きの記事に、カワルヒ層のブロック（scripts/kaitei-block.mjs）を貼り直す。
//   node scripts/stamp-kaitei.mjs
//
// 記事は手書きなので生成器を通らない。文言を変えたら kaitei-block.mjs か data/kaitei.json を
// 直してこれを回す。目印：<!-- kaitei:<key> --> … <!-- /kaitei --> の間を差し替える。
//
// ★作りは scripts/stamp-offers.mjs をそのまま踏襲する（別の作法を発明しない）。
//   ・before があれば「剥がしてから入れ直す」＝何度流しても同じ結果になる
//   ・中身が変わった記事だけ sitemap.xml の lastmod を今日にする
//   ・表の枚数と実際に入っている枚数を突き合わせ、合わなければ非ゼロ終了
//
// ★置く位置の規則は売り場と同じ＝「その面の問いに答えている要素の直後」。
//   金額を受け取った直後に賞味期限が目に入らないと、置いた意味がほとんど消える。
//   どの記事も「① 早見表／結論」→「② 自動計算」という作りなので、②の見出しの直前に入れる。
//
// ★対象は5枚だけ。一次情報で値の裏が取れた制度しか載せない（2026-09-14 の検証結果）。
//   高額療養費・障害年金・障害福祉サービスの負担上限は、今回一次情報に当たっていないので対象外。
//   「たぶんこの値」で金額の決定日を書くと、誤情報を出典つきで配ることになる。
import fs from 'node:fs'
import { kaiteiBlock, kaiteiCoverage } from './kaitei-block.mjs'

const TARGETS = {
  // 生活保護＝4行すべてが一次情報で埋まる唯一の制度（告示本文がHTMLで読める）。
  // ②自動計算の見出しの直前＝①早見表（この面の最初の答え）の直後。
  'seikatsuhogo-keisanki.html': { key: 'seikatsuhogo', before: /  <h2>② あなたの世帯でいくら？【自動計算】<\/h2>/ },

  // 住民税非課税＝金額が市区町村の条例で決まるため全国一意でない。その但し書きごと出す。
  'juminzei-hikazei-check.html': { key: 'juminzei-hikazei', before: /  <h2>② あなたの世帯は？【自動判定】<\/h2>/ },

  // 障害者控除＝現在値と根拠条文は取れる。27万・40万がいつ決まったかは取れなかったので、
  // 「取れなかった」と書いてある（黙って省かない）。
  'shogaisha-kojo-tax.html': { key: 'shogaisha-kojo', before: /  <h2>② 実際にいくら軽くなる？（減税額の考え方）<\/h2>/ },

  // 公営住宅の収入基準＝平成21年4月1日から17年間据え置き。据え置きであること自体が答えになる。
  'koei-shunyu-kijun.html': { key: 'koei-shunyu', before: /  <h2 id="keisanki">② あなたの世帯は基準内？【自動判定】<\/h2>/ },

  // 家賃計算の控除額＝政令に直書き。次の改定は予告できないので、その旨だけ書く。
  'koei-yachin-keisan.html': { key: 'koei-yachin', before: /  <h2 id="kiso">② 家賃算定基礎額の全8区分（全国共通・34,400円〜91,100円）<\/h2>/ },
}

const block = (t) => `<!-- kaitei:${t.key} -->\n${kaiteiBlock(t.key)}\n  <!-- /kaitei -->`

const files = fs.readdirSync('articles').filter((f) => f.endsWith('.html'))
const missing = Object.keys(TARGETS).filter((f) => !files.includes(f))
if (missing.length) { console.error('表にあるのに記事が無い:', missing.join(', ')); process.exit(1) }

let moved = 0, inserted = 0
const failed = []
const changedFiles = []
for (const f of Object.keys(TARGETS)) {
  const t = TARGETS[f]
  const p = 'articles/' + f
  const raw = fs.readFileSync(p, 'utf8')
  const crlf = raw.includes('\r\n')
  let s = raw.replace(/\r\n/g, '\n')
  const marked = /\n*<!-- kaitei:[a-z-]+ -->[\s\S]*?<!-- \/kaitei -->\n*/
  const had = marked.test(s)
  if (had) s = s.replace(marked, '\n\n')          // いま貼ってある場所から剥がす
  if (!t.before.test(s)) { failed.push(f); continue }
  s = s.replace(t.before, (m) => `${block(t)}\n\n${m}`)
  had ? moved++ : inserted++
  const out = crlf ? s.replace(/\n/g, '\r\n') : s
  if (out !== raw) changedFiles.push(f)
  fs.writeFileSync(p, out)
}
if (failed.length) { console.error('位置が見つからない:', failed.join(', ')); process.exit(1) }

// 中身が変わった記事は sitemap.xml の lastmod を今日（日本時間）にする。
if (changedFiles.length) {
  const smRaw = fs.readFileSync('sitemap.xml', 'utf8')
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  let sm = smRaw
  const notIn = []
  for (const f of changedFiles) {
    const re = new RegExp(`(<loc>[^<]*/articles/${f.replace(/\./g, '\\.')}</loc><lastmod>)([^<]*)(</lastmod>)`)
    if (!re.test(sm)) { notIn.push(f); continue }
    sm = sm.replace(re, (_, a, _d, c) => a + today + c)
  }
  if (sm !== smRaw) fs.writeFileSync('sitemap.xml', sm)
  console.log(`中身が変わった記事 ${changedFiles.length}枚 → sitemap の lastmod を ${today} に${notIn.length ? `（sitemap に無い：${notIn.join(', ')}）` : ''}`)
}

// 検算：表の枚数と、実際にブロックが入っている記事の枚数を突き合わせる。
const has = files.filter((f) => /<!-- kaitei:[a-z-]+ -->/.test(fs.readFileSync('articles/' + f, 'utf8')))
console.log(`位置を決め直し ${moved} ／ 新規 ${inserted} ／ 表 ${Object.keys(TARGETS).length}枚 ／ 実際にブロックのある記事 ${has.length}枚`)

// どの制度が4行フルで、どれが欠けているかを毎回出す（欠けを隠さない）。
const cov = kaiteiCoverage()
for (const f of Object.keys(TARGETS)) {
  const k = TARGETS[f].key, c = cov[k]
  const lines = ['now', 'decided', 'lastChange', 'next'].filter((x) => c[x]).length
  console.log(`  ${k.padEnd(18)} ${lines}/4行${c.full ? '（フル）' : ''}`)
}

if (has.length !== Object.keys(TARGETS).length) { console.error('★数が合わない'); process.exit(1) }
