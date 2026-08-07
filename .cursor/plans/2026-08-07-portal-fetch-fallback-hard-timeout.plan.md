# web-portal 外站抓取 fallback 硬超时 + SSE 安全关闭

Planned-with: claude-opus-5
Suggested-Impl-Model: gpt-5.6-terra-medium（跨栈、涉及 Node socket 生命周期与 AbortSignal 组合语义，属超时/一致性敏感改动，不建议用便宜档）

## 背景与根因（证据链，勿依赖对话记忆）

某交付环境出现「外站抓取大面积失败 → deep-research 长时间不结束 → portal 卡顿、SSE 被代理切断」。已完成的一批韧性改动（nginx 路由、镜像装 curl、SSE 心跳、预算可配、域名熔断、出网预检、全局兜底）解决了传输层与噪声问题，但遗留两个真实缺口，本 plan 专门收口。

### 缺口 A：`directFetch` 的两条 fallback 路径没有任何时间上界

生产调用链：

```
orchestrator.ts:1386  fetchPages(urls, { signal: runSignal, timeoutMs: min(PAGE_FETCH_TIMEOUT_MS, budgetLeft) })
  → page-fetch.ts       透传 { fetchImpl, timeoutMs, signal }
  → page-fetch-backends.ts  deps.fetchImpl(url, { timeoutMs: deps.timeoutMs, signal: deps.signal })
  → direct-fetch.ts:349 directFetch(input, init)
```

关键事实：`runSignal` 来自 `orchestrator.ts:594` 的 `new AbortController()`，**全仓库不存在任何 `runController.abort()` 调用**（这是 AC-3 的刻意设计：浏览器断开不杀后台 run）。所以 `init.signal` 在生产中**永远不会 fire**，它不是单次抓取的超时信号。

`enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts:349-385` 三条路径的实际上界：

| 路径 | 代码位置 | 是否收到 `timeoutMs` | 实际上界 |
|---|---|---|---|
| 1. curl | L361-368 | 是 → `--max-time` | 有界 ✅ |
| 2. `httpsViaProxy`（HTTP CONNECT） | L377 | **否**，只传 `init.signal` | CONNECT 阶段 15s 硬编码（L256），**响应阶段无界** ❌ |
| 3. `requestDirect`（直连） | L384 | **否**，只传 `init.signal` | L342 `if (!signal) req.setTimeout(20_000, onAbort)` —— 有 signal 就跳过 → **完全无界** ❌ |

即：不是「可能突破 12 秒预算」，而是**没有上界**，只受 OS TCP 兜底（分钟级）。

放大条件：`directFetch` 对 curl 的失败是无差别 `catch { /* fall through */ }`（L369-371），curl 任何非零退出都会掉进 fallback —— 包括 exit 28（自身 `--max-time` 超时）、7（连不上）、6（DNS 失败）。因此在外站大面积失败的环境里，**每个失败 URL 的代价是「curl 的 timeoutMs + 无界」**，且这是常态而非边缘情况。第 3 条直连路径（未配代理时）比 CONNECT 更常被走到，同一个洞。

出网预检（`egress-probe`）不能兜住：它只区分「整体出网通/不通」，而故障形态是「预检通过、大量单站失败」，恰好全部落进 fallback。

现有测试为何没覆盖：`enterprise/apps/web-portal/src/lib/web-search/__tests__/direct-fetch.test.ts:104-125`（"honors timeoutMs for hung upstream"）同时传了 `timeoutMs: 400` **和** `signal: AbortSignal.timeout(400)`。两条 fallback 是靠那个短 signal 才停下来的；生产不传短 signal，所以这条用例与生产调用形态不同，掩盖了缺口。

### 缺口 B：SSE 结束时 `controller.close()` 是裸调用

`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` 里 `safeControllerEnqueue`（L623-631）已经 try/catch 兜住了 enqueue，但四处 `controller.close()` 没有：**L1593、L2123、L2132、L2167**。

客户端已断开（Response body 被 cancel）时 `controller.close()` 抛 `TypeError: Invalid state: Controller is already closed`。传播路径：

- L1593 / L2123 在 `try` 内 → 抛出后落进 L2124 的 `catch` → 走失败分支 → L2167 再 `close()` 一次 → 再抛 → 变成 ReadableStream `start()` 的 unhandled rejection；且会把一次**已完成**的 run 误标为 failed。
- L2132 / L2167 本身在 `catch` 内 → 直接 unhandled rejection。

同类裸 `close()` 还在同文件 L424（`pipeWithPrefix`）与 L436（`textOnlyDoneStream`）。

注意：`transportClosed` 只有在 `transportSignal` abort 或 enqueue 抛错时才为 true。若流被 cancel 但 `req.signal` 尚未 fire，`close()` 仍会抛 —— 所以必须做安全 close，**不是**去 abort run。

**AC-3（transport abort 不杀后台 run）必须保留。** 现有 AC-3 用例 `orchestrator.test.ts:420` 只 `controller.abort()`，没有取消 Response body，因此覆盖不到 `Controller is already closed`，需补用例。

## In scope

- `enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts`：给 CONNECT 与直连两条 fallback 加独立硬超时。
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`：`safeClose()` 包装全部 `controller.close()`。
- 上述两处的单测（新增 + 修正既有用例的调用形态）。

## Out of scope（no-scope-creep 边界）

- 不改 AC-3 语义，不新增任何 `runController.abort()` 调用。
- 不改 `resolveTimeoutMs` 的既有取值策略（8s / 20s 缺省分支保持原样）。
- 不改 curl 路径、`page-fetch` 熔断、`egress-probe`、nginx、Dockerfile。
- 不改 `PAGE_FETCH_TIMEOUT_MS` 等预算常量。
- 不重构 `directFetch` 的三段 fallback 结构。

---

## FR-1：`directFetch` 为所有路径提供统一的有界 signal

**文件**：`enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts`

**改动点 1** —— `directFetch` 主体（当前 L349-385）。在 L357 `const timeoutMs = resolveTimeoutMs(init);` 之后构造有界 signal，并把它替换掉三处 `init.signal`：

```ts
const timeoutMs = resolveTimeoutMs(init);

// runSignal 等长生命周期 signal 不代表单次抓取超时；必须叠一个硬上界，
// 否则 curl 失败后掉进 CONNECT / 直连时没有任何时间约束。
const timeoutSignal = AbortSignal.timeout(timeoutMs);
const effectiveSignal = init.signal
  ? AbortSignal.any([init.signal, timeoutSignal])
  : timeoutSignal;
```

然后：

- L367 `init.signal` → `effectiveSignal`
- L377 `httpsViaProxy(proxy, url, method, headers, bodyBuf, init.signal)` → 追加 `timeoutMs` 参数并传 `effectiveSignal`（见改动点 2）
- L384 `requestDirect(url, method, headers, bodyBuf, init.signal)` → 追加 `timeoutMs` 参数并传 `effectiveSignal`（见改动点 3）

`AbortSignal.any` 在 Node 20+ 可用；本仓库 web-portal 运行时为 Node 20/22，无需 polyfill。若类型报缺失，检查 `tsconfig` 的 `lib`，不要自行手写 polyfill 替代。

**改动点 2** —— `httpsViaProxy`（当前 L248-295）签名加 `timeoutMs`，并把 CONNECT 阶段的硬编码 15s 改为 `Math.min(15_000, timeoutMs)`：

```ts
async function httpsViaProxy(
  proxy: URL,
  url: URL,
  method: string,
  headers: Record<string, string>,
  bodyBuf: Buffer | undefined,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<Response> {
  const socket = await connectViaHttpProxy(
    proxy,
    url.hostname,
    Number(url.port || 443),
    Math.min(15_000, timeoutMs),
  );
```

并在 `req` 创建后（当前 L276 之后、L277 `req.on("response", ...)` 之前）补一行 socket 级兜底，防止 CONNECT 成功后响应阶段挂死：

```ts
req.setTimeout(timeoutMs, onAbort);
```

**改动点 3** —— `requestDirect`（当前 L297-347）签名加 `timeoutMs`，并把 L342 的条件超时改为无条件：

```ts
// before
signal?.addEventListener("abort", onAbort, { once: true });
if (!signal) req.setTimeout(20_000, onAbort);

// after
signal?.addEventListener("abort", onAbort, { once: true });
// 生产传入的是长生命周期 runSignal，不能靠它兜底；始终设置单次请求上界。
req.setTimeout(timeoutMs, onAbort);
```

**AC-1**：`enterprise/apps/web-portal/src/lib/web-search/__tests__/direct-fetch.test.ts` 新增用例 `"bounds fallback paths with timeoutMs even when signal never fires"`：
- 起一个 `createServer((_req, _res) => {})`（永不响应）的本地 http server，取其端口构造 URL。
- 用 `vi.stubEnv` 或等价方式确保不走代理（`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` 置空），使请求落到 `requestDirect`。
- 调用 `directFetch(url, { method: "GET", timeoutMs: 400, signal: new AbortController().signal })` —— **传一个永不 abort 的 controller signal，复现生产形态**。
- 断言：promise reject，且 `Date.now() - started < 3_000`。
- 在当前 `main` 代码上此用例必须**失败**（会挂到测试超时），改完后通过。

**AC-2**：修正既有用例 `__tests__/direct-fetch.test.ts:104`（"honors timeoutMs for hung upstream"），删掉 `signal: AbortSignal.timeout(400)` 只保留 `timeoutMs: 400`，使其反映生产调用形态。改后仍须通过。

**AC-3**：`__tests__/direct-fetch.test.ts` 既有全部用例（含 curl 路径、body 透传、二进制不损坏）保持通过，`npx vitest run src/lib/web-search` 全绿。

---

## FR-2：SSE `controller.close()` 安全化

**文件**：`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`

**改动点 1** —— 在 `safeControllerEnqueue`（当前 L623-631）紧后面新增：

```ts
/** 客户端已 cancel Response body 时 close() 会抛 "Controller is already closed"。 */
const safeClose = () => {
  if (transportClosed) return;
  transportClosed = true;
  try {
    controller.close();
  } catch {
    // 客户端先断开，忽略。
  }
};
```

**改动点 2** —— 把 `runDeepResearchTurn` 主流内**全部四处** `controller.close()` 替换为 `safeClose()`：当前 **L1593、L2123、L2132、L2167**。替换时逐处比对上下文，禁止整段替换相邻无关代码。

**改动点 3** —— 同文件 L424（`pipeWithPrefix`）与 L436（`textOnlyDoneStream`）的裸 `close()` 各自就地包 `try { controller.close(); } catch {}`。这两处在独立的 `ReadableStream` 里、没有 `transportClosed` 变量，不要试图复用 `safeClose`。

**AC-4**：`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts` 新增用例 `"survives client cancelling the response body (AC-3 safe close)"`：
- 参照既有 AC-3 用例（L420 起）的 `baseDeps` 构造方式。
- 拿到 `Response` 后立即 `await response.body!.cancel()`（这是与既有用例的关键差异：既有用例只 `controller.abort()`，不 cancel body）。
- 等待 run 跑完（轮询 `runStore` 直到 status 落定，或复用既有用例的等待方式）。
- 断言：`runStore` 中该 `runId` 最终 `status === "completed"`（**不是** `failed`），且测试期间无 unhandled rejection。可用 `process.on("unhandledRejection")` 收集后断言为空，或依赖 vitest 默认的未处理拒绝失败行为。
- 在当前 `main` 代码上此用例必须**失败**（run 被误标 failed 或抛未处理异常），改完后通过。

**AC-5**：既有 AC-3 用例（`orchestrator.test.ts:420` "keeps running after transport abort and persists completed run"）**保持原样且继续通过** —— 证明没有引入 `runController.abort()`、没有改变「断开后后台继续跑」的语义。

**AC-6**：`grep -rn "runController.abort" enterprise/apps/web-portal/src` 结果为空。

---

## 实施顺序

1. FR-1 改动点 2、3（两个函数签名 + 超时），再改动点 1（组合 signal 并接线）—— 顺序反过来会有一步类型不通过。
2. 写 AC-1 用例，确认改前失败 / 改后通过；再按 AC-2 修既有用例。
3. FR-2 改动点 1 → 2 → 3。
4. 写 AC-4 用例，确认改前失败 / 改后通过。
5. 全量验证。

## 验证命令

```bash
cd enterprise/apps/web-portal
npx vitest run src/lib/web-search
npx vitest run src/lib/deep-research
cd ../.. && pnpm -C apps/web-portal typecheck
```

三条全绿方可提交。

## 风险与回退

- `AbortSignal.any` 需 Node 20+。若 CI 或运行时低于此版本，改为手写组合（新建 `AbortController`，监听两个源 signal 后 `abort()`），**不要**因此放弃硬超时。
- 把 `requestDirect` 的 20s 改为 `timeoutMs` 后，未显式传 `timeoutMs` 且未传 signal 的调用方仍走 `resolveTimeoutMs` 的 20s 缺省分支，行为不变；传了 signal 但没传 `timeoutMs` 的调用方从「无界」收紧到 8s（`resolveTimeoutMs` L77），这是预期收紧，非回归。
- `safeClose` 会把 `transportClosed` 置 true，后续 `safeControllerEnqueue` 直接 no-op —— 因为 close 之后本就不该再写，无副作用。

## 分支说明

本 plan 落 `main`（属根因型 bugfix，按 AGENTS.md 分流规则不在交付分支实施）。审核通过后移回 `.cursor/plans/`，在 `main`（或自 `main` 拉出的功能分支）实施，再同步进并行交付分支。缺口 A、B 在 `main` 与并行交付分支上代码一致（仅行号有偏移），同一份改动可直接同步。
