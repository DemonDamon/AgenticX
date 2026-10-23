#!/usr/bin/env python3
"""SP-C case-entry tests: model roundtrip, store layout, precipitation, CLI.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from agenticx.cases.model import (
    CASE_SCHEMA_VERSION,
    CaseEntry,
    case_frontmatter,
    parse_case_md,
    render_case_md,
)
from agenticx.cases.precipitate import (
    bind_wiki_compiler,
    compile_case_entry,
    on_stage_passed,
    reset_wiki_compiler,
    stage_fingerprint,
)
from agenticx.cases.store import CaseStore
from agenticx.delivery.orchestrator import DeliveryOrchestrator, TaskSpec
from agenticx.delivery.plan_mdc import default_plan, read_plan, update_stage, write_plan


def _full_entry() -> CaseEntry:
    return CaseEntry(
        case_id="case-abc123",
        title="Demo Portal POC",
        type="case",
        summary="企业门户 POC 交付案例",
        problem="客户需要一个可快速交付的 B 端门户 POC",
        solution="五阶段流水线：需求 → 设计 → 前端 → 测试 → 审计",
        outcome="整体状态: completed；阶段完成 5/5",
        artifacts=["output/abc123/requirement-breakdown.md", "output/abc123/delivery-summary.md"],
        scope={"domain": "portal", "team_size": "5", "model_requirement": "any", "constraints": "dry-run"},
        lifecycle_status="active",
        supersedes=["case-old001"],
        freshness="2026-10-23",
        provenance={
            "project_ref": "abc123",
            "trajectory_ref": "/tmp/worktrees/demo-portal-poc",
            "compiler_version": f"agenticx-cases/{CASE_SCHEMA_VERSION}",
        },
        verification={"eval_passed": "true", "redline_check": "", "reviewer": ""},
    )


# ---------- model ----------


def test_case_entry_roundtrip(tmp_path: Path) -> None:
    entry = _full_entry()
    path = tmp_path / "demo-portal-poc.md"
    path.write_text(render_case_md(entry), encoding="utf-8")

    parsed = parse_case_md(path)
    assert parsed == entry
    assert case_frontmatter(parsed) == case_frontmatter(entry)


def test_parse_tolerates_unknown_frontmatter_fields(tmp_path: Path) -> None:
    entry = _full_entry()
    text = render_case_md(entry)
    injected = text.replace(
        "case_id: case-abc123",
        "case_id: case-abc123\nfuture_field: some-value\nnested_thing:\n  - a\n  - b",
        1,
    )
    path = tmp_path / "future.md"
    path.write_text(injected, encoding="utf-8")

    parsed = parse_case_md(path)
    assert parsed.case_id == entry.case_id
    assert parsed.scope == entry.scope
    assert parsed.problem == entry.problem


def test_parse_raises_on_missing_frontmatter(tmp_path: Path) -> None:
    path = tmp_path / "legacy.md"
    path.write_text("# no frontmatter here\n", encoding="utf-8")
    with pytest.raises(ValueError):
        parse_case_md(path)


# ---------- store ----------


def test_store_save_path_layout(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    entry = _full_entry()

    saved = store.save(entry)
    assert saved == tmp_path / "cases" / "default" / "portal" / "demo-portal-poc.md"
    assert saved.is_file()

    got = store.get(entry.case_id)
    assert got is not None
    assert got.case_id == entry.case_id
    assert got.scope["domain"] == "portal"

    assert store.get("case-missing") is None


def test_store_default_org_and_domain(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    entry = CaseEntry(case_id="case-x1", title="Bare Case")
    saved = store.save(entry)
    assert saved == tmp_path / "cases" / "default" / "default" / "bare-case.md"


def test_store_list_cases_filters_by_domain(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    portal = _full_entry()
    other = _full_entry()
    other.case_id = "case-xyz789"
    other.title = "Retail Dashboard"
    other.scope = {"domain": "retail"}
    store.save(portal)
    store.save(other)

    all_default = store.list_cases()
    assert {c.case_id for c in all_default} == {portal.case_id, other.case_id}

    portal_only = store.list_cases(domain="portal")
    assert [c.case_id for c in portal_only] == [portal.case_id]

    assert store.list_cases(org="other-org") == []


def test_store_build_index_rebuildable(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    store.save(_full_entry())
    other = _full_entry()
    other.case_id = "case-xyz789"
    other.title = "Retail Dashboard"
    other.scope = {"domain": "retail"}
    store.save(other)

    index_path = store.build_index()
    assert index_path == tmp_path / "cases" / "index.json"
    data = json.loads(index_path.read_text(encoding="utf-8"))
    assert data["version"] == CASE_SCHEMA_VERSION
    cases = data["cases"]
    assert set(cases.keys()) == {"case-abc123", "case-xyz789"}
    assert cases["case-abc123"]["path"] == "default/portal/demo-portal-poc.md"
    assert cases["case-abc123"]["summary"] == "企业门户 POC 交付案例"
    assert cases["case-abc123"]["scope"]["domain"] == "portal"

    first_snapshot = index_path.read_text(encoding="utf-8")
    store.build_index()
    assert index_path.read_text(encoding="utf-8") == first_snapshot  # 可重建且幂等


# ---------- T2: on_stage_passed ----------


class _FakeQueue:
    def __init__(self) -> None:
        self.enqueued: list[tuple[str, str]] = []

    def enqueue(self, docs_rt, doc_id: str, source_name: str, model_label: str = "") -> None:
        self.enqueued.append((doc_id, source_name))


@pytest.fixture()
def _clean_binding():
    reset_wiki_compiler()
    yield
    reset_wiki_compiler()


def _plan_with_stages(tmp_path: Path):
    plan = default_plan(
        task_id="task0001",
        project_name="Demo Portal POC",
        target="POC",
        worktree_path=str(tmp_path / "worktree"),
        output_dir=str(tmp_path / "worktree" / "output" / "task0001"),
        input_files=["input/sample-rfp.md"],
    )
    update_stage(
        plan,
        "requirements",
        status="completed",
        artifacts=["output/task0001/requirement-breakdown.md"],
    )
    update_stage(
        plan,
        "design",
        status="completed",
        artifacts=["output/task0001/design/design-system.md", "output/task0001/design/dashboard-wireframe.svg"],
    )
    return plan


def test_on_stage_passed_idempotent(tmp_path: Path, _clean_binding) -> None:
    plan = _plan_with_stages(tmp_path)
    output_dir = Path(plan.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    queue = _FakeQueue()
    bind_wiki_compiler(docs_rt=object(), queue=queue)

    on_stage_passed("requirements", output_dir, plan)
    assert len(queue.enqueued) == 1
    assert queue.enqueued[0][1] == "requirement-breakdown.md"

    # 同一 stage 二次调用：不重复入队（指纹去重）
    on_stage_passed("requirements", output_dir, plan)
    assert len(queue.enqueued) == 1

    # 不同 stage 正常入队，只挑 .md 产物（svg 跳过）
    on_stage_passed("design", output_dir, plan)
    assert len(queue.enqueued) == 2
    assert queue.enqueued[1][1] == "design-system.md"

    # 非沉淀阶段直接返回
    on_stage_passed("development", output_dir, plan)
    assert len(queue.enqueued) == 2


def test_on_stage_passed_without_binding_is_noop(tmp_path: Path, _clean_binding) -> None:
    plan = _plan_with_stages(tmp_path)
    output_dir = Path(plan.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    # 未绑定 queue：静默 no-op，不抛异常
    on_stage_passed("requirements", output_dir, plan)
    assert not list(output_dir.glob(".case-precipitation/*"))


def test_stage_fingerprint_stable_and_distinct(tmp_path: Path) -> None:
    plan = _plan_with_stages(tmp_path)
    fp1 = stage_fingerprint(plan, "requirements")
    assert fp1 == stage_fingerprint(plan, "requirements")
    assert fp1 != stage_fingerprint(plan, "design")


# ---------- T3: compile_case_entry ----------


def _completed_plan(tmp_path: Path):
    plan = _plan_with_stages(tmp_path)
    update_stage(
        plan,
        "development",
        status="completed",
        artifacts=["output/task0001/frontend/README.md"],
    )
    update_stage(plan, "testing", status="completed", artifacts=["output/task0001/qa/playwright-report"])
    update_stage(plan, "audit", status="completed", artifacts=["output/task0001/delivery-summary.md"])
    return plan


def test_compile_case_entry_rule_based_offline(tmp_path: Path) -> None:
    plan = _completed_plan(tmp_path)
    store = CaseStore(tmp_path / "cases")

    entry = compile_case_entry(plan, store=store)  # llm=None 规则式

    assert entry.case_id == "case-task0001"
    assert entry.type == "case"
    assert entry.summary  # 非空（fallback 到项目名）
    assert len(entry.summary) <= 256
    assert entry.problem
    assert "需求拆解" in entry.solution
    assert "output/task0001/requirement-breakdown.md" in entry.artifacts
    assert entry.scope["domain"] == "default"
    assert entry.lifecycle_status == "active"
    assert entry.freshness  # ISO 日期
    assert entry.provenance["project_ref"] == "task0001"
    assert entry.verification["eval_passed"] == "true"

    # 已落盘且可读回
    loaded = store.get(entry.case_id)
    assert loaded is not None
    assert loaded == entry


def test_compile_case_entry_overwrites_same_case(tmp_path: Path) -> None:
    plan = _completed_plan(tmp_path)
    store = CaseStore(tmp_path / "cases")
    first = compile_case_entry(plan, store=store)
    second = compile_case_entry(plan, store=store)
    assert first.case_id == second.case_id
    assert store.path_for(second).is_file()


def test_compile_case_entry_llm_failure_falls_back(tmp_path: Path) -> None:
    plan = _completed_plan(tmp_path)
    store = CaseStore(tmp_path / "cases")

    class _BrokenLLM:
        def invoke(self, prompt):
            raise RuntimeError("offline")

    entry = compile_case_entry(plan, store=store, llm=_BrokenLLM())
    assert entry.summary  # LLM 失败回退规则式摘要


# ---------- CLI smoke ----------


def test_cli_case_compile_smoke(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli.main import app

    worktree = tmp_path / "worktree"
    plan = _completed_plan(tmp_path)
    write_plan(worktree / "plan.mdc", plan)
    plan_path = worktree / "plan.mdc"
    assert read_plan(plan_path) is not None

    cases_root = tmp_path / "cases"
    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        app,
        ["case", "compile", "--plan", str(plan_path), "--output-root", str(cases_root)],
    )
    assert result.exit_code == 0, result.output
    saved = cases_root / "default" / "default" / "demo-portal-poc.md"
    assert saved.is_file()
    entry = parse_case_md(saved)
    assert entry.case_id == "case-task0001"

    index_path = cases_root / "index.json"
    assert not index_path.exists()  # compile 不自动建 index（显式 build_index 才建）
    store = CaseStore(cases_root)
    store.build_index()
    assert index_path.is_file()


def test_cli_case_compile_missing_plan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli.main import app

    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        app,
        ["case", "compile", "--plan", str(tmp_path / "nope.mdc")],
    )
    assert result.exit_code == 1


# ---------- orchestrator integration（零回归 + 回调触发） ----------


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
    monkeypatch.setattr("agenticx.delivery.store._STORE_ROOT", store_root)
    monkeypatch.setattr("agenticx.delivery.store._TASKS_JSON", store_root / "tasks.json")

    def _fake_worktree(*, repo_root: Path, branch: str, path: Path) -> Path:
        path.mkdir(parents=True, exist_ok=True)
        return path

    monkeypatch.setattr("agenticx.delivery.orchestrator.create_worktree", _fake_worktree)
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.resolve_repo_root",
        lambda configured="": tmp_path,
    )
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.ensure_delivery_bundle",
        lambda: {"ok": True, "bundle": {"skipped": True}, "avatars": []},
    )
    return worktree_root


def _delivery_config(delivery_env: Path):
    return {
        "enabled": True,
        "dry_run": True,
        "worktree_root": str(delivery_env),
        "max_stage_retries": 2,
        "repo_root": "",
        "bundle_source": str(
            Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery"
        ),
    }


def test_orchestrator_callback_defaults_to_none() -> None:
    orch = DeliveryOrchestrator()
    assert orch.on_stage_passed is None


def test_orchestrator_pipeline_invokes_callback_per_stage(
    delivery_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "agenticx.delivery.config.get_delivery_config",
        lambda: _delivery_config(delivery_env),
    )
    calls: list[tuple[str, object]] = []

    def _spy(stage_id: str, output_dir, plan) -> None:
        calls.append((stage_id, plan))

    orch = DeliveryOrchestrator(on_stage_passed=_spy)
    sample = (
        Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery" / "sample-rfp.md"
    )
    result = orch.start_delivery(
        TaskSpec(project_name="Demo Portal POC", target="POC", input_files=[str(sample)])
    )
    assert result.get("ok") is True
    assert [c[0] for c in calls] == [
        "requirements",
        "design",
        "development",
        "testing",
        "audit",
    ]
    # 回调收到的是 DeliveryPlan（阶段产物已写入）
    first_plan = calls[0][1]
    req = next(s for s in first_plan.stages if s.id == "requirements")
    assert req.status == "completed"
    assert req.artifacts


def test_orchestrator_pipeline_unaffected_by_default(
    delivery_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """零回归：on_stage_passed 默认 None 时 pipeline 行为不变。"""
    monkeypatch.setattr(
        "agenticx.delivery.config.get_delivery_config",
        lambda: _delivery_config(delivery_env),
    )
    from agenticx.delivery.store import get_task

    orch = DeliveryOrchestrator()
    sample = (
        Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery" / "sample-rfp.md"
    )
    result = orch.start_delivery(
        TaskSpec(project_name="Plain Pipeline", target="POC", input_files=[str(sample)])
    )
    assert result.get("ok") is True
    record = get_task(str(result.get("task_id")))
    assert record is not None
    assert record.status == "completed"
