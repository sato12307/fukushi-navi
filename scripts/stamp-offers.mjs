// 手書きの記事に、有料の売り場（scripts/offer-block.mjs）を貼り直す。
//   node scripts/stamp-offers.mjs
//
// 記事は手書きなので生成器を通らない。文言を変えたら offer-block.mjs を直してこれを回す。
// 目印：<!-- offer:pack --> … <!-- /offer --> の間を差し替える。目印が無い記事は、
// 下の表に書いた位置（その記事で人が答えを得る場所の直後）に初回だけ挿し込む。
//
// ★2026-09-08 「案内」から「売り場」へ
//   14日で来訪440。別URLの売り場（/pack/ /toei/）まで着いた人は3人と8人だった。
//   跳ばす段そのものが落ちていたので、記事の中に売り場（実物の冒頭・値段・買うボタン）を置く。
//
// ★どの記事に置くかを、この1つの表で決める
//   手書きの記事が40枚あり、目で数えると必ず抜ける。表と実際の枚数を最後に突き合わせる。
//   ここに無い記事には置かない（商品と関係のない記事に売り場を置かない）。
import fs from 'node:fs'
import { offerPackLeaf, offerToeiLeaf, jumpPack, jumpToei } from './offer-block.mjs'

// ★2026-09-08(2) 東京都以外の記事から都営の売り場を外した
//   商品は東京都の都営住宅だけを扱う。札幌市・福岡市などの記事や、全国横断の記事に置くと
//   読者の地域と商品が合わない。カードに「東京都だけ」と書いてあっても、棚として無関係。
//   ∴ toei を置くのは「東京と明示できる記事」だけにする（toei-* 11枚＋koei-tokyo）。
//   外したのは koei-* 16枚（道府県別11＋全国横断5）。全国横断のもの
//   （danchi-ranking / hairiyasui / jutaku-bairitsu / shunyu-kijun / yachin-keisan）は
//   読者がどこの人か決められないので、迷ったら外す側に倒した。

// ★2026-09-08(3) 位置の規則を1つにした ─ 「そのページの問いに答えている要素の直後」
//   375×812（モバイル）で本番17枚を実測したところ、いちばん人が降りる
//   articles/seikatsuhogo-keisanki.html でカードが 4,384px（5.4画面）にあった。
//   一番の課題は「有料の案内をちらっとでも見る人が少ない」ことなので、
//   画面に入らない深さに置いた時点で、埋め込んだ意味がほぼ消える。
//   ∴ 置き場所を below の1つの規則で決める：
//     ・その面の問いに答えている要素（要点の囲み／早見表／計算結果）の直後
//     ・答えが複数ある面は「最初の答え」の直後
//     ・表や付録の後ろへは回さない（長い表の下は誰も見ない）
//   ただしカードの導入文（offer-lead）が本文を引用している面は、引用元より前へは出せない
//   （出すと「上の◯◯」が本文に無い状態になる）。その面は引用元の直後が上限になる。
//   文言・値段・カードの中身は1文字も変えていない。動かしたのは位置だけ。

// 商品につなぐ一言。記事の答えと商品の関係を、その記事の言葉で書く（無料の本文）。
const LEAD_TOEI_TOKYO = '上の相場で「どのあたりが空いているか」までは分かります。申込書に書けるのは基本的に1回につき1つなので、最後は住宅名を1つに決めることになります。そこだけは住宅ごとの実測が要ります。'

// kind … pack / toei　peek … 抜粋にどの節を使うか
// before … 置く位置（この直前に入れる）。すでに貼ってあるカードも、ここが指す場所へ動かす。
// keep  … before を書かない面の理由。今の場所が「答えの直後」で動かす必要が無いことを明記する
//         （書き忘れと区別がつかなくなるので、空欄では残さない）。
const TARGETS = {
  // ── 障害者控除・税・生活保護・高額療養費・医療費助成 → 親の障害者控除の手順書 ──────
  'shogaisha-kojo-tax.html': {
    kind: 'pack', peek: 'torimodosu',
    // ⑤申告方法の直後（6,470px＝8.0画面）から、②の末尾に置いてある
    // 「親が要介護なら…過去5年分までさかのぼって還付を請求できます」の囲みの直後へ。
    // ★これ以上は上げられない：導入文が本文の「さかのぼって申告できる場合があります」を
    //   引用している。①早見表の直後（2,073px）へ出すと、引用元が本文に無い状態になる。
    before: /  <h2>③ 「特別障害者」「同居特別障害者」とは？<\/h2>/,
    // 商品と読者が合っている唯一の pack の面。冒頭にも案内を出す。
    jumpBefore: /  <h2[^>]*>① 控除額はいくら？/,
    lead: '上の「さかのぼって申告できる場合があります」を、自分の親御さんに当てはめて確かめ、実際に出すところまでをまとめたものがあります。',
  },
  'juminzei-hikazei-check.html': {
    kind: 'pack', peek: 'rank',
    // ★動かさない（2,712px＝3.34画面）。すでに②自動判定の結果（.out）の直後にあり、
    //   この面の「答えの直後」そのもの。①早見表の直後（1,646px＝2.0画面）へ上げられるのは
    //   導入文を変えたときだけで、導入文は「判定の欄にあった…」と②の入力欄を引用している。
    keep: '②自動判定の結果の直後（導入文が②の入力欄を引用しているため上げられない）',
    lead: '判定の欄にあった「障害者・ひとり親・寡婦・未成年者」（合計所得135万円まで非課税）の<strong>障害者は、手帳を持っている人だけではありません</strong>。要介護認定を受けている親御さんは、市区町村の認定を受ければ障害者に当たることがあり、所得税・住民税の障害者控除も同時に使えます。申告していなかった分は<strong>過去5年分までさかのぼれます</strong>（制度の説明は<a href="shogaisha-kojo-tax.html">障害者控除の記事</a>に無料で置いています）。',
  },
  'kougaku-ryouyouhi-2026.html': {
    kind: 'pack', peek: 'rank',
    // ②自動計算の結果の直後（2,592px＝3.19画面）から、①早見表＝この面の最初の答えの直後へ。
    // 導入文はこの記事の本文を引用していないので上げられる。
    before: /  <h2>② あなたの上限額は？【自動計算】<\/h2>/,
    lead: '重い医療費が<strong>要介護認定を受けている親御さん</strong>の分なら、税のほうでも取り戻せることがあります。障害者手帳がなくても、市区町村の認定を受ければ障害者控除の対象になり、申告していなかった分は<strong>過去5年分までさかのぼれます</strong>（<a href="shogaisha-kojo-tax.html">制度の説明</a>と<a href="../shogai-kojo/">自治体別の認定基準</a>は無料です）。',
  },
  'seikatsuhogo-keisanki.html': {
    kind: 'pack', peek: 'shisan',
    // ③差額支給の計算の直後（4,384px＝5.4画面）から、②自動計算の【結果が出る場所】の直後へ。
    // 艦隊1位の入口（14日で来訪80）。答えが出るのは②なのに、カードは③のさらに後にあった。
    // ②の末尾（計算結果 .out ＋その注記）の直後、③に入る前。
    // 結果と、その結果の限界を書いた注記の“あいだ”には割り込ませない。
    before: /  <h2>③ 働いた収入がある場合【差額支給の計算】<\/h2>/,
    lead: '申請を考える前に、<strong>使い切れていない控除</strong>がないかも確かめてください。要介護認定を受けている親御さんは、障害者手帳がなくても市区町村の認定を受ければ障害者控除の対象になることがあり、過去5年分までさかのぼって税金を取り戻せます。<strong>すでに保護を受けている世帯は課税されていないことが多く、その場合に戻るお金はありません</strong>——親御さんやご家族に納税している人がいる場合の話です。',
  },
  'jichitai-transport-medical.html': {
    kind: 'pack', peek: 'nintei',
    // ②医療費助成の比較表の直後（4,406px＝5.4画面）から、冒頭の「この記事の要点」の直後へ。
    // ①の比較表だけで2,231px あり、その下に回すと4.2画面。要点の囲みがこの面の答え
    //（自治体ごとに差がある）そのもので、導入文の「交通や医療費の助成と同じで、
    // 障害者控除の認定基準も自治体ごとに違います」がそのまま続く。
    before: /  <h2>① 交通（地下鉄・市バス）の無料制度 比較<\/h2>/,
    lead: '交通や医療費の助成と同じで、<strong>障害者控除の認定基準も自治体ごとに違います</strong>。障害者手帳がなくても、要介護認定を受けている親御さんは市区町村の認定で対象になることがあります（→ <a href="../shogai-kojo/">自治体別の認定基準の一覧・無料</a>）。',
  },

  // ── 都営住宅・公営住宅 → 都営住宅の申込先えらび ───────────────────────────────
  // 東京の11枚は作りが同じ（h1 → 導入 → 「数字だけ」の囲み → ①住宅一覧の表 → ②③ → 注意書き）。
  // カードは注意書きの後（5,001〜7,583px＝6.2〜9.3画面）にあった。①の表は区によって
  // 15〜83行あり、その下に回すと足立区で6.2画面のまま。∴ 11枚とも「数字だけ」の囲みの直後
  //（＝この面の答えを数行で言い切っている場所）へ揃える。目印の行はどの記事でも同じ。
  // ★2026-09-17 都営の区市町別11枚をこの表から外した。scripts/toei-machi.mjs が
  //   48区市町ぶんを生成するようになり、売り場のカードも生成器が埋めている。
  //   ここに残すと、目印コメントの無い生成ページに2枚目のカードを挿し込んでしまう
  //   （before の <h2 id="danchi"> が生成ページにもあるため、剥がす側が空振りする）。
  //   手書きで残っているのは koei-tokyo.html だけ。
  // 引越しアフィリの箱の直前（15,991px＝19.7画面。ページの69%地点）から、
  // ①「倍率が高い住戸・低い住戸（実例）」の2つの表の直後へ。導入文の「上の相場で
  // どのあたりが空いているか」がそのまま指す場所になる。
  'koei-tokyo.html': { kind: 'toei', before: /  <h2>② 東京都で倍率を左右する要因<\/h2>/, lead: LEAD_TOEI_TOKYO,
    jumpBefore: /  <h2[^>]*>① 倍率が高い住戸・低い住戸/ },
  // 東京以外の公営住宅の記事（koei-chiba / fukuoka / kawasaki / kobe / kyoto / nagoya / osaka /
  // saitama / sapporo / sendai / yokohama）と、全国横断の記事（koei-danchi-ranking /
  // hairiyasui / jutaku-bairitsu / shunyu-kijun / yachin-keisan）には置かない。2026-09-08(2)
}

// 冒頭に置く1行の案内。文面・値段の正典は scripts/offer-block.mjs。
// ★置くのは「商品と読者が合っている面」だけ（下の表の jumpBefore）。
//   住民税非課税・高額療養費・生活保護の面は、読者の用事と商品（親の障害者控除の手順書）が
//   ずれているので案内を強めない。カードはそのまま置く（面そのものは撒き餌として価値がある）。
const jump = (kind) => (kind === 'toei' ? jumpToei() : jumpPack())

const block = (t) => {
  const card = t.kind === 'pack' ? offerPackLeaf({ peek: t.peek, up: '../' }) : offerToeiLeaf({ up: '../' })
  const lead = t.lead ? `  <p class="offer-lead">${t.lead}</p>\n` : ''
  return `<!-- offer:${t.kind} -->\n${lead}${card}\n  <!-- /offer -->`
}

const files = fs.readdirSync('articles').filter((f) => f.endsWith('.html'))
const missing = Object.keys(TARGETS).filter((f) => !files.includes(f))
if (missing.length) { console.error('表にあるのに記事が無い:', missing.join(', ')); process.exit(1) }

// ★before があれば「剥がしてから入れ直す」。貼り直すだけの実装だと、表に書いた位置を直しても
//   すでにカードのある記事は永久に元の場所のままになる（実際そうなっていて、記事5枚が
//   3.2〜8.0画面の深さに残っていた）。剥がす→入れるにすると、何度流しても結果が同じになる。
let moved = 0, replaced = 0, inserted = 0, jumped = 0
const failed = []
const changedFiles = []   // 貼り直しで中身が変わった記事（sitemap の lastmod を動かす）
for (const f of files) {
  const t = TARGETS[f]
  if (!t) continue
  const p = 'articles/' + f
  const raw = fs.readFileSync(p, 'utf8')
  const crlf = raw.includes('\r\n')
  let s = raw.replace(/\r\n/g, '\n')
  const marked = /\n*<!-- offer:(?:pack|toei) -->[\s\S]*?<!-- \/offer -->\n*/
  const had = marked.test(s)
  // ★冒頭の案内も「剥がしてから入れ直す」。貼り直すだけだと、文言や値段を変えても
  //   すでに入っている面は永久に古いままになる（売り場カードで同じ穴を踏んでいる）。
  const jumpMark = /\n*<!-- jump -->[\s\S]*?<!-- \/jump -->\n*/
  s = s.replace(jumpMark, '\n\n')
  if (t.jumpBefore) {
    if (!t.jumpBefore.test(s)) { failed.push(`${f}（冒頭の案内の位置）`); continue }
    s = s.replace(t.jumpBefore, (m) => `<!-- jump -->\n${jump(t.kind)}\n  <!-- /jump -->\n\n${m}`)
    jumped++
  }
  if (t.before) {
    if (had) s = s.replace(marked, '\n\n')            // いま貼ってある場所から剥がす
    if (!t.before.test(s)) { failed.push(f); continue }
    s = s.replace(t.before, (m) => `${block(t)}\n\n${m}`)
    had ? moved++ : inserted++
  } else if (had) { s = s.replace(marked, `\n\n${block(t)}\n\n`); replaced++ }
  else { failed.push(f); continue }
  const out = crlf ? s.replace(/\n/g, '\r\n') : s
  if (out !== raw) changedFiles.push(f)
  fs.writeFileSync(p, out)
}
if (failed.length) { console.error('位置が見つからない:', failed.join(', ')); process.exit(1) }

// ★2026-09-13 中身が変わった記事は sitemap.xml の lastmod を今日（日本時間）にする。
//   売り場の抜粋（件数・列）を貼り直しても記事の lastmod は古いままで、/toei/ だけ新しい日付になっていた。
//   変わらなかった記事の日付は動かさない。sitemap に載っていない記事は名前を出すだけで、行は足さない。
if (changedFiles.length) {
  const smRaw = fs.readFileSync('sitemap.xml', 'utf8')
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  let sm = smRaw
  const notIn = []
  for (const f of changedFiles) {
    const re = new RegExp(`(<loc>[^<]*/articles/${f.replace(/\./g, '\\.')}</loc><lastmod>)([^<]*)(</lastmod>)`)
    if (!re.test(sm)) { notIn.push(f); continue }
    sm = sm.replace(re, (_, a, _d, c) => a + today + c)
  }
  if (sm !== smRaw) fs.writeFileSync('sitemap.xml', sm)
  console.log(`中身が変わった記事 ${changedFiles.length}枚 → sitemap の lastmod を ${today} に${notIn.length ? `（sitemap に無い：${notIn.join(', ')}）` : ''}`)
}

// 検算：表の枚数と、実際にカードが入っている記事の枚数を突き合わせる。
// 数が合わないまま公開すると、置いたつもりの面が空のまま何日も気づけない。
const has = files.filter((f) => /<!-- offer:(pack|toei) -->/.test(fs.readFileSync('articles/' + f, 'utf8')))
const n = { pack: 0, toei: 0 }
for (const f of Object.keys(TARGETS)) n[TARGETS[f].kind]++
console.log(`位置を決め直し ${moved} ／ その場で貼り直し ${replaced} ／ 新規 ${inserted} ／ 冒頭の案内 ${jumped} ／ 表 ${Object.keys(TARGETS).length}枚（pack ${n.pack}・toei ${n.toei}）／ 実際にカードのある記事 ${has.length}枚`)
if (has.length !== Object.keys(TARGETS).length) { console.error('★数が合わない'); process.exit(1) }
// 冒頭の案内を書いた面に実際に入っているか（目印ではなくリンクの実在で数える）
{
  const want = Object.entries(TARGETS).filter(([, t]) => t.jumpBefore)
  const miss = want.filter(([f, t]) => !fs.readFileSync('articles/' + f, 'utf8').includes(`href=\"#offer-${t.kind}\"`))
  if (miss.length) { console.error('★冒頭の案内が入っていない: ' + miss.map(([f]) => f).join(', ')); process.exit(1) }
  console.log(`冒頭の案内を置いた面 ${want.length}枚：${want.map(([f]) => f).join('・')}`)
}
