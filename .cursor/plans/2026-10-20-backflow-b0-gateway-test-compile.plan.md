# 能力回流 B0：网关测试随消息内容类型更新

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —

## 目标

`enterprise/apps/gateway` 里五个包的测试重新能编译、能跑，后续 B2 / B7 / B9 改网关时才有回归可看。只改测试文件，不改生产代码。

## 现状（已核实）

- `enterprise/apps/gateway/internal/openai/types.go` L18：`ChatMessage.Content` 是 `json.RawMessage`。
- 同目录 `content.go`：`ContentText(raw json.RawMessage) string`（L10，取文本）、`NewStringContent(text string) json.RawMessage`（L43，构造 JSON 字符串内容）。
- `cd enterprise/apps/gateway && go test ./...` 下列包报 `[build failed]`，原因都是测试里还在把字符串字面量当 `Content`：
  - `internal/adaptor`：`bedrock_test.go` L17、L44
  - `internal/cache`：`integration_test.go` L13、L19；`key_test.go` L13–L53；`l2_safety_test.go` L12
  - `internal/channel`：`lb_policy_test.go` L36–L47；`picker_lb_test.go` L82–L115
  - `internal/inbound`：`inbound_test.go` L25、L57
  - `internal/relay`：`integration_test.go` L38–L186；`multi_protocol_integration_test.go` L94–L137（编译器在 "too many errors" 处截断，修完要再跑一遍找剩余行）

## 改动

只动上述 `*_test.go`：

```go
// before
{Role: "user", Content: "hello"}
if req.Messages[0].Content != "Hello" { ... }

// after
{Role: "user", Content: openai.NewStringContent("hello")}
if openai.ContentText(req.Messages[0].Content) != "Hello" { ... }
```

- 测试文件若在 `openai` 包外，按文件现有导入别名引用（多数已 `import "github.com/agenticx/enterprise/gateway/internal/openai"`）；没有就补导入。
- 如果某处断言的是 JSON 原文（例如缓存 key 计算依赖原始字节），用 `NewStringContent` 构造即可，期望值不要手写转义。
- 不改用例语义、不删用例、不加 `t.Skip`。

## In scope / Out of scope

- In：上述五个包的测试文件编译修复。
- Out：`internal/mcphost` 的 `TestConnectorBackendExecuteActionMissingConnection` 失败（运行时失败，不是编译问题，见主计划 §8 之外的基线记录，不修）；任何生产代码。

## 验收

- AC-1：`cd enterprise/apps/gateway && go vet ./internal/adaptor/... ./internal/cache/... ./internal/channel/... ./internal/inbound/... ./internal/relay/...` 无报错。
- AC-2：`go test ./internal/adaptor/... ./internal/cache/... ./internal/channel/... ./internal/inbound/... ./internal/relay/...` 全部能编译；若有用例运行失败，逐条列出失败名与原因写进本文件「验收记录」，不在本计划内修生产代码。
- AC-3：`go test ./...` 除 `mcphost` 那一条外，不再有 `[build failed]`。
- AC-4：`git diff --stat` 只出现 `*_test.go`。

## 验收记录

- 2026-10-20 Opus 5.5 复核：AC-1 `go vet` 五个包无输出；AC-2 五个包 `go test` 全部 ok；AC-3 `go test ./...` 无 `[build failed]`，仅余计划外的 `mcphost/TestConnectorBackendExecuteActionMissingConnection`（基线即失败）；AC-4 变更仅 9 个 `*_test.go`（+35 −34）。通过。
