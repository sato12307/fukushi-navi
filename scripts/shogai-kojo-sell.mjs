// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-sell.mjs — 有料パックの販売まわりのページを作る。
//   /pack/          … 何を売っているかの説明と、市区町村を選んで買う画面
//   /pack/kanryo/   … 支払い後のダウンロード画面
//   /tokushoho/     … 特定商取引法に基づく表記（売る以上、必須）
//   /kiyaku/        … 利用規約
//
// ★無料と有料の線を、売り場のページ自身に書く
//   対象になるかどうかの基準は無料。売っているのは手続きを終わらせるための一式。
//   この線を動かすときは worker 側の商品説明も同時に直すこと。
//
// ★決済まわりのページは noindex にしない
//   特商法表記と規約は、買う前に読めることが要件。検索から直接来ても困らない。
//   ただし /pack/kanryo/ は購入者専用の画面なので noindex にする。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, esc, SITE } from './shogai-kojo-page.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data', 'shogai-kojo')
const TODAY = new Date().toISOString().slice(0, 10)
// 規約の制定日。中身を変えたときだけ手で書き換える（ビルド日を入れない）。
const KIYAKU_SEITEI = "2026-08-31"
const PRICE = 500

// 販売者の表記は艦隊で共通（実在の所在地・電話番号）。
const SELLER = {
  name: '髙橋聖',            // ★「髙」ははしごだか（U+9AD9）。略字の「高」にしない
  zip: '651-0084',
  addr: '兵庫県神戸市中央区磯辺通1丁目1番18号 カサベラ国際プラザビル707号室',
  tel: '050-1784-7036',
  mail: 'contact@fukushiru.com',
  hours: '平日10時〜17時（土日祝を除く）',
}

const packIdx = JSON.parse(fs.readFileSync(path.join(ROOT, '.dist', 'packs', '_index.json'), 'utf8'))
const items = packIdx.items.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)))
const byPref = new Map()
for (const it of items) {
  if (!byPref.has(it.pref)) byPref.set(it.pref, [])
  byPref.get(it.pref).push(it)
}
const options = [...byPref.entries()].map(([pref, list]) =>
  `<optgroup label="${esc(pref)}">${list.map((i) => `<option value="${i.code}">${esc(i.pref)}${esc(i.city)}</option>`).join('')}</optgroup>`).join('')

const write = (rel, html) => {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, html)
}

// ── /pack/ ──────────────────────────────────────────────────────────────────
write('pack/index.html', page({
  // ★① 題名を読者が打つ言葉に（2026-09-01）。この艦の主戦場はBingで、
  //   「障害者控除」「特別障害者控除」が9位・表示2,148・クリック103。
  //   ∴ 商品名（還付申請パック）ではなく、その人が知りたいこと（5年分いくら戻るか）を先に置く。
  title: `親の障害者控除、過去5年分でいくら戻るか｜${items.length}市区町村の認定基準と申請手順｜フクシル`,
  desc: `要介護の親御さんが障害者控除の対象になるかを確かめ、過去5年分さかのぼって税金を取り戻すための手順書。自立度ランクが書かれた書類の探し方、税率別の還付試算、更正の請求の手順まで。${items.length}市区町村それぞれの認定基準に対応。${PRICE}円。`,
  canonical: '/pack/', depth: 1,
  // ★2026-09-05 冒頭だけ実物を見せる形にしたので、Googleへ「この面には有料部分がある」と申告する。
  //   人とクローラーへ同じものを出しているので隠す必要がない（切った本文はHTMLに無い）。
  //   cssSelector は抜粋の枠。ここから先は無料では読めない、という意味。
  jsonld: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '親の障害者控除、過去5年分をさかのぼって取り戻すための手順書',
    url: `${SITE}/pack/`,
    isAccessibleForFree: false,
    hasPart: {
      '@type': 'WebPageElement',
      isAccessibleForFree: false,
      cssSelector: '.peek',
    },
    offers: { '@type': 'Offer', price: String(PRICE), priceCurrency: 'JPY' },
  },
  body: `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 還付申請パック</p>
  <h1>親の障害者控除、<br>過去5年分をさかのぼって取り戻すための手順書</h1>
  <p class="updated">最終更新：${TODAY} ／ ${items.length}市区町村版をご用意しています</p>

  <p class="lead">要介護認定を受けている親御さんは、<strong>障害者手帳がなくても</strong>市区町村の認定を受ければ障害者控除が使えます。
  しかも<strong>過去5年分までさかのぼって請求できます</strong>。所得税率20%で同居されている場合、5年で<strong>100万円を超える</strong>ことがあります。</p>

  <div class="callout point"><p><span class="tag">無料で読めること</span>
  <strong>お住まいの市区町村で対象になる基準は、無料で公開しています。</strong>
  → <a href="../shogai-kojo/">全国の認定基準を比べる</a>　制度の説明は<a href="../articles/shogaisha-kojo-tax.html">こちら</a>。
  こちらのページで足りる方は、購入する必要はありません。</p></div>
  <p class="cta-row"><a class="btn-primary" href="#kau">${PRICE}円で手順書を受け取る&nbsp;→</a> <span class="cta-note">市区町村を選んでカード決済。すぐダウンロードできます</span></p>

  <h2>このパックに入っているもの</h2>
  <p>無料ページで「基準」は分かります。そこから先、実際に手続きを終えるまでに詰まるところをまとめました。</p>
  <div class="table-wrap"><table>
  <thead><tr><th>つまずくところ</th><th>パックに書いてあること</th></tr></thead>
  <tbody>
  <tr><th>親のランクが分からない</th><td>「認知症高齢者の日常生活自立度」「障害高齢者の日常生活自立度」は<strong>介護保険証には書かれていません</strong>。どの書類のどこに書いてあるか、手元にないときの取り寄せ方（開示請求）を具体的に。</td></tr>
  <tr><th>いくら戻るのか</th><td>所得税率5〜33%×障害者／特別障害者／同居特別障害者の<strong>9通りの試算表</strong>。年額と5年分。</td></tr>
  <tr><th>75万円の見落とし</th><td>同居している場合、控除は40万円ではなく<strong>75万円</strong>。ただし<strong>施設入所中は対象外</strong>。年ごとの判断の仕方。</td></tr>
  <tr><th>過去分の取り戻し方</th><td>確定申告済みなら<strong>更正の請求</strong>、未申告なら<strong>還付申告</strong>。どちらも5年。必要書類と出し方。</td></tr>
  <tr><th>窓口で何を言えばいいか</th><td>持ち物のチェックリストと、「過去◯年分も」と伝えるべき理由。</td></tr>
  </tbody></table></div>
  <p class="note">お住まいの市区町村の認定基準を差し込んだ版をお渡しします。HTMLファイル1つ（約12KB）。ブラウザで開けて、そのまま印刷して窓口に持っていけます。</p>

  ${/* ★2026-09-05 中身の冒頭を実物のまま見せる（note型の試験・ユーザー指示）。
        これまでこの面は中身を「表で説明」するだけで、実物を1行も見せていなかった。
        買う前に品物を見られないので、説明を信じるかどうかの賭けになっていた。

        ★守っていること
        (1) 出しているのは**実物のパックの本文そのまま**（市区町村名だけ一般化）。宣伝用の別文章ではない。
        (2) 切ったあとの本文は**HTMLに一切入れていない**。かすませているのは「ここで切れている」
            という印であって、隠し文字の上に膜を張っているのではない。ソースを見ても続きは無い。
            この点は画面にも書く（「剥がせば読める」と誤解されると、それは嘘になる）。
        (3) 一番おいしいところ（ランクがどの書類のどこに書いてあるか）を無料側に出す。
            出し惜しみして切ると、中身が薄いのを隠していると読まれる。
        (4) Googleへは isAccessibleForFree:false で申告する（上の jsonld）。
            人とクローラーに違うものを出していないので、隠さず書ける。
        (5) ★この艦のCSSはダークモードを持たない。ここだけ prefers-color-scheme を足すと
            本文が明るいまま枠だけ黒くなり、抜粋が読めなくなる（2026-09-05に実際そうなった）。
            親のCSSに無い前提を持ち込まない。 */''}
  <h2>中身を少しだけ読む</h2>
  <p>説明だけでは分からないと思うので、実物の冒頭をそのまま出します。市区町村名のところだけ伏せてあります。</p>
  <style>
  .peek{position:relative;border:1px solid #d7dee2;border-radius:12px;background:#fff;
    padding:22px 24px 0;margin:1.2em 0 0;overflow:hidden;max-height:36rem}
  .peek::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7rem;pointer-events:none;
    background:linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,.82) 58%,#fff 96%)}
  .peek>*:last-child{filter:blur(2.2px);opacity:.8}
  .peek h3.pk{font-size:1.24rem;margin:0 0 .2em;line-height:1.4}
  .peek h4.pk{font-size:1.02rem;margin:1.3em 0 .35em}
  .peek .pkmeta{font-size:.78rem;color:#68767c;margin:0 0 1.1em}
  .peek table{font-size:.9rem}
  .peekcut{position:relative;margin:-2.2rem 0 0;text-align:center;z-index:2}
  .peekcut span{display:inline-block;background:#e8f2f3;color:#14545e;
    font-size:.8rem;font-weight:700;border-radius:999px;padding:4px 14px}
  </style>
  <div class="peek" aria-label="パックの冒頭（抜粋）">
    <h3 class="pk">お住まいの市区町村版　親の障害者控除 還付申請パック</h3>
    <p class="pkmeta">フクシル（fukushiru.com） ／ 購入者のみ配布</p>
    <p><b>このパックは、要介護認定を受けている親御さんについて「障害者控除の対象になるか」を確かめ、過去にさかのぼって税金を取り戻すまでを、順番どおりに進めるためのものです。</b></p>
    <h4 class="pk">ステップ1　親の「自立度ランク」を調べる</h4>
    <h4 class="pk">ランクはどこに書いてあるか</h4>
    <p>「認知症高齢者の日常生活自立度」と「障害高齢者の日常生活自立度（寝たきり度）」は、介護認定のときに作られた次の書類に記載されています。<b>介護保険証には書かれていません。</b></p>
    <div class="table-wrap"><table>
    <thead><tr><th>書類</th><th>どこを見るか</th><th>手元にないとき</th></tr></thead>
    <tbody><tr><th>主治医意見書</th><td>「3. 心身の状態に関する意見」の欄。<b>障害高齢者の日常生活自立度</b>（J1〜C2）と<b>認知症高齢者の日常生活自立度</b>（Ⅰ〜M）が並んで書かれています。</td><td>市区町村の介護保険担当に<b>開示請求</b>をすれば写しがもらえます</td></tr></tbody>
    </table></div>
    <p>開示請求は無料か数百円で、1〜2週間かかることが多いです。確定申告の期限直前だと間に合わないことがあるので、先にここから始めてください。</p>
  </div>
  <p class="peekcut"><span>抜粋はここまで</span></p>
  <p class="note" style="margin-top:1.1rem">かすんでいるのは「ここで切れている」という印です。<strong>この先の本文はこのページに入っていません</strong>（ソースを見ても続きは出てきません）。上の抜粋は実物からそのまま持ってきたもので、宣伝用に書き直したものではありません。</p>
  <p>ここから先に入っているのは、次の4つです。</p>
  <ul>
  <li><strong>ステップ2　いくら戻るか試算する</strong>— 所得税率5〜33%×障害者／特別障害者／同居特別障害者の9通りの試算表（年額と5年分）</li>
  <li><strong>ステップ3　認定書をもらう</strong>— 申請の出し方と、窓口で伝えること</li>
  <li><strong>ステップ4　税金を取り戻す</strong>— 更正の請求と還付申告の出し分け、必要書類</li>
  <li><strong>ステップ5　確認</strong>— 持ち物のチェックリストと、住民税側で起きること</li>
  </ul>

  <h2 id="kau">受け取る</h2>
  <div class="offer">
  <p class="price"><b>${PRICE}円</b><span>買い切り・税込。HTMLファイル1つ、印刷してそのまま窓口へ</span></p>
  <p><label for="mun"><strong>お住まいの市区町村を選んでください</strong></label></p>
  <p><select id="mun" style="width:100%;max-width:22rem;padding:.5rem;font-size:1rem">
  <option value="">— 選択してください —</option>
  ${options}
  </select></p>
  <p style="margin-top:1rem"><button id="buy" class="btn-primary">${PRICE}円で手順書を受け取る</button>
  <span id="msg" style="margin-left:.8rem"></span></p>
  <p class="fine">クレジットカード決済（Stripe）。カード情報は当方を経由しません。お支払い後すぐダウンロードできます。<strong>買わなくても手続きはできます</strong>——無料で読める範囲は上のとおりです。</p>
  </div>

  <div class="callout warn"><p><span class="tag">先に確認してください</span>
  この控除で税金が戻るのは、<strong>親御さん本人が税を納めている</strong>か、<strong>あなたが親御さんを扶養親族として申告している</strong>場合です。
  どちらにも当てはまらないと、控除する税金がないため戻るお金はありません。パックにも同じことを書いています。</p></div>

  <p class="note">お読みください：<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../kiyaku/">利用規約</a>。
  当サイトは税理士事務所ではなく、個人が運営する情報サイトです。パックは一般的な案内であり、税務相談ではありません。</p>

<script>
(function(){
  var sel=document.getElementById('mun'), btn=document.getElementById('buy'), msg=document.getElementById('msg');
  btn.addEventListener('click', function(){
    if(!sel.value){ msg.textContent='市区町村を選んでください'; return; }
    if(window.__ev) window.__ev('buy_click');
    btn.disabled=true; msg.textContent='決済ページへ移動します…';
    fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:sel.value})})
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

// ── /pack/kanryo/ ───────────────────────────────────────────────────────────
write('pack/kanryo/index.html', page({
  title: 'ご購入ありがとうございます｜フクシル',
  desc: '障害者控除 還付申請パックのダウンロード画面です。',
  canonical: '/pack/kanryo/', depth: 2, noindex: true,
  body: `  <h1>ご購入ありがとうございます</h1>
  <p class="lead">下のボタンからダウンロードしてください。<strong>このページのURLは購入から60日間有効です。</strong>ブックマークしておくと再ダウンロードできます。</p>
  <p><a id="dl" class="card" style="display:inline-block;padding:.8rem 1.6rem;font-weight:600" href="#">パックをダウンロード（HTML）</a></p>
  <p id="msg" class="note"></p>
  <h2>使い方</h2>
  <ol>
  <li>ダウンロードしたファイルをブラウザで開きます。</li>
  <li>ステップ1から順に進めてください。まず<strong>主治医意見書の取り寄せ</strong>から始めると、あとが早く進みます。</li>
  <li>印刷して窓口へ持っていけます（ブラウザの印刷から「PDFに保存」もできます）。</li>
  </ol>
  <p class="note">開けない・内容が説明と違う・二重に決済された場合は、購入から14日以内に <a href="mailto:${SELLER.mail}">${SELLER.mail}</a> までご連絡ください。全額を返金します。
  領収書はStripeから届くメールでご確認いただけます。</p>
  <p class="related"><a href="../../shogai-kojo/">→ 全国の認定基準を比べる（無料）</a></p>
<script>
(function(){
  var sid=new URLSearchParams(location.search).get('session_id');
  var a=document.getElementById('dl'), msg=document.getElementById('msg');
  if(!sid){ a.style.display='none'; msg.textContent='購入の情報が見つかりません。購入後に表示されたURLからお越しください。'; return; }
  a.href='/api/pack?session_id='+encodeURIComponent(sid);
})();
</script>
`,
}))

// ── /tokushoho/ ─────────────────────────────────────────────────────────────
write('tokushoho/index.html', page({
  title: '特定商取引法に基づく表記｜フクシル',
  desc: '販売業者・所在地・連絡先・価格・支払方法・引渡時期・返品についての表記です。',
  canonical: '/tokushoho/', depth: 1,
  body: `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 特定商取引法に基づく表記</p>
  <h1>特定商取引法に基づく表記</h1>
  <p class="note">通信販売に関する表示です。<strong>無料で提供している部分（制度の解説・自治体別の認定基準・都営住宅の区市町別の相場・各種計算機）については、購入の必要はありません。</strong></p>
  <p class="note">販売している商品は次の2つです。どちらもHTMLファイルのダウンロード販売で、価格・引渡し・返品の条件は下表のとおり共通です。</p>
  <ul class="note">
  <li><a href="../pack/">親の障害者控除の還付申請一式</a>（市区町村ごと・${PRICE}円）</li>
  <li><a href="../toei/">都営住宅の申込先えらび</a>（${PRICE}円）</li>
  </ul>
  <div class="table-wrap"><table><tbody>
  <tr><th>販売業者</th><td>${esc(SELLER.name)}</td></tr>
  <tr><th>運営責任者</th><td>${esc(SELLER.name)}</td></tr>
  <tr><th>所在地</th><td>〒${esc(SELLER.zip)}　${esc(SELLER.addr)}</td></tr>
  <tr><th>電話番号</th><td>${esc(SELLER.tel)}<br><span class="note">受付時間：${esc(SELLER.hours)}。少人数で運営しているため、電話は留守番電話で承り、内容の確認とご返答はメールで行います。お急ぎの場合もメールをご利用ください。</span></td></tr>
  <tr><th>メールアドレス</th><td>${esc(SELLER.mail)}</td></tr>
  <tr><th>販売価格</th><td>${PRICE}円（消費税込み）</td></tr>
  <tr><th>商品代金以外の必要料金</th><td>ありません。通信料はお客様のご負担となります。</td></tr>
  <tr><th>お支払い方法</th><td>クレジットカード（Stripe による決済）</td></tr>
  <tr><th>お支払い時期</th><td>ご注文時にお支払いが確定します。</td></tr>
  <tr><th>引渡し時期</th><td>お支払いの完了後、ただちにダウンロードいただけます。</td></tr>
  <tr><th>返品・キャンセル</th><td>デジタルデータの性質上、ダウンロード後のお客様都合による返品・返金はお受けできません。<br>ただし<strong>ファイルが開けない場合、内容が説明と著しく異なる場合、二重に決済された場合</strong>は、購入から14日以内にメールでご連絡ください。全額を返金いたします。</td></tr>
  <tr><th>動作環境</th><td>HTMLファイルを開けるウェブブラウザ。印刷にも対応しています。</td></tr>
  </tbody></table></div>
  <p class="note"><a href="../kiyaku/">利用規約</a>／<a href="../about.html">このサイトについて</a></p>
`,
}))

// ── /kiyaku/ ────────────────────────────────────────────────────────────────
write('kiyaku/index.html', page({
  title: '利用規約｜フクシル',
  desc: 'フクシルの利用規約です。提供する内容の限界、有料パックの取り扱い、免責について定めています。',
  canonical: '/kiyaku/', depth: 1,
  body: `  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ 利用規約</p>
  <h1>利用規約</h1>
  <p class="lead">この規約は、${esc(SELLER.name)}（以下「当方」）が運営するフクシル（以下「本サイト」）の利用条件を定めるものです。本サイトを利用された方は、この規約に同意したものとみなします。</p>

  <h2>第1条（本サイトの目的）</h2>
  <p>本サイトは、知られていないために使われていない福祉・税の制度について、公表資料にもとづく情報を整理して提供することを目的とします。</p>

  <h2>第2条（提供する内容と、その限界）</h2>
  <ol>
  <li>本サイトの掲載内容は、各行政機関が公表した資料を当方が読み取って整理したものです。<strong>当方は税理士事務所・社会保険労務士事務所ではなく、個別の税務相談・行政手続の代理を行いません。</strong></li>
  <li>制度は改正され、自治体の運用も変わります。掲載内容は各ページに記した時点のものであり、<strong>最新であることを保証しません</strong>。</li>
  <li><strong>制度の適用可否を決めるのは行政機関です。</strong>本サイトの記載を根拠に対象になることを保証するものではありません。必ずお住まいの市区町村・税務署にご確認ください。</li>
  </ol>

  <h2>第3条（無料で提供する部分）</h2>
  <p>制度の解説、自治体別の認定基準、各種の計算機は無料で提供します。<strong>対象になるかどうかを知るために費用は必要ありません。</strong></p>

  <h2>第4条（有料パックについて）</h2>
  <ol>
  <li>有料パックは、無料部分では扱っていない<strong>手続きの進め方（書類の探し方、還付額の試算、申請と更正の請求の手順）</strong>をまとめた資料です。</li>
  <li>お支払いの完了後、ただちにダウンロードいただけます。ダウンロード用のURLは購入から<strong>60日間</strong>有効です。</li>
  <li>購入されたパックは、購入者ご本人およびそのご家族の手続きのためにご利用ください。<strong>再配布・再販売はご遠慮ください。</strong></li>
  <li>返品・返金の条件は<a href="../tokushoho/">特定商取引法に基づく表記</a>に定めるとおりです。</li>
  </ol>

  <h2>第5条（禁止事項）</h2>
  <ol>
  <li>本サイトの内容を、事実と異なる形に改変して再配布すること。</li>
  <li>自動化された手段により、本サイトに過大な負荷をかけること。</li>
  <li>法令に違反する目的で本サイトを利用すること。</li>
  </ol>

  <h2>第6条（免責）</h2>
  <p>本サイトの利用によって生じた損害について、当方は責任を負いません。ただし、当方の故意または重大な過失による場合はこの限りではありません。
  有料パックについては、当方に責任がある場合、<strong>お支払いいただいた金額を上限として返金</strong>いたします。</p>

  <h2>第7条（誤りのご指摘）</h2>
  <p>掲載内容に誤りを見つけられた場合は <a href="mailto:${SELLER.mail}">${SELLER.mail}</a> までご連絡ください。確認のうえ訂正します。</p>

  ${/* ★制定日はビルド日ではない（2026-09-01 修正）。
       それまで ${TODAY} を入れていたため、規約を1文字も変えていない日でも
       「制定：本日」に書き換わっていた。規約の制定日は約束の効力に関わる日付なので、
       中身を変えたときだけ手で動かす。 */''}
  <p class="note">制定：${KIYAKU_SEITEI}　／　<a href="../tokushoho/">特定商取引法に基づく表記</a>／<a href="../about.html">このサイトについて</a></p>
`,
}))

// ── sitemap に載せる（kanryo は購入者専用なので載せない）────────────────────
// ★自分のぶんだけ入れ替える。build.mjs が /shogai-kojo/ を、こちらが /pack/ 等を持つ。
//   互いのぶんを消さないよう、対象のパスを限定して置換すること。
const smPath = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(smPath, 'utf8')
sm = sm.replace(/^\s*<url>(?:(?!<\/url>)[\s\S])*\/(?:pack|tokushoho|kiyaku)\/[\s\S]*?<\/url>\n?/gm, '')
const add = ['/pack/', '/tokushoho/', '/kiyaku/']
  .map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod><priority>0.7</priority></url>`)
sm = sm.replace('</urlset>', add.join('\n') + '\n</urlset>')
fs.writeFileSync(smPath, sm)

console.log(`販売ページ 4枚（/pack/ ・/pack/kanryo/ ・/tokushoho/ ・/kiyaku/）／ 選択できる市区町村 ${items.length}`)
