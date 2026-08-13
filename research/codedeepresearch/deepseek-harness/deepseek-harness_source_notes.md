# deepseek-harness Source Notes

Locked SHA: `47f943859bef60e4160492346772ded9b24f765a`

## Problem and boundaries

### Solves

DeepSeek Harness (`dsh`) 是一套 TypeScript/Cordis 插件化 agent harness。与本次「长程任务稳定执行」相关的已验证机制：

1. **事件源会话日志**：append-only `SessionEvent` 是模型可见上下文的唯一来源（`deriveMessages()` 从日志投影）。
2. **可扩展 agent-loop**：`ReactLoopAgent` 以 turn/step 驱动；compaction、checkpoint、loop hygiene 全部挂在瀑布事件上，不改 loop 本体。
3. **崩溃尾修复**：冷加载时用 `interruptedTurnClosers` 合成 `tool/result` + `step/end` + `turn/end`，区分 `TOOL_NOT_STARTED` 与 `TOOL_OUTCOME_UNKNOWN`。
4. **语义检查点（fail-closed）**：LLM 派发前、顶层工具执行前、下一 step 前 `sessions.flush()`；flush 失败则不调用 adapter/tool body。
5. **压力 + overflow 双触发 compaction**：`agent/pre-step` 压力压缩；`agent/request-error` 在 `CONTEXT_WINDOW_EXCEEDED` 时强制压缩并 **retry 同一步**。
6. **超大工具结果 spill**：成功结果超 `maxInlineBytes` 时落 artifact，模型侧只见 head/tail + locator；失败绝不把成功变成 `isError`。
7. **同会话 Goal 续跑** vs **Ralph 新鲜子智能体循环**：两条显式策略，不是一个万能 loop。
8. **重复工具提醒（advisory）** 与 **工具超时 waterfall**。

### Does not solve

- 通用「带调度/续跑/崩溃恢复的万能 loop」：workflow **无 journal/resume**（E-021）；Ralph **仅前台、无进程恢复**（E-016）。
- 时间调度 / cron：文档明确不做 interval/cron 常驻 runner。
- 把 Cordis/Web UI/Landlock/Typert 作为可移植 Python 运行时。
- Developer preview：无兼容承诺，`SESSION_FORMAT_VERSION = 0`。

## Runtime validation

- Command: not run
- Result/exit code: n/a
- If not run, reason: 完整 `pnpm install && pnpm run build && pnpm dsh web` 超出默认 5 分钟且需要 `DEEPSEEK_API_KEY`；研究约束为 static_only。`runtime_validation = static_only`

## Core abstractions

| Name | Responsibility | Exact source location |
|------|----------------|----------------------|
| `ReactLoopAgent` | 默认 Agent driver：inbox → turn/step → LLM stream → tool dispatch | `packages/core/agent-loop/src/agent.ts` `ReactLoopAgent` L64–496 |
| `Session` / `SessionStore` | append-only 事件日志 + `deriveMessages()` | `packages/core/session/src/index.ts` |
| `interruptedTurnClosers` | 崩溃尾合成 closer | `packages/core/session/src/repair.ts` L27–133 |
| `PersistenceCoordinator` | 冷加载 crash-repair、flush、JSONL/SQLite 共享编排 | `packages/session/session-persistence/src/coordinator.ts` ~L903 |
| `session-checkpoint-policy` | LLM/tool/pre-step 语义 flush | `packages/session/session-checkpoint-policy/src/index.ts` `apply` L63–83 |
| `BasicCompactionEngine` | 压力压缩 + overflow retry | `packages/compaction/compaction-basic/src/index.ts` |
| `spill-policy` | 超大纯文本工具结果外置 | `packages/spill/spill-policy/src/index.ts` `apply` L110+ |
| `ralph` tool | 固定脚本：每轮新鲜子智能体 + 有界 structured handoff | `packages/workflow/tool-ralph/src/index.ts` |
| `goal-round-driver` | 同会话目标自动续轮（激活态进程内） | `packages/goal/goal-round-driver/src/index.ts` `apply` L76 |
| `repeat-tool-reminder` | 连续相同调用注入提醒，不 veto | `packages/guard/repeat-tool-reminder/src/index.ts` |
| `timeout-policy` | `tools/execute` 上按 `timeoutMs` 武装 deadline | `packages/guard/timeout-policy/src/index.ts` |

## Main execution path

```mermaid
sequenceDiagram
  participant User
  participant Inbox
  participant Loop as ReactLoopAgent
  participant Session
  participant Prompt as systemPrompt
  participant LLM
  participant Tools

  User->>Inbox: followup / steer / inject
  Inbox->>Loop: wakeDriver
  Loop->>Session: turn/start
  loop each step
    Loop->>Inbox: claim(next-turn or next-step)
    Loop->>Prompt: assemble
    Note over Loop: agent/pre-step waterfall<br/>compaction pressure + checkpoint flush
    Loop->>Session: user/message
    Note over LLM: llm/stream after sessions.flush
    Loop->>LLM: stream(request)
    LLM->>Session: assistant/chunk*
    Loop->>Session: assistant/message
    alt has tool-calls
      Note over Tools: tools/execute after flush
      Loop->>Tools: executeToolCalls
      Tools->>Session: tool/call + tool/result
    else no tools and no next-step
      Loop->>Loop: agent/turn-stopping
    end
  end
  Loop->>Session: turn/end
```

同一步内若 LLM 以 `CONTEXT_WINDOW_EXCEEDED` 失败：`agent/request-error` → `compactIfNeeded(..., 'context-overflow')` → `{ kind: 'retry' }`（E-012）。

进程崩溃后冷加载：`PersistenceCoordinator` 调用 `interruptedTurnClosers`，把未闭合 turn 补成 provider-valid transcript（E-007、E-008）。

## Failure and fallback behavior

| Failure | Handling | Evidence ID |
|---------|----------|-------------|
| 进程崩溃于未闭合 turn | 冷加载合成 `tool/result`（NOT_STARTED / OUTCOME_UNKNOWN）+ `step/end` + `turn/end{interrupted}` | E-007, E-008 |
| `sessions.flush` 在 LLM 前失败 | fail-closed：不构造 downstream stream | E-009 |
| `sessions.flush` 在顶层 tool 前失败 | fail-closed：不进入 tool body | E-009 |
| flush 期间 signal abort | 返回 `TOOL_ABORTED_BEFORE_DISPATCH`，不执行 tool | E-009 |
| LLM `CONTEXT_WINDOW_EXCEEDED` | 压缩（可先 prune）后 retry 同一步；达 `maxOverflowRetries` 则保留原错误 | E-012 |
| 压力压缩失败 | warn 后继续 turn（不阻断） | E-011 |
| spill 存储失败 | 保留原始 inline 结果；绝不把成功变成 isError | E-013 |
| Ralph 子轮失败 | 整次 ralph 以 error 结束，不重试该轮；保留 last handoff | E-016 |
| 重复相同 tool call | 达阈值注入 reminder，不 veto | E-017 |
| 工具 `timeoutMs` 到期 | 替换为 `TOOL_TIMEOUT` 结构化错误结果 | E-018 |
| 驱动层未捕获异常 | `kick()` catch 后回到 idle（contained） | E-003 |

## Extension points

| Extension | Contract | Evidence ID |
|-----------|----------|-------------|
| `agent/pre-step` waterfall | reject \| enter(messages)；compaction/checkpoint/goal 挂这里 | E-002, E-011 |
| `agent/request` waterfall | 改写 LLM call config | E-004 |
| `agent/request-error` waterfall | undefined \| `{kind:'retry'}` | E-004, E-012 |
| `agent/turn-stopping` serial | 可 `steer()` 再开一步 | E-002 |
| `llm/stream` waterfall | checkpoint 包装 | E-009 |
| `tools/pre-execute` / `execute` / `post-execute` | 审批、超时、spill、repeat reminder | E-005, E-013, E-017, E-018 |
| `ctx.compaction` / `ctx.jobs` / `ctx.goals` / `ctx.workflowEngine` | 能力缝 Service Definition | E-010, E-014, E-015 |
| SessionEventMap declaration merging | 新的模型可见输入必须是可日志事件 | E-001 |

## Evidence

| Evidence ID | Claim | Source type | Exact location | SHA/number | Confidence |
|-------------|-------|-------------|----------------|------------|------------|
| E-001 | 模型可见 ⟺ 已写入 session log；`deriveMessages()` 从日志投影 | local-source | SHA `47f94385` `docs/architecture.md` L92–96；`packages/core/session/src/index.ts` module docstring L1–5 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-002 | turn = 0+ steps；`agent/pre-step` 可 reject；tools 欠下一次请求则续 step | local-source | `docs/architecture.md` L63–90；`packages/core/agent-loop/src/agent.ts` `turn` L246–330 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-003 | `kick()` 循环 `turn()`；失败/取消在 driver 边界吞掉，finally 回 idle | local-source | `packages/core/agent-loop/src/agent.ts` `kick` L210–223 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-004 | `step()` 在 `finish.kind === error\|aborted` 时走 `agent/request-error`；仅 `retry` 才 `continue` | local-source | `packages/core/agent-loop/src/agent.ts` `step` L354–370 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-005 | 一步内并行工具：exclusive 成 barrier，其余 bounded pool；abort 给未开始调用写合成错误结果 | local-source | `packages/core/agent-loop/src/tool-calls.ts` L1–12, `executeToolCalls` L59–66 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-006 | 默认每 step 最多 10 个并行安全调用 | local-source | `packages/core/agent-loop/src/constants.ts` `DEFAULT_MAX_PARALLEL_TOOL_CALLS` L6 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-007 | `interruptedTurnClosers` 为未配对 tool-call 合成错误 `tool/result`：无 `tool/call` → `TOOL_NOT_STARTED`；有 call 无 result → `TOOL_OUTCOME_UNKNOWN`（禁止盲目重试有副作用操作） | local-source | `packages/core/session/src/repair.ts` `interruptedTurnClosers` L27–133 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-008 | 冷加载经 coordinator 把 closers 持久化；live 打开的 turn 不会被当成 interrupted 修补 | local-source | `packages/session/session-persistence/src/coordinator.ts` ~L903；README crash-repair 段 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-009 | checkpoint policy：`llm/stream` 与顶层 `tools/execute` 在 dispatch 前 `flush`；失败则不调用下游；pre-step 也 flush | local-source | `packages/session/session-checkpoint-policy/src/index.ts` `apply` L63–83, `afterCheckpoint` L29–38 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-010 | compaction 不是 loop spine；`compactIfNeeded(pressure\|context-overflow)`；lock 为 start/summary/end | local-source | `docs/subsystems/compaction.md` L7–20, L62–86 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-011 | auto compaction 挂 `agent/pre-step`；失败 warn 后 `next()` | local-source | `packages/compaction/compaction-basic/src/index.ts` `_registerAutomaticCompaction` L137–165 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-012 | overflow：仅 `CONTEXT_WINDOW_EXCEEDED` 且未超 `maxOverflowRetries` 时 compact 并返回 `{kind:'retry'}`；surface replaceGeneration 前进才算成功 | local-source | `packages/compaction/compaction-basic/src/index.ts` `agent/request-error` L179–223 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-013 | spill-policy：超 cap 则存 full text、模型侧 preview；无 backend/失败则保留原文；`read` 跳过模型侧以免循环 | local-source | `packages/spill/spill-policy/src/index.ts` L1–36, `apply` L110–120 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-014 | jobs：`running\|stopping\|completed\|killed\|failed`；producer 拥有资源，runtime 拥有身份/生命周期；owner dispose 取消并等待 | local-source | `docs/subsystems/jobs.md` L1–94 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-015 | Goal：durable phase `active\|paused\|blocked\|complete` + `maxGoalRounds`；activation 进程本地、不落盘 | local-source | `docs/subsystems/goal.md` L21–55；`packages/goal/goal-round-driver/src/index.ts` `apply` L76 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-016 | Ralph：固定脚本每轮 spawn 新鲜 structured child；`inheritsParentContext` 必须 false；workspace 为长期记忆；handoff 有界 JSON；前台阻塞；子失败不重试；无进程 resume | local-source | `packages/workflow/tool-ralph/src/index.ts` `RALPH_SCRIPT` L90–177, `apply` L405–479；README L1–15, L89 附近「Foreground only」 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-017 | repeat-tool-reminder：阈值默认 `[3,5,8]`；post-execute 计数（含 deny）；只注入 additionalContexts；用户消息 pre-step 重置 | local-source | `packages/guard/repeat-tool-reminder/src/index.ts` `apply` L162–233 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-018 | timeout-policy：工具声明 `timeoutMs` 才武装；到期映射 `TOOL_TIMEOUT`；不抛弃 tool promise | local-source | `packages/guard/timeout-policy/src/index.ts` `apply` L55–81 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-019 | workflow 脚本/中间值 **不 checkpoint**，进程重启不能续跑 | local-source | `packages/workflow/workflow/README.md` 「No journaling or resume」 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-020 | MIT；developer preview；everything-is-a-plugin / Cordis | local-source | `LICENSE`；`README.md` L7–11；`docs/architecture.md` L9–13 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-021 | JSONL 默认 zstd + packed assistant chunks（约 60% 更小，lossless） | local-source | `packages/session/session-persistence-jsonl/src/index.ts` `packChunks` 注释 L69–75 | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-022 | 测试覆盖 crash closer 与 ralph 契约 | local-source | `packages/core/session/tests/repair.spec.ts`；`packages/workflow/tool-ralph/tests/tool-ralph.spec.ts`；`packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts` | 47f943859bef60e4160492346772ded9b24f765a | high |
| E-023 | DeepWiki 称 repeat 重置在 `agent/prompt-submit`、包名为 `dsh-repeat-tool-guard` | deepwiki | DeepWiki Q2 答案 | n/a | low |
| E-024 | 本地源：重置在 `agent/pre-step`（用户 source）；包名为 `repeat-tool-reminder` | local-source | `packages/guard/repeat-tool-reminder/src/index.ts` L229–232, `name` L17 | 47f943859bef60e4160492346772ded9b24f765a | high |

## Cross-check

| Claim | Evidence | Result (yes/no/partial) | Corrected wording |
|-------|----------|-------------------------|-------------------|
| 事件源 session log 是模型上下文 SoT | E-001 | yes | 保持 |
| 插件可在不改 agent-loop 的情况下加 compaction/checkpoint/hygiene | E-002, E-009–E-012, E-017 | yes | 保持 |
| 崩溃修复会合成 tool/result 而非丢弃 assistant tool-call | E-007, E-008, E-022 | yes | 冷加载路径；live turn 不修 |
| LLM/tool 副作用前 fail-closed flush | E-009 | yes | 保持 |
| overflow 压缩后 **重试同一步** | E-012 | yes | 仅 `CONTEXT_WINDOW_EXCEEDED` + replaceGeneration 前进 |
| Ralph 是长程稳定执行的通用调度器 | E-016, E-019 | no | Ralph 是前台固定策略；无 resume；普通长任务应走 goal |
| Goal 恢复后自动续跑 | E-015 | partial | 目标事实可重放，activation 进程本地，恢复后需 disarm/rearm |
| 重复工具守卫会 veto | E-017, E-023 vs E-024 | no | 只 advisory inject；DeepWiki 包名/事件名过时 |
| 超大 tool result 会外置且失败不污染成功 | E-013 | yes | 仅纯文本；`read` 跳过模型侧 |
| Workflow 可崩溃续跑 | E-019 | no | 明确无 journaling |
| Cordis 是可移植到 Python 的必要内核 | E-020 | no | 机制可内化；框架本身不应迁入 |
| 存在时间调度器 | DeepWiki Q5 | no | 文档写明不做 cron/interval runner；AgenticX longrun 才是调度面 |
