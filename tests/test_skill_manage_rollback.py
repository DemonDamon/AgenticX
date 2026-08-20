from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import _tool_skill_manage


@pytest.fixture
def skill_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    # learning.agent_writes_require_approval 默认是 True，agent 的技能写入会先进
    # 待批队列（create 返回 create_pending，内容落在 .proposals/<id>/SKILL.md，
    # 技能目录本身还不存在）。这几条用例测的是直写路径本身的语义——patch 的匹配、
    # 版本历史、rollback——所以这里把队列关掉直连。待批队列那条路有
    # tests/test_pending_queue.py 和 test_skill_freeze.py 专门覆盖。
    monkeypatch.setattr(
        "agenticx.cli.agent_tools._should_queue_skill_write", lambda: False
    )
    root = tmp_path / ".agenticx" / "skills"
    root.mkdir(parents=True, exist_ok=True)
    return root


# _tool_skill_manage 现在是协程（和其余需要 confirm_gate 的工具一样）。
# 用例还在同步调用它，json.loads 收到的是 coroutine 对象，报
# "the JSON object must be str, bytes or bytearray, not coroutine"。
# pytest 配的是 asyncio_mode=auto，所以 async def 的用例直接就能跑。
async def test_rollback_to_previous_version(skill_home: Path) -> None:
    body = "---\nname: rb\n---\n\nV1\n"
    created = json.loads(await _tool_skill_manage({"action": "create", "name": "rb", "content": body}, None))
    p = Path(created["path"])

    await _tool_skill_manage(
        {
            "action": "patch",
            "name": "rb",
            "old_string": "V1",
            "new_string": "V2",
        },
        None,
    )
    assert "V2" in p.read_text(encoding="utf-8")

    history = json.loads(await _tool_skill_manage({"action": "history", "name": "rb"}, None))
    assert history["ok"] is True
    assert history["versions"]
    target_version = history["versions"][0]["version"]

    rolled = json.loads(
        await _tool_skill_manage(
            {"action": "rollback", "name": "rb", "to_version": target_version},
            None,
        )
    )
    assert rolled["ok"] is True
    assert "V1" in p.read_text(encoding="utf-8")
