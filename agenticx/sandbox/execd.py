"""
AgenticX Execd Client

HTTP 客户端封装 execd daemon API，提供：
- 代码执行（支持状态化 Jupyter kernel）
- 命令执行（前台/后台）
- 文件操作（读/写/列表/删除）
- SSE 流式输出解析

基于 OpenSandbox execd 设计内化。

Example:
    >>> client = ExecdClient(endpoint="http://localhost:44772")
    >>> result = await client.execute_code("print('Hello')", language="python")
    >>> print(result.stdout)
    Hello
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any, List, AsyncIterator, Union
from urllib.parse import urljoin, urlencode

logger = logging.getLogger(__name__)

# Default execd port
DEFAULT_EXECD_PORT = 44772


class SupportedLanguage(str, Enum):
    """execd 支持的编程语言"""
    
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    JAVA = "java"
    GO = "go"
    BASH = "bash"
    SHELL = "shell"


@dataclass
class CodeExecutionResult:
    """
    代码执行结果
    
    封装 execd /code API 的响应。
    """
    
    stdout: str = ""
    """标准输出"""
    
    stderr: str = ""
    """标准错误"""
    
    result: str = ""
    """表达式结果（如果有）"""
    
    exit_code: int = 0
    """退出码"""
    
    success: bool = True
    """是否成功"""
    
    duration_ms: float = 0.0
    """执行耗时（毫秒）"""
    
    context_id: Optional[str] = None
    """执行上下文 ID（状态化执行）"""
    
    language: str = "python"
    """执行语言"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """额外元数据"""
    
    @property
    def output(self) -> str:
        """获取主要输出"""
        if self.result:
            return self.result
        return self.stdout if self.stdout else self.stderr


@dataclass
class CommandExecutionResult:
    """
    命令执行结果
    
    封装 execd /command API 的响应。
    """
    
    stdout: str = ""
    """标准输出"""
    
    stderr: str = ""
    """标准错误"""
    
    exit_code: int = 0
    """退出码"""
    
    success: bool = True
    """是否成功"""
    
    duration_ms: float = 0.0
    """执行耗时（毫秒）"""
    
    pid: Optional[int] = None
    """进程 ID（后台执行时）"""
    
    background: bool = False
    """是否后台执行"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """额外元数据"""


@dataclass
class FileEntry:
    """文件条目"""
    
    path: str
    """文件路径"""
    
    name: str = ""
    """文件名"""
    
    size: int = 0
    """文件大小（字节）"""
    
    is_dir: bool = False
    """是否为目录"""
    
    mode: int = 0o644
    """文件权限"""
    
    modified_at: Optional[str] = None
    """修改时间"""


@dataclass 
class CodeContext:
    """
    代码执行上下文
    
    用于状态化代码执行，变量跨执行持久化。
    """
    
    context_id: str
    """上下文 ID"""
    
    language: str = "python"
    """语言"""
    
    created_at: Optional[str] = None
    """创建时间"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """元数据"""


class ExecdConnectionError(Exception):
    """execd 连接错误"""
    
    def __init__(self, message: str, endpoint: str = ""):
        super().__init__(message)
        self.endpoint = endpoint


class ExecdExecutionError(Exception):
    """execd 执行错误"""
    
    def __init__(
        self,
        message: str,
        exit_code: int = 1,
        stdout: str = "",
        stderr: str = "",
    ):
        super().__init__(message)
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


class ExecdTimeoutError(Exception):
    """execd 超时错误"""
    
    def __init__(self, message: str = "Execution timed out", timeout: float = 0):
        super().__init__(message)
        self.timeout = timeout


class ExecdClient:
    """
    execd HTTP 客户端
    
    封装 execd daemon 的 HTTP API，提供：
    - 代码执行（支持状态化 Jupyter kernel）
    - 命令执行（前台/后台）
    - 文件操作（读/写/列表/删除）
    - 健康检查
    
    Example:
        >>> async with ExecdClient("http://localhost:44772") as client:
        ...     # 执行代码
        ...     result = await client.execute_code("x = 1 + 1")
        ...     result = await client.execute_code("print(x)", context_id=result.context_id)
        ...     
        ...     # 执行命令
        ...     cmd_result = await client.run_command("ls -la")
        ...     
        ...     # 文件操作
        ...     await client.write_file("/tmp/test.txt", "Hello World")
        ...     content = await client.read_file("/tmp/test.txt")
    """
    
    def __init__(
        self,
        endpoint: str,
        token: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        """
        初始化 execd 客户端
        
        Args:
            endpoint: execd daemon 地址（如 http://localhost:44772）
            token: 认证 token（可选）
            timeout: 默认请求超时（秒）
            max_retries: 最大重试次数
            retry_delay: 重试延迟（秒）
        """
        self._endpoint = endpoint.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._client = None
        self._contexts: Dict[str, CodeContext] = {}
        
    @property
    def endpoint(self) -> str:
        """获取 endpoint"""
        return self._endpoint
    
    @property
    def is_connected(self) -> bool:
        """是否已连接"""
        return self._client is not None
    
    async def connect(self) -> None:
        """
        建立连接
        
        初始化 HTTP 客户端。
        """
        try:
            import httpx
            self._client = httpx.AsyncClient(
                base_url=self._endpoint,
                timeout=self._timeout,
                headers=self._get_headers(),
            )
            logger.debug(f"Connected to execd at {self._endpoint}")
        except ImportError:
            # Fallback to aiohttp
            try:
                import aiohttp
                self._client = aiohttp.ClientSession(
                    base_url=self._endpoint,
                    timeout=aiohttp.ClientTimeout(total=self._timeout),
                    headers=self._get_headers(),
                )
                self._use_aiohttp = True
                logger.debug(f"Connected to execd at {self._endpoint} (using aiohttp)")
            except ImportError:
                raise ImportError(
                    "Either 'httpx' or 'aiohttp' is required for ExecdClient. "
                    "Install with: pip install httpx"
                )
    
    async def close(self) -> None:
        """关闭连接"""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.debug("Disconnected from execd")
    
    async def __aenter__(self) -> "ExecdClient":
        """异步上下文管理器入口"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """异步上下文管理器退出"""
        await self.close()
    
    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers
    
    async def _ensure_connected(self) -> None:
        """确保已连接"""
        if self._client is None:
            await self.connect()
    
    async def _request(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        stream: bool = False,
    ) -> Dict[str, Any]:
        """
        发送 HTTP 请求
        
        Args:
            method: HTTP 方法
            path: 请求路径
            json_data: JSON 数据
            params: 查询参数
            stream: 是否流式响应
            
        Returns:
            响应数据
        """
        await self._ensure_connected()
        
        url = path
        last_error = None
        
        for attempt in range(self._max_retries):
            try:
                if hasattr(self._client, 'request'):
                    # httpx
                    response = await self._client.request(
                        method=method,
                        url=url,
                        json=json_data,
                        params=params,
                    )
                    response.raise_for_status()
                    return response.json()
                else:
                    # aiohttp
                    async with self._client.request(
                        method=method,
                        url=url,
                        json=json_data,
                        params=params,
                    ) as response:
                        response.raise_for_status()
                        return await response.json()
                        
            except Exception as e:
                last_error = e
                if attempt < self._max_retries - 1:
                    await asyncio.sleep(self._retry_delay * (attempt + 1))
                    logger.warning(
                        f"Request failed (attempt {attempt + 1}/{self._max_retries}): {e}"
                    )
        
        raise ExecdConnectionError(
            f"Failed to connect to execd after {self._max_retries} attempts: {last_error}",
            endpoint=self._endpoint,
        )
    
    async def _request_sse(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        发送 SSE 流式请求
        
        Args:
            method: HTTP 方法
            path: 请求路径
            json_data: JSON 数据
            
        Yields:
            SSE 事件数据
        """
        await self._ensure_connected()
        
        try:
            if hasattr(self._client, 'stream'):
                # httpx
                async with self._client.stream(
                    method=method,
                    url=path,
                    json=json_data,
                    headers={**self._get_headers(), "Accept": "text/event-stream"},
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            data = line[5:].strip()
                            if data:
                                try:
                                    yield json.loads(data)
                                except json.JSONDecodeError:
                                    yield {"raw": data}
            else:
                # aiohttp fallback - non-streaming
                result = await self._request(method, path, json_data)
                yield result
                
        except Exception as e:
            raise ExecdConnectionError(
                f"SSE stream failed: {e}",
                endpoint=self._endpoint,
            )
    
    # ==================== 健康检查 ====================
    
    async def ping(self) -> bool:
        """
        健康检查
        
        Returns:
            是否健康
        """
        try:
            result = await self._request("GET", "/health")
            return result.get("status") == "ok"
        except Exception:
            return False
    
    async def get_health(self) -> Dict[str, Any]:
        """
        获取健康状态详情
        
        Returns:
            健康状态
        """
        return await self._request("GET", "/health")
    
    # ==================== 代码执行 ====================
    
    async def execute_code(
        self,
        code: str,
        language: str = "python",
        context_id: Optional[str] = None,
        timeout: Optional[float] = None,
        stream: bool = False,
    ) -> CodeExecutionResult:
        """
        执行代码
        
        Args:
            code: 要执行的代码
            language: 编程语言
            context_id: 执行上下文 ID（用于状态化执行）
            timeout: 超时时间（秒）
            stream: 是否流式输出
            
        Returns:
            代码执行结果
        """
        start_time = time.time()
        
        payload = {
            "code": code,
            "language": language,
        }
        if context_id:
            payload["context_id"] = context_id
        if timeout:
            payload["timeout"] = int(timeout * 1000)  # 转换为毫秒
        
        try:
            if stream:
                # 流式执行
                stdout_parts = []
                stderr_parts = []
                result_value = ""
                exit_code = 0
                
                async for event in self._request_sse("POST", "/code", payload):
                    event_type = event.get("type", "")
                    if event_type == "stdout":
                        stdout_parts.append(event.get("text", ""))
                    elif event_type == "stderr":
                        stderr_parts.append(event.get("text", ""))
                    elif event_type == "result":
                        result_value = event.get("text", "")
                    elif event_type == "exit":
                        exit_code = event.get("exit_code", 0)
                
                duration_ms = (time.time() - start_time) * 1000
                return CodeExecutionResult(
                    stdout="".join(stdout_parts),
                    stderr="".join(stderr_parts),
                    result=result_value,
                    exit_code=exit_code,
                    success=exit_code == 0,
                    duration_ms=duration_ms,
                    context_id=context_id,
                    language=language,
                )
            else:
                # 非流式执行
                result = await self._request("POST", "/code", payload)
                duration_ms = (time.time() - start_time) * 1000
                
                # 解析响应
                stdout = ""
                stderr = ""
                result_value = ""
                exit_code = 0
                
                # 处理 logs 字段
                logs = result.get("logs", {})
                if isinstance(logs, dict):
                    stdout_logs = logs.get("stdout", [])
                    stderr_logs = logs.get("stderr", [])
                    if stdout_logs:
                        stdout = "".join(
                            item.get("text", "") if isinstance(item, dict) else str(item)
                            for item in stdout_logs
                        )
                    if stderr_logs:
                        stderr = "".join(
                            item.get("text", "") if isinstance(item, dict) else str(item)
                            for item in stderr_logs
                        )
                
                # 处理 result 字段
                result_data = result.get("result", [])
                if result_data and isinstance(result_data, list) and len(result_data) > 0:
                    first_result = result_data[0]
                    if isinstance(first_result, dict):
                        result_value = first_result.get("text", "")
                    else:
                        result_value = str(first_result)
                
                exit_code = result.get("exit_code", 0)
                
                return CodeExecutionResult(
                    stdout=stdout,
                    stderr=stderr,
                    result=result_value,
                    exit_code=exit_code,
                    success=exit_code == 0,
                    duration_ms=duration_ms,
                    context_id=context_id or result.get("context_id"),
                    language=language,
                    metadata=result,
                )
                
        except ExecdConnectionError:
            raise
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            return CodeExecutionResult(
                stderr=str(e),
                exit_code=1,
                success=False,
                duration_ms=duration_ms,
                context_id=context_id,
                language=language,
            )
    
    # ==================== 上下文管理（状态化执行）====================
    
    async def create_context(
        self,
        language: str = "python",
    ) -> CodeContext:
        """
        创建代码执行上下文
        
        用于状态化代码执行，变量跨执行持久化。
        
        Args:
            language: 编程语言
            
        Returns:
            代码上下文
        """
        payload = {"language": language}
        result = await self._request("POST", "/code/context", payload)
        
        context = CodeContext(
            context_id=result.get("context_id", result.get("id", "")),
            language=language,
            created_at=result.get("created_at"),
            metadata=result,
        )
        self._contexts[context.context_id] = context
        logger.debug(f"Created code context: {context.context_id}")
        return context
    
    async def delete_context(self, context_id: str) -> None:
        """
        删除代码执行上下文
        
        Args:
            context_id: 上下文 ID
        """
        await self._request("DELETE", f"/code/context/{context_id}")
        self._contexts.pop(context_id, None)
        logger.debug(f"Deleted code context: {context_id}")
    
    async def list_contexts(self) -> List[CodeContext]:
        """
        列出所有代码执行上下文
        
        Returns:
            上下文列表
        """
        result = await self._request("GET", "/code/context")
        contexts = []
        for item in result.get("contexts", []):
            context = CodeContext(
                context_id=item.get("context_id", item.get("id", "")),
                language=item.get("language", "python"),
                created_at=item.get("created_at"),
                metadata=item,
            )
            contexts.append(context)
        return contexts
    
    # ==================== 命令执行 ====================
    
    async def run_command(
        self,
        command: str,
        background: bool = False,
        timeout: Optional[float] = None,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> CommandExecutionResult:
        """
        执行 Shell 命令
        
        Args:
            command: Shell 命令
            background: 是否后台执行
            timeout: 超时时间（秒）
            cwd: 工作目录
            env: 环境变量
            
        Returns:
            命令执行结果
        """
        start_time = time.time()
        
        payload: Dict[str, Any] = {
            "command": command,
            "background": background,
        }
        if timeout:
            payload["timeout"] = int(timeout * 1000)
        if cwd:
            payload["cwd"] = cwd
        if env:
            payload["env"] = env
        
        try:
            result = await self._request("POST", "/command", payload)
            duration_ms = (time.time() - start_time) * 1000
            
            # 解析响应
            stdout = ""
            stderr = ""
            logs = result.get("logs", {})
            if isinstance(logs, dict):
                stdout_logs = logs.get("stdout", [])
                stderr_logs = logs.get("stderr", [])
                if stdout_logs:
                    stdout = "".join(
                        item.get("text", "") if isinstance(item, dict) else str(item)
                        for item in stdout_logs
                    )
                if stderr_logs:
                    stderr = "".join(
                        item.get("text", "") if isinstance(item, dict) else str(item)
                        for item in stderr_logs
                    )
            
            exit_code = result.get("exit_code", 0)
            
            return CommandExecutionResult(
                stdout=stdout,
                stderr=stderr,
                exit_code=exit_code,
                success=exit_code == 0,
                duration_ms=duration_ms,
                pid=result.get("pid"),
                background=background,
                metadata=result,
            )
            
        except ExecdConnectionError:
            raise
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            return CommandExecutionResult(
                stderr=str(e),
                exit_code=1,
                success=False,
                duration_ms=duration_ms,
                background=background,
            )
    
    async def kill_command(self, pid: int, signal: int = 15) -> bool:
        """
        终止后台命令
        
        Args:
            pid: 进程 ID
            signal: 信号（默认 SIGTERM=15）
            
        Returns:
            是否成功
        """
        try:
            await self._request("POST", f"/command/{pid}/kill", {"signal": signal})
            return True
        except Exception:
            return False
    
    # ==================== 文件操作 ====================
    
    async def read_file(self, path: str) -> str:
        """
        读取文件内容
        
        Args:
            path: 文件路径
            
        Returns:
            文件内容
        """
        params = {"path": path}
        result = await self._request("GET", "/files", params=params)
        return result.get("content", result.get("data", ""))
    
    async def read_file_bytes(self, path: str) -> bytes:
        """
        读取文件内容（二进制）
        
        Args:
            path: 文件路径
            
        Returns:
            文件内容
        """
        content = await self.read_file(path)
        if isinstance(content, str):
            return content.encode("utf-8")
        return content
    
    async def write_file(
        self,
        path: str,
        content: Union[str, bytes],
        mode: int = 0o644,
    ) -> None:
        """
        写入文件
        
        Args:
            path: 文件路径
            content: 文件内容
            mode: 文件权限
        """
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        
        payload = {
            "files": [
                {
                    "path": path,
                    "data": content,
                    "mode": mode,
                }
            ]
        }
        await self._request("POST", "/files", payload)
    
    async def write_files(
        self,
        files: List[Dict[str, Any]],
    ) -> None:
        """
        批量写入文件
        
        Args:
            files: 文件列表，每个元素包含 path, data, mode
        """
        payload = {"files": files}
        await self._request("POST", "/files", payload)
    
    async def list_directory(
        self,
        path: str = "/",
        recursive: bool = False,
    ) -> List[FileEntry]:
        """
        列出目录内容
        
        Args:
            path: 目录路径
            recursive: 是否递归
            
        Returns:
            文件列表
        """
        params = {"path": path}
        if recursive:
            params["recursive"] = "true"
        
        result = await self._request("GET", "/files/list", params=params)
        
        entries = []
        for item in result.get("files", result.get("entries", [])):
            entry = FileEntry(
                path=item.get("path", ""),
                name=item.get("name", ""),
                size=item.get("size", 0),
                is_dir=item.get("is_dir", item.get("isDir", False)),
                mode=item.get("mode", 0o644),
                modified_at=item.get("modified_at", item.get("modifiedAt")),
            )
            entries.append(entry)
        
        return entries
    
    async def delete_file(self, path: str) -> None:
        """
        删除文件
        
        Args:
            path: 文件路径
        """
        params = {"path": path}
        await self._request("DELETE", "/files", params=params)
    
    async def mkdir(self, path: str, mode: int = 0o755) -> None:
        """
        创建目录
        
        Args:
            path: 目录路径
            mode: 目录权限
        """
        payload = {
            "path": path,
            "mode": mode,
        }
        await self._request("POST", "/files/mkdir", payload)
    
    # ==================== 指标 ====================
    
    async def get_metrics(self) -> Dict[str, Any]:
        """
        获取执行指标
        
        Returns:
            指标数据
        """
        return await self._request("GET", "/metrics")


# 便捷函数

async def create_execd_client(
    endpoint: str = f"http://localhost:{DEFAULT_EXECD_PORT}",
    token: Optional[str] = None,
) -> ExecdClient:
    """
    创建并连接 execd 客户端
    
    Args:
        endpoint: execd 地址
        token: 认证 token
        
    Returns:
        已连接的客户端
    """
    client = ExecdClient(endpoint=endpoint, token=token)
    await client.connect()
    return client
