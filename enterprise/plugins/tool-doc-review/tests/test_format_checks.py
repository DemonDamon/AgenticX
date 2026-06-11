#!/usr/bin/env python3
"""Tests for format checks.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from doc_model import load_document
from format_checks import (
    check_figure_table_numbering,
    check_font_consistency,
    check_heading_hierarchy,
    check_spacing_consistency,
    run_format_checks,
)


def test_flawed_docx_hits_all_format_checkers(flawed_docx: Path) -> None:
    doc = load_document(flawed_docx)
    findings = run_format_checks(doc)
    rule_ids = {item.rule_id for item in findings}
    assert "heading-hierarchy" in rule_ids
    assert any(rule_id.startswith("figure-numbering") for rule_id in rule_ids)
    assert "font-size-inconsistent" in rule_ids
    assert "spacing-before-inconsistent" in rule_ids


def test_clean_docx_false_alarm_rate_within_limit(clean_docx: Path) -> None:
    doc = load_document(clean_docx)
    findings = run_format_checks(doc)
    second_category = [item for item in findings if item.category == "二类"]
    false_alarm_rate = len(second_category) / max(len(doc.paragraphs), 1)
    assert false_alarm_rate <= 0.15


def test_individual_checkers_return_findings(flawed_docx: Path) -> None:
    doc = load_document(flawed_docx)
    assert check_heading_hierarchy(doc)
    assert check_figure_table_numbering(doc)
    assert check_font_consistency(doc)
    assert check_spacing_consistency(doc)
