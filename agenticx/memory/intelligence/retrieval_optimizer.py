"""M5 记忆系统自适应检索优化器

提供智能的检索优化功能，包括查询优化、索引管理和性能调优。
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Any, Tuple, Set, Callable
from datetime import datetime, timedelta, UTC
from collections import defaultdict, deque
import threading
from dataclasses import dataclass

from .models import (
    RetrievalContext,
    RetrievalPerformance,
    MemoryType,
    OptimizationType,
    CacheStrategy
)


@dataclass
class QueryOptimization:
    """查询优化结果"""
    original_query: str
    optimized_query: str
    optimization_type: str
    confidence_score: float
    estimated_improvement: float


@dataclass
class IndexOptimization:
    """索引优化配置"""
    index_type: str
    parameters: Dict[str, Any]
    memory_type: MemoryType
    estimated_performance_gain: float
    memory_overhead: int  # 字节


class AdaptiveRetrievalOptimizer:
    """自适应检索优化器
    
    负责智能优化检索性能，包括查询重写、索引优化和缓存策略调整。
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化检索优化器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(__name__)
        
        # 性能历史跟踪
        self.performance_history: deque = deque(maxlen=10000)
        self.query_history: List[str] = []
        self.query_patterns: Dict[str, List[RetrievalPerformance]] = defaultdict(list)
        
        # 优化策略
        self.query_optimizers: Dict[str, Callable] = {
            'semantic_expansion': self._optimize_semantic_expansion,
            'keyword_refinement': self._optimize_keyword_refinement,
            'temporal_filtering': self._optimize_temporal_filtering,
            'similarity_adjustment': self._optimize_similarity_adjustment
        }
        
        # 索引配置
        self.index_configurations: Dict[MemoryType, IndexOptimization] = {}
        self.active_indexes: Set[str] = set()
        
        # 缓存策略
        self.cache_strategies: Dict[str, CacheStrategy] = {
            'frequent_queries': CacheStrategy.LFU,
            'recent_queries': CacheStrategy.LRU,
            'semantic_similar': CacheStrategy.SEMANTIC,
            'temporal_related': CacheStrategy.TEMPORAL
        }
        
        # 性能统计
        self.optimization_stats = {
            'total_optimizations': 0,
            'successful_optimizations': 0,
            'average_improvement': 0.0,
            'query_cache_hits': 0,
            'index_rebuilds': 0
        }
        
        # 学习参数
        self.learning_rate = 0.1
        self.adaptation_threshold = 0.15
        
        # 初始化默认索引配置
        self._initialize_default_indexes()
    
    def _initialize_default_indexes(self) -> None:
        """初始化默认索引配置"""
        for memory_type in MemoryType:
            self.index_configurations[memory_type] = IndexOptimization(
                index_type="hybrid",
                parameters={
                    'vector_dimensions': 768,
                    'similarity_threshold': 0.7,
                    'max_results': 100,
                    'use_semantic_search': True,
                    'use_keyword_search': True
                },
                memory_type=memory_type,
                estimated_performance_gain=0.2,
                memory_overhead=50 * 1024 * 1024  # 50MB
            )
    
    async def optimize_retrieval(self, context: RetrievalContext) -> Tuple[RetrievalContext, List[str]]:
        """优化检索请求
        
        Args:
            context: 原始检索上下文
            
        Returns:
            优化后的上下文和应用的优化策略列表
        """
        start_time = time.time()
        applied_optimizations = []
        optimized_context = context
        
        try:
            # 1. 查询优化
            query_optimization = await self._optimize_query(context)
            if query_optimization:
                optimized_context.query = query_optimization.optimized_query
                applied_optimizations.append(f"查询优化: {query_optimization.optimization_type}")
            
            # 2. 参数优化
            param_optimizations = await self._optimize_parameters(optimized_context)
            applied_optimizations.extend(param_optimizations)
            
            # 3. 缓存策略选择
            cache_strategy = self._select_cache_strategy(optimized_context)
            applied_optimizations.append(f"缓存策略: {cache_strategy.value}")
            
            # 4. 索引选择优化
            index_optimizations = await self._optimize_index_selection(optimized_context)
            applied_optimizations.extend(index_optimizations)
            
            # 记录优化统计
            self.optimization_stats['total_optimizations'] += 1
            if len(applied_optimizations) > 0:
                self.optimization_stats['successful_optimizations'] += 1
            
            execution_time = time.time() - start_time
            self.logger.debug(f"检索优化完成，耗时: {execution_time:.3f}秒，应用优化: {len(applied_optimizations)}个")
            
            return optimized_context, applied_optimizations
            
        except Exception as e:
            self.logger.error(f"检索优化失败: {e}")
            return context, []
    
    async def _optimize_query(self, context: RetrievalContext) -> Optional[QueryOptimization]:
        """优化查询文本"""
        query = context.query
        query_type = context.query_type
        
        # 根据查询类型选择优化策略
        if query_type == 'semantic':
            return await self._optimize_semantic_expansion(query, context)
        elif query_type == 'keyword':
            return await self._optimize_keyword_refinement(query, context)
        elif query_type == 'temporal':
            return await self._optimize_temporal_filtering(query, context)
        else:
            return await self._optimize_similarity_adjustment(query, context)
    
    async def _optimize_semantic_expansion(self, query: str, context: RetrievalContext) -> Optional[QueryOptimization]:
        """语义扩展优化"""
        # 模拟语义扩展
        await asyncio.sleep(0.1)
        
        # 简单的同义词扩展示例
        expansions = {
            '数据': ['信息', '资料', 'data'],
            '分析': ['解析', '研究', 'analysis'],
            '报告': ['汇报', '总结', 'report']
        }
        
        expanded_terms = []
        for word, synonyms in expansions.items():
            if word in query:
                expanded_terms.extend(synonyms[:2])  # 添加前两个同义词
        
        if expanded_terms:
            optimized_query = f"{query} {' '.join(expanded_terms)}"
            return QueryOptimization(
                original_query=query,
                optimized_query=optimized_query,
                optimization_type="semantic_expansion",
                confidence_score=0.8,
                estimated_improvement=0.15
            )
        
        return None
    
    async def _optimize_keyword_refinement(self, query: str, context: RetrievalContext) -> Optional[QueryOptimization]:
        """关键词精炼优化"""
        await asyncio.sleep(0.05)
        
        # 移除停用词
        stop_words = {'的', '了', '在', '是', '和', '与', '或', '但是', '然而'}
        words = query.split()
        refined_words = [word for word in words if word not in stop_words]
        
        if len(refined_words) < len(words):
            optimized_query = ' '.join(refined_words)
            return QueryOptimization(
                original_query=query,
                optimized_query=optimized_query,
                optimization_type="keyword_refinement",
                confidence_score=0.9,
                estimated_improvement=0.1
            )
        
        return None
    
    async def _optimize_temporal_filtering(self, query: str, context: RetrievalContext) -> Optional[QueryOptimization]:
        """时间过滤优化"""
        await asyncio.sleep(0.03)
        
        # 如果没有指定时间范围，添加默认的时间偏好
        if not context.time_range:
            # 优先最近的数据
            optimized_query = f"{query} [recent_priority]"
            return QueryOptimization(
                original_query=query,
                optimized_query=optimized_query,
                optimization_type="temporal_filtering",
                confidence_score=0.7,
                estimated_improvement=0.12
            )
        
        return None
    
    async def _optimize_similarity_adjustment(self, query: str, context: RetrievalContext) -> Optional[QueryOptimization]:
        """相似度调整优化"""
        await asyncio.sleep(0.02)
        
        # 根据历史性能调整相似度阈值
        historical_performance = self._get_historical_performance(query)
        
        if historical_performance:
            avg_score = sum(p.get_performance_score() for p in historical_performance) / len(historical_performance)
            
            if avg_score < 0.6:  # 性能较差，降低相似度阈值
                new_threshold = max(0.5, context.similarity_threshold - 0.1)
                if new_threshold != context.similarity_threshold:
                    context.similarity_threshold = new_threshold
                    return QueryOptimization(
                        original_query=query,
                        optimized_query=f"{query} [similarity_threshold={new_threshold}]",
                        optimization_type="similarity_adjustment",
                        confidence_score=0.6,
                        estimated_improvement=0.08
                    )
        
        return None
    
    async def _optimize_parameters(self, context: RetrievalContext) -> List[str]:
        """优化检索参数"""
        optimizations = []
        
        # 根据历史性能调整结果数量
        if context.max_results:
            historical_avg = self._get_average_result_count(context.query_type)
            if historical_avg and abs(context.max_results - historical_avg) > 5:
                context.max_results = int((context.max_results + historical_avg) / 2)
                optimizations.append("调整期望结果数量")
        
        # 优化元数据过滤器
        if self._should_add_metadata_filters(context):
            context.metadata_filters.update({
                'quality_score': {'$gte': 0.7},
                'relevance_boost': True
            })
            optimizations.append("添加质量过滤器")
        
        return optimizations
    
    def _select_cache_strategy(self, context: RetrievalContext) -> CacheStrategy:
        """选择最优缓存策略"""
        # 根据查询特征选择缓存策略
        if context.query_type == 'semantic':
            return CacheStrategy.SEMANTIC
        elif context.time_range:
            return CacheStrategy.TEMPORAL
        elif self._is_frequent_query(context.query):
            return CacheStrategy.LFU
        else:
            return CacheStrategy.LRU
    
    async def _optimize_index_selection(self, context: RetrievalContext) -> List[str]:
        """优化索引选择"""
        optimizations = []
        
        # 根据查询类型和内存类型选择最优索引
        recommended_indexes = self._recommend_indexes(context)
        
        for index_name in recommended_indexes:
            if index_name not in self.active_indexes:
                await self._activate_index(index_name)
                optimizations.append(f"激活索引: {index_name}")
        
        return optimizations
    
    def _recommend_indexes(self, context: RetrievalContext) -> List[str]:
        """推荐索引"""
        recommendations = []
        
        if context.query_type == 'semantic':
            recommendations.append('vector_index')
        
        if context.query_type == 'keyword':
            recommendations.append('inverted_index')
        
        if context.time_range:
            recommendations.append('temporal_index')
        
        if context.metadata_filters:
            recommendations.append('metadata_index')
        
        return recommendations
    
    async def _activate_index(self, index_name: str) -> None:
        """激活索引"""
        # 模拟索引激活
        await asyncio.sleep(0.1)
        self.active_indexes.add(index_name)
        self.optimization_stats['index_rebuilds'] += 1
        self.logger.debug(f"激活索引: {index_name}")
    
    def record_retrieval_performance(self, performance: RetrievalPerformance) -> None:
        """记录检索性能
        
        Args:
            performance: 检索性能数据
        """
        self.performance_history.append(performance)
        self.query_patterns[performance.query_type].append(performance)
        
        # 更新统计信息
        if performance.cache_hit:
            self.optimization_stats['query_cache_hits'] += 1
        
        # 触发自适应学习
        self._adaptive_learning(performance)
    
    def _adaptive_learning(self, performance: RetrievalPerformance) -> None:
        """自适应学习"""
        # 根据性能反馈调整优化策略
        performance_score = performance.get_performance_score()
        
        # 如果性能低于阈值，调整相关参数
        if performance_score < 0.6:
            self._adjust_optimization_parameters(performance)
        
        # 更新平均改进率
        if len(self.performance_history) > 1:
            recent_scores = [p.get_performance_score() for p in list(self.performance_history)[-10:]]
            self.optimization_stats['average_improvement'] = sum(recent_scores) / len(recent_scores)
    
    def _adjust_optimization_parameters(self, performance: RetrievalPerformance) -> None:
        """调整优化参数"""
        query_type = performance.query_type
        
        # 根据查询类型调整相应的优化参数
        if query_type == 'semantic' and performance.execution_time > 500:
            # 语义查询太慢，降低向量维度
            for config in self.index_configurations.values():
                if config.index_type == 'vector':
                    config.parameters['vector_dimensions'] = max(256, 
                        config.parameters.get('vector_dimensions', 768) - 64)
        
        elif query_type == 'keyword' and performance.result_count < 5:
            # 关键词查询结果太少，降低相似度阈值
            for config in self.index_configurations.values():
                config.parameters['similarity_threshold'] = max(0.5,
                    config.parameters.get('similarity_threshold', 0.7) - 0.05)
    
    def _get_historical_performance(self, query: str) -> List[RetrievalPerformance]:
        """获取查询的历史性能"""
        return [p for p in self.performance_history if p.query_text == query][-5:]
    
    def _get_average_result_count(self, query_type: str) -> Optional[float]:
        """获取查询类型的平均结果数量"""
        performances = self.query_patterns.get(query_type, [])
        if not performances:
            return None
        
        return sum(p.result_count for p in performances) / len(performances)
    
    def _should_add_metadata_filters(self, context: RetrievalContext) -> bool:
        """判断是否应该添加元数据过滤器"""
        # 如果查询比较宽泛且没有过滤器，建议添加
        return (len(context.query.split()) <= 2 and 
                not context.metadata_filters and 
                context.max_results is not None and context.max_results > 50)
    
    def _is_frequent_query(self, query: str) -> bool:
        """判断是否为频繁查询"""
        recent_queries = [p.query_text for p in list(self.performance_history)[-100:]]
        return recent_queries.count(query) >= 3
    
    async def optimize_index_configuration(self, memory_type: MemoryType) -> IndexOptimization:
        """优化索引配置
        
        Args:
            memory_type: 内存类型
            
        Returns:
            优化后的索引配置
        """
        current_config = self.index_configurations.get(memory_type)
        if not current_config:
            return self._create_default_index_config(memory_type)
        
        # 分析该内存类型的性能数据
        relevant_performances = [
            p for p in self.performance_history 
            if memory_type in p.memory_types_accessed
        ]
        
        if not relevant_performances:
            return current_config
        
        # 计算平均性能指标
        avg_execution_time = sum(p.execution_time for p in relevant_performances) / len(relevant_performances)
        avg_result_count = sum(p.result_count for p in relevant_performances) / len(relevant_performances)
        
        # 根据性能调整配置
        optimized_config = IndexOptimization(
            index_type=current_config.index_type,
            parameters=current_config.parameters.copy(),
            memory_type=memory_type,
            estimated_performance_gain=current_config.estimated_performance_gain,
            memory_overhead=current_config.memory_overhead
        )
        
        # 如果执行时间过长，优化索引参数
        if avg_execution_time > 300:  # 300ms
            optimized_config.parameters['max_results'] = min(50, 
                optimized_config.parameters.get('max_results', 100))
            optimized_config.parameters['similarity_threshold'] = min(0.8,
                optimized_config.parameters.get('similarity_threshold', 0.7) + 0.05)
        
        # 如果结果数量不足，调整参数
        if avg_result_count < 5:
            optimized_config.parameters['similarity_threshold'] = max(0.5,
                optimized_config.parameters.get('similarity_threshold', 0.7) - 0.1)
        
        self.index_configurations[memory_type] = optimized_config
        return optimized_config
    
    def _create_default_index_config(self, memory_type: MemoryType) -> IndexOptimization:
        """创建默认索引配置"""
        return IndexOptimization(
            index_type="hybrid",
            parameters={
                'vector_dimensions': 512,
                'similarity_threshold': 0.7,
                'max_results': 50,
                'use_semantic_search': True,
                'use_keyword_search': True
            },
            memory_type=memory_type,
            estimated_performance_gain=0.15,
            memory_overhead=30 * 1024 * 1024  # 30MB
        )
    
    def get_optimization_statistics(self) -> Dict[str, Any]:
        """获取优化统计信息"""
        recent_performances = list(self.performance_history)[-100:]
        
        stats: Dict[str, Any] = self.optimization_stats.copy()
        stats.update({
            'total_queries_processed': len(self.performance_history),
            'active_indexes': len(self.active_indexes),
            'query_types_distribution': self._get_query_type_distribution(),
            'average_execution_time': self._get_average_execution_time(recent_performances),
            'cache_hit_rate': self._get_cache_hit_rate(recent_performances),
            'optimization_success_rate': float(
                stats['successful_optimizations'] / max(1, stats['total_optimizations'])
            )
        })
        
        return stats
    
    def _get_query_type_distribution(self) -> Dict[str, int]:
        """获取查询类型分布"""
        distribution: Dict[str, int] = defaultdict(int)
        for performance in self.performance_history:
            distribution[performance.query_type] += 1
        return dict(distribution)
    
    def _get_average_execution_time(self, performances: List[RetrievalPerformance]) -> float:
        """获取平均执行时间"""
        if not performances:
            return 0.0
        return sum(p.execution_time for p in performances) / len(performances)
    
    def _get_cache_hit_rate(self, performances: List[RetrievalPerformance]) -> float:
        """获取缓存命中率"""
        if not performances:
            return 0.0
        cache_hits = sum(1 for p in performances if p.cache_hit)
        return cache_hits / len(performances)
    
    async def batch_optimize_queries(self, contexts: List[RetrievalContext]) -> List[Tuple[RetrievalContext, List[str]]]:
        """批量优化查询
        
        Args:
            contexts: 检索上下文列表
            
        Returns:
            优化结果列表
        """
        tasks = [self.optimize_retrieval(context) for context in contexts]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 过滤异常结果
        valid_results: List[Tuple[RetrievalContext, List[str]]] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                self.logger.error(f"批量优化第{i}个查询失败: {result}")
                valid_results.append((contexts[i], []))
            else:
                # 确保result是正确的类型
                if isinstance(result, tuple) and len(result) == 2:
                    valid_results.append(result)
                else:
                    valid_results.append((contexts[i], []))
        
        return valid_results
    
    def optimize_query(self, context: RetrievalContext) -> RetrievalContext:
        """优化查询
        
        Args:
            context: 检索上下文
            
        Returns:
            优化后的检索上下文
        """
        # 记录查询历史
        self.query_history.append(context.query)
        
        # 创建优化后的上下文副本
        optimized_context = RetrievalContext(
            query=context.query,
            query_type=context.query_type,
            user_id=context.user_id,
            session_id=context.session_id,
            timestamp=context.timestamp,
            priority=context.priority,
            max_results=context.max_results,
            similarity_threshold=context.similarity_threshold,
            time_range=context.time_range,
            metadata_filters=context.metadata_filters,
            memory_types=context.memory_types,
            context_tags=context.context_tags
        )
        
        return optimized_context
    
    def clear_performance_history(self, keep_recent: int = 1000) -> None:
        """清理性能历史
        
        Args:
            keep_recent: 保留最近的记录数量
        """
        if len(self.performance_history) > keep_recent:
            # 保留最近的记录
            recent_records = list(self.performance_history)[-keep_recent:]
            self.performance_history.clear()
            self.performance_history.extend(recent_records)
        
        # 清理查询模式历史
        for query_type in self.query_patterns:
            if len(self.query_patterns[query_type]) > keep_recent // 10:
                self.query_patterns[query_type] = self.query_patterns[query_type][-keep_recent // 10:]
        
        self.logger.info(f"清理性能历史，保留最近 {keep_recent} 条记录")
    
    def get_optimization_suggestions(self) -> List[str]:
        """获取优化建议
        
        Returns:
            优化建议列表
        """
        suggestions = []
        
        if len(self.performance_history) == 0:
            return ["暂无性能数据，建议先执行一些查询"]
        
        # 分析最近的性能数据
        recent_performance = list(self.performance_history)[-20:] if len(self.performance_history) >= 20 else list(self.performance_history)
        
        if recent_performance:
            avg_execution_time = sum(p.execution_time for p in recent_performance) / len(recent_performance)
            cache_hit_rate = sum(1 for p in recent_performance if getattr(p, 'cache_hit', False)) / len(recent_performance)
            
            if avg_execution_time > 100:
                suggestions.append("建议优化查询算法以降低执行时间")
            
            if cache_hit_rate < 0.5:
                suggestions.append("建议调整缓存策略以提高命中率")
            
            if len(self.query_history) > 100:
                suggestions.append("建议清理查询历史以释放内存")
            
            # 检查索引使用情况
            if len(self.active_indexes) < 3:
                suggestions.append("建议添加更多索引以提高查询性能")
        
        return suggestions if suggestions else ["当前性能良好，无需特别优化"]
    
    def adaptive_learning(self) -> bool:
        """自适应学习
        
        Returns:
            是否成功进行了学习调整
        """
        if len(self.performance_history) < 5:
            return False
        
        # 分析性能趋势并调整策略
        recent_performance = list(self.performance_history)[-10:] if len(self.performance_history) >= 10 else list(self.performance_history)
        avg_execution_time = sum(p.execution_time for p in recent_performance) / len(recent_performance)
        
        # 如果平均执行时间过高，调整优化策略
        if avg_execution_time > 100:  # 100ms阈值
            self.learning_rate = min(0.2, self.learning_rate * 1.1)
            return True
        else:
            self.learning_rate = max(0.05, self.learning_rate * 0.95)
            return True
