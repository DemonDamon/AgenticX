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
            
            command_str = f'"{self.server_config.command}" {" ".join(self.server_config.args)}'
            
            logger.debug(f"Executing command: {command_str}")

            # 使用交互式进程通信，增加缓冲区限制以处理大响应
            process = await asyncio.create_subprocess_shell(
                command_str,
                env=env,
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
                        "capabilities": {"tools": {}},
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
                
                # 等待工具调用响应
                tool_response_line = await process.stdout.readline()
                logger.debug(f"Tool response: {tool_response_line.decode('utf-8', 'ignore').strip()}")
                
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

                if not tool_response_line:
                    raise ToolError("No tool response received from MCP server", self.name)
                
                try:
                    response_data = json.loads(tool_response_line)
                    return MCPToolResponse(**response_data)
                except json.JSONDecodeError as e:
                    raise ToolError(f"JSON decode failed. Raw response: '{tool_response_line.decode('utf-8', 'ignore').strip()}'.", self.name) from e
                    
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
            
        try:
            # 构建环境变量
            env = dict(os.environ)
            env.update(self.server_config.env)
            
            command_str = f'"{self.server_config.command}" {" ".join(self.server_config.args)}'
            
            logger.debug(f"Discovering tools from: {command_str}")

            # 使用交互式进程通信
            process = await asyncio.create_subprocess_shell(
                command_str,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=1024*1024*10
            )

            # 确保流不为 None
            if process.stdin is None or process.stdout is None or process.stderr is None:
                raise ToolError("Failed to create process streams", "MCPClient")

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
                
                init_data = json.dumps(initialize_request) + "\n"
                process.stdin.write(init_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待初始化响应
                init_response_line = await process.stdout.readline()
                init_response = json.loads(init_response_line)
                if init_response.get('error'):
                    raise ToolError(f"MCP initialization failed: {init_response['error']}", "MCPClient")
                
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
                
                tools_data = json.dumps(tools_request) + "\n"
                process.stdin.write(tools_data.encode('utf-8'))
                await process.stdin.drain()
                
                # 等待工具列表响应
                tools_response_line = await process.stdout.readline()
                tools_response = json.loads(tools_response_line)
                
                # 关闭输入流
                process.stdin.close()
                await process.wait()
                
                if tools_response.get('error'):
                    raise ToolError(f"Failed to get tools list: {tools_response['error']}", "MCPClient")
                
                # 解析工具信息
                tools_data = tools_response.get('result', {}).get('tools', [])
                tools = []
                for tool_data in tools_data:
                    tool_info = MCPToolInfo(
                        name=tool_data['name'],
                        description=tool_data.get('description', ''),
                        inputSchema=tool_data.get('inputSchema', {})
                    )
                    tools.append(tool_info)
                
                self._tools_cache = tools
                return tools
                
            finally:
                # 确保进程被清理
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        process.kill()
        
        except Exception as e:
            if isinstance(e, ToolError):
                raise
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