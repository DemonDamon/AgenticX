#!/usr/bin/env python3
"""SP-B delivery stage agents — offline tests (fake LLM, no real calls).

Covers (per plans/b-end-case-library/sp-b-delivery-agents.md):
- RequirementsAgent artifact contains the acceptance-criteria structure
- DesignAgent prompt reuses requirements' acceptance criteria
- make_stage_agent: None factory / non-agent stage → None
- stage_agent absent → orchestrator behaviour unchanged (regression lock)
- Gate failure → structured failures land in blocker + retry triggered
- llm_gate_judge unparseable output → fail-closed
- dry_run=True never calls the LLM

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.delivery.orchestrator import DeliveryOrchestrator, TaskSpec
from agenticx.delivery.plan_mdc import default_plan, read_plan, update_stage
from agenticx.delivery.stage_agents import (
    DesignAgent,
    RequirementsAgent,
    default_llm_factory,
    llm_gate_judge,
    make_stage_agent,
)
from agenticx.delivery.stages import materialize_stage_artifacts
from agenticx.delivery.store import get_task

_SAMPLE = Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery" / "sample-rfp.md"

FAKE_REQUIREMENTS_MD = """# Requirement Breakdown — Demo Portal POC

## 目标
- 交付可演示的 B 端门户 POC

## 验收标准
- [ ] 登录后首页无报错渲染
- [ ] 表单必填校验生效

## 边界
- 不含支付流程

## 风险
- 需求蔓延：以验收标准冻结范围
"""

FAKE_DESIGN_MD = """# Design System — Demo Portal POC

## 设计原则
- 企业级 indigo/violet 视觉基线

## 设计令牌
- Primary: indigo/violet OKLCH tokens

## 布局与组件
- AppShell + 分组侧栏 + 内容画布

## 验收标准映射
- 登录后首页无报错渲染 → AppShell 骨架与路由守卫
"""

FAKE_GATE_FAIL_JSON = json.dumps(
    {
        "passed": False,
        "failures": [{"criterion": "需求覆盖全部功能点", "reason": "缺少权限管理相关验收条目"}],
        "suggestions": ["补充招标文档 §2.1 的权限验收用例"],
    },
    ensure_ascii=False,
)

FAKE_GATE_PASS_JSON = json.dumps(
    {"passed": True, "failures": [], "suggestions": []}, ensure_ascii=False
)


class FakeLLM:
    """按 system prompt 关键词路由「需求/设计 Agent 生成 / Gate 判定」的假 LLM。"""

    def __init__(self, agent_output: str, judge_output: str, design_output: str = "") -> None:
        self.agent_output = agent_output
        self.design_output = design_output or agent_output
        self.judge_output = judge_output
        self.agent_calls: list[list[dict]] = []
        self.design_calls: list[list[dict]] = []
        self.judge_calls: list[list[dict]] = []

    def __call__(self, messages: list[dict]) -> str:
        system = messages[0]["content"] if messages else ""
        if "Gate Judge" in system:
            self.judge_calls.append(messages)
            return self.judge_output
        if "UI/UX 设计 Agent" in system:
            self.design_calls.append(messages)
            return self.design_output
        self.agent_calls.append(messages)
        return self.agent_output


@pytest.fixture()
def delivery_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    worktree_root = tmp_path / "deliveries"
    store_root = tmp_path / "delivery-store"
    monkeypatch.setenv("AGX_DELIVERY_DRY_RUN", "1")
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
        "agenticx.delivery.orchestrator.resolve_repo_root", lambda configured="": tmp_path
    )
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.ensure_delivery_bundle",
        lambda: {"ok": True, "bundle": {"skipped": True}, "avatars": []},
    )
    return worktree_root


def _config(delivery_env: Path, *, dry_run: bool, max_stage_retries: int = 2) -> dict:
    return {
        "enabled": True,
        "dry_run": dry_run,
        "worktree_root": str(delivery_env),
        "max_stage_retries": max_stage_retries,
        "repo_root": "",
        "bundle_source": str(
            Path(__file__).resolve().parents[1] / "examples" / "agenticx-for-delivery"
        ),
    }


def _patch_gate_criteria(monkeypatch: pytest.MonkeyPatch, *stage_criteria: tuple[str, list[str]]) -> None:
    """让 start_delivery 生成的 default_plan 自带 stage 级 gate_criteria。"""

    def _plan_with_gate(**kwargs):
        plan = default_plan(**kwargs)
        for stage_id, criteria in stage_criteria:
            update_stage(plan, stage_id, gate_criteria=list(criteria))
        return plan

    monkeypatch.setattr("agenticx.delivery.orchestrator.default_plan", _plan_with_gate)


# ---------------------------------------------------------------------------
# Agent 单元（离线 fake LLM）
# ---------------------------------------------------------------------------


def test_requirements_agent_writes_structured_breakdown(tmp_path: Path) -> None:
    fake = FakeLLM(agent_output=FAKE_REQUIREMENTS_MD, judge_output="{}")
    agent = RequirementsAgent(llm_factory=lambda: fake)
    output_dir = tmp_path / "output"

    result = agent.run(intent="交付企业门户 POC", input_files=[], output_dir=output_dir)

    artifact = output_dir / "requirement-breakdown.md"
    assert artifact.is_file()
    text = artifact.read_text(encoding="utf-8")
    assert "## 目标" in text
    assert "## 验收标准" in text
    assert "## 边界" in text
    assert "## 风险" in text
    assert result.artifacts == ["requirement-breakdown.md"]
    assert result.summary
    # 项目意图进入了 prompt
    assert any("交付企业门户 POC" in m["content"] for m in fake.agent_calls[0])


def test_design_agent_prompt_reuses_acceptance_criteria(tmp_path: Path) -> None:
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True)
    (output_dir / "requirement-breakdown.md").write_text(FAKE_REQUIREMENTS_MD, encoding="utf-8")
    fake = FakeLLM(agent_output=FAKE_DESIGN_MD, judge_output="{}")
    agent = DesignAgent(llm_factory=lambda: fake)

    result = agent.run(intent="交付企业门户 POC", input_files=[], output_dir=output_dir)

    assert (output_dir / "design" / "design-system.md").is_file()
    assert result.artifacts == ["design/design-system.md"]
    assert result.summary
    # 设计 prompt 引用了需求拆解的验收标准
    user_msg = fake.design_calls[0][1]["content"]
    assert "登录后首页无报错渲染" in user_msg


def test_make_stage_agent_factory_gate_and_stage_scope() -> None:
    fake = FakeLLM(agent_output="", judge_output="")
    assert make_stage_agent("requirements", llm_factory=None) is None
    assert make_stage_agent("design", llm_factory=None) is None
    assert make_stage_agent("development", llm_factory=lambda: fake) is None
    assert make_stage_agent("testing", llm_factory=lambda: fake) is None
    assert make_stage_agent("requirements", llm_factory=lambda: fake) is not None
    assert make_stage_agent("design", llm_factory=lambda: fake) is not None


def test_default_llm_factory_none_path_is_documented() -> None:
    """default_llm_factory 契约：返回的工厂每次调用动态解析 llm_call（可替换）。"""
    factory = default_llm_factory()
    if factory is None:  # 无 provider 配置的环境：合法降级
        pytest.skip("no LLM provider configured in this environment")
    assert callable(factory())


# ---------------------------------------------------------------------------
# materialize：Agent 路径 / 降级 / dry-run
# ---------------------------------------------------------------------------


def test_materialize_uses_agent_for_requirements(tmp_path: Path) -> None:
    worktree = tmp_path / "wt"
    output_dir = worktree / "output" / "t1"
    output_dir.mkdir(parents=True)
    fake = FakeLLM(agent_output=FAKE_REQUIREMENTS_MD, judge_output="{}")
    agent = RequirementsAgent(llm_factory=lambda: fake)

    rel_paths = materialize_stage_artifacts(
        "requirements",
        output_dir=output_dir,
        worktree_path=worktree,
        project_name="Demo",
        input_files=[],
        dry_run=False,
        stage_agent=agent,
    )

    assert rel_paths == ["output/t1/requirement-breakdown.md"]
    assert (
        output_dir / "requirement-breakdown.md"
    ).read_text(encoding="utf-8") == FAKE_REQUIREMENTS_MD.strip() + "\n"


def test_materialize_dry_run_ignores_stage_agent(tmp_path: Path) -> None:
    worktree = tmp_path / "wt"
    output_dir = worktree / "output"
    output_dir.mkdir(parents=True)

    class _ExplodingAgent:
        def run(self, **kwargs):
            raise AssertionError("dry_run must not invoke the stage agent")

    rel_paths = materialize_stage_artifacts(
        "requirements",
        output_dir=output_dir,
        worktree_path=worktree,
        project_name="Demo",
        input_files=["a.md"],
        dry_run=True,
        stage_agent=_ExplodingAgent(),
    )

    # dry_run 走模板：路径与内容与既有 stub 完全一致
    assert rel_paths == ["output/requirement-breakdown.md"]
    text = (output_dir / "requirement-breakdown.md").read_text(encoding="utf-8")
    assert "Requirement Breakdown — Demo" in text


def test_materialize_agent_failure_falls_back_to_stub(tmp_path: Path) -> None:
    worktree = tmp_path / "wt"
    output_dir = worktree / "output"
    output_dir.mkdir(parents=True)

    class _BrokenAgent:
        def run(self, **kwargs):
            raise RuntimeError("LLM down")

    rel_paths = materialize_stage_artifacts(
        "requirements",
        output_dir=output_dir,
        worktree_path=worktree,
        project_name="Demo",
        input_files=[],
        dry_run=False,
        stage_agent=_BrokenAgent(),
    )

    assert rel_paths == ["output/requirement-breakdown.md"]
    assert (output_dir / "requirement-breakdown.md").is_file()


# ---------------------------------------------------------------------------
# llm_gate_judge：fail-closed / 结构化解析
# ---------------------------------------------------------------------------


def _materialize_requirements(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "requirement-breakdown.md").write_text(FAKE_REQUIREMENTS_MD, encoding="utf-8")


def test_llm_gate_judge_fail_closed_on_unparseable_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)

    monkeypatch.setattr(
        "agenticx.delivery.stage_agents.llm_call",
        lambda messages: "抱歉，我无法以 JSON 格式回答。",
    )
    verdict = llm_gate_judge("requirements", ["需求覆盖全部功能点"], output_dir)
    assert verdict.passed is False
    assert verdict.fast_path is False
    assert verdict.stage_id == "requirements"
    assert verdict.failures == ["gate output unparseable"]


def test_llm_gate_judge_fail_closed_on_llm_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)

    def _boom(messages):
        raise RuntimeError("network down")

    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", _boom)
    verdict = llm_gate_judge("requirements", ["需求覆盖全部功能点"], output_dir)
    assert verdict.passed is False
    assert verdict.failures == ["gate output unparseable"]


def test_llm_gate_judge_parses_structured_verdict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)
    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", lambda m: FAKE_GATE_FAIL_JSON)

    verdict = llm_gate_judge("requirements", ["需求覆盖全部功能点"], output_dir)
    assert verdict.passed is False
    assert verdict.fast_path is False
    assert len(verdict.failures) == 1
    assert "需求覆盖全部功能点" in verdict.failures[0]
    assert "缺少权限管理相关验收条目" in verdict.failures[0]
    assert verdict.suggestions == ["补充招标文档 §2.1 的权限验收用例"]


def test_llm_gate_judge_tolerates_code_fence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output_dir = tmp_path / "output"
    _materialize_requirements(output_dir)
    fenced = f"```json\n{FAKE_GATE_FAIL_JSON}\n```"
    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", lambda m: fenced)

    verdict = llm_gate_judge("requirements", ["需求覆盖全部功能点"], output_dir)
    assert verdict.passed is False
    assert verdict.failures
    assert "需求覆盖全部功能点" in verdict.failures[0]


# ---------------------------------------------------------------------------
# orchestrator 集成：回归锁定 + Gate 失败退回 + 全链路通过
# ---------------------------------------------------------------------------


def test_stage_agent_absent_pipeline_unchanged(
    delivery_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """回归锁定：无 stage_agent（dry-run）时 orchestrator 行为与现在完全一致。"""
    monkeypatch.setattr(
        # orchestrator 顶部 from ... import 把函数绑定进自身命名空间，
        # patch config 模块拦不住（现有测试靠 AGX_DELIVERY_DRY_RUN env 兜底无感），
        # 这里必须 patch orchestrator 命名空间才能真正控制 dry_run。
        "agenticx.delivery.orchestrator.get_delivery_config",
        lambda: _config(delivery_env, dry_run=True),
    )
    llm_calls: list[list[dict]] = []
    monkeypatch.setattr(
        "agenticx.delivery.stage_agents.llm_call",
        lambda m: llm_calls.append(m) or "",
    )

    orch = DeliveryOrchestrator()
    result = orch.start_delivery(
        TaskSpec(project_name="Regression Portal", target="POC", input_files=[str(_SAMPLE)])
    )
    assert result.get("ok") is True
    record = get_task(str(result.get("task_id")))
    assert record is not None
    assert record.status == "completed"

    plan = read_plan(Path(record.plan_path))
    assert plan is not None
    assert plan.overall_status == "completed"
    assert all(s.status == "completed" for s in plan.stages)

    output = Path(record.output_dir)
    assert (output / "requirement-breakdown.md").is_file()
    assert (output / "design" / "design-system.md").is_file()
    assert (output / "frontend" / "README.md").is_file()
    assert (output / "qa" / "playwright-report" / "index.html").is_file()
    assert (output / "delivery-summary.md").is_file()
    # 全程零 LLM 调用
    assert llm_calls == []


def test_dry_run_never_invokes_llm(delivery_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        # orchestrator 顶部 from ... import 把函数绑定进自身命名空间，
        # patch config 模块拦不住（现有测试靠 AGX_DELIVERY_DRY_RUN env 兜底无感），
        # 这里必须 patch orchestrator 命名空间才能真正控制 dry_run。
        "agenticx.delivery.orchestrator.get_delivery_config",
        lambda: _config(delivery_env, dry_run=True),
    )

    def _boom(messages):
        raise AssertionError("dry_run must not call the LLM")

    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", _boom)
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.default_llm_factory",
        lambda: (_ for _ in ()).throw(AssertionError("dry_run must not resolve an LLM")),
    )

    orch = DeliveryOrchestrator()
    result = orch.start_delivery(
        TaskSpec(project_name="Dry Demo", target="POC", input_files=[str(_SAMPLE)])
    )
    assert result.get("ok") is True
    record = get_task(str(result.get("task_id")))
    assert record is not None
    assert record.status == "completed"


def test_gate_failure_blocks_stage_with_structured_failures(
    delivery_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gate 失败 → blocker 含结构化 failures，复用 retry，超限转 awaiting_user。"""
    monkeypatch.setattr(
        # orchestrator 顶部 from ... import 把函数绑定进自身命名空间，
        # patch config 模块拦不住（现有测试靠 AGX_DELIVERY_DRY_RUN env 兜底无感），
        # 这里必须 patch orchestrator 命名空间才能真正控制 dry_run。
        "agenticx.delivery.orchestrator.get_delivery_config",
        lambda: _config(delivery_env, dry_run=False, max_stage_retries=2),
    )
    fake = FakeLLM(agent_output=FAKE_REQUIREMENTS_MD, judge_output=FAKE_GATE_FAIL_JSON)
    # default_llm_factory() 返回 factory，factory() 才是 messages→str 的调用函数。
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.default_llm_factory", lambda: (lambda: fake)
    )
    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", fake)
    _patch_gate_criteria(monkeypatch, ("requirements", ["需求覆盖全部功能点"]))

    orch = DeliveryOrchestrator()
    result = orch.start_delivery(
        TaskSpec(project_name="Gated Portal", target="POC", input_files=[str(_SAMPLE)])
    )
    assert result.get("ok") is True

    record = get_task(str(result.get("task_id")))
    assert record is not None
    assert record.status == "awaiting_user"

    plan = read_plan(Path(record.plan_path))
    req = next(s for s in plan.stages if s.id == "requirements")
    assert req.status == "awaiting_user"
    # blocker 含结构化 failures（criterion + reason），不是泛化字符串
    assert "需求覆盖全部功能点" in req.blocker
    assert "缺少权限管理相关验收条目" in req.blocker
    # 复用 retry 机制：初次失败 + 1 次重试（max_stage_retries=2 → 2 次后转 awaiting_user）
    assert req.retries == 2
    assert len(fake.judge_calls) == 2
    assert len(fake.agent_calls) == 2
    # 后续阶段未被推进
    design = next(s for s in plan.stages if s.id == "design")
    assert design.status == "pending"


def test_gate_pass_completes_stage_with_agent_artifacts(
    delivery_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """正向集成：Agent 生成 + LLM Gate 通过 → 阶段完成、产物是 Agent 版本。"""
    monkeypatch.setattr(
        # orchestrator 顶部 from ... import 把函数绑定进自身命名空间，
        # patch config 模块拦不住（现有测试靠 AGX_DELIVERY_DRY_RUN env 兜底无感），
        # 这里必须 patch orchestrator 命名空间才能真正控制 dry_run。
        "agenticx.delivery.orchestrator.get_delivery_config",
        lambda: _config(delivery_env, dry_run=False),
    )
    fake = FakeLLM(
        agent_output=FAKE_REQUIREMENTS_MD,
        judge_output=FAKE_GATE_PASS_JSON,
        design_output=FAKE_DESIGN_MD,
    )
    monkeypatch.setattr(
        "agenticx.delivery.orchestrator.default_llm_factory", lambda: (lambda: fake)
    )
    monkeypatch.setattr("agenticx.delivery.stage_agents.llm_call", fake)
    _patch_gate_criteria(
        monkeypatch,
        ("requirements", ["需求覆盖全部功能点"]),
        ("design", ["设计覆盖验收标准"]),
    )

    passed: list[str] = []
    orch = DeliveryOrchestrator(on_stage_passed=lambda sid, out, plan: passed.append(sid))
    result = orch.start_delivery(
        TaskSpec(project_name="Gated Pass Portal", target="POC", input_files=[str(_SAMPLE)])
    )
    assert result.get("ok") is True

    record = get_task(str(result.get("task_id")))
    assert record is not None
    assert record.status == "completed"

    plan = read_plan(Path(record.plan_path))
    assert plan.overall_status == "completed"
    req = next(s for s in plan.stages if s.id == "requirements")
    assert req.status == "completed"
    assert req.blocker == ""
    assert any(a.endswith("requirement-breakdown.md") for a in req.artifacts)

    # requirements/design 产物是 Agent 生成的（含目标章节），而非 stub 文本
    output = Path(record.output_dir)
    req_text = (output / "requirement-breakdown.md").read_text(encoding="utf-8")
    assert "## 验收标准" in req_text
    design_text = (output / "design" / "design-system.md").read_text(encoding="utf-8")
    assert "## 验收标准映射" in design_text
    # 两阶段均过了 LLM 门
    assert len(fake.judge_calls) == 2
    # SP-C 的 on_stage_passed 回调依然逐阶段触发
    assert passed[:2] == ["requirements", "design"]
