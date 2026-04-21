"""保证运行 Studio 的 Python 环境里装了 MCP SDK。

历史教训：`.venv` 漏装 `mcp` 包时，`MCPClientV2._create_session` 内部的
`stdio_client` 会变成 `None`，所有 MCP 连接都会以
`TypeError: 'NoneType' object is not callable` 静默失败。
本测试防止该依赖再次从核心运行时里"漂走"。
"""

from __future__ import annotations

import asyncio
import pytest

from agenticx.tools import remote_v2


def test_mcp_sdk_importable() -> None:
    """pyproject / requirements / desktop-runtime 都必须把 `mcp` 锁进核心依赖。"""
    assert remote_v2.stdio_client is not None, (
        "mcp SDK 缺失：pip install 'mcp>=1.0.0,<2'（或 pip install -e '.[desktop-runtime]'）。"
    )
    assert remote_v2.ClientSession is not None
    assert remote_v2.StdioServerParameters is not None
    assert remote_v2.mcp_types is not None


def test_create_session_raises_clear_error_when_sdk_missing(monkeypatch) -> None:
    """装不上 MCP SDK 时也得给人看得懂的报错，而不是 NoneType 谜题。"""
    cfg = remote_v2.MCPServerConfig(
        name="dummy",
        command="/bin/true",
        args=[],
    )
    client = remote_v2.MCPClientV2(cfg)
    monkeypatch.setattr(remote_v2, "stdio_client", None)
    monkeypatch.setattr(remote_v2, "ClientSession", None)
    monkeypatch.setattr(remote_v2, "StdioServerParameters", None)

    with pytest.raises(RuntimeError, match="MCP SDK 未安装"):
        asyncio.run(client._create_session())
