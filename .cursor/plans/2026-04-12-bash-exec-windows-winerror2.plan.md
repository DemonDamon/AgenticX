# bash_exec Windows WinError 2（#7）

**Plan-Id:** `2026-04-12-bash-exec-windows-winerror2`

## 目标

- `use_shell` 时在 Windows 使用 `COMSPEC` + `/d /s /c`，不再调用不存在的 `/bin/bash`。
- Windows 无壳路径对 `parts[0]` 做 `shutil.which` 解析。
- 测试与文档对齐。

## 实现锚点

- [agenticx/cli/agent_tools.py](agenticx/cli/agent_tools.py)：`_bash_exec_shell_argv`、`which` 前缀
- [tests/test_agent_tools.py](tests/test_agent_tools.py)
- [docs/concepts/tools.md](docs/concepts/tools.md)、[docs/cli.md](docs/cli.md)
