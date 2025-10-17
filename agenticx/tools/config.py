"""
AgenticX × MinerU 配置管理模块

提供统一的配置管理功能，支持环境变量、配置文件和运行时配置。
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Union, List
from dataclasses import dataclass, field
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)


class MinerUConfig(BaseModel):
    """MinerU 配置管理"""
    
    # API 配置
    api_key: Optional[str] = Field(default=None, description="MinerU API 密钥")
    base_url: str = Field(default="https://api.mineru.com", description="MinerU API 基础 URL")
    timeout: float = Field(default=300.0, description="请求超时时间（秒）")
    max_retries: int = Field(default=3, description="最大重试次数")
    retry_delay: float = Field(default=1.0, description="重试延迟（秒）")
    
    # 本地配置
    local_backend: str = Field(default="pipeline", description="本地后端类型: pipeline, vlm_http")
    local_config_path: Optional[str] = Field(default=None, description="本地配置文件路径")
    device: str = Field(default="auto", description="计算设备: auto, cpu, cuda, mps")
    vram_size: int = Field(default=16, description="显存大小 (GB)")
    model_path: Optional[str] = Field(default=None, description="模型路径")
    
    # 解析配置
    default_output_format: str = Field(default="markdown", description="默认输出格式")
    default_parse_method: str = Field(default="auto", description="默认解析方法")
    default_ocr_languages: List[str] = Field(default=["en", "zh"], description="默认 OCR 语言")
    
    # 文件处理配置
    max_file_size: int = Field(default=100 * 1024 * 1024, description="最大文件大小 (bytes)")
    supported_formats: List[str] = Field(
        default=["pdf", "png", "jpg", "jpeg", "bmp", "tiff"],
        description="支持的文件格式"
    )
    
    # 回调配置
    callback_timeout: float = Field(default=30.0, description="回调超时时间（秒）")
    callback_retries: int = Field(default=2, description="回调重试次数")
    
    # 存储配置
    temp_dir: Optional[str] = Field(default=None, description="临时目录")
    output_dir: Optional[str] = Field(default=None, description="输出目录")
    cleanup_temp: bool = Field(default=True, description="是否清理临时文件")
    
    @field_validator('api_key')
    @classmethod
    def validate_api_key(cls, v):
        """验证 API 密钥格式"""
        if v and not v.startswith(('sk-', 'pk-', 'ak-')):
            logger.warning("API key format may be invalid")
        return v
    
    @field_validator('base_url')
    @classmethod
    def validate_base_url(cls, v):
        """验证基础 URL 格式"""
        if not v.startswith(('http://', 'https://')):
            raise ValueError("base_url must start with http:// or https://")
        return v.rstrip('/')
    
    @field_validator('supported_formats')
    @classmethod
    def validate_formats(cls, v):
        """验证支持的格式"""
        return [fmt.lower().lstrip('.') for fmt in v]
    
    @classmethod
    def from_env(cls, prefix: str = "MINERU_") -> "MinerUConfig":
        """从环境变量创建配置"""
        env_mapping = {
            "api_key": f"{prefix}API_KEY",
            "base_url": f"{prefix}BASE_URL",
            "timeout": f"{prefix}TIMEOUT",
            "max_retries": f"{prefix}MAX_RETRIES",
            "retry_delay": f"{prefix}RETRY_DELAY",
            "local_backend": f"{prefix}LOCAL_BACKEND",
            "local_config_path": f"{prefix}LOCAL_CONFIG_PATH",
            "device": f"{prefix}DEVICE",
            "vram_size": f"{prefix}VRAM_SIZE",
            "model_path": f"{prefix}MODEL_PATH",
            "default_output_format": f"{prefix}OUTPUT_FORMAT",
            "default_parse_method": f"{prefix}PARSE_METHOD",
            "max_file_size": f"{prefix}MAX_FILE_SIZE",
            "callback_timeout": f"{prefix}CALLBACK_TIMEOUT",
            "callback_retries": f"{prefix}CALLBACK_RETRIES",
            "temp_dir": f"{prefix}TEMP_DIR",
            "output_dir": f"{prefix}OUTPUT_DIR",
            "cleanup_temp": f"{prefix}CLEANUP_TEMP",
        }
        
        config_data = {}
        for field_name, env_var in env_mapping.items():
            value = os.getenv(env_var)
            if value is not None:
                # 类型转换
                if field_name in ["timeout", "retry_delay", "callback_timeout"]:
                    config_data[field_name] = float(value)
                elif field_name in ["max_retries", "vram_size", "max_file_size", "callback_retries"]:
                    config_data[field_name] = int(value)
                elif field_name == "cleanup_temp":
                    config_data[field_name] = value.lower() in ("true", "1", "yes", "on")
                elif field_name == "default_ocr_languages":
                    config_data[field_name] = [lang.strip() for lang in value.split(",")]
                elif field_name == "supported_formats":
                    config_data[field_name] = [fmt.strip() for fmt in value.split(",")]
                else:
                    config_data[field_name] = value
        
        # 处理 OCR 语言列表
        ocr_languages_env = os.getenv(f"{prefix}OCR_LANGUAGES")
        if ocr_languages_env:
            config_data["default_ocr_languages"] = [lang.strip() for lang in ocr_languages_env.split(",")]
        
        return cls(**config_data)
    
    @classmethod
    def from_file(cls, config_path: Union[str, Path]) -> "MinerUConfig":
        """从配置文件创建配置"""
        config_path = Path(config_path).expanduser()
        
        if not config_path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")
        
        with open(config_path, 'r', encoding='utf-8') as f:
            if config_path.suffix.lower() == '.json':
                config_data = json.load(f)
            else:
                raise ValueError(f"Unsupported config file format: {config_path.suffix}")
        
        return cls(**config_data)
    
    @classmethod
    def from_dict(cls, config_dict: Dict[str, Any]) -> "MinerUConfig":
        """从字典创建配置"""
        return cls(**config_dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return self.model_dump()
    
    def to_file(self, config_path: Union[str, Path]) -> None:
        """保存到配置文件"""
        config_path = Path(config_path).expanduser()
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(self.model_dump(), f, indent=2, ensure_ascii=False)
        
        logger.info(f"Configuration saved to: {config_path}")
    
    def validate_config(self) -> None:
        """验证配置有效性"""
        errors = []
        
        # 验证 API 配置
        if not self.api_key:
            errors.append("API key is required for remote operations")
        
        # 验证本地配置
        if self.local_backend not in ["pipeline", "vlm_http"]:
            errors.append(f"Invalid local_backend: {self.local_backend}")
        
        if self.device not in ["auto", "cpu", "cuda", "mps"]:
            errors.append(f"Invalid device: {self.device}")
        
        # 验证文件大小
        if self.max_file_size <= 0:
            errors.append("max_file_size must be positive")
        
        # 验证超时设置
        if self.timeout <= 0:
            errors.append("timeout must be positive")
        
        if errors:
            raise ValueError(f"Configuration validation failed: {'; '.join(errors)}")
    
    def get_temp_dir(self) -> Path:
        """获取临时目录"""
        if self.temp_dir:
            temp_path = Path(self.temp_dir).expanduser()
        else:
            temp_path = Path.home() / ".agenticx" / "temp"
        
        temp_path.mkdir(parents=True, exist_ok=True)
        return temp_path
    
    def get_output_dir(self) -> Path:
        """获取输出目录"""
        if self.output_dir:
            output_path = Path(self.output_dir).expanduser()
        else:
            output_path = Path.home() / ".agenticx" / "output"
        
        output_path.mkdir(parents=True, exist_ok=True)
        return output_path
    
    def is_file_supported(self, file_path: Union[str, Path]) -> bool:
        """检查文件是否支持"""
        file_path = Path(file_path)
        file_ext = file_path.suffix.lower().lstrip('.')
        return file_ext in self.supported_formats
    
    def check_file_size(self, file_path: Union[str, Path]) -> bool:
        """检查文件大小是否符合限制"""
        file_path = Path(file_path)
        if not file_path.exists():
            return False
        return file_path.stat().st_size <= self.max_file_size


@dataclass
class ConfigManager:
    """配置管理器"""
    
    _instance: Optional['ConfigManager'] = field(default=None, init=False)
    _config: Optional[MinerUConfig] = field(default=None, init=False)
    
    def __new__(cls):
        """单例模式"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def load_config(
        self, 
        config_path: Optional[Union[str, Path]] = None,
        env_prefix: str = "MINERU_",
        force_reload: bool = False
    ) -> MinerUConfig:
        """加载配置
        
        Args:
            config_path: 配置文件路径，如果为 None 则从环境变量加载
            env_prefix: 环境变量前缀
            force_reload: 是否强制重新加载
        
        Returns:
            MinerUConfig: 配置对象
        """
        if self._config is not None and not force_reload:
            return self._config
        
        try:
            if config_path:
                # 从文件加载
                config_path = Path(config_path).expanduser()
                if config_path.exists():
                    logger.info(f"Loading config from file: {config_path}")
                    self._config = MinerUConfig.from_file(config_path)
                else:
                    logger.warning(f"Config file not found: {config_path}, falling back to environment variables")
                    self._config = MinerUConfig.from_env(env_prefix)
            else:
                # 从环境变量加载
                logger.info("Loading config from environment variables")
                self._config = MinerUConfig.from_env(env_prefix)
            
            # 验证配置
            self._config.validate_config()
            logger.info("Configuration loaded and validated successfully")
            
        except Exception as e:
            logger.error(f"Failed to load configuration: {e}")
            # 使用默认配置
            logger.info("Using default configuration")
            self._config = MinerUConfig()
        
        return self._config
    
    def get_config(self) -> Optional[MinerUConfig]:
        """获取当前配置"""
        return self._config
    
    def update_config(self, **kwargs) -> MinerUConfig:
        """更新配置"""
        if self._config is None:
            self._config = MinerUConfig()
        
        # 更新字段
        for key, value in kwargs.items():
            if hasattr(self._config, key):
                setattr(self._config, key, value)
            else:
                logger.warning(f"Unknown config field: {key}")
        
        # 重新验证
        self._config.validate_config()
        return self._config
    
    def save_config(self, config_path: Union[str, Path]) -> None:
        """保存配置到文件"""
        if self._config is None:
            raise ValueError("No configuration to save")
        
        self._config.to_file(config_path)
    
    def reset_config(self) -> None:
        """重置配置"""
        self._config = None


# 全局配置管理器实例
config_manager = ConfigManager()


def get_config(
    config_path: Optional[Union[str, Path]] = None,
    env_prefix: str = "MINERU_",
    force_reload: bool = False
) -> MinerUConfig:
    """获取配置的便捷函数"""
    return config_manager.load_config(config_path, env_prefix, force_reload)


def update_config(**kwargs) -> MinerUConfig:
    """更新配置的便捷函数"""
    return config_manager.update_config(**kwargs)


def save_config(config_path: Union[str, Path]) -> None:
    """保存配置的便捷函数"""
    config_manager.save_config(config_path)


# ==================== 配置模板 ====================

def create_default_config_file(config_path: Union[str, Path]) -> None:
    """创建默认配置文件"""
    config = MinerUConfig()
    config.to_file(config_path)
    logger.info(f"Default configuration file created: {config_path}")


def create_example_config() -> Dict[str, Any]:
    """创建示例配置"""
    return {
        "api_key": "sk-your-api-key-here",
        "base_url": "https://api.mineru.com",
        "timeout": 300.0,
        "max_retries": 3,
        "retry_delay": 1.0,
        "local_backend": "pipeline",
        "device": "auto",
        "vram_size": 16,
        "default_output_format": "markdown",
        "default_parse_method": "auto",
        "default_ocr_languages": ["en", "zh"],
        "max_file_size": 104857600,  # 100MB
        "supported_formats": ["pdf", "png", "jpg", "jpeg", "bmp", "tiff"],
        "callback_timeout": 30.0,
        "callback_retries": 2,
        "cleanup_temp": True
    }


# ==================== 环境变量帮助 ====================

def print_env_help() -> None:
    """打印环境变量帮助信息"""
    help_text = """
MinerU Configuration Environment Variables:

API Configuration:
  MINERU_API_KEY          - MinerU API key (required for remote operations)
  MINERU_BASE_URL         - MinerU API base URL (default: https://api.mineru.com)
  MINERU_TIMEOUT          - Request timeout in seconds (default: 300.0)
  MINERU_MAX_RETRIES      - Maximum retry attempts (default: 3)
  MINERU_RETRY_DELAY      - Retry delay in seconds (default: 1.0)

Local Configuration:
  MINERU_LOCAL_BACKEND    - Local backend type: pipeline, vlm_http (default: pipeline)
  MINERU_LOCAL_CONFIG_PATH - Local config file path
  MINERU_DEVICE           - Compute device: auto, cpu, cuda, mps (default: auto)
  MINERU_VRAM_SIZE        - VRAM size in GB (default: 16)
  MINERU_MODEL_PATH       - Model path for local processing

Parsing Configuration:
  MINERU_OUTPUT_FORMAT    - Default output format (default: markdown)
  MINERU_PARSE_METHOD     - Default parse method (default: auto)
  MINERU_OCR_LANGUAGES    - Default OCR languages, comma-separated (default: en,zh)

File Processing:
  MINERU_MAX_FILE_SIZE    - Maximum file size in bytes (default: 104857600)
  MINERU_SUPPORTED_FORMATS - Supported file formats, comma-separated

Callback Configuration:
  MINERU_CALLBACK_TIMEOUT - Callback timeout in seconds (default: 30.0)
  MINERU_CALLBACK_RETRIES - Callback retry attempts (default: 2)

Storage Configuration:
  MINERU_TEMP_DIR         - Temporary directory path
  MINERU_OUTPUT_DIR       - Output directory path
  MINERU_CLEANUP_TEMP     - Cleanup temporary files: true/false (default: true)

Example:
  export MINERU_API_KEY="sk-your-api-key-here"
  export MINERU_DEVICE="cuda"
  export MINERU_OCR_LANGUAGES="en,zh,ja"
    """
    print(help_text)


if __name__ == "__main__":
    # 示例用法
    print("MinerU Configuration Management")
    print("=" * 40)
    
    # 创建示例配置
    example_config = create_example_config()
    print("Example configuration:")
    print(json.dumps(example_config, indent=2))
    
    print("\n" + "=" * 40)
    print_env_help()