#!/usr/bin/env python3
"""MCP helpers for AGX Studio.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional, Set, TYPE_CHECKING

from rich.console import Console
from rich.table import Table

if TYPE_CHECKING:
    from agenticx.tools.mcp_hub import MCPHub
    from agenticx.tools.remote_v2 import MCPServerConfig

console = Console()


def load_available_servers() -> Dict[str, "MCPServerConfig"]:
    """Load MCP server configs from default paths.

    Searches: project .cursor/mcp.json → ~/.cursor/mcp.json
    Returns empty dict if no config found.
    """
    from pathlib import Path

    configs: Dict[str, "MCPServerConfig"] = {}
    search_paths = [
        Path(".cursor/mcp.json"),
        Path.home() / ".cursor" / "mcp.json",
    ]
    for path in search_paths:
        if path.exists():
            try:
                from agenticx.tools.remote import load_mcp_config
                configs = load_mcp_config(str(path))
                break
            except Exception:
                continue
    return configs


def mcp_list_servers(
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
) -> None:
    """Display available MCP servers with connection status."""
    if not configs:
        console.print("[yellow]未找到 MCP 配置。请在 .cursor/mcp.json 或 ~/.cursor/mcp.json 中配置。[/yellow]")
        return
    table = Table(title="MCP Servers")
    table.add_column("名称", style="cyan")
    table.add_column("命令")
    table.add_column("状态", style="bold")
    for name, cfg in configs.items():
        cmd_display = f"{cfg.command} {' '.join(cfg.args[:2])}"
        if len(cfg.args) > 2:
            cmd_display += " ..."
        status = "[green]已连接[/green]" if name in connected else "[dim]未连接[/dim]"
        table.add_row(name, cmd_display, status)
    console.print(table)


def mcp_connect(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    name: str,
) -> bool:
    """Connect to an MCP server and discover its tools.

    Returns True on success.
    """
    if name in connected:
        console.print(f"[yellow]{name} 已经连接。[/yellow]")
        return True
    if name not in configs:
        console.print(f"[red]MCP server '{name}' 未在配置中找到。[/red]")
        console.print(f"[dim]可用: {', '.join(configs.keys()) or '(无)'}[/dim]")
        return False

    from agenticx.tools.remote_v2 import MCPClientV2

    cfg = configs[name]
    client = MCPClientV2(cfg)
    hub.clients.append(client)

    try:
        tools = asyncio.run(hub.discover_all_tools())
    except Exception as exc:
        console.print(f"[red]连接 {name} 失败:[/red] {exc}")
        hub.clients.remove(client)
        return False

    connected.add(name)
    # Show discovered tools for this server
    server_tools = [t for t in tools if any(
        r.client is client for r in hub._tool_routing.values()
        if r.tool_info.name == t.name or hub._tool_routing.get(t.name, None) and hub._tool_routing[t.name].client is client
    )]
    # Simpler approach: just show newly merged tools
    console.print(f"[green]已连接 {name}[/green]，发现 {len(hub._merged_tools)} 个工具：")
    for tool_info in hub._merged_tools:
        route = hub._tool_routing.get(tool_info.name)
        if route and route.client is client:
            console.print(f"  [cyan]{tool_info.name}[/cyan] — {tool_info.description[:60]}")
    return True


def mcp_disconnect(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    name: str,
) -> bool:
    """Disconnect an MCP server."""
    if name not in connected:
        console.print(f"[yellow]{name} 未连接。[/yellow]")
        return False

    # Find and remove matching client
    to_remove = None
    for client in hub.clients:
        if client.server_config.name == name:
            to_remove = client
            break
    if to_remove is None:
        connected.discard(name)
        return True

    try:
        asyncio.run(to_remove.close())
    except Exception:
        pass

    hub.clients.remove(to_remove)
    # Rebuild routing
    try:
        asyncio.run(hub.discover_all_tools())
    except Exception:
        pass

    connected.discard(name)
    console.print(f"[green]已断开 {name}[/green]")
    return True


def mcp_show_tools(hub: "MCPHub") -> None:
    """Display all currently connected MCP tools."""
    if not hub._merged_tools:
        console.print("[yellow]暂无已连接的 MCP 工具。使用 /mcp connect <name> 连接。[/yellow]")
        return
    table = Table(title="已连接的 MCP 工具")
    table.add_column("工具名", style="cyan")
    table.add_column("来源")
    table.add_column("描述")
    table.add_column("参数")
    for tool_info in hub._merged_tools:
        route = hub._tool_routing.get(tool_info.name)
        source = route.client.server_config.name if route else "?"
        # Compact input schema display
        props = tool_info.inputSchema.get("properties", {})
        params_display = ", ".join(props.keys()) if props else "(无)"
        if len(params_display) > 40:
            params_display = params_display[:37] + "..."
        table.add_row(
            tool_info.name,
            source,
            tool_info.description[:50] + ("..." if len(tool_info.description) > 50 else ""),
            params_display,
        )
    console.print(table)


def mcp_call_tool(hub: "MCPHub", tool_name: str, args_json: str) -> Optional[str]:
    """Call an MCP tool and print the result. Returns result string or None."""
    if not hub._tool_routing:
        console.print("[yellow]暂无已连接的 MCP 工具。[/yellow]")
        return None

    if tool_name not in hub._tool_routing:
        console.print(f"[red]工具 '{tool_name}' 不存在。[/red]")
        available = ", ".join(hub._tool_routing.keys())
        console.print(f"[dim]可用工具: {available}[/dim]")
        return None

    try:
        arguments = json.loads(args_json) if args_json.strip() else {}
    except json.JSONDecodeError as exc:
        console.print(f"[red]参数 JSON 解析失败:[/red] {exc}")
        return None

    try:
        raw_result = asyncio.run(hub.call_tool(tool_name, arguments))
        result_text = hub.extract_tool_result(tool_name, raw_result)
    except Exception as exc:
        console.print(f"[red]工具调用失败:[/red] {exc}")
        return None

    result_str = str(result_text)
    console.print(f"[green]结果:[/green]\n{result_str}")
    return result_str


def build_mcp_tools_context(hub: "MCPHub") -> str:
    """Serialize connected MCP tools as text context for code generation."""
    if not hub._merged_tools:
        return ""
    parts = ["=== 可用的 MCP 工具 ===\n"]
    parts.append("以下是用户已连接的 MCP 工具，生成的代码应当使用这些工具：\n")
    for tool_info in hub._merged_tools:
        route = hub._tool_routing.get(tool_info.name)
        source = route.client.server_config.name if route else "unknown"
        parts.append(f"工具: {tool_info.name} (来源: {source})")
        parts.append(f"  描述: {tool_info.description}")
        schema_str = json.dumps(tool_info.inputSchema, ensure_ascii=False, indent=2)
        if len(schema_str) > 500:
            schema_str = schema_str[:500] + "\n  ..."
        parts.append(f"  输入Schema:\n  {schema_str}\n")
    return "\n".join(parts)
