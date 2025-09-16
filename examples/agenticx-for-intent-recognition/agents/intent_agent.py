"""意图识别Agent

基于AgenticX框架的意图识别智能体，实现三大类意图的识别功能。
"""

import time
import json
from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import ConfigDict

from agenticx.core import Agent, Task, AgentResult, AgentContext
from agenticx.llms import KimiProvider
from agenticx.memory import ShortTermMemory

from .models import IntentType, IntentResult, IntentContext, AgentConfig, Entity


class IntentRecognitionAgent(Agent):
    """意图识别主Agent
    
    继承AgenticX Agent基类，实现意图识别的核心逻辑。
    支持三大类意图识别：通用对话(000)、搜索(001)、工具调用(002)。
    """
    
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="allow"
    )
    
    def __init__(self, config: AgentConfig = None):
        """初始化意图识别Agent
        
        Args:
            config: Agent配置参数
        """
        # 先初始化配置
        agent_config = config or AgentConfig()
        
        # 使用配置初始化父类
        super().__init__(
            name=agent_config.name,
            role="意图识别专家",
            goal="准确识别用户输入的意图类型",
            organization_id="intent_recognition_org"
        )
        
        # 存储配置（在父类初始化后）
        self.agent_config = agent_config
        
        # 初始化LLM提供者
        llm_config = {
            "model": self.agent_config.model or self.agent_config.model_name,
            "temperature": self.agent_config.temperature,
            "max_tokens": self.agent_config.max_tokens
        }
        
        # 如果配置了API密钥和基础URL，添加到配置中
        if self.agent_config.api_key:
            llm_config["api_key"] = self.agent_config.api_key
        if self.agent_config.base_url:
            llm_config["base_url"] = self.agent_config.base_url
            
        self.llm = KimiProvider(**llm_config)
        
        # 初始化记忆组件
        if self.agent_config.enable_memory:
            self.memory = ShortTermMemory(
                tenant_id="intent_recognition",
                capacity=self.agent_config.memory_size
            )
        else:
            self.memory = None
            
        # 意图识别提示词模板
        self.prompt_template = self.agent_config.prompt_template or self._get_default_prompt()
        
        # 意图类型映射
        self.intent_mapping = {
            "通用对话": IntentType.GENERAL,
            "搜索查询": IntentType.SEARCH,
            "工具调用": IntentType.FUNCTION,
            "general": IntentType.GENERAL,
            "search": IntentType.SEARCH,
            "function": IntentType.FUNCTION,
            "000": IntentType.GENERAL,
            "001": IntentType.SEARCH,
            "002": IntentType.FUNCTION
        }
    
    def _get_default_prompt(self) -> str:
        """获取默认的意图识别提示词模板"""
        return """
你是一个专业的意图识别助手，需要分析用户输入并识别其意图类型。

意图类型定义：
1. 通用对话(000): 日常聊天、问候、闲聊等对话性质的输入
2. 搜索查询(001): 明确的信息查找、搜索需求
3. 工具调用(002): 需要调用特定功能或工具的请求

请分析以下用户输入，并返回JSON格式的识别结果：

用户输入: {user_input}

返回格式：
{{
    "intent_type": "意图类型代码(000/001/002)",
    "confidence": 置信度(0-1之间的浮点数),
    "intent_code": "具体意图编码",
    "description": "意图描述",
    "reasoning": "识别理由"
}}

请确保返回有效的JSON格式。
"""
    
    def recognize_intent(self, context: IntentContext) -> IntentResult:
        """识别用户输入的意图
        
        Args:
            context: 意图识别上下文
            
        Returns:
            IntentResult: 意图识别结果
        """
        start_time = time.time()
        
        try:
            # 构建提示词
            prompt = self.prompt_template.format(
                user_input=context.user_input
            )
            
            # 调用LLM进行意图识别
            response = self.llm.generate(prompt)
            
            # 解析LLM响应
            result = self._parse_llm_response(response, context)
            
            # 计算处理时间
            processing_time = time.time() - start_time
            result.processing_time = processing_time
            
            # 存储到记忆中 (暂时禁用，因为memory.add是异步方法)
            # if self.memory:
            #     self.memory.add({
            #         "user_input": context.user_input,
            #         "intent_result": result.model_dump(),
            #         "timestamp": datetime.now().isoformat()
            #     })
            
            return result
            
        except Exception as e:
            # 错误处理，返回默认结果
            processing_time = time.time() - start_time
            return IntentResult(
                intent_type=IntentType.GENERAL,
                confidence=0.0,
                intent_code="000_unknown",
                description=f"识别失败: {str(e)}",
                processing_time=processing_time
            )
    
    def _parse_llm_response(self, response: str, context: IntentContext) -> IntentResult:
        """解析LLM响应结果
        
        Args:
            response: LLM响应文本
            context: 输入上下文
            
        Returns:
            IntentResult: 解析后的意图识别结果
        """
        try:
            # 尝试解析JSON响应
            if "```json" in response:
                json_start = response.find("```json") + 7
                json_end = response.find("```", json_start)
                json_str = response[json_start:json_end].strip()
            elif "{" in response and "}" in response:
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                json_str = response[json_start:json_end]
            else:
                raise ValueError("无法找到有效的JSON格式")
            
            parsed = json.loads(json_str)
            
            # 映射意图类型
            intent_type_str = parsed.get("intent_type", "000")
            intent_type = self.intent_mapping.get(intent_type_str, IntentType.GENERAL)
            
            # 构建结果
            return IntentResult(
                intent_type=intent_type,
                confidence=float(parsed.get("confidence", 0.8)),
                intent_code=parsed.get("intent_code", f"{intent_type.value}_default"),
                description=parsed.get("description", "意图识别结果"),
                metadata={
                    "reasoning": parsed.get("reasoning", ""),
                    "raw_response": response
                }
            )
            
        except Exception as e:
            # 解析失败时的回退逻辑
            return self._fallback_intent_recognition(context.user_input)
    
    def _fallback_intent_recognition(self, user_input: str) -> IntentResult:
        """回退的意图识别逻辑
        
        当LLM解析失败时，使用简单的规则进行意图识别。
        
        Args:
            user_input: 用户输入
            
        Returns:
            IntentResult: 意图识别结果
        """
        user_input_lower = user_input.lower()
        
        # 搜索意图关键词
        search_keywords = ["搜索", "查找", "找", "search", "find", "查询", "什么是", "介绍"]
        
        # 工具调用关键词
        function_keywords = ["帮我", "执行", "运行", "调用", "使用", "打开", "关闭", "设置"]
        
        if any(keyword in user_input_lower for keyword in search_keywords):
            return IntentResult(
                intent_type=IntentType.SEARCH,
                confidence=0.7,
                intent_code="001_search",
                description="基于关键词识别的搜索意图"
            )
        elif any(keyword in user_input_lower for keyword in function_keywords):
            return IntentResult(
                intent_type=IntentType.FUNCTION,
                confidence=0.7,
                intent_code="002_function",
                description="基于关键词识别的工具调用意图"
            )
        else:
            return IntentResult(
                intent_type=IntentType.GENERAL,
                confidence=0.6,
                intent_code="000_general",
                description="默认通用对话意图"
            )
    
    def execute(self, task: Task, context: AgentContext) -> AgentResult:
        """执行意图识别任务
        
        AgenticX Agent接口方法的实现。
        
        Args:
            task: 执行任务
            context: Agent上下文
            
        Returns:
            AgentResult: 执行结果
        """
        try:
            # 从任务中提取用户输入
            user_input = task.data.get("user_input", "")
            if not user_input:
                raise ValueError("缺少用户输入")
            
            # 构建意图识别上下文
            intent_context = IntentContext(
                user_input=user_input,
                session_id=context.session_id,
                context_data=task.data
            )
            
            # 执行意图识别
            result = self.recognize_intent(intent_context)
            
            # 返回AgenticX标准结果
            return AgentResult(
                success=True,
                data=result.dict(),
                message=f"成功识别意图: {result.description}"
            )
            
        except Exception as e:
            return AgentResult(
                success=False,
                data={},
                message=f"意图识别失败: {str(e)}"
            )