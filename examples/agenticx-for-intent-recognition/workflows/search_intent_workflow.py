"""搜索意图处理工作流实现
专门处理001类型的搜索意图
"""

import time
import logging
import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.base import BaseLLMProvider

from agents.search_agent import SearchIntentAgent
from tools.hybrid_extractor import HybridExtractor
from workflows.intent_recognition_workflow import PipelineResult


class SearchQuery(BaseModel):
    """搜索查询"""
    query: str = Field("", description="查询文本")
    query_type: str = Field("", description="查询类型")
    entities: List[str] = Field(default_factory=list, description="查询实体")
    intent_subtype: str = Field("", description="搜索意图子类型")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="搜索参数")


class QueryUnderstandingNode(WorkflowNode):
    """查询理解节点"""
    
    def __init__(self, name: str = "query_understanding"):
        super().__init__(id=name, name=name, type="query_understanding")
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行查询理解"""
        text = context.get("preprocessed_text", "")
        
        # 分析查询类型
        query_type = self._analyze_query_type(text)
        
        # 提取查询关键词
        keywords = self._extract_keywords(text)
        
        # 识别搜索意图子类型
        intent_subtype = self._identify_search_subtype(text, query_type)
        
        # 提取搜索参数
        parameters = self._extract_search_parameters(text)
        
        # 构建搜索查询对象
        search_query = SearchQuery(
            query=text,
            query_type=query_type,
            entities=keywords,
            intent_subtype=intent_subtype,
            parameters=parameters
        )
        
        context["search_query"] = search_query
        context["query_confidence"] = self._calculate_query_confidence(search_query)
        
        return context
    
    def _analyze_query_type(self, text: str) -> str:
        """分析查询类型"""
        # 信息查询
        if any(word in text for word in ["什么是", "介绍", "定义", "概念", "含义"]):
            return "information"
        
        # 方法查询
        if any(word in text for word in ["如何", "怎么", "怎样", "方法", "步骤"]):
            return "how_to"
        
        # 比较查询
        if any(word in text for word in ["比较", "对比", "区别", "差异", "哪个好"]):
            return "comparison"
        
        # 推荐查询
        if any(word in text for word in ["推荐", "建议", "哪个", "选择", "最好"]):
            return "recommendation"
        
        # 事实查询
        if any(word in text for word in ["谁", "什么时候", "哪里", "多少", "几个"]):
            return "factual"
        
        # 列表查询
        if any(word in text for word in ["列表", "清单", "有哪些", "包括", "种类"]):
            return "list"
        
        return "general"
    
    def _extract_keywords(self, text: str) -> List[str]:
        """提取查询关键词"""
        # 移除查询词
        query_words = ["什么是", "如何", "怎么", "怎样", "谁", "哪里", "什么时候", "多少"]
        cleaned_text = text
        for word in query_words:
            cleaned_text = cleaned_text.replace(word, "")
        
        # 提取中文词汇
        chinese_words = re.findall(r'[\u4e00-\u9fff]+', cleaned_text)
        
        # 过滤停用词
        stop_words = {"的", "了", "在", "是", "我", "你", "他", "她", "它", "这", "那", "有", "和", "与"}
        keywords = [word for word in chinese_words if word not in stop_words and len(word) > 1]
        
        # 提取英文单词
        english_words = re.findall(r'[a-zA-Z]+', text)
        keywords.extend([word for word in english_words if len(word) > 2])
        
        return list(set(keywords))[:10]  # 去重并限制数量
    
    def _identify_search_subtype(self, text: str, query_type: str) -> str:
        """识别搜索意图子类型"""
        # 技术相关
        if any(word in text for word in ["编程", "代码", "算法", "技术", "开发", "软件"]):
            return "technical"
        
        # 学术相关
        if any(word in text for word in ["研究", "论文", "学术", "理论", "科学"]):
            return "academic"
        
        # 生活相关
        if any(word in text for word in ["生活", "日常", "家庭", "健康", "美食", "旅游"]):
            return "lifestyle"
        
        # 商业相关
        if any(word in text for word in ["商业", "市场", "投资", "金融", "经济", "公司"]):
            return "business"
        
        # 娱乐相关
        if any(word in text for word in ["电影", "音乐", "游戏", "娱乐", "明星", "体育"]):
            return "entertainment"
        
        return "general"
    
    def _extract_search_parameters(self, text: str) -> Dict[str, Any]:
        """提取搜索参数"""
        parameters = {}
        
        # 时间参数
        time_patterns = {
            "recent": ["最近", "近期", "最新"],
            "historical": ["历史", "过去", "以前"],
            "current": ["现在", "当前", "目前"]
        }
        
        for time_type, patterns in time_patterns.items():
            if any(pattern in text for pattern in patterns):
                parameters["time_scope"] = time_type
                break
        
        # 地域参数
        location_patterns = ["中国", "美国", "日本", "欧洲", "亚洲", "国内", "国外", "本地"]
        for location in location_patterns:
            if location in text:
                parameters["location"] = location
                break
        
        # 数量参数
        quantity_match = re.search(r'(\d+)个?', text)
        if quantity_match:
            parameters["quantity"] = int(quantity_match.group(1))
        
        # 排序参数
        if any(word in text for word in ["最好", "最佳", "排行", "排名"]):
            parameters["sort_by"] = "quality"
        elif any(word in text for word in ["最新", "最近"]):
            parameters["sort_by"] = "time"
        elif any(word in text for word in ["最热", "热门", "流行"]):
            parameters["sort_by"] = "popularity"
        
        return parameters
    
    def _calculate_query_confidence(self, search_query: SearchQuery) -> float:
        """计算查询理解置信度"""
        confidence = 0.5  # 基础置信度
        
        # 有明确查询类型
        if search_query.query_type != "general":
            confidence += 0.2
        
        # 有关键词
        if search_query.entities:
            confidence += 0.1 * min(len(search_query.entities), 3)
        
        # 有搜索参数
        if search_query.parameters:
            confidence += 0.1
        
        # 有明确子类型
        if search_query.intent_subtype != "general":
            confidence += 0.1
        
        return min(confidence, 1.0)


class SearchEntityExtractionNode(WorkflowNode):
    """搜索实体抽取节点"""
    entity_extractor: HybridExtractor = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, entity_extractor: HybridExtractor, name: str = "search_entity_extraction"):
        super().__init__(id=name, name=name, type="search_entity_extraction")
        self.entity_extractor = entity_extractor
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行搜索相关的实体抽取"""
        text = context.get("preprocessed_text", "")
        search_query = context.get("search_query")
        
        # 使用混合抽取器进行实体抽取
        extraction_result = self.entity_extractor.extract(text)
        
        # 针对搜索场景优化实体
        optimized_entities = self._optimize_for_search(extraction_result.entities, search_query)
        
        # 将Entity对象转换为字典格式
        converted_entities = {}
        for entity_type, entity_list in optimized_entities.items():
            converted_entities[entity_type] = []
            for entity in entity_list:
                if hasattr(entity, 'dict'):
                    # Entity对象，转换为字典
                    converted_entities[entity_type].append(entity.dict())
                else:
                    # 已经是字典格式
                    converted_entities[entity_type].append(entity)
        
        context["search_entities"] = converted_entities
        context["entity_confidence"] = extraction_result.confidence
        
        return context
    
    def _optimize_for_search(self, entities: Dict[str, List[Dict[str, Any]]], 
                           search_query: SearchQuery) -> Dict[str, List[Dict[str, Any]]]:
        """针对搜索场景优化实体"""
        optimized = entities.copy()
        
        # 添加查询关键词作为搜索实体
        if search_query and search_query.entities:
            if "SEARCH_TERM" not in optimized:
                optimized["SEARCH_TERM"] = []
            
            for keyword in search_query.entities:
                optimized["SEARCH_TERM"].append({
                    "text": keyword,
                    "confidence": 0.8,
                    "start": 0,
                    "end": len(keyword)
                })
        
        # 添加搜索参数作为实体
        if search_query and search_query.parameters:
            for param_name, param_value in search_query.parameters.items():
                entity_type = f"SEARCH_{param_name.upper()}"
                if entity_type not in optimized:
                    optimized[entity_type] = []
                
                optimized[entity_type].append({
                    "text": str(param_value),
                    "confidence": 0.7,
                    "start": 0,
                    "end": len(str(param_value))
                })
        
        return optimized


class SearchIntentSubclassificationNode(WorkflowNode):
    """搜索意图细分节点"""
    search_agent: SearchIntentAgent = None
    
    class Config:
        arbitrary_types_allowed = True
    
    def __init__(self, search_agent: SearchIntentAgent, name: str = "search_intent_subclassification"):
        super().__init__(id=name, name=name, type="search_intent_subclassification")
        self.search_agent = search_agent
    
    def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行搜索意图细分"""
        search_query = context.get("search_query")
        search_entities = context.get("search_entities", {})
        
        # 基于查询类型和实体进行细分
        subintent = self._classify_search_subintent(search_query, search_entities)
        
        # 计算细分置信度
        subintent_confidence = self._calculate_subintent_confidence(subintent, search_query)
        
        context["search_subintent"] = subintent
        context["subintent_confidence"] = subintent_confidence
        
        return context
    
    def _classify_search_subintent(self, search_query: SearchQuery, 
                                 search_entities: Dict[str, List[Dict[str, Any]]]) -> str:
        """分类搜索子意图"""
        if not search_query:
            return "001_general_search"
        
        query_type = search_query.query_type
        intent_subtype = search_query.intent_subtype
        
        # 构建子意图编码
        subintent_map = {
            ("information", "technical"): "001_tech_info_search",
            ("information", "academic"): "001_academic_info_search",
            ("how_to", "technical"): "001_tech_howto_search",
            ("how_to", "lifestyle"): "001_lifestyle_howto_search",
            ("recommendation", "business"): "001_business_recommendation_search",
            ("recommendation", "entertainment"): "001_entertainment_recommendation_search",
            ("factual", "general"): "001_factual_search",
            ("list", "general"): "001_list_search",
            ("comparison", "general"): "001_comparison_search"
        }
        
        # 查找匹配的子意图
        subintent = subintent_map.get((query_type, intent_subtype))
        
        if not subintent:
            # 基于查询类型的通用映射
            type_map = {
                "information": "001_info_search",
                "how_to": "001_howto_search",
                "recommendation": "001_recommendation_search",
                "factual": "001_factual_search",
                "list": "001_list_search",
                "comparison": "001_comparison_search"
            }
            subintent = type_map.get(query_type, "001_general_search")
        
        return subintent
    
    def _calculate_subintent_confidence(self, subintent: str, search_query: SearchQuery) -> float:
        """计算子意图置信度"""
        confidence = 0.6  # 基础置信度
        
        # 有明确的查询类型
        if search_query and search_query.query_type != "general":
            confidence += 0.2
        
        # 有明确的子类型
        if search_query and search_query.intent_subtype != "general":
            confidence += 0.1
        
        # 子意图不是通用搜索
        if subintent != "001_general_search":
            confidence += 0.1
        
        return min(confidence, 1.0)


class SearchIntentWorkflow:
    """搜索意图处理工作流"""
    
    def __init__(self, llm_provider: BaseLLMProvider, search_agent: SearchIntentAgent, 
                 entity_extractor: HybridExtractor):
        """
        初始化搜索意图工作流
        
        Args:
            llm_provider: LLM提供者
            search_agent: 搜索代理
            entity_extractor: 实体抽取器
        """
        self.llm_provider = llm_provider
        self.search_agent = search_agent
        self.entity_extractor = entity_extractor
        
        # 设置日志
        self.logger = logging.getLogger(__name__)
        
        # 初始化节点
        self.query_understanding_node = QueryUnderstandingNode()
        self.entity_extraction_node = SearchEntityExtractionNode(entity_extractor)
        self.subclassification_node = SearchIntentSubclassificationNode(search_agent)
        
        # 构建工作流
        self._build_workflow()
    
    def _build_workflow(self):
        """构建工作流图"""
        # 创建节点列表
        nodes = [
            self.query_understanding_node,
            self.entity_extraction_node,
            self.subclassification_node
        ]
        
        # 创建边列表
        edges = [
            WorkflowEdge(
                source="query_understanding",
                target="search_entity_extraction"
            ),
            WorkflowEdge(
                source="search_entity_extraction",
                target="search_intent_subclassification"
            )
        ]
        
        # 创建工作流
        self.workflow = Workflow(
            name="search_intent_workflow",
            organization_id="default",
            nodes=nodes,
            edges=edges
        )
    
    def execute(self, text: str) -> PipelineResult:
        """执行搜索意图工作流
        
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
            context = self.query_understanding_node.execute(context)
            context = self.entity_extraction_node.execute(context)
            context = self.subclassification_node.execute(context)
            
            # 使用搜索代理生成响应
            task = Task(
                description=f"处理搜索查询: {text}",
                expected_output="搜索结果"
            )
            
            executor = AgentExecutor(llm_provider=self.llm_provider)
            agent_result = executor.run(self.search_agent, task)
            
            # 计算处理时间
            processing_time = time.time() - start_time
            
            # 构建结果
            search_query = context.get("search_query")
            search_subintent = context.get("search_subintent", "001_general_search")
            
            result = PipelineResult(
                intent=search_subintent,
                entities=context.get("search_entities", {}),
                confidence=(
                    context.get("query_confidence", 0.5) * 0.4 +
                    context.get("entity_confidence", 0.5) * 0.3 +
                    context.get("subintent_confidence", 0.5) * 0.3
                ),
                rule_matches=[],
                processing_time=processing_time,
                total_processing_time=processing_time,
                metadata={
                    "workflow_type": "search_intent",
                    "search_query": search_query.dict() if search_query else {},
                    "query_type": search_query.query_type if search_query else "unknown",
                    "intent_subtype": search_query.intent_subtype if search_query else "unknown",
                    "search_parameters": search_query.parameters if search_query else {},
                    "agent_response": str(agent_result)
                }
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"搜索意图工作流执行失败: {e}")
            return PipelineResult(
                intent="001_general_search",
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
            "specialized_for": "001_search_intent"
        }