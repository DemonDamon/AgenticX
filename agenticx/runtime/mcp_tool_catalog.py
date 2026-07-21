"""Convert MCPHub snapshots into ToolSearch descriptors (public names)."""

from __future__ import annotations

from typing import List, Optional, Sequence

from agenticx.runtime.tool_search import (
    ToolDescriptor,
    make_mcp_public_name,
    slugify_mcp_segment,
)
from agenticx.tools.mcp_hub import MCPToolSnapshot


def snapshots_to_descriptors(
    snapshots: Sequence[MCPToolSnapshot],
    *,
    mcp_call_allowed: bool,
) -> list[ToolDescriptor]:
    """Map MCP snapshots to ToolDescriptors.

    Parent gate: when ``mcp_call`` is not in the policy pool, return [].
    """
    if not mcp_call_allowed:
        return []
    existing: set[str] = set()
    out: List[ToolDescriptor] = []
    for snap in snapshots:
        if not snap.enabled:
            continue
        server_slug = slugify_mcp_segment(snap.server_name)
        tool_slug = slugify_mcp_segment(snap.original_name)
        public = make_mcp_public_name(snap.server_name, snap.original_name, existing=existing)
        existing.add(public)
        out.append(
            ToolDescriptor(
                stable_id=f"mcp:{server_slug}:{tool_slug}",
                name=public,
                kind="mcp",
                description=snap.description or f"{snap.server_name} {snap.original_name}",
                input_schema=dict(snap.input_schema or {}),
                search_hints=(snap.server_name, snap.original_name, snap.routed_name),
                server_slug=server_slug,
                original_mcp_name=snap.routed_name,
                always_load=False,
            )
        )
    return out


def resolve_mcp_execution_name(
    public_or_routed: str,
    descriptors: Sequence[ToolDescriptor],
) -> Optional[str]:
    """Map public name → hub routed name; also accept already-routed names."""
    key = str(public_or_routed or "").strip()
    if not key:
        return None
    for d in descriptors:
        if d.kind != "mcp":
            continue
        if d.name == key:
            return d.original_mcp_name or None
        if d.original_mcp_name == key:
            return d.original_mcp_name
    return None
