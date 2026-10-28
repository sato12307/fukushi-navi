// 年金生活者支援給付金の計算機（shien-kyufukin-page.mjs）の検算に使う、日本年金機構・厚生労働省が公表している計算例。
// ★面には出さない（scripts/ は公開しない）。数字は「計算機が公式と円まで合うか」を確かめるためだけに使う（2026-10-28 に写した）。
// ★公式の数字入りの例は、老齢（納付済480月・420月・240月＋全額免除60月）・遺族（子3人）・障害（1級・2級の額）だけ見つかった。
//   補足的老齢年金生活者支援給付金の数字入りの例は、年金機構・厚労省のどちらにも見つからなかった（data の kakuninchu）。
// x＝計算機に入れる値（kind＝rourei|shogai|izoku、birth＝生年月日、asOf＝判定の日、nofu＝保険料納付済月数、zen＝全額・4分の3・半額免除の月数、
//   q＝4分の1免除の月数、nenkin＝前年の公的年金等の収入、kyuyo＝給与収入、sonota＝その他の所得、hikazei＝世帯全員が住民税非課税か、
//   tokyu＝障害等級、ko＝遺族基礎年金を受けている子の数（子が受けるとき）、want＝月額、nendo＝'r7' なら令和7年度の額で計算）。
const AS_OF = '2026-10-01'
const R = (o) => ({ kind: 'rourei', birth: '1958-06-15', asOf: AS_OF, nenkin: 780000, kyuyo: 0, sonota: 0, hikazei: true, zen: 0, q: 0, ...o })
export const CASES = [
  // 年金機構 Q&A「昨年度と金額が違うのですが」（kaiteitsuchi/keisan.html）の表＝令和8年度
  { src: 'nenkin-faq-keisan', x: R({ nofu: 480 }), want: 5620 },
  { src: 'nenkin-faq-keisan', x: R({ nofu: 420 }), want: 4918 },
  { src: 'nenkin-faq-keisan・nenkin-rourei', x: R({ nofu: 240, zen: 60 }), want: 4281 },
  // 同じ表の令和7年度の列（令和7年度の基準額 5,450円・免除 11,551円で同じ式が合うか）
  { src: 'nenkin-faq-keisan（令和7年度）', nendo: 'r7', x: R({ nofu: 480 }), want: 5450 },
  { src: 'nenkin-faq-keisan（令和7年度）', nendo: 'r7', x: R({ nofu: 420 }), want: 4769 },
  { src: 'nenkin-faq-keisan（令和7年度）', nendo: 'r7', x: R({ nofu: 240, zen: 60 }), want: 4169 },
  // 厚労省「年金生活者支援給付金制度について」の給付額の例（納付済480月・免除0月）
  { src: 'mhlw-system', x: R({ nofu: 480, birth: '1960-04-02' }), want: 5620 },
  // 障害（年金機構「障害年金生活者支援給付金の概要」）
  { src: 'nenkin-syougai', x: { kind: 'shogai', tokyu: 1, birth: '1985-05-05', asOf: AS_OF, nenkin: 0, kyuyo: 0, sonota: 0 }, want: 7025 },
  { src: 'nenkin-syougai', x: { kind: 'shogai', tokyu: 2, birth: '1985-05-05', asOf: AS_OF, nenkin: 0, kyuyo: 0, sonota: 0 }, want: 5620 },
  // 遺族（年金機構「遺族年金生活者支援給付金の概要」・厚労省の給付額の例）：3人の子が遺族基礎年金を受けている場合の1人あたり
  { src: 'nenkin-izoku・mhlw-system', x: { kind: 'izoku', ko: 3, birth: '2012-01-10', asOf: AS_OF, nenkin: 0, kyuyo: 0, sonota: 0 }, want: 1873 },
  { src: 'nenkin-izoku', x: { kind: 'izoku', ko: 0, birth: '1988-03-03', asOf: AS_OF, nenkin: 0, kyuyo: 0, sonota: 0 }, want: 5620 },
]

// 境目の確かめ（公式の例ではなく、公式の「以下」「超え」の文言どおりに分かれるか）。want＝'rourei'|'hosoku'|null（対象外）
export const EDGES = [
  { x: R({ nofu: 480, nenkin: 826500 }), want: 'rourei' },
  { x: R({ nofu: 480, nenkin: 826501 }), want: 'hosoku' },
  { x: R({ nofu: 480, nenkin: 926500 }), want: 'hosoku' },
  { x: R({ nofu: 480, nenkin: 926501 }), want: null },
  { x: R({ nofu: 480, nenkin: 824100, birth: '1956-04-01' }), want: 'rourei' },
  { x: R({ nofu: 480, nenkin: 824101, birth: '1956-04-01' }), want: 'hosoku' },
  { x: R({ nofu: 480, nenkin: 924101, birth: '1956-04-01' }), want: null },
  { x: R({ nofu: 480, hikazei: false }), want: null },
  { x: R({ nofu: 480, birth: '1962-01-01' }), want: null },
]
