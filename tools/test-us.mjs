// Round-2 end-to-end test: US stocks (Eastmoney) + regression on A-share & crypto.
// 从本文件位置解析插件入口，包解压到任何路径都能直接跑
const mod = await import(new URL("../index.js", import.meta.url).href);
const routes = new Map();
mod.apply({
  effect: (fn) => { fn(); return () => {}; },
  webServer: { register: ({ path, handler }) => routes.set(path, handler) },
  get: () => undefined,
});
console.log("routes:", [...routes.keys()].length, "| name:", mod.name, "\n");

async function call(p, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const res = { status: 0, body: "" };
  res.writeHead = (s) => { res.status = s; };
  res.end = (b) => { res.body = b; };
  await routes.get(p)({ url: `${p}?${qs.toString()}` }, res);
  return res.status === 200 ? JSON.parse(res.body) : { httpError: res.status };
}

/* ---- 1. US search ---- */
for (const q of ["AAPL", "苹果", "NVDA", "特斯拉", "600519"]) {
  const r = await call("/dsh-stock-view/stocks", { q });
  const us = (r.rows || []).filter((x) => /^us/i.test(x.code)).slice(0, 4).map((x) => `${x.code}=${x.name}`);
  console.log(`search "${q}" -> ${r.rows?.length} rows | US: ${us.join("  ") || "(none)"}`);
}

/* ---- 2. US quotes ---- */
const groups = [
  { name: "美股", symbols: ["usAAPL", "usNVDA", "usBABA", "usTSLA"].map((code) => ({ code })) },
  { name: "加密货币", symbols: [{ code: "cr:BTC-USDT", name: "比特币 BTC" }] },
  { name: "A股", symbols: [{ code: "sz000001" }, { code: "sh601166" }] },
];
for (const [idx, label] of [[0, "美股"], [1, "加密货币"], [2, "A股"]]) {
  console.log(`\n===== /quotes group=${idx} ${label} =====`);
  const t0 = Date.now();
  const r = await call("/dsh-stock-view/quotes", { group: idx, minutes: 1, groups });
  console.log(`  live=${r.live} rows=${r.rows?.length} ${Date.now() - t0}ms diag=${r.diag?.firstError ?? "none"}`);
  for (const row of r.rows || []) {
    const chg = row.changePercent === undefined ? "" : `${row.changePercent >= 0 ? "+" : ""}${Number(row.changePercent).toFixed(2)}%`;
    console.log(`    ${String(row.code).padEnd(12)} ${String(row.name).padEnd(10)} live=${String(row.live).padEnd(5)} ${String(row.price ?? "-").padStart(10)} ${chg.padStart(8)} spark=${row.minutes ? row.minutes.length : 0}`);
  }
}

/* ---- 3. US detail views ---- */
console.log("\n===== /minute usAAPL =====");
const m = await call("/dsh-stock-view/minute", { code: "usAAPL" });
console.log(`  date=${m.date} prevClose=${m.prevClose} points=${m.points?.length} error=${m.error ?? "none"}`);
if (m.points?.length) console.log(`  first=${JSON.stringify(m.points[0])}\n  last =${JSON.stringify(m.points.at(-1))}`);

for (const period of ["day", "week", "month"]) {
  const k = await call("/dsh-stock-view/kline", { code: "usAAPL", period });
  console.log(`\n===== /kline usAAPL ${period} ===== candles=${k.candles?.length} error=${k.error ?? "none"}`);
  if (k.candles?.length) console.log(`  first=${JSON.stringify(k.candles[0])}\n  last =${JSON.stringify(k.candles.at(-1))}`);
}

/* ---- 4. regression ---- */
console.log("\n===== regression =====");
for (const [code, label] of [["sz000001", "A股 K线"], ["hk00700", "港股 K线"], ["cr:BTC-USDT", "加密货币 K线"]]) {
  const k = await call("/dsh-stock-view/kline", { code, period: "day" });
  console.log(`  ${label.padEnd(12)} ${code.padEnd(12)} candles=${k.candles?.length ?? k.httpError} error=${k.error ?? "none"}`);
}
const bad = await call("/dsh-stock-view/kline", { code: "usZZZZQQ", period: "day" });
console.log(`  不存在的美股  usZZZZQQ    -> error=${bad.error ?? "none"} candles=${bad.candles?.length}`);
