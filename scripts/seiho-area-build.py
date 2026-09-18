#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""計算機とランキングが使う「地域の台帳」を作る。

  python scripts/seiho-area-build.py          # assets/seiho-area.js と data/seiho-ranking.json
  python scripts/seiho-area-build.py --dry    # 書かずに数字だけ

読むもの
  data/kyuchi.json           … 全市町村の級地（[[kyuchi-master]]）
  data/jutaku-fujo.json      … 実施機関ごとの住宅扶助の限度額
  .cache/hogo-shinsei/muni-code.xlsx … 総務省 全国地方公共団体コード（市区町村の正典）
  .cache/bukka/000040286464.xlsx     … 総務省 消費者物価地域差指数（2024年）
  ../solar-bench/data/kakei-denki.json … 発電ベンチが持っている県庁所在市別の電気代

★住宅扶助の当て方（ここを間違えると全国の金額が狂う）
  ・その市が **指定都市・中核市** なら、その市自身の額。
  ・そうでなければ **都道府県の額**を、その市町村の級地（1/2/3の3段階）で引く。
  ・どちらも無ければ **null**。ここで推定しない。計算機は「未確認」と出す。

★級地は6段階（1級地-1〜3級地-2）だが、**住宅扶助は3段階**（1級地/2級地/3級地）。
  生活扶助は6段階を使い、住宅扶助は3段階に畳んで引く。混ぜない。

★物価の指数は市の行に「住居」「光熱・水道」が入っていない（都道府県の行だけ）。
  ∴ 生活扶助のものさしは市の「家賃を除く総合」、住居と光熱は県の値を使う。
"""
import json
import os
import re
import sys
from collections import defaultdict

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KY = os.path.join(ROOT, "data", "kyuchi.json")
JF = os.path.join(ROOT, "data", "jutaku-fujo.json")
MUNI = os.path.join(ROOT, ".cache", "hogo-shinsei", "muni-code.xlsx")
BUKKA = os.path.join(ROOT, ".cache", "bukka", "000040286464.xlsx")
DENKI = os.path.join(ROOT, "..", "solar-bench", "data", "kakei-denki.json")
OUT_JS = os.path.join(ROOT, "assets", "seiho-area.js")
OUT_RANK = os.path.join(ROOT, "data", "seiho-ranking.json")
DRY = "--dry" in sys.argv

KYUCHI6 = ["1級地-1", "1級地-2", "2級地-1", "2級地-2", "3級地-1", "3級地-2"]

# ─ 令和8年4月 生活扶助基準額（articles/seikatsuhogo-keisanki.html と同じ表。改定時は両方直す）
K1 = [  # 第1類（年齢帯 × 級地6段階）
    (2, [44580, 43240, 41460, 39680, 39230, 37000]),
    (5, [44580, 43240, 41460, 39680, 39230, 37000]),
    (11, [46460, 45060, 43200, 41350, 40880, 38560]),
    (17, [49270, 47790, 45820, 43850, 43360, 40900]),
    (19, [46930, 45520, 43640, 41760, 41290, 38950]),
    (40, [46930, 45520, 43640, 41760, 41290, 38950]),
    (59, [46930, 45520, 43640, 41760, 41290, 38950]),
    (64, [46930, 45520, 43640, 41760, 41290, 38950]),
    (69, [46460, 45060, 43200, 41350, 40880, 38560]),
    (74, [46460, 45060, 43200, 41350, 40880, 38560]),
    (999, [39890, 38690, 37100, 35500, 35100, 33110]),
]
K2 = [27790, 38060, 44730, 48900, 49180]  # 第2類（1〜5人）
TOKUREI = 1500  # 特例加算（1人あたり）
# 経過的加算（単身世帯・年齢帯index × 級地6段階）。★これを落とすと計算機と答えが合わない
# （35歳単身の1級地-1で200円ぶん少なくなる）。計算機の KEIKA[1] と同じ表。
KEIKA1 = [
    [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [830, 0, 0, 410, 0, 0], [200, 0, 0, 410, 0, 0], [1020, 0, 0, 410, 0, 0],
    [660, 0, 0, 410, 0, 0], [1130, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [2720, 840, 0, 680, 0, 0],
]


def seikatsu_tanshin(ki, age=30):
    """単身（既定は30歳）の生活扶助。第1類＋第2類＋経過的加算＋特例加算。"""
    ai = next(i for i, (mx, _) in enumerate(K1) if age <= mx)
    return K1[ai][1][ki] + K2[0] + KEIKA1[ai][ki] + TOKUREI


def kyuchi_of(ky, pref, city):
    """その市区町村の級地。

    ★東京23区は級地表に **「区の存する地域」という1行** で載っている（区名では載っていない）。
      そのまま引くと23区ぜんぶが「一覧に無い＝3級地-2」に落ちる。
      実際に東京都区部の生活扶助が 68,240円（3級地-2）と出て、1級地-1の 76,220円 と
      8,000円ずれた。人口がいちばん多いところなので、ここを外すと全体が壊れる。
    """
    if pref == "東京都" and city.endswith("区"):
        return ky.get("東京都|区の存する地域", "1級地-1")
    return ky.get(f"{pref}|{city}", "3級地-2")


def load_munis():
    wb = openpyxl.load_workbook(MUNI, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    out = []
    for r in ws.iter_rows(min_row=2, max_col=3, values_only=True):
        if r[1] and r[2]:
            out.append((str(r[0]).strip(), str(r[1]).strip(), str(r[2]).strip()))
    return out


def load_bukka():
    wb = openpyxl.load_workbook(BUKKA, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [v for v in rows[9][12:] if v is not None]
    out = {}
    for r in rows[10:]:
        if not r[10]:
            continue
        out[str(r[10]).strip()] = {
            h: (float(v) if isinstance(v, (int, float)) else None)
            for h, v in zip(hdr, r[12:12 + len(hdr)])
        }
    return out


def main():
    ky = json.load(open(KY, encoding="utf-8"))["rows"]
    jf = json.load(open(JF, encoding="utf-8"))["orgs"]
    munis = load_munis()
    bukka = load_bukka()
    denki = json.load(open(DENKI, encoding="utf-8")) if os.path.exists(DENKI) else {"pref": {}}

    # 実施機関 → 級地3段階 → 額。市の行には級地が書いていないので、その市自身の級地を当てる。
    rent = {}
    for org, v in jf.items():
        d = {}
        for row in v["rows"]:
            k = (row["kyuchi"] or "").split("-")[0]
            if not k and v["level"] != "都道府県":
                k = ky.get(f"{v['pref']}|{org}", "3級地-2").split("-")[0]
            if k:
                d[k] = {"yen": row["yen"], "src": row.get("via") or v.get("source")}
        rent[org] = {"level": v["level"], "pref": v["pref"], "k": d}

    # 住宅扶助の額は重複が多い（大阪市・京都市・神戸市が同じ額）ので番号で持つ。
    # ★出典は額といっしょにまとめてはいけない。まとめると、大阪市の欄に
    #   「京都市の公表値」と出る（実際にそう出た）。**出典は自治体ごとに別で持つ。**
    table, index = [], {}
    srcs, sindex = [], {}
    def rent_key(yen):
        sig = json.dumps(yen)
        if sig not in index:
            index[sig] = len(table)
            table.append(yen)
        return index[sig]
    def src_key(org, url):
        sig = f"{org}|{url}"
        if sig not in sindex:
            sindex[sig] = len(srcs)
            srcs.append({"o": org, "u": url})
        return sindex[sig]

    by_pref = defaultdict(list)
    cover = 0
    for code, pref, city in munis:
        k6 = kyuchi_of(ky, pref, city)
        k3 = k6.split("-")[0]
        src_org = city if city in rent else pref
        hit = rent.get(src_org, {}).get("k", {}).get(k3)
        rk = rent_key(hit["yen"]) if hit else -1
        sk = src_key(src_org, hit["src"]) if hit else -1
        if hit:
            cover += 1
        by_pref[pref].append([city, KYUCHI6.index(k6), rk, sk])

    js = {
        "k": KYUCHI6,
        "p": {p: v for p, v in by_pref.items()},
        "r": table,
        "s": srcs,
        "cover": cover,
        "total": len(munis),
    }
    print(f"市区町村 {len(munis)} / 家賃上限まで出せる {cover} ({cover / len(munis) * 100:.1f}%)")
    print(f"住宅扶助の種類 {len(table)}")

    # ── ランキング用（物価と電気代がある県庁所在市・政令市だけ）
    pref_of = {}
    for _, pref, city in munis:
        pref_of.setdefault(city, pref)
    rank = []
    for city, b in bukka.items():
        if city == "全国" or city.endswith(("地方", "都", "道", "府", "県")):
            continue
        name = "東京都区部" if city == "東京都区部" else city
        pref = "東京都" if city == "東京都区部" else pref_of.get(city)
        if not pref:
            continue
        k6 = kyuchi_of(ky, pref, "千代田区" if city == "東京都区部" else city)
        ki = KYUCHI6.index(k6)
        org = city if city in rent else pref
        if city == "東京都区部":
            org = "東京都"
        hit = rent.get(org, {}).get("k", {}).get(k6.split("-")[0])
        seikatsu = seikatsu_tanshin(ki)
        pb = bukka.get(pref, {})
        d = denki.get("pref", {}).get(pref, {})
        rank.append({
            "city": name, "pref": pref, "kyuchi": k6,
            "seikatsu": seikatsu,
            "jutaku": hit["yen"][0] if hit else None,
            "jutakuSrc": (hit or {}).get("src"),
            "bukka": b.get("家賃を除く総合"),
            "bukkaAll": b.get("総合"),
            "jukyo": pb.get("住居"),
            "kounetsu": pb.get("光熱・水道"),
            "denkiMonth": d.get("monthYen"),
            "denkiCity": d.get("city"),
        })
    ok = [r for r in rank if r["bukka"]]
    print(f"ランキングに載る市 {len(ok)} / うち家賃上限まである {sum(1 for r in ok if r['jutaku'])}")
    if DRY:
        return
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 生活保護の計算機が使う地域の台帳。自動生成: python scripts/seiho-area-build.py\n"
                "   k=級地の名前 / p=都道府県ごとの[市区町村, 級地index, 住宅扶助index(-1は未確認)]\n"
                "   r=住宅扶助[1人,2人,3〜5人,6人,7人以上] / s=その出典 */\n")
        f.write("window.SEIHO_AREA=" + json.dumps(js, ensure_ascii=False, separators=(",", ":")) + ";\n")
    json.dump({
        "note": "生活保護費と地域の物価・電気代を並べたもの。単身（30歳）の生活扶助は令和8年4月基準。"
                "物価は総務省 小売物価統計調査（構造編）2024年の消費者物価地域差指数（全国平均=100）。"
                "電気代は発電ベンチ（hatsudenbench.com）が持つ家計調査の県庁所在市別・二人以上世帯の月額。",
        "rows": sorted(ok, key=lambda r: r["city"]),
    }, open(OUT_RANK, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("書いた:", OUT_JS, "/", OUT_RANK)


if __name__ == "__main__":
    main()
