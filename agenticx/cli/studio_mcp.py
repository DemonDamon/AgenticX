#!/usr/bin/env python3
"""MCP helpers for AGX Studio.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, TYPE_CHECKING

from rich.console import Console
from rich.table import Table

if TYPE_CHECKING:
    from agenticx.tools.mcp_hub import MCPHub
    from agenticx.tools.remote_v2 import MCPServerConfig

console = Console()


def _default_mcp_search_paths() -> List[Path]:
    """Return default MCP config search paths by priority."""
    return [
        Path.home() / ".agenticx" / "mcp.json",
        Path(".cursor/mcp.json"),
        Path.home() / ".cursor" / "mcp.json",
    ]


def _serialize_server_config(cfg: "MCPServerConfig") -> Dict[str, Any]:
    """Serialize MCPServerConfig to JSON-compatible dict."""
    data: Dict[str, Any] = {
        "command": cfg.command,
    }
    if getattr(cfg, "args", None):
        data["args"] = list(cfg.args)
    if getattr(cfg, "env", None):
        data["env"] = dict(cfg.env)
    if getattr(cfg, "timeout", None) is not None:
        data["timeout"] = float(cfg.timeout)
    if getattr(cfg, "cwd", None):
        data["cwd"] = cfg.cwd
    if getattr(cfg, "enabled_tools", None):
        data["enabled_tools"] = list(cfg.enabled_tools)
    if getattr(cfg, "assign_to_agents", None):
        data["assign_to_agents"] = list(cfg.assign_to_agents)
    return data


def load_available_servers() -> Dict[str, "MCPServerConfig"]:
    """Load MCP server configs from default paths.

    Searches with priority:
    1) ~/.agenticx/mcp.json
    2) project .cursor/mcp.json
    3) ~/.cursor/mcp.json

    Merges all discovered files. Existing names keep higher-priority entry.
    Returns empty dict if no config found.
    """
    from agenticx.tools.remote import load_mcp_config

    configs: Dict[str, "MCPServerConfig"] = {}
    for path in _default_mcp_search_paths():
        if path.exists():
            try:
                loaded = load_mcp_config(str(path))
                for name, cfg in loaded.items():
                    if name not in configs:
                        configs[name] = cfg
            except Exception:
                continue
    return configs


def import_mcp_config(source_path: str, target_path: Optional[str] = None) -> Dict[str, Any]:
    """Import MCP servers from source config into AgenticX workspace config."""
    from agenticx.tools.remote import load_mcp_config

    source = Path(source_path).expanduser().resolve(strict=False)
    target = (
        Path(target_path).expanduser().resolve(strict=False)
        if target_path
        else (Path.home() / ".agenticx" / "mcp.json")
    )
    if not source.exists() or not source.is_file():
        return {
            "ok": False,
            "error": f"source config not found: {source}",
            "source_path": str(source),
            "target_path": str(target),
        }

    try:
        source_servers = load_mcp_config(str(source))
    except Exception as exc:
        return {
            "ok": False,
            "error": f"failed to parse source config: {exc}",
            "source_path": str(source),
            "target_path": str(target),
        }

    existing_servers: Dict[str, "MCPServerConfig"] = {}
    if target.exists():
        try:
            existing_servers = load_mcp_config(str(target))
        except Exception as exc:
            return {
                "ok": False,
                "error": f"failed to parse target config: {exc}",
                "source_path": str(source),
                "target_path": str(target),
            }

    imported: List[str] = []
    skipped: List[str] = []
    merged: Dict[str, "MCPServerConfig"] = dict(existing_servers)
    for name, cfg in source_servers.items():
        if name in merged:
            skipped.append(name)
            continue
        merged[name] = cfg
        imported.append(name)

    payload = {"mcpServers": {name: _serialize_server_config(cfg) for name, cfg in merged.items()}}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "source_path": str(source),
        "target_path": str(target),
        "imported": sorted(imported),
        "skipped": sorted(skipped),
        "total_imported": len(imported),
        "total_servers": len(merged),
    }


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


def auto_connect_servers(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    auto_connect_list: Optional[List[str]] = None,
) -> Dict[str, bool]:
    """Auto-connect MCP servers and return per-server result."""
    if not configs:
        return {}
    if auto_connect_list is None:
        candidates = sorted(configs.keys())
    else:
        candidates = [name for name in auto_connect_list if name in configs]
    results: Dict[str, bool] = {}
    for name in candidates:
        results[name] = mcp_connect(hub, configs, connected, name)
    return results


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
