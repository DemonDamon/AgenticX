"""M8 API Service Layer Gateway

意图识别服务网关，基于AgenticX平台架构。
"""

import asyncio
import time
import logging
from typing import Dict, Any, Optional, List, Union
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from agenticx.core.platform import User, Organization
from agenticx.core.message import Message

from models.api_models import (
    IntentRequest, IntentResponse, BatchIntentRequest, BatchIntentResponse,
    RequestStatus, ServiceInfo
)
from api.handlers import (
    IntentAPIHandler, EntityAPIHandler, RuleAPIHandler, HealthCheckHandler
)


class ServiceGateway:
    """服务网关基类"""
    
    def __init__(self, service_info: ServiceInfo):
        self.service_info = service_info
        self.logger = logging.getLogger(self.__class__.__name__)
        self.start_time = time.time()
        self.request_count = 0
        self.active_requests = 0
        self.max_concurrent_requests = 100
        
        # 线程池用于并发处理
        self.executor = ThreadPoolExecutor(max_workers=10)
    
    def get_service_info(self) -> ServiceInfo:
        """获取服务信息"""
        return self.service_info
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取网关指标"""
        uptime = time.time() - self.start_time
        return {
            "uptime": uptime,
            "total_requests": self.request_count,
            "active_requests": self.active_requests,
            "requests_per_second": self.request_count / max(uptime, 1),
            "max_concurrent_requests": self.max_concurrent_requests
        }
    
    async def shutdown(self):
        """关闭网关"""
        self.executor.shutdown(wait=True)
        self.logger.info("Service gateway shutdown completed")


class IntentServiceGateway(ServiceGateway):
    """意图识别服务网关
    
    基于AgenticX平台架构，提供意图识别服务的统一入口。
    """
    
    def __init__(self, service_info: Optional[ServiceInfo] = None):
        if service_info is None:
            service_info = ServiceInfo(
                name="Intent Recognition Service",
                version="1.0.0",
                description="AgenticX意图识别服务",
                api_version="v1",
                endpoints=[
                    "/api/v1/intent/recognize",
                    "/api/v1/intent/batch",
                    "/api/v1/entity/extract",
                    "/api/v1/rule/match",
                    "/health"
                ]
            )
        
        super().__init__(service_info)
        
        # 初始化处理器
        self.intent_handler = IntentAPIHandler()
        self.entity_handler = EntityAPIHandler()
        self.rule_handler = RuleAPIHandler()
        self.health_handler = HealthCheckHandler(service_info)
        
        # 请求路由映射
        self.routes = {
            "intent_recognize": self.intent_handler,
            "entity_extract": self.entity_handler,
            "rule_match": self.rule_handler,
            "health_check": self.health_handler
        }
        
        self.logger.info(f"IntentServiceGateway initialized: {service_info.name} v{service_info.version}")
    
    async def process_intent_request(self, request: IntentRequest, user: Optional[User] = None) -> IntentResponse:
        """处理意图识别请求
        
        Args:
            request: 意图识别请求
            user: 用户信息（可选）
            
        Returns:
            意图识别响应
        """
        start_time = time.time()
        self.request_count += 1
        self.active_requests += 1
        
        try:
            # 检查并发限制
            if self.active_requests > self.max_concurrent_requests:
                return IntentResponse(
                    request_id=request.request_id or "unknown",
                    status=RequestStatus.FAILED,
                    error="Too many concurrent requests",
                    error_code="RATE_LIMIT_EXCEEDED",
                    total_processing_time=(time.time() - start_time) * 1000
                )
            
            # 验证请求
            validation_error = self._validate_request(request)
            if validation_error:
                return IntentResponse(
                    request_id=request.request_id or "unknown",
                    status=RequestStatus.FAILED,
                    error=validation_error,
                    error_code="VALIDATION_ERROR",
                    total_processing_time=(time.time() - start_time) * 1000
                )
            
            # 记录用户信息（如果提供）
            if user:
                self.logger.info(f"Processing request for user: {user.full_name or user.username} (ID: {user.id})")
            
            # 处理请求
            response = await self._execute_intent_recognition(request)
            
            # 记录成功处理
            processing_time = (time.time() - start_time) * 1000
            self.logger.info(
                f"Request processed successfully: {request.request_id}, "
                f"time: {processing_time:.2f}ms"
            )
            
            return response
            
        except Exception as e:
            # 记录错误
            processing_time = (time.time() - start_time) * 1000
            self.logger.error(f"Error processing request {request.request_id}: {str(e)}")
            
            return IntentResponse(
                request_id=request.request_id or "unknown",
                status=RequestStatus.FAILED,
                error=str(e),
                error_code="INTERNAL_ERROR",
                total_processing_time=processing_time
            )
        
        finally:
            self.active_requests -= 1
    
    async def process_batch_request(self, batch_request: BatchIntentRequest, user: Optional[User] = None) -> BatchIntentResponse:
        """处理批量意图识别请求
        
        Args:
            batch_request: 批量请求
            user: 用户信息（可选）
            
        Returns:
            批量响应
        """
        start_time = time.time()
        
        try:
            # 验证批量请求
            if not batch_request.requests:
                return BatchIntentResponse(
                    batch_id=batch_request.batch_id,
                    status=RequestStatus.FAILED,
                    responses=[],
                    total_count=0,
                    success_count=0,
                    failed_count=0,
                    total_processing_time=0,
                    summary={"error": "Empty batch request"},
                    error="Empty batch request"
                )
            
            if len(batch_request.requests) > 100:  # 限制批量大小
                return BatchIntentResponse(
                    batch_id=batch_request.batch_id,
                    status=RequestStatus.FAILED,
                    responses=[],
                    total_count=len(batch_request.requests),
                    success_count=0,
                    failed_count=len(batch_request.requests),
                    total_processing_time=0,
                    summary={"error": "Batch size exceeds limit (100)"},
                    error="Batch size exceeds limit (100)"
                )
            
            # 并发处理所有请求
            tasks = [
                self.process_intent_request(request, user)
                for request in batch_request.requests
            ]
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            # 处理异常响应
            processed_responses = []
            for i, response in enumerate(responses):
                if isinstance(response, Exception):
                    error_response = IntentResponse(
                        request_id=batch_request.requests[i].request_id or f"batch_{i}",
                        status=RequestStatus.FAILED,
                        error=str(response),
                        error_code="BATCH_PROCESSING_ERROR",
                        total_processing_time=0
                    )
                    processed_responses.append(error_response)
                else:
                    processed_responses.append(response)
            
            # 计算批量处理状态
            failed_count = sum(1 for r in processed_responses if r.status == RequestStatus.FAILED)
            batch_status = RequestStatus.COMPLETED if failed_count == 0 else RequestStatus.PARTIAL
            
            total_time = (time.time() - start_time) * 1000
            
            return BatchIntentResponse(
                batch_id=batch_request.batch_id,
                status=batch_status,
                responses=processed_responses,
                total_count=len(batch_request.requests),
                success_count=len(processed_responses) - failed_count,
                failed_count=failed_count,
                total_processing_time=total_time,
                summary={
                    "total_requests": len(batch_request.requests),
                    "successful_requests": len(processed_responses) - failed_count,
                    "failed_requests": failed_count,
                    "processing_rate": (len(processed_responses) - failed_count) / len(batch_request.requests) * 100
                }
            )
            
        except Exception as e:
            total_time = (time.time() - start_time) * 1000
            self.logger.error(f"Error processing batch request {batch_request.batch_id}: {str(e)}")
            
            return BatchIntentResponse(
                batch_id=batch_request.batch_id,
                status=RequestStatus.FAILED,
                responses=[],
                total_count=len(batch_request.requests) if batch_request.requests else 0,
                success_count=0,
                failed_count=len(batch_request.requests) if batch_request.requests else 0,
                total_processing_time=total_time,
                summary={"error": "Batch processing failed"},
                error=str(e)
            )
    
    async def _execute_intent_recognition(self, request: IntentRequest) -> IntentResponse:
        """执行意图识别
        
        Args:
            request: 意图识别请求
            
        Returns:
            意图识别响应
        """
        # 在线程池中执行同步处理器
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            self.executor,
            self.intent_handler._run,
            request
        )
        return response
    
    def _validate_request(self, request: IntentRequest) -> Optional[str]:
        """验证请求
        
        Args:
            request: 意图识别请求
            
        Returns:
            错误信息（如果有）
        """
        if not request.text or not request.text.strip():
            return "Text field is required and cannot be empty"
        
        if len(request.text) > 10000:  # 限制文本长度
            return "Text length exceeds maximum limit (10000 characters)"
        
        if request.timeout and request.timeout <= 0:
            return "Timeout must be positive"
        
        return None
    
    async def extract_entities(self, text: str, user: Optional[User] = None) -> Dict[str, Any]:
        """提取实体
        
        Args:
            text: 输入文本
            user: 用户信息（可选）
            
        Returns:
            实体抽取结果
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                self.entity_handler._run,
                text
            )
            return result.dict()
        except Exception as e:
            self.logger.error(f"Error extracting entities: {str(e)}")
            raise
    
    async def match_rules(self, text: str, user: Optional[User] = None) -> Dict[str, Any]:
        """匹配规则
        
        Args:
            text: 输入文本
            user: 用户信息（可选）
            
        Returns:
            规则匹配结果
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                self.rule_handler._run,
                text
            )
            return result.dict()
        except Exception as e:
            self.logger.error(f"Error matching rules: {str(e)}")
            raise
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查
        
        Returns:
            健康检查结果
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                self.health_handler._run
            )
            return result.dict()
        except Exception as e:
            self.logger.error(f"Error in health check: {str(e)}")
            raise
    
    def get_handler_metrics(self) -> Dict[str, Dict[str, Any]]:
        """获取所有处理器的指标
        
        Returns:
            处理器指标字典
        """
        return {
            "intent_handler": self.intent_handler.get_metrics(),
            "entity_handler": self.entity_handler.get_metrics(),
            "rule_handler": self.rule_handler.get_metrics(),
            "health_handler": self.health_handler.get_metrics()
        }
    
    async def get_comprehensive_metrics(self) -> Dict[str, Any]:
        """获取综合指标
        
        Returns:
            综合指标字典
        """
        gateway_metrics = self.get_metrics()
        handler_metrics = self.get_handler_metrics()
        
        return {
            "gateway": gateway_metrics,
            "handlers": handler_metrics,
            "service_info": self.service_info.dict(),
            "timestamp": datetime.now().isoformat()
        }