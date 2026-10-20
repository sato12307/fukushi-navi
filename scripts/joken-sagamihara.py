# -*- coding: utf-8 -*-
"""相模原市営住宅の団地ごとの条件（住所・建設年度・エレベーター・階数）を公式資料から読み、
data/joken-sagamihara.json に書き出す。

使う資料（取得は手で行い、この台本はローカルのファイルだけを読む）
  指定管理者募集要項等（令和5年6月公表）
    https://www.city.sagamihara.kanagawa.jp/shisei/1026766/seido/1026770/shiteikanri/1028782/1028785.html
    → 04.zip → 02_【資料1～16】.zip の中の
       【資料3】市営住宅一覧.pdf      … 名称・所在地・備考
       【資料4】市営住宅施設概要.pdf  … 棟ごとの階数・建設年度・エレベーター台数

実行（資料のフォルダの外から・-I を付けて）
  python -I scripts/joken-sagamihara.py \
     --list "<raw>/【資料3】市営住宅一覧.pdf" \
     --facility "<raw>/【資料4】市営住宅施設概要.pdf" \
     --bairitsu data/sagamihara-bairitsu.json \
     --out data/joken-sagamihara.json
"""
import argparse
import json
import re
import sys
import unicodedata

import pdfplumber

ZIP_PAGE = "https://www.city.sagamihara.kanagawa.jp/shisei/1026766/seido/1026770/shiteikanri/1028782/1028785.html"
ZIP_URL = "https://www.city.sagamihara.kanagawa.jp/_res/projects/default_project/_page_/001/028/785/04.zip"  # 資料の取得元（参考）
STOCK_URL = "https://www.city.sagamihara.kanagawa.jp/_res/projects/default_project/_page_/001/019/824/01.pdf"
OUBO_R0605 = "https://www.city.sagamihara.kanagawa.jp/_res/projects/default_project/_page_/001/007/952/oubojyoukyou2020/20240502_16.pdf"
OUBO_R0611 = "https://www.city.sagamihara.kanagawa.jp/_res/projects/default_project/_page_/001/007/952/oubojoukyou_r07.pdf"

ERA = {"S": 1925, "H": 1988, "R": 2018}

# 倍率側の略記で、正規化しても一覧と一致しないもの → 寄せ先を含む語（正規化後）。
# 一覧の中で該当がちょうど1件のときだけ寄せる（0件・2件以上なら null）。
# 根拠：令和6年5月・11月の応募状況で「あじさい住宅大島→（上溝東）→あじさい(住宅)ｺﾝﾌｫｰﾙ→下溝→相武台」の順に並び、
# 資料3の No.54→55→57→58→59 と同じ。募集も高齢者単身者向1DKで、令和5年5月の「コンフォールさがみ南」と同じ。
ALIASES = {
    "あじさいｺﾝﾌｫｰﾙ": "あじさい住宅コンフォール",
    "あじさい住宅ｺﾝﾌｫｰﾙ": "あじさい住宅コンフォール",
}


def nfkc(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))


def clean(s):
    return (s or "").replace("\n", "").strip()


def wareki(s):
    """'S52' / 'H1' / 'R3' → 西暦。読めなければ None。"""
    m = re.fullmatch(r"([SHR])(\d{1,2}|元)", nfkc(s))
    if not m:
        return None
    n = 1 if m.group(2) == "元" else int(m.group(2))
    return ERA[m.group(1)] + n


def read_list(path):
    """【資料3】市営住宅一覧 → {No: {name, addr, kubun, note}}"""
    out = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for t in page.find_tables():
                rows = t.extract()
                head = [nfkc(c) for c in rows[0]]
                ci = {
                    "no": 0,
                    "kubun": next(i for i, h in enumerate(head) if h.startswith("区")),
                    "name": next(i for i, h in enumerate(head) if h.startswith("名")),
                    "addr": next(i for i, h in enumerate(head) if h.startswith("所在地")),
                    "note": next(i for i, h in enumerate(head) if h.startswith("備考")),
                }
                for r in rows[1:]:
                    no = clean(r[ci["no"]])
                    if not no.isdigit():
                        continue
                    out[int(no)] = {
                        "name": clean(r[ci["name"]]),
                        "addr": clean(r[ci["addr"]]),
                        "kubun": clean(r[ci["kubun"]]),
                        "note": clean(r[ci["note"]]) or None,
                    }
    return out


def read_list_text(path):
    """同じ資料3を本文テキストからも読む（表抽出の取りこぼし・表記ゆれの照合用）。"""
    out = {}
    pat = re.compile(r"^(\d+) (直接建設|借上げ) (\S+) (相模原市\S+)(?: (.+))?$")
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                m = pat.match(line.strip())
                if m:
                    out[int(m.group(1))] = {"name": m.group(3), "addr": m.group(4), "note": m.group(5)}
    return out


def read_facility(path):
    """【資料4】市営住宅施設概要 → {No: {name, kubun, buildings, blds:[{label, floors, built, ev, raw}]}}"""
    out = {}
    cur = None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for t in page.find_tables():
                rows = t.extract()
                head = [nfkc(c) for c in rows[0]]

                def col(pred):
                    hits = [i for i, h in enumerate(head) if pred(h)]
                    assert len(hits) == 1, (head, hits)
                    return hits[0]

                ci = {
                    "no": 0,
                    "kubun": col(lambda h: h == "区分"),
                    "name": col(lambda h: h.startswith("名")),
                    "nbld": col(lambda h: h == "棟数"),
                    "label": col(lambda h: h.startswith("棟名")),
                    "floors": col(lambda h: h == "階数"),
                    "built": col(lambda h: h == "建設年度"),
                    "ev": col(lambda h: h.startswith("エレベータ")),
                }
                for r in rows[1:]:
                    no = clean(r[ci["no"]])
                    if no.isdigit():
                        cur = int(no)
                        out[cur] = {
                            "name": clean(r[ci["name"]]),
                            "kubun": clean(r[ci["kubun"]]),
                            "buildings": int(clean(r[ci["nbld"]])),
                            "blds": [],
                        }
                    elif cur is None:
                        continue
                    label = clean(r[ci["label"]])
                    if not label:
                        continue
                    floors_s = nfkc(clean(r[ci["floors"]]))
                    built_s = clean(r[ci["built"]])
                    ev_s = nfkc(clean(r[ci["ev"]]))
                    m = re.fullmatch(r"\[(\d+)\]", nfkc(label))
                    count = int(m.group(1)) if m else 1  # [n] は同じ条件の棟が n 棟
                    if ev_s == "":
                        ev = 0  # 空白＝エレベーター無し（ストック計画 表3-1 の EV「×」と照合済み）
                    elif ev_s.isdigit():
                        ev = int(ev_s)
                    else:
                        ev = None  # 読めない
                    out[cur]["blds"].append({
                        "label": label,
                        "count": count,
                        "floors": int(floors_s) if floors_s.isdigit() else None,
                        "built": wareki(built_s),
                        "builtRaw": built_s,
                        "ev": ev,
                    })
    return out


def summarize(fac):
    blds = fac["blds"]
    n_rows = sum(b["count"] for b in blds)
    years = [b["built"] for b in blds if b["built"] is not None]
    floors = [b["floors"] for b in blds if b["floors"] is not None]
    evs = [b for b in blds if b["ev"] is not None]
    if not blds or len(evs) != len(blds):
        ev = None
    else:
        with_ev = sum(b["count"] for b in blds if b["ev"] >= 1)
        ev = "あり" if with_ev == n_rows else ("なし" if with_ev == 0 else "一部")
    return {
        "built": min(years) if len(years) == len(blds) and years else None,
        "builtNew": max(years) if len(years) == len(blds) and years else None,
        "floorsMax": max(floors) if len(floors) == len(blds) and floors else None,
        "buildings": fac["buildings"],
        "ev": ev,
        "_rowsCount": n_rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True)
    ap.add_argument("--facility", required=True)
    ap.add_argument("--bairitsu", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--updated", default="2026-10-20")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    lst = read_list(a.list)
    lst_txt = read_list_text(a.list)
    fac = read_facility(a.facility)
    problems = []

    # 表抽出と本文テキストの照合（名称・所在地が同じか）
    for no, v in lst.items():
        t = lst_txt.get(no)
        if not t:
            problems.append(f"資料3 No.{no} 本文テキストに無い")
        elif nfkc(t["name"]) != nfkc(v["name"]) or nfkc(t["addr"]) != nfkc(v["addr"]):
            problems.append(f"資料3 No.{no} 表と本文で違う: {v} / {t}")
    if set(lst) != set(fac):
        problems.append(f"資料3と資料4で No. の集合が違う: {sorted(set(lst) ^ set(fac))}")

    rows = []
    for no in sorted(lst):
        v = lst[no]
        f = fac.get(no)
        if f and nfkc(f["name"]) != nfkc(v["name"]):
            problems.append(f"No.{no} 名称が資料3『{v['name']}』と資料4『{f['name']}』で違う")
        s = summarize(f) if f else {"built": None, "builtNew": None, "floorsMax": None, "buildings": None, "ev": None, "_rowsCount": None}
        if f and s["_rowsCount"] != f["buildings"]:
            problems.append(f"No.{no} {v['name']} 棟数{f['buildings']} と棟の行の合計{s['_rowsCount']} が合わない")
        m = re.match(r"相模原市(緑区|中央区|南区)", v["addr"])
        rows.append({
            "name": v["name"],
            "ku": m.group(1) if m else None,
            "addr": v["addr"] or None,
            "built": s["built"],
            "builtNew": s["builtNew"],
            "floorsMax": s["floorsMax"],
            "buildings": s["buildings"],
            "ev": s["ev"],
            "note": v["note"],
        })

    # ありえない値
    for r in rows:
        for k in ("built", "builtNew"):
            if r[k] is not None and not (1950 <= r[k] <= 2026):
                problems.append(f"{r['name']} {k}={r[k]} が範囲外")
        if r["floorsMax"] is not None and not (1 <= r["floorsMax"] <= 30):
            problems.append(f"{r['name']} floorsMax={r['floorsMax']} が範囲外")

    # 倍率側の名前の寄せ
    bj = json.load(open(a.bairitsu, encoding="utf-8"))
    bnames = []
    for r in bj["rows"]:
        if r["name"] not in bnames:
            bnames.append(r["name"])
    by_norm = {}
    for r in rows:
        by_norm.setdefault(nfkc(r["name"]), []).append(r["name"])
    name_map, unmatched = {}, {}
    for bn in bnames:
        hits = by_norm.get(nfkc(bn), [])
        if len(hits) == 1:
            name_map[bn] = hits[0]
            continue
        if bn in ALIASES:
            key = nfkc(ALIASES[bn])
            cand = [r["name"] for r in rows if key in nfkc(r["name"])]
            if len(cand) == 1:
                name_map[bn] = cand[0]
                continue
            name_map[bn] = None
            unmatched[bn] = f"略記の寄せ先候補が{len(cand)}件で一つに決まらない"
            continue
        name_map[bn] = None
        unmatched[bn] = "一覧（資料3）に同じ名前の団地が無い" if not hits else f"一覧に同名が{len(hits)}件ある"

    out = {
        "city": "相模原市",
        "updated": a.updated,
        "sources": [
            {
                "name": "相模原市 市営住宅指定管理者募集要項等【資料3】市営住宅一覧",
                "url": ZIP_PAGE,
                "asof": "令和5年6月公表（募集要項等 ZIP の中の 02_【資料1～16】.zip）",
                "used": "name・ku・addr（備考を note に）",
            },
            {
                "name": "相模原市 市営住宅指定管理者募集要項等【資料4】市営住宅施設概要",
                "url": ZIP_PAGE,
                "asof": "令和5年6月公表（募集要項等 ZIP の中の 02_【資料1～16】.zip）",
                "used": "built・builtNew（棟ごとの建設年度の最古・最新）・floorsMax（階数）・buildings（棟数）・ev（エレベーター台数）",
            },
            {
                "name": "相模原市営住宅ストック総合活用兼長寿命化計画 表3-1 団地・住棟の概要",
                "url": STOCK_URL,
                "asof": "令和6年3月改訂",
                "used": "確かめのみ（資料4のエレベーター欄が空白の棟が表3-1で EV「×」であることを目視で照合）。値には使っていない",
            },
            {
                "name": "相模原市 市営住宅 過去の応募状況（令和6年5月募集）",
                "url": OUBO_R0605,
                "asof": "令和6年5月募集",
                "used": "nameMap の略記「あじさいｺﾝﾌｫｰﾙ」の寄せ先の確かめ（一覧と同じ並び順・高齢者単身者向1DK）",
            },
            {
                "name": "相模原市 市営住宅 過去の応募状況（令和6年11月募集）",
                "url": OUBO_R0611,
                "asof": "令和6年11月募集",
                "used": "nameMap の略記「あじさい住宅ｺﾝﾌｫｰﾙ」の寄せ先の確かめ（一覧と同じ並び順・高齢者単身者向1DK）",
            },
        ],
        "builtLabel": "建設年度",
        "rows": rows,
        "nameMap": name_map,
        "unmatched": unmatched,
    }
    with open(a.out, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
        fp.write("\n")

    # 確かめの表示
    n = len(rows)
    print(f"rows={n} built={sum(r['built'] is not None for r in rows)} ev={sum(r['ev'] is not None for r in rows)} "
          f"addr={sum(bool(r['addr']) for r in rows)} floorsMax={sum(r['floorsMax'] is not None for r in rows)}")
    print("ev内訳", {k: sum(r["ev"] == k for r in rows) for k in ("あり", "一部", "なし", None)})
    print(f"nameMap 寄せた {sum(v is not None for v in name_map.values())}/{len(name_map)}  unmatched={unmatched}")
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
