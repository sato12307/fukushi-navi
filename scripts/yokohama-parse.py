#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""横浜市営住宅の「応募状況表」PDFを読んで、住宅ごとの行にする。

  python scripts/yokohama-parse.py            # data/yokohama-bairitsu.json を作る
  python scripts/yokohama-parse.py --dry      # 書き出さずに結果だけ出す

前に回すもの: node scripts/yokohama-fetch.mjs

★川崎・静岡と違って、座標から行を組み立てない。PyMuPDF の find_tables() を使う。
  横浜の表は **2段組**（左右に同じ表が並ぶ）で、しかも
  **区と募集区分のセルが縦に結合**されている（ブロックの中央に区名が1回だけ置かれる）。
  座標で行を作ると、区がブロックの真ん中に来るので**どの行がどの区か決められない**
  （中央に寄っているので「いちばん近い見出し」でも当たらない。実際に外した）。
  find_tables() は結合セルを None で返してくれるので、上から引き継げば正しく割り当てられる。
  ★表の構造が取れる道具があるなら、座標を自分で組み立てない。

★列（実測）
  0 単位（全市単位／住宅単位） 1 募集区分 2 区 3 申込地域・住宅 4 募集戸数 5 応募者数 6 倍率
  None は「上と同じ」。上から引き継ぐ。

★住宅名に属性が書いてある（資料の凡例より）
  （※）単身者が申込可能 ／（□）エレベーターが一部の階に停止 ／
  （△）エレベーターが踊り場に停止 ／（×）エレベーターがない
  ∴ 名前から切り出して別の欄にする。都営では別途集めている属性がここではタダで付く。

★倍率は公表列を読まず、応募者数÷募集戸数で出す（他市と同じ作法）。
"""
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "yokohama")
OUT = os.path.join(ROOT, "data", "yokohama-bairitsu.json")
DRY = "--dry" in sys.argv
MIN_NAMES = 20

JP = re.compile(r"[ぁ-んァ-ヶ一-龥]")
KU = re.compile(r"[^\s区]{1,4}区")
# ★横浜は18区。実測で20通り出たので、2つは表記のゆれか取り違え。
#   ・保土ケ谷区 と 保土ヶ谷区（大きいケと小さいヶ）が別物として数えられていた
#   ・「青葉区旭区」のように2つの区名がつながって出る回がある（結合セルの取り出しの都合）
#   ∴ ケ→ヶ にそろえ、つながった場合は**最後の区を採る**（表は上から順に並ぶので、
#     その行に効いているのは後ろの区）。それでも18区に無い名前は空にして数える。
KU18 = {"鶴見区", "神奈川区", "西区", "中区", "南区", "港南区", "保土ヶ谷区", "旭区", "磯子区",
        "金沢区", "港北区", "緑区", "青葉区", "都筑区", "戸塚区", "栄区", "泉区", "瀬谷区"}
BAD_KU = []


def norm_ku(v):
    if not v:
        return ""
    v = v.replace("ケ", "ヶ")
    hits = KU.findall(v)
    if hits:
        cand = hits[-1].replace("ケ", "ヶ")
        if cand in KU18:
            return cand
    if v not in ("全市単位", "住宅単位", ""):
        BAD_KU.append(v)
    return ""
INT = re.compile(r"^[0-9][0-9,]*$")
# 名前についている印。凡例にある4つだけを見る（勝手に増やさない）
MARK_TANSHIN = "※"

# ★募集区分の書き方をそろえる。縦書きのセルが2列に折り返した回だけ、
#   取り出したときに文字が混ざる（「一般世帯向（借上型）」→「一般借(世上帯型向)」）。
#   実測で14通りの書き方が出た。**ここ1か所でそろえ、知らない書き方は報告する**
#   （黙って別の区分として数えると、同じ枠が2つに割れて中央値が分かれる）。
CAT_ALIAS = {
    "一般世帯向(直接建設型)": "一般世帯向（直接建設型）",
    "直接建設型": "一般世帯向（直接建設型）",
    "一般世帯向(借上型)": "一般世帯向（借上型）",
    "一般世帯向借(上型)": "一般世帯向（借上型）",
    "一般借(世上帯型向)": "一般世帯向（借上型）",
    "借上型": "一般世帯向（借上型）",
    "子育て世帯専用": "子育て世帯専用",
    "子育専て用世帯": "子育て世帯専用",
    "子育て優遇": "子育て優遇",
    "単身者可": "単身者可",
    "車いす用": "車いす用",
    "4部屋以上": "4部屋以上",
}
# 募集区分ではなく「単位」の語がこの列に来る回がある。区分としては扱わない。
CAT_NOT = {"全市", "行政区"}
UNKNOWN_CATS = set()


def norm_cat(v):
    if not v or v in CAT_NOT:
        return ""
    if v in CAT_ALIAS:
        return CAT_ALIAS[v]
    UNKNOWN_CATS.add(v)
    return v
MARK_EV = {"□": "一部の階に停止", "△": "踊り場に停止", "×": "なし"}


def clean(v):
    if v is None:
        return None
    return unicodedata.normalize("NFKC", str(v)).replace("\n", "").replace(" ", "").strip()


def parse(pdf, round_key):
    rows, noname = [], []
    doc = fitz.open(pdf)
    names_seen = 0
    try:
        for page in doc:
            if "応募状況表" not in page.get_text():
                continue
            for table in page.find_tables().tables:
                carry = {}
                for raw in table.extract():
                    cells = [clean(c) for c in raw]
                    if len(cells) < 7:
                        continue
                    unit, cat, ku, name, koho, oubo = cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]
                    # 結合セルは None。上から引き継ぐ。
                    for i, key in ((0, "unit"), (1, "cat"), (2, "ku")):
                        if cells[i]:
                            carry[key] = cells[i]
                    unit, cat, ku = carry.get("unit", ""), carry.get("cat", ""), carry.get("ku", "")
                    if not name or not koho or not oubo:
                        continue
                    if not (INT.match(koho) and INT.match(oubo)):
                        continue
                    # 見出しの行（募集戸数 などの語が入る）
                    if "募集" in name or "倍率" in name:
                        continue
                    if not JP.search(name):
                        noname.append(int(koho.replace(",", "")))
                        continue
                    # 名前についている印を取り出す
                    tanshin = "可" if MARK_TANSHIN in name else ""
                    ev = ""
                    for mk, label in MARK_EV.items():
                        if mk in name:
                            ev = label
                            break
                    base = re.sub(r"[（(][※□△×][）)]|[※□△×]", "", name).strip()
                    if not base:
                        continue
                    k = int(koho.replace(",", ""))
                    o = int(oubo.replace(",", ""))
                    if k <= 0 or k > 500:
                        continue
                    names_seen += 1
                    rows.append({
                        "round": round_key,
                        "unit": unit,
                        "cat": norm_cat(cat),
                        "ku": norm_ku(ku),
                        "name": base,
                        "tanshin": tanshin,
                        "ev": ev,
                        "koho": k,
                        "moushikomi": o,
                        "bairitsu": round(o / k, 1),
                    })
    finally:
        doc.close()
    return rows, names_seen, noname


def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("%s がありません。先に node scripts/yokohama-fetch.mjs を回してください。\n"
                         % os.path.relpath(CACHE, ROOT))
        return 1
    files = sorted(f for f in os.listdir(CACHE) if f.endswith(".pdf"))
    rows, ledger = [], []
    for f in files:
        rk = f[:-4]
        try:
            rs, n, noname = parse(os.path.join(CACHE, f), rk)
        except Exception as e:                                   # noqa: BLE001
            ledger.append({"round": rk, "used": False, "why": "読み取りで落ちた: %s" % e})
            continue
        if n < MIN_NAMES:
            ledger.append({"round": rk, "used": False, "names": n,
                           "why": "住宅名が%d件しか取り出せない" % n})
            continue
        rows.extend(rs)
        ledger.append({"round": rk, "used": True, "rows": len(rs),
                       "noName": {"rows": len(noname), "koho": sum(noname)}})

    used = [l for l in ledger if l["used"]]
    houses = {(r["ku"], r["name"], r["cat"]) for r in rows}
    out = {
        "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "source": "横浜市 記者発表（建築局）「横浜市営住宅の抽選結果について」の応募状況表PDF",
        "index": "https://www.city.yokohama.lg.jp/city-info/koho-kocho/press/kenchiku/",
        "note": ("倍率は公表表の列を読まず、応募者数÷募集戸数で当方が計算している。"
                 "区・募集区分は表の結合セルを上から引き継いでいる。"
                 "単身可（※）とエレベーター（□△×）は資料の凡例にある印を住宅名から切り出したもの。"),
        "rounds": [l["round"] for l in used],
        "ledger": ledger,
        "rows": rows,
    }
    print("PDF %d回 → 使えた %d回 ／ 使えなかった %d回" % (len(files), len(used), len(ledger) - len(used)))
    print("  行 %d件 ／ 区×住宅×募集区分 %d件" % (len(rows), len(houses)))
    if used:
        print("  範囲 %s 〜 %s" % (used[0]["round"], used[-1]["round"]))
    kus = defaultdict(int)
    for r in rows:
        kus[r["ku"] or "（区なし）"] += 1
    print("  区 %d：%s" % (len([k for k in kus if k != "（区なし）"]),
                          " / ".join("%s%d" % (k, v) for k, v in sorted(kus.items(), key=lambda x: -x[1])[:10])))
    cats = defaultdict(int)
    for r in rows:
        cats[r["cat"] or "（区分なし）"] += 1
    print("  募集区分 %d：%s" % (len(cats), " / ".join(sorted(k for k in cats if k != "（区分なし）"))))
    if BAD_KU:
        import collections as _c
        print("  ★18区に当てられなかった区の書き方 %d件：%s"
              % (len(BAD_KU), " / ".join("%s×%d" % kv for kv in _c.Counter(BAD_KU).most_common(5))))
    if UNKNOWN_CATS:
        print("  ★知らない書き方の募集区分 %d：%s" % (len(UNKNOWN_CATS), " / ".join(sorted(UNKNOWN_CATS))))
    print("  単身可 %d件 ／ エレベーターの印つき %d件"
          % (sum(1 for r in rows if r["tanshin"]), sum(1 for r in rows if r["ev"])))
    for l in ledger:
        if not l["used"]:
            print("  × %s  %s" % (l["round"], l["why"]))
    if len(rows) < 300:
        sys.stderr.write("\n★行が少なすぎます（300未満）。読み取りが壊れていないか確かめてください。\n")
        return 1
    if UNKNOWN_CATS:
        sys.stderr.write(
            "\n★知らない書き方の募集区分があります。CAT_ALIAS に足してください：%s\n"
            % " / ".join(sorted(UNKNOWN_CATS)))
        return 1
    if kus.get("（区なし）", 0) > len(rows) * 0.15:
        sys.stderr.write("\n★区が取れていない行が15%%を超えています。結合セルの引き継ぎを確かめてください。\n")
        return 1
    if not DRY:
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print("\n書き出し %s（%.0fKB）" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
