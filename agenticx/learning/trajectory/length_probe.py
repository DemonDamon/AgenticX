# agenticx/learning/trajectory/length_probe.py
"""长度探测（playbook §2.4）：unmeasured 任务分层抽样 + calibration 格式回填。

3686 题无实测墙钟，short 层只有 4 题——不补测就开训，GRPO step 会被长尾
拖死（playbook §3.3：全混采 3.4h/step vs short 配方 17min/step）。

产出与 results/calibration-*/summary.json 同构（collect_durations 直接
glob results/*/summary.json 吃进来），回填后重跑 build_rsi_manifest.py 即可。

重要口径：墙钟与宿主机强相关。Apple Silicon qemu 容器比 x86 慢数倍，
本机探测的墙钟不能用于服务器训练的分层阈值——探测必须在目标机
（或同架构机器）上跑，summary 里记 host 元数据以备审计。
"""
from __future__ import annotations

import json
import platform
import random
import time
from pathlib import Path

SAMPLE_SEED = "rsi-length-probe-v1"


def stratified_sample(unmeasured: list[str], *, n: int = 200,
                      domains: tuple[str, ...] = ("code", "cyber"),
                      seed: str = SAMPLE_SEED) -> dict[str, list[str]]:
    """按域前缀分层抽样（域内确定性打乱），不足额由其他域补齐。

    code-/cyber- 前缀是任务池约定（task_split.py 注释）；无前缀的归
    "other"。n 按域均分，某域不足时剩余名额摊给够的域。
    """
    by_domain: dict[str, list[str]] = {}
    for task in unmeasured:
        dom = next((d for d in domains if task.startswith(f"{d}-")), "other")
        by_domain.setdefault(dom, []).append(task)
    for dom in by_domain:
        random.Random(f"{seed}-{dom}").shuffle(by_domain[dom])

    n_domains = len(by_domain) or 1
    quota = {d: n // n_domains for d in by_domain}
    remain = n - sum(quota.values())
    for d in by_domain:                         # 余数给前面的域
        if remain <= 0:
            break
        quota[d] += 1
        remain -= 1

    out: dict[str, list[str]] = {}
    leftover: list[str] = []
    for dom, tasks in by_domain.items():
        take = min(quota.get(dom, 0), len(tasks))
        out[dom] = tasks[:take]
        leftover.extend(tasks[take:])
    # 某域不够 → 从其他域的剩余里按序补齐，总量尽量到 n
    rng = random.Random(seed)
    rng.shuffle(leftover)
    deficit = n - sum(len(v) for v in out.values())
    if deficit > 0 and leftover:
        out.setdefault("overflow", [])
        out["overflow"].extend(leftover[:deficit])
    return out


def probe_summary_path(out_dir: str | Path) -> Path:
    return Path(out_dir) / "summary.json"


def load_existing(out_dir: str | Path) -> dict:
    """断点续跑：读已有 summary，返回 {task: row}。"""
    p = probe_summary_path(out_dir)
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    return {row["task"]: row for row in data.get("rows", [])}


def write_summary(out_dir: str | Path, *, model: str, rows: list[dict],
                  total_planned: int, host_note: str = "") -> Path:
    """写 calibration 同构 summary.json（collect_durations 直接可吃）。"""
    passed = sum(1 for r in rows if r.get("reward", 0) >= 1.0)
    summary = {
        "model": model,
        "n_tasks": len(rows),
        "rounds": 1,
        "pass_rate": round(passed / len(rows), 4) if rows else 0.0,
        "passed": passed,
        "total": len(rows),
        "planned": total_planned,
        "rows": rows,
        "meta": {
            "purpose": "rsi-length-probe",
            "host": f"{platform.system()}/{platform.machine()}",
            "arch": platform.machine(),
            "note": host_note or "墙钟与宿主机架构强相关，勿跨架构复用阈值",
            "wall_clock_caveat": "probe 墙钟仅对同架构宿主机有效",
            "written_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
    }
    p = probe_summary_path(out_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    return p


def append_row(out_dir: str | Path, *, model: str, task: str,
               reward: float, duration_sec: float, trial_dir: str,
               total_planned: int) -> None:
    """每完成一题就落盘一次（进程被杀最多丢当前题，已完成的都在）。"""
    existing = load_existing(out_dir)
    existing[task] = {"task": task, "round": 1, "reward": float(reward),
                      "duration_sec": round(float(duration_sec), 1),
                      "trial_dir": str(trial_dir)}
    rows = sorted(existing.values(), key=lambda r: r["task"])
    write_summary(out_dir, model=model, rows=rows, total_planned=total_planned)
