// shotoku-core.mjs — 収入から所得を出す式（給与所得控除・公的年金等控除）。計算機の面の <script> にそのまま埋め込む文字列。
//   使う所：kouki-page.mjs（後期高齢者医療保険料）・teate-jifute-page.mjs（児童扶養手当）（2026-10-20〜）
// ★令和7年分（2025年の収入＝令和8年度の住民税・保険料、2026年11月分〜の手当の所得）の表。原典は国税庁タックスアンサー
//   No.1410（給与所得控除＝最低65万円・190万円超660万円未満は収入を4,000円未満切捨て）・No.1600（公的年金等控除）。
//   後期高齢者の東京都の計算例（給与120万・148万・200万・500万・900万円）で円まで合うことを kouki-page.mjs が確かめている。
// ★ブラウザでもそのまま動く書き方（var・function）。ここを直したら、使う生成器を全部回し直して確かめを通す。
export const SHOTOKU_CORE = `function kyuyoShotoku(r) { var fl = Math.floor, s; if (r <= 0) return 0;
  if (r <= 1900000) s = r - 650000;
  else if (r < 6600000) { var a = fl(r / 4000) * 4000; s = r <= 3600000 ? fl(a * 70 / 100) - 80000 : fl(a * 80 / 100) - 440000; }
  else if (r <= 8500000) s = fl(r * 90 / 100) - 1100000;
  else s = r - 1950000;
  return Math.max(0, s); }
function nenkinShotoku(r, other, age65) { var fl = Math.floor, s, b; if (r <= 0) return 0; b = other <= 10000000 ? 0 : other <= 20000000 ? 100000 : 200000;
  if (age65) { if (r <= 1100000 - b) s = 0; else if (r < 3300000) s = r - (1100000 - b); else if (r < 4100000) s = fl(r * 75 / 100) - (275000 - b); }
  else { if (r <= 600000 - b) s = 0; else if (r < 1300000) s = r - (600000 - b); else if (r < 4100000) s = fl(r * 75 / 100) - (275000 - b); }
  if (s === undefined) { if (r < 7700000) s = fl(r * 85 / 100) - (685000 - b); else if (r < 10000000) s = fl(r * 95 / 100) - (1455000 - b); else s = r - (1955000 - b); }
  return Math.max(0, s); }`
