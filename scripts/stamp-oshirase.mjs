// 公営住宅の面に「募集のお知らせメール（無料）」の1行を入れる（2026-11-19）。
//   面は月次の Actions や生成器が書き直すので、ほかの stamp-*.mjs と同じく公開の直前（pages.yml）に入れる。
//   入れる場所は最初の </h1> の直後。印 <!--oshirase--> があれば入れない（何度回しても同じ結果）。
//   ★地域の key は fukushiru-mail/src/areas.js・oshirase/index.html と同じ。?area= で登録ページの選択が最初から入る。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AREAS = { toei: '都営住宅', 'saitama-ken': '埼玉県営住宅', 'aichi-ken': '愛知県営住宅', shizuoka: '静岡市営住宅', kawasaki: '川崎市営住宅', sagamihara: '相模原市営住宅', kobe: '神戸市営住宅', 'osaka-fu': '大阪府営住宅', 'shiga-ken': '滋賀県営住宅', 'miyagi-ken': '宮城県営住宅', 'kochi-ken': '高知県営住宅' }
const line = (label, area) => `<!--oshirase--><p style="margin:10px 0 16px"><a href="/oshirase/${area ? `?area=${area}` : ''}" style="display:inline-block;padding:9px 14px;border:1px solid #dbe4ff;border-left:3px solid #2563eb;border-radius:8px;background:#f5f8ff;color:#1e3a8a;font-weight:600;text-decoration:none;line-height:1.55">✉ ${label}の次の募集が公式に出たら、メールで知らせる（無料）&nbsp;→</a></p>`

const targets = []
for (const [k, label] of Object.entries(AREAS)) for (const f of [`${k}/index.html`, `${k}/moushikomisaki/index.html`]) targets.push([f, label, k])
targets.push(['articles/koei-jutaku-bairitsu.html', '公営住宅', null])

let n = 0
for (const [rel, label, area] of targets) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) continue
  const h = fs.readFileSync(p, 'utf8')
  if (h.includes('<!--oshirase-->') || !h.includes('</h1>')) continue
  fs.writeFileSync(p, h.replace('</h1>', `</h1>\n${line(label, area)}`))
  n++
}
console.log(`お知らせメールの案内: ${n}面`)
