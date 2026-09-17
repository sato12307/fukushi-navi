#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""koei-watch が拾ってきたPDFを開いて、倍率資料かどうかを選り分ける。

  python scripts/koei-triage.py          # 手元の .cache を全部見て台帳を作る
  python scripts/koei-triage.py --keep   # 倍率資料でないものを .cache から消す

★役割の分け方（2026-09-17）
  koei-watch.mjs … 拾う。中身は見ない。**迷ったら残す**（消えるデータが相手なので、
                   会社案内が1本混ざる無駄より、倍率表を1本落とすほうがずっと高くつく）。
  このスクリプト … 開いて中身を見て、倍率資料かどうかを言う。
  分けている理由＝PDFの日本語は圧縮されていてNodeの生バイトからは読めない。
  読める道具（PyMuPDF）はpython側にある。無理に1本にまとめない。

★「倍率資料である」の判定は**語の有無だけでは足りない**。
  募集案内にも「倍率」の語は出る（前回の倍率をお知らせします、など）。
  ∴ 語があり、かつ**数字の行がある程度の本数ある**ことを条件にする。
  それでも取りこぼすことはあるので、判定は台帳に出して人が見られるようにする。
"""
import json
import os
import re
import sys

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
KEEP_ONLY = "--keep" in sys.argv
# 見張りが拾ってくる市（過去回が消える市）。取り方が別にある市はここに入れない。
SLUGS = ["sakai", "nagoya", "kumamoto", "osaka", "kyoto"]

WORD = re.compile(r"倍率|応募状況|申込受付結果|抽選結果|応募者数|申込者数")
# 「◯戸 ◯人」や「1.5」のような数字が並ぶ行。表があるかどうかの目安。
NUMROW = re.compile(r"(?:^|\s)[0-9]{1,4}(?:\s+[0-9,]{1,6}){1,3}(?:\s|$)")


def look(path):
    try:
        doc = fitz.open(path)
    except Exception as e:                                       # noqa: BLE001
        return {"ok": False, "why": "開けない: %s" % e}
    try:
        text = "\n".join(p.get_text() for p in doc)
        pages = len(doc)
    finally:
        doc.close()
    words = len(WORD.findall(text))
    numrows = len(NUMROW.findall(text))
    jp = len(re.findall(r"[ぁ-んァ-ヶ一-龥]{2,}", text))
    # 倍率資料＝語があり、数字の行がそれなりにあり、日本語が取り出せている
    ok = bool(words and numrows >= 10 and jp >= 20)
    why = ""
    if not words:
        why = "倍率・応募・抽選結果の語が無い"
    elif numrows < 10:
        why = "数字の行が%d本しかない（表ではなさそう）" % numrows
    elif jp < 20:
        why = "日本語が取り出せない（画像だけのPDFか、フォントの問題）"
    return {"ok": ok, "pages": pages, "words": words, "numrows": numrows, "jp": jp, "why": why}


def main():
    out = {"cities": []}
    total_keep = total_drop = 0
    for slug in SLUGS:
        d = os.path.join(CACHE, slug)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith(".pdf"))
        keep, drop = [], []
        for f in files:
            r = look(os.path.join(d, f))
            r["file"] = f
            r["bytes"] = os.path.getsize(os.path.join(d, f))
            (keep if r["ok"] else drop).append(r)
        print("== %s：PDF %d本 → 倍率資料 %d本 ／ 違う %d本" % (slug, len(files), len(keep), len(drop)))
        for r in keep:
            print("   ○ %s  %dページ  語%d  数字行%d  %.0fKB"
                  % (r["file"], r["pages"], r["words"], r["numrows"], r["bytes"] / 1024))
        for r in drop:
            print("   × %s  %s" % (r["file"], r["why"]))
        if KEEP_ONLY:
            for r in drop:
                os.remove(os.path.join(d, r["file"]))
            if drop:
                print("   （違うもの %d本を消しました）" % len(drop))
        out["cities"].append({"slug": slug, "keep": keep, "drop": drop})
        total_keep += len(keep)
        total_drop += len(drop)
    with open(os.path.join(CACHE, "koei-triage.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("\n倍率資料 %d本 ／ 違う %d本 ／ 台帳 .cache/koei-triage.json" % (total_keep, total_drop))
    if not total_keep:
        sys.stderr.write("\n★倍率資料が1本もありません。見張りの入口か、判定の条件を確かめてください。\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
