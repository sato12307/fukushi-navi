// ─────────────────────────────────────────────────────────────────────────────
// koei-watch.mjs — 「過去回が消える市」の公表資料を、出た瞬間に拾って永久に残す。
//
//   node scripts/koei-watch.mjs           # 見に行って、新しいものだけ .cache に足す
//   node scripts/koei-watch.mjs --dry     # 落とさずに、何が見えているかだけ出す
//
// ★なぜ要るか（2026-09-17・実測）
//   政令市の0円検証（data/koei-sources.json）で「過去回が消える」と判定した市を
//   実際に取りに行ったら、**3市のうち2市はもう手遅れだった**。
//     ・熊本市 … 令和7年1月のサイト刷新で、結果ページもPDF本体も消えていた（302→404）。
//                いま公開されている回は**ゼロ**（令和8年9月の回は中止）。
//     ・名古屋市 … 第2回の募集が始まった時点で、第1回のページが404。
//     ・堺市 … かろうじて2回ぶん（令和7年11月・令和8年5月）が残っていて確保できた。
//     ・京都市 … C判定から格上げ。粒度は十分だが、過去5回はすべて404で最新1回だけ生きていた。
//   ∴ 過去は取り返せない。**これから出るものを落とさない**ことだけが残った仕事。
//
// ★この器の約束
//   1. 落としたものは消さない。市が消しても手元には残る（.cache/<市>/ に貯める）。
//   2. 同じ中身を二度保存しない（sha1で見る）。回の名前が分からなくても保存はする。
//   3. 見に行く先が404や構造変更で空振りしたら**黙って成功にしない**。台帳に残して終了コード1。
//      「今日は何も無かった」と「見に行けなかった」は別物。
//   4. 相手のサーバに1秒以上の間隔を空け、User-Agent に連絡先を書く。
//
// ★見つけたPDFは名前で選り分けない（市ごとに命名が違うし、変わる）。
//   ページに載っているPDFを全部取り、中身に「倍率」か「応募」か「抽選結果」が
//   入っているものだけ残す。要らないものはその場で捨てる。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'fukushiru-crawler/1.0 (+https://fukushiru.com/about.html; contact@fukushiru.com)'
const DRY = process.argv.includes('--dry')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 見に行く先。★消える市だけを入れる。残っている市（川崎・静岡・横浜）は
//   それぞれの *-fetch.mjs が過去回ごと取れるので、ここでは見ない。
const WATCH = [
  {
    city: '堺市', slug: 'sakai',
    pages: ['https://www.city.sakai.lg.jp/kurashi/jutaku/jutaku/chintai/shiei/Bosyu.html'],
    note: '募集ページに直近2回ぶんだけ「結果はこちらへ」のPDFが載る。回が変わると古いほうが消える',
  },
  {
    city: '名古屋市', slug: 'nagoya',
    pages: [
      'https://www.city.nagoya.jp/kurashi/juutaku/1014583/1014585/1014586/1014587/index.html',
      'https://www.jkk-nagoya.or.jp/siei/',
      'https://www.jkk-nagoya.or.jp/siei/bosyuu.html',
    ],
    follow: /応募状況|抽選結果|倍率|募集/,
    note: '募集案内に「前回募集団地の応募倍率一覧表」が載る。次の回が始まると前の回のページが404になる',
  },
  {
    city: '熊本市', slug: 'kumamoto',
    pages: [
      'https://www.city.kumamoto.jp/list00637.html',
      'https://www.city-kumamoto-jutaku.jp/se/news/',
      'https://www.city-kumamoto-jyutaku.jp/shiei-information/',
    ],
    follow: /申込受付結果|抽選結果|定期募集|倍率/,
    note: '定期募集は5月・9月・1月ごろ。令和7年1月のサイト刷新で過去の結果は消えた。次の回から拾う',
  },
  {
    city: '京都市', slug: 'kyoto',
    // ★C判定から格上げ（2026-09-17）。粒度は川崎・静岡と同等（住宅名称・募集戸数・
    //   抽選対象者数・抽選倍率）だが、**回ごとのページが消える**。実測で過去5回はすべて404、
    //   生きていたのは最新1回だけだった。∴ 出た回をその場で拾うしかない。
    // ★倍率が載るのは houdou.pdf（報道発表資料）。kekka.pdf は抽選番号表なので中身が違う。
    //   どちらも落として、選り分けは koei-triage.py に任せる。
    pages: [
      'https://www.city.kyoto.lg.jp/menu1/category/12-7-0-0-0-0-0-0-0-0.html',
      'https://www.city.kyoto.lg.jp/tokei/page/0000356570.html',
    ],
    note: '公開抽選結果が回ごとの報道発表ページに出る。年3〜4回。過去回は消える（実測で5回とも404）',
  },
  {
    city: '大阪市', slug: 'osaka',
    // ★入口は回ごとに別ページになる（0000658723 は令和7年度第1次）。
    //   ∴ 回ごとのページを直に見ずに、募集の親ページと公社の窓口を見て、
    //   そこから張られたPDFを拾う。初回に指定した 0000005271 は既に404だった。
    pages: [
      // ★回ごとのページ（0000658723 など）は入れない。回が変われば404になり、
      //   **恒久的な誤警報**になって「見に行けなかった」という本物の合図が埋もれる。
      //   入口には「回が変わっても残るページ」だけを置くこと。
      'https://www.city.osaka.lg.jp/toshiseibi/page/0000444314.html',
      'https://www.osaka-jk.or.jp/shiei/',
      'https://www.osaka-jk.or.jp/shiei_iframe',
    ],
    // ★公社の一覧は、市の回別ページ（応募状況・抽選結果）へのリンクを持っている。
    //   回が終わると市側が404にするが、一覧のリンクは残る。∴ 一覧をたどれば、
    //   **生きている回はその場で拾える**。実測で応募状況表は383KBのPDFで公表されている。
    follow: /応募状況|抽選結果|倍率/,
    note: '応募状況表は回ごとの別ページに出る（市側は回が終わると404にする）。公社の一覧から1段たどって拾う',
  },
]

// ★1階層だけリンクをたどる（follow を書いた市だけ）。
//   大阪・熊本・名古屋は「一覧ページ → 回ごとのページ → PDF」という作りで、
//   一覧に載っているのはHTMLのリンクだけ。PDFは回ごとのページの中にある。
//   ∴ 一覧のリンク文字に follow が当たるものだけ、1段だけ開いてPDFを探す。
//   ★2段はたどらない。市のサイト全体を歩き回ることになり、相手に迷惑で、
//     関係ないPDFを大量に拾う。1段で足りることは実測で確かめてある。
const FOLLOW_MAX = 12        // 1つの入口からたどる回別ページの上限

const get = async (url, bin = false) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : await r.text()
}

// ★ここでは中身で選り分けない。PDFの日本語は圧縮されていて、生のバイトからは読めない。
//   選り分けは python scripts/koei-triage.py（PyMuPDFで開いて語を見る）が後からやる。
//   ★消えるデータが相手なので、迷ったら残す側に倒す。会社案内が1本混ざる無駄より、
//     倍率表を1本落とすほうがずっと高くつく（取り返せない）。同じ中身は sha1 で1本しか持たない。
const isPdf = (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-'

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)

const report = { checkedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), cities: [] }
let saved = 0
const broken = []

for (const w of WATCH) {
  const dir = path.join(ROOT, '.cache', w.slug)
  fs.mkdirSync(dir, { recursive: true })
  const seenPath = path.join(dir, '_seen.json')
  const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : {}
  const found = []
  let reachable = 0
  // 入口＋（follow があれば）そこから1段たどった回別ページ
  const targets = [...w.pages]
  if (w.follow) {
    for (const page of w.pages) {
      await sleep(1200)
      let html
      try { html = await get(page) } catch { continue }
      const baseTag = /<base[^>]+href="([^"]+)"/i.exec(html)
      const base = baseTag ? new URL(baseTag[1], page).href : page
      let n = 0
      for (const m of html.matchAll(/<a[^>]+href="([^"]+\.html?)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '')
        if (!w.follow.test(text)) continue
        let u
        try { u = new URL(m[1], base).href } catch { continue }
        if (targets.includes(u)) continue
        targets.push(u)
        if (++n >= FOLLOW_MAX) break
      }
    }
  }

  for (const page of targets) {
    await sleep(1200)
    let html
    try { html = await get(page) } catch (e) {
      // ★たどった先の404は異常ではない（回が終われば市が消すため）。入口の404だけを異常とする。
      if (w.pages.includes(page)) broken.push(`${w.city} ${page}: ${e.message}`)
      continue
    }
    if (w.pages.includes(page)) reachable++
    // ★<base href> があればそれを基準にする。見ないと相対パスの解決先を間違える。
    //   実測：京都市のページは /tokei/page/xxx.html にあるが <base href=".../tokei/"> が
    //   置いてあり、href="./cmsfiles/..." の正解は /tokei/cmsfiles/... のほう。
    //   基準を間違えると404になり、**リンクは見えているのに1本も落とせない**（実際にそうなった）。
    const baseTag = /<base[^>]+href="([^"]+)"/i.exec(html)
    const base = baseTag ? new URL(baseTag[1], page).href : page
    const pdfs = [...new Set([...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => {
      try { return new URL(m[1], base).href } catch { return null }
    }).filter(Boolean))]
    for (const u of pdfs) {
      await sleep(1200)
      let buf
      // ★落とせなかったPDFを黙って飛ばさない。「リンクは見えているのに取れない」は
      //   入口の作りが変わった合図で、放っておくと静かに何も拾わなくなる。
      //   実際、京都で <base href> を見落として全部404になっていたのに、
      //   飛ばしていたせいで「今日は何も無かった」に見えていた。
      try { buf = await get(u, true) } catch (e) { broken.push(`${w.city} ${u}: ${e.message}`); continue }
      if (!isPdf(buf)) { broken.push(`${w.city} ${u}: PDFではないものが返ってきた`); continue }
      const h = sha1(buf)
      if (seen[h]) { found.push({ url: u, sha1: h, already: true }); continue }
      const name = `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}_${h}.pdf`
      if (!DRY) {
        fs.writeFileSync(path.join(dir, name), buf)
        seen[h] = { url: u, file: name, firstSeen: report.checkedAt, bytes: buf.length }
      }
      found.push({ url: u, sha1: h, file: name, bytes: buf.length, new: true })
      saved++
      console.log(`新規 ${w.city}  ${name}  ${(buf.length / 1024).toFixed(0)}KB  ${u}`)
    }
  }
  if (!DRY) fs.writeFileSync(seenPath, JSON.stringify(seen, null, 1) + '\n')
  // ★1つも見に行けなかった市は「異常」として扱う。0件と到達不能を混ぜない。
  if (!reachable) broken.push(`${w.city}: 見に行ける入口が1つも無い（URLが変わった可能性）`)
  report.cities.push({
    city: w.city, slug: w.slug, note: w.note,
    pagesTried: w.pages.length, pagesReachable: reachable,
    pdfsSeen: found.length, pdfsNew: found.filter((f) => f.new).length,
    kept: Object.keys(seen).length,
  })
  console.log(`${w.city}：入口 ${reachable}/${w.pages.length} ／ PDF ${found.length}本（新規 ${found.filter((f) => f.new).length}） ／ 手元の累計 ${Object.keys(seen).length}本`)
}

if (!DRY) {
  const out = path.join(ROOT, '.cache', 'koei-watch.json')
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n')
}
console.log(`\n見張り ${WATCH.length}市 ／ 今回あらたに残した ${saved}本`)
if (broken.length) {
  console.error(`\n★見に行けなかった入口 ${broken.length}：`)
  broken.forEach((b) => console.error('  ' + b))
  console.error('  （入口のURLが変わったか、相手が落ちている。放っておくと静かに何も拾わなくなる）')
  process.exitCode = 1
}
