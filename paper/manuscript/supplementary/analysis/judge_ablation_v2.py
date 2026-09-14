#!/usr/bin/env python3
"""L3 judge 子样本消融（pilot v2 双模型，离线补打分，不重新生成产出）。

设计：
- 样本：15 任务 × seed 0 × 7 臂，两个 pilot（Flash / K3）各 105 runs，共 210。
- 交叉家族 judging（避免同家族偏见）：
    Flash 产出 → kimi-k3 判（Moonshot 端点）
    K3 产出   → deepseek-v4-pro 判（DeepSeek 端点）
- 每条 run 判 2 轮（round 0/1，独立采样），供 test-retest 一致性分析。
- Q_on = 0.5·L1 + 0.3·L2 + 0.2·L3（L1/L2 取自 run JSON 的 detail，L3 为新判分）。
- 断点续跑：结果增量写入 judge_v2_results.jsonl，重跑自动跳过已完成条目。
- 余额守卫：开始前检查两账户，任一低于 ¥5 直接退出。

用法：
  .venv/bin/python paper/experiments/v2/judge_ablation_v2.py run     # 打分
  .venv/bin/python paper/experiments/v2/judge_ablation_v2.py analyze # 分析
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent  # repo root
sys.path.insert(0, str(ROOT))

from paper.metrics.llm_judge import LLMJudgeScorer  # noqa: E402

MOONSHOT_KEY = os.getenv("MOONSHOT_API_KEY", "")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "")

PILOTS = {
    "flash": ROOT / "paper/experiments/v2/pilot_flash_v2",
    "kimi_k3": ROOT / "paper/experiments/v2/pilot_kimi_k3",
}
TASKS_DIR = ROOT / "paper/tasks/data/v0.1"
ARMS = ["single", "single_refine_k", "single_bon_k",
        "team_last", "team_concat", "team_integrator", "team_blackboard"]
SEED = 0
ROUNDS = 2
RESULT_FILE = ROOT / "paper/experiments/v2/judge_v2_results.jsonl"

# 交叉家族 judge 配置：exp_key -> (judge_scorer 构造参数)
# kimi-k3 只允许 temperature=1（Moonshot 端点限制），双轮独立采样正好用于一致性分析
JUDGE_CONFIG = {
    "flash": dict(api_key=MOONSHOT_KEY, base_url="https://api.moonshot.cn/v1",
                  judge_model="kimi-k3", max_tokens=4000, temperature=1.0),
    "kimi_k3": dict(api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com/v1",
                    judge_model="deepseek-v4-pro", max_tokens=4000, temperature=0.0),
}


def check_balances(min_cny: float = 5.0) -> None:
    for name, url, key in [
        ("Moonshot", "https://api.moonshot.cn/v1/users/me/balance", MOONSHOT_KEY),
        ("DeepSeek", "https://api.deepseek.com/user/balance", DEEPSEEK_KEY),
    ]:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        if name == "Moonshot":
            bal = data["data"]["available_balance"]
        else:
            bal = float(data["balance_infos"][0]["total_balance"])
        print(f"  [{name}] 余额 ¥{bal:.2f}")
        if bal < min_cny:
            print(f"  ⛔ {name} 余额低于 ¥{min_cny}，停止。")
            sys.exit(1)


def load_sample():
    """返回 [(exp_key, task_id, mode, run_path)]，共 210 条。"""
    items = []
    for exp_key, pilot in PILOTS.items():
        for tf in sorted(TASKS_DIR.glob("t-*.json")):
            task_id = tf.stem
            for mode in ARMS:
                run_path = pilot / task_id / f"{mode}_s{SEED:02d}.json"
                if run_path.exists():
                    items.append((exp_key, task_id, mode, run_path))
    return items


def run_judging():
    print("[L3 消融] 余额检查：")
    check_balances()

    items = load_sample()
    print(f"[L3 消融] 样本 {len(items)} runs × {ROUNDS} 轮 = "
          f"{len(items)*ROUNDS} 次 judge 调用")

    # 断点续跑：已完成的 (exp,task,mode,round) 跳过
    done = set()
    if RESULT_FILE.exists():
        for line in RESULT_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                done.add((d["exp_key"], d["task_id"], d["mode"], d["round"]))
    print(f"[L3 消融] 已完成 {len(done)} 条，跳过。")

    # LLMJudgeScorer 已支持 max_tokens 参数（推理型 judge 需 4000 防止 thinking 吃满）
    scorers = {k: LLMJudgeScorer(**cfg) for k, cfg in JUDGE_CONFIG.items()}

    tasks_cache = {tf.stem: json.loads(tf.read_text(encoding="utf-8"))
                   for tf in TASKS_DIR.glob("t-*.json")}

    def judge_one(args):
        exp_key, task_id, mode, round_id = args
        run_path = PILOTS[exp_key] / task_id / f"{mode}_s{SEED:02d}.json"
        run = json.loads(run_path.read_text(encoding="utf-8"))
        task = tasks_cache[task_id]
        t0 = time.time()
        score, reason = scorers[exp_key].judge(run["output"], task,
                                               "team" if mode.startswith("team") else "single")
        return dict(exp_key=exp_key, task_id=task_id, mode=mode, seed=SEED,
                    round=round_id, L3=score, reason=reason[:500],
                    judge_model=JUDGE_CONFIG[exp_key]["judge_model"],
                    elapsed=round(time.time()-t0, 1))

    todo = []
    for exp_key, task_id, mode, _ in items:
        for r in range(ROUNDS):
            if (exp_key, task_id, mode, r) not in done:
                todo.append((exp_key, task_id, mode, r))
    print(f"[L3 消融] 待打分 {len(todo)} 条，4 并发执行...")

    n_ok = n_err = 0
    t_start = time.time()
    with open(RESULT_FILE, "a", encoding="utf-8") as fout, \
            ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(judge_one, a): a for a in todo}
        for fut in as_completed(futures):
            a = futures[fut]
            try:
                rec = fut.result()
                fout.write(json.dumps(rec, ensure_ascii=False) + "\n")
                fout.flush()
                n_ok += 1
            except Exception as e:
                n_err += 1
                print(f"  [ERR] {a}: {e}")
            if (n_ok + n_err) % 20 == 0:
                rate = (n_ok + n_err) / (time.time() - t_start) * 60
                print(f"  进度 {n_ok+n_err}/{len(todo)}  "
                      f"({rate:.0f} 条/分钟, 失败 {n_err})")

    print(f"[L3 消融] 完成：成功 {n_ok}，失败 {n_err}，结果 -> {RESULT_FILE}")
    print("[L3 消融] 余额复查：")
    check_balances(min_cny=0.0)


def analyze():
    import numpy as np
    from collections import defaultdict

    # 1) judge test-retest 一致性
    by = defaultdict(dict)
    for line in RESULT_FILE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        by[(d["exp_key"], d["task_id"], d["mode"])][d["round"]] = d["L3"]
    print("=" * 64)
    print("分析 1: judge 双轮一致性（round0 vs round1，同 run 独立判分）")
    for exp_key in ["flash", "kimi_k3"]:
        pairs = [(v[0], v[1]) for (k, t, m), v in by.items()
                 if k == exp_key and 0 in v and 1 in v]
        if len(pairs) >= 5:
            a = [p[0] for p in pairs]; b = [p[1] for p in pairs]
            exact = sum(1 for x, y in zip(a, b) if abs(x-y) < 1e-9)
            mad = sum(abs(x-y) for x, y in zip(a, b)) / len(a)
            # Spearman
            def rank(x):
                order = sorted(range(len(x)), key=lambda i: x[i])
                r = [0]*len(x); i = 0
                while i < len(order):
                    j = i
                    while j+1 < len(order) and x[order[j+1]] == x[order[i]]:
                        j += 1
                    avg = (i+j)/2 + 1
                    for k2 in range(i, j+1):
                        r[order[k2]] = avg
                    i = j+1
                return r
            ra, rb = rank(a), rank(b)
            ma, mb = sum(ra)/len(ra), sum(rb)/len(rb)
            num = sum((ra[i]-ma)*(rb[i]-mb) for i in range(len(a)))
            den = (sum((r-ma)**2 for r in ra)*sum((r-mb)**2 for r in rb))**0.5
            rho = num/den if den else 1.0
            print(f"  {exp_key}: n={len(pairs)} 完全一致={exact}/{len(pairs)} "
                  f"平均绝对差={mad:.3f} Spearman={rho:.3f}")

    # 2) 臂排序稳定性：Q_off（L1/L2 重归一化）vs Q_on（+20% L3）
    print()
    print("=" * 64)
    print("分析 2: 臂排序稳定性（7 臂 Q 均值，L3 off vs on）")
    print("  Q_off = (0.5·L1+0.3·L2)/0.8   Q_on = 0.5·L1+0.3·L2+0.2·L3(round0)")
    L3r0 = {k: v[0] for k, v in by.items() if 0 in v}
    for exp_key, pilot in PILOTS.items():
        q_off = defaultdict(list); q_on = defaultdict(list)
        for tf in sorted(TASKS_DIR.glob("t-*.json")):
            task_id = tf.stem
            for mode in ARMS:
                rp = pilot / task_id / f"{mode}_s{SEED:02d}.json"
                if not rp.exists():
                    continue
                run = json.loads(rp.read_text(encoding="utf-8"))
                det = run.get("detail") or {}
                L1, L2 = det.get("L1"), det.get("L2")
                if L1 is None or L2 is None:
                    continue
                q_off[mode].append((0.5*L1 + 0.3*L2) / 0.8)
                l3 = L3r0.get((exp_key, task_id, mode))
                if l3 is not None:
                    q_on[mode].append(0.5*L1 + 0.3*L2 + 0.2*l3)

        def means(d):
            return {m: float(np.mean(v)) for m, v in d.items() if v}

        m_off, m_on = means(q_off), means(q_on)
        arms_common = [a for a in ARMS if a in m_off and a in m_on]
        rank_off = sorted(arms_common, key=lambda a: -m_off[a])
        rank_on = sorted(arms_common, key=lambda a: -m_on[a])

        def rank(x):
            order = sorted(range(len(x)), key=lambda i: x[i])
            r = [0]*len(x); i = 0
            while i < len(order):
                j = i
                while j+1 < len(order) and x[order[j+1]] == x[order[i]]:
                    j += 1
                avg = (i+j)/2 + 1
                for k2 in range(i, j+1):
                    r[order[k2]] = avg
                i = j+1
            return r
        a_off = [m_off[a] for a in arms_common]; a_on = [m_on[a] for a in arms_common]
        ra, rb = rank(a_off), rank(a_on)
        ma, mb = sum(ra)/len(ra), sum(rb)/len(rb)
        num = sum((ra[i]-ma)*(rb[i]-mb) for i in range(len(a_off)))
        den = (sum((r-ma)**2 for r in ra)*sum((r-mb)**2 for r in rb))**0.5
        rho = num/den if den else 1.0

        print(f"\n  [{exp_key}] Spearman(arm Q, off↔on) = {rho:.3f}")
        print(f"  {'arm':<20}{'Q_off':>8}{'Q_on':>8}{'Δ':>8}")
        for a in ARMS:
            if a in m_off and a in m_on:
                print(f"  {a:<20}{m_off[a]:>8.3f}{m_on[a]:>8.3f}"
                      f"{m_on[a]-m_off[a]:>+8.3f}")
        print(f"  排序 off: {' > '.join(rank_off)}")
        print(f"  排序 on : {' > '.join(rank_on)}")
        top2_preserved = set(rank_on[:2]) == set(rank_off[:2])
        print(f"  Top-2 保持: {'✅' if top2_preserved else '❌'}   "
              f"integrator 仍居首: {'✅' if rank_on[0]=='team_integrator' else '❌'}")

        # 3) CTR_matched on/off
        ref_off = m_off.get("single_refine_k"); ref_on = m_on.get("single_refine_k")
        print(f"  CTR_matched(integrator): off={m_off['team_integrator']/ref_off:.3f}"
              f"  on={m_on['team_integrator']/ref_on:.3f}")
        print(f"  CTR_matched(last):       off={m_off['team_last']/ref_off:.3f}"
              f"  on={m_on['team_last']/ref_on:.3f}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        run_judging()
    elif cmd == "analyze":
        analyze()
    else:
        print(__doc__)
