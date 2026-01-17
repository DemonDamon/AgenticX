"""
OpenAPIToolset: 从 OpenAPI 规范自动生成工具

借鉴 ADK 的 OpenAPIToolset 设计，支持从 OpenAPI/Swagger 规范文件
自动生成可调用的 REST API 工具。
"""

import logging
import re
from typing import Any, Dict, List, Optional, Type, Union
from pathlib import Path
from urllib.parse import urljoin

from pydantic import BaseModel, Field, create_model  # type: ignore

from .base import BaseTool, ToolError

logger = logging.getLogger(__name__)

# 延迟导入可选依赖
try:
    import httpx  # type: ignore
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

try:
    import yaml  # type: ignore
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False


class RestApiTool(BaseTool):
    """
    REST API 工具
    
    封装一个 REST API 端点为可调用的工具。
    """
    
    def __init__(
        self,
        name: str,
        description: str,
        method: str,
        url: str,
        path_params: Optional[List[str]] = None,
        query_params: Optional[List[Dict[str, Any]]] = None,
        body_schema: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        args_schema: Optional[Type[BaseModel]] = None
    ):
        """
        初始化 REST API 工具
        
        Args:
            name: 工具名称
            description: 工具描述
            method: HTTP 方法 (GET, POST, PUT, DELETE, PATCH)
            url: 完整 URL（可包含路径参数占位符如 {id}）
            path_params: 路径参数名称列表
            query_params: 查询参数定义列表
            body_schema: 请求体 JSON Schema
            headers: 默认请求头
            timeout: 请求超时时间
            args_schema: Pydantic 参数模型
        """
        super().__init__(
            name=name,
            description=description,
            args_schema=args_schema,
            timeout=timeout
        )
        
        self.method = method.upper()
        self.url = url
        self.path_params = path_params or []
        self.query_params = query_params or []
        self.body_schema = body_schema
        self.headers = headers or {}
    
    def _run(self, **kwargs) -> Any:
        """同步执行 API 调用"""
        if not HTTPX_AVAILABLE:
            raise ToolError(
                "httpx is required for RestApiTool. Install with: pip install httpx",
                tool_name=self.name
            )
        
        # 构建 URL
        url = self.url
        for param in self.path_params:
            if param in kwargs:
                url = url.replace(f"{{{param}}}", str(kwargs.pop(param)))
        
        # 构建查询参数
        query = {}
        for param_def in self.query_params:
            param_name = param_def.get("name")
            if param_name and param_name in kwargs:
                query[param_name] = kwargs.pop(param_name)
        
        # 构建请求体
        body = None
        if self.method in ["POST", "PUT", "PATCH"] and kwargs:
            body = kwargs
        
        # 发起请求
        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(
                method=self.method,
                url=url,
                params=query if query else None,
                json=body,
                headers=self.headers
            )
            
            # 检查响应
            if response.status_code >= 400:
                raise ToolError(
                    f"API request failed: {response.status_code} {response.text}",
                    tool_name=self.name,
                    details={
                        "status_code": response.status_code,
                        "response": response.text
                    }
                )
            
            # 尝试解析 JSON
            try:
                return response.json()
            except Exception:
                return response.text
    
    async def _arun(self, **kwargs) -> Any:
        """异步执行 API 调用"""
        if not HTTPX_AVAILABLE:
            raise ToolError(
                "httpx is required for RestApiTool. Install with: pip install httpx",
                tool_name=self.name
            )
        
        # 构建 URL
        url = self.url
        for param in self.path_params:
            if param in kwargs:
                url = url.replace(f"{{{param}}}", str(kwargs.pop(param)))
        
        # 构建查询参数
        query = {}
        for param_def in self.query_params:
            param_name = param_def.get("name")
            if param_name and param_name in kwargs:
                query[param_name] = kwargs.pop(param_name)
        
        # 构建请求体
        body = None
        if self.method in ["POST", "PUT", "PATCH"] and kwargs:
            body = kwargs
        
        # 发起请求
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.request(
                method=self.method,
                url=url,
                params=query if query else None,
                json=body,
                headers=self.headers
            )
            
            # 检查响应
            if response.status_code >= 400:
                raise ToolError(
                    f"API request failed: {response.status_code} {response.text}",
                    tool_name=self.name,
                    details={
                        "status_code": response.status_code,
                        "response": response.text
                    }
                )
            
            # 尝试解析 JSON
            try:
                return response.json()
            except Exception:
                return response.text


class OpenAPIToolset:
    """
    OpenAPI 工具集
    
    从 OpenAPI 3.x 或 Swagger 2.0 规范文件自动生成工具。
    
    使用示例:
        # 从文件加载
        toolset = OpenAPIToolset.from_file("openapi.yaml")
        tools = toolset.get_tools()
        
        # 从 URL 加载
        toolset = OpenAPIToolset.from_url("https://api.example.com/openapi.json")
        tools = toolset.get_tools()
        
        # 筛选特定操作
        tools = toolset.get_tools(operations=["getUser", "createUser"])
    """
    
    def __init__(
        self,
        spec: Dict[str, Any],
        base_url: Optional[str] = None,
        default_headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0
    ):
        """
        初始化 OpenAPI 工具集
        
        Args:
            spec: OpenAPI 规范字典
            base_url: 基础 URL（覆盖规范中的 servers）
            default_headers: 默认请求头
            timeout: 默认超时时间
        """
        self.spec = spec
        self.default_headers = default_headers or {}
        self.timeout = timeout
        
        # 确定基础 URL
        if base_url:
            self.base_url = base_url
        else:
            # 从规范中获取
            servers = spec.get("servers", [])
            if servers:
                self.base_url = servers[0].get("url", "")
            else:
                # Swagger 2.0 格式
                host = spec.get("host", "localhost")
                basePath = spec.get("basePath", "")
                schemes = spec.get("schemes", ["https"])
                self.base_url = f"{schemes[0]}://{host}{basePath}"
        
        # 缓存生成的工具
        self._tools: Optional[List[RestApiTool]] = None
    
    @classmethod
    def from_file(
        cls,
        path: Union[str, Path],
        **kwargs
    ) -> "OpenAPIToolset":
        """
        从文件加载 OpenAPI 规范
        
        Args:
            path: 文件路径（支持 .json, .yaml, .yml）
            **kwargs: 传递给构造函数的参数
            
        Returns:
            OpenAPIToolset 实例
        """
        path = Path(path)
        
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if path.suffix in ['.yaml', '.yml']:
            if not YAML_AVAILABLE:
                raise ImportError("PyYAML is required to parse YAML files. Install with: pip install pyyaml")
            spec = yaml.safe_load(content)
        else:
            import json
            spec = json.loads(content)
        
        return cls(spec, **kwargs)
    
    @classmethod
    def from_url(
        cls,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> "OpenAPIToolset":
        """
        从 URL 加载 OpenAPI 规范
        
        Args:
            url: 规范 URL
            headers: 请求头
            **kwargs: 传递给构造函数的参数
            
        Returns:
            OpenAPIToolset 实例
        """
        if not HTTPX_AVAILABLE:
            raise ImportError("httpx is required to fetch from URL. Install with: pip install httpx")
        
        response = httpx.get(url, headers=headers)
        response.raise_for_status()
        
        content_type = response.headers.get("content-type", "")
        
        if "yaml" in content_type or url.endswith(('.yaml', '.yml')):
            if not YAML_AVAILABLE:
                raise ImportError("PyYAML is required to parse YAML. Install with: pip install pyyaml")
            spec = yaml.safe_load(response.text)
        else:
            spec = response.json()
        
        return cls(spec, **kwargs)
    
    def get_tools(
        self,
        operations: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        methods: Optional[List[str]] = None
    ) -> List[RestApiTool]:
        """
        获取生成的工具列表
        
        Args:
            operations: 要包含的操作 ID 列表（None 表示全部）
            tags: 要包含的标签列表（None 表示全部）
            methods: 要包含的 HTTP 方法列表（None 表示全部）
            
        Returns:
            RestApiTool 列表
        """
        if self._tools is None:
            self._tools = self._generate_tools()
        
        tools = self._tools
        
        # 筛选
        if operations:
            tools = [t for t in tools if getattr(t, '_operation_id', None) in operations]
        
        if tags:
            tools = [t for t in tools if any(tag in getattr(t, '_tags', []) for tag in tags)]
        
        if methods:
            methods_upper = [m.upper() for m in methods]
            tools = [t for t in tools if t.method in methods_upper]
        
        return tools
    
    def _generate_tools(self) -> List[RestApiTool]:
        """生成所有工具"""
        tools = []
        paths = self.spec.get("paths", {})
        
        for path, path_item in paths.items():
            for method in ["get", "post", "put", "delete", "patch"]:
                if method not in path_item:
                    continue
                
                operation = path_item[method]
                tool = self._create_tool_from_operation(path, method, operation)
                if tool:
                    tools.append(tool)
        
        logger.info(f"Generated {len(tools)} tools from OpenAPI spec")
        return tools
    
    def _create_tool_from_operation(
        self,
        path: str,
        method: str,
        operation: Dict[str, Any]
    ) -> Optional[RestApiTool]:
        """
        从单个操作创建工具
        
        Args:
            path: API 路径
            method: HTTP 方法
            operation: 操作定义
            
        Returns:
            RestApiTool 或 None
        """
        # 操作 ID（用作工具名称）
        operation_id = operation.get("operationId")
        if not operation_id:
            # 自动生成操作 ID
            operation_id = f"{method}_{path.replace('/', '_').replace('{', '').replace('}', '')}"
            operation_id = re.sub(r'_+', '_', operation_id).strip('_')
        
        # 描述
        description = operation.get("summary") or operation.get("description") or f"{method.upper()} {path}"
        
        # 标签
        tags = operation.get("tags", [])
        
        # 解析参数
        path_params = []
        query_params = []
        body_schema = None
        
        for param in operation.get("parameters", []):
            param_in = param.get("in")
            param_name = param.get("name")
            
            if param_in == "path":
                path_params.append(param_name)
            elif param_in == "query":
                query_params.append({
                    "name": param_name,
                    "required": param.get("required", False),
                    "schema": param.get("schema", {})
                })
        
        # 请求体
        request_body = operation.get("requestBody", {})
        if request_body:
            content = request_body.get("content", {})
            if "application/json" in content:
                body_schema = content["application/json"].get("schema", {})
        
        # 构建完整 URL
        url = urljoin(self.base_url, path)
        
        # 生成 Pydantic 模型
        args_schema = self._create_args_schema(
            operation_id,
            path_params,
            query_params,
            body_schema
        )
        
        # 创建工具
        tool = RestApiTool(
            name=operation_id,
            description=description,
            method=method,
            url=url,
            path_params=path_params,
            query_params=query_params,
            body_schema=body_schema,
            headers=self.default_headers.copy(),
            timeout=self.timeout,
            args_schema=args_schema
        )
        
        # 保存元数据
        tool._operation_id = operation_id
        tool._tags = tags
        
        return tool
    
    def _create_args_schema(
        self,
        operation_id: str,
        path_params: List[str],
        query_params: List[Dict[str, Any]],
        body_schema: Optional[Dict[str, Any]]
    ) -> Optional[Type[BaseModel]]:
        """
        创建参数 Pydantic 模型
        
        Args:
            operation_id: 操作 ID
            path_params: 路径参数
            query_params: 查询参数
            body_schema: 请求体 schema
            
        Returns:
            Pydantic 模型类或 None
        """
        fields = {}
        
        # 路径参数（必需）
        for param in path_params:
            fields[param] = (str, Field(..., description=f"Path parameter: {param}"))
        
        # 查询参数
        for param in query_params:
            name = param.get("name")
            required = param.get("required", False)
            schema = param.get("schema", {})
            
            # 确定类型
            param_type = self._schema_to_python_type(schema)
            
            if required:
                fields[name] = (param_type, Field(..., description=f"Query parameter: {name}"))
            else:
                fields[name] = (Optional[param_type], Field(None, description=f"Query parameter: {name}"))
        
        # 请求体参数
        if body_schema:
            properties = body_schema.get("properties", {})
            required_props = body_schema.get("required", [])
            
            for prop_name, prop_schema in properties.items():
                prop_type = self._schema_to_python_type(prop_schema)
                prop_desc = prop_schema.get("description", f"Body property: {prop_name}")
                
                if prop_name in required_props:
                    fields[prop_name] = (prop_type, Field(..., description=prop_desc))
                else:
                    fields[prop_name] = (Optional[prop_type], Field(None, description=prop_desc))
        
        if not fields:
            return None
        
        # 动态创建模型
        model_name = f"{operation_id.title().replace('_', '')}Args"
        return create_model(model_name, **fields)
    
    def _schema_to_python_type(self, schema: Dict[str, Any]) -> type:
        """
        将 JSON Schema 类型转换为 Python 类型
        
        Args:
            schema: JSON Schema
            
        Returns:
            Python 类型
        """
        schema_type = schema.get("type", "string")
        
        type_mapping = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "array": list,
            "object": dict
        }
        
        return type_mapping.get(schema_type, str)
    
    def get_operation_ids(self) -> List[str]:
        """获取所有操作 ID"""
        if self._tools is None:
            self._tools = self._generate_tools()
        
        return [getattr(t, '_operation_id', t.name) for t in self._tools]
    
    def get_tags(self) -> List[str]:
        """获取所有标签"""
        tags = set()
        
        for path_item in self.spec.get("paths", {}).values():
            for method in ["get", "post", "put", "delete", "patch"]:
                if method in path_item:
                    tags.update(path_item[method].get("tags", []))
        
        return sorted(tags)

