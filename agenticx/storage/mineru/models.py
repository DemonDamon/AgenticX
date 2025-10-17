"""
MinerU 解析结果数据模型
"""

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum
import json


class ArtifactType(str, Enum):
    """工件类型枚举"""
    MARKDOWN = "markdown"
    MODEL_JSON = "model_json"
    MIDDLE_JSON = "middle_json"
    CONTENT_LIST_JSON = "content_list_json"
    LAYOUT_PDF = "layout_pdf"
    SPANS_PDF = "spans_pdf"
    SOURCE_FILE = "source_file"


class ProcessingStatus(str, Enum):
    """处理状态枚举"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class BackendType(str, Enum):
    """后端类型枚举"""
    PIPELINE = "pipeline"
    VLM = "vlm"
    REMOTE_API = "remote_api"
    MCP = "mcp"


class ArtifactIndex(BaseModel):
    """工件索引模型"""
    
    # 基础信息
    task_id: str = Field(..., description="任务ID")
    source_file: Path = Field(..., description="源文件路径")
    output_dir: Path = Field(..., description="输出目录")
    
    # 处理信息
    backend_type: BackendType = Field(..., description="后端类型")
    processing_status: ProcessingStatus = Field(..., description="处理状态")
    processing_time: Optional[float] = Field(None, description="处理时间（秒）")
    
    # 工件文件路径
    artifacts: Dict[ArtifactType, Optional[Path]] = Field(
        default_factory=dict, 
        description="工件文件路径映射"
    )
    
    # 文档元数据
    page_count: Optional[int] = Field(None, description="页面总数")
    file_size: Optional[int] = Field(None, description="文件大小（字节）")
    file_format: Optional[str] = Field(None, description="文件格式")
    
    # 解析参数
    language: str = Field("auto", description="OCR语言")
    enable_formula: bool = Field(True, description="是否启用公式识别")
    enable_table: bool = Field(True, description="是否启用表格识别")
    page_ranges: Optional[str] = Field(None, description="页码范围")
    
    # 质量指标
    confidence_score: Optional[float] = Field(None, description="置信度分数 (0-1)")
    ocr_accuracy: Optional[float] = Field(None, description="OCR准确率 (0-1)")
    
    # 错误和警告
    errors: List[str] = Field(default_factory=list, description="处理错误")
    warnings: List[str] = Field(default_factory=list, description="处理警告")
    
    # 时间戳
    created_at: Optional[datetime] = Field(None, description="创建时间")
    updated_at: Optional[datetime] = Field(None, description="更新时间")
    
    # 额外元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    
    class Config:
        arbitrary_types_allowed = True
        json_encoders = {
            Path: str,
            datetime: lambda v: v.isoformat()
        }
    
    @classmethod
    def from_outputs(cls, outputs_dir: Path, task_id: str = None) -> "ArtifactIndex":
        """
        从输出目录创建工件索引
        
        Args:
            outputs_dir: 输出目录
            task_id: 任务ID（可选）
            
        Returns:
            ArtifactIndex: 工件索引
        """
        if not outputs_dir.exists():
            raise ValueError(f"输出目录不存在: {outputs_dir}")
        
        # 如果没有提供 task_id，使用目录名
        if task_id is None:
            task_id = outputs_dir.name
        
        # 扫描工件文件
        artifacts = {}
        
        # 查找各种类型的工件文件
        for file_path in outputs_dir.iterdir():
            if file_path.is_file():
                name = file_path.name.lower()
                stem = file_path.stem.lower()
                
                if name.endswith('.md'):
                    artifacts[ArtifactType.MARKDOWN] = file_path
                elif name.endswith('_model.json') or 'model' in stem:
                    artifacts[ArtifactType.MODEL_JSON] = file_path
                elif name.endswith('_middle.json') or 'middle' in stem:
                    artifacts[ArtifactType.MIDDLE_JSON] = file_path
                elif name.endswith('_content_list.json') or 'content_list' in stem:
                    artifacts[ArtifactType.CONTENT_LIST_JSON] = file_path
                elif name.endswith('_layout.pdf') or 'layout' in stem:
                    artifacts[ArtifactType.LAYOUT_PDF] = file_path
                elif name.endswith('_spans.pdf') or 'spans' in stem:
                    artifacts[ArtifactType.SPANS_PDF] = file_path
        
        return cls(
            task_id=task_id,
            source_file=Path("unknown"),  # 需要从其他地方获取
            output_dir=outputs_dir,
            backend_type=BackendType.PIPELINE,  # 默认值
            processing_status=ProcessingStatus.COMPLETED,
            artifacts=artifacts,
            created_at=datetime.now()
        )
    
    def get_artifact(self, artifact_type: ArtifactType) -> Optional[Path]:
        """
        获取指定类型的工件文件路径
        
        Args:
            artifact_type: 工件类型
            
        Returns:
            文件路径或None
        """
        return self.artifacts.get(artifact_type)
    
    def has_artifact(self, artifact_type: ArtifactType) -> bool:
        """
        检查是否存在指定类型的工件
        
        Args:
            artifact_type: 工件类型
            
        Returns:
            是否存在
        """
        path = self.get_artifact(artifact_type)
        return path is not None and path.exists()
    
    def get_file_size(self, artifact_type: ArtifactType) -> Optional[int]:
        """
        获取指定工件的文件大小
        
        Args:
            artifact_type: 工件类型
            
        Returns:
            文件大小（字节）或None
        """
        path = self.get_artifact(artifact_type)
        if path and path.exists():
            return path.stat().st_size
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return self.model_dump(mode='json')
    
    def save_index(self, index_file: Optional[Path] = None) -> Path:
        """
        保存索引到文件
        
        Args:
            index_file: 索引文件路径（可选）
            
        Returns:
            实际保存的文件路径
        """
        if index_file is None:
            index_file = self.output_dir / "artifact_index.json"
        
        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
        
        return index_file
    
    @classmethod
    def load_index(cls, index_file: Path) -> "ArtifactIndex":
        """
        从文件加载索引
        
        Args:
            index_file: 索引文件路径
            
        Returns:
            ArtifactIndex: 工件索引
        """
        with open(index_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 转换路径字符串为 Path 对象
        if 'source_file' in data:
            data['source_file'] = Path(data['source_file'])
        if 'output_dir' in data:
            data['output_dir'] = Path(data['output_dir'])
        if 'artifacts' in data:
            artifacts = {}
            for key, value in data['artifacts'].items():
                if value:
                    artifacts[ArtifactType(key)] = Path(value)
                else:
                    artifacts[ArtifactType(key)] = None
            data['artifacts'] = artifacts
        
        return cls(**data)


class ParsedArtifacts(BaseModel):
    """解析后的工件集合（兼容适配器模块）"""
    
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
    
    def to_artifact_index(self) -> ArtifactIndex:
        """转换为 ArtifactIndex 格式"""
        
        # 构建工件映射
        artifacts = {}
        if self.markdown_file:
            artifacts[ArtifactType.MARKDOWN] = self.markdown_file
        if self.model_json:
            artifacts[ArtifactType.MODEL_JSON] = self.model_json
        if self.middle_json:
            artifacts[ArtifactType.MIDDLE_JSON] = self.middle_json
        if self.content_list_json:
            artifacts[ArtifactType.CONTENT_LIST_JSON] = self.content_list_json
        if self.layout_pdf:
            artifacts[ArtifactType.LAYOUT_PDF] = self.layout_pdf
        if self.spans_pdf:
            artifacts[ArtifactType.SPANS_PDF] = self.spans_pdf
        
        # 确定后端类型
        backend_type = BackendType.PIPELINE
        if self.backend_type == "vlm":
            backend_type = BackendType.VLM
        elif self.backend_type == "remote_api":
            backend_type = BackendType.REMOTE_API
        elif self.backend_type == "mcp":
            backend_type = BackendType.MCP
        
        return ArtifactIndex(
            task_id=self.task_id,
            source_file=self.source_file,
            output_dir=self.output_dir,
            backend_type=backend_type,
            processing_status=ProcessingStatus.COMPLETED if not self.errors else ProcessingStatus.PARTIAL,
            processing_time=self.processing_time,
            artifacts=artifacts,
            page_count=self.page_count,
            language=self.language,
            enable_formula=self.enable_formula,
            enable_table=self.enable_table,
            page_ranges=self.page_ranges,
            errors=self.errors,
            warnings=self.warnings,
            created_at=datetime.now()
        )