"""规则匹配实体抽取工具

基于正则表达式和预定义规则的实体抽取功能。
"""

import re
import time
from typing import Dict, List, Optional, Any, Pattern
from agenticx.tools.base import BaseTool
from agenticx.core import AgentContext
from .entity_models import (
    Entity, EntityType, ExtractionResult, ExtractionMethod,
    EntityExtractionConfig, EntityValidationResult
)


class RuleExtractor(BaseTool):
    """规则匹配实体抽取工具
    
    使用正则表达式和预定义规则进行实体抽取，适用于格式化文本和特定领域。
    """
    
    def __init__(self):
        super().__init__(name="rule_extractor")
        self._rule_patterns = self._build_rule_patterns()
        self._compiled_patterns = self._compile_patterns()
    
    def _build_rule_patterns(self) -> Dict[EntityType, List[str]]:
        """构建实体类型的正则表达式规则"""
        return {
            EntityType.PHONE: [
                r'1[3-9]\d{9}',  # 手机号
                r'\d{3,4}-\d{7,8}',  # 座机号
                r'\(\d{3,4}\)\d{7,8}',  # 带括号的座机号
                r'\d{3,4}\s\d{7,8}',  # 空格分隔的座机号
            ],
            EntityType.EMAIL: [
                r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',  # 标准邮箱
            ],
            EntityType.URL: [
                r'https?://[^\s]+',  # HTTP/HTTPS链接
                r'www\.[^\s]+',  # www开头的链接
                r'[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:/[^\s]*)?',  # 域名格式
            ],
            EntityType.ID_CARD: [
                r'\d{17}[\dXx]',  # 18位身份证号
                r'\d{15}',  # 15位身份证号
            ],
            EntityType.MONEY: [
                r'[￥$¥]\d+(?:\.\d+)?',  # 货币符号+数字
                r'\d+(?:\.\d+)?[元块钱]',  # 数字+货币单位
                r'\d+(?:\.\d+)?[万千百十]?[元块钱]',  # 数字+单位+货币
                r'\d+(?:\.\d+)?万元',  # 万元格式
            ],
            EntityType.DATE: [
                r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?',  # 年月日
                r'\d{1,2}[-/月]\d{1,2}[日号]',  # 月日
                r'\d{4}年\d{1,2}月',  # 年月
                r'\d{1,2}月\d{1,2}[日号]',  # 月日中文
                r'今天|明天|昨天|后天|前天',  # 相对日期
                r'下?[一二三四五六七八九十]?[周星期天][一二三四五六七日天]',  # 星期
            ],
            EntityType.TIME: [
                r'\d{1,2}[：:]\d{2}(?:[：:]\d{2})?',  # 时分秒
                r'\d{1,2}点\d{0,2}分?',  # 中文时间
                r'上午|下午|中午|晚上|凌晨',  # 时间段
                r'早上|傍晚|深夜|半夜',  # 时间段
            ],
            EntityType.PERSON: [
                r'[王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤][\u4e00-\u9fa5]{1,3}',  # 中文姓名
                r'[A-Z][a-z]+\s[A-Z][a-z]+',  # 英文姓名
            ],
            EntityType.LOCATION: [
                r'[\u4e00-\u9fa5]+[省市区县镇村街道路巷弄号]',  # 中文地址
                r'[\u4e00-\u9fa5]+[大学学院医院银行]',  # 机构地址
                r'第?[一二三四五六七八九十百千万\d]+[号栋楼层室]',  # 楼层房号
            ],
            EntityType.ORGANIZATION: [
                r'[\u4e00-\u9fa5]+[公司企业集团](?:有限公司|股份有限公司)?',  # 公司名
                r'[\u4e00-\u9fa5]+[大学学院]',  # 学校名
                r'[\u4e00-\u9fa5]+[医院银行]',  # 医院银行
                r'[\u4e00-\u9fa5]+[部委局署厅处科]',  # 政府部门
            ],
            EntityType.PRODUCT: [
                r'iPhone\s?\d+(?:\s?Pro)?(?:\s?Max)?',  # iPhone产品
                r'华为\s?[A-Za-z0-9]+',  # 华为产品
                r'小米\s?\d+',  # 小米产品
            ],
        }
    
    def _compile_patterns(self) -> Dict[EntityType, List[Pattern]]:
        """编译正则表达式模式"""
        compiled = {}
        for entity_type, patterns in self._rule_patterns.items():
            compiled[entity_type] = []
            for pattern in patterns:
                try:
                    compiled[entity_type].append(re.compile(pattern, re.IGNORECASE))
                except re.error:
                    # 跳过无效的正则表达式
                    continue
        return compiled
    
    def _calculate_confidence(self, entity_type: EntityType, text: str) -> float:
        """计算实体的置信度"""
        # 基础置信度
        base_confidence = {
            EntityType.PHONE: 0.95,
            EntityType.EMAIL: 0.95,
            EntityType.URL: 0.90,
            EntityType.ID_CARD: 0.95,
            EntityType.MONEY: 0.85,
            EntityType.DATE: 0.80,
            EntityType.TIME: 0.80,
            EntityType.PERSON: 0.70,
            EntityType.LOCATION: 0.75,
            EntityType.ORGANIZATION: 0.75,
            EntityType.PRODUCT: 0.80,
        }.get(entity_type, 0.60)
        
        # 根据文本长度调整置信度
        length_factor = min(1.0, len(text) / 10.0)
        
        # 根据特殊字符调整置信度
        special_chars = set('!@#$%^&*()_+-=[]{}|;:,.<>?')
        if entity_type in [EntityType.EMAIL, EntityType.URL] and any(c in special_chars for c in text):
            base_confidence += 0.05
        
        return min(1.0, base_confidence * (0.8 + 0.2 * length_factor))
    
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
        
        result = ExtractionResult(
            entities={},
            confidence=0.0,
            extraction_method=ExtractionMethod.RULE,
            processing_time=0.0,
            metadata={"patterns_used": []}
        )
        
        total_confidence = 0.0
        entity_count = 0
        patterns_used = []
        
        # 遍历目标实体类型
        for entity_type in config.target_entities:
            if entity_type not in self._compiled_patterns:
                continue
            
            # 使用该类型的所有模式进行匹配
            for pattern in self._compiled_patterns[entity_type]:
                matches = pattern.finditer(text)
                
                for match in matches:
                    confidence = self._calculate_confidence(entity_type, match.group())
                    
                    # 应用置信度阈值
                    if confidence < config.confidence_threshold:
                        continue
                    
                    entity = Entity(
                        text=match.group(),
                        label=entity_type.value,
                        entity_type=entity_type,
                        start=match.start(),
                        end=match.end(),
                        confidence=confidence,
                        metadata={
                            "extraction_method": "rule",
                            "pattern": pattern.pattern
                        }
                    )
                    
                    result.add_entity(entity)
                    total_confidence += confidence
                    entity_count += 1
                    
                    if pattern.pattern not in patterns_used:
                        patterns_used.append(pattern.pattern)
        
        # 计算整体置信度
        if entity_count > 0:
            result.confidence = total_confidence / entity_count
        
        result.processing_time = time.time() - start_time
        result.metadata["patterns_used"] = patterns_used
        
        # 应用数量限制和重叠检测
        if config.enable_overlap_detection:
            self._remove_overlapping_entities(result, config.merge_strategy)
        
        self._apply_entity_limits(result, config)
        
        return result
    
    def _remove_overlapping_entities(
        self, 
        result: ExtractionResult, 
        merge_strategy: str
    ) -> None:
        """移除重叠的实体"""
        all_entities = result.get_all_entities()
        
        # 按位置排序
        all_entities.sort(key=lambda x: (x.start, x.end))
        
        # 检测并处理重叠
        filtered_entities = []
        i = 0
        
        while i < len(all_entities):
            current_entity = all_entities[i]
            overlapping_entities = [current_entity]
            
            # 找到所有与当前实体重叠的实体
            j = i + 1
            while j < len(all_entities):
                next_entity = all_entities[j]
                if self._entities_overlap(current_entity, next_entity):
                    overlapping_entities.append(next_entity)
                    j += 1
                else:
                    break
            
            # 根据合并策略选择保留的实体
            if len(overlapping_entities) == 1:
                filtered_entities.append(current_entity)
            else:
                selected_entity = self._select_entity_by_strategy(
                    overlapping_entities, merge_strategy
                )
                filtered_entities.append(selected_entity)
            
            i = j if j > i + 1 else i + 1
        
        # 重新构建结果
        result.entities = {}
        for entity in filtered_entities:
            result.add_entity(entity)
    
    def _entities_overlap(self, entity1: Entity, entity2: Entity) -> bool:
        """检查两个实体是否重叠"""
        return not (entity1.end <= entity2.start or entity2.end <= entity1.start)
    
    def _select_entity_by_strategy(
        self, 
        entities: List[Entity], 
        strategy: str
    ) -> Entity:
        """根据策略选择实体"""
        if strategy == "highest_confidence":
            return max(entities, key=lambda x: x.confidence)
        elif strategy == "longest_match":
            return max(entities, key=lambda x: x.end - x.start)
        elif strategy == "first_match":
            return entities[0]
        else:
            # 默认使用最高置信度
            return max(entities, key=lambda x: x.confidence)
    
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
    
    def add_custom_rule(
        self, 
        entity_type: EntityType, 
        pattern: str
    ) -> bool:
        """添加自定义规则
        
        Args:
            entity_type: 实体类型
            pattern: 正则表达式模式
            
        Returns:
            bool: 是否添加成功
        """
        try:
            compiled_pattern = re.compile(pattern, re.IGNORECASE)
            
            if entity_type not in self._rule_patterns:
                self._rule_patterns[entity_type] = []
                self._compiled_patterns[entity_type] = []
            
            self._rule_patterns[entity_type].append(pattern)
            self._compiled_patterns[entity_type].append(compiled_pattern)
            
            return True
        except re.error:
            return False
    
    def get_supported_entity_types(self) -> List[EntityType]:
        """获取支持的实体类型列表"""
        return list(self._rule_patterns.keys())
    
    def get_patterns_for_type(self, entity_type: EntityType) -> List[str]:
        """获取指定实体类型的所有模式"""
        return self._rule_patterns.get(entity_type, [])
    
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
                "processing_time": result.processing_time,
                "patterns_used": result.metadata.get("patterns_used", [])
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
                    },
                    "enable_overlap_detection": {
                        "type": "boolean",
                        "description": "是否启用重叠检测"
                    },
                    "merge_strategy": {
                        "type": "string",
                        "description": "合并策略",
                        "enum": ["highest_confidence", "longest_match", "first_match"]
                    }
                }
            }
        }