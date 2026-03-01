#!/usr/bin/env python3
"""Smoke tests for OpenClaw-inspired auth profile rotation.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Generator, List, Union

from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.auth_profile import AuthProfile, AuthProfileManager
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage


class _FakeProvider(BaseLLMProvider):
    key_behaviour: Dict[str, str]
    calls: int = 0

    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        _ = prompt
        self.calls += 1
        api_key = kwargs.get("api_key", "")
        behaviour = self.key_behaviour.get(api_key, "ok")
        if behaviour != "ok":
            raise RuntimeError(behaviour)
        return LLMResponse(
            id="resp_1",
            model_name=self.model,
            created=1,
            content="ok",
            choices=[LLMChoice(index=0, content="ok")],
            token_usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
            cost=0.0,
            metadata={},
        )

    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        return self.invoke(prompt, **kwargs)

    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        _ = prompt, kwargs
        yield "ok"

    async def astream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> AsyncGenerator[Union[str, Dict], None]:
        _ = prompt, kwargs
        yield "ok"


def _build_profiles() -> List[AuthProfile]:
    return [
        AuthProfile(name="p1", provider="openai", api_key="k1"),
        AuthProfile(name="p2", provider="openai", api_key="k2"),
    ]


class TestAuthProfileManager:
    def test_backoff_formula(self):
        manager = AuthProfileManager(profiles=_build_profiles(), persistence_path=None)
        p1 = manager.get_current()
        assert p1 is not None

        manager.mark_failure("p1", "rate_limit")
        p1_after = manager.profiles[0]
        first_cd = p1_after.cooldown.cooldown_until
        assert first_cd > 0

        manager.mark_failure("p1", "rate_limit")
        p1_after_2 = manager.profiles[0]
        assert p1_after_2.cooldown.cooldown_until > first_cd

    def test_persistence_round_trip(self, tmp_path: Path):
        persist = tmp_path / "auth-profiles.json"
        manager = AuthProfileManager(profiles=_build_profiles(), persistence_path=persist)
        manager.mark_failure("p1", "billing")

        manager2 = AuthProfileManager(profiles=_build_profiles(), persistence_path=persist)
        p1 = manager2.profiles[0]
        assert p1.cooldown.error_count == 1
        assert p1.cooldown.failure_type == "billing"
        assert p1.cooldown.cooldown_until > 0

    def test_rotation_in_executor(self):
        provider = _FakeProvider(
            model="fake",
            key_behaviour={
                "k1": "rate limit exceeded",
                "k2": "ok",
            },
        )
        manager = AuthProfileManager(profiles=_build_profiles())
        executor = AgentExecutor(llm_provider=provider, auth_profile_manager=manager)

        response = executor._invoke_llm_with_auth_rotation([{"role": "user", "content": "hi"}])

        assert response.content == "ok"
        assert provider.calls >= 2
        assert manager.profiles[0].cooldown.error_count == 1

    def test_all_profiles_unavailable_raises(self):
        provider = _FakeProvider(
            model="fake",
            key_behaviour={"k1": "unauthorized", "k2": "unauthorized"},
        )
        manager = AuthProfileManager(profiles=_build_profiles())
        executor = AgentExecutor(llm_provider=provider, auth_profile_manager=manager)

        raised = False
        try:
            executor._invoke_llm_with_auth_rotation([{"role": "user", "content": "hi"}])
        except Exception:
            raised = True
        assert raised is True
