"""MCPHub error payload normalization (multi-block text, diagnostics)."""

from __future__ import annotations

import pytest

from agenticx.tools.base import ToolError
from agenticx.tools.mcp_hub import MCPHub


def test_extract_tool_result_joins_multiple_error_text_blocks() -> None:
    class _Blk:
        def __init__(self, text: str) -> None:
            self.text = text

    class _Res:
        isError = True
        content = [_Blk("first line"), _Blk("second line")]

    hub = MCPHub(clients=[], auto_mode=False)
    with pytest.raises(ToolError) as ei:
        hub.extract_tool_result("browser_navigate", _Res())
    assert "first line" in str(ei.value)
    assert "second line" in str(ei.value)
