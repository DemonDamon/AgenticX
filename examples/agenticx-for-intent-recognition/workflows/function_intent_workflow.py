"""工具调用意图处理工作流实现
专门处理002类型的工具调用意图
"""

import time
import logging
import json
import re
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field

from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.base import BaseLLMProvider
from tools.entity_models import Entity
from agenticx.tools.base import BaseTool

from agents.function_agent import FunctionIntentAgent
from tools.hybrid_extractor import HybridExtractor
from workflows.intent_recognition_workflow import PipelineResult


class FunctionCall(BaseModel):
    """工具调用"""
    function_name: str = Field("", description="工具名称")
    function_type: str = Field("", description="工具类型")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="调用参数")
    confidence: float = Field(0.0, description="匹配置信度")
    validation_status: str = Field("pending", description="验证状态")


class ParameterExtractionNode(WorkflowNode):
    """参数抽取节点"""
    entity_extractor: HybridExtractor = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, entity_extractor: HybridExtractor, name: str = "parameter_extraction"):
        super().__init__(id=name, name=name, type="parameter_extraction")
        self.entity_extractor = entity_extractor
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行参数抽取"""
        text = context.get("preprocessed_text", "")
        
        # 使用实体抽取器提取基础实体
        extraction_result = self.entity_extractor.extract(text)
        
        # 针对工具调用场景优化参数提取
        function_parameters = self._extract_function_parameters(text, extraction_result.entities)
        
        # 验证参数完整性
        parameter_completeness = self._validate_parameter_completeness(function_parameters)
        
        context["function_parameters"] = function_parameters
        context["parameter_completeness"] = parameter_completeness
        context["extraction_confidence"] = extraction_result.confidence
        
        return context
    
    def _extract_function_parameters(self, text: str, entities: Dict[str, List[Entity]]) -> Dict[str, Any]:
        """提取工具调用参数"""
        parameters = {}
        
        # 从实体中提取常见参数
        for entity_type, entity_list in entities.items():
            for entity in entity_list:
                entity_text = entity.text
                
                # 时间参数
                if entity_type in ["TIME", "DATE"]:
                    parameters["time"] = entity_text
                
                # 地点参数
                elif entity_type in ["LOCATION", "GPE"]:
                    parameters["location"] = entity_text
                
                # 人名参数
                elif entity_type in ["PERSON", "PER"]:
                    parameters["person"] = entity_text
                
                # 组织参数
                elif entity_type in ["ORGANIZATION", "ORG"]:
                    parameters["organization"] = entity_text
                
                # 数量参数
                elif entity_type in ["QUANTITY", "NUMBER"]:
                    parameters["quantity"] = entity_text
        
        # 使用正则表达式提取特定参数
        parameters.update(self._extract_regex_parameters(text))
        
        # 提取动作参数
        parameters.update(self._extract_action_parameters(text))
        
        return parameters
    
    def _extract_regex_parameters(self, text: str) -> Dict[str, Any]:
        """使用正则表达式提取参数"""
        parameters = {}
        
        # 文件路径
        file_pattern = r'["\']?([a-zA-Z]:[\\\w\s.-]+\.[a-zA-Z0-9]+)["\']?'
        file_matches = re.findall(file_pattern, text)
        if file_matches:
            parameters["file_path"] = file_matches[0]
        
        # URL
        url_pattern = r'https?://[^\s]+'
        url_matches = re.findall(url_pattern, text)
        if url_matches:
            parameters["url"] = url_matches[0]
        
        # 邮箱
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        email_matches = re.findall(email_pattern, text)
        if email_matches:
            parameters["email"] = email_matches[0]
        
        # 电话号码
        phone_pattern = r'1[3-9]\d{9}'
        phone_matches = re.findall(phone_pattern, text)
        if phone_matches:
            parameters["phone"] = phone_matches[0]
        
        # 数字
        number_pattern = r'\b\d+(?:\.\d+)?\b'
        number_matches = re.findall(number_pattern, text)
        if number_matches:
            parameters["number"] = float(number_matches[0]) if '.' in number_matches[0] else int(number_matches[0])
        
        return parameters
    
    def _extract_action_parameters(self, text: str) -> Dict[str, Any]:
        """提取动作相关参数"""
        parameters = {}
        
        # 操作类型
        action_patterns = {
            "create": ["创建", "新建", "建立", "生成"],
            "delete": ["删除", "移除", "清除"],
            "update": ["更新", "修改", "编辑", "改变"],
            "search": ["搜索", "查找", "寻找", "检索"],
            "send": ["发送", "传送", "邮寄"],
            "download": ["下载", "获取"],
            "upload": ["上传", "提交"],
            "open": ["打开", "启动", "运行"],
            "close": ["关闭", "结束", "停止"]
        }
        
        for action, patterns in action_patterns.items():
            if any(pattern in text for pattern in patterns):
                parameters["action"] = action
                break
        
        # 目标对象
        object_patterns = {
            "file": ["文件", "档案", "document"],
            "folder": ["文件夹", "目录", "folder"],
            "email": ["邮件", "email", "mail"],
            "message": ["消息", "信息", "message"],
            "calendar": ["日历", "日程", "calendar"],
            "contact": ["联系人", "contact"],
            "note": ["笔记", "备忘", "note"]
        }
        
        for obj_type, patterns in object_patterns.items():
            if any(pattern in text for pattern in patterns):
                parameters["target_object"] = obj_type
                break
        
        return parameters
    
    def _validate_parameter_completeness(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """验证参数完整性"""
        completeness = {
            "has_action": "action" in parameters,
            "has_target": "target_object" in parameters or "file_path" in parameters,
            "has_identifier": any(key in parameters for key in ["person", "email", "phone", "url"]),
            "parameter_count": len(parameters),
            "completeness_score": 0.0
        }
        
        # 计算完整性分数
        score = 0.0
        if completeness["has_action"]:
            score += 0.4
        if completeness["has_target"]:
            score += 0.3
        if completeness["has_identifier"]:
            score += 0.2
        if completeness["parameter_count"] >= 2:
            score += 0.1
        
        completeness["completeness_score"] = score
        
        return completeness


class ToolMatchingNode(WorkflowNode):
    """工具匹配节点"""
    available_tools: List[BaseTool] = None
    tool_mappings: dict = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, available_tools: List[BaseTool] = None, name: str = "tool_matching"):
        super().__init__(id=name, name=name, type="tool_matching")
        self.available_tools = available_tools or []
        
        # 预定义工具映射
        self.tool_mappings = self._build_tool_mappings()
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行工具匹配"""
        text = context.get("preprocessed_text", "")
        function_parameters = context.get("function_parameters", {})
        
        # 识别工具类型
        tool_type = self._identify_tool_type(text, function_parameters)
        
        # 匹配具体工具
        matched_tools = self._match_tools(text, function_parameters, tool_type)
        
        # 选择最佳工具
        best_tool = self._select_best_tool(matched_tools)
        
        context["tool_type"] = tool_type
        context["matched_tools"] = matched_tools
        context["best_tool"] = best_tool
        context["tool_confidence"] = best_tool.confidence if best_tool else 0.0
        
        return context
    
    def _build_tool_mappings(self) -> Dict[str, Dict[str, Any]]:
        """构建工具映射"""
        return {
            "file_management": {
                "keywords": ["文件", "文档", "目录", "文件夹", "保存", "删除"],
                "actions": ["create", "delete", "update", "open", "close"],
                "tools": ["FileManagerTool", "DocumentTool"]
            },
            "communication": {
                "keywords": ["邮件", "消息", "发送", "联系", "通知"],
                "actions": ["send", "create"],
                "tools": ["EmailTool", "MessageTool", "NotificationTool"]
            },
            "calendar": {
                "keywords": ["日历", "日程", "会议", "提醒", "预约"],
                "actions": ["create", "update", "delete"],
                "tools": ["CalendarTool", "ScheduleTool"]
            },
            "search": {
                "keywords": ["搜索", "查找", "检索", "寻找"],
                "actions": ["search"],
                "tools": ["SearchTool", "WebSearchTool"]
            },
            "calculation": {
                "keywords": ["计算", "算", "数学", "统计"],
                "actions": ["calculate"],
                "tools": ["CalculatorTool", "MathTool"]
            },
            "web_browser": {
                "keywords": ["浏览器", "网页", "打开", "访问"],
                "actions": ["open", "browse"],
                "tools": ["BrowserTool", "WebTool"]
            }
        }
    
    def _identify_tool_type(self, text: str, parameters: Dict[str, Any]) -> str:
        """识别工具类型"""
        action = parameters.get("action", "")
        target_object = parameters.get("target_object", "")
        
        # 基于关键词匹配
        for tool_type, mapping in self.tool_mappings.items():
            # 检查关键词
            if any(keyword in text for keyword in mapping["keywords"]):
                return tool_type
            
            # 检查动作匹配
            if action in mapping["actions"]:
                return tool_type
        
        # 基于目标对象推断
        object_to_type = {
            "file": "file_management",
            "folder": "file_management",
            "email": "communication",
            "message": "communication",
            "calendar": "calendar",
            "note": "file_management"
        }
        
        if target_object in object_to_type:
            return object_to_type[target_object]
        
        return "general"
    
    def _match_tools(self, text: str, parameters: Dict[str, Any], tool_type: str) -> List[FunctionCall]:
        """匹配工具"""
        matched_tools = []
        
        if tool_type in self.tool_mappings:
            mapping = self.tool_mappings[tool_type]
            
            for tool_name in mapping["tools"]:
                # 计算匹配分数
                score = self._calculate_match_score(text, parameters, mapping)
                
                if score > 0.3:  # 阈值
                    function_call = FunctionCall(
                        function_name=tool_name,
                        function_type=tool_type,
                        parameters=parameters,
                        confidence=score,
                        validation_status="matched"
                    )
                    matched_tools.append(function_call)
        
        # 按置信度排序
        matched_tools.sort(key=lambda x: x.confidence, reverse=True)
        
        return matched_tools
    
    def _calculate_match_score(self, text: str, parameters: Dict[str, Any], mapping: Dict[str, Any]) -> float:
        """计算匹配分数"""
        score = 0.0
        
        # 关键词匹配
        keyword_matches = sum(1 for keyword in mapping["keywords"] if keyword in text)
        if keyword_matches > 0:
            score += 0.4 * min(keyword_matches / len(mapping["keywords"]), 1.0)
        
        # 动作匹配
        action = parameters.get("action", "")
        if action in mapping["actions"]:
            score += 0.3
        
        # 参数完整性
        if len(parameters) >= 2:
            score += 0.2
        
        # 上下文相关性
        if any(key in parameters for key in ["target_object", "file_path", "url"]):
            score += 0.1
        
        return min(score, 1.0)
    
    def _select_best_tool(self, matched_tools: List[FunctionCall]) -> Optional[FunctionCall]:
        """选择最佳工具"""
        if not matched_tools:
            return None
        
        # 返回置信度最高的工具
        return matched_tools[0]


class ToolValidationNode(WorkflowNode):
    """工具验证节点"""
    
    def __init__(self, name: str = "tool_validation"):
        super().__init__(id=name, name=name, type="tool_validation")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行工具验证"""
        best_tool = context.get("best_tool")
        function_parameters = context.get("function_parameters", {})
        parameter_completeness = context.get("parameter_completeness", {})
        
        if not best_tool:
            context["validation_result"] = {
                "status": "failed",
                "reason": "no_tool_matched",
                "confidence": 0.0
            }
            return context
        
        # 验证参数完整性
        validation_result = self._validate_tool_execution(best_tool, function_parameters, parameter_completeness)
        
        # 更新工具验证状态
        if validation_result["status"] == "passed":
            best_tool.validation_status = "validated"
        else:
            best_tool.validation_status = "failed"
        
        context["validation_result"] = validation_result
        context["best_tool"] = best_tool
        
        return context
    
    def _validate_tool_execution(self, tool: FunctionCall, parameters: Dict[str, Any], 
                               completeness: Dict[str, Any]) -> Dict[str, Any]:
        """验证工具执行条件"""
        validation = {
            "status": "pending",
            "reason": "",
            "confidence": 0.0,
            "missing_parameters": [],
            "suggestions": []
        }
        
        # 检查基本要求
        if tool.confidence < 0.5:
            validation["status"] = "failed"
            validation["reason"] = "low_confidence"
            validation["confidence"] = tool.confidence
            return validation
        
        # 检查参数完整性
        completeness_score = completeness.get("completeness_score", 0.0)
        if completeness_score < 0.3:
            validation["status"] = "failed"
            validation["reason"] = "insufficient_parameters"
            validation["confidence"] = completeness_score
            
            # 提供改进建议
            if not completeness.get("has_action"):
                validation["missing_parameters"].append("action")
                validation["suggestions"].append("请明确要执行的操作")
            
            if not completeness.get("has_target"):
                validation["missing_parameters"].append("target")
                validation["suggestions"].append("请指定操作的目标对象")
            
            return validation
        
        # 验证通过
        validation["status"] = "passed"
        validation["reason"] = "validation_successful"
        validation["confidence"] = min(tool.confidence + completeness_score * 0.3, 1.0)
        
        return validation


class FunctionIntentWorkflow:
    """工具调用意图处理工作流"""
    
    def __init__(self, 
                 llm_provider: BaseLLMProvider,
                 function_agent: FunctionIntentAgent,
                 entity_extractor: HybridExtractor,
                 available_tools: List[BaseTool] = None):
        """
        初始化工具调用意图工作流
        
        Args:
            llm_provider: LLM提供者
            function_agent: 工具调用代理
            entity_extractor: 实体抽取器
            available_tools: 可用工具列表
        """
        self.llm_provider = llm_provider
        self.function_agent = function_agent
        self.entity_extractor = entity_extractor
        self.available_tools = available_tools or []
        
        # 设置日志
        self.logger = logging.getLogger(__name__)
        
        # 初始化节点
        self.parameter_extraction_node = ParameterExtractionNode(entity_extractor)
        self.tool_matching_node = ToolMatchingNode(available_tools)
        self.tool_validation_node = ToolValidationNode()
        
        # 构建工作流
        self._build_workflow()
    
    def _build_workflow(self):
        """构建工作流图"""
        # 创建节点列表
        nodes = [
            self.parameter_extraction_node,
            self.tool_matching_node,
            self.tool_validation_node
        ]
        
        # 创建边列表
        edges = [
            WorkflowEdge(
                source="parameter_extraction",
                target="tool_matching"
            ),
            WorkflowEdge(
                source="tool_matching",
                target="tool_validation"
            )
        ]
        
        # 创建工作流
        self.workflow = Workflow(
            name="function_intent_workflow",
            organization_id="default",
            nodes=nodes,
            edges=edges
        )
    
    def execute(self, text: str) -> PipelineResult:
        """执行工具调用意图工作流
        
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
                "preprocessed_text": text.strip(),
                "start_time": start_time
            }
            
            # 执行各个节点
            context = self.parameter_extraction_node.execute(context)
            context = self.tool_matching_node.execute(context)
            context = self.tool_validation_node.execute(context)
            
            # 使用工具调用代理生成响应
            task = Task(
                description=f"处理工具调用: {text}",
                expected_output="工具调用结果"
            )
            
            executor = AgentExecutor(llm_provider=self.llm_provider)
            agent_result = executor.run(self.function_agent, task)
            
            # 计算处理时间
            processing_time = time.time() - start_time
            
            # 构建结果
            best_tool = context.get("best_tool")
            validation_result = context.get("validation_result", {})
            
            # 确定意图子类型
            tool_type = context.get("tool_type", "general")
            intent_subtype = f"002_{tool_type}_function"
            
            # 构建实体信息
            entities = {
                "FUNCTION_PARAMETERS": [{
                    "text": json.dumps(context.get("function_parameters", {}), ensure_ascii=False),
                    "confidence": context.get("extraction_confidence", 0.0)
                }]
            }
            
            if best_tool:
                entities["FUNCTION_CALL"] = [{
                    "text": best_tool.function_name,
                    "confidence": best_tool.confidence
                }]
            
            result = PipelineResult(
                intent=intent_subtype,
                entities=entities,
                confidence=validation_result.get("confidence", 0.0),
                rule_matches=[],
                processing_time=processing_time,
                total_processing_time=processing_time,
                metadata={
                    "workflow_type": "function_intent",
                    "tool_type": tool_type,
                    "function_call": best_tool.dict() if best_tool else None,
                    "validation_result": validation_result,
                    "parameter_completeness": context.get("parameter_completeness", {}),
                    "matched_tools_count": len(context.get("matched_tools", [])),
                    "agent_response": str(agent_result)
                }
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"工具调用意图工作流执行失败: {e}")
            return PipelineResult(
                intent="002_general_function",
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
            "description": self.workflow.description,
            "nodes": [node.name for node in self.workflow.nodes],
            "edges_count": len(self.workflow.edges),
            "specialized_for": "002_function_intent",
            "available_tools_count": len(self.available_tools)
        }