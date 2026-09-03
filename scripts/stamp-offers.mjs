// 手書きの記事に、有料の案内ブロック（scripts/offer-block.mjs）を貼り直す。
//   node scripts/stamp-offers.mjs
// 記事は手書きなので生成器を通らない。案内の文言を変えたら offer-block.mjs を直してこれを回す。
// 目印：<!-- offer:pack --> … <!-- /offer --> の間を差し替える（初回は旧コールアウトを目印つきで置き換える）。
import fs from 'node:fs'
import { offerPack, offerToei } from './offer-block.mjs'
const files = fs.readdirSync('articles').filter((f) => f.endsWith('.html')).map((f) => 'articles/' + f)
let n = 0
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n')
  let s = raw.replace(/\r\n/g, '\n')
  const kind = s.includes('<!-- offer:pack -->') || /手続きまで進めるなら[\s\S]{0,900}\.\.\/pack\//.test(s) ? 'pack'
    : s.includes('<!-- offer:toei -->') || /申込先を1つに決めるなら[\s\S]{0,900}\.\.\/toei\//.test(s) ? 'toei' : null
  if (!kind) continue
  const block = `<!-- offer:${kind} -->\n${kind === 'pack' ? offerPack({ up: '../' }) : offerToei({ up: '../' })}\n  <!-- /offer -->`
  const marked = new RegExp(`<!-- offer:${kind} -->[\\s\\S]*?<!-- /offer -->`)
  if (marked.test(s)) s = s.replace(marked, block)
  else {
    const old = kind === 'pack'
      ? /  <div class="callout point"><p><span class="tag">手続きまで進めるなら<\/span>[\s\S]*?<\/p><\/div>/
      : /  <div class="callout point"><p><span class="tag">申込先を1つに決めるなら<\/span>[\s\S]*?<\/p><\/div>/
    if (!old.test(s)) { console.log('見つからない:', f); continue }
    s = s.replace(old, '  ' + block)
  }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s); n++
}
console.log(`貼り直し ${n} 記事`)
