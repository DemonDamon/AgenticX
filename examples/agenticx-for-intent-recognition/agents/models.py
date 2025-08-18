"""意图识别数据模型

基于AgenticX标准的意图识别数据模型定义，包括意图类型、识别结果等核心数据结构。
"""

from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from datetime import datetime


class IntentType(str, Enum):
    """意图类型枚举
    
    基于原系统的三大类意图分类：
    - GENERAL: 000类型，通用对话意图
    - SEARCH: 001类型，搜索意图
    - FUNCTION: 002类型，工具调用意图
    """
    GENERAL = "000"  # 通用对话意图
    SEARCH = "001"   # 搜索意图
    FUNCTION = "002"  # 工具调用意图


class Entity(BaseModel):
    """实体数据模型"""
    text: str = Field(description="实体文本")
    label: str = Field(description="实体标签")
    start: int = Field(description="起始位置")
    end: int = Field(description="结束位置")
    confidence: float = Field(description="置信度", ge=0.0, le=1.0)


class IntentResult(BaseModel):
    """意图识别结果
    
    基于AgenticX标准的意图识别结果数据模型，包含意图类型、置信度、
    实体信息等完整的识别结果。
    """
    intent_type: IntentType = Field(description="识别的意图类型")
    confidence: float = Field(description="意图识别置信度", ge=0.0, le=1.0)
    intent_code: str = Field(description="具体的意图编码")
    description: str = Field(description="意图描述")
    entities: List[Entity] = Field(default_factory=list, description="抽取的实体列表")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外的元数据")
    timestamp: datetime = Field(default_factory=datetime.now, description="识别时间戳")
    processing_time: Optional[float] = Field(default=None, description="处理耗时(秒)")


class IntentContext(BaseModel):
    """意图识别上下文
    
    传递给意图识别Agent的上下文信息，包含用户输入、历史对话等。
    """
    user_input: str = Field(description="用户输入文本")
    session_id: Optional[str] = Field(default=None, description="会话ID")
    user_id: Optional[str] = Field(default=None, description="用户ID")
    history: List[Dict[str, Any]] = Field(default_factory=list, description="历史对话")
    context_data: Dict[str, Any] = Field(default_factory=dict, description="上下文数据")
    timestamp: datetime = Field(default_factory=datetime.now, description="请求时间戳")


class AgentConfig(BaseModel):
    """Agent配置
    
    意图识别Agent的配置参数，包括模型配置、提示词模板等。
    """
    name: str = Field(default="intent_agent", description="Agent名称")
    llm_provider: str = Field(default="qwen-plus", description="LLM提供者")
    model_name: str = Field(default="qwen-plus", description="使用的LLM模型名称")
    model: Optional[str] = Field(default=None, description="模型名称（用于LLM Provider）")
    api_key: Optional[str] = Field(default=None, description="API密钥")
    base_url: Optional[str] = Field(default=None, description="API基础URL")
    temperature: float = Field(default=0.1, description="模型温度参数")
    max_tokens: int = Field(default=1000, description="最大生成token数")
    confidence_threshold: float = Field(default=0.8, description="置信度阈值")
    enable_memory: bool = Field(default=True, description="是否启用记忆功能")
    memory_size: int = Field(default=100, description="记忆容量")
    prompt_template: Optional[str] = Field(default=None, description="自定义提示词模板")