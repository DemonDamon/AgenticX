# deepseek-harness Code Index

## Provenance

- local clone SHA: `47f943859bef60e4160492346772ded9b24f765a` (`origin/master`, remote `https://github.com/deepseek-ai/deepseek-harness.git`)
- GitHub MCP: failed — live tool discovery error；`mcp_auth` 重试仍 error。Issue/PR 历史 **not retrieved**
- ZRead: failed — `search_doc` HTTP 429 / 余额不足。按工作流不视为源码研究不完整
- DeepWiki: available — `read_wiki_structure` + 6× `ask_question`；答案须对照本地源（见 `deepseek-harness_deepwiki.md`）

## Core tree

```
deepseek-harness/
├── packages/
│   ├── core/                 # KEY: session, agent, agent-loop, tools, system-prompt
│   ├── session/              # KEY: persistence JSONL/SQLite, checkpoint-policy
│   ├── compaction/           # KEY: compaction-basic, tool-result-pruner
│   ├── spill/                # KEY: spill-policy + local store
│   ├── guard/                # KEY: repeat-tool-reminder, timeout-policy
│   ├── workflow/             # KEY: tool-ralph, workflow-worker-thread
│   ├── goal/                 # KEY: goal + goal-round-driver
│   ├── jobs/                 # background bash/subagent jobs
│   ├── subagent/             # spawn / cold resume / control tools
│   ├── llm/                  # adapters + stream vocabulary
│   └── bundle/               # dsh-base composition
├── vendor/                   # vendored Cordis (out of adoption scope)
├── apps/                     # CLI / web product (out of adoption scope)
├── python/                   # Python SDK product surface (out of adoption scope)
├── native/                   # landlock (out of adoption scope)
└── docs/                     # architecture + subsystem contracts
```

## Files actually read

| File | Evidence category | Symbols inspected |
|------|-------------------|-------------------|
| `README.md` | Public entry/API | product pitch, MIT, developer preview |
| `AGENTS.md` | Public entry/API | package map, invariants |
| `docs/architecture.md` | Public entry/API | turn flow, capability seams |
| `docs/subsystems/core.md` | Core abstraction | `Agent`, inbox, cancel |
| `docs/subsystems/compaction.md` | Core abstraction | `CompactionEngine`, triggers |
| `docs/subsystems/jobs.md` | Core abstraction | `JobStart`, `JobHooks` |
| `docs/subsystems/goal.md` | Core abstraction | `GoalPhase`, `GoalSnapshot` |
| `docs/defensive-patterns.md` | Failure/fallback | dispose quiescence, orthogonal outcomes |
| `packages/core/agent-loop/src/index.ts` | Public entry/API | `AgentLoop`, factory ownership |
| `packages/core/agent-loop/src/agent.ts` | Main execution path | `ReactLoopAgent.kick/turn/step` |
| `packages/core/agent-loop/src/tool-calls.ts` | Main execution path | `executeToolCalls` |
| `packages/core/agent-loop/src/constants.ts` | Core abstraction | `DEFAULT_MAX_PARALLEL_TOOL_CALLS` |
| `packages/core/session/src/index.ts` | Core abstraction | `SessionStore`, export repair |
| `packages/core/session/src/repair.ts` | Failure/fallback | `interruptedTurnClosers` |
| `packages/core/session/tests/repair.spec.ts` | Test/example | closer branches |
| `packages/session/session-checkpoint-policy/src/index.ts` | Failure/fallback | `apply` flush barriers |
| `packages/session/session-persistence/src/index.ts` | Extension point | persistence seam |
| `packages/session/session-persistence-jsonl/src/index.ts` | Extension point | JSONL/zstd |
| `packages/compaction/compaction-basic/src/index.ts` | Main execution path | auto pressure + overflow retry |
| `packages/spill/spill-policy/src/index.ts` | Failure/fallback | spill best-effort |
| `packages/workflow/tool-ralph/src/index.ts` | Extension point | `RALPH_SCRIPT`, `apply` |
| `packages/workflow/tool-ralph/README.md` | Public entry/API | foreground-only contract |
| `packages/workflow/workflow/README.md` | Failure/fallback | no journaling |
| `packages/goal/goal-round-driver/src/index.ts` | Extension point | auto continuation |
| `packages/guard/repeat-tool-reminder/src/index.ts` | Extension point | advisory reminder |
| `packages/guard/timeout-policy/src/index.ts` | Failure/fallback | `TOOL_TIMEOUT` |
| `LICENSE` | Public entry/API | MIT |

## Key symbols

| Symbol | SHA + path:line-range | Responsibility |
|--------|----------------------|----------------|
| `ReactLoopAgent` | `47f94385` `packages/core/agent-loop/src/agent.ts:64-496` | 默认 loop |
| `kick` | `…/agent.ts:210-223` | driver 边界 |
| `turn` | `…/agent.ts:246-330` | turn 生命周期 |
| `step` | `…/agent.ts:332-401` | 单步 LLM + tools |
| `executeToolCalls` | `…/tool-calls.ts:59-80` | 并行调度 |
| `interruptedTurnClosers` | `packages/core/session/src/repair.ts:27-133` | 崩溃尾合成 |
| `apply` (checkpoint) | `packages/session/session-checkpoint-policy/src/index.ts:63-83` | fail-closed flush |
| `BasicCompactionEngine` | `packages/compaction/compaction-basic/src/index.ts:103-259` | 压力 + overflow |
| `RALPH_SCRIPT` / `apply` | `packages/workflow/tool-ralph/src/index.ts:90-177, 405-479` | 新鲜子智能体循环 |
| `apply` (repeat reminder) | `packages/guard/repeat-tool-reminder/src/index.ts:162-233` | advisory hygiene |
| `apply` (timeout) | `packages/guard/timeout-policy/src/index.ts:55-81` | 工具 deadline |
| `apply` (spill) | `packages/spill/spill-policy/src/index.ts:110+` | 大结果外置 |
| `apply` (goal-round-driver) | `packages/goal/goal-round-driver/src/index.ts:76+` | 同会话续轮 |

## Search coverage

- Paths: `packages/core/`, `packages/session/`, `packages/compaction/`, `packages/spill/`, `packages/guard/`, `packages/workflow/`, `packages/goal/`, `packages/jobs/`, `docs/subsystems/`, `agenticx/runtime/`, `agenticx/core/overflow_recovery.py`, `agenticx/longrun/`, `agenticx/project_state/`
- Exact symbols: `ReactLoopAgent`, `interruptedTurnClosers`, `compactIfNeeded`, `CONTEXT_WINDOW_EXCEEDED`, `ralph-loop`, `GoalPhase`, `sessions.flush`, `LoopDetector`, `_sanitize_context_messages`, `OverflowRecoveryPipeline`, `is_context_window_exceeded_error`
- Synonyms: crash recovery, checkpoint, compaction, overflow, stall, long-run, continuation, ralph, goal round, spill, offload
- Protocol/config fields: `timeoutMs`, `maxInlineBytes`, `maxRounds`, `maxHandoffChars`, `maxOverflowRetries`, `thresholdRatio`, `CompactionTrigger`, `JobStatus`, `GoalPhase`, `SESSION_FORMAT_VERSION`

## High-signal Issue/PR history

- not retrieved — GitHub MCP unavailable；ZRead quota exhausted。本地提交信息：`47f94385` subject `Merge pull request #2519 from deepseek-harness/feat/npm-public`（仅证明 npm 公开发布相关合并，不作为机制证据）。
