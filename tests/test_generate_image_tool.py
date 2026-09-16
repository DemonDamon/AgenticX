#!/usr/bin/env python3
"""Tests for generate_image studio tool.

Author: Damon Li
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from agenticx.tools.image_generation import (
    FakeImageGenProvider,
    UNCONFIGURED_TOOL_TEXT,
    generate_image,
)


def test_fake_provider_writes_png_and_returns_image_json(tmp_path) -> None:
    session = SimpleNamespace(workspace_dir=str(tmp_path))
    raw = generate_image(
        "a red square",
        session=session,
        provider=FakeImageGenProvider(),
    )
    payload = json.loads(raw)
    assert payload["type"] == "image"
    path = payload["path"]
    assert path.startswith(str(tmp_path))
    written = tmp_path / "generated"
    files = list(written.glob("*.png"))
    assert len(files) == 1
    assert files[0].is_file()
    assert files[0].stat().st_size < 200
    assert "base64" not in raw
    assert len(raw) < 2000


def test_unconfigured_returns_error_string_without_raising() -> None:
    raw = generate_image("cat", config={})
    assert raw.startswith("ERROR:")
    assert raw == UNCONFIGURED_TOOL_TEXT


def test_empty_prompt_errors() -> None:
    raw = generate_image("   ", provider=FakeImageGenProvider())
    assert raw.startswith("ERROR:")
