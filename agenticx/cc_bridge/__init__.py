#!/usr/bin/env python3
"""Local Claude Code bridge package (stdio NDJSON + HTTP control plane).

Author: Damon Li
"""

from agenticx.cc_bridge.ndjson import (
    build_control_response_allow,
    build_control_response_deny,
    build_user_message_line,
    parse_control_request,
)

__all__ = [
    "build_control_response_allow",
    "build_control_response_deny",
    "build_user_message_line",
    "parse_control_request",
]
