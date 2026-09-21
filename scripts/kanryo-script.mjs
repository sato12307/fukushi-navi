// ─────────────────────────────────────────────────────────────────────────────
// kanryo-script.mjs — 購入完了ページ（/<商品>/kanryo/）の中身を1か所に持つ。
//
// ★なぜ1か所にするか（2026-09-19）
//   完了ページの判定が3つの生成器に写経されていて、中身が違っていた。
//     scripts/koei-nerai.mjs       … /api/download?product=<市> を直リンク
//     scripts/toei-nerai.mjs       … /api/pack を直リンク
//     scripts/shogai-kojo-sell.mjs … /api/pack を直リンク
//   そして **/api/download は Worker に存在せず、本番で404だった**（政令市5市は
//   買っても資料を落とせない状態だった。購入0件だったので実害は出ていない）。
//   写経したものは必ず片方だけずれる。[[same-question-two-implementations]]
//
// ★直リンクをやめた理由
//   ボタンの href に API を直に入れると、API が失敗したときに**素のJSONが画面に出る**。
//   払った人には何が起きたか分からない。∴ 先に check=1 で状態だけ聞き、
//   落とせると分かってからボタンを出す。
//
// ★PayPay のような「別画面へ飛んで戻る」方法は、戻った瞬間に受領が確定していないことがある。
//   その一瞬を「買えていません」と見せると、払った人が自分のせいだと思って離脱する。
//   ∴ Worker が retry:true を返したときは、文言を変えて自動で数回聞き直す。
//
// ★ボタンをやめて、この画面の中に資料を開く（2026-09-21）
//   それまでは「完了ページ → ボタンを押す → 端末のファイルを探す → 開く」の4手だった。
//   資料は外部参照を持たない完結したHTMLなので、その場に開ける。**スマホで一番詰まる
//   のが3手目**（Androidのダウンロード一覧・iOSのファイルアプリ）で、払った直後の
//   いちばん離脱してほしくない所にそれを置いていた。
//   艦隊では食品衛生アーカイブ（shokuhin-watch/functions/api/report.js）が先に
//   この形になっている。そちらに合わせた。
//
//   ・iframe に入れる。資料は body{...} などを持つ完結した文書で、この画面のDOMへ
//     直に差し込むと完了ページの見た目が壊れる。
//   ・高さは中身に合わせて伸ばす（同一オリジンなので測れる）。伸ばさないと
//     スクロールが二重になり、スマホで最も操作しにくい形になる。
//     ★引き換えに、資料の中の見出し固定（position:sticky）は効かなくなる。
//       iframe 自体がスクロールしなくなるため。二重スクロールより軽い害と判断した。
//   ・**保存の道は残す**。完了ページのURL（session_id 付き）を失った人にとっては、
//     手元のファイルだけが残る唯一の形になる。
//   ・**資料はページの最後に置く**（2026-09-21・目視で判明）。ボタンのあった位置に
//     差し込んだら、都営の資料（3,198住宅）でページが109,161pxになり、その下にある
//     「使い方」と**返金・問い合わせ先が誰にも届かない所へ埋まった**。
//     ∴ 上には「保存／別のタブ／↓ここに開いています」の3つだけを置き、資料は末尾に開く。
//     資料まではひと画面ぶんスクロールするだけで、跳ぶリンクも付けてある。
//     [[visual-check-catches-key-bugs]]
// ─────────────────────────────────────────────────────────────────────────────

// btn  … 確認が取れなかったときに出す予備ボタンの id（ふだんは使われない）
// msg  … 文言を出す要素の id（無ければボタンの後ろに作る）
// label… 資料の名前。iframe の title と予備ボタンの文言に使う
// save … 保存リンクの文言
export const kanryoScript = ({ btn = 'dl', msg = 'msg', label = '資料', save = 'ファイルとして保存（HTML）' } = {}) => `
(function () {
  var sid = new URLSearchParams(location.search).get('session_id')
  var a = document.getElementById('${btn}')
  var m = document.getElementById('${msg}')
  if (!a) return
  if (!m) { m = document.createElement('p'); m.id = '${msg}'; m.className = 'fine'; a.parentNode.insertBefore(m, a.nextSibling) }
  var show = function (t) { m.textContent = t }
  var hide = function () { a.style.display = 'none' }
  var api = function (q) { return '/api/pack?session_id=' + encodeURIComponent(sid) + q }

  if (!sid) { hide(); show('購入の情報が見つかりません。購入後に表示されたURLからお越しください。'); return }

  // 資料をこの画面の中に開く。
  var mounted = false
  var mount = function () {
    if (mounted) return
    mounted = true
    // 予備ボタンがあった場所（＝押すはずだった所）には、操作だけを置く。
    var host = (a.parentNode && a.parentNode.tagName === 'P') ? a.parentNode : a
    var bar = document.createElement('p')
    bar.className = 'fine'
    bar.style.cssText = 'display:flex;gap:1.2rem;flex-wrap:wrap;margin:.6rem 0'
    var jump = document.createElement('a')
    jump.href = '#packview'; jump.textContent = '↓ ${label}はこのページの下に開いています'
    jump.style.cssText = 'font-weight:600'
    var dl = document.createElement('a')
    dl.href = api('&dl=1'); dl.textContent = '${save}'; dl.setAttribute('download', '')
    var tab = document.createElement('a')
    tab.href = api(''); tab.target = '_blank'; tab.rel = 'noopener'; tab.textContent = '別のタブで開く'
    bar.appendChild(jump); bar.appendChild(dl); bar.appendChild(tab)
    host.parentNode.insertBefore(bar, host.nextSibling)

    // 資料そのものは、この画面の一番下に開く。
    var box = document.createElement('div')
    box.id = 'packview'
    box.style.cssText = 'margin:1.6rem 0 0;scroll-margin-top:1rem'

    var f = document.createElement('iframe')
    f.src = api('')
    f.title = '${label}'
    // 高さが測れなかったときのために既定値を置く（測れなければ二重スクロールになるが読める）
    f.style.cssText = 'display:block;width:100%;height:70vh;border:1px solid #dfe4ea;border-radius:4px;background:#fff'

    var fit = function () {
      try {
        var d = f.contentDocument
        if (!d || !d.documentElement) return
        var h = Math.max(d.documentElement.scrollHeight || 0, d.body ? d.body.scrollHeight : 0)
        if (h > 0) f.style.height = (h + 24) + 'px'
      } catch (e) { /* 測れないときは既定の高さのまま */ }
    }
    f.addEventListener('load', function () {
      fit()
      // 表の組み直しや字形の確定で高さが動く。数回だけ測り直す。
      setTimeout(fit, 300); setTimeout(fit, 1200)
      try {
        if (window.ResizeObserver && f.contentDocument && f.contentDocument.body) {
          new ResizeObserver(fit).observe(f.contentDocument.body)
        }
      } catch (e) {}
    })
    window.addEventListener('resize', fit)

    box.appendChild(f)
    host.parentNode.appendChild(box)
  }

  hide()
  show('購入を確認しています…')
  var tries = 0
  var ask = function () {
    tries++
    fetch(api('&check=1'), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return { ok: false } }) })
      .then(function (d) {
        if (d && d.ok) { show(''); mount(); return }
        // 受領の確認待ち（PayPay など別画面から戻る方法で起きる）。数回だけ聞き直す。
        if (d && d.retry && tries < 6) {
          show('お支払いの確認を待っています…（' + tries + '回目）')
          setTimeout(ask, 3000)
          return
        }
        show((d && d.error) || '購入の確認ができませんでした。お手数ですが contact@fukushiru.com までご連絡ください（この画面のURLを添えていただけると早いです）。')
      })
      .catch(function () {
        if (tries < 3) { setTimeout(ask, 3000); return }
        // 通信そのものが通らないときは、予備ボタンだけでも出す（読める人を止めない）。
        a.href = api('')
        a.textContent = '${label}を開く'
        a.style.display = ''
        show('確認の通信に失敗しました。上のボタンをお試しください。開けない場合は contact@fukushiru.com までご連絡ください。')
      })
  }
  ask()
})()
`
