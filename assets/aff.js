// アフィリエイト点火スクリプト（点火済み: 引越し侍 A8 2026-07-14承認）
// impはA8広告コードの1x1計測gif(https://wwwXX.a8.net/0.gif?a8mat=...)。未設定でも成果計測には影響なし。
window.AFF = { links: { "hikkoshi": {
  url: "https://px.a8.net/svt/ejp?a8mat=4B8097+5YC4VE+ZXM+I6SJ5",
  imp: ""
} } };
(function () {
  var L = (window.AFF && window.AFF.links) || {};
  if (!Object.keys(L).length) return;
  document.querySelectorAll("[data-aff]").forEach(function (box) {
    var p = L[box.getAttribute("data-aff")];
    if (!p || !p.url) return;
    box.querySelectorAll("a.cta-btn").forEach(function (a) {
      a.href = p.url;
      a.target = "_blank";
      a.rel = "nofollow sponsored noopener";
    });
    // 景表法・ステマ規制: 点火と同時に広告表記を表示
    var pr = box.querySelector(".aff-pr");
    if (pr) pr.style.display = "";
    // A8インプレッション計測ピクセル
    if (p.imp) {
      var img = new Image(1, 1);
      img.src = p.imp;
      img.alt = "";
      img.width = 1;
      img.height = 1;
      box.appendChild(img);
    }
  });
})();
