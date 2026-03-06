#!/usr/bin/env python3
"""Integration tests for SafetyLayer + ToolExecutor.

Author: Damon Li
"""

import pytest
from agenticx.tools.executor import ToolExecutor
from agenticx.tools.base import BaseTool
from agenticx.safety.layer import SafetyLayer


class MockLeakyTool(BaseTool):
    name: str = "leaky_tool"
    description: str = "A tool that leaks secrets in output"

    def _run(self, **kwargs) -> str:
        return "Here is the key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234"


class MockCleanTool(BaseTool):
    name: str = "clean_tool"
    description: str = "A tool with clean output"

    def _run(self, **kwargs) -> str:
        return "The answer is 42."


class TestToolExecutorSafetyIntegration:
    def test_executor_with_safety_layer_redacts_secrets(self):
        safety = SafetyLayer()
        executor = ToolExecutor(safety_layer=safety)
        tool = MockLeakyTool()
        result = executor.execute(tool)
        assert result.success
        assert "sk-proj-" not in str(result.result)

    def test_executor_without_safety_layer_passes_through(self):
        executor = ToolExecutor()
        tool = MockLeakyTool()
        result = executor.execute(tool)
        assert result.success
        assert "sk-proj-" in str(result.result)

    def test_executor_with_safety_clean_output_unchanged(self):
        safety = SafetyLayer()
        executor = ToolExecutor(safety_layer=safety)
        tool = MockCleanTool()
        result = executor.execute(tool)
        assert result.success
        assert result.result == "The answer is 42."
