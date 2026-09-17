#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""住宅扶助の限度額の公表ページから「級地 × 世帯人数」の額を読む。

  python scripts/jutaku-fujo-parse.py            # data/jutaku-fujo.json を作る
  python scripts/jutaku-fujo-parse.py --dry      # 書かずに結果だけ
  python scripts/jutaku-fujo-parse.py --only 埼玉県
  python scripts/jutaku-fujo-parse.py --why 秋田県  # 候補ごとに何が起きたか出す

前に回すもの: node scripts/jutaku-fujo-fetch.mjs

★読む形
  住宅扶助の限度額は「級地 × 世帯人数5段階（1人 / 2人 / 3〜5人 / 6人 / 7人以上）」で決まる。
  都道府県のページは県内の級地ぶんの行を持ち、指定都市・中核市はふつう1行だけ。
  例（埼玉県）: 1級地 47,700 / 57,000 / 62,000 / 67,000 / 74,400
                2級地 43,000 / 52,000 / 56,000 / 60,000 / 67,000
                3級地 37,000 / 44,000 / 48,000 / 52,000 / 58,000

★1機関につき候補を何本も落としてある。**読めたものを採る**（点が多い候補を選ぶ）。
  検索の1位が当たりとは限らず、都道府県は「生活保護のしおり」PDFに表を入れていることが多い。

★自治体ごとに書き方が違うので、見出しの文字に頼らず **数字の並びの性質で拾う**。
  拾う条件（全部満たす並びだけ採る）
    ①5つ以上の数が続けて並んでいる
    ②どれも 10,000〜150,000 の範囲
    ③**単調非減少**（1人 ≤ 2人 ≤ 3〜5人 ≤ 6人 ≤ 7人以上）。ここで表のズレがほぼ落ちる
    ④先頭が2番目の6割以上（桁を読み違えた並びを落とす）
    ⑤先頭（＝単身の額）が 20,000〜60,000。全国で最も高い東京23区で53,700なので、
      これを超える並びは限度額の表ではない（生活扶助や年額が混ざっている）
  さらに機関の中で **1級地 ≥ 2級地 ≥ 3級地** を検算する。逆転したら B にして人が見る。

★ここで金額を "推定" しない
  読めなかった機関は 0 件のまま B で残す。1.3倍の特別基準や床面積による減額は
  ページごとに条件が違うので、**限度額そのものが書いてある表しか採らない**。
"""
import json
import os
import re
import sys
import unicodedata
from glob import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "jutaku-fujo")
LEDGER = os.path.join(ROOT, "data", "jutaku-fujo-targets.json")
OUT = os.path.join(ROOT, "data", "jutaku-fujo.json")
DRY = "--dry" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
WHY = sys.argv[sys.argv.index("--why") + 1] if "--why" in sys.argv else None

LO, HI = 10000, 150000
TANSHIN_LO, TANSHIN_HI = 20000, 60000  # 単身の限度額が取りうる幅（最高は東京23区の53,700）
NUM = re.compile(r"\d[\d,]*")
KYUCHI = re.compile(r"([1-3１-３一二三])\s*級地\s*(?:[-－‐の]\s*([1-2１-２]))?")
KAN = {"一": "1", "二": "2", "三": "3"}


def z2h(s):
    return unicodedata.normalize("NFKC", s or "")


def strip_html(s):
    """表の「行」を1行に、セルは同じ行のまま残す。

    ★ここを雑にやると1件も取れない（実際に0件になった）。
      ①自治体のページはセルの中を <p> や <div> で包む。</p></div> で改行すると
        「1級地」と「47,700」が別の行に散る。∴ 改行してよいのは </tr> だけ。
      ②HTMLソースの改行も同じ罠。1セル1行で書かれているので、改行で切ると全部ばらける。
        ∴ 生の改行は空白に潰し、行の区切りは \x02 だけに任せる。
    """
    s = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", s, flags=re.I)
    has_tr = re.search(r"<tr[\s>]", s, flags=re.I) is not None
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"</(td|th)>", " \x01 ", s, flags=re.I)  # セルの境目は残す
    if has_tr:
        s = re.sub(r"</(tr|table)>", " \x02 ", s, flags=re.I)
    else:
        s = re.sub(r"</(p|div|li|table)>", " \x02 ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"')):
        s = s.replace(a, b)
    return re.sub(r"[\r\n]+", " ", s)


PDF_YTOL = 3.5  # 同じ行とみなす縦のブレ幅（pt）


def pdf_lines(path):
    """PDFの表を「行」に組み直す。

    ★get_text() の素の順序で読むと1件も取れない（札幌市・東京都で実際にそうなった）。
      表を読み取り順で吐くので、金額が**列ごとに縦に並んで**出てくる。
      ∴ 単語の座標を取って **y でまとめ、x で並べ直す**。[[layout-extraction-row-drift]]
      丸めると行の境目で割れるので、しきい値（PDF_YTOL）で束ねる。
    """
    import fitz  # PyMuPDF（pdftotext は日本語を落とす環境がある）

    out = []
    d = fitz.open(path)
    for pg in d:
        words = pg.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)
        if not words:
            continue
        rows = []
        for w in sorted(words, key=lambda w: (w[1], w[0])):
            for r in rows:
                if abs(r[0] - w[1]) <= PDF_YTOL:
                    r[1].append(w)
                    break
            else:
                rows.append([w[1], [w]])
        for _, ws in rows:
            out.append(" ".join(x[4] for x in sorted(ws, key=lambda x: x[0])))
    return "\x02".join(out)


def read_file(path):
    if path.endswith(".pdf"):
        return pdf_lines(path)
    raw = open(path, "rb").read()
    for enc in ("utf-8", "cp932", "euc_jp"):
        try:
            return strip_html(raw.decode(enc))
        except UnicodeDecodeError:
            continue
    return strip_html(raw.decode("utf-8", "replace"))


def kyuchi_label(s):
    m = KYUCHI.search(z2h(s))
    if not m:
        return None
    a = KAN.get(m.group(1), m.group(1))
    return f"{a}級地-{m.group(2)}" if m.group(2) else f"{a}級地"


def runs(line):
    """1行のなかの数字の並びから、条件を満たす5つ組を取り出す。"""
    vals = []
    for m in NUM.finditer(line):
        v = int(m.group(0).replace(",", ""))
        vals.append(v if LO <= v <= HI else None)
    out = []
    i = 0
    while i < len(vals):
        if vals[i] is None:
            i += 1
            continue
        j = i
        while j < len(vals) and vals[j] is not None:
            j += 1
        seq = vals[i:j]
        # 5つ以上あれば先頭から5つを候補にする（後ろに注記の数字が続くことがある）
        if len(seq) >= 5:
            c = seq[:5]
            if (all(c[k] <= c[k + 1] for k in range(4))
                    and c[0] >= c[1] * 0.6
                    and TANSHIN_LO <= c[0] <= TANSHIN_HI
                    and all(v % 100 == 0 for v in c)):  # 限度額は必ず100円単位
                out.append(c)
        i = j
    return out


NIN = re.compile(r"(?:^|\s)(\d{1,2})\s*人(以上)?")
BARE = re.compile(r"(?<![(（\d])(\d{1,3}(?:,\d{3})+)(?![)）])")


def vertical(lines):
    """縦並びの早見表を読む。

    札幌市のような1枚ものの基準額表は、住宅扶助が
        1人 36,000 以内 46,000 以内
        2人 43,000 以内 50,000 以内
        …
        7人以上 56,000 以内 65,000 以内
    と **世帯人員ごとに1行** で並ぶ（横1行に5つ、ではない）。

    ★同じ紙に第2類・期末一時扶助・逓減率も「◯人 …」の形で載っているので、
      そのまま拾うと別の表が混ざる。落とし方＝
        ・**かっこ付きの数字は採らない**（第2類・逓減率はすべて括弧つき）
        ・行の最初の裸の数字だけ採る（2列目は特別基準＝1.3倍なので採らない）
        ・単身が20,000〜60,000（期末一時扶助の13,850などはここで落ちる）
    """
    # ★「◯人」の行は1枚の紙に何組もある（第2類・期末一時扶助・逓減率・被服費…）。
    #   最初に見つけた1つを採ると、まるで別の表の数字が住宅扶助として通ってしまう
    #   （千葉県で第2類基準額 27,790… を拾って実際に通った）。
    #   ∴ 人員ごとに **候補を全部ためて**、条件を満たす組み合わせを探す。
    got = {}
    for l in lines:
        for m in NIN.finditer(l):
            n = int(m.group(1))
            if not 1 <= n <= 7:
                continue
            key = 7 if m.group(2) or n >= 7 else n
            b = BARE.search(l[m.end():])
            if not b:
                continue
            v = int(b.group(1).replace(",", ""))
            if LO <= v <= HI and v % 100 == 0:  # 限度額は必ず100円単位。第2類(27,790)はここで落ちる
                got.setdefault(key, []).append(v)
    need = [1, 2, 3, 6, 7]  # 1人 / 2人 / 3〜5人 / 6人 / 7人以上
    if not all(k in got for k in need):
        return []
    for c0 in sorted(set(got[1])):
        if not TANSHIN_LO <= c0 <= TANSHIN_HI:
            continue
        chain = [c0]
        for k in need[1:]:
            nxt = [v for v in sorted(set(got[k])) if v >= chain[-1]]
            if not nxt:
                break
            chain.append(nxt[0])
        if len(chain) != 5:
            continue
        # 7人以上は単身のおおむね1.5倍前後（実測: 東京都1.56 / 埼玉県1.56 / 札幌市1.56）。
        # ここを外れる組み合わせは、別々の表の数字を寄せ集めている。
        if 1.2 <= chain[4] / chain[0] <= 2.0:
            return [chain]
    return []


def parse_text(text):
    text = z2h(text)
    # 住居確保給付金の支給上限額は、生活困窮者自立支援法施行規則により
    # **生活保護の住宅扶助特別基準額と同額**。額を出していない自治体でも
    # 住居確保給付金の案内には載せていることが多いので、こちらも入口にする。
    # ★「住宅扶助」を必須にすると、1枚ものの基準額表が落ちる。
    #   見出しを縦書きにしている紙があり（札幌市）、住/宅/扶/助 が別々の行に散って
    #   文字列としてはどこにも現れない。∴ 入口は「生活保護」まで緩め、
    #   本当の絞り込みは数字の性質（100円単位・単調・単身2万〜6万・7人以上が1.2〜2.0倍）に任せる。
    if not ("住宅扶助" in text or "住居確保給付金" in text or "生活保護" in text):
        return [], "生活保護の書類ではない"
    lines = [re.sub(r"[\x01\s]+", " ", l).strip() for l in text.split("\x02")]
    lines = [l for l in lines if l]
    # 級地の見出しだけが1行になっている作りがある（見出しの行と数字の行が分かれた表）。
    merged = []
    i = 0
    while i < len(lines):
        l = lines[i]
        if kyuchi_label(l) and len(NUM.findall(l)) <= 1 and i + 1 < len(lines):
            merged.append(l + " " + lines[i + 1])
            i += 2
            continue
        merged.append(l)
        i += 1
    rows = []
    cur = None
    for line in merged:
        lab = kyuchi_label(line)
        if lab:
            cur = lab
        for c in runs(line):
            rows.append({"kyuchi": lab or cur, "yen": c})
    # 横1行に5つ並ぶ形で取れなかったときだけ、縦並びの早見表として読み直す
    if not rows:
        for c in vertical(merged):
            rows.append({"kyuchi": None, "yen": c})
    # 同じ級地は最初の1つだけ（ページ下部の経過措置の表を拾わないため）
    seen = set()
    uniq = []
    for r in rows:
        if r["kyuchi"] in seen:
            continue
        seen.add(r["kyuchi"])
        uniq.append(r)
    return uniq, None if uniq else "限度額の表が見つからない"


def order_check(rows):
    """機関の中の整合。1級地 ≥ 2級地 ≥ 3級地（枝番も含めて文字順で比べられる）。"""
    got = {r["kyuchi"]: r["yen"][0] for r in rows if r["kyuchi"]}
    bad = []
    keys = sorted(got)
    for a in keys:
        for b in keys:
            if a < b and got[a] < got[b]:
                bad.append(f"{a}({got[a]:,}) < {b}({got[b]:,})")
    return bad


def parse_org(name, verbose=False):
    d = os.path.join(CACHE, name)
    if not os.path.isdir(d):
        return None, None, "キャッシュが無い（fetch がまだ）"
    umap = {}
    up = os.path.join(d, "urls.json")
    if os.path.exists(up):
        umap = json.load(open(up, encoding="utf-8"))
    best, best_url, notes = None, None, []
    for f in sorted(glob(os.path.join(d, "*.html")) + glob(os.path.join(d, "*.pdf"))):
        try:
            rows, err = parse_text(read_file(f))
        except Exception as e:  # 壊れたPDFなど。1本落ちても他の候補で続ける
            rows, err = [], f"読めない({type(e).__name__})"
        base = os.path.basename(f)
        if verbose:
            print(f"   候補 {base}: {len(rows)}行 {err or ''}  {umap.get(base, '')}")
        if not rows:
            notes.append(f"{base}:{err}")
            continue
        bad = order_check(rows)
        if bad:
            notes.append(f"{base}:級地の大小が逆転({bad[0]})")
            continue
        if best is None or len(rows) > len(best):
            best, best_url = rows, umap.get(base)
    if best is None:
        return None, None, "; ".join(notes)[:200] or "候補が無い"
    return best, best_url, None


def main():
    L = json.load(open(LEDGER, encoding="utf-8"))
    if WHY:
        rows, url, err = parse_org(WHY, verbose=True)
        print(f"\n=> {WHY}: " + (f"{len(rows)}行 採用={url}" if rows else f"読めない: {err}"))
        return
    result = {}
    stat = {"A": 0, "B": 0, "未調査": 0}
    for t in L["targets"]:
        if ONLY and t["name"] != ONLY:
            continue
        if not t.get("urls"):
            t["status"] = "未調査"
            stat["未調査"] += 1
            continue
        rows, url, err = parse_org(t["name"])
        if not rows:
            t["status"] = "B"
            t["note"] = err
            t["picked"] = None
            stat["B"] += 1
            print(f"B  {t['name']:8s} {err}")
            continue
        t["status"] = "A"
        t["note"] = None
        t["picked"] = url
        stat["A"] += 1
        result[t["name"]] = {"level": t["level"], "pref": t["pref"], "source": url, "rows": rows}
        for r in rows:
            lab = r["kyuchi"] or "(級地の記載なし)"
            print(f"A  {t['name']:8s} {lab:10s} " + " / ".join(f"{v:,}" for v in r["yen"]))
    print(f"\nA {stat['A']} / B {stat['B']} / 未調査 {stat['未調査']}  （全{len(L['targets'])}機関）")
    if DRY:
        return
    json.dump(L, open(LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    data = {
        "note": "生活保護の住宅扶助（家賃・間代等）の限度額。実施機関（都道府県・指定都市・中核市）"
                "ごとに厚生労働大臣が告示で定める額を、各機関の公表ページから取ったもの。"
                "額は［1人 / 2人 / 3〜5人 / 6人 / 7人以上］の順。",
        "updated": L.get("updated"),
        "orgs": result,
    }
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"書いた: {OUT}  ({len(result)}機関)")


if __name__ == "__main__":
    main()
