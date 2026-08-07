# Web-Portal 深度调研网络韧性与 SSE 长连接加固

Planned-with: claude-opus-5

> 落点提醒：本 plan 属底层 / bugfix，按 `AGENTS.md` 分支分流规则，正式提交时须落到 **`origin/main`** 的 `.cursor/plans/pending/`，不要提交到 `hc-0730`。
> Commit trailer：`Plan-Id: 2026-08-07-portal-deep-research-network-resilience` / `Plan-Model: claude-opus-5` / `Impl-Model: <实施时填>` / `Made-with: Damon Li`。

## 现象（客户侧测试环境）

部署 enterprise 前台 web-portal 后，触发「深度调研」出现：

1. 容器日志刷屏大量 `[page-fetch] <url> network_error`（sohu / eeo / eastmoney / 10jqka / toutiao 等外站）。
2. `[deep-research] lane failed: fetch failed`、`[deep-research] section format miss s2 comparison_table`。
3. 前端出现「聊天请求失败 / 无法连接门户服务（网络中断或开发服务未响应）」，并伴随 deep-research 结束后历史同步 `Failed to fetch`。
4. 主观感受：deep-research 更慢更重、portal 容器压力大、SSE 挂得更久。

## 根因分析（证据链，不依赖对话上下文）

### R1 —— 运行镜像里没有 `curl`，但抓取链把 curl 当第一优先级（每次外站请求白 fork 一个必然失败的子进程）

`directFetch` 的策略是 curl → HTTP CONNECT 代理 → 直连：

```349:371:enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts
export const directFetch: DirectFetch = async (input, init = {}) => {
  ...
  // 1) curl — best proxy/SOCKS compatibility with shell env
  try {
    return await curlFetchWithBody(...);
  } catch {
    // fall through
  }
```

curl 通过 `spawn("curl", args, { env: process.env })` 启动（`direct-fetch.ts:134`）。而运行镜像 `enterprise/apps/Dockerfile.next` 的 runner 阶段基于 `node:20-bookworm-slim`，**没有任何 `apt-get install curl`**（见 L41-57，只有 `groupadd/useradd` + COPY + `CMD ["node","server.js"]`）。`node:20-bookworm-slim` 默认不含 curl。

后果：每次 `directFetch` 都会 `spawn` 一个立刻 `ENOENT` 失败的子进程，异常被 `catch {}` 静默吞掉，再退到 CONNECT / 直连。单个 URL 的开销放大链路：

- `fetchPageContent` 按 `DEFAULT_BACKEND_CHAIN = ["native","jina"]` 依次尝试（`page-fetch.ts:105-129`，`page-fetch-backends.ts:15`）→ 最多 2 个 backend；
- 每个 backend 内部 1 次 `directFetch` → 1 次无效 spawn + 最多 2 次网络尝试；
- lane 并发 3（`orchestrator.ts:82` `SEARCH_CONCURRENCY = 3`）× page fetch 并发 4（`page-fetch.ts:26` `PAGE_FETCH_CONCURRENCY = 4`）= 峰值 12 个并发抓取；
- `MAX_LANES = 8`（`orchestrator.ts:86`），一轮 deep-research 轻松产生上百次无效 spawn。

这就是「portal 容器压力更大」的直接来源：进程 fork 风暴 + fd 消耗，而不是单纯的网络慢。

### R2 —— nginx 模板把 `/api/chat/` 全量代理到 gateway，而这些路由只存在于 portal BFF

```55:64:enterprise/deploy/nginx/gateway.conf
    location /api/chat/ {
      limit_req zone=api_limit burst=40 nodelay;
      ...
      proxy_pass http://gateway_backend;
    }
```

`enterprise/deploy/nginx/edge-split.conf` L75-86 同样把 `/api/chat/` 指向 gateway。

但 gateway 对外只有 `/v1/*`（compose 里 `GATEWAY_COMPLETIONS_URL=http://192.168.16.66:8088/v1/chat/completions`，见 `enterprise/deploy/docker-compose/portal.yml`）。以下路由**全部只在 Next.js portal（:3000）上**：

- `POST /api/chat/completions`（deep-research / web-search 编排入口）—— `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`
- `POST /api/chat/sessions/{sessionId}/messages`（**历史同步**）—— `.../app/api/chat/sessions/[sessionId]/messages/route.ts`
- `GET /api/chat/deep-research/runs/...`（重连 / hydrate）

按模板部署时，历史同步会打到 gateway 上并不存在的路由，连接被拒/重置在浏览器侧就表现为 `Failed to fetch`，进而命中前端归一化文案：

```55:58:enterprise/packages/sdk-ts/src/chat/http.ts
```
（`normalizeTransportErrorMessage()`，产出「无法连接门户服务（网络中断或开发服务未响应）…历史同步失败…」）

**这是「deep-research 结束后历史同步 Failed to fetch」最直接、最高优先级的解释。**

### R3 —— SSE 心跳是「事件驱动」而非「定时」，长静默期会被代理按读超时切断

deep-research 的 flush 只在固定代码点调用：

```567:570:enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts
      /** SSE comment + padding — force proxies/Next to flush before long awaits. */
      const enqueueFlush = () => {
        safeControllerEnqueue(encoder.encode(`: ping\n\n${" ".repeat(2048)}\n`));
      };
```

调用点仅 L592 / L612 / L643 / L702 等有限位置，**没有任何 `setInterval` 定时心跳**。因此在两类长静默窗口里，连接上可能几分钟没有任何字节：

- lanes 并行执行期（外站大面积超时时，一条 lane 可能 12s × N 串起来）；
- synthesize 分节写作期（`orchestrator.ts:1324-1362` 顺序 for-loop，每节一次 LLM 调用）。

叠加 R2 修好后仍然存在的代理读超时：nginx 模板 `proxy_read_timeout 600s`（gateway.conf L50/L62），客户侧若还有一层 LB/网关，默认往往是 60s。静默即断。

### R4 —— 三层超时预算互相不一致

| 层 | 值 | 位置 |
|---|---|---|
| deep-research 总预算 | 1_200_000 ms（20 min） | `orchestrator.ts:91` `TOTAL_BUDGET_MS` |
| Next route 上限 | 1500 s | `.../api/chat/completions/route.ts:41` `maxDuration` |
| nginx 读超时 | 600 s | `gateway.conf:50,62` / `edge-split.conf:70,84` |

业务预算（20min）> 代理读超时（10min）。即使心跳修好，也应把三层对齐，否则跑满预算的 run 必然在代理层被切。

### R5 —— 没有域名级熔断，同一个不可达 host 被反复重试直到耗尽预算

日志里 `q.stock.sohu.com`、`www.eeo.com.cn`、`stock.cfi.cn` 各出现多次。`fetchPagesBatch`（`page-fetch.ts:138-169`）只按 URL 逐个跑，`fetchPageContentWithReason` 只有 backend 链 fallback，**没有任何按 host 聚合的失败记忆**。客户环境无外网时，每个 URL 都要付满 12s 超时（`PAGE_FETCH_TIMEOUT_MS`，`page-fetch.ts:25`），整轮 `FETCH_BUDGET_MS = 180_000`（`orchestrator.ts:93`）被纯超时消耗殆尽。

### R6 —— 没有出网可达性预检，内网环境整轮空跑

没有任何前置探测。客户测试环境若本就不通外网（这与日志中「所有外站清一色 network_error」高度吻合），deep-research 仍会完整走完 recon → clarify → 8 lanes → reflect → synthesize，白烧 20 分钟与大量 LLM 调用，最后交出无引用的报告，同时把 SSE 拖到最长。

### R7 —— portal 进程没有全局异常兜底

`enterprise/apps/web-portal` 下没有 `instrumentation.ts`，没有 `process.on("uncaughtException"|"unhandledRejection")`，Docker `CMD ["node","server.js"]` 无 `--max-old-space-size`、无 PM2/cluster。直连路径把整个响应体 `Buffer.concat` 全量读进内存（`direct-fetch.ts:327-337`）。一旦某次抓取触发未捕获异常，进程直接退出。

旁证：`enterprise/apps/web-portal/.runtime/deep-research-clarify/` 下残留 13 个 `{"status":"waiting"}` 孤儿文件。正常路径会在 `settleWaiter` 里 `removePending`（`run-wait.ts:115-126`），留下孤儿说明进程在 clarify 等待期间**异常退出过**。

### R8 —— `section format miss` 是无证据导致的连带现象，不是独立缺陷

```1352:1358:enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts
          if (!sectionMeetsFormat(section, sectionBody)) {
            console.warn("[deep-research] section format miss", section.id, section.format);
          }
```

`s2` 默认 `format: "comparison_table"`（`report-writer.ts:104-110`），要求正文含 GFM 表格（`report-writer.ts:268-276` `sectionMeetsFormat`）。抓不到任何正文时模型没有可对比的事实，自然写不出表格。仅 warn、不阻断落盘。**R1/R5/R6 修好后此告警自然大幅减少**，本 plan 只做一个低成本的降级兜底（FR-9），不做写作链路重构。

---

## In scope / Out of scope

**In scope**

- `enterprise/apps/web-portal/src/lib/web-search/`：抓取传输层（curl 探测、host 熔断、可达性预检）
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`：SSE 定时心跳、预算可配置、预检降级
- `enterprise/deploy/nginx/*.conf`：路由修正 + SSE 指令 + 超时对齐
- `enterprise/apps/Dockerfile.next`：安装 curl
- `enterprise/apps/web-portal/instrumentation.ts`：新增全局异常日志
- `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`：仅 FR-9 的 format 降级

**Out of scope（明确不要动）**

- 不重构 lane 编排 / planner / reflector / report-writer 的写作提示词
- 不改前端 `features/chat` 的 outbox 重试策略（`history-outbox.ts` 现有 `MAX_ATTEMPTS=8` + 退避已足够；R2 修好后症状即消失）
- 不改 gateway（Go）任何代码
- 不改 `desktop/`、`admin-console/`、`agenticx/` 任何代码
- 不引入新的第三方抓取 SaaS 依赖（jina / firecrawl 现有可选后端保持原样）
- 不动 `agenticx/studio/server.py`

---

## 需求与实施

### P0 —— 先止血（不修这三条，其它都白搭）

#### FR-1 nginx 路由修正：`/api/chat/` 必须走 web-portal，且开启 SSE 直通

**落点**：`enterprise/deploy/nginx/gateway.conf` L55-64；`enterprise/deploy/nginx/edge-split.conf` L75-86。

**Before**（gateway.conf）：

```nginx
    location /api/chat/ {
      limit_req zone=api_limit burst=40 nodelay;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      ...
      proxy_read_timeout 600s;
      proxy_send_timeout 600s;
      proxy_pass http://gateway_backend;
    }
```

**After**：

```nginx
    # portal BFF 独有：deep-research / web-search 编排 + 聊天历史。
    # gateway 只暴露 /v1/*，此处必须指向 web-portal，否则历史同步 404/连接重置，
    # 浏览器侧表现为 Failed to fetch。
    location /api/chat/ {
      limit_req zone=api_limit burst=40 nodelay;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

      # SSE：禁用缓冲与缓存，否则事件被 nginx 攒着不下发。
      proxy_buffering off;
      proxy_cache off;
      chunked_transfer_encoding on;

      # 与 orchestrator TOTAL_BUDGET_MS 对齐，留足余量（见 FR-4）。
      proxy_read_timeout 1800s;
      proxy_send_timeout 1800s;

      proxy_pass http://web_portal_backend;
    }
```

`edge-split.conf` 做同样修改（保持该文件既有的 upstream 命名与 header 风格）。

**注意**：`proxy_pass http://web_portal_backend;` 结尾**不要**加 `/`，否则会截掉 `/api/chat/` 前缀。对照同文件 L86 的 `location /` 用的是 `http://web_portal_backend/`（带斜杠、做根路径重写），二者语义不同，不要抄错。

**AC-1**：
- `nginx -t -c <conf>` 通过。
- 部署后 `curl -i http://<nginx>/api/chat/sessions` 返回 portal 的响应（401/200 均可），**不是** gateway 的 404 / 502。
- 浏览器完成一轮 deep-research 后，Network 面板中 `POST /api/chat/sessions/{id}/messages` 状态为 2xx，控制台无 `Failed to fetch`。

#### FR-2 消除无效 curl 子进程：探测一次并缓存；镜像装上 curl

分两处改，缺一不可。

**(a) 运行镜像安装 curl** —— `enterprise/apps/Dockerfile.next`，在 runner 阶段（当前 L41-57，`FROM node:20-bookworm-slim AS runner` 之后、`USER nextjs` 之前）插入：

```dockerfile
# directFetch 优先用 curl 以继承 HTTP(S)_PROXY / SOCKS（Node undici 不读这些环境变量）。
# slim 基础镜像不含 curl，缺失时每次外站抓取都会白 fork 一个 ENOENT 子进程。
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
```

**(b) `direct-fetch.ts` 增加 curl 可用性探测并缓存** —— 落点 `enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts`，在 `directFetch`（L349）之前新增，并在 L360 的 `try` 外加守卫。

新增（放在 `curlFetchWithBody` 定义之后、`connectViaHttpProxy` 之前）：

```ts
/**
 * curl 是否可用只探测一次并缓存。
 * 运行镜像若不含 curl，每次抓取都 spawn 一个必然 ENOENT 的子进程，
 * 在 deep-research 的并发下会变成 fork 风暴（上百次/轮）。
 */
let curlAvailable: Promise<boolean> | null = null;

export function resetCurlProbeForTests(): void {
  curlAvailable = null;
}

function probeCurl(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn("curl", ["--version"], { env: process.env });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        done(false);
      }, 2_000);
      child.on("error", () => {
        clearTimeout(timer);
        done(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code === 0);
      });
      child.stdout.resume();
      child.stderr.resume();
    } catch {
      done(false);
    }
  });
}

function isCurlAvailable(): Promise<boolean> {
  if (process.env.AGX_DISABLE_CURL_FETCH === "1") return Promise.resolve(false);
  curlAvailable ??= probeCurl();
  return curlAvailable;
}
```

`directFetch` 内 L359-371 改为：

```ts
  // 1) curl — best proxy/SOCKS compatibility with shell env
  if (await isCurlAvailable()) {
    try {
      return await curlFetchWithBody(url.toString(), method, headers, bodyBuf, timeoutMs, init.signal);
    } catch {
      // fall through
    }
  }
```

同时给 curl 补 `--connect-timeout`，避免连接阶段吃满 `--max-time`。在 `curlFetchWithBody` 的 `args` 数组（L107-117）中 `--max-time` 之后追加：

```ts
      "--connect-timeout",
      String(Math.max(0.2, Math.min(5, Math.round(timeoutMs) / 1000 / 2))),
```

**AC-2**：
- 新增 `enterprise/apps/web-portal/src/lib/web-search/direct-fetch.curl-probe.test.ts`：
  - 设 `AGX_DISABLE_CURL_FETCH=1` 时，mock 的 `spawn` 零调用（断言 curl 分支被跳过）；
  - 探测失败后连续 5 次 `directFetch`，`spawn` 总调用次数 ≤ 1（证明结果被缓存）；
  - 用例间调用 `resetCurlProbeForTests()`。
- `docker build -f apps/Dockerfile.next --build-arg APP_NAME=web-portal ...` 成功，`docker run --rm <image> curl --version` 有输出。

#### FR-3 SSE 定时心跳

**落点**：`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`，`enqueueFlush` 定义处（L567-570）之后。

在 `enqueueFlush` 之后新增定时器，并在 stream 的 `finally`（即当前 `try` 块对应的收尾处，与 `persistFinish` 同级）清理：

```ts
      /** 代理按读超时切流；lanes / synthesize 有分钟级静默窗口，必须定时喂字节。 */
      const HEARTBEAT_MS = 15_000;
      const heartbeat = setInterval(() => {
        enqueueFlush();
      }, HEARTBEAT_MS);
      // Node 侧不因心跳定时器阻止退出。
      (heartbeat as unknown as { unref?: () => void }).unref?.();
```

在 stream 结束路径（`controller.close()` 之前、以及 catch/abort 分支）统一 `clearInterval(heartbeat)`。实施时用一个 `finally { clearInterval(heartbeat); }` 包住现有的大 `try`（L588 起），确保异常路径也清理。

**注意（no-scope-creep）**：不要改 `enqueueFlush` 的帧格式（`: ping\n\n` + 2048 空格 padding 是为对抗 Next/代理缓冲，不能删 padding）。

**AC-3**：
- 新增用例 `orchestrator.heartbeat.test.ts`：用 fake timers 驱动一个「lane 阶段 stub 挂起 60s」的 run，断言这 60s 内 SSE 输出中 `: ping` 帧 ≥ 3 个。
- 断言 run 正常/异常结束后 `clearInterval` 被调用（可通过 fake timer 的 pending timer 数为 0 断言）。

### P1 —— 让不通外网的环境快速、诚实地降级

#### FR-4 超时预算统一可配置

**落点**：`orchestrator.ts:91-93`。

**Before**：
```ts
export const TOTAL_BUDGET_MS = 1_200_000;
...
export const FETCH_BUDGET_MS = 180_000;
```

**After**（保留默认值不变，仅允许 env 覆盖，便于客户环境按其代理超时收紧）：

```ts
function envMs(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const TOTAL_BUDGET_MS = envMs("DEEP_RESEARCH_TOTAL_BUDGET_MS", 1_200_000);
export const FETCH_BUDGET_MS = envMs("DEEP_RESEARCH_FETCH_BUDGET_MS", 180_000);
```

并在 `enterprise/deploy/docker-compose/portal.yml` 的 `environment` 段补上注释掉的示例（不改默认行为）：

```yaml
      # 若入口代理读超时 < 20min，按其数值收紧（留 2min 余量）
      # DEEP_RESEARCH_TOTAL_BUDGET_MS: "900000"
```

**AC-4**：单测断言 `DEEP_RESEARCH_TOTAL_BUDGET_MS=900000` 时 `TOTAL_BUDGET_MS === 900_000`，未设置时为 `1_200_000`。（因是模块级常量，测试用 `vi.resetModules()` + 动态 `import()`。）

#### FR-5 域名级熔断

**落点**：`enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`。

在 `fetchPagesBatch`（L138）内引入**单次批量调用作用域**的 host 失败计数（不做跨请求全局状态，避免污染其它租户/会话）：

```ts
const HOST_FAILURE_THRESHOLD = 3;
```

`worker()` 内在调用 `fetchPageContentWithReason` 之前：

```ts
      const host = safeHost(target);
      if (host && (hostFailures.get(host) ?? 0) >= HOST_FAILURE_THRESHOLD) {
        // 同一 host 已连续失败达阈值，本批次直接跳过，把预算留给还可能通的源。
        pages[index] = null;
        stats.network_error += 1;
        continue;
      }
```

拿到结果后：

```ts
      if (!attempt.page && attempt.failure) {
        stats[attempt.failure] += 1;
        if (host && (attempt.failure === "network_error" || attempt.failure === "timeout")) {
          hostFailures.set(host, (hostFailures.get(host) ?? 0) + 1);
        }
      } else if (host) {
        hostFailures.delete(host);
      }
```

`safeHost` 为本文件内新增小工具：`try { return new URL(u).host } catch { return "" }`。

**注意**：只对 `network_error` / `timeout` 计数。`http_error`（如 403）、`too_short`、`unsupported_content_type` 是内容层问题，同 host 其它 URL 仍可能成功，不得熔断。

**AC-5**：新增 `page-fetch.host-circuit.test.ts`：给 10 个同 host URL，mock `fetchImpl` 全部抛网络错误，断言底层 `fetchImpl` 被调用次数 ≤ `HOST_FAILURE_THRESHOLD × backends.length`，且返回的 `pages` 长度仍为 10、全为 `null`（保序契约不破）。

#### FR-6 出网可达性预检 + 诚实降级

**落点**：新增 `enterprise/apps/web-portal/src/lib/web-search/egress-probe.ts`；在 `orchestrator.ts` recon 之前（当前 L594 `// --- Recon` 处）接入。

`egress-probe.ts`：

```ts
/**
 * 一次性探测 portal 容器能否出公网。
 * 客户内网常完全隔离，此时 deep-research 会空跑满预算并交出无引用报告。
 */
const PROBE_TARGETS = ["https://www.bing.com", "https://duckduckgo.com"];
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_TTL_MS = 60_000;

let cached: { at: number; ok: boolean } | null = null;

export function resetEgressProbeForTests(): void {
  cached = null;
}

export async function probeEgress(fetchImpl: DirectFetch, now = () => Date.now()): Promise<boolean> {
  if (cached && now() - cached.at < PROBE_TTL_MS) return cached.ok;
  let ok = false;
  for (const target of PROBE_TARGETS) {
    try {
      const res = await fetchImpl(target, { method: "GET", timeoutMs: PROBE_TIMEOUT_MS });
      if (res.status > 0) { ok = true; break; }
    } catch {
      // try next
    }
  }
  cached = { at: now(), ok };
  return ok;
}
```

`orchestrator.ts` 接入（recon 之前）：

```ts
        const egressOk = await probeEgress(deps.fetchImpl ?? directFetch);
        if (!egressOk) {
          enqueueEvent({
            type: "narrative",
            text: "当前环境无法访问外部网站，深度调研已切换为「仅基于已有资料」模式，结论不含外部实时来源。",
          });
          enqueueFlush();
        }
```

并把 `egressOk === false` 透传进 lane 执行：`runOneLane` 内跳过 `fetchPages`（即把 L935 的条件 `questionCitations.length > 0 && searchBudgetLeft() > 0` 补成 `&& egressOk`），避免明知不通还付满每个 URL 12s。

**AC-6**：
- `egress-probe.test.ts`：全部 target 抛错 → 返回 `false`；TTL 内二次调用不再触发 `fetchImpl`（断言调用次数不增）。
- `orchestrator` 集成用例：`probeEgress` stub 为 `false` 时，`fetchPages` 的 stub 零调用，且 SSE 中出现「无法访问外部网站」文案。

### P2 —— 稳态与可观测

#### FR-7 portal 全局异常兜底

新增 `enterprise/apps/web-portal/instrumentation.ts`（Next.js 约定文件，与 `next.config.ts` 同级）：

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.on("unhandledRejection", (reason) => {
    console.error("[portal] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    // 记录后交回默认行为（不吞），由编排器重启，避免带病进程继续服务。
    console.error("[portal] uncaughtException:", error);
  });
}
```

**注意**：`uncaughtException` 只打日志、**不要**阻止进程退出（不要写成吞掉异常继续跑），否则会掩盖真实故障。

**AC-7**：`pnpm --filter @agenticx/app-web-portal build` 通过；启动日志中人为触发一次 unhandled rejection 能看到 `[portal] unhandledRejection:` 前缀。

#### FR-8 抓取失败日志降噪

**落点**：`page-fetch.ts:131-133`。当前每个失败 URL 一条 `console.warn`，无外网时刷屏数百行，淹没真正有用的日志。

**After**：改为「首次某 host 失败打详细，后续同 host 同原因只累加」，并在 `fetchPagesBatch` 结束时打一条聚合行：

```ts
console.warn(`[page-fetch] batch: ${urls.length} urls, ${summarizeFetchFailures(stats)}`);
```

逐 URL 的 `console.warn` 改为仅在 `process.env.AGX_PAGE_FETCH_VERBOSE === "1"` 时输出。

**AC-8**：`page-fetch.host-circuit.test.ts` 中断言默认情况下 `console.warn` 调用次数 ≤ 2（每批一条聚合 + 可能的熔断提示），而非 10 条。

#### FR-9 report format 降级（低成本兜底）

**落点**：`orchestrator.ts:1352-1358`。

**Before**：仅 `console.warn`。
**After**：warn 保留，但当 `section.format` 属于表格类（`comparison_table` / `tradeoff`）且本 run 的总引用数为 0 时，把该 section 的 format 视为 `prose` 并跳过告警——无证据时要求模型产表格本身就不合理。

```ts
          const tableLike = section.format === "comparison_table" || section.format === "tradeoff";
          const noEvidence = registrySnapshot().length === 0;
          if (!sectionMeetsFormat(section, sectionBody) && !(tableLike && noEvidence)) {
            console.warn("[deep-research] section format miss", section.id, section.format);
          }
```

**注意**：不要改 `report-writer.ts` 的 `sectionMeetsFormat` 语义，也不要重写 outline 生成逻辑——只在 orchestrator 的告警判断处加这一个条件。

**AC-9**：`orchestrator` 用例中，引用数为 0 且 s2 无表格时，`console.warn` 不含 `section format miss`；引用数 > 0 且无表格时，告警仍然打印。

---

## 实施顺序与提交切分

建议 3 个 commit，每个都要求 `pnpm -C enterprise typecheck` + `pnpm -C enterprise --filter @agenticx/app-web-portal test` + `build` 全绿后再进下一个：

1. **`fix(portal): route chat BFF traffic to portal and harden SSE proxying`** —— FR-1 + FR-3 + FR-4（部署配置 + 心跳 + 预算），这是止血主体。
2. **`fix(portal): eliminate redundant curl spawns in outbound page fetch`** —— FR-2 + FR-8（传输层 + 日志）。
3. **`feat(portal): degrade deep research gracefully when egress is blocked`** —— FR-5 + FR-6 + FR-7 + FR-9。

Commit trailer 按 `.cursor/rules/plan-management.mdc`：`Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`。

`Plan-Id: 2026-08-07-portal-deep-research-network-resilience`

---

## 子规划 → 推荐实施模型

Suggested-Impl-Model 以「够用且最省」为原则：

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| FR-1 / FR-4（nginx conf + env 常量） | Composer 2.5 / 便宜代码档 | 配置改写与常量提取，改动面小、无歧义，样板任务 |
| FR-2 / FR-5 / FR-8（传输层探测、熔断、日志） | 代码专精中档（如 Codex 系列） | 涉及子进程、并发 worker 与保序契约，需要稳妥的后端实现功底但无跨栈风险 |
| FR-3 / FR-6 / FR-9（SSE 心跳、预检接入、降级） | 强推理档（如 GPT-5.x） | 触及 stream 生命周期与 orchestrator 长函数的异常/清理路径，时序敏感、回归风险高 |
| FR-7（instrumentation） | Composer 2.5 | 单文件新增，模板化 |

---

## 客户侧部署自检清单（不改代码也应先跑一遍）

修复上线前，可用以下三条快速定位客户环境属于哪一类问题：

1. `docker exec <portal> sh -c 'command -v curl || echo NO_CURL'` —— 输出 `NO_CURL` 即命中 R1。
2. `docker exec <portal> sh -c 'node -e "fetch(\"https://www.bing.com\").then(r=>console.log(r.status)).catch(e=>console.log(\"FAIL\",e.message))"'` —— 输出 `FAIL` 即命中 R6（环境无外网），此时应先与客户确认是否需要配置出网代理（`HTTPS_PROXY` 等，配合 FR-2 的 curl 一起生效），或直接关闭该租户的深度调研开关（`/api/me/web-search` 的 `deepResearchEnabled`）。
3. `curl -i http://<nginx>/api/chat/sessions` —— 若返回 gateway 的 404/502 而非 portal 响应，即命中 R2。

## 全局验收

- [ ] 客户环境重放同一条调研 query：容器日志中 `[page-fetch]` 行数从数百降到个位数（聚合行）。
- [ ] 全程无 `Failed to fetch`，历史同步 `POST /api/chat/sessions/{id}/messages` 2xx。
- [ ] 无外网环境下，deep-research 在 60s 内给出「无法访问外部网站」的明确降级提示，而不是静默跑满 20 分钟。
- [ ] 有外网环境下，一轮完整 deep-research 的 SSE 连接不中断（抓包确认 15s 间隔有 `: ping`）。
- [ ] `pnpm -C enterprise typecheck && pnpm -C enterprise build` 全绿。
