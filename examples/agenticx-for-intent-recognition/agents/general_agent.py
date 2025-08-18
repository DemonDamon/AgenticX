"""通用对话意图Agent

专门处理000类型的通用对话意图，包括日常聊天、问候、闲聊等。
"""

from typing import Dict, List, Optional, Any
from agenticx.core import Agent, Task, AgentResult, AgentContext

from .intent_agent import IntentRecognitionAgent
from .models import IntentType, IntentResult, IntentContext, AgentConfig


class GeneralIntentAgent(IntentRecognitionAgent):
    """通用对话意图Agent
    
    继承IntentRecognitionAgent，专门处理通用对话意图(000类型)。
    集成情感分析和上下文理解功能。
    """
    
    def __init__(self, config: AgentConfig = None):
        """初始化通用对话意图Agent"""
        super().__init__(config)
        
        # 覆盖提示词模板，专门针对通用对话
        self.prompt_template = self._get_general_prompt()
    
    def _get_general_prompt(self) -> str:
        """获取通用对话意图识别的专用提示词模板"""
        return """
你是一个专业的对话意图分析助手，专门识别和分析通用对话意图。

通用对话意图包括：
1. 问候打招呼 (greeting)
2. 日常闲聊 (chitchat)
3. 情感表达 (emotion)
4. 个人信息询问 (personal_info)
5. 意见建议 (opinion)
6. 感谢道歉 (courtesy)
7. 其他对话 (other_chat)

请分析以下用户输入，识别具体的对话意图，并进行情感分析：

用户输入: {user_input}

返回格式：
{{
    "intent_type": "000",
    "confidence": 置信度(0-1之间的浮点数),
    "intent_code": "000_具体子意图",
    "description": "意图描述",
    "emotion": "情感倾向(positive/negative/neutral)",
    "emotion_score": 情感强度(0-1之间的浮点数),
    "context_understanding": "上下文理解",
    "suggested_response_type": "建议的回复类型"
}}

请确保返回有效的JSON格式。
"""
    
    def recognize_intent(self, context: IntentContext) -> IntentResult:
        """识别通用对话意图
        
        重写父类方法，添加情感分析和上下文理解。
        
        Args:
            context: 意图识别上下文
            
        Returns:
            IntentResult: 增强的意图识别结果
        """
        # 调用父类的基础识别方法，但我们主要使用其返回的结构
        result = super().recognize_intent(context)

        # GeneralIntentAgent 的核心职责是处理通用对话，因此无论上游返回什么，
        # 它都应该优先尝试将其归类为通用对话。
        # 这里我们直接使用关键词分类来覆盖或确认意图。
        
        result.intent_type = IntentType.GENERAL
        result.intent_code = self._classify_general_intent(context.user_input)
        result.description = "通用对话意图"

        # 添加情感分析
        emotion_analysis = self._analyze_emotion(context.user_input)
        result.metadata.update(emotion_analysis)

        return result
    
    def _classify_general_intent(self, user_input: str) -> str:
        """分类通用对话的具体子意图
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 具体的意图编码
        """
        user_input_lower = user_input.lower()
        
        # 问候关键词
        greeting_keywords = ["你好", "hello", "hi", "早上好", "晚上好", "再见", "bye"]
        
        # 感谢道歉关键词
        courtesy_keywords = ["谢谢", "thank", "对不起", "sorry", "抱歉"]
        
        # 情感表达关键词
        emotion_keywords = ["开心", "高兴", "难过", "生气", "担心", "害怕", "兴奋", "累", "疲惫", "心情", "情绪", "感觉"]
        
        # 个人信息关键词
        personal_keywords = ["我是", "我叫", "我的名字", "我来自", "我住在"]
        
        if any(keyword in user_input_lower for keyword in greeting_keywords):
            return "000_greeting"
        elif any(keyword in user_input_lower for keyword in courtesy_keywords):
            return "000_courtesy"
        elif any(keyword in user_input_lower for keyword in emotion_keywords):
            return "000_emotion"
        elif any(keyword in user_input_lower for keyword in personal_keywords):
            return "000_personal_info"
        elif "?" in user_input or "？" in user_input:
            return "000_question"
        else:
            return "000_chitchat"
    
    def _analyze_emotion(self, user_input: str) -> Dict[str, Any]:
        """分析用户输入的情感倾向
        
        Args:
            user_input: 用户输入
            
        Returns:
            Dict[str, Any]: 情感分析结果
        """
        user_input_lower = user_input.lower()
        
        # 积极情感关键词
        positive_keywords = [
            "开心", "高兴", "快乐", "兴奋", "满意", "喜欢", "爱", "好", "棒", "赞",
            "happy", "good", "great", "excellent", "love", "like", "awesome"
        ]
        
        # 消极情感关键词
        negative_keywords = [
            "难过", "生气", "愤怒", "失望", "沮丧", "害怕", "担心", "不好", "糟糕", "讨厌",
            "sad", "angry", "bad", "terrible", "hate", "worried", "afraid", "disappointed"
        ]
        
        positive_count = sum(1 for keyword in positive_keywords if keyword in user_input_lower)
        negative_count = sum(1 for keyword in negative_keywords if keyword in user_input_lower)
        
        if positive_count > negative_count:
            emotion = "positive"
            emotion_score = min(0.8, 0.5 + positive_count * 0.1)
        elif negative_count > positive_count:
            emotion = "negative"
            emotion_score = min(0.8, 0.5 + negative_count * 0.1)
        else:
            emotion = "neutral"
            emotion_score = 0.5
        
        # 建议的回复类型
        if emotion == "positive":
            suggested_response = "supportive_positive"
        elif emotion == "negative":
            suggested_response = "empathetic_supportive"
        else:
            suggested_response = "neutral_informative"
        
        return {
            "emotion": emotion,
            "emotion_score": emotion_score,
            "positive_indicators": positive_count,
            "negative_indicators": negative_count,
            "suggested_response_type": suggested_response
        }
    
    def get_conversation_context(self) -> Dict[str, Any]:
        """获取对话上下文信息
        
        Returns:
            Dict[str, Any]: 对话上下文
        """
        if not self.memory:
            return {}
        
        recent_interactions = self.memory.get_recent(5)
        
        # 分析最近的对话模式
        emotion_trend = []
        intent_pattern = []
        
        for interaction in recent_interactions:
            if "intent_result" in interaction:
                result = interaction["intent_result"]
                if "metadata" in result and "emotion" in result["metadata"]:
                    emotion_trend.append(result["metadata"]["emotion"])
                intent_pattern.append(result.get("intent_code", ""))
        
        return {
            "recent_emotions": emotion_trend,
            "intent_pattern": intent_pattern,
            "conversation_length": len(recent_interactions),
            "dominant_emotion": max(set(emotion_trend), key=emotion_trend.count) if emotion_trend else "neutral"
        }
    
    def analyze_emotion(self, user_input: str) -> Dict[str, Any]:
        """公共方法：分析用户输入的情感倾向
        
        Args:
            user_input: 用户输入
            
        Returns:
            Dict[str, Any]: 情感分析结果
        """
        return self._analyze_emotion(user_input)
    
    def get_dialog_context(self, context: IntentContext) -> Dict[str, Any]:
        """获取对话上下文信息
        
        Args:
            context: 意图识别上下文
            
        Returns:
            Dict[str, Any]: 对话上下文信息
        """
        return {
            "session_id": context.session_id,
            "user_id": context.user_id,
            "input_length": len(context.user_input),
            "has_question": "?" in context.user_input or "？" in context.user_input,
            "is_greeting": any(keyword in context.user_input.lower() for keyword in ["你好", "hello", "hi"]),
            "is_farewell": any(keyword in context.user_input.lower() for keyword in ["再见", "bye", "goodbye"]),
            "conversation_type": "casual_chat"
        }