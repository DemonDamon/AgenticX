"""通用意图处理工作流实现
专门处理000类型的通用对话意图
"""

import time
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.base import BaseLLMProvider

from agents.general_agent import GeneralIntentAgent
from workflows.intent_recognition_workflow import PipelineResult


class ConversationContext(BaseModel):
    """对话上下文"""
    history: List[Dict[str, str]] = Field(default_factory=list, description="对话历史")
    current_turn: int = Field(0, description="当前轮次")
    user_profile: Dict[str, Any] = Field(default_factory=dict, description="用户画像")
    session_id: str = Field("", description="会话ID")


class SentimentAnalysisNode(WorkflowNode):
    """情感分析节点"""
    general_agent: GeneralIntentAgent = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, general_agent: GeneralIntentAgent, name: str = "sentiment_analysis"):
        super().__init__(id=name, name=name, type="sentiment_analysis")
        self.general_agent = general_agent
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行情感分析"""
        text = context.get("preprocessed_text", "")
        
        # 简单的情感分析逻辑
        positive_words = ["好", "棒", "喜欢", "满意", "开心", "高兴", "谢谢"]
        negative_words = ["不好", "差", "讨厌", "不满", "生气", "愤怒", "糟糕"]
        
        positive_count = sum(1 for word in positive_words if word in text)
        negative_count = sum(1 for word in negative_words if word in text)
        
        if positive_count > negative_count:
            sentiment = "positive"
            sentiment_score = 0.7 + (positive_count - negative_count) * 0.1
        elif negative_count > positive_count:
            sentiment = "negative"
            sentiment_score = 0.3 - (negative_count - positive_count) * 0.1
        else:
            sentiment = "neutral"
            sentiment_score = 0.5
        
        # 限制分数范围
        sentiment_score = max(0.0, min(1.0, sentiment_score))
        
        context["sentiment"] = sentiment
        context["sentiment_score"] = sentiment_score
        
        return context


class ContextUnderstandingNode(WorkflowNode):
    """上下文理解节点"""
    
    def __init__(self, name: str = "context_understanding"):
        super().__init__(id=name, name=name, type="context_understanding")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行上下文理解"""
        text = context.get("preprocessed_text", "")
        conversation_context = context.get("conversation_context", ConversationContext())
        
        # 分析文本类型
        text_type = self._analyze_text_type(text)
        
        # 检测是否需要上下文
        needs_context = self._needs_context(text)
        
        # 提取关键信息
        key_info = self._extract_key_info(text)
        
        context["text_type"] = text_type
        context["needs_context"] = needs_context
        context["key_info"] = key_info
        context["context_relevance"] = self._calculate_relevance(text, conversation_context)
        
        return context
    
    def _analyze_text_type(self, text: str) -> str:
        """分析文本类型"""
        if any(word in text for word in ["？", "?", "什么", "如何", "怎么"]):
            return "question"
        elif any(word in text for word in ["谢谢", "感谢", "再见", "拜拜"]):
            return "courtesy"
        elif any(word in text for word in ["好的", "是的", "对", "没错"]):
            return "confirmation"
        elif any(word in text for word in ["不", "没有", "不是", "错"]):
            return "negation"
        else:
            return "statement"
    
    def _needs_context(self, text: str) -> bool:
        """检测是否需要上下文"""
        context_indicators = ["这个", "那个", "它", "他", "她", "刚才", "之前", "上面"]
        return any(indicator in text for indicator in context_indicators)
    
    def _extract_key_info(self, text: str) -> List[str]:
        """提取关键信息"""
        # 简单的关键词提取
        import re
        # 提取中文词汇（简单实现）
        chinese_words = re.findall(r'[\u4e00-\u9fff]+', text)
        # 过滤停用词
        stop_words = {"的", "了", "在", "是", "我", "你", "他", "她", "它", "这", "那"}
        key_words = [word for word in chinese_words if word not in stop_words and len(word) > 1]
        return key_words[:5]  # 返回前5个关键词
    
    def _calculate_relevance(self, text: str, conv_context: ConversationContext) -> float:
        """计算与对话历史的相关性"""
        if not conv_context.history:
            return 0.0
        
        # 简单的相关性计算
        current_words = set(self._extract_key_info(text))
        
        max_relevance = 0.0
        for turn in conv_context.history[-3:]:  # 只考虑最近3轮
            history_words = set(self._extract_key_info(turn.get("content", "")))
            if current_words and history_words:
                overlap = len(current_words & history_words)
                total = len(current_words | history_words)
                relevance = overlap / total if total > 0 else 0.0
                max_relevance = max(max_relevance, relevance)
        
        return max_relevance


class DialogueStateNode(WorkflowNode):
    """对话状态管理节点"""
    
    def __init__(self, name: str = "dialogue_state"):
        super().__init__(id=name, name=name, type="dialogue_state")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行对话状态管理"""
        text = context.get("preprocessed_text", "")
        text_type = context.get("text_type", "statement")
        conversation_context = context.get("conversation_context", ConversationContext())
        
        # 更新对话状态
        dialogue_state = self._update_dialogue_state(text, text_type, conversation_context)
        
        # 生成响应策略
        response_strategy = self._generate_response_strategy(dialogue_state, context)
        
        context["dialogue_state"] = dialogue_state
        context["response_strategy"] = response_strategy
        
        return context
    
    def _update_dialogue_state(self, text: str, text_type: str, conv_context: ConversationContext) -> Dict[str, Any]:
        """更新对话状态"""
        state = {
            "current_intent": "general_conversation",
            "dialogue_act": text_type,
            "turn_count": conv_context.current_turn + 1,
            "topic_continuity": getattr(conv_context, 'context_relevance', 0.0) > 0.3,
            "user_engagement": self._assess_engagement(text, text_type)
        }
        return state
    
    def _assess_engagement(self, text: str, text_type: str) -> str:
        """评估用户参与度"""
        if text_type == "question":
            return "high"
        elif text_type in ["confirmation", "negation"]:
            return "medium"
        elif len(text) > 20:
            return "high"
        elif len(text) < 5:
            return "low"
        else:
            return "medium"
    
    def _generate_response_strategy(self, dialogue_state: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """生成响应策略"""
        strategy = {
            "response_type": "conversational",
            "tone": "friendly",
            "include_context": dialogue_state.get("topic_continuity", False),
            "engagement_level": dialogue_state.get("user_engagement", "medium")
        }
        
        # 根据情感调整语调
        sentiment = context.get("sentiment", "neutral")
        if sentiment == "negative":
            strategy["tone"] = "empathetic"
        elif sentiment == "positive":
            strategy["tone"] = "enthusiastic"
        
        return strategy


class GeneralIntentWorkflow:
    """通用意图处理工作流"""
    
    def __init__(self, 
                 llm_provider: BaseLLMProvider,
                 general_agent: GeneralIntentAgent):
        """
        初始化通用意图工作流
        
        Args:
            llm_provider: LLM提供者
            general_agent: 通用对话代理
        """
        self.llm_provider = llm_provider
        self.general_agent = general_agent
        
        # 设置日志
        self.logger = logging.getLogger(__name__)
        
        # 初始化节点
        self.sentiment_node = SentimentAnalysisNode(general_agent)
        self.context_node = ContextUnderstandingNode()
        self.dialogue_node = DialogueStateNode()
        
        # 构建工作流
        self._build_workflow()
    
    def _build_workflow(self):
        """构建工作流图"""
        # 创建节点列表
        nodes = [
            self.sentiment_node,
            self.context_node,
            self.dialogue_node
        ]
        
        # 创建边列表
        edges = [
            WorkflowEdge(
                source="sentiment_analysis",
                target="context_understanding"
            ),
            WorkflowEdge(
                source="context_understanding",
                target="dialogue_state"
            )
        ]
        
        # 创建工作流
        self.workflow = Workflow(
            name="general_intent_workflow",
            organization_id="default",
            nodes=nodes,
            edges=edges
        )
    
    def execute(self, text: str, conversation_context: Optional[ConversationContext] = None) -> PipelineResult:
        """执行通用意图工作流
        
        Args:
            text: 输入文本
            conversation_context: 对话上下文
            
        Returns:
            PipelineResult: 处理结果
        """
        start_time = time.time()
        
        try:
            # 初始化上下文
            context = {
                "text": text,
                "preprocessed_text": text.strip(),
                "conversation_context": conversation_context or ConversationContext(),
                "start_time": start_time
            }
            
            # 执行各个节点
            context = self.sentiment_node.execute(context)
            context = self.context_node.execute(context)
            context = self.dialogue_node.execute(context)
            
            # 使用通用代理生成响应
            task = Task(
                description=f"处理通用对话: {text}",
                expected_output="对话响应"
            )
            
            executor = AgentExecutor(llm_provider=self.llm_provider)
            agent_result = executor.run(self.general_agent, task)
            
            # 计算处理时间
            processing_time = time.time() - start_time
            
            # 构建结果
            result = PipelineResult(
                intent="000_general_conversation",
                entities={
                    "sentiment": [{
                        "text": context.get("sentiment", "neutral"),
                        "confidence": context.get("sentiment_score", 0.5)
                    }],
                    "key_info": [{
                        "text": info,
                        "confidence": 0.8
                    } for info in context.get("key_info", [])]
                },
                confidence=0.8,  # 通用意图的置信度
                rule_matches=[],
                processing_time=processing_time,
                total_processing_time=processing_time,
                metadata={
                    "workflow_type": "general_intent",
                    "sentiment": context.get("sentiment", "neutral"),
                    "text_type": context.get("text_type", "statement"),
                    "dialogue_state": context.get("dialogue_state", {}),
                    "response_strategy": context.get("response_strategy", {}),
                    "agent_response": str(agent_result)
                }
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"通用意图工作流执行失败: {e}")
            return PipelineResult(
                intent="000_general_conversation",
                entities={},
                confidence=0.0,
                rule_matches=[],
                processing_time=time.time() - start_time,
                total_processing_time=time.time() - start_time,
                metadata={"error": str(e)}
            )
    
    def get_workflow_info(self) -> Dict[str, Any]:
        """获取工作流信息"""
        return {
            "name": self.workflow.name,
            "nodes": [node.name for node in self.workflow.nodes],
            "edges_count": len(self.workflow.edges),
            "specialized_for": "000_general_conversation"
        }