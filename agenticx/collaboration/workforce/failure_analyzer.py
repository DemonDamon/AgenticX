"""
FailureAnalyzer - 故障分析器

分析任务失败原因并推荐恢复策略。
参考：camel/societies/workforce/workforce.py:_analyze_task()
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
import json
from typing import Optional, Dict, Any

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor
from ...core.error_handler import ErrorHandler, ErrorClassifier
from .utils import TaskAnalysisResult, RecoveryStrategy, FailureHandlingConfig
from .prompts import (
    TASK_ANALYSIS_PROMPT,
    FAILURE_ANALYSIS_RESPONSE_FORMAT,
    QUALITY_EVALUATION_RESPONSE_FORMAT,
    STRATEGY_DESCRIPTIONS,
)

logger = logging.getLogger(__name__)


class FailureAnalyzer:
    """故障分析器
    
    分析任务失败原因并推荐恢复策略。
    """
    
    def __init__(
        self,
        task_agent: Agent,
        executor: AgentExecutor,
        error_handler: Optional[ErrorHandler] = None,
    ):
        """
        初始化 FailureAnalyzer
        
        Args:
            task_agent: Task Agent 实例（用于 LLM 分析）
            executor: AgentExecutor 实例
            error_handler: ErrorHandler 实例（可选）
        """
        self.task_agent = task_agent
        self.executor = executor
        self.error_handler = error_handler or ErrorHandler()
        self.error_classifier = ErrorClassifier()
    
    async def analyze_failure(
        self,
        task: Task,
        error_message: str,
        failure_count: int,
        task_depth: int = 0,
        assigned_worker: Optional[str] = None,
        failure_handling_config: Optional[FailureHandlingConfig] = None,
    ) -> TaskAnalysisResult:
        """
        分析任务失败原因并推荐恢复策略
        
        Args:
            task: 失败的任务
            error_message: 错误消息
            failure_count: 失败次数
            task_depth: 任务深度（在分解层次中的深度）
            assigned_worker: 分配的 Worker ID（可选）
            failure_handling_config: 故障处理配置（可选）
            
        Returns:
            TaskAnalysisResult: 分析结果
        """
        logger.info(f"[FailureAnalyzer] Analyzing failure for task {task.id}")
        
        # 使用 ErrorClassifier 分类错误
        try:
            # 创建一个临时异常对象用于分类
            error_exception = Exception(error_message)
            error_category = self.error_classifier.classify(error_exception)
            is_recoverable = self.error_classifier.is_recoverable(error_exception)
        except Exception as e:
            logger.warning(f"[FailureAnalyzer] Error classification failed: {e}")
            error_category = "unknown_error"
            is_recoverable = True
        
        # 确定问题类型
        issue_type = "task_failure"
        issue_specific_analysis = f"""
**Error Category**: {error_category}
**Recoverable**: {is_recoverable}
**Error Message**: {error_message}
"""
        
        # 获取可用的恢复策略
        if failure_handling_config:
            enabled_strategies = failure_handling_config.enabled_strategies
        else:
            enabled_strategies = None  # 所有策略都可用
        
        if enabled_strategies is None:
            # 所有策略都可用
            strategy_options = "retry, reassign, replan, decompose, create_worker"
            available_strategies = "\n".join([
                STRATEGY_DESCRIPTIONS.get(strategy.value, f"**{strategy.value}** - Strategy description")
                for strategy in RecoveryStrategy
            ])
        elif len(enabled_strategies) == 0:
            # 没有可用策略
            return TaskAnalysisResult(
                reasoning="No recovery strategies enabled",
                recovery_strategy=None,
                issues=[error_message],
            )
        else:
            # 只有部分策略可用
            strategy_options = ", ".join([s.value for s in enabled_strategies])
            available_strategies = "\n".join([
                STRATEGY_DESCRIPTIONS.get(strategy.value, f"**{strategy.value}** - Strategy description")
                for strategy in enabled_strategies
            ])
        
        # 构建 Prompt
        response_format = FAILURE_ANALYSIS_RESPONSE_FORMAT.format(
            strategy_options=strategy_options
        )
        
        prompt = TASK_ANALYSIS_PROMPT.format(
            task_id=task.id,
            task_content=task.description,
            task_result=f"Failed: {error_message}",
            failure_count=failure_count,
            task_depth=task_depth,
            assigned_worker=assigned_worker or "unknown",
            issue_type=issue_type,
            issue_specific_analysis=issue_specific_analysis,
            available_strategies=available_strategies,
            response_format=response_format,
        )
        
        # 调用 LLM
        analysis_task = Task(
            description=prompt,
            expected_output="JSON object with analysis result"
        )
        
        result = self.executor.run(self.task_agent, analysis_task)
        
        # 解析结果
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            analysis_data = output
        else:
            try:
                analysis_data = json.loads(output)
            except json.JSONDecodeError:
                logger.error(f"[FailureAnalyzer] Failed to parse analysis result: {output}")
                # 回退到简单分析
                return TaskAnalysisResult(
                    reasoning=f"Failed to analyze: {error_message}",
                    recovery_strategy=RecoveryStrategy.RETRY if is_recoverable else None,
                    issues=[error_message],
                )
        
        # 构建 TaskAnalysisResult
        recovery_strategy_str = analysis_data.get("recovery_strategy")
        recovery_strategy = None
        if recovery_strategy_str:
            try:
                recovery_strategy = RecoveryStrategy(recovery_strategy_str.lower())
            except ValueError:
                logger.warning(
                    f"[FailureAnalyzer] Invalid recovery strategy: {recovery_strategy_str}"
                )
        
        return TaskAnalysisResult(
            reasoning=analysis_data.get("reasoning", "Analysis completed"),
            recovery_strategy=recovery_strategy,
            modified_task_content=analysis_data.get("modified_task_content"),
            issues=analysis_data.get("issues", [error_message]),
        )
    
    async def evaluate_quality(
        self,
        task: Task,
        task_result: str,
        failure_count: int = 0,
        task_depth: int = 0,
        assigned_worker: Optional[str] = None,
        failure_handling_config: Optional[FailureHandlingConfig] = None,
    ) -> TaskAnalysisResult:
        """
        评估任务结果质量
        
        Args:
            task: 任务
            task_result: 任务结果
            failure_count: 失败次数（可选）
            task_depth: 任务深度（可选）
            assigned_worker: 分配的 Worker ID（可选）
            failure_handling_config: 故障处理配置（可选）
            
        Returns:
            TaskAnalysisResult: 质量评估结果
        """
        logger.info(f"[FailureAnalyzer] Evaluating quality for task {task.id}")
        
        # 确定问题类型
        issue_type = "quality_evaluation"
        issue_specific_analysis = """
**Task completed successfully, evaluating result quality.**
"""
        
        # 获取可用的恢复策略
        if failure_handling_config:
            enabled_strategies = failure_handling_config.enabled_strategies
        else:
            enabled_strategies = None
        
        if enabled_strategies is None:
            strategy_options = "retry, reassign, replan, decompose, create_worker"
            available_strategies = "\n".join([
                STRATEGY_DESCRIPTIONS.get(strategy.value, f"**{strategy.value}** - Strategy description")
                for strategy in RecoveryStrategy
            ])
        elif len(enabled_strategies) == 0:
            return TaskAnalysisResult(
                reasoning="Task completed, no recovery needed",
                recovery_strategy=None,
                quality_score=100,
                issues=[],
            )
        else:
            strategy_options = ", ".join([s.value for s in enabled_strategies])
            available_strategies = "\n".join([
                STRATEGY_DESCRIPTIONS.get(strategy.value, f"**{strategy.value}** - Strategy description")
                for strategy in enabled_strategies
            ])
        
        # 构建 Prompt
        response_format = QUALITY_EVALUATION_RESPONSE_FORMAT.format(
            strategy_options=strategy_options
        )
        
        prompt = TASK_ANALYSIS_PROMPT.format(
            task_id=task.id,
            task_content=task.description,
            task_result=task_result,
            failure_count=failure_count,
            task_depth=task_depth,
            assigned_worker=assigned_worker or "unknown",
            issue_type=issue_type,
            issue_specific_analysis=issue_specific_analysis,
            available_strategies=available_strategies,
            response_format=response_format,
        )
        
        # 调用 LLM
        analysis_task = Task(
            description=prompt,
            expected_output="JSON object with quality evaluation result"
        )
        
        result = self.executor.run(self.task_agent, analysis_task)
        
        # 解析结果
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            analysis_data = output
        else:
            try:
                analysis_data = json.loads(output)
            except json.JSONDecodeError:
                logger.error(f"[FailureAnalyzer] Failed to parse quality evaluation: {output}")
                return TaskAnalysisResult(
                    reasoning="Failed to evaluate quality",
                    recovery_strategy=None,
                    quality_score=50,  # 默认中等质量
                    issues=[],
                )
        
        # 构建 TaskAnalysisResult
        recovery_strategy_str = analysis_data.get("recovery_strategy")
        recovery_strategy = None
        if recovery_strategy_str:
            try:
                recovery_strategy = RecoveryStrategy(recovery_strategy_str.lower())
            except ValueError:
                logger.warning(
                    f"[FailureAnalyzer] Invalid recovery strategy: {recovery_strategy_str}"
                )
        
        return TaskAnalysisResult(
            reasoning=analysis_data.get("reasoning", "Quality evaluation completed"),
            recovery_strategy=recovery_strategy,
            modified_task_content=analysis_data.get("modified_task_content"),
            quality_score=analysis_data.get("quality_score"),
            issues=analysis_data.get("issues", []),
        )
