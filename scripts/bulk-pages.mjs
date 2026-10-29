// 「型の面」（市区町村ごと・都道府県ごとに同じ型で量産した面）の判定。ここ1か所にだけ書く（2026-10-11）。
//   使う所：stamp-google-noindex.mjs（Google にだけ noindex）・stamp-adsense.mjs（AdSense のタグを入れない・AdSense のクローラに見せない）
//   ★判定を2か所に書くと必ずずれる。新しい型の面を作ったら、ここの BULK に1行足すだけで両方に効く。
//
// ★なぜ AdSense にも見せないか（2026-10-11 フクシルが AdSense の審査で「有用性の低いコンテンツ」で不合格）
//   公開 HTML 約2,600枚のうち約2,200枚が型の面。各面は式の出力と市区町村名の差し替えが中心で、審査には
//   「自動で作った同じような面が大半のサイト」に見える。Bing の検索から来る人はほぼ手書きの記事だけ（型の面はクリックの1%未満）。
//   型の面は読者のために残し、AdSense のクローラ（Mediapartners-Google）には robots.txt で見せず、広告のタグも入れない。
import path from 'node:path'

// 型の面（サイトの根からの道。ディレクトリの面は「…/」で終わる形）
export const BULK = [
  /^hikazei\/\d{5}\/$/,            // 住民税非課税の年収の目安（市区町村）
  /^hikazei\/ken\/\d{2}\/$/,       // 同（都道府県）
  /^shogai-kojo\/\d{6}\.html$/,    // 障害者控除の手順（市区町村）
  /^jiritsu\/ken\/(\d{2}|\d{5})\/((\d{5,6}|yakkyoku|houmon)\/)?$/, // 自立支援医療（都道府県・指定都市・市区町村・薬局・訪問看護）
  //   ★指定都市は jiritsu/ken/<5桁の市コード>/ に置かれる（14100 など20市×3枚）。2026-10-29 まで \d{2} だけで取りこぼし、
  //     60枚に AdSense のタグが入りサイトマップ（Google 用）にも残っていた
  /^houkatsu\/\d{6}\.html$/,       // 地域包括支援センター（市区町村）
  /^tsuika\/\d{2}\/$/,             // 生活保護の追加給付の申出先（都道府県・2026-10-09）。入口の /tsuika/ と本文の記事は Google にも見せる
  /^seiho\/((ken\/\d{2}|\d{5})\/)?$/, // 生活保護費の目安（入口・都道府県・市区町村・2026-10-12 ユーザー「グーグルには見せなくていいです」＝入口も Google に見せない）
]
// Google にも見せる型の面：Bing で需要が見えた3枚（2026-10-02 GetPageStats）と、Google に登録済みだった8枚（同日の URL検査の台帳）。
//   登録済みの面まで外すと、取れている評価を自分で捨てることになる
export const KEEP = new Set(['shogai-kojo/272248.html', 'shogai-kojo/252131.html', 'hikazei/44210/',
  'shogai-kojo/012351.html', 'shogai-kojo/114642.html', 'shogai-kojo/131075.html', 'shogai-kojo/131118.html',
  'shogai-kojo/131121.html', 'shogai-kojo/261009.html', 'shogai-kojo/342122.html', 'houkatsu/221309.html'])

export const isBulk = (rel) => !KEEP.has(rel) && BULK.some((re) => re.test(rel))

// ファイルの道 → サイトの根からの道（…/index.html は …/ にそろえる。URL と同じ形）
export const relOf = (root, file) => {
  const r = path.relative(root, file).split(path.sep).join('/')
  return r === 'index.html' ? '' : r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r
}

// robots.txt の Disallow に書く接頭辞を、型の面「だけ」を覆うように作る。
//   各面について、根から1文字ずつ伸ばした接頭辞のうち、型でない面を1枚も覆わない最短のものを選ぶ（例：/hikazei/0）。
//   KEEP の面や入口の面（/hikazei/ など）は覆わない。結果は数十行に収まる。
export const disallowPrefixes = (rels) => {
  const bulk = rels.filter(isBulk).map((r) => '/' + r)
  const other = rels.filter((r) => !isBulk(r)).map((r) => '/' + r)
  const covers = (p) => other.some((o) => o.startsWith(p))
  const picked = new Set()
  for (const b of bulk) {
    if ([...picked].some((p) => b.startsWith(p))) continue
    let found = false
    for (let k = 2; k <= b.length; k++) {
      const p = b.slice(0, k)
      // 「/hikazei」のように名前の途中で切れる接頭辞は、/hikazeiXXX のような別の道まで覆いうるので、最初の「/」の後ろからだけ選ぶ
      if (!p.slice(1).includes('/')) continue
      if (!covers(p)) { picked.add(p); found = true; break }
    }
    // 型の面の道が、型でない面の道の頭そのもの（/a/ が型・/a/b/ が型でない）のときは、末尾を $ で止めてその1枚だけを指す
    if (!found) picked.add(b + '$')
  }
  // 短い接頭辞に含まれる長い接頭辞を落とす
  const list = [...picked].sort()
  return list.filter((p) => !list.some((q) => q !== p && p.startsWith(q)))
}
