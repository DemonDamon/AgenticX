"""污染率埋点: 干预段 token 占比聚合（playbook §2.5）。"""
import json

import pytest

from agenticx.rl.contamination import ContaminationTracker, contamination_ratio


def test_ratio_basic():
    resp = [1, 1, 1, 1, 0, 0]          # 4 个 response token
    intv = [1, 0, 0, 0, 0, 0]          # 1 个在干预段
    assert contamination_ratio(resp, intv) == pytest.approx(0.25)


def test_ratio_empty_response_is_zero():
    assert contamination_ratio([0, 0, 0], [1, 1, 1]) == 0.0


def test_ratio_length_mismatch_raises():
    with pytest.raises(ValueError, match="长度不一致"):
        contamination_ratio([1, 0], [1, 0, 0])


def test_ratio_perfect_purity():
    assert contamination_ratio([1, 1, 1], [0, 0, 0]) == 0.0


def test_tracker_batch_of_samples_weighted():
    """batch 多 sample：token 加权，不是逐 sample 均值。"""
    t = ContaminationTracker()
    # sample1: 2/2 污染; sample2: 0/6 污染 → 总比 = 2/8 = 0.25
    r1 = t.record(0, [[1, 1], [1, 1, 1, 1, 1, 1]],
                  [[1, 1], [0, 0, 0, 0, 0, 0]])
    assert r1 == pytest.approx(0.25)
    assert t.total_ratio == pytest.approx(0.25)


def test_tracker_token_weighted_total():
    t = ContaminationTracker()
    t.record(0, [1] * 4, [1] * 4)               # 步0: 100% 污染, 4 tok
    t.record(1, [1] * 96, [0] * 96)             # 步1: 0% 污染, 96 tok
    assert t.total_ratio == pytest.approx(4 / 100)   # 加权 ≠ 各步均值 0.5
    assert t.status() == "ok"


def test_tracker_warn_over_threshold():
    t = ContaminationTracker(warn_threshold=0.30)
    t.record(0, [1] * 10, [1] * 5 + [0] * 5)    # 50% > 30%
    assert t.status() == "warn"


def test_tracker_report_and_save(tmp_path):
    t = ContaminationTracker()
    t.record(0, [1, 1, 1, 1], [1, 0, 0, 0])      # 25% < 默认阈值 30%
    p = t.save(tmp_path / "run1" / "contamination.json")
    data = json.loads(p.read_text())
    assert data["status"] == "ok"
    assert data["steps"][0]["ratio"] == pytest.approx(0.25)
    assert data["total_ratio"] == pytest.approx(0.25)


def test_tracker_accepts_torch_like(tmp_path):
    """带 detach/list() 接口的张量对象也能吃（训练侧直接塞 response_mask）。"""
    class FakeTensor:
        def __init__(self, vals):
            self._vals = vals

        def detach(self):
            return self

        def tolist(self):
            return list(self._vals)

    t = ContaminationTracker()
    ratio = t.record(0, FakeTensor([1, 1, 0]), FakeTensor([1, 0, 0]))
    assert ratio == pytest.approx(0.5)
