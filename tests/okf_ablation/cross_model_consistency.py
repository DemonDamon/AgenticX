"""跨模型元数据识别实验：同一条知识，不给/给"户口"，三个模型的判断会不会变。

判断只有两个选项：可用 / 不可用。已废弃、已过期的知识被正确识别时应判"不可用"。

上一版的结论已全部撤回（原因见报告"为什么重做"）。本版的设计约束：
1. 对照组真盲：正文不含任何状态字样，两种呈现的唯一差别是文件头部的 frontmatter
2. 单条知识 + 单个直接问题：判断只取决于这条知识，不受检索排序干扰
3. 今天日期写进提示词：没有参照日期，stale_after 判不了早晚
4. 输出强约束；解析失败单独计数，不回退成任何标签
5. 输出预算充足并记录 finish_reason：空输出是调用失败，不是模型判断
6. 每格重复 REPEATS 次（温度 0），度量同一模型自身的不稳定
7. 原始回答全部落盘（datasets/okf_ablation/cross_model_raw.jsonl），可逐条核对

三种呈现：
- blind  只给正文
- meta   frontmatter + 正文（不解释字段含义）
- guide  frontmatter + 正文 + 一句字段说明

用法：
  python3 tests/okf_ablation/cross_model_consistency.py              # 全量（可断点续跑）
  python3 tests/okf_ablation/cross_model_consistency.py --report-only  # 只用已落盘结果重出报告
模型凭证从 ~/.agenticx/config.yaml 读取，只在本地使用。
"""

from __future__ import annotations

import argparse
import json
import math
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

import httpx

# 判定 stale_after 早晚的参照日期，固定以保证可复算
TODAY = "2026-11-25"
REPEATS = 4
ARMS = ("blind", "meta", "guide")
RAW_PATH = Path(__file__).resolve().parents[2] / "datasets" / "okf_ablation" / "cross_model_raw.jsonl"
REPORT_PATH = Path(__file__).resolve().parents[2] / ".cursor" / "plans" / "2026-11-25-okf-cross-model-report.md"
CUE_WORDS = ("过期", "废弃", "失效", "旧", "停用", "作废")

MODELS = [
    {"name": "glm-5.3-flash", "url": "http://aibox.richaibox.com:2026/v1/chat/completions",
     "provider": "custom_openai_b300"},
    {"name": "deepseek-v4.1-flash", "url": "http://aibox.richaibox.com:2026/v1/chat/completions",
     "provider": "custom_openai_b300"},
    {"name": "MiniMax-M3", "url": "https://api.minimaxi.com/v1/chat/completions",
     "provider": "minimax"},
]


def _item(item_id: str, kind: str, title: str, type_: str, body: str, question: str,
          value_re: str, stale_after: Optional[str] = None) -> Dict:
    return {"id": item_id, "kind": kind, "title": title, "type": type_, "body": body,
            "question": question, "value_re": value_re, "stale_after": stale_after}


# 18 条知识。正文与问题都不含状态字样；value_re 用来检查答案是否照抄了知识里的数值
ITEMS: List[Dict] = [
    # 已废弃：status 为 deprecated
    _item("refund-review-sla", "deprecated", "退款审核时效", "Policy",
          "用户提交退款申请后，客服需在 48 小时内完成审核，审核通过后 3 个工作日内原路退回。",
          "用户提交退款申请后，客服需要在多长时间内完成审核？", r"48\s*个?\s*(?:小时|钟头)"),
    _item("loyalty-points", "deprecated", "会员积分规则", "Policy",
          "会员每消费 1 元累计 5 积分，积分自获得之日起 12 个月内有效。",
          "会员每消费 1 元能累计多少积分？", r"5\s*个?\s*积分"),
    _item("e-invoice", "deprecated", "电子发票开具规则", "Policy",
          "电子发票在订单完成后 24 小时内自动开具，纸质发票需联系客服申请。",
          "订单完成后电子发票多久自动开具？", r"24\s*个?\s*(?:小时|钟头)"),
    _item("free-shipping", "deprecated", "免运费门槛", "Policy",
          "订单实付金额满 99 元免运费，不足 99 元收取 8 元运费。",
          "订单满多少元可以免运费？", r"99\s*(?:元|块)"),
    _item("annual-leave", "deprecated", "年假天数", "Policy",
          "入职满 1 年的员工每年享有 10 天带薪年假，满 3 年增至 15 天。",
          "入职满 1 年的员工每年有多少天带薪年假？", r"10\s*天"),
    _item("cs-first-response", "deprecated", "在线客服响应时限", "Policy",
          "在线客服工作日的首次响应时限为 90 秒，超过时限工单自动升级至值班主管。",
          "在线客服工作日的首次响应时限是多少秒？", r"90\s*秒"),
    # 已过期：status 为 stable，但 stale_after 早于今天
    # 条目全部用企业内部知识：公开指标（利率、税率）模型凭自身知识就能判断新旧，测不出元数据的作用
    _item("gold-card-discount", "expired", "金卡会员折扣", "Policy",
          "金卡会员享受 95 折优惠，白金卡会员享受 9 折优惠。",
          "金卡会员享受几折优惠？", r"95\s*折", "2026-09-30T00:00:00Z"),
    _item("payment-timeout", "expired", "订单支付超时", "Policy",
          "下单后订单保留 30 分钟，超时未支付自动关闭。",
          "下单后多久未支付订单会自动关闭？", r"30\s*分钟", "2026-10-15T00:00:00Z"),
    _item("same-city-delivery", "expired", "同城配送时效", "Metric",
          "同城配送平均 4 小时送达，95 分位的订单在 8 小时内送达。",
          "同城配送平均多久送达？", r"(?<![\d.])4\s*个?\s*(?:小时|钟头)", "2026-11-01T00:00:00Z"),
    _item("warehouse-rent", "expired", "华东一号仓仓储租金", "Reference",
          "华东一号仓的仓储租金为每平方米每月 38 元，按季度结算。",
          "华东一号仓每平方米每月的仓储租金是多少？", r"38\s*(?:元|块)", "2026-10-20T00:00:00Z"),
    _item("content-review-sla", "expired", "图文内容审核时效", "Metric",
          "图文内容的人工审核平均在 30 分钟内完成，高峰期不超过 2 小时。",
          "图文内容的人工审核平均多长时间完成？", r"30\s*分钟|半小时", "2026-11-10T00:00:00Z"),
    _item("backup-retention", "expired", "数据库备份保留期", "Reference",
          "数据库每日全量备份保留 7 天，增量备份保留 30 天。",
          "数据库每日全量备份保留多少天？", r"(?<![\d.])7\s*天|七天|一周", "2026-08-31T00:00:00Z"),
    # 有效：status 为 stable，stale_after 晚于今天
    _item("payment-methods", "valid", "支付方式", "Reference",
          "平台支持微信支付、支付宝和银行卡三种支付方式，暂不支持货到付款。",
          "平台支持哪些支付方式？", r"微信支付|支付宝", "2027-06-30T00:00:00Z"),
    _item("return-window", "valid", "无理由退货期限", "Policy",
          "商品签收后 7 天内支持无理由退货，定制类商品除外。",
          "签收后多少天内可以无理由退货？", r"(?<![\d.])7\s*天|七天|一周", "2027-06-30T00:00:00Z"),
    _item("cs-working-hours", "valid", "人工客服服务时间", "Reference",
          "人工客服的服务时间为每天 9:00 至 21:00，节假日不休。",
          "人工客服每天的服务时间是什么时候？", r"9[:：]00|9\s*点", "2027-06-30T00:00:00Z"),
    _item("stocktake-cycle", "valid", "仓库盘点周期", "Policy",
          "仓库每月 1 日进行全量盘点，每周一进行循环盘点。",
          "仓库多久进行一次全量盘点？", r"每月(?:的)?1\s*[日号]", "2027-06-30T00:00:00Z"),
    _item("probation-length", "valid", "新员工试用期", "Policy",
          "新员工试用期为 3 个月，表现优秀者可由部门负责人申请缩短至 2 个月。",
          "新员工的试用期是多久？", r"3\s*个?\s*月|三个月", "2027-06-30T00:00:00Z"),
    _item("supplier-settlement", "valid", "供应商结算日", "Policy",
          "供应商货款在每月 5 日统一结算，节假日顺延至下一个工作日。",
          "供应商货款每月哪一天结算？", r"(?<![\d.])5\s*[日号]", "2027-06-30T00:00:00Z"),
]

GUIDE = (
    "知识头部两条 --- 之间是该知识的元数据：status 为 deprecated 表示该知识已废弃；"
    "stale_after 是这条知识的保质期，早于今天的日期表示已过期。已废弃或已过期的知识不能作为现行依据。"
)

_VERDICT = re.compile(
    r"判定\s*[=＝:：]\s*[\"'“”`*_＿]*\s*"
    r"(不可使用|不可以使用|不可用|不能用|不可以|不可|禁用|不适用|不能|可以使用|可用|能用)"
)
_POSITIVE = {"可用", "可以使用", "能用"}
_ANSWER = re.compile(r"答案\s*[=＝:：]\s*[\"'“”`*_＿]*\s*(.+)")


def render_fragment(item: Dict, arm: str) -> str:
    """知识片段：blind 只有正文；meta/guide 带 frontmatter。正文在三组里完全相同。"""
    text = f"# {item['title']}\n\n{item['body']}"
    if arm == "blind":
        return text
    status = "deprecated" if item["kind"] == "deprecated" else "stable"
    lines = [f"type: {item['type']}", f"title: {item['title']}", f"status: {status}"]
    if item["stale_after"]:
        lines.append(f"stale_after: {item['stale_after']}")
    return "---\n" + "\n".join(lines) + "\n---\n" + text


def build_prompt(item: Dict, arm: str) -> str:
    guide = f"\n\n{GUIDE}" if arm == "guide" else ""
    return (
        f"今天是 {TODAY}。你是企业知识问答助手。下面是从知识库检索到的一条知识：\n\n"
        f"{render_fragment(item, arm)}\n{guide}\n\n"
        f"用户问题：{item['question']}\n\n"
        "请判断这条知识现在能否直接用来回答用户问题，然后严格按下面的两行格式输出，"
        "行内不要加其他符号或解释：\n"
        "判定=<原样填写两个词之一：可用 或 不可用>\n"
        "答案=<对问题的直接回答；无法基于这条知识可靠回答时填：无法回答>"
    )


def parse(content: str):
    """取最后一次出现的"判定="和"答案="，判定归一为 可用/不可用（接受"禁用"等同义写法）。

    没有判定行时返回 (None, answer)：由调用方记为解析失败，不回退成任何标签。
    """
    verdicts = _VERDICT.findall(content)
    answers = _ANSWER.findall(content)
    answer = answers[-1].strip() if answers else ""
    return (None if not verdicts else ("可用" if verdicts[-1] in _POSITIVE else "不可用")), answer


def _resolve_key(model: Dict) -> str:
    cfg = Path.home() / ".agenticx" / "config.yaml"
    m = re.search(rf"{model['provider']}:\s*\n\s+api_key:\s*(\S+)", cfg.read_text(encoding="utf-8"))
    if not m:
        raise RuntimeError(f"No api_key for {model['provider']} in ~/.agenticx/config.yaml")
    return m.group(1)


def call_model(model: Dict, prompt: str, max_tokens: int = 4000):
    """返回 (正文, finish_reason)。推理模型需要足够的输出预算，否则正文为空。"""
    with httpx.Client(timeout=240) as client:
        resp = client.post(
            model["url"],
            headers={"Authorization": f"Bearer {_resolve_key(model)}"},
            json={"model": model["name"], "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0, "max_tokens": max_tokens},
        )
        resp.raise_for_status()
        choice = resp.json()["choices"][0]
    return (choice["message"].get("content") or "").strip(), choice.get("finish_reason")


def _key(model_name: str, arm: str, item_id: str, repeat: int):
    return f"{model_name}|{arm}|{item_id}|{repeat}"


def run_one(model: Dict, arm: str, item: Dict, repeat: int) -> Dict:
    base = {"model": model["name"], "arm": arm, "item": item["id"], "repeat": repeat}
    prompt = build_prompt(item, arm)
    for attempt in range(3):
        try:
            content, finish = call_model(model, prompt)
            if content:
                verdict, answer = parse(content)
                return {**base, "status": "ok" if verdict else "parse_fail", "verdict": verdict,
                        "answer": answer, "quoted": bool(answer and re.search(item["value_re"], answer)),
                        "raw": content, "finish": finish}
            last = {"finish": finish}
        except Exception as e:  # 网络与接口异常记录后重试，不中断实验
            last = {"error": str(e)[:200]}
        time.sleep(3 * (attempt + 1))
    return {**base, "status": "error" if "error" in last else "empty", "verdict": None,
            "answer": "", "quoted": False, "raw": "", **last}


def run(models: List[Dict], arms, items: List[Dict], repeats: int, raw_path: Path, workers: int):
    """跑全部调用并逐条追加到 raw_path；已存在的调用跳过（断点续跑）。"""
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                done.add(_key(r["model"], r["arm"], r["item"], r["repeat"]))
    todo = [(m, arm, it, rep) for m in models for arm in arms for it in items for rep in range(repeats)
            if _key(m["name"], arm, it["id"], rep) not in done]
    print(f"{len(done)} done, {len(todo)} to run", flush=True)
    lock = threading.Lock()
    with raw_path.open("a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_one, m, arm, it, rep) for m, arm, it, rep in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            rec = fut.result()
            with lock:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
            if i % 50 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}", flush=True)


def mcnemar_exact(b: int, c: int) -> float:
    """配对精确检验：若两种呈现没有差别，单向变化数 b 与反向变化数 c 应大致相等。"""
    n = b + c
    if n == 0:
        return 1.0
    tail = math.comb(n, min(b, c))
    return min(1.0, sum(math.comb(n, k) for k in range(n + 1) if math.comb(n, k) <= tail) / 2 ** n)


def summarize(results: List[Dict], models: List[Dict]) -> Dict:
    traps = [it for it in ITEMS if it["kind"] in ("deprecated", "expired")]
    valid = [it for it in ITEMS if it["kind"] == "valid"]
    table, majority, detail = {}, {}, {}

    def unusable_rate(rows):
        ok = [r for r in rows if r["status"] == "ok"]
        return (sum(r["verdict"] == "不可用" for r in ok) / len(ok)) if ok else None

    for m in models:
        for arm in ARMS:
            rows = [r for r in results if r["model"] == m["name"] and r["arm"] == arm]
            trap_rows = [r for r in rows if any(it["id"] == r["item"] for it in traps)]
            quote_ok = [r for r in trap_rows if r["status"] == "ok"]
            fracs = []
            for it in ITEMS:
                labels = [r["verdict"] for r in rows if r["item"] == it["id"] and r["status"] == "ok"]
                if labels:
                    top, cnt = Counter(labels).most_common(1)[0]
                    majority[(m["name"], arm, it["id"])] = top
                    detail[(m["name"], arm, it["id"])] = f"{top} {cnt}/{len(labels)}"
                    fracs.append(cnt / len(labels))
            table[(m["name"], arm)] = {
                "trap": unusable_rate(trap_rows),
                "deprecated": unusable_rate([r for r in trap_rows if r["item"] in {it["id"] for it in traps if it["kind"] == "deprecated"}]),
                "expired": unusable_rate([r for r in trap_rows if r["item"] in {it["id"] for it in traps if it["kind"] == "expired"}]),
                "false_reject": unusable_rate([r for r in rows if r["item"] in {it["id"] for it in valid}]),
                "quote": (sum(r["quoted"] for r in quote_ok) / len(quote_ok)) if quote_ok else None,
                "failures": sum(r["status"] != "ok" for r in rows),
                "n": len(rows),
                "stability": sum(fracs) / len(fracs) if fracs else None,
            }

    agreement = {}
    for arm in ARMS:
        for group_name, group in (("trap", traps), ("valid", valid)):
            total = hit = 0
            for it in group:
                labels = [majority.get((m["name"], arm, it["id"])) for m in models]
                if None in labels:
                    continue
                total += 1
                hit += len(set(labels)) == 1
            agreement[(arm, group_name)] = (hit, total)

    paired = {}
    for m in models:
        for a, b in (("blind", "meta"), ("blind", "guide"), ("meta", "guide")):
            gained = lost = 0
            for it in traps:
                la = majority.get((m["name"], a, it["id"]))
                lb = majority.get((m["name"], b, it["id"]))
                if la is None or lb is None:
                    continue
                if la == "可用" and lb == "不可用":
                    gained += 1
                elif la == "不可用" and lb == "可用":
                    lost += 1
            paired[(m["name"], a, b)] = (gained, lost, mcnemar_exact(gained, lost))
    return {"table": table, "agreement": agreement, "paired": paired, "detail": detail}


def _pct(x) -> str:
    return "—" if x is None else f"{x:.0%}"


def format_report(summary: Dict, results: List[Dict], models: List[Dict]) -> str:
    table, agreement, paired = summary["table"], summary["agreement"], summary["paired"]
    t = lambda name, arm: table.get((name, arm), {})
    lines = [
        "# OKF 跨模型实验报告（重做版）",
        "",
        f"18 条知识 × 3 种呈现 × 3 个模型 × 每格 {REPEATS} 次，参照日期 {TODAY}，温度 0，"
        f"已落盘 {len(results)} 次调用。原始回答逐条保存在 datasets/okf_ablation/cross_model_raw.jsonl。",
        "",
        "## 一、为什么重做：上一版实验无效，结论全部撤回",
        "",
        "上一版（两模型轮、三模型轮）得到的\"DeepSeek 拒答\"\"MiniMax 被元数据纠正\"\"一致率 67%→83%\"等说法都不成立，"
        "原因不在模型，在实验本身。重查原始脚本与数据后确认三个缺陷：",
        "",
        "1. **\"DeepSeek 拒答\"是脚本 bug。** 输出预算（max_tokens）设成了 600，推理模型把预算耗在思考上，"
        "正文一个字没返回（finish_reason=length）；解析函数遇到空回答时默认填了 [信息不足]。"
        "把预算放开重跑同一条，DeepSeek 两种呈现下都正常作答："
        "\"平均送达4小时来自已过期预估；超时阈值96小时为旧口径，已废弃，均不能作为现行标准。\"",
        "2. **对照组不盲。** 当时的\"裸正文\"只去掉了文件头部的元数据，正文标题里写着\"（已过期）\"\"（已废弃）\"。"
        "模型不看元数据也知道知识过期，所以\"给不给元数据\"这个对比从一开始就不存在。",
        "3. **标准答案本身有错。** 6 条查询里有 2 条（税率、报表）检索到的相关片段只有过期知识，"
        "模型答\"已过期不可用\"是对的，却被按\"可直接使用\"判错；多个陷阱同时出现时，\"已过期\"和\"已废弃\"两个标签也无法区分。",
        "",
        "另外：没告诉模型今天几号（stale_after 判不了早晚）、每格只跑一次、原始回答没有保存。",
        "",
        "## 二、这次怎么测",
        "",
        "18 条知识，每条单独给模型看，配一个只有这条知识能回答的问题：6 条已废弃（status: deprecated）、"
        "6 条已过期（status: stable，stale_after 早于今天）、6 条有效（status: stable，stale_after 晚于今天）。"
        "正文一律不含任何状态字样，因为现实里过期知识不会自带声明。每条知识有三种呈现：",
        "",
        "- 不给户口：只有正文",
        "- 给户口：文件头带元数据，不解释",
        "- 给户口并说明：同上，外加一句\"status 为 deprecated 表示已废弃；stale_after 早于今天表示已过期\"",
        "",
        "提示词写明今天日期，要求模型最后输出\"判定=可用/不可用\"。正确答案：已废弃、已过期的知识应判\"不可用\"，"
        "有效的知识应判\"可用\"。",
        "",
        "## 三、数据",
        "",
        "### 表 1  各模型各呈现下的判断（比例的分母是成功返回的调用次数）",
        "",
        "| 模型 | 呈现 | 陷阱识别率（判不可用） | 其中已废弃 | 其中已过期 | 有效知识误伤率 | 答案照抄过期数值 | 调用失败 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    label = {"blind": "不给户口", "meta": "给户口", "guide": "给户口并说明"}
    for m in models:
        for arm in ARMS:
            r = t(m["name"], arm)
            lines.append(
                f"| {m['name']} | {label[arm]} | {_pct(r.get('trap'))} | {_pct(r.get('deprecated'))} | "
                f"{_pct(r.get('expired'))} | {_pct(r.get('false_reject'))} | {_pct(r.get('quote'))} | "
                f"{r.get('failures', 0)}/{r.get('n', 0)} |")
    lines += [
        "",
        "### 表 2  同一个模型，换了呈现之后，12 条陷阱知识的判断变化",
        "",
        "| 模型 | 呈现变化 | 没识别 → 识别出 | 识别出 → 没识别 | 没差别时的概率 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for m in models:
        for a, b in (("blind", "meta"), ("blind", "guide"), ("meta", "guide")):
            g, l, p = paired[(m["name"], a, b)]
            lines.append(f"| {m['name']} | {label[a]} → {label[b]} | {g} | {l} | {p:.4f} |")
    lines += [
        "",
        "\"没差别时的概率\"是精确配对检验的 p 值：如果呈现方式不影响判断，出现这么单向的变化有多小的概率。"
        "判断按每条知识 4 次重复里的多数票计。",
        "",
        "### 表 3  三个模型对同一条知识的判断是否一致",
        "",
        "| 呈现 | 陷阱知识三模型全一致 | 有效知识三模型全一致 |",
        "| --- | --- | --- |",
    ]
    for arm in ARMS:
        a, b = agreement[(arm, "trap")], agreement[(arm, "valid")]
        lines.append(f"| {label[arm]} | {a[0]}/{a[1]} | {b[0]}/{b[1]} |")
    detail, kind_name = summary["detail"], {"deprecated": "已废弃", "expired": "已过期", "valid": "有效"}
    lines += [
        "",
        "### 表 4  逐条明细（每格是 4 次重复的多数判定，分数是多数票票数）",
        "",
        "| 知识 | 类型 | "
        + " | ".join(f"{m['name']} {label[arm]}" for m in models for arm in ARMS) + " |",
        "| --- | --- | " + " | ".join("---" for _ in models for _ in ARMS) + " |",
    ]
    for it in ITEMS:
        cells = [detail.get((m["name"], arm, it["id"]), "无数据") for m in models for arm in ARMS]
        lines.append(f"| {it['title']} | {kind_name[it['kind']]} | " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines) + "\n"


NARRATIVE_START, NARRATIVE_END = "<!-- narrative-start -->", "<!-- narrative-end -->"


def write_report(summary: Dict, results: List[Dict], models: List[Dict]):
    """重出报告时保留人工写的解读段（两个标记之间）。"""
    narrative = ""
    if REPORT_PATH.exists():
        old = REPORT_PATH.read_text(encoding="utf-8")
        if NARRATIVE_START in old and NARRATIVE_END in old:
            narrative = old.split(NARRATIVE_START, 1)[1].split(NARRATIVE_END, 1)[0]
    body = format_report(summary, results, models)
    if narrative:
        body += "\n" + NARRATIVE_START + narrative + NARRATIVE_END + "\n"
    REPORT_PATH.write_text(body, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="OKF 跨模型元数据识别实验（重做版）")
    parser.add_argument("--repeats", type=int, default=REPEATS)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--smoke", action="store_true", help="3 条知识各跑 1 次，结果写到 /tmp")
    parser.add_argument("--report-only", action="store_true", help="不调模型，只用已落盘结果重出报告")
    args = parser.parse_args()

    items, repeats, raw_path = ITEMS, args.repeats, RAW_PATH
    if args.smoke:
        items = [it for it in ITEMS if it["id"] in ("refund-review-sla", "payment-timeout", "payment-methods")]
        repeats, raw_path = 1, Path("/tmp/okf_diag/smoke.jsonl")
        raw_path.unlink(missing_ok=True)
    if not args.report_only:
        run(MODELS, ARMS, items, repeats, raw_path, args.workers)
    results = [json.loads(x) for x in raw_path.read_text(encoding="utf-8").splitlines() if x.strip()]
    if args.smoke:
        for r in results:
            print(f"{r['model']:22} {r['arm']:6} {r['item']:20} {r['status']:10} {str(r['verdict']):6} | {r['answer'][:40]}")
        return
    write_report(summarize(results, MODELS), results, MODELS)
    print(f"Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
