"""
BaseTool: AgenticX 工具系统的抽象基类

提供统一的工具接口，支持同步/异步执行、回调处理、错误管理等功能。
"""

import asyncio
import inspect
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, Type, Union

from pydantic import BaseModel

from ..core.message import Message

logger = logging.getLogger(__name__)


class ToolError(Exception):
    """工具执行错误的基类"""
    
    def __init__(self, message: str, tool_name: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.tool_name = tool_name
        self.details = details or {}


class ToolTimeoutError(ToolError):
    """工具执行超时错误"""
    pass


class ToolValidationError(ToolError):
    """工具参数验证错误"""
    pass


class BaseTool(ABC):
    """
    所有工具的抽象基类
    
    定义了工具的核心契约，包括：
    - 工具的基本属性 (name, description, args_schema)
    - 同步/异步执行方法
    - 统一的错误处理和回调机制
    - 多租户支持
    """
    
    def __init__(
        self,
        name: Optional[str] = None,
        description: Optional[str] = None,
        args_schema: Optional[Type[BaseModel]] = None,
        timeout: Optional[float] = None,
        organization_id: Optional[str] = None,
    ):
        """
        初始化工具
        
        Args:
            name: 工具名称，如果为 None 则使用类名
            description: 工具描述
            args_schema: 参数模式，使用 Pydantic 模型定义
            timeout: 执行超时时间（秒）
            organization_id: 组织 ID，用于多租户隔离
        """
        self.name = name or self.__class__.__name__
        self.description = description or self.__doc__ or "No description provided"
        self.args_schema = args_schema
        self.timeout = timeout
        self.organization_id = organization_id
        
        # 运行时状态
        self._is_running = False
        self._callbacks = []
    
    @property
    def is_async(self) -> bool:
        """检查工具是否支持异步执行"""
        return inspect.iscoroutinefunction(self._arun)
    
    @property
    def is_running(self) -> bool:
        """检查工具是否正在运行"""
        return self._is_running
    
    def add_callback(self, callback):
        """添加回调函数"""
        self._callbacks.append(callback)
    
    def remove_callback(self, callback):
        """移除回调函数"""
        if callback in self._callbacks:
            self._callbacks.remove(callback)
    
    async def _trigger_callback(self, event: str, data: Dict[str, Any]):
        """触发回调事件（异步）"""
        for callback in self._callbacks:
            try:
                if inspect.iscoroutinefunction(callback):
                    await callback(event, data)
                else:
                    callback(event, data)
            except Exception as e:
                logger.warning(f"Callback error in {self.name}: {e}")
    
    def _trigger_callback_sync(self, event: str, data: Dict[str, Any]):
        """触发回调事件（同步）"""
        for callback in self._callbacks:
            try:
                if not inspect.iscoroutinefunction(callback):
                    callback(event, data)
                # 跳过异步回调函数，避免在同步环境中调用
            except Exception as e:
                logger.warning(f"Callback error in {self.name}: {e}")
    
    def _validate_args(self, **kwargs) -> Dict[str, Any]:
        """
        验证输入参数
        
        Args:
            **kwargs: 输入参数
            
        Returns:
            验证后的参数字典
            
        Raises:
            ToolValidationError: 参数验证失败
        """
        if self.args_schema is None:
            return kwargs
        
        try:
            # 使用 Pydantic 模型验证参数
            validated = self.args_schema(**kwargs)
            return validated.model_dump()
        except Exception as e:
            raise ToolValidationError(
                f"Parameter validation failed: {e}",
                tool_name=self.name,
                details={"input_args": kwargs, "validation_error": str(e)}
            )
    
    @abstractmethod
    def _run(self, **kwargs) -> Any:
        """
        同步执行工具逻辑的抽象方法
        
        子类必须实现此方法来定义工具的核心功能
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            工具执行结果
        """
        pass
    
    async def _arun(self, **kwargs) -> Any:
        """
        异步执行工具逻辑的方法
        
        默认实现会在线程池中运行同步的 _run 方法
        子类可以重写此方法来提供真正的异步实现
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            工具执行结果
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: self._run(**kwargs))
    
    def run(self, **kwargs) -> Any:
        """
        同步执行工具的公共接口
        
        这个方法处理参数验证、错误处理、回调触发等通用逻辑
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            工具执行结果
            
        Raises:
            ToolError: 工具执行过程中的各种错误
        """
        if self._is_running:
            raise ToolError(
                f"Tool {self.name} is already running",
                tool_name=self.name
            )
        
        try:
            self._is_running = True
            
            # 触发开始回调（同步环境）
            try:
                # 检查是否在异步环境中
                try:
                    loop = asyncio.get_running_loop()
                    # 如果事件循环正在运行，创建任务
                    asyncio.create_task(self._trigger_callback("tool_start", {
                        "tool_name": self.name,
                        "args": kwargs
                    }))
                except RuntimeError:
                    # 没有运行的事件循环，同步触发回调
                    self._trigger_callback_sync("tool_start", {
                        "tool_name": self.name,
                        "args": kwargs
                    })
            except Exception:
                # 任何异常都同步触发回调
                self._trigger_callback_sync("tool_start", {
                    "tool_name": self.name,
                    "args": kwargs
                })
            
            # 验证参数
            validated_args = self._validate_args(**kwargs)
            
            # 执行工具逻辑
            if self.timeout:
                # 带超时的执行（跨平台兼容）
                import concurrent.futures
                import platform
                
                # 在 Windows 上使用 ThreadPoolExecutor，在 Unix 上可以使用 signal
                if platform.system() == "Windows":
                    # Windows 兼容的超时实现
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(self._run, **validated_args)
                        try:
                            result = future.result(timeout=self.timeout)
                        except concurrent.futures.TimeoutError:
                            raise ToolTimeoutError(
                                f"Tool {self.name} timed out after {self.timeout} seconds",
                                tool_name=self.name
                            )
                else:
                    # Unix/Linux 系统使用 signal
                    import signal
                    
                    def timeout_handler(signum, frame):
                        raise ToolTimeoutError(
                            f"Tool {self.name} timed out after {self.timeout} seconds",
                            tool_name=self.name
                        )
                    
                    signal.signal(signal.SIGALRM, timeout_handler)
                    signal.alarm(int(self.timeout))
                    
                    try:
                        result = self._run(**validated_args)
                    finally:
                        signal.alarm(0)  # 取消超时
            else:
                result = self._run(**validated_args)
            
            # 触发成功回调（同步环境）
            try:
                # 检查是否在异步环境中
                try:
                    loop = asyncio.get_running_loop()
                    asyncio.create_task(self._trigger_callback("tool_end", {
                        "tool_name": self.name,
                        "args": validated_args,
                        "result": result
                    }))
                except RuntimeError:
                    self._trigger_callback_sync("tool_end", {
                        "tool_name": self.name,
                        "args": validated_args,
                        "result": result
                    })
            except Exception:
                self._trigger_callback_sync("tool_end", {
                    "tool_name": self.name,
                    "args": validated_args,
                    "result": result
                })
            
            return result
            
        except ToolError:
            # 重新抛出工具相关错误
            raise
        except Exception as e:
            # 包装其他异常
            error = ToolError(
                f"Tool {self.name} execution failed: {str(e)}",
                tool_name=self.name,
                details={"original_error": str(e), "args": kwargs}
            )
            
            # 触发错误回调（同步环境）
            try:
                # 检查是否在异步环境中
                try:
                    loop = asyncio.get_running_loop()
                    asyncio.create_task(self._trigger_callback("tool_error", {
                        "tool_name": self.name,
                        "args": kwargs,
                        "error": error
                    }))
                except RuntimeError:
                    self._trigger_callback_sync("tool_error", {
                        "tool_name": self.name,
                        "args": kwargs,
                        "error": error
                    })
            except Exception:
                self._trigger_callback_sync("tool_error", {
                    "tool_name": self.name,
                    "args": kwargs,
                    "error": error
                })
            
            raise error
        finally:
            self._is_running = False
    
    async def arun(self, **kwargs) -> Any:
        """
        异步执行工具的公共接口
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            工具执行结果
            
        Raises:
            ToolError: 工具执行过程中的各种错误
        """
        if self._is_running:
            raise ToolError(
                f"Tool {self.name} is already running",
                tool_name=self.name
            )
        
        try:
            self._is_running = True
            
            # 触发开始回调
            await self._trigger_callback("tool_start", {
                "tool_name": self.name,
                "args": kwargs
            })
            
            # 验证参数
            validated_args = self._validate_args(**kwargs)
            
            # 执行工具逻辑
            if self.timeout:
                result = await asyncio.wait_for(
                    self._arun(**validated_args),
                    timeout=self.timeout
                )
            else:
                result = await self._arun(**validated_args)
            
            # 触发成功回调
            await self._trigger_callback("tool_end", {
                "tool_name": self.name,
                "args": validated_args,
                "result": result
            })
            
            return result
            
        except asyncio.TimeoutError:
            error = ToolTimeoutError(
                f"Tool {self.name} timed out after {self.timeout} seconds",
                tool_name=self.name
            )
            await self._trigger_callback("tool_error", {
                "tool_name": self.name,
                "args": kwargs,
                "error": error
            })
            raise error
        except ToolError:
            # 重新抛出工具相关错误
            raise
        except Exception as e:
            # 包装其他异常
            error = ToolError(
                f"Tool {self.name} execution failed: {str(e)}",
                tool_name=self.name,
                details={"original_error": str(e), "args": kwargs}
            )
            
            # 触发错误回调
            await self._trigger_callback("tool_error", {
                "tool_name": self.name,
                "args": kwargs,
                "error": error
            })
            
            raise error
        finally:
            self._is_running = False
    
    def to_openai_schema(self) -> Dict[str, Any]:
        """
        转换为 OpenAI 函数调用格式的 schema
        
        Returns:
            OpenAI 格式的工具 schema
        """
        parameters = {"type": "object", "properties": {}, "required": []}
        
        if self.args_schema:
            schema = self.args_schema.model_json_schema()
            parameters["properties"] = schema.get("properties", {})
            parameters["required"] = schema.get("required", [])
            parameters["additionalProperties"] = False
        
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": parameters
            }
        }
    
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name='{self.name}')"
    
    def __str__(self) -> str:
        return f"Tool: {self.name} - {self.description}"