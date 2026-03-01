#!/usr/bin/env python3
"""Smoke tests for thinking-tag parsing in streaming accumulator.

Author: Damon Li
"""

from agenticx.core.stream_accumulator import StreamContentAccumulator


class TestThinkingParser:
    def test_cross_chunk_thinking_tags(self):
        acc = StreamContentAccumulator()
        acc.add_streaming_content("hello <thin")
        acc.add_streaming_content("king>reason")
        acc.add_streaming_content("ing</think")
        acc.add_streaming_content("ing> world")

        assert acc.get_full_reasoning_content() == "reasoning"
        assert acc.get_full_content() == "hello  world"

    def test_unclosed_thinking_tag_routes_to_reasoning(self):
        acc = StreamContentAccumulator()
        acc.add_streaming_content("<thinking>draft")
        acc.add_streaming_content("ing still")

        assert acc.get_full_reasoning_content() == "drafting still"
        assert acc.get_full_content() == ""

    def test_regular_stream_without_thinking(self):
        acc = StreamContentAccumulator()
        acc.add_streaming_content("plain")
        acc.add_streaming_content(" text")

        assert acc.get_full_reasoning_content() == ""
        assert acc.get_full_content() == "plain text"
