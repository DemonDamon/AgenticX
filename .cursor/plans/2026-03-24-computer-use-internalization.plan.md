---
name: ""
overview: ""
todos: []
isProject: false
---

# Computer Use 能力内化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Anthropic Claude "Computer Use" 升级中的核心架构思想内化到 AgenticX，使其具备工具降级链、分层权限模型、桌面级屏幕操控和后台任务调度能力。

**Architecture:** 采用渐进式分层架构：在现有 `STUDIO_TOOLS` + `dispatch_tool_async` 主路径上增加 Tool Fallback Chain 编排层；扩展 `embodiment/tools/adapters.py` 加入 `DesktopPlatformAdapter`（pyauto.gui/Accessibility API）；增强 `ToolPolicyStack` 为分类级权限模型；在 `meta_tools.py` 中增加 `schedule_task` 后台任务调度能力。

**Tech Stack:** Python 3.11+, pyautogui (可选依赖), Playwright, Pydantic v2, asyncio

**背景信息（Claude Computer Use 2026.03 升级摘要）：**

Anthropic 在 2026 年 3 月发布了 Claude "Computer Use" 研究预览，核心能力：

1. **工具降级链**：优先用精确 API connector → 次之浏览器自动化 → 最后截图+鼠标键盘屏幕操控
2. **桌面操控**：截屏、鼠标点击/滚动、键盘输入，可操作任意 macOS 应用
3. **分层权限**：操作前征求许可、应用白名单/黑名单、敏感类别默认禁止、异常行为监控
4. **Dispatch**：跨设备持续对话（手机→电脑）、后台任务执行、定时任务
5. **安全防护**：多层防护（提示词注入扫描、模型激活状态监测、随时中断）

**现有 AgenticX 基础设施：**

- `agenticx/embodiment/tools/`: `BasePlatformAdapter` ABC + `WebPlatformAdapter` (Playwright) + `ClickTool`/`TypeTool`/`ScrollTool`/`ScreenshotTool`/`GetElementTreeTool`/`WaitTool`/`GetScreenStateTool`
- `agenticx/cli/agent_tools.py`: `STUDIO_TOOLS` 列表 + `dispatch_tool_async()` 分支路由
- `agenticx/tools/policy.py`: `ToolPolicyStack` + `ToolPolicyLayer` (OpenClaw 6-layer)
- `agenticx/tools/executor.py`: `ToolExecutor` (支持 policy_stack + safety_layer + 沙箱)
- `agenticx/runtime/confirm.py`: `ConfirmGate` (Sync/Async/AutoApprove)
- `agenticx/runtime/meta_tools.py`: Meta-Agent 工具分发 + `spawn_subagent` / `delegate_to_avatar`
- `agenticx/sandbox/`: 多后端沙箱 (subprocess/docker/remote)

---

## Phase 1: 工具降级链（Tool Fallback Chain）

### Task 1.1: 定义 ToolFallbackChain 核心抽象

**Files:**

- Create: `agenticx/tools/fallback_chain.py`
- Test: `tests/tools/test_fallback_chain.py`

**设计说明：**

工具降级链是本次内化的核心架构抽象。当 Agent 需要完成一个"操作性"任务（如"在 Slack 发一条消息"）时，系统按优先级依次尝试：

```
Level 0: API Connector (MCP / 直接集成)  — 最快、最可靠
Level 1: Browser Automation (Playwright)   — 中等速度、中等可靠
Level 2: Computer Use (截图+键鼠)         — 最慢、兜底
```

**Step 1: 写 ToolFallbackChain 的失败测试**

```python
# tests/tools/test_fallback_chain.py
import pytest
import asyncio
from agenticx.tools.fallback_chain import (
    ToolFallbackChain,
    FallbackLevel,
    FallbackResult,
    ToolResolver,
)


class MockAPIResolver(ToolResolver):
    """Mock resolver that succeeds for known tools."""

    def __init__(self, supported_tools=None):
        self.supported_tools = supported_tools or set()

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self.supported_tools

    async def resolve(self, task_intent: str, **kwargs) -> str:
        if task_intent not in self.supported_tools:
            raise RuntimeError(f"Cannot handle: {task_intent}")
        return f"api_result:{task_intent}"


class MockBrowserResolver(ToolResolver):
    def __init__(self, supported_tools=None):
        self.supported_tools = supported_tools or set()

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self.supported_tools

    async def resolve(self, task_intent: str, **kwargs) -> str:
        return f"browser_result:{task_intent}"


class MockComputerUseResolver(ToolResolver):
    async def can_handle(self, task_intent: str) -> bool:
        return True  # Computer use is the universal fallback

    async def resolve(self, task_intent: str, **kwargs) -> str:
        return f"computer_use_result:{task_intent}"


@pytest.mark.asyncio
async def test_fallback_chain_uses_highest_priority():
    """API connector should be preferred when available."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver({"send_slack"}))
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver({"send_slack"}))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("send_slack")
    assert result.level == FallbackLevel.API_CONNECTOR
    assert result.output == "api_result:send_slack"


@pytest.mark.asyncio
async def test_fallback_chain_degrades_to_browser():
    """When no API connector, fall back to browser."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))  # empty
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver({"open_calendar"}))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("open_calendar")
    assert result.level == FallbackLevel.BROWSER
    assert result.output == "browser_result:open_calendar"


@pytest.mark.asyncio
async def test_fallback_chain_degrades_to_computer_use():
    """When nothing else works, fall back to computer use."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver(set()))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("unknown_app_action")
    assert result.level == FallbackLevel.COMPUTER_USE


@pytest.mark.asyncio
async def test_fallback_chain_no_resolvers_raises():
    """Empty chain should raise."""
    chain = ToolFallbackChain()
    with pytest.raises(RuntimeError, match="No resolver"):
        await chain.execute("anything")


@pytest.mark.asyncio
async def test_fallback_chain_tracks_attempted_levels():
    """Result should record which levels were attempted."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("action")
    assert FallbackLevel.API_CONNECTOR in result.attempted_levels
    assert result.level == FallbackLevel.COMPUTER_USE
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/tools/test_fallback_chain.py -v`
Expected: FAIL — module not found

**Step 3: 实现 ToolFallbackChain**

```python
# agenticx/tools/fallback_chain.py
#!/usr/bin/env python3
"""Tool Fallback Chain — multi-level tool resolution with graceful degradation.

Inspired by Anthropic Claude Computer Use (2026.03):
  Level 0: API Connector (MCP / direct integration)
  Level 1: Browser Automation (Playwright)
  Level 2: Computer Use (screenshot + mouse/keyboard)

Author: Damon Li
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class FallbackLevel(IntEnum):
    """Priority levels for tool resolution (lower = higher priority)."""
    API_CONNECTOR = 0
    BROWSER = 1
    COMPUTER_USE = 2


class ToolResolver(ABC):
    """Abstract resolver for a specific fallback level."""

    @abstractmethod
    async def can_handle(self, task_intent: str) -> bool:
        """Check if this resolver can handle the given task intent."""

    @abstractmethod
    async def resolve(self, task_intent: str, **kwargs) -> str:
        """Execute the task and return result string."""


@dataclass
class FallbackResult:
    """Result of a fallback chain execution."""
    level: FallbackLevel
    output: str
    attempted_levels: List[FallbackLevel] = field(default_factory=list)
    errors: Dict[FallbackLevel, str] = field(default_factory=dict)


class ToolFallbackChain:
    """Multi-level tool resolution chain with graceful degradation.

    Resolvers are tried in priority order (API → Browser → Computer Use).
    The first resolver that can handle the task intent is used. If it fails,
    the chain falls through to the next level.
    """

    def __init__(self) -> None:
        self._resolvers: Dict[FallbackLevel, ToolResolver] = {}

    def register(self, level: FallbackLevel, resolver: ToolResolver) -> None:
        """Register a resolver at the given fallback level."""
        self._resolvers[level] = resolver

    async def execute(
        self,
        task_intent: str,
        *,
        max_level: Optional[FallbackLevel] = None,
        **kwargs,
    ) -> FallbackResult:
        """Execute task_intent, falling through levels as needed.

        Args:
            task_intent: Description or identifier of the task to perform.
            max_level: Maximum fallback level to attempt (inclusive).

        Returns:
            FallbackResult with the output from the first successful resolver.

        Raises:
            RuntimeError: If no resolver can handle the task.
        """
        if not self._resolvers:
            raise RuntimeError("No resolver registered in fallback chain")

        attempted: List[FallbackLevel] = []
        errors: Dict[FallbackLevel, str] = {}

        for level in sorted(self._resolvers.keys()):
            if max_level is not None and level > max_level:
                break

            resolver = self._resolvers[level]
            attempted.append(level)

            try:
                if not await resolver.can_handle(task_intent):
                    logger.debug(
                        "Level %s cannot handle '%s', skipping",
                        level.name, task_intent,
                    )
                    continue

                output = await resolver.resolve(task_intent, **kwargs)
                logger.info(
                    "Task '%s' resolved at level %s",
                    task_intent, level.name,
                )
                return FallbackResult(
                    level=level,
                    output=output,
                    attempted_levels=attempted,
                    errors=errors,
                )
            except Exception as exc:
                logger.warning(
                    "Level %s failed for '%s': %s",
                    level.name, task_intent, exc,
                )
                errors[level] = str(exc)

        raise RuntimeError(
            f"No resolver could handle '{task_intent}'. "
            f"Attempted: {[l.name for l in attempted]}, "
            f"Errors: {errors}"
        )
```

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/tools/test_fallback_chain.py -v`
Expected: 5 passed

**Step 5: Commit**

```bash
git add agenticx/tools/fallback_chain.py tests/tools/test_fallback_chain.py
git commit -m "feat(tools): add ToolFallbackChain for multi-level tool resolution

Inspired by Anthropic Claude Computer Use (2026.03) architecture:
API Connector → Browser Automation → Computer Use fallback.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

### Task 1.2: 实现 MCP Connector Resolver（API 层）

**Files:**

- Create: `agenticx/tools/resolvers/api_connector_resolver.py`
- Create: `agenticx/tools/resolvers/__init__.py`
- Test: `tests/tools/test_api_connector_resolver.py`

**设计说明：**

API Connector Resolver 包装现有的 MCP 工具调用能力。当 MCP hub 中有匹配 task_intent 的 tool 时，走 MCP 通道。

**Step 1: 写失败测试**

```python
# tests/tools/test_api_connector_resolver.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from agenticx.tools.resolvers.api_connector_resolver import MCPConnectorResolver


@pytest.fixture
def mock_mcp_hub():
    hub = MagicMock()
    hub.list_tools = AsyncMock(return_value=[
        {"name": "slack_send_message", "description": "Send Slack message"},
        {"name": "calendar_create_event", "description": "Create calendar event"},
    ])
    hub.call_tool = AsyncMock(return_value={"ok": True, "result": "Message sent"})
    return hub


@pytest.mark.asyncio
async def test_can_handle_known_tool(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    assert await resolver.can_handle("slack_send_message") is True


@pytest.mark.asyncio
async def test_cannot_handle_unknown_tool(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    assert await resolver.can_handle("unknown_tool") is False


@pytest.mark.asyncio
async def test_resolve_calls_mcp_hub(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    result = await resolver.resolve("slack_send_message", message="hello")
    mock_mcp_hub.call_tool.assert_called_once()
    assert "Message sent" in result
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/tools/test_api_connector_resolver.py -v`
Expected: FAIL

**Step 3: 实现 MCPConnectorResolver**

```python
# agenticx/tools/resolvers/__init__.py
#!/usr/bin/env python3
"""Tool resolvers for the fallback chain.

Author: Damon Li
"""

from agenticx.tools.resolvers.api_connector_resolver import MCPConnectorResolver

__all__ = ["MCPConnectorResolver"]
```

```python
# agenticx/tools/resolvers/api_connector_resolver.py
#!/usr/bin/env python3
"""MCP Connector Resolver — API-level tool resolution via MCP hub.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional, Set

from agenticx.tools.fallback_chain import ToolResolver

logger = logging.getLogger(__name__)


class MCPConnectorResolver(ToolResolver):
    """Resolve tasks via MCP tool hub (highest priority level).

    Wraps the existing MCP infrastructure to participate in the
    fallback chain. Maintains an index of available MCP tools and
    routes matching task_intents through the hub.
    """

    def __init__(self, mcp_hub: Any) -> None:
        self._hub = mcp_hub
        self._tool_index: Set[str] = set()

    async def refresh_tool_index(self) -> None:
        """Refresh the index of available MCP tools."""
        tools = await self._hub.list_tools()
        self._tool_index = {t["name"] for t in tools}
        logger.debug("MCP tool index refreshed: %d tools", len(self._tool_index))

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self._tool_index

    async def resolve(self, task_intent: str, **kwargs) -> str:
        result = await self._hub.call_tool(task_intent, kwargs)
        if isinstance(result, dict):
            return json.dumps(result, ensure_ascii=False)
        return str(result)
```

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/tools/test_api_connector_resolver.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add agenticx/tools/resolvers/ tests/tools/test_api_connector_resolver.py
git commit -m "feat(tools): add MCPConnectorResolver for API-level fallback

Wraps MCP hub as the highest-priority resolver in the fallback chain.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## Phase 2: 分层权限模型增强

### Task 2.1: 扩展 ToolPolicyStack 支持分类级策略

**Files:**

- Modify: `agenticx/tools/policy.py`
- Test: `tests/tools/test_policy_categories.py`

**设计说明：**

当前 `ToolPolicyStack` 按工具名 fnmatch 做允许/拒绝。需增强为支持**应用分类**级别的策略：

- `sensitive_categories`: 金融/密码管理器等默认禁止
- `first_access_approval`: 首次访问新应用需授权，后续静默
- `runtime_anomaly_hook`: 可选的异常行为检测钩子

**Step 1: 写失败测试**

```python
# tests/tools/test_policy_categories.py
import pytest
from agenticx.tools.policy import (
    ToolPolicyStack,
    ToolPolicyLayer,
    CategoryPolicy,
    ToolPolicyDeniedError,
)


def test_category_deny_blocks_tool():
    """Tools in a denied category should be blocked."""
    categories = CategoryPolicy(
        tool_categories={
            "finance_*": "financial",
            "password_*": "credentials",
        },
        denied_categories={"financial", "credentials"},
    )
    stack = ToolPolicyStack(
        layers=[
            ToolPolicyLayer(name="global", allow=["*"]),
        ],
        category_policy=categories,
    )
    assert stack.is_allowed("finance_transfer") is False
    assert stack.is_allowed("password_lookup") is False
    assert stack.is_allowed("file_read") is True


def test_category_deny_overrides_layer_allow():
    """Category deny should override layer allow."""
    categories = CategoryPolicy(
        tool_categories={"bank_*": "financial"},
        denied_categories={"financial"},
    )
    stack = ToolPolicyStack(
        layers=[
            ToolPolicyLayer(name="permissive", allow=["bank_*"]),
        ],
        category_policy=categories,
    )
    with pytest.raises(ToolPolicyDeniedError):
        stack.check("bank_transfer")


def test_first_access_tracking():
    """First-access tools should be flagged for approval."""
    categories = CategoryPolicy(
        tool_categories={},
        denied_categories=set(),
        require_first_access_approval=True,
    )
    stack = ToolPolicyStack(
        layers=[ToolPolicyLayer(name="global", allow=["*"])],
        category_policy=categories,
    )
    # First access should be flagged
    assert categories.is_first_access("new_app_tool") is True
    # After marking as approved, no longer first access
    categories.mark_approved("new_app_tool")
    assert categories.is_first_access("new_app_tool") is False
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/tools/test_policy_categories.py -v`
Expected: FAIL — `CategoryPolicy` not found

**Step 3: 在 policy.py 中增加 CategoryPolicy**

在 `agenticx/tools/policy.py` 的现有代码末尾追加：

```python
# --- Category-level policy (inspired by Claude Computer Use permissions) ---

@dataclass
class CategoryPolicy:
    """Category-based tool access control.

    Maps tool name patterns to categories, then applies category-level
    deny lists. Supports first-access approval tracking.

    Attributes:
        tool_categories: Mapping of fnmatch patterns to category names.
        denied_categories: Set of category names that are always blocked.
        require_first_access_approval: If True, flag tools on first access.
    """

    tool_categories: Dict[str, str] = field(default_factory=dict)
    denied_categories: set = field(default_factory=set)
    require_first_access_approval: bool = False
    _approved_tools: set = field(default_factory=set, repr=False)

    def get_category(self, tool_name: str) -> Optional[str]:
        """Return the category for a tool, or None if uncategorized."""
        for pattern, category in self.tool_categories.items():
            if fnmatch.fnmatch(tool_name, pattern):
                return category
        return None

    def is_category_denied(self, tool_name: str) -> bool:
        """Return True if the tool belongs to a denied category."""
        cat = self.get_category(tool_name)
        return cat is not None and cat in self.denied_categories

    def is_first_access(self, tool_name: str) -> bool:
        """Return True if this tool has not been approved before."""
        if not self.require_first_access_approval:
            return False
        return tool_name not in self._approved_tools

    def mark_approved(self, tool_name: str) -> None:
        """Mark a tool as approved (no longer triggers first-access)."""
        self._approved_tools.add(tool_name)
```

同时修改 `ToolPolicyStack.__init__` 和 `is_allowed`/`check` 方法以集成 `category_policy`：

- `__init__` 新增可选参数 `category_policy: Optional[CategoryPolicy] = None`
- `is_allowed` 在进入 layer 检查之前，先检查 `category_policy.is_category_denied(tool_name)`
- `check` 同理

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/tools/test_policy_categories.py -v`
Expected: 3 passed

**Step 5: 运行现有 policy 测试确保无回退**

Run: `python -m pytest tests/tools/test_policy*.py -v`
Expected: All passed

**Step 6: Commit**

```bash
git add agenticx/tools/policy.py tests/tools/test_policy_categories.py
git commit -m "feat(tools): add CategoryPolicy for category-level access control

Supports denied categories (financial, credentials, etc.) and
first-access approval tracking. Integrates with ToolPolicyStack.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## Phase 3: Desktop Computer Use 适配器

### Task 3.1: 实现 DesktopPlatformAdapter

**Files:**

- Create: `agenticx/embodiment/tools/desktop_adapter.py`
- Modify: `agenticx/embodiment/tools/__init__.py` (add export)
- Test: `tests/embodiment/test_desktop_adapter.py`

**设计说明：**

为 `BasePlatformAdapter` 新增桌面级适配器，使用 `pyautogui`（可选依赖）实现屏幕截图、鼠标控制、键盘输入。这是工具降级链的 Level 2 实现。

**Step 1: 写失败测试**

```python
# tests/embodiment/test_desktop_adapter.py
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from agenticx.embodiment.tools.desktop_adapter import DesktopPlatformAdapter


@pytest.mark.asyncio
async def test_desktop_adapter_screenshot():
    """Desktop adapter should return base64 screenshot."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui:
        mock_img = MagicMock()
        mock_img.tobytes.return_value = b"fake_png_data"
        mock_gui.screenshot.return_value = mock_img

        adapter = DesktopPlatformAdapter()
        result = await adapter.take_screenshot()
        assert isinstance(result, str)
        assert len(result) > 0  # base64 encoded


@pytest.mark.asyncio
async def test_desktop_adapter_click():
    """Desktop adapter click should call pyautogui."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui:
        adapter = DesktopPlatformAdapter()
        await adapter.click_at(x=100, y=200)
        mock_gui.click.assert_called_once_with(100, 200)


@pytest.mark.asyncio
async def test_desktop_adapter_type_text():
    """Desktop adapter should type text via pyautogui."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui:
        adapter = DesktopPlatformAdapter()
        await adapter.type_text("hello world")
        mock_gui.typewrite.assert_called_once()


@pytest.mark.asyncio
async def test_desktop_adapter_not_available():
    """Graceful error when pyautogui is not installed."""
    with patch.dict("sys.modules", {"pyautogui": None}):
        with pytest.raises(ImportError, match="pyautogui"):
            DesktopPlatformAdapter(require_gui=True)
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/embodiment/test_desktop_adapter.py -v`
Expected: FAIL

**Step 3: 实现 DesktopPlatformAdapter**

```python
# agenticx/embodiment/tools/desktop_adapter.py
#!/usr/bin/env python3
"""Desktop platform adapter for OS-level GUI operations via pyautogui.

Provides screenshot capture, mouse control, and keyboard input for
the Computer Use fallback level. pyautogui is an optional dependency.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

from agenticx.embodiment.tools.adapters import BasePlatformAdapter
from agenticx.embodiment.core.models import ScreenState, InteractionElement

logger = logging.getLogger(__name__)

try:
    import pyautogui
    _HAS_PYAUTOGUI = True
except ImportError:
    pyautogui = None  # type: ignore[assignment]
    _HAS_PYAUTOGUI = False


class DesktopPlatformAdapter(BasePlatformAdapter):
    """Platform adapter for OS-level desktop GUI operations.

    Uses pyautogui for screenshot, mouse, and keyboard control.
    Falls back gracefully when pyautogui is not installed.
    """

    def __init__(self, require_gui: bool = False) -> None:
        if require_gui and not _HAS_PYAUTOGUI:
            raise ImportError(
                "pyautogui is required for DesktopPlatformAdapter. "
                "Install with: pip install pyautogui"
            )

    async def take_screenshot(self) -> str:
        """Capture full desktop screenshot as base64 PNG."""
        if not _HAS_PYAUTOGUI:
            raise RuntimeError("pyautogui not available")

        def _capture():
            img = pyautogui.screenshot()
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode("utf-8")

        return await asyncio.to_thread(_capture)

    async def click_at(self, x: int, y: int, click_type: str = "left") -> None:
        """Click at absolute screen coordinates."""
        if not _HAS_PYAUTOGUI:
            raise RuntimeError("pyautogui not available")

        def _click():
            if click_type == "right":
                pyautogui.rightClick(x, y)
            elif click_type == "double":
                pyautogui.doubleClick(x, y)
            else:
                pyautogui.click(x, y)

        await asyncio.to_thread(_click)

    async def click(self, element_id=None, element_query=None, click_type="left"):
        """BasePlatformAdapter interface — requires coordinate resolution."""
        raise NotImplementedError(
            "Desktop adapter requires explicit coordinates. "
            "Use click_at(x, y) or pair with a vision model for element location."
        )

    async def type_text(self, text: str, element_id=None, element_query=None,
                        clear_first: bool = False) -> None:
        """Type text using keyboard."""
        if not _HAS_PYAUTOGUI:
            raise RuntimeError("pyautogui not available")

        def _type():
            if clear_first:
                pyautogui.hotkey("command" if _is_macos() else "ctrl", "a")
                pyautogui.press("delete")
            pyautogui.typewrite(text, interval=0.02)

        await asyncio.to_thread(_type)

    async def scroll(self, direction: str, element_id=None, element_query=None,
                     amount: int = 3) -> None:
        """Scroll the screen."""
        if not _HAS_PYAUTOGUI:
            raise RuntimeError("pyautogui not available")

        clicks = amount if direction == "up" else -amount
        await asyncio.to_thread(pyautogui.scroll, clicks)

    async def get_element_tree(self) -> List[InteractionElement]:
        """Not supported for desktop-level adapter."""
        return []

    async def find_element(self, element_query: Optional[str]) -> Optional[str]:
        """Not supported — requires vision model integration."""
        return None

    async def wait_for_element(self, element_query=None, timeout=10.0,
                               condition="visible") -> bool:
        return False

    async def get_current_screen_state(self) -> ScreenState:
        screenshot = await self.take_screenshot()
        return ScreenState(
            agent_id="desktop_agent",
            screenshot=screenshot,
            interactive_elements=[],
            metadata={"platform": "desktop"},
        )


def _is_macos() -> bool:
    import platform
    return platform.system() == "Darwin"
```

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/embodiment/test_desktop_adapter.py -v`
Expected: 4 passed

**Step 5: 更新 `__init__.py` 导出**

在 `agenticx/embodiment/tools/__init__.py` 中增加 `DesktopPlatformAdapter` 导出。

**Step 6: Commit**

```bash
git add agenticx/embodiment/tools/desktop_adapter.py \
        agenticx/embodiment/tools/__init__.py \
        tests/embodiment/test_desktop_adapter.py
git commit -m "feat(embodiment): add DesktopPlatformAdapter for OS-level GUI control

pyautogui-based adapter for screenshot, mouse, and keyboard. Optional
dependency — graceful ImportError when not installed.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

### Task 3.2: 实现 Computer Use Resolver（降级链 Level 2）

**Files:**

- Create: `agenticx/tools/resolvers/computer_use_resolver.py`
- Modify: `agenticx/tools/resolvers/__init__.py`
- Test: `tests/tools/test_computer_use_resolver.py`

**设计说明：**

Computer Use Resolver 将截图 → 视觉模型理解 → 坐标决策 → 键鼠操作的闭环封装为 `ToolResolver`。它是降级链的兜底层。

核心循环：

1. `take_screenshot()` → base64 image
2. 发送给视觉模型（LLM with vision）描述屏幕内容 + 用户意图
3. 模型返回操作指令（click_at, type_text, scroll 等）
4. 执行操作
5. 重复直到任务完成或超过最大步数

**Step 1: 写失败测试**

```python
# tests/tools/test_computer_use_resolver.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agenticx.tools.resolvers.computer_use_resolver import ComputerUseResolver


@pytest.fixture
def mock_adapter():
    adapter = AsyncMock()
    adapter.take_screenshot = AsyncMock(return_value="base64_fake_screenshot")
    adapter.click_at = AsyncMock()
    adapter.type_text = AsyncMock()
    return adapter


@pytest.fixture
def mock_vision_model():
    model = AsyncMock()
    model.analyze_screenshot = AsyncMock(return_value={
        "action": "click_at",
        "params": {"x": 100, "y": 200},
        "reasoning": "Found the submit button at (100, 200)",
        "task_complete": True,
    })
    return model


@pytest.mark.asyncio
async def test_computer_use_resolver_can_handle():
    """Computer use should handle everything (universal fallback)."""
    resolver = ComputerUseResolver(
        adapter=AsyncMock(),
        vision_model=AsyncMock(),
    )
    assert await resolver.can_handle("anything") is True


@pytest.mark.asyncio
async def test_computer_use_resolver_executes_action(mock_adapter, mock_vision_model):
    """Resolver should screenshot, analyze, then execute the action."""
    resolver = ComputerUseResolver(
        adapter=mock_adapter,
        vision_model=mock_vision_model,
        max_steps=5,
    )
    result = await resolver.resolve("click the submit button")
    mock_adapter.take_screenshot.assert_called()
    mock_vision_model.analyze_screenshot.assert_called()
    mock_adapter.click_at.assert_called_once_with(x=100, y=200)
    assert "submit" in result.lower() or "complete" in result.lower()


@pytest.mark.asyncio
async def test_computer_use_resolver_max_steps(mock_adapter):
    """Resolver should stop after max_steps even if task not complete."""
    never_done = AsyncMock()
    never_done.analyze_screenshot = AsyncMock(return_value={
        "action": "scroll",
        "params": {"direction": "down"},
        "reasoning": "Looking for element...",
        "task_complete": False,
    })
    resolver = ComputerUseResolver(
        adapter=mock_adapter,
        vision_model=never_done,
        max_steps=3,
    )
    result = await resolver.resolve("find something")
    assert never_done.analyze_screenshot.call_count == 3
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/tools/test_computer_use_resolver.py -v`
Expected: FAIL

**Step 3: 实现 ComputerUseResolver**

```python
# agenticx/tools/resolvers/computer_use_resolver.py
#!/usr/bin/env python3
"""Computer Use Resolver — screen-level task execution via vision model.

Implements the screenshot → analyze → act → repeat loop for
OS-level GUI task completion. This is the universal fallback resolver.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Protocol

from agenticx.tools.fallback_chain import ToolResolver

logger = logging.getLogger(__name__)


class VisionModel(Protocol):
    """Protocol for vision models that analyze screenshots."""

    async def analyze_screenshot(
        self,
        screenshot_b64: str,
        task_intent: str,
        action_history: list,
    ) -> Dict[str, Any]:
        """Analyze screenshot and return next action.

        Expected return format:
        {
            "action": "click_at" | "type_text" | "scroll" | "wait" | "done",
            "params": { ... },
            "reasoning": "...",
            "task_complete": bool,
        }
        """
        ...


class ComputerUseResolver(ToolResolver):
    """Universal fallback resolver using screenshot + vision model + GUI actions.

    Core loop:
    1. Take screenshot
    2. Send to vision model with task intent
    3. Execute returned action
    4. Repeat until task_complete or max_steps
    """

    def __init__(
        self,
        adapter: Any,
        vision_model: VisionModel,
        max_steps: int = 10,
    ) -> None:
        self._adapter = adapter
        self._vision = vision_model
        self._max_steps = max_steps

    async def can_handle(self, task_intent: str) -> bool:
        return True

    async def resolve(self, task_intent: str, **kwargs) -> str:
        action_history: list = []

        for step in range(self._max_steps):
            screenshot = await self._adapter.take_screenshot()

            analysis = await self._vision.analyze_screenshot(
                screenshot_b64=screenshot,
                task_intent=task_intent,
                action_history=action_history,
            )

            action = analysis.get("action", "done")
            params = analysis.get("params", {})
            reasoning = analysis.get("reasoning", "")
            task_complete = analysis.get("task_complete", False)

            logger.info(
                "Step %d/%d: action=%s, reasoning=%s",
                step + 1, self._max_steps, action, reasoning,
            )
            action_history.append(analysis)

            if task_complete or action == "done":
                return f"Task completed after {step + 1} steps. Last action: {reasoning}"

            await self._execute_action(action, params)

        return f"Task reached max steps ({self._max_steps}). Last state: {action_history[-1].get('reasoning', '')}"

    async def _execute_action(self, action: str, params: Dict[str, Any]) -> None:
        """Dispatch an action to the platform adapter."""
        if action == "click_at":
            await self._adapter.click_at(**params)
        elif action == "type_text":
            await self._adapter.type_text(**params)
        elif action == "scroll":
            await self._adapter.scroll(**params)
        elif action == "wait":
            import asyncio
            await asyncio.sleep(params.get("seconds", 1))
        else:
            logger.warning("Unknown action: %s", action)
```

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/tools/test_computer_use_resolver.py -v`
Expected: 3 passed

**Step 5: 更新 resolvers `__init__.py`**

```python
# agenticx/tools/resolvers/__init__.py
from agenticx.tools.resolvers.api_connector_resolver import MCPConnectorResolver
from agenticx.tools.resolvers.computer_use_resolver import ComputerUseResolver

__all__ = ["MCPConnectorResolver", "ComputerUseResolver"]
```

**Step 6: Commit**

```bash
git add agenticx/tools/resolvers/computer_use_resolver.py \
        agenticx/tools/resolvers/__init__.py \
        tests/tools/test_computer_use_resolver.py
git commit -m "feat(tools): add ComputerUseResolver for screen-level task execution

Screenshot → vision model → action → repeat loop as universal
fallback resolver. Pairs with DesktopPlatformAdapter.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## Phase 4: 后台任务调度（Dispatch 子集）

### Task 4.1: 在 meta_tools 中增加 schedule_task 能力

**Files:**

- Modify: `agenticx/runtime/meta_tools.py` (add `schedule_task` handler)
- Create: `agenticx/runtime/task_scheduler.py`
- Test: `tests/runtime/test_task_scheduler.py`

**设计说明：**

参考 Claude Dispatch 的定时任务子集：用户可以指定 Agent 在后台执行任务（如"每天早上 9 点检查邮件并汇总"）。暂不做跨设备对话同步（需要移动端），先实现：

1. **一次性后台任务**：立即后台执行，完成后通知
2. **定时任务**：cron 表达式定义周期性任务
3. **任务状态查询**：查看所有后台/定时任务的状态

**Step 1: 写失败测试**

```python
# tests/runtime/test_task_scheduler.py
import pytest
import asyncio
from agenticx.runtime.task_scheduler import TaskScheduler, ScheduledTask, TaskStatus


@pytest.mark.asyncio
async def test_schedule_one_shot_task():
    """One-shot task should execute immediately in background."""
    results = []

    async def my_task(context):
        results.append("executed")
        return "done"

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(
        name="test_task",
        handler=my_task,
        context={"foo": "bar"},
    )
    assert task_id is not None

    # Wait for task to complete
    await asyncio.sleep(0.2)
    status = scheduler.get_task_status(task_id)
    assert status.status == TaskStatus.COMPLETED
    assert results == ["executed"]


@pytest.mark.asyncio
async def test_schedule_task_failure_tracking():
    """Failed tasks should be tracked."""
    async def failing_task(context):
        raise ValueError("Boom")

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(name="failing", handler=failing_task)

    await asyncio.sleep(0.2)
    status = scheduler.get_task_status(task_id)
    assert status.status == TaskStatus.FAILED
    assert "Boom" in status.error


@pytest.mark.asyncio
async def test_list_tasks():
    """Should list all scheduled tasks."""
    scheduler = TaskScheduler()

    async def noop(ctx):
        return "ok"

    await scheduler.schedule(name="task_a", handler=noop)
    await scheduler.schedule(name="task_b", handler=noop)

    await asyncio.sleep(0.2)
    tasks = scheduler.list_tasks()
    assert len(tasks) == 2
    names = {t.name for t in tasks}
    assert names == {"task_a", "task_b"}


@pytest.mark.asyncio
async def test_cancel_pending_task():
    """Should be able to cancel a task that hasn't started."""
    gate = asyncio.Event()

    async def blocked_task(ctx):
        await gate.wait()

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(name="blocked", handler=blocked_task)

    cancelled = scheduler.cancel_task(task_id)
    assert cancelled is True
    gate.set()  # unblock cleanup
```

**Step 2: 运行测试确认失败**

Run: `python -m pytest tests/runtime/test_task_scheduler.py -v`
Expected: FAIL

**Step 3: 实现 TaskScheduler**

```python
# agenticx/runtime/task_scheduler.py
#!/usr/bin/env python3
"""Background task scheduler for AgenticX runtime.

Provides one-shot and (future) cron-based task scheduling.
Inspired by Claude Dispatch's background task execution model.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ScheduledTask:
    task_id: str
    name: str
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    _async_task: Optional[asyncio.Task] = field(default=None, repr=False)


class TaskScheduler:
    """Simple background task scheduler.

    Manages one-shot async tasks with status tracking, cancellation,
    and result retrieval.
    """

    def __init__(self) -> None:
        self._tasks: Dict[str, ScheduledTask] = {}

    async def schedule(
        self,
        name: str,
        handler: Callable[[Any], Coroutine],
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Schedule a one-shot background task.

        Args:
            name: Human-readable task name.
            handler: Async callable to execute.
            context: Optional context dict passed to handler.

        Returns:
            task_id for status queries.
        """
        task_id = str(uuid.uuid4())
        scheduled = ScheduledTask(task_id=task_id, name=name)
        self._tasks[task_id] = scheduled

        async def _run():
            scheduled.status = TaskStatus.RUNNING
            try:
                result = await handler(context or {})
                scheduled.status = TaskStatus.COMPLETED
                scheduled.result = result
            except asyncio.CancelledError:
                scheduled.status = TaskStatus.CANCELLED
            except Exception as exc:
                scheduled.status = TaskStatus.FAILED
                scheduled.error = str(exc)
                logger.error("Task %s (%s) failed: %s", name, task_id, exc)
            finally:
                scheduled.completed_at = datetime.now()

        scheduled._async_task = asyncio.create_task(_run())
        return task_id

    def get_task_status(self, task_id: str) -> ScheduledTask:
        """Get status of a scheduled task."""
        task = self._tasks.get(task_id)
        if task is None:
            raise KeyError(f"Unknown task: {task_id}")
        return task

    def list_tasks(self) -> List[ScheduledTask]:
        """List all scheduled tasks."""
        return list(self._tasks.values())

    def cancel_task(self, task_id: str) -> bool:
        """Cancel a task if possible."""
        task = self._tasks.get(task_id)
        if task is None:
            return False
        if task._async_task and not task._async_task.done():
            task._async_task.cancel()
            task.status = TaskStatus.CANCELLED
            return True
        return False
```

**Step 4: 运行测试确认通过**

Run: `python -m pytest tests/runtime/test_task_scheduler.py -v`
Expected: 4 passed

**Step 5: Commit**

```bash
git add agenticx/runtime/task_scheduler.py tests/runtime/test_task_scheduler.py
git commit -m "feat(runtime): add TaskScheduler for background task execution

One-shot async task scheduling with status tracking and cancellation.
Foundation for Claude Dispatch-style background operations.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## Phase 5: 集成与接线

### Task 5.1: 将 FallbackChain 接入 dispatch_tool_async

**Files:**

- Modify: `agenticx/cli/agent_tools.py` (add optional fallback chain integration)
- Test: `tests/cli/test_dispatch_fallback.py`

**设计说明：**

在 `dispatch_tool_async` 中增加一个可选的降级路径：当标准工具路由找不到匹配的工具名时，如果配置了 `ToolFallbackChain`，将 tool_name 作为 task_intent 传入降级链尝试执行。

这是**非侵入式集成**：现有工具路由完全不受影响，降级链只在 "tool not found" 时作为兜底。

**Step 1: 写失败测试**

```python
# tests/cli/test_dispatch_fallback.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from agenticx.tools.fallback_chain import ToolFallbackChain, FallbackLevel, FallbackResult


@pytest.mark.asyncio
async def test_dispatch_falls_back_to_chain():
    """When tool name is unknown, dispatch should try fallback chain."""
    mock_chain = AsyncMock(spec=ToolFallbackChain)
    mock_chain.execute = AsyncMock(return_value=FallbackResult(
        level=FallbackLevel.BROWSER,
        output="Fallback result",
        attempted_levels=[FallbackLevel.API_CONNECTOR, FallbackLevel.BROWSER],
    ))

    # This tests the integration point — actual wiring in dispatch_tool_async
    # The test verifies the chain's execute method contract
    result = await mock_chain.execute("open_unknown_app")
    assert result.level == FallbackLevel.BROWSER
    assert result.output == "Fallback result"
```

**Step 2: 在 `dispatch_tool_async` 中增加 fallback_chain 参数**

在 `dispatch_tool_async` 函数签名中增加 `fallback_chain: Optional[ToolFallbackChain] = None`。在函数末尾的 "unknown tool" 分支中，如果 `fallback_chain` 非 None，调用 `fallback_chain.execute(name, **arguments)` 并返回结果。

**重要约束：** 这只是在现有逻辑最末尾增加一个 else 分支，不修改任何已有的工具路由逻辑。

**Step 3: 运行全量测试确保无回退**

Run: `python -m pytest tests/ -x --timeout=60 -q`
Expected: All passed

**Step 4: Commit**

```bash
git add agenticx/cli/agent_tools.py tests/cli/test_dispatch_fallback.py
git commit -m "feat(cli): integrate ToolFallbackChain into dispatch_tool_async

Non-invasive: fallback chain only triggers when standard tool routing
finds no match. Existing tool paths unaffected.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

### Task 5.2: 注册 schedule_task 为 Meta Tool

**Files:**

- Modify: `agenticx/runtime/meta_tools.py` (add schedule_task / list_tasks / cancel_task)
- Modify: `agenticx/cli/agent_tools.py` (add tool schema to STUDIO_TOOLS + META_TOOL_NAMES)
- Test: `tests/runtime/test_meta_schedule_task.py`

**设计说明：**

将 `TaskScheduler` 的能力暴露为 Meta-Agent 可调用的工具：

- `schedule_task`: 创建后台任务
- `list_scheduled_tasks`: 列出所有任务及状态
- `cancel_scheduled_task`: 取消任务

**Step 1: 在 STUDIO_TOOLS 中增加 3 个工具 schema**

```python
{
    "type": "function",
    "function": {
        "name": "schedule_task",
        "description": "Schedule a background task to run asynchronously. The task will execute even while the user is not actively chatting.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Human-readable task name"},
                "instruction": {"type": "string", "description": "Task instructions for the agent to execute"},
            },
            "required": ["name", "instruction"]
        }
    }
},
{
    "type": "function",
    "function": {
        "name": "list_scheduled_tasks",
        "description": "List all background/scheduled tasks and their status.",
        "parameters": {"type": "object", "properties": {}}
    }
},
{
    "type": "function",
    "function": {
        "name": "cancel_scheduled_task",
        "description": "Cancel a background task by task_id.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "ID of the task to cancel"}
            },
            "required": ["task_id"]
        }
    }
}
```

**Step 2: 在 meta_tools.py 中增加 handler**

在 `dispatch_meta_tool_async` 的分支中增加对 `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task` 的处理，使用 session 级别的 `TaskScheduler` 实例。

**Step 3: 写集成测试**

**Step 4: 运行测试确认通过**

**Step 5: Commit**

```bash
git add agenticx/runtime/meta_tools.py agenticx/cli/agent_tools.py \
        tests/runtime/test_meta_schedule_task.py
git commit -m "feat(meta-tools): expose TaskScheduler as schedule_task meta tool

Agents can now schedule background tasks, list their status, and
cancel them. Foundation for Dispatch-style background operations.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## Phase 6: 配置与文档

### Task 6.1: 在 config.yaml 中增加 computer_use 配置项

**Files:**

- Modify: `agenticx/cli/config_manager.py` (add computer_use section)
- Example in `~/.agenticx/config.yaml`

**配置结构：**

```yaml
computer_use:
  enabled: false                    # Master switch
  fallback_chain:
    max_level: "computer_use"       # Max fallback level: api_connector | browser | computer_use
  desktop_adapter:
    backend: "pyautogui"            # pyautogui | accessibility_api (future)
  permissions:
    denied_categories:
      - "financial"
      - "credentials"
    require_first_access_approval: true
  scheduler:
    enabled: true
    max_concurrent_tasks: 5
```

**Step 1: 在 config_manager.py 中注册 computer_use 配置节**

**Step 2: Commit**

```bash
git add agenticx/cli/config_manager.py
git commit -m "feat(config): add computer_use configuration section

Controls fallback chain levels, desktop adapter backend, permission
categories, and task scheduler settings.

Made-with: Damon Li
Plan-Id: 2026-03-24-computer-use-internalization
Plan-File: .cursor/plans/2026-03-24-computer-use-internalization.plan.md"
```

---

## 依赖说明

**新增可选依赖（不影响核心安装）：**

```toml
# pyproject.toml [project.optional-dependencies]
computer-use = ["pyautogui>=0.9.54"]
```

**不引入新的必选依赖。** pyautogui 仅在显式启用 Computer Use 时才需要。

---

## 验收标准

- `ToolFallbackChain` 通过 5 个单元测试
- `MCPConnectorResolver` 通过 3 个单元测试
- `CategoryPolicy` 通过 3 个单元测试
- `DesktopPlatformAdapter` 通过 4 个单元测试（mock pyautogui）
- `ComputerUseResolver` 通过 3 个单元测试
- `TaskScheduler` 通过 4 个单元测试
- 现有测试套件无回退（`python -m pytest tests/ -x` 全通过）
- `dispatch_tool_async` 新增 fallback 路径不影响现有工具调用
- `config.yaml` 可配置所有新功能的开关
- pyautogui 为可选依赖，不影响核心 `pip install agenticx`

