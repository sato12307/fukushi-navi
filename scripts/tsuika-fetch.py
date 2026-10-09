# tsuika-fetch.py — 生活保護の追加給付（平成25年生活扶助基準改定の最高裁判決を踏まえた保護費の追加給付）の
#   「自治体ごとの申出受付方法一覧」（厚生労働省の PDF）を取り、data/tsuika-jichitai.json に書く。
#
#   python scripts/tsuika-fetch.py           → 申出手続のページから最新の一覧 PDF の URL を拾い、表を読んで JSON を書く
#   python scripts/tsuika-fetch.py --check   → 書かずに件数と確かめの結果だけ
#
# ★厚労省は一覧を更新している（「10月2日更新」など）。申出手続のページの「自治体ごとの申出受付方法一覧について（◯月◯日更新）」の
#   リンクを毎回たどる（PDF の URL を決め打ちしない）。原本と表の読み取り結果は .cache/tsuika/ に置く（コミットしない）。
# ★郵送先は「厚労省が書いたとおりの文面」を行のまま持つ（事務所ごとに分解しない）。県の欄は形がばらばら
#   （〒→住所の順／所在地→〒の順＝新潟県／1つの欄に事務所が並ぶ＝秋田県など／事務所ごとに行が分かれる＝愛知県・東京都の島しょなど／
#   欄が次の行にまたがる＝群馬県・長野県・大阪市など／郵便局留＝福岡県・さいたま市・大阪市／郵送先なし＝札幌市は電話で申出書を請求）。
#   分解すると取り違えが入るので、画面でも原文の行のまま見せる。
# ★URL は PDF の文字からは正しく取れない（「_」が別の行に落ちて空白に化ける：offerList detail?tempSe ＋ _ ＋ q=12018）。
#   PDF に埋め込まれたリンク（注釈）が正確なので、文字から作った候補を「空白と _ を除いた形」で注釈と突き合わせて確定する。
#   位置では決めない（大阪市の欄に神戸市のリンクが紛れ込んでいる箇所がある＝見えている文字と一致する注釈だけを使う）。
# ★電子申出の ○/× は縦に結合したセルなので、値のある行から拾う。事務所ごとに違う自治体がある（東京都：西多摩福祉事務所は
#   マイナポータル○・島しょの支庁は×）＝そのときは事務所ごとの値を持つ。
# ★確かめ（どれかが外れたら書かない）：
#   ・47都道府県の見出しがそろう／どの自治体も郵送先の欄が空でない／電子申出の欄は ○ か × だけで、どの自治体にも値がある
#   ・URL はすべて注釈で確定できる（できないときは文字に空白や _ の崩れが無いものだけ文字のまま使う）
#   ・件数が前回の JSON から大きく減っていない（10件以上減ったら止める＝読み取りの崩れを疑う）
import json, os, re, sys, urllib.request, datetime, hashlib, unicodedata

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'tsuika')
OUT = os.path.join(ROOT, 'data', 'tsuika-jichitai.json')
MASTER = os.path.join(ROOT, 'data', 'muni-master.json')
BASE = 'https://www.mhlw.go.jp'
PAGE = BASE + '/stf/newpage_75020.html'   # 最高裁判決を踏まえた保護費の追加給付に係る申出手続について
TAIOU = BASE + '/stf/newpage_68902.html'  # 平成２５年生活扶助基準改定に関する最高裁判決への対応について（給付決定状況の PDF がここにある）
UA = {'User-Agent': 'Mozilla/5.0 (fukushiru.com)'}
PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
         '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
         '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
         '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']

# 半角カナ（ｾﾝﾀｰ・｡・､）と互換漢字（貝塚市の「塚」が U+FA10 で、名簿の「塚」と別の文字）だけそろえる。ほかの文字は原文のまま
HWK = re.compile('[｡-ﾟ豈-﫿]+')
disp = lambda s: HWK.sub(lambda m: unicodedata.normalize('NFKC', m.group(0)), s)
JP = re.compile(r'[^\x00-\x7f]')
ukey = lambda u: re.sub(r'[\s_]', '', u)            # 注釈と突き合わせる形（空白と _ を除く）
MARK = re.compile(r'^[○〇◯]\s*')
DASH = r'[‐-―−－ーｰ-]'
ZIP = re.compile(r'〒\s?\d{3}' + DASH + r'\d{4}|^\d{3}' + DASH + r'\d{4}$', re.M)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()

def extract(pdf, raw):
    """表の行と、埋め込みリンク（注釈）を読む。時間がかかるので PDF ごとに .cache に置く。"""
    if os.path.exists(raw):
        return json.load(open(raw, encoding='utf-8'))
    import fitz
    doc = fitz.open(pdf)
    rows, links = [], []
    for pno, page in enumerate(doc):
        for tb in page.find_tables().tables:
            for r in tb.extract():
                rows.append({'p': pno + 1, 'c': [(x or '') for x in r] + [''] * (6 - len(r))})
        for l in page.get_links():
            if l.get('uri'):
                x0, y0, x1, y1 = l['from']
                links.append({'p': pno + 1, 'uri': l['uri'], 'degenerate': (x1 - x0) < 2 or (y1 - y0) < 2})
    out = {'rows': rows, 'links': links}
    json.dump(out, open(raw, 'w', encoding='utf-8'), ensure_ascii=False)
    return out

def kessai_status():
    """給付決定状況（「対応について」のページの PDF・1枚）。数字は更新されるので毎回たどる。
    原文：「世帯数：530,348 世帯（令和８年７月末までの累計）」「人数:177 名（令和８年９月末までの累計）」「（令和８年９月末時点）」"""
    import fitz
    html = get(TAIOU).decode('utf-8', 'replace')
    m = re.search(r'href="([^"]+\.pdf)"[^>]*>\s*最高裁判決を踏まえた保護費の追加給付等に係る給付決定状況について', html)
    if not m:
        sys.exit('「対応について」のページに給付決定状況の PDF が見つかりません')
    url = m.group(1) if m.group(1).startswith('http') else BASE + m.group(1)
    f = os.path.join(CACHE, 'status-' + os.path.basename(url))
    if not os.path.exists(f):
        open(f, 'wb').write(get(url))
    t = unicodedata.normalize('NFKC', ''.join(p.get_text() for p in fitz.open(f)))
    t = re.sub(r'\s+', '', t)
    hh = re.search(r'世帯数:([\d,]+)世帯\((令和\d+年\d+月末)までの累計\)', t)
    pp = re.search(r'人数:([\d,]+)名\((令和\d+年\d+月末)までの累計\)', t)
    at = re.search(r'\((令和\d+年\d+月末)時点\)', t)
    if not (hh and pp and at):
        sys.exit(f'給付決定状況の PDF の文が読めません（{t[:120]}）')
    return {'households': int(hh.group(1).replace(',', '')), 'householdsUntil': hh.group(2),
            'plaintiffs': int(pp.group(1).replace(',', '')), 'plaintiffsUntil': pp.group(2), 'asOf': at.group(1),
            'source': {'name': '厚生労働省「最高裁判決を踏まえた保護費の追加給付等に係る給付決定状況について」', 'url': url, 'page': TAIOU}}

def lines_of(cell):
    return [x.strip() for x in cell.split('\n') if x.strip()]

def row_label(lines):
    """その行の事務所名。「○ 尾張福祉事務所」の行（折り返しは〒・所在地・次の○の手前までつなぐ）。
    ○が無い行は、〒と住所のあとの最後の行（大阪府の「大阪府富田林子ども家庭センター 生活福祉課」）。"""
    for i, x in enumerate(lines):
        if MARK.match(x):
            lab = [MARK.sub('', x)]
            for y in lines[i + 1:]:
                if MARK.match(y) or y.startswith(('〒', '所在地')) or ZIP.search(y):
                    break
                lab.append(y)
            return disp(''.join(lab))
    if len(lines) >= 3 and ZIP.search(lines[0]) and not ZIP.search(lines[-1]) and not lines[-1].startswith('※'):
        return disp(lines[-1])
    return None

def link_items(parts):
    """URL の欄を、自治体の行をまたいで1本の流れとして読む。日本語の行は直後の URL の見出し（【大阪市ホームページ】など）、
    http で始まる行は新しい URL、それ以外の英数字の行は前の URL の続き（PDF の折り返し）。最後に残った日本語は注記。"""
    # 「_」の崩れ方：PDF の読み取りは、URL の行の「_」を空白にして、「_」だけを次の行（「_ _」）に落とす。
    #   ＝URL の行の空白を「_」に戻し、「_」だけの行は捨てる。空白の数（sp）と落ちた「_」の数（us）が合うかで確かめる
    items, pend = [], []
    for cell, rl in parts:
        for x in lines_of(cell):
            if JP.search(x):
                pend.append(disp(x))
                continue
            if re.fullmatch(r'[_\s]+', x):
                if items:
                    items[-1]['us'] += x.count('_')
                continue
            sp = x.count(' ')
            x = x.replace(' ', '_')
            if x.lower().startswith('http') or not items or pend:
                lab = re.sub(r'^[【〇○◯\s]+|[】\s]+$', '', ''.join(pend)) or None
                items.append({'label': lab, 'row': rl, 'text': x, 'sp': sp, 'us': 0, 'noScheme': not x.lower().startswith('http')})
                pend = []
            else:
                items[-1]['text'] += x
                items[-1]['sp'] += sp
    return items, (''.join(pend) or None)

def main():
    check = '--check' in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    html = get(PAGE).decode('utf-8', 'replace')
    m = re.search(r'href="([^"]+\.pdf)"[^>]*>\s*自治体ごとの申出受付方法一覧について（([^）]+)）', html)
    if not m:
        sys.exit('申出手続のページに「自治体ごとの申出受付方法一覧」のリンクが見つかりません')
    pdf_url = m.group(1) if m.group(1).startswith('http') else BASE + m.group(1)
    updated = m.group(2)
    f = os.path.join(CACHE, os.path.basename(pdf_url))
    if not os.path.exists(f):
        open(f, 'wb').write(get(pdf_url))
    sha1 = hashlib.sha1(open(f, 'rb').read()).hexdigest()
    ex = extract(f, os.path.join(CACHE, f'{sha1}.rows.json'))

    # ── 注釈（埋め込みリンク）の索引
    ann = {}
    for l in ex['links']:
        ann.setdefault(ukey(l['uri']), set()).add(l['uri'])
    used, fromtext = set(), []

    def resolve(it, where):
        k = ukey(it['text'])
        if k in ann and len(ann[k]) == 1:
            u = next(iter(ann[k])); used.add(u); return u
        cands = {u for kk, us in ann.items() for u in us if len(k) >= 20 and (kk.endswith(k) or kk.startswith(k))}
        if len(cands) == 1:   # 「city.tottori.lg.jp/page/45785.html」のように https://www. が欠けた文字（鳥取市）
            u = next(iter(cands)); used.add(u); return u
        if re.match(r'^https?//', it['text']):   # PDF の誤記「https//www.city.kiyosu…」（清須市）＝「:」を補う。補ったものは一覧に出す
            it['text'] = re.sub(r'^(https?)//', r'\1://', it['text'])
            where += '（PDF の「https//」に「:」を補った）'
        if it['sp'] == it['us'] and not it['noScheme'] and re.fullmatch(r'https?://\S+', it['text']):
            fromtext.append(f'{where} {it["text"]}')
            return it['text']   # 注釈が無い（PDF でリンクになっていない）。空白と落ちた「_」の数が合う＝文字から戻せる
        sys.exit(f'{where}：URL を確定できません（文字「{it["text"][:80]}」・空白 {it["sp"]}／落ちた_ {it["us"]}・注釈の候補 {len(cands)} 件）')

    # ── 行を自治体ごとにまとめる（自治体名のある行から、次の自治体名のある行の手前まで）
    groups, section, pref_seen, cur = [], None, set(), None
    for r in ex['rows']:
        c = [x.strip() for x in r['c']]
        name = disp(c[0].replace('\n', ''))
        if name == '自治体名' or (not name and not c[1] and c[2].startswith('マイナポータル')):
            continue
        if name and not any(c[1:6]):   # まとまりの見出し（都道府県名・指定都市・中核市など）
            section, cur = name, None
            if name in PREFS:
                pref_seen.add(name)
            continue
        if not any(c[:6]):
            continue
        if name:
            cur = {'section': section, 'name': name, 'rows': [], 'p': r['p']}
            groups.append(cur)
        elif cur is None:
            sys.exit(f'{r["p"]}ページ：自治体名の無い行が、自治体の行より前にあります（{c[1][:30]}）')
        cur['rows'].append(c)

    # ── 市区町村の名簿（指定都市・中核市のまとまりを都道府県に戻すため）
    master = json.load(open(MASTER, encoding='utf-8'))['rows']
    by_name = {}
    for x in master:
        by_name.setdefault(x['city'], []).append(x)

    out, nozip = [], []
    for g in groups:
        where = f'{g["p"]}ページ {g["name"]}'
        mail, rlabels = [], []
        for c in g['rows']:
            ls = lines_of(c[1])
            mail += [disp(x) for x in ls]
            rlabels.append(row_label(ls))
        if not mail:
            sys.exit(f'{where}：郵送先の欄が空です')
        if not any(ZIP.search(unicodedata.normalize('NFKC', x)) for x in mail):
            nozip.append(g['name'])
        # 電子申出 ○/×（値のある行から。事務所ごとに違えば事務所ごとに）
        vals = {}
        for k, col in (('mynaportal', 2), ('own', 3)):
            got = []
            for c, rl in zip(g['rows'], rlabels):
                v = re.sub(r'[〇◯]', '○', c[col].replace('\n', '').replace(' ', ''))
                if v:
                    if v not in ('○', '×'):
                        sys.exit(f'{where}：電子申出の欄が ○/× ではありません（{v}）')
                    got.append((rl, v == '○'))
            if not got:
                sys.exit(f'{where}：電子申出（{k}）の ○/× が読めません')
            if len({v for _, v in got}) == 1:
                vals[k] = got[0][1]
            else:
                if any(rl is None for rl, _ in got):
                    sys.exit(f'{where}：電子申出が事務所ごとに違うのに、事務所名が読めない行があります')
                vals[k] = None
                vals[k + 'By'] = [{'office': rl, 'ok': v} for rl, v in got]
        # URL（独自の電子申出・案内ページ）
        def links(col):
            items, note = link_items([(c[col], rl) for c, rl in zip(g['rows'], rlabels)])
            res, seen = [], set()
            for it in items:
                u = resolve(it, where)
                if u in seen:
                    continue
                seen.add(u)
                res.append({'url': u, 'label': it['label'], 'office': it['row']})
            # 見出し：PDF の見出し（【…】）があればそれ。URL が複数あるときは事務所名。1本だけなら付けない
            for x in res:
                x['label'] = x['label'] or (x['office'] if len(res) > 1 else None)
                del x['office']
            return res, note
        own_links, own_note = links(4)
        hp_links, hp_note = links(5)
        # 都道府県
        if g['section'] in PREFS:
            pref = g['section']
        else:
            cands = by_name.get(g['name'], [])
            if len(cands) != 1:
                sys.exit(f'{where}：「{g["section"]}」のまとまりの自治体を、市区町村の名簿で1つに決められません（候補 {len(cands)}）')
            pref = cands[0]['pref']
        code = None
        if g['name'] in PREFS:
            code = None
        else:
            cs = [x for x in by_name.get(g['name'], []) if x['pref'] == pref]
            code = cs[0]['code'] if len(cs) == 1 else None
        row = {'pref': pref, 'section': g['section'], 'name': g['name'], 'code': code, 'mail': mail, **vals,
               'ownLinks': own_links, 'hp': hp_links}
        if own_note: row['ownNote'] = own_note
        if hp_note: row['hpNote'] = hp_note
        if own_links and vals.get('own') is False:
            sys.exit(f'{where}：独自の電子申出が × なのに URL があります')
        out.append(row)

    missing = [p for p in PREFS if p not in pref_seen]
    if missing:
        sys.exit(f'都道府県の見出しがそろいません：{"・".join(missing)}')
    if len(nozip) > 3:
        sys.exit(f'郵便番号の無い自治体が多すぎます（読み取りの崩れを疑う）：{"・".join(nozip)}')
    nocode = [r['name'] for r in out if r['name'] not in PREFS and not r['code']]
    prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else None
    if prev and len(out) < len(prev['rows']) - 10:
        sys.exit(f'件数が前回より大きく減りました（前回 {len(prev["rows"])} → 今回 {len(out)}）。読み取りの崩れを疑って止めます')
    unused = sorted({l['uri'] for l in ex['links']} - used)
    sections = {}
    for r in out:
        sections[r['section']] = sections.get(r['section'], 0) + 1
    print(f'{updated}・{len(out)}自治体（都道府県 {sum(1 for r in out if r["name"] in PREFS)}）・まとまり {len(sections)}（{"・".join(f"{k}{v}" for k, v in sections.items() if k not in PREFS)}）')
    print(f'  マイナポータル○ {sum(1 for r in out if r.get("mynaportal"))}・独自の電子申出○ {sum(1 for r in out if r.get("own"))}・事務所ごとに違う {"・".join(r["name"] for r in out if "mynaportalBy" in r or "ownBy" in r) or "なし"}')
    print(f'  案内ページあり {sum(1 for r in out if r["hp"])}・独自の申出URL {sum(len(r["ownLinks"]) for r in out)}本・郵便番号なし {"・".join(nozip) or "なし"}・名簿で番号が決まらない {"・".join(nocode) or "なし"}')
    print(f'  注釈のうち使わなかったリンク {len(unused)}本' + ''.join(f'\n    {u}' for u in unused[:12]))
    print(f'  注釈が無く文字から戻した URL {len(fromtext)}本' + ''.join(f'\n    {u}' for u in fromtext[:40]))
    st = kessai_status()
    print(f'  給付決定状況：{st["householdsUntil"]}までに {st["households"]:,}世帯・特別給付金 {st["plaintiffsUntil"]}までに {st["plaintiffs"]}名（{st["asOf"]}時点）')
    if check:
        return
    data = {
        'note': '生活保護の追加給付（平成25年生活扶助基準改定に関する最高裁判決を踏まえた保護費の追加給付）の、自治体ごとの申出受付方法。厚生労働省の一覧（PDF）を scripts/tsuika-fetch.py が読み取ったもの。申出先は「当時保護を受けていた自治体」。郵送先（mail）は原文の行のまま（半角カナだけ全角に）。URL は PDF の埋め込みリンクで確定したもの。',
        'updated': updated, 'fetchedAt': datetime.date.today().isoformat(),
        'source': {'name': f'厚生労働省「自治体ごとの申出受付方法一覧について（{updated}）」', 'url': pdf_url, 'page': PAGE},
        'sha1': sha1,
        'status': st,
        'rows': out,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as w:
        json.dump(data, w, ensure_ascii=False, indent=0)
        w.write('\n')
    print('書いた:', OUT)

if __name__ == '__main__':
    main()
