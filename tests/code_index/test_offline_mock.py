"""Offline / import failure paths for code_index."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from agenticx.code_index.config import CodeIndexConfig
from agenticx.code_index.manager import CodeIndexManager
from agenticx.code_index.state import IndexStatus


def test_indexfailed_readable_summary(tiny_codebase):
    def _fail(_name: str):
        raise OSError("无法连接 Hugging Face 模型仓库")

    with patch("agenticx.code_index.manager.load_encoder", side_effect=_fail):
        cfg = CodeIndexConfig(enabled=True)
        with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
            task = CodeIndexManager.instance()._run_build(tiny_codebase, wait=True)
    assert task.status == IndexStatus.INDEXFAILED
    assert task.error_summary
    assert "OSError" in task.error_summary
