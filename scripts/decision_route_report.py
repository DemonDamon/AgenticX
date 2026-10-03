#!/usr/bin/env python
"""判断层战役 Go/No-Go 路线报告生成器（SP28 T2）。

输入：SP27 gating A/B json + SP26 基线 json + 补标数据资产，
套用 MASTER-PLAN 第五节三路线框架，程序化产出路线建议。

用法:
  # mock 演练（全链路可重跑，报告头标注 mock）
  python scripts/decision_route_report.py --mock

  # 真实证据
  python scripts/decision_route_report.py \
      --gating-json results/decision-layer/gating/gating_ab.json \
      --baseline-json results/decision-layer/baseline/baseline.json \
      --labeled-decisions results/decision-layer/gating/continue_stop.labeled.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_MOCK_GATING = {
    "meta": {"scorer_id": "mock-v1", "degraded": True, "seeds": ["v1"],
             "forest": {"n_tasks": 9, "n_attempts": 20, "tasks_with_pass": 7}},
    "summary": {"train": {
        "never_abort": {"pass_rate": [0.71, 0.06], "avg_cost": [51225, 2440],
                        "abort_rate": [0.0, 0.0]},
        "decision_head_tau0.6": {"pass_rate": [0.0, 0.0], "avg_cost": [449, 20],
                                 "abort_rate": [0.56, 0.0]}}},
}
_MOCK_BASELINE = {"meta": {"scorer_id": "mock-v1", "degraded": True},
                  "overall": {"top1": 0.45, "ece": 0.295}}


def _load(path: str, mock: dict | None, is_mock: bool, what: str) -> dict | None:
    if is_mock:
        return mock
    if not path or not Path(path).exists():
        print(f"警告: {what} 缺失（{path or '未指定'}），相应证据行标记 N/A")
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _labeled_stats(path: str, is_mock: bool) -> dict | None:
    if is_mock:
        return {"n_records": 30, "n_labels": 30, "teacher": "mock-v1"}
    if not path or not Path(path).exists():
        print(f"警告: 补标数据资产缺失（{path or '未指定'}），补标规模标记 N/A")
        return None
    n_rec = n_lab = 0
    teacher = ""
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        n_rec += 1
        for l in d.get("labels") or []:
            if l.get("source") == "teacher":
                n_lab += 1
                teacher = l.get("teacher_model") or teacher
    return {"n_records": n_rec, "n_labels": n_lab, "teacher": teacher}


def _route_verdict(gating: dict | None, labeled: dict | None) -> dict:
    """按 MASTER-PLAN 第五节框架程序化判定（train 区为准，held-out 只验收）。

    显著性说明：样本量（≈100 任务）下用"均值 ± 全距跨 seed 稳定性"做
    描述性判据替代 Wilcoxon（框架原定 p≥0.05），判据写进报告。
    """
    v = {"route": "兜底", "reasons": [], "sp29_gate": "", "collect_actions": []}
    n_lab0 = (labeled or {}).get("n_labels", 0)
    v["sp29_gate"] = (
        f"自训门槛：teacher 标签 {n_lab0} 条"
        f"（{'已达' if n_lab0 >= 1000 else '未达'} 千级线；"
        f"积累速率 = 每次 gating A/B prewarm 可产 ~1.2 万条 attempt-0 标签）")
    if gating is None or gating.get("meta", {}).get("degraded"):
        v["reasons"].append("gating 证据缺失或为 mock——无法支撑任何部署结论")
        v["collect_actions"] = [
            "跑真实 scorer 的 eval_gating_ab.py 生成 gating_ab.json 后重新生成本报告"]
        return v

    tr = gating["summary"]["train"]
    na = tr.get("never_abort")
    dh_names = [k for k in tr if k.startswith("decision_head")]
    if not na or not dh_names:
        v["reasons"].append("A/B 表缺 never_abort 或 decision_head 行")
        return v
    # 最优决策头：pass_rate 优先（不伤成功率红线），成本次之
    best = max(dh_names, key=lambda k: (tr[k]["pass_rate"][0], -tr[k]["avg_cost"][0]))
    dh = tr[best]
    eps = max(na["pass_rate"][1] / 2, 0.01)          # 跨 seed 全距一半作噪声带
    d_pr, d_cost = dh["pass_rate"][0] - na["pass_rate"][0], dh["avg_cost"][0] - na["avg_cost"][0]
    saving = -d_cost / na["avg_cost"][0] if na["avg_cost"][0] else 0.0

    if d_pr < -eps:
        v["route"] = "负结果（伤成功率）"
        v["reasons"].append(
            f"{best} train pass_rate {dh['pass_rate'][0]:.3f} 低于 never_abort "
            f"{na['pass_rate'][0]:.3f}（超出噪声带 ±{eps:.3f}）——公开头零样本"
            f"在域内 continue_stop state 上会错杀有效尝试")
    elif saving > 0.05:
        v["route"] = "A（受限部署）"
        v["reasons"].append(
            f"{best} pass_rate 与 never_abort 持平（Δ={d_pr:+.3f}）且成本省 "
            f"{saving:.1%}——回放侧 continue_stop 守门员可部署")
    else:
        v["reasons"].append(
            f"{best} pass_rate 持平（Δ={d_pr:+.3f}）但无可测成本收益"
            f"（Δcost={d_cost:+.0f} est tok）——零和，部署无依据")

    # 路线 B 门槛已在函数头算好（sp29_gate：千级标签 + 积累速率）
    if v["route"] != "A（受限部署）":
        v["collect_actions"] = [
            "SP25 采集优先级上调 multi-tool harness（tool_selection 域内退化已证）",
            "continue_stop 标签随每次回放评测自然积累（eval_gating_ab.py --dump-decisions）",
            "error_classification 是零候选依赖的次优决策类型，SP25 可低成本加采"]
    return v


def main() -> None:
    ap = argparse.ArgumentParser(description="Go/No-Go 路线报告生成（SP28 T2）")
    ap.add_argument("--gating-json", default="results/decision-layer/gating/gating_ab.json")
    ap.add_argument("--baseline-json", default="results/decision-layer/baseline/baseline.json")
    ap.add_argument("--labeled-decisions",
                    default="results/decision-layer/gating/continue_stop.labeled.jsonl")
    ap.add_argument("--mock", action="store_true", help="mock 演练（数字无结论意义）")
    ap.add_argument("--out", default="plans/decision-layer/route-decision.md")
    args = ap.parse_args()

    gating = _load(args.gating_json, _MOCK_GATING, args.mock, "gating A/B json")
    baseline = _load(args.baseline_json, _MOCK_BASELINE, args.mock, "基线 json")
    labeled = _labeled_stats(args.labeled_decisions, args.mock)
    v = _route_verdict(gating, labeled)

    meta = (gating or {}).get("meta", {})
    fm = meta.get("forest", {})
    lines = [
        "# 判断层战役 Go/No-Go 路线决策报告",
        "",
        f"> 生成: decision_route_report.py{' （mock 演练，数字无结论意义）' if args.mock else ''}",
        "> 框架: [MASTER-PLAN.md](MASTER-PLAN.md) 第五节；判据见下文",
        "",
        "## 1. 证据汇总",
        "",
        "| 维度 | 数字 | 来源 |",
        "|---|---|---|",
    ]
    if baseline:
        ov = baseline.get("overall", {})
        deg = "（mock）" if baseline.get("meta", {}).get("degraded") else ""
        lines.append(
            f"| 零样本 tool_selection top1 / ECE | {ov.get('top1', 'N/A')} / "
            f"{ov.get('ece', 'N/A')} {deg} | SP26 基线（test 切分） |")
    else:
        lines.append("| 零样本 tool_selection top1 / ECE | N/A | 基线 json 缺失 |")
    lines += [
        "| 域内 tool_selection 数据形态 | 1259 决策点 100% 单候选（bash-only），"
        "top1=1.0 为退化短路，零信息 | SP26 实测 |",
        "| 合成多工具管线验证 | 0.8B/4B top1 均 0.45（无语义信号，仅证协议兼容） | SP26 |",
        f"| gating A/B forest | {fm.get('n_tasks', 'N/A')} tasks / "
        f"{fm.get('n_attempts', 'N/A')} attempts | SP27 回放 |",
        f"| continue_stop teacher 标签 | "
        f"{(labeled or {}).get('n_labels', 'N/A')} 条"
        f"（{(labeled or {}).get('teacher', '')}） | SP27/SP28 补标 |",
        "",
        "## 2. 判据（真实分布定标）",
        "",
        "- train 区为准（held-out 只验收，不参与选择）；跨 seed 全距一半作噪声带",
        "- 部署线：pass_rate 不降出噪声带 且 成本节省 >5%",
        "- 自训线：teacher 标签达千级且持续积累",
        "",
        "## 3. 判定",
        "",
        f"**路线结论: {v['route']}**",
        "",
    ]
    lines += [f"- {r}" for r in v["reasons"]]
    if v["sp29_gate"]:
        lines += ["", f"**SP29 自训立项门槛**: {v['sp29_gate']}"]
    if v["collect_actions"]:
        lines += ["", "**采集侧动作（兜底也是结论）**:"] + [
            f"- {a}" for a in v["collect_actions"]]
    lines += [
        "",
        "## 4. 三路线对照（第五节框架）",
        "",
        "| 路线 | 条件 | 当前证据 |",
        "|---|---|---|",
        "| A 直接部署公开头 | gating 无显著下降 + 可测节省 | " 
        + ("满足" if v["route"].startswith("A") else "不满足（见判定）") + " |",
        "| B 自训 SP29+ 立项 | 零样本不足 + 千级标签持续积累 | "
        + v["sp29_gate"].split("：", 1)[-1] + " |",
        "| C 混合 | A 兜底冷启动 + B 攻高价值类型 | 视 A/B 判定组合 |",
        "",
        "> 许可提醒: StartLux-Decision weights 为 CC BY-NC 4.0（研究可用，"
        "商用需授权）；推理代码 Apache-2.0。路线 A 若涉商用需先过许可。",
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"路线: {v['route']}")
    print(f"报告: {out}")


if __name__ == "__main__":
    main()
