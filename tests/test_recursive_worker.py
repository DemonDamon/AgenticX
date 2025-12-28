"""
Recursive Worker 冒烟测试

验证内化自 AgentScope 的 spawn_worker 机制：
1. WorkerSpawner 基本功能
2. Worker 执行和结果收集
3. 流式响应
4. 与 MiningPlannerAgent 的集成
"""

import pytest
import asyncio
from typing import Dict, Any, List

from agenticx.agents import (
    MiningPlannerAgent,
    WorkerSpawner,
    WorkerConfig,
    WorkerResult,
    WorkerContext,
    WorkerExecution,
    WorkerStatus,
)
from agenticx.core.plan_notebook import PlanNotebook


# =============================================================================
# WorkerResult 测试
# =============================================================================

class TestWorkerResult:
    """WorkerResult 数据模型测试"""
    
    def test_create_result(self):
        """测试创建 WorkerResult"""
        result = WorkerResult(
            success=True,
            message="任务完成",
            artifacts=["output.txt"],
            insights=["发现关键信息"]
        )
        
        assert result.success is True
        assert result.message == "任务完成"
        assert len(result.artifacts) == 1
        assert len(result.insights) == 1
    
    def test_default_values(self):
        """测试默认值"""
        result = WorkerResult(
            success=False,
            message="任务失败"
        )
        
        assert result.artifacts == []
        assert result.insights == []
        assert result.metadata == {}


# =============================================================================
# WorkerConfig 测试
# =============================================================================

class TestWorkerConfig:
    """WorkerConfig 配置测试"""
    
    def test_default_config(self):
        """测试默认配置"""
        config = WorkerConfig()
        
        assert config.name == "Worker"
        assert config.max_iterations == 10
        assert config.timeout_seconds == 300
        assert config.inherit_tools is True
    
    def test_custom_config(self):
        """测试自定义配置"""
        config = WorkerConfig(
            name="CustomWorker",
            max_iterations=5,
            tools=["search", "analyze"]
        )
        
        assert config.name == "CustomWorker"
        assert config.max_iterations == 5
        assert len(config.tools) == 2


# =============================================================================
# WorkerExecution 测试
# =============================================================================

class TestWorkerExecution:
    """WorkerExecution 执行记录测试"""
    
    def test_create_execution(self):
        """测试创建执行记录"""
        context = WorkerContext(
            task_description="测试任务"
        )
        execution = WorkerExecution(context=context)
        
        assert execution.status == WorkerStatus.PENDING
        assert execution.result is None
        assert execution.iterations == 0
    
    def test_start_execution(self):
        """测试开始执行"""
        context = WorkerContext(task_description="测试任务")
        execution = WorkerExecution(context=context)
        
        execution.start()
        
        assert execution.status == WorkerStatus.RUNNING
        assert execution.started_at is not None
    
    def test_complete_execution(self):
        """测试完成执行"""
        context = WorkerContext(task_description="测试任务")
        execution = WorkerExecution(context=context)
        
        result = WorkerResult(success=True, message="完成")
        execution.complete(result)
        
        assert execution.status == WorkerStatus.COMPLETED
        assert execution.result is not None
        assert execution.finished_at is not None
    
    def test_fail_execution(self):
        """测试执行失败"""
        context = WorkerContext(task_description="测试任务")
        execution = WorkerExecution(context=context)
        
        execution.fail("发生错误")
        
        assert execution.status == WorkerStatus.FAILED
        assert execution.error == "发生错误"
    
    def test_cancel_execution(self):
        """测试取消执行"""
        context = WorkerContext(task_description="测试任务")
        execution = WorkerExecution(context=context)
        
        execution.cancel()
        
        assert execution.status == WorkerStatus.CANCELLED


# =============================================================================
# WorkerSpawner 核心测试
# =============================================================================

class TestWorkerSpawner:
    """WorkerSpawner 核心功能测试"""
    
    @pytest.fixture
    def spawner(self):
        """创建 WorkerSpawner 实例"""
        return WorkerSpawner()
    
    @pytest.mark.asyncio
    async def test_spawn_worker_basic(self, spawner):
        """测试基本的 Worker 创建"""
        result = await spawner.spawn_worker(
            task_description="测试任务：分析代码结构"
        )
        
        assert isinstance(result, WorkerResult)
        assert result.success is True
        assert "测试任务" in result.message or "Fallback" in result.message
    
    @pytest.mark.asyncio
    async def test_spawn_worker_with_config(self, spawner):
        """测试带配置的 Worker 创建"""
        config = WorkerConfig(
            name="AnalysisWorker",
            max_iterations=5
        )
        
        result = await spawner.spawn_worker(
            task_description="分析任务",
            config=config
        )
        
        assert isinstance(result, WorkerResult)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_with_context(self, spawner):
        """测试带上下文的 Worker 创建"""
        result = await spawner.spawn_worker(
            task_description="上下文任务",
            context={
                "parent_agent_id": "test-agent-001",
                "background": "这是背景信息"
            }
        )
        
        assert isinstance(result, WorkerResult)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_stream(self, spawner):
        """测试流式响应"""
        events = []
        
        async for event in await spawner.spawn_worker(
            task_description="流式任务",
            stream=True
        ):
            events.append(event)
        
        assert len(events) >= 2  # 至少有 started 和 completed
        
        # 检查事件类型
        event_types = [e["type"] for e in events]
        assert "started" in event_types
        assert "completed" in event_types or "failed" in event_types
    
    @pytest.mark.asyncio
    async def test_worker_history(self, spawner):
        """测试 Worker 历史记录"""
        # 执行几个任务
        await spawner.spawn_worker("任务1")
        await spawner.spawn_worker("任务2")
        
        history = spawner.get_worker_history()
        
        assert len(history) == 2
    
    @pytest.mark.asyncio
    async def test_worker_stats(self, spawner):
        """测试统计信息"""
        await spawner.spawn_worker("测试任务")
        
        stats = spawner.get_stats()
        
        assert "total_executions" in stats
        assert stats["total_executions"] >= 1
        assert "success_rate" in stats
    
    def test_get_tool_schema(self, spawner):
        """测试获取工具 Schema"""
        schema = spawner.get_tool_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "spawn_worker"
        assert "parameters" in schema["function"]
    
    @pytest.mark.asyncio
    async def test_call_tool(self, spawner):
        """测试工具调用接口"""
        result = await spawner.call_tool(
            task_description="工具调用测试",
            worker_name="TestWorker",
            max_iterations=3
        )
        
        assert isinstance(result, WorkerResult)


# =============================================================================
# 并发执行测试
# =============================================================================

class TestConcurrentWorkers:
    """并发 Worker 测试"""
    
    @pytest.mark.asyncio
    async def test_concurrent_spawn(self):
        """测试并发创建 Worker"""
        spawner = WorkerSpawner(max_concurrent_workers=2)
        
        # 并发执行 3 个任务
        tasks = [
            spawner.spawn_worker(f"并发任务 {i}")
            for i in range(3)
        ]
        
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 3
        assert all(isinstance(r, WorkerResult) for r in results)
    
    @pytest.mark.asyncio
    async def test_active_workers_tracking(self):
        """测试活跃 Worker 追踪"""
        spawner = WorkerSpawner(max_concurrent_workers=5)
        
        # 创建任务但不等待完成
        task = asyncio.create_task(spawner.spawn_worker("长任务"))
        
        # 给一点时间让任务开始
        await asyncio.sleep(0.05)
        
        # 等待任务完成
        await task
        
        # 完成后应该没有活跃 Worker
        assert len(spawner.get_active_workers()) == 0


# =============================================================================
# MiningPlannerAgent + WorkerSpawner 集成测试
# =============================================================================

class TestMiningPlannerWorkerIntegration:
    """MiningPlannerAgent 与 WorkerSpawner 集成测试"""
    
    @pytest.fixture
    def planner(self):
        """创建带完整功能的 MiningPlannerAgent"""
        notebook = PlanNotebook()
        return MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
    
    def test_planner_has_worker_spawner(self, planner):
        """测试 Planner 有 WorkerSpawner"""
        assert hasattr(planner, 'worker_spawner')
        assert isinstance(planner.worker_spawner, WorkerSpawner)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_method(self, planner):
        """测试 Planner 的 spawn_worker 方法"""
        result = await planner.spawn_worker(
            task_description="搜索 AgentScope 源码"
        )
        
        assert isinstance(result, WorkerResult)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_with_plan_context(self, planner):
        """测试带计划上下文的 Worker 创建"""
        # 先创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 创建 Worker
        result = await planner.spawn_worker(
            task_description="执行子任务"
        )
        
        assert isinstance(result, WorkerResult)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_for_step(self, planner):
        """测试为特定步骤创建 Worker"""
        # 先创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 为第一个步骤创建 Worker
        result = await planner.spawn_worker_for_step(0)
        
        assert isinstance(result, WorkerResult)
    
    @pytest.mark.asyncio
    async def test_spawn_worker_for_step_invalid_index(self, planner):
        """测试无效步骤索引"""
        # 先创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 使用无效索引
        result = await planner.spawn_worker_for_step(999)
        
        assert result.success is False
        assert "Invalid step index" in result.message
    
    @pytest.mark.asyncio
    async def test_spawn_worker_for_step_no_plan(self, planner):
        """测试无计划时创建 Worker"""
        # 不创建计划
        result = await planner.spawn_worker_for_step(0)
        
        assert result.success is False
        assert "No active plan" in result.message
    
    def test_get_spawn_worker_tool_schema(self, planner):
        """测试获取 spawn_worker 工具 Schema"""
        schema = planner.get_spawn_worker_tool_schema()
        
        assert schema["function"]["name"] == "spawn_worker"
    
    def test_get_worker_stats(self, planner):
        """测试获取 Worker 统计"""
        stats = planner.get_worker_stats()
        
        assert "total_executions" in stats
        assert "active_workers" in stats


# =============================================================================
# 完整工作流测试
# =============================================================================

class TestFullRecursiveWorkflow:
    """完整递归 Worker 工作流测试"""
    
    @pytest.mark.asyncio
    async def test_planner_with_workers_workflow(self):
        """测试 Planner + Worker 完整工作流"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 1. 创建挖掘计划
        plan = await planner.plan(
            goal="分析 AgentScope 的 PlanNotebook 实现",
            sync_to_notebook=True
        )
        assert plan is not None
        
        # 2. 获取计划提示
        hint = await planner.get_current_plan_hint()
        assert hint is not None
        
        # 3. 开始第一个步骤
        await planner.update_step_status(0, "in_progress")
        
        # 4. 为该步骤创建 Worker
        worker_result = await planner.spawn_worker_for_step(0)
        assert worker_result.success is True
        
        # 5. 完成步骤
        await planner.update_step_status(0, "completed", outcome=worker_result.message)
        
        # 6. 验证状态
        assert notebook.current_plan.subtasks[0].state == "done"
        
        # 7. 检查 Worker 统计
        worker_stats = planner.get_worker_stats()
        assert worker_stats["total_executions"] >= 1
    
    @pytest.mark.asyncio
    async def test_multiple_workers_for_plan(self):
        """测试为计划的多个步骤创建 Worker"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 创建计划
        await planner.plan(goal="多步骤任务", sync_to_notebook=True)
        
        num_steps = len(notebook.current_plan.subtasks)
        worker_results = []
        
        # 为每个步骤创建 Worker
        for i in range(num_steps):
            # 开始步骤
            await planner.update_step_status(i, "in_progress")
            
            # 创建 Worker
            result = await planner.spawn_worker_for_step(i)
            worker_results.append(result)
            
            # 完成步骤
            await planner.update_step_status(i, "completed", outcome=result.message)
        
        # 验证所有 Worker 都成功执行
        assert len(worker_results) == num_steps
        assert all(r.success for r in worker_results)
        
        # 验证所有步骤都完成
        assert all(s.state == "done" for s in notebook.current_plan.subtasks)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

