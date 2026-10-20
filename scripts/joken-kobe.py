# -*- coding: utf-8 -*-
"""神戸市営住宅の団地ごとの条件（住所・竣工年度・エレベーター・最寄り駅名）を
神戸市「市営住宅一覧」（区ごと・五十音別ページ）から読み取り data/joken-kobe.json に書き出す。

使い方（資料のフォルダの中では実行しない。資料のパスは引数で渡す）:
  python -I scripts/joken-kobe.py fetch <rawdir>
  python -I scripts/joken-kobe.py parse <rawdir> <bairitsu.json> <out.json> [<debug.json>]

- fetch: 目次 → 9区の目次 → 各区の五十音別ページを <rawdir> に保存（既にあれば取りに行かない・1ページごとに間をあける）
- parse: 保存したページから住宅ごとの行を作り、倍率側の名前との対応（nameMap）も作る
- 地図リンクは /maps/place/ の直後の住所の文字列だけ読む。座標（@緯度,経度 や data=）は読まない・使わない
- 倍率側（kobe-bairitsu.json）は rows[].name だけ使う
"""
import sys
import os
import re
import json
import time
import html
import unicodedata
import urllib.request
import urllib.parse

BASE = "https://www.city.kobe.lg.jp"
INDEX = BASE + "/a28775/kurashi/sumai/jutaku/information/shiei/moushikomi/ichiran/index.html"
WARDS = [  # (ディレクトリ名, 区名)
    ("higasinada", "東灘区"), ("nada", "灘区"), ("chuou", "中央区"), ("hyougo", "兵庫区"),
    ("nagata", "長田区"), ("kita", "北区"), ("suma", "須磨区"), ("tarumi", "垂水区"), ("nisi", "西区"),
]
UA = "Mozilla/5.0 (compatible; fukushiru-data/1.0; +https://fukushiru.com/)"
WAIT = 2.5


# ---------------------------------------------------------------- fetch
def _get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return open(path, encoding="utf-8").read(), False
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(body)
    time.sleep(WAIT)
    return body, True


def fetch(rawdir):
    os.makedirs(rawdir, exist_ok=True)
    _get(INDEX, os.path.join(rawdir, "index.html"))
    got = []
    for d, ku in WARDS:
        widx = f"{BASE}/a28775/kurashi/sumai/jutaku/information/shiei/moushikomi/ichiran/{d}/index.html"
        body, _ = _get(widx, os.path.join(rawdir, f"{d}__index.html"))
        pat = re.compile(r'href="(/a28775/kurashi/sumai/jutaku/information/shiei/moushikomi/ichiran/%s/([a-z0-9_]+)\.html)(?:#[^"]*)?"' % d)
        subs = []
        for m in pat.finditer(body):
            if m.group(2) == "index" or m.group(1) in [s[0] for s in subs]:
                continue
            subs.append((m.group(1), m.group(2)))
        for href, stem in subs:
            p = os.path.join(rawdir, f"{d}__{stem}.html")
            _, fresh = _get(BASE + href, p)
            got.append((ku, stem, fresh))
        print(ku, len(subs), "ページ", file=sys.stderr)
    print("pages:", len(got), "new:", sum(1 for g in got if g[2]), file=sys.stderr)


# ---------------------------------------------------------------- parse helpers
def text_of(fragment):
    s = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    return " ".join(x.strip() for x in s.split("\n") if x.strip())


def nk(s):
    """NFKC＋ダッシュ類を - に。"""
    t = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"[−‐‑‒–—―－]", "-", t)


LABEL_ALIAS = {"棟": "戸数", "建設年度": "竣工年度", "施工年度": "竣工年度"}


def table_cells(t):
    rec, raw_labels = {}, {}
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S):
        th = re.findall(r"<th[^>]*>(.*?)</th>", r, flags=re.S)
        td = re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)
        if not th or not td:
            continue
        lab = re.sub(r"[,，\s]+$", "", text_of(th[0]))
        raw_labels[LABEL_ALIAS.get(lab, lab)] = lab
        rec[LABEL_ALIAS.get(lab, lab)] = td[0]
    return rec, raw_labels


ERA = {"昭和": 1925, "平成": 1988, "令和": 2018}


def parse_years(cell):
    """竣工年度の欄 → (古い年, 新しい年, 型どおりか)。"""
    t = nk(text_of(cell)).replace(" ", "").replace("元年", "1年")
    years = [int(y) for y in re.findall(r"(?<!\d)((?:19|20)\d\d)(?!\d)", t)]
    for e, n in re.findall(r"(昭和|平成|令和)(\d{1,2})(?!\d)", t):
        years.append(ERA[e] + int(n))
    regular = bool(re.fullmatch(r"\d{4}年度?(?:[～〜~]\d{4}年度?)?", t))
    if not years:
        return None, None, regular
    return min(years), max(years), regular


def parse_ev(cell):
    t = nk(text_of(cell)).replace(" ", "")
    if "のみあり" in t or "一部" in t:
        return "一部"
    if t.startswith("あり"):
        return "あり"
    if t.startswith("なし"):
        return "なし"
    return None


ST_PAT = re.compile(r"「([^」]+)」駅|(?:JR|阪急|阪神|山陽電鉄|神戸電鉄|地下鉄|市営地下鉄|神戸高速鉄道)([^\s「」、,]+?)駅")


def parse_station(cell):
    t = nk(text_of(cell))
    m = ST_PAT.search(t)
    if not m:
        return None, t
    return (m.group(1) or m.group(2)).strip(), t


def parse_buildings(cell):
    m = re.match(r"\s*([\d,]+)\s*棟", nk(text_of(cell)))
    return int(m.group(1).replace(",", "")) if m else None


ADDR_TOKEN = re.compile(r"^(?:兵庫県)?(神戸市(?:東灘|灘|中央|兵庫|長田|北|須磨|垂水|西)区\S+)$")


def map_address(cell):
    """所在地欄の地図リンクの URL から、/maps/place/ の直後の住所の文字列だけを取る。
    それより後ろ（座標・data= 等）は読まない・使わない。"""
    hrefs = re.findall(r'href="([^"]*)"', cell)
    if not hrefs:
        return None, "リンクなし"
    for h in hrefs:
        u = urllib.parse.urlsplit(html.unescape(h))
        m = re.match(r"/maps/place/([^/@]*)", u.path)
        if not m:
            continue
        seg = urllib.parse.unquote_plus(m.group(1))
        for tok in re.split(r"[\s　]+", seg):
            mm = ADDR_TOKEN.match(nk(tok))
            if mm:
                return mm.group(1), "住所あり"
        return None, "名前だけ"
    return None, "地図リンクでない"


def body_address(cell, ku):
    t = nk(text_of(cell)).replace("(外部リンク)", "").strip()
    t = re.sub(r"\s+", "", t)
    if t.startswith(ku):
        t = "神戸市" + t
    return t


def resolve_address(body, mapaddr):
    """(addr, addrLevel, 注記)"""
    core = re.sub(r"他$", "", body)
    if not mapaddr:
        return core, "丁目", None

    def kk(s):  # ヶ/ケ の差だけは同じとみなす
        return s.replace("ヶ", "ケ").replace("ヵ", "ケ")
    if kk(mapaddr) == kk(core):
        return core, "丁目", None
    if kk(mapaddr).startswith(kk(core)):
        rest = mapaddr[len(core):]
        if re.fullmatch(r"\d+(?:-\d+)*", rest):
            return core + rest, "番地", None
        if not core.endswith("丁目") and re.fullmatch(r"[^\d\-]{1,8}\d+(?:-\d+)*", rest):
            return core + rest, "番地", "本文に丁目なし・地図リンク側に字名つき"
    return core, "丁目", f"地図リンクの住所が本文と合わない（{mapaddr}）"


KANSUJI = {"1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "7": "七", "8": "八", "9": "九", "10": "十"}


def key1(s):
    t = nk(s)
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"^(?:神戸)?市営", "", t)
    t = re.sub(r"住宅$", "", t)
    t = re.sub(r"第(10|[1-9])(?!\d)", lambda m: "第" + KANSUJI[m.group(1)], t)
    return t


def key2(s):
    """表記の小差（ヶ/ケ/が・ノ/の・中黒）を寄せる。"""
    t = key1(s)
    t = t.replace("・", "").replace("･", "")
    t = re.sub(r"(?<=[一-鿿])[ヶケヵ](?=[一-鿿])", "が", t)
    t = re.sub(r"(?<=[一-鿿])ノ(?=[一-鿿])", "の", t)
    return t


# 自動で寄せられないものを、元のページで確かめて寄せる場合だけここに書く（倍率側の名前 → 一覧の住宅名, 理由）
MANUAL = {}


# ---------------------------------------------------------------- parse
def ward_index_names(rawdir, d):
    p = os.path.join(rawdir, f"{d}__index.html")
    body = open(p, encoding="utf-8").read()
    out = []
    for a in re.findall(r'<a href="/a28775/[^"]*/ichiran/%s/[a-z0-9_]+\.html#[^"]*">(.*?)</a>' % d, body, flags=re.S):
        n = text_of(a)
        n = re.sub(r"[（(][ァ-ヶー・\s　0-9０-９]+[）)]\s*$", "", n).strip()
        out.append(n)
    return out


def page_date(body):
    m = re.search(r"最終更新日：(\d{4})年(\d{1,2})月(\d{1,2})日", body)
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def parse(rawdir, bairitsu_path, out_path, debug_path=None):
    rows, notes = [], []
    dates = {}
    idx_check = {}
    for d, ku in WARDS:
        files = sorted(f for f in os.listdir(rawdir) if f.startswith(d + "__") and f != d + "__index.html")
        got = []
        for fn in files:
            body = open(os.path.join(rawdir, fn), encoding="utf-8").read()
            dates[fn] = page_date(body)
            for t in re.findall(r'<table[^>]*class="datatable"[^>]*>.*?</table>', body, flags=re.S):
                rec, labs = table_cells(t)
                if "住宅名カナ" not in rec:
                    continue
                name = text_of(rec["住宅名"]).strip()
                body_a = body_address(rec.get("所在地", ""), ku)
                if not body_a.startswith("神戸市" + ku):
                    notes.append(f"{ku} {name}: 本文の所在地が区と合わない（{body_a}）")
                mapa, mkind = map_address(rec.get("所在地", ""))
                addr, level, anote = resolve_address(body_a, mapa)
                if anote:
                    notes.append(f"{ku} {name}: {anote}")
                y0, y1, regular = parse_years(rec.get("竣工年度", ""))
                ytxt = text_of(rec.get("竣工年度", ""))
                if not regular:
                    notes.append(f"{ku} {name}: 年度の欄が型どおりでない（{ytxt}）→ built={y0} builtNew={y1}")
                st, sttxt = parse_station(rec.get("交通手段", ""))
                evtxt = text_of(rec.get("エレベーター", ""))
                row = {
                    "name": name,
                    "ku": ku,
                    "addr": addr,
                    "addrLevel": level,
                    "built": y0,
                    "builtNew": y1 if (y1 is not None and y1 != y0) else None,
                    "floorsMax": None,
                    "buildings": parse_buildings(rec.get("戸数", "")),
                    "ev": parse_ev(rec.get("エレベーター", "")),
                    "station": st,
                }
                row["_src"] = {"page": fn, "addrBody": body_a, "mapKind": mkind, "mapAddr": mapa,
                               "years": ytxt, "ev": evtxt, "access": sttxt,
                               "units": text_of(rec.get("戸数", "")), "yearLabel": labs.get("竣工年度")}
                rows.append(row)
                got.append(name)
        idx = ward_index_names(rawdir, d)
        idx_check[ku] = {"detail": len(got), "index": len(idx),
                         "onlyIndex": [n for n in idx if n not in got],
                         "onlyDetail": [n for n in got if n not in idx]}

    # ---- nameMap
    bd = json.load(open(bairitsu_path, encoding="utf-8"))
    bnames = []
    for r in bd["rows"]:
        if r["name"] not in bnames:
            bnames.append(r["name"])
    by1, by2 = {}, {}
    for r in rows:
        by1.setdefault(key1(r["name"]), []).append(r)
        by2.setdefault(key2(r["name"]), []).append(r)
    official = {r["name"] for r in rows}
    name_map, unmatched, how = {}, {}, {}
    for b in bnames:
        if b in MANUAL:
            target, why = MANUAL[b]
            assert target in official, target
            name_map[b] = target
            how[b] = "手で確かめて寄せた：" + why
            continue
        c = by1.get(key1(b))
        tier = "同じ表記" if c and len(c) == 1 and nk(c[0]["name"]) == nk(b) else "末尾・全半角・第n の差"
        if not c:
            c = by2.get(key2(b))
            tier = "ヶ/が・ノ/の・中黒の差"
        if c and len(c) == 1:
            name_map[b] = c[0]["name"]
            how[b] = tier
        elif c:
            name_map[b] = None
            unmatched[b] = "同じ名前の住宅が複数の区にある（" + "・".join(x["ku"] + x["name"] for x in c) + "）"
        else:
            name_map[b] = None
            unmatched[b] = "市営住宅一覧に同じ名前の住宅が見当たらない"

    # ---- 出力
    page_dates = sorted(v for v in dates.values() if v)
    idx_date = page_date(open(os.path.join(rawdir, "index.html"), encoding="utf-8").read())
    today = time.strftime("%Y-%m-%d")
    out = {
        "city": "神戸市",
        "updated": today,
        "sources": [{
            "name": "神戸市「市営住宅一覧」",
            "url": INDEX,
            "asof": f"{idx_date}更新（目次）・各区の五十音別ページは{page_dates[0]}〜{page_dates[-1]}更新・{today}取得",
            "used": "住宅名・区・所在地（本文の丁目まで＋地図リンクのURLに入っている住所の文字列で番地まで。座標は不使用）・竣工年度（兵庫区は建設年度）・戸数欄の棟数・エレベーター・交通手段の駅名",
        }],
        "builtLabel": "竣工年度",
        "rows": [{k: v for k, v in r.items() if k != "_src"} for r in rows],
        "nameMap": name_map,
        "unmatched": unmatched,
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if debug_path:
        with open(debug_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)

    # ---- 確認用の要約（標準エラーへ）
    def cnt(fn):
        return sum(1 for r in rows if fn(r))
    E = sys.stderr
    print("rows:", len(rows), file=E)
    print("built:", cnt(lambda r: r["built"] is not None), " builtNew:", cnt(lambda r: r["builtNew"] is not None), file=E)
    print("ev:", {str(v): cnt(lambda r, v=v: r["ev"] == v) for v in ("あり", "一部", "なし", None)}, file=E)
    print("addrLevel:", {v: cnt(lambda r, v=v: r["addrLevel"] == v) for v in ("番地", "丁目")}, file=E)
    print("mapKind:", {v: cnt(lambda r, v=v: r["_src"]["mapKind"] == v) for v in ("住所あり", "名前だけ", "リンクなし", "地図リンクでない")}, file=E)
    print("station:", cnt(lambda r: r["station"]), " buildings:", cnt(lambda r: r["buildings"] is not None), file=E)
    print("bus:", cnt(lambda r: "バス" in r["_src"]["access"]), file=E)
    bad = [r for r in rows if r["built"] is not None and not (1950 <= r["built"] <= 2026 and (r["builtNew"] or r["built"]) <= 2026)]
    print("built out of range:", [(r["ku"], r["name"], r["built"], r["builtNew"]) for r in bad], file=E)
    print("index check:", json.dumps(idx_check, ensure_ascii=False), file=E)
    print("nameMap:", len(name_map), "matched:", sum(1 for v in name_map.values() if v), file=E)
    print("how:", {t: sum(1 for v in how.values() if v == t) for t in set(how.values())}, file=E)
    for b, t in how.items():
        if t != "同じ表記":
            print("  寄せ:", b, "→", name_map[b], f"（{t}）", file=E)
    for b, why in unmatched.items():
        print("  unmatched:", b, "—", why, file=E)
    for n in notes:
        print("  note:", n, file=E)


# ---------------------------------------------------------------- main
if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "fetch":
        fetch(sys.argv[2])
    elif cmd == "parse":
        parse(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        print(__doc__)
        sys.exit(1)
