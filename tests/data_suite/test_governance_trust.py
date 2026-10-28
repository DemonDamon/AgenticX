from pathlib import Path

from agenticx.data_suite.governance.trust import TrustArbiter

FIXTURE = Path(__file__).parent / "fixtures" / "sample_trust_profile.yaml"


def _arbiter() -> TrustArbiter:
    a = TrustArbiter()
    a.load_profile(FIXTURE)
    return a


def test_prefer_higher_grade():
    a = _arbiter()
    d = a.grade(
        [
            {"value": "old", "source": "crm", "grade": "B"},
            {"value": "new", "source": "app", "grade": "A"},
        ],
        field="display_name",
    )
    assert d.value == "new"
    assert d.grade == "A"
    assert d.source == "app"


def test_equal_grade_uses_source_order():
    a = _arbiter()
    d = a.grade(
        [
            {"value": "from_web", "source": "web", "grade": "A"},
            {"value": "from_crm", "source": "crm", "grade": "A"},
        ],
        field="display_name",
    )
    assert d.value == "from_crm"
    assert d.source == "crm"
