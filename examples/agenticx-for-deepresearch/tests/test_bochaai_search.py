#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
博查AI Web Search Tool 测试脚本
测试博查AI搜索工具的各项功能
支持pytest运行和直接运行两种模式
"""

import os
import sys
import pytest
import json
import asyncio
from unittest.mock import patch, MagicMock
from typing import List, Dict, Any

# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# 简化的BaseTool类定义（用于直接运行模式）
class BaseTool:
    def __init__(self, name: str, description: str, args_schema=None):
        self.name = name
        self.description = description
        self.args_schema = args_schema
    
    def _run(self, *args, **kwargs):
        raise NotImplementedError
    
    async def _arun(self, *args, **kwargs):
        return self._run(*args, **kwargs)

# 临时替换agenticx.tools.base模块（用于直接运行模式）
if 'agenticx' not in sys.modules:
    sys.modules['agenticx'] = type('MockModule', (), {})()
    sys.modules['agenticx.tools'] = type('MockModule', (), {})()
    sys.modules['agenticx.tools.base'] = type('MockModule', (), {'BaseTool': BaseTool})()

# 直接导入要测试的模块，避免通过__init__.py
sys.path.insert(0, os.path.join(project_root, 'tools'))
from bochaai_search import (
    BochaaIWebSearchTool,
    MockBochaaISearchTool,
    SearchInput,
    WebPageValue,
    WebSearchWebPages,
    WebSearchQueryContext,
    SearchResponse,
    SearchResult,
    convert_to_simple_results
)


class TestBochaaISearchToolCreation:
    """测试博查AI搜索工具的创建"""
    
    def test_tool_creation_with_api_key(self):
        """测试使用API密钥创建工具"""
        tool = BochaaIWebSearchTool(api_key="test_api_key")
        assert tool.name == "bochaai_web_search_tool"
        assert tool.api_key == "test_api_key"
        assert tool.endpoint == "https://api.bochaai.com/v1/web-search"
        assert "博查AI Web Search API" in tool.description
    
    def test_tool_creation_with_custom_endpoint(self):
        """测试使用自定义端点创建工具"""
        custom_endpoint = "https://custom.api.com/search"
        tool = BochaaIWebSearchTool(api_key="test_key", endpoint=custom_endpoint)
        assert tool.endpoint == custom_endpoint
    
    @patch.dict(os.environ, {'BOCHAAI_API_KEY': 'env_api_key'})
    def test_tool_creation_from_env(self):
        """测试从环境变量创建工具"""
        tool = BochaaIWebSearchTool()
        assert tool.api_key == "env_api_key"
    
    def test_tool_creation_without_api_key(self):
        """测试没有API密钥时创建工具应该失败"""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="博查AI API Key未配置"):
                BochaaIWebSearchTool()


class TestMockBochaaISearchTool:
    """测试模拟博查AI搜索工具"""
    
    def test_mock_tool_creation(self):
        """测试模拟工具创建"""
        tool = MockBochaaISearchTool()
        assert tool.name == "bochaai_web_search_tool"
        assert "模拟使用博查AI Web Search API" in tool.description
    
    def test_mock_tool_search(self):
        """测试模拟工具搜索功能"""
        tool = MockBochaaISearchTool()
        results = tool._run("Python编程")
        
        assert isinstance(results, list)
        assert len(results) > 0
        assert len(results) <= 5  # 模拟工具最多返回5个结果
        
        # 检查结果格式
        for result in results:
            assert "id" in result
            assert "title" in result
            assert "url" in result
            assert "snippet" in result
            assert "Python编程" in result["title"]
    
    def test_mock_tool_search_with_summary(self):
        """测试模拟工具带摘要的搜索"""
        tool = MockBochaaISearchTool()
        results = tool._run("人工智能", summary=True)
        
        assert len(results) > 0
        for result in results:
            assert "summary" in result
            assert "人工智能" in result["summary"]
    
    def test_mock_tool_search_with_count(self):
        """测试模拟工具指定结果数量"""
        tool = MockBochaaISearchTool()
        results = tool._run("机器学习", count=3)
        
        assert len(results) == 3


class TestBochaaISearchToolFunctionality:
    """测试博查AI搜索工具功能"""
    
    @patch('urllib.request.urlopen')
    def test_successful_search(self, mock_urlopen):
        """测试成功的搜索请求"""
        # 模拟API响应
        mock_response_data = {
            "code": 200,
            "data": {
                "_type": "SearchResponse",
                "queryContext": {
                    "originalQuery": "Python编程"
                },
                "webPages": {
                    "totalEstimatedMatches": 1000,
                    "value": [
                        {
                            "id": "1",
                            "name": "Python编程入门教程",
                            "url": "https://example.com/python-tutorial",
                            "displayUrl": "example.com/python-tutorial",
                            "snippet": "Python是一种高级编程语言...",
                            "siteName": "编程教程网",
                            "datePublished": "2024-12-20T10:30:00+08:00",
                            "language": "zh-CN",
                            "isFamilyFriendly": True
                        }
                    ]
                }
            }
        }
        
        # 设置模拟响应
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(mock_response_data).encode('utf-8')
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        # 执行搜索
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("Python编程")
        
        # 验证结果
        assert len(results) == 1
        result = results[0]
        assert result["title"] == "Python编程入门教程"
        assert result["url"] == "https://example.com/python-tutorial"
        assert result["snippet"] == "Python是一种高级编程语言..."
    
    @patch('urllib.request.urlopen')
    def test_search_with_summary(self, mock_urlopen):
        """测试带摘要的搜索"""
        mock_response_data = {
            "code": 200,
            "data": {
                "_type": "SearchResponse",
                "queryContext": {"originalQuery": "AI技术"},
                "webPages": {
                    "value": [
                        {
                            "id": "1",
                            "name": "AI技术发展",
                            "url": "https://example.com/ai",
                            "displayUrl": "example.com/ai",
                            "snippet": "人工智能技术...",
                            "summary": "这是关于AI技术的详细摘要"
                        }
                    ]
                }
            }
        }
        
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(mock_response_data).encode('utf-8')
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("AI技术", summary=True)
        
        assert len(results) == 1
        assert "summary" in results[0]
        assert results[0]["summary"] == "这是关于AI技术的详细摘要"
    
    @patch('urllib.request.urlopen')
    def test_search_with_parameters(self, mock_urlopen):
        """测试带参数的搜索"""
        mock_response_data = {
            "code": 200,
            "data": {
                "_type": "SearchResponse",
                "queryContext": {"originalQuery": "数据科学"},
                "webPages": {"value": []}
            }
        }
        
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(mock_response_data).encode('utf-8')
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run(
            "数据科学",
            freshness="oneWeek",
            summary=True,
            include="github.com|stackoverflow.com",
            exclude="spam.com",
            count=20
        )
        
        # 验证请求参数
        mock_urlopen.assert_called_once()
        call_args = mock_urlopen.call_args[0][0]
        assert call_args.data is not None
        
        # 解析请求数据
        request_data = json.loads(call_args.data.decode('utf-8'))
        assert request_data["query"] == "数据科学"
        assert request_data["freshness"] == "oneWeek"
        assert request_data["summary"] is True
        assert request_data["include"] == "github.com|stackoverflow.com"
        assert request_data["exclude"] == "spam.com"
        assert request_data["count"] == 20


class TestBochaaISearchToolErrorHandling:
    """测试博查AI搜索工具错误处理"""
    
    @patch('urllib.request.urlopen')
    def test_http_error_401(self, mock_urlopen):
        """测试401认证错误"""
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="test", code=401, msg="Unauthorized", hdrs=None, fp=None
        )
        
        tool = BochaaIWebSearchTool(api_key="invalid_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_http_error_429(self, mock_urlopen):
        """测试429频率限制错误"""
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="test", code=429, msg="Too Many Requests", hdrs=None, fp=None
        )
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_network_error(self, mock_urlopen):
        """测试网络连接错误"""
        from urllib.error import URLError
        mock_urlopen.side_effect = URLError("Network unreachable")
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_json_decode_error(self, mock_urlopen):
        """测试JSON解析错误"""
        mock_response = MagicMock()
        mock_response.read.return_value = b"invalid json"
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []
    
    @patch('urllib.request.urlopen')
    def test_empty_response(self, mock_urlopen):
        """测试空响应"""
        mock_response_data = {
            "code": 200,
            "data": {
                "_type": "SearchResponse",
                "queryContext": {"originalQuery": "测试"},
                "webPages": None
            }
        }
        
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(mock_response_data).encode('utf-8')
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        tool = BochaaIWebSearchTool(api_key="test_key")
        results = tool._run("测试查询")
        
        assert results == []


class TestSearchModels:
    """测试搜索相关的数据模型"""
    
    def test_search_input_model(self):
        """测试搜索输入模型"""
        search_input = SearchInput(
            query="Python编程",
            freshness="oneWeek",
            summary=True,
            count=15
        )
        
        assert search_input.query == "Python编程"
        assert search_input.freshness == "oneWeek"
        assert search_input.summary is True
        assert search_input.count == 15
        assert search_input.include is None
        assert search_input.exclude is None
    
    def test_web_page_value_model(self):
        """测试网页值模型"""
        page = WebPageValue(
            id="1",
            name="测试标题",
            url="https://example.com",
            displayUrl="example.com",
            snippet="测试摘要"
        )
        
        assert page.id == "1"
        assert page.name == "测试标题"
        assert page.url == "https://example.com"
        assert page.snippet == "测试摘要"
    
    def test_search_result_model(self):
        """测试简化搜索结果模型"""
        result = SearchResult(
            title="测试标题",
            url="https://example.com",
            link="https://example.com",
            snippet="测试摘要"
        )
        
        assert result.title == "测试标题"
        assert result.url == "https://example.com"
        assert result.link == "https://example.com"
        assert result.snippet == "测试摘要"
    
    def test_convert_to_simple_results(self):
        """测试结果转换函数"""
        complex_results = [
            {
                "title": "标题1",
                "url": "https://example1.com",
                "snippet": "摘要1",
                "extra_field": "额外数据"
            },
            {
                "title": "标题2",
                "url": "https://example2.com",
                "snippet": "摘要2"
            }
        ]
        
        simple_results = convert_to_simple_results(complex_results)
        
        assert len(simple_results) == 2
        assert isinstance(simple_results[0], SearchResult)
        assert simple_results[0].title == "标题1"
        assert simple_results[0].url == "https://example1.com"
        assert simple_results[0].link == "https://example1.com"
        assert simple_results[0].snippet == "摘要1"


class TestBochaaISearchIntegration:
    """测试博查AI搜索工具集成"""
    
    def test_tool_args_schema(self):
        """测试工具参数模式"""
        tool = MockBochaaISearchTool()
        assert tool.args_schema.__name__ == "SearchInput"
        assert "query" in tool.args_schema.model_fields
        assert "freshness" in tool.args_schema.model_fields
        assert "summary" in tool.args_schema.model_fields
        assert "count" in tool.args_schema.model_fields
    
    def test_tool_description(self):
        """测试工具描述"""
        tool = MockBochaaISearchTool()
        assert "博查AI Web Search API" in tool.description
        assert "搜索网页信息" in tool.description
    
    @pytest.mark.asyncio
    async def test_async_search(self):
        """测试异步搜索"""
        tool = MockBochaaISearchTool()
        results = await tool._arun("异步测试")
        
        assert isinstance(results, list)
        assert len(results) > 0
        for result in results:
            assert "异步测试" in result["title"]


# ============================================================================
# 直接运行模式的测试函数（来自简化版本）
# ============================================================================

def test_mock_search():
    """测试模拟搜索工具"""
    print("\n=== 测试模拟搜索工具 ===")
    
    # 创建模拟搜索工具
    mock_tool = MockBochaaISearchTool()
    
    # 测试搜索
    query = "阿里巴巴2024年ESG报告"
    print(f"搜索查询: {query}")
    
    try:
        results = mock_tool._run(query)
        print(f"搜索结果数量: {len(results)}")
        
        for i, result in enumerate(results[:3], 1):
            print(f"\n结果 {i}:")
            print(f"  标题: {result.get('title', 'N/A')}")
            print(f"  链接: {result.get('url', 'N/A')}")
            print(f"  摘要: {result.get('snippet', 'N/A')[:100]}...")
        
        print("✅ 模拟搜索测试通过")
        return True
        
    except Exception as e:
        print(f"❌ 模拟搜索测试失败: {e}")
        return False


def test_real_search():
    """测试真实搜索工具（需要API密钥）"""
    print("\n=== 测试真实搜索工具 ===")
    
    # 检查API密钥
    api_key = os.getenv('BOCHA_API_KEY')
    if not api_key:
        print("⚠️  未设置BOCHA_API_KEY环境变量，跳过真实搜索测试")
        print("   如需测试真实搜索，请设置环境变量: BOCHA_API_KEY=your_api_key")
        return True
    
    try:
        # 创建真实搜索工具
        real_tool = BochaaIWebSearchTool(api_key=api_key)
        
        # 测试搜索
        query = "北京天气"
        print(f"搜索查询: {query}")
        
        results = real_tool._run(query)
        print(f"搜索结果数量: {len(results)}")
        
        if results:
            for i, result in enumerate(results[:3], 1):
                print(f"\n结果 {i}:")
                print(f"  标题: {result.get('title', 'N/A')}")
                print(f"  链接: {result.get('url', 'N/A')}")
                print(f"  摘要: {result.get('snippet', 'N/A')[:100]}...")
        
        print("✅ 真实搜索测试通过")
        return True
        
    except Exception as e:
        print(f"❌ 真实搜索测试失败: {e}")
        return False


def test_data_models():
    """测试数据模型"""
    print("\n=== 测试数据模型 ===")
    
    try:
        # 测试SearchInput模型
        search_input = SearchInput(query="测试查询")
        print(f"SearchInput: {search_input.query}")
        
        # 测试WebPageValue模型
        web_page = WebPageValue(
            id="1",
            name="测试标题",
            url="https://example.com",
            displayUrl="example.com",
            snippet="测试摘要",
            siteName="测试站点"
        )
        print(f"WebPageValue: {web_page.name}")
        
        # 测试SearchResult模型
        search_result = SearchResult(
            title="测试标题",
            url="https://example.com",
            link="https://example.com",
            snippet="测试摘要"
        )
        print(f"SearchResult: {search_result.title}")
        
        print("✅ 数据模型测试通过")
        return True
        
    except Exception as e:
        print(f"❌ 数据模型测试失败: {e}")
        return False


def test_convert_function():
    """测试结果转换函数"""
    print("\n=== 测试结果转换函数 ===")
    
    try:
        # 创建模拟的搜索结果列表（字典格式）
        mock_results = [
            {
                'id': '1',
                'title': '测试标题1',
                'url': 'https://example1.com',
                'displayUrl': 'example1.com',
                'snippet': '测试摘要1',
                'siteName': '测试站点1'
            },
            {
                'id': '2',
                'title': '测试标题2',
                'url': 'https://example2.com',
                'displayUrl': 'example2.com',
                'snippet': '测试摘要2',
                'siteName': '测试站点2'
            }
        ]
        
        # 转换结果
        simple_results = convert_to_simple_results(mock_results)
        print(f"转换后结果数量: {len(simple_results)}")
        
        for i, result in enumerate(simple_results, 1):
            print(f"结果 {i}: {result.title} - {result.url}")
        
        print("✅ 结果转换函数测试通过")
        return True
        
    except Exception as e:
        print(f"❌ 结果转换函数测试失败: {e}")
        return False


def run_direct_tests():
    """直接运行模式的主测试函数"""
    print("博查AI搜索工具测试开始")
    print("=" * 50)
    
    test_results = []
    
    # 运行所有测试
    test_results.append(test_data_models())
    test_results.append(test_convert_function())
    test_results.append(test_mock_search())
    test_results.append(test_real_search())
    
    # 统计结果
    passed = sum(test_results)
    total = len(test_results)
    
    print("\n" + "=" * 50)
    print(f"测试完成: {passed}/{total} 通过")
    
    if passed == total:
        print("🎉 所有测试通过！")
        return 0
    else:
        print("❌ 部分测试失败")
        return 1


if __name__ == "__main__":
    # 直接运行模式
    exit_code = run_direct_tests()
    sys.exit(exit_code)
else:
    # pytest运行模式
    # 可以通过 pytest test_bochaai_search.py 运行
    pass