# SP5: 一键处置与事件记录（incident-response-loop）

Plan-Id: incident-response-loop
Parent-Plan: plans/security-governance/MASTER-PLAN.md（缺口 G5：处置无闭环——有原语无告警→处置联动）
Status: implemented（2026-11-13 实施 + 测试全绿；实施时编排层落在 admin-console `src/lib/incident-response.ts`，iam-core 侧为 `session-revocation-store.ts` + `incident-response-primitives.ts`，替换清单 #8 的 `incident-response-service.ts` 命名）
Suggested-Impl-Model: 中强档

## 一、探查结论

| 事实 | 位置 |
|---|---|
| PAT 吊销闭环已存在：console `revokePat(id, tenantId)`（DB status='revoked' + `recordPatRevocation(hash)` 写 `enterprise_runtime_pat_revocation` 快照表）→ 网关 `PATRevocationStore` 轮询 `GATEWAY_REMOTE_PAT_REVOCATION_URL`（5s TTL）+ 本地 `InvalidateLocal` 即时；`PATVerifier.Verify` 第一行就查 `revocationStore.IsRevoked(hash)` → `auth:pat_revoked`（**无需 DB 即命中**，测试可用 `NewPATVerifier(nil)`） | `packages/iam-core/src/pat-service.ts:153-174`、`pat-revocation-store.ts`、`gateway/internal/auth/pat.go:105-163`、`revocation.go:21-97` |
| 登录会话存储：`auth_refresh_sessions` 表（web-portal refresh token 会话，sessionId 主键）；JWT access token 是无状态 RS256（`claims.SessionID`），**网关目前不校验 session 存活性**——杀 session 需网关新增吊销存储 | `packages/db-schema/src/schema/runtime-config.ts:192-202`、`gateway/internal/server/server.go:1725-1776` |
| `session_grants` 表（临时 scope 授权，`revoked_at` 列，SessionGrantStore 查询已带 `revoked_at IS NULL`）——与会话击杀是两回事，不动它 | `runtime-config.ts:130-146`、`gateway/internal/auth/session_grant.go:55-73` |
| 用户禁用原语已备：`users.status` ∈ active/disabled（`AdminUserStatus`），PG+MySQL 双 repo；console 无用户管理页面/API（iam API 仅 bulk-import）——处置动作直接调 repo 更新，无需新建用户管理 | `packages/iam-core/src/repos/users.ts:14,317`、`repos/mysql/users.ts`、`api/admin/iam/` |
| 模型开关已有：`POST /api/admin/providers`（body.enabled boolean）；SP2 准入门槛 file store `.runtime/admin/model-admission.json`（`model-admission-store.ts`）——"模型拉黑"=provider enabled=false，网关既有热加载生效 | `api/admin/providers/route.ts:51`、`lib/model-admission-store.ts:61` |
| console→网关内部通道已有：`GATEWAY_INTERNAL_URL` + `GATEWAY_INTERNAL_TOKEN`（Bearer）；网关 `/internal/*` API 族先例（`gatewayInternalAuthorized(r)`）；console 侧 client `gateway-internal-base.ts` / `gateway-internal-token.ts` | `gateway/internal/server/channel_handlers.go:249-260`、`admin-console/src/lib/gateway-internal-*.ts` |
| 网关防篡改审计链：`audit.Event`（blake2b checksum，JSONL+PG 双写）；SP4 先例 `AlertDispatch *AlertDispatchRecord`（新字段进链）；console iam 审计 `insertAuditEvent`（PG+MySQL 双实现）；SP2 先例 `auditConsoleEvent` | `gateway/internal/audit/writer.go:41-102,124-168`、`dual_writer.go`、`iam-core/src/repos/audit.ts:34-42` |
| Server 测试范式：`&Server{}` 裸构造 + 注入 Dispatcher/FileWriter + `t.Setenv`（`alert_dispatch_wiring_test.go`）；处置端点测试同款 | `gateway/internal/server/alert_dispatch_wiring_test.go:60-86` |
| iam-core repo 双实现范式：`contracts.ts` + `postgresql/` + `mysql/` + 顶层按 `resolveDatabaseConfig().dialect` 分流（audit.ts 是最简样板，SP5 incident repo 照抄） | `iam-core/src/repos/audit.ts`、`repos/postgresql/audit.ts`、`repos/mysql/audit.ts` |
| SP4 Alert 已带 `SessionID/UserID/Model`——告警驱动处置的主体信息现成 | `gateway/internal/alertdispatch/alert.go:6-18` |

## 二、设计

### 处置闭环流（MASTER-PLAN 第五节落地）

```text
告警/审计发现（policy_hit 事件带 trace_id/session/user/model）
  → console 安全事件页立案（security_incidents：status=open，trace_id 关联审计链）
  → 处置面板一键处置（四类动作；user 级二次确认）
  → console 处置 API 编排（先 insertAuditEvent 留痕 → 持久化执行 → 调网关落链+即时吊销 → 写动作明细 → 状态流转）
  → 网关：先写 incident_action 审计链事件（checksum 防篡改）→ 内存即时吊销（PAT Verify / JWT session 校验 → 401）
  → 事件记录三态流转 open → handling → resolved（处置动作自动 open→handling；resolved 管理员手动带结案说明）
```

### 职责切分

**网关（薄端点：落链 + 内存即时吊销，不写 DB）** `POST /internal/security/incident-action`（GATEWAY_INTERNAL_TOKEN 认证）：
- 四类 action 统一入口：`terminate_session` / `revoke_pat` / `disable_user` / `block_model`
- **先落链**：`Event.EventType="incident_action"` + 新字段 `IncidentAction *IncidentActionRecord`（进 checksum 链，SP4 AlertDispatch 同款），Outcome：`executed`（有内存副作用）/ `recorded`（纯记录，执行在 console）
- **再执行内存吊销**：`revoke_pat` → `patVerifier.RevocationStore().InvalidateLocal(targetHash)`（Verify 首查即命中，即时 401）；`terminate_session` → `sessionRevocations.InvalidateLocal(sessionID)`；`disable_user`/`block_model` 无网关侧内存动作（其 PAT/session 子动作由 console 编排逐项调用，各自有链事件）
- 持久化（DB status、file store）全部由 console 完成网关不碰

**网关 SessionRevocationStore（新 `gatewayauth/session_revocation.go`，仿 PATRevocationStore）**：
- 内存 set + `InvalidateLocal(sessionID)` + `IsRevoked(sessionID)`
- 轮询 `GATEWAY_REMOTE_SESSION_REVOCATION_URL`（5s TTL，快照 `{version, revokedSessionIds[], updatedAt}`）——重启恢复 + 多副本感知，DB 拉取失败保留旧列表（fail-safe）
- 接线：`identityFromRequest` JWT 分支 parse 成功后 `IsRevoked(claims.SessionID)` → 401；未配置+无本地吊销 = 零行为变化（off 等价现状）

**console（编排者 + 事件记录主人）**：
- 新表（db-schema）`security_incidents`：id/tenantId/title/source/severity/status(open|handling|resolved)/traceId/sessionId/userId/model/summary/createdBy/handledAt/resolvedAt/resolutionNote + auditColumns
- 新表 `security_incident_actions`：id/incidentId/tenantId/actionType/targetType/targetId/actorUserId/detail/outcome/createdAt
- 新表 `enterprise_runtime_session_revocation`（runtime-config.ts，仿 pat_revocation）：tenantId/sessionId/revokedAt/version——网关轮询数据源
- iam-core incident repo（contracts + pg + mysql 双实现，audit.ts 样板）：create/get/list/updateStatus（校验合法边：open→handling、handling→resolved、resolved→handling 重开）/insertAction/listActions
- 处置 API `POST /api/admin/security/incidents/[id]/actions` 编排：
  1. `insertAuditEvent`（先审计：incident_action_executed，detail 含 incident_id/action/target/actor）
  2. 持久化执行：`terminate_session` → 写 revocation 表 + DELETE auth_refresh_sessions 行（断 refresh 续命；MySQL 部署该表仅 PG，降级跳过并注明）；`revoke_pat` → 复用 `revokePat()`（含 revocation 快照表）；`disable_user` → `users.status='disabled'` + 该用户全部 PAT 逐个 revokePat + 全部 session 逐个终止；`block_model` → provider enabled=false（复用 providers 底层 store）
  3. 调网关 internal 端点（每动作一次；disable_user 展开的子动作逐项调用——本机 localhost 开销可忽略，链上每动作独立可追溯）
  4. 写 security_incident_actions 明细（outcome=done/failed）+ incident 状态自动 open→handling
- user 级二次确认：disable_user 请求必须带 `confirm: true` + `confirmUserEmail` 与目标用户 email 一致，否则 400（session/token 级默认放行，对齐风险表）
- internal snapshot route `GET /api/internal/session-revocation-snapshot`（isGatewayInternalAuthorized + 读 revocation 表，pat-revocation-snapshot 镜像）

### Console UI（审计页新卡片 `security-incidents-card.tsx`，SP3/SP4 卡片先例）

- 事件列表：status 徽章（open 红/handling 黄/resolved 绿）、severity、trace_id（跳审计链下钻过滤）、时间
- 立案表单（title/severity/traceId/summary/sessionId/userId/model——从审计事件行"一键立案"带参跳转）
- 选中事件：四类处置按钮 + **disable_user 二次确认对话框**（显示目标用户邮箱、要求输入邮箱确认）+ 动作历史时间线
- 状态流转：标记 handling→resolved（必填结案说明）、resolved 重开

### SOP（enterprise/SECURITY.md 增补"事件响应 SOP"节）

分级响应（CRITICAL 15min 内进 handling）、处置动作决策树（凭据类先吊销、会话类先断 refresh、误伤对账）、状态机与审计要求（每动作链可查）、复盘（resolved 后 48h 内补记）。

## 三、改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `gateway/internal/audit/writer.go` | `IncidentActionRecord` 结构 + `Event.IncidentAction` 字段（omitempty 进链） |
| 2 | `gateway/internal/auth/session_revocation.go`（新） | SessionRevocationStore（内存 + snapshot 轮询）+ 单测 |
| 3 | `gateway/internal/auth/pat.go` | `RevokeByHash(hash)` 小方法（revocationStore.InvalidateLocal + 清 cache） |
| 4 | `gateway/internal/server/server.go` | Server 挂 `sessionRevocations`；`identityFromRequest` JWT 分支接线 IsRevoked→401；构造函数初始化 |
| 5 | `gateway/internal/server/incident_action_handlers.go`（新） | `POST /internal/security/incident-action`（gatewayInternalAuthorized + 先落链再执行）+ 路由注册 |
| 6 | `packages/db-schema/src/schema/security-incidents.ts`（新）+ runtime-config.ts 增表 + index 导出 | security_incidents / security_incident_actions / enterprise_runtime_session_revocation（drizzle 迁移脚本生成） |
| 7 | `packages/iam-core/src/repos/contracts.ts` + `postgresql/incidents.ts` + `mysql/incidents.ts`（新）+ `repos/incidents.ts`（分流）+ index 导出 | incident repo 双实现（CRUD + 状态机边校验 + 动作明细） |
| 8 | `packages/iam-core/src/incident-response-service.ts`（新） | 处置编排（session 终止含 auth_refresh_sessions 清理、user 禁用展开、动作审计）+ 单测 |
| 9 | `admin-console/src/app/api/admin/security/incidents/route.ts`（新）+ `[id]/route.ts` + `[id]/actions/route.ts` | 立案/列表/详情/状态流转/处置编排（先审计后动作；user 级 confirm 校验） |
| 10 | `admin-console/src/app/api/internal/session-revocation-snapshot/route.ts`（新） | 网关轮询数据源（internal auth） |
| 11 | `admin-console/src/app/audit/security-incidents-card.tsx`（新）+ audit-page.tsx 挂载 | 事件卡片 + 处置面板 + 二次确认 |
| 12 | `enterprise/SECURITY.md` | 事件响应 SOP 节 |
| 13 | Go/TS 测试 | 见验收清单 |

## 四、验收标准（对齐 MASTER-PLAN 第八节 SP5 行）

- [x] Go E2E（核心验收）：模拟外泄攻击（policy 拦截 90001）→ 告警 dispatch（httptest 收到，带 session/user）→ POST 处置端点（revoke_pat + terminate_session）→ 审计链出现 incident_action 事件（checksum 链可验）→ **原 PAT 再 Verify 返回 pat_revoked（401）+ 原 session IsRevoked（JWT 401 路径）**
  —— `gateway/internal/server/incident_response_wiring_test.go#TestIncidentResponseLeakDispositionE2E`：告警带 sess-leak-1、原 PAT `pat_revoked`、同 session JWT 401（`session_revoked`）、无关 session 不受影响、链上 policy_hit×1 + alert_dispatch×1 + incident_action×2 且 `VerifyAuditChain` 通过
- [x] Go：处置端点先落链后执行（链上事件序：incident_action 在吊销生效前可查）；四类 action 全部落链（disable_user/block_model Outcome=recorded）
  —— `incident_action_handlers.go` 落链失败 500 拒绝执行；E2E 同上覆盖 executed/recorded 双 outcome
- [x] Go：SessionRevocationStore 单测（InvalidateLocal/IsRevoked/snapshot 轮询恢复/拉取失败保留旧列表）；未配置 URL + 无本地吊销 = IsRevoked 恒 false（off 等价现状）
  —— `gateway/internal/auth/session_revocation_test.go` 5 测试全过（含空 ID 永不吊销——PAT 路径无 session）
- [x] Go：internal 认证缺失 401 —— `gatewayInternalAuthorized` 拒绝（incident_response_wiring_test.go 覆盖）
- [x] TS（iam-core）：状态机合法边校验（open→handling/handling→resolved/resolved→handling；非法跳转拒绝）；incident repo CRUD 双实现
  —— `iam-core/src/repos/__tests__/incidents.test.ts` 12 测试（合法/非法边、dialect dispatch、行映射 detail JSON.parse）；repo 双实现 pg+mysql；typecheck 0 错误
- [x] vitest（console）：处置 API 编排顺序（insertAuditEvent 先于持久化动作、先于网关调用）；disable_user 无 confirm/邮箱不匹配 400；session/token 级无确认放行；snapshot route internal auth；CRUD route 测试
  —— `admin-console/src/lib/__tests__/incident-response.test.ts` 7 测试（callOrder 编排纪律、revoke_pat hash 传递、disable_user 确认/级联 5 次网关调用、block_model、网关失败 outcome=failed）；`.../incidents/[id]/actions/__tests__/actions-route.test.ts` 6 测试；`.../internal/session-revocation-snapshot/__tests__/route.test.ts` 3 测试（auth 401/no-store/500）
- [x] 回归：gateway auth/server/audit/alertdispatch 包 + iam-core + console 相关测试全绿
  —— gateway `go test ./internal/...` 全 ok；iam-core 173 测试全过 + typecheck 0 错；db-schema 30 测试全过 + typecheck 0 错；console SP5 16 测试全过 + typecheck 我方文件零错误（余 18 项均为 pre-existing）
- [x] commit 带 Plan-Id/Plan-File/Impl-Model: GLM-5.3/Made-with: Damon Li

## 五、纪律对齐

- **先审计后动作**：console 先 `insertAuditEvent` 再执行持久化；网关先落链（incident_action）再 InvalidateLocal——两端动作意图全部先于动作可查
- **处置全审计可回滚**：PAT 可重发（既有 createPat）、用户可重新启用（status 字段回写）、模型可再启用（provider enabled）、session 可重登录
- **误伤对策**：session/token 级默认放行、user 级二次确认（MASTER-PLAN 风险表）；disable_user 展开子动作逐项留痕可部分撤销
- **off 等价现状**：未配置 revocation URL 且无处置动作时网关零行为变化；无 incident 记录时 console 零行为变化
- **不自建工单**：security_incidents 三态够用（MASTER-PLAN 不做第 4 条），事件记录用现有 PG + 审计链
- **报告即产品**：处置动作链上可查 → SP6 演练直接引用为证据

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| console 调网关失败导致动作半完成 | 处置 API 顺序：先断 refresh（DB）再调网关即时吊销；失败时明细 outcome=failed + incident 保持 handling 待重试，UI 报错不静默 |
| 网关重启丢内存吊销 | SessionRevocationStore 轮询 console snapshot（5s）恢复；PATRevocationStore 同款已验证 |
| auth_refresh_sessions 仅 PG（MySQL 部署） | MySQL 侧 session 终止降级：仅网关 access 吊销 + revocation 表持久，refresh 行跳过并在动作 detail 注明 |
| 误杀在线用户 | user 级二次确认 + 子动作逐项留痕 + PAT/用户可逆 |
