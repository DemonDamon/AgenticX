#!/usr/bin/env python3
"""SP-D case consumption tests: search + init-time injection + CLI.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from agenticx.cases.init_inject import InjectionResult, init_project_from_case
from agenticx.cases.model import CaseEntry
from agenticx.cases.search import CaseHit, search_cases
from agenticx.cases.store import CaseStore
from agenticx.delivery.plan_mdc import read_plan


def _auto_case() -> CaseEntry:
    return CaseEntry(
        case_id="case-auto-001",
        title="Automotive Configurator POC",
        summary="汽车车型配置器 POC 交付案例",
        problem="车企需要在线车型配置与报价能力",
        solution="五阶段流水线 + 配置器组件库",
        scope={"domain": "automotive"},
    )


def _retail_case() -> CaseEntry:
    return CaseEntry(
        case_id="case-retail-001",
        title="Retail Dashboard POC",
        summary="零售数据看板交付案例",
        problem="连锁零售需要经营数据看板",
        solution="五阶段流水线 + 看板模板",
        scope={"domain": "retail"},
    )


def _no_scope_case() -> CaseEntry:
    return CaseEntry(
        case_id="case-bare-001",
        title="Bare Pipeline",
        summary="通用流水线交付案例",
        problem="需要一条通用交付流水线",
        solution="五阶段流水线",
        scope={},
    )


# ---------- search ----------


def test_search_hits_correct_case_and_scores(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    store.save(_auto_case())
    store.save(_retail_case())

    hits = search_cases("配置器", store=store)
    assert [hit.entry.case_id for hit in hits] == ["case-auto-001"]
    hit = hits[0]
    assert isinstance(hit, CaseHit)
    # summary(3.0) + solution(1.0)；problem 只有"配置"不含"配置器"
    assert hit.score == 4.0
    assert hit.matched_on == ["summary", "solution"]

    # 命中全部三个字段
    dashboard = search_cases("看板", store=store)
    assert [h.entry.case_id for h in dashboard] == ["case-retail-001"]
    assert dashboard[0].score == 6.0
    assert dashboard[0].matched_on == ["summary", "problem", "solution"]


def test_search_no_result_returns_empty(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    store.save(_auto_case())

    assert search_cases("完全不存在的关键词", store=store) == []
    # 空查询同样返回空列表，不报错
    assert search_cases("", store=store) == []
    assert search_cases("   ", store=store) == []


def test_search_scope_filter_filters_and_passes_through(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    store.save(_auto_case())
    store.save(_retail_case())
    store.save(_no_scope_case())

    # "流水线" 命中三个 case 的 solution；按 domain=retail 硬过滤后只剩 retail
    hits = search_cases("流水线", store=store, scope_filter={"domain": "retail"})
    ids = [hit.entry.case_id for hit in hits]
    assert "case-retail-001" in ids
    assert "case-auto-001" not in ids
    # case 无 domain 键 → 保守放行
    assert "case-bare-001" in ids

    # 不带 filter 时全部命中
    all_hits = search_cases("流水线", store=store)
    assert {h.entry.case_id for h in all_hits} == {
        "case-auto-001",
        "case-retail-001",
        "case-bare-001",
    }


def test_search_top_k_and_tie_order(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "cases")
    store.save(_retail_case())
    store.save(_auto_case())

    # "流水线" 命中两个 case 的 solution（同分 1.0），top_k=1 取 case_id 字典序靠前者
    hits = search_cases("流水线", store=store, top_k=1)
    assert [hit.entry.case_id for hit in hits] == ["case-auto-001"]

    assert len(search_cases("流水线", store=store, top_k=5)) == 2


def test_search_tolerates_missing_store_root(tmp_path: Path) -> None:
    store = CaseStore(tmp_path / "not-created")
    assert search_cases("任意", store=store) == []


# ---------- init_inject ----------


def _store_with_artifacts(tmp_path: Path) -> tuple[CaseStore, CaseEntry]:
    store = CaseStore(tmp_path / "cases")
    wiki_src = store.root / "wiki" / "auto-config-guide.md"
    wiki_src.parent.mkdir(parents=True, exist_ok=True)
    wiki_src.write_text("# 配置器交付指南\n", encoding="utf-8")
    skill_dir = store.root / "skills" / "configurator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text("skill doc", encoding="utf-8")

    case = CaseEntry(
        case_id="case-auto-001",
        title="Automotive Configurator POC",
        summary="汽车车型配置器 POC 交付案例",
        problem="车企需要在线车型配置与报价能力",
        solution="五阶段流水线 + 配置器组件库",
        artifacts=[
            "wiki/auto-config-guide.md",
            "skills/configurator",
            "wiki/missing-page.md",       # 缺失：记 report，不抛异常
            "output/task0001/report.md",  # 非 wiki/skills 前缀：不注入
        ],
        scope={"domain": "automotive", "team_size": "5"},
    )
    store.save(case)
    return store, case


def test_init_project_from_case(tmp_path: Path) -> None:
    store, case = _store_with_artifacts(tmp_path)
    target = tmp_path / "new-project"

    result = init_project_from_case(
        case, target_dir=target, store=store, intent="做一个新车配置器 POC"
    )

    assert isinstance(result, InjectionResult)
    assert result.plan_path == target / "plan.mdc"
    assert result.plan_path.is_file()

    plan = read_plan(result.plan_path)
    assert plan is not None
    assert plan.case_refs == ["case-auto-001"]
    assert plan.intent == "做一个新车配置器 POC"
    assert plan.scope == {"domain": "automotive", "team_size": "5"}

    # wiki 页面复制到位（内容一致）
    assert result.wiki_pages == [target / "wiki" / "auto-config-guide.md"]
    assert (target / "wiki" / "auto-config-guide.md").read_text(encoding="utf-8") == "# 配置器交付指南\n"

    # skills 目录整体复制到位
    assert result.skills == [target / "skills" / "configurator"]
    assert (target / "skills" / "configurator" / "SKILL.md").is_file()

    # 缺失 artifact：进 report、不抛异常、不产生目标文件
    assert "wiki/missing-page.md" in result.report
    assert not (target / "wiki" / "missing-page.md").exists()

    # 非 wiki/skills 前缀：记 report，不注入
    assert "output/task0001/report.md" in result.report
    assert not (target / "output" / "task0001" / "report.md").exists()


def test_init_intent_falls_back_to_case_summary(tmp_path: Path) -> None:
    store, case = _store_with_artifacts(tmp_path)
    target = tmp_path / "fallback-project"

    result = init_project_from_case(case, target_dir=target, store=store)

    plan = read_plan(result.plan_path)
    assert plan is not None
    assert plan.intent == case.summary


def test_init_creates_target_dir(tmp_path: Path) -> None:
    store, case = _store_with_artifacts(tmp_path)
    target = tmp_path / "nested" / "brand-new"

    result = init_project_from_case(case, target_dir=target, store=store)
    assert target.is_dir()
    assert result.plan_path.is_file()


# ---------- CLI smoke ----------


def test_cli_case_search_smoke(tmp_path: Path, monkeypatch) -> None:
    from agenticx.cli.main import app

    monkeypatch.chdir(tmp_path)
    store = CaseStore(tmp_path / "cases")
    store.save(_auto_case())
    store.save(_retail_case())

    runner = CliRunner()
    result = runner.invoke(app, ["case", "search", "配置器"])
    assert result.exit_code == 0, result.output
    assert "case-auto-001" in result.output

    result = runner.invoke(
        app, ["case", "search", "看板", "--domain", "retail", "--top-k", "1"]
    )
    assert result.exit_code == 0, result.output
    assert "case-retail-001" in result.output

    # 无结果：正常退出并提示
    result = runner.invoke(app, ["case", "search", "完全不存在的关键词"])
    assert result.exit_code == 0, result.output
    assert "无匹配" in result.output


def test_cli_case_init_smoke(tmp_path: Path, monkeypatch) -> None:
    from agenticx.cli.main import app

    monkeypatch.chdir(tmp_path)
    store, case = _store_with_artifacts(tmp_path)
    store.save(case)

    target = tmp_path / "proj"
    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "case", "init",
            "--case", "case-auto-001",
            "--target", str(target),
            "--intent", "新车配置器 POC",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (target / "plan.mdc").is_file()
    assert (target / "wiki" / "auto-config-guide.md").is_file()
    assert (target / "skills" / "configurator" / "SKILL.md").is_file()

    plan = read_plan(target / "plan.mdc")
    assert plan is not None
    assert plan.case_refs == ["case-auto-001"]
    assert plan.intent == "新车配置器 POC"
    # 缺失 artifact 记入 report 且命令仍成功
    assert "wiki/missing-page.md" in result.output

    # case 不存在 → 退出码 1
    result = runner.invoke(
        app, ["case", "init", "--case", "no-such-case", "--target", str(tmp_path / "p2")]
    )
    assert result.exit_code == 1
