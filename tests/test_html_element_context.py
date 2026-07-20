"""Tests for HTML preview select-element history metadata.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.html_element_context import (
    html_element_history_fields,
    parse_html_element_context_meta,
    split_el_snippet_context_key,
)


SAMPLE_BODY = """# Selected HTML element
- path: /tmp/report/index.html
- tag: span
- selector: span.risk
- visible_text: 高风险
- user_comment: 这个对吗

The user referenced this concrete DOM node from the HTML preview (select-element).

```html
<span class="risk">高风险</span>
```
"""


def test_split_el_snippet_context_key() -> None:
    assert split_el_snippet_context_key(
        "/tmp/report/index.html:el-snippet-fe67ada8"
    ) == ("/tmp/report/index.html", "el-snippet-fe67ada8")
    assert split_el_snippet_context_key("/tmp/a.html") is None


def test_parse_html_element_context_meta() -> None:
    meta = parse_html_element_context_meta(SAMPLE_BODY)
    assert meta is not None
    assert meta["tag"] == "span"
    assert meta["user_comment"] == "这个对吗"
    assert meta["path"] == "/tmp/report/index.html"


def test_html_element_history_fields_for_trae_chip() -> None:
    fields = html_element_history_fields(
        "/tmp/report/index.html:el-snippet-fe67ada8",
        SAMPLE_BODY,
    )
    assert fields is not None
    assert fields["composer_ref_label"] == "el-snippet-fe67ada8"
    assert fields["name"] == "/tmp/report/index.html:el-snippet-fe67ada8"
    assert fields["source_path"] == "/tmp/report/index.html"
    assert fields["snippet_ref"] == "el-snippet-fe67ada8"
    assert fields["html_element_ref"]["tag_name"] == "span"
    assert fields["html_element_ref"]["comment"] == "这个对吗"
