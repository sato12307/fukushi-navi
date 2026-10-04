// ─────────────────────────────────────────────────────────────────────────────
// koei-suii-lib.mjs — 市営住宅の「前の回まで何回・どれくらいの倍率だったか」（回全体の倍率の推移）を数える。
//
//   import { suiiAll, suiiOf } from './koei-suii-lib.mjs'
//
// ★何を出すか（2026-10-04 ユーザー裁定 v297）
//   出すのは**実際の倍率だけ**：募集回ごとの 応募者数÷募集戸数（回全体）と、その最小・中央値・最大。
//   「何回で当たるか」「当選の見込み」のような推計の数字は出さない。横浜は公式の優遇ルール（特認組）の原文の
//   引用と出典 URL だけを添える。
//
// ★どの回を載せるか
//   **市が公表している合計（募集戸数・応募者数）と、当方の読み取りの和が1件まで合った回だけ**。
//   合わない回・読めなかった回は載せず、回と理由を面に書く。
//   合計そのものを公表していない資料（静岡市の倍率表・神戸市の当選番号一覧）は、確かめる相手が無いので載せない。
//
// ★数え方の正典はここ1つ。無料の面（scripts/koei-nerai.mjs の⑤）・看板（scripts/koei-suii-build.mjs）・
//   市別の記事（tools/build_koei_cities.py が data/koei-suii.json を読む）は、ここが出した数をそのまま使う。
//   [[same-question-two-implementations]]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES, WA, med, r1 } from './koei-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 倉（data/<key>-bairitsu.json の ledger）のどこに公表の合計が入っているか
const PUB = {
  yokohama: (l) => (l.published ? { koho: l.published.koho, mo: l.published.moushikomi } : null),
  kawasaki: (l) => (l.published ? { koho: l.published.koho, mo: l.published.moushikomi } : null),
  sagamihara: (l) => (l.pubKoho != null ? { koho: l.pubKoho, mo: l.pubMo } : null),
}
// 公表の合計が資料に無い市（確かめる相手が無いので推移には載せない）
export const NO_TOTAL = {
  shizuoka: '指定管理者が回ごとに出す倍率表PDFに、回全体の合計（募集戸数・申込数）が載っていません。当方の読み取りを突き合わせる相手が無いので載せていません',
  kobe: '神戸市住宅供給公社の当選・補欠抽選番号一覧に、回全体の合計が載っていません（資料の中の辻褄だけで確かめています）。突き合わせる相手が無いので載せていません',
}
// 回の呼び方・出典・面の場所
export const META = {
  yokohama: { boshu: '定期募集（年2回・4月と10月）', publisher: '横浜市', doc: '記者発表「横浜市営住宅の抽選結果について」の応募状況表（表末尾の合計）', face: '/yokohama/', article: 'koei-yokohama' },
  kawasaki: { boshu: '定期募集', publisher: '川崎市', doc: '「市営住宅入居者募集に係る抽選結果」の応募状況表（表の合計）', face: '/kawasaki/', article: 'koei-kawasaki' },
  sagamihara: { boshu: '定期募集（年2回）', publisher: '相模原市', doc: '「入居者募集結果（過去の応募状況）」（回ごとの合計）', face: '/sagamihara/', article: null },
  shizuoka: { boshu: '空家募集（年6回）', publisher: '静岡市営住宅の指定管理者', face: '/shizuoka/', article: null },
  kobe: { boshu: '定時募集（年4回）', publisher: '神戸市住宅供給公社', face: '/kobe/', article: 'koei-kobe' },
}

// 横浜市の優遇ルール（原文のまま。出典の最終更新日も一緒に持つ。言い換えない）
export const YOKOHAMA_YUGU = {
  url: 'https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/kanri.html',
  title: '横浜市「市営住宅の入居者募集」（受付区分と優遇制度）',
  updated: '2026年4月24日',
  lines: [
    '申し込みの受付区分には、「一般組」と、一定の資格を有する方が申し込める「特認組」があります。',
    '特認組の申込者は、一般組より当選率を優遇しています。',
    '特認Ｂ組　当選率を一般組の3倍とします。',
    '特認Ｃ組　連続6回以上申し込み者　当選率を一般組の20倍とします。',
    '特認Ｃ組　連続5回申し込み者　当選率を一般組の10倍とします。',
    '子育て支援（対象住宅のみ適用）　当選率を一般組の20倍とします。',
  ],
}

const stats = (rounds) => {
  if (!rounds.length) return null
  const b = rounds.map((r) => r.bairitsu)
  const lo = rounds.reduce((a, r) => (r.bairitsu < a.bairitsu ? r : a))
  const hi = rounds.reduce((a, r) => (r.bairitsu > a.bairitsu ? r : a))
  return {
    n: rounds.length, first: rounds[0].label, last: rounds[rounds.length - 1].label,
    min: lo.bairitsu, minAt: lo.label, max: hi.bairitsu, maxAt: hi.label, med: r1(med(b)),
    latest: rounds[rounds.length - 1].bairitsu,
  }
}

/** 倉から1市ぶん。{ key, city, rounds:[{round,label,koho,mo,bairitsu,sub?}], dropped:[{round,label,why}], stats, excluded? } */
export function suiiOf(key) {
  const C = CITIES[key]
  const M = META[key] || {}
  const W = C.wa || WA
  const p = path.join(ROOT, 'data', `${key}-bairitsu.json`)
  if (!fs.existsSync(p)) return null
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  const ledger = (raw.ledger || []).slice().sort((a, b) => a.round.localeCompare(b.round))
  const base = { key, city: C.city, short: C.short, ...M, allRounds: ledger.length }
  if (NO_TOTAL[key]) return { ...base, excluded: NO_TOTAL[key], rounds: [], dropped: [], stats: null }
  const rounds = [], dropped = []
  for (const l of ledger) {
    const rs = raw.rows.filter((r) => r.round === l.round)
    const sum = { koho: rs.reduce((a, x) => a + x.koho, 0), mo: rs.reduce((a, x) => a + x.moushikomi, 0) }
    const pub = PUB[key] ? PUB[key](l) : null
    const label = W(l.round)
    if (!l.used && !rs.length) { dropped.push({ round: l.round, label, why: `資料を読み取れなかった回です（${l.why || '住宅名を取り出せない'}）` }); continue }
    if (!pub) { dropped.push({ round: l.round, label, why: '資料の合計を読めなかった回です' }); continue }
    if (pub.koho !== sum.koho || pub.mo !== sum.mo) {
      // 差の出どころが分かっている回は、それも書く（それでも載せない＝1件まで合った回だけ、という約束を崩さない）
      const nn = l.noName || {}
      const known = l.explained && nn.rows
        ? (key === 'sagamihara' ? `。差は資料で「申込住宅不明」として別に数えられている申込み（${nn.koho}人）の分です`
          : `。差は住宅名がPDFに入っていない行（${nn.rows}行・${nn.koho}戸）の分です`)
        : ''
      dropped.push({ round: l.round, label, why: `当方の読み取りの和（${sum.koho}戸・${sum.mo}人）が資料の合計（${pub.koho}戸・${pub.mo}人）と合いません${known}` })
      continue
    }
    const o = { round: l.round, label, koho: pub.koho, mo: pub.mo, bairitsu: r1(pub.mo / pub.koho) }
    // 横浜：単身で申し込める枠（資料の※印・令和4年4月は太字）の合計
    if (key === 'yokohama') {
      const t = rs.filter((r) => r.tanshin)
      const tk = t.reduce((a, x) => a + x.koho, 0), tm = t.reduce((a, x) => a + x.moushikomi, 0)
      o.sub = { label: '単身で申し込める枠', koho: tk, mo: tm, bairitsu: tk ? r1(tm / tk) : null }
    }
    rounds.push(o)
  }
  return { ...base, rounds, dropped, stats: stats(rounds) }
}

/** 公社の資料から取り直した市（札幌・福岡）。data/koei-suii-extra.json（公開してよい回ごとの合計だけ） */
export function suiiExtra() {
  const p = path.join(ROOT, 'data', 'koei-suii-extra.json')
  if (!fs.existsSync(p)) return []
  const X = JSON.parse(fs.readFileSync(p, 'utf8'))
  return (X.cities || []).map((c) => {
    const rounds = c.rounds.filter((r) => r.match === true).map((r) => ({
      round: r.round, label: r.label, koho: r.koho, mo: r.moushikomi, bairitsu: r1(r.moushikomi / r.koho), src: r.src,
    }))
    const dropped = [
      ...c.rounds.filter((r) => r.match !== true).map((r) => ({ round: r.round, label: r.label, why: r.why || '資料の合計と当方の読み取りの和が合いません' })),
      ...(c.notFound || []).map((x) => ({ round: x.round || '', label: x.label || x.round || '', why: x.why })),
    ]
    return { ...c, rounds, dropped, stats: stats(rounds), allRounds: c.rounds.length }
  })
}

export const SUII_KEYS = ['yokohama', 'kawasaki', 'sagamihara', 'shizuoka', 'kobe']
export function suiiAll() {
  const list = SUII_KEYS.map(suiiOf).filter(Boolean)
  return [...list, ...suiiExtra()]
}

// ── 面に出す部品（無料の面の⑤と看板で同じものを使う）──────────────────────────────
const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const n = (x) => Number(x).toLocaleString('ja-JP')
const f1 = (x) => Number(x).toFixed(1)
// 表の下の小さな注記（.note は枠付きのコールアウトになるので使わない）
export const SMALL = 'style="font-size:.88rem;color:var(--sub)"'

/** 1文の要約（最小・中央値・最大と直近）。推計は書かない。 */
export function suiiSummary(s) {
  const S = s.stats
  if (!S) return ''
  return `${e(s.city)}営住宅の${e(s.boshu || '定期募集')}は、公表の合計と1件まで合った<strong>${S.n}回</strong>（${e(S.first)}〜${e(S.last)}）で、回全体の倍率が<strong>最小${f1(S.min)}倍</strong>（${e(S.minAt)}）・<strong>中央値${f1(S.med)}倍</strong>・<strong>最大${f1(S.max)}倍</strong>（${e(S.maxAt)}）でした。直近の${e(S.last)}は<strong>${f1(S.latest)}倍</strong>です。`
}

/** 回ごとの表（新しい回が上）。 */
export function suiiTable(s) {
  const sub = s.rounds.some((r) => r.sub)
  const head = `<th>募集回</th><th class="num">募集戸数</th><th class="num">応募者数</th><th class="num">倍率</th>${sub ? `<th class="num">${e(s.rounds.find((r) => r.sub).sub.label)}の倍率</th>` : ''}`
  const rows = s.rounds.slice().reverse().map((r) => `  <tr><th scope="row">${e(r.label)}</th><td class="num">${n(r.koho)}戸</td><td class="num">${n(r.mo)}人</td><td class="num"><strong>${f1(r.bairitsu)}倍</strong></td>${sub ? `<td class="num">${r.sub && r.sub.bairitsu != null ? `${f1(r.sub.bairitsu)}倍` : '—'}</td>` : ''}</tr>`).join('\n')
  // 4列（数だけ）の表は 320px に収まるので、全体の表の min-width:520px を外す。単身の列がある表は横に送る
  return `  <div class="table-wrap">\n  <table class="grid" style="min-width:${sub ? 520 : 0}px">\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${rows}\n  </tbody></table>\n  </div>`
}

/** 載せなかった回と理由。 */
export function suiiDropped(s) {
  if (!s.dropped.length) return s.allRounds ? `  <p ${SMALL}>当方が読んだ${s.allRounds}回はすべて、公表の合計と1件まで合いました。</p>` : ''
  return `  <details ${SMALL}><summary>載せなかった回（${s.dropped.length}回）と理由</summary>\n  <ul>\n${s.dropped.map((d) => `  <li>${e(d.label)}：${e(d.why)}</li>`).join('\n')}\n  </ul></details>`
}

/** 横浜の優遇ルール（原文の引用と出典だけ）。 */
export function yokohamaYugu() {
  const Y = YOKOHAMA_YUGU
  return `  <blockquote class="callout note">
${Y.lines.map((l) => `    <p>${e(l)}</p>`).join('\n')}
    <p ${SMALL}>出典：<a href="${Y.url}" rel="nofollow">${e(Y.title)}</a>（最終更新日 ${e(Y.updated)}）より原文のまま。各組の対象世帯の一覧は出典のページにあります。</p>
  </blockquote>
  <p ${SMALL}>当サイトは「何回・何年で当たるか」という見込みは計算していません。回全体の倍率は上の表のとおり回ごとに動き、優遇の有無と倍数は申込者ごとに違うためです。ご自身がどの組で申し込めるかは、その回の募集のしおりでご確認ください。</p>`
}

const NOTE_CALC = '倍率＝その回の応募者数の合計÷募集戸数の合計（回全体）。申込先ごとの倍率は、区分や住宅によってこの数字よりずっと高いことも低いこともあります。'

/** 無料の面（/<市>/）の⑤。up は面から根への相対。 */
export function suiiSection(s, { up = '../', num = '⑤' } = {}) {
  if (!s || !s.stats) return ''
  return `  <h2 id="suii">${num} 前の回まで：募集回ごとの倍率の推移（無料）</h2>
  <p>${suiiSummary(s)}</p>
${suiiTable(s)}
  <p ${SMALL}>${NOTE_CALC}載せたのは、${e(s.publisher)}が公表した合計（募集戸数・応募者数）と当方の読み取りが<strong>1件まで合った回だけ</strong>です。</p>
${suiiDropped(s)}
${s.key === 'yokohama' ? `  <h3>横浜市の優遇（特認組）の決まり</h3>\n${yokohamaYugu()}\n` : ''}  <p>ほかの市と並べた表は<a href="${up}koei/bairitsu-suii/">市営住宅の倍率の推移（市ごと）</a>にあります。</p>`
}
