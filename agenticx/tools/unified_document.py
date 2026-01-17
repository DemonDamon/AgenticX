"""
统一文档处理工具（OWL 增强机制）

参考：OWL 的 DocumentProcessingToolkit
来源：owl/utils/document_toolkit.py

提供单一接口处理多种文档格式：
- 图片（.jpg, .jpeg, .png）
- Excel（.xls, .xlsx）
- PDF, DOCX, PPTX（通过降级处理器）
- ZIP
- JSON, JSONL, JSONLD
- Python（.py）
- XML
- 网页（URL）
"""

import os
import logging
from typing import Tuple, Optional, Dict, Any
from pathlib import Path
from pydantic import BaseModel, Field

from .base import BaseTool
from .document_routers import DocumentRouter, create_default_router

logger = logging.getLogger(__name__)


class UnifiedDocumentToolArgs(BaseModel):
    """统一文档工具参数模型"""
    document_path: str = Field(description="文档路径（本地路径或 URL）")


class UnifiedDocumentTool(BaseTool):
    """统一文档处理工具
    
    根据文件类型自动路由到不同的处理器，提供统一的文档处理接口。
    """
    
    def __init__(
        self,
        cache_dir: str = "./cache",
        enable_firecrawl: bool = False,
        enable_chunkr: bool = False,
        router: Optional[DocumentRouter] = None,
        **kwargs
    ):
        """
        初始化统一文档处理工具
        
        Args:
            cache_dir: 缓存目录
            enable_firecrawl: 是否启用 Firecrawl（网页抓取）
            enable_chunkr: 是否启用 Chunkr（文档分块）
            router: 自定义路由器（如果为 None，使用默认路由器）
            **kwargs: 传递给 BaseTool 的其他参数
        """
        super().__init__(
            name="unified_document_tool",
            description="统一文档处理工具，支持多种文档格式（图片、Excel、PDF、网页等）",
            args_schema=UnifiedDocumentToolArgs,
            **kwargs
        )
        
        self.cache_dir = cache_dir
        self.enable_firecrawl = enable_firecrawl
        self.enable_chunkr = enable_chunkr
        
        # 创建路由器
        self.router = router or create_default_router()
        
        # 注册格式特定的处理器
        self._register_processors()
        
        # 确保缓存目录存在
        os.makedirs(cache_dir, exist_ok=True)
    
    def _register_processors(self):
        """注册各种格式的处理器"""
        # 图片处理器（需要图像分析工具，这里先提供占位实现）
        self.router.register_processor(
            (".jpg", ".jpeg", ".png"),
            self._process_image
        )
        
        # Excel 处理器（需要 Excel 工具，这里先提供占位实现）
        self.router.register_processor(
            (".xls", ".xlsx"),
            self._process_excel
        )
        
        # PDF/DOCX/PPTX 处理器（需要文档解析工具，这里先提供占位实现）
        self.router.register_processor(
            (".pdf", ".docx", ".pptx"),
            self._process_document
        )
        
        # 设置降级处理器（使用通用文件读取）
        self.router.set_fallback_processor(self._process_generic)
    
    def _process_image(self, path: str) -> Tuple[bool, str]:
        """处理图片文件"""
        # 占位实现：返回文件信息
        # 实际实现应该使用图像分析工具（如 ImageAnalysisToolkit）
        try:
            if os.path.exists(path):
                file_size = os.path.getsize(path)
                return True, f"Image file: {path} (size: {file_size} bytes). Image analysis not implemented yet."
            else:
                return False, f"Image file not found: {path}"
        except Exception as e:
            return False, f"Failed to process image: {e}"
    
    def _process_excel(self, path: str) -> Tuple[bool, str]:
        """处理 Excel 文件"""
        # 占位实现：返回文件信息
        # 实际实现应该使用 Excel 工具（如 ExcelToolkit）
        try:
            if os.path.exists(path):
                file_size = os.path.getsize(path)
                return True, f"Excel file: {path} (size: {file_size} bytes). Excel extraction not implemented yet."
            else:
                return False, f"Excel file not found: {path}"
        except Exception as e:
            return False, f"Failed to process Excel file: {e}"
    
    def _process_document(self, path: str) -> Tuple[bool, str]:
        """处理文档文件（PDF, DOCX, PPTX）"""
        # 占位实现：返回文件信息
        # 实际实现应该使用文档解析工具（如 UnstructuredIO 或 MinerU）
        try:
            if os.path.exists(path):
                file_size = os.path.getsize(path)
                ext = Path(path).suffix.lower()
                return True, f"Document file ({ext}): {path} (size: {file_size} bytes). Document extraction not implemented yet."
            else:
                return False, f"Document file not found: {path}"
        except Exception as e:
            return False, f"Failed to process document: {e}"
    
    def _process_generic(self, path: str) -> Tuple[bool, str]:
        """通用文件处理器（降级）"""
        try:
            if os.path.exists(path):
                # 尝试作为文本文件读取
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                return True, content
            else:
                return False, f"File not found: {path}"
        except Exception as e:
            return False, f"Failed to read file: {e}"
    
    def execute(self, document_path: str) -> Tuple[bool, str]:
        """
        执行文档处理
        
        Args:
            document_path: 文档路径（本地路径或 URL）
            
        Returns:
            (success, content) 元组
        """
        logger.info(f"Processing document: {document_path}")
        return self.router.route(document_path)
    
    def _run(self, **kwargs) -> Any:
        """
        执行工具逻辑（BaseTool 接口）
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            工具执行结果
        """
        document_path = kwargs.get("document_path")
        if not document_path:
            raise ValueError("document_path parameter is required")
        
        success, content = self.execute(document_path)
        
        if success:
            return {
                "success": True,
                "content": content,
                "document_path": document_path
            }
        else:
            return {
                "success": False,
                "error": content,
                "document_path": document_path
            }
