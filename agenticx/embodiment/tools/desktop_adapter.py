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
from typing import List, Optional

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
