# 能力回流 B2：流被提前掐断时不再当成成功

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —

## 目标

1. 前端 SDK 读到流结束却没见过 `data: [DONE]` 时，报一条「连接提前中断」错误，而不是当作正常结束。
2. 网关单次请求超时可配置；超时发生在流已开始之后时，先写一条 SSE 错误帧再写 `data: [DONE]`，而不是直接断开。

两件事必须一起做：只改 SDK，超时仍会被当成成功；只改网关，掐断后 SDK 仍可能当成功。

## 现状（已核实）

- SDK：`enterprise/packages/sdk-ts/src/chat/http.ts`（367 行）。读循环在 L334 结束时无条件 `yield { requestId, done: true }`，不区分是否见过 `[DONE]`。`ChatChunkError` 没有 `origin` 字段。测试 `http.test.ts` 266 行。
- 网关：`enterprise/apps/gateway/internal/server/server.go` L653 `r.Use(middleware.Timeout(10 * time.Minute))`（chi 中间件）。流已开始时超时会直接取消连接。已有空闲超时的 SSE 文案（`stream_error_format_test.go`），没有请求超时的收尾。
- 门户自己产出的 SSE 都以 `data: [DONE]` 结尾：深度研究 `lib/deep-research/orchestrator.ts`（L570、L1930、L2558、L2567、L2613）、联网搜索 `lib/web-search/tool-loop.ts`（L160、L486、L537、L561、L577）、研究流 `app/api/chat/deep-research/runs/[runId]/stream/route.ts`（L102、L117、L136）。普通对话车道在 `app/api/chat/completions/route.ts` L306 起直接透传网关流。
- 来源：`$DELIVERY_REPO` 提交 `c20a77b3`（SDK）、`b84ff9da`（网关）。网关侧文件：新 `internal/server/request_timeout.go`（26 行）+ `request_timeout_test.go`（80 行），以及 `server.go`、`protocol_handlers.go`（约 L391–L404）、`channel_handlers.go`（约 L305–L307）的改动。用 `git -C $DELIVERY_REPO show <hash>` 读原文。

## 改动

### 1. SDK（`packages/sdk-ts/src/chat/http.ts`）

- 读循环里维护 `let sawDone = false`；解析到 `data: [DONE]` 时置 `true` 并按现有逻辑结束。
- 循环自然结束（EOF）时：

```ts
// before
yield { requestId, done: true };

// after
if (sawDone) {
  yield { requestId, done: true };
} else {
  yield {
    requestId,
    done: true,
    traceId: pending.traceId,
    error: { code: "50000", origin: "transport", message: "连接提前中断，未收到完成标记" },
  };
}
```

- `ChatChunkError`（同文件或 `types.ts` 中的类型定义）增加可选字段 `origin?: "transport" | "upstream" | "gateway"`；其他已有 `error` 构造点不改含义，不强制填。
- 取消（`pending.cancelled` / `AbortError`）路径不变，仍是 `cancelled: true`，不带错误。

### 2. 网关请求超时（`apps/gateway/internal/server/`）

- 新文件 `request_timeout.go`，从交付仓摘取 `requestTimeout(d time.Duration) func(http.Handler) http.Handler`：用 `context.WithTimeout` 包请求；**不**像 chi `Timeout` 那样在超时后改写 504。
- `server.go` L653：

```go
// before
r.Use(middleware.Timeout(10 * time.Minute))

// after
r.Use(requestTimeout(requestTimeoutFromEnv()))
```

  `requestTimeoutFromEnv()` 读 `GATEWAY_REQUEST_TIMEOUT`（Go duration 字符串，如 `10m`）；为空或解析失败或 `<=0` 时用 `10 * time.Minute`，解析失败打一条 warn 日志。
- 流式写出处（OpenAI chat completions 流、`protocol_handlers.go` 的其他协议流、`channel_handlers.go` 的渠道流）：上下文因超时取消且响应头已写出时，把流错误标记为 `stream:request_timeout`，写一条 SSE 错误帧，再写 `data: [DONE]`。错误帧格式与现有空闲超时的写法一致（复用同一个格式化函数，在其映射里加 `stream:request_timeout` → 「本次生成超过时限，已停止。可以缩短问题或稍后重试。」）。
- 响应头尚未写出时超时：返回现有 504 / 网关超时错误体，不变。

### 3. 普通对话车道核对

- 确认 `app/api/chat/completions/route.ts` 普通车道透传的网关流在正常结束时一定以 `data: [DONE]` 收尾（网关 OpenAI 流成功路径会写）。若发现任何门户自产 SSE 在成功路径不写 `[DONE]`，在该处补上，并在本计划「验收记录」列出位置。

## In scope / Out of scope

- In：SDK 未完成流判定、`ChatChunkError.origin`、网关可配置请求超时与超时收尾、上述三个流写出点。
- Out：前端如何展示这条错误（B3 处理继续生成与提示）；深度研究章节重试（B6）；改默认超时时长。

## 验收

- AC-1：`packages/sdk-ts/src/chat/http.test.ts` 新增：
  - 流以 `data: [DONE]` 结束 → 最后一帧 `done: true` 且无 `error`。
  - 流直接 EOF、未见 `[DONE]` → 最后一帧 `done: true`，`error.origin === "transport"`，`error.code === "50000"`。
  - 中途 abort → `cancelled: true`，无 `error`。
- AC-2：新增 `apps/gateway/internal/server/request_timeout_test.go`：
  - 处理器在超时前写完 → 正常返回。
  - 处理器先写 SSE 头再阻塞超过超时 → 客户端读到的末尾依次是一条含 `request_timeout` 文案的错误帧和 `data: [DONE]`。
  - 处理器未写头就超时 → 504。
  - `GATEWAY_REQUEST_TIMEOUT=50ms` 生效；`abc` 回落 10 分钟。
- AC-3：`pnpm -C enterprise/packages/sdk-ts test && pnpm -C enterprise/packages/sdk-ts typecheck`；`pnpm -C enterprise/features/chat test`；`pnpm -C enterprise/apps/web-portal typecheck && pnpm -C enterprise/apps/web-portal test`（除基线 10 条外无新增失败）。
- AC-4：`cd enterprise/apps/gateway && go test ./internal/server/...` 通过。
- AC-5（验收方手工）：以 `GATEWAY_REQUEST_TIMEOUT=5s` 启动网关，在门户发一个会长时间输出的问题，5 秒后界面出现「超过时限」提示且已输出内容保留；恢复默认后正常长回答不受影响。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：AC-1 `sdk-ts` 16/16 通过、typecheck 通过；AC-2 / AC-4 `go test ./internal/server/...` ok，含四条超时用例；AC-3 门户类型错误与基线完全一致（26 条，无新增），`features/chat` 两条失败为基线原有。代码复核：超时路径只写一次 `[DONE]`（`writeStreamError` 本身不写）；非超时错误帧路径 SDK 在 `chunk.error` 分支立即返回，不会叠加「连接中断」；`[DONE]` 核对未发现需要补的门户成功路径。
- AC-5 手工（2026-10-20）：网关以 `GATEWAY_REQUEST_TIMEOUT=5s` 重启后，门户长问题 5 秒后显示「本次生成超过时限，已停止。可以缩短问题或稍后重试。」并带请求 ID，输入区出现「继续生成」；恢复默认后续写正常长输出。通过。
