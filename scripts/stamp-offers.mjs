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
import { offerPackLeaf, offerToeiLeaf } from './offer-block.mjs'

// ★2026-09-08(2) 東京都以外の記事から都営の売り場を外した
//   商品は東京都の都営住宅だけを扱う。札幌市・福岡市などの記事や、全国横断の記事に置くと
//   読者の地域と商品が合わない。カードに「東京都だけ」と書いてあっても、棚として無関係。
//   ∴ toei を置くのは「東京と明示できる記事」だけにする（toei-* 11枚＋koei-tokyo）。
//   外したのは koei-* 16枚（道府県別11＋全国横断5）。全国横断のもの
//   （danchi-ranking / hairiyasui / jutaku-bairitsu / shunyu-kijun / yachin-keisan）は
//   読者がどこの人か決められないので、迷ったら外す側に倒した。

// 商品につなぐ一言。記事の答えと商品の関係を、その記事の言葉で書く（無料の本文）。
const LEAD_TOEI_TOKYO = '上の相場で「どのあたりが空いているか」までは分かります。申込書に書けるのは基本的に1回につき1つなので、最後は住宅名を1つに決めることになります。そこだけは住宅ごとの実測が要ります。'

// kind … pack / toei　peek … 抜粋にどの節を使うか　before … 目印が無い記事の挿入位置（この直前に入れる）
const TARGETS = {
  // ── 障害者控除・税・生活保護・高額療養費・医療費助成 → 親の障害者控除の手順書 ──────
  'shogaisha-kojo-tax.html': {
    kind: 'pack', peek: 'torimodosu',
    lead: '上の「さかのぼって申告できる場合があります」を、自分の親御さんに当てはめて確かめ、実際に出すところまでをまとめたものがあります。',
  },
  'juminzei-hikazei-check.html': {
    kind: 'pack', peek: 'rank',
    before: /  <h2>③ 非課税世帯になると受けられる主なメリット<\/h2>/,
    lead: '判定の欄にあった「障害者・ひとり親・寡婦・未成年者」（合計所得135万円まで非課税）の<strong>障害者は、手帳を持っている人だけではありません</strong>。要介護認定を受けている親御さんは、市区町村の認定を受ければ障害者に当たることがあり、所得税・住民税の障害者控除も同時に使えます。申告していなかった分は<strong>過去5年分までさかのぼれます</strong>（制度の説明は<a href="shogaisha-kojo-tax.html">障害者控除の記事</a>に無料で置いています）。',
  },
  'kougaku-ryouyouhi-2026.html': {
    kind: 'pack', peek: 'rank',
    before: /  <h2>③ 窓口で大金を払わないために<\/h2>/,
    lead: '重い医療費が<strong>要介護認定を受けている親御さん</strong>の分なら、税のほうでも取り戻せることがあります。障害者手帳がなくても、市区町村の認定を受ければ障害者控除の対象になり、申告していなかった分は<strong>過去5年分までさかのぼれます</strong>（<a href="shogaisha-kojo-tax.html">制度の説明</a>と<a href="../shogai-kojo/">自治体別の認定基準</a>は無料です）。',
  },
  'seikatsuhogo-keisanki.html': {
    kind: 'pack', peek: 'shisan',
    before: /  <h2>④ よくある誤解と、申請前に知っておくこと<\/h2>/,
    lead: '申請を考える前に、<strong>使い切れていない控除</strong>がないかも確かめてください。要介護認定を受けている親御さんは、障害者手帳がなくても市区町村の認定を受ければ障害者控除の対象になることがあり、過去5年分までさかのぼって税金を取り戻せます。<strong>すでに保護を受けている世帯は課税されていないことが多く、その場合に戻るお金はありません</strong>——親御さんやご家族に納税している人がいる場合の話です。',
  },
  'jichitai-transport-medical.html': {
    kind: 'pack', peek: 'nintei',
    before: /  <h2>③ 引っ越し・転居で「受けられる福祉」は変わる<\/h2>/,
    lead: '交通や医療費の助成と同じで、<strong>障害者控除の認定基準も自治体ごとに違います</strong>。障害者手帳がなくても、要介護認定を受けている親御さんは市区町村の認定で対象になることがあります（→ <a href="../shogai-kojo/">自治体別の認定基準の一覧・無料</a>）。',
  },

  // ── 都営住宅・公営住宅 → 都営住宅の申込先えらび ───────────────────────────────
  // 東京の記事（目印はすでに入っている）
  'toei-adachi.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-fuchu.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-hachioji.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-higashimurayama.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-itabashi.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-katsushika.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-kiyose.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-kodaira.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-koto.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-machida.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'toei-nerima.html': { kind: 'toei', lead: LEAD_TOEI_TOKYO },
  'koei-tokyo.html': { kind: 'toei', before: /  <div class="cta-box" data-aff="hikkoshi"/, lead: LEAD_TOEI_TOKYO },
  // 東京以外の公営住宅の記事（koei-chiba / fukuoka / kawasaki / kobe / kyoto / nagoya / osaka /
  // saitama / sapporo / sendai / yokohama）と、全国横断の記事（koei-danchi-ranking /
  // hairiyasui / jutaku-bairitsu / shunyu-kijun / yachin-keisan）には置かない。2026-09-08(2)
}

const block = (t) => {
  const card = t.kind === 'pack' ? offerPackLeaf({ peek: t.peek, up: '../' }) : offerToeiLeaf({ up: '../' })
  const lead = t.lead ? `  <p class="offer-lead">${t.lead}</p>\n` : ''
  return `<!-- offer:${t.kind} -->\n${lead}${card}\n  <!-- /offer -->`
}

const files = fs.readdirSync('articles').filter((f) => f.endsWith('.html'))
const missing = Object.keys(TARGETS).filter((f) => !files.includes(f))
if (missing.length) { console.error('表にあるのに記事が無い:', missing.join(', ')); process.exit(1) }

let replaced = 0, inserted = 0
const failed = []
for (const f of files) {
  const t = TARGETS[f]
  if (!t) continue
  const p = 'articles/' + f
  const raw = fs.readFileSync(p, 'utf8')
  const crlf = raw.includes('\r\n')
  let s = raw.replace(/\r\n/g, '\n')
  const marked = /<!-- offer:(?:pack|toei) -->[\s\S]*?<!-- \/offer -->/
  if (marked.test(s)) { s = s.replace(marked, block(t)); replaced++ }
  else if (t.before && t.before.test(s)) { s = s.replace(t.before, (m) => `${block(t)}\n\n${m}`); inserted++ }
  else { failed.push(f); continue }
  fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s)
}
if (failed.length) { console.error('位置が見つからない:', failed.join(', ')); process.exit(1) }

// 検算：表の枚数と、実際にカードが入っている記事の枚数を突き合わせる。
// 数が合わないまま公開すると、置いたつもりの面が空のまま何日も気づけない。
const has = files.filter((f) => /<!-- offer:(pack|toei) -->/.test(fs.readFileSync('articles/' + f, 'utf8')))
const n = { pack: 0, toei: 0 }
for (const f of Object.keys(TARGETS)) n[TARGETS[f].kind]++
console.log(`貼り直し ${replaced} ／ 新規 ${inserted} ／ 表 ${Object.keys(TARGETS).length}枚（pack ${n.pack}・toei ${n.toei}）／ 実際にカードのある記事 ${has.length}枚`)
if (has.length !== Object.keys(TARGETS).length) { console.error('★数が合わない'); process.exit(1) }
