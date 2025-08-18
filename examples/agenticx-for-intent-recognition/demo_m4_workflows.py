"""M4模块工作流演示脚本
展示意图处理工作流的使用方法
"""

import asyncio
import time
from typing import Dict, Any

from agenticx.llms.base import BaseLLMProvider
from agenticx.core.task import Task
from agenticx.tools.base import BaseTool

from agents.intent_agent import IntentRecognitionAgent
from agents.general_agent import GeneralConversationAgent
from agents.search_agent import SearchIntentAgent
from agents.function_agent import FunctionCallAgent
from tools.hybrid_extractor import HybridExtractor
from tools.rule_matching_tool import RuleMatchingTool

from workflows import (
    IntentRecognitionWorkflow,
    GeneralIntentWorkflow,
    SearchIntentWorkflow,
    FunctionIntentWorkflow,
    ConversationContext,
    SearchQuery,
    FunctionCall
)


class MockLLMProvider:
    """模拟LLM提供者用于演示"""
    
    def __init__(self):
        self.name = "MockLLM"
    
    async def generate(self, prompt: str, **kwargs) -> str:
        """模拟生成响应"""
        await asyncio.sleep(0.1)  # 模拟网络延迟
        
        # 根据提示内容返回不同的模拟响应
        if "意图" in prompt or "intent" in prompt.lower():
            if "搜索" in prompt or "查找" in prompt:
                return "001_information_search"
            elif "文件" in prompt or "邮件" in prompt or "计算" in prompt:
                return "002_function_call"
            else:
                return "000_general_conversation"
        elif "情感" in prompt or "sentiment" in prompt.lower():
            if "好" in prompt or "棒" in prompt or "开心" in prompt:
                return "positive"
            elif "糟" in prompt or "坏" in prompt or "难过" in prompt:
                return "negative"
            else:
                return "neutral"
        elif "实体" in prompt or "entity" in prompt.lower():
            return '{"PERSON": ["张三"], "LOCATION": ["北京"]}'
        else:
            return "这是一个模拟的LLM响应"


class MockTool(BaseTool):
    """模拟工具用于演示"""
    
    def __init__(self, name: str, tool_type: str = "general"):
        self.name = name
        self.tool_type = tool_type
        self.description = f"模拟工具: {name}"
    
    def execute(self, **kwargs) -> Dict[str, Any]:
        """执行工具"""
        return {
            "status": "success",
            "result": f"工具 {self.name} 执行成功",
            "tool_type": self.tool_type,
            "parameters": kwargs
        }


def create_demo_components():
    """创建演示组件"""
    # 创建模拟LLM提供者
    llm_provider = MockLLMProvider()
    
    # 创建代理
    intent_agent = IntentRecognitionAgent()
    general_agent = GeneralConversationAgent()
    search_agent = SearchIntentAgent()
    function_agent = FunctionCallAgent()
    
    # 创建工具
    entity_extractor = HybridExtractor(llm_provider=llm_provider)
    rule_tool = RuleMatchingTool()
    
    # 创建可用工具列表
    available_tools = [
        MockTool("FileManager", "file_management"),
        MockTool("EmailSender", "communication"),
        MockTool("Calculator", "calculation"),
        MockTool("WebSearch", "search")
    ]
    
    return {
        "llm_provider": llm_provider,
        "intent_agent": intent_agent,
        "general_agent": general_agent,
        "search_agent": search_agent,
        "function_agent": function_agent,
        "entity_extractor": entity_extractor,
        "rule_tool": rule_tool,
        "available_tools": available_tools
    }


def demo_intent_recognition_workflow():
    """演示意图识别主工作流"""
    print("\n=== 意图识别主工作流演示 ===")
    
    components = create_demo_components()
    
    # 创建工作流
    workflow = IntentRecognitionWorkflow(
        llm_provider=components["llm_provider"],
        intent_agent=components["intent_agent"],
        entity_extractor=components["entity_extractor"],
        rule_tool=components["rule_tool"]
    )
    
    # 测试用例
    test_cases = [
        "你好，今天天气怎么样？",
        "帮我搜索Python编程教程",
        "请创建一个名为report.txt的文件",
        "发送邮件给zhang@example.com"
    ]
    
    for i, text in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {text}")
        
        start_time = time.time()
        result = workflow.execute(text)
        end_time = time.time()
        
        print(f"识别意图: {result.intent}")
        print(f"置信度: {result.confidence:.2f}")
        print(f"处理时间: {end_time - start_time:.3f}秒")
        print(f"实体数量: {len(result.entities)}")
        print(f"规则匹配: {len(result.rule_matches)}")
        
        if result.entities:
            print("抽取实体:")
            for entity_type, entities in result.entities.items():
                print(f"  {entity_type}: {[e['text'] for e in entities]}")
    
    # 显示工作流信息
    print("\n工作流信息:")
    info = workflow.get_workflow_info()
    print(f"名称: {info['name']}")
    print(f"节点数: {len(info['nodes'])}")
    print(f"边数: {info['edges_count']}")
    print(f"节点列表: {', '.join(info['nodes'])}")


def demo_general_intent_workflow():
    """演示通用意图处理工作流"""
    print("\n=== 通用意图处理工作流演示 ===")
    
    components = create_demo_components()
    
    # 创建工作流
    workflow = GeneralIntentWorkflow(
        llm_provider=components["llm_provider"],
        general_agent=components["general_agent"]
    )
    
    # 测试用例
    test_cases = [
        "今天真是太好了！",
        "我感觉很沮丧",
        "你能帮我解决这个问题吗？",
        "谢谢你的帮助"
    ]
    
    # 创建对话上下文
    context = ConversationContext(
        history=[
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "您好！有什么可以帮助您的吗？"}
        ],
        current_turn=1,
        session_id="demo_session"
    )
    
    for i, text in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {text}")
        
        result = workflow.execute(text, context)
        
        print(f"意图类型: {result.intent}")
        print(f"情感分析: {result.metadata.get('sentiment', 'unknown')}")
        print(f"对话状态: {result.metadata.get('dialogue_state', 'unknown')}")
        print(f"上下文理解: {result.metadata.get('context_understanding', 'unknown')}")
        
        # 更新对话历史
        context.history.append({"role": "user", "content": text})
        context.history.append({"role": "assistant", "content": "理解您的意思"})
        context.current_turn += 1


def demo_search_intent_workflow():
    """演示搜索意图处理工作流"""
    print("\n=== 搜索意图处理工作流演示 ===")
    
    components = create_demo_components()
    
    # 创建工作流
    workflow = SearchIntentWorkflow(
        llm_provider=components["llm_provider"],
        search_agent=components["search_agent"],
        entity_extractor=components["entity_extractor"]
    )
    
    # 测试用例
    test_cases = [
        "什么是机器学习？",
        "如何学习Python编程？",
        "推荐一些好用的开发工具",
        "搜索最新的AI技术趋势"
    ]
    
    for i, text in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {text}")
        
        result = workflow.execute(text)
        
        print(f"搜索意图: {result.intent}")
        print(f"查询类型: {result.metadata.get('query_type', 'unknown')}")
        print(f"意图子类型: {result.metadata.get('intent_subtype', 'unknown')}")
        print(f"搜索查询: {result.metadata.get('search_query', 'unknown')}")
        
        if "SEARCH_TERM" in result.entities:
            search_terms = [e['text'] for e in result.entities["SEARCH_TERM"]]
            print(f"搜索关键词: {', '.join(search_terms)}")


def demo_function_intent_workflow():
    """演示工具调用意图处理工作流"""
    print("\n=== 工具调用意图处理工作流演示 ===")
    
    components = create_demo_components()
    
    # 创建工作流
    workflow = FunctionIntentWorkflow(
        llm_provider=components["llm_provider"],
        function_agent=components["function_agent"],
        entity_extractor=components["entity_extractor"],
        available_tools=components["available_tools"]
    )
    
    # 测试用例
    test_cases = [
        "请创建一个名为report.txt的文件",
        "发送邮件给zhang@example.com，主题是会议通知",
        "计算 15 * 23 + 45",
        "打开文件C:\\Users\\test\\document.pdf"
    ]
    
    for i, text in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {text}")
        
        result = workflow.execute(text)
        
        print(f"工具调用意图: {result.intent}")
        print(f"工具类型: {result.metadata.get('tool_type', 'unknown')}")
        print(f"参数完整性: {result.metadata.get('parameter_completeness', 'unknown')}")
        
        if "function_call" in result.metadata:
            func_call = result.metadata["function_call"]
            print(f"调用工具: {func_call.get('function_name', 'unknown')}")
            print(f"验证状态: {func_call.get('validation_status', 'unknown')}")
        
        if "FUNCTION_PARAMETERS" in result.entities:
            params = result.entities["FUNCTION_PARAMETERS"]
            print(f"抽取参数: {len(params)} 个")


def demo_workflow_comparison():
    """演示工作流性能比较"""
    print("\n=== 工作流性能比较 ===")
    
    components = create_demo_components()
    
    # 创建所有工作流
    workflows = {
        "意图识别": IntentRecognitionWorkflow(
            llm_provider=components["llm_provider"],
            intent_agent=components["intent_agent"],
            entity_extractor=components["entity_extractor"],
            rule_tool=components["rule_tool"]
        ),
        "通用意图": GeneralIntentWorkflow(
            llm_provider=components["llm_provider"],
            general_agent=components["general_agent"]
        ),
        "搜索意图": SearchIntentWorkflow(
            llm_provider=components["llm_provider"],
            search_agent=components["search_agent"],
            entity_extractor=components["entity_extractor"]
        ),
        "工具调用": FunctionIntentWorkflow(
            llm_provider=components["llm_provider"],
            function_agent=components["function_agent"],
            entity_extractor=components["entity_extractor"],
            available_tools=components["available_tools"]
        )
    }
    
    test_text = "帮我搜索Python编程教程"
    
    print(f"测试文本: {test_text}")
    print("\n性能对比:")
    
    for name, workflow in workflows.items():
        start_time = time.time()
        
        try:
            if name == "通用意图":
                result = workflow.execute(test_text, ConversationContext())
            else:
                result = workflow.execute(test_text)
            
            end_time = time.time()
            processing_time = end_time - start_time
            
            print(f"{name:8s}: {processing_time:.3f}秒 | 意图: {result.intent} | 置信度: {result.confidence:.2f}")
            
        except Exception as e:
            print(f"{name:8s}: 执行失败 - {str(e)}")


def main():
    """主演示函数"""
    print("AgenticX M4模块 - 意图处理工作流演示")
    print("=" * 50)
    
    try:
        # 运行各个工作流演示
        demo_intent_recognition_workflow()
        demo_general_intent_workflow()
        demo_search_intent_workflow()
        demo_function_intent_workflow()
        demo_workflow_comparison()
        
        print("\n=== 演示完成 ===")
        print("M4模块的所有工作流都已成功演示！")
        
    except Exception as e:
        print(f"\n演示过程中出现错误: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()