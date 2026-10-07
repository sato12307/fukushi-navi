/* 購入までの段を数える。どこで人が落ちているかが分からないと、
   「売れない＝価格が高い」と決めつけて打つ手を全部間違える。
   数えるのは押された回数だけで、誰が押したかは記録しない。
   ★リンクの計測は sendBeacon を使う。fetch だと遷移で中断されて落ちる。
   ★この判定はここ1か所だけに置く。生成ページは build 時にこのファイルを読んで埋め込み、
     手書きの記事は script の src で読む。2か所に書くと必ずずれる。[[same-question-two-implementations]]
   ★変えたら：src で読むページは ?v= を上げる（古い ev.js がキャッシュに残る）。埋め込みのページは
     生成器を回すか埋め込みだけを差し替える（読み手に見える中身は同じなので lastmod は進めない）。
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
    { path: '/toei/', view: 'toei_view', click: 'to_toei' },   // 都営住宅の申込先えらび
    // ★政令市5市（2026-09-20 追加）。売り場を /<市>/moushikomisaki/ へ切り出した 2026-09-19 に
    //   ここへの登録が漏れ、<市>_view が一度も撃たれていなかった。盤面では決済だけが立ち、
    //   手前の段が全部0に見えていた（数字が無いのであって、0ではない）。
    // ★買う押（<市>_leaf_buy）は assets/buy.js 側にあり、data-offer とともに動いている。
    // ★押した（to_<市>）は 2026-10-07 に足した。ユーザー「フクシルは数え方を改良して」。
    //   それまで申込先えらびは「view → buy → pay で、押した段が初めから無い」としてここに click を置かず、
    //   記事から売り場へ人が実際に着いた日（Bing → 生活保護の申請の記事 → /yokohama/moushikomisaki/）も
    //   「押した」は0だった。段は課金の全商品で click → view → buy → pay にそろえる（2026-09-19 ユーザー裁定）。
    //   tools/buy-funnel-ships.mjs の ev.click と対。2026-10-08 より前の to_<市> は0ではなく「数えていなかった」。
    //   売り場を足すときは view と click の両方を置く。
    { path: '/kawasaki/moushikomisaki/', view: 'kawasaki_view', click: 'to_kawasaki' },
    { path: '/shizuoka/moushikomisaki/', view: 'shizuoka_view', click: 'to_shizuoka' },
    { path: '/yokohama/moushikomisaki/', view: 'yokohama_view', click: 'to_yokohama' },
    { path: '/kobe/moushikomisaki/', view: 'kobe_view', click: 'to_kobe' },
    { path: '/sagamihara/moushikomisaki/', view: 'sagamihara_view', click: 'to_sagamihara' },
    // ★県営（2026-09-30）。イベント名にハイフンを入れない（/api/ev が a-z と _ 以外を落とす）。
    { path: '/saitama-ken/moushikomisaki/', view: 'saitamaken_view', click: 'to_saitamaken' },
    { path: '/aichi-ken/moushikomisaki/', view: 'aichiken_view', click: 'to_aichiken' },
    // ★大阪府営は 2026-10-01 に売り場を畳んだ（いまは転送だけ）ので click は置かない。
    //   盤面に行が無く、読まない名前を撃つと孤児のキーが増える。
    { path: '/osaka-fu/moushikomisaki/', view: 'osakafu_view' }   // 2026-10-01 大阪府営
  ]
  for (var i = 0; i < SELL.length; i++) {
    if (location.pathname.indexOf(SELL[i].path) === 0 && location.pathname.indexOf('kanryo') < 0) ev(SELL[i].view)
  }
  // ★行き先は、ブラウザが解決したパスでも比べる（2026-10-07）。href の文字だけで比べていたので、トップの帯の
  //   href="pack/"・"yokohama/moushikomisaki/" のような相対リンク（about.html の "pack/" も）は '/pack/' を
  //   文字に含まず、押されても数えていなかった。ただし今いるページが売り場の中なら、解決したパスでは数えない
  //   （売り場の "#main"＝本文へスキップ や "#kau" まで売り場へのリンクに見えてしまう）。
  //   href の文字で比べる判定はそのまま残す＝数えるリンクが増えるだけで、今まで数えていたものは落ちない。
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    var h = a.getAttribute('href') || ''
    if (h.indexOf('kanryo') >= 0) return
    var p = ''
    try { if (a.host === location.host) p = String(a.pathname || '') } catch (x) { /* SVG の a などは文字だけで比べる */ }
    for (var j = 0; j < SELL.length; j++) {
      var s = SELL[j].path
      if (h.indexOf(s) >= 0 || (p.indexOf(s) === 0 && location.pathname.indexOf(s) !== 0)) {
        if (SELL[j].click) ev(SELL[j].click)
        return
      }
    }
  }, true)
})();
