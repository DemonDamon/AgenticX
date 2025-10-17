"""
错误分类器 - 对 MinerU 解析过程中的错误进行分类和分析
"""

import re
import traceback
from typing import Dict, List, Optional, Any, Tuple, Pattern
from pydantic import BaseModel, Field
from enum import Enum
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ErrorCategory(str, Enum):
    """错误类别枚举"""
    # 输入相关错误
    INPUT_FILE_ERROR = "input_file_error"           # 输入文件错误
    INPUT_FORMAT_ERROR = "input_format_error"       # 输入格式错误
    INPUT_PERMISSION_ERROR = "input_permission_error" # 输入权限错误
    
    # 网络相关错误
    NETWORK_CONNECTION_ERROR = "network_connection_error"  # 网络连接错误
    NETWORK_TIMEOUT_ERROR = "network_timeout_error"        # 网络超时错误
    NETWORK_RATE_LIMIT_ERROR = "network_rate_limit_error"  # 网络限流错误
    
    # API 相关错误
    API_AUTHENTICATION_ERROR = "api_authentication_error"  # API 认证错误
    API_QUOTA_ERROR = "api_quota_error"                    # API 配额错误
    API_SERVER_ERROR = "api_server_error"                  # API 服务器错误
    
    # 解析相关错误
    PARSING_ERROR = "parsing_error"                        # 解析错误
    MODEL_ERROR = "model_error"                           # 模型错误
    PROCESSING_ERROR = "processing_error"                  # 处理错误
    
    # 输出相关错误
    OUTPUT_WRITE_ERROR = "output_write_error"              # 输出写入错误
    OUTPUT_FORMAT_ERROR = "output_format_error"            # 输出格式错误
    OUTPUT_PERMISSION_ERROR = "output_permission_error"    # 输出权限错误
    
    # 系统相关错误
    MEMORY_ERROR = "memory_error"                          # 内存错误
    DISK_SPACE_ERROR = "disk_space_error"                 # 磁盘空间错误
    SYSTEM_ERROR = "system_error"                          # 系统错误
    
    # 配置相关错误
    CONFIG_ERROR = "config_error"                          # 配置错误
    DEPENDENCY_ERROR = "dependency_error"                  # 依赖错误
    
    # 未知错误
    UNKNOWN_ERROR = "unknown_error"                        # 未知错误


class ErrorSeverity(str, Enum):
    """错误严重程度枚举"""
    CRITICAL = "critical"    # 严重错误，需要立即处理
    HIGH = "high"           # 高级错误，影响功能
    MEDIUM = "medium"       # 中级错误，可能影响性能
    LOW = "low"             # 低级错误，轻微影响
    INFO = "info"           # 信息性错误，仅记录


class ErrorPattern(BaseModel):
    """错误模式"""
    pattern: str = Field(..., description="错误匹配模式（正则表达式）")
    category: ErrorCategory = Field(..., description="错误类别")
    severity: ErrorSeverity = Field(..., description="错误严重程度")
    description: str = Field(..., description="错误描述")
    suggestions: List[str] = Field(default_factory=list, description="解决建议")
    
    def matches(self, error_text: str) -> bool:
        """检查错误文本是否匹配此模式"""
        try:
            return bool(re.search(self.pattern, error_text, re.IGNORECASE))
        except re.error:
            logger.warning(f"无效的正则表达式模式: {self.pattern}")
            return False


class ClassifiedError(BaseModel):
    """分类后的错误"""
    original_error: str = Field(..., description="原始错误信息")
    category: ErrorCategory = Field(..., description="错误类别")
    severity: ErrorSeverity = Field(..., description="错误严重程度")
    description: str = Field(..., description="错误描述")
    suggestions: List[str] = Field(default_factory=list, description="解决建议")
    
    # 错误上下文
    error_type: Optional[str] = Field(None, description="错误类型")
    error_code: Optional[str] = Field(None, description="错误代码")
    stack_trace: Optional[str] = Field(None, description="堆栈跟踪")
    
    # 分类信息
    matched_pattern: Optional[str] = Field(None, description="匹配的模式")
    confidence: float = Field(1.0, description="分类置信度")
    
    # 时间戳
    timestamp: datetime = Field(default_factory=datetime.now, description="分类时间")
    
    def is_retryable(self) -> bool:
        """判断错误是否可重试"""
        retryable_categories = {
            ErrorCategory.NETWORK_CONNECTION_ERROR,
            ErrorCategory.NETWORK_TIMEOUT_ERROR,
            ErrorCategory.API_SERVER_ERROR,
            ErrorCategory.MEMORY_ERROR,
            ErrorCategory.SYSTEM_ERROR
        }
        return self.category in retryable_categories and self.severity != ErrorSeverity.CRITICAL
    
    def is_user_fixable(self) -> bool:
        """判断错误是否可由用户修复"""
        user_fixable_categories = {
            ErrorCategory.INPUT_FILE_ERROR,
            ErrorCategory.INPUT_FORMAT_ERROR,
            ErrorCategory.INPUT_PERMISSION_ERROR,
            ErrorCategory.OUTPUT_PERMISSION_ERROR,
            ErrorCategory.CONFIG_ERROR,
            ErrorCategory.API_AUTHENTICATION_ERROR,
            ErrorCategory.DISK_SPACE_ERROR
        }
        return self.category in user_fixable_categories


class ErrorClassifier:
    """错误分类器"""
    
    def __init__(self):
        """初始化错误分类器"""
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        self.error_patterns = self._initialize_error_patterns()
        self.classification_history: List[ClassifiedError] = []
    
    def _initialize_error_patterns(self) -> List[ErrorPattern]:
        """初始化错误模式"""
        patterns = [
            # 输入文件错误
            ErrorPattern(
                pattern=r"(file not found|no such file|cannot find|文件不存在)",
                category=ErrorCategory.INPUT_FILE_ERROR,
                severity=ErrorSeverity.HIGH,
                description="输入文件不存在",
                suggestions=["检查文件路径是否正确", "确认文件是否存在", "检查文件权限"]
            ),
            ErrorPattern(
                pattern=r"(permission denied|access denied|权限不足)",
                category=ErrorCategory.INPUT_PERMISSION_ERROR,
                severity=ErrorSeverity.HIGH,
                description="文件权限不足",
                suggestions=["检查文件读取权限", "使用管理员权限运行", "修改文件权限"]
            ),
            ErrorPattern(
                pattern=r"(unsupported format|invalid format|格式不支持|格式错误)",
                category=ErrorCategory.INPUT_FORMAT_ERROR,
                severity=ErrorSeverity.MEDIUM,
                description="不支持的文件格式",
                suggestions=["检查文件格式是否支持", "转换文件格式", "使用正确的文件扩展名"]
            ),
            
            # 网络错误
            ErrorPattern(
                pattern=r"(connection error|connection failed|network error|连接失败|网络错误)",
                category=ErrorCategory.NETWORK_CONNECTION_ERROR,
                severity=ErrorSeverity.HIGH,
                description="网络连接失败",
                suggestions=["检查网络连接", "检查防火墙设置", "稍后重试"]
            ),
            ErrorPattern(
                pattern=r"(timeout|timed out|超时)",
                category=ErrorCategory.NETWORK_TIMEOUT_ERROR,
                severity=ErrorSeverity.MEDIUM,
                description="网络请求超时",
                suggestions=["增加超时时间", "检查网络速度", "稍后重试"]
            ),
            ErrorPattern(
                pattern=r"(rate limit|too many requests|限流|请求过多)",
                category=ErrorCategory.NETWORK_RATE_LIMIT_ERROR,
                severity=ErrorSeverity.MEDIUM,
                description="请求频率过高",
                suggestions=["降低请求频率", "等待一段时间后重试", "检查API限制"]
            ),
            
            # API 错误
            ErrorPattern(
                pattern=r"(unauthorized|authentication failed|invalid token|认证失败|token无效)",
                category=ErrorCategory.API_AUTHENTICATION_ERROR,
                severity=ErrorSeverity.HIGH,
                description="API认证失败",
                suggestions=["检查API密钥", "更新认证信息", "确认API权限"]
            ),
            ErrorPattern(
                pattern=r"(quota exceeded|usage limit|配额超出|使用限制)",
                category=ErrorCategory.API_QUOTA_ERROR,
                severity=ErrorSeverity.HIGH,
                description="API配额超出",
                suggestions=["检查API使用量", "升级API套餐", "等待配额重置"]
            ),
            ErrorPattern(
                pattern=r"(server error|internal error|5\d\d|服务器错误|内部错误)",
                category=ErrorCategory.API_SERVER_ERROR,
                severity=ErrorSeverity.HIGH,
                description="API服务器错误",
                suggestions=["稍后重试", "联系API提供商", "检查服务状态"]
            ),
            
            # 解析错误
            ErrorPattern(
                pattern=r"(parsing error|parse failed|解析错误|解析失败)",
                category=ErrorCategory.PARSING_ERROR,
                severity=ErrorSeverity.MEDIUM,
                description="文档解析失败",
                suggestions=["检查文档内容", "尝试其他解析参数", "联系技术支持"]
            ),
            ErrorPattern(
                pattern=r"(model error|model failed|模型错误|模型失败)",
                category=ErrorCategory.MODEL_ERROR,
                severity=ErrorSeverity.HIGH,
                description="模型处理错误",
                suggestions=["检查模型配置", "尝试其他模型", "联系技术支持"]
            ),
            
            # 系统错误
            ErrorPattern(
                pattern=r"(out of memory|memory error|内存不足|内存错误)",
                category=ErrorCategory.MEMORY_ERROR,
                severity=ErrorSeverity.HIGH,
                description="内存不足",
                suggestions=["释放内存", "增加系统内存", "减少处理文件大小"]
            ),
            ErrorPattern(
                pattern=r"(no space|disk full|磁盘空间不足|磁盘已满)",
                category=ErrorCategory.DISK_SPACE_ERROR,
                severity=ErrorSeverity.HIGH,
                description="磁盘空间不足",
                suggestions=["清理磁盘空间", "删除临时文件", "更换存储位置"]
            ),
            
            # 输出错误
            ErrorPattern(
                pattern=r"(write error|cannot write|写入错误|无法写入)",
                category=ErrorCategory.OUTPUT_WRITE_ERROR,
                severity=ErrorSeverity.HIGH,
                description="输出文件写入失败",
                suggestions=["检查输出目录权限", "确保磁盘空间充足", "检查文件是否被占用"]
            ),
            
            # 配置错误
            ErrorPattern(
                pattern=r"(config error|configuration|配置错误|配置问题)",
                category=ErrorCategory.CONFIG_ERROR,
                severity=ErrorSeverity.MEDIUM,
                description="配置错误",
                suggestions=["检查配置文件", "使用默认配置", "参考配置文档"]
            ),
            
            # 依赖错误
            ErrorPattern(
                pattern=r"(import error|module not found|dependency|依赖错误|模块未找到)",
                category=ErrorCategory.DEPENDENCY_ERROR,
                severity=ErrorSeverity.HIGH,
                description="依赖模块错误",
                suggestions=["安装缺失的依赖", "检查Python环境", "更新依赖版本"]
            )
        ]
        
        return patterns
    
    def classify(self, error: Exception, context: Optional[Dict[str, Any]] = None) -> ClassifiedError:
        """
        分类错误
        
        Args:
            error: 异常对象
            context: 错误上下文信息
            
        Returns:
            ClassifiedError: 分类后的错误
        """
        # 提取错误信息
        error_text = str(error)
        error_type = type(error).__name__
        stack_trace = traceback.format_exc()
        
        # 尝试匹配错误模式
        matched_pattern = None
        category = ErrorCategory.UNKNOWN_ERROR
        severity = ErrorSeverity.MEDIUM
        description = "未知错误"
        suggestions = ["联系技术支持", "查看详细日志"]
        confidence = 0.5
        
        for pattern in self.error_patterns:
            if pattern.matches(error_text) or pattern.matches(stack_trace):
                matched_pattern = pattern.pattern
                category = pattern.category
                severity = pattern.severity
                description = pattern.description
                suggestions = pattern.suggestions
                confidence = 1.0
                break
        
        # 基于错误类型的额外分类
        if not matched_pattern:
            category, severity, description, suggestions = self._classify_by_type(error_type, error_text)
            confidence = 0.7
        
        # 创建分类结果
        classified_error = ClassifiedError(
            original_error=error_text,
            category=category,
            severity=severity,
            description=description,
            suggestions=suggestions,
            error_type=error_type,
            stack_trace=stack_trace,
            matched_pattern=matched_pattern,
            confidence=confidence,
            context=context or {},
            timestamp=datetime.now()
        )
        
        # 记录分类历史
        self.classification_history.append(classified_error)
        
        # 记录日志
        self.logger.info(
            f"错误分类完成: {category.value} (置信度: {confidence:.2f})",
            extra={
                "error_type": error_type,
                "category": category.value,
                "severity": severity.value,
                "confidence": confidence
            }
        )
        
        return classified_error
    
    def _classify_by_type(self, error_type: str, error_text: str) -> Tuple[ErrorCategory, ErrorSeverity, str, List[str]]:
        """
        基于错误类型进行分类
        
        Args:
            error_type: 错误类型名称
            error_text: 错误文本
            
        Returns:
            Tuple[ErrorCategory, ErrorSeverity, str, List[str]]: 分类结果
        """
        type_mapping = {
            "FileNotFoundError": (
                ErrorCategory.INPUT_FILE_ERROR,
                ErrorSeverity.HIGH,
                "文件未找到",
                ["检查文件路径", "确认文件存在"]
            ),
            "PermissionError": (
                ErrorCategory.INPUT_PERMISSION_ERROR,
                ErrorSeverity.HIGH,
                "权限错误",
                ["检查文件权限", "使用管理员权限"]
            ),
            "ConnectionError": (
                ErrorCategory.NETWORK_CONNECTION_ERROR,
                ErrorSeverity.HIGH,
                "网络连接错误",
                ["检查网络连接", "稍后重试"]
            ),
            "TimeoutError": (
                ErrorCategory.NETWORK_TIMEOUT_ERROR,
                ErrorSeverity.MEDIUM,
                "超时错误",
                ["增加超时时间", "稍后重试"]
            ),
            "MemoryError": (
                ErrorCategory.MEMORY_ERROR,
                ErrorSeverity.HIGH,
                "内存错误",
                ["释放内存", "减少处理量"]
            ),
            "ImportError": (
                ErrorCategory.DEPENDENCY_ERROR,
                ErrorSeverity.HIGH,
                "导入错误",
                ["安装缺失依赖", "检查环境"]
            ),
            "ModuleNotFoundError": (
                ErrorCategory.DEPENDENCY_ERROR,
                ErrorSeverity.HIGH,
                "模块未找到",
                ["安装缺失模块", "检查Python路径"]
            ),
            "ValueError": (
                ErrorCategory.CONFIG_ERROR,
                ErrorSeverity.MEDIUM,
                "值错误",
                ["检查输入参数", "验证配置"]
            ),
            "TypeError": (
                ErrorCategory.CONFIG_ERROR,
                ErrorSeverity.MEDIUM,
                "类型错误",
                ["检查参数类型", "验证输入"]
            )
        }
        
        return type_mapping.get(
            error_type,
            (
                ErrorCategory.UNKNOWN_ERROR,
                ErrorSeverity.MEDIUM,
                f"未知错误类型: {error_type}",
                ["联系技术支持", "查看详细日志"]
            )
        )
    
    def get_classification_stats(self) -> Dict[str, Any]:
        """
        获取分类统计信息
        
        Returns:
            Dict[str, Any]: 统计信息
        """
        if not self.classification_history:
            return {"total": 0, "categories": {}, "severities": {}}
        
        category_counts = {}
        severity_counts = {}
        
        for classified_error in self.classification_history:
            # 统计分类
            category = classified_error.category.value
            category_counts[category] = category_counts.get(category, 0) + 1
            
            # 统计严重程度
            severity = classified_error.severity.value
            severity_counts[severity] = severity_counts.get(severity, 0) + 1
        
        return {
            "total": len(self.classification_history),
            "categories": category_counts,
            "severities": severity_counts,
            "recent_errors": [
                {
                    "category": err.category.value,
                    "severity": err.severity.value,
                    "description": err.description,
                    "timestamp": err.timestamp.isoformat()
                }
                for err in self.classification_history[-10:]  # 最近10个错误
            ]
        }
    
    def clear_history(self) -> None:
        """清除分类历史"""
        self.classification_history.clear()
        self.logger.info("错误分类历史已清除")