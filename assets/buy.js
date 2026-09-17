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
    pack: { product: 'kojo', perCity: true, seen: 'pack_offer_seen', read: 'pack_offer_read', pick: 'pack_city_pick', buy: 'pack_leaf_buy' },
    toei: { product: 'toei', perCity: false, seen: 'toei_offer_seen', read: 'toei_offer_read', buy: 'toei_leaf_buy' },
    // 政令市の申込先えらび（2026-09-17）。市ごとに商品を分ける（A案）。
    // ★イベント名もKVのキーも市ごとに分ける。同じ名前にすると、どの市が売れたのか
    //   tools/buy-funnel.mjs で二度と分けられない。市を足すときはここに1行足す。
    kawasaki: { product: 'kawasaki', perCity: false, seen: 'kawasaki_offer_seen', read: 'kawasaki_offer_read', buy: 'kawasaki_leaf_buy' },
    shizuoka: { product: 'shizuoka', perCity: false, seen: 'shizuoka_offer_seen', read: 'shizuoka_offer_read', buy: 'shizuoka_leaf_buy' },
    yokohama: { product: 'yokohama', perCity: false, seen: 'yokohama_offer_seen', read: 'yokohama_offer_read', buy: 'yokohama_leaf_buy' },
    kobe: { product: 'kobe', perCity: false, seen: 'kobe_offer_seen', read: 'kobe_offer_read', buy: 'kobe_leaf_buy' }
  }

  // ── どこまで進んだかを3段で数える ────────────────────────────────────────
  // 「置いたのに見られていない」と「見られたのに押されない」は打つ手が違う。
  // 分けて数えないと、どちらなのか後から永久に分からない。
  //
  // ★2026-09-17 段を1つから3つに割った。
  //   それまでは「カードが画面に入った（seen）」しか無く、その次が「買うボタンを押した」だった。
  //   実測はフクシルの14日で seen 619・買う押 0。しかし seen は人数ではなく、
  //   **枠の上端がスクロールで画面を横切った回数**でしかない。カードは縦に長い（320px幅で2000px超）ので、
  //   記事を最後まで読んだ人はほぼ全員が自動的に立つ。∴ 619と0の間に段が無く、
  //   「読んでやめた」のか「気づかず通り過ぎた」のかを区別できなかった。
  //   → 「何人が買おうか迷ったのか」に答えられない計測だった。[[monetization-null-test]]
  //
  //   seen … 枠が画面に60px入った。**通りすがりを含む。人数として読まない**
  //   read … 値段と購入ボタンの行（.buyrow）が画面に入った状態で、のべ3秒とどまった。
  //          スクロールで一気に通過した人は立たない。＝**中身を読んだ人**
  //   pick … 市区町村を選んだ（記事の売り場のみ。自治体別ページは初めから決まっている）。
  //          買う直前でしかやらない操作なので、**「迷った」と呼べる一番硬い段**
  //   buy  … 購入ボタンを押した
  //
  // ★判定は位置の実寸でやる。IntersectionObserver は使わない。
  //   (1) 「カードの何割が見えたか」で閾値を書くと壊れる。カードは320px幅だと2000pxを超え、
  //       画面（700〜800px）にどうやっても3割は入らない。読まれている面が「見られていない」になる。
  //   (2) 見えたかどうかが0のまま返ってくると「誰も見ていない＝需要なし」と読み違える。
  //       判定材料そのものが動いているかを、こちらで確かめられる書き方にしておく。
  var fired = {}
  var dwell = {}
  function fire(kind, stage) {
    var p = P[kind]
    var key = kind + ':' + stage
    if (!p || !p[stage] || fired[key]) return
    fired[key] = true
    ev(p[stage])
  }
  // 画面に入っている高さ（px）。見えていなければ0以下。
  function shown(el, vh) {
    var r = el.getBoundingClientRect()
    return Math.min(r.bottom, vh) - Math.max(r.top, 0)
  }
  var TICK = 500       // 見張りの間隔（ms）
  var NEED = 3000      // 「読んだ」と数えるまでの滞在（ms）
  var timer = null
  // ★滞在は「呼ばれた回数×間隔」で足さない。check() はスクロールでも走るので、
  //   速く指を動かした人ほど滞在が増えるという逆さまの数え方になる。∴ 実時間の差分で足す。
  //   1回の差分は TICK×2 で頭打ちにする（タブを離れて戻った時間を読書時間に足さないため）。
  var last = Date.now()
  function check() {
    var now = Date.now()
    var dt = Math.min(Math.max(now - last, 0), TICK * 2)
    last = now
    var vh = window.innerHeight || document.documentElement.clientHeight
    var rest = 0
    for (var i = 0; i < cards.length; i++) {
      var k = cards[i].getAttribute('data-offer')
      if (!P[k]) continue
      if (!fired[k + ':seen'] && shown(cards[i], vh) >= 60) fire(k, 'seen')
      if (!fired[k + ':read']) {
        // 購入ボタンの行まで来たか。行が無いカード（旧型の案内）はカード下端で代用する。
        var row = cards[i].querySelector('.buyrow') || cards[i]
        if (shown(row, vh) >= 1) {
          dwell[k] = (dwell[k] || 0) + dt
          if (dwell[k] >= NEED) fire(k, 'read')
        }
      }
      if (!fired[k + ':seen'] || !fired[k + ':read']) rest++
    }
    if (!rest) {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      if (timer) { clearInterval(timer); timer = null }
    }
  }
  window.addEventListener('scroll', check, { passive: true })
  window.addEventListener('resize', check)
  // 滞在で数えるので、スクロールが止まっていても時間を進める必要がある。
  timer = setInterval(check, TICK)
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

    // ★「市区町村を選んだ」を数える（2026-09-17）。買う直前にしかやらない操作なので、
    //   押す手前で止まった人をここで捕まえられる。＝「迷ったが買わなかった」人数。
    //   自治体別ページ438枚は data-code を初めから持っていてこの段が無い（選ぶ必要が無い）。
    //   ∴ この段の母数は記事5枚ぶんだけ。艦全体の分母と割らないこと。
    if (sel) {
      sel.addEventListener('change', function () {
        if (/^\d{6}$/.test(sel.value)) fire(kind, 'pick')
      })
    }

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
