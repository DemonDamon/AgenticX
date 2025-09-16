#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
HTTP API到MCP协议桥接适配器
将现有的HTTP API服务包装成MCP协议服务

使用场景：
- 下游服务商有现成的HTTP API，但不支持MCP协议
- 通过桥接器将HTTP API转换为MCP协议服务
- 支持多种HTTP API格式（REST、GraphQL等）
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass
from enum import Enum

import aiohttp
from fastmcp import FastMCP
from pydantic import BaseModel, Field

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("HTTP-MCP-Bridge")


class HTTPMethod(Enum):
    """HTTP请求方法"""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


@dataclass
class APIEndpoint:
    """API端点配置"""
    name: str                           # 工具名称
    description: str                    # 工具描述
    method: HTTPMethod                  # HTTP方法
    url: str                           # API URL
    headers: Dict[str, str]            # 请求头
    timeout: int = 30                  # 超时时间
    auth_type: Optional[str] = None    # 认证类型：bearer, api_key, basic
    auth_value: Optional[str] = None   # 认证值
    
    # 参数映射配置
    param_mapping: Dict[str, str] = None          # 参数名映射
    param_location: str = "json"                  # 参数位置：json, query, form, headers
    
    # 响应处理配置
    response_key: Optional[str] = None            # 响应数据的key
    error_key: Optional[str] = "error"           # 错误信息的key
    
    # 参数验证Schema
    parameters_schema: Optional[Dict[str, Any]] = None


class HTTPToMCPBridge:
    """HTTP API到MCP协议桥接器"""
    
    def __init__(self, service_name: str, host: str = "127.0.0.1", port: int = 8001):
        self.service_name = service_name
        self.host = host
        self.port = port
        self.mcp = FastMCP(name=service_name)
        self.endpoints = {}
        self.session = None
        
    async def _get_session(self) -> aiohttp.ClientSession:
        """获取HTTP会话"""
        if self.session is None:
            self.session = aiohttp.ClientSession()
        return self.session
    
    def register_api_endpoint(self, endpoint: APIEndpoint):
        """注册API端点"""
        logger.info(f"注册API端点: {endpoint.name}")
        
        # 创建MCP工具包装器
        @self.mcp.tool()
        async def api_wrapper(**kwargs):
            return await self._call_http_api(endpoint, kwargs)
        
        # 设置工具元数据
        api_wrapper.__name__ = endpoint.name
        api_wrapper.__doc__ = endpoint.description
        
        self.endpoints[endpoint.name] = endpoint
        return api_wrapper
    
    async def _call_http_api(self, endpoint: APIEndpoint, params: Dict[str, Any]) -> Dict[str, Any]:
        """调用HTTP API"""
        try:
            session = await self._get_session()
            
            # 处理参数映射
            mapped_params = self._map_parameters(endpoint, params)
            
            # 构建请求
            request_kwargs = {
                'method': endpoint.method.value,
                'url': endpoint.url,
                'headers': endpoint.headers.copy(),
                'timeout': aiohttp.ClientTimeout(total=endpoint.timeout)
            }
            
            # 添加认证
            self._add_authentication(request_kwargs, endpoint)
            
            # 添加参数
            self._add_parameters(request_kwargs, endpoint, mapped_params)
            
            logger.info(f"调用API: {endpoint.method.value} {endpoint.url}")
            logger.debug(f"请求参数: {mapped_params}")
            
            # 发送请求
            async with session.request(**request_kwargs) as response:
                response_data = await response.json()
                
                # 处理响应
                if response.status >= 400:
                    error_msg = response_data.get(endpoint.error_key, f"HTTP {response.status}")
                    raise Exception(f"API调用失败: {error_msg}")
                
                # 提取响应数据
                result = self._extract_response_data(endpoint, response_data)
                
                logger.info(f"API调用成功: {endpoint.name}")
                logger.debug(f"响应数据: {result}")
                
                return result
                
        except Exception as e:
            logger.error(f"API调用失败: {endpoint.name}, 错误: {e}")
            raise Exception(f"API调用失败: {e}")
    
    def _map_parameters(self, endpoint: APIEndpoint, params: Dict[str, Any]) -> Dict[str, Any]:
        """映射参数名称"""
        if not endpoint.param_mapping:
            return params
        
        mapped = {}
        for key, value in params.items():
            mapped_key = endpoint.param_mapping.get(key, key)
            mapped[mapped_key] = value
        
        return mapped
    
    def _add_authentication(self, request_kwargs: Dict[str, Any], endpoint: APIEndpoint):
        """添加认证信息"""
        if not endpoint.auth_type or not endpoint.auth_value:
            return
        
        if endpoint.auth_type == "bearer":
            request_kwargs['headers']['Authorization'] = f"Bearer {endpoint.auth_value}"
        elif endpoint.auth_type == "api_key":
            request_kwargs['headers']['X-API-Key'] = endpoint.auth_value
        elif endpoint.auth_type == "basic":
            # 需要base64编码
            import base64
            credentials = base64.b64encode(endpoint.auth_value.encode()).decode()
            request_kwargs['headers']['Authorization'] = f"Basic {credentials}"
    
    def _add_parameters(self, request_kwargs: Dict[str, Any], endpoint: APIEndpoint, params: Dict[str, Any]):
        """添加请求参数"""
        if not params:
            return
        
        if endpoint.param_location == "json":
            request_kwargs['json'] = params
        elif endpoint.param_location == "query":
            request_kwargs['params'] = params
        elif endpoint.param_location == "form":
            request_kwargs['data'] = params
        elif endpoint.param_location == "headers":
            request_kwargs['headers'].update(params)
    
    def _extract_response_data(self, endpoint: APIEndpoint, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """提取响应数据"""
        if endpoint.response_key:
            return response_data.get(endpoint.response_key, response_data)
        return response_data
    
    def start_server(self):
        """启动MCP服务器"""
        logger.info(f"启动HTTP-MCP桥接服务: {self.service_name}")
        logger.info(f"服务地址: http://{self.host}:{self.port}")
        logger.info(f"已注册API端点: {len(self.endpoints)}")
        
        try:
            self.mcp.run(transport='sse', host=self.host, port=self.port)
        finally:
            if self.session:
                asyncio.create_task(self.session.close())


# 配置文件解析器
class BridgeConfigParser:
    """桥接配置解析器"""
    
    @staticmethod
    def from_config_file(config_path: str) -> List[APIEndpoint]:
        """从配置文件加载API端点"""
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        endpoints = []
        for endpoint_config in config.get('endpoints', []):
            endpoint = APIEndpoint(
                name=endpoint_config['name'],
                description=endpoint_config.get('description', ''),
                method=HTTPMethod(endpoint_config['method']),
                url=endpoint_config['url'],
                headers=endpoint_config.get('headers', {}),
                timeout=endpoint_config.get('timeout', 30),
                auth_type=endpoint_config.get('auth_type'),
                auth_value=endpoint_config.get('auth_value'),
                param_mapping=endpoint_config.get('param_mapping', {}),
                param_location=endpoint_config.get('param_location', 'json'),
                response_key=endpoint_config.get('response_key'),
                error_key=endpoint_config.get('error_key', 'error'),
                parameters_schema=endpoint_config.get('parameters_schema')
            )
            endpoints.append(endpoint)
        
        return endpoints


# 快速配置工具
class QuickBridgeBuilder:
    """快速桥接构建器"""
    
    def __init__(self, service_name: str, base_url: str, port: int = 8001):
        self.bridge = HTTPToMCPBridge(service_name, port=port)
        self.base_url = base_url.rstrip('/')
        self.default_headers = {'Content-Type': 'application/json'}
        self.default_auth = None
    
    def set_default_auth(self, auth_type: str, auth_value: str):
        """设置默认认证"""
        self.default_auth = (auth_type, auth_value)
        return self
    
    def set_default_headers(self, headers: Dict[str, str]):
        """设置默认请求头"""
        self.default_headers.update(headers)
        return self
    
    def add_get_api(self, name: str, path: str, description: str = "", 
                   params_in_query: bool = True, **kwargs):
        """添加GET API"""
        endpoint = APIEndpoint(
            name=name,
            description=description,
            method=HTTPMethod.GET,
            url=f"{self.base_url}{path}",
            headers=self.default_headers,
            param_location="query" if params_in_query else "json",
            auth_type=self.default_auth[0] if self.default_auth else None,
            auth_value=self.default_auth[1] if self.default_auth else None,
            **kwargs
        )
        self.bridge.register_api_endpoint(endpoint)
        return self
    
    def add_post_api(self, name: str, path: str, description: str = "", **kwargs):
        """添加POST API"""
        endpoint = APIEndpoint(
            name=name,
            description=description,
            method=HTTPMethod.POST,
            url=f"{self.base_url}{path}",
            headers=self.default_headers,
            param_location="json",
            auth_type=self.default_auth[0] if self.default_auth else None,
            auth_value=self.default_auth[1] if self.default_auth else None,
            **kwargs
        )
        self.bridge.register_api_endpoint(endpoint)
        return self
    
    def add_put_api(self, name: str, path: str, description: str = "", **kwargs):
        """添加PUT API"""
        endpoint = APIEndpoint(
            name=name,
            description=description,
            method=HTTPMethod.PUT,
            url=f"{self.base_url}{path}",
            headers=self.default_headers,
            param_location="json",
            auth_type=self.default_auth[0] if self.default_auth else None,
            auth_value=self.default_auth[1] if self.default_auth else None,
            **kwargs
        )
        self.bridge.register_api_endpoint(endpoint)
        return self
    
    def add_delete_api(self, name: str, path: str, description: str = "", **kwargs):
        """添加DELETE API"""
        endpoint = APIEndpoint(
            name=name,
            description=description,
            method=HTTPMethod.DELETE,
            url=f"{self.base_url}{path}",
            headers=self.default_headers,
            param_location="query",
            auth_type=self.default_auth[0] if self.default_auth else None,
            auth_value=self.default_auth[1] if self.default_auth else None,
            **kwargs
        )
        self.bridge.register_api_endpoint(endpoint)
        return self
    
    def build(self) -> HTTPToMCPBridge:
        """构建桥接器"""
        return self.bridge


# 使用示例
if __name__ == "__main__":
    print("HTTP API到MCP协议桥接器示例")
    print("=" * 60)
    
    # 示例1：快速构建桥接器
    def example_quick_bridge():
        """快速构建示例 - 假设对接一个天气API服务"""
        builder = QuickBridgeBuilder(
            service_name="WeatherAPIBridge",
            base_url="https://api.weather.com/v1",
            port=8002
        )
        
        # 设置API Key认证
        builder.set_default_auth("api_key", "your-api-key-here")
        
        # 添加天气查询API
        builder.add_get_api(
            name="get_weather",
            path="/weather",
            description="获取城市天气信息",
            params_in_query=True,
            param_mapping={"city": "q", "units": "units"}
        )
        
        # 添加天气预报API
        builder.add_get_api(
            name="get_forecast",
            path="/forecast",
            description="获取天气预报",
            params_in_query=True,
            response_key="forecast"
        )
        
        bridge = builder.build()
        bridge.start_server()
    
    # 示例2：从配置文件构建
    def example_config_bridge():
        """从配置文件构建示例"""
        # 创建配置文件内容
        config = {
            "endpoints": [
                {
                    "name": "search_products",
                    "description": "搜索产品",
                    "method": "GET",
                    "url": "https://api.ecommerce.com/products/search",
                    "headers": {"Content-Type": "application/json"},
                    "auth_type": "bearer",
                    "auth_value": "your-token-here",
                    "param_location": "query",
                    "param_mapping": {"query": "q", "limit": "limit"},
                    "response_key": "products"
                },
                {
                    "name": "create_order",
                    "description": "创建订单",
                    "method": "POST",
                    "url": "https://api.ecommerce.com/orders",
                    "headers": {"Content-Type": "application/json"},
                    "auth_type": "bearer",
                    "auth_value": "your-token-here",
                    "param_location": "json",
                    "response_key": "order"
                }
            ]
        }
        
        # 保存配置文件
        with open("bridge_config.json", "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        # 从配置文件加载
        endpoints = BridgeConfigParser.from_config_file("bridge_config.json")
        
        bridge = HTTPToMCPBridge("EcommerceBridge", port=8003)
        for endpoint in endpoints:
            bridge.register_api_endpoint(endpoint)
        
        bridge.start_server()
    
    # 示例3：手动构建复杂桥接器
    def example_manual_bridge():
        """手动构建复杂桥接器"""
        bridge = HTTPToMCPBridge("ComplexAPIBridge", port=8004)
        
        # 用户管理API
        user_endpoint = APIEndpoint(
            name="get_user_info",
            description="获取用户信息",
            method=HTTPMethod.GET,
            url="https://api.example.com/users/{user_id}",
            headers={"Authorization": "Bearer your-token"},
            param_location="query",
            response_key="user",
            error_key="message"
        )
        bridge.register_api_endpoint(user_endpoint)
        
        # 数据分析API
        analytics_endpoint = APIEndpoint(
            name="get_analytics",
            description="获取数据分析报告",
            method=HTTPMethod.POST,
            url="https://api.example.com/analytics/report",
            headers={"Content-Type": "application/json"},
            auth_type="api_key",
            auth_value="your-api-key",
            param_location="json",
            param_mapping={"date_range": "dateRange", "metrics": "metrics"},
            response_key="data"
        )
        bridge.register_api_endpoint(analytics_endpoint)
        
        bridge.start_server()
    
    # 选择示例运行
    mode = input("选择运行模式:\n1. 快速构建 (天气API)\n2. 配置文件构建 (电商API)\n3. 手动构建 (复杂API)\n请输入 (1/2/3): ")
    
    if mode == "1":
        print("启动快速构建示例...")
        example_quick_bridge()
    elif mode == "2":
        print("启动配置文件构建示例...")
        example_config_bridge()
    elif mode == "3":
        print("启动手动构建示例...")
        example_manual_bridge()
    else:
        print("无效选择，使用默认快速构建...")
        example_quick_bridge() 