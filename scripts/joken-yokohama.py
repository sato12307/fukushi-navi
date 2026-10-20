# -*- coding: utf-8 -*-
u"""横浜市営住宅の団地ごとの条件（住所・建設年度・エレベーター・階数）を公式資料から読み、
data/joken-yokohama.json に書き出す。駅までの距離とページへの組み込みは別の台本の仕事。

使う資料（取得は手で行い、この台本はローカルのファイルだけを読む）
  ①市営住宅一覧（HTML・2026年5月1日更新）
      https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/sieiitiran.html
      → 団地の並び・団地名・区・所在地・着工年度・管理戸数。rows はこの一覧の団地だけ。
  ②区別の住宅・管理設備等詳細データ（Excel 18本・団地数等は令和5年4月1日現在）
      https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/jutakukanri/shiteikanri/r05sentei.html
      501_turumi.xlsx … 518_seya.xlsx
      「団地データ」→ 区分（公営／借上／改良）・棟数・住戸数
      「棟データ」  → 棟ごとの竣功年度・階層（低い階～高い階）・エレベーター台数
  ③昇降機設置状況一覧（PDF・令和5年3月31日時点・②と同じページ）
      409_syoukoukisecchijyoukyou.pdf → エレベーターのある市有の棟（区・住宅名・街区・号棟・階数・台数）

実行（資料のフォルダの外から・-I を付けて）
  python -I scripts/joken-yokohama.py --raw "<raw>/yokohama" \
     --bairitsu data/yokohama-bairitsu.json --out data/joken-yokohama.json
  --check を付けると書き出さずに数字だけ出す。--diag で団地ごとの突き合わせ表も出す。

★読み方の決まり（2026-10-20 に資料を見て決めた）
  ・棟データの「階層」は3列（低い階・「～」・高い階）。いちばん高い階は3列目（無ければ1列目）。B1 は地下なので数えない。
  ・棟データは1棟が複数行になる（間取りごとの続き行・同じ棟の2行目）。階層の入った行を新しい1棟とし、
    階層の無い行は直前の棟の続き（住戸数・台数を足す。例 大豆戸町住宅の棟1は 9・10・23戸の3行）。
    住宅名が空の行は直前の住宅の続き（住宅CDが変わっても同じ住宅。例 コンフォール明神台 134～137）。
    こう数えた棟の行の住戸数の和は、団地データの住戸数と全住宅で一致する（例外は住戸数の欄が空の栗田谷ヒルズと、
    団地データ側が空の南日吉住宅だけ。2026-10-20 確認）。
  ・棟数（buildings）は棟データの棟の行数。団地データの「棟数」と違う団地がある（生麦2→1・岩崎町5→4・滝頭2→1・
    本郷台2→1・谷津坂9→7・瀬ケ崎2→1、藤棚(改良)1→2・川辺町第二1→2 など）が、住戸は全部いずれかの棟の行に入っているので
    住戸のある棟は行のほうと読む。棟の行の住戸数が団地データに届かないときだけ団地データの棟数と多いほうを採る。
  ・エレベーター：棟データで台数が1以上の棟の数と、③の一覧に出る棟の数の多いほうを「エレベーターのある棟の数」とする
    （③は昇降機の一覧なので、棟データの台数が空でも③に出れば「ある」。例 南日吉住宅B・磯子住宅2）。
    市有の棟（公営・改良）は③が全数の一覧なので、どちらにも出ない棟は「無い」と読む。全棟＝あり／一部の棟＝一部／0＝なし。
    借上の棟は②③とも台数をほぼ記録していない（借上で台数が入るのはコンフォール南日吉の1棟だけ）ので、
    全棟に台数があるときだけ「あり」、それ以外は null（無いとは読まない）。
  ・一覧の同じ区・同じ団地名の行（直接建設＋改良、直接建設＋更新住宅。所在地も同じ）は1つの団地にまとめる（rows 279→273）。
    ②でも公営と改良が別の住宅として載るが、同じ建物を財源ごとに分けて載せているので（鶴見中央・藤棚ハイツ・ベイサイド新山下）、
    棟数とエレベーターのある棟の数は区分ごとに数えて多いほうを使う（足すと同じ建物を二重に数える）。
  ・②③は令和5年春の資料。一覧の着工年度が②の最も新しい竣功より2年以上あとの団地は建て替え後とみなし、
    ②③を使わず一覧の着工年度だけで埋める（builtSrc="着工"、階数・棟数・EV は null）。尾張屋橋・中村町・瀬戸橋が該当。
    （借上は一覧の「着工年度」が竣功や借上開始の年になっていることがあるので、着工ではなく竣功と比べる。例 権太坂スクエア）
  ・竣功年度が②に無い団地は一覧の着工年度で埋める（builtSrc="着工"）。推測で埋めない。
"""
import argparse
import glob
import html as htmlmod
import json
import os
import re
import sys
import unicodedata

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import openpyxl
import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LIST_URL = "https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/sieiitiran.html"
DETAIL_PAGE = "https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/jutakukanri/shiteikanri/r05sentei.html"
EV_PDF_URL = "https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/jutaku/joho/jutakukanri/shiteikanri/r05sentei.files/409_syoukoukisecchijyoukyou.pdf"

ERA = {u"昭": 1925, u"平": 1988, u"令": 2018}
WARDS = [u"鶴見区", u"神奈川区", u"西区", u"中区", u"南区", u"港南区", u"保土ケ谷区", u"旭区", u"磯子区",
         u"金沢区", u"港北区", u"緑区", u"青葉区", u"都筑区", u"戸塚区", u"栄区", u"泉区", u"瀬谷区"]

# 倍率側の名前で、正規化しても一覧と一致しないが、資料の上で同じ団地と言えるもの。
# (区, 倍率側の name) → (一覧の団地名, 根拠)
ALIASES = {
    (u"港北区", u"コンフォール南日吉"): (
        u"コンフォール南日吉Ｄ棟",
        u"一覧の港北区の借上はD棟だけ。②団地データの「コンフォール南日吉」（日吉本町四丁目10番・114戸）は一覧の「コンフォール南日吉Ｄ棟」（同じ所在地・114戸）と同じ。倍率側は2022年度まで「D棟」、2023-04から「D棟」なしで、同じ回に両方は出ない"),
    (u"泉区", u"セントラルヒルズ弐番館"): (
        u"セントラルヒルズ",
        u"②団地データの「セントラルヒルズ（弐番館）」6戸＋「（参番館）」10戸がどちらも新橋町1134番地の1で、一覧の「セントラルヒルズ」（新橋町1134番地の1・16戸）と所在地・戸数が合う"),
    (u"泉区", u"セントラルヒルズ参番館"): (
        u"セントラルヒルズ",
        u"②団地データの「セントラルヒルズ（弐番館）」6戸＋「（参番館）」10戸がどちらも新橋町1134番地の1で、一覧の「セントラルヒルズ」（新橋町1134番地の1・16戸）と所在地・戸数が合う"),
    (u"南区", u"ラ・メゾン・ベジブル"): (
        u"ラ・メゾン・ペジブル",
        u"ベ／ペの1字違い。2022-04回の1行だけで、同じ回の別の募集区分は「ペジブル」。南区に似た名前の団地はほかに無い"),
    (u"金沢区", u"瀬戸橋(改良)"): (
        u"瀬戸橋住宅",
        u"一覧では瀬戸橋住宅が公営（直接建設）48戸と改良住宅（更新住宅）130戸に分かれて載り、同じ所在地。この JSON では1団地にまとめている"),
}

# 候補はあるが寄せないもの（別の団地に寄せる誤りは当たらないより悪いので、表記の小差を超えるものは null）
NO_MAP = {
    (u"金沢区", u"釜利谷東"): u"寄せない（自信が足りない）。2022-04回の子育て優遇の1行だけ。金沢区で「釜利谷東」で始まる団地は一覧・詳細データとも釜利谷東ハイツだけで、同じ回の別の区分には「釜利谷東ハイツ」と出るが、「ハイツ」が無いのは表記の小差を超える。寄せるなら「釜利谷東ハイツ」",
}

# 住宅を決めない枠
FRAME_RE = re.compile(u"^市内全域|住宅を指定しない")


def nfkc(s):
    return unicodedata.normalize("NFKC", u"" if s is None else u"%s" % s)


def clean_html(s):
    return re.sub(r"\s+", " ", htmlmod.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def norm_ku(s):
    return nfkc(s).replace(u"ヶ", u"ケ").strip()


def norm_name(s):
    u"""団地名の突き合わせ用。末尾の「住宅」・頭の「市営」・空白・中黒・全角半角・ヶ/ケ/が・長音の字形・小書きのァィゥェォを寄せる。"""
    s = nfkc(s)
    s = re.sub(r"\s+", "", s)
    if s.startswith(u"市営"):
        s = s[2:]
    s = re.sub(u"住宅$", "", s)
    s = re.sub(u"[ヶケが]", u"ケ", s)
    s = re.sub(u"[ー―‐\\-−–—─ｰ]", u"ー", s)
    s = s.replace(u"・", "").replace(u"･", "")
    s = s.translate(str.maketrans(u"ァィゥェォ", u"アイウエオ"))
    return s


def norm_addr(s):
    s = nfkc(s)
    s = re.sub(r"\s+", "", s)
    s = re.sub(u"^横浜市", "", s)
    s = re.sub(u"^(%s)" % "|".join(WARDS), "", s.replace(u"ヶ", u"ケ"))
    return s


def era_years(s):
    u"""「昭47～50・56」「平9・11・12・14」「昭63・平元」「令５」→ 西暦のリスト。読めなければ None。"""
    s = nfkc(s).replace(u"元", u"1")
    out = []
    era = None
    for tok in re.split(u"[・～~、,]", s):
        tok = tok.strip()
        if not tok:
            return None
        m = re.match(u"^(昭|平|令)?(\\d+)$", tok)
        if not m:
            return None
        if m.group(1):
            era = m.group(1)
        if era is None:
            return None
        out.append(ERA[era] + int(m.group(2)))
    return out or None


def to_int(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = nfkc(v).strip()
    return int(s) if re.match(r"^\d+$", s) else None


def to_year(v):
    y = to_int(v)
    if y is None or not (1900 <= y <= 2100):
        return None
    return y


# ---------------------------------------------------------------- ①一覧 HTML

def parse_list(path):
    h = open(path, encoding="utf-8").read()
    asof = re.search(u"更新日\\s*(\\d+年\\d+月\\d+日)", h)
    rows = []
    kind = None
    for m in re.finditer(r"<h2[^>]*>(.*?)</h2>|<table[^>]*>(.*?)</table>", h, re.S):
        if m.group(1) is not None:
            kind = re.sub(u"[\\s　]*[\\d,]+戸$", "", clean_html(m.group(1))).strip()
            continue
        t = m.group(2)
        cap = re.search(r"<caption>(.*?)</caption>", t, re.S)
        if not cap:
            continue
        mk = re.match(u"^(\\S+?区)（", clean_html(cap.group(1)))
        if not mk:
            continue
        ku = mk.group(1)
        trs = re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)
        hdr = [clean_html(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", trs[0], re.S)]
        if hdr != [u"団地名", u"所在地", u"構造", u"着工年度", u"管理戸数"]:
            raise SystemExit(u"一覧の列見出しが想定と違う: %s %s" % (ku, hdr))
        for tr in trs[1:]:
            c = [clean_html(x) for x in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
            if len(c) != 5:
                raise SystemExit(u"一覧の行の列数が5でない: %s %s" % (ku, c))
            rows.append({
                "kind": kind, "ku": ku, "name": c[0], "addr": c[1], "kozo": c[2],
                "chako": c[3], "years": era_years(c[3]), "units": to_int(c[4].replace(",", "")),
            })
    return rows, (asof.group(1) if asof else None)


# ---------------------------------------------------------------- ②Excel

def find_col(row, label, start=0):
    for i in range(start, len(row)):
        if row[i] is not None and nfkc(row[i]).strip() == nfkc(label):
            return i
    return None


def parse_excel(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    # 団地データ
    ws = wb[u"団地データ"]
    rows = list(ws.iter_rows(values_only=True))
    h = rows[3]
    ci = {k: find_col(h, k) for k in [u"区名", u"住宅名", u"所在地", u"区分", u"棟数", u"住戸数"]}
    if None in ci.values():
        raise SystemExit(u"団地データの列が見つからない: %s %s" % (path, ci))
    danchi = []
    for r in rows[5:]:
        if r[ci[u"住宅名"]] is None:
            continue
        danchi.append({
            "ku": norm_ku(r[ci[u"区名"]]), "name": nfkc(r[ci[u"住宅名"]]).strip(),
            "addr": nfkc(r[ci[u"所在地"]]).strip() if r[ci[u"所在地"]] else None,
            "kubun": nfkc(r[ci[u"区分"]]).strip() if r[ci[u"区分"]] else None,
            "tousu": to_int(r[ci[u"棟数"]]), "units": to_int(r[ci[u"住戸数"]]),
        })
    # 棟データ
    ws = wb[u"棟データ"]
    rows = list(ws.iter_rows(values_only=True))
    h3, h4, h5 = rows[2], rows[3], rows[4]
    c = {k: find_col(h3, k) for k in [u"区名", u"住宅CD", u"住宅名", u"街区", u"棟", u"所在地", u"構造", u"階層", u"住戸数"]}
    c[u"着工"] = find_col(h4, u"着工")
    c[u"竣功"] = find_col(h4, u"竣功")
    ev = find_col(h4, u"ｴﾚﾍﾞｰﾀｰ")
    c[u"台数"] = find_col(h5, u"台数", ev) if ev is not None else None
    if None in c.values() or c[u"台数"] != ev:
        raise SystemExit(u"棟データの列が見つからない: %s %s" % (path, c))
    lv = c[u"階層"]
    houses = []   # [{"name","cds","addr","blds":[...]}]
    cur = None
    # 棟データの区名は先頭の行にしか入らないファイルがある（神奈川区は先頭も空）→ 団地データの区名を既定にする
    kus = [d["ku"] for d in danchi if d["ku"]]
    ku = max(set(kus), key=kus.count) if kus else None
    for r in rows[6:]:
        if all(x is None for x in r[:lv + 3]):
            continue
        if r[c[u"区名"]]:
            ku = norm_ku(r[c[u"区名"]])
        nm = r[c[u"住宅名"]]
        if nm is not None:
            cur = {"ku": ku, "name": nfkc(nm).strip(), "cds": set(), "addr": None, "blds": []}
            houses.append(cur)
        if cur is None:
            continue
        cd = to_int(r[c[u"住宅CD"]])
        if cd is not None:
            cur["cds"].add(cd)
        if r[c[u"所在地"]] and not cur["addr"]:
            cur["addr"] = nfkc(r[c[u"所在地"]]).strip()
        lo, hi = to_int(r[lv]), to_int(r[lv + 2])
        units = to_int(r[c[u"住戸数"]])
        ev_n = to_int(r[c[u"台数"]])
        # 「B1～3」の B1 は地下なので階数に数えない（to_int で None になる）が、階層の入った行ではある
        has_floor = lo is not None or hi is not None or (r[lv] is not None and nfkc(r[lv]).strip() != "")
        # 新しい棟＝階層の入った行。階層の無い行は直前の棟の続き（間取りごとの行・同じ棟の2行目。
        # 例 大豆戸町住宅は棟1が 9・10・23戸の3行で、階層は1行目だけ）。
        # ただし住宅の最初の行で階層が無く住戸数だけある行（借上の駒岡ヒルズ）は階数不明の1棟とする。
        if has_floor or (units is not None and not cur["blds"]):
            cur["blds"].append({
                "gaiku": nfkc(r[c[u"街区"]]).strip() if r[c[u"街区"]] is not None else None,
                "tou": nfkc(r[c[u"棟"]]).strip() if r[c[u"棟"]] is not None else None,
                "chako": to_year(r[c[u"着工"]]), "shunko": to_year(r[c[u"竣功"]]),
                "floors": max([x for x in (lo, hi) if x is not None], default=None),
                "units": units or 0, "ev": ev_n,
            })
        elif cur["blds"]:
            last = cur["blds"][-1]
            if units:
                last["units"] += units
            if ev_n:
                last["ev"] = (last["ev"] or 0) + ev_n
    return danchi, houses


# ---------------------------------------------------------------- ③昇降機 PDF

def parse_ev_pdf(path):
    out = []
    asof = None
    with pdfplumber.open(path) as pdf:
        for pg in pdf.pages:
            for line in (pg.extract_text() or "").splitlines():
                line = line.strip()
                if asof is None:
                    m = re.search(u"\\[(令和.+?時点)\\]", line)
                    if m:
                        asof = m.group(1)
                m = re.match(u"^(\\d+)(\\S+?区) (\\S+) (.+)$", line)
                if not m:
                    continue
                toks = m.group(4).split()
                k = None
                for i in range(len(toks) - 1, -1, -1):
                    if re.match(r"^\d+\D", toks[i]):
                        k = i
                        break
                if k is None or k < 2:
                    raise SystemExit(u"昇降機一覧の行が読めない: %s" % line)
                n_ev = int(re.match(r"^(\d+)", toks[k]).group(1))
                floors = to_int(toks[k - 1])
                goto = toks[k - 2]
                gaiku = toks[k - 3] if k >= 3 else None
                out.append({"no": int(m.group(1)), "ku": norm_ku(m.group(2)), "name": m.group(3),
                            "gaiku": gaiku, "goto": goto, "floors": floors, "ev": n_ev})
    nos = [x["no"] for x in out]
    if nos != list(range(1, len(nos) + 1)):
        raise SystemExit(u"昇降機一覧の No. が連番でない（読み落とし）")
    return out, asof


# ---------------------------------------------------------------- 組み立て

def build(args):
    raw = args.raw
    lst, list_asof = parse_list(os.path.join(raw, "sieiitiran.html"))
    files = sorted(glob.glob(os.path.join(raw, "5*.xlsx")))
    if len(files) != 18:
        raise SystemExit(u"Excel が18本ない: %d" % len(files))
    danchi, houses = [], []
    for f in files:
        d, hs = parse_excel(f)
        danchi += d
        houses += hs
    evs, ev_asof = parse_ev_pdf(os.path.join(raw, "409_syoukoukisecchijyoukyou.pdf"))

    # 団地データの区分・棟数を棟データの住宅に付ける（同じ区・同じ名前）
    dmap = {}
    for d in danchi:
        dmap.setdefault((d["ku"], norm_name(d["name"])), []).append(d)
    for hs in houses:
        ds = dmap.get((hs["ku"], norm_name(hs["name"])), [])
        # 同じ名前が公営と改良で2件あるときは住宅CDで分ける（改良は 9xx）
        if len(ds) > 1:
            want = u"改良" if any(cd >= 900 for cd in hs["cds"]) else None
            ds2 = [d for d in ds if (d["kubun"] == u"改良") == (want == u"改良")]
            ds = ds2 or ds
        hs["danchi"] = ds[0] if len(ds) == 1 else None
        hs["kubun"] = hs["danchi"]["kubun"] if hs["danchi"] else (u"改良" if any(cd >= 900 for cd in hs["cds"]) else None)

    # 一覧の同じ区・同じ団地名をまとめる
    merged = []
    idx = {}
    for r in lst:
        key = (norm_ku(r["ku"]), r["name"])
        if key in idx:
            g = idx[key]
            g["parts"].append(r)
        else:
            g = {"ku": r["ku"], "name": r["name"], "parts": [r]}
            idx[key] = g
            merged.append(g)
    names = [g["name"] for g in merged]
    dup = sorted(set(n for n in names if names.count(n) > 1))
    if dup:
        raise SystemExit(u"区をまたいで同じ団地名がある（nameMap の値が一意にならない）: %s" % dup)

    # 棟データの住宅 → 一覧の団地（名前 → だめなら所在地。どちらも同じ区の中だけ）
    by_name = {}
    for g in merged:
        by_name.setdefault((norm_ku(g["ku"]), norm_name(g["name"])), []).append(g)
    by_addr = {}
    for g in merged:
        for p in g["parts"]:
            by_addr.setdefault((norm_ku(g["ku"]), norm_addr(p["addr"])), set()).add(id(g))
    gid = {id(g): g for g in merged}
    for g in merged:
        g["houses"] = []
    unplaced = []
    for hs in houses:
        k = (hs["ku"], norm_name(hs["name"]))
        if k in by_name and len(by_name[k]) == 1:
            by_name[k][0]["houses"].append(hs)
            hs["via"] = "name"
            continue
        unplaced.append(hs)
    still = []
    for hs in unplaced:
        addrs = set()
        if hs["addr"]:
            addrs.add(norm_addr(hs["addr"]))
        if hs.get("danchi") and hs["danchi"]["addr"]:
            addrs.add(norm_addr(hs["danchi"]["addr"]))
        cands = set()
        for a in addrs:
            cands |= by_addr.get((hs["ku"], a), set())
        # 所在地で寄せるのは、その団地に名前で寄った住宅がまだ無く、候補がちょうど1件のときだけ
        cands = [gid[x] for x in cands if not any(h.get("via") == "name" for h in gid[x]["houses"])]
        if len(cands) == 1:
            cands[0]["houses"].append(hs)
            hs["via"] = "addr"
        else:
            still.append(hs)

    # 昇降機一覧 → 一覧の団地
    for g in merged:
        g["evs"] = []
    ev_unplaced = []
    for e in evs:
        k = (e["ku"], norm_name(e["name"]))
        if k in by_name and len(by_name[k]) == 1:
            by_name[k][0]["evs"].append(e)
        else:
            ev_unplaced.append(e)

    out_rows = []
    diag = []
    for g in merged:
        kinds = []
        for p in g["parts"]:
            if p["kind"] not in kinds:
                kinds.append(p["kind"])
        years = sorted(y for p in g["parts"] for y in (p["years"] or []))
        units_html = sum(p["units"] or 0 for p in g["parts"])
        addr = u"横浜市" + g["ku"] + g["parts"][0]["addr"]
        hs = g["houses"]
        kariage = all(u"借上" in k for k in kinds)
        blds_all = [b for h in hs for b in h["blds"]]
        ex_last = [b["shunko"] or b["chako"] for b in blds_all]
        ex_last = [y for y in ex_last if y]
        # 建て替え後の判定：一覧の着工年度が②の最も新しい竣功より2年以上あと（借上は一覧の年度が竣功の年になっていることがあるので竣功と比べる）
        stale = bool(years and ex_last and max(years) >= max(ex_last) + 2)
        note = []
        row = {"name": g["name"], "ku": g["ku"], "addr": addr,
               "built": None, "builtSrc": None, "builtNew": None,
               "floorsMax": None, "buildings": None, "ev": None, "kind": kinds}
        if stale:
            note.append(u"②は建て替え前")
            hs_use, evs_use = [], []
        else:
            hs_use, evs_use = hs, g["evs"]
        shunko = [b["shunko"] for h in hs_use for b in h["blds"] if b["shunko"]]
        if shunko:
            row["built"], row["builtNew"], row["builtSrc"] = min(shunko), max(shunko), u"竣功"
        elif years:
            row["built"], row["builtNew"], row["builtSrc"] = years[0], years[-1], u"着工"
        floors = [b["floors"] for h in hs_use for b in h["blds"] if b["floors"]]
        if not floors:
            floors = [e["floors"] for e in evs_use if e["floors"]]
        row["floorsMax"] = max(floors) if floors else None
        # 棟数とEVのある棟の数。②の住宅を区分（公営／借上／改良）ごとにまとめ（南日吉住宅は棟ごとに住宅名が3回出る）、
        # 区分の中では棟の行を足し、区分の間では多いほうを採る（同じ建物を財源ごとに分けて載せているため）。
        # 区分の中の棟数は棟データの棟の行数。ただし棟の行の住戸数の和が団地データの住戸数に届かないとき
        # （行が欠けている。例 駒岡住宅は3行79戸・団地データ4棟97戸）は団地データの棟数と多いほう。
        groups = {}
        for h in hs_use:
            gk = h.get("kubun") or u"?"
            gg = groups.setdefault(gk, {"blds": [], "danchi": {}})
            gg["blds"] += h["blds"]
            if h.get("danchi"):
                gg["danchi"][id(h["danchi"])] = h["danchi"]
        n_bld_each, n_ev_each, gnote = [], [], []
        for gk, gg in groups.items():
            nb = len(gg["blds"])
            u_rows = sum(b["units"] or 0 for b in gg["blds"])
            ds = list(gg["danchi"].values())
            td = sum(d["tousu"] or 0 for d in ds) if ds else None
            ud = sum(d["units"] or 0 for d in ds) if ds else None
            if ud and u_rows < ud:
                nb2 = max(nb, td or 0)
                gnote.append(u"%s:棟行%d戸%d<団地%d棟%d戸→%d棟" % (gk, nb, u_rows, td or 0, ud, nb2))
                nb = nb2
            elif td and td != nb:
                gnote.append(u"%s:棟行%d（戸数一致）≠団地%d棟→%d棟" % (gk, nb, td, nb))
            n_bld_each.append(nb)
            n_ev_each.append(sum(1 for b in gg["blds"] if b["ev"] and b["ev"] >= 1))
        n_bld = max(n_bld_each) if n_bld_each else 0
        n_ev_xl = max(n_ev_each) if n_ev_each else 0
        n_ev_pdf = len(evs_use)
        n_ev = max(n_ev_xl, n_ev_pdf)
        if n_ev > n_bld:
            gnote.append(u"EVのある棟%dが棟数%dより多い→棟数を%dに" % (n_ev, n_bld, n_ev))
            n_bld = n_ev
        note += gnote
        if units_html and hs_use:
            ux = sum(d["units"] or 0 for gg in groups.values() for d in gg["danchi"].values())
            if ux and ux != units_html:
                note.append(u"戸数 一覧%d≠②%d" % (units_html, ux))
        fx = max([b["floors"] for h in hs_use for b in h["blds"] if b["floors"]], default=None)
        fp = max([e["floors"] for e in evs_use if e["floors"]], default=None)
        if fx and fp and fp > fx:
            note.append(u"階数 ③%d>②%d" % (fp, fx))
        row["buildings"] = n_bld or None
        if hs_use or evs_use:
            if kariage:
                row["ev"] = u"あり" if (n_bld and n_ev >= n_bld) else None
            else:
                if n_bld == 0:
                    row["ev"] = None
                elif n_ev >= n_bld:
                    row["ev"] = u"あり"
                elif n_ev > 0:
                    row["ev"] = u"一部"
                else:
                    row["ev"] = u"なし"
        out_rows.append(row)
        diag.append({
            "ku": g["ku"], "name": g["name"], "kinds": u"+".join(k.replace(u"公営住宅", u"").replace(u"改良住宅", u"改良") for k in kinds),
            "html_years": years, "units_html": units_html,
            "houses": [(h["name"], sorted(h["cds"]), h.get("kubun"), h["danchi"]["tousu"] if h.get("danchi") else None,
                        h["danchi"]["units"] if h.get("danchi") else None, len(h["blds"]),
                        sum(1 for b in h["blds"] if b["ev"] and b["ev"] >= 1), h.get("via")) for h in hs],
            "units_xl": sum((h["danchi"]["units"] or 0) for h in hs if h.get("danchi")),
            "pdf": [(e["gaiku"], e["goto"], e["floors"], e["ev"]) for e in g["evs"]],
            "n_bld": n_bld, "n_ev_xl": n_ev_xl, "n_ev_pdf": n_ev_pdf, "note": note,
            "row": row,
        })

    # ---------------------------------------------------------------- nameMap
    bai = json.load(open(args.bairitsu, encoding="utf-8"))
    pairs = []
    seen = set()
    rounds = {}
    for r in bai["rows"]:
        k = (r.get("ku") or "", r.get("name") or "")
        rounds.setdefault(k, set()).add(r.get("round"))
        if k not in seen:
            seen.add(k)
            pairs.append(k)
    name_map, unmatched = {}, {}
    row_names = set(x["name"] for x in out_rows)
    gone = {}
    for h in houses:
        gone.setdefault((h["ku"], norm_name(h["name"])), h)
    for d in danchi:
        gone.setdefault((d["ku"], norm_name(d["name"])), d)
    for ku, nm in pairs:
        key = u"%s|%s" % (ku, nm)
        if FRAME_RE.search(nm):
            name_map[key] = None
            unmatched[key] = u"住宅を決めない枠（市内全域・区の枠）"
            continue
        if (ku, nm) in NO_MAP:
            name_map[key] = None
            unmatched[key] = NO_MAP[(ku, nm)]
            continue
        if (ku, nm) in ALIASES:
            tgt, why = ALIASES[(ku, nm)]
            if tgt not in row_names:
                raise SystemExit(u"ALIASES の寄せ先が rows に無い: %s" % tgt)
            name_map[key] = tgt
            continue
        k = (norm_ku(ku), norm_name(nm))
        c = by_name.get(k, [])
        if len(c) == 1:
            name_map[key] = c[0]["name"]
            continue
        name_map[key] = None
        other = [g for g in merged if norm_name(g["name"]) == k[1] and norm_ku(g["ku"]) != k[0]]
        if other:
            unmatched[key] = u"区が合わない（一覧では%sの「%s」）。区をまたいでは寄せない。倍率側でこの区で出るのは %s 回だけ" % (
                u"・".join(g["ku"] for g in other), other[0]["name"], u"・".join(sorted(rounds[(ku, nm)])))
        elif k in gone:
            x = gone[k]
            unmatched[key] = u"2026-05-01更新の一覧に無い（令和5年4月の詳細データには「%s」%sとして載る＝その後に借上の終了などで一覧から外れたとみられる）。倍率側で出るのは %s 回" % (
                x["name"], (u"（" + x.get("kubun") + u"）") if x.get("kubun") else u"", u"・".join(sorted(rounds[(ku, nm)])))
        else:
            unmatched[key] = u"一覧にも詳細データにも同じ名前の団地が無い"

    result = {
        "city": u"横浜市",
        "updated": args.updated,
        "sources": [
            {"name": u"横浜市 市営住宅一覧", "url": LIST_URL,
             "asof": (list_asof or "") + u"更新",
             "used": u"団地名・区・所在地（番地まで）・種類（直接建設／借上／改良）。建設年度は棟データに無い団地だけ着工年度で埋めた（builtSrc=着工）"},
            {"name": u"横浜市 区別の住宅・管理設備等詳細データ（市営住宅等指定管理者の公募資料・Excel 18本）", "url": DETAIL_PAGE,
             "asof": u"令和5年4月1日現在（2023年5月公表）",
             "used": u"棟データの竣功年度（built・builtNew）・階層（floorsMax）・エレベーター台数（ev）、団地データの棟数（buildings）"},
            {"name": u"横浜市 昇降機設置状況一覧（同じ公募資料・PDF）", "url": EV_PDF_URL,
             "asof": ev_asof or u"令和5年3月31日時点",
             "used": u"エレベーターのある市有の棟（ev。棟データの台数と多いほうを採る）。棟データに階層の無い団地の floorsMax"},
        ],
        "builtLabel": u"竣功年度",
        "rows": out_rows,
        "nameMap": name_map,
        "unmatched": unmatched,
    }
    return result, diag, still, ev_unplaced, lst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help=u"資料を落としたフォルダ（sieiitiran.html・5*.xlsx・409_*.pdf）")
    ap.add_argument("--bairitsu", default=os.path.join(ROOT, "data", "yokohama-bairitsu.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "joken-yokohama.json"))
    ap.add_argument("--updated", default="2026-10-20")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--diag", action="store_true")
    args = ap.parse_args()
    res, diag, still, ev_unplaced, lst = build(args)
    rows = res["rows"]

    if args.diag:
        for d in diag:
            print(u"%s|%s [%s] html=%s 戸%s xl戸%s | n_bld=%s evXL=%s evPDF=%s %s" % (
                d["ku"], d["name"], d["kinds"], d["html_years"], d["units_html"], d["units_xl"],
                d["n_bld"], d["n_ev_xl"], d["n_ev_pdf"], " ".join(d["note"])))
            for h in d["houses"]:
                print(u"    xl: %s" % (h,))
            if d["pdf"]:
                print(u"    pdf: %s" % (d["pdf"],))
            r = d["row"]
            print(u"    => built=%s(%s) new=%s floors=%s blds=%s ev=%s" % (r["built"], r["builtSrc"], r["builtNew"], r["floorsMax"], r["buildings"], r["ev"]))
        print(u"\n--- 一覧に寄らなかった②の住宅（令和5年4月にはあったが一覧に無い） ---")
        for h in still:
            print(u"  %s|%s cds=%s 区分=%s 棟行=%d" % (h["ku"], h["name"], sorted(h["cds"]), h.get("kubun"), len(h["blds"])))
        print(u"--- 一覧に寄らなかった③の行 ---")
        for e in ev_unplaced:
            print(u"  %s" % (e,))

    def cnt(f):
        return sum(1 for r in rows if f(r))
    print(u"一覧の行 %d → rows %d（同じ区・同じ名前をまとめた）" % (len(lst), len(rows)))
    print(u"built 埋まり %d / builtSrc 竣功 %d・着工 %d / ev 埋まり %d（あり %d・一部 %d・なし %d）/ addr %d / floorsMax %d / buildings %d" % (
        cnt(lambda r: r["built"] is not None), cnt(lambda r: r["builtSrc"] == u"竣功"), cnt(lambda r: r["builtSrc"] == u"着工"),
        cnt(lambda r: r["ev"] is not None), cnt(lambda r: r["ev"] == u"あり"), cnt(lambda r: r["ev"] == u"一部"), cnt(lambda r: r["ev"] == u"なし"),
        cnt(lambda r: bool(r["addr"])), cnt(lambda r: r["floorsMax"] is not None), cnt(lambda r: r["buildings"] is not None)))
    bad = [r for r in rows if (r["built"] is not None and not (1950 <= r["built"] <= 2026))
           or (r["builtNew"] is not None and not (1950 <= r["builtNew"] <= 2026))
           or (r["floorsMax"] is not None and not (1 <= r["floorsMax"] <= 40))]
    print(u"ありえない値: %d %s" % (len(bad), [r["name"] for r in bad]))
    nm = res["nameMap"]
    print(u"nameMap キー %d・団地に寄せた %d・null %d" % (len(nm), sum(1 for v in nm.values() if v), sum(1 for v in nm.values() if v is None)))
    if bad:
        raise SystemExit(1)
    if not args.check:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(u"書き出し: %s" % args.out)


if __name__ == "__main__":
    main()
