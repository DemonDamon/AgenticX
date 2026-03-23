---
name: ""
overview: ""
todos: []
isProject: false
---

# Memory Pipeline End-to-End Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken memory write → index → recall pipeline so that user-requested memories and session-extracted facts persist across sessions and are automatically recalled.

**Architecture:** Three-layer fix: (1) implement the missing `memory_append` tool handler so Meta-Agent can explicitly write to indexed memory, (2) upgrade MemoryHook to extract richer facts, (3) add system prompt guidance to instruct Meta-Agent to use `memory_append` when users request memorization.

**Tech Stack:** Python, SQLite FTS, agenticx.runtime.meta_tools, agenticx.runtime.hooks.memory_hook, agenticx.runtime.prompts.meta_agent

---

## Diagnosis Summary


| Issue                                       | Root Cause                                                      | Impact                                                          |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `memory_append` tool defined but NO handler | `dispatch_meta_tool_async` missing `if name == "memory_append"` | Meta-Agent calls fail silently → "unknown meta tool"            |
| MemoryHook almost never writes facts        | Heuristic too crude (keyword matching only)                     | 14 days, only 1 useful fact extracted                           |
| No system prompt guidance for memory        | Meta-Agent doesn't know to use `memory_append`                  | User says "记住" → Machi writes random file outside indexed scope |
| Index not refreshed after memory_append     | Write goes to file but SQLite FTS not re-indexed                | Even correct writes invisible to recall                         |


## Key Files

- `agenticx/runtime/meta_tools.py` — tool definitions + `dispatch_meta_tool_async`
- `agenticx/runtime/hooks/memory_hook.py` — `MemoryHook` class
- `agenticx/runtime/prompts/meta_agent.py` — system prompt builder
- `agenticx/memory/workspace_memory.py` — `WorkspaceMemoryStore`
- `agenticx/workspace/loader.py` — `append_daily_memory`, `append_long_term_memory`

---

### Task 1: Implement `memory_append` handler in dispatch

**Files:**

- Modify: `agenticx/runtime/meta_tools.py` (add handler around line 1730, before `memory_search`)

**Step 1: Write the failing test**

Create `tests/test_memory_append_tool.py`:

```python
"""Test memory_append tool dispatch.

Author: Damon Li
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path


@pytest.mark.asyncio
async def test_memory_append_daily_writes_to_daily_memory():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    session = MagicMock()
    session.workspace_dir = "/tmp/test_workspace"

    with patch("agenticx.runtime.meta_tools.resolve_workspace_dir") as mock_resolve, \
         patch("agenticx.runtime.meta_tools.append_daily_memory") as mock_daily, \
         patch("agenticx.runtime.meta_tools.WorkspaceMemoryStore") as mock_store_cls:
        mock_resolve.return_value = Path("/tmp/test_workspace")
        mock_store_instance = MagicMock()
        mock_store_cls.return_value = mock_store_instance

        result = await dispatch_meta_tool_async(
            "memory_append",
            {"target": "daily", "content": "火山方舟 Coding Plan 入口在开通管理 Tab"},
            team_manager=team_manager,
            session=session,
        )
        data = json.loads(result)
        assert data["ok"] is True
        mock_daily.assert_called_once()
        mock_store_instance.index_workspace_sync.assert_called_once()


@pytest.mark.asyncio
async def test_memory_append_long_term_writes_to_memory_md():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    session = MagicMock()
    session.workspace_dir = "/tmp/test_workspace"

    with patch("agenticx.runtime.meta_tools.resolve_workspace_dir") as mock_resolve, \
         patch("agenticx.runtime.meta_tools.append_long_term_memory") as mock_lt, \
         patch("agenticx.runtime.meta_tools.WorkspaceMemoryStore") as mock_store_cls:
        mock_resolve.return_value = Path("/tmp/test_workspace")
        mock_store_instance = MagicMock()
        mock_store_cls.return_value = mock_store_instance

        result = await dispatch_meta_tool_async(
            "memory_append",
            {"target": "long_term", "content": "用户偏好: 回复简洁直接"},
            team_manager=team_manager,
            session=session,
        )
        data = json.loads(result)
        assert data["ok"] is True
        mock_lt.assert_called_once()
        mock_store_instance.index_workspace_sync.assert_called_once()


@pytest.mark.asyncio
async def test_memory_append_missing_content_returns_error():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    result = await dispatch_meta_tool_async(
        "memory_append",
        {"target": "daily", "content": ""},
        team_manager=team_manager,
        session=None,
    )
    data = json.loads(result)
    assert data["ok"] is False
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_memory_append_tool.py -v`
Expected: FAIL (handler doesn't exist, returns "unknown meta tool")

**Step 3: Implement handler**

In `agenticx/runtime/meta_tools.py`, add import at top and handler before the `memory_search` block (~line 1731):

```python
# Add to imports (around line 24):
from agenticx.workspace.loader import (
    append_daily_memory,
    append_long_term_memory,
    resolve_workspace_dir,
)
```

```python
    # Add BEFORE the `if name == "memory_search":` block:
    if name == "memory_append":
        target = str(arguments.get("target", "daily") or "daily").strip().lower()
        content = str(arguments.get("content", "")).strip()
        if not content:
            return json.dumps({"ok": False, "error": "missing content"}, ensure_ascii=False)
        workspace_dir = resolve_workspace_dir()
        if target == "long_term":
            append_long_term_memory(workspace_dir, content)
        else:
            append_daily_memory(workspace_dir, content)
        try:
            store = WorkspaceMemoryStore()
            store.index_workspace_sync(workspace_dir)
        except Exception:
            pass
        return json.dumps(
            {"ok": True, "target": target, "content": content[:200]},
            ensure_ascii=False,
        )
```

**Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_memory_append_tool.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/test_memory_append_tool.py agenticx/runtime/meta_tools.py
git commit -m "feat(memory): implement memory_append tool handler with index refresh

The memory_append tool schema was defined but had no handler in
dispatch_meta_tool_async, causing all calls to return 'unknown meta tool'.
Now writes to daily or long_term memory and re-indexes WorkspaceMemoryStore.

Made-with: Damon Li
Plan-Id: 2026-03-23-memory-pipeline-fix
Plan-File: .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md"
```

---

### Task 2: Upgrade `memory_append` tool description for richer semantics

**Files:**

- Modify: `agenticx/runtime/meta_tools.py` (lines 96-110, tool schema)

**Step 1: Update tool description**

Change the existing `memory_append` tool definition to give the LLM better guidance:

```python
    {
        "type": "function",
        "function": {
            "name": "memory_append",
            "description": (
                "Persist a fact to workspace memory so it survives across sessions. "
                "Use 'daily' for transient session outcomes; use 'long_term' for user preferences, "
                "important URLs, recurring instructions, or anything the user explicitly asks to remember. "
                "Content should be a concise, self-contained note (not raw conversation text)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "enum": ["daily", "long_term"],
                        "description": "daily = today's session log; long_term = persistent MEMORY.md anchors.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Concise fact to persist. Include key details (URLs, paths, names).",
                    },
                },
                "required": ["target", "content"],
                "additionalProperties": False,
            },
        },
    },
```

**Step 2: Commit**

```bash
git add agenticx/runtime/meta_tools.py
git commit -m "feat(memory): enrich memory_append tool description for better LLM guidance

Made-with: Damon Li
Plan-Id: 2026-03-23-memory-pipeline-fix
Plan-File: .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md"
```

---

### Task 3: Add system prompt guidance for memory persistence

**Files:**

- Modify: `agenticx/runtime/prompts/meta_agent.py` (in the system prompt string, around line 410-420)

**Step 1: Add memory usage instructions to system prompt**

Insert a new section after the "配置安全红线" block (around line 422) and before "子智能体完成后的主动汇报":

```python
        "## 记忆管理（重要）\n"
        "- 当用户说"帮我记住/记一下/remember/保存这个信息"时，**必须**调用 `memory_append(target='long_term', content='...')` 将信息写入持久记忆。\n"
        "- 禁止把用户要求记住的信息写到随意文件（如 ~/xxx.md）；所有记忆必须通过 `memory_append` 写入 workspace 索引范围内。\n"
        "- content 应是精炼的、自包含的事实（含关键 URL/路径/名称），而非原始对话文本。\n"
        "- 会话结束前，若本轮产生了重要结论或用户偏好变更，主动调用 `memory_append(target='daily', content='...')` 记录。\n"
        "- 需要回忆历史信息时，调用 `memory_search(query='...')` 查询。\n\n"
```

**Step 2: Commit**

```bash
git add agenticx/runtime/prompts/meta_agent.py
git commit -m "feat(memory): add memory management section to meta-agent system prompt

Instructs Meta-Agent to use memory_append for user memorization requests
instead of writing to arbitrary files outside the indexed workspace.

Made-with: Damon Li
Plan-Id: 2026-03-23-memory-pipeline-fix
Plan-File: .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md"
```

---

### Task 4: Improve MemoryHook fact extraction

**Files:**

- Modify: `agenticx/runtime/hooks/memory_hook.py` (method `_extract_facts_heuristic`)

**Step 1: Write the failing test**

Add to `tests/test_memory_hook_extraction.py`:

```python
"""Test MemoryHook fact extraction.

Author: Damon Li
"""
import pytest
from agenticx.runtime.hooks.memory_hook import MemoryHook


def test_extract_facts_captures_assistant_key_outcomes():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "帮我记住火山方舟的codingplan入口"},
        {"role": "assistant", "content": "好的，火山方舟 Coding Plan 入口：控制台 → 开通管理 → Coding Plan。URL: https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement"},
        {"role": "user", "content": "谢谢，记住了"},
        {"role": "assistant", "content": "已记录到长期记忆。"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) >= 1
    assert any("火山" in f or "codingplan" in f.lower() or "volcengine" in f for f in facts)


def test_extract_facts_captures_tool_results():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "查一下当前项目的测试覆盖率"},
        {"role": "assistant", "content": "当前测试覆盖率为 87.3%，共 142 个测试用例全部通过。"},
        {"role": "user", "content": "不错"},
        {"role": "assistant", "content": "覆盖率良好，建议关注 memory 模块的边界用例。"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) >= 1


def test_extract_facts_skips_short_sessions():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "你好"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) == 0
```

**Step 2: Run test to verify current heuristic fails**

Run: `python -m pytest tests/test_memory_hook_extraction.py -v`
Expected: First test FAILS (current heuristic won't capture the assistant's URL)

**Step 3: Upgrade the heuristic**

Replace `_extract_facts_heuristic` in `agenticx/runtime/hooks/memory_hook.py`:

```python
    def _extract_facts_heuristic(self, chat_history: list[dict]) -> list[str]:
        """Extract key facts from recent conversation using pattern matching."""
        facts: list[str] = []
        memory_keywords = ("记住", "记一下", "remember", "保存", "备忘", "存下来")
        outcome_keywords = ("已完成", "done", "成功", "已创建", "已配置", "已部署",
                            "覆盖率", "通过", "已修复", "已解决", "结论")
        url_pattern_kw = ("http://", "https://", "localhost:")

        for msg in chat_history[-20:]:
            role = str(msg.get("role", ""))
            content = str(msg.get("content", ""))
            if not content or len(content) < 10:
                continue

            if role == "user":
                first_line = content.split("\n")[0].strip()[:200]
                if any(kw in first_line for kw in memory_keywords):
                    facts.append(f"- 用户要求记住: {first_line}")
                elif len(content) > 30 and any(
                    kw in first_line for kw in ("请", "帮", "要", "需要", "希望", "如何", "怎么")
                ):
                    facts.append(f"- 用户请求: {first_line}")

            if role == "assistant":
                first_300 = content[:300].replace("\n", " ").strip()
                if any(kw in first_300 for kw in outcome_keywords):
                    facts.append(f"- 完成事项: {first_300[:200]}")
                elif any(kw in first_300 for kw in url_pattern_kw):
                    facts.append(f"- 关键信息: {first_300[:200]}")

        return facts[:MAX_FACTS_PER_SESSION]
```

**Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_memory_hook_extraction.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agenticx/runtime/hooks/memory_hook.py tests/test_memory_hook_extraction.py
git commit -m "feat(memory): upgrade MemoryHook heuristic to capture richer facts

Add detection for memorization requests, outcome keywords, and URLs.
Previous heuristic only matched 6 Chinese keywords + 'done/已完成'.

Made-with: Damon Li
Plan-Id: 2026-03-23-memory-pipeline-fix
Plan-File: .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md"
```

---

### Task 5: Migrate orphaned `~/volc_coding_plan_hint.md` into indexed memory

**Files:**

- N/A (one-time manual migration)

**Step 1: Append the content to MEMORY.md**

Run:

```bash
echo "" >> ~/.agenticx/workspace/MEMORY.md
echo "## 火山方舟 Coding Plan 入口" >> ~/.agenticx/workspace/MEMORY.md
echo "- 路径: 火山方舟控制台 → 开通管理 Tab → 顶部导航栏 Coding Plan" >> ~/.agenticx/workspace/MEMORY.md
echo "- URL: https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement" >> ~/.agenticx/workspace/MEMORY.md
echo "- Coding Plan Pro 已购" >> ~/.agenticx/workspace/MEMORY.md
```

**Step 2: Re-index workspace memory**

```python
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from pathlib import Path
store = WorkspaceMemoryStore()
store.index_workspace_sync(Path.home() / ".agenticx" / "workspace")
```

**Step 3: Verify recall**

```python
results = store.search_sync("火山方舟 coding plan", limit=3)
assert len(results) > 0
assert any("volcengine" in str(r.get("text", "")).lower() for r in results)
```

---

### Task 6: End-to-end verification

**Step 1: Verify tool dispatch**

```python
# In a Python session:
import asyncio, json
from unittest.mock import MagicMock
from agenticx.runtime.meta_tools import dispatch_meta_tool_async

async def verify():
    tm = MagicMock()
    result = await dispatch_meta_tool_async(
        "memory_append",
        {"target": "long_term", "content": "验证: memory_append 工具已生效"},
        team_manager=tm,
        session=None,
    )
    print(json.loads(result))

asyncio.run(verify())
```

Expected: `{"ok": true, "target": "long_term", "content": "验证: memory_append 工具已生效"}`

**Step 2: Verify memory search finds the new entry**

```python
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
store = WorkspaceMemoryStore()
results = store.search_sync("memory_append 工具已生效", limit=3)
print(results)
```

Expected: At least 1 result containing "memory_append 工具已生效"

**Step 3: Verify system prompt contains memory guidance**

```python
from unittest.mock import MagicMock
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt

session = MagicMock()
session.chat_history = []
session.context_files = {}
session.provider_name = "test"
session.model_name = "test"
session.scratchpad = {}
session.taskspaces = []
prompt = build_meta_agent_system_prompt(session)
assert "memory_append" in prompt
assert "记忆管理" in prompt
```

**Step 4: Final commit (plan file)**

```bash
git add .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md
git commit -m "docs(plan): add memory pipeline fix plan

Made-with: Damon Li
Plan-Id: 2026-03-23-memory-pipeline-fix
Plan-File: .cursor/plans/2026-03-23-memory-pipeline-fix.plan.md"
```

