#!/usr/bin/env python3
"""LLM-backed stage agents for the delivery pipeline (SP-B).

``requirements`` / ``design`` 两阶段的产物从写死的 stub 模板升级为 LLM 真实生成；
SP-A 的两级质量门（``validate_stage_with_gate`` 的 ``llm_judge`` 契约）由
``llm_gate_judge`` 落地：读产物全文 + gate_criteria → 单次 LLM → 结构化 JSON 判定。

LLM 调用统一复用 ``brain/wiki_compiler._invoke_llm`` 的 provider 解析路径，
不另起 provider 栈；解析失败一律 fail-closed，绝不静默放行。

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Protocol

from agenticx.delivery.stages import GateVerdict

logger = logging.getLogger("agenticx.delivery.stage_agents")

# 走 StageAgent 的阶段（SP-B 范围）；development/testing/audit 保持 stub。
AGENT_STAGES = ("requirements", "design")

# 送入 Gate 评审的产物清单（与 stages.validate_stage_artifacts 的 checks 对齐）。
_GATE_ARTIFACT_FILES: dict[str, tuple[str, ...]] = {
    "requirements": ("requirement-breakdown.md",),
    "design": ("design/design-system.md",),
    "development": ("frontend/README.md",),
    "testing": ("qa/playwright-report/index.html",),
    "audit": ("delivery-summary.md",),
}

_GATE_OUTPUT_UNPARSEABLE = "gate output unparseable"


@dataclass
class StageAgentResult:
    """Agent 单阶段执行结果。

    ``artifacts`` 为相对 ``output_dir`` 的产物路径；``summary`` 描述本阶段
    做了什么（进 case-entry 的 outcome 字段，SP-C 消费）。
    """

    artifacts: List[str] = field(default_factory=list)
    summary: str = ""


class StageAgent(Protocol):
    def run(
        self, *, intent: str, input_files: List[str], output_dir: Path
    ) -> StageAgentResult: ...


def llm_call(messages: List[Dict[str, str]]) -> str:
    """单次 LLM 调用——复用 brain.wiki_compiler 的 provider 解析路径。"""
    from agenticx.brain.wiki_compiler import _invoke_llm

    return _invoke_llm(messages, provider_name=None, model_name=None)


def default_llm_factory() -> Callable[[], Any] | None:
    """探测默认 provider 可用性；不可用返回 None → 调用方降级 stub。

    只做 provider 解析探测（不发真实请求）；返回的工厂每次调用动态解析
    ``llm_call``，便于测试离线替换。
    """
    try:
        from agenticx.llms.provider_resolver import ProviderResolver

        ProviderResolver.resolve()
    except Exception:
        logger.info("stage-agent LLM unavailable; delivery stages fall back to stubs")
        return None
    return lambda: llm_call


def _read_input_materials(input_files: List[str], *, per_file_limit: int = 6000) -> str:
    blocks: List[str] = []
    for raw in input_files:
        path = Path(str(raw)).expanduser()
        if not path.is_file():
            blocks.append(f"### {raw}\n(文件不存在或不可读)")
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = "(读取失败)"
        blocks.append(f"### {path.name}\n{text[:per_file_limit]}")
    return "\n\n".join(blocks) if blocks else "(无输入材料)"


def _extract_acceptance_criteria(output_dir: Path) -> str:
    """提取上一阶段 requirement-breakdown.md 的验收标准段（设计须引用）。"""
    req = output_dir / "requirement-breakdown.md"
    if not req.is_file():
        return ""
    try:
        text = req.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    m = re.search(r"^##\s*验收标准\s*$(.*?)(?=^##\s|\Z)", text, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else ""


class RequirementsAgent:
    """需求分析 Agent：生成 requirement-breakdown.md（目标/验收标准/边界/风险）。"""

    def __init__(self, llm_factory: Callable[[], Any]) -> None:
        self._llm_factory = llm_factory

    def run(
        self, *, intent: str, input_files: List[str], output_dir: Path
    ) -> StageAgentResult:
        materials = _read_input_materials(input_files)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 B 端交付流水线的需求分析 Agent。基于项目意图与输入材料撰写 requirement-breakdown.md。\n"
                    "输出要求：\n"
                    "1. 直接输出 Markdown 正文，不要用代码块包裹，不要任何解释性前后缀；\n"
                    "2. 必须包含四个二级章节：## 目标、## 验收标准、## 边界、## 风险；\n"
                    "3. ## 验收标准 用可勾选清单（- [ ] ...），每条必须可测试；\n"
                    "4. ## 边界 写明本期不做的事项；## 风险 列出交付风险与缓解措施。"
                ),
            },
            {
                "role": "user",
                "content": f"## 项目意图\n{intent or '(未提供)'}\n\n## 输入材料\n{materials}",
            },
        ]
        invoke = self._llm_factory()
        content = invoke(messages)
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / "requirement-breakdown.md"
        path.write_text(content.strip() + "\n", encoding="utf-8")
        return StageAgentResult(
            artifacts=["requirement-breakdown.md"],
            summary=(
                f"RequirementsAgent 基于项目意图与 {len(input_files)} 份输入材料"
                "生成需求拆解（目标/验收标准/边界/风险）"
            ),
        )


class DesignAgent:
    """UI/UX 设计 Agent：生成 design/design-system.md，引用需求拆解的验收标准。"""

    def __init__(self, llm_factory: Callable[[], Any]) -> None:
        self._llm_factory = llm_factory

    def run(
        self, *, intent: str, input_files: List[str], output_dir: Path
    ) -> StageAgentResult:
        criteria = _extract_acceptance_criteria(output_dir)
        materials = _read_input_materials(input_files)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 B 端交付流水线的 UI/UX 设计 Agent。基于需求拆解撰写 design/design-system.md 设计系统文档。\n"
                    "输出要求：\n"
                    "1. 直接输出 Markdown 正文，不要用代码块包裹，不要任何解释性前后缀；\n"
                    "2. 必须包含四个二级章节：## 设计原则、## 设计令牌、## 布局与组件、## 验收标准映射；\n"
                    "3. ## 验收标准映射 必须逐条引用需求拆解中的验收标准，并说明设计如何覆盖；\n"
                    "4. 视觉基线：企业级 indigo/violet 主色（OKLCH 令牌）、8px 网格的舒适 B2B 密度。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"## 项目意图\n{intent or '(未提供)'}\n\n"
                    "## 需求拆解的验收标准\n"
                    f"{criteria or '(未找到需求拆解产物，请基于项目意图自行推导验收标准)'}\n\n"
                    f"## 输入材料\n{materials}"
                ),
            },
        ]
        invoke = self._llm_factory()
        content = invoke(messages)
        design_dir = output_dir / "design"
        design_dir.mkdir(parents=True, exist_ok=True)
        path = design_dir / "design-system.md"
        path.write_text(content.strip() + "\n", encoding="utf-8")
        return StageAgentResult(
            artifacts=["design/design-system.md"],
            summary="DesignAgent 基于需求验收标准生成设计系统文档（原则/令牌/布局/验收标准映射）",
        )


def make_stage_agent(
    stage_id: str,
    *,
    llm_factory: Callable[[], Any] | None = None,
) -> StageAgent | None:
    """llm_factory 为 None 时返回 None → 调用方降级到 stub。"""
    if llm_factory is None:
        return None
    if stage_id == "requirements":
        return RequirementsAgent(llm_factory=llm_factory)
    if stage_id == "design":
        return DesignAgent(llm_factory=llm_factory)
    return None


def _parse_gate_json(raw: str) -> Dict[str, Any]:
    """解析 gate JSON，容忍 markdown 围栏与前后缀文本；失败即抛异常。"""
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty gate output")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise
        data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise ValueError("gate output is not a JSON object")
    return data


def _format_gate_failures(items: Any) -> List[str]:
    failures: List[str] = []
    if not isinstance(items, list):
        return failures
    for item in items:
        if isinstance(item, dict):
            criterion = str(item.get("criterion") or "unknown criterion")
            reason = str(item.get("reason") or "").strip()
            failures.append(
                f"gate '{criterion}' 未通过：{reason}" if reason else f"gate '{criterion}' 未通过"
            )
        else:
            failures.append(str(item))
    return failures


def _collect_artifacts_text(stage_id: str, output_dir: Path) -> str:
    blocks: List[str] = []
    for name in _GATE_ARTIFACT_FILES.get(stage_id, ()):
        path = output_dir / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        blocks.append(f"### {name}\n{text}")
    return "\n\n".join(blocks)


def llm_gate_judge(stage_id: str, gate_criteria: List[str], output_dir: Path) -> GateVerdict:
    """LLM 质量门（满足 SP-A ``llm_judge`` 签名契约）。

    读产物全文 + criteria → 单次 LLM 调用 → 要求 JSON 输出
    ``{passed, failures[{criterion, reason}], suggestions[]}``；
    输出解析失败 → fail-closed（``passed=False``，failures 含占位理由，不静默放行）。
    """
    artifacts_text = _collect_artifacts_text(stage_id, output_dir)
    criteria_block = "\n".join(f"- {c}" for c in gate_criteria) or "- (无)"
    messages = [
        {
            "role": "system",
            "content": (
                "你是交付流水线的阶段质量门评审（Gate Judge）。对照验收标准逐条评审阶段产物，只输出一个 JSON 对象。\n"
                "JSON 格式（不要 markdown 代码块，不要多余文字）：\n"
                '{"passed": true, "failures": [], "suggestions": []}\n'
                '不通过时 "passed" 为 false，failures 为 '
                '[{"criterion": "未通过的标准原文", "reason": "具体、可反驳的原因"}]，不得为空；\n'
                "suggestions 为可选的改进建议列表。\n\n"
                f"## 阶段\n{stage_id}\n\n"
                f"## 验收标准\n{criteria_block}\n\n"
                f"## 阶段产物\n{artifacts_text[:12000] or '(无产物内容)'}"
            ),
        },
        {"role": "user", "content": "输出 JSON 判定。"},
    ]
    try:
        raw = llm_call(messages)
        data = _parse_gate_json(raw)
        passed = bool(data.get("passed"))
        failures = _format_gate_failures(data.get("failures"))
        suggestions = [str(s) for s in (data.get("suggestions") or []) if str(s)]
    except Exception:
        logger.warning("gate judge output unparseable for stage %s", stage_id, exc_info=True)
        return GateVerdict(
            passed=False,
            stage_id=stage_id,
            fast_path=False,
            failures=[_GATE_OUTPUT_UNPARSEABLE],
        )
    return GateVerdict(
        passed=passed,
        stage_id=stage_id,
        fast_path=False,
        failures=failures,
        suggestions=suggestions,
    )
