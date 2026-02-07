"""
Reflector: Single-Agent Self-Reflection Module

Enables agents to analyze their execution traces and generate optimized prompts
based on success/failure patterns observed during task execution.

This module implements the reflection mechanism from VeADK, allowing agents to:
1. Collect execution traces
2. Analyze patterns (successes, failures, inefficiencies)
3. Generate optimized prompts with confidence scores
4. Support a feedback loop for continuous improvement
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, List, Any
from datetime import datetime, UTC
import json
import re

from pydantic import BaseModel, Field

from agenticx.observability.trajectory import ExecutionTrajectory, StepType, StepStatus
from agenticx.llms.base import BaseLLMProvider


class ReflectionResult(BaseModel):
    """
    Result of a reflection operation.
    
    Contains the optimized prompt and metadata about the reflection process.
    """
    optimized_prompt: str = Field(description="The optimized prompt suggestion")
    reason: str = Field(description="Explanation of why this optimization was suggested")
    confidence: float = Field(default=0.5, description="Confidence score (0.0-1.0)")
    metrics_delta: Dict[str, float] = Field(default_factory=dict, description="Expected metric changes")
    reflection_timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "optimized_prompt": self.optimized_prompt,
            "reason": self.reason,
            "confidence": self.confidence,
            "metrics_delta": self.metrics_delta,
            "reflection_timestamp": self.reflection_timestamp.isoformat()
        }


class BaseReflector(ABC):
    """
    Abstract base class for reflectors.
    
    A reflector analyzes execution traces and generates optimized prompts.
    """
    
    @abstractmethod
    def reflect(self, 
                trajectory: ExecutionTrajectory,
                current_prompt: str,
                task_description: Optional[str] = None) -> Optional[ReflectionResult]:
        """
        Analyze execution trajectory and generate reflection.
        
        Args:
            trajectory: The execution trajectory to analyze
            current_prompt: The current system prompt
            task_description: Optional task description for context
            
        Returns:
            ReflectionResult with optimization suggestions, or None if no optimization suggested
        """
        pass


class LLMReflector(BaseReflector):
    """
    LLM-based reflector that uses an LLM to analyze traces and generate optimizations.
    
    Uses another LLM call to analyze the execution trace and suggest prompt improvements.
    """
    
    # Reflection prompt template
    REFLECTION_PROMPT = """你是一个 Agent 提示词优化专家。

## 当前提示词
{current_prompt}

## 执行轨迹摘要
{trace_summary}

## 任务描述
{task_description}

请分析执行轨迹中的：
1. 成功模式（哪些步骤效果好）
2. 失败模式（哪些步骤出错、效率低）
3. 改进建议

输出 JSON（必须包含以下字段）：
{{
  "optimized_prompt": "优化后的提示词，应该是一个完整、可用的系统提示词",
  "reason": "优化原因说明，包括观察到的问题和改进点",
  "confidence": 0.0到1.0之间的浮点数，表示对这个优化的置信度,
  "metrics_delta": {{"success_rate": 改变幅度, "efficiency": 改变幅度}}
}}

请确保返回有效的JSON格式。"""
    
    def __init__(self, 
                 llm_provider: BaseLLMProvider,
                 min_confidence: float = 0.3,
                 max_reflection_tokens: Optional[int] = 1000):
        """
        Initialize LLM reflector.
        
        Args:
            llm_provider: The LLM provider to use for reflection
            min_confidence: Minimum confidence threshold for reflection
            max_reflection_tokens: Maximum tokens for reflection response
        """
        self.llm_provider = llm_provider
        self.min_confidence = min_confidence
        self.max_reflection_tokens = max_reflection_tokens
    
    def reflect(self, 
                trajectory: ExecutionTrajectory,
                current_prompt: str,
                task_description: Optional[str] = None) -> Optional[ReflectionResult]:
        """
        Use LLM to generate reflection on execution trace.
        
        Args:
            trajectory: The execution trajectory
            current_prompt: Current system prompt
            task_description: Task description
            
        Returns:
            ReflectionResult or None
        """
        # Generate trace summary
        trace_summary = self._summarize_trajectory(trajectory)
        
        # Generate reflection prompt
        if task_description is None:
            task_description = self._extract_task_description(trajectory)
        
        reflection_prompt = self.REFLECTION_PROMPT.format(
            current_prompt=current_prompt,
            trace_summary=trace_summary,
            task_description=task_description or "No task description provided"
        )
        
        try:
            # Call LLM for reflection
            response = self.llm_provider.invoke(reflection_prompt)
            
            # Parse response
            result = self._parse_reflection_response(response.content)
            
            if result is None:
                return None
            
            # Check confidence threshold
            if result.confidence < self.min_confidence:
                return None
            
            return result
            
        except Exception as e:
            # Log error and return None
            print(f"Reflection failed: {e}")
            return None
    
    def _summarize_trajectory(self, trajectory: ExecutionTrajectory) -> str:
        """
        Generate a summary of the execution trajectory.
        
        Args:
            trajectory: The trajectory to summarize
            
        Returns:
            Summary string
        """
        lines = []
        
        # Basic stats
        lines.append("## 执行统计")
        lines.append(f"- 总步骤数: {trajectory.metadata.total_steps}")
        lines.append(f"- 成功步骤: {trajectory.metadata.successful_steps}")
        lines.append(f"- 失败步骤: {trajectory.metadata.failed_steps}")
        lines.append(f"- 总耗时: {trajectory.metadata.total_duration:.2f}s")
        lines.append("")
        
        # Tool calls
        tool_calls = trajectory.get_tool_calls()
        if tool_calls:
            lines.append("## 工具调用")
            tool_names = {}
            for tc in tool_calls:
                tool_name = tc.input_data.get("tool_name", "unknown")
                tool_names[tool_name] = tool_names.get(tool_name, 0) + 1
            
            for tool_name, count in tool_names.items():
                lines.append(f"- {tool_name}: {count} 次")
            lines.append("")
        
        # Errors
        errors = trajectory.get_errors()
        if errors:
            lines.append("## 错误")
            for error_step in errors:
                if error_step.error_data:
                    error_msg = error_step.error_data.get("error_message", "Unknown error")
                    lines.append(f"- {error_msg}")
            lines.append("")
        
        # Performance metrics
        if trajectory.metadata.total_tokens > 0:
            lines.append("## 性能")
            lines.append(f"- Token 使用: {trajectory.metadata.total_tokens}")
            lines.append(f"- 成本: ${trajectory.metadata.total_cost:.4f}")
        
        return "\n".join(lines)
    
    def _extract_task_description(self, trajectory: ExecutionTrajectory) -> Optional[str]:
        """
        Extract task description from trajectory.
        
        Args:
            trajectory: The trajectory
            
        Returns:
            Task description or None
        """
        task_starts = trajectory.get_steps_by_type(StepType.TASK_START)
        if task_starts:
            first_task = task_starts[0]
            return (
                first_task.input_data.get("task_description") or
                first_task.input_data.get("query") or
                first_task.input_data.get("prompt")
            )
        return None
    
    def _parse_reflection_response(self, response_text: str) -> Optional[ReflectionResult]:
        """
        Parse LLM response into ReflectionResult.
        
        Args:
            response_text: The LLM response text
            
        Returns:
            ReflectionResult or None if parsing fails
        """
        try:
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if not json_match:
                return None
            
            json_str = json_match.group(0)
            data = json.loads(json_str)
            
            # Validate required fields
            if not all(k in data for k in ["optimized_prompt", "reason", "confidence"]):
                return None
            
            # Parse confidence
            confidence = float(data.get("confidence", 0.5))
            if confidence < 0.0 or confidence > 1.0:
                confidence = 0.5
            
            # Parse metrics_delta
            metrics_delta = data.get("metrics_delta", {})
            if not isinstance(metrics_delta, dict):
                metrics_delta = {}
            
            return ReflectionResult(
                optimized_prompt=str(data["optimized_prompt"]),
                reason=str(data["reason"]),
                confidence=confidence,
                metrics_delta=metrics_delta
            )
            
        except Exception as e:
            # Parsing failed
            print(f"Failed to parse reflection response: {e}")
            return None


class ReflectionLoop:
    """
    Orchestrates the reflection and optimization loop.
    
    Manages iterations of execution -> analysis -> prompt optimization.
    """
    
    def __init__(self, 
                 reflector: BaseReflector,
                 confidence_threshold: float = 0.3,
                 max_iterations: int = 3):
        """
        Initialize reflection loop.
        
        Args:
            reflector: The reflector to use
            confidence_threshold: Minimum confidence to accept optimization
            max_iterations: Maximum optimization iterations
        """
        self.reflector = reflector
        self.confidence_threshold = confidence_threshold
        self.max_iterations = max_iterations
        self.reflection_history: List[ReflectionResult] = []
    
    def suggest_optimization(self,
                            trajectory: ExecutionTrajectory,
                            current_prompt: str,
                            task_description: Optional[str] = None) -> Optional[ReflectionResult]:
        """
        Get optimization suggestion for current prompt based on trajectory.
        
        Args:
            trajectory: The execution trajectory
            current_prompt: Current system prompt
            task_description: Optional task description
            
        Returns:
            ReflectionResult if confident optimization found, None otherwise
        """
        result = self.reflector.reflect(
            trajectory, 
            current_prompt, 
            task_description
        )
        
        if result and result.confidence >= self.confidence_threshold:
            self.reflection_history.append(result)
            return result
        
        return None
    
    def get_optimization_history(self) -> List[Dict[str, Any]]:
        """
        Get history of all reflections in this loop.
        
        Returns:
            List of reflection results as dicts
        """
        return [r.to_dict() for r in self.reflection_history]
    
    def get_best_optimization(self) -> Optional[ReflectionResult]:
        """
        Get the best (highest confidence) optimization from history.
        
        Returns:
            ReflectionResult with highest confidence, or None
        """
        if not self.reflection_history:
            return None
        
        return max(self.reflection_history, key=lambda r: r.confidence)
