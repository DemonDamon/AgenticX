#!/usr/bin/env python3
"""TeamBench 正式评测 runner (Phase 1 轻量版)。

策略：
- Phase 1 先用 LightweightRunner(串行/并行 LLM 调用 + 显式通信传参)，快速跑基线，不依赖 AgentTeamManager 的完整 agent loop
  好处：成本低、失败率低、可控、可复现。Phase 1 验证现象后，Phase 2 再接 AgentTeamManager 做完整版。
- runner 支持团队模式(按 roles 分工卡串行/并行执行)和个体模式(单 agent 全任务)，两者共享统一 artifact 打分器
- 全程用 OpenAI 兼容接口直连，不依赖任何特定 Agent 框架的 meta_agent，只复用 artifact 打分定义

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

from paper.infra.assembly import ASSEMBLY_PROTOCOLS, assemble

# 上游角色输出传入下游上下文时的截断上限（v0.1 固定 4000，是信息损失源之一；
# 提为可配置常量，便于消融"截断长度 → CTR"）。注意：装配阶段（assembly）绝不截断。
UPSTREAM_CTX_LIMIT = int(os.getenv("TB_UPSTREAM_CTX_LIMIT", "16000"))


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


# ── 余额守卫 + 断点续跑（防中途欠费/中断浪费） ──────────────────────

class BalanceExhausted(Exception):
    """余额低于阈值：主流程捕获后优雅停止，已完成 run 已全部落盘。"""


class BalanceGuard:
    """余额守卫：每 N 次检查一次余额，低于阈值抛 BalanceExhausted。

    支持 DeepSeek（/user/balance）与 Moonshot（/v1/users/me/balance）官方端点；
    其他端点静默放行。
    """

    def __init__(self, api_key: str, base_url: str, min_balance: float = 5.0,
                 check_every: int = 5):
        if "moonshot.cn" in base_url:
            self.provider = "moonshot"
        elif "deepseek.com" in base_url:
            self.provider = "deepseek"
        else:
            self.provider = None
        self.enabled = self.provider is not None
        self.api_key = api_key
        self.min_balance = min_balance
        self.check_every = max(1, check_every)
        self._since_check = 0
        self._last_balance = None

    def _query(self) -> Optional[float]:
        try:
            import http.client
            if self.provider == "moonshot":
                conn = http.client.HTTPSConnection("api.moonshot.cn", timeout=15)
                conn.request("GET", "/v1/users/me/balance",
                             headers={"Authorization": f"Bearer {self.api_key}"})
                data = json.loads(conn.getresponse().read().decode())
                conn.close()
                if data.get("code") == 0 and "data" in data:
                    return float(data["data"]["available_balance"])
                return None
            # DeepSeek
            conn = http.client.HTTPSConnection("api.deepseek.com", timeout=15)
            conn.request("GET", "/user/balance",
                         headers={"Authorization": f"Bearer {self.api_key}"})
            r = conn.getresponse()
            data = json.loads(r.read().decode())
            conn.close()
            for info in data.get("balance_infos", []):
                if info.get("currency") == "CNY":
                    return float(info["total_balance"])
            if data.get("balance_infos"):
                return float(data["balance_infos"][0]["total_balance"])
            return None
        except Exception:
            return None  # 余额接口失败不阻塞实验

    def check(self, n_runs_done: int = 0) -> bool:
        """返回 True 可继续；False 表示余额不足，应优雅停止。"""
        if not self.enabled:
            return True
        self._since_check += 1
        if self._since_check < self.check_every and self._last_balance is not None:
            return self._last_balance > self.min_balance
        self._since_check = 0
        bal = self._query()
        if bal is None:
            return True  # 查询失败按可用处理（API 本身会拦截欠费）
        self._last_balance = bal
        print(f"  [BALANCE] ¥{bal:.2f}（阈值 ¥{self.min_balance:.2f}）")
        return bal > self.min_balance


def _runresult_from_line(line: Dict[str, Any]) -> RunResult:
    """从落盘的 run JSON 恢复 RunResult（断点续跑用）。"""
    r = RunResult(
        task_id=line["task_id"], office_type=line.get("office_type", "?"),
        task_type=line.get("task_type", "?"), mode=line["mode"],
        model=line["model"], seed=line["seed"], output=line.get("output", ""),
        prompt_tokens=line.get("prompt_tokens", 0),
        completion_tokens=line.get("completion_tokens", 0),
        total_tokens=line.get("total_tokens", 0),
        cached_tokens=line.get("cached_tokens", 0),
        elapsed=line.get("elapsed", 0.0), llm_calls=line.get("llm_calls", 0),
        error=line.get("error", ""), role_outputs=line.get("role_outputs"),
    )
    r.Q = line.get("Q", 0.0)
    r.TMS = bool(line.get("TMS", False))
    return r


def rebuild_summaries(out_dir: Path) -> Dict[Tuple[str, str, int], Dict[str, Any]]:
    """断点续跑：扫描 out_dir/<task_id>/<mode>_s<seed>.json，
    重建 summary.jsonl / summary.csv / pairs.csv（清空重写），
    返回 {(task_id, mode, seed): line} 索引供主流程跳过已完成的 run。"""
    import re as _re
    pat = _re.compile(r"^(.*)_s(\d+)\.json$")
    existing: Dict[Tuple[str, str, int], Dict[str, Any]] = {}
    run_files = sorted(out_dir.glob("*/*.json")) if out_dir.exists() else []
    for f in run_files:
        m = pat.match(f.name)
        if not m:
            continue
        mode, seed = m.group(1), int(m.group(2))
        try:
            line = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if "task_id" not in line or "Q" not in line:
            continue
        existing[(line["task_id"], mode, seed)] = line

    # 全量重建 summary（幂等：重复 resume 不会产生重复行）
    summary_path = out_dir / "summary.jsonl"
    csv_path = out_dir / "summary.csv"
    with open(summary_path, "w", encoding="utf-8") as fj, \
         open(csv_path, "w", encoding="utf-8") as fc:
        fc.write("task_id,office_type,task_type,mode,model,seed,Q,TMS,prompt_tokens,"
                 "completion_tokens,total_tokens,cached_tokens,elapsed,llm_calls,error\n")
        for line in existing.values():
            fj.write(json.dumps(line, ensure_ascii=False) + "\n")
            fc.write(f"{line['task_id']},{line['office_type']},{line['task_type']},"
                     f"{line['mode']},{line['model']},{line['seed']},{line['Q']},{line['TMS']},"
                     f"{line.get('prompt_tokens',0)},{line.get('completion_tokens',0)},"
                     f"{line.get('total_tokens',0)},{line.get('cached_tokens',0)},"
                     f"{line.get('elapsed',0)},{line.get('llm_calls',0)},"
                     f"\"{str(line.get('error','')).replace(chr(34),chr(39))}\"\n")
    # pairs.csv 由主流程逐对重算后 append（这里只写表头）
    (out_dir / "pairs.csv").write_text(
        "task_id,office_type,task_type,model,seed,assembly,Q_single,Q_single_matched,"
        "Q_team,CTR_naive,CTR_matched,TR,call_ratio,team_token_overhead\n", encoding="utf-8")
    return existing


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


def _answer_block_instruction(task: Dict) -> str:
    """任务声明 answer_block_schema 时，要求产出末尾附结构化答案块（打分器 v2 的 L2 依据）。

    两种模式（single/team）与装配阶段必须使用完全相同的答案块要求，否则引入新的不对等。
    """
    schema = (task.get("verification") or {}).get("answer_block_schema")
    if not schema:
        return ""
    fields = json.dumps(schema, ensure_ascii=False)
    return ("\n\n【结构化答案块】请在交付物末尾附加一个 ```json 代码块，字段如下（缺一不可）：\n"
            f"{fields}\n该块用于自动核验，字段名必须完全一致。")


def _prompt_single(task: Dict, char_budget: int = 4000) -> Tuple[str, str]:
    """个体模式：单个 agent 独立完成整个任务。"""
    system = ("你是一个高效的办公助理。严格、精确、完整地按照要求完成任务，输出结构化的结果。"
              "只输出最终产物，不要多余解释。"
              f"【字数约束】全文最多不超过 {char_budget} 字。"
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

请直接输出最终产物。如果有章节要求（例如"周报含本章"），严格使用 verification.required_sections 中列出的章节标题（完全一致），不要自创新章节名。{_answer_block_instruction(task)}"""
    return system, user


def _team_system(char_budget: int, n_roles: int) -> str:
    """团队模式 system prompt（所有角色共享，最大化缓存命中）。

    单角色预算 = 总预算 / 角色数，保证各角色产出之和与单体总预算同量级（预算对等）。
    """
    per_role = max(800, char_budget // max(n_roles, 1))
    return ("你是一个高效的办公助理。严格、精确、完整地按照要求完成任务，输出结构化的结果。"
            "只专注完成你的分内工作，不要关心其他角色的工作，输出就是你分内的交付物。"
            f"【字数约束】输出最多不超过 {per_role} 字。"
            "列要点、分条陈述，不要展开长篇大论，不要复述题目和共享数据。")


def _prompt_team_role(task: Dict, role_idx: int, prior_outputs: List[Tuple[str, str]],
                      char_budget: int = 4000) -> Tuple[str, str, str]:
    """团队模式：为当前角色生成 prompt，含上游角色输出作为上下文。

    缓存优化策略：
    - system prompt 所有角色完全相同（同 char_budget 派生），跨角色 100% 命中缓存
    - user prompt 把共享数据放前面（同任务跨角色前缀相同），角色特定信息放最后
    """
    role = task["roles"][role_idx]
    payload = _collect_input_payload(task)
    shared_str = json.dumps(payload, ensure_ascii=False, indent=2)

    prior_context = ""
    if prior_outputs:
        prior_context = "\n\n上游角色已完成的工作（你的输入上下文）：\n"
        for (rname, rout) in prior_outputs:
            _lim = UPSTREAM_CTX_LIMIT
            truncated = rout if len(rout) <= _lim else rout[:_lim] + "... [上游输出过长已截断]"
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
请只输出你自己职责的交付物，不要输出不属于你职责的内容。{_answer_block_instruction(task)}"""

    return _team_system(char_budget, len(task["roles"])), user, role["name"]


# ── Runner 层 ───────────────────────────────────────────────────────

@dataclass
class RunResult:
    task_id: str
    office_type: str
    task_type: str
    mode: str                    # "single" / "single_refine_k" / "single_bon_k" / "team_{assembly}"
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
    # 团队模式各角色的中间产出（落盘供装配协议复用/分析）
    role_outputs: Optional[List[Tuple[str, str]]] = None


class LightweightSingleRunner:
    def __init__(self, llm: LLMClient, char_budget: int = 4000):
        self.llm = llm
        self.char_budget = char_budget
    def run(self, task: Dict, seed: int) -> RunResult:
        t0 = time.time()
        system, user = _prompt_single(task, self.char_budget)
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
    """串行执行 N 个角色，再按 assembly 协议装配最终交付物。

    assembly ∈ {last, concat, integrator, blackboard}，见 paper/infra/assembly/protocols.py。
    'last' 复现 v0.1 行为，仅用于对照臂。
    """

    def __init__(self, llm: LLMClient, assembly: str = "integrator",
                 char_budget: int = 4000):
        self.llm = llm
        if assembly not in ASSEMBLY_PROTOCOLS:
            raise ValueError(f"unknown assembly: {assembly}")
        self.assembly = assembly
        self.char_budget = char_budget

    def run(self, task: Dict, seed: int) -> RunResult:
        t0 = time.time()
        roles = task.get("roles", [])
        prior: List[Tuple[str, str]] = []
        total_p = 0; total_c = 0; total_cached = 0; calls = 0
        errors = []
        for i in range(len(roles)):
            system, user, rname = _prompt_team_role(task, i, prior, self.char_budget)
            r = self.llm.call(system, user, seed=(seed * 17 + i) & 0x7fffffff,
                              label=f"{task['task_id']} team-{rname} s{seed}")
            total_p += r["prompt_tokens"]; total_c += r["completion_tokens"]
            total_cached += r.get("cached_tokens", 0)
            calls += r.get("rounds", 1)
            if r.get("error"): errors.append(f"{rname}: {r['error']}")
            prior.append((rname, r["content"]))

        final_output, extra = assemble(
            self.assembly, prior, task,
            llm_call=self.llm.call,
            seed=(seed * 17 + 999) & 0x7fffffff,
            char_budget=self.char_budget,
        )
        # 装配阶段的开销必须计入协调开销，否则 integrator 会白嫖 token
        total_p += extra["prompt_tokens"]
        total_c += extra["completion_tokens"]
        calls += extra["llm_calls"]

        return RunResult(
            task_id=task["task_id"],
            office_type=task.get("office_type", "?"),
            task_type=task.get("task_type", "?"),
            mode=f"team_{self.assembly}",
            model=self.llm.model,
            seed=seed,
            output=final_output,
            prompt_tokens=total_p,
            completion_tokens=total_c,
            total_tokens=total_p + total_c,
            cached_tokens=total_cached,
            elapsed=time.time() - t0,
            llm_calls=calls,
            error="; ".join(errors),
            role_outputs=prior,
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
                         Q_single_matched: Optional[float] = None,
                         ) -> Dict[str, Optional[float]]:
    """返回 CTR 家族与开销指标。

    CTR_naive   : 对 1 次调用的朴素单体（v0.1 定义，保留用于对照）
    CTR_matched : 对算力对齐单体（论文主指标）
    """
    def _ratio(num, den):
        return (num / den) if (den and den > 0) else None
    return {
        "CTR_naive":   _ratio(Q_team, Q_single),
        "CTR_matched": _ratio(Q_team, Q_single_matched) if Q_single_matched is not None else None,
        "TR":          _ratio(team.total_tokens, single.total_tokens),
        "call_ratio":  _ratio(team.llm_calls, single.llm_calls),
        "overhead":    team.total_tokens - single.total_tokens,
    }


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
            "task_id,office_type,task_type,model,seed,assembly,Q_single,Q_single_matched,"
            "Q_team,CTR_naive,CTR_matched,TR,call_ratio,team_token_overhead\n",
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
            "role_outputs": r.role_outputs,
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

    def append_pair(self, r_s: RunResult, r_t: RunResult, assembly: str,
                    Q_s: float, Q_t: float, Q_s_matched: Optional[float],
                    m: Dict[str, Optional[float]]) -> None:
        def _f(v):
            return f"{v:.4f}" if v is not None else "NA"
        with open(self.pairs_path, "a", encoding="utf-8") as f:
            f.write(f"{r_s.task_id},{r_s.office_type},{r_s.task_type},{r_s.model},{r_s.seed},"
                    f"{assembly},{round(Q_s,4)},{round(Q_s_matched,4) if Q_s_matched is not None else 'NA'},"
                    f"{round(Q_t,4)},{_f(m['CTR_naive'])},{_f(m['CTR_matched'])},"
                    f"{_f(m['TR'])},{_f(m['call_ratio'])},{m['overhead']}\n")


# ── Experiment 主控制器 ─────────────────────────────────────────────

def load_tasks(args) -> List[Dict]:
    if args.task:
        return [json.loads(Path(args.task).read_text(encoding="utf-8"))]
    d = Path(args.tasks_dir)
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))]


def _score_with(scorer_v: str, output: str, task: Dict, mode: str,
                v1_scorer: "ArtifactScorer", llm_judge) -> Tuple[float, bool, Dict]:
    """统一打分入口：v2 = paper.metrics.scoring_v2（默认），v1 = 旧 ArtifactScorer（敏感性分析用）。"""
    if scorer_v == "v2":
        from paper.metrics.scoring_v2 import score_artifact
        d = score_artifact(output, task, mode, llm_judge=llm_judge)
        detail = {"L1": d.L1, "L2": d.L2, "L3": d.L3,
                  **d.L1_items, **d.L2_items, "notes": d.notes}
        return d.Q, d.TMS, detail
    return v1_scorer.score(output, task, mode)


def run_experiment(args) -> None:
    api_key = args.api_key or os.getenv(args.api_key_env)
    if not api_key:
        print(f"ERROR: 请设置 {args.api_key_env} 环境变量或 --api-key")
        sys.exit(1)

    base_url = args.base_url or "https://api.deepseek.com/v1"
    tasks = load_tasks(args)
    use_llm_judge = not args.disable_llm_judge
    print(f"[Experiment] 任务数={len(tasks)}  seeds={args.seeds}  model={args.model}  base_url={base_url}  out={args.out}  LLM-judge={'ON' if use_llm_judge else 'OFF'}")
    print(f"  assembly protocol: {args.assembly}  char_budget: {args.char_budget}  scorer: {args.scorer}  single-baseline: {args.single_baseline}")
    llm = LLMClient(api_key=api_key, base_url=base_url, model=args.model)
    single_runner = LightweightSingleRunner(llm, char_budget=args.char_budget)
    team_runner = LightweightTeamRunner(llm, assembly=args.assembly,
                                        char_budget=args.char_budget)

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
            print(f"  ⚠️  LLM-judge 初始化失败（降级为 L1/L2 重归一化）：{e}")
    v1_scorer = ArtifactScorer(llm=llm, llm_judge=llm_judge)
    writer = ResultWriter(Path(args.out))

    # 断点续跑：已有 run JSON 的 (task,mode,seed) 直接跳过，不重复花钱
    resume = not getattr(args, "no_resume", False)
    existing: Dict[Tuple[str, str, int], Dict[str, Any]] = {}
    if resume and Path(args.out).exists():
        existing = rebuild_summaries(Path(args.out))
        if existing:
            print(f"  [RESUME] 发现 {len(existing)} 个已完成 run，将跳过（--no-resume 可强制全量重跑）")

    # 余额守卫：低于阈值优雅停止（DeepSeek 端点有效）
    guard = BalanceGuard(api_key=api_key, base_url=base_url,
                         min_balance=getattr(args, "min_balance", 5.0))

    # 实验元信息落盘（AC-7 混杂检查的依据：温度/端点/seed 必须可追溯）
    (writer.out_dir / "meta.json").write_text(json.dumps({
        "model": args.model, "base_url": base_url, "temperature": llm.temperature,
        "seeds": args.seeds, "assembly": args.assembly, "char_budget": args.char_budget,
        "scorer": args.scorer, "single_baseline": args.single_baseline,
        "llm_judge": bool(llm_judge), "upstream_ctx_limit": UPSTREAM_CTX_LIMIT,
        "tasks": [t["task_id"] for t in tasks],
        "ts": datetime.now().isoformat(timespec="seconds"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # 算力对齐单体基线（k 与团队角色数对齐）
    matched_fn = None
    if args.single_baseline == "single_refine_k":
        from paper.infra.single_baselines import run_single_refine_k
        matched_fn = run_single_refine_k
    elif args.single_baseline == "single_bon_k":
        from paper.infra.single_baselines import run_single_bon_k
        matched_fn = run_single_bon_k

    def _run_matched(task: Dict, seed: int) -> RunResult:
        """跑算力对齐单体基线，返回 RunResult（mode 含基线名）。"""
        t0 = time.time()
        k = len(task.get("roles", [])) or 1
        out, usage = matched_fn(task, seed, k, llm.call, _prompt_single,
                                char_budget=args.char_budget)
        return RunResult(
            task_id=task["task_id"], office_type=task.get("office_type", "?"),
            task_type=task.get("task_type", "?"), mode=args.single_baseline,
            model=llm.model, seed=seed, output=out,
            prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"],
            total_tokens=usage["prompt_tokens"] + usage["completion_tokens"],
            elapsed=time.time() - t0, llm_calls=usage["llm_calls"],
        )

    pairs_all: List[Dict[str, Any]] = []
    failed = 0
    # 缓存优化：两段式运行——先跑完全部 single（s0/s1 紧挨着），再跑全部 team（同任务同角色 s0/s1 紧挨着）
    # 第一段：全部 single（朴素 + 可选的算力对齐基线）
    single_results: Dict[Tuple[str, int], Tuple[RunResult, float, bool, Dict]] = {}
    matched_results: Dict[Tuple[str, int], float] = {}
    print(f"\n{'='*60}\n[Phase 1] 全部 single 模式（{len(tasks)} 任务 × {len(args.seeds)} seeds）\n{'='*60}")
    for t in tasks:
        tid = t["task_id"]
        for s in args.seeds:
            # 断点续跑：已完成的 run 直接恢复，不再调 LLM
            prior_line = existing.get((tid, "single", s))
            if prior_line is not None:
                rs = _runresult_from_line(prior_line)
                single_results[(tid, s)] = (rs, rs.Q, rs.TMS, prior_line.get("detail", {}))
                print(f"  [single] {tid} s{s} 已存在（Q={rs.Q:.3f}），跳过")
                continue
            if not guard.check():
                raise BalanceExhausted(f"single {tid} s{s} 前余额不足")
            print(f"  [single] {tid} s{s} running...")
            try:
                rs = single_runner.run(t, s)
                Q_s, TMS_s, detail_s = _score_with(args.scorer, rs.output, t, "single", v1_scorer, llm_judge)
                rs.Q = Q_s; rs.TMS = TMS_s
                writer.append_run(rs, detail_s, Q_s, TMS_s)
                cache_pct = f" cache={rs.cached_tokens}/{rs.prompt_tokens}({rs.cached_tokens/rs.prompt_tokens*100:.0f}%)" if rs.prompt_tokens and rs.cached_tokens else ""
                print(f"  [single] {tid} s{s}  Q={Q_s:.3f}  TMS={TMS_s}  tokens={rs.total_tokens}{cache_pct}  time={rs.elapsed:.1f}s")
                single_results[(tid, s)] = (rs, Q_s, TMS_s, detail_s)
            except Exception as e:
                print(f"  [single] {tid} s{s} FAIL: {e}"); traceback.print_exc(); failed += 1
        # 算力对齐基线（同任务 seeds 紧挨着跑，共享 prompt 前缀提高缓存命中）
        if matched_fn is not None:
            for s in args.seeds:
                prior_line = existing.get((tid, args.single_baseline, s))
                if prior_line is not None:
                    matched_results[(tid, s)] = prior_line.get("Q")
                    print(f"  [{args.single_baseline}] {tid} s{s} 已存在（Q={prior_line.get('Q', 0):.3f}），跳过")
                    continue
                if not guard.check():
                    raise BalanceExhausted(f"{args.single_baseline} {tid} s{s} 前余额不足")
                print(f"  [{args.single_baseline}] {tid} s{s} running...")
                try:
                    rm = _run_matched(t, s)
                    Q_m, TMS_m, detail_m = _score_with(args.scorer, rm.output, t, "single", v1_scorer, llm_judge)
                    rm.Q = Q_m; rm.TMS = TMS_m
                    writer.append_run(rm, detail_m, Q_m, TMS_m)
                    print(f"  [{args.single_baseline}] {tid} s{s}  Q={Q_m:.3f}  tokens={rm.total_tokens}  calls={rm.llm_calls}")
                    matched_results[(tid, s)] = Q_m
                except Exception as e:
                    print(f"  [{args.single_baseline}] {tid} s{s} FAIL: {e}"); traceback.print_exc(); failed += 1

    # 第二段：全部 team
    print(f"\n{'='*60}\n[Phase 2] 全部 team 模式（assembly={args.assembly}，{len(tasks)} 任务 × {len(args.seeds)} seeds）\n{'='*60}")
    for t in tasks:
        tid = t["task_id"]
        tt = t.get("task_type", "?")
        ot = t.get("office_type", "?")
        team_mode = f"team_{args.assembly}"
        for s in args.seeds:
            prior_line = existing.get((tid, team_mode, s))
            if prior_line is not None:
                rt = _runresult_from_line(prior_line)
                Q_t = rt.Q
                print(f"  [team] {tid} s{s} 已存在（Q={rt.Q:.3f}），跳过")
            else:
                if not guard.check():
                    raise BalanceExhausted(f"team {tid} s{s} 前余额不足")
                print(f"  [team] {tid} s{s} running...")
                try:
                    rt = team_runner.run(t, s)
                    Q_t, TMS_t, detail_t = _score_with(args.scorer, rt.output, t, "team", v1_scorer, llm_judge)
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
            Q_m = matched_results.get((tid, s))
            m = compute_pair_metrics(rs, rt, Q_s, Q_t, Q_single_matched=Q_m)
            writer.append_pair(rs, rt, args.assembly, Q_s, Q_t, Q_m, m)
            ctr = m["CTR_matched"] if m["CTR_matched"] is not None else m["CTR_naive"]
            ctr_str = f"{ctr:.3f}" if ctr is not None else "N/A"
            tr_str = f"{m['TR']:.2f}x" if m["TR"] is not None else "N/A"
            tag = "团队次优↓" if ctr and ctr < 1 else ("团队涌现↑" if ctr and ctr > 1 else "持平")
            print(f"  >>> {tid} s{s}  CTR_naive={m['CTR_naive']:.3f}" if m["CTR_naive"] is not None else f"  >>> {tid} s{s}  CTR_naive=N/A", end="")
            print(f"  CTR_matched={('%.3f' % m['CTR_matched']) if m['CTR_matched'] is not None else 'N/A'}  token比={tr_str}  {tag}")
            pairs_all.append({
                "task_id": tid, "office_type": ot, "task_type": tt,
                "seed": s, "CTR": ctr, "CTR_naive": m["CTR_naive"],
                "CTR_matched": m["CTR_matched"], "TR": m["TR"],
                "call_ratio": m["call_ratio"], "overhead": m["overhead"],
                "Q_single": round(Q_s, 3),
                "Q_single_matched": round(Q_m, 3) if Q_m is not None else None,
                "Q_team": round(Q_t, 3),
                "tag": tag,
            })

    # 汇总
    print(f"\n{'='*70}")
    print(f"汇总（按耦合度；scorer={args.scorer}  assembly={args.assembly}）")
    print(f"{'='*70}")
    for ctr_key in ("CTR_matched", "CTR_naive"):
        vals = [p[ctr_key] for p in pairs_all if p[ctr_key] is not None]
        if not vals:
            continue
        print(f"  [{ctr_key}]  总体  n={len(vals)}  平均CTR={sum(vals)/len(vals):.3f}")
        by_coupling: Dict[str, List[float]] = {}
        for p in pairs_all:
            if p[ctr_key] is None: continue
            by_coupling.setdefault(p["task_type"], []).append(p[ctr_key])
        for tt in ["low_coupling", "medium_coupling", "high_coupling"]:
            if tt in by_coupling and by_coupling[tt]:
                vs = by_coupling[tt]
                print(f"    {tt:<15} n={len(vs):<3}  平均CTR={sum(vs)/len(vs):.3f}  "
                      f"min={min(vs):.3f}  max={max(vs):.3f}")

    if failed:
        print(f"⚠️  {failed} runs failed，见日志")
    print(f"\n输出目录: {args.out}")
    print(f"  JSONL: {writer.summary_path}")
    print(f"  CSV  : {writer.csv_path}")
    print(f"  成对 : {writer.pairs_path}")
    print(f"  元信息: {writer.out_dir / 'meta.json'}")


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
                    help="关闭 LLM-judge（L3 关闭时按 L1/L2 重归一化）")
    ap.add_argument("--assembly", type=str, default="integrator",
                    choices=list(ASSEMBLY_PROTOCOLS),
                    help="团队装配协议：last(v0.1 行为,对照) / concat / integrator / blackboard")
    ap.add_argument("--char-budget", type=int, default=4000,
                    help="单体总字数预算；团队各角色 = 总预算/角色数")
    ap.add_argument("--scorer", type=str, default="v2", choices=["v1", "v2"],
                    help="打分器版本：v2=scoring_v2（默认），v1=旧 ArtifactScorer（敏感性分析用）")
    ap.add_argument("--single-baseline", type=str, default="none",
                    choices=["none", "single_refine_k", "single_bon_k"],
                    help="算力对齐单体基线：refine-k 轮自我修订 / best-of-k 采样（k=团队角色数）")
    ap.add_argument("--judge-model", type=str, default="deepseek-v4-pro",
                    help="LLM-judge 模型，建议用被测模型的高一级版本（flash→pro）")
    ap.add_argument("--judge-base-url", type=str, default=None,
                    help="LLM-judge 的 API base URL，交叉 judge 时用不同端点")
    ap.add_argument("--judge-api-key-env", type=str, default=None,
                    help="LLM-judge 读取 API key 的环境变量名，交叉 judge 时用不同的 key")
    ap.add_argument("--no-resume", action="store_true",
                    help="忽略输出目录中已完成的 run，全部重跑（默认自动断点续跑）")
    ap.add_argument("--min-balance", type=float, default=5.0,
                    help="DeepSeek 账户余额低于该值（元）时优雅停止，默认 5.0；0 关闭检查")
    args = ap.parse_args()
    try:
        run_experiment(args)
    except BalanceExhausted as e:
        print(f"\n{'='*70}\n⏸️  余额不足已优雅停止：{e}")
        print(f"已完成的 run 均已落盘，充值后用同一命令重跑即可从断点继续（自动跳过已完成部分）。")
        print(f"输出目录: {args.out}\n{'='*70}")


if __name__ == "__main__":
    main()
