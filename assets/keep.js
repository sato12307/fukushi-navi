/* 計算の条件をURLに畳む。ブックマークして、あとでまた同じ条件で開けるようにする。
   ★なぜ作るか（2026-09-14）
     計算機は答えを1つ返して終わりになる。けれど制度の金額は変わるし、家族の状況も変わる。
     条件がURLに入っていれば、ブックマークしておいて、変わったときに同じURLを開くだけで
     新しい答えが出る。カワルヒ層（この金額はいつ決まったか）と組にして初めて意味が出る。
   ★サーバーには何も送らない。URLとこのブラウザの中だけで完結する。
   ★入力は「idを持つ input/select」だけを見る。idの無い動的な欄は、
     生活保護の世帯員リスト（#m-list の .m-row select）だけ個別に拾う——
     ここは計算の中心なので、取りこぼすと「共有したURLが別の答えを返す」ことになる。 */
(function () {
  var main = document.getElementById('main') || document.querySelector('main')
  if (!main) return
  var fields = []
  var all = main.querySelectorAll('input[id], select[id]')
  for (var i = 0; i < all.length; i++) {
    var el = all[i]
    if (el.type === 'button' || el.type === 'submit' || el.type === 'hidden') continue
    fields.push(el)
  }
  var list = document.getElementById('m-list')      // 生活保護の世帯員リスト（無い面では null）
  var addBtn = document.getElementById('m-add')
  if (!fields.length) return

  function memberAges() {
    if (!list) return null
    var sels = list.querySelectorAll('.m-row select'), a = []
    for (var i = 0; i < sels.length; i++) a.push(sels[i].value)
    return a
  }

  /* いまの条件を短い文字列にする */
  function read() {
    var parts = []
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i]
      var v = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value
      if (v === '' || v == null) continue
      parts.push(encodeURIComponent(el.id) + '=' + encodeURIComponent(v))
    }
    var m = memberAges()
    if (m && m.length) parts.push('m=' + encodeURIComponent(m.join('.')))
    return parts.join('&')
  }

  function fire(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })) } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {}
  }

  /* 文字列から条件を戻す */
  function write(q) {
    if (!q) return false
    var map = {}, kv = q.split('&')
    for (var i = 0; i < kv.length; i++) {
      var p = kv[i].split('=')
      if (p.length === 2) map[decodeURIComponent(p[0])] = decodeURIComponent(p[1])
    }
    /* 世帯員を先に揃える。数が違うまま値だけ入れると、共有した人と違う答えになる */
    if (map.m && list && addBtn) {
      var want = map.m.split('.')
      var guard = 0
      while (list.querySelectorAll('.m-row').length < want.length && guard++ < 10) addBtn.click()
      var sels = list.querySelectorAll('.m-row select')
      for (var j = 0; j < sels.length && j < want.length; j++) { sels[j].value = want[j]; fire(sels[j]) }
    }
    var touched = 0
    for (var k = 0; k < fields.length; k++) {
      var el = fields[k]
      if (!(el.id in map)) continue
      if (el.type === 'checkbox') el.checked = map[el.id] === '1'
      else el.value = map[el.id]
      fire(el); touched++
    }
    return touched > 0
  }

  /* 条件が変わったらURLのうしろに畳む（履歴は汚さない） */
  var timer = null
  function sync() {
    clearTimeout(timer)
    timer = setTimeout(function () {
      var q = read()
      if (!q) return
      try { history.replaceState(null, '', location.pathname + '#j=' + q) } catch (e) {}
      try { localStorage.setItem('keep:' + location.pathname, JSON.stringify({ q: q, at: new Date().toISOString().slice(0, 10) })) } catch (e) {}
    }, 400)
  }
  main.addEventListener('input', sync, true)
  main.addEventListener('change', sync, true)
  if (addBtn) addBtn.addEventListener('click', sync)

  /* 置き場＝最初の結果欄の直後。どの計算機にも .out がある */
  var out = main.querySelector('.out')
  if (!out) return
  var bar = document.createElement('p')
  bar.className = 'updated'
  bar.style.marginTop = '8px'
  out.parentNode.insertBefore(bar, out.nextSibling)

  function msg(t) { bar.innerHTML = t }

  var copyBtn = '<button type="button" id="keepCopy" class="btn-primary" style="font-size:.9rem;padding:6px 14px">この条件のURLをコピー</button>'

  /* ① URLに条件が入っていれば、それで開く */
  var hash = location.hash || ''
  var restored = false
  if (hash.indexOf('#j=') === 0) restored = write(hash.slice(3))

  /* ② 入っていなければ、前にこの面で計算した条件があるか見る */
  var prev = null
  if (!restored) {
    try { prev = JSON.parse(localStorage.getItem('keep:' + location.pathname) || 'null') } catch (e) {}
  }

  if (restored) {
    msg('ブックマークした条件で開いています。' + copyBtn)
  } else if (prev && prev.q) {
    var jp = prev.at.slice(5).replace('-', '月') + '日'
    msg('前回（' + jp + '）はこの面で計算されています。<a href="#j=' + prev.q + '" id="keepBack">そのときの条件に戻す</a>　' + copyBtn)
    var back = document.getElementById('keepBack')
    if (back) back.addEventListener('click', function (e) { e.preventDefault(); if (write(prev.q)) msg('前回の条件に戻しました。' + copyBtn); bindCopy() })
  } else {
    msg('条件を入れると、この画面のURLにその条件が入ります。ブックマークしておけば、あとで同じ条件のまま開けます。' + copyBtn)
  }

  function bindCopy() {
    var b = document.getElementById('keepCopy')
    if (!b) return
    b.addEventListener('click', function () {
      var url = location.origin + location.pathname + '#j=' + read()
      var done = function () { b.textContent = 'コピーしました'; setTimeout(function () { b.textContent = 'この条件のURLをコピー' }, 2000) }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, function () { window.prompt('このURLをコピーしてください', url) }); return }
      } catch (e) {}
      window.prompt('このURLをコピーしてください', url)
    })
  }
  bindCopy()
})();
