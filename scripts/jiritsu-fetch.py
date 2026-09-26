#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""自立支援医療（精神通院医療）の指定医療機関の一覧を、都道府県・指定都市ごとに取って読み、版として残す。

  python scripts/jiritsu-fetch.py               # 全機関（data/jiritsu/authorities.json）
  python scripts/jiritsu-fetch.py --only 30     # 1機関だけ（コード）
  python scripts/jiritsu-fetch.py --dry         # 取って読むが、版は書かない（件数だけ）
  python scripts/jiritsu-fetch.py --why 30      # 読めなかったときに、見出しの候補を出す

取ったファイル＝.cache/jiritsu/<コード>/<取得日>/（gitignore・手元だけ）
読んだ版    ＝../jiritsu-ledger/versions/<コード>/<取得日>.json（親リポジトリ＝非公開）

★版はフクシルの中に置かない。フクシルはリポジトリの根ごと GitHub Pages に出る（data/ も公開される）ので、
  規約で再利用が明記されていない機関の一覧まで公開してしまう。面に載せるかどうかは jiritsu-build.mjs の HOST_POLICY が決める。
★前の版と行が同じなら書かない（取得日だけ違う同じ版を増やさない）。
★読み方は見出しの文字で列を決める（名称・住所/所在地・郵便・電話・指定年月日）。種別（病院・診療所／薬局／訪問看護）は
  シート名・ファイルの説明・「種別」の列から決める。決められない行は捨てずに「不明」にして件数に出す。
"""
import argparse, csv, gzip, io, json, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AUTH = os.path.abspath(os.path.join(ROOT, '..', 'jiritsu-ledger', 'authorities.json'))   # 調査のメモごと非公開の親リポジトリに置く
CACHE = os.path.join(ROOT, '.cache', 'jiritsu')
LEDGER = os.path.abspath(os.path.join(ROOT, '..', 'jiritsu-ledger', 'versions'))
UA = 'Mozilla/5.0 (compatible; fukushiru.com; contact@fukushiru.com)'
TODAY = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime('%Y-%m-%d')

NAME_KEYS = ['医療機関名', '医療機関の名称', '名称', '機関名', '事業所名', '薬局名', 'ステーション名', '病院名', '施設名', '医療機関']
ADDR_KEYS = ['所在地', '住所']
SKIP_SHEET = re.compile(r'廃止|辞退|休止|取消|失効')
KINDS = [('訪問看護', '訪問看護'), ('薬局', '薬局'), ('病院', '病院・診療所'), ('診療所', '病院・診療所'), ('医院', '病院・診療所'), ('クリニック', '病院・診療所')]


def nz(s):
    if s is None:
        return ''
    if isinstance(s, datetime):
        return s.strftime('%Y-%m-%d')
    s = unicodedata.normalize('NFKC', str(s))
    return re.sub(r'\s+', ' ', s).strip()


def not_seishin(title):
    t = nz(title)
    return bool(re.search(r'更生|育成', t)) and '精神' not in t


def sheet_kind(title):
    t = nz(title)
    en = {'med': '病院・診療所', 'pha': '薬局', 'nur': '訪問看護'}.get(t.lower())   # 川崎市のシート名
    if en:
        return en
    return kind_of(t) or ('訪問看護' if '訪問' in t else '病院・診療所' if re.search(r'医療機関|病院|医科', t) else '薬局' if '調剤' in t else None)


def cell_kind(v):
    """行ごとの種別の欄の値。医療機関コードの点数表番号（1医科・3歯科・4調剤・6訪問看護＝青森県）や「医科・調剤・訪看」も読む。"""
    t = nz(v)
    if re.fullmatch(r'[1-6](\.0)?', t):
        return {'1': '病院・診療所', '3': '病院・診療所', '4': '薬局', '6': '訪問看護'}.get(t[0])
    return kind_of(t) or ('病院・診療所' if re.search(r'医療機関|医科|歯科', t) else '薬局' if '調剤' in t else '訪問看護' if '訪看' in t or '訪問' in t else None)


def covers_kind(text):
    """調査で書いたファイルの説明から種別を決める。「一括」や、種別を2つ以上挙げている説明（茨城県・広島県）からは決めない。"""
    t = nz(text)
    if '一括' in t:
        return None
    found = {v for k, v in KINDS if k in t} | ({'訪問看護'} if '訪問' in t else set())
    return found.pop() if len(found) == 1 else None


def kind_of(text):
    t = nz(text)
    for k, v in KINDS:
        if k in t:
            return v
    return None


def header_map(row):
    """見出し行なら {name, addr, zip, tel, date, kind} の列番号を返す。違えば None。見出しの空白は無視する（「所 在 地」）。"""
    cells = [re.sub(r'\s+', '', nz(c)) for c in row]
    if re.search(r'\d{3}-\d{4}|0\d{1,4}-\d{1,4}-', ''.join(cells)):   # 値の入った行（沖縄県の備考「住所変更」を見出しと取り違えない）
        return None
    m = {}
    for i, c in enumerate(cells):
        if not c:
            continue
        if re.search(r'開設者|代表者|管理者|薬剤師|担当|医師名|法人名', c):   # 人の名前の欄は読まない（福島県「主として担当する薬剤師名」など）   # 人や法人の欄（大分県の「開設者の住所」を所在地と取り違えない）
            continue
        if 'name' not in m and any(k in c for k in NAME_KEYS) and '住所' not in c and '所在地' not in c and 'コード' not in c and '番号' not in c and 'よみ' not in c:
            m['name'] = i
        elif 'addr' not in m and any(k in c for k in ADDR_KEYS) and '郵便' not in c:
            m['addr'] = i
        elif 'zip' not in m and ('郵便' in c or c in ('〒',)):
            m['zip'] = i
        elif 'tel' not in m and ('電話' in c or 'TEL' in c.upper()) and 'FAX' not in c.upper():
            m['tel'] = i
        elif 'date' not in m and '指定' in c and ('日' in c or '年月' in c):
            m['date'] = i
        elif 'kind' not in m and ('種別' in c or c == '区分' or c == '医療区分'):
            m['kind'] = i
        elif 'seishin' not in m and '精神' in c and len(c) <= 8:
            # 育成・更生・精神通院の共通の一覧で、精神通院の列に○が付く形（鳥取県・島根県・大分県の薬局・訪問看護）
            m['seishin'] = i
        elif 'biko' not in m and '備考' in c:
            m['biko'] = i
    if 'name' not in m and 'addr' in m:   # 名前の列の見出しが「薬局」「訪問看護事業者」だけの一覧（長野県）
        for i, c in enumerate(cells):
            if c and i != m['addr'] and ('薬局' in c or '訪問看護' in c or '事業者' in c or 'ステーション' in c) and len(c) <= 12:
                m['name'] = i
                break
    # 郵便番号・電話番号を「上3桁／下4桁」「市外局番／市内局番／加入者番号」の列に分けている一覧（兵庫県・神戸市）
    for i, c in enumerate(cells):
        if not c:
            continue
        if 'zip2' not in m and '下' in c and ('4' in c or '４' in c):
            m['zip2'] = i
        elif 'tel2' not in m and '市内局番' in c:
            m['tel2'] = i
        elif 'tel3' not in m and '加入者番号' in c:
            m['tel3'] = i
    for i, c in enumerate(cells):
        if c and '所在地' in c and '郵便' not in c and not re.search(r'開設者|代表者|法人', c):
            m['addr'] = i
            break
    return m if 'name' in m and 'addr' in m else None


def merge_header(prev, cur):
    """見出しが2行に分かれている一覧（兵庫県＝1行目に名称、2行目に住所）。列ごとにつないで1行の見出しにする。"""
    n = max(len(prev), len(cur))
    return [(prev[i] if i < len(prev) else '') + (cur[i] if i < len(cur) else '') for i in range(n)]


def rows_from_grid(grid, default_kind, why=False):
    """表（行のリスト）から見出しを探して行を読む。見出しは表の途中にもう一度出ることがある（ページごと・種別ごと）。"""
    out, hm, kind, prev = [], None, default_kind, None
    for r in grid:
        cells = [nz(c) for c in r]
        if not any(cells):
            continue
        h = header_map(cells)
        if not h and prev is not None:
            h = header_map(merge_header(prev, cells))   # 見出しの2行目（兵庫県）
            if h:
                # 2行目にだけある列（下4桁・市内局番など）は、2行目の文字で位置を取り直す
                h2 = header_map(merge_header([''] * len(cells), cells)) or {}
                for key in ('zip2', 'tel2', 'tel3'):
                    if key in h2:
                        h[key] = h2[key]
        if h:
            hm = h
            prev = None
            k = kind_of(' '.join(cells))
            if k and not default_kind:
                kind = k
            continue
        # 名前の見出しだけがある行は、次の行と合わせて見出しになるかもしれない
        joined = re.sub(r'\s+', '', ''.join(cells))
        prev = cells if any(k in joined for k in NAME_KEYS) and not any(k in joined for k in ADDR_KEYS) else None
        if hm is None:
            k = kind_of(' '.join(cells)) if len([c for c in cells if c]) <= 2 and not default_kind else None   # 見出しの上の「薬局」などの表題（種別が決まっていないときだけ）
            if k:
                kind = k
            if why:
                print('   見出し前:', cells[:8])
            continue
        g = lambda key: cells[hm[key]] if key in hm and hm[key] < len(cells) else ''
        if not g('name') and 'seishin' not in hm:
            sub = [i for i, c in enumerate(cells) if '精神' in c and len(c) <= 8]
            if sub:
                hm = dict(hm, seishin=sub[0])
                continue
        name, addr = g('name'), g('addr')
        # 法人の種類が名前の上下に割れて入る一覧がある（長野県のPDF「社会医療」＋名前＋「法人財団」）→「社会医療法人財団 名前」に戻す
        mm = re.match(r'^(社会医療|医療|社会福祉|一般社団|一般財団|公益社団|公益財団)(.+?)(法人財団|法人社団|法人)$', name)
        if mm and not name.startswith(mm.group(1) + mm.group(3)):
            name = f'{mm.group(1)}{mm.group(3)} {mm.group(2).strip()}'
        if not name or name in ('計', '合計') or len(name) < 2:
            continue
        # 共通の一覧では、精神通院の列に印が無い行は精神通院の指定ではない
        if 'seishin' in hm and not re.search(r'[○〇◯●◎✓レ1１有]', g('seishin')):
            continue
        # 辞退・廃止した機関を備考に書いたまま残す一覧がある（沖縄県）。いま指定が無い行は読まない
        if 'biko' in hm and re.search(r'辞退|廃止|取消|失効|休止|廃業', g('biko')):
            continue
        rk = cell_kind(g('kind')) if 'kind' in hm else None
        zp = re.sub(r'[^0-9-]', '', g('zip'))
        if 'zip2' in hm and g('zip2'):
            zp = f"{zp}-{re.sub(r'[^0-9]', '', g('zip2'))}"
        tel = re.sub(r'\s+', '', g('tel'))
        # 電話番号が見出しの無い列に分かれている一覧（新潟県「0254｜53｜2141」）＝市外局番だけなら隣の数字をつなぐ
        if 'tel2' not in hm and 'tel' in hm and re.fullmatch(r'0\d{1,4}', tel):
            parts = [tel]
            for j in (hm['tel'] + 1, hm['tel'] + 2):
                v = re.sub(r'\s+', '', cells[j]) if j < len(cells) else ''
                if re.fullmatch(r'\d{1,5}(\.0)?', v):
                    parts.append(v.replace('.0', ''))
            if len(parts) == 3:
                tel = '-'.join(parts)
        if 'tel2' in hm and g('tel2'):
            tel = '-'.join(x for x in (tel, re.sub(r'\s+', '', g('tel2')), re.sub(r'\s+', '', g('tel3'))) if x)
        out.append({'kind': rk or kind or '不明', 'name': name, 'zip': zp, 'addr': addr, 'tel': tel, 'since': g('date')})
    return out


def read_xlsx(path, default_kind, why):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        if SKIP_SHEET.search(ws.title) or not_seishin(ws.title):   # 休止・廃止・辞退の別シート（鳥取県）・更生／育成だけのシート（京都府）
            continue
        k = default_kind or sheet_kind(ws.title)   # ファイルの説明（調査）の種別を優先＝3本とも「病院・診療所」シートの兵庫県
        grid = [list(r[:30]) for r in ws.iter_rows(values_only=True)]
        out += rows_from_grid(grid, k, why)
    return out


def read_xls(path, default_kind, why):
    import xlrd
    wb = xlrd.open_workbook(path)
    out = []
    for sh in wb.sheets():
        if SKIP_SHEET.search(sh.name) or not_seishin(sh.name):
            continue
        k = default_kind or sheet_kind(sh.name)
        grid = []
        for i in range(sh.nrows):
            row = []
            for j in range(min(sh.ncols, 30)):
                c = sh.cell(i, j)
                if c.ctype == xlrd.XL_CELL_DATE:
                    try:
                        row.append(datetime(*xlrd.xldate_as_tuple(c.value, wb.datemode)))
                    except Exception:
                        row.append(c.value)
                else:
                    row.append(c.value)
            grid.append(row)
        out += rows_from_grid(grid, k, why)
    return out


def read_csv(path, default_kind, why):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp932'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return rows_from_grid(list(csv.reader(io.StringIO(text))), default_kind, why)


# 郵便番号・電話番号は「658-0072」のほか「658 0072」「078 451 5611」（神戸市のPDF）の形もある
ZIP = re.compile(r'(?<!\d)(\d{3})[-－ー ]\s*(\d{4})(?!\d)')
TEL = re.compile(r'(?<!\d)0\d{1,4}[-－ー(（ ]\s*\d{1,4}[-－ー)） ]\s*\d{3,4}(?!\d)')


def rows_from_lines(lines, default_kind):
    """表になっていないPDF：「(種別) 名称 〒 所在地 電話 …」の行を、郵便番号を境に読む。"""
    out = []
    for ln in lines:
        t = nz(ln)
        m = ZIP.search(t)
        if not m:
            continue
        head, tail = t[:m.start()].strip(), t[m.end():].strip()
        head = re.sub(r'^\d{6,8}\s+', '', head)   # 行の頭の指定年月（神戸市「20240701 あおい心の診療所」）
        kind = default_kind
        for k in ('訪問看護', '薬局', '病院', '診療所'):
            if head.startswith(k):
                kind = kind_of(k)
                head = head[len(k):].strip()
                break
        tm = TEL.search(tail)
        addr = (tail[:tm.start()] if tm else tail).strip()
        tel = re.sub(r'[-－ー()（）\s]+', '-', tm.group(0)).strip('-') if tm else ''   # 「078 451 5611」→「078-451-5611」
        if len(head) < 2 or not addr:
            continue
        out.append({'kind': kind or '不明', 'name': head, 'zip': f'{m.group(1)}-{m.group(2)}', 'addr': addr, 'tel': tel, 'since': ''})
    return out


def read_pdf(path, default_kind, why):
    import pdfplumber
    grid, loose = [], []
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            tables = p.extract_tables()
            # 見出しだけが表になって、中身は文字の行のページがある（神戸市）＝表の行が少なければ文字で読む
            if tables and sum(len(t) for t in tables) <= 3:
                tables = []
            if tables:
                for t in tables:
                    # PDFの表のセル内の改行は折り返しなので、空白を入れずにつなぐ（「長野今」＋改行＋「井店」→「長野今井店」）
                    grid += [[c.replace(chr(10), '') if isinstance(c, str) else c for c in row] for row in t]
            else:
                loose += (p.extract_text() or '').splitlines()
    out = rows_from_grid(grid, default_kind, why) if grid else []
    if loose:
        out += rows_from_lines(loose, default_kind)
    return out


def read_html(path, default_kind, why):
    from bs4 import BeautifulSoup
    raw = open(path, 'rb').read()
    soup = BeautifulSoup(raw, 'html.parser')
    out = []
    for t in soup.find_all('table'):
        cap = t.find('caption')
        k = kind_of(cap.get_text()) if cap else None
        grid = [[td.get_text(' ', strip=True) for td in tr.find_all(['th', 'td'])] for tr in t.find_all('tr')]
        out += rows_from_grid(grid, k or default_kind, why)
    return out


READERS = {'xlsx': read_xlsx, 'xls': read_xls, 'csv': read_csv, 'pdf-text': read_pdf, 'html': read_html}


_CJ = __import__('http.cookiejar', fromlist=['CookieJar']).CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_CJ))   # 転送のたびにクッキーを付け直すサイト（愛知県）


def fetch(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ja,en;q=0.8'})
    with _OPENER.open(req, timeout=60) as r:
        data = r.read()
    open(dest, 'wb').write(data)
    time.sleep(1.5)   # 役所のサーバに続けて投げない
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--why')
    a = ap.parse_args()
    A = json.load(open(AUTH, encoding='utf-8'))
    summary = []
    for au in A:
        code = au['code']
        if a.only and code != a.only:
            continue
        if not au.get('files'):
            summary.append((au['authority'], 'ファイルなし', 0))
            continue
        rows, errs = [], []
        # 同じ一覧を Excel と PDF の両方で出している機関がある（三重県）。表の形のファイルがあれば PDF は読まない（二重に数える）。
        structured = [f for f in au['files'] if f.get('format') in ('xlsx', 'xls', 'csv', 'html')]
        # 表の形が2種類以上あるとき（浜松市＝xlsx と csv）も、同じ一覧を二重に読まないよう1種類に絞る
        for pref in ('xlsx', 'xls', 'csv', 'html'):
            same = [f for f in structured if f.get('format') == pref]
            if same and len({f.get('format') for f in structured}) > 1 and all(f.get('format') in ('xlsx', 'xls') for f in structured):
                break   # xlsx と xls の組み合わせは種別ごとに形が違うだけのことが多い（大分県）＝両方読む
            if same and len({f.get('format') for f in structured}) > 1:
                structured = same
                break
        use = structured if structured else au['files']
        # 変更・廃止・新規指定の差分だけの一覧は読まない（名古屋市・京都市・東京都の「新規指定・廃止等の差分」）
        use = [f for f in use if not re.search(r'henkou|haishi|henko|jitai|kyushi|shinki|sabun', f['url'], re.I) and not re.match(r'\s*(変更|廃止|辞退|休止)', f.get('covers', '')) and '差分' not in f.get('covers', '')]
        for f in use:
            fmt = f.get('format')
            if fmt not in READERS:
                errs.append(f'{fmt}は読まない')
                continue
            base = re.sub(r'[^A-Za-z0-9._-]', '_', f['url'].split('/')[-1].split('?')[0]) or 'file'
            ext = {'xlsx': '.xlsx', 'xls': '.xls', 'csv': '.csv', 'pdf-text': '.pdf', 'html': '.html'}.get(fmt, '')
            if ext and not base.lower().endswith(ext):   # URLの末尾に拡張子が無いファイル（東京都）＝読む道具が形を拡張子で見るので付ける
                base += ext
            dest = os.path.join(CACHE, code, TODAY, base)
            try:
                fetch(f['url'], dest)
                got = READERS[fmt](dest, covers_kind(f.get('covers', '')), a.why == code)
                rows += got
                if not got:
                    errs.append(f'{base}: 0行')
            except Exception as e:
                errs.append(f'{base}: {type(e).__name__} {str(e)[:80]}')
        by = {}
        for r in rows:
            by[r['kind']] = by.get(r['kind'], 0) + 1
        noaddr = sum(1 for r in rows if not r['addr'])
        unknown = by.get('不明', 0)
        miss = [k for k in ('病院・診療所', '薬局', '訪問看護') if not by.get(k)]
        ok = len(rows) >= 5 and noaddr <= len(rows) * 0.1 and unknown <= len(rows) * 0.02 and len(miss) <= 1
        if miss:
            errs.append('無い種別: ' + '・'.join(miss))
        summary.append((au['authority'], ('OK ' if ok else 'NG ') + json.dumps(by, ensure_ascii=False) + (f' 住所なし{noaddr}' if noaddr else '') + (' / ' + '; '.join(errs) if errs else ''), len(rows)))
        if not ok or a.dry:
            continue
        asof = next((f.get('asOf') for f in au['files'] if f.get('asOf')), '')
        rows.sort(key=lambda r: (['病院・診療所', '薬局', '訪問看護', '不明'].index(r['kind']) if r['kind'] in ['病院・診療所', '薬局', '訪問看護', '不明'] else 9, r['name']))
        vdir = os.path.join(LEDGER, code)
        os.makedirs(vdir, exist_ok=True)
        # 版は gzip で置く（67機関×毎月の全件は、生の JSON だと月17MB＝親リポジトリが膨らむ）
        prev = sorted(x for x in os.listdir(vdir) if re.match(r'\d{4}-\d{2}-\d{2}\.json(\.gz)?$', x))
        if prev:
            pp = os.path.join(vdir, prev[-1])
            last = json.load(gzip.open(pp, 'rt', encoding='utf-8') if pp.endswith('.gz') else open(pp, encoding='utf-8'))
            if last.get('rows') == rows and prev[-1].startswith(TODAY) is False:
                continue   # 中身が同じ版は増やさない
        # 種類ごとに時点が違う一覧がある（岡山県＝病院7/7・薬局9/7・訪問看護8/24）＝ファイルの説明から種類ごとの時点を残す
        asof_by_kind = {}
        for f in use:
            k = covers_kind(f.get('covers', ''))
            if k and f.get('asOf') and k not in asof_by_kind:
                asof_by_kind[k] = f['asOf']
        doc = {'code': code, 'authority': au['authority'], 'asOf': asof, 'asOfByKind': asof_by_kind, 'fetched': TODAY, 'files': [f['url'] for f in use], 'rows': rows}
        with gzip.open(os.path.join(vdir, TODAY + '.json.gz'), 'wt', encoding='utf-8') as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        plain = os.path.join(vdir, TODAY + '.json')
        if os.path.exists(plain):
            os.remove(plain)   # 同じ日の生の JSON（切り替え前）は消す
    for name, st, n in summary:
        print(f'{name}\t{n}\t{st}')


if __name__ == '__main__':
    main()
