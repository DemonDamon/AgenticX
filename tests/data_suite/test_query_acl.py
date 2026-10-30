from pathlib import Path

import pytest

from agenticx.data_suite.acl import (
    QueryAccessDenied,
    assert_query_access,
    check_query_access,
    load_query_acl_policy,
    secure_query_rows,
)
from agenticx.data_suite.masking import load_masking_policy

ACL = Path(__file__).parent / "fixtures" / "sample_query_acl.yaml"
MASK = Path(__file__).parent / "fixtures" / "sample_masking.yaml"

ROWS = [
    {"phone": "13812345678", "email": "alice@example.com", "member_id": "M-001", "region": "east"},
]


def _acl():
    return load_query_acl_policy(ACL)


def test_load_acl_policy():
    policy = _acl()
    assert policy.id == "sample_query_acl"
    assert policy.default_effect == "deny"
    assert len(policy.grants) == 3


def test_admin_allowed_any_dataset():
    d = check_query_access(_acl(), role="admin", dataset_id="secrets")
    assert d.allowed is True


def test_analyst_allowed_members():
    d = check_query_access(
        _acl(), role="analyst", dataset_id="members", board_id="sample_member_board"
    )
    assert d.allowed is True


def test_outsider_denied():
    d = check_query_access(_acl(), role="outsider", dataset_id="members")
    assert d.allowed is False
    assert "role_not_granted" in d.reason


def test_analyst_denied_other_dataset():
    d = check_query_access(_acl(), role="analyst", dataset_id="payroll")
    assert d.allowed is False
    assert "dataset_denied" in d.reason


def test_guest_denied_unknown_board():
    d = check_query_access(
        _acl(), role="guest", dataset_id="members", board_id="secret_board"
    )
    assert d.allowed is False
    assert "board_denied" in d.reason


def test_assert_raises():
    with pytest.raises(QueryAccessDenied, match="role_not_granted"):
        assert_query_access(_acl(), role="outsider", dataset_id="members")


def test_secure_query_masks_analyst():
    out = secure_query_rows(
        ROWS,
        role="analyst",
        dataset_id="members",
        acl=_acl(),
        masking=load_masking_policy(MASK),
        board_id="sample_member_board",
    )
    assert out[0]["phone"] == "1*********8"
    assert out[0]["email"] == "a***************m"
    assert out[0]["phone"] != ROWS[0]["phone"]


def test_secure_query_guest_drops_phone():
    out = secure_query_rows(
        ROWS,
        role="guest",
        dataset_id="members",
        acl=_acl(),
        masking=load_masking_policy(MASK),
    )
    assert out[0]["phone"] is None


def test_secure_query_denies_outsider():
    with pytest.raises(QueryAccessDenied):
        secure_query_rows(
            ROWS,
            role="outsider",
            dataset_id="members",
            acl=_acl(),
            masking=load_masking_policy(MASK),
        )


def test_guest_field_allowlist_denies_unknown_field():
    # guest grant has explicit fields; requesting a non-listed field denies
    d = check_query_access(
        _acl(),
        role="guest",
        dataset_id="members",
        fields=["ssn"],
    )
    assert d.allowed is False
    assert "field_denied:ssn" in d.reason
