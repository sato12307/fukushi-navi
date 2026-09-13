// カワルヒ層のブロック。金額を答えている面に「この金額はいつ決まったのか・次はいつか」を添える。
//
// ★なぜ作るか（2026-09-14）
//   金額を1つ受け取って帰る面は、その金額がいずれ変わるのに、変わったことを知る方法が無い。
//   だから一度きりで終わる。答えの隣に「賞味期限」を置くと、その日にまた見に来る理由になる。
//
// ★書いてよいことの線引き（ここが一番大事）
//   一次情報で確認できた値だけを出す。data/kaitei.json の _rule に書いたとおり、
//   法令の「改正履歴の日付」を「金額が決まった日」として出してはならない。
//   実測で、公営住宅法施行令の直近改正は建築物省エネ関係で金額とは無関係だった。
//   4行のうち埋まらない行は【出さない】。推測で埋めるくらいなら空けておく。
//   分かっていないことは「確認できませんでした」と本文に書く（黙って省かない）。
//
// ★見た目は既存の .callout を使う。新しいクラスを作らない。
//   艦隊で「未定義のclassでボタンが素の灰色になる」事故が2回起きている。
//   ここは白いカードでも購入ボタンでもなく、本文の注記と同じ格で足りる区画なので、
//   .callout.note に乗せるのが正しい（売り場＝.offer とは別物に見せる）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const KAITEI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kaitei.json'), 'utf8'))

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// 「2026-10-01」→「2026年10月1日」。日付が無ければ空。
const jp = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : ''
}

/**
 * カワルヒ層のブロックを組む。
 *   key … data/kaitei.json の items のキー
 * 返すのは HTML 文字列。埋まらない行は出さない。
 */
export function kaiteiBlock(key) {
  const it = KAITEI.items[key]
  if (!it) throw new Error(`kaitei-block: 未知のキー ${key}`)

  const rows = []

  // ① いまの値（必ずある）
  // ★小さい注記に class="fine" を使わないこと。style.css の定義は `.offer .fine` に
  //   スコープされていて、コールアウトの中では一切効かない（空回しで実測）。
  //   素の <small> はブラウザ既定で小さくなるので、CSSを足さずに済む。
  rows.push(`<p><strong>いまの値</strong><br>${esc(it.now)}${it.nowNote ? `<br><small>${esc(it.nowNote)}</small>` : ''}</p>`)

  // ② 決めた日／いつ時点の値か
  //   告示・政令で日付が特定できたものは日付を、できなかったものは「いつ時点の法令か」だけを出す。
  if (it.decidedText) {
    // ★appliedText は「令和8年10月1日から適用」のように文として完結している。
    //   これを「適用は〜から」で包むと「適用は…から適用から」と二重になる（初回の空回しで実際に出た）。
    rows.push(`<p><strong>決めた日</strong><br>${esc(it.decidedText)}${it.applied ? `<br>${esc(it.appliedText || `適用は${jp(it.applied)}から`)}` : ''}</p>`)
  } else if (it.asOfText) {
    rows.push(`<p><strong>いつ時点の値か</strong><br>${esc(it.asOfText)}${it.basis ? `（根拠：${esc(it.basis)}）` : ''}</p>`)
  } else if (it.basis) {
    rows.push(`<p><strong>根拠</strong><br>${esc(it.basis)}</p>`)
  }

  // ③ 前回いくら動いたか
  if (it.lastChange) {
    const hist = (it.history || []).length >= 2
      ? `<br><small>${it.history.map((h) => `${esc(h.appliedText || jp(h.applied))}　${esc(h.amount)}`).join('　→　')}</small>`
      : ''
    rows.push(`<p><strong>前回いくら動いたか</strong><br>${esc(it.lastChange)}${hist}</p>`)
  } else if (it.lastChangeNote) {
    rows.push(`<p><strong>前回いくら動いたか</strong><br>${esc(it.lastChangeNote)}</p>`)
  }

  // ④ 次に確定する日
  if (it.nextText) {
    const badge = it.next ? `<strong>${esc(jp(it.next))}</strong>まで。` : ''
    rows.push(`<p><strong>次に確定する日</strong><br>${badge}${esc(it.nextText)}</p>`)
  }

  const src = (it.sources || []).map((s) => `<a href="${esc(s.url)}" rel="nofollow">${esc(s.name)}</a>`).join('　／　')

  return `  <div class="callout note" data-kaitei="${esc(key)}">
  <p><strong>この金額は、いつ決まったものか</strong></p>
  ${rows.join('\n  ')}
  <p class="updated">出典：${src}<br>当サイトが一次情報を直接読んで確認した内容です（確認日 ${esc(KAITEI.verifiedAt)}）。制度の適用可否は必ず窓口でご確認ください。</p>
  </div>`
}

/** どのキーが4行フルで埋まっているか（検算用） */
export function kaiteiCoverage() {
  const out = {}
  for (const [k, it] of Object.entries(KAITEI.items)) {
    out[k] = {
      now: !!it.now,
      decided: !!(it.decidedText || it.asOfText || it.basis),
      lastChange: !!(it.lastChange || it.lastChangeNote),
      next: !!it.nextText,
      full: !!(it.now && it.decidedText && it.lastChange && it.next),
    }
  }
  return out
}
