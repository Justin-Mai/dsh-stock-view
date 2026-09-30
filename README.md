# dsh-stock-view

DeepSeek Harness 右上角行情盯盘插件：**A 股 / ETF / 港股 / 美股 自选股 + 加密货币**实时行情。

> 本插件 fork 自 [dsh-stock-watch](https://github.com/Awu12277/dsh-stock-watch) v1.1.0（MIT，作者 Awu12277），
> 在其基础上做了下面这些改造。原作者的行情解析逻辑（腾讯财经接口、K 线列序、分时昨收反推）完整保留。
>
> 仓库：<https://github.com/Justin-Mai/dsh-stock-view>

## 相对上游的改动

| # | 改动 | 说明 |
|---|---|---|
| 1 | **移除悬浮扇形菜单** | 鼠标移到胶囊上不再弹出「行情分析 / 每日复盘 / 涨停分析」三项，host 端对应的三份提示词注入也一并删除（`FAN_PROMPTS` 与 `.fan-prompts` systemPrompt section）。其余交互不变。 |
| 2 | **新增加密货币监控** | 自选股里可以直接添加加密货币，列表 / 分时 / K 线三种视图与股票完全一致。 |
| 3 | 顺带修复 | 上游 `web.ifzq.gtimg.cn/appstock/app/minute/query` 已被腾讯 WAF 路径级拦截（HTTP 501），改用同一套 API 的 `proxy.finance.qq.com` 镜像并保留原 host 作为回退。 |
| 4 | **新增美股** | `usAAPL` / `usNVDA` 等，快照 / 分时 / K 线三视图与 A 股一致（走东方财富，见下）。 |
| 5 | **表头常驻前两个分组** | 固定钉住分组列表的第 1、2 个（**不随切换变化**），两行表头布局，切换时表头不跳动。 |
| 6 | **分组管理器** | 表头不再铺一行 tab；右侧 `切换` 下拉含全部分组，支持切换 / 拖动排序 / 删除 / 重命名。 |

| 7 | **不再随包分发技能** | 上游会把 `skills/`（Anthropic 的 `frontend-design` + `investment-research`）注入 `~/.agents/skills/`，本 fork 移除了该文件与该行为，只再分发自己的代码。代价：「一键分析」需要用户自备这两个技能。 |

保留的原有能力：分组管理、代码/名称搜索、分时图、日/周/月 K 线（含 MA 均线）、买卖目标价与触发提示、暗/亮主题、胶囊拖拽吸附、面板缩放、展开态迷你走势、一键分析。

## 美股数据源

代码约定 `us<代码>`，例如 `usAAPL`、`usNVDA`、`usBABA`。搜索直接复用腾讯 smartbox（支持 `AAPL`、`苹果`、`特斯拉` 等），
结果里带交易所后缀（`aapl.oq`），用它直接定出东方财富 secid，省掉逐交易所探测。

**为什么不用腾讯**（实测，见 `tools/probe-us-stocks.mjs`）：腾讯对美股三个接口都不完整 ——

- `minute/query` 的 `data.data` 只有 **1 个点**、`date` 为空 → 拿不到分时
- `fqkline/get` 的 `day` 只回「最早一根 + 最新一根」 → 拿不到 K 线序列
- 行情字段首项为 `"delay"` → 延时数据

**改用东方财富**（与 [stock-sdk](https://github.com/chengzuopeng/stock-sdk) 同一选择）：

| 视图 | 接口 | 口径 |
|---|---|---|
| 快照 | `/api/qt/stock/get` | 现价/涨跌额/涨跌幅/开高低/量额（`fltt=2` 已是十进制） |
| 分时 | `/api/qt/stock/trends2/get?ndays=1` | 当日，实测 391 个点；时间为北京时间 |
| K 线 | `/api/qt/stock/kline/get` | `klt=101/102/103`，`fqt=1` 前复权，160/120/60 根 |

secid 前缀：**105=NASDAQ、106=NYSE、107=AMEX**。手工输入 `usXYZ`（无后缀）时会按这三个交易所依次探测，结果进程内缓存。

## 分组：表头常驻前两个

表头保持**单行**，分组区不再单独占一行：

```
📈 行情盯盘  [分组1] [分组2]   当前：分组5   [切换]  ⏱10s ◐ ⟳ —   [折叠]
└── 标题 ──┘ └─ 常驻钉住 ─┘   └─提示─┘   └切换┘   └── 动作图标 ──┘
```

宽度紧张时**可压缩的只有「钉住标签 → 当前提示 → 留白」这一段**（标签自动省略号截断），
右侧的动作图标固定不被挤。

- **常驻的前两个**：固定钉住分组列表的第 1、2 个，**不随当前分组变化** —— 所以表头永远稳定、切换时不跳动。
  点一下即切换，当前所在的那个高亮（`[分组1]` 高亮 = 正在看分组1）。
- **当前提示**：如果当前分组不在钉住的两个里（比如从下拉切到了第 5 个），右侧会显示
  `当前：分组5`，避免不知道自己在看哪一组。
- **切换**（表头右侧那个按钮）：其余分组全部在这个下拉里。弹窗按「相对面板」的坐标定位，
  高度自适应到面板底边，所以面板拖到屏幕下方也不会跑出面板或被裁掉。

下拉本身是个分组管理器：

| 操作 | 怎么做 |
|---|---|
| 切换 | 点下拉里的任意一行。下拉**不自动收起**，方便连续切几个；鼠标移开才收。 |
| 调顺序 | 按住行首 `⠿`（或整行）上下拖动，目标位置显示青色横线 |
| 删除 | 点该行右侧 `✕`（二次确认；至少保留一个分组） |
| 重命名 | 双击分组名，就地改名 |

行的右侧显示该分组的股票数，当前分组高亮。拖动重排后**当前选中的分组不会跑掉**（按对象身份重算下标）。

> 钉住的顺序 = 分组列表顺序。想让别的分组常驻，就在下拉里把它拖到前两位。

## 加密货币数据源

代码约定为 `cr:<instId>`，例如 `cr:BTC-USDT`。`cr:` 前缀用于在 `/quotes` 等路由里与
A 股（`sh`/`sz`）、港股（`hk`）、美股（`us`）无歧义分流。

数据来自 **OKX 现货公开 REST**（`https://www.okx.com/api/v5`，无需 API Key）：

| 视图 | 接口 | 口径 |
|---|---|---|
| 列表快照 / 迷你走势 | `/market/ticker`、`/market/candles?bar=5m&limit=48` | 现价、24h 涨跌幅/涨跌额/最高/最低、24h 成交量额 |
| 分时 | `/market/candles?bar=5m&limit=288` | 最近 24 小时（≈23.9h），基准线取区间首根开盘价 |
| K 线 | `/market/candles?bar=1D\|1W\|1M` | 160 / 120 / 60 根；OKX 日线按 UTC+8 0 点切分 |
| 搜索 | `/public/instruments?instType=SPOT` | 407 个可交易 USDT 现货对，保证结果都能取到行情 |

选型实测（`tools/probe-crypto.mjs`）：

- Binance `api.binance.com` → **HTTP 451**（地域限制）
- CoinGecko `api.coingecko.com/simple/price` → **HTTP 403**（风控，仅 `/search` 可用）
- OKX `www.okx.com/api/v5` → 全部 200，国内可直连

## 使用

1. 面板顶部 `🗂 添加分组` 建一个分组（首次运行会自动补一个「加密货币」分组，只加一次）。
2. `＋ 添加股票` → 输入 `btc`、`eth`、`比特币`、`狗狗币` 等搜索，选中即加入。
3. 点击列表行进入详情，可切 分时 / 日K / 周K / 月K，与股票一致。
4. 详情里的「一键分析」会新开一个会话，提示模型依次使用 `investment-research` 与
   `frontend-design` 两个技能。**本包不随包分发技能**（上游会在首次启动时把 `skills/`
   注入 `~/.agents/skills/`，这里已移除该行为），请自行安装这两个技能，否则该按钮发出的
   请求会缺少技能指引。插件本身不依赖它们运行。

自选股配置存在浏览器 `localStorage`（键 `stocking.config.v1`，与上游一致，因此从
`dsh-stock-watch` 迁移过来时自选股会**自动延续**），首次打开会从 `~/.stocking/settings.json`
一次性迁移，失败则用默认分组。重置：`localStorage.removeItem('stocking.config.v1')` 后刷新。

买卖目标价同样支持加密货币（按 USDT 计价）——价格触达时胶囊会给出提示。

## HTTP 路由

| 路由 | 说明 |
|---|---|
| `/dsh-stock-view/config` | 读取 `~/.stocking/settings.json`（客户端首次迁移用） |
| `/dsh-stock-view/stocks?q=` | 搜索：A 股池 + ETF 池 + 港股池 + 腾讯 smartbox（含美股 GP/ETF）+ OKX 加密货币 |
| `/dsh-stock-view/quotes?group=&minutes=&groups=` | 按分组拉取快照（`cr:`→OKX，`us`→东方财富，其余→腾讯），`minutes=1` 附带迷你走势 |
| `/dsh-stock-view/kline?code=&period=` | 日/周/月 K 线（A股/港股走腾讯前复权，美股走东方财富，加密货币走 OKX） |
| `/dsh-stock-view/minute?code=` | 分时详情（A股/港股=当日分钟线，美股=当日 391 点，加密货币=最近 24h） |

## 安装

作为本地插件安装到 profile：

```jsonc
// <profile>/package.json
"dependencies": { "dsh-stock-view": "link:../../../Desktop/dsh/dsh-stock-view" },
"dsh": { "profile": { "bundles": ["dsh-stock-view"] } }
```

装好后重启 DSH Desktop（bundle 在启动时组合；客户端代码也只在启动时从磁盘快照）。

## 数据目录

- `data/a_stocks.json`、`data/etf_stocks.json`、`data/hk_stocks.json`：股票/ETF/港股代码池（随包）
- 本包**不含** `skills/`：不随包分发任何第三方技能或素材
- 加密货币不需要本地池：搜索直接查 OKX 交易对清单（30 分钟内存缓存）
- 常见币种中文名内置在 `crypto.js` 的 `COMMON_COINS`

## 开发工具（`tools/`）

| 文件 | 用途 |
|---|---|
| `strip-fan.mjs` | 从上游 client.js 移除扇形菜单（带锚点与残留守卫） |
| `apply-edits.mjs` | 更名 / 移除迁移补丁 / 插入 crypto helper（带断言） |
| `integrate-crypto.mjs` | 把加密货币接入三个路由 + 搜索 + 默认分组 |
| `round2-us-and-groups.mjs` | 接入美股分流 + 分组拖拽 / 下拉切换 |
| `round3-group-manager.mjs` | 表头改单分组 + 下拉升级为分组管理器（删除 / 排序 / 重命名） |
| `round4-pinned-two.mjs` | 表头常驻前两个分组 + 两行布局 |
| `test-plugin.mjs` / `test-us.mjs` | 导入真实模块并调用各 handler 的端到端测试 |
| `probe-*.mjs` | 各数据源连通性与字段探测（腾讯 / OKX / 东方财富） |

## License

MIT。上游 dsh-stock-watch 版权归 Awu12277 所有，见 `LICENSE`。
