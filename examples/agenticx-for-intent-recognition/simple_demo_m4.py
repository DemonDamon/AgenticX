"""M4模块简化演示脚本
展示意图处理工作流的核心功能
"""

import time
from typing import Dict, Any, List

# 模拟导入，避免复杂依赖
class MockAgent:
    """模拟Agent类"""
    def __init__(self, name: str):
        self.name = name
    
    def execute(self, task) -> Dict[str, Any]:
        return {"output": f"{self.name}处理结果", "confidence": 0.8}

class MockExtractor:
    """模拟实体抽取器"""
    def extract(self, text: str) -> Dict[str, Any]:
        entities = {}
        if "Python" in text:
            entities["TECH"] = [{"text": "Python", "confidence": 0.9, "start": 0, "end": 6}]
        if "张三" in text:
            entities["PERSON"] = [{"text": "张三", "confidence": 0.9, "start": 0, "end": 2}]
        if "文件" in text:
            entities["FILE"] = [{"text": "文件", "confidence": 0.8, "start": 0, "end": 2}]
        return {
            "entities": entities,
            "confidence": 0.8,
            "extraction_method": "mock"
        }

class MockRuleTool:
    """模拟规则匹配工具"""
    def execute(self, text: str) -> Dict[str, Any]:
        rules = []
        if "搜索" in text or "查找" in text:
            rules.append({"rule_name": "search_rule", "confidence": 0.7})
        if "文件" in text or "创建" in text:
            rules.append({"rule_name": "file_rule", "confidence": 0.8})
        return {"data": rules}

# 导入工作流相关的数据模型
try:
    from workflows import (
        PipelineResult,
        ConversationContext,
        SearchQuery,
        FunctionCall
    )
except ImportError:
    # 如果导入失败，定义简化版本
    class PipelineResult:
        def __init__(self, intent: str, entities: Dict = None, confidence: float = 0.0, 
                     rule_matches: List = None, processing_time: float = 0.0, 
                     total_processing_time: float = 0.0, metadata: Dict = None):
            self.intent = intent
            self.entities = entities or {}
            self.confidence = confidence
            self.rule_matches = rule_matches or []
            self.processing_time = processing_time
            self.total_processing_time = total_processing_time
            self.metadata = metadata or {}
    
    class ConversationContext:
        def __init__(self, history: List = None, current_turn: int = 0, session_id: str = ""):
            self.history = history or []
            self.current_turn = current_turn
            self.session_id = session_id
    
    class SearchQuery:
        def __init__(self, query: str, query_type: str = "", entities: List = None, 
                     intent_subtype: str = "", parameters: Dict = None):
            self.query = query
            self.query_type = query_type
            self.entities = entities or []
            self.intent_subtype = intent_subtype
            self.parameters = parameters or {}
    
    class FunctionCall:
        def __init__(self, function_name: str, function_type: str = "", 
                     parameters: Dict = None, confidence: float = 0.0, 
                     validation_status: str = ""):
            self.function_name = function_name
            self.function_type = function_type
            self.parameters = parameters or {}
            self.confidence = confidence
            self.validation_status = validation_status


class SimpleIntentWorkflow:
    """简化的意图识别工作流"""
    
    def __init__(self):
        self.intent_agent = MockAgent("意图识别Agent")
        self.entity_extractor = MockExtractor()
        self.rule_tool = MockRuleTool()
        self.name = "简化意图识别工作流"
    
    def execute(self, text: str) -> PipelineResult:
        """执行工作流"""
        start_time = time.time()
        
        # 1. 预处理
        processed_text = text.strip()
        if not processed_text:
            return PipelineResult(
                intent="error",
                metadata={"error": "输入文本为空"}
            )
        
        # 2. 意图识别
        intent_result = self.intent_agent.execute(processed_text)
        intent = self._classify_intent(processed_text)
        
        # 3. 实体抽取
        entity_result = self.entity_extractor.extract(processed_text)
        
        # 4. 规则匹配
        rule_result = self.rule_tool.execute(processed_text)
        
        # 5. 后处理
        confidence = self._calculate_confidence(intent, entity_result, rule_result)
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        return PipelineResult(
            intent=intent,
            entities=entity_result["entities"],
            confidence=confidence,
            rule_matches=rule_result["data"],
            processing_time=processing_time,
            total_processing_time=processing_time,
            metadata={
                "rules_count": len(rule_result["data"]),
                "strategies_used": ["intent_classification", "entity_extraction", "rule_matching"],
                "processing_steps": 5
            }
        )
    
    def _classify_intent(self, text: str) -> str:
        """分类意图"""
        text_lower = text.lower()
        
        # 搜索意图
        if any(keyword in text for keyword in ["搜索", "查找", "什么是", "如何", "推荐"]):
            return "001_information_search"
        
        # 工具调用意图
        if any(keyword in text for keyword in ["创建", "文件", "发送", "邮件", "计算", "打开"]):
            return "002_function_call"
        
        # 通用对话意图
        return "000_general_conversation"
    
    def _calculate_confidence(self, intent: str, entity_result: Dict, rule_result: Dict) -> float:
        """计算置信度"""
        base_confidence = 0.7
        
        # 实体抽取加分
        if entity_result["entities"]:
            base_confidence += 0.1
        
        # 规则匹配加分
        if rule_result["data"]:
            base_confidence += 0.1
        
        return min(base_confidence, 1.0)
    
    def get_workflow_info(self) -> Dict[str, Any]:
        """获取工作流信息"""
        return {
            "name": self.name,
            "description": "基于AgenticX的意图识别工作流",
            "nodes": ["预处理", "意图识别", "实体抽取", "规则匹配", "后处理"],
            "edges_count": 4
        }


class SimpleGeneralWorkflow:
    """简化的通用意图工作流"""
    
    def __init__(self):
        self.general_agent = MockAgent("通用对话Agent")
        self.name = "简化通用意图工作流"
    
    def execute(self, text: str, context: ConversationContext = None) -> PipelineResult:
        """执行通用意图处理"""
        start_time = time.time()
        
        # 情感分析
        sentiment = self._analyze_sentiment(text)
        
        # 对话状态分析
        dialogue_state = self._analyze_dialogue_state(text, context)
        
        # 上下文理解
        context_understanding = self._understand_context(text, context)
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        return PipelineResult(
            intent="000_general_conversation",
            entities={},
            confidence=0.8,
            rule_matches=[],
            processing_time=processing_time,
            total_processing_time=processing_time,
            metadata={
                "sentiment": sentiment,
                "dialogue_state": dialogue_state,
                "context_understanding": context_understanding
            }
        )
    
    def _analyze_sentiment(self, text: str) -> str:
        """分析情感"""
        positive_words = ["好", "棒", "开心", "喜欢", "满意", "太好了"]
        negative_words = ["糟", "坏", "难过", "失望", "不满", "糟糕"]
        
        if any(word in text for word in positive_words):
            return "positive"
        elif any(word in text for word in negative_words):
            return "negative"
        else:
            return "neutral"
    
    def _analyze_dialogue_state(self, text: str, context: ConversationContext) -> str:
        """分析对话状态"""
        if not context or not context.history:
            return "new_conversation"
        
        if "谢谢" in text or "再见" in text:
            return "ending"
        elif "你好" in text or "开始" in text:
            return "greeting"
        else:
            return "continuing"
    
    def _understand_context(self, text: str, context: ConversationContext) -> str:
        """理解上下文"""
        if not context or len(context.history) == 0:
            return "no_context"
        elif len(context.history) < 3:
            return "limited_context"
        else:
            return "rich_context"


def demo_simple_workflows():
    """演示简化工作流"""
    print("AgenticX M4模块 - 意图处理工作流简化演示")
    print("=" * 50)
    
    # 创建工作流
    intent_workflow = SimpleIntentWorkflow()
    general_workflow = SimpleGeneralWorkflow()
    
    # 测试用例
    test_cases = [
        "你好，今天天气怎么样？",
        "帮我搜索Python编程教程",
        "请创建一个名为report.txt的文件",
        "今天真是太好了！",
        "我感觉很沮丧",
        "什么是机器学习？",
        "发送邮件给zhang@example.com"
    ]
    
    print("\n=== 意图识别工作流演示 ===")
    for i, text in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {text}")
        
        result = intent_workflow.execute(text)
        
        print(f"识别意图: {result.intent}")
        print(f"置信度: {result.confidence:.2f}")
        print(f"处理时间: {result.processing_time:.3f}秒")
        print(f"实体数量: {len(result.entities)}")
        print(f"规则匹配: {len(result.rule_matches)}")
        
        if result.entities:
            print("抽取实体:")
            for entity_type, entities in result.entities.items():
                print(f"  {entity_type}: {[e['text'] for e in entities]}")
    
    print("\n=== 通用意图工作流演示 ===")
    context = ConversationContext(
        history=[
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "您好！"}
        ],
        current_turn=1
    )
    
    general_cases = [
        "今天真是太好了！",
        "我感觉很沮丧",
        "谢谢你的帮助"
    ]
    
    for i, text in enumerate(general_cases, 1):
        print(f"\n通用测试 {i}: {text}")
        
        result = general_workflow.execute(text, context)
        
        print(f"意图类型: {result.intent}")
        print(f"情感分析: {result.metadata['sentiment']}")
        print(f"对话状态: {result.metadata['dialogue_state']}")
        print(f"上下文理解: {result.metadata['context_understanding']}")
    
    # 显示工作流信息
    print("\n=== 工作流信息 ===")
    intent_info = intent_workflow.get_workflow_info()
    print(f"工作流名称: {intent_info['name']}")
    print(f"节点数量: {len(intent_info['nodes'])}")
    print(f"节点列表: {', '.join(intent_info['nodes'])}")
    print(f"边数量: {intent_info['edges_count']}")
    
    print("\n=== 性能统计 ===")
    total_time = 0
    total_cases = len(test_cases) + len(general_cases)
    
    for text in test_cases:
        start = time.time()
        intent_workflow.execute(text)
        total_time += time.time() - start
    
    for text in general_cases:
        start = time.time()
        general_workflow.execute(text, context)
        total_time += time.time() - start
    
    avg_time = total_time / total_cases if total_time > 0 else 0.001
    print(f"总处理时间: {total_time:.3f}秒")
    print(f"平均处理时间: {avg_time:.3f}秒")
    throughput = 1/avg_time if avg_time > 0 else 1000
    print(f"处理吞吐量: {throughput:.1f} 请求/秒")
    
    print("\n=== 演示完成 ===")
    print("M4模块的意图处理工作流功能演示成功！")
    print("\n主要特性:")
    print("✓ 支持三大类意图识别（通用对话、搜索、工具调用）")
    print("✓ 实体抽取和规则匹配")
    print("✓ 情感分析和对话状态管理")
    print("✓ 流水线处理和性能监控")
    print("✓ 基于AgenticX Workflow架构")


if __name__ == "__main__":
    demo_simple_workflows()