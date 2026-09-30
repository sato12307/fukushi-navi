// ─────────────────────────────────────────────────────────────────────────────
// kenei-free.mjs — 三大都市圏の外の県営住宅を「申込先ごとの一覧まで無料」で出す面（/<key>/）。
//   scripts/kenei-build.mjs から呼ぶ（sitemap もそちらで書く）。
//
// ★2026-10-01 ユーザー「マイナーな県の公営住宅のデータは無料で出すのもありかと。反応を見たいのです」。
//   ∴ 売らない。CITIES（＝売っている商品の表）には入れず、koei-lib の loadFrom に設定を直に渡して
//   同じ数え方（名寄せ・中央値・すいている判定）だけを使う。売り場・KV・特商法の表記には出てこない。
// ★どの県を入れるか（2026-10-01 の44道府県の調査・scratchpad/kenei-survey）＝回ごとの結果が文字で読めて、
//   4回以上さかのぼれて、公表の小計・合計と一の位まで照合でき、データを置くサイトの規約が転載・商用利用・
//   機械的な取得を禁じていない県だけ（v281）。付属情報は、文字で取れて団地名で結べるものだけを付ける
//   （画像の読み取りで家賃を取ると、照合の相手が無いまま誤った数字が出る＝高知の試しで 30,700→302700）。
// ★ここに書く文（notes）は原文で確かめたものだけ。数字は行データから計算し、台帳（公表の合計との照合）が
//   崩れていれば止める。行データ（data/<key>-bairitsu.json）は公開しない（.gitignore）。
// ─────────────────────────────────────────────────────────────────────────────
import { page, esc, SITE } from './shogai-kojo-page.mjs'
import { loadFrom, normName, WA, MIN_N, SUKI, BURE, num, r1 } from './koei-lib.mjs'

const die = (m) => { console.error(`停止：${m}`); process.exit(1) }
const bai = (m, k) => (k ? (m / k).toFixed(2) : '—')

export const FREE = [
  {
    key: 'kochi-ken', city: '高知県', short: '高知県営', kind: '県営', prefCode: '39', byRounds: true, hasSecond: true,
    pub: '高知県住宅供給公社', doc: '入居者募集状況一覧表', freq: '年4回（2・5・8・11月）',
    src: '高知県住宅供給公社が定期募集の回ごとに公表する県営住宅の「入居者募集状況一覧表」PDF',
    // 名寄せ＝団地×区分×間取りの型。階はまとめる（階ごとに分けると観測が1〜2件に割れ、「毎回」が言えない）。
    axis: { label: '区分', of: (r) => r.cat },
    keyOf: (r) => [r.name, r.cat, r.madoriType],
    cols: [['name', '団地'], ['cat', '区分'], ['madoriType', '間取り'], ['city', '市町村'], ['access', '最寄り'], ['ev', 'エレベーター'], ['built', '建設年度']],
    catCols: [['世帯向け住宅', '世帯向け'], ['単身・世帯向け住宅', '単身・世帯向け']],
    otherCats: '単身向け・高齢者向け・シルバーハウジング・車イスの住宅',
    lead: '高知県営住宅の定期募集は年4回（2・5・8・11月）です。高知県住宅供給公社は回ごとに、団地・区分・間取り・階ごとの募集戸数と応募者数・第二希望・倍率を「入居者募集状況一覧表」で公表していますが、ページに載るのは最新の1回だけです。',
    notes: [
      '<strong>倍率は応募者数÷募集戸数で、第二希望は入っていません。</strong>公社の一覧表の倍率も同じ計算です（21回の全行で一致）。',
      '<strong>応募者が0の住戸でも、第二希望で申し込んだ人で埋まることがあります。</strong>抽選結果の注記では、第二希望に仮当選すると、第一希望の補欠の資格を失います。表の「第二希望」は、その申込先に第二希望で申し込んだ人の、のべ人数です。',
      '令和8年8月の回から、野根第二・羽根第二・奈半利・窪川・宿毛の5団地は、区分が「世帯向け住宅」から「単身・世帯向け住宅」に変わり、単身者も申し込めるようになりました（その回の募集団地一覧表の注記）。この一覧では、変わる前と後を別の申込先として数えています。',
      '最寄り・エレベーター・建設年度は、公社の「県営住宅の情報」（Excel・2026年8月時点）から団地ごとに付けました。回ごとの資料ではなく、今の時点の1枚です。家賃（6段階）は、その回の募集団地一覧表でご確認ください。',
      '随時募集の団地（野根・佐喜浜・羽根・本山・佐賀）は定期募集の表に出ないので、この一覧には入っていません。',
    ],
    check: (F, L) => `${L.length}回とも、読み取った行の和が、一覧表の区分ごとの小計と全体の合計に、募集戸数・応募者数・第二希望とも<strong>一の位まで合う</strong>ことを確かめています。PDFを2通りの方法で読み、${num(F.rows)}行すべてで値が一致しました。`,
    sources: [
      ['高知県住宅供給公社「県営住宅 定期募集」', 'http://www.kochi-jk.or.jp/kenei/future/'],
      ['高知県住宅供給公社「県営住宅の情報」（Excel・団地ごとの最寄り・エレベーター・建設年度）', 'http://www.kochi-jk.or.jp/wp/wp-content/themes/kochijyuutaku/img/kenei/jyutakushoukai/keneishoukai19.xlsx'],
      ['令和8年度第2回 定期募集団地一覧表（区分変更・随時募集の注記）', 'http://www.kochi-jk.or.jp/wp/wp-content/themes/kochijyuutaku/pdf/kenkei_future/R8.8bosyu.pdf'],
      ['令和8年度第2回 定期募集 抽選結果（第二希望の注記）', 'http://www.kochi-jk.or.jp/wp/wp-content/themes/kochijyuutaku/pdf/kenkei_future/R8.8tyusen.pdf'],
    ],
    orgs: '高知県・高知県住宅供給公社',
  },
  {
    // ★hold＝公開保留（2026-10-01）。宮城県住宅供給公社のサイトに「著作権法上認められた場合を除き、無断で複製・転用することは
    //   できません」（https://www.miyagi-jk.or.jp/about/privacy-2-2/ の3.）がある。出すのは公表数値から計算した指標と事実だけだが、
    //   v281（規約で禁じていれば使わない）の線に近いので、ユーザーの判断を待つ。hold を外せば /miyagi-ken/ が出る。
    hold: true,
    key: 'miyagi-ken', city: '宮城県', short: '宮城県営', kind: '県営', prefCode: '04', byRounds: true,
    pub: '宮城県住宅供給公社', doc: '定期募集住宅応募状況一覧', freq: '年4回（3・6・9・12月）',
    src: '宮城県住宅供給公社が定期募集の回ごとに公表する「定期募集住宅応募状況一覧」PDF',
    // 名寄せ＝団地（棟の記号 A/B/C を外す。回によって付いたり付かなかったりする）×用途×型式。「毎回」は募集回の数で数える
    axis: { label: '用途', of: (r) => r.cat },
    keyOf: (r) => [r.danchi, r.cat, r.type],
    cols: [['danchi', '団地'], ['cat', '用途'], ['type', '型式'], ['city', '市町村'], ['access', '最寄り（徒歩）'], ['ev', 'エレベーター'], ['built', '完成年度']],
    catCols: [['一般向', '一般向'], ['特別割当', '特別割当']],
    otherCats: '事故等・車椅子・シルバーハウジング・子育て世帯向の住宅',
    lead: '宮城県営住宅の定期募集は年4回（3・6・9・12月）です。宮城県住宅供給公社は回ごとに「定期募集住宅応募状況一覧」（住宅・型式・用途ごとの募集戸数・応募者数・倍率）を公表していますが、記事からリンクされるのは最新の1回だけです。',
    notes: [
      '<strong>倍率は応募者数÷募集戸数です</strong>（公社の一覧の倍率も同じ計算です）。',
      '「特別割当」は、老人世帯・障害者世帯・20歳未満の子を3人以上扶養している母子・父子世帯に限って募集する住宅です（公社の募集住宅一覧表の注記）。',
      '「事故等」は、以前に事件や事故などで空家になり、一定期間募集を止めていた住宅です（同じ注記）。倍率が低いことには、この理由があります。',
      '同じ団地でも、回によって住宅名に棟の記号（A・B など）が付いたり付かなかったりするので、記号を外した団地×用途×型式で数えています。',
      '最寄り（徒歩分）・エレベーター・完成年度は、公社の団地詳細と募集住宅一覧表から付けました。徒歩分の多くは団地詳細の「平成17年4月1日現在」の記載です。家賃は、その回の募集住宅一覧表でご確認ください。',
    ],
    check: (F, L) => `${L.length}回とも、読み取った行の和が、一覧の全体の合計に募集戸数・応募者数とも<strong>一の位まで合う</strong>ことを確かめています。令和8年9月の回は、一般向の募集戸数の小計が表では104戸、行の和では105戸で、表の小計の和（119戸）が同じ表の全体の合計（120戸）と合わないため、表の側の食い違いと判断しました。`,
    sources: [
      ['宮城県住宅供給公社「県営住宅 定期募集」（応募状況のお知らせ）', 'https://www.miyagi-jk.or.jp/news/post-300/'],
    ],
    orgs: '宮城県・宮城県住宅供給公社',
  },
]

// 表の列（申込先の一覧）：名寄せの鍵の列＋中央値など＋付属情報の列
// 第二希望の列は資料に第二希望がある県（hasSecond＝高知）だけ
const houseTable = (C, list, secondOf) => {
  const keyN = C.keyOf(list[0] || {}).length
  const keyCols = C.cols.slice(0, keyN), attrCols = C.cols.slice(keyN)
  const head = keyCols.map(([, l]) => `<th>${esc(l)}</th>`).join('') +
    '<th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th>' + (C.hasSecond ? '<th class="num">第二希望</th>' : '') +
    attrCols.map(([, l]) => `<th>${esc(l)}</th>`).join('') + '<th>最後の募集</th>'
  const row = (h) => '<tr>' + keyCols.map(([f]) => `<td>${esc(h[f] || '')}</td>`).join('') +
    `<td class="num"><strong>${r1(h.med)}倍</strong></td><td class="num">${r1(h.min)}</td><td class="num">${r1(h.max)}</td><td class="num">${C.byRounds ? `${h.rounds}回${h.n !== h.rounds ? `<br><small>${h.n}件</small>` : ''}` : `${h.n}件`}</td><td class="num">${h.zero || ''}</td>${C.hasSecond ? `<td class="num">${secondOf(h) || ''}</td>` : ''}` +
    attrCols.map(([f]) => `<td>${esc(h[f] || '—')}</td>`).join('') + `<td>${WA(h.last)}</td></tr>`
  return `  <div class="table-wrap">\n  <table class="grid" style="white-space:nowrap">\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n${list.map((h) => '  ' + row(h)).join('\n')}\n  </tbody></table></div>`
}

export function freePage (C) {
  const D = loadFrom(C)
  const { F, rows, ledger, enough, suki, buread, konde } = D
  const L = ledger.filter((l) => l.used)
  // 照合：回ごとの行の和が、台帳の公表の合計と一の位まで合うこと（読み取り担当の照合を、ビルドのたびに取り直す）
  for (const l of L) {
    const rs = rows.filter((r) => r.round === l.round)
    const k = rs.reduce((s, r) => s + r.koho, 0), m = rs.reduce((s, r) => s + r.moushikomi, 0)
    if (!l.match || k !== l.published.koho || m !== l.published.moushikomi) die(`${C.city} ${l.round}：行の和 ${k}/${m} が公表の合計 ${l.published.koho}/${l.published.moushikomi} と合わない`)
  }
  // 第二希望ののべ人数（申込先ごと）
  const second = new Map()
  for (const r of rows) { const k = C.keyOf(r).map(normName).join('|'); second.set(k, (second.get(k) || 0) + (r.second || 0)) }
  const secondOf = (h) => second.get(C.keyOf(h).map(normName).join('|')) || 0
  // 回×区分の倍率（応募の合計÷募集戸数の合計）
  const R = [...new Set(rows.map((r) => r.round))].sort().reverse()
  const sums = (rs) => ({ k: rs.reduce((s, r) => s + r.koho, 0), m: rs.reduce((s, r) => s + r.moushikomi, 0) })
  const cell = (s) => `<td class="num"><strong>${bai(s.m, s.k)}倍</strong><br><small>${num(s.k)}戸・${num(s.m)}人</small></td>`
  const roundRows = R.map((rd) => {
    const rs = rows.filter((r) => r.round === rd)
    const kai = (ledger.find((l) => l.round === rd) || {}).kai || ''
    return `  <tr><th scope="row">${WA(rd)}${kai ? `<br><small>${esc(kai.replace(/定期募集$/, ''))}</small>` : ''}</th>${cell(sums(rs))}${C.catCols.map(([c]) => cell(sums(rs.filter((r) => r.cat === c)))).join('')}</tr>`
  }).join('\n')
  const all = R.map((rd) => sums(rows.filter((r) => r.round === rd))).map((s) => s.m / s.k)
  const [aMin, aMax] = [Math.min(...all), Math.max(...all)]
  const first = R[R.length - 1], latest = R[0], N = R.length
  const top = konde[0]
  // 申込先の呼び名＝名寄せの鍵の列（高知 name・cat・madoriType、宮城 danchi・cat・type）→「団地（区分・間取り）」
  const nameOf = (h) => { const [a, ...rest] = C.cols.slice(0, C.keyOf(h).length).map(([f]) => h[f]).filter(Boolean); return `${esc(a)}（${rest.map(esc).join('・')}）` }
  const sukiSorted = suki.slice().sort((a, b) => a.med - b.med || b.n - a.n)
  const title = `${C.city}営住宅の倍率と、毎回すいている申込先（定期募集${N}回の実測・無料）｜フクシル`
  const desc = `${C.city}営住宅の${C.doc}${N}回ぶん（${WA(first)}〜${WA(latest)}）を申込先ごとに名寄せしました。${MIN_N}回以上の募集で観測できた${num(F.enough)}件のうち${num(F.suki)}件は倍率の中央値が${SUKI}倍未満。最寄り・エレベーター・建設年度つきの一覧まで全部無料です。`
  const links = R.slice().reverse().map((rd) => { const l = ledger.find((x) => x.round === rd); return l && l.file ? `<a href="${esc(l.file)}" rel="nofollow">${WA(rd)}</a>` : WA(rd) }).join('・')
  const body = `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅</a> ＞ ${esc(C.city)}営住宅の倍率と申込先</p>
  <h1>${esc(C.city)}営住宅の倍率と、毎回すいている申込先<br><small>${WA(first)}〜${WA(latest)}の定期募集${N}回・${num(F.rows)}件を申込先ごとに名寄せした実測</small></h1>
  <p class="updated">最終確認：${esc(D.READ_AT)} ／ ${esc(C.pub)}が公表する${esc(C.doc)}（${N}回）から計算</p>

  <p class="lead">${C.lead}
  そこで${WA(first)}から${WA(latest)}までの${N}回を集め、<strong>申込先（${C.cols.slice(0, C.keyOf(rows[0]).length).map(([, l]) => esc(l)).join('×')}）ごとに名寄せ</strong>しました。<strong>申込先ごとの一覧まで、このページで全部無料で読めます。</strong></p>

  <div class="callout point"><p><span class="tag">要点</span>全体の倍率は、回によって<strong>${aMin.toFixed(2)}〜${aMax.toFixed(2)}倍</strong>でした。${MIN_N}回以上の募集で観測できた申込先<strong>${num(F.enough)}件</strong>のうち、<strong>${num(F.suki)}件（${F.sukiPct}%）</strong>は倍率の中央値が${SUKI}倍未満です。${top ? `いちばん混んでいるのは${nameOf(top)}で、中央値${r1(top.med)}倍でした。` : ''}</p></div>

  <h2>募集回ごとの倍率</h2>
  <div class="table-wrap">
  <table class="grid">
  <thead><tr><th>募集回</th><th class="num">全体</th>${C.catCols.map(([, h]) => `<th class="num">${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>
${roundRows}
  </tbody></table></div>
  <p class="note">倍率は応募者数の合計÷募集戸数の合計です。${esc(C.otherCats)}は募集が少ないので列を作らず、「全体」にだけ入れています。</p>

  <h2 id="suki">毎回すいている申込先（${num(F.suki)}件・無料）</h2>
  <p>${MIN_N}回以上の募集で観測できて（同じ回に何戸出ても1回と数えます）、倍率の<strong>中央値</strong>が${SUKI}倍未満だったものだけを、倍率の低い順に並べました。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。</p>
${houseTable(C, sukiSorted, secondOf)}

  <h2 id="konde">混んでいる申込先（上位${Math.min(12, konde.length)}件）</h2>
  <p>${MIN_N}回以上の募集で観測できた申込先を、倍率の中央値が高い順に並べました。</p>
${houseTable(C, konde.slice(0, 12), secondOf)}

${buread.length ? `  <h2 id="bure">回によって当たりやすさが大きく動く申込先（${buread.length}件）</h2>
  <p>最高と最低が${BURE}倍以上ひらいた申込先です。住宅を変えるより、<strong>出す回を変える</strong>ほうが効く相手です。</p>
${houseTable(C, buread.slice().sort((a, b) => (b.max / b.min) - (a.max / a.min)), secondOf)}
` : ''}
  <h2 id="all">観測できた申込先の索引（${num(F.enough)}件）</h2>
  <p>${MIN_N}回以上の募集で観測できた申込先の全部です。倍率の中央値の低い順。${MIN_N}回未満の申込先（${num(F.all - F.enough)}件）は、「毎回」と言えないので載せていません。</p>
${houseTable(C, enough, secondOf)}

  <h2>表の読み方</h2>
  <ul>
${C.notes.map((t) => `  <li>${t}</li>`).join('\n')}
  <li>${C.byRounds ? '「観測」は、その申込先が募集に出た<strong>回の数</strong>です（同じ回に階の違う住戸が並んでも1回）。下の小さい数字は一覧表の行の数（件）で、倍率の中央値・最低・最高は行ごとの倍率から出しています。「申込0」は応募者が0だった件数（行の数）です。' : '「観測」は募集の件数（一覧表の行の数）で、募集回の数ではありません。同じ回に同じ申込先で階の違う住戸が出ると、1件ずつ数えています。「申込0」は応募者が0だった件数です。'}</li>
  <li><strong>「倍率が低い＝誰でも入れる」ではありません。</strong>申込資格（収入基準・世帯の条件など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数・間取りが変わります。申し込む前に、その回の募集案内で必ず条件を確かめてください。</li>
  </ul>

  <h2>数字の確かめ方</h2>
  <p>${C.check(F, L)}</p>

  <div class="sources">
  <h2>出典</h2>
  <ul>
${C.sources.map(([l, u]) => `  <li>${esc(l)}<br><a href="${esc(u)}" rel="nofollow">${esc(u)}</a></li>`).join('\n')}
  <li>各回の${esc(C.doc)}（PDF）：${links}</li>
  </ul>
  <p class="disclaimer">当サイトは${esc(C.orgs)}とは関係のない個人が運営しています。数字は上記の公表資料を${esc(D.READ_AT)}時点で集計・計算したもので、当選を保証するものではありません。本ページは公表表の転載ではなく、公表された数値から当方が計算した指標（倍率の中央値・最低・最高・件数）を、当方の区分で並べたものです。誤りを見つけられた場合はご連絡ください。訂正します。</p>
  </div>

  <p class="related">関連：<a href="../hikazei/ken/${C.prefCode}/">${esc(C.city)}の住民税非課税の年収の目安</a> ／ <a href="../articles/koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまでか</a> ／ <a href="../articles/koei-jutaku-bairitsu.html">公営住宅の当選倍率まとめ</a></p>
`
  const jsonld = { '@context': 'https://schema.org', '@type': 'Article', headline: title.split('｜')[0], description: desc, inLanguage: 'ja', url: `${SITE}/${C.key}/`, datePublished: '2026-10-01', dateModified: D.READ_AT, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' } }
  return { title, checked: D.READ_AT, html: page({ title, desc, canonical: `/${C.key}/`, depth: 1, body, jsonld }) }
}
