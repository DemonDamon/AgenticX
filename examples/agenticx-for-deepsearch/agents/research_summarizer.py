"""
Research Summarizer Agent Implementation
Agent specialized in executing search, summarization, reflection and writing final reports
"""

from agenticx.core.agent import Agent


class ResearchSummarizerAgent(Agent):
    """
    Research Summarizer Agent
    
    Responsible for executing search, summarizing results, reflecting on information adequacy, and writing final reports
    """
    
    def __init__(self, name: str = "Chief Research Analyst", role: str = "Chief Research Analyst",
                 goal: str = "To synthesize information from web searches into a coherent summary, identify knowledge gaps, and produce a final, well-cited research report.",
                 organization_id: str = "deepsearch", **kwargs):
        super().__init__(
            name=name,
            role=role,
            goal=goal,
            backstory="A meticulous analyst with a knack for quickly processing vast amounts of information, identifying key insights, and structuring them into a comprehensive and easy-to-understand report. You always back up your claims with citations and have a keen eye for identifying what information is still missing.",
            organization_id=organization_id,
            tool_names=["google_search_tool"],  # This agent needs to use search tools
            **kwargs
        )
    
    def create_search_and_summarize_prompt(self, query: str, research_topic: str) -> str:
        """
        Create search and summarization prompt
        
        Args:
            query: Search query
            research_topic: Research topic
            
        Returns:
            str: Formatted prompt
        """
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = f"""
您是一位专业的研究分析师。请执行以下搜索查询并总结结果：

搜索查询: {query}
研究主题: {research_topic}

请按照以下步骤进行：
1. 使用 google_search_tool 搜索此查询
2. 分析搜索结果
3. 提取关键信息和要点
4. 创建结构化摘要

摘要格式要求：
- 简洁明了，突出重要信息
- 包含具体事实和数据
- 注明信息来源（如有链接）
- 识别潜在的偏见或不确定性

请以清晰的段落格式输出摘要。
"""
        else:
            prompt = f"""
You are a professional research analyst. Please execute the following search query and summarize the results:

Search Query: {query}
Research Topic: {research_topic}

Please follow these steps:
1. Use google_search_tool to search for this query
2. Analyze the search results
3. Extract key information and main points
4. Create a structured summary

Summary format requirements:
- Concise and clear, highlighting important information
- Include specific facts and data
- Note information sources (if links are available)
- Identify potential biases or uncertainties

Please output the summary in clear paragraph format.
"""
        return prompt
    
    def create_reflection_prompt(self, research_topic: str, all_summaries: list) -> str:
        """
        Create reflection and knowledge gap analysis prompt
        
        Args:
            research_topic: Research topic
            all_summaries: List of all search result summaries
            
        Returns:
            str: Formatted prompt
        """
        combined_summaries = "\n\n---\n\n".join(all_summaries)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = f"""
您是一位专业的研究分析师。请分析以下研究摘要并确定信息是否充分回答了研究主题。

研究主题: {research_topic}

当前收集的信息摘要:
{combined_summaries}

请进行以下分析：
1. 评估当前信息是否充分回答了研究主题
2. 识别剩余的知识空白或未回答的问题
3. 如果信息不足，建议进一步搜索的方向

请以JSON格式返回分析结果：
{{
    "is_sufficient": true/false,
    "knowledge_gaps": "剩余知识空白的描述",
    "next_search_directions": ["方向1", "方向2"]
}}
"""
        else:
            prompt = f"""
You are a professional research analyst. Please analyze the following research summaries and determine if the information sufficiently answers the research topic.

Research Topic: {research_topic}

Currently collected information summaries:
{combined_summaries}

Please conduct the following analysis:
1. Evaluate whether the current information sufficiently answers the research topic
2. Identify remaining knowledge gaps or unanswered questions
3. If information is insufficient, suggest directions for further search

Please return the analysis results in JSON format:
{{
    "is_sufficient": true/false,
    "knowledge_gaps": "Description of remaining knowledge gaps",
    "next_search_directions": ["Direction 1", "Direction 2"]
}}
"""
        return prompt
    
    def create_final_report_prompt(self, research_topic: str, all_summaries: list) -> str:
        """
        Create final report prompt
        
        Args:
            research_topic: Research topic
            all_summaries: List of all search result summaries
            
        Returns:
            str: Formatted prompt
        """
        combined_summaries = "\n\n---\n\n".join(all_summaries)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(research_topic)
        
        if detected_language == "zh":
            prompt = f"""
您是一位专业的研究报告写作专家。请基于以下研究摘要撰写关于"{research_topic}"的综合研究报告。

研究摘要内容:
{combined_summaries}

报告要求：
1. 结构清晰，包括引言、主要发现、分析和结论
2. 整合所有相关信息，避免重复
3. 突出关键发现和重要见解
4. 使用客观、专业的语言
5. 适当引用信息来源
6. 如有不确定性或争议，请明确标注

请生成高质量的研究报告。
"""
        else:
            prompt = f"""
You are a professional research report writing expert. Please write a comprehensive research report on "{research_topic}" based on the following research summaries.

Research summary content:
{combined_summaries}

Report requirements:
1. Clear structure, including introduction, main findings, analysis and conclusions
2. Integrate all relevant information, avoid repetition
3. Highlight key findings and important insights
4. Use objective, professional language
5. Appropriately cite information sources
6. If there are uncertainties or controversies, please clearly indicate them

Please generate a high-quality research report.
"""
        return prompt
    
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