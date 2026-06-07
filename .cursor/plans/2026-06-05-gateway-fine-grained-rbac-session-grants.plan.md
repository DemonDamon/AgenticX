---
name: 字段级 RBAC + 会话级临时权限 + 实时权限回收
overview: 在策略/鉴权层补齐三项权限能力——字段级访问控制（请求/响应字段允许或脱敏）、会话级临时授权（智能体协作的短时 scope 授予与到期）、PAT/会话权限的近实时回收（缩短缓存窗口 + 主动失效通道）。
todos:
  - id: t1-field-acl
    content: 策略引擎增加字段级规则类型（path 命中→allow/deny/redact）
    status: completed
  - id: t2-session-grant-model
    content: 设计会话级临时授权数据结构与签发/校验（带 TTL 与 scope）
    status: completed
  - id: t3-grant-enforce
    content: 网关请求链校验会话授权，过期自动失效
    status: completed
  - id: t4-realtime-revoke
    content: PAT 缓存 TTL 缩短 + 吊销主动失效通道（版本号/吊销列表）
    status: completed
  - id: t5-admin-ui
    content: admin 授权管理与吊销 UI + 审计
    status: completed
  - id: t6-smoke
    content: 冒烟测试覆盖字段脱敏、临时授权到期、吊销即时失效
    status: completed
isProject: false
---

# 字段级 RBAC + 会话级临时权限 + 实时权限回收

**Plan-Id**: 2026-06-05-gateway-fine-grained-rbac-session-grants
**Plan-File**: `.cursor/plans/2026-06-05-gateway-fine-grained-rbac-session-grants.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：API/资源级 scope RBAC 已落地（`enterprise/packages/iam-core/src/scope-registry.ts` + `requireAdminScope`）；策略引擎支持 keyword/regex/pii + redact（`enterprise/apps/gateway/packages/policy-engine/`）。**缺**：字段级权限、会话级临时授权、PAT 近实时回收（当前 `auth/pat.go` 缓存 TTL 60s）。客户要求字段级/API级管控、会话级临时授权、离职即时失效。

## 需求

- FR-1（字段级）: 策略支持「字段路径规则」——对请求/响应 JSON 指定 path（如 `messages[*].content`、`metadata.ssn`）命中后 `allow`/`deny`/`redact`，复用现有 redact 占位逻辑。
- FR-2（会话级临时授权）: 支持为某 `sessionId` 在 TTL 内授予额外 scope（智能体协作场景），到期自动失效；网关在请求链校验「JWT 基础 scope ∪ 会话临时 scope」。
- FR-3（实时回收）: PAT/会话授权吊销后近实时失效——缓存 TTL 缩短到可配置（默认 ≤5s）并提供主动失效信号（吊销版本号 / 吊销列表拉取），离职用户关联 PAT 吊销后下一请求即被拒。
- NFR-1: 未配置字段规则/临时授权时行为与现状等价；校验失败 fail-secure 仅作用于显式 deny，不误伤无规则流量。
- AC-1: 配置 `metadata.ssn` redact 规则，响应中该字段被替换为占位符，其余字段不变。
- AC-2: 为会话签发 10s 临时 scope，10s 内可访问受限操作，过期后被拒。
- AC-3: 吊销某 PAT 后，≤5s 内（或主动失效后下一请求）该 PAT 被拒。

## 改动范围（严格）

1. `enterprise/apps/gateway/packages/policy-engine/`
   - `types.go` 增加 `kind: field`（含 `JSONPath`、`Target: request|response`、`Action: allow|deny|redact`）。
   - `engine.go` 字段规则求值（path 提取 + 动作），redact 复用现有占位。
2. `enterprise/apps/gateway/internal/auth/`
   - `session_grant.go`（新）：临时授权校验（读 admin 下发或 Redis/PG）。
   - `pat.go`：缓存 TTL 改为可配置 env（默认 5s）；增加吊销版本/列表拉取，命中即逐出缓存。
3. `enterprise/apps/gateway/internal/server/server.go`
   - 请求/响应链合并基础 scope 与会话临时 scope 后做授权判断；字段规则接入响应通道处理。
4. `enterprise/packages/iam-core/` + `enterprise/apps/admin-console/`
   - 临时授权签发/吊销 service + API；PAT 吊销写吊销版本。
   - admin 增「会话授权」「吊销」管理与审计；吊销/授权落审计链。

不动：现有 scope 注册表语义、SSO、策略包草稿/发布机制（字段规则作为新 kind 复用同发布通道）。

## 验证步骤

1. `go test ./packages/policy-engine/... ./internal/auth/...`（AC-1/2/3）。
2. 本地端到端：发响应含 ssn 的请求验证脱敏；签发临时 scope 验证到期；吊销 PAT 验证即时拒绝。
3. `pnpm -C enterprise test`（iam-core 授权/吊销单测，若存在）。

## 回滚

- 字段规则为新 kind，删规则即停用；临时授权与吊销通道为新增旁路，关闭 env 回到 60s 缓存现状；均非破坏性。
