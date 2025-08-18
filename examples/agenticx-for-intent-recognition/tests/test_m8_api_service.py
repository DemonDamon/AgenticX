"""M8 API Service Layer Tests

M8 API服务层的集成测试。
"""

import pytest
import asyncio
import json
from typing import Dict, Any
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient

from main import app
from models.api_models import (
    IntentRequest, IntentResponse, BatchIntentRequest, BatchIntentResponse,
    HealthCheckResponse, ServiceInfo, RequestStatus
)
from api.gateway import IntentServiceGateway
from api.handlers import IntentAPIHandler, EntityAPIHandler, RuleAPIHandler


class TestM8APIService:
    """M8 API服务层测试类"""
    
    def setup_method(self):
        """测试前设置"""
        # 手动初始化service_gateway，因为TestClient不会触发lifespan事件
        from main import service_gateway
        import main
        
        # 创建测试用的服务信息
        self.test_service_info = ServiceInfo(
            name="Test Intent Recognition Service",
            version="1.0.0-test",
            description="测试用意图识别服务",
            api_version="v1",
            endpoints=["/test"]
        )
        
        # 手动初始化全局service_gateway
        if main.service_gateway is None:
            main.service_gateway = IntentServiceGateway(self.test_service_info)
        
        self.client = TestClient(app)
    
    def test_service_info_creation(self):
        """测试服务信息创建"""
        service_info = ServiceInfo(
            name="Test Service",
            version="1.0.0",
            description="Test Description",
            api_version="v1",
            endpoints=["/test"]
        )
        
        assert service_info.name == "Test Service"
        assert service_info.version == "1.0.0"
        assert service_info.description == "Test Description"
        assert "/test" in service_info.endpoints
    
    def test_intent_request_validation(self):
        """测试意图请求验证"""
        # 有效请求
        valid_request = IntentRequest(
            text="你好，我想搜索一些信息",
            request_id="test_001"
        )
        assert valid_request.text == "你好，我想搜索一些信息"
        assert valid_request.request_id == "test_001"
        assert valid_request.enable_entity_extraction is True
        assert valid_request.enable_rule_matching is True
        
        # 测试默认值
        minimal_request = IntentRequest(text="测试文本")
        assert minimal_request.text == "测试文本"
        assert minimal_request.request_id is None
        assert minimal_request.timeout == 30.0
    
    def test_intent_api_handler(self):
        """测试意图API处理器"""
        handler = IntentAPIHandler()
        
        # 测试处理器基本属性
        assert handler.name == "IntentAPIHandler"
        assert "意图识别" in handler.description
        
        # 测试请求处理
        request = IntentRequest(
            text="我想搜索北京的天气",
            request_id="test_handler_001"
        )
        
        response = handler._run(request)
        
        assert isinstance(response, IntentResponse)
        assert response.request_id == "test_handler_001"
        assert response.status == RequestStatus.COMPLETED
        assert response.intent_result is not None
        assert response.intent_result.confidence > 0
        
        # 验证指标更新
        metrics = handler.get_metrics()
        assert metrics["request_count"] >= 1
        assert metrics["success_count"] >= 1
    
    def test_entity_api_handler(self):
        """测试实体API处理器"""
        handler = EntityAPIHandler()
        
        # 测试实体抽取
        result = handler._run("我想去北京旅游")
        
        assert result.extraction_method == "hybrid"
        assert result.confidence > 0
        assert len(result.entities) >= 0
        
        # 如果检测到北京，验证实体信息
        beijing_entities = [e for e in result.entities if e.text == "北京"]
        if beijing_entities:
            entity = beijing_entities[0]
            assert entity.label == "LOCATION"
            assert entity.confidence > 0
    
    def test_rule_api_handler(self):
        """测试规则API处理器"""
        handler = RuleAPIHandler()
        
        # 测试规则匹配
        result = handler._run("今天天气怎么样？")
        
        assert result.match_type == "keyword"
        assert result.confidence > 0
        assert "weather_rule" in result.matched_rules
        assert "time_rule" in result.matched_rules
    
    @pytest.mark.asyncio
    async def test_intent_service_gateway(self):
        """测试意图服务网关"""
        gateway = IntentServiceGateway(self.test_service_info)
        
        try:
            # 测试单个请求处理
            request = IntentRequest(
                text="我想搜索一些信息",
                request_id="gateway_test_001"
            )
            
            response = await gateway.process_intent_request(request)
            
            assert isinstance(response, IntentResponse)
            assert response.request_id == "gateway_test_001"
            assert response.status == RequestStatus.COMPLETED
            
            # 测试批量请求处理
            batch_request = BatchIntentRequest(
                batch_id="batch_test_001",
                requests=[
                    IntentRequest(text="搜索信息", request_id="batch_item_1"),
                    IntentRequest(text="查找资料", request_id="batch_item_2")
                ]
            )
            
            batch_response = await gateway.process_batch_request(batch_request)
            
            assert isinstance(batch_response, BatchIntentResponse)
            assert batch_response.batch_id == "batch_test_001"
            assert len(batch_response.responses) == 2
            
            # 测试实体抽取
            entity_result = await gateway.extract_entities("我想去北京")
            assert "entities" in entity_result
            
            # 测试规则匹配
            rule_result = await gateway.match_rules("今天天气如何？")
            assert "matched_rules" in rule_result
            
            # 测试健康检查
            health_result = await gateway.health_check()
            assert "status" in health_result
            
            # 测试指标获取
            metrics = await gateway.get_comprehensive_metrics()
            assert "gateway" in metrics
            assert "handlers" in metrics
            assert "service_info" in metrics
            
        finally:
            await gateway.shutdown()
    
    def test_health_check_endpoint(self):
        """测试健康检查端点"""
        response = self.client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "status" in data
        assert "version" in data
        assert "uptime" in data
        assert "components" in data
        assert "metrics" in data
    
    def test_metrics_endpoint(self):
        """测试指标端点"""
        response = self.client.get("/metrics")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "gateway" in data
        assert "handlers" in data
        assert "service_info" in data
        assert "timestamp" in data
    
    def test_service_info_endpoint(self):
        """测试服务信息端点"""
        response = self.client.get("/api/v1/service/info")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "name" in data
        assert "version" in data
        assert "description" in data
        assert "endpoints" in data
        assert isinstance(data["endpoints"], list)
    
    def test_intent_recognition_endpoint(self):
        """测试意图识别端点"""
        request_data = {
            "text": "我想搜索一些关于机器学习的资料",
            "request_id": "api_test_001",
            "enable_entity_extraction": True,
            "enable_rule_matching": True
        }
        
        response = self.client.post("/api/v1/intent/recognize", json=request_data)
        
        # 打印详细错误信息用于调试
        if response.status_code != 200:
            print(f"Status Code: {response.status_code}")
            print(f"Response: {response.text}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["request_id"] == "api_test_001"
        assert data["status"] == "completed"
        assert "intent_result" in data
        assert "total_processing_time" in data
        
        # 验证意图结果
        intent_result = data["intent_result"]
        assert "intent_type" in intent_result
        assert "intent_name" in intent_result
        assert "confidence" in intent_result
        assert intent_result["confidence"] > 0
    
    def test_batch_intent_recognition_endpoint(self):
        """测试批量意图识别端点"""
        batch_data = {
            "batch_id": "batch_api_test_001",
            "requests": [
                {
                    "text": "搜索信息",
                    "request_id": "batch_item_1"
                },
                {
                    "text": "查找资料",
                    "request_id": "batch_item_2"
                }
            ]
        }
        
        response = self.client.post("/api/v1/intent/batch", json=batch_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["batch_id"] == "batch_api_test_001"
        assert "responses" in data
        assert len(data["responses"]) == 2
        assert "summary" in data
        
        # 验证每个响应
        for i, response_item in enumerate(data["responses"]):
            assert response_item["request_id"] == f"batch_item_{i+1}"
            assert "intent_result" in response_item
    
    def test_entity_extraction_endpoint(self):
        """测试实体抽取端点"""
        request_data = {"text": "我想去北京旅游"}
        
        response = self.client.post("/api/v1/entity/extract", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "entities" in data
        assert "extraction_method" in data
        assert "confidence" in data
        assert "processing_time" in data
    
    def test_rule_matching_endpoint(self):
        """测试规则匹配端点"""
        request_data = {"text": "今天天气怎么样？"}
        
        response = self.client.post("/api/v1/rule/match", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "matched_rules" in data
        assert "match_type" in data
        assert "confidence" in data
        assert "processing_time" in data
    
    def test_invalid_request_validation(self):
        """测试无效请求验证"""
        # 空文本请求
        invalid_request = {"text": ""}
        response = self.client.post("/api/v1/intent/recognize", json=invalid_request)
        assert response.status_code == 422
        
        # 缺少文本字段的实体抽取请求
        response = self.client.post("/api/v1/entity/extract", json={})
        assert response.status_code == 400
        
        # 缺少文本字段的规则匹配请求
        response = self.client.post("/api/v1/rule/match", json={})
        assert response.status_code == 400
    
    def test_error_handling(self):
        """测试错误处理"""
        # 测试超长文本
        long_text = "a" * 20000
        request_data = {"text": long_text}
        
        response = self.client.post("/api/v1/intent/recognize", json=request_data)
        
        # 应该返回错误或处理成功（取决于实现）
        assert response.status_code in [200, 400, 422]
    
    @pytest.mark.asyncio
    async def test_concurrent_requests(self):
        """测试并发请求处理"""
        gateway = IntentServiceGateway(self.test_service_info)
        
        try:
            # 创建多个并发请求
            requests = [
                IntentRequest(
                    text=f"测试并发请求 {i}",
                    request_id=f"concurrent_test_{i}"
                )
                for i in range(5)
            ]
            
            # 并发执行
            tasks = [
                gateway.process_intent_request(request)
                for request in requests
            ]
            
            responses = await asyncio.gather(*tasks)
            
            # 验证所有响应
            assert len(responses) == 5
            for i, response in enumerate(responses):
                assert response.request_id == f"concurrent_test_{i}"
                assert response.status == RequestStatus.COMPLETED
            
        finally:
            await gateway.shutdown()
    
    def test_cors_headers(self):
        """测试CORS头部"""
        response = self.client.options("/health")
        
        # 检查CORS相关头部是否存在
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers
        assert "access-control-allow-headers" in response.headers


if __name__ == "__main__":
    # 运行测试
    pytest.main([__file__, "-v"])