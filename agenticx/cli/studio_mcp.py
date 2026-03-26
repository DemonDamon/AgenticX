#!/usr/bin/env python3
"""MCP helpers for AGX Studio.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, TYPE_CHECKING, Tuple

from rich.console import Console
from rich.table import Table

if TYPE_CHECKING:
    from agenticx.tools.mcp_hub import MCPHub
    from agenticx.tools.remote_v2 import MCPServerConfig

console = Console()
logger = logging.getLogger(__name__)

# mcp_call_tool_async failure messages (agent/UI); keep bounded to avoid context blow-up.
_MCP_CALL_ERR_MAX_LEN = 2000
_MCP_CALL_ERR_PREFIX = "ERROR: mcp_call:"


def _format_mcp_call_error(detail: str) -> str:
    d = (detail or "").strip()
    if len(d) > _MCP_CALL_ERR_MAX_LEN:
        d = d[: _MCP_CALL_ERR_MAX_LEN - 3] + "..."
    return f"{_MCP_CALL_ERR_PREFIX} {d}"


def _exception_detail_for_mcp_call(exc: BaseException, *, max_chain: int = 4) -> str:
    """Walk ``__cause__`` so nested errors (e.g. ToolError from httpx) stay visible."""
    parts: List[str] = []
    cur: Optional[BaseException] = exc
    seen_ids: Set[int] = set()
    for _ in range(max_chain):
        if cur is None:
            break
        oid = id(cur)
        if oid in seen_ids:
            break
        seen_ids.add(oid)
        msg = str(cur).strip()
        if not msg:
            msg = repr(cur)
        parts.append(f"{type(cur).__name__}: {msg}")
        cur = cur.__cause__
    return " | ".join(parts)


# Shipped default for first-time Machi / agx users (no secrets on disk; env inherits os.environ).
_DEFAULT_BROWSER_USE_MCP_ENTRY: Dict[str, Any] = {
    "command": "uvx",
    "args": ["browser-use[cli]", "--mcp"],
    "timeout": 600.0,
}


def agenticx_home_mcp_path() -> Path:
    """Canonical MCP config path under ~/.agenticx."""
    return Path.home() / ".agenticx" / "mcp.json"


def ensure_default_agenticx_mcp_json() -> bool:
    """Ensure ~/.agenticx/mcp.json contains a default ``browser-use`` MCP server.

    - If the file is missing: creates it with only ``browser-use``.
    - If the file exists but has no ``browser-use`` entry (common: user only uses
      ``~/.cursor/mcp.json``): **merges** in the default entry without removing others.
    - Never replaces an existing ``browser-use`` block.

    Returns True if a new file was created or updated.
    """
    target = agenticx_home_mcp_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False

    entry = dict(_DEFAULT_BROWSER_USE_MCP_ENTRY)

    if not target.exists():
        try:
            target.write_text(
                json.dumps({"browser-use": entry}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError:
            return False
        return True

    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("skip browser-use merge: cannot read %s: %s", target, exc)
        return False

    if not isinstance(raw, dict):
        return False

    changed = False
    if "mcpServers" in raw and isinstance(raw["mcpServers"], dict):
        servers = raw["mcpServers"]
        if "browser-use" not in servers:
            servers["browser-use"] = entry
            changed = True
    else:
        if "browser-use" not in raw:
            raw["browser-use"] = entry
            changed = True

    if not changed:
        return False

    try:
        target.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        return False
    return True


def _is_stock_browser_use_mcp_config(cfg: "MCPServerConfig") -> bool:
    """True when config matches the bundled uvx + browser-use[cli] --mcp entry."""
    if str(cfg.command).strip() != "uvx":
        return False
    args = [str(a) for a in (getattr(cfg, "args", None) or [])]
    joined = " ".join(args)
    return "browser-use" in joined and "--mcp" in joined


def preflight_browser_use_install(*, echo: bool = True) -> Tuple[bool, str]:
    """Run ``uvx browser-use install`` (Playwright/Chromium). No manual JSON edits.

    Returns (True, message) on success; (False, error) if ``uvx`` is missing or install fails.
    """
    uvx = shutil.which("uvx")
    if not uvx:
        msg = (
            "未找到 uvx。请安装 uv 后重试：https://docs.astral.sh/uv/getting-started/installation/"
        )
        if echo:
            console.print(f"[red]{msg}[/red]")
        logger.warning("browser-use preflight: %s", msg)
        return False, msg
    if echo:
        console.print("[dim]正在安装 browser-use 浏览器依赖（uvx browser-use install，首次可能较慢）…[/dim]")
    logger.info("browser-use preflight: running `%s browser-use install`", uvx)
    try:
        result = subprocess.run(
            [uvx, "browser-use", "install"],
            capture_output=True,
            text=True,
            timeout=900.0,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        msg = "browser-use install 超时（>900s）"
        if echo:
            console.print(f"[red]{msg}[/red]")
        logger.warning("browser-use preflight: %s", msg)
        return False, msg

    tail = ((result.stderr or "") + (result.stdout or ""))[-2000:]
    if result.returncode != 0:
        msg = f"browser-use install 失败 (exit {result.returncode}): {tail}"
        if echo:
            console.print(f"[red]{msg}[/red]")
        logger.warning("browser-use preflight: %s", msg)
        return False, msg

    if echo:
        console.print("[green]browser-use 浏览器依赖已就绪[/green]")
    logger.info("browser-use preflight: install ok")
    return True, "ok"


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
    Ensures ~/.agenticx/mcp.json exists and contains a default ``browser-use`` entry (merge if needed).
    Returns empty dict if no config found.
    """
    from agenticx.tools.remote import load_mcp_config

    ensure_default_agenticx_mcp_json()

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
    updated: List[str] = []
    skipped: List[str] = []
    merged: Dict[str, "MCPServerConfig"] = dict(existing_servers)
    for name, cfg in source_servers.items():
        if name in merged:
            old_payload = _serialize_server_config(merged[name])
            new_payload = _serialize_server_config(cfg)
            if old_payload == new_payload:
                skipped.append(name)
                continue
            merged[name] = cfg
            updated.append(name)
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
        "updated": sorted(updated),
        "skipped": sorted(skipped),
        "total_imported": len(imported),
        "total_updated": len(updated),
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


async def mcp_connect_async(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    name: str,
) -> Tuple[bool, str]:
    """Connect to an MCP server (async). Safe to call from FastAPI / running event loop.

    Returns (True, \"\") on success, or (False, error_message).
    """
    if name in connected:
        console.print(f"[yellow]{name} 已经连接。[/yellow]")
        return True, ""
    if name not in configs:
        console.print(f"[red]MCP server '{name}' 未在配置中找到。[/red]")
        console.print(f"[dim]可用: {', '.join(configs.keys()) or '(无)'}[/dim]")
        return False, f"MCP server '{name}' not in config; available: {', '.join(configs.keys()) or '(none)'}"

    from agenticx.tools.remote_v2 import MCPClientV2

    cfg = configs[name]
    if name == "browser-use" and _is_stock_browser_use_mcp_config(cfg):
        ok_install, err = preflight_browser_use_install(echo=True)
        if not ok_install:
            console.print(
                "[dim]提示：仍可在 ~/.agenticx/mcp.json 中改用自定义 command/args；"
                "或安装 uv 后再次点击连接。[/dim]"
            )
            return False, err

    client = MCPClientV2(cfg)
    hub.clients.append(client)

    try:
        tools = await hub.discover_all_tools()
    except Exception as exc:
        console.print(f"[red]连接 {name} 失败:[/red] {exc}")
        hub.clients.remove(client)
        return False, str(exc)

    connected.add(name)
    console.print(f"[green]已连接 {name}[/green]，发现 {len(hub._merged_tools)} 个工具：")
    for tool_info in hub._merged_tools:
        route = hub._tool_routing.get(tool_info.name)
        if route and route.client is client:
            console.print(f"  [cyan]{tool_info.name}[/cyan] — {tool_info.description[:60]}")
    return True, ""


def mcp_connect(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    name: str,
) -> Tuple[bool, str]:
    """Connect to an MCP server (sync wrapper). Falls back to async if loop is running.

    Returns (True, \"\") on success, or (False, error_message).
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(mcp_connect_async(hub, configs, connected, name))
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, mcp_connect_async(hub, configs, connected, name))
        return future.result(timeout=900)


async def auto_connect_servers_async(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    auto_connect_list: Optional[List[str]] = None,
) -> Dict[str, bool]:
    """Auto-connect MCP servers (async). Safe from FastAPI / running event loops."""
    if not configs:
        return {}
    if auto_connect_list is None:
        candidates = sorted(configs.keys())
    else:
        candidates = [name for name in auto_connect_list if name in configs]
    results: Dict[str, bool] = {}
    for name in candidates:
        ok, _detail = await mcp_connect_async(hub, configs, connected, name)
        results[name] = ok
    return results


def auto_connect_servers(
    hub: "MCPHub",
    configs: Dict[str, "MCPServerConfig"],
    connected: Set[str],
    auto_connect_list: Optional[List[str]] = None,
) -> Dict[str, bool]:
    """Auto-connect MCP servers (sync wrapper)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(auto_connect_servers_async(hub, configs, connected, auto_connect_list))
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, auto_connect_servers_async(hub, configs, connected, auto_connect_list))
        return future.result(timeout=900)


async def _mcp_disconnect_async(
    hub: "MCPHub",
    connected: Set[str],
    name: str,
    to_remove: Any,
) -> None:
    try:
        await to_remove.close()
    except Exception:
        pass
    hub.clients.remove(to_remove)
    try:
        await hub.discover_all_tools()
    except Exception:
        pass
    connected.discard(name)


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

    to_remove = None
    for client in hub.clients:
        if client.server_config.name == name:
            to_remove = client
            break
    if to_remove is None:
        connected.discard(name)
        return True

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_mcp_disconnect_async(hub, connected, name, to_remove))
    else:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(asyncio.run, _mcp_disconnect_async(hub, connected, name, to_remove)).result(timeout=60)

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


async def mcp_call_tool_async(
    hub: "MCPHub",
    tool_name: str,
    args_json: str,
    *,
    echo: bool = True,
) -> str:
    """Call an MCP tool via the hub. Use from async contexts (Studio agent loop, Desktop).

    On failure returns a string starting with ``ERROR: mcp_call:`` (never silent ``None``).

    Args:
        hub: Connected MCP hub with discovered tools.
        tool_name: Routed tool name as shown in ``hub._tool_routing``.
        args_json: JSON object string for tool arguments.
        echo: If True, print status and result to the Rich console (REPL). If False, only return.
    """
    if not hub._tool_routing:
        msg = _format_mcp_call_error("no MCP tools connected")
        if echo:
            console.print("[yellow]暂无已连接的 MCP 工具。[/yellow]")
        return msg

    if tool_name not in hub._tool_routing:
        keys = sorted(hub._tool_routing.keys())
        available = ", ".join(keys)
        if len(available) > 1600:
            available = available[:1597] + "..."
        detail = f"tool {tool_name!r} not connected"
        if available:
            detail += f"; available: {available}"
        else:
            detail += "; available: (none)"
        msg = _format_mcp_call_error(detail)
        if echo:
            console.print(f"[red]工具 '{tool_name}' 不存在。[/red]")
            console.print(f"[dim]可用工具: {available or '(无)'}[/dim]")
        return msg

    try:
        arguments = json.loads(args_json) if args_json.strip() else {}
    except json.JSONDecodeError as exc:
        msg = _format_mcp_call_error(f"invalid arguments JSON: {exc}")
        if echo:
            console.print(f"[red]参数 JSON 解析失败:[/red] {exc}")
        return msg

    try:
        raw_result = await hub.call_tool(tool_name, arguments)
        result_text = hub.extract_tool_result(tool_name, raw_result)
    except Exception as exc:
        msg = _format_mcp_call_error(_exception_detail_for_mcp_call(exc))
        if echo:
            console.print(f"[red]工具调用失败:[/red] {exc}")
        return msg

    result_str = str(result_text)
    if echo:
        console.print(f"[green]结果:[/green]\n{result_str}")
    return result_str


def mcp_call_tool(hub: "MCPHub", tool_name: str, args_json: str) -> str:
    """Call an MCP tool from a synchronous context (e.g. Studio REPL).

    Must not be used when an asyncio event loop is already running; use
    ``await mcp_call_tool_async(...)`` instead.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(mcp_call_tool_async(hub, tool_name, args_json, echo=True))
    raise RuntimeError(
        "mcp_call_tool() cannot run inside an active event loop; use await mcp_call_tool_async() instead."
    )


def build_mcp_tools_context(hub: "MCPHub") -> str:
    """Serialize connected MCP tools as text context for code generation."""
    if not hub._merged_tools:
        return ""
    parts = ["=== 可用的 MCP 工具 ===\n"]
    parts.append(
        "以下是用户已连接的 MCP 工具；`mcp_call` 的 `tool_name` 必须与下列名称**完全一致**。"
        "勿编造 `list_tools`、`list_pages`、`browse_to` 等；查看名称请用 `list_mcps` 返回的 `mcp_tool_names`。\n"
    )
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
