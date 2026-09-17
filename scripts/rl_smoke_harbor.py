#!/usr/bin/env python3
"""RSI 任务 reward 通路冒烟（P1 · M3）：本地模型服务 → harbor trial → verifier reward。

用法:
  python3 scripts/rl_smoke_harbor.py --dry                 # 只验证 server 连通+config
  python3 scripts/rl_smoke_harbor.py --task harness-lab/terminal-bench/<task> [--model Qwen/Qwen3-0.6B]
PASS 标准: dry = server 响应 /v1/models 与 chat completion；真跑 = 拿到 0/1 reward
（未训过的模型 reward=0 属预期，本门只证通路；学习曲线证据属 M4）。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.harbor_reward import run_harbor_trial  # noqa: E402
from agenticx.rl.model_server import serve_model  # noqa: E402


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=60) as r:
        return json.loads(r.read())


def _chat(port, model_id):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions", method="POST",
        data=json.dumps({"model": model_id, "max_tokens": 8,
                         "temperature": 0.0,
                         "messages": [{"role": "user", "content": "Say hi"}]}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def _harbor_runner(cmd, env, timeout):
    """真实 runner（schema 规范化已下沉到 make_trial_config，此处直跑）。"""
    subprocess.run(cmd, env=env, timeout=timeout, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default=None,
                    help="terminal-bench 任务目录（真跑模式必填）")
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--dry", action="store_true",
                    help="只验证模型服务连通，不起容器")
    ap.add_argument("--trials-dir", default="/tmp/agenticx_rl_harbor_smoke")
    ap.add_argument("--timeout", type=float, default=1800.0)
    args = ap.parse_args()

    if not args.dry and not args.task:
        print("[smoke-harbor] FAIL: 真跑模式需要 --task（或用 --dry）")
        return 1

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device()
    print(f"[smoke-harbor] device={info.kind} model={args.model} dry={args.dry}")
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(args.model)
    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=info.torch_device)
    srv = serve_model(lm, tok, model_id="agenticx-rl")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    print(f"[smoke-harbor] server up on 127.0.0.1:{port} "
          f"(load {time.time() - t0:.1f}s)")

    try:
        models = _get(port, "/v1/models")
        assert models["data"][0]["id"] == "agenticx-rl"
        content = _chat(port, "agenticx-rl")
        print(f"[smoke-harbor] /v1/models ok; chat completion: {content!r}")
        if args.dry:
            print("[smoke-harbor] PASS (dry: server 连通)")
            return 0

        # agent 在任务容器内运行：model_name 需 provider/model 格式（harbor
        # agenticx adapter 要求），base_url 需 host.docker.internal（容器内
        # 127.0.0.1 不可达宿主机；dry 探测在宿主机侧仍走 127.0.0.1）。
        reward, trial_dir = run_harbor_trial(
            args.task, "openai/agenticx-rl", f"http://host.docker.internal:{port}/v1",
            trials_dir=Path(args.trials_dir), runner=_harbor_runner,
            timeout=args.timeout)
        print(f"[smoke-harbor] trial={trial_dir.name} reward={reward}")
        print(f"[smoke-harbor] PASS (reward 通路打通: verifier={reward})")
        return 0
    finally:
        srv.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
