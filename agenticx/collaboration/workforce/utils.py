"""
Workforce 工具函数和枚举定义

内化自 CAMEL-AI 的 Workforce 工具函数。
参考：camel/societies/workforce/utils.py
License: Apache 2.0 (CAMEL-AI.org)
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class RecoveryStrategy(str, Enum):
    """故障恢复策略枚举
    
    参考：camel/societies/workforce/utils.py:RecoveryStrategy
    """
    RETRY = "retry"
    REASSIGN = "reassign"
    DECOMPOSE = "decompose"
    REPLAN = "replan"
    CREATE_WORKER = "create_worker"

    def __str__(self):
        return self.value

    def __repr__(self):
        return f"RecoveryStrategy.{self.name}"


class WorkforceMode(str, Enum):
    """Workforce 执行模式"""
    AUTO_DECOMPOSE = "auto_decompose"  # 智能恢复模式
    PIPELINE = "pipeline"  # 简单重试模式

    def __str__(self):
        return self.value


class FailureHandlingConfig(BaseModel):
    """故障处理配置
    
    参考：camel/societies/workforce/utils.py:FailureHandlingConfig
    """
    max_retries: int = Field(
        default=3,
        ge=1,
        description="Maximum retry attempts before giving up on a task",
    )
    
    enabled_strategies: Optional[List[RecoveryStrategy]] = Field(
        default=None,
        description="List of enabled recovery strategies. None means all "
        "enabled. Empty list means no recovery (immediate failure). "
        "Can be strings like ['retry', 'replan'] or RecoveryStrategy enums.",
    )
    
    halt_on_max_retries: bool = Field(
        default=True,
        description="Whether to halt workforce when max retries exceeded",
    )

    @field_validator("enabled_strategies", mode="before")
    @classmethod
    def validate_enabled_strategies(
        cls, v
    ) -> Optional[List[RecoveryStrategy]]:
        """Convert string list to RecoveryStrategy enum list."""
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("enabled_strategies must be a list or None")

        result = []
        for item in v:
            if isinstance(item, RecoveryStrategy):
                result.append(item)
            elif isinstance(item, str):
                try:
                    result.append(RecoveryStrategy(item.lower()))
                except ValueError:
                    valid = [s.value for s in RecoveryStrategy]
                    raise ValueError(
                        f"Invalid strategy '{item}'. "
                        f"Valid options: {valid}"
                    )
            else:
                raise ValueError(
                    f"Strategy must be string or RecoveryStrategy, "
                    f"got {type(item).__name__}"
                )
        return result


class TaskAnalysisResult(BaseModel):
    """任务分析结果（故障分析或质量评估）
    
    参考：camel/societies/workforce/utils.py:TaskAnalysisResult
    """
    reasoning: str = Field(
        description="Explanation for the analysis result or recovery decision"
    )
    
    recovery_strategy: Optional[RecoveryStrategy] = Field(
        default=None,
        description="Recommended recovery strategy. None indicates no "
        "recovery needed (quality sufficient).",
    )
    
    modified_task_content: Optional[str] = Field(
        default=None,
        description="Modified task content if strategy requires replan",
    )
    
    quality_score: Optional[int] = Field(
        default=None,
        description="Quality score from 0 to 100 (only for quality "
        "evaluation). None indicates this is a failure analysis.",
        ge=0,
        le=100,
    )
    
    issues: List[str] = Field(
        default_factory=list,
        description="List of issues found. For failures: error details. "
        "For quality evaluation: quality issues.",
    )
    
    @property
    def is_quality_evaluation(self) -> bool:
        """Check if this is a quality evaluation result."""
        return self.quality_score is not None
