"""
重试策略 - 为 MinerU 解析任务提供智能重试机制
"""

import asyncio
import time
import random
from typing import Dict, List, Optional, Any, Callable, Union, Awaitable
from pydantic import BaseModel, Field
from enum import Enum
import logging
from datetime import datetime, timedelta
from functools import wraps

from .error_classifier import ErrorClassifier, ClassifiedError, ErrorCategory, ErrorSeverity

logger = logging.getLogger(__name__)


class RetryStrategy(str, Enum):
    """重试策略枚举"""
    FIXED_DELAY = "fixed_delay"              # 固定延迟
    EXPONENTIAL_BACKOFF = "exponential_backoff"  # 指数退避
    LINEAR_BACKOFF = "linear_backoff"        # 线性退避
    RANDOM_JITTER = "random_jitter"          # 随机抖动
    ADAPTIVE = "adaptive"                    # 自适应策略


class RetryResult(BaseModel):
    """重试结果"""
    success: bool = Field(..., description="是否成功")
    attempts: int = Field(..., description="尝试次数")
    total_time: float = Field(..., description="总耗时（秒）")
    last_error: Optional[str] = Field(None, description="最后一次错误")
    classified_error: Optional[ClassifiedError] = Field(None, description="分类后的错误")
    retry_delays: List[float] = Field(default_factory=list, description="每次重试的延迟时间")
    
    # 统计信息
    error_categories: List[str] = Field(default_factory=list, description="遇到的错误类别")
    strategy_used: Optional[str] = Field(None, description="使用的重试策略")
    
    def add_attempt(self, delay: float, error: Optional[Exception] = None, classified_error: Optional[ClassifiedError] = None):
        """添加重试尝试记录"""
        self.attempts += 1
        self.retry_delays.append(delay)
        
        if error:
            self.last_error = str(error)
        
        if classified_error:
            self.classified_error = classified_error
            if classified_error.category not in self.error_categories:
                self.error_categories.append(classified_error.category)


class RetryConfig(BaseModel):
    """重试配置"""
    strategy: RetryStrategy = Field(RetryStrategy.EXPONENTIAL_BACKOFF, description="重试策略")
    max_attempts: int = Field(3, description="最大重试次数")
    base_delay: float = Field(1.0, description="基础延迟时间（秒）")
    max_delay: float = Field(60.0, description="最大延迟时间（秒）")
    backoff_factor: float = Field(2.0, description="退避因子")
    jitter_range: float = Field(0.1, description="抖动范围（0-1）")
    
    # 错误类别特定配置
    category_configs: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict, 
        description="针对特定错误类别的配置"
    )
    
    # 条件配置
    retry_on_categories: Optional[List[ErrorCategory]] = Field(None, description="允许重试的错误类别")
    no_retry_on_categories: Optional[List[ErrorCategory]] = Field(None, description="不允许重试的错误类别")
    retry_on_severities: Optional[List[ErrorSeverity]] = Field(None, description="允许重试的错误严重程度")
    
    def should_retry(self, classified_error: ClassifiedError, attempt: int) -> bool:
        """判断是否应该重试"""
        # 检查最大尝试次数
        if attempt >= self.max_attempts:
            return False
        
        # 检查错误类别黑名单
        if self.no_retry_on_categories and classified_error.category in self.no_retry_on_categories:
            return False
        
        # 检查错误类别白名单
        if self.retry_on_categories and classified_error.category not in self.retry_on_categories:
            return False
        
        # 检查错误严重程度
        if self.retry_on_severities and classified_error.severity not in self.retry_on_severities:
            return False
        
        # 检查错误是否可重试
        if not classified_error.is_retryable():
            return False
        
        return True
    
    def get_category_config(self, category: ErrorCategory) -> Dict[str, Any]:
        """获取特定错误类别的配置"""
        return self.category_configs.get(category, {})


class RetryPolicy:
    """重试策略管理器"""
    
    def __init__(self, config: Optional[RetryConfig] = None, error_classifier: Optional[ErrorClassifier] = None):
        """
        初始化重试策略
        
        Args:
            config: 重试配置
            error_classifier: 错误分类器
        """
        self.config = config or RetryConfig()
        self.error_classifier = error_classifier or ErrorClassifier()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        
        # 统计信息
        self.retry_statistics: Dict[str, Any] = {
            "total_retries": 0,
            "successful_retries": 0,
            "failed_retries": 0,
            "category_retries": {},
            "strategy_usage": {}
        }
    
    def calculate_delay(self, attempt: int, classified_error: Optional[ClassifiedError] = None) -> float:
        """
        计算重试延迟时间
        
        Args:
            attempt: 当前尝试次数（从1开始）
            classified_error: 分类后的错误
            
        Returns:
            float: 延迟时间（秒）
        """
        # 获取基础配置
        base_delay = self.config.base_delay
        max_delay = self.config.max_delay
        backoff_factor = self.config.backoff_factor
        
        # 如果有分类错误，检查是否有特定配置
        if classified_error:
            category_config = self.config.get_category_config(classified_error.category)
            base_delay = category_config.get("base_delay", base_delay)
            max_delay = category_config.get("max_delay", max_delay)
            backoff_factor = category_config.get("backoff_factor", backoff_factor)
        
        # 根据策略计算延迟
        if self.config.strategy == RetryStrategy.FIXED_DELAY:
            delay = base_delay
            
        elif self.config.strategy == RetryStrategy.EXPONENTIAL_BACKOFF:
            delay = base_delay * (backoff_factor ** (attempt - 1))
            
        elif self.config.strategy == RetryStrategy.LINEAR_BACKOFF:
            delay = base_delay * attempt
            
        elif self.config.strategy == RetryStrategy.RANDOM_JITTER:
            jitter = random.uniform(-self.config.jitter_range, self.config.jitter_range)
            delay = base_delay * (1 + jitter)
            
        elif self.config.strategy == RetryStrategy.ADAPTIVE:
            # 自适应策略：根据错误类型和历史成功率调整
            delay = self._calculate_adaptive_delay(attempt, classified_error)
            
        else:
            delay = base_delay
        
        # 应用最大延迟限制
        delay = min(delay, max_delay)
        
        # 添加随机抖动（避免雷群效应）
        if self.config.strategy != RetryStrategy.RANDOM_JITTER:
            jitter = random.uniform(0.9, 1.1)
            delay *= jitter
        
        return max(0.1, delay)  # 最小延迟0.1秒
    
    def _calculate_adaptive_delay(self, attempt: int, classified_error: Optional[ClassifiedError] = None) -> float:
        """计算自适应延迟"""
        base_delay = self.config.base_delay
        
        if not classified_error:
            return base_delay * (2 ** (attempt - 1))
        
        # 根据错误类别调整
        category_multipliers = {
            ErrorCategory.NETWORK_TIMEOUT_ERROR: 2.0,
            ErrorCategory.NETWORK_CONNECTION_ERROR: 1.5,
            ErrorCategory.API_SERVER_ERROR: 3.0,
            ErrorCategory.NETWORK_RATE_LIMIT_ERROR: 5.0,
            ErrorCategory.MEMORY_ERROR: 1.0,
            ErrorCategory.SYSTEM_ERROR: 2.0
        }
        
        multiplier = category_multipliers.get(classified_error.category, 1.0)
        
        # 根据错误严重程度调整
        severity_multipliers = {
            ErrorSeverity.CRITICAL: 0.5,  # 严重错误快速重试
            ErrorSeverity.HIGH: 1.0,
            ErrorSeverity.MEDIUM: 1.5,
            ErrorSeverity.LOW: 2.0
        }
        
        severity_multiplier = severity_multipliers.get(classified_error.severity, 1.0)
        
        # 计算最终延迟
        delay = base_delay * multiplier * severity_multiplier * (1.5 ** (attempt - 1))
        
        return delay
    
    async def retry_async(
        self, 
        func: Callable[..., Awaitable[Any]], 
        *args, 
        **kwargs
    ) -> RetryResult:
        """
        异步重试执行函数
        
        Args:
            func: 要重试的异步函数
            *args: 函数参数
            **kwargs: 函数关键字参数
            
        Returns:
            RetryResult: 重试结果
        """
        result = RetryResult(
            success=False,
            attempts=0,
            total_time=0.0,
            strategy_used=self.config.strategy
        )
        
        start_time = time.time()
        last_error = None
        classified_error = None
        
        for attempt in range(1, self.config.max_attempts + 1):
            try:
                # 执行函数
                return_value = await func(*args, **kwargs)
                
                # 成功执行
                result.success = True
                result.total_time = time.time() - start_time
                
                # 更新统计信息
                self._update_statistics(True, classified_error)
                
                self.logger.info(f"函数执行成功，尝试次数: {attempt}")
                return result
                
            except Exception as error:
                last_error = error
                classified_error = self.error_classifier.classify(error)
                
                # 记录尝试
                delay = 0.0 if attempt == self.config.max_attempts else self.calculate_delay(attempt, classified_error)
                result.add_attempt(delay, error, classified_error)
                
                # 检查是否应该重试
                if not self.config.should_retry(classified_error, attempt):
                    self.logger.warning(f"错误不可重试: {classified_error.category} - {classified_error.description}")
                    break
                
                # 如果不是最后一次尝试，等待后重试
                if attempt < self.config.max_attempts:
                    self.logger.warning(f"第 {attempt} 次尝试失败: {error}, {delay:.2f}秒后重试")
                    await asyncio.sleep(delay)
                else:
                    self.logger.error(f"所有重试尝试都失败了")
        
        # 所有尝试都失败
        result.total_time = time.time() - start_time
        result.last_error = str(last_error) if last_error else "未知错误"
        result.classified_error = classified_error
        
        # 更新统计信息
        self._update_statistics(False, classified_error)
        
        return result
    
    def retry_sync(
        self, 
        func: Callable[..., Any], 
        *args, 
        **kwargs
    ) -> RetryResult:
        """
        同步重试执行函数
        
        Args:
            func: 要重试的同步函数
            *args: 函数参数
            **kwargs: 函数关键字参数
            
        Returns:
            RetryResult: 重试结果
        """
        result = RetryResult(
            success=False,
            attempts=0,
            total_time=0.0,
            strategy_used=self.config.strategy
        )
        
        start_time = time.time()
        last_error = None
        classified_error = None
        
        for attempt in range(1, self.config.max_attempts + 1):
            try:
                # 执行函数
                return_value = func(*args, **kwargs)
                
                # 成功执行
                result.success = True
                result.total_time = time.time() - start_time
                
                # 更新统计信息
                self._update_statistics(True, classified_error)
                
                self.logger.info(f"函数执行成功，尝试次数: {attempt}")
                return result
                
            except Exception as error:
                last_error = error
                classified_error = self.error_classifier.classify(error)
                
                # 记录尝试
                delay = 0.0 if attempt == self.config.max_attempts else self.calculate_delay(attempt, classified_error)
                result.add_attempt(delay, error, classified_error)
                
                # 检查是否应该重试
                if not self.config.should_retry(classified_error, attempt):
                    self.logger.warning(f"错误不可重试: {classified_error.category} - {classified_error.description}")
                    break
                
                # 如果不是最后一次尝试，等待后重试
                if attempt < self.config.max_attempts:
                    self.logger.warning(f"第 {attempt} 次尝试失败: {error}, {delay:.2f}秒后重试")
                    time.sleep(delay)
                else:
                    self.logger.error(f"所有重试尝试都失败了")
        
        # 所有尝试都失败
        result.total_time = time.time() - start_time
        result.last_error = str(last_error) if last_error else "未知错误"
        result.classified_error = classified_error
        
        # 更新统计信息
        self._update_statistics(False, classified_error)
        
        return result
    
    def _update_statistics(self, success: bool, classified_error: Optional[ClassifiedError]):
        """更新统计信息"""
        self.retry_statistics["total_retries"] += 1
        
        if success:
            self.retry_statistics["successful_retries"] += 1
        else:
            self.retry_statistics["failed_retries"] += 1
        
        if classified_error:
            category = classified_error.category
            if category not in self.retry_statistics["category_retries"]:
                self.retry_statistics["category_retries"][category] = {"total": 0, "success": 0}
            
            self.retry_statistics["category_retries"][category]["total"] += 1
            if success:
                self.retry_statistics["category_retries"][category]["success"] += 1
        
        strategy = self.config.strategy
        if strategy not in self.retry_statistics["strategy_usage"]:
            self.retry_statistics["strategy_usage"][strategy] = 0
        self.retry_statistics["strategy_usage"][strategy] += 1
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取重试统计信息"""
        stats = self.retry_statistics.copy()
        
        # 计算成功率
        total = stats["total_retries"]
        if total > 0:
            stats["success_rate"] = stats["successful_retries"] / total
            stats["failure_rate"] = stats["failed_retries"] / total
        else:
            stats["success_rate"] = 0.0
            stats["failure_rate"] = 0.0
        
        # 计算各类别成功率
        for category, data in stats["category_retries"].items():
            if data["total"] > 0:
                data["success_rate"] = data["success"] / data["total"]
            else:
                data["success_rate"] = 0.0
        
        return stats
    
    def reset_statistics(self):
        """重置统计信息"""
        self.retry_statistics = {
            "total_retries": 0,
            "successful_retries": 0,
            "failed_retries": 0,
            "category_retries": {},
            "strategy_usage": {}
        }


def retry_on_error(
    max_attempts: int = 3,
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL_BACKOFF,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    error_classifier: Optional[ErrorClassifier] = None
):
    """
    重试装饰器
    
    Args:
        max_attempts: 最大重试次数
        strategy: 重试策略
        base_delay: 基础延迟时间
        max_delay: 最大延迟时间
        error_classifier: 错误分类器
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            config = RetryConfig(
                strategy=strategy,
                max_attempts=max_attempts,
                base_delay=base_delay,
                max_delay=max_delay
            )
            policy = RetryPolicy(config, error_classifier)
            result = await policy.retry_async(func, *args, **kwargs)
            
            if not result.success:
                raise Exception(result.last_error)
            
            return await func(*args, **kwargs)
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            config = RetryConfig(
                strategy=strategy,
                max_attempts=max_attempts,
                base_delay=base_delay,
                max_delay=max_delay
            )
            policy = RetryPolicy(config, error_classifier)
            result = policy.retry_sync(func, *args, **kwargs)
            
            if not result.success:
                raise Exception(result.last_error)
            
            return func(*args, **kwargs)
        
        # 根据函数类型返回相应的包装器
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper
    
    return decorator