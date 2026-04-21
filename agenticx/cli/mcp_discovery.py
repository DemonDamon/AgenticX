#!/usr/bin/env python3
"""Discover MCP configurations from common local AI tools."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Literal, Optional

import json5
import yaml

from agenticx.cli.studio_mcp import agenticx_home_mcp_path

try:
    import tomllib  # py311+
except Exception:  # pragma: no cover - py310 fallback
    import tomli as tomllib  # type: ignore


FormatType = Literal["json", "json5", "yaml", "toml", "detect-only"]


@dataclass
class DiscoveredServer:
    name: str
    command: Optional[str]
    args: List[str]
    env: Dict[str, str]
    url: Optional[str]
    headers: Dict[str, str]
    timeout: Optional[float]


@dataclass
class BrandHit:
    brand: str
    display_name: str
    icon: str
    path: str
    format: FormatType
    exists: bool
    parse_ok: bool
    server_count: int
    servers: List[DiscoveredServer]
    parse_error: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class _BrandSpec:
    brand: str
    display_name: str
    icon: str
    format: FormatType
    paths: tuple[str, ...]
    key_path: str


_CATEGORY_SPECS: tuple[_BrandSpec, ...] = (
    _BrandSpec("agenticx", "AgenticX", "agenticx", "json", ("~/.agenticx/mcp.json",), "mcpServers_or_root"),
    _BrandSpec("cursor", "Cursor", "cursor", "json", ("{CWD}/.cursor/mcp.json", "~/.cursor/mcp.json"), "mcpServers"),
    _BrandSpec(
        "claude_desktop",
        "Claude Desktop",
        "claude",
        "json",
        (
            "~/Library/Application Support/Claude/claude_desktop_config.json",
            "%APPDATA%/Claude/claude_desktop_config.json",
            "~/.config/Claude/claude_desktop_config.json",
        ),
        "mcpServers",
    ),
    _BrandSpec(
        "claude_code",
        "Claude Code",
        "claude",
        "json",
        ("~/.claude.json", "~/.claude/settings.json"),
        "mcpServers",
    ),
    _BrandSpec("trae", "Trae", "trae", "json", ("{CWD}/.trae/mcp.json", "~/.trae/mcp.json"), "mcpServers"),
    _BrandSpec("openclaw", "OpenClaw", "openclaw", "json5", ("~/.config/openclaw/openclaw.json5",), "mcp.servers"),
    _BrandSpec("hermes", "Hermes Agent", "hermes", "yaml", ("~/.hermes/config.yaml",), "mcp_servers"),
    _BrandSpec("codex", "Codex CLI", "codex", "toml", ("~/.codex/config.toml",), "mcp_servers"),
    _BrandSpec("windsurf", "Windsurf", "windsurf", "json", ("~/.codeium/windsurf/mcp_config.json",), "mcpServers"),
    _BrandSpec("continue", "Continue", "continue", "json", ("~/.continue/config.json",), "mcpServers"),
    _BrandSpec("continue", "Continue", "continue", "yaml", ("~/.continue/config.yaml",), "mcpServers"),
    _BrandSpec(
        "cline",
        "Cline",
        "cline",
        "json",
        (
            "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
            "%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
            "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        ),
        "mcpServers",
    ),
    _BrandSpec(
        "zed",
        "Zed",
        "zed",
        "json",
        ("~/.config/zed/settings.json", "%APPDATA%/Zed/settings.json"),
        "context_servers",
    ),
    _BrandSpec(
        "vscode",
        "VS Code",
        "vscode",
        "json",
        (
            "~/Library/Application Support/Code/User/settings.json",
            "%APPDATA%/Code/User/settings.json",
            "~/.config/Code/User/settings.json",
        ),
        "mcp.servers",
    ),
    _BrandSpec("gemini_cli", "Gemini CLI", "gemini", "json", ("~/.gemini/settings.json",), "mcpServers"),
    _BrandSpec(
        "cherry_studio",
        "Cherry Studio",
        "cherry",
        "detect-only",
        (
            "~/Library/Application Support/CherryStudioDev",
            "~/Library/Application Support/CherryStudio",
            "%APPDATA%/CherryStudio",
            "~/.config/CherryStudio",
        ),
        "detect-only",
    ),
)


def _expand_path(path_template: str, cwd: Path, env: Dict[str, str]) -> Path:
    path = path_template.replace("{CWD}", str(cwd))
    for k, v in env.items():
        path = path.replace(f"%{k}%", v)
    path = os.path.expandvars(path)
    if path.startswith("~/"):
        path = str(Path.home() / path[2:])
    elif path == "~":
        path = str(Path.home())
    return Path(path)


def _load_raw(path: Path, fmt: FormatType) -> Any:
    text = path.read_text(encoding="utf-8")
    if fmt == "json":
        return json.loads(text)
    if fmt == "json5":
        return json5.loads(text)
    if fmt == "yaml":
        return yaml.safe_load(text) or {}
    if fmt == "toml":
        return tomllib.loads(text)
    return {}


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _coerce_server(name: str, payload: Any) -> DiscoveredServer:
    if not isinstance(payload, dict):
        payload = {}
    command = payload.get("command")
    url = payload.get("url")
    args_raw = payload.get("args") or []
    env_raw = payload.get("env") or {}
    headers_raw = payload.get("headers") or payload.get("http_headers") or {}
    return DiscoveredServer(
        name=str(name),
        command=str(command) if command is not None else None,
        args=[str(x) for x in args_raw] if isinstance(args_raw, list) else [],
        env={str(k): str(v) for k, v in env_raw.items()} if isinstance(env_raw, dict) else {},
        url=str(url) if url is not None else None,
        headers={str(k): str(v) for k, v in headers_raw.items()} if isinstance(headers_raw, dict) else {},
        timeout=_safe_float(payload.get("timeout") or payload.get("tool_timeout_sec") or payload.get("startup_timeout_sec")),
    )


def _extract_servers(data: Any, key_path: str) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    if key_path == "mcpServers_or_root":
        mcp = data.get("mcpServers")
        if isinstance(mcp, dict):
            return mcp
        return data
    if key_path == "mcpServers":
        val = data.get("mcpServers")
        return val if isinstance(val, dict) else {}
    if key_path == "mcp.servers":
        mcp = data.get("mcp")
        if not isinstance(mcp, dict):
            return {}
        val = mcp.get("servers")
        return val if isinstance(val, dict) else {}
    if key_path == "mcp_servers":
        val = data.get("mcp_servers")
        return val if isinstance(val, dict) else {}
    if key_path == "context_servers":
        val = data.get("context_servers")
        return val if isinstance(val, dict) else {}
    return {}


def _read_brand(spec: _BrandSpec, *, cwd: Path, env: Dict[str, str]) -> BrandHit:
    candidates = tuple(_expand_path(p, cwd, env) for p in spec.paths)
    existing_path: Optional[Path] = next((p for p in candidates if p.exists()), None)
    selected = existing_path or candidates[0]
    selected_str = str(selected)
    if spec.brand == "agenticx":
        selected_str = str(agenticx_home_mcp_path().expanduser())

    if spec.format == "detect-only":
        exists = any(p.exists() for p in candidates)
        path_str = str(existing_path or candidates[0])
        return BrandHit(
            brand=spec.brand,
            display_name=spec.display_name,
            icon=spec.icon,
            path=path_str,
            format=spec.format,
            exists=exists,
            parse_ok=exists,
            server_count=0,
            servers=[],
            parse_error=None,
        )

    if existing_path is None:
        return BrandHit(
            brand=spec.brand,
            display_name=spec.display_name,
            icon=spec.icon,
            path=selected_str,
            format=spec.format,
            exists=False,
            parse_ok=False,
            server_count=0,
            servers=[],
            parse_error=None,
        )

    try:
        raw = _load_raw(existing_path, spec.format)
        servers_obj = _extract_servers(raw, spec.key_path)
        if not isinstance(servers_obj, dict):
            raise ValueError(f"Invalid MCP structure for key path: {spec.key_path}")
        servers = [_coerce_server(name, payload) for name, payload in servers_obj.items()]
        return BrandHit(
            brand=spec.brand,
            display_name=spec.display_name,
            icon=spec.icon,
            path=str(existing_path),
            format=spec.format,
            exists=True,
            parse_ok=True,
            server_count=len(servers),
            servers=servers,
            parse_error=None,
        )
    except Exception as exc:
        return BrandHit(
            brand=spec.brand,
            display_name=spec.display_name,
            icon=spec.icon,
            path=str(existing_path),
            format=spec.format,
            exists=True,
            parse_ok=False,
            server_count=0,
            servers=[],
            parse_error=str(exc),
        )


def _unique_brands(specs: Iterable[_BrandSpec]) -> List[str]:
    out: List[str] = []
    for spec in specs:
        if spec.brand not in out:
            out.append(spec.brand)
    return out


def detect_all(cwd: Path | None = None) -> List[BrandHit]:
    """Discover local MCP settings from common AI tool locations."""
    workdir = (cwd or Path.cwd()).expanduser()
    env = dict(os.environ)
    grouped: Dict[str, List[_BrandSpec]] = {}
    for spec in _CATEGORY_SPECS:
        grouped.setdefault(spec.brand, []).append(spec)

    hits: List[BrandHit] = []
    for brand in _unique_brands(_CATEGORY_SPECS):
        specs = grouped[brand]
        fallback_hit: Optional[BrandHit] = None
        picked: Optional[BrandHit] = None
        for spec in specs:
            hit = _read_brand(spec, cwd=workdir, env=env)
            if fallback_hit is None:
                fallback_hit = hit
            if hit.exists:
                picked = hit
                break
        hits.append(picked or fallback_hit)  # type: ignore[arg-type]
    return hits
