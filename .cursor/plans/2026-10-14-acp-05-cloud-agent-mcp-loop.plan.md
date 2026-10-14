# acp-05 云端 Agent 的 MCP 工具循环

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`
Depends: acp-04（`triggerCloudAgentReply` 已存在于 `apps/web-portal/src/lib/collab-room/agent-reply.ts`）

## 目标

`runtime=cloud` 的 Agent 若绑定了 `mcp:<ulid>` 能力，回复时能调用这些 MCP 工具：模型与工具都走 Go 网关，网关继续负责授权、策略、审计、配额。循环有上限，工具过程以一条可折叠的过程摘要写进最终回复的 metadata，不刷屏。

## 根因与证据

- 网关 MCP 托管：`GATEWAY_MCP_HOSTING=on` 时注册 `GET /mcp/registry`、`POST /mcp/{server}/streamable-http`（`enterprise/apps/gateway/internal/server/mcp_handlers.go`）。`{server}` 是 `mcp_servers.name`，由 `ResolveServer(tenantId, name)` 解析；授权失败返回 403 `mcp:capability_revoked`。传输实现见 `apps/gateway/internal/mcphost/transport.go`（实施前通读，确认是否需要先 `initialize`、是否返回/要求 `Mcp-Session-Id` 头、响应是 JSON 还是 SSE）。
- 诊断后端 `EchoBackend`（`apps/gateway/internal/mcphost/backend_echo.go`）提供 `echo`、`ping` 两个工具，`backend_type` 常量 `BackendEcho`，用于本计划验收。
- 网关 `/v1/chat/completions` 是 OpenAI 兼容接口，支持 `tools` / `tool_calls`（读 `apps/gateway/internal/server/channel_handlers.go` 的 `handleChatCompleteRelay` 确认 `tools` 字段原样透传上游）。
- 门户读 `mcp_servers` 的方言表句柄见 `apps/web-portal/src/lib/capability-tables.ts`（`pgMcpServers` / `myMcpServers`）。

## 改动

### 1. 网关 MCP 客户端（门户）

新建 `enterprise/apps/web-portal/src/lib/gateway-mcp-client.ts`：

```ts
export type GatewayMcpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type GatewayMcpCallResult = { ok: boolean; text: string };

export class GatewayMcpClient {
  constructor(opts: {
    gatewayBase: string;           // 由 GATEWAY_COMPLETIONS_URL 去掉 /v1/chat/completions 得到，或读 GATEWAY_INTERNAL_BASE_URL
    serverName: string;
    headers: Record<string, string>; // 与模型调用同一套身份头（authorization、x-tenant-id、x-user-id …）
    fetchImpl?: typeof fetch;
    timeoutMs?: number;            // 默认 20000
  });
  listTools(): Promise<GatewayMcpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<GatewayMcpCallResult>;
}
```

- JSON-RPC 2.0；按 transport.go 的实际要求处理 `initialize` 与会话头。
- `callTool` 把 MCP `content[]` 里 `type==="text"` 的片段拼成 `text`，`isError` 映射 `ok=false`；HTTP 403 返回 `{ ok:false, text:"无权使用该工具" }`，其它 HTTP 错误返回 `{ ok:false, text:"工具调用失败（HTTP <code>）" }`，不抛出。
- 结果文本截断到 8000 字。

### 2. 工具循环

在 `agent-reply.ts` 新增（或新建 `agent-executor.ts` 并由 `triggerCloudAgentReply` 调用）：

```ts
export const MAX_TOOL_ROUNDS = 6;
export async function runCloudAgentLoop(params: {
  agent: EnterpriseAgent;
  messages: ChatMessage[];      // acp-04 构造的 prompt
  modelHeaders: Record<string, string>;
  model: string;                // 拆分后的 model 名
  mcpServers: Array<{ id: string; name: string }>;
  deps?: { fetchImpl?: typeof fetch; gatewayCompletionsUrl?: string };
}): Promise<{ content: string; steps: AgentStep[] }>;

type AgentStep = { tool: string; server: string; ok: boolean; durationMs: number };
```

流程：

1. 解析 `agent.capabilityIds` 中的 `mcp:<ulid>` → 查 `mcp_servers`（同租户、`status='active'`）得到 name。查不到的跳过并在日志记 `room.agent.mcp_missing`。
2. 对每个 server `listTools()`，合成 OpenAI `tools`，函数名为 `${serverName}__${toolName}`（非 `[A-Za-z0-9_-]` 字符替换成 `_`，总长 ≤ 64），保存反查表。`listTools` 失败的 server 跳过。
3. 无可用工具 → 走 acp-04 原有非工具调用路径，行为不变。
4. 有工具 → 非流式调 `/v1/chat/completions`，body 带 `tools` 与 `tool_choice: "auto"`；若返回 `tool_calls`，逐个调用 `callTool`，把结果作为 `role:"tool"` 消息（带 `tool_call_id`）追加，继续下一轮；没有 `tool_calls` 时取 `content` 结束。每轮 `x-agenticx-trace-step` 递增，`x-agenticx-trace-id` 全程不变。
5. 达到 `MAX_TOOL_ROUNDS` 仍在调工具：最后再请求一次不带 `tools` 的补答，要求基于已有工具结果作答。
6. 模型返回非法 JSON 参数：该次工具结果记 `ok=false, text="参数不是合法 JSON"`，继续循环。
7. 最终回复去掉 `<think>…</think>`（同 `requestMetaReply`）。

### 3. 写回房间

最终回复仍是一条 `sender_type="agent"` 消息；`metadata` 增加 `tool_steps: AgentStep[]`（只含工具名、server、成败、耗时，不含参数与结果）。

`src/components/rooms/RoomChatView.tsx`：agent 消息若有 `metadata.tool_steps`，在气泡下方渲染默认折叠的「调用了 N 个工具」小条，展开显示每步「server · tool · 成功/失败 · 耗时」。不为每个工具单独插消息。

## AC

1. `src/lib/__tests__/gateway-mcp-client.test.ts`：mock fetch 覆盖 initialize（如需要）、tools/list、tools/call 文本拼接、isError、403、超时。
2. `src/lib/collab-room/__tests__/agent-loop.test.ts`：mock 两轮（第一轮返回 tool_calls 调 `echo`，第二轮返回文本）→ steps 长度 1、最终 content 正确、第二轮请求包含 `role:"tool"` 消息；达到上限时发出不带 tools 的补答请求；非法参数 JSON 路径；无 MCP 能力时完全不带 tools。
3. `pnpm -C enterprise --filter @agenticx/app-web-portal typecheck` 与 `test` 通过。
4. 端到端（主控执行）：管理台登记一个 `backend_type` 为 echo 的 MCP 服务（名称 `diag-echo`，若管理台表单不支持 echo 类型，直接在数据库插入，并在交付说明写明）并在能力包或用户分配中让测试用户可用；acp-01 的 `report-bot` 绑定 `mcp:<该 id>`；房间里发「@report-bot 请调用 echo 工具回显：hello-acp05」→ 回复包含 `hello-acp05`，气泡下有「调用了 1 个工具」；网关审计里能查到该次 MCP 调用（`gateway_audit_events` 或 JSONL）。

## Out of scope

Skill 内容注入；流式输出；工具确认/人工审批；把 Go 网关改成执行循环；PAT 版房间接口。
