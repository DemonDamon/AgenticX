#!/usr/bin/env python3
"""Smoke tests for OpenHarness-inspired features.

Covers declarative hooks (4 types), path policy, plan mode, and command deny.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Declarative hook config parsing
# ---------------------------------------------------------------------------


class TestDeclarativeHookConfig:
    def test_command_hook_config(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="echo test",
            matcher="bash*",
            block_on_failure=True,
        )
        assert cfg.canonical_event() == "before_tool_call"
        assert cfg.type == "command"
        assert cfg.command == "echo test"
        assert cfg.matcher == "bash*"
        assert cfg.block_on_failure is True

    def test_http_hook_config(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig

        cfg = DeclarativeHookConfig(
            event="after_tool_call",
            type="http",
            url="https://example.com/hook",
            headers={"Authorization": "Bearer xxx"},
        )
        assert cfg.canonical_event() == "after_tool_call"
        assert cfg.url == "https://example.com/hook"

    def test_prompt_hook_config(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="prompt",
            prompt="Is this safe? $ARGUMENTS",
            model="gpt-4",
            block_on_failure=True,
        )
        assert cfg.type == "prompt"
        assert "$ARGUMENTS" in cfg.prompt

    def test_agent_hook_config(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="agent",
            prompt="Deeply analyze: $ARGUMENTS",
            timeout_seconds=60,
        )
        assert cfg.type == "agent"
        assert cfg.timeout_seconds == 60

    def test_cursor_event_alias(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig

        cfg = DeclarativeHookConfig(event="preToolUse", type="command", command="echo hi")
        assert cfg.canonical_event() == "before_tool_call"

        cfg2 = DeclarativeHookConfig(event="postToolUse", type="command", command="echo bye")
        assert cfg2.canonical_event() == "after_tool_call"


# ---------------------------------------------------------------------------
# Cursor hooks.json parsing
# ---------------------------------------------------------------------------


class TestCursorHooksParsing:
    def test_parse_cursor_hooks_json(self, tmp_path):
        from agenticx.hooks.declarative import parse_cursor_hooks_json

        hooks_json = tmp_path / "hooks.json"
        hooks_json.write_text(json.dumps({
            "preToolUse": [
                'node -e "console.log(\'hello\')"',
                {"type": "command", "command": "echo check", "matcher": "Bash*", "block_on_failure": True},
            ],
            "postToolUse": [
                'node -e "console.log(\'done\')"',
            ],
        }))

        configs = parse_cursor_hooks_json(hooks_json)
        assert len(configs) == 3
        assert configs[0].canonical_event() == "before_tool_call"
        assert configs[0].type == "command"
        assert 'console.log' in (configs[0].command or "")
        assert configs[1].matcher == "Bash*"
        assert configs[1].block_on_failure is True
        assert configs[2].canonical_event() == "after_tool_call"

    def test_parse_nonexistent_file(self, tmp_path):
        from agenticx.hooks.declarative import parse_cursor_hooks_json

        configs = parse_cursor_hooks_json(tmp_path / "nonexistent.json")
        assert configs == []

    def test_source_inference(self, tmp_path):
        from agenticx.hooks.declarative import parse_cursor_hooks_json

        cursor_dir = tmp_path / ".cursor" / "hooks"
        cursor_dir.mkdir(parents=True)
        hooks_json = cursor_dir / "hooks.json"
        hooks_json.write_text(json.dumps({"preToolUse": ["echo cursor"]}))

        configs = parse_cursor_hooks_json(hooks_json)
        assert len(configs) == 1
        assert configs[0].source == "cursor"

    def test_parse_cursor_plugin_nested_hooks_json(self, tmp_path):
        from agenticx.hooks.declarative import parse_cursor_hooks_json

        hooks_json = tmp_path / "hooks.json"
        hooks_json.write_text(
            json.dumps(
                {
                    "hooks": {
                        "PostToolUse": [
                            {
                                "matcher": "Bash",
                                "hooks": [
                                    {
                                        "type": "command",
                                        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse-observe.mjs\"",
                                        "timeout": 5,
                                    }
                                ],
                            }
                        ],
                        "SessionEnd": [
                            {
                                "hooks": [
                                    {
                                        "type": "command",
                                        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end-cleanup.mjs\"",
                                    }
                                ]
                            }
                        ],
                    }
                }
            ),
            encoding="utf-8",
        )

        configs = parse_cursor_hooks_json(hooks_json)
        assert len(configs) == 2
        assert configs[0].event == "after_tool_call"
        assert configs[0].matcher == "Bash"
        assert configs[0].timeout_seconds == 5
        assert configs[1].event == "session_end"


# ---------------------------------------------------------------------------
# Declarative hook executor - command type
# ---------------------------------------------------------------------------


class TestDeclarativeHookExecutor:
    @pytest.mark.asyncio
    async def test_command_hook_success(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, DeclarativeHookExecutor

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="echo ok",
        )
        executor = DeclarativeHookExecutor([cfg])
        result = await executor.execute("before_tool_call", {"tool_name": "bash"})
        assert not result.blocked
        assert len(result.results) == 1
        assert result.results[0].success is True
        assert "ok" in result.results[0].output

    @pytest.mark.asyncio
    async def test_command_hook_failure_blocks(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, DeclarativeHookExecutor

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="exit 1",
            block_on_failure=True,
        )
        executor = DeclarativeHookExecutor([cfg])
        result = await executor.execute("before_tool_call", {"tool_name": "bash"})
        assert result.blocked
        assert result.results[0].success is False

    @pytest.mark.asyncio
    async def test_command_hook_matcher_skip(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, DeclarativeHookExecutor

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="echo should-not-run",
            matcher="web_*",
        )
        executor = DeclarativeHookExecutor([cfg])
        result = await executor.execute("before_tool_call", {"tool_name": "bash"})
        assert len(result.results) == 0

    @pytest.mark.asyncio
    async def test_command_hook_event_mismatch(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, DeclarativeHookExecutor

        cfg = DeclarativeHookConfig(
            event="after_tool_call",
            type="command",
            command="echo nope",
        )
        executor = DeclarativeHookExecutor([cfg])
        result = await executor.execute("before_tool_call", {"tool_name": "bash"})
        assert len(result.results) == 0

    @pytest.mark.asyncio
    async def test_disabled_hook_skipped(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, DeclarativeHookExecutor

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="echo skip-me",
            enabled=False,
        )
        executor = DeclarativeHookExecutor([cfg])
        result = await executor.execute("before_tool_call", {"tool_name": "bash"})
        assert len(result.results) == 0


# ---------------------------------------------------------------------------
# DeclarativeAgentHook adapter
# ---------------------------------------------------------------------------


class TestDeclarativeAgentHook:
    @pytest.mark.asyncio
    async def test_before_tool_call_pass(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, create_declarative_agent_hook

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="echo pass",
        )
        hook = create_declarative_agent_hook([cfg])
        outcome = await hook.before_tool_call("bash", {"command": "ls"}, None)
        assert outcome is None  # not blocked

    @pytest.mark.asyncio
    async def test_before_tool_call_blocked(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig, create_declarative_agent_hook

        cfg = DeclarativeHookConfig(
            event="before_tool_call",
            type="command",
            command="exit 1",
            block_on_failure=True,
        )
        hook = create_declarative_agent_hook([cfg])
        outcome = await hook.before_tool_call("bash", {"command": "rm -rf /"}, None)
        assert outcome is not None
        assert outcome.blocked is True


# ---------------------------------------------------------------------------
# Path policy layer
# ---------------------------------------------------------------------------


class TestPathPolicyLayer:
    def test_deny_matching_path(self):
        from agenticx.tools.policy import PathPolicyLayer, PolicyAction

        layer = PathPolicyLayer(rules=[{"pattern": "/etc/*", "allow": False}])
        result = layer.evaluate("file_write", file_path="/etc/passwd")
        assert result == PolicyAction.DENY

    def test_allow_matching_path(self):
        from agenticx.tools.policy import PathPolicyLayer, PolicyAction

        layer = PathPolicyLayer(rules=[{"pattern": "/home/*", "allow": True}])
        result = layer.evaluate("file_write", file_path="/home/user/file.txt")
        assert result == PolicyAction.ALLOW

    def test_no_file_path_returns_none(self):
        from agenticx.tools.policy import PathPolicyLayer

        layer = PathPolicyLayer(rules=[{"pattern": "/etc/*", "allow": False}])
        result = layer.evaluate("file_write")
        assert result is None

    def test_no_match_returns_none(self):
        from agenticx.tools.policy import PathPolicyLayer

        layer = PathPolicyLayer(rules=[{"pattern": "/etc/*", "allow": False}])
        result = layer.evaluate("file_write", file_path="/home/user/file.txt")
        assert result is None


# ---------------------------------------------------------------------------
# Plan mode layer
# ---------------------------------------------------------------------------


class TestPlanModeLayer:
    def test_inactive_returns_none(self):
        from agenticx.tools.policy import PlanModeLayer

        layer = PlanModeLayer(active=False)
        result = layer.evaluate("file_write")
        assert result is None

    def test_active_denies_mutating_tool(self):
        from agenticx.tools.policy import PlanModeLayer, PolicyAction

        layer = PlanModeLayer(active=True)
        result = layer.evaluate("file_write")
        assert result == PolicyAction.DENY

    def test_active_allows_read_only_tool(self):
        from agenticx.tools.policy import PlanModeLayer, PolicyAction

        layer = PlanModeLayer(active=True)
        result = layer.evaluate("file_read")
        assert result == PolicyAction.ALLOW

    def test_active_allows_is_read_only_flag(self):
        from agenticx.tools.policy import PlanModeLayer, PolicyAction

        layer = PlanModeLayer(active=True)
        result = layer.evaluate("custom_tool", is_read_only=True)
        assert result == PolicyAction.ALLOW


# ---------------------------------------------------------------------------
# Command deny layer
# ---------------------------------------------------------------------------


class TestCommandDenyLayer:
    def test_deny_matching_command(self):
        from agenticx.tools.policy import CommandDenyLayer, PolicyAction

        layer = CommandDenyLayer(patterns=["rm -rf *"])
        result = layer.evaluate("bash", command="rm -rf /")
        assert result == PolicyAction.DENY

    def test_no_command_returns_none(self):
        from agenticx.tools.policy import CommandDenyLayer

        layer = CommandDenyLayer(patterns=["rm -rf *"])
        result = layer.evaluate("bash")
        assert result is None

    def test_no_match_returns_none(self):
        from agenticx.tools.policy import CommandDenyLayer

        layer = CommandDenyLayer(patterns=["rm -rf *"])
        result = layer.evaluate("bash", command="ls -la")
        assert result is None

    def test_empty_patterns_returns_none(self):
        from agenticx.tools.policy import CommandDenyLayer

        layer = CommandDenyLayer(patterns=[])
        result = layer.evaluate("bash", command="rm -rf /")
        assert result is None


# ---------------------------------------------------------------------------
# Hook search paths
# ---------------------------------------------------------------------------


class TestBuildHookSearchPaths:
    def test_default_includes_core(self):
        from agenticx.hooks.loader import build_hook_search_paths

        paths = build_hook_search_paths()
        sources = [s for s, _ in paths]
        assert "bundled" in sources
        assert "managed" in sources
        assert "cursor_plugins" in sources
        assert "claude_plugins" in sources
        assert "cursor" not in sources
        assert "claude" not in sources

    def test_preset_disabled(self):
        from agenticx.hooks.loader import build_hook_search_paths

        paths = build_hook_search_paths(
            preset_settings={
                "cursor_plugins": {"enabled": False},
                "claude_plugins": {"enabled": False},
            },
        )
        sources = [s for s, _ in paths]
        assert "cursor_plugins" not in sources
        assert "claude_plugins" not in sources

    def test_custom_paths_included(self, tmp_path):
        from agenticx.hooks.loader import build_hook_search_paths

        paths = build_hook_search_paths(custom_paths=[str(tmp_path)])
        sources = [s for s, _ in paths]
        assert "custom" in sources

    def test_workspace_path(self, tmp_path):
        from agenticx.hooks.loader import build_hook_search_paths

        paths = build_hook_search_paths(workspace_dir=tmp_path)
        sources = [s for s, _ in paths]
        assert "workspace" in sources


# ---------------------------------------------------------------------------
# Aggregated result logic
# ---------------------------------------------------------------------------


class TestAggregatedResult:
    def test_blocked_if_any_blocked(self):
        from agenticx.hooks.declarative import AggregatedDeclarativeResult, DeclarativeHookResult

        r1 = DeclarativeHookResult(hook_type="command", success=True)
        r2 = DeclarativeHookResult(hook_type="command", success=False, blocked=True, reason="denied")
        agg = AggregatedDeclarativeResult(results=[r1, r2])
        assert agg.blocked is True
        assert "denied" in agg.reason

    def test_not_blocked_if_none_blocked(self):
        from agenticx.hooks.declarative import AggregatedDeclarativeResult, DeclarativeHookResult

        r1 = DeclarativeHookResult(hook_type="command", success=True)
        r2 = DeclarativeHookResult(hook_type="http", success=True)
        agg = AggregatedDeclarativeResult(results=[r1, r2])
        assert agg.blocked is False


# ---------------------------------------------------------------------------
# Recursive discovery and script adaptation
# ---------------------------------------------------------------------------


class TestRecursiveHookDiscovery:
    def test_discover_hooks_json_recursively(self, tmp_path):
        from agenticx.hooks.loader import discover_declarative_hooks

        plugin_dir = tmp_path / "cache" / "everything-claude-code" / "hooks"
        plugin_dir.mkdir(parents=True, exist_ok=True)
        hooks_json = plugin_dir / "hooks.json"
        hooks_json.write_text(json.dumps({"preToolUse": ["echo from-json"]}), encoding="utf-8")

        configs = discover_declarative_hooks(
            workspace_dir=None,
            preset_settings={"claude_plugins": {"enabled": False}},
            custom_paths=[str(tmp_path)],
        )
        assert any(c.command and "from-json" in c.command for c in configs)
        assert any(c.discovered_via == "hooks_json" for c in configs)

    def test_discover_script_hooks_recursively(self, tmp_path):
        from agenticx.hooks.loader import discover_declarative_hooks

        scripts_dir = tmp_path / "cache" / "everything-claude-code" / "scripts" / "hooks"
        scripts_dir.mkdir(parents=True, exist_ok=True)
        script = scripts_dir / "evaluate-session.js"
        script.write_text("console.log('ok')", encoding="utf-8")

        configs = discover_declarative_hooks(
            workspace_dir=None,
            preset_settings={"claude_plugins": {"enabled": False}},
            custom_paths=[str(tmp_path)],
        )
        matched = [c for c in configs if c.source_path.endswith("evaluate-session.js")]
        assert matched, "expected evaluate-session.js to be discovered as script hook"
        assert matched[0].type == "command"
        assert matched[0].discovered_via == "script_scan"
        assert matched[0].event_inferred is True

    def test_discover_cursor_plugin_nested_hooks_json(self, tmp_path):
        from agenticx.hooks.loader import discover_declarative_hooks

        hooks_dir = tmp_path / "cache" / "cursor-public" / "vercel" / "abc123" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        (hooks_dir / "hooks.json").write_text(
            json.dumps(
                {
                    "hooks": {
                        "PostToolUse": [
                            {
                                "matcher": "Bash",
                                "hooks": [{"type": "command", "command": "node hook-a.mjs", "timeout": 5}],
                            }
                        ],
                    }
                }
            ),
            encoding="utf-8",
        )

        configs = discover_declarative_hooks(
            workspace_dir=None,
            preset_settings={"cursor_plugins": {"enabled": False}, "claude_plugins": {"enabled": False}},
            custom_paths=[str(tmp_path)],
        )
        assert any(c.command == "node hook-a.mjs" for c in configs)


# ---------------------------------------------------------------------------
# Parallel tools config helper
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Deduplication and classification
# ---------------------------------------------------------------------------


class TestDeduplicateHooks:
    def test_dedup_merges_same_command(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig
        from agenticx.hooks.loader import deduplicate_hooks

        c1 = DeclarativeHookConfig(event="before_tool_call", type="command", command="node /a/hooks/evaluate-session.js", source="cursor")
        c2 = DeclarativeHookConfig(event="before_tool_call", type="command", command="node /b/hooks/evaluate-session.js", source="claude")
        result = deduplicate_hooks([c1, c2])
        assert len(result) == 1
        assert result[0]["duplicate_count"] == 2
        assert set(result[0]["duplicate_sources"]) == {"cursor", "claude"}

    def test_dedup_different_events_kept_separate(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig
        from agenticx.hooks.loader import deduplicate_hooks

        c1 = DeclarativeHookConfig(event="before_tool_call", type="command", command="node hooks/a.js", source="cursor")
        c2 = DeclarativeHookConfig(event="after_tool_call", type="command", command="node hooks/a.js", source="cursor")
        result = deduplicate_hooks([c1, c2])
        assert len(result) == 2

    def test_dedup_empty(self):
        from agenticx.hooks.loader import deduplicate_hooks

        assert deduplicate_hooks([]) == []


class TestClassifyHook:
    def test_native_command(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig
        from agenticx.hooks.loader import classify_hook

        cfg = DeclarativeHookConfig(event="before_tool_call", type="command", command="echo ok")
        assert classify_hook(cfg) == "native"

    def test_needs_env(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig
        from agenticx.hooks.loader import classify_hook

        cfg = DeclarativeHookConfig(event="before_tool_call", type="command", command='node "${CLAUDE_PLUGIN_ROOT}/hooks/foo.mjs"')
        assert classify_hook(cfg) == "needs_env"

    def test_unknown(self):
        from agenticx.hooks.declarative import DeclarativeHookConfig
        from agenticx.hooks.loader import classify_hook

        cfg = DeclarativeHookConfig(event="before_tool_call", type="prompt")
        assert classify_hook(cfg) == "unknown"


# ---------------------------------------------------------------------------
# Curated hooks bundled
# ---------------------------------------------------------------------------


class TestCuratedHooksBundled:
    def test_bundled_dir_has_new_hooks(self):
        from pathlib import Path

        bundled = Path(__file__).resolve().parent.parent / "agenticx" / "hooks" / "bundled"
        expected = {"session_checkpoint", "pre_tool_guard", "compact_advisor", "session_evaluator"}
        actual = {d.name for d in bundled.iterdir() if d.is_dir() and (d / "HOOK.yaml").exists()}
        assert expected.issubset(actual)

    def test_each_bundled_hook_has_handler(self):
        from pathlib import Path

        bundled = Path(__file__).resolve().parent.parent / "agenticx" / "hooks" / "bundled"
        for name in ("session_checkpoint", "pre_tool_guard", "compact_advisor", "session_evaluator"):
            hook_dir = bundled / name
            assert (hook_dir / "HOOK.yaml").exists()
            assert (hook_dir / "handler.py").exists()


class TestPreToolGuardHook:
    @pytest.mark.asyncio
    async def test_blocks_rm_rf_at_line_start(self):
        from agenticx.hooks.bundled.pre_tool_guard.handler import handle
        from agenticx.hooks.types import HookEvent

        ev = HookEvent(
            type="tool",
            action="before_call",
            agent_id="meta",
            context={"command": "rm -rf ~/agx-hook-e2e-test"},
        )
        assert await handle(ev) is False

    @pytest.mark.asyncio
    async def test_blocks_rm_rf_from_tool_input(self):
        from agenticx.hooks.bundled.pre_tool_guard.handler import handle
        from agenticx.hooks.types import HookEvent

        ev = HookEvent(
            type="tool",
            action="before_call",
            agent_id="meta",
            context={
                "tool_name": "bash_exec",
                "tool_input": {"command": "rm -rf ~/agx-hook-e2e-test"},
            },
        )
        assert await handle(ev) is False

    @pytest.mark.asyncio
    async def test_allows_git_commit_message_with_rm_rf_text(self):
        from agenticx.hooks.bundled.pre_tool_guard.handler import handle
        from agenticx.hooks.types import HookEvent

        ev = HookEvent(
            type="tool",
            action="before_call",
            agent_id="meta",
            context={"command": 'git commit -m "rm -rf docs"'},
        )
        assert await handle(ev) is True


class TestParallelToolsEnabled:
    def test_env_var_1(self, monkeypatch):
        monkeypatch.setenv("AGX_PARALLEL_TOOLS", "1")
        from agenticx.runtime.agent_runtime import _parallel_tools_enabled
        assert _parallel_tools_enabled() is True

    def test_env_var_0(self, monkeypatch):
        monkeypatch.setenv("AGX_PARALLEL_TOOLS", "0")
        from agenticx.runtime.agent_runtime import _parallel_tools_enabled
        assert _parallel_tools_enabled() is False

    def test_env_var_unset(self, monkeypatch):
        monkeypatch.delenv("AGX_PARALLEL_TOOLS", raising=False)
        from agenticx.runtime.agent_runtime import _parallel_tools_enabled
        result = _parallel_tools_enabled()
        assert isinstance(result, bool)
