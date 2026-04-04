#!/usr/bin/env python3
"""Declarative hook system: JSON/YAML-driven hooks with 4 execution types.

Supports command (shell), http (webhook), prompt (model judge), and agent
(deep model reasoning) hook types.  Declarative hooks are loaded from
configuration and adapted into the runtime ``AgentHook`` interface so they
participate in the standard ``HookRegistry`` lifecycle without requiring
Python handler files.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import fnmatch
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration models
# ---------------------------------------------------------------------------

DeclarativeHookType = Literal["command", "http", "prompt", "agent"]
DeclarativeHookEvent = Literal[
    "before_tool_call",
    "after_tool_call",
    "session_start",
    "session_end",
    # Cursor/Claude compat aliases
    "preToolUse",
    "postToolUse",
]

_EVENT_ALIASES: Dict[str, str] = {
    "preToolUse": "before_tool_call",
    "postToolUse": "after_tool_call",
    "PreToolUse": "before_tool_call",
    "PostToolUse": "after_tool_call",
    "SessionStart": "session_start",
    "SessionEnd": "session_end",
}


class DeclarativeHookConfig(BaseModel):
    """One declarative hook entry."""

    event: str
    type: DeclarativeHookType = "command"
    matcher: Optional[str] = None
    block_on_failure: bool = False
    timeout_seconds: int = Field(default=30, ge=1, le=600)

    # command type
    command: Optional[str] = None

    # http type
    url: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)

    # prompt / agent type
    prompt: Optional[str] = None
    model: Optional[str] = None

    # metadata
    source: str = "agenticx"
    name: str = ""
    enabled: bool = True
    source_path: str = ""
    discovered_via: str = "hooks_json"
    event_inferred: bool = False

    def canonical_event(self) -> str:
        return _EVENT_ALIASES.get(self.event, self.event)


# ---------------------------------------------------------------------------
# Execution result
# ---------------------------------------------------------------------------


@dataclass
class DeclarativeHookResult:
    """Outcome of a single declarative hook execution."""

    hook_type: str
    success: bool
    output: str = ""
    blocked: bool = False
    reason: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AggregatedDeclarativeResult:
    """Aggregated result across multiple hooks for the same event."""

    results: List[DeclarativeHookResult] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return any(r.blocked for r in self.results)

    @property
    def reason(self) -> str:
        blocking = [r.reason for r in self.results if r.blocked and r.reason]
        return "; ".join(blocking) if blocking else ""


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class DeclarativeHookExecutor:
    """Execute declarative hooks by type."""

    def __init__(
        self,
        configs: List[DeclarativeHookConfig],
        *,
        llm_caller: Any = None,
        default_model: str = "",
    ) -> None:
        self._configs = configs
        self._llm_caller = llm_caller
        self._default_model = default_model

    @property
    def configs(self) -> List[DeclarativeHookConfig]:
        return self._configs

    def update_configs(self, configs: List[DeclarativeHookConfig]) -> None:
        self._configs = configs

    async def execute(
        self,
        event: str,
        payload: Dict[str, Any],
    ) -> AggregatedDeclarativeResult:
        canonical = _EVENT_ALIASES.get(event, event)
        results: List[DeclarativeHookResult] = []

        for cfg in self._configs:
            if not cfg.enabled:
                continue
            if cfg.canonical_event() != canonical:
                continue
            if not _matches(cfg.matcher, payload):
                continue

            if cfg.type == "command":
                results.append(await self._run_command(cfg, canonical, payload))
            elif cfg.type == "http":
                results.append(await self._run_http(cfg, canonical, payload))
            elif cfg.type in ("prompt", "agent"):
                results.append(await self._run_prompt(cfg, canonical, payload, agent_mode=(cfg.type == "agent")))
            else:
                logger.warning("Unknown declarative hook type: %s", cfg.type)

        return AggregatedDeclarativeResult(results=results)

    # -- command --

    async def _run_command(
        self,
        cfg: DeclarativeHookConfig,
        event: str,
        payload: Dict[str, Any],
    ) -> DeclarativeHookResult:
        if not cfg.command:
            return DeclarativeHookResult(hook_type="command", success=False, reason="No command specified")

        command = _inject_arguments(cfg.command, payload)
        env = {
            **os.environ,
            "AGX_HOOK_EVENT": event,
            "AGX_HOOK_PAYLOAD": json.dumps(payload, ensure_ascii=False, default=str),
        }

        try:
            process = await asyncio.create_subprocess_exec(
                "/bin/bash", "-lc", command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=cfg.timeout_seconds,
            )
        except asyncio.TimeoutError:
            if "process" in locals() and process.returncode is None:
                process.kill()
                with contextlib.suppress(Exception):
                    await process.communicate()
            return DeclarativeHookResult(
                hook_type="command",
                success=False,
                blocked=cfg.block_on_failure,
                reason=f"Command hook timed out after {cfg.timeout_seconds}s",
            )
        except Exception as exc:
            return DeclarativeHookResult(
                hook_type="command",
                success=False,
                blocked=cfg.block_on_failure,
                reason=str(exc),
            )

        output = "\n".join(
            part for part in (
                stdout.decode("utf-8", errors="replace").strip(),
                stderr.decode("utf-8", errors="replace").strip(),
            ) if part
        )
        success = process.returncode == 0
        return DeclarativeHookResult(
            hook_type="command",
            success=success,
            output=output,
            blocked=cfg.block_on_failure and not success,
            reason=output or f"Command exited with code {process.returncode}",
            metadata={"returncode": process.returncode},
        )

    # -- http --

    async def _run_http(
        self,
        cfg: DeclarativeHookConfig,
        event: str,
        payload: Dict[str, Any],
    ) -> DeclarativeHookResult:
        if not cfg.url:
            return DeclarativeHookResult(hook_type="http", success=False, reason="No URL specified")

        try:
            import httpx  # noqa: WPS433 - lazy import to avoid hard dependency
            async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
                response = await client.post(
                    cfg.url,
                    json={"event": event, "payload": payload},
                    headers=cfg.headers,
                )
            success = response.is_success
            output = response.text
            return DeclarativeHookResult(
                hook_type="http",
                success=success,
                output=output,
                blocked=cfg.block_on_failure and not success,
                reason=output or f"HTTP {response.status_code}",
                metadata={"status_code": response.status_code},
            )
        except Exception as exc:
            return DeclarativeHookResult(
                hook_type="http",
                success=False,
                blocked=cfg.block_on_failure,
                reason=str(exc),
            )

    # -- prompt / agent --

    async def _run_prompt(
        self,
        cfg: DeclarativeHookConfig,
        event: str,
        payload: Dict[str, Any],
        *,
        agent_mode: bool = False,
    ) -> DeclarativeHookResult:
        if not cfg.prompt:
            return DeclarativeHookResult(hook_type=cfg.type, success=False, reason="No prompt specified")
        if self._llm_caller is None:
            return DeclarativeHookResult(
                hook_type=cfg.type,
                success=True,
                reason="No LLM caller configured; skipping prompt/agent hook",
            )

        prompt_text = _inject_arguments(cfg.prompt, payload)
        system_prefix = (
            "You are validating whether a hook condition passes. "
            'Return strict JSON: {"ok": true} or {"ok": false, "reason": "..."}.'
        )
        if agent_mode:
            system_prefix += " Be thorough and reason over the payload before deciding."

        try:
            model = cfg.model or self._default_model
            text = await self._llm_caller(system_prefix, prompt_text, model)
            parsed = _parse_hook_json(text)
            if parsed["ok"]:
                return DeclarativeHookResult(hook_type=cfg.type, success=True, output=text)
            return DeclarativeHookResult(
                hook_type=cfg.type,
                success=False,
                output=text,
                blocked=cfg.block_on_failure,
                reason=parsed.get("reason", "Hook rejected the event"),
            )
        except Exception as exc:
            return DeclarativeHookResult(
                hook_type=cfg.type,
                success=False,
                blocked=cfg.block_on_failure,
                reason=str(exc),
            )


# ---------------------------------------------------------------------------
# Runtime AgentHook adapter
# ---------------------------------------------------------------------------


def create_declarative_agent_hook(
    configs: List[DeclarativeHookConfig],
    *,
    llm_caller: Any = None,
    default_model: str = "",
) -> "DeclarativeAgentHook":
    """Factory: build a runtime AgentHook backed by declarative configs."""
    executor = DeclarativeHookExecutor(
        configs,
        llm_caller=llm_caller,
        default_model=default_model,
    )
    return DeclarativeAgentHook(executor)


class DeclarativeAgentHook:
    """Adapts ``DeclarativeHookExecutor`` to the ``AgentHook`` interface.

    Import ``AgentHook`` / ``HookOutcome`` lazily to avoid circular deps.
    """

    def __init__(self, executor: DeclarativeHookExecutor) -> None:
        self._executor = executor

    @property
    def executor(self) -> DeclarativeHookExecutor:
        return self._executor

    async def before_model(
        self,
        messages: Sequence[Dict[str, Any]],
        session: Any,
    ) -> Optional[Sequence[Dict[str, Any]]]:
        return None

    async def after_model(self, response: Any, session: Any) -> None:
        return None

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session: Any,
    ) -> Any:
        from agenticx.runtime.hooks import HookOutcome

        result = await self._executor.execute(
            "before_tool_call",
            {"tool_name": tool_name, "tool_input": arguments},
        )
        if result.blocked:
            return HookOutcome(blocked=True, reason=result.reason)
        return None

    async def after_tool_call(
        self,
        tool_name: str,
        result: str,
        session: Any,
    ) -> Optional[str]:
        await self._executor.execute(
            "after_tool_call",
            {"tool_name": tool_name, "tool_output": result},
        )
        return None

    async def on_compaction(self, compacted_count: int, summary: str, session: Any) -> None:
        return None

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        await self._executor.execute("session_end", {"final_text": final_text})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _matches(matcher: Optional[str], payload: Dict[str, Any]) -> bool:
    if not matcher:
        return True
    subject = str(
        payload.get("tool_name")
        or payload.get("prompt")
        or payload.get("event")
        or ""
    )
    return fnmatch.fnmatch(subject, matcher)


def _inject_arguments(template: str, payload: Dict[str, Any]) -> str:
    return template.replace("$ARGUMENTS", json.dumps(payload, ensure_ascii=False, default=str))


def _parse_hook_json(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and isinstance(parsed.get("ok"), bool):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    lowered = text.strip().lower()
    if lowered in {"ok", "true", "yes"}:
        return {"ok": True}
    return {"ok": False, "reason": text.strip() or "Hook returned invalid JSON"}


# ---------------------------------------------------------------------------
# Config parsing helpers
# ---------------------------------------------------------------------------


def parse_cursor_hooks_json(path: str | os.PathLike[str]) -> List[DeclarativeHookConfig]:
    """Parse a Cursor/Claude Code ``hooks.json`` file into declarative configs."""
    filepath = Path(path) if not isinstance(path, Path) else path
    if not filepath.exists():
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []

    if not isinstance(data, dict):
        return []

    source = _infer_source_from_path(filepath)
    configs: List[DeclarativeHookConfig] = []

    # Cursor plugin format: {"hooks": {"PostToolUse":[{"matcher":"...","hooks":[...]}]}}
    if isinstance(data.get("hooks"), dict):
        event_map = data.get("hooks", {})
        for event_key, groups in event_map.items():
            if not isinstance(groups, list):
                continue
            canonical = _EVENT_ALIASES.get(event_key, event_key)
            for group_idx, group in enumerate(groups):
                if not isinstance(group, dict):
                    continue
                matcher = group.get("matcher")
                nested_hooks = group.get("hooks")
                if not isinstance(nested_hooks, list):
                    continue
                for hook_idx, hook_entry in enumerate(nested_hooks):
                    try:
                        if isinstance(hook_entry, str):
                            configs.append(DeclarativeHookConfig(
                                event=canonical,
                                type="command",
                                command=hook_entry,
                                matcher=matcher,
                                source=source,
                                name=f"{source}-{event_key}-{group_idx}-{hook_idx}",
                                source_path=str(filepath),
                                discovered_via="hooks_json",
                            ))
                        elif isinstance(hook_entry, dict):
                            hook_type = hook_entry.get("type", "command")
                            configs.append(DeclarativeHookConfig(
                                event=canonical,
                                type=hook_type,
                                command=hook_entry.get("command"),
                                url=hook_entry.get("url"),
                                headers=hook_entry.get("headers", {}),
                                prompt=hook_entry.get("prompt"),
                                model=hook_entry.get("model"),
                                matcher=hook_entry.get("matcher") or matcher,
                                block_on_failure=hook_entry.get("block_on_failure", False),
                                timeout_seconds=hook_entry.get("timeout_seconds", hook_entry.get("timeout", 30)),
                                source=source,
                                name=hook_entry.get("name", f"{source}-{event_key}-{group_idx}-{hook_idx}"),
                                enabled=hook_entry.get("enabled", True),
                                source_path=str(filepath),
                                discovered_via="hooks_json",
                                event_inferred=False,
                            ))
                    except Exception as exc:
                        logger.warning(
                            "Invalid nested hook entry in %s (%s[%d][%d]): %s",
                            filepath,
                            event_key,
                            group_idx,
                            hook_idx,
                            exc,
                        )
        return configs

    # Flat format: {"preToolUse":[...], "postToolUse":[...]}
    for event_key, hooks_list in data.items():
        if not isinstance(hooks_list, list):
            continue
        canonical = _EVENT_ALIASES.get(event_key, event_key)
        for idx, entry in enumerate(hooks_list):
            try:
                if isinstance(entry, str):
                    configs.append(DeclarativeHookConfig(
                        event=canonical,
                        type="command",
                        command=entry,
                        source=source,
                        name=f"{source}-{event_key}-{idx}",
                        source_path=str(filepath),
                        discovered_via="hooks_json",
                    ))
                elif isinstance(entry, dict):
                    hook_type = entry.get("type", "command")
                    configs.append(DeclarativeHookConfig(
                        event=canonical,
                        type=hook_type,
                        command=entry.get("command"),
                        url=entry.get("url"),
                        headers=entry.get("headers", {}),
                        prompt=entry.get("prompt"),
                        model=entry.get("model"),
                        matcher=entry.get("matcher"),
                        block_on_failure=entry.get("block_on_failure", False),
                        timeout_seconds=entry.get("timeout_seconds", entry.get("timeout", 30)),
                        source=source,
                        name=entry.get("name", f"{source}-{event_key}-{idx}"),
                        enabled=entry.get("enabled", True),
                        source_path=str(filepath),
                        discovered_via="hooks_json",
                        event_inferred=False,
                    ))
            except Exception as exc:
                logger.warning("Invalid hook entry in %s (%s[%d]): %s", filepath, event_key, idx, exc)
    return configs


def parse_agenticx_declarative_yaml(data: List[Dict[str, Any]], source: str = "agenticx") -> List[DeclarativeHookConfig]:
    """Parse the ``hooks.declarative`` list from ``config.yaml``."""
    configs: List[DeclarativeHookConfig] = []
    for idx, entry in enumerate(data):
        if not isinstance(entry, dict):
            continue
        try:
            cfg = DeclarativeHookConfig(
                event=entry.get("event", "before_tool_call"),
                type=entry.get("type", "command"),
                command=entry.get("command"),
                url=entry.get("url"),
                headers=entry.get("headers", {}),
                prompt=entry.get("prompt"),
                model=entry.get("model"),
                matcher=entry.get("matcher"),
                block_on_failure=entry.get("block_on_failure", False),
                timeout_seconds=entry.get("timeout_seconds", 30),
                source=source,
                name=entry.get("name", f"{source}-declarative-{idx}"),
                enabled=entry.get("enabled", True),
                source_path="~/.agenticx/config.yaml",
                discovered_via="declarative_config",
            )
            configs.append(cfg)
        except Exception as exc:
            logger.warning("Invalid declarative hook entry #%d: %s", idx, exc)
    return configs


def parse_hook_script_files(
    script_paths: List[Path],
    *,
    source: str = "claude_plugins",
) -> List[DeclarativeHookConfig]:
    """Adapt ``scripts/hooks/*.js`` files into command hooks."""
    configs: List[DeclarativeHookConfig] = []
    for idx, script in enumerate(script_paths):
        if not script.exists() or script.suffix.lower() != ".js":
            continue
        event, inferred = _infer_event_from_script_name(script.name)
        cfg = DeclarativeHookConfig(
            event=event,
            type="command",
            command=f'node "{script}"',
            source=source,
            name=f"{source}-script-{script.stem}-{idx}",
            enabled=True,
            source_path=str(script),
            discovered_via="script_scan",
            event_inferred=inferred,
        )
        configs.append(cfg)
    return configs


def _infer_source_from_path(filepath: Path) -> str:
    parts = filepath.resolve().parts
    for part in parts:
        if part == ".cursor":
            return "cursor"
        if part == ".claude":
            return "claude"
        if part == ".openharness":
            return "openharness"
        if part == ".agenticx":
            return "agenticx"
    return "custom"


def _infer_event_from_script_name(filename: str) -> tuple[str, bool]:
    lower = filename.strip().lower()
    if lower == "session-start.js":
        return "session_start", False
    if lower == "session-end.js":
        return "session_end", False
    if lower == "pre-compact.js":
        return "preToolUse", True
    if lower in {"evaluate-session.js", "suggest-compact.js"}:
        return "postToolUse", True
    return "postToolUse", True


from pathlib import Path as Path  # noqa: E402 - re-export for parse helpers
