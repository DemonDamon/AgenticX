"""
AgenticX 评测标准化模块

提供标准化的评测集格式和轨迹匹配能力：
- EvalSet/EvalCase: 评测集数据模型（借鉴 ADK evalset.json 格式）
- TrajectoryMatcher: 轨迹匹配评估
- EvalRunner: 评测运行器
"""

from .evalset import (
    EvalCase,
    EvalSet,
    ExpectedToolUse,
    EvalResult,
    EvalSummary,
)
from .trajectory_matcher import (
    MatchMode,
    TrajectoryMatcher,
    ToolCall,
    match_trajectory,
)
from .runner import EvalRunner
from .trace_converter import TraceToEvalSetConverter

__all__ = [
    # EvalSet 数据模型
    "EvalCase",
    "EvalSet",
    "ExpectedToolUse",
    "EvalResult",
    "EvalSummary",
    # 轨迹匹配
    "MatchMode",
    "TrajectoryMatcher",
    "ToolCall",
    "match_trajectory",
    # 运行器
    "EvalRunner",
    # 轨迹转换
    "TraceToEvalSetConverter",
]

