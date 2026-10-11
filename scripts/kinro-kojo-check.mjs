// kinro-kojo-check.mjs — data/kinro-kojo.json（勤労控除の基礎控除額表を写したもの）を原典と式の両方で確かめる。書き込みはしない。
//   node scripts/kinro-kojo-check.mjs            → 厚労省の法令等データベースの次官通知を取り直して確かめる
//   node scripts/kinro-kojo-check.mjs --offline  → 取り直さず、式と表の全行の一致だけ
//
// ★なぜ（2026-10-11 ユーザー裁定 v308「すべて実装」の a＝計算機の勤労控除を控除額表どおりに）
//   計算機は「基礎控除の概算（15,200円＋超過分の約10%）」で出していた。控除額表は4,000円刻みの段なので、収入によって数百円ずれる。
//   表は次官通知の別表で、通知の本文ではなく添付の画像（2枚）にしかない。∴行は人が写し、ここで次のどれかが外れたら止める：
//   ①通知の本文が「別表「基礎控除額表」の額を認定すること」を含む ②新規就労控除・20歳未満控除の月額が JSON と同じ
//   ③添付の画像の番号と sha1 が JSON と同じ（違えば改正＝写し直す） ④式（kinro-kojo-lib.mjs）が表の全行と備考の式に1円まで合う
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { checkRows } from './kinro-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kinro-kojo.json'), 'utf8'))
const OFFLINE = process.argv.includes('--offline')
const UA = { 'user-agent': 'Mozilla/5.0 (fukushiru.com)' }
let ng = 0
const fail = (m) => { console.error('✗ ' + m); ng++ }

const bad = checkRows(J)
if (bad.length) bad.slice(0, 20).forEach(fail)
else console.log(`✓ 式が表の全${J.rows.length}行と、231,000円からの備考の式に1円まで合う`)

if (!OFFLINE) {
  const html = await (await fetch(J.source.url, { headers: UA })).text()
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  if (!text.includes('別表「基礎控除額表」の額を認定すること')) fail('通知の本文に「別表「基礎控除額表」の額を認定すること」が無い')
  const yen = (n) => n.toLocaleString('en-US') + '円'
  if (!text.includes('月額' + yen(J.shinki.amount))) fail(`新規就労控除の月額 ${yen(J.shinki.amount)} が通知の本文に無い（改正？）`)
  if (!text.includes('月額' + yen(J.miman20.amount))) fail(`20歳未満控除の月額 ${yen(J.miman20.amount)} が通知の本文に無い（改正？）`)
  const ids = [...new Set([...html.matchAll(/t_img\?img=(\d+)/g)].map((m) => Number(m[1])))]
  const want = J.source.images.map((x) => x.img)
  if (ids.join(',') !== want.join(',')) fail(`添付の画像の番号が違う：いま ${ids.join(',')}／JSON ${want.join(',')}（改正？写し直す）`)
  for (const im of J.source.images) {
    const buf = Buffer.from(await (await fetch(`https://www.mhlw.go.jp/web/t_img_res?img=${im.img}`, { headers: UA })).arrayBuffer())
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    if (sha1 !== im.sha1) fail(`画像 ${im.img} の中身が変わった（sha1 ${sha1}）＝表が改正された可能性。画像を開いて写し直す`)
    else console.log(`✓ 画像 ${im.img} は写したときと同じ（${buf.length} バイト）`)
  }
  if (!ng) console.log('✓ 通知の本文（別表の指示・新規就労控除・20歳未満控除）が JSON と同じ')
}
if (ng) { console.error(`${ng} 件が合いません。`); process.exit(1) }
console.log('すべて合っています。')
