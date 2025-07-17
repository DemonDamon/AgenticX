"""
AgenticX M8 & M9 简化演示：任务验证 + 工作流编排

这个演示展示了 M8 和 M9 的核心功能：
1. M8 任务输出解析和验证
2. M9 工作流编排和条件路由
3. 事件驱动的触发器

使用简单的计算任务来展示工作流的执行过程。
"""

import sys
import os
import json
import asyncio
from typing import Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    tool, WorkflowEngine, WorkflowGraph,
    TaskOutputParser, TaskResultValidator, OutputRepairLoop,
    RepairStrategy, WorkflowStatus
)


# 定义数据模型
class CalculationResult(BaseModel):
    """计算结果模型"""
    operation: str = Field(..., description="执行的操作")
    input_values: list = Field(..., description="输入值")
    result: float = Field(..., description="计算结果")
    timestamp: str = Field(..., description="计算时间")


class ProcessingSummary(BaseModel):
    """处理摘要模型"""
    total_operations: int = Field(..., description="总操作数")
    results: list = Field(..., description="所有结果")
    final_result: float = Field(..., description="最终结果")
    status: str = Field(..., description="处理状态")


# 定义工作流工具
@tool()
def add_numbers(a: float = 10.0, b: float = 5.0) -> str:
    """加法运算"""
    result = {
        "operation": "addition",
        "input_values": [a, b],
        "result": a + b,
        "timestamp": datetime.now().isoformat()
    }
    return json.dumps(result, ensure_ascii=False)


@tool()
def multiply_numbers(a: float = 2.0, b: float = 3.0) -> str:
    """乘法运算"""
    result = {
        "operation": "multiplication", 
        "input_values": [a, b],
        "result": a * b,
        "timestamp": datetime.now().isoformat()
    }
    return json.dumps(result, ensure_ascii=False)


@tool()
def process_calculation_result(calc_result: str) -> str:
    """处理计算结果"""
    try:
        data = json.loads(calc_result)
        processed = {
            "operation": data["operation"],
            "result": data["result"],
            "processed_at": datetime.now().isoformat(),
            "is_positive": data["result"] > 0,
            "magnitude": "large" if abs(data["result"]) > 10 else "small"
        }
        return json.dumps(processed, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"处理失败: {str(e)}"}, ensure_ascii=False)


@tool()
def combine_results(result1: str, result2: str) -> str:
    """合并多个结果"""
    try:
        data1 = json.loads(result1)
        data2 = json.loads(result2)
        
        combined = {
            "total_operations": 2,
            "results": [data1, data2],
            "final_result": data1.get("result", 0) + data2.get("result", 0),
            "status": "completed"
        }
        return json.dumps(combined, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"合并失败: {str(e)}"}, ensure_ascii=False)


@tool()
def generate_summary(combined_result: str) -> str:
    """生成摘要报告"""
    try:
        data = json.loads(combined_result)
        
        summary = {
            "workflow_summary": "数学计算工作流执行完成",
            "total_operations": data.get("total_operations", 0),
            "final_result": data.get("final_result", 0),
            "execution_time": datetime.now().isoformat(),
            "status": "success"
        }
        
        # 保存摘要到文件
        filename = f"calculation_summary_{int(datetime.now().timestamp())}.json"
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        
        summary["report_file"] = filename
        return json.dumps(summary, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"生成摘要失败: {str(e)}"}, ensure_ascii=False)


class SimpleWorkflowDemo:
    """简单工作流演示"""
    
    def __init__(self):
        self.engine = WorkflowEngine(max_concurrent_nodes=3)
        self.parser = TaskOutputParser(enable_fuzzy_parsing=True)
        self.validator = TaskResultValidator()
        self.repair_loop = OutputRepairLoop(
            max_repair_attempts=2,
            repair_strategy=RepairStrategy.SIMPLE
        )
    
    def create_sequential_workflow(self) -> WorkflowGraph:
        """创建顺序执行工作流"""
        graph = WorkflowGraph()
        
        # 添加节点
        graph.add_node("add_step", add_numbers, "tool", {
            "description": "执行加法运算",
            "args": {"a": 15.0, "b": 25.0}
        })
        
        graph.add_node("multiply_step", multiply_numbers, "tool", {
            "description": "执行乘法运算", 
            "args": {"a": 4.0, "b": 7.0}
        })
        
        graph.add_node("process_add", process_calculation_result, "tool", {
            "description": "处理加法结果",
            "args": {"calc_result": "${add_step}"}
        })
        
        graph.add_node("process_multiply", process_calculation_result, "tool", {
            "description": "处理乘法结果",
            "args": {"calc_result": "${multiply_step}"}
        })
        
        graph.add_node("combine_step", combine_results, "tool", {
            "description": "合并计算结果",
            "args": {
                "result1": "${process_add}",
                "result2": "${process_multiply}"
            }
        })
        
        graph.add_node("summary_step", generate_summary, "tool", {
            "description": "生成摘要报告",
            "args": {"combined_result": "${combine_step}"}
        })
        
        # 添加边（定义执行顺序）
        graph.add_edge("add_step", "process_add")
        graph.add_edge("multiply_step", "process_multiply")
        graph.add_edge("process_add", "combine_step")
        graph.add_edge("process_multiply", "combine_step")
        graph.add_edge("combine_step", "summary_step")
        
        return graph
    
    def create_conditional_workflow(self) -> WorkflowGraph:
        """创建条件路由工作流"""
        graph = WorkflowGraph()
        
        # 添加节点
        graph.add_node("initial_calc", add_numbers, "tool", {
            "description": "初始计算",
            "args": {"a": 8.0, "b": 12.0}
        })
        
        # 条件分支：根据结果选择不同的处理路径
        graph.add_node("small_number_processing", multiply_numbers, "tool", {
            "description": "小数处理",
            "args": {"a": 2.0, "b": 3.0}
        })
        
        graph.add_node("large_number_processing", multiply_numbers, "tool", {
            "description": "大数处理", 
            "args": {"a": 10.0, "b": 20.0}
        })
        
        graph.add_node("final_processing", process_calculation_result, "tool", {
            "description": "最终处理",
            "args": {"calc_result": "${small_number_processing}${large_number_processing}"}
        })
        
        # 添加条件边
        graph.add_edge("initial_calc", "small_number_processing", 
                      lambda result: self._get_result_value(result) < 15)
        
        graph.add_edge("initial_calc", "large_number_processing",
                      lambda result: self._get_result_value(result) >= 15)
        
        graph.add_edge("small_number_processing", "final_processing")
        graph.add_edge("large_number_processing", "final_processing")
        
        return graph
    
    def _get_result_value(self, result: str) -> float:
        """从结果中提取数值"""
        try:
            data = json.loads(result)
            return data.get("result", 0)
        except:
            return 0
    
    def demonstrate_task_validation(self):
        """演示任务验证功能"""
        print("🔍 M8 任务验证演示")
        print("=" * 50)
        
        # 测试正确的输出
        print("\n✅ 测试正确的JSON输出:")
        correct_output = '{"operation": "test", "result": 42.0, "timestamp": "2024-01-01T00:00:00"}'
        parse_result = self.parser.parse(correct_output, CalculationResult)
        print(f"  解析结果: {'成功' if parse_result.success else '失败'}")
        
        if parse_result.success:
            validation_result = self.validator.validate(parse_result.data)
            print(f"  验证结果: {'通过' if validation_result.valid else '失败'}")
        
        # 测试需要修复的输出
        print("\n🔧 测试需要修复的输出:")
        malformed_output = "{'operation': 'test', 'result': 42.0, 'timestamp': '2024-01-01T00:00:00'}"
        parse_result = self.parser.parse(malformed_output, CalculationResult)
        print(f"  初始解析: {'成功' if parse_result.success else '失败'}")
        
        if not parse_result.success:
            repaired_result = self.repair_loop.repair(
                malformed_output, parse_result, None, CalculationResult
            )
            print(f"  修复结果: {'成功' if repaired_result.success else '失败'}")
        
        print()
    
    async def run_sequential_workflow(self):
        """运行顺序工作流"""
        print("🚀 M9 顺序工作流演示")
        print("=" * 50)
        
        graph = self.create_sequential_workflow()
        
        start_time = datetime.now()
        context = await self.engine.run(
            graph,
            {"workflow_id": f"sequential_{int(start_time.timestamp())}"}
        )
        end_time = datetime.now()
        
        print(f"\n📊 执行结果:")
        print(f"  状态: {'✅ 成功' if context.status == WorkflowStatus.COMPLETED else '❌ 失败'}")
        print(f"  执行时间: {(end_time - start_time).total_seconds():.3f} 秒")
        print(f"  执行节点数: {len(context.node_results)}")
        
        # 显示关键结果
        if "add_step" in context.node_results:
            add_result = json.loads(context.node_results["add_step"])
            print(f"  加法结果: {add_result['result']}")
        
        if "multiply_step" in context.node_results:
            multiply_result = json.loads(context.node_results["multiply_step"])
            print(f"  乘法结果: {multiply_result['result']}")
        
        return context
    
    async def run_conditional_workflow(self):
        """运行条件工作流"""
        print("🔀 M9 条件路由工作流演示")
        print("=" * 50)
        
        graph = self.create_conditional_workflow()
        
        start_time = datetime.now()
        context = await self.engine.run(
            graph,
            {"workflow_id": f"conditional_{int(start_time.timestamp())}"}
        )
        end_time = datetime.now()
        
        print(f"\n📊 执行结果:")
        print(f"  状态: {'✅ 成功' if context.status == WorkflowStatus.COMPLETED else '❌ 失败'}")
        print(f"  执行时间: {(end_time - start_time).total_seconds():.3f} 秒")
        print(f"  执行节点数: {len(context.node_results)}")
        
        # 分析执行路径
        if "small_number_processing" in context.node_results:
            print("  🛤️  执行路径: 小数处理分支")
        elif "large_number_processing" in context.node_results:
            print("  🛤️  执行路径: 大数处理分支")
        
        return context


async def main():
    """主函数"""
    print("🎯 AgenticX M8 & M9 简化演示")
    print("任务验证 + 工作流编排核心功能展示")
    print("=" * 60)
    
    demo = SimpleWorkflowDemo()
    
    try:
        # 1. 演示任务验证
        demo.demonstrate_task_validation()
        
        # 2. 演示顺序工作流
        await demo.run_sequential_workflow()
        
        print("\n" + "=" * 60)
        
        # 3. 演示条件工作流
        await demo.run_conditional_workflow()
        
        # 4. 显示生成的文件
        print("\n📄 生成的文件:")
        import glob
        summary_files = glob.glob("calculation_summary_*.json")
        for file in summary_files:
            print(f"  ✅ {file}")
        
        print("\n🎉 演示完成！")
        print("\n📋 功能总结:")
        print("  ✅ M8 任务验证：JSON解析、格式修复、Schema验证")
        print("  ✅ M9 工作流编排：顺序执行、并行处理、条件路由")
        print("  ✅ 变量解析：节点间数据传递")
        print("  ✅ 错误处理：优雅降级和恢复")
        
    except Exception as e:
        print(f"\n❌ 演示过程中发生错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main()) 