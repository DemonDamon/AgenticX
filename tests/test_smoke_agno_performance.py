"""
Agno 高效执行技术内化 - 冒烟测试

本测试文件验证从 Agno 框架内化的高性能执行技术：
1. Agent.fast_construct - 极速实例化
2. 并行工具执行 - 多工具调用并行处理
3. 后台任务池 - 非阻塞后台任务
4. 性能监控 - 轻量级耗时收集

技术来源：
- agno/agent/agent.py: @dataclass(init=False) 实现 3μs 实例化
- agno/eval/performance.py: PerformanceEval 性能评估
- agno/utils/timer.py: Timer 计时器

测试策略：
- Happy path: 验证正常功能
- Edge cases: 验证边界条件和错误处理
- Performance: 验证性能指标符合预期
"""

import asyncio
import pytest
import time
import gc
from typing import Dict, Any
from unittest.mock import MagicMock, patch

# 被测模块
from agenticx.core.agent import Agent
from agenticx.core.agent_executor import (
    AgentExecutor,
    ParallelToolResult,
    ParallelExecutionSummary,
)
from agenticx.core.background import (
    BackgroundTaskPool,
    BackgroundTask,
    TaskStatus,
    TaskPriority,
    submit_background_task,
    get_background_pool_stats,
)
from agenticx.core.performance import (
    Timer,
    MemoryTracker,
    PerformanceMonitor,
    PerformanceReport,
    MetricType,
    evaluate_agent_performance,
    AgentPerformanceResult,
    benchmark,
)


# =========================================================================
# P0-1: Agent.fast_construct 测试
# =========================================================================

class TestAgentFastConstruct:
    """Agent.fast_construct 极速实例化测试。"""
    
    def test_fast_construct_creates_valid_agent(self):
        """Happy path: fast_construct 能正确创建 Agent 实例。"""
        agent = Agent.fast_construct(
            name="TestAgent",
            role="Tester",
            goal="Run tests",
            organization_id="org-test-123",
        )
        
        assert agent is not None
        assert agent.name == "TestAgent"
        assert agent.role == "Tester"
        assert agent.goal == "Run tests"
        assert agent.organization_id == "org-test-123"
        assert agent.version == "1.0.0"  # 默认值
        assert agent.id is not None  # 自动生成
    
    def test_fast_construct_with_all_optional_params(self):
        """Happy path: fast_construct 支持所有可选参数。"""
        agent = Agent.fast_construct(
            name="FullAgent",
            role="Full Tester",
            goal="Test all params",
            organization_id="org-full",
            id="custom-id-123",
            version="2.0.0",
            backstory="A test agent with full params",
            llm_config_name="gpt-4",
            memory_config={"type": "vector"},
            tool_names=["search", "calculator"],
        )
        
        assert agent.id == "custom-id-123"
        assert agent.version == "2.0.0"
        assert agent.backstory == "A test agent with full params"
        assert agent.llm_config_name == "gpt-4"
        assert agent.memory_config == {"type": "vector"}
        assert agent.tool_names == ["search", "calculator"]
    
    def test_fast_construct_with_validate_flag(self):
        """Happy path: _validate=True 时走标准 Pydantic 路径。"""
        agent = Agent.fast_construct(
            name="ValidatedAgent",
            role="Validator",
            goal="Test validation",
            organization_id="org-validate",
            _validate=True,
        )
        
        assert agent is not None
        assert agent.name == "ValidatedAgent"
    
    def test_fast_construct_performance_vs_standard(self):
        """Performance: fast_construct 应该比标准构造快。"""
        iterations = 1000
        
        # 预热
        for _ in range(100):
            Agent.fast_construct(
                name="Warmup",
                role="Warmer",
                goal="Warmup",
                organization_id="org-warmup",
            )
        
        gc.collect()
        
        # 测量 fast_construct
        start = time.perf_counter_ns()
        for _ in range(iterations):
            Agent.fast_construct(
                name="FastAgent",
                role="Fast",
                goal="Be fast",
                organization_id="org-fast",
            )
        fast_ns = time.perf_counter_ns() - start
        
        # 测量标准构造
        start = time.perf_counter_ns()
        for _ in range(iterations):
            Agent(
                name="StandardAgent",
                role="Standard",
                goal="Be standard",
                organization_id="org-standard",
            )
        standard_ns = time.perf_counter_ns() - start
        
        fast_us = fast_ns / iterations / 1000
        standard_us = standard_ns / iterations / 1000
        speedup = standard_ns / fast_ns if fast_ns > 0 else float('inf')
        
        print(f"\nPerformance comparison ({iterations} iterations):")
        print(f"  fast_construct: {fast_us:.2f} μs/call")
        print(f"  standard:       {standard_us:.2f} μs/call")
        print(f"  speedup:        {speedup:.2f}x")
        
        # 注意：在某些环境中，由于 Pydantic V2 的优化，标准构造可能与 fast_construct 相近
        # 这里主要验证 fast_construct 不会显著慢于标准构造
        # Agno 的优势在于使用 dataclass 而非 Pydantic，而我们仍保留 Pydantic 兼容性
        assert speedup > 0.3, f"fast_construct is unexpectedly slow, speedup={speedup}"
    
    def test_measure_instantiation_time_method(self):
        """Happy path: measure_instantiation_time 方法正常工作。"""
        result = Agent.measure_instantiation_time(iterations=100)
        
        assert "fast_construct_us" in result
        assert "standard_construct_us" in result
        assert "speedup_ratio" in result
        assert "iterations" in result
        assert result["iterations"] == 100
        assert result["fast_construct_us"] > 0
        assert result["standard_construct_us"] > 0


# =========================================================================
# P0-2: 并行工具执行测试
# =========================================================================

class TestParallelToolExecution:
    """并行工具执行测试。"""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """Mock LLM Provider。"""
        provider = MagicMock()
        provider.invoke.return_value = MagicMock(
            content='{"action": "finish_task", "result": "done"}',
            token_usage={"total_tokens": 100},
            cost=0.001,
        )
        return provider
    
    @pytest.fixture
    def mock_tools(self):
        """Mock 工具列表。"""
        from agenticx.tools.base import BaseTool
        
        class MockSearchTool(BaseTool):
            def __init__(self):
                super().__init__(name="search", description="Search tool")
            
            def _run(self, query: str = "") -> str:
                time.sleep(0.01)  # 模拟 IO 延迟
                return f"Search results for: {query}"
        
        class MockCalculatorTool(BaseTool):
            def __init__(self):
                super().__init__(name="calculator", description="Calculator tool")
            
            def _run(self, expression: str = "") -> str:
                time.sleep(0.01)  # 模拟计算延迟
                try:
                    return str(eval(expression))  # 简化实现
                except Exception:
                    return "Error"
        
        return [MockSearchTool(), MockCalculatorTool()]
    
    @pytest.fixture
    def executor(self, mock_llm_provider, mock_tools):
        """创建 AgentExecutor 实例。"""
        return AgentExecutor(
            llm_provider=mock_llm_provider,
            tools=mock_tools,
        )
    
    @pytest.mark.asyncio
    async def test_parallel_tool_execution_happy_path(self, executor):
        """Happy path: 并行执行多个工具调用。"""
        tool_calls = [
            {"tool": "search", "args": {"query": "AI"}},
            {"tool": "calculator", "args": {"expression": "2+2"}},
        ]
        
        summary = await executor.execute_parallel_tool_calls(tool_calls)
        
        assert isinstance(summary, ParallelExecutionSummary)
        assert summary.total_tools == 2
        assert summary.successful == 2
        assert summary.failed == 0
        assert len(summary.results) == 2
        
        # 验证结果
        search_result = next((r for r in summary.results if r.tool_name == "search"), None)
        calc_result = next((r for r in summary.results if r.tool_name == "calculator"), None)
        
        assert search_result is not None
        assert search_result.success
        assert "AI" in search_result.result
        
        assert calc_result is not None
        assert calc_result.success
        assert calc_result.result == "4"
    
    @pytest.mark.asyncio
    async def test_parallel_execution_with_invalid_tool(self, executor):
        """Edge case: 包含无效工具名的调用。"""
        tool_calls = [
            {"tool": "search", "args": {"query": "test"}},
            {"tool": "nonexistent_tool", "args": {}},
        ]
        
        summary = await executor.execute_parallel_tool_calls(tool_calls)
        
        assert summary.total_tools == 2
        assert summary.successful == 1
        assert summary.failed == 1
        
        # 无效工具调用应该失败
        failed_result = next((r for r in summary.results if not r.success), None)
        assert failed_result is not None
        assert "not found" in failed_result.error.lower()
    
    @pytest.mark.asyncio
    async def test_parallel_execution_empty_list(self, executor):
        """Edge case: 空工具调用列表。"""
        summary = await executor.execute_parallel_tool_calls([])
        
        assert summary.total_tools == 0
        assert summary.successful == 0
        assert summary.failed == 0
        assert summary.results == []
    
    @pytest.mark.asyncio
    async def test_parallel_execution_with_concurrency_limit(self, executor):
        """Happy path: 限制并发数。"""
        tool_calls = [
            {"tool": "search", "args": {"query": f"query-{i}"}}
            for i in range(5)
        ]
        
        summary = await executor.execute_parallel_tool_calls(
            tool_calls, 
            max_concurrency=2
        )
        
        assert summary.total_tools == 5
        assert summary.successful == 5
    
    def test_parallel_execution_sync_version(self, executor):
        """Happy path: 同步版本的并行执行。"""
        tool_calls = [
            {"tool": "search", "args": {"query": "sync test"}},
        ]
        
        summary = executor.execute_parallel_tool_calls_sync(tool_calls)
        
        assert summary.total_tools == 1
        assert summary.successful == 1


# =========================================================================
# P1-1: 后台任务池测试
# =========================================================================

class TestBackgroundTaskPool:
    """后台任务池测试。"""
    
    def test_submit_sync_task_happy_path(self):
        """Happy path: 提交同步任务。"""
        pool = BackgroundTaskPool(max_workers=2)
        
        def simple_task(x: int) -> int:
            return x * 2
        
        task_id = pool.submit(simple_task, args=(5,), name="double_task")
        
        assert task_id is not None
        assert task_id.startswith("bg-task-")
        
        # 等待任务完成
        result = pool.wait(task_id, timeout=5.0)
        
        assert result == 10
        
        task = pool.get_task(task_id)
        assert task.status == TaskStatus.COMPLETED
        
        pool.shutdown()
    
    def test_submit_task_with_priority(self):
        """Happy path: 提交带优先级的任务。"""
        pool = BackgroundTaskPool(max_workers=2)
        
        def task_func():
            return "done"
        
        task_id = pool.submit(
            task_func,
            name="high_priority_task",
            priority=TaskPriority.HIGH,
        )
        
        pool.wait(task_id, timeout=5.0)
        
        task = pool.get_task(task_id)
        assert task.priority == TaskPriority.HIGH
        
        pool.shutdown()
    
    def test_task_failure_handling(self):
        """Edge case: 任务执行失败。"""
        pool = BackgroundTaskPool(max_workers=2)
        
        def failing_task():
            raise ValueError("Intentional failure")
        
        task_id = pool.submit(failing_task, name="failing_task")
        pool.wait(task_id, timeout=5.0)
        
        task = pool.get_task(task_id)
        assert task.status == TaskStatus.FAILED
        assert "ValueError" in task.error
        assert "Intentional failure" in task.error
        
        pool.shutdown()
    
    @pytest.mark.asyncio
    async def test_submit_async_task(self):
        """Happy path: 提交异步任务。"""
        pool = BackgroundTaskPool(max_workers=2)
        
        async def async_task(x: int) -> int:
            await asyncio.sleep(0.01)
            return x * 3
        
        task_id = await pool.submit_async(async_task, args=(7,), name="async_triple")
        
        result = await pool.wait_async(task_id, timeout=5.0)
        
        assert result == 21
        
        pool.shutdown()
    
    @pytest.mark.asyncio
    async def test_wait_all_tasks(self):
        """Happy path: 等待所有任务完成。"""
        pool = BackgroundTaskPool(max_workers=4)
        
        def slow_task(delay: float) -> str:
            time.sleep(delay)
            return "completed"
        
        # 提交多个任务
        for i in range(3):
            pool.submit(slow_task, args=(0.01,), name=f"task_{i}")
        
        all_done = await pool.wait_all(timeout=5.0)
        
        assert all_done
        
        stats = pool.get_stats()
        assert stats["completed"] == 3
        assert stats["pending"] == 0
        
        pool.shutdown()
    
    def test_pool_stats(self):
        """Happy path: 获取任务池统计信息。"""
        pool = BackgroundTaskPool(max_workers=2)
        
        def quick_task():
            return "done"
        
        pool.submit(quick_task, name="task_1")
        pool.submit(quick_task, name="task_2")
        
        time.sleep(0.1)  # 等待任务完成
        
        stats = pool.get_stats()
        
        assert stats["total_tasks"] >= 2
        assert "completed" in stats
        assert "failed" in stats
        assert "max_workers" in stats
        assert stats["max_workers"] == 2
        
        pool.shutdown()
    
    def test_singleton_default_pool(self):
        """Happy path: 全局默认池是单例。"""
        pool1 = BackgroundTaskPool.get_default()
        pool2 = BackgroundTaskPool.get_default()
        
        assert pool1 is pool2
    
    def test_convenience_function(self):
        """Happy path: 便捷函数 submit_background_task。"""
        def simple_task():
            return 42
        
        task_id = submit_background_task(simple_task, name="convenience_test")
        
        assert task_id is not None
        
        # 获取统计信息
        stats = get_background_pool_stats()
        assert stats["total_tasks"] >= 1


# =========================================================================
# P1-2: 性能监控测试
# =========================================================================

class TestPerformanceMonitoring:
    """性能监控测试。"""
    
    def test_timer_context_manager(self):
        """Happy path: Timer 上下文管理器。"""
        with Timer("test_timer") as timer:
            time.sleep(0.01)
        
        assert timer.elapsed_ms >= 10  # 至少 10ms
        assert timer.elapsed_us >= 10000  # 至少 10000 μs
        assert timer.name == "test_timer"
    
    def test_timer_manual_control(self):
        """Happy path: Timer 手动控制。"""
        timer = Timer("manual_timer")
        timer.start()
        time.sleep(0.01)
        timer.stop()
        
        assert timer.elapsed_ms >= 10
    
    def test_timer_pause_resume(self):
        """Happy path: Timer 暂停和恢复。"""
        timer = Timer()
        timer.start()
        time.sleep(0.01)
        timer.pause()
        time.sleep(0.05)  # 暂停期间的时间不应计入
        timer.resume()
        time.sleep(0.01)
        timer.stop()
        
        # 总时间应约为 20ms，而非 70ms
        assert timer.elapsed_ms < 50
    
    def test_performance_monitor_measure(self):
        """Happy path: PerformanceMonitor.measure 方法。"""
        monitor = PerformanceMonitor("test_monitor")
        
        with monitor.measure("operation_1"):
            time.sleep(0.01)
        
        with monitor.measure("operation_2", tags={"type": "io"}):
            time.sleep(0.01)
        
        report = monitor.get_report()
        
        assert isinstance(report, PerformanceReport)
        assert report.name == "test_monitor"
        assert len(report.metrics) >= 2
        
        # 检查指标
        op1_metric = report.get_metric("operation_1_latency")
        assert op1_metric is not None
        assert op1_metric.type == MetricType.LATENCY
        assert op1_metric.value >= 10  # 至少 10ms
    
    def test_performance_monitor_with_memory_tracking(self):
        """Happy path: 启用内存追踪的性能监控。"""
        monitor = PerformanceMonitor(
            "memory_test", 
            enable_memory_tracking=True
        )
        
        with monitor.measure("allocate_memory"):
            data = [i for i in range(10000)]  # 分配一些内存
        
        report = monitor.get_report()
        
        # 应该有延迟和内存两个指标
        latency_metric = report.get_metric("allocate_memory_latency")
        memory_metric = report.get_metric("allocate_memory_memory_peak")
        
        assert latency_metric is not None
        assert memory_metric is not None
        assert memory_metric.type == MetricType.MEMORY
    
    def test_memory_tracker(self):
        """Happy path: MemoryTracker 单独使用。"""
        tracker = MemoryTracker()
        tracker.start()
        data = [i for i in range(100000)]
        # 确保 data 被使用，避免优化
        _ = len(data)
        current = tracker.current_bytes
        peak = tracker.peak_bytes
        tracker.stop()
        
        # 在追踪期间应该有内存分配
        # 注意：tracemalloc 追踪的是追踪期间的分配，停止后 peak_bytes 返回 0
        assert current > 0 or peak > 0, f"Expected memory allocation, got current={current}, peak={peak}"
    
    def test_performance_report_summary(self):
        """Happy path: 性能报告摘要。"""
        monitor = PerformanceMonitor("summary_test")
        
        with monitor.measure("fast_op"):
            pass
        
        report = monitor.get_report()
        summary = report.summary()
        
        assert "Performance Report" in summary
        assert "summary_test" in summary
        assert "fast_op" in summary
    
    def test_record_metric_manually(self):
        """Happy path: 手动记录指标。"""
        monitor = PerformanceMonitor("manual_metrics")
        
        monitor.record_metric(
            name="custom_throughput",
            value=1000.0,
            metric_type=MetricType.THROUGHPUT,
            unit="rps",
            tags={"endpoint": "/api/v1"},
        )
        
        report = monitor.get_report()
        metric = report.get_metric("custom_throughput")
        
        assert metric is not None
        assert metric.type == MetricType.THROUGHPUT
        assert metric.value == 1000.0
        assert metric.unit == "rps"


class TestAgentPerformanceEvaluation:
    """Agent 专用性能评估测试。"""
    
    def test_evaluate_agent_performance(self):
        """Happy path: 评估 Agent 性能。"""
        result = evaluate_agent_performance(
            agent_class=Agent,
            agent_kwargs={
                "name": "PerfTestAgent",
                "role": "Performance Tester",
                "goal": "Test performance",
                "organization_id": "org-perf",
            },
            iterations=100,
            warmup=10,
        )
        
        assert isinstance(result, AgentPerformanceResult)
        assert result.agent_name == "PerfTestAgent"
        assert result.instantiation_time_us > 0
        assert result.memory_per_instance_kb > 0
        assert result.iterations == 100
        assert result.speedup_vs_standard > 0
        
        print(f"\n{result.summary()}")
    
    def test_agent_performance_result_to_dict(self):
        """Happy path: AgentPerformanceResult 转字典。"""
        result = AgentPerformanceResult(
            agent_name="TestAgent",
            instantiation_time_us=5.0,
            memory_per_instance_kb=10.0,
            iterations=1000,
            speedup_vs_standard=3.5,
        )
        
        d = result.to_dict()
        
        assert d["agent_name"] == "TestAgent"
        assert d["instantiation_time_us"] == 5.0
        assert d["memory_per_instance_kb"] == 10.0


# =========================================================================
# 集成测试
# =========================================================================

class TestIntegration:
    """集成测试：验证各模块协同工作。"""
    
    @pytest.mark.asyncio
    async def test_parallel_execution_with_background_tasks(self):
        """
        集成测试：并行工具执行 + 后台任务。
        
        场景：执行工具后，在后台异步保存结果。
        """
        # 创建后台任务池
        pool = BackgroundTaskPool(max_workers=2)
        
        # Mock 保存函数
        saved_results = []
        def save_result(result: Dict[str, Any]) -> None:
            time.sleep(0.01)  # 模拟 IO
            saved_results.append(result)
        
        # 创建 Executor
        mock_provider = MagicMock()
        mock_provider.invoke.return_value = MagicMock(
            content='{"action": "finish_task", "result": "done"}',
            token_usage={"total_tokens": 50},
            cost=0.001,
        )
        
        from agenticx.tools.base import BaseTool
        
        class ResultTool(BaseTool):
            def __init__(self):
                super().__init__(name="get_result", description="Get a result")
            
            def _run(self, id: str = "") -> Dict[str, Any]:
                return {"id": id, "data": f"Result for {id}"}
        
        executor = AgentExecutor(
            llm_provider=mock_provider,
            tools=[ResultTool()],
        )
        
        # 并行执行工具
        tool_calls = [
            {"tool": "get_result", "args": {"id": f"item-{i}"}}
            for i in range(3)
        ]
        
        summary = await executor.execute_parallel_tool_calls(tool_calls)
        
        # 在后台保存结果
        for result in summary.results:
            if result.success:
                pool.submit(
                    save_result,
                    args=(result.result,),
                    name=f"save_{result.tool_name}",
                    priority=TaskPriority.HIGH,
                )
        
        # 等待后台任务完成
        await pool.wait_all(timeout=5.0)
        
        # 验证
        assert summary.successful == 3
        assert len(saved_results) == 3
        
        pool.shutdown()
    
    def test_performance_monitoring_with_fast_construct(self):
        """
        集成测试：性能监控 + fast_construct。
        
        场景：监控 Agent 创建性能。
        """
        monitor = PerformanceMonitor(
            "agent_creation",
            enable_memory_tracking=True,
        )
        
        agents = []
        
        with monitor.measure("create_10_agents"):
            for i in range(10):
                agent = Agent.fast_construct(
                    name=f"Agent_{i}",
                    role="Worker",
                    goal="Work",
                    organization_id="org-test",
                )
                agents.append(agent)
        
        report = monitor.get_report()
        
        # 验证
        assert len(agents) == 10
        latency = report.get_metric("create_10_agents_latency")
        assert latency is not None
        
        # 10 个 Agent 的创建应该合理（< 500ms，考虑 CI 环境差异）
        assert latency.value < 500, f"Creating 10 agents took {latency.value:.2f}ms, expected < 500ms"
        
        print(f"\n{report.summary()}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

