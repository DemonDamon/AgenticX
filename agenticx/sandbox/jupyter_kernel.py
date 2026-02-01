"""
AgenticX Jupyter Kernel Manager

提供基于 Jupyter kernel 的状态化代码执行能力。

支持：
- 变量跨执行持久化
- 函数定义跨执行持久化
- import 跨执行持久化
- 多语言支持（Python, JavaScript 等）

Example:
    >>> async with JupyterKernelManager() as km:
    ...     result = await km.execute("x = 1 + 1")
    ...     result = await km.execute("print(x)")  # 输出: 2
"""

import asyncio
import uuid
import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

from .types import ExecutionResult, SandboxError

logger = logging.getLogger(__name__)

# 检查 jupyter_client 是否可用
try:
    import jupyter_client
    from jupyter_client import KernelManager, AsyncKernelClient
    JUPYTER_AVAILABLE = True
except ImportError:
    JUPYTER_AVAILABLE = False
    KernelManager = None
    AsyncKernelClient = None


class JupyterKernelError(SandboxError):
    """Jupyter kernel 错误"""
    pass


class JupyterKernelNotAvailableError(JupyterKernelError):
    """Jupyter kernel 不可用"""
    pass


@dataclass
class KernelSession:
    """Kernel 会话"""
    
    session_id: str
    """会话 ID"""
    
    kernel_name: str = "python3"
    """Kernel 名称"""
    
    kernel_manager: Any = None
    """KernelManager 实例"""
    
    kernel_client: Any = None
    """KernelClient 实例"""
    
    created_at: float = field(default_factory=time.time)
    """创建时间"""
    
    execution_count: int = 0
    """执行次数"""
    
    is_alive: bool = False
    """是否存活"""


class JupyterKernelManager:
    """
    Jupyter Kernel 管理器
    
    管理 Jupyter kernel 的生命周期，提供状态化代码执行。
    
    Example:
        >>> async with JupyterKernelManager() as km:
        ...     # 创建会话
        ...     session_id = await km.create_session("python3")
        ...     
        ...     # 执行代码（状态化）
        ...     result = await km.execute("x = 1 + 1", session_id)
        ...     result = await km.execute("print(x)", session_id)  # 输出: 2
        ...     
        ...     # 定义函数
        ...     await km.execute("def greet(name): return f'Hello, {name}!'", session_id)
        ...     result = await km.execute("print(greet('World'))", session_id)  # 输出: Hello, World!
    """
    
    DEFAULT_TIMEOUT = 30  # 秒
    
    def __init__(
        self,
        default_kernel: str = "python3",
        startup_timeout: float = 60.0,
        execution_timeout: float = 30.0,
    ):
        """
        初始化 Jupyter Kernel 管理器
        
        Args:
            default_kernel: 默认 kernel 名称
            startup_timeout: 启动超时时间
            execution_timeout: 执行超时时间
        """
        if not JUPYTER_AVAILABLE:
            raise JupyterKernelNotAvailableError(
                "jupyter_client is not installed. Install with: pip install jupyter_client ipykernel"
            )
        
        self._default_kernel = default_kernel
        self._startup_timeout = startup_timeout
        self._execution_timeout = execution_timeout
        self._sessions: Dict[str, KernelSession] = {}
        self._default_session_id: Optional[str] = None
    
    @property
    def sessions(self) -> Dict[str, KernelSession]:
        """获取所有会话"""
        return self._sessions.copy()
    
    @property
    def default_session_id(self) -> Optional[str]:
        """获取默认会话 ID"""
        return self._default_session_id
    
    async def start(self) -> None:
        """
        启动管理器
        
        创建默认 kernel 会话。
        """
        logger.info("Starting JupyterKernelManager...")
        self._default_session_id = await self.create_session(self._default_kernel)
        logger.info(f"JupyterKernelManager started with default session: {self._default_session_id}")
    
    async def stop(self) -> None:
        """
        停止管理器
        
        关闭所有 kernel 会话。
        """
        logger.info("Stopping JupyterKernelManager...")
        for session_id in list(self._sessions.keys()):
            await self.delete_session(session_id)
        self._default_session_id = None
        logger.info("JupyterKernelManager stopped")
    
    async def create_session(
        self,
        kernel_name: str = "python3",
    ) -> str:
        """
        创建 kernel 会话
        
        Args:
            kernel_name: kernel 名称（python3, javascript 等）
            
        Returns:
            会话 ID
        """
        session_id = f"kernel-{uuid.uuid4().hex[:8]}"
        
        logger.debug(f"Creating kernel session {session_id} with kernel {kernel_name}")
        
        # 创建 KernelManager
        km = KernelManager(kernel_name=kernel_name)
        
        # 启动 kernel
        km.start_kernel()
        
        # 获取客户端
        kc = km.client()
        kc.start_channels()
        
        # 等待 kernel 就绪
        try:
            kc.wait_for_ready(timeout=self._startup_timeout)
        except Exception as e:
            km.shutdown_kernel(now=True)
            raise JupyterKernelError(f"Kernel failed to start: {e}")
        
        # 保存会话
        session = KernelSession(
            session_id=session_id,
            kernel_name=kernel_name,
            kernel_manager=km,
            kernel_client=kc,
            is_alive=True,
        )
        self._sessions[session_id] = session
        
        logger.info(f"Kernel session {session_id} created")
        return session_id
    
    async def delete_session(self, session_id: str) -> None:
        """
        删除 kernel 会话
        
        Args:
            session_id: 会话 ID
        """
        session = self._sessions.get(session_id)
        if not session:
            logger.warning(f"Session {session_id} not found")
            return
        
        logger.debug(f"Deleting kernel session {session_id}")
        
        try:
            if session.kernel_client:
                session.kernel_client.stop_channels()
            if session.kernel_manager:
                session.kernel_manager.shutdown_kernel(now=True)
        except Exception as e:
            logger.warning(f"Error shutting down kernel: {e}")
        
        del self._sessions[session_id]
        
        if self._default_session_id == session_id:
            self._default_session_id = None
        
        logger.info(f"Kernel session {session_id} deleted")
    
    async def list_sessions(self) -> List[Dict[str, Any]]:
        """
        列出所有会话
        
        Returns:
            会话列表
        """
        return [
            {
                "session_id": s.session_id,
                "kernel_name": s.kernel_name,
                "created_at": s.created_at,
                "execution_count": s.execution_count,
                "is_alive": s.is_alive,
            }
            for s in self._sessions.values()
        ]
    
    async def execute(
        self,
        code: str,
        session_id: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> ExecutionResult:
        """
        在 kernel 中执行代码
        
        变量、函数定义、import 会跨执行持久化。
        
        Args:
            code: 要执行的代码
            session_id: 会话 ID（None 则使用默认会话）
            timeout: 执行超时（秒）
            
        Returns:
            执行结果
        """
        session_id = session_id or self._default_session_id
        if not session_id:
            raise JupyterKernelError("No session available")
        
        session = self._sessions.get(session_id)
        if not session:
            raise JupyterKernelError(f"Session {session_id} not found")
        
        if not session.is_alive:
            raise JupyterKernelError(f"Session {session_id} is not alive")
        
        kc = session.kernel_client
        actual_timeout = timeout or self._execution_timeout
        
        start_time = time.time()
        
        try:
            # 执行代码
            msg_id = kc.execute(code)
            
            # 收集输出
            stdout_parts = []
            stderr_parts = []
            result_value = ""
            execution_error = None
            
            # 处理消息
            while True:
                try:
                    # 获取 IOPub 消息
                    msg = kc.get_iopub_msg(timeout=actual_timeout)
                    msg_type = msg["header"]["msg_type"]
                    content = msg["content"]
                    
                    # 检查是否是我们的消息
                    if msg["parent_header"].get("msg_id") != msg_id:
                        continue
                    
                    if msg_type == "stream":
                        if content["name"] == "stdout":
                            stdout_parts.append(content["text"])
                        elif content["name"] == "stderr":
                            stderr_parts.append(content["text"])
                    
                    elif msg_type == "execute_result":
                        result_value = content.get("data", {}).get("text/plain", "")
                    
                    elif msg_type == "error":
                        execution_error = {
                            "ename": content.get("ename", "Error"),
                            "evalue": content.get("evalue", ""),
                            "traceback": content.get("traceback", []),
                        }
                    
                    elif msg_type == "status":
                        if content["execution_state"] == "idle":
                            # 执行完成
                            break
                    
                except asyncio.TimeoutError:
                    break
                except Exception as e:
                    if "timeout" in str(e).lower():
                        break
                    logger.warning(f"Error getting message: {e}")
                    break
            
            duration_ms = (time.time() - start_time) * 1000
            session.execution_count += 1
            
            if execution_error:
                stderr_parts.append(
                    f"{execution_error['ename']}: {execution_error['evalue']}"
                )
                if execution_error["traceback"]:
                    stderr_parts.append("\n".join(execution_error["traceback"]))
                
                return ExecutionResult(
                    stdout="".join(stdout_parts),
                    stderr="".join(stderr_parts),
                    exit_code=1,
                    success=False,
                    duration_ms=duration_ms,
                    language=session.kernel_name,
                    metadata={"session_id": session_id},
                )
            
            return ExecutionResult(
                stdout="".join(stdout_parts),
                stderr="".join(stderr_parts),
                exit_code=0,
                success=True,
                duration_ms=duration_ms,
                language=session.kernel_name,
                metadata={
                    "session_id": session_id,
                    "result": result_value,
                },
            )
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            return ExecutionResult(
                stderr=str(e),
                exit_code=1,
                success=False,
                duration_ms=duration_ms,
                language=session.kernel_name,
                metadata={"session_id": session_id},
            )
    
    async def interrupt(self, session_id: Optional[str] = None) -> None:
        """
        中断执行
        
        Args:
            session_id: 会话 ID
        """
        session_id = session_id or self._default_session_id
        if not session_id:
            return
        
        session = self._sessions.get(session_id)
        if session and session.kernel_manager:
            session.kernel_manager.interrupt_kernel()
            logger.debug(f"Interrupted kernel {session_id}")
    
    async def restart(self, session_id: Optional[str] = None) -> None:
        """
        重启 kernel
        
        会话状态会被清除。
        
        Args:
            session_id: 会话 ID
        """
        session_id = session_id or self._default_session_id
        if not session_id:
            return
        
        session = self._sessions.get(session_id)
        if session and session.kernel_manager:
            session.kernel_manager.restart_kernel()
            session.kernel_client.wait_for_ready(timeout=self._startup_timeout)
            session.execution_count = 0
            logger.info(f"Restarted kernel {session_id}")
    
    async def is_alive(self, session_id: Optional[str] = None) -> bool:
        """
        检查 kernel 是否存活
        
        Args:
            session_id: 会话 ID
            
        Returns:
            是否存活
        """
        session_id = session_id or self._default_session_id
        if not session_id:
            return False
        
        session = self._sessions.get(session_id)
        if not session or not session.kernel_manager:
            return False
        
        try:
            return session.kernel_manager.is_alive()
        except Exception:
            return False
    
    async def __aenter__(self) -> "JupyterKernelManager":
        """进入上下文管理器"""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文管理器"""
        await self.stop()


def is_jupyter_available() -> bool:
    """检查 Jupyter 是否可用"""
    return JUPYTER_AVAILABLE


class StatefulCodeInterpreter:
    """
    状态化代码解释器
    
    高级封装，自动管理 Jupyter kernel 或 execd 客户端。
    
    优先使用 execd（如果可用），否则降级到本地 Jupyter kernel。
    
    Example:
        >>> async with StatefulCodeInterpreter() as interpreter:
        ...     await interpreter.execute("x = 1 + 1")
        ...     result = await interpreter.execute("print(x)")  # 输出: 2
        ...     
        ...     # 函数定义持久化
        ...     await interpreter.execute("def greet(name): return f'Hello, {name}!'")
        ...     result = await interpreter.execute("print(greet('World'))")  # 输出: Hello, World!
    """
    
    def __init__(
        self,
        execd_endpoint: Optional[str] = None,
        execd_token: Optional[str] = None,
        use_jupyter: bool = True,
        kernel_name: str = "python3",
    ):
        """
        初始化状态化代码解释器
        
        Args:
            execd_endpoint: execd 端点（可选，优先使用）
            execd_token: execd 认证 token
            use_jupyter: 是否使用 Jupyter kernel（当 execd 不可用时）
            kernel_name: Jupyter kernel 名称
        """
        self._execd_endpoint = execd_endpoint
        self._execd_token = execd_token
        self._use_jupyter = use_jupyter
        self._kernel_name = kernel_name
        
        self._execd_client = None
        self._jupyter_manager = None
        self._context_id: Optional[str] = None
        self._session_id: Optional[str] = None
        self._backend: Optional[str] = None
    
    @property
    def backend(self) -> Optional[str]:
        """当前使用的后端"""
        return self._backend
    
    @property
    def context_id(self) -> Optional[str]:
        """当前上下文 ID（execd 模式）"""
        return self._context_id
    
    @property
    def session_id(self) -> Optional[str]:
        """当前会话 ID（Jupyter 模式）"""
        return self._session_id
    
    async def start(self) -> None:
        """启动解释器"""
        # 优先尝试 execd
        if self._execd_endpoint:
            try:
                from .execd import ExecdClient
                self._execd_client = ExecdClient(
                    endpoint=self._execd_endpoint,
                    token=self._execd_token,
                )
                await self._execd_client.connect()
                
                # 创建上下文
                context = await self._execd_client.create_context(language="python")
                self._context_id = context.context_id
                self._backend = "execd"
                logger.info(f"StatefulCodeInterpreter started with execd backend, context: {self._context_id}")
                return
            except Exception as e:
                logger.warning(f"Failed to connect to execd: {e}, falling back to Jupyter")
        
        # 降级到 Jupyter
        if self._use_jupyter and JUPYTER_AVAILABLE:
            self._jupyter_manager = JupyterKernelManager(
                default_kernel=self._kernel_name,
            )
            await self._jupyter_manager.start()
            self._session_id = self._jupyter_manager.default_session_id
            self._backend = "jupyter"
            logger.info(f"StatefulCodeInterpreter started with Jupyter backend, session: {self._session_id}")
            return
        
        raise JupyterKernelNotAvailableError(
            "Neither execd nor Jupyter is available for stateful execution"
        )
    
    async def stop(self) -> None:
        """停止解释器"""
        if self._execd_client:
            if self._context_id:
                try:
                    await self._execd_client.delete_context(self._context_id)
                except Exception:
                    pass
            await self._execd_client.close()
            self._execd_client = None
            self._context_id = None
        
        if self._jupyter_manager:
            await self._jupyter_manager.stop()
            self._jupyter_manager = None
            self._session_id = None
        
        self._backend = None
        logger.info("StatefulCodeInterpreter stopped")
    
    async def execute(
        self,
        code: str,
        timeout: Optional[float] = None,
    ) -> ExecutionResult:
        """
        执行代码（状态化）
        
        变量、函数定义、import 会跨执行持久化。
        
        Args:
            code: 要执行的代码
            timeout: 执行超时（秒）
            
        Returns:
            执行结果
        """
        if self._backend == "execd" and self._execd_client:
            result = await self._execd_client.execute_code(
                code=code,
                language="python",
                context_id=self._context_id,
                timeout=timeout,
            )
            return ExecutionResult(
                stdout=result.stdout,
                stderr=result.stderr,
                exit_code=result.exit_code,
                success=result.success,
                duration_ms=result.duration_ms,
                language="python",
                metadata={
                    "context_id": result.context_id,
                    "result": result.result,
                    "backend": "execd",
                },
            )
        
        if self._backend == "jupyter" and self._jupyter_manager:
            result = await self._jupyter_manager.execute(
                code=code,
                session_id=self._session_id,
                timeout=timeout,
            )
            result.metadata["backend"] = "jupyter"
            return result
        
        raise JupyterKernelError("Interpreter not started")
    
    async def reset(self) -> None:
        """
        重置会话状态
        
        清除所有变量和定义。
        """
        if self._backend == "execd" and self._execd_client:
            # 删除旧上下文，创建新上下文
            if self._context_id:
                try:
                    await self._execd_client.delete_context(self._context_id)
                except Exception:
                    pass
            context = await self._execd_client.create_context(language="python")
            self._context_id = context.context_id
            logger.info(f"Reset execd context: {self._context_id}")
        
        elif self._backend == "jupyter" and self._jupyter_manager:
            await self._jupyter_manager.restart(self._session_id)
            logger.info(f"Reset Jupyter session: {self._session_id}")
    
    async def __aenter__(self) -> "StatefulCodeInterpreter":
        """进入上下文管理器"""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文管理器"""
        await self.stop()
