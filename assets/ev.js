/* 購入までの段を数える。どこで人が落ちているかが分からないと、
   「売れない＝価格が高い」と決めつけて打つ手を全部間違える。
   数えるのは押された回数だけで、誰が押したかは記録しない。
   ★リンクの計測は sendBeacon を使う。fetch だと遷移で中断されて落ちる。
   ★この判定はここ1か所だけに置く。生成ページは build 時にこのファイルを読んで埋め込み、
     手書きの記事は script の src で読む。2か所に書くと必ずずれる。[[same-question-two-implementations]]
   ★2026-09-08 自分の閲覧を数えない判定もここに入れた。
     確認のために自分で開いた回数が混ざると、「見られている／押されている」の判断を丸ごと誤る。
     https://fukushiru.com/?self=1 を一度開けばこの端末は以後ずっと除外される（#self でも同じ）。
     戻すときは localStorage.removeItem('ev_off')。
     イベント名は [a-z_] だけにすること。worker 側が数字を落とすので pack2 は pack になる。 */
(function () {
  // 自分で立てた印。localStorage が使えない環境（プライベートウィンドウ等）でも計測は続ける。
  try {
    if (/[?&]self=1(?:&|$)/.test(location.search) || location.hash === '#self') localStorage.setItem('ev_off', '1')
  } catch (e) { /* 保存できなくても本文は動かす */ }

  // 送らない相手＝自分の端末と、自動で開いているブラウザ（ヘッドレス巡回）。
  function off() {
    try { if (localStorage.getItem('ev_off') === '1') return true } catch (e) { /* 読めなければ除外しない */ }
    return navigator.webdriver === true
  }

  function ev(n) {
    if (off()) return
    try {
      var b = JSON.stringify({ n: n })
      if (navigator.sendBeacon) { navigator.sendBeacon('/api/ev', new Blob([b], { type: 'application/json' })); return }
      fetch('/api/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b, keepalive: true })
    } catch (e) { /* 計測の失敗でページを壊さない */ }
  }
  window.__ev = ev
  // 売り場ごとに名前を分ける。同じ名前にすると、どちらが動いたのか後から分けられない。
  var SELL = [
    { path: '/pack/', view: 'pack_view', click: 'to_pack' },   // 障害者控除の還付申請パック
    { path: '/toei/', view: 'toei_view', click: 'to_toei' }    // 都営住宅の申込先えらび
  ]
  for (var i = 0; i < SELL.length; i++) {
    if (location.pathname.indexOf(SELL[i].path) === 0 && location.pathname.indexOf('kanryo') < 0) ev(SELL[i].view)
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    var h = a.getAttribute('href') || ''
    if (h.indexOf('kanryo') >= 0) return
    for (var j = 0; j < SELL.length; j++) {
      if (h.indexOf(SELL[j].path) >= 0) { ev(SELL[j].click); return }
    }
  }, true)
})();
