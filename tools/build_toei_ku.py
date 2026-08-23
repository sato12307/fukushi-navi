#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""都営住宅の「申込者ゼロ（募集割れ）」を区市町ごとの1枚にほどく生成器。

入力: data/toei-boshuware.csv
      = tools/build_toei.py が検算ゲート（申込者数欄と倍率欄がともに0・区市町が行頭から
        読めた行のみ）を通して出した公開済みデータ。生PDF読み取り(data/toei-bairitsu.json)は
        .gitignore 済みで、このスクリプトは触らない。
      ∴ここに出る数字は既にサイトで公開・CSV配布済みの値の「区市町ごとの切り直し」であって、
        新しい推定は一切していない。レンジ補完も推測もしない（艦隊の原則）。

出力: articles/toei-<slug>.html （採用ゲートを通った区市町のみ）

★採用ゲート
  1区市町あたり「確認件数 >= 40」かつ「対象住宅数 >= 10」。
  これ未満の区市町はページを作らない（1データ点だけの薄いページを作らないため）。
  ゲートを通らなかった分は、これまでどおり koei-tokyo.html の⑦節の集計表に載る。

なぜ区市町ごとに分けるか:
  JKK東京は募集回ごとの倍率表PDFしか出さず、「この区のどの住宅が何回あまったか」を
  回をまたいで集計した資料は公表していない。検索側は「◯◯区 都営住宅 倍率」のように
  区市町名で引くのに、答えは都全体の平均しか無い、という空白がある。
"""
import csv, io, json, os, re, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC = os.path.join(PROJ, "data", "toei-boshuware.csv")
ARTDIR = os.path.join(PROJ, "articles")

MIN_ROWS = 40
MIN_DANCHI = 10

SLUGS = {
    "足立区": "adachi", "葛飾区": "katsushika", "江東区": "koto", "板橋区": "itabashi",
    "練馬区": "nerima", "江戸川区": "edogawa", "世田谷区": "setagaya", "杉並区": "suginami",
    "品川区": "shinagawa", "墨田区": "sumida", "荒川区": "arakawa", "新宿区": "shinjuku",
    "渋谷区": "shibuya", "大田区": "ota", "中野区": "nakano",
    "八王子市": "hachioji", "町田市": "machida", "小平市": "kodaira",
    "東村山市": "higashimurayama", "清瀬市": "kiyose", "府中市": "fuchu",
    "国分寺市": "kokubunji", "昭島市": "akishima", "三鷹市": "mitaka",
    "立川市": "tachikawa", "調布市": "chofu", "東大和市": "higashiyamato",
    "日野市": "hino", "武蔵野市": "musashino", "国立市": "kunitachi",
    "多摩市": "tama", "東久留米市": "higashikurume", "小金井市": "koganei",
    "稲城市": "inagi", "青梅市": "ome", "福生市": "fussa", "瑞穂町": "mizuho",
    "武蔵村山市": "musashimurayama",
}

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def era_year(e):
    """'昭和56' -> 1981（年度）。読めなければ None。"""
    m = re.match(r"(昭和|平成|令和)([0-9]+)", (e or "").strip())
    if not m:
        return None
    return {"昭和": 1925, "平成": 1988, "令和": 2018}[m.group(1)] + int(m.group(2))


def round_key(w):
    """'令和4年5月' -> (2022, 5)。並べ替えのためだけに使う。"""
    m = re.match(r"(平成|令和)([0-9]+)年([0-9]+)月", (w or "").strip())
    if not m:
        return (9999, 99)
    y = {"平成": 1988, "令和": 2018}[m.group(1)] + int(m.group(2))
    return (y, int(m.group(3)))


PAGE = r"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@CITY@@の都営住宅 倍率0倍だった住宅一覧【申込者ゼロ@@N@@件】｜フクシル</title>
<meta name="description" content="@@DESC@@">
<link rel="canonical" href="https://fukushiru.com/articles/@@SLUG@@.html">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="@@CITY@@の都営住宅で申込者ゼロだった住宅一覧">
<meta property="og:description" content="@@DESC@@">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="https://fukushiru.com/articles/@@SLUG@@.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css">
<script type="application/ld+json">
@@JSONLD@@
</script>
<style>
.ratio-table { min-width: 560px; font-size: .88rem; }
.ratio-table th, .ratio-table td { padding: 8px 8px; text-align: left; vertical-align: top; }
.ratio-table th[scope=row] { white-space: nowrap; }
.ratio-table td.lo { font-weight: 700; white-space: nowrap; color: #a23; }
.ratio-table td.num { white-space: nowrap; }
</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="../index.html">フクシル <small>知らないと損する、街ごとの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="../index.html">トップ</a>
      <a href="koei-jutaku-bairitsu.html">公営住宅</a>
      <a href="shogai-nenkin-basics.html">障害年金</a>
      <a href="shinkansen-airplane-discount.html">交通割引</a>
      <a href="shogaisha-kojo-tax.html">障害者控除</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="koei-jutaku-bairitsu.html">公営住宅</a> ＞ <a href="koei-tokyo.html">東京都</a> ＞ @@CITY@@</p>

  <h1>@@CITY@@の都営住宅で申込者ゼロだった住宅<br>【2022〜2026年・定期募集@@ROUNDS@@回の実測】</h1>
  <p class="updated">最終更新：@@UPDATED@@ ／ 出典＝JKK東京「申込地区別倍率表」PDF@@ROUNDS@@回分の読み取り</p>

  <p class="lead">都営住宅は「倍率が高くて当たらない」と語られますが、<strong>誰も申し込まなかった住戸募集</strong>も毎回出ています。@@CITY@@では、令和4年5月〜令和8年5月の定期募集@@ROUNDS@@回のうち<strong>@@N@@件（のべ@@KOHO@@戸）・@@NDAN@@住宅</strong>で申込者ゼロが確認できました。JKK東京は募集回ごとに倍率表を出すだけで、回をまたいで「どの住宅が何回あまったか」をまとめた資料は公表していないため、ここでは16回分を読み直して@@CITY@@のぶんだけを取り出しています。</p>

  <div class="callout point">
    <p><span class="tag">数字だけ</span>@@CITY@@の申込者ゼロは<strong>@@N@@件</strong>。これは都内@@RANK@@番目に多く、都全体で確認できた@@TOTAL@@件の<strong>@@SHARE@@%</strong>にあたります。うち<strong>@@EV@@件（@@EVPCT@@%）はエレベーター付き</strong>、<strong>@@NEW@@件</strong>は2000年代以降に建てられた住宅でした。もっとも多く申込者ゼロが確認できたのは<strong>@@TOPNAME@@（@@TOPCNT@@回）</strong>です。</p>
  </div>

  <h2 id="danchi">① @@CITY@@で申込者ゼロが確認できた住宅（全@@NDAN@@住宅）</h2>
  <p>同じ住宅が何度もあまっているのか、たまたま1回だけだったのかで意味が変わります。@@ROUNDS@@回を通した確認回数の多い順に並べました。</p>
@@TBL_DANCHI@@

  <h2 id="round">② 募集回ごとの件数（@@CITY@@）</h2>
  <p>件数は募集回ごとの募集戸数や条件で動きます。<strong>0件は「この読み取りでは確認できなかった」という意味</strong>で、その回に募集割れが無かったと確定させるものではありません（下の「この数字の限界」参照）。</p>
@@TBL_ROUND@@

  <h2 id="kubun">③ 募集区分・建築年代の内訳</h2>
@@TBL_KUBUN@@

  <div class="callout warn">
    <p><span class="tag">この数字の限界</span>ここに出したのは<strong>下限</strong>です。JKK東京の倍率表PDFは回ごとに列の作りが違い、機械での読み取りは一部の行を正しく復元できません。そこで<strong>同じ行の申込者数欄と倍率欄がともに0と読めた行だけ</strong>を採用し、区市町も行頭に明記されていた行に限っています。したがって@@CITY@@の実際の募集割れは、ここに出した@@N@@件より<strong>多い</strong>はずです。少なくはなりません。</p>
    <p><strong>「募集割れ＝誰でも入れる」ではありません。</strong>申込資格（収入基準・住宅困窮要件・単身可否など）を満たすことが前提で、同じ住宅でも回によって募集の有無・戸数・間取り・入居人数の条件が変わります。<strong>過去にあまった住宅が次回も募集に出るとはかぎりません。</strong>申し込む前に、その回の募集案内で必ず条件を確認してください。</p>
  </div>

  <div class="callout note">
    <p><span class="tag">先に確かめておくこと</span>都営住宅の申込みには収入の上限があります（政令月収158,000円以下、裁量階層は214,000円以下）。<a href="koei-shunyu-kijun.html">政令月収の判定計算機</a>で先に確かめられます。倍率が高い住戸でも、障害者・高齢者・ひとり親などは<a href="koei-hairiyasui.html">優遇抽選</a>で当選確率を上げられます。</p>
  </div>

  <h2>よくある質問</h2>
  <h3>Q. @@CITY@@の都営住宅で倍率が低いのはどの住宅ですか？</h3>
  <p>A. @@FAQ_A@@</p>
  <h3>Q. @@CITY@@の都営住宅の空き状況はどこで見られますか？</h3>
  <p>A. 都営住宅は、賃貸情報サイトのように空き室が常時公開される仕組みではありません。年4回ごろの定期募集（例年5月・8月・11月・2月）の回ごとに「募集案内」で対象住宅が示され、そこに載った住戸だけが申込み・抽選の対象になります。したがって見るべきは「いま空いている部屋」ではなく「次の募集にどの住宅が出るか」です。募集の有無・時期・申込方法は、募集事務を行うJKK東京（東京都住宅供給公社）と東京都住宅政策本部の公式ページで必ず確認してください。</p>

  <section class="related" aria-label="関連記事">
    <h2 style="border:0">関連</h2>
    <ul>
      <li><a href="koei-tokyo.html#boshuware">東京都の都営住宅 当選倍率（区市町別の全体像・募集割れ@@TOTAL@@件の集計）</a></li>
      <li><a href="koei-hairiyasui.html">市営住宅に入りやすい人とは？（優遇・当たりやすい住戸の選び方）</a></li>
      <li><a href="koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまで？（政令月収の自動判定）</a></li>
      <li><a href="koei-yachin-keisan.html">公営住宅の家賃はいくら？（収入から家賃を試算）</a></li>
      <li><a href="koei-danchi-ranking.html">団地別 応募倍率ランキング（全国12市を横断）</a></li>
@@SIBLINGS@@
    </ul>
  </section>

  <h2>出典</h2>
  <ul class="sources">
    <li>JKK東京（東京都住宅供給公社）「都営住宅入居者募集 抽せん倍率表（申込地区別倍率表）」令和4年5月〜令和8年5月の定期募集@@ROUNDS@@回分 https://www.to-kousya.or.jp/kouei/toeibosyu/</li>
    <li>東京都住宅政策本部「都営住宅の入居者募集」 https://www.juutakuseisaku.metro.tokyo.lg.jp/</li>
  </ul>
  <p class="mini-note">@@CITY@@を含む全@@TOTAL@@件の明細は<a href="../data/toei-boshuware.csv" download>募集割れ一覧（@@TOTAL@@件・CSV）</a>で配布しています。出典（フクシル https://fukushiru.com/articles/@@SLUG@@.html ）を明記していただければ、表・数値の転載は自由です。</p>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは公開情報にもとづく<strong>一般的な情報の共有</strong>です。掲載しているのは過去の募集回で申込者ゼロと読み取れた記録であって、現在の募集状況・空室状況ではありません。申込資格・募集の有無・可否は、必ずJKK東京および東京都の公式情報・窓口でご確認ください。
  </div>
</main>

<footer class="site-footer">
  <div class="inner">
    <p><strong>フクシル</strong>（仮）— 知らないと損する、街ごとの福祉制度を当事者目線でまとめる情報サイトです。</p>
    <p><a href="../index.html">トップへ戻る</a> ／ <a href="../about.html">このサイトについて</a></p>
    <p>© 2026 フクシル. 本サイトの情報は一般的な参考情報であり、正確性を保証するものではありません。</p>
  </div>
</footer>
</body>
</html>
"""


def table(cap, head, rows):
    tr = "\n".join(
        "      <tr>" + "".join(
            ('<th scope="row">%s</th>' % c) if i == 0 else ('<td class="%s">%s</td>' % (cls, c))
            for i, (c, cls) in enumerate(r)
        ) + "</tr>" for r in rows
    )
    th = "".join('<th scope="col">%s</th>' % h for h in head)
    return ('  <div class="table-wrap">\n  <table class="ratio-table">\n'
            '    <caption>%s</caption>\n    <thead><tr>%s</tr></thead>\n'
            '    <tbody>\n%s\n    </tbody>\n  </table>\n  </div>' % (cap, th, tr))


def main():
    if not os.path.exists(SRC):
        print("[skip] %s が無い" % SRC)
        return 0
    with open(SRC, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if len(rows) < 200:
        print("[skip] 行が少なすぎる (%d)" % len(rows))
        return 0

    total = len(rows)
    all_rounds = sorted({r["募集回"] for r in rows}, key=round_key)
    by_city = Counter(r["区市町"] for r in rows)
    dan_by_city = defaultdict(set)
    for r in rows:
        dan_by_city[r["区市町"]].add(r["住宅名"])
    order = [c for c, _ in by_city.most_common()]

    targets = [c for c in order
               if by_city[c] >= MIN_ROWS and len(dan_by_city[c]) >= MIN_DANCHI]
    targets = [c for c in targets if c in SLUGS]
    updated = "2026-08-24"

    written = []
    for city in targets:
        slug = "toei-" + SLUGS[city]
        z = [r for r in rows if r["区市町"] == city]
        n = len(z)
        koho = sum(int(r["募集戸数"] or 0) for r in z)
        nd = len(dan_by_city[city])
        ev = sum(1 for r in z if r["エレベーター"] == "有")
        new = sum(1 for r in z if (era_year(r["建築年度"]) or 0) >= 2000)
        rank = order.index(city) + 1

        # 住宅別
        cnt = Counter(r["住宅名"] for r in z)
        info = {}
        for r in z:
            d = info.setdefault(r["住宅名"], {"koho": 0, "era": set(), "ev": set(),
                                              "rounds": [], "ninzu": set()})
            d["koho"] += int(r["募集戸数"] or 0)
            d["era"].add(r["建築年度"])
            d["ev"].add(r["エレベーター"])
            d["rounds"].append(r["募集回"])
            d["ninzu"].add(r["入居人数"])
        drows = []
        for name, c in sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0])):
            d = info[name]
            last = sorted(d["rounds"], key=round_key)[-1]
            # 同じ住宅名でも棟・住戸によって築年もEVも違う（実データで63/577住宅が混在）。
            # 代表値を1つ選ぶと嘘になるので、混在はそのまま「住戸により異なる」と出す。
            eras = sorted((e for e in d["era"] if era_year(e)), key=era_year)
            if not eras:
                era_txt = "—"
            elif len(eras) == 1:
                era_txt = "%s（%s年度）" % (esc(eras[0]), era_year(eras[0]))
            else:
                era_txt = "%s〜%s（住戸により異なる）" % (esc(eras[0]), esc(eras[-1]))
            evs = sorted(x for x in d["ev"] if x)
            ev_txt = "—" if not evs else (esc(evs[0]) if len(evs) == 1 else "有・無が混在")
            drows.append([
                (esc(name), ""), ("%d回" % c, "lo" if c >= 3 else "num"),
                ("%d戸" % d["koho"], "num"), (era_txt, "num"),
                (ev_txt, "num"), (esc(last), "num"),
            ])
        tbl_danchi = table(
            "%s 申込者ゼロが確認できた住宅（%s〜%s・%d回）" % (esc(city), esc(all_rounds[0]), esc(all_rounds[-1]), len(all_rounds)),
            ["住宅名", "確認回数", "のべ募集戸数", "建築年度", "エレベーター", "直近に確認できた回"],
            drows)

        # 募集回別
        rc = Counter(r["募集回"] for r in z)
        rk = defaultdict(int)
        for r in z:
            rk[r["募集回"]] += int(r["募集戸数"] or 0)
        rrows = [[(esc(rd), ""), ("%d件" % rc.get(rd, 0), "lo" if rc.get(rd, 0) else "num"),
                  ("%d戸" % rk.get(rd, 0), "num")] for rd in all_rounds]
        tbl_round = table("%s 募集回ごとに確認できた申込者ゼロの件数" % esc(city),
                          ["募集回", "確認件数", "のべ募集戸数"], rrows)

        # 区分・年代
        kc = Counter(r["募集区分"] for r in z)
        krows = [[(esc(k), ""), ("%d件" % v, "num"), ("%.0f%%" % (100.0 * v / n), "num")]
                 for k, v in kc.most_common()]
        dec = Counter()
        for r in z:
            y = era_year(r["建築年度"])
            if y:
                dec[(y // 10) * 10] += 1
        for k in sorted(dec):
            krows.append([("%d年代に建てられた住宅" % k, ""), ("%d件" % dec[k], "num"),
                          ("%.0f%%" % (100.0 * dec[k] / n), "num")])
        tbl_kubun = table("%s 募集区分別・建築年代別の内訳（%d件）" % (esc(city), n),
                          ["区分", "件数", "割合"], krows)

        topname, topcnt = cnt.most_common(1)[0]
        rep = [k for k, v in cnt.most_common() if v >= 3][:5]
        faq_a = (
            "%sの定期募集%d回分で、申込者ゼロ（倍率0.0倍）と読み取れた住戸募集は%d件・%d住宅ありました。"
            "確認回数がもっとも多いのは%s（%d回）です。%s"
            "ただしこれは過去の記録で、次回の募集に同じ住宅が出るとはかぎりません。"
            "また申込資格（収入基準・住宅困窮要件・単身入居の可否）を満たすことが前提です。"
            % (esc(city), len(all_rounds), n, nd, esc(topname), topcnt,
               ("3回以上あまった住宅は%s など%d住宅です。" % ("・".join(esc(x) for x in rep), len([k for k, v in cnt.items() if v >= 3]))) if rep else ""))

        desc = ("%sの都営住宅で、定期募集に誰も申し込まなかった（申込者ゼロ・倍率0倍）住戸募集を、"
                "JKK東京の倍率表%d回分から数え直しました。%sでは%d件・%d住宅で確認。"
                "うちエレベーター付きは%d件。住宅名・確認回数・建築年度・募集回まで一覧にしています。"
                % (city, len(all_rounds), city, n, nd, ev))

        canon = "https://fukushiru.com/articles/%s.html" % slug
        headline = "%sの都営住宅で申込者ゼロだった住宅一覧【定期募集%d回の実測】" % (city, len(all_rounds))
        artld = json.dumps({
            "@context": "https://schema.org", "@type": "Article",
            "headline": headline, "description": desc, "inLanguage": "ja",
            "url": canon, "mainEntityOfPage": {"@type": "WebPage", "@id": canon},
            "datePublished": "2026-08-24", "dateModified": updated,
            "author": {"@type": "Organization", "name": "フクシル"},
            "publisher": {"@type": "Organization", "name": "フクシル"},
            "isPartOf": {"@type": "WebSite", "name": "フクシル", "url": "https://fukushiru.com/"},
        }, ensure_ascii=False)
        faqld = json.dumps({
            "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": "%sの都営住宅で倍率が低いのはどの住宅ですか？" % city,
                 "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", faq_a)}},
                {"@type": "Question", "name": "%sの都営住宅の空き状況はどこで見られますか？" % city,
                 "acceptedAnswer": {"@type": "Answer", "text":
                    "都営住宅は、賃貸情報サイトのように空き室が常時公開される仕組みではありません。"
                    "年4回ごろの定期募集（例年5月・8月・11月・2月）の回ごとに募集案内で対象住宅が示され、"
                    "そこに載った住戸だけが申込み・抽選の対象になります。"
                    "募集の有無・時期・申込方法は、JKK東京（東京都住宅供給公社）と東京都住宅政策本部の公式ページで確認してください。"}},
            ]}, ensure_ascii=False)
        breadld = json.dumps({
            "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "トップ", "item": "https://fukushiru.com/"},
                {"@type": "ListItem", "position": 2, "name": "公営住宅",
                 "item": "https://fukushiru.com/articles/koei-jutaku-bairitsu.html"},
                {"@type": "ListItem", "position": 3, "name": "東京都",
                 "item": "https://fukushiru.com/articles/koei-tokyo.html"},
                {"@type": "ListItem", "position": 4, "name": city, "item": canon},
            ]}, ensure_ascii=False)

        siblings = "\n".join(
            '      <li><a href="toei-%s.html">%sの都営住宅で申込者ゼロだった住宅（%d件）</a></li>'
            % (SLUGS[o], esc(o), by_city[o]) for o in targets if o != city)

        page = PAGE
        for k, v in {
            "@@CITY@@": esc(city), "@@SLUG@@": slug, "@@DESC@@": esc(desc),
            "@@JSONLD@@": artld + "\n</script>\n<script type=\"application/ld+json\">\n"
                          + faqld + "\n</script>\n<script type=\"application/ld+json\">\n" + breadld,
            "@@UPDATED@@": updated, "@@ROUNDS@@": str(len(all_rounds)),
            "@@N@@": str(n), "@@KOHO@@": str(koho), "@@NDAN@@": str(nd),
            "@@RANK@@": str(rank), "@@TOTAL@@": "{:,}".format(total),
            "@@SHARE@@": "%.1f" % (100.0 * n / total),
            "@@EV@@": str(ev), "@@EVPCT@@": "%.0f" % (100.0 * ev / n), "@@NEW@@": str(new),
            "@@TOPNAME@@": esc(topname), "@@TOPCNT@@": str(topcnt),
            "@@TBL_DANCHI@@": tbl_danchi, "@@TBL_ROUND@@": tbl_round, "@@TBL_KUBUN@@": tbl_kubun,
            "@@FAQ_A@@": faq_a, "@@SIBLINGS@@": siblings,
        }.items():
            page = page.replace(k, v)

        out = os.path.join(ARTDIR, slug + ".html")
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)
        written.append(slug)
        print("wrote %s.html  (%d件 / %d住宅)" % (slug, n, nd))

    skipped = [c for c in order if c not in targets]
    print("total %d pages / ゲート外 %d 区市町" % (len(written), len(skipped)))
    return written


if __name__ == "__main__":
    main()
