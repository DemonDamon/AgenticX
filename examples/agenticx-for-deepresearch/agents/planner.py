"""AgenticX-based Planning Agent

This module implements PlannerAgent, responsible for formulating research strategies,
identifying knowledge gaps, determining iteration directions, strictly following
the AgenticX framework's Agent abstraction.
"""

import json
import logging
from typing import List, Dict, Any, Optional

from agenticx.core.agent import Agent
from agenticx.core.message import Message
from agenticx.core.prompt import PromptTemplate
from models import (
    ResearchContext, 
    KnowledgeGap, 
    SearchResult, 
    ResearchIteration,
    ResearchPhase,
    QueryType
)


class PlannerAgent(Agent):
    """Planning Agent
    
    Based on agenticx.core.Agent implementation, responsible for:
    1. Formulating research strategies and plans
    2. Identifying knowledge gaps and research directions
    3. Deciding whether to continue iterations
    4. Adjusting search strategies
    """
    
    def __init__(self, name: str = "Research Planning Expert", role: str = "Research Planning Expert", 
                 goal: str = "Formulate efficient research strategies, identify knowledge gaps, guide multi-round reflective research processes",
                 organization_id: str = "deepsearch", llm_provider=None, **kwargs):
        super().__init__(
            name=name,
            role=role,
            goal=goal,
            organization_id=organization_id,
            backstory=(
                "You are an experienced research planning expert, skilled at analyzing complex research problems, "
                "identifying knowledge gaps, and formulating systematic research strategies. You can grasp research directions "
                "from a macro perspective, ensuring the completeness and depth of the research process."
            ),
            **kwargs
        )
        
        # 设置 LLM 提供者
        self.llm = llm_provider
        if self.llm is None:
            # 如果没有提供 LLM，尝试从 kwargs 或环境变量创建
            from agenticx.llms.kimi_provider import KimiProvider
            import os
            
            api_key = os.getenv('KIMI_API_KEY') or os.getenv('OPENAI_API_KEY')
            if api_key:
                self.llm = KimiProvider(
                    model="kimi-k2-0711-preview",
                    api_key=api_key,
                    base_url=os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1'),
                    temperature=0.7
                )
            else:
                raise ValueError("需要提供 llm_provider 参数或设置 KIMI_API_KEY/OPENAI_API_KEY 环境变量")
        
        # 设置 logger
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    def create_initial_research_plan(self, research_topic: str, research_objective: str) -> str:
        """Create initial research plan"""
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位资深的研究规划专家。请为以下研究主题制定系统性的研究计划。

研究主题: {research_topic}
研究目标: {research_objective}

请分析这个研究主题并制定详细的研究计划，包括：

1. **研究范围分析**：
   - 核心研究领域
   - 相关子领域
   - 研究边界

2. **关键研究维度**：
   - 主要探索方面
   - 重要研究视角
   - 潜在研究深度

3. **初始搜索策略**：
   - 建议的搜索关键词
   - 搜索优先级
   - 预期信息源类型

4. **研究路径规划**：
   - 建议的研究顺序
   - 每个阶段的重点
   - 可能的迭代方向

请以结构化的方式输出研究计划，确保逻辑清晰、覆盖全面。
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a senior research planning expert. Please formulate a systematic research plan for the following research topic.

Research Topic: {research_topic}
Research Objective: {research_objective}

Please analyze this research topic and formulate a detailed research plan, including:

1. **Research Scope Analysis**:
   - Core research areas
   - Related sub-fields
   - Research boundaries

2. **Key Research Dimensions**:
   - Main aspects to explore
   - Important research perspectives
   - Potential research depth

3. **Initial Search Strategy**:
   - Suggested search keywords
   - Search priorities
   - Expected information source types

4. **Research Path Planning**:
   - Suggested research sequence
   - Focus of each stage
   - Possible iteration directions

Please output the research plan in a structured manner, ensuring clear logic and comprehensive coverage.
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=research_topic,
                research_objective=research_objective
            ),
            sender_id=self.id,
            recipient_id="system"
        )
        
        if self.llm is None:
            raise ValueError("LLM provider is not initialized")
        
        response = self.llm.generate(message.content)
        return response
    
    def identify_knowledge_gaps(self, context: ResearchContext) -> List[KnowledgeGap]:
        """Identify knowledge gaps"""
        # Get current research status
        current_iteration = context.get_current_iteration()
        all_results = context.get_all_search_results()
        
        # Build analysis prompt
        results_summary = self._summarize_search_results(all_results)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位研究分析专家。请分析当前研究进展并识别知识空白和需要进一步探索的领域。

研究主题: {research_topic}
研究目标: {research_objective}
当前迭代: {current_iteration}/{max_iterations}

收集信息摘要:
{results_summary}

请仔细分析现有信息并识别以下类型的知识空白：

1. **缺失信息**: 尚未覆盖的重要信息点
2. **深度不足**: 需要更深入探索的某些方面
3. **单一视角**: 缺乏多角度分析
4. **时效性问题**: 需要更新的信息
5. **缺失联系**: 与相关领域联系不足

对于每个识别的知识空白，请提供：
- 空白描述
- 重要性评分（1-10）
- 建议的搜索查询
- 预期信息类型

请以JSON格式输出如下：
```json
[
  {{
    "topic": "知识空白主题",
    "description": "详细描述",
    "priority": 8,
    "suggested_queries": ["查询1", "查询2"],
    "expected_info_type": "预期信息类型"
  }}
]
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a research analysis expert. Please analyze the current research progress and identify knowledge gaps and areas that need further exploration.

Research Topic: {research_topic}
Research Objective: {research_objective}
Current Iteration: {current_iteration}/{max_iterations}

Summary of collected information:
{results_summary}

Please carefully analyze the existing information and identify the following types of knowledge gaps:

1. **Missing Information**: Important information points not yet covered
2. **Insufficient Depth**: Some aspects need deeper exploration
3. **Single Perspective**: Lack of multi-angle analysis
4. **Timeliness Issues**: Information that needs updating
5. **Missing Connections**: Insufficient connections to related fields

For each identified knowledge gap, please provide:
- Gap description
- Importance score (1-10)
- Suggested search queries
- Expected information type

Please output in JSON format as follows:
```json
[
  {
    "topic": "Knowledge gap topic",
    "description": "Detailed description",
    "priority": 8,
    "suggested_queries": ["Query 1", "Query 2"],
    "expected_info_type": "Expected information type"
  }
]
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                research_objective=context.research_objective,
                current_iteration=context.current_iteration,
                max_iterations=context.max_iterations,
                results_summary=results_summary
            ),
            sender_id=self.id,
            recipient_id="system"
        )
        
        if self.llm is None:
            raise ValueError("LLM provider is not initialized")
        
        response = self.llm.generate(message.content)
        
        # Parse JSON response
        try:
            gaps_data = self._extract_json_from_response(response)
            knowledge_gaps = []
            
            for gap_data in gaps_data:
                gap = KnowledgeGap(
                    topic=gap_data.get("topic", ""),
                    description=gap_data.get("description", ""),
                    priority=gap_data.get("priority", 5),
                    suggested_queries=gap_data.get("suggested_queries", []),
                    identified_by=self.name
                )
                knowledge_gaps.append(gap)
            
            return knowledge_gaps
            
        except Exception as e:
            self.logger.error(f"Failed to parse knowledge gap identification results: {e}")
            return []
    
    def should_continue_research(self, context: ResearchContext) -> Dict[str, Any]:
        """Determine whether research should continue"""
        current_gaps = context.get_all_knowledge_gaps()
        recent_gaps = []
        if context.iterations:
            recent_gaps = context.iterations[-1].identified_gaps
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位研究决策专家。请分析当前研究状态并决定是否继续进行下一轮研究。

研究主题: {research_topic}
当前迭代: {current_iteration}/{max_iterations}
总知识空白: {total_gaps}
最近发现的空白: {recent_gaps_count}

最近识别的知识空白:
{recent_gaps_summary}

请考虑以下决策因素：
1. 是否还有需要填补的重要知识空白
2. 当前信息是否足以回答研究目标
3. 继续研究的边际效益
4. 迭代次数限制

请以JSON格式输出决策结果：
```json
{{
  "should_continue": true/false,
  "confidence": 0.85,
  "reasoning": "决策推理",
  "suggested_focus": ["建议关注方向1", "建议关注方向2"],
  "estimated_completion": "预计完成百分比"
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a research decision expert. Please analyze the current research status and decide whether to continue with the next round of research.

Research Topic: {research_topic}
Current Iteration: {current_iteration}/{max_iterations}
Total Knowledge Gaps: {total_gaps}
Recently Discovered Gaps: {recent_gaps_count}

Recently identified knowledge gaps:
{recent_gaps_summary}

Please consider the following factors for decision-making:
1. Are there still important knowledge gaps that need to be filled
2. Is the current information sufficient to answer the research objectives
3. Marginal benefits of continuing research
4. Iteration count limitations

Please output the decision result in JSON format:
```json
{
  "should_continue": true/false,
  "confidence": 0.85,
  "reasoning": "Decision reasoning",
  "suggested_focus": ["Suggested focus direction 1", "Suggested focus direction 2"],
  "estimated_completion": "Estimated completion percentage"
}
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                current_iteration=context.current_iteration,
                max_iterations=context.max_iterations,
                total_gaps=len(current_gaps),
                recent_gaps_count=len(recent_gaps),
                recent_gaps_summary=self._format_gaps_summary(recent_gaps)
            ),
            sender_id=self.id,
            recipient_id="system"
        )
        
        if self.llm is None:
            raise ValueError("LLM provider is not initialized")
        
        response = self.llm.generate(message.content)
        
        try:
            decision = self._extract_json_from_response(response)
            return decision
        except Exception as e:
            self.logger.error(f"Failed to parse research continuation decision: {e}")
            # Default decision logic
            return {
                "should_continue": context.should_continue(),
                "confidence": 0.5,
                "reasoning": "Decision based on default logic",
                "suggested_focus": [],
                "estimated_completion": "Unknown"
            }
    
    def adjust_search_strategy(self, context: ResearchContext, gaps: List[KnowledgeGap]) -> Dict[str, Any]:
        """Adjust search strategy"""
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位搜索策略专家。基于已识别的知识空白，请调整和优化搜索策略。

研究主题: {research_topic}
当前迭代: {current_iteration}

已识别的知识空白:
{gaps_summary}

请制定优化的搜索策略，包括：

1. **查询优化**：
   - 针对性搜索查询
   - 查询优先级排序
   - 搜索语言建议

2. **搜索引擎选择**：
   - 推荐的搜索引擎
   - 不同引擎的使用场景

3. **搜索参数调整**：
   - 结果数量建议
   - 搜索深度设置

4. **信息过滤策略**：
   - 关键信息指标
   - 质量评估标准

请以JSON格式输出策略建议：
```json
{{
  "priority_queries": [
    {{
      "query": "搜索查询",
      "priority": 9,
      "query_type": "deep_dive",
      "expected_results": 15,
      "target_engines": ["google", "bochaai"]
    }}
  ],
  "search_focus": "本轮搜索的重点",
  "quality_criteria": ["质量标准1", "质量标准2"]
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a search strategy expert. Based on the identified knowledge gaps, please adjust and optimize the search strategy.

Research Topic: {research_topic}
Current Iteration: {current_iteration}

Identified knowledge gaps:
{gaps_summary}

Please formulate an optimized search strategy, including:

1. **Query Optimization**:
   - Targeted search queries
   - Query priority ranking
   - Search language suggestions

2. **Search Engine Selection**:
   - Recommended search engines
   - Use cases for different engines

3. **Search Parameter Adjustment**:
   - Result quantity recommendations
   - Search depth settings

4. **Information Filtering Strategy**:
   - Key information indicators
   - Quality assessment criteria

Please output strategy recommendations in JSON format:
```json
{
  "priority_queries": [
    {
      "query": "Search query",
      "priority": 9,
      "query_type": "deep_dive",
      "expected_results": 15,
      "target_engines": ["google", "bochaai"]
    }
  ],
  "search_focus": "Focus of this round of search",
  "quality_criteria": ["Quality standard 1", "Quality standard 2"]
}
```
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                current_iteration=context.current_iteration,
                gaps_summary=self._format_gaps_summary(gaps)
            ),
            sender_id=self.id,
            recipient_id="system"
        )
        
        if self.llm is None:
            raise ValueError("LLM provider is not initialized")
        
        response = self.llm.generate(message.content)
        
        try:
            strategy = self._extract_json_from_response(response)
            return strategy
        except Exception as e:
            self.logger.error(f"Failed to parse search strategy adjustment: {e}")
            return {
                "priority_queries": [],
                "search_focus": "Continue in-depth research",
                "quality_criteria": ["Relevance", "Authority", "Timeliness"]
            }
    
    def _summarize_search_results(self, results: List[SearchResult]) -> str:
        """Summarize search results"""
        if not results:
            return "No search results available"
        
        summary = f"Collected {len(results)} search results in total:\n\n"
        
        # Group by source
        by_source = {}
        for result in results:
            source = result.source.value
            if source not in by_source:
                by_source[source] = []
            by_source[source].append(result)
        
        for source, source_results in by_source.items():
            summary += f"**{source.upper()}** ({len(source_results)} results):\n"
            for i, result in enumerate(source_results[:3], 1):  # Only show first 3 results
                summary += f"{i}. {result.title}\n   {result.snippet[:100]}...\n"
            if len(source_results) > 3:
                summary += f"   ... {len(source_results) - 3} more results\n"
            summary += "\n"
        
        return summary
    
    def _format_gaps_summary(self, gaps: List[KnowledgeGap]) -> str:
        """Format knowledge gaps summary"""
        if not gaps:
            return "No identified knowledge gaps"
        
        summary = ""
        for i, gap in enumerate(gaps, 1):
            summary += f"{i}. **{gap.topic}** (Priority: {gap.priority})\n"
            summary += f"   {gap.description}\n"
            if gap.suggested_queries:
                summary += f"   Suggested queries: {', '.join(gap.suggested_queries[:2])}\n"
            summary += "\n"
        
        return summary
    
    def _extract_json_from_response(self, response: str) -> Any:
        """Extract JSON from response"""
        # Try to find JSON code block
        import re
        json_pattern = r'```json\s*([\s\S]*?)\s*```'
        match = re.search(json_pattern, response)
        
        if match:
            json_str = match.group(1)
        else:
            # If no code block, try direct parsing
            json_str = response
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Try to fix common JSON format issues
            json_str = json_str.strip()
            if not json_str.startswith(('{', '[')):
                # Find the first { or [
                start_idx = max(json_str.find('{'), json_str.find('['))
                if start_idx != -1:
                    json_str = json_str[start_idx:]
            
            return json.loads(json_str)
    
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