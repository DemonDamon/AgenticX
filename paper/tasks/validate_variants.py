#!/usr/bin/env python3
"""TeamBench 参数化变体验证器【AC-4】

检查三件事：
1. 结构不变：roles / task_type / required_sections 与基准模板一致（PROJ-H-03 角色数随 project_count 变化，只查 task_type）
2. 变体互不相同：内容有效载荷（shared_initial 或 seed 数据字段 + 关键 ground truth）hash 两两不同
3. ground truth 联动：按任务类型从 shared_initial 数据重算期望值，与 verification 字段逐一比对

用法：
  .venv/bin/python paper/tasks/validate_variants.py paper/tasks/data/generated
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

FAILURES = []


def fail(tid: str, msg: str) -> None:
    FAILURES.append(f"{tid}: {msg}")
    print(f"  [FAIL] {msg}")


def content_payload(d: dict) -> str:
    """变体的内容有效载荷：数据 + ground truth（排除 id/seed 等元数据）。"""
    keys = [k for k in d.keys() if k not in ("variant_id", "variant_seed", "task_id",
                                             "office_type", "team_size", "roles", "params",
                                             "description")]
    return json.dumps({k: d[k] for k in sorted(keys)}, ensure_ascii=False, sort_keys=True)


def check_ground_truth(tid: str, d: dict) -> None:
    """按任务类型重算 ground truth 并与 verification 比对。"""
    si = d.get("shared_initial", d)
    v = d.get("verification", {})

    if tid == "t-DATA-L-01":
        exp_q = sum(r["qty"] for r in si["channel_a"]) + sum(r["qty"] for r in si["channel_b"])
        exp_r = sum(r["revenue"] for r in si["channel_a"]) + sum(r["revenue"] for r in si["channel_b"])
        if v.get("expected_total_qty") != exp_q:
            fail(tid, f"expected_total_qty {v.get('expected_total_qty')} != 重算 {exp_q}")
        if v.get("expected_total_revenue") != exp_r:
            fail(tid, f"expected_total_revenue {v.get('expected_total_revenue')} != 重算 {exp_r}")

    elif tid == "t-DATA-M-02":
        exp = {r["department"] for r in si["budget_rows"] if abs(r["deviation_pct"]) >= 10}
        got = set(v.get("expected_deviation_depts", []))
        if exp != got:
            fail(tid, f"expected_deviation_depts {sorted(got)} != 重算 {sorted(exp)}")

    elif tid == "t-DATA-H-03":
        a = {r["sku"]: r["qty"] for r in d["table_a"]}
        b = {r["sku"]: r["qty"] for r in d["table_b"]}
        a_only, b_only, mism = sorted(set(a) - set(b)), sorted(set(b) - set(a)), []
        for sku in sorted(set(a) & set(b)):
            if a[sku] != b[sku]:
                mism.append({"sku": sku, "a_qty": a[sku], "b_qty": b[sku]})
        if v.get("expected_a_only") != a_only:
            fail(tid, f"expected_a_only 不一致: {v.get('expected_a_only')} vs {a_only}")
        if v.get("expected_b_only") != b_only:
            fail(tid, f"expected_b_only 不一致: {v.get('expected_b_only')} vs {b_only}")
        if v.get("expected_qty_mismatches") != mism:
            fail(tid, f"expected_qty_mismatches 不一致: {v.get('expected_qty_mismatches')} vs {mism}")

    elif tid == "t-PROJ-L-01":
        n_done = sum(1 for t in si["tasks"] if t["status"] == "done")
        if v.get("min_completed_tasks") != n_done:
            fail(tid, f"min_completed_tasks {v.get('min_completed_tasks')} != 重算 {n_done}")
        if v.get("min_sprints_mentioned") != len(si["sprints"]):
            fail(tid, "min_sprints_mentioned 与迭代数不一致")

    elif tid == "t-CROSS-L-01":
        total = len(si["hr_checklist"]) + len(si["it_checklist"]) + len(si["admin_checklist"])
        done = len(si["hr_completed"]) + len(si["it_completed"]) + len(si["admin_completed"])
        if v.get("min_total_items") != total:
            fail(tid, f"min_total_items {v.get('min_total_items')} != 重算 {total}")
        if v.get("min_completed_report_correct") != done:
            fail(tid, f"min_completed_report_correct {v.get('min_completed_report_correct')} != 重算 {done}")
        if v.get("min_pending_report_correct") != total - done:
            fail(tid, f"min_pending_report_correct {v.get('min_pending_report_correct')} != 重算 {total - done}")

    elif tid == "t-CONTENT-H-03":
        if v.get("competitor_count_covered") != len(si["competitors"]):
            fail(tid, "competitor_count_covered 与竞品数不一致")
        if v.get("tech_qa_count_min") != max(6, si["tech_questions_count_target"] - 2):
            fail(tid, "tech_qa_count_min 未随 target 联动")
        if v.get("biz_qa_count_min") != max(5, si["biz_questions_count_target"] - 2):
            fail(tid, "biz_qa_count_min 未随 target 联动")

    elif tid == "t-DOC-L-01":
        if v.get("min_members_mentioned") != len(d["members"]):
            fail(tid, "min_members_mentioned 与成员数不一致")

    elif tid == "t-PROJ-M-02":
        risk = {t["id"] for t in d["board"]["tasks"] if "actual_delay_days" in t or "blocker" in t}
        if set(v.get("actual_risk_tasks", [])) != risk:
            fail(tid, f"actual_risk_tasks {v.get('actual_risk_tasks')} != 重算 {sorted(risk)}")

    elif tid == "t-CROSS-H-03":
        if v.get("min_budget_total") != int(si["total_budget_hours"] * 0.9):
            fail(tid, "min_budget_total 未随预算联动")
        if v.get("min_ranked_items") != max(4, len(si["demands"]) - 1):
            fail(tid, "min_ranked_items 未随需求数联动")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    gen_dir = Path(sys.argv[1])
    if not gen_dir.exists():
        print(f"目录不存在: {gen_dir}")
        return 2

    groups = defaultdict(list)
    for f in sorted(gen_dir.glob("*.json")):
        tid = f.stem.split("__")[0]
        groups[tid].append(json.loads(f.read_text(encoding="utf-8")))

    if not groups:
        print(f"{gen_dir} 下没有变体 JSON")
        return 2

    leaked = []
    for tid, variants in groups.items():
        # 1) 结构不变（跨变体一致即可；与模板的严格一致性由生成器 rng=None 分支保证）
        for field in ("task_type", "office_type"):
            vals = {x.get(field) for x in variants}
            if len(vals) != 1:
                fail(tid, f"{field} 跨变体不一致: {vals}")
        rs = {tuple(r["name"] for r in x.get("roles", [])) for x in variants}
        if tid not in ("t-PROJ-H-03",) and len(rs) != 1:
            fail(tid, "roles 跨变体不一致（PROJ-H-03 除外）")

        # 2) 变体互不相同
        hashes = [hashlib.md5(content_payload(x).encode()).hexdigest() for x in variants]
        if len(set(hashes)) != len(variants):
            fail(tid, f"{len(variants)} 个变体中仅 {len(set(hashes))} 个互不相同")

        # 3) ground truth 联动 + 4) 匿名
        for x in variants:
            check_ground_truth(tid, x)
            blob = json.dumps(x, ensure_ascii=False).lower()
            for kw in ("agenticx", "autogen", "crewai", "langgraph", "damonli"):
                if kw in blob:
                    leaked.append(f"{x.get('variant_id', tid)} 含标识词 {kw}")

    for x in leaked:
        print(f"  [FAIL] 匿名泄露: {x}")
    FAILURES.extend(leaked)

    for tid, variants in sorted(groups.items()):
        status = "OK" if not any(f.startswith(tid + ":") or f.startswith(tid) for f in FAILURES) else "FAIL"
        print(f"[{status}] {tid:<16} {len(variants)} 个变体全部互不相同"
              if status == "OK" else f"[FAIL] {tid:<16} 见上方错误")
    print(f"\n失败项: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
