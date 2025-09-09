"""
内置工具集

提供开箱即用的基础工具，包括文件操作、网络搜索、代码执行等。
"""

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import requests
from pydantic import BaseModel, Field

from .base import BaseTool
from .credentials import get_credential
from .executor import SandboxEnvironment

logger = logging.getLogger(__name__)


# 参数模型定义
class FileReadArgs(BaseModel):
    """文件读取参数"""
    file_path: str = Field(description="要读取的文件路径")
    encoding: str = Field(default="utf-8", description="文件编码")


class FileWriteArgs(BaseModel):
    """文件写入参数"""
    file_path: str = Field(description="要写入的文件路径")
    content: str = Field(description="文件内容")
    encoding: str = Field(default="utf-8", description="文件编码")
    create_dirs: bool = Field(default=True, description="是否创建目录")


class WebSearchArgs(BaseModel):
    """网络搜索参数"""
    query: str = Field(description="搜索查询")
    num_results: int = Field(default=5, description="返回结果数量")
    language: str = Field(default="zh", description="搜索语言")


class CodeExecuteArgs(BaseModel):
    """代码执行参数"""
    code: str = Field(description="要执行的 Python 代码")
    timeout: int = Field(default=30, description="执行超时时间（秒）")
    allow_network: bool = Field(default=False, description="是否允许网络访问")


# 内置工具实现
class FileTool(BaseTool):
    """文件操作工具"""
    
    def __init__(
        self,
        allowed_paths: Optional[List[str]] = None,
        max_file_size: int = 10 * 1024 * 1024,  # 10MB
        **kwargs
    ):
        """
        初始化文件工具
        
        Args:
            allowed_paths: 允许访问的路径列表
            max_file_size: 最大文件大小（字节）
            **kwargs: 传递给 BaseTool 的其他参数
        """
        super().__init__(
            name="file_tool",
            description="读取和写入文件的工具",
            **kwargs
        )
        self.allowed_paths = allowed_paths or []
        self.max_file_size = max_file_size
    
    def _is_path_allowed(self, file_path: str) -> bool:
        """检查路径是否被允许"""
        if not self.allowed_paths:
            return True
        
        file_path = os.path.abspath(file_path)
        for allowed_path in self.allowed_paths:
            allowed_path = os.path.abspath(allowed_path)
            if file_path.startswith(allowed_path):
                return True
        
        return False
    
    def read_file(self, file_path: str, encoding: str = "utf-8") -> str:
        """
        读取文件内容
        
        Args:
            file_path: 文件路径
            encoding: 文件编码
            
        Returns:
            文件内容
        """
        if not self._is_path_allowed(file_path):
            raise ValueError(f"Access to path {file_path} is not allowed")
        
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file_path} not found")
        
        file_size = os.path.getsize(file_path)
        if file_size > self.max_file_size:
            raise ValueError(f"File size {file_size} exceeds maximum {self.max_file_size}")
        
        with open(file_path, "r", encoding=encoding) as f:
            return f.read()
    
    def write_file(
        self,
        file_path: str,
        content: str,
        encoding: str = "utf-8",
        create_dirs: bool = True
    ) -> str:
        """
        写入文件内容
        
        Args:
            file_path: 文件路径
            content: 文件内容
            encoding: 文件编码
            create_dirs: 是否创建目录
            
        Returns:
            成功消息
        """
        if not self._is_path_allowed(file_path):
            raise ValueError(f"Access to path {file_path} is not allowed")
        
        if len(content.encode(encoding)) > self.max_file_size:
            raise ValueError(f"Content size exceeds maximum {self.max_file_size}")
        
        path_obj = Path(file_path)
        
        if create_dirs:
            path_obj.parent.mkdir(parents=True, exist_ok=True)
        
        with open(path_obj, "w", encoding=encoding) as f:
            f.write(content)
        
        return f"Successfully wrote {len(content)} characters to {path_obj}"
    
    def _run(self, **kwargs) -> Any:
        """执行文件操作"""
        action = kwargs.get("action")
        
        if action == "read":
            args = FileReadArgs(**kwargs)
            return self.read_file(args.file_path, args.encoding)
        elif action == "write":
            args = FileWriteArgs(**kwargs)
            return self.write_file(
                args.file_path, args.content, args.encoding, args.create_dirs
            )
        else:
            raise ValueError(f"Unknown action: {action}")


class WebSearchTool(BaseTool):
    """网络搜索工具"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="web_search",
            description="在网络上搜索信息",
            args_schema=WebSearchArgs,
            **kwargs
        )
    
    def _search_with_duckduckgo(self, query: str, num_results: int = 5) -> List[Dict]:
        """使用 DuckDuckGo 搜索（免费API）"""
        try:
            # 这里使用一个简化的实现
            # 实际项目中可以集成 duckduckgo-search 库
            url = "https://api.duckduckgo.com/"
            params = {
                "q": query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1"
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            results = []
            
            # 处理搜索结果
            for item in data.get("RelatedTopics", [])[:num_results]:
                if "Text" in item and "FirstURL" in item:
                    results.append({
                        "title": item.get("Text", "")[:100],
                        "url": item.get("FirstURL", ""),
                        "snippet": item.get("Text", "")
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"DuckDuckGo search failed: {e}")
            return []
    
    def _search_with_custom_api(self, query: str, num_results: int = 5) -> List[Dict]:
        """使用自定义搜索 API"""
        # 尝试从凭据中获取搜索 API 配置
        credentials = get_credential(
            self.organization_id or "default",
            "web_search"
        )
        
        if not credentials:
            return []
        
        try:
            api_key = credentials.get("api_key")
            search_engine_id = credentials.get("search_engine_id")
            
            if not api_key or not search_engine_id:
                return []
            
            # Google Custom Search API
            url = "https://www.googleapis.com/customsearch/v1"
            params = {
                "key": api_key,
                "cx": search_engine_id,
                "q": query,
                "num": min(num_results, 10)
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            results = []
            
            for item in data.get("items", []):
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("link", ""),
                    "snippet": item.get("snippet", "")
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Custom search API failed: {e}")
            return []
    
    def _run(self, **kwargs) -> str:
        """执行网络搜索"""
        args = WebSearchArgs(**kwargs)
        
        # 首先尝试自定义 API
        results = self._search_with_custom_api(args.query, args.num_results)
        
        # 如果失败，使用 DuckDuckGo
        if not results:
            results = self._search_with_duckduckgo(args.query, args.num_results)
        
        if not results:
            return f"No search results found for query: {args.query}"
        
        # 格式化结果
        formatted_results = []
        for i, result in enumerate(results, 1):
            formatted_result = f"{i}. {result['title']}\n"
            formatted_result += f"   URL: {result['url']}\n"
            formatted_result += f"   摘要: {result['snippet']}\n"
            formatted_results.append(formatted_result)
        
        return "\n".join(formatted_results)


class CodeInterpreterTool(BaseTool):
    """代码解释器工具"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="code_interpreter",
            description="在安全的沙箱环境中执行 Python 代码",
            args_schema=CodeExecuteArgs,
            **kwargs
        )
        self.sandbox = SandboxEnvironment()
    
    def _run(self, **kwargs) -> str:
        """执行 Python 代码"""
        args = CodeExecuteArgs(**kwargs)
        
        try:
            # 在沙箱中执行代码
            result = self.sandbox.execute_code(args.code)
            
            if result is None:
                return "Code executed successfully (no return value)"
            else:
                return f"Code executed successfully. Result: {result}"
                
        except ValueError as e:
            # 安全检查失败
            return f"Security check failed: {e}"
        except Exception as e:
            # 代码执行错误
            return f"Code execution failed: {e}"


class HttpRequestTool(BaseTool):
    """HTTP 请求工具"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="http_request",
            description="发送 HTTP 请求",
            **kwargs
        )
    
    def _run(self, **kwargs) -> str:
        """发送 HTTP 请求"""
        url = kwargs.get("url")
        method = kwargs.get("method", "GET").upper()
        headers = kwargs.get("headers", {})
        data = kwargs.get("data")
        params = kwargs.get("params")
        timeout = kwargs.get("timeout", 10)
        
        if not url:
            raise ValueError("URL is required")
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=headers,
                data=data,
                params=params,
                timeout=timeout
            )
            
            result = {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "content": response.text[:1000],  # 限制内容长度
                "url": response.url
            }
            
            return json.dumps(result, indent=2, ensure_ascii=False)
            
        except Exception as e:
            return f"HTTP request failed: {e}"


class JsonTool(BaseTool):
    """JSON 处理工具"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="json_tool",
            description="处理 JSON 数据",
            **kwargs
        )
    
    def _run(self, **kwargs) -> str:
        """处理 JSON 数据"""
        action = kwargs.get("action")
        data = kwargs.get("data")
        
        # 检查 data 是否为 None
        if data is None:
            return "Error: No data provided for JSON processing"
        
        if action == "parse":
            try:
                parsed = json.loads(data)
                return json.dumps(parsed, indent=2, ensure_ascii=False)
            except json.JSONDecodeError as e:
                return f"JSON parsing failed: {e}"
        
        elif action == "format":
            try:
                parsed = json.loads(data)
                return json.dumps(parsed, indent=2, ensure_ascii=False)
            except json.JSONDecodeError as e:
                return f"JSON formatting failed: {e}"
        
        elif action == "validate":
            try:
                json.loads(data)
                return "Valid JSON"
            except json.JSONDecodeError as e:
                return f"Invalid JSON: {e}"
        
        else:
            return f"Unknown action: {action}"


# 便捷函数：获取所有内置工具
def get_builtin_tools(
    organization_id: Optional[str] = None,
    allowed_file_paths: Optional[List[str]] = None
) -> List[BaseTool]:
    """
    获取所有内置工具
    
    Args:
        organization_id: 组织 ID
        allowed_file_paths: 文件工具允许访问的路径
        
    Returns:
        内置工具列表
    """
    return [
        FileTool(
            allowed_paths=allowed_file_paths,
            organization_id=organization_id
        ),
        WebSearchTool(organization_id=organization_id),
        CodeInterpreterTool(organization_id=organization_id),
        HttpRequestTool(organization_id=organization_id),
        JsonTool(organization_id=organization_id),
    ] 