// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-pack.mjs — 有料の「還付申請パック」を自治体ごとに作る。
//
// ★何を売って、何を売らないか
//   売らない: **対象になるかどうかの基準そのもの**。これは無料ページで全部出す。
//             知らないと損する制度の中身に値段をつけるのは、この艦の趣旨に反する。
//   売る:     **手続きを終わらせるための一式**。具体的には
//             ①親の自立度ランクが書いてある書類のどこを見るか／無いときの取り寄せ方
//             ②自分の税率で5年ぶんいくら戻るかの試算表
//             ③同居特別障害者75万円の見落としと、施設入所で外れる条件
//             ④更正の請求・還付申告の手順と必要書類
//   買う人は、困っている本人ではなく**親の確定申告をする現役世代**。
//
// ★自治体ごとに1ファイル作る
//   基準は自治体で違うので、パックも自治体ごと。ビルド時に全部作って KV に入れる。
//   購入後に生成しない＝決済の受け口が軽くなり、落ちる余地が減る。
//
// ★税の話を売る以上、書けない線を引く
//   税額の最終判断は税務署のもの。試算は「控除額×税率」の単純計算であることを明記し、
//   復興特別所得税や他の控除との兼ね合いには踏み込まない。税務相談ではないと書く。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { NINCHI, NETAKIRI, KAIGO } from './shogai-kojo-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'shogai-kojo')
const OUT = path.join(ROOT, '.dist', 'packs')
const TODAY = new Date().toISOString().slice(0, 10)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const yen = (n) => n.toLocaleString('ja-JP')

// ── 控除額（所得税／住民税）。ここだけ直せば全部の試算が変わる ────────────────
const KOJO = {
  障害者: { shotoku: 270000, jumin: 260000 },
  特別障害者: { shotoku: 400000, jumin: 300000 },
  同居特別障害者: { shotoku: 750000, jumin: 530000 },
}
const RATES = [5, 10, 20, 23, 33]     // 所得税率。住民税は原則10%
const JUMIN = 0.1

const refundTable = () => {
  const head = `<tr><th>あなたの所得税率</th>${Object.keys(KOJO).map((k) => `<th>${k}</th>`).join('')}</tr>`
  const rows = RATES.map((r) => {
    const cells = Object.values(KOJO).map((k) => {
      const y = Math.round(k.shotoku * r / 100 + k.jumin * JUMIN)
      return `<td><b>${yen(y)}円</b><br><small>5年で ${yen(y * 5)}円</small></td>`
    }).join('')
    return `<tr><th>${r}%</th>${cells}</tr>`
  }).join('')
  return `<table>${head}${rows}</table>`
}

// ── データ ──────────────────────────────────────────────────────────────────
const reiki = JSON.parse(fs.readFileSync(path.join(DATA, 'records.json'), 'utf8')).records
const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities-records.json'), 'utf8')).records
const score = (r) => (/読めた/.test(r.status) ? 100 : 0) + ['shogai', 'tokubetsu'].reduce((a, k) => a + Object.keys(r[k] || {}).length, 0)
const byCode = new Map()
for (const r of [...reiki, ...cities]) {
  const cur = byCode.get(r.code)
  if (!cur || score(r) > score(cur)) byCode.set(r.code, r)
}
const targets = [...byCode.values()].filter((r) => /読めた/.test(r.status) || r.status === '判定ランクを公表していない')

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:28px 22px 60px;font-family:"Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif;
  line-height:1.8;color:#1a1a1a;background:#fff;max-width:760px;margin-inline:auto;font-size:15px}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 4px;border-bottom:3px solid #1a5c8a;padding-bottom:10px}
h2{font-size:1.15rem;margin:34px 0 10px;padding:7px 11px;background:#1a5c8a;color:#fff;border-radius:3px}
h3{font-size:1rem;margin:20px 0 6px;color:#1a5c8a}
p,li{margin:.5em 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.93rem}
th,td{border:1px solid #b9c6d2;padding:7px 9px;text-align:left;vertical-align:top}
th{background:#eef3f7;font-weight:600}
.lead{background:#f5f8fb;border-left:4px solid #1a5c8a;padding:12px 14px;margin:16px 0}
.warn{background:#fff6ed;border-left:4px solid #c96a1b;padding:12px 14px;margin:16px 0}
.chk{background:#f3f8f3;border:1px solid #bcd4bc;padding:12px 14px;margin:14px 0;border-radius:4px}
.chk li{list-style:none;margin:.45em 0} .chk li::before{content:"☐ ";font-size:1.1em}
.meta{font-size:.82rem;color:#5a6672}
.big{font-size:1.25rem;font-weight:700;color:#b03a2e}
small{color:#5a6672}
a{color:#1a5c8a}
@media print{body{padding:0;font-size:11pt}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

const critRows = (r) => {
  const line = (label, key) => {
    const a = r.shogai?.[key], b = r.tokubetsu?.[key]
    if (!a && !b) return ''
    return `<tr><th>${label}</th><td>${a ? esc(a) + ' 以上' : '—'}</td><td>${b ? esc(b) + ' 以上' : '—'}</td></tr>`
  }
  const rows = line('要介護度', 'kaigo') + line('認知症高齢者の日常生活自立度<br><small>（認知症度）</small>', 'ninchi') +
    line('障害高齢者の日常生活自立度<br><small>（寝たきり度）</small>', 'netakiri')
  return rows
}

let made = 0
const index = []
for (const r of targets) {
  const name = `${r.pref}${r.city}`
  const has = /読めた/.test(r.status)
  const rows = has ? critRows(r) : ''
  const src = r.sourceUrl || r.url

  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}版 障害者控除 還付申請パック｜フクシル</title>
<style>${CSS}</style></head><body>

<h1>${esc(name)}版<br>親の障害者控除 還付申請パック</h1>
<p class="meta">フクシル（fukushiru.com） ／ ${TODAY} 時点の公表資料にもとづく ／ 購入者のみ配布</p>

<div class="lead">
<p><b>このパックは、要介護認定を受けている親御さんについて「障害者控除の対象になるか」を確かめ、
過去にさかのぼって税金を取り戻すまでを、順番どおりに進めるためのものです。</b></p>
<p>制度そのものの説明と${esc(name)}の認定基準は、フクシルの無料ページでも公開しています。
このパックは、そこから先の<b>書類の探し方・金額の試算・申請の手順</b>をまとめたものです。</p>
</div>

<div class="warn">
<p><b>先に確認してください。</b>この控除を使えるのは、次のどちらかです。</p>
<ul>
<li>親御さん<b>本人</b>が所得税・住民税を納めている（年金にも税がかかります）</li>
<li>あなたが親御さんを<b>扶養親族</b>として申告している</li>
</ul>
<p>どちらにも当てはまらない場合、控除する税金そのものがないため戻るお金はありません。
ただし<b>住民税の非課税判定</b>には影響することがあるので、認定書はもらっておく価値があります。</p>
</div>

<h2>ステップ1　親の「自立度ランク」を調べる</h2>
<p>${esc(name)}の判定は、下の物差しで行われます。まず親御さんのランクを確かめます。</p>
${has ? `<table><tr><th>判定に使う物差し</th><th>障害者に準ずる<br><small>所得税27万円</small></th><th>特別障害者に準ずる<br><small>所得税40万円</small></th></tr>${rows}</table>
<p class="meta">「以上」は、その値より重い状態を含みます。この表は${esc(name)}が公表している資料から読み取ったものです（出典は末尾）。</p>`
      : `<div class="warn"><p><b>${esc(name)}は、判定に使うランクを公表していません。</b>「知的障害者（軽度・中度）に準ずる方」といった区分までは示していますが、
どのランクから対象になるかは外から分かりません。ステップ1は飛ばして、<b>ステップ3で窓口に直接聞く</b>のが最短です。
なお全国の多くの自治体は、下に書いたランクを使っています。目安として読んでください。</p></div>`}

<h3>ランクはどこに書いてあるか</h3>
<p>「認知症高齢者の日常生活自立度」と「障害高齢者の日常生活自立度（寝たきり度）」は、
介護認定のときに作られた次の書類に記載されています。<b>介護保険証には書かれていません。</b></p>
<table>
<tr><th>書類</th><th>どこを見るか</th><th>手元にないとき</th></tr>
<tr><th>主治医意見書</th><td>「3. 心身の状態に関する意見」の欄。<b>障害高齢者の日常生活自立度</b>（J1〜C2）と<b>認知症高齢者の日常生活自立度</b>（Ⅰ〜M）が並んで書かれています。</td><td>市区町村の介護保険担当に<b>開示請求</b>をすれば写しがもらえます（本人か家族。窓口で「主治医意見書の開示」と伝える）</td></tr>
<tr><th>認定調査票</th><td>概況調査・基本調査のあと、特記事項の前に同じ2つの自立度が記載されています。</td><td>同上。主治医意見書と一緒に請求できます</td></tr>
</table>
<div class="warn"><p><b>開示請求は無料か数百円で、1〜2週間かかることが多いです。</b>確定申告の期限直前だと間に合わないことがあるので、先にここから始めてください。
なお、<b>認定書の申請そのものには、この書類を自分で用意する必要はありません</b>（自治体が内部で確認します）。
ここで調べるのは「申請して通る見込みがあるか」を先に知るためです。</p></div>

<h2>ステップ2　いくら戻るか試算する</h2>
<p>障害者控除は「税金がその額だけ安くなる」のではなく、<b>課税所得を減らす</b>しくみです。
実際に戻る金額は <b>控除額 × 税率</b> で決まります。控除を受ける人（親御さん本人か、扶養しているあなた）の税率で見てください。</p>
${refundTable()}
<p class="meta">所得税＝控除額×所得税率、住民税＝控除額×10%で計算した目安です。復興特別所得税や他の控除との兼ね合いは含めていません。</p>

<div class="lead">
<p><b>見落としやすいのが「同居特別障害者」です。</b>特別障害者である親御さんと<b>同居している</b>場合、
所得税の控除は40万円ではなく<span class="big">75万円</span>になります（住民税は53万円）。
差は所得税で35万円ぶん。税率20%なら年7万円、5年で35万円の違いです。</p>
<p><b>ただし施設に入所している場合は「同居」に当たりません。</b>特別養護老人ホームや老人保健施設への入所、
長期入院中は対象外です（一時的な入院は同居とみなされます）。ここは間違えやすいので、
入所日・退所日が分かる書類を手元に置いて年ごとに判断してください。</p>
</div>

<h2>ステップ3　認定書をもらう</h2>
<p>${esc(name)}の窓口に「<b>障害者控除対象者認定書</b>を申請したい」と伝えます。
申請書は窓口かウェブサイトで手に入ります。</p>
<div class="chk">
<p><b>持っていくもの（一般的な例。事前に電話で確認してください）</b></p>
<ul>
<li>障害者控除対象者認定申請書（窓口またはサイトで入手）</li>
<li>介護保険被保険者証</li>
<li>申請する人の本人確認書類</li>
<li>親御さん本人以外が申請する場合は、続柄が分かるものや委任状</li>
</ul>
</div>
<p><b>認定書は年ごとに出ます。</b>過去の年の分もさかのぼって申請できるのが普通です（自治体によって何年前まで出せるかが違うので、
「過去◯年分もほしい」と最初に伝えてください）。判定の基準日は、その年の<b>12月31日</b>の状態です。</p>
<p class="meta">申請先・電話番号は ${esc(name)} のウェブサイトでご確認ください。窓口は「介護保険課」「高齢福祉課」「福祉事務所」のいずれかであることが多いです。</p>

<h2>ステップ4　税金を取り戻す</h2>
<p>認定書が手に入ったら、年ごとにやり方が分かれます。</p>
<table>
<tr><th>状況</th><th>やること</th><th>期限</th></tr>
<tr><th>今年の分（これから）</th><td>勤め先の<b>年末調整</b>で申告。扶養控除等申告書の障害者欄に記入し、認定書の写しを添える</td><td>年末調整のとき</td></tr>
<tr><th>過去の年で<b>確定申告をしていない</b></th><td><b>還付申告</b>。その年の確定申告書を新たに提出する</td><td>その年の翌年1月1日から<b>5年</b></td></tr>
<tr><th>過去の年で<b>確定申告をしている</b></th><td><b>更正の請求</b>。「更正の請求書」を提出する</td><td>申告期限から<b>5年</b></td></tr>
</table>
<div class="chk">
<p><b>提出するもの</b></p>
<ul>
<li>確定申告書（還付申告の場合）または更正の請求書</li>
<li>障害者控除対象者認定書の写し（その年の分）</li>
<li>源泉徴収票など、その年の所得が分かるもの</li>
<li>還付金の振込先口座が分かるもの</li>
<li>マイナンバーが確認できるもの</li>
</ul>
</div>
<p><b>5年ぶんまとめて出せます。</b>年ごとに書類を分けて、同時に提出してかまいません。
税務署の窓口でも、e-Taxでも、郵送でも受け付けています。</p>

<h2>ステップ5　確認</h2>
<div class="chk">
<ul>
<li>親御さんの自立度ランクを確認した（または窓口に見込みを聞いた）</li>
<li>${esc(name)}の基準に当てはまるか確かめた</li>
<li>同居しているか、施設入所かを年ごとに整理した</li>
<li>認定書を申請した（過去の年の分も依頼した）</li>
<li>年末調整または還付申告・更正の請求を出した</li>
</ul>
</div>

<h2>出典と免責</h2>
<ul>
${has ? `<li>${esc(name)}${r.reikiTitle ? `「${esc(r.reikiTitle)}」` : 'の公開ページ'}<br>${esc(src)}</li>` : `<li>${esc(name)}の公開ページ<br>${esc(src)}</li>`}
<li>国税庁 タックスアンサー No.1160（障害者控除）／No.1185（市町村長等の障害者認定と介護保険法の要介護認定について）</li>
<li>厚生労働省「障害者控除に係る『認定書』の交付事務について」</li>
</ul>
<p class="meta"><b>このパックは税務相談ではありません。</b>フクシルは税理士事務所ではなく、個人が運営する情報サイトです。
記載は ${TODAY} 時点の公表資料にもとづく一般的な案内で、個別の税額や適用の可否を保証するものではありません。
最終的な判断は、認定については市区町村の窓口、税額については税務署または税理士にご確認ください。</p>
<p class="meta">誤りのご指摘・返金のご依頼は contact@fukushiru.com までお願いします。</p>

</body></html>`

  fs.writeFileSync(path.join(OUT, `${r.code}.html`), html)
  index.push({ code: r.code, pref: r.pref, city: r.city, has })
  made++
}

fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify({ builtAt: new Date().toISOString(), count: made, items: index }))
const bytes = index.reduce((a, x) => a + fs.statSync(path.join(OUT, `${x.code}.html`)).size, 0)
console.log(`パック ${made}件（合計 ${(bytes / 1024 / 1024).toFixed(1)}MB・平均 ${Math.round(bytes / made / 1024)}KB） → .dist/packs/`)
