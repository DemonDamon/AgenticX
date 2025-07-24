"""Search Analyzer Agent Implementation
Specialized agent for analyzing search result quality, relevance, and completeness
"""

from typing import List, Dict, Any
from agenticx.core.agent import Agent
from agenticx.core.prompt import PromptTemplate
from agenticx.core.message import Message
from models import SearchResult, ResearchContext, KnowledgeGap


class SearchAnalyzerAgent(Agent):
    """Search Analyzer Agent
    
    Responsible for analyzing the quality, relevance, and completeness of search results,
    identifying information gaps and areas requiring further search
    """
    
    def __init__(self, name: str = "Search Analysis Expert", role: str = "Search Quality Analyst", 
                 goal: str = "To analyze search results quality, relevance, and completeness, identifying information gaps and areas requiring further investigation.",
                 organization_id: str = "deepsearch", **kwargs):
        super().__init__(
            id="search_analyzer_agent",
            name=name,
            role=role,
            goal=goal,
            backstory="An experienced information analyst with expertise in evaluating search result quality, identifying relevant information, and detecting knowledge gaps in research data.",
            organization_id=organization_id,
            tool_names=[],  # This agent mainly performs analysis and doesn't need external tools
            **kwargs
        )
    
    def analyze_search_results(self, search_results: List[SearchResult], 
                             research_topic: str, research_objective: str) -> Dict[str, Any]:
        """Analyze the quality and relevance of search results
        
        Args:
            search_results: List of search results
            research_topic: Research topic
            research_objective: Research objective
            
        Returns:
            Dict: Analysis results including quality scores and relevance analysis
        """
        results_summary = self._format_search_results(search_results)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位专业的搜索结果分析专家。请分析以下搜索结果的质量和相关性。

研究主题: {research_topic}
研究目标: {research_objective}

搜索结果:
{results_summary}

请从以下维度分析搜索结果：

1. **整体质量评估**：
   - 信息源的权威性和可信度
   - 内容的准确性和时效性
   - 信息的深度和广度

2. **相关性分析**：
   - 与研究主题的匹配度
   - 对研究目标的支持程度
   - 信息的实用价值

3. **完整性评估**：
   - 覆盖的知识领域
   - 缺失的重要信息
   - 需要补充的方面

4. **信息质量分类**：
   - 高质量信息（权威、准确、相关）
   - 中等质量信息（部分有用）
   - 低质量信息（不相关或不可靠）

请以JSON格式输出分析结果：
```json
{{
  "overall_quality_score": 0.0-1.0,
  "relevance_score": 0.0-1.0,
  "completeness_score": 0.0-1.0,
  "high_quality_results": ["结果索引列表"],
  "medium_quality_results": ["结果索引列表"],
  "low_quality_results": ["结果索引列表"],
  "key_findings": ["关键发现1", "关键发现2"],
  "information_gaps": ["信息空白1", "信息空白2"],
  "recommendations": ["建议1", "建议2"]
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a professional search result analysis expert. Please analyze the quality and relevance of the following search results.

Research Topic: {research_topic}
Research Objective: {research_objective}

Search Results:
{results_summary}

Please analyze the search results from the following dimensions:

1. **Overall Quality Assessment**:
   - Authority and credibility of information sources
   - Accuracy and timeliness of content
   - Depth and breadth of information

2. **Relevance Analysis**:
   - Match with research topic
   - Support for research objectives
   - Practical value of information

3. **Completeness Assessment**:
   - Knowledge areas covered
   - Missing important information
   - Areas that need supplementation

4. **Information Quality Classification**:
   - High-quality information (authoritative, accurate, relevant)
   - Medium-quality information (partially useful)
   - Low-quality information (irrelevant or unreliable)

Please output analysis results in JSON format:
```json
{
  "overall_quality_score": 0.0-1.0,
  "relevance_score": 0.0-1.0,
  "completeness_score": 0.0-1.0,
  "high_quality_results": ["Result index list"],
  "medium_quality_results": ["Result index list"],
  "low_quality_results": ["Result index list"],
  "key_findings": ["Key finding 1", "Key finding 2"],
  "information_gaps": ["Information gap 1", "Information gap 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=research_topic,
                research_objective=research_objective,
                results_summary=results_summary
            ),
            sender=self.name,
            message_type="search_analysis"
        )
        
        response = self.llm.generate(message.content)
        return self._parse_analysis_response(response)
    
    def identify_information_gaps(self, context: ResearchContext) -> List[KnowledgeGap]:
        """Identify information gaps
        
        Args:
            context: Research context
            
        Returns:
            List[KnowledgeGap]: List of identified knowledge gaps
        """
        all_results = context.get_all_search_results()
        current_findings = context.get_current_findings()
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位专业的信息分析专家。请基于当前研究进展识别需要进一步探索的信息空白。

研究主题: {research_topic}
研究目标: {research_objective}

当前研究发现:
{current_findings}

收集的搜索结果数量: {results_count}

请分析并识别以下类型的信息空白：

1. **核心概念空白**: 缺失的关键概念或定义
2. **技术细节空白**: 不清楚的技术实现或原理
3. **应用案例空白**: 缺乏实际应用示例
4. **比较分析空白**: 缺乏不同解决方案的比较
5. **最新发展空白**: 缺乏最新发展信息
6. **权威观点空白**: 缺乏专家或权威机构观点

请以JSON格式输出识别的信息空白：
```json
{{
  "knowledge_gaps": [
    {{
      "gap_type": "空白类型",
      "description": "空白描述",
      "importance": "high/medium/low",
      "suggested_queries": ["建议查询1", "建议查询2"],
      "expected_sources": ["期望信息源类型"]
    }}
  ]
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a professional information analysis expert. Please identify information gaps that need further exploration based on current research progress.

Research Topic: {research_topic}
Research Objective: {research_objective}

Current Research Findings:
{current_findings}

Number of collected search results: {results_count}

Please analyze and identify the following types of information gaps:

1. **Core Concept Gaps**: Missing key concepts or definitions
2. **Technical Detail Gaps**: Unclear technical implementation or principles
3. **Application Case Gaps**: Lack of practical application examples
4. **Comparative Analysis Gaps**: Lack of comparison between different solutions
5. **Latest Development Gaps**: Lack of latest development information
6. **Authoritative Opinion Gaps**: Lack of expert or authoritative institutional opinions

Please output identified information gaps in JSON format:
```json
{
  "knowledge_gaps": [
    {
      "gap_type": "Gap type",
      "description": "Gap description",
      "importance": "high/medium/low",
      "suggested_queries": ["Suggested query 1", "Suggested query 2"],
      "expected_sources": ["Expected source type"]
    }
  ]
}
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                research_objective=context.research_objective,
                current_findings=self._format_findings(current_findings),
                results_count=len(all_results)
            ),
            sender=self.name,
            message_type="gap_analysis"
        )
        
        response = self.llm.generate(message.content)
        return self._parse_knowledge_gaps(response)
    
    def evaluate_search_strategy(self, context: ResearchContext) -> Dict[str, Any]:
        """Evaluate the effectiveness of current search strategy
        
        Args:
            context: Research context
            
        Returns:
            Dict: Strategy evaluation results and improvement suggestions
        """
        search_history = context.get_search_history()
        results_quality = context.get_results_quality_metrics()
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位搜索策略专家。请评估当前搜索策略的有效性并提供改进建议。

研究主题: {research_topic}
搜索历史: {search_history}
结果质量指标: {results_quality}

请从以下方面评估搜索策略：

1. **查询多样性**: 查询类型和视角的丰富程度
2. **搜索深度**: 信息获取的深度
3. **覆盖广度**: 主题覆盖的全面性
4. **结果质量**: 获得高质量信息的比例
5. **效率评估**: 搜索效率和冗余度

请提供具体的改进建议和下一步搜索方向。

以JSON格式输出评估结果：
```json
{{
  "strategy_effectiveness": 0.0-1.0,
  "diversity_score": 0.0-1.0,
  "depth_score": 0.0-1.0,
  "coverage_score": 0.0-1.0,
  "efficiency_score": 0.0-1.0,
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["不足1", "不足2"],
  "improvement_suggestions": ["建议1", "建议2"],
  "next_search_directions": ["方向1", "方向2"]
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a search strategy expert. Please evaluate the effectiveness of current search strategy and provide improvement suggestions.

Research Topic: {research_topic}
Search History: {search_history}
Result Quality Metrics: {results_quality}

Please evaluate the search strategy from the following aspects:

1. **Query Diversity**: Richness of query types and perspectives
2. **Search Depth**: Depth of information acquisition
3. **Coverage Breadth**: Comprehensiveness of topic coverage
4. **Result Quality**: Proportion of high-quality information obtained
5. **Efficiency Assessment**: Search efficiency and redundancy

Please provide specific improvement suggestions and next search directions.

Output evaluation results in JSON format:
```json
{
  "strategy_effectiveness": 0.0-1.0,
  "diversity_score": 0.0-1.0,
  "depth_score": 0.0-1.0,
  "coverage_score": 0.0-1.0,
  "efficiency_score": 0.0-1.0,
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "improvement_suggestions": ["Suggestion 1", "Suggestion 2"],
  "next_search_directions": ["Direction 1", "Direction 2"]
}
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                search_history=self._format_search_history(search_history),
                results_quality=str(results_quality)
            ),
            sender=self.name,
            message_type="strategy_evaluation"
        )
        
        response = self.llm.generate(message.content)
        return self._parse_strategy_evaluation(response)
    
    def _format_search_results(self, results: List[SearchResult]) -> str:
        """Format search results as text"""
        formatted = []
        for i, result in enumerate(results):
            formatted.append(f"{i+1}. {result.title}\n   URL: {result.url}\n   Summary: {result.snippet}")
        return "\n\n".join(formatted)
    
    def _format_findings(self, findings: List[str]) -> str:
        """Format research findings"""
        return "\n".join([f"- {finding}" for finding in findings])
    
    def _format_search_history(self, history: List[Dict]) -> str:
        """Format search history"""
        formatted = []
        for item in history:
            formatted.append(f"Query: {item.get('query', '')} | Results: {item.get('result_count', 0)}")
        return "\n".join(formatted)
    
    def _parse_analysis_response(self, response: str) -> Dict[str, Any]:
        """Parse analysis response"""
        # This should implement JSON parsing logic
        # Simplified implementation, actual should have more robust JSON parsing
        try:
            import json
            # Extract JSON part
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                return json.loads(json_str)
        except:
            pass
        
        # If parsing fails, return default structure
        return {
            "overall_quality_score": 0.5,
            "relevance_score": 0.5,
            "completeness_score": 0.5,
            "high_quality_results": [],
            "medium_quality_results": [],
            "low_quality_results": [],
            "key_findings": [],
            "information_gaps": [],
            "recommendations": []
        }
    
    def _parse_knowledge_gaps(self, response: str) -> List[KnowledgeGap]:
        """Parse knowledge gaps response"""
        # Simplified implementation, actual should have more robust parsing logic
        gaps = []
        try:
            import json
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                data = json.loads(json_str)
                for gap_data in data.get('knowledge_gaps', []):
                    gap = KnowledgeGap(
                        gap_type=gap_data.get('gap_type', ''),
                        description=gap_data.get('description', ''),
                        importance=gap_data.get('importance', 'medium'),
                        suggested_queries=gap_data.get('suggested_queries', []),
                        expected_sources=gap_data.get('expected_sources', [])
                    )
                    gaps.append(gap)
        except:
            pass
        
        return gaps
    
    def _parse_strategy_evaluation(self, response: str) -> Dict[str, Any]:
        """Parse strategy evaluation response"""
        try:
            import json
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                return json.loads(json_str)
        except:
            pass
        
        return {
            "strategy_effectiveness": 0.5,
            "diversity_score": 0.5,
            "depth_score": 0.5,
            "coverage_score": 0.5,
            "efficiency_score": 0.5,
            "strengths": [],
            "weaknesses": [],
            "improvement_suggestions": [],
            "next_search_directions": []
        }
    
    def _detect_language(self, text: str) -> str:
        """Detect the language of the input text"""
        # Simple language detection based on character sets
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "en"  # Default to English if no alphabetic characters
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # If more than 30% are Chinese characters
            return "zh"
        else:
            return "en"