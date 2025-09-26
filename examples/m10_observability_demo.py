"""
AgenticX M10 可观测性模块演示

这个示例展示了M10可观测性模块的各种功能，包括：
1. 回调系统使用
2. 日志记录
3. 轨迹收集和分析
4. 性能监控
5. 数据导出
6. 实时监控
"""

import sys
import os
# 添加项目根目录到Python路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import asyncio
import time
import random
import math
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any

# 导入M10模块
from agenticx.observability import (
    CallbackManager, LoggingCallbackHandler, TrajectoryCollector,
    MonitoringCallbackHandler, TrajectorySummarizer, FailureAnalyzer,
    MetricsCalculator, WebSocketCallbackHandler, TimeSeriesData,
    StatisticsCalculator, DataExporter, LogLevel, LogFormat
)

# 导入核心模块
from agenticx.core import (
    Agent, Task, TaskStartEvent, TaskEndEvent, ToolCallEvent,
    ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent,
    AgentExecutor, EventLog
)
from agenticx.llms import LLMResponse
from agenticx.tools import BaseTool, tool


class MockLLMProvider:
    """模拟LLM提供者"""
    
    def invoke(self, prompt: str) -> LLMResponse:
        # 模拟LLM响应
        return LLMResponse(
            content=f"模拟响应: {prompt[:50]}...",
            model_name="mock-llm-model",
            token_usage={"total_tokens": len(prompt.split())},
            cost=0.001
        )


def mock_calculation_tool(x: int, y: int) -> int:
    """模拟计算工具"""
    time.sleep(random.uniform(0.1, 0.5))  # 模拟执行时间
    if random.random() < 0.1:  # 10%的概率失败
        raise Exception("计算工具执行失败")
    return x + y


def mock_search_tool(query: str) -> str:
    """模拟搜索工具"""
    time.sleep(random.uniform(0.2, 0.8))  # 模拟执行时间
    if random.random() < 0.05:  # 5%的概率失败
        raise Exception("搜索服务不可用")
    return f"搜索结果: {query}"


class ObservabilityDemo:
    """可观测性演示"""
    
    def __init__(self):
        self.setup_observability()
        self.setup_test_environment()
        
    def setup_observability(self):
        """设置可观测性组件"""
        print("🔧 设置可观测性组件...")
        
        # 创建回调管理器
        self.callback_manager = CallbackManager()
        
        # 创建日志处理器
        self.logging_handler = LoggingCallbackHandler(
            log_level=LogLevel.INFO,
            log_format=LogFormat.STRUCTURED,
            console_output=True,
            include_event_data=True
        )
        
        # 创建轨迹收集器
        self.trajectory_collector = TrajectoryCollector(
            auto_finalize=True,
            store_trajectories=True,
            max_trajectories=100
        )
        
        # 创建监控处理器
        self.monitoring_handler = MonitoringCallbackHandler(
            collect_system_metrics=True,
            system_metrics_interval=10.0
        )
        
        # 创建WebSocket处理器（暂时禁用以避免异步问题）
        # self.websocket_handler = WebSocketCallbackHandler(
        #     include_detailed_data=True
        # )
        
        # 注册所有处理器
        self.callback_manager.register_handler(self.logging_handler)
        self.callback_manager.register_handler(self.trajectory_collector)
        self.callback_manager.register_handler(self.monitoring_handler)
        # self.callback_manager.register_handler(self.websocket_handler)
        
        print("✅ 可观测性组件设置完成")
        
    def setup_test_environment(self):
        """设置测试环境"""
        print("🔧 设置测试环境...")
        
        # 创建测试Agent
        self.agent = Agent(
            id="demo-agent",
            name="演示Agent",
            role="数据分析师",
            goal="执行各种数据分析任务",
            organization_id="demo-org"
        )
        
        # 创建测试任务
        self.tasks = [
            Task(
                id=f"task-{i}",
                description=f"执行数据分析任务 {i}",
                expected_output="分析结果"
            )
            for i in range(10)
        ]
        
        # 创建分析工具
        self.summarizer = TrajectorySummarizer()
        self.failure_analyzer = FailureAnalyzer()
        self.metrics_calculator = MetricsCalculator()
        self.data_exporter = DataExporter()
        
        print("✅ 测试环境设置完成")
        
    def simulate_agent_execution(self, task: Task) -> Dict[str, Any]:
        """模拟Agent执行"""
        print(f"🤖 开始执行任务: {task.description}")
        
        # 发送任务开始事件
        task_start = TaskStartEvent(
            task_description=task.description,
            agent_id=self.agent.id,
            task_id=task.id
        )
        self.callback_manager.process_event(task_start)
        
        # 模拟LLM调用
        llm_call = LLMCallEvent(
            prompt=f"分析任务: {task.description}",
            model="mock-llm-model",
            agent_id=self.agent.id,
            task_id=task.id
        )
        self.callback_manager.process_event(llm_call)
        
        # 模拟LLM响应
        llm_response = LLMResponseEvent(
            response="我需要使用工具来完成这个任务",
            token_usage={"total_tokens": 50},
            cost=0.001,
            agent_id=self.agent.id,
            task_id=task.id,
            data={"model": "mock-llm-model"}  # 将model信息放在data中
        )
        self.callback_manager.process_event(llm_response)
        
        # 模拟工具调用
        success = True
        try:
            # 随机选择工具
            if random.random() < 0.5:
                tool_name = "mock_calculation_tool"
                tool_args = {"x": random.randint(1, 10), "y": random.randint(1, 10)}
                result = mock_calculation_tool(**tool_args)
            else:
                tool_name = "mock_search_tool"
                tool_args = {"query": f"数据分析 {random.randint(1, 100)}"}
                result = mock_search_tool(**tool_args)
            
            # 发送工具调用事件
            tool_call = ToolCallEvent(
                tool_name=tool_name,
                tool_args=tool_args,
                intent="执行数据分析",
                agent_id=self.agent.id,
                task_id=task.id
            )
            self.callback_manager.process_event(tool_call)
            
            # 发送工具结果事件
            tool_result = ToolResultEvent(
                tool_name=tool_name,
                result=result,
                success=True,
                agent_id=self.agent.id,
                task_id=task.id
            )
            self.callback_manager.process_event(tool_result)
            
        except Exception as e:
            success = False
            
            # 发送错误事件
            error_event = ErrorEvent(
                error_type="tool_error",
                error_message=str(e),
                recoverable=True,
                agent_id=self.agent.id,
                task_id=task.id
            )
            self.callback_manager.process_event(error_event)
            result = f"任务失败: {str(e)}"
        
        # 发送任务结束事件
        task_end = TaskEndEvent(
            success=success,
            result=result,
            agent_id=self.agent.id,
            task_id=task.id
        )
        self.callback_manager.process_event(task_end)
        
        return {
            "success": success,
            "result": result,
            "execution_time": random.uniform(1.0, 5.0)
        }
        
    def run_task_batch(self, batch_size: int = 5):
        """运行任务批次"""
        print(f"🚀 开始运行 {batch_size} 个任务...")
        
        results = []
        for i in range(batch_size):
            task = self.tasks[i % len(self.tasks)]
            result = self.simulate_agent_execution(task)
            results.append(result)
            
            # 随机等待
            time.sleep(random.uniform(0.1, 0.5))
        
        print(f"✅ 批次执行完成，成功率: {sum(1 for r in results if r['success']) / len(results):.2%}")
        return results
        
    def analyze_performance(self):
        """分析性能"""
        print("\n📊 开始性能分析...")
        
        # 获取轨迹数据
        trajectories = self.trajectory_collector.get_completed_trajectories()
        
        if not trajectories:
            print("❌ 没有轨迹数据可供分析")
            return
        
        print(f"📈 分析 {len(trajectories)} 个轨迹...")
        
        # 1. 轨迹摘要
        print("\n=== 轨迹摘要 ===")
        for i, trajectory in enumerate(trajectories[:3]):  # 只展示前3个
            summary = self.summarizer.summarize(trajectory)
            print(f"轨迹 {i+1}:")
            print(f"  - 总步骤: {summary['basic_info']['total_steps']}")
            print(f"  - 成功率: {summary['basic_info']['success_rate']:.2%}")
            print(f"  - 执行时间: {summary['basic_info']['duration']:.2f}秒")
            print(f"  - 工具调用: {summary['execution_flow']['total_tools_used']}")
            print(f"  - 错误数量: {summary['execution_flow']['total_errors']}")
            
        # 2. 失败分析
        print("\n=== 失败分析 ===")
        failed_trajectories = [t for t in trajectories if len(t.get_errors()) > 0]
        
        if failed_trajectories:
            print(f"发现 {len(failed_trajectories)} 个失败轨迹")
            for trajectory in failed_trajectories[:2]:  # 只展示前2个
                failure_report = self.failure_analyzer.analyze_failure(trajectory)
                if failure_report:
                    print(f"  - 失败类型: {failure_report.failure_type}")
                    print(f"  - 失败消息: {failure_report.failure_message}")
                    print(f"  - 恢复建议: {failure_report.recovery_suggestions[:2]}")
        else:
            print("没有发现失败轨迹")
        
        # 3. 性能指标
        print("\n=== 性能指标 ===")
        metrics = self.metrics_calculator.calculate_all_metrics(trajectories)
        
        success_rate = metrics.get_metric('success_rate') or 0
        avg_duration = metrics.get_metric('average_duration') or 0
        total_cost = metrics.get_metric('total_cost') or 0
        error_rate = metrics.get_metric('error_rate') or 0
        
        print(f"  - 总成功率: {success_rate:.2%}")
        print(f"  - 平均执行时间: {avg_duration:.2f}秒")
        print(f"  - 总成本: ${total_cost:.4f}")
        print(f"  - 错误率: {error_rate:.2%}")
        
        # 4. 监控数据
        print("\n=== 监控数据 ===")
        monitoring_data = self.monitoring_handler.get_metrics()
        perf_metrics = monitoring_data["performance_metrics"]
        
        print(f"  - 任务总数: {perf_metrics['task_count']}")
        print(f"  - 成功任务: {perf_metrics['task_success_count']}")
        print(f"  - 失败任务: {perf_metrics['task_failure_count']}")
        print(f"  - 工具调用: {perf_metrics['tool_call_count']}")
        print(f"  - LLM调用: {perf_metrics['llm_call_count']}")
        
        return trajectories
        
    def export_data(self, trajectories: List):
        """导出数据"""
        print("\n💾 开始数据导出...")
        
        # 1. 导出轨迹为JSON
        if trajectories:
            self.data_exporter.export_trajectory_to_json(
                trajectories[0], 
                "demo_trajectory.json"
            )
            print("✅ 轨迹数据已导出到 demo_trajectory.json")
        
        # 2. 导出轨迹摘要为CSV
        self.data_exporter.export_trajectories_to_csv(
            trajectories,
            "demo_trajectories_summary.csv"
        )
        print("✅ 轨迹摘要已导出到 demo_trajectories_summary.csv")
        
        # 3. 导出监控数据
        monitoring_data = self.monitoring_handler.get_metrics()
        self.data_exporter.export_to_json(
            monitoring_data,
            "demo_monitoring_data.json"
        )
        print("✅ 监控数据已导出到 demo_monitoring_data.json")
        
        # 4. 导出Prometheus格式
        prometheus_data = self.monitoring_handler.get_prometheus_metrics()
        with open("demo_prometheus_metrics.txt", "w") as f:
            f.write(prometheus_data)
        print("✅ Prometheus指标已导出到 demo_prometheus_metrics.txt")
        
    def demonstrate_time_series_analysis(self):
        """演示时间序列分析"""
        print("\n📈 开始时间序列分析演示...")
        
        # 创建时间序列数据
        ts_data = TimeSeriesData()
        
        # 模拟一周的指标数据
        base_time = datetime.now(timezone.utc) - timedelta(days=7)
        
        for i in range(168):  # 一周的小时数
            timestamp = base_time + timedelta(hours=i)
            
            # 模拟CPU使用率（带有日周期性）
            cpu_usage = 50 + 20 * math.sin(i * 2 * 3.14159 / 24) + random.uniform(-10, 10)
            cpu_usage = max(0, min(100, cpu_usage))
            
            ts_data.add_metric_point("cpu_usage", timestamp, cpu_usage)
            
            # 模拟任务执行时间
            task_duration = 2.0 + random.uniform(-0.5, 1.0)
            ts_data.add_metric_point("task_duration", timestamp, task_duration)
        
        # 计算统计信息
        cpu_stats = ts_data.calculate_metric_statistics("cpu_usage")
        duration_stats = ts_data.calculate_metric_statistics("task_duration")
        
        print("CPU使用率统计:")
        print(f"  - 平均值: {cpu_stats['mean']:.2f}%")
        print(f"  - 最大值: {cpu_stats['max']:.2f}%")
        print(f"  - 最小值: {cpu_stats['min']:.2f}%")
        print(f"  - 标准差: {cpu_stats['std']:.2f}%")
        
        print("任务执行时间统计:")
        print(f"  - 平均值: {duration_stats['mean']:.2f}秒")
        print(f"  - 最大值: {duration_stats['max']:.2f}秒")
        print(f"  - 最小值: {duration_stats['min']:.2f}秒")
        print(f"  - 标准差: {duration_stats['std']:.2f}秒")
        
        # 重采样数据（按天聚合）
        resampled = ts_data.resample(timedelta(days=1), "mean")
        print(f"重采样后的数据点数: {len(resampled)}")
        
        # 导出时间序列数据
        self.data_exporter.export_time_series_to_csv(ts_data, "demo_time_series.csv")
        print("✅ 时间序列数据已导出到 demo_time_series.csv")
        
        return ts_data
        
    def demonstrate_statistics_analysis(self):
        """演示统计分析"""
        print("\n🔢 开始统计分析演示...")
        
        stats_calc = StatisticsCalculator()
        
        # 生成测试数据
        values = [random.uniform(1, 10) for _ in range(100)]
        
        # 计算描述性统计
        desc_stats = stats_calc.calculate_descriptive_stats(values)
        print("描述性统计:")
        for key, value in desc_stats.items():
            if value is not None:
                print(f"  - {key}: {value:.3f}")
        
        # 计算百分位数
        percentiles = stats_calc.calculate_percentiles(values)
        print("百分位数:")
        for key, value in percentiles.items():
            print(f"  - {key}: {value:.3f}")
        
        # 检测异常值
        outliers = stats_calc.detect_outliers(values)
        print(f"检测到 {len(outliers)} 个异常值")
        
        # 计算趋势
        trend = stats_calc.calculate_trend(values)
        print(f"趋势分析: {trend['trend']}")
        print(f"置信度: {trend['confidence']:.3f}")
        
    def generate_summary_report(self):
        """生成总结报告"""
        print("\n📋 生成总结报告...")
        
        # 获取各种统计信息
        callback_stats = self.callback_manager.get_stats()
        trajectory_stats = self.trajectory_collector.get_stats()
        monitoring_stats = self.monitoring_handler.get_stats()
        # websocket_stats = self.websocket_handler.get_stats()
        
        report = {
            "报告时间": datetime.now(timezone.utc).isoformat(),
            "回调系统": {
                "启用状态": callback_stats["is_enabled"],
                "已处理事件": callback_stats["processing_stats"]["events_processed"],
                "失败事件": callback_stats["processing_stats"]["events_failed"],
                "总执行时间": f"{callback_stats['processing_stats']['total_execution_time']:.3f}秒"
            },
            "轨迹收集": {
                "活跃轨迹": trajectory_stats["active_trajectories"],
                "完成轨迹": trajectory_stats["completed_trajectories"],
                "自动完成": trajectory_stats["auto_finalize"]
            },
            "监控系统": {
                "系统指标收集": monitoring_stats["collect_system_metrics"],
                "指标收集器统计": monitoring_stats["metrics_collector_stats"]["performance_metrics"]
            }
            # "WebSocket": {
            #     "事件统计": websocket_stats["event_counts"],
            #     "事件流统计": websocket_stats["event_stream_stats"]
            # }
        }
        
        # 导出报告
        self.data_exporter.export_to_json(report, "demo_summary_report.json")
        print("✅ 总结报告已导出到 demo_summary_report.json")
        
        # 打印关键信息
        print("\n=== 关键指标 ===")
        print(f"  - 总处理事件: {callback_stats['processing_stats']['events_processed']}")
        print(f"  - 成功率: {(callback_stats['processing_stats']['events_processed'] - callback_stats['processing_stats']['events_failed']) / max(callback_stats['processing_stats']['events_processed'], 1):.2%}")
        print(f"  - 完成轨迹: {trajectory_stats['completed_trajectories']}")
        print(f"  - 平均处理时间: {callback_stats['processing_stats']['total_execution_time'] / max(callback_stats['processing_stats']['events_processed'], 1) * 1000:.2f}ms")
        
        return report

    async def demonstrate_websocket_monitoring(self):
        """演示WebSocket实时监控"""
        print("\n🔴 开始WebSocket实时监控演示...")
        
        # 模拟客户端连接
        from agenticx.observability.websocket import EventStreamType, EventMessage
        
        # 创建事件流
        event_stream = self.websocket_handler.event_stream
        
        # 模拟添加客户端
        print("模拟客户端连接...")
        
        # 发送一些实时事件
        for i in range(5):
            # 模拟任务执行
            task_id = f"realtime-task-{i}"
            
            # 发送任务开始事件
            await event_stream.broadcast_event(
                EventMessage(
                    event_type="task_start",
                    event_data={
                        "task_id": task_id,
                        "agent_id": "realtime-agent",
                        "description": f"实时任务 {i}"
                    }
                )
            )
            
            await asyncio.sleep(0.5)
            
            # 发送任务完成事件
            await event_stream.broadcast_event(
                EventMessage(
                    event_type="task_end",
                    event_data={
                        "task_id": task_id,
                        "agent_id": "realtime-agent",
                        "success": True,
                        "duration": random.uniform(1.0, 3.0)
                    }
                )
            )
            
            await asyncio.sleep(0.2)
        
        # 获取事件流统计
        stream_stats = event_stream.get_stats()
        print(f"✅ WebSocket事件流统计: {stream_stats}")
        
    def run_demo(self):
        """运行完整演示"""
        print("🎉 开始AgenticX M10可观测性模块演示")
        print("=" * 60)
        
        # 1. 运行任务批次
        self.run_task_batch(8)
        
        # 2. 分析性能
        trajectories = self.analyze_performance()
        
        # 3. 导出数据
        if trajectories:
            self.export_data(trajectories)
        
        # 4. 时间序列分析
        self.demonstrate_time_series_analysis()
        
        # 5. 统计分析
        self.demonstrate_statistics_analysis()
        
        # 6. WebSocket监控（暂时禁用）
        # asyncio.run(self.demonstrate_websocket_monitoring())
        
        # 7. 生成总结报告
        self.generate_summary_report()
        
        print("\n" + "=" * 60)
        print("🎊 演示完成！请查看生成的文件:")
        print("  - demo_trajectory.json - 轨迹数据")
        print("  - demo_trajectories_summary.csv - 轨迹摘要")
        print("  - demo_monitoring_data.json - 监控数据")
        print("  - demo_prometheus_metrics.txt - Prometheus指标")
        print("  - demo_time_series.csv - 时间序列数据")
        print("  - demo_summary_report.json - 总结报告")


def main():
    """主函数"""
    try:
        demo = ObservabilityDemo()
        demo.run_demo()
    except KeyboardInterrupt:
        print("\n\n⏹️  演示被用户中断")
    except Exception as e:
        print(f"\n❌ 演示过程中发生错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()