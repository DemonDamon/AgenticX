# Tool Search 延迟加载工具被拒 + 前端 ❌ 孤儿气泡修复

Planned-with: kimi-k3
Suggested-Impl-Model: grok 4.5（用户指定）

## 背景与根因（证据链，实施者无需回看对话）

**现象**：Meta 会话中，模型在回答「对比类/架构类」问题时先写衔接语再调用 `show_widget` 出 mermaid 图，工具返回
`Tool 'show_widget' schema is not loaded yet. Call tool_search and retry on the next round.`，图没出来；
且同一次失败在 UI 上出现**两次**——回复中间一张正常 ToolCallCard，回复末尾又贴一条 `❌ Tool 'show_widget' schema is not loaded yet...` 孤儿气泡。

**证据**（会话 `~/.agenticx/sessions/2f7a8803-0761-4d8a-a3c2-2678c2fb932d/`）：

- `context_stats.jsonl` 全程 `tool_search_mode=auto`、`tool_search_applied=true`、`tool_search_loaded_count=1`（仅 `web_search`），`show_widget` 从未进入 loaded 集合。
- `agent_messages.json` 最后一轮：assistant 直接发起 `show_widget` tool_call → tool 消息返回 not-loaded 错误 → assistant 没有再调 `tool_search`，直接改纯文本收尾。
- `messages.json` 中该 tool 消息带 `tool_status: "error"`，最终 assistant 正文本身**不含**错误文本——末尾的 `❌` 行是纯前端渲染产物。

**根因 1（机制冲突，必现）**：`show_widget` 在 `agenticx/runtime/tool_search.py` 的 `BUILTIN_DEFER_ALLOWLIST`（约 L107）中，tool_search auto 模式下本轮 `tools[]` 投影不带它的完整 schema；而 Meta 系统提示（`agenticx/runtime/prompts/meta_agent.py` L645-670、L899-932）与分身提示（`agenticx/studio/server.py` L3316）都**硬性要求**流程/架构/对比类回答必须调 `show_widget`。模型按提示调用 → 必撞未加载墙。

**根因 2（恢复依赖模型自觉）**：拒绝路径只返回错误文本，依赖模型下一轮主动 `tool_search` 再重试；模型完全可能（本次即如此）放弃出图继续写正文，错误卡片永久留在对话里。

**根因 3（前端重复渲染）**：后端拒绝路径对同一次失败**同时**发 `ERROR` 与 `TOOL_RESULT` 两个 SSE 事件（`agent_runtime.py` 三处 deny 分支均是）。`TOOL_RESULT` 会合并/创建工具卡（中间那张）；而 `ChatPane.tsx` 的 ERROR 分支（约 L10553-10566）只对匹配 `HOOK_BLOCK_RE` 的错误按 `tool_call_id` 合并进已有卡片，其余带 `tool_call_id` 的错误一律 `addPaneMessage(..., "❌ " + errText)` 追加孤儿气泡 → 同一失败渲染两次。

## FR-1：`show_widget` 移出延迟加载白名单（主修复）

**文件**：`agenticx/runtime/tool_search.py`

**改动**：在 `BUILTIN_DEFER_ALLOWLIST`（L65-120 的 frozenset 字面量）中**删除** `"show_widget",` 一行（约 L107，位于 `"session_search",` 与 `"skill_import_repo",` 之间）。只删这一行，不重排其他条目。

**生效机制**（无需改其他代码）：`project_tools_for_round()`（同文件 L491-497）对「非 defer 的内置工具」一律 always-load，删除后 `show_widget` 每轮自动进入 `tools[]` 投影；`tool_search_runtime.py` L90 的 `always_load` 判定同步生效。

**理由**：`show_widget` 是系统提示强制使用的核心 UX 工具，不是按需取用的长尾工具，延迟加载对它只有负收益。schema token 开销由其自身定义大小决定，可通过 `context_stats` 的 `tool_search_schema_tokens_sent` 观察，预期仅小幅上升。

**注意**：`tests/test_tool_search.py` L214 与 `tests/test_agent_runtime_tool_search.py` L51 只断言 `web_fetch` 在 defer 白名单中，不钉 `show_widget`，预期无需改测试；若有个别测试断言 `show_widget` 被 defer，按新行为修正该断言。

## FR-2：未加载工具被拒时自动热加载（self-heal，通用兜底）

**问题**：即使 FR-1 修了 `show_widget`，其余 defer 工具（含 MCP 工具）被模型直接调用时仍只能拿到一句错误文本，是否恢复全看模型自觉。

**改动点**：`agenticx/runtime/agent_runtime.py` 的「不在允许列表」拒绝分支，约 L5132-5139：

```python
if tool_name not in allowed_tool_names:
    if is_tool_pending_next_round(
        ts_ctx,
        tool_name,
        allowed_tool_names=allowed_tool_names,
        full_openai_tools=full_tool_pool,
    ):
        denied_message = TOOL_NOT_YET_LOADED_TEMPLATE.format(name=tool_name)
```

**改为**（意图伪代码，保持周围消息 append / 事件 yield 结构不变，仅替换 `denied_message` 的生成逻辑）：

```python
if tool_name not in allowed_tool_names:
    if is_tool_pending_next_round(...):  # 条件不变
        denied_message = _auto_load_deferred_tool(session, ts_ctx, tool_name)
```

新增模块级辅助函数（放在 `agent_runtime.py` 内该使用点之前，或 `tool_search.py` 中均可，倾向后者便于单测）：

```python
def auto_load_deferred_tool(session, ts_ctx, tool_name) -> str:
    """Mark a pending deferred/MCP tool loaded so next round's projection includes it.

    Returns the tool-result message telling the model to retry directly.
    Falls back to TOOL_NOT_YET_LOADED_TEMPLATE when the name is not in catalog.
    """
    descriptor = next(
        (d for d in ts_ctx.catalog.descriptors if d.name == tool_name), None
    )
    if descriptor is None:
        return TOOL_NOT_YET_LOADED_TEMPLATE.format(name=tool_name)
    thr = (
        int(ts_ctx.effective_threshold)
        if ts_ctx.effective_threshold is not None
        else int(ts_ctx.config.normalized().auto_schema_token_threshold)
    )
    max_loaded = resolve_max_loaded(
        effective_threshold=thr,
        core_schema_tokens=_estimate_core_schema_tokens(ts_ctx),
    )
    ts_ctx.state = mark_loaded(ts_ctx.state, [descriptor.stable_id], max_loaded=max_loaded)
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        scratchpad = {}
        try:
            setattr(session, "scratchpad", scratchpad)
        except Exception:
            pass
    if isinstance(scratchpad, dict):
        dump_state_to_scratchpad(scratchpad, ts_ctx.state)
    return TOOL_AUTO_LOADED_TEMPLATE.format(name=tool_name)
```

在 `tool_search.py` 新增模板（紧邻 L19-22 的 `TOOL_NOT_YET_LOADED_TEMPLATE`）：

```python
TOOL_AUTO_LOADED_TEMPLATE = (
    "Tool '{name}' schema was not loaded and has been auto-loaded. "
    "Retry the same call directly on the next round; do NOT call tool_search first."
)
```

**关键事实（已核实，实施者照用即可）**：

- `mark_loaded(state, ids, max_loaded=...)` 签名见 `tool_search.py` L307；`resolve_max_loaded` 见 L366；`_estimate_core_schema_tokens` 见 L418；`dump_state_to_scratchpad` 见 L290。`apply_search`（L638-686）是现成的同款调用序列参考。
- 运行时内 `ts_ctx.state` 的 mutation 会在**下一轮**生效：`_project_active_tools()`（`agent_runtime.py` L2979-3006）每轮重建 `ts_ctx` 并优先沿用上一轮的 in-memory `loaded_ids`（L2982-2995 注释「Re-project each round so tool_search loads take effect next round」）。scratchpad dump 参照 `agenticx/cli/agent_tools.py` `_tool_tool_search` L5255-5267 的既有写法。
- `is_tool_pending_next_round` 已保证 `tool_name` 在 catalog 中且为 defer/MCP 类（`tool_search.py` L707-731），因此 auto-load 无幻觉工具名风险；MCP 工具与内置 defer 工具走同一逻辑，投影时 MCP 由 descriptor 合成（L511-512、L519-521）。
- 若 `mark_loaded` 因 `max_loaded` 上限发生淘汰，属预期行为，不特殊处理。

## FR-3：前端 ERROR 事件按 `tool_call_id` 合并进已有工具卡，消除 ❌ 孤儿气泡

**改动 1 — `desktop/src/components/ChatPane.tsx`**，SSE `payload.type === "error"` 分支，约 L10553-10566。现状：

```ts
// Hook-blocked: merge into existing ToolCallCard to avoid duplicate bubble.
const errToolCallId = String(payload.data?.tool_call_id ?? "").trim();
if (HOOK_BLOCK_RE.test(errText) && errToolCallId) {
  const merged = updatePaneToolMessageForSession(errToolCallId, {
    content: errText,
    toolStatus: "error",
    toolResultPreview: errText.slice(0, 120),
    toolStreamLines: [],
  });
  if (!merged) {
    addPaneMessageIfSessionActive(pane.id, "tool", errText, "meta");
  }
} else {
  addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
}
```

改为：**只要带 `errToolCallId` 就先尝试合并**（合并时 content 用裸 `errText`，不加 `❌` 前缀，错误态由卡片样式表达），合并失败（无对应工具消息）才回退孤儿气泡：

```ts
const errToolCallId = String(payload.data?.tool_call_id ?? "").trim();
if (errToolCallId) {
  const merged = updatePaneToolMessageForSession(errToolCallId, {
    content: errText,
    toolStatus: "error",
    toolResultPreview: errText.slice(0, 120),
    toolStreamLines: [],
  });
  if (!merged) {
    addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
  }
} else {
  addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
}
```

（hook-block 场景被该通用分支自然覆盖；`HOOK_BLOCK_RE` 的 import 若因此 unused 则保留——L2490 的 `deriveToolStatusFromResult` 仍在用。）

**改动 2 — `desktop/src/components/ChatView.tsx`**（Lite 模式同一 bug），约 L2009-2024，做等价修改（合并函数名为 `updateMessageByToolCallId`）。

**改动 3 — 防止状态被随后的 TOOL_RESULT 覆盖回 done**：ERROR 之后紧跟的 TOOL_RESULT 会走 `deriveToolStatusFromResult`（`ChatPane.tsx` L2475-2492 / `ChatView.tsx` L273-290），而 not-loaded 错误文本不匹配 `ERROR:`/`exit_code`/hook 任何一条，会派生为 `"done"` 覆盖 FR-3 写入的 `"error"`。因此：

- 后端：`agent_runtime.py` 三处 deny 分支（无效参数约 L5076-5085、权限拒绝约 L5120-5129、不在允许列表约 L5170-5180）的 `TOOL_RESULT` 事件 data 中各加一个字段 `"is_error": True`（ERROR 事件 data 同步加，便于前端/排障识别）。三处是同一 bug 类的同一行级改动，属本 plan 范围内。
- 前端：`ChatPane.tsx` L9842 与 `ChatView.tsx` L1628 的状态派生改为：

```ts
const mergedStatus = payload.data?.is_error === true
  ? "error"
  : deriveToolStatusFromResult(payload.data?.result);
```

## In scope

- `agenticx/runtime/tool_search.py`：删 `show_widget` defer 条目；新增 `TOOL_AUTO_LOADED_TEMPLATE` 与 auto-load 辅助函数。
- `agenticx/runtime/agent_runtime.py`：not-allowed 分支接入 auto-load；三处 deny 分支的 ERROR/TOOL_RESULT 事件补 `is_error`。
- `desktop/src/components/ChatPane.tsx`、`desktop/src/components/ChatView.tsx`：ERROR 合并逻辑 + `is_error` 状态派生。
- 上述路径对应的新增/修正单测。

## Out of scope（no-scope-creep 边界）

- 不调整 tool_search 的 mode 默认值、阈值、`TOOL_SEARCH_MAX_LOADED` 等策略参数。
- 不改 Meta/分身系统提示中 `show_widget` 的既有表述。
- 不清理历史会话 `messages.json` 中已持久化的重复/错误消息（只保证新会话不再产生）。
- 不动 hook-block、预算压缩、compaction 等其他 ERROR 分支的既有行为（除共享的合并路径外）。
- 不改 MCP 连接/自动连接逻辑。

## 验收标准（AC）

- **AC-1（FR-1 单测）**：在 `tests/test_agent_runtime_tool_search.py` 新增用例——构造 tool_search applied 的 runtime context，`show_widget` 未 loaded 时，`project_tools_for_round()` 返回的 tools 中**包含** `show_widget`；同时断言 `web_fetch` 仍不在投影中（defer 行为未误伤）。
- **AC-2（FR-2 单测）**：在 `tests/test_agent_runtime_tool_search.py` 新增用例——模拟模型直接调用未加载的 defer 内置工具（如 `web_fetch`），断言：(a) 该轮 tool 结果为 `TOOL_AUTO_LOADED_TEMPLATE` 文案；(b) `ts_ctx.state.loaded_ids` 包含 `web_fetch` 的 stable_id；(c) session scratchpad 的 `__tool_search_state_v1__` 已同步；(d) 下一轮 `project_tools_for_round()` 投影包含 `web_fetch`。
- **AC-3（回归）**：`pytest tests/test_tool_search.py tests/test_agent_runtime_tool_search.py tests/test_smoke_show_widget_prompt.py tests/test_smoke_show_widget_stock_chart.py` 全绿。
- **AC-4（前端类型）**：`cd desktop && npx tsc --noEmit` 无新增错误。
- **AC-5（后端冒烟，强制）**：改动 `agent_runtime.py` 后本地冷启动 `agx serve --host 127.0.0.1 --port <临时端口>`，确认进程不崩溃且 `/api/session`、`/api/sessions` 返回 200。
- **AC-6（端到端手测）**：Desktop 新开 Meta 会话（tool_search=auto），提一个架构/对比类问题触发 `show_widget`：图正常内联渲染，全程无 `schema is not loaded` 错误、回复末尾无 `❌` 孤儿气泡。再构造一次失败路径（可临时把某 defer 工具名喂给模型直调）验证：错误只出现在工具卡内（卡片红色错误态），无第二条 `❌` 气泡。
