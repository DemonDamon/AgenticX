"""
ADK 借鉴增强功能的冒烟测试

测试内容：
1. Tool 接口增强（process_llm_request, get_declaration, ToolContext）
2. 评测标准化（EvalSet, TrajectoryMatcher）
3. 会话持久化（InMemorySessionService, DatabaseSessionService）
4. OpenAPIToolset

运行方式：
    pytest tests/test_adk_enhancements.py -v
    python tests/test_adk_enhancements.py  # 直接运行
"""

import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pytest

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============== 1. Tool 接口增强测试 ==============

class TestToolEnhancements:
    """测试 Tool 接口增强"""
    
    def test_tool_get_declaration(self):
        """测试 get_declaration 方法"""
        from pydantic import BaseModel, Field
        from agenticx.tools import BaseTool
        
        class SearchArgs(BaseModel):
            query: str = Field(description="搜索关键词")
            limit: int = Field(default=10, description="返回数量")
        
        class MockSearchTool(BaseTool):
            def __init__(self):
                super().__init__(
                    name="web_search",
                    description="搜索网页内容",
                    args_schema=SearchArgs
                )
            
            def _run(self, **kwargs):
                return {"results": []}
        
        tool = MockSearchTool()
        declaration = tool.get_declaration()
        
        # 验证声明结构
        assert declaration["name"] == "web_search"
        assert declaration["description"] == "搜索网页内容"
        assert "parameters" in declaration
        assert "properties" in declaration["parameters"]
        assert "query" in declaration["parameters"]["properties"]
        
        print("✅ test_tool_get_declaration passed")
    
    def test_tool_context_creation(self):
        """测试 ToolContext 创建"""
        from agenticx.tools import ToolContext
        
        ctx = ToolContext.create(
            tool_name="test_tool",
            session_id="session-123",
            user_id="user-456"
        )
        
        assert ctx.tool_name == "test_tool"
        assert ctx.session_id == "session-123"
        assert ctx.user_id == "user-456"
        assert ctx.function_call_id is not None
        
        print("✅ test_tool_context_creation passed")
    
    def test_tool_context_state(self):
        """测试 ToolContext 状态管理"""
        from agenticx.tools import ToolContext
        
        ctx = ToolContext.create(tool_name="test")
        
        # 设置和获取状态
        ctx.set_state("key1", "value1")
        ctx.set_state("key2", 42)
        
        assert ctx.get_state("key1") == "value1"
        assert ctx.get_state("key2") == 42
        assert ctx.get_state("key3", "default") == "default"
        
        print("✅ test_tool_context_state passed")
    
    def test_tool_context_artifacts(self):
        """测试 ToolContext 工件管理"""
        from agenticx.tools import ToolContext
        
        ctx = ToolContext.create(tool_name="test")
        
        # 保存工件
        artifact_id = ctx.save_artifact("report", {"data": [1, 2, 3]}, "application/json")
        
        # 加载工件
        data = ctx.load_artifact(artifact_id)
        assert data == {"data": [1, 2, 3]}
        
        # 列出工件
        artifacts = ctx.list_artifacts()
        assert len(artifacts) == 1
        
        print("✅ test_tool_context_artifacts passed")
    
    def test_llm_request(self):
        """测试 LlmRequest"""
        from agenticx.tools import LlmRequest
        
        req = LlmRequest()
        req.append_message("user", "Hello")
        req.set_system_prompt("You are a helpful assistant.")
        req.append_tools([{"type": "function", "function": {"name": "search"}}])
        
        req_dict = req.to_dict()
        
        assert len(req_dict["messages"]) == 2  # system + user
        assert req_dict["messages"][0]["role"] == "system"
        assert req_dict["messages"][1]["content"] == "Hello"
        assert len(req_dict["tools"]) == 1
        
        print("✅ test_llm_request passed")
    
    @pytest.mark.asyncio
    async def test_process_llm_request(self):
        """测试 process_llm_request 方法"""
        from agenticx.tools import BaseTool, LlmRequest, ToolContext
        
        class MockTool(BaseTool):
            def __init__(self):
                super().__init__(name="mock", description="Mock tool")
            
            def _run(self, **kwargs):
                return "ok"
            
            async def process_llm_request(self, tool_context=None, llm_request=None):
                # 自定义处理：添加额外的系统提示
                if llm_request:
                    llm_request.append_system_prompt("Additional context for mock tool.")
                await super().process_llm_request(tool_context, llm_request)
        
        tool = MockTool()
        req = LlmRequest()
        req.set_system_prompt("Base prompt.")
        
        await tool.process_llm_request(llm_request=req)
        
        assert "Additional context" in req.system_prompt
        assert len(req.tools) == 1  # 工具声明已添加
        
        print("✅ test_process_llm_request passed")


# ============== 2. 评测标准化测试 ==============

class TestEvaluation:
    """测试评测标准化模块"""
    
    def test_evalset_creation(self):
        """测试 EvalSet 创建"""
        from agenticx.evaluation import EvalSet, EvalCase, ExpectedToolUse
        
        case = EvalCase(
            id="case-1",
            query="搜索 Python 教程",
            expected_tool_use=[
                ExpectedToolUse(tool_name="web_search", match_mode="name_only")
            ],
            reference="这里有一些 Python 教程..."
        )
        
        evalset = EvalSet(
            name="search_test",
            version="1.0.0",
            cases=[case]
        )
        
        assert len(evalset) == 1
        assert evalset.cases[0].query == "搜索 Python 教程"
        
        print("✅ test_evalset_creation passed")
    
    def test_evalset_file_io(self):
        """测试 EvalSet 文件读写"""
        from agenticx.evaluation import EvalSet, EvalCase, ExpectedToolUse
        
        evalset = EvalSet(
            name="file_test",
            cases=[
                EvalCase(
                    id="1",
                    query="Test query",
                    expected_tool_use=[ExpectedToolUse(tool_name="test_tool")]
                )
            ]
        )
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            evalset.to_file(f.name)
            temp_path = f.name
        
        try:
            loaded = EvalSet.from_file(temp_path)
            assert loaded.name == "file_test"
            assert len(loaded.cases) == 1
        finally:
            os.unlink(temp_path)
        
        print("✅ test_evalset_file_io passed")
    
    def test_trajectory_matcher_exact(self):
        """测试轨迹精确匹配"""
        from agenticx.evaluation import TrajectoryMatcher, MatchMode, ToolCall, ExpectedToolUse
        
        matcher = TrajectoryMatcher(mode=MatchMode.EXACT)
        
        actual = [
            ToolCall(tool_name="search", tool_input={"q": "python"}),
            ToolCall(tool_name="summarize", tool_input={"text": "..."})
        ]
        
        expected = [
            ExpectedToolUse(tool_name="search"),
            ExpectedToolUse(tool_name="summarize")
        ]
        
        result = matcher.match(actual, expected)
        
        assert result.matched is True
        assert result.score == 1.0
        assert result.matched_count == 2
        
        print("✅ test_trajectory_matcher_exact passed")
    
    def test_trajectory_matcher_in_order(self):
        """测试轨迹顺序匹配"""
        from agenticx.evaluation import TrajectoryMatcher, MatchMode, ToolCall, ExpectedToolUse
        
        matcher = TrajectoryMatcher(mode=MatchMode.IN_ORDER)
        
        # 实际调用包含额外的工具
        actual = [
            ToolCall(tool_name="search"),
            ToolCall(tool_name="filter"),  # 额外调用
            ToolCall(tool_name="summarize")
        ]
        
        expected = [
            ExpectedToolUse(tool_name="search"),
            ExpectedToolUse(tool_name="summarize")
        ]
        
        result = matcher.match(actual, expected)
        
        assert result.matched is True
        assert result.score == 1.0
        
        print("✅ test_trajectory_matcher_in_order passed")
    
    def test_trajectory_matcher_any_order(self):
        """测试轨迹任意顺序匹配"""
        from agenticx.evaluation import TrajectoryMatcher, MatchMode, ToolCall, ExpectedToolUse
        
        matcher = TrajectoryMatcher(mode=MatchMode.ANY_ORDER)
        
        # 实际调用顺序与预期不同
        actual = [
            ToolCall(tool_name="summarize"),
            ToolCall(tool_name="search")
        ]
        
        expected = [
            ExpectedToolUse(tool_name="search"),
            ExpectedToolUse(tool_name="summarize")
        ]
        
        result = matcher.match(actual, expected)
        
        assert result.matched is True
        assert result.score == 1.0
        
        print("✅ test_trajectory_matcher_any_order passed")
    
    def test_match_trajectory_function(self):
        """测试便捷函数 match_trajectory"""
        from agenticx.evaluation import match_trajectory, ExpectedToolUse, MatchMode
        
        actual = [
            {"tool_name": "search", "tool_input": {"q": "test"}},
            {"tool_name": "analyze"}
        ]
        
        expected = [
            ExpectedToolUse(tool_name="search"),
            ExpectedToolUse(tool_name="analyze")
        ]
        
        score = match_trajectory(actual, expected, mode=MatchMode.EXACT)
        assert score == 1.0
        
        print("✅ test_match_trajectory_function passed")


# ============== 3. 会话持久化测试 ==============

class TestSessionService:
    """测试会话持久化模块"""
    
    @pytest.mark.asyncio
    async def test_inmemory_session_crud(self):
        """测试内存会话服务 CRUD"""
        from agenticx.sessions import InMemorySessionService
        
        service = InMemorySessionService()
        
        # 创建会话
        session = await service.create_session(
            app_name="test_app",
            user_id="user-1",
            state={"key": "value"}
        )
        
        assert session.app_name == "test_app"
        assert session.user_id == "user-1"
        assert session.state.get("key") == "value"
        
        # 获取会话
        retrieved = await service.get_session("test_app", "user-1", session.id)
        assert retrieved is not None
        assert retrieved.id == session.id
        
        # 更新会话
        session.state.set("new_key", "new_value")
        updated = await service.update_session(session)
        assert updated.state.get("new_key") == "new_value"
        
        # 删除会话
        deleted = await service.delete_session("test_app", "user-1", session.id)
        assert deleted is True
        
        # 验证删除
        not_found = await service.get_session("test_app", "user-1", session.id)
        assert not_found is None
        
        print("✅ test_inmemory_session_crud passed")
    
    @pytest.mark.asyncio
    async def test_session_events(self):
        """测试会话事件"""
        from agenticx.sessions import InMemorySessionService, SessionEvent
        
        service = InMemorySessionService()
        
        session = await service.create_session(
            app_name="test_app",
            user_id="user-1"
        )
        
        # 追加事件
        event = SessionEvent(
            type="tool_call",
            data={"tool_name": "search", "input": {"q": "test"}}
        )
        
        await service.append_event(session, event)
        
        # 获取会话并验证事件
        retrieved = await service.get_session("test_app", "user-1", session.id)
        assert len(retrieved.events) == 1
        assert retrieved.events[0].type == "tool_call"
        
        print("✅ test_session_events passed")
    
    @pytest.mark.asyncio
    async def test_session_state_levels(self):
        """测试会话状态分层"""
        from agenticx.sessions import SessionState
        
        state = SessionState()
        
        # 设置不同层级的状态
        state.set("app_config", "global", level="app")
        state.set("user_pref", "dark_mode", level="user")
        state.set("current_task", "search", level="session")
        state.set("temp_data", "cache", level="temp")
        
        # 验证按优先级获取
        assert state.get("app_config") == "global"
        assert state.get("user_pref") == "dark_mode"
        assert state.get("current_task") == "search"
        assert state.get("temp_data") == "cache"
        
        # 同名键不同层级
        state.set("key", "app_value", level="app")
        state.set("key", "session_value", level="session")
        # session 优先级高于 app
        assert state.get("key") == "session_value"
        
        print("✅ test_session_state_levels passed")
    
    @pytest.mark.asyncio
    async def test_list_sessions(self):
        """测试列出会话"""
        from agenticx.sessions import InMemorySessionService
        
        service = InMemorySessionService()
        
        # 创建多个会话
        for i in range(5):
            await service.create_session(
                app_name="test_app",
                user_id="user-1",
                metadata={"index": i}
            )
        
        # 列出会话
        sessions = await service.list_sessions("test_app", "user-1")
        assert len(sessions) == 5
        
        # 分页
        sessions_page = await service.list_sessions("test_app", "user-1", limit=2, offset=0)
        assert len(sessions_page) == 2
        
        # 清理
        await service.clear_all()
        
        print("✅ test_list_sessions passed")


# ============== 4. OpenAPIToolset 测试 ==============

class TestOpenAPIToolset:
    """测试 OpenAPIToolset"""
    
    def test_openapi_toolset_creation(self):
        """测试从 OpenAPI spec 创建工具集"""
        from agenticx.tools import OpenAPIToolset
        
        # 简单的 OpenAPI spec
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test API", "version": "1.0.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/users": {
                    "get": {
                        "operationId": "listUsers",
                        "summary": "List all users",
                        "parameters": [
                            {
                                "name": "limit",
                                "in": "query",
                                "schema": {"type": "integer"}
                            }
                        ]
                    },
                    "post": {
                        "operationId": "createUser",
                        "summary": "Create a new user",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "email": {"type": "string"}
                                        },
                                        "required": ["name", "email"]
                                    }
                                }
                            }
                        }
                    }
                },
                "/users/{id}": {
                    "get": {
                        "operationId": "getUser",
                        "summary": "Get user by ID",
                        "parameters": [
                            {
                                "name": "id",
                                "in": "path",
                                "required": True,
                                "schema": {"type": "string"}
                            }
                        ]
                    }
                }
            }
        }
        
        toolset = OpenAPIToolset(spec)
        tools = toolset.get_tools()
        
        assert len(tools) == 3
        
        # 验证工具名称
        tool_names = [t.name for t in tools]
        assert "listUsers" in tool_names
        assert "createUser" in tool_names
        assert "getUser" in tool_names
        
        print("✅ test_openapi_toolset_creation passed")
    
    def test_openapi_tool_filter_by_method(self):
        """测试按 HTTP 方法筛选工具"""
        from agenticx.tools import OpenAPIToolset
        
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test", "version": "1.0.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/items": {
                    "get": {"operationId": "listItems", "summary": "List items"},
                    "post": {"operationId": "createItem", "summary": "Create item"}
                }
            }
        }
        
        toolset = OpenAPIToolset(spec)
        
        # 只获取 GET 方法的工具
        get_tools = toolset.get_tools(methods=["GET"])
        assert len(get_tools) == 1
        assert get_tools[0].name == "listItems"
        
        print("✅ test_openapi_tool_filter_by_method passed")
    
    def test_openapi_tool_declaration(self):
        """测试 OpenAPI 工具的声明"""
        from agenticx.tools import OpenAPIToolset
        
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test", "version": "1.0.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/search": {
                    "get": {
                        "operationId": "search",
                        "summary": "Search items",
                        "parameters": [
                            {
                                "name": "q",
                                "in": "query",
                                "required": True,
                                "schema": {"type": "string"}
                            }
                        ]
                    }
                }
            }
        }
        
        toolset = OpenAPIToolset(spec)
        tools = toolset.get_tools()
        
        tool = tools[0]
        declaration = tool.get_declaration()
        
        assert declaration["name"] == "search"
        assert "parameters" in declaration
        assert "q" in declaration["parameters"]["properties"]
        
        print("✅ test_openapi_tool_declaration passed")
    
    def test_openapi_file_io(self):
        """测试从文件加载 OpenAPI spec"""
        from agenticx.tools import OpenAPIToolset
        
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "File Test", "version": "1.0.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/test": {
                    "get": {"operationId": "test", "summary": "Test endpoint"}
                }
            }
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(spec, f)
            temp_path = f.name
        
        try:
            toolset = OpenAPIToolset.from_file(temp_path)
            tools = toolset.get_tools()
            assert len(tools) == 1
            assert tools[0].name == "test"
        finally:
            os.unlink(temp_path)
        
        print("✅ test_openapi_file_io passed")


# ============== 运行入口 ==============

def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("ADK 借鉴增强功能 - 冒烟测试")
    print("=" * 60)
    print()
    
    # 1. Tool 接口增强测试
    print("📦 1. Tool 接口增强测试")
    print("-" * 40)
    tool_tests = TestToolEnhancements()
    tool_tests.test_tool_get_declaration()
    tool_tests.test_tool_context_creation()
    tool_tests.test_tool_context_state()
    tool_tests.test_tool_context_artifacts()
    tool_tests.test_llm_request()
    asyncio.run(tool_tests.test_process_llm_request())
    print()
    
    # 2. 评测标准化测试
    print("📦 2. 评测标准化测试")
    print("-" * 40)
    eval_tests = TestEvaluation()
    eval_tests.test_evalset_creation()
    eval_tests.test_evalset_file_io()
    eval_tests.test_trajectory_matcher_exact()
    eval_tests.test_trajectory_matcher_in_order()
    eval_tests.test_trajectory_matcher_any_order()
    eval_tests.test_match_trajectory_function()
    print()
    
    # 3. 会话持久化测试
    print("📦 3. 会话持久化测试")
    print("-" * 40)
    session_tests = TestSessionService()
    asyncio.run(session_tests.test_inmemory_session_crud())
    asyncio.run(session_tests.test_session_events())
    asyncio.run(session_tests.test_session_state_levels())
    asyncio.run(session_tests.test_list_sessions())
    print()
    
    # 4. OpenAPIToolset 测试
    print("📦 4. OpenAPIToolset 测试")
    print("-" * 40)
    openapi_tests = TestOpenAPIToolset()
    openapi_tests.test_openapi_toolset_creation()
    openapi_tests.test_openapi_tool_filter_by_method()
    openapi_tests.test_openapi_tool_declaration()
    openapi_tests.test_openapi_file_io()
    print()
    
    print("=" * 60)
    print("✅ 所有冒烟测试通过!")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()

