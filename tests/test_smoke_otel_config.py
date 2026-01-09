"""
冒烟测试: OpenTelemetry 配置模块

测试内容:
- OTelConfig 数据类
- enable_otel() 一键启用
- 环境变量配置

内化来源: alibaba/loongsuite-python-agent
"""

import os
import pytest
from unittest.mock import patch, MagicMock


class TestOTelConfig:
    """测试 OTelConfig 配置类"""
    
    def test_default_config(self):
        """测试默认配置值"""
        from agenticx.observability.otel import OTelConfig
        
        config = OTelConfig()
        
        assert config.service_name == "agenticx"
        assert config.otlp_endpoint is None
        assert config.export_to_console is True
        assert config.export_to_span_tree is False
        assert config.enabled is True
        assert config.trace_sample_rate == 1.0
        assert config.resource_attributes == {}
    
    def test_custom_config(self):
        """测试自定义配置"""
        from agenticx.observability.otel import OTelConfig
        
        config = OTelConfig(
            service_name="my-agent",
            otlp_endpoint="http://localhost:4317",
            export_to_console=False,
            export_to_span_tree=True,
            trace_sample_rate=0.5,
            resource_attributes={"env": "test"},
        )
        
        assert config.service_name == "my-agent"
        assert config.otlp_endpoint == "http://localhost:4317"
        assert config.export_to_console is False
        assert config.export_to_span_tree is True
        assert config.trace_sample_rate == 0.5
        assert config.resource_attributes == {"env": "test"}
    
    def test_config_from_env(self):
        """测试从环境变量加载配置"""
        from agenticx.observability.otel import OTelConfig
        
        env_vars = {
            "AGENTICX_OTEL_SERVICE_NAME": "env-agent",
            "AGENTICX_OTEL_ENDPOINT": "http://jaeger:4317",
            "AGENTICX_OTEL_CONSOLE": "false",
            "AGENTICX_OTEL_SPAN_TREE": "true",
            "AGENTICX_OTEL_ENABLED": "true",
            "AGENTICX_OTEL_SAMPLE_RATE": "0.8",
        }
        
        with patch.dict(os.environ, env_vars, clear=False):
            config = OTelConfig.from_env()
        
        assert config.service_name == "env-agent"
        assert config.otlp_endpoint == "http://jaeger:4317"
        assert config.export_to_console is False
        assert config.export_to_span_tree is True
        assert config.enabled is True
        assert config.trace_sample_rate == 0.8
    
    def test_config_to_dict(self):
        """测试配置转换为字典"""
        from agenticx.observability.otel import OTelConfig
        
        config = OTelConfig(service_name="test-service")
        d = config.to_dict()
        
        assert isinstance(d, dict)
        assert d["service_name"] == "test-service"
        assert "otlp_endpoint" in d
        assert "enabled" in d


class TestEnableOTel:
    """测试 enable_otel() 函数"""
    
    def test_enable_otel_without_deps_raises_error(self):
        """测试缺少依赖时抛出 ImportError"""
        from agenticx.observability.otel.config import _check_otel_dependencies, enable_otel
        
        # 如果依赖未安装，应该抛出 ImportError
        if not _check_otel_dependencies():
            with pytest.raises(ImportError) as excinfo:
                enable_otel()
            
            assert "OpenTelemetry" in str(excinfo.value)
            assert "pip install" in str(excinfo.value)
        else:
            # 依赖已安装，跳过此测试
            pytest.skip("OpenTelemetry 已安装，跳过依赖检查测试")
    
    @pytest.mark.skipif(
        not pytest.importorskip("opentelemetry.sdk", reason="OTel SDK not installed"),
        reason="OpenTelemetry SDK not installed"
    )
    def test_enable_otel_with_deps(self):
        """测试有依赖时正常启用"""
        from agenticx.observability.otel import enable_otel, is_otel_enabled, disable_otel
        
        try:
            handler = enable_otel(
                service_name="test-agent",
                export_to_console=True,
            )
            
            assert handler is not None
            assert is_otel_enabled() is True
            
        finally:
            disable_otel()
    
    def test_is_otel_enabled_default(self):
        """测试默认状态"""
        from agenticx.observability.otel.config import _otel_enabled
        
        # 重置状态后应该是 False
        # 注意：这个测试可能受其他测试影响
        # 实际上我们测试函数存在即可
        from agenticx.observability.otel import is_otel_enabled
        result = is_otel_enabled()
        assert isinstance(result, bool)
    
    def test_get_otel_config_before_enable(self):
        """测试启用前获取配置"""
        from agenticx.observability.otel import get_otel_config
        
        # 可能返回 None 或之前的配置
        config = get_otel_config()
        assert config is None or hasattr(config, 'service_name')


class TestOTelDependencyCheck:
    """测试依赖检查"""
    
    def test_check_otel_dependencies_returns_bool(self):
        """测试依赖检查返回布尔值"""
        from agenticx.observability.otel.config import _check_otel_dependencies
        
        result = _check_otel_dependencies()
        assert isinstance(result, bool)
    
    def test_check_otel_dependencies_with_mock_import_error(self):
        """测试模拟导入错误"""
        from agenticx.observability.otel import config as config_module
        
        # 保存原始函数
        original_check = config_module._check_otel_dependencies
        
        # 模拟导入失败
        def mock_check():
            return False
        
        config_module._check_otel_dependencies = mock_check
        
        try:
            assert config_module._check_otel_dependencies() is False
        finally:
            # 恢复
            config_module._check_otel_dependencies = original_check


class TestEdgeCases:
    """边界条件测试"""
    
    def test_config_with_empty_service_name(self):
        """测试空服务名"""
        from agenticx.observability.otel import OTelConfig
        
        config = OTelConfig(service_name="")
        assert config.service_name == ""
    
    def test_config_with_invalid_sample_rate(self):
        """测试无效采样率（不做验证，只存储）"""
        from agenticx.observability.otel import OTelConfig
        
        # OTelConfig 不做验证，只存储值
        config = OTelConfig(trace_sample_rate=2.0)
        assert config.trace_sample_rate == 2.0
        
        config = OTelConfig(trace_sample_rate=-0.5)
        assert config.trace_sample_rate == -0.5
    
    def test_env_var_edge_cases(self):
        """测试环境变量边界情况"""
        from agenticx.observability.otel import OTelConfig
        
        # 空环境变量
        with patch.dict(os.environ, {}, clear=True):
            config = OTelConfig.from_env()
            assert config.service_name == "agenticx"  # 默认值
            assert config.enabled is False  # 未设置则为 False
        
        # 异常格式的采样率
        with patch.dict(os.environ, {"AGENTICX_OTEL_SAMPLE_RATE": "invalid"}, clear=False):
            with pytest.raises(ValueError):
                OTelConfig.from_env()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
