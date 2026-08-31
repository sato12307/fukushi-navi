/* 購入までの段を数える。どこで人が落ちているかが分からないと、
   「売れない＝価格が高い」と決めつけて打つ手を全部間違える。
   数えるのは押された回数だけで、誰が押したかは記録しない。
   ★リンクの計測は sendBeacon を使う。fetch だと遷移で中断されて落ちる。
   ★この判定はここ1か所だけに置く。生成ページは build 時にこのファイルを読んで埋め込み、
     手書きの記事は <script src> で読む。2か所に書くと必ずずれる。[[same-question-two-implementations]] */
(function () {
  function ev(n) {
    try {
      var b = JSON.stringify({ n: n })
      if (navigator.sendBeacon) { navigator.sendBeacon('/api/ev', new Blob([b], { type: 'application/json' })); return }
      fetch('/api/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b, keepalive: true })
    } catch (e) { /* 計測の失敗でページを壊さない */ }
  }
  window.__ev = ev
  if (location.pathname.indexOf('/pack/') === 0 && location.pathname.indexOf('kanryo') < 0) ev('pack_view')
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    var h = a.getAttribute('href') || ''
    if (h.indexOf('/pack/') >= 0 && h.indexOf('kanryo') < 0) ev('to_pack')
  }, true)
})();
