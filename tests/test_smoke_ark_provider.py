#!/usr/bin/env python3
"""Smoke tests for ArkLLMProvider (Volcengine Ark).

Tests provider initialization, configuration, factory methods,
and basic API structure without requiring actual API keys.

Author: Damon Li
"""

import os
import pytest
from unittest.mock import patch, MagicMock


class TestArkProviderInit:
    """Test ArkLLMProvider initialization and configuration."""

    def test_import_ark_provider(self):
        """Verify ArkLLMProvider can be imported from llms module."""
        from agenticx.llms import ArkLLMProvider
        assert ArkLLMProvider is not None

    def test_import_convenience_classes(self):
        """Verify ArkProvider and VolcEngineProvider convenience classes exist."""
        from agenticx.llms import ArkProvider, VolcEngineProvider
        assert ArkProvider is not None
        assert VolcEngineProvider is not None

    def test_import_from_top_level(self):
        """Verify ArkLLMProvider is exported from top-level agenticx."""
        from agenticx import ArkLLMProvider, ArkProvider, VolcEngineProvider
        assert ArkLLMProvider is not None
        assert ArkProvider is not None
        assert VolcEngineProvider is not None

    @patch.dict(os.environ, {}, clear=False)
    def test_default_initialization(self):
        """Test default initialization with no arguments."""
        # Remove env vars that could override defaults
        os.environ.pop("MODEL_AGENT_NAME", None)
        os.environ.pop("MODEL_AGENT_API_KEY", None)
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")

        assert provider.model == "doubao-seed-1-6"
        assert provider.api_key == "test-key"
        assert provider.base_url == "https://ark.cn-beijing.volces.com/api/v3"
        assert provider.timeout == 120.0
        assert provider.max_retries == 3
        assert provider.temperature == 0.7
        assert provider.client is not None
        assert provider.async_client is not None

    def test_custom_endpoint_id(self):
        """Test initialization with endpoint_id overrides model."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(
            api_key="test-key",
            endpoint_id="ep-20250520174054-xxxxx"
        )

        assert provider.endpoint_id == "ep-20250520174054-xxxxx"
        # When endpoint_id is set and model is default, model becomes endpoint_id
        assert provider.model == "ep-20250520174054-xxxxx"

    def test_custom_model_preserved(self):
        """Test that explicit model name is preserved even with endpoint_id."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(
            api_key="test-key",
            model="doubao-seed-1-8",
            endpoint_id="ep-12345"
        )

        assert provider.model == "doubao-seed-1-8"
        assert provider.endpoint_id == "ep-12345"

    @patch.dict(os.environ, {
        "MODEL_AGENT_API_KEY": "env-api-key",
        "MODEL_AGENT_NAME": "ep-env-endpoint"
    })
    def test_env_auto_detection(self):
        """Test auto-detection from AgentKit environment variables."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider()

        assert provider.api_key == "env-api-key"
        assert provider.endpoint_id == "ep-env-endpoint"
        assert provider.model == "ep-env-endpoint"

    @patch.dict(os.environ, {"ARK_API_KEY": "ark-key"}, clear=False)
    def test_ark_api_key_env(self):
        """Test ARK_API_KEY environment variable detection."""
        from agenticx.llms import ArkLLMProvider
        # Clear MODEL_AGENT_API_KEY to test fallback
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MODEL_AGENT_API_KEY", None)
            provider = ArkLLMProvider()
            assert provider.api_key == "ark-key"


class TestArkProviderMethods:
    """Test ArkLLMProvider method signatures and helpers."""

    def test_get_effective_model_with_endpoint(self):
        """Test _get_effective_model returns endpoint_id when set."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(
            api_key="test-key",
            endpoint_id="ep-12345"
        )
        assert provider._get_effective_model() == "ep-12345"

    def test_get_effective_model_without_endpoint(self):
        """Test _get_effective_model returns model when no endpoint_id."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(
            api_key="test-key",
            model="doubao-seed-1-8"
        )
        provider.endpoint_id = None
        assert provider._get_effective_model() == "doubao-seed-1-8"

    def test_convert_string_prompt(self):
        """Test string prompt is converted to messages format."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        messages = provider._convert_prompt_to_messages("Hello")
        assert messages == [{"role": "user", "content": "Hello"}]

    def test_convert_list_prompt(self):
        """Test list prompt is passed through directly."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        msg_list = [{"role": "system", "content": "You are helpful."}]
        messages = provider._convert_prompt_to_messages(msg_list)
        assert messages == msg_list

    def test_convert_invalid_prompt(self):
        """Test invalid prompt type raises ValueError."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        with pytest.raises(ValueError):
            provider._convert_prompt_to_messages(12345)

    def test_prepare_request_params(self):
        """Test request params preparation."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(
            api_key="test-key",
            endpoint_id="ep-12345",
            temperature=0.5
        )
        messages = [{"role": "user", "content": "Test"}]
        params = provider._prepare_request_params(messages)

        assert params["model"] == "ep-12345"
        assert params["messages"] == messages
        assert params["temperature"] == 0.5
        assert "stream" not in params

    def test_prepare_request_params_with_stream(self):
        """Test request params with streaming enabled."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        messages = [{"role": "user", "content": "Test"}]
        params = provider._prepare_request_params(messages, stream=True)

        assert params["stream"] is True

    def test_prepare_request_params_with_tools(self):
        """Test request params with tool definitions."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        messages = [{"role": "user", "content": "Test"}]
        tools = [{"type": "function", "function": {"name": "test"}}]
        params = provider._prepare_request_params(messages, tools=tools)

        assert params["tools"] == tools

    def test_generate_method_exists(self):
        """Test generate convenience method exists."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        assert hasattr(provider, "generate")
        assert callable(provider.generate)

    def test_call_method_exists(self):
        """Test call compatibility method exists."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider(api_key="test-key")
        assert hasattr(provider, "call")
        assert callable(provider.call)


class TestArkProviderFactory:
    """Test factory and classmethod patterns."""

    def test_from_config(self):
        """Test from_config classmethod creates provider correctly."""
        from agenticx.llms import ArkLLMProvider
        config = {
            "model": "doubao-seed-1-8",
            "api_key": "config-key",
            "endpoint_id": "ep-config",
            "temperature": 0.3,
            "max_tokens": 2048,
        }
        provider = ArkLLMProvider.from_config(config)

        assert provider.model == "doubao-seed-1-8"
        assert provider.api_key == "config-key"
        assert provider.endpoint_id == "ep-config"
        assert provider.temperature == 0.3
        assert provider.max_tokens == 2048

    @patch.dict(os.environ, {
        "MODEL_AGENT_NAME": "ep-agentkit-001",
        "MODEL_AGENT_API_KEY": "agentkit-key-001"
    })
    def test_from_agentkit_env(self):
        """Test from_agentkit_env factory reads environment correctly."""
        from agenticx.llms import ArkLLMProvider
        provider = ArkLLMProvider.from_agentkit_env()

        assert provider.endpoint_id == "ep-agentkit-001"
        assert provider.api_key == "agentkit-key-001"

    def test_from_agentkit_env_missing_vars(self):
        """Test from_agentkit_env raises when env vars missing."""
        from agenticx.llms import ArkLLMProvider
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="MODEL_AGENT_NAME"):
                ArkLLMProvider.from_agentkit_env()

    def test_llm_factory_ark_type(self):
        """Test LlmFactory creates ArkLLMProvider for 'ark' type."""
        from agenticx.llms import LlmFactory, ArkLLMProvider
        from agenticx.knowledge.graphers.config import LLMConfig

        config = LLMConfig(
            type="ark",
            model="doubao-seed-1-6",
            api_key="factory-key",
        )
        provider = LlmFactory.create_llm(config)
        assert isinstance(provider, ArkLLMProvider)

    def test_llm_factory_volcengine_type(self):
        """Test LlmFactory creates ArkLLMProvider for 'volcengine' type."""
        from agenticx.llms import LlmFactory, ArkLLMProvider
        from agenticx.knowledge.graphers.config import LLMConfig

        config = LLMConfig(
            type="volcengine",
            model="doubao-seed-1-8",
            api_key="factory-key",
        )
        provider = LlmFactory.create_llm(config)
        assert isinstance(provider, ArkLLMProvider)


class TestArkProviderParsing:
    """Test response parsing logic."""

    def test_parse_response(self):
        """Test _parse_response converts mock response correctly."""
        from agenticx.llms import ArkLLMProvider

        provider = ArkLLMProvider(api_key="test-key")

        # Create mock response object
        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 20
        mock_usage.total_tokens = 30

        mock_message = MagicMock()
        mock_message.content = "Hello from Ark!"

        mock_choice = MagicMock()
        mock_choice.index = 0
        mock_choice.message = mock_message
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.id = "chatcmpl-test123"
        mock_response.model = "doubao-seed-1-6"
        mock_response.created = 1700000000
        mock_response.choices = [mock_choice]
        mock_response.usage = mock_usage

        result = provider._parse_response(mock_response)

        assert result.id == "chatcmpl-test123"
        assert result.model_name == "doubao-seed-1-6"
        assert result.content == "Hello from Ark!"
        assert result.token_usage.prompt_tokens == 10
        assert result.token_usage.completion_tokens == 20
        assert result.token_usage.total_tokens == 30
        assert result.metadata["provider"] == "ark"
