"""
LLM-as-a-Judge Evaluator for AgenticX

Implements LLM-based evaluation for subjective quality assessment.
Inspired by pydantic-evals LLMJudge design, implemented from scratch.

Key Features:
- Rubric-based evaluation criteria
- Support for binary (pass/fail) and continuous (0-1) scoring
- Flexible prompt templates
- Mock support for testing without LLM calls
"""

from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Protocol, Union

logger = logging.getLogger(__name__)


class JudgeMode(str, Enum):
    """Evaluation mode for LLM Judge."""
    BINARY = "binary"      # Returns True/False
    CONTINUOUS = "continuous"  # Returns 0.0-1.0 score
    

@dataclass
class JudgeResult:
    """
    Result of an LLM Judge evaluation.
    
    Attributes:
        value: The evaluation result (bool for binary, float for continuous).
        reason: Explanation for the evaluation result.
        raw_response: The raw LLM response (for debugging).
        metadata: Additional metadata from the evaluation.
    """
    value: Union[bool, float]
    reason: str
    raw_response: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "value": self.value,
            "reason": self.reason,
            "raw_response": self.raw_response,
            "metadata": self.metadata,
        }
    
    @property
    def passed(self) -> bool:
        """Check if the evaluation passed."""
        if isinstance(self.value, bool):
            return self.value
        return self.value >= 0.5


class LLMProvider(Protocol):
    """Protocol for LLM providers compatible with LLMJudge."""
    
    async def acomplete(self, prompt: str) -> str:
        """Generate completion for a prompt."""
        ...
    
    def complete(self, prompt: str) -> str:
        """Synchronous completion."""
        ...


@dataclass
class MockLLMProvider:
    """
    Mock LLM provider for testing.
    
    Returns configurable responses for testing without actual LLM calls.
    """
    default_response: str = '{"passed": true, "reason": "Mock evaluation passed"}'
    responses: Dict[str, str] = field(default_factory=dict)
    call_count: int = 0
    last_prompt: Optional[str] = None
    
    async def acomplete(self, prompt: str) -> str:
        """Generate mock completion."""
        self.call_count += 1
        self.last_prompt = prompt
        
        # Check for pattern-matched responses
        for pattern, response in self.responses.items():
            if pattern in prompt:
                return response
        
        return self.default_response
    
    def complete(self, prompt: str) -> str:
        """Synchronous mock completion."""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self.acomplete(prompt))


class LLMJudge:
    """
    LLM-as-a-Judge evaluator.
    
    Uses an LLM to evaluate outputs against specified criteria (rubric).
    Supports both binary (pass/fail) and continuous (0-1) scoring modes.
    
    Example:
        >>> judge = LLMJudge(
        ...     rubric="The output should be a valid JSON object",
        ...     mode=JudgeMode.BINARY,
        ...     llm_provider=my_llm,
        ... )
        >>> result = await judge.evaluate(output='{"key": "value"}')
        >>> print(result.passed)  # True
        >>> print(result.reason)  # "The output is valid JSON..."
    """
    
    # Default prompt template for binary evaluation
    BINARY_PROMPT_TEMPLATE = """You are an expert evaluator. Evaluate the following output against the given criteria.

## Criteria (Rubric)
{rubric}

## Output to Evaluate
{output}

{context_section}

## Instructions
Evaluate whether the output meets the criteria. Respond in JSON format:
{{
    "passed": true or false,
    "reason": "Brief explanation of your evaluation"
}}

Your evaluation (JSON only):"""

    # Default prompt template for continuous evaluation
    CONTINUOUS_PROMPT_TEMPLATE = """You are an expert evaluator. Score the following output against the given criteria.

## Criteria (Rubric)
{rubric}

## Output to Evaluate
{output}

{context_section}

## Instructions
Score the output from 0.0 (completely fails criteria) to 1.0 (perfectly meets criteria).
Respond in JSON format:
{{
    "score": 0.0 to 1.0,
    "reason": "Brief explanation of your score"
}}

Your evaluation (JSON only):"""
    
    def __init__(
        self,
        rubric: str,
        mode: JudgeMode = JudgeMode.BINARY,
        llm_provider: Optional[LLMProvider] = None,
        model: str = "openai:gpt-4",
        include_input: bool = False,
        include_expected: bool = False,
        custom_prompt_template: Optional[str] = None,
        retry_count: int = 2,
    ):
        """
        Initialize LLM Judge.
        
        Args:
            rubric: The evaluation criteria.
            mode: Evaluation mode (binary or continuous).
            llm_provider: LLM provider instance (optional, can be set later).
            model: Model identifier (for reference, actual model is in provider).
            include_input: Whether to include input in evaluation context.
            include_expected: Whether to include expected output in context.
            custom_prompt_template: Custom prompt template (optional).
            retry_count: Number of retries on parse failure.
        """
        self.rubric = rubric
        self.mode = mode
        self.llm_provider = llm_provider
        self.model = model
        self.include_input = include_input
        self.include_expected = include_expected
        self.retry_count = retry_count
        
        # Set prompt template based on mode
        if custom_prompt_template:
            self.prompt_template = custom_prompt_template
        elif mode == JudgeMode.BINARY:
            self.prompt_template = self.BINARY_PROMPT_TEMPLATE
        else:
            self.prompt_template = self.CONTINUOUS_PROMPT_TEMPLATE
    
    def set_llm_provider(self, provider: LLMProvider) -> None:
        """Set the LLM provider."""
        self.llm_provider = provider
    
    def _build_context_section(
        self,
        inputs: Optional[Dict[str, Any]] = None,
        expected: Optional[str] = None,
    ) -> str:
        """Build the context section of the prompt."""
        sections = []
        
        if self.include_input and inputs:
            sections.append(f"## Input\n{json.dumps(inputs, indent=2, ensure_ascii=False)}")
        
        if self.include_expected and expected:
            sections.append(f"## Expected Output\n{expected}")
        
        return "\n\n".join(sections) if sections else ""
    
    def _build_prompt(
        self,
        output: str,
        inputs: Optional[Dict[str, Any]] = None,
        expected: Optional[str] = None,
    ) -> str:
        """Build the evaluation prompt."""
        context_section = self._build_context_section(inputs, expected)
        
        return self.prompt_template.format(
            rubric=self.rubric,
            output=output,
            context_section=context_section,
        )
    
    def _parse_binary_response(self, response: str) -> JudgeResult:
        """Parse binary evaluation response."""
        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                passed = data.get("passed", False)
                reason = data.get("reason", "No reason provided")
                
                return JudgeResult(
                    value=bool(passed),
                    reason=reason,
                    raw_response=response,
                )
        except json.JSONDecodeError:
            pass
        
        # Fallback: look for keywords
        response_lower = response.lower()
        if "passed" in response_lower or "true" in response_lower:
            return JudgeResult(
                value=True,
                reason="Parsed from keywords (passed/true found)",
                raw_response=response,
            )
        elif "failed" in response_lower or "false" in response_lower:
            return JudgeResult(
                value=False,
                reason="Parsed from keywords (failed/false found)",
                raw_response=response,
            )
        
        # Default to failed if cannot parse
        return JudgeResult(
            value=False,
            reason="Could not parse LLM response",
            raw_response=response,
            metadata={"parse_error": True},
        )
    
    def _parse_continuous_response(self, response: str) -> JudgeResult:
        """Parse continuous evaluation response."""
        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                score = float(data.get("score", 0.0))
                reason = data.get("reason", "No reason provided")
                
                # Clamp score to 0-1 range
                score = max(0.0, min(1.0, score))
                
                return JudgeResult(
                    value=score,
                    reason=reason,
                    raw_response=response,
                )
        except (json.JSONDecodeError, ValueError):
            pass
        
        # Fallback: try to find a number
        number_match = re.search(r'(\d+\.?\d*)', response)
        if number_match:
            try:
                score = float(number_match.group(1))
                if score > 1.0:
                    score = score / 100.0  # Assume percentage
                score = max(0.0, min(1.0, score))
                
                return JudgeResult(
                    value=score,
                    reason="Parsed from number in response",
                    raw_response=response,
                )
            except ValueError:
                pass
        
        # Default to 0 if cannot parse
        return JudgeResult(
            value=0.0,
            reason="Could not parse LLM response",
            raw_response=response,
            metadata={"parse_error": True},
        )
    
    async def evaluate(
        self,
        output: str,
        expected: Optional[str] = None,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> JudgeResult:
        """
        Evaluate an output against the rubric.
        
        Args:
            output: The output to evaluate.
            expected: Optional expected output for comparison.
            inputs: Optional inputs that produced the output.
            
        Returns:
            JudgeResult with the evaluation outcome.
            
        Raises:
            ValueError: If no LLM provider is configured.
        """
        if self.llm_provider is None:
            raise ValueError("No LLM provider configured. Call set_llm_provider() first.")
        
        prompt = self._build_prompt(output, inputs, expected)
        
        last_error: Optional[Exception] = None
        for attempt in range(self.retry_count + 1):
            try:
                response = await self.llm_provider.acomplete(prompt)
                
                if self.mode == JudgeMode.BINARY:
                    result = self._parse_binary_response(response)
                else:
                    result = self._parse_continuous_response(response)
                
                # Check if parsing succeeded
                if not result.metadata.get("parse_error"):
                    result.metadata["attempt"] = attempt + 1
                    return result
                
                logger.warning(f"Parse error on attempt {attempt + 1}, retrying...")
                
            except Exception as e:
                last_error = e
                logger.warning(f"LLM call failed on attempt {attempt + 1}: {e}")
        
        # All retries exhausted
        if last_error:
            return JudgeResult(
                value=False if self.mode == JudgeMode.BINARY else 0.0,
                reason=f"Evaluation failed after {self.retry_count + 1} attempts: {last_error}",
                metadata={"error": str(last_error)},
            )
        
        return JudgeResult(
            value=False if self.mode == JudgeMode.BINARY else 0.0,
            reason="Evaluation failed: could not parse response",
            metadata={"parse_error": True},
        )
    
    def evaluate_sync(
        self,
        output: str,
        expected: Optional[str] = None,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> JudgeResult:
        """
        Synchronous wrapper for evaluate().
        
        Args:
            output: The output to evaluate.
            expected: Optional expected output.
            inputs: Optional inputs.
            
        Returns:
            JudgeResult with the evaluation outcome.
        """
        import asyncio
        return asyncio.run(self.evaluate(output, expected, inputs))


class CompositeJudge:
    """
    Composite evaluator that combines multiple LLM Judges.
    
    Aggregates results from multiple judges using configurable strategies.
    
    Example:
        >>> judge = CompositeJudge(judges=[
        ...     LLMJudge(rubric="Output is valid JSON"),
        ...     LLMJudge(rubric="Output contains greeting"),
        ... ])
        >>> result = await judge.evaluate(output='{"greeting": "hello"}')
    """
    
    def __init__(
        self,
        judges: List[LLMJudge],
        aggregation: str = "all",  # "all", "any", "majority", "average"
    ):
        """
        Initialize composite judge.
        
        Args:
            judges: List of LLM judges to combine.
            aggregation: How to aggregate results:
                - "all": All judges must pass
                - "any": Any judge passing is sufficient
                - "majority": More than half must pass
                - "average": Average of all scores (for continuous mode)
        """
        self.judges = judges
        self.aggregation = aggregation
    
    async def evaluate(
        self,
        output: str,
        expected: Optional[str] = None,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> JudgeResult:
        """
        Evaluate using all judges and aggregate results.
        
        Args:
            output: The output to evaluate.
            expected: Optional expected output.
            inputs: Optional inputs.
            
        Returns:
            Aggregated JudgeResult.
        """
        results: List[JudgeResult] = []
        
        for judge in self.judges:
            result = await judge.evaluate(output, expected, inputs)
            results.append(result)
        
        return self._aggregate_results(results)
    
    def _aggregate_results(self, results: List[JudgeResult]) -> JudgeResult:
        """Aggregate results from multiple judges."""
        if not results:
            return JudgeResult(value=False, reason="No judges configured")
        
        # Collect values and reasons
        values = [r.value for r in results]
        reasons = [r.reason for r in results]
        
        # Check if all are boolean (binary mode)
        all_binary = all(isinstance(v, bool) for v in values)
        
        if all_binary:
            bool_values = [bool(v) for v in values]
            
            if self.aggregation == "all":
                passed = all(bool_values)
            elif self.aggregation == "any":
                passed = any(bool_values)
            elif self.aggregation == "majority":
                passed = sum(bool_values) > len(bool_values) / 2
            else:  # average - treat as continuous
                passed = sum(bool_values) / len(bool_values) >= 0.5
            
            return JudgeResult(
                value=passed,
                reason=f"Aggregated ({self.aggregation}): " + "; ".join(reasons),
                metadata={
                    "individual_results": [r.to_dict() for r in results],
                    "aggregation": self.aggregation,
                },
            )
        else:
            # Continuous mode
            float_values = [float(v) for v in values]
            
            if self.aggregation == "all":
                score = min(float_values)
            elif self.aggregation == "any":
                score = max(float_values)
            elif self.aggregation == "majority":
                score = sorted(float_values)[len(float_values) // 2]
            else:  # average
                score = sum(float_values) / len(float_values)
            
            return JudgeResult(
                value=score,
                reason=f"Aggregated ({self.aggregation}): " + "; ".join(reasons),
                metadata={
                    "individual_results": [r.to_dict() for r in results],
                    "aggregation": self.aggregation,
                },
            )


__all__ = [
    'JudgeMode',
    'JudgeResult',
    'LLMProvider',
    'MockLLMProvider',
    'LLMJudge',
    'CompositeJudge',
]

