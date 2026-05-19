---
name: machi-code-mode-harness
overview: Machi 代码开发模式的 4 层上下文工程与 Phase Gate harness
todos:
  - id: p0-mode-preset-skeleton
    content: "P0: 引入 mode 预设字段 (code_dev / daily_office) 与 Desktop 入口按钮"
    status: completed
  - id: p0-code-outline-tool
    content: "P0: 新增 code_outline 工具 (AST 抽函数/类签名, 不返回函数体)"
    status: completed
  - id: p0-repo-skeleton-injection
    content: "P0: code_dev 模式系统提示注入 L1 仓库骨架 (目录树 + 关键入口)"
    status: completed
  - id: p0-file-read-budget
    content: "P0: code_dev 下 file_read 默认走片段, MAX_READ_CHARS 调到 8K, 鼓励 start_line/end_line"
    status: completed
  - id: p0-read-cache-scratchpad
    content: "P0: 已读文件清单写入 scratchpad, 二次读同文件优先回放摘要"
    status: completed
  - id: p0-phase-gate-prompt
    content: "P0: 系统提示注入 Explore/Read/Author 三相位约束与预算"
    status: completed
  - id: p1-phase-gate-runtime
    content: "P1: runtime 侧按相位计数与超额提醒 (软门, 不强阻断)"
    status: completed
  - id: p1-author-skeleton-first
    content: "P1: code_dev 任务约定先 file_write 骨架再分章追加, 避免一次性大输出"
    status: completed
  - id: p1-phase-aware-compaction
    content: "P1: compactor 在相位切换时定向压缩 file_read/bash_exec 原文, 保留 file_write 结果"
    status: completed
  - id: p1-task-bar-phase
    content: "P1: StickyTaskBar 显示当前相位 + 工具/读文件预算消耗"
    status: completed
  - id: p2-mode-skill-pack
    content: "P2: 配套 code_dev_workflow skill (含 explore->read->author 模板)"
    status: completed
  - id: p2-code-search-bridge
    content: "P2: code_dev 模式自动启用 code_search (依赖 2026-05-06 code_index plan)"
    status: completed
isProject: false
---

# Machi 代码开发模式：4 层上下文工程与 Phase Gate Harness

- **Plan-Id**: 2026-05-19-machi-code-mode-harness
- **Plan-File**: .cursor/plans/2026-05-19-machi-code-mode-harness.plan.md
- **Owner**: Damon Li
- **Status**: Draft
- **Last-Updated**: 2026-05-19
- **关联 plan**:
  - `.cursor/plans/2026-05-06-code-context-index-internalization.plan.md`（**底层** code_index/code_search 基础设施，本 plan 上层消费）
  - `.cursor/plans/2026-05-19-machi-task-stall-recovery.plan.md`（长任务卡住兜底，本 plan 是它的**上游预防**）
  - `.cursor/plans/2026-05-18-long-task-display-and-resilience.plan.md`（StickyTaskBar 已落地，本 plan 复用并扩展）

---

## 1. 背景与问题定义

### 1.1 现状（代码事实）

- `agenticx/cli/agent_tools.py` 中 `_tool_file_read` 默认整文件读，硬上限 `MAX_READ_CHARS = 20_000` 后简单截断；模型未被强引导走 `start_line/end_line` 片段路径。
- `_build_context_files_block`（`agenticx/runtime/prompts/meta_agent.py:366`）按用户 @ 引用注入文件正文（每条 ≤ 4K），没有「仓库骨架 / outline」级别的轻量视图。
- 没有任何工具能返回「函数/类签名清单」——模型若想了解一个模块结构，唯一路径是 `file_read` 整文件，token 开销与函数体规模成正比。
- `context_compiler` 压的是 EventLog（对话/工具事件），是溢出**续命**机制，不是**预防**机制；进入压缩阶段时代码原文已经吃过 token。
- WorkBuddy 类竞品已经把任务入口拆成「代码开发 / 日常办公」两档预设，二者对工具集 / 预算 / 提示语的需求差异很大；Machi 当前只有单一 Meta 提示。

### 1.2 用户痛点（与上一轮对话同步）

代码长任务（架构调研、跨模块重构方案、PR review）下：

1. agent 倾向多次 `file_read` 整文件 → 上下文爆炸 → compactor 触发 → 细节丢失 → 收尾时模型已经"忘了"前面读过什么。
2. 没有「我已读过这些文件」的持久视图，反复读同一批 core 文件。
3. 没有相位（Explore / Read / Author）概念，模型常在探索阶段烧完预算，最后 `file_write` 输出残缺。
4. `max_tool_rounds` 触顶 / SSE 断 / 模型超时后由 `2026-05-19-machi-task-stall-recovery` 兜底，但**根因**是上下文工程缺位，stall recovery 只能续命不能根治。

### 1.3 不解决什么（防 scope creep）

- ❌ 不重构 `agenticx/code_index/`（由 `2026-05-06-code-context-index-internalization` 负责）。
- ❌ 不动 `agent_runtime.run_turn` 主循环、`compactor` 算法（仅在 prompt 与触发时机层做相位增强）。
- ❌ 不替换 `knowledge_search` / `liteparse` / 现有 KB 流程。
- ❌ 不改群聊 `GroupChatRouter`、IM 渠道、`subagent_paused` 渲染。
- ❌ 不做 Desktop UI 大改，只在 ChatPane 输入区与 StickyTaskBar 增量增强。
- ❌ 本 plan 不引入新的远程依赖（tree-sitter Python binding 是唯一新增依赖，且已在 `2026-05-06` plan 中规划过）。

---

## 2. 设计核心：4 层上下文 + 3 相位

### 2.1 四层上下文（成本由低到高）

| 层 | 体积预算 | 何时进入 | 实现 |
|----|---------|----------|------|
| **L1 仓库骨架** | ≤ 2K token | code_dev 模式启动即注入到 system prompt | 顶层目录树（深度 = 2）+ `pyproject.toml` / `package.json` 关键字段 + 主入口（CLI / server / desktop main）路径 |
| **L2 Repo Map / Outline** | 单次 ≤ 4K token | 模型主动调 `code_outline(path?, query?)` 工具 | tree-sitter 解析返回每个文件的类/函数签名 + 一行 docstring 摘要 + 行号；**不返回函数体** |
| **L3 片段读取** | 每片段 ≤ 200 行 | 模型用 `file_read(path, start_line, end_line)` 或 `bash_exec grep -n -A` | 已有工具，新增 prompt 强引导走片段路径；`code_dev` 下整文件 `MAX_READ_CHARS` 调降到 8K |
| **L4 整文件** | 单文件 ≤ 8K char | L1–L3 不够 + 文件本身较短，且模型须显式说明理由 | 现有 `file_read` 路径，但代码模式默认告警提示 |

### 2.2 三相位（Phase Gate）

| 相位 | 主要工具 | 上下文重点 | 退出条件 |
|------|---------|-----------|---------|
| **Explore** | `bash_exec grep`、`code_outline`、`lsp_*`、`code_search` | L1 + L2 | 产出"待读文件清单"并写入 scratchpad |
| **Read & Synthesize** | `file_read(片段)`、`scratchpad_write` | L3（片段）+ scratchpad 中已读摘要 | 待读清单清空 / 关键问题已回答 |
| **Author** | `file_write` 骨架 → 分章 append | scratchpad 摘要 + outline，**不再** raw `tool_result` | 全部章节已落盘 |

**不强制阻断相位切换**（避免误判误伤），只在以下两处加软门：

- 系统提示中显式声明三相位与建议预算占比（Explore ≤ 25%，Read ≤ 50%，Author ≥ 25%）。
- runtime 计数：Explore 阶段连续 `file_read` 整文件超 N 次，向消息流注入一条 system 提示「当前在探索阶段，请先用 `code_outline` 评估再决定是否整读」。

### 2.3 与 stall-recovery / code-index 的位置关系

```
┌────────────────────────────────────────────────────────────────┐
│  本 plan：代码开发模式 harness（上层消费 + UX 预设）             │
│  - 4 层上下文调度                                                │
│  - 3 相位 + 软门                                                 │
│  - code_outline 工具（轻量 AST，独立可用）                       │
└────────────────────────────────────────────────────────────────┘
                       │ 可选启用
                       ▼
┌────────────────────────────────────────────────────────────────┐
│  2026-05-06 code-index：代码语义索引基础设施                     │
│  - agenticx/code_index/                                         │
│  - code_search 工具（hybrid + AST 切分 + Merkle 增量）           │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  2026-05-19 stall-recovery：长任务卡住兜底（已 Draft）           │
│  - execution_state 保真 / 三通道 stall / 换模型续跑              │
│  - 是本 plan 失败时的最后一道安全网                              │
└────────────────────────────────────────────────────────────────┘
```

`code_outline` 的实现**不依赖** `code_index/` 的索引基础设施，可独立先落地；如用户在设置里开启 `code_index.enabled=true`，则 `code_dev` 模式自动把 `code_search` 加入工具集（见 P2 任务）。

---

## 3. Functional Requirements

### FR-1：Mode 预设字段与 Desktop 入口（P0）

**文件**：
- `agenticx/studio/session_models.py`（新增 `mode` 字段）
- `agenticx/studio/server.py`（`POST /api/sessions` 接受 `mode`，`GET /api/session/messages` / SSE 透出）
- `desktop/src/store.ts`（pane 模型新增 `mode?: "code_dev" | "daily_office"`）
- `desktop/src/components/ChatPane.tsx`（输入区上方新增模式切换 chip 或新建会话弹层）

- **FR-1.1** `StudioSession` 新增 `mode: Literal["code_dev", "daily_office"] = "daily_office"`。`daily_office` 等价当前默认行为，零回归。
- **FR-1.2** `POST /api/sessions` 与 `POST /api/chat` payload 接受可选 `mode`；session 一旦确定 mode 即持久化到 `messages.json` 同级 metadata，不可中途切换（避免上下文混乱）。
- **FR-1.3** Desktop "新建对话"下拉菜单新增「代码开发」入口（与现有 Sparkles + GitBranch 平级），icon 为 `Code` lucide。
- **FR-1.4** ChatPane 顶栏（已有模型 pill 旁）新增模式 chip，只读显示当前 session 的 mode，不可点击切换；想切模式须新建会话。
- **FR-1.5** 历史会话面板对 `code_dev` 会话用蓝色 Code 图标标注，便于回找代码任务。

**AC-1.1** 新建 `code_dev` 会话后 `messages.json` 元数据可见 `mode: "code_dev"`，重启 Desktop 仍保留。
**AC-1.2** 旧会话（无 mode 字段）默认按 `daily_office` 渲染，零回归。
**AC-1.3** 群聊 / IM 会话不受影响（mode 字段对它们无意义）。

---

### FR-2：`code_outline` 工具（P0）

**文件**：
- `agenticx/cli/agent_tools.py`（注册 `code_outline` 到 `STUDIO_TOOLS`）
- `agenticx/runtime/code_outline.py`（**新增**，tree-sitter 解析层）
- `tests/test_smoke_code_outline.py`（新增）

- **FR-2.1** 工具签名：

```
code_outline(
  path: str,                # 文件或目录的工作区相对/绝对路径
  query: str | None = None, # 可选关键词过滤（按符号名 substring）
  max_files: int = 50,      # 目录路径时的文件数上限
  include_docstring: bool = True,
) -> {
  "files": [
    {
      "path": "agenticx/core/executor.py",
      "language": "python",
      "symbols": [
        {"kind": "class", "name": "ToolExecutor", "lineno": 42,
         "docstring": "Execute tools with restricted globals."},
        {"kind": "function", "name": "execute_code", "lineno": 259,
         "signature": "def execute_code(self, code, globals_dict=None)",
         "docstring": "Run code under sandboxed exec()."}
      ]
    }
  ],
  "truncated": false
}
```

- **FR-2.2** 语言支持首版：`python` / `typescript` / `javascript` / `go`；其他语言返回 `language: "unknown"` + 仅顶层 1–2 行 head 摘要，不抛错。
- **FR-2.3** docstring/JSDoc 提取：仅取首段（≤ 120 字符），不返回函数体。
- **FR-2.4** 路径校验复用现有 `_resolve_workspace_path`，不允许逃出 workspace；目录路径递归深度上限 4 层。
- **FR-2.5** 超出 `max_files` 时返回 `truncated: true` 并附 `next_hint`（建议缩小路径或加 `query`）。
- **FR-2.6** 工具描述里**显式告诉模型**：「优先用 outline 评估再决定是否 file_read 整文件；本工具单次返回的 token 远小于 file_read。」

**AC-2.1** 对 `agenticx/core/executor.py` 调用返回所有 class/def 签名，单次响应 ≤ 4K token。
**AC-2.2** 对 `agenticx/core/` 目录调用返回 ≤ 50 文件 outline，超出报 truncated。
**AC-2.3** 不存在/非代码路径返回明确错误，不堆栈泄漏。
**AC-2.4** smoke 测试覆盖 py/ts 两种语言至少各一个 fixture。

---

### FR-3：仓库骨架（L1）系统提示注入（P0）

**文件**：
- `agenticx/runtime/prompts/code_mode.py`（**新增**）
- `agenticx/runtime/prompts/meta_agent.py`（按 `session.mode` 切换 prompt builder）

- **FR-3.1** 新增 `_build_repo_skeleton_block(session) -> str`：
  - 优先用 `taskspaces` 中第一个工作目录（或会话绑定的工作区根）。
  - 用 `bash_exec` 等价逻辑跑 `tree -L 2 -I 'node_modules|.git|dist|.venv|__pycache__'`（或纯 Python 实现避免依赖 tree CLI）。
  - 拼上 `pyproject.toml` 的 `[project]` name/version/dependencies 前 20 行；如有 `package.json` 同理。
  - 顶部加一行「当前工作区: `<path>`」与「主入口候选: `agenticx/cli/__main__.py`, `agenticx/studio/server.py`, `desktop/electron/main.ts`」（按文件存在性筛选）。
  - 总长度限制：4K 字符截断尾部。
- **FR-3.2** `mode == "code_dev"` 时 system prompt 在 `## 当前 context_files` 之前插入 `## 仓库骨架（L1）` 区块。
- **FR-3.3** `mode == "daily_office"` 不注入此块（保持现状）。

**AC-3.1** code_dev 模式首条 system prompt 包含 tree 结构与依赖摘要。
**AC-3.2** 工作区为空时不注入空块（避免误导模型）。
**AC-3.3** 切换工作区后下一轮 system prompt 自动反映新工作区。

---

### FR-4：file_read 预算与片段引导（P0）

**文件**：
- `agenticx/cli/agent_tools.py`（按 mode 调整 `MAX_READ_CHARS`）
- `agenticx/runtime/prompts/code_mode.py`（提示词）

- **FR-4.1** 新增 `MAX_READ_CHARS_CODE_DEV = 8_000`；`_tool_file_read` 接收 `session`，按 `session.mode` 选用 limit。截断后追加「已截断，建议加 `start_line/end_line` 缩小范围」。
- **FR-4.2** code_dev 系统提示新增「读取纪律」段落，列三条：
  1. 整文件 `file_read` 仅在 outline + grep 仍无法定位时使用。
  2. 已知行号 → 用 `start_line/end_line`；未知 → 先 `bash_exec grep -n` 拿行号。
  3. 同一文件 24h 内读过且未变更 → 优先复用 scratchpad 已读摘要（见 FR-5）。
- **FR-4.3** **不**改 `daily_office` 行为（仍 20K 限）。

**AC-4.1** code_dev 下整读 `ChatPane.tsx`（6697 行）会被截断到 8K 并附引导文案。
**AC-4.2** daily_office 下相同操作仍 20K，零回归。

---

### FR-5：已读文件清单（read cache 进 scratchpad）（P0）

**文件**：
- `agenticx/cli/agent_tools.py`（`_tool_file_read` 成功后写 scratchpad）
- `agenticx/runtime/prompts/meta_agent.py`（系统提示渲染已读清单）

- **FR-5.1** `_tool_file_read` 成功路径在 session.scratchpad 写入：
  - key: `read_files::<sha1(path)[:8]>`
  - value: JSON `{"path": ..., "lines": <total>, "read_at": <ts>, "ranges": [(start, end), ...], "size_bytes": ...}`
- **FR-5.2** 系统提示新增 `## 已读文件清单（最多 30 条）` 区块，code_dev 模式下渲染（daily_office 不渲染避免噪声）：
  - 每条一行：`- agenticx/core/executor.py (lines 1-200, 700-720) · 读于 12:34`
- **FR-5.3** 同一文件多次读取时 ranges 合并（重叠区间合并，最多 5 段）。
- **FR-5.4** scratchpad 清单上限 30 条，超出 LRU 淘汰；不持久化到磁盘以外（沿用现有 scratchpad 生命周期）。

**AC-5.1** 同一会话连续读 5 个文件后，系统提示出现 5 行已读记录。
**AC-5.2** 二次读同文件 + 同范围时，模型可从已读清单看到提示并选择跳过；本 plan 不强制阻断（提示词软约束即可）。

---

### FR-6：Phase Gate 系统提示（P0）

**文件**：`agenticx/runtime/prompts/code_mode.py`

- **FR-6.1** code_dev 系统提示加 `## 工作相位（Phase Gate）` 段：
  - 显式列三相位（Explore / Read / Author）与各自允许工具集与典型产出。
  - 给出预算建议：Explore ≤ 25% 工具调用、Read ≤ 50%、Author ≥ 25%。
  - 强约束：进入 Author 之前必须已 file_write 一次「骨架文档」（占位标题清单），否则视为未完成探索。
- **FR-6.2** 提示模型每次切换相位时调用 `scratchpad_write(key="phase", value="explore|read|author")`，便于 runtime 与 UI 读取当前相位。
- **FR-6.3** 提示词中给一段**正确示例**与一段**错误示例**（错误示例：上来就 file_read 整个 core/ 目录所有文件）。

**AC-6.1** 模型在 code_dev 下首轮回复一般会先 grep / outline 而非整读文件（非确定性，靠 prompt + 示例引导）。
**AC-6.2** scratchpad 中能看到 phase 字段并随相位推进更新。

---

### FR-7：Phase-aware Compaction（P1）

**文件**：
- `agenticx/runtime/compactor.py`（不重构算法，仅加触发钩子）
- `agenticx/runtime/agent_runtime.py`（在相位切换时调用钩子）

- **FR-7.1** runtime 检测到 scratchpad `phase` 由 `read` → `author` 时，**主动**调用 compactor 一次：
  - 仅压缩 `tool_result`（来自 `file_read` / `bash_exec`）的原文，保留摘要。
  - **不**压缩 `file_write` / `scratchpad_write` 工具结果。
  - **不**压缩 user 消息。
- **FR-7.2** 该次 compaction 视为「主动收敛」而非「溢出救火」，注入的 CompactedEvent 标签为 `phase-transition` 便于审计。
- **FR-7.3** 若用户禁用 compactor（`runtime.compaction.enabled=false`）则跳过。

**AC-7.1** code_dev 长任务在 Author 阶段开始时，token 占用比未启用此机制时低 ≥ 30%（手动验证一次大任务）。
**AC-7.2** 关闭 compactor 时本机制无副作用。

---

### FR-8：Author 骨架优先（P1）

**文件**：`agenticx/runtime/prompts/code_mode.py`

- **FR-8.1** 提示词新增 Author 阶段强约束：
  1. 第一次进入 Author 必须先 `file_write` 一份骨架（仅一级标题 + 占位段落，不超过 100 行）。
  2. 之后每完成一节调用 `file_write` 替换对应章节，**严禁**最后一轮一次性 8000 字大输出。
  3. 章节落盘后必须把节标题写进 scratchpad `delivered_sections::<file>`。
- **FR-8.2** 给出标准模板（架构调研 / PR review / 重构方案 / Bug 分析四类常见任务的章节骨架），让模型可直接套用。

**AC-8.1** 大任务在网络抖动 / 模型超时下，已落盘的章节文件内容完整可恢复（不会因为最后一轮断流丢全部）。
**AC-8.2** scratchpad 中能看到 delivered_sections 列表，stall_recovery 的 resumeCurrentTask 可读取并接续未完成节。

---

### FR-9：StickyTaskBar 相位与预算可视化（P1）

**文件**：`desktop/src/components/StickyTaskBar.tsx`、`desktop/src/components/ChatPane.tsx`

- **FR-9.1** 新增可选 props：
  - `phase?: "explore" | "read" | "author"`
  - `toolBudget?: { used: number, total: number }`
  - `readFiles?: number`
- **FR-9.2** 折叠态在 todo 进度右侧追加小字：`相位: 探索 · 工具 8/60 · 已读 3 文件`（仅 code_dev 模式渲染）。
- **FR-9.3** 展开态在 todo 列表上方加一行相位徽章（三色：探索蓝 / 读取靛 / 写作青）。
- **FR-9.4** 数据来源：`phase` 取 scratchpad；`toolBudget.total` 取 `runtime.max_tool_rounds`；`used` 由 ChatPane 累计 SSE `tool_call` 事件得出；`readFiles` 取 scratchpad `read_files::*` 计数。

**AC-9.1** code_dev 任务进行中，状态条相位与 scratchpad 实际值一致，切换可见。
**AC-9.2** daily_office 任务不显示相位与预算（保持现有简洁度）。

---

### FR-10：模式 Skill Pack（P2）

**文件**：`~/.agenticx/skills/code-dev-workflow/SKILL.md`（首装时落到该路径，或随仓库内置在 `agenticx/skills/bundled/code-dev-workflow/`）

- **FR-10.1** 新增 skill `code-dev-workflow`，frontmatter 含 `requires_tools: [code_outline, file_read, bash_exec, scratchpad_write]`，按 FR-3/FR-6/FR-8 的提示词整理为完整 SKILL.md。
- **FR-10.2** 默认对 `mode=code_dev` 会话自动激活；通过分身 `skills_enabled` 可禁用。
- **FR-10.3** SKILL.md 含四类任务模板（架构调研 / PR review / 跨模块重构 / Bug 分析）。

**AC-10.1** code_dev 会话首轮工具列表里包含 skill_use 注入的 `active_skill: code-dev-workflow`。

---

### FR-11：code_search 桥接（P2）

**文件**：`agenticx/cli/agent_tools.py`（条件注册）

- **FR-11.1** 当 `~/.agenticx/config.yaml` 的 `code_index.enabled=true`（由 `2026-05-06` plan 落地）且当前 session `mode=code_dev` 时，工具集自动包含 `code_search`。
- **FR-11.2** 系统提示在 Explore 阶段优先级表里把 `code_search` 排在 `bash_exec grep` 之前（语义检索更适合架构理解）。
- **FR-11.3** `code_index.enabled=false` 时本 FR 完全无副作用，与现状一致。

**AC-11.1** 关闭 code_index 不影响其他 FR 验收。

---

## 4. Non-Functional Requirements

- **NFR-1 默认零回归**：`mode` 字段缺省走 `daily_office`；现有 Meta / 分身 / 群聊 / IM / 自动化任务行为保持。
- **NFR-2 体积预算**：code_dev 模式下首条 system prompt 增量 ≤ 6K token（L1 骨架 4K + 提示词 2K），不挤占 context window。
- **NFR-3 跨平台**：tree-sitter 解析在 macOS / Windows / Linux 三平台可加载；与 `2026-05-06` plan 共用 PyInstaller hiddenimports 配置。
- **NFR-4 失败降级**：`code_outline` 解析失败时回退到「按文件取首尾各 50 行」纯字符摘要，不抛错。
- **NFR-5 可观测**：相位切换、L1 注入、code_outline 调用次数进 `agenticx/observability/` 计数；用户在调试面板可见。
- **NFR-6 提示词中文**：所有新增 prompt 文案使用中文标点（与既有 meta_agent.py / delegation_system_prompt 风格一致）。
- **NFR-7 安全**：`code_outline` 不读不展示文件内容，仅签名/docstring；不构成新的数据外发面。

---

## 5. 实施顺序

```
P0-1  FR-1 mode 字段 + Desktop 入口（最小骨架）
       ↓ 验收：code_dev 会话可建可持久化
P0-2  FR-2 code_outline 工具 + 单测
       ↓ 验收：对自身 codebase 跑通 outline，token 量符合预算
P0-3  FR-3 L1 仓库骨架注入 + FR-4 file_read 预算
       ↓ 验收：code_dev 首轮 system prompt 含 tree，整文件读触发截断引导
P0-4  FR-5 已读清单 + FR-6 Phase Gate 提示词
       ↓ 验收：手动跑一次架构调研任务，scratchpad 可见 phase / read_files
P1-1  FR-7 phase-aware compaction（钩子接 runtime）
P1-2  FR-8 Author 骨架优先 + 模板
P1-3  FR-9 StickyTaskBar 相位/预算徽章
P2-1  FR-10 code-dev-workflow skill pack
P2-2  FR-11 code_search 桥接（依赖 2026-05-06 落地）
```

每段独立 commit，typecheck + smoke 绿后再推下一段。

---

## 6. 改动文件清单

| 阶段 | 文件 | 类型 | 预估行数 |
|------|------|------|---------|
| P0 | `agenticx/studio/session_models.py` | 改 | +20 |
| P0 | `agenticx/studio/server.py` | 改 | +60 |
| P0 | `desktop/src/store.ts` | 改 | +30 |
| P0 | `desktop/src/components/ChatPane.tsx` | 改 | +120 |
| P0 | `agenticx/runtime/code_outline.py` | 新增 | +280 |
| P0 | `agenticx/cli/agent_tools.py` | 改 | +90 |
| P0 | `agenticx/runtime/prompts/code_mode.py` | 新增 | +220 |
| P0 | `agenticx/runtime/prompts/meta_agent.py` | 改 | +40 |
| P0 | `tests/test_smoke_code_outline.py` | 新增 | +160 |
| P0 | `tests/test_smoke_code_mode_session.py` | 新增 | +120 |
| P0 | `tests/fixtures/code_outline/sample_py.py` | 新增 | +40 |
| P0 | `tests/fixtures/code_outline/sample_ts.ts` | 新增 | +30 |
| P1 | `agenticx/runtime/compactor.py` | 改 | +60 |
| P1 | `agenticx/runtime/agent_runtime.py` | 改 | +40 |
| P1 | `desktop/src/components/StickyTaskBar.tsx` | 改 | +70 |
| P1 | `tests/test_smoke_phase_aware_compaction.py` | 新增 | +110 |
| P2 | `agenticx/skills/bundled/code-dev-workflow/SKILL.md` | 新增 | +200 |
| P2 | `agenticx/cli/agent_tools.py`（code_search 条件注册） | 改 | +20 |

---

## 7. 测试策略

### 7.1 单元 / Smoke

- `test_smoke_code_outline.py`：覆盖 py / ts / unknown 三类 fixture；目录递归；query 过滤；超长 truncated；非法路径。
- `test_smoke_code_mode_session.py`：建 code_dev session → 校验 system prompt 含 L1 骨架 + Phase Gate 段；切到 daily_office session 不含。
- `test_smoke_phase_aware_compaction.py`：mock 工具流，phase 由 read → author 时压缩仅作用于 file_read tool_result。
- `test_smoke_file_read_budget.py`：mode=code_dev 下 8K 截断与文案；daily_office 下 20K。

### 7.2 手动验收（必跑）

1. **架构调研任务**（自身仓库）：在 code_dev 模式问「分析 agenticx/runtime 哪些模块可重写为 PyO3」。
   - 预期：模型先 `code_outline agenticx/runtime` → grep 热点 → 读片段 → file_write 骨架 → 分章 append；scratchpad 可见 phase 推进。
2. **PR Review**：在 code_dev 模式贴一段 git diff。
   - 预期：模型先 outline 受影响文件 → 读上下文行 → 写 review 章节。
3. **跨模式对比**：相同问题分别在 code_dev / daily_office 提问，对比 token 消耗与产出质量（人工评估）。
4. **stall recovery 联动**：code_dev 任务进入 Author 后断网 30s → stall recovery 触发 → resumeCurrentTask 应能基于 scratchpad `delivered_sections` 接续。

### 7.3 性能基线

- 在 AgenticX 自身 codebase 上：
  - `code_outline agenticx/`（递归）单次 P95 ≤ 1.5s，输出 ≤ 60K char（必要时按 max_files truncate）。
  - 对比 code_dev vs daily_office 在同一架构调研任务上的 token 消耗，目标降幅 ≥ 35%。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| tree-sitter Python binding 在 Windows / macOS arm64 加载失败 | 与 `2026-05-06` plan 共用 hiddenimports；解析失败降级到字符摘要（NFR-4） |
| L1 骨架太大挤压 context window | 4K 字符截断；用户工作区为空时不注入 |
| 模型不遵循 Phase Gate（提示词软约束） | 加正确/错误示例；FR-9 状态条可视化让用户感知偏航 |
| 已读清单 scratchpad 被 LRU 误淘汰 | 上限 30 条对单任务足够；超出说明任务已超大，应拆 |
| 模式切换混淆（用户在 daily_office 会话问代码问题） | 顶栏 chip 显示当前模式；不允许中途切；新建会话引导 |
| 与 `code_search` 工具集成的 schema 漂移 | FR-11 仅在 `code_index.enabled=true` 时生效，schema 由 `2026-05-06` plan 锁定 |
| code_outline 把私密文件的符号名泄漏 | path 校验复用 `_resolve_workspace_path`，不允许逃工作区 |

---

## 9. 与现有 plan 的边界

- **`2026-05-06-code-context-index-internalization`**：本 plan 是它的**消费方**。code_search 桥接（FR-11）是唯一耦合点，且为可选项。
- **`2026-05-19-machi-task-stall-recovery`**：本 plan 是**预防层**，stall recovery 是**兜底层**。FR-8 的 "Author 骨架优先 + 章节落盘" 让 stall recovery 的 resume 路径有真实可恢复状态。
- **`2026-05-18-long-task-display-and-resilience`**：StickyTaskBar 已落地，本 plan 仅在 FR-9 增量加 props，不动既有渲染逻辑。
- **`2026-05-11-long-horizon-goal-anchor`**：goal anchor 是任务级别的目标锚定，本 plan 是相位级别的执行骨架，二者正交。

---

## 10. Commit 计划

按 P0（共 4 段） / P1（共 3 段） / P2（共 2 段）拆，每段独立 typecheck + smoke 绿。`/commit --spec=.cursor/plans/2026-05-19-machi-code-mode-harness.plan.md` 自动注入：

```
Plan-Id: 2026-05-19-machi-code-mode-harness
Plan-File: .cursor/plans/2026-05-19-machi-code-mode-harness.plan.md
Made-with: Damon Li
```

建议消息：

1. `feat(studio): add code_dev mode field and desktop entry` (FR-1)
2. `feat(runtime): introduce code_outline tool with tree-sitter` (FR-2)
3. `feat(prompts): inject repo skeleton and tighten file_read budget for code_dev` (FR-3, FR-4)
4. `feat(runtime): persist read-files cache and phase gate prompts` (FR-5, FR-6)
5. `feat(runtime): phase-aware compaction hook` (FR-7)
6. `feat(prompts): author skeleton-first templates for code_dev` (FR-8)
7. `feat(desktop): show phase and tool budget on sticky task bar` (FR-9)
8. `feat(skills): add code-dev-workflow skill pack` (FR-10)
9. `feat(runtime): wire code_search into code_dev when index enabled` (FR-11)

---

## 11. 待用户确认事项

1. **mode 命名**：`code_dev` / `daily_office` 还是 `coding` / `general` 还是其他？默认 `daily_office`（保持兼容）即可。
2. **L1 骨架体积**：4K 字符是否合适？过大可压到 2K，过小可放到 6K。
3. **Phase Gate 强度**：本 plan 默认软约束（提示词 + UI），若需求是硬阻断（runtime 拒绝整文件 file_read 直到 outline 跑过），需另起 plan。
4. **首版语言支持**：py / ts / js / go 是否够？若要 java / rust / cpp 一并上，需评估 tree-sitter parser 包重打包成本。
5. **Skill Pack 路径**：随仓库内置（`agenticx/skills/bundled/code-dev-workflow/`）还是首启动写入 `~/.agenticx/skills/`？建议前者。

待你确认后即可启动 P0-1。




