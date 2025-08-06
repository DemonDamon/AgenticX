# AgenticX意图理解与规划智能体实现文档

## 1. 实现概述

本文档描述了AgenticX意图理解与规划智能体的具体实现方案。该智能体作为现有FastAPI后端意图识别服务的增强层，基于AgenticX框架构建，在保持现有三层意图识别架构的基础上，增加记忆管理、智能编排和工具扩展能力。

### 1.1 技术架构

系统采用增强层架构设计：

* **AgenticX增强层**: 记忆管理 + 工作流编排 + 工具扩展 + 观察性增强

* **现有后端层**: FastAPI + HandlerFactory + Pipeline处理 + 异步执行

* **集成层**: 直接API集成 + 数据结构兼容 + 现有模型复用

* **基础设施层**: 现有基础设施 + AgenticX增强组件

# AgenticX意图理解与规划智能体实现指南

## 1. 核心智能体架构实现

### 1.1 IntentUnderstandingEngine

```python
from typing import Dict, List, Optional, Tuple, Any
from agenticx import Agent, Tool
from .existing_handlers import HandlerFactory, Pipeline
from .models import RequestParams, ResponseData, IntentEntity, IntentionInfo
from .internal_services import LLMService, RulesEngine, WorkflowOrchestrator
import asyncio
import logging

class IntentUnderstandingEngine(Agent):
    """意图理解增强引擎，集成现有三层意图识别架构"""
    
    def __init__(self, config: Dict):
        super().__init__(name="intent_understanding_agent")
        self.handler_factory = HandlerFactory()
        self.pipeline = Pipeline()
        self.llm_service = LLMService(config.get("llm_config", {}))
        self.rules_engine = RulesEngine(config.get("rules_config", {}))
        self.workflow_orchestrator = WorkflowOrchestrator(config.get("workflow_config", {}))
        self.confidence_threshold = config.get("confidence_threshold", 0.7)
        self.logger = logging.getLogger(__name__)
        
    async def understand_intent(self, request: RequestParams) -> ResponseData:
        """增强的意图理解主流程"""
        try:
            # 1. 调用现有意图识别流程
            intent_result = await self._call_existing_intent_pipeline(request)
            
            # 2. 澄清需求判断
            clarification_needed = self._check_clarification_needed(intent_result)
            
            if clarification_needed:
                clarify_query = await self._generate_clarification_query(intent_result, request)
                return ResponseData(
                    **intent_result.dict(),
                    isNeedClarify=True,
                    clarifyQuery=clarify_query
                )
            
            # 3. AgenticX智能编排
            enhanced_result = await self._orchestrate_with_agenticx(intent_result, request)
            
            return ResponseData(
                **enhanced_result.dict(),
                isNeedClarify=False,
                clarifyQuery=""
            )
            
        except Exception as e:
            self.logger.error(f"Intent understanding failed: {str(e)}")
            return self._create_fallback_response(request, str(e))
    
    async def _call_existing_intent_pipeline(self, request: RequestParams) -> ResponseData:
        """调用现有的三层意图识别流程"""
        # 使用现有的HandlerFactory和Pipeline
        handler = self.handler_factory.create_handler(request)
        result = await self.pipeline.process(handler, request)
        return result
    
    def _check_clarification_needed(self, intent_result: ResponseData) -> bool:
        """检查是否需要澄清"""
        # 检查整体置信度
        if hasattr(intent_result, 'confidence'):
            if intent_result.confidence < self.confidence_threshold:
                return True
        
        # 检查意图信息的置信度和实体完整性
        if hasattr(intent_result, 'intentionInfo') and intent_result.intentionInfo:
            for intention in intent_result.intentionInfo:
                # 检查意图置信度
                if hasattr(intention, 'confidence') and intention.confidence < self.confidence_threshold:
                    return True
                
                # 检查关键实体缺失
                if intention.intentType in ['search', 'function']:
                    if not intention.entities or len(intention.entities) == 0:
                        return True
                    
                    # 检查实体置信度
                    for entity in intention.entities:
                        if hasattr(entity, 'confidence') and entity.confidence < self.confidence_threshold:
                            return True
        
        return False
    
    async def _generate_clarification_query(self, intent_result: ResponseData, request: RequestParams) -> str:
        """生成澄清问题"""
        try:
            # 构建澄清提示
            clarification_prompt = self._build_clarification_prompt(intent_result, request)
            
            # 调用内部LLM服务生成澄清问题
            llm_request = {
                "model_type": "clarify",
                "input_text": clarification_prompt,
                "parameters": {"temperature": 0.7, "max_tokens": 200}
            }
            
            clarify_response = await self.llm_service.generate(llm_request)
            
            if clarify_response and "result" in clarify_response:
                return clarify_response["result"]
            else:
                return self._get_fallback_clarification(intent_result)
                
        except Exception as e:
            self.logger.error(f"Clarification generation failed: {str(e)}")
            return self._get_fallback_clarification(intent_result)
    
    def _build_clarification_prompt(self, intent_result: ResponseData, request: RequestParams) -> str:
        """构建澄清提示"""
        user_input = request.dialogueInfo.userInput if request.dialogueInfo else "用户输入"
        
        prompt_parts = [
            f"用户输入：{user_input}",
            "\n当前意图识别结果存在以下问题："
        ]
        
        # 分析具体问题
        if hasattr(intent_result, 'intentionInfo') and intent_result.intentionInfo:
            for i, intention in enumerate(intent_result.intentionInfo):
                if hasattr(intention, 'confidence') and intention.confidence < self.confidence_threshold:
                    prompt_parts.append(f"- 意图{i+1}置信度较低({intention.confidence:.2f})")
                
                if intention.intentType in ['search', 'function'] and (not intention.entities or len(intention.entities) == 0):
                    prompt_parts.append(f"- 意图{i+1}缺少关键实体信息")
        
        prompt_parts.extend([
            "\n请生成一个友好、友好的澄清问题，帮助用户提供更准确的信息。",
            "要求：",
            "1. 语言自然流畅",
            "2. 针对具体缺失信息",
            "3. 不超过50字",
            "4. 提供具体的引导",
            "\n澄清问题："
        ])
        
        return "\n".join(prompt_parts)
    
    def _get_fallback_clarification(self, intent_result: ResponseData) -> str:
        """获取备用澄清问题"""
        fallback_questions = [
            "请提供更多详细信息，以便我更好地理解您的需求。",
            "您能具体说明一下您想要什么吗？",
            "请补充一些关键信息，比如具体的对象或目标。",
            "您的需求不够明确，能否提供更多背景信息？"
        ]
        
        # 根据意图类型选择合适的备用问题
        if hasattr(intent_result, 'intentionInfo') and intent_result.intentionInfo:
            for intention in intent_result.intentionInfo:
                if intention.intentType == 'search':
                    return "您想搜索什么内容？请提供更具体的关键词。"
                elif intention.intentType == 'function':
                    return "您想执行什么操作？请提供更详细的参数信息。"
        
        return fallback_questions[0]
    
    async def _orchestrate_with_agenticx(self, intent_result: ResponseData, request: RequestParams) -> ResponseData:
        """使用AgenticX进行智能编排"""
        try:
            # 工作流规划
            workflow_plan = await self.workflow_orchestrator.plan_workflow(
                intent_result=intent_result.dict(),
                context=request.dict()
            )
            
            # 增强工具对象
            enhanced_tools = await self._enhance_tools(intent_result)
            
            # 更新结果
            enhanced_result = intent_result.copy(deep=True)
            if hasattr(enhanced_result, 'toolObject') and enhanced_result.toolObject:
                enhanced_result.toolObject.extend(enhanced_tools)
            
            return enhanced_result
            
        except Exception as e:
            self.logger.error(f"AgenticX orchestration failed: {str(e)}")
            return intent_result
    
    async def _enhance_tools(self, intent_result: ResponseData) -> List[Dict[str, Any]]:
        """增强工具对象"""
        enhanced_tools = []
        
        if hasattr(intent_result, 'intentionInfo') and intent_result.intentionInfo:
            for intention in intent_result.intentionInfo:
                if intention.intentType == 'function' and intention.entities:
                    # 基于实体信息生成增强工具
                    tool_enhancement = await self._generate_tool_enhancement(intention)
                    if tool_enhancement:
                        enhanced_tools.append(tool_enhancement)
        
        return enhanced_tools
    
    async def _generate_tool_enhancement(self, intention: IntentionInfo) -> Optional[Dict[str, Any]]:
        """生成工具增强"""
        try:
            # 使用规则引擎分析工具需求
            rule_request = {
                "rule_type": "tool_enhancement",
                "input_data": {
                    "intent_type": intention.intentType,
                    "entities": [entity.dict() for entity in intention.entities] if intention.entities else []
                }
            }
            
            rule_response = await self.rules_engine.process(rule_request)
            
            if rule_response and "result" in rule_response:
                return rule_response["result"]
            
        except Exception as e:
            self.logger.error(f"Tool enhancement generation failed: {str(e)}")
        
        return None
    
    def _create_fallback_response(self, request: RequestParams, error_msg: str) -> ResponseData:
        """创建备用响应"""
        return ResponseData(
            intentionInfo=[],
            toolObject=[],
            contentRecommend=[],
            isNeedClarify=True,
            clarifyQuery="抱歉，处理您的请求时遇到了问题，请重新描述您的需求。"
        )
```

### 1.2 内部服务实现

```python
from typing import Dict, List, Any, Optional
from abc import ABC, abstractmethod
import aiohttp
import json
import logging

class LLMService:
    """大模型服务"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.models = config.get("models", {})
        self.logger = logging.getLogger(__name__)
    
    async def generate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """生成内容"""
        model_type = request.get("model_type")
        input_text = request.get("input_text")
        parameters = request.get("parameters", {})
        
        if model_type not in self.models:
            raise ValueError(f"Unsupported model type: {model_type}")
        
        model_config = self.models[model_type]
        
        if model_type in ["lora1", "lora2", "lora3"]:
            # 本地LoRA模型推理
            return await self._call_local_model(model_config, input_text, parameters)
        elif model_type == "clarify":
            # 外部API调用
            return await self._call_external_api(model_config, input_text, parameters)
        else:
            raise ValueError(f"Unknown model type: {model_type}")
    
    async def _call_local_model(self, model_config: Dict, input_text: str, parameters: Dict) -> Dict[str, Any]:
        """调用本地模型"""
        # 这里应该集成现有的LoRA模型推理逻辑
        # 暂时返回模拟结果
        return {
            "result": f"Local model result for: {input_text}",
            "confidence": 0.85,
            "processing_time": 0.1
        }
    
    async def _call_external_api(self, model_config: Dict, input_text: str, parameters: Dict) -> Dict[str, Any]:
        """调用外部API"""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": model_config.get("model", "gpt-3.5-turbo"),
                    "messages": [{"role": "user", "content": input_text}],
                    "max_tokens": parameters.get("max_tokens", model_config.get("max_tokens", 200)),
                    "temperature": parameters.get("temperature", model_config.get("temperature", 0.7))
                }
                
                headers = {
                    "Authorization": f"Bearer {model_config.get('api_key')}",
                    "Content-Type": "application/json"
                }
                
                async with session.post(
                    model_config.get("api_endpoint"),
                    json=payload,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        content = data["choices"][0]["message"]["content"]
                        return {
                            "result": content,
                            "confidence": 0.9,
                            "processing_time": 0.5
                        }
                    else:
                        raise Exception(f"API call failed: {response.status}")
                        
        except Exception as e:
            self.logger.error(f"External API call failed: {str(e)}")
            raise

class RulesEngine:
    """规则引擎"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.confidence_threshold = config.get("confidence_threshold", 0.7)
        self.rules = self._load_rules(config)
        self.logger = logging.getLogger(__name__)
    
    def _load_rules(self, config: Dict) -> Dict[str, Any]:
        """加载规则配置"""
        # 这里应该从配置文件加载规则
        return {
            "entity_extraction": {
                "patterns": [],
                "confidence_boost": 0.1
            },
            "intent_fusion": {
                "fusion_rules": [],
                "conflict_resolution": "highest_confidence"
            },
            "tool_enhancement": {
                "enhancement_rules": []
            }
        }
    
    async def process(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理规则"""
        rule_type = request.get("rule_type")
        input_data = request.get("input_data")
        context = request.get("context", {})
        
        if rule_type == "entity_extraction":
            return await self._process_entity_extraction(input_data, context)
        elif rule_type == "intent_fusion":
            return await self._process_intent_fusion(input_data, context)
        elif rule_type == "tool_enhancement":
            return await self._process_tool_enhancement(input_data, context)
        else:
            raise ValueError(f"Unsupported rule type: {rule_type}")
    
    async def _process_entity_extraction(self, input_data: Dict, context: Dict) -> Dict[str, Any]:
        """处理实体抽取规则"""
        # 实现实体抽取增强逻辑
        return {
            "result": {"enhanced_entities": []},
            "applied_rules": ["entity_pattern_matching"],
            "confidence": 0.8
        }
    
    async def _process_intent_fusion(self, input_data: Dict, context: Dict) -> Dict[str, Any]:
        """处理意图融合规则"""
        # 实现意图融合逻辑
        return {
            "result": {"fused_intent": input_data},
            "applied_rules": ["confidence_based_fusion"],
            "confidence": 0.85
        }
    
    async def _process_tool_enhancement(self, input_data: Dict, context: Dict) -> Dict[str, Any]:
        """处理工具增强规则"""
        intent_type = input_data.get("intent_type")
        entities = input_data.get("entities", [])
        
        if intent_type == "function" and entities:
            # 基于实体生成工具增强
            enhanced_tool = {
                "toolName": f"enhanced_{intent_type}_tool",
                "parameters": {entity["type"]: entity["value"] for entity in entities if "type" in entity and "value" in entity},
                "confidence": 0.9
            }
            
            return {
                "result": enhanced_tool,
                "applied_rules": ["entity_based_tool_enhancement"],
                "confidence": 0.9
            }
        
        return {
            "result": None,
            "applied_rules": [],
            "confidence": 0.0
        }

class WorkflowOrchestrator:
    """工作流编排器"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.max_parallel_tasks = config.get("max_parallel_tasks", 5)
        self.timeout_seconds = config.get("timeout_seconds", 30)
        self.retry_attempts = config.get("retry_attempts", 3)
        self.logger = logging.getLogger(__name__)
    
    async def plan_workflow(self, intent_result: Dict, context: Dict) -> Dict[str, Any]:
        """规划工作流"""
        try:
            # 分析意图结果
            intentions = intent_result.get("intentionInfo", [])
            
            if not intentions:
                return {"workflow_plan": [], "estimated_duration": 0, "dependencies": {}}
            
            # 生成工作流计划
            workflow_plan = []
            dependencies = {}
            total_duration = 0
            
            for i, intention in enumerate(intentions):
                task = {
                    "task_id": f"task_{i}",
                    "intent_type": intention.get("intentType"),
                    "entities": intention.get("entities", []),
                    "estimated_duration": self._estimate_task_duration(intention),
                    "priority": self._calculate_priority(intention)
                }
                
                workflow_plan.append(task)
                total_duration += task["estimated_duration"]
                
                # 分析任务依赖
                if i > 0:
                    dependencies[task["task_id"]] = [f"task_{j}" for j in range(i)]
            
            return {
                "workflow_plan": workflow_plan,
                "estimated_duration": total_duration,
                "dependencies": dependencies
            }
            
        except Exception as e:
            self.logger.error(f"Workflow planning failed: {str(e)}")
            return {"workflow_plan": [], "estimated_duration": 0, "dependencies": {}}
    
    def _estimate_task_duration(self, intention: Dict) -> float:
        """估算任务持续时间"""
        intent_type = intention.get("intentType", "unknown")
        
        duration_map = {
            "search": 2.0,
            "function": 5.0,
            "chat": 1.0
        }
        
        return duration_map.get(intent_type, 3.0)
    
    def _calculate_priority(self, intention: Dict) -> int:
        """计算任务优先级"""
        intent_type = intention.get("intentType", "unknown")
        confidence = intention.get("confidence", 0.5)
        
        # 基于意图类型和置信度计算优先级
        base_priority = {
            "function": 10,
            "search": 8,
            "chat": 5
        }.get(intent_type, 5)
        
        # 置信度调整
        confidence_bonus = int(confidence * 5)
        
        return base_priority + confidence_bonus
```

## 2. FastAPI集成实现

### 2.1 主应用入口

```python
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .intent_understanding_engine import IntentUnderstandingEngine
from .models import RequestParams, ResponseData
from .config import load_config
import logging
import uvicorn

# 全局变量
intent_engine: Optional[IntentUnderstandingEngine] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global intent_engine
    
    # 启动时初始化
    try:
        config = load_config()
        intent_engine = IntentUnderstandingEngine(config)
        logging.info("Intent Understanding Engine initialized successfully")
        yield
    except Exception as e:
        logging.error(f"Failed to initialize Intent Understanding Engine: {str(e)}")
        raise
    finally:
        # 清理资源
        if intent_engine:
            await intent_engine.cleanup()
        logging.info("Intent Understanding Engine cleaned up")

# 创建FastAPI应用
app = FastAPI(
    title="AgenticX Intent Understanding Service",
    description="增强的意图理解算法服务",
    version="1.0.0",
    lifespan=lifespan
)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 依赖注入
def get_intent_engine() -> IntentUnderstandingEngine:
    if intent_engine is None:
        raise HTTPException(status_code=503, detail="Intent engine not initialized")
    return intent_engine

@app.post("/agenticx/intent", response_model=ResponseData)
async def understand_intent(
    request: RequestParams,
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
) -> ResponseData:
    """增强意图识别接口"""
    try:
        result = await engine.understand_intent(request)
        return result
    except Exception as e:
        logging.error(f"Intent understanding failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Intent understanding failed: {str(e)}")

@app.post("/agenticx/clarify")
async def generate_clarification(
    request: dict,
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
) -> dict:
    """智能澄清接口"""
    try:
        intent_result = ResponseData(**request.get("intent_result", {}))
        request_params = RequestParams(**request.get("request_params", {}))
        
        clarify_query = await engine._generate_clarification_query(intent_result, request_params)
        
        return {
            "clarifyQuery": clarify_query,
            "isNeedClarify": True,
            "clarificationType": "entity_missing" if not intent_result.intentionInfo else "low_confidence"
        }
    except Exception as e:
        logging.error(f"Clarification generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Clarification generation failed: {str(e)}")

@app.post("/agenticx/workflow")
async def plan_workflow(
    request: dict,
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
) -> dict:
    """工作流规划接口"""
    try:
        intent_result = request.get("intent_result", {})
        context = request.get("context", {})
        
        workflow_plan = await engine.workflow_orchestrator.plan_workflow(intent_result, context)
        
        return workflow_plan
    except Exception as e:
        logging.error(f"Workflow planning failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Workflow planning failed: {str(e)}")

@app.post("/internal/llm/generate")
async def internal_llm_generate(
    request: dict,
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
) -> dict:
    """内部大模型服务接口"""
    try:
        result = await engine.llm_service.generate(request)
        return result
    except Exception as e:
        logging.error(f"LLM generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {str(e)}")

@app.post("/internal/rules/process")
async def internal_rules_process(
    request: dict,
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
) -> dict:
    """内部规则引擎接口"""
    try:
        result = await engine.rules_engine.process(request)
        return result
    except Exception as e:
        logging.error(f"Rules processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Rules processing failed: {str(e)}")

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "service": "AgenticX Intent Understanding"}

@app.get("/metrics")
async def get_metrics(
    engine: IntentUnderstandingEngine = Depends(get_intent_engine)
):
    """监控指标接口"""
    # 这里可以返回性能指标
    return {
        "requests_processed": 0,  # 实际应该从监控系统获取
        "average_response_time": 0.0,
        "error_rate": 0.0,
        "model_status": "healthy"
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )
```

### 2.2 配置管理实现

```python
from typing import Dict, Any
from pydantic import BaseSettings, Field
from pathlib import Path
import yaml
import os

class AgenticXConfig(BaseSettings):
    """AgenticX配置类"""
    
    # 服务配置
    service_name: str = Field(default="agenticx-intent-understanding", env="SERVICE_NAME")
    service_port: int = Field(default=8000, env="SERVICE_PORT")
    service_host: str = Field(default="0.0.0.0", env="SERVICE_HOST")
    
    # 模型配置
    confidence_threshold: float = Field(default=0.7, env="CONFIDENCE_THRESHOLD")
    
    # LLM服务配置
    llm_config: Dict[str, Any] = Field(default_factory=dict)
    
    # 规则引擎配置
    rules_config: Dict[str, Any] = Field(default_factory=dict)
    
    # 工作流配置
    workflow_config: Dict[str, Any] = Field(default_factory=dict)
    
    # 日志配置
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_format: str = Field(default="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    
    class Config:
        env_file = ".env"
        case_sensitive = False

def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载配置文件"""
    config = {}
    
    # 加载YAML配置文件
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            yaml_config = yaml.safe_load(f)
            config.update(yaml_config)
    
    # 加载环境变量配置
    env_config = AgenticXConfig()
    config.update({
        "service_name": env_config.service_name,
        "service_port": env_config.service_port,
        "service_host": env_config.service_host,
        "confidence_threshold": env_config.confidence_threshold,
        "log_level": env_config.log_level,
        "log_format": env_config.log_format
    })
    
    # 合并配置
    if "llm_config" not in config:
        config["llm_config"] = env_config.llm_config
    if "rules_config" not in config:
        config["rules_config"] = env_config.rules_config
    if "workflow_config" not in config:
        config["workflow_config"] = env_config.workflow_config
    
    return config

def setup_logging(config: Dict[str, Any]):
    """设置日志配置"""
    import logging
    
    log_level = config.get("log_level", "INFO")
    log_format = config.get("log_format", "%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format=log_format,
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("agenticx_intent.log")
        ]
    )
    
    # 设置第三方库日志级别
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("fastapi").setLevel(logging.INFO)
```

### 1.1 主智能体类设计

```python
from agenticx.core.agent import Agent
from agenticx.core.workflow import Workflow
from agenticx.memory import HierarchicalMemoryManager
from agenticx.tools import ToolExecutor
from agenticx.observability import MonitoringCallbackHandler
from typing import Dict, List, Any, Optional
import asyncio

class IntentUnderstandingAgent(Agent):
    """
    基于AgenticX的意图理解与规划智能体
    整合三个LoRA模型实现分层意图识别和智能规划
    """
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(name="IntentUnderstandingAgent", config=config)
        
        # 初始化AgenticX核心组件
        self.memory_manager = HierarchicalMemoryManager(
            tenant_id=config.get("tenant_id", "default"),
            config=config.get("memory_config", {})
        )
        
        self.tool_executor = ToolExecutor(
            config=config.get("tool_config", {})
        )
        
        self.monitoring = MonitoringCallbackHandler(
            config=config.get("monitoring_config", {})
        )
        
        # 初始化意图理解组件
        self.intent_engine = IntentUnderstandingEngine(config)
        self.planning_engine = WorkflowPlanningEngine(config)
        self.execution_coordinator = ExecutionCoordinator(config)
        
    async def process_user_input(self, 
                                user_input: str, 
                                user_id: str, 
                                context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        处理用户输入的主要入口点
        """
        # 记录用户输入到记忆系统
        await self.memory_manager.store_interaction(
            user_id=user_id,
            input_text=user_input,
            context=context or {}
        )
        
        # 意图理解阶段
        intent_result = await self.intent_engine.analyze_intent(
            input_text=user_input,
            user_context=await self.memory_manager.get_user_context(user_id),
            session_context=context
        )
        
        # 澄清判断阶段
        clarification_result = await self.intent_engine.check_clarification_needed(
            intent_result=intent_result,
            user_context=await self.memory_manager.get_user_context(user_id)
        )
        
        # 如果需要澄清，直接返回澄清内容
        if clarification_result["is_need_clarify"]:
            return {
                "intent_analysis": intent_result,
                "is_need_clarify": True,
                "clarify_query": clarification_result["clarify_query"],
                "clarify_reason": clarification_result["clarify_reason"],
                "suggestions": clarification_result.get("suggestions", []),
                "execution_plan": None,
                "execution_result": None,
                "session_id": context.get("session_id") if context else None
            }
        
        # 规划生成阶段（仅在不需要澄清时执行）
        execution_plan = await self.planning_engine.generate_plan(
            intentions=intent_result["intentions"],
            entities=intent_result["entities"],
            user_context=await self.memory_manager.get_user_context(user_id)
        )
        
        # 执行协调阶段
        execution_result = await self.execution_coordinator.execute_plan(
            plan=execution_plan,
            tool_executor=self.tool_executor,
            monitoring=self.monitoring
        )
        
        # 更新记忆系统
        await self.memory_manager.store_result(
            user_id=user_id,
            intent_result=intent_result,
            execution_plan=execution_plan,
            execution_result=execution_result
        )
        
        return {
            "intent_analysis": intent_result,
            "execution_plan": execution_plan,
            "execution_result": execution_result,
            "session_id": context.get("session_id") if context else None
        }
```

### 1.2 意图理解引擎实现

```python
from agenticx.llms import LiteLLMProvider
from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest
import json
import asyncio
from typing import Dict, List, Any

class IntentUnderstandingEngine:
    """
    意图理解引擎，整合三个LoRA模型
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        
        # 初始化vLLM引擎
        self.vllm_engine = LLM(
            model=config["base_model_path"],
            enable_lora=True,
            max_lora_rank=config.get("max_lora_rank", 64),
            gpu_memory_utilization=config.get("gpu_memory_utilization", 0.8)
        )
        
        # LoRA模型配置
        self.lora_configs = {
            "level1_intent": LoRARequest(
                lora_name="level1_intent",
                lora_int_id=1,
                lora_path=config["level1_lora_path"]
            ),
            "search_intent": LoRARequest(
                lora_name="search_intent", 
                lora_int_id=2,
                lora_path=config["search_lora_path"]
            ),
            "tool_intent": LoRARequest(
                lora_name="tool_intent",
                lora_int_id=3, 
                lora_path=config["tool_lora_path"]
            )
        }
        
        # 采样参数
        self.sampling_params = SamplingParams(
            temperature=config.get("temperature", 0.1),
            top_p=config.get("top_p", 0.9),
            max_tokens=config.get("max_tokens", 512)
        )
        
        # 实体抽取器
        self.entity_extractor = EntityExtractor(config)
        
    async def analyze_intent(self, 
                           input_text: str, 
                           user_context: Dict, 
                           session_context: Dict) -> Dict[str, Any]:
        """
        分层意图分析主流程
        """
        # 第一级：基础意图分类
        level1_result = await self._classify_level1_intent(
            input_text, user_context, session_context
        )
        
        # 根据一级意图结果决定是否进行二级分类
        level2_results = []
        
        if self._needs_search_classification(level1_result):
            search_result = await self._classify_search_intent(
                input_text, user_context, session_context
            )
            level2_results.append(search_result)
            
        if self._needs_tool_classification(level1_result):
            tool_result = await self._classify_tool_intent(
                input_text, user_context, session_context
            )
            level2_results.append(tool_result)
        
        # 实体抽取
        entities = await self.entity_extractor.extract_entities(
            input_text, level1_result, level2_results
        )
        
        # 意图融合和后处理
        final_result = await self._merge_and_postprocess(
            level1_result, level2_results, entities
        )
        
        return final_result
    
    async def check_clarification_needed(self, 
                                       intent_result: Dict[str, Any],
                                       user_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        检查是否需要澄清并生成澄清内容
        """
        # 置信度检查
        confidence_threshold = self.config.get("clarification_confidence_threshold", 0.7)
        max_confidence = max([intent["confidence"] for intent in intent_result["intentions"]])
        
        # 实体完整性检查
        required_entities = self._get_required_entities(intent_result["intentions"])
        missing_entities = self._check_missing_entities(intent_result["entities"], required_entities)
        
        # 判断是否需要澄清
        needs_clarification = (
            max_confidence < confidence_threshold or 
            len(missing_entities) > 0
        )
        
        if not needs_clarification:
            return {"is_need_clarify": False}
        
        # 生成澄清内容
        clarify_query = await self._generate_clarification_query(
            intent_result=intent_result,
            missing_entities=missing_entities,
            confidence_score=max_confidence,
            user_context=user_context
        )
        
        return {
            "is_need_clarify": True,
            "clarify_query": clarify_query["query"],
            "clarify_reason": clarify_query["reason"],
            "suggestions": clarify_query.get("suggestions", []),
            "missing_entities": missing_entities,
            "confidence_analysis": {
                "threshold": confidence_threshold,
                "actual": max_confidence,
                "reason": "置信度低于阈值" if max_confidence < confidence_threshold else "实体缺失"
            }
        }
    
    async def _generate_clarification_query(self, 
                                           intent_result: Dict[str, Any],
                                           missing_entities: List[str],
                                           confidence_score: float,
                                           user_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        使用大模型生成澄清问题
        """
        # 构建澄清提示词
        clarification_prompt = self._build_clarification_prompt(
            intent_result, missing_entities, confidence_score, user_context
        )
        
        # 调用大模型生成澄清内容
        clarification_response = await self.vllm_engine.generate(
            prompts=[clarification_prompt],
            sampling_params=self.sampling_params
        )
        
        # 解析生成结果
        try:
            clarify_content = json.loads(clarification_response[0].outputs[0].text)
            return {
                "query": clarify_content.get("clarify_query", "请提供更多信息以便我更好地理解您的需求。"),
                "reason": clarify_content.get("reason", "需要更多信息"),
                "suggestions": clarify_content.get("suggestions", [])
            }
        except json.JSONDecodeError:
            # 降级处理
            return self._generate_fallback_clarification(missing_entities, confidence_score)
    
    def _build_clarification_prompt(self, 
                                  intent_result: Dict[str, Any],
                                  missing_entities: List[str],
                                  confidence_score: float,
                                  user_context: Dict[str, Any]) -> str:
        """
        构建澄清提示词
        """
        prompt = f"""
你是一个智能助手，需要基于用户的意图识别结果生成澄清问题。

用户意图识别结果：
{json.dumps(intent_result, ensure_ascii=False, indent=2)}

缺失的实体：{missing_entities}
置信度：{confidence_score}
用户上下文：{json.dumps(user_context, ensure_ascii=False, indent=2)}

请生成一个友好、具体的澄清问题，帮助用户明确他们的需求。

返回JSON格式：
{{
    "clarify_query": "澄清问题内容",
    "reason": "需要澄清的原因",
    "suggestions": ["建议选项1", "建议选项2", "建议选项3"]
}}
"""
        return prompt
    
    def _generate_fallback_clarification(self, 
                                       missing_entities: List[str],
                                       confidence_score: float) -> Dict[str, Any]:
        """
        降级澄清生成
        """
        if missing_entities:
            entity_names = ", ".join(missing_entities)
            return {
                "query": f"为了更好地帮助您，请提供更多关于{entity_names}的信息。",
                "reason": f"缺失必要信息：{entity_names}",
                "suggestions": []
            }
        else:
            return {
                "query": "您的需求不够明确，请提供更多详细信息。",
                "reason": f"置信度过低：{confidence_score}",
                "suggestions": []
            }
    
    def _get_required_entities(self, intentions: List[Dict[str, Any]]) -> List[str]:
        """
        根据意图类型获取必需的实体
        """
        required_entities = []
        for intent in intentions:
            intent_type = intent.get("type")
            if intent_type == "search":
                required_entities.extend(["keywords", "document_type"])
            elif intent_type == "tool":
                required_entities.extend(["tool_name", "parameters"])
            # 可以根据具体业务需求扩展
        return list(set(required_entities))
    
    def _check_missing_entities(self, 
                              extracted_entities: Dict[str, Any],
                              required_entities: List[str]) -> List[str]:
        """
        检查缺失的实体
        """
        missing = []
        for entity in required_entities:
            if entity not in extracted_entities or not extracted_entities[entity]:
                missing.append(entity)
        return missing
    async def _merge_and_postprocess(self,
                                    level1_result: Dict,
                                    level2_results: List[Dict],
                                    entities: Dict) -> Dict[str, Any]:
        """
        意图融合和后处理
        """
        final_intentions = self._merge_intentions(
            level1_result, level2_results
        )
        
        return {
            "intentions": final_intentions,
            "entities": entities,
            "confidence": self._calculate_confidence(final_intentions),
            "workflow_type": self._determine_workflow_type(final_intentions),
            "raw_results": {
                "level1": level1_result,
                "level2": level2_results
            }
        }
    
    async def _classify_level1_intent(self, 
                                    input_text: str, 
                                    user_context: Dict, 
                                    session_context: Dict) -> Dict:
        """
        一级意图分类：普通对话、搜索、工具调用
        """
        prompt = self._build_level1_prompt(input_text, user_context, session_context)
        
        outputs = self.vllm_engine.generate(
            [prompt],
            self.sampling_params,
            lora_request=self.lora_configs["level1_intent"]
        )
        
        result_text = outputs[0].outputs[0].text
        return self._parse_intent_result(result_text)
    
    async def _classify_search_intent(self, 
                                    input_text: str, 
                                    user_context: Dict, 
                                    session_context: Dict) -> Dict:
        """
        二级搜索意图分类：图片、文档、视频等
        """
        prompt = self._build_search_prompt(input_text, user_context, session_context)
        
        outputs = self.vllm_engine.generate(
            [prompt],
            self.sampling_params,
            lora_request=self.lora_configs["search_intent"]
        )
        
        result_text = outputs[0].outputs[0].text
        return self._parse_search_result(result_text)
    
    async def _classify_tool_intent(self, 
                                  input_text: str, 
                                  user_context: Dict, 
                                  session_context: Dict) -> Dict:
        """
        二级工具意图分类：AI相机、文档处理等
        """
        prompt = self._build_tool_prompt(input_text, user_context, session_context)
        
        outputs = self.vllm_engine.generate(
            [prompt],
            self.sampling_params,
            lora_request=self.lora_configs["tool_intent"]
        )
        
        result_text = outputs[0].outputs[0].text
        return self._parse_tool_result(result_text)
```

### 1.3 工作流规划引擎实现

```python
from agenticx.core.workflow import Workflow, WorkflowStep
from agenticx.core.task import Task
from typing import Dict, List, Any
import networkx as nx

class WorkflowPlanningEngine:
    """
    基于AgenticX工作流引擎的智能规划器
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.workflow_templates = self._load_workflow_templates()
        
    async def generate_plan(self, 
                          intentions: List[Dict], 
                          entities: Dict, 
                          user_context: Dict) -> Dict[str, Any]:
        """
        基于意图和实体生成执行计划
        """
        # 分析意图类型和复杂度
        workflow_type = self._analyze_workflow_type(intentions)
        
        if workflow_type == "single":
            return await self._generate_single_task_plan(intentions[0], entities)
        elif workflow_type == "multi":
            return await self._generate_multi_task_plan(intentions, entities)
        elif workflow_type == "sequential":
            return await self._generate_sequential_plan(intentions, entities)
        else:
            raise ValueError(f"Unsupported workflow type: {workflow_type}")
    
    async def _generate_sequential_plan(self, 
                                      intentions: List[Dict], 
                                      entities: Dict) -> Dict[str, Any]:
        """
        生成顺序执行的工作流计划
        """
        workflow = Workflow(name="sequential_intent_workflow")
        
        # 构建任务依赖图
        dependency_graph = self._build_dependency_graph(intentions, entities)
        
        # 拓扑排序确定执行顺序
        execution_order = list(nx.topological_sort(dependency_graph))
        
        tasks = []
        for i, intent in enumerate(execution_order):
            task = await self._create_task_from_intent(
                intent, entities, task_id=f"task_{i}"
            )
            tasks.append(task)
            
            # 添加到工作流
            step = WorkflowStep(
                name=f"step_{i}",
                task=task,
                dependencies=[f"step_{j}" for j in range(i)]
            )
            workflow.add_step(step)
        
        return {
            "plan_id": workflow.id,
            "workflow": workflow,
            "tasks": tasks,
            "execution_order": execution_order,
            "estimated_time": self._estimate_execution_time(tasks),
            "dependencies": self._extract_dependencies(dependency_graph)
        }
    
    def _build_dependency_graph(self, 
                              intentions: List[Dict], 
                              entities: Dict) -> nx.DiGraph:
        """
        构建任务依赖关系图
        """
        graph = nx.DiGraph()
        
        # 添加节点
        for i, intent in enumerate(intentions):
            graph.add_node(i, intent=intent)
        
        # 分析依赖关系
        for i, intent_a in enumerate(intentions):
            for j, intent_b in enumerate(intentions):
                if i != j and self._has_dependency(intent_a, intent_b, entities):
                    graph.add_edge(i, j)
        
        return graph
    
    def _has_dependency(self, 
                      intent_a: Dict, 
                      intent_b: Dict, 
                      entities: Dict) -> bool:
        """
        判断两个意图之间是否存在依赖关系
        """
        # 搜索意图通常需要在工具调用之前执行
        if (intent_a.get("type") == "search" and 
            intent_b.get("type") == "tool" and
            self._shares_target_resource(intent_a, intent_b, entities)):
            return True
        
        # 检查显式的时序关键词
        temporal_keywords = ["然后", "接着", "之后", "再", "最后"]
        if any(keyword in intent_b.get("original_text", "") 
               for keyword in temporal_keywords):
            return True
        
        return False
```

### 1.4 执行协调器实现

````python
from agenticx.tools import ToolExecutor, Tool
from agenticx.observability import MonitoringCallbackHandler
from agenticx.core.workflow import WorkflowEngine
import asyncio
from typing import Dict, List, Any

class ExecutionCoordinator:
    """
    执行协调器，负责任务调度和监控
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.workflow_engine = WorkflowEngine(config)
        
    async def execute_plan(self, 
                         plan: Dict[str, Any], 
                         tool_executor: ToolExecutor,
                         monitoring: MonitoringCallbackHandler) -> Dict[str, Any]:
        """
        执行工作流计划
        """
        workflow = plan["workflow"]
        
        # 注册监控回调
        workflow.add_callback(monitoring)
        
        # 执行工作流
        execution_result = await self.workflow_engine.execute(workflow)
        
        # 收集执行结果
        results = {
            "execution_id": execution_result.id,
            "status": execution_result.status,
            "tasks_results": [],
            "total_duration": execution_result.duration,
            "success_rate": execution_result.success_rate
        }
        
        # 处理每个任务的结果
        for step_result in execution_result.step_results:
            task_result = {
                "task_id": step_result.task_id,
                "status": step_result.status,
                "output": step_result.output,
                "duration": step_result.duration,
                "error": step_result.error if step_result.status == "failed" else None
            }
            results["tasks_results"].append(task_result)
        
        return results

## 2. 核心组件实现

### 2.1 AgenticX增强引擎

AgenticX增强引擎是系统的核心组件，负责增强现有意图识别服务的能力。

```python
from agenticx import Agent, Memory, Tool
from agenticx.memory import VectorMemory
from typing import Dict, List, Any
import httpx
import asyncio

class AgenticXEnhancementEngine(Agent):
    def __init__(self, config: Dict[str, Any]):
        super().__init__()
        
        # 现有后端API配置
        self.backend_api_url = config['backend_api_url']
        self.api_client = httpx.AsyncClient()
        
        # 初始化AgenticX记忆系统
        self.memory = VectorMemory(
            embedding_model=config['embedding_model'],
            vector_store=config['vector_store']
        )
        
        # 工作流编排器
        self.workflow_orchestrator = WorkflowOrchestrator()
        
        # 工具扩展管理器
        self.tool_manager = EnhancedToolManager()
    
    async def enhance_intent_recognition(self, user_input: str, 
                                       user_id: str, 
                                       session_id: str = None,
                                       context: Dict = None) -> Dict:
        """增强意图识别处理"""
        
        # 1. 记忆检索和上下文增强
        enhanced_context = await self._enhance_context(
            user_input, user_id, session_id, context
        )
        
        # 2. 调用现有意图识别API
        original_result = await self._call_existing_intent_api(
            user_input, user_id, enhanced_context
        )
        
        # 3. AgenticX智能编排
        workflow_plan = await self.workflow_orchestrator.create_plan(
            original_result, enhanced_context
        )
        
        # 4. 更新记忆系统
        await self._update_memory(user_input, original_result, session_id)
        
        # 5. 构建增强响应
        return self._build_enhanced_response(
            original_result, workflow_plan, enhanced_context
        )
    
    async def _enhance_context(self, user_input: str, user_id: str, 
                              session_id: str, context: Dict) -> Dict:
        """上下文增强"""
        # 检索用户历史记忆
        user_memories = await self.memory.search(
            query=f"user:{user_id} {user_input}",
            filters={"user_id": user_id},
            top_k=5
        )
        
        # 检索会话记忆
        session_memories = []
        if session_id:
            session_memories = await self.memory.search(
                query=user_input,
                filters={"session_id": session_id},
                top_k=3
            )
        
        # 构建增强上下文
        enhanced_context = {
            "original_context": context or {},
            "user_memories": user_memories,
            "session_memories": session_memories,
            "context_enrichment": await self._generate_context_enrichment(
                user_input, user_memories, session_memories
            )
        }
        
        return enhanced_context
    
    async def _call_existing_intent_api(self, user_input: str, 
                                       user_id: str, 
                                       enhanced_context: Dict) -> Dict:
        """调用现有意图识别API"""
        # 构建兼容现有RequestParams的请求
        request_data = {
            "input": user_input,
            "user_id": user_id,
            "context": enhanced_context.get("original_context", {})
        }
        
        # 调用现有FastAPI后端
        response = await self.api_client.post(
            f"{self.backend_api_url}/api/intent/analyze",
            json=request_data
        )
        
        return response.json()
````

```
```

