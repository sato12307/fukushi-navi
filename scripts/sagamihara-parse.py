#!/usr/bin/env python
# -*- coding: utf-8 -*-
u"""sagamihara-parse.py — 相模原市営住宅「入居者募集結果（応募状況）」PDFを読む。

  python scripts/sagamihara-parse.py            # .cache/sagamihara/*.pdf → data/sagamihara-bairitsu.json
  python scripts/sagamihara-parse.py --check    # 読むだけ。書き出さない

★この市だけの事情（2026-09-17 実地）
  ①**住宅名のセルが縦に結合されている**。同じ団地で住戸タイプ違いが続くと、名前は
    最初の行にしか書かれず、しかも文字の高さが行とずれる。∴ 文字を座標で拾って
    行に束ねる読み方では、名前が別の行に落ちて全部つながらない（実際にそうなった）。
    PyMuPDF の find_tables() は罫線からセルを組み立てるので、結合も正しく解ける。
    横浜でも同じ理由でこちらを使っている。
  ②**列のx座標が回ごとに動く**（住宅名が x=180 の回も x=100 の回もある）。
    ∴ 列は位置ではなく**見出しの語**で当てる。
  ③区分ごとの**小計行**が混ざる（住宅名が空で数字だけの行）。住宅名が無い行は捨てる。
  ④資料の冒頭に募集戸数・応募者数・平均倍率の**公表合計**がある。
    読み取った行の合計と突き合わせる。ここが合わなければ使わない。

★倍率は公表列を読まず 応募者数÷募集戸数 で当方が計算する（艦隊の共通の決め事）。
"""
import json
import os
import re
import sys

import fitz  # PyMuPDF
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "sagamihara")
OUT = os.path.join(ROOT, "data", "sagamihara-bairitsu.json")
CHECK = "--check" in sys.argv
INDEX = "https://www.city.sagamihara.kanagawa.jp/kurashi/1026489/sumai/1026509/1007952.html"

NUM = re.compile(r"^[0-9][0-9,]*(?:\.[0-9]+)?$")
# 見出しの語 → 欄の名前。表の中でこの語が並ぶ行を見出し行とする。
HEADS = {u"住宅名": "name", u"住戸タイプ": "type", u"募集戸数": "koho",
         u"応募者数": "mo", u"倍率": "bai"}
# 住宅番号の見出しは回によって「住宅番号」「種別住宅番号」と揺れる。含んでいれば当てる。
NO_HEAD = re.compile(u"住宅番号")
# 住宅番号の値。古い様式は種別と続けて6桁になる回がある。
NO_VAL = re.compile(r"^[0-9]{3,6}$")


# ★住戸タイプは「一般向 ○3DK」の形。前半が募集の区分、後半が間取り。
#   区分の書き方が年で揺れる（高齢者単身者向／高齢者単身向、身体障害者単身者向け 等）。
#   ○▲■△×★は資料の凡例の印（エレベーターや階数の目印）で、区分の一部ではない。
#   揃えないと同じ区分が別ものとして数えられ、「毎回すいている」の判定が割れる。
CAT_MARK = re.compile(u"[○〇▲■△×★◎●]")
CAT_ALIAS = [
    (re.compile(u"^高齢者単身"), u"高齢者単身者向"),
    (re.compile(u"^一般単身"), u"一般単身者向"),
    (re.compile(u"^身体障害者単身"), u"身体障害者単身者向"),
    (re.compile(u"^身体障害者(世帯)?向"), u"身体障害者世帯向"),
    (re.compile(u"^高齢者世帯"), u"高齢者世帯向"),
    (re.compile(u"^老人世帯"), u"老人世帯向"),
    (re.compile(u"^多人数世帯"), u"多人数世帯向"),
    (re.compile(u"^一般向"), u"一般向"),
]


def category(t):
    t = CAT_MARK.sub("", unicodedata.normalize("NFKC", t or "")).replace(" ", "")
    head = re.match(u"^[^0-9]+", t)
    head = head.group(0) if head else t
    for pat, name in CAT_ALIAS:
        if pat.match(head):
            return name
    return head or u"（区分なし）"


def madori(t):
    t = unicodedata.normalize("NFKC", t or "")
    m = re.search(r"[0-9]+(?:LDK|DK|K|R)", t)
    return m.group(0) if m else ""


def clean(x):
    return re.sub(r"\s+", " ", (x or "")).strip()


def read_round(path):
    doc = fitz.open(path)
    try:
        tables = []
        for p in doc:
            for t in p.find_tables().tables:
                tables.append(t.extract())
    finally:
        doc.close()
    if not tables:
        return None, None, u"表が見つからない（罫線のないPDFか、画像だけのPDF）", {"rows": 0, "mo": 0}

    # ── 冒頭の公表合計（募集戸数・応募者数）。どの表に入っているか回によって違う ──
    pub = {}
    for tb in tables:
        for row in tb:
            cells = [clean(c) for c in row if c]
            for i, c in enumerate(cells):
                for key, nm in ((u"募集戸数", "koho"), (u"応募者数", "mo")):
                    # 「1 募集戸数」「61」「戸」の形。見出し行の「募集戸数」と紛れないよう
                    # ★数字の次が「戸」「人」であることまで確かめる。
                    if nm in pub or not c.endswith(key):
                        continue
                    # ★「1 募集戸数／61／42／19／戸」のように区分ごとに割った回がある。
                    #   全体の数は必ず最初の数字。単位の「戸」「人」は行のどこかにあればよい。
                    if i + 1 < len(cells) and NUM.match(cells[i + 1]) and \
                            any(x in (u"戸", u"人") for x in cells[i + 1:]):
                        pub[nm] = int(float(cells[i + 1].replace(",", "")))

    # ── 明細の表（見出し行に「住宅名」がある表）──────────────────────────────
    # ★find_tables() は同じ表を入れ子で何度も返すことがある（相模原では3重に出て、
    #   合計が公表値のちょうど3倍になった）。かといって「いちばん大きい表ひとつ」に
    #   絞ると、明細が2つの表に割れている回で後半がまるごと落ちる（これも実測）。
    #   ∴ 見出しのある表は全部読んだうえで、**中身がそっくり同じ行は1回だけ数える**。
    #   住宅番号まで含めて同じ行が2度出ることは資料の作り上ありえない。
    detail = []
    for tb in tables:
        head_at, cols = None, None
        for i, row in enumerate(tb):
            cells = [clean(c) for c in row]
            if u"住宅名" not in cells:
                continue
            c2 = {HEADS[c]: j for j, c in enumerate(cells) if c in HEADS}
            for j, c in enumerate(cells):
                if NO_HEAD.search(c) and "no" not in c2:
                    c2["no"] = j
            if "name" in c2 and "koho" in c2 and "mo" in c2:
                head_at, cols = i, c2
                break
        if head_at is not None:
            detail.append((tb, cols, head_at))

    rows = []
    unknown = {"rows": 0, "mo": 0}
    seen = set()
    for tb, cols, head_at in detail:
        # ★古い様式（令和5年度以前）は住宅名のセルが縦に結合されていて、同じ団地の
        #   2行目以降は名前が空になる。空のまま捨てると戸数が公表値の6割まで減った。
        #   かといって無条件に引き継ぐと、名前の無い**小計行**まで明細に化ける（3倍事故）。
        #   ∴ 引き継ぐのは**住宅番号が入っている行だけ**。小計行に住宅番号は無い。
        name_carry = ""
        for row in tb[head_at + 1:]:
            cells = [clean(c) for c in row]
            sig = tuple(cells)
            if sig in seen:
                continue
            seen.add(sig)
            g = lambda k: cells[cols[k]] if k in cols and cols[k] < len(cells) else ""   # noqa: E731
            koho, mo, name, no = g("koho"), g("mo"), g("name"), g("no")
            has_no = bool(NO_VAL.match(no))
            if has_no:
                name = name or name_carry
                if g("name"):
                    name_carry = g("name")
            elif "no" in cols:
                name = ""          # 住宅番号の欄がある様式で番号が無い＝小計・総計の行
            # ★住宅名が空の行は**小計・総計**。直前の名前を引き継いではいけない。
            #   いちど引き継ぐ書き方にしたら、小計が明細として混ざって合計が
            #   公表値のちょうど3倍になった（区分小計・種別小計・総計の3層ぶん）。
            # 「申込住宅不明」＝どの住宅への申込みか分からない人。住宅が分からないので
            # 集計には入れないが、公表合計との差はこれで説明がつく。台帳に残す。
            # ★「公営住宅 小計（申込住宅不明は除く）」という行も「不明」を含む。
            #   含むかどうかで当てると、小計まで不明として足してしまう（実際にそうなり、
            #   不明の人数が公表合計と同じ数になった）。∴ その語だけの欄に限る。
            if any(c == u"申込住宅不明" for c in cells) and not has_no:
                # ★「申込住宅不明」は住宅名の欄ではなく住宅番号の欄に書かれる回がある。
                #   住宅名の欄だけを見ていたら拾えず、公表合計との2人の差が説明できなかった。
                unknown["rows"] += 1
                unknown["mo"] += int(float(mo.replace(",", ""))) if NUM.match(mo) else 0
                continue
            if not name or name in HEADS:
                continue
            if not NUM.match(koho) or not NUM.match(mo):
                continue
            k, m = int(float(koho.replace(",", ""))), int(float(mo.replace(",", "")))
            if k <= 0:
                continue
            rows.append({
                "name": name, "type": g("type"),
                "cat": category(g("type")), "madori": madori(g("type")),
                "koho": k, "moushikomi": m,
                "bairitsu": round(m / float(k), 3),   # ★公表の倍率列は読まない
            })
    if not rows:
        return None, pub, u"明細の表（住宅名・募集戸数・応募者数の見出し）が見つからない", unknown
    return rows, pub, "", unknown

def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("`.cache/sagamihara` がありません。node scripts/sagamihara-fetch.mjs を先に。\n")
        return 1
    all_rows, ledger = [], []
    for f in sorted(x for x in os.listdir(CACHE) if x.endswith(".pdf")):
        rnd = f[:7]
        rows, pub, err, unk = read_round(os.path.join(CACHE, f))
        if rows is None:
            ledger.append({"round": rnd, "rows": 0, "used": False, "match": False,
                           "explained": False, "why": err, "noName": {"rows": 0, "koho": 0}})
            print(u"× %s  %s" % (rnd, err))
            continue
        sk = sum(r["koho"] for r in rows)
        sm = sum(r["moushikomi"] for r in rows)
        why = []
        if pub.get("koho") is not None and pub["koho"] != sk:
            why.append(u"募集戸数 公表%d≠読み取り%d" % (pub["koho"], sk))
        explained = False
        if pub.get("mo") is not None and pub["mo"] != sm:
            if pub["mo"] - sm == unk["mo"] and unk["mo"] > 0:
                explained = True          # 差は「申込住宅不明」の人数でちょうど説明がつく
            else:
                why.append(u"応募者数 公表%d≠読み取り%d（不明%d人を足しても合わない）"
                           % (pub["mo"], sm, unk["mo"]))
        match = bool(pub) and not why and not explained
        used = bool(rows) and not why     # 合計が食い違う回は使わない
        ledger.append({"round": rnd, "rows": len(rows), "used": used, "match": match,
                       "explained": explained, "why": u"／".join(why),
                       "pubKoho": pub.get("koho"), "pubMo": pub.get("mo"),
                       "noName": {"rows": unk["rows"], "koho": unk["mo"]}})
        print(u"%s %s  %3d行  戸%4d  申込%5d  %s"
              % (u"○" if match else (u"△" if used else u"×"), rnd, len(rows), sk, sm,
                 u"／".join(why) if why else (u"差は申込住宅不明%d人で説明がつく" % unk["mo"] if explained else (u"" if pub else u"公表合計が読めない（突き合わせ無し）"))))
        if used:
            for r in rows:
                r["round"] = rnd
            all_rows.extend(rows)

    used_n = len([l for l in ledger if l["used"]])
    print(u"\n使える回 %d／%d ／ 合計 %d行 ／ 団地 %d ／ 団地×タイプ %d"
          % (used_n, len(ledger), len(all_rows),
             len(set(r["name"] for r in all_rows)),
             len(set((r["name"], r["type"]) for r in all_rows))))
    if not all_rows:
        sys.stderr.write(u"\n★1行も読めていません。見出しの語か様式が変わっています。\n")
        return 1
    if CHECK:
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"city": u"相模原市", "index": INDEX,
                   "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
                   "rows": all_rows, "ledger": ledger}, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(u"書き出し data/sagamihara-bairitsu.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
