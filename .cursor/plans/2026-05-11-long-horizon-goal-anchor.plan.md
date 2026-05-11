# Plan: 长程任务上下文管理 — 用户意图锚定（Goal Anchor）

- **Plan-Id**: 2026-05-11-long-horizon-goal-anchor
- **Owner**: Damon Li
- **Created**: 2026-05-11
- **状态**: Drafted（待 Damon review 后启动 Phase 1）
- **关联问题**：`bugs/没有按照指令实现.md`（用户在 Machi/元智能体一段三轮对话中复现）
- **同源参考**：
  - `.cursor/plans/2026-05-08-toolcall-ux-and-longrun-stability.plan.md`（FR-8/9 actionable nudge 与本 plan 的 anchor 注入路径正交互补）
  - `.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md`（长程稳定性总思路）
  - `research/codedeepresearch/openviking/openviking_proposal.md`（OpenViking L0/L1/L2 内化建议——本 plan **不依赖** L0/L1/L2 落地，是更基础、独立的修复）

---

## 1. 背景与目标

### 1.1 现象

用户在 Machi 元智能体会话里跑了一段三轮对话（完整记录见 `bugs/没有按照指令实现.md`，session id `a1a0aed2-fd87-442e-b41a-fab0909768fc`）：

| 轮次 | 用户 query 概述 | 模型最终输出 | 是否答到点 |
|---|---|---|---|
| 1 | 统计 `aibox/` 代码行数 | 给出按语言分类的行数表 | ✅ |
| 2 | 「从知识库的能力上对比 aibox 和 agenticx 哪个更厉害」 | 输出 aibox vs AgenticX 知识库架构对比表 | ✅ |
| 3 | 「**对于一个具有五十万个文档的企业级知识库来说，仅用 RAG 是否合适和足够？如果不够，针对当前 aibox 已有的知识库能力，还应该怎么做？能否参考 openviking 给出具体的技术方案**」 | 经过 12 次工具调用读 openviking 研究产物 + aibox 源码后，**最终输出再次退化为「aibox vs AgenticX 知识库架构对比表」**（与第 2 轮重复），完全没回答 50 万文档场景、RAG 是否够、参考 openviking 给方案这三个核心要求 | ❌ **答非所问** |

第 3 轮 meta 第一句 plan 实际上写得正确（`bugs/没有按照指令实现.md:630`）：「先摸清 openviking 的架构和能力，再结合 aibox 现状出方案。」**问题不出在任务理解，而出在 12 次工具调用之后模型"忘了"原始问题**。

### 1.2 根因（已在排查阶段定位完毕）

| 编号 | 根因 | 代码证据 |
|---|---|---|
| RC-1 | 每轮 LLM 请求构造的 `messages` 里**完全没有"用户意图锚"**——只有 `[system_prompt, ...compacted_history, {user: 当前 query}]`，工具循环内只追加 `assistant`/`tool` 消息，永远不会重新强化原始 query | `agenticx/runtime/agent_runtime.py:838-858`、`893-915`；全仓 `Grep user_intent\|original_query\|task_anchor\|goal_anchor\|primary_query\|user_goal` 命中 0 处 |
| RC-2 | `ContextCompactor` 的压缩 prompt 只关注「关键决策、关键工具结果、关键文件改动、当前待办与风险」，**没有强制保留用户最近一条尚未回答的原始 query** | `agenticx/runtime/compactor.py:226-244`（`_build_compaction_prompt`）；`160-224`（`_extract_session_memory` 抽取的 4 类无 `pending_user_question`） |
| RC-3 | 多轮工具调用堆积 `micro_compact_tool_result` 默认 4000 chars/工具 × 12 次 ≈ 48K chars 的 tool 输出夹在 `user(本轮 query)` 与 `assistant(最终回复)` 之间，**最近的 user query 在注意力分布里被严重稀释** | `agenticx/runtime/agent_runtime.py:1908`（注入 micro_compact）；`AGX_MICRO_COMPACT_BUDGET` 默认 4000 |
| RC-4 | `meta_agent.py` 的「执行纪律（非常重要）」整段（约 20 条规则）**没有任何一条要求"每轮调用工具前先重述用户原始 query 并自检是否仍在主线"** | `agenticx/runtime/prompts/meta_agent.py:604-624` |
| RC-5（叠加放大） | RC-2 把第 2 轮的"aibox vs agenticx 对比"作为 `key_decisions` 写入 `[session_memory]`，第 3 轮 system 摘要里就有强烈的"前序回答惯性"，把模型拽回对比模板 | `agenticx/runtime/compactor.py:182-183`（`decision_kw` 命中"决定/采用/选择/方案/结论"） |

四件事叠加导致：用户原始 query 的"信号强度"在多轮工具循环 + 压缩之后远低于"前一轮已经做过的 aibox vs agenticx 对比"，模型最终走回旧答案模板。

### 1.3 本 plan 的目标

**仅修 P0 + P1 两块最小必要的机制**，不做 scope creep：

- **P0 — 用户意图锚定（Goal Anchor）**：在 `agent_runtime` 工具循环里注入一条 ephemeral system 锚，每轮可见但不写入 `session.agent_messages`、不进入 compactor 压缩范围、不持久化到 `messages.json`；同步在 `meta_agent.py` 加一段「执行纪律」要求自检主线。
- **P1 — Compactor 升级**：`_extract_session_memory` 新增 `pending_user_question` 抽取；`_build_compaction_prompt` 强制要求摘要顶部一字不差保留最近一条用户原始问题；`compacted_message.content` 顶部固定加一行 `[user-pending-question]`。

P2（偏航检测 GoalDriftDetector）+ P3（tool_result 长度自治压缩）作为后续 plan 跟进，**本 plan 明确不动**。

---

## 2. 真实日志根因（用户对话证据）

### 2.1 第 3 轮 user query（`bugs/没有按照指令实现.md:627`）

> 对于一个具有五十万个文档的企业级知识库来说，仅用 RAG 是否合适和足够？如果不够，针对当前 aibox 已有的知识库能力，还应该怎么做？能否参考 openviking 给出具体的技术方案

### 2.2 第 3 轮 meta 第一句 plan（`bugs/没有按照指令实现.md:630`）

> 先摸清 openviking 的架构和能力，再结合 aibox 现状出方案。

任务理解 100% 正确。

### 2.3 中间 12 次工具调用（line 633-1278）

工具调用序列覆盖：
- `glob research/codedeepresearch/openviking/`、读 meta.md / openviking_agenticx_gap_analysis.md / openviking_proposal.md / openviking_source_notes.md / openviking_deepwiki.md（5 个研究产物已经在第 2 轮间接生成过）；
- `grep aibox/services/indexing/`、`shared/datastore/interface_milvus.py`、`services/retrieval/interface_retrieval.py`、各 Pipeline / Embedding / Rerank 入口；
- 大量 `bash_exec` 持续 ls / head 既有源码。

每条 tool result 在 `agenticx/runtime/agent_runtime.py:1908` 被 `micro_compact_tool_result` 压到 ≤4000 chars，但 12 条累积仍达 ~48K chars。

### 2.4 第 3 轮 meta 最终输出（line 1283-1308）

```
团长，直接上结论。

## aibox vs AgenticX 知识库架构对比

| 维度 | **aibox** | **AgenticX** |
|---|---|---|
| **代码规模** | ~57K 行 ... | ~15K 行 ... |
| **索引 Pipeline** | 16 步组合式 ... | 轻量流程 ... |
...

### 核心判断

1. **aibox 是企业级重型方案** ...
2. **AgenticX 是轻量可插拔方案** ...
```

→ **答非所问**：未提及 50 万文档场景、未给 RAG 充分性判断、未参考 openviking 给方案。

### 2.5 直接证据：当前 messages 构造逻辑无 anchor

```838:858:agenticx/runtime/agent_runtime.py
        history = _sanitize_context_messages(session.agent_messages)
        compact_model = str(getattr(session, "model_name", "") or "")
        compacted_history, did_compact, compact_summary, compacted_count = await self.compactor.maybe_compact(
            history,
            model=compact_model,
        )
        messages: List[Dict[str, Any]] = [{"role": "system", "content": current_system_prompt}]
        messages.extend(compacted_history)
        ...
        messages.append({"role": "user", "content": user_content})
```

`for round_idx in range(1, self.max_tool_rounds + 1):` 内仅追加 assistant / tool 消息，无任何 anchor 重申逻辑。

### 2.6 直接证据：compactor prompt 只看"过程"不看"目标"

```226:244:agenticx/runtime/compactor.py
    def _build_compaction_prompt(...) -> str:
        lines = [
            "请将以下对话压缩成用于后续推理的精炼上下文。",
            "必须包含：关键决策、关键工具结果、关键文件改动、当前待办与风险。",
            "输出中文，长度控制在 400 字以内，使用条目式。",
            ...
        ]
```

`_extract_session_memory` 抽取的 4 类（`files_modified` / `errors_encountered` / `key_decisions` / `tools_used_summary`）无 `pending_user_question`。

---

## 3. Functional Requirements (FR)

### Phase 1（P0：Goal Anchor 注入）

- **FR-1**：`agenticx/runtime/agent_runtime.py` 在 `run`/`stream_run`（或等价工具循环入口）接收到本轮 `user_input` 时，必须保存为 `session.current_user_intent: str`（以本轮 user query 为准；下一轮用户消息到来时被覆盖）。
  - 字段须存在于 `StudioSession` 数据模型，类型 `Optional[str]`，默认 `None`。
  - 必须可被前端通过现有 SSE / `/api/session/messages` 路径间接观测（**无需**新增专用 API；只要日志可见即可）。

- **FR-2**：在 `for round_idx in range(1, self.max_tool_rounds + 1):` 工具循环内，**每轮**调用 LLM 之前，构造一条 ephemeral `role=system` 消息 `[user-goal-anchor]`，作为 `messages` 列表的**最后一条 system**（即位于最近一条 `user` / `tool` 消息之前），格式如下：

  ```text
  [user-goal-anchor] (round {N}/{M}, tools_used_so_far={T})
  ==== 用户当前原始问题（一字不差，禁止改写）====
  {session.current_user_intent}
  ==================================
  执行纪律：
  1. 本轮所有工具调用与最终答复必须直接服务于上述问题；
  2. 若发现自己正在重复上一轮已做过的对比/分析，立即停止并直接基于已有信息产出最终方案；
  3. 工具调用累计 ≥ 5 次仍未直接回答原始问题时，停止信息收集并产出方案；
  4. 最终回复必须明确对照原始问题的每个子问题逐点作答（若有 a/b/c 子问题，回复中需对应 a/b/c）。
  ```

  - 该消息**仅存在于本轮 LLM 请求的 `messages` 数组**，不写入 `session.agent_messages`，不写入 `session.chat_history`，不进入 `compactor.maybe_compact` 输入。
  - `T` = 本轮已执行 tool calls 的累计计数（含本 round 之前的所有 round）。
  - `M` = `self.max_tool_rounds`。

- **FR-3**：FR-2 的 anchor 注入须有触发条件控制（避免对极简单一轮直答的浪费）：
  - 若本轮 `round_idx == 1` 且 `T == 0`：**仍注入**（保护"任务理解阶段"不偏航；若担心首轮 system_prompt 已经包含 user 不必重复，可将文本压缩为 ≤80 chars 的极简版「[anchor] {query}」）。
  - 若 `T >= 3` 或 `messages 总 chars >= 20_000` 或 `len(session.agent_messages) >= 8`：**强制完整版注入**（含执行纪律 4 条）。
  - 介于其间：注入精简版（仅"==== 用户当前原始问题 ====" + query 文本，省略执行纪律细则）。
  - 阈值通过环境变量可配置：`AGX_GOAL_ANCHOR_FULL_TRIGGER_TOOLS`（默认 3）、`AGX_GOAL_ANCHOR_FULL_TRIGGER_CHARS`（默认 20000）、`AGX_GOAL_ANCHOR_DISABLE`（默认 0；置 1 完全关闭，留 escape hatch）。

- **FR-4**：`agenticx/runtime/prompts/meta_agent.py` 的「执行纪律（非常重要）」节追加一条规则（约 5 行），文案对齐已有风格：

  ```
  - **任务主线自检（每轮必做）**：本会话每轮 LLM 请求都会注入一条 `[user-goal-anchor]` 系统消息，包含用户当前原始问题与执行纪律。你必须在调用工具或输出最终回复前，对照该 anchor 自检本轮工作是否仍直接服务原始问题；若已偏离（如重复上一轮已完成的对比/分析、或开始回答用户未问的相关问题），立即停止信息收集并直接产出最终方案。禁止以"已经收集了大量信息"为由输出与原始问题不对应的内容。
  ```

  必须放在「执行纪律」节内、与已有 `cc_bridge` / `spawn_subagent` 等规则同级，**不**新建独立顶级节，避免 prompt 体积膨胀。

### Phase 2（P1：Compactor 强制保留 pending user question）

- **FR-5**：`agenticx/runtime/compactor.py:_extract_session_memory` 新增一类 `pending_user_question`：
  - 反向遍历 `messages_to_compact`，找到最近一条 `role == "user"` 且其后**没有任何同源 assistant final 文本**（仅有 tool / 中间 assistant tool_call 不算回答）的消息内容；
  - 若找到则原文整段保留（**不**做 200 chars 截断，但允许设上限 ≤ 4000 chars 防极端长 query）；
  - 若找不到（典型场景：当前 batch 的 user 已被回答完毕，本次压缩仅为长度触发）则置为空字符串。
  - 抽取结果合入 `memory` dict 顶层 key `pending_user_question`。

- **FR-6**：`_build_compaction_prompt` 首条约束改为：

  ```
  请将以下对话压缩成用于后续推理的精炼上下文。
  最高优先级：必须在摘要的最顶部「一字不差」保留 `[pending_user_question]`（即用户最近一条尚未被回答的原始问题）；任何对该问题的偏离/降级回答都视为压缩失败。
  其次必须包含：关键决策、关键工具结果、关键文件改动、当前待办与风险。
  输出中文，长度控制在 400 字以内（不含 pending_user_question 原文），使用条目式。
  ```

  - `pending_user_question` 原文放在 LLM 摘要输出之前由代码硬拼到 `compacted_message.content` 顶部，**不依赖 LLM 自觉保留**（更稳健）。
  - 即：最终 `compacted_message.content` 结构为：
    ```
    [user-pending-question] {原文 query}

    [session_memory] {json}

    [compacted] 已压缩 {N} 条历史消息，以下为摘要：
    {LLM 摘要 ≤400 字}
    ```

- **FR-7**：`maybe_compact` 触发时向上层 emit 的 `RuntimeEvent.COMPACTION` 事件 `data` 字段新增可选 key `pending_question`（≤200 chars 截断版），便于前端日志面板与排障观测。**不**改变事件 `type` 或破坏性删除任何已有字段。

---

## 4. Non-Functional Requirements (NFR)

- **NFR-1**：零回归——本 plan 不改 `meta_agent.py` 已有的 active_subagents / memory_recall / kb_retrieval_block / lsp / skills / mcp 等子模块；不改 compactor 的 token 估算与窗口判断；不改 micro_compact_tool_result 行为；不改 `chat_history` / `agent_messages` 持久化逻辑。
- **NFR-2**：anchor 注入开销可控——单条 anchor 完整版预计 ≤500 chars（≤200 tokens），相对单轮请求总长（典型 10K-50K tokens）开销 < 2%；精简版 ≤120 chars。
- **NFR-3**：Anchor **绝不**写入 `session.agent_messages` / `session.chat_history` / `messages.json`；**绝不**通过 SSE `token` 事件流给前端展示（避免在用户聊天气泡里出现）；只通过现有 `RuntimeEvent.LOG` 或新增 `RuntimeEvent.GOAL_ANCHOR`（可选，但不强制）让排障可见。
- **NFR-4**：兼容历史会话——已有 session 切换回来时，`session.current_user_intent` 可能为 `None`：anchor 注入逻辑必须做空值保护，`None` 时直接跳过注入（不抛异常、不注入空 anchor）。
- **NFR-5**：兼容子智能体调用链——`agent_id != "meta"` 的子智能体路径同样会进入 `for round_idx in ...` 循环，须确保 anchor 注入对子智能体场景行为正确：
  - 子智能体的 `current_user_intent` 应为其被委派时的 `task` 字段（而非主会话 user query），由 `_run_delegation_in_avatar_session` / `spawn_subagent` 启动时写入子 session；
  - 若 `task` 字段缺失（兼容旧路径），按 NFR-4 跳过注入。
- **NFR-6**：提供 escape hatch——`AGX_GOAL_ANCHOR_DISABLE=1` 时完全关闭 anchor 注入与 compactor 的 pending_user_question 注入，回退到改动前行为，便于 A/B 对比与回滚。
- **NFR-7**：日志可观测——anchor 注入与 pending_user_question 抽取须打印结构化日志：
  - `goal_anchor_injected=true session=<id> round=<N> tools_used=<T> anchor_chars=<X> mode=<full|compact>`
  - `compactor_pending_question_kept=true session=<id> chars=<X>`

---

## 5. Acceptance Criteria (AC)

- **AC-1**（FR-1 / FR-2 / FR-3）：构造一段三轮对话复现 `bugs/没有按照指令实现.md` 场景：
  - Round 1：`统计 ./tests 目录的 .py 文件行数`；
  - Round 2：`从测试覆盖度上对比 tests/ 与 docs/`；
  - Round 3：`如果 tests/ 数量翻倍，参考 pytest 官方实践给出扩容方案`。

  期望：Round 3 模型回复必须明确对应"如果数量翻倍 + 参考 pytest 实践 + 给扩容方案"三个子问题，**不得**仅输出 tests/ vs docs/ 的对比表。可通过手工在 Machi Desktop 元智能体会话验证，并记录截图到 `bugs/` 同级目录。

- **AC-2**（FR-1）：在 `tests/test_smoke_goal_anchor.py` 写一个 fake LLM 测试：mock `LLM.invoke` 返回固定 tool call 序列（≥5 次），验证：
  - `session.current_user_intent` 在收到 user input 后立即被设置；
  - 每轮 LLM 请求 `messages` 数组的最后一条 `role=system` 消息 content 以 `[user-goal-anchor]` 开头；
  - 该 system 消息**未**出现在 `session.agent_messages` 中；
  - 该 system 消息**未**出现在 SSE `token` 事件流中。

- **AC-3**（FR-3）：相同测试场景下：
  - 当 `tools_used_so_far == 0` 时注入精简版（≤120 chars）；
  - 当 `tools_used_so_far >= 3` 或 `messages 总 chars >= 20_000` 时注入完整版（含 4 条执行纪律）；
  - 设置 `AGX_GOAL_ANCHOR_DISABLE=1` 时完全不注入。

- **AC-4**（FR-4）：`agenticx/runtime/prompts/meta_agent.py` 构造完整 system prompt 后，`grep "任务主线自检"` 必须命中且仅命中 1 次；该规则位于「执行纪律」节内（出现位置在 `执行纪律（非常重要）` 之后、`Skill 学习协议` 之前）。

- **AC-5**（FR-5 / FR-6）：在 `tests/test_smoke_compactor_pending_question.py`：
  - 构造一组 `messages_to_compact`，最后一条 user query 为 `"50 万文档企业知识库参考 openviking 出方案"`，其后只有 assistant tool calls 与 tool results（无 final assistant text）；
  - 调用 `maybe_compact(force=True)`，断言返回的 `compacted_message.content` 顶部以 `[user-pending-question] 50 万文档企业知识库参考 openviking 出方案` 开头；
  - 反例：若最后一条 user 已被同源 assistant final text 完整回答（最后一条消息是 assistant 且无 tool_calls），则 `pending_user_question` 应为空字符串，content 顶部**不**出现 `[user-pending-question]` 行。

- **AC-6**（FR-7）：相同测试场景中验证 `RuntimeEvent` 列表里能找到 `type == COMPACTION` 且 `data["pending_question"]` 截断到 ≤200 chars。

- **AC-7**（NFR-1）：原有 `tests/test_smoke_*` 全部抽样跑过不出现新红（重点：`tests/test_smoke_compactor*.py`、`tests/test_smoke_meta_agent*.py` 若存在则全绿）。

- **AC-8**（NFR-3）：在 Machi Desktop 元智能体会话手工跑一次三轮对话，浏览前端聊天列表与 `~/.agenticx/sessions/<sid>/messages.json`，确认：
  - 聊天气泡内**未**出现 `[user-goal-anchor]` / `[user-pending-question]` 字样；
  - `messages.json` 内**未**出现以这两个标记开头的 `role: "system"` 消息。

- **AC-9**（NFR-5）：跑一次 `delegate_to_avatar` / `spawn_subagent` 子智能体，确认子智能体 session 的 `current_user_intent` 设置为委派 `task` 文本，且 anchor 注入正常（结构化日志可观测）。

- **AC-10**（NFR-6）：`AGX_GOAL_ANCHOR_DISABLE=1` 启动后，重跑 AC-1 复现脚本，确认行为完全回退到改动前（含模型答非所问的失败模式仍可复现），证明 escape hatch 可用。

---

## 6. 任务清单（按 Phase 拆分）

> 提交规范：每个 Phase 的代码 commit 必须带 `Plan-Id: 2026-05-11-long-horizon-goal-anchor` trailer + `Plan-File:` trailer + `Made-with: Damon Li`，使用 `/commit --spec=.cursor/plans/2026-05-11-long-horizon-goal-anchor.plan.md` 自动注入。

### Phase 1 — Goal Anchor 注入（P0）

- [ ] **P1-T1**：在 `agenticx/cli/studio.py`（或 `StudioSession` 定义所在文件）`StudioSession` 类新增字段 `current_user_intent: Optional[str] = None`；保证 `__init__` / 序列化逻辑兼容空值；不持久化到 `messages.json`。
- [ ] **P1-T2**：在 `agenticx/runtime/agent_runtime.py` 工具循环入口（具体位置：`run` / `stream_run` 或等价方法接收 `user_input` 处，约 line 838 之前）写入 `session.current_user_intent = user_input`（仅当 `persist_user_message=True` 且 `_is_system_trigger=False`，避免 `[系统通知]` 类内部触发覆盖真实用户 query）。
- [ ] **P1-T3**：在 `agenticx/runtime/agent_runtime.py` 新增辅助函数 `_build_user_goal_anchor(session, round_idx, max_rounds, tools_used_so_far, messages_total_chars) -> Optional[Dict[str, Any]]`：
  - 返回 `{"role": "system", "content": <anchor text>}` 或 `None`；
  - 内部按 FR-3 阈值决定 full / compact / skip；
  - 读环境变量 `AGX_GOAL_ANCHOR_DISABLE` / `AGX_GOAL_ANCHOR_FULL_TRIGGER_TOOLS` / `AGX_GOAL_ANCHOR_FULL_TRIGGER_CHARS`；
  - 同步 emit 结构化日志（NFR-7）。
- [ ] **P1-T4**：在 `for round_idx in range(1, self.max_tool_rounds + 1):` 循环内（约 line 893+），调用 LLM 之前构造一份"本轮临时 messages"：以现有 `messages` 为底，**追加**（不替换）一条 anchor system 消息（位置：`messages` 末尾、紧贴最近一条 user/tool 之前——具体实现可在 `messages = [...messages, anchor]` 后传给 LLM；**绝不** `messages.append(anchor)` 修改长存数组），再传入 LLM 调用。
- [ ] **P1-T5**：兼容 `_pending_loop_nudge` 注入逻辑（已有，line 897-905）——确保 anchor 注入位置在 nudge 注入**之后**，使 anchor 永远是 messages 中最后一条 system 消息。
- [ ] **P1-T6**：在 `agenticx/runtime/prompts/meta_agent.py` 的「执行纪律（非常重要）」节末尾追加 FR-4 规则文本（5 行）；不破坏既有节标题与编号习惯。
- [ ] **P1-T7**：写 `tests/test_smoke_goal_anchor.py`：覆盖 AC-2 + AC-3，使用 `agenticx/llms` 的 mock provider 或最小 fake LLM 实现。
- [ ] **P1-T8**：本地手工冒烟（AC-1）：在 Machi Desktop 元智能体会话跑三轮对话复现脚本，记录截图到 `bugs/2026-05-11-goal-anchor-verify.md`；如能力允许，**直接复现 `bugs/没有按照指令实现.md` 中的 50 万文档 + openviking 三轮对话**对比修复前后行为。
- [ ] **P1-T9**：commit 1 — `feat(runtime): inject user goal anchor every tool round to fix long-horizon drift`，包含 P1-T1 ~ P1-T8 的代码与测试改动。

**Phase 1 验收**：AC-1 + AC-2 + AC-3 + AC-4 + AC-8 + AC-9 + AC-10 通过；NFR-1 / NFR-2 / NFR-3 / NFR-5 / NFR-6 / NFR-7 验证通过。

### Phase 2 — Compactor 升级（P1）

- [ ] **P2-T1**：修改 `agenticx/runtime/compactor.py:_extract_session_memory`：
  - 新增内部辅助 `_extract_pending_user_question(messages_to_compact: Sequence[Dict[str, Any]]) -> str`；
  - 反向扫描，规则按 FR-5 描述（"已被回答" 判定逻辑：找到最近一条 user 后，若其后所有同源消息均为 tool / 中间 tool_call assistant，且没有非空 final assistant text，则视为未回答）；
  - 抽取结果上限 4000 chars；
  - 写入 `memory["pending_user_question"]`。
- [ ] **P2-T2**：修改 `_build_compaction_prompt`：
  - 把首条「必须包含」改为 FR-6 描述的两条优先级文案；
  - 在 `memory_prefix` 已有字符串末尾追加显式 `[pending_user_question] {内容}`（如非空），让 LLM 摘要 prompt 中能看到要求保留的 query 原文。
- [ ] **P2-T3**：修改 `maybe_compact`：
  - 在拼装 `compacted_message.content` 时，按 FR-6 结构硬拼顶部 `[user-pending-question] ...`（不依赖 LLM 自觉）；
  - 修改 `RuntimeEvent.COMPACTION` 数据结构：在原有 `compacted_count` / `summary` 之外可选追加 `pending_question`（截断到 200 chars）——本步需同步检查 `events.py` 是否有 schema 严格校验。
- [ ] **P2-T4**：写 `tests/test_smoke_compactor_pending_question.py`：覆盖 AC-5 + AC-6。
- [ ] **P2-T5**：抽样跑 `pytest tests/test_smoke_compactor*.py tests/test_smoke_meta_agent*.py -v`（若存在），确保 NFR-1 不回归。
- [ ] **P2-T6**：commit 2 — `feat(compactor): keep pending user question verbatim across compaction`，包含 P2-T1 ~ P2-T5。

**Phase 2 验收**：AC-5 + AC-6 + AC-7 通过。

---

## 7. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Anchor 文本反复出现，模型对其"脱敏"（attention 习惯化），效果衰减 | 中 | 中 | FR-3 三档触发：简单场景注入精简版，复杂场景才给完整版；动态加 `(round N/M, tools_used=T)` 头部，每轮文本不完全相同；后续若发现失效，再做 P2 偏航检测 + nudge 升级 |
| Anchor 与 system_prompt 的「执行纪律」节内容重复，模型上下文冗余 | 中 | 低 | FR-4 系统提示条文只做"指引性"陈述（"会有一条 anchor 注入"），细节执行规则放在 anchor 自身，避免双写大段文本 |
| 压缩 prompt 强制保留 pending question 导致 LLM 输出占用接近 400 字上限被挤掉，反而压缩质量下降 | 中 | 中 | FR-6 把 pending_user_question 原文剥离 LLM 摘要（由代码硬拼），让 LLM 摘要的 400 字预算只用于过程总结；测试集需覆盖长 query 场景 |
| 子智能体场景下 `current_user_intent` 设置不当（误用主会话 query 或 None），引入幻觉 | 中 | 中 | NFR-5 + AC-9 强制：committed before P1-T9，需在 `_run_delegation_in_avatar_session` / `spawn_subagent` 路径明确写入；找不到 task 时跳过注入而非凑数 |
| 多窗格 / 多 session 并发时 `session.current_user_intent` 字段错误覆盖（同一 session 不同 pane 共用） | 低 | 中 | `current_user_intent` 是 `StudioSession` 单实例字段，与现有 `chat_history` 同生命周期；如未来出现 pane 级隔离需求再单独 plan，本 plan 假设 1 session = 1 用户视角 |
| 已有 session 切回时 `current_user_intent=None`，anchor 注入跳过，但用户体感"没修好" | 低 | 低 | NFR-4 已规定空值跳过；切回旧 session 后只要用户发送下一条消息即被填充；可在 P1-T8 冒烟里验证这条 |
| `RuntimeEvent.COMPACTION` 增加 `pending_question` 字段导致前端 / 下游消费方解析报错 | 低 | 低 | 新增字段为 optional，旧消费方按 dict 访问时不会报错；如需强校验，先查 `desktop/src/store.ts` 的事件类型定义再决定是否同步更新 |

**回滚策略**：

1. 每个 Phase 独立 commit；遇问题 `git revert <commit>` 单独回滚。
2. 紧急生产 escape hatch：`AGX_GOAL_ANCHOR_DISABLE=1`（NFR-6）启动后立刻回退到改动前行为，无需重启回滚 commit。
3. Phase 1 改动集中于 `agenticx/cli/studio.py`（字段定义） + `agenticx/runtime/agent_runtime.py`（注入逻辑） + `agenticx/runtime/prompts/meta_agent.py`（prompt 末尾追加）；revert 不影响 Phase 2。
4. Phase 2 改动集中于 `agenticx/runtime/compactor.py`；revert 后 compactor 行为完全回到改动前。

---

## 8. 验证与度量

- **代码层度量**：
  - `ruff check agenticx/runtime/agent_runtime.py agenticx/runtime/compactor.py agenticx/runtime/prompts/meta_agent.py agenticx/cli/studio.py` 零报错；
  - `pytest tests/test_smoke_goal_anchor.py tests/test_smoke_compactor_pending_question.py -v` 全绿；
  - 抽样 `pytest tests/test_smoke_*.py -v -k "compactor or meta_agent or runtime" --maxfail=3` 不出现新红。

- **运行时度量**（手工冒烟）：
  - 重跑 `bugs/没有按照指令实现.md` 第 3 轮 query（在新 session 里粘贴相同三轮对话），对比修复前后：
    - 第 3 轮回复是否对应"50 万文档 + RAG 是否够 + 参考 openviking 给方案"三个子问题各有一段（**应**对应）；
    - 是否仍输出"aibox vs AgenticX 对比表"（**不应**）；
    - tool 调用数是否显著减少（**应**减少：模型无需读 12 次研究产物即能产出方案）。

- **观测**：
  - `agenticx/runtime/agent_runtime.py` 每轮注入 anchor 时打印结构化日志 `goal_anchor_injected=true session=<id> round=<N> tools_used=<T> anchor_chars=<X> mode=<full|compact>`；
  - `agenticx/runtime/compactor.py` 抽取到 pending_user_question 时打印 `compactor_pending_question_kept=true session=<id> chars=<X>`；
  - 上述日志可在 `~/.agenticx/sessions/<id>/runtime.log`（如有）或 `agx serve` 控制台中筛选。

---

## 9. 不在范围（明确否决）

- **不**实现 P2 偏航检测器（GoalDriftDetector），不动 `agenticx/runtime/loop_detector.py`（该文件改动归 `.cursor/plans/2026-05-08-toolcall-ux-and-longrun-stability.plan.md` 的 FR-8/9 管，本 plan 不抢）。
- **不**实现 P3 的 tool_result 长度自治压缩（即"超过 30K 时把更早 tool 结果二次摘要化"）；该方向需独立 plan + benchmark，本 plan 不动 `micro_compact_tool_result` 的 4000 chars 默认值与算法。
- **不**触碰 OpenViking L0/L1/L2 内化（已有 `research/codedeepresearch/openviking/openviking_proposal.md` + 待落 plan）。
- **不**改 `meta_agent.py` 已有的 active_subagents / memory_recall / kb_retrieval_block / lsp / skills / mcp / avatars / todo / taskspaces / context_files / user_profile 等子模块，仅在「执行纪律」节末尾追加 1 条规则。
- **不**改 `chat_history` / `agent_messages` / `messages.json` 的持久化结构与 schema。
- **不**新增 `/api/session/goal_anchor` 等专用 API（observability 通过既有 SSE 与日志即可）。
- **不**做 Desktop 前端 UI 改动（anchor 仅供模型可见；用户聊天界面无需变化）。
- **不**改子智能体 `delegate_to_avatar` / `spawn_subagent` 的现有派发逻辑，仅在 task 字段写入 `session.current_user_intent` 这一个动作（NFR-5）。
- **不**做"用户偏好/历史 session 的全局 goal anchor 持久化"（如「这个用户偏好极简回复」级别的全局 anchor），那是用户档案系统职责。

---

## 10. 关联文件锚点

- 排查证据：
  - `bugs/没有按照指令实现.md`（用户原始三轮对话日志）
- 后端：
  - `agenticx/runtime/agent_runtime.py:838-915`（`messages` 构造与工具循环入口，FR-1/FR-2/FR-3 注入点）
  - `agenticx/runtime/agent_runtime.py:1900-1910`（`micro_compact_tool_result` 调用点，仅作根因 RC-3 引用，**不**改）
  - `agenticx/runtime/compactor.py:160-244`（`_extract_session_memory` + `_build_compaction_prompt`，FR-5/FR-6 改动点）
  - `agenticx/runtime/compactor.py:266-312`（`maybe_compact`，FR-6/FR-7 改动点）
  - `agenticx/runtime/prompts/meta_agent.py:604-624`（「执行纪律（非常重要）」节，FR-4 追加点）
  - `agenticx/cli/studio.py`（`StudioSession` 定义，P1-T1 字段新增点；具体行号以实现时为准）
  - `agenticx/runtime/meta_tools.py`（`_run_delegation_in_avatar_session` / `spawn_subagent` 子智能体 task 写入点，NFR-5 接入；具体行号以实现时为准）
- 测试：
  - `tests/test_smoke_goal_anchor.py`（**新建**，AC-2/AC-3）
  - `tests/test_smoke_compactor_pending_question.py`（**新建**，AC-5/AC-6）
- 既往同源 plan：
  - `.cursor/plans/2026-05-08-toolcall-ux-and-longrun-stability.plan.md`（Phase 3 的 `loop_detector.nudge` 与本 plan goal anchor 互为补充：anchor 防"目标遗失"，nudge 防"重复试错"，二者不冲突）
  - `.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md`（长程稳定性总思路）
  - `research/codedeepresearch/openviking/openviking_proposal.md`（L0/L1/L2 是后续独立方向，本 plan 不依赖）
