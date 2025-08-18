"""搜索意图Agent

专门处理001类型的搜索意图，包括信息查找、搜索需求等。
"""

from typing import Dict, List, Optional, Any
from agenticx.core import Agent, Task, AgentResult, AgentContext

from .intent_agent import IntentRecognitionAgent
from .models import IntentType, IntentResult, IntentContext, AgentConfig, Entity


class SearchIntentAgent(IntentRecognitionAgent):
    """搜索意图Agent
    
    继承IntentRecognitionAgent，专门处理搜索意图(001类型)。
    集成查询意图分析和实体抽取功能。
    """
    
    def __init__(self, config: AgentConfig = None):
        """初始化搜索意图Agent"""
        super().__init__(config)
        
        # 覆盖提示词模板，专门针对搜索意图
        self.prompt_template = self._get_search_prompt()
    
    def _get_search_prompt(self) -> str:
        """获取搜索意图识别的专用提示词模板"""
        return """
你是一个专业的搜索意图分析助手，专门识别和分析用户的搜索需求。

搜索意图类型包括：
1. 事实查询 (factual_search) - 查找具体事实、数据、定义
2. 操作指南 (how_to_search) - 寻找操作方法、教程
3. 比较分析 (comparison_search) - 对比不同选项
4. 推荐建议 (recommendation_search) - 寻求推荐和建议
5. 新闻资讯 (news_search) - 查找最新消息、新闻
6. 学术研究 (academic_search) - 学术资料、论文查找
7. 产品信息 (product_search) - 产品详情、价格等
8. 地理位置 (location_search) - 地点、路线查询

请分析以下用户输入，识别搜索意图并提取关键实体：

用户输入: {user_input}

返回格式：
{{
    "intent_type": "001",
    "confidence": 置信度(0-1之间的浮点数),
    "intent_code": "001_具体搜索类型",
    "description": "搜索意图描述",
    "search_query": "提取的核心搜索查询",
    "search_type": "搜索类型",
    "entities": [
        {{
            "text": "实体文本",
            "label": "实体类型",
            "start": 起始位置,
            "end": 结束位置,
            "confidence": 置信度
        }}
    ],
    "search_scope": "搜索范围",
    "urgency": "紧急程度(low/medium/high)"
}}

请确保返回有效的JSON格式。
"""
    
    def recognize_intent(self, context: IntentContext) -> IntentResult:
        """识别搜索意图
        
        重写父类方法，添加搜索查询分析和实体抽取。
        
        Args:
            context: 意图识别上下文
            
        Returns:
            IntentResult: 增强的搜索意图识别结果
        """
        # 调用父类的基础识别方法
        result = super().recognize_intent(context)
        
        # 如果识别结果不是搜索类型，进行强制转换
        if result.intent_type != IntentType.SEARCH:
            result.intent_type = IntentType.SEARCH
            result.intent_code = self._classify_search_intent(context.user_input)
            result.description = "搜索意图"
        
        # 提取搜索实体
        entities = self._extract_search_entities(context.user_input)
        result.entities = entities
        
        # 分析搜索查询
        search_analysis = self.classify_search_intent(context.user_input)
        result.metadata.update({"search_intent_code": search_analysis})
        
        return result
    
    def _classify_search_intent(self, user_input: str) -> str:
        """分类搜索意图的具体子类型
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 具体的搜索意图编码
        """
        user_input_lower = user_input.lower()
        
        # 操作指南关键词
        how_to_keywords = ["怎么", "如何", "怎样", "方法", "步骤", "教程", "how to", "how do"]
        
        # 比较分析关键词
        comparison_keywords = ["比较", "对比", "区别", "差异", "哪个好", "vs", "versus", "compare"]
        
        # 推荐建议关键词
        recommendation_keywords = ["推荐", "建议", "哪个", "选择", "recommend", "suggest", "best"]
        
        # 新闻资讯关键词
        news_keywords = ["新闻", "最新", "消息", "资讯", "动态", "news", "latest", "update"]
        
        # 学术研究关键词
        academic_keywords = ["论文", "研究", "学术", "期刊", "文献", "paper", "research", "study"]
        
        # 产品信息关键词
        product_keywords = ["价格", "购买", "产品", "商品", "评价", "price", "buy", "product", "review"]
        
        # 地理位置关键词
        location_keywords = ["在哪", "位置", "地址", "路线", "导航", "where", "location", "address", "route"]
        
        if any(keyword in user_input_lower for keyword in how_to_keywords):
            return "001_how_to_search"
        elif any(keyword in user_input_lower for keyword in comparison_keywords):
            return "001_comparison_search"
        elif any(keyword in user_input_lower for keyword in recommendation_keywords):
            return "001_recommendation_search"
        elif any(keyword in user_input_lower for keyword in news_keywords):
            return "001_news_search"
        elif any(keyword in user_input_lower for keyword in academic_keywords):
            return "001_academic_search"
        elif any(keyword in user_input_lower for keyword in product_keywords):
            return "001_product_search"
        elif any(keyword in user_input_lower for keyword in location_keywords):
            return "001_location_search"
        else:
            return "001_factual_search"
    
    def _extract_search_entities(self, user_input: str) -> List[Entity]:
        """提取搜索相关的实体
        
        Args:
            user_input: 用户输入
            
        Returns:
            List[Entity]: 提取的实体列表
        """
        entities = []
        
        # 简单的实体识别规则（后续可以集成更复杂的NER模型）
        import re
        
        # 时间实体
        time_patterns = [
            r'\d{4}年',
            r'\d{1,2}月',
            r'\d{1,2}日',
            r'今天|明天|昨天',
            r'\d{4}-\d{1,2}-\d{1,2}',
            r'最近|近期|当前'
        ]
        
        for pattern in time_patterns:
            matches = re.finditer(pattern, user_input)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="TIME",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.8
                ))
        
        # 地点实体
        location_patterns = [
            r'[\u4e00-\u9fff]+市',
            r'[\u4e00-\u9fff]+省',
            r'[\u4e00-\u9fff]+区',
            r'[\u4e00-\u9fff]+县',
            r'北京|上海|广州|深圳|杭州|南京|成都|重庆|武汉|西安'
        ]
        
        for pattern in location_patterns:
            matches = re.finditer(pattern, user_input)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="LOCATION",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.8
                ))
        
        # 人名实体（简单规则）
        person_patterns = [
            r'[\u4e00-\u9fff]{2,4}(?=的|说|认为|表示)',
        ]
        
        for pattern in person_patterns:
            matches = re.finditer(pattern, user_input)
            for match in matches:
                entities.append(Entity(
                    text=match.group(),
                    label="PERSON",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.7
                ))
        
        return entities
    
    def extract_search_entities(self, user_input: str) -> List[Entity]:
        """公共方法：提取搜索相关的实体
        
        Args:
            user_input: 用户输入
            
        Returns:
            List[Entity]: 提取的实体列表
        """
        return self._extract_search_entities(user_input)
    
    def classify_search_intent(self, user_input: str) -> Dict[str, Any]:
        """分析搜索查询的特征
        
        Args:
            user_input: 用户输入
            
        Returns:
            Dict[str, Any]: 搜索查询分析结果
        """
        # 提取核心搜索词
        search_query = self._extract_core_query(user_input)
        
        # 判断搜索范围
        search_scope = self._determine_search_scope(user_input)
        
        # 判断紧急程度
        urgency = self._assess_urgency(user_input)
        
        # 搜索类型
        search_type = self._determine_search_type(user_input)
        
        return {
            "search_query": search_query,
            "search_scope": search_scope,
            "urgency": urgency,
            "search_type": search_type,
            "query_length": len(user_input),
            "has_question_mark": "?" in user_input or "？" in user_input
        }
    
    def _extract_core_query(self, user_input: str) -> str:
        """提取核心搜索查询
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 核心搜索查询
        """
        # 移除常见的搜索前缀
        prefixes_to_remove = [
            "请帮我搜索", "帮我找", "我想知道", "请问", "搜索", "查找", "找一下",
            "search for", "find", "look for", "tell me about"
        ]
        
        query = user_input
        for prefix in prefixes_to_remove:
            if query.lower().startswith(prefix.lower()):
                query = query[len(prefix):].strip()
                break
        
        # 移除常见的后缀
        suffixes_to_remove = ["的信息", "的资料", "怎么样", "如何", "吗", "呢"]
        for suffix in suffixes_to_remove:
            if query.lower().endswith(suffix.lower()):
                query = query[:-len(suffix)].strip()
                break
        
        return query or user_input
    
    def _determine_search_scope(self, user_input: str) -> str:
        """确定搜索范围
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 搜索范围
        """
        user_input_lower = user_input.lower()
        
        if any(keyword in user_input_lower for keyword in ["全球", "世界", "国际", "global", "worldwide"]):
            return "global"
        elif any(keyword in user_input_lower for keyword in ["中国", "国内", "本国", "china", "domestic"]):
            return "national"
        elif any(keyword in user_input_lower for keyword in ["本地", "附近", "当地", "local", "nearby"]):
            return "local"
        else:
            return "general"
    
    def _assess_urgency(self, user_input: str) -> str:
        """评估搜索的紧急程度
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 紧急程度
        """
        user_input_lower = user_input.lower()
        
        high_urgency_keywords = ["紧急", "急", "马上", "立即", "现在", "urgent", "immediately", "asap"]
        medium_urgency_keywords = ["尽快", "今天", "soon", "today", "quickly"]
        
        if any(keyword in user_input_lower for keyword in high_urgency_keywords):
            return "high"
        elif any(keyword in user_input_lower for keyword in medium_urgency_keywords):
            return "medium"
        else:
            return "low"
    
    def _determine_search_type(self, user_input: str) -> str:
        """确定搜索类型
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 搜索类型
        """
        user_input_lower = user_input.lower()
        
        if any(keyword in user_input_lower for keyword in ["图片", "照片", "图像", "image", "photo", "picture"]):
            return "image_search"
        elif any(keyword in user_input_lower for keyword in ["视频", "录像", "video", "movie"]):
            return "video_search"
        elif any(keyword in user_input_lower for keyword in ["文档", "文件", "pdf", "document", "file"]):
            return "document_search"
        elif any(keyword in user_input_lower for keyword in ["新闻", "资讯", "news", "article"]):
            return "news_search"
        else:
            return "web_search"
    
    def classify_search_intent(self, user_input: str) -> str:
        """公共方法：分类搜索意图的具体子类型
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 具体的搜索意图编码
        """
        return self._classify_search_intent(user_input)
    
    def analyze_query_features(self, user_input: str) -> Dict[str, Any]:
        """分析搜索查询的特征
        
        Args:
            user_input: 用户输入
            
        Returns:
            Dict[str, Any]: 查询特征分析结果
        """
        # 提取核心搜索词
        search_query = self._extract_core_query(user_input)
        
        # 判断搜索范围
        search_scope = self._determine_search_scope(user_input)
        
        # 判断紧急程度
        urgency = self._assess_urgency(user_input)
        
        # 判断搜索类型
        search_type = self._determine_search_type(user_input)
        
        return {
            "core_query": search_query,
            "search_scope": search_scope,
            "urgency": urgency,
            "search_type": search_type,
            "query_length": len(user_input),
            "has_time_constraint": any(keyword in user_input.lower() for keyword in ["今天", "明天", "最新", "latest", "recent"]),
            "has_location": any(keyword in user_input.lower() for keyword in ["附近", "这里", "nearby", "local"])
        }