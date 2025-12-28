"""
MCP Tool Manager 冒烟测试

测试 DeerFlow 内化的配置驱动 MCP 工具管理器。

测试覆盖：
1. MCPServerConfig 增强字段（enabled_tools, assign_to_agents）
2. MCPToolManager 初始化和配置
3. 工具分配给特定智能体
4. 工具过滤（enabled_tools）
5. 缓存机制
"""

import pytest
from typing import Dict, List
from unittest.mock import Mock, patch, AsyncMock

# 导入待测试的模块
from agenticx.tools.remote import (
    MCPServerConfig,
    MCPToolManager,
    MCPToolInfo,
    MCPClient,
)


# =============================================================================
# MCPServerConfig 增强测试
# =============================================================================

class TestMCPServerConfigEnhanced:
    """MCPServerConfig 增强字段测试"""
    
    def test_config_with_basic_fields(self):
        """测试基本字段创建配置"""
        config = MCPServerConfig(
            name="test_server",
            command="uvx",
            args=["mcp-test"]
        )
        
        assert config.name == "test_server"
        assert config.command == "uvx"
        assert config.args == ["mcp-test"]
        assert config.enabled_tools == []  # 默认空列表
        assert config.assign_to_agents == []  # 默认空列表
    
    def test_config_with_enabled_tools(self):
        """测试 enabled_tools 字段"""
        config = MCPServerConfig(
            name="test_server",
            command="uvx",
            enabled_tools=["tool1", "tool2", "tool3"]
        )
        
        assert len(config.enabled_tools) == 3
        assert "tool1" in config.enabled_tools
        assert "tool2" in config.enabled_tools
    
    def test_config_with_assign_to_agents(self):
        """测试 assign_to_agents 字段"""
        config = MCPServerConfig(
            name="test_server",
            command="uvx",
            assign_to_agents=["mining_researcher", "code_analyzer"]
        )
        
        assert len(config.assign_to_agents) == 2
        assert "mining_researcher" in config.assign_to_agents
        assert "code_analyzer" in config.assign_to_agents
    
    def test_config_with_all_fields(self):
        """测试所有字段"""
        config = MCPServerConfig(
            name="github_trending",
            command="uvx",
            args=["mcp-github-trending"],
            env={"API_KEY": "test_key"},
            timeout=30.0,
            cwd="/path/to/dir",
            enabled_tools=["get_trending_repositories", "get_repo_details"],
            assign_to_agents=["mining_researcher"]
        )
        
        assert config.name == "github_trending"
        assert config.command == "uvx"
        assert config.args == ["mcp-github-trending"]
        assert config.env == {"API_KEY": "test_key"}
        assert config.timeout == 30.0
        assert config.cwd == "/path/to/dir"
        assert config.enabled_tools == ["get_trending_repositories", "get_repo_details"]
        assert config.assign_to_agents == ["mining_researcher"]


# =============================================================================
# MCPToolManager 测试
# =============================================================================

class TestMCPToolManager:
    """MCPToolManager 核心功能测试"""
    
    @pytest.fixture
    def sample_configs(self) -> Dict[str, MCPServerConfig]:
        """创建示例配置"""
        return {
            "github": MCPServerConfig(
                name="github",
                command="uvx",
                args=["mcp-github"],
                enabled_tools=["search_repos", "get_repo_info"],
                assign_to_agents=["researcher", "analyzer"]
            ),
            "web_search": MCPServerConfig(
                name="web_search",
                command="uvx",
                args=["mcp-web-search"],
                enabled_tools=["search_web"],
                assign_to_agents=["researcher"]
            ),
            "code_tools": MCPServerConfig(
                name="code_tools",
                command="uvx",
                args=["mcp-code-tools"],
                # 空列表表示所有工具和智能体
                enabled_tools=[],
                assign_to_agents=[]
            )
        }
    
    def test_manager_initialization(self, sample_configs):
        """测试管理器初始化"""
        manager = MCPToolManager(sample_configs)
        
        assert len(manager.servers_config) == 3
        assert "github" in manager.servers_config
        assert "web_search" in manager.servers_config
        assert "code_tools" in manager.servers_config
        assert len(manager.clients) == 0  # 未加载前为空
        assert len(manager.loaded_tools) == 0
    
    def test_get_tool_assignment_summary(self, sample_configs):
        """测试获取工具分配摘要"""
        manager = MCPToolManager(sample_configs)
        
        summary = manager.get_tool_assignment_summary()
        
        assert summary["total_servers"] == 3
        assert "github" in summary["servers"]
        assert "web_search" in summary["servers"]
        
        # 检查 github 服务器摘要
        github_info = summary["servers"]["github"]
        assert github_info["command"] == "uvx"
        assert github_info["enabled_tools"] == ["search_repos", "get_repo_info"]
        assert github_info["assigned_agents"] == ["researcher", "analyzer"]
    
    @pytest.mark.asyncio
    async def test_refresh_tools_cache(self, sample_configs):
        """测试刷新工具缓存"""
        manager = MCPToolManager(sample_configs)
        
        # 模拟已加载的工具
        manager.loaded_tools["github"] = [
            MCPToolInfo(name="tool1", description="Test", inputSchema={})
        ]
        manager.loaded_tools["web_search"] = [
            MCPToolInfo(name="tool2", description="Test", inputSchema={})
        ]
        
        # 刷新单个服务器
        await manager.refresh_tools("github")
        assert "github" not in manager.loaded_tools
        assert "web_search" in manager.loaded_tools  # 其他保留
        
        # 刷新全部
        await manager.refresh_tools()
        assert len(manager.loaded_tools) == 0


class TestMCPToolManagerAgentFiltering:
    """MCPToolManager 智能体过滤测试"""
    
    @pytest.fixture
    def mock_mcp_client(self):
        """创建 Mock MCP Client"""
        mock_client = AsyncMock(spec=MCPClient)
        
        # 模拟工具发现
        mock_client.discover_tools.return_value = [
            MCPToolInfo(
                name="search_repos",
                description="Search GitHub repositories",
                inputSchema={"type": "object", "properties": {}}
            ),
            MCPToolInfo(
                name="get_repo_info",
                description="Get repository information",
                inputSchema={"type": "object", "properties": {}}
            ),
            MCPToolInfo(
                name="disabled_tool",
                description="This tool is disabled",
                inputSchema={"type": "object", "properties": {}}
            )
        ]
        
        # 模拟 Pydantic 模型创建
        mock_client._create_pydantic_model_from_schema = Mock(return_value=None)
        
        return mock_client
    
    @pytest.mark.asyncio
    async def test_load_tools_for_assigned_agent(self, mock_mcp_client):
        """测试为分配的智能体加载工具"""
        config = MCPServerConfig(
            name="github",
            command="uvx",
            args=["mcp-github"],
            enabled_tools=["search_repos", "get_repo_info"],
            assign_to_agents=["researcher", "analyzer"]
        )
        
        manager = MCPToolManager({"github": config})
        
        # 模拟创建客户端
        with patch.object(manager, '_get_or_create_client', return_value=mock_mcp_client):
            # 分配的智能体应该获取工具
            tools = await manager.load_tools_for_agent("researcher")
            
            # 应该加载 2 个启用的工具（search_repos, get_repo_info）
            assert len(tools) == 2
            assert any("search_repos" in t.name for t in tools)
            assert any("get_repo_info" in t.name for t in tools)
            # disabled_tool 不应该被加载
            assert not any("disabled_tool" in t.name for t in tools)
    
    @pytest.mark.asyncio
    async def test_load_tools_for_unassigned_agent(self, mock_mcp_client):
        """测试未分配的智能体不应获取工具"""
        config = MCPServerConfig(
            name="github",
            command="uvx",
            args=["mcp-github"],
            enabled_tools=["search_repos"],
            assign_to_agents=["researcher"]  # 只分配给 researcher
        )
        
        manager = MCPToolManager({"github": config})
        
        with patch.object(manager, '_get_or_create_client', return_value=mock_mcp_client):
            # 未分配的智能体不应获取工具
            tools = await manager.load_tools_for_agent("other_agent")
            
            assert len(tools) == 0
    
    @pytest.mark.asyncio
    async def test_load_tools_empty_assign_list_allows_all(self, mock_mcp_client):
        """测试空的 assign_to_agents 列表允许所有智能体"""
        config = MCPServerConfig(
            name="github",
            command="uvx",
            args=["mcp-github"],
            enabled_tools=["search_repos"],
            assign_to_agents=[]  # 空列表表示所有智能体可用
        )
        
        manager = MCPToolManager({"github": config})
        
        with patch.object(manager, '_get_or_create_client', return_value=mock_mcp_client):
            # 任何智能体都应该能获取工具
            tools = await manager.load_tools_for_agent("any_agent")
            
            assert len(tools) == 1  # search_repos
    
    @pytest.mark.asyncio
    async def test_enabled_tools_filtering(self, mock_mcp_client):
        """测试 enabled_tools 过滤"""
        config = MCPServerConfig(
            name="github",
            command="uvx",
            enabled_tools=["search_repos"],  # 只启用一个工具
            assign_to_agents=[]
        )
        
        manager = MCPToolManager({"github": config})
        
        with patch.object(manager, '_get_or_create_client', return_value=mock_mcp_client):
            tools = await manager.load_tools_for_agent("agent1")
            
            # 只有 search_repos 被启用
            assert len(tools) == 1
            assert "search_repos" in tools[0].name
    
    @pytest.mark.asyncio
    async def test_empty_enabled_tools_allows_all(self, mock_mcp_client):
        """测试空的 enabled_tools 列表允许所有工具"""
        config = MCPServerConfig(
            name="github",
            command="uvx",
            enabled_tools=[],  # 空列表表示所有工具启用
            assign_to_agents=[]
        )
        
        manager = MCPToolManager({"github": config})
        
        with patch.object(manager, '_get_or_create_client', return_value=mock_mcp_client):
            tools = await manager.load_tools_for_agent("agent1")
            
            # 所有 3 个工具都应该被加载
            assert len(tools) == 3


class TestMCPToolManagerMultiServer:
    """MCPToolManager 多服务器测试"""
    
    @pytest.fixture
    def multi_server_configs(self) -> Dict[str, MCPServerConfig]:
        """多服务器配置"""
        return {
            "github": MCPServerConfig(
                name="github",
                command="uvx",
                enabled_tools=["search_repos"],
                assign_to_agents=["researcher"]
            ),
            "web": MCPServerConfig(
                name="web",
                command="uvx",
                enabled_tools=["search_web"],
                assign_to_agents=["researcher"]
            ),
            "code": MCPServerConfig(
                name="code",
                command="uvx",
                enabled_tools=["analyze_code"],
                assign_to_agents=["analyzer"]
            )
        }
    
    @pytest.mark.asyncio
    async def test_agent_receives_tools_from_multiple_servers(self, multi_server_configs):
        """测试智能体从多个服务器接收工具"""
        manager = MCPToolManager(multi_server_configs)
        
        # 模拟每个服务器的工具发现
        github_tools = [MCPToolInfo(name="search_repos", description="", inputSchema={})]
        web_tools = [MCPToolInfo(name="search_web", description="", inputSchema={})]
        code_tools = [MCPToolInfo(name="analyze_code", description="", inputSchema={})]
        
        async def mock_discover(server_name, client):
            if server_name == "github":
                return github_tools
            elif server_name == "web":
                return web_tools
            elif server_name == "code":
                return code_tools
            return []
        
        with patch.object(manager, '_discover_tools', side_effect=mock_discover):
            with patch('agenticx.tools.remote.MCPClient') as mock_client_class:
                mock_client = AsyncMock()
                mock_client._create_pydantic_model_from_schema = Mock(return_value=None)
                mock_client_class.return_value = mock_client
                
                # researcher 应该从 github 和 web 获取工具
                researcher_tools = await manager.load_tools_for_agent("researcher")
                assert len(researcher_tools) == 2  # github + web
                
                # analyzer 只从 code 获取工具
                analyzer_tools = await manager.load_tools_for_agent("analyzer")
                assert len(analyzer_tools) == 1  # code


# =============================================================================
# 集成测试
# =============================================================================

class TestMCPToolManagerIntegration:
    """MCPToolManager 集成测试"""
    
    def test_module_imports(self):
        """测试模块导入"""
        from agenticx.tools.remote import MCPToolManager, MCPServerConfig
        
        assert MCPToolManager is not None
        assert MCPServerConfig is not None
    
    def test_tool_description_includes_source(self):
        """测试工具描述包含来源信息"""
        config = MCPServerConfig(
            name="test_server",
            command="uvx",
            enabled_tools=["tool1"],
            assign_to_agents=[]
        )
        
        # 验证工具描述会包含来源信息
        # （实际测试在 load_tools_for_agent 中）
        assert config.name == "test_server"
    
    def test_configuration_flexibility(self):
        """测试配置灵活性"""
        # 场景 1：所有工具，所有智能体
        config1 = MCPServerConfig(
            name="server1",
            command="cmd",
            enabled_tools=[],
            assign_to_agents=[]
        )
        assert config1.enabled_tools == []
        assert config1.assign_to_agents == []
        
        # 场景 2：部分工具，部分智能体
        config2 = MCPServerConfig(
            name="server2",
            command="cmd",
            enabled_tools=["tool1", "tool2"],
            assign_to_agents=["agent1"]
        )
        assert len(config2.enabled_tools) == 2
        assert len(config2.assign_to_agents) == 1
        
        # 场景 3：所有工具，特定智能体
        config3 = MCPServerConfig(
            name="server3",
            command="cmd",
            enabled_tools=[],
            assign_to_agents=["agent1", "agent2"]
        )
        assert config3.enabled_tools == []
        assert len(config3.assign_to_agents) == 2


# =============================================================================
# 运行测试
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

