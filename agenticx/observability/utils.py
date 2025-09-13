"""
AgenticX M9: 辅助工具模块 (Utility Module)

本模块提供可观测性系统的辅助工具和数据处理功能。
"""

import json
import csv
import pickle
import statistics
from typing import Dict, Any, List, Optional, Union, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC
from collections import defaultdict, deque
import logging
from pathlib import Path

from .trajectory import ExecutionTrajectory
from ..core.event import AnyEvent


logger = logging.getLogger(__name__)


@dataclass
class TimeSeriesPoint:
    """时间序列数据点"""
    timestamp: datetime
    value: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "value": self.value,
            "metadata": self.metadata
        }


class TimeSeriesData:
    """
    时间序列数据管理器
    
    管理时间序列数据的存储、查询和分析。
    """
    
    def __init__(self, max_points: int = 10000):
        self.max_points = max_points
        self.data: deque = deque(maxlen=max_points)
        self.metrics: Dict[str, deque] = defaultdict(lambda: deque(maxlen=max_points))
    
    def add_point(self, timestamp: datetime, value: float, metadata: Optional[Dict[str, Any]] = None):
        """添加数据点"""
        point = TimeSeriesPoint(
            timestamp=timestamp,
            value=value,
            metadata=metadata or {}
        )
        self.data.append(point)
    
    def add_metric_point(self, metric_name: str, timestamp: datetime, value: float, metadata: Optional[Dict[str, Any]] = None):
        """添加指标数据点"""
        point = TimeSeriesPoint(
            timestamp=timestamp,
            value=value,
            metadata=metadata or {}
        )
        self.metrics[metric_name].append(point)
    
    def get_data(self, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None) -> List[TimeSeriesPoint]:
        """获取数据"""
        filtered_data = []
        
        for point in self.data:
            if start_time and point.timestamp < start_time:
                continue
            if end_time and point.timestamp > end_time:
                continue
            filtered_data.append(point)
        
        return filtered_data
    
    def get_metric_data(self, metric_name: str, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None) -> List[TimeSeriesPoint]:
        """获取指标数据"""
        if metric_name not in self.metrics:
            return []
        
        filtered_data = []
        
        for point in self.metrics[metric_name]:
            if start_time and point.timestamp < start_time:
                continue
            if end_time and point.timestamp > end_time:
                continue
            filtered_data.append(point)
        
        return filtered_data
    
    def get_latest_point(self) -> Optional[TimeSeriesPoint]:
        """获取最新数据点"""
        return self.data[-1] if self.data else None
    
    def get_latest_metric_point(self, metric_name: str) -> Optional[TimeSeriesPoint]:
        """获取最新指标数据点"""
        if metric_name not in self.metrics or not self.metrics[metric_name]:
            return None
        return self.metrics[metric_name][-1]
    
    def calculate_statistics(self, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None) -> Dict[str, float]:
        """计算统计信息"""
        data = self.get_data(start_time, end_time)
        
        if not data:
            return {}
        
        values = [point.value for point in data]
        
        return {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "std": statistics.stdev(values) if len(values) > 1 else 0,
            "variance": statistics.variance(values) if len(values) > 1 else 0
        }
    
    def calculate_metric_statistics(self, metric_name: str, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None) -> Dict[str, float]:
        """计算指标统计信息"""
        data = self.get_metric_data(metric_name, start_time, end_time)
        
        if not data:
            return {}
        
        values = [point.value for point in data]
        
        return {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "std": statistics.stdev(values) if len(values) > 1 else 0,
            "variance": statistics.variance(values) if len(values) > 1 else 0
        }
    
    def resample(self, interval: timedelta, aggregation: str = "mean") -> List[TimeSeriesPoint]:
        """重采样数据"""
        if not self.data:
            return []
        
        # 按时间间隔分组
        groups = defaultdict(list)
        start_time = self.data[0].timestamp
        
        for point in self.data:
            bucket = int((point.timestamp - start_time).total_seconds() / interval.total_seconds())
            groups[bucket].append(point)
        
        # 聚合每个组
        resampled = []
        for bucket, points in groups.items():
            bucket_start = start_time + timedelta(seconds=bucket * interval.total_seconds())
            values = [point.value for point in points]
            
            if aggregation == "mean":
                value = statistics.mean(values)
            elif aggregation == "sum":
                value = sum(values)
            elif aggregation == "min":
                value = min(values)
            elif aggregation == "max":
                value = max(values)
            elif aggregation == "count":
                value = len(values)
            else:
                value = statistics.mean(values)  # 默认使用平均值
            
            resampled.append(TimeSeriesPoint(
                timestamp=bucket_start,
                value=value,
                metadata={"aggregation": aggregation, "point_count": len(points)}
            ))
        
        return resampled
    
    def clear(self):
        """清空数据"""
        self.data.clear()
        self.metrics.clear()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "data": [point.to_dict() for point in self.data],
            "metrics": {
                name: [point.to_dict() for point in points]
                for name, points in self.metrics.items()
            },
            "max_points": self.max_points
        }


class StatisticsCalculator:
    """
    统计计算器
    
    提供各种统计分析功能。
    """
    
    def __init__(self):
        pass
    
    def calculate_descriptive_stats(self, values: List[float]) -> Dict[str, float]:
        """计算描述性统计"""
        if not values:
            return {}
        
        mode_value = None
        if len(set(values)) != len(values):  # 有重复值才计算mode
            try:
                mode_value = float(statistics.mode(values))
            except statistics.StatisticsError:
                mode_value = None
        
        return {
            "count": float(len(values)),
            "min": float(min(values)),
            "max": float(max(values)),
            "mean": float(statistics.mean(values)),
            "median": float(statistics.median(values)),
            "mode": mode_value if mode_value is not None else float('nan'),  # 修复：确保返回float类型
            "std": float(statistics.stdev(values) if len(values) > 1 else 0),
            "variance": float(statistics.variance(values) if len(values) > 1 else 0),
            "range": float(max(values) - min(values))
        }
    
    def calculate_percentiles(self, values: List[float], percentiles: List[float] = [25, 50, 75, 90, 95, 99]) -> Dict[str, float]:
        """计算百分位数"""
        if not values:
            return {}
        
        sorted_values = sorted(values)
        result = {}
        
        for p in percentiles:
            index = (len(sorted_values) - 1) * p / 100
            lower = int(index)
            upper = min(lower + 1, len(sorted_values) - 1)
            
            if lower == upper:
                result[f"p{p}"] = float(sorted_values[lower])  # 确保返回float类型
            else:
                weight = index - lower
                result[f"p{p}"] = float(sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight)  # 确保返回float类型
        
        return result
    
    def calculate_correlation(self, x: List[float], y: List[float]) -> float:
        """计算相关系数"""
        if len(x) != len(y) or len(x) < 2:
            return 0.0
        
        mean_x = statistics.mean(x)
        mean_y = statistics.mean(y)
        
        numerator = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(len(x)))
        denominator_x = sum((x[i] - mean_x) ** 2 for i in range(len(x)))
        denominator_y = sum((y[i] - mean_y) ** 2 for i in range(len(y)))
        
        if denominator_x == 0 or denominator_y == 0:
            return 0.0
        
        return numerator / (denominator_x * denominator_y) ** 0.5
    
    def detect_outliers(self, values: List[float], method: str = "iqr") -> List[Tuple[int, float]]:
        """检测异常值"""
        if not values:
            return []
        
        outliers = []
        
        if method == "iqr":
            # 使用IQR方法
            q1 = statistics.quantiles(values, n=4)[0]
            q3 = statistics.quantiles(values, n=4)[2]
            iqr = q3 - q1
            
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr
            
            for i, value in enumerate(values):
                if value < lower_bound or value > upper_bound:
                    outliers.append((i, float(value)))  # 确保返回float类型
        elif method == "zscore":
            # 使用Z分数方法
            mean = statistics.mean(values)
            std = statistics.stdev(values) if len(values) > 1 else 0
            
            if std > 0:
                for i, value in enumerate(values):
                    z_score = abs(value - mean) / std
                    if z_score > 3:  # 3σ原则
                        outliers.append((i, float(value)))  # 确保返回float类型
        
        return outliers
    
    def calculate_trend(self, values: List[float]) -> Dict[str, Any]:
        """计算趋势"""
        if len(values) < 2:
            return {"trend": "insufficient_data"}
        
        # 简单线性趋势
        n = len(values)
        x = list(range(n))
        
        # 计算线性回归
        mean_x = statistics.mean(x)
        mean_y = statistics.mean(values)
        
        slope = sum((x[i] - mean_x) * (values[i] - mean_y) for i in range(n)) / sum((x[i] - mean_x) ** 2 for i in range(n))
        intercept = mean_y - slope * mean_x
        
        # 计算R²
        y_pred = [slope * x[i] + intercept for i in range(n)]
        ss_res = sum((values[i] - y_pred[i]) ** 2 for i in range(n))
        ss_tot = sum((values[i] - mean_y) ** 2 for i in range(n))
        r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
        
        # 判断趋势
        if slope > 0.1:
            trend = "increasing"
        elif slope < -0.1:
            trend = "decreasing"
        else:
            trend = "stable"
        
        return {
            "trend": trend,
            "slope": float(slope),         # 确保返回float类型
            "intercept": float(intercept), # 确保返回float类型
            "r_squared": float(r_squared), # 确保返回float类型
            "confidence": float(r_squared) # 使用R²作为置信度，确保返回float类型
        }


class EventProcessor:
    """
    事件处理器
    
    提供事件数据的处理和分析功能。
    """
    
    def __init__(self):
        pass
    
    def group_events_by_type(self, events: List[AnyEvent]) -> Dict[str, List[AnyEvent]]:
        """按类型分组事件"""
        grouped = defaultdict(list)
        for event in events:
            grouped[event.type].append(event)
        return dict(grouped)
    
    def group_events_by_agent(self, events: List[AnyEvent]) -> Dict[str, List[AnyEvent]]:
        """按Agent分组事件"""
        grouped = defaultdict(list)
        for event in events:
            if event.agent_id:
                grouped[event.agent_id].append(event)
        return dict(grouped)
    
    def group_events_by_task(self, events: List[AnyEvent]) -> Dict[str, List[AnyEvent]]:
        """按任务分组事件"""
        grouped = defaultdict(list)
        for event in events:
            if event.task_id:
                grouped[event.task_id].append(event)
        return dict(grouped)
    
    def filter_events_by_time(self, events: List[AnyEvent], start_time: datetime, end_time: datetime) -> List[AnyEvent]:
        """按时间过滤事件"""
        return [
            event for event in events
            if start_time <= event.timestamp <= end_time
        ]
    
    def calculate_event_frequency(self, events: List[AnyEvent], time_window: timedelta = timedelta(minutes=1)) -> Dict[str, float]:
        """计算事件频率"""
        if not events:
            return {}
        
        # 按类型分组
        grouped = self.group_events_by_type(events)
        
        # 计算时间窗口数量
        start_time = min(event.timestamp for event in events)
        end_time = max(event.timestamp for event in events)
        total_time = end_time - start_time
        
        if total_time.total_seconds() == 0:
            return {}
        
        windows = total_time / time_window
        
        # 计算频率
        frequencies = {}
        for event_type, type_events in grouped.items():
            frequencies[event_type] = len(type_events) / windows
        
        return frequencies
    
    def find_event_patterns(self, events: List[AnyEvent]) -> Dict[str, Any]:
        """查找事件模式"""
        if not events:
            return {}
        
        # 按时间排序
        sorted_events = sorted(events, key=lambda e: e.timestamp)
        
        # 查找常见序列
        sequences = []
        window_size = 3
        
        for i in range(len(sorted_events) - window_size + 1):
            sequence = tuple(event.type for event in sorted_events[i:i+window_size])
            sequences.append(sequence)
        
        # 统计序列频率
        sequence_counts = defaultdict(int)
        for sequence in sequences:
            sequence_counts[sequence] += 1
        
        # 找出最常见的序列
        common_sequences = sorted(sequence_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        
        return {
            "total_events": len(events),
            "unique_event_types": len(set(event.type for event in events)),
            "common_sequences": [(str(seq), float(count)) for seq, count in common_sequences],  # 确保返回正确的类型
            "event_type_distribution": dict(defaultdict(int, {
                event_type: len(type_events) 
                for event_type, type_events in self.group_events_by_type(events).items()
            }))
        }


class DataExporter:
    """
    数据导出器
    
    提供多种格式的数据导出功能。
    """
    
    def __init__(self):
        pass
    
    def export_to_json(self, data: Any, filename: str):
        """导出为JSON格式"""
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
            logger.info(f"数据已导出到JSON文件: {filename}")
        except Exception as e:
            logger.error(f"导出JSON文件失败: {e}")
            raise
    
    def export_to_csv(self, data: List[Dict[str, Any]], filename: str):
        """导出为CSV格式"""
        try:
            if not data:
                return
            
            fieldnames = data[0].keys()
            
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(data)
            
            logger.info(f"数据已导出到CSV文件: {filename}")
        except Exception as e:
            logger.error(f"导出CSV文件失败: {e}")
            raise
    
    def export_to_pickle(self, data: Any, filename: str):
        """导出为Pickle格式"""
        try:
            with open(filename, 'wb') as f:
                pickle.dump(data, f)
            logger.info(f"数据已导出到Pickle文件: {filename}")
        except Exception as e:
            logger.error(f"导出Pickle文件失败: {e}")
            raise
    
    def export_trajectory_to_json(self, trajectory: ExecutionTrajectory, filename: str):
        """导出轨迹为JSON格式"""
        self.export_to_json(trajectory.to_dict(), filename)
    
    def export_trajectories_to_csv(self, trajectories: List[ExecutionTrajectory], filename: str):
        """导出轨迹摘要为CSV格式"""
        data = []
        
        for trajectory in trajectories:
            summary = trajectory.get_summary()
            data.append({
                "trajectory_id": trajectory.trajectory_id,
                "agent_id": trajectory.metadata.agent_id,
                "task_id": trajectory.metadata.task_id,
                "start_time": trajectory.metadata.start_time.isoformat(),
                "end_time": trajectory.metadata.end_time.isoformat() if trajectory.metadata.end_time else None,
                "duration": trajectory.metadata.total_duration,
                "total_steps": trajectory.metadata.total_steps,
                "successful_steps": trajectory.metadata.successful_steps,
                "failed_steps": trajectory.metadata.failed_steps,
                "total_tokens": trajectory.metadata.total_tokens,
                "total_cost": trajectory.metadata.total_cost,
                "final_status": trajectory.metadata.final_status.value if trajectory.metadata.final_status else None
            })
        
        self.export_to_csv(data, filename)
    
    def export_time_series_to_csv(self, time_series: TimeSeriesData, filename: str):
        """导出时间序列数据为CSV格式"""
        data = []
        
        for point in time_series.data:
            data.append({
                "timestamp": point.timestamp.isoformat(),
                "value": point.value,
                "metadata": json.dumps(point.metadata)
            })
        
        self.export_to_csv(data, filename)
    
    def import_from_json(self, filename: str) -> Any:
        """从JSON文件导入数据"""
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            logger.info(f"从JSON文件导入数据: {filename}")
            return data
        except Exception as e:
            logger.error(f"导入JSON文件失败: {e}")
            raise
    
    def import_from_pickle(self, filename: str) -> Any:
        """从Pickle文件导入数据"""
        try:
            with open(filename, 'rb') as f:
                data = pickle.load(f)
            logger.info(f"从Pickle文件导入数据: {filename}")
            return data
        except Exception as e:
            logger.error(f"导入Pickle文件失败: {e}")
            raise
    
    def import_trajectory_from_json(self, filename: str) -> ExecutionTrajectory:
        """从JSON文件导入轨迹"""
        data = self.import_from_json(filename)
        return ExecutionTrajectory.from_dict(data)
    
    def batch_export_trajectories(self, trajectories: List[ExecutionTrajectory], output_dir: str):
        """批量导出轨迹"""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        for trajectory in trajectories:
            filename = output_path / f"trajectory_{trajectory.trajectory_id}.json"
            self.export_trajectory_to_json(trajectory, str(filename))
        
        # 导出摘要
        summary_filename = output_path / "trajectories_summary.csv"
        self.export_trajectories_to_csv(trajectories, str(summary_filename))
        
        logger.info(f"批量导出了{len(trajectories)}个轨迹到目录: {output_dir}")


class DataFilter:
    """
    数据过滤器
    
    提供数据过滤和筛选功能。
    """
    
    def __init__(self):
        pass
    
    def filter_by_value(self, data: List[Dict[str, Any]], field: str, value: Any) -> List[Dict[str, Any]]:
        """按值过滤"""
        return [item for item in data if item.get(field) == value]
    
    def filter_by_range(self, data: List[Dict[str, Any]], field: str, min_value: float, max_value: float) -> List[Dict[str, Any]]:
        """按范围过滤"""
        return [
            item for item in data 
            if min_value <= item.get(field, 0) <= max_value
        ]
    
    def filter_by_time_range(self, data: List[Dict[str, Any]], time_field: str, start_time: datetime, end_time: datetime) -> List[Dict[str, Any]]:
        """按时间范围过滤"""
        filtered = []
        for item in data:
            if time_field in item:
                item_time = item[time_field]
                if isinstance(item_time, str):
                    item_time = datetime.fromisoformat(item_time)
                if start_time <= item_time <= end_time:
                    filtered.append(item)
        return filtered
    
    def filter_by_condition(self, data: List[Dict[str, Any]], condition: Callable[[Dict[str, Any]], bool]) -> List[Dict[str, Any]]:
        """按条件过滤"""
        return [item for item in data if condition(item)]
    
    def filter_top_n(self, data: List[Dict[str, Any]], field: str, n: int, ascending: bool = False) -> List[Dict[str, Any]]:
        """获取前N项"""
        sorted_data = sorted(data, key=lambda x: x.get(field, 0), reverse=not ascending)
        return sorted_data[:n]
    
    def filter_unique(self, data: List[Dict[str, Any]], field: str) -> List[Dict[str, Any]]:
        """去重"""
        seen = set()
        unique_data = []
        
        for item in data:
            value = item.get(field)
            if value not in seen:
                seen.add(value)
                unique_data.append(item)
        
        return unique_data


# 便捷函数
def create_time_series_from_trajectories(trajectories: List[ExecutionTrajectory], metric: str = "duration") -> TimeSeriesData:
    """从轨迹创建时间序列数据"""
    ts_data = TimeSeriesData()
    
    for trajectory in trajectories:
        if trajectory.metadata.end_time:
            if metric == "duration":
                value = float(trajectory.metadata.total_duration or 0)  # 确保返回float类型
            elif metric == "cost":
                value = float(trajectory.metadata.total_cost)  # 确保返回float类型
            elif metric == "tokens":
                value = float(trajectory.metadata.total_tokens)  # 确保返回float类型
            elif metric == "steps":
                value = float(trajectory.metadata.total_steps)  # 确保返回float类型
            else:
                value = 0.0
            
            ts_data.add_point(
                timestamp=trajectory.metadata.end_time,
                value=value,
                metadata={"trajectory_id": trajectory.trajectory_id}
            )
    
    return ts_data


def analyze_trajectory_performance(trajectories: List[ExecutionTrajectory]) -> Dict[str, Any]:
    """分析轨迹性能"""
    if not trajectories:
        return {}
    
    stats_calc = StatisticsCalculator()
    
    # 收集各种指标
    durations = [t.metadata.total_duration for t in trajectories if t.metadata.total_duration]
    costs = [t.metadata.total_cost for t in trajectories]
    tokens = [float(t.metadata.total_tokens) for t in trajectories]  # 修复：转换为float类型
    steps = [float(t.metadata.total_steps) for t in trajectories]    # 修复：转换为float类型
    
    analysis = {
        "total_trajectories": len(trajectories),
        "time_range": {
            "start": min(t.metadata.start_time for t in trajectories).isoformat(),
            "end": max(t.metadata.end_time for t in trajectories if t.metadata.end_time).isoformat()
        }
    }
    
    # 时间分析
    if durations:
        analysis["duration_stats"] = stats_calc.calculate_descriptive_stats(durations)
        analysis["duration_percentiles"] = stats_calc.calculate_percentiles(durations)
        analysis["duration_outliers"] = stats_calc.detect_outliers(durations)
        analysis["duration_trend"] = stats_calc.calculate_trend(durations)
    
    # 成本分析
    if costs:
        analysis["cost_stats"] = stats_calc.calculate_descriptive_stats(costs)
        analysis["cost_percentiles"] = stats_calc.calculate_percentiles(costs)
    
    # 令牌分析
    if tokens:
        analysis["token_stats"] = stats_calc.calculate_descriptive_stats(tokens)
        analysis["token_percentiles"] = stats_calc.calculate_percentiles(tokens)
    
    # 步骤分析
    if steps:
        analysis["step_stats"] = stats_calc.calculate_descriptive_stats(steps)
    
    return analysis 