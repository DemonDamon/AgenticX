#!/usr/bin/env python3
"""Terminal-Bench 2.1 全量对比实验驱动器（断点续跑 + 余额守卫）。

用法:
    python3 run_full.py <harness>          # 续跑该 harness 未完成的任务
    python3 run_full.py <harness> --dry    # 只看还剩多少题

harness ∈ {opencode, pi, agenticx, dsh, hermes}
已完成判定: jobs/<harness>-full*/ 下的 trial 有 result.json 且含 reward 指标
            （报错/无结果的 trial 不算完成，续跑时会自动重试）
"""

import json
import subprocess
import sys
import glob
import os
import argparse
import urllib.request

LAB = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.join(LAB, "jobs")
DATASET = "terminal-bench/terminal-bench-2-1"
MODEL = "deepseek/deepseek-v4-flash"
ALL_TASKS = sorted(
    d for d in os.listdir("/tmp/terminal-bench-2-1")
    if os.path.isdir(f"/tmp/terminal-bench-2-1/{d}")
)
BALANCE_MIN = 10.0  # 低于此值（元）停止，防止数据不完整


def completed_tasks(harness: str) -> set[str]:
    done = set()
    for cfg in glob.glob(f"{JOBS}/{harness}-full*/**/config.json", recursive=True):
        try:
            c = json.load(open(cfg))
        except Exception:
            continue
        if c.get("agent", {}).get("name") != harness:
            continue
        trial_dir = os.path.dirname(cfg)
        rp = os.path.join(trial_dir, "result.json")
        if not os.path.exists(rp):
            continue
        try:
            r = json.load(open(rp))
        except Exception:
            continue
        # verifier_result 存在且无 exception 才算完成（报错的 trial 续跑时重试）；
        # 例外：reward=1.0 的 trial 即使带 exception（如收尾阶段被 OOM 杀）
        # 也视为完成，避免重试浪费。
        if r.get("exception_info") is None and r.get("verifier_result") is not None:
            name = c["task"]["name"].split("/", 1)[1]
            done.add(name)
        else:
            vr = r.get("verifier_result") or {}
            rew = (vr.get("rewards") or {}).get("reward", vr.get("reward", 0))
            if rew == 1.0:
                name = c["task"]["name"].split("/", 1)[1]
                done.add(name)
    return done


def balance() -> float:
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    for line in open(os.path.join(LAB, ".env")):
        if line.startswith("DEEPSEEK_API_KEY="):
            key = line.strip().split("=", 1)[1]
    req = urllib.request.Request(
        "https://api.deepseek.com/user/balance",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.load(resp)
    return float(d["balance_infos"][0]["total_balance"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("harness")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("-n", type=int, default=4, help="并发任务数")
    args = ap.parse_args()

    done = completed_tasks(args.harness)
    remaining = [t for t in ALL_TASKS if t not in done]
    print(f"[{args.harness}] 总 {len(ALL_TASKS)} | 已完成 {len(done)} | 待跑 {len(remaining)}")
    if args.dry:
        for t in remaining:
            print(" ", t)
        return
    if not remaining:
        print(f"[{args.harness}] 全部完成 ✅")
        return

    bal = balance()
    print(f"[余额] ¥{bal:.2f} (下限 ¥{BALANCE_MIN})")
    if bal < BALANCE_MIN:
        print("!! 余额不足，请充值后再续跑")
        sys.exit(2)

    # 找下一个可用的 job 名（断点续跑用新 job 目录，不覆盖旧数据）
    round_no = 1
    while os.path.exists(f"{JOBS}/{args.harness}-full-r{round_no}"):
        round_no += 1
    job_name = f"{args.harness}-full-r{round_no}"

    cmd = [
        "harbor", "run",
        "-d", DATASET,
        "-a", args.harness,
        "-m", MODEL,
        "--env-file", os.path.join(LAB, ".env"),
        "--job-name", job_name,
        "-n", str(args.n),
        "-y",
        "--agent-setup-timeout-multiplier", "6",
        "--agent-timeout-multiplier", "3",
    ]
    # Pi 自定义端点（DeepSeek 等 OpenAI 兼容 API）必须显式声明 api 风格
    if args.harness == "pi":
        cmd += ["--agent-kwarg", "model_api=openai-completions"]
    for t in remaining:
        cmd += ["-i", f"terminal-bench/{t}"]

    print(f"[启动] job={job_name} tasks={len(remaining)} 并发={args.n}")
    print(" ".join(cmd[:12]) + f" ... ({len(remaining)} 个 -i 过滤器)")
    # VPN 代理节点失效（GitHub/Supabase 走代理全挂，直连正常）。
    # httpx 还会读 macOS 系统代理（scutil），故除剥离 *_proxy 外还需 NO_PROXY=* 全局旁路。
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    r = subprocess.run(cmd, cwd=LAB, env=env)
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
