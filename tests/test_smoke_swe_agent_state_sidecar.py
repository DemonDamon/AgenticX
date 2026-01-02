import stat
from pathlib import Path

import pytest

from agenticx.tools import ShellBundleLoader, ToolExecutor


def _make_exec(path: Path, content: str):
    path.write_text(content, encoding="utf-8")
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IEXEC)


def test_state_sidecar_in_execution_result(tmp_path):
    bundle = tmp_path / "bundle"
    bin_dir = bundle / "bin"
    bin_dir.mkdir(parents=True)

    # config with state
    (bundle / "config.yaml").write_text(
        "tools:\n  hello: {}\nstate_command: _state\n", encoding="utf-8"
    )
    _make_exec(bin_dir / "hello", "#!/usr/bin/env bash\necho hi\n")
    _make_exec(bin_dir / "_state", '#!/usr/bin/env bash\necho "{\\"cwd\\": \\"/tmp\\"}"\n')

    loader = ShellBundleLoader(bundle)
    tool = loader.load_tools()[0]
    executor = ToolExecutor()

    result = executor.execute(tool, args=[])
    assert result.success is True
    assert result.state and result.state.get("cwd") == "/tmp"


def test_state_sidecar_error_propagates(tmp_path):
    bundle = tmp_path / "bundle"
    bin_dir = bundle / "bin"
    bin_dir.mkdir(parents=True)

    (bundle / "config.yaml").write_text(
        "tools:\n  ok: {}\nstate_command: _state\n", encoding="utf-8"
    )
    _make_exec(bin_dir / "ok", "#!/usr/bin/env bash\necho ok\n")
    # state exits non-zero
    _make_exec(bin_dir / "_state", "#!/usr/bin/env bash\nexit 3\n")

    loader = ShellBundleLoader(bundle)
    tool = loader.load_tools()[0]
    executor = ToolExecutor(max_retries=0)

    result = executor.execute(tool, args=[])
    assert result.success is False
    assert result.error is not None

