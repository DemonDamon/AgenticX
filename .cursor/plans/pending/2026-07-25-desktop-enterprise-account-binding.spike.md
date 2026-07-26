# FR-0 Spike：Gateway tool-calling 透传

Date: 2026-07-26  
Gateway live curl: **不可用**（`127.0.0.1:8088/healthz` 无监听）。以下以源码审查 + 修复后 Go round-trip 单测为证据。

## 检查项结论

| # | 检查项 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 1 | 非流式 + `tools` + 响应 `tool_calls` | **FAIL** | **PASS**（schema + 单测） |
| 2 | `stream: true` + `tool_calls` delta | **FAIL** | **PASS**（schema + 单测） |
| 3 | `role: "tool"` 历史回传 | **PASS**（已有 `ToolCallID`） | **PASS**（含 assistant `tool_calls` 历史） |
| 4 | `reasoning_content` / `<think>` 原样透传 | **FAIL**（会 fold 进 content） | 未改（非 1/2/3 阻塞项；Desktop 已能解析 content 内 `<think>`） |

## 根因（修复前）

`enterprise/apps/gateway/internal/openai/types.go`：

- `ChatMessage` 无 `tool_calls` → 非流式响应与多轮历史中的 assistant `tool_calls` 在 `json.Unmarshal` 时静默丢弃。
- `StreamDelta` 无 `tool_calls` → SSE 再 `json.Marshal` 写回客户端时 delta 丢失。
- 请求侧 `Tools` / `ToolChoice` 字段本身已存在；`role:tool` 的 `ToolCallID` 已存在。

## 修复

在同一文件为 `ChatMessage` / `StreamDelta` 增加 `ToolCall` / `ToolCallFunction` 与 `ToolCalls` 字段。  
单测：`enterprise/apps/gateway/internal/openai/tool_calls_roundtrip_test.go`。

## 拟定 curl（网关可用时复验）

```bash
export PAT="agx-pat-..."
# 1) 非流式
curl --noproxy '*' -sS \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  http://127.0.0.1:8088/v1/chat/completions \
  -d '{
    "model":"<configured-model>",
    "messages":[{"role":"user","content":"Call list_dir with path ."}],
    "tools":[{"type":"function","function":{"name":"list_dir","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}],
    "tool_choice":"auto",
    "stream":false
  }'

# 2) 流式
# 同上 body 改 "stream":true，检查 SSE delta.tool_calls[].index / function.arguments

# 3) tool 历史
# messages 含 assistant.tool_calls + role:tool，确认非 400
```

## 判定

1/2/3 在 schema 层已打通；P0 后续任务可继续。第 4 项保持网关现有 thinking merge 行为，不阻塞 Desktop 托管登录。

---

## FR-6 验证记录（2026-07-26）

### 已通过（自动化）

| 项 | 证据 |
| --- | --- |
| Gateway `tool_calls` round-trip | `go test ./internal/openai/ -run ToolCalls\|ToolRole` PASS |
| Portal `prepareGatewayForward` | `vitest run src/lib/gateway-forward.test.ts` 2/2 PASS |
| Portal 新路由文件落盘 | `api/desktop/auth/token`、`bootstrap`、`v1/chat/completions` |
| Desktop IPC / UI | `enterprise-login/logout/refresh/load-enterprise` + 设置「企业账号」Tab + 严格模式过滤 |

### 受阻（本机环境）

- Docker daemon 未运行 → 无法拉起 PG / gateway `:8088` / portal `:3000`
- 因此 AC-6 端到端（登录 → 工具调用 → `usage_records` → admin 用量页）**未能在本机实测**

### 环境就绪后复验命令

```bash
cd enterprise && bash scripts/start-dev-with-infra.sh
# 1) 签发 PAT
curl --noproxy '*' -sS -X POST http://127.0.0.1:3000/api/desktop/auth/token \
  -H 'content-type: application/json' \
  -d '{"email":"admin@agenticx.local","password":"<AUTH_DEV_OWNER_PASSWORD>","deviceName":"spike"}'
# 2) bootstrap / chat 见 plan AC-1~AC-3
# 3) Desktop：设置 → 企业账号登录 → 发「列出当前工作目录下的文件」
```
