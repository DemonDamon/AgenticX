# agenticx/rl/harbor_reward.py
"""harbor 任务 reward 适配（P1 · M3）：RSI 任务 → GRPO reward 信号。

通路: 训练中 LM（model_server OpenAI 兼容服务）← agenticx agent
      （OPENAI_BASE_URL）→ harbor trial（容器任务+verifier）→ result.json。
M4 的 HarborRolloutEngine 将把本模块接入 GRPOTrainer 的 reward_fn。
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Callable


def make_agent_env(base_url: str, api_key: str = "dummy") -> dict[str, str]:
    """agenticx agent 连本地模型服务的环境变量（继承当前环境）。"""
    env = dict(os.environ)
    env["OPENAI_BASE_URL"] = base_url
    env["OPENAI_API_KEY"] = api_key
    return env


def make_trial_config(task_path: str, model_name: str) -> dict[str, Any]:
    """harbor trial config（schema 同 harness-lab/jobs/*/config.json 的子集）。"""
    return {"task": task_path,
            "agent": {"name": "agenticx", "model_name": model_name}}


def extract_reward(trial_dir: Path) -> float:
    """从 trial 目录的 result.json 提取 verifier reward（0.0/1.0）。"""
    p = Path(trial_dir) / "result.json"
    if not p.exists():
        raise FileNotFoundError(f"缺少 result.json: {p}")
    r = json.loads(p.read_text())
    return float(r["verifier_result"]["rewards"]["reward"])


def run_harbor_trial(task_path: str, model_name: str, base_url: str, *,
                     trials_dir: Path, runner: Callable | None = None,
                     timeout: float = 1800.0) -> tuple[float, Path]:
    """起一个 harbor trial 并返回 (reward, trial_dir)。

    runner 注入点供测试 mock；真实路径 = subprocess `harbor trial start`。
    trials_dir 下取 mtime 最新的含 result.json 的子目录为本次 trial。
    """
    trials_dir = Path(trials_dir)
    trials_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = trials_dir / "config.json"
    cfg_path.write_text(json.dumps(make_trial_config(task_path, model_name)))

    cmd = ["harbor", "trial", "start", "-p", task_path, "-c", str(cfg_path),
           "--trials-dir", str(trials_dir)]
    if runner is None:
        def runner(cmd, env, timeout):              # noqa: F811
            subprocess.run(cmd, env=env, timeout=timeout, check=True)
    runner(cmd, make_agent_env(base_url), timeout)

    candidates = [d for d in trials_dir.iterdir()
                  if d.is_dir() and (d / "result.json").exists()]
    if not candidates:
        raise RuntimeError(f"harbor trial 未产出 result.json（{trials_dir}）")
    trial_dir = max(candidates, key=lambda d: d.stat().st_mtime)
    return extract_reward(trial_dir), trial_dir
