# 能力回流 B6：研究报告断点与「继续完成报告」

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B5（续期、精确恢复）、B10（续跑时搜索计数走同一包装）；`store.ts` / `orchestrator.ts` / `completions/route.ts` 都在本计划时最后一个改

## 目标

深度研究写报告时，每写完一章就保存断点。遇到超时、输出被截断、章节流传输失败等中途停止时：

1. 已完成的章节作为部分报告交付，被截断的那一章不混进去；
2. 消息上出现「继续完成报告」，点击后从断点开一个续写 run 接着写剩余章节，不重做检索；
3. 续写沿用原来的输入、写作要求和模型，不会换模型；
4. 章节流在模型还没输出任何内容前的传输失败自动重试有限次。

## 现状（已核实）

- 主仓编排器 `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`（2629 行，`runDeepResearchTurn` L671）：时间预算用尽时（约 L2312–L2323）在报告末尾加「以下章节未展开」，被截断章节的已生成内容仍写入；没有章节级错误类型、没有断点、没有章节重试。
- 没有 `lib/deep-research/report-checkpoint.ts`、没有 `app/api/chat/deep-research/continue` 与 `cancel` 路由、没有 `DeepResearchContinueCard`、`core-api` 无 `report_resume_available` 事件与 `continue_report` 控制消息。
- 可复用：`enterprise_deep_research_runs` 表、`enterprise_chat_artifacts` 表（断点存这里）、`resume/route.ts` 的计划门恢复、`DeepResearchRecoverBanner`、`deep-research-reconnect.ts`、B5 的续期与精确恢复、B10 的搜索计数包装。
- 来源（`$DELIVERY_REPO`，按顺序读）：`9054ba8c`（从持久断点恢复超时报告）、`03391de5`（门户只对有断点的报告提供续写）、`cdabd02d`（暴露续写动作）、`b36844fe`（续写 run 对账与 trace id）、`23380120`（截断保留已完成章节）、`1ea8d116`（章节传输重试）、`d6aea753`（恢复时保留原始输入与路由）。对应文件：`lib/deep-research/report-checkpoint.ts`（96 行）+ test、`app/api/chat/deep-research/continue/route.ts` + test、`cancel/route.ts`、`features/chat/src/components/molecules/DeepResearchContinueCard.tsx`（37 行）+ test、`lib/portal-continuation.ts`、`store.ts` 的 `attachReportContinuation`、`orchestrator.ts` 中 `DeepResearchSectionError`、`saveReportCheckpoint`、`continueFromReport`、`streamSectionInto` / `retryableSectionStreamError`、`finishTimedOutRun`。

- 实测证据（2026-10-20 B5 验收，本机 `glm-5.3-flash`）：两次深度研究完成后，报告正文都停在句中（「……第 2、3 章的版本与性能结论…# 分项分析 … 构成了选型的」「……花费」），run 状态却是已完成，界面没有任何「未写完」提示。说明当前被截断章节的半截内容直接混入报告，且被当作正常完成。
- B5 已提交（`b60286da`）可直接复用：`GET /api/auth/refresh?format=json` 与 `lib/session-keepalive.ts`；`gateway-auth-refresh.ts` 的 `hasGatewayBearerLifetime`；网关上游限流 `42902` 与租户额度 `42901` 区分及编排器对二者的停止处理；`lib/deep-research/auto-recover.ts`（刷新后自动接续实时流，续写 run 也会被它接上）；`runs?hydrate=1&runId=` 按 runId 精确取回。

## 改动

### 1. 契约（`core-api/src/chat.ts`）

- 研究事件加 `{ type: "report_resume_available"; runId: string; nextRunId: string; completedSections: number; totalSections: number }`。
- 用户消息加可选 `control?: "continue_report"`（只用于续写触发，不当普通提问展示）。

### 2. 断点（`lib/deep-research/report-checkpoint.ts`，新）

- 结构：`{ version, runId, nextRunId, topic, outline, completedSections: {title, markdown}[], citations, messages, writingRequirements, model, provider, createdAt }`（以交付仓字段为准，**去掉 `attachmentRoute`**）。
- `saveReportCheckpoint` / `loadReportCheckpoint`：gzip 后写入 `enterprise_chat_artifacts`，路径 `research/<runId>/report-checkpoint.gz`，MIME `application/vnd.agenticx.research-checkpoint+gzip`；只能由同一 tenant / user 读取。

### 3. 编排器（`orchestrator.ts`，摘函数移植）

- 每完成一章调用 `saveReportCheckpoint`。
- 新增 `DeepResearchSectionError(kind: "truncated" | "transport" | "timeout")`；章节流 `finish_reason` 为 `length` / `max_tokens` → `truncated`。
- 中途停止（时间预算用尽、截断、传输失败重试耗尽）：只交付已完成章节，报告末尾写「报告未写完，可以继续完成」，并发出 `report_resume_available` 事件；不再把半截章节写进报告。原「以下章节未展开」注释替换为此行为。
- 章节传输重试：只有在**尚未收到任何模型内容帧**、错误码为传输类（`50000` 未完成流 / 上游 5xx / 短 `Retry-After` 的 429）时重试，最多 2 次，且剩余时间足够；`42901` / `42902` 不重试。不引入交付仓的 `budget-ledger.ts`，用简单的次数与剩余时间判断。
- 新入口 `continueFromReport(checkpoint, deps)`：跳过检索与大纲，从第一个未完成章节继续写，写完合并成完整报告；原始 `messages`、`writingRequirements`、模型与服务商取自断点。

### 4. 接口

- 新 `app/api/chat/deep-research/continue/route.ts`（+ test）：`POST {runId}`；校验 run 属于当前用户、存在断点；以断点里的 `nextRunId` 作为幂等键建续写 run（已存在则直接返回它和 `traceId`）；能力授权沿用 `isPlatformFeatureAllowedForUser(..., "deep_research")`；续期沿用 B5 的做法；续写里的搜索（如有）走 B10 的计数包装；续写**不**扣深度研究次数。
- 新 `cancel/route.ts`：取消进行中的研究 run（若主仓已有等价取消入口，则只复用不新增，并在验收记录注明）。

### 5. 前端

- 新 `features/chat/src/components/molecules/DeepResearchContinueCard.tsx`（+ test）：显示「已完成 X / Y 章」与「继续完成报告」按钮；文案里的限制说明写「继续写作仍受使用上限与内容策略限制」。
- `store.ts`：`attachReportContinuation(sessionId, runId)`：调用 continue 接口 → 插入一条 `control: "continue_report"` 的用户消息（界面不显示为普通提问）与一条新的助手研究消息（带 `trace_id`）→ 按 B5 的精确恢复连到新 run。
- 新 `apps/web-portal/src/lib/portal-continuation.ts`：只对带 `report_resume_available` 事件的研究消息显示续写卡片。
- 发给模型的历史里不包含 `control` 消息（在 B3 的 `filterMessagesForCompletion` 里补一个条件）。

## 剥离

附件公网路由（`attachmentRoute`、`attachment_public_override`）、租户日调用配额预留、`budget-ledger.ts`、水印与文档生成分支。

## In scope / Out of scope

- In：断点、截断与中途停止的部分交付、章节传输重试、续写接口与 run、续写卡片与 store 接线。
- Out：研究阶段（检索 / 反思）的断点；编排器预算时长；交付仓 run 协调列与跨实例 CAS。

## 验收

- AC-1：`lib/deep-research/report-checkpoint.test.ts`：保存读取往返；他人读取失败；结构里无 `attachmentRoute`。
- AC-2：`orchestrator.test.ts` 新增：第 3 章截断 → 报告只含前 2 章并发出 `report_resume_available`；首帧前传输失败重试成功；已收到内容后失败不重试；42901 / 42902 不重试；`continueFromReport` 从第 3 章开始且不调用搜索。
- AC-3：`continue/route.test.ts`：无断点 409；重复调用返回同一 `nextRunId`；他人 run 404；不扣研究次数。
- AC-4：`features/chat`：`DeepResearchContinueCard.test.tsx`；`store.deep-research.test.ts` 新增续写流程；`portal-continuation.test.ts`。
- AC-5：`pnpm -C enterprise/features/chat test`（基线失败仅 `store.multi-session.test.ts › does not enqueue send on idle session B while session A streams`）；`pnpm -C enterprise/apps/web-portal test`（基线失败仅 `orchestrator.test.ts › refreshes gateway bearer before synthesize so section writes use the new token`）；`pnpm -C enterprise/apps/web-portal typecheck` 当前 26 条，按「文件 + 错误码」比对不得新增（行号下移不算）。
- AC-6（验收方手工）：把编排器总预算临时调到很短（`DEEP_RESEARCH_TOTAL_BUDGET_MS`）发起研究 → 交付部分报告并出现续写卡片 → 恢复正常预算后点击续写 → 报告补全且章节不重复、模型与原来一致。

## 验收记录

2026-10-20 验收：通过（Impl：grok 4.7；验收与问题修复：claude opus 5.5）。

- 自动化：features/chat 276/277、web-portal 1035/1036（修复后 deep-research 目录 380/381），失败均为基线条目；web-portal 类型检查 26 条无新增「文件 + 错误码」；core-api、sdk-ts 类型检查通过；网关 `go test ./...` 仅基线 `internal/mcphost` 失败，改动文件 gofmt 干净。
- 代码审查：续写接口按租户 + 用户取 run 与断点，断点解压限 4MB；取消接口校验归属。网关 `parseSSEStream` 无结束帧即报 `stream:incomplete` 来自计划所列交付仓提交 `1ea8d116`，属照搬；重启网关后普通对话实测正常完成（未被误判中断）。
- AC-6 手工：`DEEP_RESEARCH_TOTAL_BUDGET_MS=60000` 重启门户 → 研究交付「已完成 2 / 6 章」部分报告，末段为完整句子，末尾「报告未写完，可以继续完成」，卡片含「继续完成报告」与「继续写作仍受使用上限与内容策略限制」。第一次续写在短预算下运行：恢复 2 章、检索式 0 条、写完第 3 章后再次停住并出现「3 / 6」卡片。恢复默认预算重启门户后点击续写：恢复 3 章、检索式 0 条，写完剩余章节，run `completed / done`，模型保持 `glm-5.3-flash`。
- 验收中发现并修复：每章正文开头被模型重复写了同名标题（提示词已要求不重复，模型未遵守），B6 改为把「`## 标题` + 正文」整块写入报告后，完整报告里每章出现两个相邻的同名 H2。新增 `report-writer.ts` 的 `stripRepeatedSectionHeading`（2 条单测：去掉同名标题、保留不同名的小节标题），在 `commitSection` 落章前清洗。因重跑一次研究撰写阶段约耗数十万 token，修复未再做整轮实测，以单测为准。

遗留（记入主计划 §8）：已续写过的旧卡片刷新后仍显示按钮（再点幂等返回同一续写 run，不出错）；取消接口只改状态不中止正在执行的编排器；「继续完成报告」控制消息不落历史，刷新后该触发消息消失（研究消息仍在）。
