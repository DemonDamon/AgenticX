#!/usr/bin/env python3
"""P1-6 交叉 LLM-judge:对已完成实验目录的产出批量补 L3 分。

judge 矩阵(避免自评偏见):
  - Flash 产出  → DS V4 Pro 判 (同家族升级判)
  - Kimi K3 产出 → DS V4 Pro 判 (跨厂商)
  - Pro 产出    → Kimi K3  判 (跨厂商)

每条 judge 输出 L3 (0-1)。两轮 judge 算 Spearman 一致性。
L3 ablation: Q_new = Q_old + 0.2*(L3 - 0.6)  (原 Q 中 L3 兜底 0.6)

用法:
  export DEEPSEEK_API_KEY=... KIMI_API_KEY=...
  .venv/bin/python paper/experiments/cross_judge.py                # 全部矩阵
  .venv/bin/python paper/experiments/cross_judge.py --only flash kimi_k3   # 只判 Flash+Kimi
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from openai import OpenAI

TASKS_DIR = ROOT / "paper/tasks/data/v0.1"
JUDGE_OUT_DIR = ROOT / "paper/experiments/judge_v0.1"

DS_URL = "https://api.deepseek.com/v1"
KIMI_URL = "https://api.moonshot.cn/v1"

# 交叉 judge 矩阵
MATRIX = {
    "flash": {
        "exp": "baseline_v0.2b_dsv4flash_v3prompt",
        "model": "deepseek-v4-flash",
        "judge_model": "deepseek-v4-pro",
        "judge_url": DS_URL, "key_env": "DEEPSEEK_API_KEY",
        "rounds": 1, "temperature": 0.0,
    },
    "kimi_k3": {
        "exp": "baseline_v0.4_kimi_k3",
        "model": "kimi-k3",
        "judge_model": "deepseek-v4-pro",
        "judge_url": DS_URL, "key_env": "DEEPSEEK_API_KEY",
        "rounds": 1, "temperature": 0.0,
    },
    "pro": {
        "exp": "baseline_v0.3_pro",
        "model": "deepseek-v4-pro",
        "judge_model": "kimi-k3",
        "judge_url": KIMI_URL, "key_env": "KIMI_API_KEY",
        "rounds": 1, "temperature": 1.0,  # kimi 只允许 1
    },
    "kimi_k26": {
        "exp": "baseline_v0.5_kimi_k26",
        "model": "kimi-k2.6",
        "judge_model": "deepseek-v4-pro",
        "judge_url": DS_URL, "key_env": "DEEPSEEK_API_KEY",
        "rounds": 1, "temperature": 0.0,
    },
    "glm53": {
        "exp": "baseline_v0.6_glm53",
        "model": "glm-5.3",
        "judge_model": "deepseek-v4-pro",
        "judge_url": DS_URL, "key_env": "DEEPSEEK_API_KEY",
        "rounds": 1, "temperature": 0.0,
    },
}


def load_runs(exp_dir: Path):
    """读实验目录 summary(优先 clean),过滤 error,按 (task,mode,seed) 去重取最新。"""
    src = exp_dir / "summary_clean.jsonl"
    if not src.exists():
        src = exp_dir / "summary.jsonl"
    runs = {}
    with open(src, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("error"):
                continue
            runs[(r["task_id"], r["mode"], r["seed"])] = r
    return runs


def load_task(task_id: str):
    p = TASKS_DIR / f"{task_id}.json"
    return json.loads(p.read_text(encoding="utf-8"))


# ── 纯 Python Spearman(避免依赖 scipy) ──────────────────────────
def _rank(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(a, b):
    if len(a) != len(b) or len(a) < 3:
        return float("nan")
    ra, rb = _rank(a), _rank(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    da = math.sqrt(sum((x - ma) ** 2 for x in ra))
    db = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return num / (da * db) if da > 0 and db > 0 else float("nan")


# ── Judge 调用 ──────────────────────────────────────────────────────
def judge_one(client, model, temperature, task, output, mode):
    from paper.metrics.llm_judge import build_rubric
    import re
    rubric = build_rubric(task, mode)
    out_trunc = output[:6000]
    if len(output) > 6000:
        out_trunc += f"\n...[总长度{len(output)}字符已截断]"
    user_prompt = (
        f"任务 task_id={task.get('task_id','')}，mode={mode}。\n"
        f"任务描述：{task.get('description','')}\n\n"
        f"---待评判产出---\n{out_trunc}\n---\n\n请严格按 rubric 打分。"
    )
    last_text = ""
    # 重试 3 次,防空响应/解析失败(推理模型 thinking 会吃 token,content 需大 max_tokens)
    for attempt in range(3):
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": rubric},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=4000,
        )
        msg = resp.choices[0].message
        text = (msg.content or "").strip()
        # 部分推理模型把结论放 reasoning_content,或 content 为空
        if not text:
            rc = getattr(msg, "reasoning_content", None) or ""
            if rc:
                text = rc.strip()
        last_text = text
        m = re.search(r"Score\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:/\s*5)?", text, re.IGNORECASE)
        if not m:
            m = re.search(r"(?<!\d)([1-5])(?!\d)", text)
        if m and text:
            raw = float(m.group(1))
            return max(1.0, min(5.0, raw)) / 5.0, text
        time.sleep(2)
    raise RuntimeError(f"judge 3次重试后仍无有效输出, last_text[:100]={last_text[:100]!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="只跑矩阵里的这些 key(如 flash pro)")
    args = ap.parse_args()

    JUDGE_OUT_DIR.mkdir(parents=True, exist_ok=True)
    results_path = JUDGE_OUT_DIR / "judge_results.jsonl"

    # 断点续跑:跳过已有记录(按 exp_key+task+mode+seed+round)
    done = set()
    if results_path.exists():
        with open(results_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    done.add((r["exp_key"], r["task_id"], r["mode"], r["seed"], r["round"]))
                except Exception:
                    continue

    todo = {k: v for k, v in MATRIX.items() if args.only is None or k in args.only}
    clients = {}
    for key, cfg in todo.items():
        api_key = os.getenv(cfg["key_env"])
        if not api_key:
            print(f"[SKIP] {key}: 环境变量 {cfg['key_env']} 未设置"); continue
        clients[key] = OpenAI(api_key=api_key, base_url=cfg["judge_url"], timeout=120, max_retries=2)

    fout = open(results_path, "a", encoding="utf-8")
    total = 0
    for key, cfg in todo.items():
        if key not in clients:
            continue
        client = clients[key]
        exp_dir = ROOT / "paper/experiments" / cfg["exp"]
        runs = load_runs(exp_dir)
        task_cache = {}
        n = 0
        print(f"\n=== [{key}] 被测={cfg['model']} runs={len(runs)} judge={cfg['judge_model']} rounds={cfg['rounds']} ===")
        for (task_id, mode, seed), r in sorted(runs.items()):
            if task_id not in task_cache:
                task_cache[task_id] = load_task(task_id)
            task = task_cache[task_id]
            output = r.get("output", "") or ""
            if not output.strip():
                continue
            for rd in range(cfg["rounds"]):
                if (key, task_id, mode, seed, rd) in done:
                    continue
                t0 = time.time()
                try:
                    l3, reason = judge_one(client, cfg["judge_model"], cfg["temperature"],
                                           task, output, mode)
                except Exception as e:
                    print(f"  [ERR {task_id} {mode} s{seed} r{rd}] {e}")
                    continue
                rec = {
                    "exp_key": key, "judged_model": cfg["model"],
                    "judge_model": cfg["judge_model"],
                    "task_id": task_id, "mode": mode, "seed": seed,
                    "round": rd, "L3": round(l3, 3),
                    "Q_orig": r.get("Q"),
                    "reason": reason[:300],
                    "elapsed": round(time.time() - t0, 1),
                }
                fout.write(json.dumps(rec, ensure_ascii=False) + "\n")
                fout.flush()
                n += 1; total += 1
                if n % 10 == 0:
                    print(f"  ...{n} judged")
        print(f"  [{key}] 完成 {n} 条 judge")
    fout.close()
    print(f"\n共 {total} 条 judge 结果 → {results_path}")


if __name__ == "__main__":
    main()
