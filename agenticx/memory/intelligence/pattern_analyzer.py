"""M5 记忆系统模式分析器

分析记忆使用模式，识别趋势和异常，提供优化建议。
"""

import logging
import math
import time
from typing import Dict, List, Optional, Any, Tuple, Set
from datetime import datetime, timedelta, UTC
from collections import defaultdict, deque
from dataclasses import dataclass
from enum import Enum
import statistics

from .models import (
    MemoryAccessPattern,
    MemoryType,
    AccessFrequency,
    MemoryUsageStats,
    RetrievalPerformance
)


class PatternType(Enum):
    """模式类型枚举"""
    TEMPORAL = "temporal"        # 时间模式
    FREQUENCY = "frequency"      # 频率模式
    SEMANTIC = "semantic"        # 语义模式
    SPATIAL = "spatial"          # 空间模式
    BEHAVIORAL = "behavioral"    # 行为模式
    ANOMALY = "anomaly"          # 异常模式


class TrendDirection(Enum):
    """趋势方向枚举"""
    INCREASING = "increasing"
    DECREASING = "decreasing"
    STABLE = "stable"
    VOLATILE = "volatile"


@dataclass
class PatternInsight:
    """模式洞察"""
    pattern_type: PatternType
    description: str
    confidence: float  # 0-1
    impact_score: float  # 0-1
    trend_direction: TrendDirection
    affected_memory_types: List[MemoryType]
    recommendations: List[str]
    supporting_data: Dict[str, Any]
    timestamp: datetime


@dataclass
class AnomalyDetection:
    """异常检测结果"""
    anomaly_id: str
    anomaly_type: str
    severity: str  # low, medium, high, critical
    description: str
    affected_patterns: List[str]
    detection_time: datetime
    suggested_actions: List[str]
    confidence_score: float


@dataclass
class UsageCluster:
    """使用聚类"""
    cluster_id: str
    cluster_type: str
    patterns: List[MemoryAccessPattern]
    centroid_features: Dict[str, float]
    cluster_size: int
    cohesion_score: float  # 聚类内聚度
    representative_pattern: Optional[MemoryAccessPattern]


class MemoryPatternAnalyzer:
    """内存模式分析器
    
    负责分析内存使用模式，识别趋势、异常和优化机会。
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化模式分析器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(__name__)
        
        # 模式存储
        self.access_patterns: Dict[str, MemoryAccessPattern] = {}
        self.pattern_history: deque = deque(maxlen=50000)
        
        # 分析结果
        self.pattern_insights: List[PatternInsight] = []
        self.anomaly_detections: List[AnomalyDetection] = []
        self.usage_clusters: Dict[str, UsageCluster] = {}
        
        # 统计数据
        self.temporal_stats: Dict[str, List[float]] = defaultdict(list)
        self.frequency_stats: Dict[MemoryType, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.performance_trends: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        
        # 分析参数
        self.analysis_window_hours = 24
        self.anomaly_threshold = 2.0  # 标准差倍数
        self.trend_min_samples = 10
        self.clustering_threshold = 0.7
        
        # 缓存
        self._analysis_cache: Dict[str, Tuple[datetime, Any]] = {}
        self._cache_ttl = timedelta(minutes=30)
    
    def add_access_pattern(self, pattern: MemoryAccessPattern):
        """添加访问模式
        
        Args:
            pattern: 内存访问模式
        """
        self.access_patterns[pattern.pattern_id] = pattern
        self.pattern_history.append(pattern)
        
        # 更新统计数据
        self._update_statistics(pattern)
        
        # 触发实时分析
        self._trigger_realtime_analysis(pattern)
    
    def _update_statistics(self, pattern: MemoryAccessPattern):
        """更新统计数据"""
        # 时间统计
        hour_key = pattern.access_times[-1].strftime('%Y-%m-%d-%H') if pattern.access_times else datetime.now().strftime('%Y-%m-%d-%H')
        self.temporal_stats[hour_key].append(pattern.retrieval_latency)
        
        # 频率统计
        self.frequency_stats[pattern.memory_type][pattern.access_frequency.value] += 1
        
        # 性能趋势
        self.performance_trends[pattern.memory_type.value].append({
            'timestamp': datetime.now(),
            'latency': pattern.retrieval_latency,
            'success_rate': pattern.success_rate,
            'data_size': pattern.data_size
        })
    
    def _detect_pattern_anomaly(self, pattern: MemoryAccessPattern) -> Optional[AnomalyDetection]:
        """检测模式异常"""
        # 检测延迟异常
        if pattern.retrieval_latency > 200.0:  # 阈值200ms
            return AnomalyDetection(
                anomaly_id=f"latency_anomaly_{pattern.pattern_id}_{int(time.time())}",
                anomaly_type='latency_anomaly',
                severity='high' if pattern.retrieval_latency > 500.0 else 'medium',
                description=f'高延迟异常: {pattern.retrieval_latency}ms',
                affected_patterns=[pattern.pattern_id],
                detection_time=datetime.now(),
                suggested_actions=[
                    "检查系统负载",
                    "分析慢查询",
                    "考虑增加缓存"
                ],
                confidence_score=min(0.9, pattern.retrieval_latency / 1000.0)
            )
        
        # 检测成功率异常
        if pattern.success_rate < 0.8:  # 阈值80%
            return AnomalyDetection(
                anomaly_id=f"success_rate_anomaly_{pattern.pattern_id}_{int(time.time())}",
                anomaly_type='success_rate_anomaly',
                severity='high' if pattern.success_rate < 0.5 else 'medium',
                description=f'低成功率异常: {pattern.success_rate:.2%}',
                affected_patterns=[pattern.pattern_id],
                detection_time=datetime.now(),
                suggested_actions=[
                    "检查内存系统健康状态",
                    "分析失败原因",
                    "考虑增加冗余机制"
                ],
                confidence_score=1.0 - pattern.success_rate
            )
        
        return None
    
    def _detect_trend_change(self, pattern: MemoryAccessPattern) -> Optional[str]:
        """检测趋势变化"""
        # 简单的趋势检测逻辑
        if len(self.access_patterns) > 10:
            recent_patterns = list(self.access_patterns.values())[-10:]
            avg_latency = sum(p.retrieval_latency for p in recent_patterns) / len(recent_patterns)
            if pattern.retrieval_latency > avg_latency * 1.5:
                return f"延迟趋势上升: 当前{pattern.retrieval_latency}ms vs 平均{avg_latency:.1f}ms"
        return None
    
    def _trigger_realtime_analysis(self, pattern: MemoryAccessPattern):
        """触发实时分析"""
        # 检测异常
        anomaly = self._detect_pattern_anomaly(pattern)
        if anomaly:
            self.anomaly_detections.append(anomaly)
            self.logger.warning(f"检测到异常模式: {anomaly.description}")
        
        # 检测趋势变化
        trend_change = self._detect_trend_change(pattern)
        if trend_change:
            self.logger.info(f"检测到趋势变化: {trend_change}")
    
    def analyze_temporal_patterns(self, time_window_hours: int = 24) -> List[PatternInsight]:
        """分析时间模式
        
        Args:
            time_window_hours: 分析时间窗口（小时）
            
        Returns:
            时间模式洞察列表
        """
        cache_key = f"temporal_{time_window_hours}"
        cached_result = self._get_cached_result(cache_key)
        if cached_result:
            return cached_result
        
        insights = []
        cutoff_time = datetime.now() - timedelta(hours=time_window_hours)
        
        # 获取时间窗口内的模式
        recent_patterns = [
            p for p in self.pattern_history 
            if p.access_times and p.access_times[-1] >= cutoff_time
        ]
        
        if len(recent_patterns) < self.trend_min_samples:
            return insights
        
        # 分析访问时间分布
        hourly_access_counts = defaultdict(int)
        for pattern in recent_patterns:
            for access_time in pattern.access_times:
                if access_time >= cutoff_time:
                    hour = access_time.hour
                    hourly_access_counts[hour] += 1
        
        # 识别高峰时段
        if hourly_access_counts:
            avg_access = statistics.mean(hourly_access_counts.values())
            peak_hours = [hour for hour, count in hourly_access_counts.items() 
                         if count > avg_access * 1.5]
            
            if peak_hours:
                insights.append(PatternInsight(
                    pattern_type=PatternType.TEMPORAL,
                    description=f"检测到访问高峰时段: {peak_hours}",
                    confidence=0.8,
                    impact_score=0.7,
                    trend_direction=TrendDirection.STABLE,
                    affected_memory_types=list(set(p.memory_type for p in recent_patterns)),
                    recommendations=[
                        "在高峰时段预热缓存",
                        "增加高峰时段的资源分配",
                        "考虑负载均衡策略"
                    ],
                    supporting_data={
                        'peak_hours': peak_hours,
                        'hourly_distribution': dict(hourly_access_counts),
                        'average_access': avg_access
                    },
                    timestamp=datetime.now()
                ))
        
        # 分析访问间隔模式
        access_intervals = self._calculate_access_intervals(recent_patterns)
        if access_intervals:
            interval_insight = self._analyze_access_intervals(access_intervals)
            if interval_insight:
                insights.append(interval_insight)
        
        # 缓存结果
        self._cache_result(cache_key, insights)
        return insights
    
    def analyze_frequency_patterns(self) -> List[PatternInsight]:
        """分析频率模式"""
        cache_key = "frequency_patterns"
        cached_result = self._get_cached_result(cache_key)
        if cached_result:
            return cached_result
        
        insights = []
        
        # 分析各内存类型的频率分布
        for memory_type, freq_dist in self.frequency_stats.items():
            if not freq_dist:
                continue
            
            total_accesses = sum(freq_dist.values())
            freq_percentages = {freq: count/total_accesses for freq, count in freq_dist.items()}
            
            # 识别主要访问频率
            dominant_freq = max(freq_percentages.items(), key=lambda x: x[1])
            
            if dominant_freq[1] > 0.6:  # 超过60%的访问属于同一频率
                insights.append(PatternInsight(
                    pattern_type=PatternType.FREQUENCY,
                    description=f"{memory_type.value}内存主要访问频率为{dominant_freq[0]}({dominant_freq[1]:.1%})",
                    confidence=0.9,
                    impact_score=0.6,
                    trend_direction=TrendDirection.STABLE,
                    affected_memory_types=[memory_type],
                    recommendations=self._get_frequency_recommendations(dominant_freq[0]),
                    supporting_data={
                        'frequency_distribution': freq_percentages,
                        'total_accesses': total_accesses,
                        'dominant_frequency': dominant_freq[0]
                    },
                    timestamp=datetime.now()
                ))
        
        self._cache_result(cache_key, insights)
        return insights
    
    def analyze_performance_trends(self) -> List[PatternInsight]:
        """分析性能趋势"""
        cache_key = "performance_trends"
        cached_result = self._get_cached_result(cache_key)
        if cached_result:
            return cached_result
        
        insights = []
        
        for memory_type, trend_data in self.performance_trends.items():
            if len(trend_data) < self.trend_min_samples:
                continue
            
            # 分析延迟趋势
            latencies = [d['latency'] for d in trend_data]
            latency_trend = self._calculate_trend(latencies)
            
            # 分析成功率趋势
            success_rates = [d['success_rate'] for d in trend_data]
            success_trend = self._calculate_trend(success_rates)
            
            # 生成趋势洞察
            if latency_trend['direction'] != TrendDirection.STABLE:
                insights.append(PatternInsight(
                    pattern_type=PatternType.BEHAVIORAL,
                    description=f"{memory_type}内存延迟呈{latency_trend['direction'].value}趋势",
                    confidence=latency_trend['confidence'],
                    impact_score=0.8 if latency_trend['direction'] == TrendDirection.INCREASING else 0.4,
                    trend_direction=latency_trend['direction'],
                    affected_memory_types=[MemoryType(memory_type)],
                    recommendations=self._get_latency_trend_recommendations(latency_trend['direction']),
                    supporting_data={
                        'trend_slope': latency_trend['slope'],
                        'recent_average': statistics.mean(latencies[-10:]),
                        'overall_average': statistics.mean(latencies)
                    },
                    timestamp=datetime.now()
                ))
            
            if success_trend['direction'] == TrendDirection.DECREASING:
                insights.append(PatternInsight(
                    pattern_type=PatternType.BEHAVIORAL,
                    description=f"{memory_type}内存成功率下降",
                    confidence=success_trend['confidence'],
                    impact_score=0.9,
                    trend_direction=success_trend['direction'],
                    affected_memory_types=[MemoryType(memory_type)],
                    recommendations=[
                        "检查内存系统健康状态",
                        "分析失败原因",
                        "考虑增加冗余机制"
                    ],
                    supporting_data={
                        'trend_slope': success_trend['slope'],
                        'recent_average': statistics.mean(success_rates[-10:]),
                        'overall_average': statistics.mean(success_rates)
                    },
                    timestamp=datetime.now()
                ))
        
        self._cache_result(cache_key, insights)
        return insights
    
    def detect_anomalies(self, sensitivity: float = 2.0) -> List[AnomalyDetection]:
        """检测异常模式
        
        Args:
            sensitivity: 异常检测敏感度（标准差倍数）
            
        Returns:
            异常检测结果列表
        """
        anomalies = []
        
        # 检测延迟异常
        latency_anomalies = self._detect_latency_anomalies(sensitivity)
        anomalies.extend(latency_anomalies)
        
        # 检测频率异常
        frequency_anomalies = self._detect_frequency_anomalies(sensitivity)
        anomalies.extend(frequency_anomalies)
        
        # 检测数据大小异常
        size_anomalies = self._detect_size_anomalies(sensitivity)
        anomalies.extend(size_anomalies)
        
        # 更新异常检测历史
        self.anomaly_detections.extend(anomalies)
        
        return anomalies
    
    def _detect_latency_anomalies(self, sensitivity: float) -> List[AnomalyDetection]:
        """检测延迟异常"""
        anomalies = []
        
        for memory_type, trend_data in self.performance_trends.items():
            if len(trend_data) < 20:  # 需要足够的数据
                continue
            
            latencies = [d['latency'] for d in trend_data]
            mean_latency = statistics.mean(latencies)
            std_latency = statistics.stdev(latencies) if len(latencies) > 1 else 0
            
            # 检测最近的异常值
            recent_latencies = latencies[-10:]
            for i, latency in enumerate(recent_latencies):
                if std_latency > 0 and abs(latency - mean_latency) > sensitivity * std_latency:
                    severity = "high" if abs(latency - mean_latency) > 3 * std_latency else "medium"
                    
                    anomalies.append(AnomalyDetection(
                        anomaly_id=f"latency_anomaly_{memory_type}_{int(time.time())}",
                        anomaly_type="latency_spike",
                        severity=severity,
                        description=f"{memory_type}内存出现延迟异常: {latency:.2f}ms (正常范围: {mean_latency:.2f}±{std_latency:.2f}ms)",
                        affected_patterns=[memory_type],
                        detection_time=datetime.now(),
                        suggested_actions=[
                            "检查系统负载",
                            "分析慢查询",
                            "考虑增加缓存"
                        ],
                        confidence_score=min(0.9, abs(latency - mean_latency) / (3 * std_latency))
                    ))
        
        return anomalies
    
    def _detect_frequency_anomalies(self, sensitivity: float) -> List[AnomalyDetection]:
        """检测频率异常"""
        anomalies = []
        
        # 检测访问频率突然变化
        recent_patterns = list(self.pattern_history)[-100:]
        if len(recent_patterns) < 20:
            return anomalies
        
        # 按内存类型分组
        patterns_by_type = defaultdict(list)
        for pattern in recent_patterns:
            patterns_by_type[pattern.memory_type].append(pattern)
        
        for memory_type, patterns in patterns_by_type.items():
            if len(patterns) < 10:
                continue
            
            # 计算访问率变化
            recent_access_rates = []
            for i in range(len(patterns) - 5):
                window_patterns = patterns[i:i+5]
                total_accesses = sum(len(p.access_times) for p in window_patterns)
                recent_access_rates.append(total_accesses)
            
            if len(recent_access_rates) >= 5:
                mean_rate = statistics.mean(recent_access_rates)
                std_rate = statistics.stdev(recent_access_rates) if len(recent_access_rates) > 1 else 0
                
                latest_rate = recent_access_rates[-1]
                if std_rate > 0 and abs(latest_rate - mean_rate) > sensitivity * std_rate:
                    anomalies.append(AnomalyDetection(
                        anomaly_id=f"frequency_anomaly_{memory_type.value}_{int(time.time())}",
                        anomaly_type="access_frequency_change",
                        severity="medium",
                        description=f"{memory_type.value}内存访问频率异常变化",
                        affected_patterns=[memory_type.value],
                        detection_time=datetime.now(),
                        suggested_actions=[
                            "分析访问模式变化原因",
                            "调整缓存策略",
                            "监控系统负载"
                        ],
                        confidence_score=0.7
                    ))
        
        return anomalies
    
    def _detect_size_anomalies(self, sensitivity: float) -> List[AnomalyDetection]:
        """检测数据大小异常"""
        anomalies = []
        
        recent_patterns = list(self.pattern_history)[-50:]
        if len(recent_patterns) < 10:
            return anomalies
        
        data_sizes = [p.data_size for p in recent_patterns]
        mean_size = statistics.mean(data_sizes)
        std_size = statistics.stdev(data_sizes) if len(data_sizes) > 1 else 0
        
        # 检测最近的大小异常
        for pattern in recent_patterns[-5:]:
            if std_size > 0 and abs(pattern.data_size - mean_size) > sensitivity * std_size:
                anomalies.append(AnomalyDetection(
                    anomaly_id=f"size_anomaly_{pattern.pattern_id}",
                    anomaly_type="data_size_anomaly",
                    severity="low",
                    description=f"数据大小异常: {pattern.data_size} bytes (正常范围: {mean_size:.0f}±{std_size:.0f} bytes)",
                    affected_patterns=[pattern.pattern_id],
                    detection_time=datetime.now(),
                    suggested_actions=[
                        "检查数据完整性",
                        "分析数据膨胀原因",
                        "考虑数据压缩"
                    ],
                    confidence_score=0.6
                ))
        
        return anomalies
    
    def cluster_usage_patterns(self, num_clusters: int = 5) -> Dict[str, UsageCluster]:
        """聚类使用模式
        
        Args:
            num_clusters: 聚类数量
            
        Returns:
            使用聚类字典
        """
        if len(self.pattern_history) < num_clusters * 2:
            return {}
        
        # 提取特征
        patterns_with_features = []
        for pattern in self.pattern_history:
            features = self._extract_pattern_features(pattern)
            patterns_with_features.append((pattern, features))
        
        # 简单的基于相似度的聚类
        clusters = self._simple_clustering(patterns_with_features, num_clusters)
        
        # 构建聚类结果
        usage_clusters = {}
        for i, cluster_patterns in enumerate(clusters):
            if not cluster_patterns:
                continue
            
            cluster_id = f"cluster_{i}"
            patterns = [p[0] for p in cluster_patterns]
            features_list = [p[1] for p in cluster_patterns]
            
            # 计算聚类中心
            centroid = self._calculate_centroid(features_list)
            
            # 选择代表性模式
            representative = self._find_representative_pattern(patterns, centroid)
            
            # 计算内聚度
            cohesion = self._calculate_cohesion(features_list, centroid)
            
            usage_clusters[cluster_id] = UsageCluster(
                cluster_id=cluster_id,
                cluster_type=self._determine_cluster_type(centroid),
                patterns=patterns,
                centroid_features=centroid,
                cluster_size=len(patterns),
                cohesion_score=cohesion,
                representative_pattern=representative
            )
        
        self.usage_clusters = usage_clusters
        return usage_clusters
    
    def _extract_pattern_features(self, pattern: MemoryAccessPattern) -> Dict[str, float]:
        """提取模式特征"""
        return {
            'access_frequency_score': self._frequency_to_score(pattern.access_frequency),
            'retrieval_latency': pattern.retrieval_latency,
            'success_rate': pattern.success_rate,
            'data_size_log': math.log(max(1, pattern.data_size)),
            'memory_type_score': list(MemoryType).index(pattern.memory_type),
            'temporal_locality': pattern.temporal_locality or 0.0,
            'semantic_similarity': pattern.semantic_similarity or 0.0
        }
    
    def _frequency_to_score(self, frequency: AccessFrequency) -> float:
        """将访问频率转换为数值分数"""
        frequency_scores = {
            AccessFrequency.VERY_LOW: 0.1,
            AccessFrequency.LOW: 0.3,
            AccessFrequency.MEDIUM: 0.5,
            AccessFrequency.HIGH: 0.7,
            AccessFrequency.VERY_HIGH: 0.9
        }
        return frequency_scores.get(frequency, 0.5)
    
    def _simple_clustering(self, patterns_with_features: List[Tuple], num_clusters: int) -> List[List]:
        """简单聚类算法"""
        import random
        
        if not patterns_with_features:
            return []
        
        # 随机初始化聚类中心
        centroids = []
        for _ in range(num_clusters):
            random_pattern = random.choice(patterns_with_features)
            centroids.append(random_pattern[1].copy())
        
        # 初始化clusters
        clusters = [[] for _ in range(num_clusters)]
        
        # 迭代聚类
        for iteration in range(10):  # 最多10次迭代
            clusters = [[] for _ in range(num_clusters)]
            
            # 分配模式到最近的聚类中心
            for pattern, features in patterns_with_features:
                min_distance = float('inf')
                closest_cluster = 0
                
                for i, centroid in enumerate(centroids):
                    distance = self._calculate_feature_distance(features, centroid)
                    if distance < min_distance:
                        min_distance = distance
                        closest_cluster = i
                
                clusters[closest_cluster].append((pattern, features))
            
            # 更新聚类中心
            new_centroids = []
            for cluster in clusters:
                if cluster:
                    features_list = [p[1] for p in cluster]
                    new_centroid = self._calculate_centroid(features_list)
                    new_centroids.append(new_centroid)
                else:
                    new_centroids.append(centroids[len(new_centroids)])
            
            # 检查收敛
            converged = True
            for i, (old, new) in enumerate(zip(centroids, new_centroids)):
                if self._calculate_feature_distance(old, new) > 0.01:
                    converged = False
                    break
            
            centroids = new_centroids
            if converged:
                break
        
        return clusters
    
    def _calculate_feature_distance(self, features1: Dict[str, float], features2: Dict[str, float]) -> float:
        """计算特征距离"""
        
        distance = 0.0
        for key in features1:
            if key in features2:
                distance += (features1[key] - features2[key]) ** 2
        
        return math.sqrt(distance)
    
    def _calculate_centroid(self, features_list: List[Dict[str, float]]) -> Dict[str, float]:
        """计算聚类中心"""
        if not features_list:
            return {}
        
        centroid = {}
        for key in features_list[0]:
            values = [features[key] for features in features_list if key in features]
            centroid[key] = statistics.mean(values) if values else 0.0
        
        return centroid
    
    def _find_representative_pattern(self, patterns: List[MemoryAccessPattern], 
                                   centroid: Dict[str, float]) -> Optional[MemoryAccessPattern]:
        """找到代表性模式"""
        if not patterns:
            return None
        
        min_distance = float('inf')
        representative = None
        
        for pattern in patterns:
            features = self._extract_pattern_features(pattern)
            distance = self._calculate_feature_distance(features, centroid)
            if distance < min_distance:
                min_distance = distance
                representative = pattern
        
        return representative
    
    def _calculate_cohesion(self, features_list: List[Dict[str, float]], 
                          centroid: Dict[str, float]) -> float:
        """计算聚类内聚度"""
        if not features_list:
            return 0.0
        
        distances = []
        for features in features_list:
            distance = self._calculate_feature_distance(features, centroid)
            distances.append(distance)
        
        avg_distance = statistics.mean(distances)
        max_possible_distance = 10.0  # 假设的最大距离
        
        return max(0.0, 1.0 - (avg_distance / max_possible_distance))
    
    def _determine_cluster_type(self, centroid: Dict[str, float]) -> str:
        """确定聚类类型"""
        if centroid.get('access_frequency_score', 0) > 0.7:
            return "high_frequency"
        elif centroid.get('retrieval_latency', 0) > 200:
            return "slow_access"
        elif centroid.get('data_size_log', 0) > 10:
            return "large_data"
        elif centroid.get('success_rate', 1) < 0.8:
            return "unreliable"
        else:
            return "normal"
    
    def get_optimization_recommendations(self) -> List[Dict[str, Any]]:
        """获取优化建议"""
        recommendations = []
        
        # 基于模式洞察生成建议
        for insight in self.pattern_insights[-10:]:  # 最近10个洞察
            recommendations.extend([
                {
                    'type': 'pattern_based',
                    'source': insight.pattern_type.value,
                    'description': rec,
                    'priority': 'high' if insight.impact_score > 0.7 else 'medium',
                    'confidence': insight.confidence
                }
                for rec in insight.recommendations
            ])
        
        # 基于异常检测生成建议
        recent_anomalies = [a for a in self.anomaly_detections 
                           if (datetime.now() - a.detection_time).total_seconds() / 3600 < 24]
        
        for anomaly in recent_anomalies:
            recommendations.extend([
                {
                    'type': 'anomaly_based',
                    'source': anomaly.anomaly_type,
                    'description': action,
                    'priority': anomaly.severity,
                    'confidence': anomaly.confidence_score
                }
                for action in anomaly.suggested_actions
            ])
        
        # 基于聚类分析生成建议
        for cluster in self.usage_clusters.values():
            if cluster.cohesion_score < 0.5:  # 低内聚度聚类
                recommendations.append({
                    'type': 'cluster_based',
                    'source': cluster.cluster_type,
                    'description': f"优化{cluster.cluster_type}类型的访问模式",
                    'priority': 'medium',
                    'confidence': 0.6
                })
        
        return recommendations
    
    def _analyze_access_intervals(self, intervals: List[float]) -> Optional[PatternInsight]:
        """分析访问间隔"""
        if not intervals:
            return None
        
        avg_interval = statistics.mean(intervals)
        if len(intervals) > 1:
            std_interval = statistics.stdev(intervals)
        else:
            std_interval = 0
        
        # 判断访问模式的规律性
        if std_interval < avg_interval * 0.3:  # 变异系数小于0.3，认为是规律的
            pattern_type = "规律性访问"
            confidence = 0.8
            recommendations = ["可以预测访问时间", "实施定时预加载"]
        else:
            pattern_type = "随机性访问"
            confidence = 0.6
            recommendations = ["采用自适应缓存策略", "监控访问突发"]
        
        return PatternInsight(
            pattern_type=PatternType.TEMPORAL,
            description=f"访问间隔分析: {pattern_type}，平均间隔{avg_interval:.1f}秒",
            confidence=confidence,
            impact_score=0.5,
            trend_direction=TrendDirection.STABLE,
            affected_memory_types=[],
            recommendations=recommendations,
            supporting_data={
                'average_interval': avg_interval,
                'std_interval': std_interval,
                'total_intervals': len(intervals)
            },
            timestamp=datetime.now()
        )
    
    def _get_cached_result(self, cache_key: str) -> Optional[Any]:
        """获取缓存结果"""
        if cache_key in self._analysis_cache:
            timestamp, result = self._analysis_cache[cache_key]
            if datetime.now() - timestamp < self._cache_ttl:
                return result
        return None
    
    def _cache_result(self, cache_key: str, result: Any):
        """缓存结果"""
        self._analysis_cache[cache_key] = (datetime.now(), result)
    
    def clear_cache(self):
        """清理缓存"""
        self._analysis_cache.clear()
        self.logger.debug("分析缓存已清理")
    
    def get_analysis_summary(self) -> Dict[str, Any]:
        """获取分析摘要"""
        return {
            'total_patterns': len(self.access_patterns),
            'recent_insights': len([i for i in self.pattern_insights 
                                  if (datetime.now() - i.timestamp).total_seconds() / 3600 < 24]),
            'active_anomalies': len([a for a in self.anomaly_detections 
                                   if (datetime.now() - a.detection_time).total_seconds() / 3600 < 24]),
            'usage_clusters': len(self.usage_clusters),
            'memory_types_analyzed': len(self.frequency_stats),
            'performance_trends_tracked': len(self.performance_trends),
            'cache_hit_rate': len(self._analysis_cache) / max(1, len(self._analysis_cache) + 10),
            'analysis_window_hours': self.analysis_window_hours
        }
    
    def _calculate_access_intervals(self, patterns: List[MemoryAccessPattern]) -> List[float]:
        """计算访问间隔"""
        intervals = []
        for pattern in patterns:
            if len(pattern.access_times) > 1:
                sorted_times = sorted(pattern.access_times)
                for i in range(1, len(sorted_times)):
                    interval = (sorted_times[i] - sorted_times[i-1]).total_seconds()
                    intervals.append(interval)
        return intervals
    
    def _get_frequency_recommendations(self, dominant_frequency: str) -> List[str]:
        """获取频率相关的推荐"""
        recommendations = []
        if dominant_frequency == "HIGH":
            recommendations.extend([
                "考虑增加缓存容量",
                "优化高频访问路径",
                "实施预加载策略"
            ])
        elif dominant_frequency == "LOW":
            recommendations.extend([
                "考虑延迟加载策略",
                "优化存储成本",
                "实施按需清理机制"
            ])
        else:
            recommendations.extend([
                "平衡缓存策略",
                "监控访问模式变化"
            ])
        return recommendations
    
    def _calculate_trend(self, values: List[float]) -> Dict[str, Any]:
        """计算趋势
        
        Args:
            values: 数值列表
            
        Returns:
            趋势信息字典
        """
        if len(values) < 2:
            return {
                "direction": TrendDirection.STABLE,
                "slope": 0.0,
                "confidence": 0.0
            }
        
        # 简单的线性回归计算趋势
        n = len(values)
        x = list(range(n))
        y = values
        
        # 计算斜率
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(x[i] * y[i] for i in range(n))
        sum_x2 = sum(xi * xi for xi in x)
        
        denominator = n * sum_x2 - sum_x * sum_x
        if denominator == 0:
            slope = 0.0
        else:
            slope = (n * sum_xy - sum_x * sum_y) / denominator
        
        # 确定趋势方向
        if abs(slope) < 0.01:  # 几乎没有变化
            direction = TrendDirection.STABLE
        elif slope > 0:
            direction = TrendDirection.INCREASING
        else:
            direction = TrendDirection.DECREASING
        
        # 计算置信度（基于数据点数量和斜率大小）
        confidence = min(0.9, abs(slope) * n / 10)
        
        return {
            "direction": direction,
            "slope": slope,
            "confidence": confidence
        }
    
    def _get_latency_trend_recommendations(self, trend_direction: TrendDirection) -> List[str]:
        """获取延迟趋势相关的推荐"""
        recommendations = []
        if trend_direction == TrendDirection.INCREASING:
            recommendations.extend([
                "分析慢查询原因",
                "优化索引结构",
                "考虑增加缓存层"
            ])
        elif trend_direction == TrendDirection.DECREASING:
            recommendations.extend([
                "继续保持优化",
                "监控性能稳定性"
            ])
        else:
            recommendations.extend([
                "维持当前性能水平",
                "定期性能审查"
            ])
        return recommendations