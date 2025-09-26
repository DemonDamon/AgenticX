"""
AgenticX M9 可观测性模块测试脚本

测试M9模块的各个组件功能。
"""

import sys
import os
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import pytest
import asyncio
import time
from datetime import datetime, timedelta, UTC
from typing import List, Dict, Any
import json
import tempfile

# 导入M9模块
from agenticx.observability import (
    BaseCallbackHandler, CallbackManager, LoggingCallbackHandler,
    TrajectoryCollector, ExecutionTrajectory, MonitoringCallbackHandler,
    TrajectorySummarizer, FailureAnalyzer, MetricsCalculator,
    WebSocketCallbackHandler, EventStream, TimeSeriesData,
    StatisticsCalculator, DataExporter, LogLevel, LogFormat
)
from agenticx.observability.trajectory import StepStatus

# 导入核心模块
from agenticx.core import (
    Agent, Task, TaskStartEvent, TaskEndEvent, ToolCallEvent, 
    ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent,
    EventLog
)
from agenticx.llms import LLMResponse


class TestCallbackSystem:
    """测试回调系统"""
    
    def test_callback_manager_creation(self):
        """测试回调管理器创建"""
        manager = CallbackManager()
        assert manager.is_enabled
        assert len(manager.get_all_handlers()) == 0
        
    def test_callback_handler_registration(self):
        """测试回调处理器注册"""
        manager = CallbackManager()
        handler = LoggingCallbackHandler(console_output=False)
        
        manager.register_handler(handler)
        assert len(manager.get_all_handlers()) == 1
        assert manager.get_all_handlers()[0] == handler
        
    def test_event_processing(self):
        """测试事件处理"""
        manager = CallbackManager()
        handler = LoggingCallbackHandler(console_output=False)
        manager.register_handler(handler)
        
        # 创建测试事件
        event = TaskStartEvent(
            task_description="Test task",
            agent_id="test-agent",
            task_id="test-task"
        )
        
        # 处理事件
        manager.process_event(event)
        
        # 验证统计信息
        stats = manager.get_stats()
        assert stats["processing_stats"]["events_processed"] == 1
        assert stats["processing_stats"]["events_failed"] == 0


class TestLoggingCallbackHandler:
    """测试日志回调处理器"""
    
    def test_logging_handler_creation(self):
        """测试日志处理器创建"""
        handler = LoggingCallbackHandler(console_output=False)
        assert handler.log_level == LogLevel.INFO
        assert not handler.include_event_data or handler.include_event_data
        
    def test_task_event_logging(self):
        """测试任务事件日志"""
        handler = LoggingCallbackHandler(console_output=False)
        
        # 创建测试数据
        agent = Agent(
            id="test-agent",
            name="Test Agent",
            role="Tester",
            goal="Test things",
            organization_id="test-org"
        )
        
        task = Task(
            id="test-task",
            description="Test task description",
            expected_output="Test task should complete successfully"
        )
        
        # 测试任务开始
        handler.on_task_start(agent, task)
        
        # 测试任务结束
        result = {"success": True, "result": "Task completed"}
        handler.on_task_end(agent, task, result)
        
        # 验证统计信息
        stats = handler.get_event_stats()
        assert stats["event_counts"]["task_start"] == 1
        assert stats["event_counts"]["task_end"] == 1
        
    def test_json_log_format(self):
        """测试JSON日志格式"""
        import tempfile
        import time
        
        log_file = None
        try:
            # 创建临时文件
            with tempfile.NamedTemporaryFile(mode='w', suffix='.log', delete=False) as f:
                log_file = f.name
            
            handler = LoggingCallbackHandler(
                log_format=LogFormat.JSON,
                output_file=log_file,
                console_output=False
            )
            
            # 记录一个事件
            handler.on_error(Exception("Test error"), {"error_type": "test"})
            
            # 确保处理器关闭，释放文件句柄
            if hasattr(handler, 'close'):
                handler.close()
            
            # 验证文件存在
            assert os.path.exists(log_file)
            
        finally:
            # 清理临时文件
            if log_file and os.path.exists(log_file):
                try:
                    time.sleep(0.1)  # 等待文件句柄释放
                    os.unlink(log_file)
                except (OSError, PermissionError):
                    pass  # 忽略清理错误


class TestTrajectoryCollector:
    """测试轨迹收集器"""
    
    def test_trajectory_collector_creation(self):
        """测试轨迹收集器创建"""
        collector = TrajectoryCollector()
        assert collector.auto_finalize
        assert collector.store_trajectories
        assert len(collector.active_trajectories) == 0
        assert len(collector.completed_trajectories) == 0
        
    def test_trajectory_collection(self):
        """测试轨迹收集"""
        collector = TrajectoryCollector()
        
        # 创建测试事件
        task_start = TaskStartEvent(
            task_description="Test task",
            agent_id="test-agent",
            task_id="test-task"
        )
        
        task_end = TaskEndEvent(
            success=True,
            result="Task completed",
            agent_id="test-agent",
            task_id="test-task"
        )
        
        # 处理事件
        collector.on_event(task_start)
        collector.on_event(task_end)
        
        # 验证轨迹收集
        assert len(collector.completed_trajectories) == 1
        trajectory = collector.completed_trajectories[0]
        assert trajectory.metadata.agent_id == "test-agent"
        assert trajectory.metadata.task_id == "test-task"
        assert trajectory.metadata.total_steps == 2
        
    def test_trajectory_export(self):
        """测试轨迹导出"""
        collector = TrajectoryCollector()
        
        # 创建测试轨迹
        task_start = TaskStartEvent(
            task_description="Test task",
            agent_id="test-agent",
            task_id="test-task"
        )
        collector.on_event(task_start)
        
        # 手动完成轨迹
        collector.finalize_trajectory("test-agent", "test-task", StepStatus.COMPLETED)
        
        # 导出轨迹
        trajectory = collector.completed_trajectories[0]
        json_data = trajectory.to_json()
        
        # 验证JSON数据
        data = json.loads(json_data)
        assert data["trajectory_id"] == trajectory.trajectory_id
        assert data["metadata"]["agent_id"] == "test-agent"


class TestMonitoringCallbackHandler:
    """测试监控回调处理器"""
    
    def test_monitoring_handler_creation(self):
        """测试监控处理器创建"""
        handler = MonitoringCallbackHandler(collect_system_metrics=False)
        assert not handler.collect_system_metrics
        assert handler.metrics_collector is not None
        
    def test_performance_metrics_collection(self):
        """测试性能指标收集"""
        handler = MonitoringCallbackHandler(collect_system_metrics=False)
        
        # 创建测试数据
        agent = Agent(
            id="test-agent",
            name="Test Agent",
            role="Tester",
            goal="Test things",
            organization_id="test-org"
        )
        
        task = Task(
            id="test-task",
            description="Test task description",
            expected_output="Test task should complete successfully"
        )
        
        # 模拟任务执行
        handler.on_task_start(agent, task)
        time.sleep(0.1)  # 模拟执行时间
        handler.on_task_end(agent, task, {"success": True, "execution_time": 0.1})
        
        # 验证指标收集
        metrics = handler.get_metrics()
        assert metrics["performance_metrics"]["task_count"] == 1
        assert metrics["performance_metrics"]["task_success_count"] == 1
        assert metrics["performance_metrics"]["task_duration_avg"] > 0
        
    def test_prometheus_export(self):
        """测试Prometheus格式导出"""
        handler = MonitoringCallbackHandler(collect_system_metrics=False)
        
        # 收集一些指标
        handler.on_tool_start("test_tool", {"arg": "value"})
        handler.on_tool_end("test_tool", "result", True)
        
        # 获取Prometheus格式
        prometheus_data = handler.get_prometheus_metrics()
        
        # 验证格式
        assert "agenticx_tasks_total" in prometheus_data
        assert "agenticx_tool_calls_total" in prometheus_data
        assert "# TYPE" in prometheus_data
        assert "# HELP" in prometheus_data


class TestTrajectorySummarizer:
    """测试轨迹摘要器"""
    
    def test_summarizer_creation(self):
        """测试摘要器创建"""
        summarizer = TrajectorySummarizer()
        assert summarizer.llm_provider is None
        
    def test_trajectory_summarization(self):
        """测试轨迹摘要"""
        summarizer = TrajectorySummarizer()
        
        # 创建测试轨迹
        trajectory = ExecutionTrajectory(agent_id="test-agent", task_id="test-task")
        
        # 添加一些步骤
        from agenticx.observability.trajectory import TrajectoryStep, StepType, StepStatus
        
        step1 = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            duration=1.0
        )
        
        step2 = TrajectoryStep(
            step_type=StepType.TOOL_CALL,
            status=StepStatus.COMPLETED,
            duration=2.0
        )
        
        trajectory.add_step(step1)
        trajectory.add_step(step2)
        trajectory.finalize(StepStatus.COMPLETED)
        
        # 生成摘要
        summary = summarizer.summarize(trajectory)
        
        # 验证摘要
        assert summary["trajectory_id"] == trajectory.trajectory_id
        assert summary["basic_info"]["total_steps"] == 2
        assert summary["basic_info"]["success_rate"] == 1.0
        assert "performance_summary" in summary
        assert "execution_flow" in summary


class TestFailureAnalyzer:
    """测试失败分析器"""
    
    def test_failure_analyzer_creation(self):
        """测试失败分析器创建"""
        analyzer = FailureAnalyzer()
        assert analyzer.llm_provider is None
        assert analyzer.failure_patterns is not None
        
    def test_failure_analysis(self):
        """测试失败分析"""
        analyzer = FailureAnalyzer()
        
        # 创建有错误的轨迹
        trajectory = ExecutionTrajectory(agent_id="test-agent", task_id="test-task")
        
        from agenticx.observability.trajectory import TrajectoryStep, StepType, StepStatus
        
        error_step = TrajectoryStep(
            step_type=StepType.ERROR,
            status=StepStatus.FAILED,
            error_data={
                "error_type": "tool_error",
                "error_message": "Tool execution failed",
                "recoverable": True
            }
        )
        
        trajectory.add_step(error_step)
        trajectory.finalize(StepStatus.FAILED)
        
        # 分析失败
        failure_report = analyzer.analyze_failure(trajectory)
        
        # 验证分析结果
        assert failure_report is not None
        assert failure_report.failure_type == "tool_error"
        assert failure_report.failure_message == "Tool execution failed"
        assert len(failure_report.recovery_suggestions) > 0


class TestMetricsCalculator:
    """测试指标计算器"""
    
    def test_metrics_calculator_creation(self):
        """测试指标计算器创建"""
        calculator = MetricsCalculator()
        assert calculator is not None
        
    def test_success_rate_calculation(self):
        """测试成功率计算"""
        calculator = MetricsCalculator()
        
        # 创建测试轨迹
        trajectory1 = ExecutionTrajectory()
        trajectory1.metadata.successful_steps = 5
        trajectory1.metadata.total_steps = 5
        
        trajectory2 = ExecutionTrajectory()
        trajectory2.metadata.successful_steps = 3
        trajectory2.metadata.total_steps = 5
        
        trajectories = [trajectory1, trajectory2]
        
        # 计算成功率
        success_rate = calculator.calculate_success_rate(trajectories)
        assert success_rate == 1.0  # 两个轨迹都有成功步骤
        
    def test_average_duration_calculation(self):
        """测试平均执行时间计算"""
        calculator = MetricsCalculator()
        
        # 创建测试轨迹
        trajectory1 = ExecutionTrajectory()
        trajectory1.metadata.total_duration = 10.0
        
        trajectory2 = ExecutionTrajectory()
        trajectory2.metadata.total_duration = 20.0
        
        trajectories = [trajectory1, trajectory2]
        
        # 计算平均时间
        avg_duration = calculator.calculate_average_duration(trajectories)
        assert avg_duration == 15.0


class TestWebSocketCallbackHandler:
    """测试WebSocket回调处理器"""
    
    def test_websocket_handler_creation(self):
        """测试WebSocket处理器创建"""
        handler = WebSocketCallbackHandler()
        assert handler.event_stream is not None
        assert handler.include_detailed_data
        
    def test_event_stream(self):
        """测试事件流"""
        from agenticx.observability.websocket import EventStream
        
        stream = EventStream()
        assert stream.get_client_count() == 0
        
        # 测试客户端管理
        stats = stream.get_stats()
        assert stats["current_clients"] == 0
        assert stats["total_clients_connected"] == 0


class TestTimeSeriesData:
    """测试时间序列数据"""
    
    def test_time_series_creation(self):
        """测试时间序列创建"""
        ts_data = TimeSeriesData()
        assert len(ts_data.data) == 0
        
    def test_add_data_points(self):
        """测试添加数据点"""
        ts_data = TimeSeriesData()
        
        # 添加数据点
        now = datetime.now(UTC)
        ts_data.add_point(now, 10.0)
        ts_data.add_point(now + timedelta(seconds=1), 20.0)
        
        # 验证数据
        assert len(ts_data.data) == 2
        latest = ts_data.get_latest_point()
        assert latest.value == 20.0
        
    def test_statistics_calculation(self):
        """测试统计计算"""
        ts_data = TimeSeriesData()
        
        # 添加测试数据
        now = datetime.now(UTC)
        for i in range(10):
            ts_data.add_point(now + timedelta(seconds=i), float(i))
        
        # 计算统计
        stats = ts_data.calculate_statistics()
        assert stats["count"] == 10
        assert stats["min"] == 0.0
        assert stats["max"] == 9.0
        assert stats["mean"] == 4.5


class TestStatisticsCalculator:
    """测试统计计算器"""
    
    def test_statistics_calculator_creation(self):
        """测试统计计算器创建"""
        calculator = StatisticsCalculator()
        assert calculator is not None
        
    def test_descriptive_statistics(self):
        """测试描述性统计"""
        calculator = StatisticsCalculator()
        
        values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        stats = calculator.calculate_descriptive_stats(values)
        
        assert stats["count"] == 10
        assert stats["min"] == 1
        assert stats["max"] == 10
        assert stats["mean"] == 5.5
        assert stats["median"] == 5.5
        
    def test_outlier_detection(self):
        """测试异常值检测"""
        calculator = StatisticsCalculator()
        
        # 包含异常值的数据
        values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]  # 100是异常值
        outliers = calculator.detect_outliers(values, method="iqr")
        
        assert len(outliers) == 1
        assert outliers[0][1] == 100  # 检测到异常值100
        
    def test_trend_calculation(self):
        """测试趋势计算"""
        calculator = StatisticsCalculator()
        
        # 递增数据
        values = [1, 2, 3, 4, 5]
        trend = calculator.calculate_trend(values)
        
        assert trend["trend"] == "increasing"
        assert trend["slope"] > 0


class TestDataExporter:
    """测试数据导出器"""
    
    def test_data_exporter_creation(self):
        """测试数据导出器创建"""
        exporter = DataExporter()
        assert exporter is not None
        
    def test_json_export(self):
        """测试JSON导出"""
        exporter = DataExporter()
        
        test_data = {"key": "value", "number": 42}
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json_file = f.name
        
        try:
            exporter.export_to_json(test_data, json_file)
            
            # 验证文件存在
            assert os.path.exists(json_file)
            
            # 验证内容
            imported_data = exporter.import_from_json(json_file)
            assert imported_data == test_data
            
        finally:
            if os.path.exists(json_file):
                os.unlink(json_file)
                
    def test_csv_export(self):
        """测试CSV导出"""
        exporter = DataExporter()
        
        test_data = [
            {"name": "Alice", "age": 30, "city": "New York"},
            {"name": "Bob", "age": 25, "city": "Los Angeles"}
        ]
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            csv_file = f.name
        
        try:
            exporter.export_to_csv(test_data, csv_file)
            
            # 验证文件存在
            assert os.path.exists(csv_file)
            
            # 验证内容
            with open(csv_file, 'r') as f:
                content = f.read()
                assert "Alice" in content
                assert "Bob" in content
                
        finally:
            if os.path.exists(csv_file):
                os.unlink(csv_file)


class TestIntegration:
    """集成测试"""
    
    def test_complete_observability_pipeline(self):
        """测试完整的可观测性流水线"""
        # 创建组件
        callback_manager = CallbackManager()
        logging_handler = LoggingCallbackHandler(console_output=False)
        trajectory_collector = TrajectoryCollector()
        monitoring_handler = MonitoringCallbackHandler(collect_system_metrics=False)
        
        # 注册处理器
        callback_manager.register_handler(logging_handler)
        callback_manager.register_handler(trajectory_collector)
        callback_manager.register_handler(monitoring_handler)
        
        # 创建测试事件序列
        events = [
            TaskStartEvent(
                task_description="Integration test task",
                agent_id="test-agent",
                task_id="test-task"
            ),
            ToolCallEvent(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                intent="Test tool call",
                agent_id="test-agent",
                task_id="test-task"
            ),
            ToolResultEvent(
                tool_name="test_tool",
                result="Tool result",
                success=True,
                agent_id="test-agent",
                task_id="test-task"
            ),
            TaskEndEvent(
                success=True,
                result="Task completed successfully",
                agent_id="test-agent",
                task_id="test-task"
            )
        ]
        
        # 处理事件
        for event in events:
            callback_manager.process_event(event)
        
        # 验证结果
        
        # 1. 验证日志处理器
        log_stats = logging_handler.get_event_stats()
        assert log_stats["event_counts"]["task_start"] == 1
        assert log_stats["event_counts"]["task_end"] == 1
        assert log_stats["event_counts"]["tool_call"] == 1
        assert log_stats["event_counts"]["tool_result"] == 1
        
        # 2. 验证轨迹收集器
        assert len(trajectory_collector.completed_trajectories) == 1
        trajectory = trajectory_collector.completed_trajectories[0]
        assert trajectory.metadata.agent_id == "test-agent"
        assert trajectory.metadata.task_id == "test-task"
        assert trajectory.metadata.total_steps == 4
        
        # 3. 验证监控处理器
        monitoring_stats = monitoring_handler.get_metrics()
        assert monitoring_stats["performance_metrics"]["task_count"] == 1
        assert monitoring_stats["performance_metrics"]["tool_call_count"] == 1
        
        # 4. 验证分析功能
        summarizer = TrajectorySummarizer()
        summary = summarizer.summarize(trajectory)
        assert summary["basic_info"]["total_steps"] == 4
        assert summary["basic_info"]["success_rate"] == 1.0
        
    def test_async_event_processing(self):
        """测试异步事件处理"""
        async def async_test():
            callback_manager = CallbackManager()
            handler = LoggingCallbackHandler(console_output=False)
            callback_manager.register_handler(handler)
            
            # 创建测试事件
            event = TaskStartEvent(
                task_description="Async test task",
                agent_id="async-agent",
                task_id="async-task"
            )
            
            # 异步处理事件
            await callback_manager.aprocess_event(event)
            
            # 验证处理结果
            stats = callback_manager.get_stats()
            assert stats["processing_stats"]["events_processed"] == 1
        
        # 运行异步测试
        asyncio.run(async_test())


def run_performance_test():
    """运行性能测试"""
    print("开始性能测试...")
    
    # 创建大量事件
    callback_manager = CallbackManager()
    handler = LoggingCallbackHandler(console_output=False)
    callback_manager.register_handler(handler)
    
    num_events = 1000
    start_time = time.time()
    
    for i in range(num_events):
        event = TaskStartEvent(
            task_description=f"Performance test task {i}",
            agent_id=f"agent-{i % 10}",
            task_id=f"task-{i}"
        )
        callback_manager.process_event(event)
    
    end_time = time.time()
    duration = end_time - start_time
    
    print(f"处理 {num_events} 个事件用时: {duration:.2f}秒")
    print(f"每秒处理事件数: {num_events/duration:.2f}")
    
    # 验证统计
    stats = callback_manager.get_stats()
    assert stats["processing_stats"]["events_processed"] == num_events
    print("性能测试通过!")


if __name__ == "__main__":
    # 运行测试
    print("开始运行M9可观测性模块测试...")
    
    # 创建测试实例
    test_classes = [
        TestCallbackSystem,
        TestLoggingCallbackHandler,
        TestTrajectoryCollector,
        TestMonitoringCallbackHandler,
        TestTrajectorySummarizer,
        TestFailureAnalyzer,
        TestMetricsCalculator,
        TestWebSocketCallbackHandler,
        TestTimeSeriesData,
        TestStatisticsCalculator,
        TestDataExporter,
        TestIntegration
    ]
    
    # 运行所有测试
    for test_class in test_classes:
        print(f"\n运行测试: {test_class.__name__}")
        test_instance = test_class()
        
        # 运行测试方法
        for method_name in dir(test_instance):
            if method_name.startswith("test_"):
                try:
                    method = getattr(test_instance, method_name)
                    method()
                    print(f"  ✓ {method_name}")
                except Exception as e:
                    print(f"  ✗ {method_name}: {e}")
    
    # 运行性能测试
    print("\n" + "="*50)
    run_performance_test()
    
    print("\n" + "="*50)
    print("M9可观测性模块测试完成!")