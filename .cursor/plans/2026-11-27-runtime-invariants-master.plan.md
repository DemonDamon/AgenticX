# AgenticX 运行时不变量内化 Master Plan

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4（5 份子 plan 的规划与实施统一使用）
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-master

> 规划生成：AI Agent（Trae），模型 GLM-5.4，生成于 2026-11-27；评审与拍板：Damon Li。2026-11-27 依外部评审意见修订一版，逐条处置见修订记录；同日拍板，执行约定见下。
> 参考基线：一份外部开源实现（MIT 许可），2026-11-27 静态阅读；本文只保留结论，不保留其仓库链接与名称。AgenticX 侧核实于 `main` @ `90a53345`。
> **执行约定：** 本文档是 master plan，只定总览、边界与子 plan 依赖，不直接执行。逐份推进：写一份、做一份、提交一个 commit，不并行。规划与实施都由独立 sub agent 完成，主会话审查 plan、验收实现；验收通过后才规划下一份，下一份的规划以前几份实际落地的提交为准。中间子 plan 不需逐份确认，由主会话判断；全部完成后由主会话做端到端验收。本文档是本系列唯一的状态与验收控制点。

## Goal

把一份外部开源实现里经源码核实、且 AgenticX 确实缺的四个运行时不变量内化到 SDK 层，并用一道 CI 门禁锁死。交付后，一次会话的结构事件以 Replay Ledger 为唯一持久源并支持读时升级：进程被杀后换一个客户端能接着读，崩溃恢复不再维护两套状态，审计回放和评测轨迹读同一份数据，等待中的子智能体在后端重启之后仍找得回、唤得醒。

最显性的两个收益：

- 崩溃或重启之后不再出现"对话还在、进度丢了"。
- 等消息的子智能体在后端重启之后仍找得回、唤得醒。

## Root cause

### 现状盘点

| 能力 | 证据 | 缺什么 |
|---|---|---|
| 追加式事件账本（Replay Ledger） | `agenticx/runtime/replay_ledger/`（`contracts.py`、`store.py`、`recorder.py`、`context_checkpoint.py`、`branch_service.py`、`effects.py`、`export.py`）；`RunEvent` 带单调序号与 `schema_version`（`contracts.py:226-249`）；追加写 `events.jsonl`（`store.py:211` 起）；内容寻址 blob（`write_blob` 在 `store.py:446`，`payload_ref` 在 `contracts.py:243`）；接入 `agenticx/studio/server.py:84` 与 `agenticx/studio/run_replay_routes.py` | 没有读时 upcaster（目录内未找到版本演进代码）；与 checkpoint 的恢复载荷是双轨；只落本地盘（`recorder.py:601`，建在 `sessions_root` 下） |
| 回合级崩溃恢复 | `agenticx/runtime/checkpoint.py:45-97`（`AgentCheckpoint`、`CheckpointStore`，经 `save_agent_state` 走存储后端单槽保存，调用点 `:83`、`:119`；HA 模式下后端是 Redis，跨副本可见）；恢复时沿用 `checkpoint.run_id` 续写同一账本 run（`agenticx/studio/session_manager.py:1308-1313`）；`tests/test_ha_checkpoint_resume.py` | best-effort 保存，失败只计数不抛错；恢复载荷（`round_idx`、`pending_tool_calls`、`confirm_state`）与账本里的事件各存一份 |
| 实时续看（按会话的事件中枢） | `agenticx/studio/session_event_hub.py:34`（`SessionEventHub`）、`:184`（`replay_since`）；`agenticx/studio/server.py:5571,5599-5622`（`Last-Event-ID` 只读重连）；`tests/test_smoke_session_event_hub.py` | 内存回放缓冲，重启归零；live seq 与 ledger seq 是两套编号 |
| HA 协调总线 | `agenticx/runtime/coordination/`（`bus.py`、`in_process.py`、`redis_bus.py`、`leader.py`）；挂接后事件中枢逐条 `event_append`（`session_event_hub.py:37,132,147`）；装配 `agenticx/studio/server.py:1895-1905`；重连端点读 `bus.event_read`（`server.py:5607,5689`） | 总线游标与账本序号没有桥接说明；账本在本地盘 |
| 子智能体 run 落盘与唤醒 | `agenticx/runtime/subagent_runs/store.py:33-352`（`SubAgentRunStore`）、`resolver.py:23-62`；`team_manager.py:679-748`（`send_message_to_subagent`：非 RUNNING 收到消息即重建会话并唤醒，`:714-727`）；`meta_tools.py:2906`（`dlg-` 前缀路由） | 上下文表 `_agents`、`_archived_agents` 只在进程内存（`team_manager.py:192,196,683`），重启后返回 `not_found`（`:696-702`）；没有显式挂起态；没有持久邮件队列与幂等消费；run 记录留在本地盘（`store.py:36` TODO(HA)） |
| 外部 CLI 接入层 | `agenticx/harness/adapter.py:31-147`（`turn()` 返回单个 `TurnResult`，`iter_stream_chunks()` 产出原始字节）、`types.py:61-64,140`、`registry.py:16-105`；`adapters/codex.py:16,98,106-111`（app-server 流式，失败回退 `exec --json`）；`adapters/claude_code.py:114-119`（原始 PTY 字节流）；`adapters/codebuddy.py:99-104`、`adapters/opencode.py:40-45`（`streaming=False`） | 双路径只有 Codex 一处；没有结构化事件出口，外部 CLI 的回合进不了账本；能力声明没有实测校验 |
| 技能静态分档 | `agenticx/skills/guard.py`、`guard_engine.py`、`guard_classify.py:118-133`（T-MD / T-LITE / T-REF / T-HEAVY 四档）；`scan_skill` 有 5 个文件、6 处安装入口在调用（`extensions/installer.py:198`、`extensions/registry_hub.py:198`、`skills/import_repo.py:194,380`、`skills/pending_queue.py:141`、`cli/agent_tools.py:11056`）；审计的持久出口在 `agenticx/runtime/studio_safety.py:12-16`（`agenticx/safety/audit.py` 的 `SafetyAuditLog` 只是内存环形缓冲，`:36-41`） | 分档结果是否约束加载与执行，本次未核实；技能 frontmatter 与 bundle 清单都没有声明档字段；声明档与实测档不一致时的处置未见 |
| CI | `.github/workflows/` 下 10 个 workflow；`scripts/ci/python-regressions.py:26` 已含 `tests/test_run_context_checkpoint.py` | 全是回归、构建、扫描，没有"基线只减不增"的 ratchet |

不在主链上的两处（本系列不动）：`agenticx/sessions/`（独立的 ADK 风格会话抽象）与 `agenticx/protocols/agui.py`。`agenticx/studio/`、`agenticx/runtime/` 均未引用它们；主链用的是 `RuntimeEvent`（`agenticx/runtime/events.py:59`）与 `ManagedSession`（`agenticx/studio/session_manager.py:405`）。

"未见"表示按关键词在对应目录里没找到，子 plan 启动时先核实，汇总在「待核实清单」。

### 根因

实时续看靠内存里的事件中枢（live seq），崩溃恢复有两条互不相认的线：checkpoint 单槽保存，以及 Replay Ledger 的追加式账本（ledger seq）；HA 模式下另有一套总线游标。三套编号是有意隔离的，但没有任何一处写明客户端如何跨重启、跨副本续读，checkpoint 与账本也各存一份恢复状态。每加一个消费方（移动端、Web、评测、训练），就多一条"从某处把状态拼回来"的路径。该实现的可取之处是只认一份追加式日志、读时 upcast，其余全是投影。

## 结论摘要

- **内化不变量，不内化产品。** 取 4 个运行时不变量，外加 1 个把它们锁死的门禁项，拆成 5 份子 plan。
- **先做账本收敛。** AgenticX 已经有带序号和版本号的追加式账本（Replay Ledger），不需要新建。要补的是读时 upcast、与 checkpoint 双轨的收敛、三套游标的桥接说明。
- **已经具备、不重做的四件事：** 追加式事件账本、按会话的事件中枢、外部 CLI 接入抽象（含 Codex 的单点降级）、进程内的子智能体消息唤醒。
- **唯一的技术不确定点：** HA 模式下账本在本地盘、总线在 Redis，跨副本续读以谁为准。子 plan 01 先核实，再定收敛口径。恢复这一侧已定：HA 模式保留经存储后端的恢复锚点，不只读本地账本。

## 背景与参考来源

### 来龙去脉

- 2026-11-26：调研一份外部开源实现，结论是它不是 CLI 套壳，值钱的是运行时的设计不变量。
- 同日：追问"哪些值得 AgenticX 内化"，当时给了一份 P0–P4 清单，但那份清单对 AgenticX 现状的判断只看了目录名。
- 2026-11-27：逐条核实 AgenticX 代码后重写为本 plan，纠正了四处：
  1. 当时说接入层"只有一对一桥"。实际 `agenticx/harness/` 已有统一抽象和 4 个 adapter，Codex 还自带降级。
  2. 当时把"运行时 daemon 化"列为可借鉴项。实际 AgenticX 后端本来就独立于桌面端，这一项撤销。
  3. 当时说委派"基本在进程内"。实际 `SubAgentRunStore` 已经落盘。
  4. 当时没有计入 `SessionEventHub`。实时续看已经解决。
- 2026-11-27（评审修订）：评审时留了 9 条评论，逐条到代码核实后修订。成立并已改的 7 处：
  1. 漏了 Replay Ledger 与 HA 协调总线，账本收敛的方向因此重写。
  2. 落点误指 `agenticx/sessions/` 与 `protocols/agui.py`，它们不在主链上。
  3. 进程内"收到消息即唤醒"已存在，子 plan 03 缩为跨重启可恢复。
  4. Multica 内化 plan 的 Inbox 面向人，与 Agent 间邮件箱不是一回事。
  5. 双路径降级只有 Codex 一处，统一降级约定属于过度抽象；外部 CLI 事件进账本缺一个事件出口。
  6. 技能静态分档已存在（`guard_classify.py`），`skillhub_install_guard.py` 不是安全守卫，审计应复用 `agenticx/safety/audit.py`。
  7. 依赖图与总览表矛盾、门禁缺少可执行的计数规则、checkpoint 测试未找全、Plan-Id 带第三方名称会进公开提交历史、验收口径与"不做 UI"冲突。
- 同一轮里有 2 处在本检出里没有找到依据，列入「待核实清单」：`gen-graph` 规则文件、`2026-11-17-near-plugin-package-adoption-master.plan.md`。
- 2026-11-27（二审修订）：评审方逐条复审，7 条闭环，2 条要求补正。补正 3 处：
  1. checkpoint 恢复时已沿用 `run_id` 续写同一账本 run，双轨的是恢复载荷；账本只落本地盘，HA 模式下不能只读账本，恢复改为分层。
  2. `SafetyAuditLog` 是内存环形缓冲，审计要走 `studio_safety.py` 的持久出口。
  3. 05 的入口漏了扩展包安装器。
  另按复审提示收紧了两条门禁规则的匹配口径；两条待核实项对方已澄清。

### 仓库与基线

| 项 | 值 |
|---|---|
| 调研对象 | 一份外部开源桌面端 Agent 应用（MIT 许可），只做静态阅读 |
| 调研方式 | 浅克隆后阅读源码与仓库内设计文档；不安装、不运行 |
| 结论落点 | 本文只保留"读到的事实"与对本仓库的取舍，不保留其仓库链接和名称 |
| AgenticX 基线 | `main` @ `90a53345`（2026-11-27 拉取后复核） |

### 具体参考了哪几处

| 内化项 | 参考点 | 参考源码 | 读到的事实 |
|---|---|---|---|
| 账本收敛 | 会话日志 | `agent-session-journal-types.ts` L11、L29、L37、L51-53 | 追加式行"读时 upcast，永不回写"；版本号只能与读时 upcaster 同步递增；大载荷只存 head、`byteLength`、`digest` |
| 账本收敛 | 实时视图 | `agent-session-wire.ts` L138-140 | 发布的是"带游标的当前归约状态"而不是增量，重复批次自然收敛 |
| Harness 事件出口 | 协议与 PTY 两条路径 | `src/main/acp`、`src/main/claude`、`src/main/codex/app-server`、`src/main/pty` | 结构化协议与纯 PTY 并存，归一到同一事件模型 |
| Harness 事件出口 | 历史补齐 | `transcript-decoding` | claude / codex / grok / omp / antigravity 五个独立解码器，每个 CLI 一个小文件 |
| Harness 事件出口 | 托管副本（只参考，不内化） | `managed-agent-cli-registry.ts` | 用户没装 CLI 时由其自有副本兜底 |
| 委派唤醒 | 编排协议 | `skill-guides/orchestration.md` L22、L39、L63-66、L80、L82 | worker 带 Task / Dispatch ID；`worker-start --worktree current\|new-child\|new-top-level`；`send --to dispatch:<id>`；完成后 `worker_done` |
| 委派唤醒 | 编排运行时 | `src/main/runtime/orchestration` | `mailbox`、`workers`、`coordinator`、`turn-delivery`、`addressing`、`db` 等子模块，编排状态是持久化数据 |
| 委派唤醒 | 并发创建保护 | `worktree-create-in-flight.ts` L24-82 | 同一项目创建期间的在途锁与路径抢占 |
| 执行档位 | 扩展档位 | `plugin-manifest.md` L16、L60、L88；`plugin-host-api.md`；`plugin-isolated-frames.md` | 四档 `data` / `declarative` / `sandboxed-ui` / `trusted-worker`，"要的最高权限最小、最少的先给"；超出声明的贡献校验失败；host API 按能力域逐方法授权 |
| 不变量门禁 | 门禁 | `ratchets` 六个目录；`check-max-lines-ratchet.mjs` L25-33；`golden-journeys` 12 个 spec；`daemon/AGENTS.md` L16 | 基线只减不增；关键旅程必须进端到端；竞态问题靠"不变量加反模式清单"文档化，该端点设计经过七轮评审 |

### 调研方法与局限

- 方法：浅克隆后静态阅读源码与仓库内设计文档，社区数据取自 GitHub API；AgenticX 侧同样是静态阅读。
- 没做：没有在本机安装依赖或运行其桌面应用；没有核对会话落盘是否静态加密；没有评估托管下载第三方 CLI 的服务条款边界。
- 所以：源码层面的引用可信；运行时行为与法务合规的判断不在本 plan 的依据之内。

## 内化清单

| 内化项 | 参考做法 | AgenticX 现状（已核实） | 价值 | 不照搬 |
|---|---|---|---|---|
| 账本收敛 | 追加式行，读时 upcast，永不回写；大载荷只存 head、长度、摘要；实时视图发布带游标的当前状态 | Replay Ledger 已有追加写、序号、版本号、blob；没有读时 upcast；与 checkpoint 双轨 | 崩溃恢复只有一个事实源；旧版本行不迁移也能读；多端续读有明确的游标口径 | 不做跨厂商日志格式兼容；不强行统一三套编号 |
| Harness 事件出口 | 结构化协议与 PTY 并存，归一到同一事件模型 | `HarnessAdapter` 只返回单个 `TurnResult` 或原始字节；外部 CLI 的回合进不了账本 | 外部 CLI 的回合与内置 Agent 读同一份账本，审计与回放不缺一块 | 不扩 adapter；不做托管副本；不抽象统一降级 |
| 委派唤醒 | worker 带 Dispatch ID，结束回合即挂起，邮件到达再唤醒 | 进程内消息唤醒已有；重启后上下文丢失；无持久邮件队列 | 子智能体跨重启找得回、唤得醒；重复投递不重复执行 | 不做 DAG 编排器 |
| 执行档位 | 清单声明最高权限档，超出即拒绝 | 静态扫描已分四档；是否约束执行未核实 | 分档从"扫描结论"变成"可校验的执行边界" | 不做插件 UI 分区 |
| 不变量门禁 | ratchet 基线只减不增；关键旅程必须进端到端 | 10 个 workflow 全是回归、构建、扫描 | 防止不变量被慢慢磨掉 | 不学文件行数上限 |

逐项说明为什么做、价值在哪：

**账本收敛。** Replay Ledger 已经有追加写、序号、版本号和 blob，不需要新建。缺的是"版本怎么演进"和"恢复认谁"：补上读时 upcast，让恢复锚点成为账本的投影（HA 模式保留经存储后端的锚点），崩溃恢复就只剩一个事实源。这是其余各项的地基。

**Harness 事件出口。** 接入抽象已经有了，降级不需要再抽象。缺的是一个结构化事件出口：现在外部 CLI 的回合只留下最终结果或原始字节，账本里没有它的过程，审计与回放缺一块。

**委派唤醒。** 进程内"收到消息即唤醒"已经有了。缺的是重启之后：上下文表只在内存里，重启后直接 `not_found`。补上跨重启的上下文重建、显式挂起态和幂等的持久邮件队列，子智能体才找得回、唤得醒。内核只提供这三个原语，怎么编排交给 Agent 的 skill 演化。

**执行档位。** 静态扫描已经分出四档，但分档只是扫描结论。把它接到安装与加载边界的执行约束上，"声明档与实测档不一致即拒绝"才成为可校验的边界。

**不变量门禁。** 前面四项的价值都依赖"不变量一直成立"。ratchet 让破坏不变量的改动在 CI 就失败。

## 战略定位

**一句话：内核只提供原语，流程交给 Agent。** 与既有约束一致（Agent-first、不过度设计）：框架只负责四件事——事件可升级、账本可续读、消息可唤醒、权限可校验。

三个不做：

1. **不扩产品面。** 该实现的四端并行、远程主机、云 relay、端到端加密都不碰。
2. **不搬体量。** 不学它的文件行数上限；ratchet 只锁不变量。
3. **不接管第三方。** 不托管下载 CLI，不代管账号订阅；服务条款边界没有闭环之前不碰。

## Sub Plans 拆分

本节只定每份子 plan 的标题、边界和模型选型。子 plan 正文按执行顺序逐个编写，每份在前一份验收提交之后才开始写，编写时先进 `pending/`。

### 总览

| 子 plan | 文件（待创建） | 依赖 | 闭环 | 优先级 |
|---|---|---|---|---|
| 账本收敛 | `2026-11-27-runtime-invariants-01-session-event-ledger.plan.md` | 无 | 进程被杀后换一个客户端接上，历史完整；单机重启后回合从账本恢复，未完成的工具调用不重放、确认门状态不倒退；HA 副本接管恢复与改动前一致 | P0 |
| 不变量门禁 | `2026-11-27-runtime-invariants-02-invariant-ratchet.plan.md` | 无 | 把基线调大，CI 变红 | P1（小） |
| 委派唤醒（跨重启可恢复） | `2026-11-27-runtime-invariants-03-dispatch-mailbox.plan.md` | 01 | worker 等待中、后端重启后，一封邮件把它唤醒，上下文续得上，且只执行一次 | P1 |
| Harness 事件出口 | `2026-11-27-runtime-invariants-04-harness-event-outlet.plan.md` | 01 | 一个外部 CLI 的回合结束后，账本里有它的结构化事件；能力声明与实测不一致时测试失败 | P2 |
| 执行档位 | `2026-11-27-runtime-invariants-05-extension-execution-profile.plan.md` | 无 | 声明档与实测档不一致的技能包、AGX Bundle 被拒绝；越权调用的审计记录在重启后仍能查到 | P3 |

### 逐项边界

#### 01 账本收敛

- **做什么：** 以 Replay Ledger 为唯一持久事件源。给 `RunEvent` 补读时 upcaster（已有 `schema_version` 字段，缺版本演进机制）；大载荷在事件行上只留 head、长度、摘要，全文走已有 blob 按需取；消除双轨：恢复锚点（`round_idx`、`pending_tool_calls`、`confirm_state`）改成账本的投影，不再作为第二份独立维护的状态；写明 live seq、ledger seq、总线游标三者的桥接规则。
- **不做什么：** 不新建事件总线，不给 `SessionEventHub` 另加落点；不强行统一三套编号；不向 `SessionStorageBackend` 增加 Redis append API（沿用 `2026-09-10-long-run-replay-01-event-ledger.plan.md` 的冻结决定）；不动 `agenticx/sessions/` 与 `protocols/agui.py`；文本增量不落盘；不撤掉 HA 模式下经存储后端保存的恢复锚点。
- **恢复分层：** `CheckpointStore` 经存储后端保存，HA 模式下在 Redis、跨副本可见；账本只落本地盘（`recorder.py:601`，建在 `sessions_root` 下），换一个副本读不到。单机模式恢复以账本为准；HA 模式在账本有共享后端之前，恢复仍以经 Redis 可见的锚点为准，账本只作单副本内的事件源。
- **入口：** `agenticx/studio/session_event_hub.py`、`agenticx/studio/server.py`、`agenticx/runtime/checkpoint.py`、`agenticx/runtime/replay_ledger/contracts.py`、`agenticx/runtime/replay_ledger/store.py`、`agenticx/runtime/replay_ledger/recorder.py`。
- **先核实：** 恢复锚点能否完全从账本事件投影出来（账本已记 `round_started`、tool call、tool result、`confirm_required`、`confirm_response`，见 `recorder.py:38-48`；边界情况待核实）；HA 模式下跨副本续读以谁为准；大载荷现在是否已自动转存 blob 并在行内留摘要；旧账本行缺版本号时的 upcast 路径。

#### 02 不变量门禁

- **做什么：** 一个最小 ratchet 框架——基线文件 `scripts/ci/ratchet-baseline.json`、脚本 `scripts/ci/ratchet.py`、只减不增、超出基线即失败，作为 `python-regressions` 的一个步骤。启动时落两条规则：（1）账本读取不走旁路：统计 `agenticx/` 内、`agenticx/runtime/replay_ledger/` 之外匹配 `run_dir / "events.jsonl"` 或 `runs/*/events.jsonl` 的代码行数，基线 2（`agenticx/runtime/session_perf.py:37`、`agenticx/skills/agenticx-agent-obs/scripts/diagnose_traces.py:42`）。按这两段字面精确匹配，不按文件名宽匹配：`agenticx/runtime/studio_safety.py:14,41,332` 的安全审计日志同名，不是账本旁路。（2）checkpoint 不新增落盘口：统计 `agenticx/` 内、`agenticx/studio/storage/` 之外（接口定义与实现转发：`backend.py:54,173,178`、`local_file.py:211`、`redis_backend.py:183`）的 `save_agent_state(` 调用，只允许出现在 `agenticx/runtime/checkpoint.py`，基线 0。子 plan 01、04 产出后各接一条。
- **不做什么：** 不做文件行数上限；不做 LLM 评测进 CI。
- **入口：** `scripts/ci/python-regressions.py`、`.github/workflows/python-regressions.yml`。

#### 03 委派唤醒（跨重启可恢复）

- **做什么：** 在 `SubAgentRunStore` 之上补跨重启可恢复的唤醒。进程内"收到消息即唤醒"已具备（`team_manager.send_message_to_subagent`），缺的是重启后的上下文重建、显式挂起态和幂等消费。加持久 dispatch 记录（`dispatch_id`、`task_id`、父任务、工作单元）；补显式的挂起态；`send_message_to_agent` 支持按 dispatch 寻址；邮件到达触发唤醒，唤醒事件走子 plan 01 的账本。
- **不做什么：** 不做 DAG 编排器；不改 `spawn_subagent` 的对外参数；不做跨机放置；不碰 Multica 内化 plan 面向人的 Inbox。
- **入口：** `agenticx/runtime/subagent_runs/store.py`、`resolver.py`、`agenticx/runtime/team_manager.py`、`agenticx/runtime/meta_tools.py`、`agenticx/collaboration/`。
- **先核实：** HA 模式下 run 记录留在本地盘（`store.py:36`）时，唤醒以哪一份为准；现有 automation 会不会重复触发。

#### 04 Harness 事件出口

- **做什么：** Codex 独有的"app-server 失败回退 `exec --json`"是唯一的双路径实现，不提成统一约定（其余 adapter 没有第二条路径，提了也没有消费方）。本子 plan 做两件事：给 `HarnessAdapter` 加一个向后兼容的结构化事件出口（现有 `turn()` 只返回单个 `TurnResult`）；能力声明与 spawn 时实测结果的一致性测试；adapter 的事件经该出口写入子 plan 01 的账本。
- **不做什么：** 不新增 adapter；不新增 harness 能力；控制面只做向后兼容的增量扩展（新增可选的事件出口，不改现有方法的签名与返回值），其余契约不动；不做 PTY 兜底和 transcript 历史补齐，列入"按需再做"。
- **入口：** `agenticx/harness/types.py`、`adapter.py`、`registry.py`、`adapters/*.py`。

#### 05 执行档位

- **做什么：** 技能静态扫描已有四档（`guard_classify.py:118-133`）。把分档结果接到安装与加载边界的执行约束上：声明档与实测档不一致即拒绝；执行类调用逐方法鉴权。约束接在共享的扫描结论处（`scan_skill`，`agenticx/skills/guard.py:77`），单技能安装与 AGX Bundle 安装（`agenticx/extensions/installer.py:198`）都经过它。拒绝与越权经 `agenticx/runtime/studio_safety.py` 的三路分发落盘：本地 `safety/events.jsonl` 与企业审计 outbox（`emit_action_audit`）。
- **不做什么：** 不做插件 UI；不做市场化权限体系；不改 guardrail 规则与扫描规则本身；只动安装与加载边界。
- **入口：** `agenticx/skills/guard.py`、`guard_classify.py`、`guard_engine.py`、`agenticx/skills/frontmatter.py`、`agenticx/runtime/studio_safety.py`、`agenticx/runtime/action_audit.py`。
- **先核实：** `SafetyAuditLog` 是内存环形缓冲（`agenticx/safety/audit.py:36-41`，重启即丢），只作可查询的内存记录，不作审计的持久出口。技能 frontmatter 与 bundle 清单目前都没有声明档字段，声明档放哪里由 05 定。bundle 内的 MCP server 配置怎么定档（`installer.py:301-315` 会合并进 `~/.agenticx/mcp.json`）。本地 `safety/events.jsonl` 写满 20MB 后丢弃直到轮换（`studio_safety.py:42,103-110`），越权审计要不要独立的追加文件。

### 依赖关系与波次

| 子 plan | 前置 | 说明 |
|---|---|---|
| 01 账本收敛 | 无 | |
| 02 不变量门禁 | 无 | 产出后为 01、04 的不变量接门禁，不阻塞它们 |
| 03 委派唤醒 | 01 | 唤醒事件走账本 |
| 04 Harness 事件出口 | 01 | 需要账本的写入接口 |
| 05 执行档位 | 无 | |

- 执行顺序：01 → 02 → 03 → 04 → 05，逐份串行。02 与 05 不依赖其它子 plan，为了「写一份、做一份」也不提前。

### 与相邻 plan 的职责边界

| 相邻 plan | 它负责 | 本系列不碰 |
|---|---|---|
| `2026-09-10-long-run-replay-01-event-ledger.plan.md`（及 02、03） | Replay Ledger 的数据模型、桌面回放、安全步进分支；其冻结决定：不向 `SessionStorageBackend` 增加 Redis append API，live seq 与 ledger seq 有意隔离 | 01 只补读时 upcast、大载荷摘要与 checkpoint 收敛，不改账本的数据模型 |
| `2026-08-04-ha-coordination-bus.plan.md` | HA 协调总线与副本间事件读写 | 不改总线协议；01 只写明三套游标的桥接口径 |
| `2026-05-29-live-sse-reattach-per-session-event-bus.plan.md` | 内存事件中枢、只读重连端点；其未完成的两项（前端重挂订阅、测试与灰度）仍归它 | 不改中枢的发布订阅与重放语义 |
| `2026-05-12-multica-internalization.plan.md`（状态 Drafted） | 长程任务可靠性；其 Inbox 是面向人的阻塞上报通道（该 plan 第 42 行：仅人收，agent 不收） | 03 做的是 Agent 间邮件，两者不重叠，互不取代 |
| Harness Control Surface 总体规划、对标 Harness 能力补齐规划（内部知识库） | 多 harness 控制面与能力补齐 | 04 不新增能力；控制面只做向后兼容的增量扩展，不改现有方法的签名与返回值 |
| `plans/security-governance/MASTER-PLAN.md` | 安全管线、guardrail 规则、技能扫描 | 05 只把既有分档接到执行边界；审计复用 `agenticx/runtime/studio_safety.py` 的持久出口 |
| `2026-11-17-near-plugin-package-adoption-master.plan.md` | 插件包 manifest 解析与静态安全扫描（评审意见指出与本系列 05 高度重叠） | 该文件在另一台开发机的未提交工作区；合入后、05 启动前先对齐 |
| `pending/2026-08-11-chat-history-deep-research-recovery.plan.md` | Enterprise 前台的聊天历史持久化与恢复 | 01 只管 SDK 侧账本，不动 Enterprise outbox |

### 执行约束

- 每份子 plan 的规划与实施各由独立 sub agent 完成，主会话审查 plan、验收实现；验收判据通过后才规划下一个；最终由主会话做端到端验收。
- 子 plan 01 对 HA 续读口径的核实若没有结论，03、04 暂停。
- sub agent 只拿对应单份 plan 加本 plan 对应小节；防扩散边界写在每份 plan 的 Out of scope。
- 提交前按项目既有约束做端到端真机测试，确认桌面端与移动端不回归；真机不作为本系列的闭环判据。
- 通用能力进主干；不在核心仓库新建业务 example 或业务入口。

## In scope

- 账本收敛：`agenticx/runtime/replay_ledger/` 的行契约与 upcaster、`agenticx/runtime/checkpoint.py` 的恢复路径、`agenticx/studio/server.py` 与 `agenticx/studio/session_event_hub.py` 的游标桥接。
- 委派唤醒：`agenticx/runtime/subagent_runs/`、`agenticx/runtime/team_manager.py`、`agenticx/runtime/meta_tools.py` 的消息投递。
- Harness 事件出口：`agenticx/harness/` 的类型、基类与 4 个 adapter。
- 执行档位：`agenticx/skills/guard.py`、`guard_classify.py`、`guard_engine.py`、`agenticx/skills/frontmatter.py`、`agenticx/runtime/studio_safety.py`、`agenticx/runtime/action_audit.py`。
- 不变量门禁：`scripts/ci/` 与 `python-regressions` workflow。

## Out of scope

- 不新建事件总线，不给 `SessionEventHub` 另加落点，不强行统一三套编号。
- 不新增外部 CLI adapter，不托管下载第三方 CLI，不代管账号订阅。
- 不抽象统一的 adapter 降级约定，不做 PTY 兜底与 transcript 历史补齐。
- 不做 DAG 可视化编排器，不做跨机 worker 放置，不碰面向人的 Inbox。
- 不做插件 UI 分区与市场化权限体系，不改 guardrail 与扫描规则。
- 不做文件行数上限，不做 LLM 评测进 CI。
- 不扩产品面：四端并行、远程主机、云 relay、端到端加密都不做。
- 不动 `agenticx/sessions/` 与 `agenticx/protocols/agui.py`。

## Precise landing points

| File | Action | Why |
|---|---|---|
| `agenticx/runtime/replay_ledger/contracts.py`、`store.py`、`recorder.py` | Modify | 读时 upcaster；大载荷在行内留 head、长度、摘要 |
| `agenticx/runtime/checkpoint.py` | Modify | 恢复锚点改为账本的投影；HA 模式保留经存储后端的锚点 |
| `agenticx/studio/server.py`、`agenticx/studio/session_event_hub.py` | Modify | 实现三套游标的桥接，不改各自的编号 |
| `agenticx/runtime/subagent_runs/store.py`、`resolver.py`、`agenticx/runtime/team_manager.py`、`agenticx/runtime/meta_tools.py` | Modify | 上下文跨重启重建；等待态；按 `dispatch_id` 幂等消费 |
| 持久邮件队列 | Create | 存储位置待核实（本地盘还是共享存储） |
| `agenticx/harness/adapter.py`、`types.py`、`registry.py`、`adapters/*.py` | Modify | 向后兼容的结构化事件出口；能力实测校验 |
| `agenticx/skills/guard.py`、`guard_classify.py`、`guard_engine.py`、`agenticx/skills/frontmatter.py`、`agenticx/runtime/studio_safety.py`、`agenticx/runtime/action_audit.py` | Modify | 分档接到安装与加载边界；声明与实测比对；审计走持久出口 |
| `scripts/ci/ratchet.py`、`scripts/ci/ratchet-baseline.json`、`scripts/ci/python-regressions.py`、`.github/workflows/python-regressions.yml` | Create / Modify | ratchet 框架与 CI 步骤 |

## Suggested impl models

| Sub | Work | Model |
|---|---|---|
| 01 | 账本收敛 | GLM-5.4。横跨 replay_ledger、runtime、studio 三处，契约写错后面全返工 |
| 02 | 不变量门禁 | GLM-5.4 |
| 03 | 委派唤醒 | GLM-5.4。涉及并发、幂等与重启恢复 |
| 04 | Harness 事件出口 | GLM-5.4 |
| 05 | 执行档位 | GLM-5.4。安全契约 |

规划与实施统一用 GLM-5.4，不区分档位。

## Verification

以下命令对应仓库现有的测试与脚本。本次规划没有执行它们，每份子 plan 的第一步先跑一遍确认基线为绿。命令里的 `pytest` 与 `python` 指仓库虚拟环境（如 `.venv/bin/python -m pytest`）。

1. `pytest tests/test_run_context_checkpoint.py tests/test_ha_checkpoint_resume.py -q`（子 plan 01 的基线：账本上下文检查点与崩溃恢复）
2. `pytest tests/test_smoke_session_event_hub.py -q`（子 plan 01 的基线：事件中枢）
3. `pytest tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py -q`（子 plan 03 的基线）
4. `pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py -q`（子 plan 04 的基线）
5. `python scripts/ci/python-regressions.py`（子 plan 02 的接入点）

闭环判据（SDK 层，用两个客户端直接调 HTTP 与 SSE 接口验证）：

1. **续读：** 会话进行中杀掉后端进程，客户端甲用同一会话重连，历史完整；客户端乙并发接入读到同一份历史。
2. **恢复：** 单机模式，回合进行中杀掉后端并重启，回合从账本恢复，未完成的工具调用不重放，确认门状态不倒退。HA 模式（Redis 存储后端、两个副本），副本甲被杀后副本乙接管恢复，行为与改动前一致。
3. **唤醒：** worker 等待中重启后端，协调者发一封邮件，worker 被唤醒、上下文续得上，且只执行一次。
4. **事件出口：** 一个外部 CLI 的回合结束后，账本里有它的结构化事件；能力声明与实测不一致时测试失败。
5. **档位：** 安装一个声明档与实测档不一致的技能包与一个 AGX Bundle，都被拒绝；越权调用的审计记录在重启后仍能查到。
6. **门禁：** 把基线调大，CI 失败。

不回归检查（提交前，真机）：桌面端与移动端打开同一会话，历史与实时输出与改动前一致。按项目既有约束执行，不作为本系列的闭环判据。

## 风险与回滚

- 风险：HA 模式下账本在本地盘、总线在 Redis，跨副本续读口径不清。缓解：子 plan 01 先核实再定收敛口径；没有结论则 03、04 暂停。
- 风险：HA 模式下恢复改成只读本地账本，会让副本接管失效（账本在副本本地盘，`CheckpointStore` 在 Redis）。缓解：恢复分层，HA 模式保留经存储后端的恢复锚点；`tests/test_ha_checkpoint_resume.py` 进基线。
- 风险：旧账本行没有版本号。缓解：读时按 v0 upcast，不迁移历史文件。
- 风险：事件账本写放大。缓解：结构事件全量落盘，文本增量不落盘；阈值在子 plan 01 定。
- 风险：改动 Replay Ledger 影响桌面回放与安全步进分支。缓解：不改账本数据模型，只加读时逻辑；long-run-replay 三份 plan 的现有测试进基线。
- 风险：能力声明与实际不符。缓解：一致性测试在 spawn 时实测，不只读声明。
- 风险：唤醒与现有 automation 重复触发。缓解：`dispatch_id` 作幂等键；子 plan 03 先核实现有调度面。
- 风险：档位设计过度。缓解：先接现有四档，只在安装与加载边界校验。
- 风险：ratchet 被随手调大。缓解：基线变大使 CI 直接失败，调整必须在 PR 里说明。
- 风险：范围蔓延。缓解：每份子 plan 的 Out of scope 至少三条；sub agent 只拿单份 plan。
- 回滚：各子 plan 独立提交，按 commit 回退；账本的新读路径加开关，关闭后回到现有 checkpoint 恢复路径；不迁移历史数据，所以没有数据回退。

## 待核实清单

- HA 模式下账本是否跨副本可见：已核实为否，账本建在 `sessions_root` 下（`recorder.py:601`），只落本地盘。跨副本续读以账本还是以总线为准，仍待核实；恢复这一侧已按分层处理（见 01）。
- 大载荷现在是否已自动转存 blob 并在事件行内留摘要（`payload_ref` 已具备，截断策略未见）。
- （已核实）checkpoint 现有测试的位置：`tests/test_ha_checkpoint_resume.py` 与 `tests/test_run_context_checkpoint.py`（后者已在 `scripts/ci/python-regressions.py:26` 中运行），已列入 Verification。
- 技能分档结果（T-MD / T-LITE / T-REF / T-HEAVY）当前是否参与加载与执行决策。
- 唤醒入口复用哪个现有调度面；现有 automation 是否会重复触发。
- `HarnessCapabilities` 各标志位在调用方的实际使用情况（`types.py:64` 要求调用方按标志降级）。
- `2026-11-17-near-plugin-package-adoption-master.plan.md`：评审意见指其与本系列 05 高度重叠。已澄清：文件在另一台开发机的未提交工作区；合入后、05 启动前先对齐。
- `gen-graph` 规则：已澄清，是另一台开发机的本地规则（规则目录默认不入库）。ASCII 依赖图已改为表格，无需再处理。

## 待拍板问题

1. **优先级（已定）：** 按 01 → 02 → 03 → 04 → 05 逐份串行，写一份、做一份、提交一个 commit，不并行。
2. **持久化粒度（已定）：** 结构事件全部落盘，文本增量不落盘。全量落盘可以精确回放，但写放大明显，不取。
3. **参考链接与调研产物的存放位置（已定）：** 调研产物不入库；入库的 plan 只保留结论，不保留第三方仓库链接与名称；commit 与 PR 信息同样不提。
4. **与 Multica 内化 plan 的关系：** （已撤回）该 plan 的 Inbox 是面向人的阻塞上报通道（其第 42 行：仅人收，agent 不收），与子 plan 03 的 Agent 间邮件箱不是一回事，两者不重叠，无需取代。
5. **模型（已定）：** 规划与实施统一用 GLM-5.4，不区分档位。

## Commit trailers

```text
Plan-Id: 2026-11-27-runtime-invariants-master
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-master.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```
