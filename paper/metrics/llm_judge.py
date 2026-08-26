#!/usr/bin/env python3
"""TeamBench LLM-judge 核验器（Artifact Scorer 的 L3 层）。

原则：
- LLM-judge 只占总评分 20%（L1 50% + L2 30% ≥ 80%，LLM-judge 不主导结论）
- 输出 1-5 分 + 评分理由，支持双盲一致性分析
- 评分 rubric 按任务类型有细粒度标准，避免打分漂移
- judge 模型与被测模型不同（被测用 DS V4 Flash，judge 用 DS V4 Pro；可用你给的其他旗舰模型换）

用法：
  from paper.metrics.llm_judge import LLMJudgeScorer
  scorer = LLMJudgeScorer(api_key=key, judge_model="deepseek-v4-pro")
  score, reason = scorer.judge(output, task, mode)

或单独 CLI：
  export DEEPSEEK_API_KEY="..."
  .venv/bin/python paper/metrics/llm_judge.py --task paper/tasks/data/v0.1/t-DOC-L-01.json \
      --artifact paper/experiments/smoke_v0.1/t-DOC-L-01/single_s00.json --mode single
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from openai import OpenAI


# ── 评分 rubric（按 office_type × task_type 差异化） ──────────────

def build_rubric(task: Dict, mode: str) -> str:
    ot = task.get("office_type", "document")
    tt = task.get("task_type", "medium_coupling")

    base = (
        f"你是一名办公任务质量评测专家（Judge）。请从1-5分打分，给出整数分。"
        f"只输出分数和评分理由，格式固定：`Score: X / 5` 开头，换行后给出评分理由。"
        f"打分时只看输出本身，不考虑实现过程。"
    )

    if tt == "low_coupling":
        complexity = "简单任务（低耦合、主要是整合与去重）"
    elif tt == "medium_coupling":
        complexity = "中等任务（流水线分工、需要初步分析）"
    else:
        complexity = "复杂任务（高耦合、需要并行核对或冲突消解）"

    general_criteria = f"""
通用打分标准（适用于所有办公任务）：
- 5分（优秀）：产出完全覆盖要求，结构清晰，无错误，超出预期（例如主动识别了要求里隐含的信息）。
- 4分（良好）：产出基本全部达标，仅有极少（≤1处）无关紧要的小瑕疵，不影响整体可用性。
- 3分（合格）：产出达到核心目标，但有若干遗漏或小错误，需要使用者人工补充。
- 2分（不合格）：产出显著低于期望，关键要求（如核心章节、主要结论、关键数据）缺失或错误。
- 1分（严重不合格）：无法使用，大量空白、与任务无关或胡编乱造。
"""

    type_criteria_map = {
        "document": f"""
文档协作类额外标准（DOC）：
- 章节齐全性：verification.required_sections 是否全部覆盖，章节层次清晰。
- 去重与合并：是否去除了重复内容，合并是否自然。
- 依赖识别 / 冲突识别 / 风险识别：若任务要求，是否具体、数量合理、不泛化。
- 语言风格：符合办公文档规范，不口语化，专业。
""",
        "data": f"""
数据分析类额外标准（DATA）：
- 数值准确性：汇总、差额、核对结果数值是否正确。
- 分类完整性：A有B无 / B有A无 / 数值不一致三类是否各自齐备，条目无遗漏。
- 报告性：如果要求原因/建议分析，是否定量、可执行。
""",
        "project": f"""
项目跟进类额外标准（PROJ）：
- 风险/冲突识别召回：是否把输入中的延期、阻塞、冲突、重叠全部识别出来。
- 建议可执行性：每条缓解/重排建议是否具体（有动作、负责人、时限三要素中至少两者）。
- 结构化：进度、问题、建议分层清晰，易读。
""",
        "cross_dept": f"""
跨部门沟通类额外标准（CROSS）：
- 信息完整性：多部门/多角色的信息是否都被覆盖，有没有遗漏部门侧。
- 角色边界：回复/方案的责任人归属是否准确（客服管客户语、技术管根因等，不越权）。
- 沟通友好：对外回复有礼有节，语气合适；对内工单清晰。
""",
        "content": f"""
内容生产类额外标准（CONTENT）：
- 事实准确性：产品参数/价格/发布时间等事实数据与输入提供的 reference 一致，不胡编。
- 平台适配：抖音有钩子+动作，公众号有小标题分层，演讲稿有核心信息点。
- 文案质量：语言有吸引力，不重复，符合品牌调性（专业有温度）。
""",
    }

    tc = type_criteria_map.get(ot, "")

    V = task.get("verification", {})
    required_hint = ""
    if V.get("required_sections"):
        required_hint += f"\n- 要求必须出现的章节标题：{V['required_sections']}"
    if V.get("required_elements"):
        required_hint += f"\n- 要求必须出现的元素关键词：{V['required_elements']}"
    if V.get("expected_a_only") or V.get("expected_b_only") or V.get("expected_qty_mismatches"):
        required_hint += "\n- 差异项：请检查 A有B无/B有A无/数值不一致 三类是否齐全"
    if V.get("suggestion_count"):
        required_hint += f"\n- 建议条数至少：{V['suggestion_count']}"
    if V.get("tech_qa_count_min") or V.get("biz_qa_count_min"):
        required_hint += f"\n- QA 条数：技术≥{V.get('tech_qa_count_min',0)} 业务≥{V.get('biz_qa_count_min',0)}"

    return f"{base}\n\n任务难度档位：{complexity}\n{general_criteria}\n{tc}\n{required_hint}"


# ── Judge 客户端 ────────────────────────────────────────────────────

class LLMJudgeScorer:
    def __init__(self, api_key: str, base_url: str = "https://api.deepseek.com/v1",
                 judge_model: str = "deepseek-v4-pro", temperature: float = 0.0):
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=180, max_retries=3)
        self.judge_model = judge_model
        self.temperature = temperature

    def judge(self, artifact_output: str, task: Dict, mode: str) -> Tuple[float, str]:
        """返回 (归一化分数 0-1, 评分理由)。原始 1-5 分 → /5。"""
        rubric = build_rubric(task, mode)
        # 截断超长产出（省 token，judge 用前 6000 字足够判断）
        out_trunc = artifact_output[:6000]
        if len(artifact_output) > 6000:
            out_trunc += f"\n...[总长度{len(artifact_output)}字符已截断]"
        user_prompt = (
            f"任务 task_id={task.get('task_id','')}，mode={mode}。\n"
            f"任务描述：{task.get('description','')}\n\n"
            f"---待评判产出---\n{out_trunc}\n---\n\n请严格按 rubric 打分。"
        )
        try:
            resp = self.client.chat.completions.create(
                model=self.judge_model,
                messages=[
                    {"role": "system", "content": rubric},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=self.temperature,
                max_tokens=800,
            )
            text = (resp.choices[0].message.content or "").strip()
        except Exception as e:
            return 0.6, f"[Judge 调用失败 fallback] {e}"

        # 抽取 "Score: X / 5"
        m = re.search(r"Score\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:/\s*5)?", text, re.IGNORECASE)
        if m:
            raw = float(m.group(1))
        else:
            # 备用：找第一个 1-5 的数字
            m = re.search(r"(?<!\d)([1-5])(?!\d)", text)
            raw = int(m.group(1)) if m else 3.0
        score_1_5 = max(1.0, min(5.0, raw))
        return score_1_5 / 5.0, text


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True, help="任务 JSON 路径")
    ap.add_argument("--artifact", required=True, help="产出 JSON 路径（含 output 字段）")
    ap.add_argument("--mode", choices=["single", "team"], default="team")
    ap.add_argument("--api-key", default=os.getenv("DEEPSEEK_API_KEY"))
    ap.add_argument("--judge-model", default="deepseek-v4-pro")
    args = ap.parse_args()

    key = args.api_key or os.getenv("DEEPSEEK_API_KEY")
    if not key:
        print("ERROR: 请设置 DEEPSEEK_API_KEY 或 --api-key"); sys.exit(1)
    task = json.loads(Path(args.task).read_text(encoding="utf-8"))
    artifact = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
    output = artifact.get("output", artifact.get("artifact", ""))

    scorer = LLMJudgeScorer(api_key=key, judge_model=args.judge_model)
    score_norm, reason = scorer.judge(output, task, args.mode)
    print(f"Score normalized: {score_norm:.2f} (raw 1-5: {score_norm*5:.1f})")
    print(f"Judge model: {args.judge_model}")
    print("---理由---")
    print(reason)


if __name__ == "__main__":
    main()
