"""
MCP Client V2: 基于官方 SDK 的持久化会话实现

本模块将官方 MCP Python SDK 参考进 AgenticX，实现：
1. 持久化会话（消除每次调用重启进程的开销）
2. 完整的协议支持（Tools, Resources, Sampling）
3. 智能体自动挖掘能力（通过 Sampling 实现工具内推理）

上游来源：
- mcp/client/session.py: ClientSession 实现
- mcp/client/stdio/__init__.py: stdio_client transport
- mcp/types.py: 协议类型定义

License: 遵循上游 MIT License
"""
from __future__ import annotations

import logging
import os
from contextlib import AsyncExitStack
from typing import Any, Dict, List, Optional, Type, Union

import anyio  # type: ignore
from pydantic import BaseModel, Field  # type: ignore

import mcp.types as mcp_types  # type: ignore
from mcp.client.session import ClientSession  # type: ignore
from mcp.client.stdio import StdioServerParameters, stdio_client  # type: ignore

from .base import BaseTool, ToolError

# 类型导入（用于 Sampling）
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from ..llms.base import BaseLLMProvider

logger = logging.getLogger(__name__)


class MCPServerConfig(BaseModel):
    """MCP 服务器配置（与旧版兼容）"""
    name: str
    command: str
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)
    timeout: float = 60.0
    cwd: Optional[str] = Field(default=None, description="工作目录")
    enabled_tools: List[str] = Field(
        default_factory=list,
        description="启用的工具名称列表（空列表表示全部启用）"
    )
    assign_to_agents: List[str] = Field(
        default_factory=list,
        description="分配给哪些智能体（空列表表示全部智能体可用）"
    )


class MCPToolInfo(BaseModel):
    """MCP 工具信息"""
    name: str
    description: str
    inputSchema: Dict[str, Any]
    outputSchema: Optional[Dict[str, Any]] = None


class MCPClientV2:
    """
    MCP 客户端 V2：基于官方 SDK 的持久化会话实现
    
    核心改进：
    - 持久化会话：进程长驻，多次调用复用同一连接
    - 完整协议支持：Tools, Resources, Sampling
    - 自动重连：异常断开后自动恢复
    """
    
    def __init__(
        self,
        server_config: Union[MCPServerConfig, Dict[str, Any]],
        llm_provider: Optional["BaseLLMProvider"] = None,
    ):
        """
        初始化 MCP 客户端
        
        Args:
            server_config: 服务器配置
            llm_provider: LLM 提供者（用于 Sampling 机制，允许 Server 反向调用 LLM）
        """
        if isinstance(server_config, dict):
            server_config = MCPServerConfig(**server_config)
        self.server_config = server_config
        self.llm_provider = llm_provider
        
        # 会话状态
        self._session: Optional[ClientSession] = None
        self._exit_stack: Optional[AsyncExitStack] = None
        self._session_lock = anyio.Lock()
        self._tools_cache: Optional[List[MCPToolInfo]] = None
        self._initialized = False
        self._closed = False
    
    async def _ensure_session(self) -> ClientSession:
        """确保会话已初始化（线程安全）"""
        async with self._session_lock:
            if self._session is None or not self._initialized:
                await self._create_session()
            
            if self._session is None:
                raise RuntimeError("Failed to create session")
            
            return self._session
    
    async def __aenter__(self):
        """异步上下文管理器入口（用于保持会话打开）"""
        # 在进入时创建会话（exit_stack 会在整个上下文期间保持打开）
        await self._ensure_session()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器退出（清理资源）"""
        await self.close()
    
    async def _create_session(self) -> None:
        """
        创建新的 MCP 会话（持久化）
        
        使用 AsyncExitStack 来管理 transport 和 session 的生命周期。
        参考官方示例：simple-chatbot/main.py
        """
        if self._closed:
            raise RuntimeError("Client has been closed")
        
        logger.info(f"Creating persistent MCP session for server: {self.server_config.name}")
        
        # 构建环境变量
        env = dict(os.environ)
        env.update(self.server_config.env)
        
        # 创建 stdio transport 参数
        server_params = StdioServerParameters(
            command=self.server_config.command,
            args=self.server_config.args,
            env=env,
            cwd=self.server_config.cwd,
        )
        
        # 创建 exit stack（如果还没有）
        if self._exit_stack is None:
            self._exit_stack = AsyncExitStack()
            await self._exit_stack.__aenter__()
        
        try:
            # 进入 stdio_client context（保持 transport 打开）
            stdio_transport = await self._exit_stack.enter_async_context(stdio_client(server_params))
            read_stream, write_stream = stdio_transport
            
            # 进入 ClientSession context（保持 session 打开）
            session = await self._exit_stack.enter_async_context(
                ClientSession(
                    read_stream=read_stream,
                    write_stream=write_stream,
                    client_info=mcp_types.Implementation(
                        name="AgenticX",
                        version="1.0.0"
                    ),
                    # P1: Sampling 机制桥接
                    sampling_callback=self._handle_sampling if self.llm_provider else None,
                )
            )
            
            # 初始化会话
            init_result = await session.initialize()
            logger.info(
                f"MCP session initialized: protocol={init_result.protocolVersion}, "
                f"server={init_result.serverInfo.name}"
            )
            
            # 保存会话引用（exit_stack 会保持所有 context 打开）
            self._session = session
            self._initialized = True
            
        except Exception as e:
            # 清理资源
            if self._exit_stack is not None:
                try:
                    await self._exit_stack.aclose()
                except Exception:
                    pass
                self._exit_stack = None
            raise
    
    async def discover_tools(self) -> List[MCPToolInfo]:
        """自动发现 MCP 服务器提供的所有工具"""
        if self._tools_cache is not None:
            return self._tools_cache
        
        session = await self._ensure_session()
        
        # 请求工具列表
        result = await session.list_tools()
        
        tools = []
        for tool in result.tools:
            tool_info = MCPToolInfo(
                name=tool.name,
                description=tool.description or "",
                inputSchema=tool.inputSchema,
                outputSchema=tool.outputSchema,
            )
            tools.append(tool_info)
            logger.debug(f"Discovered tool: {tool_info.name}")
        
        logger.info(f"Discovered {len(tools)} tools from server '{self.server_config.name}'")
        self._tools_cache = tools
        return tools
    
    async def call_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> mcp_types.CallToolResult:
        """
        调用工具（使用持久化会话）
        
        Args:
            name: 工具名称
            arguments: 工具参数
            
        Returns:
            CallToolResult: 工具执行结果
        """
        session = await self._ensure_session()
        
        try:
            result = await session.call_tool(
                name=name,
                arguments=arguments or {},
            )
            return result
        except Exception as e:
            logger.error(f"Tool call failed: {name}, error: {e}")
            # 会话可能已断开，清除状态以便重连
            self._session = None
            self._initialized = False
            raise ToolError(f"Tool call failed: {e}", name) from e
    
    def _create_pydantic_model_from_schema(
        self,
        schema: Dict[str, Any],
        model_name: str
    ) -> Type[BaseModel]:
        """从 JSON Schema 创建 Pydantic 模型（复用旧版逻辑）"""
        from pydantic import create_model  # type: ignore
        
        if not schema or schema.get('type') != 'object':
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
    
    async def create_tool(
        self,
        tool_name: str,
        organization_id: Optional[str] = None
    ) -> "RemoteToolV2":
        """为指定的工具名称创建 RemoteToolV2 实例"""
        tools = await self.discover_tools()
        
        # 查找指定的工具
        tool_info = None
        for tool in tools:
            if tool.name == tool_name:
                tool_info = tool
                break
        
        if tool_info is None:
            available_tools = [tool.name for tool in tools]
            raise ToolError(
                f"Tool '{tool_name}' not found. Available tools: {available_tools}",
                tool_name
            )
        
        # 从 inputSchema 创建 Pydantic 模型
        args_schema = self._create_pydantic_model_from_schema(
            tool_info.inputSchema,
            f"{tool_name.title().replace('_', '')}Args"
        )
        
        return RemoteToolV2(
            client=self,
            tool_name=tool_name,
            tool_info=tool_info,
            args_schema=args_schema,
            organization_id=organization_id,
        )
    
    async def create_all_tools(
        self,
        organization_id: Optional[str] = None
    ) -> List["RemoteToolV2"]:
        """创建服务器提供的所有工具"""
        tools = await self.discover_tools()
        remote_tools = []
        
        for tool_info in tools:
            args_schema = self._create_pydantic_model_from_schema(
                tool_info.inputSchema,
                f"{tool_info.name.title().replace('_', '')}Args"
            )
            
            remote_tool = RemoteToolV2(
                client=self,
                tool_name=tool_info.name,
                tool_info=tool_info,
                args_schema=args_schema,
                organization_id=organization_id,
            )
            remote_tools.append(remote_tool)
        
        return remote_tools
    
    async def _handle_sampling(
        self,
        context: Any,  # RequestContext[ClientSession, Any]
        params: mcp_types.CreateMessageRequestParams,
    ) -> mcp_types.CreateMessageResult | mcp_types.CreateMessageResultWithTools | mcp_types.ErrorData:
        """
        Sampling 回调：将 MCP Server 的采样请求桥接到 AgenticX 的 LLMProvider
        
        这是实现"智能体自动挖掘"的关键机制：允许外部工具在执行中反向请求 LLM 能力。
        
        Args:
            context: MCP 请求上下文
            params: 采样请求参数（包含消息、工具定义等）
            
        Returns:
            CreateMessageResult: LLM 生成的结果
        """
        if self.llm_provider is None:
            return mcp_types.ErrorData(
                code=mcp_types.INVALID_REQUEST,
                message="Sampling not supported: no LLM provider configured",
            )
        
        try:
            logger.info(f"Handling sampling request from MCP server: {len(params.messages)} messages")
            
            # 转换 MCP 消息格式为 AgenticX LLMProvider 格式
            # MCP 使用 SamplingMessage，需要转换为标准的 chat messages
            messages = []
            for msg in params.messages:
                role = msg.role  # "user" or "assistant"
                # 处理 content（可能是单个 block 或列表）
                if isinstance(msg.content, list):
                    content_blocks = msg.content
                else:
                    content_blocks = [msg.content]
                
                # 提取文本内容（简化处理，实际可能需要处理工具调用等）
                text_parts = []
                for block in content_blocks:
                    if isinstance(block, mcp_types.TextContent):
                        text_parts.append(block.text)
                    elif isinstance(block, mcp_types.ImageContent):
                        # 图像内容：转换为描述或 base64
                        text_parts.append(f"[Image: {block.mimeType}]")
                    elif isinstance(block, mcp_types.AudioContent):
                        text_parts.append(f"[Audio: {block.mimeType}]")
                    # ToolUseContent 和 ToolResultContent 需要特殊处理
                
                content = "\n".join(text_parts) if text_parts else ""
                if content:
                    messages.append({"role": role, "content": content})
            
            # 调用 LLMProvider
            # 注意：这里需要根据 params 中的参数（temperature, maxTokens 等）调整调用
            llm_kwargs = {}
            if params.temperature is not None:
                llm_kwargs["temperature"] = params.temperature
            if params.maxTokens:
                llm_kwargs["max_tokens"] = params.maxTokens
            if params.stopSequences:
                llm_kwargs["stop"] = params.stopSequences
            
            # 调用 LLM
            response = await self.llm_provider.ainvoke(messages, **llm_kwargs)
            
            # 转换 AgenticX LLMResponse 为 MCP CreateMessageResult
            # 提取模型名称（如果可用）
            model_name = getattr(response, "model_name", None) or self.llm_provider.model
            
            # 提取文本内容（LLMChoice 有 content 字段）
            if response.choices and len(response.choices) > 0:
                content_text = response.choices[0].content
            else:
                content_text = ""
            
            # 检查是否有工具调用（如果 params.tools 存在且 LLM 返回了工具调用）
            # 这里简化处理，实际需要解析 LLM 响应中的工具调用
            
            # 返回结果
            return mcp_types.CreateMessageResult(
                role="assistant",
                content=mcp_types.TextContent(
                    type="text",
                    text=content_text
                ),
                model=model_name,
                stopReason="endTurn",  # 简化处理
            )
            
        except Exception as e:
            logger.exception(f"Error in sampling callback: {e}")
            return mcp_types.ErrorData(
                code=mcp_types.INTERNAL_ERROR,
                message=f"Sampling failed: {str(e)}",
            )
    
    async def close(self) -> None:
        """关闭会话（清理资源）"""
        async with self._session_lock:
            if self._closed:
                return
            
            self._closed = True
            
            # 关闭 exit stack（会自动关闭所有 context）
            if self._exit_stack is not None:
                try:
                    await self._exit_stack.aclose()
                except Exception as e:
                    logger.warning(f"Error closing exit stack: {e}")
            
            self._session = None
            self._exit_stack = None
            self._initialized = False
            self._tools_cache = None
            logger.info(f"Closed MCP session for server: {self.server_config.name}")


class RemoteToolV2(BaseTool):
    """
    远程工具 V2：基于持久化会话的 MCP 工具实现
    
    相比旧版 RemoteTool 的改进：
    - 使用持久化会话，消除每次调用重启进程的开销
    - 支持完整的 MCP 协议特性
    """
    
    def __init__(
        self,
        client: MCPClientV2,
        tool_name: str,
        tool_info: MCPToolInfo,
        args_schema: Optional[Type[BaseModel]] = None,
        organization_id: Optional[str] = None,
    ):
        """
        初始化远程工具
        
        Args:
            client: MCP 客户端实例
            tool_name: 工具名称
            tool_info: 工具信息
            args_schema: 参数模式
            organization_id: 组织 ID
        """
        super().__init__(
            name=f"{client.server_config.name}_{tool_name}",
            description=tool_info.description or f"Remote tool {tool_name}",
            args_schema=args_schema,
            timeout=client.server_config.timeout,
            organization_id=organization_id,
        )
        self.client = client
        self.tool_name = tool_name
        self.tool_info = tool_info
    
    def _run(self, **kwargs) -> Any:
        """同步执行工具（使用 asyncio.run）"""
        import asyncio
        return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs) -> Any:
        """异步执行工具（使用持久化会话）"""
        # 调用客户端的方法
        result = await self.client.call_tool(
            name=self.tool_name,
            arguments=kwargs,
        )
        
        if result.isError:
            error_msg = "Unknown error"
            if result.content:
                # 尝试从 content 中提取错误信息
                for block in result.content:
                    if hasattr(block, 'text'):
                        error_msg = block.text
                        break
            raise ToolError(
                f"Remote tool execution failed: {error_msg}",
                self.name,
                {"tool": self.tool_name, "result": result.model_dump()}
            )
        
        # 提取结果内容
        if result.content:
            # 返回第一个文本块的内容
            for block in result.content:
                if hasattr(block, 'text'):
                    return block.text
                elif hasattr(block, 'blob'):
                    return block.blob
        
        # 如果有结构化内容，返回它
        if result.structuredContent:
            return result.structuredContent
        
        return None
    
    def to_openai_schema(self) -> Dict[str, Any]:
        """转换为 OpenAI 工具格式"""
        schema = {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description
            }
        }
        if self.args_schema:
            json_schema = self.args_schema.model_json_schema()
            schema["function"]["parameters"] = {
                "type": "object",
                "properties": json_schema.get("properties", {}),
                "required": json_schema.get("required", [])
            }
        else:
            schema["function"]["parameters"] = {"type": "object", "properties": {}, "required": []}
        return schema

