"""
Smoke tests for VeADK Reflector (Self-Reflection) feature.

Tests the reflection and prompt optimization based on execution traces.
"""

import pytest
from datetime import datetime, UTC
from unittest.mock import Mock, MagicMock, patch

from agenticx.core.reflector import (
    ReflectionResult, BaseReflector, LLMReflector, ReflectionLoop
)
from agenticx.observability.trajectory import (
    ExecutionTrajectory, TrajectoryStep, StepType, StepStatus
)
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage


class TestReflectionResult:
    """Test suite for ReflectionResult."""
    
    def test_reflection_result_creation(self):
        """Test creating a ReflectionResult."""
        result = ReflectionResult(
            optimized_prompt="New prompt",
            reason="Better structure",
            confidence=0.8,
            metrics_delta={"success_rate": 0.1}
        )
        
        assert result.optimized_prompt == "New prompt"
        assert result.reason == "Better structure"
        assert result.confidence == 0.8
        assert result.metrics_delta["success_rate"] == 0.1
    
    def test_reflection_result_to_dict(self):
        """Test converting ReflectionResult to dict."""
        result = ReflectionResult(
            optimized_prompt="New prompt",
            reason="Better",
            confidence=0.7
        )
        
        result_dict = result.to_dict()
        assert result_dict["optimized_prompt"] == "New prompt"
        assert result_dict["reason"] == "Better"
        assert result_dict["confidence"] == 0.7
        assert "reflection_timestamp" in result_dict


class TestLLMReflector:
    """Test suite for LLMReflector."""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """Create a mock LLM provider."""
        provider = Mock()
        return provider
    
    @pytest.fixture
    def reflector(self, mock_llm_provider):
        """Create a reflector instance."""
        return LLMReflector(mock_llm_provider)
    
    @pytest.fixture
    def simple_trajectory(self):
        """Create a simple trajectory."""
        traj = ExecutionTrajectory(trajectory_id="test_traj")
        
        task_start = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            input_data={"task_description": "Test task"}
        )
        traj.add_step(task_start)
        
        tool_call = TrajectoryStep(
            step_type=StepType.TOOL_CALL,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            input_data={"tool_name": "search"}
        )
        traj.add_step(tool_call)
        
        traj.finalize(StepStatus.COMPLETED)
        return traj
    
    def test_reflector_initialization(self, mock_llm_provider):
        """Test reflector initialization."""
        reflector = LLMReflector(
            mock_llm_provider,
            min_confidence=0.5,
            max_reflection_tokens=500
        )
        
        assert reflector.llm_provider is mock_llm_provider
        assert reflector.min_confidence == 0.5
        assert reflector.max_reflection_tokens == 500
    
    def test_reflect_with_valid_response(self, reflector, mock_llm_provider, simple_trajectory):
        """Test reflect with valid LLM response."""
        # Mock LLM response
        llm_response = LLMResponse(
            id="test_id",
            model_name="gpt-4",
            created=int(datetime.now(UTC).timestamp()),
            content='{"optimized_prompt": "Better prompt", "reason": "Improved", "confidence": 0.8, "metrics_delta": {}}',
            choices=[],
            token_usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
            cost=0.0
        )
        mock_llm_provider.invoke.return_value = llm_response
        
        result = reflector.reflect(
            simple_trajectory,
            "Original prompt",
            "Test task"
        )
        
        assert result is not None
        assert result.optimized_prompt == "Better prompt"
        assert result.confidence == 0.8
    
    def test_reflect_low_confidence_filtered(self, reflector, mock_llm_provider, simple_trajectory):
        """Test that low confidence results are filtered."""
        # Mock LLM response with low confidence
        llm_response = LLMResponse(
            id="test_id",
            model_name="gpt-4",
            created=int(datetime.now(UTC).timestamp()),
            content='{"optimized_prompt": "Maybe better", "reason": "Not sure", "confidence": 0.2, "metrics_delta": {}}',
            choices=[],
            token_usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
            cost=0.0
        )
        mock_llm_provider.invoke.return_value = llm_response
        
        result = reflector.reflect(
            simple_trajectory,
            "Original prompt",
            "Test task"
        )
        
        assert result is None  # Should be filtered out
    
    def test_reflect_invalid_json_response(self, reflector, mock_llm_provider, simple_trajectory):
        """Test reflect with invalid JSON response."""
        # Mock LLM response with invalid JSON
        llm_response = LLMResponse(
            id="test_id",
            model_name="gpt-4",
            created=int(datetime.now(UTC).timestamp()),
            content='This is not JSON at all',
            choices=[],
            token_usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
            cost=0.0
        )
        mock_llm_provider.invoke.return_value = llm_response
        
        result = reflector.reflect(
            simple_trajectory,
            "Original prompt",
            "Test task"
        )
        
        assert result is None  # Should handle gracefully
    
    def test_reflect_empty_trajectory(self, reflector, mock_llm_provider):
        """Test reflect with empty trajectory."""
        traj = ExecutionTrajectory(trajectory_id="empty")
        traj.finalize(StepStatus.COMPLETED)
        
        # Mock response
        llm_response = LLMResponse(
            id="test_id",
            model_name="gpt-4",
            created=int(datetime.now(UTC).timestamp()),
            content='{"optimized_prompt": "Prompt", "reason": "Empty", "confidence": 0.5, "metrics_delta": {}}',
            choices=[],
            token_usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
            cost=0.0
        )
        mock_llm_provider.invoke.return_value = llm_response
        
        result = reflector.reflect(
            traj,
            "Original",
            None
        )
        
        assert result is not None  # Should work with empty trajectory
    
    def test_summarize_trajectory(self, reflector, simple_trajectory):
        """Test trajectory summarization."""
        summary = reflector._summarize_trajectory(simple_trajectory)
        
        assert "执行统计" in summary
        assert "工具调用" in summary
        assert "search" in summary  # Tool name should be in summary
    
    def test_extract_task_description(self, reflector, simple_trajectory):
        """Test task description extraction."""
        description = reflector._extract_task_description(simple_trajectory)
        
        assert description is not None
        assert "Test task" in description
    
    def test_parse_reflection_response_valid(self, reflector):
        """Test parsing valid reflection response."""
        response = '{"optimized_prompt": "Better", "reason": "Good", "confidence": 0.9, "metrics_delta": {"score": 0.05}}'
        
        result = reflector._parse_reflection_response(response)
        
        assert result is not None
        assert result.optimized_prompt == "Better"
        assert result.confidence == 0.9
    
    def test_parse_reflection_response_invalid_confidence(self, reflector):
        """Test parsing with invalid confidence value."""
        response = '{"optimized_prompt": "Better", "reason": "Good", "confidence": 1.5, "metrics_delta": {}}'
        
        result = reflector._parse_reflection_response(response)
        
        assert result is not None
        assert result.confidence == 0.5  # Should default to 0.5 for invalid


class TestReflectionLoop:
    """Test suite for ReflectionLoop."""
    
    @pytest.fixture
    def mock_reflector(self):
        """Create a mock reflector."""
        reflector = Mock(spec=BaseReflector)
        return reflector
    
    @pytest.fixture
    def reflection_loop(self, mock_reflector):
        """Create a reflection loop."""
        return ReflectionLoop(
            mock_reflector,
            confidence_threshold=0.3,
            max_iterations=3
        )
    
    @pytest.fixture
    def trajectory(self):
        """Create a test trajectory."""
        traj = ExecutionTrajectory()
        task_start = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            input_data={"query": "Test"}
        )
        traj.add_step(task_start)
        traj.finalize(StepStatus.COMPLETED)
        return traj
    
    def test_reflection_loop_initialization(self, mock_reflector):
        """Test reflection loop initialization."""
        loop = ReflectionLoop(
            mock_reflector,
            confidence_threshold=0.4,
            max_iterations=5
        )
        
        assert loop.reflector is mock_reflector
        assert loop.confidence_threshold == 0.4
        assert loop.max_iterations == 5
        assert len(loop.reflection_history) == 0
    
    def test_suggest_optimization_above_threshold(self, reflection_loop, mock_reflector, trajectory):
        """Test suggestion with confidence above threshold."""
        result = ReflectionResult(
            optimized_prompt="Better",
            reason="Good",
            confidence=0.8
        )
        mock_reflector.reflect.return_value = result
        
        suggestion = reflection_loop.suggest_optimization(
            trajectory,
            "Original",
            "Task"
        )
        
        assert suggestion is not None
        assert suggestion.confidence == 0.8
        assert len(reflection_loop.reflection_history) == 1
    
    def test_suggest_optimization_below_threshold(self, reflection_loop, mock_reflector, trajectory):
        """Test suggestion with confidence below threshold."""
        result = ReflectionResult(
            optimized_prompt="Maybe",
            reason="Unsure",
            confidence=0.2
        )
        mock_reflector.reflect.return_value = result
        
        suggestion = reflection_loop.suggest_optimization(
            trajectory,
            "Original",
            "Task"
        )
        
        assert suggestion is None  # Should be rejected
        assert len(reflection_loop.reflection_history) == 0
    
    def test_suggest_optimization_none_returned(self, reflection_loop, mock_reflector, trajectory):
        """Test when reflector returns None."""
        mock_reflector.reflect.return_value = None
        
        suggestion = reflection_loop.suggest_optimization(
            trajectory,
            "Original",
            "Task"
        )
        
        assert suggestion is None
        assert len(reflection_loop.reflection_history) == 0
    
    def test_get_optimization_history(self, reflection_loop, mock_reflector, trajectory):
        """Test getting optimization history."""
        results = [
            ReflectionResult(
                optimized_prompt="First",
                reason="First reason",
                confidence=0.8
            ),
            ReflectionResult(
                optimized_prompt="Second",
                reason="Second reason",
                confidence=0.9
            )
        ]
        mock_reflector.reflect.side_effect = results
        
        reflection_loop.suggest_optimization(trajectory, "Original", "Task")
        reflection_loop.suggest_optimization(trajectory, "First", "Task")
        
        history = reflection_loop.get_optimization_history()
        assert len(history) == 2
        assert history[0]["optimized_prompt"] == "First"
        assert history[1]["optimized_prompt"] == "Second"
    
    def test_get_best_optimization(self, reflection_loop, mock_reflector, trajectory):
        """Test getting best optimization by confidence."""
        results = [
            ReflectionResult(
                optimized_prompt="First",
                reason="First",
                confidence=0.6
            ),
            ReflectionResult(
                optimized_prompt="Best",
                reason="Best",
                confidence=0.95
            ),
            ReflectionResult(
                optimized_prompt="Middle",
                reason="Middle",
                confidence=0.75
            )
        ]
        mock_reflector.reflect.side_effect = results
        
        reflection_loop.suggest_optimization(trajectory, "Original", "Task")
        reflection_loop.suggest_optimization(trajectory, "First", "Task")
        reflection_loop.suggest_optimization(trajectory, "First", "Task")
        
        best = reflection_loop.get_best_optimization()
        assert best is not None
        assert best.optimized_prompt == "Best"
        assert best.confidence == 0.95
    
    def test_get_best_optimization_empty_history(self, reflection_loop):
        """Test best optimization with empty history."""
        best = reflection_loop.get_best_optimization()
        assert best is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
