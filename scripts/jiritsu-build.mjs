// ─────────────────────────────────────────────────────────────────────────────
// jiritsu-build.mjs — 自立支援医療（精神通院医療）の面 /jiritsu/ を作る（2026-09-26 ユーザー裁定「療養はフクシル増床として実装」）。
//   node scripts/jiritsu-build.mjs        → jiritsu/index.html・jiritsu/ken/<コード>/index.html と sitemap.xml の行
//   node scripts/jiritsu-build.mjs --dry  → 書かずに数だけ
//
// ★この面で言っていること
//   ① 月の上限（所得区分ごと）＝全国共通。額と区分は data/jiritsu.json だけが持つ（出典＝こども家庭庁・厚労省の審議会資料）。
//   ② 1割で受けられるのは、受給者証に書いた指定医療機関（病院・診療所・薬局・訪問看護）だけ。変えるときは届け出る。
//   ③ 指定医療機関の一覧は都道府県・指定都市ごと。公式の一覧への入口を67機関ぶん並べる（リンクはどこでも可）。
//   ④ 一覧そのもの（名称・所在地・電話）を全機関ぶん載せる（HOST_POLICY＝facts・2026-09-26 ユーザー裁定「事実ベースなので著作権はない。公開してくれ」）。
//      規約で再利用を明記している機関は、その利用条件（CC BY・PDL など）を書く。それ以外は「事実を並べ直したもの」と書く。
//      毎月の版の積み重ねは非公開の jiritsu-ledger に残す（前の版から外れた機関の履歴は、あとから誰も作れない）。
//
// ★言ってはいけないこと
//   ・「外れた」を「取消」「廃止」と断定しない（辞退・移転・名称変更・一覧の書き方の変更もある）。判定のラベルは付けない。
//   ・上限額を自分で丸めない・独自の割引（都道府県が上乗せしている場合）を全国の表に混ぜない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'jiritsu.json'), 'utf8'))
const AUTH_PATH = path.resolve(ROOT, '..', 'jiritsu-ledger', 'authorities.json')   // 調査のメモ（規約の判定）ごと非公開の台帳に置く
// ★版はフクシルの中に置かない（リポジトリの根ごと GitHub Pages に出るので data/ も公開される）。
//   非公開のリポジトリ sato12307/jiritsu-ledger（手元では ../jiritsu-ledger）に置く。毎月の取得は .github/workflows/jiritsu-monthly.yml。
const VER_DIR = path.resolve(ROOT, '..', 'jiritsu-ledger', 'versions')
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }

// ★一覧を載せてよい機関の決め方（1か所）。'explicit' ＝サイトの規約が再利用を明記している機関だけ。
//   'facts' ＝名称・所在地・電話番号という事実として全機関を載せる（2026-09-26 ユーザー裁定で facts）。
const HOST_POLICY = 'facts'
const hosted = (a) => (HOST_POLICY === 'facts' ? true : a.reuse === 'ok')

if (!fs.existsSync(AUTH_PATH)) die('../jiritsu-ledger/authorities.json がありません（調査結果をまとめてから・git -C ../jiritsu-ledger pull）')
const A = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'))
if (A.length !== 67) die(`機関の数が67ではありません（${A.length}）`)

// ★手元の jiritsu-ledger が古いまま build すると、毎月の取得（GitHub Actions）が載せた新しい版を古い版で上書きしてしまう。
//   入口のページに「版のいちばん新しい取得日・確認日」を書いておき、手元の版がそれより古ければ書き出す前に止める。
const IDX = path.join(ROOT, 'jiritsu', 'index.html')
const ON_SITE = fs.existsSync(IDX) ? (fs.readFileSync(IDX, 'utf8').match(/<!-- jiritsu-ledger: (\d{4}-\d{2}-\d{2}) -->/) || [])[1] || '' : ''
let ledgerMax = ''
const yen = (n) => `${n.toLocaleString('ja-JP')}円`

// 一覧の時点の書き方は機関ごとにばらばら（「令和８年（2026年）９月１日現在」「R8.8.1現在（ファイル内表題）」「９月１日時点（2026年）」
// 「2026年9月1日付け」）。画面では「令和8年9月1日現在」の形にそろえる。読めないものはそのまま出す。
const asOfTxt = (s) => {
  const t = String(s || '').normalize('NFKC').replace(/\s+/g, '')
  const hits = []
  for (const m of t.matchAll(/令和(\d+|元)(?:\(\d{4}年?\))?年(?:\(\d{4}年?\))?(\d{1,2})月(?:(\d{1,2})日)?/g)) hits.push([m.index, m[0].length, m[1] === '元' ? 1 : +m[1], +m[2], m[3] && +m[3]])
  for (const m of t.matchAll(/R(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?/g)) hits.push([m.index, m[0].length, +m[1], +m[2], m[3] && +m[3]])
  for (const m of t.matchAll(/(20\d\d)(?:年|-)(\d{1,2})(?:月|-)(?:(\d{1,2})日?)?/g)) hits.push([m.index, m[0].length, +m[1] - 2018, +m[2], m[3] && +m[3]])
  if (!hits.length) {
    const md = t.match(/(\d{1,2})月(\d{1,2})日/), y = t.match(/(20\d\d)年/)
    if (md && y) hits.push([md.index, md[0].length, +y[1] - 2018, +md[1], +md[2]])
  }
  if (!hits.length) return t
  const [i, len, ry, mo, d] = hits.sort((a, b) => a[0] - b[0])[0]
  const suf = (t.slice(i + len).match(/^(現在|時点|付け?|指定|更新|取得)/) || [])[1] || ''
  return `令和${ry}年${mo}月${d ? `${d}日` : ''}${suf.replace('付け', '付')}`
}

// 版（取得した一覧を正規化したもの）を読む。versions/<code>/<YYYY-MM-DD>.json＝{ asOf, fetched, rows:[{kind,name,zip,addr,tel}] }
const versionsOf = (code) => {
  const dir = path.join(VER_DIR, code)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json(\.gz)?$/.test(f)).sort().map((f) => {
    const buf = fs.readFileSync(path.join(dir, f))
    const v = JSON.parse((f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'))
    v.asOf = asOfTxt(v.asOf)
    v.asOfByKind = Object.fromEntries(Object.entries(v.asOfByKind || {}).map(([k, x]) => [k, asOfTxt(x)]))
    return v
  })
}
const KIND_ORDER = ['病院・診療所', '薬局', '訪問看護']
const keyOf = (r) => `${r.kind}|${r.name.replace(/\s+/g, '')}|${(r.addr || '').replace(/\s+/g, '').slice(0, 12)}`

// ── 全国の表 ────────────────────────────────────────────────────────────────
// ★金額だけのセルに num（折り返さない）を付ける。長い文のセルに付けると、その列が広がって説明の列が1文字幅に潰れる。
const cellLimit = (t) => (t.limit === null ? '<td>医療費の1割か、高額療養費の自己負担限度額</td>' : typeof t.limit === 'number' ? `<td class="num"><strong>${yen(t.limit)}</strong></td>` : `<td>${esc(t.limit)}</td>`)
const tierTable = `<div class="table-wrap"><table>
<caption>自立支援医療（精神通院医療）の自己負担の上限（月額・全国共通）</caption>
<thead><tr><th scope="col">所得区分（どんな世帯か）</th><th scope="col">上限（月）</th><th scope="col">「重度かつ継続」の人</th></tr></thead>
<tbody>${D.tiers.map((t) => `<tr><td><strong>${esc(t.label)}</strong><br><small>${esc(t.def)}</small></td>${cellLimit(t)}<td class="num"><strong>${yen(t.heavy)}</strong>${t.heavyNote ? `<br><small>${esc(t.heavyNote)}</small>` : ''}</td></tr>`).join('\n')}</tbody></table></div>
<ul class="mini-note">${D.tierNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`

const srcList = (extra = []) => `<ul class="sources">${[...D.sources, ...extra].map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>`
const fmtLabel = { xlsx: 'Excel', xls: 'Excel', csv: 'CSV', 'pdf-text': 'PDF', 'pdf-image': 'PDF（画像）', html: 'ページ内の表' }

// ── 機関ごとのページ（一覧を載せる機関だけ）───────────────────────────────────────
const pages = []   // [relPath, loc, html, priority]
const hostedList = []
for (const a of A) {
  if (!hosted(a)) continue
  const vs = versionsOf(a.code)
  if (!vs.length) { console.warn(`載せる機関なのに版がありません（先に取得と読み取り）: ${a.authority}`); continue }
  const cur = vs[vs.length - 1], prev = vs.length > 1 ? vs[vs.length - 2] : null
  for (const d of [cur.fetched, cur.checked]) if (d && d > ledgerMax) ledgerMax = d
  const byKind = Object.fromEntries(KIND_ORDER.map((k) => [k, cur.rows.filter((r) => r.kind === k)]))
  let diffHtml = `<p>前の版と比べられるのは、次の版を取得してからです（この機関の最初の版は ${esc(cur.asOf)}）。一覧は毎月取り直して、載らなくなった機関と新しく載った機関をここに並べます。</p>`
  if (prev) {
    const pk = new Map(prev.rows.map((r) => [keyOf(r), r])), ck = new Map(cur.rows.map((r) => [keyOf(r), r]))
    const gone = [...pk.entries()].filter(([k]) => !ck.has(k)).map(([, r]) => r)
    const added = [...ck.entries()].filter(([k]) => !pk.has(k)).map(([, r]) => r)
    const li = (r) => `<li>${esc(r.name)}（${esc(r.kind)}・${esc(r.addr || '')}）</li>`
    diffHtml = `<p>${esc(prev.asOf)}の版と ${esc(cur.asOf)}の版を比べた結果です。<strong>載らなくなった理由（辞退・移転・名称の変更・一覧の書き方の変更など）はこの一覧からは分かりません。</strong>通院先が載っていないときは、医療機関か${esc(a.authority)}の担当課に確かめてください。</p>
<h3>前の版にあって、いまの版に載っていない（${gone.length}件）</h3>${gone.length ? `<ul>${gone.map(li).join('')}</ul>` : '<p>ありません。</p>'}
<h3>いまの版で新しく載った（${added.length}件）</h3>${added.length ? `<ul>${added.map(li).join('')}</ul>` : '<p>ありません。</p>'}`
  }
  // 電話・指定日の列は、その機関の一覧に入っているときだけ出す（和歌山県は電話が無く、指定日がある）
  const hasTel = cur.rows.some((r) => r.tel), hasSince = cur.rows.some((r) => r.since)
  const listTable = (k) => `<div class="table-wrap"><table class="jiritsu-list" data-kind="${esc(k)}"><thead><tr><th scope="col">名称</th><th scope="col">所在地</th>${hasTel ? '<th scope="col">電話</th>' : ''}${hasSince ? '<th scope="col">指定日</th>' : ''}</tr></thead>
<tbody>${byKind[k].map((r) => `<tr><td>${esc(r.name)}</td><td>${esc([r.zip ? `〒${r.zip}` : '', r.addr].filter(Boolean).join(' '))}</td>${hasTel ? `<td class="num">${esc(r.tel || '')}</td>` : ''}${hasSince ? `<td class="num">${esc(r.since || '')}</td>` : ''}</tr>`).join('\n')}</tbody></table></div>`
  const total = cur.rows.length
  const asOfOf = (k) => (cur.asOfByKind && cur.asOfByKind[k]) || cur.asOf   // 種類ごとに時点が違う一覧（岡山県）
  // 利用条件（CC BY・PDL など）と、このサイトで形を変えたこと（CC BY・PDL は編集・加工を書く決まり）。
  // 再利用の明記が無い機関は、利用条件を名乗らず「事実を並べ直したもの」と書く（元の表の体裁・説明文は使っていない）。
  const lic = a.reuse === 'ok' ? (a.license || { name: `${a.authority}のサイトの利用規約`, url: a.termsUrl }) : null
  const credit = `<ul class="sources"><li>出典：<a href="${esc(a.pageUrl)}" rel="noopener">${esc(a.authority)}「${esc(a.pageTitle || '指定自立支援医療機関（精神通院医療）の一覧')}」</a>（${esc(cur.asOf)}）</li>
${lic ? `<li>利用条件：<a href="${esc(lic.url || '')}" rel="noopener">${esc(lic.name)}</a></li>
<li>このサイトで編集・加工しています（種類ごとに分けて並べ、郵便番号・電話番号の書き方をそろえました）。正しい内容は出典の一覧で確かめてください。</li>` : `<li>医療機関の名称・所在地・電話番号という事実を、種類ごとに分けて並べ直したものです（郵便番号・電話番号の書き方をそろえました。元の表の体裁や説明文は使っていません）。正しい内容は出典の一覧で確かめてください。</li>`}</ul>`
  const search = `<p><label>名前や住所で絞り込む：<input type="search" id="jq" placeholder="例：〇〇クリニック・〇〇市" style="width:100%;max-width:420px"></label></p>`
  const filterJs = `<script>(function(){var q=document.getElementById('jq');if(!q)return;q.addEventListener('input',function(){var v=q.value.trim();document.querySelectorAll('table.jiritsu-list tbody tr').forEach(function(tr){tr.style.display=!v||tr.textContent.indexOf(v)>=0?'':'none'})})})();</script>`
  const SUB = { '薬局': 'yakkyoku', '訪問看護': 'houmon' }
  const kindLinks = (here) => `<ul>${KIND_ORDER.filter((k) => byKind[k].length).map((k) => {
    const href = k === '病院・診療所' ? (here === k ? null : '../') : (here === k ? null : here === '病院・診療所' ? `${SUB[k]}/` : `../${SUB[k]}/`)
    return `<li>${href ? `<a href="${href}">${esc(k)}（${byKind[k].length}件）</a>` : `<strong>${esc(k)}（${byKind[k].length}件）</strong>`}</li>`
  }).join('')}</ul>`
  // 1枚目＝病院・診療所（変わったところと月の上限も）
  const title = `${a.authority}の自立支援医療（精神通院）指定医療機関の一覧（${cur.asOf}）｜病院・診療所`
  const desc = `${a.authority}で自立支援医療（精神通院医療）を1割で受けられる指定医療機関（病院・診療所${byKind['病院・診療所'].length}・薬局${byKind['薬局'].length}・訪問看護${byKind['訪問看護'].length}）。${cur.asOf}の版と、前の版から載らなくなった機関。月の上限は所得区分ごとに0〜2万円。`
  const body = `<p class="breadcrumb"><a href="../../../index.html">トップ</a> › <a href="../../index.html">自立支援医療（精神通院）</a> › ${esc(a.authority)}</p>
<h1>${esc(a.authority)}の自立支援医療（精神通院）指定医療機関</h1>
<p class="lead">${esc(a.authority)}が公表している一覧（${esc(cur.asOf)}）を、名前で探しやすい形にしたものです。全${total}件。受給者証に書いた医療機関でだけ1割（月の上限あり）になります。</p>
${kindLinks('病院・診療所')}
<h2>前の版から変わったところ</h2>
${diffHtml}
<h2>病院・診療所（${byKind['病院・診療所'].length}件・${esc(asOfOf('病院・診療所'))}）</h2>
${search}
${listTable('病院・診療所')}
<h2>月の上限（全国共通）</h2>
${tierTable}
<h2>出典と利用条件</h2>
${credit}
${srcList()}
${filterJs}`
  pages.push([`jiritsu/ken/${a.code}/index.html`, `/jiritsu/ken/${a.code}/`, page({ title, desc, canonical: `/jiritsu/ken/${a.code}/`, depth: 3, body }), '0.6'])
  // 2枚目・3枚目＝薬局・訪問看護
  for (const k of ['薬局', '訪問看護']) {
    if (!byKind[k].length) continue
    const t2 = `${a.authority}の自立支援医療（精神通院）指定${k === '薬局' ? '薬局' : '訪問看護事業所'}の一覧（${asOfOf(k)}）`
    const d2 = `${a.authority}で自立支援医療（精神通院医療）の受給者証に書ける${k}（${byKind[k].length}件・${asOfOf(k)}）。薬局や訪問看護を変えるときは、受給者証の変更の届け出が要ります。`
    const b2 = `<p class="breadcrumb"><a href="../../../../index.html">トップ</a> › <a href="../../../index.html">自立支援医療（精神通院）</a> › <a href="../">${esc(a.authority)}</a> › ${esc(k)}</p>
<h1>${esc(a.authority)}の自立支援医療（精神通院）指定${k === '薬局' ? '薬局' : '訪問看護'}</h1>
<p class="lead">受給者証に書いた${k === '薬局' ? '薬局' : '訪問看護事業所'}でだけ1割（月の上限あり）になります。${k === '薬局' ? '薬局' : '訪問看護'}を変えるときは、市区町村の窓口で受給者証の変更の届け出をします。全${byKind[k].length}件（${esc(asOfOf(k))}）。</p>
${kindLinks(k)}
${search}
${listTable(k)}
<h2>出典と利用条件</h2>
${credit}
${filterJs}`
    pages.push([`jiritsu/ken/${a.code}/${SUB[k]}/index.html`, `/jiritsu/ken/${a.code}/${SUB[k]}/`, page({ title: t2, desc: d2, canonical: `/jiritsu/ken/${a.code}/${SUB[k]}/`, depth: 4, body: b2 }), '0.5'])
  }
  hostedList.push({ a, cur, total })
}

// ── 入口 /jiritsu/ ────────────────────────────────────────────────────────────
const rowOf = (a) => {
  const h = hostedList.find((x) => x.a.code === a.code)
  const files = (a.files || []).map((f) => fmtLabel[f.format] || f.format).filter((v, i, arr) => arr.indexOf(v) === i).join('・')
  const asOf = h ? h.cur.asOf : asOfTxt(((a.files || [])[0] || {}).asOf)
  return `<tr><th scope="row">${esc(a.authority)}</th><td>${a.pageUrl ? `<a href="${esc(a.pageUrl)}" rel="noopener">公式の一覧</a>` : '見つかっていません'}${files ? `<br><small>${esc(files)}</small>` : ''}</td><td>${esc(asOf)}</td><td>${h ? `<a href="ken/${a.code}/">このサイトで探す（${h.total}件）</a>` : '<small>公式の一覧へ</small>'}</td></tr>`
}
const prefs = A.filter((a) => a.type === 'pref'), cities = A.filter((a) => a.type === 'city')
const title = '自立支援医療（精神通院）の自己負担の上限と、使える病院・薬局（指定医療機関）の一覧｜都道府県・指定都市別'
const desc = `自立支援医療（精神通院医療）は、受給者証に書いた指定医療機関で医療費が1割・月の上限は所得区分ごとに0円〜2万円（生活保護0円・低所得1 ${yen(2500)}・低所得2 ${yen(5000)}）。47都道府県と20の指定都市の指定医療機関の一覧への入口。`
const body = `<p class="breadcrumb"><a href="../index.html">トップ</a> › 自立支援医療（精神通院）</p>
<h1>自立支援医療（精神通院）の上限と、使える病院・薬局</h1>
<p class="lead">精神科に通院している人の医療費は、自立支援医療（精神通院医療）の受給者証があれば<strong>1割</strong>になり、<strong>月の上限</strong>も付きます。ただし1割になるのは、<strong>受給者証に書いた指定医療機関</strong>（病院・診療所・薬局・訪問看護）だけです。</p>
<h2>月の上限（所得区分ごと・全国共通）</h2>
${tierTable}
<p>世帯が住民税非課税かどうかは、<a href="../hikazei/">市区町村ごとの住民税非課税の年収の目安</a>で確かめられます（非課税なら「低所得1」か「低所得2」）。医療費が高い月は<a href="../articles/kougaku-ryouyouhi-2026.html">高額療養費の上限</a>も見てください。</p>
<h2>「重度かつ継続」に当たる人</h2>
<ul>${D.heavy.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
<h2>使える病院・薬局を変えるとき</h2>
<p>転院・引っ越し・薬局を変えるときは、受給者証に書く医療機関を変える届け出が要ります（市区町村の窓口）。受給者証の有効期間は1年で、毎年更新します。通院先が指定医療機関かどうかは、下の都道府県・指定都市の一覧で確かめてください。</p>
<h2>都道府県ごとの指定医療機関の一覧（${prefs.length}）</h2>
<p class="mini-note">指定都市（札幌市・仙台市・さいたま市・千葉市・横浜市・川崎市・相模原市・新潟市・静岡市・浜松市・名古屋市・京都市・大阪市・堺市・神戸市・岡山市・広島市・北九州市・福岡市・熊本市）にある医療機関は、市の一覧に載っていることがあります。</p>
<div class="table-wrap"><table><thead><tr><th scope="col">都道府県</th><th scope="col">公式の一覧</th><th scope="col">時点</th><th scope="col">このサイト</th></tr></thead>
<tbody>${prefs.map(rowOf).join('\n')}</tbody></table></div>
<h2>指定都市の一覧（${cities.length}）</h2>
<div class="table-wrap"><table><thead><tr><th scope="col">市</th><th scope="col">公式の一覧</th><th scope="col">時点</th><th scope="col">このサイト</th></tr></thead>
<tbody>${cities.map(rowOf).join('\n')}</tbody></table></div>
<p class="mini-note">一覧は都道府県・指定都市が毎月〜数か月ごとに改めています。このサイトでは毎月、各機関の公式の一覧を取り直して、前の版から載らなくなった医療機関・新しく載った医療機関を並べています。</p>
<h2>出典</h2>
${srcList()}
<!-- jiritsu-ledger: ${ledgerMax} -->`
pages.push(['jiritsu/index.html', '/jiritsu/', page({ title, desc, canonical: '/jiritsu/', depth: 1, body, jsonld: [{ '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/jiritsu/`, dateModified: D.checked }] }), '0.8'])

if (DRY) { console.log(`ページ ${pages.length}（入口1・一覧を載せる機関 ${hostedList.length}）／ 機関 ${A.length}（うち規約で再利用が明記 ${A.filter((a) => a.reuse === 'ok').length}）／ 版の最新 ${ledgerMax}（公開中 ${ON_SITE || 'なし'}）`); process.exit(0) }
if (ON_SITE && ON_SITE > ledgerMax) die(`手元の jiritsu-ledger（${ledgerMax}）が公開中の版（${ON_SITE}）より古い。git -C ../jiritsu-ledger pull してから`)

// ── 書き出しと sitemap（lastmod は中身が変わった日だけ進める）──────────────────────────
const changed = new Set()
for (const [rel, loc, html] of pages) {
  const f = path.join(ROOT, rel)
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === html) continue
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); changed.add(loc)
}
const smPath = path.join(ROOT, 'sitemap.xml')
const sm = fs.readFileSync(smPath, 'utf8')
const prevMod = new Map([...sm.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]))
const ours = new Map(pages.map(([, loc, , pri]) => { const full = `${SITE}${loc}`; const lm = changed.has(loc) || !prevMod.has(full) ? TODAY : prevMod.get(full); return [full, `<url><loc>${full}</loc><lastmod>${lm}</lastmod><changefreq>monthly</changefreq><priority>${pri}</priority></url>`] }))
let smNext = sm.replace(/[ \t]*<url><loc>([^<]+)<\/loc>[\s\S]*?<\/url>\n?/g, (whole, loc) => { if (!ours.has(loc)) return whole; const e = ours.get(loc); ours.delete(loc); return `  ${e}\n` })
if (ours.size) smNext = smNext.replace('</urlset>', `${[...ours.values()].map((e) => `  ${e}`).join('\n')}\n</urlset>`)
if (smNext !== sm) fs.writeFileSync(smPath, smNext)
console.log(`書き出し ${changed.size}枚（入口1・一覧 ${hostedList.length}機関）／ sitemap ${smNext !== sm ? '更新' : '変更なし'}`)
