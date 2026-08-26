#!/usr/bin/env python3
# data/koei-cities.json から「団地・住戸別 応募倍率ランキング（12市横断）」を生成する。
#
# なぜこのページが要るか:
#   各自治体は自分の市の抽選結果しか出さないので、「同じ倍率でも他市ではどの水準か」
#   「同じ市の中で最高と最低が何倍ひらいているか」を横に並べた資料がどこにも無い。
#   市別ページ(build_koei_cities.py)は各市の実例を載せるだけで、横断の順位は付かない。
#
# 誠実性の線（この艦の原則）:
#   - 推定・レンジ補完はしない。JSONに書いてある値をそのまま出す（表示は原文のまま）。
#   - 「約」「以上」といった但し書きは落とさず、比率にも引き継ぐ。
#   - この82件は各市が「高い例／低い例」として公表した両端の抜粋であって全住戸の母集団ではない。
#     したがって平均値・中央値は住戸レベルでは出さない（市内格差と最大/最小だけが妥当な統計）。
import json
import os
import re
import html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data", "koei-cities.json")
OUT = os.path.join(HERE, "articles", "koei-danchi-ranking.html")
SLUG = "koei-danchi-ranking"
CANON = "https://fukushiru.com/articles/{}.html".format(SLUG)


def esc(s):
    return html.escape(str(s), quote=True)


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", str(s or "")).strip()


def parse_ratio(raw):
    """'175.8倍' '約292倍' '100倍以上' '0倍（応募なし）' → (数値, 但し書き)
    但し書き: '' / '約' / '以上'。数値が読めなければ (None, '')。"""
    s = strip_tags(raw)
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", s)
    if not m:
        return None, ""
    val = float(m.group(1))
    if "以上" in s:
        return val, "以上"
    if "約" in s or "程度" in s or "前後" in s:
        return val, "約"
    return val, ""


def fmt_rel(val, qual, base):
    """市平均比。市平均が非公表の市は算出しない（推定しない）。"""
    if base in (None, "", 0) or val is None:
        return "—"
    try:
        r = val / float(base)
    except (TypeError, ValueError, ZeroDivisionError):
        return "—"
    t = ("{:.1f}".format(r)).rstrip("0").rstrip(".")
    if qual == "以上":
        return t + "倍以上"
    if qual == "約":
        return "約" + t + "倍"
    return t + "倍"


def collect(data):
    units = []
    for c in data.get("cities", []):
        base = c.get("calc_base")
        for kind, key in (("高い例", "top_units"), ("低い例", "bottom_units")):
            for u in c.get(key, []) or []:
                val, qual = parse_ratio(u.get("ratio", ""))
                units.append({
                    "city": c.get("name", ""),
                    "pref": c.get("pref", ""),
                    "base": base,
                    "kind": kind,
                    "name": strip_tags(u.get("name", "")),
                    "ratio_text": strip_tags(u.get("ratio", "")),
                    "val": val,
                    "qual": qual,
                    "attr": u.get("attr", ""),
                })
    return units


def rank_rows(units):
    rows = []
    ranked = sorted(
        [u for u in units if u["val"] is not None],
        key=lambda u: (-u["val"], u["city"], u["name"]),
    )
    for i, u in enumerate(ranked, 1):
        cls = "hi" if u["val"] >= 1 else "lo"
        rows.append(
            '      <tr><td class="rk">{i}</td><th scope="row">{n}</th>'
            '<td class="cty">{c}</td><td class="{cls}">{r}</td>'
            '<td class="rel">{rel}</td><td>{a}</td></tr>'.format(
                i=i, n=esc(u["name"]), c=esc(u["city"]), r=esc(u["ratio_text"]),
                rel=esc(fmt_rel(u["val"], u["qual"], u["base"])), a=u["attr"], cls=cls,
            )
        )
    return "\n".join(rows), ranked


def gap_rows(units):
    """市内格差。最低住戸は11市で0倍（応募ゼロ）なので「最高÷最低」は大半の市で割り算できない。
    そこで市をまたいで比較できる指標として「最高住戸が自分の市の平均の何倍か」を主軸に置き、
    最低住戸は実額（多くは0倍）をそのまま併記する。市平均が非公表の市は算出しない。"""
    bycity = {}
    for u in units:
        if u["val"] is None:
            continue
        bycity.setdefault(u["city"], []).append(u)
    out = []
    for city, us in bycity.items():
        hi = max(us, key=lambda x: x["val"])
        lo = min(us, key=lambda x: x["val"])
        base = us[0]["base"]
        mult = None
        if base not in (None, "", 0):
            try:
                mult = hi["val"] / float(base)
            except (TypeError, ValueError, ZeroDivisionError):
                mult = None
        out.append({
            "city": city, "base": base, "hi": hi, "lo": lo, "mult": mult,
            "mult_text": (fmt_rel(hi["val"], hi["qual"], base) if mult is not None else "—（市平均が非公表）"),
        })
    out.sort(key=lambda x: (1 if x["mult"] is None else 0, -(x["mult"] or 0)))
    html_rows = "\n".join(
        '      <tr><th scope="row">{c}</th><td>{b}</td>'
        '<td class="hi">{hn}<br><span class="sub">{hr}</span></td>'
        '<td class="gap">{m}</td>'
        '<td class="lo">{ln}<br><span class="sub">{lr}</span></td></tr>'.format(
            c=esc(x["city"]),
            b=(esc(x["base"]) + "倍" if x["base"] not in (None, "") else "非公表"),
            hn=esc(x["hi"]["name"]), hr=esc(x["hi"]["ratio_text"]),
            m=esc(x["mult_text"]),
            ln=esc(x["lo"]["name"]), lr=esc(x["lo"]["ratio_text"]),
        )
        for x in out
    )
    return html_rows, out


def zero_rows(ranked):
    """1倍未満＝募集戸数に応募が届かなかった住戸（ほぼ抽選なしで入れた枠）。"""
    zs = [u for u in ranked if u["val"] < 1]
    zs.sort(key=lambda u: (u["val"], u["city"]))
    return "\n".join(
        '      <tr><th scope="row">{n}</th><td class="cty">{c}</td>'
        '<td class="lo">{r}</td><td>{a}</td></tr>'.format(
            n=esc(u["name"]), c=esc(u["city"]), r=esc(u["ratio_text"]), a=u["attr"],
        )
        for u in zs
    ), zs


def ev_class(name, attr):
    """資料が『エレベーターなし／あり』に触れているかを判定する。
    住戸名の但し書き（例:『明石穂（EVなし・単身者向け）』）が最も確かなので名前を先に見る。
    触れていない住戸は '?'（不明）とし、無いものとして数えない（推定しない）。"""
    for t in (strip_tags(name), strip_tags(attr)):
        if ("EVなし" in t) or ("EV無" in t) or ("エレベーターなし" in t):
            return "no"
        if ("EV有" in t) or ("EV付" in t) or ("EVあり" in t) or ("エレベーター有" in t) or ("エレベーター付" in t):
            return "yes"
    return "?"


def ev_rows(units):
    """エレベーターの有無が資料に明記されている住戸だけを倍率の高い順に並べる。"""
    pool = [u for u in units if u["val"] is not None and ev_class(u["name"], u["attr"]) != "?"]
    pool.sort(key=lambda u: (-u["val"], u["city"], u["name"]))
    label = {"no": "なし", "yes": "あり"}
    rows = "\n".join(
        '      <tr><th scope="row">{n}</th><td class="cty">{c}</td>'
        '<td class="{cls}">{r}</td><td class="cty">{e}</td><td>{a}</td></tr>'.format(
            n=esc(u["name"]), c=esc(u["city"]), r=esc(u["ratio_text"]),
            e=label[ev_class(u["name"], u["attr"])], a=u["attr"],
            cls=("hi" if u["val"] >= 1 else "lo"),
        )
        for u in pool
    )
    no = [u for u in pool if ev_class(u["name"], u["attr"]) == "no"]
    yes = [u for u in pool if ev_class(u["name"], u["attr"]) == "yes"]
    stat = {
        "n": len(pool),
        "no": len(no), "no_lo": len([u for u in no if u["val"] < 1]),
        "no_hi": [u for u in no if u["val"] >= 1],
        "yes": len(yes), "yes_hi": len([u for u in yes if u["val"] >= 1]),
        "yes_lo": [u for u in yes if u["val"] < 1],
    }
    return rows, stat


def source_rows(data):
    seen = set()
    out = []
    for c in data.get("cities", []):
        for s in c.get("sources", []) or []:
            u = s.get("u", "")
            if u in seen:
                continue
            seen.add(u)
            out.append('    <li>{c}：{t} {u}</li>'.format(
                c=esc(c.get("name", "")), t=esc(s.get("t", "")), u=esc(u)))
    return "\n".join(out), len(seen)


PAGE = r"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>市営住宅・公営住宅の団地別 応募倍率ランキング【@@NCITY@@市@@NUNIT@@住戸を横断】｜フクシル</title>
<meta name="description" content="@@DESC@@">
<link rel="canonical" href="@@CANON@@">
<meta property="og:type" content="article">
<meta property="og:title" content="市営住宅・公営住宅の団地別 応募倍率ランキング【@@NCITY@@市@@NUNIT@@住戸を横断】">
<meta property="og:description" content="@@DESC@@">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="@@CANON@@">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/style.css">
<script type="application/ld+json">
@@JSONLD@@
</script>
<style>
.ratio-table { min-width: 640px; font-size: .88rem; }
.ratio-table th, .ratio-table td { padding: 8px 8px; text-align: left; vertical-align: top; }
.ratio-table th[scope=row] { white-space: nowrap; }
.ratio-table td.rk { width: 2.6em; color: var(--sub); text-align: right; white-space: nowrap; }
.ratio-table td.cty { white-space: nowrap; }
.ratio-table td.hi { font-weight: 700; white-space: nowrap; color: var(--brand-dark); }
.ratio-table td.lo { font-weight: 700; white-space: nowrap; color: #a23; }
.ratio-table td.rel { white-space: nowrap; color: var(--sub); }
.ratio-table td.gap { font-weight: 700; white-space: nowrap; }
.ratio-table span.sub { font-weight: 400; font-size: .82rem; color: var(--sub); }
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
  <p class="breadcrumb"><a href="../index.html">トップ</a> ＞ <a href="koei-jutaku-bairitsu.html">公営住宅</a> ＞ 団地別ランキング</p>

  <h1>市営住宅・公営住宅の<br>団地別 応募倍率ランキング<br>【@@NCITY@@市@@NUNIT@@住戸を横断】</h1>
  <p class="updated">最終更新：@@UPDATED@@ ／ 出典は各市の公式資料（末尾に@@NSRC@@件）。倍率は募集回で変わる<strong>参考値</strong>です</p>

  <p class="lead">公営住宅の抽選結果は<strong>市ごとにバラバラの形式で公表され、他市と並べた資料がどこにもありません</strong>。このページは@@NCITY@@市が公表した団地・住戸別の応募倍率<strong>@@NUNIT@@件</strong>を1枚に集めて、高い順に並べ直したものです。あわせて、その住戸が<strong>自分の市の平均の何倍か</strong>、そして<strong>同じ市の中に最高と最低がどう同居しているか</strong>を出しています。数値は各市の公表値そのままで、推定や補完はしていません。</p>

  <div class="callout point">
    <p><span class="tag">この表からわかること</span>@@FACT1@@</p>
    <p>@@FACT2@@</p>
    <p>@@FACT3@@</p>
  </div>

  <div class="callout warn">
    <p><span class="tag">読み方の注意（重要）</span>ここに載っているのは、各市が<strong>「倍率が高かった例」「低かった例」として公表した両端の抜粋</strong>です。全住戸から無作為に選んだものではないので、<strong>この@@NUNIT@@件の平均や中央値を「公営住宅の平均倍率」として読むことはできません</strong>（市全体の平均は<a href="koei-jutaku-bairitsu.html#toukei">まとめページの統計データ</a>にあります）。また<strong>集計の年度も募集区分（単身向／世帯向／一般）も市ごとに違う</strong>ため、市をまたいだ絶対値の比較は目安にとどめ、市平均比の列とあわせて見てください。</p>
  </div>

  <h2 id="gap">① 「市の平均倍率」は住戸選びの役に立たない</h2>
  <p>市の平均倍率だけを見ても、実際に申し込む住戸が当たるかは分かりません。各市の最高住戸が<strong>自分の市の平均の何倍あるか</strong>を出すと、市をまたいでも同じ物差しで比べられます。並べてみると、<strong>「どの市に住むか」より「どの住戸を選ぶか」の方がはるかに効く</strong>ことが数字で見えます。</p>
  <div class="table-wrap">
  <table class="ratio-table">
    <caption>最高住戸は市平均の何倍か（各市の公表資料より・@@NCITY@@市）</caption>
    <thead><tr><th scope="col">市</th><th scope="col">市全体の平均</th><th scope="col">最も高かった住戸</th><th scope="col">市平均の何倍</th><th scope="col">最も低かった住戸</th></tr></thead>
    <tbody>
@@GAP@@
    </tbody>
  </table>
  </div>
  <p style="font-size:.88rem;color:var(--sub)">市全体の平均が「非公表」の市（千葉市・神戸市）は、市が数値を出していないため倍率を算出していません（当サイトでは推定しません）。最低住戸の欄が0倍の市が多いのは、同じ募集回に応募が1件も入らない住戸が普通に出るためで、最高と最低の比を取ると割り算ができなくなります。そのため比較の軸は「市平均の何倍か」に置いています。</p>

  <h2 id="ranking">② 団地・住戸別 応募倍率ランキング（高い順・@@NUNIT@@件）</h2>
  <p>@@NCITY@@市ぶんを応募倍率の高い順に通しで並べました。「市平均比」は、その住戸の倍率が<strong>市全体の平均の何倍か</strong>です（市が平均を公表していない千葉市・神戸市は「—」）。</p>
  <div class="table-wrap">
  <table class="ratio-table">
    <caption>団地・住戸別の応募倍率（@@NCITY@@市@@NUNIT@@件・出典は末尾）</caption>
    <thead><tr><th scope="col">#</th><th scope="col">団地・住戸</th><th scope="col">市</th><th scope="col">応募倍率</th><th scope="col">市平均比</th><th scope="col">特徴（分かる範囲）</th></tr></thead>
    <tbody>
@@RANK@@
    </tbody>
  </table>
  </div>

  <h2 id="zero">③ 応募が定員に届かなかった住戸（1倍未満・@@NZERO@@件）</h2>
  <p>倍率1倍未満は、<strong>その募集回では申し込めばほぼ入れた</strong>住戸です（0倍は応募ゼロ）。都市部でもこの枠は実在します。条件（バス便・築古・<a href="#ev">エレベーターなし上層階</a>など）を許容できるかどうかが分かれ目になります。</p>
  <div class="table-wrap">
  <table class="ratio-table">
    <caption>応募倍率1倍未満の住戸（@@NZERO@@件・低い順）</caption>
    <thead><tr><th scope="col">団地・住戸</th><th scope="col">市</th><th scope="col">応募倍率</th><th scope="col">特徴（分かる範囲）</th></tr></thead>
    <tbody>
@@ZERO@@
    </tbody>
  </table>
  </div>
  <p style="font-size:.88rem;color:var(--sub)">同じ住戸が次の募集でも1倍未満とは限りません。募集の号数・住戸の階数まで含めて、必ず各市の最新の募集案内でご確認ください。</p>

  <h2 id="ev">④ 応募ゼロの理由として資料がいちばん多く挙げているのは「エレベーターなし」</h2>
  <p>各市の資料は、なぜその住戸に応募が来ないのかを<strong>注記の形でしか書きません</strong>（「5階は募集割れ」「EV有無が応募ゼロの直接要因」など）。市ごとに読むと通りすぎてしまいますが、@@NCITY@@市ぶんを横に並べると同じ注記が繰り返し出てきます。ここでは@@NUNIT@@件のうち、<strong>資料がエレベーターの有無に触れている@@NEV@@件</strong>だけを取り出して数え直しました（触れていない住戸は「無い」とはみなさず、数から除いています）。</p>

  <div class="callout point">
    <p><span class="tag">数え直した結果</span>@@EVFACT1@@</p>
    <p>@@EVFACT2@@</p>
  </div>

  <div class="table-wrap">
  <table class="ratio-table">
    <caption>エレベーターの有無が資料に明記されている住戸（@@NEV@@件・倍率の高い順）</caption>
    <thead><tr><th scope="col">団地・住戸</th><th scope="col">市</th><th scope="col">応募倍率</th><th scope="col">エレベーター</th><th scope="col">資料の注記</th></tr></thead>
    <tbody>
@@EVROWS@@
    </tbody>
  </table>
  </div>
  <p style="font-size:.88rem;color:var(--sub)">この@@NEV@@件は「エレベーターに触れている資料があった住戸」であって、無作為抽出ではありません。したがってここから<strong>公営住宅全体でエレベーターなしの住戸が何％空いているかは分かりません</strong>。分かるのは、<strong>各市が応募割れの理由として挙げた条件が市をまたいで一致している</strong>という事実です。なお当選後は毎日その階段を使うことになります。高齢の方・足に不安のある方・小さなお子さんのいる世帯では、当たりやすさと入居後の暮らしやすさが正面からぶつかる点だけは、申し込む前に見ておいてください。</p>

  <div class="callout note">
    <p><span class="tag">次に見るもの</span>狙う住戸の倍率の目安は<a href="koei-jutaku-bairitsu.html#hosei">住戸タイプ補正計算機</a>で、障害者・ひとり親などの<strong>優遇でどれだけ当たりやすくなるか</strong>は<a href="koei-hairiyasui.html">入りやすい人の条件</a>で確かめられます。申込みの前提になる収入基準は<a href="koei-shunyu-kijun.html">政令月収の判定計算機</a>、当選後の家賃は<a href="koei-yachin-keisan.html">家賃の自動計算</a>にあります。</p>
  </div>

  <div class="callout point">
    <p><span class="tag">データ配布</span>この表の元になった台帳をCSVで置いています（BOM付きUTF-8・Excelでそのまま開けます）。<br>
    ・<a href="../data/koei-danchi.csv" download>団地・住戸別の実例（@@NUNIT@@件・CSV）</a><br>
    ・<a href="../data/koei-bairitsu.csv" download>自治体別の応募倍率（CSV）</a><br>
    ・元データ（JSON）：<a href="../data/koei-cities.json">koei-cities.json</a></p>
  </div>

  <h2>このデータについて（引用・転載）</h2>
  <p>このランキングは、市ごとにバラバラに公表される抽選結果を当サイトが集約し、横に並べ直した一次整理です（毎月1日に再集計）。<strong>出典を明記していただければ、数字・表・CSVの引用と転載は自由です</strong>（リンクの有無は問いません）。推奨する記載例：<strong>「出典: フクシル（公営住宅の団地別 応募倍率ランキング） @@CANON@@」</strong>。倍率は募集回で変わるため、<strong>集計の時点（@@UPDATED@@）も併せて記載</strong>いただけると読者に親切です。数字の誤りや古くなった値を見つけた場合は、下のコメント欄（アカウント不要・匿名可）でお知らせいただければ確認して直します。</p>

  <h2>よくある質問</h2>
  <h3>Q. 公営住宅で倍率がいちばん高い団地はどこですか？</h3>
  <p>A. 当サイトが集めた@@NCITY@@市@@NUNIT@@住戸の範囲では、@@TOPNAME@@（@@TOPCITY@@）の@@TOPRATIO@@が最高でした。ただしこれは各市が公表した例の中での比較で、全国の全団地を網羅した順位ではありません。倍率は募集回ごとに大きく変わります。</p>
  <h3>Q. 同じ市なら、どの団地でも倍率は同じくらいですか？</h3>
  <p>A. 違います。@@GAPTOP@@。倍率を動かしているのは主に「単身向けか世帯向けか」「駅までの距離」「築年」「エレベーターと階数」の4つで、この序列は調べた市で共通していました（この@@NUNIT@@件を因子別に数え直した内訳は<a href="koei-jutaku-bairitsu.html#factors">単身向けと世帯向けの応募倍率の実データ</a>にあります）。</p>
  <h3>Q. 単身向けと世帯向けでは、どちらが入りやすいですか？</h3>
  <p>A. 世帯向けです。この一覧を区分ごとに数え直すと、<strong>倍率が高かった側は単身者が申し込める住戸に大きく偏り、応募が定員に届かなかった住戸は世帯向けが最も多い</strong>という内訳でした（件数・割合は<a href="koei-jutaku-bairitsu.html#factors">まとめページの⑨〜⑫</a>）。単身向けは戸数そのものが少ないため、同じ団地でも単身区分だけ倍率が跳ね上がることがあります。</p>
  <h3>Q. エレベーターのない上の階は、ねらい目ですか？</h3>
  <p>A. この一覧の中では、<strong>いちばん応募が薄い条件</strong>でした。資料が「エレベーターなし」と明記した@@EVNO@@件のうち@@EVNOLO@@件が応募割れ（1倍未満）です（内訳は<a href="#ev">④</a>）。ただし2点だけ注意してください。ひとつは、<strong>エレベーター付きでも応募が割れた住戸が@@EVYESLO@@件ある</strong>ことで、郊外の世帯向けはエレベーターがあっても申込ゼロになります——つまり効く順番は「立地・募集区分 → エレベーターと階数」です。もうひとつは、当選後の生活です。入居は数年〜数十年続くので、いま階段が平気でも先々を含めて判断してください。</p>
  <h3>Q. 応募ゼロの住戸は、申し込めば必ず入れますか？</h3>
  <p>A. 必ずとは言えません。0倍はあくまで<strong>その募集回で応募が定員に届かなかった</strong>という記録で、次回も同じとは限りません。また収入基準や単身入居の可否といった申込資格は別に判定されます。実際の可否は各市の募集案内と窓口でご確認ください。</p>

  <section class="related" aria-label="関連記事">
    <h2 style="border:0">あわせて読みたい</h2>
    <ul>
      <li><a href="koei-jutaku-bairitsu.html">公営住宅の当選倍率まとめ（全国・仕組み・優遇の全体像と統計データ）</a></li>
      <li><a href="koei-hairiyasui.html">市営住宅に入りやすい人とは？（優遇される世帯と当選確率を上げる方法）</a></li>
      <li><a href="koei-shunyu-kijun.html">公営住宅の収入基準は年収いくらまで？（政令月収の自動判定）</a></li>
      <li><a href="koei-yachin-keisan.html">市営住宅・公営住宅の家賃はいくら？自動計算</a></li>
@@CITYLINKS@@
    </ul>
  </section>

  <section class="contribute">
    <h2>あなたの見た倍率、教えてください</h2>
    <p>「この団地は◯倍だった」「応募ゼロの住戸に入れた」——実際の募集資料で見た数字は、同じ立場で住まいを探す人の助けになります。下のコメント欄（アカウント不要・匿名OK）からどうぞ（個人が特定される情報は避けてください）。</p>
    <div id="cusdis_thread"
      data-host="https://cusdis.com"
      data-app-id="14dfe8f8-c660-42ee-9cd2-54ee31828ba9"
      data-page-id="@@SLUG@@"
      data-page-url="@@CANON@@"
      data-page-title="公営住宅の団地別 応募倍率ランキング">
    </div>
    <script async defer src="https://cusdis.com/js/cusdis.es.js"></script>
  </section>

  <h2 id="shutten">出典（各市の公式資料・@@NSRC@@件）</h2>
  <ul class="sources">
@@SOURCES@@
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは各市が公表した資料にもとづく<strong>一般的な情報の共有</strong>です。応募倍率は募集回・住戸・年度で変わり、掲載値は参考です。集計年度と募集区分は市ごとに異なります。実際の申込資格・倍率・入居可否は、必ず各市の公式情報・窓口でご確認ください。当サイトは入居のあっせんや個別の可否判定を行うものではありません。
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


def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    updated = data.get("updated", "")
    cities = data.get("cities", [])
    units = collect(data)
    rank_html, ranked = rank_rows(units)
    gap_html, gaps = gap_rows(units)
    zero_html, zeros = zero_rows(ranked)
    src_html, nsrc = source_rows(data)
    evrows_html, ev = ev_rows(units)

    ncity = len(set(u["city"] for u in units))
    nunit = len(units)
    nzero = len(zeros)
    top = ranked[0]

    # 市平均比が最大の住戸（市平均を公表している市のみ）
    rel_pool = [u for u in ranked if u["base"] not in (None, "", 0) and u["val"]]
    relmax = max(rel_pool, key=lambda u: u["val"] / float(u["base"])) if rel_pool else None
    # 「最高住戸が自分の市の平均の何倍か」が最大の市
    gap_calc = [g for g in gaps if g["mult"] is not None]
    gap_top = max(gap_calc, key=lambda g: g["mult"]) if gap_calc else None
    n_zero_city = len([g for g in gaps if g["lo"]["val"] == 0])

    fact1 = ("最も高かったのは<strong>{c}・{n}の{r}</strong>、最も低かったのは応募ゼロ（0倍）の住戸で、"
             "同じ制度の中に<strong>数百倍から0倍まで</strong>が同居しています"
             "（N={nu}住戸・{nc}市／各市の直近公表回・{up}時点）。").format(
        c=esc(top["city"]), n=esc(top["name"]), r=esc(top["ratio_text"]),
        nu=nunit, nc=ncity, up=esc(updated))
    if relmax is not None:
        fact2 = ("市の平均倍率に対する比では、<strong>{c}・{n}が市平均の{x}</strong>で最大でした"
                 "（市平均{b}倍に対し{r}）。「市の平均倍率」は住戸選びの目安としてはほとんど当てになりません。").format(
            c=esc(relmax["city"]), n=esc(relmax["name"]),
            x=esc(fmt_rel(relmax["val"], relmax["qual"], relmax["base"])),
            b=esc(relmax["base"]), r=esc(relmax["ratio_text"]))
    else:
        fact2 = ""
    fact3 = ("応募が定員に届かなかった住戸（1倍未満）は<strong>{nz}件</strong>あり、"
             "最低が0倍だった市は{nc0}市ありました。高倍率と応募ゼロが同じ市で同時に起きるのが公営住宅の常態です。").format(
        nz=nzero, nc0=n_zero_city)

    ex = ev["no_hi"]
    if ex:
        ex_text = ("1倍以上だった例外は{n}（{c}・{r}）だけで、その資料も「{a}」と書き添えています。"
                   .format(n=esc(ex[0]["name"]), c=esc(ex[0]["city"]), r=esc(ex[0]["ratio_text"]),
                           a=esc(strip_tags(ex[0]["attr"]))))
    else:
        ex_text = "1倍以上だった住戸はありませんでした。"
    evfact1 = ("資料に<strong>「エレベーターなし」と明記された住戸は{n}件</strong>あり、そのうち"
               "<strong>{lo}件が応募割れ（1倍未満）</strong>でした。{ex}").format(
        n=ev["no"], lo=ev["no_lo"], ex=ex_text)
    yl = ev["yes_lo"]
    yl_text = ("（{}）".format(esc("／".join(u["city"] + "・" + u["name"] for u in yl))) if yl else "")
    evfact2 = ("一方で「エレベーター有」と明記された住戸は{n}件、うち{hi}件が1倍以上でした。"
               "ただし<strong>エレベーター付きでも応募が割れた住戸が{lo}件</strong>あります{names}。"
               "<strong>エレベーターがあるから人気になるのではなく、立地と募集区分が先に効き、その次にエレベーターと階数が効く</strong>"
               "——という順序で読むのが実データに合っています。").format(
        n=ev["yes"], hi=ev["yes_hi"], lo=len(yl), names=yl_text)

    if gap_top is not None:
        gaptop_text = ("たとえば{c}は市全体の平均が{b}倍ですが、同じ市の中に{hn}の{hr}（市平均の{m}）と、"
                       "{ln}の{lr}が同時に存在します").format(
            c=esc(gap_top["city"]), b=esc(gap_top["base"]),
            hn=esc(gap_top["hi"]["name"]), hr=esc(gap_top["hi"]["ratio_text"]),
            m=esc(gap_top["mult_text"]),
            ln=esc(gap_top["lo"]["name"]), lr=esc(gap_top["lo"]["ratio_text"]))
    else:
        gaptop_text = "同じ市の中でも住戸によって倍率は大きく変わります"

    citylinks = "\n".join(
        '      <li><a href="koei-{s}.html">{n}の{hw} 当選倍率（住戸別の実例）</a></li>'.format(
            s=c["slug"], n=esc(c["name"]), hw=esc(c.get("housing_word", "市営住宅")))
        for c in cities)

    desc = ("札幌から福岡まで{nc}市が公表した団地・住戸別の応募倍率{nu}件を1枚に集め、高い順にランキング。"
            "各住戸が自分の市の平均の何倍かを併記し、応募が定員に届かなかった住戸{nz}件も一覧に。"
            "最高は{tc}・{tn}の{tr}。出典つき・CSV配布・毎月再集計。").format(
        nc=ncity, nu=nunit, nz=nzero,
        tc=top["city"], tn=top["name"], tr=top["ratio_text"])

    jsonld = json.dumps({
        "@context": "https://schema.org", "@type": "Article",
        "headline": "市営住宅・公営住宅の団地別 応募倍率ランキング【{}市{}住戸を横断】".format(ncity, nunit),
        "description": desc, "inLanguage": "ja", "url": CANON,
        "mainEntityOfPage": {"@type": "WebPage", "@id": CANON},
        "datePublished": "2026-08-17", "dateModified": updated,
        "author": {"@type": "Organization", "name": "フクシル"},
        "publisher": {"@type": "Organization", "name": "フクシル"},
        "isPartOf": {"@type": "WebSite", "name": "フクシル", "url": "https://fukushiru.com/"},
    }, ensure_ascii=False)
    breadld = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "トップ", "item": "https://fukushiru.com/"},
            {"@type": "ListItem", "position": 2, "name": "公営住宅",
             "item": "https://fukushiru.com/articles/koei-jutaku-bairitsu.html"},
            {"@type": "ListItem", "position": 3, "name": "団地別ランキング", "item": CANON},
        ],
    }, ensure_ascii=False)

    page = PAGE
    for k, v in {
        "@@JSONLD@@": jsonld + "\n</script>\n<script type=\"application/ld+json\">\n" + breadld,
        "@@CANON@@": CANON, "@@SLUG@@": SLUG, "@@UPDATED@@": esc(updated),
        "@@NCITY@@": str(ncity), "@@NUNIT@@": str(nunit), "@@NZERO@@": str(nzero),
        "@@NSRC@@": str(nsrc), "@@DESC@@": esc(desc),
        "@@FACT1@@": fact1, "@@FACT2@@": fact2, "@@FACT3@@": fact3,
        "@@GAP@@": gap_html, "@@RANK@@": rank_html, "@@ZERO@@": zero_html,
        "@@EVROWS@@": evrows_html, "@@NEV@@": str(ev["n"]),
        "@@EVFACT1@@": evfact1, "@@EVFACT2@@": evfact2,
        "@@EVNO@@": str(ev["no"]), "@@EVNOLO@@": str(ev["no_lo"]),
        "@@EVYESLO@@": str(len(ev["yes_lo"])),
        "@@SOURCES@@": src_html, "@@CITYLINKS@@": citylinks,
        "@@TOPNAME@@": esc(top["name"]), "@@TOPCITY@@": esc(top["city"]),
        "@@TOPRATIO@@": esc(top["ratio_text"]), "@@GAPTOP@@": gaptop_text,
    }.items():
        page = page.replace(k, v)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    print("wrote", os.path.basename(OUT), "units:", nunit, "cities:", ncity, "zero:", nzero)


if __name__ == "__main__":
    main()
