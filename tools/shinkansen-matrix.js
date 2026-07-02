// 障害者割引後 運賃マトリックス生成スクリプト
// 使い方: node tools/shinkansen-matrix.js  → 標準出力の <table> を
//   articles/shinkansen-airplane-discount.html の該当テーブルに貼り替える。
//
// ★ F の元運賃（乗車券 / のぞみ指定特急・通常期）は best-effort の【概算】です。
//   公開前・更新時に JR 各社の公式運賃で必ず検証してください。
//   東京-新大阪 約10,300 / 新大阪-博多 約10,900 が既存記事の値と一致することを検算済み。
const st = ["東京","名古屋","京都","新大阪","岡山","広島","博多"];
// 上三角のみ定義。[乗車券, 指定特急(通常期のぞみ)]（円）
const F = {
 "東京|名古屋":[6380,4920],"東京|京都":[8360,5810],"東京|新大阪":[8910,5810],
 "東京|岡山":[10480,7330],"東京|広島":[11880,8360],"東京|博多":[14080,9130],
 "名古屋|京都":[2640,3070],"名古屋|新大阪":[3410,3270],"名古屋|岡山":[6380,5490],
 "名古屋|広島":[8360,6560],"名古屋|博多":[11000,7660],
 "京都|新大阪":[580,2530],"京都|岡山":[3740,4270],"京都|広島":[6380,5490],"京都|博多":[9130,6560],
 "新大阪|岡山":[3080,3270],"新大阪|広島":[5720,4960],"新大阪|博多":[9790,6030],
 "岡山|広島":[2640,3070],"岡山|博多":[6380,4960],
 "広島|博多":[4070,4890],
};
// 100km以下（本人単独割引 対象外）の区間キー
const under100 = new Set(["京都|新大阪"]);
const r10 = n => Math.round(n/10)*10, r100 = n => Math.round(n/100)*100;
function cell(a,b){
  if(a===b) return {t:"—",cls:"diag"};
  const key = st.indexOf(a)<st.indexOf(b) ? `${a}|${b}` : `${b}|${a}`;
  const f = F[key]; if(!f) return {t:"?",cls:""};
  if(under100.has(key)) return {t:"対象外",cls:"na",sub:"100km以下"};
  const total = r10(f[0]/2) + f[1];
  return {t:"約"+r100(total).toLocaleString()+"円",cls:"yes",sub:""};
}
let h='  <div class="table-wrap">\n  <table class="fare-matrix">\n';
h+='    <caption>障害者割引適用後の合計運賃マトリックス（本人単独・のぞみ普通車指定席・通常期／2026年時点の通常運賃をもとにした<strong>概算</strong>。乗車券5割引＋特急料金は割引なしで試算。端数・最新額・季節変動・列車は要確認）</caption>\n';
h+='    <thead><tr><th scope="col">出発＼到着</th>'+st.map(s=>`<th scope="col">${s}</th>`).join('')+'</tr></thead>\n    <tbody>\n';
for(const a of st){
  h+=`      <tr><th scope="row">${a}</th>`;
  for(const b of st){
    const c=cell(a,b);
    const sub=c.sub?`<br><small>${c.sub}</small>`:'';
    h+=`<td class="${c.cls}">${c.t}${sub}</td>`;
  }
  h+='</tr>\n';
}
h+='    </tbody>\n  </table>\n  </div>';
console.log(h);
