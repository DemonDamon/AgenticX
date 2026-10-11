# agenticx/rl/harbor_rollout.py
"""HarborRolloutEngine（P1 · M4）：真任务 episode 采集——回放混合 GRPO 的真实侧。

每个 episode = 一次 harbor trial：容器内 agent 由本地模型服务驱动，
verifier 打分；服务请求日志转为可训练段（RolloutSample）。
单租户：一次一个 trial（日志按长度快照分割）。
训练 rollout 建议 temperature_override=1.0（old_logprobs=策略 logp，精确对齐）。
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable

import torch

from .harbor_reward import run_harbor_trial
from .model_server import serve_model
from .rollout import RolloutSample


@dataclass
class Episode:
    """一次任务执行的完整可训练记录。"""
    task: str
    reward: float
    segments: list[RolloutSample] = field(default_factory=list)


class HarborRolloutEngine:
    """管理模型服务生命周期 + trial 执行 + 请求日志→episode 转换。"""

    def __init__(self, lm, tokenizer, *, model_id: str = "openai/agenticx-rl",
                 temperature_override: float | None = 1.0,
                 timeout: float = 1800.0):
        self.lm = lm
        self.tokenizer = tokenizer
        self.model_id = model_id
        self.temperature_override = temperature_override
        self.timeout = timeout
        self._srv = None
        self._log: list = []
        self._last_env: dict[str, str] | None = None

    @property
    def server_port(self) -> int:
        if self._srv is None:
            raise RuntimeError("server 未启动（先调 start()）")
        return self._srv.server_address[1]

    def start(self) -> None:
        if self._srv is not None:
            return
        self._srv = serve_model(self.lm, self.tokenizer,
                                 model_id=self.model_id.split("/", 1)[-1],
                                 log=self._log,
                                 temperature_override=self.temperature_override)
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self._srv is not None:
            self._srv.shutdown()
            self._srv = None

    def _agent_base_url(self) -> str:
        # 容器内经 host.docker.internal 访问宿主机服务（SP12 真机实测）
        return f"http://host.docker.internal:{self.server_port}/v1"

    def run_episode(self, task_path: str, *, trials_dir, timeout: float | None = None,
                    runner: Callable | None = None) -> Episode:
        if self._srv is None:
            self.start()
        mark = len(self._log)                          # 单租户快照分割

        def wrapped_runner(cmd, env, t):
            self._last_env = env
            real = runner if runner is not None else _default_runner
            return real(cmd, env, t)

        reward, _trial_dir = run_harbor_trial(
            task_path, self.model_id, self._agent_base_url(),
            trials_dir=trials_dir, runner=wrapped_runner,
            timeout=timeout or self.timeout)
        segments = [
            RolloutSample(
                prompt_ids=torch.tensor(e.context_ids, dtype=torch.long),
                response_ids=torch.tensor(e.gen_ids, dtype=torch.long),
                old_logprobs=torch.tensor(e.logprobs, dtype=torch.float32))
            for e in self._log[mark:]
        ]
        return Episode(task=task_path, reward=float(reward), segments=segments)


def _default_runner(cmd, env, timeout):
    import subprocess
    subprocess.run(cmd, env=env, timeout=timeout, check=True)
