# -*- coding: utf-8 -*-
"""川崎市営住宅の団地ごとの条件（住所・建設年度・エレベーター・階数・最寄り駅と徒歩分）を
公式資料から読み、data/joken-kawasaki.json に書き出す。

使う資料（取得は手で行い、この台本はローカルのファイルだけを読む）
  1) 区別の市営住宅一覧（市のHTML・令和8年4月1日現在）
       https://www.city.kawasaki.jp/500/page/0000017657.html から各区の7ページ
       （0000017616 川崎区 / 0000017695 幸区 / 0000017637 中原区 / 0000017685 高津区 /
         0000017621 宮前区 / 0000017678 多摩区 / 0000017602 麻生区）
       → name・ku・addr・station・walkMin・bus。団地の並び（rows）はこの一覧が正。
       （0000017610 借上市営住宅一覧 は名前と住所の照合だけに使う）
  2) 市営住宅の指定管理者の募集（令和8年5月）の「別紙1～14、資料1」ZIP
       https://www.city.kawasaki.jp/500/page/0000187115.html
       別紙1_市営住宅一覧.pdf（R8.4.1時点）… 棟・建設年度・階数・管理戸数・エレベーター基数
       別紙3_昇降機施設維持管理業務取扱要領.pdf の別表「昇降機一覧」（令和8年4月1日現在）
         … 棟ごとのエレベーター（別紙1のEV欄は団地単位の結合セルが多く、棟が決まらないため）

実行（資料のフォルダの外から・-I を付けて）
  python -I scripts/joken-kawasaki.py --raw "<raw>/kawasaki" \
     --bairitsu data/kawasaki-bairitsu.json --out data/joken-kawasaki.json
  <raw>/kawasaki に ku-<ページ番号>.html（8ページ）と besshi/besshi_shiryo/別紙1・別紙3 の PDF を置く。

読み方の決めごと
  ・棟の数・建設年度・階数は「市営住宅として募集される棟」で数える。
    管理戸数0の棟（用途廃止）と、特公賃だけの棟（中野島多摩川2・3、千年新町3）は除く。
    区別一覧の管理戸数は「別紙1の管理戸数 − 特公賃」と一致する（全団地で照合し、ずれは報告に出す）。
  ・建設年度「S58.S59」「S50.51」のように2か年あるものは、古い方を built、新しい方を builtNew に入れる。
  ・ev は棟ごとに決める。別紙3で棟が名指しされていればその棟は「あり」。別紙3で棟が空欄なら
    単棟の団地はその棟、複数棟なら住所が1棟だけに当たる時だけその棟。
    別紙1のEV欄は、結合していないセルなら棟の値としてそのまま使い、結合セル（複数棟にまたがる）なら
    その範囲の基数の合計が別紙3で棟が決まった基数と一致する時だけ「残りの棟はなし」と決める。
    どれでも決まらない棟が残り、ほかの棟だけでは「あり／一部」が決まらない団地は null（note に理由）。
  ・nameMap は倍率側の名前から（ ）以降を落とし、全角半角・ヶ/ケ・五/5・Ⅱ/2・中黒を寄せて
    区別一覧の名前と完全一致した時だけ寄せる。誤字は ALIASES に理由つきで書いたものだけ寄せる。
    寄せた後、倍率側の code（下4桁の頭3桁＝別紙1の住宅コード）で確かめ、合わないものは報告に出す。
"""
import argparse
import glob
import html as htmlmod
import json
import os
import re
import sys
import unicodedata
from collections import Counter, OrderedDict, defaultdict

import pdfplumber

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

INDEX_URL = "https://www.city.kawasaki.jp/500/page/0000017657.html"
SHITEI_URL = "https://www.city.kawasaki.jp/500/page/0000187115.html"
ZIP_URL = "https://www.city.kawasaki.jp/500/cmsfiles/contents/0000187/187115/besshi_shiryo.zip"
KU_ORDER = ["川崎区", "幸区", "中原区", "高津区", "宮前区", "多摩区", "麻生区"]

# 倍率側の誤字で、名前だけでは寄らないもの（理由と確かめ方を必ず書く）
ALIASES = {
    # 「久夫表Ａ」は 2019-2020 頃の表の誤字。code 12 4860 → 住宅コード486＝久末表A（別紙1）と一致。
    "久夫表A": "久末表A",
}

# --------------------------------------------------------------------------- 共通


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def name_key(s):
    """団地名の照合用のかぎ。表記の小差だけを寄せる（別の団地どうしが同じかぎにならないことは main で確かめる）。"""
    s = (s or "").replace("Ⅱ", "2").replace("Ⅰ", "")
    s = nfkc(s)
    s = re.sub(r"\s+", "", s)
    s = s.replace("ヶ", "ケ").replace("ヵ", "カ").replace("・", "").replace("･", "")
    s = s.replace("五丁目", "5丁目")
    return s


def addr_key(s):
    s = nfkc(s)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"^(川崎市)?(川崎区|幸区|中原区|高津区|宮前区|多摩区|麻生区)", "", s)
    return s


def to_int(s):
    s = nfkc(s).replace(",", "").strip()
    return int(s) if re.fullmatch(r"\d+", s) else 0


ERA_BASE = {"S": 1925, "H": 1988, "R": 2018}


def parse_years(raw):
    """'S58.S59' → [1983,1984]、'S50.51' → [1975,1976]、'H7' → [1995]。読めなければ []。"""
    s = nfkc(raw).replace(" ", "")
    out, era = [], None
    for m in re.finditer(r"([SHR])?(\d{1,2})", s):
        if m.group(1):
            era = m.group(1)
        if era is None:
            return []
        out.append(ERA_BASE[era] + int(m.group(2)))
    return out


def parse_floors(raw):
    s = nfkc(raw).strip()
    m = re.match(r"^(\d{1,2})", s)
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------- 1) 区別一覧（HTML）


def cell_text(c):
    c = re.sub(r"<[^>]+>", " ", c)
    return re.sub(r"\s+", " ", htmlmod.unescape(c)).strip()


def parse_ku_pages(raw_dir):
    ku_rows, kariage = [], []
    files = sorted(glob.glob(os.path.join(raw_dir, "ku-*.html")))
    if not files:
        sys.exit("ku-*.html が見つからない: " + raw_dir)
    for f in files:
        t = open(f, encoding="utf-8").read()
        cap = re.search(r"<caption>(.*?)</caption>", t, re.S)
        cap = cell_text(cap.group(1)) if cap else ""
        asof = re.search(r"令和\d+[（(]\d{4}[)）]?年\d+月\d+日現在", cap)
        trs = re.findall(r"<tr.*?</tr>", t, re.S)
        header = None
        is_kariage = "借上市営住宅一覧" in cap
        mku = re.match(r"^(\S+?区)内の", cap)
        ku = mku.group(1) if mku else None
        cur_ku = None
        for tr in trs:
            cells = [cell_text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
            if header is None:
                if "住宅名" in cells:
                    header = cells
                continue
            if not cells or not re.fullmatch(r"\d+", cells[0]):
                continue
            if is_kariage:
                # 借上一覧は区の列が rowspan なので、列の数で見分ける
                if len(cells) == 5:
                    cur_ku = cells[1]
                    name, addr, units = cells[2], cells[3], cells[4]
                else:
                    name, addr, units = cells[1], cells[2], cells[3]
                kariage.append({"ku": cur_ku, "name": name, "addr": addr, "units": to_int(units)})
                continue
            row = dict(zip(header, cells))
            ku_rows.append({
                "ku": ku,
                "name": row["住宅名"],
                "addr_raw": row["所在地"],
                "transport": row["最寄りの交通機関"],
                "units": to_int(row["管理戸数"]),
                "biko": row.get("備考", ""),
                "page": os.path.basename(f),
                "asof": asof.group(0) if asof else None,
            })
    return ku_rows, kariage


TRANSPORT_RE = re.compile(r"^(.+?)駅(?:西口|東口|北口|南口)?・(徒歩|バス)(\d+)分")


def parse_transport(s):
    m = TRANSPORT_RE.match(nfkc(s).replace(" ", ""))
    if not m:
        return None, None, None
    station = m.group(1)
    # NFKC で崩れない表記に戻す（ヶ などはそのまま。全角数字は使われていない）
    if m.group(2) == "徒歩":
        return station, int(m.group(3)), False
    return station, None, True


# --------------------------------------------------------------------------- 2) 別紙1（棟ごと）


def parse_besshi1(pdf_path):
    """団地（住宅名の行で始まる）ごとに棟の行を束ねる。"""
    danchi = []
    cur = None
    cur_ku = None
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            m = re.search(r"市営住宅一覧（(\S+?区)）", text)
            if m:
                cur_ku = m.group(1)
            elif pno == 0:
                continue  # 1ページ目は区ごとの集計表
            tables = page.find_tables()
            if not tables:
                continue
            t = tables[0]
            data = t.extract()
            rows = t.rows
            for ri, (vals, row) in enumerate(zip(data, rows)):
                vals = [(v or "").replace("\n", "/") for v in vals]
                if len(vals) != 24:
                    raise SystemExit(f"別紙1 p{pno} の列の数が24でない: {len(vals)} {vals}")
                code, name, addr, tou, built, kaishi, kozo, floors, units = vals[1:10]
                if "住宅" in code and "コード" in code:
                    continue  # 見出し
                if code in ("小計", "合計", "借上住宅") or (not code and not name and not tou and not built):
                    continue
                if name:
                    if not code and row.cells[1] is None and cur is not None:
                        # 住宅コードのセルが上の団地と結合している（平５丁目風久保Ⅰ・Ⅱ＝531）
                        code = cur["code"]
                    cur = {
                        "ku": cur_ku, "code": code, "name": name, "page": pno,
                        "buildings": [], "_last_addr": "",
                    }
                    danchi.append(cur)
                elif code and not name:
                    raise SystemExit(f"別紙1 p{pno}: コードだけあって住宅名が無い行 {vals}")
                if cur is None:
                    raise SystemExit(f"別紙1 p{pno}: 団地の前に棟の行がある {vals}")
                if addr:
                    cur["_last_addr"] = addr
                evcell = row.cells[16]
                if evcell is None:
                    ev_state = "covered"   # 上の結合セルに含まれる
                else:
                    ev_state = "own"
                    # 結合の始まりかどうかは、行の高さとセルの高さで見る
                    rtop, rbot = row.bbox[1], row.bbox[3]
                    if evcell[3] - rbot > 1.0:
                        ev_state = "mergedTop"
                cur["buildings"].append({
                    "tou": tou,
                    "addr": addr or cur["_last_addr"],
                    "addrOwn": bool(addr),
                    "builtRaw": built,
                    "years": parse_years(built),
                    "kozo": kozo,
                    "floorsRaw": floors,
                    "floors": parse_floors(floors),
                    "units": to_int(units),
                    "koei": to_int(vals[10]), "junkoei": to_int(vals[11]), "kairyo": to_int(vals[12]),
                    "juzen": to_int(vals[13]), "tokkochin": to_int(vals[14]),
                    "biko": vals[15],
                    "evRaw": vals[16], "evState": ev_state, "ev1": to_int(vals[16]),
                    "_bbox": (round(row.bbox[1], 1), round(row.bbox[3], 1)),
                    "_evbbox": None if evcell is None else (round(evcell[1], 1), round(evcell[3], 1)),
                })
    for d in danchi:
        d.pop("_last_addr", None)
    return danchi


# --------------------------------------------------------------------------- 3) 別紙3（昇降機一覧）


def parse_besshi3(pdf_path):
    out = []
    with pdfplumber.open(pdf_path) as pdf:
        cur_ku = None
        cur_name = None
        for pno, page in enumerate(pdf.pages):
            for t in page.find_tables():
                data = t.extract()
                if not data:
                    continue
                head = [(c or "").replace(" ", "") for c in data[0]]
                if "住宅名" not in head:
                    continue
                ci = {k: head.index(k) for k in ("棟数", "住宅名", "棟", "住所", "停止階", "台数", "備考")}
                for vals in data[1:]:
                    vals = [(v or "").replace("\n", "/").strip() for v in vals]
                    first = vals[0]
                    if re.fullmatch(r"\S+区", first) and not vals[ci["棟数"]]:
                        cur_ku, cur_name = first, None
                        continue
                    # 区ごとの「計」と最後の「全合計」の行も棟数の列に数字が入るので、先に落とす
                    if first == "計" or "合計" in "".join(vals):
                        continue
                    if not re.fullmatch(r"\d+", vals[ci["棟数"]] or ""):
                        continue
                    if vals[ci["住宅名"]]:
                        cur_name = vals[ci["住宅名"]]
                    m = re.match(r"(\d+)基", vals[ci["台数"]].replace(" ", ""))
                    tou, addr = vals[ci["棟"]], vals[ci["住所"]]
                    if not addr and len(tou) > 4:
                        # サンライズ千代ヶ丘の行は住所が棟の列にずれて出る（棟の記入は無い）
                        tou, addr = "", tou
                    out.append({
                        "ku": cur_ku, "name": cur_name, "tou": tou,
                        "addr": addr, "stop": vals[ci["停止階"]],
                        "count": int(m.group(1)) if m else 0, "biko": vals[ci["備考"]], "page": pno,
                    })
    return out


# --------------------------------------------------------------------------- 団地ごとの判定


def included(b):
    if b["units"] == 0:
        return False, "管理戸数0（用途廃止）"
    if b["koei"] + b["junkoei"] + b["kairyo"] + b["juzen"] == 0 and b["tokkochin"] > 0:
        return False, "特公賃のみの棟"
    return True, ""


def decide_ev(d1, e3list, problems):
    """棟ごとの EV の有無を決め、団地の ev（あり／一部／なし／None）と note を返す。"""
    allb = d1["buildings"]
    inc = [b for b in allb if included(b)[0]]
    status = {id(b): None for b in inc}
    n3 = defaultdict(int)  # 別紙3で棟が決まった基数（棟ごと）
    unassigned3 = []
    # --- 別紙3
    for e in e3list:
        target = None
        if e["tou"]:
            cand = [b for b in allb if nfkc(b["tou"]) == nfkc(e["tou"])]
            if len(cand) == 1:
                target = cand[0]
            else:
                problems.append(f"別紙3 {e['name']} 棟{e['tou']} が別紙1の棟に当たらない（{len(cand)}件）")
        else:
            if len(allb) == 1:
                target = allb[0]
            else:
                ak = addr_key(e["addr"])
                cand = [b for b in allb if addr_key(b["addr"]) == ak]
                if len(cand) == 1:
                    target = cand[0]
        if target is None:
            unassigned3.append(e)
            continue
        if id(target) not in status:
            continue  # 除いた棟（特公賃のみ等）の EV
        status[id(target)] = True
        n3[id(target)] += e["count"]
    # --- 別紙1（結合していないセルは棟の値、結合セルは範囲の合計で照合）
    spans = []
    cur_span = None
    for b in allb:
        if b["evState"] in ("own", "mergedTop"):
            cur_span = {"n": b["ev1"], "members": [b], "merged": b["evState"] == "mergedTop"}
            spans.append(cur_span)
        else:  # covered
            if cur_span is None:
                problems.append(f"別紙1 {d1['name']}: EV欄の結合の頭が見つからない")
                continue
            cur_span["members"].append(b)
            cur_span["merged"] = True
    for sp in spans:
        mem = [b for b in sp["members"] if id(b) in status]
        if not sp["merged"]:
            b = sp["members"][0]
            if id(b) not in status:
                continue
            if sp["n"] > 0:
                if n3.get(id(b)) not in (None, sp["n"]) and n3.get(id(b), 0) != 0:
                    problems.append(f"{d1['name']} 棟{b['tou'] or '-'}: 別紙1のEV {sp['n']}基 と 別紙3 {n3[id(b)]}基 が違う")
                status[id(b)] = True
            else:
                if status[id(b)] is True:
                    problems.append(f"{d1['name']} 棟{b['tou'] or '-'}: 別紙1のEV欄は空だが別紙3にあり（別紙3を採用）")
                else:
                    status[id(b)] = False
        else:
            m3 = sum(n3.get(id(b), 0) for b in sp["members"])
            if sp["n"] == m3:
                for b in mem:
                    if status[id(b)] is None:
                        status[id(b)] = False
            elif sp["n"] > 0 and m3 == 0 and len(mem) == 1:
                status[id(mem[0])] = True
            # それ以外は決まらない棟が残る（None のまま）
    vals = [status[id(b)] for b in inc]
    note = None
    if not inc:
        return None, "市営住宅の棟が無い", {}
    if all(v is True for v in vals):
        ev = "あり"
    elif all(v is False for v in vals):
        ev = "なし"
    elif any(v is True for v in vals) and any(v is False for v in vals):
        ev = "一部"
    else:
        ev = None
        und = [b["tou"] or "-" for b in inc if status[id(b)] is None]
        total1 = sum(sp["n"] for sp in spans)
        floors_txt = "・".join(f"棟{b['tou'] or '-'}={b['floorsRaw']}階" for b in inc)
        note = (f"エレベーターは団地に{total1}基（別紙1・団地で1つの結合セル）あるが、どの棟かが資料で決まらない"
                f"（決まらない棟: {','.join(und)}。階数 {floors_txt}）")
        if unassigned3:
            note += "。別紙3は棟の記入なし（" + "、".join(
                f"{e['addr']} 停止階{e['stop']}・{e['count']}基 {e['biko']}".strip() for e in unassigned3) + "）"
    return ev, note, {b["tou"] or "-": status[id(b)] for b in inc}


# --------------------------------------------------------------------------- main


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="落とした資料のフォルダ（ku-*.html と besshi/ を含む）")
    ap.add_argument("--bairitsu", default=os.path.join(repo, "data", "kawasaki-bairitsu.json"))
    ap.add_argument("--out", default=os.path.join(repo, "data", "joken-kawasaki.json"))
    ap.add_argument("--updated", default="2026-10-20")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    b1 = glob.glob(os.path.join(a.raw, "**", "別紙1_*.pdf"), recursive=True)
    b3 = glob.glob(os.path.join(a.raw, "**", "別紙3_*.pdf"), recursive=True)
    if len(b1) != 1 or len(b3) != 1:
        sys.exit(f"別紙1/別紙3 の PDF が1つずつ見つからない: {b1} {b3}")

    problems = []
    ku_rows, kariage = parse_ku_pages(a.raw)
    # 区の並び（川崎区→麻生区）に。区の中は一覧の並びのまま
    ku_rows.sort(key=lambda r: KU_ORDER.index(r["ku"]))
    d1list = parse_besshi1(b1[0])
    e3 = parse_besshi3(b3[0])
    print(f"区別一覧 {len(ku_rows)} 団地 / 借上一覧 {len(kariage)} / 別紙1 {len(d1list)} 団地 "
          f"{sum(len(d['buildings']) for d in d1list)} 棟 / 別紙3 {len(e3)} 行 {sum(e['count'] for e in e3)} 基")

    # かぎの重なり（別の団地が同じかぎにならないこと）
    kc = Counter(name_key(r["name"]) for r in ku_rows)
    dup = [k for k, n in kc.items() if n > 1]
    if dup:
        sys.exit(f"区別一覧の名前のかぎが重なる: {dup}")

    # 別紙1 を区＋かぎで引けるように
    d1map = {}
    for d in d1list:
        k = (d["ku"], name_key(d["name"]))
        if k in d1map:
            sys.exit(f"別紙1 の名前のかぎが重なる: {k}")
        d1map[k] = d
    e3map = defaultdict(list)
    for e in e3:
        e3map[(e["ku"], name_key(e["name"]))].append(e)

    # 借上一覧との照合（名前・住所・戸数）
    kmap = {(r["ku"], name_key(r["name"])): r for r in ku_rows}
    for k in kariage:
        r = kmap.get((k["ku"], name_key(k["name"])))
        if not r:
            problems.append(f"借上一覧の {k['ku']} {k['name']} が区別一覧に無い")
        elif addr_key(r["addr_raw"]) != addr_key(k["addr"]) or r["units"] != k["units"]:
            problems.append(f"借上一覧と区別一覧で違う: {k} / {r['addr_raw']} {r['units']}")

    rows = []
    checks = []
    used_d1 = set()
    used_e3 = set()
    for r in ku_rows:
        key = (r["ku"], name_key(r["name"]))
        d1 = d1map.get(key)
        station, walk, bus = parse_transport(r["transport"])
        if station is None:
            problems.append(f"最寄りが読めない: {r['name']} {r['transport']}")
        addr = "川崎市" + re.sub(r"\s+", "", r["addr_raw"])
        row = OrderedDict([
            ("name", r["name"]), ("ku", r["ku"]), ("addr", addr),
            ("built", None), ("builtNew", None), ("floorsMax", None), ("buildings", None),
            ("ev", None), ("station", station), ("walkMin", walk), ("bus", bus), ("note", None),
        ])
        notes = []
        if d1 is None:
            problems.append(f"別紙1 に無い: {r['ku']} {r['name']}")
            row["note"] = "別紙1（棟の一覧）に見当たらない"
            rows.append(row)
            continue
        used_d1.add(id(d1))
        inc = [b for b in d1["buildings"] if included(b)[0]]
        exc = [(b, included(b)[1]) for b in d1["buildings"] if not included(b)[0]]
        # 住所の照合（区別一覧の住所と別紙1の最初の棟の住所の頭がそろうか）
        ak1 = addr_key(r["addr_raw"])
        ak2 = addr_key(d1["buildings"][0]["addr"])
        cp = os.path.commonprefix([ak1, ak2])
        addr_ok = bool(re.search(r"\d", cp))
        # 戸数の照合
        u1 = sum(b["units"] - b["tokkochin"] for b in d1["buildings"])
        checks.append({
            "name": r["name"], "ku": r["ku"], "b1name": d1["name"], "b1code": d1["code"],
            "addrList": r["addr_raw"], "addrB1": d1["buildings"][0]["addr"], "addrOk": addr_ok,
            "unitsList": r["units"], "unitsB1": u1, "unitsOk": r["units"] == u1,
        })
        if not addr_ok:
            problems.append(f"住所の頭がそろわない: {r['name']} 一覧「{r['addr_raw']}」 別紙1「{d1['buildings'][0]['addr']}」")
        if r["units"] != u1:
            problems.append(f"管理戸数が違う: {r['name']} 一覧 {r['units']} / 別紙1(特公賃を除く) {u1}")
        years = [y for b in inc for y in b["years"]]
        bad_years = [b["builtRaw"] for b in inc if not b["years"]]
        if bad_years:
            problems.append(f"建設年度が読めない棟: {r['name']} {bad_years}")
        if years:
            row["built"] = min(years)
            row["builtNew"] = max(years)
            if len(inc) == 1 and len(set(years)) > 1:
                notes.append(f"建設年度は「{inc[0]['builtRaw']}」の2か年にまたがる（1棟）")
        floors = [b["floors"] for b in inc if b["floors"] is not None]
        if any(b["floors"] is None for b in inc):
            miss = [b["tou"] or "-" for b in inc if b["floors"] is None]
            notes.append("別紙1で階数が空欄の棟あり（棟: " + ",".join(miss) + "）")
        row["floorsMax"] = max(floors) if floors and len(floors) == len(inc) else (max(floors) if floors else None)
        if floors and len(floors) != len(inc):
            notes.append("floorsMax は階数が書かれた棟だけの最大")
        row["buildings"] = len(inc)
        es = e3map.get(key, [])
        for e in es:
            used_e3.add(id(e))
        res = decide_ev(d1, es, problems)
        ev, evnote = res[0], res[1]
        ev1sum = sum(b["ev1"] for b in d1["buildings"])
        ev3sum = sum(e["count"] for e in es)
        if ev1sum != ev3sum:
            problems.append(f"EV基数が別紙1と別紙3で違う: {r['name']} 別紙1 {ev1sum} / 別紙3 {ev3sum}（ev={ev}）")
        row["ev"] = ev
        if evnote:
            notes.append(evnote)
        if exc:
            notes.append("数えていない棟: " + "、".join(f"{b['tou'] or '-'}（{why}）" for b, why in exc))
        row["note"] = "／".join(notes) if notes else None
        row["_codes"] = d1["code"]
        row["_evByTou"] = res[2] if len(res) > 2 else None
        rows.append(row)

    for d in d1list:
        if id(d) not in used_d1:
            live = [b for b in d["buildings"] if included(b)[0]]
            problems.append(f"別紙1 にあって区別一覧に無い: {d['ku']} {d['name']}（市営として数える棟 {len(live)}）")
    for e in e3:
        if id(e) not in used_e3:
            problems.append(f"別紙3 の行が団地に当たらない: {e['ku']} {e['name']} 棟{e['tou']}")

    # ------------------------------------------------------------- nameMap
    bj = json.load(open(a.bairitsu, encoding="utf-8"))
    bnames = []
    bcodes = defaultdict(Counter)
    for x in bj["rows"]:
        if x["name"] not in bcodes:
            bnames.append(x["name"])
        bcodes[x["name"]][nfkc(x.get("code") or "").split(" ")[-1][:3]] += 1
    rowkey = {name_key(r["name"]): r for r in rows}
    namemap, unmatched, codecheck = OrderedDict(), OrderedDict(), []
    for bn in sorted(bnames):
        # NFKC は「Ⅱ」を「II」に崩すので、かっこで切るのは元の文字列のまま（name_key の中で寄せる）
        base = re.split(r"[(（]", bn)[0]
        k = name_key(base)
        k = name_key(ALIASES.get(k, k))
        r = rowkey.get(k)
        if r is None:
            namemap[bn] = None
            unmatched[bn] = "区別一覧（令和8年4月1日現在）に同じ名前の団地が無い"
            continue
        namemap[bn] = r["name"]
        codes = set(re.split(r"/", nfkc(r["_codes"])))
        cnt = bcodes[bn]
        ok = sum(n for c, n in cnt.items() if c in codes)
        ng = {c: n for c, n in cnt.items() if c not in codes}
        if ng:
            codecheck.append((bn, r["name"], sorted(codes), dict(cnt), ng, ok))

    out = OrderedDict([
        ("city", "川崎市"),
        ("updated", a.updated),
        ("sources", [
            {"name": "川崎市「川崎市営住宅一覧」区別の市営住宅一覧（川崎区〜麻生区の7ページ）",
             "url": INDEX_URL, "asof": "令和8年4月1日現在",
             "used": "name・ku・addr（所在地）・station・walkMin・bus（最寄りの交通機関）。団地の並びもこの一覧"},
            {"name": "川崎市営住宅の（一部指定管理業務の）指定管理者の募集について 別紙1「市営住宅一覧」",
             "url": SHITEI_URL, "asof": "令和8年4月1日時点（R8.4.1）",
             "used": "built・builtNew（棟ごとの建設年度の最古・最新）・floorsMax（階数）・buildings（棟数）・ev（エレベーター基数の欄。結合していないセルだけ棟の値として使用）"},
            {"name": "同 別紙3「昇降機施設維持管理業務取扱要領」別表 昇降機一覧",
             "url": SHITEI_URL, "asof": "令和8年4月1日現在",
             "used": "ev（棟ごとのエレベーターの有無）"},
        ]),
        ("builtLabel", "建設年度"),
        ("rows", [OrderedDict((k, v) for k, v in r.items() if not k.startswith("_")) for r in rows]),
        ("nameMap", namemap),
        ("unmatched", unmatched),
    ])

    # ------------------------------------------------------------- 報告
    n = len(rows)
    def cnt(f):
        return sum(1 for r in rows if f(r))
    print(f"rows {n}")
    print(f"  built 埋まり {cnt(lambda r: r['built'] is not None)} / builtNew {cnt(lambda r: r['builtNew'] is not None)}"
          f" / floorsMax {cnt(lambda r: r['floorsMax'] is not None)} / buildings {cnt(lambda r: r['buildings'] is not None)}")
    print(f"  ev 埋まり {cnt(lambda r: r['ev'] is not None)}  内訳 {Counter(r['ev'] for r in rows)}")
    print(f"  addr {cnt(lambda r: bool(r['addr']))} / station {cnt(lambda r: r['station'] is not None)}"
          f" / walkMin {cnt(lambda r: r['walkMin'] is not None)} / bus {cnt(lambda r: r['bus'] is True)}")
    yrs = [y for r in rows for y in (r["built"], r["builtNew"]) if y is not None]
    fls = [r["floorsMax"] for r in rows if r["floorsMax"] is not None]
    print(f"  建設年度の範囲 {min(yrs)}〜{max(yrs)} / 階数の範囲 {min(fls)}〜{max(fls)}"
          f" / 徒歩分の範囲 {min(r['walkMin'] for r in rows if r['walkMin'])}〜{max(r['walkMin'] for r in rows if r['walkMin'])}")
    bad = [r["name"] for r in rows if (r["built"] and not 1950 <= r["built"] <= 2026)
           or (r["builtNew"] and not 1950 <= r["builtNew"] <= 2026)
           or (r["floorsMax"] and not 1 <= r["floorsMax"] <= 30)
           or (r["built"] and r["builtNew"] and r["built"] > r["builtNew"])]
    print(f"  ありえない値 {bad}")
    print(f"住所の照合 OK {sum(c['addrOk'] for c in checks)}/{len(checks)} ・ 戸数の照合 OK {sum(c['unitsOk'] for c in checks)}/{len(checks)}")
    matched = sum(1 for v in namemap.values() if v)
    print(f"nameMap {len(namemap)} 種類中 寄せた {matched} / null {len(namemap) - matched}")
    for k, v in unmatched.items():
        print(f"  unmatched: {k} … {v}")
    print(f"code の確かめで合わない行を含む名前 {len(codecheck)}")
    for c in codecheck:
        print(f"  {c[0]} → {c[1]} 住宅コード{c[2]} 倍率側code頭3桁{c[3]} 合わない{c[4]}")
    print(f"気になる点 {len(problems)}")
    for p in problems:
        print("  - " + p)
    if a.verbose:
        for r in rows:
            print(json.dumps({k: v for k, v in r.items()}, ensure_ascii=False))
        for c in checks:
            if not c["addrOk"] or not c["unitsOk"]:
                print(c)
    if a.dry:
        return
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("書き出し: " + a.out)


if __name__ == "__main__":
    main()
