---
name: kb-always-force-first-round-toolcall
overview: KB「始终检索」模式下首轮强制 knowledge_search，修复弱 FC 模型（qwen-plus）不发 tool_calls、无工具条的问题。
todos:
  - id: runtime-force-tool-choice
    content: agent_runtime 首轮 tool_choice 强制 knowledge_search（always + 非 minimax）
    status: completed
  - id: smoke-test
    content: test_smoke_kb_force_first_round 覆盖 _kb_retrieval_always_mode
    status: completed
  - id: verify-qwen-plus
    content: Near + agx serve 重启后 qwen-plus 可见 knowledge_search 工具调用
    status: completed
isProject: false
---

# KB「始终检索(always)」首轮强制 knowledge_search 工具调用

## 验收（2026-06-03）

- 用户确认：阿里云百炼 `qwen-plus`、KB 检索模式 `always`，提问「查下知识库关于 AI 网关内容」后**可看到工具调用过程**（`knowledge_search` 工具条正常出现）。
- 实现 commit：`724e6560`（`agent_runtime.py` + `tests/test_smoke_kb_force_first_round.py`）。
- 前置依赖：需 ⌘Q 重启 Near 使内嵌 `agx serve` 加载新 runtime；与 `3a3922c8`（工具卡流式实时插入）叠加生效。

## 背景 / 根因（已核实）

弱 function-calling 模型（如 `qwen-plus`）在 KB 问答时常**不发 `tool_calls`**，
而是在正文里「口述检索结果」：

- 无 `tool_calls` → 无 `role:tool` 消息 → 不展示「本次调用 · knowledge_search」工具条；
- 未真正执行 `knowledge_search` → 无 `references` → 角标无法渲染（或被 strip）。

已核实事实：
- `agent_runtime.py` 两处把 `tool_choice` **写死 `"auto"`**（流式 ~1361 / fallback ~1602）。
- KB `always` 模式当前**只在系统提示词里写「优先调用」，无代码强制**（grep 确认）。
- 百炼 native 路径（`bailian_provider._stream_with_tools_native`）通过 `**kwargs`
  透传 `tool_choice` 与 `tools`，可对 qwen-plus 强制指定工具（OpenAI 兼容格式）。

## 方案（P0，最小、不分模型、不漂移）

仅当满足以下全部条件时，把**首轮**的 `tool_choice` 由 `"auto"` 改为强制
`{"type":"function","function":{"name":"knowledge_search"}}`：

1. KB 有效检索模式为 `always`（session 覆盖优先，回退 KB config）；
2. `round_idx == 1`（只强制首轮，后续轮恢复 auto）；
3. `knowledge_search` 在本会话可用工具集中；
4. provider ≠ `minimax`（MiniMax 已有 tool_choice/温度的特殊降级路径，排除以免冲突）。

语义：`always` = 回答前必检索，强制工具调用与该语义一致；对已正常的模型
（kimi/glm/qwen3.6）只是把「本来就会调」变成「确定性调用」，无副作用。

## 不做（避免漂移）

- 不维护「弱 FC 模型列表」、不做 `auto` 模式下的意图检测强制（列为 P1，另开 plan）。
- 不改 UI 角标/工具条渲染（kimi 已验证链路正常）。
- 不改 MiniMax 分支与非流式重试逻辑。

## 改动点

- `agenticx/runtime/agent_runtime.py`
  - 新增模块级常量 `_KB_FORCED_TOOL_CHOICE` 与 helper `_kb_retrieval_always_mode(session)`。
  - 循环外计算 `_kb_force_always`（always 且 knowledge_search 可用）。
  - 流式 `stream_kwargs["tool_choice"]` 与 fallback `tool_choice=` 两处改为条件表达式。
- `tests/test_smoke_kb_force_first_round.py`
  - 纯函数测试 `_kb_retrieval_always_mode`（session 覆盖 always/auto/缺省）。

## Requirements
- FR-1: KB always 模式下首轮对 knowledge_search 强制 tool_choice（非 minimax）
- FR-2: 仅首轮强制，后续轮恢复 auto，不影响多轮工具链
- AC-1: qwen-plus 在 always 模式下产生真实 tool_calls → 工具条 + references 角标可见
- AC-2: 已正常模型（kimi/glm/qwen3.6/minimax）行为不回退

Plan-Id: 2026-06-03-kb-always-force-first-round-toolcall
