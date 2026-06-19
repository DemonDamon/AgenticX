#!/usr/bin/env python3
"""Smoke tests for Near delivery loop orchestrator.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.delivery.orchestrator import DeliveryOrchestrator, TaskSpec
from agenticx.delivery.plan_mdc import read_plan, STAGE_ORDER
from agenticx.delivery.store import get_task


@pytest.fixture()
def delivery_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    worktree_root = tmp_path / "deliveries"
    store_root = tmp_path / "delivery-store"
    monkeypatch.setenv("AGX_DELIVERY_DRY_RUN", "1")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        "agenticx.delivery.config._default_bundle_source",
        lambda: str(
            Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery"
        ),
    )
    monkeypatch.setattr(
        "agenticx.delivery.store._STORE_ROOT",
        store_root,
    )
    monkeypatch.setattr(
        "agenticx.delivery.store._TASKS_JSON",
        store_root / "tasks.json",
    )

    def _fake_worktree(*, repo_root: Path, branch: str, path: Path) -> Path:
        path.mkdir(parents=True, exist_ok=True)
        return path

    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.create_worktree",
        _fake_worktree,
    )
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.resolve_repo_root",
        lambda configured="": tmp_path,
    )
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.ensure_delivery_bundle",
        lambda: {"ok": True, "bundle": {"skipped": True}, "avatars": []},
    )
    return worktree_root


def test_delivery_pipeline_completes_five_stages(delivery_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "agenticx.delivery.config.get_delivery_config",
        lambda: {
            "enabled": True,
            "dry_run": True,
            "worktree_root": str(delivery_env),
            "max_stage_retries": 2,
            "repo_root": "",
            "bundle_source": str(
                Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery"
            ),
        },
    )
    orch = DeliveryOrchestrator()
    sample = Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery" / "sample-rfp.md"
    result = orch.start_delivery(
        TaskSpec(
            project_name="Demo Portal POC",
            target="POC",
            input_files=[str(sample)],
        )
    )
    assert result.get("ok") is True
    task_id = str(result.get("task_id"))
    record = get_task(task_id)
    assert record is not None
    assert record.status == "completed"

    plan = read_plan(Path(record.plan_path))
    assert plan is not None
    assert plan.overall_status == "completed"
    assert all(s.status == "completed" for s in plan.stages)
    assert len(plan.stages) == len(STAGE_ORDER)

    output = Path(record.output_dir)
    assert (output / "requirement-breakdown.md").is_file()
    assert (output / "design" / "design-system.md").is_file()
    assert (output / "frontend" / "README.md").is_file()
    assert (output / "qa" / "playwright-report" / "index.html").is_file()
    assert len(list((output / "qa" / "playwright-report").glob("screenshot-*.png"))) >= 5
    assert (output / "delivery-summary.md").is_file()


def test_plan_mdc_roundtrip(tmp_path: Path) -> None:
    from agenticx.delivery.plan_mdc import default_plan, update_stage, write_plan

    plan = default_plan(
        task_id="abc123",
        project_name="Test",
        target="POC",
        worktree_path=str(tmp_path),
        output_dir=str(tmp_path / "output"),
        input_files=[],
    )
    update_stage(plan, "requirements", status="completed", artifacts=["output/a.md"])
    write_plan(tmp_path / "plan.mdc", plan)
    loaded = read_plan(tmp_path / "plan.mdc")
    assert loaded is not None
    req = next(s for s in loaded.stages if s.id == "requirements")
    assert req.status == "completed"
    assert "output/a.md" in req.artifacts
