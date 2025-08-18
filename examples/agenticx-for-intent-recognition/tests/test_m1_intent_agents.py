"""M1 意图识别Agent测试脚本

测试IntentRecognitionAgent、GeneralIntentAgent、SearchIntentAgent和FunctionIntentAgent的功能。
"""

import unittest
import asyncio
import sys
import os
from typing import Dict, Any
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import (
    IntentRecognitionAgent,
    GeneralIntentAgent,
    SearchIntentAgent,
    FunctionIntentAgent,
    IntentContext,
    AgentConfig,
    IntentType
)


class TestM1IntentAgents(unittest.TestCase):
    """M1 意图识别Agent测试类"""
    
    def setUp(self):
        """初始化测试环境"""
        self.config = AgentConfig(
            name="test_agent",
            llm_provider="kimi",  # 使用Kimi LLM提供者
            model=os.getenv('KIMI_MODEL_NAME', 'kimi-k2-0711-preview'),
            api_key=os.getenv("KIMI_API_KEY"),
            base_url=os.getenv("KIMI_API_BASE", "https://api.moonshot.cn/v1"),
            temperature=0.7,
            max_tokens=1000
        )
        
        # 测试用例
        self.test_cases = {
            "general": [
                "你好，今天天气怎么样？",
                "我感觉有点累",
                "谢谢你的帮助",
                "能陪我聊聊天吗？",
                "我心情不太好"
            ],
            "search": [
                "帮我搜索一下北京的天气",
                "查找关于人工智能的最新资料",
                "搜索附近的餐厅",
                "找一下明天的新闻",
                "查询股票价格"
            ],
            "function": [
                "打开记事本",
                "删除桌面上的文件",
                "发送邮件给张三",
                "设置闹钟",
                "关机",
                "复制文件到D盘"
            ]
        }
    
    def test_intent_recognition_agent(self):
        """测试基础意图识别Agent"""
        print("\n=== 测试 IntentRecognitionAgent ===")
        
        agent = IntentRecognitionAgent(self.config)
        
        # 测试不同类型的输入
        test_inputs = [
            "你好，今天天气怎么样？",  # 通用对话
            "帮我搜索一下北京的天气",  # 搜索意图
            "打开记事本"  # 工具调用
        ]
        
        for user_input in test_inputs:
            print(f"\n输入: {user_input}")
            
            context = IntentContext(
                user_input=user_input,
                session_id="test_session",
                user_id="test_user"
            )
            
            with self.subTest(user_input=user_input):
                try:
                    # 模拟意图识别（由于没有真实LLM，这里会使用回退逻辑）
                    result = agent.recognize_intent(context)
                    
                    print(f"意图类型: {result.intent_type.value}")
                    print(f"意图编码: {result.intent_code}")
                    print(f"置信度: {result.confidence}")
                    print(f"描述: {result.description}")
                    print(f"实体数量: {len(result.entities)}")
                    
                    # 验证结果
                    self.assertIn(result.intent_type, [IntentType.GENERAL, IntentType.SEARCH, IntentType.FUNCTION])
                    self.assertGreaterEqual(result.confidence, 0)
                    self.assertLessEqual(result.confidence, 1)
                    self.assertIsNotNone(result.intent_code)
                    
                    print("✓ 测试通过")
                    
                except Exception as e:
                    import traceback
                    self.fail(f"✗ 测试失败: {e}\n{traceback.format_exc()}")
    
    def test_general_intent_agent(self):
        """测试通用对话意图Agent"""
        print("\n=== 测试 GeneralIntentAgent ===")
        
        agent = GeneralIntentAgent(self.config)
        
        for user_input in self.test_cases["general"]:
            print(f"\n输入: {user_input}")
            
            context = IntentContext(
                user_input=user_input,
                session_id="test_session",
                user_id="test_user"
            )
            
            with self.subTest(user_input=user_input):
                try:
                    result = agent.recognize_intent(context)
                    
                    # 验证通用对话意图
                    self.assertEqual(result.intent_type, IntentType.GENERAL)
                    self.assertTrue(result.intent_code.startswith("000_"))
                    
                    print(f"意图类型: {result.intent_type.value}")
                    print(f"意图编码: {result.intent_code}")
                    print(f"置信度: {result.confidence}")
                    
                    # 测试情感分析
                    emotion = agent.analyze_emotion(user_input)
                    print(f"情感分析: {emotion}")
                    
                    # 测试对话上下文
                    dialog_context = agent.get_dialog_context(context)
                    print(f"对话上下文: {dialog_context}")
                    
                    print("✓ 测试通过")
                    
                except Exception as e:
                    import traceback
                    self.fail(f"✗ 测试失败: {e}\n{traceback.format_exc()}")
    
    def test_search_intent_agent(self):
        """测试搜索意图Agent"""
        print("\n=== 测试 SearchIntentAgent ===")
        
        agent = SearchIntentAgent(self.config)
        
        for user_input in self.test_cases["search"]:
            print(f"\n输入: {user_input}")
            
            context = IntentContext(
                user_input=user_input,
                session_id="test_session",
                user_id="test_user"
            )
            
            with self.subTest(user_input=user_input):
                try:
                    result = agent.recognize_intent(context)
                    
                    # 验证搜索意图
                    self.assertEqual(result.intent_type, IntentType.SEARCH)
                    self.assertTrue(result.intent_code.startswith("001_"))
                    
                    print(f"意图类型: {result.intent_type.value}")
                    print(f"意图编码: {result.intent_code}")
                    print(f"置信度: {result.confidence}")
                    
                    # 测试搜索意图分类
                    search_subtype = agent.classify_search_intent(user_input)
                    print(f"搜索子类型: {search_subtype}")
                    
                    # 测试搜索实体提取
                    search_entities = agent.extract_search_entities(user_input)
                    print(f"搜索实体: {search_entities}")
                    
                    # 测试查询特征分析
                    query_features = agent.analyze_query_features(user_input)
                    print(f"查询特征: {query_features}")
                    
                    print("✓ 测试通过")
                    
                except Exception as e:
                    self.fail(f"✗ 测试失败: {e}")
    
    def test_function_intent_agent(self):
        """测试工具调用意图Agent"""
        print("\n=== 测试 FunctionIntentAgent ===")
        
        agent = FunctionIntentAgent(self.config)
        
        for user_input in self.test_cases["function"]:
            print(f"\n输入: {user_input}")
            
            context = IntentContext(
                user_input=user_input,
                session_id="test_session",
                user_id="test_user"
            )
            
            with self.subTest(user_input=user_input):
                try:
                    result = agent.recognize_intent(context)
                    
                    # 验证工具调用意图
                    self.assertEqual(result.intent_type, IntentType.FUNCTION)
                    self.assertTrue(result.intent_code.startswith("002_"))
                    
                    print(f"意图类型: {result.intent_type.value}")
                    print(f"意图编码: {result.intent_code}")
                    print(f"置信度: {result.confidence}")
                    
                    # 验证参数提取
                    self.assertIn("tool_category", result.metadata)
                    self.assertIn("action", result.metadata)
                    self.assertIn("parameters", result.metadata)
                    self.assertIn("execution_priority", result.metadata)
                    self.assertIn("requires_confirmation", result.metadata)
                    
                    print(f"工具类别: {result.metadata['tool_category']}")
                    print(f"操作动作: {result.metadata['action']}")
                    print(f"参数: {result.metadata['parameters']}")
                    print(f"执行优先级: {result.metadata['execution_priority']}")
                    print(f"需要确认: {result.metadata['requires_confirmation']}")
                    
                    print("✓ 测试通过")
                    
                except Exception as e:
                    self.fail(f"✗ 测试失败: {e}")

async def main():
    """异步运行所有测试"""
    # 由于Kimi API是异步的，我们需要一个异步的运行器
    # 但unittest本身是同步的，所以我们在这里手动实例化并运行测试
    
    suite = unittest.TestSuite()
    suite.addTest(unittest.makeSuite(TestM1IntentAgents))
    
    runner = unittest.TextTestRunner()
    result = runner.run(suite)
    
    if result.wasSuccessful():
        print("\n🎉 所有M1意图识别Agent测试通过！")
    else:
        print("\n💔 部分M1意图识别Agent测试失败。")

if __name__ == "__main__":
    # 运行主异步函数
    asyncio.run(main())