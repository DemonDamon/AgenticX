"""长度探测: 分层抽样确定性 + calibration 格式回填 + 断点续跑。"""
import json

import pytest

from agenticx.learning.trajectory.length_probe import (
    append_row, load_existing, stratified_sample, write_summary)
from agenticx.learning.trajectory.train_manifest import collect_durations


def _fake_pool(code=10, cyber=6, other=0):
    return ([f"code-{i:03d}" for i in range(code)]
            + [f"cyber-{i:03d}" for i in range(cyber)]
            + [f"general-{i:03d}" for i in range(other)])


def test_stratified_sample_split_by_domain():
    s = stratified_sample(_fake_pool(), n=8)
    assert len(s["code"]) == 4 and len(s["cyber"]) == 4
    assert set(s) == {"code", "cyber"}


def test_stratified_sample_deterministic():
    pool = _fake_pool(code=30, cyber=20)
    a = stratified_sample(pool, n=10)
    b = stratified_sample(pool, n=10)
    assert a == b


def test_stratified_sample_overflow_when_domain_short():
    """某域不足额由其他域补齐，总量守恒。"""
    s = stratified_sample(_fake_pool(code=2, cyber=10), n=8)
    total = sum(len(v) for v in s.values())
    assert total == 8
    assert len(s["code"]) == 2                    # 不够就全要
    assert len(s["cyber"]) == 4                   # 均分基额
    assert len(s.get("overflow", [])) == 2        # 缺口由溢出补


def test_stratified_sample_more_than_pool():
    s = stratified_sample(_fake_pool(code=3, cyber=2), n=50)
    assert sum(len(v) for v in s.values()) == 5   # 池子就 5 题


def test_append_row_and_resume(tmp_path):
    append_row(tmp_path, model="m", task="code-001", reward=1.0,
               duration_sec=100.0, trial_dir="t1", total_planned=2)
    append_row(tmp_path, model="m", task="code-002", reward=0.0,
               duration_sec=200.0, trial_dir="t2", total_planned=2)
    existing = load_existing(tmp_path)
    assert set(existing) == {"code-001", "code-002"}
    # 再 append 一次同一题 → 覆盖不重复（幂等）
    append_row(tmp_path, model="m", task="code-001", reward=1.0,
               duration_sec=120.0, trial_dir="t1", total_planned=2)
    assert len(load_existing(tmp_path)) == 2


def test_summary_collect_durations_interop(tmp_path):
    """关键契约：probe summary 必须能被 collect_durations 吃进。"""
    append_row(tmp_path, model="m", task="code-001", reward=1.0,
               duration_sec=500.0, trial_dir="t1", total_planned=2)
    append_row(tmp_path, model="m", task="cyber-009", reward=0.0,
               duration_sec=2000.0, trial_dir="t2", total_planned=2)
    # probe 目录要放在 results/ 下才会被 glob 到——直接传根
    root = tmp_path / "results"
    root.mkdir()
    (root / "probe-x").symlink_to(tmp_path)      # summary.json 在 probe-x 下
    d = collect_durations(root)
    assert d["code-001"]["wall_seconds"] == pytest.approx(500.0)
    assert d["cyber-009"]["wall_seconds"] == pytest.approx(2000.0)
    assert d["cyber-009"]["reward"] == 0.0


def test_write_summary_meta(tmp_path):
    p = write_summary(tmp_path, model="m", rows=[], total_planned=3)
    data = json.loads(p.read_text())
    assert data["meta"]["purpose"] == "rsi-length-probe"
    assert "wall_clock_caveat" in data["meta"]   # 跨架构警告必须在场
    assert data["planned"] == 3
