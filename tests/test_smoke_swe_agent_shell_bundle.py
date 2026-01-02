import os
import stat
from pathlib import Path

import pytest

from agenticx.tools import ShellBundleLoader, ShellScriptTool, ToolError


def _make_exec(path: Path, content: str):
    path.write_text(content, encoding="utf-8")
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IEXEC)


def test_load_and_run_shell_tool(tmp_path):
    bundle = tmp_path / "bundle"
    bin_dir = bundle / "bin"
    bin_dir.mkdir(parents=True)

    # config
    (bundle / "config.yaml").write_text(
        "tools:\n  hello:\n    docstring: say hello\n", encoding="utf-8"
    )
    # script
    _make_exec(bin_dir / "hello", "#!/usr/bin/env bash\necho hello-world\n")

    loader = ShellBundleLoader(bundle)
    tools = loader.load_tools()
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, ShellScriptTool)

    output = tool.run(args=[])
    assert output.strip() == "hello-world"


def test_state_command_json(tmp_path):
    bundle = tmp_path / "bundle"
    bin_dir = bundle / "bin"
    bin_dir.mkdir(parents=True)

    (bundle / "config.yaml").write_text(
        "tools:\n  noop: {}\nstate_command: _state\n", encoding="utf-8"
    )
    _make_exec(bin_dir / "noop", "#!/usr/bin/env bash\necho ok\n")
    _make_exec(bin_dir / "_state", '#!/usr/bin/env bash\necho "{\\"cwd\\": \\"/tmp\\"}"\n')

    loader = ShellBundleLoader(bundle)
    state = loader.run_state()
    assert state["cwd"] == "/tmp"


def test_missing_bundle(tmp_path):
    with pytest.raises(FileNotFoundError):
        ShellBundleLoader(tmp_path / "missing")


def test_nonzero_exit(tmp_path):
    bundle = tmp_path / "bundle"
    bin_dir = bundle / "bin"
    bin_dir.mkdir(parents=True)
    (bundle / "config.yaml").write_text("tools:\n  fail: {}\n", encoding="utf-8")
    _make_exec(bin_dir / "fail", "#!/usr/bin/env bash\nexit 2\n")

    loader = ShellBundleLoader(bundle)
    tool = loader.load_tools()[0]
    with pytest.raises(ToolError):
        tool.run(args=[])

