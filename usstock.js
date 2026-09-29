/**
 * dsh-stock-view — 美股行情 Provider（东方财富）
 *
 * 为什么不用腾讯：实测（tools/probe-us-stocks.mjs）腾讯对美股三个接口都不完整——
 *   - `minute/query` 的 `data.data` 只有 1 个点、`date` 为空（拿不到分时）
 *   - `fqkline/get` 的 `day` 只回「最早一根 + 最新一根」（拿不到 K 线序列）
 *   - 行情字段首项为 `"delay"`，即延时数据
 * 而 [stock-sdk](https://github.com/chengzuopeng/stock-sdk) 对美股走的是东方财富，实测完整可用：
 *   - 快照  `/api/qt/stock/get`        （现价/涨跌/开高低/量额）
 *   - K 线  `/api/qt/stock/kline/get`  （klt=101/102/103 日/周/月，fqt=1 前复权）
 *   - 分时  `/api/qt/stock/trends2/get`（ndays=1，实测 391 个点）
 *
 * secid 前缀（与 stock-sdk 一致）：105=NASDAQ、106=NYSE、107=AMEX。
 * 代码约定：`us<股票代码>`，如 `usAAPL`、`usNVDA`（大小写不敏感）。
 */

const EM_PUSH = "https://push2.eastmoney.com";
const EM_HIS = "https://push2his.eastmoney.com";
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://quote.eastmoney.com/",
};

/** 交易所前缀：105=NASDAQ 106=NYSE 107=AMEX */
const US_EXCHANGES = ["105", "106", "107"];
/** smartbox 的交易所后缀 → secid 前缀 */
const SUFFIX_TO_EXCHANGE = { OQ: "105", N: "106", AM: "107" };

/** 该代码是否为美股（加密货币的 cr: 前缀不匹配） */
export function isUSCode(code) {
  return typeof code === "string" && /^us/i.test(code);
}

/** `usAAPL` → { ticker:"AAPL" } */
export function parseUSCode(code) {
  const raw = String(code ?? "").replace(/^us/i, "").trim().toUpperCase();
  const ticker = raw.split(".")[0]; // 容忍 `AAPL.OQ` 写法
  const suffix = raw.includes(".") ? raw.split(".")[1] : "";
  return { ticker, suffix };
}

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

async function emJson(url, timeout = 12000) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ----------------------------------------------------------- secid 解析 */

/** ticker → secid（null 表示确认不存在），进程内缓存 */
const SECID_CACHE = new Map();

/**
 * 用 smartbox 返回的交易所后缀直接确定 secid，省掉一次探测。
 * @param {string} ticker 如 "AAPL"
 * @param {string} suffix 如 "oq" / "n" / "am"
 */
export function seedUSSecid(ticker, suffix) {
  const t = String(ticker ?? "").toUpperCase();
  const ex = SUFFIX_TO_EXCHANGE[String(suffix ?? "").toUpperCase()];
  if (t && ex) SECID_CACHE.set(t, `${ex}.${t}`);
}

/** 解析 ticker → secid；未知时按 105/106/107 依次探测（参考 stock-sdk） */
export async function resolveUSSecid(code) {
  const { ticker, suffix } = parseUSCode(code);
  if (!ticker) return null;
  if (SECID_CACHE.has(ticker)) return SECID_CACHE.get(ticker);
  if (suffix) seedUSSecid(ticker, suffix);
  if (SECID_CACHE.has(ticker)) return SECID_CACHE.get(ticker);
  for (const ex of US_EXCHANGES) {
    const secid = `${ex}.${ticker}`;
    try {
      const j = await emJson(`${EM_PUSH}/api/qt/stock/get?secid=${secid}&fields=f57,f58&invt=2&fltt=2`, 8000);
      if (j?.data?.f57) {
        SECID_CACHE.set(ticker, secid);
        return secid;
      }
    } catch {
      /* 试下一个交易所 */
    }
  }
  SECID_CACHE.set(ticker, null);
  return null;
}

/* ------------------------------------------------------------------ 快照 */

const SNAP_FIELDS = "f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f169,f170,f171";

/**
 * 美股快照（+ 可选当日迷你走势）。返回形状与股票端 fetchQuoteResult 一致。
 * @returns {Promise<{quote:null|object, prices:number[]}>}
 */
export async function fetchUSQuote(code, withSeries = false) {
  const secid = await resolveUSSecid(code);
  if (!secid) return { quote: null, prices: [] };
  try {
    const j = await emJson(`${EM_PUSH}/api/qt/stock/get?secid=${secid}&fields=${SNAP_FIELDS}&invt=2&fltt=2`);
    const d = j?.data;
    if (!d || d.f43 === undefined || d.f43 === null) return { quote: null, prices: [] };
    const quote = {
      name: typeof d.f58 === "string" ? d.f58 : "",
      price: num(d.f43, NaN),
      changeAmount: num(d.f169),
      changePercent: num(d.f170),
      high: num(d.f44),
      low: num(d.f45),
      volume: num(d.f47),
      amount: num(d.f48),
      updatedAt: Date.now(),
    };
    if (!Number.isFinite(quote.price)) return { quote: null, prices: [] };

    let prices = [];
    if (withSeries) {
      try {
        const tr = await emJson(
          `${EM_HIS}/api/qt/stock/trends2/get?secid=${secid}`
          + "&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53&iscr=0&ndays=1",
        );
        prices = (tr?.data?.trends ?? [])
          .map((row) => num(String(row).split(",")[1], NaN))
          .filter((p) => Number.isFinite(p) && p > 0);
      } catch {
        /* 迷你走势拿不到不影响快照 */
      }
    }
    return { quote, prices };
  } catch {
    return { quote: null, prices: [] };
  }
}

/* -------------------------------------------------------------------- K线 */

const KLT_OF_PERIOD = { day: "101", week: "102", month: "103" };
const LIMIT_OF_PERIOD = { day: 160, week: 120, month: 60 };

/**
 * 美股 K 线（升序，前复权）。东方财富每行：
 * date,open,close,high,low,volume,amount,amplitude,changePct,changeAmount,turnover
 */
export async function fetchUSKline(code, period = "day") {
  const secid = await resolveUSSecid(code);
  if (!secid) return { candles: [], error: "未找到该美股代码" };
  const klt = KLT_OF_PERIOD[period] ?? "101";
  const lmt = LIMIT_OF_PERIOD[period] ?? 160;
  try {
    const j = await emJson(
      `${EM_HIS}/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101`
      + "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    );
    const rows = j?.data?.klines ?? [];
    if (!rows.length) return { candles: [], error: "无K线数据" };
    const candles = rows
      .map((line) => {
        const c = String(line).split(",");
        return {
          time: c[0],
          open: num(c[1], NaN),
          close: num(c[2], NaN),
          high: num(c[3], NaN),
          low: num(c[4], NaN),
          volume: num(c[5]),
        };
      })
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
 * 美股分时（当日，ndays=1）。东方财富 trends 行：
 * "YYYY-MM-DD HH:mm",price,high,low,volume,amount,avgPrice（时间为北京时间）
 */
export async function fetchUSMinute(code) {
  const secid = await resolveUSSecid(code);
  const empty = { date: null, prevClose: null, points: [], error: null };
  if (!secid) return { ...empty, error: "未找到该美股代码" };
  try {
    const j = await emJson(
      `${EM_HIS}/api/qt/stock/trends2/get?secid=${secid}`
      + "&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1",
    );
    const d = j?.data;
    if (!d || !Array.isArray(d.trends) || !d.trends.length) return { ...empty, error: "无分时数据" };
    const points = [];
    for (const line of d.trends) {
      const c = String(line).split(",");
      if (c.length < 2) continue;
      const hm = String(c[0]).trim();          // "2026-09-28 21:30"
      const p = num(c[1], NaN);
      const v = num(c[4]);
      if (!Number.isFinite(p) || p <= 0) continue;
      const t = Math.round(Date.parse(`${hm.replace(" ", "T")}:00+08:00`) / 1000);
      if (!Number.isFinite(t) || t <= 0) continue;
      points.push({ t, p, v });
    }
    if (!points.length) return { ...empty, error: "无分时数据" };
    const prevClose = num(d.preClose, NaN);
    return {
      date: String(d.trends[0]).slice(0, 10),
      prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : points[0].p,
      points,
      error: null,
    };
  } catch {
    return { ...empty, error: "行情获取失败" };
  }
}
