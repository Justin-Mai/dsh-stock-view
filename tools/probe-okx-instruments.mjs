// Inspect OKX SPOT instruments (for the crypto search box) + 1m/5m minute behaviour.
const r = await fetch("https://www.okx.com/api/v5/public/instruments?instType=SPOT", {
  headers: { accept: "application/json", "user-agent": "dsh-stock-view/1.0" },
  signal: AbortSignal.timeout(20000),
});
const text = await r.text();
console.log(`HTTP ${r.status}  bytes=${text.length}`);
const j = JSON.parse(text);
const all = j.data || [];
console.log(`instruments: ${all.length}`);
console.log("sample row:", JSON.stringify(all[0]));

const usdt = all.filter((i) => i.quoteCcy === "USDT" && i.state === "live");
console.log(`live USDT pairs: ${usdt.length}`);
console.log("first 12:", usdt.slice(0, 12).map((i) => i.instId).join(" "));

// how would a search for "btc" / "sol" / "狗" behave?
for (const q of ["btc", "sol", "eth"]) {
  const hits = usdt.filter((i) => i.instId.toLowerCase().includes(q)).slice(0, 8).map((i) => i.instId);
  console.log(`  search "${q}" -> ${hits.length} shown: ${hits.join(" ")}`);
}

// 5m candles: how many hours does limit=288 cover?
const c = await fetch("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=288", {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(15000),
});
const cj = await c.json();
const rows = cj.data || [];
const newest = Number(rows[0][0]);
const oldest = Number(rows[rows.length - 1][0]);
console.log(`\n5m x ${rows.length}: spans ${((newest - oldest) / 3600000).toFixed(1)}h`);
console.log(`  newest ${new Date(newest).toISOString()}  oldest ${new Date(oldest).toISOString()}`);

// 1D candles alignment: check the timestamp of a daily candle
const d = await (await fetch("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=3", { headers: { accept: "application/json" } })).json();
for (const row of d.data || []) console.log(`  1D ts=${row[0]} -> ${new Date(Number(row[0])).toISOString()}  o=${row[1]} c=${row[4]}`);
