#!/usr/bin/env python
# -*- coding: utf-8 -*-
u"""kobe-parse.py — 神戸市営住宅 定時募集の「当選・補欠抽選番号一覧」PDFを読む。

  python scripts/kobe-parse.py            # .cache/kobe/*.pdf → data/kobe-bairitsu.json
  python scripts/kobe-parse.py --check    # 読むだけ。書き出さない

★この市だけの事情（2026-09-17 実地）
  ①1行＝1住戸。住宅名だけでなく**棟と部屋番号**まで出る。艦隊で最も細かい。
    ∴ 募集戸数はどの行も1。**倍率＝申込者数**で、割り算が要らない唯一の市。
  ②申込者ゼロの住戸がそのまま「0」と印字される（当選・補欠・最大の欄が空になる）。
    ∴ 欄が空なのは読み落としではなく、そういう行がある。列は座標で取る。
    行の文字を左から並べて数える読み方をすると、空欄のぶんだけ列がずれる。
  ③部屋番号の上2桁が階、下2桁が号。10回ぶん3千行で 1〜17階・1〜41号に収まり、
    階が上がるほど件数が減る（実際の棟の形と合う）ので、階として扱ってよい。
    ★ただし桁が崩れた行は階を空にする（推測で埋めない）。

★照合（公表の合計が無い市なので、資料の中で辻褄を合わせる）
  ・当選抽選Noがある行は申込者数≧1、無い行は0。これは別の列どうしの整合で、
    読み落としがあれば必ず食い違う。
  ・最大抽選No ≧ 申込者数。抽選番号は申込者に配る番号なので下回りようがない。
  ・住宅番号の見た目の本数（4桁で左端にあるもの）と、読めた行数が一致すること。
"""
import collections
import json
import os
import re
import sys

# Windows の既定のコンソール（cp932）は「↔」「—」「≤」などを encode できず、
# 進捗表示の1行で UnicodeEncodeError を出して途中で落ちる（2026-09-23 の川崎で実際に起きた）。
# 記号を選び直すのは漏れるので、出力の文字コードのほうを UTF-8 に固定する。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "kobe")
OUT = os.path.join(ROOT, "data", "kobe-bairitsu.json")
CHECK = "--check" in sys.argv

INDEX = "https://www.kobe-rma.or.jp/individual/municipal/recruitment/"

# 列の帯（中心x）。1ページ目の見出しの位置から取った。全10回・全ページで同じ。
BANDS = [
    (40, 70, "no"),      # 住宅番号
    (70, 115, "kind"),   # 住宅記号（一般／特定目的）
    (115, 300, "name"),  # 住宅名
    (305, 338, "tou"),   # 棟
    (340, 382, "room"),  # 部屋
    (385, 428, "tosen"), # 当選抽選No
    (430, 478, "hoketsu"),  # 補欠抽選No
    (480, 514, "mo"),    # 申込者数
    (516, 562, "maxno"), # 最大抽選No
]
YBIN = 6.0   # 行は約19.4pt間隔。6で丸めれば1行が1つの箱に入る
HEAD = re.compile(u"住宅|記号|番号|当選|補欠|申込|者数|最大|抽選No|棟|部屋|募集|一覧")


def read_round(path):
    doc = fitz.open(path)
    rows, seen_no = [], 0
    try:
        for page in doc:
            words = page.get_text("words")
            # 左端に4桁だけが置かれている回数＝行数の見当（読めた行数との照合に使う）
            for w in words:
                c = (w[0] + w[2]) / 2
                if 40 < c < 70 and re.match(r"^\d{4}$", w[4]):
                    seen_no += 1
            buckets = collections.defaultdict(list)
            for w in words:
                buckets[round(w[1] / YBIN)].append(w)
            for k in sorted(buckets):
                cells = collections.defaultdict(list)
                for w in sorted(buckets[k], key=lambda w: w[0]):
                    c = (w[0] + w[2]) / 2
                    for lo, hi, nm in BANDS:
                        if lo < c < hi:
                            cells[nm].append(w[4])
                            break
                g = lambda nm: "".join(cells.get(nm, []))          # noqa: E731
                no, name, room = g("no"), g("name"), g("room")
                if not re.match(r"^\d{4}$", no):
                    continue                                       # 見出し行など
                if not name or HEAD.fullmatch(name):
                    continue
                mo = g("mo")
                if not re.match(r"^\d+$", mo):
                    continue                                       # 申込者数が読めない行は捨てる
                floor = int(room[:2]) if re.match(r"^\d{4}$", room) and 1 <= int(room[:2]) <= 20 else None
                rows.append({
                    "no": no,
                    "kind": g("kind"),
                    "name": name,
                    "tou": g("tou"),
                    "room": room,
                    "floor": floor,
                    "moushikomi": int(mo),
                    "koho": 1,                 # 1行＝1住戸。神戸は募集戸数が必ず1
                    "bairitsu": int(mo),       # ∴ 倍率＝申込者数（割り算をしない）
                    "tosen": g("tosen"),
                    "maxno": g("maxno"),
                })
    finally:
        doc.close()
    return rows, seen_no


def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("`.cache/kobe` がありません。node scripts/kobe-fetch.mjs を先に。\n")
        return 1
    files = sorted(f for f in os.listdir(CACHE) if f.endswith(".pdf"))
    all_rows, ledger = [], []
    for f in files:
        rnd = f[:7]
        rows, seen_no = read_round(os.path.join(CACHE, f))
        # ── 資料の中での辻褄合わせ ──────────────────────────────────────────
        bad_tosen = [r for r in rows if bool(r["tosen"]) != (r["moushikomi"] > 0)]
        bad_max = [r for r in rows if r["maxno"].isdigit() and int(r["maxno"]) < r["moushikomi"]]
        match = (len(rows) == seen_no) and not bad_tosen and not bad_max
        why = []
        if len(rows) != seen_no:
            why.append(u"住宅番号は%d本見えているのに%d行しか読めていない" % (seen_no, len(rows)))
        if bad_tosen:
            why.append(u"当選番号と申込者数が食い違う行が%d" % len(bad_tosen))
        if bad_max:
            why.append(u"最大抽選Noが申込者数より小さい行が%d" % len(bad_max))
        noflo = len([r for r in rows if r["floor"] is None])
        used = bool(rows) and not bad_tosen and not bad_max
        ledger.append({
            "round": rnd, "rows": len(rows), "seenNo": seen_no,
            "used": used, "match": match, "explained": False,
            "why": u"／".join(why),
            "noFloor": noflo,
            "noName": {"rows": 0, "koho": 0},   # 神戸は住宅名の無い行が出ない形式
        })
        mark = u"○" if match else (u"△" if used else u"×")
        print(u"%s %s  %4d行  申込者ゼロ %3d戸  階が読めない %d  %s"
              % (mark, rnd, len(rows), len([r for r in rows if r["moushikomi"] == 0]), noflo,
                 u"／".join(why)))
        if used:
            for r in rows:
                r["round"] = rnd
            all_rows.extend(rows)

    used_rounds = [l for l in ledger if l["used"]]
    print(u"\n使える回 %d／%d ／ 合計 %d行 ／ 住戸 %d ／ 団地 %d"
          % (len(used_rounds), len(ledger), len(all_rows),
             len(set((r["name"], r["tou"], r["room"]) for r in all_rows)),
             len(set(r["name"] for r in all_rows))))
    if not all_rows:
        sys.stderr.write(u"\n★1行も読めていません。列の帯か、資料の様式が変わっています。\n")
        return 1
    if CHECK:
        return 0
    payload = {
        "city": u"神戸市",
        "index": INDEX,
        "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "rows": all_rows,
        "ledger": ledger,
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(u"書き出し data/kobe-bairitsu.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
