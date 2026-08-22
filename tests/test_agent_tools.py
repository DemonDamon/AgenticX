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

    def _fake_file_read(arguments, session=None):
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


class _FakeAsyncStream:
    """异步版 stdout/stderr：`async for raw in stream` 逐行吐 bytes。"""

    def __init__(self, text: str) -> None:
        self._lines = [f"{line}\n".encode() for line in text.splitlines()] if text else []

    def __aiter__(self):
        async def _gen():
            for line in self._lines:
                yield line

        return _gen()


class _FakeAsyncProcess:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = _FakeAsyncStream(stdout)
        self.stderr = _FakeAsyncStream(stderr)

    async def wait(self) -> int:
        return self.returncode

    def kill(self) -> None:  # pragma: no cover - 只有超时分支才会调用
        pass


def _capture_subprocess_exec(
    monkeypatch,
    *,
    returncode: int = 0,
    stdout: str = "ok",
    stderr: str = "",
) -> dict:
    """替换 asyncio.create_subprocess_exec，记录 bash_exec 真正启动了什么。

    这一组用例原来 patch 的是 ``agent_tools.subprocess.run``。但 bash_exec 从
    2026-04-16 的 c7c1dd30（bash streaming）起就改走 asyncio.create_subprocess_exec
    了，patch 打在了一个它根本不碰的函数上：argv / shell=False / cwd 这些断言全部
    落空，用例还在本机真的跑 `ls -la`，靠"碰巧 exit_code=0"蒙混过关。

    同时把 create_subprocess_shell 换成会炸的桩——"不经过 shell"本身就是这里要守的
    安全属性，与其断言一个 shell=False 关键字，不如直接断言那条路径没人走。
    """
    captured: dict = {}

    async def _fake_exec(*argv, **kwargs):
        captured["argv"] = list(argv)
        captured["kwargs"] = kwargs
        return _FakeAsyncProcess(returncode=returncode, stdout=stdout, stderr=stderr)

    async def _fake_shell(*_a, **_k):
        raise AssertionError("bash_exec 不允许走 create_subprocess_shell")

    monkeypatch.setattr(agent_tools.asyncio, "create_subprocess_exec", _fake_exec)
    monkeypatch.setattr(agent_tools.asyncio, "create_subprocess_shell", _fake_shell)

    def _passthrough_plan(argv, *, permissions, **_kwargs):
        return SimpleNamespace(
            argv=tuple(argv),
            env={},
            permissions=agent_tools.normalize_command_permissions(permissions),
            backend="test-passthrough",
        )

    monkeypatch.setattr(agent_tools, "build_command_sandbox_plan", _passthrough_plan)
    return captured


def test_bash_exec_whitelisted_command_skips_confirmation(monkeypatch) -> None:
    def _confirm_should_not_be_called(_question: str) -> bool:
        raise AssertionError("confirmation should not be requested for whitelisted command")

    monkeypatch.setattr(agent_tools, "_confirm", _confirm_should_not_be_called)
    captured = _capture_subprocess_exec(monkeypatch, stdout="ok")

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls"}, StudioSession())
    assert "exit_code=0" in result
    assert "stdout:\nok" in result
    assert captured["argv"] == ["ls"]


def test_bash_exec_non_whitelisted_command_requires_confirmation(monkeypatch) -> None:
    captured = _capture_subprocess_exec(monkeypatch)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")

    result = agent_tools.dispatch_tool("bash_exec", {"command": "rm -rf /tmp/demo"}, StudioSession())
    assert result == "CANCELLED: 非白名单命令未执行（用户拒绝）"
    assert "argv" not in captured


def test_bash_exec_command_injection_pattern_requires_confirmation(monkeypatch) -> None:
    captured = _capture_subprocess_exec(monkeypatch)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls && pwd"}, StudioSession())
    assert result.startswith("CANCELLED:")
    assert "argv" not in captured


def test_bash_exec_python_dash_c_requires_confirmation(monkeypatch) -> None:
    captured = _capture_subprocess_exec(monkeypatch)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")

    result = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "python -c \"print('hi')\""},
        StudioSession(),
    )
    assert result == "CANCELLED: 高风险命令未执行（用户拒绝）"
    assert "argv" not in captured


def test_bash_exec_uses_argv_and_never_a_shell(monkeypatch) -> None:
    captured = _capture_subprocess_exec(monkeypatch)

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls -la"}, StudioSession())
    assert "exit_code=0" in result
    assert captured["argv"] == ["ls", "-la"]


async def _confirm_yes(*_a, **_k) -> bool:
    return True


def test_bash_exec_shell_mode_uses_cmd_on_win32(monkeypatch) -> None:
    monkeypatch.setattr(agent_tools, "_confirm", _confirm_yes)
    captured = _capture_subprocess_exec(monkeypatch)
    monkeypatch.setattr(agent_tools.sys, "platform", "win32")
    monkeypatch.setenv("COMSPEC", r"C:\Windows\System32\cmd.exe")

    cmd = "echo a && echo b"
    result = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, StudioSession())
    assert "exit_code=0" in result
    argv = captured["argv"]
    assert argv[0] == r"C:\Windows\System32\cmd.exe"
    assert argv[1:4] == ["/d", "/s", "/c"]
    assert argv[4] == cmd


def test_bash_exec_shell_mode_uses_bash_on_posix(monkeypatch) -> None:
    monkeypatch.setattr(agent_tools, "_confirm", _confirm_yes)
    captured = _capture_subprocess_exec(monkeypatch)
    monkeypatch.setattr(agent_tools.sys, "platform", "linux")

    cmd = "echo a && echo b"
    result = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, StudioSession())
    assert "exit_code=0" in result
    assert captured["argv"] == ["/bin/bash", "-c", cmd]


def test_bash_exec_win32_resolves_executable_via_which(monkeypatch) -> None:
    captured = _capture_subprocess_exec(monkeypatch)
    real_which = agent_tools.shutil.which

    def _which(cmd: str, path=None):
        if cmd == "ls":
            return r"C:\Program Files\Git\usr\bin\ls.exe"
        return real_which(cmd, path=path)

    monkeypatch.setattr(agent_tools.shutil, "which", _which)
    monkeypatch.setattr(agent_tools.sys, "platform", "win32")

    result = agent_tools.dispatch_tool("bash_exec", {"command": "ls -la"}, StudioSession())
    assert "exit_code=0" in result
    assert captured["argv"][0] == r"C:\Program Files\Git\usr\bin\ls.exe"
    assert captured["argv"][1:] == ["-la"]


def test_bash_exec_peels_cd_then_and_sets_cwd(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    sub = workspace / "sub"
    sub.mkdir()
    monkeypatch.chdir(workspace)
    captured = _capture_subprocess_exec(monkeypatch)

    session = StudioSession()
    session.workspace_dir = str(workspace)
    result = agent_tools.dispatch_tool("bash_exec", {"command": "cd sub && ls"}, session)
    assert "exit_code=0" in result
    assert captured["kwargs"]["cwd"] == str(sub.resolve())
    assert captured["argv"] == ["ls"]


def test_cc_bridge_http_autostarts_on_connect_error(monkeypatch) -> None:
    import httpx
    from agenticx.cc_bridge import settings as cc_settings

    class _Resp:
        status_code = 200
        text = '{"ok": true}'

    class _Client:
        calls = 0

        def __init__(self, *args, **kwargs) -> None:
            _ = (args, kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        async def get(self, *args, **kwargs):
            _ = (args, kwargs)
            _Client.calls += 1
            if _Client.calls == 1:
                raise httpx.ConnectError("boom")
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    monkeypatch.setattr(cc_settings, "cc_bridge_base_url", lambda: "http://127.0.0.1:9742")
    monkeypatch.setattr(cc_settings, "cc_bridge_token", lambda: "tok")
    monkeypatch.setattr(cc_settings, "validate_bridge_url_for_studio", lambda _u: None)
    monkeypatch.setattr(agent_tools, "_ensure_cc_bridge_local_process", lambda _b, _t: (True, "started"))

    result = agent_tools.dispatch_tool("cc_bridge_list", {}, StudioSession())
    assert '"ok": true' in result
    assert "[cc-bridge] autostarted in background." in result


def test_cc_bridge_http_recovers_from_502(monkeypatch) -> None:
    import httpx
    from agenticx.cc_bridge import settings as cc_settings

    class _Resp:
        def __init__(self, code: int, text: str) -> None:
            self.status_code = code
            self.text = text

    class _Client:
        calls = 0

        def __init__(self, *args, **kwargs) -> None:
            _ = (args, kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        async def get(self, url, *args, **kwargs):
            _ = (args, kwargs)
            _Client.calls += 1
            if url.endswith("/health"):
                return _Resp(200, "ok")
            if _Client.calls == 1:
                return _Resp(502, "")
            return _Resp(200, '{"ok": true}')

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    monkeypatch.setattr(cc_settings, "cc_bridge_base_url", lambda: "http://127.0.0.1:9742")
    monkeypatch.setattr(cc_settings, "cc_bridge_token", lambda: "tok")
    monkeypatch.setattr(cc_settings, "validate_bridge_url_for_studio", lambda _u: None)
    monkeypatch.setattr(agent_tools, "_ensure_cc_bridge_local_process", lambda _b, _t: (True, "started"))

    result = agent_tools.dispatch_tool("cc_bridge_list", {}, StudioSession())
    assert '"ok": true' in result
    assert "[cc-bridge] autostarted in background." in result


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
    assert result == "CANCELLED: 高风险命令未执行（用户拒绝）"
    assert called["run"] is False


def _session_in(workspace: Path) -> StudioSession:
    """把会话的工作区钉在 ``workspace`` 上。

    不带工作区的 ``StudioSession()``，其 root 会回退到 ``~/.agenticx/workspace``
    （见 ``_session_workspace_root_sets`` 末尾的 ``_workspace_root()``），而不是当前
    目录。下面这些用例原本只 ``monkeypatch.chdir(tmp_path)`` 就直接传路径，等于默认
    "沙箱边界 = cwd"——那是回退改掉之前的行为，现在一律撞在
    "ERROR: path escapes workspace"。显式绑定工作区，用例测的才是它们各自想测的那件事
    （确认拒绝、参数校验、元数据剥离、liteparse），而不是沙箱。
    """
    session = StudioSession()
    session.workspace_dir = str(workspace)
    return session


def test_file_write_denied_by_confirmation(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("old", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    result = agent_tools.dispatch_tool(
        "file_write",
        {"path": str(target), "content": "new"},
        _session_in(tmp_path),
    )

    assert result == "CANCELLED: 文件未写入（用户拒绝）"
    assert target.read_text(encoding="utf-8") == "old"


def test_file_edit_denied_by_confirmation(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("hello world", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    result = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "world", "new_text": "agent"},
        _session_in(tmp_path),
    )

    assert result == "CANCELLED: 文件未修改（用户拒绝）"
    assert target.read_text(encoding="utf-8") == "hello world"


def test_file_edit_empty_old_text_returns_error(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.txt"
    target.write_text("hello world", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    result = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "", "new_text": "agent"},
        _session_in(tmp_path),
    )

    assert result == "ERROR: old_text cannot be empty"


def test_workspace_boundary_blocks_outside_file_read(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool("file_read", {"path": "../outside.txt"}, _session_in(workspace))
    assert result.startswith("ERROR: path escapes workspace:")


def test_file_read_resolves_relative_path_across_taskspaces(monkeypatch, tmp_path: Path) -> None:
    default_root = tmp_path / "default"
    project_root = tmp_path / "cs542"
    default_root.mkdir()
    project_root.mkdir()
    target = project_root / "hw1_solutions.md"
    target.write_text("solution body", encoding="utf-8")
    monkeypatch.chdir(default_root)

    session = StudioSession()
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(default_root)},
        {"id": "ts-cs542", "label": "cs542", "path": str(project_root)},
    ]

    result = agent_tools.dispatch_tool("file_read", {"path": "hw1_solutions.md"}, session)
    assert "solution body" in result


def test_workspace_boundary_blocks_outside_file_write(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool(
        "file_write",
        {"path": "../outside.txt", "content": "blocked"},
        _session_in(workspace),
    )
    assert result.startswith("ERROR: path escapes workspace:")


def test_workspace_boundary_blocks_outside_list_files(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)

    result = agent_tools.dispatch_tool("list_files", {"path": ".."}, _session_in(workspace))
    assert result.startswith("ERROR: path escapes workspace:")


def test_repair_malformed_file_write_strips_metadata_from_value() -> None:
    repaired = agent_tools._repair_malformed_file_tool_arguments(
        "file_write",
        {
            "path": "demo.py",
            "content": "print('ok')",
            "value": "call_54b953f0639040309a058eac\nsa-26e692b3",
        },
    )
    assert "call_54b953f0639040309a058eac" not in str(repaired.get("content", ""))
    assert "sa-26e692b3" not in str(repaired.get("content", ""))


def test_file_write_strips_metadata_lines_before_persist(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "demo.py"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("builtins.input", lambda _prompt: "y")
    payload = "print('ok')\ncall_54b953f0639040309a058eac\nsa-26e692b3\n"
    result = agent_tools.dispatch_tool(
        "file_write",
        {"path": str(target), "content": payload},
        _session_in(tmp_path),
    )
    assert result.startswith("OK: wrote")
    text = target.read_text(encoding="utf-8")
    assert "call_54b953f0639040309a058eac" not in text
    assert "sa-26e692b3" not in text


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


def test_todo_write_updates_session_state() -> None:
    session = StudioSession()
    result = agent_tools.dispatch_tool(
        "todo_write",
        {
            "items": [
                {"content": "A", "status": "completed", "active_form": "done A"},
                {"content": "B", "status": "in_progress", "active_form": "doing B"},
            ]
        },
        session,
    )
    assert "[x] A" in result
    assert "[>] B <- doing B" in result


def test_liteparse_returns_error_when_adapter_fails(monkeypatch, tmp_path: Path) -> None:
    doc_path = tmp_path / "doc.pdf"
    doc_path.write_text("dummy", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    class _FakeLiteParseAdapter:
        @staticmethod
        def is_available() -> bool:
            return True

        def __init__(self, *args, **kwargs) -> None:
            pass

        async def parse_to_text(self, file_path: Path) -> str:
            raise RuntimeError("parse failed")

    monkeypatch.setattr("agenticx.tools.adapters.liteparse.LiteParseAdapter", _FakeLiteParseAdapter)

    result = agent_tools.dispatch_tool("liteparse", {"path": "doc.pdf"}, _session_in(tmp_path))
    assert result.startswith("ERROR: liteparse parsing failed:")


def test_liteparse_returns_extracted_text(monkeypatch, tmp_path: Path) -> None:
    doc_path = tmp_path / "doc.pdf"
    doc_path.write_text("dummy", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    class _FakeLiteParseAdapter:
        @staticmethod
        def is_available() -> bool:
            return True

        def __init__(self, *args, **kwargs) -> None:
            pass

        async def parse_to_text(self, file_path: Path) -> str:
            return "parsed result"

    monkeypatch.setattr("agenticx.tools.adapters.liteparse.LiteParseAdapter", _FakeLiteParseAdapter)

    result = agent_tools.dispatch_tool("liteparse", {"path": "doc.pdf"}, _session_in(tmp_path))
    assert result == "parsed result"


def test_session_workspace_roots_put_user_taskspaces_before_default(tmp_path: Path) -> None:
    """Desktop merges default (avatar workspace) first; tools must still prefer user-bound folders."""
    default_dir = tmp_path / "avatar_workspace"
    user_dir = tmp_path / "user_bound"
    default_dir.mkdir()
    user_dir.mkdir()
    (user_dir / "marker.txt").write_text("here", encoding="utf-8")

    session = StudioSession()
    session.workspace_dir = str(default_dir)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(default_dir)},
        {"id": "ts-abc12345", "label": "示例任务空间", "path": str(user_dir)},
    ]

    roots = agent_tools._session_workspace_roots(session)
    assert roots[0] == user_dir.resolve()

    resolved = agent_tools._resolve_workspace_path(".", session, pick_existing=True)
    assert resolved == user_dir.resolve()


def test_session_workspace_roots_honors_active_taskspace_id(tmp_path: Path) -> None:
    """When multiple user taskspaces exist, active_taskspace_id must match the selected tab."""
    dir_a = tmp_path / "folder_a"
    dir_b = tmp_path / "folder_b"
    default_dir = tmp_path / "default_ws"
    dir_a.mkdir()
    dir_b.mkdir()
    default_dir.mkdir()
    (dir_a / "a.txt").write_text("a", encoding="utf-8")
    (dir_b / "b.txt").write_text("b", encoding="utf-8")

    session = StudioSession()
    session.workspace_dir = str(default_dir)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(default_dir)},
        {"id": "ts-11111111", "label": "A", "path": str(dir_a)},
        {"id": "ts-22222222", "label": "B", "path": str(dir_b)},
    ]
    session.active_taskspace_id = "ts-22222222"

    roots = agent_tools._session_workspace_roots(session)
    assert roots[0] == dir_b.resolve()

    resolved = agent_tools._resolve_workspace_path(".", session, pick_existing=True)
    assert resolved == dir_b.resolve()
