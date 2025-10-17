"""
文档适配器基类和数据模型
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


class ParsedArtifacts(BaseModel):
    """解析后的工件集合"""
    
    # 基础信息
    task_id: str = Field(..., description="任务ID")
    source_file: Path = Field(..., description="源文件路径")
    output_dir: Path = Field(..., description="输出目录")
    
    # 核心输出文件
    markdown_file: Optional[Path] = Field(None, description="Markdown文件路径")
    model_json: Optional[Path] = Field(None, description="模型JSON文件路径")
    middle_json: Optional[Path] = Field(None, description="中间JSON文件路径")
    content_list_json: Optional[Path] = Field(None, description="内容列表JSON文件路径")
    
    # 调试文件（可选）
    layout_pdf: Optional[Path] = Field(None, description="布局调试PDF文件路径")
    spans_pdf: Optional[Path] = Field(None, description="文本块调试PDF文件路径")
    
    # 元数据
    page_count: Optional[int] = Field(None, description="页面总数")
    processing_time: Optional[float] = Field(None, description="处理时间（秒）")
    backend_type: str = Field(..., description="后端类型：pipeline/vlm")
    
    # 解析参数
    language: str = Field("auto", description="OCR语言")
    enable_formula: bool = Field(True, description="是否启用公式识别")
    enable_table: bool = Field(True, description="是否启用表格识别")
    page_ranges: Optional[str] = Field(None, description="页码范围")
    
    # 错误信息
    errors: List[str] = Field(default_factory=list, description="处理过程中的错误")
    warnings: List[str] = Field(default_factory=list, description="处理过程中的警告")
    
    class Config:
        arbitrary_types_allowed = True


class DocumentAdapter(ABC):
    """文档解析适配器基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        初始化适配器
        
        Args:
            config: 配置字典
        """
        self.config = config or {}
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    @abstractmethod
    async def parse(
        self,
        file_path: Path,
        output_dir: Path,
        language: str = "auto",
        enable_formula: bool = True,
        enable_table: bool = True,
        page_ranges: Optional[str] = None,
        **kwargs
    ) -> ParsedArtifacts:
        """
        解析文档
        
        Args:
            file_path: 输入文件路径
            output_dir: 输出目录
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            page_ranges: 页码范围，如 "1-5,10,15-20"
            **kwargs: 其他参数
            
        Returns:
            ParsedArtifacts: 解析结果
        """
        pass
    
    @abstractmethod
    def get_supported_formats(self) -> List[str]:
        """
        获取支持的文件格式
        
        Returns:
            支持的文件格式列表
        """
        pass
    
    @abstractmethod
    def validate_config(self) -> bool:
        """
        验证配置是否有效
        
        Returns:
            配置是否有效
        """
        pass
    
    def _prepare_output_dir(self, output_dir: Path, task_id: str) -> Path:
        """
        准备输出目录
        
        Args:
            output_dir: 基础输出目录
            task_id: 任务ID
            
        Returns:
            实际输出目录
        """
        actual_output_dir = output_dir / task_id
        actual_output_dir.mkdir(parents=True, exist_ok=True)
        return actual_output_dir
    
    def _validate_file(self, file_path: Path) -> bool:
        """
        验证输入文件
        
        Args:
            file_path: 文件路径
            
        Returns:
            文件是否有效
        """
        if not file_path.exists():
            self.logger.error(f"文件不存在: {file_path}")
            return False
        
        if not file_path.is_file():
            self.logger.error(f"路径不是文件: {file_path}")
            return False
        
        suffix = file_path.suffix.lower()
        if suffix not in self.get_supported_formats():
            self.logger.error(f"不支持的文件格式: {suffix}")
            return False
        
        return True
    
    def _generate_task_id(self, file_path: Path) -> str:
        """
        生成任务ID
        
        Args:
            file_path: 文件路径
            
        Returns:
            任务ID
        """
        import hashlib
        import time
        
        # 使用文件名和时间戳生成唯一ID
        content = f"{file_path.name}_{int(time.time() * 1000)}"
        return hashlib.md5(content.encode()).hexdigest()[:12]