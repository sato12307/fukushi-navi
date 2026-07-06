// IndexNow ping — sitemap.xml の全URLを Bing/Yandex 系へ即時通知する。
// 新規ドメインの最大ボトルネック=インデックス速度を直接叩く（日次ビルド後に実行）。
// key は public/<key>.txt として配信済み（IndexNow の所有権証明方式）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "fukushiru.com";
const KEY = (readFileSync(join(ROOT, "indexnow.env"), "utf8").match(/INDEXNOW_KEY=([a-f0-9]+)/) || [])[1];
if (!KEY) { console.error("no key"); process.exit(1); }

const sm = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
console.log(`IndexNow: ${urls.length} urls -> api.indexnow.org`);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow response: HTTP ${res.status} ${res.statusText}`);
// 200/202 = 受理。4xx はキー未伝播直後などで起こりうる（致命でないため exit 0 のまま日次を止めない）
