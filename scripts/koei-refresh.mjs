// ─────────────────────────────────────────────────────────────────────────────
// koei-refresh.mjs — 過去回が残る市（川崎・静岡・横浜・神戸・相模原）の新しい回を取り込む。
//
//   node scripts/koei-refresh.mjs            # 取りに行って、増えた市だけ作り直す
//   node scripts/koei-refresh.mjs --check    # 取りに行くだけ（面は作り直さない）
//   node scripts/koei-refresh.mjs kobe       # 市を指定
//
// ★なぜ要るか（2026-09-17）
//   5市の面は「募集回を何回ぶん読んだか」が売りなのに、取り込みが手作業だった。
//   募集は静岡が年6回・神戸が年4回・川崎と横浜が年数回・相模原が年2回あるので、
//   放っておくと**面のほうが古い回で止まる**。売っている中身が古くなる。
//   [[stale-production-build-drift]]
//
// ★見張り（koei-watch.mjs）とは役割が違う。
//   見張り  … 過去回が**消える**市。中身は見ず、出た瞬間に拾って貯めるだけ。
//   こちら  … 過去回が**残る**市。増えた回があれば読み直して面まで作り直す。
//
// ★増えていなければ何もしない。毎日回しても、面もKVも触らない。
//   「作り直したかどうか」は回の数で決める。ファイルの新しさでは決めない
//   （同じ回のPDFが差し替わっただけで面を作り直すと、無駄に版が動く）。
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES } from './koei-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const want = args.filter((a) => !a.startsWith('-'))
// 取り込みの手順がある市だけ（見張りで貯めている市はここに入れない）
const KEYS = ['kawasaki', 'shizuoka', 'yokohama', 'kobe', 'sagamihara']
  .filter((k) => !want.length || want.includes(k))

const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60e3, shell: true })

const rounds = (key) => {
  const p = path.join(ROOT, 'data', `${key}-bairitsu.json`)
  if (!fs.existsSync(p)) return 0
  return new Set(JSON.parse(fs.readFileSync(p, 'utf8')).rows.map((r) => r.round)).size
}

const grew = []
const broke = []
for (const key of KEYS) {
  const C = CITIES[key]
  const before = rounds(key)
  let warn = ''
  try {
    process.stdout.write(`${C.city}：取りに行く… `)
    run('node', [`scripts/${key}-fetch.mjs`])
    run('python', [`scripts/${key}-parse.py`])
  } catch (e) {
    // ★終了コードが0でない＝失敗、とは限らない。川崎の読み取り機は「使えない回が
    //   あった」ことを終了コード1で伝えるが、使える回はちゃんと書き出している。
    //   ∴ 失敗かどうかは**読める回が残ったか**で決める。コードだけで切ると、
    //   毎回こけたことになって更新そのものが止まる（実際に止まった）。
    warn = String(e.message || e).split('\n')[0].slice(0, 120)
  }
  const after = rounds(key)
  if (!after) {
    // ★取れなかった市があっても他を止めない。出典側が落ちているだけのこともある。
    broke.push(`${C.city}: ${warn || '読める回が1つも無い'}`)
    console.log('取り込みでこけた')
    continue
  }
  if (warn) console.log(`（一部の回は使えなかった：${warn}）`)
  console.log(after > before ? `募集回 ${before} → ${after}（+${after - before}）` : `募集回 ${after}（増えていない）`)
  if (after > before) grew.push({ key, city: C.city, before, after })
}

if (!grew.length) {
  console.log('\n新しい回はありませんでした。面もKVも触っていません。')
} else if (CHECK) {
  console.log(`\n増えた市 ${grew.length}：${grew.map((g) => `${g.city}(+${g.after - g.before})`).join('・')}`)
  console.log('--check なので面は作り直していません。')
} else {
  console.log(`\n▶ 増えた ${grew.length}市の面と有料資料を作り直します`)
  for (const g of grew) {
    run('node', ['scripts/koei-nerai.mjs', g.key])
    run('node', ['scripts/koei-put-pack.mjs', g.key])
    console.log(`  ✓ ${g.city}  ${g.before} → ${g.after}回`)
  }
  // ★生成器を回すと計測ビーコンが生成面から剥がれる。関所の前に必ず貼り直す。
  //   [[deploy-gate-after-generators]]
  run('node', ['scripts/stamp-offers.mjs'])
  run('node', ['scripts/toei-check.mjs'])
  console.log('\n計測の貼り直しと見え方の関所まで通りました。あとは push すれば公開されます。')
}

if (broke.length) {
  console.error(`\n★取り込めなかった市 ${broke.length}：`)
  broke.forEach((b) => console.error('  ' + b))
  process.exitCode = 1
}
