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
