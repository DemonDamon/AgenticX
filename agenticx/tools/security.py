"""
AgenticX M3 工具安全模块

本模块提供与工具执行安全相关的功能，例如人机协同审批装饰器。
"""

from functools import wraps
from typing import Callable, Any, Optional

from ..core.error_handler import ErrorHandler # 假设未来会用到
from ..core.event import HumanRequestEvent
from ..core.tool import FunctionTool


class ApprovalRequiredError(Exception):
    """当需要人工审批时抛出的异常"""
    def __init__(self, message: str, tool_name: str, args: tuple, kwargs: dict):
        self.message = message
        self.tool_name = tool_name
        self.args = args
        self.kwargs = kwargs
        super().__init__(self.message)


def human_in_the_loop(
    policy_check: Optional[Callable[[Any, Any], bool]] = None,
    prompt: str = "执行此工具需要人工批准，是否继续？"
) -> Callable:
    """
    一个用于高风险工具的安全装饰器。

    在工具执行前，它会暂停工作流并请求人工批准。
    在完整的实现中，它会调用 M11 的 PolicyEngine 来决定是否需要审批。

    Args:
        policy_check: 一个可选的回调函数，用于在运行时动态决定是否需要审批。
                      函数接收 `*args` 和 `**kwargs`，返回 `True` 表示需要审批。
        prompt: 请求人工批准时显示的提示信息。

    Returns:
        一个包装了原始工具函数的装饰器，返回 FunctionTool 实例。
    """
    def decorator(func: Callable) -> FunctionTool:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 简化的策略检查：如果提供了 policy_check 函数，则调用它
            needs_approval = False
            if policy_check:
                try:
                    if policy_check(*args, **kwargs):
                        needs_approval = True
                except Exception as e:
                    print(f"策略检查函数执行失败: {e}")
                    # 默认需要审批以保证安全
                    needs_approval = True
            else:
                # 如果没有策略检查函数，则默认总是需要审批
                needs_approval = True

            if needs_approval:
                # 抛出一个特定的异常，由 ToolExecutor 捕获
                raise ApprovalRequiredError(
                    message=prompt,
                    tool_name=func.__name__,
                    args=args,
                    kwargs=kwargs
                )
            
            # 如果不需要审批，则直接执行原始函数
            return func(*args, **kwargs)
        # 将包装后的函数转换为 FunctionTool
        return FunctionTool.from_function(wrapper, name=func.__name__, description=func.__doc__)
    return decorator 