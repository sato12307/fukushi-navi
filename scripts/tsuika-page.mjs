// ─────────────────────────────────────────────────────────────────────────────
// tsuika-page.mjs — 生活保護の追加給付（平成25年生活扶助基準改定の最高裁判決を踏まえた保護費の追加給付）の面を作る。
//   node scripts/tsuika-page.mjs        → articles/seikatsuhogo-tsuika-kyufu.html（本文）・tsuika/index.html（申出先の全国一覧）・
//                                          tsuika/<01〜47>/index.html（都道府県別の申出先）・assets/tsuika-index.js（検索の索引）と sitemap.xml の行
//   node scripts/tsuika-page.mjs --dry  → 書かずに確かめの結果だけ
//
// ★なぜ（2026-10-09 ユーザー「追加給付！これはいいね。ぜひすすめて」）
//   Bing の90日の実測＝生活保護 追加給付 1,725（含む 2,004）・生活保護追加給付 513・大阪市　生活保護　追加給付 728・
//   いのちのとりで裁判 390・追加給付相談センター 366・生活保護　追加給付　ニュース 117。市の名前つきは大阪市のほかは0。
//   読む人は 2013年8月〜2026年3月に保護を受けていた人と家族・支援者。知りたいのは「自分は対象か・いくら・どこに出すか」。
//   厚労省の申出先の一覧は65ページの PDF で、スマホでは引きにくい＝市町村名で引ける HTML にするのがこの面の値打ち。
//
// ★申出先は data/tsuika-jichitai.json（scripts/tsuika-fetch.py が厚労省の一覧 PDF から読んだもの）。郵送先は原文の行のまま見せる
//   （事務所ごとに分解しない）。町村は、自前の福祉事務所が一覧に無ければ県の福祉事務所が窓口＝市区町村の名簿（data/muni-master.json）と
//   突き合わせて「県が担う町村」を出す。名簿の市・区が一覧に無ければ止める（一覧の抜けか読み取りの崩れ）。
//   開けなかった URL は data/tsuika-linkcheck.json（scripts/tsuika-linkcheck.mjs）で印を付け、リンクにしない。
// ★金額の目安は、厚労省が公表した例（60歳代単身・30歳代夫婦と4歳の子／1級地-1・3級地-2）だけから出す（式を作らない）。
//   期間ごとの額（0.1万円単位に丸めてある）を、合計が公表の合計に合うよう同じ割合でそろえ、受けていた月数で割り戻す。
//   2018年10月以降は12月の期末一時扶助だけ（例の注記）なので、12月の数で割り戻す。文の数字と計算機の JS は同じ定数から出す。
// ★制度の文は、どれも厚労省の通知・告示・申出手続のページ・相談センターのページの原文で確かめたもの（2026-10-09）。
//   言い切らないもの＝今は保護を受けていない人への支給の税の扱い（原典に書かれていない）・マイナポータルの画面の操作。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const PUBLISHED = '2026-10-09'
const SITE = 'https://fukushiru.com'
const SLUG = 'seikatsuhogo-tsuika-kyufu.html'
const ART_URL = `${SITE}/articles/${SLUG}`
const HUB_URL = `${SITE}/tsuika/`
const die = (m) => { console.error(m); console.error('何も書き出していません。'); process.exit(1) }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n) => Math.round(n).toLocaleString('ja-JP')

// ── データ ─────────────────────────────────────────────────────────────────────
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tsuika-jichitai.json'), 'utf8'))
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'muni-master.json'), 'utf8')).rows
const LCF = path.join(ROOT, 'data', 'tsuika-linkcheck.json')
const LC = fs.existsSync(LCF) ? JSON.parse(fs.readFileSync(LCF, 'utf8')) : { checkedAt: null, bad: [] }
const BAD = new Map(LC.bad.map((b) => [b.url, b]))
const LIST_UPDATED = D.updated.normalize('NFKC')            // 「10月２日更新」→「10月2日更新」
const ST = D.status
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
const REGIONS = [['北海道・東北', 0, 7], ['関東', 7, 14], ['中部', 14, 23], ['近畿', 23, 30], ['中国', 30, 35], ['四国', 35, 39], ['九州・沖縄', 39, 47]]
const pc = (pref) => String(PREFS.indexOf(pref) + 1).padStart(2, '0')
const prefUrl = (pref) => `${SITE}/tsuika/${pc(pref)}/`
const SECTAG = { 政令指定都市: '指定都市', 中核市: '中核市' }

// 確かめ：都道府県・件数・名簿との突き合わせ
if (D.rows.length < 850) die(`申出先が少なすぎます（${D.rows.length}）`)
for (const r of D.rows) if (!PREFS.includes(r.pref)) die(`都道府県が読めない行：${r.name}（${r.pref}）`)
const listed = new Set(D.rows.filter((r) => r.code).map((r) => r.code))
const kanaOf = new Map(M.map((x) => [x.code, x.kana]))
const COVERED = new Map(PREFS.map((p) => [p, []]))         // 県の福祉事務所が担う町村（一覧に自前の窓口が無いもの）
for (const x of M) {
  if (listed.has(x.code)) continue
  if (/[市区]$/.test(x.city)) die(`名簿の ${x.pref}${x.city} が厚労省の一覧にありません（一覧の抜けか読み取りの崩れ）`)
  COVERED.get(x.pref).push(x)
}
for (const [p, list] of COVERED) if (list.length && !D.rows.some((r) => r.pref === p && r.name === p)) die(`${p}：県の行が無いのに、自前の窓口の無い町村があります（${list.map((x) => x.city).join('・')}）`)
const OSAKA = D.rows.find((r) => r.name === '大阪市')
if (!OSAKA) die('一覧に大阪市がありません')

// ── 金額の目安（厚労省「追加給付額の例・対象期間」001662197.pdf・単位は万円）──────────────────────────────
//   期間：①H25.8〜H26.3（8か月・+0.8%）②H26.4〜H27.3（12か月・+1.6%）③H27.4〜H30.9（42か月・+2.4%）④H30.10〜R8.3（90か月・期末一時扶助のみ）
const EX = {
  single: { label: '60歳代のひとり暮らし', k11: { p: [0.5, 1.6, 8.1, 0.2], total: 10.5 }, k32: { p: [0.4, 1.2, 6.5, 0.2], total: 8.5 } },
  family: { label: '30歳代の夫婦と4歳の子ども1人', k11: { p: [1.0, 3.0, 15.8, 0.4], total: 20.4 }, k32: { p: [0.8, 2.4, 12.5, 0.3], total: 16.1 } },
}
const ym = (y, m) => y * 12 + m - 1
const PER = [[ym(2013, 8), ym(2014, 3)], [ym(2014, 4), ym(2015, 3)], [ym(2015, 4), ym(2018, 9)], [ym(2018, 10), ym(2026, 3)]]
if (PER.map(([s, e]) => e - s + 1).join() !== '8,12,42,90') die('期間の月数が公表の例（8・12・42・90か月）と合いません')
const DECS4 = Array.from({ length: PER[3][1] - PER[3][0] + 1 }, (_, i) => PER[3][0] + i).filter((t) => t % 12 === 11).length
if (DECS4 !== 8) die(`2018年10月〜2026年3月の12月の数が8ではありません（${DECS4}）`)
const EXS = {}   // 合計が公表の合計に合うようにそろえた期間ごとの額
for (const [hh, v] of Object.entries(EX)) {
  EXS[hh] = {}
  for (const k of ['k11', 'k32']) {
    const { p, total } = v[k]
    const sum = p.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - total) > 0.2 + 1e-9) die(`例の期間ごとの額の合計が公表の合計と離れすぎています（${v.label}・${k}：${sum.toFixed(1)} と ${total}）＝写し間違い？`)
    EXS[hh][k] = p.map((x) => x * total / sum)
  }
}

// ── 出典 ─────────────────────────────────────────────────────────────────────
const SRC = {
  taiou: { name: '厚生労働省「平成２５年生活扶助基準改定に関する最高裁判決への対応について」', url: 'https://www.mhlw.go.jp/stf/newpage_68902.html' },
  moushide: { name: '厚生労働省「最高裁判決を踏まえた保護費の追加給付に係る申出手続について」', url: 'https://www.mhlw.go.jp/stf/newpage_75020.html' },
  list: { name: D.source.name, url: D.source.url },
  kokuji: { name: '平成二十五年八月から令和八年三月までの間の生活保護法による保護の基準の特例（令和８年厚生労働省告示第43号）', url: 'https://www.mhlw.go.jp/content/12000000/001659562.pdf' },
  tsuchi: { name: '平成25年生活扶助基準改定に関する最高裁判決を踏まえた保護費の追加給付等について（令和８年２月20日 社援発0220第１号 厚生労働省社会・援護局長通知）', url: 'https://www.mhlw.go.jp/content/12000000/001660519.pdf' },
  rei: { name: '厚生労働省「追加給付額の例・対象期間」', url: 'https://www.mhlw.go.jp/content/12000000/001662197.pdf' },
  yosan: { name: '厚生労働省「最高裁判決を踏まえた保護費等の追加給付について」（令和７年度補正予算）', url: 'https://www.mhlw.go.jp/content/12000000/001650369.pdf' },
  tasei: { name: '平成25年生活扶助基準改定に関する最高裁判決を踏まえた対応に伴う他制度の取扱いについて（厚生労働事務次官通知）', url: 'https://www.mhlw.go.jp/content/12000000/001655018.pdf' },
  status: { name: ST.source.name, url: ST.source.url },
  center: { name: '最高裁判決を踏まえた保護費の追加給付相談センター（厚生労働省委託事業）', url: 'https://tsuikakyufu-sodancenter.mhlw.go.jp/' },
  centerOpen: { name: '厚生労働省「最高裁判決を踏まえた保護費の追加給付相談センターの開設について」（令和８年３月27日）', url: 'https://www.mhlw.go.jp/stf/newpage_72014.html' },
}
const FORM = 'https://www.mhlw.go.jp/content/12000000/001729637.pdf'    // 申出書（標準様式）
const ININ = 'https://www.mhlw.go.jp/content/12000000/001732594.pdf'    // 委任状
const TEL = '0120-179-445'
const a = (s, text) => `<a href="${esc(s.url)}" rel="nofollow">${esc(text || s.name)}</a>`

// ── 申出先の1か所ぶんの HTML ────────────────────────────────────────────────────────
//   郵送先は原文の行。「○ 尾張福祉事務所」の行（折り返しは〒・所在地の手前までつなぐ）は太字、「※」の行は注記
function mailHtml(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const x = lines[i]
    if (/^[○〇◯]/.test(x)) {
      let lab = x.replace(/^[○〇◯]\s*/, '')
      while (i + 1 < lines.length && !/^([○〇◯※〒]|所在地|\d{3}[-‐－ー]\d{4}$)/.test(lines[i + 1]) && !/〒\s?\d{3}/.test(lines[i + 1])) lab += lines[++i]
      out.push(`<b>${esc(lab)}</b>`)
    } else if (/^※/.test(x)) {
      // 「※」の行から後ろ（〒・○の行の手前まで）は注記。PDF の折り返し（前の行が「。」などで終わらない）はつなぐ。TEL の行は分ける
      const parts = [x]
      while (i + 1 < lines.length && !/^([○〇◯※〒]|所在地)/.test(lines[i + 1])) {
        const nx = lines[++i]
        if (/[。）)]$/.test(parts[parts.length - 1]) || /^(TEL|電話)/.test(nx)) parts.push(nx)
        else parts[parts.length - 1] += nx
      }
      out.push(`<span class="nt">${parts.map(esc).join('<br>')}</span>`)
    }
    else out.push(esc(x))
  }
  return out.join('<br>')
}
function linkHtml(l, fallback, who) {
  const text = l.label || fallback
  const b = BAD.get(l.url)
  if (!b) return `<a href="${esc(l.url)}" rel="nofollow">${esc(text)}</a>`
  if (/sandbox/.test(l.url)) return `<span class="dead">${esc(text)}（厚生労働省の一覧に載っている URL は試験用の環境を指していて開けません。${esc(who)}の案内ページから申し込んでください）</span>`
  return `<span class="dead">${esc(text)}（厚生労働省の一覧に載っているページは、${LC.checkedAt.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')}に確かめたときは開けませんでした）</span>`
}
const okng = (v) => (v ? '<span class="ok">できる</span>' : '<span class="ng">できない</span>')
function entityHtml(r) {
  const isPref = r.name === r.pref
  const id = isPref ? 'ken' : `m${r.code}`
  const tag = isPref ? `<span class="tg">${esc(r.pref)}の福祉事務所</span>` : SECTAG[r.section] ? `<span class="tg">${SECTAG[r.section]}</span>` : ''
  const who = isPref ? r.pref : r.name
  let mp
  if (r.mynaportalBy) {
    const yes = r.mynaportalBy.filter((x) => x.ok).map((x) => x.office), no = r.mynaportalBy.filter((x) => !x.ok).map((x) => x.office)
    mp = `事務所によって違います（${yes.length ? `できる：${esc(yes.join('・'))}` : ''}${yes.length && no.length ? '／' : ''}${no.length ? `できない：${esc(no.join('・'))}` : ''}）`
  } else mp = okng(r.mynaportal)
  let own
  if (r.ownBy) own = `事務所によって違います（${r.ownBy.map((x) => `${esc(x.office)}：${x.ok ? 'できる' : 'できない'}`).join('／')}）`
  else own = okng(r.own)
  if (r.ownLinks.length) own += `：${r.ownLinks.map((l) => linkHtml(l, '申し込みページ', who)).join('／')}`
  if (r.ownNote) own += `<br><span class="nt">${esc(r.ownNote)}</span>`
  let hp = r.hp.length ? r.hp.map((l) => linkHtml(l, `${who}の案内ページ`, who)).join('<br>') : '<span class="nt">厚生労働省の一覧には載っていません</span>'
  if (r.hpNote) hp += `<br><span class="nt">${esc(r.hpNote)}</span>`
  let extra = ''
  if (isPref) {
    const cov = COVERED.get(r.pref)
    extra = `<p class="cov"><strong>${esc(r.pref)}の福祉事務所が窓口の町村（${cov.length}）</strong>：${cov.map((x) => esc(x.city)).join('、')}</p>`
  }
  return `<section class="tk" id="${id}">
<h3>${esc(isPref ? `${r.pref}（町村に住んでいた人）` : r.name)}${tag}</h3>
<dl>
<dt>郵送先</dt><dd class="mail">${mailHtml(r.mail)}</dd>
<dt>マイナポータル</dt><dd>${mp}</dd>
<dt>${esc(isPref ? r.pref : r.name)}独自の電子申出</dt><dd>${own}</dd>
<dt>案内ページ</dt><dd>${hp}</dd>
</dl>${extra}
</section>`
}

// ── 検索の索引（assets/tsuika-index.js）：[名前, カナ, 都道府県の番号, 飛び先, 県が担う町村なら1] ─────────────────
const IDX = []
for (const r of D.rows) {
  if (r.name === r.pref) IDX.push([r.name, '', +pc(r.pref), 'ken', 0])
  else IDX.push([r.name, kanaOf.get(r.code) || '', +pc(r.pref), `m${r.code}`, 0])
}
for (const [p, list] of COVERED) for (const x of list) IDX.push([x.city, x.kana, +pc(p), 'ken', 1])
const SEARCH_JS = `// assets/tsuika-index.js — 追加給付の申出先を市区町村名で引く（scripts/tsuika-page.mjs が書く。手で直さない）
(function(){
var P=${JSON.stringify(PREFS)};
var I=${JSON.stringify(IDX)};
function kana(s){return s.replace(/[\\u3041-\\u3096]/g,function(c){return String.fromCharCode(c.charCodeAt(0)+96)})}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
window.tsuikaSearch=function(inp,out,base){
  function run(){
    var q=inp.value.replace(/[\\s　]/g,''),k=kana(q);
    if(!q){out.innerHTML='';return}
    var hit=[],i,x;
    for(i=0;i<I.length;i++){x=I[i];if(x[0].indexOf(q)>=0||(x[1]&&k.length>=2&&x[1].indexOf(k)===0)||P[x[2]-1].indexOf(q)===0&&x[3]==='ken'&&!x[4])hit.push(x)}
    hit.sort(function(a,b){return (a[0].indexOf(q)===0?0:1)-(b[0].indexOf(q)===0?0:1)||a[2]-b[2]});
    if(!hit.length){out.innerHTML='<p class="mini-note">見つかりませんでした。市区町村の名前（例：大阪市・上市町）で探してください。合併で今はない町村は、今の市町村の名前で探してください。</p>';return}
    out.innerHTML='<ul class="srch-res">'+hit.slice(0,12).map(function(x){
      var pn=P[x[2]-1],href=base+(x[2]<10?'0':'')+x[2]+'/#'+x[3];
      return '<li><a href="'+href+'">'+esc(x[3]==='ken'&&!x[4]?pn+'の福祉事務所':x[0])+'</a>（'+esc(pn)+'）'+(x[4]?' → 申出先は<a href="'+href+'">'+esc(pn)+'の福祉事務所</a>':'')+'</li>'}).join('')+'</ul>'+(hit.length>12?'<p class="mini-note">ほかに'+(hit.length-12)+'件。もう少し詳しく入れてください。</p>':'');
  }
  inp.addEventListener('input',run);run();
};
})();
`
const IDX_V = crypto.createHash('sha1').update(SEARCH_JS).digest('hex').slice(0, 8)
const searchBox = (base, rel) => `<div class="srch">
    <label for="tk-q">当時住んでいた市区町村の名前</label>
    <input id="tk-q" type="search" placeholder="例：大阪市、上市町、ねりま" autocomplete="off">
    <div id="tk-qo" aria-live="polite"></div>
  </div>
  <script src="${rel}assets/tsuika-index.js?v=${IDX_V}" defer></script>
  <script>document.addEventListener('DOMContentLoaded',function(){if(window.tsuikaSearch)tsuikaSearch(document.getElementById('tk-q'),document.getElementById('tk-qo'),'${base}')})</script>`
const prefGrid = (base) => REGIONS.map(([rn, s, e]) => `<div class="pg"><span class="pgr">${rn}</span>${PREFS.slice(s, e).map((p) => `<a href="${base}${pc(p)}/">${p.replace(/[都府県]$/, '')}</a>`).join('')}</div>`).join('\n    ')

// ── 共通の枠 ─────────────────────────────────────────────────────────────────────
const CSS = `table.fit{min-width:0;font-size:.86rem}table.fit th,table.fit td{padding:7px 6px}table.fit tbody th{white-space:nowrap}table.fit td.num,table.fit th.num{white-space:normal;word-break:keep-all}.mini-note{font-size:.86rem;color:var(--sub)}
table.fit td.per{white-space:nowrap;text-align:left}table.fit td.tx{text-align:left}table.fit th.num{text-align:left}
.tk-form,.srch{background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:10px 14px;margin:12px 0}
.tk-form .row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:8px 0}
.tk-form .row>label:first-child{flex:1 1 100%;font-size:.92rem;font-weight:600}
.tk-form select,.srch input{font:inherit;font-size:16px;padding:6px 8px;border:1px solid #cfd6e0;border-radius:8px;min-width:0;max-width:100%}
.tk-form fieldset{border:0;padding:0;margin:8px 0}.tk-form legend{font-size:.92rem;font-weight:600;padding:0}
.tk-form .ck{display:block;font-size:.92rem;margin:4px 0}
.srch label{display:block;font-size:.92rem;font-weight:600;margin-bottom:4px}.srch input{width:100%;box-sizing:border-box}
.srch-res{margin:8px 0 0;padding-left:1.2em}.srch-res li{margin:4px 0}
.tk-res{border-left:5px solid #0b6b45;background:#f3faf6;border-radius:10px;padding:10px 14px;margin:10px 0}
.tk-res.no{border-left-color:#8a6d00;background:#fdf8e6}
.tk-big{font-size:1.08rem;margin:0 0 6px}.tk-big strong{font-size:1.3rem;color:#0b6b45}
.tk{border:1px solid #dfe4ec;border-radius:12px;padding:8px 14px 10px;margin:12px 0;background:#fff}
.tk h3{margin:6px 0 8px;font-size:1.05rem}.tk .tg{display:inline-block;font-size:.72rem;font-weight:600;color:#3d4b5c;background:#eef2f7;border-radius:6px;padding:1px 6px;margin-left:8px;vertical-align:middle}
.tk dl{margin:0;display:grid;grid-template-columns:7.5em 1fr;gap:4px 10px;font-size:.92rem}.tk dt{color:var(--sub);font-weight:600}.tk dd{margin:0;overflow-wrap:anywhere}
.tk .nt{font-size:.84rem;color:var(--sub)}.tk .ok{color:#0b6b45;font-weight:700}.tk .ng{color:#6b7380}.tk .dead{color:#8a6d00;font-size:.88rem}
.tk .cov{font-size:.86rem;margin:8px 0 0}
.pg{margin:6px 0;line-height:2}.pg .pgr{display:inline-block;min-width:6.5em;font-size:.84rem;color:var(--sub);font-weight:600}.pg a{display:inline-block;margin:0 10px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.chips a{font-size:.86rem;border:1px solid #dfe4ec;border-radius:999px;padding:2px 10px;text-decoration:none}
@media (max-width:480px){.tk dl{grid-template-columns:1fr}.tk dt{margin-top:4px}}`

function page({ rel, title, desc, url, ogTitle, ogDesc, ld, crumbs, h1, updated, body, script = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${esc(title)}｜フクシル</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:site_name" content="フクシル">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${rel}assets/style.css?v=20260908a">
${ld.map((x) => `<script type="application/ld+json">\n${JSON.stringify(x, null, 1)}\n</script>`).join('\n')}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="${rel}index.html">フクシル <small>知らないと損する、くらしの福祉</small></a>
    <nav class="site-nav" aria-label="主要">
      <a href="${rel}index.html">トップ</a>
      <a href="${rel}articles/seikatsuhogo-keisanki.html">生活保護の計算機</a>
      <a href="${rel}articles/${SLUG}">生活保護の追加給付</a>
      <a href="${rel}articles/juminzei-hikazei-check.html">住民税非課税</a>
      <a href="${rel}articles/koei-jutaku-bairitsu.html">公営住宅</a>
    </nav>
  </div>
</header>

<main id="main">
  <p class="breadcrumb">${crumbs.map(([t, h]) => (h ? `<a href="${h}">${esc(t)}</a>` : esc(t))).join(' ＞ ')}</p>

  <h1>${h1}</h1>
  <p class="updated">最終更新：${TODAY} ／ ${updated}</p>
${body}
</main>

<footer class="site-footer">
  <div class="inner">
    <p><strong>フクシル</strong>— 知らないと損する、くらしの福祉制度を当事者目線でまとめる情報サイトです。</p>
    <p><a href="${rel}index.html">トップへ戻る</a> ／ <a href="${rel}about.html">このサイトについて</a> ／ <a href="${rel}tokushoho/">特定商取引法に基づく表記</a> ／ <a href="${rel}kiyaku/">利用規約</a></p>
    <p>© 2026 フクシル. 本サイトの情報は一般的な参考情報であり、正確性を保証するものではありません。</p>
  </div>
</footer>
${script}<script src="${rel}assets/ev.js?v=20261007a" defer></script>
</body>
</html>
`
}
const articleLd = (headline, description, url) => ({ '@context': 'https://schema.org', '@type': 'Article', headline, description, inLanguage: 'ja', datePublished: PUBLISHED, dateModified: TODAY, author: { '@type': 'Organization', name: 'フクシル' }, publisher: { '@type': 'Organization', name: 'フクシル' }, url, mainEntityOfPage: url, isPartOf: { '@type': 'WebSite', name: 'フクシル', url: `${SITE}/` } })
const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) })

// ── 数字（本文の文と計算機で同じものを使う）─────────────────────────────────────────────
const N = {
  rows: D.rows.length,
  mp: D.rows.filter((r) => r.mynaportal || r.mynaportalBy?.some((x) => x.ok)).length,
  own: D.rows.filter((r) => r.own || r.ownBy?.some((x) => x.ok)).length,
  covered: [...COVERED.values()].reduce((s, l) => s + l.length, 0),
}
const seireki = (w) => w.replace(/令和(\d+)年/, (_, n) => `${2018 + Number(n)}年`)   // 「令和8年7月末」→「2026年7月末」
const statusLine = `生活扶助費の追加給付が決まった世帯は、${seireki(ST.householdsUntil)}までの累計で<strong>${num(ST.households)}世帯</strong>です（${a(SRC.status, '厚生労働省の公表')}・${seireki(ST.asOf)}時点）。原告への特別給付金は${seireki(ST.plaintiffsUntil)}までに${num(ST.plaintiffs)}人。`
const osakaCut = OSAKA.mail.findIndex((x) => /^※/.test(x))
const osakaMail = (osakaCut < 0 ? OSAKA.mail : OSAKA.mail.slice(0, osakaCut)).join(' ')   // 「※」の注記（折り返しの続きの行を含む）は入れない
const osakaAns = `大阪市の郵送先は「${osakaMail}」です。マイナポータルで${OSAKA.mynaportal ? '申し出られます' : 'は申し出られません'}。大阪市独自の電子申出は${OSAKA.own ? 'あります' : 'ありません'}。${OSAKA.mail.some((x) => /宛名ラベル/.test(x)) ? '郵送で使える宛名ラベルが、大阪市生活保護費等追加給付支給事務センターのホームページに載っています。' : ''}（厚生労働省の一覧・${LIST_UPDATED}）`

// ── よくある質問（本文と JSON-LD で同じ文）──────────────────────────────────────────
const FAQ = [
  ['生活保護の追加給付とは何ですか？', '2013年（平成25年）8月から行われた生活扶助基準の引き下げのうち、物価の下落を理由にした部分（デフレ調整）を、最高裁判所が2025年6月27日に違法と判断したことを受けて、国が保護費の差額を追加で支給するものです。引き下げ幅を−4.78%から−2.49%に置き換えた差額が支給されます（令和8年厚生労働省告示第43号）。'],
  ['対象になるのはどんな人ですか？', '2013年8月から2018年9月までの間に生活保護を受けていたことがある世帯は、すべて対象です。2018年10月から2026年3月までの間だけ受けていた世帯も、12月の期末一時扶助が算定されていた場合や、入院・施設への入所、障害者加算などの加算があった場合などは対象です。今は保護を受けていない世帯も対象です。'],
  ['いくらもらえますか？', `当時の年齢・世帯の人数・地域・受けていた期間・加算によって変わります。2013年8月から2026年3月までずっと受けていた場合の国の例は、${EX.single.label}で約${EX.single.k11.total}万円（都市部の1級地-1）・約${EX.single.k32.total}万円（地方部の3級地-2）、${EX.family.label}で約${EX.family.k11.total}万円・約${EX.family.k32.total}万円です（加算を含まない額）。`],
  ['今も生活保護を受けています。手続きは必要ですか？', '原則として必要ありません。今保護を受けている自治体が、準備ができたところから順に支給しています（2026年3月から）。ただし、2013年8月以降に別の自治体で保護を受けていた期間がある場合は、その期間の分は当時の自治体に申し出る必要があります。'],
  ['今は生活保護を受けていません。どこに申し出ればいいですか？', '当時保護を受けていた自治体（福祉事務所）に、当時の世帯主が申し出ます。今住んでいる自治体ではありません。町村に住んでいた場合は、その町村が福祉事務所を持っていなければ、都道府県の福祉事務所が窓口です。'],
  ['申出の期限はいつですか？', '2026年（令和8年）8月1日から2027年（令和9年）7月31日までです。多くの自治体では、窓口での受付は開庁日（平日）です。'],
  ['大阪市で生活保護を受けていました。どこに申し出ればいいですか？', osakaAns],
  ['当時の世帯主が亡くなっています。申し出られますか？', '当時の世帯主に準ずる人が申し出ます。順番は、①配偶者（事実婚を含む）②子③父母④孫⑤祖父母⑥兄弟姉妹⑦曾孫⑧甥・姪です。亡くなった人の分は支給されません（遺族が代わりに受け取ることはできません）。当時の世帯員のうち、今も生きている人の分が支給されます。'],
  ['追加給付は収入として認定されますか？', '今も生活保護を受けている人の場合、収入として認定されません（追加給付を受け取っても保護費は減りません）。ただし、持つことが認められていない物を買うことなどは認められません。'],
  ['外国人も対象ですか？', '対象です。外国人への保護と同じく、行政措置として追加給付が行われます（厚生労働省の通知）。申し出るときは、戸籍謄本の代わりに全世帯員の住民票の写しを付けます。'],
  ['追加給付相談センターの電話番号は？', `${TEL}（無料）です。平日9時〜17時で、8月〜10月は土日祝日も受け付けています。相談センターは一人ひとりの受給記録を持っていないため、具体的な額は答えられませんが、似た世帯の例は教えてもらえます。申出書を郵送してもらうこともできます。`],
  ['「いのちのとりで裁判」とは何ですか？', '2013年からの生活保護基準の引き下げの取り消しを求めて、全国各地で起こされた裁判の呼び名です。2025年6月27日の最高裁判決は、このうち大阪と名古屋の裁判についての判決で、原告の保護費を引き下げた決定を取り消しました。追加給付は、原告かどうかを区別せずに支給されます（原告には特別給付金が上乗せされます）。'],
]

// ── 本文の記事 ─────────────────────────────────────────────────────────────────────
const yrOpts = (from, to, sel) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((y) => `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`).join('')
const moOpts = (sel) => Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}"${m === sel ? ' selected' : ''}>${m}</option>`).join('')
const PLBL = ['2013年8月〜2014年3月（8か月）', '2014年4月〜2015年3月（12か月）', '2015年4月〜2018年9月（42か月）', '2018年10月〜2026年3月（90か月）']
const exTable = (k, cap) => `<div class="table-wrap"><table class="fit">
    <caption>${cap}（単位：万円）</caption>
    <thead><tr><th>期間</th><th class="num">${EX.single.label}</th><th class="num">${EX.family.label}</th></tr></thead>
    <tbody>
      ${PLBL.map((l, i) => `<tr><th style="white-space:normal">${l}</th><td class="num">${EX.single[k].p[i].toFixed(1)}</td><td class="num">${EX.family[k].p[i].toFixed(1)}</td></tr>`).join('\n      ')}
      <tr><th>合計</th><td class="num"><strong>${EX.single[k].total.toFixed(1)}</strong></td><td class="num"><strong>${EX.family[k].total.toFixed(1)}</strong></td></tr>
    </tbody>
  </table></div>`
const EST_JS = `(function(){
  var EX=${JSON.stringify(EXS)},P=${JSON.stringify(PER)},LEN=[8,12,42,${DECS4}],LBL=${JSON.stringify({ single: EX.single.label, family: EX.family.label })};
  function $(id){return document.getElementById(id)}
  function ym(y,m){return y*12+m-1}
  function ov(s,e,a,b){var lo=Math.max(s,a),hi=Math.min(e,b);return hi>=lo?hi-lo+1:0}
  function decs(s,e){var c=0,t;for(t=Math.max(s,P[3][0]);t<=Math.min(e,P[3][1]);t++)if(t%12===11)c++;return c}
  function fmt(man){return man<0.05?'1,000円未満':'約'+(Math.round(man*10)/10).toFixed(1)+'万円'}
  function calc(){
    var out=$('tk-out'),now=$('tk-now').checked;
    $('tk-ty').disabled=$('tk-tm').disabled=now;
    var s=ym(+$('tk-fy').value,+$('tk-fm').value),e=now?P[3][1]:ym(+$('tk-ty').value,+$('tk-tm').value);
    if(e<s){out.innerHTML='<div class="tk-res no"><p>受け終わった月が、受けはじめた月より前になっています。</p></div>';return}
    var o=[ov(s,e,P[0][0],P[0][1]),ov(s,e,P[1][0],P[1][1]),ov(s,e,P[2][0],P[2][1])],d=decs(s,e),in4=ov(s,e,P[3][0],P[3][1]);
    var extra=$('tk-kasan').checked||$('tk-nyuin').checked||$('tk-mise').checked,hh=$('tk-hh').value,st=$('tk-st').value;
    var h='';
    if(o[0]+o[1]+o[2]+in4===0){out.innerHTML='<div class="tk-res no"><p class="tk-big">対象になりません</p><p>2013年8月〜2026年3月に保護を受けていた月がないためです。</p></div>';return}
    if(o[0]+o[1]+o[2]===0&&d===0&&!extra){out.innerHTML='<div class="tk-res no"><p class="tk-big">対象にならない見込みです</p><p>2018年10月以降は、自宅で暮らす人の生活費（第1類・第2類）は対象外で、12月の期末一時扶助、1か月を超える入院・施設への入所、加算などの分だけが対象です。選んだ期間には12月が入っていません。入院・施設・加算があった場合は、上で選び直してください。</p></div>';return}
    function est(k){var v=EX[hh][k],x=0,i;for(i=0;i<3;i++)x+=v[i]*o[i]/LEN[i];return x+v[3]*d/LEN[3]}
    var lo=est('k32'),hi=est('k11');
    if(hi<0.05){var why=[];if(d>0)why.push('12月の期末一時扶助');if(extra)why.push('加算・入院や施設');
      h+='<div class="tk-res"><p class="tk-big">対象です（'+why.join('と')+'の分）</p><p class="mini-note">'+(d>0?'2018年10月以降は、自宅で暮らす人は12月の期末一時扶助だけが対象で、12月1回あたり数百円です。':'')+(extra?'国の例には加算・入院や施設の分が入っていないため、目安の額は出せません。当時の月額に2.4%（2014年3月までは0.8%、2015年3月までは1.6%）をかけた額です。たとえば加算が月2万円なら、1か月あたり480円です。':'')+'</p>'}
    else{var ls=fmt(lo),hs=fmt(hi);h+='<div class="tk-res"><p class="tk-big">対象です。目安は <strong>'+(ls===hs?ls:ls+'〜'+hs.replace('約',''))+'</strong></p>';
    h+='<p class="mini-note">'+LBL[hh]+'が自宅で暮らしていた場合の国の例（地方部の3級地-2〜都市部の1級地-1）を、受けていた月数（2018年10月以降は12月の数）で割り戻した目安です。年齢・人数・地域で額は変わります。'+(extra?'<strong>加算・入院や施設の分は入っていないので、実際はこれより多くなります。</strong>':'加算・入院や施設の分は入っていません。')+'</p>';}
    if(st==='kanai')h+='<p><strong>手続き：申出が必要です。</strong>当時保護を受けていた自治体に、当時の世帯主が<strong>2027年7月31日まで</strong>に申し出てください（<a href="#moushidesaki">申出先を調べる</a>）。</p>';
    else if(st==='same')h+='<p><strong>手続き：原則いりません。</strong>今の自治体が、準備ができたところから順に支給しています。</p>';
    else h+='<p><strong>手続き：</strong>今の自治体の分は手続きなしで支給されます。当時の自治体の分は、<strong>2027年7月31日まで</strong>にその自治体へ申し出てください（<a href="#moushidesaki">申出先を調べる</a>）。</p>';
    out.innerHTML=h+'</div>';
  }
  function start(){['tk-fy','tk-fm','tk-ty','tk-tm','tk-now','tk-hh','tk-kasan','tk-nyuin','tk-mise','tk-st'].forEach(function(id){$(id).addEventListener('change',calc)});calc()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();`

const TITLE = '生活保護の追加給付とは？対象・いくら・申出先と期限（2027年7月31日まで）'
const DESC = `2013年8月〜2026年3月に生活保護を受けていた世帯に、最高裁判決を踏まえて保護費の差額が追加で支給されています。対象・金額の目安（60歳代のひとり暮らしで約${EX.single.k11.total}万円）・申出のしかた（2026年8月1日〜2027年7月31日）・必要な書類と、全国${N.rows}か所の申出先を、厚生労働省の通知と一覧からまとめました。相談センター${TEL}。`
const artBody = `
  <p class="lead">2013年（平成25年）8月から2026年（令和8年）3月までに生活保護を受けていた世帯に、国が保護費の<strong>差額を追加で支給</strong>しています。2013年から行われた生活扶助（毎月の生活費の部分）の引き下げの一部を、最高裁判所が2025年6月に違法と判断したためです。<strong>今も保護を受けている世帯は手続きなし</strong>で順に支給され、<strong>今は受けていない世帯は、当時の世帯主が当時の自治体に申し出る</strong>と支給されます。申出は<strong>2027年（令和9年）7月31日まで</strong>です。</p>

  <div class="callout point">
    <p><span class="tag">まず結論</span><strong>対象</strong>：2013年8月〜2018年9月に保護を受けていた月がある世帯は<strong>すべて</strong>。2018年10月〜2026年3月だけの世帯も、12月の期末一時扶助・入院や施設への入所・障害者加算などがあれば対象です。今は保護を受けていない世帯も対象です。</p>
    <p><strong>金額</strong>：ずっと受けていた場合の国の例は、${EX.single.label}で<strong>約${EX.single.k11.total}万円</strong>（都市部）・約${EX.single.k32.total}万円（地方部）。受けていた期間・人数・地域・加算で変わります。</p>
    <p><strong>手続き</strong>：今も受けている → 原則いりません（別の自治体で受けていた期間があれば、その自治体に申出）。今は受けていない → 当時の世帯主が、当時の自治体に申出（<strong>2026年8月1日〜2027年7月31日</strong>）。</p>
    <p><strong>相談</strong>：追加給付相談センター <strong>${TEL}</strong>（無料・平日9〜17時。8〜10月は土日祝も）。</p>
    <p><strong>詐欺に注意</strong>：厚生労働省や自治体が、電話で口座番号などを聞くことはありません。</p>
  </div>
  <p class="mini-note">${statusLine}</p>

  <h2>① 追加給付とは（なぜ支給されるのか）</h2>
  <p>2013年8月から3年かけて、生活扶助の基準が引き下げられました。理由は2つで、物価が下がった分を反映する<strong>「デフレ調整」（−4.78%）</strong>と、年齢・人数・地域ごとの差を直す<strong>「ゆがみ調整」</strong>です。</p>
  <p>この引き下げの取り消しを求めて全国で裁判が起こされ、最高裁判所は<strong>2025年6月27日</strong>、大阪と名古屋の裁判で、デフレ調整について「厚生労働大臣の判断の過程及び手続には過誤、欠落があった」として違法と判断しました。原告の保護費を引き下げた決定は取り消されました（国への損害賠償の請求は退けられました。ゆがみ調整は違法とされていません）。</p>
  <p>国は専門家の委員会の報告書を踏まえて、<strong>原告かどうかを区別せず</strong>、引き下げ幅を「−4.78%」から、当時の消費の実態にもとづく「<strong>−2.49%</strong>」に置き換えた差額を、対象の全員に追加で支給することにしました。原告には、引き下げをしなかった水準（−0%）との差額が、特別給付金として上乗せされます。</p>
  <div class="table-wrap"><table class="fit">
    <caption>これまでの経緯（厚生労働省の公表資料から）</caption>
    <thead><tr><th>時期</th><th class="num">できごと</th></tr></thead>
    <tbody>
      <tr><th>2013年8月</th><td class="tx">生活扶助基準の引き下げ（2015年4月まで3段階）</td></tr>
      <tr><th>2025年6月27日</th><td class="tx">最高裁判決（デフレ調整は違法）</td></tr>
      <tr><th>2025年11月21日</th><td class="tx">国の方針（−2.49%の水準で一律に追加給付）</td></tr>
      <tr><th>2025年12月16日</th><td class="tx">補正予算が成立（1,475億円。うち追加給付1,055億円）</td></tr>
      <tr><th>2026年2月20日</th><td class="tx">告示（令和8年厚生労働省告示第43号）。3月1日から適用</td></tr>
      <tr><th>2026年3月〜</th><td class="tx">今も受けている世帯へ、自治体の準備ができたところから支給</td></tr>
      <tr><th>2026年3月30日</th><td class="tx">追加給付相談センターを開設</td></tr>
      <tr><th>2026年8月1日</th><td class="tx">今は受けていない世帯の申出の受付が始まる</td></tr>
      <tr><th>2027年7月31日</th><td class="tx">申出の締め切り</td></tr>
    </tbody>
  </table></div>

  <h2>② 対象になる人</h2>
  <p>2013年8月から2026年3月までに、生活保護の<strong>基準生活費</strong>（毎月の生活費）、<strong>入院患者日用品費</strong>、<strong>介護施設入所者基本生活費</strong>のどれかが算定されていた人です。<strong>今は保護を受けていない人</strong>（保護が廃止された人）や、保護が停止中の人も含みます。ただし、追加給付の対象になる費目と期間は、次のように決まっています。</p>
  <div class="table-wrap"><table class="fit">
    <caption>追加給付の対象になる費目と期間（厚生労働省「追加給付額の例・対象期間」）</caption>
    <thead><tr><th>費目</th><th class="num">対象の期間</th></tr></thead>
    <tbody>
      <tr><th style="white-space:normal">自宅で暮らす人の生活費（第1類・第2類）</th><td class="per">2013年8月〜<br>2018年9月</td></tr>
      <tr><th style="white-space:normal">冬季加算（自宅・救護施設など）</th><td class="per">2013年8月〜<br>2015年9月</td></tr>
      <tr><th style="white-space:normal">母子加算（自宅で暮らす人）</th><td class="per">2013年8月〜<br>2018年9月</td></tr>
      <tr><th style="white-space:normal">入院患者日用品費、救護施設などの基準額、介護施設入所者基本生活費</th><td class="per">2013年8月〜<br>2026年3月</td></tr>
      <tr><th style="white-space:normal">期末一時扶助（毎年12月）</th><td class="per">2013年12月〜<br>2025年12月</td></tr>
      <tr><th style="white-space:normal">妊産婦加算、障害者加算（重度障害者加算・家族介護料・他人介護料を除く）、介護施設入所者加算、在宅患者加算、放射線障害者加算（2013年10月から）</th><td class="per">2013年8月〜<br>2026年3月</td></tr>
      <tr><th style="white-space:normal">母子加算（入院・入所している人）、冬季加算（入院・介護施設）</th><td class="per">2013年8月〜<br>2026年3月</td></tr>
      <tr><th style="white-space:normal">未成年者控除（20歳未満控除）</th><td class="per">2013年8月〜<br>2026年3月</td></tr>
    </tbody>
  </table></div>
  <p class="mini-note">費目ごとに、2013年の引き下げの影響が残っていた期間だけが対象です（生活費の基準額は2018年10月の改定で見直されたため、2018年9月まで）。</p>
  <ul>
    <li><strong>働いた収入などがあって、生活扶助費が支給されていなかった（一部だけだった）月も対象です</strong>（相談センターの「よくあるご質問」）。</li>
    <li><strong>亡くなった人は対象になりません。</strong>世帯の中に亡くなった人がいる場合は、その人の分を除いて計算します。遺族が亡くなった人の分を受け取ることはできません。</li>
    <li>大学に通うためなどで<strong>世帯分離</strong>されていた期間は除きます。</li>
    <li><strong>外国人</strong>も、行政措置として同じように対象です。</li>
    <li>2013年の引き下げのうち「ゆがみ調整」の分は、判決で違法とされていないため対象外です。</li>
  </ul>

  <h2>③ いくらもらえる？</h2>
  <p>当時の保護の基準で算定されていた額に、次の<strong>追加給付率</strong>をかけた額です。毎月、費目ごとにかけて、<strong>10円未満は10円に切り上げ</strong>、それを合計します（各月1日時点の額で計算。保護が始まった月・終わった月は日割り）。</p>
  <div class="table-wrap"><table class="fit">
    <caption>追加給付率（厚生労働省の通知）</caption>
    <thead><tr><th>期間</th><th class="num">追加給付率</th></tr></thead>
    <tbody>
      <tr><th>2013年8月〜2014年3月</th><td class="num">+0.8%</td></tr>
      <tr><th>2014年4月〜2015年3月</th><td class="num">+1.6%</td></tr>
      <tr><th>2015年4月〜2026年3月</th><td class="num">+2.4%</td></tr>
      <tr><th style="white-space:normal">期末一時扶助（2013年12月〜2025年12月）</th><td class="num">+2.4%</td></tr>
    </tbody>
  </table></div>
  <p class="mini-note">2.4%は、−4.78%で下がった額を−2.49%で下がった額に戻すための率です（1÷(1−0.0478)×(1−0.0249)−1≒2.4%）。2013年の引き下げは3年かけて1/3ずつ行われたため、最初の2年は0.8%・1.6%です。たとえば加算が月2万円だった月は、2万円×2.4%＝480円が追加になります。</p>
  <h3>国が公表している例（2013年8月〜2026年3月にずっと自宅で受けていた場合・単位は万円）</h3>
  ${exTable('k11', '都市部（1級地-1）の例')}
  ${exTable('k32', '地方部（3級地-2）の例')}
  <p class="mini-note">出典：${a(SRC.rei)}。期間ごとの数字は端数を丸めているため、合計と一致しません。加算は算定しておらず、2018年10月以降は12月の期末一時扶助だけを計上した額です。加算があった人や、2018年10月以降に入院・施設・加算があった人は、これより多くなります。受けていた期間が一部だけなら、その月数の分だけ支給されます。</p>

  <h3>自分の場合の目安を計算する</h3>
  <p>受けていた期間を入れると、国の例から割り戻した目安と、手続きが要るかどうかがわかります。同じ自治体で何回かに分けて受けていた場合は、期間ごとに計算してください（申出も期間ごとに必要です）。</p>
  <div class="tk-form">
    <div class="row"><label>受けはじめた月（2013年8月より前から受けていた人は「2013年8月」）</label><select id="tk-fy" aria-label="受けはじめた年">${yrOpts(2013, 2026, 2013)}</select>年<select id="tk-fm" aria-label="受けはじめた月">${moOpts(8)}</select>月</div>
    <div class="row"><label>受け終わった月</label><select id="tk-ty" aria-label="受け終わった年">${yrOpts(2013, 2026, 2026)}</select>年<select id="tk-tm" aria-label="受け終わった月">${moOpts(3)}</select>月 <label class="ck" style="display:inline"><input type="checkbox" id="tk-now"> 今も受けている</label></div>
    <div class="row"><label for="tk-hh">世帯（国の例のうち近いほう）</label><select id="tk-hh"><option value="single">ひとり暮らし</option><option value="family">夫婦と子ども1人（3人）</option></select></div>
    <fieldset><legend>当てはまるもの（2018年10月以降も対象になるもの）</legend>
      <label class="ck"><input type="checkbox" id="tk-kasan"> 障害者加算・母子加算などの加算があった</label>
      <label class="ck"><input type="checkbox" id="tk-nyuin"> 1か月を超えて入院していた・施設に入っていた</label>
      <label class="ck"><input type="checkbox" id="tk-mise"> 20歳未満で働いて収入があった（未成年者控除）</label>
    </fieldset>
    <div class="row"><label for="tk-st">今の状況</label><select id="tk-st"><option value="kanai">今は生活保護を受けていない</option><option value="same">今も同じ自治体で受けている</option><option value="other">今も受けているが、当時は別の自治体だった</option></select></div>
  </div>
  <div id="tk-out" aria-live="polite"><noscript><p class="mini-note">計算は JavaScript を使います。上の国の例で確かめてください。</p></noscript></div>
  <p class="mini-note">実際の額は、自治体が当時の記録（または申出書と添付の書類）から計算します。相談センターも一人ひとりの額は答えられません。</p>

  <h2>④ 申出のしかた</h2>
  <h3>今も生活保護を受けている世帯</h3>
  <p><strong>原則として手続きはいりません。</strong>今保護を受けている自治体が、準備ができたところから順に支給しています。支給が決まると「保護追加給付決定通知書」が届きます（決定に不服があるときは、知った日の翌日から3か月以内に都道府県知事へ審査請求ができると、通知書の様式に書かれています）。<strong>2013年8月以降に別の自治体で保護を受けていた期間がある場合は、その期間の分を当時の自治体に申し出ます。</strong>たとえば今はA市、2013年8月にはB市、その後C市で受けていた場合、A市からは手続きなしで、B市・C市には申出をすると、それぞれから支給されます。</p>
  <h3>今は生活保護を受けていない世帯</h3>
  <ul>
    <li><strong>だれが</strong>：当時の世帯主（世帯主が何人かいた場合は、保護が廃止されたときの世帯主）。亡くなっている場合は、準ずる人（①配偶者〈事実婚を含む〉②子③父母④孫⑤祖父母⑥兄弟姉妹⑦曾孫⑧甥・姪の順）。</li>
    <li><strong>どこへ</strong>：<strong>当時保護を受けていた自治体</strong>（福祉事務所）。今住んでいる所ではありません。町村は、その町村が福祉事務所を持っていなければ都道府県の福祉事務所です。→ <a href="#moushidesaki">申出先を調べる</a></li>
    <li><strong>いつまで</strong>：<strong>2026年8月1日〜2027年7月31日</strong>。多くの自治体では、窓口の受付は開庁日（平日）です。</li>
    <li><strong>どうやって</strong>：郵送・電子申出・窓口のどれか（自治体によって違います）。電子申出は、マイナポータルでできる自治体が${N.mp}か所、自治体独自の申込みページがある自治体が${N.own}か所です（全国${N.rows}か所のうち）。</li>
    <li><strong>申出書</strong>：<a href="${FORM}" rel="nofollow">厚生労働省の標準様式（PDF）</a>。当時の自治体のホームページに様式があれば、そちらを使います。窓口でももらえ、相談センターに頼めば郵送してもらえます。</li>
    <li><strong>同じ自治体で何回か受けていた</strong>：期間ごとに申出が必要です。</li>
  </ul>
  <h3>付ける書類</h3>
  <p><strong>必ず付けるもの</strong></p>
  <ul>
    <li>申出者の<strong>本人確認書類の写し</strong>（1点）：マイナンバーカード（表面）、運転免許証、在留カード、障害者手帳、パスポートなど</li>
    <li><strong>全世帯員の戸籍謄本の写し</strong>（全部事項証明書）：原則、発行から3か月以内。今も保護を受けている人は「保護受給証明書」でも可。当時と名字が違う人は、当時の名字が載った戸籍謄本も。離婚などで当時の世帯員が戸籍から抜けている場合は、その人の今の戸籍謄本を「第三者請求」で取れます。</li>
    <li><strong>外国人の場合</strong>：全世帯員の住民票の写し（原則3か月以内・保護受給証明書でも可）</li>
    <li>振込先の<strong>口座がわかる通帳かキャッシュカードの写し</strong>（申出者本人の名義の口座に限ります）</li>
    <li><strong>同意書</strong>（追加給付に必要な調査への同意。標準様式に入っています）</li>
  </ul>
  <p><strong>必要に応じて付けるもの</strong></p>
  <ul>
    <li>加算の証明：障害者加算なら身体障害者手帳・国民年金証書など、母子加算なら児童扶養手当の証書など（なくても申出はできますが、加算が計算されないことがあります）</li>
    <li>当時の住所が書けない場合：戸籍の附票の写し</li>
    <li>代理人が申し出る場合：<a href="${ININ}" rel="nofollow">委任状</a>（法定代理人は不要）・代理人の本人確認書類・本人との関係がわかる書類</li>
  </ul>
  <p class="mini-note"><strong>戸籍謄本（外国人は住民票）が要らない場合</strong>：マイナポータルなどの電子申請で確認ができて、対象の期間ずっとひとり暮らしだった場合／対象になる全員が窓口に行って本人確認ができた場合。</p>
  <p class="mini-note">うその申出で支給を受けると、刑法で処罰されることがあります（申出書の留意事項）。</p>

  <h2>⑤ 受け取ったあとのこと</h2>
  <ul>
    <li><strong>今も保護を受けている人</strong>：追加給付は<strong>収入として認定されません</strong>（保護費は減りません）。保護費として支給されるので、税金はかからず、差し押さえもできません（生活保護法 第57条・第58条）。ただし、持つことが認められていない物を買うことなどは認められません。</li>
    <li><strong>今は保護を受けていない人</strong>：受け取っても、生活保護を受けている人の扱いにはなりません（住民税の「生活扶助を受けている者」にも当たりません）。</li>
    <li><strong>ほかの制度への影響</strong>：生活扶助の基準を参考にしている国の制度（就学援助、介護保険料の段階、国民健康保険の一部負担金の減免など47制度）は、追加給付のために特に扱いを変えない方針です。中国残留邦人等への支援給付など、生活保護と同じ給付をしている3つの制度は、同じように追加給付が行われます。</li>
  </ul>

  <h2 id="moushidesaki">⑥ 申出先を調べる（全国${N.rows}か所）</h2>
  <p>当時住んでいた市区町村の名前を入れてください。郵送先、マイナポータルや電子申出ができるか、案内ページがわかります（${a(SRC.list, `厚生労働省の一覧・${LIST_UPDATED}`)}）。町村の名前を入れると、その町村が自前の窓口を持っていない場合は都道府県の福祉事務所が出ます。</p>
  ${searchBox('../tsuika/', '../')}
  <p>都道府県から探す（<a href="../tsuika/">申出先の全国一覧</a>）：</p>
  <div class="pgs">
    ${prefGrid('../tsuika/')}
  </div>

  <h2>よくある質問</h2>
  ${FAQ.map(([q, ans]) => `<h3>${esc(q)}</h3>\n  <p>${esc(ans)}</p>`).join('\n  ')}

  <div class="callout note">
    <p><span class="tag">あわせて読みたい</span>今の保護費の額は<a href="seikatsuhogo-keisanki.html">生活保護の支給額シミュレーター</a>（令和8年10月からの基準）。申請が通るかどうかの目安は<a href="seikatsuhogo-shinsei-jichitai.html">自治体別の却下率</a>。物価と電気代で割り戻した<a href="seikatsuhogo-jisshitsu.html">生活保護費の実質の比較</a>もどうぞ。</p>
  </div>

  <h2>出典</h2>
  <ul class="sources">
    ${Object.values(SRC).map((s) => `<li>${esc(s.name)} ${esc(s.url)}</li>`).join('\n    ')}
  </ul>

  <div class="disclaimer">
    <strong>ご注意：</strong>このページは厚生労働省の通知・告示・公表資料をまとめたもので、一人ひとりが対象になるか、いくら支給されるかを決めるものではありません。金額の目安は国が公表した例から割り戻したもので、実際の額は自治体が計算します。申出先や受付の方法は変わることがあるので、当時の自治体の案内か相談センター（${TEL}）で確かめてください。
  </div>`

const artHtml = page({
  rel: '../', title: TITLE, desc: DESC, url: ART_URL,
  ogTitle: '生活保護の追加給付｜対象・いくら・申出先（2027年7月31日まで）',
  ogDesc: `2013年8月〜2026年3月に保護を受けていた世帯へ、保護費の差額を追加支給。60歳代単身で約${EX.single.k11.total}万円の例。全国${N.rows}か所の申出先も。`,
  ld: [articleLd(TITLE, DESC, ART_URL), { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })) }],
  crumbs: [['トップ', '../index.html'], ['生活保護', 'seikatsuhogo-keisanki.html'], ['追加給付', null]],
  h1: '生活保護の追加給付<br>だれが・いくら・どう申し出る？',
  updated: `厚生労働省の通知・告示・申出手続のページの原文で確かめた内容です。申出先は厚生労働省の一覧（${LIST_UPDATED}）から`,
  body: artBody,
  script: `<script>${EST_JS}</script>\n`,
})

// ── 申出先の全国一覧（tsuika/index.html）──────────────────────────────────────────────
const cnt = (pref) => D.rows.filter((r) => r.pref === pref).length
const HUB_TITLE = '生活保護の追加給付 申出先一覧（全国の市区町村・都道府県別）【郵送先・電子申出】'
const HUB_DESC = `生活保護の追加給付を申し出る先（全国${N.rows}か所）を、都道府県・市区町村の名前から引けます。郵送先、マイナポータルや自治体の電子申出ができるか、案内ページを、厚生労働省の一覧（${LIST_UPDATED}）からまとめました。申出先は「当時保護を受けていた自治体」で、申出は2027年7月31日まで。`
const hubHtml = page({
  rel: '../', title: HUB_TITLE, desc: HUB_DESC, url: HUB_URL,
  ogTitle: '生活保護の追加給付 申出先一覧（全国・都道府県別）', ogDesc: `全国${N.rows}か所の郵送先・電子申出・案内ページ。市区町村の名前から引けます。`,
  ld: [articleLd(HUB_TITLE, HUB_DESC, HUB_URL), crumbLd([['トップ', `${SITE}/`], ['生活保護の追加給付', ART_URL], ['申出先一覧', HUB_URL]])],
  crumbs: [['トップ', '../index.html'], ['生活保護の追加給付', `../articles/${SLUG}`], ['申出先一覧', null]],
  h1: '追加給付の<br>申出先を調べる',
  updated: `厚生労働省「自治体ごとの申出受付方法一覧」（${LIST_UPDATED}）を${D.fetchedAt}に読み取りました`,
  body: `
  <p class="lead">生活保護の追加給付を<strong>今は保護を受けていない世帯</strong>が申し出る先です。<strong>申出先は、今住んでいる所ではなく、当時保護を受けていた自治体</strong>（福祉事務所）です。申出は当時の世帯主から、<strong>2027年7月31日まで</strong>。今も保護を受けている世帯は、原則として手続きはいりません（<a href="../articles/${SLUG}">追加給付のくわしい説明</a>）。</p>
  ${searchBox('', '../')}
  <h2>都道府県から探す</h2>
  <div class="pgs">
    ${REGIONS.map(([rn, s, e]) => `<div class="pg"><span class="pgr">${rn}</span>${PREFS.slice(s, e).map((p) => `<a href="${pc(p)}/">${p}（${cnt(p)}）</a>`).join('')}</div>`).join('\n    ')}
  </div>
  <p class="mini-note">かっこの中は申出先の数（都道府県の福祉事務所を含む）。</p>
  <h2>一覧の見方</h2>
  <ul>
    <li><strong>市と特別区</strong>は、それぞれが申出先です。指定都市・中核市も、その市が申出先です。</li>
    <li><strong>町村</strong>は、自前の福祉事務所を持つ町村（全国で${D.rows.filter((r) => /[町村]$/.test(r.name) && r.name !== r.pref).length}）を除いて、<strong>都道府県の福祉事務所</strong>が申出先です（全国で${N.covered}町村）。各都道府県のページの最後に、県が窓口の町村を並べています。島根県と広島県は、すべての町村が自前の窓口を持っています。</li>
    <li><strong>郵送先</strong>は厚生労働省の一覧の文面のままです（半角カナだけ全角にしています）。郵便局留めの所（大阪市・福岡県・さいたま市など）や、時期によって宛先が変わる所（所沢市）があります。</li>
    <li><strong>電子申出</strong>：マイナポータルで申し出られるのは${N.mp}か所、自治体独自の申込みページがあるのは${N.own}か所です。</li>
    <li>一覧に載っている URL は${LC.checkedAt ? `${LC.checkedAt.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')}に${LC.checked}本を確かめ、開けなかった${LC.bad.length}本はリンクにせず、そう書いています` : 'まだ確かめていません'}。</li>
  </ul>
  <div class="callout note">
    <p><span class="tag">相談</span>追加給付相談センター <strong>${TEL}</strong>（無料・平日9〜17時。8〜10月は土日祝も）。申出書（<a href="${FORM}" rel="nofollow">標準様式のPDF</a>）の郵送も頼めます。<strong>厚生労働省や自治体が、電話で口座番号などを聞くことはありません。</strong></p>
  </div>
  <h2>出典</h2>
  <ul class="sources">
    <li>${esc(SRC.list.name)} ${esc(SRC.list.url)}</li>
    <li>${esc(SRC.moushide.name)} ${esc(SRC.moushide.url)}</li>
    <li>総務省 全国地方公共団体コード（町村と都道府県の対応）https://www.soumu.go.jp/denshijiti/code.html</li>
  </ul>`,
})

// ── 都道府県別のページ（tsuika/<NN>/index.html）────────────────────────────────────────
function prefPage(pref) {
  const rows = D.rows.filter((r) => r.pref === pref)
  const own = rows.filter((r) => r.name !== pref).sort((x, y) => x.code.localeCompare(y.code))
  const prefRow = rows.find((r) => r.name === pref)
  const ents = prefRow ? [...own, prefRow] : own
  const url = prefUrl(pref)
  const big = pref === '東京都' ? '23区・多摩・島しょ' : `${own[0].name}・${own[1].name}ほか`
  const title = `${pref}（${big}）の生活保護 追加給付 申出先一覧【郵送先・電子申出】`
  const cov = COVERED.get(pref)
  const desc = `${pref}で2013年8月〜2026年3月に生活保護を受けていた世帯の、追加給付の申出先（${ents.length}か所）。市区町村ごとの郵送先、マイナポータル・電子申出ができるか、案内ページを厚生労働省の一覧（${LIST_UPDATED}）からまとめました。${cov.length ? `町村は${pref}の福祉事務所が窓口の所があります。` : 'すべての町村が自前の窓口を持っています。'}申出は2027年7月31日まで。`
  const mp = ents.filter((r) => r.mynaportal || r.mynaportalBy?.some((x) => x.ok)).length
  const ow = ents.filter((r) => r.own || r.ownBy?.some((x) => x.ok)).length
  const i = PREFS.indexOf(pref)
  const nav = [i > 0 ? `<a href="../${pc(PREFS[i - 1])}/">← ${PREFS[i - 1]}</a>` : '', i < 46 ? `<a href="../${pc(PREFS[i + 1])}/">${PREFS[i + 1]} →</a>` : ''].filter(Boolean).join(' ／ ')
  return page({
    rel: '../../', title, desc, url,
    ogTitle: `${pref}の生活保護 追加給付 申出先一覧`, ogDesc: `${pref}の申出先${ents.length}か所の郵送先・電子申出・案内ページ（厚生労働省の一覧から）。`,
    ld: [articleLd(title, desc, url), crumbLd([['トップ', `${SITE}/`], ['生活保護の追加給付', ART_URL], ['申出先一覧', HUB_URL], [pref, url]])],
    crumbs: [['トップ', '../../index.html'], ['生活保護の追加給付', `../../articles/${SLUG}`], ['申出先一覧', '../'], [pref, null]],
    h1: `${pref}の<br>追加給付の申出先`,
    updated: `厚生労働省「自治体ごとの申出受付方法一覧」（${LIST_UPDATED}）を${D.fetchedAt}に読み取りました`,
    body: `
  <p class="lead">${pref}内で生活保護を受けていた世帯の、追加給付の申出先です。<strong>申出先は、今住んでいる所ではなく、当時保護を受けていた市区町村</strong>${cov.length ? `（町村は、その町村が福祉事務所を持っていなければ${pref}の福祉事務所）` : ''}です。今は保護を受けていない世帯が、当時の世帯主から<strong>2027年7月31日まで</strong>に申し出ます。今も保護を受けている世帯は、原則として手続きはいりません。</p>
  <p class="mini-note">${pref}の申出先 ${ents.length}か所・マイナポータルで申し出られる ${mp}か所・独自の電子申出がある ${ow}か所。対象・金額・付ける書類は<a href="../../articles/${SLUG}">追加給付のくわしい説明</a>へ。</p>
  <nav class="chips" aria-label="${pref}の申出先">${ents.map((r) => `<a href="#${r.name === pref ? 'ken' : `m${r.code}`}">${esc(r.name === pref ? `${pref}（町村）` : r.name)}</a>`).join('')}</nav>
  ${ents.map(entityHtml).join('\n  ')}
  <div class="callout note">
    <p><span class="tag">申し出る前に</span>申出書は<a href="${FORM}" rel="nofollow">厚生労働省の標準様式（PDF）</a>か、当時の自治体の様式を使います。本人確認書類・全世帯員の戸籍謄本・口座がわかる通帳の写しなどを付けます（<a href="../../articles/${SLUG}">付ける書類の一覧</a>）。わからないことは追加給付相談センター <strong>${TEL}</strong>（無料・平日9〜17時。8〜10月は土日祝も）へ。<strong>厚生労働省や自治体が、電話で口座番号などを聞くことはありません。</strong></p>
  </div>
  <p class="mini-note">郵送先は厚生労働省の一覧の文面のままです（半角カナだけ全角にしています）。受付の方法や宛先は変わることがあるので、案内ページか自治体に確かめてください。${LC.checkedAt ? `案内ページなどの URL は${LC.checkedAt.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')}に開けるか確かめています。` : ''}</p>
  <p>${nav} ／ <a href="../">全国の申出先一覧</a></p>
  <h2>出典</h2>
  <ul class="sources">
    <li>${esc(SRC.list.name)} ${esc(SRC.list.url)}</li>
    <li>${esc(SRC.moushide.name)} ${esc(SRC.moushide.url)}</li>
  </ul>`,
  })
}

// ── 書き出し ───────────────────────────────────────────────────────────────────
const PAGES = [
  { file: path.join(ROOT, 'articles', SLUG), url: ART_URL, html: artHtml, pri: '0.8' },
  { file: path.join(ROOT, 'tsuika', 'index.html'), url: HUB_URL, html: hubHtml, pri: '0.7' },
  ...PREFS.map((p) => ({ file: path.join(ROOT, 'tsuika', pc(p), 'index.html'), url: prefUrl(p), html: prefPage(p), pri: '0.6' })),
]
const sizes = PAGES.map((p) => p.html.length)
console.log(`確かめ：申出先 ${N.rows}か所（県が担う町村 ${N.covered}）・マイナポータル ${N.mp}・独自の電子申出 ${N.own}・開けなかった URL ${LC.bad.length}本（${LC.checkedAt}）`)
console.log(`  目安の式：ひとり暮らし・ずっと受けていた → ${EXS.single.k32.reduce((s, x) => s + x, 0).toFixed(2)}〜${EXS.single.k11.reduce((s, x) => s + x, 0).toFixed(2)}万円（公表の合計 ${EX.single.k32.total}〜${EX.single.k11.total}）`)
console.log(`  面 ${PAGES.length}枚・最大 ${(Math.max(...sizes) / 1024).toFixed(1)}KB（${PAGES[sizes.indexOf(Math.max(...sizes))].url}）・索引 ${(SEARCH_JS.length / 1024).toFixed(1)}KB（${IDX.length}件）`)
if (DRY) process.exit(0)

// 改行コードの違い（core.autocrlf で取り出すと CRLF になる）は変更と数えない
const strip = (s) => s.replace(/\r/g, '').replace(/最終更新：\d{4}-\d{2}-\d{2}/, '').replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/g, '')
const SM = path.join(ROOT, 'sitemap.xml')
let sm = fs.readFileSync(SM, 'utf8')
let wrote = 0, smAdd = 0, smBump = 0
for (const p of PAGES) {
  const prev = fs.existsSync(p.file) ? fs.readFileSync(p.file, 'utf8') : null
  const changed = !prev || strip(prev) !== strip(p.html)
  if (changed) { fs.mkdirSync(path.dirname(p.file), { recursive: true }); fs.writeFileSync(p.file, p.html); wrote++ }
  const line = `  <url><loc>${p.url}</loc><lastmod>${TODAY}</lastmod><priority>${p.pri}</priority></url>`
  const re = new RegExp(`  <url><loc>${p.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc><lastmod>[^<]+</lastmod>[^\\n]*</url>`)
  if (!re.test(sm)) { sm = sm.replace('</urlset>', `${line}\n</urlset>`); smAdd++ }
  else if (changed) { sm = sm.replace(re, line); smBump++ }
}
if (smAdd || smBump) fs.writeFileSync(SM, sm)
const IDXF = path.join(ROOT, 'assets', 'tsuika-index.js')
if (!fs.existsSync(IDXF) || fs.readFileSync(IDXF, 'utf8') !== SEARCH_JS) fs.writeFileSync(IDXF, SEARCH_JS)
console.log(`書いた面 ${wrote}枚／${PAGES.length}・sitemap に足した ${smAdd}行・lastmod を進めた ${smBump}行`)
