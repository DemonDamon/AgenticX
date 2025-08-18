from pydantic import BaseModel, Field, field_validator
from typing import List, Dict
from enum import Enum

class IntentType(str, Enum):
    """意图类型枚举"""
    GENERAL = "000"  # 通用对话意图
    SEARCH = "001"   # 搜索意图
    FUNCTION = "002" # 工具调用意图

class EntityAnnotation(BaseModel):
    text: str
    label: str
    start: int
    end: int
    confidence: float = Field(default=1.0, description="实体识别置信度")

    @field_validator('end')
    @classmethod
    def end_must_be_greater_than_start(cls, v, info):
        if info.data.get('start') is not None and v < info.data['start']:
            raise ValueError('end must be greater than start')
        return v

class TrainingExample(BaseModel):
    id: str = Field(..., description="Unique identifier for the training example")
    text: str
    intent: str
    entities: List[EntityAnnotation] = []

class Dataset(BaseModel):
    version: str
    examples: List[TrainingExample]