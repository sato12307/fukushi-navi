#!/usr/bin/env python3
# data/koei-jutaku.json から公営住宅倍率の表(tbody)を生成し、
# articles/koei-jutaku-bairitsu.html のマーカー間に差し込む。
# GitHub Actions(月1)＋手動(workflow_dispatch)で実行して自動更新する器。
#
# データ収集そのもの（各自治体の募集結果PDF/HTML）はソースごとに形式が異なるため、
# 当面は data/koei-jutaku.json を手/半自動で更新→本スクリプトで再描画する運用。
# 機械可読なソースが増えたら下の collect() にスクレイパを足していく。
import csv
import json
import os
import re
import html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data", "koei-jutaku.json")
CITIES = os.path.join(HERE, "data", "koei-cities.json")
PAGE = os.path.join(HERE, "articles", "koei-jutaku-bairitsu.html")
CSV_AREA = os.path.join(HERE, "data", "koei-bairitsu.csv")
CSV_DANCHI = os.path.join(HERE, "data", "koei-danchi.csv")
START = "<!-- KOEI:ROWS:START -->"
END = "<!-- KOEI:ROWS:END -->"
F_START = "<!-- KOEI:FACTORS:START -->"
F_END = "<!-- KOEI:FACTORS:END -->"

# 団地・住戸別の実例（配布CSVと同じ82件）を機械的に数え直すときの判定語。
# 資料の表記に含まれる語だけで機械判定し、どちらも無いものは「区分不明」として除外する。
SINGLE_KEY = "単身"
FAMILY_KEYS = ("世帯向け", "2人以上", "3人以上", "多家族", "一般世帯", "一般2", "一般3")
NOEV_KEYS = ("EVなし", "エレベーターなし")


def collect():
    """将来の自動収集フック（機械可読ソースが増えたらここで data を更新）。
    現状は no-op。手動更新した data/koei-jutaku.json をそのまま使う。"""
    return


def esc(s):
    return html.escape(str(s), quote=True)


def render_rows(rows):
    out = []
    for r in rows:
        tbd = str(r.get("ratio", "")).strip() in ("調査中", "", "—")
        cls = "tbd" if tbd else "rt"
        out.append(
            "      <tr>"
            f'<th scope="row">{esc(r.get("area",""))}</th>'
            f'<td>{esc(r.get("entity",""))}</td>'
            f'<td>{esc(r.get("segment",""))}</td>'
            f'<td class="{cls}">{esc(r.get("ratio",""))}</td>'
            f'<td class="asof">{esc(r.get("as_of",""))}</td>'
            f'<td class="src"><a href="{esc(r.get("url","#"))}" rel="nofollow noopener" target="_blank">{esc(r.get("source",""))}</a></td>'
            "</tr>"
        )
    return "\n".join(out)


def strip_tags(s):
    """base_text 等に含まれる <strong> などを落として素のテキストにする。"""
    return re.sub(r"<[^>]+>", "", str(s or "")).replace("　", " ").strip()


def write_csv(path, header, rows):
    """CSVを配布用に書き出す（Excelで文字化けしないよう BOM 付きUTF-8）。
    転載のハードルを下げるための配布物なので、掲載しているデータ以外は作らない。"""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)
    print("wrote", path, "rows:", len(rows))


def export_csv(data):
    """① 自治体別の応募倍率 ② 都市ページの団地別（高い/低い実例）を CSV 配布。
    どちらも既に記事に載せている数値のみ。推定・補完はしない。"""
    updated = data.get("updated", "")
    write_csv(
        CSV_AREA,
        ["地域", "事業主体", "区分", "応募倍率", "時点", "出典", "出典URL", "データ更新日"],
        [
            [
                r.get("area", ""),
                r.get("entity", ""),
                r.get("segment", ""),
                r.get("ratio", ""),
                r.get("as_of", ""),
                strip_tags(r.get("source", "")),
                r.get("url", ""),
                updated,
            ]
            for r in data.get("rows", [])
        ],
    )

    if not os.path.exists(CITIES):
        return
    with open(CITIES, encoding="utf-8") as f:
        cdata = json.load(f)
    drows = []
    for c in cdata.get("cities", []):
        for kind, key in (("高い", "top_units"), ("低い", "bottom_units")):
            for u in c.get(key, []) or []:
                drows.append(
                    [
                        c.get("name", ""),
                        c.get("pref", ""),
                        c.get("calc_base", ""),
                        kind,
                        strip_tags(u.get("name", "")),
                        strip_tags(u.get("ratio", "")),
                        strip_tags(u.get("attr", "")),
                        cdata.get("updated", ""),
                    ]
                )
    write_csv(
        CSV_DANCHI,
        ["市", "都道府県", "市全体の平均倍率", "区分", "団地・住戸", "応募倍率", "属性メモ", "データ更新日"],
        drows,
    )


def ratio_value(s):
    """「175.8倍」「約292倍」「0倍（応募なし）」→ 数値。
    「100倍以上」のような下限表記は下限値（100）として数える（本文に注記あり）。"""
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*倍", strip_tags(s))
    return float(m.group(1)) if m else None


def collect_units(cdata):
    """koei-cities.json の top_units / bottom_units を1件1レコードに開く。
    配布CSV（data/koei-danchi.csv）とまったく同じ母集団なので、読者が数え直せる。"""
    units = []
    for c in cdata.get("cities", []) or []:
        for kind, key in (("高い", "top_units"), ("低い", "bottom_units")):
            for u in c.get(key, []) or []:
                name = strip_tags(u.get("name", ""))
                ratio = strip_tags(u.get("ratio", ""))
                memo = strip_tags(u.get("attr", "")) + " " + name
                units.append(
                    {
                        "city": strip_tags(c.get("name", "")),
                        "name": name,
                        "ratio": ratio,
                        "v": ratio_value(ratio),
                        "kind": kind,
                        "single": SINGLE_KEY in memo,
                        "family": (SINGLE_KEY not in memo)
                        and any(k in memo for k in FAMILY_KEYS),
                        "noev": any(k in memo for k in NOEV_KEYS),
                        "showa": "昭和" in memo,
                    }
                )
    return units


def pct(n, d):
    return "0" if not d else "{:.0f}".format(100.0 * n / d)


def render_factors(cdata):
    """配布CSVの82件を機械的に数え直した「そのまま引用できる数字」を生成する。
    推定・補完はしない。母集団は各市が公表した両端の抜粋なので、その旨を文中に明記する。"""
    units = collect_units(cdata)
    if len(units) < 30:
        return ""
    date = strip_tags(cdata.get("updated", ""))
    hi = [u for u in units if u["kind"] == "高い"]
    lo = [u for u in units if u["kind"] == "低い"]
    hi_s = [u for u in hi if u["single"]]
    lo_s = [u for u in lo if u["single"]]
    h100 = [u for u in units if u["v"] is not None and u["v"] >= 100]
    h100_s = [u for u in h100 if u["single"]]
    h100_f = [u for u in h100 if u["family"]]
    sub1 = [u for u in units if u["v"] is not None and u["v"] < 1]
    sub1_f = [u for u in sub1 if u["family"]]
    sub1_s = [u for u in sub1 if u["single"]]
    zero = [u for u in units if u["v"] == 0]
    zero_cities = sorted(set(u["city"] for u in zero))
    noev = [u for u in units if u["noev"]]
    noev1 = [u for u in noev if u["v"] is not None and u["v"] < 1]
    showa = [u for u in units if u["showa"]]
    showa1 = [u for u in showa if u["v"] is not None and u["v"] < 1]
    fam_names = "／".join(
        "{}・{} {}".format(esc(u["city"]), esc(u["name"]), esc(u["ratio"])) for u in h100_f
    )
    li = []
    li.append(
        "    <li><strong>各市が「倍率が高かった例」として公表した{hi}件のうち{his}件（{hisp}%）が、"
        "単身者が申し込める住戸だった。</strong>「低かった例」{lo}件では{los}件（{losp}%）にとどまり、"
        "高倍率側は単身向けに大きく偏っている（N={n}件・12市が公表した両端の抜粋／{d}時点）。</li>".format(
            hi=len(hi), his=len(hi_s), hisp=pct(len(hi_s), len(hi)),
            lo=len(lo), los=len(lo_s), losp=pct(len(lo_s), len(lo)),
            n=len(units), d=esc(date),
        )
    )
    li.append(
        "    <li><strong>倍率100倍以上だった{h}件のうち{s}件（{sp}%）は単身者が申し込める住戸で、"
        "世帯向けと明記されていたのは{f}件だけだった。</strong>その{f}件は{names}（残りは資料に区分の記載がないもの／{d}時点）。</li>".format(
            h=len(h100), s=len(h100_s), sp=pct(len(h100_s), len(h100)),
            f=len(h100_f), names=fam_names or "該当なし", d=esc(date),
        )
    )
    li.append(
        "    <li><strong>同じ{n}件のうち{k}件（{kp}%）は応募が募集戸数に届かない1倍未満で、"
        "うち{z}件は応募ゼロだった（{zc}市で発生）。</strong>1倍未満の{k}件の内訳は、"
        "世帯向けと明記された住戸が{f}件、単身が申し込める住戸が{s}件（{d}時点）。</li>".format(
            n=len(units), k=len(sub1), kp=pct(len(sub1), len(units)),
            z=len(zero), zc=len(zero_cities), f=len(sub1_f), s=len(sub1_s), d=esc(date),
        )
    )
    li.append(
        "    <li><strong>資料に「エレベーターなし」と書かれた{ne}件のうち{ne1}件（{nep}%）、"
        "「昭和築」と書かれた{sh}件のうち{sh1}件（{shp}%）が1倍未満だった。</strong>"
        "設備と築年は記載のある市だけの集計で、記載のない市は分母に入れていない（{d}時点）。</li>".format(
            ne=len(noev), ne1=len(noev1), nep=pct(len(noev1), len(noev)),
            sh=len(showa), sh1=len(showa1), shp=pct(len(showa1), len(showa)),
            d=esc(date),
        )
    )
    return "\n".join(li)


def inject(page, start, end, body):
    if start not in page or end not in page:
        return page
    return re.sub(
        re.escape(start) + r".*?" + re.escape(end),
        lambda _m: start + "\n" + body + "\n    " + end,
        page,
        flags=re.S,
    )


def main():
    collect()
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    export_csv(data)
    rows_html = render_rows(data.get("rows", []))
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()
    if START not in page or END not in page:
        raise SystemExit("マーカーが見つかりません: " + START + " / " + END)
    new = re.sub(
        re.escape(START) + r".*?" + re.escape(END),
        START + "\n" + rows_html + "\n      " + END,
        page,
        flags=re.S,
    )
    # 因子別の再集計（配布CSV82件の数え直し）をマーカー間に差し込む
    if os.path.exists(CITIES):
        with open(CITIES, encoding="utf-8") as f:
            cdata = json.load(f)
        factors_html = render_factors(cdata)
        if factors_html:
            new = inject(new, F_START, F_END, factors_html)

    # 更新日も差し替え（<span id="koei-updated">...</span>）
    upd = data.get("updated", "")
    if upd:
        new = re.sub(
            r'(<span id="koei-updated">).*?(</span>)',
            r"\g<1>" + esc(upd) + r"\g<2>",
            new,
        )
        # 統計セクション側の表示（id は1ページ1つなので class で二箇所目以降を更新）
        new = re.sub(
            r'(<span class="koei-updated">).*?(</span>)',
            r"\g<1>" + esc(upd) + r"\g<2>",
            new,
        )
        # JSON-LD の dateModified も表示更新日に同期（datePublished は初出日のまま）
        new = re.sub(
            r'("dateModified":\s*")[0-9-]+(")',
            r"\g<1>" + esc(upd) + r"\g<2>",
            new,
        )
    if new != page:
        with open(PAGE, "w", encoding="utf-8") as f:
            f.write(new)
        print("updated", PAGE, "rows:", len(data.get("rows", [])))
    else:
        print("no change")


if __name__ == "__main__":
    main()
