"""M8 API Service Layer Handlers

API处理器实现，基于AgenticX Handler架构。
"""

import asyncio
import time
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime

from agenticx.tools.base import BaseTool
from agenticx.core.message import Message

from models.api_models import (
    IntentRequest, IntentResponse, IntentResult,
    EntityExtractionResult, RuleMatchingResult,
    RequestStatus, HealthCheckResponse, ServiceInfo
)
from models.data_models import IntentType, EntityAnnotation
from agents.intent_agent import IntentRecognitionAgent
from tools.hybrid_extractor import HybridExtractor
from tools.rule_matching_tool import RuleMatchingTool
from workflows.intent_recognition_workflow import IntentRecognitionWorkflow


class BaseAPIHandler(BaseTool):
    """API处理器基类"""
    
    def __init__(self, name: str, description: str, **kwargs):
        super().__init__(name=name, description=description, **kwargs)
        self.start_time = time.time()
        self.request_count = 0
        self.success_count = 0
        self.error_count = 0
    
    def _generate_request_id(self) -> str:
        """生成请求ID"""
        return str(uuid.uuid4())
    
    def _update_metrics(self, success: bool = True):
        """更新指标"""
        self.request_count += 1
        if success:
            self.success_count += 1
        else:
            self.error_count += 1
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取处理器指标"""
        uptime = time.time() - self.start_time
        return {
            "uptime": uptime,
            "request_count": self.request_count,
            "success_count": self.success_count,
            "error_count": self.error_count,
            "success_rate": self.success_count / max(self.request_count, 1),
            "requests_per_second": self.request_count / max(uptime, 1)
        }


class IntentAPIHandler(BaseAPIHandler):
    """意图识别API处理器"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="IntentAPIHandler",
            description="处理意图识别请求的API处理器",
            **kwargs
        )
        
        # 初始化组件（实际项目中应该通过依赖注入）
        self.intent_agent = None  # 延迟初始化
        self.entity_extractor = None
        self.rule_matcher = None
        self.workflow = None
    
    def _initialize_components(self):
        """初始化组件（延迟初始化）"""
        if self.workflow is None:
            try:
                # 这里应该从配置或依赖注入容器获取
                self.workflow = IntentRecognitionWorkflow(
                    llm_provider=None,  # 需要配置
                    intent_agent=IntentRecognitionAgent(),
                    entity_extractor=HybridExtractor(),
                    rule_tool=RuleMatchingTool()
                )
            except Exception as e:
                # 如果组件初始化失败，使用模拟组件
                pass
    
    def _run(self, request: IntentRequest) -> IntentResponse:
        """处理意图识别请求"""
        start_time = time.time()
        request_id = request.request_id or self._generate_request_id()
        
        try:
            # 初始化组件
            self._initialize_components()
            
            # 模拟处理逻辑（实际项目中调用工作流）
            intent_result = self._process_intent(request)
            entity_result = self._process_entities(request) if request.enable_entity_extraction else None
            rule_result = self._process_rules(request) if request.enable_rule_matching else None
            
            processing_time = (time.time() - start_time) * 1000
            
            response = IntentResponse(
                request_id=request_id,
                status=RequestStatus.COMPLETED,
                intent_result=intent_result,
                entity_result=entity_result,
                rule_result=rule_result,
                total_processing_time=processing_time,
                model_performance={
                    "intent_confidence": intent_result.confidence if intent_result else 0.0,
                    "entity_confidence": entity_result.confidence if entity_result else 0.0,
                    "rule_confidence": rule_result.confidence if rule_result else 0.0
                }
            )
            
            self._update_metrics(success=True)
            return response
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            self._update_metrics(success=False)
            
            return IntentResponse(
                request_id=request_id,
                status=RequestStatus.FAILED,
                total_processing_time=processing_time,
                error=str(e),
                error_code="PROCESSING_ERROR"
            )
    
    def _process_intent(self, request: IntentRequest) -> IntentResult:
        """处理意图识别"""
        # 模拟意图识别逻辑
        text = request.text.lower()
        
        if any(word in text for word in ["搜索", "查找", "找", "search"]):
            intent_type = IntentType.SEARCH
            intent_name = "search_intent"
            confidence = 0.85
        elif any(word in text for word in ["打开", "关闭", "删除", "创建", "执行"]):
            intent_type = IntentType.FUNCTION
            intent_name = "function_intent"
            confidence = 0.80
        else:
            intent_type = IntentType.GENERAL
            intent_name = "general_conversation"
            confidence = 0.75
        
        return IntentResult(
            intent_type=intent_type,
            intent_name=intent_name,
            confidence=confidence,
            processing_time=50.0  # 模拟处理时间
        )
    
    def _process_entities(self, request: IntentRequest) -> EntityExtractionResult:
        """处理实体抽取"""
        # 模拟实体抽取逻辑
        entities = []
        text = request.text
        
        # 简单的实体识别示例
        if "北京" in text:
            entities.append(EntityAnnotation(
                text="北京",
                label="LOCATION",
                start=text.find("北京"),
                end=text.find("北京") + 2,
                confidence=0.9
            ))
        
        return EntityExtractionResult(
            entities=entities,
            extraction_method="hybrid",
            confidence=0.8,
            processing_time=30.0
        )
    
    def _process_rules(self, request: IntentRequest) -> RuleMatchingResult:
        """处理规则匹配"""
        # 模拟规则匹配逻辑
        matched_rules = []
        text = request.text.lower()
        
        if "天气" in text:
            matched_rules.append("weather_rule")
        if "时间" in text:
            matched_rules.append("time_rule")
        
        return RuleMatchingResult(
            matched_rules=matched_rules,
            match_type="keyword",
            confidence=0.7,
            processing_time=20.0
        )


class EntityAPIHandler(BaseAPIHandler):
    """实体抽取API处理器"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="EntityAPIHandler",
            description="处理实体抽取请求的API处理器",
            **kwargs
        )
        self.extractor = None  # 延迟初始化
    
    def _run(self, text: str, **kwargs) -> EntityExtractionResult:
        """处理实体抽取请求"""
        start_time = time.time()
        
        try:
            # 模拟实体抽取
            entities = self._extract_entities(text)
            processing_time = (time.time() - start_time) * 1000
            
            result = EntityExtractionResult(
                entities=entities,
                extraction_method="hybrid",
                confidence=0.85,
                processing_time=processing_time
            )
            
            self._update_metrics(success=True)
            return result
            
        except Exception as e:
            self._update_metrics(success=False)
            raise
    
    def _extract_entities(self, text: str) -> List[EntityAnnotation]:
        """提取实体"""
        entities = []
        
        # 简单的实体识别示例
        locations = ["北京", "上海", "广州", "深圳"]
        for location in locations:
            if location in text:
                start = text.find(location)
                entities.append(EntityAnnotation(
                    text=location,
                    label="LOCATION",
                    start=start,
                    end=start + len(location),
                    confidence=0.9
                ))
        
        return entities


class RuleAPIHandler(BaseAPIHandler):
    """规则匹配API处理器"""
    
    def __init__(self, **kwargs):
        super().__init__(
            name="RuleAPIHandler",
            description="处理规则匹配请求的API处理器",
            **kwargs
        )
        self.rule_matcher = None  # 延迟初始化
    
    def _run(self, text: str, **kwargs) -> RuleMatchingResult:
        """处理规则匹配请求"""
        start_time = time.time()
        
        try:
            matched_rules = self._match_rules(text)
            processing_time = (time.time() - start_time) * 1000
            
            result = RuleMatchingResult(
                matched_rules=matched_rules,
                match_type="keyword",
                confidence=0.8,
                processing_time=processing_time
            )
            
            self._update_metrics(success=True)
            return result
            
        except Exception as e:
            self._update_metrics(success=False)
            raise
    
    def _match_rules(self, text: str) -> List[str]:
        """匹配规则"""
        matched_rules = []
        text_lower = text.lower()
        
        # 定义规则
        rules = {
            "weather_rule": ["天气", "气温", "下雨", "晴天"],
            "time_rule": ["时间", "几点", "现在", "今天"],
            "greeting_rule": ["你好", "hello", "hi", "早上好"]
        }
        
        for rule_name, keywords in rules.items():
            if any(keyword in text_lower for keyword in keywords):
                matched_rules.append(rule_name)
        
        return matched_rules


class HealthCheckHandler(BaseAPIHandler):
    """健康检查处理器"""
    
    def __init__(self, service_info: ServiceInfo, **kwargs):
        super().__init__(
            name="HealthCheckHandler",
            description="处理健康检查请求的API处理器",
            **kwargs
        )
        self.service_info = service_info
    
    def _run(self, **kwargs) -> HealthCheckResponse:
        """处理健康检查请求"""
        try:
            # 检查各组件状态
            components = self._check_components()
            
            # 获取性能指标
            metrics = self.get_metrics()
            
            status = "healthy" if all(status == "ok" for status in components.values()) else "degraded"
            
            response = HealthCheckResponse(
                status=status,
                version=self.service_info.version,
                uptime=time.time() - self.start_time,
                components=components,
                metrics=metrics
            )
            
            self._update_metrics(success=True)
            return response
            
        except Exception as e:
            self._update_metrics(success=False)
            return HealthCheckResponse(
                status="unhealthy",
                version=self.service_info.version,
                uptime=time.time() - self.start_time,
                components={"error": str(e)},
                metrics={}
            )
    
    def _check_components(self) -> Dict[str, str]:
        """检查组件状态"""
        components = {}
        
        # 检查各个组件（这里是模拟检查）
        try:
            # 检查数据库连接
            components["database"] = "ok"
        except:
            components["database"] = "error"
        
        try:
            # 检查LLM服务
            components["llm_service"] = "ok"
        except:
            components["llm_service"] = "error"
        
        try:
            # 检查缓存服务
            components["cache"] = "ok"
        except:
            components["cache"] = "error"
        
        return components