"""
AgenticX Tool Policy — Declarative multi-layer tool access control.

Inspired by OpenClaw's 6-layer tool policy stack:
    profile -> global -> provider -> agent -> group -> sandbox

Design rules:
1. DENY always wins at any layer.
2. Layers are evaluated in order.
3. First ALLOW wins if no DENY found.
4. Default (no opinion from any layer) is DENY (whitelist model).

Source: OpenClaw DeepWiki — Tool Security & Sandboxing (Apache-2.0)
"""

from __future__ import annotations

import fnmatch
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums / Exceptions
# ---------------------------------------------------------------------------

class PolicyAction(Enum):
    """Possible outcomes of a single policy layer evaluation."""
    ALLOW = "allow"
    DENY = "deny"


class ToolPolicyDeniedError(Exception):
    """Raised when a tool call is blocked by the policy stack.

    Attributes:
        tool_name: The tool that was denied.
        denied_by_layer: Name of the layer that issued the DENY.
    """

    def __init__(self, tool_name: str, denied_by_layer: str) -> None:
        self.tool_name = tool_name
        self.denied_by_layer = denied_by_layer
        super().__init__(
            f"Tool '{tool_name}' denied by policy layer '{denied_by_layer}'"
        )


# ---------------------------------------------------------------------------
# Policy Layer
# ---------------------------------------------------------------------------

@dataclass
class ToolPolicyLayer:
    """A single layer in the tool policy stack.

    Each layer may express *allow* patterns, *deny* patterns, or both.
    Patterns support Unix shell-style wildcards via :func:`fnmatch.fnmatch`
    (e.g. ``"web_*"`` matches ``"web_search"``).

    Evaluation order within one layer:
    1. If tool matches any *deny* pattern → DENY.
    2. If tool matches any *allow* pattern → ALLOW.
    3. Otherwise → ``None`` (no opinion).
    """

    name: str
    allow: List[str] = field(default_factory=list)
    deny: List[str] = field(default_factory=list)

    def evaluate(self, tool_name: str) -> Optional[PolicyAction]:
        """Evaluate this layer for *tool_name*.

        Returns ``PolicyAction.DENY``, ``PolicyAction.ALLOW``, or ``None``
        (no opinion).
        """
        if self._matches(tool_name, self.deny):
            return PolicyAction.DENY
        if self._matches(tool_name, self.allow):
            return PolicyAction.ALLOW
        return None

    @staticmethod
    def _matches(tool_name: str, patterns: List[str]) -> bool:
        """Return True if *tool_name* matches any pattern in *patterns*."""
        return any(fnmatch.fnmatch(tool_name, p) for p in patterns)


# ---------------------------------------------------------------------------
# Policy Stack
# ---------------------------------------------------------------------------

class ToolPolicyStack:
    """Multi-layer tool policy stack.

    Inspired by OpenClaw's 6-layer model::

        profile → global → provider → agent → group → sandbox

    AgenticX does not prescribe fixed layer names — callers create layers
    with whatever names fit their deployment model.

    Evaluation algorithm:
    1. Walk layers in order.  If **any** layer returns DENY → tool is denied.
    2. Walk layers again.  If **any** layer returns ALLOW → tool is allowed.
    3. If no layer has an opinion → default deny (whitelist model).

    Parameters
    ----------
    layers : list[ToolPolicyLayer]
        Ordered list of policy layers (highest-priority first).
    default_allow : bool
        If ``True``, tools with no matching rule are **allowed** (blacklist
        model).  Default ``False`` (whitelist model — deny by default).
    """

    def __init__(
        self,
        layers: Optional[List[ToolPolicyLayer]] = None,
        default_allow: bool = False,
    ) -> None:
        self._layers: List[ToolPolicyLayer] = layers or []
        self._default_allow = default_allow

    # -- core API -------------------------------------------------------------

    def is_allowed(self, tool_name: str) -> bool:
        """Return ``True`` if *tool_name* passes through all policy layers."""
        # Pass 1: any DENY → blocked
        for layer in self._layers:
            result = layer.evaluate(tool_name)
            if result is PolicyAction.DENY:
                logger.debug("Tool '%s' DENIED by layer '%s'", tool_name, layer.name)
                return False

        # Pass 2: any ALLOW → allowed
        for layer in self._layers:
            result = layer.evaluate(tool_name)
            if result is PolicyAction.ALLOW:
                logger.debug("Tool '%s' ALLOWED by layer '%s'", tool_name, layer.name)
                return True

        # No opinion → apply default
        return self._default_allow

    def check(self, tool_name: str) -> None:
        """Like :meth:`is_allowed` but raises on denial.

        Raises
        ------
        ToolPolicyDeniedError
            If the tool is not allowed.
        """
        # Find the denying layer (for error message)
        for layer in self._layers:
            result = layer.evaluate(tool_name)
            if result is PolicyAction.DENY:
                raise ToolPolicyDeniedError(tool_name, layer.name)

        # Check for any ALLOW
        for layer in self._layers:
            result = layer.evaluate(tool_name)
            if result is PolicyAction.ALLOW:
                return

        # Default deny
        if not self._default_allow:
            raise ToolPolicyDeniedError(tool_name, "<default-deny>")

    def filter_tools(self, tool_names: List[str]) -> List[str]:
        """Return only the tool names that are allowed."""
        return [t for t in tool_names if self.is_allowed(t)]

    # -- introspection --------------------------------------------------------

    @property
    def layers(self) -> List[ToolPolicyLayer]:
        """Read-only access to the layer list."""
        return list(self._layers)

    def add_layer(self, layer: ToolPolicyLayer, index: Optional[int] = None) -> None:
        """Add a layer.  If *index* is ``None``, appends at the end."""
        if index is None:
            self._layers.append(layer)
        else:
            self._layers.insert(index, layer)
