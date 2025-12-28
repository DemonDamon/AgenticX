"""
Discovery Loop 冒烟测试

验证内化自 AgentScope 的 Discovery Loop 机制：
1. Discovery 数据模型
2. DiscoveryBus 事件总线
3. DiscoveryRegistry 注册器
4. MiningPlannerAgent 的发现处理
5. 完整 Discovery Loop 工作流
"""

import pytest
import asyncio
from typing import List

from agenticx.core import (
    Discovery, DiscoveryType, DiscoveryPriority, DiscoveryStatus,
    DiscoveryBus, DiscoveryRegistry, DiscoveryEvent,
    get_discovery_bus, reset_discovery_bus,
    PlanNotebook,
)
from agenticx.agents import MiningPlannerAgent, WorkerSpawner


# =============================================================================
# Discovery 数据模型测试
# =============================================================================

class TestDiscoveryModel:
    """Discovery 数据模型测试"""
    
    def test_create_discovery(self):
        """测试创建 Discovery"""
        discovery = Discovery(
            type=DiscoveryType.TOOL,
            name="GitHub Search API",
            description="发现 GitHub 搜索 API",
            source_worker_id="worker-001",
        )
        
        assert discovery.type == DiscoveryType.TOOL
        assert discovery.name == "GitHub Search API"
        assert discovery.status == DiscoveryStatus.PENDING
        assert discovery.id is not None
    
    def test_discovery_acknowledge(self):
        """测试确认发现"""
        discovery = Discovery(
            type=DiscoveryType.API,
            name="Test API",
            description="Test",
            source_worker_id="worker-001",
        )
        
        discovery.acknowledge()
        
        assert discovery.status == DiscoveryStatus.ACKNOWLEDGED
        assert discovery.processed_at is not None
    
    def test_discovery_integrate(self):
        """测试集成发现"""
        discovery = Discovery(
            type=DiscoveryType.TOOL,
            name="Test Tool",
            description="Test",
            source_worker_id="worker-001",
        )
        
        discovery.integrate()
        
        assert discovery.status == DiscoveryStatus.INTEGRATED
    
    def test_discovery_reject(self):
        """测试拒绝发现"""
        discovery = Discovery(
            type=DiscoveryType.INSIGHT,
            name="Test Insight",
            description="Test",
            source_worker_id="worker-001",
        )
        
        discovery.reject("不相关")
        
        assert discovery.status == DiscoveryStatus.REJECTED
        assert discovery.metadata["rejection_reason"] == "不相关"
    
    def test_to_plan_suggestion(self):
        """测试转换为计划建议"""
        discovery = Discovery(
            type=DiscoveryType.TOOL,
            name="New Tool",
            description="新发现的工具",
            source_worker_id="worker-001",
            action_suggestions=["集成此工具"],
        )
        
        suggestion = discovery.to_plan_suggestion()
        
        assert suggestion["discovery_id"] == discovery.id
        assert suggestion["discovery_type"] == DiscoveryType.TOOL
        assert "subtask" in suggestion
        assert "New Tool" in suggestion["subtask"]["name"]


# =============================================================================
# DiscoveryBus 测试
# =============================================================================

class TestDiscoveryBus:
    """DiscoveryBus 事件总线测试"""
    
    @pytest.fixture
    def bus(self):
        """创建新的 DiscoveryBus"""
        return DiscoveryBus()
    
    @pytest.mark.asyncio
    async def test_publish_discovery(self, bus):
        """测试发布发现"""
        discovery = Discovery(
            type=DiscoveryType.TOOL,
            name="Test Tool",
            description="Test",
            source_worker_id="worker-001",
        )
        
        await bus.publish(discovery)
        
        discoveries = bus.get_discoveries()
        assert len(discoveries) == 1
        assert discoveries[0].name == "Test Tool"
    
    @pytest.mark.asyncio
    async def test_subscribe_and_receive(self, bus):
        """测试订阅和接收发现"""
        received = []
        
        async def handler(d: Discovery):
            received.append(d)
        
        bus.subscribe(handler, subscriber_id="test")
        
        await bus.publish(Discovery(
            type=DiscoveryType.API,
            name="Test API",
            description="Test",
            source_worker_id="worker-001",
        ))
        
        assert len(received) == 1
        assert received[0].name == "Test API"
    
    @pytest.mark.asyncio
    async def test_type_filter(self, bus):
        """测试类型过滤"""
        received = []
        
        async def handler(d: Discovery):
            received.append(d)
        
        # 只订阅 TOOL 类型
        bus.subscribe(handler, discovery_types=[DiscoveryType.TOOL])
        
        # 发布 API 类型（不应接收）
        await bus.publish(Discovery(
            type=DiscoveryType.API,
            name="API",
            description="Test",
            source_worker_id="w1",
        ))
        
        # 发布 TOOL 类型（应该接收）
        await bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Tool",
            description="Test",
            source_worker_id="w1",
        ))
        
        assert len(received) == 1
        assert received[0].type == DiscoveryType.TOOL
    
    @pytest.mark.asyncio
    async def test_unsubscribe(self, bus):
        """测试取消订阅"""
        received = []
        
        async def handler(d: Discovery):
            received.append(d)
        
        sub_id = bus.subscribe(handler)
        
        # 发布第一个
        await bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Tool 1",
            description="Test",
            source_worker_id="w1",
        ))
        
        # 取消订阅
        bus.unsubscribe(sub_id)
        
        # 发布第二个（不应接收）
        await bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Tool 2",
            description="Test",
            source_worker_id="w1",
        ))
        
        assert len(received) == 1
    
    def test_get_stats(self, bus):
        """测试获取统计"""
        stats = bus.get_stats()
        
        assert "total_published" in stats
        assert "subscribers_count" in stats
    
    @pytest.mark.asyncio
    async def test_get_pending_discoveries(self, bus):
        """测试获取待处理发现"""
        await bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Pending Tool",
            description="Test",
            source_worker_id="w1",
        ))
        
        pending = bus.get_pending_discoveries()
        assert len(pending) == 1
        assert pending[0].status == DiscoveryStatus.PENDING


# =============================================================================
# DiscoveryRegistry 测试
# =============================================================================

class TestDiscoveryRegistry:
    """DiscoveryRegistry 注册器测试"""
    
    @pytest.fixture
    def registry(self):
        """创建 DiscoveryRegistry"""
        bus = DiscoveryBus()
        return DiscoveryRegistry(bus=bus, worker_id="test-worker")
    
    @pytest.mark.asyncio
    async def test_register_tool(self, registry):
        """测试注册工具"""
        discovery = await registry.register_tool(
            name="GitHub API",
            description="GitHub 搜索 API",
            endpoint="https://api.github.com/search",
        )
        
        assert discovery.type == DiscoveryType.TOOL
        assert discovery.name == "GitHub API"
        assert discovery.data["endpoint"] == "https://api.github.com/search"
    
    @pytest.mark.asyncio
    async def test_register_api(self, registry):
        """测试注册 API"""
        discovery = await registry.register_api(
            name="MCP Server",
            description="MCP 服务端 API",
            base_url="http://localhost:8080",
            endpoints=[{"path": "/tools", "method": "GET"}],
        )
        
        assert discovery.type == DiscoveryType.API
        assert discovery.data["base_url"] == "http://localhost:8080"
    
    @pytest.mark.asyncio
    async def test_register_insight(self, registry):
        """测试注册洞察"""
        discovery = await registry.register_insight(
            name="MCP 趋势",
            description="MCP 使用率持续增长",
            evidence=["GitHub stars 增长 200%"],
            confidence=0.9,
        )
        
        assert discovery.type == DiscoveryType.INSIGHT
        assert discovery.data["confidence"] == 0.9
    
    @pytest.mark.asyncio
    async def test_register_resource(self, registry):
        """测试注册资源"""
        discovery = await registry.register_resource(
            name="AgentScope Repo",
            description="AgentScope 源码仓库",
            resource_type="repo",
            location="https://github.com/agentscope-ai/agentscope",
        )
        
        assert discovery.type == DiscoveryType.RESOURCE
        assert discovery.data["location"].endswith("agentscope")
    
    @pytest.mark.asyncio
    async def test_register_error(self, registry):
        """测试注册错误"""
        discovery = await registry.register_error(
            name="Rate Limit",
            description="GitHub API 限流",
            error_type="RateLimitError",
            recoverable=True,
            suggested_fix="等待 60 秒后重试",
        )
        
        assert discovery.type == DiscoveryType.ERROR
        assert discovery.data["recoverable"] is True
    
    @pytest.mark.asyncio
    async def test_get_local_discoveries(self, registry):
        """测试获取本地发现"""
        await registry.register_tool("Tool 1", "Test", endpoint="http://t1")
        await registry.register_api("API 1", "Test", base_url="http://a1")
        
        local = registry.get_local_discoveries()
        assert len(local) == 2


# =============================================================================
# MiningPlannerAgent Discovery 集成测试
# =============================================================================

class TestMiningPlannerDiscoveryIntegration:
    """MiningPlannerAgent 的 Discovery 集成测试"""
    
    @pytest.fixture(autouse=True)
    def reset_bus(self):
        """每个测试前重置全局 bus"""
        reset_discovery_bus()
        yield
        reset_discovery_bus()
    
    @pytest.fixture
    def planner(self):
        """创建带完整功能的 MiningPlannerAgent"""
        notebook = PlanNotebook()
        return MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook,
        )
    
    def test_planner_has_discovery_bus(self, planner):
        """测试 Planner 有 DiscoveryBus"""
        assert hasattr(planner, 'discovery_bus')
        assert planner.discovery_bus is not None
    
    @pytest.mark.asyncio
    async def test_planner_receives_discoveries(self, planner):
        """测试 Planner 接收发现"""
        # 模拟 Worker 发现
        await planner.discovery_bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="New Tool",
            description="Test tool",
            source_worker_id="worker-001",
        ))
        
        # 检查 Planner 收到
        discoveries = planner.get_all_discoveries()
        assert len(discoveries) == 1
        assert discoveries[0].name == "New Tool"
    
    @pytest.mark.asyncio
    async def test_get_pending_discoveries(self, planner):
        """测试获取待处理发现"""
        await planner.discovery_bus.publish(Discovery(
            type=DiscoveryType.API,
            name="Test API",
            description="Test",
            source_worker_id="w1",
        ))
        
        pending = planner.get_pending_discoveries()
        assert len(pending) == 1
    
    @pytest.mark.asyncio
    async def test_process_discoveries(self, planner):
        """测试处理发现"""
        await planner.discovery_bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Tool to Process",
            description="需要处理的工具",
            source_worker_id="w1",
        ))
        
        suggestions = await planner.process_discoveries()
        
        assert len(suggestions) == 1
        assert "subtask" in suggestions[0]
        
        # 发现应该被标记为已确认
        assert planner.get_pending_discoveries() == []
    
    @pytest.mark.asyncio
    async def test_auto_integrate_discoveries(self, planner):
        """测试自动集成发现"""
        # 先创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        initial_subtasks = len(planner.plan_notebook.current_plan.subtasks)
        
        # 发布高优先级发现
        await planner.discovery_bus.publish(Discovery(
            type=DiscoveryType.TOOL,
            name="Important Tool",
            description="重要的新工具",
            source_worker_id="w1",
            priority=DiscoveryPriority.HIGH,
        ))
        
        # 自动集成
        integrated = await planner.auto_integrate_discoveries()
        
        assert integrated == 1
        assert len(planner.plan_notebook.current_plan.subtasks) == initial_subtasks + 1
    
    def test_get_discovery_stats(self, planner):
        """测试获取发现统计"""
        stats = planner.get_discovery_stats()
        
        assert "total_discoveries" in stats
        assert "by_type" in stats
        assert "bus_stats" in stats


# =============================================================================
# 完整 Discovery Loop 工作流测试
# =============================================================================

class TestFullDiscoveryLoop:
    """完整 Discovery Loop 工作流测试"""
    
    @pytest.fixture(autouse=True)
    def reset_bus(self):
        """每个测试前重置全局 bus"""
        reset_discovery_bus()
        yield
        reset_discovery_bus()
    
    @pytest.mark.asyncio
    async def test_worker_discovery_to_planner(self):
        """测试 Worker 发现 -> Planner 接收 -> 计划调整"""
        # 1. 创建 Planner
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook,
        )
        
        # 2. 创建计划
        await planner.plan(goal="分析 AgentScope", sync_to_notebook=True)
        initial_subtasks = len(notebook.current_plan.subtasks)
        
        # 3. 模拟 Worker 发现新工具
        registry = DiscoveryRegistry(
            bus=planner.discovery_bus,
            worker_id="worker-001",
            current_task="搜索 API",
        )
        
        await registry.register_tool(
            name="AgentScope Plan API",
            description="发现 AgentScope 的计划管理 API",
            endpoint="agentscope.plan.PlanNotebook",
            priority=DiscoveryPriority.HIGH,
        )
        
        # 4. 验证 Planner 收到发现
        discoveries = planner.get_all_discoveries()
        assert len(discoveries) == 1
        assert discoveries[0].name == "AgentScope Plan API"
        
        # 5. 自动集成到计划
        integrated = await planner.auto_integrate_discoveries()
        assert integrated == 1
        
        # 6. 验证计划被更新
        assert len(notebook.current_plan.subtasks) == initial_subtasks + 1
        
        # 新子任务包含发现的信息
        new_subtask = notebook.current_plan.subtasks[-1]
        assert "AgentScope Plan API" in new_subtask.name
    
    @pytest.mark.asyncio
    async def test_multiple_discoveries_workflow(self):
        """测试多个发现的处理流程"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook,
        )
        
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 发布多个发现
        registry = DiscoveryRegistry(
            bus=planner.discovery_bus,
            worker_id="worker-001",
        )
        
        await registry.register_tool("Tool 1", "工具 1", priority=DiscoveryPriority.HIGH)
        await registry.register_api("API 1", "API 1", base_url="http://api1", priority=DiscoveryPriority.HIGH)
        await registry.register_insight("Insight 1", "洞察 1", priority=DiscoveryPriority.LOW)  # 低优先级不自动集成
        
        # 自动集成高优先级发现
        integrated = await planner.auto_integrate_discoveries()
        
        # 只有 TOOL 和 API 类型的高优先级发现会被集成
        assert integrated == 2
        
        # 统计
        stats = planner.get_discovery_stats()
        assert stats["total_discoveries"] == 3
    
    @pytest.mark.asyncio
    async def test_spawn_worker_with_discovery(self):
        """测试 spawn_worker 与 Discovery 的集成"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook,
        )
        
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 执行 Worker
        result = await planner.spawn_worker(
            task_description="搜索新工具"
        )
        
        assert result.success
        
        # Worker 统计
        worker_stats = planner.get_worker_stats()
        assert worker_stats["total_executions"] >= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

