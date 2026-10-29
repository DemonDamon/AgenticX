"""RSI-Index 归一化增益（SP30 补遗 · RSIGym 口径，arXiv:2610.16444 启发）。

gain = (final - initial) / (1 - initial)：同样 +3pp，从 40% 提到 43% 和
从 90% 提到 93% 的"含金量"完全不同——归一化后跨任务/跨版本可比。
边界：initial>=1.0（无提升空间）或 <0（无效基线）返回 None，不造假。
"""
import pytest

from agenticx.learning.rsi_index import rsi_index


def test_typical_gain():
    # 40% → 43%：增益 0.03/0.60 = 0.05（对齐 RSIGym 主表量级）
    assert rsi_index(0.43, 0.40) == pytest.approx(0.05)


def test_harder_when_baseline_high():
    # 同样 +3pp：90% 基线的含金量是 40% 基线的 6 倍
    assert rsi_index(0.93, 0.90) == pytest.approx(0.3)
    assert rsi_index(0.43, 0.40) < rsi_index(0.93, 0.90)


def test_zero_gain_and_regression():
    assert rsi_index(0.40, 0.40) == 0.0
    assert rsi_index(0.30, 0.40) < 0            # 倒退为负值


def test_invalid_baseline_returns_none():
    assert rsi_index(0.5, 1.0) is None          # 无提升空间
    assert rsi_index(0.5, -0.1) is None         # 无效基线


def test_perfect_score():
    assert rsi_index(1.0, 0.4) == pytest.approx(1.0)
