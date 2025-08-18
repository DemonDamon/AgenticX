"""LLM实体抽取工具

基于大语言模型的实体抽取功能。
"""

import json
import time
import re
from typing import Dict, List, Optional, Any
from agenticx.tools.base import BaseTool
from agenticx.core import AgentContext
from .entity_models import (
    Entity, EntityType, ExtractionResult, ExtractionMethod,
    EntityExtractionConfig, EntityValidationResult
)
from .uie_extractor import UIEExtractor


class LLMExtractor(BaseTool):
    """LLM实体抽取工具
    
    使用大语言模型进行实体抽取，支持灵活的实体类型定义和复杂的抽取逻辑。
    """
    
    def __init__(self, model_name: str = "gpt-3.5-turbo", api_key: Optional[str] = None):
        super().__init__(name="llm_extractor")
        self.model_name = model_name
        self.api_key = api_key
        self._entity_descriptions = self._build_entity_descriptions()
        self.uie_extractor = UIEExtractor()
    
    def _build_entity_descriptions(self) -> Dict[EntityType, str]:
        """构建实体类型描述"""
        return {
            EntityType.PERSON: "人名，包括真实姓名、昵称、称呼等",
            EntityType.LOCATION: "地理位置，包括国家、城市、街道、建筑物等",
            EntityType.ORGANIZATION: "组织机构，包括公司、学校、政府部门等",
            EntityType.TIME: "时间表达，包括具体时刻、时间段等",
            EntityType.DATE: "日期表达，包括年月日、相对日期等",
            EntityType.MONEY: "金额表达，包括货币数量、价格等",
            EntityType.PRODUCT: "产品名称，包括商品、服务、品牌等",
            EntityType.EVENT: "事件名称，包括会议、活动、节日等",
            EntityType.KEYWORD: "关键词，包括重要概念、术语等",
            EntityType.PHONE: "电话号码，包括手机号、座机号等",
            EntityType.EMAIL: "电子邮箱地址",
            EntityType.URL: "网址链接",
            EntityType.ID_CARD: "身份证号码",
        }
    
    def _build_extraction_prompt(
        self, 
        text: str, 
        target_entities: List[EntityType]
    ) -> str:
        """构建实体抽取的提示词"""
        entity_descriptions = []
        for entity_type in target_entities:
            if entity_type in self._entity_descriptions:
                entity_descriptions.append(
                    f"- {entity_type.value}: {self._entity_descriptions[entity_type]}"
                )
        
        prompt = f"""请从以下文本中抽取指定类型的实体，并以JSON格式返回结果。

文本：
{text}

需要抽取的实体类型：
{chr(10).join(entity_descriptions)}

请按照以下JSON格式返回结果：
{{
  "entities": [
    {{
      "text": "实体文本",
      "type": "实体类型",
      "start": 起始位置,
      "end": 结束位置,
      "confidence": 置信度(0-1之间的浮点数)
    }}
  ]
}}

注意：
1. 只返回JSON格式的结果，不要包含其他文字
2. start和end是字符位置索引（从0开始）
3. confidence表示对该实体识别的置信度
4. 如果没有找到任何实体，返回空的entities数组
"""
        return prompt
    
    def _parse_llm_response(self, response: str, text: str) -> List[Entity]:
        """解析LLM响应"""
        entities = []
        
        try:
            # 尝试解析JSON响应
            response_data = json.loads(response.strip())
            
            if "entities" in response_data:
                for entity_data in response_data["entities"]:
                    try:
                        # 验证实体类型
                        entity_type_str = entity_data.get("type", "")
                        entity_type = None
                        
                        for et in EntityType:
                            if et.value == entity_type_str:
                                entity_type = et
                                break
                        
                        if entity_type is None:
                            continue
                        
                        # 创建实体对象
                        entity = Entity(
                            text=entity_data["text"],
                            label=entity_type_str,
                            entity_type=entity_type,
                            start=int(entity_data["start"]),
                            end=int(entity_data["end"]),
                            confidence=float(entity_data.get("confidence", 0.8)),
                            metadata={"extraction_method": "llm"}
                        )
                        
                        # 验证实体位置和文本
                        if (0 <= entity.start < len(text) and 
                            entity.start < entity.end <= len(text)):
                            actual_text = text[entity.start:entity.end]
                            if actual_text == entity.text:
                                entities.append(entity)
                    
                    except (KeyError, ValueError, TypeError) as e:
                        # 跳过无效的实体数据
                        continue
        
        except json.JSONDecodeError:
            # 如果JSON解析失败，尝试使用正则表达式提取
            entities = self._fallback_extraction(response, text)
        
        return entities
    
    def _fallback_extraction(self, response: str, text: str) -> List[Entity]:
        """备用抽取方法，当JSON解析失败时使用"""
        entities = []
        
        # 使用正则表达式匹配常见实体模式
        patterns = {
            EntityType.PHONE: r'1[3-9]\d{9}|\d{3,4}-\d{7,8}',
            EntityType.EMAIL: r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
            EntityType.URL: r'https?://[^\s]+',
            EntityType.ID_CARD: r'\d{17}[\dXx]',
            EntityType.MONEY: r'[￥$]?\d+(?:\.\d+)?[万千百十]?[元块钱]?',
        }
        
        for entity_type, pattern in patterns.items():
            matches = re.finditer(pattern, text)
            for match in matches:
                entity = Entity(
                    text=match.group(),
                    label=entity_type.value,
                    entity_type=entity_type,
                    start=match.start(),
                    end=match.end(),
                    confidence=0.6,  # 正则匹配的置信度较低
                    metadata={"extraction_method": "regex_fallback"}
                )
                entities.append(entity)
        
        return entities
    
    def _call_llm(self, prompt: str) -> str:
        """调用LLM API"""
        # 这里应该调用实际的LLM API
        # 为了演示，我们使用模拟响应
        import time
        time.sleep(0.01)  # 模拟LLM调用延迟
        return self._mock_llm_response(prompt)
    
    def _mock_llm_response(self, prompt: str) -> str:
        """模拟LLM响应"""
        # 从prompt中提取文本
        text_match = re.search(r'文本：\n(.+?)\n\n需要抽取', prompt, re.DOTALL)
        if not text_match:
            return '{"entities": []}'
        
        text = text_match.group(1).strip()
        
        # 简单的模拟实体识别
        entities = []
        
        # 模拟识别人名
        if '张' in text:
            start = text.find('张')
            entities.append({
                "text": "张三",
                "type": "person",
                "start": start,
                "end": start + 2,
                "confidence": 0.9
            })
        
        # 模拟识别地名
        if '北京' in text:
            start = text.find('北京')
            entities.append({
                "text": "北京",
                "type": "location",
                "start": start,
                "end": start + 2,
                "confidence": 0.85
            })
        
        # 模拟识别时间
        if '今天' in text:
            start = text.find('今天')
            entities.append({
                "text": "今天",
                "type": "time",
                "start": start,
                "end": start + 2,
                "confidence": 0.8
            })
        
        # 模拟识别电话号码
        phone_pattern = r'1[3-9]\d{9}'
        phone_match = re.search(phone_pattern, text)
        if phone_match:
            entities.append({
                "text": phone_match.group(),
                "type": "phone",
                "start": phone_match.start(),
                "end": phone_match.end(),
                "confidence": 0.95
            })
        
        return json.dumps({"entities": entities}, ensure_ascii=False)
    
    def extract_entities(
        self, 
        text: str, 
        config: Optional[EntityExtractionConfig] = None
    ) -> ExtractionResult:
        """抽取实体
        
        Args:
            text: 输入文本
            config: 抽取配置
            
        Returns:
            ExtractionResult: 抽取结果
        """
        start_time = time.time()
        
        if config is None:
            config = EntityExtractionConfig()
        
        # 构建提示词
        prompt = self._build_extraction_prompt(text, config.target_entities)
        
        # 调用LLM
        try:
            if self._call_llm is None:
                raise Exception("LLM model is not available.")
            llm_response = self._call_llm(prompt)
        except Exception as e:
            result = self.uie_extractor.extract_entities(text, config)
            result.metadata["fallback_reason"] = f"LLM call failed: {str(e)}"
            return result
        
        # 解析响应
        entities = self._parse_llm_response(llm_response, text)
        
        # 应用置信度阈值
        filtered_entities = [
            entity for entity in entities 
            if entity.confidence >= config.confidence_threshold
        ]
        
        # 添加实体到临时字典中
        entities_dict = {}
        total_confidence = 0.0
        for entity in filtered_entities:
            entity_type = entity.entity_type.value
            if entity_type not in entities_dict:
                entities_dict[entity_type] = []
            entities_dict[entity_type].append(entity)
            total_confidence += entity.confidence
        
        # 计算整体置信度
        overall_confidence = 0.0
        if filtered_entities:
            overall_confidence = total_confidence / len(filtered_entities)
        
        # 计算处理时间
        processing_time = time.time() - start_time
        
        # 构建结果
        result = ExtractionResult(
            entities=entities_dict,
            confidence=overall_confidence,
            extraction_method=ExtractionMethod.LLM,
            processing_time=processing_time,
            metadata={
                "prompt_length": len(prompt),
                "response_length": len(llm_response),
                "raw_entities_count": len(entities),
                "filtered_entities_count": len(filtered_entities)
            }
        )
        
        # 应用数量限制
        self._apply_entity_limits(result, config)
        
        return result
    
    def _apply_entity_limits(
        self, 
        result: ExtractionResult, 
        config: EntityExtractionConfig
    ) -> None:
        """应用实体数量限制"""
        for entity_type, entities in result.entities.items():
            if len(entities) > config.max_entities_per_type:
                # 按置信度排序，保留前N个
                entities.sort(key=lambda x: x.confidence, reverse=True)
                result.entities[entity_type] = entities[:config.max_entities_per_type]
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行工具逻辑
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        text = kwargs.get("text", "")
        if not text:
            return {"error": "缺少必需参数: text"}
        
        # 解析配置参数
        config_data = kwargs.get("config", {})
        try:
            config = EntityExtractionConfig(**config_data)
        except Exception as e:
            return {"error": f"配置参数错误: {str(e)}"}
        
        # 是否包含统计信息
        include_stats = kwargs.get("include_stats", False)
        
        # 执行实体抽取
        try:
            import asyncio
            result = asyncio.run(self.extract_entities(text, config))
            return {
                "success": True,
                "result": result.dict(),
                "entities_count": len(result.get_all_entities()),
                "processing_time": result.processing_time
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "processing_time": 0.0
            }
    
    async def execute(self, context: AgentContext) -> Dict[str, Any]:
        """工具执行入口
        
        Args:
            context: 工具上下文
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        # 从context中提取参数并调用_run方法
        kwargs = {
            "text": context.variables.get("text", ""),
            "config": context.variables.get("config", {}),
            "include_stats": context.variables.get("include_stats", False)
        }
        return self._run(**kwargs)
    

    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "text": {
                "type": "string",
                "description": "待抽取实体的文本",
                "required": True
            },
            "config": {
                "type": "object",
                "description": "实体抽取配置",
                "required": False,
                "properties": {
                    "target_entities": {
                        "type": "array",
                        "description": "目标实体类型列表",
                        "items": {"type": "string"}
                    },
                    "confidence_threshold": {
                        "type": "number",
                        "description": "置信度阈值",
                        "minimum": 0.0,
                        "maximum": 1.0
                    },
                    "max_entities_per_type": {
                        "type": "integer",
                        "description": "每种类型最大实体数量",
                        "minimum": 1
                    }
                }
            }
        }