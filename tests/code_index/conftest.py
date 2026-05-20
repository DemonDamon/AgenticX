"""Fixtures for code_index tests."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from agenticx.code_index.manager import CodeIndexManager, reset_encoder_for_tests


@pytest.fixture(autouse=True)
def _reset_code_index_manager():
    CodeIndexManager.reset_for_tests()
    reset_encoder_for_tests()
    yield
    CodeIndexManager.reset_for_tests()
    reset_encoder_for_tests()


@pytest.fixture
def tiny_codebase(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    root.mkdir()
    (root / "main.py").write_text(
        textwrap.dedent(
            """
            def delegate_to_avatar(session_id: str) -> str:
                '''Delegate work to an avatar session.'''
                return session_id

            class CodeIndexManager:
                pass
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    (root / "utils.py").write_text(
        "def helper():\n    return 42\n",
        encoding="utf-8",
    )
    (root / "README.md").write_text("# demo\n", encoding="utf-8")
    return root


@pytest.fixture
def mock_encoder(monkeypatch):
    import numpy as np

    class FakeEncoder:
        def encode(self, texts, **kwargs):
            dim = 8
            out = []
            for t in texts:
                seed = sum(ord(c) for c in str(t)) % 97
                vec = np.array([(seed + i) % 13 / 13.0 for i in range(dim)], dtype=np.float32)
                out.append(vec)
            return np.stack(out, axis=0)

    enc = FakeEncoder()
    load_calls: list[str] = []

    def _load_encoder(model_name: str = "") -> FakeEncoder:
        load_calls.append(model_name)
        return enc

    monkeypatch.setattr("agenticx.code_index.manager.load_encoder", _load_encoder)
    monkeypatch.setattr(
        "agenticx.code_index.manager.encoder_load_count_for_tests",
        lambda: len(load_calls),
    )
    return enc
