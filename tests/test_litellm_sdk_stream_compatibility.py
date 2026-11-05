"""Exercise the real model SDK and HTTP client against synthetic SSE data."""

import json

import httpx
import openai

from agenticx.llms.litellm_provider import LiteLLMProvider


def _stream_client(events, requests):
    body = "".join(f"data: {json.dumps(event)}\n\n" for event in events) + "data: [DONE]\n\n"

    def reply(request):
        requests.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

    return openai.OpenAI(
        api_key="test", base_url="https://example.invalid/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(reply)),
    )


def _event(delta, finish=None):
    return {"id": "chat-1", "object": "chat.completion.chunk", "created": 1,
            "model": "provider-a/model-a",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


def test_openai_compatible_stream_preserves_model_and_text():
    requests = []
    client = _stream_client([_event({"content": "hello"}), _event({"content": " world"}, "stop")], requests)
    try:
        provider = LiteLLMProvider(model="openai/provider-a/model-a", api_key="test", base_url="https://example.invalid/v1")
        assert "".join(provider.stream("hi", client=client, timeout=1)) == "hello world"
        assert len(requests) == 1
        assert requests[0].url.path == "/v1/chat/completions"
        sent = json.loads(requests[0].content)
        assert sent["stream"] is True
        assert sent["model"] == "provider-a/model-a"
    finally:
        client.close()


def test_real_sdk_preserves_reasoning_tools_usage_and_finish():
    requests = []
    events = [
        _event({"reasoning_content": "Plan"}),
        _event({"content": "Answer"}),
        _event({"tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "lookup", "arguments": '{"q":'}}]}),
        _event({"tool_calls": [{"index": 0, "function": {"arguments": '"value"}'}}]}, "tool_calls"),
        {"id": "chat-1", "object": "chat.completion.chunk", "created": 1,
         "model": "provider-a/model-a", "choices": [],
         "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16,
                   "prompt_tokens_details": {"cached_tokens": 3}}},
    ]
    client = _stream_client(events, requests)
    try:
        provider = LiteLLMProvider(model="openai/provider-a/model-a", api_key="test", base_url="https://example.invalid/v1")
        tools = [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object", "properties": {"q": {"type": "string"}}}}}]
        chunks = list(provider.stream_with_tools("hi", tools=tools, client=client, timeout=1))
        text = "".join(row["text"] for row in chunks if row["type"] == "content")
        assert text == "<think>Plan</think>\nAnswer"
        deltas = [row for row in chunks if row["type"] == "tool_call_delta"]
        assert deltas[0]["tool_name"] == "lookup"
        assert deltas[0]["tool_call_id"] == "call-1"
        assert "".join(row["arguments_delta"] for row in deltas) == '{"q":"value"}'
        usage = next(row["usage"] for row in chunks if row["type"] == "usage")
        assert usage["prompt_tokens"] == 12
        assert usage["completion_tokens"] == 4
        assert usage["total_tokens"] == 16
        assert usage["cached_tokens"] == 3
        assert chunks[-1] == {"type": "done", "finish_reason": "tool_calls"}
        assert len(requests) == 1
        sent = json.loads(requests[0].content)
        assert sent["stream_options"]["include_usage"] is True
        assert sent["tools"][0]["function"]["name"] == "lookup"
    finally:
        client.close()


def test_real_sdk_round_trip_continues_after_tool_result():
    requests = []
    first = [_event({"tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "lookup", "arguments": "{}"}}]}, "tool_calls")]
    second = [_event({"content": "Confirmed result"}, "stop")]

    def reply(request):
        requests.append(request)
        events = first if len(requests) == 1 else second
        body = "".join(f"data: {json.dumps(event)}\n\n" for event in events) + "data: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

    client = openai.OpenAI(api_key="test", base_url="https://example.invalid/v1",
                          http_client=httpx.Client(transport=httpx.MockTransport(reply)))
    try:
        provider = LiteLLMProvider(model="openai/provider-a/model-a", api_key="test", base_url="https://example.invalid/v1")
        tools = [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object", "properties": {}}}}]
        initial = list(provider.stream_with_tools("hi", tools=tools, client=client, timeout=1))
        assert initial[-1]["finish_reason"] == "tool_calls"
        history = [{"role": "user", "content": "hi"},
                   {"role": "assistant", "content": None, "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "lookup", "arguments": "{}"}}]},
                   {"role": "tool", "tool_call_id": "call-1", "content": "synthetic-result"}]
        final = list(provider.stream_with_tools(history, tools=tools, client=client, timeout=1))
        assert "".join(row["text"] for row in final if row["type"] == "content") == "Confirmed result"
        assert final[-1] == {"type": "done", "finish_reason": "stop"}
        assert len(requests) == 2
        sent = json.loads(requests[-1].content)
        assert sent["messages"][-1] == {"role": "tool", "tool_call_id": "call-1", "content": "synthetic-result"}
    finally:
        client.close()
