from agenticx.learning.trajectory.store import TrajectoryStore
from test_schema import _traj

def test_append_writes_and_dedups(tmp_path):
    store = TrajectoryStore(tmp_path)
    assert store.append(_traj()) == "written"
    assert store.append(_traj()) == "duplicate"      # 同 trajectory_id 幂等
    files = list(tmp_path.rglob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text().strip().splitlines()
    assert len(lines) == 1

def test_append_partitions_by_source_and_month(tmp_path):
    store = TrajectoryStore(tmp_path)
    t = _traj()
    store.append(t)
    rel = next((tmp_path).rglob("*.jsonl")).relative_to(tmp_path)
    assert rel.parts[0] == "harbor-tb40"

def test_iter_and_stats(tmp_path):
    store = TrajectoryStore(tmp_path)
    store.append(_traj())
    trajs = list(store.iter_trajectories())
    assert len(trajs) == 1 and trajs[0].trajectory_id == _traj().trajectory_id
    s = store.stats()
    assert s["total"] == 1 and s["by_status"] == {"pass": 1}
