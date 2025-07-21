"""
AgenticX M8.5: 协作管理器

负责创建、监控和优化协作模式。
"""

import time
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from ..core.agent import Agent
from .base import BaseCollaborationPattern, CollaborationResult, CollaborationState
from .config import CollaborationConfig, CollaborationManagerConfig
from .enums import CollaborationMode, CollaborationStatus
from .patterns import (
    MasterSlavePattern, ReflectionPattern, DebatePattern, GroupChatPattern, ParallelPattern, NestedPattern, DynamicPattern, AsyncPattern
    # 其他模式将在后续版本中实现
    # DebatePattern, GroupChatPattern, ParallelPattern,
    # NestedPattern, DynamicPattern, AsyncPattern
)


class CollaborationManager:
    """协作管理器"""
    
    def __init__(self, config: CollaborationManagerConfig):
        """
        初始化协作管理器
        
        Args:
            config: 管理器配置
        """
        self.config = config
        self.active_collaborations: Dict[str, BaseCollaborationPattern] = {}
        self.collaboration_history: List[Dict[str, Any]] = []
        self.metrics_collector = None  # 可以集成指标收集器
        
    def create_collaboration(
        self, 
        pattern: CollaborationMode, 
        agents: List[Agent],
        **kwargs
    ) -> BaseCollaborationPattern:
        """
        创建协作模式
        
        Args:
            pattern: 协作模式
            agents: 智能体列表
            **kwargs: 额外参数
            
        Returns:
            BaseCollaborationPattern: 创建的协作模式
        """
        if len(self.active_collaborations) >= self.config.max_concurrent_collaborations:
            raise ValueError(f"已达到最大并发协作数限制：{self.config.max_concurrent_collaborations}")
        
        # 根据模式创建对应的协作实例
        collaboration = self._create_pattern_instance(pattern, agents, **kwargs)
        
        # 注册到活跃协作列表
        self.active_collaborations[collaboration.collaboration_id] = collaboration
        
        # 记录创建历史
        self.collaboration_history.append({
            "collaboration_id": collaboration.collaboration_id,
            "pattern": pattern.value,
            "agents": [agent.id for agent in agents],
            "created_at": datetime.now(),
            "status": "created"
        })
        
        return collaboration
    
    def _create_pattern_instance(
        self, 
        pattern: CollaborationMode, 
        agents: List[Agent],
        **kwargs
    ) -> BaseCollaborationPattern:
        """创建模式实例"""
        # 模式类映射
        pattern_classes = {
            CollaborationMode.MASTER_SLAVE: MasterSlavePattern,
            CollaborationMode.REFLECTION: ReflectionPattern,
            CollaborationMode.DEBATE: DebatePattern,
            CollaborationMode.GROUP_CHAT: GroupChatPattern,
            CollaborationMode.PARALLEL: ParallelPattern,
            CollaborationMode.NESTED: NestedPattern,
            CollaborationMode.DYNAMIC: DynamicPattern,
            CollaborationMode.ASYNC: AsyncPattern,
        }
        
        pattern_class = pattern_classes.get(pattern)
        if not pattern_class:
            raise ValueError(f"不支持的协作模式：{pattern}")
        
        # 根据模式类型处理智能体参数
        if pattern == CollaborationMode.MASTER_SLAVE:
            if len(agents) < 2:
                raise ValueError("主从模式需要至少2个智能体（1个主控 + 1个从属）")
            master_agent = agents[0]
            slave_agents = agents[1:]
            return pattern_class(master_agent, slave_agents, **kwargs)
        
        elif pattern == CollaborationMode.REFLECTION:
            if len(agents) != 2:
                raise ValueError("反思模式需要恰好2个智能体（1个执行 + 1个审查）")
            executor_agent = agents[0]
            reviewer_agent = agents[1]
            return pattern_class(executor_agent, reviewer_agent, **kwargs)
        
        else:
            # 对于其他模式，暂时抛出错误
            raise ValueError(f"协作模式 {pattern} 尚未实现")
    
    def monitor_collaboration(self, collaboration_id: str) -> Dict[str, Any]:
        """
        监控协作状态
        
        Args:
            collaboration_id: 协作ID
            
        Returns:
            Dict[str, Any]: 协作状态信息
        """
        if collaboration_id not in self.active_collaborations:
            return {"error": "协作不存在"}
        
        collaboration = self.active_collaborations[collaboration_id]
        state = collaboration.get_collaboration_state()
        
        return {
            "collaboration_id": collaboration_id,
            "pattern": collaboration.config.mode.value,
            "status": state.status.value,
            "current_iteration": state.current_iteration,
            "agent_states": state.agent_states,
            "start_time": state.start_time,
            "last_update": state.last_update,
            "message_count": len(state.messages),
            "execution_time": (state.last_update - state.start_time).total_seconds()
        }
    
    def get_all_collaborations(self) -> List[Dict[str, Any]]:
        """
        获取所有活跃协作
        
        Returns:
            List[Dict[str, Any]]: 协作列表
        """
        collaborations = []
        for collaboration_id, collaboration in self.active_collaborations.items():
            status_info = self.monitor_collaboration(collaboration_id)
            collaborations.append(status_info)
        
        return collaborations
    
    def stop_collaboration(self, collaboration_id: str) -> bool:
        """
        停止协作
        
        Args:
            collaboration_id: 协作ID
            
        Returns:
            bool: 是否成功停止
        """
        if collaboration_id not in self.active_collaborations:
            return False
        
        collaboration = self.active_collaborations[collaboration_id]
        collaboration.update_state(status=CollaborationStatus.CANCELLED)
        
        # 从活跃列表中移除
        del self.active_collaborations[collaboration_id]
        
        # 更新历史记录
        for record in self.collaboration_history:
            if record["collaboration_id"] == collaboration_id:
                record["status"] = "cancelled"
                record["ended_at"] = datetime.now()
                break
        
        return True
    
    def optimize_collaboration(self, collaboration_id: str) -> Dict[str, Any]:
        """
        优化协作过程
        
        Args:
            collaboration_id: 协作ID
            
        Returns:
            Dict[str, Any]: 优化计划
        """
        if collaboration_id not in self.active_collaborations:
            return {"error": "协作不存在"}
        
        collaboration = self.active_collaborations[collaboration_id]
        state = collaboration.get_collaboration_state()
        
        # 简单的优化建议
        optimization_plan = {
            "collaboration_id": collaboration_id,
            "current_status": state.status.value,
            "suggestions": []
        }
        
        # 检查执行时间
        execution_time = (state.last_update - state.start_time).total_seconds()
        if execution_time > self.config.default_timeout:
            optimization_plan["suggestions"].append("执行时间过长，建议优化算法或增加资源")
        
        # 检查迭代次数
        if state.current_iteration > collaboration.config.max_iterations * 0.8:
            optimization_plan["suggestions"].append("迭代次数接近上限，建议检查收敛条件")
        
        # 检查智能体状态
        failed_agents = [agent_id for agent_id, agent_state in state.agent_states.items() 
                        if agent_state.get("status") == "failed"]
        if failed_agents:
            optimization_plan["suggestions"].append(f"发现失败的智能体：{failed_agents}，建议重新分配任务")
        
        # 检查消息数量
        if len(state.messages) > 100:
            optimization_plan["suggestions"].append("消息数量过多，建议优化通信策略")
        
        return optimization_plan
    
    def resolve_collaboration_conflicts(self, conflicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        解决协作冲突
        
        Args:
            conflicts: 冲突列表
            
        Returns:
            List[Dict[str, Any]]: 解决方案列表
        """
        resolutions = []
        
        for conflict in conflicts:
            resolution = self._resolve_single_conflict(conflict)
            resolutions.append(resolution)
        
        return resolutions
    
    def _resolve_single_conflict(self, conflict: Dict[str, Any]) -> Dict[str, Any]:
        """解决单个冲突"""
        conflict_type = conflict.get("type", "unknown")
        involved_agents = conflict.get("involved_agents", [])
        
        resolution = {
            "conflict_id": conflict.get("conflict_id", str(uuid.uuid4())),
            "conflict_type": conflict_type,
            "involved_agents": involved_agents,
            "resolution_strategy": self.config.conflict_resolution_strategy.value,
            "solution": "",
            "resolved_at": datetime.now()
        }
        
        # 根据冲突类型选择解决策略
        if conflict_type == "resource_conflict":
            resolution["solution"] = "采用轮询分配策略"
        elif conflict_type == "decision_conflict":
            resolution["solution"] = "采用多数投票机制"
        elif conflict_type == "communication_conflict":
            resolution["solution"] = "采用消息队列机制"
        else:
            resolution["solution"] = "采用默认协商机制"
        
        return resolution
    
    def get_collaboration_statistics(self) -> Dict[str, Any]:
        """
        获取协作统计信息
        
        Returns:
            Dict[str, Any]: 统计信息
        """
        total_collaborations = len(self.collaboration_history)
        active_collaborations = len(self.active_collaborations)
        
        # 按模式统计
        pattern_stats = {}
        for record in self.collaboration_history:
            pattern = record["pattern"]
            if pattern not in pattern_stats:
                pattern_stats[pattern] = 0
            pattern_stats[pattern] += 1
        
        # 按状态统计
        status_stats = {}
        for record in self.collaboration_history:
            status = record.get("status", "unknown")
            if status not in status_stats:
                status_stats[status] = 0
            status_stats[status] += 1
        
        return {
            "total_collaborations": total_collaborations,
            "active_collaborations": active_collaborations,
            "completed_collaborations": status_stats.get("completed", 0),
            "failed_collaborations": status_stats.get("failed", 0),
            "cancelled_collaborations": status_stats.get("cancelled", 0),
            "pattern_distribution": pattern_stats,
            "status_distribution": status_stats,
            "average_execution_time": self._calculate_average_execution_time(),
            "success_rate": self._calculate_success_rate()
        }
    
    def _calculate_average_execution_time(self) -> float:
        """计算平均执行时间"""
        completed_records = [r for r in self.collaboration_history if r.get("status") == "completed"]
        if not completed_records:
            return 0.0
        
        total_time = 0.0
        for record in completed_records:
            if "created_at" in record and "ended_at" in record:
                duration = (record["ended_at"] - record["created_at"]).total_seconds()
                total_time += duration
        
        return total_time / len(completed_records)
    
    def _calculate_success_rate(self) -> float:
        """计算成功率"""
        total = len(self.collaboration_history)
        if total == 0:
            return 0.0
        
        completed = len([r for r in self.collaboration_history if r.get("status") == "completed"])
        return completed / total
    
    def cleanup_completed_collaborations(self) -> int:
        """
        清理已完成的协作
        
        Returns:
            int: 清理的协作数量
        """
        to_remove = []
        
        for collaboration_id, collaboration in self.active_collaborations.items():
            state = collaboration.get_collaboration_state()
            if state.status in [CollaborationStatus.COMPLETED, CollaborationStatus.FAILED, CollaborationStatus.CANCELLED]:
                to_remove.append(collaboration_id)
        
        for collaboration_id in to_remove:
            del self.active_collaborations[collaboration_id]
        
        return len(to_remove) 