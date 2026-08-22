from __future__ import annotations

import asyncio
from types import SimpleNamespace

from agenticx.cli.studio import StudioSession
from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.llms.response import TokenUsage
from agenticx.llms.usage import normalize_token_usage
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response


def _raw_response(
    *, usage: object, hidden_usage: object | None = None
) -> SimpleNamespace:
    message = SimpleNamespace(content="ok", tool_calls=None, reasoning_content=None)
    return SimpleNamespace(
        id="response-1",
        model="openai/test-model",
        created=1,
        usage=usage,
        choices=[SimpleNamespace(index=0, message=message, finish_reason="stop")],
        _hidden_params={"original_response_usage": hidden_usage}
        if hidden_usage is not None
        else {},
    )


def test_normalize_litellm_usage_details() -> None:
    usage = SimpleNamespace(
        prompt_tokens=120,
        completion_tokens=30,
        total_tokens=150,
        prompt_tokens_details=SimpleNamespace(cached_tokens=96),
        completion_tokens_details=SimpleNamespace(reasoning_tokens=12),
    )

    normalized = normalize_token_usage(usage)

    assert normalized == TokenUsage(
        prompt_tokens=120,
        completion_tokens=30,
        total_tokens=150,
        cached_tokens=96,
        reasoning_tokens=12,
    )


def test_normalize_responses_api_usage_details_and_derive_total() -> None:
    normalized = normalize_token_usage(
        {
            "input_tokens": "80",
            "output_tokens": 20,
            "input_tokens_details": {"cached_tokens": 64},
            "output_tokens_details": {"reasoning_tokens": 7},
        }
    )

    assert normalized == TokenUsage(
        prompt_tokens=80,
        completion_tokens=20,
        total_tokens=100,
        cached_tokens=64,
        reasoning_tokens=7,
    )


def test_litellm_parse_merges_hidden_cache_details_with_primary_counts() -> None:
    provider = LiteLLMProvider(model="openai/test-model", api_key="test", timeout=1)
    response = _raw_response(
        usage={"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150},
        hidden_usage={
            "prompt_tokens": 120,
            "completion_tokens": 30,
            "total_tokens": 150,
            "prompt_tokens_details": {"cached_tokens": 96},
            "completion_tokens_details": {"reasoning_tokens": 12},
        },
    )

    parsed = provider._parse_response(response)

    assert parsed.token_usage.cached_tokens == 96
    assert parsed.token_usage.reasoning_tokens == 12
    assert parsed.token_usage.total_tokens == 150


def test_litellm_tool_stream_preserves_extended_usage(monkeypatch) -> None:
    provider = LiteLLMProvider(model="openai/test-model", api_key="test", timeout=1)
    chunk = SimpleNamespace(
        usage={"prompt_tokens": 100, "completion_tokens": 25, "total_tokens": 125},
        choices=[],
        _hidden_params={
            "original_response_usage": {
                "prompt_tokens_details": {"cached_tokens": 75},
                "completion_tokens_details": {"reasoning_tokens": 8},
            }
        },
    )
    call_kwargs: dict[str, object] = {}

    def fake_completion(**kwargs):
        call_kwargs.update(kwargs)
        return iter([chunk])

    monkeypatch.setattr(
        "agenticx.llms.litellm_provider.litellm.completion", fake_completion
    )

    events = list(provider.stream_with_tools("hello"))
    usage_event = next(event for event in events if event["type"] == "usage")

    assert call_kwargs["stream_options"] == {"include_usage": True}
    assert usage_event["usage"] == {
        "prompt_tokens": 100,
        "completion_tokens": 25,
        "total_tokens": 125,
        "cached_tokens": 75,
        "reasoning_tokens": 8,
    }


def test_usage_metadata_merges_token_usage_and_raw_usage_details() -> None:
    response = SimpleNamespace(
        token_usage=TokenUsage(
            prompt_tokens=90,
            completion_tokens=10,
            total_tokens=100,
        ),
        usage={
            "prompt_tokens_details": {"cached_tokens": 70},
            "completion_tokens_details": {"reasoning_tokens": 6},
        },
    )

    assert usage_metadata_from_llm_response(response) == {
        "input_tokens": 90,
        "output_tokens": 10,
        "total_tokens": 100,
        "cached_tokens": 70,
        "reasoning_tokens": 6,
    }


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context=None) -> bool:
        return True


class _UsageStreamLLM:
    def stream_with_tools(self, *_args, **_kwargs):
        yield {"type": "content", "text": "done"}
        yield {
            "type": "usage",
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 25,
                "total_tokens": 125,
                "cached_tokens": 75,
                "reasoning_tokens": 8,
            },
        }
        yield {"type": "done", "finish_reason": "stop"}


class _CaptureUsageStore:
    def __init__(self) -> None:
        self.rows: list[dict[str, object]] = []

    async def record_async(self, **kwargs) -> None:
        self.rows.append(dict(kwargs))


async def test_runtime_stream_keeps_cache_usage_through_final_and_store(
    monkeypatch,
) -> None:
    store = _CaptureUsageStore()
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)
    runtime = AgentRuntime(_UsageStreamLLM(), _ApproveGate())
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-4.5-air"

    events = [
        event
        async for event in runtime.run_turn(
            "hello",
            session,
            usage_session_id="cache-usage-contract",
        )
    ]
    await asyncio.sleep(0)

    final = next(event for event in events if event.type == EventType.FINAL.value)
    assert final.data["usage_metadata"]["cached_tokens"] == 75
    assert final.data["usage_metadata"]["reasoning_tokens"] == 8
    assert store.rows[-1]["cached_tokens"] == 75
    assert store.rows[-1]["reasoning_tokens"] == 8
