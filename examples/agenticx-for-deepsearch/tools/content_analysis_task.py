"""AgenticX-based content analysis task

This module implements ContentAnalysisTask, responsible for analyzing search result content,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional
from pydantic import Field
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import SearchResult, ResearchContext


class ContentAnalysisTask(Task):
    """Content analysis task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Analyzing search result content quality
    2. Extracting key information
    3. Assessing content relevance
    4. Identifying important concepts and entities
    """
    
    llm_provider: Optional[Any] = Field(default=None, description="LLM provider for content analysis")
    
    def __init__(self, name: str = "ContentAnalysis", 
                 description: str = "Analyze search result content quality, extract key information, and assess relevance",
                 expected_output: str = "Content analysis results with quality scores, key points, and relevance assessments",
                 llm_provider=None, **kwargs):
        super().__init__(
            description=description,
            expected_output=expected_output,
            llm_provider=llm_provider,
            **kwargs
        )
    
    def _detect_language(self, text: str) -> str:
        """Detect input text language"""
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "en"  # Default to English
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # More than 30% Chinese characters
            return "zh"
        else:
            return "en"
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute content analysis task"""
        action = kwargs.get("action", "analyze_content")
        
        if action == "analyze_content":
            return await self._analyze_search_results(kwargs)
        elif action == "extract_entities":
            return await self._extract_entities(kwargs)
        elif action == "assess_relevance":
            return await self._assess_relevance(kwargs)
        elif action == "summarize_content":
            return await self._summarize_content(kwargs)
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _analyze_search_results(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze search result content"""
        search_results = kwargs.get("search_results", [])
        research_topic = kwargs.get("research_topic", "")
        
        if not search_results:
            return {"analysis": [], "summary": "No search results to analyze"}
        
        analysis_results = []
        
        for result in search_results:
            analysis = await self._analyze_single_result(result, research_topic)
            analysis_results.append(analysis)
        
        # Generate overall analysis summary
        summary = await self._generate_analysis_summary(analysis_results, research_topic)
        
        return {
            "analysis": analysis_results,
            "summary": summary,
            "total_analyzed": len(analysis_results)
        }
    
    async def _analyze_single_result(self, result: SearchResult, research_topic: str) -> Dict[str, Any]:
        """Analyze a single search result"""
        if not self.llm_provider:
            # Simple analysis logic
            return {
                "url": result.url,
                "title": result.title,
                "content_length": len(result.content or ""),
                "snippet_length": len(result.snippet or ""),
                "relevance_score": self._calculate_simple_relevance(result, research_topic),
                "key_points": self._extract_simple_key_points(result)
            }
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        # Use LLM for deep analysis with dynamic language
        if detected_language == "zh":
            prompt = f"""
请分析以下搜索结果与研究主题"{research_topic}"的相关性和质量：

标题: {result.title}
摘要: {result.snippet}
内容: {result.content[:1000] if result.content else '无详细内容'}

请从以下维度进行分析：
1. 内容质量（1-10分）
2. 相关性（1-10分）
3. 信息价值（1-10分）
4. 关键要点（列出3-5个）

请以JSON格式返回分析结果。
"""
        else:
            prompt = f"""
Please analyze the relevance and quality of the following search result to the research topic "{research_topic}":

Title: {result.title}
Summary: {result.snippet}
Content: {result.content[:1000] if result.content else 'No detailed content'}

Please analyze from the following dimensions:
1. Content quality (1-10 points)
2. Relevance (1-10 points)
3. Information value (1-10 points)
4. Key points (list 3-5)

Please return analysis results in JSON format.
"""
        
        message = Message(content=prompt, sender=self.name)
        response = await self.llm_provider.generate(message.content)
        
        try:
            # Try to parse JSON response
            import json
            analysis = json.loads(response)
        except:
            # If parsing fails, return basic analysis
            if detected_language == "zh":
                analysis = {
                    "content_quality": 5,
                    "relevance": 5,
                    "information_value": 5,
                    "key_points": ["分析失败"],
                    "credibility": "未知"
                }
            else:
                analysis = {
                    "content_quality": 5,
                    "relevance": 5,
                    "information_value": 5,
                    "key_points": ["Analysis failed"],
                    "credibility": "Unknown"
                }
        
        analysis["url"] = result.url
        analysis["title"] = result.title
        return analysis
    
    async def _extract_entities(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Extract entity information"""
        content = kwargs.get("content", "")
        
        if not content:
            return {"entities": [], "count": 0}
        
        # Simple entity extraction logic
        entities = self._extract_simple_entities(content)
        
        return {
            "entities": entities,
            "count": len(entities)
        }
    
    async def _assess_relevance(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Assess content relevance"""
        content = kwargs.get("content", "")
        research_topic = kwargs.get("research_topic", "")
        
        relevance_score = self._calculate_simple_relevance_by_content(content, research_topic)
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            assessment = "高" if relevance_score > 0.7 else "中" if relevance_score > 0.4 else "低"
        else:
            assessment = "High" if relevance_score > 0.7 else "Medium" if relevance_score > 0.4 else "Low"
        
        return {
            "relevance_score": relevance_score,
            "assessment": assessment
        }
    
    async def _summarize_content(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Summarize content"""
        content = kwargs.get("content", "")
        max_length = kwargs.get("max_length", 200)
        
        if not content:
            # Detect language based on content or use default
            detected_language = self._detect_language(content) if content else "en"
            error_msg = "无内容可总结" if detected_language == "zh" else "No content to summarize"
            return {"summary": error_msg}
        
        # Simple summarization logic
        summary = content[:max_length] + "..." if len(content) > max_length else content
        
        return {"summary": summary}
    
    def _calculate_simple_relevance(self, result: SearchResult, research_topic: str) -> float:
        """Calculate simple relevance score"""
        text = f"{result.title} {result.snippet} {result.content or ''}".lower()
        topic_words = research_topic.lower().split()
        
        matches = sum(1 for word in topic_words if word in text)
        return min(matches / len(topic_words), 1.0) if topic_words else 0.0
    
    def _calculate_simple_relevance_by_content(self, content: str, research_topic: str) -> float:
        """Calculate relevance based on content"""
        text = content.lower()
        topic_words = research_topic.lower().split()
        
        matches = sum(1 for word in topic_words if word in text)
        return min(matches / len(topic_words), 1.0) if topic_words else 0.0
    
    def _extract_simple_key_points(self, result: SearchResult) -> List[str]:
        """Extract simple key points"""
        content = result.snippet or result.content or ""
        sentences = content.split('。')[:3]  # Take first 3 sentences
        return [s.strip() for s in sentences if s.strip()]
    
    def _extract_simple_entities(self, content: str) -> List[Dict[str, str]]:
        """Simple entity extraction"""
        import re
        
        # Simple entity recognition pattern
        entities = []
        
        # Extract possible organization names (starts with uppercase letters)
        org_pattern = r'\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b'
        orgs = re.findall(org_pattern, content)
        for org in orgs[:5]:  # Limit quantity
            entities.append({"text": org, "type": "organization"})
        
        # Extract numbers
        num_pattern = r'\b\d+(?:\.\d+)?\b'
        nums = re.findall(num_pattern, content)
        for num in nums[:5]:  # Limit quantity
            entities.append({"text": num, "type": "number"})
        
        return entities
    
    async def _generate_analysis_summary(self, analysis_results: List[Dict], research_topic: str) -> str:
        """Generate analysis summary"""
        if not analysis_results:
            # Detect language based on research topic
            detected_language = self._detect_language(research_topic)
            return "无分析结果" if detected_language == "zh" else "No analysis results"
        
        total_results = len(analysis_results)
        avg_relevance = sum(r.get("relevance_score", 0) for r in analysis_results) / total_results
        
        # Detect language based on research topic
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            return f"分析了{total_results}个搜索结果，平均相关性分数为{avg_relevance:.2f}。"
        else:
            return f"Analyzed {total_results} search results, average relevance score is {avg_relevance:.2f}."