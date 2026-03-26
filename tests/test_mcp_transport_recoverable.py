"""Recoverable MCP stdio transport classification."""

from __future__ import annotations

import errno

import pytest

from agenticx.tools.remote_v2 import _is_recoverable_mcp_transport_error


def test_recoverable_by_type_name_closed_resource() -> None:
    exc = type("ClosedResourceError", (Exception,), {})()
    assert _is_recoverable_mcp_transport_error(exc) is True


def test_recoverable_broken_pipe() -> None:
    assert _is_recoverable_mcp_transport_error(BrokenPipeError()) is True


def test_recoverable_oserror_errno() -> None:
    assert _is_recoverable_mcp_transport_error(OSError(errno.EPIPE, "e")) is True


def test_not_recoverable_value_error() -> None:
    assert _is_recoverable_mcp_transport_error(ValueError("logic")) is False
