"""
Smoke tests for VeADK Model Fallback feature.

Tests the fallback model list support in LiteLLMProvider.
"""

import pytest
from agenticx.llms.litellm_provider import LiteLLMProvider


class TestModelFallback:
    """Test suite for Model Fallback feature."""
    
    def test_fallback_field_initialization(self):
        """Test that fallbacks field can be initialized."""
        provider = LiteLLMProvider(
            model="gpt-4",
            api_key="test-key",
            fallbacks=["gpt-3.5-turbo", "claude-3-opus"]
        )
        assert provider.fallbacks == ["gpt-3.5-turbo", "claude-3-opus"]
        assert provider.model == "gpt-4"
    
    def test_fallback_field_none_default(self):
        """Test that fallbacks defaults to None for backward compatibility."""
        provider = LiteLLMProvider(
            model="gpt-4",
            api_key="test-key"
        )
        assert provider.fallbacks is None
        assert provider.model == "gpt-4"
    
    def test_from_config_with_fallbacks(self):
        """Test from_config method correctly parses fallbacks."""
        config = {
            "model": "gpt-4",
            "api_key": "test-key",
            "fallbacks": ["gpt-3.5-turbo", "claude-3-opus"]
        }
        provider = LiteLLMProvider.from_config(config)
        assert provider.model == "gpt-4"
        assert provider.api_key == "test-key"
        assert provider.fallbacks == ["gpt-3.5-turbo", "claude-3-opus"]
    
    def test_from_config_without_fallbacks(self):
        """Test from_config without fallbacks field (backward compatibility)."""
        config = {
            "model": "gpt-4",
            "api_key": "test-key"
        }
        provider = LiteLLMProvider.from_config(config)
        assert provider.model == "gpt-4"
        assert provider.fallbacks is None
    
    def test_from_config_empty_fallbacks(self):
        """Test from_config with empty fallbacks list."""
        config = {
            "model": "gpt-4",
            "api_key": "test-key",
            "fallbacks": []
        }
        provider = LiteLLMProvider.from_config(config)
        assert provider.fallbacks == []
    
    def test_fallback_with_all_optional_fields(self):
        """Test fallbacks alongside other optional fields."""
        provider = LiteLLMProvider(
            model="gpt-4",
            api_key="test-key",
            base_url="https://api.openai.com/v1",
            timeout=30.0,
            max_retries=3,
            fallbacks=["gpt-3.5-turbo"]
        )
        assert provider.model == "gpt-4"
        assert provider.base_url == "https://api.openai.com/v1"
        assert provider.timeout == 30.0
        assert provider.max_retries == 3
        assert provider.fallbacks == ["gpt-3.5-turbo"]
    
    def test_fallback_single_model(self):
        """Test fallbacks with single fallback model."""
        provider = LiteLLMProvider(
            model="gpt-4",
            api_key="test-key",
            fallbacks=["gpt-3.5-turbo"]
        )
        assert len(provider.fallbacks) == 1
        assert provider.fallbacks[0] == "gpt-3.5-turbo"
    
    def test_fallback_multiple_models(self):
        """Test fallbacks with multiple fallback models."""
        fallback_list = ["gpt-3.5-turbo", "claude-3-opus", "claude-3-sonnet"]
        provider = LiteLLMProvider(
            model="gpt-4",
            api_key="test-key",
            fallbacks=fallback_list
        )
        assert provider.fallbacks == fallback_list
        assert len(provider.fallbacks) == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
