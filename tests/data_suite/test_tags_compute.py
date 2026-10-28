from pathlib import Path

from agenticx.data_suite.tags.compute import TagComputeEngine

FIXTURE = Path(__file__).parent / "fixtures" / "sample_tag_compute.yaml"


def test_compute_types():
    eng = TagComputeEngine()
    eng.load(FIXTURE)
    rows = [
        {"member_id": "1", "status": "active", "channel": "app", "tier": "gold"},
        {"member_id": "2", "status": "inactive", "channel": "web", "tier": "silver"},
    ]
    result = eng.compute(rows)
    assert result.rows[0]["tag_status_active"] is True
    assert result.rows[1]["tag_status_active"] is False
    assert result.rows[0]["tag_channel_copy"] == "app"
    assert result.rows[0]["tag_premium"] is True
    assert result.rows[1]["tag_premium"] is False
    assert result.rows[0]["tag_ready"] is True
    assert "tag_status_active" in result.computed
    assert result.meta.get("tables_out") == ["tagged_rows"]


def test_selective_tag_ids():
    eng = TagComputeEngine()
    eng.load(FIXTURE)
    result = eng.compute(
        [{"status": "active", "channel": "app", "tier": "gold", "member_id": "1"}],
        tag_ids=["tag_status_active"],
    )
    assert result.computed == ["tag_status_active"]
    assert "tag_channel_copy" not in result.rows[0]
