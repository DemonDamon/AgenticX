# 能力回流 B5：深度研究刷新恢复、显式续期与限流区分

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B3、B4（`store.ts` 归属顺序 B3 → B4 → B5）、B7（`orchestrator.ts` 归属顺序 B7 → B5）、B0（网关 `adaptor` 测试可编译）

## 目标

1. 研究进行中刷新页面，按**这一次研究的 runId** 恢复，阶段进度不重复出现；状态未知时显示「进行中」，不误显示「已完成」。
2. 轮询活跃研究时只拉轻量摘要，不拉整段事件和报告正文。
3. 长时间研究开始和恢复前，确认登录凭证能撑过整个预算时长，不够就先续期；门户提供显式续期接口，浏览器在焦点回来和定时检查时续期。
4. 上游模型限流（429）与本租户额度用完分开报错：前者提示「模型服务繁忙」，后者提示「额度已用尽」。

## 现状（已核实）

- `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts`：L152 `store.listActive(...)` 返回完整记录（含 `events`、报告正文）；L153 `healFinishedActiveRuns`（L109，GET 时把已有报告的 running 标为 completed，**本计划保留不动**）；L156–L157 `hydrate=1` 只取 `getLatestBySession`，忽略 `runId`。
- `enterprise/features/chat/src/utils/deep-research-hydrate.ts` L20–L23 `normalizeStatus`：非 running / awaiting_clarify 的未知状态一律当 `completed`。
- `features/chat/src/utils/deep-research-reconnect.ts`：`consumeDeepResearchReconnectStream` L13、`startDeepResearchReconnect` L95（门户 `MachiChatView.tsx` 约 L305 调用）；重连流会重放已保存事件，没有去重。
- `lib/deep-research/run-store.ts`（844 行）无 `listActiveSummaries`。
- 续期：`lib/deep-research/gateway-auth-refresh.ts` 有 `refreshGatewayBearer`，无凭证剩余时长检查；`app/api/chat/deep-research/resume/route.ts` L9 已 import `refreshTokens`（`lib/auth-runtime`），L632 / L750 在计划门恢复里续期；门户 `app/api/auth/` 只有 `change-password login logout register session sso`，**没有** `refresh`。基线失败第 5 条（orchestrator「refreshes gateway bearer before synthesize」）与此相关，修好算附带收益，不强求。
- 网关：`internal/openai/errors.go` L43 `QuotaExceeded` → `42901`；`internal/adaptor/errors_map.go` L14、L16 把上游过载 / 429 也映射为 `QuotaExceeded`（42901）。
- 来源（`$DELIVERY_REPO`）：`e7d4a0e0`（轻量摘要）、`732b7472`（精确 runId 恢复与重放去重）、`1cd25587`（门户 `/api/auth/refresh` 与 `lib/session-keepalive.ts`）、`22f4174b` / `85468741`（研究开始 / 继续前续期，`hasGatewayBearerLifetime`）、`b6dcdbf4` / `d4d84588`（`42902` 与编排器两类错误）。

## 改动

### 1. 轻量摘要

- `run-store.ts` 接口加 `listActiveSummaries(tenantId, userId, sessionId?)`：只选 `run_id, session_id, status, phase, topic, trace_id, created_at, updated_at`（以表实际列为准），内存实现同语义。
- `runs/route.ts`：活跃列表改用 `listActiveSummaries`；`healFinishedActiveRuns` 的入参需要的字段若摘要里没有，就对「摘要里状态为 running 的少量 run」单独 `get` 完整记录后再走原 heal 逻辑（保持原行为）。

### 2. 按 runId 精确恢复

- `runs/route.ts`：`hydrate=1&runId=<id>` 时按 `runId` 取（校验属于当前 tenant / user / session），否则沿用 `getLatestBySession`。
- `deep-research-hydrate.ts` `normalizeStatus`：未知状态返回 `running`（只有明确的 `completed` / `failed` / `cancelled` 才是终态）。
- 重放去重：在 `deep-research-reconnect.ts`（或 store 中应用事件的位置，以主仓实际结构为准）照搬交付仓的计数去重：以 `type + ":" + ts`（无 ts 时用 `JSON.stringify(event)`）为 key，统计已保存事件里每个 key 的次数，重连流里同 key 事件先抵扣已保存次数再应用；真正新增的重复阶段仍会显示。
- 前端调用 hydrate 时带上当前消息记录的 `runId`。

### 3. 续期

- 新接口 `src/app/api/auth/refresh/route.ts`（+ test，照搬并适配主仓 `auth-runtime`、cookie 写法）：用 refresh cookie 换新令牌并写回 cookie；`?format=json` 时返回 `{tenantId, userId, expiresAt}`；refresh 失效返回 401。
- 新文件 `src/lib/session-keepalive.ts`（+ test）：页面可见且距离过期不足 10 分钟时调用续期；窗口重新获得焦点时检查；返回的 tenant / user 与当前不一致时不覆盖本地状态并提示重新登录。在 `WorkspaceShell.tsx` 挂载一次。
- `gateway-auth-refresh.ts` 新增 `hasGatewayBearerLifetime(token, requiredMs)`（解析 JWT `exp`，不验签）。
- `completions/route.ts` 深度研究车道开始前、`resume/route.ts` 恢复前：所需时长 = 编排器总预算 + 澄清等待 + 计划门等待 + 5 分钟；不足则 `refreshTokens` → 写回 cookie → `refreshGatewayBearer` 同步更新转发头。不改编排器默认预算时长。

### 4. 限流与额度分开

- `internal/openai/errors.go`：新增 `UpstreamRateLimited(message)` → `Code "42902"`，HTTP 状态 429，文案「模型服务繁忙，请稍后再试」。
- `internal/adaptor/errors_map.go` L14、L16：上游过载 / 429 改用 `UpstreamRateLimited`；本租户额度用完（`server.go` L1070、L1520）保持 `42901`。
- 网关流式错误格式化里加 `42902` 的人话映射。
- 门户 `orchestrator.ts`：新增 `DeepResearchUpstreamRateLimitError`（42902）与 `DeepResearchGatewayQuotaError`（42901），研究在遇到时停止并给出对应提示；只改错误识别与提示，不改研究流程。普通对话的错误提示若按错误码区分，同步加 `42902`。

## In scope / Out of scope

- In：轻量摘要、精确恢复与去重、未知状态归为进行中、显式续期接口与保活、研究开始 / 恢复前续期、42902。
- Out：报告断点与「继续完成报告」（B6）；GET 时 heal 逻辑；编排器预算时长；run 协调列（`revision` 等）。

## 验收

- AC-1：`app/api/chat/deep-research/runs/route.test.ts`：活跃列表不含 `events` / 报告正文；`hydrate=1&runId=` 返回指定 run，跨用户 runId 返回空 / 404。
- AC-2：`features/chat`：`deep-research-hydrate.test.ts` 未知状态 → running；重连去重用例（已保存 3 个阶段事件 + 重放同样 3 个 + 1 个新的 → 只新增 1 个）。
- AC-3：`app/api/auth/refresh/__tests__/route.test.ts`、`lib/session-keepalive.test.ts`、`lib/deep-research/gateway-auth-refresh.test.ts`（剩余时长判断）。
- AC-4：网关 `go test ./internal/openai/... ./internal/adaptor/... ./internal/server/...`：上游 429 → 42902；本租户超额 → 42901。
- AC-5：`orchestrator.test.ts` 新增：42902 / 42901 两类错误的停止与提示文本。
- AC-6：`pnpm -C enterprise/features/chat test`；`pnpm -C enterprise/apps/web-portal typecheck && test`（除基线 10 条外无新增失败，第 5 条若转绿记录下来）；`go test ./...` 不新增失败包。
- AC-7（验收方手工）：发起深度研究，进行到检索阶段时刷新 → 恢复到同一次研究且阶段不重复；浏览器网络面板里轮询接口不再返回整段事件；把登录有效期调短（`.env.local` 的访问令牌时长）后发起研究，研究不因凭证过期中断。

## 验收记录

2026-10-20 验收：通过（Impl：grok 4.7；验收与卡点修复：claude opus 5.5）。

- 自动化：`go test ./...`（干净环境）仅基线 `internal/mcphost` 失败；改动 Go 文件 gofmt 干净。web-portal 类型检查 26 条，与基线「文件 + 错误码」一致（仅 `store.ts` L1356、`run-store.test.ts` 行号下移）。features/chat 272/273、web-portal 1016/1017，失败项均为基线条目。
- 续期接口：浏览器内 `GET /api/auth/refresh?format=json` 返回 200 与 `{tenantId, userId, expiresAt}`（约 1 小时后），非 json 格式 401。服务端按会话 ID 校验 refresh，无一次性使用检测，多标签并发续期不会互踢。
- 轮询瘦身：活跃列表只返回 `runId / sessionId / status / phase / topic / updatedAt`，无事件与报告正文。
- 按 runId 恢复：`hydrate=1&runId=` 返回该次研究 61 条事件；跨用户 runId 由租户 + 用户 + 会话三重过滤。

验收中发现并修复的卡点：刷新后工作台被 hydrate 恢复进消息列表，「继续查看」横条判定为可见而隐藏，没有任何路径重新接实时流，页面停在刷新那一刻直到研究结束。新增 `apps/web-portal/src/lib/deep-research/auto-recover.ts`（`takeDeepResearchRunsToRecover`，3 条单测），`MachiChatView` 在会话内发现 running 且未在流式中的研究时自动调用 `handleDeepResearchRecover`，每个会话视图每个 runId 只触发一次；原始流在播时见到的 run 记为已处理，避免正常结束时重放。修复后实测：在计划阶段刷新（刷新前 0 条车道），刷新后 4 条车道、采用数、缺口补检与「已撰写第 N/3 节」持续推进至完成，车道与章节无重复。

AC-7 偏差：主仓访问令牌时长写死在 `auth-runtime.ts`（1 小时），无 `.env.local` 开关，「调短有效期后研究不中断」改以 AC-3 单测覆盖，未做手工。

遗留（记入主计划 §8）：报告正文两次在句中截断（属 B6 范围）；车道标题直接带出用户的「交付偏好」指令原文；本机外部搜索源偶发 `fetch failed` 后降级（环境问题）。
