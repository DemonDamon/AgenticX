"""
AgenticX LLM Service Provider Module

This module provides a unified interface for interacting with various Large Language Models.
"""

from .base import BaseLLMProvider
from .response import LLMResponse, LLMChoice, TokenUsage
from .litellm_provider import LiteLLMProvider

# Convenience re-exports for specific models, all using LiteLLMProvider
# This makes it easy to instantiate a specific provider type.

class OpenAIProvider(LiteLLMProvider):
    """Provider for OpenAI models, e.g., 'gpt-4', 'gpt-3.5-turbo'."""
    pass

class AnthropicProvider(LiteLLMProvider):
    """Provider for Anthropic models, e.g., 'claude-3-opus-20240229'."""
    pass

class OllamaProvider(LiteLLMProvider):
    """Provider for local Ollama models, e.g., 'ollama/llama3'."""
    pass

class GeminiProvider(LiteLLMProvider):
    """Provider for Google Gemini models, e.g., 'gemini/gemini-pro'."""
    pass


__all__ = [
    # Base classes and data structures
    "BaseLLMProvider",
    "LLMResponse",
    "LLMChoice",
    "TokenUsage",
    
    # Concrete provider implementation
    "LiteLLMProvider",
    
    # Convenience classes
    "OpenAIProvider",
    "AnthropicProvider",
    "OllamaProvider",
    "GeminiProvider",
] 