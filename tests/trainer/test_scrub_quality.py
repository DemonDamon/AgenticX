# tests/trainer/test_scrub_quality.py
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
from agenticx.trainer.scrub import scrub_text, scrub_trajectory
from agenticx.trainer.quality import score_trajectory

def test_scrub_text_masks_secrets():
    text = "sk-ant-api03-abcdef1234567890 contact me at foo@bar.com host 10.0.0.1"
    out = scrub_text(text)
    assert "sk-ant" not in out and "foo@bar.com" not in out and "10.0.0.1" not in out
    assert "[REDACTED]" in out

def test_scrub_trajectory_covers_all_messages():
    t = RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "key sk-ant-api03-abcdefghijk"},
                  {"role": "assistant", "content": "email a@b.com"}],
    )
    scrub_trajectory(t)
    joined = " ".join(m["content"] for m in t.messages)
    assert "sk-ant" not in joined and "a@b.com" not in joined

def _good_traj():
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}],
        token_usage={"output_tokens": 500},
    )

def test_score_good_trajectory():
    q = score_trajectory(_good_traj())
    assert q.score >= 0.8
    assert any("ok" in r for r in q.reasons)

def test_score_penalizes_missing_final_answer():
    t = _good_traj()
    t.messages = [{"role": "user", "content": "q"}]
    q = score_trajectory(t)
    assert q.score < 0.5 and any("缺少最终回复" in r for r in q.reasons)

def test_score_penalizes_truncation():
    t = _good_traj()
    t.token_usage = {"output_tokens": 32768}
    q = score_trajectory(t)
    assert any("疑似截断" in r for r in q.reasons)
