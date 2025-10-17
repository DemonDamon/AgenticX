"""
健康检查 - 为 MinerU 解析系统提供健康状态监控
"""

import asyncio
import time
import threading
import os
from typing import Dict, List, Optional, Any, Callable, Union
from pydantic import BaseModel, Field
from enum import Enum
import logging
from datetime import datetime, timedelta
from pathlib import Path
import json

try:
    import psutil
except ImportError:
    psutil = None

try:
    import requests
except ImportError:
    requests = None

logger = logging.getLogger(__name__)


class HealthStatus(str, Enum):
    """健康状态枚举"""
    HEALTHY = "healthy"          # 健康
    DEGRADED = "degraded"        # 降级
    UNHEALTHY = "unhealthy"      # 不健康
    UNKNOWN = "unknown"          # 未知


class ComponentType(str, Enum):
    """组件类型枚举"""
    SYSTEM = "system"            # 系统组件
    DATABASE = "database"        # 数据库
    API = "api"                  # API服务
    STORAGE = "storage"          # 存储
    NETWORK = "network"          # 网络
    DEPENDENCY = "dependency"    # 依赖服务
    CUSTOM = "custom"            # 自定义组件


class ComponentHealth(BaseModel):
    """组件健康状态"""
    name: str = Field(..., description="组件名称")
    type: ComponentType = Field(..., description="组件类型")
    status: HealthStatus = Field(..., description="健康状态")
    message: Optional[str] = Field(None, description="状态消息")
    
    # 检查信息
    last_check: datetime = Field(default_factory=datetime.now, description="最后检查时间")
    check_duration: float = Field(0.0, description="检查耗时（秒）")
    
    # 详细信息
    details: Dict[str, Any] = Field(default_factory=dict, description="详细信息")
    metrics: Dict[str, float] = Field(default_factory=dict, description="指标数据")
    
    # 历史状态
    status_history: List[Dict[str, Any]] = Field(default_factory=list, description="状态历史")
    
    def add_status_history(self, status: HealthStatus, message: Optional[str] = None):
        """添加状态历史记录"""
        self.status_history.append({
            "timestamp": datetime.now().isoformat(),
            "status": status,
            "message": message,
            "duration": self.check_duration
        })
        
        # 保留最近100条记录
        if len(self.status_history) > 100:
            self.status_history = self.status_history[-100:]
    
    def get_uptime_percentage(self, hours: int = 24) -> float:
        """获取指定时间内的正常运行时间百分比"""
        if not self.status_history:
            return 100.0 if self.status == HealthStatus.HEALTHY else 0.0
        
        cutoff_time = datetime.now() - timedelta(hours=hours)
        recent_history = [
            h for h in self.status_history 
            if datetime.fromisoformat(h["timestamp"]) > cutoff_time
        ]
        
        if not recent_history:
            return 100.0 if self.status == HealthStatus.HEALTHY else 0.0
        
        healthy_count = sum(1 for h in recent_history if h["status"] == HealthStatus.HEALTHY)
        return (healthy_count / len(recent_history)) * 100.0


class HealthReport(BaseModel):
    """健康检查报告"""
    overall_status: HealthStatus = Field(..., description="整体健康状态")
    components: Dict[str, ComponentHealth] = Field(default_factory=dict, description="组件健康状态")
    last_check: datetime = Field(default_factory=datetime.now, description="最后检查时间")
    
    # 统计信息
    total_components: int = Field(0, description="总组件数")
    healthy_count: int = Field(0, description="健康组件数")
    degraded_count: int = Field(0, description="降级组件数")
    unhealthy_count: int = Field(0, description="不健康组件数")
    unknown_count: int = Field(0, description="未知状态组件数")
    
    def update_statistics(self):
        """更新统计信息"""
        self.total_components = len(self.components)
        self.healthy_count = sum(1 for h in self.components.values() if h.status == HealthStatus.HEALTHY)
        self.degraded_count = sum(1 for h in self.components.values() if h.status == HealthStatus.DEGRADED)
        self.unhealthy_count = sum(1 for h in self.components.values() if h.status == HealthStatus.UNHEALTHY)
        self.unknown_count = sum(1 for h in self.components.values() if h.status == HealthStatus.UNKNOWN)


class HealthCheckConfig(BaseModel):
    """健康检查配置"""
    check_interval: float = Field(30.0, description="检查间隔（秒）")
    timeout: float = Field(10.0, description="检查超时（秒）")
    
    # 系统资源阈值
    cpu_threshold: float = Field(80.0, description="CPU使用率阈值（%）")
    memory_threshold: float = Field(85.0, description="内存使用率阈值（%）")
    disk_threshold: float = Field(90.0, description="磁盘使用率阈值（%）")
    
    # 网络检查
    network_timeout: float = Field(5.0, description="网络检查超时（秒）")
    
    # 重试配置
    max_retries: int = Field(3, description="最大重试次数")
    retry_delay: float = Field(1.0, description="重试延迟（秒）")
    
    # 降级阈值
    degraded_threshold: int = Field(2, description="连续失败次数触发降级")
    unhealthy_threshold: int = Field(5, description="连续失败次数触发不健康")


class HealthChecker:
    """健康检查器基类"""
    
    def __init__(self, name: str, component_type: ComponentType, config: Optional[HealthCheckConfig] = None):
        """
        初始化健康检查器
        
        Args:
            name: 组件名称
            component_type: 组件类型
            config: 检查配置
        """
        self.name = name
        self.component_type = component_type
        self.config = config or HealthCheckConfig()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        
        # 状态跟踪
        self.consecutive_failures = 0
        self.last_success_time = None
        self.is_running = False
        self._stop_event = threading.Event()
        self._check_thread = None
    
    async def check_health(self) -> ComponentHealth:
        """执行健康检查（需要子类实现）"""
        raise NotImplementedError("子类必须实现 check_health 方法")
    
    async def check_with_retry(self) -> ComponentHealth:
        """带重试的健康检查"""
        last_error = None
        
        for attempt in range(self.config.max_retries + 1):
            try:
                start_time = time.time()
                
                # 执行检查
                health = await asyncio.wait_for(
                    self.check_health(),
                    timeout=self.config.timeout
                )
                
                health.check_duration = time.time() - start_time
                health.last_check = datetime.now()
                
                # 更新状态计数
                if health.status == HealthStatus.HEALTHY:
                    self.consecutive_failures = 0
                    self.last_success_time = datetime.now()
                else:
                    self.consecutive_failures += 1
                
                # 添加状态历史
                health.add_status_history(health.status, health.message)
                
                return health
                
            except Exception as e:
                last_error = e
                self.logger.warning(f"健康检查失败 (尝试 {attempt + 1}/{self.config.max_retries + 1}): {e}")
                
                if attempt < self.config.max_retries:
                    await asyncio.sleep(self.config.retry_delay)
        
        # 所有重试都失败
        self.consecutive_failures += 1
        
        # 根据连续失败次数确定状态
        if self.consecutive_failures >= self.config.unhealthy_threshold:
            status = HealthStatus.UNHEALTHY
        elif self.consecutive_failures >= self.config.degraded_threshold:
            status = HealthStatus.DEGRADED
        else:
            status = HealthStatus.UNHEALTHY
        
        health = ComponentHealth(
            name=self.name,
            type=self.component_type,
            status=status,
            message=f"检查失败: {last_error}",
            check_duration=self.config.timeout,
            last_check=datetime.now()
        )
        
        health.add_status_history(status, health.message)
        return health
    
    def start_monitoring(self):
        """开始监控"""
        if self.is_running:
            return
        
        self.is_running = True
        self._stop_event.clear()
        self._check_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self._check_thread.start()
        
        self.logger.info(f"开始监控组件: {self.name}")
    
    def stop_monitoring(self):
        """停止监控"""
        if not self.is_running:
            return
        
        self.is_running = False
        self._stop_event.set()
        
        if self._check_thread:
            self._check_thread.join(timeout=5.0)
        
        self.logger.info(f"停止监控组件: {self.name}")
    
    def _monitoring_loop(self):
        """监控循环"""
        while not self._stop_event.wait(self.config.check_interval):
            try:
                # 在新的事件循环中运行异步检查
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                health = loop.run_until_complete(self.check_with_retry())
                
                # 记录状态变化
                if health.status != HealthStatus.HEALTHY:
                    self.logger.warning(f"组件 {self.name} 状态: {health.status} - {health.message}")
                
                loop.close()
                
            except Exception as e:
                self.logger.error(f"监控循环错误: {e}")


class SystemHealthChecker(HealthChecker):
    """系统健康检查器"""
    
    def __init__(self, config: Optional[HealthCheckConfig] = None):
        super().__init__("system", ComponentType.SYSTEM, config)
    
    async def check_health(self) -> ComponentHealth:
        """检查系统健康状态"""
        details = {}
        metrics = {}
        issues = []
        
        if psutil is None:
            return ComponentHealth(
                name=self.name,
                type=self.component_type,
                status=HealthStatus.UNKNOWN,
                message="psutil 库未安装，无法进行系统监控",
                details={"error": "missing_psutil"}
            )
        
        try:
            # CPU使用率
            cpu_percent = psutil.cpu_percent(interval=1)
            metrics["cpu_usage"] = cpu_percent
            details["cpu_usage"] = f"{cpu_percent:.1f}%"
            
            if cpu_percent > self.config.cpu_threshold:
                issues.append(f"CPU使用率过高: {cpu_percent:.1f}%")
            
            # 内存使用率
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            metrics["memory_usage"] = memory_percent
            details["memory_usage"] = f"{memory_percent:.1f}%"
            details["memory_available"] = f"{memory.available / 1024**3:.1f}GB"
            
            if memory_percent > self.config.memory_threshold:
                issues.append(f"内存使用率过高: {memory_percent:.1f}%")
            
            # 磁盘使用率
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            metrics["disk_usage"] = disk_percent
            details["disk_usage"] = f"{disk_percent:.1f}%"
            details["disk_free"] = f"{disk.free / 1024**3:.1f}GB"
            
            if disk_percent > self.config.disk_threshold:
                issues.append(f"磁盘使用率过高: {disk_percent:.1f}%")
            
            # 负载平均值（仅Unix系统）
            try:
                load_avg = psutil.getloadavg()
                metrics["load_1min"] = load_avg[0]
                metrics["load_5min"] = load_avg[1]
                metrics["load_15min"] = load_avg[2]
                details["load_average"] = f"{load_avg[0]:.2f}, {load_avg[1]:.2f}, {load_avg[2]:.2f}"
            except AttributeError:
                # Windows系统不支持getloadavg
                pass
            
            # 进程数
            process_count = len(psutil.pids())
            metrics["process_count"] = process_count
            details["process_count"] = process_count
            
            # 确定状态
            if issues:
                status = HealthStatus.DEGRADED if len(issues) == 1 else HealthStatus.UNHEALTHY
                message = "; ".join(issues)
            else:
                status = HealthStatus.HEALTHY
                message = "系统运行正常"
            
        except Exception as e:
            status = HealthStatus.UNKNOWN
            message = f"系统检查失败: {e}"
            details["error"] = str(e)
        
        return ComponentHealth(
            name=self.name,
            type=self.component_type,
            status=status,
            message=message,
            details=details,
            metrics=metrics
        )


class APIHealthChecker(HealthChecker):
    """API健康检查器"""
    
    def __init__(self, name: str, url: str, config: Optional[HealthCheckConfig] = None):
        super().__init__(name, ComponentType.API, config)
        self.url = url
    
    async def check_health(self) -> ComponentHealth:
        """检查API健康状态"""
        details = {"url": self.url}
        metrics = {}
        
        if requests is None:
            return ComponentHealth(
                name=self.name,
                type=self.component_type,
                status=HealthStatus.UNKNOWN,
                message="requests 库未安装，无法进行API检查",
                details={"error": "missing_requests"}
            )
        
        try:
            start_time = time.time()
            
            # 发送健康检查请求
            response = requests.get(
                self.url,
                timeout=self.config.network_timeout,
                headers={"User-Agent": "AgenticX-HealthChecker/1.0"}
            )
            
            response_time = time.time() - start_time
            metrics["response_time"] = response_time
            metrics["status_code"] = response.status_code
            
            details["status_code"] = response.status_code
            details["response_time"] = f"{response_time:.3f}s"
            details["content_length"] = len(response.content)
            
            # 检查响应状态
            if response.status_code == 200:
                status = HealthStatus.HEALTHY
                message = f"API响应正常 ({response_time:.3f}s)"
            elif 200 <= response.status_code < 300:
                status = HealthStatus.HEALTHY
                message = f"API响应正常 (状态码: {response.status_code})"
            elif 400 <= response.status_code < 500:
                status = HealthStatus.DEGRADED
                message = f"API客户端错误 (状态码: {response.status_code})"
            else:
                status = HealthStatus.UNHEALTHY
                message = f"API服务器错误 (状态码: {response.status_code})"
            
        except requests.exceptions.Timeout:
            status = HealthStatus.UNHEALTHY
            message = f"API请求超时 (>{self.config.network_timeout}s)"
            details["error"] = "timeout"
            
        except requests.exceptions.ConnectionError as e:
            status = HealthStatus.UNHEALTHY
            message = f"API连接失败: {e}"
            details["error"] = "connection_error"
            
        except Exception as e:
            status = HealthStatus.UNKNOWN
            message = f"API检查失败: {e}"
            details["error"] = str(e)
        
        return ComponentHealth(
            name=self.name,
            type=self.component_type,
            status=status,
            message=message,
            details=details,
            metrics=metrics
        )


class StorageHealthChecker(HealthChecker):
    """存储健康检查器"""
    
    def __init__(self, name: str, path: str, config: Optional[HealthCheckConfig] = None):
        super().__init__(name, ComponentType.STORAGE, config)
        self.path = Path(path)
    
    async def check_health(self) -> ComponentHealth:
        """检查存储健康状态"""
        details = {"path": str(self.path)}
        metrics = {}
        issues = []
        
        try:
            # 检查路径是否存在
            if not self.path.exists():
                return ComponentHealth(
                    name=self.name,
                    type=self.component_type,
                    status=HealthStatus.UNHEALTHY,
                    message=f"存储路径不存在: {self.path}",
                    details=details
                )
            
            # 检查读写权限
            readable = os.access(self.path, os.R_OK)
            writable = os.access(self.path, os.W_OK)
            
            details["readable"] = readable
            details["writable"] = writable
            
            if not readable:
                issues.append("无读取权限")
            if not writable:
                issues.append("无写入权限")
            
            # 检查磁盘空间
            if self.path.is_dir() and psutil is not None:
                try:
                    disk_usage = psutil.disk_usage(str(self.path))
                    free_space_gb = disk_usage.free / (1024**3)
                    usage_percent = (disk_usage.used / disk_usage.total) * 100
                    
                    metrics["free_space_gb"] = free_space_gb
                    metrics["usage_percent"] = usage_percent
                    
                    details["free_space"] = f"{free_space_gb:.1f}GB"
                    details["usage_percent"] = f"{usage_percent:.1f}%"
                    
                    if free_space_gb < 1.0:  # 少于1GB
                        issues.append(f"磁盘空间不足: {free_space_gb:.1f}GB")
                    elif usage_percent > 95:
                        issues.append(f"磁盘使用率过高: {usage_percent:.1f}%")
                except Exception as e:
                    details["disk_check_error"] = str(e)
            
            # 测试写入（如果有写权限）
            if writable and self.path.is_dir():
                test_file = self.path / ".health_check_test"
                try:
                    start_time = time.time()
                    test_file.write_text("health_check")
                    write_time = time.time() - start_time
                    
                    start_time = time.time()
                    content = test_file.read_text()
                    read_time = time.time() - start_time
                    
                    test_file.unlink()  # 删除测试文件
                    
                    metrics["write_time"] = write_time
                    metrics["read_time"] = read_time
                    
                    details["write_test"] = f"{write_time:.3f}s"
                    details["read_test"] = f"{read_time:.3f}s"
                    
                    if content != "health_check":
                        issues.append("读写测试失败")
                    
                except Exception as e:
                    issues.append(f"读写测试失败: {e}")
            
            # 确定状态
            if issues:
                status = HealthStatus.DEGRADED if len(issues) == 1 else HealthStatus.UNHEALTHY
                message = "; ".join(issues)
            else:
                status = HealthStatus.HEALTHY
                message = "存储运行正常"
            
        except Exception as e:
            status = HealthStatus.UNKNOWN
            message = f"存储检查失败: {e}"
            details["error"] = str(e)
        
        return ComponentHealth(
            name=self.name,
            type=self.component_type,
            status=status,
            message=message,
            details=details,
            metrics=metrics
        )


class HealthCheck:
    """健康检查管理器"""
    
    def __init__(self, config: Optional[HealthCheckConfig] = None):
        """
        初始化健康检查管理器
        
        Args:
            config: 健康检查配置
        """
        self.config = config or HealthCheckConfig()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        
        # 注册的检查器
        self.checkers: Dict[str, HealthChecker] = {}
        
        # 当前健康状态
        self.current_health: Dict[str, ComponentHealth] = {}
        
        # 全局状态
        self.overall_status = HealthStatus.UNKNOWN
        self.last_check_time = None
        
        # 监控控制
        self.is_monitoring = False
        self._monitor_task = None
        
        # 注册默认检查器
        self.register_default_checkers()
    
    def register_default_checkers(self):
        """注册默认的健康检查器"""
        # 系统健康检查
        self.register_checker(SystemHealthChecker(self.config))
    
    def register_checker(self, checker: HealthChecker):
        """
        注册健康检查器
        
        Args:
            checker: 健康检查器实例
        """
        self.checkers[checker.name] = checker
        self.logger.info(f"注册健康检查器: {checker.name} ({checker.component_type})")
    
    def unregister_checker(self, name: str):
        """
        注销健康检查器
        
        Args:
            name: 检查器名称
        """
        if name in self.checkers:
            checker = self.checkers[name]
            checker.stop_monitoring()
            del self.checkers[name]
            
            if name in self.current_health:
                del self.current_health[name]
            
            self.logger.info(f"注销健康检查器: {name}")
    
    async def check_all(self) -> HealthReport:
        """检查所有组件的健康状态"""
        results = {}
        
        # 并发执行所有检查
        tasks = []
        for name, checker in self.checkers.items():
            task = asyncio.create_task(checker.check_with_retry())
            tasks.append((name, task))
        
        # 等待所有检查完成
        for name, task in tasks:
            try:
                health = await task
                results[name] = health
                self.current_health[name] = health
            except Exception as e:
                self.logger.error(f"检查器 {name} 执行失败: {e}")
                health = ComponentHealth(
                    name=name,
                    type=ComponentType.CUSTOM,
                    status=HealthStatus.UNKNOWN,
                    message=f"检查失败: {e}"
                )
                results[name] = health
                self.current_health[name] = health
        
        # 更新全局状态
        self._update_overall_status()
        self.last_check_time = datetime.now()
        
        # 创建健康报告
        report = HealthReport(
            overall_status=self.overall_status,
            components=results,
            last_check=self.last_check_time
        )
        report.update_statistics()
        
        return report
    
    def _update_overall_status(self):
        """更新全局健康状态"""
        if not self.current_health:
            self.overall_status = HealthStatus.UNKNOWN
            return
        
        statuses = [health.status for health in self.current_health.values()]
        
        if all(status == HealthStatus.HEALTHY for status in statuses):
            self.overall_status = HealthStatus.HEALTHY
        elif any(status == HealthStatus.UNHEALTHY for status in statuses):
            self.overall_status = HealthStatus.UNHEALTHY
        elif any(status == HealthStatus.DEGRADED for status in statuses):
            self.overall_status = HealthStatus.DEGRADED
        else:
            self.overall_status = HealthStatus.UNKNOWN
    
    async def start_monitoring(self):
        """开始健康监控"""
        if self.is_monitoring:
            return
        
        self.is_monitoring = True
        self._monitor_task = asyncio.create_task(self._monitoring_loop())
        
        # 启动所有检查器的监控
        for checker in self.checkers.values():
            checker.start_monitoring()
        
        self.logger.info("开始健康监控")
    
    async def stop_monitoring(self):
        """停止健康监控"""
        if not self.is_monitoring:
            return
        
        self.is_monitoring = False
        
        # 停止所有检查器的监控
        for checker in self.checkers.values():
            checker.stop_monitoring()
        
        # 取消监控任务
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        
        self.logger.info("停止健康监控")
    
    async def _monitoring_loop(self):
        """监控循环"""
        while self.is_monitoring:
            try:
                await self.check_all()
                await asyncio.sleep(self.config.check_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"监控循环错误: {e}")
                await asyncio.sleep(5.0)  # 错误后短暂等待
    
    def get_health_summary(self) -> Dict[str, Any]:
        """获取健康状态摘要"""
        summary = {
            "overall_status": self.overall_status,
            "last_check": self.last_check_time.isoformat() if self.last_check_time else None,
            "components": {},
            "statistics": {
                "total_components": len(self.current_health),
                "healthy": 0,
                "degraded": 0,
                "unhealthy": 0,
                "unknown": 0
            }
        }
        
        # 统计各状态的组件数量
        for name, health in self.current_health.items():
            summary["components"][name] = {
                "status": health.status,
                "message": health.message,
                "last_check": health.last_check.isoformat(),
                "uptime_24h": health.get_uptime_percentage(24)
            }
            
            # 更新统计
            if health.status == HealthStatus.HEALTHY:
                summary["statistics"]["healthy"] += 1
            elif health.status == HealthStatus.DEGRADED:
                summary["statistics"]["degraded"] += 1
            elif health.status == HealthStatus.UNHEALTHY:
                summary["statistics"]["unhealthy"] += 1
            else:
                summary["statistics"]["unknown"] += 1
        
        return summary
    
    def export_health_report(self, file_path: Optional[str] = None) -> str:
        """
        导出健康报告
        
        Args:
            file_path: 导出文件路径（可选）
            
        Returns:
            str: 报告内容
        """
        summary = self.get_health_summary()
        
        # 生成详细报告
        report = {
            "timestamp": datetime.now().isoformat(),
            "summary": summary,
            "detailed_health": {}
        }
        
        for name, health in self.current_health.items():
            report["detailed_health"][name] = health.dict()
        
        report_json = json.dumps(report, indent=2, ensure_ascii=False)
        
        # 保存到文件
        if file_path:
            Path(file_path).write_text(report_json, encoding='utf-8')
            self.logger.info(f"健康报告已导出到: {file_path}")
        
        return report_json


# 全局健康检查实例
_global_health_check: Optional[HealthCheck] = None


def get_health_check(config: Optional[HealthCheckConfig] = None) -> HealthCheck:
    """
    获取全局健康检查实例
    
    Args:
        config: 配置（仅在首次创建时使用）
        
    Returns:
        HealthCheck: 健康检查实例
    """
    global _global_health_check
    
    if _global_health_check is None:
        _global_health_check = HealthCheck(config)
    
    return _global_health_check