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
async def test_patch_preview_then_apply_with_token(skill_home: Path) -> None:
    body = "---\nname: p1\n---\n\nOLD_VALUE\n"
    out = json.loads(await _tool_skill_manage({"action": "create", "name": "p1", "content": body}, None))
    p = Path(out["path"])
    preview = json.loads(
        await _tool_skill_manage(
            {
                "action": "patch",
                "name": "p1",
                "mode": "preview",
                "old_string": "OLD_VALUE",
                "new_string": "NEW_VALUE",
            },
            None,
        )
    )
    assert preview["ok"] is True
    assert preview["mode"] == "preview"
    assert isinstance(preview.get("patch_token"), str)
    assert "NEW_VALUE" not in p.read_text(encoding="utf-8")

    applied = json.loads(
        await _tool_skill_manage(
            {
                "action": "patch",
                "name": "p1",
                "mode": "apply",
                "old_string": "OLD_VALUE",
                "new_string": "NEW_VALUE",
                "patch_token": preview["patch_token"],
            },
            None,
        )
    )
    assert applied["ok"] is True
    assert "NEW_VALUE" in p.read_text(encoding="utf-8")
