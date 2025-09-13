"""
AgenticX M9: 轨迹分析系统 (Trajectory Analysis System)

本模块实现了智能轨迹分析功能，包括轨迹摘要、失败分析、瓶颈检测和性能分析。
通过对执行轨迹的深度分析，提供优化建议和洞察。
"""

import statistics
from typing import Dict, Any, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC
from enum import Enum
from collections import defaultdict, Counter
import json
import logging

from .trajectory import ExecutionTrajectory, TrajectoryStep, StepType, StepStatus
from ..llms.base import BaseLLMProvider
from ..llms.response import LLMResponse


logger = logging.getLogger(__name__)


class AnalysisType(Enum):
    """分析类型"""
    PERFORMANCE = "performance"
    FAILURE = "failure"
    BOTTLENECK = "bottleneck"
    OPTIMIZATION = "optimization"
    SUMMARY = "summary"


class SeverityLevel(Enum):
    """严重程度级别"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class AnalysisInsight:
    """分析洞察"""
    insight_id: str
    title: str
    description: str
    severity: SeverityLevel
    analysis_type: AnalysisType
    confidence: float  # 0-1之间的置信度
    recommendations: List[str] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)
    affected_steps: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "insight_id": self.insight_id,
            "title": self.title,
            "description": self.description,
            "severity": self.severity.value,
            "analysis_type": self.analysis_type.value,
            "confidence": self.confidence,
            "recommendations": self.recommendations,
            "metrics": self.metrics,
            "affected_steps": self.affected_steps
        }


@dataclass
class ExecutionInsights:
    """执行洞察集合"""
    trajectory_id: str
    analysis_timestamp: datetime
    insights: List[AnalysisInsight] = field(default_factory=list)
    overall_score: float = 0.0
    summary: str = ""
    
    def add_insight(self, insight: AnalysisInsight):
        """添加洞察"""
        self.insights.append(insight)
    
    def get_insights_by_type(self, analysis_type: AnalysisType) -> List[AnalysisInsight]:
        """根据类型获取洞察"""
        return [insight for insight in self.insights if insight.analysis_type == analysis_type]
    
    def get_insights_by_severity(self, severity: SeverityLevel) -> List[AnalysisInsight]:
        """根据严重程度获取洞察"""
        return [insight for insight in self.insights if insight.severity == severity]
    
    def get_critical_insights(self) -> List[AnalysisInsight]:
        """获取严重洞察"""
        return self.get_insights_by_severity(SeverityLevel.CRITICAL)
    
    def get_high_priority_insights(self) -> List[AnalysisInsight]:
        """获取高优先级洞察"""
        return [insight for insight in self.insights 
                if insight.severity in [SeverityLevel.HIGH, SeverityLevel.CRITICAL]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "trajectory_id": self.trajectory_id,
            "analysis_timestamp": self.analysis_timestamp.isoformat(),
            "insights": [insight.to_dict() for insight in self.insights],
            "overall_score": self.overall_score,
            "summary": self.summary,
            "insight_counts": {
                "total": len(self.insights),
                "critical": len(self.get_insights_by_severity(SeverityLevel.CRITICAL)),
                "high": len(self.get_insights_by_severity(SeverityLevel.HIGH)),
                "medium": len(self.get_insights_by_severity(SeverityLevel.MEDIUM)),
                "low": len(self.get_insights_by_severity(SeverityLevel.LOW))
            }
        }


@dataclass
class FailureReport:
    """失败报告"""
    trajectory_id: str
    failure_type: str
    failure_message: str
    failure_timestamp: datetime
    failure_step: Optional[TrajectoryStep] = None
    root_cause: Optional[str] = None
    contributing_factors: List[str] = field(default_factory=list)
    recovery_suggestions: List[str] = field(default_factory=list)
    similar_failures: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "trajectory_id": self.trajectory_id,
            "failure_type": self.failure_type,
            "failure_message": self.failure_message,
            "failure_timestamp": self.failure_timestamp.isoformat(),
            "failure_step": self.failure_step.to_dict() if self.failure_step else None,
            "root_cause": self.root_cause,
            "contributing_factors": self.contributing_factors,
            "recovery_suggestions": self.recovery_suggestions,
            "similar_failures": self.similar_failures
        }


@dataclass
class PerformanceReport:
    """性能报告"""
    trajectory_id: str
    total_duration: float
    step_count: int
    success_rate: float
    average_step_duration: float
    slowest_steps: List[Tuple[str, float]] = field(default_factory=list)
    fastest_steps: List[Tuple[str, float]] = field(default_factory=list)
    resource_usage: Dict[str, Any] = field(default_factory=dict)
    bottlenecks: List[str] = field(default_factory=list)
    optimization_opportunities: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "trajectory_id": self.trajectory_id,
            "total_duration": self.total_duration,
            "step_count": self.step_count,
            "success_rate": self.success_rate,
            "average_step_duration": self.average_step_duration,
            "slowest_steps": self.slowest_steps,
            "fastest_steps": self.fastest_steps,
            "resource_usage": self.resource_usage,
            "bottlenecks": self.bottlenecks,
            "optimization_opportunities": self.optimization_opportunities
        }


class TrajectorySummarizer:
    """
    轨迹摘要器
    
    生成执行轨迹的智能摘要，提供高层次的执行概览。
    """
    
    def __init__(self, llm_provider: Optional[BaseLLMProvider] = None):
        self.llm_provider = llm_provider
    
    def summarize(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """生成轨迹摘要"""
        summary = {
            "trajectory_id": trajectory.trajectory_id,
            "basic_info": self._get_basic_info(trajectory),
            "execution_flow": self._get_execution_flow(trajectory),
            "performance_summary": self._get_performance_summary(trajectory),
            "resource_summary": self._get_resource_summary(trajectory),
            "error_summary": self._get_error_summary(trajectory),
            "key_insights": self._get_key_insights(trajectory)
        }
        
        # 如果有LLM提供者，生成智能摘要
        if self.llm_provider:
            summary["ai_summary"] = self._generate_ai_summary(trajectory, summary)
        
        return summary
    
    def _get_basic_info(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """获取基本信息"""
        return {
            "start_time": trajectory.metadata.start_time.isoformat(),
            "end_time": trajectory.metadata.end_time.isoformat() if trajectory.metadata.end_time else None,
            "duration": trajectory.metadata.total_duration,
            "agent_id": trajectory.metadata.agent_id,
            "task_id": trajectory.metadata.task_id,
            "workflow_id": trajectory.metadata.workflow_id,
            "final_status": trajectory.metadata.final_status.value if trajectory.metadata.final_status else None,
            "total_steps": trajectory.metadata.total_steps,
            "successful_steps": trajectory.metadata.successful_steps,
            "failed_steps": trajectory.metadata.failed_steps,
            "success_rate": trajectory.metadata.successful_steps / max(trajectory.metadata.total_steps, 1)
        }
    
    def _get_execution_flow(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """获取执行流程"""
        step_sequence = []
        step_types = []
        
        for step in trajectory.steps:
            step_sequence.append({
                "step_type": step.step_type.value,
                "status": step.status.value,
                "duration": step.duration,
                "timestamp": step.timestamp.isoformat()
            })
            step_types.append(step.step_type.value)
        
        # 统计步骤类型
        step_type_counts = Counter(step_types)
        
        return {
            "step_sequence": step_sequence,
            "step_type_distribution": dict(step_type_counts),
            "total_tools_used": len(trajectory.get_tool_calls()),
            "total_llm_calls": len(trajectory.get_llm_calls()),
            "total_errors": len(trajectory.get_errors())
        }
    
    def _get_performance_summary(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """获取性能摘要"""
        durations = [step.duration for step in trajectory.steps if step.duration is not None]
        
        if not durations:
            return {"message": "No duration data available"}
        
        return {
            "total_duration": trajectory.metadata.total_duration,
            "average_step_duration": statistics.mean(durations),
            "median_step_duration": statistics.median(durations),
            "min_step_duration": min(durations),
            "max_step_duration": max(durations),
            "step_duration_std": statistics.stdev(durations) if len(durations) > 1 else 0,
            "slowest_steps": self._get_slowest_steps(trajectory, 5),
            "fastest_steps": self._get_fastest_steps(trajectory, 5)
        }
    
    def _get_resource_summary(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """获取资源使用摘要"""
        return {
            "total_tokens": trajectory.metadata.total_tokens,
            "total_cost": trajectory.metadata.total_cost,
            "average_cost_per_call": trajectory.metadata.total_cost / max(len(trajectory.get_llm_calls()), 1),
            "cost_breakdown": self._get_cost_breakdown(trajectory),
            "token_breakdown": self._get_token_breakdown(trajectory)
        }
    
    def _get_error_summary(self, trajectory: ExecutionTrajectory) -> Dict[str, Any]:
        """获取错误摘要"""
        errors = trajectory.get_errors()
        
        if not errors:
            return {"message": "No errors occurred"}
        
        # 修复：添加对error_data为None的检查
        error_types = [
            error.error_data.get("error_type", "unknown") if error.error_data else "unknown" 
            for error in errors
        ]
        error_type_counts = Counter(error_types)
        
        return {
            "total_errors": len(errors),
            "error_types": dict(error_type_counts),
            "error_rate": len(errors) / trajectory.metadata.total_steps,
            "recoverable_errors": len([
                e for e in errors 
                if e.error_data and e.error_data.get("recoverable", True)
            ]),
            "critical_errors": len([
                e for e in errors 
                if e.error_data and not e.error_data.get("recoverable", True)
            ])
        }
    
    def _get_key_insights(self, trajectory: ExecutionTrajectory) -> List[str]:
        """获取关键洞察"""
        insights = []
        
        # 性能洞察
        if trajectory.metadata.total_duration and trajectory.metadata.total_duration > 60:
            insights.append(f"执行时间较长：{trajectory.metadata.total_duration:.2f}秒")
        
        # 成功率洞察
        success_rate = trajectory.metadata.successful_steps / max(trajectory.metadata.total_steps, 1)
        if success_rate < 0.8:
            insights.append(f"成功率较低：{success_rate:.1%}")
        
        # 错误洞察
        errors = trajectory.get_errors()
        if errors:
            insights.append(f"发生了{len(errors)}个错误")
        
        # 成本洞察
        if trajectory.metadata.total_cost > 1.0:
            insights.append(f"成本较高：${trajectory.metadata.total_cost:.2f}")
        
        # 工具使用洞察
        tool_calls = trajectory.get_tool_calls()
        if len(tool_calls) > 10:
            insights.append(f"工具调用频繁：{len(tool_calls)}次")
        
        return insights
    
    def _get_slowest_steps(self, trajectory: ExecutionTrajectory, count: int) -> List[Tuple[str, float]]:
        """获取最慢的步骤"""
        steps_with_duration = [
            (f"{step.step_type.value}:{step.step_id[:8]}", step.duration)
            for step in trajectory.steps
            if step.duration is not None
        ]
        
        steps_with_duration.sort(key=lambda x: x[1], reverse=True)
        return steps_with_duration[:count]
    
    def _get_fastest_steps(self, trajectory: ExecutionTrajectory, count: int) -> List[Tuple[str, float]]:
        """获取最快的步骤"""
        steps_with_duration = [
            (f"{step.step_type.value}:{step.step_id[:8]}", step.duration)
            for step in trajectory.steps
            if step.duration is not None
        ]
        
        steps_with_duration.sort(key=lambda x: x[1])
        return steps_with_duration[:count]
    
    def _get_cost_breakdown(self, trajectory: ExecutionTrajectory) -> Dict[str, float]:
        """获取成本分解"""
        cost_breakdown = defaultdict(float)
        
        for step in trajectory.steps:
            if step.step_type == StepType.LLM_RESPONSE:
                model = step.input_data.get("model", "unknown")
                cost = step.output_data.get("cost", 0.0)
                cost_breakdown[model] += cost
        
        return dict(cost_breakdown)
    
    def _get_token_breakdown(self, trajectory: ExecutionTrajectory) -> Dict[str, int]:
        """获取令牌分解"""
        token_breakdown = defaultdict(int)
        
        for step in trajectory.steps:
            if step.step_type == StepType.LLM_RESPONSE:
                model = step.input_data.get("model", "unknown")
                token_usage = step.output_data.get("token_usage", {})
                tokens = token_usage.get("total_tokens", 0)
                token_breakdown[model] += tokens
        
        return dict(token_breakdown)
    
    def _generate_ai_summary(self, trajectory: ExecutionTrajectory, summary: Dict[str, Any]) -> str:
        """生成AI摘要"""
        if not self.llm_provider:
            return "AI摘要不可用：未配置LLM提供者"
        
        try:
            prompt = self._build_summary_prompt(trajectory, summary)
            response = self.llm_provider.invoke(prompt)
            return response.content
        except Exception as e:
            logger.error(f"生成AI摘要时发生错误: {e}")
            return f"AI摘要生成失败: {str(e)}"
    
    def _build_summary_prompt(self, trajectory: ExecutionTrajectory, summary: Dict[str, Any]) -> str:
        """构建摘要提示词"""
        return f"""
请基于以下执行轨迹数据生成一个简洁的中文摘要：

基本信息：
- 执行时间：{summary['basic_info']['duration']}秒
- 总步骤数：{summary['basic_info']['total_steps']}
- 成功率：{summary['basic_info']['success_rate']:.1%}

执行流程：
- 工具调用：{summary['execution_flow']['total_tools_used']}次
- LLM调用：{summary['execution_flow']['total_llm_calls']}次
- 错误次数：{summary['execution_flow']['total_errors']}次

资源使用：
- 总令牌：{summary['resource_summary']['total_tokens']}
- 总成本：${summary['resource_summary']['total_cost']:.2f}

请用1-2段话总结这次执行的主要情况和特点。
"""


class FailureAnalyzer:
    """
    失败分析器
    
    分析执行失败的原因，提供根因分析和恢复建议。
    """
    
    def __init__(self, llm_provider: Optional[BaseLLMProvider] = None):
        self.llm_provider = llm_provider
        self.failure_patterns = self._load_failure_patterns()
    
    def analyze_failure(self, trajectory: ExecutionTrajectory) -> Optional[FailureReport]:
        """分析失败"""
        failed_steps = trajectory.get_failed_steps()
        errors = trajectory.get_errors()
        
        if not failed_steps and not errors:
            return None  # 没有失败
        
        # 找到主要失败点
        primary_failure = self._identify_primary_failure(failed_steps, errors)
        
        if not primary_failure:
            return None
        
        # 创建失败报告
        report = FailureReport(
            trajectory_id=trajectory.trajectory_id,
            failure_type=self._classify_failure_type(primary_failure),
            failure_message=self._extract_failure_message(primary_failure),
            failure_timestamp=primary_failure.timestamp,
            failure_step=primary_failure
        )
        
        # 根因分析
        report.root_cause = self._analyze_root_cause(primary_failure, trajectory)
        
        # 贡献因素
        report.contributing_factors = self._find_contributing_factors(primary_failure, trajectory)
        
        # 恢复建议
        report.recovery_suggestions = self._generate_recovery_suggestions(primary_failure, trajectory)
        
        return report
    
    def _load_failure_patterns(self) -> Dict[str, Any]:
        """加载失败模式"""
        return {
            "tool_error": {
                "patterns": ["Tool", "tool", "function", "execute"],
                "common_causes": ["参数错误", "权限不足", "服务不可用", "超时"],
                "recovery_actions": ["检查参数", "验证权限", "重试", "使用替代工具"]
            },
            "llm_error": {
                "patterns": ["LLM", "model", "API", "rate", "quota"],
                "common_causes": ["API配额超限", "模型不可用", "网络问题", "请求格式错误"],
                "recovery_actions": ["等待配额重置", "切换模型", "检查网络", "修正请求格式"]
            },
            "validation_error": {
                "patterns": ["validation", "invalid", "required", "missing"],
                "common_causes": ["输入验证失败", "必填字段缺失", "格式不正确"],
                "recovery_actions": ["验证输入", "补充缺失字段", "修正格式"]
            },
            "timeout_error": {
                "patterns": ["timeout", "时间", "超时"],
                "common_causes": ["网络延迟", "服务响应慢", "超时设置过短"],
                "recovery_actions": ["增加超时时间", "检查网络", "优化请求"]
            }
        }
    
    def _identify_primary_failure(self, failed_steps: List[TrajectoryStep], errors: List[TrajectoryStep]) -> Optional[TrajectoryStep]:
        """识别主要失败点"""
        if errors:
            # 优先考虑错误步骤
            return errors[0]
        elif failed_steps:
            # 其次考虑失败步骤
            return failed_steps[0]
        return None
    
    def _classify_failure_type(self, failure_step: TrajectoryStep) -> str:
        """分类失败类型"""
        # 修复：添加对error_data为None的检查
        if failure_step.step_type == StepType.ERROR and failure_step.error_data:
            return failure_step.error_data.get("error_type", "unknown_error")
        elif failure_step.step_type == StepType.TOOL_CALL:
            return "tool_error"
        elif failure_step.step_type == StepType.LLM_CALL:
            return "llm_error"
        else:
            return "execution_error"
    
    def _extract_failure_message(self, failure_step: TrajectoryStep) -> str:
        """提取失败消息"""
        # 修复：添加对error_data为None的检查
        if failure_step.step_type == StepType.ERROR and failure_step.error_data:
            return failure_step.error_data.get("error_message", "Unknown error")
        elif failure_step.error_data:
            return failure_step.error_data.get("error", "Execution failed")
        else:
            return f"Step {failure_step.step_type.value} failed"
    
    def _analyze_root_cause(self, failure_step: TrajectoryStep, trajectory: ExecutionTrajectory) -> str:
        """分析根因"""
        failure_type = self._classify_failure_type(failure_step)
        
        # 基于失败类型的基本分析
        if failure_type in self.failure_patterns:
            pattern = self.failure_patterns[failure_type]
            return f"可能的根因：{pattern['common_causes'][0]}"
        
        # 基于上下文的分析
        if failure_step.step_type == StepType.TOOL_CALL:
            tool_name = failure_step.input_data.get("tool_name", "unknown")
            return f"工具 {tool_name} 执行失败"
        elif failure_step.step_type == StepType.LLM_CALL:
            model = failure_step.input_data.get("model", "unknown")
            return f"LLM模型 {model} 调用失败"
        
        return "未知根因，需要进一步分析"
    
    def _find_contributing_factors(self, failure_step: TrajectoryStep, trajectory: ExecutionTrajectory) -> List[str]:
        """查找贡献因素"""
        factors = []
        
        # 检查之前的错误
        previous_errors = [
            step for step in trajectory.steps 
            if step.timestamp < failure_step.timestamp and step.step_type == StepType.ERROR
        ]
        
        if previous_errors:
            factors.append(f"之前发生了{len(previous_errors)}个错误")
        
        # 检查资源使用
        if trajectory.metadata.total_cost > 1.0:
            factors.append("成本较高，可能存在资源限制")
        
        # 检查执行时间
        if trajectory.metadata.total_duration and trajectory.metadata.total_duration > 300:
            factors.append("执行时间过长，可能存在性能问题")
        
        # 检查工具使用频率
        tool_calls = trajectory.get_tool_calls()
        if len(tool_calls) > 20:
            factors.append("工具调用过于频繁")
        
        return factors
    
    def _generate_recovery_suggestions(self, failure_step: TrajectoryStep, trajectory: ExecutionTrajectory) -> List[str]:
        """生成恢复建议"""
        suggestions = []
        failure_type = self._classify_failure_type(failure_step)
        
        # 基于失败类型的建议
        if failure_type in self.failure_patterns:
            pattern = self.failure_patterns[failure_type]
            suggestions.extend(pattern["recovery_actions"])
        
        # 基于上下文的建议
        if failure_step.step_type == StepType.TOOL_CALL:
            suggestions.append("检查工具参数和权限")
            suggestions.append("考虑使用替代工具")
        elif failure_step.step_type == StepType.LLM_CALL:
            suggestions.append("检查API配额和网络连接")
            suggestions.append("考虑使用不同的模型")
        
        # 通用建议
        suggestions.append("重新执行失败的步骤")
        suggestions.append("检查系统日志以获取更多信息")
        
        return suggestions


class BottleneckDetector:
    """
    瓶颈检测器
    
    检测执行过程中的性能瓶颈。
    """
    
    def __init__(self, slow_threshold: float = 10.0, very_slow_threshold: float = 30.0):
        self.slow_threshold = slow_threshold
        self.very_slow_threshold = very_slow_threshold
    
    def detect_bottlenecks(self, trajectory: ExecutionTrajectory) -> List[AnalysisInsight]:
        """检测瓶颈"""
        insights = []
        
        # 检测慢步骤
        slow_steps = self._find_slow_steps(trajectory)
        if slow_steps:
            insights.append(self._create_slow_steps_insight(slow_steps))
        
        # 检测重复调用
        repeated_calls = self._find_repeated_calls(trajectory)
        if repeated_calls:
            insights.append(self._create_repeated_calls_insight(repeated_calls))
        
        # 检测资源密集型操作
        resource_intensive = self._find_resource_intensive_operations(trajectory)
        if resource_intensive:
            insights.append(self._create_resource_intensive_insight(resource_intensive))
        
        return insights
    
    def _find_slow_steps(self, trajectory: ExecutionTrajectory) -> List[TrajectoryStep]:
        """查找慢步骤"""
        slow_steps = []
        
        for step in trajectory.steps:
            if step.duration and step.duration > self.slow_threshold:
                slow_steps.append(step)
        
        return slow_steps
    
    def _find_repeated_calls(self, trajectory: ExecutionTrajectory) -> List[Tuple[str, int]]:
        """查找重复调用"""
        call_counts = defaultdict(int)
        
        for step in trajectory.steps:
            if step.step_type == StepType.TOOL_CALL:
                tool_name = step.input_data.get("tool_name", "unknown")
                call_counts[tool_name] += 1
        
        # 找出调用次数过多的工具
        repeated = [(tool, count) for tool, count in call_counts.items() if count > 5]
        return repeated
    
    def _find_resource_intensive_operations(self, trajectory: ExecutionTrajectory) -> List[TrajectoryStep]:
        """查找资源密集型操作"""
        resource_intensive = []
        
        for step in trajectory.steps:
            if step.step_type == StepType.LLM_RESPONSE:
                token_usage = step.output_data.get("token_usage", {})
                total_tokens = token_usage.get("total_tokens", 0)
                
                if total_tokens > 10000:  # 高令牌使用
                    resource_intensive.append(step)
        
        return resource_intensive
    
    def _create_slow_steps_insight(self, slow_steps: List[TrajectoryStep]) -> AnalysisInsight:
        """创建慢步骤洞察"""
        # 修复：添加对duration为None的检查
        very_slow_count = len([
            s for s in slow_steps 
            if s.duration is not None and s.duration > self.very_slow_threshold
        ])
        
        severity = SeverityLevel.CRITICAL if very_slow_count > 0 else SeverityLevel.HIGH
        
        # 修复：添加对duration为None的检查并过滤掉None值
        slow_durations = [s.duration for s in slow_steps if s.duration is not None]
        average_slow_duration = sum(slow_durations) / len(slow_durations) if slow_durations else 0
        
        return AnalysisInsight(
            insight_id=f"slow_steps_{len(slow_steps)}",
            title=f"检测到{len(slow_steps)}个慢步骤",
            description=f"发现{len(slow_steps)}个执行时间超过{self.slow_threshold}秒的步骤",
            severity=severity,
            analysis_type=AnalysisType.BOTTLENECK,
            confidence=0.9,
            recommendations=[
                "优化慢步骤的执行逻辑",
                "考虑并行执行",
                "增加缓存机制",
                "检查网络和资源配置"
            ],
            metrics={
                "slow_steps_count": len(slow_steps),
                "very_slow_steps_count": very_slow_count,
                "average_slow_duration": average_slow_duration
            },
            affected_steps=[step.step_id for step in slow_steps]
        )
    
    def _create_repeated_calls_insight(self, repeated_calls: List[Tuple[str, int]]) -> AnalysisInsight:
        """创建重复调用洞察"""
        return AnalysisInsight(
            insight_id=f"repeated_calls_{len(repeated_calls)}",
            title=f"检测到{len(repeated_calls)}个重复调用",
            description=f"发现{len(repeated_calls)}个工具被重复调用过多次",
            severity=SeverityLevel.MEDIUM,
            analysis_type=AnalysisType.OPTIMIZATION,
            confidence=0.8,
            recommendations=[
                "缓存重复调用的结果",
                "优化调用逻辑",
                "合并相似的调用",
                "检查是否存在循环调用"
            ],
            metrics={
                "repeated_tools": {tool: count for tool, count in repeated_calls}
            }
        )
    
    def _create_resource_intensive_insight(self, resource_intensive: List[TrajectoryStep]) -> AnalysisInsight:
        """创建资源密集型洞察"""
        total_tokens = sum(
            step.output_data.get("token_usage", {}).get("total_tokens", 0) 
            for step in resource_intensive
        )
        
        return AnalysisInsight(
            insight_id=f"resource_intensive_{len(resource_intensive)}",
            title=f"检测到{len(resource_intensive)}个资源密集型操作",
            description=f"发现{len(resource_intensive)}个高令牌使用的LLM调用",
            severity=SeverityLevel.MEDIUM,
            analysis_type=AnalysisType.OPTIMIZATION,
            confidence=0.7,
            recommendations=[
                "优化提示词长度",
                "使用更高效的模型",
                "分批处理大量数据",
                "考虑使用缓存"
            ],
            metrics={
                "resource_intensive_count": len(resource_intensive),
                "total_tokens": total_tokens,
                "average_tokens_per_call": total_tokens / len(resource_intensive)
            },
            affected_steps=[step.step_id for step in resource_intensive]
        )


class PerformanceAnalyzer:
    """
    性能分析器
    
    分析执行性能并提供优化建议。
    """
    
    def __init__(self):
        self.bottleneck_detector = BottleneckDetector()
    
    def analyze_performance(self, trajectory: ExecutionTrajectory) -> PerformanceReport:
        """分析性能"""
        durations = [step.duration for step in trajectory.steps if step.duration is not None]
        
        report = PerformanceReport(
            trajectory_id=trajectory.trajectory_id,
            total_duration=trajectory.metadata.total_duration or 0,
            step_count=trajectory.metadata.total_steps,
            success_rate=trajectory.metadata.successful_steps / max(trajectory.metadata.total_steps, 1),
            average_step_duration=statistics.mean(durations) if durations else 0
        )
        
        # 最慢和最快步骤
        report.slowest_steps = self._get_slowest_steps(trajectory, 5)
        report.fastest_steps = self._get_fastest_steps(trajectory, 5)
        
        # 资源使用
        # 修复：添加对total_duration为None的检查
        total_duration = trajectory.metadata.total_duration or 0
        report.resource_usage = {
            "total_tokens": trajectory.metadata.total_tokens,
            "total_cost": trajectory.metadata.total_cost,
            "average_tokens_per_call": trajectory.metadata.total_tokens / max(len(trajectory.get_llm_calls()), 1),
            "cost_per_second": trajectory.metadata.total_cost / max(total_duration, 1)
        }
        
        # 瓶颈检测
        bottleneck_insights = self.bottleneck_detector.detect_bottlenecks(trajectory)
        report.bottlenecks = [insight.title for insight in bottleneck_insights]
        
        # 优化机会
        report.optimization_opportunities = self._identify_optimization_opportunities(trajectory)
        
        return report
    
    def _get_slowest_steps(self, trajectory: ExecutionTrajectory, count: int) -> List[Tuple[str, float]]:
        """获取最慢步骤"""
        # 修复：添加对duration为None的检查
        steps_with_duration = [
            (f"{step.step_type.value}:{step.input_data.get('tool_name', step.step_id[:8])}", step.duration)
            for step in trajectory.steps
            if step.duration is not None
        ]
        
        steps_with_duration.sort(key=lambda x: x[1], reverse=True)
        return steps_with_duration[:count]
    
    def _get_fastest_steps(self, trajectory: ExecutionTrajectory, count: int) -> List[Tuple[str, float]]:
        """获取最快步骤"""
        # 修复：添加对duration为None的检查
        steps_with_duration = [
            (f"{step.step_type.value}:{step.input_data.get('tool_name', step.step_id[:8])}", step.duration)
            for step in trajectory.steps
            if step.duration is not None
        ]
        
        steps_with_duration.sort(key=lambda x: x[1])
        return steps_with_duration[:count]
    
    def _identify_optimization_opportunities(self, trajectory: ExecutionTrajectory) -> List[str]:
        """识别优化机会"""
        opportunities = []
        
        # 检查成功率
        success_rate = trajectory.metadata.successful_steps / max(trajectory.metadata.total_steps, 1)
        if success_rate < 0.9:
            opportunities.append("提高执行成功率")
        
        # 检查执行时间
        if trajectory.metadata.total_duration and trajectory.metadata.total_duration > 60:
            opportunities.append("优化执行时间")
        
        # 检查成本
        if trajectory.metadata.total_cost > 0.5:
            opportunities.append("降低执行成本")
        
        # 检查错误率
        errors = trajectory.get_errors()
        if len(errors) > 0:
            opportunities.append("减少错误发生")
        
        # 检查工具使用效率
        tool_calls = trajectory.get_tool_calls()
        if len(tool_calls) > 10:
            opportunities.append("优化工具使用")
        
        return opportunities 