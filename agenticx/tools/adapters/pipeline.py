"""
本地 Pipeline 后端适配器
"""

import asyncio
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging

from .base import DocumentAdapter, ParsedArtifacts
from .utils import PageRangeParser

logger = logging.getLogger(__name__)


class PipelineAdapter(DocumentAdapter):
    """本地 Pipeline 后端适配器"""
    
    SUPPORTED_FORMATS = [".pdf", ".png", ".jpg", ".jpeg"]
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        初始化 Pipeline 适配器
        
        Args:
            config: 配置字典，包含以下可选项：
                - method: 解析方法 ("auto", "ocr", "txt")
                - device: 设备类型 ("auto", "cuda", "cpu", "mps")
                - virtual_vram_size: 虚拟显存大小 (GB)
                - model_path: 模型路径
                - debug: 是否生成调试文件
        """
        super().__init__(config)
        
        # 默认配置
        self.method = self.config.get("method", "auto")
        self.device = self.config.get("device", "auto")
        self.virtual_vram_size = self.config.get("virtual_vram_size", 8)
        self.model_path = self.config.get("model_path")
        self.debug = self.config.get("debug", False)
        
        # 延迟导入 MinerU pipeline
        self._pipeline = None
    
    def _get_pipeline(self):
        """获取 MinerU pipeline 实例（延迟加载）"""
        if self._pipeline is None:
            try:
                # 这里应该导入实际的 MinerU pipeline
                # 由于我们没有实际的 MinerU 依赖，这里使用模拟实现
                self.logger.info("初始化 MinerU pipeline...")
                self._pipeline = MockPipeline(
                    method=self.method,
                    device=self.device,
                    virtual_vram_size=self.virtual_vram_size,
                    model_path=self.model_path
                )
            except ImportError as e:
                self.logger.error(f"无法导入 MinerU pipeline: {e}")
                raise RuntimeError("MinerU pipeline 未安装或配置错误")
        
        return self._pipeline
    
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
        使用本地 pipeline 解析文档
        
        Args:
            file_path: 输入文件路径
            output_dir: 输出目录
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            page_ranges: 页码范围
            **kwargs: 其他参数
            
        Returns:
            ParsedArtifacts: 解析结果
        """
        start_time = time.time()
        
        # 验证输入
        if not self._validate_file(file_path):
            raise ValueError(f"无效的输入文件: {file_path}")
        
        # 生成任务ID
        task_id = self._generate_task_id(file_path)
        
        # 准备输出目录
        actual_output_dir = self._prepare_output_dir(output_dir, task_id)
        
        # 解析页码范围
        pages = []
        if page_ranges:
            try:
                pages = PageRangeParser.parse(page_ranges)
                self.logger.info(f"解析页码范围: {page_ranges} -> {pages}")
            except ValueError as e:
                self.logger.error(f"页码范围解析失败: {e}")
                raise
        
        # 获取 pipeline 实例
        pipeline = self._get_pipeline()
        
        try:
            # 执行解析
            self.logger.info(f"开始解析文档: {file_path}")
            result = await self._run_pipeline(
                pipeline=pipeline,
                file_path=file_path,
                output_dir=actual_output_dir,
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                pages=pages
            )
            
            processing_time = time.time() - start_time
            
            # 构建结果
            artifacts = ParsedArtifacts(
                task_id=task_id,
                source_file=file_path,
                output_dir=actual_output_dir,
                markdown_file=result.get("markdown_file"),
                model_json=result.get("model_json"),
                middle_json=result.get("middle_json"),
                content_list_json=result.get("content_list_json"),
                layout_pdf=result.get("layout_pdf") if self.debug else None,
                spans_pdf=result.get("spans_pdf") if self.debug else None,
                page_count=result.get("page_count"),
                processing_time=processing_time,
                backend_type="pipeline",
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                page_ranges=page_ranges,
                errors=result.get("errors", []),
                warnings=result.get("warnings", [])
            )
            
            self.logger.info(f"文档解析完成，耗时: {processing_time:.2f}秒")
            return artifacts
            
        except Exception as e:
            self.logger.error(f"文档解析失败: {e}")
            raise
    
    async def _run_pipeline(
        self,
        pipeline,
        file_path: Path,
        output_dir: Path,
        language: str,
        enable_formula: bool,
        enable_table: bool,
        pages: List[int]
    ) -> Dict[str, Any]:
        """
        运行 pipeline 解析
        
        Args:
            pipeline: Pipeline 实例
            file_path: 输入文件
            output_dir: 输出目录
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            pages: 页码列表
            
        Returns:
            解析结果字典
        """
        # 在异步环境中运行同步的 pipeline
        loop = asyncio.get_event_loop()
        
        result = await loop.run_in_executor(
            None,
            pipeline.process,
            str(file_path),
            str(output_dir),
            language,
            enable_formula,
            enable_table,
            pages
        )
        
        return result
    
    def get_supported_formats(self) -> List[str]:
        """获取支持的文件格式"""
        return self.SUPPORTED_FORMATS.copy()
    
    def validate_config(self) -> bool:
        """验证配置是否有效"""
        try:
            # 检查设备配置
            if self.device not in ["auto", "cuda", "cpu", "mps"]:
                self.logger.error(f"不支持的设备类型: {self.device}")
                return False
            
            # 检查方法配置
            if self.method not in ["auto", "ocr", "txt"]:
                self.logger.error(f"不支持的解析方法: {self.method}")
                return False
            
            # 检查虚拟显存大小
            if not isinstance(self.virtual_vram_size, (int, float)) or self.virtual_vram_size <= 0:
                self.logger.error(f"无效的虚拟显存大小: {self.virtual_vram_size}")
                return False
            
            # 检查模型路径（如果指定）
            if self.model_path and not Path(self.model_path).exists():
                self.logger.error(f"模型路径不存在: {self.model_path}")
                return False
            
            return True
            
        except Exception as e:
            self.logger.error(f"配置验证失败: {e}")
            return False


class MockPipeline:
    """模拟的 MinerU Pipeline（用于开发测试）"""
    
    def __init__(self, method: str, device: str, virtual_vram_size: float, model_path: Optional[str]):
        self.method = method
        self.device = device
        self.virtual_vram_size = virtual_vram_size
        self.model_path = model_path
        
        logger.info(f"MockPipeline 初始化: method={method}, device={device}")
    
    def process(
        self,
        file_path: str,
        output_dir: str,
        language: str,
        enable_formula: bool,
        enable_table: bool,
        pages: List[int]
    ) -> Dict[str, Any]:
        """模拟处理过程"""
        
        output_path = Path(output_dir)
        file_stem = Path(file_path).stem
        
        # 创建模拟输出文件
        markdown_file = output_path / f"{file_stem}.md"
        model_json = output_path / f"{file_stem}_model.json"
        middle_json = output_path / f"{file_stem}_middle.json"
        content_list_json = output_path / f"{file_stem}_content_list.json"
        
        # 写入模拟内容
        markdown_file.write_text("# 模拟解析结果\n\n这是一个模拟的 Markdown 输出。")
        
        model_data = {
            "pages": [{"page_id": 1, "elements": []}],
            "metadata": {"total_pages": 1}
        }
        model_json.write_text(json.dumps(model_data, ensure_ascii=False, indent=2))
        
        middle_data = {"processing_info": "模拟中间数据"}
        middle_json.write_text(json.dumps(middle_data, ensure_ascii=False, indent=2))
        
        content_list_data = [{"type": "text", "content": "模拟内容"}]
        content_list_json.write_text(json.dumps(content_list_data, ensure_ascii=False, indent=2))
        
        return {
            "markdown_file": markdown_file,
            "model_json": model_json,
            "middle_json": middle_json,
            "content_list_json": content_list_json,
            "page_count": 1,
            "errors": [],
            "warnings": []
        }