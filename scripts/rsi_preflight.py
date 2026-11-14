#!/usr/bin/env python3
"""RSI 开训前自检（在训练服务器上跑，本机也可跑）。

    python3 scripts/rsi_preflight.py

检查四类：
1. 算力：GPU 型号/数量/显存、compute capability（B300 = sm_103）；
2. 框架：torch / vllm 可导入，版本与 sm 匹配；
3. 数据：任务池、held-out 隔离、manifest 是否存在且无交叉；
4. 环境：磁盘余量。

任一项 FAIL → 退出码 1。WARN 不影响退出码。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
results: list[tuple[str, str, str]] = []


def add(level: str, item: str, detail: str) -> None:
    results.append((level, item, detail))


def check_gpu() -> None:
    try:
        import torch
    except ImportError:
        add("FAIL", "torch", "未安装")
        return
    if not torch.cuda.is_available():
        add("FAIL", "CUDA", "torch.cuda 不可用")
        return
    n = torch.cuda.device_count()
    names = {torch.cuda.get_device_name(i) for i in range(n)}
    caps = {f"sm_{''.join(map(str, torch.cuda.get_device_capability(i)))}" for i in range(n)}
    total = sum(torch.cuda.get_device_properties(i).total_memory for i in range(n)) / 1024**3
    add("PASS" if n >= 8 else "WARN", "GPU",
        f"{n} 卡 · {','.join(sorted(names))} · {','.join(sorted(caps))} · 合计 {total:.0f}GB")
    if any(c in caps for c in ("sm_103", "sm_100")):
        add("WARN", "Blackwell", "sm_10x 需要较新 CUDA/vLLM 轮子，先验一次前向")


def check_vllm() -> None:
    try:
        import vllm

        add("PASS", "vllm", getattr(vllm, "__version__", "unknown"))
    except ImportError:
        add("WARN", "vllm", "未安装（rollout 侧需要）")


def check_data() -> None:
    pool = ROOT / "datasets/task_pool.json"
    split = ROOT / "datasets/task_split.json"
    manifest = ROOT / "datasets/rsi/manifest.json"
    if not pool.exists():
        add("FAIL", "任务池", "缺 datasets/task_pool.json")
        return
    n = len(json.loads(pool.read_text()).get("tasks", []))
    add("PASS" if n > 0 else "FAIL", "任务池", f"{n} 题")
    if not split.exists():
        add("FAIL", "拆分", "缺 datasets/task_split.json")
        return
    heldout = set(json.loads(split.read_text())["heldout"])
    if not manifest.exists():
        add("WARN", "manifest", "未生成，先跑 scripts/build_rsi_manifest.py")
        return
    m = json.loads(manifest.read_text())
    overlap = heldout & {t.split("/")[-1] for t in m.get("train", [])}
    add("FAIL" if overlap else "PASS", "held-out 隔离",
        f"交叉 {len(overlap)} 题" if overlap else "训练/评测无交叉")
    s = m["summary"]
    add("PASS" if s["short"] > 0 else "WARN", "分层",
        f"short={s['short']} medium={s['medium']} long={s['long']} "
        f"未实测={s['unmeasured']}")


def check_disk() -> None:
    usage = shutil.disk_usage(ROOT)
    free_tb = usage.free / 1024**4
    add("PASS" if free_tb > 0.5 else "WARN", "磁盘", f"剩余 {free_tb:.1f} TB")


def main() -> int:
    check_gpu()
    check_vllm()
    check_data()
    check_disk()
    width = max(len(i) for _, i, _ in results)
    for level, item, detail in results:
        print(f"[{level:4}] {item.ljust(width)}  {detail}")
    return 1 if any(level == "FAIL" for level, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
