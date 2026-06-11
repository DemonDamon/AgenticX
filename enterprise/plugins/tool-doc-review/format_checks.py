#!/usr/bin/env python3
"""Deterministic format checks for document review.

Author: Damon Li
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Callable

from doc_model import DocModel, Paragraph
from findings import Finding

FIGURE_PATTERNS = (
    re.compile(r"图\s*(\d+)", re.IGNORECASE),
    re.compile(r"Figure\s*(\d+)", re.IGNORECASE),
)
TABLE_PATTERNS = (
    re.compile(r"表\s*(\d+)", re.IGNORECASE),
    re.compile(r"Table\s*(\d+)", re.IGNORECASE),
)


def _paragraph_offset(doc: DocModel, paragraph_index: int) -> int:
    offset = 0
    for paragraph in doc.paragraphs:
        if paragraph.index == paragraph_index:
            return offset
        offset += len(paragraph.text) + 1
    return offset


def _make_finding(
    *,
    rule_id: str,
    paragraph: Paragraph,
    doc: DocModel,
    matched: str,
    message: str,
    category: str = "二类",
    grade: str = "排版建议",
) -> Finding:
    start = _paragraph_offset(doc, paragraph.index)
    end = start + len(matched)
    return Finding(
        rule_id=rule_id,
        severity="medium",
        matched=matched,
        start=start,
        end=end,
        message=message,
        category=category,
        grade=grade,
    )


def check_heading_hierarchy(doc: DocModel) -> list[Finding]:
    findings: list[Finding] = []
    last_level: int | None = None
    for paragraph in doc.paragraphs:
        level = paragraph.outline_level
        if level is None:
            continue
        if last_level is not None and level > last_level + 1:
            findings.append(
                _make_finding(
                    rule_id="heading-hierarchy",
                    paragraph=paragraph,
                    doc=doc,
                    matched=paragraph.text[:80] or paragraph.style_name or "",
                    message=(
                        f"Heading level jump detected: previous level {last_level}, "
                        f"current level {level}"
                    ),
                )
            )
        last_level = level
    return findings


def _collect_numbering(doc: DocModel, patterns: tuple[re.Pattern[str], ...]) -> list[tuple[int, int, Paragraph]]:
    hits: list[tuple[int, int, Paragraph]] = []
    for paragraph in doc.paragraphs:
        for pattern in patterns:
            for match in pattern.finditer(paragraph.text):
                hits.append((match.start(), int(match.group(1)), paragraph))
    hits.sort(key=lambda item: (item[2].index, item[0]))
    return hits


def _numbering_findings(
    doc: DocModel,
    hits: list[tuple[int, int, Paragraph]],
    label: str,
    rule_id: str,
) -> list[Finding]:
    findings: list[Finding] = []
    if not hits:
        return findings
    seen: set[int] = set()
    expected = hits[0][1]
    for _, number, paragraph in hits:
        if number in seen:
            findings.append(
                _make_finding(
                    rule_id=f"{rule_id}-duplicate",
                    paragraph=paragraph,
                    doc=doc,
                    matched=f"{label}{number}",
                    message=f"Duplicate {label} number: {number}",
                )
            )
        seen.add(number)
        if number > expected:
            for missing in range(expected, number):
                findings.append(
                    _make_finding(
                        rule_id=f"{rule_id}-missing",
                        paragraph=paragraph,
                        doc=doc,
                        matched=f"{label}{missing}",
                        message=f"Missing {label} number: {missing}",
                    )
                )
            expected = number + 1
        elif number == expected:
            expected = number + 1
    return findings


def check_figure_table_numbering(doc: DocModel) -> list[Finding]:
    figure_hits = _collect_numbering(doc, FIGURE_PATTERNS)
    table_hits = _collect_numbering(doc, TABLE_PATTERNS)
    findings: list[Finding] = []
    findings.extend(_numbering_findings(doc, figure_hits, "图", "figure-numbering"))
    findings.extend(_numbering_findings(doc, table_hits, "表", "table-numbering"))
    return findings


def _mode_or_none(values: list[Any]) -> Any | None:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    counter = Counter(filtered)
    return counter.most_common(1)[0][0]


def check_font_consistency(doc: DocModel) -> list[Finding]:
    findings: list[Finding] = []
    groups: dict[str | int, list[Paragraph]] = {}
    for paragraph in doc.paragraphs:
        key: str | int = paragraph.outline_level if paragraph.outline_level is not None else "body"
        groups.setdefault(key, []).append(paragraph)

    for group_key, paragraphs in groups.items():
        mode_font = _mode_or_none([p.font_name for p in paragraphs])
        mode_size = _mode_or_none([p.font_size_pt for p in paragraphs])
        if mode_font is None and mode_size is None:
            continue
        for paragraph in paragraphs:
            if mode_font is not None and paragraph.font_name not in (None, mode_font):
                findings.append(
                    _make_finding(
                        rule_id="font-name-inconsistent",
                        paragraph=paragraph,
                        doc=doc,
                        matched=paragraph.text[:80] or paragraph.font_name or "",
                        message=(
                            f"Inconsistent font in group {group_key}: "
                            f"expected {mode_font}, got {paragraph.font_name}"
                        ),
                    )
                )
            if mode_size is not None and paragraph.font_size_pt not in (None, mode_size):
                findings.append(
                    _make_finding(
                        rule_id="font-size-inconsistent",
                        paragraph=paragraph,
                        doc=doc,
                        matched=paragraph.text[:80] or str(paragraph.font_size_pt),
                        message=(
                            f"Inconsistent font size in group {group_key}: "
                            f"expected {mode_size}pt, got {paragraph.font_size_pt}pt"
                        ),
                    )
                )
    return findings


def check_spacing_consistency(doc: DocModel) -> list[Finding]:
    findings: list[Finding] = []
    groups: dict[str, list[Paragraph]] = {}
    for paragraph in doc.paragraphs:
        if not paragraph.style_name:
            continue
        groups.setdefault(paragraph.style_name, []).append(paragraph)

    for style_name, paragraphs in groups.items():
        mode_before = _mode_or_none([p.space_before_pt for p in paragraphs])
        mode_after = _mode_or_none([p.space_after_pt for p in paragraphs])
        mode_line = _mode_or_none([p.line_spacing for p in paragraphs])
        if mode_before is None and mode_after is None and mode_line is None:
            continue
        for paragraph in paragraphs:
            if (
                mode_before is not None
                and paragraph.space_before_pt not in (None, mode_before)
            ):
                findings.append(
                    _make_finding(
                        rule_id="spacing-before-inconsistent",
                        paragraph=paragraph,
                        doc=doc,
                        matched=paragraph.text[:80] or style_name,
                        message=(
                            f"Inconsistent space before for style {style_name}: "
                            f"expected {mode_before}pt, got {paragraph.space_before_pt}pt"
                        ),
                    )
                )
            if (
                mode_after is not None
                and paragraph.space_after_pt not in (None, mode_after)
            ):
                findings.append(
                    _make_finding(
                        rule_id="spacing-after-inconsistent",
                        paragraph=paragraph,
                        doc=doc,
                        matched=paragraph.text[:80] or style_name,
                        message=(
                            f"Inconsistent space after for style {style_name}: "
                            f"expected {mode_after}pt, got {paragraph.space_after_pt}pt"
                        ),
                    )
                )
            if (
                mode_line is not None
                and paragraph.line_spacing not in (None, mode_line)
            ):
                findings.append(
                    _make_finding(
                        rule_id="line-spacing-inconsistent",
                        paragraph=paragraph,
                        doc=doc,
                        matched=paragraph.text[:80] or style_name,
                        message=(
                            f"Inconsistent line spacing for style {style_name}: "
                            f"expected {mode_line}, got {paragraph.line_spacing}"
                        ),
                    )
                )
    return findings


FormatChecker = Callable[[DocModel], list[Finding]]

FORMAT_CHECKERS: list[FormatChecker] = [
    check_heading_hierarchy,
    check_figure_table_numbering,
    check_font_consistency,
    check_spacing_consistency,
]


def run_format_checks(doc: DocModel) -> list[Finding]:
    findings: list[Finding] = []
    for checker in FORMAT_CHECKERS:
        findings.extend(checker(doc))
    findings.sort(key=lambda item: (item.start, item.end))
    return findings
