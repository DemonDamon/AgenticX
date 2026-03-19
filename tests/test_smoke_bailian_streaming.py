#!/usr/bin/env python3
"""Smoke tests for BailianProvider streaming-with-tools behavior.

Author: Damon Li
"""

from unittest.mock import MagicMock, patch


def test_bailian_stream_with_tools_emits_content_and_tool_delta() -> None:
    """Verify stream_with_tools returns normalized content/tool chunks."""
    from agenticx.llms import BailianProvider

    provider = BailianProvider(model="qwen-max", api_key="test-key")

    delta_content = MagicMock()
    delta_content.content = "hello"
    delta_content.tool_calls = None
    choice_content = MagicMock()
    choice_content.delta = delta_content
    choice_content.finish_reason = None
    chunk_content = MagicMock()
    chunk_content.choices = [choice_content]

    delta_tool = MagicMock()
    tc = MagicMock()
    tc.index = "1"
    tc.id = "call_1"
    tc.function = MagicMock()
    tc.function.name = "bash_exec"
    tc.function.arguments = None
    delta_tool.content = None
    delta_tool.tool_calls = [tc]
    choice_tool = MagicMock()
    choice_tool.delta = delta_tool
    choice_tool.finish_reason = "tool_calls"
    chunk_tool = MagicMock()
    chunk_tool.choices = [choice_tool]

    provider.client = MagicMock()
    provider.client.chat.completions.create.return_value = [chunk_content, chunk_tool]

    chunks = list(
        provider.stream_with_tools(
            [{"role": "user", "content": "test"}],
            tools=[{"type": "function", "function": {"name": "bash_exec"}}],
        )
    )

    assert chunks[0] == {"type": "content", "text": "hello"}
    assert chunks[1] == {
        "type": "tool_call_delta",
        "tool_index": 1,
        "tool_call_id": "call_1",
        "tool_name": "bash_exec",
        "arguments_delta": "",
    }
    assert chunks[2] == {"type": "done", "finish_reason": "tool_calls"}


def test_bailian_stream_with_tools_passes_runtime_kwargs() -> None:
    """Verify runtime kwargs and tools are passed to client call."""
    from agenticx.llms import BailianProvider

    provider = BailianProvider(model="qwen-max", api_key="test-key")

    provider.client = MagicMock()
    provider.client.chat.completions.create.return_value = []

    chunks = list(
        provider.stream_with_tools(
            [{"role": "user", "content": "test"}],
            tools=[{"type": "function", "function": {"name": "bash_exec"}}],
            tool_choice="auto",
            timeout=123,
            max_tokens=456,
        )
    )

    assert chunks == [{"type": "done", "finish_reason": ""}]
    call_kwargs = provider.client.chat.completions.create.call_args.kwargs
    assert call_kwargs["stream"] is True
    assert call_kwargs["tool_choice"] == "auto"
    assert call_kwargs["timeout"] == 123
    assert call_kwargs["max_tokens"] == 456
    assert isinstance(call_kwargs["tools"], list)


def test_bailian_stream_with_tools_native_qwen_plus() -> None:
    """Verify qwen-plus native stream path emits normalized chunks."""
    from agenticx.llms import BailianProvider

    provider = BailianProvider(model="qwen-plus", api_key="test-key")

    sse_lines = [
        'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":"1","id":"call_1","function":{"name":"bash_exec","arguments":"{\\"command\\":\\"echo hi\\"}"}}]},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_lines.return_value = sse_lines
    mock_response.__enter__.return_value = mock_response
    mock_response.__exit__.return_value = False

    with patch("agenticx.llms.bailian_provider.requests.post", return_value=mock_response):
        chunks = list(
            provider.stream_with_tools(
                [{"role": "user", "content": "test"}],
                tools=[{"type": "function", "function": {"name": "bash_exec"}}],
                tool_choice="auto",
            )
        )

    assert chunks[0] == {"type": "content", "text": "hello"}
    assert chunks[1] == {
        "type": "tool_call_delta",
        "tool_index": 1,
        "tool_call_id": "call_1",
        "tool_name": "bash_exec",
        "arguments_delta": '{"command":"echo hi"}',
    }
    assert chunks[2] == {"type": "done", "finish_reason": "tool_calls"}

