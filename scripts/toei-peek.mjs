// 自動生成：scripts/toei-nerai.mjs が .dist/toei-pack.html と同じ行から書く。手で直さない。
// 有料資料の2章の冒頭。表は上3行で切っている。記事への貼り付けは scripts/stamp-offers.mjs。
// 資料＝2022年5月〜2026年5月の定期募集16回・読み取り日 2026-08-18
export const TOEI_PEEK = `    <h4 class="pk">2. 毎回すいている申込先（病死等があった住宅を除く・595件）</h4>
    <p>4件以上観測できて、倍率の<strong>中央値</strong>が5倍未満だったものだけを載せています。中央値で切っているので、<strong>1回だけたまたま空いた住宅は入りません</strong>。区市町ごと、倍率の低い順。</p>
    <h4 class="pk">三鷹市（16件）</h4>
    <div class="table-wrap"><table style="white-space:nowrap">
    <thead><tr><th>区市町</th><th>住宅</th><th>募集区分</th><th class="num">中央値</th><th class="num">最低</th><th class="num">最高</th><th class="num">観測</th><th class="num">申込0</th><th>EV</th><th>建築</th><th>同じ名前の町丁目（世帯・住宅侵入 2021〜2025年の5年間）</th></tr></thead>
    <tbody>
    <tr><td>三鷹市</td><td>中原四丁目第２</td><td>世帯向（一般募集住宅）</td><td class="num">0</td><td class="num">0</td><td class="num">3</td><td class="num">8</td><td class="num">5</td><td>有</td><td>昭和48</td><td><a href="https://living-environments.com/mitaka/e4b8ade58e9fe59b9be4b881e79bae/">中原四丁目</a>：世帯1,847・住宅侵入2件</td></tr>
    <tr><td>三鷹市</td><td>井口五丁目</td><td>世帯向（一般募集住宅）</td><td class="num">0.5</td><td class="num">0</td><td class="num">2</td><td class="num">8</td><td class="num">2</td><td>無</td><td>昭和62</td><td><a href="https://living-environments.com/mitaka/e4ba95e58fa3e4ba94e4b881e79bae/">井口五丁目</a>：世帯480・住宅侵入0件</td></tr>
    <tr><td>三鷹市</td><td>上連雀九丁目</td><td>世帯向（一般募集住宅）</td><td class="num">0.5</td><td class="num">0</td><td class="num">14</td><td class="num">7</td><td class="num">2</td><td>無</td><td>昭和51</td><td><a href="https://living-environments.com/mitaka/e4b88ae980a3e99b80e4b99de4b881e79bae/">上連雀九丁目</a>：世帯1,430・住宅侵入0件</td></tr>
    </tbody></table></div>
    <h4 class="pk">世田谷区（8件）</h4>`
// 抜粋の表の右端（住環境の数字）に添える注記。記事では抜粋の枠の外に置く（scripts/offer-block.mjs）。
export const TOEI_PEEK_NOTE = `抜粋の表の右端は、住宅名と同じ名前の町丁目の数字です（姉妹サイト<a href="https://living-environments.com/">住環境データ東京</a>が町丁目ごとに集計）。住宅侵入は2021〜2025年の5年間の<strong>件数そのもので、率ではありません</strong>（世帯の多い町ほど大きく出ます）。<strong>建物の所在地がその町丁目と一致しない場合があります</strong>。「（町全体・2つの丁目）」のように書いたものは、住宅名が町の名前までしか一致しなかったときの、町全体の合計です（丁目が3つ以下で、世帯が5,000未満の町だけ）。「数字なし」は、町が広いか、同じ区に同じ名前の町丁目が2つ以上あって決められないため、数字を付けていないという意味です（同じ名前の町丁目が見つからないものは「—」）。0件は被害がなかったという意味ではありません（警察に届出があって初めて数えられます）。出典＝警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（東京都オープンデータ・<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" rel="license">CC BY 4.0</a>）、総務省統計局「令和2年国勢調査 小地域集計」（世帯数）。当サイトが住宅名と突き合わせて加工したもので、警視庁・総務省統計局が作成したものではありません。`
// 売り場カードの文言に使う数（資料と同じ定数）：観測の下限（募集件数）・すいているの線（倍率）・募集回の数
export const TOEI_FACTS = {"minN":4,"suki":5,"rounds":16}
