"""实体优化工具

实现实体去重、合并、标准化和清理功能，提升实体识别质量。
"""

import logging
import time
import re
from typing import Dict, List, Any, Optional, Tuple, Set
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field
from collections import defaultdict
from difflib import SequenceMatcher

from .post_processing_models import (
    EntityOptimization,
    PostProcessingConfig,
    ProcessingStatus
)
from .entity_models import Entity, EntityType


class EntityOptimizationInput(BaseModel):
    """实体优化输入模型"""
    
    entities: List[Dict[str, Any]] = Field(description="待优化的实体列表")
    text: str = Field(description="原始文本")
    optimization_rules: Optional[List[str]] = Field(default=None, description="优化规则")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class EntityOptimizationTool(BaseTool):
    """实体优化工具
    
    对识别出的实体进行优化处理，包括：
    - 实体去重和合并
    - 实体边界优化
    - 实体类型标准化
    - 实体值清理和格式化
    - 重叠实体处理
    - 实体关系推理
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="entity_optimization",
            description="优化和清理实体识别结果，提升实体质量和一致性",
            args_schema=EntityOptimizationInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 优化规则
        self._optimization_rules = self._initialize_optimization_rules()
        
        # 实体类型映射
        self._entity_type_mapping = self._initialize_entity_type_mapping()
        
        # 清理模式
        self._cleaning_patterns = self._initialize_cleaning_patterns()
        
        # 相似度阈值
        self._similarity_threshold = 0.8
        self._overlap_threshold = 0.5
    
    def _initialize_optimization_rules(self) -> Dict[str, Any]:
        """初始化优化规则"""
        return {
            "deduplication": {
                "enabled": True,
                "similarity_threshold": 0.9,
                "case_sensitive": False
            },
            "boundary_optimization": {
                "enabled": True,
                "extend_boundaries": True,
                "trim_whitespace": True,
                "remove_punctuation": True
            },
            "type_standardization": {
                "enabled": True,
                "use_mapping": True,
                "infer_types": True
            },
            "value_cleaning": {
                "enabled": True,
                "normalize_case": True,
                "remove_extra_spaces": True,
                "format_numbers": True,
                "format_dates": True
            },
            "overlap_resolution": {
                "enabled": True,
                "strategy": "longest_match",  # longest_match, highest_confidence, merge
                "merge_threshold": 0.7
            },
            "relation_inference": {
                "enabled": True,
                "infer_compound_entities": True,
                "detect_entity_groups": True
            }
        }
    
    def _initialize_entity_type_mapping(self) -> Dict[str, str]:
        """初始化实体类型映射"""
        return {
            # 查询相关
            "query": "QUERY",
            "search_term": "QUERY",
            "keyword": "QUERY",
            "搜索词": "QUERY",
            "关键词": "QUERY",
            
            # 动作相关
            "action": "ACTION",
            "function": "ACTION",
            "operation": "ACTION",
            "动作": "ACTION",
            "操作": "ACTION",
            "功能": "ACTION",
            
            # 参数相关
            "parameter": "PARAMETER",
            "param": "PARAMETER",
            "argument": "PARAMETER",
            "参数": "PARAMETER",
            "参量": "PARAMETER",
            
            # 位置相关
            "location": "LOCATION",
            "place": "LOCATION",
            "address": "LOCATION",
            "地点": "LOCATION",
            "位置": "LOCATION",
            "地址": "LOCATION",
            
            # 时间相关
            "time": "TIME",
            "date": "TIME",
            "datetime": "TIME",
            "时间": "TIME",
            "日期": "TIME",
            
            # 人物相关
            "person": "PERSON",
            "people": "PERSON",
            "user": "PERSON",
            "人物": "PERSON",
            "人员": "PERSON",
            "用户": "PERSON",
            
            # 数量相关
            "number": "NUMBER",
            "quantity": "NUMBER",
            "amount": "NUMBER",
            "数字": "NUMBER",
            "数量": "NUMBER",
            "金额": "NUMBER",
            
            # 产品相关
            "product": "product",
            "PRODUCT": "product",
            "Product": "product",
            "商品": "product",
            "产品": "product",
            
            # 品牌相关
            "brand": "brand",
            "BRAND": "brand",
            "Brand": "brand",
            "品牌": "brand",
            
            # 电话相关
            "phone_number": "phone_number",
            "phone": "phone_number",
            "电话": "phone_number",
            "手机号": "phone_number"
        }
    
    def _initialize_cleaning_patterns(self) -> Dict[str, Any]:
        """初始化清理模式"""
        return {
            "whitespace": re.compile(r'\s+'),
            "punctuation": re.compile(r'[^\w\s\u4e00-\u9fff]'),
            "extra_spaces": re.compile(r'\s{2,}'),
            "leading_trailing_space": re.compile(r'^\s+|\s+$'),
            "number_format": re.compile(r'\d+(?:\.\d+)?'),
            "date_format": re.compile(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}'),
            "time_format": re.compile(r'\d{1,2}:\d{2}(?::\d{2})?')
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        if 'input_data' in kwargs:
            input_data = kwargs['input_data']
        else:
            input_data = EntityOptimizationInput(**kwargs)
        return self.execute(input_data)
    
    def execute(self, input_data: EntityOptimizationInput) -> ToolResult:
        """执行实体优化"""
        try:
            start_time = time.time()
            
            # 执行实体优化
            optimization_result = self._optimize_entities(
                entities=input_data.entities,
                text=input_data.text,
                optimization_rules=input_data.optimization_rules or [],
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"实体优化完成: 输入{optimization_result.metadata.get('original_count', 0)}个实体, "
                    f"输出{optimization_result.metadata.get('optimized_count', 0)}个实体 "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="entity_optimization",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": optimization_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"实体优化失败: {str(e)}")
            return ToolResult(
                tool_name="entity_optimization",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"实体优化失败: {str(e)}"
            )
    
    def _optimize_entities(
        self,
        entities: List[Dict[str, Any]],
        text: str,
        optimization_rules: List[str],
        config: Dict[str, Any]
    ) -> EntityOptimization:
        """执行实体优化逻辑"""
        
        original_count = len(entities)
        optimized_entities = entities.copy()
        
        optimization_steps = []
        
        # 1. 实体去重
        if ("deduplication" in optimization_rules and 
            self._optimization_rules["deduplication"]["enabled"]):
            optimized_entities, dedup_info = self._deduplicate_entities(optimized_entities)
            optimization_steps.append({
                "step": "deduplication",
                "before_count": len(entities),
                "after_count": len(optimized_entities),
                "details": dedup_info
            })
        
        # 2. 边界优化
        if ("boundary_optimization" in optimization_rules and 
            self._optimization_rules["boundary_optimization"]["enabled"]):
            optimized_entities, boundary_info = self._optimize_boundaries(optimized_entities, text)
            optimization_steps.append({
                "step": "boundary_optimization",
                "entities_modified": len(boundary_info),
                "details": boundary_info
            })
        
        # 3. 类型标准化
        if ("type_standardization" in optimization_rules and 
            self._optimization_rules["type_standardization"]["enabled"]):
            optimized_entities, type_info = self._standardize_types(optimized_entities)
            optimization_steps.append({
                "step": "type_standardization",
                "entities_modified": len(type_info),
                "details": type_info
            })
        
        # 4. 值清理
        if ("value_cleaning" in optimization_rules and 
            self._optimization_rules["value_cleaning"]["enabled"]):
            optimized_entities, cleaning_info = self._clean_values(optimized_entities)
            optimization_steps.append({
                "step": "value_cleaning",
                "entities_modified": len(cleaning_info),
                "details": cleaning_info
            })
        
        # 5. 重叠处理
        if ("overlap_resolution" in optimization_rules and 
            self._optimization_rules["overlap_resolution"]["enabled"]):
            optimized_entities, overlap_info = self._resolve_overlaps(optimized_entities)
            optimization_steps.append({
                "step": "overlap_resolution",
                "before_count": len(entities),
                "after_count": len(optimized_entities),
                "details": overlap_info
            })
        
        # 6. 关系推理
        if ("relation_inference" in optimization_rules and 
            self._optimization_rules["relation_inference"]["enabled"]):
            optimized_entities, relation_info = self._infer_relations(optimized_entities, text)
            optimization_steps.append({
                "step": "relation_inference",
                "relations_found": len(relation_info),
                "details": relation_info
            })
        
        # 计算优化统计
        optimized_count = len(optimized_entities)
        reduction_rate = (original_count - optimized_count) / original_count if original_count > 0 else 0.0
        
        # 计算质量分数
        quality_score = self._calculate_quality_score(optimized_entities, text)
        
        return EntityOptimization(
            original_entities=entities,
            optimized_entities=optimized_entities,
            operations_performed=[step["step"] for step in optimization_steps],
            optimization_score=quality_score,
            quality_improvement=quality_score - 0.5,  # 假设基准分数为0.5
            metadata={
                "original_count": original_count,
                "optimized_count": optimized_count,
                "reduction_rate": reduction_rate,
                "optimization_steps": optimization_steps,
                "text_length": len(text),
                "optimization_rules_applied": len(optimization_steps),
                "timestamp": time.time()
            }
        )
    
    def _deduplicate_entities(self, entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """实体去重"""
        
        entity_groups = defaultdict(list)
        duplicates_info = []
        
        # 按实体键分组
        for entity in entities:
            entity_key = self._generate_entity_key(entity)
            entity_groups[entity_key].append(entity)
        
        deduplicated = []
        
        # 对每组实体选择最佳的一个
        for entity_key, group in entity_groups.items():
            if len(group) == 1:
                deduplicated.append(group[0])
            else:
                # 选择置信度最高的实体
                best_entity = max(group, key=lambda e: e.get("confidence", 0.0))
                deduplicated.append(best_entity)
                
                # 记录被去重的实体
                for entity in group:
                    if entity != best_entity:
                        duplicates_info.append({
                            "duplicate_entity": entity,
                            "entity_key": entity_key,
                            "kept_entity": best_entity
                        })
        
        return deduplicated, duplicates_info
    
    def _generate_entity_key(self, entity: Dict[str, Any]) -> str:
        """生成实体唯一键"""
        
        value = entity.get("value", "").lower().strip()
        entity_type = entity.get("type", "")
        start = entity.get("start", 0)
        end = entity.get("end", 0)
        
        # 基于值和类型生成键（忽略位置信息以便去重）
        if self._optimization_rules["deduplication"]["case_sensitive"]:
            value = entity.get("value", "").strip()
        
        return f"{entity_type}:{value}"
    
    def _optimize_boundaries(self, entities: List[Dict[str, Any]], text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """优化实体边界"""
        
        optimized = []
        boundary_info = []
        
        for entity in entities:
            original_entity = entity.copy()
            
            start = entity.get("start", 0)
            end = entity.get("end", 0)
            
            # 扩展边界以包含完整单词
            if self._optimization_rules["boundary_optimization"]["extend_boundaries"]:
                new_start, new_end = self._extend_word_boundaries(text, start, end)
                entity["start"] = new_start
                entity["end"] = new_end
                entity["value"] = text[new_start:new_end]
            
            # 去除首尾空白
            if self._optimization_rules["boundary_optimization"]["trim_whitespace"]:
                value = entity.get("value", "")
                trimmed_value = value.strip()
                if trimmed_value != value:
                    # 调整边界
                    left_spaces = len(value) - len(value.lstrip())
                    right_spaces = len(value) - len(value.rstrip())
                    entity["start"] += left_spaces
                    entity["end"] -= right_spaces
                    entity["value"] = trimmed_value
            
            # 移除标点符号
            if self._optimization_rules["boundary_optimization"]["remove_punctuation"]:
                value = entity.get("value", "")
                cleaned_value = self._cleaning_patterns["punctuation"].sub("", value).strip()
                if cleaned_value and cleaned_value != value:
                    entity["value"] = cleaned_value
            
            # 记录变化
            if entity != original_entity:
                boundary_info.append({
                    "original": original_entity,
                    "optimized": entity.copy(),
                    "changes": self._get_entity_changes(original_entity, entity)
                })
            
            optimized.append(entity)
        
        return optimized, boundary_info
    
    def _extend_word_boundaries(self, text: str, start: int, end: int) -> Tuple[int, int]:
        """扩展到完整单词边界"""
        
        # 向左扩展
        new_start = start
        while new_start > 0 and text[new_start - 1].isalnum():
            new_start -= 1
        
        # 向右扩展
        new_end = end
        while new_end < len(text) and text[new_end].isalnum():
            new_end += 1
        
        return new_start, new_end
    
    def _standardize_types(self, entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """标准化实体类型"""
        
        standardized = []
        type_info = []
        
        for entity in entities:
            original_type = entity.get("type", "")
            mapping_applied = False
            
            # 使用映射表标准化
            if self._optimization_rules["type_standardization"]["use_mapping"]:
                standardized_type = self._entity_type_mapping.get(
                    original_type.lower(), original_type
                )
                
                # 更新实体类型（无论是否改变）
                entity["type"] = standardized_type
                mapping_applied = True
                if standardized_type != original_type:
                    type_info.append({
                        "entity": entity,
                        "original_type": original_type,
                        "standardized_type": standardized_type
                    })
            
            # 推理实体类型（仅当未使用映射时）
            if (self._optimization_rules["type_standardization"]["infer_types"] and 
                not mapping_applied):
                inferred_type = self._infer_entity_type(entity)
                if inferred_type and inferred_type != entity.get("type"):
                    original_type = entity.get("type")
                    entity["type"] = inferred_type
                    type_info.append({
                        "entity": entity,
                        "original_type": original_type,
                        "inferred_type": inferred_type
                    })
            
            standardized.append(entity)
        
        return standardized, type_info
    
    def _infer_entity_type(self, entity: Dict[str, Any]) -> Optional[str]:
        """推理实体类型"""
        
        value = entity.get("value", "").lower()
        
        # 数字类型推理
        if self._cleaning_patterns["number_format"].match(value):
            return "NUMBER"
        
        # 时间类型推理
        if (self._cleaning_patterns["date_format"].match(value) or 
            self._cleaning_patterns["time_format"].match(value)):
            return "TIME"
        
        # 动作类型推理（基于动词）
        action_keywords = ["搜索", "查找", "打开", "关闭", "创建", "删除", "修改", "更新",
                          "search", "find", "open", "close", "create", "delete", "modify", "update"]
        if any(keyword in value for keyword in action_keywords):
            return "ACTION"
        
        # 查询类型推理
        if len(value.split()) > 1 and not any(char.isdigit() for char in value):
            return "QUERY"
        
        return None
    
    def _clean_values(self, entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """清理实体值"""
        
        cleaned = []
        cleaning_info = []
        
        for entity in entities:
            original_value = entity.get("value", "")
            cleaned_value = original_value
            
            # 标准化大小写
            if self._optimization_rules["value_cleaning"]["normalize_case"]:
                entity_type = entity.get("type", "")
                if entity_type in ["QUERY", "ACTION"]:
                    cleaned_value = cleaned_value.lower()
                elif entity_type in ["PERSON", "LOCATION"]:
                    cleaned_value = cleaned_value.title()
            
            # 移除多余空格
            if self._optimization_rules["value_cleaning"]["remove_extra_spaces"]:
                cleaned_value = self._cleaning_patterns["extra_spaces"].sub(" ", cleaned_value)
                cleaned_value = cleaned_value.strip()
            
            # 格式化数字
            if (self._optimization_rules["value_cleaning"]["format_numbers"] and 
                entity.get("type") == "NUMBER"):
                cleaned_value = self._format_number(cleaned_value)
            
            # 格式化日期
            if (self._optimization_rules["value_cleaning"]["format_dates"] and 
                entity.get("type") == "TIME"):
                cleaned_value = self._format_date(cleaned_value)
            
            # 记录变化
            if cleaned_value != original_value:
                entity["value"] = cleaned_value
                cleaning_info.append({
                    "entity": entity,
                    "original_value": original_value,
                    "cleaned_value": cleaned_value
                })
            
            cleaned.append(entity)
        
        return cleaned, cleaning_info
    
    def _format_number(self, value: str) -> str:
        """格式化数字"""
        try:
            if "." in value:
                return f"{float(value):.2f}"
            else:
                return str(int(value))
        except ValueError:
            return value
    
    def _format_date(self, value: str) -> str:
        """格式化日期"""
        # 简单的日期格式化
        date_patterns = [
            (r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', r'\1-\2-\3'),
            (r'(\d{1,2}):(\d{2}):(\d{2})', r'\1:\2:\3'),
            (r'(\d{1,2}):(\d{2})', r'\1:\2')
        ]
        
        for pattern, replacement in date_patterns:
            value = re.sub(pattern, replacement, value)
        
        return value
    
    def _resolve_overlaps(self, entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """解决实体重叠"""
        
        if not entities:
            return entities, []
        
        # 按位置排序
        sorted_entities = sorted(entities, key=lambda e: (e.get("start", 0), e.get("end", 0)))
        
        resolved = []
        overlap_info = []
        
        i = 0
        while i < len(sorted_entities):
            current_entity = sorted_entities[i]
            overlapping_entities = [current_entity]
            
            # 找到所有重叠的实体
            j = i + 1
            while j < len(sorted_entities):
                next_entity = sorted_entities[j]
                if self._entities_overlap(current_entity, next_entity):
                    overlapping_entities.append(next_entity)
                    j += 1
                else:
                    break
            
            # 解决重叠
            if len(overlapping_entities) > 1:
                resolved_entity = self._resolve_entity_overlap(overlapping_entities)
                resolved.append(resolved_entity)
                
                overlap_info.append({
                    "overlapping_entities": overlapping_entities,
                    "resolved_entity": resolved_entity,
                    "strategy": self._optimization_rules["overlap_resolution"]["strategy"]
                })
                
                i = j
            else:
                resolved.append(current_entity)
                i += 1
        
        return resolved, overlap_info
    
    def _entities_overlap(self, entity1: Dict[str, Any], entity2: Dict[str, Any]) -> bool:
        """检查两个实体是否重叠"""
        
        start1, end1 = entity1.get("start", 0), entity1.get("end", 0)
        start2, end2 = entity2.get("start", 0), entity2.get("end", 0)
        
        # 计算重叠长度
        overlap_start = max(start1, start2)
        overlap_end = min(end1, end2)
        
        if overlap_start >= overlap_end:
            return False
        
        overlap_length = overlap_end - overlap_start
        min_length = min(end1 - start1, end2 - start2)
        
        return overlap_length / min_length >= self._overlap_threshold
    
    def _resolve_entity_overlap(self, overlapping_entities: List[Dict[str, Any]]) -> Dict[str, Any]:
        """解决实体重叠"""
        
        strategy = self._optimization_rules["overlap_resolution"]["strategy"]
        
        if strategy == "longest_match":
            # 选择最长的实体
            return max(overlapping_entities, 
                      key=lambda e: e.get("end", 0) - e.get("start", 0))
        
        elif strategy == "highest_confidence":
            # 选择置信度最高的实体
            return max(overlapping_entities, 
                      key=lambda e: e.get("confidence", 0.0))
        
        elif strategy == "merge":
            # 合并实体
            return self._merge_entities(overlapping_entities)
        
        else:
            # 默认选择第一个
            return overlapping_entities[0]
    
    def _merge_entities(self, entities: List[Dict[str, Any]]) -> Dict[str, Any]:
        """合并实体"""
        
        if not entities:
            return {}
        
        # 计算合并边界
        min_start = min(e.get("start", 0) for e in entities)
        max_end = max(e.get("end", 0) for e in entities)
        
        # 选择最常见的类型
        types = [e.get("type", "") for e in entities if e.get("type")]
        most_common_type = max(set(types), key=types.count) if types else ""
        
        # 计算平均置信度
        confidences = [e.get("confidence", 0.0) for e in entities if e.get("confidence")]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        
        # 合并值（取最长的）
        values = [e.get("value", "") for e in entities if e.get("value")]
        merged_value = max(values, key=len) if values else ""
        
        return {
            "start": min_start,
            "end": max_end,
            "value": merged_value,
            "type": most_common_type,
            "confidence": avg_confidence,
            "merged_from": len(entities)
        }
    
    def _infer_relations(self, entities: List[Dict[str, Any]], text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """推理实体关系"""
        
        enhanced_entities = entities.copy()
        relation_info = []
        
        # 检测复合实体
        if self._optimization_rules["relation_inference"]["infer_compound_entities"]:
            compound_entities = self._detect_compound_entities(entities, text)
            enhanced_entities.extend(compound_entities)
            
            if compound_entities:
                relation_info.append({
                    "type": "compound_entities",
                    "entities": compound_entities
                })
        
        # 检测实体组
        if self._optimization_rules["relation_inference"]["detect_entity_groups"]:
            entity_groups = self._detect_entity_groups(entities)
            
            if entity_groups:
                relation_info.append({
                    "type": "entity_groups",
                    "groups": entity_groups
                })
        
        return enhanced_entities, relation_info
    
    def _detect_compound_entities(self, entities: List[Dict[str, Any]], text: str) -> List[Dict[str, Any]]:
        """检测复合实体"""
        
        compound_entities = []
        
        # 检测相邻的实体是否可以组成复合实体
        sorted_entities = sorted(entities, key=lambda e: e.get("start", 0))
        
        for i in range(len(sorted_entities) - 1):
            entity1 = sorted_entities[i]
            entity2 = sorted_entities[i + 1]
            
            # 检查是否相邻
            gap = entity2.get("start", 0) - entity1.get("end", 0)
            if 0 <= gap <= 5:  # 允许小间隔
                # 检查是否形成有意义的复合实体
                compound_value = text[entity1.get("start", 0):entity2.get("end", 0)]
                
                if self._is_meaningful_compound(entity1, entity2, compound_value):
                    compound_entity = {
                        "start": entity1.get("start", 0),
                        "end": entity2.get("end", 0),
                        "value": compound_value,
                        "type": "COMPOUND",
                        "confidence": min(entity1.get("confidence", 0.0), entity2.get("confidence", 0.0)),
                        "components": [entity1, entity2]
                    }
                    compound_entities.append(compound_entity)
        
        return compound_entities
    
    def _is_meaningful_compound(self, entity1: Dict[str, Any], entity2: Dict[str, Any], compound_value: str) -> bool:
        """判断是否为有意义的复合实体"""
        
        type1 = entity1.get("type", "")
        type2 = entity2.get("type", "")
        
        # 定义有意义的组合
        meaningful_combinations = [
            ("ACTION", "PARAMETER"),
            ("QUERY", "LOCATION"),
            ("PERSON", "LOCATION"),
            ("NUMBER", "TIME"),
            ("ACTION", "QUERY")
        ]
        
        return (type1, type2) in meaningful_combinations or (type2, type1) in meaningful_combinations
    
    def _detect_entity_groups(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """检测实体组"""
        
        groups = []
        type_groups = defaultdict(list)
        
        # 按类型分组
        for entity in entities:
            entity_type = entity.get("type", "")
            type_groups[entity_type].append(entity)
        
        # 为每个类型创建组
        for entity_type, group_entities in type_groups.items():
            if len(group_entities) > 1:
                groups.append({
                    "type": entity_type,
                    "entities": group_entities,
                    "count": len(group_entities)
                })
        
        return groups
    
    def _calculate_quality_score(self, entities: List[Dict[str, Any]], text: str) -> float:
        """计算实体质量分数"""
        
        if not entities:
            return 0.0
        
        total_score = 0.0
        
        for entity in entities:
            entity_score = 0.0
            
            # 置信度分数 (40%)
            confidence = entity.get("confidence", 0.0)
            entity_score += confidence * 0.4
            
            # 类型一致性分数 (30%)
            if entity.get("type") in self._entity_type_mapping.values():
                entity_score += 0.3
            
            # 值质量分数 (20%)
            value = entity.get("value", "")
            if value and len(value.strip()) > 0:
                entity_score += 0.2
            
            # 边界准确性分数 (10%)
            start = entity.get("start", 0)
            end = entity.get("end", 0)
            if 0 <= start < end <= len(text):
                entity_score += 0.1
            
            total_score += entity_score
        
        return total_score / len(entities)
    
    def _get_entity_changes(self, original: Dict[str, Any], optimized: Dict[str, Any]) -> List[str]:
        """获取实体变化列表"""
        
        changes = []
        
        for key in ["start", "end", "value", "type", "confidence"]:
            if original.get(key) != optimized.get(key):
                changes.append(f"{key}: {original.get(key)} -> {optimized.get(key)}")
        
        return changes
    
    def get_optimization_statistics(self) -> Dict[str, Any]:
        """获取优化统计信息"""
        return {
            "optimization_rules": self._optimization_rules,
            "entity_type_mapping": self._entity_type_mapping,
            "similarity_threshold": self._similarity_threshold,
            "overlap_threshold": self._overlap_threshold,
            "config": self.config.to_dict()
        }