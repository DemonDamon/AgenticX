# AgenticX M9: 可观测性与分析模块

M9模块是AgenticX框架的可观测性系统，提供全面的监控、分析和评估功能。

## 🎯 主要功能

### 1. 核心回调系统
- **BaseCallbackHandler**: 统一的回调处理器基类
- **CallbackManager**: 回调管理器，负责事件分发
- **CallbackRegistry**: 回调注册表，管理处理器

### 2. 日志记录
- **LoggingCallbackHandler**: 结构化日志处理器
- **StructuredLogger**: 支持多种格式的日志记录
- **LogFormat**: 支持JSON、XML、结构化文本等格式

### 3. 轨迹收集与分析
- **TrajectoryCollector**: 执行轨迹收集器
- **ExecutionTrajectory**: 完整的执行轨迹数据
- **TrajectorySummarizer**: 智能轨迹摘要生成
- **FailureAnalyzer**: 失败分析和根因分析

### 4. 性能监控
- **MonitoringCallbackHandler**: 实时性能监控
- **MetricsCollector**: 指标收集和聚合
- **PrometheusExporter**: Prometheus格式指标导出

### 5. 实时通信
- **WebSocketCallbackHandler**: WebSocket实时事件推送
- **EventStream**: 事件流管理
- **RealtimeMonitor**: 实时监控面板

### 6. 评估与基准测试
- **BenchmarkRunner**: 基准测试执行器
- **MetricsCalculator**: 性能指标计算
- **AutoEvaluator**: 自动输出质量评估

### 7. 数据分析工具
- **TimeSeriesData**: 时间序列数据管理
- **StatisticsCalculator**: 统计分析
- **DataExporter**: 多格式数据导出

## 🚀 快速开始

### 基础使用

```python
from agenticx import (
    CallbackManager, LoggingCallbackHandler, TrajectoryCollector,
    MonitoringCallbackHandler, TaskStartEvent, TaskEndEvent
)

# 创建回调管理器
callback_manager = CallbackManager()

# 添加日志处理器
logging_handler = LoggingCallbackHandler(
    log_level=LogLevel.INFO,
    console_output=True
)

# 添加轨迹收集器
trajectory_collector = TrajectoryCollector(
    auto_finalize=True,
    store_trajectories=True
)

# 添加监控处理器
monitoring_handler = MonitoringCallbackHandler(
    collect_system_metrics=True
)

# 注册处理器
callback_manager.register_handler(logging_handler)
callback_manager.register_handler(trajectory_collector)
callback_manager.register_handler(monitoring_handler)

# 处理事件
event = TaskStartEvent(
    task_description="示例任务",
    agent_id="agent-001",
    task_id="task-001"
)
callback_manager.process_event(event)
```

### 轨迹分析

```python
from agenticx.observability import TrajectorySummarizer, FailureAnalyzer

# 获取轨迹数据
trajectories = trajectory_collector.get_completed_trajectories()

# 生成摘要
summarizer = TrajectorySummarizer()
for trajectory in trajectories:
    summary = summarizer.summarize(trajectory)
    print(f"轨迹摘要: {summary}")

# 分析失败
failure_analyzer = FailureAnalyzer()
for trajectory in trajectories:
    if trajectory.get_errors():
        failure_report = failure_analyzer.analyze_failure(trajectory)
        print(f"失败分析: {failure_report}")
```

### 性能监控

```python
# 获取性能指标
metrics = monitoring_handler.get_metrics()
print(f"任务成功率: {metrics['performance_metrics']['task_success_count']}")

# 导出Prometheus格式
prometheus_data = monitoring_handler.get_prometheus_metrics()
with open("metrics.txt", "w") as f:
    f.write(prometheus_data)
```

### 数据导出

```python
from agenticx.observability import DataExporter

exporter = DataExporter()

# 导出轨迹为CSV
exporter.export_trajectories_to_csv(trajectories, "trajectories.csv")

# 导出监控数据为JSON
exporter.export_to_json(metrics, "monitoring.json")
```

## 🛠️ 运行示例

### 快速体验
```bash
python run_m9_demo.py
```

### 完整演示
```bash
python examples/m9_observability_demo.py
```

### 运行测试
```bash
python tests/test_m9_observability.py
```

## 📊 输出文件

运行示例后，会生成以下文件：

- `sample_trajectories.csv` - 轨迹数据摘要
- `sample_monitoring.json` - 监控指标数据
- `sample_prometheus.txt` - Prometheus格式指标
- `demo_trajectory.json` - 详细轨迹数据
- `demo_time_series.csv` - 时间序列数据
- `demo_summary_report.json` - 综合报告

## 🔧 配置选项

### 日志配置
```python
logging_handler = LoggingCallbackHandler(
    log_level=LogLevel.INFO,           # 日志级别
    log_format=LogFormat.STRUCTURED,   # 日志格式
    output_file="agent.log",           # 输出文件
    console_output=True,               # 控制台输出
    include_event_data=True            # 包含事件数据
)
```

### 轨迹收集配置
```python
trajectory_collector = TrajectoryCollector(
    auto_finalize=True,        # 自动完成轨迹
    store_trajectories=True,   # 存储轨迹
    max_trajectories=100       # 最大轨迹数
)
```

### 监控配置
```python
monitoring_handler = MonitoringCallbackHandler(
    collect_system_metrics=True,     # 收集系统指标
    system_metrics_interval=30.0     # 系统指标间隔
)
```

## 🎨 集成WebSocket实时监控

```python
from agenticx.observability import WebSocketCallbackHandler, EventStream

# 创建WebSocket处理器
websocket_handler = WebSocketCallbackHandler(
    include_detailed_data=True
)

# 注册处理器
callback_manager.register_handler(websocket_handler)

# 获取事件流
event_stream = websocket_handler.event_stream

# 添加客户端（在实际应用中通过WebSocket连接）
# client = event_stream.add_client("client-1", websocket_connection)
```

## 📈 高级分析功能

### 统计分析
```python
from agenticx.observability import StatisticsCalculator

calculator = StatisticsCalculator()

# 计算描述性统计
values = [1, 2, 3, 4, 5]
stats = calculator.calculate_descriptive_stats(values)

# 检测异常值
outliers = calculator.detect_outliers(values)

# 分析趋势
trend = calculator.calculate_trend(values)
```

### 时间序列分析
```python
from agenticx.observability import TimeSeriesData

ts_data = TimeSeriesData()

# 添加数据点
ts_data.add_point(datetime.now(), 10.0)
ts_data.add_metric_point("cpu_usage", datetime.now(), 75.0)

# 计算统计
stats = ts_data.calculate_statistics()

# 重采样
resampled = ts_data.resample(timedelta(hours=1), "mean")
```

## 🔬 基准测试

```python
from agenticx.observability import BenchmarkRunner

runner = BenchmarkRunner()

# 运行基准测试
result = runner.run_benchmark(
    benchmark_name="performance_test",
    agent=my_agent,
    tasks=test_tasks
)

# 对比多个Agent
comparison = runner.compare_agents(
    agents=[agent1, agent2],
    benchmark_name="comparison_test",
    tasks=test_tasks
)
```

## 🎯 最佳实践

1. **始终使用回调管理器**：统一管理所有回调处理器
2. **合理配置日志级别**：避免过多的调试信息影响性能
3. **定期清理轨迹数据**：防止内存占用过高
4. **监控关键指标**：重点关注成功率、响应时间、成本等
5. **及时分析失败**：快速定位和解决问题
6. **导出数据用于离线分析**：支持更深入的数据分析

## 🐛 故障排除

### 常见问题

1. **内存占用过高**
   - 减少 `max_trajectories` 设置
   - 禁用不必要的回调处理器
   - 定期清理历史数据

2. **性能影响**
   - 降低日志级别
   - 使用异步处理
   - 减少系统指标收集频率

3. **数据不完整**
   - 检查回调处理器是否正确注册
   - 确认事件是否被正确触发
   - 验证轨迹是否被正确完成

## 🔄 更新和维护

定期更新M9模块以获得最新功能：

```bash
# 检查模块状态
python -c "from agenticx.observability import __version__; print(__version__)"

# 运行完整测试
python tests/test_m9_observability.py
```

---

**AgenticX M9模块** - 让智能体系统的每一个动作都可观测、可分析、可优化！ 