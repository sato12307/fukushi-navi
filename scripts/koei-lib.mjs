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
    // ★全市単位（住宅を決めずに申し込む枠）は区が無い。区の相場には入れず「（全市単位）」として別に数える。
    axis: { label: '区', of: (r) => r.ku || (r.unit === '全市単位' ? '（全市単位）' : '（区なし）') },
    // ★募集区分（cat）は「単位×区分」を1つにした語（2026-10-04〜）。以前は高齢二人世帯向・高齢単身者用の
    //   「直接建設型」「借上型」が一般世帯向に混ざっていた（応募状況表の2ページ目を読んでいなかった）。
    keyOf: (r) => [r.ku, r.name, r.cat],
    cols: [['ku', '区'], ['name', '住宅'], ['cat', '募集区分'], ['tanshin', '単身可'], ['ev', 'エレベーターの印']],
    // 索引の追加の欄は、最後の回だけでなく観測した全部の回から決める。
    //   単身可 … 全部の回で印あり＝可／一部の回だけ＝回による（車いす用などで実際に揺れる）
    //   エレベーターの印 … 観測した印を全部（同じ団地が棟で分かれて募集された回だけ付く）
    extraOf: {
      tanshin: (v) => { const n = v.filter((x) => x.tanshin).length; return n === v.length ? '可' : n ? '回による' : '' },
      ev: (v) => [...new Set(v.map((x) => x.ev).filter(Boolean))].join('・'),
    },
    // ★有料資料の索引に「条件で絞る」を付ける（2026-10-04 第169回の0円検証：表末尾の合計と9回とも1件まで一致、
    //   入居者募集の記者発表の区分ごとの戸数とも9回とも一致、単身可の印と区分（単身者可／不可）の食い違い0）。
    //   エレベーターの印は9回で40件しか付かない（印の無い行＝表に書いていない）ので、絞り込みには使わない。
    filter: true,
    evNote: '横浜市の応募状況表には建てられた年が載っていません。エレベーターの印（〇各階に停止・□一部の階に停止・△踊り場に停止・×なし）は、同じ団地が棟で分かれて募集された回にだけ付いていて、印の無い申込先は「エレベーターあり」ではなく「表に書いていない」という意味です。',
    note: '同じ住宅でも募集区分が違えば別に数えています。募集区分は、資料の「単位」（住宅単位・高齢二人世帯向・高齢単身者用・特別空家など）と「区分」（直接建設型・借上型・単身者可・子育て世帯専用など）を組み合わせたものです（令和5年10月の募集から「事故住宅」は「特別空家」に改称されたので、同じ枠として数えています）。全市単位・行政区単位は住宅を決めずに申し込む枠で、それぞれ1つの申込先として数えています。単身可は資料の凡例の（※）印（令和4年4月の回だけは太字）を、エレベーターの印（〇□△×）は住宅名から切り出したものです。',
    check: {
      text: (F) => `${F.rounds}回とも、読み取った行の和が<strong>応募状況表の末尾の合計（募集戸数・応募者数）と1件まで一致</strong>しています。あわせて、同じ回の<strong>入居者募集の記者発表にある募集区分ごとの戸数</strong>（全市単位・一般世帯向・子育て世帯専用・特定目的住宅・特別空家など）とも${F.boshuMatched}回で一致しました。`,
    },
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
    // ★資料が持っている区分は「一般／特定目的」の2つだけで、特定目的の内訳
    //   （高齢者向・障害者向・ひとり親向など）は抽選結果の資料に載っていない。
    //   載っていないものは作れないが、**載っていないことは面に書く**。
    //   書かないと「特定目的は2倍だから狙い目」と読まれ、実際には申し込めない
    //   住戸で空いていただけ、ということが起きる（静岡で実際に起きていた型）。
    note: '同じ団地でも一般と特定目的は申込みの資格が別なので、別に数えています。ただし<strong>特定目的の内訳（高齢者向・障害者向・ひとり親世帯向など）は、神戸市が公表する抽選結果の資料に載っていません</strong>。この一覧の「特定目的」はそれらをまとめた数字なので、倍率が低くても<strong>ご自身が申し込める住戸とはかぎりません</strong>。どの住戸がどの区分かは、その回の募集案内でご確認ください。',
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
    //   比べる他市の件数も同じ。直書きの「横浜114件」が、読み取りを直した後（262件）も残っていた（2026-10-08）。
    thin: (F) => `相模原市営住宅は<strong>団地が39しかなく</strong>、他市より母数が小さい資料です。${MIN_N}件以上観測できた申込先は<strong>${F.enough}件</strong>で、${['kawasaki', 'kobe', 'yokohama'].map((k) => `${CITIES[k].short}${num(loadFrom(CITIES[k]).F.enough)}件`).join('・')}と比べるとはっきり薄いことを承知のうえでご覧ください。`,
  },
  // ── 県営（2026-09-30 ユーザー裁定「県営も売りに出そうか」）────────────────────
  // ★無料ページは scripts/kenei-build.mjs が作る（回×区分の倍率＝第154回 #171 の本体）。
  //   ∴ freePage: false。koei-nerai.mjs は売り場・購入後画面・有料資料だけを作り、/<key>/ と sitemap には触らない。
  // ★市営の文言をそのまま使うと嘘になる所（「市内在住」「都道府県営住宅は入っていません」「市が公開している」）は
  //   下の欄で上書きする（kind・pub・pubShort・doc・orgs・shikaku・notIn・guideOrg・freeTitle・wa・skipWhy）。
  'saitama-ken': {
    key: 'saitama-ken', city: '埼玉県', short: '埼玉県営', kind: '県営',
    src: '埼玉県住宅供給公社が定期募集の回ごとに公表する県営住宅の「申込状況」PDF',
    pub: '埼玉県住宅供給公社', pubShort: '公社', doc: '申込状況', orgs: '埼玉県・埼玉県住宅供給公社', guideOrg: '埼玉県住宅供給公社',
    shikaku: '収入基準など', notIn: 'さいたま市営などの市町村営住宅',
    freePage: false, freeTitle: '埼玉県営住宅の倍率（募集回ごと・住宅種別ごと）',
    // ★軸は住宅種別。申込みの資格そのものが違い、単身住宅は8回とも他の種別よりはっきり高い（無料ページの表）。
    axis: { label: '住宅種別', of: (r) => r.type },
    // ★間取りまで鍵に入れる。同じ団地でも住戸で倍率がまるで違う（政令市と同じ）。
    keyOf: (r) => [r.name, r.type, r.madori],
    cols: [['name', '住宅'], ['type', '住宅種別'], ['madori', '間取り']],
    note: '同じ住宅でも住宅種別（一般・子育て支援・高齢者・障がい者・単身など）と間取りが違えば別に数えています。住宅種別は申込みの資格そのものが違い、単身住宅はどの回もほかの種別よりはっきり倍率が高いので、混ぜると「毎回すいている」が崩れます。',
    calcNote: '公社の申込状況には倍率の列がありません（令和8年4月の回だけ、住宅種別ごとの合計に倍率が載っています）。倍率は<strong>申込件数÷募集戸数</strong>で当方が計算しています。',
    check: { text: () => `各回の申込状況のPDFを2通りの方法で読んで住宅種別ごとの数が一致することを確かめ、<strong>合計が公社の表の合計と一の位まで合う</strong>ことを確かめています（令和8年7月の回は申込状況の表に申込件数の合計しか無いため、募集戸数は公社の募集一覧表と突き合わせました）。` },
  },
  'aichi-ken': {
    key: 'aichi-ken', city: '愛知県', short: '愛知県営', kind: '県営',
    src: '愛知県住宅供給公社が定期募集の回ごとに公表する県営住宅の「抽選結果表」PDF',
    pub: '愛知県住宅供給公社', pubShort: '公社', doc: '抽選結果表', orgs: '愛知県・愛知県住宅供給公社', guideOrg: '愛知県住宅供給公社',
    shikaku: '収入基準など', notIn: '名古屋市営などの市町村営住宅',
    freePage: false, freeTitle: '愛知県営住宅の倍率（定期募集の回ごと・一般と福祉枠）',
    // ★回は「年度の第◯回」で数える（抽選結果表の題がそう書いている）。WA() の「令和◯年◯月」にすると、
    //   受付の月を当方が推定して書くことになる。
    wa: (r) => { const y = Number(r.slice(0, 4)) - 2018; return `令和${y === 1 ? '元' : y}年度第${r.slice(5)}回` },
    skipWhy: '文字の入っていない画像だけのPDFで、当方の読み取りが公表の合計と合わない地区があったため使っていません',
    // ★軸は管理事務所・支所（読者が住む場所で選ぶ。抽選結果表もこの単位で分かれている）。
    axis: { label: '管理事務所・支所', of: (r) => r.office },
    // ★抽選区分（一般／福祉枠）は鍵に入れる。同じ住宅・型式でも別の抽選で、倍率も別に出ている。
    keyOf: (r) => [r.office, r.name, r.type, r.cat],
    cols: [['office', '管理事務所・支所'], ['name', '住宅'], ['type', '型式'], ['cat', '抽選区分']],
    note: '同じ住宅でも型式（抽選結果表の住宅名のあとの記号）と抽選区分（一般・福祉枠）が違えば別に数えています。福祉枠は抽選結果表で（福祉）の印がついた行です。なお令和8年度第2回（2026年9月受付）から部屋ごとの募集に変わり、福祉枠に当たる世帯は一般世帯向住宅にも申し込めるようになりました（抽選番号が2つ）。これからの回は、一般と福祉枠の分かれ方が過去と同じにはなりません。',
    check: { text: (F) => `${F.rounds}回とも、読み取った行の和が、抽選結果表にある<strong>管理事務所・支所ごとの合計行と一の位まで合う</strong>ことを確かめています。${F.noNameRows ? `住宅名を読み取れなかった${F.noNameRows}行（${F.noNameKoho}戸）は、申込先ごとの集計に入れていません。` : ''}` },
  },
}

// ── 大阪府営（2026-10-01 ユーザー「粒度がいい狙い目の県を追加」）──────────────
// ★同日ユーザー「大阪府はあえての無料公開にしましょう」。∴ CITIES（＝売っている商品の表）から外した。
//   申込先ごとの一覧まで /osaka-fu/ に無料で出す（scripts/kenei-build.mjs の osaka()）。数え方は loadFrom(OSAKA_FU) で同じ。
// ★資料は府のサイトではなく、指定管理者3社のサイトに置かれたものだけを使う（府のサイトは無断転載不可。3社のサイトに禁止の定めは無い）。
// ★1行がおおむね住戸1戸なので、住戸では回をまたいで追えない（4回以上は26だけ）。∴ 鍵は団地×区分×寝室数（4回以上の募集で観測 547）。
//   団地は住宅コード（申込区分の先頭4桁）で見分ける。同じ名前で別の団地（高槻芝生・枚方三栗・松原一津屋）はコードを添える。
// ★付属情報は住戸ごとに違う（階・エレベーターの停止・家賃）ので、申込先ごとにまとめ直して持たせてある
//   （scratchpad/kenei-data/osaka/to-site.cjs）。無料ページの「住戸の条件ごとの倍率」は data/kenei-osaka.json（公開の集計）。
export const OSAKA_FU = {
  key: 'osaka-fu', city: '大阪府', short: '大阪府営', kind: '県営', byRounds: true, boshu: '総合募集',
  src: '大阪府営住宅の指定管理者（東急コミュニティー・穴吹ハウジングサービス・日本管財）が総合募集の回ごとに公表する「総合募集受付状況表」PDF',
  pub: '大阪府営住宅の指定管理者（東急コミュニティー・穴吹ハウジングサービス・日本管財）', pubShort: '指定管理者', doc: '総合募集受付状況表',
  orgs: '大阪府・大阪府営住宅の指定管理者', guideOrg: '大阪府',
  shikaku: '収入基準など', notIn: '大阪市営などの市町営住宅',
  freePage: false, freeTitle: '大阪府営住宅の倍率（募集回ごと・区分ごと・住戸の条件ごと）',
  axis: { label: '地域（管理センター）', of: (r) => r.center },
  keyOf: (r) => [r.danchi, r.cat, r.madori],
  cols: [['danchi', '団地'], ['cat', '区分'], ['madori', '寝室'], ['center', '地域'], ['city', '市区町村'], ['access', '最寄り駅'], ['ev', 'エレベーター'], ['built', '完成年度'], ['rent', '家賃（区分1〜4）']],
  note: '同じ団地でも区分（一般・福祉世帯向け・新婚子育て世帯向けなど）と寝室数が違えば別に数えています。区分は申込みの資格そのものが違い、寝室数が違えば世帯の人数の条件も倍率も違うためです。同じ名前で別の団地（高槻芝生・枚方三栗・松原一津屋）は住宅コードを添えて分けました。最寄り駅・エレベーター・完成年度・家賃は、同じ回の募集住宅一覧から住戸ごとに結び、申込先ごとにまとめたものです（家賃は区分1の最低額〜区分4の最高額。エレベーターは2階以上の住戸のうち、その階に止まる戸数）。',
  calcNote: '倍率は<strong>受付数÷募集戸数</strong>で当方が計算しています（受付状況表の倍率の列も同じ計算です）。受付数は申込の件数で、資格の審査は当選の後です。多子世帯（18歳未満の子を3人以上扶養）は抽選番号を2つ持つので、同じ倍率でも当たりやすさは世帯で違います。',
  check: { text: (F) => `${F.rounds}回・8つの管理センターの受付状況表を2通りの方法で読み、全行で値が一致しました。センターごとの表末尾の合計とは、回×センターの72本のうち70本が<strong>一の位まで一致</strong>しています。泉北（令和7年8月）は、無効になった申込1件を表の合計が0と数えている1件差です。布施（令和8年2月）は表に合計の行が無いので、同じ回の募集住宅一覧の戸数と申込区分コードの全件一致、府が公表した年度ごとの住宅別の応募状況との一致で確かめました。` },
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
  return loadFrom(C)
}

// ★CITIES（＝売っている商品の表）に入れずに、同じ数え方だけを使う入口（2026-10-01）。
//   三大都市圏の外の県営は申込先ごとの一覧まで無料で出す（ユーザー「反応を見たい」）。商品表に入れると
//   特商法の表記・有料の案内の一覧・KV への投入の対象に紛れ込むので、設定を直に渡してここで畳む。
export function loadFrom(C) {
  const key = C.key
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
      ...Object.fromEntries(C.cols.slice(C.keyOf(v[0]).length).map(([f]) => [f, C.extraOf && C.extraOf[f] ? C.extraOf[f](v) : (v[v.length - 1][f] || '')])),
      axis: C.axis.of(v[0]),
      n: v.length,
      rounds: new Set(v.map((x) => x.round)).size,
      med: med(b), min: Math.min(...b), max: Math.max(...b),
      koho: v.reduce((a, x) => a + x.koho, 0),
      zero: v.filter(isZero).length,
      zeroKoho: v.filter(isZero).reduce((a, x) => a + x.koho, 0),   // 応募0だった戸数（無料の一覧の「応募ゼロ」の欄）
      last: v.map((x) => x.round).sort().pop(),
    }
  }).sort((a, b2) => a.med - b2.med || b2.n - a.n)

  // ★byRounds（大阪府営＝1行がおおむね住戸1戸）は「何回の募集で観測できたか」で数える。件数で数えると、同じ回に同じ型が
  //   4戸出ただけで「4件以上」を満たし、「1回だけ空いた住宅は入れていない」という約束が破れる（2026-10-01）。
  const enough = houses.filter((h) => (C.byRounds ? h.rounds : h.n) >= MIN_N)
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
    boshuMatched: ledger.filter((l) => l.boshu && l.boshu.match).length,   // 横浜：入居者募集の記者発表の区分ごとの戸数とも一致した回
    explained: ledger.filter((l) => l.used && l.match === false && l.explained).length,
    noNameRows: ledger.reduce((a, l) => a + ((l.noName && l.noName.rows) || 0), 0),
    noNameKoho: ledger.reduce((a, l) => a + ((l.noName && l.noName.koho) || 0), 0),
  }
  const W = C.wa || WA                  // 回の呼び方（愛知県営だけ「令和◯年度第◯回」）
  const RANGE = `${W(F.from)}〜${W(F.to)}`
  const shownGroups = GROUPS.filter((g) => g.houses >= MIN_GROUP)

  return {
    C, raw, rows, ledger, ROUNDS, houses, enough, suki, buread, konde,
    GROUPS, shownGroups, BY_ROUND, F, RANGE,
    READ_AT: raw.updated, INDEX_URL: raw.index, SRC_NAME: C.src,
  }
}
