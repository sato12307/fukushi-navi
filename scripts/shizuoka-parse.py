#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""静岡市営住宅の「空家募集の倍率」PDFを読んで、団地ごとの行にする。

  python scripts/shizuoka-parse.py            # data/shizuoka-bairitsu.json を作る
  python scripts/shizuoka-parse.py --dry      # 書き出さずに結果だけ出す

前に回すもの: node scripts/shizuoka-fetch.mjs

★川崎（scripts/kawasaki-parse.py）と同じ考え方だが、表の作りが違う。
  静岡の資料は **区（葵区・駿河区・清水区）が入っていて**、間取りと階数まである。
    区 / 団地番号 / 団地名 / 間取り(畳) / 空部屋の階数 / 募集戸数 / 申込数 / 倍率
  ∴ 川崎では作れなかった「区ごとの相場」が静岡では作れる。

★共通の作法（[[pdf-table-extraction-traps]]）はそのまま持ち込む
  ・PyMuPDF で読む（pdftotext は Adobe-Japan1 を持っておらず日本語を落とす環境がある）
  ・行は y 座標でクラスタリングする（丸めると境目で行が割れる）
  ・**倍率は読まない**。申込数 ÷ 募集戸数 で出す（ずれる列を相手にしない）
  ・住宅名が取り出せない回は「0件」にせず、理由つきで台帳に残す

★区は**行の左端に1文字で入っている**（葵／駿／清。縦書きなので「駿河」「清水」の
  2文字目は次の行に落ちる）。見出しの【葵区】は飾りで、区分の節（【事故部屋】など）では
  節の中に3区が混ざる。2026-09-18 の見直しまで見出しからの引き継ぎだけで区を決めていたため、
  **区分の節の行（全体の28%）が全部「清水区」に化けていた**（最後に出た区の見出しが清水区
  だったため）。∴ 区は行の左端から取り、取れない行だけ見出しから引き継ぐ。
  区ごとの件数を必ず出して目で確かめること（3区の偏りが実態と合っているか）。

★見出しには区だけでなく**募集区分**も来る（2026-09-18 の見直しで発見）。
  【車いす】【シルバーハウジング】【子育て支援】【子育て支援期限あり／期限なし】【事故部屋】。
  これを拾っていなかったため、**申込みの条件がまるで違う住戸が同じ申込先に混ざっていた**。
  いちばん効くのが【事故部屋】で、ここは事情があって必ず空く。一般の募集と混ぜると、
  その団地が「毎回すいている」に化ける。区分ごとの件数も必ず目で確かめること。
"""
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "shizuoka")
OUT = os.path.join(ROOT, "data", "shizuoka-bairitsu.json")
DRY = "--dry" in sys.argv
MIN_NAMES = 5
# ★静岡は1つの行が縦に約12ptある（数字・団地名・間取りの詳細が少しずつ違う高さに置かれる）。
#   川崎と同じ 3.0 で束ねると **1行が3つに割れて1件も取れない**（実際に0件になった）。
#   9.0 にすると「間取り・募集戸数・申込数・倍率」と「区・団地番号・団地名・階数」が
#   同じ行に入り、次の行（27pt先）とは分かれる。★閾値は座標を実測して決める。
YTOL = 9.0

JP = re.compile(r"[ぁ-んァ-ヶ一-龥]")
KU = re.compile(r"[【\[]?\s*(葵区|駿河区|清水区)\s*[】\]]?")
# 募集区分の見出し。区の見出しと同じ【】で書かれるので、区でないほうを拾う。
CAT = re.compile(r"[【\[]\s*([^】\]]{2,20})\s*[】\]]")
CAT_SKIP = ("葵区", "駿河区", "清水区")
# 行の左端に置かれる区の1文字（縦書きの1文字目）。
KU1 = {u"葵": u"葵区", u"駿": u"駿河区", u"清": u"清水区"}
INT = re.compile(r"^[0-9][0-9,]*$")
MADORI = re.compile(r"^[0-9]?[A-Z]{1,4}$")
SKIP = re.compile(r"募集戸数|申込数|倍率は|団地名|空部屋|間取り|以下のとおり|静岡市営住宅")


def cluster(words):
    """y の近い語を1行にまとめ、x 順に並べる。丸めない（境目で行が割れるため）。"""
    out, cur, base = [], [], None
    for y0, x0, word in sorted((w[1], w[0], w[4]) for w in words):
        if base is None or abs(y0 - base) <= YTOL:
            if base is None:
                base = y0
            cur.append((x0, word))
        else:
            out.append([w for _, w in sorted(cur)])
            cur, base = [(x0, word)], y0
    if cur:
        out.append([w for _, w in sorted(cur)])
    return out


def parse(pdf, round_key):
    rows, noname = [], []
    ku = ""
    cat = ""      # 募集区分。見出しが出るまでは「一般」（区分の見出しが無い節＝通常の空家募集）
    names_seen = 0
    doc = fitz.open(pdf)
    try:
        for page in doc:
            for ws in cluster(page.get_text("words")):
                joined = unicodedata.normalize("NFKC", "".join(ws))
                if not joined.strip():
                    continue
                # 区の見出し（行に数字が少ないもの）。データ行にも区名が出ることはないので素直。
                m = KU.search(joined)
                if m and len(joined) <= 12:
                    ku = m.group(1)
                    cat = ""          # 区の見出しに戻ったら区分は通常へ戻る
                    continue
                # 募集区分の見出し。データ行に【】は出ないので、見出しかどうかは括弧で決まる。
                mc = CAT.search(joined)
                if mc and mc.group(1).replace(" ", "") not in CAT_SKIP and len(joined) <= 30:
                    cat = mc.group(1).replace(" ", "")
                    continue
                if SKIP.search(joined):
                    continue
                # データ行（x順に並ぶ）：区1文字 / 団地番号 / 団地名（1文字ずつ） /
                #                        間取り / 階数 / 募集戸数 / 申込数 / 倍率
                # ★位置（x）で決め打ちしない。年によって列の幅が動く。
                #   「純粋な整数の並び」で決める＝ints[0]が団地番号、末尾2つが募集戸数と申込数。
                #   階数（5階）と倍率（4.0）は整数ではないので、この数え方に混ざらない。
                norm = [unicodedata.normalize("NFKC", w) for w in ws]
                # ★区は行の左端の1文字から取る。見出しからの引き継ぎは保険。
                row_ku = KU1.get(norm[0], "") if norm else ""
                ii = [i for i, w in enumerate(norm) if INT.match(w)]
                if len(ii) < 3:
                    continue
                num_i, koho_i, oubo_i = ii[0], ii[-2], ii[-1]
                if not (num_i < koho_i < oubo_i):
                    continue
                # ★団地名は「間取りの手前まで」で切る。募集戸数の手前まで取ると、
                #   階数の書き方が「3または4または5階」のような回で **「3または4または」が
                #   団地名に混ざる**（実測。件数は合うので数えても気づけない）。
                #   x順では 団地名 → 間取り → 階数 なので、間取りが名前の終わりの目印になる。
                mad_i = next((i for i, w in enumerate(norm) if i > num_i and MADORI.match(w)), koho_i)
                name = "".join(
                    w for i, w in enumerate(ws)
                    if num_i < i < mad_i and JP.search(w) and "階" not in w
                )
                name = unicodedata.normalize("NFKC", name).replace(" ", "")
                if not name or not JP.search(name):
                    ints2 = [int(norm[i].replace(",", "")) for i in ii]
                    noname.append(ints2[-2])
                    continue
                koho = int(norm[koho_i].replace(",", ""))
                oubo = int(norm[oubo_i].replace(",", ""))
                if koho <= 0 or koho > 200:
                    continue
                madori = next((unicodedata.normalize("NFKC", w) for w in ws
                               if MADORI.match(unicodedata.normalize("NFKC", w))), "")
                kai = next((unicodedata.normalize("NFKC", w) for w in ws if "階" in w), "")
                names_seen += 1
                rows.append({
                    "round": round_key,
                    "ku": row_ku or ku,
                    "cat": cat or u"一般",
                    "name": name,
                    "madori": madori,
                    "kai": kai,
                    "koho": koho,
                    "moushikomi": oubo,
                    "bairitsu": round(oubo / koho, 1),
                })
    finally:
        doc.close()
    return rows, names_seen, noname


def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("%s がありません。先に node scripts/shizuoka-fetch.mjs を回してください。\n"
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
                           "why": "団地名が%d件しか取り出せない" % n})
            continue
        rows.extend(rs)
        ledger.append({"round": rk, "used": True, "rows": len(rs),
                       "ku": {k: sum(1 for r in rs if r["ku"] == k) for k in ("葵区", "駿河区", "清水区", "")},
                       "noName": {"rows": len(noname), "koho": sum(noname)}})

    used = [l for l in ledger if l["used"]]
    houses = {(r["ku"], r["name"]) for r in rows}
    out = {
        "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "source": "静岡市営住宅（指定管理者サイト s-jutaku.com）が募集回ごとに公表する「空家募集の倍率」PDF",
        "index": "https://s-jutaku.com/news/",
        "note": ("倍率は公表表の列を読まず、申込数÷募集戸数で当方が計算している。"
                 "区は資料の見出し（【葵区】など）から引き継いでいる。"),
        "rounds": [l["round"] for l in used],
        "ledger": ledger,
        "rows": rows,
    }
    print("PDF %d回 → 使えた %d回 ／ 使えなかった %d回" % (len(files), len(used), len(ledger) - len(used)))
    print("  行 %d件 ／ 区×団地 %d件" % (len(rows), len(houses)))
    if used:
        print("  範囲 %s 〜 %s" % (used[0]["round"], used[-1]["round"]))
    kus = defaultdict(int)
    for r in rows:
        kus[r["ku"] or "（区なし）"] += 1
    print("  区ごとの行数: %s" % " / ".join("%s %d" % (k, v) for k, v in sorted(kus.items(), key=lambda x: -x[1])))
    cats = defaultdict(int)
    for r in rows:
        cats[r["cat"]] += 1
    print("  募集区分ごとの行数: %s"
          % " / ".join("%s %d" % (k, v) for k, v in sorted(cats.items(), key=lambda x: -x[1])))
    nn = sum(l.get("noName", {}).get("rows", 0) for l in used)
    if nn:
        print("  団地名が取れなかった行 %d件（集計に入れていない）" % nn)
    for l in ledger:
        if not l["used"]:
            print("  × %s  %s" % (l["round"], l["why"]))
    if len(rows) < 500:
        sys.stderr.write("\n★行が少なすぎます（500未満）。読み取りが壊れていないか確かめてください。\n")
        return 1
    if kus.get("（区なし）", 0) > len(rows) * 0.1:
        sys.stderr.write("\n★区が取れていない行が1割を超えています。区の見出しの拾い方を確かめてください。\n")
        return 1
    if not DRY:
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print("\n書き出し %s（%.0fKB）" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
