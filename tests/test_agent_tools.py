#!/usr/bin/env python3
"""Tests for Studio agent tool dispatch and safety branches.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


class _DummyProcess:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_dispatch_tool_routes_file_read(monkeypatch) -> None:
    session = StudioSession()
    called = {"value": False}

    def _fake_file_read(arguments):
        called["value"] = True
        assert arguments["path"] == "README.md"
        return "ok"

    monkeypatch.setattr(agent_tools, "_tool_file_read", _fake_file_read)

    result = agent_tools.dispatch_tool("file_read", {"path": "README.md"}, session)
    assert result == "ok"
    assert called["value"] is True


def test_dispatch_tool_unknown_tool_returns_error() -> None:
    session = StudioSession()
    result = agent_tools.dispatch_tool("no_such_tool", {}, session)
    assert "unknown tool" in result


def test_bash_exec_whitelisted_command_skips_confirmation(monkeypatch) -> None:
    def _confirm_should_not_be_called(_question: str) -> bool:
        raise AssertionError("confirmation should not be requested for whitelisted command")

    monkeypatch.setattr(agent_tools, "_confirm", _confirm_should_not_be_called)
    monkeypatch.setattr(
        agent_tools.subprocess,
        "run",
        lambda *args, **kwargs: _DummyProcess(returncode=0, stdout="ok", stderr=""),
    )

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls"}, StudioSession())
    assert "exit_code=0" in result
    assert "stdout:\nok" in result


def test_bash_exec_non_whitelisted_command_requires_confirmation(monkeypatch) -> None:
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="", stderr="")

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)

    result = agent_tools.dispatch_tool("bash_exec", {"command": "rm -rf /tmp/demo"}, StudioSession())
    assert result == "CANCELLED: user denied non-whitelisted command"
    assert called["run"] is False


def test_bash_exec_command_injection_pattern_requires_confirmation(monkeypatch) -> None:
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="", stderr="")

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls && pwd"}, StudioSession())
    assert result.startswith("CANCELLED:")
    assert called["run"] is False


def test_bash_exec_python_dash_c_requires_confirmation(monkeypatch) -> None:
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)

    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "python -c \"print('hi')\""},
        StudioSession(),
    )
    assert result == "CANCELLED: user denied high-risk command"
    assert called["run"] is False


def test_bash_exec_uses_shell_false_and_argv(monkeypatch) -> None:
    captured = {}

    def _fake_run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls -la"}, StudioSession())
    assert "exit_code=0" in result
    assert captured["args"][0] == ["ls", "-la"]
    assert captured["kwargs"]["shell"] is False


def test_bash_exec_rejects_cwd_outside_workspace(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "ls", "cwd": "../"},
        StudioSession(),
    )
    assert result.startswith("ERROR: path escapes workspace:")
    assert called["run"] is False


def test_bash_exec_rejects_outside_path_argument(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "cat /etc/passwd"},
        StudioSession(),
    )
    assert result.startswith("ERROR: path escapes workspace:")
    assert called["run"] is False


def test_bash_exec_rejects_outside_path_argument_for_grep_with_dash_e(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "grep -e foo /etc/passwd"},
        StudioSession(),
    )
    assert result.startswith("ERROR: path escapes workspace:")
    assert called["run"] is False


def test_bash_exec_rejects_python_script_outside_workspace(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "python ../outside.py"},
        StudioSession(),
    )
    assert result.startswith("ERROR: path escapes workspace:")
    assert called["run"] is False


def test_bash_exec_python_workspace_script_requires_confirmation(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    script = workspace / "script.py"
    script.write_text("print('ok')\n", encoding="utf-8")
    monkeypatch.chdir(workspace)
    called = {"run": False}

    def _fake_run(*args, **kwargs):
        called["run"] = True
        return _DummyProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(agent_tools.subprocess, "run", _fake_run)
    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "python script.py"},
        StudioSession(),
    )
    assert result == "CANCELLED: user denied high-risk command"
    assert called["run"] is False


def test_file_write_denied_by_confirmation(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("old", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    result = agent_tools.dispatch_tool(
        "file_write",
        {"path": str(target), "content": "new"},
        StudioSession(),
    )

    assert result == "CANCELLED: user denied file write"
    assert target.read_text(encoding="utf-8") == "old"


def test_file_edit_denied_by_confirmation(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("hello world", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    result = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "world", "new_text": "agent"},
        StudioSession(),
    )

    assert result == "CANCELLED: user denied file edit"
    assert target.read_text(encoding="utf-8") == "hello world"


def test_file_edit_empty_old_text_returns_error(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("hello world", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    result = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "", "new_text": "agent"},
        StudioSession(),
    )

    assert result == "ERROR: old_text cannot be empty"


def test_workspace_boundary_blocks_outside_file_read(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool("file_read", {"path": "../outside.txt"}, StudioSession())
    assert result.startswith("ERROR: path escapes workspace:")


def test_workspace_boundary_blocks_outside_file_write(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool(
        "file_write",
        {"path": "../outside.txt", "content": "blocked"},
        StudioSession(),
    )
    assert result.startswith("ERROR: path escapes workspace:")


def test_workspace_boundary_blocks_outside_list_files(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool("list_files", {"path": ".."}, StudioSession())
    assert result.startswith("ERROR: path escapes workspace:")


def test_codegen_updates_session_artifacts_and_history(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)

    class _FakeEngine:
        def __init__(self, _llm):
            pass

        def generate(self, target, description, context):
            return SimpleNamespace(code="print('ok')\n", target=target, description=description, skill_name="x")

    monkeypatch.setattr(agent_tools.ProviderResolver, "resolve", lambda **_kwargs: object())
    monkeypatch.setattr(agent_tools, "CodeGenEngine", _FakeEngine)
    session = StudioSession()
    result = agent_tools.dispatch_tool("codegen", {"description": "make a demo agent"}, session)

    assert result.startswith("OK: generated")
    assert len(session.artifacts) == 1
    assert list(session.artifacts.values())[0] == "print('ok')\n"
    assert len(session.history) == 1
