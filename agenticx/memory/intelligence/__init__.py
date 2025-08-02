"""M5 内存系统智能优化模块

提供内存系统的智能优化功能，包括：
- 智能内存管理引擎
- 自适应检索优化器
- 内存使用模式分析器
- 智能缓存策略管理器
"""

from .memory_intelligence import MemoryIntelligenceEngine
from .retrieval_optimizer import AdaptiveRetrievalOptimizer
from .pattern_analyzer import MemoryPatternAnalyzer
from .cache_manager import IntelligentCacheManager
from .models import (
    MemoryAccessPattern,
    RetrievalContext,
    CacheStrategy,
    MemoryMetrics,
    OptimizationResult,
    MemoryUsageStats,
    RetrievalPerformance,
    CachePerformance
)

__all__ = [
    'MemoryIntelligenceEngine',
    'AdaptiveRetrievalOptimizer',
    'MemoryPatternAnalyzer',
    'IntelligentCacheManager',
    'MemoryAccessPattern',
    'RetrievalContext',
    'CacheStrategy',
    'MemoryMetrics',
    'OptimizationResult',
    'MemoryUsageStats',
    'RetrievalPerformance',
    'CachePerformance'
]

# 模块版本
__version__ = '1.0.0'

# 模块描述
__description__ = 'M5 记忆系统智能优化模块 - 提供智能记忆管理、自适应检索优化和缓存策略管理功能'