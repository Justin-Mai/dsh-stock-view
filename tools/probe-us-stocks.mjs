// Can the existing Tencent pipeline serve US stocks? Test every path the plugin uses.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "user-agent": UA, referer: "https://gu.qq.com/" };

async function probe(label, url, gbk = false) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
    const buf = new Uint8Array(await res.arrayBuffer());
    let text;
    try { text = new TextDecoder(gbk ? "gbk" : "utf-8").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const waf = text.includes("waf.tencent.com");
    console.log(`[${waf ? "WAF" : res.status}] ${label}  ${Date.now() - t0}ms`);
    console.log(`      ${text.slice(0, 230).replace(/\s+/g, " ")}`);
    return { status: res.status, text, waf };
  } catch (e) {
    console.log(`[ERR] ${label}  ${Date.now() - t0}ms  ${e.name}: ${e.message}`);
    return { status: 0, text: "" };
  }
}

// Tencent US codes: usAAPL, usNVDA, usTSLA ... (also .OQ/.N suffixes exist)
const CODES = ["usAAPL", "usNVDA"];
for (const c of CODES) {
  console.log(`\n########## ${c} ##########`);
  const snap = await probe(`qt.gtimg.cn/q=${c}`, `https://qt.gtimg.cn/q=${c}`, true);
  if (snap.text) {
    const m = snap.text.match(/="([^"]*)"/);
    if (m) {
      const f = m[1].split("~");
      console.log(`      fields=${f.length} name=${f[1]} price=${f[3]} prevClose=${f[4]} chg=${f[31]} chgPct=${f[32]} high=${f[33]} low=${f[34]}`);
    }
  }
  const min1 = await probe(`minute/query (web host)`, `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${c}&r=0.1`);
  const min2 = await probe(`minute/query (proxy mirror)`, `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?code=${c}&r=0.1`);
  if (min2.status === 200 && min2.text.trimStart().startsWith("{")) {
    const j = JSON.parse(min2.text);
    const sd = j.data?.[c];
    console.log(`      mirror: code=${j.code} minutePts=${sd?.data?.data?.length ?? 0} date=${sd?.data?.date} qtLen=${sd?.qt?.[c]?.length ?? 0}`);
  }
  await probe(`fqkline day`, `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${c},day,,,5,qfq`);
}

console.log("\n########## smartbox 搜索 (美股) ##########");
for (const q of ["AAPL", "苹果", "NVDA"]) {
  const r = await probe(`smartbox q=${q}`, `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`, true);
  const m = r.text.match(/v_hint="([^"]*)"/);
  if (m) {
    const rows = m[1].split("^").slice(0, 12).map((p) => {
      const f = p.split("~");
      return `${f[0]}:${f[1]}:${f[2]}:${f[4]}`;
    });
    console.log(`      ${rows.join("  ")}`);
  }
}
