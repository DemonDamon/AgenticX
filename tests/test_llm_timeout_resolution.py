"""Timeout / first-feedback resolution for GLM company routes.

Ported-ref: fix/glm-stream-common-finalization@5bf63d3e

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli.studio import StudioSession
from agenticx.runtime.agent_runtime import (
    DEFAULT_LLM_FIRST_FEEDBACK_SECONDS,
    DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS,
    _resolve_llm_first_feedback_seconds,
    _resolve_llm_invoke_timeout_seconds,
)


def _session(provider: str, model: str) -> StudioSession:
    session = StudioSession()
    session.provider_name = provider
    session.model_name = model
    return session


def test_company_glm_route_uses_model_aware_timeout(monkeypatch) -> None:
    for name in (
        "AGX_LLM_INVOKE_TIMEOUT_SECONDS",
        "AGX_LLM_FIRST_FEEDBACK_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)

    glm52 = _session("custom_openai_glm", "glm-5.2")
    assert _resolve_llm_invoke_timeout_seconds(glm52) == 180.0
    assert _resolve_llm_first_feedback_seconds(glm52) == 10.0

    glm47 = _session("custom_openai_glm", "glm-4.7")
    assert _resolve_llm_invoke_timeout_seconds(glm47) == 150.0
    assert _resolve_llm_first_feedback_seconds(glm47) == 10.0


def test_unknown_route_keeps_conservative_defaults(monkeypatch) -> None:
    monkeypatch.delenv("AGX_LLM_INVOKE_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("AGX_LLM_FIRST_FEEDBACK_SECONDS", raising=False)
    unknown = _session("custom_openai_unknown", "unknown-model")
    assert _resolve_llm_invoke_timeout_seconds(unknown) == DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS
    assert _resolve_llm_first_feedback_seconds(unknown) == DEFAULT_LLM_FIRST_FEEDBACK_SECONDS
