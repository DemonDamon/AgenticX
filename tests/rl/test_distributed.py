# tests/rl/test_distributed.py
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

from agenticx.rl.distributed import (
    DistInfo, all_reduce_mean, barrier, gather_objects, init_distributed,
    is_main, parse_dist_env, shutdown,
)

_REPO = Path(__file__).resolve().parents[2]
_WORKER = Path(__file__).resolve().parent / "_dist_worker.py"


def test_parse_dist_env_absent(monkeypatch):
    monkeypatch.delenv("WORLD_SIZE", raising=False)
    assert parse_dist_env() is None


def test_parse_dist_env_single(monkeypatch):
    monkeypatch.setenv("WORLD_SIZE", "1")
    assert parse_dist_env() is None


def test_parse_dist_env_multi(monkeypatch):
    monkeypatch.setenv("WORLD_SIZE", "4")
    monkeypatch.setenv("RANK", "3")
    monkeypatch.delenv("LOCAL_RANK", raising=False)
    assert parse_dist_env() == (3, 4, 3)          # LOCAL_RANK 缺省回退 rank%world
    monkeypatch.setenv("LOCAL_RANK", "1")
    assert parse_dist_env() == (3, 4, 1)


def test_helpers_noop_when_single_process():
    d = DistInfo(0, 1, 0, False, None)
    assert is_main(d)
    assert all_reduce_mean(3.5, d) == 3.5
    assert gather_objects({"a": 1}, d) == [{"a": 1}]
    barrier(d)          # 不炸
    shutdown(d)         # 不炸


def test_init_distributed_single_process(monkeypatch):
    monkeypatch.delenv("WORLD_SIZE", raising=False)
    d = init_distributed(backend="gloo")
    assert (d.rank, d.world_size, d.distributed) == (0, 1, False)


def test_two_process_gloo_gate(tmp_path):
    """真·双进程分布式门: 子进程走 env→init_process_group→通信→shutdown 全链路
    （与 torchrun 注入的环境变量路径完全一致）。"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    out = tmp_path / "result.json"
    env = {**os.environ, "WORLD_SIZE": "2", "MASTER_ADDR": "127.0.0.1",
           "MASTER_PORT": str(port)}
    procs = []
    for rank in (0, 1):
        procs.append(subprocess.Popen(
            [sys.executable, str(_WORKER), "--out", str(out)],
            env={**env, "RANK": str(rank), "LOCAL_RANK": str(rank)},
            cwd=str(_REPO), stdout=subprocess.PIPE, stderr=subprocess.PIPE))
    for p in procs:
        _, err = p.communicate(timeout=180)
        assert p.returncode == 0, err.decode()
    data = json.loads(out.read_text())
    assert data["mean_rank"] == 0.5                     # all_reduce_mean(0,1)=0.5
    assert data["gathered"] == [{"rank": 0}, {"rank": 1}]
    assert data["world_size"] == 2 and data["backend"] == "gloo"
