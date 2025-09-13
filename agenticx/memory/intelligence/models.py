"""M5 记忆系统智能优化数据模型

定义记忆系统智能优化所需的核心数据结构。
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union, Tuple
from datetime import datetime, timedelta, UTC
from enum import Enum


class MemoryType(Enum):
    """记忆类型枚举"""
    SHORT_TERM = "short_term"
    LONG_TERM = "long_term"
    WORKING = "working"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"


class AccessFrequency(Enum):
    """访问频率枚举"""
    VERY_HIGH = "very_high"  # 每分钟多次
    HIGH = "high"           # 每小时多次
    MEDIUM = "medium"       # 每天多次
    LOW = "low"             # 每周多次
    VERY_LOW = "very_low"   # 很少访问


class CacheStrategy(Enum):
    """缓存策略枚举"""
    LRU = "lru"             # 最近最少使用
    LFU = "lfu"             # 最少使用频率
    FIFO = "fifo"           # 先进先出
    ADAPTIVE = "adaptive"   # 自适应策略
    SEMANTIC = "semantic"   # 语义相关性
    TEMPORAL = "temporal"   # 时间相关性


class OptimizationType(Enum):
    """优化类型枚举"""
    RETRIEVAL_SPEED = "retrieval_speed"
    MEMORY_USAGE = "memory_usage"
    CACHE_HIT_RATE = "cache_hit_rate"
    ACCESS_PATTERN = "access_pattern"
    STORAGE_EFFICIENCY = "storage_efficiency"


@dataclass
class MemoryAccessPattern:
    """内存访问模式"""
    pattern_id: str
    memory_type: MemoryType
    access_frequency: AccessFrequency
    access_times: List[datetime]
    access_contexts: List[Dict[str, Any]]
    data_size: int  # 字节数
    retrieval_latency: float  # 毫秒
    success_rate: float  # 0-1
    semantic_similarity: Optional[float] = None
    temporal_locality: Optional[float] = None
    
    def get_access_rate(self, time_window_hours: int = 24) -> float:
        """获取指定时间窗口内的访问率"""
        if not self.access_times:
            return 0.0
        
        cutoff_time = datetime.now() - timedelta(hours=time_window_hours)
        recent_accesses = [t for t in self.access_times if t >= cutoff_time]
        return len(recent_accesses) / time_window_hours
    
    def get_average_latency(self) -> float:
        """获取平均检索延迟"""
        return self.retrieval_latency


@dataclass
class RetrievalContext:
    """检索上下文"""
    query: str
    memory_types: List[MemoryType] = field(default_factory=list)
    query_type: str = "semantic"  # semantic, keyword, temporal, etc.
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    priority: int = 1  # 1-10, 10最高
    max_results: Optional[int] = None
    similarity_threshold: float = 0.7
    time_range: Optional[Tuple[datetime, datetime]] = None
    context_tags: Optional[set] = None
    metadata_filters: Dict[str, Any] = field(default_factory=dict)
    
    def to_cache_key(self) -> str:
        """生成缓存键"""
        key_parts = [
            self.query,
            self.query_type,
            str(self.similarity_threshold),
            str(self.max_results or "")
        ]
        return "|".join(key_parts)


@dataclass
class MemoryMetrics:
    """内存系统指标"""
    memory_type: MemoryType
    access_count: int
    hit_rate: float
    average_latency: float
    cache_efficiency: float
    storage_utilization: float
    timestamp: datetime = field(default_factory=datetime.now)
    
    def get_overall_performance_score(self) -> float:
        """计算整体性能分数"""
        # 综合各项指标计算性能分数
        hit_rate_score = self.hit_rate
        speed_score = max(0, 1 - (self.average_latency / 1000))  # 假设1秒为基准
        efficiency_score = self.cache_efficiency
        storage_score = self.storage_utilization
        
        return (hit_rate_score + speed_score + efficiency_score + storage_score) / 4


@dataclass
class OptimizationResult:
    """优化结果"""
    optimization_id: str
    optimization_type: OptimizationType
    before_metrics: MemoryMetrics
    after_metrics: MemoryMetrics
    improvement_percentage: float
    optimization_actions: List[str]
    execution_time: float  # 秒
    success: bool
    error_message: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    
    @property
    def applied_optimizations(self) -> List[str]:
        """应用的优化（别名）"""
        return self.optimization_actions
    
    def get_improvement_summary(self) -> Dict[str, float]:
        """获取改进摘要"""
        return {
            'cache_hit_rate_improvement': 
                self.after_metrics.hit_rate - self.before_metrics.hit_rate,
            'retrieval_time_improvement': 
                self.before_metrics.average_latency - self.after_metrics.average_latency,
            'memory_usage_reduction': 
                0.0,  # MemoryMetrics中没有直接的内存使用量字段
            'overall_performance_improvement': 
                self.after_metrics.get_overall_performance_score() - 
                self.before_metrics.get_overall_performance_score()
        }


@dataclass
class MemoryUsageStats:
    """内存使用统计"""
    total_patterns: int = 0
    active_patterns: int = 0
    cache_hit_rate: float = 0.0
    average_latency: float = 0.0
    memory_efficiency: float = 0.0
    success_rate: float = 0.0
    pattern_diversity: int = 0
    total_accesses: int = 0
    last_updated: datetime = field(default_factory=datetime.now)
    
    def get_efficiency_score(self) -> float:
        """计算效率分数"""
        return (self.cache_hit_rate + self.memory_efficiency + self.success_rate) / 3


@dataclass
class RetrievalPerformance:
    """检索性能数据"""
    query_id: str
    query_text: str
    query_type: str
    execution_time: float  # 毫秒
    result_count: int
    cache_hit: bool
    similarity_scores: List[float]
    memory_types_accessed: List[MemoryType]
    optimization_applied: List[str]
    user_satisfaction: Optional[float] = None  # 0-1
    timestamp: datetime = field(default_factory=datetime.now)
    
    def get_performance_score(self) -> float:
        """计算性能分数"""
        # 基于执行时间、结果质量等计算性能分数
        time_score = max(0, 1 - (self.execution_time / 1000))  # 1秒为基准
        result_score = min(1.0, self.result_count / 10)  # 10个结果为满分
        cache_score = 1.0 if self.cache_hit else 0.5
        
        base_score = (time_score + result_score + cache_score) / 3
        
        if self.user_satisfaction is not None:
            return (base_score + self.user_satisfaction) / 2
        
        return base_score


@dataclass
class CachePerformance:
    """缓存性能数据"""
    cache_name: str
    strategy: CacheStrategy
    total_requests: int
    cache_hits: int
    cache_misses: int
    evictions: int
    memory_usage: int  # 字节
    max_memory_limit: int  # 字节
    average_access_time: float  # 毫秒
    hot_entries: List[Tuple[str, int]]  # (key, access_count)
    cold_entries: List[Tuple[str, datetime]]  # (key, last_access)
    timestamp: datetime = field(default_factory=datetime.now)
    
    @property
    def hit_rate(self) -> float:
        """缓存命中率"""
        if self.total_requests == 0:
            return 0.0
        return self.cache_hits / self.total_requests
    
    @property
    def memory_utilization(self) -> float:
        """内存利用率"""
        if self.max_memory_limit == 0:
            return 0.0
        return self.memory_usage / self.max_memory_limit
    
    @property
    def average_latency(self) -> float:
        """平均延迟（别名）"""
        return self.average_access_time
    
    @property
    def cache_size(self) -> int:
        """缓存大小（别名）"""
        return self.memory_usage
    
    def get_efficiency_score(self) -> float:
        """计算缓存效率分数"""
        hit_rate_score = self.hit_rate
        memory_score = 1 - abs(0.8 - self.memory_utilization)  # 80%利用率为最优
        access_time_score = max(0, 1 - (self.average_access_time / 100))  # 100ms为基准
        
        return (hit_rate_score + memory_score + access_time_score) / 3


@dataclass
class MemoryOptimizationRule:
    """内存优化规则"""
    rule_id: str
    name: str
    condition: Any  # 触发条件表达式或函数
    action: Any  # 执行动作或函数
    priority: float
    enabled: bool = True
    description: str = ""
    success_count: int = 0
    failure_count: int = 0
    last_executed: Optional[datetime] = None
    
    @property
    def success_rate(self) -> float:
        """成功率"""
        total = self.success_count + self.failure_count
        if total == 0:
            return 0.0
        return self.success_count / total


@dataclass
class AdaptiveConfig:
    """自适应配置"""
    config_id: str
    memory_type: MemoryType
    cache_strategy: CacheStrategy
    max_cache_size: int
    eviction_threshold: float
    refresh_interval: int  # 秒
    learning_rate: float  # 0-1
    adaptation_sensitivity: float  # 0-1
    performance_target: Dict[str, float]  # 性能目标
    last_updated: datetime = field(default_factory=datetime.now)
    
    def should_adapt(self, current_performance: Dict[str, float]) -> bool:
        """判断是否需要自适应调整"""
        for metric, target in self.performance_target.items():
            if metric in current_performance:
                deviation = abs(current_performance[metric] - target) / target
                if deviation > self.adaptation_sensitivity:
                    return True
        return False