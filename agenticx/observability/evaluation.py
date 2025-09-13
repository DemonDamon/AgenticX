"""
AgenticX M9: 评估与基准测试系统 (Evaluation & Benchmarking System)

本模块实现了评估和基准测试功能，提供性能评估、自动评估和基准测试能力。
"""

import statistics
import time
from typing import Dict, Any, List, Optional, Callable, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging

from .trajectory import ExecutionTrajectory
from ..core.agent import Agent
from ..core.task import Task
from ..llms.base import BaseLLMProvider


logger = logging.getLogger(__name__)


class EvaluationMetric(Enum):
    """评估指标"""
    SUCCESS_RATE = "success_rate"
    AVERAGE_DURATION = "average_duration"
    TOTAL_COST = "total_cost"
    ERROR_RATE = "error_rate"
    THROUGHPUT = "throughput"
    RESPONSE_TIME = "response_time"
    ACCURACY = "accuracy"
    PRECISION = "precision"
    RECALL = "recall"
    F1_SCORE = "f1_score"


@dataclass
class EvaluationResult:
    """评估结果"""
    metric: EvaluationMetric
    value: float
    unit: str = ""
    description: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric": self.metric.value,
            "value": self.value,
            "unit": self.unit,
            "description": self.description,
            "timestamp": self.timestamp.isoformat()
        }


@dataclass
class BenchmarkResult:
    """基准测试结果"""
    benchmark_name: str
    agent_id: str
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    total_duration: float
    results: List[EvaluationResult] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def add_result(self, result: EvaluationResult):
        """添加评估结果"""
        self.results.append(result)
    
    def get_result(self, metric: EvaluationMetric) -> Optional[EvaluationResult]:
        """获取特定指标的结果"""
        for result in self.results:
            if result.metric == metric:
                return result
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "benchmark_name": self.benchmark_name,
            "agent_id": self.agent_id,
            "total_tasks": self.total_tasks,
            "completed_tasks": self.completed_tasks,
            "failed_tasks": self.failed_tasks,
            "total_duration": self.total_duration,
            "results": [result.to_dict() for result in self.results],
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat()
        }


class EvaluationMetrics:
    """评估指标集合"""
    
    def __init__(self):
        self.metrics: Dict[EvaluationMetric, float] = {}
    
    def add_metric(self, metric: EvaluationMetric, value: float):
        """添加指标"""
        self.metrics[metric] = value
    
    def get_metric(self, metric: EvaluationMetric) -> Optional[float]:
        """获取指标"""
        return self.metrics.get(metric)
    
    def to_dict(self) -> Dict[str, float]:
        """转换为字典"""
        return {metric.value: value for metric, value in self.metrics.items()}


class MetricsCalculator:
    """
    指标计算器
    
    计算各种评估指标。
    """
    
    def __init__(self):
        pass
    
    def calculate_success_rate(self, trajectories: List[ExecutionTrajectory]) -> float:
        """计算成功率"""
        if not trajectories:
            return 0.0
        
        successful_count = sum(
            1 for trajectory in trajectories 
            if trajectory.metadata.successful_steps > 0
        )
        
        return successful_count / len(trajectories)
    
    def calculate_average_duration(self, trajectories: List[ExecutionTrajectory]) -> float:
        """计算平均执行时间"""
        if not trajectories:
            return 0.0
        
        durations = [
            trajectory.metadata.total_duration 
            for trajectory in trajectories 
            if trajectory.metadata.total_duration is not None
        ]
        
        if not durations:
            return 0.0
        
        return statistics.mean(durations)
    
    def calculate_total_cost(self, trajectories: List[ExecutionTrajectory]) -> float:
        """计算总成本"""
        return sum(trajectory.metadata.total_cost for trajectory in trajectories)
    
    def calculate_error_rate(self, trajectories: List[ExecutionTrajectory]) -> float:
        """计算错误率"""
        if not trajectories:
            return 0.0
        
        total_steps = sum(trajectory.metadata.total_steps for trajectory in trajectories)
        total_errors = sum(len(trajectory.get_errors()) for trajectory in trajectories)
        
        if total_steps == 0:
            return 0.0
        
        return total_errors / total_steps
    
    def calculate_throughput(self, trajectories: List[ExecutionTrajectory], time_window: float) -> float:
        """计算吞吐量（任务/秒）"""
        if not trajectories or time_window <= 0:
            return 0.0
        
        return len(trajectories) / time_window
    
    def calculate_response_time_percentiles(self, trajectories: List[ExecutionTrajectory]) -> Dict[str, float]:
        """计算响应时间百分位数"""
        durations = [
            trajectory.metadata.total_duration 
            for trajectory in trajectories 
            if trajectory.metadata.total_duration is not None
        ]
        
        if not durations:
            return {}
        
        durations.sort()
        
        def percentile(data, percent):
            k = (len(data) - 1) * percent
            f = int(k)
            c = k - f
            if f == len(data) - 1:
                return data[f]
            return data[f] * (1 - c) + data[f + 1] * c
        
        return {
            "p50": percentile(durations, 0.5),
            "p90": percentile(durations, 0.9),
            "p95": percentile(durations, 0.95),
            "p99": percentile(durations, 0.99)
        }
    
    def calculate_all_metrics(self, trajectories: List[ExecutionTrajectory], time_window: Optional[float] = None) -> EvaluationMetrics:
        """计算所有指标"""
        metrics = EvaluationMetrics()
        
        if not trajectories:
            return metrics
        
        # 基本指标
        metrics.add_metric(EvaluationMetric.SUCCESS_RATE, self.calculate_success_rate(trajectories))
        metrics.add_metric(EvaluationMetric.AVERAGE_DURATION, self.calculate_average_duration(trajectories))
        metrics.add_metric(EvaluationMetric.TOTAL_COST, self.calculate_total_cost(trajectories))
        metrics.add_metric(EvaluationMetric.ERROR_RATE, self.calculate_error_rate(trajectories))
        
        # 吞吐量（如果提供了时间窗口）
        if time_window:
            metrics.add_metric(EvaluationMetric.THROUGHPUT, self.calculate_throughput(trajectories, time_window))
        
        # 响应时间（使用P90作为代表）
        percentiles = self.calculate_response_time_percentiles(trajectories)
        if percentiles:
            metrics.add_metric(EvaluationMetric.RESPONSE_TIME, percentiles.get("p90", 0))
        
        return metrics


class AutoEvaluator:
    """
    自动评估器
    
    自动评估任务输出的质量。
    """
    
    def __init__(self, llm_provider: Optional[BaseLLMProvider] = None):
        self.llm_provider = llm_provider
    
    def evaluate_output(self, expected: Any, actual: Any, task_type: str = "general") -> EvaluationResult:
        """评估输出质量"""
        if self.llm_provider:
            return self._evaluate_with_llm(expected, actual, task_type)
        else:
            return self._evaluate_simple(expected, actual, task_type)
    
    def _evaluate_simple(self, expected: Any, actual: Any, task_type: str) -> EvaluationResult:
        """简单评估"""
        if task_type == "classification":
            # 分类任务 - 精确匹配
            accuracy = 1.0 if expected == actual else 0.0
            return EvaluationResult(
                metric=EvaluationMetric.ACCURACY,
                value=accuracy,
                unit="",
                description=f"分类准确率: {accuracy:.2%}"
            )
        elif task_type == "generation":
            # 生成任务 - 基于长度和相似度的简单评估
            if isinstance(expected, str) and isinstance(actual, str):
                # 简单的文本相似度评估
                similarity = self._calculate_text_similarity(expected, actual)
                return EvaluationResult(
                    metric=EvaluationMetric.ACCURACY,
                    value=similarity,
                    unit="",
                    description=f"文本相似度: {similarity:.2%}"
                )
        
        # 默认评估
        return EvaluationResult(
            metric=EvaluationMetric.ACCURACY,
            value=0.5,
            unit="",
            description="默认评估结果"
        )
    
    def _evaluate_with_llm(self, expected: Any, actual: Any, task_type: str) -> EvaluationResult:
        """使用LLM评估"""
        if not self.llm_provider:
            return self._evaluate_simple(expected, actual, task_type)
            
        try:
            prompt = self._build_evaluation_prompt(expected, actual, task_type)
            response = self.llm_provider.invoke(prompt)
            
            # 从响应中提取评分
            score = self._extract_score_from_response(response.content)
            
            return EvaluationResult(
                metric=EvaluationMetric.ACCURACY,
                value=score,
                unit="",
                description=f"LLM评估结果: {score:.2%}"
            )
        except Exception as e:
            logger.error(f"LLM评估失败: {e}")
            return self._evaluate_simple(expected, actual, task_type)
    
    def _build_evaluation_prompt(self, expected: Any, actual: Any, task_type: str) -> str:
        """构建评估提示词"""
        return f"""
请评估以下任务的输出质量：

任务类型: {task_type}

期望输出:
{expected}

实际输出:
{actual}

请给出0-1之间的评分，其中1表示完全正确，0表示完全错误。
请只返回数字评分，不需要其他解释。
"""
    
    def _extract_score_from_response(self, response: str) -> float:
        """从响应中提取评分"""
        try:
            # 尝试提取数字
            import re
            numbers = re.findall(r'0?\.\d+|[01]', response)
            if numbers:
                score = float(numbers[0])
                return max(0.0, min(1.0, score))  # 确保在0-1范围内
        except:
            pass
        
        return 0.5  # 默认评分
    
    def _calculate_text_similarity(self, text1: str, text2: str) -> float:
        """计算文本相似度"""
        if not text1 or not text2:
            return 0.0
        
        # 简单的Jaccard相似度
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 and not words2:
            return 1.0
        
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        return len(intersection) / len(union) if union else 0.0


class BenchmarkRunner:
    """
    基准测试运行器
    
    执行基准测试并收集结果。
    """
    
    def __init__(self, 
                 metrics_calculator: Optional[MetricsCalculator] = None,
                 auto_evaluator: Optional[AutoEvaluator] = None,
                 max_workers: int = 4):
        self.metrics_calculator = metrics_calculator or MetricsCalculator()
        self.auto_evaluator = auto_evaluator or AutoEvaluator()
        self.max_workers = max_workers
        
        # 基准测试历史
        self.benchmark_history: List[BenchmarkResult] = []
    
    def run_benchmark(self, 
                     benchmark_name: str,
                     agent: Agent,
                     tasks: List[Task],
                     expected_outputs: Optional[List[Any]] = None,
                     timeout: Optional[float] = None) -> BenchmarkResult:
        """运行基准测试"""
        logger.info(f"开始运行基准测试: {benchmark_name}")
        
        start_time = time.time()
        
        # 初始化结果
        result = BenchmarkResult(
            benchmark_name=benchmark_name,
            agent_id=agent.id,
            total_tasks=len(tasks),
            completed_tasks=0,
            failed_tasks=0,
            total_duration=0.0
        )
        
        # 执行任务
        task_results = []
        trajectories = []
        
        if timeout:
            # 使用超时执行
            task_results = self._run_tasks_with_timeout(agent, tasks, timeout)
        else:
            # 正常执行
            task_results = self._run_tasks(agent, tasks)
        
        # 统计结果
        result.completed_tasks = len([r for r in task_results if r.get("success", False)])
        result.failed_tasks = len([r for r in task_results if not r.get("success", False)])
        result.total_duration = time.time() - start_time
        
        # 如果有轨迹数据，提取轨迹
        for task_result in task_results:
            if "trajectory" in task_result:
                trajectories.append(task_result["trajectory"])
        
        # 计算指标
        if trajectories:
            metrics = self.metrics_calculator.calculate_all_metrics(trajectories, result.total_duration)
            
            for metric, value in metrics.metrics.items():
                result.add_result(EvaluationResult(
                    metric=metric,
                    value=value,
                    unit=self._get_metric_unit(metric),
                    description=self._get_metric_description(metric)
                ))
        
        # 如果有期望输出，进行质量评估
        if expected_outputs and len(expected_outputs) == len(task_results):
            accuracy_scores = []
            
            for i, (task_result, expected) in enumerate(zip(task_results, expected_outputs)):
                if task_result.get("success", False):
                    actual = task_result.get("result")
                    eval_result = self.auto_evaluator.evaluate_output(expected, actual)
                    accuracy_scores.append(eval_result.value)
            
            if accuracy_scores:
                avg_accuracy = statistics.mean(accuracy_scores)
                result.add_result(EvaluationResult(
                    metric=EvaluationMetric.ACCURACY,
                    value=avg_accuracy,
                    unit="",
                    description=f"平均准确率: {avg_accuracy:.2%}"
                ))
        
        # 保存到历史
        self.benchmark_history.append(result)
        
        logger.info(f"基准测试完成: {benchmark_name}, 成功率: {result.completed_tasks/result.total_tasks:.2%}")
        
        return result
    
    def _run_tasks(self, agent: Agent, tasks: List[Task]) -> List[Dict[str, Any]]:
        """运行任务"""
        results = []
        
        # 需要实际的AgentExecutor来执行任务
        # 这里是一个占位符实现
        for task in tasks:
            try:
                # 模拟任务执行
                result = {
                    "success": True,
                    "result": f"Task {task.id} completed successfully",
                    "execution_time": 1.0
                }
                results.append(result)
            except Exception as e:
                result = {
                    "success": False,
                    "error": str(e),
                    "execution_time": 0.0
                }
                results.append(result)
        
        return results
    
    def _run_tasks_with_timeout(self, agent: Agent, tasks: List[Task], timeout: float) -> List[Dict[str, Any]]:
        """带超时的任务执行"""
        results = []
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []
            
            for task in tasks:
                future = executor.submit(self._execute_single_task, agent, task)
                futures.append(future)
            
            for future in futures:
                try:
                    result = future.result(timeout=timeout)
                    results.append(result)
                except TimeoutError:
                    results.append({
                        "success": False,
                        "error": "Task execution timeout",
                        "execution_time": timeout
                    })
                except Exception as e:
                    results.append({
                        "success": False,
                        "error": str(e),
                        "execution_time": 0.0
                    })
        
        return results
    
    def _execute_single_task(self, agent: Agent, task: Task) -> Dict[str, Any]:
        """执行单个任务"""
        # 这里应该使用实际的AgentExecutor
        # 现在是占位符实现
        return {
            "success": True,
            "result": f"Task {task.id} completed",
            "execution_time": 1.0
        }
    
    def _get_metric_unit(self, metric: EvaluationMetric) -> str:
        """获取指标单位"""
        unit_map = {
            EvaluationMetric.SUCCESS_RATE: "%",
            EvaluationMetric.AVERAGE_DURATION: "seconds",
            EvaluationMetric.TOTAL_COST: "$",
            EvaluationMetric.ERROR_RATE: "%",
            EvaluationMetric.THROUGHPUT: "tasks/second",
            EvaluationMetric.RESPONSE_TIME: "seconds",
            EvaluationMetric.ACCURACY: "%",
            EvaluationMetric.PRECISION: "%",
            EvaluationMetric.RECALL: "%",
            EvaluationMetric.F1_SCORE: "%"
        }
        return unit_map.get(metric, "")
    
    def _get_metric_description(self, metric: EvaluationMetric) -> str:
        """获取指标描述"""
        description_map = {
            EvaluationMetric.SUCCESS_RATE: "任务成功率",
            EvaluationMetric.AVERAGE_DURATION: "平均执行时间",
            EvaluationMetric.TOTAL_COST: "总成本",
            EvaluationMetric.ERROR_RATE: "错误率",
            EvaluationMetric.THROUGHPUT: "吞吐量",
            EvaluationMetric.RESPONSE_TIME: "响应时间",
            EvaluationMetric.ACCURACY: "准确率",
            EvaluationMetric.PRECISION: "精确率",
            EvaluationMetric.RECALL: "召回率",
            EvaluationMetric.F1_SCORE: "F1分数"
        }
        return description_map.get(metric, "")
    
    def compare_agents(self, 
                      agents: List[Agent], 
                      benchmark_name: str,
                      tasks: List[Task],
                      expected_outputs: Optional[List[Any]] = None) -> Dict[str, BenchmarkResult]:
        """对比多个Agent性能"""
        results = {}
        
        for agent in agents:
            try:
                result = self.run_benchmark(
                    benchmark_name=f"{benchmark_name}_agent_{agent.id}",
                    agent=agent,
                    tasks=tasks,
                    expected_outputs=expected_outputs
                )
                results[agent.id] = result
            except Exception as e:
                logger.error(f"Agent {agent.id} 基准测试失败: {e}")
        
        return results
    
    def get_benchmark_history(self) -> List[BenchmarkResult]:
        """获取基准测试历史"""
        return self.benchmark_history.copy()
    
    def get_agent_performance_summary(self, agent_id: str) -> Dict[str, Any]:
        """获取Agent性能摘要"""
        agent_results = [r for r in self.benchmark_history if r.agent_id == agent_id]
        
        if not agent_results:
            return {"message": "No benchmark results found for this agent"}
        
        # 计算平均指标
        avg_metrics = {}
        for metric in EvaluationMetric:
            values = []
            for result in agent_results:
                metric_result = result.get_result(metric)
                if metric_result:
                    values.append(metric_result.value)
            
            if values:
                avg_metrics[metric.value] = {
                    "average": statistics.mean(values),
                    "min": min(values),
                    "max": max(values),
                    "std": statistics.stdev(values) if len(values) > 1 else 0
                }
        
        return {
            "agent_id": agent_id,
            "total_benchmarks": len(agent_results),
            "latest_benchmark": agent_results[-1].to_dict(),
            "average_metrics": avg_metrics,
            "performance_trend": self._calculate_performance_trend(agent_results)
        }
    
    def _calculate_performance_trend(self, results: List[BenchmarkResult]) -> str:
        """计算性能趋势"""
        if len(results) < 2:
            return "insufficient_data"
        
        # 使用成功率作为主要指标
        success_rates = []
        for result in results:
            if result.total_tasks > 0:
                success_rates.append(result.completed_tasks / result.total_tasks)
        
        if len(success_rates) < 2:
            return "insufficient_data"
        
        # 简单的趋势分析
        if success_rates[-1] > success_rates[-2]:
            return "improving"
        elif success_rates[-1] < success_rates[-2]:
            return "declining"
        else:
            return "stable"
    
    def export_results(self, filename: str):
        """导出结果到文件"""
        export_data = {
            "export_time": datetime.now(UTC).isoformat(),
            "total_benchmarks": len(self.benchmark_history),
            "benchmarks": [result.to_dict() for result in self.benchmark_history]
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"基准测试结果已导出到: {filename}")
    
    def clear_history(self):
        """清空历史记录"""
        self.benchmark_history.clear()
        logger.info("基准测试历史已清空") 