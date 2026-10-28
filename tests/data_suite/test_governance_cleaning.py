from pathlib import Path

from agenticx.data_suite.governance.cleaning import CleaningEngine

FIXTURE = Path(__file__).parent / "fixtures" / "sample_cleaning_rules.yaml"


def _engine() -> CleaningEngine:
    eng = CleaningEngine()
    eng.load_ruleset(FIXTURE)
    return eng


def test_not_null_quarantines_missing_member_id():
    eng = _engine()
    result = eng.apply([{"member_id": None, "mobile_hash": "a" * 64, "status": "active", "display_name": "x"}])
    assert len(result.rows) == 0
    assert len(result.quarantine) == 1
    assert result.quarantine[0]["rule_id"] == "member_id_required"


def test_regex_quarantines_bad_hash():
    eng = _engine()
    result = eng.apply([{"member_id": "1", "mobile_hash": "nope", "status": "active", "display_name": "x"}])
    assert len(result.rows) == 0
    assert result.quarantine[0]["rule_id"] == "mobile_hash_format"


def test_good_row_passes_and_trims():
    eng = _engine()
    result = eng.apply([
        {"member_id": "1", "mobile_hash": "a" * 64, "status": "active", "display_name": "  Alice  "}
    ])
    assert len(result.rows) == 1
    assert result.rows[0]["display_name"] == "Alice"
    assert result.quarantine == []


def test_in_set_rejects_unknown_status():
    eng = _engine()
    result = eng.apply([
        {"member_id": "1", "mobile_hash": "a" * 64, "status": "banned", "display_name": "x"}
    ])
    assert len(result.rows) == 0
    assert result.quarantine[0]["rule_id"] == "status_allowed"


def test_audit_counts_per_rule():
    eng = _engine()
    rows = [
        {"member_id": "1", "mobile_hash": "a" * 64, "status": "active", "display_name": " ok "},
        {"member_id": None, "mobile_hash": "a" * 64, "status": "active", "display_name": "x"},
    ]
    result = eng.apply(rows)
    by_id = {a["rule_id"]: a for a in result.audit}
    assert by_id["member_id_required"]["passed"] == 1
    assert by_id["member_id_required"]["failed"] == 1
    assert by_id["name_trim"]["passed"] == 1
