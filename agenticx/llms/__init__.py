"""
AgenticX LLM Service Provider Module

This module provides a unified interface for interacting with various Large Language Models.
"""

from .base import BaseLLMProvider
from .response import LLMResponse, LLMChoice, TokenUsage
try:  # sandbox may block SSL when importing litellm/requests
    from .litellm_provider import LiteLLMProvider
    from .kimi_provider import KimiProvider
    from .bailian_provider import BailianProvider
    from .llm_factory import LlmFactory
except Exception:  # pragma: no cover
    LiteLLMProvider = None  # type: ignore
    KimiProvider = None  # type: ignore
    BailianProvider = None  # type: ignore
    LlmFactory = None  # type: ignore

# Convenience re-exports for specific models, all using LiteLLMProvider
# This makes it easy to instantiate a specific provider type.

class OpenAIProvider(LiteLLMProvider if LiteLLMProvider else object):  # type: ignore
    """Provider for OpenAI models, e.g., 'gpt-4', 'gpt-3.5-turbo'."""
    pass

class AnthropicProvider(LiteLLMProvider if LiteLLMProvider else object):  # type: ignore
    """Provider for Anthropic models, e.g., 'claude-3-opus-20240229'."""
    pass

class OllamaProvider(LiteLLMProvider if LiteLLMProvider else object):  # type: ignore
    """Provider for local Ollama models, e.g., 'ollama/llama3'."""
    pass

class GeminiProvider(LiteLLMProvider if LiteLLMProvider else object):  # type: ignore
    """Provider for Google Gemini models, e.g., 'gemini/gemini-pro'."""
    pass

# Dedicated provider for Kimi (Moonshot AI)
class MoonshotProvider(KimiProvider if KimiProvider else object):  # type: ignore
    """Provider for Moonshot AI Kimi models, e.g., 'kimi-k2-0711-preview'."""
    pass

# Dedicated provider for Bailian (Alibaba Cloud Dashscope)
class DashscopeProvider(BailianProvider if BailianProvider else object):  # type: ignore
    """Provider for Alibaba Cloud Bailian/Dashscope models, e.g., 'qwen-vl-plus'."""
    pass


__all__ = [
    # Base classes and data structures
    "BaseLLMProvider",
    "LLMResponse",
    "LLMChoice",
    "TokenUsage",
    
    # Concrete provider implementations
    "LiteLLMProvider",
    "KimiProvider",
    "BailianProvider",
    "LlmFactory",
    
    # Convenience classes
    "OpenAIProvider",
    "AnthropicProvider",
    "OllamaProvider",
    "GeminiProvider",
    "MoonshotProvider",
    "DashscopeProvider",
]