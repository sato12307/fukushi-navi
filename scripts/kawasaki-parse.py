#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""川崎市営住宅の応募状況表PDFを読んで、住宅ごとの行にする。

  python scripts/kawasaki-parse.py            # data/kawasaki-bairitsu.json を作る
  python scripts/kawasaki-parse.py --dry      # 書き出さずに結果だけ出す

前に回すもの: node scripts/kawasaki-fetch.mjs（.cache/kawasaki/*.pdf を集める）

★なぜ pdftotext をやめて PyMuPDF にしたか（2026-09-17）
  この環境の pdftotext（Xpdf 4.00）は日本語のCMapを持っておらず、
  **Unknown character collection 'Adobe-Japan1'** を吐いて日本語を落とす。
  それで最初は「29回のうち18回しか読めない」と判定した。PyMuPDF に替えたら
  **27回が読めた**（読めないのは 2023-03 と 2024-12 の2回だけ）。
  ★「読めないPDF」と判定する前に、必ず別の取り出し器を試すこと。
    道具の欠落を相手のデータの欠落と読み違えると、11回ぶんを捨てるところだった。

★倍率は公表表の列を読まない。応募者数 ÷ 募集戸数 で出す。
  公表表の倍率は住宅名の行から1行ずれて出てくることがあり、そのまま結び付けると
  静かに別の住宅の倍率が入る（件数では検知できない）。実測で 57/3=19.0・96/8=12.0 と
  公表値に一致する。**読まなくていいものを読まない**のが、いちばん確実なずれ対策。

★行は y 座標でまとめる。pdftotext -layout の「見た目の行」に頼らない。
  文字の下端がわずかに違うだけで別の行に割れる。座標で束ねれば、その揺れを吸収できる。

★読めない回を「0件」にしない。住宅名が取れた数で門を作り、足りない回は理由つきで台帳に残す。
  とくに 2023-03・2024-12 は**数字だけ出て日本語が0**なので、行数だけ見ていると
  「読めた」ように見える。
"""
import json
import os
import re
import sys
from collections import defaultdict

# Windows の既定のコンソール（cp932）は「↔」「—」「≤」などを encode できず、
# 進捗表示の1行で UnicodeEncodeError を出して途中で落ちる（2026-09-23 の川崎で実際に起きた）。
# 記号を選び直すのは漏れるので、出力の文字コードのほうを UTF-8 に固定する。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "kawasaki")
OUT = os.path.join(ROOT, "data", "kawasaki-bairitsu.json")
DRY = "--dry" in sys.argv
MIN_NAMES = 10          # この数の住宅名が取れない回は使わない
YTOL = 3.0              # 同じ行とみなす y のずれ（pt）

JP = re.compile(r"[ぁ-んァ-ヶ一-龥]")
# 見出し：「新築　一般世帯向け」「空家　単身者向」など。
# ★ページ番号「(1/3)」が見出しと同じ行に来る回がある（2019-06 ほか）。
#   先に落としてから見る。落とさずに「数字があるから見出しではない」と弾いていて、
#   3回ぶん103行の募集区分が空のままになっていた。
PAGENO = re.compile(r"[（(][0-9]+[/／][0-9]+[）)]")
# ★「向」の位置を決め打ちしない。実際の見出しはこう書かれる：
#     空家　シルバーハウジング（単身者向け）   … 向けが括弧の中
#     空家　特別空家（世帯向）                 … 同上
#     空家　（多家族世帯向け）(４人以上)        … 括弧が2つ
#   末尾を「…向け」と決めていたので、この3つの形が見出しと認識されず、
#   **その節の住宅が前の節の区分のまま記録されていた**（シルバーハウジングの14行が
#   「単身者向（60歳未満）」に化けていた）。件数は合うので数えても気づけない。
#   ∴ 「新築/空家 で始まり、向 を含み、住宅コードを含まない行」を見出しとする。
SEC = re.compile(r"^(新築|空家)(.{2,30})$")

# ★募集区分の表記ゆれをそろえる。回によって「向け」と「向」、全角半角、
#   括弧の中の書き方が違う。そろえないと同じ枠が2つに割れ、中央値が分かれる。
#   ここは**1か所だけ**に置く。分からない書き方が来たら黙って捨てずに報告する。
ALIAS = {
    "小家族向・単身者向": "小家族・単身者向",
    "世帯向(高齢・障害)": "世帯向（高齢者・障害者世帯）",
    "世帯向（高齢・障害）": "世帯向（高齢者・障害者世帯）",
    "世帯向（高齢者・心身障害者世帯）": "世帯向（高齢者・障害者世帯）",
    "世帯向高齢者・障害者世帯向": "世帯向（高齢者・障害者世帯）",
}


def norm_cat(raw):
    """募集区分の書き方をそろえる。戻り値は (そろえた名前, 元の名前)。"""
    import unicodedata
    s = unicodedata.normalize("NFKC", raw).replace(" ", "").replace("　", "")
    s = s.replace("(", "（").replace(")", "）")
    s = re.sub(r"向け", "向", s)
    return ALIAS.get(s, s), raw.strip()
SKIP = re.compile(r"小[　\s]*計|合[　\s]*計|募集戸数|応募者数|コード|住宅名|倍率")
CODE = re.compile(r"^[0-9]{3,4}$")
INT = re.compile(r"^[0-9][0-9,]*$")


def cluster(words):
    """y の近い語を1行にまとめる。戻り値は x 順に並べた語の配列の並び。

    ★丸めでまとめない（round(y / YTOL)）。実測で、**コード番号だけが1.3pt上**に置かれた
      行があり（2026-06 ほか）、丸めの境目にかかると同じ行が2つに割れる。
      その結果、直近の回で**募集戸数の半分近くを取りこぼしていた**（公表160戸に対し81戸）。
      件数だけ見ていると「そういう回だった」に見えるので、公表の合計との検算で初めて分かった。
    ∴ y 順に並べて、直前の行の基準線から YTOL 以内なら同じ行に足す、という寄せ方にする。
    """
    out = []
    cur, base = [], None
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


def lines_of(pdf):
    """PDFをページごとに行の並びにする。各行は x 順に並べた語の配列。"""
    out = []
    doc = fitz.open(pdf)
    for page in doc:
        out.extend(cluster(page.get_text("words")))
    doc.close()
    return out


# 表の先頭にある集計ブロック（新築住宅／空家住宅／合計）。
# ★ラベルで拾わない。ここも数字がラベルの行から1行ずれて出るので、
#   「合計」という語の隣にある数字が合計とはかぎらない（実際いちど空家の小計を拾った）。
#   ∴ **新築＋空家＝合計** という関係のほうで特定する。数字どうしの関係は、
#   レイアウトがどう崩れても変わらない。
def published_total(pdf):
    """公表表の合計（募集戸数, 応募者数）。関係から特定できなければ None。"""
    doc = fitz.open(pdf)
    try:
        page = doc[0]
        pairs = []
        for ws in cluster(page.get_text("words"))[:24]:   # 集計ブロックは面の上のほうにある
            ints = [int(w.replace(",", "")) for w in ws if INT.match(w)]
            # ★住宅コード（7062 など4桁）を募集戸数と読み違えないための歯止め。
            #   実測で 2025-09 が「7062戸/5人」を合計と誤認した。市営住宅の1回の募集は
            #   多くて数百戸なので、上限を置けば取り違えない。
            if len(ints) >= 2 and 0 < ints[0] <= 2000 and ints[1] >= ints[0]:
                pairs.append((ints[0], ints[1]))
        # a + b == c を満たす組を探す（新築＋空家＝合計）。c がいちばん大きいものを採る。
        best = None
        for i, a in enumerate(pairs):
            for j, b in enumerate(pairs):
                if i == j:
                    continue
                for c in pairs:
                    if c == a or c == b:
                        continue
                    if a[0] + b[0] == c[0] and a[1] + b[1] == c[1]:
                        if best is None or c[0] > best[0]:
                            best = c
        if best:
            return best
        # 新築が無い回は「空家＝合計」で同じ数字が2回出る。その場合はいちばん大きい組。
        same = [x for x in pairs if pairs.count(x) >= 2]
        return max(same) if same else None
    finally:
        doc.close()


def parse(pdf, round_key, seen_cats=None):
    rows = []
    if seen_cats is None:
        seen_cats = set()
    kind = cat = cat_raw = ""
    lines = lines_of(pdf)
    names_seen = 0
    noname = []          # 住宅名が入っていない行の募集戸数
    for ws in lines:
        joined = "".join(ws)
        if not joined.strip():
            continue
        # 見出し（種別＋募集区分）。ページ番号を落としてから見る。
        head = PAGENO.sub("", joined).replace(" ", "").replace("　", "")
        m = SEC.match(head)
        # 住宅の行を見出しと取り違えないための歯止め＝コード（3〜4桁）を含む行は見出しにしない。
        if m and "向" in m.group(2) and not any(CODE.match(w) for w in ws):
            kind = m.group(1)
            cat, cat_raw = norm_cat(m.group(2))
            seen_cats.add((kind, cat, cat_raw))
            continue
        if SKIP.search(joined):
            continue
        # 住宅の行：どこかに「3〜4桁のコード」があり、そのあとに日本語の住宅名、
        # さらに整数が2つ（募集戸数・応募者数）続く。末尾の倍率は読まない。
        ci = next((i for i, w in enumerate(ws) if CODE.match(w)), None)
        if ci is None:
            continue
        rest = ws[ci + 1:]
        ni = next((i for i, w in enumerate(rest) if JP.search(w)), None)
        if ni is None:
            # ★住宅名が入っていない行（例 ['Ｅ','4502','8','13','1.6']）。
            #   PDF側に名前が無いので、この行は商品に使えない。ただし**黙って捨てない**。
            #   実測で 2025-09 の差（公表233戸 ↔ 読み取り217戸）は、この形の5行16戸で
            #   ちょうど説明がついた。台帳に戸数を残して、公表との差を説明できるようにする。
            ints0 = [w for w in rest if INT.match(w)]
            if len(ints0) >= 2:
                noname.append(int(ints0[0].replace(",", "")))
            continue
        # 住宅名＝日本語の始まりから、最初の整数の手前まで
        ints = [i for i, w in enumerate(rest) if INT.match(w) and i > ni]
        if len(ints) < 2:
            continue
        name = "".join(rest[ni:ints[0]]).strip()
        if not name or not JP.search(name):
            continue
        koho = int(rest[ints[0]].replace(",", ""))
        oubo = int(rest[ints[1]].replace(",", ""))
        if koho <= 0:
            continue
        names_seen += 1
        rows.append({
            "round": round_key,
            "kind": kind,
            "cat": cat,
            "catRaw": cat_raw,
            "code": " ".join(ws[max(0, ci - 1):ci + 1]),
            "name": name,
            "koho": koho,
            "moushikomi": oubo,
            "bairitsu": round(oubo / koho, 1),
        })
    return rows, names_seen, noname


def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("%s がありません。先に node scripts/kawasaki-fetch.mjs を回してください。\n"
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
                           "why": "住宅名が%d件しか取り出せない（日本語が入っていないPDF）" % n})
            continue
        # 検算：公表の合計と、読み取った行の和が合うか
        tot = published_total(os.path.join(CACHE, f))
        mine = (sum(r["koho"] for r in rs), sum(r["moushikomi"] for r in rs))
        entry = {"round": rk, "used": True, "rows": len(rs),
                 "sum": {"koho": mine[0], "moushikomi": mine[1]},
                 "noName": {"rows": len(noname), "koho": sum(noname)}}
        if tot:
            entry["published"] = {"koho": tot[0], "moushikomi": tot[1]}
            entry["match"] = (tot == mine)
            # 差が「住宅名の無い行」でちょうど説明できるか
            entry["explained"] = (tot[0] - mine[0] == sum(noname))
        rows.extend(rs)
        ledger.append(entry)

    used = [l for l in ledger if l["used"]]
    houses = {(r["name"], r["kind"], r["cat"]) for r in rows}
    cats = sorted({"%s/%s" % (r["kind"], r["cat"]) for r in rows})
    out = {
        "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "source": "川崎市「市営住宅入居者募集に係る抽選結果」応募状況表PDF（回ごと）",
        "index": "https://www.city.kawasaki.jp/kurashi/category/24-4-2-2-1-3-0-0-0-0.html",
        "note": ("倍率は公表表の列を読まず、応募者数÷募集戸数で当方が計算している"
                 "（公表表の倍率の列は住宅名の行から1行ずれて出るため）。"),
        "rounds": [l["round"] for l in used],
        "ledger": ledger,
        "rows": rows,
    }
    print("PDF %d回 → 使えた %d回 ／ 使えなかった %d回" % (len(files), len(used), len(ledger) - len(used)))
    print("  行 %d件 ／ 住宅×募集区分 %d件" % (len(rows), len(houses)))
    if used:
        print("  範囲 %s 〜 %s" % (used[0]["round"], used[-1]["round"]))
    print("  募集区分: %s" % " / ".join(cats))
    for l in ledger:
        if not l["used"]:
            print("  × %s  %s" % (l["round"], l["why"]))
    # 検算の結果
    checked = [l for l in used if "match" in l]
    okc = [l for l in checked if l["match"]]
    print("  検算（公表の合計と読み取りの和）: 一致 %d / 照合できた %d / 合計が見つからない %d"
          % (len(okc), len(checked), len(used) - len(checked)))
    for l in checked:
        if not l["match"]:
            print("    ずれ %s  公表 %d戸 ↔ 読み取り %d戸（差%d）  住宅名の無い行 %d件%d戸  %s"
                  % (l["round"], l["published"]["koho"], l["sum"]["koho"],
                     l["published"]["koho"] - l["sum"]["koho"],
                     l["noName"]["rows"], l["noName"]["koho"],
                     "＝差はこれで説明がつく" if l.get("explained") else "★説明がつかない"))
    if len(rows) < 500:
        sys.stderr.write("\n★行が少なすぎます（500未満）。読み取りが壊れていないか確かめてください。\n")
        return 1
    if not DRY:
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print("\n書き出し %s（%.0fKB）" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
