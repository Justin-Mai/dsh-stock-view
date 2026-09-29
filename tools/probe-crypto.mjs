// Verify crypto data sources from THIS machine before designing the plugin.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { accept: "application/json", "user-agent": UA };

async function get(label, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    return { label, status: res.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { label, status: 0, ms: Date.now() - t0, text: `${e.name}: ${e.message}` };
  }
}

const ok = async (label, url, pick) => {
  const r = await get(label, url);
  console.log(`[${r.status === 200 ? "OK " : "ERR"}] ${label.padEnd(34)} HTTP ${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)}ms`);
  if (r.status === 200 && pick) {
    try {
      console.log(`        ${pick(JSON.parse(r.text))}`);
    } catch (e) {
      console.log(`        parse fail: ${e.message} :: ${r.text.slice(0, 120)}`);
    }
  } else if (r.status !== 200) {
    console.log(`        ${r.text.slice(0, 120).replace(/\s+/g, " ")}`);
  }
};

console.log("=== OKX (国内可直连，实时/无额度压力) ===");
await ok("OKX ticker BTC-USDT", "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", (j) => {
  const t = j.data[0];
  return `last=${t.last} open24h=${t.open24h} high24h=${t.high24h} low24h=${t.low24h} vol24h=${t.vol24h} ts=${t.ts}`;
});
await ok("OKX ticker ETH-USDT", "https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT", (j) => `last=${j.data[0].last}`);
await ok("OKX candles 1m x300 (分时)", "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1m&limit=300", (j) => {
  const rows = j.data || [];
  return `rows=${rows.length} newest=[${rows[0]}] oldest=[${rows[rows.length - 1]}]`;
});
await ok("OKX candles 1D x60 (日K)", "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=60", (j) => {
  const rows = j.data || [];
  return `rows=${rows.length} newest=[${rows[0]}]`;
});
await ok("OKX candles 1W x40 (周K)", "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1W&limit=40", (j) => `rows=${(j.data || []).length}`);
await ok("OKX candles 1M x24 (月K)", "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1M&limit=24", (j) => `rows=${(j.data || []).length}`);

console.log("\n=== CoinGecko (法币/CNY 计价 + 搜索) ===");
await ok("CG simple/price BTC cny,usd 24h", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=cny,usd&include_24hr_change=true&include_last_updated_at=true", (j) => JSON.stringify(j).slice(0, 200));
await ok("CG search 'sol'", "https://api.coingecko.com/api/v3/search?query=sol", (j) => `coins=${(j.coins || []).length} top=${JSON.stringify((j.coins || []).slice(0, 2).map((c) => ({ id: c.id, symbol: c.symbol })))}`);

console.log("\n=== Binance (stockview 标注为被墙，验证一下) ===");
await ok("Binance ticker BTCUSDT", "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
