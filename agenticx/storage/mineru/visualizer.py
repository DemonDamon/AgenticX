"""
调试可视化器 - 生成解析结果的可视化调试信息
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Tuple
from pydantic import BaseModel, Field
from enum import Enum
import logging
from datetime import datetime
import base64

from .models import ArtifactIndex, ArtifactType

logger = logging.getLogger(__name__)


class VisualizationType(str, Enum):
    """可视化类型枚举"""
    HTML_REPORT = "html_report"      # HTML 调试报告
    JSON_SUMMARY = "json_summary"    # JSON 摘要
    TEXT_REPORT = "text_report"      # 文本报告
    COORDINATE_MAP = "coordinate_map" # 坐标映射图


class DebugLevel(str, Enum):
    """调试级别枚举"""
    BASIC = "basic"          # 基础信息
    DETAILED = "detailed"    # 详细信息
    VERBOSE = "verbose"      # 详尽信息


class VisualizationOptions(BaseModel):
    """可视化选项"""
    type: VisualizationType = Field(VisualizationType.HTML_REPORT, description="可视化类型")
    debug_level: DebugLevel = Field(DebugLevel.DETAILED, description="调试级别")
    include_coordinates: bool = Field(True, description="是否包含坐标信息")
    include_confidence: bool = Field(True, description="是否包含置信度")
    include_raw_data: bool = Field(False, description="是否包含原始数据")
    include_images: bool = Field(False, description="是否包含图片预览")
    max_content_length: int = Field(1000, description="最大内容长度")


class DebugVisualizer:
    """调试可视化器"""
    
    def __init__(self, options: Optional[VisualizationOptions] = None):
        """
        初始化可视化器
        
        Args:
            options: 可视化选项
        """
        self.options = options or VisualizationOptions()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    def generate(self, artifact_index: ArtifactIndex, output_path: Optional[Path] = None) -> str:
        """
        生成可视化调试信息
        
        Args:
            artifact_index: 工件索引
            output_path: 输出路径（可选）
            
        Returns:
            str: 生成的可视化内容
        """
        try:
            if self.options.type == VisualizationType.HTML_REPORT:
                content = self._generate_html_report(artifact_index)
                extension = ".html"
            elif self.options.type == VisualizationType.JSON_SUMMARY:
                content = self._generate_json_summary(artifact_index)
                extension = ".json"
            elif self.options.type == VisualizationType.TEXT_REPORT:
                content = self._generate_text_report(artifact_index)
                extension = ".txt"
            elif self.options.type == VisualizationType.COORDINATE_MAP:
                content = self._generate_coordinate_map(artifact_index)
                extension = ".html"
            else:
                raise ValueError(f"不支持的可视化类型: {self.options.type}")
            
            # 保存到文件
            if output_path:
                if not output_path.suffix:
                    output_path = output_path.with_suffix(extension)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(content, encoding='utf-8')
                self.logger.info(f"可视化文件已保存到: {output_path}")
            
            return content
            
        except Exception as e:
            self.logger.error(f"生成可视化失败: {e}")
            raise
    
    def _generate_html_report(self, artifact_index: ArtifactIndex) -> str:
        """生成 HTML 调试报告"""
        # 加载数据
        content_data = self._load_content_data(artifact_index)
        model_data = self._load_model_data(artifact_index)
        
        html_parts = []
        
        # HTML 头部
        html_parts.append(self._get_html_header())
        
        # 文档信息
        html_parts.append(self._generate_document_info_html(artifact_index))
        
        # 文件列表
        html_parts.append(self._generate_file_list_html(artifact_index))
        
        # 内容预览
        if content_data:
            html_parts.append(self._generate_content_preview_html(content_data))
        
        # 模型数据
        if model_data and self.options.debug_level == DebugLevel.VERBOSE:
            html_parts.append(self._generate_model_data_html(model_data))
        
        # 坐标可视化
        if self.options.include_coordinates and model_data:
            html_parts.append(self._generate_coordinates_html(model_data))
        
        # 质量指标
        if artifact_index.quality_metrics:
            html_parts.append(self._generate_quality_metrics_html(artifact_index.quality_metrics))
        
        # 错误和警告
        if artifact_index.errors or artifact_index.warnings:
            html_parts.append(self._generate_issues_html(artifact_index))
        
        # HTML 尾部
        html_parts.append(self._get_html_footer())
        
        return '\n'.join(html_parts)
    
    def _generate_json_summary(self, artifact_index: ArtifactIndex) -> str:
        """生成 JSON 摘要"""
        summary = {
            "task_id": artifact_index.task_id,
            "source_file": str(artifact_index.source_path) if artifact_index.source_path else None,
            "output_directory": str(artifact_index.output_path) if artifact_index.output_path else None,
            "status": artifact_index.status,
            "backend_type": artifact_index.backend_type,
            "page_count": artifact_index.page_count,
            "processing_time": artifact_index.processing_time,
            "created_at": artifact_index.created_at.isoformat() if artifact_index.created_at else None,
            "updated_at": artifact_index.updated_at.isoformat() if artifact_index.updated_at else None,
            
            # 文件信息
            "artifacts": {},
            
            # 质量指标
            "quality_metrics": artifact_index.quality_metrics,
            
            # 问题
            "errors": artifact_index.errors,
            "warnings": artifact_index.warnings,
            
            # 统计信息
            "statistics": self._calculate_statistics(artifact_index)
        }
        
        # 添加工件信息
        for artifact_type in ArtifactType:
            path = artifact_index.get_artifact(artifact_type)
            if path:
                summary["artifacts"][artifact_type.value] = {
                    "path": str(path),
                    "exists": path.exists(),
                    "size": path.stat().st_size if path.exists() else 0
                }
        
        return json.dumps(summary, indent=2, ensure_ascii=False)
    
    def _generate_text_report(self, artifact_index: ArtifactIndex) -> str:
        """生成文本报告"""
        lines = []
        
        # 标题
        lines.append("=" * 60)
        lines.append("AgenticX × MinerU 解析调试报告")
        lines.append("=" * 60)
        lines.append("")
        
        # 基本信息
        lines.append("基本信息:")
        lines.append(f"  任务ID: {artifact_index.task_id}")
        if artifact_index.source_path:
            lines.append(f"  源文件: {artifact_index.source_path}")
        if artifact_index.output_path:
            lines.append(f"  输出目录: {artifact_index.output_path}")
        lines.append(f"  状态: {artifact_index.status}")
        lines.append(f"  后端类型: {artifact_index.backend_type}")
        if artifact_index.page_count:
            lines.append(f"  页数: {artifact_index.page_count}")
        if artifact_index.processing_time:
            lines.append(f"  处理时间: {artifact_index.processing_time:.2f} 秒")
        lines.append("")
        
        # 输出文件
        lines.append("输出文件:")
        for artifact_type in ArtifactType:
            path = artifact_index.get_artifact(artifact_type)
            if path:
                exists = "✓" if path.exists() else "✗"
                size = path.stat().st_size if path.exists() else 0
                lines.append(f"  {exists} {artifact_type.value}: {path.name} ({size:,} 字节)")
        lines.append("")
        
        # 质量指标
        if artifact_index.quality_metrics:
            lines.append("质量指标:")
            for key, value in artifact_index.quality_metrics.items():
                if isinstance(value, float):
                    lines.append(f"  {key}: {value:.2f}")
                else:
                    lines.append(f"  {key}: {value}")
            lines.append("")
        
        # 错误和警告
        if artifact_index.errors:
            lines.append("错误:")
            for error in artifact_index.errors:
                lines.append(f"  ✗ {error}")
            lines.append("")
        
        if artifact_index.warnings:
            lines.append("警告:")
            for warning in artifact_index.warnings:
                lines.append(f"  ⚠ {warning}")
            lines.append("")
        
        # 内容预览
        if self.options.debug_level in [DebugLevel.DETAILED, DebugLevel.VERBOSE]:
            content_data = self._load_content_data(artifact_index)
            if content_data:
                lines.append("内容预览:")
                for i, item in enumerate(content_data[:5]):  # 只显示前5项
                    content = item.get("content", "")
                    if len(content) > self.options.max_content_length:
                        content = content[:self.options.max_content_length] + "..."
                    lines.append(f"  [{i+1}] {item.get('type', 'unknown')}: {content}")
                if len(content_data) > 5:
                    lines.append(f"  ... 还有 {len(content_data) - 5} 项")
                lines.append("")
        
        return '\n'.join(lines)
    
    def _generate_coordinate_map(self, artifact_index: ArtifactIndex) -> str:
        """生成坐标映射图"""
        model_data = self._load_model_data(artifact_index)
        if not model_data or "pages" not in model_data:
            return "<html><body><h1>无坐标数据</h1></body></html>"
        
        html_parts = []
        html_parts.append(self._get_html_header("坐标映射图"))
        
        html_parts.append("""
        <style>
        .page-container {
            margin: 20px 0;
            border: 1px solid #ddd;
            padding: 10px;
        }
        .coordinate-box {
            position: absolute;
            border: 2px solid red;
            background: rgba(255, 0, 0, 0.1);
            font-size: 10px;
            color: red;
        }
        .page-canvas {
            position: relative;
            background: #f9f9f9;
            border: 1px solid #ccc;
            margin: 10px 0;
        }
        </style>
        """)
        
        for page_idx, page in enumerate(model_data["pages"]):
            html_parts.append(f"<div class='page-container'>")
            html_parts.append(f"<h3>第 {page_idx + 1} 页</h3>")
            
            # 获取页面尺寸
            page_width = page.get("width", 800)
            page_height = page.get("height", 1000)
            
            html_parts.append(f"<div class='page-canvas' style='width: {page_width}px; height: {page_height}px;'>")
            
            # 添加文本框
            if "blocks" in page:
                for block_idx, block in enumerate(page["blocks"]):
                    if "bbox" in block:
                        bbox = block["bbox"]
                        x, y, w, h = bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]
                        
                        content = block.get("text", f"Block {block_idx}")
                        if len(content) > 20:
                            content = content[:20] + "..."
                        
                        html_parts.append(f"""
                        <div class='coordinate-box' 
                             style='left: {x}px; top: {y}px; width: {w}px; height: {h}px;'
                             title='{block.get("text", "")}'>
                            {content}
                        </div>
                        """)
            
            html_parts.append("</div>")
            html_parts.append("</div>")
        
        html_parts.append(self._get_html_footer())
        return '\n'.join(html_parts)
    
    def _load_content_data(self, artifact_index: ArtifactIndex) -> Optional[List[Dict]]:
        """加载内容数据"""
        content_list_path = artifact_index.get_artifact(ArtifactType.CONTENT_LIST_JSON)
        if not content_list_path or not content_list_path.exists():
            return None
        
        try:
            with open(content_list_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.warning(f"加载内容数据失败: {e}")
            return None
    
    def _load_model_data(self, artifact_index: ArtifactIndex) -> Optional[Dict]:
        """加载模型数据"""
        model_path = artifact_index.get_artifact(ArtifactType.MODEL_JSON)
        if not model_path or not model_path.exists():
            return None
        
        try:
            with open(model_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.warning(f"加载模型数据失败: {e}")
            return None
    
    def _calculate_statistics(self, artifact_index: ArtifactIndex) -> Dict[str, Any]:
        """计算统计信息"""
        stats = {
            "total_artifacts": 0,
            "existing_artifacts": 0,
            "total_size": 0,
            "content_items": 0,
            "model_pages": 0
        }
        
        # 统计工件
        for artifact_type in ArtifactType:
            path = artifact_index.get_artifact(artifact_type)
            if path:
                stats["total_artifacts"] += 1
                if path.exists():
                    stats["existing_artifacts"] += 1
                    stats["total_size"] += path.stat().st_size
        
        # 统计内容项
        content_data = self._load_content_data(artifact_index)
        if content_data:
            stats["content_items"] = len(content_data)
        
        # 统计模型页面
        model_data = self._load_model_data(artifact_index)
        if model_data and "pages" in model_data:
            stats["model_pages"] = len(model_data["pages"])
        
        return stats
    
    def _get_html_header(self, title: str = "AgenticX × MinerU 调试报告") -> str:
        """获取 HTML 头部"""
        return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1, h2, h3 {{
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 5px;
        }}
        .info-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }}
        .info-card {{
            background: #f9f9f9;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid #007acc;
        }}
        .file-list {{
            list-style: none;
            padding: 0;
        }}
        .file-item {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            margin: 5px 0;
            background: #f0f0f0;
            border-radius: 3px;
        }}
        .file-exists {{
            background: #e8f5e8;
        }}
        .file-missing {{
            background: #ffe8e8;
        }}
        .content-preview {{
            max-height: 400px;
            overflow-y: auto;
            background: #f9f9f9;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
        }}
        .error {{
            color: #d32f2f;
            background: #ffebee;
            padding: 10px;
            border-radius: 3px;
            margin: 5px 0;
        }}
        .warning {{
            color: #f57c00;
            background: #fff3e0;
            padding: 10px;
            border-radius: 3px;
            margin: 5px 0;
        }}
        .metric {{
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }}
        .status-success {{ color: #4caf50; }}
        .status-error {{ color: #f44336; }}
        .status-warning {{ color: #ff9800; }}
        .status-processing {{ color: #2196f3; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{title}</h1>
        <p>生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
"""
    
    def _get_html_footer(self) -> str:
        """获取 HTML 尾部"""
        return """
    </div>
</body>
</html>
"""
    
    def _generate_document_info_html(self, artifact_index: ArtifactIndex) -> str:
        """生成文档信息 HTML"""
        status_class = {
            "completed": "status-success",
            "failed": "status-error",
            "processing": "status-processing"
        }.get(artifact_index.status, "")
        
        return f"""
        <h2>文档信息</h2>
        <div class="info-grid">
            <div class="info-card">
                <h3>基本信息</h3>
                <div class="metric">
                    <span>任务ID:</span>
                    <span>{artifact_index.task_id}</span>
                </div>
                <div class="metric">
                    <span>状态:</span>
                    <span class="{status_class}">{artifact_index.status}</span>
                </div>
                <div class="metric">
                    <span>后端类型:</span>
                    <span>{artifact_index.backend_type or 'N/A'}</span>
                </div>
                {f'<div class="metric"><span>源文件:</span><span>{artifact_index.source_path.name}</span></div>' if artifact_index.source_path else ''}
                {f'<div class="metric"><span>页数:</span><span>{artifact_index.page_count}</span></div>' if artifact_index.page_count else ''}
                {f'<div class="metric"><span>处理时间:</span><span>{artifact_index.processing_time:.2f} 秒</span></div>' if artifact_index.processing_time else ''}
            </div>
            <div class="info-card">
                <h3>时间信息</h3>
                {f'<div class="metric"><span>创建时间:</span><span>{artifact_index.created_at.strftime("%Y-%m-%d %H:%M:%S")}</span></div>' if artifact_index.created_at else ''}
                {f'<div class="metric"><span>更新时间:</span><span>{artifact_index.updated_at.strftime("%Y-%m-%d %H:%M:%S")}</span></div>' if artifact_index.updated_at else ''}
            </div>
        </div>
        """
    
    def _generate_file_list_html(self, artifact_index: ArtifactIndex) -> str:
        """生成文件列表 HTML"""
        html = ["<h2>输出文件</h2>", "<ul class='file-list'>"]
        
        for artifact_type in ArtifactType:
            path = artifact_index.get_artifact(artifact_type)
            if path:
                exists = path.exists()
                size = path.stat().st_size if exists else 0
                status_icon = "✓" if exists else "✗"
                css_class = "file-exists" if exists else "file-missing"
                
                html.append(f"""
                <li class="file-item {css_class}">
                    <span>{status_icon} {artifact_type.value}</span>
                    <span>{path.name} ({size:,} 字节)</span>
                </li>
                """)
        
        html.append("</ul>")
        return '\n'.join(html)
    
    def _generate_content_preview_html(self, content_data: List[Dict]) -> str:
        """生成内容预览 HTML"""
        html = ["<h2>内容预览</h2>"]
        
        if not content_data:
            html.append("<p>无内容数据</p>")
            return '\n'.join(html)
        
        html.append(f"<p>总计 {len(content_data)} 个内容项</p>")
        html.append("<div class='content-preview'>")
        
        for i, item in enumerate(content_data[:10]):  # 只显示前10项
            content = item.get("content", "")
            if len(content) > self.options.max_content_length:
                content = content[:self.options.max_content_length] + "..."
            
            html.append(f"""
            <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd;">
                <strong>[{i+1}] {item.get('type', 'unknown')}</strong>
                {f"<span style='color: #666;'> (页面 {item.get('page_number', 'N/A')})</span>" if item.get('page_number') else ""}
                {f"<span style='color: #666;'> (置信度: {item.get('confidence', 'N/A')})</span>" if self.options.include_confidence and item.get('confidence') else ""}
                <br>
                <pre style="white-space: pre-wrap; margin: 5px 0;">{content}</pre>
            </div>
            """)
        
        if len(content_data) > 10:
            html.append(f"<p>... 还有 {len(content_data) - 10} 项</p>")
        
        html.append("</div>")
        return '\n'.join(html)
    
    def _generate_model_data_html(self, model_data: Dict) -> str:
        """生成模型数据 HTML"""
        html = ["<h2>模型数据</h2>"]
        
        if "pages" in model_data:
            html.append(f"<p>页面数量: {len(model_data['pages'])}</p>")
            
            for i, page in enumerate(model_data["pages"][:3]):  # 只显示前3页
                html.append(f"<h3>第 {i+1} 页</h3>")
                html.append("<div class='content-preview'>")
                html.append(f"<pre>{json.dumps(page, indent=2, ensure_ascii=False)[:1000]}...</pre>")
                html.append("</div>")
        
        return '\n'.join(html)
    
    def _generate_coordinates_html(self, model_data: Dict) -> str:
        """生成坐标信息 HTML"""
        if not self.options.include_coordinates or "pages" not in model_data:
            return ""
        
        html = ["<h2>坐标信息</h2>"]
        
        total_blocks = 0
        for page in model_data["pages"]:
            if "blocks" in page:
                total_blocks += len(page["blocks"])
        
        html.append(f"<p>总计 {total_blocks} 个文本块</p>")
        
        return '\n'.join(html)
    
    def _generate_quality_metrics_html(self, metrics: Dict[str, Any]) -> str:
        """生成质量指标 HTML"""
        html = ["<h2>质量指标</h2>", "<div class='info-card'>"]
        
        for key, value in metrics.items():
            if isinstance(value, float):
                html.append(f'<div class="metric"><span>{key}:</span><span>{value:.2f}</span></div>')
            else:
                html.append(f'<div class="metric"><span>{key}:</span><span>{value}</span></div>')
        
        html.append("</div>")
        return '\n'.join(html)
    
    def _generate_issues_html(self, artifact_index: ArtifactIndex) -> str:
        """生成问题报告 HTML"""
        html = ["<h2>问题报告</h2>"]
        
        if artifact_index.errors:
            html.append("<h3>错误</h3>")
            for error in artifact_index.errors:
                html.append(f'<div class="error">✗ {error}</div>')
        
        if artifact_index.warnings:
            html.append("<h3>警告</h3>")
            for warning in artifact_index.warnings:
                html.append(f'<div class="warning">⚠ {warning}</div>')
        
        return '\n'.join(html)