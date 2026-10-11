// kinro-kojo-lib.mjs — 生活保護の勤労控除のうち基礎控除（月額）の式を1か所に置く。
//   計算機（articles/seikatsuhogo-keisanki.html）にはこの KISO_SRC の文字列がそのまま入る（scripts/keisanki-sync.mjs が書く）。
//   表の全行と合うかは scripts/kinro-kojo-check.mjs が data/kinro-kojo.json（次官通知の別表「基礎控除額表」を写したもの）で確かめる。
//   ★式を直すときはここだけ。計算機の HTML の中を手で直さない（同じ判定を2か所に書かない）。
export const KISO_SRC = `function kisoKojo(w, second){
  // 基礎控除（月額）＝厚生事務次官通知「生活保護法による保護の実施要領について」別表「基礎控除額表」。second＝2人目以降の欄
  if (!(w > 0)) return 0;
  if (!second) {
    if (w < 15200) return w;
    if (w < 19000) return 15200;
    return 15200 + 400 * (Math.floor((w - 19000) / 4000) + 1);
  }
  if (w <= 15000) return w;
  if (w < 43000) return 15000;
  return 15300 + 340 * Math.floor((w - 43000) / 4000);
}`

export const kisoKojo = new Function(KISO_SRC + '\nreturn kisoKojo;')()

// 表（data/kinro-kojo.json の rows と above）の全行で式を確かめる。合わない行を配列で返す（空なら全部合っている）。
export function checkRows(J) {
  const bad = []
  const want = (v, w) => (v === null ? w : v)
  for (const [from, to, f, s] of J.rows) {
    for (const w of new Set([from, Math.floor((from + to) / 2), to])) {
      if (w === 0) continue
      if (kisoKojo(w, false) !== want(f, w)) bad.push(`1人目 ${w}円：式${kisoKojo(w, false)} 表${want(f, w)}`)
      if (kisoKojo(w, true) !== want(s, w)) bad.push(`2人目以降 ${w}円：式${kisoKojo(w, true)} 表${want(s, w)}`)
    }
  }
  // 231,000円からは備考の式（4,000円ごとに1人目400円・2人目以降340円を足す）
  const last = J.rows[J.rows.length - 1]
  for (let k = 0; k < 20; k++) {
    for (const w of [J.above.from + k * J.above.step, J.above.from + (k + 1) * J.above.step - 1]) {
      const f = last[2] + (k + 1) * J.above.first, s = last[3] + (k + 1) * J.above.second
      if (kisoKojo(w, false) !== f) bad.push(`1人目 ${w}円：式${kisoKojo(w, false)} 備考${f}`)
      if (kisoKojo(w, true) !== s) bad.push(`2人目以降 ${w}円：式${kisoKojo(w, true)} 備考${s}`)
    }
  }
  return bad
}
