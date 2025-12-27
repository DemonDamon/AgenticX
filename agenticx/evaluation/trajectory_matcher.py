"""
TrajectoryMatcher: 轨迹匹配评估

借鉴 ADK 的 Trajectory Matching 机制，支持多种匹配模式。
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
from .evalset import ExpectedToolUse


class MatchMode(Enum):
    """
    轨迹匹配模式
    
    - EXACT: 完全匹配，实际调用序列必须与预期完全一致（顺序、数量）
    - IN_ORDER: 顺序匹配，预期的调用必须按顺序出现，但可以有额外调用
    - ANY_ORDER: 任意顺序，预期的调用都必须出现，但顺序不限
    """
    EXACT = "exact"
    IN_ORDER = "in_order"
    ANY_ORDER = "any_order"


@dataclass
class ToolCall:
    """
    工具调用记录
    """
    tool_name: str
    tool_input: Optional[Dict[str, Any]] = None
    tool_output: Optional[Any] = None
    success: bool = True
    error: Optional[str] = None
    timestamp: Optional[str] = None
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ToolCall":
        """从字典创建"""
        return cls(
            tool_name=data.get("tool_name", data.get("name", "")),
            tool_input=data.get("tool_input", data.get("input", data.get("args"))),
            tool_output=data.get("tool_output", data.get("output", data.get("result"))),
            success=data.get("success", True),
            error=data.get("error"),
            timestamp=data.get("timestamp")
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "tool_name": self.tool_name,
            "tool_input": self.tool_input,
            "tool_output": self.tool_output,
            "success": self.success,
            "error": self.error,
            "timestamp": self.timestamp
        }


@dataclass
class MatchResult:
    """
    匹配结果
    """
    matched: bool
    score: float  # 0.0 - 1.0
    expected_count: int
    actual_count: int
    matched_count: int
    details: List[Dict[str, Any]] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "matched": self.matched,
            "score": self.score,
            "expected_count": self.expected_count,
            "actual_count": self.actual_count,
            "matched_count": self.matched_count,
            "details": self.details
        }


class TrajectoryMatcher:
    """
    轨迹匹配器
    
    用于比较实际的工具调用轨迹与预期轨迹。
    """
    
    def __init__(self, mode: MatchMode = MatchMode.IN_ORDER):
        """
        初始化匹配器
        
        Args:
            mode: 匹配模式
        """
        self.mode = mode
    
    def match(
        self,
        actual: List[ToolCall],
        expected: List[ExpectedToolUse]
    ) -> MatchResult:
        """
        执行轨迹匹配
        
        Args:
            actual: 实际的工具调用列表
            expected: 预期的工具调用列表
            
        Returns:
            匹配结果
        """
        if not expected:
            # 没有预期，总是匹配
            return MatchResult(
                matched=True,
                score=1.0,
                expected_count=0,
                actual_count=len(actual),
                matched_count=0,
                details=[{"message": "No expected tool calls specified"}]
            )
        
        if self.mode == MatchMode.EXACT:
            return self._exact_match(actual, expected)
        elif self.mode == MatchMode.IN_ORDER:
            return self._in_order_match(actual, expected)
        else:  # ANY_ORDER
            return self._any_order_match(actual, expected)
    
    def _exact_match(
        self,
        actual: List[ToolCall],
        expected: List[ExpectedToolUse]
    ) -> MatchResult:
        """完全匹配"""
        details = []
        
        # 数量必须一致
        if len(actual) != len(expected):
            return MatchResult(
                matched=False,
                score=0.0,
                expected_count=len(expected),
                actual_count=len(actual),
                matched_count=0,
                details=[{
                    "error": f"Count mismatch: expected {len(expected)}, got {len(actual)}"
                }]
            )
        
        matched_count = 0
        for i, (act, exp) in enumerate(zip(actual, expected)):
            is_match = exp.matches(act.tool_name, act.tool_input)
            if is_match:
                matched_count += 1
                details.append({
                    "index": i,
                    "expected": exp.tool_name,
                    "actual": act.tool_name,
                    "matched": True
                })
            else:
                details.append({
                    "index": i,
                    "expected": exp.tool_name,
                    "actual": act.tool_name,
                    "matched": False,
                    "reason": "Tool name or input mismatch"
                })
        
        score = matched_count / len(expected) if expected else 1.0
        
        return MatchResult(
            matched=matched_count == len(expected),
            score=score,
            expected_count=len(expected),
            actual_count=len(actual),
            matched_count=matched_count,
            details=details
        )
    
    def _in_order_match(
        self,
        actual: List[ToolCall],
        expected: List[ExpectedToolUse]
    ) -> MatchResult:
        """
        顺序匹配
        
        预期的调用必须按顺序出现在实际调用中，但可以有额外调用。
        """
        details = []
        exp_idx = 0
        matched_count = 0
        
        for act_idx, act in enumerate(actual):
            if exp_idx >= len(expected):
                break
            
            exp = expected[exp_idx]
            if exp.matches(act.tool_name, act.tool_input):
                matched_count += 1
                details.append({
                    "expected_index": exp_idx,
                    "actual_index": act_idx,
                    "expected": exp.tool_name,
                    "actual": act.tool_name,
                    "matched": True
                })
                exp_idx += 1
        
        # 记录未匹配的预期
        for i in range(exp_idx, len(expected)):
            details.append({
                "expected_index": i,
                "expected": expected[i].tool_name,
                "matched": False,
                "reason": "Not found in actual trajectory"
            })
        
        score = matched_count / len(expected) if expected else 1.0
        
        return MatchResult(
            matched=matched_count == len(expected),
            score=score,
            expected_count=len(expected),
            actual_count=len(actual),
            matched_count=matched_count,
            details=details
        )
    
    def _any_order_match(
        self,
        actual: List[ToolCall],
        expected: List[ExpectedToolUse]
    ) -> MatchResult:
        """
        任意顺序匹配
        
        预期的调用都必须出现，但顺序不限。
        """
        details = []
        matched_expected = set()
        
        for exp_idx, exp in enumerate(expected):
            found = False
            for act_idx, act in enumerate(actual):
                if exp.matches(act.tool_name, act.tool_input):
                    matched_expected.add(exp_idx)
                    details.append({
                        "expected_index": exp_idx,
                        "actual_index": act_idx,
                        "expected": exp.tool_name,
                        "actual": act.tool_name,
                        "matched": True
                    })
                    found = True
                    break
            
            if not found:
                details.append({
                    "expected_index": exp_idx,
                    "expected": exp.tool_name,
                    "matched": False,
                    "reason": "Not found in actual trajectory"
                })
        
        matched_count = len(matched_expected)
        score = matched_count / len(expected) if expected else 1.0
        
        return MatchResult(
            matched=matched_count == len(expected),
            score=score,
            expected_count=len(expected),
            actual_count=len(actual),
            matched_count=matched_count,
            details=details
        )


def match_trajectory(
    actual: List[Dict[str, Any]],
    expected: List[ExpectedToolUse],
    mode: MatchMode = MatchMode.IN_ORDER
) -> float:
    """
    便捷函数：计算轨迹匹配分数
    
    Args:
        actual: 实际的工具调用轨迹（字典列表）
        expected: 预期的工具调用列表
        mode: 匹配模式
        
    Returns:
        匹配分数 (0.0-1.0)
    """
    # 转换为 ToolCall 对象
    tool_calls = [ToolCall.from_dict(tc) for tc in actual]
    
    matcher = TrajectoryMatcher(mode=mode)
    result = matcher.match(tool_calls, expected)
    
    return result.score

