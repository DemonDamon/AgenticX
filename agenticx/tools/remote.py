"""
RemoteTool: 用于连接 MCP (Model Context Protocol) 服务的通用远程工具
"""
import asyncio
import json
import logging
import os
import subprocess
from typing import Any, Dict, List, Optional, Type, Union

from pydantic import BaseModel, Field, create_model
from .base import BaseTool, ToolError

logger = logging.getLogger(__name__)

class MCPServerConfig(BaseModel):
    name: str
    command: str
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)
    timeout: float = 60.0
    cwd: Optional[str] = Field(default=None, description="工作目录")

class MCPToolCall(BaseModel):
    jsonrpc: str = Field(default="2.0", description="JSON-RPC version")
    id: int = Field(default=1, description="Request ID")
    method: str = Field(description="Tool method name")
    params: Dict[str, Any] = Field(default_factory=dict, description="Method parameters")
    
    def to_mcp_format(self) -> str:
        """转换为标准的 MCP 工具调用格式"""
        # 临时改为 tools/list 来查看可用工具
        mcp_message = {
            "jsonrpc": self.jsonrpc,
            "id": self.id,
            "method": "tools/list",
            "params": {}
        }
        return json.dumps(mcp_message)

class MCPToolResponse(BaseModel):
    jsonrpc: str = Field(default="2.0")
    id: int = Field(default=1)
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    
    @property
    def success(self) -> bool:
        """检查响应是否成功"""
        return self.error is None
    
    @property
    def error_message(self) -> Optional[str]:
        """获取错误消息"""
        if self.error:
            return self.error.get("message", "Unknown error")
        return None

class MCPToolInfo(BaseModel):
    """MCP 工具信息"""
    name: str
    description: str
    inputSchema: Dict[str, Any]

class RemoteTool(BaseTool):
    def __init__(
        self,
        server_config: Union[MCPServerConfig, Dict[str, Any]],
        tool_name: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        args_schema: Optional[Type[BaseModel]] = None,
        timeout: Optional[float] = None,
        organization_id: Optional[str] = None,
    ):
        if isinstance(server_config, dict):
            server_config = MCPServerConfig(**server_config)
        self.server_config = server_config
        self.tool_name = tool_name
        tool_display_name = name or f"{server_config.name}_{tool_name}"
        tool_description = description or f"Remote tool {tool_name} from {server_config.name} server"
        super().__init__(
            name=tool_display_name,
            description=tool_description,
            args_schema=args_schema,
            timeout=timeout or server_config.timeout,
            organization_id=organization_id,
        )

    async def _communicate_with_server(self, request: MCPToolCall) -> MCPToolResponse:
        try:
            # 构建环境变量
            env = dict(os.environ)
            env.update(self.server_config.env)
            
            # 调试信息：显示关键环境变量
            logger.debug(f"Environment variables for {self.server_config.name}:")
            for key, value in self.server_config.env.items():
                logger.debug(f"  {key}: {value[:50]}..." if len(value) > 50 else f"  {key}: {value}")
            
            # 构建完整的命令列表
            cmd_list = [self.server_config.command] + self.server_config.args
            
            logger.debug(f"Executing command: {cmd_list} in {self.server_config.cwd}")

            # 使用交互式进程通信，增加缓冲区限制以处理大响应
            process = await asyncio.create_subprocess_exec(
                *cmd_list,
                env=env,
                cwd=self.server_config.cwd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=1024*1024*10  # 增加到 10MB 缓冲区限制
            )

            # 确保流不为 None
            if process.stdin is None or process.stdout is None or process.stderr is None:
                raise ToolError("Failed to create process streams", self.name)

            try:
                # 第一步：发送初始化请求
                initialize_request = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "AgenticX", "version": "1.0.0"}
                    }
                }
                
                logger.debug(f"Step 1: Sending initialize request")
                logger.debug(f"Initialize: {json.dumps(initialize_request)}")
                
                # 发送初始化请求
                init_data = json.dumps(initialize_request) + "\n"
                process.stdin.write(init_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待初始化响应
                init_response_line = await process.stdout.readline()
                logger.debug(f"Initialize response: {init_response_line.decode('utf-8', 'ignore').strip()}")
                
                # 验证初始化成功
                try:
                    init_response = json.loads(init_response_line)
                    if init_response.get('error'):
                        raise ToolError(f"MCP initialization failed: {init_response['error']}", self.name)
                except json.JSONDecodeError:
                    raise ToolError("Invalid JSON response during initialization", self.name)
                
                # 第二步：发送 initialized 通知
                initialized_notification = {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized"
                }
                
                logger.debug(f"Step 2: Sending initialized notification")
                logger.debug(f"Initialized: {json.dumps(initialized_notification)}")
                
                # 发送 initialized 通知
                initialized_data = json.dumps(initialized_notification) + "\n"
                process.stdin.write(initialized_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 给服务器一点时间处理通知
                await asyncio.sleep(0.1)
                
                # 第三步：发送工具调用请求
                tool_request = {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": request.method,
                        "arguments": request.params
                    }
                }
                
                logger.debug(f"Step 3: Sending tool call request")
                logger.debug(f"Tool call: {json.dumps(tool_request)}")
                
                # 发送工具调用请求
                tool_data = json.dumps(tool_request) + "\n"
                process.stdin.write(tool_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待工具调用响应，跳过非JSON行
                tool_response = None
                max_attempts = 10  # 最多尝试读取10行
                for _ in range(max_attempts):
                    line = await process.stdout.readline()
                    if not line:
                        break
                    line_str = line.decode('utf-8', 'ignore').strip()
                    if not line_str:
                        continue
                    logger.debug(f"Tool response line: {line_str}")
                    try:
                        # 尝试解析JSON
                        response_data = json.loads(line_str)
                        # 检查是否是我们期望的工具调用响应
                        if (response_data.get('jsonrpc') == '2.0' and 
                            response_data.get('id') == 3):
                            tool_response = response_data
                            break
                    except json.JSONDecodeError:
                        # 跳过非JSON行（如ASCII艺术、日志等）
                        continue
                
                # 关闭输入流
                process.stdin.close()
                
                # 等待进程结束
                await process.wait()
                
                # 读取 stderr
                stderr_data = await process.stderr.read()
                stderr_output = stderr_data.decode('utf-8', 'ignore').strip()
                if stderr_output:
                    logger.info(f"MCP Server STDERR: {stderr_output}")

                if process.returncode != 0:
                    raise ToolError(
                        f"MCP server process exited with code {process.returncode}. Stderr: {stderr_output}",
                        self.name
                    )

                if tool_response is None:
                    raise ToolError("No valid tool response received from MCP server", self.name)
                
                return MCPToolResponse(**tool_response)
                    
            finally:
                # 确保进程被清理
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        process.kill
        
        except Exception as e:
            if isinstance(e, ToolError):
                raise
            raise ToolError(f"An unexpected error occurred during communication: {e}", self.name) from e

    def _run(self, **kwargs) -> Any:
        return asyncio.run(self._arun(**kwargs))

    async def _arun(self, **kwargs) -> Any:
        call_request = MCPToolCall(method=self.tool_name, params=kwargs)
        response = await self._communicate_with_server(call_request)
        if not response.success:
            raise ToolError(f"Remote call failed: {response.error_message}", self.name, response.error or {})
        return response.result

    def to_openai_schema(self) -> Dict[str, Any]:
        schema = {"type": "function", "function": {"name": self.name, "description": self.description}}
        if self.args_schema:
            json_schema = self.args_schema.model_json_schema()
            schema["function"]["parameters"] = {"type": "object", "properties": json_schema.get("properties", {}), "required": json_schema.get("required", [])}
        else:
            schema["function"]["parameters"] = {"type": "object", "properties": {}, "required": []}
        return schema


class MCPClient:
    """MCP 客户端，用于自动发现和创建工具"""
    
    def __init__(self, server_config: Union[MCPServerConfig, Dict[str, Any]]):
        if isinstance(server_config, dict):
            server_config = MCPServerConfig(**server_config)
        self.server_config = server_config
        self._tools_cache: Optional[List[MCPToolInfo]] = None
    
    async def discover_tools(self) -> List[MCPToolInfo]:
        """自动发现 MCP 服务器提供的所有工具"""
        if self._tools_cache is not None:
            return self._tools_cache
            
        process = None
        try:
            # 构建环境变量
            env = dict(os.environ)
            env.update(self.server_config.env)
            
            # 构建完整的命令列表
            cmd_list = [self.server_config.command] + self.server_config.args
            
            logger.info(f"Starting MCP server discovery: {' '.join(cmd_list)}")
            logger.debug(f"Working directory: {self.server_config.cwd}")
            logger.debug(f"Environment variables: {list(self.server_config.env.keys())}")

            # 使用交互式进程通信
            process = await asyncio.create_subprocess_exec(
                *cmd_list,
                env=env,
                cwd=self.server_config.cwd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=1024*1024*10
            )

            # 确保流不为 None
            if process.stdin is None or process.stdout is None or process.stderr is None:
                raise ToolError("Failed to create process streams", "MCPClient")

            # 检查进程是否立即退出
            try:
                await asyncio.wait_for(process.wait(), timeout=0.1)
                # 如果进程立即退出，读取错误信息
                stderr_output = await process.stderr.read()
                error_msg = stderr_output.decode('utf-8', errors='ignore')
                logger.error(f"MCP server process exited immediately with code {process.returncode}")
                logger.error(f"Error output: {error_msg}")
                raise ToolError(f"MCP server failed to start (exit code {process.returncode}): {error_msg}", "MCPClient")
            except asyncio.TimeoutError:
                # 进程仍在运行，这是正常的
                logger.debug("MCP server process started successfully")

            try:
                # 初始化握手
                initialize_request = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "clientInfo": {"name": "AgenticX", "version": "1.0.0"}
                    }
                }
                
                logger.debug("Sending initialization request")
                init_data = json.dumps(initialize_request) + "\n"
                process.stdin.write(init_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待初始化响应，跳过非JSON行
                init_response = None
                max_attempts = 20  # 最多尝试读取20行
                all_lines = []  # 用于调试
                
                # 等待一小段时间让进程启动
                await asyncio.sleep(0.5)
                
                for attempt in range(max_attempts):
                    try:
                        # 使用超时读取，避免无限等待
                        line = await asyncio.wait_for(process.stdout.readline(), timeout=3.0)
                        if not line:
                            logger.debug(f"No more output after {attempt} attempts")
                            break
                        line_str = line.decode('utf-8').strip()
                        all_lines.append(line_str)  # 记录所有行用于调试
                        
                        if not line_str:
                            continue
                            
                        logger.debug(f"Received line {attempt}: {line_str[:200]}...")  # 限制日志长度
                        
                        try:
                            # 尝试解析JSON
                            response_data = json.loads(line_str)
                            # 检查是否是我们期望的初始化响应
                            if (response_data.get('jsonrpc') == '2.0' and 
                                response_data.get('id') == 1):
                                init_response = response_data
                                logger.debug("Received valid initialization response")
                                break
                        except json.JSONDecodeError:
                            # 跳过非JSON行（如ASCII艺术、日志等）
                            logger.debug(f"Skipping non-JSON line: {line_str[:100]}...")
                            continue
                    except asyncio.TimeoutError:
                        logger.debug(f"Timeout waiting for line {attempt}")
                        # 检查进程是否还在运行
                        if process.returncode is not None:
                            stderr_output = await process.stderr.read()
                            error_msg = stderr_output.decode('utf-8', errors='ignore')
                            logger.error(f"Process exited during initialization with code {process.returncode}")
                            logger.error(f"Error output: {error_msg}")
                            raise ToolError(f"MCP server crashed during initialization: {error_msg}", "MCPClient")
                        continue
                
                if init_response is None:
                    # 添加调试信息
                    stderr_output = await process.stderr.read()
                    error_msg = stderr_output.decode('utf-8', errors='ignore')
                    logger.error(f"Failed to get valid initialization response")
                    logger.error(f"All lines received: {all_lines[:5]}...")  # 只显示前5行
                    logger.error(f"Process stderr: {error_msg}")
                    logger.error(f"Process return code: {process.returncode}")
                    raise ToolError("Failed to initialize MCP server - no valid response received", "MCPClient")
                
                if init_response.get('error'):
                    error_info = init_response['error']
                    logger.error(f"MCP initialization error: {error_info}")
                    raise ToolError(f"MCP initialization failed: {error_info}", "MCPClient")
                
                logger.debug("MCP server initialized successfully")
                
                # 发送 initialized 通知
                initialized_notification = {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized"
                }
                
                initialized_data = json.dumps(initialized_notification) + "\n"
                process.stdin.write(initialized_data.encode('utf-8'))
                await process.stdin.drain()
                
                await asyncio.sleep(0.1)
                
                # 请求工具列表
                tools_request = {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {}
                }
                
                logger.debug("Requesting tools list")
                tools_data = json.dumps(tools_request) + "\n"
                process.stdin.write(tools_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待工具列表响应，跳过非JSON行
                tools_response = None
                max_attempts = 10  # 最多尝试读取10行
                for attempt in range(max_attempts):
                    try:
                        line = await asyncio.wait_for(process.stdout.readline(), timeout=3.0)
                        if not line:
                            logger.debug(f"No more output for tools list after {attempt} attempts")
                            break
                        line_str = line.decode('utf-8').strip()
                        if not line_str:
                            continue
                            
                        logger.debug(f"Tools response line {attempt}: {line_str[:200]}...")
                        
                        try:
                            # 尝试解析JSON
                            response_data = json.loads(line_str)
                            # 检查是否是我们期望的工具列表响应
                            if (response_data.get('jsonrpc') == '2.0' and 
                                response_data.get('id') == 2):
                                tools_response = response_data
                                logger.debug("Received valid tools list response")
                                break
                        except json.JSONDecodeError:
                            # 跳过非JSON行（如ASCII艺术、日志等）
                            logger.debug(f"Skipping non-JSON tools line: {line_str[:100]}...")
                            continue
                    except asyncio.TimeoutError:
                        logger.debug(f"Timeout waiting for tools response line {attempt}")
                        continue
                
                if tools_response is None:
                    logger.error("Failed to get valid tools list response")
                    raise ToolError("Failed to get tools list from MCP server", "MCPClient")
                
                if tools_response.get('error'):
                    error_info = tools_response['error']
                    logger.error(f"Tools list error: {error_info}")
                    raise ToolError(f"Failed to get tools list: {error_info}", "MCPClient")
                
                # 解析工具信息
                tools_data = tools_response.get('result', {}).get('tools', [])
                tools = []
                for tool_data in tools_data:
                    try:
                        tool_info = MCPToolInfo(
                            name=tool_data['name'],
                            description=tool_data.get('description', ''),
                            inputSchema=tool_data.get('inputSchema', {})
                        )
                        tools.append(tool_info)
                        logger.debug(f"Discovered tool: {tool_info.name}")
                    except Exception as e:
                        logger.warning(f"Failed to parse tool data {tool_data}: {e}")
                        continue
                
                logger.info(f"Successfully discovered {len(tools)} tools from MCP server")
                self._tools_cache = tools
                return tools
                
            finally:
                # 确保进程被清理
                if process and process.returncode is None:
                    logger.debug("Cleaning up MCP server process")
                    try:
                        process.stdin.close()
                    except:
                        pass
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        logger.warning("MCP server process did not terminate gracefully, killing it")
                        process.kill()
        
        except Exception as e:
            if process and process.returncode is None:
                try:
                    process.terminate()
                    await asyncio.wait_for(process.wait(), timeout=2.0)
                except:
                    try:
                        process.kill()
                    except:
                        pass
            
            if isinstance(e, ToolError):
                raise
            logger.error(f"Unexpected error during tool discovery: {e}")
            raise ToolError(f"Failed to discover tools: {e}", "MCPClient") from e
    
    def _create_pydantic_model_from_schema(self, schema: Dict[str, Any], model_name: str) -> Type[BaseModel]:
        """从 JSON Schema 创建 Pydantic 模型"""
        if not schema or schema.get('type') != 'object':
            # 如果没有 schema 或不是对象类型，返回空模型
            return create_model(model_name)
        
        properties = schema.get('properties', {})
        required = schema.get('required', [])
        
        fields = {}
        for field_name, field_schema in properties.items():
            field_type = self._json_schema_to_python_type(field_schema)
            field_description = field_schema.get('description', '')
            
            if field_name in required:
                fields[field_name] = (field_type, Field(description=field_description))
            else:
                fields[field_name] = (Optional[field_type], Field(default=None, description=field_description))
        
        return create_model(model_name, **fields)
    
    def _json_schema_to_python_type(self, schema: Dict[str, Any]) -> type:
        """将 JSON Schema 类型转换为 Python 类型"""
        schema_type = schema.get('type', 'string')
        
        if schema_type == 'string':
            return str
        elif schema_type == 'integer':
            return int
        elif schema_type == 'number':
            return float
        elif schema_type == 'boolean':
            return bool
        elif schema_type == 'array':
            item_type = self._json_schema_to_python_type(schema.get('items', {'type': 'string'}))
            return List[item_type]
        elif schema_type == 'object':
            return Dict[str, Any]
        else:
            return str  # 默认为字符串
    
    async def create_tool(self, tool_name: str, organization_id: Optional[str] = None) -> RemoteTool:
        """为指定的工具名称创建 RemoteTool 实例"""
        tools = await self.discover_tools()
        
        # 查找指定的工具
        tool_info = None
        for tool in tools:
            if tool.name == tool_name:
                tool_info = tool
                break
        
        if tool_info is None:
            available_tools = [tool.name for tool in tools]
            raise ToolError(f"Tool '{tool_name}' not found. Available tools: {available_tools}", tool_name)
        
        # 从 inputSchema 创建 Pydantic 模型
        args_schema = self._create_pydantic_model_from_schema(
            tool_info.inputSchema, 
            f"{tool_name.title().replace('_', '')}Args"
        )
        
        return RemoteTool(
            server_config=self.server_config,
            tool_name=tool_name,
            name=f"{self.server_config.name}_{tool_name}",
            description=tool_info.description,
            args_schema=args_schema,
            organization_id=organization_id,
        )
    
    async def create_all_tools(self, organization_id: Optional[str] = None) -> List[RemoteTool]:
        """创建服务器提供的所有工具"""
        tools = await self.discover_tools()
        remote_tools = []
        
        for tool_info in tools:
            args_schema = self._create_pydantic_model_from_schema(
                tool_info.inputSchema, 
                f"{tool_info.name.title().replace('_', '')}Args"
            )
            
            remote_tool = RemoteTool(
                server_config=self.server_config,
                tool_name=tool_info.name,
                name=f"{self.server_config.name}_{tool_info.name}",
                description=tool_info.description,
                args_schema=args_schema,
                organization_id=organization_id,
            )
            remote_tools.append(remote_tool)
        
        return remote_tools


def load_mcp_config(config_path: str = "~/.cursor/mcp.json") -> Dict[str, MCPServerConfig]:
    """加载 MCP 配置文件"""
    config_path = os.path.expanduser(config_path)
    
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"MCP config file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config_data = json.load(f)
    
    # 处理嵌套的 mcpServers 结构
    if 'mcpServers' in config_data:
        servers_data = config_data['mcpServers']
    else:
        servers_data = config_data
    
    servers = {}
    for name, server_data in servers_data.items():
        servers[name] = MCPServerConfig(name=name, **server_data)
    
    return servers


async def create_mcp_client(server_name: str, config_path: str = "~/.cursor/mcp.json") -> MCPClient:
    """便捷函数：从配置文件创建 MCP 客户端"""
    configs = load_mcp_config(config_path)
    
    if server_name not in configs:
        available_servers = list(configs.keys())
        raise ValueError(f"Server '{server_name}' not found in config. Available servers: {available_servers}")
    
    return MCPClient(configs[server_name]) 


# ==================== MinerU 特定远程工具支持 ====================

import aiohttp
import aiofiles
import zipfile
import tempfile
from pathlib import Path
from typing import BinaryIO, AsyncIterator
from urllib.parse import urljoin

class MinerUConfig(BaseModel):
    """MinerU 配置管理"""
    api_key: Optional[str] = Field(default=None, description="MinerU API 密钥")
    base_url: Optional[str] = Field(default="https://api.mineru.com", description="MinerU API 基础 URL")
    timeout: float = Field(default=300.0, description="请求超时时间（秒）")
    max_retries: int = Field(default=3, description="最大重试次数")
    retry_delay: float = Field(default=1.0, description="重试延迟（秒）")
    
    @classmethod
    def from_env(cls) -> "MinerUConfig":
        """从环境变量创建配置"""
        return cls(
            api_key=os.getenv("MINERU_API_KEY"),
            base_url=os.getenv("MINERU_BASE_URL", "https://api.mineru.com"),
            timeout=float(os.getenv("MINERU_TIMEOUT", "300.0")),
            max_retries=int(os.getenv("MINERU_MAX_RETRIES", "3")),
            retry_delay=float(os.getenv("MINERU_RETRY_DELAY", "1.0"))
        )
    
    def validate_config(self) -> None:
        """验证配置有效性"""
        if not self.api_key:
            raise ValueError("MinerU API key is required")
        if not self.base_url:
            raise ValueError("MinerU base URL is required")


class MinerUTaskStatus(BaseModel):
    """MinerU 任务状态"""
    task_id: str
    status: str  # pending, processing, completed, failed
    progress: float = Field(default=0.0, description="进度百分比 (0-100)")
    message: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class MinerUBatchUploadResult(BaseModel):
    """批量上传结果"""
    task_id: str
    uploaded_files: List[str]
    failed_files: List[Dict[str, str]]  # [{"file": "path", "error": "reason"}]
    total_files: int
    success_count: int
    failure_count: int


class MinerUAPIClient:
    """MinerU API 客户端"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        self.config = config or MinerUConfig.from_env()
        self.config.validate_config()
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout),
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "User-Agent": "AgenticX-MinerU/1.0.0"
            }
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器退出"""
        if self._session:
            await self._session.close()
    
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        **kwargs
    ) -> Dict[str, Any]:
        """发送 HTTP 请求，带重试机制"""
        if not self._session:
            raise RuntimeError("Client not initialized. Use async context manager.")
        
        url = urljoin(self.config.base_url, endpoint)
        
        for attempt in range(self.config.max_retries + 1):
            try:
                async with self._session.request(method, url, **kwargs) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 429:  # Rate limit
                        if attempt < self.config.max_retries:
                            await asyncio.sleep(self.config.retry_delay * (2 ** attempt))
                            continue
                    
                    # 其他错误状态
                    error_text = await response.text()
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"API request failed: {error_text}"
                    )
            
            except aiohttp.ClientError as e:
                if attempt < self.config.max_retries:
                    logger.warning(f"Request failed (attempt {attempt + 1}): {e}")
                    await asyncio.sleep(self.config.retry_delay * (2 ** attempt))
                    continue
                raise ToolError(f"API request failed after {self.config.max_retries} retries: {e}", "MinerUAPIClient")
        
        raise ToolError("Maximum retries exceeded", "MinerUAPIClient")
    
    async def upload_file(self, file_path: str) -> str:
        """上传单个文件"""
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        data = aiohttp.FormData()
        data.add_field('file', 
                      open(file_path, 'rb'), 
                      filename=file_path.name,
                      content_type='application/octet-stream')
        
        result = await self._make_request("POST", "/api/v1/upload", data=data)
        return result.get("file_id", "")
    
    async def upload_files_batch(self, file_paths: List[str]) -> MinerUBatchUploadResult:
        """批量上传文件"""
        uploaded_files = []
        failed_files = []
        
        for file_path in file_paths:
            try:
                file_id = await self.upload_file(file_path)
                uploaded_files.append(file_id)
                logger.info(f"Successfully uploaded: {file_path} -> {file_id}")
            except Exception as e:
                failed_files.append({"file": file_path, "error": str(e)})
                logger.error(f"Failed to upload {file_path}: {e}")
        
        return MinerUBatchUploadResult(
            task_id="",  # 批量上传不返回任务ID
            uploaded_files=uploaded_files,
            failed_files=failed_files,
            total_files=len(file_paths),
            success_count=len(uploaded_files),
            failure_count=len(failed_files)
        )
    
    async def submit_parse_task(
        self, 
        file_ids: List[str], 
        parse_params: Optional[Dict[str, Any]] = None
    ) -> str:
        """提交解析任务"""
        payload = {
            "file_ids": file_ids,
            "parse_params": parse_params or {}
        }
        
        result = await self._make_request("POST", "/api/v1/parse", json=payload)
        return result.get("task_id", "")
    
    async def get_task_status(self, task_id: str) -> MinerUTaskStatus:
        """获取任务状态"""
        result = await self._make_request("GET", f"/api/v1/tasks/{task_id}")
        return MinerUTaskStatus(**result)
    
    async def download_result(self, task_id: str, output_path: str) -> str:
        """下载解析结果"""
        if not self._session:
            raise RuntimeError("Client not initialized")
        
        url = urljoin(self.config.base_url, f"/api/v1/tasks/{task_id}/download")
        
        async with self._session.get(url) as response:
            if response.status != 200:
                error_text = await response.text()
                raise ToolError(f"Download failed: {error_text}", "MinerUAPIClient")
            
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            async with aiofiles.open(output_path, 'wb') as f:
                async for chunk in response.content.iter_chunked(8192):
                    await f.write(chunk)
        
        return str(output_path)
    
    async def stream_download(self, task_id: str) -> AsyncIterator[bytes]:
        """流式下载解析结果"""
        if not self._session:
            raise RuntimeError("Client not initialized")
        
        url = urljoin(self.config.base_url, f"/api/v1/tasks/{task_id}/download")
        
        async with self._session.get(url) as response:
            if response.status != 200:
                error_text = await response.text()
                raise ToolError(f"Stream download failed: {error_text}", "MinerUAPIClient")
            
            async for chunk in response.content.iter_chunked(8192):
                yield chunk
    
    async def get_supported_languages(self) -> List[str]:
        """获取支持的 OCR 语言列表"""
        result = await self._make_request("GET", "/api/v1/languages")
        return result.get("languages", [])


class MinerURemoteTool(BaseTool):
    """MinerU 远程工具基类"""
    
    def __init__(
        self,
        name: str,
        description: str,
        args_schema: Type[BaseModel],
        config: Optional[MinerUConfig] = None,
        organization_id: Optional[str] = None,
    ):
        super().__init__(
            name=name,
            description=description,
            args_schema=args_schema,
            organization_id=organization_id,
        )
        self.config = config or MinerUConfig.from_env()
    
    async def _arun(self, **kwargs) -> Any:
        """异步执行工具"""
        async with MinerUAPIClient(self.config) as client:
            return await self._execute_with_client(client, **kwargs)
    
    def _run(self, **kwargs) -> Any:
        """同步执行工具"""
        return asyncio.run(self._arun(**kwargs))
    
    async def _execute_with_client(self, client: MinerUAPIClient, **kwargs) -> Any:
        """使用客户端执行具体逻辑，子类需要实现"""
        raise NotImplementedError("Subclasses must implement _execute_with_client")


class MinerUParseRemoteTool(MinerURemoteTool):
    """MinerU 远程解析工具"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        from .mineru import MinerUParseArgs  # 避免循环导入
        
        super().__init__(
            name="mineru_parse_remote",
            description="Parse documents using MinerU remote API service",
            args_schema=MinerUParseArgs,
            config=config,
        )
    
    async def _execute_with_client(self, client: MinerUAPIClient, **kwargs) -> Dict[str, Any]:
        """执行远程解析"""
        file_paths = kwargs.get("file_paths", [])
        if not file_paths:
            raise ValueError("file_paths is required")
        
        # 1. 批量上传文件
        logger.info(f"Uploading {len(file_paths)} files...")
        upload_result = await client.upload_files_batch(file_paths)
        
        if upload_result.failure_count > 0:
            logger.warning(f"Failed to upload {upload_result.failure_count} files")
        
        if not upload_result.uploaded_files:
            raise ToolError("No files were successfully uploaded", self.name)
        
        # 2. 提交解析任务
        parse_params = {
            "output_format": kwargs.get("output_format", "markdown"),
            "parse_method": kwargs.get("parse_method", "auto"),
            "ocr_language": kwargs.get("ocr_language", ["en", "zh"]),
        }
        
        logger.info("Submitting parse task...")
        task_id = await client.submit_parse_task(upload_result.uploaded_files, parse_params)
        
        # 3. 轮询任务状态
        logger.info(f"Polling task status: {task_id}")
        max_wait_time = kwargs.get("max_wait_time", 600)  # 10分钟
        poll_interval = kwargs.get("poll_interval", 5)  # 5秒
        
        start_time = asyncio.get_event_loop().time()
        while True:
            status = await client.get_task_status(task_id)
            
            if status.status == "completed":
                logger.info("Task completed successfully")
                break
            elif status.status == "failed":
                raise ToolError(f"Parse task failed: {status.error}", self.name)
            elif asyncio.get_event_loop().time() - start_time > max_wait_time:
                raise ToolError(f"Task timeout after {max_wait_time} seconds", self.name)
            
            logger.info(f"Task status: {status.status}, progress: {status.progress}%")
            await asyncio.sleep(poll_interval)
        
        # 4. 下载结果
        output_dir = kwargs.get("output_dir", tempfile.mkdtemp(prefix="mineru_"))
        output_path = Path(output_dir) / f"{task_id}_result.zip"
        
        logger.info(f"Downloading result to: {output_path}")
        downloaded_file = await client.download_result(task_id, str(output_path))
        
        # 5. 解压结果
        extract_dir = Path(output_dir) / f"{task_id}_extracted"
        extract_dir.mkdir(exist_ok=True)
        
        with zipfile.ZipFile(downloaded_file, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
        
        return {
            "task_id": task_id,
            "status": "completed",
            "output_dir": str(extract_dir),
            "downloaded_file": downloaded_file,
            "upload_summary": {
                "total_files": upload_result.total_files,
                "success_count": upload_result.success_count,
                "failure_count": upload_result.failure_count,
                "failed_files": upload_result.failed_files
            }
        }


class MinerULanguagesRemoteTool(MinerURemoteTool):
    """MinerU 远程语言查询工具"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        from .mineru import MinerUOCRLanguagesArgs  # 避免循环导入
        
        super().__init__(
            name="mineru_languages_remote",
            description="Get supported OCR languages from MinerU remote API",
            args_schema=MinerUOCRLanguagesArgs,
            config=config,
        )
    
    async def _execute_with_client(self, client: MinerUAPIClient, **kwargs) -> Dict[str, Any]:
        """获取支持的语言列表"""
        logger.info("Fetching supported OCR languages...")
        languages = await client.get_supported_languages()
        
        return {
            "languages": languages,
            "count": len(languages),
            "source": "remote_api"
        }


# ==================== 工厂函数 ====================

def create_mineru_remote_tools(config: Optional[MinerUConfig] = None) -> List[MinerURemoteTool]:
    """创建所有 MinerU 远程工具"""
    return [
        MinerUParseRemoteTool(config),
        MinerULanguagesRemoteTool(config),
    ]


def create_mineru_api_client(config: Optional[MinerUConfig] = None) -> MinerUAPIClient:
    """创建 MinerU API 客户端"""
    return MinerUAPIClient(config)


# ==================== 配置加载函数 ====================

def load_mineru_config(config_path: Optional[str] = None) -> MinerUConfig:
    """加载 MinerU 配置
    
    Args:
        config_path: 配置文件路径，如果为 None 则从环境变量加载
    
    Returns:
        MinerUConfig: 配置对象
    """
    if config_path:
        config_path = Path(config_path).expanduser()
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
            return MinerUConfig(**config_data)
        else:
            logger.warning(f"Config file not found: {config_path}, falling back to environment variables")
    
    return MinerUConfig.from_env()


# ==================== 批量处理工具 ====================

class MinerUBatchProcessor:
    """MinerU 批量处理器"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        self.config = config or MinerUConfig.from_env()
    
    async def process_directory(
        self, 
        input_dir: str, 
        output_dir: str,
        file_patterns: List[str] = None,
        **parse_kwargs
    ) -> Dict[str, Any]:
        """批量处理目录中的文件"""
        input_path = Path(input_dir)
        if not input_path.exists():
            raise FileNotFoundError(f"Input directory not found: {input_dir}")
        
        # 收集文件
        patterns = file_patterns or ["*.pdf", "*.png", "*.jpg", "*.jpeg"]
        files = []
        for pattern in patterns:
            files.extend(input_path.glob(pattern))
        
        if not files:
            raise ValueError(f"No files found in {input_dir} matching patterns: {patterns}")
        
        logger.info(f"Found {len(files)} files to process")
        
        # 使用远程解析工具处理
        parse_tool = MinerUParseRemoteTool(self.config)
        result = await parse_tool._arun(
            file_paths=[str(f) for f in files],
            output_dir=output_dir,
            **parse_kwargs
        )
        
        return result
    
    async def process_files_with_callback(
        self,
        file_paths: List[str],
        callback_url: Optional[str] = None,
        **parse_kwargs
    ) -> str:
        """处理文件并支持回调通知"""
        async with MinerUAPIClient(self.config) as client:
            # 上传文件
            upload_result = await client.upload_files_batch(file_paths)
            
            if not upload_result.uploaded_files:
                raise ToolError("No files were successfully uploaded", "MinerUBatchProcessor")
            
            # 添加回调参数
            parse_params = parse_kwargs.copy()
            if callback_url:
                parse_params["callback_url"] = callback_url
            
            # 提交任务
            task_id = await client.submit_parse_task(upload_result.uploaded_files, parse_params)
            
            return task_id
    
    async def process_files_with_progress(
        self,
        file_paths: List[str],
        output_dir: str,
        progress_callback: Optional[callable] = None,
        **parse_kwargs
    ) -> Dict[str, Any]:
        """处理文件并提供进度回调"""
        async with MinerUAPIClient(self.config) as client:
            # 上传文件
            logger.info(f"开始上传 {len(file_paths)} 个文件...")
            upload_result = await client.upload_files_batch(file_paths)
            
            if progress_callback:
                progress_callback("upload", 100, f"上传完成: {upload_result.success_count}/{upload_result.total_files}")
            
            if not upload_result.uploaded_files:
                raise ToolError("No files were successfully uploaded", "MinerUBatchProcessor")
            
            # 提交解析任务
            logger.info("提交解析任务...")
            task_id = await client.submit_parse_task(upload_result.uploaded_files, parse_kwargs)
            
            # 轮询任务状态
            logger.info(f"开始轮询任务状态: {task_id}")
            while True:
                status = await client.get_task_status(task_id)
                
                if progress_callback:
                    progress_callback("parse", status.progress, status.message or f"状态: {status.status}")
                
                if status.status == "completed":
                    # 下载结果
                    logger.info("任务完成，开始下载结果...")
                    result_path = await client.download_result(task_id, output_dir)
                    
                    if progress_callback:
                        progress_callback("download", 100, f"下载完成: {result_path}")
                    
                    return {
                        "success": True,
                        "task_id": task_id,
                        "result_path": result_path,
                        "upload_result": upload_result.dict(),
                        "final_status": status.dict()
                    }
                elif status.status == "failed":
                    raise ToolError(f"Task failed: {status.error}", "MinerUBatchProcessor")
                
                # 等待一段时间再次检查
                await asyncio.sleep(5)
    
    async def get_task_progress(self, task_id: str) -> MinerUTaskStatus:
        """获取任务进度"""
        async with MinerUAPIClient(self.config) as client:
            return await client.get_task_status(task_id)
    
    async def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        async with MinerUAPIClient(self.config) as client:
            try:
                await client._make_request("POST", f"/tasks/{task_id}/cancel")
                return True
            except Exception as e:
                logger.error(f"Failed to cancel task {task_id}: {e}")
                return False


class MinerUBatchRemoteTool(MinerURemoteTool):
    """MinerU 批量处理远程工具"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        from ..tools.mineru import MinerUBatchArgs  # 避免循环导入
        
        super().__init__(
            name="mineru_batch_parse",
            description="批量解析多个文档文件，支持进度跟踪和回调通知",
            args_schema=MinerUBatchArgs,
            config=config
        )
        self.processor = MinerUBatchProcessor(config)
    
    async def _execute_with_client(self, client: MinerUAPIClient, **kwargs) -> Dict[str, Any]:
        """执行批量解析"""
        file_paths = kwargs.get("file_paths", [])
        output_dir = kwargs.get("output_dir", "./outputs")
        callback_url = kwargs.get("callback_url")
        
        if not file_paths:
            raise ToolError("No file paths provided", self.name)
        
        # 验证文件存在
        missing_files = []
        for file_path in file_paths:
            if not Path(file_path).exists():
                missing_files.append(file_path)
        
        if missing_files:
            raise ToolError(f"Files not found: {missing_files}", self.name)
        
        # 如果提供了回调URL，使用异步处理
        if callback_url:
            task_id = await self.processor.process_files_with_callback(
                file_paths=file_paths,
                callback_url=callback_url,
                **{k: v for k, v in kwargs.items() if k not in ["file_paths", "output_dir", "callback_url"]}
            )
            return {
                "success": True,
                "task_id": task_id,
                "message": "任务已提交，将通过回调URL通知结果",
                "callback_url": callback_url
            }
        else:
            # 同步处理并等待结果
            result = await self.processor.process_files_with_progress(
                file_paths=file_paths,
                output_dir=output_dir,
                **{k: v for k, v in kwargs.items() if k not in ["file_paths", "output_dir", "callback_url"]}
            )
            return result


# ==================== 进度跟踪工具 ====================

class MinerUProgressTracker:
    """MinerU 进度跟踪器"""
    
    def __init__(self, config: Optional[MinerUConfig] = None):
        self.config = config or MinerUConfig.from_env()
        self.active_tasks: Dict[str, MinerUTaskStatus] = {}
    
    async def track_task(self, task_id: str, update_interval: float = 5.0) -> AsyncIterator[MinerUTaskStatus]:
        """跟踪任务进度"""
        async with MinerUAPIClient(self.config) as client:
            while True:
                try:
                    status = await client.get_task_status(task_id)
                    self.active_tasks[task_id] = status
                    yield status
                    
                    if status.status in ["completed", "failed"]:
                        break
                    
                    await asyncio.sleep(update_interval)
                except Exception as e:
                    logger.error(f"Error tracking task {task_id}: {e}")
                    break
    
    def get_task_status(self, task_id: str) -> Optional[MinerUTaskStatus]:
        """获取缓存的任务状态"""
        return self.active_tasks.get(task_id)
    
    def get_all_active_tasks(self) -> Dict[str, MinerUTaskStatus]:
        """获取所有活跃任务"""
        return {
            task_id: status for task_id, status in self.active_tasks.items()
            if status.status not in ["completed", "failed"]
        }


# ==================== 更新的工厂函数 ====================

def create_mineru_remote_tools(config: Optional[MinerUConfig] = None) -> List[MinerURemoteTool]:
    """创建所有 MinerU 远程工具"""
    return [
        MinerUParseRemoteTool(config),
        MinerULanguagesRemoteTool(config),
        MinerUBatchRemoteTool(config),  # 新增批量处理工具
    ]


def create_mineru_batch_processor(config: Optional[MinerUConfig] = None) -> MinerUBatchProcessor:
    """创建 MinerU 批量处理器"""
    return MinerUBatchProcessor(config)


def create_mineru_progress_tracker(config: Optional[MinerUConfig] = None) -> MinerUProgressTracker:
    """创建 MinerU 进度跟踪器"""
    return MinerUProgressTracker(config)