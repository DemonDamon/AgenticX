#!/usr/bin/env python3
"""Smoke tests for transcript sanitizer.

Author: Damon Li
"""

from agenticx.llms.transcript_sanitizer import TranscriptSanitizer


class TestTranscriptSanitizer:
    def test_anthropic_merges_user_turns_and_strips_refusal(self):
        sanitizer = TranscriptSanitizer()
        messages = [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "Do not answer this."},
            {"role": "assistant", "content": "ok"},
        ]

        out = sanitizer.sanitize(messages, provider="anthropic/claude")
        assert len(out) == 2
        assert out[0]["role"] == "user"
        assert "first" in out[0]["content"]
        assert "Do not answer" not in out[0]["content"]

    def test_google_sanitizes_tools_schema(self):
        sanitizer = TranscriptSanitizer()
        messages = [
            {
                "role": "user",
                "content": "hello",
                "tools": [{"name": "read", "description": "x", "parameters": {"type": "object"}}],
            }
        ]

        out = sanitizer.sanitize(messages, provider="google/gemini")
        assert out[0]["tools"][0]["name"] == "read"
        assert "parameters" in out[0]["tools"][0]

    def test_invalid_role_removed(self):
        sanitizer = TranscriptSanitizer()
        messages = [
            {"role": "alien", "content": "x"},
            {"role": "user", "content": "y"},
        ]
        out = sanitizer.sanitize(messages, provider="openai/gpt-4o")
        assert len(out) == 1
        assert out[0]["role"] == "user"

    def test_empty_messages(self):
        sanitizer = TranscriptSanitizer()
        assert sanitizer.sanitize([], provider="ollama/qwen") == []
