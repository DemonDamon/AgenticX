#!/usr/bin/env python3
"""Tests for DesktopPlatformAdapter.

Author: Damon Li
"""

import sys
import pytest
from unittest.mock import patch, MagicMock
from agenticx.embodiment.tools.desktop_adapter import DesktopPlatformAdapter


@pytest.mark.asyncio
async def test_desktop_adapter_screenshot():
    """Desktop adapter should return base64 screenshot."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui, \
         patch("agenticx.embodiment.tools.desktop_adapter._HAS_PYAUTOGUI", True):
        mock_img = MagicMock()
        buf_data = b"fake_png_data"
        def fake_save(buffer, format=None):
            buffer.write(buf_data)
        mock_img.save = fake_save
        mock_gui.screenshot.return_value = mock_img

        adapter = DesktopPlatformAdapter()
        result = await adapter.take_screenshot()
        assert isinstance(result, str)
        assert len(result) > 0


@pytest.mark.asyncio
async def test_desktop_adapter_click():
    """Desktop adapter click should call pyautogui."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui, \
         patch("agenticx.embodiment.tools.desktop_adapter._HAS_PYAUTOGUI", True):
        adapter = DesktopPlatformAdapter()
        await adapter.click_at(x=100, y=200)
        mock_gui.click.assert_called_once_with(100, 200)


@pytest.mark.asyncio
async def test_desktop_adapter_type_text():
    """Desktop adapter should type text via pyautogui."""
    with patch("agenticx.embodiment.tools.desktop_adapter.pyautogui") as mock_gui, \
         patch("agenticx.embodiment.tools.desktop_adapter._HAS_PYAUTOGUI", True):
        adapter = DesktopPlatformAdapter()
        await adapter.type_text("hello world")
        mock_gui.typewrite.assert_called_once()


@pytest.mark.asyncio
async def test_desktop_adapter_not_available():
    """Graceful error when pyautogui is not installed."""
    with patch("agenticx.embodiment.tools.desktop_adapter._HAS_PYAUTOGUI", False):
        with pytest.raises(ImportError, match="pyautogui"):
            DesktopPlatformAdapter(require_gui=True)
