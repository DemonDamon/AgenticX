"""
AgenticX Sandbox Tools

为 Agent 提供沙箱能力的工具封装：
- SandboxFileTool: 文件操作（读/写/列表/删除）
- SandboxCommandTool: 命令执行
- SandboxCodeInterpreterTool: 状态化代码执行

Example:
    >>> from agenticx.tools.sandbox_tools import SandboxCodeInterpreterTool
    >>> 
    >>> tool = SandboxCodeInterpreterTool()
    >>> await tool.arun(code="x = 1 + 1")
    >>> result = await tool.arun(code="print(x)")  # 输出: 2
"""

import logging
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field

from .base import BaseTool, ToolError

logger = logging.getLogger(__name__)


# ==================== Pydantic 参数模型 ====================

class FileOperationArgs(BaseModel):
    """文件操作参数"""
    
    path: str = Field(..., description="文件或目录路径")
    operation: str = Field(
        ...,
        description="操作类型: read, write, list, delete, mkdir"
    )
    content: Optional[str] = Field(
        None,
        description="写入内容（仅 write 操作需要）"
    )
    mode: Optional[int] = Field(
        0o644,
        description="文件权限（仅 write/mkdir 操作）"
    )


class CommandExecutionArgs(BaseModel):
    """命令执行参数"""
    
    command: str = Field(..., description="要执行的 Shell 命令")
    timeout: Optional[int] = Field(
        30,
        description="执行超时时间（秒）"
    )
    background: bool = Field(
        False,
        description="是否后台执行"
    )
    cwd: Optional[str] = Field(
        None,
        description="工作目录"
    )


class CodeExecutionArgs(BaseModel):
    """代码执行参数"""
    
    code: str = Field(..., description="要执行的代码")
    language: str = Field(
        "python",
        description="编程语言 (python, shell, javascript 等)"
    )
    timeout: Optional[int] = Field(
        30,
        description="执行超时时间（秒）"
    )
    stateful: bool = Field(
        True,
        description="是否状态化执行（变量跨执行持久化）"
    )


# ==================== 沙箱文件工具 ====================

class SandboxFileTool(BaseTool):
    """
    沙箱文件操作工具
    
    支持在沙箱环境中进行文件操作：
    - read: 读取文件内容
    - write: 写入文件
    - list: 列出目录内容
    - delete: 删除文件或目录
    - mkdir: 创建目录
    
    Example:
        >>> tool = SandboxFileTool(sandbox=my_sandbox)
        >>> 
        >>> # 写入文件
        >>> await tool.arun(path="/tmp/test.txt", operation="write", content="Hello World")
        >>> 
        >>> # 读取文件
        >>> result = await tool.arun(path="/tmp/test.txt", operation="read")
        >>> print(result["content"])  # Hello World
        >>> 
        >>> # 列出目录
        >>> result = await tool.arun(path="/tmp", operation="list")
        >>> print(result["files"])
    """
    
    def __init__(
        self,
        sandbox: Optional[Any] = None,
        name: str = "sandbox_file",
        description: str = "在沙箱环境中进行文件操作（读取、写入、列表、删除）",
        **kwargs,
    ):
        """
        初始化沙箱文件工具
        
        Args:
            sandbox: 沙箱实例（SandboxBase 或 CodeInterpreterSandbox）
            name: 工具名称
            description: 工具描述
        """
        super().__init__(
            name=name,
            description=description,
            args_schema=FileOperationArgs,
            **kwargs,
        )
        self._sandbox = sandbox
    
    @property
    def sandbox(self):
        """获取沙箱实例"""
        return self._sandbox
    
    @sandbox.setter
    def sandbox(self, value):
        """设置沙箱实例"""
        self._sandbox = value
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行（不推荐）"""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self._arun(**kwargs))
    
    async def _arun(
        self,
        path: str,
        operation: str,
        content: Optional[str] = None,
        mode: int = 0o644,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        异步执行文件操作
        
        Args:
            path: 文件或目录路径
            operation: 操作类型
            content: 写入内容
            mode: 文件权限
            
        Returns:
            操作结果
        """
        if self._sandbox is None:
            raise ToolError(
                "Sandbox not configured",
                tool_name=self.name,
                details={"hint": "Set sandbox property before using this tool"}
            )
        
        try:
            if operation == "read":
                file_content = await self._sandbox.read_file(path)
                return {
                    "success": True,
                    "operation": "read",
                    "path": path,
                    "content": file_content,
                }
            
            elif operation == "write":
                if content is None:
                    raise ToolError(
                        "Content is required for write operation",
                        tool_name=self.name
                    )
                await self._sandbox.write_file(path, content)
                return {
                    "success": True,
                    "operation": "write",
                    "path": path,
                    "bytes_written": len(content),
                }
            
            elif operation == "list":
                files = await self._sandbox.list_directory(path)
                return {
                    "success": True,
                    "operation": "list",
                    "path": path,
                    "files": [
                        {
                            "path": f.path,
                            "size": f.size,
                            "is_dir": f.is_dir,
                        }
                        for f in files
                    ],
                }
            
            elif operation == "delete":
                await self._sandbox.delete_file(path)
                return {
                    "success": True,
                    "operation": "delete",
                    "path": path,
                }
            
            elif operation == "mkdir":
                # 使用 write_file 创建目录（通过写入空文件的方式）
                # 或者如果沙箱有 mkdir 方法
                if hasattr(self._sandbox, 'mkdir'):
                    await self._sandbox.mkdir(path, mode)
                else:
                    # 使用 shell 命令创建目录
                    result = await self._sandbox.run_command(f"mkdir -p '{path}'")
                    if not result.success:
                        raise ToolError(
                            f"Failed to create directory: {result.stderr}",
                            tool_name=self.name
                        )
                return {
                    "success": True,
                    "operation": "mkdir",
                    "path": path,
                }
            
            else:
                raise ToolError(
                    f"Unknown operation: {operation}",
                    tool_name=self.name,
                    details={"supported_operations": ["read", "write", "list", "delete", "mkdir"]}
                )
                
        except ToolError:
            raise
        except FileNotFoundError as e:
            return {
                "success": False,
                "operation": operation,
                "path": path,
                "error": f"File not found: {path}",
            }
        except Exception as e:
            logger.error(f"File operation error: {e}")
            return {
                "success": False,
                "operation": operation,
                "path": path,
                "error": str(e),
            }


# ==================== 沙箱命令工具 ====================

class SandboxCommandTool(BaseTool):
    """
    沙箱命令执行工具
    
    在沙箱环境中执行 Shell 命令。
    
    Example:
        >>> tool = SandboxCommandTool(sandbox=my_sandbox)
        >>> result = await tool.arun(command="echo 'Hello World'")
        >>> print(result["stdout"])  # Hello World
    """
    
    def __init__(
        self,
        sandbox: Optional[Any] = None,
        name: str = "sandbox_command",
        description: str = "在沙箱环境中执行 Shell 命令",
        **kwargs,
    ):
        """
        初始化沙箱命令工具
        
        Args:
            sandbox: 沙箱实例
            name: 工具名称
            description: 工具描述
        """
        super().__init__(
            name=name,
            description=description,
            args_schema=CommandExecutionArgs,
            **kwargs,
        )
        self._sandbox = sandbox
    
    @property
    def sandbox(self):
        """获取沙箱实例"""
        return self._sandbox
    
    @sandbox.setter
    def sandbox(self, value):
        """设置沙箱实例"""
        self._sandbox = value
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行"""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self._arun(**kwargs))
    
    async def _arun(
        self,
        command: str,
        timeout: int = 30,
        background: bool = False,
        cwd: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        异步执行命令
        
        Args:
            command: Shell 命令
            timeout: 超时时间
            background: 是否后台执行
            cwd: 工作目录
            
        Returns:
            执行结果
        """
        if self._sandbox is None:
            raise ToolError(
                "Sandbox not configured",
                tool_name=self.name
            )
        
        try:
            # 如果指定了工作目录，在命令前添加 cd
            if cwd:
                command = f"cd '{cwd}' && {command}"
            
            # 后台执行
            if background:
                command = f"nohup {command} &"
            
            result = await self._sandbox.run_command(command, timeout=timeout)
            
            return {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
                "background": background,
            }
            
        except Exception as e:
            logger.error(f"Command execution error: {e}")
            return {
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "exit_code": 1,
                "duration_ms": 0,
                "background": background,
            }


# ==================== 沙箱代码解释器工具 ====================

class SandboxCodeInterpreterTool(BaseTool):
    """
    沙箱代码解释器工具
    
    在沙箱环境中执行代码，支持状态化执行（变量跨执行持久化）。
    
    Example:
        >>> tool = SandboxCodeInterpreterTool()
        >>> await tool.start()
        >>> 
        >>> # 定义变量
        >>> await tool.arun(code="x = 1 + 1")
        >>> 
        >>> # 使用变量（状态持久化）
        >>> result = await tool.arun(code="print(x)")  # 输出: 2
        >>> 
        >>> # 定义函数
        >>> await tool.arun(code="def greet(name): return f'Hello, {name}!'")
        >>> result = await tool.arun(code="print(greet('World'))")  # 输出: Hello, World!
        >>> 
        >>> await tool.stop()
    """
    
    def __init__(
        self,
        sandbox: Optional[Any] = None,
        execd_endpoint: Optional[str] = None,
        execd_token: Optional[str] = None,
        use_jupyter: bool = True,
        name: str = "sandbox_code_interpreter",
        description: str = "在沙箱环境中执行代码（支持状态化执行，变量跨执行持久化）",
        **kwargs,
    ):
        """
        初始化沙箱代码解释器工具
        
        Args:
            sandbox: 沙箱实例（可选，如果使用 execd 或 Jupyter 则不需要）
            execd_endpoint: execd 端点（可选）
            execd_token: execd token（可选）
            use_jupyter: 是否使用 Jupyter kernel（当 execd 不可用时）
            name: 工具名称
            description: 工具描述
        """
        super().__init__(
            name=name,
            description=description,
            args_schema=CodeExecutionArgs,
            **kwargs,
        )
        self._sandbox = sandbox
        self._execd_endpoint = execd_endpoint
        self._execd_token = execd_token
        self._use_jupyter = use_jupyter
        
        # 状态化解释器
        self._stateful_interpreter = None
        self._is_started = False
    
    @property
    def sandbox(self):
        """获取沙箱实例"""
        return self._sandbox
    
    @sandbox.setter
    def sandbox(self, value):
        """设置沙箱实例"""
        self._sandbox = value
    
    @property
    def is_started(self) -> bool:
        """是否已启动"""
        return self._is_started
    
    async def start(self) -> None:
        """
        启动状态化代码解释器
        
        初始化 Jupyter kernel 或 execd 连接。
        """
        if self._is_started:
            return
        
        try:
            from ..sandbox.jupyter_kernel import StatefulCodeInterpreter
            
            self._stateful_interpreter = StatefulCodeInterpreter(
                execd_endpoint=self._execd_endpoint,
                execd_token=self._execd_token,
                use_jupyter=self._use_jupyter,
            )
            await self._stateful_interpreter.start()
            self._is_started = True
            logger.info(f"SandboxCodeInterpreterTool started with backend: {self._stateful_interpreter.backend}")
        except Exception as e:
            logger.warning(f"Failed to start stateful interpreter: {e}")
            # 降级到普通沙箱
            self._stateful_interpreter = None
            self._is_started = True
    
    async def stop(self) -> None:
        """
        停止状态化代码解释器
        """
        if self._stateful_interpreter:
            await self._stateful_interpreter.stop()
            self._stateful_interpreter = None
        self._is_started = False
        logger.info("SandboxCodeInterpreterTool stopped")
    
    async def reset(self) -> None:
        """
        重置会话状态
        
        清除所有变量和定义。
        """
        if self._stateful_interpreter:
            await self._stateful_interpreter.reset()
            logger.info("SandboxCodeInterpreterTool reset")
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行"""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self._arun(**kwargs))
    
    async def _arun(
        self,
        code: str,
        language: str = "python",
        timeout: int = 30,
        stateful: bool = True,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        异步执行代码
        
        Args:
            code: 要执行的代码
            language: 编程语言
            timeout: 超时时间
            stateful: 是否状态化执行
            
        Returns:
            执行结果
        """
        try:
            # 状态化执行
            if stateful and self._stateful_interpreter:
                result = await self._stateful_interpreter.execute(
                    code=code,
                    timeout=timeout,
                )
                return {
                    "success": result.success,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration_ms,
                    "language": language,
                    "stateful": True,
                    "backend": result.metadata.get("backend", "unknown"),
                    "result": result.metadata.get("result", ""),
                }
            
            # 非状态化执行（使用普通沙箱）
            if self._sandbox:
                result = await self._sandbox.execute(
                    code=code,
                    language=language,
                    timeout=timeout,
                )
                return {
                    "success": result.success,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration_ms,
                    "language": language,
                    "stateful": False,
                    "backend": "sandbox",
                }
            
            # 自动启动状态化解释器
            if not self._is_started and stateful:
                await self.start()
                if self._stateful_interpreter:
                    return await self._arun(
                        code=code,
                        language=language,
                        timeout=timeout,
                        stateful=stateful,
                        **kwargs,
                    )
            
            raise ToolError(
                "No interpreter available",
                tool_name=self.name,
                details={"hint": "Call start() or set sandbox property"}
            )
            
        except ToolError:
            raise
        except Exception as e:
            logger.error(f"Code execution error: {e}")
            return {
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "exit_code": 1,
                "duration_ms": 0,
                "language": language,
                "stateful": stateful,
            }
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器退出"""
        await self.stop()


# ==================== 工具注册辅助函数 ====================

def create_sandbox_tools(
    sandbox: Optional[Any] = None,
    execd_endpoint: Optional[str] = None,
    execd_token: Optional[str] = None,
) -> List[BaseTool]:
    """
    创建沙箱工具集合
    
    Args:
        sandbox: 沙箱实例
        execd_endpoint: execd 端点
        execd_token: execd token
        
    Returns:
        工具列表 [SandboxFileTool, SandboxCommandTool, SandboxCodeInterpreterTool]
    """
    return [
        SandboxFileTool(sandbox=sandbox),
        SandboxCommandTool(sandbox=sandbox),
        SandboxCodeInterpreterTool(
            sandbox=sandbox,
            execd_endpoint=execd_endpoint,
            execd_token=execd_token,
        ),
    ]


def register_sandbox_tools(
    registry: Any,
    sandbox: Optional[Any] = None,
    execd_endpoint: Optional[str] = None,
    execd_token: Optional[str] = None,
) -> None:
    """
    注册沙箱工具到工具注册表
    
    Args:
        registry: ToolRegistry 实例
        sandbox: 沙箱实例
        execd_endpoint: execd 端点
        execd_token: execd token
    """
    tools = create_sandbox_tools(
        sandbox=sandbox,
        execd_endpoint=execd_endpoint,
        execd_token=execd_token,
    )
    
    for tool in tools:
        if hasattr(registry, 'register'):
            registry.register(tool)
        elif hasattr(registry, 'add_tool'):
            registry.add_tool(tool)
        else:
            logger.warning(f"Cannot register tool {tool.name}: registry has no register method")
