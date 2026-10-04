#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""横浜市営住宅の「応募状況表」PDFを読んで、住宅ごとの行にする。

  python scripts/yokohama-parse.py            # data/yokohama-bairitsu.json を作る
  python scripts/yokohama-parse.py --dry      # 書き出さずに結果だけ出す

前に回すもの: node scripts/yokohama-fetch.mjs
  （.cache/yokohama/<回>.pdf＝抽選結果の記者発表、.cache/yokohama/boshu/*.pdf＝入居者募集の記者発表）

★川崎・静岡と違って、座標から行を組み立てない。PyMuPDF の find_tables() を使う。
  横浜の表は **2段組**（左右に同じ表が並ぶ）で、しかも
  **区と募集区分のセルが縦に結合**されている（ブロックの中央に区名が1回だけ置かれる）。
  座標で行を作ると、区がブロックの真ん中に来るので**どの行がどの区か決められない**
  （中央に寄っているので「いちばん近い見出し」でも当たらない。実際に外した）。
  find_tables() は結合セルを None で返してくれるので、上から引き継げば正しく割り当てられる。
  ★表の構造が取れる道具があるなら、座標を自分で組み立てない。

★応募状況表は**2ページにまたがる**（2026-10-04 に見つけて直した）。
  それまでは「応募状況表」という題の入ったページだけを読んでいて、題の無い2ページ目
  （高齢二人世帯向・高齢単身者用・単身者用・特別空家と、表の末尾の「合計」）を
  **9回とも丸ごと読んでいなかった**。公表の合計（令和8年4月＝532戸・4,799人）に対し
  読めていたのは347戸・3,327人。∴ 倍率の列がある表は全部読み、**末尾の合計と1件まで
  合うか**を回ごとに台帳に残す。合わない回は使わない。

★列（実測）
  0 単位（全市単位／行政区単位／住宅単位／高齢二人世帯向／高齢単身者用／事故住宅・特別空家）
  1 募集区分 2 区 3 申込地域・住宅 4 募集戸数 5 応募者数 6 倍率
  None は「上と同じ」。上から引き継ぐ（左右の段・2ページ目へも引き継ぐ）。
  ★縦書きのセルは文字が混ざって出る（「者単可身」「空特家別」「単全位市」「世帯向二人高齢」）。
    **文字の並べ替えで正しい語に当てる**（同じ文字の組なら同じ語）。知らない組は報告して止める。
  ★全市単位・行政区単位の行は住宅名の欄が空で、区の欄に「市内全域（1階又はEV付き）」や
    「旭区（※）」が入る。以前はここを落としていた（合計が合わない原因の1つ）。

★募集区分は「単位」と組み合わせて1つの語にする（row.cat）。
  以前は「高齢二人世帯向」の「直接建設型」を「一般世帯向（直接建設型）」として数えていて、
  申込みの資格が違う枠が同じ申込先に混ざっていた。

★住宅名に属性が書いてある（資料の凡例より）
  （※）単身者が申込可能 ／（〇）エレベーターが各階に停止 ／（□）一部の階に停止 ／
  （△）踊り場に停止 ／（×）エレベーターがない
  ∴ 名前から切り出して別の欄にする。
  ★令和4年4月の回だけ、単身可は印ではなく**太字**（凡例「太字は単身者が申込可能」）。
    太字は文字の縁取り（描画の種類＝stroke）で表されているので、住宅名のセルに縁取りの
    文字があるかで読む（tanshinSrc＝"太字"）。
  ★エレベーターの印は、同じ団地が棟で分かれて募集される行にだけ付く（9回で数十行）。
    **印の無い行は「エレベーターあり」ではなく「表に書いていない」**。

★検算の相手は2つ（ledger に残す）
  1. 抽選結果の応募状況表の末尾の「合計」（募集戸数・応募者数）。
  2. 入居者募集の記者発表の「募集する住宅及び戸数」（募集区分ごとの戸数）。

★倍率は公表列を読まず、応募者数÷募集戸数で出す（他市と同じ作法）。
"""
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict, Counter

# Windows の既定のコンソール（cp932）は「↔」「—」「≤」などを encode できず、
# 進捗表示の1行で UnicodeEncodeError を出して途中で落ちる（2026-09-23 の川崎で実際に起きた）。
# 記号を選び直すのは漏れるので、出力の文字コードのほうを UTF-8 に固定する。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "yokohama")
BOSHU = os.path.join(CACHE, "boshu")
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
    BAD_KU.append(v)
    return ""


INT = re.compile(r"^[0-9][0-9,]*$")
MARKS = "※〇○◯□△×"
MARK_EV = {"〇": "各階に停止", "○": "各階に停止", "◯": "各階に停止",
           "□": "一部の階に停止", "△": "踊り場に停止", "×": "なし"}
STRIP_MARKS = re.compile(r"[（(][%s][）)]|[%s]" % (MARKS, MARKS))


# ── 単位と募集区分：縦書きで文字が混ざるので、文字の組で当てる ─────────────────
def akey(s):
    return "".join(sorted(re.sub(r"[()（）\s　]", "", s)))


UNITS = ["全市単位", "行政区単位", "住宅単位", "高齢二人世帯向", "高齢単身者用", "事故住宅", "特別空家"]
CATS = ["一般世帯向(直接建設型)", "一般世帯向(借上型)", "4部屋以上", "単身者可", "子育て世帯専用",
        "子育て優遇", "車いす用", "単身者用", "直接建設型", "借上型", "一般世帯向", "一般世帯",
        "高齢単身者用", "高齢二人世帯向", "全市", "行政区"]
UNIT_BY = {akey(u): u for u in UNITS}
CAT_BY = {akey(c): c for c in CATS}
UNKNOWN = set()
MISMATCH = []   # 当方の計算（応募者数÷募集戸数）と公表の倍率の列が違う行（読み取りのずれの検知）


def norm_unit(v):
    if not v:
        return None
    u = UNIT_BY.get(akey(v))
    if not u:
        UNKNOWN.add("単位:" + v)
    return u


def norm_cat(v):
    if not v:
        return None
    c = CAT_BY.get(akey(v))
    if not c:
        UNKNOWN.add("区分:" + v)
    return c


PAREN = {"一般世帯向(直接建設型)": "一般世帯向（直接建設型）", "一般世帯向(借上型)": "一般世帯向（借上型）",
         "一般世帯": "一般世帯向"}


def label_of(unit, cat):
    """申込先の募集区分（row.cat）。単位と区分を1つの語にする。"""
    c = PAREN.get(cat, cat or "")
    if unit == "全市単位":
        return "全市単位"
    if unit == "行政区単位":
        return "行政区単位"
    if unit in ("高齢二人世帯向", "高齢単身者用"):
        return "%s（%s）" % (unit, c) if c else unit
    if unit in ("事故住宅", "特別空家"):
        # 令和5年10月の募集から「事故住宅」を「特別空家」へ改称（同回の記者発表の注記）。同じ枠として数える。
        return "特別空家（%s）" % c if c else "特別空家"
    return c


def boshu_group(unit, cat):
    """入居者募集の記者発表の「募集区分」に当てる（区分ごとの戸数の検算用）。"""
    if unit == "全市単位":
        return "全市単位"
    if unit == "行政区単位":
        return "行政区単位"
    if unit in ("事故住宅", "特別空家"):
        return "特別空家"
    if unit in ("高齢二人世帯向", "高齢単身者用"):
        return "特定目的住宅"
    return {
        "一般世帯向(直接建設型)": "一般世帯向(単身者不可)",
        "一般世帯向(借上型)": "一般世帯向(単身者不可)",
        "4部屋以上": "一般世帯向(4部屋以上)",
        "単身者可": "一般世帯向(単身者可)",
        "子育て世帯専用": "子育て世帯専用",
        "子育て優遇": "子育て支援倍率優遇住宅",
        "車いす用": "特定目的住宅",
        "単身者用": "特定目的住宅",
    }.get(cat, "?" + str(cat))


# 記者発表の区分のうち、単身者が申し込めないと書かれているもの／申し込めると書かれているもの
# （住宅単位の行の※印・太字がこれと食い違わないかを数える）
NO_SINGLE = {"一般世帯向(単身者不可)", "一般世帯向(4部屋以上)", "子育て世帯専用"}
SINGLE_OK = {"一般世帯向(単身者可)", "子育て支援倍率優遇住宅"}


def clean(v):
    if v is None:
        return None
    return unicodedata.normalize("NFKC", str(v)).replace("\n", "").replace(" ", "").replace("　", "").strip()


def stroke_rects(page):
    """縁取りで描かれた文字（＝太字）の矩形。令和4年4月の回の単身可の判定に使う。"""
    out = []
    for s in page.get_texttrace():
        if s.get("type") == 1:
            out.append(fitz.Rect(s["bbox"]))
    return out


def is_bold(rect, strokes):
    if rect is None:
        return False
    r = fitz.Rect(rect)
    for s in strokes:
        c = fitz.Point((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2)
        if r.contains(c):
            return True
    return False


def parse(pdf, round_key):
    rows, noname = [], []
    total = None
    bold_mode = False
    doc = fitz.open(pdf)
    carry = {"unit": "", "cat": "", "ku": ""}
    try:
        for page in doc:
            text = page.get_text()
            # ★回によっては1ページ目の「倍率」の見出しが文字として取り出せない（令和5年4月など）。
            #   題（応募状況表）か「倍率」のどちらかがあるページを読む。当選番号表のページは両方とも無い。
            if "倍率" not in text and "応募状況表" not in text:
                continue
            if "太字は単身者" in unicodedata.normalize("NFKC", text):
                bold_mode = True
            strokes = stroke_rects(page) if bold_mode else []
            # ★左右の段が1つの表（15列＝左7列・すき間1列・右7列）として取れる回がある（令和6年10月）。
            #   7列目までしか見ないと右の段を丸ごと落とす。左の段を全部読んでから右の段を読む。
            halves = []
            for table in page.find_tables().tables:
                ext = table.extract()
                rects = [table.rows[i].cells if i < len(table.rows) else [] for i in range(len(ext))]
                if ext and len(ext[0]) >= 14:
                    halves.append(([r[:7] for r in ext], [c[:7] for c in rects]))
                    halves.append(([r[-7:] for r in ext], [c[-7:] for c in rects]))
                else:
                    halves.append((ext, rects))
            for ext, rects in halves:
                # ★数の欄が2行ぶん1つのセルに入り、下の行の同じ欄が空になる回がある（令和7年4月の
                #   コーポ元町「3⏎3」とその下のサンパレス横浜の空欄）。そのまま読むと「33人」になり、
                #   下の行は落ちる（合計が1戸・27人ずれていた）。下の空欄へ1行ずつ配り直す。
                ext = [list(r) for r in ext]
                for ri, r in enumerate(ext):
                    for ci in (4, 5, 6):
                        if ci < len(r) and r[ci] and "\n" in r[ci].strip():
                            parts = [x for x in r[ci].strip().split("\n") if x.strip()]
                            below = ext[ri + 1:ri + len(parts)]
                            if len(below) == len(parts) - 1 and all(ci < len(b) and not b[ci] for b in below):
                                r[ci] = parts[0]
                                for b, v in zip(below, parts[1:]):
                                    b[ci] = v
                for ri, raw in enumerate(ext):
                    cells = [clean(c) for c in raw]
                    # 表の末尾の合計（4列の小さな表）
                    if cells and cells[0] and cells[0].replace("合計", "") == "" and "合計" in cells[0]:
                        nums = [c for c in cells[1:] if c and INT.match(c)]
                        if len(nums) >= 2:
                            total = (int(nums[0].replace(",", "")), int(nums[1].replace(",", "")))
                        continue
                    if len(cells) < 7:
                        continue
                    if cells[0] and cells[0].startswith("申込地域"):
                        continue
                    u = norm_unit(cells[0])
                    c = norm_cat(cells[1])
                    if u:
                        carry["unit"] = u
                        carry["cat"] = c or ""
                        carry["ku"] = ""
                    elif c:
                        carry["cat"] = c
                        carry["ku"] = ""
                    unit, cat = carry["unit"], carry["cat"]
                    name, koho, oubo = cells[3], cells[4], cells[5]
                    if not koho or not oubo or not (INT.match(koho) and INT.match(oubo)):
                        continue
                    cellrects = rects[ri] if ri < len(rects) else []
                    if unit in ("全市単位", "行政区単位"):
                        # 住宅名の欄は空。区の欄に「市内全域（…）」か「旭区（※）」が入る。
                        desc = cells[2] or ""
                        name_rect = cellrects[2] if len(cellrects) > 2 else None
                        if unit == "全市単位":
                            ku = ""
                            base = STRIP_MARKS.sub("", desc)
                            if not base.startswith("市内全域"):
                                base = "市内全域" + base
                        else:
                            ku = norm_ku(STRIP_MARKS.sub("", desc)) if desc else carry["ku"]
                            carry["ku"] = ku
                            base = "（住宅を指定しない区の枠）"
                        raw_name = desc
                    else:
                        if cells[2]:
                            carry["ku"] = norm_ku(cells[2])
                        ku = carry["ku"]
                        if not name:
                            continue
                        if "募集" in name or "倍率" in name:
                            continue
                        if not JP.search(name):
                            noname.append(int(koho.replace(",", "")))
                            continue
                        name_rect = cellrects[3] if len(cellrects) > 3 else None
                        base = STRIP_MARKS.sub("", name).strip()
                        raw_name = name
                    if not base:
                        continue
                    k = int(koho.replace(",", ""))
                    o = int(oubo.replace(",", ""))
                    if k <= 0 or k > 500:
                        continue
                    if bold_mode:
                        tanshin = "可" if is_bold(name_rect, strokes) else ""
                        src = "太字"
                    else:
                        tanshin = "可" if "※" in raw_name else ""
                        src = "※"
                    ev = ""
                    for mk, lab in MARK_EV.items():
                        if mk in raw_name:
                            ev = lab
                            break
                    pub_b = cells[6] if len(cells) > 6 else None
                    if pub_b and re.match(r"^[0-9]+(\.[0-9]+)?$", pub_b) and abs(float(pub_b) - o / k) > 0.051:
                        MISMATCH.append("%s %s %d/%d=%.1f 公表%s" % (round_key, base, o, k, o / k, pub_b))
                    rows.append({
                        "round": round_key,
                        "unit": unit,
                        "cat": label_of(unit, cat),
                        "catRaw": cat,
                        "group": boshu_group(unit, cat),
                        "ku": ku,
                        "name": base,
                        "tanshin": tanshin,
                        "tanshinSrc": src,
                        "ev": ev,
                        "koho": k,
                        "moushikomi": o,
                        "bairitsu": round(o / k, 1),
                    })
    finally:
        doc.close()
    return rows, noname, total


# ── 入居者募集の記者発表：募集区分ごとの戸数 ─────────────────────────────────────
BOSHU_ROUND = re.compile(r"令和(元|[0-9]+)年([0-9]+)月横浜市営住宅の入居者募集")


def boshu_group_of(label):
    s = label.replace(" ", "")
    if s.startswith("全市"):
        return "全市単位"
    if s.startswith("行政区"):
        return "行政区単位"
    if "4部屋以上" in s:
        return "一般世帯向(4部屋以上)"
    if s.startswith("一般世帯向(単身者不可)"):
        return "一般世帯向(単身者不可)"
    if s.startswith("一般世帯向(単身者可)"):
        return "一般世帯向(単身者可)"
    if s.startswith("子育て世帯"):
        return "子育て世帯専用"
    if s.startswith("子育て支援倍率優遇"):
        return "子育て支援倍率優遇住宅"
    if s.startswith("特定目的"):
        return "特定目的住宅"
    if s.startswith("特別空家") or s.startswith("事故住宅"):
        return "特別空家"
    return None


def read_boshu():
    out = {}
    if not os.path.isdir(BOSHU):
        return out
    for f in sorted(os.listdir(BOSHU)):
        if not f.endswith(".pdf"):
            continue
        try:
            doc = fitz.open(os.path.join(BOSHU, f))
            text = unicodedata.normalize("NFKC", doc[0].get_text())
            doc.close()
        except Exception:                                        # noqa: BLE001
            continue
        m = BOSHU_ROUND.search(text.replace("\n", "").replace(" ", ""))
        if not m:
            continue
        rk = "%d-%02d" % ((1 if m.group(1) == "元" else int(m.group(1))) + 2018, int(m.group(2)))
        i, j = text.find("募集区分"), text.find("募集日程")
        if i < 0 or j < 0:
            continue
        lines = [l.strip() for l in text[i:j].split("\n") if l.strip()]
        groups = defaultdict(int)
        unknown = []
        for a, b in zip(lines, lines[1:]):
            if INT.match(b) and not INT.match(a) and not a.endswith("戸") and not a.startswith("※"):
                g = boshu_group_of(a)
                if g:
                    groups[g] += int(b.replace(",", ""))
                else:
                    unknown.append(a)
        mt = re.search(r"募集する住宅及び戸数[(（]?\s*([0-9,]+)\s*戸", text.replace("\n", ""))
        out[rk] = {"file": f, "total": int(mt.group(1).replace(",", "")) if mt else None,
                   "groups": dict(groups), "unknown": unknown}
    return out


def main():
    if not os.path.isdir(CACHE):
        sys.stderr.write("%s がありません。先に node scripts/yokohama-fetch.mjs を回してください。\n"
                         % os.path.relpath(CACHE, ROOT))
        return 1
    files = sorted(f for f in os.listdir(CACHE) if f.endswith(".pdf"))
    boshu = read_boshu()
    rows, ledger = [], []
    for f in files:
        rk = f[:-4]
        try:
            rs, noname, total = parse(os.path.join(CACHE, f), rk)
        except Exception as e:                                   # noqa: BLE001
            ledger.append({"round": rk, "used": False, "why": "読み取りで落ちた: %s" % e})
            continue
        names = sum(1 for r in rs if r["unit"] not in ("全市単位", "行政区単位"))
        if names < MIN_NAMES:
            ledger.append({"round": rk, "used": False, "names": names,
                           "why": "住宅名が%d件しか取り出せない" % names})
            continue
        mine = (sum(r["koho"] for r in rs), sum(r["moushikomi"] for r in rs))
        entry = {"round": rk, "rows": len(rs), "sum": {"koho": mine[0], "moushikomi": mine[1]},
                 "noName": {"rows": len(noname), "koho": sum(noname)}}
        if total:
            entry["published"] = {"koho": total[0], "moushikomi": total[1]}
            entry["match"] = (total == mine)
        # 区分ごとの戸数（入居者募集の記者発表）
        b = boshu.get(rk)
        if b:
            ours = defaultdict(int)
            for r in rs:
                ours[r["group"]] += r["koho"]
            keys = sorted(set(ours) | set(b["groups"]))
            diff = {g: [ours.get(g, 0), b["groups"].get(g, 0)] for g in keys if ours.get(g, 0) != b["groups"].get(g, 0)}
            entry["boshu"] = {"file": b["file"], "total": b["total"], "groups": b["groups"],
                              "match": not diff and not b["unknown"], "diff": diff}
        # 単身可の印と、記者発表の区分（単身者可／不可）の食い違い
        bad = [r for r in rs if (r["group"] in NO_SINGLE and r["tanshin"]) or (r["group"] in SINGLE_OK and not r["tanshin"])]
        entry["tanshin"] = {"src": rs[0]["tanshinSrc"] if rs else "", "marked": sum(1 for r in rs if r["tanshin"]),
                            "conflict": len(bad), "conflictRows": ["%s/%s/%s" % (r["group"], r["name"], r["tanshin"] or "印なし") for r in bad][:10]}
        entry["ev"] = dict(Counter(r["ev"] for r in rs if r["ev"]))
        # ★合計が合わない回は使わない（読めていない行がある＝申込先の数え方が崩れる）
        entry["used"] = bool(entry.get("match"))
        if not entry["used"]:
            entry["why"] = ("表末尾の合計が読めない" if not total
                            else "読み取りの和（%d戸・%d人）が表末尾の合計（%d戸・%d人）と合わない" % (mine[0], mine[1], total[0], total[1]))
        else:
            rows.extend(rs)
        ledger.append(entry)

    used = [l for l in ledger if l["used"]]
    houses = {(r["ku"], r["name"], r["cat"]) for r in rows}
    out = {
        "updated": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "source": "横浜市 記者発表（建築局）「横浜市営住宅の抽選結果について」の応募状況表PDF",
        "index": "https://www.city.yokohama.lg.jp/city-info/koho-kocho/press/kenchiku/",
        "note": ("倍率は公表表の列を読まず、応募者数÷募集戸数で当方が計算している。"
                 "区・募集区分は表の結合セルを上から引き継いでいる（2ページ目まで）。"
                 "表末尾の合計（募集戸数・応募者数）と1件まで合う回だけを使い、"
                 "入居者募集の記者発表の募集区分ごとの戸数とも突き合わせている。"
                 "単身可（※。令和4年4月は太字）とエレベーター（〇□△×）は資料の凡例にある印を住宅名から切り出したもの。"),
        "rounds": [l["round"] for l in used],
        "ledger": ledger,
        "rows": rows,
    }
    print("PDF %d回 → 使えた %d回 ／ 使えなかった %d回" % (len(files), len(used), len(ledger) - len(used)))
    print("  行 %d件 ／ 区×住宅×募集区分 %d件" % (len(rows), len(houses)))
    for l in ledger:
        b = l.get("boshu")
        print("  %s 行%s 読み取り%s 合計%s %s ／ 区分ごと%s ／ 単身の印 %s %s件・食い違い%s ／ EV印 %s" % (
            l["round"], l.get("rows"), l.get("sum"), l.get("published"), "一致" if l.get("match") else "★不一致",
            ("一致" if b and b["match"] else ("★" + json.dumps(b["diff"], ensure_ascii=False) if b else "（記者発表なし）")),
            l.get("tanshin", {}).get("src"), l.get("tanshin", {}).get("marked"), l.get("tanshin", {}).get("conflict"),
            l.get("ev")))
        if l.get("tanshin", {}).get("conflict"):
            print("      食い違い例:", l["tanshin"]["conflictRows"][:5])
    cats = Counter(r["cat"] for r in rows)
    print("  募集区分 %d：%s" % (len(cats), " / ".join("%s%d" % kv for kv in cats.most_common())))
    if BAD_KU:
        print("  ★18区に当てられなかった区の書き方 %d件：%s"
              % (len(BAD_KU), " / ".join("%s×%d" % kv for kv in Counter(BAD_KU).most_common(5))))
    print("  単身可 %d件 ／ エレベーターの印つき %d件"
          % (sum(1 for r in rows if r["tanshin"]), sum(1 for r in rows if r["ev"])))
    for l in ledger:
        if not l["used"]:
            print("  × %s  %s" % (l["round"], l.get("why")))
    if MISMATCH:
        print("  ★公表の倍率の列と食い違う行 %d：%s" % (len(MISMATCH), " / ".join(MISMATCH[:8])))
    if UNKNOWN:
        sys.stderr.write("\n★知らない書き方の単位・募集区分があります。UNITS/CATS に足してください：%s\n"
                         % " / ".join(sorted(UNKNOWN)))
        return 1
    if len(rows) < 300:
        sys.stderr.write("\n★行が少なすぎます（300未満）。読み取りが壊れていないか確かめてください。\n")
        return 1
    noku = sum(1 for r in rows if not r["ku"] and r["unit"] != "全市単位")
    if noku > len(rows) * 0.05:
        sys.stderr.write("\n★区が取れていない行が5%%を超えています（%d行）。結合セルの引き継ぎを確かめてください。\n" % noku)
        return 1
    if not DRY:
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print("\n書き出し %s（%.0fKB）" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
