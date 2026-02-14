#!/usr/bin/env python3
"""
Smoke tests for AgenticX AgentKit Wrapper.

Tests the AgenticXAgentWrapper that adapts AgenticX Agents to AgentKit protocol.

Author: Damon Li
"""

import pytest
import json
from unittest.mock import Mock, MagicMock


def _create_test_agent():
    """Create a test agent using model_construct to avoid validation issues."""
    from agenticx.core import Agent
    
    # Use model_construct to bypass validation
    return Agent.model_construct(
        name="test-agent",
        role="assistant",
        goal="help users",
        organization_id="test-org",
        allow_delegation=False,
        max_iterations=25,
        max_retry_limit=2
    )


def test_wrapper_handle_invoke_happy_path():
    """Test wrapper handles invoke request successfully."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    # Create test agent
    agent = _create_test_agent()
    
    mock_llm = Mock()
    mock_llm.generate = Mock(return_value=Mock(content="Hello, I can help you!"))
    
    # Create wrapper
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Mock the executor to return a simple result
    wrapper.executor = Mock()
    wrapper.executor.run = Mock(return_value={"result": "Test response"})
    
    # Test invoke
    payload = {"prompt": "Hello"}
    headers = {"user_id": "user1", "session_id": "sess1"}
    
    result = wrapper.handle_invoke(payload, headers)
    
    assert result == "Test response"
    assert wrapper.executor.run.called


def test_wrapper_handle_invoke_missing_prompt():
    """Test wrapper handles missing prompt field gracefully."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Test with missing prompt
    payload = {}
    headers = {"user_id": "user1"}
    
    result = wrapper.handle_invoke(payload, headers)
    
    # Should return error JSON
    error_obj = json.loads(result)
    assert "error" in error_obj
    assert "prompt" in error_obj["error"]["message"].lower()


def test_wrapper_handle_invoke_exception():
    """Test wrapper handles execution exceptions gracefully."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Mock executor to raise exception
    wrapper.executor = Mock()
    wrapper.executor.run = Mock(side_effect=RuntimeError("Test error"))
    
    payload = {"prompt": "Hello"}
    headers = {"user_id": "user1"}
    
    result = wrapper.handle_invoke(payload, headers)
    
    # Should return error JSON
    error_obj = json.loads(result)
    assert "error" in error_obj
    assert "Test error" in error_obj["error"]["message"]


def test_wrapper_ping():
    """Test ping endpoint returns pong."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    assert wrapper.ping() == "pong!"


@pytest.mark.asyncio
async def test_wrapper_handle_invoke_stream():
    """Test streaming invoke returns SSE-formatted events."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Mock executor
    wrapper.executor = Mock()
    wrapper.executor.run = Mock(return_value={"result": "Streaming response"})
    
    payload = {"prompt": "Hello"}
    headers = {"user_id": "user1"}
    
    # Collect stream
    events = []
    async for event in wrapper.handle_invoke_stream(payload, headers):
        events.append(event)
    
    # Should have at least one event
    assert len(events) > 0
    
    # Events should be SSE formatted
    assert events[0].startswith("data: ")
    assert events[0].endswith("\n\n")


def test_wrapper_generate_wrapper_file_basic(tmp_path):
    """Test generation of basic wrapper file."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Generate wrapper file
    output_path = tmp_path / "wrapper.py"
    result = wrapper.generate_wrapper_file(
        output_path=str(output_path),
        agent_module="my_agent",
        agent_var="agent",
        streaming=False
    )
    
    # Check file was created
    assert output_path.exists()
    
    # Check content
    content = output_path.read_text()
    assert "from my_agent import agent" in content
    assert "AgentkitSimpleApp" in content
    assert "app.entrypoint" in content
    assert "app.ping" in content


def test_wrapper_generate_wrapper_file_streaming(tmp_path):
    """Test generation of streaming wrapper file."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Generate streaming wrapper file
    output_path = tmp_path / "wrapper_stream.py"
    result = wrapper.generate_wrapper_file(
        output_path=str(output_path),
        agent_module="my_agent",
        agent_var="agent",
        streaming=True
    )
    
    # Check file was created
    assert output_path.exists()
    
    # Check streaming-specific content
    content = output_path.read_text()
    assert "async def run" in content
    assert "yield event" in content


# --- P1: Additional SSE streaming tests ---

@pytest.mark.asyncio
async def test_wrapper_stream_sse_format_contains_json():
    """Test that SSE events contain valid JSON data."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Mock executor without run_stream to trigger fallback path
    mock_executor = Mock()
    mock_executor.run = Mock(return_value={"result": "JSON test"})
    # Remove run_stream so the wrapper falls back to sync execution
    if hasattr(mock_executor, "run_stream"):
        del mock_executor.run_stream
    wrapper.executor = mock_executor
    
    payload = {"prompt": "Hello"}
    headers = {"user_id": "user1"}
    
    events = []
    async for event in wrapper.handle_invoke_stream(payload, headers):
        events.append(event)
    
    # Parse SSE data
    assert len(events) == 1
    sse_event = events[0]
    
    # Extract JSON from "data: {json}\n\n"
    assert sse_event.startswith("data: ")
    json_str = sse_event[len("data: "):].rstrip("\n")
    parsed = json.loads(json_str)
    
    assert "content" in parsed
    assert parsed["content"] == "JSON test"
    assert parsed["type"] == "final"


@pytest.mark.asyncio
async def test_wrapper_stream_error_event():
    """Test SSE error event format when executor fails during streaming."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    # Mock executor to return error JSON from handle_invoke
    wrapper.executor = Mock()
    wrapper.executor.run = Mock(side_effect=ValueError("Stream error"))
    
    payload = {"prompt": "Hello"}
    headers = {}
    
    events = []
    async for event in wrapper.handle_invoke_stream(payload, headers):
        events.append(event)
    
    # Should still get an SSE event (error is caught in handle_invoke)
    assert len(events) >= 1
    sse_event = events[0]
    assert sse_event.startswith("data: ")


def test_wrapper_convert_to_sse_dict():
    """Test _convert_to_sse with a dict input."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    result = wrapper._convert_to_sse({"key": "value"})
    
    assert result == 'data: {"key": "value"}\n\n'


def test_wrapper_convert_to_sse_string():
    """Test _convert_to_sse with a string input."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    result = wrapper._convert_to_sse("raw string")
    
    assert result == "data: raw string\n\n"


def test_wrapper_format_error():
    """Test error formatting matches AgentKit standard."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    result = wrapper._format_error("Something went wrong", "InternalError")
    parsed = json.loads(result)
    
    assert parsed == {
        "error": {
            "message": "Something went wrong",
            "type": "InternalError"
        }
    }


# --- P1: Additional wrapper file generation tests ---

def test_wrapper_generate_file_template_substitution(tmp_path):
    """Test that template variables are correctly substituted."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    output_path = tmp_path / "wrapper.py"
    wrapper.generate_wrapper_file(
        output_path=str(output_path),
        agent_module="finance_agent.core",
        agent_var="my_finance_agent",
        streaming=False,
    )
    
    content = output_path.read_text()
    
    # Verify correct substitution
    assert "from finance_agent.core import my_finance_agent" in content
    assert "agent=my_finance_agent" in content
    assert "finance_agent.core.py" in content  # agent_file_name


def test_wrapper_generate_file_runnable(tmp_path):
    """Test that generated wrapper has if __name__ == '__main__' block."""
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    
    agent = _create_test_agent()
    mock_llm = Mock()
    wrapper = AgenticXAgentWrapper(agent, mock_llm)
    
    output_path = tmp_path / "wrapper.py"
    wrapper.generate_wrapper_file(
        output_path=str(output_path),
        agent_module="my_agent",
        agent_var="agent",
        streaming=False,
    )
    
    content = output_path.read_text()
    
    assert '__name__ == "__main__"' in content
    assert 'app.run(host="0.0.0.0", port=8000)' in content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
