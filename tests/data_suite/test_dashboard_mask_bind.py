from pathlib import Path

import pytest

from agenticx.data_suite.dashboard.binder import bind_widget
from agenticx.data_suite.dashboard.spec import WidgetSpec
from agenticx.data_suite.masking import MaskingEngine, load_masking_policy

POLICY = Path(__file__).parent / "fixtures" / "sample_masking.yaml"

ROWS = [
    {"phone": "13812345678", "email": "alice@example.com", "member_id": "M-001", "region": "east"},
    {"phone": "13900001111", "email": "bob@example.com", "member_id": "M-002", "region": "east"},
    {"phone": "13722223333", "email": "cara@example.com", "member_id": "M-003", "region": "west"},
]


def _engine():
    return MaskingEngine(load_masking_policy(POLICY))


def test_count_unchanged_when_masking_other_fields():
    widget = WidgetSpec(
        id="by_region",
        title="By region",
        chart="bar",
        dataset="members",
        group_by="region",
        metric="count",
    )
    plain = bind_widget(widget, ROWS)
    masked = bind_widget(widget, ROWS, masking=_engine(), role="analyst")
    assert {p.name: p.value for p in plain.points} == {p.name: p.value for p in masked.points}


def test_filter_on_raw_phone_misses_after_guest_mask():
    widget = WidgetSpec(
        id="hit",
        title="Hit",
        chart="stat",
        dataset="members",
        metric="count",
    )
    plain = bind_widget(widget, ROWS, filters={"phone": "13812345678"})
    assert plain.points[0].value == 1.0
    masked = bind_widget(
        widget, ROWS, filters={"phone": "13812345678"}, masking=_engine(), role="guest"
    )
    assert masked.points[0].value == 0.0


def test_role_required_with_masking():
    widget = WidgetSpec(
        id="hit",
        title="Hit",
        chart="stat",
        dataset="members",
        metric="count",
    )
    with pytest.raises(ValueError, match="role"):
        bind_widget(widget, ROWS, masking=_engine())


# --- H5: secure_bind forces ACL + masking ---

from agenticx.data_suite.acl import QueryAccessDenied, load_query_acl_policy, secure_bind_widget

ACL_PATH = Path(__file__).parent / "fixtures" / "sample_query_acl.yaml"


def test_secure_bind_analyst_ok_and_masked_filter_semantics():
    widget = WidgetSpec(
        id="hit",
        title="Hit",
        chart="stat",
        dataset="members",
        metric="count",
    )
    series = secure_bind_widget(
        widget,
        ROWS,
        role="analyst",
        acl=load_query_acl_policy(ACL_PATH),
        masking=_engine(),
        board_id="sample_member_board",
        filters={"phone": "13812345678"},
    )
    # analyst partial-masks phone before filter → raw phone filter misses
    assert series.points[0].value == 0.0


def test_secure_bind_outsider_denied():
    widget = WidgetSpec(
        id="hit",
        title="Hit",
        chart="stat",
        dataset="members",
        metric="count",
    )
    with pytest.raises(QueryAccessDenied):
        secure_bind_widget(
            widget,
            ROWS,
            role="outsider",
            acl=load_query_acl_policy(ACL_PATH),
            masking=_engine(),
        )


def test_secure_bind_cannot_skip_masking_for_payroll_dataset():
    widget = WidgetSpec(
        id="pay",
        title="Pay",
        chart="stat",
        dataset="payroll",
        metric="count",
    )
    with pytest.raises(QueryAccessDenied, match="dataset_denied"):
        secure_bind_widget(
            widget,
            ROWS,
            role="analyst",
            acl=load_query_acl_policy(ACL_PATH),
            masking=_engine(),
        )
