#!/usr/bin/env python3
"""Tests for html_extractor.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.tools.html_extractor import extract_readable_text


def test_extract_title_and_og_image() -> None:
    html = """
    <html><head>
      <title>Fallback Title</title>
      <meta property="og:title" content="OG Title" />
      <meta property="og:image" content="//cdn.example.com/cover.png" />
    </head><body>
      <img src="/inline.jpg" />
      <p>Hello world</p>
    </body></html>
    """
    result = extract_readable_text(html, "https://example.com/article")
    assert result["title"] == "OG Title"
    assert "Hello world" in result["text"]
    assert result["images"][0] == "https://cdn.example.com/cover.png"
    assert "https://example.com/inline.jpg" in result["images"]


def test_script_content_is_stripped() -> None:
    html = "<html><body><script>secret()</script><p>Visible</p></body></html>"
    result = extract_readable_text(html, "https://example.com")
    assert "secret" not in result["text"]
    assert "Visible" in result["text"]


def test_empty_page_returns_empty_text() -> None:
    result = extract_readable_text("<html></html>", "https://example.com")
    assert result["text"] == ""
    assert result["images"] == []
