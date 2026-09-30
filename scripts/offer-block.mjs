// 有料の案内ブロック。記事・自治体別ページ・都営住宅の記事のすべてがここから出す。
//
// ★2026-09-03 なぜ1か所にするか
//   有料の案内は記事（手書き）と生成ページの両方にあり、以前は文言を2か所に写経していた。
//   中身の説明（何が入っているか）は /pack/ の表と同じ言葉でなければ「2つの説明」になる。
//   手書きの記事へは scripts/stamp-offers.mjs がこの出力を貼る。
//
// ★見た目の方針
//   白いカード＋上罫＋値段を大きく＋主ボタン。無料のコールアウト（.callout.point）とは別物に見せる。
//   以前は無料の注記と同じ見た目で出していたので「ただの注記」に見えて誰も押していなかった
//   （08-28〜09-02 来訪250・押した0）。煽らない（期限・残数・取り消し線は使わない）。
//   「買わなくてもできる」は消さず、ボタンの下に置く。
// 都営住宅の資料の抜粋は scripts/toei-nerai.mjs が資料と同じ行から書き出す（下の TOEI_PEEK の説明）。
// ★2026-09-13(2) 抜粋の表の右端（住宅名と同じ名前の町丁目の住宅侵入の件数）には、率ではない・所在地と一致しない場合がある・
//   出典（警視庁・CC BY 4.0）を抜粋の枠の外に必ず添える（TOEI_PEEK_NOTE）。抜粋の中は資料そのままなので書き足さない。
//   「4件以上」「5倍未満」「16回」も資料と同じ定数から受け取る（TOEI_FACTS）。手で書くと資料を作り直したときにずれる。
import { TOEI_PEEK, TOEI_PEEK_NOTE, TOEI_FACTS } from './toei-peek.mjs'
import { peekBox } from './peek-box.mjs'
// 政令市の市営住宅（商品の一覧と値段）の正典。ここに市名を書き写すと、市を足したときに入口だけ古いまま残る。
import { CITIES, PRICE as KOEI_PRICE } from './koei-lib.mjs'

export const PACK_PRICE = 500
export const TOEI_PRICE = 500

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── 冒頭に置く1行の案内 ────────────────────────────────────────────────────
// ★なぜ売り場カードと別に要るか（2026-09-17）
//   実測で、売り場カードは記事の3〜4画面目、買うボタンは4〜6画面目にあった。
//   カードごと上へ持ってくると「無料の答えより先に売り込みが来る」形になる。
//   ∴ **存在だけを1画面目で知らせて、本体は今の位置に置く**という分け方にする。
//   値段・募集回数はカードと同じ定数から取り、文面もここ1か所に置く。
//   置き場所（どの面のどこに入れるか）は呼ぶ側が決める。
// ★新しい class を作らない。既存の .callout.note だけで組む
//   （スコープ付きの定義を踏む事故と、cssの版番号の付け直しを避ける）。
// ★政令市の「申込先えらび」は市ごとに商品を分ける（A案・ユーザー裁定）。
//   読者の地域と商品を合わせるため、政令市をまとめた1つの資料にはしない。
//   文面はここ1か所。市ごとに違うのは「市名・回数・軸の呼び名・件数」だけなので、
//   生成器（scripts/koei-nerai.mjs）が数えた実数を facts で渡してもらう。
//   ★ここに市ごとの if を増やさない。増えたら facts に欄を足す。
// ★up は「そのページからルートまで」の相対。2026-09-19 まで市の無料ページ（/<市>/）から
//   up 無しで呼んでいて、リンクが /<市>/<市>/moushikomisaki/ になり**404だった**。
//   買う導線そのものが切れていたので、呼ぶ側は必ず up を渡すこと。
export function jumpKoei(f) {
  return `  <div class="callout note">
    <p><span class="tag">有料の一覧</span>このページの相場は全部無料です。そのうえで<strong>申込先を1つに決める</strong>ところまで要るなら、${f.boshu || '定期募集'}${f.rounds}回を名寄せして「毎回すいている申込先」を並べた一覧（<strong>${f.price}円</strong>・買い切り）があります。<a href="${f.up || ''}${f.key}/moushikomisaki/">中身と値段を見る →</a></p>
  </div>`
}

/** 政令市の申込先えらび。facts＝生成器が数えた実数、peek＝実物の冒頭（資料と同じ行から切る） */
/** 市ごとの売り場ページ（/<市>/moushikomisaki/）に置く本体。購入ボタンはここにしか無い。 */
export function offerKoeiSell({ facts: f, peek, up = '../../' } = {}) {
  return `  <div class="offer" id="offer-${f.key}" data-offer="${f.key}" data-sell="1">
  <span class="kicker">申込先を1つに決めるなら</span>
  <h3>${f.city}営住宅で「毎回すいている申込先」の一覧</h3>
  <p class="price"><b>${f.price}円</b><span>買い切り・税込。買った直後にそのまま画面で読めます（保存・印刷も可）</span></p>
  <p>ここまでが無料で読めるところです。このページで分かるのは「どの${f.axis}が空きやすいか」まで。<strong>1回だけ空いた住宅と、いつ見ても空いている住宅は区別できません</strong>。${f.boshu || '定期募集'}${f.rounds}回を申込先ごとに名寄せして、中央値で選り分けた一覧です。</p>
  <ul>
  <li><strong>毎回すいている申込先</strong>（${f.minN}${f.minU || '件'}以上の募集${f.minU === '回' ? 'で' : 'を'}観測できて、倍率の中央値が${f.suki}倍未満のものだけ<strong>${f.sukiN}件</strong>。1回だけ空いた住宅は入れていません）</li>
  <li>回によって当たりやすさが<strong>大きく動く申込先</strong>（${f.bureN}件。住宅を変えるより、出す回を変えるほうが効く相手）</li>
  <li>申込者ゼロが出た申込先と<strong>その回数</strong></li>
  <li>観測できた<strong>全申込先の索引${f.enoughN}件</strong>（倍率の中央値／最低／最高・観測件数・申込0の回数・のべ募集戸数・最後に募集された回）</li>
  </ul>
  <p class="fine">先に確認してください：これは<strong>過去の実測から作った目安</strong>で、次の募集の倍率を約束するものではありません。募集される住宅は回ごとに変わります。申込資格（${f.shikaku || '市内在住・収入基準など'}）は${f.guideOrg || f.city}の募集案内でご確認ください。<strong>対象は${f.only}</strong>で、${f.notIn || '都道府県営住宅や他市の市営住宅'}は入っていません。</p>
  <p class="buyrow"><button type="button" class="btn-primary" data-buy>${f.price}円で一覧を受け取る</button> <span class="buymsg" role="status"></span></p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>${f.axis}ごとの相場と混んでいる申込先の実名は、上に全部出しています。</p>
${peek ? peekBox('一覧の冒頭（抜粋）', peek) : ''}
  <p class="fine">クレジットカード決済（Stripe）。カード情報は当方を経由しません。Apple Pay・Google Pay にも対応しています（お使いの端末が対応している場合）。PayPay は近日対応予定です。お支払いが済むと、<strong>資料はそのまま画面に開きます</strong>（ダウンロードしてファイルを開き直す必要はありません。ファイルとして保存もできます）。<a href="${up}tokushoho/">特定商取引法に基づく表記</a>／<a href="${up}kiyaku/">利用規約</a></p>
  </div>`
}

/** 市の無料ページに置く案内。★2026-09-19 からリンクだけ（購入ボタンは売り場にしかない）。 */
export function offerKoeiLeaf({ facts: f, up = '../' } = {}) {
  return `  <div class="offer-link" id="offer-${f.key}">
  <p>ここまでが無料で読めるところです。このページで分かるのは「どの${f.axis}が空きやすいか」まで。<strong>1回だけ空いた住宅と、いつ見ても空いている住宅は区別できません</strong>。${f.boshu || '定期募集'}${f.rounds}回を申込先ごとに名寄せして中央値で選り分けた<a href="${up}${f.key}/moushikomisaki/"><strong>申込先ごとの一覧（${f.price}円・買い切り）</strong>があります</a>。</p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>${f.axis}ごとの相場と混んでいる申込先の実名は、上に全部出しています。</p>
  </div>`
}

export function jumpPack() {
  return `  <div class="callout note">
    <p><span class="tag">有料の手順書</span>制度の説明とお住まいの市区町村の基準は、このサイトで全部無料で読めます。そのうえで<strong>認定書をもらって過去5年分を取り戻すところまで</strong>進めるなら、手順書（<strong>${PACK_PRICE}円</strong>・買い切り）があります。<a href="/pack/">中身と値段を見る →</a></p>
  </div>`
}
export function jumpToei() {
  return `  <div class="callout note">
    <p><span class="tag">有料の一覧</span>このページの相場は全部無料です。そのうえで<strong>住宅名を1つに決める</strong>ところまで要るなら、定期募集${TOEI_FACTS.rounds}回を名寄せして<strong>当たりやすさと住みやすさが両方そろう申込先${TOEI_FACTS.gold}件</strong>を住宅名つきで並べた一覧（<strong>${TOEI_PRICE}円</strong>・買い切り）があります。<a href="/toei/">中身と値段を見る →</a></p>
  </div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// 撒き餌の面から有料の3系統へ行く入口（2026-09-28 ユーザー指示「導線をしっかり目立つとこに」）
//
// ★なぜ要るか
//   人が降りている面の上位は住民税非課税・生活保護・高額療養費（09-13〜09-27・日本からの入口860のうち
//   この3面で480＝56%）。そこから有料へ行く道は、本文の3画面目あたりにある .offer-link の段落1つだけで、
//   .offer-link には CSS が無く地の文と同じ見た目だった（tools/css-class-check.mjs が未定義と出していた）。
//   行き先も親の障害者控除だけで、都営・政令市の市営住宅へは1本も無かった。
//   ∴ 面の最初の答えのすぐ下（① の見出しの前）に、3系統の入口を1枚にまとめて置く。
// ★売り場は独自ページだけ（2026-09-19 ユーザー裁定）を崩さない
//   置くのはリンクだけ。買うボタン・抜粋・data-offer は置かない（buy.js に拾わせない／「売り場に着いた」段を
//   消さない）。押されると assets/ev.js が to_pack / to_toei を立て、着いた先で pack_view / toei_view /
//   <市>_view が立つ。段の定義（tools/buy-funnel-ships.mjs）はそのまま使える。
// ★見た目はトップの「このサイトで売っているもの」と同じ .offer.gold（有料の案内だけ金色＝艦隊で揃えた色）。
//   新しい class は作らない。.offer でも data-offer が無ければ buy.js は触らない。
// ★面ごとに違うのは「見出し・読者に向けた一言・並べる順」だけ（HUB_TOPIC）。商品の名前はここ1か所。
//   手書きの記事へは scripts/stamp-offers.mjs が貼り、生成ページは各生成器がこれを呼ぶ。
// ★短く保つ。最初は商品ごとに説明文を付けて、390px幅で高さ約1,000px（1.2画面ぶん）になり、
//   面の答え（① の表）を丸1画面以上押し下げていた（2026-09-28 実測）。中身の説明は売り場に任せ、
//   ここは「有料であること・値段・何の資料か・この面の読者に効く理由を1文」だけにする。
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_HOUSE = '公営住宅は<strong>収入が少ないほど家賃が下がる</strong>しくみで、壁になるのは倍率（抽選）です。'
const HUB_TOPIC = {
  // 住民税非課税の判定・早見表・線の記録
  hikazei: {
    order: ['pack', 'toei', 'koei'],
    head: '親の税金を取り戻す・家賃を下げるための資料',
    lead: '要介護の親御さんは、市区町村の認定で住民税の非課税の線が<strong>合計所得135万円まで上がる</strong>ことがあります。',
  },
  // 生活保護の計算・実質・申請
  seiho: {
    order: ['toei', 'koei', 'pack'],
    head: '家賃を下げる・家族の税金を取り戻すための資料',
    lead: LEAD_HOUSE,
  },
  // 高額療養費の上限・版の記録
  kogaku: {
    order: ['pack', 'toei', 'koei'],
    head: '医療費がかさむ世帯が、税金と家賃を軽くするための資料',
    lead: '医療費がかかっているのが要介護の親御さんなら、障害者控除で<strong>過去5年分の税金を取り戻せる</strong>ことがあります。',
  },
  // 公営住宅の収入基準・家賃・倍率（全国横断）。読者の地域は決められないので、地域を名札にして並べ、読者に選ばせる。
  koei: {
    order: ['toei', 'koei', 'pack'],
    head: '申し込む住宅を1つに決めるための資料',
    lead: '1回だけ空いた住宅と、<strong>いつ見ても空いている住宅</strong>は、募集回を横に並べないと見分けられません。',
  },
}
const HUB_PRICE = { pack: PACK_PRICE, toei: TOEI_PRICE, koei: KOEI_PRICE }
const hubItem = {
  pack: ({ up, local }) => `  <li><a href="${up}pack/${local ? `?code=${esc(local.code)}` : ''}"><strong>親の障害者控除、過去5年分をさかのぼって取り戻す手順書</strong></a>${local ? `（${esc(local.city)}版）` : ''}</li>`,
  toei: ({ up }) => `  <li><a href="${up}toei/"><strong>都営住宅で「毎回すいている申込先」の一覧</strong></a>（東京都）</li>`,
  koei: ({ up, local }) => {
    if (local) {
      const c = CITIES[local.koei]
      return `  <li><a href="${up}${c.key}/moushikomisaki/"><strong>${esc(c.city)}営住宅で「毎回すいている申込先」の一覧</strong></a></li>`
    }
    // ★2026-09-30 県営（埼玉・愛知）を足した。「市営住宅で…」の行に県を混ぜると嘘になるので、kind ごとに行を分ける。
    const line = (kind) => {
      const cs = Object.values(CITIES).filter((c) => (c.kind || '市営') === kind)
      // 大阪府が入ると「県営住宅で…大阪府」は不正確なので、府があれば「府県営」と書く（2026-10-01）
      const label = kind === '県営' && cs.some((c) => c.city.endsWith('府')) ? '府県営' : kind
      return cs.length ? `  <li>${label}住宅で「毎回すいている申込先」の一覧：${cs.map((c) => `<a href="${up}${c.key}/moushikomisaki/"><strong>${esc(c.city)}</strong></a>`).join('・')}</li>` : ''
    }
    return [line('市営'), line('県営')].filter(Boolean).join('\n')
  },
}

/**
 * 撒き餌の面に置く「有料の資料」の入口。topic … HUB_TOPIC のキー　up … ルートへの相対
 * local … 市区町村のページ（/hikazei/<5桁>/）用。{ city, code, pack, toei, koei }
 *   code＝6桁の団体コード　pack＝その市区町村の手順書がある　toei＝東京都　koei＝政令市のキー（CITIES）か null
 *   その市区町村で実際に買えるものだけを並べ、1つも無ければ何も出さない（買えない商品へ案内しない）。
 */
export function offerHub(topic, { up = '../', local = null } = {}) {
  const T = HUB_TOPIC[topic]
  if (!T) throw new Error(`offerHub: 知らない面です（${topic}）`)
  let { order, head, lead } = T
  if (local) {
    if (local.koei && !CITIES[local.koei]) throw new Error(`offerHub: 政令市のキーが違います（${local.koei}）`)
    order = order.filter((k) => (k === 'koei' ? !!local.koei : !!local[k]))
    if (!order.length) return ''
    const house = order.includes('toei') || order.includes('koei')
    head = `${[order.includes('pack') && '親の税金を取り戻す', house && '家賃を下げる'].filter(Boolean).join('・')}ための資料`
    // 一言は1文だけ。手順書が買える市区町村では、その市区町村の認定の話（この面の非課税の線に直に効く）を優先する。
    lead = order.includes('pack')
      ? `要介護の親御さんは、${esc(local.city)}の認定で住民税の非課税の線が<strong>合計所得135万円まで上がる</strong>ことがあります。`
      : LEAD_HOUSE
  }
  const prices = [...new Set(order.map((k) => HUB_PRICE[k]))]
  const kicker = prices.length === 1 ? `有料の資料・${order.length > 1 ? '各' : ''}${prices[0]}円（買い切り）` : '有料の資料（買い切り）'
  return `  <div class="offer gold" id="offer-hub">
  <span class="kicker">${kicker}</span>
  <h3>${head}</h3>
  <p>${lead}</p>
  <ul>
${order.map((k) => hubItem[k]({ up, local })).join('\n')}
  </ul>
  <p class="fine"><strong>買わなくても手続き・申し込みはできます。</strong>このページも、制度の説明も全部無料です。</p>
  </div>`
}

/** 親の障害者控除の手順書。name＝市区町村名（空なら一般） up＝ルートへの相対（記事・自治体別ページはどちらも '../'） */
export function offerPack({ name = '', up = '../' } = {}) {
  const whose = name ? `${esc(name)}の基準に合わせて` : 'お住まいの市区町村の基準に合わせて'
  return `  <div class="offer" id="offer-pack">
  <span class="kicker">手続きまで進めるなら</span>
  <h3>親の障害者控除、過去5年分をさかのぼって取り戻す手順書</h3>
  <p>ここまでが無料で読めるところです。ここから先＝認定書をもらい、還付額を試算し、更正の請求か還付申告を出すまでを、${whose}1つにまとめました。</p>
  <ul>
  <li>親のランク（日常生活自立度）が<strong>どの書類のどこに書いてあるか</strong>と、手元にないときの取り寄せ方（開示請求）</li>
  <li>所得税率5〜33%×障害者／特別障害者／同居特別障害者の<strong>還付額の試算表</strong>（年額と5年分）</li>
  <li>確定申告済みなら更正の請求・未申告なら還付申告、それぞれの<strong>必要書類と出し方</strong></li>
  <li>窓口での<strong>持ち物のチェックリスト</strong>と、「過去◯年分も」と伝えるべき理由</li>
  </ul>
  <p class="price"><b>${PACK_PRICE}円</b><span>買い切り・税込。買った直後にそのまま画面で読めます（印刷してそのまま窓口へ）</span></p>
  <p><a class="btn-primary" href="${up}pack/">${PACK_PRICE}円で手順書を受け取る&nbsp;→</a></p>
  <p class="fine"><strong>買わなくても手続きはできます。</strong>迷ったら先に<a href="${up}shogai-kojo/">自治体別の一覧</a>で、自分の街の基準だけ確かめてください。</p>
  </div>`
}

/** 都営住宅「毎回すいている申込先」の一覧。up＝ルートへの相対 */
export function offerToei({ up = '../' } = {}) {
  return `  <div class="offer" id="offer-toei">
  <span class="kicker">申込先を1つに決めるなら</span>
  <h3>都営住宅で「毎回すいている申込先」の住宅名つき一覧</h3>
  <p>ここまでが無料で読めるところです。このページで分かるのは「申込者ゼロが出たことがある」まで。<strong>1回だけ空いた住宅と、いつ見ても空いている住宅は区別できません</strong>。定期募集${TOEI_FACTS.rounds}回を住宅と募集区分ごとに名寄せして、中央値で選り分けた一覧です。</p>
  <ul>
  <li><strong>毎回すいている申込先</strong>（${TOEI_FACTS.minN}件以上の募集を観測できて、倍率の中央値が${TOEI_FACTS.suki}倍未満のものだけ。1回だけ空いた住宅は入れていません）</li>
  <li>回によって当たりやすさが<strong>大きく動く申込先</strong>（住宅を変えるより、出す回を変えるほうが効く相手）</li>
  <li>申込者ゼロが出た申込先と<strong>その回数</strong></li>
  <li>観測できた<strong>全申込先の索引</strong>（区市町・住宅名・募集区分・倍率の中央値／最低／最高・観測件数・エレベーター・建てられた年・間取りと広さ（㎡）・住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数）</li>
  </ul>
  <p class="price"><b>${TOEI_PRICE}円</b><span>買い切り・税込。買った直後にそのまま画面で読めます（保存・印刷も可）</span></p>
  <p><a class="btn-primary" href="${up}toei/">${TOEI_PRICE}円で一覧を受け取る&nbsp;→</a></p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>上の相場だけでも、どのあたりを狙うかは決められます。</p>
  </div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// 記事に埋め込む売り場（2026-09-08）
//
// ★なぜ「案内」から「売り場」に変えるか
//   14日で来訪440。/pack/ に着いた人は実質3人、/toei/ は8人、案内を押した人は各1人。
//   人が降りているのは記事のほうで、そこから別URLの売り場へ跳ばす設計が落ちている段だった。
//   ∴ 記事のページに売り場そのもの（実物の冒頭・値段・買うボタン）を置く。跳ばす段を無くす。
//
// ★2026-09-17 買うボタンを抜粋と長い注記より前に出した
//   390x844で実測したところ、買うボタンが**6.2画面目**にあった。09-08に「5.4画面にある時点で
//   埋め込んだ意味がほぼ消える」と判定して直したのに、同じ深さに戻っていた。
//   内訳＝値段からボタンまで2,000px。うち**抜粋は416pxだけ**で、残りは注記（住環境データの
//   出典説明など780px）がボタンの直前を埋めていた。
//   ∴ 順番を「値段 → 中身 → 買う前に要る注意 → ボタン → 実物の抜粋 → 長い注記」に。
//   ★買う前に要る注意（戻らない場合がある・東京都だけ・目安である）はボタンより前に残す。
//     後ろへ回してよいのは、出典や読み方の説明など**買う判断に要らない長い注記**だけ。
//   ★抜粋を後ろにしても隠したことにはならない（同じカードの中で、すぐ下に見える）。
//
// ★中身の決まり（[[paywall-teaser-note-style]]）
//   ・抜粋は実物（.dist/packs/*.html ・ .dist/toei-pack.html）をそのまま切る。宣伝用に書き直さない。
//   ・切った先の本文はこのHTMLに入れない（ソースを見ても続きは出てこない）。
//   ・偽の見本・期限・残数・取り消し線は使わない。
//   ・制度の説明と、買う前に知るべきこと（戻らない場合がある等）は無料のまま出す。
// ─────────────────────────────────────────────────────────────────────────────

// 実物からそのまま切り出した冒頭。記事に合う節を選ぶ。
// 市区町村名は、その市区町村が分かっているページでは実名、記事では伏せる（/pack/ と同じ扱い）。
const PACK_PEEK = {
  // ステップ1：ランクはどの書類に書いてあるか（/pack/ の見本と同じ節）
  rank: (m) => `    <h4 class="pk">ステップ1　親の「自立度ランク」を調べる</h4>
    <h4 class="pk">ランクはどこに書いてあるか</h4>
    <p>「認知症高齢者の日常生活自立度」と「障害高齢者の日常生活自立度（寝たきり度）」は、介護認定のときに作られた次の書類に記載されています。<b>介護保険証には書かれていません。</b></p>
    <div class="table-wrap"><table>
    <thead><tr><th>書類</th><th>どこを見るか</th><th>手元にないとき</th></tr></thead>
    <tbody><tr><th>主治医意見書</th><td>「3. 心身の状態に関する意見」の欄。<b>障害高齢者の日常生活自立度</b>（J1〜C2）と<b>認知症高齢者の日常生活自立度</b>（Ⅰ〜M）が並んで書かれています。</td><td>${m}の介護保険担当に<b>開示請求</b>をすれば写しがもらえます</td></tr></tbody>
    </table></div>
    <p>開示請求は無料か数百円で、1〜2週間かかることが多いです。確定申告の期限直前だと間に合わないことがあるので、先にここから始めてください。</p>`,
  // ステップ2：いくら戻るか（税率別の試算表。表は上3行で切っている）
  shisan: () => `    <h4 class="pk">ステップ2　いくら戻るか試算する</h4>
    <p>障害者控除は「税金がその額だけ安くなる」のではなく、<b>課税所得を減らす</b>しくみです。実際に戻る金額は <b>控除額 × 税率</b> で決まります。控除を受ける人（親御さん本人か、扶養しているあなた）の税率で見てください。</p>
    <div class="table-wrap"><table>
    <thead><tr><th>あなたの所得税率</th><th>障害者</th><th>特別障害者</th><th>同居特別障害者</th></tr></thead>
    <tbody>
    <tr><th>5%</th><td><b>39,500円</b><br><small>5年で 197,500円</small></td><td><b>50,000円</b><br><small>5年で 250,000円</small></td><td><b>90,500円</b><br><small>5年で 452,500円</small></td></tr>
    <tr><th>10%</th><td><b>53,000円</b><br><small>5年で 265,000円</small></td><td><b>70,000円</b><br><small>5年で 350,000円</small></td><td><b>128,000円</b><br><small>5年で 640,000円</small></td></tr>
    <tr><th>20%</th><td><b>80,000円</b><br><small>5年で 400,000円</small></td><td><b>110,000円</b><br><small>5年で 550,000円</small></td><td><b>203,000円</b><br><small>5年で 1,015,000円</small></td></tr>
    </tbody></table></div>
    <p>所得税＝控除額×所得税率、住民税＝控除額×10%で計算した目安です。復興特別所得税や他の控除との兼ね合いは含めていません。</p>`,
  // ステップ3：認定書をもらう（窓口で何を出すか）
  nintei: (m) => `    <h4 class="pk">ステップ3　認定書をもらう</h4>
    <p>${m}の窓口に「<b>障害者控除対象者認定書</b>を申請したい」と伝えます。申請書は窓口かウェブサイトで手に入ります。</p>
    <p><b>持っていくもの（一般的な例。事前に電話で確認してください）</b></p>
    <ul>
    <li>障害者控除対象者認定申請書（窓口またはサイトで入手）</li>
    <li>介護保険被保険者証</li>
    <li>申請する人の本人確認書類</li>
    <li>親御さん本人以外が申請する場合は、続柄が分かるものや委任状</li>
    </ul>
    <p><b>認定書は年ごとに出ます。</b>過去の年の分もさかのぼって申請できるのが普通です（自治体によって何年前まで出せるかが違うので、「過去◯年分もほしい」と最初に伝えてください）。判定の基準日は、その年の<b>12月31日</b>の状態です。</p>`,
  // ステップ4：過去の分をどう出すか
  torimodosu: () => `    <h4 class="pk">ステップ4　税金を取り戻す</h4>
    <p>認定書が手に入ったら、年ごとにやり方が分かれます。</p>
    <div class="table-wrap"><table>
    <thead><tr><th>状況</th><th>やること</th><th>期限</th></tr></thead>
    <tbody>
    <tr><th>今年の分（これから）</th><td>勤め先の<b>年末調整</b>で申告。扶養控除等申告書の障害者欄に記入し、認定書の写しを添える</td><td>年末調整のとき</td></tr>
    <tr><th>過去の年で<b>確定申告をしていない</b></th><td><b>還付申告</b>。その年の確定申告書を新たに提出する</td><td>その年の翌年1月1日から<b>5年</b></td></tr>
    <tr><th>過去の年で<b>確定申告をしている</b></th><td><b>更正の請求</b>。「更正の請求書」を提出する</td><td>申告期限から<b>5年</b></td></tr>
    </tbody></table></div>
    <p><b>5年ぶんまとめて出せます。</b>年ごとに書類を分けて、同時に提出してかまいません。税務署の窓口でも、e-Taxでも、郵送でも受け付けています。</p>`,
}

// 都営住宅の資料（.dist/toei-pack.html）の本体（2章）の冒頭。表は上3行で切っている。
// ★1章（全体像の数字）ではなく2章から切る。全体像の数字はカードの箇条書きに出しているので、
//   同じものを抜粋にも入れると、抜粋の枠に入りきる高さのうち表が1行も見えなくなる（09-08に実測）。
//   抜粋で見せるべきは「実物がどういう形をしているか」＝住宅名と倍率が並んだ表そのもの。
// ★2026-09-13 ここに手で切った抜粋を置くのをやめた。資料を作り直したのに抜粋だけ古いまま
//   （568件・8列。作り直した資料は590件・11列）記事12本に「実物の冒頭をそのまま」として残ったため。
//   いまは scripts/toei-nerai.mjs が資料と同じ見出し・同じ行から scripts/toei-peek.mjs を書き、
//   資料の本文と突き合わせてから出す。資料を作り直したら node scripts/stamp-offers.mjs で記事へ貼り直す。

// 抜粋の枠は scripts/peek-box.mjs（/toei/ の売り場ページからも使うので切り出した）。

/**
 * 記事の中に置く売り場（障害者控除の手順書）。
 *  code … 6桁の全国地方公共団体コード。分かっているページはボタンだけ、分からない記事は選択肢を出す。
 *  name … 市区町村名（例「東京都中央区」）。空なら伏せる。
 *  peek … 'rank' | 'shisan' | 'nintei' | 'torimodosu'（記事に合う節を選ぶ）
 *  up   … ルートへの相対
 */
// ★2026-09-19 ユーザー裁定＝【売り場は独自ページだけ。記事にバナーを置かない】
//   09-08 に記事へ埋めた購入カードを戻した。買うボタンは /pack/ /toei/ と市ごとの売り場にしかない。
//   理由は厳密な効果測定＝埋め込みだと「売り場に着いた」段が存在せず、カードが画面に入っただけ
//   （*_offer_seen）と、買う気で売り場に来た人を同じ列に入れることになる。
//   記事に残すのはリンクだけ。押されたら to_pack / to_toei が立ち、着いたら pack_view / toei_view が立つ。
export function offerPackLeaf({ code = '', name = '', peek = 'rank', up = '../' } = {}) {
  const whose = name ? `${esc(name)}の基準に合わせて` : 'お住まいの市区町村の基準に合わせて'
  return `  <div class="offer-link" id="offer-pack">
  <p>ここまでが無料で読めるところです。ここから先＝認定書をもらい、還付額を試算し、更正の請求か還付申告を出すまでを、${whose}1つにまとめた<a href="${up}pack/${code ? `?code=${esc(code)}` : ''}"><strong>手順書（${PACK_PRICE}円・買い切り）</strong>があります</a>。</p>
  <p class="fine"><strong>買わなくても手続きはできます。</strong>迷ったら先に<a href="${up}shogai-kojo/">自治体別の一覧</a>で、自分の街の基準だけ確かめてください。制度の説明は<a href="${up}articles/shogaisha-kojo-tax.html">こちらの記事</a>で全部無料です。</p>
  </div>`
}

/** 記事の中に置く売り場（都営住宅 申込先えらび）。up＝ルートへの相対 */
export function offerToeiLeaf({ up = '../' } = {}) {
  return `  <div class="offer-link" id="offer-toei">
  <p>申込書に書けるのは基本的に1回につき1つです。相場が分かっても、最後は住宅名を1つ選ぶことになります。ただし<strong>倍率が低い住宅だけを並べると、空いている理由がそのまま集まります</strong>（毎回すいている住宅の約6割は、エレベーターが無いか築${TOEI_FACTS.ageMed}年より古い）。定期募集${TOEI_FACTS.rounds}回を住宅と募集区分ごとに名寄せし、<strong>当たりやすさと住みやすさが両方そろう申込先${TOEI_FACTS.gold}件</strong>を先に並べた<a href="${up}toei/"><strong>住宅名つきの一覧（${TOEI_PRICE}円・買い切り）</strong>があります</a>。</p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>区市町ごとの相場は<a href="${up}toei/">無料の一覧</a>で全部公開しています。</p>
  </div>`
}

