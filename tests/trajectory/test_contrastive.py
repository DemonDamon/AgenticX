# tests/trajectory/test_contrastive.py
"""对比式经验提取（SP17 · ModularRSI 对比蒸馏同构）：
失败组独有报错 = 系统缺陷信号; 两组共通报错 = 任务难度, 排除。"""
from agenticx.learning.trajectory.memory import extract_contrastive_lessons

FAIL_A = [
    [{"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
     {"role": "tool", "content": "error: TimeoutError: npm install timed out"}],
    [{"role": "tool", "content": "error: TimeoutError: npm install timed out"}],
]
PASS_A = [
    [{"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
     {"role": "tool", "content": "ok"}],          # 成功组也有 FileNotFound → 任务难度
]


def test_contrastive_excludes_task_difficulty_errors():
    lessons = extract_contrastive_lessons("t1", pass_messages_list=PASS_A,
                                          fail_messages_list=FAIL_A)
    contents = " | ".join(l.content for l in lessons)
    assert "TimeoutError" in contents            # 失败组独有 → 缺陷信号
    assert "FileNotFoundError" not in contents    # 两组共通 → 排除


def test_contrastive_counts_trajectory_coverage():
    lessons = extract_contrastive_lessons("t1", PASS_A, FAIL_A)
    top = lessons[0]
    assert top.kind == "contrastive_failure"
    assert "×2" in top.content                   # 2/2 失败轨迹都犯 → 排第一
    assert top.task_id == "t1" and top.source == "rule"


def test_contrastive_requires_both_groups():
    assert extract_contrastive_lessons("t1", [], FAIL_A) == []
    assert extract_contrastive_lessons("t1", PASS_A, []) == []


def test_contrastive_all_shared_yields_nothing():
    only_shared = [[{"role": "tool",
                     "content": "error: FileNotFoundError: config.yaml"}]]
    assert extract_contrastive_lessons("t1", only_shared, only_shared) == []


def test_contrastive_error_type_level_matching():
    # 消息不同但异常类型相同 → 视为同一模式（成功组出现过即排除）
    fail = [[{"role": "tool", "content": "error: FileNotFoundError: /a.yaml"}]]
    pass_ = [[{"role": "tool", "content": "error: FileNotFoundError: /b.yaml"}]]
    assert extract_contrastive_lessons("t1", pass_, fail) == []


def test_contrastive_caps_lessons():
    many_fail = [[{"role": "tool", "content": f"error: RuntimeError: r{i}"}]
                 for i in range(6)]
    assert len(extract_contrastive_lessons("t1", PASS_A, many_fail)) == 3


# --- SP17 T2: 轨迹级对比挖掘 ---
from agenticx.learning.trajectory.memory import (
    contrastive_lessons_from_trajectories,
)
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory


def _traj(task: str, status: str, tool_contents: list) -> RSITrajectory:
    msgs = [{"role": "user", "content": "go"}]
    for c in tool_contents:
        msgs.append({"role": "tool", "content": c})
    return RSITrajectory(
        source="test", task_id=task, session_id=f"{task}-{status}-{len(tool_contents)}",
        model="m", status=status,
        reward=RewardRecord(label=1.0 if status == "pass" else 0.0),
        messages=msgs)


def test_mine_contrastive_from_trajectories():
    trajs = [
        _traj("t1", "pass", ["error: FileNotFoundError: cfg"]),
        _traj("t1", "fail", ["error: FileNotFoundError: cfg",
                             "error: TimeoutError: npm"]),
        _traj("t2", "pass", ["ok"]),                 # t2 无失败组 → 不产出
        _traj("t3", "fail", ["error: TimeoutError: npm"]),
        _traj("t3", "fail", ["error: TimeoutError: npm"]),   # t3 无成功组 → 不产出
        _traj("t4", "partial", ["error: X"]),        # partial 不进对比组
    ]
    lessons = contrastive_lessons_from_trajectories(trajs)
    assert [l.task_id for l in lessons] == ["t1"]
    assert lessons[0].kind == "contrastive_failure"
    assert "TimeoutError" in lessons[0].content


def test_mine_min_group_size_gate():
    # min_fail=2: t1 只有 1 条失败轨迹 → 被门槛拦下
    trajs = [
        _traj("t1", "pass", []),
        _traj("t1", "fail", ["error: TimeoutError: x"]),
    ]
    assert contrastive_lessons_from_trajectories(trajs, min_fail=2) == []
    assert len(contrastive_lessons_from_trajectories(trajs)) == 1
