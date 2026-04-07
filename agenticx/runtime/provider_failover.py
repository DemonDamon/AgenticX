#!/usr/bin/env python3
"""Provider failover manager for automatic model switching on persistent failure.

Reads ``llm.failover_chain`` from ``~/.agenticx/config.yaml`` and attempts
alternative providers when the primary provider has exhausted all retries.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Dict, List, Optional, Tuple

_log = logging.getLogger(__name__)


def _load_failover_chain() -> List[Dict[str, str]]:
    """Load failover chain from config.yaml ``llm.failover_chain``."""
    try:
        from agenticx.cli.config_manager import ConfigManager
        val = ConfigManager.get_value("llm.failover_chain")
    except Exception:
        val = None
    if isinstance(val, list):
        entries: List[Dict[str, str]] = []
        for item in val:
            if isinstance(item, dict) and item.get("provider") and item.get("model"):
                entries.append({
                    "provider": str(item["provider"]).strip(),
                    "model": str(item["model"]).strip(),
                })
        return entries
    return []


class ProviderFailoverManager:
    """Try alternative LLM providers when the primary consistently fails.

    Designed to be called **after** the retry layer (LLMRetryPolicy) has
    exhausted all attempts on the current provider.

    Usage::

        fm = ProviderFailoverManager(primary_provider="openai", primary_model="gpt-4.1")
        for provider, model, llm in fm.failover_attempts():
            try:
                response = llm.invoke(messages, ...)
                break  # success
            except Exception:
                continue  # try next in chain
    """

    def __init__(
        self,
        primary_provider: str = "",
        primary_model: str = "",
        *,
        on_switch: Optional[Callable[[str, str], None]] = None,
    ) -> None:
        self.primary_provider = primary_provider.strip().lower()
        self.primary_model = primary_model.strip()
        self.on_switch = on_switch
        self._chain = _load_failover_chain()
        self._current_index = -1

    @property
    def has_alternatives(self) -> bool:
        return len(self._effective_chain) > 0

    @property
    def _effective_chain(self) -> List[Dict[str, str]]:
        """Chain entries excluding the primary provider+model combo."""
        return [
            e for e in self._chain
            if not (
                e["provider"].lower() == self.primary_provider
                and e["model"] == self.primary_model
            )
        ]

    def failover_attempts(self):
        """Yield (provider_name, model_name, llm_instance) for each alternative.

        Callers should try the yielded LLM and break on success.
        """
        from agenticx.llms.provider_resolver import ProviderResolver

        for idx, entry in enumerate(self._effective_chain):
            provider = entry["provider"]
            model = entry["model"]
            try:
                llm = ProviderResolver.resolve(provider_name=provider, model=model)
            except Exception as exc:
                _log.warning("Failover: could not resolve %s/%s: %s", provider, model, exc)
                continue

            self._current_index = idx
            _log.info("Failover: switching to %s/%s", provider, model)
            if self.on_switch:
                try:
                    self.on_switch(provider, model)
                except Exception:
                    pass
            yield provider, model, llm

    def resolve_with_failover(
        self,
        invoke_fn: Callable[..., Any],
        messages: list,
        *,
        primary_llm: Any,
        invoke_kwargs: Dict[str, Any],
    ) -> Tuple[Any, Optional[str], Optional[str]]:
        """Try primary LLM, then failover chain.

        Returns (response, switched_provider, switched_model).
        switched_provider/switched_model are None if primary succeeded.
        """
        try:
            result = invoke_fn(primary_llm, messages, **invoke_kwargs)
            return result, None, None
        except Exception as primary_exc:
            _log.warning("Primary LLM failed, attempting failover: %s", primary_exc)

        for provider, model, llm in self.failover_attempts():
            try:
                result = invoke_fn(llm, messages, **invoke_kwargs)
                return result, provider, model
            except Exception as exc:
                _log.warning("Failover %s/%s also failed: %s", provider, model, exc)
                continue

        raise RuntimeError(
            f"All providers failed (primary={self.primary_provider}/{self.primary_model}, "
            f"failover_chain_size={len(self._effective_chain)})"
        )
