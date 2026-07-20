"""Parse HTML preview select-element context blocks for history / UI chips.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Any

_EL_SNIPPET_KEY_RE = re.compile(
    r"^(?P<path>.+):(?P<ref>el-(?:snippet-)?[0-9a-f]+)$",
    re.IGNORECASE,
)

_META_LINE_RE = re.compile(
    r"^-\s*(?P<key>path|tag|selector|visible_text|user_comment):\s*(?P<value>.+)\s*$",
    re.MULTILINE,
)


def split_el_snippet_context_key(key: str) -> tuple[str, str] | None:
    """Split ``/abs/file.html:el-snippet-xxxx`` into (source_path, snippet_ref)."""
    text = str(key or "").strip()
    if not text:
        return None
    matched = _EL_SNIPPET_KEY_RE.match(text)
    if not matched:
        return None
    path = str(matched.group("path") or "").strip()
    ref = str(matched.group("ref") or "").strip()
    if not path or not ref:
        return None
    return path, ref


def parse_html_element_context_meta(body: str) -> dict[str, str] | None:
    """Extract tag / comment / path from ``buildHtmlElementContextSnippet`` body."""
    text = str(body or "")
    if "# Selected HTML element" not in text and "Selected HTML element" not in text:
        return None
    meta: dict[str, str] = {}
    for match in _META_LINE_RE.finditer(text):
        key = str(match.group("key") or "").strip()
        value = str(match.group("value") or "").strip()
        if key and value:
            meta[key] = value
    tag = str(meta.get("tag") or "").strip()
    if not tag:
        return None
    out: dict[str, str] = {"tag": tag}
    for key in ("path", "selector", "visible_text", "user_comment"):
        value = str(meta.get(key) or "").strip()
        if value:
            out[key] = value
    return out


def html_element_history_fields(
    key: str, body: str
) -> dict[str, Any] | None:
    """Attachment fields so Desktop can replay Trae-style element chips after reload."""
    meta = parse_html_element_context_meta(body)
    split = split_el_snippet_context_key(key)
    if meta is None and split is None:
        return None
    tag = str((meta or {}).get("tag") or "").strip()
    comment = str((meta or {}).get("user_comment") or "").strip()
    selector = str((meta or {}).get("selector") or tag).strip() or tag
    source_path = str((meta or {}).get("path") or "").strip()
    snippet_ref = ""
    if split is not None:
        split_path, snippet_ref = split
        if not source_path:
            source_path = split_path
    if not tag and not snippet_ref:
        return None
    if not tag:
        tag = "element"
    # Unique mention label per element — bare tag collapses multiple same-tag chips.
    mention_label = snippet_ref or tag
    display_name = (
        f"{source_path}:{snippet_ref}" if source_path and snippet_ref else tag
    )
    fields: dict[str, Any] = {
        "name": display_name,
        "source_path": source_path,
        "reference_token": True,
        "composer_ref_label": mention_label,
        "html_element_ref": {
            "tag_name": tag,
            "selector_hint": selector or tag,
            **({"comment": comment} if comment else {}),
        },
    }
    if snippet_ref:
        fields["snippet_ref"] = snippet_ref
    return fields
