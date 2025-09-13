"""M5 记忆系统智能缓存管理器

提供智能缓存策略、自适应缓存管理和性能优化。
"""

import logging
import time
import threading
from typing import Dict, List, Optional, Any, Tuple, Set, Callable
from datetime import datetime, timedelta, UTC
from collections import defaultdict, OrderedDict
from dataclasses import dataclass, field
from enum import Enum
import heapq
import hashlib
import pickle
import statistics

from .models import (
    CacheStrategy,
    MemoryType,
    AccessFrequency,
    CachePerformance,
    AdaptiveConfig
)


class CachePolicy(Enum):
    """缓存策略枚举"""
    LRU = "lru"                    # 最近最少使用
    LFU = "lfu"                    # 最少使用频率
    FIFO = "fifo"                  # 先进先出
    ADAPTIVE = "adaptive"          # 自适应
    SEMANTIC = "semantic"          # 语义相关
    PREDICTIVE = "predictive"      # 预测性
    HYBRID = "hybrid"              # 混合策略


class CacheEvent(Enum):
    """缓存事件枚举"""
    HIT = "hit"
    MISS = "miss"
    EVICTION = "eviction"
    INSERTION = "insertion"
    UPDATE = "update"
    PREFETCH = "prefetch"


@dataclass
class CacheEntry:
    """缓存条目"""
    key: str
    value: Any
    size: int
    access_count: int = 0
    last_access: datetime = field(default_factory=datetime.now)
    creation_time: datetime = field(default_factory=datetime.now)
    ttl: Optional[timedelta] = None
    priority: float = 1.0
    semantic_tags: Set[str] = field(default_factory=set)
    access_pattern: List[datetime] = field(default_factory=list)
    
    def is_expired(self) -> bool:
        """检查是否过期"""
        if self.ttl is None:
            return False
        return datetime.now() - self.creation_time > self.ttl
    
    def update_access(self):
        """更新访问信息"""
        self.access_count += 1
        self.last_access = datetime.now()
        self.access_pattern.append(self.last_access)
        
        # 保持访问模式历史在合理范围内
        if len(self.access_pattern) > 100:
            self.access_pattern = self.access_pattern[-50:]
    
    def calculate_score(self, policy: CachePolicy) -> float:
        """根据策略计算分数"""
        now = datetime.now()
        
        if policy == CachePolicy.LRU:
            return (now - self.last_access).total_seconds()
        elif policy == CachePolicy.LFU:
            return -self.access_count
        elif policy == CachePolicy.FIFO:
            return (now - self.creation_time).total_seconds()
        elif policy == CachePolicy.ADAPTIVE:
            # 综合考虑访问频率、时间局部性和大小
            recency_score = 1.0 / max(1, (now - self.last_access).total_seconds() / 3600)
            frequency_score = self.access_count / max(1, (now - self.creation_time).total_seconds() / 3600)
            size_penalty = 1.0 / max(1, self.size / 1024)  # 大文件惩罚
            return -(recency_score * 0.4 + frequency_score * 0.4 + size_penalty * 0.2)
        else:
            return self.priority


@dataclass
class CacheStats:
    """缓存统计信息"""
    hits: int = 0
    misses: int = 0
    evictions: int = 0
    insertions: int = 0
    total_size: int = 0
    entry_count: int = 0
    avg_access_time: float = 0.0
    hit_rate: float = 0.0
    
    def update_hit_rate(self):
        """更新命中率"""
        total_requests = self.hits + self.misses
        self.hit_rate = self.hits / total_requests if total_requests > 0 else 0.0


class IntelligentCacheManager:
    """智能缓存管理器
    
    提供多种缓存策略、自适应管理和性能优化功能。
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化缓存管理器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.name = self.config.get('name', 'intelligent_cache')
        self.logger = logging.getLogger(__name__)
        
        # 缓存配置
        self.max_size = self.config.get('max_size', 1024 * 1024 * 100)  # 100MB
        self.max_entries = self.config.get('max_entries', 10000)
        self.default_ttl = self.config.get('default_ttl', timedelta(hours=24))
        self.cleanup_interval = self.config.get('cleanup_interval', 300)  # 5分钟
        
        # 缓存存储
        self.cache: Dict[str, CacheEntry] = {}
        self.cache_lock = threading.RLock()
        
        # 策略管理
        self.current_policy = CachePolicy.ADAPTIVE
        self.policy = CacheStrategy.ADAPTIVE  # 添加policy属性
        self.policy_weights: Dict[CachePolicy, float] = {
            CachePolicy.LRU: 0.3,
            CachePolicy.LFU: 0.3,
            CachePolicy.ADAPTIVE: 0.4
        }
        
        # 统计信息
        self.stats = CacheStats()
        self.performance_history: List[CachePerformance] = []
        
        # 预测和优化
        self.access_predictor: Optional[Callable] = None
        self.semantic_analyzer: Optional[Callable] = None
        
        # 自适应配置
        self.adaptive_config = AdaptiveConfig(
            config_id="cache_adaptive_config",
            memory_type=MemoryType.EPISODIC,
            cache_strategy=CacheStrategy.ADAPTIVE,
            max_cache_size=self.max_size,
            eviction_threshold=0.8,
            refresh_interval=300,
            learning_rate=0.1,
            adaptation_sensitivity=0.05,
            performance_target={
                'hit_rate': 0.8,
                'avg_latency': 100.0,
                'memory_efficiency': 0.7
            }
        )
        
        # 事件监听器
        self.event_listeners: Dict[CacheEvent, List[Callable]] = defaultdict(list)
        
        # 启动后台任务
        self._start_background_tasks()
    
    def get(self, key: str, default: Any = None) -> Any:
        """获取缓存值
        
        Args:
            key: 缓存键
            default: 默认值
            
        Returns:
            缓存值或默认值
        """
        start_time = time.time()
        
        with self.cache_lock:
            if key in self.cache:
                entry = self.cache[key]
                
                # 检查是否过期
                if entry.is_expired():
                    del self.cache[key]
                    self.stats.misses += 1
                    self._trigger_event(CacheEvent.MISS, key, None)
                    return default
                
                # 更新访问信息
                entry.update_access()
                self.stats.hits += 1
                
                # 更新平均访问时间
                access_time = time.time() - start_time
                self._update_avg_access_time(access_time)
                
                self._trigger_event(CacheEvent.HIT, key, entry.value)
                return entry.value
            else:
                self.stats.misses += 1
                self._trigger_event(CacheEvent.MISS, key, None)
                return default
    
    def put(self, key: str, value: Any, ttl: Optional[timedelta] = None, 
            priority: float = 1.0, semantic_tags: Optional[Set[str]] = None) -> bool:
        """存储缓存值
        
        Args:
            key: 缓存键
            value: 缓存值
            ttl: 生存时间
            priority: 优先级
            semantic_tags: 语义标签
            
        Returns:
            是否成功存储
        """
        try:
            # 计算值大小
            value_size = self._calculate_size(value)
            
            with self.cache_lock:
                # 检查是否需要腾出空间
                if not self._ensure_space(value_size):
                    self.logger.warning(f"无法为键 {key} 腾出足够空间")
                    return False
                
                # 创建缓存条目
                entry = CacheEntry(
                    key=key,
                    value=value,
                    size=value_size,
                    ttl=ttl or self.default_ttl,
                    priority=priority,
                    semantic_tags=semantic_tags or set()
                )
                
                # 存储条目
                is_update = key in self.cache
                if is_update:
                    old_entry = self.cache[key]
                    self.stats.total_size -= old_entry.size
                    self._trigger_event(CacheEvent.UPDATE, key, value)
                else:
                    self.stats.insertions += 1
                    self.stats.entry_count += 1
                    self._trigger_event(CacheEvent.INSERTION, key, value)
                
                self.cache[key] = entry
                self.stats.total_size += value_size
                
                return True
                
        except Exception as e:
            self.logger.error(f"存储缓存失败: {e}")
            return False
    
    def delete(self, key: str) -> bool:
        """删除缓存条目
        
        Args:
            key: 缓存键
            
        Returns:
            是否成功删除
        """
        with self.cache_lock:
            if key in self.cache:
                entry = self.cache[key]
                del self.cache[key]
                self.stats.total_size -= entry.size
                self.stats.entry_count -= 1
                self._trigger_event(CacheEvent.EVICTION, key, entry.value)
                return True
            return False
    
    def clear(self):
        """清空缓存"""
        with self.cache_lock:
            self.cache.clear()
            self.stats = CacheStats()
    
    def _ensure_space(self, required_size: int) -> bool:
        """确保有足够空间
        
        Args:
            required_size: 需要的空间大小
            
        Returns:
            是否成功腾出空间
        """
        # 检查是否超出最大条目数
        while len(self.cache) >= self.max_entries:
            if not self._evict_one():
                return False
        
        # 检查是否超出最大大小
        while self.stats.total_size + required_size > self.max_size:
            if not self._evict_one():
                return False
        
        return True
    
    def _evict_one(self) -> bool:
        """驱逐一个缓存条目
        
        Returns:
            是否成功驱逐
        """
        if not self.cache:
            return False
        
        # 根据当前策略选择驱逐条目
        victim_key = self._select_eviction_victim()
        if victim_key:
            self.delete(victim_key)
            self.stats.evictions += 1
            return True
        
        return False
    
    def _select_eviction_victim(self) -> Optional[str]:
        """选择驱逐目标
        
        Returns:
            要驱逐的键
        """
        if not self.cache:
            return None
        
        if self.current_policy == CachePolicy.HYBRID:
            return self._hybrid_eviction_selection()
        else:
            # 计算所有条目的分数
            scored_entries = []
            for key, entry in self.cache.items():
                score = entry.calculate_score(self.current_policy)
                scored_entries.append((score, key))
            
            # 选择分数最高的（最应该被驱逐的）
            scored_entries.sort(reverse=True)
            return scored_entries[0][1] if scored_entries else None
    
    def _hybrid_eviction_selection(self) -> Optional[str]:
        """混合策略驱逐选择"""
        if not self.cache:
            return None
        
        # 为每个策略计算分数
        policy_scores: Dict[str, Dict[CachePolicy, float]] = {}
        
        for key, entry in self.cache.items():
            policy_scores[key] = {}
            for policy in [CachePolicy.LRU, CachePolicy.LFU, CachePolicy.ADAPTIVE]:
                policy_scores[key][policy] = entry.calculate_score(policy)
        
        # 计算加权综合分数
        final_scores = []
        for key in self.cache:
            weighted_score = sum(
                policy_scores[key][policy] * self.policy_weights[policy]
                for policy in self.policy_weights
            )
            final_scores.append((weighted_score, key))
        
        # 选择分数最高的
        final_scores.sort(reverse=True)
        return final_scores[0][1] if final_scores else None
    
    def _calculate_size(self, value: Any) -> int:
        """计算值的大小
        
        Args:
            value: 要计算大小的值
            
        Returns:
            值的大小（字节）
        """
        try:
            return len(pickle.dumps(value))
        except Exception:
            # 如果无法序列化，使用估算
            if isinstance(value, str):
                return len(value.encode('utf-8'))
            elif isinstance(value, (list, tuple)):
                return sum(self._calculate_size(item) for item in value)
            elif isinstance(value, dict):
                return sum(self._calculate_size(k) + self._calculate_size(v) 
                          for k, v in value.items())
            else:
                return 1024  # 默认1KB
    
    def _update_avg_access_time(self, access_time: float):
        """更新平均访问时间"""
        if self.stats.avg_access_time == 0:
            self.stats.avg_access_time = access_time
        else:
            # 使用指数移动平均
            alpha = 0.1
            self.stats.avg_access_time = (alpha * access_time + 
                                        (1 - alpha) * self.stats.avg_access_time)
    
    def optimize_policy(self) -> bool:
        """优化缓存策略
        
        Returns:
            是否进行了优化
        """
        min_samples = 100  # 最小样本数
        if len(self.performance_history) < min_samples:
            return False
        
        # 分析最近的性能数据
        recent_performance = self.performance_history[-min_samples:]
        
        # 计算当前性能指标
        current_hit_rate = statistics.mean([p.hit_rate for p in recent_performance])
        current_avg_latency = statistics.mean([p.average_latency for p in recent_performance])
        
        # 尝试不同的策略权重
        best_policy = self.current_policy
        best_score = self._calculate_policy_score(current_hit_rate, current_avg_latency)
        
        for policy in CachePolicy:
            if policy == self.current_policy:
                continue
            
            # 模拟使用该策略的性能
            simulated_score = self._simulate_policy_performance(policy)
            
            if simulated_score > best_score + self.adaptive_config.adaptation_sensitivity:
                best_policy = policy
                best_score = simulated_score
        
        # 如果找到更好的策略，切换
        if best_policy != self.current_policy:
            old_policy = self.current_policy
            self.current_policy = best_policy
            self.logger.info(f"缓存策略从 {old_policy.value} 切换到 {best_policy.value}")
            return True
        
        return False
    
    def _calculate_policy_score(self, hit_rate: float, avg_latency: float) -> float:
        """计算策略分数"""
        # 综合考虑命中率和延迟
        return hit_rate * 0.7 - (avg_latency / 1000) * 0.3
    
    def _simulate_policy_performance(self, policy: CachePolicy) -> float:
        """模拟策略性能
        
        Args:
            policy: 要模拟的策略
            
        Returns:
            预期性能分数
        """
        # 简化的模拟：基于历史数据和策略特性
        base_score = 0.5
        
        if policy == CachePolicy.LRU:
            # LRU在时间局部性强的场景下表现好
            temporal_locality = self._calculate_temporal_locality()
            base_score += temporal_locality * 0.3
        elif policy == CachePolicy.LFU:
            # LFU在访问频率差异大的场景下表现好
            frequency_variance = self._calculate_frequency_variance()
            base_score += frequency_variance * 0.3
        elif policy == CachePolicy.ADAPTIVE:
            # 自适应策略通常表现稳定
            base_score += 0.2
        
        return base_score
    
    def _calculate_temporal_locality(self) -> float:
        """计算时间局部性"""
        if not self.cache:
            return 0.0
        
        # 分析访问模式的时间局部性
        locality_scores = []
        for entry in self.cache.values():
            if len(entry.access_pattern) >= 2:
                intervals = []
                for i in range(1, len(entry.access_pattern)):
                    interval = (entry.access_pattern[i] - entry.access_pattern[i-1]).total_seconds()
                    intervals.append(interval)
                
                if intervals:
                    # 间隔越小，局部性越强
                    avg_interval = statistics.mean(intervals)
                    locality_score = 1.0 / (1.0 + avg_interval / 3600)  # 以小时为单位
                    locality_scores.append(locality_score)
        
        return statistics.mean(locality_scores) if locality_scores else 0.0
    
    def _calculate_frequency_variance(self) -> float:
        """计算访问频率方差"""
        if not self.cache:
            return 0.0
        
        access_counts = [entry.access_count for entry in self.cache.values()]
        if len(access_counts) < 2:
            return 0.0
        
        variance = statistics.variance(access_counts)
        mean_count = statistics.mean(access_counts)
        
        # 归一化方差
        return min(1.0, variance / max(1.0, mean_count))
    
    def prefetch(self, keys: List[str], predictor: Optional[Callable] = None) -> int:
        """预取数据
        
        Args:
            keys: 要预取的键列表
            predictor: 预测函数
            
        Returns:
            成功预取的数量
        """
        if not keys:
            return 0
        
        prefetched = 0
        predictor = predictor or self.access_predictor
        
        if not predictor:
            self.logger.warning("没有可用的预测器")
            return 0
        
        for key in keys:
            if key not in self.cache:
                try:
                    # 使用预测器获取值
                    predicted_value = predictor(key)
                    if predicted_value is not None:
                        success = self.put(key, predicted_value, priority=0.5)
                        if success:
                            prefetched += 1
                            self._trigger_event(CacheEvent.PREFETCH, key, predicted_value)
                except Exception as e:
                    self.logger.error(f"预取键 {key} 失败: {e}")
        
        self.logger.info(f"预取完成: {prefetched}/{len(keys)}")
        return prefetched
    
    def semantic_search(self, tags: Set[str], limit: int = 10) -> List[Tuple[str, Any]]:
        """基于语义标签搜索缓存
        
        Args:
            tags: 语义标签集合
            limit: 返回结果限制
            
        Returns:
            匹配的缓存条目列表
        """
        results = []
        
        with self.cache_lock:
            for key, entry in self.cache.items():
                if entry.semantic_tags.intersection(tags):
                    # 计算相似度分数
                    similarity = len(entry.semantic_tags.intersection(tags)) / len(tags)
                    results.append((similarity, key, entry.value))
        
        # 按相似度排序
        results.sort(reverse=True)
        return [(key, value) for _, key, value in results[:limit]]
    
    def add_event_listener(self, event: CacheEvent, listener: Callable):
        """添加事件监听器
        
        Args:
            event: 缓存事件
            listener: 监听器函数
        """
        self.event_listeners[event].append(listener)
    
    def _trigger_event(self, event: CacheEvent, key: str, value: Any):
        """触发事件
        
        Args:
            event: 事件类型
            key: 缓存键
            value: 缓存值
        """
        for listener in self.event_listeners[event]:
            try:
                listener(event, key, value)
            except Exception as e:
                self.logger.error(f"事件监听器执行失败: {e}")
    
    def _start_background_tasks(self):
        """启动后台任务"""
        def cleanup_task():
            while True:
                try:
                    self._cleanup_expired_entries()
                    self._record_performance_metrics()
                    time.sleep(self.cleanup_interval)
                except Exception as e:
                    self.logger.error(f"后台清理任务失败: {e}")
        
        cleanup_thread = threading.Thread(target=cleanup_task, daemon=True)
        cleanup_thread.start()
    
    def _cleanup_expired_entries(self):
        """清理过期条目"""
        expired_keys = []
        
        with self.cache_lock:
            for key, entry in self.cache.items():
                if entry.is_expired():
                    expired_keys.append(key)
        
        for key in expired_keys:
            self.delete(key)
        
        if expired_keys:
            self.logger.debug(f"清理了 {len(expired_keys)} 个过期条目")
    
    def _record_performance_metrics(self):
        """记录性能指标"""
        self.stats.update_hit_rate()
        
        performance = CachePerformance(
            cache_name=self.name,
            strategy=self.policy,
            total_requests=self.stats.hits + self.stats.misses,
            cache_hits=self.stats.hits,
            cache_misses=self.stats.misses,
            evictions=self.stats.evictions,
            memory_usage=self.stats.total_size,
            max_memory_limit=self.max_size,
            average_access_time=self.stats.avg_access_time * 1000,  # 转换为毫秒
            hot_entries=[(k, v.access_count) for k, v in sorted(self.cache.items(), key=lambda x: x[1].access_count, reverse=True)[:10]],
            cold_entries=[(k, v.last_access) for k, v in sorted(self.cache.items(), key=lambda x: x[1].last_access)[:10]],
            timestamp=datetime.now()
        )
        
        self.performance_history.append(performance)
        
        # 保持历史记录在合理范围内
        max_history = 1000
        if len(self.performance_history) > max_history:
            self.performance_history = self.performance_history[-max_history//2:]
    
    def get_cache_statistics(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        self.stats.update_hit_rate()
        
        return {
            'hits': self.stats.hits,
            'misses': self.stats.misses,
            'hit_rate': self.stats.hit_rate,
            'evictions': self.stats.evictions,
            'insertions': self.stats.insertions,
            'total_size': self.stats.total_size,
            'entry_count': self.stats.entry_count,
            'avg_access_time_ms': self.stats.avg_access_time * 1000,
            'current_policy': self.current_policy.value,
            'cache_utilization': self.stats.total_size / self.max_size,
            'entry_utilization': self.stats.entry_count / self.max_entries
        }
    
    def export_cache_data(self) -> Dict[str, Any]:
        """导出缓存数据"""
        with self.cache_lock:
            exported_data = {
                'entries': {},
                'statistics': self.get_cache_statistics(),
                'performance_history': [
                    {
                        'hit_rate': p.hit_rate,
                        'average_latency': p.average_latency,
                        'cache_size': p.cache_size,
                        'timestamp': p.timestamp.isoformat()
                    }
                    for p in self.performance_history[-100:]  # 最近100条记录
                ],
                'export_time': datetime.now().isoformat()
            }
            
            # 导出缓存条目（不包含实际值，只包含元数据）
            for key, entry in self.cache.items():
                exported_data['entries'][key] = {
                    'size': entry.size,
                    'access_count': entry.access_count,
                    'last_access': entry.last_access.isoformat(),
                    'creation_time': entry.creation_time.isoformat(),
                    'priority': entry.priority,
                    'semantic_tags': list(entry.semantic_tags),
                    'access_pattern_count': len(entry.access_pattern)
                }
            
            return exported_data