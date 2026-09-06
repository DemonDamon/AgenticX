#!/usr/bin/env python3
"""v0.1 任务 → v2 断言最小迁移。

策略（100% 复用现有 ground truth，不再重算）：
  1. 旧集合类字段（expected_* 列表） → expected_sets[key]
  2. 旧标量数值字段（expected_* 标量 + min_*_qty/min_budget_total 等确定数值）
     → expected_values[key] 或 expected_counts[key]
  3. 旧"最小条目数/比例"类约束 → expected_counts[key]（或无法结构化则跳过）
  4. 汇总到 answer_block_schema = 所有断言 key

只改动 verification 字典，追加 v2 三个键，其他字段原样保留（后向兼容）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

V01_DIR = Path("paper/tasks/data/v0.1")
GEN_DIR = Path("paper/tasks/data/generated")


# ── 15 任务的字段映射（每个任务的旧 ground truth → v2 三元组） ──
# 三元组格式：(集合映射, 数值映射, 计数映射)
#   集合映射  Dict[旧字段, v2新字段]  —— 旧字段必须是 list
#   数值映射  Dict[旧字段, (v2新字段, 相对误差tol)]  —— 旧字段必须是确定数值真值（非最小阈值）
#   计数映射  Dict[旧字段, 无意义(直接用旧值)]  —— 必须是"最小条目数"语义；
#             要求答案块中同名字段是 list，len >= 旧值。
# 过滤原则：
#   - max_* (上限型) 跳过 — scoring_v2 counts 逻辑是 len>=阈值 无法表达上限
#   - *_ratio (比例) 跳过 —— 无法从结构化块中稳定算比例
#   - boolean 语义的 min=1 跳过 —— 无法被结构化地精确检验
#   - min_word_count 跳过 —— 这已经是 Q 的总量属性，应该走 LLM-judge 不是 L2

_MAPPINGS: Dict[str, Tuple[Dict[str, str], Dict[str, Tuple[str, float]], List[str]]] = {

    # ── DOC（文档） ──────────────────────────────────────────────────
    "t-DOC-L-01": ({}, {}, []),  # min_members_mentioned_ratio / min_deps_ratio / max_dup: 全部跳过

    "t-DOC-M-02": (
        {},
        {"expected_sections_count": ("sections_count", 0.0)},
        [],
    ),

    "t-DOC-H-03": (
        {"expected_conflicts": "conflicts"},
        {},
        ["min_conflicts_identified", "min_amendments"],
    ),

    # ── DATA（数据） ────────────────────────────────────────────────
    "t-DATA-L-01": (
        {},
        {"expected_total_qty": ("total_qty", 0.02),
         "expected_total_revenue": ("total_revenue", 0.02)},
        [],
    ),

    "t-DATA-M-02": (
        {"expected_deviation_depts": "deviation_depts"},
        {},
        ["min_deviation_items", "suggestion_count"],
    ),

    "t-DATA-H-03": (
        {"expected_a_only": "a_only",
         "expected_b_only": "b_only",
         "_expected_qty_mismatch_skus": "qty_mismatch_skus"},
        {},
        [],  # max_duplicates=0 上限型：跳过
    ),

    # ── PROJ（项目） ────────────────────────────────────────────────
    "t-PROJ-L-01": (
        {},
        {},
        ["min_completed_tasks", "min_sprints_mentioned"],
    ),

    "t-PROJ-M-02": (
        {"actual_risk_tasks": "risk_tasks",
         "actual_root_causes": "root_causes"},
        {},
        ["suggestion_count"],  # *_ratio 类全部跳过
    ),

    "t-PROJ-H-03": (
        {},
        {},
        ["min_conflicts_identified", "min_rescheduling_actions"],
    ),

    # ── CROSS（跨岗协作） ───────────────────────────────────────────
    "t-CROSS-L-01": (
        {},
        {},
        ["min_total_items",
         "min_completed_report_correct",
         "min_pending_report_correct"],
    ),

    "t-CROSS-M-02": (
        {"reply_required_elements": "reply_elements"},
        {},
        ["reply_element_count_min"],
    ),

    "t-CROSS-H-03": (
        {},
        {"min_budget_total": ("budget_total", 0.0)},
        ["min_ranked_items", "conflict_min_identified"],
    ),

    # ── CONTENT（内容创作） ─────────────────────────────────────────
    "t-CONTENT-L-01": (
        {},  # required_facts 是元素名(非实际真值列表)，不是集合，跳过
        {},
        ["required_facts_count_min"],  # min_word_count 跳过
    ),

    "t-CONTENT-M-02": (
        {},
        {},
        ["min_usps", "wechat_subheadings_min"],  # douyin_hook/cta 布尔语义：跳过
    ),

    "t-CONTENT-H-03": (
        {},
        {},
        ["tech_qa_count_min",
         "biz_qa_count_min",
         "competitor_count_covered"],  # core_msg_covered_all 布尔：跳过
    ),
}


def _migrate_verification(tid: str, V: Dict[str, Any]) -> Dict[str, Any]:
    """返回迁移后的 verification 字典，原字段全部保留。"""
    sets_map, vals_map, cnts_keys = _MAPPINGS.get(tid, ({}, {}, []))

    # 1) expected_sets
    exp_sets: Dict[str, List[Any]] = {}
    for old, new in sets_map.items():
        if old.startswith("_"):
            # 派生：例如 _expected_qty_mismatch_skus → 从 expected_qty_mismatches 抽 sku
            src = V.get("expected_qty_mismatches") or []
            exp_sets[new] = [x.get("sku") for x in src if isinstance(x, dict) and x.get("sku")]
        else:
            v = V.get(old)
            if isinstance(v, list) and v:
                exp_sets[new] = list(v)

    # 2) expected_values + value_tolerance
    exp_vals: Dict[str, Any] = {}
    tol = 0.0
    for old, (new, t) in vals_map.items():
        if old in V and isinstance(V[old], (int, float)) and not isinstance(V[old], bool):
            exp_vals[new] = V[old]
            tol = max(tol, t)

    # 3) expected_counts：cnts_keys 为旧 verification 字段名列表，值读 V[old]
    exp_cnts: Dict[str, int] = {}
    for old in cnts_keys:
        if old in V and isinstance(V[old], (int, float)) and not isinstance(V[old], bool):
            exp_cnts[old] = int(V[old])

    # 4) answer_block_schema：所有断言字段的类型声明
    schema: Dict[str, Any] = {}
    for k in exp_sets:
        schema[k] = "list"
    for k in exp_vals:
        schema[k] = "number"
    for k in exp_cnts:
        # count 约束：要求答案块中该字段是 list，len >= expected_counts[k]
        schema[k] = "list (min_length)"

    out = dict(V)  # 全部旧字段保留
    out["answer_block_schema"] = schema
    out["expected_sets"] = exp_sets
    out["expected_values"] = exp_vals
    out["expected_counts"] = exp_cnts
    if tol:
        out["value_tolerance"] = tol
    return out


# ── 派生真值工具：从任务顶层数据推 v2 断言（旧字段无直接 key 时用） ──

def _derive_doc_l_01(t: Dict[str, Any]) -> Tuple[Dict[str, List], Dict[str, Any], Dict[str, int]]:
    members = t.get("members") or []
    member_names = [m.get("name") for m in members if m.get("name")]
    deps = t.get("expected_cross_deps") or []
    return {"members_mentioned": member_names, "cross_deps": list(deps)}, {}, {}


def _derive_doc_m_02(t: Dict[str, Any]) -> Tuple[Dict[str, List], Dict[str, Any], Dict[str, int]]:
    # required_sections 就是规范章节，是实际真值集合
    return {"sections_covered": list(t.get("verification", {}).get("required_sections") or [])}, {}, {}


_DERIVERS = {
    "t-DOC-L-01": _derive_doc_l_01,
    "t-DOC-M-02": _derive_doc_m_02,
}


def migrate_dir(d: Path) -> int:
    n = 0
    for f in sorted(d.glob("t-*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        V = dict(t.get("verification") or {})
        # 先清掉旧的 v2 字段，保证脚本幂等
        for k in ("answer_block_schema", "expected_sets", "expected_values",
                  "expected_counts", "value_tolerance"):
            V.pop(k, None)
        # 用任务 task_id 字段匹配（generated/ 里文件名带 __v00 后缀，但 task_id 字段是根）
        tid = t.get("task_id") or f.stem.split("__")[0]
        if tid in _MAPPINGS:
            newV = _migrate_verification(tid, V)
        else:
            newV = dict(V)
            newV.update(answer_block_schema={}, expected_sets={},
                        expected_values={}, expected_counts={})
        # 合并派生真值（基于整个 task 数据，不仅仅是 verification 字段）
        drv = _DERIVERS.get(tid)
        if drv:
            ds, dv, dc = drv(t)
            newV["expected_sets"].update(ds)
            newV["expected_values"].update(dv)
            newV["expected_counts"].update(dc)
        # 重建 schema（在派生合并之后）
        schema: Dict[str, str] = {}
        for k in newV["expected_sets"]:
            schema[k] = "list"
        for k in newV["expected_values"]:
            schema[k] = "number"
        for k in newV["expected_counts"]:
            schema[k] = "list (min_length)"
        newV["answer_block_schema"] = schema
        t["verification"] = newV
        f.write_text(json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")
        n += 1
    return n


def report() -> None:
    print("== v0.1 + generated 迁移后 L2 断言覆盖 ==")
    ns = nv = nc = 0
    tasks = []
    for f in sorted(V01_DIR.glob("t-*.json")):
        t = json.load(open(f))
        V = t["verification"]
        s, v, c = (len(V.get("expected_sets") or {}),
                   len(V.get("expected_values") or {}),
                   len(V.get("expected_counts") or {}))
        ns += s; nv += v; nc += c
        tasks.append((t["task_id"], s, v, c))
        if s + v + c == 0:
            print(f"  ⚠ {t['task_id']:<18} 无任何 L2 断言（L2 仍会恒满分）")
    for tid, s, v, c in tasks:
        print(f"  {tid:<18} sets={s}  values={v}  counts={c}")
    print(f"\n合计: expected_sets={ns}  expected_values={nv}  expected_counts={nc}")
    no_assert = sum(1 for _, s, v, c in tasks if s + v + c == 0)
    print(f"有至少一个 L2 断言的任务: {15-no_assert}/15")


if __name__ == "__main__":
    a = migrate_dir(V01_DIR)
    b = migrate_dir(GEN_DIR)
    print(f"迁移完成：v0.1 {a} 个文件，generated {b} 个文件\n")
    report()
