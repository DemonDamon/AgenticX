"""
结构化输出验证器 - 校验 model.json/middle.json/content_list.json 基本结构
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field, ValidationError
from enum import Enum
import logging

from .models import ArtifactIndex, ArtifactType

logger = logging.getLogger(__name__)


class ValidationLevel(str, Enum):
    """验证级别枚举"""
    BASIC = "basic"          # 基础结构验证
    STANDARD = "standard"    # 标准验证（包含字段类型）
    STRICT = "strict"        # 严格验证（包含数据完整性）


class ValidationStatus(str, Enum):
    """验证状态枚举"""
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"
    SKIPPED = "skipped"


class ValidationIssue(BaseModel):
    """验证问题模型"""
    level: str = Field(..., description="问题级别：error/warning/info")
    message: str = Field(..., description="问题描述")
    file_path: Optional[str] = Field(None, description="文件路径")
    field_path: Optional[str] = Field(None, description="字段路径")
    expected: Optional[Any] = Field(None, description="期望值")
    actual: Optional[Any] = Field(None, description="实际值")


class ValidationReport(BaseModel):
    """验证报告模型"""
    task_id: str = Field(..., description="任务ID")
    validation_level: ValidationLevel = Field(..., description="验证级别")
    overall_status: ValidationStatus = Field(..., description="总体状态")
    
    # 文件验证结果
    file_results: Dict[str, ValidationStatus] = Field(
        default_factory=dict, 
        description="文件验证结果"
    )
    
    # 验证问题
    issues: List[ValidationIssue] = Field(
        default_factory=list, 
        description="验证问题列表"
    )
    
    # 统计信息
    total_files: int = Field(0, description="总文件数")
    passed_files: int = Field(0, description="通过验证的文件数")
    failed_files: int = Field(0, description="验证失败的文件数")
    warning_files: int = Field(0, description="有警告的文件数")
    
    # 元数据
    validation_time: Optional[float] = Field(None, description="验证耗时（秒）")
    validator_version: str = Field("1.0.0", description="验证器版本")
    
    def add_issue(
        self, 
        level: str, 
        message: str, 
        file_path: Optional[str] = None,
        field_path: Optional[str] = None,
        expected: Optional[Any] = None,
        actual: Optional[Any] = None
    ):
        """添加验证问题"""
        issue = ValidationIssue(
            level=level,
            message=message,
            file_path=file_path,
            field_path=field_path,
            expected=expected,
            actual=actual
        )
        self.issues.append(issue)
    
    def get_issues_by_level(self, level: str) -> List[ValidationIssue]:
        """获取指定级别的问题"""
        return [issue for issue in self.issues if issue.level == level]
    
    def has_errors(self) -> bool:
        """是否有错误"""
        return len(self.get_issues_by_level("error")) > 0
    
    def has_warnings(self) -> bool:
        """是否有警告"""
        return len(self.get_issues_by_level("warning")) > 0


class StructuredOutputValidator:
    """结构化输出验证器"""
    
    def __init__(self, validation_level: ValidationLevel = ValidationLevel.STANDARD):
        """
        初始化验证器
        
        Args:
            validation_level: 验证级别
        """
        self.validation_level = validation_level
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    def validate(self, artifact_index: ArtifactIndex) -> ValidationReport:
        """
        验证工件索引
        
        Args:
            artifact_index: 工件索引
            
        Returns:
            ValidationReport: 验证报告
        """
        import time
        start_time = time.time()
        
        report = ValidationReport(
            task_id=artifact_index.task_id,
            validation_level=self.validation_level,
            overall_status=ValidationStatus.PASSED
        )
        
        try:
            # 验证各种类型的文件
            self._validate_markdown(artifact_index, report)
            self._validate_model_json(artifact_index, report)
            self._validate_middle_json(artifact_index, report)
            self._validate_content_list_json(artifact_index, report)
            
            # 计算统计信息
            self._calculate_statistics(report)
            
            # 确定总体状态
            if report.failed_files > 0:
                report.overall_status = ValidationStatus.FAILED
            elif report.warning_files > 0:
                report.overall_status = ValidationStatus.WARNING
            else:
                report.overall_status = ValidationStatus.PASSED
            
            report.validation_time = time.time() - start_time
            
            self.logger.info(f"验证完成: {artifact_index.task_id}, 状态: {report.overall_status}")
            return report
            
        except Exception as e:
            self.logger.error(f"验证过程出错: {e}")
            report.overall_status = ValidationStatus.FAILED
            report.add_issue("error", f"验证过程出错: {e}")
            return report
    
    def _validate_markdown(self, artifact_index: ArtifactIndex, report: ValidationReport):
        """验证 Markdown 文件"""
        markdown_path = artifact_index.get_artifact(ArtifactType.MARKDOWN)
        
        if not markdown_path:
            report.file_results["markdown"] = ValidationStatus.SKIPPED
            report.add_issue("info", "Markdown 文件不存在", "markdown")
            return
        
        try:
            if not markdown_path.exists():
                report.file_results["markdown"] = ValidationStatus.FAILED
                report.add_issue("error", "Markdown 文件路径无效", str(markdown_path))
                return
            
            # 读取文件内容
            content = markdown_path.read_text(encoding='utf-8')
            
            # 基础验证
            if not content.strip():
                report.file_results["markdown"] = ValidationStatus.FAILED
                report.add_issue("error", "Markdown 文件为空", str(markdown_path))
                return
            
            # 标准验证
            if self.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                # 检查是否包含基本的 Markdown 结构
                if not any(line.startswith('#') for line in content.split('\n')):
                    report.add_issue("warning", "Markdown 文件缺少标题结构", str(markdown_path))
            
            # 严格验证
            if self.validation_level == ValidationLevel.STRICT:
                # 检查文件大小
                file_size = markdown_path.stat().st_size
                if file_size < 100:  # 小于100字节可能内容不完整
                    report.add_issue("warning", f"Markdown 文件过小: {file_size} 字节", str(markdown_path))
            
            report.file_results["markdown"] = ValidationStatus.PASSED
            
        except Exception as e:
            report.file_results["markdown"] = ValidationStatus.FAILED
            report.add_issue("error", f"Markdown 文件验证失败: {e}", str(markdown_path))
    
    def _validate_model_json(self, artifact_index: ArtifactIndex, report: ValidationReport):
        """验证 model.json 文件"""
        model_path = artifact_index.get_artifact(ArtifactType.MODEL_JSON)
        
        if not model_path:
            report.file_results["model_json"] = ValidationStatus.SKIPPED
            report.add_issue("info", "model.json 文件不存在", "model_json")
            return
        
        try:
            if not model_path.exists():
                report.file_results["model_json"] = ValidationStatus.FAILED
                report.add_issue("error", "model.json 文件路径无效", str(model_path))
                return
            
            # 解析 JSON
            with open(model_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 基础验证
            if not isinstance(data, dict):
                report.file_results["model_json"] = ValidationStatus.FAILED
                report.add_issue("error", "model.json 根对象必须是字典", str(model_path))
                return
            
            # 标准验证
            if self.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                # 检查必需字段
                required_fields = ["pages"]
                for field in required_fields:
                    if field not in data:
                        report.add_issue("error", f"model.json 缺少必需字段: {field}", str(model_path), field)
                
                # 检查 pages 结构
                if "pages" in data:
                    if not isinstance(data["pages"], list):
                        report.add_issue("error", "pages 字段必须是数组", str(model_path), "pages")
                    else:
                        for i, page in enumerate(data["pages"]):
                            if not isinstance(page, dict):
                                report.add_issue("error", f"页面 {i} 必须是对象", str(model_path), f"pages[{i}]")
            
            # 严格验证
            if self.validation_level == ValidationLevel.STRICT:
                # 验证页面数量与索引一致
                if artifact_index.page_count and "pages" in data:
                    actual_pages = len(data["pages"])
                    if actual_pages != artifact_index.page_count:
                        report.add_issue(
                            "warning", 
                            f"页面数量不一致: 期望 {artifact_index.page_count}, 实际 {actual_pages}",
                            str(model_path),
                            "pages",
                            artifact_index.page_count,
                            actual_pages
                        )
            
            report.file_results["model_json"] = ValidationStatus.PASSED
            
        except json.JSONDecodeError as e:
            report.file_results["model_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"model.json JSON 格式错误: {e}", str(model_path))
        except Exception as e:
            report.file_results["model_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"model.json 验证失败: {e}", str(model_path))
    
    def _validate_middle_json(self, artifact_index: ArtifactIndex, report: ValidationReport):
        """验证 middle.json 文件"""
        middle_path = artifact_index.get_artifact(ArtifactType.MIDDLE_JSON)
        
        if not middle_path:
            report.file_results["middle_json"] = ValidationStatus.SKIPPED
            report.add_issue("info", "middle.json 文件不存在", "middle_json")
            return
        
        try:
            if not middle_path.exists():
                report.file_results["middle_json"] = ValidationStatus.FAILED
                report.add_issue("error", "middle.json 文件路径无效", str(middle_path))
                return
            
            # 解析 JSON
            with open(middle_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 基础验证
            if not isinstance(data, (dict, list)):
                report.file_results["middle_json"] = ValidationStatus.FAILED
                report.add_issue("error", "middle.json 必须是对象或数组", str(middle_path))
                return
            
            # 标准验证
            if self.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                # middle.json 通常包含处理过程中的中间数据
                # 这里可以根据具体的 MinerU 输出格式进行验证
                pass
            
            report.file_results["middle_json"] = ValidationStatus.PASSED
            
        except json.JSONDecodeError as e:
            report.file_results["middle_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"middle.json JSON 格式错误: {e}", str(middle_path))
        except Exception as e:
            report.file_results["middle_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"middle.json 验证失败: {e}", str(middle_path))
    
    def _validate_content_list_json(self, artifact_index: ArtifactIndex, report: ValidationReport):
        """验证 content_list.json 文件"""
        content_list_path = artifact_index.get_artifact(ArtifactType.CONTENT_LIST_JSON)
        
        if not content_list_path:
            report.file_results["content_list_json"] = ValidationStatus.SKIPPED
            report.add_issue("info", "content_list.json 文件不存在", "content_list_json")
            return
        
        try:
            if not content_list_path.exists():
                report.file_results["content_list_json"] = ValidationStatus.FAILED
                report.add_issue("error", "content_list.json 文件路径无效", str(content_list_path))
                return
            
            # 解析 JSON
            with open(content_list_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 基础验证
            if not isinstance(data, list):
                report.file_results["content_list_json"] = ValidationStatus.FAILED
                report.add_issue("error", "content_list.json 必须是数组", str(content_list_path))
                return
            
            # 标准验证
            if self.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                # 检查内容项结构
                for i, item in enumerate(data):
                    if not isinstance(item, dict):
                        report.add_issue("error", f"内容项 {i} 必须是对象", str(content_list_path), f"[{i}]")
                        continue
                    
                    # 检查常见字段
                    if "type" not in item:
                        report.add_issue("warning", f"内容项 {i} 缺少 type 字段", str(content_list_path), f"[{i}].type")
                    
                    if "content" not in item:
                        report.add_issue("warning", f"内容项 {i} 缺少 content 字段", str(content_list_path), f"[{i}].content")
            
            # 严格验证
            if self.validation_level == ValidationLevel.STRICT:
                # 检查内容是否为空
                if not data:
                    report.add_issue("warning", "content_list.json 为空数组", str(content_list_path))
            
            report.file_results["content_list_json"] = ValidationStatus.PASSED
            
        except json.JSONDecodeError as e:
            report.file_results["content_list_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"content_list.json JSON 格式错误: {e}", str(content_list_path))
        except Exception as e:
            report.file_results["content_list_json"] = ValidationStatus.FAILED
            report.add_issue("error", f"content_list.json 验证失败: {e}", str(content_list_path))
    
    def _calculate_statistics(self, report: ValidationReport):
        """计算统计信息"""
        report.total_files = len(report.file_results)
        
        for status in report.file_results.values():
            if status == ValidationStatus.PASSED:
                report.passed_files += 1
            elif status == ValidationStatus.FAILED:
                report.failed_files += 1
            elif status == ValidationStatus.WARNING:
                report.warning_files += 1