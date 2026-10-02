#!/usr/bin/env python3
"""Unit tests for versioned structured choice panels.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.runtime.choice_panels.store import (
    ChoicePanelStore,
    StaleChoiceError,
    ValidationError,
    normalize_and_validate_options,
    panel_to_clarification_context,
)


def _cmp_options():
    return [
        {
            "id": "a",
            "label": "Rocky Shore",
            "details": ["Tide pools"],
            "sources": [{"title": "Aquarium page", "url": "https://example.com/rocky"}],
        },
        {
            "id": "b",
            "label": "Open Ocean",
            "details": ["Large tank"],
            "sources": [{"title": "Ocean hall", "url": "https://example.com/ocean"}],
        },
    ]


def test_comparison_requires_https_sources() -> None:
    with pytest.raises(ValidationError, match="http\\(s\\) source"):
        normalize_and_validate_options(
            "comparison",
            [{"id": "a", "label": "No source", "details": ["x"], "sources": []}],
            title="pick",
        )


def test_comparison_rejects_non_http_url() -> None:
    with pytest.raises(ValidationError, match="http\\(s\\)"):
        normalize_and_validate_options(
            "comparison",
            [
                {
                    "id": "a",
                    "label": "Local",
                    "details": ["x"],
                    "sources": [{"title": "file", "url": "file:///tmp/x"}],
                }
            ],
            title="pick",
        )


def test_comparison_caps_visible_options_at_three() -> None:
    opts = [
        {
            "id": f"o{i}",
            "label": f"Option {i}",
            "details": [f"d{i}"],
            "sources": [{"title": f"t{i}", "url": f"https://example.com/{i}"}],
        }
        for i in range(4)
    ]
    # normalize takes only first 3 for comparison
    parsed = normalize_and_validate_options("comparison", opts, title="Option 2")
    assert len(parsed) == 3


def test_create_panel_supersedes_previous() -> None:
    store = ChoicePanelStore()
    first = store.create_panel(
        session_id="s1",
        panel_type="clarification",
        title="Which scope?",
        options=[
            {"id": "fin", "label": "Finance"},
            {"id": "prod", "label": "Product"},
        ],
    )
    second = store.create_panel(
        session_id="s1",
        panel_type="clarification",
        title="Refine?",
        options=[
            {"id": "narrow", "label": "Narrow"},
            {"id": "wide", "label": "Wide"},
        ],
    )
    assert first.candidate_set_version == 1
    assert second.candidate_set_version == 2
    assert store.get_panel(first.panel_id).superseded is True
    assert store.get_panel(second.panel_id).superseded is False
    assert store.current_panel("s1").panel_id == second.panel_id


def test_stale_choice_rejected() -> None:
    store = ChoicePanelStore()
    panel = store.create_panel(
        session_id="s1",
        panel_type="comparison",
        title="Exhibits",
        options=_cmp_options(),
    )
    # Bump version by publishing a newer panel.
    store.create_panel(
        session_id="s1",
        panel_type="clarification",
        title="Next?",
        options=[{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
    )
    with pytest.raises(StaleChoiceError):
        store.select(
            session_id="s1",
            panel_id=panel.panel_id,
            candidate_set_version=panel.candidate_set_version,
            option_id="a",
        )
    # Ensure selected_id was not written on the stale panel.
    assert store.get_panel(panel.panel_id).selected_id is None


def test_stale_choice_rejected_on_version_mismatch() -> None:
    store = ChoicePanelStore()
    panel = store.create_panel(
        session_id="s1",
        panel_type="clarification",
        title="Pick one",
        options=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
    )
    with pytest.raises(StaleChoiceError):
        store.select(
            session_id="s1",
            panel_id=panel.panel_id,
            candidate_set_version=99,
            option_id="a",
        )
    assert store.get_panel(panel.panel_id).selected_id is None


def test_select_writes_selected_id() -> None:
    store = ChoicePanelStore()
    panel = store.create_panel(
        session_id="s1",
        panel_type="comparison",
        title="Exhibits",
        options=_cmp_options(),
    )
    selected = store.select(
        session_id="s1",
        panel_id=panel.panel_id,
        candidate_set_version=panel.candidate_set_version,
        option_id="b",
    )
    assert selected.selected_id == "b"
    assert store.get_panel(panel.panel_id).selected_id == "b"


def test_panel_context_uses_choice_panel_kind_not_jev() -> None:
    store = ChoicePanelStore()
    panel = store.create_panel(
        session_id="s1",
        panel_type="clarification",
        title="Scope",
        options=[{"id": "a", "label": "A"}],
    )
    ctx = panel_to_clarification_context(panel)
    assert ctx["kind"] == "choice_panel"
    assert "jev" not in str(ctx).lower()
    assert ctx["panel_id"] == panel.panel_id
    assert ctx["candidate_set_version"] == 1


@pytest.mark.asyncio
async def test_present_choices_rejects_comparison_without_sources() -> None:
    from agenticx.cli.agent_tools import _present_choices

    result = await _present_choices(
        title="Compare exhibits",
        panel_type="comparison",
        options=[{"id": "a", "label": "A", "details": ["x"], "sources": []}],
        session=type("S", (), {"session_id": "sess-cmp"})(),
        is_unattended=True,
    )
    assert result.startswith("ERROR: present_choices rejected")
    assert "source" in result.lower()
