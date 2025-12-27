"""
EvalRunner: 评测运行器

执行评测集中的用例，收集结果并生成报告。
"""

import asyncio
import time
import logging
from typing import List, Optional, Dict, Any, Callable, Union
from pathlib import Path
from datetime import datetime, timezone

from .evalset import EvalSet, EvalCase, EvalResult, EvalSummary
from .trajectory_matcher import (
    TrajectoryMatcher,
    MatchMode,
    ToolCall,
)

logger = logging.getLogger(__name__)


class EvalRunner:
    """
    评测运行器
    
    执行评测用例，收集结果，生成报告。
    """
    
    def __init__(
        self,
        agent_executor: Optional[Any] = None,
        agent_factory: Optional[Callable] = None,
        max_concurrent: int = 1,
        timeout: float = 60.0,
        verbose: bool = False
    ):
        """
        初始化评测运行器
        
        Args:
            agent_executor: AgentExecutor 实例（用于执行任务）
            agent_factory: Agent 工厂函数（如果需要每个用例创建新 Agent）
            max_concurrent: 最大并发执行数
            timeout: 单个用例超时时间（秒）
            verbose: 是否输出详细日志
        """
        self.agent_executor = agent_executor
        self.agent_factory = agent_factory
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self.verbose = verbose
        
        # 结果存储
        self._results: List[EvalResult] = []
        
        # 回调函数
        self._on_case_start: Optional[Callable] = None
        self._on_case_end: Optional[Callable] = None
        
    def on_case_start(self, callback: Callable):
        """注册用例开始回调"""
        self._on_case_start = callback
        
    def on_case_end(self, callback: Callable):
        """注册用例结束回调"""
        self._on_case_end = callback
    
    async def run_async(
        self,
        evalset: EvalSet,
        case_ids: Optional[List[str]] = None
    ) -> EvalSummary:
        """
        异步执行评测
        
        Args:
            evalset: 评测集
            case_ids: 要执行的用例 ID 列表（None 表示全部）
            
        Returns:
            评测汇总结果
        """
        self._results = []
        
        # 筛选用例
        cases = evalset.cases
        if case_ids:
            cases = [c for c in cases if c.id in case_ids]
        
        logger.info(f"Starting evaluation: {evalset.name} ({len(cases)} cases)")
        
        # 执行用例
        if self.max_concurrent > 1:
            # 并发执行
            semaphore = asyncio.Semaphore(self.max_concurrent)
            tasks = [self._run_case_with_semaphore(case, semaphore) for case in cases]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    self._results.append(EvalResult(
                        case_id=cases[i].id,
                        case_name=cases[i].name,
                        success=False,
                        error=str(result),
                        trajectory_score=0.0,
                        trajectory_matched=False
                    ))
                else:
                    self._results.append(result)
        else:
            # 顺序执行
            for case in cases:
                try:
                    result = await self._run_case(case)
                    self._results.append(result)
                except Exception as e:
                    logger.error(f"Error running case {case.id}: {e}")
                    self._results.append(EvalResult(
                        case_id=case.id,
                        case_name=case.name,
                        success=False,
                        error=str(e),
                        trajectory_score=0.0,
                        trajectory_matched=False
                    ))
        
        # 生成汇总
        return self._generate_summary(evalset)
    
    def run(
        self,
        evalset: EvalSet,
        case_ids: Optional[List[str]] = None
    ) -> EvalSummary:
        """
        同步执行评测
        
        Args:
            evalset: 评测集
            case_ids: 要执行的用例 ID 列表
            
        Returns:
            评测汇总结果
        """
        return asyncio.run(self.run_async(evalset, case_ids))
    
    async def _run_case_with_semaphore(
        self,
        case: EvalCase,
        semaphore: asyncio.Semaphore
    ) -> EvalResult:
        """带信号量的用例执行"""
        async with semaphore:
            return await self._run_case(case)
    
    async def _run_case(self, case: EvalCase) -> EvalResult:
        """
        执行单个评测用例
        
        Args:
            case: 评测用例
            
        Returns:
            评测结果
        """
        if self._on_case_start:
            self._on_case_start(case)
        
        start_time = time.time()
        actual_tool_calls: List[Dict[str, Any]] = []
        actual_response: Optional[str] = None
        token_usage: Optional[Dict[str, int]] = None
        cost: Optional[float] = None
        error: Optional[str] = None
        
        try:
            # 执行用例
            if self.agent_executor:
                # 使用提供的执行器
                result = await asyncio.wait_for(
                    self._execute_with_agent(case),
                    timeout=self.timeout
                )
                actual_tool_calls = result.get("tool_calls", [])
                actual_response = result.get("response")
                token_usage = result.get("token_usage")
                cost = result.get("cost")
            else:
                # 模拟执行（用于测试）
                actual_tool_calls = []
                actual_response = f"[Mock response for: {case.query}]"
            
            success = True
            
        except asyncio.TimeoutError:
            success = False
            error = f"Timeout after {self.timeout}s"
            logger.warning(f"Case {case.id} timed out")
            
        except Exception as e:
            success = False
            error = str(e)
            logger.error(f"Case {case.id} failed: {e}")
        
        execution_time_ms = (time.time() - start_time) * 1000
        
        # 轨迹匹配
        trajectory_score = 0.0
        trajectory_matched = False
        
        if success and case.expected_tool_use:
            mode = MatchMode(case.trajectory_match_mode)
            matcher = TrajectoryMatcher(mode=mode)
            
            tool_calls = [ToolCall.from_dict(tc) for tc in actual_tool_calls]
            match_result = matcher.match(tool_calls, case.expected_tool_use)
            
            trajectory_score = match_result.score
            trajectory_matched = match_result.matched
        elif success and not case.expected_tool_use:
            # 没有预期的工具调用，视为匹配
            trajectory_score = 1.0
            trajectory_matched = True
        
        # 响应评估（简单实现，后续可扩展）
        response_score: Optional[float] = None
        if success and case.reference and actual_response:
            # 简单的字符串包含检查（实际应使用 LLM 或其他评估方法）
            if case.reference.lower() in actual_response.lower():
                response_score = 1.0
            else:
                response_score = 0.0
        
        result = EvalResult(
            case_id=case.id,
            case_name=case.name,
            success=success,
            error=error,
            trajectory_score=trajectory_score,
            trajectory_matched=trajectory_matched,
            response_score=response_score,
            actual_tool_calls=actual_tool_calls,
            actual_response=actual_response,
            execution_time_ms=execution_time_ms,
            token_usage=token_usage,
            cost=cost
        )
        
        if self._on_case_end:
            self._on_case_end(case, result)
        
        if self.verbose:
            status = "✅" if trajectory_matched else "❌"
            logger.info(f"{status} Case {case.id}: score={trajectory_score:.2f}")
        
        return result
    
    async def _execute_with_agent(self, case: EvalCase) -> Dict[str, Any]:
        """
        使用 Agent 执行用例
        
        Args:
            case: 评测用例
            
        Returns:
            执行结果字典
        """
        # 这里需要根据实际的 AgentExecutor 接口实现
        # 以下是示意代码
        
        tool_calls = []
        
        # 如果有 agent_executor，调用它
        if hasattr(self.agent_executor, 'execute_async'):
            result = await self.agent_executor.execute_async(
                query=case.query,
                context=case.initial_context
            )
            
            # 提取工具调用记录
            if hasattr(result, 'tool_calls'):
                tool_calls = [tc.to_dict() if hasattr(tc, 'to_dict') else tc for tc in result.tool_calls]
            
            return {
                "tool_calls": tool_calls,
                "response": getattr(result, 'response', str(result)),
                "token_usage": getattr(result, 'token_usage', None),
                "cost": getattr(result, 'cost', None)
            }
        
        # 默认返回空结果
        return {
            "tool_calls": [],
            "response": None,
            "token_usage": None,
            "cost": None
        }
    
    def _generate_summary(self, evalset: EvalSet) -> EvalSummary:
        """
        生成评测汇总
        
        Args:
            evalset: 评测集
            
        Returns:
            评测汇总
        """
        total = len(self._results)
        passed = sum(1 for r in self._results if r.trajectory_matched)
        failed = sum(1 for r in self._results if r.success and not r.trajectory_matched)
        errors = sum(1 for r in self._results if not r.success)
        
        # 计算分数
        trajectory_scores = [r.trajectory_score for r in self._results]
        trajectory_accuracy = sum(trajectory_scores) / len(trajectory_scores) if trajectory_scores else 0.0
        
        # 响应准确率
        response_scores = [r.response_score for r in self._results if r.response_score is not None]
        response_accuracy = sum(response_scores) / len(response_scores) if response_scores else None
        
        # 总体分数
        overall_score = trajectory_accuracy
        if response_accuracy is not None:
            overall_score = (trajectory_accuracy + response_accuracy) / 2
        
        # 性能统计
        exec_times = [r.execution_time_ms for r in self._results if r.execution_time_ms is not None]
        avg_time = sum(exec_times) / len(exec_times) if exec_times else None
        
        total_tokens = None
        token_usages = [r.token_usage for r in self._results if r.token_usage]
        if token_usages:
            total_tokens = sum(
                tu.get('total_tokens', tu.get('prompt_tokens', 0) + tu.get('completion_tokens', 0))
                for tu in token_usages
            )
        
        costs = [r.cost for r in self._results if r.cost is not None]
        total_cost = sum(costs) if costs else None
        
        return EvalSummary(
            total_cases=total,
            passed_cases=passed,
            failed_cases=failed,
            error_cases=errors,
            overall_score=overall_score,
            trajectory_accuracy=trajectory_accuracy,
            response_accuracy=response_accuracy,
            avg_execution_time_ms=avg_time,
            total_tokens=total_tokens,
            total_cost=total_cost,
            evalset_name=evalset.name,
            evalset_version=evalset.version
        )
    
    def get_results(self) -> List[EvalResult]:
        """获取所有评测结果"""
        return self._results
    
    def save_results(self, path: Union[str, Path]) -> None:
        """
        保存评测结果到 JSON 文件
        
        Args:
            path: 输出文件路径
        """
        import json
        
        path = Path(path)
        results_data = [r.model_dump(mode='json') for r in self._results]
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(results_data, f, indent=2, ensure_ascii=False, default=str)
        
        logger.info(f"Results saved to {path}")

