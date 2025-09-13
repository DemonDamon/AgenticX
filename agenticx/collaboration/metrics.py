"""
AgenticX M8.5: 协作指标收集器

负责追踪协作效率和智能体贡献。
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta, UTC
from pydantic import BaseModel, Field

from .base import CollaborationResult, TaskResult


class EfficiencyMetrics(BaseModel):
    """效率指标模型"""
    collaboration_id: str = Field(description="协作ID")
    total_execution_time: float = Field(description="总执行时间（秒）")
    average_iteration_time: float = Field(description="平均迭代时间（秒）")
    success_rate: float = Field(description="成功率")
    throughput: float = Field(description="吞吐量（任务/小时）")
    resource_utilization: float = Field(description="资源利用率")
    communication_overhead: float = Field(description="通信开销")
    convergence_speed: float = Field(description="收敛速度")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class ContributionMetrics(BaseModel):
    """贡献指标模型"""
    agent_id: str = Field(description="智能体ID")
    collaboration_id: str = Field(description="协作ID")
    tasks_completed: int = Field(description="完成任务数")
    tasks_failed: int = Field(description="失败任务数")
    total_execution_time: float = Field(description="总执行时间（秒）")
    average_task_time: float = Field(description="平均任务时间（秒）")
    success_rate: float = Field(description="成功率")
    contribution_score: float = Field(description="贡献分数")
    role_performance: Dict[str, float] = Field(default_factory=dict, description="角色表现")
    communication_volume: int = Field(description="通信量")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class CommunicationPatterns(BaseModel):
    """通信模式模型"""
    collaboration_id: str = Field(description="协作ID")
    total_messages: int = Field(description="总消息数")
    message_types: Dict[str, int] = Field(default_factory=dict, description="消息类型分布")
    average_response_time: float = Field(description="平均响应时间（秒）")
    communication_graph: Dict[str, List[str]] = Field(default_factory=dict, description="通信图")
    bottleneck_agents: List[str] = Field(default_factory=list, description="瓶颈智能体")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class CollaborationReport(BaseModel):
    """协作报告模型"""
    collaboration_id: str = Field(description="协作ID")
    pattern_type: str = Field(description="协作模式类型")
    start_time: datetime = Field(description="开始时间")
    end_time: datetime = Field(description="结束时间")
    duration: float = Field(description="持续时间（秒）")
    efficiency_metrics: EfficiencyMetrics = Field(description="效率指标")
    agent_contributions: List[ContributionMetrics] = Field(description="智能体贡献")
    communication_patterns: CommunicationPatterns = Field(description="通信模式")
    recommendations: List[str] = Field(default_factory=list, description="改进建议")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class CollaborationMetrics:
    """协作指标收集器"""
    
    def __init__(self, metrics_config: Dict[str, Any]):
        """
        初始化指标收集器
        
        Args:
            metrics_config: 指标配置
        """
        self.config = metrics_config
        self.efficiency_metrics: Dict[str, EfficiencyMetrics] = {}
        self.contribution_metrics: Dict[str, List[ContributionMetrics]] = {}
        self.communication_patterns: Dict[str, CommunicationPatterns] = {}
        self.reports: Dict[str, CollaborationReport] = {}
    
    def track_collaboration_efficiency(self, collaboration_id: str) -> EfficiencyMetrics:
        """
        追踪协作效率
        
        Args:
            collaboration_id: 协作ID
            
        Returns:
            EfficiencyMetrics: 效率指标
        """
        # 这里应该从实际的协作数据中计算指标
        # 目前返回模拟数据
        metrics = EfficiencyMetrics(
            collaboration_id=collaboration_id,
            total_execution_time=120.0,
            average_iteration_time=30.0,
            success_rate=0.85,
            throughput=12.0,
            resource_utilization=0.75,
            communication_overhead=0.15,
            convergence_speed=0.8
        )
        
        self.efficiency_metrics[collaboration_id] = metrics
        return metrics
    
    def measure_agent_contribution(self, agent_id: str) -> ContributionMetrics:
        """
        测量智能体贡献
        
        Args:
            agent_id: 智能体ID
            
        Returns:
            ContributionMetrics: 贡献指标
        """
        # 这里应该从实际的协作数据中计算指标
        # 目前返回模拟数据
        metrics = ContributionMetrics(
            agent_id=agent_id,
            collaboration_id="collab_123",
            tasks_completed=5,
            tasks_failed=1,
            total_execution_time=60.0,
            average_task_time=12.0,
            success_rate=0.83,
            contribution_score=0.75,
            role_performance={"executor": 0.8, "reviewer": 0.7},
            communication_volume=25
        )
        
        if agent_id not in self.contribution_metrics:
            self.contribution_metrics[agent_id] = []
        self.contribution_metrics[agent_id].append(metrics)
        
        return metrics
    
    def analyze_communication_patterns(self) -> CommunicationPatterns:
        """
        分析通信模式
        
        Returns:
            CommunicationPatterns: 通信模式
        """
        # 这里应该从实际的通信数据中分析模式
        # 目前返回模拟数据
        patterns = CommunicationPatterns(
            collaboration_id="collab_123",
            total_messages=150,
            message_types={"task": 50, "result": 40, "coordination": 30, "feedback": 30},
            average_response_time=2.5,
            communication_graph={
                "agent_1": ["agent_2", "agent_3"],
                "agent_2": ["agent_1", "agent_3"],
                "agent_3": ["agent_1", "agent_2"]
            },
            bottleneck_agents=["agent_2"]
        )
        
        self.communication_patterns["collab_123"] = patterns
        return patterns
    
    def generate_collaboration_report(self, collaboration_id: str) -> CollaborationReport:
        """
        生成协作报告
        
        Args:
            collaboration_id: 协作ID
            
        Returns:
            CollaborationReport: 协作报告
        """
        # 收集各种指标
        efficiency = self.track_collaboration_efficiency(collaboration_id)
        communication = self.analyze_communication_patterns()
        
        # 收集智能体贡献
        agent_contributions = []
        for agent_id in self.contribution_metrics:
            contribution = self.measure_agent_contribution(agent_id)
            agent_contributions.append(contribution)
        
        # 生成改进建议
        recommendations = self._generate_recommendations(efficiency, communication)
        
        report = CollaborationReport(
            collaboration_id=collaboration_id,
            pattern_type="master_slave",
            start_time=datetime.now() - timedelta(hours=1),
            end_time=datetime.now(),
            duration=3600.0,
            efficiency_metrics=efficiency,
            agent_contributions=agent_contributions,
            communication_patterns=communication,
            recommendations=recommendations
        )
        
        self.reports[collaboration_id] = report
        return report
    
    def _generate_recommendations(
        self, 
        efficiency: EfficiencyMetrics, 
        communication: CommunicationPatterns
    ) -> List[str]:
        """生成改进建议"""
        recommendations = []
        
        # 基于效率指标的建议
        if efficiency.success_rate < 0.8:
            recommendations.append("成功率较低，建议优化任务分配策略")
        
        if efficiency.communication_overhead > 0.2:
            recommendations.append("通信开销过高，建议简化通信流程")
        
        if efficiency.convergence_speed < 0.7:
            recommendations.append("收敛速度较慢，建议调整收敛条件")
        
        # 基于通信模式的建议
        if communication.bottleneck_agents:
            recommendations.append(f"发现瓶颈智能体：{communication.bottleneck_agents}，建议优化负载均衡")
        
        if communication.average_response_time > 5.0:
            recommendations.append("平均响应时间过长，建议优化智能体响应机制")
        
        return recommendations
    
    def get_performance_summary(self, time_range: Optional[timedelta] = None) -> Dict[str, Any]:
        """
        获取性能摘要
        
        Args:
            time_range: 时间范围
            
        Returns:
            Dict[str, Any]: 性能摘要
        """
        cutoff_time = datetime.now() - time_range if time_range else datetime.min
        
        # 过滤时间范围内的指标
        recent_efficiency = {
            k: v for k, v in self.efficiency_metrics.items() 
            if v.timestamp >= cutoff_time
        }
        
        recent_contributions = []
        for agent_contributions in self.contribution_metrics.values():
            recent_contributions.extend([
                c for c in agent_contributions if c.timestamp >= cutoff_time
            ])
        
        # 计算汇总统计
        if recent_efficiency:
            avg_success_rate = sum(m.success_rate for m in recent_efficiency.values()) / len(recent_efficiency)
            avg_execution_time = sum(m.total_execution_time for m in recent_efficiency.values()) / len(recent_efficiency)
        else:
            avg_success_rate = 0.0
            avg_execution_time = 0.0
        
        if recent_contributions:
            avg_contribution_score = sum(c.contribution_score for c in recent_contributions) / len(recent_contributions)
        else:
            avg_contribution_score = 0.0
        
        return {
            "total_collaborations": len(recent_efficiency),
            "average_success_rate": avg_success_rate,
            "average_execution_time": avg_execution_time,
            "average_contribution_score": avg_contribution_score,
            "total_agents": len(set(c.agent_id for c in recent_contributions)),
            "time_range": time_range.total_seconds() if time_range else None
        }
    
    def export_metrics(self, format: str = "json") -> str:
        """
        导出指标数据
        
        Args:
            format: 导出格式
            
        Returns:
            str: 导出的数据
        """
        data = {
            "efficiency_metrics": {k: v.dict() for k, v in self.efficiency_metrics.items()},
            "contribution_metrics": {
                agent_id: [c.dict() for c in contributions]
                for agent_id, contributions in self.contribution_metrics.items()
            },
            "communication_patterns": {k: v.dict() for k, v in self.communication_patterns.items()},
            "reports": {k: v.dict() for k, v in self.reports.items()},
            "export_time": datetime.now().isoformat()
        }
        
        if format.lower() == "json":
            import json
            return json.dumps(data, indent=2, default=str)
        else:
            raise ValueError(f"不支持的导出格式：{format}")
    
    def clear_old_metrics(self, days: int = 30) -> int:
        """
        清理旧指标
        
        Args:
            days: 保留天数
            
        Returns:
            int: 清理的指标数量
        """
        cutoff_time = datetime.now() - timedelta(days=days)
        
        # 清理效率指标
        old_efficiency = [k for k, v in self.efficiency_metrics.items() if v.timestamp < cutoff_time]
        for k in old_efficiency:
            del self.efficiency_metrics[k]
        
        # 清理贡献指标
        old_contributions = 0
        for agent_id, contributions in self.contribution_metrics.items():
            old_count = len([c for c in contributions if c.timestamp < cutoff_time])
            self.contribution_metrics[agent_id] = [
                c for c in contributions if c.timestamp >= cutoff_time
            ]
            old_contributions += old_count
        
        # 清理通信模式
        old_communication = [k for k, v in self.communication_patterns.items() if v.timestamp < cutoff_time]
        for k in old_communication:
            del self.communication_patterns[k]
        
        # 清理报告
        old_reports = [k for k, v in self.reports.items() if v.timestamp < cutoff_time]
        for k in old_reports:
            del self.reports[k]
        
        return len(old_efficiency) + old_contributions + len(old_communication) + len(old_reports) 