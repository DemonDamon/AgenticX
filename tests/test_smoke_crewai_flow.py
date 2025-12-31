"""
Flow 系统冒烟测试

验证 Flow 系统的核心功能：
- @start 装饰器
- @listen 装饰器
- @router 装饰器
- or_, and_ 条件组合
- Flow 执行引擎
- FlowState 状态管理
"""

import pytest
import asyncio
from agenticx.flow import (
    Flow,
    FlowState,
    FlowExecutionState,
    start,
    listen,
    router,
    or_,
    and_,
    StartMethod,
    ListenMethod,
    RouterMethod,
    is_flow_method_name,
    is_flow_condition_dict,
    extract_all_methods,
)


# ============================================================================
# Test: Decorator Functions
# ============================================================================


class TestDecorators:
    """测试装饰器函数"""
    
    def test_start_decorator_basic(self):
        """测试 @start 基本装饰"""
        @start()
        def my_start():
            return "started"
        
        assert isinstance(my_start, StartMethod)
        assert my_start.__is_start_method__ is True
        assert my_start.__trigger_methods__ is None
    
    def test_start_decorator_with_condition(self):
        """测试 @start 带条件"""
        @start("init")
        def conditional_start():
            pass
        
        assert conditional_start.__trigger_methods__ == ["init"]
        assert conditional_start.__condition_type__ == "OR"
    
    def test_listen_decorator(self):
        """测试 @listen 装饰器"""
        @listen("process")
        def handle_process():
            pass
        
        assert isinstance(handle_process, ListenMethod)
        assert handle_process.__trigger_methods__ == ["process"]
    
    def test_router_decorator(self):
        """测试 @router 装饰器"""
        @router("check")
        def my_router():
            return "SUCCESS"
        
        assert isinstance(my_router, RouterMethod)
        assert my_router.__is_router__ is True
        assert my_router.__trigger_methods__ == ["check"]
    
    def test_or_condition(self):
        """测试 or_ 条件组合"""
        condition = or_("step1", "step2")
        
        assert condition["type"] == "OR"
        assert "step1" in condition["conditions"]
        assert "step2" in condition["conditions"]
    
    def test_and_condition(self):
        """测试 and_ 条件组合"""
        condition = and_("step1", "step2")
        
        assert condition["type"] == "AND"
        assert "step1" in condition["conditions"]
        assert "step2" in condition["conditions"]
    
    def test_nested_condition(self):
        """测试嵌套条件"""
        condition = or_(and_("a", "b"), "c")
        
        assert condition["type"] == "OR"
        assert len(condition["conditions"]) == 2
        
        nested = condition["conditions"][0]
        assert nested["type"] == "AND"
    
    def test_listen_with_or_condition(self):
        """测试 @listen 使用 or_ 条件"""
        @listen(or_("success", "fallback"))
        def handle_completion():
            pass
        
        assert handle_completion.__trigger_methods__ is not None
        assert "success" in handle_completion.__trigger_methods__
        assert "fallback" in handle_completion.__trigger_methods__
    
    def test_listen_with_and_condition(self):
        """测试 @listen 使用 and_ 条件"""
        @listen(and_("step1", "step2"))
        def handle_all_complete():
            pass
        
        assert handle_all_complete.__condition_type__ == "AND"
        assert len(handle_all_complete.__trigger_methods__) == 2


# ============================================================================
# Test: Utility Functions
# ============================================================================


class TestUtilityFunctions:
    """测试工具函数"""
    
    def test_is_flow_method_name(self):
        """测试 is_flow_method_name"""
        assert is_flow_method_name("method_name") is True
        assert is_flow_method_name(123) is False
        assert is_flow_method_name({"type": "OR"}) is False
    
    def test_is_flow_condition_dict(self):
        """测试 is_flow_condition_dict"""
        assert is_flow_condition_dict({"type": "OR", "methods": []}) is True
        assert is_flow_condition_dict({"methods": []}) is False
        assert is_flow_condition_dict("string") is False
    
    def test_extract_all_methods(self):
        """测试 extract_all_methods"""
        condition = {
            "type": "OR",
            "conditions": [
                {"type": "AND", "methods": ["a", "b"]},
                "c"
            ]
        }
        
        methods = extract_all_methods(condition)
        assert "a" in methods
        assert "b" in methods
        assert "c" in methods


# ============================================================================
# Test: FlowState
# ============================================================================


class TestFlowState:
    """测试 FlowState"""
    
    def test_default_state(self):
        """测试默认状态"""
        state = FlowState()
        assert state.id is not None
        assert len(state.id) > 0
    
    def test_custom_state(self):
        """测试自定义状态"""
        class MyState(FlowState):
            count: int = 0
            items: list = []
        
        state = MyState()
        assert state.count == 0
        assert state.items == []
        
        state.count = 10
        assert state.count == 10


class TestFlowExecutionState:
    """测试 FlowExecutionState"""
    
    def test_initialization(self):
        """测试初始化"""
        state = FlowExecutionState()
        
        assert state.flow_id is not None
        assert state.status == "pending"
        assert len(state.completed_methods) == 0
    
    def test_mark_completed(self):
        """测试标记完成"""
        state = FlowExecutionState()
        state.mark_completed("method1", "result1")
        
        assert state.is_completed("method1") is True
        assert state.get_output("method1") == "result1"
    
    def test_or_condition_check(self):
        """测试 OR 条件检查"""
        state = FlowExecutionState()
        state.mark_completed("step1", None)
        
        # 任意一个完成即满足
        assert state.check_or_condition(["step1", "step2"]) is True
        assert state.check_or_condition(["step3", "step4"]) is False
    
    def test_and_condition_check(self):
        """测试 AND 条件检查"""
        state = FlowExecutionState()
        state.mark_completed("step1", None)
        
        # 需要全部完成
        assert state.check_and_condition(["step1", "step2"]) is False
        
        state.mark_completed("step2", None)
        assert state.check_and_condition(["step1", "step2"]) is True
    
    def test_reset(self):
        """测试重置"""
        state = FlowExecutionState()
        state.mark_completed("method1", "result")
        state.status = "completed"
        
        state.reset()
        
        assert state.status == "pending"
        assert len(state.completed_methods) == 0
    
    def test_to_dict_from_dict(self):
        """测试序列化和反序列化"""
        state = FlowExecutionState(flow_id="test-flow")
        state.mark_completed("method1", "result1")
        state.status = "running"
        
        data = state.to_dict()
        restored = FlowExecutionState.from_dict(data)
        
        assert restored.flow_id == "test-flow"
        assert restored.status == "running"
        assert restored.is_completed("method1") is True


# ============================================================================
# Test: Flow Base Class
# ============================================================================


class TestFlowBasic:
    """测试 Flow 基类基本功能"""
    
    def test_simple_flow(self):
        """测试简单 Flow"""
        class SimpleFlow(Flow):
            @start()
            def begin(self):
                return "started"
        
        flow = SimpleFlow()
        result = flow.kickoff()
        
        assert result == "started"
        assert flow.execution_state.is_completed("begin") is True
    
    def test_flow_with_state(self):
        """测试带状态的 Flow"""
        class StatefulFlow(Flow[dict]):
            @start()
            def begin(self):
                self.state["count"] = 1
                return "started"
            
            @listen("begin")
            def increment(self, result):
                self.state["count"] += 1
                return f"count is {self.state['count']}"
        
        flow = StatefulFlow()
        result = flow.kickoff()
        
        assert flow.state["count"] == 2
    
    def test_flow_with_listener(self):
        """测试带监听器的 Flow"""
        class ListenerFlow(Flow):
            results = []
            
            @start()
            def step1(self):
                self.results.append("step1")
                return "step1_done"
            
            @listen("step1")
            def step2(self, result):
                self.results.append(f"step2:{result}")
                return "step2_done"
        
        flow = ListenerFlow()
        flow.results = []
        flow.kickoff()
        
        assert "step1" in flow.results
        assert "step2:step1_done" in flow.results
    
    def test_flow_with_router(self):
        """测试带路由器的 Flow"""
        class RouterFlow(Flow[dict]):
            @start()
            def begin(self):
                self.state["value"] = 10
                return "started"
            
            @router("begin")
            def decide(self, result):
                if self.state.get("value", 0) > 5:
                    return "HIGH"
                return "LOW"
            
            @listen("HIGH")
            def handle_high(self):
                self.state["result"] = "high_handled"
            
            @listen("LOW")
            def handle_low(self):
                self.state["result"] = "low_handled"
        
        flow = RouterFlow()
        flow.kickoff()
        
        assert flow.state["result"] == "high_handled"
    
    def test_flow_with_or_condition(self):
        """测试 OR 条件 Flow"""
        class OrConditionFlow(Flow):
            triggered = False
            
            @start()
            def begin(self):
                return "started"
            
            @listen(or_("begin", "alternative"))
            def handle_any(self):
                self.triggered = True
        
        flow = OrConditionFlow()
        flow.kickoff()
        
        assert flow.triggered is True
    
    def test_flow_with_and_condition(self):
        """测试 AND 条件 Flow"""
        class AndConditionFlow(Flow):
            triggered = False
            
            @start()
            def step1(self):
                return "step1_done"
            
            @start()
            def step2(self):
                return "step2_done"
            
            @listen(and_("step1", "step2"))
            def handle_both(self):
                self.triggered = True
        
        flow = AndConditionFlow()
        flow.kickoff()
        
        assert flow.triggered is True
    
    def test_flow_reset(self):
        """测试 Flow 重置"""
        class ResetFlow(Flow[dict]):
            @start()
            def begin(self):
                self.state["value"] = 1
                return "done"
        
        flow = ResetFlow()
        flow.kickoff()
        
        assert flow.state["value"] == 1
        
        flow.reset()
        
        assert flow.execution_state.status == "pending"
        assert len(flow.execution_state.completed_methods) == 0


# ============================================================================
# Test: Async Flow
# ============================================================================


class TestAsyncFlow:
    """测试异步 Flow"""
    
    @pytest.mark.asyncio
    async def test_async_kickoff(self):
        """测试异步执行"""
        class AsyncFlow(Flow):
            @start()
            async def begin(self):
                await asyncio.sleep(0.01)
                return "async_started"
        
        flow = AsyncFlow()
        result = await flow.kickoff_async()
        
        assert result == "async_started"
    
    @pytest.mark.asyncio
    async def test_async_listener(self):
        """测试异步监听器"""
        class AsyncListenerFlow(Flow):
            results = []
            
            @start()
            async def begin(self):
                await asyncio.sleep(0.01)
                return "started"
            
            @listen("begin")
            async def process(self, result):
                await asyncio.sleep(0.01)
                self.results.append(result)
                return "processed"
        
        flow = AsyncListenerFlow()
        flow.results = []
        await flow.kickoff_async()
        
        assert "started" in flow.results


# ============================================================================
# Test: Flow Execution Summary
# ============================================================================


class TestFlowExecutionSummary:
    """测试执行摘要"""
    
    def test_execution_summary(self):
        """测试获取执行摘要"""
        class SummaryFlow(Flow):
            @start()
            def begin(self):
                return "done"
            
            @listen("begin")
            def next_step(self, result):
                return "next_done"
        
        flow = SummaryFlow()
        flow.kickoff()
        
        summary = flow.get_execution_summary()
        
        assert "flow_id" in summary
        assert summary["status"] == "completed"
        assert "begin" in summary["completed_methods"]
        assert "next_step" in summary["completed_methods"]


# ============================================================================
# Test: Edge Cases
# ============================================================================


class TestEdgeCases:
    """测试边界情况"""
    
    def test_flow_without_start(self):
        """测试没有起始方法的 Flow"""
        class NoStartFlow(Flow):
            @listen("never")
            def handle(self):
                pass
        
        flow = NoStartFlow()
        result = flow.kickoff()
        
        # 应该正常完成，但没有执行任何方法
        assert result is None
    
    def test_flow_with_multiple_starts(self):
        """测试多个起始方法的 Flow"""
        class MultiStartFlow(Flow):
            results = []
            
            @start()
            def begin1(self):
                self.results.append("begin1")
                return "start1"
            
            @start()
            def begin2(self):
                self.results.append("begin2")
                return "start2"
        
        flow = MultiStartFlow()
        flow.results = []
        flow.kickoff()
        
        assert "begin1" in flow.results
        assert "begin2" in flow.results
    
    def test_flow_with_chain(self):
        """测试链式执行"""
        class ChainFlow(Flow):
            steps = []
            
            @start()
            def step1(self):
                self.steps.append(1)
                return "s1"
            
            @listen("step1")
            def step2(self, result):
                self.steps.append(2)
                return "s2"
            
            @listen("step2")
            def step3(self, result):
                self.steps.append(3)
                return "s3"
        
        flow = ChainFlow()
        flow.steps = []
        result = flow.kickoff()
        
        assert flow.steps == [1, 2, 3]
        assert result == "s1"  # 返回起始方法的结果


# ============================================================================
# Test: FlowState Custom Types
# ============================================================================


class TestFlowStateCustomTypes:
    """测试自定义 FlowState 类型"""
    
    def test_pydantic_state(self):
        """测试 Pydantic 状态模型"""
        class MyState(FlowState):
            counter: int = 0
            message: str = ""
        
        class TypedFlow(Flow[MyState]):
            @start()
            def begin(self):
                self.state.counter = 1
                self.state.message = "started"
                return "done"
        
        flow = TypedFlow(state=MyState())
        flow.kickoff()
        
        assert flow.state.counter == 1
        assert flow.state.message == "started"

