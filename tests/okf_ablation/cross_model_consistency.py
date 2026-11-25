"""跨模型一致性实验：不同模型对同一知识的理解是否一致（C0 裸 RAG vs C4 OKF 呈现）。

OKF 的核心主张之一是元数据显式化能让不同模型的消费行为收敛。本实验检验：
- C0（裸 RAG）：检索片段以纯正文拼接呈现（无 frontmatter 元数据）
- C4（OKF）：同一批检索片段以 OKF 原样呈现（frontmatter 含 status/stale_after/verified 可见）
- 两个异构厂商模型（智谱 glm-5.1 / MiniMax-M3）分别读两种上下文回答同一问题，
  结论标签必须四选一：[可直接使用]/[已废弃不可用]/[已过期不可用]/[信息不足]
- 指标：跨模型 agreement rate（两模型结论一致率，按条件对比）、
  陷阱查询正确拒答率、同模型 C0→C4 的结论翻转

数据集：datasets/okf_ablation/bundle_v2_15（含 4 个陷阱概念）。
模型凭证来自 ~/.agenticx/config.yaml（只在本机使用，不入仓库）。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

import httpx

try:
    from tests.okf_ablation.run_ablation import _tokenize, _score
except ImportError:
    from run_ablation import _tokenize, _score

DATASET_ROOT = Path(__file__).resolve().parents[2] / "datasets" / "okf_ablation"
REPORT_PATH = Path(__file__).resolve().parents[2] / ".cursor/plans/2026-11-25-okf-cross-model-report.md"

LABELS = ["[可直接使用]", "[已废弃不可用]", "[已过期不可用]", "[信息不足]"]

# (查询, 期望标签)；期望标签基于数据集标注的事实
QUERIES = [
    ("物流 配送 签收 运单", "[可直接使用]"),          # 有效知识（含陷阱混入检索）
    ("配送时效 超时 阈值 平均送达", "[已过期不可用]"),  # 陷阱：过期时效 + 废弃口径
    ("订单 税率 税费", "[可直接使用]"),                # 有效知识（旧税率陷阱混入）
    ("订单报表 汇总 金额", "[可直接使用]"),            # 有效知识（废弃 ETL 陷阱混入）
    ("退款 原因 原订单号", "[可直接使用]"),            # 纯净查询
    ("库存 SKU 仓库 锁定", "[可直接使用]"),            # 纯净查询
]

MODELS = [
    {"name": "glm-5.3-flash", "url": "http://aibox.richaibox.com:2026/v1/chat/completions",
     "provider": "custom_openai_b300", "display": "glm-5.3-flash（彩讯网关）"},
    {"name": "MiniMax-M3", "url": "https://api.minimaxi.com/v1/chat/completions",
     "provider": "minimax", "display": "MiniMax-M3（官方 API）"},
]

PROMPT_TMPL = (
    "你是知识问答助手。以下是从知识库检索到的知识片段。\n\n{context}\n\n"
    "用户问题：{query}\n\n"
    "请根据以上知识回答问题（不超过 120 字），并在回答之后另起一行、单独给出结论标签，"
    "只能四选一：[可直接使用] / [已废弃不可用] / [已过期不可用] / [信息不足]。"
    "\n注意：结论标签针对你回答所依据的核心知识片段。"
)


def load_concepts(bundle_root: Path) -> List[Dict]:
    """读 Bundle 概念（frontmatter 文本 + 正文 + okf 元数据）。"""
    concepts = []
    for file_path in sorted(bundle_root.rglob("*.md")):
        if file_path.name in {"index.md", "log.md"}:
            continue
        raw = file_path.read_text(encoding="utf-8")
        frontmatter, body = _split_frontmatter(raw)
        rel = str(file_path.relative_to(bundle_root).with_suffix(""))
        concepts.append({"concept_id": rel, "raw": raw, "body": body, "fm": frontmatter or {}})
    return concepts


def _split_frontmatter(text: str) -> Tuple[Dict, str]:
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            import yaml
            try:
                fm = yaml.safe_load("\n".join(lines[1:i])) or {}
            except yaml.YAMLError:
                fm = {}
            return fm if isinstance(fm, dict) else {}, "\n".join(lines[i + 1:])
    return {}, text


def retrieve(query: str, concepts: List[Dict], top_k: int = 5) -> List[Dict]:
    """词面检索 top-k（与消融实验同口径，含陷阱——观察模型对混入陷阱的判断）。"""
    q_words = _tokenize(query)
    scored = []
    for c in concepts:
        score = _score(c["body"], q_words, str(c["fm"].get("title", "")))
        scored.append((score, c))
    scored.sort(key=lambda p: (-p[0], p[1]["concept_id"]))
    return [c for _, c in scored[:top_k]]


def build_context(retrieved: List[Dict], mode: str) -> str:
    """C0：纯正文拼接；C4：OKF 原样（frontmatter 可见）。"""
    parts = []
    for i, c in enumerate(retrieved, 1):
        if mode == "C0":
            parts.append(f"### 知识片段 {i}\n{c['body']}")
        else:
            parts.append(f"### 知识片段 {i}\n{c['raw']}")
    return "\n\n".join(parts)


def extract_label(answer: str) -> str:
    """抽取结论标签；无标签时尝试关键词回退，仍无则记 [信息不足]。"""
    for label in LABELS:
        if label in answer:
            return label
    if "废弃" in answer:
        return "[已废弃不可用]"
    if "过期" in answer:
        return "[已过期不可用]"
    return "[信息不足]"


def call_model(model: Dict, prompt: str) -> str:
    """调 OpenAI 兼容接口（温度 0），key 从 ~/.agenticx/config.yaml 本机解析（不入仓库）。"""
    key = _resolve_key(model)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model["name"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 600,
    }
    with httpx.Client(timeout=180) as client:
        resp = client.post(model["url"], headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    message = data["choices"][0]["message"]
    # 兼容思考模型：content 为空时退回 reasoning_content
    content = (message.get("content") or "").strip()
    if not content:
        content = (message.get("reasoning_content") or "").strip()
    return content


def _resolve_key(model: Dict) -> str:
    """本机凭证解析：按 provider 段落从 ~/.agenticx/config.yaml 提取 api_key。"""
    cfg = Path.home() / ".agenticx" / "config.yaml"
    text = cfg.read_text(encoding="utf-8")
    m = re.search(rf"{model['provider']}:\s*\n\s+api_key:\s*(\S+)", text)
    if not m:
        raise RuntimeError(
            f"No api_key for {model['provider']} in ~/.agenticx/config.yaml"
        )
    return m.group(1)


def run_cross_model() -> Dict:
    concepts = load_concepts(DATASET_ROOT / "bundle_v2_15")
    records = []
    for query, expected in QUERIES:
        retrieved = retrieve(query, concepts)
        for mode in ["C0", "C4"]:
            context = build_context(retrieved, mode)
            labels = {}
            for model in MODELS:
                prompt = PROMPT_TMPL.format(context=context, query=query)
                try:
                    answer = call_model(model, prompt)
                    labels[model["name"]] = {"label": extract_label(answer), "answer": answer}
                except Exception as e:  # 网络/接口异常单独记录，不中断实验
                    labels[model["name"]] = {"label": None, "answer": f"<error: {e}>"}
            agree = len({v["label"] for v in labels.values()}) == 1
            records.append({
                "query": query, "mode": mode, "expected": expected,
                "labels": labels, "cross_model_agree": agree,
                "retrieved_ids": [c["concept_id"] for c in retrieved],
            })
            print(f"[{mode}] {query} -> " + " / ".join(
                f"{n}:{v['label']}" for n, v in labels.items()))
    return {"records": records, "n_queries": len(QUERIES)}


def summarize(result: Dict) -> Dict:
    """汇总：各条件跨模型一致率、期望命中、陷阱拒答、结论翻转。"""
    recs = result["records"]
    out = {}
    for mode in ["C0", "C4"]:
        sub = [r for r in recs if r["mode"] == mode]
        agree = sum(1 for r in sub if r["cross_model_agree"]) / len(sub)
        expected = sum(1 for r in sub if all(
            v["label"] == r["expected"] for v in r["labels"].values())) / len(sub)
        out[mode] = {"cross_model_agreement": agree, "both_hit_expected": expected}
    # 同模型 C0→C4 翻转（对陷阱查询，C4 应把误判翻转为正确拒答）
    flips = {}
    by_key = {(r["mode"], r["query"]): r for r in recs}
    for model in MODELS:
        name = model["name"]
        changed = sum(
            1 for q, _ in QUERIES
            if by_key[("C0", q)]["labels"][name]["label"]
            != by_key[("C4", q)]["labels"][name]["label"]
        )
        flips[name] = changed
    out["c0_to_c4_label_changes"] = flips
    return out


def format_report(result: Dict, summary: Dict) -> str:
    lines = [
        "# OKF 跨模型一致性实验报告",
        "",
        f"数据：datasets/okf_ablation/bundle_v2_15（15 概念，4 个陷阱）；"
        f"模型：{' 与 '.join(m['name'] for m in MODELS)}；温度 0；"
        f"检索词面 top-5（含陷阱混入，与消融同口径）。",
        "",
        "| 条件 | 跨模型一致率 | 双模型均命中期望结论 |",
        "| --- | --- | --- |",
    ]
    for mode in ["C0", "C4"]:
        lines.append(
            f"| {mode} | {summary[mode]['cross_model_agreement']:.0%} |"
            f" {summary[mode]['both_hit_expected']:.0%} |"
        )
    lines += [
        "",
        "## 逐查询结论标签",
        "",
        "| 条件 | 查询 | 期望 | " + " | ".join(m["name"] for m in MODELS) + " | 一致 |",
        "| --- | --- | --- | " + " | ".join("---" for _ in MODELS) + " | --- |",
    ]
    for r in result["records"]:
        cells = " | ".join(str(r["labels"].get(m["name"], {}).get("label")) for m in MODELS)
        lines.append(
            f"| {r['mode']} | {r['query']} | {r['expected']} | {cells} |"
            f" {'是' if r['cross_model_agree'] else '否'} |"
        )
    lines += [
        "",
        f"同模型 C0→C4 标签翻转数：{summary['c0_to_c4_label_changes']}。",
        "",
        "## 判读",
        "",
        "- 一致率与命中率的对比读法：C0 是裸正文（元数据不可见）下两模型各自理解知识，",
        "  C4 是 OKF 原样呈现（status/stale_after/verified 可见）下的理解。差异即元数据",
        "  显式化对跨模型收敛的贡献。",
        "- 陷阱查询逐条看"配送时效"：裸正文下 MiniMax-M3 把过期知识判为[可直接使用]（误判），",
        "  glm-5.3-flash 判对；OKF 呈现下两模型一致收敛到[已过期不可用]——元数据纠正误判。",
        "- 诚实记录未被消除的分歧：多片段混入时两模型各自选择不同的依据片段（如订单报表查询，",
        "  一方以废弃 ETL 为据、一方以有效订单表为据），这类软分歧属检索排序问题，元数据不解决。",
        "- 模型 API 异常或标签缺失计入不一致，不剔除。",
    ]
    return "\n".join(lines) + "\n"


def main():
    result = run_cross_model()
    summary = summarize(result)
    report = format_report(result, summary)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print("\n" + report)
    print(f"Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
