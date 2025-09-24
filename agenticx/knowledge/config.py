"""Configuration management for AgenticX Knowledge Management System

This module provides comprehensive configuration management for document processing,
including validation, serialization, and environment-based configuration loading.
"""

import json
import logging
import os
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Type, get_type_hints
import yaml
from .graphers.config import GrapherConfig

logger = logging.getLogger(__name__)


class ConfigurationError(Exception):
    """Exception raised for configuration-related errors"""
    pass


class ConfigFormat(Enum):
    """Supported configuration file formats"""
    JSON = "json"
    YAML = "yaml"
    ENV = "env"


@dataclass
class ProcessingOptions:
    """Processing options configuration with validation"""
    language: Optional[str] = None
    precision_mode: str = "balanced"  # "fast", "balanced", "accurate"
    speed_mode: str = "normal"        # "fast", "normal", "thorough"
    extract_images: bool = False
    extract_tables: bool = True
    extract_metadata: bool = True
    preserve_formatting: bool = False
    ocr_enabled: bool = False
    layout_analysis: bool = False
    formula_recognition: bool = False
    
    def __post_init__(self):
        """Validate configuration after initialization"""
        self.validate()
    
    def validate(self):
        """Validate configuration values"""
        valid_precision_modes = ["fast", "balanced", "accurate"]
        if self.precision_mode not in valid_precision_modes:
            raise ConfigurationError(f"Invalid precision_mode: {self.precision_mode}. Must be one of {valid_precision_modes}")
        
        valid_speed_modes = ["fast", "normal", "thorough"]
        if self.speed_mode not in valid_speed_modes:
            raise ConfigurationError(f"Invalid speed_mode: {self.speed_mode}. Must be one of {valid_speed_modes}")
        
        if self.language and len(self.language) > 10:
            raise ConfigurationError(f"Language code too long: {self.language}")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProcessingOptions':
        """Create from dictionary"""
        # Filter out unknown keys
        valid_keys = set(field.name for field in cls.__dataclass_fields__.values())
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)


@dataclass
class BackendConfig:
    """Backend-specific configuration with validation"""
    model_path: Optional[str] = None
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    timeout: int = 300
    max_retries: int = 3
    batch_size: int = 10
    custom_params: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate configuration after initialization"""
        self.validate()
    
    def validate(self):
        """Validate configuration values"""
        if self.timeout <= 0:
            raise ConfigurationError(f"Timeout must be positive: {self.timeout}")
        
        if self.max_retries < 0:
            raise ConfigurationError(f"Max retries cannot be negative: {self.max_retries}")
        
        if self.batch_size <= 0:
            raise ConfigurationError(f"Batch size must be positive: {self.batch_size}")
        
        if self.model_path and not Path(self.model_path).exists():
            logger.warning(f"Model path does not exist: {self.model_path}")
        
        if self.endpoint and not (self.endpoint.startswith('http://') or self.endpoint.startswith('https://')):
            raise ConfigurationError(f"Invalid endpoint URL: {self.endpoint}")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'BackendConfig':
        """Create from dictionary"""
        valid_keys = set(field.name for field in cls.__dataclass_fields__.values())
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)


@dataclass
class FeatureFlags:
    """Feature flags for processing capabilities"""
    ocr_enabled: bool = False
    layout_analysis_enabled: bool = False
    formula_recognition_enabled: bool = False
    table_extraction_enabled: bool = True
    image_extraction_enabled: bool = False
    metadata_extraction_enabled: bool = True
    experimental_features_enabled: bool = False
    debug_mode: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'FeatureFlags':
        """Create from dictionary"""
        valid_keys = set(field.name for field in cls.__dataclass_fields__.values())
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)
    
    def enable_all(self):
        """Enable all features"""
        for field_name in self.__dataclass_fields__:
            setattr(self, field_name, True)
    
    def disable_all(self):
        """Disable all features"""
        for field_name in self.__dataclass_fields__:
            setattr(self, field_name, False)


@dataclass
class ReaderConfig:
    """Configuration for document readers"""
    default_encoding: str = "utf-8"
    auto_detect_encoding: bool = True
    chunk_size: int = 8192
    max_file_size: int = 100 * 1024 * 1024  # 100MB
    supported_formats: List[str] = field(default_factory=lambda: [
        'txt', 'md', 'pdf', 'html', 'json', 'csv', 'xml'
    ])
    reader_specific: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate configuration after initialization"""
        self.validate()
    
    def validate(self):
        """Validate configuration values"""
        if self.chunk_size <= 0:
            raise ConfigurationError(f"Chunk size must be positive: {self.chunk_size}")
        
        if self.max_file_size <= 0:
            raise ConfigurationError(f"Max file size must be positive: {self.max_file_size}")
        
        if not self.supported_formats:
            raise ConfigurationError("At least one supported format must be specified")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ReaderConfig':
        """Create from dictionary"""
        valid_keys = set(field.name for field in cls.__dataclass_fields__.values())
        filtered_data = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered_data)





@dataclass
class ProcessingConfiguration:
    """Complete processing configuration with validation and management"""
    options: ProcessingOptions = field(default_factory=ProcessingOptions)
    backend_config: BackendConfig = field(default_factory=BackendConfig)
    features: FeatureFlags = field(default_factory=FeatureFlags)
    reader_config: ReaderConfig = field(default_factory=ReaderConfig)
    grapher: GrapherConfig = field(default_factory=GrapherConfig)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Validate configuration after initialization"""
        self.validate()
    
    def validate(self):
        """Validate entire configuration"""
        try:
            self.options.validate()
            self.backend_config.validate()
            self.reader_config.validate()
        except Exception as e:
            raise ConfigurationError(f"Configuration validation failed: {e}")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'options': self.options.to_dict(),
            'backend_config': self.backend_config.to_dict(),
            'features': self.features.to_dict(),
            'reader_config': self.reader_config.to_dict(),
            'grapher': self.grapher.to_dict(),
            'metadata': self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProcessingConfiguration':
        """Create from dictionary"""
        return cls(
            options=ProcessingOptions.from_dict(data.get('options', {})),
            backend_config=BackendConfig.from_dict(data.get('backend_config', {})),
            features=FeatureFlags.from_dict(data.get('features', {})),
            reader_config=ReaderConfig.from_dict(data.get('reader_config', {})),
            grapher=GrapherConfig.from_dict(data.get('grapher', {})),
            metadata=data.get('metadata', {})
        )
    
    def save(self, file_path: Union[str, Path], format: ConfigFormat = ConfigFormat.JSON):
        """Save configuration to file
        
        Args:
            file_path: Path to save configuration
            format: File format to use
        """
        file_path = Path(file_path)
        data = self.to_dict()
        
        try:
            if format == ConfigFormat.JSON:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            
            elif format == ConfigFormat.YAML:
                with open(file_path, 'w', encoding='utf-8') as f:
                    yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            
            else:
                raise ConfigurationError(f"Unsupported format for saving: {format}")
            
            logger.info(f"Configuration saved to {file_path}")
            
        except Exception as e:
            raise ConfigurationError(f"Failed to save configuration: {e}")
    
    @classmethod
    def load(cls, file_path: Union[str, Path], format: Optional[ConfigFormat] = None) -> 'ProcessingConfiguration':
        """Load configuration from file
        
        Args:
            file_path: Path to configuration file
            format: File format (auto-detect if None)
            
        Returns:
            Loaded configuration
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            raise ConfigurationError(f"Configuration file not found: {file_path}")
        
        # Auto-detect format if not specified
        if format is None:
            extension = file_path.suffix.lower()
            if extension == '.json':
                format = ConfigFormat.JSON
            elif extension in ['.yaml', '.yml']:
                format = ConfigFormat.YAML
            else:
                raise ConfigurationError(f"Cannot auto-detect format for {file_path}")
        
        try:
            if format == ConfigFormat.JSON:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            
            elif format == ConfigFormat.YAML:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = yaml.safe_load(f)
            
            else:
                raise ConfigurationError(f"Unsupported format for loading: {format}")
            
            config = cls.from_dict(data)
            logger.info(f"Configuration loaded from {file_path}")
            return config
            
        except Exception as e:
            raise ConfigurationError(f"Failed to load configuration: {e}")
    
    @classmethod
    def from_env(cls, prefix: str = "AGENTICX_") -> 'ProcessingConfiguration':
        """Create configuration from environment variables
        
        Args:
            prefix: Environment variable prefix
            
        Returns:
            Configuration created from environment variables
        """
        config_data = {}
        
        # Map environment variables to configuration structure
        env_mapping = {
            f"{prefix}LANGUAGE": ("options", "language"),
            f"{prefix}PRECISION_MODE": ("options", "precision_mode"),
            f"{prefix}SPEED_MODE": ("options", "speed_mode"),
            f"{prefix}EXTRACT_IMAGES": ("options", "extract_images"),
            f"{prefix}EXTRACT_TABLES": ("options", "extract_tables"),
            f"{prefix}OCR_ENABLED": ("features", "ocr_enabled"),
            f"{prefix}LAYOUT_ANALYSIS": ("features", "layout_analysis_enabled"),
            f"{prefix}API_KEY": ("backend_config", "api_key"),
            f"{prefix}ENDPOINT": ("backend_config", "endpoint"),
            f"{prefix}TIMEOUT": ("backend_config", "timeout"),
            f"{prefix}MAX_RETRIES": ("backend_config", "max_retries"),
            f"{prefix}BATCH_SIZE": ("backend_config", "batch_size"),
            f"{prefix}DEBUG_MODE": ("features", "debug_mode"),
        }
        
        for env_var, (section, key) in env_mapping.items():
            value = os.getenv(env_var)
            if value is not None:
                if section not in config_data:
                    config_data[section] = {}
                
                # Type conversion
                if key in ["extract_images", "extract_tables", "ocr_enabled", "layout_analysis_enabled", "debug_mode"]:
                    config_data[section][key] = value.lower() in ["true", "1", "yes", "on"]
                elif key in ["timeout", "max_retries", "batch_size"]:
                    config_data[section][key] = int(value)
                else:
                    config_data[section][key] = value
        
        return cls.from_dict(config_data)
    
    def merge(self, other: 'ProcessingConfiguration') -> 'ProcessingConfiguration':
        """Merge with another configuration
        
        Args:
            other: Configuration to merge with
            
        Returns:
            New merged configuration
        """
        merged_data = self.to_dict()
        other_data = other.to_dict()
        
        # Deep merge dictionaries
        def deep_merge(dict1: Dict, dict2: Dict) -> Dict:
            result = dict1.copy()
            for key, value in dict2.items():
                if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                    result[key] = deep_merge(result[key], value)
                else:
                    result[key] = value
            return result
        
        merged_data = deep_merge(merged_data, other_data)
        return ProcessingConfiguration.from_dict(merged_data)
    
    def copy(self) -> 'ProcessingConfiguration':
        """Create a copy of the configuration"""
        return ProcessingConfiguration.from_dict(self.to_dict())
    
    def get_reader_config(self, reader_type: str) -> Dict[str, Any]:
        """Get configuration for specific reader type
        
        Args:
            reader_type: Type of reader (e.g., 'pdf', 'json', 'csv')
            
        Returns:
            Reader-specific configuration
        """
        base_config = {
            'encoding': self.reader_config.default_encoding,
            'auto_detect_encoding': self.reader_config.auto_detect_encoding,
            'chunk_size': self.reader_config.chunk_size,
            'max_file_size': self.reader_config.max_file_size
        }
        
        # Add reader-specific configuration
        if reader_type in self.reader_config.reader_specific:
            base_config.update(self.reader_config.reader_specific[reader_type])
        
        return base_config
    
    def set_reader_config(self, reader_type: str, config: Dict[str, Any]):
        """Set configuration for specific reader type
        
        Args:
            reader_type: Type of reader
            config: Configuration to set
        """
        self.reader_config.reader_specific[reader_type] = config
    
    def __str__(self) -> str:
        return f"ProcessingConfiguration(precision={self.options.precision_mode}, speed={self.options.speed_mode})"


class ConfigurationManager:
    """Manager for processing configurations with profiles and defaults"""
    
    def __init__(self, config_dir: Optional[Union[str, Path]] = None):
        """Initialize configuration manager
        
        Args:
            config_dir: Directory for configuration files
        """
        self.config_dir = Path(config_dir) if config_dir else Path.home() / '.agenticx'
        self.config_dir.mkdir(exist_ok=True)
        
        self.profiles: Dict[str, ProcessingConfiguration] = {}
        self.default_profile = "default"
        
        # Load existing profiles
        self._load_profiles()
    
    def _load_profiles(self):
        """Load all configuration profiles from config directory"""
        for config_file in self.config_dir.glob("*.json"):
            try:
                profile_name = config_file.stem
                config = ProcessingConfiguration.load(config_file)
                self.profiles[profile_name] = config
                logger.debug(f"Loaded profile: {profile_name}")
            except Exception as e:
                logger.warning(f"Failed to load profile {config_file}: {e}")
    
    def get_profile(self, name: str) -> ProcessingConfiguration:
        """Get configuration profile by name
        
        Args:
            name: Profile name
            
        Returns:
            Configuration profile
        """
        if name not in self.profiles:
            if name == self.default_profile:
                # Create default profile
                self.profiles[name] = ProcessingConfiguration()
                self.save_profile(name, self.profiles[name])
            else:
                raise ConfigurationError(f"Profile not found: {name}")
        
        return self.profiles[name].copy()
    
    def save_profile(self, name: str, config: ProcessingConfiguration):
        """Save configuration profile
        
        Args:
            name: Profile name
            config: Configuration to save
        """
        config_file = self.config_dir / f"{name}.json"
        config.save(config_file)
        self.profiles[name] = config.copy()
        logger.info(f"Saved profile: {name}")
    
    def delete_profile(self, name: str):
        """Delete configuration profile
        
        Args:
            name: Profile name to delete
        """
        if name == self.default_profile:
            raise ConfigurationError("Cannot delete default profile")
        
        config_file = self.config_dir / f"{name}.json"
        if config_file.exists():
            config_file.unlink()
        
        if name in self.profiles:
            del self.profiles[name]
        
        logger.info(f"Deleted profile: {name}")
    
    def list_profiles(self) -> List[str]:
        """List all available profiles
        
        Returns:
            List of profile names
        """
        return list(self.profiles.keys())
    
    def create_profile(self, name: str, base_profile: Optional[str] = None) -> ProcessingConfiguration:
        """Create new configuration profile
        
        Args:
            name: New profile name
            base_profile: Base profile to copy from
            
        Returns:
            New configuration profile
        """
        if base_profile:
            base_config = self.get_profile(base_profile)
            new_config = base_config.copy()
        else:
            new_config = ProcessingConfiguration()
        
        self.save_profile(name, new_config)
        return new_config
    
    def get_default(self) -> ProcessingConfiguration:
        """Get default configuration
        
        Returns:
            Default configuration
        """
        return self.get_profile(self.default_profile)