// ─────────────────────────────────────────────────────────────────────────────
// mitoshi-kogaku.mjs — 高額療養費の上限額の「版の記録」 /mitoshi/kogaku/ を作る。
//   node scripts/mitoshi-kogaku.mjs        → mitoshi/kogaku/index.html と sitemap.xml の1行
//   node scripts/mitoshi-kogaku.mjs --dry  → 書かずに主な数字だけ
//
// ★この面で言っていること（2026-09-22 着工・ユーザー承認）
//   上限額は「当初案（2025年1月）→ 見合わせ（2025年3月）→ 新しい案（2025年12月）→ 実施（2026年8月）
//   → 2段目（2027年8月・決定済み）」と動いた。各版の表は厚労省のPDFに散らばっていて、
//   年収ごとに円で並べた1枚はどこにも無い（競合・検索上位を下調べで確認）。その1枚を作る。
//
// ★言ってはいけないこと
//   ① 当初案は**一度も実施されていない**。「当初案より〇円下がった」は案どうしの差で、
//     実際に払った額が下がったのではない。表の見出しと本文で毎回そう書く。
//   ② 2027年8月の額は決定済み（厚労省の施行の表に載っている）。「予定」と書くのは日付だけ。
//   ③ 70歳以上は外来の上限など別の作りなので、この面では扱わない（公式の表へ渡す）。
//
// ★数字は data/mitoshi-kogaku.json だけが持つ。本文に金額を直書きしない。
//   既存の計算機（articles/kougaku-ryouyouhi-2026.html）の BRACKETS と、ketsu2026 の値が一致することを
//   ここで確かめる（同じ額を2か所に書いているので、ずれたら止める）。[[same-question-two-implementations]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mitoshi-kogaku.json'), 'utf8'))
const OUT_REL = 'mitoshi/kogaku/index.html'
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }

const yen = (n) => `${n.toLocaleString('ja-JP')}円`
const V = Object.fromEntries(D.versions.map((v) => [v.id, v]))
const fixOf = (b, id) => b.v[id][0]
const cell = (pair) => pair[1] == null
  ? `<strong>${yen(pair[0])}</strong>`
  : `<strong>${yen(pair[0])}</strong><br><small>医療費が${yen(pair[1])}を超えた分の1%を足す</small>`
const diff = (a, b) => (b - a === 0 ? '変わらず' : `${b > a ? '＋' : '−'}${yen(Math.abs(b - a))}`)
const pct = (a, b) => `${b >= a ? '＋' : '−'}${Math.abs(Math.round(((b - a) / a) * 1000) / 10)}%`
const shortLabel = (s) => s.replace(/^年収 /, '').replace('住民税非課税', '住民税非課税の世帯')

// ── 既存の計算機と額が一致するか（2026年8月の額は2か所にある）──────────────
{
  const art = fs.readFileSync(path.join(ROOT, 'articles', 'kougaku-ryouyouhi-2026.html'), 'utf8')
  const pick = (k) => { const m = new RegExp(`${k}: \\{[^}]*newFix:\\s*(\\d+),\\s*newTh:\\s*(\\d+|null)`).exec(art); return m ? [Number(m[1]), m[2] === 'null' ? null : Number(m[2])] : null }
  const want = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ' }
  for (const [k, kubun] of Object.entries(want)) {
    const got = pick(k)
    const b = D.brackets.find((x) => x.kubun === kubun)
    const mine = b.v.ketsu2026
    if (!got || got[0] !== mine[0] || got[1] !== mine[1]) die(`計算機の区分${kubun}（${JSON.stringify(got)}）と、この面の2026年8月の額（${JSON.stringify(mine)}）が違います。どちらかが誤りです。`)
  }
}

// ── ② いまの額と2027年8月 ──────────────────────────────────────────────────
const rowsNow = D.brackets.map((b) => {
  const g = fixOf(b, 'genko'), n = fixOf(b, 'ketsu2026'), f = fixOf(b, 'ketsu2027')
  return `<tr><th scope="row">${esc(shortLabel(b.label))}<br><small>区分${esc(b.kubun)}</small></th><td class="num">${yen(n)}<br><small>これまで${yen(g)}</small></td><td class="num">${yen(f)}<br><small>これまでより${diff(g, f)}（${pct(g, f)}）</small></td></tr>`
}).join('\n')

// ── ③ 当初案との差（案どうしの差）────────────────────────────────────────────
const rowsAn = D.brackets.map((b) => {
  const a = fixOf(b, 'an2027'), k = fixOf(b, 'ketsu2027')
  return `<tr><th scope="row">${esc(shortLabel(b.label))}</th><td class="num">${yen(k)}<br><small>${a === k ? '当初案と同じ' : `当初案より${yen(Math.abs(a - k))}${k < a ? '低い' : '高い'}`}</small></td><td class="num">${yen(a)}</td></tr>`
}).join('\n')
const maxGap = D.brackets.reduce((m, b) => Math.max(m, fixOf(b, 'an2027') - fixOf(b, 'ketsu2027')), 0)
const maxGapB = D.brackets.find((b) => fixOf(b, 'an2027') - fixOf(b, 'ketsu2027') === maxGap)
const lowerN = D.brackets.filter((b) => fixOf(b, 'ketsu2027') < fixOf(b, 'an2027')).length
const higherN = D.brackets.filter((b) => fixOf(b, 'ketsu2027') > fixOf(b, 'an2027')).length
if (D.brackets.some((b) => fixOf(b, 'ketsu2027') > fixOf(b, 'an2027') && fixOf(b, 'an2027') !== fixOf(b, 'an2025'))) die('当初案より高く決まった区分の説明（2025年8月の額のまま据え置く案）がデータと合いません。')

// ── ④ 年収ごとの版の記録 ────────────────────────────────────────────────────
const blocks = D.brackets.map((b, i) => `  <h3 id="b${i + 1}">${esc(b.label)}（区分${esc(b.kubun)}）</h3>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>版</th><th>月の上限</th></tr></thead>
  <tbody>
${D.versions.map((v) => `  <tr${v.state === 'dropped' ? ' style="color:var(--sub)"' : ''}><th scope="row">${esc(v.label)}<br><small>${esc(v.stateText)}</small></th><td>${cell(b.v[v.id])}</td></tr>`).join('\n')}
  </tbody></table></div>`).join('\n')

// ── ⑤ 4回目以降と年間上限 ──────────────────────────────────────────────────
const rowsTasu = D.tasu.rows.map((r) => `<tr><th scope="row">区分${esc(r.kubun)}</th><td class="num">${yen(r.ketsu2026)}<br><small>これまでと同じ（当初案は${yen(r.an2025)}）</small></td><td class="num">${yen(r.nenkan2026)}</td></tr>`).join('\n')
if (D.tasu.rows.some((r) => r.genko !== r.ketsu2026)) die('4回目以降の上限が「これまでと同じ」でない区分があります。⑤の書き方を直してください。')

// ── ⑥ 年表 ─────────────────────────────────────────────────────────────────
const wa = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}年${m}月${dd}日` }
const rowsTl = D.timeline.map((t) => `<tr><th scope="row">${wa(t.date)}</th><td>${esc(t.text)}<br><small><a href="${esc(t.src)}" rel="nofollow">出典</a></small></td></tr>`).join('\n')

const ex = D.brackets.find((b) => b.label.includes('約370万〜約510万円'))
const title = '高額療養費の上限額はどう動いたか｜当初案・見合わせ・決定を年収別に並べた記録｜フクシル'
const desc = `高額療養費の自己負担の上限額は、2025年1月の当初案が3月に見合わせになり、12月の新しい案で2026年8月から引き上げられ、2027年8月に2段目があります。厚生労働省の資料に散らばった各版の額を、年収13区分ごとに1枚に並べました。例：年収約370万〜510万円は${yen(fixOf(ex, 'genko'))}→${yen(fixOf(ex, 'ketsu2026'))}（2027年8月も同額）。`

// ★この面の表は3列までにしてあるので、サイト共通の「最小幅520px・見出し列は折り返さない」を外して画面に収める。
const FIT_CSS = `<style>table.fit{min-width:0}table.fit tbody th,table.fit td.num{white-space:normal}table.fit td.num{word-break:keep-all}</style>`
const body = `${FIT_CSS}
  <p class="updated">最終確認：${D.checked} ／ 70歳未満の月の上限額（すべて厚生労働省の公表資料から転記）</p>
  <h1>高額療養費の上限額は、どう動いたか<br><small>当初案・見合わせ・決定を、年収ごとに1枚に並べた記録</small></h1>

  <p class="lead">病院の支払いが月の上限を超えたら払い戻される「高額療養費」。その上限額は、<strong>2025年に一度引き上げが決まりかけて見合わせになり、作り直した案で2026年8月から上がり、2027年8月にもう一度上がる</strong>ことが決まっています。
  それぞれの版の表は厚生労働省の別々の資料にあり、年収ごとに並べて比べられる形では公表されていません。ここではそれを1枚にまとめました。</p>

  <div class="callout note"><p><span class="tag">先に知っておいてください</span>
  <strong>2025年1月の当初案は、一度も実施されていません。</strong>このページで「当初案より低い」と書くのは<strong>案どうしの比較</strong>で、実際に払う額が下がったという意味ではありません。
  実際に払う額は「これまで → 2026年8月〜 → 2027年8月〜」の順に<strong>上がっています</strong>。</p></div>

  <h2>① いま決まっていること</h2>
  <ul>
  <li><strong>2026年8月診療分から</strong>、月の上限額が区分ごとに引き上げられました（実施中）。</li>
  <li><strong>2027年8月診療分から</strong>、年収の区分をさらに細かく分け、年収が高い区分ほど上限が上がります。<strong>額はもう決まっています</strong>（厚生労働省が施行の表を公表済み）。</li>
  <li>4回目以降の上限（多数回該当）は<strong>据え置き</strong>、1年間の上限（年間上限）が<strong>新しくできました</strong>（⑤）。</li>
  <li>このページの額は<strong>70歳未満</strong>のものです。70歳以上は外来の上限など作りが違うので、<a href="${esc(V.ketsu2026.src)}" rel="nofollow">厚生労働省の表</a>をご覧ください。</li>
  </ul>

  <h2>② 年収ごとに：これまで → いま → 2027年8月</h2>
  <p>月の上限額の<strong>基本の額</strong>です。年収が約370万円より上の区分は、医療費が一定の額を超えると、超えた分の1%が上限に足されます（④に式を載せました）。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>年収の目安</th><th class="num">いま<br><small>2026年8月〜</small></th><th class="num">2027年8月〜<br><small>決定済み</small></th></tr></thead>
  <tbody>
${rowsNow}
  </tbody></table></div>
  <p class="mini-note">年収の目安は厚生労働省の表の「年収換算」です。実際の区分は、会社員なら標準報酬月額、国民健康保険なら旧ただし書き所得で決まります。2026年7月までと2026年8月からは5区分（ア〜オ）で、2027年8月から13区分になります。</p>

  <h2>③ 当初案だったら、いくらだったか</h2>
  <p>2025年1月の当初案の最終段（2027年8月〜）と、決まった額（2027年8月〜）を比べます。<strong>どちらも2027年8月からの額で、当初案は実施されていません</strong>。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>年収の目安</th><th class="num">決定<br><small>2027年8月〜</small></th><th class="num">当初案<br><small>実施されず</small></th></tr></thead>
  <tbody>
${rowsAn}
  </tbody></table></div>
  <p>13区分のうち${lowerN}区分で、決まった額は当初案より低くなりました。差がいちばん大きいのは${esc(maxGapB.label)}で、月${yen(maxGap)}です。${higherN ? `逆に、当初案より高く決まった区分が${higherN}つあります（${D.brackets.filter((b) => fixOf(b, 'ketsu2027') > fixOf(b, 'an2027')).map((b) => esc(shortLabel(b.label))).join('・')}）。当初案はこれらの区分を2025年8月の額のまま据え置く案だったためです。` : ''}</p>

  <h2>④ 年収ごとの版の記録</h2>
  <p>同じ年収の人の上限額が、案ごと・時期ごとにどう書かれてきたかです。灰色の行は実施されなかった案です。</p>
${blocks}

  <h2>⑤ 4回目以降の上限と、1年間の上限</h2>
  <p>直近12か月に3回以上上限に達すると、4回目からは上限が下がります（多数回該当）。当初案ではここも引き上げる案でしたが、2025年2月に取りやめになり、決まった額では<strong>据え置き</strong>です。あわせて、1年間（8月〜翌7月）の自己負担の合計に上限ができました。</p>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>区分</th><th class="num">4回目以降の上限<br><small>いま</small></th><th class="num">年間上限<br><small>新設</small></th></tr></thead>
  <tbody>
${rowsTasu}
  </tbody></table></div>
  <p class="mini-note">区分エのうち年収約200万円以下と確認できた人は、年間上限が41万円で、2027年8月以降に払い戻されます。2027年8月からは、年収約200万円までの区分の4回目以降の上限が34,500円・年間上限が41万円になります（厚生労働省の表より）。</p>

  <h2>⑥ 経緯の年表</h2>
  <div class="table-wrap"><table class="fit">
  <thead><tr><th>日付</th><th>できごと</th></tr></thead>
  <tbody>
${rowsTl}
  </tbody></table></div>

  <div class="callout note"><p><span class="tag">自分の額を計算する</span>
  年収と医療費を入れると、これまでといまの上限額と差額が出る計算機は<a href="../../articles/kougaku-ryouyouhi-2026.html">高額療養費の上限額の計算機</a>にあります。
  住民税非課税かどうかは<a href="../../articles/juminzei-hikazei-check.html">住民税非課税の判定</a>で確かめられます。</p></div>

  <div class="sources">
  <h2>出典と、この記録の決まりごと</h2>
  <ul>
${D.versions.filter((v, i, a) => a.findIndex((x) => x.src === v.src) === i).map((v) => `  <li>${esc(v.srcText)} ${esc(v.src)}</li>`).join('\n')}
  <li>経緯の出典は⑥の各行にあります。</li>
  <li>額は各資料の表から当方が転記しました（${D.checked} 照合）。誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</li>
  <li>新しい案や改正が公表されたら、版を1つ足します。消さずに残します。</li>
  </ul>
  </div>
`

const html = page({
  title, desc, canonical: '/mitoshi/kogaku/', depth: 2, body,
  jsonld: [
    { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/mitoshi/kogaku/`, datePublished: '2026-09-22', dateModified: D.checked, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } },
  ],
})

if (DRY) {
  console.log(`13区分・6版。当初案より低く決まった ${lowerN}区分・高く決まった ${higherN}区分・最大の差 ${maxGapB.label} ${yen(maxGap)}`)
  process.exit(0)
}

// sitemap（手書きで育てたもの。/mitoshi/kogaku/ の1行だけ足す・置き換える）
const smPath = path.join(ROOT, 'sitemap.xml')
const sm = fs.readFileSync(smPath, 'utf8')
const loc = `<loc>${SITE}/mitoshi/kogaku/</loc>`
const outPath = path.join(ROOT, OUT_REL)
const changed = !fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== html
const entry = `<url>${loc}<lastmod>${changed ? TODAY : ((/<lastmod>([^<]+)<\/lastmod>/.exec(sm.slice(sm.indexOf(loc))) || [])[1] || TODAY)}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
let smNext
if (sm.includes(loc)) {
  const at = sm.lastIndexOf('<url>', sm.indexOf(loc))
  smNext = sm.slice(0, at) + entry + sm.slice(sm.indexOf('</url>', at) + '</url>'.length)
} else smNext = sm.replace('</urlset>', `  ${entry}\n</urlset>`)

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, html)
if (smNext !== sm) fs.writeFileSync(smPath, smNext)
console.log(`${OUT_REL}（${changed ? '更新' : '変更なし'}）／ 当初案より低く決まった ${lowerN}区分・高く ${higherN}区分・最大の差 ${maxGapB.label} ${yen(maxGap)}`)
