// ─────────────────────────────────────────────────────────────────────────────
// toei-machi.mjs — 都営住宅の「区市町別」と「募集区分別」のページを作る。
//
// ★なぜ作ったか（2026-09-17）
//   実測でこうなっていた。
//     ・データは48区市町・住宅×募集区分3,198件・定期募集16回ぶんある
//     ・なのに面は11区市町ぶんしか無かった（37区市町がどの面にも出ていない）
//     ・その11本にCloudflareの入口上位20で1本も入らない＝検索から誰も来ていない
//       （GSCの住宅系クエリは28日で2本・表示2回）
//   ∴ 受け皿を48にし、題名を実際に打たれる言葉へ寄せる。
//
// ★題名を「答え」から「問い」へ
//   旧: 「足立区の都営住宅 倍率0倍だった住宅一覧【申込者ゼロ183件】」
//   誰も「倍率0倍」では検索しない。打たれるのは「足立区 都営住宅 倍率」
//   「都営住宅 当たりやすい」「◯◯区 都営住宅 募集」。∴ 頭を区市町＋都営住宅＋倍率にする。
//   [[wrong-display-name-kills-ctr]]
//
// ★募集区分別の面を新設した理由
//   この艦でいちばん強い数字が、どの面にも出ていなかった。
//     単身者向 中央値34倍 ／ 若年夫婦・子育て世帯向 中央値2倍 ＝ 17倍ちがう
//   「どの住宅を選ぶか」より先に「どの枠で出すか」で決まる。しかも枠は募集回と結びついていて、
//   5月・11月は世帯向／子育て／病死、2月・8月は単身／シルバーピア／車いす しか出ない。
//   つまり年4回の募集のうち、自分が出せるのは年2回しかない。これも公表資料には無い。
//
// ★読み取りと名寄せは書かない。scripts/toei-lib.mjs を読む。
//   区市町の取り戻し・町丁目台帳・住宅×募集区分での名寄せの正典はあちら1つ。
//   [[same-question-two-implementations]]
//
// ★売り場のカードはここで埋める（scripts/stamp-offers.mjs は通さない）。
//   あちらは「手書きの記事に貼り直す」係で、生成する面は生成器が持つのが筋。
//   目印コメント（<!-- offer:toei -->）は付けない。付けるとあちらの検算が二重に数える。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { offerToeiLeaf, jumpToei } from './offer-block.mjs'
import {
  ROOT, MIN_N, SUKI, MIN_CITY, JIKO, READ_AT, SRC, ROUNDS, rows, houses, enough,
  med, r1, mode, CITIES, F, RANGE, era, hasNum,
} from './toei-lib.mjs'

const num = (x) => Number(x).toLocaleString('ja-JP')
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

// ── 区市町 → URL。★既存11本のURLは絶対に変えない（外部リンクと索引を捨てることになる）。
const SLUG = {
  千代田区: 'chiyoda', 中央区: 'chuo', 港区: 'minato', 新宿区: 'shinjuku', 文京区: 'bunkyo',
  台東区: 'taito', 墨田区: 'sumida', 江東区: 'koto', 品川区: 'shinagawa', 目黒区: 'meguro',
  大田区: 'ota', 世田谷区: 'setagaya', 渋谷区: 'shibuya', 中野区: 'nakano', 杉並区: 'suginami',
  豊島区: 'toshima', 北区: 'kita', 荒川区: 'arakawa', 板橋区: 'itabashi', 練馬区: 'nerima',
  足立区: 'adachi', 葛飾区: 'katsushika', 江戸川区: 'edogawa',
  八王子市: 'hachioji', 立川市: 'tachikawa', 武蔵野市: 'musashino', 三鷹市: 'mitaka',
  青梅市: 'ome', 府中市: 'fuchu', 昭島市: 'akishima', 調布市: 'chofu', 町田市: 'machida',
  小金井市: 'koganei', 小平市: 'kodaira', 日野市: 'hino', 東村山市: 'higashimurayama',
  国分寺市: 'kokubunji', 国立市: 'kunitachi', 福生市: 'fussa', 狛江市: 'komae',
  東大和市: 'higashiyamato', 清瀬市: 'kiyose', 東久留米市: 'higashikurume',
  武蔵村山市: 'musashimurayama', 多摩市: 'tama', 稲城市: 'inagi', 羽村市: 'hamura',
  西東京市: 'nishitokyo', 瑞穂町: 'mizuho',
}
{
  const miss = CITIES.filter((c) => !SLUG[c])
  if (miss.length) { console.error(`URLの決まっていない区市町: ${miss.join('・')}`); process.exit(1) }
}

// ── 和暦。倍率表もJKKの案内も和暦なので、読者が突き合わせられるようにそろえる。
const WA = (r) => {
  const y = Number(r.slice(0, 4)), m = Number(r.slice(5))
  return `令和${y - 2018}年${m}月`
}

// ── 募集区分。名前が長いので短い呼び名を持つ（表の見出しに使う）。
const CATS = [
  { cat: '世帯向（一般募集住宅）', short: '世帯向（一般）', who: '2人以上の世帯', when: [5, 11] },
  { cat: '若年夫婦・子育て世帯向（定期使用住宅）', short: '若年夫婦・子育て', who: '若い夫婦・子育て世帯（期限つき）', when: [5, 11] },
  { cat: JIKO, short: '病死等があった住宅', who: '条件を承知のうえで選ぶ人', when: [2, 5, 8, 11] },
  { cat: '単身者向', short: '単身者向', who: '1人で申し込む人', when: [2, 8] },
  { cat: 'シルバーピア', short: 'シルバーピア', who: '高齢の単身・夫婦', when: [2, 8] },
  { cat: '単身者用車いす使用者向', short: '単身・車いす', who: '車いすを使う単身の人', when: [2, 8] },
]

// ★「申込者ゼロ」の判定はこの1本だけ。倍率が0でも申込者がいる行が209件ある
//   （例 北区/桐ケ丘一丁目 申込27・戸1。倍率欄の読み取り落ち）。倍率だけで数えると
//   ゼロ率が水増しされ、しかも面には「申込者数と倍率がともに0と読めた募集」と書いてある。
//   実測で 1,700件（倍率だけ）→ 1,491件（両方）。∴ 定義を書く場所を増やさない。
const isZero = (r) => r.moushikomi === 0 && r.bairitsu === 0
const zeroOf = (src) => src.filter(isZero)

// 募集区分ごとの実測（src を差し替えれば区市町ぶんだけにできる）
const catStat = (src = rows) => {
  const g = new Map()
  for (const r of src) { if (!g.has(r.cat)) g.set(r.cat, []); g.get(r.cat).push(r) }
  return CATS.map((c) => {
    const a = g.get(c.cat) || []
    return { ...c, n: a.length, med: a.length ? r1(med(a.map((x) => x.bairitsu))) : null, zero: zeroOf(a).length }
  }).filter((c) => c.n > 0).sort((a, b) => a.med - b.med)
}
const CAT_ALL = catStat()
// 募集区分の短い呼び名。★表のセルでは必ずこちらを使う。正式名（「若年夫婦・子育て世帯向（定期使用住宅）」）を
//   入れると320px幅で1行が425pxまで伸びる。件数では出ない崩れで、行の高さを測って初めて分かる。
const SHORT = new Map(CATS.map((c) => [c.cat, c.short]))
const shortCat = (c) => SHORT.get(c) || c

// ★次の定期募集。★データの最後の回から数えない。倍率表は募集の約4か月後に出るので、
//   データの末尾（2026-05）から進めると、とっくに終わった回を「次」と書いてしまう。
//   ∴ 今日の月から、2月・5月・8月・11月のうち次に来る月を選ぶ。
//   日付は書かない。JKKは回の日程を開催の2週間〜1か月前にしか公表しないので、
//   ここで「11月◯日」と書くと予測を事実の顔で出すことになる。[[archive-to-forecast-doctrine]]
//   確定した日程は /calendar/ に載る（一次情報に年月日で書かれたものだけ）。
const TEIKI = [2, 5, 8, 11]
const NEXT = (() => {
  const now = new Date(Date.now() + 9 * 3600e3)          // 日本時間
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  const nm = TEIKI.find((x) => x > m)
  return nm ? { y, m: nm } : { y: y + 1, m: TEIKI[0] }
})()
const NEXT_LABEL = `${NEXT.y}年${NEXT.m}月`
const NEXT_CATS = CATS.filter((c) => c.when.includes(NEXT.m))

// ── 書き出しはまとめて（途中で止まったら何も書かない）
const pending = []
const write = (rel, html) => pending.push([rel, html])
const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }

const tw = (inner) => `  <div class="table-wrap">\n${inner}\n  </div>`
const tbl = (head, body) => tw(`  <table>\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${body}\n  </tbody></table>`)

// ── 募集区分の表（都全体／区市町）
// ★「だれ向けか」は列にしない。長い文が入るので320px幅で1行が332pxまで伸びた
//   （既存ページの実測は123〜130px）。区分名の下に小さく添える形にする。[[mobile-layout-audit]]
const catTable = (list, { withWhen = true } = {}) => tbl(
  `<th>募集区分</th><th class="num">募集件数</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th>${withWhen ? '<th class="num">出る回</th>' : ''}`,
  list.map((c) => `  <tr><th scope="row">${esc(c.short)}<br><small>${esc(c.who)}</small></th><td class="num">${num(c.n)}件</td><td class="num">${c.med}倍</td><td class="num">${pct(c.zero, c.n)}%</td>${withWhen ? `<td class="num">${c.when.map((m) => `${m}月`).join('・')}</td>` : ''}</tr>`).join('\n'))

const WAKU_LEAD = (() => {
  const hi = CAT_ALL[CAT_ALL.length - 1], lo = CAT_ALL[0]
  return { hi, lo, ratio: Math.round(hi.med / lo.med) }
})()


// ── 区市町ごとの実測 ────────────────────────────────────────────────────────
// ★作った日は面ごとに違う。既存11本は2026-08-24、今回足した37本は今日。
//   全部を同じ日にすると、検索側に「37本が8月からあった」と申告することになる。
const BORN_2608 = new Set(['adachi', 'fuchu', 'hachioji', 'higashimurayama', 'itabashi', 'katsushika', 'kiyose', 'kodaira', 'koto', 'machida', 'nerima'])
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

const stat = (city) => {
  const rs = rows.filter((r) => r.city === city)
  const hs = houses.filter((h) => h.city === city)
  const en = enough.filter((h) => h.city === city)
  const z = zeroOf(rs)
  // 申込者ゼロを住宅ごとに畳む
  const zByName = new Map()
  for (const r of z) {
    if (!zByName.has(r.name)) zByName.set(r.name, [])
    zByName.get(r.name).push(r)
  }
  const zHouses = [...zByName.entries()].map(([name, v]) => ({
    name, n: v.length, koho: v.reduce((a, x) => a + (x.koho || 0), 0),
    era: [...new Set(v.map((x) => x.era).filter(Boolean))],
    ev: [...new Set(v.map((x) => x.ev).filter(Boolean))],
    last: v.map((x) => x.round).sort().pop(),
  })).sort((a, b) => b.n - a.n || b.koho - a.koho)
  // 募集回ごと
  const byRound = ROUNDS.map((r) => {
    const a = rs.filter((x) => x.round === r)
    const zz = zeroOf(a)
    return { round: r, n: a.length, zero: zz.length, koho: zz.reduce((s, x) => s + (x.koho || 0), 0) }
  }).filter((x) => x.n > 0)
  const ev = { yes: rs.filter((r) => r.ev === '有').length, no: rs.filter((r) => r.ev === '無').length }
  const ippan = en.filter((h) => !h.jiko)
  return {
    city, slug: SLUG[city], rows: rs, houses: hs, enough: en, published: BORN_2608.has(SLUG[city]) ? '2026-08-24' : TODAY,
    zero: z.length, zeroKoho: z.reduce((a, x) => a + (x.koho || 0), 0), zHouses, ippan,
    byRound, ev,
    med: ippan.length ? r1(med(ippan.map((h) => h.med))) : null,
    suki: ippan.filter((h) => h.med < SUKI).sort((a, b) => a.med - b.med || b.n - a.n),
    cats: catStat(rs),
  }
}

const ALL = CITIES.map(stat)
// ★出すのは「4件以上観測できた申込先が MIN_CITY 以上」ある区市町だけ。
//   無料ページの相場表と同じ線にそろえる。薄い面を数だけ増やすと艦全体の質が落ちる。
//   [[content-quality-first]]
const PAGES = ALL.filter((s) => s.enough.length >= MIN_CITY && s.med != null).sort((a, b) => b.rows.length - a.rows.length)
const RANK = new Map(PAGES.map((s, i) => [s.city, i + 1]))
const ZERO_ALL = zeroOf(rows).length

if (PAGES.length < 40) die(`区市町ページが ${PAGES.length}本しかできません（40本以上のはず）。読み取りが痩せていないか確かめてください。`)

// ── 近い面への案内。多い順の並びで前後3本ずつ。
const near = (s) => {
  const i = PAGES.findIndex((x) => x.city === s.city)
  const around = [...PAGES.slice(Math.max(0, i - 3), i), ...PAGES.slice(i + 1, i + 4)]
  return around.map((x) => `<a href="toei-${x.slug}.html">${esc(x.city)}</a>`).join(' ／ ')
}

// 冒頭に置く1行の案内。文面・値段・募集回数の正典は scripts/offer-block.mjs。
// ここが決めるのは「どの面のどこに入れるか」だけ。
const JUMP = jumpToei()

// 売り場のカード（全ページ共通・offer-block.mjs が正典）
const OFFER = `  <p class="offer-lead">上の相場で「どのあたりが空いているか」までは分かります。申込書に書けるのは基本的に1回につき1つなので、最後は住宅名を1つに決めることになります。そこだけは住宅ごとの実測が要ります。</p>
${offerToeiLeaf({ up: '../' })}`

// ── 区市町ページ ────────────────────────────────────────────────────────────

const cityPage = (s) => {
  const hasZero = s.zero > 0
  const title = hasZero
    ? `${s.city}の都営住宅 倍率一覧｜当たりやすい住宅と申込者ゼロ${s.zero}件｜フクシル`
    : `${s.city}の都営住宅 倍率一覧｜${num(s.enough.length)}件の申込先を定期募集${F.rounds}回で実測｜フクシル`
  const desc = `${s.city}の都営住宅の倍率を、JKK東京の申込地区別倍率表${F.rounds}回分（${RANGE}）から住宅ごとに数え直しました。${s.city}で観測できた募集は${num(s.rows.length)}件、倍率の中央値は${s.med}倍。${hasZero ? `申込者ゼロは${s.zero}件・${s.zHouses.length}住宅。` : ''}申し込む区分で倍率が${WAKU_LEAD.ratio}倍変わることと、次の定期募集（${NEXT_LABEL}）に出る区分もまとめています。`

  const topZero = s.zHouses[0]
  const sukiTop = s.suki.slice(0, 20)
  const tanshinNext = NEXT_CATS.some((c) => c.short === '単身者向')

  const faq = [
    {
      q: `${s.city}の都営住宅で倍率が低いのはどの住宅ですか？`,
      a: s.suki.length
        ? `${s.city}で${MIN_N}件以上の募集を観測できた申込先（${JIKO}を除く${s.ippan.length}件）のうち、倍率の中央値が${SUKI}倍未満だったのは${s.suki.length}件です。もっとも低いのは${s.suki[0].name}（${s.suki[0].cat}・中央値${r1(s.suki[0].med)}倍・${s.suki[0].n}件観測）でした。${hasZero ? `また、誰も申し込まなかった回がある住宅は${s.zHouses.length}あり、いちばん多いのは${topZero.name}（${topZero.n}回）です。` : ''}ただしこれは過去の記録で、次回の募集に同じ住宅が出るとはかぎりません。申込資格（収入基準・住宅困窮要件・単身入居の可否）を満たすことが前提です。`
        : `${s.city}では、${MIN_N}件以上の募集を観測できた申込先のうち、倍率の中央値が${SUKI}倍未満のものはありませんでした。${s.city}全体の倍率の中央値は${s.med}倍です。`,
    },
    {
      q: `${s.city}の都営住宅は次にいつ募集されますか？`,
      a: `都営住宅の定期募集は例年2月・5月・8月・11月の年4回で、次は${NEXT_LABEL}の回にあたります。ただし回ごとに出る募集区分が決まっていて、${NEXT_LABEL}の回に出るのは${NEXT_CATS.map((c) => c.short).join('・')}です。${tanshinNext ? '' : '単身者向は2月・8月の回にしか出ないため、この回では申し込めません。'}日程は開催の2週間〜1か月前にJKK東京が公表します。確定した日程はフクシルの予定表（${SITE}/calendar/）にも載せています。`,
    },
    {
      q: '都営住宅はどの区分で申し込むと当たりやすいですか？',
      a: `募集区分によって倍率がまったく違います。${RANGE}の${num(F.rows)}件で見ると、${WAKU_LEAD.lo.short}が中央値${WAKU_LEAD.lo.med}倍ともっとも低く、${WAKU_LEAD.hi.short}が中央値${WAKU_LEAD.hi.med}倍でもっとも高く、${WAKU_LEAD.ratio}倍ひらいています。資格が合うなら、住宅を選び直すより先に、どの区分で出せるかを確かめるほうが効きます。`,
    },
  ]

  const secSuki = s.suki.length
    ? `  <p>${MIN_N}件以上の募集を観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものです。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。${JIKO}は性質が違うのでこの表から外しています。建てられた年とエレベーターの有無は、住宅ごとに<a href="../toei/">無料の一覧</a>と有料の索引に入れています。${s.suki.length > 20 ? `中央値の低い順に上位20件です（残り${s.suki.length - 20}件は有料の一覧に全部入っています）。` : ''}</p>
${tbl('<th>住宅</th><th>募集区分</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th>',
      sukiTop.map((h) => `  <tr><th scope="row">${esc(h.name)}</th><td>${esc(shortCat(h.cat))}</td><td class="lo">${r1(h.med)}倍</td><td class="num">${r1(h.min)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n'))}`
    : `  <p>${esc(s.city)}では、${MIN_N}件以上の募集を観測できた申込先のうち、中央値が${SUKI}倍未満のものはありませんでした。${esc(s.city)}全体の中央値は${s.med}倍です。倍率の低い区市町は<a href="../toei/">都内の相場一覧</a>で比べられます。</p>`

  const secZero = hasZero
    ? `  <h2 id="danchi">③ ${esc(s.city)}で申込者ゼロが確認できた住宅（${s.zHouses.length}住宅）</h2>
  <p>同じ住宅が何度もあまっているのか、たまたま1回だけだったのかで意味が変わります。${F.rounds}回を通した確認回数の多い順です。</p>
${tbl('<th>住宅名</th><th class="num">確認</th><th class="num">のべ戸数</th><th class="num">建築年度</th><th class="num">EV</th><th class="num">直近の回</th>',
      s.zHouses.slice(0, 40).map((h) => `  <tr><th scope="row">${esc(h.name)}</th><td class="lo">${h.n}回</td><td class="num">${h.koho}戸</td><td class="num">${esc(h.era.length > 1 ? `${h.era[0]}ほか` : h.era[0] || '—')}</td><td class="num">${esc(h.ev.length > 1 ? '混在' : h.ev[0] || '—')}</td><td class="num">${WA(h.last)}</td></tr>`).join('\n'))}
${s.zHouses.length > 40 ? `  <p class="note">確認回数の多い上位40住宅です（残り${s.zHouses.length - 40}住宅）。</p>` : ''}

  <h2 id="round">④ 募集回ごとの件数（${esc(s.city)}）</h2>
  <p>件数は募集回ごとの戸数や条件で動きます。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません。</p>
${tbl('<th>募集回</th><th class="num">観測できた募集</th><th class="num">うち申込0</th><th class="num">のべ戸数</th>',
      s.byRound.map((r) => `  <tr><th scope="row">${WA(r.round)}</th><td class="num">${r.n}件</td><td class="${r.zero ? 'lo' : 'num'}">${r.zero}件</td><td class="num">${r.koho}戸</td></tr>`).join('\n'))}`
    : ''

  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="koei-jutaku-bairitsu.html">公営住宅</a> ＞ <a href="koei-tokyo.html">東京都</a> ＞ ${esc(s.city)}</p>

  <h1>${esc(s.city)}の都営住宅はどこが当たりやすいか<br><small>${RANGE}の定期募集${F.rounds}回・${num(s.rows.length)}件の倍率を住宅ごとに数え直した実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝JKK東京「申込地区別倍率表」${F.rounds}回分の読み取り</p>

  <p class="lead">都営住宅は「倍率が高くて当たらない」と語られますが、実際の倍率は<strong>住宅より先に、申し込む区分で大きく変わります</strong>。JKK東京は募集回ごとに倍率表を出すだけで、回をまたいで並べた集計は公表していないため、ここでは${F.rounds}回分を読み直して${esc(s.city)}のぶんだけを取り出しました。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>${esc(s.city)}で観測できた募集は<strong>${num(s.rows.length)}件</strong>（都内${RANK.get(s.city)}番目）。倍率の中央値は<strong>${s.med}倍</strong>で、${MIN_N}件以上観測できた申込先は${num(s.enough.length)}件で、そのうち${JIKO}を除いた${num(s.ippan.length)}件のうち<strong>${s.suki.length}件</strong>が${SUKI}倍未満でした。${hasZero ? `誰も申し込まなかった募集は<strong>${s.zero}件（のべ${s.zeroKoho}戸）・${s.zHouses.length}住宅</strong>で、都全体${num(ZERO_ALL)}件の<strong>${pct(s.zero, ZERO_ALL)}%</strong>にあたります。もっとも多いのは<strong>${esc(topZero.name)}（${topZero.n}回）</strong>です。` : `${esc(s.city)}では、誰も申し込まなかった募集は確認できませんでした。`}</p>
  </div>

${JUMP}

  <h2 id="waku">① まず「どの区分で出すか」で倍率が変わる</h2>
  <p>住宅を選ぶ前に、ここを確かめてください。${RANGE}の全${num(F.rows)}件を募集区分ごとに分けると、<strong>${esc(WAKU_LEAD.lo.short)}の中央値${WAKU_LEAD.lo.med}倍に対して${esc(WAKU_LEAD.hi.short)}は${WAKU_LEAD.hi.med}倍</strong>で、<strong>${WAKU_LEAD.ratio}倍</strong>ひらいています。都全体の数字です。</p>
${catTable(CAT_ALL)}
  <p class="note">「出る回」は、その区分が実際に募集された月です。<strong>年4回の定期募集すべてに自分の区分が出るわけではありません。</strong>くわしくは<a href="toei-waku.html">募集区分ごとの倍率</a>にまとめました。</p>

  <div class="callout note">
    <p><span class="tag">次の定期募集は${NEXT_LABEL}</span>この回に出るのは<strong>${NEXT_CATS.map((c) => esc(c.short)).join('・')}</strong>です。${tanshinNext ? '' : '<strong>単身者向・シルバーピア・単身車いす向はこの回には出ません</strong>（2月・8月の回です）。'}日程は開催の2週間〜1か月前にJKK東京が公表します。確定した日程は<a href="../calendar/">フクシルの予定表</a>に載せています（カレンダーアプリに購読できます）。</p>
  </div>

${OFFER}

${s.cats.length > 1 ? `  <h3>${esc(s.city)}だけで見た募集区分</h3>
  <p class="note">${esc(s.city)}で観測できた${num(s.rows.length)}件の内訳です。件数の少ない区分は数字が動きやすいので、上の都全体の表と併せて読んでください。</p>
${catTable(s.cats, { withWhen: false })}` : ''}

  <h2 id="suki">② ${esc(s.city)}で倍率が低かった申込先${s.suki.length ? `（${s.suki.length}件）` : ''}</h2>
${secSuki}

${secZero}

  <h2 id="ev">${hasZero ? '⑤' : '③'} エレベーターの有無</h2>
  <p>${esc(s.city)}で観測できた${num(s.rows.length)}件のうち、エレベーター有が<strong>${num(s.ev.yes)}件</strong>、無が<strong>${num(s.ev.no)}件</strong>でした（欄が読み取れなかった行は除いています）。エレベーターの有無が都全体でどれだけ倍率に効くかは<a href="../toei/">都内の相場一覧</a>に出しています。</p>

  <div class="callout warn">
    <p><span class="tag">この数字の限界</span>ここに出したのは<strong>下限</strong>です。JKK東京の倍率表PDFは回ごとに列の作りが違い、機械での読み取りは全行を正しく復元できません。行頭に区市町が明記されていた行と、住宅名から区を確定できた行だけを使っています。<strong>ここに出ていない住宅も多くあります。「載っていない＝空いていない」ではありません。</strong></p>
    <p><strong>「倍率が低い＝誰でも入れる」ではありません。</strong>申込資格（収入基準・住宅困窮要件・単身可否など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数・間取り・入居人数の条件が変わります。<strong>過去にあまった住宅が次回も募集に出るとはかぎりません。</strong>申し込む前に、その回の募集案内で必ず条件を確認してください。</p>
  </div>

  <div class="callout note">
    <p><span class="tag">先に確かめておくこと</span>都営住宅の申込みには収入の上限があります（政令月収158,000円以下、裁量階層は214,000円以下）。<a href="koei-shunyu-kijun.html">政令月収の判定計算機</a>で先に確かめられます。倍率が高い住戸でも、障害者・高齢者・ひとり親などは<a href="koei-hairiyasui.html">優遇抽選</a>で当選確率を上げられます。</p>
  </div>

  <h2>よくある質問</h2>
${faq.map((f) => `  <h3>Q. ${esc(f.q)}</h3>\n  <p>A. ${f.a}</p>`).join('\n')}

  <h2>関連</h2>
  <ul>
  <li><a href="toei-waku.html">都営住宅は申し込む区分で倍率が${WAKU_LEAD.ratio}倍違う</a>（募集区分ごとの実測）</li>
  <li><a href="../toei/">都営住宅 申込先えらび</a>（区市町ごとの相場・条件別の効き目）</li>
  <li><a href="koei-tokyo.html">東京都の公営住宅の倍率</a>／<a href="koei-shunyu-kijun.html">政令月収の判定</a>／<a href="koei-hairiyasui.html">優遇抽選</a></li>
  <li>近い規模の区市町：${near(s)}</li>
  </ul>

  <h2>出典</h2>
  <ul>
  <li>${esc(SRC)}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>本ページは公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
  <li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
  </ul>
  <p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。</p>`

  return page({
    title, desc, canonical: `/articles/toei-${s.slug}.html`, depth: 1, body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/articles/toei-${s.slug}.html`, datePublished: s.published, dateModified: READ_AT, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })) },
    ],
  })
}

for (const s of PAGES) write(`articles/toei-${s.slug}.html`, cityPage(s))


// ── 募集区分ごとのページ ────────────────────────────────────────────────────
//   ★この艦でいちばん強い数字がどの面にも出ていなかったので作った。
//     単身者向 中央値34倍／若年夫婦・子育て 中央値2倍 ＝ 17倍。
//     しかも区分は募集回と結びついていて、年4回のうち自分が出せるのは年2回しかない。
//   ★区分が薄いものはページにしない（単身者用車いす向は26件）。親ページに数字だけ出す。
const WAKU_MIN = 100
const WAKU_SLUG = {
  '世帯向（一般募集住宅）': 'ippan',
  '若年夫婦・子育て世帯向（定期使用住宅）': 'kosodate',
  '単身者向': 'tanshin',
  'シルバーピア': 'silver',
}
WAKU_SLUG[JIKO] = 'jiko'

const wakuStat = (c) => {
  const rs = rows.filter((r) => r.cat === c.cat)
  const hs = enough.filter((h) => h.cat === c.cat)
  // 募集回ごと。★回によって出る住宅の顔ぶれが変わるので、件数を必ず併記する。
  //   件数を出さずに中央値だけ並べると、供給が入れ替わっただけの動きを傾向と読んでしまう。
  //   [[median-history-is-not-price-change]]
  const byRound = ROUNDS.map((r) => {
    const a = rs.filter((x) => x.round === r)
    return { round: r, n: a.length, med: a.length ? r1(med(a.map((x) => x.bairitsu))) : null, zero: zeroOf(a).length }
  }).filter((x) => x.n > 0)
  const byCity = CITIES.map((city) => {
    const a = rs.filter((x) => x.city === city)
    return { city, n: a.length, med: a.length ? r1(med(a.map((x) => x.bairitsu))) : null, zero: zeroOf(a).length }
  }).filter((x) => x.n >= 10).sort((a, b) => a.med - b.med)
  return {
    ...c, slug: WAKU_SLUG[c.cat], rows: rs, houses: hs, byRound, byCity,
    suki: hs.filter((h) => h.med < SUKI).sort((a, b) => a.med - b.med || b.n - a.n),
  }
}
const WAKUS = CAT_ALL.filter((c) => c.n >= WAKU_MIN && WAKU_SLUG[c.cat]).map(wakuStat)
const THIN = CAT_ALL.filter((c) => c.n < WAKU_MIN || !WAKU_SLUG[c.cat])

// 募集月 → 出る区分（親ページの対応表）
const BY_MONTH = [5, 8, 11, 2].map((m) => ({ m, cats: CATS.filter((c) => c.when.includes(m)) }))

const wakuLink = (c) => (WAKU_SLUG[c.cat] && WAKUS.some((w) => w.cat === c.cat))
  ? `<a href="toei-waku-${WAKU_SLUG[c.cat]}.html">${esc(c.short)}</a>` : esc(c.short)

// ── 親ページ ────────────────────────────────────────────────────────────────
const wakuIndex = () => {
  const title = `都営住宅は申し込む区分で倍率が${WAKU_LEAD.ratio}倍違う｜${WAKU_LEAD.lo.med}倍と${WAKU_LEAD.hi.med}倍・定期募集${F.rounds}回の実測｜フクシル`
  const desc = `都営住宅の倍率を募集区分ごとに数え直しました。${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件で、${WAKU_LEAD.lo.short}は中央値${WAKU_LEAD.lo.med}倍、${WAKU_LEAD.hi.short}は${WAKU_LEAD.hi.med}倍で${WAKU_LEAD.ratio}倍の差。さらに区分ごとに出る募集回が決まっているため、年4回の定期募集のうち自分が申し込めるのは年2回です。次の定期募集（${NEXT_LABEL}）に出る区分もまとめました。`
  const tanshinNext = NEXT_CATS.some((c) => c.short === '単身者向')

  const faq = [
    {
      q: '都営住宅はどの区分で申し込むと当たりやすいですか？',
      a: `${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件で見ると、${WAKU_LEAD.lo.short}が中央値${WAKU_LEAD.lo.med}倍でもっとも低く、${WAKU_LEAD.hi.short}が${WAKU_LEAD.hi.med}倍でもっとも高く、${WAKU_LEAD.ratio}倍ひらいています。ただし区分は自分で選べるものではなく、世帯構成や年齢などの資格で決まります。資格が2つ以上に当てはまる場合だけ、どちらで出すかを選べます。`,
    },
    {
      q: '都営住宅の定期募集は年に何回ありますか？',
      a: `定期募集は例年2月・5月・8月・11月の年4回です。ただし回ごとに出る募集区分が決まっていて、5月と11月は${BY_MONTH.find((x) => x.m === 5).cats.map((c) => c.short).join('・')}、2月と8月は${BY_MONTH.find((x) => x.m === 2).cats.map((c) => c.short).join('・')}でした（${RANGE}の${F.rounds}回で観測）。つまり自分の区分の募集は年4回ではなく年2回です。`,
    },
    {
      q: `次の都営住宅の定期募集ではどの区分が出ますか？`,
      a: `次は${NEXT_LABEL}の回にあたり、過去${F.rounds}回と同じであれば${NEXT_CATS.map((c) => c.short).join('・')}が出ます。${tanshinNext ? '' : '単身者向・シルバーピア・単身者用車いす使用者向は2月・8月の回なので、この回には出ません。'}日程と対象住宅は開催の2週間〜1か月前にJKK東京が公表します。`,
    },
  ]

  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="koei-jutaku-bairitsu.html">公営住宅</a> ＞ <a href="koei-tokyo.html">東京都</a> ＞ 募集区分ごとの倍率</p>

  <h1>都営住宅は「どの区分で出すか」で倍率が${WAKU_LEAD.ratio}倍違う<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件の実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝JKK東京「申込地区別倍率表」${F.rounds}回分の読み取り</p>

  <p class="lead">都営住宅の話は「どの団地が空いているか」に集まりがちですが、実測で先に効くのは<strong>申し込む区分</strong>のほうでした。${WAKU_LEAD.lo.short}の中央値${WAKU_LEAD.lo.med}倍に対して、${WAKU_LEAD.hi.short}は${WAKU_LEAD.hi.med}倍。<strong>${WAKU_LEAD.ratio}倍</strong>ひらいています。しかも区分ごとに出る募集回が決まっているため、<strong>年4回の定期募集のうち、自分が申し込めるのは年2回</strong>です。JKK東京は募集回ごとの倍率表を出すだけで、区分を横に並べた集計は公表していません。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>${WAKU_LEAD.lo.short} <strong>${WAKU_LEAD.lo.med}倍</strong>（申込者ゼロ${pct(WAKU_LEAD.lo.zero, WAKU_LEAD.lo.n)}%）／ ${WAKU_LEAD.hi.short} <strong>${WAKU_LEAD.hi.med}倍</strong>（申込者ゼロ${pct(WAKU_LEAD.hi.zero, WAKU_LEAD.hi.n)}%）。次の定期募集は<strong>${NEXT_LABEL}</strong>で、出るのは${NEXT_CATS.map((c) => esc(c.short)).join('・')}です。</p>
  </div>

${JUMP}

  <h2 id="ichiran">① 募集区分ごとの倍率</h2>
  <p>${RANGE}に観測できた${num(F.rows)}件を、募集区分ごとに分けた実測です。倍率の低い順。</p>
${catTable(CAT_ALL)}
  <p class="note">「申込者ゼロ」は、申込者数と倍率がともに0と読めた募集の割合です。${THIN.length ? `${THIN.map((c) => esc(c.short)).join('・')}は観測できた件数が少ない（${THIN.map((c) => `${c.short} ${c.n}件`).join('・')}）ので、個別のページは作っていません。` : ''}</p>

${OFFER}

  <h2 id="kai">② 自分の区分の募集は年2回しかない</h2>
  <p>定期募集は例年2月・5月・8月・11月の年4回ですが、<strong>回ごとに出る区分が決まっています</strong>。${RANGE}の${F.rounds}回ではこうなっていました。</p>
${tbl('<th>募集の月</th><th>出た募集区分</th>', BY_MONTH.map((x) => `  <tr><th scope="row">${x.m}月</th><td>${x.cats.map(wakuLink).join('／')}</td></tr>`).join('\n'))}
  <p class="note">つまり<strong>単身で申し込む人が5月・11月の回を待っても、単身者向の募集は出ません</strong>。逆に世帯向・子育て向は2月・8月の回には出ません。募集案内が出てから気づくと、次の自分の回まで半年空きます。</p>

  <div class="callout note">
    <p><span class="tag">次の定期募集は${NEXT_LABEL}</span>過去${F.rounds}回と同じであれば、この回に出るのは<strong>${NEXT_CATS.map((c) => esc(c.short)).join('・')}</strong>です。${tanshinNext ? '' : '<strong>単身者向・シルバーピア・単身者用車いす使用者向はこの回には出ません。</strong>'}日程と対象住宅は開催の2週間〜1か月前にJKK東京が公表します。確定した日程は<a href="../calendar/">フクシルの予定表</a>に載せています（カレンダーアプリに購読できます）。<strong>ここに書いた「次の回に出る区分」は過去${F.rounds}回の実測からの見込みで、JKK東京が公表したものではありません。</strong></p>
  </div>

  <h2 id="kubun">③ 区分ごとの中身</h2>
${WAKUS.map((w) => `  <h3><a href="toei-waku-${w.slug}.html">${esc(w.short)}</a>（${num(w.n)}件・中央値${w.med}倍）</h3>
  <p>${esc(w.who)}向け。出るのは${w.when.map((m) => `${m}月`).join('・')}の回。申込者ゼロは${pct(w.zero, w.n)}%、${MIN_N}件以上観測できた申込先${num(w.houses.length)}件のうち${w.suki.length}件が${SUKI}倍未満でした。${w.byCity.length ? `区市町別でもっとも低いのは${esc(w.byCity[0].city)}（${w.byCity[0].med}倍・${w.byCity[0].n}件）です。` : ''}<a href="toei-waku-${w.slug}.html">${esc(w.short)}の倍率をくわしく見る →</a></p>`).join('\n')}

  <div class="callout warn">
    <p><span class="tag">この数字の限界</span>区分は<strong>自分で選べるものではありません</strong>。世帯構成・年齢・障害の有無などの資格で決まります。2つ以上の資格に当てはまる場合だけ、どちらで出すかを選べます。また倍率が低い区分でも、<strong>申込資格（都内在住・収入基準・住宅困窮要件）を満たさなければ申し込めません</strong>。</p>
    <p>JKK東京の倍率表PDFは回ごとに列の作りが違い、機械での読み取りは全行を正しく復元できません。ここに出したのは読み取れた${num(F.rows)}件ぶんで、実際の募集はこれより多くあります。</p>
  </div>

  <h2>よくある質問</h2>
${faq.map((f) => `  <h3>Q. ${esc(f.q)}</h3>\n  <p>A. ${f.a}</p>`).join('\n')}

  <h2>関連</h2>
  <ul>
  <li><a href="../toei/">都営住宅 申込先えらび</a>（区市町ごとの相場・条件別の効き目）</li>
  <li>区市町ごとの倍率：${PAGES.slice(0, 12).map((s) => `<a href="toei-${s.slug}.html">${esc(s.city)}</a>`).join(' ／ ')} ほか全${PAGES.length}区市町</li>
  <li><a href="koei-shunyu-kijun.html">政令月収の判定計算機</a>／<a href="koei-hairiyasui.html">優遇抽選</a>／<a href="../calendar/">募集の予定表</a></li>
  </ul>

  <h2>出典</h2>
  <ul>
  <li>${esc(SRC)}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>本ページは公表表の転載・改変ではなく、公表された数値から当方が計算した指標を、当方の区分で並べたものです。</li>
  <li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
  </ul>`

  return page({
    title, desc, canonical: '/articles/toei-waku.html', depth: 1, body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/articles/toei-waku.html`, datePublished: READ_AT, dateModified: READ_AT, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })) },
    ],
  })
}
write('articles/toei-waku.html', wakuIndex())

// ── 区分ごとの子ページ ──────────────────────────────────────────────────────
const wakuPage = (w) => {
  const title = `都営住宅の${w.short}は何倍？中央値${w.med}倍・募集は${w.when.map((m) => `${m}月`).join('と')}だけ｜フクシル`
  const desc = `都営住宅の「${w.cat}」の倍率を、JKK東京の申込地区別倍率表${F.rounds}回分（${RANGE}）から数え直しました。観測できた募集は${num(w.n)}件、倍率の中央値は${w.med}倍、申込者ゼロは${pct(w.zero, w.n)}%。この区分が出るのは${w.when.map((m) => `${m}月`).join('・')}の定期募集だけです。区市町別・募集回ごとの倍率も載せています。`
  const inNext = w.when.includes(NEXT.m)
  const first = w.byRound[0], last = w.byRound[w.byRound.length - 1]

  const faq = [
    { q: `都営住宅の${w.short}の倍率はどれくらいですか？`, a: `${RANGE}の定期募集${F.rounds}回で観測できた${num(w.n)}件の中央値は${w.med}倍でした。都営住宅ぜんたいの中央値は${F.allMed}倍なので、${w.med > F.allMed ? '平均より高い' : w.med < F.allMed ? '平均より低い' : '平均とほぼ同じ'}区分です。申込者ゼロの募集は${pct(w.zero, w.n)}%ありました。` },
    { q: `都営住宅の${w.short}はいつ募集されますか？`, a: `${RANGE}の${F.rounds}回では、この区分が出たのは${w.when.map((m) => `${m}月`).join('と')}の定期募集だけでした。年4回の定期募集すべてに出るわけではありません。次の定期募集は${NEXT_LABEL}で、${inNext ? 'この区分が出る回にあたります。' : 'この区分は出ない回にあたります（次にこの区分が出るのは、その先の回です）。'}日程は開催の2週間〜1か月前にJKK東京が公表します。` },
    { q: `${w.short}で倍率が低いのはどの区市町ですか？`, a: w.byCity.length ? `10件以上観測できた区市町のうち、中央値がもっとも低いのは${w.byCity[0].city}（${w.byCity[0].med}倍・${w.byCity[0].n}件）、次が${w.byCity[1] ? `${w.byCity[1].city}（${w.byCity[1].med}倍）` : 'ありません'}でした。ただし申込資格と住む地域の希望が優先で、倍率だけで決めるものではありません。` : '10件以上観測できた区市町がないため、区市町別の比較は出していません。' },
  ]

  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="koei-jutaku-bairitsu.html">公営住宅</a> ＞ <a href="toei-waku.html">募集区分ごとの倍率</a> ＞ ${esc(w.short)}</p>

  <h1>都営住宅の${esc(w.short)}は何倍か<br><small>${RANGE}の定期募集${F.rounds}回・${num(w.n)}件の実測</small></h1>
  <p class="updated">最終更新：${READ_AT} ／ 出典＝JKK東京「申込地区別倍率表」${F.rounds}回分の読み取り</p>

  <p class="lead">都営住宅の「${esc(w.cat)}」の倍率です。${esc(w.who)}が対象で、<strong>この区分が出るのは${w.when.map((m) => `${m}月`).join('と')}の定期募集だけ</strong>でした。${RANGE}に観測できた${num(w.n)}件の中央値は<strong>${w.med}倍</strong>です。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>中央値 <strong>${w.med}倍</strong>（都営住宅ぜんたいは${F.allMed}倍）。申込者ゼロの募集は<strong>${pct(w.zero, w.n)}%</strong>。${MIN_N}件以上観測できた申込先${num(w.houses.length)}件のうち<strong>${w.suki.length}件</strong>が${SUKI}倍未満でした。次の定期募集（${NEXT_LABEL}）に${inNext ? '<strong>この区分は出ます</strong>' : '<strong>この区分は出ません</strong>'}。</p>
  </div>

${JUMP}

  <h2 id="hikaku">① ほかの区分と比べる</h2>
  <p>同じ都営住宅でも、区分がちがえば倍率はまったく別物です。</p>
${catTable(CAT_ALL)}
  <p class="note">区分は自分で選べるものではなく、世帯構成や年齢などの資格で決まります。くわしくは<a href="toei-waku.html">募集区分ごとの倍率</a>をご覧ください。</p>

${OFFER}

  <h2 id="round">② 募集回ごとの倍率（${esc(w.short)}）</h2>
  <p>回ごとに出る住宅の顔ぶれが変わるため、中央値だけを並べると<strong>供給が入れ替わっただけの動きを「倍率が上がった／下がった」と読み違えます</strong>。件数を必ず併せて見てください。</p>
${tbl('<th>募集回</th><th class="num">観測できた募集</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th>',
    w.byRound.map((r) => `  <tr><th scope="row">${WA(r.round)}</th><td class="num">${num(r.n)}件</td><td class="num">${r.med}倍</td><td class="${r.zero ? 'lo' : 'num'}">${pct(r.zero, r.n)}%</td></tr>`).join('\n'))}
  <p class="note">いちばん古い回（${WA(first.round)}）は中央値${first.med}倍・申込者ゼロ${pct(first.zero, first.n)}%、いちばん新しい回（${WA(last.round)}）は${last.med}倍・${pct(last.zero, last.n)}%でした。</p>

${w.byCity.length ? `  <h2 id="city">③ 区市町ごとの倍率（${esc(w.short)}）</h2>
  <p>10件以上観測できた区市町だけ、中央値の低い順に並べました。</p>
${tbl('<th>区市町</th><th class="num">観測できた募集</th><th class="num">倍率の中央値</th><th class="num">申込者ゼロ</th><th>区市町のページ</th>',
    w.byCity.map((c) => `  <tr><th scope="row">${esc(c.city)}</th><td class="num">${num(c.n)}件</td><td class="${c.med < SUKI ? 'lo' : 'num'}">${c.med}倍</td><td class="num">${pct(c.zero, c.n)}%</td><td>${SLUG[c.city] && PAGES.some((p) => p.city === c.city) ? `<a href="toei-${SLUG[c.city]}.html">${esc(c.city)}の倍率</a>` : '—'}</td></tr>`).join('\n'))}` : ''}

${w.suki.length ? `  <h2 id="suki">${w.byCity.length ? '④' : '③'} 倍率が低かった申込先（${w.suki.length}件）</h2>
  <p>${MIN_N}件以上の募集を観測できて、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものです。中央値で切っているので、1回だけたまたま空いた住宅は入りません。中央値の低い順に上位30件。</p>
${tbl('<th>区市町</th><th>住宅</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th>',
    w.suki.slice(0, 30).map((h) => `  <tr><td>${esc(h.city)}</td><th scope="row">${esc(h.name)}</th><td class="lo">${r1(h.med)}倍</td><td class="num">${r1(h.min)}倍</td><td class="num">${r1(h.max)}倍</td><td class="num">${h.n}件</td></tr>`).join('\n'))}
${w.suki.length > 30 ? `  <p class="note">上位30件です（残り${w.suki.length - 30}件は有料の一覧に全部入っています）。</p>` : ''}` : ''}

  <div class="callout warn">
    <p><span class="tag">この数字の限界</span>ここに出したのは読み取れたぶんだけの<strong>下限</strong>です。JKK東京の倍率表PDFは回ごとに列の作りが違い、機械での読み取りは全行を正しく復元できません。<strong>「載っていない＝募集が無かった」ではありません。</strong></p>
    <p><strong>過去の倍率は次回を約束しません。</strong>募集される住宅は回ごとに変わり、同じ住宅でも戸数・間取り・入居人数の条件が変わります。申込資格（都内在住・収入基準・住宅困窮要件）を満たすことが前提です。</p>
  </div>

  <div class="callout note">
    <p><span class="tag">先に確かめておくこと</span>都営住宅の申込みには収入の上限があります（政令月収158,000円以下、裁量階層は214,000円以下）。<a href="koei-shunyu-kijun.html">政令月収の判定計算機</a>で先に確かめられます。障害者・高齢者・ひとり親などは<a href="koei-hairiyasui.html">優遇抽選</a>で当選確率を上げられます。</p>
  </div>

  <h2>よくある質問</h2>
${faq.map((f) => `  <h3>Q. ${esc(f.q)}</h3>\n  <p>A. ${f.a}</p>`).join('\n')}

  <h2>関連</h2>
  <ul>
  <li><a href="toei-waku.html">都営住宅は申し込む区分で倍率が${WAKU_LEAD.ratio}倍違う</a>（区分の一覧と募集回の対応）</li>
  <li>ほかの区分：${WAKUS.filter((x) => x.slug !== w.slug).map((x) => `<a href="toei-waku-${x.slug}.html">${esc(x.short)}</a>`).join(' ／ ')}</li>
  <li><a href="../toei/">都営住宅 申込先えらび</a>／<a href="../calendar/">募集の予定表</a>／<a href="koei-tokyo.html">東京都の公営住宅の倍率</a></li>
  </ul>

  <h2>出典</h2>
  <ul>
  <li>${esc(SRC)}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>本ページは公表表の転載・改変ではなく、公表された数値から当方が計算した指標を、当方の区分で並べたものです。</li>
  <li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
  </ul>`

  return page({
    title, desc, canonical: `/articles/toei-waku-${w.slug}.html`, depth: 1, body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/articles/toei-waku-${w.slug}.html`, datePublished: READ_AT, dateModified: READ_AT, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })) },
    ],
  })
}
for (const w of WAKUS) write(`articles/toei-waku-${w.slug}.html`, wakuPage(w))

// ── 入口をつなぎ直す ────────────────────────────────────────────────────────
//   ★区市町ページ48本を作っても、そこへ行ける場所が無ければ誰も来ない。
//     実測で、既存11本は sitemap にも内部リンクにも載っていたのに検索から0だった。
//     ∴ 入口は東京都の面（articles/koei-tokyo.html）の区市町別の表に置く。
//
//   ★★2026-09-17 レンダ済みHTMLに書き込んではいけない（初回これをやって危うく壊すところだった）。
//     articles/koei-tokyo.html は **data/koei-cities.json の tokyo.extra_html から毎月作り直される**
//     （.github/workflows/koei-jutaku.yml が毎月1日に tools/build_koei_cities.py を回して
//      git add articles/koei-tokyo.html までする）。HTMLに直接書くと 10-01 に消える。実際に
//     python tools/build_koei_cities.py を回して、48本のリンクが消えることを確認した。
//     ∴ 書き込むのは **元データ（data/koei-cities.json）** のほう。描画は python 側に任せる。
//     [[same-question-two-implementations]] / [[stale-production-build-drift]]
{
  const p = path.join(ROOT, 'data', 'koei-cities.json')
  const raw = fs.readFileSync(p, 'utf8')
  const data = JSON.parse(raw)
  const list = Array.isArray(data) ? data : (data.cities || [])
  const tokyo = list.find((c) => c.slug === 'tokyo')
  if (!tokyo || !Array.isArray(tokyo.extra_html)) die('data/koei-cities.json に tokyo.extra_html（行の配列）がありません。')
  const H = tokyo.extra_html
  // 置き換える範囲＝「区市町別 募集割れ」の表。見出しの行から、その次に来る </table> まで。
  const cap = H.findIndex((l) => l.includes('<caption>区市町別 募集割れ'))
  if (cap < 0) die('tokyo.extra_html に「区市町別 募集割れ」の表が見つかりません。')
  const open = H.slice(0, cap).map((l, i) => [l, i]).filter(([l]) => l.includes('<table class="ratio-table">')).pop()
  const end = H.findIndex((l, i) => i > cap && l.trim() === '</table>')
  if (!open || end < 0) die('「区市町別 募集割れ」の表の範囲を決められません。')

  const withZero = PAGES.filter((s) => s.zero > 0).sort((a, b) => b.zero - a.zero)
  const rest = PAGES.filter((s) => s.zero === 0)
  const rowOf = (s, z) => `      <tr><th scope="row"><a href="toei-${s.slug}.html">${esc(s.city)}の倍率一覧</a></th><td class="${z ? 'lo' : 'num'}">${z ? `${s.zero}件` : '—'}</td><td>${z ? `${s.zHouses.length}住宅` : '—'}</td><td class="num">${s.med}倍</td></tr>`
  const block = [
    '  <table class="ratio-table">',
    `    <caption>区市町別 募集割れ（申込者ゼロ）が確認できた件数と倍率の中央値・${RANGE}</caption>`,
    '    <thead><tr><th scope="col">区市町</th><th scope="col">確認件数</th><th scope="col">対象になった住宅数</th><th scope="col">倍率の中央値</th></tr></thead>',
    '    <tbody>',
    ...withZero.map((s) => rowOf(s, true)),
    ...rest.map((s) => rowOf(s, false)),
    '    </tbody>',
    `    <tfoot><tr><td colspan="4">「—」は、この読み取りでは申込者ゼロの募集を確認できなかった区市町です（無かったと確定させるものではありません）。<strong>この表の件数は、上の1,360件より広い読み取り（行頭に区市町が無くても住宅名から区を確定できた行を含む${num(zeroOf(rows).length)}件）で数えています。</strong>倍率の中央値は${MIN_N}件以上観測できた申込先のうち${JIKO}を除いたものです。区分によって倍率は${WAKU_LEAD.ratio}倍変わります（<a href="toei-waku.html">募集区分ごとの倍率</a>）。読み取り日 ${READ_AT}。</td></tr></tfoot>`,
    '    </table>',
  ]
  H.splice(open[1], end - open[1] + 1, ...block)
  const next = JSON.stringify(data, null, 2) + '\n'
  if (next !== raw) write('data/koei-cities.json', next)
}

// ── 書き出し ────────────────────────────────────────────────────────────────
const ROOTS = new Set(pending.map(([rel]) => rel))
const changed = []
for (const [rel, html] of pending) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== html) changed.push(rel)
}

// ★出す前に検算する。作った面が壊れていても、件数だけ見ていると何日も気づけない。
{
  const bad = []
  const files = new Set(fs.readdirSync(path.join(ROOT, 'articles')))
  for (const [rel, html] of pending) {
    if (!rel.startsWith('articles/toei-')) continue
    const name = rel.slice('articles/'.length)
    // (1) 売り場のカードがちょうど1つ
    const cards = (html.match(/<div class="offer" id="offer-toei"/g) || []).length
    if (cards !== 1) bad.push(`${name}: 売り場カードが${cards}個`)
    // (2) 買うボタンと計測の印
    if (!/data-offer="toei"/.test(html) || !/data-buy/.test(html)) bad.push(`${name}: 買うボタンか data-offer が無い`)
    // (3) 薄すぎる面を出さない
    if (html.length < 12000) bad.push(`${name}: ${html.length}字しかない`)
    // (4) 記事内リンクの行き先が実在するか（生成中のものは ROOTS にある）
    for (const m of html.matchAll(/href="((?:toei|koei)-[a-z0-9-]+\.html)"/g)) {
      if (!files.has(m[1]) && !ROOTS.has(`articles/${m[1]}`)) bad.push(`${name}: リンク先が無い ${m[1]}`)
    }
  }
  if (bad.length) die(`検算に落ちました（${bad.length}件）:\n  ${bad.slice(0, 12).join('\n  ')}`)
}

for (const [rel, html] of pending) {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
}

// ── sitemap.xml ─────────────────────────────────────────────────────────────
//   ★中身が変わった面だけ lastmod を今日にする。変わらなかった面の日付は動かさない
//     （毎回ぜんぶ今日にすると「いつ変わったか」が二度と分からなくなる）。
{
  const smPath = path.join(ROOT, 'sitemap.xml')
  let sm = fs.readFileSync(smPath, 'utf8')
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  let added = 0, touched = 0
  const entries = pending.map(([rel]) => rel).filter((rel) => rel.startsWith('articles/toei-'))
  for (const rel of entries) {
    const loc = `${SITE}/${rel}`
    const re = new RegExp(`(<url><loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc><lastmod>)([^<]*)(</lastmod>)`)
    if (re.test(sm)) {
      if (changed.includes(rel)) { sm = sm.replace(re, (_, a, _d, c) => a + today + c); touched++ }
    } else {
      sm = sm.replace('</urlset>', `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n</urlset>`)
      added++
    }
  }
  fs.writeFileSync(smPath, sm)
  // 検算：作った面がぜんぶ sitemap にあること
  const miss = entries.filter((rel) => !sm.includes(`${SITE}/${rel}<`.replace('<', '</loc>')) && !sm.includes(`<loc>${SITE}/${rel}</loc>`))
  if (miss.length) die(`sitemap に載っていない面があります: ${miss.join(', ')}`)
  console.log(`sitemap: 新規${added}行・日付更新${touched}行（全${(sm.match(/<url>/g) || []).length}行）`)
}

console.log(`区市町ページ ${PAGES.length}本 ／ 募集区分ページ ${WAKUS.length + 1}本（親1＋${WAKUS.map((w) => w.short).join('・')}）`)
console.log(`  中身が変わった面 ${changed.length} / ${pending.length}`)
console.log(`  募集区分の実測: ${CAT_ALL.map((c) => `${c.short} ${num(c.n)}件 ${c.med}倍`).join(' ／ ')}`)
console.log(`  いちばん低い ${WAKU_LEAD.lo.short} ${WAKU_LEAD.lo.med}倍 ↔ いちばん高い ${WAKU_LEAD.hi.short} ${WAKU_LEAD.hi.med}倍 ＝ ${WAKU_LEAD.ratio}倍`)
console.log(`  次の定期募集 ${NEXT_LABEL}（出る区分: ${NEXT_CATS.map((c) => c.short).join('・')}）`)
console.log(`  区市町ページを作らなかった区市町: ${ALL.filter((s) => !PAGES.some((p) => p.city === s.city)).map((s) => `${s.city}（${MIN_N}件以上観測 ${s.enough.length}件）`).join('・') || 'なし'}`)
console.log(`  次に: node scripts/stamp-offers.mjs（手書き記事の売り場を貼り直す。生成した面は通さない）`)
