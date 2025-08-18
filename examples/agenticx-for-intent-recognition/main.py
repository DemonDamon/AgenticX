"""M8 API Service Layer - Main Server

基于AgenticX Platform和FastAPI的意图识别API服务器。
"""

import asyncio
import logging
import uvicorn
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from agenticx.core.platform import User, Organization
from models.api_models import (
    IntentRequest, IntentResponse, BatchIntentRequest, BatchIntentResponse,
    HealthCheckResponse, ServiceInfo, RequestStatus
)
from api.gateway import IntentServiceGateway


# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 全局服务网关实例
service_gateway: Optional[IntentServiceGateway] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global service_gateway
    
    # 启动时初始化
    logger.info("Starting Intent Recognition API Service...")
    
    # 创建服务信息
    service_info = ServiceInfo(
        name="AgenticX Intent Recognition API",
        version="1.0.0",
        description="基于AgenticX框架的意图识别API服务",
        api_version="v1",
        endpoints=[
            "/api/v1/intent/recognize",
            "/api/v1/intent/batch",
            "/api/v1/entity/extract",
            "/api/v1/rule/match",
            "/health",
            "/metrics"
        ]
    )
    
    # 初始化服务网关
    service_gateway = IntentServiceGateway(service_info)
    logger.info(f"Service gateway initialized: {service_info.name}")
    
    yield
    
    # 关闭时清理
    logger.info("Shutting down Intent Recognition API Service...")
    if service_gateway:
        await service_gateway.shutdown()
    logger.info("Service shutdown completed")


# 创建FastAPI应用
app = FastAPI(
    title="AgenticX Intent Recognition API",
    description="基于AgenticX框架的意图识别API服务",
    version="1.0.0",
    lifespan=lifespan
)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境中应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 依赖注入函数
def get_service_gateway() -> IntentServiceGateway:
    """获取服务网关实例"""
    if service_gateway is None:
        raise HTTPException(status_code=503, detail="Service not available")
    return service_gateway


def get_current_user() -> Optional[User]:
    """获取当前用户（模拟实现）"""
    # 在实际项目中，这里应该从JWT token或session中获取用户信息
    return User(
        id="demo_user",
        username="demo_user",
        email="demo@example.com",
        full_name="Demo User",
        organization_id="demo_org"
    )


# API路由
@app.post("/api/v1/intent/recognize", response_model=IntentResponse)
async def recognize_intent(
    request: IntentRequest,
    gateway: IntentServiceGateway = Depends(get_service_gateway),
    user: Optional[User] = Depends(get_current_user)
) -> IntentResponse:
    """意图识别API
    
    处理单个文本的意图识别请求。
    """
    try:
        logger.info(f"Processing intent recognition request: {request.request_id}")
        response = await gateway.process_intent_request(request, user)
        
        # 检查验证错误
        if response.status == RequestStatus.FAILED and response.error_code == "VALIDATION_ERROR":
            raise HTTPException(status_code=422, detail=response.error)
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in intent recognition: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/intent/batch", response_model=BatchIntentResponse)
async def batch_recognize_intent(
    batch_request: BatchIntentRequest,
    background_tasks: BackgroundTasks,
    gateway: IntentServiceGateway = Depends(get_service_gateway),
    user: Optional[User] = Depends(get_current_user)
) -> BatchIntentResponse:
    """批量意图识别API
    
    处理多个文本的批量意图识别请求。
    """
    try:
        logger.info(f"Processing batch intent recognition: {batch_request.batch_id}")
        response = await gateway.process_batch_request(batch_request, user)
        return response
    except Exception as e:
        logger.error(f"Error in batch intent recognition: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/entity/extract")
async def extract_entities(
    request: Dict[str, str],
    gateway: IntentServiceGateway = Depends(get_service_gateway),
    user: Optional[User] = Depends(get_current_user)
) -> Dict[str, Any]:
    """实体抽取API
    
    从文本中抽取命名实体。
    """
    try:
        text = request.get("text")
        if not text:
            raise HTTPException(status_code=400, detail="Text field is required")
        
        logger.info(f"Processing entity extraction for user: {user.id if user else 'anonymous'}")
        result = await gateway.extract_entities(text, user)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in entity extraction: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/rule/match")
async def match_rules(
    request: Dict[str, str],
    gateway: IntentServiceGateway = Depends(get_service_gateway),
    user: Optional[User] = Depends(get_current_user)
) -> Dict[str, Any]:
    """规则匹配API
    
    根据预定义规则匹配文本。
    """
    try:
        text = request.get("text")
        if not text:
            raise HTTPException(status_code=400, detail="Text field is required")
        
        logger.info(f"Processing rule matching for user: {user.id if user else 'anonymous'}")
        result = await gateway.match_rules(text, user)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in rule matching: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", response_model=HealthCheckResponse)
async def health_check(
    gateway: IntentServiceGateway = Depends(get_service_gateway)
) -> HealthCheckResponse:
    """健康检查API
    
    检查服务健康状态和各组件状态。
    """
    try:
        result = await gateway.health_check()
        return HealthCheckResponse(**result)
    except Exception as e:
        logger.error(f"Error in health check: {str(e)}")
        return HealthCheckResponse(
            status="unhealthy",
            version="1.0.0",
            uptime=0,
            components={"error": str(e)},
            metrics={}
        )


@app.options("/health")
async def health_check_options():
    """处理健康检查的OPTIONS请求"""
    from fastapi.responses import JSONResponse
    
    response = JSONResponse({"message": "OK"})
    response.headers["access-control-allow-origin"] = "*"
    response.headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["access-control-allow-headers"] = "*"
    response.headers["access-control-allow-credentials"] = "true"
    return response


@app.get("/metrics")
async def get_metrics(
    gateway: IntentServiceGateway = Depends(get_service_gateway)
) -> Dict[str, Any]:
    """获取服务指标API
    
    返回详细的服务性能指标。
    """
    try:
        metrics = await gateway.get_comprehensive_metrics()
        return metrics
    except Exception as e:
        logger.error(f"Error getting metrics: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/service/info")
async def get_service_info(
    gateway: IntentServiceGateway = Depends(get_service_gateway)
) -> ServiceInfo:
    """获取服务信息API
    
    返回服务的基本信息和可用端点。
    """
    try:
        return gateway.get_service_info()
    except Exception as e:
        logger.error(f"Error getting service info: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# 异常处理器
@app.exception_handler(ValidationError)
async def validation_exception_handler(request, exc: ValidationError):
    """处理Pydantic验证错误"""
    logger.warning(f"Validation error: {exc}")
    return JSONResponse(
        status_code=422,
        content={
            "error": "Validation Error",
            "details": exc.errors()
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    """处理一般异常"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": str(exc)
        }
    )


def main():
    """主函数 - 启动API服务器"""
    logger.info("Starting AgenticX Intent Recognition API Server...")
    
    # 启动服务器
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发模式，生产环境应设为False
        log_level="info"
    )


if __name__ == "__main__":
    main()