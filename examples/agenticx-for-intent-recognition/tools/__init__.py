"""工具模块

提供多种工具：
- 实体抽取工具：UIE、LLM、规则、混合抽取器
- 后处理工具：置信度调整、结果验证、冲突解决、实体优化、意图精化
- 匹配工具：正则匹配、完全匹配、规则匹配
"""

# 实体抽取相关
from .entity_models import (
    Entity,
    EntityType,
    ExtractionResult,
    ExtractionMethod,
    EntityExtractionConfig,
    EntityMergeResult,
    EntityValidationResult
)

from .uie_extractor import UIEExtractor
from .llm_extractor import LLMExtractor
from .rule_extractor import RuleExtractor
from .hybrid_extractor import HybridExtractor

# 后处理相关
from .post_processing_models import (
    ProcessingStatus,
    ConflictType,
    ValidationLevel,
    ProcessedResult,
    ValidationResult,
    ConflictInfo,
    ConflictResolutionResult,
    ConfidenceAdjustment,
    EntityOptimization,
    IntentRefinement,
    PostProcessingConfig
)
from .post_processing_tool import PostProcessingTool
from .confidence_adjustment_tool import ConfidenceAdjustmentTool
from .result_validation_tool import ResultValidationTool
from .conflict_resolution_tool import ConflictResolutionTool
from .entity_optimization_tool import EntityOptimizationTool
from .intent_refinement_tool import IntentRefinementTool

# 匹配工具
from .regex_match_tool import RegexMatchTool
from .full_match_tool import FullMatchTool
from .rule_matching_tool import RuleMatchingTool
from .rule_models import RuleConfig, Match, RuleMatchResult

__all__ = [
    # 数据模型
    "Entity",
    "EntityType",
    "ExtractionResult",
    "ExtractionMethod",
    "EntityExtractionConfig",
    "EntityMergeResult",
    "EntityValidationResult",
    
    # 抽取工具
    "UIEExtractor",
    "LLMExtractor",
    "RuleExtractor",
    "HybridExtractor",
    
    # 后处理模型
    "ProcessingStatus",
    "ConflictType",
    "ValidationLevel",
    "ProcessedResult",
    "ValidationResult",
    "ConflictInfo",
    "ConflictResolutionResult",
    "ConfidenceAdjustment",
    "EntityOptimization",
    "IntentRefinement",
    "PostProcessingConfig",
    
    # 后处理工具
    "PostProcessingTool",
    "ConfidenceAdjustmentTool",
    "ResultValidationTool",
    "ConflictResolutionTool",
    "EntityOptimizationTool",
    "IntentRefinementTool",
    
    # 匹配工具
    "RegexMatchTool",
    "FullMatchTool",
    "RuleMatchingTool",
    "RuleConfig",
    "Match",
    "RuleMatchResult",
]

# 版本信息
__version__ = "1.0.0"

# 模块描述
__description__ = "AgenticX实体抽取工具集，支持多种抽取方法和灵活的配置选项"