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

const files = fs.readdirSync('articles').filter((f) => /^toei-/.test(f)).sort()
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
    const url = 'file:///' + path.resolve('articles', f).replace(/\\/g, '/')
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
        }).filter((x) => x.h > 230)
        return {
          w: de.scrollWidth, cw: de.clientWidth,
          over, tall,
          cards: document.querySelectorAll('.offer[data-offer="toei"]').length,
          buy: document.querySelectorAll('[data-buy]').length,
          h1: (document.querySelector('h1') || {}).textContent || '',
          title: document.title,
          tables: document.querySelectorAll('table').length,
          jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { JSON.parse(s.textContent); return 'ok' } catch (e) { return 'NG' } }),
        }
      })()`,
    }, sessionId)).result.value
    const msg = []
    if (r.w > r.cw + 1) msg.push(`横スクロール ${r.w}px`)
    if (r.over.length) msg.push(`はみ出し ${r.over.join(',')}`)
    if (r.tall.length) msg.push(`表の行が高い ${r.tall.map((x) => x.h + 'px×' + x.rows + '行').join(' ')}`)
    if (r.cards !== 1) msg.push(`売り場カード${r.cards}個`)
    if (r.buy !== 1) msg.push(`買うボタン${r.buy}個`)
    if (r.jsonld.includes('NG')) msg.push('JSON-LDが壊れている')
    if (!r.title.includes('フクシル')) msg.push('titleが変')
    if (msg.length) bad.push(`${f}: ${msg.join(' / ')}`)
  }
} finally { child.kill() }
console.log(`検査 ${files.length}本`)
if (bad.length) { console.log(`★問題 ${bad.length}本`); bad.slice(0, 20).forEach((b) => console.log('  ' + b)) } else console.log('問題なし')
