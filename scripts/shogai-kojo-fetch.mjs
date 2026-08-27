// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-fetch.mjs — 「障害者控除対象者認定」の自治体別の認定基準を集める。
//
// ★何を集めるのか
//   65歳以上で要介護認定を受けている人は、障害者手帳が無くても、市区町村長の認定を
//   受ければ所得税・住民税の障害者控除を使える（所得税27万/特別障害者40万、
//   同居していれば75万）。ところが**その認定基準は市区町村ごとにバラバラ**で、
//   同じ状態の人が、住んでいる街によって対象になったりならなかったりする。
//   税額で数万円動くのに、比較できる形でまとまった場所がどこにも無い。
//
// ★2段構えで集める理由（ここが一番大事）
//   (1) 索引 = 同志社大学『条例Webアーカイブデータベース』(jorei.slis.doshisha.ac.jp)
//       全国の例規を集めた公開DB。Solr の API が認証なしで叩ける。
//       本文（content）まで検索すると最新断面で約1,280件・1,000自治体超が見つかる。
//       （名称だけで探すと607件・602自治体。半分を取り落とす。下の QUERY の注を読むこと）
//       ★ただし利用規約に「全部または一部を改変して再公開しないこと」とある。
//       ∴ **このDBの中身は公開しない。どの自治体にどの例規があるかを知るためだけに使う。**
//   (2) 中身 = 各レコードが持つ original_url（自治体自身の例規集）から取る。
//       条例・規則は著作権法13条で権利の目的とならない＝自治体の公表物として扱える。
//       実測（2026-08-27・22件の標本）で 22/22 が生存、20/22 から基準を抽出できた。
//
// ★robots は確認済み（2026-08-27）
//   g-reiki.net / d1-law.com / h-chosonkai.gr.jp は robots.txt 無し。
//   joureikun.jp 系3ホストは robots.txt があるが、Disallow は /act/hist/ /act/print/ など
//   別系統のパスで、ここで取る /reiki/act/*.html は**1件も該当しない**（10件を実照合）。
//
// ★大都市はこの索引に載らない
//   例規を制定しているのは全1,741自治体のうち約3割で、しかも町306・市234・村58に対し
//   **政令指定都市は3・特別区は6しかない**。大都市は例規を作らず、ふつうのWebページに
//   基準を書いている（大田区・浦安市・横浜市・京都市などで実際に確認）。
//   ∴ 大都市ぶんは別レーン（shogai-kojo-cities.mjs）で取る。ここでは扱わない。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'shogai-kojo')
const OUT = path.join(ROOT, 'data', 'shogai-kojo')
const API = 'https://jorei.slis.doshisha.ac.jp/api/reiki/select'
const UA = 'Mozilla/5.0 (compatible; fukushiru-bot/1.0; +https://fukushiru.com/about.html)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(CACHE, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

// ── ① 索引を引く（公開しない・原典URLを知るためだけ）────────────────────────
const solr = async (params) => {
  const u = `${API}?${new URLSearchParams({ wt: 'json', ...params })}`
  const r = await fetch(u, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`索引が引けません: HTTP ${r.status}`)
  return r.json()
}

const FL = 'municipality_id,prefecture,city,municipality_type,area,title,type,announcement_date,last_updated_date,original_url,reiki_url,collection'
// ★2026-08-27 タイトル検索から本文検索へ切り替えた。
//   先行研究（地方公共団体金融機構）は「障害者控除」を**名称に含む**例規だけを数えて
//   559件・全国の32%としていた。しかし実際には、**基準を書いているのにタイトルには
//   出てこない例規が同じくらいある**（高齢者福祉事務取扱要綱の中の一節、など）。
//   実測: title検索 607件 → 本文検索 1,280件で**倍以上**。
//   なお `content:障害者控除` まで広げると 3,289件になるが、税条例が「障害者控除」に
//   言及しているだけのものが大量に混ざる。**「障害者控除対象者認定」の語順で絞る**のが境目。
const QUERY = 'content:"障害者控除対象者認定" OR content:"障がい者控除対象者認定" OR title:障害者控除 OR title:障がい者控除'
const j = await solr({ q: QUERY, fq: 'collection:latest', rows: '3000', fl: FL })
const docs = j?.response?.docs || []
const found = j?.response?.numFound ?? 0
// 索引が空で返るのは向こうのメンテ中（実際に年2回止まる）。その日に空の成果物を
// 書くと、集めた基準がまるごと消えたように見える。[[empty-crawl-site-collapse]]
if (docs.length < 700) {
  console.error(`! 索引が ${docs.length}件しか返りません（numFound=${found}）。通常は1,300件前後です。`)
  console.error('  向こうのメンテ中の可能性が高いので、何も書かずに終了します。')
  process.exit(1)
}
console.log(`索引: ${docs.length}件 / ${new Set(docs.map((d) => d.municipality_id)).size}自治体`)

// ── ② 原典を取る（キャッシュ優先・1件ずつ間を空ける）────────────────────────
// ★本文検索にしたので、1つの自治体に複数の例規が当たる（専用の要綱＋税条例など）。
//   タイトルに「障害者控除」を含むもの＝専用の要綱を先に取る。本命から順に埋まるので、
//   途中で止めても使える状態になる。
const targets = docs.filter((d) => /^https?:\/\//.test(d.original_url || ''))
  .sort((a, b) => (/障害者控除|障がい者控除/.test(b.title) ? 1 : 0) - (/障害者控除|障がい者控除/.test(a.title) ? 1 : 0))
console.log(`原典URLがあるもの: ${targets.length}件（残り ${docs.length - targets.length}件は索引側にURLが無く、取りに行けない）`)

const key = (d) => `${d.municipality_id}-${d.original_url.replace(/\W+/g, '').slice(-40)}.html`
let hit = 0, got = 0, ng = 0
const rows = []
for (const d of targets) {
  const p = path.join(CACHE, key(d))
  let html = null
  if (fs.existsSync(p)) { html = fs.readFileSync(p, 'utf8'); hit++ }
  else {
    try {
      const r = await fetch(d.original_url, { headers: { 'user-agent': UA }, redirect: 'follow' })
      if (r.ok) {
        // 例規集は Shift_JIS / EUC-JP がまだ現役。charset を見てから復号する。
        const buf = Buffer.from(await r.arrayBuffer())
        const head = buf.subarray(0, 2048).toString('latin1')
        const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head)
        const enc = (m ? m[1] : 'utf-8').toLowerCase()
        const label = /shift.?jis|windows-31j|ms932|sjis/.test(enc) ? 'shift_jis'
          : /euc/.test(enc) ? 'euc-jp' : 'utf-8'
        html = new TextDecoder(label, { fatal: false }).decode(buf)
        fs.writeFileSync(p, html)
        got++
      } else ng++
    } catch { ng++ }
    await sleep(1100)   // 相手は自治体の共用サーバ。1秒以上あける。
  }
  if (html) rows.push({ ...d, _cache: path.basename(p), _bytes: html.length })
}
console.log(`取得: 新規 ${got} / キャッシュ ${hit} / 失敗 ${ng}`)

fs.writeFileSync(path.join(OUT, 'sources.json'), JSON.stringify({
  fetchedAt: new Date().toISOString(),
  note: '索引は条例Webアーカイブデータベース（同志社大）。規約により索引そのものは公開しない。公開するのは各自治体の原典から読み取った基準のみ。',
  count: rows.length,
  rows,
}, null, 1))
console.log(`→ ${path.join(OUT, 'sources.json')}`)
