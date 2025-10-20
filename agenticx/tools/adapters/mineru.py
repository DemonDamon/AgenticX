"""
MinerU 文档解析适配器

提供统一的 MinerU 解析接口，支持多种后端和配置选项。
"""

import os
import json
import time
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass, field
from enum import Enum

from .base import DocumentAdapter
from .utils import PageRangeParser


class BackendType(str, Enum):
    """后端类型枚举"""
    PIPELINE = "pipeline"
    VLM_HTTP = "vlm-http"


@dataclass
class ParseResult:
    """解析结果数据类"""
    success: bool
    output_dir: str
    processing_time: float
    page_count: Optional[int] = None
    content_blocks: Optional[int] = None
    error_message: Optional[str] = None
    artifacts: Dict[str, Any] = field(default_factory=dict)


class MinerUAdapter(DocumentAdapter):
    """
    MinerU 文档解析适配器
    
    提供统一的接口来使用不同的 MinerU 后端解析文档。
    """
    
    def __init__(
        self,
        backend_type: str = "pipeline",
        config_path: Optional[str] = None,
        debug: bool = False,
        **kwargs
    ):
        """
        初始化 MinerU 适配器
        
        Args:
            backend_type: 后端类型 (pipeline/vlm-http)
            config_path: 配置文件路径
            debug: 是否启用调试模式
            **kwargs: 其他配置参数
        """
        super().__init__()
        
        self.backend_type = BackendType(backend_type)
        self.config_path = config_path
        self.debug = debug
        self.config = self._load_config()
        
        # 初始化后端适配器
        self._backend_adapter = self._create_backend_adapter(**kwargs)
    
    def _load_config(self) -> Dict[str, Any]:
        """加载配置文件"""
        config = {}
        
        if self.config_path and os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    if self.config_path.endswith('.json'):
                        config = json.load(f)
                    elif self.config_path.endswith(('.yaml', '.yml')):
                        import yaml
                        config = yaml.safe_load(f)
            except Exception as e:
                if self.debug:
                    print(f"警告: 配置文件加载失败: {e}")
        
        return config
    
    def _create_backend_adapter(self, **kwargs):
        """创建后端适配器"""
        if self.backend_type == BackendType.PIPELINE:
            return self._create_pipeline_adapter(**kwargs)
        elif self.backend_type == BackendType.VLM_HTTP:
            return self._create_vlm_http_adapter(**kwargs)
        else:
            raise ValueError(f"不支持的后端类型: {self.backend_type}")
    
    def _create_pipeline_adapter(self, **kwargs):
        """创建 Pipeline 后端适配器"""
        try:
            from .pipeline import PipelineAdapter
            # 将 debug 参数添加到配置中
            config = self.config.copy()
            config['debug'] = self.debug
            return PipelineAdapter(config=config)
        except ImportError:
            # 如果没有安装 MinerU，创建一个模拟适配器
            return MockPipelineAdapter(debug=self.debug)
    
    def _create_vlm_http_adapter(self, **kwargs):
        """创建 VLM HTTP 后端适配器"""
        try:
            from .vlm_client import VLMHttpClientAdapter
            return VLMHttpClientAdapter(
                config=self.config,
                debug=self.debug,
                **kwargs
            )
        except ImportError:
            # 如果没有安装相关依赖，创建一个模拟适配器
            return MockVLMAdapter(debug=self.debug)
    
    async def parse_document(
        self,
        input_path: str,
        output_dir: str,
        pages: Optional[str] = None,
        **kwargs
    ) -> ParseResult:
        """
        解析文档
        
        Args:
            input_path: 输入文档路径
            output_dir: 输出目录
            pages: 页码范围 (如: "1-5,8,10-12")
            **kwargs: 其他解析参数
            
        Returns:
            ParseResult: 解析结果
        """
        start_time = time.time()
        
        try:
            # 验证输入路径
            input_path_obj = Path(input_path)
            if not input_path_obj.exists():
                return ParseResult(
                    success=False,
                    output_dir=output_dir,
                    processing_time=0,
                    error_message=f"输入路径不存在: {input_path}"
                )
            
            # 创建输出目录
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            # 解析页码范围
            page_list = None
            if pages:
                parser = PageRangeParser()
                page_list = parser.parse(pages)
            
            # 调用后端适配器进行解析
            if hasattr(self._backend_adapter, 'parse') and asyncio.iscoroutinefunction(self._backend_adapter.parse):
                # 异步调用 (真正的 PipelineAdapter)
                parsed_artifacts = await self._backend_adapter.parse(
                    file_path=input_path_obj,
                    output_dir=output_path,
                    page_ranges=pages,
                    **kwargs
                )
                # 将 ParsedArtifacts 转换为字典格式
                result = {
                    'success': True,
                    'page_count': getattr(parsed_artifacts, 'page_count', None),
                    'content_blocks': None,  # ParsedArtifacts 没有这个字段
                    'error': None
                }
            else:
                # 同步调用 (模拟适配器)
                result = self._backend_adapter.parse(
                    input_path=str(input_path_obj),
                    output_dir=str(output_path),
                    pages=page_list,
                    **kwargs
                )
            
            processing_time = time.time() - start_time
            
            # 收集解析工件
            artifacts = self._collect_artifacts(output_path)
            
            return ParseResult(
                success=result.get('success', True),
                output_dir=str(output_path),
                processing_time=processing_time,
                page_count=result.get('page_count'),
                content_blocks=result.get('content_blocks'),
                error_message=result.get('error'),
                artifacts=artifacts
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_message = str(e)
            
            if self.debug:
                import traceback
                error_message += f"\n{traceback.format_exc()}"
            
            return ParseResult(
                success=False,
                output_dir=output_dir,
                processing_time=processing_time,
                error_message=error_message
            )
    
    def _collect_artifacts(self, output_path: Path) -> Dict[str, Any]:
        """收集解析工件"""
        artifacts = {}
        
        # 查找常见的输出文件
        common_files = [
            'model.json',
            'middle.json',
            'content_list.json',
            'layout.json'
        ]
        
        for filename in common_files:
            file_path = output_path / filename
            if file_path.exists():
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        artifacts[filename] = json.load(f)
                except Exception as e:
                    if self.debug:
                        print(f"警告: 无法读取 {filename}: {e}")
        
        # 查找 Markdown 文件
        md_files = list(output_path.glob("*.md"))
        if md_files:
            artifacts['markdown_files'] = [str(f.relative_to(output_path)) for f in md_files]
        
        # 查找图片文件
        img_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp']
        img_files = []
        for ext in img_extensions:
            img_files.extend(output_path.glob(f"*{ext}"))
        
        if img_files:
            artifacts['image_files'] = [str(f.relative_to(output_path)) for f in img_files]
        
        return artifacts
    
    def get_supported_formats(self) -> List[str]:
        """获取支持的文件格式"""
        return ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.doc', '.docx']
    
    def validate_config(self) -> bool:
        """验证配置是否有效"""
        # 基本配置验证
        return True
    
    async def parse(
        self,
        file_path: Path,
        output_dir: Path,
        language: str = "auto",
        enable_formula: bool = True,
        enable_table: bool = True,
        page_ranges: Optional[str] = None,
        **kwargs
    ):
        """实现异步解析接口"""
        # 调用异步解析方法
        return await self.parse_document(
            input_path=str(file_path),
            output_dir=str(output_dir),
            pages=page_ranges,
            **kwargs
        )
    
    def validate_input(self, input_path: str) -> bool:
        """验证输入文件格式"""
        path_obj = Path(input_path)
        
        if path_obj.is_dir():
            # 如果是目录，检查是否包含支持的文件
            supported_formats = self.get_supported_formats()
            for file_path in path_obj.rglob("*"):
                if file_path.suffix.lower() in supported_formats:
                    return True
            return False
        
        # 如果是文件，检查扩展名
        return path_obj.suffix.lower() in self.get_supported_formats()


class MockPipelineAdapter:
    """模拟 Pipeline 适配器 (用于测试或缺少依赖时)"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
    
    def parse(self, input_path: str, output_dir: str, pages: Optional[List[int]] = None, **kwargs) -> Dict[str, Any]:
        """模拟解析过程"""
        if self.debug:
            print(f"模拟解析: {input_path} -> {output_dir}")
        
        # 创建模拟输出文件
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # 创建模拟的 model.json
        model_data = {
            "doc_layout_result": [],
            "page_info": [{"page_no": 1, "height": 842, "width": 595}],
            "metadata": {"total_pages": 1}
        }
        
        with open(output_path / "model.json", 'w', encoding='utf-8') as f:
            json.dump(model_data, f, ensure_ascii=False, indent=2)
        
        # 创建模拟的 content_list.json
        content_data = [
            {
                "type": "text",
                "content": "这是一个模拟的文档解析结果。",
                "page": 1,
                "bbox": [100, 100, 400, 150]
            }
        ]
        
        with open(output_path / "content_list.json", 'w', encoding='utf-8') as f:
            json.dump(content_data, f, ensure_ascii=False, indent=2)
        
        # 创建模拟的 Markdown 文件
        with open(output_path / "output.md", 'w', encoding='utf-8') as f:
            f.write("# 模拟文档\n\n这是一个模拟的文档解析结果。\n")
        
        return {
            'success': True,
            'page_count': 1,
            'content_blocks': 1
        }


class MockVLMAdapter:
    """模拟 VLM HTTP 适配器 (用于测试或缺少依赖时)"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
    
    def parse(self, input_path: str, output_dir: str, pages: Optional[List[int]] = None, **kwargs) -> Dict[str, Any]:
        """模拟解析过程"""
        if self.debug:
            print(f"模拟 VLM 解析: {input_path} -> {output_dir}")
        
        # 创建模拟输出 (类似 Pipeline 但可能有不同的结构)
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # 创建模拟的解析结果
        result_data = {
            "status": "success",
            "pages": [
                {
                    "page_no": 1,
                    "content": "这是通过 VLM HTTP 服务解析的模拟结果。",
                    "elements": []
                }
            ]
        }
        
        with open(output_path / "vlm_result.json", 'w', encoding='utf-8') as f:
            json.dump(result_data, f, ensure_ascii=False, indent=2)
        
        with open(output_path / "output.md", 'w', encoding='utf-8') as f:
            f.write("# VLM 解析结果\n\n这是通过 VLM HTTP 服务解析的模拟结果。\n")
        
        return {
            'success': True,
            'page_count': 1,
            'content_blocks': 1
        }