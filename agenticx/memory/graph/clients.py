#!/usr/bin/env python3
"""Build Graphiti LLM/embedder clients from AgenticX provider config.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Any, Tuple

from agenticx.memory.graph.config import MemoryGraphConfig


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

    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_client import OpenAIClient
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

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

    use_generic = llm_provider_name == "ollama" or (base_url and "11434" in base_url)
    llm_client = OpenAIGenericClient(config=llm_config) if use_generic else OpenAIClient(config=llm_config)

    embed_key = embed_pc.api_key or api_key
    embed_base = (embed_pc.base_url or base_url or "").strip() or None
    embed_model = _pick_model(cfg, "embedder", "text-embedding-3-small")
    if embed_provider_name == "ollama":
        embed_model = embed_model or "nomic-embed-text"

    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key=embed_key,
            embedding_model=embed_model,
            base_url=embed_base,
            embedding_dim=768 if embed_provider_name == "ollama" else 1536,
        )
    )

    cross_encoder = OpenAIRerankerClient(client=llm_client, config=llm_config)
    return llm_client, embedder, cross_encoder
