// build-calendar.mjs — くらしの福祉の予定表。カレンダー（.ics）と一覧ページを作る。
//   node scripts/build-calendar.mjs
//
// ★なぜ作るか（2026-09-14）
//   金額を1つ受け取って帰る面は、それきりになる。けれど福祉には「必ず来る日」がある——
//   年金の支給日、制度が変わる日、公営住宅の募集。そこを押さえておけば、
//   思い出す係を【相手のカレンダーアプリ】がやってくれる。
//   この事業体はメルマガもプッシュ通知も運用できないので、これが数少ない正攻法になる。
//
// ★ダウンロードではなく「購読」にする
//   .ics を固定URLに置くと、カレンダーアプリが定期的に取りに来る。
//   新しい回を足せば、購読している人の手元に勝手に増える。1回きりの取り込みとは別物。
//   （処分アーカイブの棚は個人の持ち物なのでブラウザ内で組む。あちらとは性質が違う）
//
// ★載せてよい日の線引きは data/calendar.json の _rule に書いた。要点だけ再掲：
//   ・一次情報に【年月日】で書かれた日だけ。「毎年◯月ごろ」は載せない
//   ・規則から計算した日は kind:'計算' と明示し、面にもそう出す
//   ・生活保護費の支給日は全国共通ルールが無いので載せない
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'calendar.json'), 'utf8'))
const OUT = path.join(ROOT, 'calendar')
fs.mkdirSync(OUT, { recursive: true })

// ── ICS（RFC 5545）────────────────────────────────────────────────────────────
// 題名を短い固定長の印にする（UID用）。題名が1文字でも違えば別の印になる。
const titleId = (t) => createHash('sha1').update(String(t), 'utf8').digest('hex').slice(0, 12)
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
// 1行75オクテットまで（RFC 5545）。★文字数でなくバイト数で数えること。
//   日本語は1文字3バイト・URLは1文字1バイトなので、文字数で折ると
//   日本語では折りすぎ、長いURLでは折り足りない（実際 koei.ics の
//   名古屋市のURL95文字が未折返しで規格違反になった）。継続行は空白1文字で始める。
const fold = (line) => {
  const out = []
  let cur = '', bytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8')
    const limit = out.length === 0 ? 74 : 73   // 継続行は先頭の空白1バイトぶん引く
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += b
  }
  if (cur) out.push(cur)
  return out.map((s, i) => (i ? ' ' + s : s)).join('\r\n')
}
const ymd = (iso) => iso.replace(/-/g, '')
const nextDay = (iso) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const STAMP = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

function toIcs(cal) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//fukushiru.com//${cal.slug}//JA`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + icsEsc('くらしの福祉｜' + cal.name)),
    fold('X-WR-CALDESC:' + icsEsc(cal.desc)),
    'X-PUBLISHED-TTL:P1D', 'REFRESH-INTERVAL;VALUE=DURATION:P1D']
  for (const e of cal.events) {
    // 終了日は「その日を含む」形で書かれているので、ICS の排他的な DTEND に合わせて翌日にする
    const end = e.end ? nextDay(e.end) : nextDay(e.date)
    const body = [e.note || '', e.kind === '計算' ? '※この日は規則から計算したものです。公表された予定表が出たら差し替えます。' : '', e.url || `${SITE}/calendar/`]
      .filter(Boolean).join('\n')
    L.push('BEGIN:VEVENT')
    // ★UIDは題名ぜんぶから作る。先頭6バイト（＝日本語2文字）だけだと、同じ日に
    //   「都営住宅 ◯◯」が2件並んだ瞬間にUIDが一致し、購読側で片方が静かに消える。
    //   いまの10件は偶然ぶつかっていないだけで、都営の予定は6件が同じ2文字で始まっている。
    //   ★UIDの作り方を変えると、すでに購読している人の手元では「前の予定が消えて新しい予定が入る」
    //     形になる。公開3日目（2026-09-14公開・09-17変更）で購読者がほぼ居ないうちに変えた。
    //     これ以降は変えないこと。
    L.push(`UID:${cal.slug}-${ymd(e.date)}-${titleId(e.title)}@fukushiru.com`)
    L.push('DTSTAMP:' + STAMP)
    L.push('DTSTART;VALUE=DATE:' + ymd(e.date))
    L.push('DTEND;VALUE=DATE:' + ymd(end))
    L.push(fold('SUMMARY:' + icsEsc(e.title + (e.kind === '計算' ? '（見込み）' : ''))))
    L.push(fold('DESCRIPTION:' + icsEsc(body)))
    if (e.url) L.push(fold('URL:' + e.url))
    L.push('TRANSP:TRANSPARENT')
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n') + '\r\n'
}

// ── 一覧ページ（カレンダーアプリを使わない人のため。索引もされる）──────────────
const jp = (iso) => { const [y, m, d] = iso.split('-'); return `${+y}年${+m}月${+d}日` }
const W = ['日', '月', '火', '水', '木', '金', '土']
const wd = (iso) => W[new Date(iso + 'T00:00:00Z').getUTCDay()]
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

let total = 0
const secs = DATA.calendars.map((cal) => {
  fs.writeFileSync(path.join(OUT, cal.slug + '.ics'), toIcs(cal))
  total += cal.events.length
  // ★class を新しく作らない。style.css に定義が無いクラスを書くと、ただの素の見た目で出る
  //   （今日 .fine で実際に踏んだ）。ここは行数も少ないので inline style で足りる。
  // ★過ぎた予定は「薄くする」だけにしない。色が効かない環境で区別が消えるので、文字でも示す。
  // ★「終了」の判定をビルド時に固めない（2026-09-14）。
  //   この面は生成物をコミットする方式なので、回し直さないと日付が古いまま残る。
  //   ビルド日で終了を決めると、次に回すまで過ぎた予定が「これから」の顔で並ぶ。
  //   ∴ data-date だけ埋めておいて、終了かどうかは見た人のブラウザがその場で決める。
  const rows = cal.events.map((e) => {
    const span = e.end ? `${jp(e.date)}〜${jp(e.end)}` : `${jp(e.date)}（${wd(e.date)}）`
    return `<tr data-until="${esc(e.end || e.date)}"><td style="white-space:nowrap">${esc(span)}</td><td>${esc(e.title)}${e.kind === '計算' ? ' <small>（規則から計算した見込み）</small>' : ''}${e.note ? `<br><small>${esc(e.note)}</small>` : ''}${e.url ? `<br><small><a href="${esc(e.url)}" rel="nofollow">出典のページ</a></small>` : ''}</td></tr>`
  }).join('\n')
  return `<h2 id="${esc(cal.slug)}">${esc(cal.name)}</h2>
<p>${esc(cal.desc)}</p>
<p><a class="btn-primary" href="webcal://fukushiru.com/calendar/${esc(cal.slug)}.ics">カレンダーに登録する</a>
　<small>うまく開かないときは <a href="/calendar/${esc(cal.slug)}.ics">${esc(cal.slug)}.ics をダウンロード</a></small></p>
${cal.note ? `<p class="callout note">${esc(cal.note)}</p>` : ''}
<div class="table-wrap"><table>
<thead><tr><th>日付</th><th>予定</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<p class="updated">出典：${cal.sources.map((s) => `<a href="${esc(s.url)}" rel="nofollow">${esc(s.name)}</a>`).join('　／　')}</p>`
}).join('\n\n')

const body = `<nav class="breadcrumb"><a href="/">トップ</a> › くらしの福祉の予定表</nav>
<h1>くらしの福祉の予定表</h1>
<p class="lead">年金の支給日、制度の金額が変わる日、公営住宅の募集。<strong>必ず来る日をカレンダーに入れておけば、その日が近づいたときに手元のカレンダーが知らせてくれます。</strong>登録は無料で、会員登録もメールアドレスも要りません。</p>

<div class="callout point">
<p><strong>「カレンダーに登録する」を押すと、お使いのカレンダーアプリに取り込めます。</strong>一度登録しておけば、あとから新しい日程を足したときも自動で増えます（アプリが定期的に見に来ます）。</p>
<p><small>iPhone・Mac はそのまま開けます。Googleカレンダーは「他のカレンダーを追加 → URLで追加」に、上の .ics のアドレスを貼ってください。</small></p>
</div>

${secs}

<h2>載せていないもの（と、その理由）</h2>
<p>日付を載せるのは、<strong>一次情報に「◯年◯月◯日」と書かれていたものだけ</strong>にしています。「毎年だいたい◯月ごろ」は載せません。次の3つは、そのため載せていません。</p>
<ul>
<li><strong>生活保護費の支給日</strong>……全国共通の決まりがありません。実際に調べると、横浜市は「月の1日から5日までの間で区ごとに定める」、さいたま市と鳴門市は5日、宇土市は1日、豊島区は月末と、自治体ごとにばらばらでした。<strong>お住まいの市区町村の福祉事務所にご確認ください。</strong></li>
<li><strong>児童手当・特別障害者手当・障害児福祉手当</strong>……国が決めているのは支給する「月」までで、何日に振り込むかは自治体が決めます（児童手当は偶数月、特別障害者手当は4月・7月・10月・1月、障害児福祉手当は2月・5月・8月・11月）。</li>
<li><strong>次の回の公営住宅の募集</strong>……日程が公表されるのは、募集の2週間〜1か月前です。公表されたらこの表に足します。</li>
</ul>

<p class="updated">この予定表の確認日：${esc(DATA.verifiedAt)}　／　ページの生成日：${esc(TODAY)}<br>
日付は各出典のページで確認したものです。変更されることがありますので、大切な手続きの前は必ず出典元でご確認ください。</p>

<script>
/* 過ぎた予定に印を付ける。★ビルド時に決めないこと——この面は生成物をコミットする方式なので、
   回し直すまで日付が固まってしまい、過ぎた予定が「これから」の顔で並ぶ。見た人のブラウザが
   その場で判定すれば、次にビルドするまでの間も正しく見える。 */
(function () {
  var t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  var rows = document.querySelectorAll('tr[data-until]')
  var n = 0
  for (var i = 0; i < rows.length; i++) {
    var u = rows[i].getAttribute('data-until')
    if (!u || u >= t) continue
    rows[i].style.opacity = '.55'
    var td = rows[i].cells[1]
    if (td) td.insertAdjacentHTML('afterbegin', '<small>【終了】</small> ')
    n++
  }
})();
</script>`

fs.writeFileSync(path.join(OUT, 'index.html'), page({
  title: 'くらしの福祉の予定表｜年金の支給日・制度が変わる日・公営住宅の募集をカレンダーに',
  desc: '年金の支給日（偶数月15日／土日祝は直前の平日）、生活保護の特例加算が変わる日、都営住宅や市営住宅の募集日程を、カレンダーに登録できる形（.ics）で配っています。無料・登録不要。出典つき。',
  canonical: '/calendar/',
  depth: 1,
  body,
}))

// ── sitemap に1行だけ足す（無ければ）
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
if (!sm.includes('<loc>https://fukushiru.com/calendar/</loc>')) {
  sm = sm.replace(/(\s*)<\/urlset>/, `$1<url><loc>https://fukushiru.com/calendar/</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>$1</urlset>`)
  fs.writeFileSync(smPath, sm)
  console.log('sitemap に /calendar/ を追加')
} else {
  sm = sm.replace(/(<loc>https:\/\/fukushiru\.com\/calendar\/<\/loc><lastmod>)[^<]*(<\/lastmod>)/, `$1${TODAY}$2`)
  fs.writeFileSync(smPath, sm)
  console.log('sitemap の /calendar/ の lastmod を更新')
}

console.log(`カレンダー ${DATA.calendars.length}本 / 予定 ${total}件 → calendar/`)
for (const c of DATA.calendars) {
  const kei = c.events.filter((e) => e.kind === '計算').length
  console.log(`  ${c.slug.padEnd(8)} ${String(c.events.length).padStart(2)}件${kei ? `（うち計算 ${kei}件）` : ''}`)
}
