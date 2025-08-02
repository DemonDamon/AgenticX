"""M5 内存系统智能优化测试

测试内存智能引擎、自适应检索优化器、模式分析器和智能缓存管理器的功能。
"""

import pytest
import time
from datetime import datetime, timedelta
from typing import Dict, List, Any
from unittest.mock import Mock, patch

from agenticx.memory.intelligence import (
    MemoryIntelligenceEngine,
    AdaptiveRetrievalOptimizer,
    MemoryPatternAnalyzer,
    IntelligentCacheManager
)
from agenticx.memory.intelligence.models import (
    MemoryType,
    AccessFrequency,
    CacheStrategy,
    OptimizationType,
    MemoryAccessPattern,
    RetrievalContext,
    MemoryMetrics,
    OptimizationResult,
    MemoryUsageStats,
    RetrievalPerformance,
    CachePerformance,
    MemoryOptimizationRule,
    AdaptiveConfig
)
from agenticx.memory.intelligence.pattern_analyzer import (
    PatternType,
    TrendDirection,
    PatternInsight,
    AnomalyDetection,
    UsageCluster
)
from agenticx.memory.intelligence.cache_manager import (
    CachePolicy,
    CacheEvent,
    CacheEntry,
    CacheStats
)


class TestMemoryIntelligenceEngine:
    """测试内存智能引擎"""
    
    def setup_method(self):
        """设置测试环境"""
        self.engine = MemoryIntelligenceEngine()
    
    def test_initialization(self):
        """测试初始化"""
        assert self.engine is not None
        assert len(self.engine.optimization_rules) == 0
        assert len(self.engine.access_patterns) == 0
        assert len(self.engine.performance_metrics) == 0
    
    def test_record_access_pattern(self):
        """测试记录访问模式"""
        pattern = MemoryAccessPattern(
            pattern_id="test_pattern_1",
            memory_type=MemoryType.EPISODIC,
            access_frequency=AccessFrequency.HIGH,
            access_times=[datetime.now()],
            access_contexts=[{"query": "test", "user_id": "user1"}],
            retrieval_latency=50.0,
            success_rate=0.95,
            data_size=1024,
            semantic_similarity=0.8
        )
        
        self.engine.record_access_pattern(pattern)
        
        assert len(self.engine.access_patterns) == 1
        assert self.engine.access_patterns["test_pattern_1"] == pattern
    
    def test_analyze_memory_usage(self):
        """测试内存使用分析"""
        # 添加一些访问模式
        patterns = [
            MemoryAccessPattern(
                pattern_id=f"pattern_{i}",
                memory_type=MemoryType.EPISODIC,
                access_frequency=AccessFrequency.HIGH if i % 2 == 0 else AccessFrequency.LOW,
                access_times=[datetime.now() - timedelta(hours=i)],
                access_contexts=[{"query": f"test_query_{i}", "user_id": "user1"}],
                retrieval_latency=50.0 + i * 10,
                success_rate=0.95 - i * 0.01,
                data_size=1024 * (i + 1),
                semantic_similarity=0.8
            )
            for i in range(5)
        ]
        
        for pattern in patterns:
            self.engine.record_access_pattern(pattern)
        
        stats = self.engine.analyze_memory_usage()
        
        assert isinstance(stats, MemoryUsageStats)
        assert stats.total_accesses == 5
        assert stats.average_latency > 0
        assert 0 <= stats.success_rate <= 1
    
    def test_optimize_memory_performance(self):
        """测试内存性能优化"""
        # 添加一些性能指标
        metrics = [
            MemoryMetrics(
                memory_type=MemoryType.EPISODIC,
                access_count=100,
                hit_rate=0.8,
                average_latency=60.0,
                cache_efficiency=0.7,
                storage_utilization=0.6,
                timestamp=datetime.now()
            )
        ]
        
        for metric in metrics:
            self.engine.record_performance_metrics(metric)
        
        result = self.engine.optimize_memory_performance()
        
        assert isinstance(result, OptimizationResult)
        assert result.optimization_type in OptimizationType
        assert len(result.applied_optimizations) >= 0
    
    def test_add_optimization_rule(self):
        """测试添加优化规则"""
        rule = MemoryOptimizationRule(
            rule_id="test_rule",
            name="测试规则",
            condition=lambda stats: stats.average_latency > 100,
            action=lambda: "优化动作",
            priority=1.0,
            enabled=True
        )
        
        self.engine.add_optimization_rule(rule)
        
        assert len(self.engine.optimization_rules) == 1
        assert self.engine.optimization_rules["test_rule"] == rule
    
    def test_get_memory_recommendations(self):
        """测试获取内存建议"""
        # 添加一些数据
        pattern = MemoryAccessPattern(
            pattern_id="test_pattern",
            memory_type=MemoryType.EPISODIC,
            access_frequency=AccessFrequency.HIGH,
            access_times=[datetime.now()],
            access_contexts=[{"query": "test_query", "user_id": "user1"}],
            retrieval_latency=150.0,  # 高延迟
            success_rate=0.7,  # 低成功率
            data_size=1024,
            semantic_similarity=0.8
        )
        
        self.engine.record_access_pattern(pattern)
        
        recommendations = self.engine.get_memory_recommendations()
        
        assert isinstance(recommendations, list)
        assert len(recommendations) >= 0


class TestAdaptiveRetrievalOptimizer:
    """测试自适应检索优化器"""
    
    def setup_method(self):
        """设置测试环境"""
        self.optimizer = AdaptiveRetrievalOptimizer()
    
    def test_initialization(self):
        """测试初始化"""
        assert self.optimizer is not None
        assert len(self.optimizer.query_history) == 0
        assert len(self.optimizer.performance_history) == 0
    
    def test_optimize_query(self):
        """测试查询优化"""
        context = RetrievalContext(
            query="测试查询",
            memory_types=[MemoryType.EPISODIC],
            time_range=(datetime.now() - timedelta(hours=1), datetime.now()),
            similarity_threshold=0.7,
            max_results=10,
            context_tags={"test", "query"}
        )
        
        optimized_context = self.optimizer.optimize_query(context)
        
        assert isinstance(optimized_context, RetrievalContext)
        assert optimized_context.query is not None
        assert len(optimized_context.memory_types) > 0
    
    def test_record_retrieval_performance(self):
        """测试记录检索性能"""
        performance = RetrievalPerformance(
            query_id="test_query",
            query_text="test query",
            query_type="semantic",
            execution_time=50.0,
            result_count=5,
            cache_hit=True,
            similarity_scores=[0.8, 0.7, 0.6],
            memory_types_accessed=[MemoryType.EPISODIC],
            optimization_applied=["semantic_expansion"],
            timestamp=datetime.now()
        )
        
        self.optimizer.record_retrieval_performance(performance)
        
        assert len(self.optimizer.performance_history) == 1
        assert self.optimizer.performance_history[0] == performance
    
    def test_adaptive_learning(self):
        """测试自适应学习"""
        # 添加一些性能数据
        performances = [
            RetrievalPerformance(
                query_id=f"query_{i}",
                query_text=f"test query {i}",
                query_type="semantic",
                execution_time=50.0 + i * 10,
                result_count=5 + i,
                cache_hit=i % 2 == 0,
                similarity_scores=[0.8 - i * 0.05],
                memory_types_accessed=[MemoryType.EPISODIC],
                optimization_applied=["semantic_expansion"],
                timestamp=datetime.now() - timedelta(minutes=i)
            )
            for i in range(10)
        ]
        
        for perf in performances:
            self.optimizer.record_retrieval_performance(perf)
        
        # 执行自适应学习
        learned = self.optimizer.adaptive_learning()
        
        assert isinstance(learned, bool)
    
    def test_get_optimization_suggestions(self):
        """测试获取优化建议"""
        # 添加一些性能数据
        performance = RetrievalPerformance(
            query_id="test_query",
            query_text="test query",
            query_type="semantic",
            execution_time=200.0,  # 高延迟
            result_count=2,  # 少结果
            cache_hit=False,  # 缓存未命中
            similarity_scores=[0.5, 0.4],  # 低相关性
            memory_types_accessed=[MemoryType.EPISODIC],
            optimization_applied=[],
            timestamp=datetime.now()
        )
        
        self.optimizer.record_retrieval_performance(performance)
        
        suggestions = self.optimizer.get_optimization_suggestions()
        
        assert isinstance(suggestions, list)
        assert len(suggestions) >= 0


class TestMemoryPatternAnalyzer:
    """测试内存模式分析器"""
    
    def setup_method(self):
        """设置测试环境"""
        self.analyzer = MemoryPatternAnalyzer()
    
    def test_initialization(self):
        """测试初始化"""
        assert self.analyzer is not None
        assert len(self.analyzer.access_patterns) == 0
        assert len(self.analyzer.pattern_insights) == 0
    
    def test_add_access_pattern(self):
        """测试添加访问模式"""
        pattern = MemoryAccessPattern(
            pattern_id="test_pattern",
            memory_type=MemoryType.EPISODIC,
            access_frequency=AccessFrequency.HIGH,
            access_times=[datetime.now()],
            access_contexts=[{"query": "test_query", "user_id": "user1"}],
            retrieval_latency=50.0,
            success_rate=0.95,
            data_size=1024,
            semantic_similarity=0.8
        )
        
        self.analyzer.add_access_pattern(pattern)
        
        assert len(self.analyzer.access_patterns) == 1
        assert self.analyzer.access_patterns["test_pattern"] == pattern
    
    def test_analyze_temporal_patterns(self):
        """测试时间模式分析"""
        # 添加一些时间分布的访问模式
        patterns = [
            MemoryAccessPattern(
                pattern_id=f"pattern_{i}",
                memory_type=MemoryType.EPISODIC,
                access_frequency=AccessFrequency.HIGH,
                access_times=[datetime.now() - timedelta(hours=i % 24)],
                access_contexts=[{"query": f"temporal_query_{i}", "user_id": "user1"}],
                retrieval_latency=50.0,
                success_rate=0.95,
                data_size=1024,
                semantic_similarity=0.8
            )
            for i in range(20)
        ]
        
        for pattern in patterns:
            self.analyzer.add_access_pattern(pattern)
        
        insights = self.analyzer.analyze_temporal_patterns()
        
        assert isinstance(insights, list)
        for insight in insights:
            assert isinstance(insight, PatternInsight)
            assert insight.pattern_type == PatternType.TEMPORAL
    
    def test_analyze_frequency_patterns(self):
        """测试频率模式分析"""
        # 添加不同频率的访问模式
        frequencies = [AccessFrequency.HIGH] * 10 + [AccessFrequency.LOW] * 3
        
        for i, freq in enumerate(frequencies):
            pattern = MemoryAccessPattern(
                pattern_id=f"pattern_{i}",
                memory_type=MemoryType.EPISODIC,
                access_frequency=freq,
                access_times=[datetime.now()],
                access_contexts=[{"query": f"freq_query_{i}", "user_id": "user1"}],
                retrieval_latency=50.0,
                success_rate=0.95,
                data_size=1024,
                semantic_similarity=0.8
            )
            self.analyzer.add_access_pattern(pattern)
        
        insights = self.analyzer.analyze_frequency_patterns()
        
        assert isinstance(insights, list)
        for insight in insights:
            assert isinstance(insight, PatternInsight)
            assert insight.pattern_type == PatternType.FREQUENCY
    
    def test_detect_anomalies(self):
        """测试异常检测"""
        # 添加正常模式
        for i in range(20):
            pattern = MemoryAccessPattern(
                pattern_id=f"normal_{i}",
                memory_type=MemoryType.EPISODIC,
                access_frequency=AccessFrequency.HIGH,
                access_times=[datetime.now()],
                access_contexts=[{"query": f"normal_query_{i}", "user_id": "user1"}],
                retrieval_latency=50.0 + i,  # 正常范围
                success_rate=0.95,
                data_size=1024,
                semantic_similarity=0.8
            )
            self.analyzer.add_access_pattern(pattern)
        
        # 添加异常模式
        anomaly_pattern = MemoryAccessPattern(
            pattern_id="anomaly",
            memory_type=MemoryType.EPISODIC,
            access_frequency=AccessFrequency.HIGH,
            access_times=[datetime.now()],
            access_contexts=[{"query": "anomaly_query", "user_id": "user1"}],
            retrieval_latency=500.0,  # 异常高延迟
            success_rate=0.95,
            data_size=1024,
            semantic_similarity=0.8
        )
        self.analyzer.add_access_pattern(anomaly_pattern)
        
        anomalies = self.analyzer.detect_anomalies()
        
        assert isinstance(anomalies, list)
        # 可能检测到异常
        for anomaly in anomalies:
            assert isinstance(anomaly, AnomalyDetection)
    
    def test_cluster_usage_patterns(self):
        """测试使用模式聚类"""
        # 添加不同类型的访问模式
        patterns = [
            # 高频快速访问
            *[
                MemoryAccessPattern(
                    pattern_id=f"fast_{i}",
                    memory_type=MemoryType.EPISODIC,
                    access_frequency=AccessFrequency.HIGH,
                    access_times=[datetime.now()],
                    access_contexts=[{"query": f"fast_query_{i}", "user_id": "user1"}],
                    retrieval_latency=30.0,
                    success_rate=0.95,
                    data_size=512,
                    semantic_similarity=0.8
                )
                for i in range(5)
            ],
            # 低频慢速访问
            *[
                MemoryAccessPattern(
                    pattern_id=f"slow_{i}",
                    memory_type=MemoryType.SEMANTIC,
                    access_frequency=AccessFrequency.LOW,
                    access_times=[datetime.now()],
                    access_contexts=[{"query": f"slow_query_{i}", "user_id": "user1"}],
                    retrieval_latency=150.0,
                    success_rate=0.8,
                    data_size=2048,
                    semantic_similarity=0.6
                )
                for i in range(5)
            ]
        ]
        
        for pattern in patterns:
            self.analyzer.add_access_pattern(pattern)
        
        clusters = self.analyzer.cluster_usage_patterns(num_clusters=2)
        
        assert isinstance(clusters, dict)
        assert len(clusters) <= 2
        
        for cluster in clusters.values():
            assert isinstance(cluster, UsageCluster)
            assert len(cluster.patterns) > 0


class TestIntelligentCacheManager:
    """测试智能缓存管理器"""
    
    def setup_method(self):
        """设置测试环境"""
        config = {
            'max_size': 1024 * 1024,  # 1MB
            'max_entries': 100,
            'cleanup_interval': 1  # 1秒，用于测试
        }
        self.cache_manager = IntelligentCacheManager(config)
    
    def test_initialization(self):
        """测试初始化"""
        assert self.cache_manager is not None
        assert len(self.cache_manager.cache) == 0
        assert self.cache_manager.current_policy == CachePolicy.ADAPTIVE
    
    def test_put_and_get(self):
        """测试存储和获取"""
        key = "test_key"
        value = "test_value"
        
        # 存储
        success = self.cache_manager.put(key, value)
        assert success is True
        
        # 获取
        retrieved_value = self.cache_manager.get(key)
        assert retrieved_value == value
        
        # 获取不存在的键
        missing_value = self.cache_manager.get("missing_key", "default")
        assert missing_value == "default"
    
    def test_cache_eviction(self):
        """测试缓存驱逐"""
        # 填满缓存
        for i in range(self.cache_manager.max_entries + 10):
            key = f"key_{i}"
            value = f"value_{i}" * 100  # 较大的值
            self.cache_manager.put(key, value)
        
        # 检查缓存大小限制
        assert len(self.cache_manager.cache) <= self.cache_manager.max_entries
    
    def test_ttl_expiration(self):
        """测试TTL过期"""
        key = "ttl_key"
        value = "ttl_value"
        ttl = timedelta(milliseconds=100)
        
        # 存储带TTL的条目
        self.cache_manager.put(key, value, ttl=ttl)
        
        # 立即获取应该成功
        assert self.cache_manager.get(key) == value
        
        # 等待过期
        time.sleep(0.2)
        
        # 过期后获取应该返回默认值
        assert self.cache_manager.get(key, "expired") == "expired"
    
    def test_semantic_search(self):
        """测试语义搜索"""
        # 存储带语义标签的条目
        self.cache_manager.put("doc1", "文档1内容", semantic_tags={"技术", "AI"})
        self.cache_manager.put("doc2", "文档2内容", semantic_tags={"技术", "数据库"})
        self.cache_manager.put("doc3", "文档3内容", semantic_tags={"生活", "旅游"})
        
        # 搜索技术相关内容
        results = self.cache_manager.semantic_search({"技术"}, limit=5)
        
        assert len(results) == 2
        keys = [key for key, _ in results]
        assert "doc1" in keys
        assert "doc2" in keys
    
    def test_cache_statistics(self):
        """测试缓存统计"""
        # 执行一些操作
        self.cache_manager.put("key1", "value1")
        self.cache_manager.put("key2", "value2")
        
        self.cache_manager.get("key1")  # 命中
        self.cache_manager.get("key1")  # 命中
        self.cache_manager.get("missing")  # 未命中
        
        stats = self.cache_manager.get_cache_statistics()
        
        assert isinstance(stats, dict)
        assert stats['hits'] == 2
        assert stats['misses'] == 1
        assert stats['hit_rate'] == 2/3
        assert stats['entry_count'] == 2
    
    def test_event_listeners(self):
        """测试事件监听器"""
        events_received = []
        
        def event_listener(event, key, value):
            events_received.append((event, key, value))
        
        # 添加监听器
        self.cache_manager.add_event_listener(CacheEvent.HIT, event_listener)
        self.cache_manager.add_event_listener(CacheEvent.MISS, event_listener)
        
        # 执行操作
        self.cache_manager.put("test_key", "test_value")
        self.cache_manager.get("test_key")  # 命中
        self.cache_manager.get("missing_key")  # 未命中
        
        # 检查事件
        assert len(events_received) >= 2
        hit_events = [e for e in events_received if e[0] == CacheEvent.HIT]
        miss_events = [e for e in events_received if e[0] == CacheEvent.MISS]
        
        assert len(hit_events) >= 1
        assert len(miss_events) >= 1
    
    def test_cache_export(self):
        """测试缓存导出"""
        # 添加一些数据
        self.cache_manager.put("key1", "value1", semantic_tags={"tag1"})
        self.cache_manager.put("key2", "value2", semantic_tags={"tag2"})
        
        # 执行一些访问
        self.cache_manager.get("key1")
        self.cache_manager.get("key2")
        
        # 导出数据
        exported_data = self.cache_manager.export_cache_data()
        
        assert isinstance(exported_data, dict)
        assert 'entries' in exported_data
        assert 'statistics' in exported_data
        assert 'performance_history' in exported_data
        assert len(exported_data['entries']) == 2


class TestIntegration:
    """集成测试"""
    
    def test_memory_intelligence_integration(self):
        """测试内存智能系统集成"""
        # 创建各个组件
        engine = MemoryIntelligenceEngine()
        optimizer = AdaptiveRetrievalOptimizer()
        analyzer = MemoryPatternAnalyzer()
        cache_manager = IntelligentCacheManager()
        
        # 模拟内存访问场景
        patterns = [
            MemoryAccessPattern(
                pattern_id=f"pattern_{i}",
                memory_type=MemoryType.EPISODIC if i % 2 == 0 else MemoryType.SEMANTIC,
                access_frequency=AccessFrequency.HIGH if i < 5 else AccessFrequency.LOW,
                access_times=[datetime.now() - timedelta(minutes=i)],
                access_contexts=[{"query": f"integration_query_{i}", "user_id": "user1"}],
                retrieval_latency=50.0 + i * 10,
                success_rate=0.95 - i * 0.01,
                data_size=1024 * (i + 1),
                semantic_similarity=0.8
            )
            for i in range(10)
        ]
        
        # 记录访问模式
        for pattern in patterns:
            engine.record_access_pattern(pattern)
            analyzer.add_access_pattern(pattern)
        
        # 分析和优化
        usage_stats = engine.analyze_memory_usage()
        optimization_result = engine.optimize_memory_performance()
        temporal_insights = analyzer.analyze_temporal_patterns()
        frequency_insights = analyzer.analyze_frequency_patterns()
        anomalies = analyzer.detect_anomalies()
        
        # 验证结果
        assert isinstance(usage_stats, MemoryUsageStats)
        assert isinstance(optimization_result, OptimizationResult)
        assert isinstance(temporal_insights, list)
        assert isinstance(frequency_insights, list)
        assert isinstance(anomalies, list)
        
        # 测试缓存管理
        for i in range(5):
            cache_manager.put(f"cache_key_{i}", f"cache_value_{i}")
        
        cache_stats = cache_manager.get_cache_statistics()
        assert cache_stats['entry_count'] == 5
        
        # 测试检索优化
        context = RetrievalContext(
            query="测试查询",
            memory_types=[MemoryType.EPISODIC],
            time_range=(datetime.now() - timedelta(hours=1), datetime.now()),
            similarity_threshold=0.7,
            max_results=10
        )
        
        optimized_context = optimizer.optimize_query(context)
        assert isinstance(optimized_context, RetrievalContext)
        
        print("M5内存系统智能优化集成测试通过")


if __name__ == "__main__":
    # 运行测试
    pytest.main([__file__, "-v"])