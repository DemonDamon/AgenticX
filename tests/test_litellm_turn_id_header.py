#!/usr/bin/env python3
"""Request-scoped task-id forwarding for LiteLLM calls."""

from __future__ import annotations

import asyncio
from typing import Any

import agenticx.llms.litellm_provider as provider_module
from agenticx.llms.litellm_provider import LiteLLMProvider, TURN_ID_HEADER
from agenticx.llms.request_context import (
    current_llm_turn_id,
    reset_current_llm_turn_id,
    set_current_llm_turn_id,
)


class _Response:
    id = "response"
    model = "openai/test"
    created = 0
    usage: dict[str, int] = {}
    choices: list[Any] = []


def test_all_litellm_entrypoints_forward_one_context_task_id(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    def _completion(**kwargs: Any):
        calls.append(kwargs)
        return [] if kwargs.get("stream") else _Response()

    async def _acompletion(**kwargs: Any):
        calls.append(kwargs)
        if kwargs.get("stream"):
            async def _empty_stream():
                if False:
                    yield None

            return _empty_stream()
        return _Response()

    monkeypatch.setattr(provider_module.litellm, "completion", _completion)
    monkeypatch.setattr(provider_module.litellm, "acompletion", _acompletion)
    provider = LiteLLMProvider(
        model="openai/test",
        api_key="test",
        forward_turn_id_header=True,
    )

    async def _exercise_async() -> None:
        await provider.ainvoke("hello", timeout=1)
        async for _chunk in provider._astream_generator("hello", timeout=1):
            pass

    token = set_current_llm_turn_id("turn-123")
    try:
        provider.invoke("hello", timeout=1)
        list(provider.stream("hello", timeout=1))
        list(provider.stream_with_tools("hello", timeout=1))
        asyncio.run(_exercise_async())
    finally:
        reset_current_llm_turn_id(token)

    assert len(calls) == 5
    assert all(call["extra_headers"][TURN_ID_HEADER] == "turn-123" for call in calls)
    assert current_llm_turn_id() == ""


def test_caller_turn_id_header_wins_case_insensitively(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def _completion(**kwargs: Any):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr(provider_module.litellm, "completion", _completion)
    provider = LiteLLMProvider(
        model="openai/test",
        api_key="test",
        forward_turn_id_header=True,
    )
    token = set_current_llm_turn_id("context-value")
    try:
        provider.invoke(
            "hello",
            timeout=1,
            extra_headers={"x-agenticx-turn-id": "caller-value", "X-Other": "kept"},
        )
    finally:
        reset_current_llm_turn_id(token)

    assert captured["extra_headers"] == {
        "x-agenticx-turn-id": "caller-value",
        "X-Other": "kept",
    }


def test_self_managed_provider_does_not_receive_context_task_id(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def _completion(**kwargs: Any):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr(provider_module.litellm, "completion", _completion)
    provider = LiteLLMProvider(
        model="openai/test",
        api_key="test",
        base_url="https://self-managed.example/v1",
    )
    token = set_current_llm_turn_id("internal-turn-id")
    try:
        provider.invoke("hello", timeout=1, extra_headers={"X-Other": "kept"})
    finally:
        reset_current_llm_turn_id(token)

    assert captured["extra_headers"] == {"X-Other": "kept"}


def test_explicit_caller_task_id_is_forwarded_even_when_context_forwarding_is_disabled(
    monkeypatch,
) -> None:
    captured: dict[str, Any] = {}

    def _completion(**kwargs: Any):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr(provider_module.litellm, "completion", _completion)
    provider = LiteLLMProvider(model="openai/test", api_key="test")
    token = set_current_llm_turn_id("internal-turn-id")
    try:
        provider.invoke(
            "hello",
            timeout=1,
            extra_headers={"x-agenticx-turn-id": "caller-turn-id"},
        )
    finally:
        reset_current_llm_turn_id(token)

    assert captured["extra_headers"] == {
        "x-agenticx-turn-id": "caller-turn-id",
    }


def test_invalid_context_task_id_is_not_forwarded(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def _completion(**kwargs: Any):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr(provider_module.litellm, "completion", _completion)
    provider = LiteLLMProvider(
        model="openai/test",
        api_key="test",
        forward_turn_id_header=True,
    )
    token = set_current_llm_turn_id("bad/id")
    try:
        provider.invoke("hello", timeout=1)
    finally:
        reset_current_llm_turn_id(token)

    assert "extra_headers" not in captured
