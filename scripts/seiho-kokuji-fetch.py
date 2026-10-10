# seiho-kokuji-fetch.py — 生活保護法による保護の基準（昭和38年厚生省告示第158号）の現行の本文を、厚生労働省の法令等データベースから
#   読み、生活扶助の表を data/seiho-kokuji.json に書く。
#
#   python scripts/seiho-kokuji-fetch.py           → 10ページを取り直して読み、JSON を書く
#   python scripts/seiho-kokuji-fetch.py --check   → 書かずに読み取りと確かめの結果だけ
#
# ★なぜ（2026-10-10 ユーザー裁定 v306「おすすめ通りすすめて」＝生活保護の計算機に冬季加算と期末一時扶助を足す）
#   計算機（articles/seikatsuhogo-keisanki.html）は「冬季加算を除く」と書いていた。冬季加算・期末一時扶助・地区の区分は告示の別表第1に
#   表である。あわせて、令和8年10月の特例加算の引き上げ（告示第245号）で経過的加算が下がっているかを、告示の現行の表で確かめる。
# ★読むのは告示の現行の本文（法令等データベースの t_doc・10ページ）。PDF の算出方法の資料ではなく告示そのものを正とする。
#   ページの頭に毎回出る「・生活保護法による保護の基準(…) var pageNo = …」の行は消してからつなぐ。
# ★確かめ（どれかが外れたら書かない）：6級地 × 第1類11年齢帯・第2類1〜9人と10人以上の加算・逓減率1〜10人・経過的加算（6級地×11年齢帯×10人）・
#   地区別冬季加算額（Ⅰ〜Ⅵ区×1〜9人と加算・6級地で同じ額か）・期末一時扶助費（6級地×1〜9人と加算）・地区の区分表（47都道府県に1つずつ）。
import json, os, re, sys, hashlib, datetime, urllib.request

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'seiho-kokuji')
OUT = os.path.join(ROOT, 'data', 'seiho-kokuji.json')
URL = 'https://www.mhlw.go.jp/web/t_doc?dataId=82051000&dataType=0&pageNo={}'
UA = {'User-Agent': 'Mozilla/5.0 (fukushiru.com)'}
KY = ['1級地―1', '1級地―2', '2級地―1', '2級地―2', '3級地―1', '3級地―2']
AGES = ['0歳～2歳', '3歳～5歳', '6歳～11歳', '12歳～17歳', '18歳・19歳', '20歳～40歳', '41歳～59歳', '60歳～64歳', '65歳～69歳', '70歳～74歳', '75歳以上']
AREAS = ['Ⅰ区', 'Ⅱ区', 'Ⅲ区', 'Ⅳ区', 'Ⅴ区', 'Ⅵ区']
PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
         '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
         '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
         '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
num = lambda s: int(s.replace(',', '').replace('円', ''))
N = r'([\d,]+)円?'

def die(m):
    sys.exit(m + '（何も書いていません）')

def pages(refetch):
    os.makedirs(CACHE, exist_ok=True)
    out = []
    for p in range(1, 11):
        f = os.path.join(CACHE, f'p{p}.html')
        if refetch or not os.path.exists(f):
            with urllib.request.urlopen(urllib.request.Request(URL.format(p), headers=UA), timeout=60) as r:
                open(f, 'wb').write(r.read())
        out.append(open(f, encoding='utf-8').read())
    return out

def to_text(html):
    t = re.sub(r'<[^>]+>', ' ', html).replace('&nbsp;', ' ')
    t = re.sub(r'\s+', ' ', t)   # 全角の空白・改行しない空白（NBSP）も含めて1つの空白に
    # ページの頭の決まり文句（題名・ページ数・ページ移動・添付一覧）を消す
    t = re.sub(r'・生活保護法による保護の基準\(◆昭和38年04月01日厚生省告示第158号\).*?添付一覧 添付画像はありません 添付一覧 添付画像はありません', ' ', t)
    return re.sub(r' +', ' ', t)

def area_table(html_all):
    i = html_all.find('その他の都府県')
    if i < 0: die('地区の区分表が見つかりません')
    s = html_all.rfind('<table', 0, i); e = html_all.find('</table>', i)
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html_all[s:e], re.S)
    cells = [[re.sub(r'<[^>]+>|\s+', '', c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)] for r in rows]
    head = next((c for c in cells if c and c[0] == '地区別'), None)
    body = next((c for c in cells if c and c[0] == '都道府県名'), None)
    if head != ['地区別'] + AREAS or not body or len(body) != 7: die(f'地区の区分表の形が想定と違います：{head} {body}')
    m = {}
    for a, cell in zip(AREAS, body[1:]):
        if cell == 'その他の都府県':
            continue
        for p in re.findall(r'.+?[都道府県]', cell):
            m[p] = a
    for p in PREFS:
        m.setdefault(p, 'Ⅵ区' if body[6] == 'その他の都府県' else die('その他の都府県が Ⅵ区 にありません'))
    if set(m) != set(PREFS): die(f'地区の区分表の都道府県が47になりません：{sorted(set(m) ^ set(PREFS))}')
    return m

def main():
    check = '--check' in sys.argv
    hs = pages(refetch=not check or not os.path.exists(os.path.join(CACHE, 'p10.html')))
    t = re.sub(r' +', ' ', ' '.join(to_text(h) for h in hs))   # ページの境目（「第1類」がページの最後・「年齢別」が次のページの頭）でも空白を1つに
    amend = re.findall(r'(令和[一二三四五六七八九十]+年[一二三四五六七八九十]+月[一二三四五六七八九十]+日厚生労働省告示第[一二三四五六七八九十百〇]+号)', t)
    # 居宅の基準生活費の表：(ア)/(イ)　N級地―M ごとに 第1類・第2類（1〜5人／6〜9人と加算）と地区別冬季加算額
    k1, k2, touki = {}, None, None
    for ky in KY:
        m = re.search(r'\((?:ア|イ)\) ' + re.escape(ky) + r' 第1類 年齢別 基準額 (.*?)\((?:ア|イ)\) [123]級地―[12] 第1類|\((?:ア|イ)\) ' + re.escape(ky) + r' 第1類 年齢別 基準額 (.*?)\(2\) ?基準生活費の算定', t)
        seg = (m.group(1) or m.group(2)) if m else None
        if not seg: die(f'{ky} の第1類の表が見つかりません')
        k1[ky] = []
        for ag in AGES:
            mm = re.search(re.escape(ag) + r' ' + N, seg)
            if not mm: die(f'{ky} の第1類 {ag} が読めません')
            k1[ky].append(num(mm.group(1)))
        b1 = re.search(r'第2類 基準額及び加算額 世帯人員別 1人 2人 3人 4人 5人 基準額 ' + ' '.join([N] * 5), seg)
        b2 = re.search(r'基準額及び加算額 世帯人員別 6人 7人 8人 9人 10人以上1人を増すごとに加算する額 基準額 ' + ' '.join([N] * 5), seg)
        if not b1 or not b2: die(f'{ky} の第2類の表が読めません')
        k2_ky = [num(x) for x in b1.groups()] + [num(x) for x in b2.groups()]
        tk = {}
        for half, cols in ((0, 5), (1, 5)):
            pass
        for a in AREAS:
            hits = re.findall(re.escape(a) + r'\(([^)]+)\) ' + ' '.join([r'([\d,]+)'] * 5), seg)
            if len(hits) != 2: die(f'{ky} の冬季加算 {a} の行が2つ（1〜5人・6〜9人と加算）ありません（{len(hits)}）')
            period = hits[0][0]
            if hits[1][0] != period: die(f'{ky} の冬季加算 {a} の期間が前後で違います')
            tk[a] = {'period': period, 'v': [num(x) for x in hits[0][1:]] + [num(x) for x in hits[1][1:]]}
        if k2 is None: k2 = k2_ky
        elif k2 != k2_ky: die(f'第2類の基準額が級地で違います（{ky}）＝想定と違う形')
        if touki is None: touki = tk
        elif touki != tk: die(f'冬季加算の額が級地で違います（{ky}）＝想定と違う形')
    # 逓減率
    tg = re.search(r'逓減率 .*?世帯人員別 1人 2人 3人 4人 5人 率 ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) .*?世帯人員別 6人 7人 8人 9人 10人以上 率 ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)', t)
    if not tg: die('逓減率の表が読めません')
    teigen = [float(x) for x in tg.groups()]
    # 期末一時扶助費
    km = re.search(r'期末一時扶助費 級地別 世帯人員別 1人 2人 3人 4人 5人 (.*?) 級地別 世帯人員別 6人 7人 8人 9人 10人以上1人を増すごとに加算する額 (.*?) 経過的加算額', t)
    if not km: die('期末一時扶助費の表が読めません')
    kimatsu = {}
    for ky in KY:
        a1 = re.search(re.escape(ky) + ' ' + ' '.join([N] * 5), km.group(1)); a2 = re.search(re.escape(ky) + ' ' + ' '.join([N] * 5), km.group(2))
        if not a1 or not a2: die(f'期末一時扶助費 {ky} が読めません')
        kimatsu[ky] = [num(x) for x in a1.groups()] + [num(x) for x in a2.groups()]
    # 経過的加算額（級地ごと・1〜5人と6〜10人以上の2表）
    ks = t.find('経過的加算額(月額) (ア) 1級地')   # 全角の空白は to_text で半角1つにしてある
    ke = t.find('イ 第2類の表におけるⅠ区からⅥ区までの区分', ks)
    if ks < 0 or ke < 0: die('経過的加算額の表の範囲が見つかりません')
    kt = t[ks:ke]
    keika = {}
    pos = [(ky, kt.find(ky + ' 年齢別')) for ky in KY]
    if any(p < 0 for _, p in pos): die(f'経過的加算額の級地の見出しが見つかりません：{pos}')
    for i, (ky, p) in enumerate(pos):
        seg = kt[p: pos[i + 1][1] if i + 1 < len(pos) else len(kt)]
        h1 = seg.find('世帯人員別 1人 2人 3人 4人 5人'); h2 = seg.find('世帯人員別 6人 7人 8人 9人 10人以上')
        if h1 < 0 or h2 < 0: die(f'{ky} の経過的加算額の表の見出しが読めません')
        rows = []
        for ag in AGES:
            a1 = re.search(re.escape(ag) + ' ' + ' '.join([N] * 5), seg[h1:h2]); a2 = re.search(re.escape(ag) + ' ' + ' '.join([N] * 5), seg[h2:])
            if not a1 or not a2: die(f'{ky} の経過的加算額 {ag} が読めません')
            rows.append([num(x) for x in a1.groups()] + [num(x) for x in a2.groups()])
        keika[ky] = rows
    areas = area_table(' '.join(hs))
    # 特例加算（第1章の4）：「1((2)のウを除く。)及び2により算定される額に世帯人員一人につき月額2,500円を加える」
    tk_m = re.search(r'4 特例加算 1から3までの基準生活費の算出にあたっては、.*?世帯人員一人につき月額([\d,]+)円を加えるものとし', t)
    if not tk_m: die('特例加算（第1章の4）の文が読めません')
    tokurei = num(tk_m.group(1))
    sha1 = hashlib.sha1(''.join(hs).encode('utf-8')).hexdigest()
    print(f'読めた：第1類 6級地×11・第2類 {k2}・逓減率 {teigen}')
    print(f'  冬季加算 ' + ' '.join(f'{a}{touki[a]["period"]}:{touki[a]["v"][0]}' for a in AREAS) + '（6級地で同じ額）')
    print(f'  期末一時扶助 1級地―1 {kimatsu[KY[0]]}・3級地―2 {kimatsu[KY[5]]}')
    print(f'  経過的加算 1級地―1 単身の年齢帯 {[r[0] for r in keika[KY[0]]]}')
    print(f'  特例加算 {tokurei}円（1人あたり）')
    print(f'  地区の区分 ' + ' '.join(f'{a}={sum(1 for p in PREFS if areas[p] == a)}' for a in AREAS) + f'・最新の改正 {amend[-1] if amend else "?"}')
    if check:
        return
    data = {
        'note': '生活保護法による保護の基準（昭和38年厚生省告示第158号）の現行の本文から、居宅の生活扶助の表を scripts/seiho-kokuji-fetch.py が読んだもの。'
                'k1＝第1類（級地×年齢帯）・k2＝第2類（1〜9人と10人以上の1人あたり加算）・teigen＝逓減率（1〜10人以上）・keika＝経過的加算（級地×年齢帯×1〜10人以上）・'
                'tokurei＝特例加算（居宅・1人あたり月額）・touki＝地区別冬季加算額（Ⅰ〜Ⅵ区×1〜9人と加算・6級地で同じ額）・kimatsu＝期末一時扶助費（級地×1〜9人と加算・12月の基準生活費に加える）・areas＝冬季加算の地区（都道府県→区）。',
        'source': {'name': '生活保護法による保護の基準（昭和38年厚生省告示第158号）・厚生労働省 法令等データベース', 'url': URL.format(1)},
        'amendedBy': amend[-1] if amend else None, 'fetchedAt': datetime.date.today().isoformat(), 'sha1': sha1,
        'grades': ['1級地-1', '1級地-2', '2級地-1', '2級地-2', '3級地-1', '3級地-2'], 'ages': AGES,
        'k1': [k1[ky] for ky in KY], 'k2': k2, 'teigen': teigen, 'tokurei': tokurei, 'keika': [keika[ky] for ky in KY],
        'touki': {a: touki[a] for a in AREAS}, 'kimatsu': [kimatsu[ky] for ky in KY], 'areas': areas,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as w:
        json.dump(data, w, ensure_ascii=False, indent=1)
        w.write('\n')
    print('書いた:', OUT)

if __name__ == '__main__':
    main()
