"""
Smoke tests for AgenticX LLM-as-a-Judge Evaluator.

Tests the LLMJudge implementation for subjective quality evaluation.
"""

import pytest
import asyncio
from dataclasses import dataclass
from typing import Dict, Any, Optional

from agenticx.evaluation.llm_judge import (
    JudgeMode,
    JudgeResult,
    LLMJudge,
    MockLLMProvider,
    CompositeJudge,
)


# =============================================================================
# Tests: JudgeResult
# =============================================================================

class TestJudgeResult:
    """Tests for JudgeResult dataclass."""
    
    def test_judge_result_binary_passed(self):
        """Test binary result that passed."""
        result = JudgeResult(value=True, reason="Output meets criteria")
        
        assert result.passed is True
        assert result.value is True
        assert result.reason == "Output meets criteria"
    
    def test_judge_result_binary_failed(self):
        """Test binary result that failed."""
        result = JudgeResult(value=False, reason="Output does not meet criteria")
        
        assert result.passed is False
        assert result.value is False
    
    def test_judge_result_continuous_high(self):
        """Test continuous result with high score."""
        result = JudgeResult(value=0.8, reason="Good output")
        
        assert result.passed is True  # >= 0.5 passes
        assert result.value == 0.8
    
    def test_judge_result_continuous_low(self):
        """Test continuous result with low score."""
        result = JudgeResult(value=0.3, reason="Mediocre output")
        
        assert result.passed is False  # < 0.5 fails
        assert result.value == 0.3
    
    def test_judge_result_boundary(self):
        """Test continuous result at boundary (0.5)."""
        result = JudgeResult(value=0.5, reason="Borderline")
        
        assert result.passed is True  # >= 0.5 passes
    
    def test_judge_result_to_dict(self):
        """Test conversion to dictionary."""
        result = JudgeResult(
            value=True,
            reason="Test reason",
            raw_response="Raw LLM output",
            metadata={"key": "value"},
        )
        
        data = result.to_dict()
        
        assert data["value"] is True
        assert data["reason"] == "Test reason"
        assert data["raw_response"] == "Raw LLM output"
        assert data["metadata"] == {"key": "value"}


# =============================================================================
# Tests: MockLLMProvider
# =============================================================================

class TestMockLLMProvider:
    """Tests for mock LLM provider."""
    
    @pytest.mark.asyncio
    async def test_mock_default_response(self):
        """Test mock returns default response."""
        mock = MockLLMProvider()
        
        response = await mock.acomplete("Any prompt")
        
        assert "passed" in response
        assert mock.call_count == 1
        assert mock.last_prompt == "Any prompt"
    
    @pytest.mark.asyncio
    async def test_mock_custom_default(self):
        """Test mock with custom default response."""
        mock = MockLLMProvider(
            default_response='{"passed": false, "reason": "Always fails"}'
        )
        
        response = await mock.acomplete("Test")
        
        assert '"passed": false' in response
    
    @pytest.mark.asyncio
    async def test_mock_pattern_matching(self):
        """Test mock with pattern-matched responses."""
        mock = MockLLMProvider(
            responses={
                "valid JSON": '{"passed": true, "reason": "Is valid JSON"}',
                "greeting": '{"passed": true, "reason": "Contains greeting"}',
            }
        )
        
        # Should match first pattern
        response1 = await mock.acomplete("Check if valid JSON")
        assert '"passed": true' in response1
        assert "valid JSON" in response1
        
        # Should match second pattern
        response2 = await mock.acomplete("Check for greeting")
        assert "greeting" in response2
        
        # Should return default
        response3 = await mock.acomplete("Something else")
        assert "Mock evaluation passed" in response3


# =============================================================================
# Tests: LLMJudge Binary Mode
# =============================================================================

class TestLLMJudgeBinary:
    """Tests for LLMJudge in binary mode."""
    
    @pytest.mark.asyncio
    async def test_judge_binary_pass(self):
        """Test binary judge that passes."""
        mock = MockLLMProvider(
            default_response='{"passed": true, "reason": "Output is valid"}'
        )
        
        judge = LLMJudge(
            rubric="Output should be valid",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Valid output")
        
        assert result.passed is True
        assert result.value is True
        assert "valid" in result.reason.lower()
    
    @pytest.mark.asyncio
    async def test_judge_binary_fail(self):
        """Test binary judge that fails."""
        mock = MockLLMProvider(
            default_response='{"passed": false, "reason": "Output is invalid"}'
        )
        
        judge = LLMJudge(
            rubric="Output should be valid",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Invalid output")
        
        assert result.passed is False
        assert result.value is False
    
    @pytest.mark.asyncio
    async def test_judge_no_provider_error(self):
        """Test error when no LLM provider is set."""
        judge = LLMJudge(
            rubric="Test rubric",
            mode=JudgeMode.BINARY,
        )
        
        with pytest.raises(ValueError, match="No LLM provider configured"):
            await judge.evaluate(output="Test")
    
    @pytest.mark.asyncio
    async def test_judge_set_provider_later(self):
        """Test setting provider after construction."""
        judge = LLMJudge(
            rubric="Test rubric",
            mode=JudgeMode.BINARY,
        )
        
        mock = MockLLMProvider()
        judge.set_llm_provider(mock)
        
        result = await judge.evaluate(output="Test")
        
        assert result is not None
        assert mock.call_count == 1


class TestLLMJudgeContinuous:
    """Tests for LLMJudge in continuous mode."""
    
    @pytest.mark.asyncio
    async def test_judge_continuous_high_score(self):
        """Test continuous judge with high score."""
        mock = MockLLMProvider(
            default_response='{"score": 0.9, "reason": "Excellent output"}'
        )
        
        judge = LLMJudge(
            rubric="Rate output quality",
            mode=JudgeMode.CONTINUOUS,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="High quality output")
        
        assert result.value == 0.9
        assert result.passed is True
    
    @pytest.mark.asyncio
    async def test_judge_continuous_low_score(self):
        """Test continuous judge with low score."""
        mock = MockLLMProvider(
            default_response='{"score": 0.2, "reason": "Poor output"}'
        )
        
        judge = LLMJudge(
            rubric="Rate output quality",
            mode=JudgeMode.CONTINUOUS,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Low quality output")
        
        assert result.value == 0.2
        assert result.passed is False
    
    @pytest.mark.asyncio
    async def test_judge_continuous_score_clamping(self):
        """Test that scores are clamped to 0-1 range."""
        mock = MockLLMProvider(
            default_response='{"score": 1.5, "reason": "Over max"}'
        )
        
        judge = LLMJudge(
            rubric="Rate output",
            mode=JudgeMode.CONTINUOUS,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Test")
        
        assert result.value == 1.0  # Clamped to max


class TestLLMJudgeContext:
    """Tests for LLMJudge with context (input/expected)."""
    
    @pytest.mark.asyncio
    async def test_judge_with_expected(self):
        """Test judge with expected output."""
        mock = MockLLMProvider()
        
        judge = LLMJudge(
            rubric="Output should match expected",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
            include_expected=True,
        )
        
        await judge.evaluate(
            output="Hello World",
            expected="Hello World",
        )
        
        assert mock.last_prompt is not None
        assert "Expected Output" in mock.last_prompt
        assert "Hello World" in mock.last_prompt
    
    @pytest.mark.asyncio
    async def test_judge_with_inputs(self):
        """Test judge with input context."""
        mock = MockLLMProvider()
        
        judge = LLMJudge(
            rubric="Output should use inputs correctly",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
            include_input=True,
        )
        
        await judge.evaluate(
            output="Hello John",
            inputs={"name": "John", "greeting": "Hello"},
        )
        
        assert mock.last_prompt is not None
        assert "Input" in mock.last_prompt
        assert "John" in mock.last_prompt


class TestLLMJudgeRobustness:
    """Tests for LLMJudge response parsing robustness."""
    
    @pytest.mark.asyncio
    async def test_parse_json_with_extra_text(self):
        """Test parsing JSON from response with extra text."""
        mock = MockLLMProvider(
            default_response='Here is my evaluation: {"passed": true, "reason": "Good"} That was my assessment.'
        )
        
        judge = LLMJudge(
            rubric="Test",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Test")
        
        assert result.value is True
    
    @pytest.mark.asyncio
    async def test_parse_fallback_keywords(self):
        """Test fallback to keyword parsing."""
        mock = MockLLMProvider(
            default_response="The output PASSED the evaluation."
        )
        
        judge = LLMJudge(
            rubric="Test",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Test")
        
        # Should parse "passed" keyword
        assert result.value is True
    
    @pytest.mark.asyncio
    async def test_parse_continuous_percentage(self):
        """Test parsing percentage as continuous score."""
        mock = MockLLMProvider(
            default_response="Score: 85%"
        )
        
        judge = LLMJudge(
            rubric="Test",
            mode=JudgeMode.CONTINUOUS,
            llm_provider=mock,
        )
        
        result = await judge.evaluate(output="Test")
        
        # Should parse 85 and convert to 0.85
        assert result.value == 0.85


class TestLLMJudgeSync:
    """Tests for synchronous LLMJudge usage."""
    
    def test_evaluate_sync(self):
        """Test synchronous evaluation."""
        mock = MockLLMProvider(
            default_response='{"passed": true, "reason": "Sync test passed"}'
        )
        
        judge = LLMJudge(
            rubric="Test rubric",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        result = judge.evaluate_sync(output="Test output")
        
        assert result.passed is True


# =============================================================================
# Tests: CompositeJudge
# =============================================================================

class TestCompositeJudge:
    """Tests for composite judge with multiple criteria."""
    
    @pytest.mark.asyncio
    async def test_composite_all_pass(self):
        """Test composite with 'all' aggregation when all pass."""
        mock1 = MockLLMProvider(
            default_response='{"passed": true, "reason": "Criterion 1 passed"}'
        )
        mock2 = MockLLMProvider(
            default_response='{"passed": true, "reason": "Criterion 2 passed"}'
        )
        
        judge1 = LLMJudge(rubric="Criterion 1", llm_provider=mock1)
        judge2 = LLMJudge(rubric="Criterion 2", llm_provider=mock2)
        
        composite = CompositeJudge(judges=[judge1, judge2], aggregation="all")
        
        result = await composite.evaluate(output="Test")
        
        assert result.passed is True
        assert "Criterion 1 passed" in result.reason
        assert "Criterion 2 passed" in result.reason
    
    @pytest.mark.asyncio
    async def test_composite_all_one_fails(self):
        """Test composite with 'all' aggregation when one fails."""
        mock1 = MockLLMProvider(
            default_response='{"passed": true, "reason": "Passed"}'
        )
        mock2 = MockLLMProvider(
            default_response='{"passed": false, "reason": "Failed"}'
        )
        
        judge1 = LLMJudge(rubric="Criterion 1", llm_provider=mock1)
        judge2 = LLMJudge(rubric="Criterion 2", llm_provider=mock2)
        
        composite = CompositeJudge(judges=[judge1, judge2], aggregation="all")
        
        result = await composite.evaluate(output="Test")
        
        assert result.passed is False
    
    @pytest.mark.asyncio
    async def test_composite_any_one_passes(self):
        """Test composite with 'any' aggregation when one passes."""
        mock1 = MockLLMProvider(
            default_response='{"passed": false, "reason": "Failed"}'
        )
        mock2 = MockLLMProvider(
            default_response='{"passed": true, "reason": "Passed"}'
        )
        
        judge1 = LLMJudge(rubric="Criterion 1", llm_provider=mock1)
        judge2 = LLMJudge(rubric="Criterion 2", llm_provider=mock2)
        
        composite = CompositeJudge(judges=[judge1, judge2], aggregation="any")
        
        result = await composite.evaluate(output="Test")
        
        assert result.passed is True
    
    @pytest.mark.asyncio
    async def test_composite_majority(self):
        """Test composite with 'majority' aggregation."""
        mock1 = MockLLMProvider(default_response='{"passed": true, "reason": "Pass"}')
        mock2 = MockLLMProvider(default_response='{"passed": true, "reason": "Pass"}')
        mock3 = MockLLMProvider(default_response='{"passed": false, "reason": "Fail"}')
        
        judges = [
            LLMJudge(rubric=f"Criterion {i}", llm_provider=m)
            for i, m in enumerate([mock1, mock2, mock3])
        ]
        
        composite = CompositeJudge(judges=judges, aggregation="majority")
        
        result = await composite.evaluate(output="Test")
        
        # 2 out of 3 passed
        assert result.passed is True
    
    @pytest.mark.asyncio
    async def test_composite_continuous_average(self):
        """Test composite with continuous scores and 'average' aggregation."""
        mock1 = MockLLMProvider(default_response='{"score": 0.8, "reason": "Good"}')
        mock2 = MockLLMProvider(default_response='{"score": 0.6, "reason": "OK"}')
        
        judge1 = LLMJudge(rubric="Quality", mode=JudgeMode.CONTINUOUS, llm_provider=mock1)
        judge2 = LLMJudge(rubric="Clarity", mode=JudgeMode.CONTINUOUS, llm_provider=mock2)
        
        composite = CompositeJudge(judges=[judge1, judge2], aggregation="average")
        
        result = await composite.evaluate(output="Test")
        
        # Average of 0.8 and 0.6 is 0.7
        assert result.value == 0.7
        assert result.passed is True
    
    @pytest.mark.asyncio
    async def test_composite_stores_individual_results(self):
        """Test that composite stores individual results in metadata."""
        mock1 = MockLLMProvider(default_response='{"passed": true, "reason": "R1"}')
        mock2 = MockLLMProvider(default_response='{"passed": false, "reason": "R2"}')
        
        judge1 = LLMJudge(rubric="C1", llm_provider=mock1)
        judge2 = LLMJudge(rubric="C2", llm_provider=mock2)
        
        composite = CompositeJudge(judges=[judge1, judge2])
        
        result = await composite.evaluate(output="Test")
        
        assert "individual_results" in result.metadata
        assert len(result.metadata["individual_results"]) == 2


# =============================================================================
# Integration Tests
# =============================================================================

class TestLLMJudgeIntegration:
    """Integration tests for LLMJudge."""
    
    @pytest.mark.asyncio
    async def test_full_evaluation_workflow(self):
        """Test complete evaluation workflow."""
        # Create a mock that responds based on content
        mock = MockLLMProvider(
            responses={
                "valid JSON": '{"passed": true, "reason": "The output is valid JSON format"}',
                "greeting": '{"passed": true, "reason": "Contains a proper greeting"}',
            },
            default_response='{"passed": false, "reason": "Did not meet criteria"}',
        )
        
        # Create judges for different criteria
        json_judge = LLMJudge(
            rubric="Output should be valid JSON",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        greeting_judge = LLMJudge(
            rubric="Output should contain a greeting",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        # Evaluate outputs
        json_result = await json_judge.evaluate(
            output='{"message": "Hello"}',
        )
        
        greeting_result = await greeting_judge.evaluate(
            output="Hello, World!",
        )
        
        assert json_result.passed is True
        assert greeting_result.passed is True
    
    @pytest.mark.asyncio
    async def test_rubric_in_prompt(self):
        """Test that rubric is included in the prompt."""
        mock = MockLLMProvider()
        
        judge = LLMJudge(
            rubric="The output should be a polite greeting in formal English",
            mode=JudgeMode.BINARY,
            llm_provider=mock,
        )
        
        await judge.evaluate(output="Hello there")
        
        assert "polite greeting" in mock.last_prompt
        assert "formal English" in mock.last_prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

