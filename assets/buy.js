/* 記事の中に置いた売り場（.offer[data-offer]）の決済と計測。2026-09-08
   ★なぜ記事の中で買えるようにしたか
     14日で来訪440。/pack/ に着いた人は実質3人、/toei/ は8人。人が降りているのは記事のほうで、
     そこから別URLの売り場へ跳ばす設計そのものが落ちている段だった。
     ∴ 記事のページから直接 /api/checkout を呼ぶ。跳ばす段を無くす。
   ★同じ判定を2か所に書かない
     /pack/ と /toei/ の購入JSと同じ呼び出しをここに1本化してある。
     記事・自治体別ページはこのファイルだけを読む。[[same-question-two-implementations]]
   ★イベント名は [a-z_] だけ
     worker の /api/ev が [a-z_] 以外を落とすので、数字を入れると別名に化ける。 */
(function () {
  var cards = document.querySelectorAll('.offer[data-offer]')
  if (!cards.length) return
  var ev = function (n) { if (window.__ev) window.__ev(n) }

  // 市区町村の選択肢（437件）は別ファイルにしてある。記事の本文の真ん中に全国の市区町村名を
  // 埋めると、記事の中身が読み手にもクローラーにもぼやけるため。要るページだけ後から読む。
  // パスは絶対で書く。階層の違うページから相対で書くと片方が404になる。[[relative-asset-paths-subpages]]
  if (document.querySelector('select[data-munsel]') && !window.__MUNIS) {
    var s = document.createElement('script')
    s.src = '/assets/munis.js?v=20260908a'
    document.head.appendChild(s)
  }

  // 商品の対応表。data-offer は計測の名前、product は worker 側の商品ID。
  var P = {
    pack: { product: 'kojo', perCity: true, seen: 'pack_offer_seen', buy: 'pack_leaf_buy' },
    toei: { product: 'toei', perCity: false, seen: 'toei_offer_seen', buy: 'toei_leaf_buy' }
  }

  // ── カードが画面に入ったら1回だけ数える ──────────────────────────────────
  // 「置いたのに見られていない」と「見られたのに押されない」は打つ手が違う。
  // 分けて数えないと、どちらなのか後から永久に分からない。
  var fired = {}
  function seen(kind) {
    var p = P[kind]
    if (!p || fired[kind]) return
    fired[kind] = true
    ev(p.seen)
  }
  // ★判定は位置の実寸でやる。IntersectionObserver は使わない。
  //   (1) 「カードの何割が見えたか」で閾値を書くと壊れる。カードは320px幅だと2000pxを超え、
  //       画面（700〜800px）にどうやっても3割は入らない。読まれている面が「見られていない」になる。
  //   (2) 見えたかどうかが0のまま返ってくると「誰も見ていない＝需要なし」と読み違える。
  //       判定材料そのものが動いているかを、こちらで確かめられる書き方にしておく。
  //       [[monetization-null-test]]
  //   ∴ 画面に入った高さ（px）で数える。60px以上入ったら1回だけ。
  function check() {
    var vh = window.innerHeight || document.documentElement.clientHeight
    var rest = 0
    for (var i = 0; i < cards.length; i++) {
      var k = cards[i].getAttribute('data-offer')
      if (!P[k] || fired[k]) continue
      var r = cards[i].getBoundingClientRect()
      if (Math.min(r.bottom, vh) - Math.max(r.top, 0) >= 60) seen(k)
      else rest++
    }
    if (!rest) {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }
  window.addEventListener('scroll', check, { passive: true })
  window.addEventListener('resize', check)
  check()

  // ── 買う ────────────────────────────────────────────────────────────────
  for (var j = 0; j < cards.length; j++) wire(cards[j])

  function wire(card) {
    var kind = card.getAttribute('data-offer')
    var p = P[kind]
    if (!p) return
    var btn = card.querySelector('[data-buy]')
    var msg = card.querySelector('.buymsg')
    var sel = card.querySelector('[data-munsel]')
    if (!btn) return
    var say = function (t) { if (msg) msg.textContent = t }

    btn.addEventListener('click', function () {
      var body = { product: p.product }
      if (p.perCity) {
        // 自治体別ページは自分のコードを持っている。記事は選んでもらう。
        var code = card.getAttribute('data-code') || (sel ? sel.value : '')
        if (!/^\d{6}$/.test(code)) { say('市区町村を選んでください'); if (sel) sel.focus(); return }
        body.code = code
      }
      ev(p.buy)
      btn.disabled = true
      say('決済ページへ移動します…')
      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (d && d.ok && d.url) { location.href = d.url; return }
          btn.disabled = false
          say((d && d.error) || '決済を開始できませんでした')
        })
        .catch(function () { btn.disabled = false; say('通信に失敗しました。時間をおいてお試しください') })
    })
  }
})();
