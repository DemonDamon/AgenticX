"""
AgenticX M7 & M8 综合演示：智能数据处理工作流

这个演示展示了 M7 任务契约验证和 M8 工作流编排的完整功能：
- 任务输出解析和验证
- 输出自修复机制
- 复杂工作流编排
- 条件路由和并行执行
- 事件驱动的工作流管理

演示场景：构建一个智能数据处理工作流，包含数据收集、清洗、分析、验证和报告生成
"""

import sys
import os
import json
import asyncio
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    Agent, Task, tool, WorkflowEngine, WorkflowGraph,
    TaskOutputParser, TaskResultValidator, OutputRepairLoop,
    ScheduledTrigger, EventDrivenTrigger, TriggerService,
    RepairStrategy, WorkflowStatus
)
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, TokenUsage


# 定义数据模型
class DataSource(BaseModel):
    """数据源模型"""
    name: str = Field(..., description="数据源名称")
    type: str = Field(..., description="数据源类型")
    url: str = Field(..., description="数据源URL")
    status: str = Field(default="active", description="状态")


class DataQuality(BaseModel):
    """数据质量报告模型"""
    completeness: float = Field(..., ge=0.0, le=100.0, description="完整性百分比")
    accuracy: float = Field(..., ge=0.0, le=100.0, description="准确性百分比")
    consistency: float = Field(..., ge=0.0, le=100.0, description="一致性百分比")
    issues: List[str] = Field(default_factory=list, description="发现的问题")
    recommendations: List[str] = Field(default_factory=list, description="改进建议")


class AnalysisResult(BaseModel):
    """分析结果模型"""
    summary: str = Field(..., description="分析摘要")
    key_findings: List[str] = Field(default_factory=list, description="关键发现")
    metrics: Dict[str, float] = Field(default_factory=dict, description="关键指标")
    trend: str = Field(..., description="趋势分析")
    confidence: float = Field(..., ge=0.0, le=1.0, description="置信度")


class ProcessingReport(BaseModel):
    """处理报告模型"""
    workflow_id: str = Field(..., description="工作流ID")
    execution_time: float = Field(..., description="执行时间（秒）")
    data_sources: List[DataSource] = Field(default_factory=list, description="数据源列表")
    quality_report: Optional[DataQuality] = Field(None, description="质量报告")
    analysis_result: Optional[AnalysisResult] = Field(None, description="分析结果")
    status: str = Field(..., description="处理状态")
    errors: List[str] = Field(default_factory=list, description="错误列表")


class MockLLMProvider(BaseLLMProvider):
    """模拟 LLM 提供者，用于演示"""
    
    def __init__(self, responses=None, name="DataProcessor"):
        super().__init__(model=f"mock-{name}")
        object.__setattr__(self, 'responses', responses or [])
        object.__setattr__(self, 'call_count', 0)
        object.__setattr__(self, 'name', name)
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        if self.call_count < len(self.responses):
            content = self.responses[self.call_count]
        else:
            content = '{"status": "completed", "result": "default response"}'
        
        object.__setattr__(self, 'call_count', self.call_count + 1)
        
        return LLMResponse(
            id=f"mock-{self.name}-{self.call_count}",
            model_name=self.model,
            created=1234567890,
            content=content,
            choices=[],
            token_usage=TokenUsage(prompt_tokens=15, completion_tokens=25, total_tokens=40),
            cost=0.002
        )
    
    async def ainvoke(self, prompt: str, **kwargs) -> LLMResponse:
        return self.invoke(prompt, **kwargs)
    
    def stream(self, prompt: str, **kwargs):
        response = self.invoke(prompt, **kwargs)
        yield response.content
    
    async def astream(self, prompt: str, **kwargs):
        response = await self.ainvoke(prompt, **kwargs)
        yield response.content


# 定义工作流工具
@tool()
def collect_data_sources() -> str:
    """收集数据源信息"""
    sources = [
        {
            "name": "用户行为数据库",
            "type": "database",
            "url": "postgresql://localhost:5432/user_behavior",
            "status": "active"
        },
        {
            "name": "外部API数据",
            "type": "api",
            "url": "https://api.example.com/data",
            "status": "active"
        },
        {
            "name": "日志文件",
            "type": "file",
            "url": "/var/log/application.log",
            "status": "active"
        }
    ]
    
    return json.dumps(sources, ensure_ascii=False)


@tool()
def validate_data_sources(sources_json: str) -> str:
    """验证数据源的可用性"""
    try:
        sources = json.loads(sources_json)
        validated_sources = []
        
        for source in sources:
            # 模拟验证逻辑
            if source.get("status") == "active":
                source["validation_status"] = "passed"
                source["last_checked"] = datetime.now().isoformat()
            else:
                source["validation_status"] = "failed"
                source["error"] = "数据源不可用"
            
            validated_sources.append(source)
        
        return json.dumps(validated_sources, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"验证失败: {str(e)}"}, ensure_ascii=False)


@tool()
def clean_data(sources_json: str) -> str:
    """清洗数据"""
    try:
        sources = json.loads(sources_json)
        
        # 模拟数据清洗过程
        cleaning_results = {
            "total_records": 10000,
            "cleaned_records": 9500,
            "removed_duplicates": 300,
            "fixed_missing_values": 200,
            "cleaning_rules_applied": [
                "移除重复记录",
                "填充缺失值",
                "标准化格式",
                "验证数据类型"
            ]
        }
        
        return json.dumps(cleaning_results, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"数据清洗失败: {str(e)}"}, ensure_ascii=False)


@tool()
def analyze_data_quality(cleaning_results_json: str) -> str:
    """分析数据质量"""
    try:
        # 模拟数据质量分析
        quality_report = {
            "completeness": 95.0,
            "accuracy": 92.5,
            "consistency": 88.0,
            "issues": [
                "部分记录缺少时间戳",
                "用户ID格式不一致",
                "数值字段存在异常值"
            ],
            "recommendations": [
                "建立数据验证规则",
                "统一用户ID格式",
                "设置数值范围检查"
            ]
        }
        
        return json.dumps(quality_report, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"质量分析失败: {str(e)}"}, ensure_ascii=False)


@tool()
def perform_analysis(quality_report_json: str) -> str:
    """执行数据分析"""
    try:
        # 模拟复杂的数据分析
        analysis_result = {
            "summary": "用户行为数据分析显示活跃度呈上升趋势",
            "key_findings": [
                "移动端用户增长30%",
                "平均会话时长增加15%",
                "转化率提升8%",
                "用户留存率达到75%"
            ],
            "metrics": {
                "daily_active_users": 15000.0,
                "session_duration": 8.5,
                "conversion_rate": 12.3,
                "retention_rate": 75.0
            },
            "trend": "positive",
            "confidence": 0.89
        }
        
        return json.dumps(analysis_result, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"分析失败: {str(e)}"}, ensure_ascii=False)


@tool()
def generate_report(analysis_json: str, quality_json: str, workflow_id: str) -> str:
    """生成最终报告"""
    try:
        analysis = json.loads(analysis_json)
        quality = json.loads(quality_json)
        
        # 创建综合报告
        report = {
            "workflow_id": workflow_id,
            "execution_time": 45.6,
            "data_sources": [
                {
                    "name": "用户行为数据库",
                    "type": "database",
                    "url": "postgresql://localhost:5432/user_behavior",
                    "status": "active"
                }
            ],
            "quality_report": quality,
            "analysis_result": analysis,
            "status": "completed",
            "errors": []
        }
        
        # 保存报告到文件
        report_filename = f"data_processing_report_{workflow_id}.json"
        with open(report_filename, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        return json.dumps({
            "report_file": report_filename,
            "summary": "数据处理工作流执行完成",
            "status": "success"
        }, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"报告生成失败: {str(e)}"}, ensure_ascii=False)


@tool()
def send_notification(report_json: str) -> str:
    """发送通知"""
    try:
        report_data = json.loads(report_json)
        
        # 模拟发送通知
        notification = {
            "type": "email",
            "recipients": ["admin@company.com", "data-team@company.com"],
            "subject": "数据处理工作流完成",
            "message": f"工作流执行完成，报告文件：{report_data.get('report_file', 'unknown')}",
            "sent_at": datetime.now().isoformat(),
            "status": "sent"
        }
        
        return json.dumps(notification, ensure_ascii=False)
    
    except Exception as e:
        return json.dumps({"error": f"通知发送失败: {str(e)}"}, ensure_ascii=False)


class DataProcessingWorkflow:
    """数据处理工作流类"""
    
    def __init__(self):
        """初始化工作流"""
        self.engine = WorkflowEngine(max_concurrent_nodes=5)
        self.parser = TaskOutputParser(enable_fuzzy_parsing=True)
        self.validator = TaskResultValidator()
        self.repair_loop = OutputRepairLoop(
            max_repair_attempts=2,
            repair_strategy=RepairStrategy.SIMPLE
        )
        
        # 创建触发器服务
        self.trigger_service = TriggerService()
        self._setup_triggers()
    
    def _setup_triggers(self):
        """设置触发器"""
        # 定时触发器：每小时执行一次
        scheduled_trigger = ScheduledTrigger(
            "data_processing_workflow",
            "hourly",
            {"trigger_type": "scheduled", "source": "cron"}
        )
        
        # 事件触发器：数据更新时触发
        event_trigger = EventDrivenTrigger(
            "data_processing_workflow",
            "data_updated"
        )
        
        self.trigger_service.register_trigger("hourly_processing", scheduled_trigger)
        self.trigger_service.register_trigger("data_update_processing", event_trigger)
    
    def create_workflow_graph(self) -> WorkflowGraph:
        """创建工作流图"""
        graph = WorkflowGraph()
        
        # 添加节点
        graph.add_node("collect_sources", collect_data_sources, "tool", {
            "description": "收集所有可用的数据源"
        })
        
        graph.add_node("validate_sources", validate_data_sources, "tool", {
            "description": "验证数据源的可用性",
            "args": {"sources_json": "${collect_sources}"}
        })
        
        graph.add_node("clean_data", clean_data, "tool", {
            "description": "清洗和预处理数据",
            "args": {"sources_json": "${validate_sources}"}
        })
        
        # 并行执行质量分析和数据分析
        graph.add_node("quality_analysis", analyze_data_quality, "tool", {
            "description": "分析数据质量",
            "args": {"cleaning_results_json": "${clean_data}"}
        })
        
        graph.add_node("data_analysis", perform_analysis, "tool", {
            "description": "执行数据分析",
            "args": {"quality_report_json": "${quality_analysis}"}
        })
        
        # 生成报告
        graph.add_node("generate_report", generate_report, "tool", {
            "description": "生成综合报告",
            "args": {
                "analysis_json": "${data_analysis}",
                "quality_json": "${quality_analysis}",
                "workflow_id": "${workflow_execution_id}"
            }
        })
        
        # 发送通知
        graph.add_node("send_notification", send_notification, "tool", {
            "description": "发送完成通知",
            "args": {"report_json": "${generate_report}"}
        })
        
        # 添加边（定义执行顺序）
        graph.add_edge("collect_sources", "validate_sources")
        graph.add_edge("validate_sources", "clean_data")
        graph.add_edge("clean_data", "quality_analysis")
        graph.add_edge("quality_analysis", "data_analysis")
        graph.add_edge("data_analysis", "generate_report")
        graph.add_edge("generate_report", "send_notification")
        
        return graph
    
    def create_conditional_workflow_graph(self) -> WorkflowGraph:
        """创建带条件路由的工作流图"""
        graph = WorkflowGraph()
        
        # 添加基础节点
        graph.add_node("collect_sources", collect_data_sources, "tool", {
            "description": "收集数据源"
        })
        
        graph.add_node("validate_sources", validate_data_sources, "tool", {
            "description": "验证数据源",
            "args": {"sources_json": "${collect_sources}"}
        })
        
        # 添加条件分支节点
        graph.add_node("clean_data_basic", clean_data, "tool", {
            "mode": "basic",
            "description": "基础数据清洗",
            "args": {"sources_json": "${validate_sources}"}
        })
        
        graph.add_node("clean_data_advanced", clean_data, "tool", {
            "mode": "advanced", 
            "description": "高级数据清洗",
            "args": {"sources_json": "${validate_sources}"}
        })
        
        # 添加分析节点
        graph.add_node("quality_analysis", analyze_data_quality, "tool", {
            "description": "分析数据质量",
            "args": {"cleaning_results_json": "${clean_data_basic}${clean_data_advanced}"}
        })
        
        graph.add_node("generate_report", generate_report, "tool", {
            "description": "生成报告",
            "args": {
                "analysis_json": "{}",  # 简化的分析结果
                "quality_json": "${quality_analysis}",
                "workflow_id": "${workflow_execution_id}"
            }
        })
        
        # 添加边和条件
        graph.add_edge("collect_sources", "validate_sources")
        
        # 条件路由：根据数据源数量选择清洗策略
        graph.add_edge(
            "validate_sources", 
            "clean_data_basic",
            lambda result: self._count_data_sources(result) <= 2
        )
        
        graph.add_edge(
            "validate_sources",
            "clean_data_advanced", 
            lambda result: self._count_data_sources(result) > 2
        )
        
        # 汇聚到质量分析
        graph.add_edge("clean_data_basic", "quality_analysis")
        graph.add_edge("clean_data_advanced", "quality_analysis")
        graph.add_edge("quality_analysis", "generate_report")
        
        return graph
    
    def _count_data_sources(self, result: str) -> int:
        """计算数据源数量"""
        try:
            data = json.loads(result)
            if isinstance(data, list):
                return len(data)
            elif isinstance(data, dict) and "sources" in data:
                return len(data["sources"])
            else:
                return 1
        except:
            return 1
    
    async def run_basic_workflow(self) -> Dict[str, Any]:
        """运行基础工作流"""
        print("🚀 开始执行基础数据处理工作流")
        print("=" * 60)
        
        # 创建工作流图
        graph = self.create_workflow_graph()
        
        # 执行工作流
        start_time = datetime.now()
        context = await self.engine.run(
            graph, 
            {"workflow_execution_id": f"basic_{int(start_time.timestamp())}"}
        )
        end_time = datetime.now()
        
        # 显示执行结果
        print(f"\n📊 工作流执行结果:")
        print(f"  状态: {'✅ 成功' if context.status == WorkflowStatus.COMPLETED else '❌ 失败'}")
        print(f"  执行时间: {(end_time - start_time).total_seconds():.2f} 秒")
        print(f"  执行的节点数: {len(context.node_results)}")
        
        # 显示每个节点的结果
        print(f"\n📋 节点执行详情:")
        for node_id, result in context.node_results.items():
            print(f"  • {node_id}: {str(result)[:100]}...")
        
        return {
            "status": context.status.value,
            "execution_time": (end_time - start_time).total_seconds(),
            "node_results": context.node_results,
            "event_count": len(context.event_log.events)
        }
    
    async def run_conditional_workflow(self) -> Dict[str, Any]:
        """运行条件工作流"""
        print("🔀 开始执行条件路由工作流")
        print("=" * 60)
        
        # 创建条件工作流图
        graph = self.create_conditional_workflow_graph()
        
        # 执行工作流
        start_time = datetime.now()
        context = await self.engine.run(
            graph,
            {"workflow_execution_id": f"conditional_{int(start_time.timestamp())}"}
        )
        end_time = datetime.now()
        
        # 显示执行结果
        print(f"\n📊 条件工作流执行结果:")
        print(f"  状态: {'✅ 成功' if context.status == WorkflowStatus.COMPLETED else '❌ 失败'}")
        print(f"  执行时间: {(end_time - start_time).total_seconds():.2f} 秒")
        print(f"  执行的节点数: {len(context.node_results)}")
        
        # 分析执行路径
        executed_nodes = list(context.node_results.keys())
        if "clean_data_basic" in executed_nodes:
            print("  🛤️  执行路径: 基础清洗路径")
        elif "clean_data_advanced" in executed_nodes:
            print("  🛤️  执行路径: 高级清洗路径")
        
        return {
            "status": context.status.value,
            "execution_time": (end_time - start_time).total_seconds(),
            "executed_path": "basic" if "clean_data_basic" in executed_nodes else "advanced",
            "node_results": context.node_results
        }
    
    def demonstrate_task_validation(self) -> Dict[str, Any]:
        """演示任务验证功能"""
        print("🔍 演示任务输出解析和验证")
        print("=" * 60)
        
        # 测试用例1：正确的JSON输出
        print("\n📝 测试用例1：正确的JSON输出")
        correct_response = '''
        {
            "completeness": 95.0,
            "accuracy": 92.5,
            "consistency": 88.0,
            "issues": ["数据缺失", "格式不一致"],
            "recommendations": ["增加验证", "统一格式"]
        }
        '''
        
        parse_result = self.parser.parse(correct_response, DataQuality)
        print(f"  解析结果: {'✅ 成功' if parse_result.success else '❌ 失败'}")
        if parse_result.success:
            validation_result = self.validator.validate(parse_result.data)
            print(f"  验证结果: {'✅ 通过' if validation_result.valid else '❌ 失败'}")
        
        # 测试用例2：格式错误的输出（需要修复）
        print("\n📝 测试用例2：格式错误的输出（单引号）")
        malformed_response = '''
        {
            'completeness': 95.0,
            'accuracy': 92.5,
            'consistency': 88.0,
            'issues': ['数据缺失', '格式不一致'],
            'recommendations': ['增加验证', '统一格式']
        }
        '''
        
        parse_result = self.parser.parse(malformed_response, DataQuality)
        print(f"  初始解析: {'✅ 成功' if parse_result.success else '❌ 失败'}")
        
        if not parse_result.success:
            print("  🔧 尝试自动修复...")
            repaired_result = self.repair_loop.repair(
                malformed_response, parse_result, None, DataQuality
            )
            print(f"  修复结果: {'✅ 成功' if repaired_result.success else '❌ 失败'}")
        
        # 测试用例3：从Markdown提取JSON
        print("\n📝 测试用例3：从Markdown代码块提取JSON")
        markdown_response = '''
        根据数据分析，我得出以下质量评估结果：
        
        ```json
        {
            "completeness": 98.5,
            "accuracy": 94.0,
            "consistency": 91.5,
            "issues": ["少量重复数据"],
            "recommendations": ["去重处理"]
        }
        ```
        
        这是详细的质量分析报告。
        '''
        
        parse_result = self.parser.parse(markdown_response, DataQuality)
        print(f"  解析结果: {'✅ 成功' if parse_result.success else '❌ 失败'}")
        print(f"  置信度: {parse_result.confidence:.2f}")
        
        return {
            "test_cases": 3,
            "successful_parses": sum([
                1 if self.parser.parse(resp, DataQuality).success else 0
                for resp in [correct_response, malformed_response, markdown_response]
            ])
        }
    
    def start_trigger_service(self):
        """启动触发器服务"""
        print("⏰ 启动触发器服务")
        self.trigger_service.start()
        print("  ✅ 定时触发器已启动（每小时执行）")
        print("  ✅ 事件触发器已启动（监听数据更新事件）")
    
    def stop_trigger_service(self):
        """停止触发器服务"""
        print("⏹️  停止触发器服务")
        self.trigger_service.stop()


async def main():
    """主函数"""
    print("🎯 AgenticX M7 & M8 综合演示")
    print("数据处理工作流 - 展示任务验证和工作流编排")
    print("=" * 80)
    
    # 创建工作流实例
    workflow = DataProcessingWorkflow()
    
    try:
        # 1. 演示任务验证功能
        print("\n" + "="*80)
        print("🔍 第一部分：任务输出解析和验证演示")
        print("="*80)
        
        validation_results = workflow.demonstrate_task_validation()
        print(f"\n📊 验证演示总结:")
        print(f"  测试用例数: {validation_results['test_cases']}")
        print(f"  成功解析数: {validation_results['successful_parses']}")
        
        # 2. 演示基础工作流
        print("\n" + "="*80)
        print("🚀 第二部分：基础工作流编排演示")
        print("="*80)
        
        basic_results = await workflow.run_basic_workflow()
        print(f"\n📈 基础工作流统计:")
        print(f"  执行状态: {basic_results['status']}")
        print(f"  执行时间: {basic_results['execution_time']:.2f} 秒")
        print(f"  事件数量: {basic_results['event_count']}")
        
        # 3. 演示条件工作流
        print("\n" + "="*80)
        print("🔀 第三部分：条件路由工作流演示")
        print("="*80)
        
        conditional_results = await workflow.run_conditional_workflow()
        print(f"\n📈 条件工作流统计:")
        print(f"  执行状态: {conditional_results['status']}")
        print(f"  执行路径: {conditional_results['executed_path']}")
        print(f"  执行时间: {conditional_results['execution_time']:.2f} 秒")
        
        # 4. 演示触发器服务
        print("\n" + "="*80)
        print("⏰ 第四部分：触发器服务演示")
        print("="*80)
        
        workflow.start_trigger_service()
        
        # 模拟运行一段时间
        print("  ⏳ 模拟运行 3 秒...")
        await asyncio.sleep(3)
        
        workflow.stop_trigger_service()
        
        # 5. 显示生成的文件
        print("\n" + "="*80)
        print("📄 生成的文件")
        print("="*80)
        
        import glob
        report_files = glob.glob("data_processing_report_*.json")
        if report_files:
            for file in report_files:
                print(f"  ✅ {file}")
                # 显示文件内容摘要
                try:
                    with open(file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        print(f"     工作流ID: {data.get('workflow_id', 'N/A')}")
                        print(f"     状态: {data.get('status', 'N/A')}")
                        print(f"     执行时间: {data.get('execution_time', 'N/A')} 秒")
                except Exception as e:
                    print(f"     读取文件失败: {e}")
        else:
            print("  ⚠️  未找到生成的报告文件")
        
        print("\n🎉 演示完成！")
        print("\n📋 演示总结:")
        print("  ✅ M7 任务验证：支持JSON解析、格式修复、Schema验证")
        print("  ✅ M8 工作流编排：支持顺序执行、并行处理、条件路由")
        print("  ✅ 触发器服务：支持定时触发和事件驱动")
        print("  ✅ 错误处理：自动修复和优雅降级")
        print("  ✅ 可观测性：完整的事件日志和执行统计")
        
    except Exception as e:
        print(f"\n❌ 演示过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # 确保清理资源
        workflow.stop_trigger_service()


if __name__ == "__main__":
    asyncio.run(main()) 