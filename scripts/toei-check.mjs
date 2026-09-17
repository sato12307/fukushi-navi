// toei-check.mjs — 生成した都営の面を実ブラウザ（320px幅）で検査する。
//   node scripts/toei-check.mjs        ※ scripts/toei-machi.mjs を回した後に必ず通す
//
// ★なぜ要るか（2026-09-17）
//   48本を生成した初回、機械検査は全部通っていたのに **54本すべてで表が崩れていた**。
//   件数・リンク・JSON-LD をいくら数えても出てこない崩れで、
//   「1行の高さ」を実ブラウザで測って初めて分かった。[[mobile-layout-audit]]
//     ・募集区分の表（6列）… 1行 332px。「だれ向けか」の長文が列になっていた
//     ・申込先の表（8列）  … 1行 425px。募集区分に正式名を入れていた
//   ★閾値は既存ページを測って決めた実測値。この艦の正常は 123〜130px、
//     いちばん重い既存ページ（koei-jutaku-bairitsu）で 228px。∴ 230px を線にする。
//     勘で決めると、直したのか慣れただけなのか分からなくなる。
//
// ★<a class="skip"> は画面外に置くのが正しいので、はみ出しから除く（全ページにある）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))
const port = 9200 + Math.floor(Math.random() * 700)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'))
const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl () { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return (await r.json()).webSocketDebuggerUrl } catch {} await sleep(100) } throw new Error('no devtools') }
function rpc (ws) { let id = 0; const w = new Map(); const ev = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { const { resolve, reject } = w.get(m.id); w.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) } else if (m.method) ev.push(m) }); return { send (method, params, sessionId) { const msg = { id: ++id, method, params: params || {} }; if (sessionId) msg.sessionId = sessionId; return new Promise((res, rej) => { w.set(msg.id, { resolve: res, reject: rej }); ws.send(JSON.stringify(msg)) }) }, async waitFor (m, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = ev.findIndex((e) => e.method === m); if (i >= 0) return ev.splice(i, 1)[0]; await sleep(30) } return null } } }

// 買うボタンが許される深さ（画面数・320x800）。数字はメッセージにも出すので必ずここ1か所から。
// ★線を2つに分ける（2026-09-17(2)）。守れる範囲が面の作りで違うため。
//   生成物（都営54本・自治体別438枚）… 面ぜんぶこちらが組む。カードの手前の節も動かせる → 6.0
//   手書きの記事（5枚）             … 位置は「その面の問いに答えている要素の直後」が上限で、
//     そこより上に出すと無料の答えより先に売り込みが来る。実測でその面の最初の答え自体が
//     4.5〜5.1画面ある（①早見表・①まず結論）。カード自体の高さが約1.5画面なので、
//     規則を守るかぎり買うボタンは6画面を少し超える。∴ 7.0 にする。
//     ★これは「守れないから緩めた」のではなく、**守るべき規則が別にある**という意味。
//       この線を超えたら、カードの中身を削るか、面の最初の答えを短くすること。
//   実測（直した直後）＝生成物 4.2〜5.3画面 ／ 手書き 6.1〜6.6画面。
const MAX_SCREENS = 6.0
const MAX_SCREENS_ARTICLE = 7.0
const GENERATED = /^(articles\/toei-|shogai-kojo\/|kawasaki\/|shizuoka\/|yokohama\/|kobe\/|sagamihara\/)/
// 冒頭の案内は生成物にだけ一律で要求する。手書きの記事は「商品と読者が合っている面だけ」に
// 置くと決めてあるため（scripts/stamp-offers.mjs の jumpBefore）。

// 見る面＝売り場カードのある生成物ぜんぶ。★2026-09-17 都営54本だけを見ていたが、
//   同じ日に 自治体別438枚は買うボタン5.1画面・冒頭の案内なし、
//   一覧ページは **カードが48.2画面目**（437自治体の表の後ろ）で放置されていた。
//   都営だけ見ていたから気づけなかった。∴ 売り場のある面はぜんぶここで見る。
//   ★2026-09-17(2) さらに広げた。articles/koei-danchi-ranking.html の82件の表が
//     1行219px・最大434px（同じ面の他の表は80〜106px）で崩れていたのに、
//     この面も関所の外だった。∴ 記事はぜんぶ見る。
const files = [
  ...fs.readdirSync('articles').filter((f) => f.endsWith('.html')).map((f) => 'articles/' + f),
  ...fs.readdirSync('shogai-kojo').filter((f) => f.endsWith('.html')).map((f) => 'shogai-kojo/' + f),
  //   ★2026-09-17(3) 川崎の無料ページ（売り場カードのある面）も足す。
  //     /kawasaki/kanryo/ は購入者だけが来る画面なので見ない。
  //   ★2026-09-17(5) 政令市が5つになった（神戸・相模原を追加）。売り場カードのある無料ページは全部見る。
  //     /<市>/kanryo/ は購入者だけが来る画面なので見ない。
  ...['kawasaki', 'shizuoka', 'yokohama', 'kobe', 'sagamihara'].map((k) => k + '/index.html').filter((f) => fs.existsSync(f)),
].sort()
// 売り場の有無で当てる検査を分ける（売り場を置かない面もある。例＝東京都以外の公営住宅の記事）
const hasOffer = (html) => /class="offer"/.test(html)
const bad = []
try {
  const ws = new WebSocket(await wsUrl())
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  const cdp = rpc(ws)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId)
  await cdp.send('Page.enable', {}, sessionId)
  for (const f of files) {
    const url = 'file:///' + path.resolve(f).replace(/\\/g, '/')
    await cdp.send('Page.navigate', { url }, sessionId)
    await cdp.waitFor('Page.loadEventFired')
    await sleep(120)
    const r = (await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const de = document.documentElement
        const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
        const over = [...document.querySelectorAll('body *')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1) && !inScroller(el)
        }).filter((el)=>el.tagName!=='A'||!/skip/.test(el.className)).slice(0, 3).map((el) => el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : ''))
        // 表の背が高すぎる＝1行が折り返しで縦に伸びている（件数では出ない崩れ）
        const tall = [...document.querySelectorAll('table')].map((t) => {
          const rows = t.querySelectorAll('tbody tr').length || 1
          return { h: Math.round(t.getBoundingClientRect().height / rows), rows }
        //   ★行数の少ない表は当てない。説明文を3列に並べた表（koei-jutaku-bairitsu の
        //     「倍率を左右する4つの因子」＝4行・1行244px）は、どのセルも段落なので高くて正しい。
        //     壊れているのは「短いセルばかりのデータの表で、画面の外にある列が行の高さを決めている」形。
        //     行数で分ければ、その2つを取り違えずに済む。
        }).filter((x) => x.h > 230 && x.rows >= 10)
        return {
          w: de.scrollWidth, cw: de.clientWidth, vh: window.innerHeight,
          over, tall,
          cards: document.querySelectorAll('.offer[data-offer]').length,
          buy: document.querySelectorAll('[data-buy]').length,
          h1: (document.querySelector('h1') || {}).textContent || '',
          title: document.title,
          tables: document.querySelectorAll('table').length,
          jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { JSON.parse(s.textContent); return 'ok' } catch (e) { return 'NG' } }),
          // 売り場の深さ。画面の何枚目にあるか＝押せる位置にあるかどうか。
          btnTop: (() => { const b = document.querySelector('.offer .buyrow'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null })(),
          jump: document.querySelectorAll('a[href^="#offer-"]').length,
        }
      })()`,
    }, sessionId)).result.value
    const msg = []
    if (r.w > r.cw + 1) msg.push(`横スクロール ${r.w}px`)
    if (r.over.length) msg.push(`はみ出し ${r.over.join(',')}`)
    if (r.tall.length) msg.push(`表の行が高い ${r.tall.map((x) => x.h + 'px×' + x.rows + '行').join(' ')}`)
    if (r.cards > 1) msg.push(`売り場カード${r.cards}個`)
    if (r.buy > 1) msg.push(`買うボタン${r.buy}個`)
    if (r.jsonld.includes('NG')) msg.push('JSON-LDが壊れている')
    // ★売り場が押せる位置にあるか（2026-09-17 追加）
    //   09-08 に「5.4画面にある時点で埋め込んだ意味がほぼ消える」と判定したのに、
    //   48本を生成したとき買うボタンが 6.2画面目（390x844）に戻っていた。
    //   ここは中身を足すと黙って深くなるので、機械で見張る。
    //   320x800 での実測（直した直後）＝区市町ページ 5.0〜5.2画面・区分ページ 4.2〜4.6画面。
    //   線は 6.0画面。これを超えたら、カードの中身か手前の節を削ること。
    if (r.cards === 1) {
      if (r.btnTop == null) msg.push('売り場カードはあるのに買うボタンの行（.buyrow）が無い')
      else {
        const lim = GENERATED.test(f) ? MAX_SCREENS : MAX_SCREENS_ARTICLE
        if (r.btnTop / r.vh > lim) msg.push(`買うボタンが深すぎる ${(r.btnTop / r.vh).toFixed(1)}画面（線は${lim}）`)
      }
      if (!r.jump && GENERATED.test(f)) msg.push('冒頭に売り場への案内（#offer-* へのリンク）が無い')
    }
    if (!r.title.includes('フクシル')) msg.push('titleが変')
    if (msg.length) bad.push(`${f}: ${msg.join(' / ')}`)
  }
} finally { child.kill() }
// ★「次の定期募集は◯年◯月」は生成したときの日付で静的HTMLに焼き込まれる。
//   回が過ぎても面はそのまま残り、**誤った案内を出し続ける**。回るたびに賞味期限を見る。
{
  const TEIKI = [2, 5, 8, 11]
  const now = new Date(Date.now() + 9 * 3600e3)
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  const nm = TEIKI.find((x) => x > m)
  const want = `${nm ? y : y + 1}年${nm || TEIKI[0]}月`
  const stale = files.filter((f) => {
    const s = fs.readFileSync(f, 'utf8')
    return s.includes('次の定期募集は') && !s.includes(`次の定期募集は${want}`)
  })
  if (stale.length) bad.push(`「次の定期募集」が古い ${stale.length}本（いまは${want}）→ node scripts/toei-machi.mjs を回し直す`)
}

// ★入口の検算。articles/koei-tokyo.html は data/koei-cities.json から毎月描き直されるので、
//   描画後のHTMLに48本ぶんのリンクが残っているかを見る。ここが消えると新しい面へ誰も行けない。
{
  const tokyo = fs.readFileSync(path.join('articles', 'koei-tokyo.html'), 'utf8')
  const links = new Set([...tokyo.matchAll(/toei-[a-z]+\.html/g)].map((m) => m[0]))
  const missing = files.map((f) => f.replace('articles/', ''))
    .filter((f) => /^toei-[a-z]+\.html$/.test(f) && !/^toei-waku-/.test(f) && !links.has(f))
  if (missing.length) bad.push(`koei-tokyo.html から行けない面が ${missing.length}本（python tools/build_koei_cities.py を回す）：${missing.slice(0, 5).join(', ')}`)
}

console.log(`検査 ${files.length}本`)
if (!bad.length) { console.log('問題なし'); process.exit(0) }
// ★終了コードを1にする。0のままだと、デプロイに繋いだときに素通りする＝関所にならない。
console.log(`★問題 ${bad.length}本`)
bad.forEach((b) => console.log('  ' + b))
process.exit(1)
