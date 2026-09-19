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
// ─────────────────────────────────────────────────────────────────────────────

// btn … ダウンロードボタンの id
// msg … 文言を出す要素の id（無ければボタンの後ろに作る）
export const kanryoScript = ({ btn = 'dl', msg = 'msg', label = '資料をダウンロード' } = {}) => `
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

  hide()
  show('購入を確認しています…')
  var tries = 0
  var ask = function () {
    tries++
    fetch(api('&check=1'), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return { ok: false } }) })
      .then(function (d) {
        if (d && d.ok) {
          a.href = api('')
          a.textContent = '${label}'
          a.style.display = ''
          show('')
          return
        }
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
        // 通信そのものが通らないときは、直リンクだけでも出す（落とせる人を止めない）。
        a.href = api('')
        a.style.display = ''
        show('確認の通信に失敗しました。上のボタンをお試しください。開けない場合は contact@fukushiru.com までご連絡ください。')
      })
  }
  ask()
})()
`
