#!/usr/bin/env python3
"""Tests for Plan DSL v1 (SP-A): plan.mdc extension fields + two-level gate contract.

Covers (per plans/b-end-case-library/sp-a-plan-dsl.md):
- legacy plan.mdc (no DSL v1 fields) reads back with default values
- new-field roundtrip (write -> read equal)
- validate_stage_with_gate: fast-path failure skips LLM; LLM invoked when fast
  path passes; pure fast path when llm_judge is None
- GateVerdict contract: passed=False without structured failures gets flagged

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from agenticx.delivery.plan_mdc import (
    DeliveryPlan,
    default_plan,
    read_plan,
    update_stage,
    write_plan,
)
from agenticx.delivery.stages import GateVerdict, validate_stage_with_gate

# Frontmatter keys introduced by Plan DSL v1; a pre-DSL legacy file has none.
DSL_V1_PLAN_KEYS = ("intent", "scope", "case_refs")
DSL_V1_STAGE_KEYS = ("gate_criteria", "artifact_refs", "case_link")


def _make_plan(tmp_path: Path) -> DeliveryPlan:
    return default_plan(
        task_id="task-dsl-1",
        project_name="DSL Demo Portal",
        target="POC",
        worktree_path=str(tmp_path / "wt"),
        output_dir=str(tmp_path / "wt" / "output"),
        input_files=["input/rfp.md"],
    )


def _downgrade_to_legacy(path: Path) -> None:
    """Rewrite a modern plan.mdc into the pre-DSL v1 format (strip new keys)."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    assert m is not None, "plan.mdc must start with a frontmatter block"
    front = json.loads(m.group(1))
    for key in DSL_V1_PLAN_KEYS:
        front.pop(key, None)
    front.pop("stages", None)  # stage-level DSL v1 extension carrier
    path.write_text(
        "---\n" + json.dumps(front, ensure_ascii=False, indent=2) + "\n---" + text[m.end() :],
        encoding="utf-8",
    )


def _materialize_requirements(output_dir: Path) -> None:
    """Create the single artifact the requirements fast path checks."""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "requirement-breakdown.md").write_text(
        "# Requirement Breakdown\n", encoding="utf-8"
    )


def test_plan_mdc_legacy_format_reads_defaults(tmp_path: Path) -> None:
    """旧格式 plan.mdc（frontmatter 无 DSL v1 新键）读出后新字段全为默认值。"""
    plan = _make_plan(tmp_path)
    update_stage(
        plan,
        "requirements",
        status="completed",
        artifacts=["output/requirement-breakdown.md"],
        blocker="",
    )
    path = tmp_path / "plan.mdc"
    write_plan(path, plan)
    _downgrade_to_legacy(path)

    loaded = read_plan(path)
    assert loaded is not None
    # New plan-level fields default to empty.
    assert loaded.intent == ""
    assert loaded.scope == {}
    assert loaded.case_refs == []
    # New stage-level fields default to empty for every stage.
    for stage in loaded.stages:
        assert stage.gate_criteria == []
        assert stage.artifact_refs == []
        assert stage.case_link == ""
    # Legacy fields still parse normally from the old format.
    req = next(s for s in loaded.stages if s.id == "requirements")
    assert req.status == "completed"
    assert req.artifacts == ["output/requirement-breakdown.md"]
    assert loaded.task_id == plan.task_id
    assert loaded.input_files == ["input/rfp.md"]


def test_plan_mdc_dsl_v1_roundtrip(tmp_path: Path) -> None:
    """新字段 write -> read 逐字段相等（含 update_stage 写入的 stage 级字段）。"""
    plan = _make_plan(tmp_path)
    plan.intent = "为客户交付一个 B 端管理后台 POC"
    plan.scope = {"domain": "b2b-saas", "team_size": "5-10", "model_requirement": "any"}
    plan.case_refs = ["cases/portal-scaffold/entry.md", "cases/auth-module/entry.md"]
    update_stage(
        plan,
        "requirements",
        status="completed",
        artifacts=["output/requirement-breakdown.md"],
        gate_criteria=["需求覆盖招标文档全部功能点", "验收标准可测试"],
        artifact_refs=["requirement-breakdown.md"],
        case_link="cases/portal-scaffold/requirements.md",
    )
    update_stage(
        plan,
        "design",
        gate_criteria=["设计规范一致性"],
        artifact_refs=["design/design-system.md"],
    )

    path = tmp_path / "plan.mdc"
    write_plan(path, plan)
    loaded = read_plan(path)

    assert loaded is not None
    # Full dataclass equality: every field (old + new) survives the roundtrip.
    assert loaded == plan
    # Explicit assertions for readable failure messages.
    assert loaded.intent == plan.intent
    assert loaded.scope == plan.scope
    assert loaded.case_refs == plan.case_refs
    for original, got in zip(plan.stages, loaded.stages):
        assert got.gate_criteria == original.gate_criteria
        assert got.artifact_refs == original.artifact_refs
        assert got.case_link == original.case_link
    # to_dict (LLM-facing payload) exposes the DSL v1 fields too.
    payload = loaded.to_dict()
    assert payload["intent"] == plan.intent
    assert payload["scope"] == plan.scope
    assert payload["case_refs"] == plan.case_refs


def test_plan_mdc_update_stage_dsl_v1_fields(tmp_path: Path) -> None:
    """update_stage 支持更新 DSL v1 的 stage 级新字段。"""
    plan = _make_plan(tmp_path)
    update_stage(
        plan,
        "design",
        gate_criteria=["设计规范一致性"],
        artifact_refs=["design/design-system.md"],
        case_link="cases/portal-scaffold/design.md",
    )
    stage = next(s for s in plan.stages if s.id == "design")
    assert stage.gate_criteria == ["设计规范一致性"]
    assert stage.artifact_refs == ["design/design-system.md"]
    assert stage.case_link == "cases/portal-scaffold/design.md"
    assert plan.current_stage == "design"


def test_stages_gate_fast_path_failure_skips_llm(tmp_path: Path) -> None:
    """fast path 失败时直接返回，不调用 LLM（假 llm_judge 断言未调用）。"""
    output_dir = tmp_path / "output"  # left empty -> requirements artifact missing
    calls: list[str] = []

    def fake_judge(stage_id: str, criteria: list[str], output_dir: Path) -> GateVerdict:
        calls.append(stage_id)
        return GateVerdict(passed=True, stage_id=stage_id, fast_path=False)

    verdict = validate_stage_with_gate(
        "requirements",
        output_dir,
        gate_criteria=["需求覆盖全部功能点"],
        llm_judge=fake_judge,
    )
    assert calls == []  # LLM never invoked
    assert verdict.passed is False
    assert verdict.stage_id == "requirements"
    assert verdict.fast_path is True
    assert verdict.failures == ["missing artifacts: requirement-breakdown.md"]
    assert verdict.suggestions == []


def test_stages_gate_llm_invoked_after_fast_path_pass(tmp_path: Path) -> None:
    """fast path 通过 + gate_criteria 非空 + llm_judge 提供时调用 llm_judge。"""
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)
    calls: list[tuple[str, list[str], Path]] = []

    def fake_judge(stage_id: str, criteria: list[str], output_dir: Path) -> GateVerdict:
        calls.append((stage_id, list(criteria), output_dir))
        return GateVerdict(
            passed=False,
            stage_id=stage_id,
            fast_path=False,
            failures=["gate '验收标准可测试' 未覆盖：缺少可执行的验收条目"],
            suggestions=["补充招标文档 §3.2 的验收用例"],
        )

    criteria = ["需求覆盖全部功能点", "验收标准可测试"]
    verdict = validate_stage_with_gate(
        "requirements", output_dir, gate_criteria=criteria, llm_judge=fake_judge
    )
    # llm_judge called exactly once with (stage_id, criteria, output_dir).
    assert len(calls) == 1
    assert calls[0][0] == "requirements"
    assert calls[0][1] == criteria
    assert calls[0][2] == output_dir
    # The judge's structured verdict is propagated with fast_path=False.
    assert verdict.passed is False
    assert verdict.stage_id == "requirements"
    assert verdict.fast_path is False
    assert verdict.failures == ["gate '验收标准可测试' 未覆盖：缺少可执行的验收条目"]
    assert verdict.suggestions == ["补充招标文档 §3.2 的验收用例"]
    # Criteria list passed by value: judge mutations cannot leak back.
    assert criteria == ["需求覆盖全部功能点", "验收标准可测试"]


def test_stages_gate_pure_fast_path_without_judge(tmp_path: Path) -> None:
    """llm_judge 为 None 时退化为纯 fast path（无论 gate_criteria 是否提供）。"""
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)

    # With criteria but no judge: pure fast path, no LLM involved.
    verdict = validate_stage_with_gate(
        "requirements", output_dir, gate_criteria=["需求覆盖全部功能点"]
    )
    assert verdict.passed is True
    assert verdict.stage_id == "requirements"
    assert verdict.fast_path is True
    assert verdict.failures == []
    assert verdict.suggestions == []

    # Without criteria and without judge: same pure fast path behaviour.
    verdict = validate_stage_with_gate("requirements", output_dir)
    assert verdict.passed is True
    assert verdict.fast_path is True


def test_stages_gate_verdict_failures_required_when_not_passed(tmp_path: Path) -> None:
    """负例：LLM 返回 passed=False 但 failures 为空时，结果被标记出结构化理由。"""
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)

    def bad_judge(stage_id: str, criteria: list[str], output_dir: Path) -> GateVerdict:
        return GateVerdict(passed=False, stage_id=stage_id, fast_path=False)

    verdict = validate_stage_with_gate(
        "requirements", output_dir, gate_criteria=["需求覆盖全部功能点"], llm_judge=bad_judge
    )
    assert verdict.passed is False
    assert verdict.fast_path is False
    # Flagged instead of silently failing: failures must stay non-empty and
    # traceable to the gate contract violation.
    assert len(verdict.failures) == 1
    assert "passed=False" in verdict.failures[0]
    assert "requirements" in verdict.failures[0]
