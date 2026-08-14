# deepseek-harness DeepWiki Notes

Repo: `deepseek-ai/deepseek-harness`  
Local SHA used for verification: `47f943859bef60e4160492346772ded9b24f765a`  
DeepWiki 答案**不能**单独进入 P0/P1。

## Structure

`read_wiki_structure` 返回 10 个顶层主题（Overview / Core Architecture / Agent System / Execution Environment / API / Web UI / Extensions / Testing / Docs / Glossary）。本次只消费与长程执行相关的 Agent System、Session、Goals/Workflows。

## Q1 Architecture / data flow

- Status: **verified**
- Evidence: E-002, E-003, E-004
- Notes: DeepWiki 描述 followup → inbox → turn/start → pre-step → LLM → tools → 续 step，与 `ReactLoopAgent.turn/step` 一致。取消默认清 inbox；`keepInbox` 保留。合成 abort 结果在 tool-calls 调度层，DeepWiki 简化为 `ABORTED_BEFORE_DISPATCH`，与 checkpoint 路径一致（E-009）。

## Q2 Extension mechanisms

- Status: **partially_verified**
- Evidence: E-002, E-009–E-012, E-017, E-023, E-024
- Contradiction: DeepWiki 写 repeat 重置在 `agent/prompt-submit`、包名 `dsh-repeat-tool-guard`。本地源是 `agent/pre-step` + `repeat-tool-reminder`（E-024）。P0/P1 采用本地源。

## Q3 Reliability

- Status: **verified**
- Evidence: E-007, E-008, E-009, E-012, E-015
- Notes: 崩溃 closer、fail-closed checkpoint、overflow retry、goal 激活进程本地，均能在本地文件对上。DeepWiki 提到的 `crash-recovery.e2e.ts` 未在本次逐文件打开；单元覆盖以 `repair.spec.ts` 为准（E-022）。

## Q4 Performance / cost

- Status: **verified**
- Evidence: E-010, E-013, E-016, E-021
- Notes: packed chunks ~60%、spill head/tail、Ralph 丢弃跨轮对话以换可预测窗口，与源码注释/README 一致。未运行基准；`BENCHMARK.md` 仅指向 Python SDK 手工流程。

## Q5 Design trade-offs / limitations

- Status: **verified**
- Evidence: E-016, E-019, E-020
- Notes: developer preview、workflow 无 resume、Ralph 前台-only、model-visible-means-logged，本地 README/AGENTS 支持。DeepWiki「系统没有时间调度器」对 dsh 为真；**不能**据此说 AgenticX 也没有（AgenticX 有 `longrun`）。

## Q6 AgenticX fit

- Status: **partially_verified**
- Evidence: 对照 Gap 报告 AgenticX Evidence 表；DeepWiki 倾向把 goal/repeat-guard/subagent cold-resume 都标成「应内化」
- Correction: 适配决策以本地 AgenticX 对照为准。Cordis / Web UI / Landlock **不要迁入**（与 DeepWiki 一致）。Repeat-guard 与 AgenticX `LoopDetector` 高度重叠（NO-GAP/P2）。Goal-round-driver 与 longrun/project_state 部分重叠（P2）。真正缺口是 closer 语义、fail-closed checkpoint、Studio 热路径 overflow 同轮 retry、Ralph 式上下文隔离循环。
