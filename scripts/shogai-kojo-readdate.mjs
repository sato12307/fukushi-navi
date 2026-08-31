// ─────────────────────────────────────────────────────────────────────────────
// shogai-kojo-readdate.mjs — 「その原典を、いつ読んだのか」を1か所で持つ。
//
// ★なぜ要るのか
//   収集器はキャッシュ優先で動く（相手は自治体の共用サーバなので当然そうする）。
//   ところがページ側は `new Date()` を「読み取り日」として出していた。
//   つまり**原典を1件も取りに行かずにビルドし直すだけで、438枚すべてが
//   「今日、公表資料を確認した」と書いた状態で公開される**。確認していないのに。
//   艦隊で実測済みの事故型。[[crawl-date-flattening]]
//   ∴ 読み取り日は「取ってきた側」だけが知っている事実として記録し、
//     ページはそれを出す。ビルド日は読み取り日ではない。
//
// ★台帳の置き場はキャッシュの隣
//   キャッシュを消せば台帳も消える＝次は全件を取り直して新しい日付が入る。
//   この2つがずれると「取り直していないのに新しい日付」が復活するので、必ず同居させる。
//
// ★台帳より前に取ってあったぶんは、キャッシュファイルの更新時刻から埋める
//   実測でこれは正しい: 例規1,124件と大都市32件はすべて 2026-08-27（本番に出ている
//   438枚と同じ日付）、別表は1,241件が08-27で**31件だけ08-28**。定数で一律に埋めると
//   この31件を1日古く言うことになる。更新時刻が読めないときだけ初回収集日に落とす。
//   ここで `new Date()` に落とすと、直したはずの嘘がそのまま戻る。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'

export const SEED_READ_DATE = '2026-08-27'
// ★日本時間で数える。UTC の `toISOString()` で切ると、日本の深夜に取ってきた原典が
//   前日の日付で記録される（実際に 2026-09-01 02:20 JST の取得が 08-31 になった）。
//   読者も原典も日本にあるので、日付は JST で書く。sv-SE は YYYY-MM-DD で出る。
const jstDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d)
export const today = () => jstDate(new Date())

export function readDateLedger(cacheDir) {
  const file = path.join(cacheDir, '_read-dates.json')
  let map = {}
  try { map = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { map = {} }
  let dirty = false
  const save = () => {
    if (!dirty) return
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(map, null, 1))
    dirty = false
  }
  return {
    // 今この場で取ってきた＝今日が読み取り日。
    // 途中で落ちても取得ぶんを失わないよう、その場で台帳に書く。
    stamp(name) { map[name] = today(); dirty = true; save(); return map[name] },
    // キャッシュを使い回した＝前に取った日が読み取り日。
    // 台帳より前のぶんは file の更新時刻から埋め、以後は台帳を正典にする。
    of(name, file) {
      if (!map[name]) {
        let d = SEED_READ_DATE
        try {
          const m = jstDate(fs.statSync(file || path.join(cacheDir, name)).mtime)
          if (m) d = m
        } catch { /* 更新時刻が読めなければ初回収集日 */ }
        map[name] = d; dirty = true
      }
      return map[name]
    },
    save,
  }
}

// 収録した全件が同じ日ならその日、ばらけていれば範囲で書く。
// 「いちばん新しい日」だけを出すと、古いまま据え置かれた自治体まで
// 新しく確認したように読めてしまう。
export const asOf = (dates) => {
  const d = [...new Set(dates.filter(Boolean))].sort()
  if (!d.length) return SEED_READ_DATE
  return d.length === 1 ? d[0] : `${d[0]}〜${d[d.length - 1]}`
}
export const latestOf = (dates) => {
  const d = [...new Set(dates.filter(Boolean))].sort()
  return d.length ? d[d.length - 1] : SEED_READ_DATE
}
