"""
Markdown 渲染器 - 将解析结果渲染为不同格式的 Markdown
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Tuple
from pydantic import BaseModel, Field
from enum import Enum
import logging
import re
from datetime import datetime

from .models import ArtifactIndex, ArtifactType

logger = logging.getLogger(__name__)


class RenderFormat(str, Enum):
    """渲染格式枚举"""
    STANDARD = "standard"        # 标准 Markdown
    ENHANCED = "enhanced"        # 增强 Markdown（包含元数据）
    STRUCTURED = "structured"    # 结构化 Markdown（包含章节导航）
    MINIMAL = "minimal"          # 最小化 Markdown（纯文本）


class RenderOptions(BaseModel):
    """渲染选项"""
    format: RenderFormat = Field(RenderFormat.STANDARD, description="渲染格式")
    include_metadata: bool = Field(True, description="是否包含元数据")
    include_toc: bool = Field(True, description="是否包含目录")
    include_page_numbers: bool = Field(False, description="是否包含页码")
    include_coordinates: bool = Field(False, description="是否包含坐标信息")
    include_confidence: bool = Field(False, description="是否包含置信度")
    max_heading_level: int = Field(6, description="最大标题级别")
    image_base_url: Optional[str] = Field(None, description="图片基础URL")
    custom_css: Optional[str] = Field(None, description="自定义CSS")


class ContentBlock(BaseModel):
    """内容块模型"""
    type: str = Field(..., description="内容类型")
    content: str = Field(..., description="内容文本")
    page_number: Optional[int] = Field(None, description="页码")
    coordinates: Optional[Dict[str, Any]] = Field(None, description="坐标信息")
    confidence: Optional[float] = Field(None, description="置信度")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据")


class MarkdownRenderer:
    """Markdown 渲染器"""
    
    def __init__(self, options: Optional[RenderOptions] = None):
        """
        初始化渲染器
        
        Args:
            options: 渲染选项
        """
        self.options = options or RenderOptions()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    def render(self, artifact_index: ArtifactIndex, output_path: Optional[Path] = None) -> str:
        """
        渲染工件索引为 Markdown
        
        Args:
            artifact_index: 工件索引
            output_path: 输出路径（可选）
            
        Returns:
            str: 渲染后的 Markdown 内容
        """
        try:
            # 加载内容数据
            content_blocks = self._load_content_blocks(artifact_index)
            
            # 根据格式渲染
            if self.options.format == RenderFormat.STANDARD:
                markdown = self._render_standard(artifact_index, content_blocks)
            elif self.options.format == RenderFormat.ENHANCED:
                markdown = self._render_enhanced(artifact_index, content_blocks)
            elif self.options.format == RenderFormat.STRUCTURED:
                markdown = self._render_structured(artifact_index, content_blocks)
            elif self.options.format == RenderFormat.MINIMAL:
                markdown = self._render_minimal(artifact_index, content_blocks)
            else:
                raise ValueError(f"不支持的渲染格式: {self.options.format}")
            
            # 保存到文件
            if output_path:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(markdown, encoding='utf-8')
                self.logger.info(f"Markdown 已保存到: {output_path}")
            
            return markdown
            
        except Exception as e:
            self.logger.error(f"渲染失败: {e}")
            raise
    
    def _load_content_blocks(self, artifact_index: ArtifactIndex) -> List[ContentBlock]:
        """加载内容块"""
        content_blocks = []
        
        # 尝试从 content_list.json 加载
        content_list_path = artifact_index.get_artifact(ArtifactType.CONTENT_LIST_JSON)
        if content_list_path and content_list_path.exists():
            try:
                with open(content_list_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                for item in data:
                    if isinstance(item, dict):
                        block = ContentBlock(
                            type=item.get("type", "text"),
                            content=item.get("content", ""),
                            page_number=item.get("page_number"),
                            coordinates=item.get("coordinates"),
                            confidence=item.get("confidence"),
                            metadata=item.get("metadata")
                        )
                        content_blocks.append(block)
                        
            except Exception as e:
                self.logger.warning(f"加载 content_list.json 失败: {e}")
        
        # 如果没有 content_list.json，尝试从 markdown 文件加载
        if not content_blocks:
            markdown_path = artifact_index.get_artifact(ArtifactType.MARKDOWN)
            if markdown_path and markdown_path.exists():
                try:
                    content = markdown_path.read_text(encoding='utf-8')
                    # 简单解析 Markdown 内容
                    lines = content.split('\n')
                    current_content = []
                    
                    for line in lines:
                        if line.strip():
                            current_content.append(line)
                        elif current_content:
                            block = ContentBlock(
                                type="paragraph",
                                content='\n'.join(current_content)
                            )
                            content_blocks.append(block)
                            current_content = []
                    
                    # 处理最后一段
                    if current_content:
                        block = ContentBlock(
                            type="paragraph",
                            content='\n'.join(current_content)
                        )
                        content_blocks.append(block)
                        
                except Exception as e:
                    self.logger.warning(f"加载 markdown 文件失败: {e}")
        
        return content_blocks
    
    def _render_standard(self, artifact_index: ArtifactIndex, content_blocks: List[ContentBlock]) -> str:
        """渲染标准格式"""
        lines = []
        
        # 添加标题
        if artifact_index.source_path:
            title = f"# {artifact_index.source_path.name}"
            lines.append(title)
            lines.append("")
        
        # 添加目录（如果启用）
        if self.options.include_toc and len(content_blocks) > 5:
            lines.extend(self._generate_toc(content_blocks))
            lines.append("")
        
        # 渲染内容块
        for block in content_blocks:
            rendered_block = self._render_content_block(block)
            if rendered_block:
                lines.append(rendered_block)
                lines.append("")
        
        return '\n'.join(lines)
    
    def _render_enhanced(self, artifact_index: ArtifactIndex, content_blocks: List[ContentBlock]) -> str:
        """渲染增强格式"""
        lines = []
        
        # 添加文档头部信息
        lines.extend(self._generate_document_header(artifact_index))
        lines.append("")
        
        # 添加目录
        if self.options.include_toc:
            lines.extend(self._generate_toc(content_blocks))
            lines.append("")
        
        # 渲染内容块（包含额外信息）
        for i, block in enumerate(content_blocks):
            # 添加块分隔符
            if i > 0:
                lines.append("---")
                lines.append("")
            
            # 添加块元数据
            if self.options.include_metadata and (block.page_number or block.coordinates or block.confidence):
                lines.append("<!-- Block Metadata -->")
                if block.page_number:
                    lines.append(f"<!-- Page: {block.page_number} -->")
                if block.coordinates and self.options.include_coordinates:
                    lines.append(f"<!-- Coordinates: {block.coordinates} -->")
                if block.confidence and self.options.include_confidence:
                    lines.append(f"<!-- Confidence: {block.confidence:.2f} -->")
                lines.append("")
            
            # 渲染内容
            rendered_block = self._render_content_block(block, enhanced=True)
            if rendered_block:
                lines.append(rendered_block)
                lines.append("")
        
        return '\n'.join(lines)
    
    def _render_structured(self, artifact_index: ArtifactIndex, content_blocks: List[ContentBlock]) -> str:
        """渲染结构化格式"""
        lines = []
        
        # 添加文档头部
        lines.extend(self._generate_document_header(artifact_index))
        lines.append("")
        
        # 按页面分组内容
        pages = self._group_by_page(content_blocks)
        
        # 生成页面目录
        if len(pages) > 1:
            lines.append("## 页面目录")
            lines.append("")
            for page_num in sorted(pages.keys()):
                lines.append(f"- [第 {page_num} 页](#page-{page_num})")
            lines.append("")
        
        # 渲染每个页面
        for page_num in sorted(pages.keys()):
            if page_num is not None:
                lines.append(f"## 第 {page_num} 页 {{#page-{page_num}}}")
            else:
                lines.append("## 内容")
            lines.append("")
            
            for block in pages[page_num]:
                rendered_block = self._render_content_block(block)
                if rendered_block:
                    lines.append(rendered_block)
                    lines.append("")
        
        return '\n'.join(lines)
    
    def _render_minimal(self, artifact_index: ArtifactIndex, content_blocks: List[ContentBlock]) -> str:
        """渲染最小化格式"""
        lines = []
        
        for block in content_blocks:
            # 只保留文本内容，去除格式
            content = block.content.strip()
            if content:
                # 移除 Markdown 格式
                content = re.sub(r'[#*_`\[\]()]', '', content)
                content = re.sub(r'\n+', '\n', content)
                lines.append(content)
        
        return '\n\n'.join(lines)
    
    def _render_content_block(self, block: ContentBlock, enhanced: bool = False) -> str:
        """渲染单个内容块"""
        content = block.content.strip()
        if not content:
            return ""
        
        # 根据类型处理内容
        if block.type == "heading":
            # 确保标题级别不超过限制
            level = min(content.count('#'), self.options.max_heading_level)
            if level == 0:
                level = 1
            content = '#' * level + ' ' + content.lstrip('#').strip()
            
        elif block.type == "table":
            # 表格内容通常已经是 Markdown 格式
            pass
            
        elif block.type == "image":
            # 处理图片
            if self.options.image_base_url:
                # 如果有基础URL，构建完整路径
                content = f"![图片]({self.options.image_base_url}/{content})"
            else:
                content = f"![图片]({content})"
                
        elif block.type == "code":
            # 代码块
            if not content.startswith('```'):
                content = f"```\n{content}\n```"
        
        # 添加页码信息（如果启用）
        if enhanced and self.options.include_page_numbers and block.page_number:
            content = f"{content}\n\n*[第 {block.page_number} 页]*"
        
        return content
    
    def _generate_document_header(self, artifact_index: ArtifactIndex) -> List[str]:
        """生成文档头部信息"""
        lines = []
        
        # 文档标题
        if artifact_index.source_path:
            lines.append(f"# {artifact_index.source_path.name}")
        else:
            lines.append("# 解析文档")
        
        # 元数据表格
        if self.options.include_metadata:
            lines.append("")
            lines.append("## 文档信息")
            lines.append("")
            lines.append("| 属性 | 值 |")
            lines.append("|------|-----|")
            
            if artifact_index.source_path:
                lines.append(f"| 源文件 | `{artifact_index.source_path.name}` |")
            
            if artifact_index.page_count:
                lines.append(f"| 页数 | {artifact_index.page_count} |")
            
            if artifact_index.processing_time:
                lines.append(f"| 处理时间 | {artifact_index.processing_time:.2f} 秒 |")
            
            if artifact_index.created_at:
                lines.append(f"| 创建时间 | {artifact_index.created_at.strftime('%Y-%m-%d %H:%M:%S')} |")
            
            if artifact_index.backend_type:
                lines.append(f"| 后端类型 | {artifact_index.backend_type} |")
        
        return lines
    
    def _generate_toc(self, content_blocks: List[ContentBlock]) -> List[str]:
        """生成目录"""
        lines = ["## 目录", ""]
        
        for i, block in enumerate(content_blocks):
            if block.type == "heading":
                # 提取标题文本
                title = block.content.lstrip('#').strip()
                level = block.content.count('#')
                
                # 生成锚点
                anchor = re.sub(r'[^\w\s-]', '', title).strip()
                anchor = re.sub(r'[-\s]+', '-', anchor).lower()
                
                # 添加缩进
                indent = "  " * (level - 1)
                lines.append(f"{indent}- [{title}](#{anchor})")
        
        return lines
    
    def _group_by_page(self, content_blocks: List[ContentBlock]) -> Dict[Optional[int], List[ContentBlock]]:
        """按页面分组内容块"""
        pages = {}
        
        for block in content_blocks:
            page_num = block.page_number
            if page_num not in pages:
                pages[page_num] = []
            pages[page_num].append(block)
        
        return pages
    
    def render_summary(self, artifact_index: ArtifactIndex) -> str:
        """渲染摘要信息"""
        lines = []
        
        lines.append("# 解析摘要")
        lines.append("")
        
        # 基本信息
        lines.append("## 基本信息")
        lines.append("")
        lines.append(f"- **任务ID**: {artifact_index.task_id}")
        if artifact_index.source_path:
            lines.append(f"- **源文件**: {artifact_index.source_path.name}")
        if artifact_index.page_count:
            lines.append(f"- **页数**: {artifact_index.page_count}")
        if artifact_index.processing_time:
            lines.append(f"- **处理时间**: {artifact_index.processing_time:.2f} 秒")
        lines.append("")
        
        # 输出文件
        lines.append("## 输出文件")
        lines.append("")
        for artifact_type in ArtifactType:
            path = artifact_index.get_artifact(artifact_type)
            if path and path.exists():
                size = path.stat().st_size
                lines.append(f"- **{artifact_type.value}**: {path.name} ({size:,} 字节)")
        lines.append("")
        
        # 质量指标
        if artifact_index.quality_metrics:
            lines.append("## 质量指标")
            lines.append("")
            for key, value in artifact_index.quality_metrics.items():
                if isinstance(value, float):
                    lines.append(f"- **{key}**: {value:.2f}")
                else:
                    lines.append(f"- **{key}**: {value}")
            lines.append("")
        
        # 错误和警告
        if artifact_index.errors or artifact_index.warnings:
            lines.append("## 问题报告")
            lines.append("")
            
            if artifact_index.errors:
                lines.append("### 错误")
                for error in artifact_index.errors:
                    lines.append(f"- {error}")
                lines.append("")
            
            if artifact_index.warnings:
                lines.append("### 警告")
                for warning in artifact_index.warnings:
                    lines.append(f"- {warning}")
                lines.append("")
        
        return '\n'.join(lines)