"""
Smoke tests for Pydantic AI inspired validation feedback and auto-retry mechanism.

Tests the core self-healing capability: ValidationError interception, 
translation, and automatic retry loop.

Author: AgenticX Team
Inspired by: pydantic-ai (https://github.com/pydantic/pydantic-ai)
"""

import pytest
import asyncio
from typing import Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ValidationError

from agenticx.core.tool_v2 import (
    BaseTool,
    ToolMetadata,
    ToolCategory,
    ToolParameter,
    ParameterType,
    ToolContext,
    ToolResult,
    ToolStatus,
    ValidationFeedback,
    ValidationErrorHandler,
    ValidationErrorTranslator,
)


# ===== Test Fixtures =====

class MockToolParams(BaseModel):
    """Mock Pydantic model for testing validation"""
    query: str = Field(..., min_length=1, max_length=100)
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class MockSearchTool(BaseTool):
    """Mock tool for testing auto-retry mechanism"""
    
    def _setup_parameters(self) -> None:
        self._parameters = {
            "query": ToolParameter(
                name="query",
                type=ParameterType.STRING,
                description="Search query",
                required=True
            ),
            "limit": ToolParameter(
                name="limit",
                type=ParameterType.INTEGER,
                description="Result limit",
                required=False,
                default=10,
                minimum=1,
                maximum=100
            )
        }
    
    def execute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        return ToolResult(
            status=ToolStatus.SUCCESS,
            data={"results": ["item1", "item2"]},
            execution_time=0.1
        )
    
    async def aexecute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        await asyncio.sleep(0.01)  # Simulate async work
        return self.execute(parameters, context)
    
    async def validate_parameters_async(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Override to use Pydantic validation"""
        # This will raise ValidationError if invalid
        validated = MockToolParams(**parameters)
        return validated.model_dump()


# ===== Test P0-1: ValidationErrorHandler =====

def test_validation_error_handler_basic():
    """Test basic error handling and feedback generation"""
    handler = ValidationErrorHandler()
    
    # Create a validation error
    try:
        MockToolParams(query="", limit=200)  # Invalid: empty query, limit > 100
    except ValidationError as e:
        feedback = handler.handle(
            error=e,
            tool_name="mock_search",
            parameters={"query": "", "limit": 200},
            retry_count=0
        )
        
        assert feedback.tool_name == "mock_search"
        assert len(feedback.errors) >= 2  # At least 2 errors
        assert feedback.retry_count == 0
        assert isinstance(feedback.timestamp, datetime)
        
        # Check error structure
        error_locs = [tuple(err["loc"]) for err in feedback.errors]
        assert ("query",) in error_locs or ("limit",) in error_locs


def test_validation_feedback_to_dict():
    """Test ValidationFeedback serialization"""
    feedback = ValidationFeedback(
        tool_name="test_tool",
        errors=[{"loc": ("field",), "msg": "error", "type": "value_error"}],
        original_params={"field": "value"},
        retry_count=1
    )
    
    result = feedback.to_dict()
    assert result["tool_name"] == "test_tool"
    assert result["retry_count"] == 1
    assert "timestamp" in result


# ===== Test P0-2: ValidationErrorTranslator =====

def test_error_translator_single_error():
    """Test translation of single validation error"""
    feedback = ValidationFeedback(
        tool_name="search_api",
        errors=[
            {"loc": ("query",), "msg": "field required", "type": "value_error.missing"}
        ],
        original_params={},
        retry_count=0
    )
    
    translator = ValidationErrorTranslator()
    message = translator.translate(feedback)
    
    assert "search_api" in message
    assert "query" in message
    assert "field required" in message
    assert "correct these parameters" in message.lower()


def test_error_translator_multiple_errors():
    """Test translation of multiple validation errors"""
    feedback = ValidationFeedback(
        tool_name="search_api",
        errors=[
            {"loc": ("query",), "msg": "field required", "type": "value_error.missing"},
            {"loc": ("limit",), "msg": "ensure this value is less than or equal to 100", "type": "value_error.number.not_le"}
        ],
        original_params={"limit": 200},
        retry_count=1
    )
    
    translator = ValidationErrorTranslator()
    message = translator.translate(feedback)
    
    assert "search_api" in message
    assert "query" in message
    assert "limit" in message
    assert "Retry attempt 1" in message


# ===== Test P0-3: Auto-retry with BaseTool =====

@pytest.mark.asyncio
async def test_auto_retry_disabled_returns_error():
    """Test that without auto_retry, validation errors are returned immediately"""
    metadata = ToolMetadata(
        name="mock_search",
        description="Mock search tool",
        category=ToolCategory.DATA_ACCESS
    )
    
    tool = MockSearchTool(metadata=metadata, enable_auto_retry=False)
    context = ToolContext(execution_id="test-1")
    
    # Invalid parameters
    result = await tool.aexecute_with_retry(
        parameters={"query": "", "limit": 200},
        context=context,
        retry_callback=None
    )
    
    assert result.status == ToolStatus.FAILED
    assert result.error is not None
    assert "validation failed" in result.error.lower()


@pytest.mark.asyncio
async def test_auto_retry_enabled_success():
    """Test successful auto-retry with correction callback"""
    metadata = ToolMetadata(
        name="mock_search",
        description="Mock search tool",
        category=ToolCategory.DATA_ACCESS,
        max_retries=3
    )
    
    tool = MockSearchTool(metadata=metadata, enable_auto_retry=True)
    context = ToolContext(execution_id="test-2")
    
    # Mock LLM correction callback
    retry_attempts = []
    
    def mock_llm_correction(error_message: str) -> Dict[str, Any]:
        """Simulate LLM understanding the error and fixing parameters"""
        retry_attempts.append(error_message)
        # Return corrected parameters
        return {"query": "python", "limit": 10}
    
    # Start with invalid parameters
    result = await tool.aexecute_with_retry(
        parameters={"query": "", "limit": 200},  # Invalid
        context=context,
        retry_callback=mock_llm_correction
    )
    
    assert result.status == ToolStatus.SUCCESS
    assert len(retry_attempts) == 1  # One retry was needed
    assert result.metadata.get("retry_count") == 1
    assert result.metadata.get("auto_corrected") is True


@pytest.mark.asyncio
async def test_auto_retry_max_retries_exceeded():
    """Test that max retries limit is enforced"""
    metadata = ToolMetadata(
        name="mock_search",
        description="Mock search tool",
        category=ToolCategory.DATA_ACCESS,
        max_retries=2
    )
    
    tool = MockSearchTool(metadata=metadata, enable_auto_retry=True)
    context = ToolContext(execution_id="test-3")
    
    retry_attempts = []
    
    def always_fail_correction(error_message: str) -> Dict[str, Any]:
        """Simulate LLM that keeps making mistakes"""
        retry_attempts.append(error_message)
        # Return invalid parameters every time
        return {"query": "", "limit": 200}
    
    result = await tool.aexecute_with_retry(
        parameters={"query": "", "limit": 200},
        context=context,
        retry_callback=always_fail_correction
    )
    
    assert result.status == ToolStatus.FAILED
    assert len(retry_attempts) == 2  # max_retries = 2
    assert "Max retries (2) exceeded" in result.error


@pytest.mark.asyncio
async def test_auto_retry_callback_exception():
    """Test handling of callback exceptions"""
    metadata = ToolMetadata(
        name="mock_search",
        description="Mock search tool",
        category=ToolCategory.DATA_ACCESS
    )
    
    tool = MockSearchTool(metadata=metadata, enable_auto_retry=True)
    context = ToolContext(execution_id="test-4")
    
    def broken_callback(error_message: str) -> Dict[str, Any]:
        """Callback that raises exception"""
        raise RuntimeError("LLM API is down")
    
    result = await tool.aexecute_with_retry(
        parameters={"query": "", "limit": 200},
        context=context,
        retry_callback=broken_callback
    )
    
    assert result.status == ToolStatus.FAILED
    assert "Retry callback failed" in result.error


@pytest.mark.asyncio
async def test_auto_retry_valid_params_no_retry():
    """Test that valid parameters execute without retry"""
    metadata = ToolMetadata(
        name="mock_search",
        description="Mock search tool",
        category=ToolCategory.DATA_ACCESS
    )
    
    tool = MockSearchTool(metadata=metadata, enable_auto_retry=True)
    context = ToolContext(execution_id="test-5")
    
    retry_attempts = []
    
    def should_not_be_called(error_message: str) -> Dict[str, Any]:
        retry_attempts.append(error_message)
        return {}
    
    # Valid parameters
    result = await tool.aexecute_with_retry(
        parameters={"query": "python", "limit": 10},
        context=context,
        retry_callback=should_not_be_called
    )
    
    assert result.status == ToolStatus.SUCCESS
    assert len(retry_attempts) == 0  # No retries needed
    assert "retry_count" not in result.metadata  # No retry metadata


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

