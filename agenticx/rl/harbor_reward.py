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
    """agenticx agent 连模型服务的环境变量（继承当前环境）。

    harbor 的 agenticx_agent.py 读 AGENTICX_* 三元组（model/api_key/base_url,
    见其 L133-138）; OPENAI_* 是本地 model_server 路径的旧约定, 一并保留。
    """
    env = dict(os.environ)
    env["OPENAI_BASE_URL"] = base_url
    env["OPENAI_API_KEY"] = api_key
    env["AGENTICX_BASE_URL"] = base_url
    env["AGENTICX_API_KEY"] = api_key
    return env


# agent setup 持久化缓存（bind mount 宿主目录 → 容器）: qemu 模拟层下
# 每次新容器重装 uv+Python+agenticx 需 30min+, 装一次进缓存后续秒级复用。
# 注意: mounts 走 trial config 的 environment 段——task.toml 的
# [environment] 是 TaskEnvironmentConfig, 不含 mounts 字段（实测被忽略）。
SETUP_CACHE_ROOT = "/tmp/agenticx-setup-cache"
AGENT_SETUP_CACHE_MOUNTS = [
    {"type": "bind", "source": f"{SETUP_CACHE_ROOT}/local",
     "target": "/root/.local"},
    {"type": "bind", "source": f"{SETUP_CACHE_ROOT}/uv-cache",
     "target": "/root/.cache/uv"},
    {"type": "bind", "source": f"{SETUP_CACHE_ROOT}/venv",
     "target": "/root/.agenticx-venv"},
]


def make_trial_config(task_path: str, model_name: str) -> dict[str, Any]:
    """harbor trial config（schema 同 harness-lab/jobs/*/config.json 的子集）。

    task 为 TaskConfig 对象 {"path": ...}——harbor 0.22 TrialConfig 校验拒绝
    字符串形式（真机冒烟实测）。model_name 须带 provider 前缀（如
    "openai/agenticx-rl"，agenticx adapter 按前缀路由 API 风格）。
    override_setup_timeout: 模拟层容器内装 agenticx 依赖较慢, 默认 360s
    实测不够（Apple Silicon qemu 下 uv+pip 首装约 30-40 分钟, 详见
    AGENT_SETUP_CACHE_MOUNTS 的缓存复用方案）。
    """
    return {"task": {"path": task_path},
            "agent": {"name": "agenticx", "model_name": model_name,
                      "override_setup_timeout_sec": 3600},
            "environment": {"type": "docker",
                            "mounts": AGENT_SETUP_CACHE_MOUNTS}}


def extract_reward(trial_dir: Path) -> float:
    """从 trial 目录的 result.json 提取 verifier reward（0.0/1.0）。"""
    p = Path(trial_dir) / "result.json"
    if not p.exists():
        raise FileNotFoundError(f"缺少 result.json: {p}")
    r = json.loads(p.read_text())
    return float(r["verifier_result"]["rewards"]["reward"])


def run_harbor_trial(task_path: str, model_name: str, base_url: str, *,
                     trials_dir: Path, runner: Callable | None = None,
                     timeout: float = 1800.0,
                     api_key: str | None = None) -> tuple[float, Path]:
    """起一个 harbor trial 并返回 (reward, trial_dir)。

    runner 注入点供测试 mock；真实路径 = subprocess `harbor trial start`。
    trials_dir 下取 mtime 最新的含 result.json 的子目录为本次 trial。
    api_key: 远端 API（如 aibox 网关）须显式传; 本地 model_server 走默认。
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
    runner(cmd, make_agent_env(base_url, api_key or os.environ.get(
        "OPENAI_API_KEY", "dummy")), timeout)

    candidates = [d for d in trials_dir.iterdir()
                  if d.is_dir() and (d / "result.json").exists()]
    if not candidates:
        raise RuntimeError(f"harbor trial 未产出 result.json（{trials_dir}）")
    trial_dir = max(candidates, key=lambda d: d.stat().st_mtime)
    return extract_reward(trial_dir), trial_dir
