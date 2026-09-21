// ─────────────────────────────────────────────────────────────────────────────
// toei-nerai.mjs — 都営住宅「申込先えらび」の無料ページ /toei/ と有料資料を作る。
//
// ★何を売って、何を売らないか
//   売らない: 申込資格・収入基準・制度の説明。無料記事で全部出している。
//             どの住宅が何回あまったか（募集割れ一覧）も無料でCSV配布済み。
//   売る:     募集回をまたいで名寄せしたうえでの「毎回すいている住宅はどこか」。
//             1回だけ空いた住宅と、いつ見ても空いている住宅は意思決定がまるで違う。
//             公表資料は回ごとのPDFしかなく、横に並べた集計はどこにも無い。
//
// ★読み取りと名寄せは scripts/toei-lib.mjs に移した（2026-09-17）。
//   区市町別ページを作る scripts/toei-machi.mjs が同じ読み取りを要るため。
//   出典側の規約・読み取りの限界・町丁目台帳の使い方は、すべてそちらの先頭に書いてある。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { peekBox } from './peek-box.mjs'
import { kanryoScript } from './kanryo-script.mjs'
import {
  ROOT,
  PRICE,
  MIN_N,
  SUKI,
  MIN_CITY,
  BURE,
  TOWN_MAX_CHOME,
  TOWN_MAX_SETAI,
  SRC,
  JIKO,
  SRC_JSON,
  raw,
  READ_AT,
  ENV_JSON,
  CITYDICT,
  ENV,
  looseKey,
  KANSUJI,
  kan,
  placeKey,
  houseKey,
  AREA_BY_KEY,
  TOWN_BY_KEY,
  WARDS,
  STEMS,
  STEM_OF,
  stripStem,
  wardsNamed,
  envByKey,
  hasNum,
  envOf,
  SPILL,
  fixSpill,
  LEDGER,
  rows,
  ROUNDS,
  med,
  r1,
  mode,
  by,
  houses,
  enough,
  suki,
  sukiIppan,
  AGE_MED,
  gold,
  sukiOff,
  buread,
  konde,
  ALL_MED,
  CITIES,
  byCity,
  cut,
  eraBand,
  groupMed,
  cuts,
  F,
  era,
  RANGE,
} from './toei-lib.mjs'

// ★書き出しは最後にまとめて行う（flush）。途中の突き合わせ（記事の抜粋・トップのカード・sitemap）で
//   止まったときに、無料ページだけ新しくて資料や抜粋が古い、という半端な状態をディスクに残さないため。
const pending = []
const write = (rel, html) => { pending.push([rel, html]) }
const flush = () => {
  for (const [rel, html] of pending) {
    const p = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, html)
  }
}
const die = (msg) => { console.error(msg); console.error('何も書き出していません。'); process.exit(1) }
const num = (x) => x.toLocaleString('ja-JP')

// 条件別の表の下に出す注記。件数は toei-lib が数え、文章はここで作る。
const cutNote = (c) => c.out
  ? `この表の母数は${num(c.base)}件です。${esc(c.label)}が読み取れなかった行${c.min ? `と、募集件数が${c.min}件に満たない区分` : ''}の${num(c.out)}件${c.outLedger ? `（うち、区を台帳で確定した行 ${num(c.outLedger)}件）` : ''}は入っていません。${
    c.outLedger && c.outLedgerUnread === c.outLedger && c.outLedger === LEDGER.recovered
      ? `区を台帳で確定した行は、もともと行頭に区市町が無かった行で、読み取りの段階で${esc(c.label)}の欄が取れていないため、この表にはすべて入っていません。`
      : c.outLedgerUnread
        ? `区を台帳で確定した行のうち${num(c.outLedgerUnread)}件は、読み取りの段階で${esc(c.label)}の欄が取れていない行です。`
        : ''}`
  : `この表の母数は${num(c.base)}件（集計に使った全件）です。`

// ── 住環境の数字の欄と注記（無料ページと有料資料で同じ文面を使う）──────────────
//   ★件数は率ではない。世帯の多い町ほど大きく出る。住宅名と同じ名前の町丁目の数字であって、
//     建物の所在地を確かめたものではない。この2つを必ず注記に書く。
//   ★burglary が null は「公表なし」。0件と書かない。
const WIN_TXT = `${ENV.window.from}〜${ENV.window.to}年の${ENV.window.n}年間`
const tsu = (n) => (n < 10 ? `${n}つ` : `${n}`)   // 7つの丁目／10の丁目
// free＝無料ページ①の表（見つからない・決められないを文で書く）。有料資料と抜粋は短い書き方。
const envCell = (e, withWin, free = false) => {
  if (!e) return free ? NO_ENV_FREE : '—'
  if (e.level === 'ambiguous') {
    return free
      ? `同じ区に「${esc(e.label)}」が${tsu(e.count)}あり、どれか決められません（数字なし）`
      : `${esc(e.label)}（同じ区に同じ名前が${tsu(e.count)}あり、決められないため数字なし）`
  }
  if (e.level === 'wide') return `${esc(e.label)}（町が広いため数字なし・${tsu(e.chome)}の${e.unit}）`
  const where = e.level === 'area'
    ? `<a href="${esc(ENV.site + e.path)}">${esc(e.label)}</a>`
    : `${esc(e.label)}（町全体・${tsu(e.chome)}の${e.unit}）`
  const setai = Number.isFinite(e.setai) ? `世帯${num(e.setai)}` : '世帯数なし'
  const b = e.burglary == null ? '住宅侵入は公表なし' : `住宅侵入${num(e.burglary)}件${withWin ? `（${WIN_TXT}）` : ''}`
  return `${where}：${setai}・${b}`
}
// 同じ区に同じ名前の町丁目が見つからない住宅の書き方（無料ページ①の表）。「—」だけだと空欄の漏れに見える。
const NO_ENV_FREE = '同じ区に同じ名前の町丁目は見つかりません（数字なし）'
const envNote = (where) => [
  `「住宅と同じ名前の町丁目」の欄は、姉妹サイト<a href="${esc(ENV.site)}/">住環境データ東京</a>が町丁目ごとにまとめた数字です。住宅侵入（空き巣・忍込み・居空き）は${WIN_TXT}の<strong>件数そのもので、率ではありません</strong>。世帯の多い町ほど件数は大きく出ます。<strong>0件は被害がなかったという意味ではありません</strong>（認知件数は、警察に届出があって初めて数えられます）。リンク先の町丁目ページに大きく出ている住宅侵入の件数は、${ENV.window.from}年より前の年も含めた合計なので、ここの${ENV.window.n}年間の件数より大きいことがあります（どちらも同じ警視庁の公表資料から数えたものです）。`,
  `住宅名と同じ名前の町丁目の数字で、<strong>建物の所在地がその町丁目と一致しない場合があります</strong>（町の名前が付いた住宅でも、建物が隣の町丁目に建っていることがあります）。住宅名の頭に区市町名が付いているもの（府中美好町一丁目 など）は、頭の区市町名を外した町丁目名で引いています（北区・港区のように区名が1文字のものは外していません）。町の名前までしか一致しないもの（住宅名に丁目が付いていないもの など）は、<strong>その町の丁目が${TOWN_MAX_CHOME}つ以下で、かつ町全体の世帯が${num(TOWN_MAX_SETAI)}未満のときだけ</strong>町全体の合計を出し、「（町全体・2つの丁目）」のように何丁目ぶんの合計かを添えています。町が大きいほど、町全体の数字は住宅のまわりの様子を表しにくくなるためです。<strong>この線を超える町は数字を出さず</strong>、「（町が広いため数字なし・7つの丁目）」のように丁目の数を書いています（索引${num(F.enough)}件のうち、町全体の合計を出したもの${num(F.envTown)}件・町が広いため数字なしのもの${num(F.envWide)}件）。同じ区に同じ名前の町丁目が見つからないものは数字を付けていません（${where === 'free' ? `①の表では「${NO_ENV_FREE}」と書いています` : '表では「—」'}）。同じ区に同じ名前の町丁目が2つ以上あってどれか決められないものも数字を付けず、見つからないものと分けて「決められません」と書いています（索引のうち${num(F.envAmb)}件）。住宅侵入の件数が公表されていない町丁目（町全体の場合は、公表の無い町丁目を1つでも含む町）は件数を書いていません（0件という意味ではありません）。`,
  `倍率表の行のうち、行頭に区市町が無かった${num(LEDGER.untrusted)}行は、区市町を確かめられないため以前は集計から外していました。このうち<strong>住宅名が東京都内でただ1つの区にだけある町丁目名だった${num(LEDGER.recovered)}行は、その区の住宅として集計に含めています</strong>（住環境データ東京の町丁目台帳で区を確定。${LEDGER.recoveredStem ? `うち${num(LEDGER.recoveredStem)}行は、住宅名の頭に付いた区市町名を外すと、その区市町にだけある町丁目名になるものです。また` : 'うち'}${num(LEDGER.moved)}行は、読み取りで前の行から引き継いでいた区市町とは別の区でした）。2つ以上の区にある名前の${num(LEDGER.multi)}行と、台帳に無い名前の${num(LEDGER.none)}行は、今までどおり含めていません。行頭に区市町があった行で、住宅名の町丁目が別の1つの区にだけあったものは${num(LEDGER.conflict)}行${LEDGER.conflict ? 'で、区は書き換えていません' : 'でした'}。`,
  `住環境の数字の出典＝警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（東京都オープンデータ利用規約に基づき<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" rel="license">クリエイティブ・コモンズ・ライセンス 表示4.0国際（CC BY 4.0）</a>のもとで提供）と、総務省統計局「令和2年国勢調査 小地域集計」（世帯数）。住環境データ東京が町丁目ごとに集計したものを、当サイトが住宅名と突き合わせて加工し掲載しています。警視庁・総務省統計局が作成したものではありません。`,
  ...(SPILL.length ? [`行頭の区市町名の末尾が次の欄（申込区分（人数））にはみ出して読み取られていた${num(SPILL.length)}行は、つなげた名前が台帳の区市町名にちょうど1つ一致したため、その区市町の行として数えています（例：「${esc(SPILL[0].city)}」＋「${esc(SPILL[0].head)}」→ ${esc(SPILL[0].ward)}）。`] : []),
].map((s) => `  <li>${s}</li>`).join('\n')

// ── 無料ページ /toei/ ────────────────────────────────────────────────────────
// ここで出すのは「相場」まで。住宅の実名つきの狙い目一覧が有料の中身。
const cityRows = byCity.map((c) => `<tr><td>${esc(c.city)}</td><td class="num">${c.n}</td><td class="num">${r1(c.med)}倍</td><td class="num">${c.suki}</td></tr>`).join('\n')
const kondeRows = konde.slice(0, 10).map((h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}倍</td><td class="num">${h.n}</td></tr>\n<tr><td colspan="5" style="font-size:.88rem"><span style="color:#566">住宅と同じ名前の町丁目</span>　${envCell(h.env, true, true)}</td></tr>`).join('\n')
const cutBlocks = cuts.map((c) => `  <h3>${esc(c.label)}</h3>
  <p class="note">${cutNote(c)}</p>
  <div class="table-wrap"><table><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>
${c.groups.map((g) => `  <tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}
  </tbody></table></div>`).join('\n\n')

write('toei/index.html', page({
  title: `都営住宅で毎回すいている住宅はどこか｜${F.rounds}回の募集を横に並べた実測｜フクシル`,
  desc: `都営住宅は倍率が高いと言われますが、募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せすると、${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は倍率の中央値が${SUKI}倍未満でした。全体の中央値は${F.allMed}倍です。区市町ごとの相場を無料で公開し、住宅名つきの狙い目一覧を${PRICE}円で配布しています。`,
  canonical: '/toei/', depth: 1,
  body: `  <h1>都営住宅で「毎回すいている住宅」はどこか<br><small>${RANGE}の定期募集${F.rounds}回を、住宅ごとに横に並べた</small></h1>

  <p class="lead">都営住宅は「何十倍で当たらない」と言われます。実際、いちばん混んでいる住宅の倍率の中央値は${r1(konde[0].med)}倍です。
  ところが同じデータを住宅ごとに名寄せすると、<strong>観測できた${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は中央値が${SUKI}倍未満</strong>でした。全体の中央値は<strong>${F.allMed}倍</strong>です。</p>

  <div class="callout point"><p><span class="tag">なぜどこにも無いのか</span>
  倍率表は募集回ごとのPDFでしか公表されておらず、<strong>回をまたいで同じ住宅を追いかけた集計は公表されていません</strong>。
  そのため「たまたま1回だけ空いた住宅」と「いつ見ても空いている住宅」が区別できず、両方まとめて「倍率が高い」と語られています。
  ここでは${RANGE}の${F.rounds}回ぶん、${num(F.rows)}件の募集を住宅名で名寄せして数えました。</p></div>

  <p class="cta-row"><a class="btn-primary" href="#kau">住宅名つきの一覧を${PRICE}円で受け取る&nbsp;→</a> <span class="cta-note">①〜③の相場は無料で、そのまま下に続きます</span></p>

  <h2>① 混んでいる住宅（実名・無料）</h2>
  <p>よく引き合いに出されるのはこちらです。${MIN_N}件以上の募集が観測できた申込先のうち、倍率の中央値が高い順。</p>
  <p class="note">同じ建物でも募集区分が違えば別の申込先として数えています。「世帯向」と「病死等があった住宅」では倍率がまるで違うためです。</p>
  <p class="note">各住宅の下の行は、住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数です（姉妹サイト 住環境データ東京）。読み方と出典はページ末尾の「出典と、この数字の限界」にまとめました。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">倍率の中央値</th><th class="num">観測した募集件数</th></tr></thead><tbody>
${kondeRows}
  </tbody></table></div>

  <h2>② 区市町ごとの相場（無料）</h2>
  <p>${MIN_N}件以上観測できた申込先が${MIN_CITY}件以上ある${byCity.length}区市町。病死等があった住宅は除いてあります。「すいている数」は、中央値が${SUKI}倍未満だった申込先の件数です。</p>
  <div class="table-wrap"><table><thead><tr><th>区市町</th><th class="num">対象の申込先</th><th class="num">倍率の中央値</th><th class="num">すいている数</th></tr></thead><tbody>
${cityRows}
  </tbody></table></div>

  <h2>③ 条件を1つ変えると倍率はどう動くか（無料）</h2>
  <p>募集${num(F.rows)}件を条件ごとに分けて、倍率の中央値を出したものです。何をあきらめると何倍ぶん軽くなるかの目安になります。その条件が読み取れなかった行は、その表からだけ外しています（表ごとの母数は各表の上に書きました）。</p>
${cutBlocks}

  <div class="callout point"><p><span class="tag">手続きまで進めるなら</span>
  ここまでが無料で読めるところです。<strong>買わなくても申し込みはできます。</strong>
  上の相場だけでも、どのあたりを狙うかは決められます。</p></div>

  <h2 id="kau">④ 住宅名つきの一覧（${PRICE}円）</h2>
  <div class="offer">
  <p>申込書に書けるのは基本的に<strong>1回につき1つ</strong>です。相場が分かっても、最後は住宅名を1つ選ぶことになります。
  そこを決めるための一覧を用意しました。</p>
  <div class="callout warn"><p><span class="tag">先に知っておいてください</span>
  <strong>倍率が低い申込先だけを並べると、空いている理由がそのまま集まります。</strong>
  実際に数えると、毎回すいている${num(F.sukiIppan)}件のうち<strong>${F.sukiOffPct}%（${num(F.sukiOff)}件）は、エレベーターが無いか、築${F.ageMed}年より古い</strong>住宅でした。
  エレベーターがある割合は<strong>すいている側${F.sukiEvPct}%に対して混んでいる側${F.kondeEvPct}%</strong>、
  多摩の市町村が占める割合は<strong>すいている側${F.sukiTamaPct}%に対して混んでいる側${F.kondeTamaPct}%</strong>。
  安く見える申込先は、設備と立地のどちらかを引き受けているということです。</p></div>

  <p>そこで一覧は、<strong>当たりやすさだけでなく住みやすさの条件も満たすものを先に</strong>並べました。</p>
  <ul>
  <li><strong>当たりやすさと住みやすさが両方そろう申込先 ${num(F.gold)}件</strong>。
    倍率の中央値が${SUKI}倍未満で、<strong>エレベーターがあり</strong>、<strong>築${F.ageMed}年以下</strong>（観測できた${num(F.enough)}件の中央値）のものです。
    ${F.goldCities}の区市町にまたがり、倍率の中央値${F.goldMed}倍・築年数の中央値${F.goldAgeMed}年。
    ${MIN_N}件以上観測できたものだけなので、<strong>1回だけ空いた住宅は入っていません</strong>——ここが自分で集計すると一番外しやすいところです。</li>
  <li><strong>すいてはいるが、条件を承知のうえで選ぶ申込先 ${num(F.sukiOff)}件</strong>を別掲。
    悪い住宅という意味ではありません（1階を選べるなら階段は問題になりませんし、古い住宅は都心に多く立地では有利なことがあります）。
    <strong>何を引き受けるのかが分かったうえで選べるように</strong>分けています。</li>
  <li><strong>回によって当たりやすさが大きく動く申込先 ${F.buread}件</strong>。最高と最低が${BURE}倍以上ひらいた住宅です。住宅を変えるのではなく<strong>出す回を変える</strong>ほうが効く相手が分かります。</li>
  <li><strong>申込者ゼロが出た申込先 ${F.zeroHouses}件</strong>と、その回数。</li>
  <li>観測できた<strong>${num(F.enough)}件すべての索引</strong>（区市町・住宅名・募集区分・倍率の中央値／最低／最高・観測件数・エレベーター・建てられた年と築年数・住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数）。</li>
  <li>「${JIKO}」${F.suki - F.sukiIppan}件は<strong>別掲</strong>。すいている側にはこの区分が集まるので、知らずに選ぶことがないよう分けました。</li>
  </ul>

  <p class="price"><b>${PRICE}円</b><span>買い切り・税込。HTMLファイル1つ、印刷可</span></p>
  <p><button id="buy" class="btn-primary" type="button">${PRICE}円で一覧を受け取る</button></p>
  <p class="fine">クレジットカード決済（Stripe）。カード情報は当方を経由しません。Apple Pay・Google Pay にも対応しています（お使いの端末が対応している場合）。PayPay は近日対応予定です。お支払い後すぐ画面で開けます（ファイルとして保存もできます）。<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../kiyaku/">利用規約</a></p>
  <p id="msg" class="note"></p>
  <p class="fine"><strong>買わなくても申し込みはできます。</strong>上の相場だけでも、どのあたりを狙うかは決められます。</p>
<!-- TOEI:PEEK -->
  </div>

  <div class="callout warn"><p><span class="tag">先に読んでください</span>
  これは<strong>過去の実測から作った目安</strong>で、次の募集の倍率を約束するものではありません。募集される住宅は回ごとに変わり、
  ここに載っている住宅が次回も募集されるとは限りません。<strong>申込資格（都内在住・収入基準など）を満たすかどうかは別の話</strong>で、
  そちらは<a href="../articles/koei-tokyo.html">無料の記事</a>と東京都・JKK東京の募集案内でご確認ください。</p></div>

  <p class="note">お読みください：<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../kiyaku/">利用規約</a>。
  当サイトは東京都・JKK東京とは関係のない個人が運営しています。</p>

  <div class="sources">
  <h2>出典と、この数字の限界</h2>
  <ul>
  <li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
  <li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rowsHead)}行</strong>と、下に書いた方法で<strong>住宅名から区を確定できた${num(F.rowsLedger)}行</strong>の、合わせて${num(F.rows)}行を使っています。したがってここに出ていない住宅も多くあります。</li>
${envNote('free')}
  <li>「観測した募集件数」は募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</li>
  <li>当方が公表表を転載・改変したものではなく、<strong>公表された数値から当方が計算した指標</strong>（中央値・最低・最高・件数）を掲載しています。</li>
  </ul>
  <p class="disclaimer">掲載内容は上記の公表資料を ${READ_AT} 時点で読み取ったもので、当選を保証するものではありません。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related"><a href="../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>
(function(){
  var btn=document.getElementById('buy'), msg=document.getElementById('msg');
  if(!btn) return;
  btn.addEventListener('click', function(){
    if(window.__ev) window.__ev('toei_buy');
    btn.disabled=true; msg.textContent='決済ページへ移動します…';
    fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product:'toei'})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d && d.ok && d.url){ location.href=d.url; return; }
        btn.disabled=false; msg.textContent=(d && d.error) || '決済を開始できませんでした';
      })
      .catch(function(){ btn.disabled=false; msg.textContent='通信に失敗しました。時間をおいてお試しください'; });
  });
})();
</script>
`,
}))

// ── /toei/kanryo/ 購入後の画面（noindex・2階層下）────────────────────────────
write('toei/kanryo/index.html', page({
  title: 'ご購入ありがとうございます｜フクシル',
  desc: '都営住宅 申込先えらびの閲覧画面です。',
  canonical: '/toei/kanryo/', depth: 2, noindex: true,
  body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">一覧はこの画面にそのまま開きます。<strong>このページのURLは購入から60日間有効です。</strong>ブックマークしておくと、あとから何度でも開けます。</p>
  <p><a id="dl" class="card" style="display:inline-block;padding:.8rem 1.6rem;font-weight:600" href="#">一覧を開く</a></p>
  <p id="msg" class="note"></p>
  <h2>使い方</h2>
  <ol>
  <li>下に一覧が開きます。手元に残したいときは「ファイルとして保存」から保存してください。</li>
  <li>まず「毎回すいている住宅」を自分の通える区市町でしぼってください。</li>
  <li>次の募集案内が出たら、その回に実際に募集されている住宅と突き合わせます。<strong>載っていても、その回に募集が無いことがあります。</strong></li>
  <li>印刷して持っていけます（ブラウザの印刷から「PDFに保存」もできます）。</li>
  </ol>
  <p class="note">開けない・内容が説明と違う・二重に決済された場合は、購入から14日以内に <a href="mailto:contact@fukushiru.com">contact@fukushiru.com</a> までご連絡ください。全額を返金します。
  領収書はStripeから届くメールでご確認いただけます。</p>
  <p class="related"><a href="../../articles/koei-tokyo.html">→ 都営住宅の倍率と申込のしくみ（無料）</a></p>
<script>${kanryoScript({ label: '申込先えらびの一覧' })}</script>
`,
}))

// ── 有料資料 .dist/toei-pack.html ────────────────────────────────────────────
// ★公表表の再現はしない。出すのは当方が計算した指標だけ。
// ★列の並びは「決めるのに要る順」。2026-09-19 に EV と建てられた年を中央値の直後へ動かした。
//   それまで最低・最高・観測・申込0 の後ろにあり、抜粋でも本文でも**横に切れて見えなかった**。
//   この資料が答える問いは「当たりやすくて、住めるのはどれか」なので、その2つを先に出す。
const hrow = (h) => `<tr><td>${esc(h.city)}</td><td>${esc(h.name)}</td><td>${esc(h.cat)}</td><td class="num">${r1(h.med)}</td><td>${esc(h.ev)}</td><td>${esc(h.era)}${h.age != null ? `（築${h.age}年）` : ''}</td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${h.n}</td><td class="num">${h.zero || ''}</td><td>${envCell(h.env, false)}</td></tr>`
const TH = `<th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">中央値</th><th>EV</th><th>建てられた年</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th>同じ名前の町丁目（世帯・住宅侵入 ${WIN_TXT}）</th>`
const table = (list) => `<table class="grid"><thead><tr>${TH}</tr></thead><tbody>
${list.map(hrow).join('\n')}
</tbody></table>`
// ── 2章＝黄金比（2026-09-19 に差し替え）──────────────────────────────────────
// ★なぜ差し替えたか
//   それまでの2章は「毎回すいている申込先」を倍率の低い順に並べただけだった。
//   倍率だけで切ると**空いている理由**がそのまま集まる。実測（この資料の母数そのもの）:
//     すいている側 … EV有 70% / 多摩の市町村 50%
//     混んでいる側 … EV有 92% / 多摩の市町村 18%
//   すいている側の約6割は「EVが無い」か「築年数が中央値より古い」。
//   ∴ 当たりやすさだけでなく、住みやすさの条件を満たすものを**先に**出す。
//   （数字は F から引く。ここに書いた値は説明用で、本文には出さない）
// ★3つの条件しか使わない。増やすと、なぜその住宅が選ばれたのか読者が検算できなくなる。
//   ①中央値が SUKI 倍未満 ②エレベーター有 ③築年数が申込先の中央値以下
// ★立地は点数にしない。どこが良いかは読む人が決めること。区市町で引けるようにするだけ。
// 記事に貼る抜粋（下の TOEI_PEEK）も同じ文字列から作る。
const SEC2_TITLE = `2. 当たりやすさと住みやすさが両方そろう申込先（${num(F.gold)}件）`
const SEC2_LEAD = `倍率の<strong>中央値が${SUKI}倍未満</strong>で、かつ<strong>エレベーターがあり</strong>、<strong>築年数が${F.ageMed}年以下</strong>（観測できた${num(F.enough)}件の中央値）の申込先です。${MIN_N}件以上観測できたものだけなので、<strong>1回だけたまたま空いた住宅は入りません</strong>。${F.goldCities}の区市町にまたがり、倍率の中央値は${F.goldMed}倍、築年数の中央値は${F.goldAgeMed}年です。区市町ごと、倍率の低い順。`
const goldCities = [...new Set(gold.map((h) => h.city))].sort().map((city) => ({
  city, list: gold.filter((h) => h.city === city).sort((a, b) => a.med - b.med),
}))
const goldByCity = goldCities.map((c) => `<h3>${esc(c.city)}（${c.list.length}件）</h3>\n${table(c.list)}`).join('\n\n')


// 3章＝すいてはいるが、条件を承知のうえで選ぶ側。捨てずに別掲する（安いのは事実なので）。
const SEC3_TITLE = `3. すいてはいるが、条件を承知のうえで選ぶ申込先（${num(F.sukiOff)}件）`
const SEC3_LEAD = `中央値は${SUKI}倍未満ですが、<strong>エレベーターが無い</strong>か、<strong>築${F.ageMed}年より古い</strong>ものです。すいている${num(F.sukiIppan)}件のうち<strong>${F.sukiOffPct}%</strong>がここに入ります。<strong>悪い住宅という意味ではありません</strong>——1階を選べるなら階段は問題になりませんし、古い住宅は都心に多く立地では有利なことがあります（築50年を超える住宅の倍率がかえって高いのはそのためです）。<strong>何を引き受けるのかが分かったうえで選べるように</strong>、2章と分けました。`
const offCities = [...new Set(sukiOff.map((h) => h.city))].sort().map((city) => ({
  city, list: sukiOff.filter((h) => h.city === city).sort((a, b) => a.med - b.med),
}))
const offByCity = offCities.map((c) => `<h3>${esc(c.city)}（${c.list.length}件）</h3>\n${table(c.list)}`).join('\n\n')


const packHtml = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>都営住宅 申込先えらび（${RANGE}・${F.rounds}回の実測）｜フクシル</title>
<style>
:root{--ink:#1d2430;--sub:#5b6676;--line:#dfe4ea;--bg:#fff;--accent:#1668a8;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.2rem 4rem;font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  line-height:1.75;color:var(--ink);background:var(--bg);max-width:60rem;margin-inline:auto}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.4rem 0 .6rem;padding-bottom:.3rem;border-bottom:2px solid var(--accent)}
h3{font-size:1rem;margin:1.6rem 0 .4rem;color:var(--accent)}
small{color:var(--sub);font-weight:400}
.lead{color:var(--sub)}
.box{border:1px solid var(--line);border-left:4px solid var(--accent);background:#f7fafc;padding:.8rem 1rem;margin:1rem 0;border-radius:4px}
.box.warn{border-left-color:var(--warn);background:#fff8ed}
.tag{display:inline-block;font-size:.78rem;font-weight:700;color:#fff;background:var(--accent);padding:.1rem .5rem;border-radius:3px;margin-right:.4rem}
.box.warn .tag{background:var(--warn)}
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.grid{border-collapse:collapse;width:100%;font-size:.86rem;margin:.4rem 0 1rem;min-width:44rem}
table.grid th,table.grid td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;white-space:nowrap}
table.grid th{background:#eef3f7;position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:.86rem;color:var(--sub)}
@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}table.grid{font-size:.7rem;min-width:0}.wrap{overflow:visible}}
</style></head><body>

<h1>都営住宅 申込先えらび<br><small>${RANGE}の定期募集${F.rounds}回・${num(F.rows)}件を住宅ごとに名寄せした実測</small></h1>
<p class="lead">フクシル（https://fukushiru.com）／作成 ${READ_AT} 時点の公表資料より</p>

<div class="box"><p><span class="tag">この資料の読み方</span>
数字はすべて<strong>過去の実測から当方が計算した指標</strong>です。次の募集の倍率を約束するものではありません。
募集される住宅は回ごとに変わるため、<strong>ここに載っている住宅が次回も募集されるとは限りません</strong>。
使い方は「募集案内が出たら、その回の対象住宅とこの一覧を突き合わせる」です。</p></div>

<div class="box warn"><p><span class="tag">先に確かめること</span>
申込資格（都内在住・収入基準・世帯構成）を満たしていなければ、倍率がいくら低くても申し込めません。
資格は東京都・JKK東京の募集案内でご確認ください。この資料は資格の判定をしません。</p></div>

<h2>1. まず全体像</h2>
<ul>
<li>観測できた申込先（住宅×募集区分） <strong>${num(F.all)}件</strong>。うち${MIN_N}件以上の募集が観測できた <strong>${num(F.enough)}件</strong>を集計の対象にしています。</li>
<li>同じ建物でも募集区分が違えば別に数えています。混ぜると、病死等があった回だけ安かった住宅が「毎回すいている」に化けるためです。</li>
<li>その${num(F.enough)}件の倍率の中央値は <strong>${F.allMed}倍</strong>。</li>
<li>中央値が${SUKI}倍未満だった申込先は <strong>${F.suki}件（${F.sukiPct}%）</strong>。うち病死等があった住宅を除くと${F.sukiIppan}件。</li>
<li>申込者ゼロの募集が1回以上あった申込先 <strong>${F.zeroHouses}件</strong>。</li>
<li>最高と最低が${BURE}倍以上ひらいた申込先 <strong>${F.buread}件</strong>。</li>
<li>表の右端に、住宅名と同じ名前の町丁目の世帯数と住宅侵入の件数（姉妹サイト 住環境データ東京）を添えています（索引${num(F.enough)}件のうち${num(F.envEnough)}件。住宅名が町の名前までしか一致せず、町が広いため数字を付けていないもの${num(F.envWide)}件）。件数は率ではなく、建物の所在地と一致しないことがあります。読み方は7章。</li>
</ul>
<p class="note">「観測」の単位は募集件数で、募集回の数ではありません。同じ回に同じ住宅で複数の住戸が募集されることがあり、その1件ずつを数えています。</p>

<h2>${SEC2_TITLE}</h2>
<p>${SEC2_LEAD}</p>
<div class="wrap">
${goldByCity}
</div>

<h2>${SEC3_TITLE}</h2>
<p>${SEC3_LEAD}</p>
<div class="wrap">
${offByCity}
</div>

<h2>4. 回によって当たりやすさが動く申込先（${F.buread}件）</h2>
<p>最高と最低が${BURE}倍以上ひらいた住宅です。この相手には「住宅を変える」より<strong>「出す回を変える」</strong>ほうが効きます。
最低の欄が実際に起きた一番すいていた回の倍率です。</p>
<div class="wrap">
${table(buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)))}
</div>

<h2>5. ${JIKO}（別掲・${suki.length - sukiIppan.length}件）</h2>
<p>すいている住宅にはこの区分が混ざります。知らずに選ぶことがないよう分けました。
家賃が減額される場合があり、条件を承知のうえで選ぶ人には現実的な選択肢です。詳しい条件は募集案内をご確認ください。</p>
<div class="wrap">
${table(suki.filter((h) => h.jiko))}
</div>

<h2>6. 条件を1つ変えたときの効き目</h2>
<p>募集${num(F.rows)}件を条件ごとに分けた倍率の中央値です。何をあきらめると何倍ぶん軽くなるかの目安。その条件が読み取れなかった行は、その表からだけ外しています。</p>
${cuts.map((c) => `<h3>${esc(c.label)}</h3>\n<p class="note">${cutNote(c)}</p>\n<div class="wrap"><table class="grid"><thead><tr><th>${esc(c.label)}</th><th class="num">募集件数</th><th class="num">倍率の中央値</th></tr></thead><tbody>\n${c.groups.map((g) => `<tr><td>${esc(g.k)}</td><td class="num">${num(g.n)}</td><td class="num">${r1(g.med)}倍</td></tr>`).join('\n')}\n</tbody></table></div>`).join('\n')}

<h2>7. 観測できた申込先の索引（${num(F.enough)}件）</h2>
<p>中央値の低い順。上の各章に出ていない申込先もここには載っています。</p>
<div class="wrap">
${table(enough)}
</div>

<h2>8. 出典と限界</h2>
<ul>
<li>出典＝${SRC}（${RANGE}の定期募集${F.rounds}回）。読み取り日 ${READ_AT}。</li>
<li>PDFは回ごとに列の作りが違い、機械での読み取りは全${num(raw.rows.length)}行すべてを正しく復元できません。<strong>行頭に区市町が明記されていた${num(F.rowsHead)}行</strong>と、下に書いた方法で<strong>住宅名から区を確定できた${num(F.rowsLedger)}行</strong>の、合わせて${num(F.rows)}行を使っています。ここに出ていない住宅も多くあります。<strong>「載っていない＝空いていない」ではありません。</strong></li>
${envNote('pack')}
<li>「建築」の欄は、その申込先で観測した募集のうち、いちばん多く書かれていた建てられた年です。同じ住宅名でも号棟によって建てられた年が違うことがあり、索引${num(F.enough)}件のうち${num(F.eraMixed)}件は、観測した募集の中に違う年が混ざっていました。</li>
<li>本資料は公表表の転載・改変ではなく、公表された数値から当方が計算した指標（中央値・最低・最高・件数）を、当方の区分で並べたものです。</li>
<li>当サイトは東京都・JKK東京とは関係のない個人が運営しています。制度・資格・募集内容は必ず公式の募集案内でご確認ください。</li>
</ul>
<p class="note">内容の誤りを見つけられた場合は contact@fukushiru.com までご連絡ください。訂正します。
開けない・説明と違う場合は購入から14日以内のご連絡で全額返金します。</p>

</body></html>
`
write('.dist/toei-pack.html', packHtml)

// ── 記事に貼る抜粋（scripts/toei-peek.mjs）────────────────────────────────────
//   ★2026-09-13 手書きをやめてここで作る。以前は offer-block.mjs に手で切った抜粋を置いていて、
//     資料を作り直したら抜粋だけ古いまま（568件・8列）記事12本に残った。売り場のカードは
//     「実物の冒頭をそのまま」と書いているので、抜粋は資料と同じ見出し・同じ行の関数から作り、
//     下で資料の本文と突き合わせる。記事の見た目に合わせて変えるのは見出しの要素（h2/h3 → h4.pk）と
//     表の外枠だけ（資料の表は折り返さないので、抜粋の表も折り返さない）。文字と数字は変えない。
//   ★ここでは記事に貼らない。貼るのは scripts/stamp-offers.mjs（記事の目印の間だけを差し替える係）。
// ★2026-09-19 抜粋を厚くした。3行では何が入っているか分からず、出し惜しみに見える。
//   note 型の見本は冒頭をそのまま読ませる。ここも2章の書き出しと最初の区市町を丸ごと出し、
//   続く区市町の見出しを並べて「この厚みで全部ある」ことを見せる。
//   一番おいしい所（すいている側の何割が条件で外れるか）は無料ページ側に置いてある。
const PEEK_ROWS = 12
const PEEK_NEXT = 3
// ★区市町は名前順なので、先頭が2件しかない区市町のことがある（実際に三鷹市2件だった）。
//   「冒頭12行」と決め打ちすると抜粋が2行になり、厚くしたつもりで薄くなる。
//   ∴ **資料の並びのまま上から取り、行数が PEEK_ROWS に届くまで区市町をまたぐ**。
//   ここを「件数の多い区市町を先に」にはしない。資料の並びと違うものを
//   「実物の冒頭」と称することになるため。
const peekCities = []
{
  let n = 0
  for (const c of goldCities) {
    if (n >= PEEK_ROWS) break
    peekCities.push(c)
    n += c.list.length
  }
}
const restCities = goldCities.slice(peekCities.length)
if (!peekCities.length || restCities.length < PEEK_NEXT) die('抜粋を作れません：黄金比の申込先がある区市町が足りません。')
const peekBody = `    <h4 class="pk">${SEC2_TITLE}</h4>
    <p>${SEC2_LEAD}</p>
${peekCities.map((c) => `    <h4 class="pk">${esc(c.city)}（${c.list.length}件）</h4>
    <div class="table-wrap"><table style="white-space:nowrap">
    <thead><tr>${TH}</tr></thead>
    <tbody>
${c.list.map((h) => `    ${hrow(h)}`).join('\n')}
    </tbody></table></div>`).join('\n')}`
// 続きの区市町は見出しだけ。★1つの文字列にまとめない——資料では見出しと見出しの間に表が
//   入るので、つなげた文字列は資料の本文と一致せず、下の突き合わせが必ず落ちる。
const peekNextList = restCities.slice(0, PEEK_NEXT).map((c) => `    <h4 class="pk">${esc(c.city)}（${c.list.length}件）</h4>`)
const TOEI_PEEK = [peekBody, ...peekNextList].join('\n')
{
  // タグを外した文字の並びが、資料の本文にそのまま入っていること（書き直しが混ざっていないこと）。
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
  const packFlat = flat(packHtml)
  if (!packFlat.includes(flat(peekBody))) die('抜粋の本体が有料資料の本文と一致しません（抜粋の作り方を確認）。')
  // 見出しは1本ずつ確かめる。まとめて確かめると、資料では間に表が挟まるので必ず落ちる。
  for (const h of peekNextList) {
    if (!packFlat.includes(flat(h))) die(`抜粋の見出しが有料資料の本文にありません: ${flat(h)}`)
  }
}
// ★2026-09-13(2) 抜粋の表には住宅侵入の件数が載る。記事には「率ではない・所在地と一致しない場合がある・0件の意味・出典」が
//   どこにも無かったので、記事の抜粋の枠の外に添える（抜粋の中は資料そのままにするため、枠の中には書き足さない）。
const PEEK_NOTE = `抜粋の表の右端は、住宅名と同じ名前の町丁目の数字です（姉妹サイト<a href="${esc(ENV.site)}/">住環境データ東京</a>が町丁目ごとに集計）。住宅侵入は${WIN_TXT}の<strong>件数そのもので、率ではありません</strong>（世帯の多い町ほど大きく出ます）。<strong>建物の所在地がその町丁目と一致しない場合があります</strong>。「（町全体・2つの丁目）」のように書いたものは、住宅名が町の名前までしか一致しなかったときの、町全体の合計です（丁目が${TOWN_MAX_CHOME}つ以下で、世帯が${num(TOWN_MAX_SETAI)}未満の町だけ）。「数字なし」は、町が広いか、同じ区に同じ名前の町丁目が2つ以上あって決められないため、数字を付けていないという意味です（同じ名前の町丁目が見つからないものは「—」）。0件は被害がなかったという意味ではありません（警察に届出があって初めて数えられます）。出典＝警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（東京都オープンデータ・<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" rel="license">CC BY 4.0</a>）、総務省統計局「令和2年国勢調査 小地域集計」（世帯数）。当サイトが住宅名と突き合わせて加工したもので、警視庁・総務省統計局が作成したものではありません。`
// ── /toei/ の売り場にも同じ抜粋を差し込む（2026-09-18）────────────────────────
//   記事のカード（offer-block.mjs の offerToeiLeaf）には最初から入っていたのに、
//   **売り場ページ本体だけ入っていなかった**。値段と中身の箇条書きだけで、実物を
//   1行も見せずに500円のボタンを出していた。/pack/（障害者控除）には最初からある。
//   ★ページの文字列はもう組み終わっているので、差し込み口を置いて後から入れる
//     （抜粋を作るのに必要な区市町の集計が、ページを組んだあとでないと出ないため）。
//   ★買うボタンの下に置く。上に積むとボタンが画面の下へ流れる（2026-09-17に実測して
//     「値段 → 中身 → 注意 → ボタン → 抜粋」の順に決めてある）。[[deploy-gate-after-generators]]
{
  const at = pending.findIndex(([rel]) => rel === 'toei/index.html')
  if (at < 0) die('/toei/ のページが見つかりません（差し込み口を置く先が無い）。')
  const mark = '<!-- TOEI:PEEK -->'
  if (!pending[at][1].includes(mark)) die('/toei/ に抜粋の差し込み口がありません。')
  // 抜粋の表の右端は住宅侵入の件数。率ではないことなどを枠の外に必ず添える（記事と同じ扱い）。
  const box = `${peekBox('一覧の冒頭（抜粋）', TOEI_PEEK)}
  <p class="fine">${PEEK_NOTE}</p>`
  pending[at][1] = pending[at][1].replace(mark, box)
}

const tpl = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
write('scripts/toei-peek.mjs', `// 自動生成：scripts/toei-nerai.mjs が .dist/toei-pack.html と同じ行から書く。手で直さない。
// 有料資料の2章の冒頭。行数が${PEEK_ROWS}に届くまで区市町をまたいで丸ごと出し、続く${PEEK_NEXT}件は見出しだけ。
// 記事への貼り付けは scripts/stamp-offers.mjs。
// 資料＝${RANGE}の定期募集${F.rounds}回・読み取り日 ${READ_AT}
export const TOEI_PEEK = \`${tpl(TOEI_PEEK)}\`
// ★関所（scripts/toei-put-pack.mjs）が資料の本文と突き合わせるための内訳。
//   本体と見出しは資料の中で離れて出る（見出しと見出しの間に表が挟まる）ので、
//   つなげた文字列では一致しない。**分けたまま渡す**。2か所で組み直すとずれる。
export const TOEI_PEEK_BODY = \`${tpl(peekBody)}\`
export const TOEI_PEEK_NEXT = ${JSON.stringify(peekNextList)}
// 抜粋の表の右端（住環境の数字）に添える注記。記事では抜粋の枠の外に置く（scripts/offer-block.mjs）。
export const TOEI_PEEK_NOTE = \`${tpl(PEEK_NOTE)}\`
// 売り場カードの文言に使う数（資料と同じ定数）：観測の下限（募集件数）・すいているの線（倍率）・募集回の数
export const TOEI_FACTS = ${JSON.stringify({ minN: MIN_N, suki: SUKI, rounds: F.rounds, gold: F.gold, sukiOff: F.sukiOff, sukiOffPct: F.sukiOffPct, ageMed: F.ageMed })}
`)

// ── トップページ（index.html・手書き）の /toei/ の案内カード ─────────────────────
//   ★2026-09-13 カードの件数が手書きで、母数を戻したら /toei/ と食い違った（13,349件・1,320件・689件のまま）。
//     カードの <p> だけをここで書き換える。見つからない・2つ以上あるときは止める（黙って古いまま出さない）。
{
  const top = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const re = /(<a class="card" href="toei\/">\s*<span class="cat">[^<]*<\/span>\s*<h3>[^<]*<\/h3>\s*<p>)([\s\S]*?)(<\/p>\s*<\/a>)/g
  const hits = top.match(re) || []
  if (hits.length !== 1) die(`index.html の /toei/ の案内カードが ${hits.length} 個見つかりました（1個のはず）。`)
  const card = `定期募集${F.rounds}回・${num(F.rows)}件を住宅と募集区分ごとに名寄せしました。倍率の中央値は${F.allMed}倍で、${num(F.enough)}件の申込先のうち${num(F.suki)}件（${F.sukiPct}%）は${SUKI}倍未満。<strong>区市町ごとの相場と条件別の効き目は無料。住宅名つきの一覧が${PRICE}円です。</strong>`
  const next = top.replace(re, (_, a, _b, c) => a + card + c)
  if (next !== top) write('index.html', next)
}

// ── sitemap.xml（この艦のsitemapは手書きで育てたもの。/toei/ の1行だけ書き換える）──
//   ★/toei/kanryo/ は購入者専用（noindex）なので載せない。
//   ★2026-09-13 lastmod を「倍率表の読み取り日」から「/toei/ の中身が変わった日」に変えた。読み取り日のままだと、
//     母数や注記を変えて作り直しても8月の日付のまま残る。中身が変わらなければ前の日付を保つ。
//   ★行を消して末尾に付け直すのをやめ、その場で置き換える（毎回行が動いて差分が読めなくなるため）。
{
  const smPath = path.join(ROOT, 'sitemap.xml')
  const sm = fs.readFileSync(smPath, 'utf8')
  const head = `<url><loc>${SITE}/toei/</loc>`
  const count = sm.split(head).length - 1
  if (count > 1) die(`sitemap.xml に /toei/ が ${count} 行あります（1行のはず）。`)
  const at = sm.indexOf(head)
  const old = at >= 0 ? sm.slice(at, sm.indexOf('</url>', at) + '</url>'.length) : ''
  const prevLastmod = (/<lastmod>([^<]+)<\/lastmod>/.exec(old) || [])[1] || ''
  const freePath = path.join(ROOT, 'toei', 'index.html')
  const freeNew = pending.find(([rel]) => rel === 'toei/index.html')[1]
  const changed = !fs.existsSync(freePath) || fs.readFileSync(freePath, 'utf8') !== freeNew
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)   // 日本時間の日付
  const entry = `<url><loc>${SITE}/toei/</loc><lastmod>${changed ? today : (prevLastmod || READ_AT)}</lastmod><priority>0.9</priority></url>`
  const next = old ? sm.slice(0, at) + entry + sm.slice(at + old.length) : sm.replace('</urlset>', `  ${entry}\n</urlset>`)
  if (next !== sm) write('sitemap.xml', next)
}

flush()
console.log(`無料ページ /toei/ と購入後画面を作成`)
if (SPILL.length) console.log(`  区市町名の読み取り切れを直した行 ${SPILL.length}：${SPILL.map((s) => `${s.round} 「${s.city}」＋「${s.head}」→ ${s.ward}（${s.name}）`).join(' / ')}`)
console.log(`有料資料 .dist/toei-pack.html（${(Buffer.byteLength(packHtml) / 1024).toFixed(0)}KB）`)
console.log(`  募集${num(F.rows)}件 → 住宅${F.all}件（うち${MIN_N}件以上観測 ${F.enough}件）`)
console.log(`  すいている ${F.suki}件（一般${F.sukiIppan}／事故住宅${F.suki - F.sukiIppan}）・ぶれる ${F.buread}件・申込0あり ${F.zeroHouses}件`)
console.log(`  区の取り戻し: 行頭に区市町なし ${LEDGER.untrusted}行 → 台帳で区を確定 ${LEDGER.recovered}行（うち頭の区市町名を外して ${LEDGER.recoveredStem}・引き継ぎの区と違う ${LEDGER.moved}）／複数の区 ${LEDGER.multi}／台帳に無い ${LEDGER.none}`)
console.log(`  行頭に区市町あり ${LEDGER.head}行のうち町丁目名が1区だけ ${LEDGER.checked}行（うち頭の区市町名を外して ${LEDGER.checkedStem}）・食い違い ${LEDGER.conflict}行${LEDGER.conflictEx.length ? '：' + LEDGER.conflictEx.join(' / ') : ''}`)
{
  const byName = new Map(houses.map((h) => [`${h.city}|${h.name}`, h.env]))
  const lv = (list, l) => list.filter((e) => e && e.level === l).length
  const envs = [...byName.values()]
  const idx = enough.map((h) => h.env)
  console.log(`  抜粋 scripts/toei-peek.mjs（2章の ${peekCities.map((c) => c.city).join("・")}＝${peekCities.reduce((n, c) => n + c.list.length, 0)}行＋見出し${PEEK_NEXT}件）／トップのカード・sitemap: ${pending.map(([rel]) => rel).filter((rel) => rel === 'index.html' || rel === 'sitemap.xml').join('・') || '変更なし'}`)
  console.log(`  条件別の表の母数: ${cuts.map((c) => `${c.label} ${c.base}`).join('／')}・建築の年が混ざる ${F.eraMixed}件`)
  console.log(`  次に: node scripts/stamp-offers.mjs（記事12本の抜粋を貼り直す）。KV へは scripts/toei-put-pack.mjs（入れる前に資料・/toei/・トップ・記事を突き合わせる）`)
  console.log(`  住環境の数字: 索引${F.enough}件中 ${F.envEnough}件（頭の区市町名を外して ${enough.filter((h) => hasNum(h.env) && h.env.stem).length}・町丁目 ${lv(idx, 'area')}・町全体 ${lv(idx, 'town')}）・数字なし（町が広い ${lv(idx, 'wide')}・決められない ${lv(idx, 'ambiguous')}・見つからない ${idx.filter((e) => !e).length}）／区×住宅名 ${byName.size}件中 ${envs.filter(hasNum).length}件（町丁目 ${lv(envs, 'area')}・町全体 ${lv(envs, 'town')}・町が広い ${lv(envs, 'wide')}・決められない ${lv(envs, 'ambiguous')}）／無料ページの表 ${konde.slice(0, 10).filter((h) => hasNum(h.env)).length}/10`)
  // 町全体の線で分けた町（索引に出る行の数つき）
  const townList = (l) => {
    const m = new Map()
    for (const h of enough) if (h.env && h.env.level === l) { const k = `${h.city}${h.env.label}（${tsu(h.env.chome)}の${h.env.unit}・世帯${num(h.env.setai)}）`; m.set(k, (m.get(k) || 0) + 1) }
    return [...m].map(([k, n]) => `${k}×${n}`).join(' / ')
  }
  console.log(`  町全体の合計を出した町: ${townList('town') || 'なし'}`)
  console.log(`  町が広いため数字なしにした町: ${townList('wide') || 'なし'}`)
}
