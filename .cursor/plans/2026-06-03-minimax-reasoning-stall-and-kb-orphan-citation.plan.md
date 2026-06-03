---
name: minimax-reasoning-stall-and-kb-orphan-citation
overview: 修复 MiniMax M2.7/M3 在 knowledge_search 后必现「已停滞/任务中断」的生产级 bug（reasoning_content 未转发），并通过 prompt 约束 + 前端剥离兜底，消除智能检索模式下模型未调工具却编造 [N] 角标的问题。
todos:
  - id: litellm-reasoning-stream
    content: LiteLLMProvider.stream_with_tools 转发 reasoning_content 为 <think> 片段
    status: completed
  - id: smoke-test-reasoning
    content: tests/test_smoke_litellm_reasoning_stream.py 回归
    status: completed
  - id: prompt-no-fake-citation
    content: meta_agent KB/引用规范禁止本轮无 references 时输出 [N]
    status: completed
  - id: strip-orphan-citation
    content: 前端 stripOrphanCitationMarkers + CitationMarkdownBody 非流式兜底
    status: completed
isProject: false
---

# MiniMax 停滞与 KB 假角标修复

> Plan-Id: 2026-06-03-minimax-reasoning-stall-and-kb-orphan-citation  
> Plan-File: `.cursor/plans/2026-06-03-minimax-reasoning-stall-and-kb-orphan-citation.plan.md`  
> 关联：`2026-06-02-kb-citation-ima-style`（角标 UI；本 plan 解决 stall 与假角标行为）

## 背景

用户 query「查下知识库关于AI网关内容」、智能检索模式：

1. **MiniMax M2.7/M3**：`knowledge_search` 约 2.2s 成功后，第二轮 LLM 在思考阶段 UI 显示「已停滞」并弹出中断卡片。
2. **部分模型**：不展示 `knowledge_search` 工具过程，正文仍出现纯文本 `[1][2][3]`，无 `ReferencesCard` / 绿色 pill。

## 根因

### P0 — MiniMax 停滞

`LiteLLMProvider.stream_with_tools` 仅转发 `delta.content`，丢弃 `delta.reasoning_content`。MiniMax reasoning 模型在 tool 后一轮先长时间流式思考再出正文 → 后端零 TOKEN → `agent_runtime` idle 超时 + 前端静默计时 → 「已停滞」。

Kimi provider 已有同类修复（`kimi_provider.py`），MiniMax 走基类未覆盖。

### P1 — 假角标

智能检索(auto) 下用户重试同一问题时，模型复用上一轮记忆、本轮不调 `knowledge_search`，仍输出 `[N]`。本轮 `references` 为空 → `CitationMarkdownBody` 无法渲染 pill，仅显示纯文本角标。

## 方案（用户选定 A）

| 项 | 改动 |
|----|------|
| FR-1 | `litellm_provider.stream_with_tools` 包裹并转发 `reasoning_content` |
| FR-2 | `meta_agent` KB 块 + 引用规范：本轮无 tool/references 禁止 `[N]` |
| FR-3 | `stripOrphanCitationMarkers`；已完成消息且无 references 时剥离游离角标；流式不剥 |

## 验收

- AC-1：MiniMax M2.7/M3，KB 查询 tool 后可见 Thinking 流式，不再 15s 误报停滞/中断。
- AC-2：本轮无 `knowledge_search` 且无 references 的 committed 消息，正文不出现 `[1][2]` 纯文本。
- AC-3：`tests/test_smoke_litellm_reasoning_stream.py` 与 `citation-normalize.test.ts` 通过。

## 范围外

- 不强制 auto 模式下每次「查知识库」都调用 tool（用户未选 B）。
- 不修改 `CitationBadge` ima 视觉（见 `2026-06-02-kb-citation-ima-style` 未完成落盘部分）。
