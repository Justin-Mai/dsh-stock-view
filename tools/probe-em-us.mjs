// Eastmoney US-stock endpoints (what stock-sdk uses): quick-lookup / kline / trends.
const H = { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36", referer: "https://quote.eastmoney.com/" };
const EM_PUSH = "https://push2.eastmoney.com";
const EM_HIS = "https://push2his.eastmoney.com";

async function get(label, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log(`[${res.status}] ${label}  ${Date.now() - t0}ms  len=${text.length}`);
    return text;
  } catch (e) {
    console.log(`[ERR] ${label}  ${Date.now() - t0}ms  ${e.name}: ${e.message}`);
    return "";
  }
}

const SNAP_FIELDS = "f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f168,f169,f170,f171";

console.log("=== 1. 快照（secid: 105=NASDAQ 106=NYSE 107=AMEX）===");
for (const [secid, label] of [["105.AAPL", "AAPL@NASDAQ"], ["105.NVDA", "NVDA@NASDAQ"], ["106.BABA", "BABA@NYSE"], ["105.TSLA", "TSLA@NASDAQ"]]) {
  const t = await get(`quote/get ${label}`, `${EM_PUSH}/api/qt/stock/get?secid=${secid}&fields=${SNAP_FIELDS}&invt=2&fltt=2`);
  try {
    const d = JSON.parse(t).data;
    if (!d) { console.log(`      (data=null → secid 可能不对)`); continue; }
    console.log(`      name=${d.f58} code=${d.f57} price=${d.f43} prevClose=${d.f60} open=${d.f46} high=${d.f44} low=${d.f45}`);
    console.log(`      chg=${d.f169} chgPct=${d.f170} vol=${d.f47} amount=${d.f48} decimals=${d.f59} turnover=${d.f168} amp=${d.f171}`);
  } catch (e) { console.log(`      parse: ${e.message} :: ${t.slice(0, 150)}`); }
}

console.log("\n=== 2. 日K ===");
for (const [klt, name] of [["101", "day"], ["102", "week"], ["103", "month"]]) {
  const t = await get(`kline klt=${klt} (${name})`, `${EM_HIS}/api/qt/stock/kline/get?secid=105.AAPL&klt=${klt}&fqt=1&lmt=6&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`);
  try {
    const d = JSON.parse(t).data;
    console.log(`      name=${d?.name} code=${d?.code} klines=${d?.klines?.length}`);
    for (const k of (d?.klines ?? []).slice(-3)) console.log(`        ${k}`);
  } catch (e) { console.log(`      parse: ${e.message} :: ${t.slice(0, 150)}`); }
}

console.log("\n=== 3. 分时 trends2 (ndays=1) ===");
const tr = await get("trends2 ndays=1", `${EM_HIS}/api/qt/stock/trends2/get?secid=105.AAPL&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`);
try {
  const d = JSON.parse(tr).data;
  console.log(`      name=${d?.name} preClose=${d?.preClose} trends=${d?.trends?.length}`);
  console.log(`      first=${d?.trends?.[0]}`);
  console.log(`      last =${d?.trends?.at(-1)}`);
} catch (e) { console.log(`      parse: ${e.message} :: ${tr.slice(0, 200)}`); }

console.log("\n=== 4. secid 搜索引擎（用于代码→secid 解析）===");
const s = await get("search api", `${EM_PUSH}/api/qt/stock/search?input=苹果&type=0&count=5`);
console.log(`      ${s.slice(0, 300)}`);
