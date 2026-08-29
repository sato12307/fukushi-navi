// ─────────────────────────────────────────────────────────────────────────────
// houkatsu-build.mjs — 町名から担当の地域包括支援センターを引く面を作る。
//
// ★出すもの / 出さないもの
//   出す: 自治体が公表している「担当区域」をそのまま町丁目へ割ったもの、
//         番地・住居表示番号の但し書き、出典URL、自治体の公表年月、当方の取得日。
//   出さない: センターの評価・ランク付け・比較。事実の並置に留める。
//             [[post-sanction-status-disclosure]] の型は事業者ではなく高齢者本人が相手なので、
//             こちらは実名を出しても「良い/悪い」を一切言わない。
//   出さない: 担当の断定。担当が2つ以上に割れている町丁目は畳まず両方出す。
//
// ★「全国」と名乗らない
//   政令市20市の実測で、機械可読かつ町名粒度なのは数市だけだった。
//   PDFで出している自治体は7本中7本で日本語が1文字も抽出できない。
//   名古屋・京都・福岡などは担当が学区単位で、町名から引くには第2の突合表が要る。
//   ∴ 収録した自治体だけを名乗り、未収録を「担当が無い」と読ませない。
//
// ★URLに日本語を使わない
//   全国地方公共団体コード（6桁）をファイル名にする。[[encoded-filename-csv-404]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { byTown } from './houkatsu-lib.mjs'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'houkatsu')
const OUT = path.join(ROOT, 'houkatsu')
const TODAY = new Date().toISOString().slice(0, 10)

// ★取り残しを消す。上書きだけだと、収録をやめた自治体のページが公開され続ける。
// [[build-must-prune-stale-pages]]
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json'))
if (!files.length) { console.error('data/houkatsu が空。先に houkatsu-fetch.mjs を回すこと'); process.exit(1) }

const kana = (s) => s.normalize('NFKC')
const built = []

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'))
  const map = byTown(j.centers)
  const rows = [...map.values()].sort((a, b) => kana(a.key).localeCompare(kana(b.key), 'ja'))
  if (!rows.length) { console.error(`${j.city}: 町丁目が0件。落とす`); continue }

  const multi = rows.filter((r) => r.multi).length
  const place = `${j.pref}${j.city}`
  const wards = [...new Set(j.centers.map((c) => c.ward).filter(Boolean))]

  const table = rows.map((r) => {
    const hits = r.hits.map((h) => {
      const note = h.notes.length ? `<span class="note">（${esc(h.notes.join('／'))}）</span>` : ''
      return `<span class="ctr">${esc(h.center)}</span>${note}`
    }).join('<br>')
    return `<tr${r.multi ? ' class="multi"' : ''}><th scope="row">${esc(r.key)}</th><td>${hits}${r.multi ? '<br><small class="warn">この町丁目は番地で担当が分かれます。番地でご確認ください。</small>' : ''}</td></tr>`
  }).join('\n')

  const centerList = j.centers
    .slice()
    .sort((a, b) => kana(a.name).localeCompare(kana(b.name), 'ja'))
    .map((c) => `<li>${esc(c.name)}${c.ward ? `<small>（${esc(c.ward)}）</small>` : ''}</li>`)
    .join('')

  const src = j.sources.map((s) =>
    `<li><a href="${esc(s.url)}" rel="nofollow">${esc(s.label)}</a>${s.published ? `<small>／自治体の公表版：${esc(s.published)}</small>` : ''}</li>`).join('')

  const title = `${place}の地域包括支援センター｜町名から担当を探す｜フクシル`
  const desc = `${place}で、お住まいの町名から担当の地域包括支援センターを引けます。${j.centers.length}か所・町丁目${rows.length}件を、${j.city}の公表資料から一覧にしました。番地で担当が分かれる町丁目も畳まずそのまま載せています。`

  const body = `
<nav class="breadcrumb" aria-label="現在地"><a href="../index.html">トップ</a> ＞ <a href="./index.html">地域包括支援センターの逆引き</a> ＞ ${esc(place)}</nav>
<h1>${esc(place)}｜町名から担当の地域包括支援センターを探す</h1>

<p class="lead">介護の相談窓口である地域包括支援センターは、住んでいる町丁目ごとに担当が決まっています。
${esc(j.city)}が公表している担当区域を、町丁目の側から引けるように並べ替えました。
収録は<strong>${j.centers.length}か所・町丁目${rows.length}件</strong>${wards.length ? `（${esc(wards.join('・'))}）` : ''}です。</p>

<div class="callout point">
<p><strong>この表の読み方</strong></p>
<ul>
<li>担当が2つ以上に分かれている町丁目が<strong>${multi}件（${(multi / rows.length * 100).toFixed(1)}％）</strong>あります。町名だけでは決まらないので、番地までご確認ください。</li>
<li>但し書きの番地・住居表示番号は、${esc(j.city)}の公表資料の表記をそのまま載せています。</li>
<li>センターの良し悪しは扱いません。担当がどこかという事実だけを並べています。</li>
</ul>
</div>

<label class="filter"><span>町名でしぼり込む</span>
<input type="search" id="q" placeholder="例：大森中" autocomplete="off"></label>
<p id="hit" class="hit" hidden></p>

<div class="table-wrap">
<table id="tbl">
<caption>${esc(place)}の町丁目と担当の地域包括支援センター</caption>
<thead><tr><th scope="col">町丁目</th><th scope="col">担当の地域包括支援センター</th></tr></thead>
<tbody>
${table}
</tbody>
</table>
</div>

<h2>収録したセンター（${j.centers.length}か所）</h2>
<ul class="center-list">${centerList}</ul>

<h2>出典と鮮度</h2>
<ul>${src}</ul>
<p class="updated">当サイトが取得した日：${esc(j.fetchedAt)}／このページの生成日：${esc(TODAY)}／担当区域の粒度：${esc(j.grain)}</p>
<p class="note">自治体は担当区域を予告なく変更し、掲載ファイルも差し替えます。実際に相談へ行く前に、必ず上の出典元か${esc(j.city)}の窓口で最新をご確認ください。
記載の誤りに気づかれた場合は <a href="mailto:contact@fukushiru.com">contact@fukushiru.com</a> までお知らせください。確認のうえ訂正します。</p>

<script>
(function(){
  var q=document.getElementById('q'), tb=document.querySelector('#tbl tbody'), hit=document.getElementById('hit');
  if(!q||!tb) return;
  var rows=[].slice.call(tb.rows);
  q.addEventListener('input', function(){
    var v=q.value.trim(); var n=0;
    for(var i=0;i<rows.length;i++){
      var on = !v || rows[i].cells[0].textContent.indexOf(v)>=0;
      rows[i].hidden = !on; if(on) n++;
    }
    hit.hidden = !v; hit.textContent = v ? (n+'件みつかりました') : '';
  });
})();
</script>
`
  fs.writeFileSync(path.join(OUT, `${j.code}.html`), page({
    title, desc, canonical: `/houkatsu/${j.code}.html`, depth: 1, body,
  }))
  built.push({ code: j.code, place, muni: `${j.pref}${j.muni || j.city}`, centers: j.centers.length, towns: rows.length, multi, grain: j.grain })
}

// ── ハブ ──────────────────────────────────────────────────────────────────────
const munis = new Set(built.map((b) => b.muni)).size
const totalTowns = built.reduce((a, b) => a + b.towns, 0)
const totalCenters = built.reduce((a, b) => a + b.centers, 0)
const list = built
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((b) => `<tr><th scope="row"><a href="./${b.code}.html">${esc(b.place)}</a></th><td>${b.centers}</td><td>${b.towns}</td><td>${b.multi}</td><td>${esc(b.grain)}</td></tr>`)
  .join('\n')

const hubBody = `
<nav class="breadcrumb" aria-label="現在地"><a href="../index.html">トップ</a> ＞ 地域包括支援センターの逆引き</nav>
<h1>町名から担当の地域包括支援センターを探す</h1>

<p class="lead">介護でいちばん最初に必要になるのは「親の住所の担当窓口はどこか」です。
ところが厚生労働省の介護サービス情報公表システムは<strong>所在地からセンターを探す仕組みで、町丁目から担当を引くことはできません</strong>。
担当区域の表を持っているのは自治体側で、しかも自分の市域の中だけで公開しています。
ここでは、その表を町丁目の側から引けるように並べ替えています。現在<strong>${munis}市区・${totalCenters}か所・町丁目${totalTowns}件</strong>を収録しています（政令市は行政区ごとに分けています）。</p>

<div class="table-wrap">
<table>
<caption>収録している自治体</caption>
<thead><tr><th scope="col">自治体</th><th scope="col">センター数</th><th scope="col">町丁目</th><th scope="col">担当が分かれる町丁目</th><th scope="col">担当区域の粒度</th></tr></thead>
<tbody>
${list}
</tbody>
</table>
</div>

<h2>なぜ収録がこれだけなのか</h2>
<p>収録を増やせない理由がはっきりしているので、正直に書いておきます。2026年8月に政令指定都市20市を実際に調べました。</p>
<ul>
<li><strong>PDFで公表している自治体は、機械では読めません。</strong>7本試して7本とも、日本語が1文字も取り出せませんでした（札幌市・横浜市・大阪市・堺市・広島市など）。文字が画像に近い形で埋め込まれているためです。</li>
<li><strong>担当区域が学区（小学校区・中学校区）単位の自治体があります。</strong>名古屋市・京都市・福岡市・熊本市・岡山市・新潟市・神戸市などがこれにあたり、町名から引くには「学区と町丁目の対応表」がもう1つ必要になります。名古屋市は自ら「通学区域一覧を参照してください」と案内しています。</li>
<li><strong>そもそも表の粒度が自治体ごとに違います。</strong>町丁目まで書く自治体、町名だけの自治体、番地まで刻む自治体が混在します。</li>
</ul>
<p>そのため、ここでは<strong>機械で読めて、かつ町名の粒度で公表している自治体だけ</strong>を収録しています。
載っていない自治体に担当センターが無いという意味ではありません。お住まいの市区町村のウェブサイトか窓口でご確認ください。</p>

<h2>扱わないこと</h2>
<ul>
<li>センターの評価・ランク付け・比較はしません。担当がどこかという事実だけを並べます。</li>
<li>担当を1つに決めつけません。番地で分かれている町丁目は、両方のセンターをそのまま載せます。</li>
<li>申請できるか・受けられるかの判定はしません。それは窓口の仕事です。</li>
</ul>

<p class="updated">生成日：${esc(TODAY)}／出典は各自治体のページに明記しています。</p>
`

fs.writeFileSync(path.join(OUT, 'index.html'), page({
  title: '町名から担当の地域包括支援センターを探す｜フクシル',
  desc: `町丁目から担当の地域包括支援センターを引ける一覧。${munis}市区・${totalCenters}か所・町丁目${totalTowns}件を自治体の公表資料から収録。厚労省のシステムは所在地検索で町名からの逆引きができないため作りました。`,
  canonical: '/houkatsu/index.html', depth: 1, body: hubBody,
}))

// ── sitemap.xml を更新する ────────────────────────────────────────────────────
// ★この艦の sitemap は手書きで育ててきたもの。作り直さない。
//   /houkatsu/ のぶんだけ入れ替える（毎回消してから足すので何度回しても増えない）。
//   生成したのに sitemap に載っていない面は索引されないまま残る。
//   [[stale-production-build-drift]]
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
sm = sm.replace(/^\s*<url>(?:(?!<\/url>)[\s\S])*\/houkatsu\/[\s\S]*?<\/url>\n?/gm, '')
const urls = [`  <url><loc>${SITE}/houkatsu/</loc><lastmod>${TODAY}</lastmod><priority>0.8</priority></url>`]
  .concat(built.map((b) => `  <url><loc>${SITE}/houkatsu/${b.code}.html</loc><lastmod>${TODAY}</lastmod><priority>0.6</priority></url>`))
sm = sm.replace('</urlset>', urls.join('\n') + '\n</urlset>')
fs.writeFileSync(smPath, sm)

console.log('地域包括支援センターの逆引き面')
for (const b of built) console.log(`  ${b.place}\t${b.centers}センター\t町丁目${b.towns}\t担当が分かれる${b.multi}`)
console.log(`  合計 ${munis}市区 / ${built.length}ページ / ${totalCenters}センター / 町丁目${totalTowns}`)
