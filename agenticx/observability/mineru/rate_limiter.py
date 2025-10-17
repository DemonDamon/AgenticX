"""
速率限制器 - 为 MinerU 解析任务提供速率控制和流量管理
"""

import asyncio
import time
import threading
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field
from enum import Enum
import logging
from datetime import datetime, timedelta
from collections import deque, defaultdict
import weakref

logger = logging.getLogger(__name__)


class RateLimitStrategy(str, Enum):
    """速率限制策略枚举"""
    TOKEN_BUCKET = "token_bucket"        # 令牌桶算法
    SLIDING_WINDOW = "sliding_window"    # 滑动窗口算法
    FIXED_WINDOW = "fixed_window"        # 固定窗口算法
    LEAKY_BUCKET = "leaky_bucket"        # 漏桶算法
    ADAPTIVE = "adaptive"                # 自适应限制


class RateLimitScope(str, Enum):
    """速率限制范围"""
    GLOBAL = "global"                    # 全局限制
    PER_USER = "per_user"               # 按用户限制
    PER_IP = "per_ip"                   # 按IP限制
    PER_API_KEY = "per_api_key"         # 按API密钥限制
    PER_ENDPOINT = "per_endpoint"       # 按端点限制
    PER_RESOURCE = "per_resource"       # 按资源限制


class RateLimitConfig(BaseModel):
    """速率限制配置"""
    strategy: RateLimitStrategy = Field(RateLimitStrategy.TOKEN_BUCKET, description="限制策略")
    scope: RateLimitScope = Field(RateLimitScope.GLOBAL, description="限制范围")
    
    # 基础配置
    max_requests: int = Field(100, description="最大请求数")
    time_window: float = Field(60.0, description="时间窗口（秒）")
    
    # 令牌桶配置
    bucket_size: Optional[int] = Field(None, description="桶容量")
    refill_rate: Optional[float] = Field(None, description="令牌补充速率（每秒）")
    
    # 漏桶配置
    leak_rate: Optional[float] = Field(None, description="漏桶速率（每秒）")
    
    # 自适应配置
    adaptive_factor: float = Field(1.0, description="自适应因子")
    min_requests: int = Field(10, description="最小请求数")
    max_requests_adaptive: int = Field(1000, description="自适应最大请求数")
    
    # 突发配置
    burst_size: Optional[int] = Field(None, description="突发请求大小")
    burst_window: Optional[float] = Field(None, description="突发时间窗口")
    
    def get_effective_bucket_size(self) -> int:
        """获取有效的桶容量"""
        return self.bucket_size or self.max_requests
    
    def get_effective_refill_rate(self) -> float:
        """获取有效的令牌补充速率"""
        return self.refill_rate or (self.max_requests / self.time_window)


class RateLimitResult(BaseModel):
    """速率限制结果"""
    allowed: bool = Field(..., description="是否允许请求")
    remaining: int = Field(..., description="剩余请求数")
    reset_time: float = Field(..., description="重置时间戳")
    retry_after: Optional[float] = Field(None, description="建议重试时间（秒）")
    
    # 详细信息
    current_requests: int = Field(0, description="当前请求数")
    window_start: float = Field(0.0, description="窗口开始时间")
    window_end: float = Field(0.0, description="窗口结束时间")
    strategy_used: Optional[str] = Field(None, description="使用的策略")
    scope_key: Optional[str] = Field(None, description="范围键")


class TokenBucket:
    """令牌桶实现"""
    
    def __init__(self, capacity: int, refill_rate: float):
        """
        初始化令牌桶
        
        Args:
            capacity: 桶容量
            refill_rate: 令牌补充速率（每秒）
        """
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = float(capacity)
        self.last_refill = time.time()
        self._lock = threading.Lock()
    
    def consume(self, tokens: int = 1) -> bool:
        """
        消费令牌
        
        Args:
            tokens: 要消费的令牌数
            
        Returns:
            bool: 是否成功消费
        """
        with self._lock:
            now = time.time()
            
            # 补充令牌
            time_passed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + time_passed * self.refill_rate)
            self.last_refill = now
            
            # 检查是否有足够的令牌
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            
            return False
    
    def get_tokens(self) -> float:
        """获取当前令牌数"""
        with self._lock:
            now = time.time()
            time_passed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + time_passed * self.refill_rate)
            self.last_refill = now
            return self.tokens
    
    def time_until_tokens(self, tokens: int) -> float:
        """计算获得指定令牌数需要的时间"""
        current_tokens = self.get_tokens()
        if current_tokens >= tokens:
            return 0.0
        
        needed_tokens = tokens - current_tokens
        return needed_tokens / self.refill_rate


class SlidingWindow:
    """滑动窗口实现"""
    
    def __init__(self, max_requests: int, window_size: float):
        """
        初始化滑动窗口
        
        Args:
            max_requests: 最大请求数
            window_size: 窗口大小（秒）
        """
        self.max_requests = max_requests
        self.window_size = window_size
        self.requests = deque()
        self._lock = threading.Lock()
    
    def is_allowed(self) -> bool:
        """检查是否允许请求"""
        with self._lock:
            now = time.time()
            
            # 清理过期请求
            while self.requests and self.requests[0] <= now - self.window_size:
                self.requests.popleft()
            
            # 检查是否超过限制
            if len(self.requests) < self.max_requests:
                self.requests.append(now)
                return True
            
            return False
    
    def get_remaining(self) -> int:
        """获取剩余请求数"""
        with self._lock:
            now = time.time()
            
            # 清理过期请求
            while self.requests and self.requests[0] <= now - self.window_size:
                self.requests.popleft()
            
            return max(0, self.max_requests - len(self.requests))
    
    def get_reset_time(self) -> float:
        """获取重置时间"""
        with self._lock:
            if not self.requests:
                return time.time()
            
            return self.requests[0] + self.window_size


class FixedWindow:
    """固定窗口实现"""
    
    def __init__(self, max_requests: int, window_size: float):
        """
        初始化固定窗口
        
        Args:
            max_requests: 最大请求数
            window_size: 窗口大小（秒）
        """
        self.max_requests = max_requests
        self.window_size = window_size
        self.current_requests = 0
        self.window_start = time.time()
        self._lock = threading.Lock()
    
    def is_allowed(self) -> bool:
        """检查是否允许请求"""
        with self._lock:
            now = time.time()
            
            # 检查是否需要重置窗口
            if now - self.window_start >= self.window_size:
                self.current_requests = 0
                self.window_start = now
            
            # 检查是否超过限制
            if self.current_requests < self.max_requests:
                self.current_requests += 1
                return True
            
            return False
    
    def get_remaining(self) -> int:
        """获取剩余请求数"""
        with self._lock:
            now = time.time()
            
            # 检查是否需要重置窗口
            if now - self.window_start >= self.window_size:
                self.current_requests = 0
                self.window_start = now
            
            return max(0, self.max_requests - self.current_requests)
    
    def get_reset_time(self) -> float:
        """获取重置时间"""
        return self.window_start + self.window_size


class LeakyBucket:
    """漏桶实现"""
    
    def __init__(self, capacity: int, leak_rate: float):
        """
        初始化漏桶
        
        Args:
            capacity: 桶容量
            leak_rate: 漏桶速率（每秒）
        """
        self.capacity = capacity
        self.leak_rate = leak_rate
        self.volume = 0.0
        self.last_leak = time.time()
        self._lock = threading.Lock()
    
    def add_request(self, size: float = 1.0) -> bool:
        """
        添加请求到桶中
        
        Args:
            size: 请求大小
            
        Returns:
            bool: 是否成功添加
        """
        with self._lock:
            now = time.time()
            
            # 漏水
            time_passed = now - self.last_leak
            self.volume = max(0, self.volume - time_passed * self.leak_rate)
            self.last_leak = now
            
            # 检查是否有空间
            if self.volume + size <= self.capacity:
                self.volume += size
                return True
            
            return False
    
    def get_volume(self) -> float:
        """获取当前桶容量"""
        with self._lock:
            now = time.time()
            time_passed = now - self.last_leak
            self.volume = max(0, self.volume - time_passed * self.leak_rate)
            self.last_leak = now
            return self.volume


class RateLimiter:
    """速率限制器主类"""
    
    def __init__(self, config: RateLimitConfig):
        """
        初始化速率限制器
        
        Args:
            config: 速率限制配置
        """
        self.config = config
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        
        # 存储不同范围的限制器实例
        self._limiters: Dict[str, Any] = {}
        self._lock = threading.Lock()
        
        # 统计信息
        self.statistics = {
            "total_requests": 0,
            "allowed_requests": 0,
            "denied_requests": 0,
            "scope_stats": defaultdict(lambda: {"total": 0, "allowed": 0, "denied": 0})
        }
        
        # 自适应配置
        self._adaptive_history: Dict[str, List[float]] = defaultdict(list)
        self._adaptive_window = 300  # 5分钟窗口
    
    def _get_scope_key(self, **kwargs) -> str:
        """获取范围键"""
        if self.config.scope == RateLimitScope.GLOBAL:
            return "global"
        elif self.config.scope == RateLimitScope.PER_USER:
            return f"user:{kwargs.get('user_id', 'anonymous')}"
        elif self.config.scope == RateLimitScope.PER_IP:
            return f"ip:{kwargs.get('ip_address', 'unknown')}"
        elif self.config.scope == RateLimitScope.PER_API_KEY:
            return f"api_key:{kwargs.get('api_key', 'unknown')}"
        elif self.config.scope == RateLimitScope.PER_ENDPOINT:
            return f"endpoint:{kwargs.get('endpoint', 'unknown')}"
        elif self.config.scope == RateLimitScope.PER_RESOURCE:
            return f"resource:{kwargs.get('resource', 'unknown')}"
        else:
            return "global"
    
    def _get_limiter(self, scope_key: str):
        """获取或创建限制器实例"""
        if scope_key not in self._limiters:
            with self._lock:
                if scope_key not in self._limiters:
                    if self.config.strategy == RateLimitStrategy.TOKEN_BUCKET:
                        self._limiters[scope_key] = TokenBucket(
                            self.config.get_effective_bucket_size(),
                            self.config.get_effective_refill_rate()
                        )
                    elif self.config.strategy == RateLimitStrategy.SLIDING_WINDOW:
                        self._limiters[scope_key] = SlidingWindow(
                            self.config.max_requests,
                            self.config.time_window
                        )
                    elif self.config.strategy == RateLimitStrategy.FIXED_WINDOW:
                        self._limiters[scope_key] = FixedWindow(
                            self.config.max_requests,
                            self.config.time_window
                        )
                    elif self.config.strategy == RateLimitStrategy.LEAKY_BUCKET:
                        leak_rate = self.config.leak_rate or (self.config.max_requests / self.config.time_window)
                        self._limiters[scope_key] = LeakyBucket(
                            self.config.max_requests,
                            leak_rate
                        )
                    elif self.config.strategy == RateLimitStrategy.ADAPTIVE:
                        # 自适应策略使用滑动窗口作为基础
                        max_requests = self._get_adaptive_limit(scope_key)
                        self._limiters[scope_key] = SlidingWindow(
                            max_requests,
                            self.config.time_window
                        )
        
        return self._limiters[scope_key]
    
    def _get_adaptive_limit(self, scope_key: str) -> int:
        """获取自适应限制"""
        history = self._adaptive_history[scope_key]
        now = time.time()
        
        # 清理过期历史
        cutoff = now - self._adaptive_window
        self._adaptive_history[scope_key] = [t for t in history if t > cutoff]
        
        # 计算当前请求率
        current_rate = len(self._adaptive_history[scope_key]) / self._adaptive_window
        
        # 根据历史请求率调整限制
        base_limit = self.config.max_requests
        if current_rate > base_limit * 0.8:  # 高负载
            adjusted_limit = max(self.config.min_requests, int(base_limit * 0.7))
        elif current_rate < base_limit * 0.3:  # 低负载
            adjusted_limit = min(self.config.max_requests_adaptive, int(base_limit * 1.3))
        else:
            adjusted_limit = base_limit
        
        return adjusted_limit
    
    def is_allowed(self, **kwargs) -> RateLimitResult:
        """
        检查请求是否被允许
        
        Args:
            **kwargs: 范围相关的参数（如user_id, ip_address等）
            
        Returns:
            RateLimitResult: 限制结果
        """
        scope_key = self._get_scope_key(**kwargs)
        limiter = self._get_limiter(scope_key)
        
        # 更新统计信息
        self.statistics["total_requests"] += 1
        self.statistics["scope_stats"][scope_key]["total"] += 1
        
        # 记录自适应历史
        if self.config.strategy == RateLimitStrategy.ADAPTIVE:
            self._adaptive_history[scope_key].append(time.time())
        
        # 检查限制
        allowed = False
        remaining = 0
        reset_time = time.time() + self.config.time_window
        retry_after = None
        
        if self.config.strategy == RateLimitStrategy.TOKEN_BUCKET:
            allowed = limiter.consume(1)
            remaining = int(limiter.get_tokens())
            if not allowed:
                retry_after = limiter.time_until_tokens(1)
                
        elif self.config.strategy in [RateLimitStrategy.SLIDING_WINDOW, RateLimitStrategy.ADAPTIVE]:
            allowed = limiter.is_allowed()
            remaining = limiter.get_remaining()
            reset_time = limiter.get_reset_time()
            if not allowed:
                retry_after = reset_time - time.time()
                
        elif self.config.strategy == RateLimitStrategy.FIXED_WINDOW:
            allowed = limiter.is_allowed()
            remaining = limiter.get_remaining()
            reset_time = limiter.get_reset_time()
            if not allowed:
                retry_after = reset_time - time.time()
                
        elif self.config.strategy == RateLimitStrategy.LEAKY_BUCKET:
            allowed = limiter.add_request(1.0)
            remaining = int(self.config.max_requests - limiter.get_volume())
            if not allowed:
                retry_after = 1.0 / (self.config.leak_rate or 1.0)
        
        # 更新统计信息
        if allowed:
            self.statistics["allowed_requests"] += 1
            self.statistics["scope_stats"][scope_key]["allowed"] += 1
        else:
            self.statistics["denied_requests"] += 1
            self.statistics["scope_stats"][scope_key]["denied"] += 1
        
        return RateLimitResult(
            allowed=allowed,
            remaining=max(0, remaining),
            reset_time=reset_time,
            retry_after=retry_after,
            current_requests=self.statistics["scope_stats"][scope_key]["total"],
            window_start=time.time() - self.config.time_window,
            window_end=time.time(),
            strategy_used=self.config.strategy,
            scope_key=scope_key
        )
    
    async def wait_if_needed(self, **kwargs) -> RateLimitResult:
        """
        如果需要，等待直到允许请求
        
        Args:
            **kwargs: 范围相关的参数
            
        Returns:
            RateLimitResult: 限制结果
        """
        result = self.is_allowed(**kwargs)
        
        if not result.allowed and result.retry_after:
            self.logger.info(f"速率限制触发，等待 {result.retry_after:.2f} 秒")
            await asyncio.sleep(result.retry_after)
            result = self.is_allowed(**kwargs)
        
        return result
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息"""
        stats = self.statistics.copy()
        
        # 计算总体比率
        total = stats["total_requests"]
        if total > 0:
            stats["allow_rate"] = stats["allowed_requests"] / total
            stats["deny_rate"] = stats["denied_requests"] / total
        else:
            stats["allow_rate"] = 0.0
            stats["deny_rate"] = 0.0
        
        # 计算各范围比率
        for scope_key, scope_stats in stats["scope_stats"].items():
            scope_total = scope_stats["total"]
            if scope_total > 0:
                scope_stats["allow_rate"] = scope_stats["allowed"] / scope_total
                scope_stats["deny_rate"] = scope_stats["denied"] / scope_total
            else:
                scope_stats["allow_rate"] = 0.0
                scope_stats["deny_rate"] = 0.0
        
        return stats
    
    def reset_statistics(self):
        """重置统计信息"""
        self.statistics = {
            "total_requests": 0,
            "allowed_requests": 0,
            "denied_requests": 0,
            "scope_stats": defaultdict(lambda: {"total": 0, "allowed": 0, "denied": 0})
        }
    
    def clear_limiters(self):
        """清理所有限制器实例"""
        with self._lock:
            self._limiters.clear()
            self._adaptive_history.clear()


# 全局速率限制器实例
_global_limiters: Dict[str, RateLimiter] = {}
_global_lock = threading.Lock()


def get_rate_limiter(name: str, config: Optional[RateLimitConfig] = None) -> RateLimiter:
    """
    获取或创建命名的速率限制器
    
    Args:
        name: 限制器名称
        config: 配置（仅在首次创建时使用）
        
    Returns:
        RateLimiter: 速率限制器实例
    """
    if name not in _global_limiters:
        with _global_lock:
            if name not in _global_limiters:
                if config is None:
                    config = RateLimitConfig()
                _global_limiters[name] = RateLimiter(config)
    
    return _global_limiters[name]


def rate_limit(
    name: str,
    max_requests: int = 100,
    time_window: float = 60.0,
    strategy: RateLimitStrategy = RateLimitStrategy.TOKEN_BUCKET,
    scope: RateLimitScope = RateLimitScope.GLOBAL
):
    """
    速率限制装饰器
    
    Args:
        name: 限制器名称
        max_requests: 最大请求数
        time_window: 时间窗口
        strategy: 限制策略
        scope: 限制范围
    """
    def decorator(func):
        config = RateLimitConfig(
            strategy=strategy,
            scope=scope,
            max_requests=max_requests,
            time_window=time_window
        )
        limiter = get_rate_limiter(name, config)
        
        async def async_wrapper(*args, **kwargs):
            result = await limiter.wait_if_needed(**kwargs)
            if not result.allowed:
                raise Exception(f"速率限制：{result.retry_after}秒后重试")
            return await func(*args, **kwargs)
        
        def sync_wrapper(*args, **kwargs):
            result = limiter.is_allowed(**kwargs)
            if not result.allowed:
                raise Exception(f"速率限制：{result.retry_after}秒后重试")
            return func(*args, **kwargs)
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper
    
    return decorator