"""复核离线消融报告里的三个数字，看它们各自到底在比什么。

背景：离线消融（run_ablation.py）给出了三个结论——上下文省 58%、陷阱 100%→0%、
库越大排序优势越大（MRR 0.38→0.53）。本脚本把每个数字的算法拆开重新量一遍，
输出一份复核报告。全部离线、确定性。

用法：python3 tests/okf_ablation/audit_offline_claims.py
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

try:
    from tests.okf_ablation import run_ablation as ra
    from tests.okf_ablation.run_scale_ablation import load_dataset_queries
except ImportError:
    import run_ablation as ra
    from run_scale_ablation import load_dataset_queries

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "datasets" / "okf_ablation"
REPORT = ROOT / ".cursor" / "plans" / "2026-11-25-okf-offline-audit-report.md"
FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)


def strip_header(text: str) -> str:
    """去掉文件头（YAML 元数据），只留正文。"""
    text = text.lstrip()
    m = FRONTMATTER.match(text)
    return text[m.end():] if m else text


def mrr(ids, relevant, k):
    return next((1.0 / (i + 1) for i, c in enumerate(ids[:k]) if c in relevant), 0.0)


def measure(name: str, bundle: Path, queries) -> dict:
    concepts, chunks = ra._build_units(bundle)
    now = datetime.now(timezone.utc)
    allowed = set()
    for c in concepts:
        o = c["okf"]
        stale = ra._parse_stale_after(o.get("stale_after"))
        if o.get("status") == "deprecated" or (stale and stale < now):
            continue
        allowed.add(c["concept_id"])
    everyone = {c["concept_id"] for c in chunks}
    bare = [{**c, "text": strip_header(c["text"])} for c in chunks]  # A0 去掉文件头
    out = {"name": name, "n": len(queries), "by_k": {}, "chars": {}}
    chars = dict.fromkeys(("a0", "bare", "a1", "a4"), 0.0)
    header_share = 0.0
    per_k = {k: {a: [] for a in ("a0", "bare", "a1", "a2", "a4")} for k in (3, 5, 10)}
    trap = {k: {"a1": [0, 0], "a2": [0, 0]} for k in (3, 5, 10)}
    for query, relevant, excluded in queries:
        qw = ra._tokenize(query)
        ranked = {
            "a0": ra._rank_units(chunks, query, everyone),
            "bare": ra._rank_units(bare, query, everyone),
            "a1": ra._rank_units(concepts, query, {c["concept_id"] for c in concepts}),
            "a2": ra._rank_units(concepts, query, allowed),
        }
        ranked["a4"] = sorted(ranked["a2"], key=lambda u: (
            -(ra._score(u["text"], qw, u.get("title", "")) + (0.15 if u["okf"].get("verified") else 0.0)),
            u["concept_id"]))
        for k, acc in per_k.items():
            for arm, units in ranked.items():
                ids = [u["concept_id"] for u in units]
                acc[arm].append(mrr(ids, relevant, k))
                if excluded and arm in trap[k]:
                    trap[k][arm][1] += 1
                    trap[k][arm][0] += bool(set(ids[:k]) & set(excluded))
        for arm in chars:
            top3 = ranked[arm][:3]
            chars[arm] += sum(len(u["text"]) for u in top3)
            if arm == "a4":
                chars[arm] += sum(len(str(u["okf"].get("sources", ""))) for u in top3)
        raw = sum(len(u["text"]) for u in ranked["a0"][:3]) or 1
        header_share += (raw - sum(len(u["text"]) for u in ranked["bare"][:3])) / raw
    n = len(queries)
    for k, acc in per_k.items():
        out["by_k"][k] = {
            **{arm: sum(v) / n for arm, v in acc.items()},
            "trap_unfiltered": trap[k]["a1"], "trap_filtered": trap[k]["a2"],
        }
    out["chars"] = {arm: round(v / n) for arm, v in chars.items()}
    out["header_share"] = header_share / n
    return out


def render(results) -> str:
    lines = [
        "# 离线消融数字复核",
        "",
        "消融报告（`run_ablation.py` 的输出）给过三个结论：上下文省 58%、陷阱混入 100%→0%、"
        "库越大排序优势越大（MRR 0.38→0.53）。这个脚本把每个数字的算法拆开重新量了一遍。"
        "结论是：三个里只有“元数据能按规则剔除过期知识”站得住，另外两个不能当作 OKF 价值的证据。",
        "",
        "复算：`python3 tests/okf_ablation/audit_offline_claims.py`（离线、确定性）。",
        "",
        "## 1. “上下文省 58%”：不成立",
        "",
    ]
    for r in results:
        c = r["chars"]
        lines.append(
            f"- {r['name']} 条知识的库：按原始文件整段读是每条查询 {c['a0']} 个字符，"
            f"其中 {r['header_share']:.0%} 是文件头（YAML 元数据）的文字。去掉文件头是 {c['bare']}，"
            f"只读正文是 {c['a1']}，正文加元数据是 {c['a4']}。"
        )
    lines += [
        "",
        "当时的 501→208 是拿“连文件头一起当正文”去比“正文加部分元数据”，省下来的是文件头本身。"
        "跟真正的纯正文比，元数据没有省上下文，反而多了字符（15 条的库 +50%，600 条的库持平）。"
        "另外量的是字符数，不是 token。",
        "",
        "## 2. “陷阱混入 100%→0%”：0% 是规则保证的，100% 只在手写小库里成立",
        "",
        "| 库 | 取前几条 | 不过滤：有陷阱的查询 | 过滤后 |",
        "| --- | --- | --- | --- |",
    ]
    for r in results:
        for k, v in r["by_k"].items():
            a, b = v["trap_unfiltered"], v["trap_filtered"]
            lines.append(f"| {r['name']} | 前 {k} 条 | {a[0]}/{a[1]}（{a[0] / a[1]:.0%}） | {b[0]}/{b[1]} |")
    lines += [
        "",
        "过滤规则是“status 为 deprecated、或 stale_after 早于今天，就剔除”；“陷阱”的定义正是这两类。"
        "所以过滤后必然是 0%，和查询文字像不像没有关系。这一点说明过滤逻辑接对了，而且不依赖文字相似度。",
        "",
        "100% 那一头只在 15 条知识的手写小库里成立：库里一共 15 条却取前 10 条，陷阱又是照着查询的用词写的。"
        "600 条的库里，同一个指标是前 3 条 4%、前 5 条 10%、前 10 条 22%。",
        "",
        "## 3. “库越大排序优势越大（MRR 0.38→0.53）”：七成来自别的因素",
        "",
        "MRR 是“第一条正确结果排第几名”的得分，排第 1 得 1 分、第 2 得 0.5 分，越高越好。"
        "600 条知识的库、取前 10 条：",
        "",
        "| 步骤 | MRR | 这一步增加了什么 |",
        "| --- | --- | --- |",
    ]
    v = next(r for r in results if r["name"] == "600")["by_k"][10]
    steps = [
        ("按原始文件整段读", "a0", "—"),
        ("只读正文，打分时用上标题字段", "bare", f"{v['bare'] - v['a0']:+.3f}（去掉文件头，没有影响）"),
        ("按知识单元读", "a1", f"{v['a1'] - v['bare']:+.3f}（打分函数多用了一个标题信号）"),
        ("加元数据过滤", "a2", f"{v['a2'] - v['a1']:+.3f}"),
        ("加复核标记加权", "a4", f"{v['a4'] - v['a2']:+.3f}"),
    ]
    for label, key, delta in steps:
        lines.append(f"| {label} | {v[key]:.3f} | {delta} |")
    lines += [
        "",
        f"从 {v['a0']:.3f} 到 {v['a4']:.3f} 一共差 {v['a4'] - v['a0']:.3f}，其中 {v['a1'] - v['bare']:.3f} 来自打分函数用了标题字段，"
        f"元数据过滤只贡献 {v['a2'] - v['a1']:.3f}。而且检索和评测用的是同一个词面打分函数，查询是从知识正文生成的，"
        "测的是实验脚本自己的打分，不是真实的向量检索。",
        "",
        "## 站得住的说法",
        "",
        "- 知识带着 status 和 stale_after 时，代码可以按规则把过期、废弃的剔除，不靠文字相似度去猜。",
        "- 元数据本身有上下文成本（0 到 50% 的字符），不省 token。",
        "- 排序质量的真实差别，要换成真实向量检索和真实查询才能回答。",
        "",
        "## 原始数字",
        "",
        "| 库 | 取前几条 | MRR 原始文件 | 去文件头 | 按知识单元 | 加过滤 | 加复核加权 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        for k, v in r["by_k"].items():
            lines.append(f"| {r['name']} | 前 {k} 条 | {v['a0']:.3f} | {v['bare']:.3f} | {v['a1']:.3f} | {v['a2']:.3f} | {v['a4']:.3f} |")
    lines.append("")
    return "\n".join(lines)


def main():
    results = [
        measure("15", DATASET / "bundle_v2_15", ra.ANNOTATED_QUERIES),
        measure("600", DATASET / "scale_600", load_dataset_queries(DATASET / "scale_600")),
    ]
    REPORT.write_text(render(results), encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))
    print(f"Report written to {REPORT}")


if __name__ == "__main__":
    main()
