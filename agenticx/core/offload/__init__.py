#!/usr/bin/env python3
"""Unified offload abstraction for tool results and compressed context.

Internalized (selectively) from AgentScope 2.0
``src/agentscope/workspace/_offload_protocol.py`` (Apache-2.0, commit
``6d7189c``). AgentScope returns a bare string handle; AGX returns a richer
``Reference`` dataclass that can also render an inline chat-history placeholder
and round-trip through ``to_dict`` / ``from_dict``.

Author: Damon Li
"""

from agenticx.core.offload.protocol import (
    DEFAULT_OFFLOAD_THRESHOLD_BYTES,
    OffloadError,
    Offloader,
    Reference,
    should_offload,
)
from agenticx.core.offload.file_offloader import FileOffloader

__all__ = [
    "DEFAULT_OFFLOAD_THRESHOLD_BYTES",
    "OffloadError",
    "Offloader",
    "Reference",
    "should_offload",
    "FileOffloader",
]
