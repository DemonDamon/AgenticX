"""工具使用历史管理

记录、存储和分析工具使用历史，为智能选择提供数据支持。
"""

import json
import logging
from datetime import datetime, timedelta, UTC
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class ToolUsageRecord:
    """工具使用记录"""
    
    def __init__(self, tool_name: str, task_domain: str, success: bool, 
                 execution_time: float, timestamp: Optional[datetime] = None, context: Optional[Dict[str, Any]] = None):
        self.tool_name = tool_name
        self.task_domain = task_domain
        self.success = success
        self.execution_time = execution_time
        self.timestamp = timestamp or datetime.now()
        self.context = context or {}
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            'tool_name': self.tool_name,
            'task_domain': self.task_domain,
            'success': self.success,
            'execution_time': self.execution_time,
            'timestamp': self.timestamp.isoformat(),
            'context': self.context
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ToolUsageRecord':
        """从字典创建记录"""
        return cls(
            tool_name=data['tool_name'],
            task_domain=data['task_domain'],
            success=data['success'],
            execution_time=data['execution_time'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            context=data.get('context', {})
        )


class ToolUsageHistory:
    """工具使用历史管理器
    
    功能：
    1. 记录工具使用历史
    2. 持久化存储历史数据
    3. 提供历史数据查询和分析
    4. 支持数据清理和归档
    """
    
    def __init__(self, storage_path: Optional[str] = None, max_records: int = 10000):
        self.storage_path = Path(storage_path) if storage_path else Path("tool_usage_history.json")
        self.max_records = max_records
        self.records: List[ToolUsageRecord] = []
        self._load_history()
    
    def record_usage(self, tool_name: str, task_domain: str, success: bool, 
                    execution_time: float, context: Optional[Dict[str, Any]] = None):
        """记录工具使用
        
        Args:
            tool_name: 工具名称
            task_domain: 任务领域
            success: 是否成功
            execution_time: 执行时间
            context: 上下文信息
        """
        context = context or {}
        record = ToolUsageRecord(
            tool_name=tool_name,
            task_domain=task_domain,
            success=success,
            execution_time=execution_time,
            context=context
        )
        
        self.records.append(record)
        
        # 如果记录数超过限制，删除最旧的记录
        if len(self.records) > self.max_records:
            self.records = self.records[-self.max_records:]
        
        # 异步保存到磁盘
        self._save_history()
        
        logger.debug(f"记录工具使用: {tool_name} in {task_domain}, 成功: {success}")
    
    def get_tool_history(self, tool_name: str, domain: Optional[str] = None, 
                        days: Optional[int] = None) -> List[Dict[str, Any]]:
        """获取特定工具的使用历史
        
        Args:
            tool_name: 工具名称
            domain: 任务领域（可选）
            days: 最近天数（可选）
            
        Returns:
            List[Dict[str, Any]]: 使用记录列表
        """
        filtered_records = []
        cutoff_date = datetime.now() - timedelta(days=days) if days else None
        
        for record in self.records:
            # 过滤工具名称
            if record.tool_name != tool_name:
                continue
            
            # 过滤领域
            if domain and record.task_domain != domain:
                continue
            
            # 过滤时间
            if cutoff_date and record.timestamp < cutoff_date:
                continue
            
            filtered_records.append(record.to_dict())
        
        return filtered_records
    
    def get_domain_statistics(self, domain: str, days: int = 30) -> Dict[str, Any]:
        """获取特定领域的统计信息
        
        Args:
            domain: 任务领域
            days: 统计天数
            
        Returns:
            Dict[str, Any]: 统计信息
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        domain_records = [
            record for record in self.records
            if record.task_domain == domain and record.timestamp >= cutoff_date
        ]
        
        if not domain_records:
            return {
                'total_executions': 0,
                'success_rate': 0.0,
                'avg_execution_time': 0.0,
                'tool_usage': {},
                'most_used_tool': None
            }
        
        # 计算统计信息
        total_executions = len(domain_records)
        successful_executions = sum(1 for r in domain_records if r.success)
        total_time = sum(r.execution_time for r in domain_records)
        
        # 工具使用统计
        tool_usage = defaultdict(int)
        for record in domain_records:
            tool_usage[record.tool_name] += 1
        
        most_used_tool = max(tool_usage.items(), key=lambda x: x[1])[0] if tool_usage else None
        
        return {
            'total_executions': total_executions,
            'success_rate': successful_executions / total_executions,
            'avg_execution_time': total_time / total_executions,
            'tool_usage': dict(tool_usage),
            'most_used_tool': most_used_tool
        }
    
    def get_tool_performance_trends(self, tool_name: str, days: int = 30) -> Dict[str, List[float]]:
        """获取工具性能趋势
        
        Args:
            tool_name: 工具名称
            days: 分析天数
            
        Returns:
            Dict[str, List[float]]: 性能趋势数据
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        tool_records = [
            record for record in self.records
            if record.tool_name == tool_name and record.timestamp >= cutoff_date
        ]
        
        if not tool_records:
            return {'success_rates': [], 'execution_times': [], 'dates': []}
        
        # 按日期分组
        daily_data = defaultdict(list)
        for record in tool_records:
            date_key = record.timestamp.date()
            daily_data[date_key].append(record)
        
        # 计算每日趋势
        dates = []
        success_rates = []
        execution_times = []
        
        for date in sorted(daily_data.keys()):
            records = daily_data[date]
            success_count = sum(1 for r in records if r.success)
            avg_time = sum(r.execution_time for r in records) / len(records)
            
            dates.append(date.isoformat())
            success_rates.append(success_count / len(records))
            execution_times.append(avg_time)
        
        return {
            'success_rates': success_rates,
            'execution_times': execution_times,
            'dates': dates
        }
    
    def analyze_usage_patterns(self, days: int = 30) -> Dict[str, Any]:
        """分析使用模式
        
        Args:
            days: 分析天数
            
        Returns:
            Dict[str, Any]: 使用模式分析结果
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        recent_records = [
            record for record in self.records
            if record.timestamp >= cutoff_date
        ]
        
        if not recent_records:
            return {'patterns': [], 'recommendations': []}
        
        patterns = []
        recommendations = []
        
        # 分析工具使用频率
        tool_frequency = defaultdict(int)
        tool_success = defaultdict(list)
        
        for record in recent_records:
            tool_frequency[record.tool_name] += 1
            tool_success[record.tool_name].append(record.success)
        
        # 识别高频使用但低成功率的工具
        for tool_name, frequency in tool_frequency.items():
            if frequency >= 5:  # 至少使用5次
                success_rate = sum(tool_success[tool_name]) / len(tool_success[tool_name])
                if success_rate < 0.7:
                    patterns.append(f"工具 {tool_name} 使用频繁但成功率较低 ({success_rate:.2f})")
                    recommendations.append(f"考虑优化工具 {tool_name} 的配置或寻找替代方案")
        
        # 分析领域偏好
        domain_frequency = defaultdict(int)
        for record in recent_records:
            domain_frequency[record.task_domain] += 1
        
        most_common_domain = max(domain_frequency.items(), key=lambda x: x[1])[0]
        patterns.append(f"最常处理的任务领域: {most_common_domain}")
        
        # 分析时间模式
        hour_frequency = defaultdict(int)
        for record in recent_records:
            hour_frequency[record.timestamp.hour] += 1
        
        peak_hour = max(hour_frequency.items(), key=lambda x: x[1])[0]
        patterns.append(f"使用高峰时段: {peak_hour}:00")
        
        return {
            'patterns': patterns,
            'recommendations': recommendations,
            'tool_frequency': dict(tool_frequency),
            'domain_frequency': dict(domain_frequency)
        }
    
    def cleanup_old_records(self, days: int = 90):
        """清理旧记录
        
        Args:
            days: 保留天数
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        original_count = len(self.records)
        
        self.records = [
            record for record in self.records
            if record.timestamp >= cutoff_date
        ]
        
        cleaned_count = original_count - len(self.records)
        if cleaned_count > 0:
            self._save_history()
            logger.info(f"清理了 {cleaned_count} 条旧记录")
    
    def export_data(self, output_path: str, format: str = 'json'):
        """导出历史数据
        
        Args:
            output_path: 输出路径
            format: 导出格式 ('json' 或 'csv')
        """
        if format == 'json':
            data = [record.to_dict() for record in self.records]
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        elif format == 'csv':
            import csv
            with open(output_path, 'w', newline='', encoding='utf-8') as f:
                if self.records:
                    fieldnames = ['tool_name', 'task_domain', 'success', 'execution_time', 'timestamp']
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    for record in self.records:
                        row = record.to_dict()
                        row['timestamp'] = row['timestamp']
                        del row['context']  # CSV中不包含复杂的context数据
                        writer.writerow(row)
        
        logger.info(f"历史数据已导出到 {output_path}")
    
    def _load_history(self):
        """从磁盘加载历史数据"""
        if not self.storage_path.exists():
            return
        
        try:
            with open(self.storage_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.records = [ToolUsageRecord.from_dict(record_data) for record_data in data]
            logger.info(f"加载了 {len(self.records)} 条历史记录")
        except Exception as e:
            logger.error(f"加载历史数据失败: {e}")
            self.records = []
    
    def _save_history(self):
        """保存历史数据到磁盘"""
        try:
            # 确保目录存在
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
            
            data = [record.to_dict() for record in self.records]
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"保存历史数据失败: {e}")
    
    def get_summary(self) -> Dict[str, Any]:
        """获取历史数据摘要"""
        if not self.records:
            return {
                'total_records': 0,
                'date_range': None,
                'unique_tools': 0,
                'unique_domains': 0,
                'overall_success_rate': 0.0
            }
        
        # 计算摘要统计
        total_records = len(self.records)
        successful_records = sum(1 for r in self.records if r.success)
        unique_tools = len(set(r.tool_name for r in self.records))
        unique_domains = len(set(r.task_domain for r in self.records))
        
        earliest_date = min(r.timestamp for r in self.records)
        latest_date = max(r.timestamp for r in self.records)
        
        return {
            'total_records': total_records,
            'date_range': {
                'start': earliest_date.isoformat(),
                'end': latest_date.isoformat()
            },
            'unique_tools': unique_tools,
            'unique_domains': unique_domains,
            'overall_success_rate': successful_records / total_records
        }