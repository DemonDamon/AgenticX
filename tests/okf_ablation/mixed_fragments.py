"""多条知识打架时的跨模型实验：一条过期知识 + 一条现行知识，同时给模型看。

cross_model_consistency.py 测的是"只给一条过期知识"。这里测更接近真实检索的情况：
同一个问题检索出两条互相矛盾的知识，其中一条已过期，一条是现行的。
看三个模型各自依据哪一条作答，以及答案是否一致。

- 不给户口：两条知识都只有正文，标题相同，没有任何线索说明哪条现行
- 给户口：两条知识带文件头，过期那条 status 为 deprecated 或 stale_after 早于今天

每个话题按两种顺序各排一次（过期的在前 / 现行的在前），用来发现"只依据排在前面的那条"。
答案按文本归为：现行（答了现行数值）/ 过期（答了过期数值）/ 无法回答 / 其他。

用法：
  python3 tests/okf_ablation/mixed_fragments.py            # 全量，可断点续跑
  python3 tests/okf_ablation/mixed_fragments.py --report-only   # 只用已落盘结果重出报告
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List

try:
    from tests.okf_ablation.cross_model_consistency import (
        ITEMS, MODELS, TODAY, call_model, render_fragment,
    )
except ImportError:
    from cross_model_consistency import ITEMS, MODELS, TODAY, call_model, render_fragment

REPEATS = 3
ARMS = ("blind", "meta")
ORDERS = ("stale_first", "valid_first")
RAW_PATH = Path(__file__).resolve().parents[2] / "datasets" / "okf_ablation" / "mixed_fragments_raw.jsonl"
REPORT_PATH = Path(__file__).resolve().parents[2] / ".cursor" / "plans" / "2026-11-25-okf-mixed-fragments-report.md"

# 每个过期话题对应的现行知识：正文与过期知识同结构，只有数值不同
CURRENT: Dict[str, tuple] = {
    "refund-review-sla": ("用户提交退款申请后，客服需在 24 小时内完成审核，审核通过后 3 个工作日内原路退回。",
                          r"24\s*个?\s*(?:小时|钟头)"),
    "loyalty-points": ("会员每消费 1 元累计 10 积分，积分自获得之日起 24 个月内有效。", r"10\s*个?\s*积分"),
    "e-invoice": ("电子发票在订单完成后 2 小时内自动开具，纸质发票需联系客服申请。",
                  r"(?<![\d.])2\s*个?\s*(?:小时|钟头)"),
    "free-shipping": ("订单实付金额满 59 元免运费，不足 59 元收取 6 元运费。", r"59\s*(?:元|块)"),
    "annual-leave": ("入职满 1 年的员工每年享有 12 天带薪年假，满 3 年增至 18 天。", r"12\s*天"),
    "cs-first-response": ("在线客服工作日的首次响应时限为 30 秒，超过时限工单自动升级至值班主管。", r"30\s*秒"),
    "gold-card-discount": ("金卡会员享受 8 折优惠，白金卡会员享受 7 折优惠。", r"8\s*折"),
    "payment-timeout": ("下单后订单保留 15 分钟，超时未支付自动关闭。", r"15\s*分钟"),
    "same-city-delivery": ("同城配送平均 2 小时送达，95 分位的订单在 5 小时内送达。",
                           r"(?<![\d.])2\s*个?\s*(?:小时|钟头)"),
    "warehouse-rent": ("华东一号仓的仓储租金为每平方米每月 45 元，按季度结算。", r"45\s*(?:元|块)"),
    "content-review-sla": ("图文内容的人工审核平均在 20 分钟内完成，高峰期不超过 1 小时。", r"20\s*分钟"),
    "backup-retention": ("数据库每日全量备份保留 14 天，增量备份保留 60 天。", r"14\s*天"),
}

TOPICS: List[Dict] = []
for _it in ITEMS:
    if _it["id"] in CURRENT:
        _body, _re = CURRENT[_it["id"]]
        TOPICS.append({
            "id": _it["id"], "title": _it["title"], "question": _it["question"],
            "stale": _it, "stale_re": _it["value_re"],
            "current": {"id": _it["id"] + "-current", "kind": "valid", "type": _it["type"],
                        "title": _it["title"], "body": _body, "stale_after": "2027-06-30T00:00:00Z"},
            "current_re": _re,
        })

_ANSWER = re.compile(r"答案\s*[=＝:：]\s*[\"'“”`*_＿]*\s*(.+)")
_BASIS = re.compile(r"依据\s*[=＝:：]\s*[\"'“”`*_＿]*\s*(\d|无)")


def build_prompt(topic: Dict, arm: str, order: str) -> str:
    first, second = (topic["stale"], topic["current"]) if order == "stale_first" else (topic["current"], topic["stale"])
    return (
        f"今天是 {TODAY}。你是企业知识问答助手。下面是从知识库检索到的两条知识，请回答用户问题。\n\n"
        f"【知识 1】\n{render_fragment(first, arm)}\n\n"
        f"【知识 2】\n{render_fragment(second, arm)}\n\n"
        f"用户问题：{topic['question']}\n\n"
        "回答之后，严格按下面的两行格式单独输出，行内不要加其他符号或解释：\n"
        "答案=<对问题的直接回答；无法基于以上知识可靠回答时填：无法回答>\n"
        "依据=<你依据的知识编号，填 1 或 2；两条都不能依据时填：无>"
    )


def classify(answer: str, topic: Dict) -> str:
    has_stale = bool(re.search(topic["stale_re"], answer))
    has_current = bool(re.search(topic["current_re"], answer))
    if has_current and not has_stale:
        return "现行"
    if has_stale and not has_current:
        return "过期"
    if has_current and has_stale:
        return "两条都提"
    return "无法回答" if "无法" in answer else "其他"


def run_one(model: Dict, arm: str, order: str, topic: Dict, repeat: int) -> Dict:
    base = {"model": model["name"], "arm": arm, "order": order, "topic": topic["id"], "repeat": repeat}
    prompt = build_prompt(topic, arm, order)
    for attempt in range(3):
        try:
            content, finish = call_model(model, prompt)
            if content:
                answers = _ANSWER.findall(content)
                bases = _BASIS.findall(content)
                answer = answers[-1].strip() if answers else ""
                return {**base, "status": "ok" if answer else "parse_fail", "answer": answer,
                        "basis": bases[-1] if bases else "", "cls": classify(answer, topic) if answer else "",
                        "raw": content, "finish": finish}
            last = {"finish": finish}
        except Exception as e:  # 网络与接口异常记录后重试，不中断实验
            last = {"error": str(e)[:200]}
        time.sleep(3 * (attempt + 1))
    return {**base, "status": "error" if "error" in last else "empty", "answer": "", "basis": "",
            "cls": "", "raw": "", **last}


def run(repeats: int, raw_path: Path, workers: int, models=MODELS, topics=TOPICS):
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                done.add((r["model"], r["arm"], r["order"], r["topic"], r["repeat"]))
    todo = [(m, arm, order, t, rep) for m in models for arm in ARMS for order in ORDERS for t in topics
            for rep in range(repeats) if (m["name"], arm, order, t["id"], rep) not in done]
    print(f"{len(done)} done, {len(todo)} to run", flush=True)
    lock = threading.Lock()
    with raw_path.open("a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_one, m, arm, order, t, rep) for m, arm, order, t, rep in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            rec = fut.result()
            with lock:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
            if i % 50 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}", flush=True)


def _majority(labels):
    labels = [x for x in labels if x]
    return Counter(labels).most_common(1)[0][0] if labels else None


def summarize(results: List[Dict], models=MODELS, topics=TOPICS) -> Dict:
    dist, cell, detail = {}, {}, {}
    for m in models:
        for arm in ARMS:
            rows = [r for r in results if r["model"] == m["name"] and r["arm"] == arm and r["status"] == "ok"]
            dist[(m["name"], arm)] = Counter(r["cls"] for r in rows)
            dist[(m["name"], arm)]["失败"] = sum(
                1 for r in results if r["model"] == m["name"] and r["arm"] == arm and r["status"] != "ok")
            for t in topics:
                for order in ORDERS:
                    labels = [r["cls"] for r in rows if r["topic"] == t["id"] and r["order"] == order]
                    cell[(m["name"], arm, t["id"], order)] = _majority(labels)
                detail[(m["name"], arm, t["id"])] = "/".join(
                    cell[(m["name"], arm, t["id"], o)] or "无数据" for o in ORDERS)
    agreement, order_stable = {}, {}
    for arm in ARMS:
        total = same = 0
        for t in topics:
            for order in ORDERS:
                labels = [cell.get((m["name"], arm, t["id"], order)) for m in models]
                if None in labels:
                    continue
                total += 1
                same += len(set(labels)) == 1
        agreement[arm] = (same, total)
        for m in models:
            stable = 0
            for t in topics:
                a, b = cell.get((m["name"], arm, t["id"], "stale_first")), cell.get((m["name"], arm, t["id"], "valid_first"))
                stable += a is not None and a == b
            order_stable[(m["name"], arm)] = (stable, len(topics))
    return {"dist": dist, "agreement": agreement, "order_stable": order_stable, "detail": detail}


NARRATIVE_START, NARRATIVE_END = "<!-- narrative-start -->", "<!-- narrative-end -->"


def render(summary: Dict, n_calls: int, models=MODELS, topics=TOPICS) -> str:
    dist, label = summary["dist"], {"blind": "不给户口", "meta": "给户口"}
    lines = [
        "# 两条打架的知识：三个模型依据哪一条",
        "",
        f"12 个话题 × 2 种排列顺序 × 2 种呈现 × 3 个模型 × 每格 {REPEATS} 次，参照日期 {TODAY}，温度 0，"
        f"已落盘 {n_calls} 次调用。原始回答逐条保存在 datasets/okf_ablation/mixed_fragments_raw.jsonl。",
        "",
        "## 怎么测",
        "",
        "每个话题有两条互相矛盾的知识：一条已过期或已废弃（比如“退款审核 48 小时”），一条是现行的（“24 小时”）。"
        "两条同时给模型看，问同一个问题（“客服需要在多长时间内完成审核？”）。两条知识的标题相同，正文结构相同，只有数值不同。",
        "",
        "- 不给户口：两条都只有正文，没有任何线索说明哪条现行",
        "- 给户口：过期那条的 status 是 deprecated，或 stale_after 早于今天；现行那条 status 是 stable、stale_after 在今天之后",
        "",
        "每个话题按两种顺序各排一次（过期的在前、现行的在前），用来发现“只依据排在前面的那条”。"
        "正确答案是现行那条的数值。",
        "",
        "## 数据",
        "",
        "### 表 1  各模型各呈现下，答案归到哪一类（次数）",
        "",
        "| 模型 | 呈现 | 答现行数值 | 答过期数值 | 两条都提 | 无法回答 | 其他 | 调用失败 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for m in models:
        for arm in ARMS:
            d = dist[(m["name"], arm)]
            lines.append(f"| {m['name']} | {label[arm]} | {d['现行']} | {d['过期']} | {d['两条都提']} | "
                         f"{d['无法回答']} | {d['其他']} | {d['失败']} |")
    lines += [
        "",
        "### 表 2  一致性",
        "",
        "| 呈现 | 三个模型答案一致（话题 × 顺序） | 同一模型换顺序后答案不变 |",
        "| --- | --- | --- |",
    ]
    for arm in ARMS:
        a = summary["agreement"][arm]
        per_model = "；".join(f"{m['name']} {summary['order_stable'][(m['name'], arm)][0]}/{summary['order_stable'][(m['name'], arm)][1]}" for m in models)
        lines.append(f"| {label[arm]} | {a[0]}/{a[1]} | {per_model} |")
    lines += [
        "",
        "“三个模型答案一致”：同一个话题、同一种排列顺序下，三个模型的多数答案属于同一类。"
        "“换顺序后答案不变”：过期的排在前面和现行的排在前面，同一模型给出的答案类别相同。",
        "",
        "### 表 3  逐条明细（每格是 3 次重复的多数答案；左边是过期的排在前面，右边是现行的排在前面）",
        "",
        "| 话题 | "
        + " | ".join(f"{m['name']} {label[arm]}" for m in models for arm in ARMS) + " |",
        "| --- | " + " | ".join("---" for _ in models for _ in ARMS) + " |",
    ]
    for t in topics:
        cells = [summary["detail"].get((m["name"], arm, t["id"]), "无数据") for m in models for arm in ARMS]
        lines.append(f"| {t['title']} | " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines) + "\n"


def write_report(summary: Dict, n_calls: int):
    narrative = ""
    if REPORT_PATH.exists():
        old = REPORT_PATH.read_text(encoding="utf-8")
        if NARRATIVE_START in old and NARRATIVE_END in old:
            narrative = old.split(NARRATIVE_START, 1)[1].split(NARRATIVE_END, 1)[0]
    body = render(summary, n_calls)
    if narrative:
        body += "\n" + NARRATIVE_START + narrative + NARRATIVE_END + "\n"
    REPORT_PATH.write_text(body, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="两条打架的知识：跨模型实验")
    parser.add_argument("--repeats", type=int, default=REPEATS)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--smoke", action="store_true", help="1 个话题各跑 1 次，结果写到 /tmp")
    parser.add_argument("--report-only", action="store_true", help="不调模型，只用已落盘结果重出报告")
    args = parser.parse_args()

    repeats, raw_path, topics = args.repeats, RAW_PATH, TOPICS
    if args.smoke:
        topics, repeats, raw_path = TOPICS[:1], 1, Path("/tmp/okf_diag/mixed_smoke.jsonl")
        raw_path.unlink(missing_ok=True)
    if not args.report_only:
        run(repeats, raw_path, args.workers, topics=topics)
    results = [json.loads(x) for x in raw_path.read_text(encoding="utf-8").splitlines() if x.strip()]
    if args.smoke:
        for r in results:
            print(f"{r['model']:22} {r['arm']:6} {r['order']:12} {r['status']:10} {r['cls']:5} 依据{r['basis'] or '-'} | {r['answer'][:36]}")
        return
    summary = summarize(results, topics=topics)
    write_report(summary, len(results))
    print(REPORT_PATH.read_text(encoding="utf-8").split(NARRATIVE_START)[0])
    print(f"Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
