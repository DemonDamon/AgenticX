"""
AgenticX M8.5: 协作记忆系统

负责存储和检索协作事件，分析协作模式。
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, UTC
import json
import uuid

from .base import CollaborationEvent, CollaborationPattern
from .config import CollaborationMemoryConfig


class CollaborationMemory:
    """协作记忆系统"""
    
    def __init__(self, memory_config: CollaborationMemoryConfig):
        """
        初始化协作记忆
        
        Args:
            memory_config: 记忆配置
        """
        self.config = memory_config
        self.events: List[CollaborationEvent] = []
        self.patterns: List[CollaborationPattern] = []
        self.agent_memories: Dict[str, List[Dict[str, Any]]] = {}
    
    def store_collaboration_event(self, event: CollaborationEvent) -> str:
        """
        存储协作事件
        
        Args:
            event: 协作事件
            
        Returns:
            str: 事件ID
        """
        event.event_id = str(uuid.uuid4())
        event.timestamp = datetime.now()
        
        self.events.append(event)
        
        # 更新智能体记忆
        for agent_id in [event.source_agent_id, event.target_agent_id]:
            if agent_id and agent_id not in self.agent_memories:
                self.agent_memories[agent_id] = []
            
            if agent_id:
                self.agent_memories[agent_id].append({
                    "event_id": event.event_id,
                    "event_type": event.event_type,
                    "timestamp": event.timestamp,
                    "data": event.data
                })
        
        return event.event_id
    
    def retrieve_collaboration_history(self, agent_ids: List[str]) -> List[CollaborationEvent]:
        """
        检索协作历史
        
        Args:
            agent_ids: 智能体ID列表
            
        Returns:
            List[CollaborationEvent]: 协作事件列表
        """
        relevant_events = []
        
        for event in self.events:
            if (event.source_agent_id in agent_ids or 
                event.target_agent_id in agent_ids):
                relevant_events.append(event)
        
        # 按时间排序
        relevant_events.sort(key=lambda x: x.timestamp)
        
        return relevant_events
    
    def analyze_collaboration_patterns(self) -> List[CollaborationPattern]:
        """
        分析协作模式
        
        Returns:
            List[CollaborationPattern]: 协作模式列表
        """
        patterns = []
        
        # 按事件类型分组
        event_types = {}
        for event in self.events:
            if event.event_type not in event_types:
                event_types[event.event_type] = []
            event_types[event.event_type].append(event)
        
        # 分析每种事件类型的模式
        for event_type, events in event_types.items():
            if len(events) >= 3:  # 至少需要3个事件才能形成模式
                pattern = self._extract_pattern_from_events(event_type, events)
                if pattern:
                    patterns.append(pattern)
        
        self.patterns = patterns
        return patterns
    
    def _extract_pattern_from_events(self, event_type: str, events: List[CollaborationEvent]) -> Optional[CollaborationPattern]:
        """从事件中提取模式"""
        if not events:
            return None
        
        # 计算事件频率
        frequency = len(events) / max(1, (events[-1].timestamp - events[0].timestamp).total_seconds())
        
        # 分析参与者
        participants = set()
        for event in events:
            if event.source_agent_id:
                participants.add(event.source_agent_id)
            if event.target_agent_id:
                participants.add(event.target_agent_id)
        
        # 分析时间分布
        time_intervals = []
        for i in range(1, len(events)):
            interval = (events[i].timestamp - events[i-1].timestamp).total_seconds()
            time_intervals.append(interval)
        
        avg_interval = sum(time_intervals) / len(time_intervals) if time_intervals else 0
        
        return CollaborationPattern(
            pattern_type=event_type,
            frequency=frequency,
            participants=list(participants),
            average_interval=avg_interval,
            total_events=len(events),
            first_occurrence=events[0].timestamp,
            last_occurrence=events[-1].timestamp
        )
    
    def optimize_collaboration_strategy(self, patterns: List[CollaborationPattern]) -> Dict[str, Any]:
        """
        优化协作策略
        
        Args:
            patterns: 协作模式列表
            
        Returns:
            Dict[str, Any]: 优化策略
        """
        strategy = {
            "recommendations": [],
            "efficiency_improvements": [],
            "communication_optimizations": []
        }
        
        for pattern in patterns:
            # 分析高频事件
            if pattern.frequency > 1.0:  # 每秒超过1个事件
                strategy["recommendations"].append(
                    f"事件类型 '{pattern.pattern_type}' 频率过高，建议优化通信机制"
                )
            
            # 分析参与者数量
            if len(pattern.participants) > 5:
                strategy["recommendations"].append(
                    f"事件类型 '{pattern.pattern_type}' 参与者过多，建议简化协作流程"
                )
            
            # 分析时间间隔
            if pattern.average_interval < 1.0:  # 平均间隔小于1秒
                strategy["efficiency_improvements"].append(
                    f"事件类型 '{pattern.pattern_type}' 间隔过短，建议批量处理"
                )
        
        return strategy
    
    def get_agent_collaboration_summary(self, agent_id: str) -> Dict[str, Any]:
        """
        获取智能体协作摘要
        
        Args:
            agent_id: 智能体ID
            
        Returns:
            Dict[str, Any]: 协作摘要
        """
        if agent_id not in self.agent_memories:
            return {"error": "智能体不存在"}
        
        memories = self.agent_memories[agent_id]
        
        # 统计事件类型
        event_type_counts = {}
        for memory in memories:
            event_type = memory["event_type"]
            if event_type not in event_type_counts:
                event_type_counts[event_type] = 0
            event_type_counts[event_type] += 1
        
        # 计算活跃度
        if memories:
            first_event = min(memories, key=lambda x: x["timestamp"])
            last_event = max(memories, key=lambda x: x["timestamp"])
            total_duration = (last_event["timestamp"] - first_event["timestamp"]).total_seconds()
            activity_level = len(memories) / max(1, total_duration / 3600)  # 每小时事件数
        else:
            activity_level = 0
        
        return {
            "agent_id": agent_id,
            "total_events": len(memories),
            "event_type_distribution": event_type_counts,
            "activity_level": activity_level,
            "first_collaboration": memories[0]["timestamp"] if memories else None,
            "last_collaboration": memories[-1]["timestamp"] if memories else None,
            "recent_events": memories[-10:] if len(memories) > 10 else memories
        }
    
    def search_collaboration_events(
        self, 
        query: str, 
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        event_types: Optional[List[str]] = None,
        agent_ids: Optional[List[str]] = None
    ) -> List[CollaborationEvent]:
        """
        搜索协作事件
        
        Args:
            query: 搜索查询
            start_time: 开始时间
            end_time: 结束时间
            event_types: 事件类型列表
            agent_ids: 智能体ID列表
            
        Returns:
            List[CollaborationEvent]: 匹配的事件列表
        """
        results = []
        
        for event in self.events:
            # 时间过滤
            if start_time and event.timestamp < start_time:
                continue
            if end_time and event.timestamp > end_time:
                continue
            
            # 事件类型过滤
            if event_types and event.event_type not in event_types:
                continue
            
            # 智能体过滤
            if agent_ids:
                if (event.source_agent_id not in agent_ids and 
                    event.target_agent_id not in agent_ids):
                    continue
            
            # 查询内容过滤
            if query:
                query_lower = query.lower()
                if (query_lower in event.event_type.lower() or
                    query_lower in str(event.data).lower()):
                    results.append(event)
            else:
                results.append(event)
        
        # 按时间排序
        results.sort(key=lambda x: x.timestamp)
        
        return results
    
    def export_collaboration_data(self, format: str = "json") -> str:
        """
        导出协作数据
        
        Args:
            format: 导出格式
            
        Returns:
            str: 导出的数据
        """
        data = {
            "events": [event.dict() for event in self.events],
            "patterns": [pattern.dict() for pattern in self.patterns],
            "agent_memories": self.agent_memories,
            "export_time": datetime.now().isoformat(),
            "total_events": len(self.events),
            "total_patterns": len(self.patterns),
            "total_agents": len(self.agent_memories)
        }
        
        if format.lower() == "json":
            return json.dumps(data, indent=2, default=str)
        else:
            raise ValueError(f"不支持的导出格式：{format}")
    
    def clear_old_events(self, days: int = 30) -> int:
        """
        清理旧事件
        
        Args:
            days: 保留天数
            
        Returns:
            int: 清理的事件数量
        """
        cutoff_time = datetime.now() - timedelta(days=days)
        
        old_events = [event for event in self.events if event.timestamp < cutoff_time]
        
        # 从事件列表中移除
        self.events = [event for event in self.events if event.timestamp >= cutoff_time]
        
        # 从智能体记忆中移除
        for agent_id, memories in self.agent_memories.items():
            self.agent_memories[agent_id] = [
                memory for memory in memories 
                if memory["timestamp"] >= cutoff_time
            ]
        
        return len(old_events)
    
    def get_memory_statistics(self) -> Dict[str, Any]:
        """
        获取记忆统计信息
        
        Returns:
            Dict[str, Any]: 统计信息
        """
        total_events = len(self.events)
        total_agents = len(self.agent_memories)
        total_patterns = len(self.patterns)
        
        # 事件类型统计
        event_type_counts = {}
        for event in self.events:
            if event.event_type not in event_type_counts:
                event_type_counts[event.event_type] = 0
            event_type_counts[event.event_type] += 1
        
        # 时间分布统计
        if self.events:
            first_event = min(self.events, key=lambda x: x.timestamp)
            last_event = max(self.events, key=lambda x: x.timestamp)
            time_span = (last_event.timestamp - first_event.timestamp).total_seconds()
        else:
            time_span = 0
        
        return {
            "total_events": total_events,
            "total_agents": total_agents,
            "total_patterns": total_patterns,
            "event_type_distribution": event_type_counts,
            "time_span_seconds": time_span,
            "events_per_hour": total_events / max(1, time_span / 3600),
            "average_events_per_agent": total_events / max(1, total_agents)
        } 