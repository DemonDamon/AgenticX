#!/usr/bin/env python3
"""算力对齐（compute-matched）的单体基线。

动机：团队模式消耗 k 次 LLM 调用与 2-4x token。若只与 1 次调用的单体比较，
"团队不划算"的结论无法与"没给单体同等预算"区分开。本模块提供两条对齐基线：

  single_refine_k : k 轮串行自我修订，LLM 调用次数与团队角色数对齐
  single_bon_k    : best-of-k 采样 + 选择器，token 量级与团队对齐
"""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Tuple

_REFINE_SYSTEM = (
    "你是一个高效的办公助理。下面是你上一轮产出的交付物。"
    "请针对任务要求进行修订：补齐遗漏的章节与条目、修正错误数值、删除冗余。"
    "只输出修订后的完整交付物，不要输出修改说明。"
)

_SELECT_SYSTEM = (
    "你是质量评审员。下面给出同一任务的多份候选交付物。"
    "请选出质量最高的一份（章节最齐全、数据最准确、结构最清晰）。"
    "只输出被选中候选的编号，格式：`Best: N`。"
)


def run_single_refine_k(task: Dict, seed: int, k: int, llm_call: Callable,
                        prompt_single: Callable, char_budget: int = 4000
                        ) -> Tuple[str, Dict[str, int]]:
    """k 轮串行自我修订。总 LLM 调用数 = k。"""
    system, user = prompt_single(task, char_budget)
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "llm_calls": 0}
    out = ""
    for i in range(max(k, 1)):
        if i == 0:
            r = llm_call(system, user, seed=seed,
                         label=f"{task['task_id']} refine s{seed} r0")
        else:
            ru = (f"{user}\n\n--- 你上一轮的产出 ---\n{out}\n\n"
                  f"请输出修订后的完整交付物（不超过 {char_budget} 字）。")
            r = llm_call(_REFINE_SYSTEM, ru, seed=(seed * 31 + i) & 0x7fffffff,
                         label=f"{task['task_id']} refine s{seed} r{i}")
        usage["prompt_tokens"] += r.get("prompt_tokens", 0)
        usage["completion_tokens"] += r.get("completion_tokens", 0)
        usage["llm_calls"] += 1
        if r.get("content"):
            out = r["content"]
    return out, usage


def run_single_bon_k(task: Dict, seed: int, k: int, llm_call: Callable,
                     prompt_single: Callable, char_budget: int = 4000
                     ) -> Tuple[str, Dict[str, int]]:
    """best-of-k：独立采样 k 份，再由同一模型选出最优。总调用数 = k + 1。"""
    import re as _re

    system, user = prompt_single(task, char_budget)
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "llm_calls": 0}
    cands: List[str] = []
    for i in range(max(k, 1)):
        r = llm_call(system, user, seed=(seed * 53 + i) & 0x7fffffff,
                     label=f"{task['task_id']} bon s{seed} c{i}")
        usage["prompt_tokens"] += r.get("prompt_tokens", 0)
        usage["completion_tokens"] += r.get("completion_tokens", 0)
        usage["llm_calls"] += 1
        cands.append(r.get("content", ""))
    cands = [c for c in cands if c] or [""]
    if len(cands) == 1:
        return cands[0], usage

    listing = "\n\n".join(f"--- 候选 {i+1} ---\n{c[:6000]}" for i, c in enumerate(cands))
    rs = llm_call(_SELECT_SYSTEM,
                  f"任务：{task.get('description','')}\n\n{listing}\n\n请输出 `Best: N`。",
                  seed=seed, label=f"{task['task_id']} bon-select s{seed}")
    usage["prompt_tokens"] += rs.get("prompt_tokens", 0)
    usage["completion_tokens"] += rs.get("completion_tokens", 0)
    usage["llm_calls"] += 1

    m = _re.search(r"Best\s*[:：]\s*(\d+)", rs.get("content", "") or "")
    idx = (int(m.group(1)) - 1) if m else 0
    idx = max(0, min(idx, len(cands) - 1))
    return cands[idx], usage
