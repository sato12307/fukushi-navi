// gen-munis.mjs — 記事に埋め込む売り場の「市区町村を選ぶ」中身を作る。
//   node scripts/gen-munis.mjs   →  assets/munis.js
//
// ★なぜ別ファイルにするか
//   /pack/ は437件の <option> をHTMLに直接持っている（売り場のページなのでそれでよい）。
//   同じものを記事5枚のHTMLに埋めると、生活保護の記事の本文の真ん中に
//   全国437の市区町村名が入る。読み手にもクローラーにも記事の中身がぼやける。
//   ∴ 選択肢は別ファイルにして、ブラウザ側で <select> に流し込む。
//     キャッシュも効くので、2枚目以降の記事では読み込みが発生しない。
//
// ★元は1つ
//   選択肢は .dist/packs/_index.json（＝実際にKVへ入れた市区町村）から作る。
//   /pack/ の <option> と同じ元なので、用意できていない市区町村がボタンに出ることはない。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, '.dist', 'packs', '_index.json'), 'utf8'))
const items = idx.items.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)))

const byPref = new Map()
for (const it of items) {
  if (!byPref.has(it.pref)) byPref.set(it.pref, [])
  byPref.get(it.pref).push([it.code, it.city])
}
const data = [...byPref.entries()]

const js = `/* 記事に埋め込んだ売り場の「市区町村を選ぶ」中身。
   自動生成: node scripts/gen-munis.mjs（元は .dist/packs/_index.json＝実際に配布できる${items.length}市区町村）
   手で直さないこと。 */
window.__MUNIS = ${JSON.stringify(data)};
(function () {
  var sels = document.querySelectorAll('select[data-munsel]')
  if (!sels.length) return
  var frag = document.createDocumentFragment()
  var head = document.createElement('option')
  head.value = ''
  head.textContent = '— 選択してください —'
  frag.appendChild(head)
  for (var i = 0; i < window.__MUNIS.length; i++) {
    var pref = window.__MUNIS[i][0], list = window.__MUNIS[i][1]
    var g = document.createElement('optgroup')
    g.label = pref
    for (var j = 0; j < list.length; j++) {
      var o = document.createElement('option')
      o.value = list[j][0]
      o.textContent = pref + list[j][1]
      g.appendChild(o)
    }
    frag.appendChild(g)
  }
  // frag をそのまま append すると中身が移動して空になる。必ず複製を渡す。
  // 「— 読み込み中 —」を消してから入れる。残すと空の選択肢が2つ並ぶ。
  for (var k = 0; k < sels.length; k++) { sels[k].innerHTML = ''; sels[k].appendChild(frag.cloneNode(true)) }
})();
`
fs.writeFileSync(path.join(ROOT, 'assets', 'munis.js'), js)
console.log(`assets/munis.js ／ ${items.length}市区町村・${data.length}都道府県`)
