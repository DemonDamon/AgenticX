"""意图识别主工作流实现
基于AgenticX Workflow的完整意图处理流水线
"""

import time
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool

from agents.intent_agent import IntentRecognitionAgent
from tools.rule_matching_tool import RuleMatchingTool
from tools.hybrid_extractor import HybridExtractor


class PipelineResult(BaseModel):
    """流水线处理结果"""
    intent: Optional[str] = Field(None, description="识别的意图")
    entities: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict, description="抽取的实体")
    confidence: float = Field(0.0, description="整体置信度")
    rule_matches: List[Dict[str, Any]] = Field(default_factory=list, description="规则匹配结果")
    processing_time: float = Field(0.0, description="处理时间")
    total_processing_time: float = Field(0.0, description="总处理时间")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class PreprocessingNode(WorkflowNode):
    """预处理节点"""
    
    def __init__(self, name: str = "preprocessing"):
        super().__init__(id=name, name=name, type="preprocessing")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行预处理"""
        text = context.get("text", "")
        
        # 文本清理和标准化
        cleaned_text = text.strip()
        if not cleaned_text:
            raise ValueError("输入文本不能为空")
        
        # 添加预处理元数据
        context["preprocessed_text"] = cleaned_text
        context["original_length"] = len(text)
        context["cleaned_length"] = len(cleaned_text)
        
        return context


class IntentRecognitionNode(WorkflowNode):
    """意图识别节点"""
    intent_agent: IntentRecognitionAgent = None
    llm_provider: BaseLLMProvider = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, intent_agent: IntentRecognitionAgent, llm_provider: BaseLLMProvider, name: str = "intent_recognition"):
        super().__init__(id=name, name=name, type="intent_recognition")
        self.intent_agent = intent_agent
        self.llm_provider = llm_provider
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行意图识别"""
        text = context.get("preprocessed_text", "")
        
        # 使用意图代理进行识别
        task = Task(
            description=f"识别文本的意图: {text}",
            expected_output="意图分类结果"
        )
        
        executor = AgentExecutor(llm_provider=self.llm_provider)
        result = executor.run(self.intent_agent, task)
        
        # 解析结果
        intent_result = result.output if hasattr(result, 'output') else str(result)
        
        context["intent_result"] = intent_result
        context["intent_confidence"] = getattr(result, 'confidence', 0.8)
        
        return context


class EntityExtractionNode(WorkflowNode):
    """实体抽取节点"""
    entity_extractor: HybridExtractor = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, entity_extractor: HybridExtractor, name: str = "entity_extraction"):
        super().__init__(id=name, name=name, type="entity_extraction")
        self.entity_extractor = entity_extractor
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行实体抽取"""
        text = context.get("preprocessed_text", "")
        
        # 使用混合抽取器进行实体抽取
        extraction_result = self.entity_extractor.extract(text)
        
        context["entities"] = extraction_result.entities
        context["entity_confidence"] = extraction_result.confidence
        
        return context


class RuleMatchingNode(WorkflowNode):
    """规则匹配节点"""
    rule_tool: RuleMatchingTool = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, rule_tool: RuleMatchingTool, name: str = "rule_matching"):
        super().__init__(id=name, name=name, type="rule_matching")
        self.rule_tool = rule_tool
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行规则匹配"""
        text = context.get("preprocessed_text", "")
        
        # 使用规则匹配工具
        rule_result = self.rule_tool.execute({"text": text})
        
        context["rule_matches"] = rule_result.data if hasattr(rule_result, 'data') else []
        context["rule_confidence"] = getattr(rule_result, 'confidence', 0.0)
        
        return context


class PostprocessingNode(WorkflowNode):
    """后处理节点"""
    
    def __init__(self, name: str = "postprocessing"):
        super().__init__(id=name, name=name, type="postprocessing")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行后处理"""
        # 合并和优化结果
        intent_result = context.get("intent_result", "")
        entities_raw = context.get("entities", {})
        rule_matches = context.get("rule_matches", [])
        
        # 将Entity对象转换为字典格式
        entities = {}
        for entity_type, entity_list in entities_raw.items():
            entities[entity_type] = []
            for entity in entity_list:
                if hasattr(entity, 'dict'):
                    # Entity对象，转换为字典
                    entities[entity_type].append(entity.dict())
                else:
                    # 已经是字典格式
                    entities[entity_type].append(entity)
        
        # 计算综合置信度
        intent_confidence = context.get("intent_confidence", 0.0)
        entity_confidence = context.get("entity_confidence", 0.0)
        rule_confidence = context.get("rule_confidence", 0.0)
        
        # 确保所有confidence值都是数值类型
        def ensure_numeric(value, default=0.0):
            try:
                return float(value) if value is not None else default
            except (TypeError, ValueError):
                return default
        
        intent_confidence = ensure_numeric(intent_confidence)
        entity_confidence = ensure_numeric(entity_confidence)
        rule_confidence = ensure_numeric(rule_confidence)
        
        # 加权平均置信度
        weights = [0.4, 0.3, 0.3]  # 意图、实体、规则的权重
        confidences = [intent_confidence, entity_confidence, rule_confidence]
        overall_confidence = sum(w * c for w, c in zip(weights, confidences))
        
        # 构建最终结果
        final_result = PipelineResult(
            intent=intent_result,
            entities=entities,
            confidence=overall_confidence,
            rule_matches=rule_matches,
            processing_time=context.get("processing_time", 0.0),
            total_processing_time=context.get("total_processing_time", 0.0),
            metadata={
                "rules_count": len(rule_matches),
                "strategies_used": ["intent_recognition", "entity_extraction", "rule_matching"],
                "validation": "passed"
            }
        )
        
        context["final_result"] = final_result
        
        return context


class IntentRecognitionWorkflow:
    """意图识别主工作流"""
    
    def __init__(self, llm_provider: BaseLLMProvider, intent_agent: IntentRecognitionAgent, 
                 entity_extractor: HybridExtractor, rule_tool: RuleMatchingTool):
        """
        初始化工作流
        
        Args:
            llm_provider: LLM提供者
            intent_agent: 意图识别代理
            entity_extractor: 实体抽取器
            rule_tool: 规则匹配工具
        """
        self.llm_provider = llm_provider
        self.intent_agent = intent_agent
        self.entity_extractor = entity_extractor
        self.rule_tool = rule_tool
        
        # 设置日志
        self.logger = logging.getLogger(__name__)
        
        # 初始化节点
        self.preprocessing_node = PreprocessingNode()
        self.intent_node = IntentRecognitionNode(intent_agent, llm_provider)
        self.entity_node = EntityExtractionNode(entity_extractor)
        self.rule_node = RuleMatchingNode(rule_tool)
        self.postprocessing_node = PostprocessingNode()
        
        # 构建工作流
        self._build_workflow()
    
    def _build_workflow(self):
        """构建工作流图"""
        # 创建节点列表
        nodes = [
            self.preprocessing_node,
            self.intent_node,
            self.entity_node,
            self.rule_node,
            self.postprocessing_node
        ]
        
        # 创建边列表（定义执行顺序）
        edges = [
            WorkflowEdge(
                source="preprocessing",
                target="intent_recognition"
            ),
            WorkflowEdge(
                source="intent_recognition",
                target="entity_extraction"
            ),
            WorkflowEdge(
                source="entity_extraction",
                target="rule_matching"
            ),
            WorkflowEdge(
                source="rule_matching",
                target="postprocessing"
            )
        ]
        
        # 创建工作流
        self.workflow = Workflow(
            name="intent_recognition_workflow",
            organization_id="default",
            nodes=nodes,
            edges=edges
        )
    
    def execute(self, text: str) -> PipelineResult:
        """执行工作流
        
        Args:
            text: 输入文本
            
        Returns:
            PipelineResult: 处理结果
        """
        start_time = time.time()
        
        try:
            # 初始化上下文
            context = {
                "text": text,
                "start_time": start_time
            }
            
            # 执行各个节点
            context = self.preprocessing_node.execute(context)
            context = self.intent_node.execute(context)
            context = self.entity_node.execute(context)
            context = self.rule_node.execute(context)
            
            # 计算处理时间
            processing_time = time.time() - start_time
            context["processing_time"] = processing_time
            context["total_processing_time"] = processing_time
            
            # 后处理
            context = self.postprocessing_node.execute(context)
            
            return context["final_result"]
            
        except Exception as e:
            self.logger.error(f"工作流执行失败: {e}")
            # 返回错误结果
            return PipelineResult(
                intent=None,
                entities={},
                confidence=0.0,
                rule_matches=[],
                processing_time=time.time() - start_time,
                total_processing_time=time.time() - start_time,
                metadata={"error": str(e)}
            )
    
    def get_workflow_info(self) -> Dict[str, Any]:
        """获取工作流信息"""
        return {
            "name": self.workflow.name,
            "nodes": [node.name for node in self.workflow.nodes],
            "edges_count": len(self.workflow.edges)
        }