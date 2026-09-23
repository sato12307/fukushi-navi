#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生活保護の級地区分（市町村別）を厚労省のPDFから読む。

  python scripts/kyuchi-parse.py          # data/kyuchi.json を作る
  python scripts/kyuchi-parse.py --dry    # 書かずに検算だけ

原典: 厚生労働省「お住まいの地域の級地を確認」https://www.mhlw.go.jp/content/kyuchi.3010.pdf
      （平成30年10月1日現在。級地区分はその後も据え置きで、これが現行）
取得: node scripts/jutaku-fujo-fetch.mjs と同じ礼儀で curl 済み（.cache/kyuchi/kyuchi.pdf）

★このPDFの作りが特殊で、素直に読むと1件も取れない
  ①**1文字が1語**として置かれている（「川 口 市」のように字間が空いている）。
    単語単位で読むと「川」「口」「市」がバラバラに出る。
  ②**5段組**。段をまたいだ文字がくっついて1語になることがある（「市神」＝
    2段目の最後の「市」と3段目の最初の「神」）。∴ 語ではなく **文字の座標** で振り分ける。
  ③読む向きは **段ごとに上から下**（段1を読み切ってから段2へ）。行方向ではない。
  ④都道府県名（〜都/道/府/県）が見出しで、そのあとに続くのがその県の市町村。
    見出しは**段をまたいで持ち越す**（3段目の途中で県が変わることがある）。
  ⑤【1級地－1】などの区分見出しはページの途中にも出る。1ページに2区分あることがある。
    区分は**ページをまたいで持ち越す**。

★3級地-2は載っていない（「1級地〜3級地-1以外の市町村」がすべて3級地-2）。
  ∴ このデータは「3級地-2以外の一覧」。市町村コードと突き合わせて残りを埋める。
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter

# Windows の既定のコンソール（cp932）は「↔」「—」「≤」などを encode できず、
# 進捗表示の1行で UnicodeEncodeError を出して途中で落ちる（2026-09-23 の川崎で実際に起きた）。
# 記号を選び直すのは漏れるので、出力の文字コードのほうを UTF-8 に固定する。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, ".cache", "kyuchi", "kyuchi.pdf")
MUNI = os.path.join(ROOT, ".cache", "hogo-shinsei", "muni-code.xlsx")
OUT = os.path.join(ROOT, "data", "kyuchi.json")
GUN_PATH = os.path.join(ROOT, ".cache", "kyuchi", "gun.json")
DRY = "--dry" in sys.argv

# 5段組の段の境目（x座標）。★県名は市町村名より**字間が広く、左に飛び出す**ので、
# 「先頭のx」で切ると県名が段の境目で割れる（愛知県が「愛」と「知県」に分かれた）。
# 各段の市町村名の最後の文字（144 / 241 / 338 / 435 / 536）と、
# 次の段の県名の先頭（253.5 など）の間で切る。
COL_EDGES = [50, 157, 247, 351, 448, 560]
YTOL = 4.0  # 同じ行とみなす縦のブレ幅（pt）
SEC = re.compile(r"【\s*([1-3１-３])\s*級地\s*[-－‐]\s*([1-2１-２])\s*】")
PREFS = None  # 47都道府県名（市町村コード表から作る）
GUN = None    # {"都道府県|◯◯郡": [町村, ...]}（郵便番号データから作る）
OFFICIAL = None  # 寄せた形 → 公式の「都道府県|市町村」
KAN = str.maketrans("１２３", "123")


def chars_of(page):
    """文字を (x中心, y, 文字) で返す。語ではなく文字で取る（段をまたいだ合体語を避ける）。"""
    out = []
    for blk in page.get_text("rawdict")["blocks"]:
        for line in blk.get("lines", []):
            for span in line.get("spans", []):
                for ch in span.get("chars", []):
                    x0, y0, x1, _ = ch["bbox"]
                    c = ch["c"]
                    if c.strip():
                        out.append(((x0 + x1) / 2, y0, c))
    return out


def load_masters():
    """47都道府県名と、郡→町村の対応を読む。

    ★県名は段の境目で割れることがある（「神奈川県」→「奈川県」）。
      47しか無い閉じた集合なので、**後方一致で1つに決まるなら** その県とみなす。
    ★「◯◯郡」の行は「その郡の町村すべて」の意味。124行ある。展開しないと、
      たとえば神奈川県三浦郡の葉山町が3級地-2に落ちる。
      郡の中身は郵便番号データ（日本郵便・utf_ken_all.zip、著作権の主張なし）から作る。
    """
    import openpyxl
    prefs = []
    wb = openpyxl.load_workbook(MUNI, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    for r in ws.iter_rows(min_row=2, max_col=3, values_only=True):
        pref = (str(r[1]).strip() if r[1] else "")
        if pref and pref not in prefs:
            prefs.append(pref)
    gun = json.load(open(GUN_PATH, encoding="utf-8")) if os.path.exists(GUN_PATH) else {}
    # 「寄せた形」→ 公式名 の索引。保存する名前はいつも公式名にする。
    official = {}
    ws2 = wb[wb.sheetnames[0]]
    for r in ws2.iter_rows(min_row=2, max_col=3, values_only=True):
        if r[1] and r[2]:
            pref, city = str(r[1]).strip(), str(r[2]).strip()
            official[canon_key(pref, city)] = f"{pref}|{city}"
    return prefs, gun, official


# ★PDFと市町村コード表で字が違うことがある（実際に出たもの）。
#   鎌ヶ谷市↔鎌ケ谷市 / 龍ヶ崎市↔龍ケ崎市 / 袖ヶ浦市↔袖ケ浦市（小書きの ヶ と ケ）
#   須惠町↔須恵町（旧字体）
#   ∴ 突き合わせは「寄せた形」で行い、**保存するのは市町村コード表の公式名**にする。
VARIANT = str.maketrans("ヶヵ惠澤𠮷絲濵嶋", "ケカ恵沢吉糸浜島")


def canon_key(pref, name):
    return f"{pref}|{unicodedata.normalize('NFKC', name).translate(VARIANT)}"


def as_pref(name):
    hit = [p for p in PREFS if p == name or (len(name) >= 2 and p.endswith(name))]
    return hit[0] if len(hit) == 1 else None


def fix_bleed(row):
    """段の境目で**次の段の県名の1文字目が前の段に食い込む**のを直す。

    ★県名は市町村名より左に飛び出して始まるので、段で切ると
        「入間市富」｜「山県」   （入間市 ＋ 富山県）
        「和光市神」｜「奈川県」 （和光市 ＋ 神奈川県）
      のように1文字ずれる。境目の座標をどこに置いても、
      県名と市町村名で始まりが違うので必ずどこかで起きる。
    ∴ 隣り合う段で「右の段が県名として読めない」かつ
      「左の段の最後の1文字を足すと県名になる」ときだけ、文字を右へ戻す。
      都道府県は47しか無い閉じた集合なので、この判定は安全。
      これを入れないと富山県・石川県の見出しが落ち、あとに続く郡や市町村が
      隣の県のものとして記録される（新潟県|中新川郡 になっていた）。
    """
    for ci in range(4):
        left, right = row.get(ci, ""), row.get(ci + 1, "")
        if not left or not right:
            continue
        if as_pref(right):
            continue
        if as_pref(left[-1] + right):
            row[ci] = left[:-1]
            row[ci + 1] = left[-1] + right
    return row


def col_of(x):
    for i in range(5):
        if COL_EDGES[i] <= x < COL_EDGES[i + 1]:
            return i
    return None


def main():
    global PREFS, GUN, OFFICIAL
    PREFS, GUN, OFFICIAL = load_masters()
    if not os.path.exists(PDF):
        raise SystemExit(f"{PDF} が無い。先にPDFを落とすこと。")
    doc = fitz.open(PDF)
    cur_sec = None
    result = {}       # 市町村名 -> 級地
    dup = Counter()
    gun_rows = {}     # 「級地|県|◯◯郡」の見出し → その下に並んだ町村の数（0なら読み違いを疑う）
    last_gun, cur_gun = None, []
    for page in doc:
        chars = chars_of(page)
        # 区分の見出し（【1級地－1】）。y座標つきで拾い、そのy以降に効く。
        heads = []
        text_rows = {}
        for x, y, c in chars:
            text_rows.setdefault(round(y / YTOL), []).append((x, c))
        for key in sorted(text_rows):
            line = "".join(c for _, c in sorted(text_rows[key]))
            m = SEC.search(unicodedata.normalize("NFKC", line))
            if m:
                sec = f"{m.group(1).translate(KAN)}級地-{m.group(2).translate(KAN)}"
                # ★【3級地－2】には一覧が無い（見出しの隣に「上記に掲げた以外の市町村」とあるだけ）。
                #   見出しの y より下を全部3級地-2にすると、同じページで続いている
                #   3級地-1の市町村132件が丸ごと化ける（実際にそうなった。小野市・三田市など
                #   兵庫県が3級地-1と公表しているものが3級地-2になっていた）。
                #   ∴ この見出しは無いものとして扱い、3級地-1のまま読み続ける。
                if sec == "3級地-2":
                    continue
                heads.append((key * YTOL, sec))

        # ★区分（【1級地－1】など）ごとに、独立した5段組の表になっている。
        #   1ページに2区分が縦に積まれることがあるので、**区分の帯ごとに**
        #   段1→段2…と読む。ページ全体を通しで段ごとに読むと、
        #   1区分目の段2を読むときに2区分目の県名が効いてしまう
        #   （東京都の小平市が埼玉県のものとして記録された）。
        bands = []
        ys = [hy for hy, _ in heads]
        for i, (hy, sec) in enumerate(heads):
            end = ys[i + 1] if i + 1 < len(ys) else 10 ** 9
            bands.append((hy, end, sec))
        if not bands:
            bands = [(-1, 10 ** 9, cur_sec)]

        for y0, y1, sec in bands:
            if sec:
                cur_sec = sec
            cells = {i: [] for i in range(5)}
            for key in sorted(text_rows):
                y = key * YTOL
                if not (y0 <= y < y1):
                    continue
                by_col = {}
                for x, c in sorted(text_rows[key]):
                    ci = col_of(x)
                    if ci is None:
                        continue
                    by_col.setdefault(ci, []).append(c)
                row = {ci: "".join(cs).strip() for ci, cs in by_col.items()}
                row = fix_bleed(row)
                for ci, name in row.items():
                    if name:
                        cells[ci].append(name)

            cur_pref = None
            for ci in range(5):
                for name in cells[ci]:
                    # 「上記に掲げた以外の市町村」は段の境目で「…市町」＋「村」に割れる。
                    # 1文字の市町村名は存在しないので、ここで落とす。
                    if (len(name) < 2 or "府県・市町村" in name or "現在" in name
                            or "以外の市町" in name or SEC.search(name)):
                        continue
                    # 末尾に隣の段の1文字が残ることがある（「所沢市東」「北海道千」）。
                    # 読めなければ最後の1文字を落として読み直す。
                    if not as_pref(name) and not re.search(r"[市町村区郡]$|地域$", name) and len(name) > 1:
                        name = name[:-1]
                    p = as_pref(name)
                    if p:
                        cur_pref = p
                        last_gun, cur_gun = None, []
                        continue
                    if not cur_sec or not cur_pref:
                        continue
                    # ★「◯◯郡」の行は見出し。**その郡の町村すべて**ではなく、すぐ下に字下げで並ぶ町村だけがその級地
                    #   （2026-09-23 訂正。PDFを画像で見て確認＝2級地-1 の埼玉県「入間郡」の下は三芳町だけ、
                    #    神奈川県「足柄下郡」の下は箱根町・真鶴町・湯河原町だけ）。
                    #   以前は郡の行を郵便番号データで郡内の全町村に広げていたため、
                    #   ①載っていない町村に級地が付く（福岡県みやこ町が2級地-2に・町の条例は3級地の額）
                    #   ②後のページに同じ郡が出ると、先に正しく入った町の級地を上書きする
                    #    （三芳町・大井町・熊取町・田尻町が2級地-1→3級地-1に）
                    #   という誤りが両方向に出ていた。郡の行は町村の所属を確かめる手がかりにだけ使う。
                    if name.endswith("郡"):
                        cur_gun = GUN.get(f"{cur_pref}|{name}", [])
                        if not cur_gun:
                            dup[f"{cur_pref}|{name}(郡の中身が引けない)"] += 1
                        gun_rows[f"{cur_sec}|{cur_pref}|{name}"] = gun_rows.get(f"{cur_sec}|{cur_pref}|{name}", 0)
                        last_gun = f"{cur_sec}|{cur_pref}|{name}"
                        continue
                    if not re.search(r"[市町村区]$|地域$", name):
                        continue
                    # 郡の見出しの下の町村か（字下げの並び）。郡に属さない名前が来たら郡の並びは終わり。
                    if last_gun:
                        if any(canon_key(cur_pref, t) == canon_key(cur_pref, name) for t in cur_gun):
                            gun_rows[last_gun] += 1
                        else:
                            last_gun, cur_gun = None, []
                    key = OFFICIAL.get(canon_key(cur_pref, name), f"{cur_pref}|{name}")
                    if key in result and result[key] != cur_sec:
                        dup[key] += 1
                    result[key] = cur_sec

    empty_gun = [k for k, n in gun_rows.items() if n == 0]
    print(f"郡の見出し {len(gun_rows)}件（下に町村が1つも並ばなかったもの {len(empty_gun)}件）" + (f" 例 {empty_gun[:8]}" if empty_gun else ""))
    by_sec = Counter(result.values())
    print("読めた市町村", len(result))
    for k in sorted(by_sec):
        print(f"  {k}: {by_sec[k]}件")
    if dup:
        print("★同じ名前で級地が食い違ったもの:", dict(dup))

    # 検算: 誰でも知っている組み合わせが合っているか
    # 検算に使う既知の組み合わせ。3級地-1は兵庫県が自分のサイトで公表している顔ぶれを使う
    # （【3級地－2】の見出しより後ろに載っている＝取り違えが起きやすい場所をわざと選ぶ）。
    known = {"川口市": "1級地-1", "さいたま市": "1級地-1", "横浜市": "1級地-1", "川崎市": "1級地-1",
             "大阪市": "1級地-1", "堺市": "1級地-1", "名古屋市": "1級地-1", "神戸市": "1級地-1",
             "千葉市": "1級地-2", "札幌市": "1級地-2", "仙台市": "1級地-2", "福岡市": "1級地-2",
             "京都市": "1級地-1", "広島市": "1級地-2", "姫路市": "1級地-2", "明石市": "1級地-2",
             "小野市": "3級地-1", "三田市": "3級地-1", "西脇市": "3級地-1", "赤穂市": "3級地-1",
             "洲本市": "3級地-1", "相生市": "3級地-1", "三木市": "3級地-1", "加西市": "3級地-1",
             "加古川市": "2級地-2", "高砂市": "2級地-2"}
    flat = {}
    for k, v in result.items():
        flat[k.split("|")[-1]] = v
    bad = [(k, v, flat.get(k)) for k, v in known.items() if flat.get(k) != v]
    print(f"検算: {len(known) - len(bad)}/{len(known)} 一致")
    for k, want, got in bad:
        print(f"  ★{k}: 期待{want} / 読めた{got}")
    # ★最終検算: 読めた「都道府県|市町村」が、総務省の全国地方公共団体コードに実在するか。
    #   実在しない＝段組の読み間違い。ここが0でなければ公開に使わない。
    import openpyxl
    wb = openpyxl.load_workbook(MUNI, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    real = set()
    for r in ws.iter_rows(min_row=2, max_col=3, values_only=True):
        if r[1] and r[2]:
            real.add(f"{str(r[1]).strip()}|{str(r[2]).strip()}")
    ghost = [k for k in result if k not in real and not k.endswith("区の存する地域")]
    print(f"実在しない市町村: {len(ghost)}件" + (f" 例 {ghost[:10]}" if ghost else ""))
    print(f"全国1,741のうち一覧に載っているもの {len(result)}件 → 残り {1741 - len(result)}件が3級地-2")
    for k in ("東京都|府中市", "広島県|府中市", "神奈川県|葉山町", "富山県|舟橋村"):
        print(f"  {k}: {result.get(k, '（一覧に無い＝3級地-2）')}")
    if DRY:
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "note": "生活保護の級地区分。厚生労働省「お住まいの地域の級地を確認」"
                "(https://www.mhlw.go.jp/content/kyuchi.3010.pdf・平成30年10月1日現在)より。"
                "ここに無い市町村はすべて3級地-2。",
        "rows": result,
    }, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("書いた:", OUT)


if __name__ == "__main__":
    main()
