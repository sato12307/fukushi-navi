#!/usr/bin/env python3
# data/koei-jutaku.json から公営住宅倍率の表(tbody)を生成し、
# articles/koei-jutaku-bairitsu.html のマーカー間に差し込む。
# GitHub Actions(月1)＋手動(workflow_dispatch)で実行して自動更新する器。
#
# データ収集そのもの（各自治体の募集結果PDF/HTML）はソースごとに形式が異なるため、
# 当面は data/koei-jutaku.json を手/半自動で更新→本スクリプトで再描画する運用。
# 機械可読なソースが増えたら下の collect() にスクレイパを足していく。
import json
import os
import re
import html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data", "koei-jutaku.json")
PAGE = os.path.join(HERE, "articles", "koei-jutaku-bairitsu.html")
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


def main():
    collect()
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
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
    if new != page:
        with open(PAGE, "w", encoding="utf-8") as f:
            f.write(new)
        print("updated", PAGE, "rows:", len(data.get("rows", [])))
    else:
        print("no change")


if __name__ == "__main__":
    main()
