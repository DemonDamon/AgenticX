#!/usr/bin/env python3
"""Repository-wide pytest isolation for the AgenticX home directory.

Root cause fix: ``agenticx/studio/session_manager.py`` (``SessionManager.__init__``)
and dozens of other runtime modules resolve their on-disk state via
``Path.home()`` / ``os.path.expanduser("~")`` with no override hook. Tests such
as ``tests/test_studio_server.py`` instantiate real ``SessionManager`` objects
through ``create_studio_app()`` (55+ call sites across 17 files) without any
HOME isolation, so every test run wrote real session artifacts (fixed test
strings like "hello", "总结简历", "看看附件", "执行一次并发任务", "创建一个子
智能体", "retry me") directly into the developer's live
``~/.agenticx/sessions``. Near Desktop's history panel then displayed these
pytest fixtures as if they were genuine past conversations.

This autouse fixture redirects ``$HOME`` (and ``%USERPROFILE%`` on Windows) to
a throwaway per-test directory before any test body runs, so ``Path.home()``
resolves to a sandbox instead of the real user home for the entire suite.

Author: Damon Li
"""

from __future__ import annotations

import os

from pathlib import Path
from typing import Iterator

import pytest


@pytest.fixture(autouse=True)
def _isolated_agenticx_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Prevent tests from writing into the real ``~/.agenticx`` directory.

    ``posixpath.expanduser`` only consults ``$HOME``; ``ntpath.expanduser``
    checks ``%USERPROFILE%`` first and only falls back to
    ``%HOMEDRIVE%``/``%HOMEPATH%`` when ``USERPROFILE`` is unset. Setting both
    env vars here is therefore sufficient to isolate ``Path.home()`` on every
    platform this suite runs on.
    """
    fake_home = tmp_path / "agx_home"
    fake_home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("USERPROFILE", str(fake_home))
    # 同一类问题的另一半：工作区产物（session-memory 快照等）过去按 Path.cwd() 落盘，
    # 于是跑一次测试就在仓库根目录留下一个 memory/。$HOME 管不到它，得单独指。
    workspace = fake_home / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("AGENTICX_WORKSPACE_DIR", str(workspace))
    yield


def _real_agx_home_fingerprint() -> dict[str, int]:
    """真实 ~/.agenticx 下每个顶级子目录的**递归**条目数。

    一轮全量下来大概三万多个路径，扫两次（session 开始/结束各一次）代价可以接受。
    """
    root = Path(os.path.expanduser("~/.agenticx"))
    if not root.exists():
        return {}
    out: dict[str, int] = {}
    for child in root.iterdir():
        if child.is_dir():
            try:
                # 递归数，不能只数一层：曾经有一次泄漏是往已存在的
                # deliveries/demo-portal-poc/ 里塞子目录，顶层直接子项数一点没变。
                out[child.name] = sum(1 for _ in child.rglob("*"))
            except OSError:
                pass
    return out


def _real_session_row_count() -> int:
    """开发者真实会话库里的记录数；库不存在就当 0。"""
    import sqlite3

    db = Path(os.path.expanduser("~/.agenticx/memory/sessions.sqlite"))
    # 注意：这里必须用「真实」HOME。本文件的 autouse fixture 会把 $HOME 改掉，所以
    # 取值时机在 session 级 fixture 里、用例开始之前。
    if not db.exists():
        return 0
    try:
        with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
            # 会话列表读的是 session_summaries；session_messages 一并算上，免得只写了
            # 消息还没写摘要的那一类漏掉。
            total = 0
            for table in ("session_summaries", "session_messages"):
                row = conn.execute(
                    f"SELECT COUNT(DISTINCT session_id) FROM {table}"  # noqa: S608 - 表名是常量
                ).fetchone()
                total += int(row[0])
            return total
    except Exception:
        return -1


@pytest.fixture(scope="session", autouse=True)
def _guard_real_agenticx_home() -> Iterator[None]:
    """跑完测试后，开发者真实的 ~/.agenticx 不应该被写入任何东西。

    为什么需要这道闸：模块级的 ``Path.home()`` 常量在 import 时就把路径定死了，而 HOME
    重定向是用例开始时才生效的，两者一错位，测试数据就写进真实目录。实测过一轮全量会
    新增 171 个条目——133 个 avatar、65 个 group，其中一个目录名直接叫
    ``<MagicMock name='mock.bound_avatar_id' id='...'>``，而且它们会出现在桌面端的
    数字专家 / 项目群列表里。

    已知的几处已经改成调用时解析（session_store、ConfigManager、avatar registry /
    group_chat、delivery store、workspace_memory、chat_attachments、bash_bg 日志、
    brain registry）。这道闸负责保证不再冒出新的。
    """
    before_rows = _real_session_row_count()
    before_home = _real_agx_home_fingerprint()
    yield
    after_rows = _real_session_row_count()
    after_home = _real_agx_home_fingerprint()

    problems: list[str] = []
    if before_rows >= 0 and after_rows > before_rows:
        problems.append(f"会话库多了 {after_rows - before_rows} 条记录（{before_rows} → {after_rows}）")
    for name, after_n in sorted(after_home.items()):
        before_n = before_home.get(name, 0)
        if after_n > before_n:
            problems.append(f"~/.agenticx/{name}/ 多了 {after_n - before_n} 项（{before_n} → {after_n}）")
    for name in sorted(set(after_home) - set(before_home)):
        problems.append(f"新建了目录 ~/.agenticx/{name}/")

    if problems:
        pytest.fail(
            "测试写进了开发者真实的 ~/.agenticx：\n  - "
            + "\n  - ".join(problems)
            + "\n多半是又有模块在 import 时用 Path.home() 定死了路径——HOME 重定向拦不住它。"
            "改成调用时解析（参考 agenticx/utils/agx_home.py）。",
            pytrace=False,
        )
