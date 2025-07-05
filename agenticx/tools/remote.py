"""
RemoteTool: 用于连接 MCP (Model Context Protocol) 服务的通用远程工具
"""
import asyncio
import json
import logging
import os
import subprocess
from typing import Any, Dict, List, Optional, Type, Union

from pydantic import BaseModel, Field
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
                        process.kill()
        
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


# 移除了重复的 MinerU 相关代码，这些代码已经在 mineru.py 中定义 