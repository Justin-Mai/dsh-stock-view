// End-to-end test of the forked plugin: import index.js, capture its routes, invoke them.
// 从本文件位置解析插件入口，包解压到任何路径都能直接跑
const mod = await import(new URL("../index.js", import.meta.url).href);

const routes = new Map();
mod.apply({
  effect: (fn) => { fn(); return () => {}; },
  webServer: { register: ({ path, handler }) => routes.set(path, handler) },
  get: () => undefined,
});
console.log("plugin name :", mod.name);
console.log("routes      :", [...routes.keys()].join(", "), "\n");

async function call(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const res = { status: 0, body: "" };
  res.writeHead = (s) => { res.status = s; };
  res.end = (b) => { res.body = b; };
  await routes.get(path)({ url: `${path}${qs.toString() ? "?" + qs.toString() : ""}` }, res);
  return res.status === 200 ? JSON.parse(res.body) : { httpError: res.status, body: res.body };
}

/* ---------- 1. search ---------- */
for (const q of ["btc", "sol", "狗", "600", "平安"]) {
  const r = await call("/dsh-stock-view/stocks", { q });
  const shows = (r.rows || []).slice(0, 6).map((x) => `${x.code}=${x.name}`);
  console.log(`search "${q}" -> ${r.rows?.length ?? "ERR"} rows`);
  console.log(`   ${shows.join("  |  ")}`);
}

/* ---------- 2. crypto quotes ---------- */
const groups = [
  { name: "加密货币", symbols: [
    { code: "cr:BTC-USDT", name: "比特币 BTC" },
    { code: "cr:ETH-USDT", name: "以太坊 ETH" },
    { code: "cr:SOL-USDT", name: "Solana SOL" },
  ] },
  { name: "分红", symbols: [{ code: "sz000001" }, { code: "sh601166" }] },
];
for (const [idx, label] of [[0, "加密货币"], [1, "分红(A股)"]]) {
  console.log(`\n===== /quotes group=${idx} ${label} =====`);
  const t0 = Date.now();
  const r = await call("/dsh-stock-view/quotes", { group: idx, minutes: 1, groups });
  console.log(`  live=${r.live} rows=${r.rows?.length} ${Date.now() - t0}ms diag=${r.diag?.firstError ?? "none"}`);
  for (const row of r.rows || []) {
    const chg = row.changePercent === undefined ? "" : `${row.changePercent >= 0 ? "+" : ""}${Number(row.changePercent).toFixed(2)}%`;
    console.log(`    ${String(row.code).padEnd(14)} ${String(row.name).padEnd(12)} live=${String(row.live).padEnd(5)} ${String(row.price ?? "-").padStart(11)} ${chg.padStart(8)}  minutes=${row.minutes ? row.minutes.length : 0}`);
  }
}

/* ---------- 3. crypto detail views ---------- */
console.log("\n===== /minute cr:BTC-USDT (24h 5m) =====");
const m = await call("/dsh-stock-view/minute", { code: "cr:BTC-USDT" });
console.log(`  date=${m.date} prevClose=${m.prevClose} points=${m.points?.length} error=${m.error ?? "none"}`);
if (m.points?.length) console.log(`  first=${JSON.stringify(m.points[0])}\n  last =${JSON.stringify(m.points.at(-1))}`);

for (const period of ["day", "week", "month"]) {
  const k = await call("/dsh-stock-view/kline", { code: "cr:BTC-USDT", period });
  console.log(`\n===== /kline cr:BTC-USDT ${period} ===== candles=${k.candles?.length} error=${k.error ?? "none"}`);
  if (k.candles?.length) console.log(`  first=${JSON.stringify(k.candles[0])}\n  last =${JSON.stringify(k.candles.at(-1))}`);
}

/* ---------- 4. stock detail still works ---------- */
const k2 = await call("/dsh-stock-view/kline", { code: "sz000001", period: "day" });
console.log(`\n===== /kline sz000001 day (regression) ===== candles=${k2.candles?.length} error=${k2.error ?? "none"}`);
const m2 = await call("/dsh-stock-view/minute", { code: "sz000001" });
console.log(`===== /minute sz000001 (regression) ===== points=${m2.points?.length} error=${m2.error ?? "none"}`);
