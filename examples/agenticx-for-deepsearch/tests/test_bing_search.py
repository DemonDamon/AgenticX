#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Bing Web Search Tool 测试
测试 Bing 搜索工具的各种功能和边界情况
"""

import pytest
import os
import sys
import json
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import urllib.error

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))
sys.path.append(str(Path(__file__).parent.parent))

from tools.bing_search import BingWebSearchTool, MockBingSearchTool
from tools import SearchInput, SearchResult


class TestBingSearchToolCreation:
    """Bing 搜索工具创建测试"""
    
    def test_bing_search_tool_with_key(self):
        """测试使用 API Key 创建 Bing 搜索工具"""
        tool = BingWebSearchTool(subscription_key="test_key")
        
        assert tool.name == "bing_web_search_tool"
        assert "Bing Web Search API" in tool.description
        assert tool.subscription_key == "test_key"
        assert tool.endpoint == "https://api.bing.microsoft.com/v7.0/search"
        assert tool.market == "zh-CN"
        assert tool.safe_search == "Moderate"
        assert tool.count == 10
    
    def test_bing_search_tool_custom_params(self):
        """测试使用自定义参数创建 Bing 搜索工具"""
        tool = BingWebSearchTool(
            subscription_key="test_key",
            endpoint="https://custom.endpoint.com/search",
            market="en-US",
            safe_search="Strict",
            count=5
        )
        
        assert tool.subscription_key == "test_key"
        assert tool.endpoint == "https://custom.endpoint.com/search"
        assert tool.market == "en-US"
        assert tool.safe_search == "Strict"
        assert tool.count == 5
    
    @patch.dict(os.environ, {"BING_SUBSCRIPTION_KEY": "env_key"})
    def test_bing_search_tool_from_env(self):
        """测试从环境变量创建 Bing 搜索工具"""
        tool = BingWebSearchTool()
        assert tool.subscription_key == "env_key"
    
    @patch.dict(os.environ, {"AZURE_SUBSCRIPTION_KEY": "azure_key"})
    def test_bing_search_tool_from_azure_env(self):
        """测试从 Azure 环境变量创建 Bing 搜索工具"""
        tool = BingWebSearchTool()
        assert tool.subscription_key == "azure_key"
    
    def test_bing_search_tool_no_key_error(self):
        """测试没有 API Key 时抛出错误"""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError) as exc_info:
                BingWebSearchTool()
            assert "Bing Subscription Key 未配置" in str(exc_info.value)


class TestMockBingSearchTool:
    """模拟 Bing 搜索工具测试"""
    
    def test_mock_tool_creation(self):
        """测试模拟工具创建"""
        tool = MockBingSearchTool()
        
        assert tool.name == "bing_web_search_tool"
        assert "模拟使用 Bing Web Search API" in tool.description
    
    def test_mock_search_results(self):
        """测试模拟搜索结果"""
        tool = MockBingSearchTool()
        results = tool._run("人工智能")
        
        assert isinstance(results, list)
        assert len(results) == 5  # 模拟工具返回5个结果
        
        for result in results:
            assert "title" in result
            assert "link" in result
            assert "snippet" in result
            assert "人工智能" in result["title"] or "人工智能" in result["snippet"]
    
    def test_mock_search_different_queries(self):
        """测试不同查询的模拟搜索"""
        tool = MockBingSearchTool()
        
        queries = ["机器学习", "深度学习", "自然语言处理"]
        
        for query in queries:
            results = tool._run(query)
            assert len(results) == 5
            # 检查结果中包含查询关键词
            found_query = any(
                query in result["title"] or query in result["snippet"]
                for result in results
            )
            assert found_query, f"查询 '{query}' 在结果中未找到"
    
    async def test_mock_async_search(self):
        """测试模拟异步搜索"""
        tool = MockBingSearchTool()
        results = await tool._arun("异步测试")
        
        assert isinstance(results, list)
        assert len(results) == 5


class TestBingSearchToolFunctionality:
    """Bing 搜索工具功能测试"""
    
    @patch('urllib.request.urlopen')
    def test_successful_search(self, mock_urlopen):
        """测试成功的搜索请求"""
        # 模拟 API 响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "webPages": {
                "value": [
                    {
                        "name": "测试标题1",
                        "url": "https://example1.com",
                        "snippet": "测试摘要1"
                    },
                    {
                        "name": "测试标题2",
                        "url": "https://example2.com",
                        "snippet": "测试摘要2"
                    }
                ]
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert len(results) == 2
        assert results[0]["title"] == "测试标题1"
        assert results[0]["link"] == "https://example1.com"
        assert results[0]["snippet"] == "测试摘要1"
        assert results[1]["title"] == "测试标题2"
        assert results[1]["link"] == "https://example2.com"
        assert results[1]["snippet"] == "测试摘要2"
    
    @patch('urllib.request.urlopen')
    def test_empty_search_results(self, mock_urlopen):
        """测试空搜索结果"""
        # 模拟空结果响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "webPages": {
                "value": []
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("无结果查询")
        
        assert len(results) == 0
    
    @patch('urllib.request.urlopen')
    def test_missing_fields_in_results(self, mock_urlopen):
        """测试结果中缺少字段的情况"""
        # 模拟缺少字段的响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "webPages": {
                "value": [
                    {
                        "url": "https://example.com"
                        # 缺少 name 和 snippet
                    }
                ]
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert len(results) == 1
        assert results[0]["title"] == "无标题"
        assert results[0]["link"] == "https://example.com"
        assert results[0]["snippet"] == "无摘要"
    
    @patch('urllib.request.urlopen')
    async def test_async_search(self, mock_urlopen):
        """测试异步搜索"""
        # 模拟 API 响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "webPages": {
                "value": [
                    {
                        "name": "异步测试标题",
                        "url": "https://async-example.com",
                        "snippet": "异步测试摘要"
                    }
                ]
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = await tool._arun("异步测试查询")
        
        assert len(results) == 1
        assert results[0]["title"] == "异步测试标题"


class TestBingSearchToolErrorHandling:
    """Bing 搜索工具错误处理测试"""
    
    @patch('urllib.request.urlopen')
    def test_http_401_error(self, mock_urlopen):
        """测试 401 认证错误"""
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="test", code=401, msg="Unauthorized", hdrs=None, fp=None
        )
        
        tool = BingWebSearchTool(subscription_key="invalid_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_http_429_error(self, mock_urlopen):
        """测试 429 请求过于频繁错误"""
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="test", code=429, msg="Too Many Requests", hdrs=None, fp=None
        )
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_http_403_error(self, mock_urlopen):
        """测试 403 访问被拒绝错误"""
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="test", code=403, msg="Forbidden", hdrs=None, fp=None
        )
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_network_error(self, mock_urlopen):
        """测试网络连接错误"""
        mock_urlopen.side_effect = urllib.error.URLError("Network unreachable")
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_json_decode_error(self, mock_urlopen):
        """测试 JSON 解析错误"""
        mock_response = MagicMock()
        mock_response.read.return_value = b"invalid json"
        mock_urlopen.return_value.__enter__.return_value = mock_response
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_general_exception(self, mock_urlopen):
        """测试一般异常"""
        mock_urlopen.side_effect = Exception("Unexpected error")
        
        tool = BingWebSearchTool(subscription_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []


class TestSearchModels:
    """搜索模型测试"""
    
    def test_search_input_model(self):
        """测试搜索输入模型"""
        search_input = SearchInput(query="测试查询")
        assert search_input.query == "测试查询"
    
    def test_search_result_model(self):
        """测试搜索结果模型"""
        search_result = SearchResult(
            title="测试标题",
            link="https://example.com",
            snippet="测试摘要"
        )
        assert search_result.title == "测试标题"
        assert search_result.link == "https://example.com"
        assert search_result.snippet == "测试摘要"


class TestBingSearchIntegration:
    """Bing 搜索集成测试"""
    
    def test_tool_args_schema(self):
        """测试工具参数模式"""
        tool = MockBingSearchTool()
        assert tool.args_schema.__name__ == "SearchInput"
        # 检查 Pydantic 模型的字段
        assert "query" in tool.args_schema.model_fields
    
    def test_tool_name_consistency(self):
        """测试工具名称一致性"""
        real_tool = BingWebSearchTool(subscription_key="test_key")
        mock_tool = MockBingSearchTool()
        
        assert real_tool.name == mock_tool.name
    
    def test_result_format_consistency(self):
        """测试结果格式一致性"""
        mock_tool = MockBingSearchTool()
        results = mock_tool._run("测试")
        
        # 检查所有结果都有必需的字段
        for result in results:
            assert isinstance(result, dict)
            assert "title" in result
            assert "link" in result
            assert "snippet" in result
            assert isinstance(result["title"], str)
            assert isinstance(result["link"], str)
            assert isinstance(result["snippet"], str)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])