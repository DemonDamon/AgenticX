#!/usr/bin/env python3
"""TeamBench p0-4 决策门：验证「个体最优、团队次优」现象。

简化版：直接调 DS V4 Flash API，不走完整 AgentTeamManager agent loop。
- 团队模式：按分工卡串行调 LLM（模拟分工 + 通信开销）
- 个体模式：单次 LLM 调用完成全任务
- 测量：产出质量（artifact 核验）+ token 消耗（协调开销）+ 耗时

决策门判定：
- seed-01 (低耦合) 转化率 < 1 且 seed-03 (高耦合) 转化率 > 1 → 现象成立
- 否则需调整

用法：
  export DEEPSEEK_API_KEY="sk-xxx"
  .venv/bin/python paper/infra/p0_4_decision_gate.py [--seed 0] [--model deepseek-v4-flash]
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional

# ── 路径 ──
ROOT = Path(__file__).resolve().parent.parent.parent
TASKS_DIR = ROOT / "paper" / "tasks" / "data"

# ── LLM 调用 ──
from openai import OpenAI

def make_client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key, base_url="https://api.deepseek.com/v1")

def call_llm(client: OpenAI, model: str, system: str, user: str, timeout: int = 120) -> Dict[str, Any]:
    """调一次 LLM，返回 {content, prompt_tokens, completion_tokens, total_tokens, elapsed}。"""
    t0 = time.time()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
        max_tokens=4096,
        timeout=timeout,
    )
    elapsed = time.time() - t0
    content = resp.choices[0].message.content or ""
    usage = resp.usage
    return {
        "content": content,
        "prompt_tokens": usage.prompt_tokens if usage else 0,
        "completion_tokens": usage.completion_tokens if usage else 0,
        "total_tokens": (usage.total_tokens if usage else 0),
        "elapsed": elapsed,
    }


# ── 通用工具 ──

def load_task(task_id: str) -> Dict:
    for f in TASKS_DIR.glob("*.json"):
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if data.get("task_id") == task_id:
                return data
    raise FileNotFoundError(f"Task {task_id} not found in {TASKS_DIR}")


# ── 个体模式 ──

def run_single_mode(client: OpenAI, model: str, task: Dict) -> Dict[str, Any]:
    """单 agent 完成整个任务。"""
    system = "你是一个高效的办公助手。严格按照要求完成任务，输出结构化的结果。"
    user = _build_single_prompt(task)
    result = call_llm(client, model, system, user)
    return {
        "mode": "single",
        "output": result["content"],
        "prompt_tokens": result["prompt_tokens"],
        "completion_tokens": result["completion_tokens"],
        "total_tokens": result["total_tokens"],
        "elapsed": result["elapsed"],
        "llm_calls": 1,
    }


def _build_single_prompt(task: Dict) -> str:
    """根据任务类型构建个体模式 prompt。"""
    tid = task["task_id"]
    if "weekly-report" in tid:
        members = task["members"]
        member_text = "\n".join(
            f"  {m['name']}（{m['role']}）：\n" + "\n".join(f"    - {r}" for r in m["records"])
            for m in members
        )
        return f"""请基于以下5名团队成员的本周工作记录，产出一份团队周报。

团队成员记录：
{member_text}

要求：
1. 合并重复项（不同成员可能提到同一项工作）
2. 按主题归类进展
3. 识别跨成员依赖（哪些成员的工作有关联）
4. 周报必须包含三个章节：本周进展、风险阻塞、下周计划
5. 每名成员都必须被提及

请直接输出周报（markdown格式）。"""

    elif "risk-alert" in tid:
        board = task["board"]
        tasks_text = "\n".join(
            f"  T{t['id'][-1]} | {t['name']} | 状态:{t['status']} | 负责人:{t['owner']} | 计划结束:{t['planned_end']} | 进度:{t.get('progress',0)}% | 延期:{t.get('actual_delay_days',0)}天 | 阻塞:{t.get('blocker','无')}"
            for t in board["tasks"]
        )
        milestones_text = "\n".join(
            f"  {m['id']} | {m['name']} | 计划:{m['planned_date']} | 状态:{m['status']}"
            for m in board["milestones"]
        )
        history_text = "\n".join(
            f"  任务{h['task']} | {h['event']} | 原因:{h['reason']} | 日期:{h['date']}"
            for h in board["history"]
        )
        return f"""请基于以下项目看板数据，产出一份风险预警报告。

项目任务：
{tasks_text}

里程碑：
{milestones_text}

变更历史：
{history_text}

要求：
1. 识别延期/阻塞风险任务
2. 分析每个风险的根因
3. 给出3条可执行的缓解建议
4. 报告必须包含三个章节：风险清单、根因分析、缓解建议

请直接输出报告（markdown格式）。"""

    elif "data-check" in tid:
        table_a = task["table_a"]
        table_b = task["table_b"]
        a_text = "\n".join(f"  {r['sku']},{r['qty']},{r['date']}" for r in table_a)
        b_text = "\n".join(f"  {r['sku']},{r['qty']},{r['date']}" for r in table_b)
        return f"""请对以下两个数据源进行交叉核对，找出差异。

表A（销售系统导出，{len(table_a)}条）：
SKU,数量,日期
{a_text}

表B（库存系统导出，{len(table_b)}条）：
SKU,数量,日期
{b_text}

要求找出三类差异：
1. A有B无（表A有但表B没有的SKU）
2. B有A无（表B有但表A没有的SKU）
3. 数值不一致（同一SKU在两表中的数量不同）

请直接输出核对报告（markdown格式），列出每类差异的具体SKU。"""

    return ""


# ── 团队模式 ──

def run_team_mode(client: OpenAI, model: str, task: Dict) -> Dict[str, Any]:
    """按分工卡串行调 LLM，模拟分工 + 通信开销。"""
    tid = task["task_id"]
    total_tokens_in = 0
    total_tokens_out = 0
    total_elapsed = 0.0
    llm_calls = 0
    final_output = ""

    if "weekly-report" in tid:
        # 角色1：收集员
        members = task["members"]
        member_text = "\n".join(
            f"  {m['name']}（{m['role']}）：\n" + "\n".join(f"    - {r}" for r in m["records"])
            for m in members
        )
        r1 = call_llm(client, model,
            "你是一个信息收集员。你的职责是读取成员工作记录，提取进展要点，去重。",
            f"以下是5名团队成员的本周工作记录。请提取所有进展要点，去除重复项（不同成员可能提到同一项工作）。\n\n{member_text}")
        total_tokens_in += r1["prompt_tokens"]; total_tokens_out += r1["completion_tokens"]; total_elapsed += r1["elapsed"]; llm_calls += 1

        # 角色2：分析师
        r2 = call_llm(client, model,
            "你是一个分析师。你的职责是对要点按主题归类，标注跨成员依赖。",
            f"以下是收集员提取的进展要点。请按主题归类，并标注哪些要点涉及跨成员协作。\n\n{r1['content']}")
        total_tokens_in += r2["prompt_tokens"]; total_tokens_out += r2["completion_tokens"]; total_elapsed += r2["elapsed"]; llm_calls += 1

        # 角色3：撰写员
        r3 = call_llm(client, model,
            "你是一个撰写员。你的职责是整合为结构化周报。",
            f"以下是分析师的主题归类结果。请整合为一份团队周报，必须包含三个章节：本周进展、风险阻塞、下周计划。每名成员都必须被提及。\n\n{r2['content']}")
        total_tokens_in += r3["prompt_tokens"]; total_tokens_out += r3["completion_tokens"]; total_elapsed += r3["elapsed"]; llm_calls += 1
        final_output = r3["content"]

    elif "risk-alert" in tid:
        board = task["board"]
        tasks_text = "\n".join(
            f"  T{t['id'][-1]} | {t['name']} | 状态:{t['status']} | 负责人:{t['owner']} | 计划结束:{t['planned_end']} | 进度:{t.get('progress',0)}% | 延期:{t.get('actual_delay_days',0)}天 | 阻塞:{t.get('blocker','无')}"
            for t in board["tasks"]
        )
        # 角色1：进度收集员
        r1 = call_llm(client, model,
            "你是进度收集员。读取项目看板，提取有延期或阻塞风险的任务。",
            f"以下是项目看板任务列表。请提取所有有延期或阻塞风险的任务。\n\n{tasks_text}")
        total_tokens_in += r1["prompt_tokens"]; total_tokens_out += r1["completion_tokens"]; total_elapsed += r1["elapsed"]; llm_calls += 1

        # 角色2：根因分析师
        history_text = "\n".join(
            f"  任务{h['task']} | {h['event']} | 原因:{h['reason']} | 日期:{h['date']}"
            for h in board["history"]
        )
        r2 = call_llm(client, model,
            "你是根因分析师。对每个风险任务分析延期根因。",
            f"以下是收集员提取的风险任务。结合变更历史，分析每个风险的根因。\n\n风险任务：\n{r1['content']}\n\n变更历史：\n{history_text}")
        total_tokens_in += r2["prompt_tokens"]; total_tokens_out += r2["completion_tokens"]; total_elapsed += r2["elapsed"]; llm_calls += 1

        # 角色3：建议员
        r3 = call_llm(client, model,
            "你是建议员。基于根因分析给出3条可执行的缓解建议。",
            f"以下是根因分析结果。请给出3条可执行的缓解建议，并整理为报告，包含三个章节：风险清单、根因分析、缓解建议。\n\n{r2['content']}")
        total_tokens_in += r3["prompt_tokens"]; total_tokens_out += r3["completion_tokens"]; total_elapsed += r3["elapsed"]; llm_calls += 1
        final_output = r3["content"]

    elif "data-check" in tid:
        table_a = task["table_a"]
        table_b = task["table_b"]
        b_skus = {r["sku"] for r in table_b}
        b_snapshot = "\n".join(f"  {r['sku']},{r['qty']}" for r in table_b)
        a_snapshot = "\n".join(f"  {r['sku']},{r['qty']}" for r in table_a)

        # 角色1：A源核对员
        r1 = call_llm(client, model,
            "你是A源核对员。读表A，与B快照比对，找出A有B无和数值不一致。",
            f"表A（销售系统，{len(table_a)}条）：\nSKU,数量\n{a_snapshot}\n\n表B快照（库存系统）：\nSKU,数量\n{b_snapshot}\n\n请找出：1）A有B无的SKU  2）数值不一致的SKU")
        total_tokens_in += r1["prompt_tokens"]; total_tokens_out += r1["completion_tokens"]; total_elapsed += r1["elapsed"]; llm_calls += 1

        # 角色2：B源核对员
        r2 = call_llm(client, model,
            "你是B源核对员。读表B，与A快照比对，找出B有A无和数值不一致。",
            f"表B（库存系统，{len(table_b)}条）：\nSKU,数量\n{b_snapshot}\n\n表A快照（销售系统）：\nSKU,数量\n{a_snapshot}\n\n请找出：1）B有A无的SKU  2）数值不一致的SKU")
        total_tokens_in += r2["prompt_tokens"]; total_tokens_out += r2["completion_tokens"]; total_elapsed += r2["elapsed"]; llm_calls += 1

        # 角色3：合并员
        r3 = call_llm(client, model,
            "你是合并员。合并双向差异，去重，产出核对报告。",
            f"A源核对员的差异：\n{r1['content']}\n\nB源核对员的差异：\n{r2['content']}\n\n请合并双向差异（去重），产出最终核对报告，包含三类：A有B无、B有A无、数值不一致。")
        total_tokens_in += r3["prompt_tokens"]; total_tokens_out += r3["completion_tokens"]; total_elapsed += r3["elapsed"]; llm_calls += 1
        final_output = r3["content"]

    return {
        "mode": "team",
        "output": final_output,
        "prompt_tokens": total_tokens_in,
        "completion_tokens": total_tokens_out,
        "total_tokens": total_tokens_in + total_tokens_out,
        "elapsed": total_elapsed,
        "llm_calls": llm_calls,
    }


# ── Artifact 核验器 ──

def verify_seed01(output: str, task: Dict) -> float:
    """周报质量评分：0-1。"""
    score = 0.0
    checks = 0
    v = task["verification"]

    # 1. 必要章节
    for sec in v["required_sections"]:
        checks += 1
        if sec in output:
            score += 1

    # 2. 成员提及
    checks += 1
    members = [m["name"] for m in task["members"]]
    mentioned = sum(1 for name in members if name in output)
    if mentioned >= v["min_members_mentioned"]:
        score += 1
    else:
        score += mentioned / v["min_members_mentioned"]

    # 3. 跨成员依赖
    checks += 1
    deps = task["expected_cross_deps"]
    dep_keywords = set()
    for d in deps:
        for kw in ["认证", "OAuth", "内存泄漏", "支付", "联调", "网关", "回调"]:
            if kw in d["topic"]:
                dep_keywords.add(kw)
    dep_hits = sum(1 for kw in dep_keywords if kw in output)
    dep_ratio = dep_hits / len(dep_keywords) if dep_keywords else 0
    score += min(dep_ratio / v["min_deps_identified_ratio"], 1.0)

    return score / checks


def verify_seed02(output: str, task: Dict) -> float:
    """风险报告质量评分：0-1。"""
    score = 0.0
    checks = 0
    v = task["verification"]

    # 1. 必要章节
    for sec in v["required_sections"]:
        checks += 1
        if sec in output:
            score += 1

    # 2. 风险任务识别
    checks += 1
    actual_risks = v["actual_risk_tasks"]
    risk_hits = sum(1 for t in actual_risks if t in output)
    score += min(risk_hits / len(actual_risks), 1.0)

    # 3. 根因命中
    checks += 1
    causes = v["actual_root_causes"]
    cause_keywords = ["接口", "签名", "SDK", "文档", "返工", "阻塞", "传导"]
    cause_hits = sum(1 for kw in cause_keywords if kw in output)
    score += min(cause_hits / len(cause_keywords), 1.0)

    # 4. 缓解建议数
    checks += 1
    suggestion_markers = len(re.findall(r"(?:建议|缓解|措施|方案)\s*[:：]?\s*\d", output, re.IGNORECASE))
    if suggestion_markers >= v["suggestion_count"]:
        score += 1
    else:
        score += suggestion_markers / v["suggestion_count"]

    return score / checks


def verify_seed03(output: str, task: Dict) -> float:
    """数据核对质量评分：0-1。"""
    score = 0.0
    checks = 0
    v = task["verification"]

    # 1. A有B无
    checks += 1
    a_only = v["expected_a_only"]
    a_hits = sum(1 for sku in a_only if sku in output)
    score += a_hits / len(a_only)

    # 2. B有A无
    checks += 1
    b_only = v["expected_b_only"]
    b_hits = sum(1 for sku in b_only if sku in output)
    score += b_hits / len(b_only)

    # 3. 数值不一致
    checks += 1
    qty_mismatches = v["expected_qty_mismatches"]
    qty_hits = 0
    for m in qty_mismatches:
        if m["sku"] in output:
            qty_hits += 1
    score += qty_hits / len(qty_mismatches)

    # 4. 无重复
    checks += 1
    # 简单检查：每个SKU出现次数
    all_diffs = a_only + b_only + [m["sku"] for m in qty_mismatches]
    dup_count = 0
    for sku in all_diffs:
        count = output.count(sku)
        if count > 2:  # 允许出现2次（表格+正文）
            dup_count += 1
    if dup_count == 0:
        score += 1
    else:
        score += max(0, 1 - dup_count / len(all_diffs))

    return score / checks


def verify(task_id: str, output: str, task: Dict) -> float:
    if "weekly-report" in task_id:
        return verify_seed01(output, task)
    elif "risk-alert" in task_id:
        return verify_seed02(output, task)
    elif "data-check" in task_id:
        return verify_seed03(output, task)
    return 0.0


# ── 主流程 ──

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="deepseek-v4-flash")
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    parser.add_argument("--api-key", default=os.getenv("DEEPSEEK_API_KEY"))
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: 请设置 DEEPSEEK_API_KEY 环境变量或用 --api-key 传入")
        sys.exit(1)

    client = make_client(args.api_key)
    task_ids = [
        "seed-01-team-weekly-report",
        "seed-02-project-risk-alert",
        "seed-03-cross-source-data-check",
    ]

    all_results = []

    print("=" * 70)
    print(f"TeamBench p0-4 决策门试跑 | 模型: {args.model} | seeds: {args.seeds}")
    print("=" * 70)

    for seed in args.seeds:
        for tid in task_ids:
            task = load_task(tid)
            print(f"\n{'─' * 60}")
            print(f"Seed {seed} | {tid} ({task['task_type']})")
            print(f"{'─' * 60}")

            # 个体模式
            print(f"  [个体模式] 调用中...")
            t0 = time.time()
            single = run_single_mode(client, args.model, task)
            q_single = verify(tid, single["output"], task)
            print(f"  [个体模式] 质量={q_single:.3f}  tokens={single['total_tokens']}  耗时={single['elapsed']:.1f}s  调用={single['llm_calls']}")

            # 团队模式
            print(f"  [团队模式] 调用中（3个角色串行）...")
            team = run_team_mode(client, args.model, task)
            q_team = verify(tid, team["output"], task)
            print(f"  [团队模式] 质量={q_team:.3f}  tokens={team['total_tokens']}  耗时={team['elapsed']:.1f}s  调用={team['llm_calls']}")

            # 能力转化率
            ctr = q_team / q_single if q_single > 0 else 0
            coord_overhead = team["total_tokens"] - single["total_tokens"]
            token_ratio = team["total_tokens"] / single["total_tokens"] if single["total_tokens"] > 0 else 0

            print(f"\n  >>> 能力转化率 (CTR) = {ctr:.3f}")
            print(f"  >>> 协调开销 (token增量) = {coord_overhead}")
            print(f"  >>> token比 (团队/个体) = {token_ratio:.2f}x")

            if ctr < 1.0:
                print(f"  >>> 现象: 团队次优 (CTR < 1) ← 个体更优")
            elif ctr > 1.0:
                print(f"  >>> 现象: 团队涌现 (CTR > 1) ← 团队更优")
            else:
                print(f"  >>> 现象: 持平 (CTR = 1)")

            all_results.append({
                "seed": seed, "task_id": tid, "task_type": task["task_type"],
                "q_single": round(q_single, 3), "q_team": round(q_team, 3),
                "ctr": round(ctr, 3),
                "single_tokens": single["total_tokens"], "team_tokens": team["total_tokens"],
                "coord_overhead": coord_overhead, "token_ratio": round(token_ratio, 2),
                "single_elapsed": round(single["elapsed"], 1), "team_elapsed": round(team["elapsed"], 1),
                "single_calls": single["llm_calls"], "team_calls": team["llm_calls"],
            })

    # 汇总
    print(f"\n{'=' * 70}")
    print("决策门汇总")
    print(f"{'=' * 70}")
    print(f"{'任务':<35} {'类型':<15} {'Q_single':<10} {'Q_team':<10} {'CTR':<8} {'token比':<8} {'现象'}")
    print("-" * 110)
    for r in all_results:
        phenomenon = "团队次优↓" if r["ctr"] < 1.0 else ("团队涌现↑" if r["ctr"] > 1.0 else "持平")
        print(f"{r['task_id']:<35} {r['task_type']:<15} {r['q_single']:<10} {r['q_team']:<10} {r['ctr']:<8} {r['token_ratio']:<8} {phenomenon}")

    # 决策门判定
    seed1_ctrs = [r["ctr"] for r in all_results if "weekly-report" in r["task_id"]]
    seed3_ctrs = [r["ctr"] for r in all_results if "data-check" in r["task_id"]]
    seed1_avg = sum(seed1_ctrs) / len(seed1_ctrs) if seed1_ctrs else 0
    seed3_avg = sum(seed3_ctrs) / len(seed3_ctrs) if seed3_ctrs else 0

    print(f"\n--- 决策门判定 ---")
    print(f"seed-01 (低耦合) 平均 CTR: {seed1_avg:.3f}")
    print(f"seed-03 (高耦合) 平均 CTR: {seed3_avg:.3f}")

    if seed1_avg < 1.0 and seed3_avg > 1.0:
        print(">>> 结论: 现象复现成功！低耦合团队次优 + 高耦合团队涌现 → 核心曲线成立")
        print(">>> 建议: 推进 Phase 1，配置完整 AgentTeamManager 做正式实验")
    elif seed1_avg < 1.0:
        print(">>> 结论: 部分复现（低耦合次优成立，高耦合未涌现）")
        print(">>> 建议: 增大 seed-03 数据量或调整分工，再跑一轮")
    else:
        print(">>> 结论: 未复现（低耦合也未出现次优）")
        print(">>> 建议: 调整任务设计或增大 seed 数")

    # 保存结果
    results_path = ROOT / "paper" / "experiments" / "p0_4_results.json"
    results_path.parent.mkdir(parents=True, exist_ok=True)
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存: {results_path}")


if __name__ == "__main__":
    asyncio.run(main())
