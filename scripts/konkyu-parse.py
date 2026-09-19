# -*- coding: utf-8 -*-
# ─────────────────────────────────────────────────────────────────────────────
# konkyu-parse.py — 生活困窮者自立支援制度「自治体別集計表」のPDFを読んで data/konkyu.json を書く。
#
#   python scripts/konkyu-parse.py
#   前に回すもの: node scripts/konkyu-fetch.mjs
#
# ★PDFの読み方（ここで踏んだ罠）
#   ①pdftotext は日本語を落とす。このPDFは ToUnicode が無く、pdftotext -layout だと
#     数字だけ残って自治体名が全部消える。**pypdf を使う**。
#   ②行の形は「[県グループ] 自治体名 区分 人口 数字×18」。県グループ列はグループの先頭行
#     にしか出ないが、**その県に中核市が1つも無い県（三重・徳島・佐賀）は自分の名前が
#     2回出る**（「三重県 三重県 都道府県 …」）。名前を先頭トークンで取ると3県落ちる。
#     → **区分（都道府県/指定都市/中核市）の1つ手前のトークンが自治体名**。
#   ③平成27・28年度だけ列数が違う（24列・26列）。18列でない年度は採らない。
#
# ★列の意味（集計結果PDFの見出しで確認済み）
#   人口 ／ ①新規相談受付件数・10万人あたり ／ ②プラン作成件数・10万人あたり
#   ／ ③就労支援対象者数・10万人あたり
#   ★「10万人あたり」は**年間でなく1か月あたり**（年度累計 ÷ 12 ÷ 人口 × 100,000）。
#     集計結果PDFの月別行で確認済み。年間と読むと12倍の誤報になる。表示するときは
#     必ず「月あたり」と書くか、こちらで年換算し直す。
#   ／ プラン作成者が使った事業の内訳8つ（住居確保・一時生活・家計改善・就労準備・
#      就労訓練・自立相談支援機関の就労支援・生活福祉資金貸付・生保就労自立）
#   ／ 就労者数・うち就労支援対象プラン作成者分⑤ ／ 増収者数・うち⑥
#
# ★関所（ここを通らない年度は書かない）
#   A. 全国合計が「集計結果（年度）」PDFの合計行と1件の誤差もなく一致すること（7項目）。
#      1つでも違えば列がずれている。
#   B. 「10万人あたり」＝件数÷人口×100000 が小数第1位まで一致すること（列の位置の検算）。
#   C. うち（⑤⑥）≤ 親（就労者数・増収者数）。逆転は読み違い。
#   D. 区分ごとの機関数が前年から飛んでいないこと。
# ─────────────────────────────────────────────────────────────────────────────
import io
import json
import os
import re
import sys
import glob

import pypdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'konkyu')
OUT = os.path.join(ROOT, 'data', 'konkyu.json')
KINDS = ('都道府県', '指定都市', '中核市')
NCOL = 18  # 人口を除いた数値列の本数

# 18列の並び（人口の次から数える）
COLS = [
    ('soudan', '新規相談受付件数'), ('soudan100k', '新規相談・10万人あたり'),
    ('plan', 'プラン作成件数'), ('plan100k', 'プラン作成・10万人あたり'),
    ('shien', '就労支援対象者数'), ('shien100k', '就労支援対象・10万人あたり'),
    ('jukyo', '住居確保給付金'), ('ichiji', '一時生活支援'),
    ('kakei', '家計改善支援'), ('junbi', '就労準備支援'),
    ('kunren', '就労訓練事業'), ('jshuro', '自立相談支援機関による就労支援'),
    ('kashitsuke', '生活福祉資金貸付'), ('seiho', '生保受給者等就労自立促進'),
    ('shurosha', '就労者数'), ('shurosha_p', '就労者数うちプラン作成者分'),
    ('zoshu', '増収者数'), ('zoshu_p', '増収者数うちプラン作成者分'),
]
KEYS = [c[0] for c in COLS]
# 全国合計の検算に使う7項目と、集計結果PDFの合計行での位置
GATE = ['soudan', 'plan', 'shien', 'shurosha', 'shurosha_p', 'zoshu', 'zoshu_p']
GATE_IDX = [0, 2, 4, 6, 7, 8, 9]

NUM = re.compile(r'^[\d,]+(?:\.\d+)?$')


def pdf_text(path):
    return '\n'.join((p.extract_text() or '') for p in pypdf.PdfReader(path).pages)


def parse_muni(path):
    """自治体別集計表のPDF -> [(name, level, pop, [18個の数値])]"""
    rows = []
    for line in pdf_text(path).split('\n'):
        tk = line.strip().split()
        idx = [i for i, x in enumerate(tk) if x in KINDS]
        if not idx or idx[0] == 0:
            continue
        i = idx[0]
        name, level = tk[i - 1], tk[i]
        nums = []
        for x in tk[i + 1:]:
            if NUM.match(x):
                nums.append(float(x.replace(',', '')))
            else:
                break
        if len(nums) != NCOL + 1:
            continue
        rows.append((name, level, int(nums[0]), nums[1:]))
    return rows


def parse_total(path):
    """集計結果のPDF -> 合計行の7項目。取れなければ None。"""
    for line in pdf_text(path).split('\n'):
        s = line.strip()
        if not s.startswith('合計'):
            continue
        nums = [float(x.replace(',', '')) for x in re.findall(r'[\d,]+(?:\.\d+)?', s)]
        if len(nums) < max(GATE_IDX) + 1:
            continue
        return dict(zip(GATE, [nums[j] for j in GATE_IDX]))
    return None


def parse_jokyo(path):
    """「◯年度の支援状況」PDF -> 家計改善支援事業の実施自治体数と実施率。
    これを取らずに本文へ「実施率87%」と手で書くと、翌年そのまま古びる。
    数字の形（787自治体 / 87％）だけを拾い、取れなければ None を返す。"""
    t = pdf_text(path)
    i = t.find('家 計 改 善 支 援 事 業')
    if i < 0:
        i = t.find('家計改善支援事業')
    if i < 0:
        return None
    seg = t[max(0, i - 600):i + 1600]
    m1 = re.search(r'実施自治体\s*([\d,]+)\s*自治体', seg)
    m2 = re.search(r'自治体実施率は\s*([\d.]+)\s*[％%]', seg)
    if not (m1 and m2):
        return None
    return {'jichitai': int(m1.group(1).replace(',', '')), 'ritsu': float(m2.group(1))}


def gates(year, rows, total, warn):
    ok = True
    # A. 全国合計
    if total is None:
        warn.append('%d年度: 集計結果PDFの合計行が読めない（検算できないので採らない）' % year)
        return False
    for k in GATE:
        mine = sum(r[3][KEYS.index(k)] for r in rows)
        if abs(mine - total[k]) > 0.5:
            warn.append('%d年度: %s の全国合計が合わない（集計表 %d ／ 公表 %d）'
                        % (year, k, mine, total[k]))
            ok = False
    # B. 「10万人あたり」の検算＝列の位置が合っているか
    bad = 0
    for _name, _level, pop, n in rows:
        if not pop:
            continue
        for cnt, per in (('soudan', 'soudan100k'), ('plan', 'plan100k'), ('shien', 'shien100k')):
            # ★年度累計を12で割って月平均にしてから人口で割る（公表欄の定義）
            calc = round(n[KEYS.index(cnt)] / 12.0 / pop * 100000, 1)
            if abs(calc - n[KEYS.index(per)]) > 0.15:
                bad += 1
    if bad:
        warn.append('%d年度: 「10万人あたり」が件数÷人口と合わない箇所が %d 件（列ずれの疑い）'
                    % (year, bad))
        ok = False
    # C. うち <= 親
    for name, _level, _pop, n in rows:
        for parent, child in (('shurosha', 'shurosha_p'), ('zoshu', 'zoshu_p')):
            if n[KEYS.index(child)] > n[KEYS.index(parent)]:
                warn.append('%d年度 %s: %s が %s を超えている' % (year, name, child, parent))
                ok = False
    return ok


def main():
    warn = []
    years = {}
    for path in sorted(glob.glob(os.path.join(CACHE, 'muni-*.pdf'))):
        year = int(re.search(r'muni-(\d{4})', path).group(1))
        rows = parse_muni(path)
        if not rows:
            warn.append('%d年度: 18列の行が1つも取れない（列数が違う年度）' % year)
            continue
        tpath = os.path.join(CACHE, 'total-%d.pdf' % year)
        total = parse_total(tpath) if os.path.exists(tpath) else None
        if not gates(year, rows, total, warn):
            continue
        years[year] = rows
        print('ok   %d年度  %d機関' % (year, len(rows)))

    if not years:
        print('採れた年度が無い', file=sys.stderr)
        for w in warn:
            print('  ! ' + w, file=sys.stderr)
        sys.exit(1)

    latest = max(years)

    # D. 区分ごとの機関数が前年から飛んでいないか
    prev = None
    for y in sorted(years):
        c = dict((k, sum(1 for r in years[y] if r[1] == k)) for k in KINDS)
        if prev and any(abs(c[k] - prev[k]) > 8 for k in KINDS):
            warn.append('%d年度: 機関数が前年から飛んでいる %s -> %s' % (y, prev, c))
        prev = c

    # 市 -> 都道府県 の対応は、同じ129機関で作ってある生活保護の表から借りる。
    # 噛み合わなくなったら2つの表の区切りがずれた合図なので警告を出す。
    pref = {}
    hogo = os.path.join(ROOT, 'data', 'hogo-shinsei.json')
    if os.path.exists(hogo):
        with io.open(hogo, encoding='utf-8') as f:
            for r in json.load(f)['rows']:
                pref[r['name']] = r.get('pref')
    unmapped = [r[0] for r in years[latest] if r[0] not in pref]
    if unmapped:
        warn.append('%d年度: 生活保護の表と名前が噛み合わない機関が %d 件 %s'
                    % (latest, len(unmapped), '・'.join(unmapped[:10])))

    out_rows = []
    for name, level, pop, n in sorted(years[latest], key=lambda r: r[0]):
        row = {'name': name, 'level': level, 'pref': pref.get(name), 'pop': pop}
        for k, v in zip(KEYS, n):
            row[k] = v if k.endswith('100k') else int(v)
        hist = {}
        for y in sorted(years):
            if y == latest:
                continue
            hit = [r for r in years[y] if r[0] == name and r[1] == level]
            if hit:
                hn = hit[0][3]
                hist[str(y)] = {
                    'pop': hit[0][2],
                    'soudan': int(hn[KEYS.index('soudan')]),
                    'plan': int(hn[KEYS.index('plan')]),
                    'kakei': int(hn[KEYS.index('kakei')]),
                    'jukyo': int(hn[KEYS.index('jukyo')]),
                }
        row['hist'] = hist
        out_rows.append(row)

    national = {}
    for y in sorted(years):
        n = dict((k, int(sum(r[3][KEYS.index(k)] for r in years[y])))
                 for k in KEYS if not k.endswith('100k'))
        n['pop'] = int(sum(r[2] for r in years[y]))
        n['kikan'] = len(years[y])
        national[str(y)] = n

    # 家計改善支援事業の実施率（「◯年度の支援状況」PDFから）
    jisshi = None
    jpath = os.path.join(CACHE, 'jokyo-%d.pdf' % latest)
    if os.path.exists(jpath):
        jisshi = parse_jokyo(jpath)
    if jisshi is None:
        warn.append('%d年度: 家計改善支援事業の実施率が読めない（本文の「実施率◯%%」は出せない）' % latest)
    else:
        # 関所: 実施自治体数は全国1,741市区町村＋都道府県の範囲に収まるはず
        if not (100 <= jisshi['jichitai'] <= 1800) or not (0 < jisshi['ritsu'] <= 100):
            warn.append('%d年度: 実施率の読み取りが範囲外 %s' % (latest, jisshi))
            jisshi = None

    data = {
        'jisshi': jisshi,
        'source': {
            'name': '厚生労働省「生活困窮者自立支援制度支援状況調査」自治体別集計表',
            'url': 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000092189.html',
            'note': '都道府県（管内の一般市・町村ぶん）・指定都市・中核市。年度累計。',
        },
        'columns': dict(COLS),
        'latest_year': latest,
        'years': sorted(years),
        'national': national,
        'rows': out_rows,
        'warnings': warn,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('書いた: %s  (%d年度 %d機関)' % (OUT, len(years), len(out_rows)))
    for w in warn:
        print('  ! ' + w)


if __name__ == '__main__':
    main()
