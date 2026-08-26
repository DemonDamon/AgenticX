#!/usr/bin/env python3
"""TeamBench 正式评测 runner (Phase 1 轻量版)。

策略：
- Phase 1 先用 LightweightRunner(串行/并行 LLM 调用 + 显式通信传参)，快速跑基线，不依赖 AgentTeamManager 的完整 agent loop
  好处：成本低、失败率低、可控、可复现。Phase 1 验证现象后，Phase 2 再接 AgentTeamManager 做完整版。
- runner 支持团队模式(按 roles 分工卡串行/并行执行)和个体模式(单 agent 全任务)，两者共享统一 artifact 打分器
- 全程用 DeepSeekProvider(OpenAI 兼容)，不依赖 AgenticX meta_agent，只复用 artifact 打分定义

架构：
  ExperimentRunner
    ├─ LightweightTeamRunner   # 团队模式：N 个角色串行 LLM 调用 + 通信消息传递
    ├─ LightweightSingleRunner # 个体模式：单 agent 一次 LLM 调用
    ├─ ArtifactScorer          # L1+L2 结构/数值断言 ≥80% + LLM-judge ≤20%
    ├─ MetricsComputer         # 计算 CTR / TR / CR / TMS
    └─ ResultWriter            # JSON 落盘 + CSV 汇总

用法：
  # 跑 15 任务基线（DS V4 Flash, 2 seeds, 个体+团队）
  export DEEPSEEK_API_KEY="sk-xxx"
  .venv/bin/python paper/infra/teambench_runner.py --tasks-dir paper/tasks/data/v0.1 \
      --seeds 0 1 --model deepseek-v4-flash --out paper/experiments/baseline_v0.1

  # 跑单个任务
  .venv/bin/python paper/infra/teambench_runner.py --task paper/tasks/data/v0.1/t-DOC-L-01.json \
      --seeds 0 --model deepseek-v4-flash
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import traceback
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from openai import OpenAI


# ── LLM 调用层（通用） ──────────────────────────────────────────────

class LLMClient:
    """轻量 LLM 客户端，支持 OpenAI 兼容接口。"""

    def __init__(self, api_key: str, base_url: str = "https://api.deepseek.com/v1",
                 model: str = "deepseek-v4-flash", temperature: float = 0.3):
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=600, max_retries=3)
        self.model = model
        # 推理/新模型（如 kimi-k3/k2.6）只允许 temperature=1
        if any(m in model for m in ("kimi-k3", "kimi-k2.6", "kimi-k2.7", "r1", "o1", "o3")):
            self.temperature = 1.0
        else:
            self.temperature = temperature

    def call(self, system: str, user: str, max_tokens: int = 32768,
             seed: Optional[int] = None, label: str = "") -> Dict[str, Any]:
        t0 = time.time()
        extra = {}
        if seed is not None and self.temperature != 1.0:
            extra["seed"] = seed
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=self.temperature,
                max_tokens=max_tokens,
                **extra,
            )
        except Exception as e:
            print(f"  [LLM ERROR {label}] {e}")
            return {"content": "", "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
                    "cached_tokens": 0, "elapsed": 0.0, "error": str(e)}
        elapsed = time.time() - t0
        choice = resp.choices[0]
        content = choice.message.content or ""
        u = resp.usage
        ct = (u.completion_tokens if u else 0) or 0
        # 提取缓存命中 token 数（DeepSeek: prompt_cache_hit_tokens, Kimi: cached_tokens）
        cached = 0
        for attr in ("prompt_cache_hit_tokens", "cached_tokens", "prompt_tokens_details"):
            val = getattr(u, attr, None) if u else None
            if isinstance(val, int) and val > 0:
                cached = val; break
            elif val is not None and hasattr(val, "__dict__"):
                # prompt_tokens_details 可能是对象，尝试取 cached_tokens 属性
                for sub_attr in ("cached_tokens", "cache_hit_tokens"):
                    sv = getattr(val, sub_attr, 0)
                    if isinstance(sv, int) and sv > 0:
                        cached = sv; break
        pt = (u.prompt_tokens if u else 0) or 0
        # DS Flash 有时 completion_tokens 已达 max_tokens 但 content 为空（被截断）
        if not content and ct >= max_tokens - 1:
            err = f"content空，疑似被max_tokens截断（completion_tokens={ct} / max={max_tokens}）"
            print(f"  [LLM WARN {label}] {err}")
            return {"content": "", "prompt_tokens": pt,
                    "completion_tokens": ct,
                    "total_tokens": (u.total_tokens if u else 0) or 0,
                    "cached_tokens": cached,
                    "elapsed": elapsed, "rounds": 1, "error": err}
        # finish_reason=length 标记截断也需要记录告警
        if getattr(choice, "finish_reason", None) == "length":
            print(f"  [LLM WARN {label}] finish_reason=length 截断（ct={ct} / max={max_tokens}）")
        if cached > 0:
            print(f"  [CACHE {label}] cached={cached}/{pt} prompt tokens ({cached/pt*100:.0f}% hit)" if pt else "")
        return {
            "content": content,
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "total_tokens": (u.total_tokens if u else 0) or 0,
            "cached_tokens": cached,
            "elapsed": elapsed,
            "rounds": 1,
        }


# ── Prompt 构建器（按任务自动生成） ──────────────────────────────────

def _collect_input_payload(task: Dict) -> Dict[str, Any]:
    """收集任务所有输入字段（shared_initial + 顶层的业务字段），避免数据遗漏。
    DOC-L-01 等 seed 迁移来的任务把 members/board/table_a/table_b 放在 task 顶层。"""
    payload = {"shared_initial": task.get("shared_initial", {})}
    TOP_LEVEL_DATA_KEYS = [
        "members", "report_template", "expected_cross_deps",
        "board", "history",
        "table_a", "table_b",
        "tasks", "sprints",
        "hr_checklist", "it_checklist", "admin_checklist",
        "hr_completed", "it_completed", "admin_completed",
        "new_hire",
        "ticket", "tech_logs",
        "quarter", "total_budget_hours", "demands",
        "product_brief", "fact_check_reference",
        "product", "product_name", "campaign_theme", "core_benefits",
        "product_name", "core_messages", "competitors",
        "tech_questions_count_target", "biz_questions_count_target",
        "verification_expected_cross_deps",
        "period",
    ]
    for k in TOP_LEVEL_DATA_KEYS:
        if k in task:
            payload[k] = task[k]
    return payload


def _prompt_single(task: Dict) -> Tuple[str, str]:
    """个体模式：单个 agent 独立完成整个任务。"""
    system = ("你是一个高效的办公助理。严格、精确、完整地按照要求完成任务，输出结构化的结果。"
              "只输出最终产物，不要多余解释。"
              "【字数约束】全文建议 1200-3500 字，最多不超过 4000 字。"
              "用精炼的专业中文，不要写套话、铺垫、复述题目。")
    tid = task["task_id"]
    payload = _collect_input_payload(task)
    payload_str = json.dumps(payload, ensure_ascii=False, indent=2)
    desc = task.get("description", "")
    roles_str = "\n".join(f"  - 角色{i+1}（{r['name']}/{r['role']}）：{r['responsibility']}"
                         for i, r in enumerate(task.get("roles", [])))
    user = f"""请独立完成以下办公任务。不需要分配角色，你自己从头到尾完成。

任务：{desc}
角色分工（供你参考任务内容，不需要实际分配）：
{roles_str}

输入数据（你需要处理的全部信息，含共享数据和任务专属数据）：
```json
{payload_str}
```

请直接输出最终产物。如果有章节要求（例如"周报含本章"），严格使用 verification.required_sections 中列出的章节标题（完全一致），不要自创新章节名。"""
    return system, user


# 团队模式 system prompt（所有角色共享，最大化缓存命中）
_TEAM_SYSTEM = (
    "你是一个高效的办公助理。严格、精确、完整地按照要求完成任务，输出结构化的结果。"
    "只专注完成你的分内工作，不要关心其他角色的工作，输出就是你分内的交付物。"
    "【字数约束】输出建议 800-2500 字，最多不超过 2800 字。"
    "列要点、分条陈述，不要展开长篇大论，不要复述题目和共享数据。"
)


def _prompt_team_role(task: Dict, role_idx: int, prior_outputs: List[Tuple[str, str]]) -> Tuple[str, str, str]:
    """团队模式：为当前角色生成 prompt，含上游角色输出作为上下文。

    缓存优化策略：
    - system prompt 所有角色完全相同（固定常量），跨角色 100% 命中缓存
    - user prompt 把共享数据放前面（同任务跨角色前缀相同），角色特定信息放最后
    """
    role = task["roles"][role_idx]
    payload = _collect_input_payload(task)
    shared_str = json.dumps(payload, ensure_ascii=False, indent=2)

    prior_context = ""
    if prior_outputs:
        prior_context = "\n\n上游角色已完成的工作（你的输入上下文）：\n"
        for (rname, rout) in prior_outputs:
            truncated = rout[:4000] + ("... [上游输出过长已截断，请提取核心信息]" if len(rout) > 4000 else "")
            prior_context += f"\n--- {rname} 的交付物 ---\n{truncated}\n"

    # user prompt 结构：共享前缀（desc + shared_str）→ 变化后缀（prior + 角色定义）
    user = f"""请完成你在团队中的职责。

总体任务：{task.get('description', '')}

共享初始数据：
```
{shared_str}
```
{prior_context if prior_context else ""}

你的角色：{role['name']}（{role['role']}）
你的专属职责：{role['responsibility']}
请只输出你自己职责的交付物，不要输出不属于你职责的内容。"""

    return _TEAM_SYSTEM, user, role["name"]


# ── Runner 层 ───────────────────────────────────────────────────────

@dataclass
class RunResult:
    task_id: str
    office_type: str
    task_type: str
    mode: str                    # "team" or "single"
    model: str
    seed: int
    output: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0          # 缓存命中的 prompt token 数
    elapsed: float = 0.0
    llm_calls: int = 0
    error: str = ""
    # 指标
    Q: float = 0.0               # 质量分
    TMS: bool = False            # 团队任务成功率
    # 以下仅团队模式
    CTR: Optional[float] = None
    TR: Optional[float] = None


class LightweightSingleRunner:
    def __init__(self, llm: LLMClient): self.llm = llm
    def run(self, task: Dict, seed: int) -> RunResult:
        t0 = time.time()
        system, user = _prompt_single(task)
        r = self.llm.call(system, user, seed=seed, label=f"{task['task_id']} single s{seed}")
        return RunResult(
            task_id=task["task_id"],
            office_type=task.get("office_type", "?"),
            task_type=task.get("task_type", "?"),
            mode="single",
            model=self.llm.model,
            seed=seed,
            output=r["content"],
            prompt_tokens=r["prompt_tokens"],
            completion_tokens=r["completion_tokens"],
            total_tokens=r["total_tokens"],
            cached_tokens=r.get("cached_tokens", 0),
            elapsed=time.time() - t0,
            llm_calls=r.get("rounds", 1),
            error=r.get("error", ""),
        )


class LightweightTeamRunner:
    """串行执行 N 个角色，上游输出作为下游上下文。"""

    def __init__(self, llm: LLMClient): self.llm = llm

    def run(self, task: Dict, seed: int) -> RunResult:
        t0 = time.time()
        roles = task.get("roles", [])
        prior: List[Tuple[str, str]] = []
        last_output = ""
        total_p = 0; total_c = 0; total_cached = 0; calls = 0; total_elapsed = 0.0
        errors = []
        for i in range(len(roles)):
            system, user, rname = _prompt_team_role(task, i, prior)
            r = self.llm.call(system, user, seed=(seed * 17 + i) & 0x7fffffff,
                              label=f"{task['task_id']} team-{rname} s{seed}")
            total_p += r["prompt_tokens"]; total_c += r["completion_tokens"]
            total_cached += r.get("cached_tokens", 0)
            calls += r.get("rounds", 1); total_elapsed += r["elapsed"]
            if r.get("error"): errors.append(f"{rname}: {r['error']}")
            prior.append((rname, r["content"]))
            last_output = r["content"]  # 最后一个角色的输出 = 团队产出
        return RunResult(
            task_id=task["task_id"],
            office_type=task.get("office_type", "?"),
            task_type=task.get("task_type", "?"),
            mode="team",
            model=self.llm.model,
            seed=seed,
            output=last_output,
            prompt_tokens=total_p,
            completion_tokens=total_c,
            total_tokens=total_p + total_c,
            cached_tokens=total_cached,
            elapsed=time.time() - t0,
            llm_calls=calls,
            error="; ".join(errors),
        )


# ── Artifact Scorer（L1+L2 ≥80% + LLM-judge ≤20%） ─────────────────

class ArtifactScorer:
    """按 metrics 定义 v0.1 的 L1/L2/L3 三层打分。L1+L2 权重≥80%。

    L3 (LLM-judge) 可选：若传入 llm_judge=LLMJudgeScorer 实例则启用，否则 fallback 0.6。
    """

    def __init__(self, llm: Optional[LLMClient] = None,
                 llm_judge=None):
        self.llm = llm
        self.llm_judge = llm_judge  # paper.metrics.llm_judge.LLMJudgeScorer 实例或 None

    def score(self, output: str, task: Dict, mode: str) -> Tuple[float, bool, Dict[str, float]]:
        """返回 (质量分Q 0-1, TMS bool, 分项明细 dict)。"""
        tid = task["task_id"]
        V = task.get("verification", {})
        detail: Dict[str, float] = {}

        # L1 结构断言（正则/关键词）
        l1, l1_w = 0.0, 0
        for sec in V.get("required_sections", []):
            l1_w += 1
            if not sec:
                continue
            # 先精确匹配，再降级为"核心词 ≥80% 命中"（解决 "本周进展" ↔ "本周核心内容整合" 这类问题）
            if sec in output:
                l1 += 1
                continue
            words = [c for c in re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", sec)]
            if not words: l1 += 1; continue
            hits = sum(1 for c in words if c in output)
            ratio = hits / len(words)
            l1 += min(ratio / 0.8, 1.0) if ratio >= 0.5 else 0
        for el in V.get("required_elements", []):
            l1_w += 1
            if el and el in output:
                l1 += 1
        for field in V.get("reply_required_elements", []):
            l1_w += 1
            if field and field in output:
                l1 += 1
        # core message 覆盖检查
        if V.get("core_msg_covered_all") and task.get("shared_initial", {}).get("core_messages"):
            for msg in task["shared_initial"]["core_messages"]:
                l1_w += 1
                # 关键短语 (前 10 字) 命中即可
                if any(part in output for part in re.split(r"[，。：,.:\s]+", msg) if len(part) >= 4):
                    l1 += 1
        # QA count 阈值
        for key, minv in [("tech_qa_count_min", V.get("tech_qa_count_min", 0)),
                          ("biz_qa_count_min", V.get("biz_qa_count_min", 0)),
                          ("suggestion_count", V.get("suggestion_count", 0)),
                          ("min_conflicts_identified", V.get("min_conflicts_identified", 0)),
                          ("min_amendments", V.get("min_amendments", 0)),
                          ("min_rescheduling_actions", V.get("min_rescheduling_actions", 0)),
                          ("min_ranked_items", V.get("min_ranked_items", 0)),
                          ("required_facts_count_min", V.get("required_facts_count_min", 0)),
                          ("wechat_subheadings_min", V.get("wechat_subheadings_min", 0)),
                          ("min_usps", V.get("min_usps", 0)),
                          ("competitor_count_covered", V.get("competitor_count_covered", 0)),
                          ("reply_element_count_min", V.get("reply_element_count_min", 0))]:
            if minv and minv > 0:
                l1_w += 1
                # 简单策略：数字正则抽 + 阈值 + 布尔特征存在性
                count_matches = len(re.findall(r"^\s*([0-9]+)[.、\s]", output, re.M)) + \
                                len(re.findall(r"Q\s*\d+", output)) + len(re.findall(r"冲突\s*\d", output))
                if key.startswith("suggestion"):
                    hits = len(re.findall(r"(?:建议|缓解|措施|方案|优先级)[^。\n]*?(?:[:：]|\d)", output, re.IGNORECASE))
                elif key.startswith("reply_element"):
                    hits = sum(1 for x in ["致歉", "道歉", "根因", "原因", "修复", "时限", "时间", "责任人", "负责人"] if x in output)
                elif key.startswith("wechat"):
                    hits = len(re.findall(r"^#+\s+", output, re.M)) + len(re.findall(r"^##?\s+", output, re.M))
                elif key.startswith("required_facts"):
                    ref = task["shared_initial"].get("fact_check_reference", {})
                    hits = sum(1 for k, v in ref.items() if isinstance(v, (int, str)) and str(v) in output)
                elif key.startswith("competitor"):
                    comps = [c.get("name","") for c in task["shared_initial"].get("competitors", [])]
                    hits = sum(1 for c in comps if c and c in output)
                elif key.startswith("tech_qa") or key.startswith("biz_qa"):
                    hits = count_matches
                else:
                    hits = count_matches
                if hits >= minv:
                    l1 += 1
                detail[f"L1_{key}"] = min(hits / max(minv,1), 1.0)
        l1_score = (l1 / l1_w) if l1_w else 1.0
        detail["L1_total"] = round(l1_score, 3)

        # L2 数值断言（与 expected 值的数值比对）
        l2, l2_w = 0.0, 0

        def _numeric_assert(name, actual_value, expected_value, ratio_allow=0.8):
            nonlocal l2, l2_w
            if expected_value is None: return
            l2_w += 1
            try:
                av = float(actual_value); ev = float(expected_value)
            except (TypeError, ValueError):
                av_ = str(actual_value); ev_ = str(expected_value)
                ratio = len(set(ev_.split()) & set(av_.split())) / max(len(set(ev_.split())), 1)
                if ratio >= ratio_allow: l2 += 1
                detail[f"L2_{name}"] = round(ratio, 3); return
            if ev == 0 and av == 0:
                l2 += 1; detail[f"L2_{name}"] = 1.0; return
            if av * ev >= 0 and min(abs(av),abs(ev)) / max(abs(av),abs(ev),1e-9) >= ratio_allow:
                l2 += 1; detail[f"L2_{name}"] = round(min(abs(av),abs(ev)) / max(abs(av),abs(ev),1e-9), 3)
                return
            detail[f"L2_{name}"] = 0.0

        # DATA: total qty/revenue exact match
        init = task.get("shared_initial", {})
        if "expected_total_qty" in V:
            # 从 output 中抽取数字做最佳匹配（近似启发）
            nums = [float(x) for x in re.findall(r"[-+]?\d[\d,]*\.?\d*", output.replace(",",""))]
            tgt = float(V["expected_total_qty"])
            best = min(nums, key=lambda n: abs(n-tgt)) if nums else 0
            _numeric_assert("total_qty", best, tgt, 0.9)
        if "expected_total_revenue" in V:
            nums = [float(x) for x in re.findall(r"[-+]?\d[\d,]*\.?\d*", output.replace(",",""))]
            tgt = float(V["expected_total_revenue"])
            best = min(nums, key=lambda n: abs(n-tgt)) if nums else 0
            _numeric_assert("total_revenue", best, tgt, 0.9)
        # risk: min_completed_tasks
        if V.get("min_completed_tasks"):
            total_done_mentions = len(re.findall(r"done|已完成|完成", output, re.IGNORECASE))
            _numeric_assert("completed_tasks", total_done_mentions, V["min_completed_tasks"], 0.7)
        # seed-03 风格差异项命中（仅适用于 data-h）
        if V.get("expected_a_only") or V.get("expected_b_only") or V.get("expected_qty_mismatches"):
            for label, key in [("a_only", "expected_a_only"), ("b_only", "expected_b_only")]:
                if V.get(key):
                    l2_w += 1
                    hits = sum(1 for sku in V[key] if sku and sku in output)
                    ratio = hits / max(len(V[key]),1)
                    l2 += min(ratio, 1.0)
                    detail[f"L2_{label}"] = round(min(ratio,1.0),3)
            if V.get("expected_qty_mismatches"):
                l2_w += 1
                hits = sum(1 for m in V["expected_qty_mismatches"] if m["sku"] in output)
                ratio = hits / max(len(V["expected_qty_mismatches"]),1)
                l2 += min(ratio,1.0)
                detail["L2_qty_mismatches"] = round(min(ratio,1.0),3)
        # cross-dept: hr/it/admin items
        if V.get("min_total_items"):
            # 近似：计算 output 中带顿号/数字序号的行数
            line_items = len(re.findall(r"^\s*[\-*•\d]+[.、\)）]\s+", output, re.M))
            _numeric_assert("total_items", line_items, V["min_total_items"], 0.7)
        l2_score = (l2 / l2_w) if l2_w else 1.0
        detail["L2_total"] = round(l2_score, 3)

        # L3 LLM-judge（语义质量，权重≤20%）— 如果无 LLM judge 可用则取常数 0.6
        l3_score = 0.6
        if self.llm_judge is not None:
            try:
                l3_score, l3_reason = self.llm_judge.judge(output, task, mode)
                detail["L3_reason_truncated"] = l3_reason[:300]
            except Exception as e:
                detail["L3_error"] = str(e)
                l3_score = 0.6
        detail["L3_total"] = round(l3_score, 3)

        # 加权总分（L1:L2:L3 = 50:30:20 → L1+L2=80%）
        Q = 0.50 * l1_score + 0.30 * l2_score + 0.20 * l3_score
        detail["weighted_Q"] = round(Q, 3)

        # TMS：全部 required_sections（含模糊匹配）通过 + L2 平均 >= 0.5（降低门槛，避免零分误判）
        def _sec_match(s: str) -> bool:
            if not s or s in output: return True
            words = [c for c in re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", s)]
            if not words: return True
            return sum(1 for c in words if c in output) / len(words) >= 0.5
        sections_pass = all(_sec_match(s) for s in V.get("required_sections", [])) if V.get("required_sections") else True
        tms = sections_pass and (l2_score >= 0.5 if l2_w else True)
        return Q, tms, detail


# ── 指标计算 ────────────────────────────────────────────────────────

def compute_pair_metrics(single: RunResult, team: RunResult,
                         Q_single: float, Q_team: float,
                         ) -> Tuple[float, float, float]:
    """返回 (CTR, TR, 协调开销token增量)。"""
    ctr = (Q_team / max(Q_single, 1e-9)) if Q_single > 0 else None
    tr = (team.total_tokens / max(single.total_tokens, 1)) if single.total_tokens > 0 else None
    overhead = team.total_tokens - single.total_tokens
    return ctr, tr, overhead


# ── 结果写入 ────────────────────────────────────────────────────────

class ResultWriter:
    def __init__(self, out_dir: Path):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.summary_path = self.out_dir / "summary.jsonl"
        self.csv_path = self.out_dir / "summary.csv"
        self.pairs_path = self.out_dir / "pairs.csv"
        # 清空并写 CSV 头
        self.csv_path.write_text(
            "task_id,office_type,task_type,mode,model,seed,Q,TMS,prompt_tokens,completion_tokens,total_tokens,cached_tokens,elapsed,llm_calls,error\n",
            encoding="utf-8")
        self.pairs_path.write_text(
            "task_id,office_type,task_type,model,seed,Q_single,Q_team,CTR,TR,team_token_overhead\n",
            encoding="utf-8")

    def append_run(self, r: RunResult, detail: Dict[str, Any], Q: float, TMS: bool) -> None:
        line = {
            "task_id": r.task_id, "office_type": r.office_type, "task_type": r.task_type,
            "mode": r.mode, "model": r.model, "seed": r.seed,
            "Q": round(Q, 4), "TMS": TMS,
            "prompt_tokens": r.prompt_tokens, "completion_tokens": r.completion_tokens,
            "total_tokens": r.total_tokens, "cached_tokens": r.cached_tokens,
            "elapsed": round(r.elapsed, 2),
            "llm_calls": r.llm_calls, "error": r.error,
            "detail": detail, "output": r.output,
            "ts": datetime.now().isoformat(timespec="seconds"),
        }
        with open(self.summary_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        with open(self.csv_path, "a", encoding="utf-8") as f:
            f.write(f"{r.task_id},{r.office_type},{r.task_type},{r.mode},{r.model},{r.seed},"
                    f"{round(Q,4)},{TMS},{r.prompt_tokens},{r.completion_tokens},"
                    f"{r.total_tokens},{r.cached_tokens},{round(r.elapsed,2)},{r.llm_calls},"
                    f"\"{r.error.replace(chr(34),chr(39))}\"\n")
        # 每个 run 独立 JSON 落盘
        task_dir = self.out_dir / r.task_id
        task_dir.mkdir(exist_ok=True)
        fn = f"{r.mode}_s{r.seed:02d}.json"
        (task_dir / fn).write_text(json.dumps(line, ensure_ascii=False, indent=2), encoding="utf-8")

    def append_pair(self, r_s: RunResult, r_t: RunResult,
                    Q_s: float, Q_t: float,
                    CTR: float, TR: float, overhead: int) -> None:
        with open(self.pairs_path, "a", encoding="utf-8") as f:
            ctr_s = f"{CTR:.4f}" if CTR is not None else "NA"
            tr_s = f"{TR:.4f}" if TR is not None else "NA"
            f.write(f"{r_s.task_id},{r_s.office_type},{r_s.task_type},{r_s.model},{r_s.seed},"
                    f"{round(Q_s,4)},{round(Q_t,4)},{ctr_s},{tr_s},{overhead}\n")


# ── Experiment 主控制器 ─────────────────────────────────────────────

def load_tasks(args) -> List[Dict]:
    if args.task:
        return [json.loads(Path(args.task).read_text(encoding="utf-8"))]
    d = Path(args.tasks_dir)
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))]


def run_experiment(args) -> None:
    api_key = args.api_key or os.getenv(args.api_key_env)
    if not api_key:
        print(f"ERROR: 请设置 {args.api_key_env} 环境变量或 --api-key")
        sys.exit(1)

    base_url = args.base_url or "https://api.deepseek.com/v1"
    tasks = load_tasks(args)
    use_llm_judge = not args.disable_llm_judge
    print(f"[Experiment] 任务数={len(tasks)}  seeds={args.seeds}  model={args.model}  base_url={base_url}  out={args.out}  LLM-judge={'ON' if use_llm_judge else 'OFF'}")
    llm = LLMClient(api_key=api_key, base_url=base_url, model=args.model)
    single_runner = LightweightSingleRunner(llm)
    team_runner = LightweightTeamRunner(llm)

    # LLM-judge：被测 model 如果是 flash，judge 用 pro（强模型判弱模型符合实践）
    # 交叉 judge：若 judge-base-url / judge-api-key-env 指定了不同端点，用外部模型判（避免同家族偏见）
    llm_judge = None
    if use_llm_judge:
        try:
            from paper.metrics.llm_judge import LLMJudgeScorer
            judge_model = args.judge_model
            judge_key = getattr(args, "judge_api_key", None) or os.getenv(getattr(args, "judge_api_key_env", "DEEPSEEK_API_KEY"))
            judge_url = getattr(args, "judge_base_url", None) or base_url
            llm_judge = LLMJudgeScorer(api_key=judge_key, base_url=judge_url, judge_model=judge_model)
            print(f"  LLM-judge model: {judge_model}  base_url={judge_url}")
        except Exception as e:
            print(f"  ⚠️  LLM-judge 初始化失败（降级为常数L3=0.6）：{e}")
    scorer = ArtifactScorer(llm=llm, llm_judge=llm_judge)
    writer = ResultWriter(Path(args.out))

    pairs_all: List[Dict[str, Any]] = []
    failed = 0
    # 缓存优化：两段式运行——先跑完全部 single（s0/s1 紧挨着），再跑全部 team（同任务同角色 s0/s1 紧挨着）
    # 第一段：全部 single
    single_results: Dict[Tuple[str, int], Tuple[RunResult, float, bool, Dict]] = {}
    print(f"\n{'='*60}\n[Phase 1] 全部 single 模式（{len(tasks)} 任务 × {len(args.seeds)} seeds）\n{'='*60}")
    for t in tasks:
        tid = t["task_id"]
        for s in args.seeds:
            print(f"  [single] {tid} s{s} running...")
            try:
                rs = single_runner.run(t, s)
                Q_s, TMS_s, detail_s = scorer.score(rs.output, t, "single")
                rs.Q = Q_s; rs.TMS = TMS_s
                writer.append_run(rs, detail_s, Q_s, TMS_s)
                cache_pct = f" cache={rs.cached_tokens}/{rs.prompt_tokens}({rs.cached_tokens/rs.prompt_tokens*100:.0f}%)" if rs.prompt_tokens and rs.cached_tokens else ""
                print(f"  [single] {tid} s{s}  Q={Q_s:.3f}  TMS={TMS_s}  tokens={rs.total_tokens}{cache_pct}  time={rs.elapsed:.1f}s")
                single_results[(tid, s)] = (rs, Q_s, TMS_s, detail_s)
            except Exception as e:
                print(f"  [single] {tid} s{s} FAIL: {e}"); traceback.print_exc(); failed += 1

    # 第二段：全部 team
    print(f"\n{'='*60}\n[Phase 2] 全部 team 模式（{len(tasks)} 任务 × {len(args.seeds)} seeds）\n{'='*60}")
    for t in tasks:
        tid = t["task_id"]
        tt = t.get("task_type", "?")
        ot = t.get("office_type", "?")
        for s in args.seeds:
            print(f"  [team] {tid} s{s} running...")
            try:
                rt = team_runner.run(t, s)
                Q_t, TMS_t, detail_t = scorer.score(rt.output, t, "team")
                rt.Q = Q_t; rt.TMS = TMS_t
                writer.append_run(rt, detail_t, Q_t, TMS_t)
                cache_pct = f" cache={rt.cached_tokens}/{rt.prompt_tokens}({rt.cached_tokens/rt.prompt_tokens*100:.0f}%)" if rt.prompt_tokens and rt.cached_tokens else ""
                print(f"  [team] {tid} s{s}  Q={Q_t:.3f}  TMS={TMS_t}  tokens={rt.total_tokens}{cache_pct}  time={rt.elapsed:.1f}s  calls={rt.llm_calls}")
            except Exception as e:
                print(f"  [team] {tid} s{s} FAIL: {e}"); traceback.print_exc(); failed += 1; continue

            # 成对指标
            sr = single_results.get((tid, s))
            if sr is None:
                print(f"  >>> {tid} s{s} single 结果缺失，跳过 pairs"); continue
            rs, Q_s, TMS_s, _ = sr
            CTR, TR, ovh = compute_pair_metrics(rs, rt, Q_s, Q_t)
            writer.append_pair(rs, rt, Q_s, Q_t, CTR, TR, ovh)
            ctr_str = f"{CTR:.3f}" if CTR is not None else "N/A"
            tr_str = f"{TR:.2f}x" if TR is not None else "N/A"
            tag = "团队次优↓" if CTR and CTR < 1 else ("团队涌现↑" if CTR and CTR > 1 else "持平")
            print(f"  >>> {tid} s{s}  CTR={ctr_str}  token比={tr_str}  {tag}")
            pairs_all.append({
                "task_id": tid, "office_type": ot, "task_type": tt,
                "seed": s, "CTR": CTR, "TR": TR, "overhead": ovh,
                "Q_single": round(Q_s, 3), "Q_team": round(Q_t, 3),
                "tag": tag,
            })

    # 汇总
    print(f"\n{'='*70}")
    print("汇总（按耦合度）")
    print(f"{'='*70}")
    by_coupling: Dict[str, List[float]] = {}
    for p in pairs_all:
        if p["CTR"] is None: continue
        by_coupling.setdefault(p["task_type"], []).append(p["CTR"])
    for tt in ["low_coupling", "medium_coupling", "high_coupling"]:
        if tt in by_coupling and by_coupling[tt]:
            vs = by_coupling[tt]
            print(f"  {tt:<15} n={len(vs):<3}  平均CTR={sum(vs)/len(vs):.3f}  "
                  f"min={min(vs):.3f}  max={max(vs):.3f}")

    all_ctr = [p["CTR"] for p in pairs_all if p["CTR"] is not None]
    print(f"\n总体  n={len(all_ctr)}  平均CTR={sum(all_ctr)/len(all_ctr):.3f}" if all_ctr else "")
    low1_any = any(p["task_type"] == "low_coupling" and p["CTR"] and p["CTR"] < 0.95 for p in pairs_all)
    high_any = any(p["task_type"] == "high_coupling" and p["CTR"] and p["CTR"] > 1.05 for p in pairs_all)
    print(f"\n现象检查: low_coupling出现团队次优(CTR<0.95)={low1_any}  high_coupling出现团队涌现(CTR>1.05)={high_any}")
    if low1_any and high_any:
        print(">>> 扩展基线确认: 协作税曲线复现成功（低耦合次优 + 高耦合涌现） → 推进多模型横评")
    else:
        print(">>> 需在更多 seeds / 更多模型上验证（或调整 L1/L2 权重）")
    if failed:
        print(f"⚠️  {failed} runs failed，见日志")
    print(f"\n输出目录: {args.out}")
    print(f"  JSONL: {writer.summary_path}")
    print(f"  CSV  : {writer.csv_path}")
    print(f"  成对 : {writer.pairs_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", type=str, help="单任务 JSON 路径（互斥于 --tasks-dir）")
    ap.add_argument("--tasks-dir", type=str, default=str(ROOT / "paper" / "tasks" / "data" / "v0.1"),
                    help="任务目录，默认 paper/tasks/data/v0.1")
    ap.add_argument("--seeds", type=int, nargs="+", default=[0])
    ap.add_argument("--model", type=str, default="deepseek-v4-flash", help="被测模型")
    ap.add_argument("--api-key", type=str, default=None, help="API key，默认读取 DEEPSEEK_API_KEY env")
    ap.add_argument("--base-url", type=str, default=None,
                    help="API base URL，默认 https://api.deepseek.com/v1；Kimi 用 https://api.moonshot.ai/v1")
    ap.add_argument("--api-key-env", type=str, default="DEEPSEEK_API_KEY",
                    help="读取 API key 的环境变量名，Kimi 用 KIMI_API_KEY")
    ap.add_argument("--out", type=str, default=str(ROOT / "paper" / "experiments" / "baseline_v0.1"),
                    help="输出目录")
    ap.add_argument("--disable-llm-judge", action="store_true",
                    help="关闭 LLM-judge（L3=0.6 常数，调试时省 token）")
    ap.add_argument("--judge-model", type=str, default="deepseek-v4-pro",
                    help="LLM-judge 模型，建议用被测模型的高一级版本（flash→pro）")
    ap.add_argument("--judge-base-url", type=str, default=None,
                    help="LLM-judge 的 API base URL，交叉 judge 时用不同端点")
    ap.add_argument("--judge-api-key-env", type=str, default=None,
                    help="LLM-judge 读取 API key 的环境变量名，交叉 judge 时用不同的 key")
    args = ap.parse_args()
    run_experiment(args)


if __name__ == "__main__":
    main()
