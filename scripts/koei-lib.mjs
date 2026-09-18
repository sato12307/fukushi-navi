// ─────────────────────────────────────────────────────────────────────────────
// koei-lib.mjs — 政令市の市営住宅の読み取り結果を、申込先ごとに畳むところまで。
//
//   import { load } from './koei-lib.mjs'
//   const D = load('kawasaki')
//
// ★なぜ市ごとに書かないか（2026-09-17）
//   川崎で1本書いたあと、静岡と横浜で同じものを2回写経しかけた。名寄せ・中央値・
//   すいている判定・限界の数え方は3市で同じで、**違うのは軸（どの列で切るか）だけ**。
//   写経すると必ずずれる（片方だけ直る）ので、ここ1本にする。
//   [[same-question-two-implementations]]
//
// ★市ごとに違うのは「軸」と「出典」だけ。それを CITIES に書く。
//   川崎 … 区が資料に無い。種別（新築/空家）と募集区分で切る
//   静岡 … 区（葵・駿河・清水）がある。間取りと階数もある
//   横浜 … 18区と募集区分がある。単身可とエレベーターの印もある
//   ★無い列は作らない。都営で持っている「建てられた年」は3市とも資料に無い。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MIN_N = 4        // これ未満の観測しかない申込先は「毎回」と言えないので狙い目に出さない
export const SUKI = 5         // 中央値がこれ未満なら「すいている」
export const BURE = 10        // 最高が最低のこれ倍以上なら「回によって動く」
export const MIN_GROUP = 5    // 軸ごとの相場は、対象の申込先がこれ以上ある区分だけ出す
export const PRICE = 500

// ── 市ごとの設定 ────────────────────────────────────────────────────────────
//   key      … data/<key>-bairitsu.json と URL の /<key>/ に使う
//   axis     … 相場の表の軸。行の中のどの欄で切るか（label はその見出し）
//   keyOf    … 申込先の名寄せの鍵。ここに入れた欄が違えば別の申込先として数える
//   extra    … 索引の表に足す欄（資料にある分だけ）
export const CITIES = {
  kawasaki: {
    key: 'kawasaki', city: '川崎市', short: '川崎',
    src: '川崎市が募集回ごとに公表する「市営住宅入居者募集に係る抽選結果」の応募状況表PDF',
    // ★区が資料に無い。∴ 区ごとの相場は作れない。軸は募集区分にする。
    axis: { label: '募集区分', of: (r) => `${r.kind}／${r.cat}` },
    keyOf: (r) => [r.name, r.kind, r.cat],
    cols: [['name', '住宅'], ['kind', '種別'], ['cat', '募集区分']],
    note: '同じ住宅でも種別（新築／空家）と募集区分が違えば別に数えています。混ぜると、区分によって安かった住宅が「毎回すいている」に化けるためです。',
  },
  shizuoka: {
    key: 'shizuoka', city: '静岡市', short: '静岡',
    src: '静岡市営住宅（指定管理者サイト s-jutaku.com）が募集回ごとに公表する「空家募集の倍率」PDF',
    // ★静岡は区が資料にある。軸は区。間取りは名寄せの鍵に入れる（同じ団地でも別の住戸）。
    // ★募集区分も鍵に入れる（2026-09-18 の見直しで追加）。静岡の資料は【事故部屋】
    //   【車いす】【子育て支援】【シルバーハウジング】という節に分かれていて、
    //   申込ゼロ率が 車いす82%・子育て支援81%・事故部屋54% に対し一般は24%。
    //   混ぜると、**自分には申し込めない住戸が空いていただけ**の団地が
    //   「毎回すいている」に化ける。買った人がいちばん困る間違い方。
    //   分けたほうが申込先も増えた（4件以上78→94件・すいている63→76件）。
    axis: { label: '区', of: (r) => r.ku || '（区なし）' },
    keyOf: (r) => [r.ku, r.name, r.madori, r.cat],
    cols: [['ku', '区'], ['name', '団地'], ['madori', '間取り'], ['cat', '募集区分']],
    note: '同じ団地でも間取りと募集区分が違えば別に数えています。募集されるのは住戸単位で間取りが違えば倍率もまるで違い、募集区分（一般・子育て支援・車いす・シルバーハウジング・事故部屋）は申し込める人がそもそも違うためです。実測でも申込者ゼロの割合は一般24%に対し、車いす82%・子育て支援81%・事故部屋54%と大きく違います。',
  },
  yokohama: {
    key: 'yokohama', city: '横浜市', short: '横浜',
    src: '横浜市が募集回ごとに公表する記者発表「横浜市営住宅の抽選結果について」の応募状況表PDF',
    // ★横浜は18区と募集区分の両方がある。軸は区（読者が住む場所で選ぶため）。
    axis: { label: '区', of: (r) => r.ku || '（区なし）' },
    keyOf: (r) => [r.ku, r.name, r.cat],
    cols: [['ku', '区'], ['name', '住宅'], ['cat', '募集区分'], ['tanshin', '単身可'], ['ev', 'エレベーター']],
    note: '同じ住宅でも募集区分が違えば別に数えています。単身可（※）とエレベーターの印（□△×）は、資料の凡例にある印を住宅名から切り出したものです。',
  },
  kobe: {
    key: 'kobe', city: '神戸市', short: '神戸',
    src: '神戸市住宅供給公社が定時募集の回ごとに公表する「当選・補欠抽選番号一覧」PDF',
    // ★神戸だけ、募集されるのが**住戸そのもの**（棟と部屋番号まで出る）。
    //   空いた部屋は一度きりしか出ないので、住戸を鍵にすると1回ずつの観測になり
    //   「毎回すいている」が言えない（実測：2,144行に対し住戸は2,053で、重なりは91しかない）。
    //   ∴ 鍵は**団地×種別**にする。読者の問いも「この団地は毎回すいているか」なので合う。
    // ★区が資料に無い（所在地は常時募集の一覧にしか載らず、そちらは全団地を覆わない）。
    //   ∴ 軸は種別。一般と特定目的で中央値が5.0対2.0、申込者ゼロ率が13%対26%と大きく違う。
    axis: { label: '種別', of: (r) => r.kind || '（種別なし）' },
    keyOf: (r) => [r.name, r.kind],
    cols: [['name', '団地'], ['kind', '種別']],
    note: '同じ団地でも一般と特定目的（高齢者向けなど）は申込みの資格が別なので、別に数えています。',
    // ★神戸は募集戸数が必ず1なので割り算をしない。既定の文（応募者数÷募集戸数）は嘘になる。
    //   公表資料に倍率の列そのものが無いので、「倍率の列を読まず」という言い方も当たらない。
    calcNote: '神戸の資料は<strong>1行が1戸</strong>（住宅名・棟・部屋番号まで出ます）で、募集戸数は必ず1です。∴ ここでいう倍率は<strong>その戸に申し込んだ人数そのもの</strong>で、割り算をしていません。資料に倍率の列はありません。',
    // ★神戸には公表の合計が無い。資料の中の別の列どうしで辻褄を合わせている。
    //   「公表表の合計と突き合わせ」と書くと、やっていない検算をやったことになる。
    check: {
      text: (F) => `この資料には全体の合計が公表されていません。∴ <strong>資料の中で辻褄を合わせています</strong>——当選番号のある行は申込者数1以上・無い行は0であること、最大抽選番号が申込者数を下回らないこと、住宅番号の見えている本数と読めた行数が一致すること。<strong>${F.rounds}回とも3つすべてに通りました</strong>。`,
    },
  },
  sagamihara: {
    key: 'sagamihara', city: '相模原市', short: '相模原',
    src: '相模原市が募集回ごとに公表する「入居者募集結果（過去の応募状況）」PDF',
    // ★相模原は市の1ページに13回ぶんがまとめて並んでいる（消えない側）。
    //   ただし団地が39しかなく、他の3市より母数が小さい。「毎回すいている申込先」は
    //   21件で、川崎103・神戸87・横浜65・静岡64と比べるとはっきり薄い。
    //   薄いこと自体は資料の限界なので、面にもそのまま書く（水増ししない）。
    // ★区は資料に無い（市は3区あるが応募状況には出ない）。軸は募集の区分。
    axis: { label: '募集区分', of: (r) => r.cat || '（区分なし）' },
    // ★〇（子育て世帯の優遇対象）は鍵に入れる。申込みの条件が違ううえ、倍率が
    //   実測で中央値2.0倍対7.0倍と大きく違う。混ぜると優遇枠で空いていた住戸が
    //   「この団地・この間取りは毎回すいている」に化ける（川崎で警告したのと同じ事故）。
    //   分けたほうが申込先も増えた（4件以上41→45件・すいている20→23件）。
    keyOf: (r) => [r.name, r.cat, r.madori, r.kosodate],
    cols: [['name', '団地'], ['cat', '募集区分'], ['madori', '間取り'], ['kosodate', '子育て優遇']],
    note: '同じ団地でも募集区分（一般向・高齢者単身者向など）と間取りが違えば別に数えています。区分は申込みの資格そのものが違い、間取りが違えば倍率もまるで違うためです。資料では「一般向 ○3DK」のように区分と間取りが1つの欄に入っているので、当方で分けました（印の意味は資料の凡例にあり、〇＝子育て世帯の優遇対象・■＝エレベーターなしの1階・▲＝同2階です）。〇が付く住戸は申込みの条件が違い、実測でも倍率の中央値が2.0倍と、印の無い住戸の7.0倍よりはっきり低いので、別の申込先として数えています。いっぽう■▲は中央値が8.0倍・6.0倍で印の無い住戸（7.0倍）とほとんど変わらなかったため、分けていません（エレベーターの有無より、どの団地のどの区分かのほうがずっと効きます）。',
    // ★相模原の差は「住宅名の無い行の戸数」ではなく「申込住宅不明」の**人数**。
    //   既定の文を使うと単位が戸になり、読む人に別のものとして伝わる。
    check: { noNameLabel: '申込住宅が分からない申込み（資料に「申込住宅不明」として別掲されている分）', noNameUnit: '人' },
    // ★母数が薄いことを面に書く。他市と同じ顔で出すと、同じ厚みがあるように見える。
    // ★数字は直書きしない。回が増えれば動く（実際に44→48件へ動いて古くなった）。
    thin: (F) => `相模原市営住宅は<strong>団地が39しかなく</strong>、他市より母数が小さい資料です。${MIN_N}件以上観測できた申込先は<strong>${F.enough}件</strong>で、川崎244件・神戸155件・横浜114件と比べるとはっきり薄いことを承知のうえでご覧ください。`,
  },
}

export const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
export const r1 = (x) => Math.round(x * 10) / 10
export const num = (x) => Number(x).toLocaleString('ja-JP')
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
// 回キー 2026-06 → 令和8年6月。★令和1年ではなく令和元年（公表資料がそう書いている）。
export const WA = (r) => {
  const y = Number(r.slice(0, 4)) - 2018
  return `令和${y === 1 ? '元' : y}年${Number(r.slice(5))}月`
}
// ★住宅名の全角と半角をそろえる。回によって混ざり、「大島（1DK）」と「大島（１ＤＫ）」が
//   別の住宅として数えられていた（川崎で実測113組・住宅名359→226）。名寄せが割れると
//   中央値が分かれ、「毎回すいている」という判定そのものが壊れる。
//   ★間取りは落とさない（同じ団地でも別の住戸で倍率がまるで違う）。
export const normName = (s) => String(s ?? '').normalize('NFKC').replace(/[\s　]/g, '')
// 申込者ゼロ＝応募者数が0の行。倍率は当方で計算しているので、これ1本で決まる。
export const isZero = (r) => r.moushikomi === 0

export function load(key) {
  const C = CITIES[key]
  if (!C) throw new Error(`知らない市です: ${key}`)
  const src = path.join(ROOT, 'data', `${key}-bairitsu.json`)
  if (!fs.existsSync(src)) {
    console.error(`data/${key}-bairitsu.json がありません（公開していない中間ファイルです）。`)
    console.error(`  node scripts/${key}-fetch.mjs && python scripts/${key}-parse.py で作ってください。`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'))
  const rows = raw.rows
  const ledger = raw.ledger || []
  const ROUNDS = [...new Set(rows.map((r) => r.round))].sort()

  // ── 申込先ごとに畳む ──────────────────────────────────────────────────────
  const by = new Map()
  for (const r of rows) {
    const k = C.keyOf(r).map((x) => normName(x)).join('|')
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  const houses = [...by.entries()].map(([k, v]) => {
    const parts = k.split('|')
    const o = {}
    C.keyOf(v[0]).forEach((_, i) => { o[C.cols[i][0]] = parts[i] })
    const b = v.map((x) => x.bairitsu)
    return {
      ...o,
      // 索引に出す追加の欄（資料にある分だけ）
      ...Object.fromEntries(C.cols.slice(C.keyOf(v[0]).length).map(([f]) => [f, v[v.length - 1][f] || ''])),
      axis: C.axis.of(v[0]),
      n: v.length,
      rounds: new Set(v.map((x) => x.round)).size,
      med: med(b), min: Math.min(...b), max: Math.max(...b),
      koho: v.reduce((a, x) => a + x.koho, 0),
      zero: v.filter(isZero).length,
      last: v.map((x) => x.round).sort().pop(),
    }
  }).sort((a, b2) => a.med - b2.med || b2.n - a.n)

  const enough = houses.filter((h) => h.n >= MIN_N)
  const suki = enough.filter((h) => h.med < SUKI)
  const buread = enough.filter((h) => h.min > 0 && h.max >= h.min * BURE)
  const konde = enough.slice().sort((a, b2) => b2.med - a.med)
  const ALL_MED = med(enough.map((h) => h.med))

  // ── 軸ごとの相場（無料ページの表）──────────────────────────────────────────
  const GROUPS = [...new Set(rows.map(C.axis.of))].map((label) => {
    const rs = rows.filter((r) => C.axis.of(r) === label)
    const hs = enough.filter((h) => h.axis === label)
    return {
      label, n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
      med: r1(med(rs.map((x) => x.bairitsu))),
      zero: rs.filter(isZero).length,
      houses: hs.length,
      suki: hs.filter((h) => h.med < SUKI).length,
    }
  }).sort((a, b2) => a.med - b2.med)

  const BY_ROUND = ROUNDS.map((round) => {
    const rs = rows.filter((r) => r.round === round)
    return {
      round, n: rs.length, koho: rs.reduce((a, x) => a + x.koho, 0),
      med: r1(med(rs.map((x) => x.bairitsu))),
      zero: rs.filter(isZero).length,
    }
  })

  const F = {
    rows: rows.length, rounds: ROUNDS.length, all: houses.length, enough: enough.length,
    allMed: r1(ALL_MED), suki: suki.length,
    sukiPct: Math.round((suki.length / Math.max(enough.length, 1)) * 100),
    buread: buread.length,
    zeroRows: rows.filter(isZero).length,
    zeroHouses: new Set(rows.filter(isZero).map((r) => normName(r.name))).size,
    zeroHousesEnough: enough.filter((h) => h.zero > 0).length,
    groups: GROUPS.length,
    from: ROUNDS[0], to: ROUNDS[ROUNDS.length - 1],
    // 読み取りの限界を面に出すための数字
    usedRounds: ledger.filter((l) => l.used).length,
    skippedRounds: ledger.filter((l) => !l.used).map((l) => l.round),
    allRounds: ledger.length,
    matched: ledger.filter((l) => l.match).length,
    explained: ledger.filter((l) => l.used && l.match === false && l.explained).length,
    noNameRows: ledger.reduce((a, l) => a + ((l.noName && l.noName.rows) || 0), 0),
    noNameKoho: ledger.reduce((a, l) => a + ((l.noName && l.noName.koho) || 0), 0),
  }
  const RANGE = `${WA(F.from)}〜${WA(F.to)}`
  const shownGroups = GROUPS.filter((g) => g.houses >= MIN_GROUP)

  return {
    C, raw, rows, ledger, ROUNDS, houses, enough, suki, buread, konde,
    GROUPS, shownGroups, BY_ROUND, F, RANGE,
    READ_AT: raw.updated, INDEX_URL: raw.index, SRC_NAME: C.src,
  }
}
