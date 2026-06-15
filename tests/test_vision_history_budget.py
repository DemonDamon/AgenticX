#!/usr/bin/env python3
"""Unit tests for vision history budget helpers.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.vision_history_budget import (
    VisionHistoryConfig,
    apply_turn_image_budget,
    maybe_batch_compact_session_images,
    should_emit_budget_notice,
)


def _img(name: str, size: int) -> dict[str, object]:
    return {
        "name": name,
        "data_url": "data:image/png;base64," + ("A" * size),
        "mime_type": "image/png",
        "size": size,
    }


def test_apply_turn_image_budget_keeps_recent_n() -> None:
    cfg = VisionHistoryConfig(enabled=True, max_images=3, max_image_chars_per_turn=100_000)
    inputs = [_img(f"i{i}", 128) for i in range(6)]
    kept, stats = apply_turn_image_budget(inputs, cfg=cfg)
    assert len(kept) == 3
    assert [str(x["name"]) for x in kept] == ["i3", "i4", "i5"]
    assert bool(stats["omitted_for_budget"]) is True


def test_apply_turn_image_budget_enforces_char_budget() -> None:
    cfg = VisionHistoryConfig(enabled=True, max_images=5, max_image_chars_per_turn=120)
    inputs = [_img("a", 80), _img("b", 80), _img("c", 80)]
    kept, stats = apply_turn_image_budget(inputs, cfg=cfg)
    assert len(kept) < len(inputs)
    total_chars = sum(len(str(x.get("data_url", ""))) for x in kept)
    assert total_chars <= 120
    assert int(stats["dropped_count"]) >= 1


def test_batch_compaction_replaces_old_image_data() -> None:
    cfg = VisionHistoryConfig(enabled=True, max_images=2, batch_compact_interval=2)
    session = SimpleNamespace(
        scratchpad={},
        agent_messages=[
            {"role": "user", "attachments": [_img("a", 10)]},
            {"role": "user", "attachments": [_img("b", 10)]},
            {"role": "user", "attachments": [_img("c", 10)]},
        ],
        chat_history=[],
    )
    did_compact, replaced = maybe_batch_compact_session_images(session, cfg=cfg, new_image_count=2)
    assert did_compact is True
    assert replaced >= 1
    old = session.agent_messages[0]["attachments"][0]
    assert old.get("data_url") == "[Image omitted]"
    assert old.get("omitted") is True


def test_budget_notice_emits_once() -> None:
    session = SimpleNamespace(scratchpad={})
    assert should_emit_budget_notice(session) is True
    assert should_emit_budget_notice(session) is False

