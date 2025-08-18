"""意图精化工具

实现意图分类结果的精化和改进，提升意图识别准确性。
"""

import logging
import time
import math
from typing import Dict, List, Any, Optional, Tuple
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field
from collections import defaultdict, Counter

from .post_processing_models import (
    IntentRefinement,
    PostProcessingConfig,
    ProcessingStatus
)


class IntentRefinementInput(BaseModel):
    """意图精化输入模型"""
    
    intent: str = Field(description="原始意图")
    confidence: float = Field(description="原始置信度")
    entities: List[Dict[str, Any]] = Field(description="实体列表")
    text: str = Field(description="原始文本")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文信息")
    refinement_rules: Optional[List[str]] = Field(default=None, description="精化规则")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class IntentRefinementTool(BaseTool):
    """意图精化工具
    
    对意图识别结果进行精化处理，包括：
    - 基于实体的意图验证和修正
    - 上下文相关性分析和调整
    - 意图置信度重新计算
    - 意图层次结构推理
    - 意图歧义消解
    - 意图一致性检查
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="intent_refinement",
            description="精化和改进意图识别结果，提升意图分类准确性",
            args_schema=IntentRefinementInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 精化规则
        self._refinement_rules = self._initialize_refinement_rules()
        
        # 意图-实体关联规则
        self._intent_entity_rules = self._initialize_intent_entity_rules()
        
        # 意图层次结构
        self._intent_hierarchy = self._initialize_intent_hierarchy()
        
        # 上下文权重
        self._context_weights = self._initialize_context_weights()
        
        # 意图关键词
        self._intent_keywords = self._initialize_intent_keywords()
    
    def _initialize_refinement_rules(self) -> Dict[str, Any]:
        """初始化精化规则"""
        return {
            "entity_validation": {
                "enabled": True,
                "strict_mode": False,
                "required_entities": {
                    "001": ["QUERY"],  # 搜索意图需要查询实体
                    "002": ["ACTION"],  # 工具调用需要动作实体
                    "003": ["QUERY", "PARAMETER"]  # 信息查询需要查询和参数
                }
            },
            "context_analysis": {
                "enabled": True,
                "context_weight": 0.3,
                "history_weight": 0.2,
                "session_weight": 0.1
            },
            "confidence_recalculation": {
                "enabled": True,
                "entity_factor": 0.4,
                "context_factor": 0.3,
                "keyword_factor": 0.2,
                "history_factor": 0.1
            },
            "hierarchy_inference": {
                "enabled": True,
                "use_parent_child": True,
                "use_sibling_relations": True
            },
            "ambiguity_resolution": {
                "enabled": True,
                "threshold": 0.1,  # 置信度差异阈值
                "use_context": True,
                "use_entities": True
            },
            "consistency_check": {
                "enabled": True,
                "check_entity_intent_match": True,
                "check_context_consistency": True,
                "check_historical_consistency": True
            }
        }
    
    def _initialize_intent_entity_rules(self) -> Dict[str, Dict[str, Any]]:
        """初始化意图-实体关联规则"""
        return {
            "001": {  # 搜索意图
                "required_entities": ["QUERY"],
                "optional_entities": ["LOCATION", "TIME", "PARAMETER"],
                "forbidden_entities": [],
                "entity_patterns": {
                    "QUERY": r".*",  # 任何查询都可以
                    "LOCATION": r".*地.*|.*市.*|.*区.*",
                    "TIME": r".*时.*|.*日.*|.*月.*"
                }
            },
            "002": {  # 工具调用意图
                "required_entities": ["ACTION"],
                "optional_entities": ["PARAMETER", "QUERY"],
                "forbidden_entities": [],
                "entity_patterns": {
                    "ACTION": r".*打开.*|.*关闭.*|.*创建.*|.*删除.*|.*修改.*",
                    "PARAMETER": r".*"
                }
            },
            "003": {  # 信息查询意图
                "required_entities": ["QUERY"],
                "optional_entities": ["PARAMETER", "TIME", "LOCATION"],
                "forbidden_entities": ["ACTION"],
                "entity_patterns": {
                    "QUERY": r".*什么.*|.*如何.*|.*为什么.*|.*哪里.*",
                    "PARAMETER": r".*"
                }
            },
            "004": {  # 一般对话意图
                "required_entities": [],
                "optional_entities": ["PERSON", "TIME", "LOCATION"],
                "forbidden_entities": ["ACTION"],
                "entity_patterns": {}
            }
        }
    
    def _initialize_intent_hierarchy(self) -> Dict[str, Dict[str, Any]]:
        """初始化意图层次结构"""
        return {
            "001": {  # 搜索意图
                "parent": None,
                "children": ["001_001", "001_002", "001_003"],
                "siblings": ["002", "003"],
                "level": 1,
                "category": "task_oriented"
            },
            "001_001": {  # 网页搜索
                "parent": "001",
                "children": [],
                "siblings": ["001_002", "001_003"],
                "level": 2,
                "category": "search"
            },
            "001_002": {  # 文档搜索
                "parent": "001",
                "children": [],
                "siblings": ["001_001", "001_003"],
                "level": 2,
                "category": "search"
            },
            "001_003": {  # 数据搜索
                "parent": "001",
                "children": [],
                "siblings": ["001_001", "001_002"],
                "level": 2,
                "category": "search"
            },
            "002": {  # 工具调用意图
                "parent": None,
                "children": ["002_001", "002_002"],
                "siblings": ["001", "003"],
                "level": 1,
                "category": "task_oriented"
            },
            "002_001": {  # 文件操作
                "parent": "002",
                "children": [],
                "siblings": ["002_002"],
                "level": 2,
                "category": "tool"
            },
            "002_002": {  # 系统操作
                "parent": "002",
                "children": [],
                "siblings": ["002_001"],
                "level": 2,
                "category": "tool"
            },
            "003": {  # 信息查询意图
                "parent": None,
                "children": [],
                "siblings": ["001", "002"],
                "level": 1,
                "category": "information_seeking"
            },
            "004": {  # 一般对话意图
                "parent": None,
                "children": [],
                "siblings": [],
                "level": 1,
                "category": "conversational"
            }
        }
    
    def _initialize_context_weights(self) -> Dict[str, float]:
        """初始化上下文权重"""
        return {
            "previous_intent": 0.3,
            "session_context": 0.2,
            "user_profile": 0.2,
            "time_context": 0.1,
            "location_context": 0.1,
            "domain_context": 0.1
        }
    
    def _initialize_intent_keywords(self) -> Dict[str, List[str]]:
        """初始化意图关键词"""
        return {
            "001": [  # 搜索意图
                "搜索", "查找", "寻找", "搜", "找", "search", "find", "look", "seek",
                "百度", "谷歌", "google", "baidu"
            ],
            "002": [  # 工具调用意图
                "打开", "关闭", "启动", "停止", "创建", "删除", "修改", "更新",
                "open", "close", "start", "stop", "create", "delete", "modify", "update",
                "运行", "执行", "调用", "使用", "run", "execute", "call", "use"
            ],
            "003": [  # 信息查询意图
                "什么", "如何", "怎么", "为什么", "哪里", "什么时候", "谁",
                "what", "how", "why", "where", "when", "who",
                "告诉我", "解释", "说明", "介绍", "explain", "describe", "tell"
            ],
            "004": [  # 一般对话意图
                "你好", "谢谢", "再见", "不客气", "抱歉", "对不起",
                "hello", "hi", "thanks", "thank you", "bye", "goodbye", "sorry",
                "聊天", "闲聊", "chat", "talk"
            ]
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        if 'input_data' in kwargs:
            input_data = kwargs['input_data']
        else:
            input_data = IntentRefinementInput(**kwargs)
        return self.execute(input_data)
    
    def execute(self, input_data: IntentRefinementInput) -> ToolResult:
        """执行意图精化"""
        try:
            start_time = time.time()
            
            # 执行意图精化
            refinement_result = self._refine_intent(
                intent=input_data.intent,
                confidence=input_data.confidence,
                entities=input_data.entities,
                text=input_data.text,
                context=input_data.context or {},
                refinement_rules=input_data.refinement_rules or [],
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"意图精化完成: {input_data.intent} -> {refinement_result.refined_intent} "
                    f"(置信度: {input_data.confidence:.3f} -> {refinement_result.refined_confidence:.3f}) "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="intent_refinement",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": refinement_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"意图精化失败: {str(e)}")
            return ToolResult(
                tool_name="intent_refinement",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"意图精化失败: {str(e)}"
            )
    
    def _refine_intent(
        self,
        intent: str,
        confidence: float,
        entities: List[Dict[str, Any]],
        text: str,
        context: Dict[str, Any],
        refinement_rules: List[str],
        config: Dict[str, Any]
    ) -> IntentRefinement:
        """执行意图精化逻辑"""
        
        original_intent = intent
        original_confidence = confidence
        
        refinement_steps = []
        
        # 1. 实体验证和修正
        if self._refinement_rules["entity_validation"]["enabled"]:
            validated_intent, entity_validation_info = self._validate_intent_with_entities(
                intent, entities, text
            )
            if validated_intent != intent:
                intent = validated_intent
                refinement_steps.append({
                    "step": "entity_validation",
                    "original_intent": original_intent,
                    "validated_intent": validated_intent,
                    "details": entity_validation_info
                })
        
        # 2. 上下文分析和调整
        if self._refinement_rules["context_analysis"]["enabled"]:
            context_adjusted_intent, context_info = self._analyze_context(
                intent, confidence, context, text
            )
            if context_adjusted_intent != intent:
                intent = context_adjusted_intent
                refinement_steps.append({
                    "step": "context_analysis",
                    "original_intent": intent,
                    "adjusted_intent": context_adjusted_intent,
                    "details": context_info
                })
        
        # 3. 置信度重新计算
        if self._refinement_rules["confidence_recalculation"]["enabled"]:
            recalculated_confidence, confidence_factors = self._recalculate_confidence(
                intent, entities, context, text, original_confidence
            )
            confidence = recalculated_confidence
            refinement_steps.append({
                "step": "confidence_recalculation",
                "original_confidence": original_confidence,
                "recalculated_confidence": recalculated_confidence,
                "factors": confidence_factors
            })
        
        # 4. 层次结构推理
        if self._refinement_rules["hierarchy_inference"]["enabled"]:
            hierarchy_refined_intent, hierarchy_info = self._infer_hierarchy(
                intent, entities, context, text
            )
            if hierarchy_refined_intent != intent:
                intent = hierarchy_refined_intent
                refinement_steps.append({
                    "step": "hierarchy_inference",
                    "original_intent": intent,
                    "refined_intent": hierarchy_refined_intent,
                    "details": hierarchy_info
                })
        
        # 5. 歧义消解
        if self._refinement_rules["ambiguity_resolution"]["enabled"]:
            disambiguated_intent, ambiguity_info = self._resolve_ambiguity(
                intent, confidence, entities, context, text
            )
            if disambiguated_intent != intent:
                intent = disambiguated_intent
                refinement_steps.append({
                    "step": "ambiguity_resolution",
                    "original_intent": intent,
                    "disambiguated_intent": disambiguated_intent,
                    "details": ambiguity_info
                })
        
        # 6. 一致性检查
        if self._refinement_rules["consistency_check"]["enabled"]:
            consistency_result = self._check_consistency(
                intent, confidence, entities, context, text
            )
            refinement_steps.append({
                "step": "consistency_check",
                "result": consistency_result
            })
        
        # 计算改进分数
        improvement_score = self._calculate_improvement_score(
            original_intent, intent, original_confidence, confidence
        )
        
        # 确定精化类型和原因
        refinement_type = "automatic"
        refinement_reason = "基于规则的自动精化"
        
        if refinement_steps:
            # 根据执行的步骤确定精化类型
            step_types = [step["step"] for step in refinement_steps]
            if "entity_validation" in step_types:
                refinement_type = "entity_based"
                refinement_reason = "基于实体验证的意图修正"
            elif "context_analysis" in step_types:
                refinement_type = "context_based"
                refinement_reason = "基于上下文分析的意图调整"
            elif "hierarchy_inference" in step_types:
                refinement_type = "hierarchy_based"
                refinement_reason = "基于层次结构推理的意图精化"
            elif "ambiguity_resolution" in step_types:
                refinement_type = "disambiguation"
                refinement_reason = "基于歧义消解的意图确定"
        
        return IntentRefinement(
            original_intent=original_intent,
            refined_intent=intent,
            refined_confidence=confidence,
            refinement_type=refinement_type,
            refinement_reason=refinement_reason,
            confidence_change=confidence - original_confidence,
            improvement_score=improvement_score,
            metadata={
                "entities_count": len(entities),
                "text_length": len(text),
                "context_keys": list(context.keys()),
                "refinement_rules_applied": len(refinement_steps),
                "refinement_steps": refinement_steps,
                "timestamp": time.time()
            }
        )
    
    def _validate_intent_with_entities(
        self, intent: str, entities: List[Dict[str, Any]], text: str
    ) -> Tuple[str, Dict[str, Any]]:
        """基于实体验证和修正意图"""
        
        validation_info = {
            "original_intent": intent,
            "entity_analysis": {},
            "violations": [],
            "suggestions": []
        }
        
        # 获取意图的实体规则
        intent_rules = self._intent_entity_rules.get(intent, {})
        if not intent_rules:
            validation_info["suggestions"].append("未知意图，无法验证")
            return intent, validation_info
        
        # 分析实体类型
        entity_types = [e.get("type", "") for e in entities]
        entity_type_counts = Counter(entity_types)
        validation_info["entity_analysis"] = dict(entity_type_counts)
        
        # 检查必需实体
        required_entities = intent_rules.get("required_entities", [])
        missing_entities = []
        for required_type in required_entities:
            if required_type not in entity_types:
                missing_entities.append(required_type)
                validation_info["violations"].append(f"缺少必需实体: {required_type}")
        
        # 检查禁止实体
        forbidden_entities = intent_rules.get("forbidden_entities", [])
        forbidden_found = []
        for forbidden_type in forbidden_entities:
            if forbidden_type in entity_types:
                forbidden_found.append(forbidden_type)
                validation_info["violations"].append(f"包含禁止实体: {forbidden_type}")
        
        # 基于违规情况建议新意图
        suggested_intent = intent
        if missing_entities or forbidden_found:
            suggested_intent = self._suggest_intent_from_entities(entity_types, text)
            if suggested_intent != intent:
                validation_info["suggestions"].append(
                    f"基于实体分析建议意图: {suggested_intent}"
                )
        
        return suggested_intent, validation_info
    
    def _suggest_intent_from_entities(self, entity_types: List[str], text: str) -> str:
        """基于实体类型建议意图"""
        
        # 计算每个意图的匹配分数
        intent_scores = {}
        
        for intent_id, rules in self._intent_entity_rules.items():
            score = 0.0
            
            # 必需实体匹配分数
            required_entities = rules.get("required_entities", [])
            required_matches = sum(1 for req in required_entities if req in entity_types)
            if required_entities:
                score += (required_matches / len(required_entities)) * 0.6
            
            # 可选实体匹配分数
            optional_entities = rules.get("optional_entities", [])
            optional_matches = sum(1 for opt in optional_entities if opt in entity_types)
            if optional_entities:
                score += (optional_matches / len(optional_entities)) * 0.3
            
            # 禁止实体惩罚
            forbidden_entities = rules.get("forbidden_entities", [])
            forbidden_matches = sum(1 for forb in forbidden_entities if forb in entity_types)
            score -= forbidden_matches * 0.2
            
            # 关键词匹配分数
            keywords = self._intent_keywords.get(intent_id, [])
            keyword_matches = sum(1 for keyword in keywords if keyword in text.lower())
            if keywords:
                score += (keyword_matches / len(keywords)) * 0.1
            
            intent_scores[intent_id] = max(0.0, score)
        
        # 返回分数最高的意图
        if intent_scores:
            return max(intent_scores.items(), key=lambda x: x[1])[0]
        
        return "004"  # 默认返回一般对话意图
    
    def _analyze_context(
        self, intent: str, confidence: float, context: Dict[str, Any], text: str
    ) -> Tuple[str, Dict[str, Any]]:
        """分析上下文并调整意图"""
        
        context_info = {
            "context_factors": {},
            "adjustments": [],
            "context_score": 0.0
        }
        
        adjusted_intent = intent
        context_score = 0.0
        
        # 分析前一个意图
        previous_intent = context.get("previous_intent")
        if previous_intent:
            context_factor = self._analyze_intent_transition(previous_intent, intent)
            context_score += context_factor * self._context_weights["previous_intent"]
            context_info["context_factors"]["previous_intent"] = context_factor
            
            if context_factor < 0.3:  # 意图转换不合理
                # 建议保持前一个意图的相关意图
                related_intent = self._get_related_intent(previous_intent, text)
                if related_intent and related_intent != intent:
                    adjusted_intent = related_intent
                    context_info["adjustments"].append(
                        f"基于前一意图{previous_intent}调整为{related_intent}"
                    )
        
        # 分析会话上下文
        session_context = context.get("session_context", {})
        if session_context:
            session_factor = self._analyze_session_context(session_context, intent)
            context_score += session_factor * self._context_weights["session_context"]
            context_info["context_factors"]["session_context"] = session_factor
        
        # 分析用户画像
        user_profile = context.get("user_profile", {})
        if user_profile:
            profile_factor = self._analyze_user_profile(user_profile, intent)
            context_score += profile_factor * self._context_weights["user_profile"]
            context_info["context_factors"]["user_profile"] = profile_factor
        
        # 分析时间上下文
        time_context = context.get("time_context")
        if time_context:
            time_factor = self._analyze_time_context(time_context, intent)
            context_score += time_factor * self._context_weights["time_context"]
            context_info["context_factors"]["time_context"] = time_factor
        
        context_info["context_score"] = context_score
        
        return adjusted_intent, context_info
    
    def _analyze_intent_transition(self, previous_intent: str, current_intent: str) -> float:
        """分析意图转换的合理性"""
        
        # 获取意图层次信息
        prev_hierarchy = self._intent_hierarchy.get(previous_intent, {})
        curr_hierarchy = self._intent_hierarchy.get(current_intent, {})
        
        # 同一意图
        if previous_intent == current_intent:
            return 1.0
        
        # 父子关系
        if (curr_hierarchy.get("parent") == previous_intent or 
            previous_intent in curr_hierarchy.get("children", [])):
            return 0.9
        
        # 兄弟关系
        if current_intent in prev_hierarchy.get("siblings", []):
            return 0.7
        
        # 同一类别
        if (prev_hierarchy.get("category") == curr_hierarchy.get("category") and
            prev_hierarchy.get("category")):
            return 0.6
        
        # 不同类别但合理的转换
        reasonable_transitions = {
            "task_oriented": ["information_seeking", "conversational"],
            "information_seeking": ["task_oriented", "conversational"],
            "conversational": ["task_oriented", "information_seeking"]
        }
        
        prev_category = prev_hierarchy.get("category")
        curr_category = curr_hierarchy.get("category")
        
        if (prev_category and curr_category and 
            curr_category in reasonable_transitions.get(prev_category, [])):
            return 0.4
        
        # 完全不相关
        return 0.2
    
    def _get_related_intent(self, previous_intent: str, text: str) -> Optional[str]:
        """获取与前一意图相关的意图"""
        
        prev_hierarchy = self._intent_hierarchy.get(previous_intent, {})
        
        # 优先考虑子意图
        children = prev_hierarchy.get("children", [])
        for child in children:
            if self._intent_matches_text(child, text):
                return child
        
        # 考虑兄弟意图
        siblings = prev_hierarchy.get("siblings", [])
        for sibling in siblings:
            if self._intent_matches_text(sibling, text):
                return sibling
        
        # 考虑父意图
        parent = prev_hierarchy.get("parent")
        if parent and self._intent_matches_text(parent, text):
            return parent
        
        return None
    
    def _intent_matches_text(self, intent: str, text: str) -> bool:
        """检查意图是否匹配文本"""
        
        keywords = self._intent_keywords.get(intent, [])
        text_lower = text.lower()
        
        return any(keyword in text_lower for keyword in keywords)
    
    def _analyze_session_context(self, session_context: Dict[str, Any], intent: str) -> float:
        """分析会话上下文"""
        
        # 分析会话中的意图分布
        intent_history = session_context.get("intent_history", [])
        if not intent_history:
            return 0.5
        
        # 计算意图频率
        intent_counts = Counter(intent_history)
        total_intents = len(intent_history)
        
        # 当前意图的历史频率
        current_frequency = intent_counts.get(intent, 0) / total_intents
        
        # 频率越高，上下文匹配度越高
        return min(1.0, current_frequency * 2)
    
    def _analyze_user_profile(self, user_profile: Dict[str, Any], intent: str) -> float:
        """分析用户画像"""
        
        # 用户偏好的意图类型
        preferred_intents = user_profile.get("preferred_intents", [])
        if intent in preferred_intents:
            return 1.0
        
        # 用户的技能水平
        skill_level = user_profile.get("skill_level", "beginner")
        
        # 根据技能水平调整意图匹配度
        if skill_level == "expert" and intent.startswith("002"):  # 工具调用
            return 0.9
        elif skill_level == "beginner" and intent in ["003", "004"]:  # 信息查询和对话
            return 0.8
        
        return 0.5
    
    def _analyze_time_context(self, time_context: Dict[str, Any], intent: str) -> float:
        """分析时间上下文"""
        
        # 一天中的时间对意图的影响
        hour = time_context.get("hour", 12)
        
        # 工作时间更可能是任务导向的意图
        if 9 <= hour <= 17 and intent in ["001", "002"]:
            return 0.8
        
        # 休息时间更可能是对话或信息查询
        if (hour < 9 or hour > 17) and intent in ["003", "004"]:
            return 0.7
        
        return 0.5
    
    def _recalculate_confidence(
        self, intent: str, entities: List[Dict[str, Any]], context: Dict[str, Any], 
        text: str, original_confidence: float
    ) -> Tuple[float, Dict[str, float]]:
        """重新计算置信度"""
        
        factors = {}
        
        # 实体因子
        entity_factor = self._calculate_entity_factor(intent, entities)
        factors["entity_factor"] = entity_factor
        
        # 上下文因子
        context_factor = self._calculate_context_factor(intent, context)
        factors["context_factor"] = context_factor
        
        # 关键词因子
        keyword_factor = self._calculate_keyword_factor(intent, text)
        factors["keyword_factor"] = keyword_factor
        
        # 历史因子
        history_factor = self._calculate_history_factor(intent, context)
        factors["history_factor"] = history_factor
        
        # 加权计算新置信度
        rules = self._refinement_rules["confidence_recalculation"]
        new_confidence = (
            entity_factor * rules["entity_factor"] +
            context_factor * rules["context_factor"] +
            keyword_factor * rules["keyword_factor"] +
            history_factor * rules["history_factor"]
        )
        
        # 与原始置信度结合
        final_confidence = (new_confidence + original_confidence) / 2
        final_confidence = max(0.0, min(1.0, final_confidence))
        
        return final_confidence, factors
    
    def _calculate_entity_factor(self, intent: str, entities: List[Dict[str, Any]]) -> float:
        """计算实体因子"""
        
        intent_rules = self._intent_entity_rules.get(intent, {})
        if not intent_rules:
            return 0.5
        
        entity_types = [e.get("type", "") for e in entities]
        
        # 必需实体匹配度
        required_entities = intent_rules.get("required_entities", [])
        required_score = 0.0
        if required_entities:
            matches = sum(1 for req in required_entities if req in entity_types)
            required_score = matches / len(required_entities)
        else:
            required_score = 1.0
        
        # 可选实体加分
        optional_entities = intent_rules.get("optional_entities", [])
        optional_score = 0.0
        if optional_entities:
            matches = sum(1 for opt in optional_entities if opt in entity_types)
            optional_score = min(1.0, matches / len(optional_entities))
        
        # 禁止实体扣分
        forbidden_entities = intent_rules.get("forbidden_entities", [])
        forbidden_penalty = 0.0
        if forbidden_entities:
            matches = sum(1 for forb in forbidden_entities if forb in entity_types)
            forbidden_penalty = matches * 0.2
        
        return max(0.0, required_score * 0.7 + optional_score * 0.3 - forbidden_penalty)
    
    def _calculate_context_factor(self, intent: str, context: Dict[str, Any]) -> float:
        """计算上下文因子"""
        
        context_score = 0.0
        
        # 前一意图的影响
        previous_intent = context.get("previous_intent")
        if previous_intent:
            transition_score = self._analyze_intent_transition(previous_intent, intent)
            context_score += transition_score * 0.5
        
        # 会话上下文的影响
        session_context = context.get("session_context", {})
        if session_context:
            session_score = self._analyze_session_context(session_context, intent)
            context_score += session_score * 0.3
        
        # 用户画像的影响
        user_profile = context.get("user_profile", {})
        if user_profile:
            profile_score = self._analyze_user_profile(user_profile, intent)
            context_score += profile_score * 0.2
        
        return min(1.0, context_score)
    
    def _calculate_keyword_factor(self, intent: str, text: str) -> float:
        """计算关键词因子"""
        
        keywords = self._intent_keywords.get(intent, [])
        if not keywords:
            return 0.5
        
        text_lower = text.lower()
        matches = sum(1 for keyword in keywords if keyword in text_lower)
        
        return min(1.0, matches / len(keywords))
    
    def _calculate_history_factor(self, intent: str, context: Dict[str, Any]) -> float:
        """计算历史因子"""
        
        session_context = context.get("session_context", {})
        intent_history = session_context.get("intent_history", [])
        
        if not intent_history:
            return 0.5
        
        # 计算意图在历史中的成功率
        intent_count = intent_history.count(intent)
        total_count = len(intent_history)
        
        return min(1.0, intent_count / total_count * 2)
    
    def _infer_hierarchy(
        self, intent: str, entities: List[Dict[str, Any]], context: Dict[str, Any], text: str
    ) -> Tuple[str, Dict[str, Any]]:
        """推理意图层次结构"""
        
        hierarchy_info = {
            "current_level": self._intent_hierarchy.get(intent, {}).get("level", 1),
            "suggestions": [],
            "reasoning": []
        }
        
        refined_intent = intent
        
        # 检查是否可以推理到更具体的子意图
        if self._refinement_rules["hierarchy_inference"]["use_parent_child"]:
            children = self._intent_hierarchy.get(intent, {}).get("children", [])
            
            for child in children:
                if self._intent_matches_entities_and_text(child, entities, text):
                    refined_intent = child
                    hierarchy_info["suggestions"].append(f"推理到子意图: {child}")
                    hierarchy_info["reasoning"].append(
                        f"基于实体和文本匹配推理到更具体的意图{child}"
                    )
                    break
        
        # 检查兄弟意图是否更合适
        if self._refinement_rules["hierarchy_inference"]["use_sibling_relations"]:
            siblings = self._intent_hierarchy.get(intent, {}).get("siblings", [])
            
            for sibling in siblings:
                if self._intent_matches_entities_and_text(sibling, entities, text):
                    # 计算匹配分数
                    current_score = self._calculate_intent_match_score(intent, entities, text)
                    sibling_score = self._calculate_intent_match_score(sibling, entities, text)
                    
                    if sibling_score > current_score + 0.1:  # 显著更好
                        refined_intent = sibling
                        hierarchy_info["suggestions"].append(f"切换到兄弟意图: {sibling}")
                        hierarchy_info["reasoning"].append(
                            f"兄弟意图{sibling}的匹配分数({sibling_score:.3f})高于当前意图({current_score:.3f})"
                        )
                        break
        
        return refined_intent, hierarchy_info
    
    def _intent_matches_entities_and_text(
        self, intent: str, entities: List[Dict[str, Any]], text: str
    ) -> bool:
        """检查意图是否匹配实体和文本"""
        
        # 检查实体匹配
        entity_types = [e.get("type", "") for e in entities]
        intent_rules = self._intent_entity_rules.get(intent, {})
        
        required_entities = intent_rules.get("required_entities", [])
        if required_entities:
            if not all(req in entity_types for req in required_entities):
                return False
        
        # 检查文本匹配
        return self._intent_matches_text(intent, text)
    
    def _calculate_intent_match_score(
        self, intent: str, entities: List[Dict[str, Any]], text: str
    ) -> float:
        """计算意图匹配分数"""
        
        entity_factor = self._calculate_entity_factor(intent, entities)
        keyword_factor = self._calculate_keyword_factor(intent, text)
        
        return entity_factor * 0.7 + keyword_factor * 0.3
    
    def _resolve_ambiguity(
        self, intent: str, confidence: float, entities: List[Dict[str, Any]], 
        context: Dict[str, Any], text: str
    ) -> Tuple[str, Dict[str, Any]]:
        """解决意图歧义"""
        
        ambiguity_info = {
            "ambiguity_detected": False,
            "alternative_intents": [],
            "resolution_strategy": "",
            "confidence_threshold": self._refinement_rules["ambiguity_resolution"]["threshold"]
        }
        
        resolved_intent = intent
        
        # 检查置信度是否过低（可能存在歧义）
        threshold = self._refinement_rules["ambiguity_resolution"]["threshold"]
        if confidence < threshold:
            ambiguity_info["ambiguity_detected"] = True
            
            # 寻找替代意图
            alternative_intents = self._find_alternative_intents(entities, text, context)
            ambiguity_info["alternative_intents"] = alternative_intents
            
            if alternative_intents:
                # 选择最佳替代意图
                best_alternative = max(
                    alternative_intents, 
                    key=lambda x: x["score"]
                )
                
                if best_alternative["score"] > confidence + 0.1:
                    resolved_intent = best_alternative["intent"]
                    ambiguity_info["resolution_strategy"] = "选择最佳替代意图"
                else:
                    ambiguity_info["resolution_strategy"] = "保持原意图，置信度过低但无更好替代"
            else:
                ambiguity_info["resolution_strategy"] = "无可用替代意图"
        
        return resolved_intent, ambiguity_info
    
    def _find_alternative_intents(
        self, entities: List[Dict[str, Any]], text: str, context: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """寻找替代意图"""
        
        alternatives = []
        
        for intent_id in self._intent_entity_rules.keys():
            score = self._calculate_intent_match_score(intent_id, entities, text)
            
            # 加入上下文分数
            if context:
                context_score = self._calculate_context_factor(intent_id, context)
                score = score * 0.7 + context_score * 0.3
            
            if score > 0.3:  # 只考虑有一定匹配度的意图
                alternatives.append({
                    "intent": intent_id,
                    "score": score,
                    "reasoning": f"实体匹配分数: {score:.3f}"
                })
        
        return sorted(alternatives, key=lambda x: x["score"], reverse=True)
    
    def _check_consistency(
        self, intent: str, confidence: float, entities: List[Dict[str, Any]], 
        context: Dict[str, Any], text: str
    ) -> Dict[str, Any]:
        """检查一致性"""
        
        consistency_result = {
            "entity_intent_consistency": True,
            "context_consistency": True,
            "historical_consistency": True,
            "overall_consistency": True,
            "issues": []
        }
        
        # 检查实体-意图一致性
        if self._refinement_rules["consistency_check"]["check_entity_intent_match"]:
            entity_consistency = self._check_entity_intent_consistency(intent, entities)
            consistency_result["entity_intent_consistency"] = entity_consistency
            if not entity_consistency:
                consistency_result["issues"].append("实体与意图不一致")
        
        # 检查上下文一致性
        if self._refinement_rules["consistency_check"]["check_context_consistency"]:
            context_consistency = self._check_context_consistency(intent, context)
            consistency_result["context_consistency"] = context_consistency
            if not context_consistency:
                consistency_result["issues"].append("与上下文不一致")
        
        # 检查历史一致性
        if self._refinement_rules["consistency_check"]["check_historical_consistency"]:
            historical_consistency = self._check_historical_consistency(intent, context)
            consistency_result["historical_consistency"] = historical_consistency
            if not historical_consistency:
                consistency_result["issues"].append("与历史模式不一致")
        
        # 总体一致性
        consistency_result["overall_consistency"] = (
            consistency_result["entity_intent_consistency"] and
            consistency_result["context_consistency"] and
            consistency_result["historical_consistency"]
        )
        
        return consistency_result
    
    def _check_entity_intent_consistency(self, intent: str, entities: List[Dict[str, Any]]) -> bool:
        """检查实体-意图一致性"""
        
        intent_rules = self._intent_entity_rules.get(intent, {})
        if not intent_rules:
            return True
        
        entity_types = [e.get("type", "") for e in entities]
        
        # 检查必需实体
        required_entities = intent_rules.get("required_entities", [])
        for required in required_entities:
            if required not in entity_types:
                return False
        
        # 检查禁止实体
        forbidden_entities = intent_rules.get("forbidden_entities", [])
        for forbidden in forbidden_entities:
            if forbidden in entity_types:
                return False
        
        return True
    
    def _check_context_consistency(self, intent: str, context: Dict[str, Any]) -> bool:
        """检查上下文一致性"""
        
        previous_intent = context.get("previous_intent")
        if previous_intent:
            transition_score = self._analyze_intent_transition(previous_intent, intent)
            return transition_score > 0.3
        
        return True
    
    def _check_historical_consistency(self, intent: str, context: Dict[str, Any]) -> bool:
        """检查历史一致性"""
        
        session_context = context.get("session_context", {})
        intent_history = session_context.get("intent_history", [])
        
        if len(intent_history) < 3:  # 历史数据不足
            return True
        
        # 检查意图是否在用户的常用意图中
        intent_counts = Counter(intent_history)
        total_intents = len(intent_history)
        
        # 如果这个意图从未出现过，且历史数据充足，可能不一致
        if intent not in intent_counts and total_intents > 10:
            return False
        
        return True
    
    def _calculate_improvement_score(
        self, original_intent: str, refined_intent: str, 
        original_confidence: float, refined_confidence: float
    ) -> float:
        """计算改进分数"""
        
        # 置信度改进
        confidence_improvement = refined_confidence - original_confidence
        
        # 意图改进（如果意图发生变化）
        intent_improvement = 0.0
        if original_intent != refined_intent:
            # 假设精化后的意图更准确
            intent_improvement = 0.1
        
        # 总改进分数
        total_improvement = confidence_improvement + intent_improvement
        
        return max(0.0, min(1.0, total_improvement))
    
    def get_refinement_statistics(self) -> Dict[str, Any]:
        """获取精化统计信息"""
        return {
            "refinement_rules": self._refinement_rules,
            "intent_entity_rules": self._intent_entity_rules,
            "intent_hierarchy": self._intent_hierarchy,
            "context_weights": self._context_weights,
            "intent_keywords": self._intent_keywords,
            "config": self.config.to_dict()
        }