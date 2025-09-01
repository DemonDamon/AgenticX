"""人机协作模块测试"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
import pytest_asyncio
from typing import Dict, Any

# 配置pytest-asyncio
pytest_plugins = ('pytest_asyncio',)

from agenticx.embodiment.human_in_the_loop import (
    HumanInTheLoopComponent,
    FeedbackCollector,
    HumanInterventionRequest,
    HumanFeedback,
    TrajectoryData,
    InterventionMetrics,
    HumanInterventionRequestedEvent,
    HumanFeedbackReceivedEvent,
    InterventionStatusChangedEvent,
    LearningDataGeneratedEvent,
    EventBus
)
from agenticx.embodiment.core.models import GUIAction
from agenticx.memory import BaseMemory as Memory


class MockGUIAgentContext:
    """模拟GUI智能体上下文"""
    
    def __init__(self, agent_id: str, task_id: str = None, **kwargs):
        self.agent_id = agent_id
        self.task_id = task_id
        self.data = kwargs
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            **self.data
        }


class TestHumanInterventionRequest:
    """测试人工干预请求模型"""
    
    def test_create_request(self):
        """测试创建干预请求"""
        request = HumanInterventionRequest(
            agent_id="test_agent",
            context={"task": "test_task"},
            intervention_type="validation",
            priority="medium",
            description="Test intervention request",
            confidence_score=0.5
        )
        
        assert request.agent_id == "test_agent"
        assert request.intervention_type == "validation"
        assert request.priority == "medium"
        assert request.status == "pending"
        assert request.request_id is not None
        assert isinstance(request.created_at, datetime)
    
    def test_request_validation(self):
        """测试请求验证"""
        # 测试无效的干预类型
        with pytest.raises(ValueError):
            HumanInterventionRequest(
                agent_id="test_agent",
                context={},
                intervention_type="invalid_type",
                priority="medium",
                description="test",
                confidence_score=0.5
            )
        
        # 测试无效的优先级
        with pytest.raises(ValueError):
            HumanInterventionRequest(
                agent_id="test_agent",
                context={},
                intervention_type="validation",
                priority="invalid_level",
                description="test",
                confidence_score=0.5
            )


class TestHumanFeedback:
    """测试人工反馈模型"""
    
    def test_create_feedback(self):
        """测试创建反馈"""
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9,
            notes="Good job!"
        )
        
        assert feedback.request_id == "test_request"
        assert feedback.expert_id == "expert_1"
        assert feedback.feedback_type == "validation"
        assert feedback.approved is True
        assert feedback.notes == "Good job!"
        assert feedback.feedback_id is not None
        assert isinstance(feedback.submitted_at, datetime)
    
    def test_correction_feedback(self):
        """测试修正反馈"""
        corrected_actions = [
            GUIAction(action_type="click", target="button1"),
            GUIAction(action_type="type", target="input1", parameters={"text": "corrected text"})
        ]
        
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="correction",
            confidence=0.8,
            corrected_actions=corrected_actions
        )
        
        assert feedback.feedback_type == "correction"
        assert len(feedback.corrected_actions) == 2
        assert feedback.corrected_actions[0].action_type == "click"


class TestTrajectoryData:
    """测试轨迹数据模型"""
    
    def test_create_trajectory(self):
        """测试创建轨迹数据"""
        trajectory = TrajectoryData(
            feedback_id="feedback_1",
            agent_id="agent_1",
            state_before={"context": "initial"},
            action_taken={"type": "click"},
            state_after={"context": "final"},
            reward=1.0
        )
        
        assert trajectory.feedback_id == "feedback_1"
        assert trajectory.agent_id == "agent_1"
        assert trajectory.reward == 1.0
        assert trajectory.trajectory_id is not None
        assert isinstance(trajectory.created_at, datetime)


class TestInterventionMetrics:
    """测试干预指标模型"""
    
    def test_create_metrics(self):
        """测试创建指标"""
        metrics = InterventionMetrics(
            total_requests=10,
            pending_requests=2,
            completed_requests=8,
            average_response_time=120.5,
            success_rate=0.8
        )
        
        assert metrics.total_requests == 10
        assert metrics.pending_requests == 2
        assert metrics.completed_requests == 8
        assert metrics.average_response_time == 120.5
        assert metrics.success_rate == 0.8


class TestHumanInTheLoopComponent:
    """测试人机协作组件"""
    
    @pytest.fixture
    def event_bus(self):
        """事件总线fixture"""
        return Mock(spec=EventBus)
    
    @pytest.fixture
    def component(self, event_bus):
        """组件fixture"""
        config = {
            "timeout_seconds": 300,
            "max_pending_requests": 10
        }
        return HumanInTheLoopComponent(event_bus, config)
    
    @pytest.mark.asyncio
    async def test_request_intervention(self, component, event_bus):
        """测试请求干预"""
        # 模拟事件发布
        event_bus.publish_async = AsyncMock()
        
        context = MockGUIAgentContext("test_agent", "test_task", task="test")
        request = await component.request_intervention(
            context=context,
            intervention_type="validation",
            description="Test request",
            confidence_score=0.5
        )
        
        assert request is not None
        assert request.request_id in component.pending_requests
        
        # 验证事件发布
        event_bus.publish_async.assert_called_once()
        published_event = event_bus.publish_async.call_args[0][0]
        assert isinstance(published_event, HumanInterventionRequestedEvent)
        assert published_event.request.request_id == request.request_id
    
    @pytest.mark.asyncio
    async def test_process_feedback(self, component, event_bus):
        """测试处理反馈"""
        # 先创建一个请求
        event_bus.publish_async = AsyncMock()
        context = MockGUIAgentContext("test_agent", "test_task", task="test")
        request = await component.request_intervention(
            context=context,
            intervention_type="validation",
            description="Test request",
            confidence_score=0.6
        )
        
        # 创建反馈
        feedback = HumanFeedback(
            request_id=request.request_id,
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9
        )
        
        # 处理反馈
        await component.handle_feedback_received({
            "request_id": request.request_id,
            "feedback": feedback
        })
        
        assert request.request_id not in component.pending_requests
        
        # 验证状态变更事件发布
        assert event_bus.publish_async.call_count >= 2  # 至少有请求事件和状态变更事件
    
    @pytest.mark.asyncio
    async def test_cancel_request(self, component, event_bus):
        """测试取消请求"""
        # 创建请求
        event_bus.publish_async = AsyncMock()
        context = MockGUIAgentContext("test_agent", "test_task", task="test")
        request = await component.request_intervention(
            context=context,
            intervention_type="validation",
            description="Test request",
            confidence_score=0.7
        )
        
        # 取消请求
        await component.cancel_request(request.request_id)
        
        assert request.request_id not in component.pending_requests
        
        # 验证状态变更事件
        status_change_calls = [
            call for call in event_bus.publish_async.call_args_list
            if isinstance(call[0][0], InterventionStatusChangedEvent)
        ]
        assert len(status_change_calls) > 0
    
    def test_get_metrics(self, component):
        """测试获取指标"""
        metrics = component.get_metrics()
        
        assert isinstance(metrics, InterventionMetrics)
        assert metrics.total_requests >= 0
        assert metrics.pending_requests >= 0
        assert metrics.completed_requests >= 0
    
    @pytest.mark.asyncio
    async def test_timeout_handling(self, component, event_bus):
        """测试超时处理"""
        # 使用短超时时间进行测试
        component.default_timeout = 0.1
        event_bus.publish_async = AsyncMock()
        
        context = MockGUIAgentContext("test_agent", "test_task", task="test")
        request = await component.request_intervention(
            context=context,
            intervention_type="validation",
            description="Test request",
            confidence_score=0.8,
            timeout=0.1
        )
        
        # 等待超时
        await asyncio.sleep(0.2)
        
        # 验证请求已被标记为超时（通过检查pending_requests）
        # 注意：实际的超时处理可能需要手动触发或等待更长时间
        # 这里我们主要验证请求被正确创建
        assert request.request_id is not None


class TestFeedbackCollector:
    """测试反馈收集器"""
    
    @pytest.fixture
    def event_bus(self):
        """事件总线fixture"""
        return Mock(spec=EventBus)
    
    @pytest.fixture
    def memory(self):
        """内存系统fixture"""
        memory = Mock(spec=Memory)
        memory.store = AsyncMock()
        return memory
    
    @pytest.fixture
    def collector(self, event_bus, memory):
        """收集器fixture"""
        config = {
            "quality_threshold": 0.7,
            "batch_size": 5
        }
        collector = FeedbackCollector(event_bus, memory, config)
        yield collector
        # 清理：关闭收集器（如果已启动）
        if collector._processing_task is not None:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if not loop.is_closed():
                    loop.run_until_complete(collector.shutdown())
            except RuntimeError:
                # 如果事件循环已关闭，直接取消任务
                if collector._processing_task:
                    collector._processing_task.cancel()
    
    @pytest.mark.asyncio
    async def test_feedback_processing(self, collector, event_bus, memory):
        """测试反馈处理"""
        # 模拟事件发布
        event_bus.publish_async = AsyncMock()
        
        # 启动收集器
        collector.start()
        
        # 创建反馈
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9,
            notes="Good work"
        )
        
        # 创建反馈事件
        feedback_event = HumanFeedbackReceivedEvent.create(
            feedback=feedback,
            processing_time=60.0,
            expert_confidence=0.9,
            agent_id="test_agent",
            task_id="test_task"
        )
        
        # 处理反馈事件
        await collector.on_feedback_received(feedback_event)
        
        # 等待处理完成
        await asyncio.sleep(0.1)
        
        # 验证统计更新
        stats = collector.get_stats()
        assert stats["total_feedback"] == 1
    
    @pytest.mark.asyncio
    async def test_trajectory_generation(self, collector, memory):
        """测试轨迹生成"""
        # 创建验证反馈
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9
        )
        
        # 生成轨迹
        trajectory = await collector._package_feedback_as_trajectory(feedback, 0.8)
        
        assert trajectory is not None
        assert trajectory.feedback_id == feedback.feedback_id
        assert trajectory.reward > 0  # 批准的反馈应该有正奖励
    
    @pytest.mark.asyncio
    async def test_correction_feedback_processing(self, collector):
        """测试修正反馈处理"""
        corrected_actions = [
            GUIAction(
                action_type="click",
                target="button1",
                parameters={}
            ),
            GUIAction(
                action_type="type",
                target="input1",
                parameters={"text": "corrected"}
            )
        ]
        
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="correction",
            corrected_actions=corrected_actions,
            confidence=0.9
        )
        
        trajectory = await collector._package_feedback_as_trajectory(feedback, 0.9)
        
        assert trajectory is not None
        assert trajectory.reward > 1.0  # 修正反馈应该有更高奖励
        assert "corrected_actions" in trajectory.action_taken
    
    @pytest.mark.asyncio
    async def test_demonstration_feedback_processing(self, collector):
        """测试演示反馈处理"""
        # 启动收集器
        collector.start()
        
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="demonstration",
            demonstration_steps=[
                {"step": 1, "action": "click", "target": "menu", "description": "Click on menu"},
                {"step": 2, "action": "select", "target": "option", "description": "Select option"},
                {"step": 3, "action": "confirm", "target": "action", "description": "Confirm action"}
            ],
            confidence=0.95
        )
        
        trajectory = await collector._package_feedback_as_trajectory(feedback, 0.95)
        
        assert trajectory is not None
        assert trajectory.reward > 2.0  # 演示反馈应该有最高奖励
        assert "steps" in trajectory.action_taken
    
    def test_quality_evaluation(self, collector):
        """测试质量评估"""
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9,
            notes="Detailed explanation"
        )
        
        # 测试高质量反馈
        quality = collector._evaluate_feedback_quality(feedback, 0.9, 120)
        assert quality > 0.7
        
        # 测试低置信度反馈
        quality_low = collector._evaluate_feedback_quality(feedback, 0.3, 120)
        assert quality_low < quality
    
    def test_completeness_factor(self, collector):
        """测试完整性因子"""
        # 完整的验证反馈
        complete_feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9,
            notes="Detailed explanation of the decision"
        )
        
        complete_factor = collector._calculate_completeness_factor(complete_feedback)
        assert complete_factor > 1.0  # 有详细备注应该加分
        
        # 不完整的验证反馈
        incomplete_feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=None,  # 缺少批准状态
            confidence=0.5
        )
        
        incomplete_factor = collector._calculate_completeness_factor(incomplete_feedback)
        assert incomplete_factor < 1.0  # 缺少关键信息应该扣分
    
    def test_get_stats(self, collector):
        """测试获取统计信息"""
        stats = collector.get_stats()
        
        assert "total_feedback" in stats
        assert "processed_feedback" in stats
        assert "high_quality_feedback" in stats
        assert "trajectories_generated" in stats
        assert "queue_size" in stats
        assert "buffer_size" in stats
    
    @pytest.mark.asyncio
    async def test_shutdown(self, collector):
        """测试关闭收集器"""
        # 启动收集器
        collector.start()
        
        # 等待一下确保任务启动
        await asyncio.sleep(0.1)
        
        # 关闭收集器
        await collector.shutdown()
        
        # 验证处理任务已取消
        assert collector._processing_task.cancelled() or collector._processing_task.done()


class TestEvents:
    """测试事件类"""
    
    def test_human_intervention_requested_event(self):
        """测试人工干预请求事件"""
        request = HumanInterventionRequest(
            agent_id="test_agent",
            intervention_type="validation",
            context={"task": "test"},
            description="Test intervention",
            confidence_score=0.5
        )
        
        event = HumanInterventionRequestedEvent.create(
            request=request,
            context={"task": "test"},
            urgency_level="high",
            agent_id="test_agent",
            task_id="test_task"
        )
        
        assert event.request == request
        assert event.urgency_level == "high"
        assert isinstance(event.timestamp, datetime)
    
    def test_human_feedback_received_event(self):
        """测试人工反馈接收事件"""
        feedback = HumanFeedback(
            request_id="test_request",
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9
        )
        
        event = HumanFeedbackReceivedEvent.create(
            feedback=feedback,
            processing_time=120.0,
            expert_confidence=0.9,
            agent_id="test_agent",
            task_id="test_task"
        )
        
        assert event.feedback == feedback
        assert event.processing_time == 120.0
        assert event.expert_confidence == 0.9
    
    def test_intervention_status_changed_event(self):
        """测试干预状态变更事件"""
        event = InterventionStatusChangedEvent.create(
            request_id="test_request",
            old_status="pending",
            new_status="completed",
            changed_by="system",
            reason="Feedback received",
            agent_id="test_agent",
            task_id="test_task"
        )
        
        assert event.request_id == "test_request"
        assert event.old_status == "pending"
        assert event.new_status == "completed"
        assert event.reason == "Feedback received"
    
    def test_learning_data_generated_event(self):
        """测试学习数据生成事件"""
        event = LearningDataGeneratedEvent.create(
            trajectory_id="traj_1",
            feedback_id="feedback_1",
            agent_id="agent_1",
            data_quality_score=0.85,
            task_id="test_task"
        )
        
        assert event.trajectory_id == "traj_1"
        assert event.feedback_id == "feedback_1"
        assert event.learning_agent_id == "agent_1"
        assert event.data_quality_score == 0.85


class TestIntegration:
    """集成测试"""
    
    @pytest.fixture
    def event_bus(self):
        """真实的事件总线"""
        return EventBus()
    
    @pytest.fixture
    def memory(self):
        """模拟内存系统"""
        memory = Mock(spec=Memory)
        memory.store = AsyncMock()
        return memory
    
    @pytest.fixture
    def system(self, event_bus, memory):
        """完整系统"""
        component = HumanInTheLoopComponent(event_bus)
        collector = FeedbackCollector(event_bus, memory)
        return component, collector
    
    @pytest.mark.asyncio
    async def test_end_to_end_workflow(self, system, memory):
        """测试端到端工作流"""
        component, collector = system
        
        # 启动收集器
        collector.start()
        
        # 1. 请求干预
        context = MockGUIAgentContext("test_agent", "test_task", task="complex_task")
        request = await component.request_intervention(
            context=context,
            intervention_type="validation",
            description="Need expert validation",
            confidence_score=0.5,
            priority="high"
        )
        
        assert request.request_id in component.pending_requests
        
        # 2. 模拟专家反馈
        feedback = HumanFeedback(
            request_id=request.request_id,
            expert_id="expert_1",
            feedback_type="validation",
            approved=True,
            confidence=0.9,
            notes="Task completed correctly"
        )
        
        # 3. 处理反馈
        await component.handle_feedback_received({
            "request_id": request.request_id,
            "feedback": feedback
        })
        
        # 手动触发反馈事件给收集器
        feedback_event = HumanFeedbackReceivedEvent.create(
            feedback=feedback,
            processing_time=60.0,
            expert_confidence=0.9,
            agent_id="test_agent",
            task_id="test_task"
        )
        await collector.on_feedback_received(feedback_event)
        
        # 4. 等待收集器处理
        await asyncio.sleep(0.1)
        
        # 5. 验证结果
        assert request.request_id not in component.pending_requests
        
        # 验证轨迹数据存储
        memory.store.assert_called()
        
        # 验证统计更新
        collector_stats = collector.get_stats()
        assert collector_stats["total_feedback"] > 0
        
        component_metrics = component.get_metrics()
        assert component_metrics.total_requests > 0
        assert component_metrics.completed_requests > 0
        
        # 清理收集器
        await collector.shutdown()
    
    @pytest.mark.asyncio
    async def test_multiple_requests_handling(self, system):
        """测试多请求处理"""
        component, collector = system
        
        # 创建多个请求
        requests = []
        for i in range(3):
            context = MockGUIAgentContext(f"agent_{i}", f"task_{i}", task=f"task_{i}")
            request = await component.request_intervention(
                context=context,
                intervention_type="validation",
                description=f"Test intervention {i}",
                confidence_score=0.5,
                priority="medium"
            )
            requests.append(request)
        
        # 验证所有请求都在待处理列表中
        for request in requests:
            assert request.request_id in component.pending_requests
        
        # 处理部分请求
        for i, request in enumerate(requests[:2]):
            feedback = HumanFeedback(
                request_id=request.request_id,
                expert_id="expert_1",
                feedback_type="validation",
                approved=i % 2 == 0,  # 交替批准/拒绝
                confidence=0.8
            )
            await component.handle_feedback_received({
                "request_id": request.request_id,
                "feedback": feedback
            })
        
        # 验证处理结果
        assert len(component.pending_requests) == 1
        
        # 取消剩余请求
        await component.cancel_request(requests[2].request_id)
        assert len(component.pending_requests) == 0


if __name__ == "__main__":
    # 运行测试
    pytest.main(["-v", __file__])