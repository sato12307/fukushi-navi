# フクシル（仮）— 知らないと損する、街ごとの福祉制度ナビ

当事者目線で福祉制度（障害年金・障害者控除・交通割引・自治体の福祉サービス・就労支援）をまとめ、
読者どうしで体験を共有する**静的サイト**。まず「役に立つ福祉ブログ」として起動し、コメント（giscus）で
情報交換の場を育てる方針。検索流入（正攻法SEO）を主集客に、当事者からはお金を取らず**就労支援・福祉
サービスの広告/送客**で運営費をまかなう（記事の中立性を最優先）。

> これは「福祉制度Glossa／自治体格差」アイデアのMVPです。まず三大都市（名古屋・東京・大阪）から。

---

## ⚠ サイト名は「仮」です（朝イチで決めて）
visible なブランド名は `フクシル` を仮置き。気に入らなければ一括置換でOK。候補：
**フクシル / 福祉くらべ / くらしの福祉ナビ / 手帳ナビ / ふくしマップ**。
（HTMLの `フクシル` と `<title>`／OGPを置換するだけ。）

## 何ができていて、何が未完か
- ✅ トップ `index.html`、`about.html`、共有CSS `assets/style.css`
- ✅ 記事5本 `articles/*.html`（下記）。SEO head・JSON-LD・FAQ・出典・免責つき
- ✅ `robots.txt` / `sitemap.xml`
- ✅ コメント（**Cusdis＝GitHub不要・匿名OK**）を全記事に**組み込み済み**（※下の App ID 設定で有効化）
- ⏳ あなたの作業：①公開URLの置換 ②giscus設定 ③内容チェック（`CONTENT-REVIEW.md`）④Search Console登録
- ⏳ 未実装（今後）：マネタイズ（広告/送客）枠、キーワードの検索ボリューム精査、都市追加

### 記事一覧
| ファイル | テーマ |
|---|---|
| `articles/jichitai-transport-medical.html` | 三大都市の交通・医療費助成 比較（目玉・テンプレ） |
| `articles/shinkansen-airplane-discount.html` | 新幹線・飛行機の障害者割引（2025年〜精神手帳も対象） |
| `articles/shogai-nenkin-basics.html` | 障害年金の基礎と更新（障害状態確認届） |
| `articles/shogaisha-kojo-tax.html` | 障害者控除（所得税・住民税・同居特別） |
| `articles/shurou-ikou-koyou.html` | 障がい者雇用・就労移行支援の仕組み |

---

## デプロイ手順（GitHub Pages・ビルド不要）
1. GitHubで新規リポジトリ（例 `fukushi-navi`）を作成し、このフォルダの中身をpush。
2. リポジトリ Settings → Pages → Source を `Deploy from a branch`、`main` / `(root)` に。
   公開URLは `https://<ユーザー名>.github.io/fukushi-navi/`。
3. **プレースホルダURLの一括置換**：全ファイルの `https://example.github.io/fukushi-navi` を実URLに置換
   （対象：各HTMLの `canonical`・`og:url`、`sitemap.xml`、`robots.txt`）。
4. **コメント（Cusdis＝GitHub不要・匿名OK）設定**：
   - https://cusdis.com に登録（無料・メールのみ）→ Website を1つ作成 → 表示される **App ID** をコピー。
   - 全 `articles/*.html`（6本）の `data-app-id="REPLACE_CUSDIS_APP_ID"` を、その App ID に一括置換。
   - 訪問者は **GitHubアカウント不要・名前だけ（匿名可）でコメント可**。スパム対策にCusdis管理画面で「承認制（Approve）」をONにするのがおすすめ。
   - 記事ごとに `data-page-id` でスレッドが分かれます。App IDを入れるまでコメント欄は表示されません（記事自体は問題なく公開されます）。
   - ※giscus（GitHub必須）は当事者に障壁が大きいため不採用。もし将来GitHub前提でよければ giscus へ差し替えも可。
5. **Google Search Console** に公開URLを登録 → `sitemap.xml` を送信 → 主要記事を「URL検査 → インデックス登録をリクエスト」。
   （FaultLineで学んだ通り、ここが検索流入の実レバー。数ヶ月の長期戦前提。）

## 内容チェック（公開前に必ず）
`CONTENT-REVIEW.md` に、記事ごとの **【要確認】項目** と **出典URL** を一覧化しています。
福祉の数字は変わるので、公開前に当事者＝あなたの目で確認し、必要なら本文を修正してください
（特に金額・等級・自己負担・最新年度）。AIが書いた草稿なので、事実確認はあなたが最終責任を持つ前提です。

## 技術メモ
- 純粋な静的HTML/CSS。ビルド工程なし＝pushで即反映。
- 文字は大きめ・行間広め・高コントラスト（福祉領域＝アクセシビリティ重視）。
- 記事の見た目を変えたいときは `assets/style.css` だけ触ればOK。
- 記事追加：`articles/` に既存記事をコピーして中身差し替え → `index.html` のカードと `sitemap.xml` に追記。

## マネタイズ（後日・当事者から取らない）
就労移行支援・障害者専門転職エージェント・グループホーム・福祉用具などの**広告/送客**を想定（この層に広告費を
出す市場は実在＝既存の就労支援系SEOサイトが証明）。実装はトラフィックが付いてから。記事の中立性を壊さないこと。
