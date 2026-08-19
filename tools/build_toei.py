#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""都営住宅「申込者ゼロ（募集割れ）」の実測ブロックを生成する。

入力: data/toei-bairitsu.json
      = JKK東京「申込地区別倍率表」PDF 16回分を scripts/toei-parse.py で読み取った生データ。
        ★数百MBのPDFから起こした中間ファイルで、再取得できるためリポジトリには置かない
          (.gitignore 済み)。手元に無い場合、このスクリプトは何も変更せずに終了する。

出力:
  1. data/toei-boshuware.csv          … 募集割れが確認できた行の一覧（引用・転載用）
  2. data/koei-cities.json の tokyo.extra_html に、マーカーで囲んだ節を差し込む
     （実際のHTMLは tools/build_koei_cities.py が koei-tokyo.html を再生成して出力する）

★採用ゲート（ここが本体）
  生の読み取りは、回ごとにPDFの列構成が違うせいで全行を正しく復元できていない。
  そこで「申込者数の欄」と「倍率の欄」が **ともに 0** と読めた行だけを採用する。
  行頭から区市町が明示的に読めた行(city_src=="head")に限り、住宅名の取り違えも避ける。
  ∴ここで出る件数は実際の募集割れの **下限** であって上限ではない。本文にもそう書く。
  推定・レンジ補完は一切しない（艦隊の原則）。
"""
import csv, io, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC = os.path.join(PROJ, "data", "toei-bairitsu.json")
CITIES = os.path.join(PROJ, "data", "koei-cities.json")
CSVOUT = os.path.join(PROJ, "data", "toei-boshuware.csv")
MARK_S = "  <!-- toei-boshuware:start -->"
MARK_E = "  <!-- toei-boshuware:end -->"

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def era_year(e):
    m = re.match(r"(昭和|平成|令和)([0-9]+)", e or "")
    if not m:
        return None
    n = int(m.group(2))
    return {"昭和": 1925, "平成": 1988, "令和": 2018}[m.group(1)] + n


def wareki(round_key):
    """'2025-05' -> '令和7年5月'"""
    y, m = round_key.split("-")
    y, m = int(y), int(m)
    return ("令和%d年%d月" % (y - 2018, m)) if y >= 2019 else ("平成%d年%d月" % (y - 1988, m))


def main():
    if not os.path.exists(SRC):
        print("[skip] %s が無いので何もしません（PDF読み取りは手元でのみ実行）" % SRC)
        return 0
    with open(SRC, encoding="utf-8") as f:
        raw = json.load(f)
    rows = raw["rows"]
    z = [x for x in rows
         if x.get("moushikomi") == 0 and x.get("bairitsu") == 0 and x.get("city_trusted")]
    if len(z) < 200:
        print("[skip] 採用行が %d 件しかありません（ゲートを通る行が少なすぎる）" % len(z))
        return 0

    rounds = sorted({x["round"] for x in rows})
    n_rows, n_koho = len(z), sum(x["koho"] for x in z)
    n_danchi = len({(x["city"], x["name"]) for x in z})
    by_city = Counter(x["city"] for x in z)
    by_cat = Counter(x["cat"] for x in z)
    by_ev = Counter(x["ev"] for x in z)
    rep = Counter((x["city"], x["name"]) for x in z)
    dec = Counter()
    for x in z:
        y = era_year(x["era"])
        if y:
            dec[(y // 10) * 10] += 1

    # ---- CSV（引用・転載用） -------------------------------------------------
    with open(CSVOUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["募集回", "募集区分", "区市町", "住宅名", "募集戸数", "建築年度",
                    "エレベーター", "入居人数"])
        for x in sorted(z, key=lambda v: (v["round"], v["city"], v["name"])):
            w.writerow([wareki(x["round"]), x["cat"], x["city"], x["name"],
                        x["koho"], x["era"], x["ev"], x["ninzu"]])
    print("wrote", CSVOUT, n_rows, "rows")

    # ---- HTML ---------------------------------------------------------------
    e = []
    a = e.append
    a(MARK_S)
    a('  <h2 id="boshuware">⑦ 申込者ゼロで募集割れした都営住宅【2022〜2026年・16回の実測】</h2>')
    a('  <p>都営住宅は「倍率が高い」と語られますが、<strong>誰も申し込まなかった住戸募集</strong>も毎回発生しています。'
      'JKK東京は募集回ごとに倍率表PDFを出すだけで、回をまたいで「どの住宅が何回あまったか」を集計した資料は公表していません。'
      'そこで%s〜%sの定期募集%d回分の倍率表を読み取り、<strong>申込者数と倍率がともに0</strong>と読めた行だけを数えました。</p>'
      % (wareki(rounds[0]), wareki(rounds[-1]), len(rounds)))
    a('  <div class="callout point">')
    a('    <p><span class="tag">数字だけ</span>申込者ゼロ（募集割れ）と確認できた住戸募集は<strong>%s件</strong>'
      '（のべ<strong>%s戸</strong>）。<strong>%s住宅・%s区市町</strong>にまたがります。'
      'このうち<strong>%s件（%.0f%%）はエレベーター付き</strong>、<strong>%s件</strong>は2000年代以降に建てられた住宅でした。</p>'
      % ("{:,}".format(n_rows), "{:,}".format(n_koho), "{:,}".format(n_danchi), len(by_city),
         "{:,}".format(by_ev.get("有", 0)), 100.0 * by_ev.get("有", 0) / n_rows,
         "{:,}".format(sum(v for k, v in dec.items() if k >= 2000))))
    a('  </div>')

    # 区市町別
    a('  <div class="table-wrap">')
    a('  <table class="ratio-table">')
    a('    <caption>区市町別 募集割れ（申込者ゼロ）が確認できた件数・%s〜%s</caption>'
      % (wareki(rounds[0]), wareki(rounds[-1])))
    a('    <thead><tr><th scope="col">区市町</th><th scope="col">確認件数</th>'
      '<th scope="col">対象になった住宅数</th></tr></thead>')
    a('    <tbody>')
    dan_by_city = {}
    for x in z:
        dan_by_city.setdefault(x["city"], set()).add(x["name"])
    for city, cnt in by_city.most_common():
        cls = ' class="lo"' if cnt >= 50 else ""
        a('      <tr><th scope="row">%s</th><td%s>%d件</td><td>%d住宅</td></tr>'
          % (city, cls, cnt, len(dan_by_city[city])))
    a('    </tbody>')
    a('  </table>')
    a('  </div>')
    a('  <p style="font-size:.88rem;color:var(--sub)">表に無い区市町（千代田区・中央区・港区・文京区・台東区など）は、'
      'この読み取りの範囲では募集割れが<strong>1件も確認できなかった</strong>区市町です。'
      '同じ期間、都心区には数十〜100倍超の倍率が並びます。</p>')

    # 常連
    a('  <div class="table-wrap">')
    a('  <table class="ratio-table">')
    a('    <caption>同じ住宅で募集割れが何度も確認できた住宅（上位30・%d回の合計）</caption>' % len(rounds))
    a('    <thead><tr><th scope="col">住宅名</th><th scope="col">区市町</th>'
      '<th scope="col">募集割れ確認回数</th></tr></thead>')
    a('    <tbody>')
    for (city, name), cnt in rep.most_common(30):
        a('      <tr><th scope="row">%s</th><td>%s</td><td class="lo">%d回</td></tr>'
          % (name, city, cnt))
    a('    </tbody>')
    a('  </table>')
    a('  </div>')

    # 区分別・築年代別
    a('  <div class="table-wrap">')
    a('  <table class="ratio-table">')
    a('    <caption>募集区分別・建築年代別の内訳（募集割れ確認%s件）</caption>' % "{:,}".format(n_rows))
    a('    <thead><tr><th scope="col">区分</th><th scope="col">件数</th>'
      '<th scope="col">全体に占める割合</th></tr></thead>')
    a('    <tbody>')
    for k, v in by_cat.most_common():
        a('      <tr><th scope="row">%s</th><td>%d件</td><td>%.0f%%</td></tr>'
          % (k, v, 100.0 * v / n_rows))
    for k in sorted(dec):
        a('      <tr><th scope="row">%d年代に建てられた住宅</th><td>%d件</td><td>%.0f%%</td></tr>'
          % (k, dec[k], 100.0 * dec[k] / n_rows))
    a('    </tbody>')
    a('  </table>')
    a('  </div>')

    a('  <div class="callout note">')
    a('    <p><span class="tag">この数字の限界</span>ここに出したのは<strong>下限</strong>です。'
      '倍率表PDFは回ごとに列の作りが違い、機械での読み取りは全%s行のうち一部を正しく復元できません。'
      'そこで<strong>同じ行の申込者数欄と倍率欄がともに0と読めた行だけ</strong>を採用し、'
      '区市町も行頭に明記されていた行に限りました（ページをまたいで引き継いだ行は数えていません）。'
      'したがって実際の募集割れは、ここに出した%s件より<strong>多い</strong>はずです。少なくはなりません。</p>'
      % ("{:,}".format(len(rows)), "{:,}".format(n_rows)))
    a('    <p><strong>「募集割れ＝誰でも入れる」ではありません。</strong>'
      '申込資格（収入基準・住宅困窮要件・単身可否など）を満たすことが前提で、'
      'また同じ住宅でも回によって募集の有無・戸数・間取り・入居人数の条件が変わります。'
      '申し込む前に、その回の募集案内で必ず条件を確認してください。</p>')
    a('  </div>')

    a('  <p class="mini-note">出典＝JKK東京（東京都住宅供給公社）が募集回ごとに公表する'
      '「申込地区別倍率表」PDF（%s〜%s・%d回）。読み取り日 %s。'
      '全%s件の明細は<a href="../data/toei-boshuware.csv" download>募集割れ一覧（%s件・CSV）</a>で配布しています。'
      '出典（フクシル https://fukushiru.com/articles/koei-tokyo.html ）を明記していただければ、'
      '表・数値の転載は自由です。</p>'
      % (wareki(rounds[0]), wareki(rounds[-1]), len(rounds), raw.get("updated", ""),
         "{:,}".format(n_rows), "{:,}".format(n_rows)))
    a('  <p class="mini-note"><a href="koei-danchi-ranking.html">→ 全国12市の団地別 応募倍率ランキング</a>／'
      '<a href="koei-hairiyasui.html">→ 公営住宅に入りやすい人の条件</a></p>')
    a(MARK_E)

    with open(CITIES, encoding="utf-8") as f:
        data = json.load(f)
    tgt = None
    for c in data["cities"]:
        if c["slug"] == "tokyo":
            tgt = c
    if tgt is None:
        print("[skip] koei-cities.json に tokyo がありません")
        return 0
    ex = tgt.get("extra_html", [])
    if MARK_S in ex and MARK_E in ex:      # 冪等: 既存ブロックを丸ごと差し替える
        ex = ex[:ex.index(MARK_S)] + ex[ex.index(MARK_E) + 1:]
    tgt["extra_html"] = ex + e
    with open(CITIES, "w", encoding="utf-8") as f:
        # 既存ファイルの体裁（インデント1スペース）に合わせる。差分を最小に保つため。
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("updated", CITIES, "(tokyo.extra_html へ %d 行)" % len(e))
    print("→ 続けて tools/build_koei_cities.py を実行して koei-tokyo.html を再生成してください")
    return 0


if __name__ == "__main__":
    sys.exit(main())
