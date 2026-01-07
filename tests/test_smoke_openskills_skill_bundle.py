"""
冒烟测试：openskills Skill Bundle 功能

验证 AgenticX 的 Anthropic SKILL.md 规范兼容实现：
- P0: SkillMetadata、SkillBundleLoader、SkillTool
- P1: DiscoveryBus 集成、process_llm_request 渐进式注入

运行方式：
    pytest -q tests/test_smoke_openskills_skill_bundle.py
    pytest -q -k "smoke_openskills"
"""

import tempfile
from pathlib import Path
from typing import Generator

import pytest

from agenticx.tools.skill_bundle import (
    SkillMetadata,
    SkillBundleLoader,
    SkillTool,
)


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def temp_skills_dir() -> Generator[Path, None, None]:
    """创建临时技能目录。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def sample_skill_md_content() -> str:
    """示例 SKILL.md 内容。"""
    return """---
name: pdf-processor
description: Comprehensive PDF manipulation toolkit for extracting text and tables.
---

# PDF Processor Skill

## Overview
This skill provides capabilities for working with PDF documents.

## Instructions
1. Use `pip install pypdf2` to install dependencies
2. Extract text using the scripts in `scripts/`
3. For bundled resources, use the base directory provided

## Available Actions
- Extract text from PDF
- Merge multiple PDFs
- Split PDF into pages
"""


@pytest.fixture
def sample_skill_dir(temp_skills_dir: Path, sample_skill_md_content: str) -> Path:
    """创建示例技能目录。"""
    skill_dir = temp_skills_dir / "pdf-processor"
    skill_dir.mkdir(parents=True)
    
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(sample_skill_md_content, encoding="utf-8")
    
    # 创建资源目录
    (skill_dir / "scripts").mkdir()
    (skill_dir / "assets").mkdir()
    
    return skill_dir


@pytest.fixture
def multi_skill_dir(temp_skills_dir: Path) -> Path:
    """创建多个技能的目录。"""
    # 技能 1: pdf
    pdf_dir = temp_skills_dir / "pdf"
    pdf_dir.mkdir()
    (pdf_dir / "SKILL.md").write_text("""---
name: pdf
description: PDF manipulation toolkit
---
# PDF Skill
Instructions here...
""", encoding="utf-8")
    
    # 技能 2: excel
    excel_dir = temp_skills_dir / "excel"
    excel_dir.mkdir()
    (excel_dir / "SKILL.md").write_text("""---
name: excel
description: Excel spreadsheet automation
---
# Excel Skill
Instructions here...
""", encoding="utf-8")
    
    # 技能 3: 无效技能（缺少 SKILL.md）
    invalid_dir = temp_skills_dir / "invalid"
    invalid_dir.mkdir()
    
    return temp_skills_dir


# =============================================================================
# P0-1: SkillMetadata 测试
# =============================================================================

class TestSkillMetadata:
    """P0-1: SkillMetadata 数据结构测试。"""
    
    def test_skill_metadata_creation(self, temp_skills_dir: Path):
        """测试 SkillMetadata 创建和字段完整性。"""
        meta = SkillMetadata(
            name="test-skill",
            description="A test skill for verification",
            base_dir=temp_skills_dir / "test-skill",
            skill_md_path=temp_skills_dir / "test-skill" / "SKILL.md",
            location="project",
        )
        
        assert meta.name == "test-skill"
        assert meta.description == "A test skill for verification"
        assert meta.base_dir == temp_skills_dir / "test-skill"
        assert meta.skill_md_path == temp_skills_dir / "test-skill" / "SKILL.md"
        assert meta.location == "project"
    
    def test_skill_metadata_to_dict(self, temp_skills_dir: Path):
        """测试 SkillMetadata 转换为字典。"""
        meta = SkillMetadata(
            name="pdf",
            description="PDF toolkit",
            base_dir=temp_skills_dir / "pdf",
            skill_md_path=temp_skills_dir / "pdf" / "SKILL.md",
        )
        
        d = meta.to_dict()
        
        assert d["name"] == "pdf"
        assert d["description"] == "PDF toolkit"
        assert "base_dir" in d
        assert "skill_md_path" in d
        assert d["location"] == "project"  # 默认值
    
    def test_skill_metadata_default_location(self, temp_skills_dir: Path):
        """测试 SkillMetadata 默认 location 值。"""
        meta = SkillMetadata(
            name="skill",
            description="desc",
            base_dir=temp_skills_dir,
            skill_md_path=temp_skills_dir / "SKILL.md",
        )
        
        assert meta.location == "project"


# =============================================================================
# P0-2: SkillBundleLoader 测试
# =============================================================================

class TestSkillBundleLoader:
    """P0-2: SkillBundleLoader 扫描与解析测试。"""
    
    def test_parse_skill_md_happy_path(
        self,
        temp_skills_dir: Path,
        sample_skill_dir: Path,
        sample_skill_md_content: str,
    ):
        """测试正常 SKILL.md 解析。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        skill_md = sample_skill_dir / "SKILL.md"
        
        meta = loader._parse_skill_md(skill_md, sample_skill_dir, "project")
        
        assert meta is not None
        assert meta.name == "pdf-processor"
        assert "PDF manipulation" in meta.description
        assert meta.base_dir == sample_skill_dir
        assert meta.skill_md_path == skill_md
        assert meta.location == "project"
    
    def test_parse_skill_md_missing_name(self, temp_skills_dir: Path):
        """测试缺少 name 字段时返回 None。"""
        skill_dir = temp_skills_dir / "invalid-skill"
        skill_dir.mkdir()
        skill_md = skill_dir / "SKILL.md"
        skill_md.write_text("""---
description: Missing name field
---
# Invalid Skill
""", encoding="utf-8")
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        meta = loader._parse_skill_md(skill_md, skill_dir, "project")
        
        assert meta is None
    
    def test_parse_skill_md_missing_frontmatter(self, temp_skills_dir: Path):
        """测试缺少 YAML frontmatter 时返回 None。"""
        skill_dir = temp_skills_dir / "no-frontmatter"
        skill_dir.mkdir()
        skill_md = skill_dir / "SKILL.md"
        skill_md.write_text("""# No Frontmatter Skill
Just plain markdown without YAML frontmatter.
""", encoding="utf-8")
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        meta = loader._parse_skill_md(skill_md, skill_dir, "project")
        
        assert meta is None
    
    def test_loader_scan_empty_dir(self, temp_skills_dir: Path):
        """测试空目录扫描返回空列表。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        skills = loader.scan()
        
        assert skills == []
    
    def test_loader_scan_nonexistent_dir(self):
        """测试不存在的目录扫描不报错。"""
        loader = SkillBundleLoader(search_paths=[Path("/nonexistent/path")])
        skills = loader.scan()
        
        assert skills == []
    
    def test_loader_scan_with_skills(self, multi_skill_dir: Path):
        """测试多技能目录扫描。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        skills = loader.scan()
        
        assert len(skills) == 2
        names = {s.name for s in skills}
        assert "pdf" in names
        assert "excel" in names
    
    def test_loader_get_skill(self, sample_skill_dir: Path, temp_skills_dir: Path):
        """测试根据名称获取技能。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        loader.scan()
        
        skill = loader.get_skill("pdf-processor")
        
        assert skill is not None
        assert skill.name == "pdf-processor"
    
    def test_loader_get_skill_not_found(self, temp_skills_dir: Path):
        """测试获取不存在的技能返回 None。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        loader.scan()
        
        skill = loader.get_skill("nonexistent")
        
        assert skill is None
    
    def test_loader_get_skill_content(
        self,
        sample_skill_dir: Path,
        temp_skills_dir: Path,
    ):
        """测试读取技能完整内容。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        loader.scan()
        
        content = loader.get_skill_content("pdf-processor")
        
        assert content is not None
        assert "Reading: pdf-processor" in content
        assert "Base directory:" in content
        assert "PDF Processor Skill" in content
        assert "Skill read: pdf-processor" in content
    
    def test_loader_get_skill_content_not_found(self, temp_skills_dir: Path):
        """测试读取不存在技能的内容返回 None。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        loader.scan()
        
        content = loader.get_skill_content("nonexistent")
        
        assert content is None
    
    def test_loader_deduplication(self, temp_skills_dir: Path):
        """测试同名技能去重（保留高优先级）。"""
        # 创建两个同名技能目录
        path1 = temp_skills_dir / "high-priority"
        path1.mkdir()
        skill1 = path1 / "duplicate"
        skill1.mkdir()
        (skill1 / "SKILL.md").write_text("""---
name: duplicate
description: High priority version
---
""", encoding="utf-8")
        
        path2 = temp_skills_dir / "low-priority"
        path2.mkdir()
        skill2 = path2 / "duplicate"
        skill2.mkdir()
        (skill2 / "SKILL.md").write_text("""---
name: duplicate
description: Low priority version
---
""", encoding="utf-8")
        
        # path1 在前，应该被保留
        loader = SkillBundleLoader(search_paths=[path1, path2])
        skills = loader.scan()
        
        assert len(skills) == 1
        assert skills[0].description == "High priority version"
    
    def test_loader_refresh(self, temp_skills_dir: Path):
        """测试强制重新扫描。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        
        # 第一次扫描（空）
        skills1 = loader.scan()
        assert len(skills1) == 0
        
        # 添加技能
        skill_dir = temp_skills_dir / "new-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("""---
name: new-skill
description: Newly added skill
---
""", encoding="utf-8")
        
        # 普通扫描（使用缓存）
        skills2 = loader.scan()
        assert len(skills2) == 0  # 仍然是缓存结果
        
        # 强制刷新
        skills3 = loader.refresh()
        assert len(skills3) == 1
        assert skills3[0].name == "new-skill"


# =============================================================================
# P0-3: SkillTool 测试
# =============================================================================

class TestSkillTool:
    """P0-3: SkillTool 工具封装测试。"""
    
    def test_skill_tool_list_action(self, multi_skill_dir: Path):
        """测试 list 操作返回技能清单。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="list")
        
        assert "pdf" in result
        assert "excel" in result
        assert "Total: 2 skill(s)" in result
    
    def test_skill_tool_list_empty(self, temp_skills_dir: Path):
        """测试空技能列表。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="list")
        
        assert "No skills installed" in result
    
    def test_skill_tool_read_action(
        self,
        sample_skill_dir: Path,
        temp_skills_dir: Path,
    ):
        """测试 read 操作返回完整内容。"""
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="read", skill_name="pdf-processor")
        
        assert "Reading: pdf-processor" in result
        assert "Base directory:" in result
        assert "PDF Processor Skill" in result
    
    def test_skill_tool_read_not_found(self, multi_skill_dir: Path):
        """测试 read 不存在技能的错误处理。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="read", skill_name="nonexistent")
        
        assert "Error" in result
        assert "nonexistent" in result
        assert "not found" in result.lower()
        # 应该提示可用的技能
        assert "pdf" in result or "excel" in result
    
    def test_skill_tool_read_missing_skill_name(self, multi_skill_dir: Path):
        """测试 read 操作缺少 skill_name 参数。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="read")
        
        assert "Error" in result
        assert "skill_name" in result.lower() or "required" in result.lower()
    
    def test_skill_tool_invalid_action(self, multi_skill_dir: Path):
        """测试无效操作类型。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        tool = SkillTool(loader=loader)
        
        result = tool.run(action="invalid")
        
        assert "Invalid action" in result
    
    def test_skill_tool_default_initialization(self):
        """测试默认初始化（无搜索路径）。"""
        tool = SkillTool(auto_scan=False)
        
        assert tool.name == "skill_manager"
        assert tool.loader is not None
    
    def test_skill_tool_openai_schema(self, multi_skill_dir: Path):
        """测试 OpenAI schema 生成。"""
        loader = SkillBundleLoader(search_paths=[multi_skill_dir])
        tool = SkillTool(loader=loader)
        
        schema = tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "skill_manager"
        assert "action" in schema["function"]["parameters"]["properties"]


# =============================================================================
# P1-1: DiscoveryBus 集成测试
# =============================================================================

class TestDiscoveryBusIntegration:
    """P1-1: DiscoveryBus 集成测试。"""
    
    def test_discovery_bus_integration(self, multi_skill_dir: Path):
        """测试技能发现事件发布。"""
        from agenticx.core.discovery import DiscoveryBus, DiscoveryType
        
        bus = DiscoveryBus()
        discoveries = []
        
        def handler(discovery):
            discoveries.append(discovery)
        
        bus.subscribe(handler, discovery_types=[DiscoveryType.CAPABILITY])
        
        loader = SkillBundleLoader(
            search_paths=[multi_skill_dir],
            discovery_bus=bus,
        )
        loader.scan()
        
        # 处理同步队列中的发现
        import asyncio
        asyncio.get_event_loop().run_until_complete(bus.process_pending())
        
        # 应该有 2 个技能发现事件
        assert len(discoveries) == 2
        names = {d.name for d in discoveries}
        assert "skill:pdf" in names
        assert "skill:excel" in names
    
    def test_discovery_without_bus(self, multi_skill_dir: Path):
        """测试没有 DiscoveryBus 时不报错。"""
        loader = SkillBundleLoader(
            search_paths=[multi_skill_dir],
            discovery_bus=None,
        )
        
        # 不应该抛出异常
        skills = loader.scan()
        assert len(skills) == 2


# =============================================================================
# P1-2: process_llm_request 测试
# =============================================================================

class TestProcessLlmRequest:
    """P1-2: process_llm_request 渐进式注入测试。"""
    
    @pytest.mark.asyncio
    async def test_process_llm_request_with_active_skill(
        self,
        sample_skill_dir: Path,
        temp_skills_dir: Path,
    ):
        """测试活跃技能时注入指令。"""
        from agenticx.tools.tool_context import ToolContext, LlmRequest
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        tool = SkillTool(loader=loader)
        
        context = ToolContext(
            tool_name="skill_manager",
            metadata={"active_skill": "pdf-processor"},
        )
        request = LlmRequest()
        
        await tool.process_llm_request(context, request)
        
        assert request.system_prompt is not None
        assert "skill_instructions" in request.system_prompt
        assert "pdf-processor" in request.system_prompt
    
    @pytest.mark.asyncio
    async def test_process_llm_request_no_active_skill(
        self,
        sample_skill_dir: Path,
        temp_skills_dir: Path,
    ):
        """测试无活跃技能时不注入。"""
        from agenticx.tools.tool_context import ToolContext, LlmRequest
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        tool = SkillTool(loader=loader)
        
        context = ToolContext(tool_name="skill_manager")
        request = LlmRequest()
        
        await tool.process_llm_request(context, request)
        
        assert request.system_prompt is None
    
    @pytest.mark.asyncio
    async def test_process_llm_request_skill_not_found(
        self,
        temp_skills_dir: Path,
    ):
        """测试活跃技能不存在时不注入。"""
        from agenticx.tools.tool_context import ToolContext, LlmRequest
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        tool = SkillTool(loader=loader)
        
        context = ToolContext(
            tool_name="skill_manager",
            metadata={"active_skill": "nonexistent"},
        )
        request = LlmRequest()
        
        await tool.process_llm_request(context, request)
        
        assert request.system_prompt is None
    
    @pytest.mark.asyncio
    async def test_process_llm_request_none_arguments(self):
        """测试 None 参数时不报错。"""
        tool = SkillTool(auto_scan=False)
        
        # 不应该抛出异常
        await tool.process_llm_request(None, None)


# =============================================================================
# 边界条件测试
# =============================================================================

class TestEdgeCases:
    """边界条件测试。"""
    
    def test_skill_md_with_empty_description(self, temp_skills_dir: Path):
        """测试 description 为空的 SKILL.md。"""
        skill_dir = temp_skills_dir / "no-desc"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("""---
name: no-desc
---
# Skill without description
""", encoding="utf-8")
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        skills = loader.scan()
        
        assert len(skills) == 1
        assert skills[0].name == "no-desc"
        assert skills[0].description == ""
    
    def test_skill_dir_with_hidden_directories(self, temp_skills_dir: Path):
        """测试跳过隐藏目录。"""
        # 创建隐藏目录
        hidden_dir = temp_skills_dir / ".hidden-skill"
        hidden_dir.mkdir()
        (hidden_dir / "SKILL.md").write_text("""---
name: hidden
description: Hidden skill
---
""", encoding="utf-8")
        
        # 创建正常目录
        normal_dir = temp_skills_dir / "normal-skill"
        normal_dir.mkdir()
        (normal_dir / "SKILL.md").write_text("""---
name: normal
description: Normal skill
---
""", encoding="utf-8")
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        skills = loader.scan()
        
        assert len(skills) == 1
        assert skills[0].name == "normal"
    
    def test_unicode_skill_content(self, temp_skills_dir: Path):
        """测试 Unicode 内容处理。"""
        skill_dir = temp_skills_dir / "unicode-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("""---
name: 中文技能
description: 这是一个中文描述的技能
---
# 中文技能

这是中文指令内容。
""", encoding="utf-8")
        
        loader = SkillBundleLoader(search_paths=[temp_skills_dir])
        skills = loader.scan()
        
        assert len(skills) == 1
        assert skills[0].name == "中文技能"
        assert "中文描述" in skills[0].description
        
        content = loader.get_skill_content("中文技能")
        assert "中文指令内容" in content

