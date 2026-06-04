#!/usr/bin/env python3
"""Build Graphiti LLM/embedder clients from AgenticX provider config.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Any, Tuple

from agenticx.memory.graph.config import MemoryGraphConfig


def _normalize_model_name(model: str) -> str:
    """Strip provider prefix (e.g. openai/gpt-4o-mini -> gpt-4o-mini)."""
    return (model or "").strip().lower().split("/")[-1]


def model_supports_reasoning_effort(model: str) -> bool:
    """Graphiti OpenAIClient uses Responses API reasoning.effort — only o/gpt-5 families."""
    name = _normalize_model_name(model)
    return name.startswith(("gpt-5", "o1", "o3", "o4"))


def _is_official_openai_base(base_url: str | None) -> bool:
    if not base_url:
        return True
    return "api.openai.com" in base_url.lower()


def should_use_generic_openai_client(
    provider_name: str,
    base_url: str | None,
    model: str,
) -> bool:
    """Prefer chat.completions client when reasoning.effort / responses.parse are unsafe."""
    provider = (provider_name or "").strip().lower()
    if provider != "openai":
        return True
    if base_url and "11434" in base_url:
        return True
    if not _is_official_openai_base(base_url):
        return True
    if not model_supports_reasoning_effort(model):
        return True
    return False


def _pick_provider_name(cfg: MemoryGraphConfig, role: str) -> str:
    from agenticx.cli.config_manager import ConfigManager

    agx = ConfigManager.load()
    if role == "llm":
        override = cfg.llm.provider.strip()
        return override or agx.default_provider or "openai"
    override = cfg.embedder.provider.strip()
    return override or agx.default_provider or "openai"


def _pick_model(cfg: MemoryGraphConfig, role: str, default_model: str) -> str:
    if role == "llm" and cfg.llm.model.strip():
        return cfg.llm.model.strip()
    if role == "embedder" and cfg.embedder.model.strip():
        return cfg.embedder.model.strip()
    return default_model


def resolve_effective_models(cfg: MemoryGraphConfig) -> dict:
    """解析记忆构建实际使用的 provider/model（不构建客户端，供 status 展示）。"""
    from agenticx.cli.config_manager import ConfigManager

    agx = ConfigManager.load()
    llm_provider = _pick_provider_name(cfg, "llm")
    embed_provider = _pick_provider_name(cfg, "embedder")
    try:
        llm_pc = agx.get_provider(llm_provider)
        llm_default = (getattr(llm_pc, "model", None) or "gpt-4o-mini")
    except Exception:
        llm_default = "gpt-4o-mini"
    return {
        "llm_provider": llm_provider,
        "llm_model": _pick_model(cfg, "llm", llm_default),
        "embedder_provider": embed_provider,
        "embedder_model": _pick_model(cfg, "embedder", "text-embedding-3-small"),
        "default_provider": agx.default_provider or "",
    }


def build_graphiti_clients(cfg: MemoryGraphConfig) -> Tuple[Any, Any, Any]:
    """Return (llm_client, embedder, cross_encoder) for Graphiti."""
    from agenticx.cli.config_manager import ConfigManager

    agx = ConfigManager.load()
    llm_provider_name = _pick_provider_name(cfg, "llm")
    embed_provider_name = _pick_provider_name(cfg, "embedder")
    llm_pc = agx.get_provider(llm_provider_name)
    embed_pc = agx.get_provider(embed_provider_name)

    from agenticx.memory.graph.embedder import CompatOpenAIEmbedder
    from agenticx.memory.graph.llm_client import CompatOpenAIGenericClient
    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
    from graphiti_core.embedder.openai import OpenAIEmbedderConfig
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_client import OpenAIClient

    api_key = llm_pc.api_key or os.environ.get("OPENAI_API_KEY") or "not-set"
    base_url = (llm_pc.base_url or os.environ.get("OPENAI_BASE_URL") or "").strip() or None
    model = _pick_model(cfg, "llm", llm_pc.model or "gpt-4o-mini")
    small_model = model

    llm_config = LLMConfig(
        api_key=api_key,
        model=model,
        small_model=small_model,
        base_url=base_url,
    )

    use_generic = should_use_generic_openai_client(llm_provider_name, base_url, model)
    if use_generic:
        llm_client = CompatOpenAIGenericClient(
            config=llm_config,
            provider_name=llm_provider_name,
            base_url=base_url,
        )
    else:
        # Graphiti OpenAIClient defaults reasoning='minimal' -> reasoning.effort on Responses API.
        # Only pass these knobs when the configured model actually supports them.
        llm_client = OpenAIClient(
            config=llm_config,
            reasoning="minimal",
            verbosity="low",
        )

    embed_key = embed_pc.api_key or api_key
    embed_base = (embed_pc.base_url or base_url or "").strip() or None
    embed_model = _pick_model(cfg, "embedder", "text-embedding-3-small")
    if embed_provider_name == "ollama":
        embed_model = embed_model or "nomic-embed-text"

    embed_dim = 768 if embed_provider_name == "ollama" else 1536

    embedder = CompatOpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key=embed_key,
            embedding_model=embed_model,
            base_url=embed_base,
            embedding_dim=embed_dim,
        ),
        provider_name=embed_provider_name,
        base_url=embed_base,
    )

    # Reranker expects AsyncOpenAI, not Graphiti LLM wrapper instances.
    async_openai = getattr(llm_client, "client", llm_client)
    cross_encoder = OpenAIRerankerClient(client=async_openai, config=llm_config)
    return llm_client, embedder, cross_encoder
