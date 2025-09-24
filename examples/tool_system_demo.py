#!/usr/bin/env python3
"""
工具系统演示示例

展示如何使用新的工具系统进行工具注册、执行和管理。
"""

import asyncio
import json
from typing import Dict, Any, Optional
from datetime import datetime

# 导入工具系统组件
from agenticx.core import (
    # 工具系统核心
    ToolSystem, ToolSystemConfig,
    BaseTool, ToolMetadata, ToolParameter, ToolResult, ToolContext,
    ToolStatus, ParameterType, ToolCategory,
    
    # 注册表和工厂
    ToolRegistry, ToolFactory,
    
    # 执行引擎
    ToolExecutor, ExecutionConfig,
    
    # 安全管理
    SecurityManager, SecurityLevel, Permission,
    
    # 协议适配器
    ProtocolType, OpenAIAdapter, MCPAdapter,
    
    # 市场
    ToolMarketplace, ToolManifest,
    
    # 便捷函数
    create_tool_system, get_tool_system
)


# 示例工具实现
class CalculatorTool(BaseTool):
    """计算器工具"""
    
    def __init__(self):
        super().__init__(self.get_metadata())
    
    @classmethod
    def get_metadata(cls) -> ToolMetadata:
        """获取工具元数据"""
        return ToolMetadata(
            name="calculator",
            description="执行基本数学运算的计算器工具",
            category=ToolCategory.UTILITY,
            tags=["math", "calculator", "utilities"],
            version="1.0.0",
            author="AgenticX",
            timeout=5.0
        )
    
    def _setup_parameters(self) -> None:
        """设置工具参数"""
        # 参数已经在metadata中定义，这里不需要额外设置
        pass
    
    def execute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """同步执行计算"""
        return asyncio.run(self.aexecute(parameters, context))
    
    async def aexecute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """异步执行计算"""
        operation = parameters.get("operation")
        a = parameters.get("a", 0)
        b = parameters.get("b", 0)
        
        try:
            if operation == "add":
                result = a + b
            elif operation == "subtract":
                result = a - b
            elif operation == "multiply":
                result = a * b
            elif operation == "divide":
                if b == 0:
                    return ToolResult(
                        success=False,
                        data=None,
                        error="除数不能为零",
                        metadata={"operation": operation, "inputs": [a, b]}
                    )
                result = a / b
            else:
                return ToolResult(
                    success=False,
                    data=None,
                    error=f"不支持的运算类型: {operation}",
                    metadata={"operation": operation}
                )
            
            return ToolResult(
                success=True,
                data={"result": result},
                metadata={
                    "operation": operation,
                    "inputs": [a, b],
                    "timestamp": datetime.now().isoformat()
                }
            )
        except Exception as e:
            return ToolResult(
                success=False,
                data=None,
                error=str(e),
                metadata={"operation": operation, "inputs": [a, b]}
            )


class WeatherTool(BaseTool):
    """天气查询工具（模拟）"""
    
    def __init__(self):
        super().__init__(self.get_metadata())
    
    @classmethod
    def get_metadata(cls) -> ToolMetadata:
        """获取工具元数据"""
        return ToolMetadata(
            name="weather",
            description="查询指定城市的天气信息",
            category=ToolCategory.DATA_ACCESS,
            tags=["weather", "data", "api"],
            version="1.0.0",
            author="AgenticX",
            timeout=10.0
        )
    
    def _setup_parameters(self) -> None:
        """设置工具参数"""
        # 参数已经在metadata中定义，这里不需要额外设置
        pass
    
    def execute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """模拟天气查询"""
        return asyncio.run(self.aexecute(parameters, context))
    
    async def aexecute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """模拟天气查询"""
        city = parameters.get("city", "Unknown")
        unit = parameters.get("unit", "celsius")
        
        # 模拟天气数据
        import random
        temp = random.randint(-10, 35)
        if unit == "fahrenheit":
            temp = temp * 9/5 + 32
        
        conditions = ["晴朗", "多云", "阴天", "小雨", "大雨", "雪"]
        condition = random.choice(conditions)
        
        return ToolResult(
            success=True,
            data={
                "city": city,
                "temperature": temp,
                "unit": unit,
                "condition": condition,
                "humidity": random.randint(30, 90),
                "wind_speed": random.randint(0, 20)
            },
            metadata={
                "city": city,
                "unit": unit,
                "timestamp": datetime.now().isoformat()
            }
        )


async def demo_basic_usage():
    """演示基本用法"""
    print("=== 工具系统基本用法演示 ===\n")
    
    # 创建工具系统
    config = ToolSystemConfig(
        enable_security=True,
        enable_marketplace=False,  # 演示时不启用市场
        enable_protocol_adapters=True,
        enable_sandbox=True,
        max_concurrent_executions=5,
        execution_timeout=30.0,
        security_level="medium"
    )
    
    tool_system = create_tool_system(config)
    
    # 创建工具实例
    calculator = CalculatorTool()
    weather = WeatherTool()
    
    # 注册工具
    print("1. 注册工具...")
    tool_system.register_tool(CalculatorTool)
    tool_system.register_tool(WeatherTool)
    print(f"   已注册 {len(tool_system.list_tools())} 个工具")
    
    # 列出所有工具
    print("\n2. 可用工具列表:")
    for tool_name in tool_system.list_tools():
        tool_info = tool_system.get_tool_info(tool_name)
        if tool_info:
            print(f"   - {tool_info['name']}: {tool_info['description']}")
    
    # 执行工具调用
    print("\n3. 执行工具调用:")
    
    # 计算器工具
    print("   计算器工具:")
    result = await tool_system.execute_tool_async("calculator", {
        "operation": "add",
        "a": 10,
        "b": 5
    })
    print(f"     10 + 5 = {result.data['result'] if result.is_success() else result.error}")
    
    result = await tool_system.execute_tool_async("calculator", {
        "operation": "multiply",
        "a": 7,
        "b": 8
    })
    print(f"     7 × 8 = {result.data['result'] if result.is_success() else result.error}")
    
    # 天气工具
    print("\n   天气工具:")
    result = await tool_system.execute_tool_async("weather", {
        "city": "北京",
        "unit": "celsius"
    })
    if result.is_success():
        data = result.data
        print(f"     {data['city']} 天气:")
        print(f"     温度: {data['temperature']}°{data['unit'][0].upper()}")
        print(f"     天气: {data['condition']}")
        print(f"     湿度: {data['humidity']}%")
        print(f"     风速: {data['wind_speed']} km/h")
    else:
        print(f"     错误: {result.error}")
    
    # 搜索工具
    print("\n4. 搜索工具:")
    search_results = tool_system.search_tools("calculator")
    print(f"   搜索 'calculator' 找到 {len(search_results)} 个结果:")
    for result in search_results:
        print(f"     - {result['name']}: {result['description']} ({result['source']})")
    
    # 获取系统状态
    print("\n5. 系统状态:")
    status = tool_system.get_system_status()
    print(f"   注册表: {status['registry']['total_tools']} 个工具")
    print(f"   执行器: {status['executor']['total_executions']} 次执行")
    if 'security' in status:
        print(f"   安全: {status['security']['level']} 级别")
    
    # 关闭系统
    print("\n6. 关闭系统...")
    tool_system.shutdown()
    print("   系统已关闭")


async def demo_advanced_features():
    """演示高级功能"""
    print("\n\n=== 工具系统高级功能演示 ===\n")
    
    tool_system = get_tool_system()
    
    # 批量执行
    print("1. 批量执行工具:")
    tasks = [
        ("calculator", {"operation": "add", "a": i, "b": i*2})
        for i in range(1, 6)
    ]
    
    results = await asyncio.gather(*[
        tool_system.execute_tool_async(name, params)
        for name, params in tasks
    ])
    
    for i, (tool_name, params), result in zip(range(len(tasks)), tasks, results):
        if result.is_success():
            print(f"   任务 {i+1}: {params['a']} + {params['b']} = {result.data['result']}")
        else:
            print(f"   任务 {i+1}: 失败 - {result.error}")
    
    # 错误处理演示
    print("\n2. 错误处理演示:")
    
    # 除零错误
    result = await tool_system.execute_tool_async("calculator", {
        "operation": "divide",
        "a": 10,
        "b": 0
    })
    print(f"   除零错误: {result.error}")
    
    # 不支持的运算
    result = await tool_system.execute_tool_async("calculator", {
        "operation": "power",
        "a": 2,
        "b": 3
    })
    print(f"   不支持运算: {result.error}")
    
    # 不存在的工具
    try:
        result = await tool_system.execute_tool_async("non_existent_tool", {})
    except ValueError as e:
        print(f"   工具不存在: {e}")
    
    # 获取工具详细信息
    print("\n3. 工具详细信息:")
    info = tool_system.get_tool_info("calculator")
    if info:
        print(f"   名称: {info['name']}")
        print(f"   描述: {info['description']}")
        print(f"   类别: {info['category']}")
        if 'tags' in info:
            print(f"   标签: {', '.join(info['tags'])}")
        print(f"   参数:")
        for param_name, param in info['parameters'].items():
            print(f"     - {param_name} ({param['type']}): {param['description']}")
            if param.get('required'):
                print(f"       必需参数")
            if param.get('default') is not None:
                print(f"       默认值: {param['default']}")
            if param.get('enum'):
                print(f"       可选值: {', '.join(param['enum'])}")


def demo_from_function():
    """演示从函数创建工具"""
    print("\n\n=== 从函数创建工具演示 ===\n")
    
    # 简单的函数工具
    def text_analyzer(text: str, analysis_type: str = "word_count") -> Dict[str, Any]:
        """文本分析工具"""
        if analysis_type == "word_count":
            return {"word_count": len(text.split())}
        elif analysis_type == "char_count":
            return {"char_count": len(text)}
        elif analysis_type == "line_count":
            return {"line_count": len(text.split('\n'))}
        else:
            return {"error": f"不支持的analysis_type: {analysis_type}"}
    
    # 创建工具系统
    tool_system = get_tool_system()
    
    # 这里可以添加从函数创建工具的逻辑
    # 由于当前实现需要更多支持代码，这里仅作概念演示
    print("从函数创建工具的功能需要额外的工厂方法支持")
    print("可以通过 ToolFactory.create_tool_from_function() 实现")


async def main():
    """主函数"""
    try:
        # 基本用法演示
        await demo_basic_usage()
        
        # 高级功能演示
        await demo_advanced_features()
        
        # 函数工具演示
        demo_from_function()
        
    except KeyboardInterrupt:
        print("\n演示被用户中断")
    except Exception as e:
        print(f"演示出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # 确保关闭系统
        from agenticx.core import shutdown_tool_system
        shutdown_tool_system()
        print("\n工具系统演示完成！")


if __name__ == "__main__":
    # 运行演示
    asyncio.run(main())