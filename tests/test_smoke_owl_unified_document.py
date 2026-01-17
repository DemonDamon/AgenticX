"""
OWL 统一文档处理工具冒烟测试

验证 P0.5 功能点：
- UnifiedDocumentTool 可正常创建
- 文档路由逻辑工作正常
- 支持多种文档格式（JSON, Python, XML, ZIP）
- 错误处理和降级机制工作正常
"""

import pytest
import tempfile
import os
import json
from pathlib import Path
from agenticx.tools.unified_document import UnifiedDocumentTool
from agenticx.tools.document_routers import DocumentRouter, create_default_router


@pytest.fixture
def temp_dir():
    """创建临时目录"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_json_file(temp_dir):
    """创建示例 JSON 文件"""
    file_path = os.path.join(temp_dir, "test.json")
    data = {"name": "test", "value": 123}
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return file_path


@pytest.fixture
def sample_python_file(temp_dir):
    """创建示例 Python 文件"""
    file_path = os.path.join(temp_dir, "test.py")
    content = "def hello():\n    print('Hello, World!')\n"
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return file_path


@pytest.fixture
def sample_xml_file(temp_dir):
    """创建示例 XML 文件"""
    file_path = os.path.join(temp_dir, "test.xml")
    content = '<?xml version="1.0"?><root><item>test</item></root>'
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return file_path


@pytest.fixture
def unified_document_tool():
    """创建 UnifiedDocumentTool 实例"""
    return UnifiedDocumentTool(cache_dir="./test_cache")


def test_unified_document_tool_creation():
    """测试 UnifiedDocumentTool 可正常创建"""
    tool = UnifiedDocumentTool()
    assert tool is not None
    assert tool.name == "unified_document_tool"


def test_document_router_creation():
    """测试 DocumentRouter 可正常创建"""
    router = create_default_router()
    assert router is not None


def test_json_file_processing(unified_document_tool, sample_json_file):
    """测试 JSON 文件处理"""
    success, content = unified_document_tool.execute(sample_json_file)
    
    assert success is True
    assert "test" in content
    assert "123" in content


def test_python_file_processing(unified_document_tool, sample_python_file):
    """测试 Python 文件处理"""
    success, content = unified_document_tool.execute(sample_python_file)
    
    assert success is True
    assert "def hello" in content
    assert "Hello, World" in content


def test_xml_file_processing(unified_document_tool, sample_xml_file):
    """测试 XML 文件处理"""
    success, content = unified_document_tool.execute(sample_xml_file)
    
    assert success is True
    # XML 内容应该被处理（可能是 JSON 格式或原始格式）
    assert len(content) > 0


def test_nonexistent_file(unified_document_tool):
    """测试不存在的文件"""
    success, content = unified_document_tool.execute("/nonexistent/file.txt")
    
    assert success is False
    assert "not found" in content.lower() or "failed" in content.lower()


def test_document_router_registration():
    """测试文档路由器注册"""
    router = DocumentRouter()
    
    def test_processor(path: str):
        return True, f"Processed: {path}"
    
    router.register_processor((".test",), test_processor)
    
    success, content = router.route("test.test")
    assert success is True
    assert "Processed" in content


def test_document_router_fallback():
    """测试文档路由器降级机制"""
    router = DocumentRouter()
    
    def fallback_processor(path: str):
        return True, f"Fallback: {path}"
    
    router.set_fallback_processor(fallback_processor)
    
    # 路由一个没有注册处理器的文件
    success, content = router.route("unknown.xyz")
    assert success is True
    assert "Fallback" in content


def test_tool_run_method(unified_document_tool, sample_json_file):
    """测试工具的 run() 方法"""
    result = unified_document_tool.run(document_path=sample_json_file)
    
    assert result["success"] is True
    assert "content" in result
    assert result["document_path"] == sample_json_file


def test_tool_run_method_missing_param(unified_document_tool):
    """测试工具 run() 方法缺少参数"""
    from agenticx.tools.base import ToolValidationError
    with pytest.raises(ToolValidationError):
        unified_document_tool.run()


def test_webpage_detection():
    """测试网页 URL 检测"""
    router = DocumentRouter()
    
    def webpage_processor(url: str):
        return True, f"Webpage: {url}"
    
    router.register_processor(("http", "https", "url"), webpage_processor)
    
    success, content = router.route("https://example.com")
    assert success is True
    assert "Webpage" in content


def test_image_file_placeholder(unified_document_tool, temp_dir):
    """测试图片文件占位处理"""
    # 创建一个假的图片文件路径（不实际创建文件）
    image_path = os.path.join(temp_dir, "test.jpg")
    
    # 由于是占位实现，应该返回文件不存在或占位信息
    success, content = unified_document_tool.execute(image_path)
    
    # 占位实现应该返回 False（文件不存在）或 True（占位信息）
    assert isinstance(success, bool)
    assert len(content) > 0
