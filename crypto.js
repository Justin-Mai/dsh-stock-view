/**
 * dsh-stock-view — 加密货币行情 Provider
 *
 * 数据源：OKX 现货公开 REST（https://www.okx.com/docs-v5/），无需 API Key。
 *
 * 选型说明（本机实测，见 tools/probe-crypto.mjs）：
 *   - Binance  `api.binance.com`  → HTTP 451（地域限制）
 *   - CoinGecko `api.coingecko.com/simple/price` → HTTP 403（风控；仅 /search 可用）
 *   - OKX       `www.okx.com/api/v5` → 全部 200，国内可直连，且同时提供
 *     快照（/market/ticker）、多周期 K 线（/market/candles，1m~1M）、交易对清单
 *     （/public/instruments），正好覆盖本插件的 列表 / 分时 / K线 三种视图。
 *
 * 代码约定：自选股里的加密货币代码为 `cr:<instId>`，例如 `cr:BTC-USDT`、`cr:ETH-USDT`。
 * 之所以带 `cr:` 前缀，是为了在 /quotes 等路由里与 A 股(sh/sz)/港股(hk)/美股(us) 无歧义分流。
 */

const OKX = "https://www.okx.com/api/v5";
const UA = "dsh-stock-view/1.0 (DeepSeek Harness plugin)";
/** OKX 的日线以 UTC+8 0 点切分（实测 1D 时间戳落在 16:00Z），格式化日期时补齐偏移 */
const TZ_OFFSET_MS = 8 * 3600 * 1000;

/** 自选股代码前缀 */
export const CRYPTO_PREFIX = "cr:";

/** 该代码是否为加密货币 */
export function isCryptoCode(code) {
  return typeof code === "string" && code.startsWith(CRYPTO_PREFIX);
}

/** `cr:BTC-USDT` → { instId:"BTC-USDT", base:"BTC", quote:"USDT" } */
export function parseCryptoCode(code) {
  const instId = String(code ?? "").slice(CRYPTO_PREFIX.length).trim().toUpperCase();
  const [base = "", quote = ""] = instId.split("-");
  return { instId, base, quote };
}

/** 组一个自选股代码 */
export function cryptoCode(base, quote = "USDT") {
  return `${CRYPTO_PREFIX}${String(base).toUpperCase()}-${String(quote).toUpperCase()}`;
}

async function okxJson(path, timeout = 12000) {
  const res = await fetch(`${OKX}${path}`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // OKX 对「交易对不存在」返回 HTTP 200 + code:"51001" + 空 data，必须显式判错，
  // 否则备用/兜底逻辑会静默失效。
  if (json && typeof json.code === "string" && json.code !== "0") {
    throw new Error(`OKX ${json.code}: ${json.msg ?? ""}`);
  }
  return json;
}

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ 快照 */

/**
 * 单只加密货币快照（现价 / 24h 涨跌 / 24h 高低 / 成交量额）。
 * 返回形状与股票端 `fetchQuoteResult` 完全一致（{quote, prices}），便于 /quotes 统一处理。
 * @param {string} code 形如 `cr:BTC-USDT`
 * @param {boolean} withSeries 是否附带列表迷你走势（分时价格数组，5m × 48 ≈ 4h）
 * @returns {Promise<{quote:null|{price:number,changeAmount:number,changePercent:number,high:number,low:number,volume:number,amount:number,updatedAt:number}, prices:number[]}>}
 */
export async function fetchCryptoQuote(code, withSeries = false) {
  const { instId } = parseCryptoCode(code);
  if (!instId) return { quote: null, prices: [] };
  try {
    const json = await okxJson(`/market/ticker?instId=${encodeURIComponent(instId)}`);
    const t = json?.data?.[0];
    if (!t || t.last === undefined) return { quote: null, prices: [] };
    const price = num(t.last, NaN);
    if (!Number.isFinite(price)) return { quote: null, prices: [] };
    const open24h = num(t.open24h, NaN);
    const changeAmount = Number.isFinite(open24h) ? price - open24h : 0;
    const changePercent = Number.isFinite(open24h) && open24h > 0 ? (changeAmount / open24h) * 100 : 0;

    let prices = [];
    if (withSeries) {
      try {
        const cj = await okxJson(`/market/candles?instId=${encodeURIComponent(instId)}&bar=5m&limit=48`);
        prices = (cj?.data ?? [])
          .map((r) => num(r[4], NaN))
          .filter((p) => Number.isFinite(p) && p > 0)
          .reverse(); // OKX 返回新→旧，迷你走势按时间升序
      } catch {
        /* 迷你走势拿不到不影响快照 */
      }
    }

    return {
      quote: {
        price,
        changeAmount,
        changePercent,
        high: num(t.high24h),
        low: num(t.low24h),
        volume: num(t.vol24h),      // 基础币成交量（如 BTC）
        amount: num(t.volCcy24h),   // 计价币成交额（USDT）
        updatedAt: num(t.ts, Date.now()),
      },
      prices,
    };
  } catch {
    return { quote: null, prices: [] };
  }
}

/* -------------------------------------------------------------------- K线 */

const BAR_OF_PERIOD = { day: "1D", week: "1W", month: "1M" };
const LIMIT_OF_PERIOD = { day: 160, week: 120, month: 60 };

/**
 * 加密货币 K 线（升序）。返回结构与 A 股 K 线一致：{candles:[{time,open,high,low,close,volume}], error}
 */
export async function fetchCryptoKline(code, period = "day") {
  const { instId } = parseCryptoCode(code);
  const bar = BAR_OF_PERIOD[period] ?? "1D";
  const limit = LIMIT_OF_PERIOD[period] ?? 160;
  try {
    const json = await okxJson(`/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`);
    const rows = json?.data ?? [];
    if (!rows.length) return { candles: [], error: "无K线数据" };
    const candles = rows
      .map((r) => ({
        time: new Date(num(r[0]) + TZ_OFFSET_MS).toISOString().slice(0, 10),
        open: num(r[1], NaN),
        high: num(r[2], NaN),
        low: num(r[3], NaN),
        close: num(r[4], NaN),
        volume: num(r[5]),
      }))
      .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.time) && Number.isFinite(c.open) && Number.isFinite(c.close))
      .sort((a, b) => a.time.localeCompare(b.time));
    if (!candles.length) return { candles: [], error: "无K线数据" };
    return { candles, error: null };
  } catch {
    return { candles: [], error: "行情获取失败" };
  }
}

/* ------------------------------------------------------------------ 分时 */

/**
 * 加密货币「分时」= 最近 24 小时（5m × 288 ≈ 23.9h）。
 * 基准线 prevClose 取区间首根的开盘价，与 24h 涨跌口径一致。
 * @returns {Promise<{date:string|null, prevClose:number|null, points:Array<{t:number,p:number,v:number}>, error:string|null}>}
 */
export async function fetchCryptoMinute(code) {
  const { instId } = parseCryptoCode(code);
  const empty = { date: null, prevClose: null, points: [], error: null };
  try {
    const json = await okxJson(`/market/candles?instId=${encodeURIComponent(instId)}&bar=5m&limit=288`);
    const rows = json?.data ?? [];
    if (!rows.length) return { ...empty, error: "无分时数据" };
    const asc = [...rows].sort((a, b) => num(a[0]) - num(b[0]));
    const points = asc
      .map((r) => ({ t: Math.round(num(r[0]) / 1000), p: num(r[4], NaN), v: num(r[5]) }))
      .filter((p) => Number.isFinite(p.t) && p.t > 0 && Number.isFinite(p.p) && p.p > 0);
    if (!points.length) return { ...empty, error: "无分时数据" };
    const prevClose = num(asc[0][1], NaN);
    return {
      date: new Date(points[points.length - 1].t * 1000 + TZ_OFFSET_MS).toISOString().slice(0, 10),
      prevClose: Number.isFinite(prevClose) ? prevClose : points[0].p,
      points,
      error: null,
    };
  } catch {
    return { ...empty, error: "行情获取失败" };
  }
}

/* ------------------------------------------------------------------ 搜索 */

/** 常见币种中文名（本地表，命中时搜中文也能找到） */
export const COMMON_COINS = [
  { id: "btc", symbol: "BTC", name: "比特币" },
  { id: "eth", symbol: "ETH", name: "以太坊" },
  { id: "usdt", symbol: "USDT", name: "泰达币" },
  { id: "bnb", symbol: "BNB", name: "币安币" },
  { id: "sol", symbol: "SOL", name: "Solana" },
  { id: "xrp", symbol: "XRP", name: "瑞波币" },
  { id: "doge", symbol: "DOGE", name: "狗狗币" },
  { id: "ada", symbol: "ADA", name: "艾达币" },
  { id: "trx", symbol: "TRX", name: "波场" },
  { id: "avax", symbol: "AVAX", name: "雪崩" },
  { id: "link", symbol: "LINK", name: "Chainlink" },
  { id: "dot", symbol: "DOT", name: "波卡" },
  { id: "ltc", symbol: "LTC", name: "莱特币" },
  { id: "bch", symbol: "BCH", name: "比特币现金" },
  { id: "etc", symbol: "ETC", name: "以太经典" },
  { id: "uni", symbol: "UNI", name: "Uniswap" },
  { id: "ton", symbol: "TON", name: "Toncoin" },
  { id: "shib", symbol: "SHIB", name: "柴犬币" },
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
  { id: "sui", symbol: "SUI", name: "Sui" },
  { id: "apt", symbol: "APT", name: "Aptos" },
  { id: "arb", symbol: "ARB", name: "Arbitrum" },
  { id: "op", symbol: "OP", name: "Optimism" },
  { id: "hbar", symbol: "HBAR", name: "Hedera" },
  { id: "okb", symbol: "OKB", name: "OKB" },
];

let instrumentsCache = null;
const INSTRUMENTS_TTL_MS = 30 * 60 * 1000;

/** OKX 现货可交易 USDT 对（1.5MB，惰性加载 + 30 分钟缓存） */
async function loadInstruments() {
  if (instrumentsCache && Date.now() - instrumentsCache.at < INSTRUMENTS_TTL_MS) return instrumentsCache.list;
  const json = await okxJson("/public/instruments?instType=SPOT", 25000);
  const list = (json?.data ?? [])
    .filter((i) => i.state === "live" && i.quoteCcy === "USDT" && i.baseCcy && i.instId)
    .map((i) => ({ instId: i.instId, base: i.baseCcy }));
  instrumentsCache = { at: Date.now(), list };
  return list;
}

/**
 * 币种搜索：本地中文名表优先，再用 OKX 交易对清单补全（保证结果都是真实可交易的 USDT 对）。
 * @returns {Promise<Array<{code:string, name:string}>>}
 */
export async function searchCrypto(needle, limit = 30) {
  const raw = String(needle ?? "").trim();
  if (!raw) return [];
  const q = raw.toUpperCase();
  const out = [];
  const seen = new Set();
  const push = (code, name, rank) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, name, rank });
  };

  // 1) 本地中文名 / 符号
  for (const c of COMMON_COINS) {
    if (c.symbol.includes(q) || c.id.toUpperCase().includes(q) || c.name.includes(raw)) {
      push(cryptoCode(c.symbol), `${c.name} ${c.symbol}`, c.symbol === q ? 0 : 1);
    }
  }

  // 2) OKX 全量现货交易对
  try {
    const list = await loadInstruments();
    for (const i of list) {
      if (!i.instId.includes(q)) continue;
      push(cryptoCode(i.base), `${i.base} · OKX 现货`, i.base === q ? 0 : 2);
      if (out.length >= limit * 3) break;
    }
  } catch {
    /* 取不到清单时只用本地表 */
  }

  return out
    .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }));
}
