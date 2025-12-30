"""
AgenticX Flow 系统

提供事件驱动的工作流编排能力。
参考自 crewAI Flow 模块。

主要组件：
- Flow: 工作流基类
- FlowState: 状态管理基类
- @start: 起始方法装饰器
- @listen: 监听器装饰器
- @router: 路由器装饰器
- or_, and_: 条件组合器

Usage:
    from agenticx.flow import Flow, FlowState, start, listen, router, or_, and_
    
    class MyFlow(Flow):
        @start()
        def begin(self):
            return "started"
        
        @listen("begin")
        def process(self, result):
            return f"processed: {result}"
        
        @router("process")
        def decide(self):
            return "SUCCESS" if self.state.get("valid") else "FAILURE"
        
        @listen(or_("SUCCESS", "FAILURE"))
        def finish(self):
            pass
    
    # 执行
    flow = MyFlow()
    result = flow.kickoff()
    
    # 异步执行
    result = await flow.kickoff_async()
"""

from .types import (
    FlowMethodName,
    FlowConditionType,
    SimpleFlowCondition,
    FlowCondition,
    FlowConditions,
    FlowExecutionData,
    PendingListenerKey,
    OR_CONDITION,
    AND_CONDITION,
)

from .decorators import (
    # Utility functions
    is_flow_method_name,
    is_flow_condition_dict,
    is_flow_method_callable,
    extract_all_methods,
    # Wrapper classes
    FlowMethod,
    StartMethod,
    ListenMethod,
    RouterMethod,
    # Decorators
    start,
    listen,
    router,
    # Condition combinators
    or_,
    and_,
)

from .state import (
    FlowState,
    FlowExecutionState,
)

from .base import (
    FlowMeta,
    Flow,
)


__all__ = [
    # Types
    "FlowMethodName",
    "FlowConditionType",
    "SimpleFlowCondition",
    "FlowCondition",
    "FlowConditions",
    "FlowExecutionData",
    "PendingListenerKey",
    "OR_CONDITION",
    "AND_CONDITION",
    # Decorators
    "start",
    "listen",
    "router",
    "or_",
    "and_",
    # Wrapper classes
    "FlowMethod",
    "StartMethod",
    "ListenMethod",
    "RouterMethod",
    # State
    "FlowState",
    "FlowExecutionState",
    # Base class
    "FlowMeta",
    "Flow",
    # Utility functions
    "is_flow_method_name",
    "is_flow_condition_dict",
    "is_flow_method_callable",
    "extract_all_methods",
]

