import pytest

from agenticx.tools import ShellScriptTool, ToolValidationError
from pathlib import Path
import stat


def _make_exec(path: Path, content: str):
    path.write_text(content, encoding="utf-8")
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IEXEC)


def test_bash_syntax_check(tmp_path):
    script = tmp_path / "echo.sh"
    _make_exec(script, "#!/usr/bin/env bash\necho ok\n")

    tool = ShellScriptTool(script_path=script, enable_syntax_check=True)
    # valid
    out = tool.run(args=["echo ok"])
    assert "ok" in out

    # invalid bash
    with pytest.raises(ToolValidationError):
        tool.run(args=["echo $((1+"])  # malformed expr


def test_disable_syntax_check(tmp_path):
    script = tmp_path / "noop.sh"
    _make_exec(script, "#!/usr/bin/env bash\necho ok\n")

    tool = ShellScriptTool(script_path=script, enable_syntax_check=False)
    # malformed command passes to bash (will succeed because script ignores args)
    out = tool.run(args=["echo $((1+"])
    assert "ok" in out

