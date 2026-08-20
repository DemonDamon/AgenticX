from __future__ import annotations

import os
import runpy
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_bundled_server_forces_litellm_local_cost_map(monkeypatch) -> None:
    monkeypatch.setenv("LITELLM_LOCAL_MODEL_COST_MAP", "false")

    # agx_serve_entry 在模块层直接写 os.environ（除了 LITELLM_* 还有
    # AGX_LOCAL_KNOWLEDGE_ENABLED=0），runpy 执行它等于把这些变量永久塞进当前 pytest
    # 进程。这个文件排在前面，于是后面所有依赖本地知识库开关的用例都跟着变 ——
    # tests/test_meta_agent_kb_policy.py 那 4 条就是这么被带红的：单跑全绿，跟整套跑
    # 就拿到空的策略块（_build_kb_retrieval_policy_block 一进来就
    # `if not local_knowledge_enabled(): return ""`）。
    #
    # 所以跑完要把整个环境快照还原回去，不能只还原 LITELLM_*。
    env_before = dict(os.environ)
    try:
        runpy.run_path(
            str(REPO_ROOT / "packaging" / "pyinstaller" / "agx_serve_entry.py"),
            run_name="agx_serve_entry_startup_test",
        )

        assert os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] == "true"
        # 这一句是给上面那段注释配的证据：确实会写别的变量。
        assert os.environ.get("AGX_LOCAL_KNOWLEDGE_ENABLED") == "0"
    finally:
        os.environ.clear()
        os.environ.update(env_before)
