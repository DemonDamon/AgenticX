# acp-13 智能体月配额

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

网关按智能体单独计月配额。房间里的云端智能体请求已经带 `x-agenticx-agent-id`。没有该标识、或该智能体没有配额时，仍走原来的用户配额。

## 落点

- `enterprise/apps/gateway/internal/quota/tracker.go`：配置增加 `agents`。命中后用量键是 `agent:<id>`。
- `check_request.go`：`RequestContext.AgentID`。有智能体规则时，限流也用这份规则。
- `server.go` 的 `quotaContext` 把身份里的智能体标识传给配额。
- `trace_context.go` 读取请求头 `X-Agenticx-Agent-Id`。

## AC

- `cd enterprise/apps/gateway && go test ./internal/quota/ ./internal/server/ -count=1` 通过。
- 智能体月额度用尽后该智能体被拒绝，同一用户不带智能体标识仍按员工额度放行。
- 回退后同一智能体可以再次计入额度内的用量。
