# -*- coding: utf-8 -*-
"""JKK東京の「申込地区別倍率表」PDF群を1つのJSONへ正規化する。

・列数は回次とカテゴリでバラつくので、**建築年(昭和/平成/令和+数字)を軸にして前後に割る**。
  これが一番安定する。行頭から建築年までが属性、そこから後ろが申込者数と倍率。
・★地区番号は回ごとに振り直されるので名寄せキーにしてはいけない。キーは 区市町×住宅名。
・★Python の \d は全角数字にも当たる。数値は必ず [0-9] で書く。
出力: data/toei-bairitsu.json（第2引数で出力先を変えられる）
"""
import io, json, os, re, sys, glob
from datetime import date
from collections import defaultdict

# Windows の既定のコンソール（cp932）は「↔」「—」「≤」などを encode できず、
# 進捗表示の1行で UnicodeEncodeError を出して途中で落ちる（2026-09-23 の川崎で実際に起きた）。
# 記号を選び直すのは漏れるので、出力の文字コードのほうを UTF-8 に固定する。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
PDFDIR = sys.argv[1] if len(sys.argv) > 1 else "."

CATS = ["世帯向（一般募集住宅）", "単身者向", "若年夫婦・子育て世帯向（定期使用住宅）",
        "シルバーピア", "単身者用車いす使用者向", "居室内で病死等があった住宅"]
CITY = r"[一-龥ヶ]{2,6}[区市町村]"
ERA = re.compile(r"(昭和|平成|令和)\s*([0-9]+)")
NUM = re.compile(r"[0-9][0-9,]*\.?[0-9]*")
HEAD = re.compile(r"^(" + CITY + r")\s*([^0-9]{0,8}?)\s*([0-9]{3,5})\s*([^0-9]+?)\s+([0-9]+)\s")
# ★2026-09-22 募集戸数のすぐ後ろの「間取り」「㎡」も拾う（どの回のPDFにも印字されている）。
#   表記は回で揺れる＝全角「２ＤＫ」・半角「1DK」・複数「２Ｋ・２ＤＫ」、広さは「31～35」の幅つき。
#   読めなかった行は空のまま残す（推測で埋めない）。
MADORI = re.compile(r"^\s*([0-9０-９]\s*[ＳＬＤＫSLDK]+(?:\s*[・･]\s*[0-9０-９]\s*[ＳＬＤＫSLDK]+)*)"
                    r"\s+([0-9]+(?:\.[0-9]+)?)(?:\s*[～~〜]\s*([0-9]+(?:\.[0-9]+)?))?(?:\s|$)")
ZEN = str.maketrans("０１２３４５６７８９ＳＬＤＫ･", "0123456789SLDK・")


def category_of(text):
    for c in CATS:
        if text.startswith(c) or c in text[:60]:
            return c
    return "不明"


def parse_pdf(path):
    r = PdfReader(path)
    pages = [(p.extract_text() or "") for p in r.pages]
    cat = category_of(re.sub(r"\s+", " ", pages[0])[:80])
    rows, cur_city = [], None
    for pg in pages:
        for raw in pg.split("\n"):
            line = raw.strip()
            if not line or "地区番号" in line:
                continue
            e = ERA.search(line)
            if not e:
                continue
            head, tail = line[:e.start()], line[e.end():]
            nums = [n.replace(",", "") for n in NUM.findall(tail)]
            nums = [float(n) for n in nums if n not in ("", ".")]
            if len(nums) < 2:
                continue
            bairitsu = nums[-1]
            moushikomi = nums[0] if len(nums) >= 2 else None
            m = HEAD.match(head)
            if m:
                cur_city = m.group(1)
                ninzu = re.sub(r"\s+", "", m.group(2))
                chiku = m.group(3)
                name = re.sub(r"\s+", "", m.group(4))
                koho = int(m.group(5))
                rest = head[m.end():]
            else:
                m2 = re.search(r"([0-9]{3,5})\s*([^0-9]+?)\s+([0-9]+)\s", head)
                if not m2 or not cur_city:
                    continue
                ninzu, chiku, name, koho = "", m2.group(1), re.sub(r"\s+", "", m2.group(2)), int(m2.group(3))
                rest = head[m2.end():]
            md = MADORI.match(rest)
            madori = re.sub(r"\s+", "", md.group(1)).translate(ZEN) if md else ""
            sqm_min = float(md.group(2)) if md else None
            sqm_max = float(md.group(3)) if md and md.group(3) else sqm_min
            if not (1 <= len(name) <= 24) or bairitsu > 3000:
                continue
            rows.append({"city": cur_city, "city_src": ("head" if m else "fill"),
                         "chiku": chiku, "ninzu": ninzu, "name": name,
                         "koho": koho, "era": e.group(1) + e.group(2),
                         "moushikomi": moushikomi, "bairitsu": bairitsu,
                         "madori": madori, "sqm_min": sqm_min, "sqm_max": sqm_max,
                         "ev": "有" if "有" in head[-14:] else ("無" if "無" in head[-14:] else "")})
    return cat, rows


def main():
    files = sorted(glob.glob(os.path.join(PDFDIR, "*.pdf")))
    out, bad = [], 0
    for f in files:
        rnd = os.path.basename(f).split("_")[0]
        try:
            cat, rows = parse_pdf(f)
        except Exception as ex:
            bad += 1
            print(f"  [ERR] {os.path.basename(f)} {ex}")
            continue
        for r in rows:
            r["round"] = rnd
            r["cat"] = cat
        out.extend(rows)
        print(f"  {rnd} {cat[:16]:<18} {len(rows):>5}行  ({os.path.basename(f)})")
    # ★区市町は現時点で信頼できない。
    #   行頭に区市町が出ない行は前行から引き継ぐしかなく、ページ跨ぎで26%が別の区へ化けた
    #   （港南四丁目が中央区になる等）。地区番号の上2桁を区市町コードとみなす修正も試したが、
    #   若年夫婦向PDFが 00101 のような別採番を使っており、かえって悪化した（誤り62.5%）。
    #   ∴ここでは推測せず、行頭で明示的に読めた分だけ city_trusted=True とし、
    #   残りは東京都の公式「都営住宅団地一覧」(区市町別PDF・62本)と突合してから確定する。
    for r in out:
        r["city_trusted"] = (r["city_src"] == "head")
    tr = sum(1 for r in out if r["city_trusted"])
    print("")
    print(f"区市町が行頭から確実に読めた行: {tr}/{len(out)} ({tr/max(1,len(out))*100:.1f}%)")
    print("→ 残りは公式の団地一覧と突合して確定する（未実施）。集計で区市町を使うのはそれから。")

    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(PROJ, "data", "toei-bairitsu.json")
    json.dump({"updated": date.today().isoformat(), "source": "JKK東京 都営住宅 定期募集 申込地区別倍率表",
               "note": "地区番号は回ごとに振り直されるため名寄せキーにしない。キーは 区市町×住宅名。",
               "rows": out}, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\n合計 {len(out)}行 / PDF {len(files)}本(失敗{bad}) → {dst}")
    rounds = sorted({r["round"] for r in out})
    print(f"回次 {len(rounds)}: {rounds[0]} 〜 {rounds[-1]}")
    danchi = {(r["city"], r["name"]) for r in out}
    print(f"ユニーク団地(区市町×住宅名) {len(danchi)}")


if __name__ == "__main__":
    main()
