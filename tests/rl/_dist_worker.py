# tests/rl/_dist_worker.py
#!/usr/bin/env python3
"""双进程分布式门的 worker（非测试文件，pytest 不收集）。

由 test_distributed.py 以独立进程启动（模拟 torchrun 注入的 env），
走 init_distributed → 通信 → shutdown 真实链路，结果写 JSON。
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agenticx.rl.distributed import (  # noqa: E402
    all_reduce_mean, barrier, gather_objects, init_distributed, shutdown,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--backend", default="gloo")
    args = ap.parse_args()
    try:
        d = init_distributed(backend=args.backend)
        mean_rank = all_reduce_mean(float(d.rank), d)
        gathered = gather_objects({"rank": d.rank}, d)
        barrier(d)
        result = {"rank": d.rank, "world_size": d.world_size,
                  "backend": d.backend, "mean_rank": mean_rank,
                  "gathered": gathered}
        if d.rank == 0:
            Path(args.out).write_text(json.dumps(result))
        barrier(d)
        shutdown(d)
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
