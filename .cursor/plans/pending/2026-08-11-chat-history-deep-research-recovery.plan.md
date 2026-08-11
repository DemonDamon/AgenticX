# 对话历史与深度调研增量持久化及恢复

Planned-with: gpt5.6-luna-max
Suggested-Impl-Model: gpt5.6-luna-max
Status: pending-review
Plan-Id: 2026-08-11-chat-history-deep-research-recovery

## 目标

修复 Enterprise 前台聊天历史与深度调研在「流式中刷新、浏览器断开、门户进程重启、澄清卡片提交后立即离开、鉴权失效后重新登录、同一会话下一轮继续发送」这些边界下的持久化与恢复缺口。

本计划不是把现有实现推倒重来。当前代码已经有聊天 append outbox、深度调研 run-store、首轮消息壳和部分检查点；本计划要补齐的是：

1. 深度调研真正开始前，用户消息和助手工作台壳必须先进入可恢复的本地 outbox，不能只 void 发起一次异步落库。
2. 深度调研 run 必须和实际的 user/assistant message ID 建立稳定关联，刷新和重连不能依赖「最后一条消息」或 topic 猜测。
3. 切换会话、刷新、补同步时，旧的远端快照不能覆盖当前会话仍在发送或尚未同步的本地消息。
4. 澄清答案必须进入长期可恢复状态；临时 waiter 文件只能负责跨 isolate 唤醒，不能作为答案的唯一存储。
5. 深度调研恢复时若聊天气泡尚未出现，必须创建可关联的消息壳并接收重连事件；不能出现「没有匹配气泡所以所有回放回调都直接 return」。
6. 生产环境不能在数据库配置错误时静默退化为进程内 memory run-store，否则页面看起来支持恢复，进程重启后却必然丢 run。
7. 鉴权失效不能把“已经完成、已经有 run-store/artifact 的结果”与“前端最后一次历史 append 失败”混为一谈；重新登录同一账号后必须能找回同一 session/run。

### 本次检查结论

“深度调研只有最后文件落盘才存储”这个说法不完全准确：

- enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:755-823 的 writer 默认每 1.5 秒批量写事件和报告片段，终态还会执行一次 flush。
- enterprise/features/chat/src/store.ts:1830-1845 会在明确深度调研开始时尝试提前写 user+assistant 壳，1933-1948 会按结构化事件做约 8 秒检查点，1965-1978 在 finally 再写一次。
- 但是首轮壳写入是 fire-and-forget，检查点只覆盖部分事件，聊天消息和 run-store 的关联不稳定；所以在早期断流、刷新、页面退出或恢复目标不存在时，确实仍可能表现为整轮对话消失或只剩不完整工作台。

澄清卡片当前也不是完整持久化：

- DeepResearchClarifyCard 的交互选择在 enterprise/features/chat/src/components/molecules/DeepResearchClarifyCard.tsx:97-99 只存在 React state。
- enterprise/features/chat/src/store.ts:2688-2706 的 setDeepResearchClarifyAnswers 只更新内存中的助手消息。
- enterprise/apps/web-portal/src/lib/deep-research/run-wait.ts:127-220 的 .runtime/deep-research-clarify/<runId>.json 是短期进程/隔离 handoff 文件，会在 settle 后清理，不是长期 run 状态。
- outbox DTO 虽然已经包含 clarifyAnswers，但只有后续检查点或 finally 恰好执行时才会带上；run-store 本身没有答案字段，刷新后控件也不会用已保存答案初始化。

同一 session 中 A 成功、B 失败、C 上下文丢失目前没有证据证明是每次必现，但存在明确竞态：refetchSessionMessages 和 switchSession 会用远端快照替换会话消息；它们没有把“正在 append 但尚未进入 IndexedDB、或 append 请求尚未结束”的本地消息纳入合并。B 的失败分支又不会把普通聊天的失败助手回复按 clean end 持久化，因此一旦发生补拉或切换，当前内存状态可能回退到 A 之前的远端快照。该计划必须增加可执行的 A/B/C 回归测试，锁定 A 的已完成上下文不会被失败轮次抹掉。

用户补充的“深度调研结果已经出来，但提示登录状态失效，重新登录后结果全没了”也符合这条证据链：

- enterprise/features/chat/src/store.ts:592-605 在历史 API 收到 401 时会安排跳转到 /auth；如果最终 append 尚未进入 outbox，页面卸载会丢失仅存在内存的 assistant 内容。
- enterprise/apps/web-portal/src/components/WorkspaceShell.tsx:243-293 在重新登录后才按 tenantId/userId 启动 outbox coordinator；已有 IndexedDB 操作理论上可恢复，但当前 hydrate 没有把 run 的真实 message link 和完成态报告稳定接回来。
- enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts:88-105,144-157 的 hydrate payload 只返回事件和 artifact ID，不返回 user/assistant link；重新登录后无法可靠定位原气泡。
- server 侧 getSessionAuthFromCookies 会在 refresh token 仍有效时尝试刷新，但 refresh token 失效或最后一次历史请求 401 时，前端必须仍然保留已持久化的 run/outbox，不能把登录跳转当成删除结果。

## 现有实现与证据链

### 已有保护

| 链路 | 当前实现 | 仍然不足 |
| --- | --- | --- |
| 聊天历史 append | enterprise/features/chat/src/history-outbox.ts:194-257,451-554 保存最小 DTO、按 session 串行 flush、带 operation/hash 幂等信息 | 只覆盖已经调用到 append 的消息；内存中的 in-flight append 没有参与 hydrate 合并 |
| 聊天 append 串行 | enterprise/features/chat/src/store.ts:724-740 使用 historyAppendChainsBySessionId | refetchSessionMessages 不检查该 chain，旧 GET 可以覆盖本地新消息 |
| 深度调研壳 | enterprise/features/chat/src/store.ts:1752-1845 先插入 UI user+assistant，再尝试写历史 | 首次写入不是 durable-first，也不等待 outbox 入队完成 |
| 深度调研 run | enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:755-823 1.5 秒批量写事件/报告 | run row 没有关联真实消息 ID；没有澄清答案字段 |
| 刷新 hydrate | enterprise/features/chat/src/utils/deep-research-hydrate.ts:329-453 可按 run 事件补出 user/assistant 壳 | 主要依赖 topic/最后一条消息；合成 ID 是 dr-user-*/dr-assistant-*，不是可送入历史 outbox 的 ULID |
| 重连 | enterprise/apps/web-portal/src/components/MachiChatView.tsx:203-340 找到同 run assistant 后回放事件/增量 | 找不到气泡时 targetId 为空，所有回调直接 return；回放更新也没有统一走历史持久化 |
| 澄清 handoff | enterprise/apps/web-portal/src/lib/deep-research/run-wait.ts:127-220 支持 live waiter 与磁盘握手 | 磁盘文件不是长期状态，重启后不能仅依靠它恢复答案 |
| 鉴权刷新 | enterprise/apps/web-portal/src/lib/session.ts:84-121 可在 access token 过期但 refresh token 有效时刷新 | refresh 失败后历史 append 的本地消息、run 和 re-login 恢复没有一条端到端验收链 |

### 关键缺口的最短复现模型

~~~mermaid
sequenceDiagram
  participant UI as 浏览器 store
  participant Outbox as IndexedDB append outbox
  participant Hist as 聊天历史 API
  participant Run as deep-research run-store
  participant DB as PG/MySQL

  UI->>UI: 插入 user + assistant 壳
  UI-->>Hist: void persistAppendMessages()
  Note over UI,Hist: 页面刷新/关闭可能发生在 enqueue 前
  UI->>Run: run 继续，writer 每 1.5s 写事件/报告
  UI->>UI: refetch/switch 拉远端旧消息
  UI->>UI: 直接替换当前 session 消息
  Note over UI: local shell / in-flight append 被旧快照覆盖
  UI->>UI: 恢复时按 topic 猜测目标或没有 targetId
  UI-->>UI: 工作台/回答看似消失，澄清答案也未恢复
~~~

## In scope

- Enterprise features/chat 的 append 持久化屏障、检查点、hydrate 合并和同 session 上下文回归。
- Enterprise web-portal 深度调研 run 与聊天消息的 ID 关联、鉴权失效后的恢复、重连和澄清答案持久化。
- PG/MySQL 的 enterprise_deep_research_runs 关联字段迁移与 schema parity。
- 生产环境 deep-research run-store 的持久化配置门禁与可观测失败态。
- 对应单元测试、路由测试和跨层回归测试。

## Out of scope

- Gateway、外站抓取、搜索超时、模型供应商路由和 SSE“断开后后台是否继续跑”语义。当前 transport abort 与 run abort 的分离是既定行为，本计划不改。
- replace_all 离线重放、历史 revision/CAS、编辑/重生成的 durable outbox。现有 durable append 计划已明确将其列为 P1，本计划不绕过该边界。
- Desktop、admin-console、移动端和后台策略/配额。
- 深度调研报告内容质量、引用排序、文档导出和 artifact 业务语义。
- 当前工作树已有的 deep-research auto 模式/UI 未提交修改。本计划只定义其与持久化边界的接线要求，不把这些现有修改混入本次 plan commit。

## No-scope-creep 约束

1. 只能增强 append/checkpoint/recovery，不能把 replace_all 改成可盲重放任务。
2. 不能用 localStorage 保存完整 ChatMessage[]；继续使用最小化 IndexedDB DTO。
3. 不能用 topic、最后一条消息或全局 active session 作为新 run 的唯一关联键。
4. 不能把网络暂时失败直接变成聊天 status=error；回答已完成时仍保持原有聊天状态，只展示 session 级同步状态。
5. 不得为了修复 A/B/C 顺手改模型请求内容、网关错误文案或失败普通轮次的产品语义；先用回归测试锁定当前语义。
6. 运行时 memory store 只允许在明确的测试/本地降级开关下使用，不能以 catch 后静默 fallback 的方式隐藏生产数据库故障。
7. 不把完整报告正文塞进每次 hydrate 响应；恢复协议必须有明确的大小上限或增量游标。
8. 登录失效处理只能保留/恢复本账号的 outbox、session 和 run；不能为了“找回结果”放宽 tenant/user 鉴权。

## FR-1：建立深度调研 run 与聊天消息的稳定关联

### 根因

当前 enterprise/apps/web-portal/src/app/api/chat/completions/route.ts:181-195 只把 runId、tenant、user、session、trace 传给 runDeepResearchTurn。enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:233-270 的 DeepResearchDeps 没有 user/assistant message ID，RunRecord 也没有这两个字段。因此 hydrate 只能在聊天历史中按 topic/最后消息猜测归属。

### 修改落点

1. enterprise/packages/sdk-ts/src/types.ts:24-37
   - 在 ChatRequest 增加可选 userMessageId?: string、assistantMessageId?: string。
   - 这是 portal 到 BFF 的内部关联字段，不是发给模型供应商的业务消息字段。

2. enterprise/features/chat/src/store.ts:326-358,1752-1859
   - toSdkRequest 接收本轮 userMessage.id 和 assistantMessage.id。
   - 构建 request 时传入稳定 ID。
   - 对显式深度调研和 auto 模式保持当前 UI 行为；不要把 UI 占位消息 ID 重新生成。

3. enterprise/packages/sdk-ts/src/chat/http.ts:142-152
   - body 增加内部字段，例如 agenticx_user_message_id、agenticx_assistant_message_id。
   - toGatewayMessage 只映射真正的 messages，内部字段不能进入 Gateway 的上游 body。

4. enterprise/apps/web-portal/src/app/api/chat/completions/route.ts:98-155,181-195
   - 解析并从转发 body 移除两个内部字段。
   - 用 ULID 校验函数拒绝空值/非法值；无效值按 400 返回，不能静默生成另一个 ID。
   - 传入 runDeepResearchTurn 的 deps。

5. enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:233-270,649-689,750-761
   - DeepResearchDeps 增加 userMessageId、assistantMessageId。
   - runStore.create 时一并写入。
   - continue/orphan 旧调用允许字段为空，不能影响老 run 继续执行。

6. enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:39-107,133-166,221-407
   - RunRecord、RunStore.create、memory/sql mapRow/create 统一增加两个 nullable 关联字段。
   - get、listActive 和 getLatestBySession 返回完整字段。

7. 数据库 schema：
   - enterprise/packages/db-schema/src/schema/deep-research-runs.ts:4-41
   - enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts:14-54
   - 增加 userMessageId/assistantMessageId 对应的 nullable varchar(26)。
   - 现有旧 run 允许为空；新 run 必须有值。

8. 迁移：
   - PG 新建 enterprise/packages/db-schema/drizzle/0046_deep_research_run_message_links.sql。
   - MySQL 新建 enterprise/packages/db-schema/drizzle-mysql/0020_deep_research_run_message_links.sql。
   - 两边都使用 nullable 字段，禁止重建或清空已有 run。
   - 更新两套 migration journal 和 schema parity 断言；当前 PG journal 最新为 0045，MySQL 最新为 0019。

### Before / After 意图

~~~ts
// Before：run 只能按 session/topic 猜消息归属
await runStore.create({ runId, tenantId, userId, sessionId, topic, traceId });

// After：run 与本轮实际消息形成稳定关联
await runStore.create({
  runId,
  tenantId,
  userId,
  sessionId,
  topic,
  traceId,
  userMessageId,
  assistantMessageId,
});
~~~

### 验收标准

- 新建深度调研后，数据库 run row 能查到真实 user/assistant ULID。
- GET /api/chat/deep-research/runs?sessionId=...&hydrate=1 返回两个关联 ID。
- 旧 run 无关联 ID 时仍能展示，但只能走兼容 fallback，不得把兼容合成消息当作新的可同步消息。
- PG/MySQL schema parity test 同时覆盖字段名、可空性和类型。

## FR-2：深度调研首写必须先进入可恢复 outbox

### 根因

enterprise/features/chat/src/store.ts:1827-1832 当前对深度调研 shell 调用：

~~~ts
void persistAppendMessages(set, sessionId, [userMessage, assistantMessage]);
~~~

而 persistAppendMessages 在 724-740 先尝试远端 append，失败后才 enqueue。此时页面可能已经刷新/关闭，导致“还没入 IndexedDB，网络也没成功”的窗口。

### 修改落点

1. enterprise/features/chat/src/store.ts:724-788
   - 为 append 增加明确选项：

~~~ts
type PersistAppendOptions = {
  durableFirst?: boolean;
  reason?: "deep_research_shell" | "deep_research_checkpoint" | "normal_turn";
};
~~~

   - durableFirst=true 时先计算 operation/hash 并 enqueueAppend，确认 IndexedDB 已写入后再触发 flushHistoryOutbox；不能先等待远端 5 次重试。
   - 入队成功后 flush 仍然 fire-and-forget，不阻塞长研究；入队失败要更新当前 session 的 dead-letter/降级状态。
   - 保持现有 normal append 的短远端路径，避免扩大普通聊天行为变化。

2. enterprise/features/chat/src/store.ts:1752-1860
   - 显式 deep-research：在 client.sendMessage() 前 await durable-first shell，等待的是本地 outbox 写入而不是远端网络。
   - deepResearchAuto：不要在还没确认 auto 判定前无条件落一个空 assistant。先 durable-first 保存 user；收到首个明确的 deep-research run_started/profile 事件后，再用已知 assistant ID 追加 shell并建立 run link；若该轮实际是普通聊天，继续沿用 clean-end 的 user+assistant append。
   - 如果当前 auto 模式改动选择了另一种边界，必须在测试中明确“普通回落不能留下空 assistant”。

3. enterprise/features/chat/src/history-outbox.ts:194-257
   - 保持最小 DTO 和有效 ULID 校验。
   - 为 durable-first 增加可观察 reason 或本地计数，但不得把完整附件 data URL、reasoning 或工具预览写入 outbox。

4. enterprise/features/chat/src/store.deep-research.test.ts
   - 将现有“shell before stream ends”测试改成验证：客户端尚未返回 request/事件前，outbox 已有对应 user+assistant ID；不是只验证某个异步 mock 最终被调用。

### 验收标准

- 浏览器在 deep-research request 发送前退出，重新加载同一 principal 后，历史 hydrate 能从 outbox 投影出 user+assistant 壳。
- 远端历史 API 断网不影响 shell 进入 IndexedDB；网络恢复后 append 幂等成功，不能重复插入。
- auto 模式实际回落普通聊天时，历史中不能出现无内容的 assistant 壳。
- 本地 outbox quota/序列化失败时，UI 有 session 级可读状态，日志带 session/run/message 关联，不得静默丢失。

## FR-3：增量检查点覆盖聊天内容、错误和澄清边界

### 根因

enterprise/features/chat/src/store.ts:1834-1845 的检查点只按约 8 秒节流；1933-1948 只有 deepResearchEvent 才会调用。普通 chunk.delta 在 1887-1911 更新了助手内容，却不会触发检查点。setDeepResearchClarifyAnswers 只在 2688-2706 改内存。

### 修改落点

1. enterprise/features/chat/src/store.ts:1834-1846
   - 将检查点函数改为“按 user/assistant/run 关联的 session 单飞”：
     - 事件、delta、澄清提交、取消、错误和 done 都可请求 checkpoint；
     - 仍保持最短间隔，推荐 8 秒；
     - 同一时间已有 append chain 时合并到下一次 snapshot，不并发发送同一 session 的 append。
   - 快照必须从当前 store 取 user 与 assistant，不能捕获旧对象引用。

2. enterprise/features/chat/src/store.ts:1887-1948
   - chunk.delta 累积到当前助手后调用非 force checkpoint。
   - chunk.error 在写入可读错误状态后触发 force checkpoint；保持普通聊天失败轮次是否进入最终历史的既有语义，不把这条错误文案误当作成功回复。
   - deepResearchEvent 保留现有强制事件集合，并将 run_started、clarify、research_profile、research_plan、phase=done 覆盖到持久化检查点。

3. enterprise/features/chat/src/store.ts:1965-1980
   - finally 先 force checkpoint，再执行最终 append；无论 stream clean、transport error、browser abort 还是服务器返回错误，都不得因为清理 checkpoint map 而跳过最后一次可持久化快照。
   - 将 persist 错误交给 session 级 sync 状态，不改变 run 是否继续执行。

4. enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:755-823
   - 保持 writer 的 1.5 秒批量策略，但提供可等待的 flush() 屏障。
   - orchestrator.ts:787-816 创建 run 后发送首个 run_started 时必须在进入长耗时检索前完成一次 flush；报告片段和事件仍可批量写。
   - writer 的 flush chain 继续串行，不能让多个 report append 互相覆盖。

### 验收标准

- 发送 run_started 后立即刷新，run-store 至少有 run row、关联 message IDs 和首个关键事件。
- 在两个 report delta 之间模拟进程/浏览器断开，重新读取 run-store 能看到最近一次已完成 flush 的部分内容，不要求未到 flush 间隔的最后几个 token。
- 澄清提交、阶段切换、失败和完成各至少有一次可检查点；重复回放不能把内容拼接两遍。
- 同一 assistant 的 checkpoint append 始终按 session chain 串行，任何一个旧请求晚返回都不能覆盖新 snapshot。

## FR-4：hydrate/refetch/switch 不得用旧快照覆盖本地新消息

### 根因

enterprise/features/chat/src/store.ts:958-985 的 refetchSessionMessages 在取得远端消息和 overlay 后直接构造：

~~~ts
messages: [...others, ...merged]
~~~

1432-1492 的 switchSession 也只在 targetIsStreaming 时跳过 fetch，不检查 append chain、pending outbox 或本地 unsynced message。GET 可能早于 append 落库返回旧快照，随后整个 session 被替换。

### 修改落点

1. enterprise/features/chat/src/store.ts:682-706 附近新增纯合并辅助函数，例如：

~~~ts
function mergeHydratedSessionMessages(
  remote: ChatMessage[],
  overlay: ChatMessage[],
  local: ChatMessage[],
  preserveLocal: boolean,
): ChatMessage[] {
  // remote + overlay 是基础；
  // preserveLocal 时保留当前 session 中 remote/overlay 尚不存在的本地 append；
  // 同 id 的本地 streaming/checkpoint snapshot 优先；
  // 最终仍按 created_at + id 排序。
}
~~~

   - 只对 append/in-flight/streaming 场景保留本地孤儿 ID；没有未同步状态时远端仍是权威，避免破坏删除/replace 语义。
   - preserveLocal 的判定必须至少包含：isSessionStreaming、historyAppendChainsBySessionId.has(sessionId)、该 session 有 pending/paused/dead-letter outbox。
   - 同 ID 的内容合并不能按数组位置；必须按稳定 message ID。

2. enterprise/features/chat/src/store.ts:958-985
   - 请求开始前记录 session 本地 snapshot；异步 GET 返回后重新从 get() 读取当前 session，使用 helper 合并。
   - 当 append chain 仍在运行时，不能把新本地消息删掉；chain 完成后再触发一次受影响 session 的权威 refetch。
   - responseVersionsByUserMessageId 也必须从最终合并结果重建，不能只换 messages。

3. enterprise/features/chat/src/store.ts:1432-1492
   - targetIsStreaming 扩展为 targetHasUnsyncedAppend。
   - 切换到有未同步消息的 session 时立即显示当前内存 snapshot；不要等待旧 GET 清空画面。
   - append flush 完成后按 session reconciliation，不得用全局 activeSessionId 决定哪个 session 被刷新。

4. enterprise/features/chat/src/store.ts:1748-1860
   - 构造本轮 request 时只使用当前 session 的稳定 snapshot。
   - 不能因另一个 session 的 stream/error/flush 改变当前 session 的历史数组。

### A/B/C 验收场景

在 enterprise/features/chat/src/store.multi-session.test.ts 或新建 enterprise/features/chat/src/store.history-persistence-recovery.test.ts：

1. A 首轮成功，确认 A 的 user 和 assistant 已进入远端或 outbox。
2. B 开始后让 client stream 返回 error，保留现有 B 失败轮次 UI 语义。
3. 在 B 错误处理和 A append/GET 交错期间触发 refetchSessionMessages("A") 或切换 A/B。
4. C 在同一 session 继续发送，捕获发送给 client 的 messages。
5. 断言：
   - C 的请求仍包含 A 的 user 内容和 A 的完整 assistant 内容；
   - 旧 GET 返回后 A 不会从 store 消失；
   - 不因为 B 的失败把 A 的 response version、sources 或 deep-research metadata 清掉；
   - 不新增第二份 A 消息；
   - 其他 session 的 stream 状态不影响 A。

## FR-5：澄清答案进入 run-store 与聊天 checkpoint，并在卡片恢复时回显

### 修改落点

1. enterprise/packages/db-schema/src/schema/deep-research-runs.ts、mysql-schema/deep-research-runs.ts
   - 在 FR-1 的迁移中增加 nullable clarifyAnswers JSON/JSONB 字段；旧 run 为空表示尚未保存答案。
   - 不把答案写入 topic 或 events 文本，避免重复和无法更新。

2. enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:57-107,133-166,221-407
   - RunStore 增加：

~~~ts
setClarifyAnswers(
  runId: string,
  answers: Record<string, string>,
): Promise<void>;
~~~

   - memory/PG/MySQL 实现都要做 JSON 深拷贝/类型校验，避免调用方后续修改对象影响 store。
   - get、getLatestBySession、hydrate payload 返回答案。

3. enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts:131-154,374-399
   - 在 resolveClarifyResume 前先校验 run 所属 tenant/user，并把规范化后的 answers 写入 run-store。
   - live waiter、peer handoff、orphan continue 都复用同一个已落库答案；重复提交同一 run 时幂等，不能因为 waiter 已不存在就丢答案。
   - 临时 .runtime 文件仍可用于唤醒，但不再承担长期恢复职责。

4. enterprise/features/chat/src/store.ts:2688-2706
   - setDeepResearchClarifyAnswers 更新内存后，立即从当前 session 找到对应 user/assistant，调用 durable-first checkpoint。
   - 只在 assistant deep_research.runId 是真实 run ID 时做 run-store API 更新；pending 壳只先存 chat metadata。

5. enterprise/features/chat/src/components/molecules/DeepResearchClarifyCard.tsx:92-127
   - clarifyAnswers 变化时初始化/修正 answers 与 custom，以 runId + questionId 为 key。
   - 不要在每次父组件重渲染时覆盖用户刚输入但尚未提交的内容；仅在 runId 变化、首次加载或服务器答案版本前进时同步。
   - 已提交答案在刷新后应显示为已选/已收集，而不是重新显示空表单。

### 验收标准

- 用户选择答案后立刻关闭/刷新，重新进入同一 session，卡片显示已保存答案。
- 网络断开时 resume 请求失败，不能把本地答案标成已生效；重试可再次提交同一答案。
- resume 请求重复到达、live waiter 消失或跨 isolate handoff 时，run-store 中仍只有最后一个一致答案状态。
- run-store 与 chat assistant metadata 的答案不一致时，hydrate 以有版本/更新时间的持久化状态为准，并在日志中记录冲突，不静默覆盖用户新答案。

## FR-6：恢复和重连必须按 message ID 工作

### 修改落点

1. enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts:88-105,155-173
   - toHydratePayload 返回 userMessageId、assistantMessageId、clarifyAnswers 和必要的 reportCheckpoint 元信息。
   - 不直接返回无限增长的 reportMarkdown；如 UI 需要预览，使用明确的最大字符数并返回 reportTruncated/reportLength。

2. enterprise/features/chat/src/utils/deep-research-hydrate.ts:329-453
   - 优先用 run-store 的两个真实 ID 找到/更新消息。
   - 新 run 找不到消息时，只为新 run 创建使用真实 ULID 的 user/assistant 壳，并将其标记为 recovered，之后走正常 append outbox；旧 run 无 IDs 才保留兼容的 UI-only fallback。
   - 删除以 topic 匹配或“最后一条 assistant”作为新路径的主关联逻辑；它只能作为旧数据兼容并且必须有明确日志。
   - hydrate 合并必须幂等：同一 run 重复 hydrate 不创建第二对消息。

3. enterprise/apps/web-portal/src/components/MachiChatView.tsx:203-340
   - handleDeepResearchRecover 找不到 target 时，先按 hydrate payload 的真实 assistant ID materialize shell，再启动 startDeepResearchReconnect。
   - onEvent、onDelta、onDone 不得因 targetId 初始为空而全部 return；target 创建完成后回放到同一 ID。
   - 重连中的事件/内容更新复用 store 的 checkpoint action，按 8 秒节流并在 done/error 强制保存；不能只有 setState。

4. enterprise/features/chat/src/utils/deep-research-reconnect.ts 与 enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/[runId]/stream/route.ts
   - 保留同一 runId 单飞和既有“浏览器断开后服务端继续跑”语义。
   - 为报告回放定义 cursor/offset 或 bounded replay 规则：重连不能把已经存在的 assistant content 再拼一遍。
   - 如果当前协议仍只回放末尾 3000 字符，必须在 payload/日志中明确该边界，并保证最终 artifact 与最终 chat checkpoint 可用。

### 验收标准

- 刷新后 run 仍在执行：点击继续查看，事件和后续 delta 会进入真实 assistant 气泡。
- 刷新后 run 已完成：历史中能看到同一 user/assistant ID；再次 hydrate/reconnect 不复制消息或正文。
- 旧数据没有 message link 时仍能展示兼容壳，但不会被 outbox 当作合法新消息发送。
- 回放收到同一事件两次时，事件按 event ID/sequence 去重，正文不重复拼接。

## FR-7：生产环境禁止静默 memory run-store fallback

### 根因

enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:825-835 当前在 DATABASE_URL 缺失或 resolveDatabaseConfig() 抛错时直接返回 createMemoryStore()。这对单测方便，但对测试/生产容器意味着：深度调研可以成功跑完，进程一重启所有 run 都不可恢复。

### 修改落点

1. enterprise/apps/web-portal/src/lib/deep-research/run-store.ts:825-835
   - 将 fallback 改成显式策略：
     - NODE_ENV=test 或明确 DEEP_RESEARCH_RUN_STORE_MODE=memory 才允许 memory store；
     - production 缺数据库配置/解析失败直接抛出可读错误，或让健康检查标记 degraded 并使 deep-research route 返回明确 503；
     - development 若允许降级，也必须输出一次结构化告警，并在 /api/chat/deep-research/runs 响应中暴露 durability=degraded，不能让 UI 误以为支持重启恢复。

2. enterprise/apps/web-portal/src/lib/deep-research/run-store.test.ts
   - 增加缺 DATABASE_URL、错误 dialect、显式 memory mode、production fail-closed 四类测试。

3. enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts 与 completions/route.ts
   - run-store 不可用时返回可读错误和 trace/run context；不启动一个最终必丢的长任务。

### 验收标准

- 生产配置错误时，深度调研在启动前失败并明确提示持久化不可用。
- 测试仍可使用隔离的 createMemoryRunStore()，不依赖真实数据库。
- 具备 DATABASE_URL 且迁移完成时，跨进程/重启恢复测试走 SQL store。

## FR-8：鉴权失效后保留并恢复同一账号的结果

### 现状与根因

当前链路的几个行为分别是合理的，但组合起来会丢用户感知上的“已完成结果”：

1. enterprise/apps/web-portal/src/lib/session.ts:84-121 会在 access token 过期且 refresh token 有效时尝试刷新；refresh token 也失效时 API 返回 401。
2. enterprise/features/chat/src/store.ts:592-605 收到历史 API 401 后安排跳转 /auth?returnTo=...；如果本轮 assistant 只有内存内容，跳转会卸载页面。
3. enterprise/apps/web-portal/src/components/WorkspaceShell.tsx:243-293 重新登录后才启动同 principal 的 history outbox coordinator；当前没有端到端保证“旧 outbox + run-store + active session”一起恢复。
4. run-store 与聊天历史没有真实 message link，runs hydrate 只返回事件/artifact ID，完成的结果无法可靠挂回原 assistant。

### 修改落点

1. enterprise/features/chat/src/store.ts:592-610、history-outbox.ts:419-440
   - 401 仍然 pause outbox，但不能删除、quarantine 或清空未发送 op。
   - 深度调研 session 在 auth recovery 期间保留当前 UI snapshot 和 runId/assistantId；如果需要跳转登录，先确保 durable-first op 已写入 IndexedDB。
   - 将“登录已过期，请重新登录”与“这段对话尚未同步”分成两个状态，避免用户误以为深度调研结果不存在。

2. enterprise/apps/web-portal/src/components/WorkspaceShell.tsx:243-300
   - 登录恢复后按 principal 启动 coordinator，再执行 hydrate；顺序必须是 principal ready → 读 pending overlay → 拉 sessions/messages/run hydrate → flush → reconciliation。
   - 通过 returnTo 或本地已持久化的 active session ID 回到原 session；不得创建新 session 后把旧 run 隐藏。
   - 账号切换时只读取新 principal 的 outbox；旧账号的 op 保留但绝不能被新账号 flush。

3. enterprise/features/chat/src/history-outbox.ts:548-603
   - 给 pause/resume 增加“等待重新认证”状态；重新启动同 principal 后自动恢复 flush。
   - coordinator dispose 只停止 timer/listener，不得删除可恢复 op。

4. enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts:131-157
   - 认证恢复后，按 tenant/user/session 返回 active 和 latest run 的真实 message IDs、状态、完成/失败信息和 artifact IDs。
   - 如果 run 已完成但 chat append 尚未成功，客户端必须先 materialize/overlay 原消息，再 flush append，不能只显示一个空新会话。

5. enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:800-816,1380-1420
   - 浏览器 transport 失效与用户鉴权失效都不能删除已写入 run-store 的事件/报告。
   - Gateway token refresh 失败时 run 仍应以 failed 状态持久化已有产出和 errorMessage；不能只把错误返回给已经失去 session 的浏览器。

### 鉴权恢复验收标准

- 场景 A：深度调研已输出完成结果，最后历史 append 收到 401，浏览器跳转登录；重新登录同一账号后，原 session 中能看到同一 user/assistant ID、最终内容或可打开的 artifact，且 outbox 最终清空。
- 场景 B：access token 在调研中途过期但 refresh token 有效；服务端刷新 Gateway bearer，run-store 继续写，前端短暂断流后重新登录/刷新可恢复同一 run。
- 场景 C：refresh token 也失效；前端要求重新登录，但 run-store 已有的部分结果不能被删除。重新登录同一账号后，active/latest hydrate 能找到该 run；若 run 最终 failed，页面展示失败原因和已有 artifact，而不是空白。
- 场景 D：登录另一个账号；旧账号的 outbox 和 run 不会出现在新账号页面，也不会被新账号发送。
- 场景 E：历史 API 401 发生在普通聊天成功回复之后；A 的已完成消息仍可在重新登录后恢复，不能因 auth redirect 把其当作未发送内容。

## 测试矩阵与执行命令

### 必须新增或补强的测试

| 目标 | 测试文件 | 关键断言 |
| --- | --- | --- |
| 首写 outbox 屏障、delta/checkpoint/finally | enterprise/features/chat/src/store.deep-research.test.ts | request 发出前 outbox 已存在；断流/错误后仍可恢复最新 checkpoint |
| append 与旧 GET 竞态 | enterprise/features/chat/src/store.history-persistence-recovery.test.ts（新建） | stale GET 不覆盖 local；同 ID 不重复 |
| A/B/C 同 session | enterprise/features/chat/src/store.multi-session.test.ts | C request 仍带 A；B 失败不清除 A；其他 session 不串台 |
| outbox 顺序和 pending overlay | enterprise/features/chat/src/store.history-persistence-queue.test.ts | localSeq/operation/hash 保持；flush 后 reconciliation 不重复 |
| auth pause/resume 与 principal 隔离 | enterprise/features/chat/src/history-outbox.test.ts、store.history-persistence-recovery.test.ts | 401 后 op 保留；同 principal 登录后 flush；换账号不读取 |
| run/message link、旧 run 兼容 | enterprise/apps/web-portal/src/lib/deep-research/run-store.test.ts | create/get/hydrate 保留 IDs；旧 null 字段可读；memory 策略明确 |
| writer flush 屏障 | enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts | run_started/report chunk 在 finish 前可被 fake store 观察到 |
| hydrate 真实 ID、幂等恢复 | enterprise/features/chat/src/utils/deep-research-hydrate.test.ts | 不靠 topic 猜新 run；重复 hydrate 不复制 |
| 无气泡重连 | enterprise/features/chat/src/utils/deep-research-reconnect.test.ts 与相关 view 测试 | target 先 materialize，事件/delta 能写入真实 ID |
| 澄清回显与提交幂等 | enterprise/features/chat/src/components/molecules/DeepResearchClarifyCard.test.ts（新建）及 enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.test.ts | 刷新回显答案；重复/无 waiter 仍落 run-store |
| PG/MySQL 结构一致 | enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts | 新列、可空性、迁移 journal 两边一致 |

### 鉴权恢复测试要求

至少使用一个 fake history transport 和一个 fake run-store，按以下时间线控制：

~~~text
1. client stream 产生 run_started、若干 delta、completed。
2. history append 第一次返回 401，记录 IndexedDB outbox 中的 operation。
3. 模拟 WorkspaceShell unmount/login，重新以相同 tenantId/userId 启动 coordinator。
4. hydrate 返回旧远端消息 + run-store latest。
5. 断言先显示 outbox/run overlay，再 flush，最终以相同 message ID 合并。
6. 重复 hydrate、重复 flush、重复登录均不得复制消息或报告正文。
~~~

### 基线命令

实现完成后至少执行：

~~~bash
pnpm -C enterprise exec vitest run \
  features/chat/src/store.deep-research.test.ts \
  features/chat/src/store.history-persistence-queue.test.ts \
  features/chat/src/store.history-persistence-recovery.test.ts \
  features/chat/src/store.multi-session.test.ts \
  features/chat/src/utils/deep-research-hydrate.test.ts \
  features/chat/src/utils/deep-research-reconnect.test.ts

pnpm -C enterprise exec vitest run \
  apps/web-portal/src/lib/deep-research/run-store.test.ts \
  apps/web-portal/src/lib/deep-research/orchestrator.test.ts \
  apps/web-portal/src/app/api/chat/deep-research/resume/route.test.ts

pnpm -C enterprise exec vitest run \
  packages/db-schema/src/__tests__/schema-parity.test.ts
~~~

实现前已知的测试基线（不能被本计划误报为新回归）：

- 聊天相关定向运行曾有 25 个通过、store.multi-session.test.ts 一个 5 秒超时。
- run-store/orchestrator 定向运行曾有 68 个通过、orchestrator 中一个 bearer refresh 断言失败。
- 实施者必须先隔离并记录这两个基线失败，再判断新改动是否引入新的失败；不能用“全绿”表述掩盖未解决的既有红测。

## 实施顺序

1. 在 main 上先补 PG/MySQL schema、migration、RunRecord 与 request correlation 类型，并通过 parity/run-store 测试。
2. 实现 durable-first shell 与统一 checkpoint action，先补 store deep-research 测试。
3. 实现 hydrate/refetch/switch 的 session-local merge，再补 stale GET 和 A/B/C 测试。
4. 将澄清答案写入 run-store/chat checkpoint，补卡片回显、resume 重复提交和无 waiter 测试。
5. 改真实 ID 恢复/重连，补无气泡恢复和正文去重测试。
6. 加入 auth pause/resume、同账号 re-login、跨账号隔离测试，确认 401 不丢 outbox/run。
7. 最后收紧 memory fallback 和运行时可观测性，跑完整测试矩阵与 TypeScript/build。

## 交付验收

在不依赖人工快速点击的情况下，以下五条必须可自动化证明：

1. 深度调研在首个事件前刷新，重进 session 后 user+assistant 壳仍可见，且 run 能继续/重连。
2. 调研过程中已有的部分事件、报告 checkpoint、澄清答案在重启/新请求后可恢复；未 flush 的最后短片段可以按既定窗口延迟，但不能让整个 run 消失。
3. 同一 session 的 A 成功、B 失败、C 继续发送时，C 不丢 A；刷新和补同步不制造重复消息。
4. 深度调研完成后发生 401，重新登录同一账号仍能找到同一 session/run/result；换账号不能看到。
5. 生产数据库不可用时系统明确失败，不启动一个表面成功、重启后必丢的深度调研。

