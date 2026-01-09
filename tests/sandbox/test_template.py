"""
Tests for agenticx.sandbox.template module
"""

import pytest
import tempfile
from pathlib import Path

from agenticx.sandbox.template import (
    SandboxTemplate,
    DEFAULT_CODE_INTERPRETER_TEMPLATE,
    LIGHTWEIGHT_TEMPLATE,
    HIGH_PERFORMANCE_TEMPLATE,
)
from agenticx.sandbox.types import SandboxType


class TestSandboxTemplate:
    """SandboxTemplate 数据类测试"""
    
    def test_default_values(self):
        template = SandboxTemplate(name="test")
        assert template.name == "test"
        assert template.type == SandboxType.CODE_INTERPRETER
        assert template.cpu == 1.0
        assert template.memory_mb == 2048
        assert template.disk_mb == 10240
        assert template.timeout_seconds == 300
        assert template.idle_timeout_seconds == 600
        assert template.startup_timeout_seconds == 60
        assert template.backend == "auto"
        assert template.network_enabled is False
    
    def test_custom_values(self):
        template = SandboxTemplate(
            name="custom",
            type=SandboxType.BROWSER,
            cpu=2.0,
            memory_mb=4096,
            timeout_seconds=600,
            network_enabled=True,
        )
        assert template.type == SandboxType.BROWSER
        assert template.cpu == 2.0
        assert template.memory_mb == 4096
        assert template.network_enabled is True
    
    def test_validation_valid(self):
        template = SandboxTemplate(
            name="valid",
            cpu=1.0,
            memory_mb=1024,
            timeout_seconds=60,
        )
        errors = template.validate()
        assert errors == []
    
    def test_validation_invalid_cpu(self):
        template = SandboxTemplate(name="invalid", cpu=-1.0)
        errors = template.validate()
        assert any("cpu" in e.lower() for e in errors)
    
    def test_validation_invalid_memory(self):
        template = SandboxTemplate(name="invalid", memory_mb=0)
        errors = template.validate()
        assert any("memory" in e.lower() for e in errors)
    
    def test_validation_invalid_timeout(self):
        template = SandboxTemplate(name="invalid", timeout_seconds=-10)
        errors = template.validate()
        assert any("timeout" in e.lower() for e in errors)


class TestTemplateSerialization:
    """模板序列化测试"""
    
    def test_to_dict(self):
        template = SandboxTemplate(
            name="test",
            cpu=2.0,
            tags=["dev", "test"],
        )
        data = template.to_dict()
        assert data["name"] == "test"
        assert data["cpu"] == 2.0
        assert "dev" in data["tags"]
    
    def test_from_dict(self):
        data = {
            "name": "from_dict",
            "type": "code_interpreter",
            "cpu": 1.5,
            "memory_mb": 2048,
            "environment": {"DEBUG": "1"},
        }
        template = SandboxTemplate.from_dict(data)
        assert template.name == "from_dict"
        assert template.cpu == 1.5
        assert template.environment["DEBUG"] == "1"
    
    def test_save_and_load_yaml(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            template = SandboxTemplate(
                name="yaml_test",
                cpu=1.5,
                memory_mb=2048,
            )
            
            # 保存
            path = template.save(config_dir=Path(tmpdir))
            assert path.exists()
            assert path.suffix == ".yaml"
            
            # 加载
            loaded = SandboxTemplate.load("yaml_test", config_dir=Path(tmpdir))
            assert loaded.name == "yaml_test"
            assert loaded.cpu == 1.5
            assert loaded.memory_mb == 2048
    
    def test_save_multiple_templates(self):
        """测试保存和列出多个模板"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 保存多个模板
            for i in range(3):
                template = SandboxTemplate(name=f"template_{i}")
                template.save(config_dir=Path(tmpdir))
            
            # 列出模板
            templates = SandboxTemplate.list_templates(config_dir=Path(tmpdir))
            assert len(templates) == 3


class TestPredefinedTemplates:
    """预定义模板测试"""
    
    def test_default_template(self):
        assert DEFAULT_CODE_INTERPRETER_TEMPLATE.name == "default-code-interpreter"
        assert DEFAULT_CODE_INTERPRETER_TEMPLATE.type == SandboxType.CODE_INTERPRETER
        errors = DEFAULT_CODE_INTERPRETER_TEMPLATE.validate()
        assert errors == []
    
    def test_lightweight_template(self):
        assert LIGHTWEIGHT_TEMPLATE.name == "lightweight"
        assert LIGHTWEIGHT_TEMPLATE.cpu == 0.5
        assert LIGHTWEIGHT_TEMPLATE.memory_mb < DEFAULT_CODE_INTERPRETER_TEMPLATE.memory_mb
        errors = LIGHTWEIGHT_TEMPLATE.validate()
        assert errors == []
    
    def test_high_performance_template(self):
        assert HIGH_PERFORMANCE_TEMPLATE.name == "high-performance"
        assert HIGH_PERFORMANCE_TEMPLATE.cpu > DEFAULT_CODE_INTERPRETER_TEMPLATE.cpu
        assert HIGH_PERFORMANCE_TEMPLATE.memory_mb > DEFAULT_CODE_INTERPRETER_TEMPLATE.memory_mb
        errors = HIGH_PERFORMANCE_TEMPLATE.validate()
        assert errors == []
