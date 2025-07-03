"""
FunctionTool: 将普通 Python 函数包装成工具

提供 @tool 装饰器和 FunctionTool 类，让开发者可以轻松地将任何函数转换为 AgenticX 工具。
"""

import inspect
import logging
from typing import Any, Callable, Dict, Optional, Type, get_type_hints

from docstring_parser import parse
from pydantic import BaseModel, create_model

from .base import BaseTool

logger = logging.getLogger(__name__)


def _extract_function_info(func: Callable) -> Dict[str, Any]:
    """
    从函数中提取工具信息
    
    Args:
        func: 要分析的函数
        
    Returns:
        包含 name, description, args_schema 的字典
    """
    # 获取函数名
    name = func.__name__
    
    # 解析文档字符串
    docstring = parse(func.__doc__ or "")
    
    # 构建描述
    short_desc = docstring.short_description or ""
    long_desc = docstring.long_description or ""
    if long_desc:
        description = f"{short_desc}\n{long_desc}"
    else:
        description = short_desc or "No description provided"
    
    # 获取函数签名和类型注解
    sig = inspect.signature(func)
    type_hints = get_type_hints(func)
    
    # 构建 Pydantic 模型字段
    fields = {}
    param_descriptions = {param.arg_name: param.description for param in docstring.params}
    
    for param_name, param in sig.parameters.items():
        # 跳过 *args 和 **kwargs
        if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        
        # 获取参数类型
        param_type = type_hints.get(param_name, Any)
        
        # 获取参数描述
        param_desc = param_descriptions.get(param_name, "")
        
        # 构建字段信息
        if param.default is param.empty:
            # 必需参数
            fields[param_name] = (param_type, ...)
        else:
            # 可选参数
            fields[param_name] = (param_type, param.default)
    
    # 创建 Pydantic 模型
    if fields:
        args_schema = create_model(f"{name}Args", **fields)
        
        # 添加参数描述到模型
        for param_name, desc in param_descriptions.items():
            if param_name in args_schema.model_fields and desc:
                args_schema.model_fields[param_name].description = desc
    else:
        args_schema = None
    
    return {
        "name": name,
        "description": description,
        "args_schema": args_schema
    }


class FunctionTool(BaseTool):
    """
    将普通 Python 函数包装成工具的具体实现
    
    自动从函数的签名、类型注解和文档字符串中提取工具信息
    """
    
    def __init__(
        self,
        func: Callable,
        name: Optional[str] = None,
        description: Optional[str] = None,
        args_schema: Optional[Type[BaseModel]] = None,
        timeout: Optional[float] = None,
        organization_id: Optional[str] = None,
    ):
        """
        初始化 FunctionTool
        
        Args:
            func: 要包装的函数
            name: 工具名称，如果为 None 则从函数中提取
            description: 工具描述，如果为 None 则从函数文档字符串中提取
            args_schema: 参数模式，如果为 None 则从函数签名中生成
            timeout: 执行超时时间
            organization_id: 组织 ID
        """
        self.func = func
        
        # 从函数中提取信息
        func_info = _extract_function_info(func)
        
        # 使用提供的参数或从函数中提取的信息
        final_name = name or func_info["name"]
        final_description = description or func_info["description"]
        final_args_schema = args_schema or func_info["args_schema"]
        
        super().__init__(
            name=final_name,
            description=final_description,
            args_schema=final_args_schema,
            timeout=timeout,
            organization_id=organization_id,
        )
    
    @property
    def is_async(self) -> bool:
        """检查包装的函数是否是异步函数"""
        return inspect.iscoroutinefunction(self.func)
    
    def _run(self, **kwargs) -> Any:
        """
        同步执行包装的函数
        
        Args:
            **kwargs: 函数参数
            
        Returns:
            函数执行结果
        """
        if self.is_async:
            raise RuntimeError(
                f"Function {self.func.__name__} is async, use arun() instead"
            )
        
        return self.func(**kwargs)
    
    async def _arun(self, **kwargs) -> Any:
        """
        异步执行包装的函数
        
        Args:
            **kwargs: 函数参数
            
        Returns:
            函数执行结果
        """
        if self.is_async:
            return await self.func(**kwargs)
        else:
            # 对于同步函数，在线程池中执行
            return await super()._arun(**kwargs)


def tool(
    name: Optional[str] = None,
    description: Optional[str] = None,
    args_schema: Optional[Type[BaseModel]] = None,
    timeout: Optional[float] = None,
    organization_id: Optional[str] = None,
) -> Callable[[Callable], FunctionTool]:
    """
    将 Python 函数转换为 AgenticX 工具的装饰器
    
    Args:
        name: 工具名称，如果为 None 则使用函数名
        description: 工具描述，如果为 None 则从函数文档字符串中提取
        args_schema: 参数模式，如果为 None 则从函数签名中生成
        timeout: 执行超时时间
        organization_id: 组织 ID
    
    Returns:
        装饰器函数
    
    Example:
        ```python
        @tool(name="calculator", timeout=10.0)
        def add_numbers(a: int, b: int) -> int:
            '''Add two numbers together.
            
            Args:
                a: The first number
                b: The second number
                
            Returns:
                The sum of the two numbers
            '''
            return a + b
        
        # 使用工具
        result = add_numbers.run(a=1, b=2)  # 返回 3
        ```
    """
    def decorator(func: Callable) -> FunctionTool:
        return FunctionTool(
            func=func,
            name=name,
            description=description,
            args_schema=args_schema,
            timeout=timeout,
            organization_id=organization_id,
        )
    
    return decorator


# 便捷函数：直接将函数转换为工具
def create_tool(func: Callable, **kwargs) -> FunctionTool:
    """
    便捷函数：将函数转换为工具
    
    Args:
        func: 要转换的函数
        **kwargs: 传递给 FunctionTool 的其他参数
    
    Returns:
        FunctionTool 实例
    
    Example:
        ```python
        def multiply(x: float, y: float) -> float:
            '''Multiply two numbers'''
            return x * y
        
        multiply_tool = create_tool(multiply)
        result = multiply_tool.run(x=3.0, y=4.0)  # 返回 12.0
        ```
    """
    return FunctionTool(func, **kwargs) 