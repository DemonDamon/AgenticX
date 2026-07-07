# 输入框「上下文用量」弹窗

Planned-with: Claude Sonnet 5
Suggested-Impl-Model: Claude Sonnet 5（跨栈：后端估算逻辑 + 前端弹窗 UI，中等复杂度收口）

## 背景 / 目标

用户提供了 WorkBuddy 的截图：点击输入框旁一个圆形按钮，弹出一个「上下文用量」面板，展示：
- 顶部百分比（如 `21.2%`）+ 已使用/总量（如 `已使用 35.5K / 168.0K`）
- 一条分段进度条（按类别着色）
- 5 行分类明细：系统提示词 / 工具及子智能体 / 对话消息 / 连接器及MCP / 技能，每行左侧色点 + 右侧数值（如 `~7.3K`）

目标：在 Near（Machi）Desktop 的聊天输入框区域复刻同款「上下文用量」弹窗，点击后展示当前会话的 token 用量估算与分类明细。

## 根因 / 现状调研

- Desktop 已经通过 SSE `token_usage` 事件累计 `pane.sessionTokens.input/output`（`desktop/src/store.ts:1723`、`desktop/src/components/ChatPane.tsx:8563-8585`），但这只是「输入/输出」两桶，没有按「系统提示词/工具/消息/MCP/技能」分类，且**没有任何 UI 展示这个数字**（仅存于 store，未渲染）。
- 后端没有任何按类别拆分 token 用量的能力。`agenticx/runtime/prompts/meta_agent.py` 的 `build_meta_agent_system_prompt()`（第 696 行起）内部会拼接：`_build_memory_recall_context`（记忆召回）、`_build_active_subagents_context`（活跃子智能体快照）、`_build_skills_context`（技能）、`_build_mcps_context`（MCP 列表）、`_build_context_files_block`（`@` 引用文件）等子块，但这些子块只是拼进最终字符串，没有分别导出长度。这些辅助函数都是模块级函数，签名统一为 `(session: StudioSession) -> str`（`_build_skills_context` 除外，签名为 `(skill_summaries: list) -> str`），可以在只读场景下单独调用，不需要改动 `build_meta_agent_system_prompt` 本体。
- `agenticx/studio/server.py` 中已有可复用的接入模式：
  - `managed = manager.get(session_id, touch=False)` 取会话（见 `get_session_messages`，第 1830-1852 行）；
  - `managed.studio_session` 即 `StudioSession` 实例，含 `.chat_history`、`.taskspaces`、`.mcp_hub`、`.bound_avatar_id`、`.provider_name`、`.model_name` 等字段；
  - `/api/tools/registry`（第 4487-4539 行）演示了如何拿到 `STUDIO_TOOLS` + `META_AGENT_TOOLS` 全量工具 schema。
- 没有任何地方维护「模型 context window 上限」的配置表，需要新增一个静态映射 + 默认兜底值。

**结论：不复用/不修改任何请求发送热路径代码（`sys_prompt = build_meta_agent_system_prompt(...)` 调用处，第 3019 行、第 3515 行原样不动），改为新增一个只读、按需调用的 GET 估算接口，避免任何 no-scope-creep 风险。** 用字符数 `//4` 的启发式估算 token 数（业界通用近似，前端展示时明确是"约"）。

## 方案设计

### 分类归并规则（避免重复计数）

`build_meta_agent_system_prompt` 最终返回的完整系统提示词字符串 = 基础指令文本 + 各子块拼接。为了在**不修改**该函数的前提下拆出分类，新增模块单独重新调用各子块辅助函数（只读、无副作用），并按以下规则归并为 5 类（与截图一致）：

| 展示分类 | 计算方式 |
|---|---|
| 系统提示词 | `len(full_system_prompt) - skills_chars - mcp_chars - subagents_chars - memory_chars - context_files_chars`（结果 `max(0, ...)`，即剩余的基础指令 + 会话摘要 + todo 等） |
| 工具及子智能体 | `len(json.dumps(tool_schemas, ensure_ascii=False))`（工具 schema，来自 `STUDIO_TOOLS`/`META_AGENT_TOOLS`，按 avatar/meta 过滤）+ `subagents_chars`（`_build_active_subagents_context` 结果长度） |
| 对话消息 | `sum(len(json.dumps(m, ensure_ascii=False, default=str)) for m in chat_history)` + `memory_chars`（`_build_memory_recall_context`） + `context_files_chars`（`_build_context_files_block`） |
| 连接器及MCP | `mcp_chars`（`_build_mcps_context` 结果长度，含已连接 MCP server 工具清单描述；若会话有 `mcp_hub` 已连接工具，额外加上其 tool schema 的 `json.dumps` 长度） |
| 技能 | `skills_chars`（`_build_skills_context(get_all_skill_summaries(bound_avatar_id=...))` 结果长度） |

全部 `chars` 最终统一 `tokens = max(1, chars // 4)`（如果 chars > 0）取整估算。

### Context Window 上限

新增静态映射（不追求完备，覆盖当前 AgenticX 支持的主流模型即可），按 `model_name` 子串匹配，找不到则回退默认值 `128000`：

```python
_MODEL_CONTEXT_WINDOWS: list[tuple[str, int]] = [
    ("claude-opus-4", 200_000),
    ("claude-sonnet-5", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude", 200_000),
    ("gpt-5", 256_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 128_000),
    ("o1", 200_000),
    ("o3", 200_000),
    ("deepseek", 128_000),
    ("qwen", 128_000),
    ("glm", 128_000),
    ("kimi", 256_000),
    ("minimax", 192_000),
    ("gemini-2.5", 1_048_576),
    ("gemini", 1_000_000),
]
_DEFAULT_CONTEXT_WINDOW = 128_000
```

匹配逻辑：`model_name.lower()` 依次尝试 `in` 匹配上表 key（顺序即优先级，越靠前越具体），首个命中即返回对应窗口值。

## 实施步骤

### FR-1（后端）新增只读估算模块

**新建文件** `agenticx/studio/context_usage.py`：

```python
#!/usr/bin/env python3
"""Estimate per-category context/token usage for a Studio session.

Author: Damon Li
"""

import json
from typing import Any

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import (
    _build_active_subagents_context,
    _build_context_files_block,
    _build_memory_recall_context,
    _build_mcps_context,
    _build_skills_context,
    build_meta_agent_system_prompt,
)

_MODEL_CONTEXT_WINDOWS: list[tuple[str, int]] = [
    ("claude-opus-4", 200_000),
    ("claude-sonnet-5", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude", 200_000),
    ("gpt-5", 256_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 128_000),
    ("o1", 200_000),
    ("o3", 200_000),
    ("deepseek", 128_000),
    ("qwen", 128_000),
    ("glm", 128_000),
    ("kimi", 256_000),
    ("minimax", 192_000),
    ("gemini-2.5", 1_048_576),
    ("gemini", 1_000_000),
]
_DEFAULT_CONTEXT_WINDOW = 128_000

_CHARS_PER_TOKEN = 4


def resolve_context_window(model_name: str | None) -> int:
    """Best-effort lookup of a model's context window size, by substring match."""
    name = str(model_name or "").lower()
    for key, window in _MODEL_CONTEXT_WINDOWS:
        if key in name:
            return window
    return _DEFAULT_CONTEXT_WINDOW


def _chars_to_tokens(chars: int) -> int:
    if chars <= 0:
        return 0
    return max(1, chars // _CHARS_PER_TOKEN)


def estimate_session_context_usage(managed: Any) -> dict:
    """Read-only estimate of context usage broken down into 5 categories.

    This never mutates session state and never affects the hot chat-send
    path; it independently re-invokes the same read-only prompt-building
    helper functions used when constructing the real system prompt, purely
    for estimation when the Desktop context-usage popup is opened.
    """
    session = managed.studio_session
    bound_avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None

    try:
        skill_summaries = get_all_skill_summaries(bound_avatar_id=bound_avatar_id)
    except Exception:
        skill_summaries = []

    try:
        full_system_prompt = build_meta_agent_system_prompt(
            session,
            mode="interactive",
            taskspaces=getattr(managed, "taskspaces", None) or [],
        )
    except Exception:
        full_system_prompt = ""

    def _safe_block(fn, *args) -> str:
        try:
            return fn(*args)
        except Exception:
            return ""

    skills_chars = len(_safe_block(_build_skills_context, skill_summaries))
    mcp_chars = len(_safe_block(_build_mcps_context, session))
    subagents_chars = len(_safe_block(_build_active_subagents_context, session))
    memory_chars = len(_safe_block(_build_memory_recall_context, session))
    context_files_chars = len(_safe_block(_build_context_files_block, session))

    base_system_chars = max(
        0,
        len(full_system_prompt)
        - skills_chars
        - mcp_chars
        - subagents_chars
        - memory_chars
        - context_files_chars,
    )

    is_avatar = bound_avatar_id is not None
    tool_defs = list(STUDIO_TOOLS) if is_avatar else list(META_AGENT_TOOLS)
    try:
        tools_chars = len(json.dumps(tool_defs, ensure_ascii=False, default=str))
    except Exception:
        tools_chars = 0

    chat_history = getattr(session, "chat_history", None) or []
    messages_chars = 0
    for item in chat_history:
        try:
            messages_chars += len(json.dumps(item, ensure_ascii=False, default=str))
        except Exception:
            messages_chars += len(str(item))

    hub = getattr(session, "mcp_hub", None)
    mcp_tool_chars = 0
    if hub is not None:
        try:
            hub_tools = getattr(hub, "tools", None) or []
            mcp_tool_chars = len(json.dumps(hub_tools, ensure_ascii=False, default=str))
        except Exception:
            mcp_tool_chars = 0

    categories = {
        "system_prompt": _chars_to_tokens(base_system_chars),
        "tools_and_subagents": _chars_to_tokens(tools_chars + subagents_chars),
        "messages": _chars_to_tokens(messages_chars + memory_chars + context_files_chars),
        "connectors_and_mcp": _chars_to_tokens(mcp_chars + mcp_tool_chars),
        "skills": _chars_to_tokens(skills_chars),
    }
    used_tokens = sum(categories.values())
    model_name = str(getattr(session, "model_name", "") or "")
    max_tokens = resolve_context_window(model_name)

    return {
        "used_tokens": used_tokens,
        "max_tokens": max_tokens,
        "percent": round(min(100.0, (used_tokens / max_tokens) * 100), 1) if max_tokens > 0 else 0.0,
        "categories": categories,
    }
```

**AC-1**：`from agenticx.studio.context_usage import estimate_session_context_usage, resolve_context_window` 可正常导入，无循环 import 错误（`agenticx/studio/server.py` 已经 import 了 `STUDIO_TOOLS`、`META_AGENT_TOOLS`、`meta_agent` 模块中的同名私有函数，说明这些符号在运行时可安全跨模块引用）。

### FR-2（后端）新增 GET 接口

**编辑文件** `agenticx/studio/server.py`，紧邻 `/api/session/messages`（第 1830-1852 行）之后新增一个新端点（不要改动 `get_session_messages` 函数本体，只在其后面新增）：

```python
    @app.get("/api/session/context_usage")
    async def get_session_context_usage(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        from agenticx.studio.context_usage import estimate_session_context_usage

        try:
            usage = estimate_session_context_usage(managed)
        except Exception as exc:
            logger.warning("context usage estimate failed for %s: %s", session_id, exc)
            raise HTTPException(status_code=500, detail="failed to estimate context usage")
        return {"ok": True, "session_id": session_id, **usage}
```

**AC-2**：本地起服务后，`curl "http://127.0.0.1:<port>/api/session/context_usage?session_id=<有效sid>" -H "X-Agx-Desktop-Token: <token>"` 返回 200，JSON 含 `used_tokens`/`max_tokens`/`percent`/`categories`（5 个 key）。传入不存在的 `session_id` 返回 404。

### FR-3（前端）Desktop IPC 直连 fetch（无需新增 IPC，复用现有 `apiBase`/`apiToken` 直接 fetch 即可，与 `desktop/src/components/ChatPane.tsx` 中其它 `fetch(\`${apiBase}/api/...\`)` 调用模式一致）

不新增 preload/IPC，直接在渲染进程用现有 `apiBase`、`apiToken`（`ChatPane.tsx` 组件作用域内已有这两个变量，参见第 8250 行附近 `fetch(\`${apiBase}/api/clarify\`)` 调用模式）发起请求。

### FR-4（前端）新增 UI 组件

**新建文件** `desktop/src/components/ContextUsagePopup.tsx`：

- 导出一个函数组件 `ContextUsageButton({ paneId, sessionId, apiBase, apiToken }: { paneId: string; sessionId: string; apiBase: string; apiToken: string })`。
- 渲染一个 `h-7 w-7` 圆形图标按钮（参考 `desktop/src/components/ChatPane.tsx` 第 10298-10314 行"更多"按钮的样式：`className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong"`），图标用一个简单的圆环/仪表盘 SVG（例如一个带缺口的圆，或直接用色块方块图标，参考截图左上角圆环 icon 即可，无需像素级还原）。
- 点击按钮时：
  - 若 `sessionId` 为空，不弹出（按钮可禁用态，`disabled={!sessionId}`）。
  - 切换一个 `open` 状态；`open` 从 `false -> true` 时发起 `fetch(\`${apiBase}/api/session/context_usage?session_id=${encodeURIComponent(sessionId)}\`, { headers: { "X-Agx-Desktop-Token": apiToken } })`，解析 JSON 存入 `usage` state；请求失败时 `usage` 置 `null` 且面板内显示"加载失败"文案，不崩溃。
  - 面板用 `createPortal` 挂到 `document.body`（参考本文件其它 `createPortal` 用法，如composerRefTip 第 10370-10385 行），定位基于按钮 `getBoundingClientRect()`，向上弹出（`bottom: <按钮到视口顶部距离> + 8px`，与按钮右对齐），层级 `z-[100]`。
  - 点击面板外部或按钮再次点击时关闭（用一个 `useEffect` 监听 `mousedown` 事件，参考 `PaneModelPicker` 组件已有的"点击外部关闭"实现，位置在同文件第 866-960 行附近，可直接复用同款 outside-click 逻辑模式）。
- 面板内容结构（对齐截图视觉，使用项目现有主题 token，不用硬编码颜色）：
  1. 顶部一行：标题「上下文用量」+ 右侧关闭 `✕` 按钮。
  2. 大号百分比文本：`{usage.percent}%`（`text-2xl font-semibold`），右侧灰色小字 `已使用 {formatK(usage.used_tokens)} / {formatK(usage.max_tokens)}`。
  3. 一条 `h-1.5 rounded-full` 分段进度条：5 个 `<div>` 按 `categories` 各分类 token 数占 `used_tokens` 的比例水平拼接，每段用固定调色板（系统提示词=`emerald-500`、工具及子智能体=`amber-500`、对话消息=`indigo-500`、连接器及MCP=`cyan-500`、技能=`violet-500`），若 `used_tokens` 为 0 则整条显示为 `bg-surface-hover` 空条。
  4. 5 行明细，每行：左侧色点（对应上面调色板）+ 分类中文名 + 右侧 `~{formatK(value)}`（沿用截图 `~7.3K` 格式）。
- `formatK(n: number)`：`n >= 1000 ? \`${(n / 1000).toFixed(1)}K\` : String(n)`（本地 helper 函数，写在同文件顶部）。
- 分类中文名映射（写在同文件）：
  ```ts
  const CATEGORY_LABELS: Record<string, string> = {
    system_prompt: "系统提示词",
    tools_and_subagents: "工具及子智能体",
    messages: "对话消息",
    connectors_and_mcp: "连接器及MCP",
    skills: "技能",
  };
  const CATEGORY_COLORS: Record<string, string> = {
    system_prompt: "bg-emerald-500",
    tools_and_subagents: "bg-amber-500",
    messages: "bg-indigo-500",
    connectors_and_mcp: "bg-cyan-500",
    skills: "bg-violet-500",
  };
  ```
- 面板容器样式对齐项目其它弹层（参考 `paneModelPickerPanelStyle` 附近面板的 `rounded-xl border border-border bg-surface-panel shadow-lg backdrop-blur-xl` 风格），宽度固定 `w-[300px]`，内边距 `p-4`。

**AC-3**：新文件无 TypeScript 类型错误（`ReadLints` 通过）；组件不依赖任何未导出的内部 state。

### FR-5（前端）接入输入框工具栏

**编辑文件** `desktop/src/components/ChatPane.tsx`，在第 10298-10314 行"更多"按钮**之前**插入 `<ContextUsageButton .../>`（与"更多"按钮同一个 `flex items-center` 容器内，顺序：知识库检索开关 → **上下文用量按钮（新增）** → 更多按钮）：

```tsx
<div className="flex items-center">
  <ContextUsageButton
    paneId={pane.id}
    sessionId={pane.sessionId ?? ""}
    apiBase={apiBase}
    apiToken={apiToken}
  />
</div>
```

在文件顶部 import 区新增：
```tsx
import { ContextUsageButton } from "./ContextUsagePopup";
```

**AC-4**：`npm run build`（或 `npm run dev` 热更新）后，在 Desktop 任意已有 `session_id` 的窗格输入框工具栏可见新按钮；点击后弹出面板，展示百分比与 5 行分类明细，数值随对话轮次增多而变化；点击面板外部可关闭；无 `session_id`（全新未发送过消息的窗格）时按钮为禁用态（视觉变暗，鼠标 `cursor-not-allowed`）。

## Out of scope（明确不做）

- 不追求 token 估算与真实 LLM tokenizer 完全一致（`chars // 4` 是行业通用近似启发式，与 WorkBuddy/Cursor 等客户端展示逻辑一致，允许有偏差）。
- 不改动 `build_meta_agent_system_prompt` 函数本体、不改动实际发送给 LLM 的 system prompt 拼装逻辑（第 3019 行、第 3515 行调用点原样不动）。
- 不支持群聊/多分身聚合展示（每个 pane 只展示自己 `sessionId` 对应的用量）。
- 不做历史趋势图表，只展示当前快照。
- 不新增 Electron IPC，直接走已有的 Desktop → `agx serve` HTTP 请求路径。
- 不修改 `agenticx/studio/server.py` 中 import 区块之外的敏感初始化代码（新端点函数体内部延迟 `from agenticx.studio.context_usage import ...`，不在文件顶部 import 区新增行，进一步降低触碰该文件 import 区的风险）。

## 验收清单

- [ ] AC-1：`context_usage.py` 可正常 import
- [ ] AC-2：新增 GET 接口手工 curl 验证通过（200 + 404 两种路径）
- [ ] AC-3：新组件 lint 通过
- [ ] AC-4：Desktop 端点击按钮弹出面板且数据随对话变化
- [ ] 改动 `server.py` 后按仓库强制规范跑一次 `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动 smoke test，确认 `/api/session`、`/api/avatars`、`/api/sessions` 仍返回 200
