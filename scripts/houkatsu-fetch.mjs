// ─────────────────────────────────────────────────────────────────────────────
// houkatsu-fetch.mjs — 「町名を入れると担当の地域包括支援センターが分かる」逆引きの材料を集める。
//
// ★なぜ作るのか（2026-08-29 の実測）
//   介護の入口で最初に要るのは「親の住所の担当センターはどこか」。ところが
//   厚労省の介護サービス情報公表システムは**所在地検索であって町丁目の逆引きではない**。
//   逆引き表を持っているのは自治体側で、しかも自分の市域の中でしか出していない。
//   読者向けの解説記事（rehouse/パナソニック/minkai/bellco/unimat/kaigo-help）は
//   6件すべてが「自治体のサイトで探してください」と手順を書くだけで、実データを持つ面がゼロ。
//
// ★範囲を全国にしない（実測で決めた）
//   政令市20市を調べた結果、機械可読なのは仙台・千葉・福岡・浜松＋北九州(2017年で更新停止)だけ。
//   PDFで出している自治体は7本試して**7本とも日本語が1文字も取れない**
//   （埼玉県空床/春日井/広島/札幌/横浜/大阪/堺。埋め込みフォントにUnicodeマップが無い）。
//   さらに名古屋・京都・福岡・熊本・岡山・新潟・神戸・北九州・広島は担当区域が
//   **学区（小中学校区）単位**で、町名から引くには「学区→町丁目」の第2の突合表が要る。
//   ∴ ここでは「機械可読 かつ 町名粒度」の自治体だけを扱う。全国面は名乗らない。
//
// ★一意化しない（設計の要）
//   大田区の実測で、207町丁目のうち**29件(14.0%)は番地で複数センターに分かれている**。
//   例:「大森中1丁目1～21番、大森中2丁目1～12番・19～24番」。
//   町丁目キーで1つに畳むと、実名の隣に間違った担当が並ぶ。
//   ∴ 該当する全センターを並べ、番地条件は原文のまま残す。[[same-question-two-answers]]
//
// ★出典の鮮度を隠さない
//   仙台市のエクセルは区ごとに版がばらばら（青葉区と若林区は令和3年＝2021年のまま）。
//   公表年月と当方の取得日を必ず持ち回る。[[crawl-date-flattening]]
//
// ★URLが速く腐る
//   春日井市は検索に出ていたPDF2本がどちらも404、広島市は一覧ページが301で移動済み。
//   取得元URLは毎回このファイルで更新する前提で、404は黙って握りつぶさず落とす。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { expandArea } from './houkatsu-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'houkatsu')
const OUT = path.join(ROOT, 'data', 'houkatsu')
const UA = 'Mozilla/5.0 (compatible; fukushiru-bot/1.0; +https://fukushiru.com/about.html)'
const TODAY = new Date().toISOString().slice(0, 10)
fs.mkdirSync(CACHE, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

// ── 取得元。機械可読かつ町名粒度のものだけ ────────────────────────────────────
const SOURCES = [
  {
    code: '131111', pref: '東京都', city: '大田区', kind: 'html',
    label: '大田区 高齢者の相談窓口（地域包括支援センター）',
    url: 'https://www.city.ota.tokyo.jp/seikatsu/fukushi/kourei/sodan/sawayaka-support.html',
    // 名称が2行に折り返されている（「地域包括支援センター」＋「大森」）ので連結する
    nameIdx: 0, nameLines: 'join', areaIdx: -1, grain: '丁目・番地',
  },
  {
    code: '121002', pref: '千葉県', city: '千葉市', kind: 'html',
    label: '千葉市あんしんケアセンター（地域包括支援センター）',
    url: 'https://www.city.chiba.jp/hokenfukushi/kenkofukushi/hokatsucare/anshincarecenter.html',
    // 1セルに『センター名　所在地・連絡先』が同居。先頭行だけが名称
    nameIdx: 1, nameLines: 'first', areaIdx: -1, grain: '町名',
  },
  {
    code: '221309', pref: '静岡県', city: '浜松市', kind: 'html',
    label: '浜松市 地域包括支援センター（高齢者相談センター）一覧（担当地区一覧）',
    url: 'https://www.city.hamamatsu.shizuoka.jp/kourei/welfare/elderly/soudan/houkatsu.html',
    nameIdx: 0, nameLines: 'first', areaIdx: -1, grain: '町名',
  },
  {
    code: '041009', pref: '宮城県', city: '仙台市', kind: 'xlsx',
    label: '仙台市 地域包括支援センター担当圏域一覧表',
    // ファイル名の元号プレフィックスが版そのもの。青葉区・若林区は令和3年のまま。
    // ★区ごとに1ファイル＝1ページにする。市で1枚にまとめると2,900行・490KBになり
    //   携帯で開けない。行政区コードをそのままファイル名にする。
    files: [
      { ward: '青葉区', code: '041017', published: '令和3年', url: 'https://www.city.sendai.jp/hokatsushien/kurashi/kenkotofukushi/korenokata/hokatsushien/kensaku/documents/r3_keniki_1aoba.xlsx' },
      { ward: '宮城野区', code: '041025', published: '令和4年', url: 'https://www.city.sendai.jp/hokatsushien/kurashi/kenkotofukushi/korenokata/hokatsushien/kensaku/documents/r4_keniki_2miyagino.xlsx' },
      { ward: '若林区', code: '041033', published: '令和3年', url: 'https://www.city.sendai.jp/hokatsushien/kurashi/kenkotofukushi/korenokata/hokatsushien/kensaku/documents/r3_keniki_3wakabayashi.xlsx' },
      { ward: '太白区', code: '041041', published: '令和6年', url: 'https://www.city.sendai.jp/hokatsushien/kurashi/kenkotofukushi/korenokata/hokatsushien/kensaku/documents/r6_keniki_taihaku.xlsx' },
      { ward: '泉区', code: '041050', published: '令和6年', url: 'https://www.city.sendai.jp/hokatsushien/kurashi/kenkotofukushi/korenokata/hokatsushien/kensaku/documents/r6_keniki_izumi.xlsx' },
    ],
    grain: '町丁目・住居表示番号',
  },
]

// ── 依存ゼロの取得 ────────────────────────────────────────────────────────────
async function grab(url, binary = false) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (binary) return buf
  // charset を meta から拾う（自治体サイトは shift_jis が残っていることがある）
  const head = buf.subarray(0, 2048).toString('latin1')
  const m = /charset=["']?([\w-]+)/i.exec(head)
  const enc = (m ? m[1] : 'utf-8').toLowerCase()
  if (/shift|sjis|931|cp932/.test(enc)) return new TextDecoder('shift_jis').decode(buf)
  return buf.toString('utf8')
}

// ── HTMLの表を行×セルに落とす（依存ゼロ）────────────────────────────────────
function tableRows(html) {
  const clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
  return [...clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      td[1]
        // ★<br> を読点に置くと「地域包括支援センター、平和島」のように施設名が割れる。
        //   改行のまま残し、使う側（担当区域は読点／名称は連結）で決める。
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/　/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()))
}

// ── xlsx を標準ライブラリだけで読む（ZIPを手で開いて inflate）────────────────
function unzip(buf) {
  const files = new Map()
  // End of Central Directory を末尾から探す
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('xlsx: EOCDが見つからない')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const elen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    // ローカルヘッダ側の可変長を読んでデータ開始位置を出す
    const lnlen = buf.readUInt16LE(lho + 26)
    const lelen = buf.readUInt16LE(lho + 28)
    const start = lho + 30 + lnlen + lelen
    const raw = buf.subarray(start, start + csize)
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw))
    p += 46 + nlen + elen + clen
  }
  return files
}

function readSheet(buf) {
  const files = unzip(buf)
  const ssXml = files.get('xl/sharedStrings.xml')?.toString('utf8') || ''
  // <si> 単位で束ねる（1セルが複数 <t> に割れることがある）。
  // ★<rPh> はふりがな。外さないと「葉山ハヤマ」のように本文へ読みが食い込む。
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' '))
  const sheetName = [...files.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
  const xml = files.get(sheetName).toString('utf8')
  const rows = []
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])
      const col = ref ? ref[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])
      let val = v ? v[1] : ''
      if (/t="s"/.test(c[1])) val = shared[Number(val)] ?? ''
      else if (/t="inlineStr"/.test(c[1])) val = (/<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]) || [, ''])[1]
      while (cells.length < col) cells.push('')
      cells[col] = String(val).replace(/　/g, ' ').trim()
    }
    rows.push(cells)
  }
  return rows
}

// ── 各ソースを正規化 ──────────────────────────────────────────────────────────
async function fromHtml(src) {
  const html = await grab(src.url)
  fs.writeFileSync(path.join(CACHE, `${src.code}.html`), html)
  const rows = tableRows(html)
  const centers = []
  for (const cells of rows) {
    if (cells.length < 2) continue
    // 担当区域の改行は列挙の区切り＝読点に。
    const area = ((src.areaIdx < 0 ? cells[cells.length + src.areaIdx] : cells[src.areaIdx]) || '').replace(/\n+/g, '、')
    // ★名称は「先頭行だけ」。千葉市は1つのセルに『センター名　所在地・連絡先』を
    //   まとめて入れており、詰めると施設名に住所と電話番号が丸ごと食い込む。
    // ★名称セルの読み方は自治体ごとに違う。1つの規則では両立しない。
    //   大田区 = 名称が折り返されている → 連結（first だと「地域包括支援センター」で切れて23件が同名になる）
    //   千葉市 = 名称と所在地・連絡先が同居 → 先頭行だけ（join だと住所と電話が名称に食い込む）
    const nameLines = (cells[src.nameIdx] || '').split('\n').map((s) => s.trim()).filter(Boolean)
    const name = src.nameLines === 'join' ? nameLines.join('') : (nameLines[0] || '')
    // 見出し行と、担当地域が空の行を落とす
    if (!/丁目|町|区|地区/.test(area)) continue
    if (/センター名|担当地域|担当地区/.test(name) || !name) continue
    centers.push({ name, areaRaw: area, areas: expandArea(area), published: null })
  }
  return { centers, sources: [{ url: src.url, label: src.label, published: null }] }
}

/** 区ごとに1レコード返す（1レコード＝1ページ） */
async function fromXlsx(src) {
  const records = []
  for (const f of src.files) {
    const centers = new Map()
    const buf = await grab(f.url, true)
    fs.writeFileSync(path.join(CACHE, `${src.code}-${f.ward}.xlsx`), buf)
    const rows = readSheet(buf)
    // 見出し行を探す。★A1が共有文字列として解決されない版があるので「町名」では引けない。
    // 確実に解決される「住居表示番号」を足場にし、町名はその左隣の列と決める
    // （実データも col0=かな索引 / col1=町名 / col2=から / col3=まで / 小学校 / 中学校 / センター名）。
    const hi = rows.findIndex((r) => r.some((c) => /住居表示番号/.test(c)))
    const head = rows[hi] || []
    const iFrom = head.findIndex((c) => /住居表示番号|^から$/.test(c))
    const iTo = head.findIndex((c) => c === 'まで')
    const iTown = iFrom - 1
    const iCenter = head.findIndex((c) => /地域包括支援|センター名/.test(c))
    if (hi < 0 || iTown < 0 || iCenter < 0) throw new Error(`${f.ward}: 見出しが見つからない (${head.join('/')})`)
    for (const r of rows.slice(hi + 1)) {
      const town = (r[iTown] || '').trim()
      const center = (r[iCenter] || '').trim()
      if (!town || !center || town.length === 1) continue // 「あ」等の索引行を落とす
      // 住居表示番号は「1」「12」の対で来る。片方だけの行もある（単一番地）。
      // 数字だけを裸で出すと読者に意味が伝わらないので「住居表示番号」を明示した文にする。
      const from = (r[iFrom] || '').trim()
      const to = (r[iTo] || '').trim()
      const note = from && to ? `住居表示番号 ${from}～${to}` : from ? `住居表示番号 ${from}` : ''
      // 町名側に丁目が入っている（例「大町1丁目」）ので展開器に通して丁目を切り出す
      const parts = expandArea(town)
      const key = center
      if (!centers.has(key)) centers.set(key, { name: center, areas: [], published: f.published, ward: f.ward })
      for (const p of parts) centers.get(key).areas.push({ ...p, note })
    }
    records.push({
      code: f.code, pref: src.pref, city: `${src.city}${f.ward}`, muni: src.city, grain: src.grain,
      centers: [...centers.values()],
      sources: [{ url: f.url, label: `${src.label}（${f.ward}）`, published: f.published }],
    })
  }
  return records
}

// ── 実行 ──────────────────────────────────────────────────────────────────────
const summary = []
for (const src of SOURCES) {
  try {
    // html は1レコード、xlsx は区ごとに複数レコード。どちらも「1レコード＝1ページ」で揃える
    const recs = src.kind === 'xlsx'
      ? await fromXlsx(src)
      : [{ code: src.code, pref: src.pref, city: src.city, muni: src.city, grain: src.grain, ...(await fromHtml(src)) }]
    for (const rec of recs) {
      if (!rec.centers.length) throw new Error(`${rec.city}: 担当区域の行が1件も取れなかった`)
      fs.writeFileSync(path.join(OUT, `${rec.code}.json`), JSON.stringify({ ...rec, fetchedAt: TODAY }, null, 1))
      summary.push(`${rec.pref}${rec.city}\t${rec.centers.length}センター\t${rec.grain}`)
    }
  } catch (e) {
    summary.push(`${src.pref}${src.city}\t取得失敗: ${e.message}`)
  }
}
console.log('地域包括支援センター 逆引きの材料')
console.log(summary.join('\n'))
