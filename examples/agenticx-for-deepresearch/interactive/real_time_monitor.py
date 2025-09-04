"""Real-time Monitor based on AgenticX

This module implements RealTimeMonitor, responsible for real-time monitoring of system status and performance,
strictly following the observability design of the AgenticX framework.
"""

from typing import Dict, List, Any, Optional, Callable, Set
from datetime import datetime, timedelta
import asyncio
import psutil
import time
from dataclasses import dataclass, field
from enum import Enum
import json
from collections import deque, defaultdict
from agenticx.observability import BaseCallbackHandler, CallbackManager
from models import SearchResult, ResearchIteration


class MonitorLevel(Enum):
    """Monitoring levels"""
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class MetricType(Enum):
    """Metric types"""
    SYSTEM = "system"          # System metrics
    PERFORMANCE = "performance" # Performance metrics
    BUSINESS = "business"       # Business metrics
    QUALITY = "quality"         # Quality metrics
    USER = "user"              # User metrics


@dataclass
class SystemMetrics:
    """System metrics"""
    timestamp: datetime
    cpu_usage: float
    memory_usage: float
    memory_available: float
    disk_usage: float
    network_io: Dict[str, float]
    process_count: int
    thread_count: int
    open_files: int


@dataclass
class PerformanceMetrics:
    """Performance metrics"""
    timestamp: datetime
    response_time: float
    throughput: float
    error_rate: float
    success_rate: float
    queue_size: int
    active_connections: int
    cache_hit_rate: float


@dataclass
class BusinessMetrics:
    """Business metrics"""
    timestamp: datetime
    search_requests: int
    successful_searches: int
    failed_searches: int
    total_results: int
    unique_sources: int
    research_iterations: int
    knowledge_gaps_identified: int
    reports_generated: int


@dataclass
class QualityMetrics:
    """Quality metrics"""
    timestamp: datetime
    result_relevance: float
    source_credibility: float
    information_completeness: float
    citation_accuracy: float
    report_quality_score: float
    user_satisfaction: float


@dataclass
class AlertRule:
    """Alert rule"""
    name: str
    metric_type: MetricType
    metric_name: str
    threshold: float
    comparison: str  # ">", "<", ">=", "<=", "==", "!="
    duration: int   # Duration in seconds
    level: MonitorLevel
    message_template: str
    enabled: bool = True
    last_triggered: Optional[datetime] = None
    trigger_count: int = 0


@dataclass
class Alert:
    """Alert"""
    id: str
    rule_name: str
    level: MonitorLevel
    message: str
    timestamp: datetime
    metric_value: float
    threshold: float
    resolved: bool = False
    resolved_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class RealTimeMonitor(BaseCallbackHandler):
    """Real-time Monitor
    
    Based on agenticx.observability.BaseCallbackHandler implementation, provides:
    1. System resource monitoring
    2. Performance metrics collection
    3. Business metrics tracking
    4. Real-time alerts
    5. Trend analysis
    """
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Monitoring configuration
        self.monitoring_enabled = True
        self.collection_interval = 5.0  # Collection interval (seconds)
        self.retention_period = timedelta(hours=24)  # Data retention period
        self.max_data_points = 1000  # Maximum data points
        
        # Data storage
        self.system_metrics: deque = deque(maxlen=self.max_data_points)
        self.performance_metrics: deque = deque(maxlen=self.max_data_points)
        self.business_metrics: deque = deque(maxlen=self.max_data_points)
        self.quality_metrics: deque = deque(maxlen=self.max_data_points)
        
        # Real-time data
        self.current_metrics: Dict[MetricType, Any] = {}
        self.metric_history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
        
        # Alert system
        self.alert_rules: Dict[str, AlertRule] = {}
        self.active_alerts: Dict[str, Alert] = {}
        self.alert_history: List[Alert] = []
        self.alert_callbacks: List[Callable] = []
        
        # Monitoring tasks
        self.monitoring_task: Optional[asyncio.Task] = None
        self.cleanup_task: Optional[asyncio.Task] = None
        
        # Statistics
        self.stats = {
            "total_events": 0,
            "error_events": 0,
            "warning_events": 0,
            "start_time": datetime.now(),
            "last_update": datetime.now()
        }
        
        # Initialize default alert rules
        self._setup_default_alert_rules()
    
    async def start_monitoring(self) -> None:
        """Start monitoring"""
        if self.monitoring_task and not self.monitoring_task.done():
            return
        
        self.monitoring_enabled = True
        self.monitoring_task = asyncio.create_task(self._monitoring_loop())
        self.cleanup_task = asyncio.create_task(self._cleanup_loop())
        
        await self._notify_alert("monitoring_started", MonitorLevel.INFO, 
                               "Real-time monitoring started", {})
    
    async def stop_monitoring(self) -> None:
        """Stop monitoring"""
        self.monitoring_enabled = False
        
        if self.monitoring_task:
            self.monitoring_task.cancel()
            try:
                await self.monitoring_task
            except asyncio.CancelledError:
                pass
        
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
        
        await self._notify_alert("monitoring_stopped", MonitorLevel.INFO, 
                               "Real-time monitoring stopped", {})
    
    async def collect_system_metrics(self) -> SystemMetrics:
        """Collect system metrics"""
        try:
            # CPU usage
            cpu_usage = psutil.cpu_percent(interval=1)
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_usage = memory.percent
            memory_available = memory.available / (1024**3)  # GB
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_usage = disk.percent
            
            # Network IO
            network = psutil.net_io_counters()
            network_io = {
                "bytes_sent": float(network.bytes_sent),
                "bytes_recv": float(network.bytes_recv),
                "packets_sent": float(network.packets_sent),
                "packets_recv": float(network.packets_recv)
            }
            
            # Process information
            process_count = len(psutil.pids())
            
            # Current process information
            current_process = psutil.Process()
            thread_count = current_process.num_threads()
            open_files = len(current_process.open_files())
            
            metrics = SystemMetrics(
                timestamp=datetime.now(),
                cpu_usage=cpu_usage,
                memory_usage=memory_usage,
                memory_available=memory_available,
                disk_usage=disk_usage,
                network_io=network_io,
                process_count=process_count,
                thread_count=thread_count,
                open_files=open_files
            )
            
            self.system_metrics.append(metrics)
            self.current_metrics[MetricType.SYSTEM] = metrics
            
            # Update historical data
            self._update_metric_history("cpu_usage", cpu_usage)
            self._update_metric_history("memory_usage", memory_usage)
            self._update_metric_history("disk_usage", disk_usage)
            
            return metrics
            
        except Exception as e:
            await self._notify_alert("system_metrics_error", MonitorLevel.ERROR,
                                   f"System metrics collection failed: {e}", {"error": str(e)})
            raise
    
    async def collect_performance_metrics(self, response_time: float = 0.0,
                                        throughput: float = 0.0,
                                        error_count: int = 0,
                                        success_count: int = 0) -> PerformanceMetrics:
        """Collect performance metrics"""
        try:
            total_requests = error_count + success_count
            error_rate = (error_count / total_requests * 100) if total_requests > 0 else 0.0
            success_rate = (success_count / total_requests * 100) if total_requests > 0 else 0.0
            
            metrics = PerformanceMetrics(
                timestamp=datetime.now(),
                response_time=response_time,
                throughput=throughput,
                error_rate=error_rate,
                success_rate=success_rate,
                queue_size=0,  # Need to get from actual queue
                active_connections=0,  # Need to get from connection pool
                cache_hit_rate=0.0  # Need to get from cache system
            )
            
            self.performance_metrics.append(metrics)
            self.current_metrics[MetricType.PERFORMANCE] = metrics
            
            # Update historical data
            self._update_metric_history("response_time", response_time)
            self._update_metric_history("throughput", throughput)
            self._update_metric_history("error_rate", error_rate)
            self._update_metric_history("success_rate", success_rate)
            
            return metrics
            
        except Exception as e:
            await self._notify_alert("performance_metrics_error", MonitorLevel.ERROR,
                                   f"Performance metrics collection failed: {e}", {"error": str(e)})
            raise
    
    async def collect_business_metrics(self, search_requests: int = 0,
                                     successful_searches: int = 0,
                                     failed_searches: int = 0,
                                     total_results: int = 0,
                                     unique_sources: int = 0,
                                     research_iterations: int = 0,
                                     knowledge_gaps: int = 0,
                                     reports_generated: int = 0) -> BusinessMetrics:
        """Collect business metrics"""
        try:
            metrics = BusinessMetrics(
                timestamp=datetime.now(),
                search_requests=search_requests,
                successful_searches=successful_searches,
                failed_searches=failed_searches,
                total_results=total_results,
                unique_sources=unique_sources,
                research_iterations=research_iterations,
                knowledge_gaps_identified=knowledge_gaps,
                reports_generated=reports_generated
            )
            
            self.business_metrics.append(metrics)
            self.current_metrics[MetricType.BUSINESS] = metrics
            
            # Update historical data
            self._update_metric_history("search_requests", search_requests)
            self._update_metric_history("successful_searches", successful_searches)
            self._update_metric_history("total_results", total_results)
            
            return metrics
            
        except Exception as e:
            await self._notify_alert("business_metrics_error", MonitorLevel.ERROR,
                                   f"Business metrics collection failed: {e}", {"error": str(e)})
            raise
    
    async def collect_quality_metrics(self, result_relevance: float = 0.0,
                                    source_credibility: float = 0.0,
                                    information_completeness: float = 0.0,
                                    citation_accuracy: float = 0.0,
                                    report_quality_score: float = 0.0,
                                    user_satisfaction: float = 0.0) -> QualityMetrics:
        """Collect quality metrics"""
        try:
            metrics = QualityMetrics(
                timestamp=datetime.now(),
                result_relevance=result_relevance,
                source_credibility=source_credibility,
                information_completeness=information_completeness,
                citation_accuracy=citation_accuracy,
                report_quality_score=report_quality_score,
                user_satisfaction=user_satisfaction
            )
            
            self.quality_metrics.append(metrics)
            self.current_metrics[MetricType.QUALITY] = metrics
            
            # Update historical data
            self._update_metric_history("result_relevance", result_relevance)
            self._update_metric_history("source_credibility", source_credibility)
            self._update_metric_history("report_quality_score", report_quality_score)
            
            return metrics
            
        except Exception as e:
            await self._notify_alert("quality_metrics_error", MonitorLevel.ERROR,
                                   f"Quality metrics collection failed: {e}", {"error": str(e)})
            raise
    
    def add_alert_rule(self, rule: AlertRule) -> None:
        """Add alert rule"""
        self.alert_rules[rule.name] = rule
    
    def remove_alert_rule(self, rule_name: str) -> None:
        """Remove alert rule"""
        if rule_name in self.alert_rules:
            del self.alert_rules[rule_name]
    
    def enable_alert_rule(self, rule_name: str) -> None:
        """Enable alert rule"""
        if rule_name in self.alert_rules:
            self.alert_rules[rule_name].enabled = True
    
    def disable_alert_rule(self, rule_name: str) -> None:
        """Disable alert rule"""
        if rule_name in self.alert_rules:
            self.alert_rules[rule_name].enabled = False
    
    async def check_alerts(self) -> List[Alert]:
        """Check alerts"""
        new_alerts = []
        
        for rule in self.alert_rules.values():
            if not rule.enabled:
                continue
            
            try:
                alert = await self._evaluate_alert_rule(rule)
                if alert:
                    new_alerts.append(alert)
                    self.active_alerts[alert.id] = alert
                    self.alert_history.append(alert)
                    
                    # Notify alert
                    await self._notify_alert(alert.id, alert.level, alert.message, 
                                           alert.metadata)
            
            except Exception as e:
                await self._notify_alert("alert_check_error", MonitorLevel.ERROR,
                                       f"Alert rule check failed: {rule.name}, error: {e}", 
                                       {"rule_name": rule.name, "error": str(e)})
        
        return new_alerts
    
    async def resolve_alert(self, alert_id: str) -> bool:
        """Resolve alert"""
        if alert_id in self.active_alerts:
            alert = self.active_alerts[alert_id]
            alert.resolved = True
            alert.resolved_at = datetime.now()
            del self.active_alerts[alert_id]
            
            await self._notify_alert(f"alert_resolved_{alert_id}", MonitorLevel.INFO,
                                   f"Alert resolved: {alert.message}", 
                                   {"alert_id": alert_id})
            return True
        
        return False
    
    def get_current_status(self) -> Dict[str, Any]:
        """Get current status"""
        return {
            "monitoring_enabled": self.monitoring_enabled,
            "uptime_seconds": (datetime.now() - self.stats["start_time"]).total_seconds(),
            "total_events": self.stats["total_events"],
            "error_events": self.stats["error_events"],
            "warning_events": self.stats["warning_events"],
            "active_alerts": len(self.active_alerts),
            "current_metrics": {
                metric_type.value: self._serialize_metrics(metrics)
                for metric_type, metrics in self.current_metrics.items()
            },
            "last_update": self.stats["last_update"].isoformat()
        }
    
    def get_metrics_summary(self, metric_type: MetricType, 
                          time_range: Optional[timedelta] = None) -> Dict[str, Any]:
        """Get metrics summary"""
        if time_range is None:
            time_range = timedelta(hours=1)
        
        cutoff_time = datetime.now() - time_range
        
        # Select corresponding metric data
        if metric_type == MetricType.SYSTEM:
            metrics_data = [m for m in self.system_metrics if m.timestamp >= cutoff_time]
        elif metric_type == MetricType.PERFORMANCE:
            metrics_data = [m for m in self.performance_metrics if m.timestamp >= cutoff_time]
        elif metric_type == MetricType.BUSINESS:
            metrics_data = [m for m in self.business_metrics if m.timestamp >= cutoff_time]
        elif metric_type == MetricType.QUALITY:
            metrics_data = [m for m in self.quality_metrics if m.timestamp >= cutoff_time]
        else:
            return {}
        
        if not metrics_data:
            return {"message": "No data in specified time range"}
        
        # Calculate statistics
        summary = {
            "metric_type": metric_type.value,
            "time_range_hours": time_range.total_seconds() / 3600,
            "data_points": len(metrics_data),
            "start_time": metrics_data[0].timestamp.isoformat(),
            "end_time": metrics_data[-1].timestamp.isoformat()
        }
        
        # Calculate specific statistics based on metric type
        if metric_type == MetricType.SYSTEM:
            summary.update(self._calculate_system_stats(metrics_data))
        elif metric_type == MetricType.PERFORMANCE:
            summary.update(self._calculate_performance_stats(metrics_data))
        elif metric_type == MetricType.BUSINESS:
            summary.update(self._calculate_business_stats(metrics_data))
        elif metric_type == MetricType.QUALITY:
            summary.update(self._calculate_quality_stats(metrics_data))
        
        return summary
    
    def get_trend_analysis(self, metric_name: str, 
                          time_range: Optional[timedelta] = None) -> Dict[str, Any]:
        """Get trend analysis"""
        if metric_name not in self.metric_history:
            return {"error": f"Metric {metric_name} does not exist"}
        
        values = list(self.metric_history[metric_name])
        
        if len(values) < 2:
            return {"error": "Insufficient data points for trend analysis"}
        
        # Calculate trend
        trend = self._calculate_trend(values)
        
        return {
            "metric_name": metric_name,
            "data_points": len(values),
            "current_value": values[-1] if values else 0,
            "average_value": sum(values) / len(values),
            "min_value": min(values),
            "max_value": max(values),
            "trend_direction": trend["direction"],
            "trend_strength": trend["strength"],
            "change_rate": trend["change_rate"]
        }
    
    def register_alert_callback(self, callback: Callable) -> None:
        """Register alert callback function"""
        self.alert_callbacks.append(callback)
    
    # Monitoring statistics update methods
    def update_stats(self, event_type: str = "info") -> None:
        """Update statistics"""
        self.stats["total_events"] += 1
        self.stats["last_update"] = datetime.now()
        
        if event_type == "error":
            self.stats["error_events"] += 1
        elif event_type == "warning":
            self.stats["warning_events"] += 1
    
    # Private methods
    async def _monitoring_loop(self) -> None:
        """Monitoring loop"""
        while self.monitoring_enabled:
            try:
                # Collect system metrics
                await self.collect_system_metrics()
                
                # Check alerts
                await self.check_alerts()
                
                # Wait for next collection
                await asyncio.sleep(self.collection_interval)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                await self._notify_alert("monitoring_loop_error", MonitorLevel.ERROR,
                                       f"Monitoring loop error: {e}", {"error": str(e)})
                await asyncio.sleep(self.collection_interval)
    
    async def _cleanup_loop(self) -> None:
        """Cleanup loop"""
        while self.monitoring_enabled:
            try:
                # Clean up expired data
                await self._cleanup_old_data()
                
                # Clean up every hour
                await asyncio.sleep(3600)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Cleanup loop error: {e}")
                await asyncio.sleep(3600)
    
    async def _cleanup_old_data(self) -> None:
        """Clean up expired data"""
        cutoff_time = datetime.now() - self.retention_period
        
        # Clean up system metrics
        self.system_metrics = deque(
            [m for m in self.system_metrics if m.timestamp >= cutoff_time],
            maxlen=self.max_data_points
        )
        
        # Clean up performance metrics
        self.performance_metrics = deque(
            [m for m in self.performance_metrics if m.timestamp >= cutoff_time],
            maxlen=self.max_data_points
        )
        
        # Clean up business metrics
        self.business_metrics = deque(
            [m for m in self.business_metrics if m.timestamp >= cutoff_time],
            maxlen=self.max_data_points
        )
        
        # Clean up quality metrics
        self.quality_metrics = deque(
            [m for m in self.quality_metrics if m.timestamp >= cutoff_time],
            maxlen=self.max_data_points
        )
        
        # Clean up alert history
        self.alert_history = [
            alert for alert in self.alert_history 
            if alert.timestamp >= cutoff_time
        ]
    
    def _update_metric_history(self, metric_name: str, value: float) -> None:
        """Update metric history"""
        self.metric_history[metric_name].append(value)
    
    async def _evaluate_alert_rule(self, rule: AlertRule) -> Optional[Alert]:
        """Evaluate alert rule"""
        # Get current metric value
        current_value = self._get_current_metric_value(rule.metric_type, rule.metric_name)
        
        if current_value is None:
            return None
        
        # Check threshold
        triggered = self._check_threshold(current_value, rule.threshold, rule.comparison)
        
        if not triggered:
            return None
        
        # Check duration
        if rule.last_triggered:
            duration = (datetime.now() - rule.last_triggered).total_seconds()
            if duration < rule.duration:
                return None
        
        # Create alert
        alert_id = f"{rule.name}_{int(time.time())}"
        message = rule.message_template.format(
            metric_name=rule.metric_name,
            current_value=current_value,
            threshold=rule.threshold,
            comparison=rule.comparison
        )
        
        alert = Alert(
            id=alert_id,
            rule_name=rule.name,
            level=rule.level,
            message=message,
            timestamp=datetime.now(),
            metric_value=current_value,
            threshold=rule.threshold,
            metadata={
                "metric_type": rule.metric_type.value,
                "metric_name": rule.metric_name,
                "comparison": rule.comparison
            }
        )
        
        # Update rule status
        rule.last_triggered = datetime.now()
        rule.trigger_count += 1
        
        return alert
    
    def _get_current_metric_value(self, metric_type: MetricType, metric_name: str) -> Optional[float]:
        """Get current metric value"""
        if metric_type not in self.current_metrics:
            return None
        
        metrics = self.current_metrics[metric_type]
        
        if hasattr(metrics, metric_name):
            return getattr(metrics, metric_name)
        
        return None
    
    def _check_threshold(self, value: float, threshold: float, comparison: str) -> bool:
        """Check threshold"""
        if comparison == ">":
            return value > threshold
        elif comparison == "<":
            return value < threshold
        elif comparison == ">=":
            return value >= threshold
        elif comparison == "<=":
            return value <= threshold
        elif comparison == "==":
            return value == threshold
        elif comparison == "!=":
            return value != threshold
        
        return False
    
    def _setup_default_alert_rules(self) -> None:
        """Setup default alert rules"""
        default_rules = [
            AlertRule(
                name="high_cpu_usage",
                metric_type=MetricType.SYSTEM,
                metric_name="cpu_usage",
                threshold=80.0,
                comparison=">",
                duration=300,  # 5 minutes
                level=MonitorLevel.WARNING,
                message_template="CPU usage too high: {current_value:.1f}% > {threshold:.1f}%"
            ),
            AlertRule(
                name="high_memory_usage",
                metric_type=MetricType.SYSTEM,
                metric_name="memory_usage",
                threshold=85.0,
                comparison=">",
                duration=300,
                level=MonitorLevel.WARNING,
                message_template="Memory usage too high: {current_value:.1f}% > {threshold:.1f}%"
            ),
            AlertRule(
                name="high_error_rate",
                metric_type=MetricType.PERFORMANCE,
                metric_name="error_rate",
                threshold=10.0,
                comparison=">",
                duration=60,
                level=MonitorLevel.ERROR,
                message_template="Error rate too high: {current_value:.1f}% > {threshold:.1f}%"
            ),
            AlertRule(
                name="low_success_rate",
                metric_type=MetricType.PERFORMANCE,
                metric_name="success_rate",
                threshold=90.0,
                comparison="<",
                duration=300,
                level=MonitorLevel.WARNING,
                message_template="Success rate too low: {current_value:.1f}% < {threshold:.1f}%"
            )
        ]
        
        for rule in default_rules:
            self.alert_rules[rule.name] = rule
    
    async def _notify_alert(self, alert_id: str, level: MonitorLevel, 
                          message: str, metadata: Dict[str, Any]) -> None:
        """Notify alert"""
        alert_data = {
            "alert_id": alert_id,
            "level": level.value,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata
        }
        
        # Call registered callback functions
        for callback in self.alert_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(alert_data)
                else:
                    callback(alert_data)
            except Exception as e:
                print(f"Alert callback execution failed: {e}")
    
    # BaseCallbackHandler interface implementation
    def on_task_start(self, agent, task):
        """Callback when task starts"""
        task_name = task.description if hasattr(task, 'description') else str(task)
        agent_name = agent.name if hasattr(agent, 'name') else str(agent)
        
        # Use asyncio to call the async method
        asyncio.create_task(self._notify_alert("task_started", MonitorLevel.INFO,
                                             f"Task {task_name} started by agent {agent_name}", 
                                             {"task_name": task_name, "agent_name": agent_name}))
    
    def on_task_end(self, agent, task, result):
        """Callback when task ends"""
        task_name = task.description if hasattr(task, 'description') else str(task)
        agent_name = agent.name if hasattr(agent, 'name') else str(agent)
        success = result.get('success', True) if isinstance(result, dict) else True
        
        # Use asyncio to call the async method
        asyncio.create_task(self._notify_alert("task_ended", MonitorLevel.INFO,
                                             f"Task {task_name} ended by agent {agent_name}", 
                                             {"task_name": task_name, "agent_name": agent_name, 
                                              "success": success, "result": result}))
    
    def on_error(self, error: Exception, context):
        """Callback when error occurs"""
        error_message = str(error)
        
        # Use asyncio to call the async method
        asyncio.create_task(self._notify_alert("system_error", MonitorLevel.ERROR,
                                             f"System error: {error_message}", 
                                             {"error": error_message, "context": context}))
    
    def _serialize_metrics(self, metrics: Any) -> Dict[str, Any]:
        """Serialize metrics"""
        if hasattr(metrics, '__dict__'):
            result = {}
            for key, value in metrics.__dict__.items():
                if isinstance(value, datetime):
                    result[key] = value.isoformat()
                elif isinstance(value, (int, float, str, bool)):
                    result[key] = value
                elif isinstance(value, dict):
                    result[key] = value
                else:
                    result[key] = str(value)
            return result
        
        return {}
    
    def _calculate_system_stats(self, metrics_data: List[SystemMetrics]) -> Dict[str, Any]:
        """Calculate system statistics"""
        cpu_values = [m.cpu_usage for m in metrics_data]
        memory_values = [m.memory_usage for m in metrics_data]
        
        return {
            "avg_cpu_usage": sum(cpu_values) / len(cpu_values),
            "max_cpu_usage": max(cpu_values),
            "avg_memory_usage": sum(memory_values) / len(memory_values),
            "max_memory_usage": max(memory_values)
        }
    
    def _calculate_performance_stats(self, metrics_data: List[PerformanceMetrics]) -> Dict[str, Any]:
        """Calculate performance statistics"""
        response_times = [m.response_time for m in metrics_data]
        error_rates = [m.error_rate for m in metrics_data]
        
        return {
            "avg_response_time": sum(response_times) / len(response_times),
            "max_response_time": max(response_times),
            "avg_error_rate": sum(error_rates) / len(error_rates),
            "max_error_rate": max(error_rates)
        }
    
    def _calculate_business_stats(self, metrics_data: List[BusinessMetrics]) -> Dict[str, Any]:
        """Calculate business statistics"""
        total_searches = sum(m.search_requests for m in metrics_data)
        total_results = sum(m.total_results for m in metrics_data)
        
        return {
            "total_search_requests": total_searches,
            "total_results": total_results,
            "avg_results_per_search": total_results / total_searches if total_searches > 0 else 0
        }
    
    def _calculate_quality_stats(self, metrics_data: List[QualityMetrics]) -> Dict[str, Any]:
        """Calculate quality statistics"""
        relevance_scores = [m.result_relevance for m in metrics_data]
        quality_scores = [m.report_quality_score for m in metrics_data]
        
        return {
            "avg_relevance_score": sum(relevance_scores) / len(relevance_scores),
            "avg_quality_score": sum(quality_scores) / len(quality_scores)
        }
    
    def _calculate_trend(self, values: List[float]) -> Dict[str, Any]:
        """Calculate trend"""
        if len(values) < 2:
            return {"direction": "unknown", "strength": 0.0, "change_rate": 0.0}
        
        # Simple linear trend calculation
        n = len(values)
        x_sum = sum(range(n))
        y_sum = sum(values)
        xy_sum = sum(i * values[i] for i in range(n))
        x2_sum = sum(i * i for i in range(n))
        
        slope = (n * xy_sum - x_sum * y_sum) / (n * x2_sum - x_sum * x_sum)
        
        direction = "increasing" if slope > 0 else "decreasing" if slope < 0 else "stable"
        strength = abs(slope)
        change_rate = (values[-1] - values[0]) / values[0] * 100 if values[0] != 0 else 0.0
        
        return {
            "direction": direction,
            "strength": strength,
            "change_rate": change_rate
        }