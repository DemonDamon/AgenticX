"""AgenticX-based Report Writing Agent

This module implements ReportWriterAgent, responsible for writing structured research reports,
managing citations and formatting, strictly following the AgenticX framework's Agent abstraction.
"""

from typing import List, Dict, Any, Optional
import json
from datetime import datetime
from agenticx.core.agent import Agent
from agenticx.core.message import Message
from agenticx.core.prompt import PromptTemplate
from models import (
    ResearchContext, 
    ResearchReport,
    ReportSection,
    Citation,
    SearchResult
)


class ReportWriterAgent(Agent):
    """Report Writing Agent
    
    Based on agenticx.core.Agent implementation, responsible for:
    1. Writing structured research reports
    2. Managing citations and references
    3. Formatting report content
    4. Ensuring report quality and completeness
    """
    
    def __init__(self, name: str = "Research Report Writing Expert", role: str = "Research Report Writer", 
                 goal: str = "Write high-quality structured research reports, ensuring accurate content, clear logic, and standardized citations",
                 organization_id: str = "deepsearch", **kwargs):
        super().__init__(
            name=name,
            role=role,
            goal=goal,
            organization_id=organization_id,
            backstory=(
                "You are an experienced research report writing expert, skilled at organizing complex research information "
                "into well-structured, logically rigorous academic reports. You are proficient in various citation formats "
                "and can ensure the academic standards and readability of reports."
            ),
            **kwargs
        )
    
    def generate_report_outline(self, context: ResearchContext) -> Dict[str, Any]:
        """Generate report outline"""
        all_results = context.get_all_search_results()
        findings_summary = self._summarize_findings(context)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位专业的研究报告写作专家。请为以下研究主题设计详细的研究报告大纲。

研究主题: {research_topic}
研究目标: {research_objective}
研究迭代次数: {iterations_count}
收集信息数量: {results_count}

研究发现摘要:
{findings_summary}

请设计结构化的报告大纲，包括：

1. **报告标题**: 准确反映研究内容的标题
2. **摘要结构**: 摘要应包含的关键要素
3. **主要章节**: 详细的章节结构，每个章节包括：
   - 章节标题
   - 章节目标
   - 主要内容要点
   - 预期长度

报告应遵循学术写作标准，逻辑清晰，层次分明。

请以JSON格式输出大纲：
```json
{{
  "title": "报告标题",
  "abstract_elements": ["摘要要素1", "摘要要素2"],
  "sections": [
    {{
      "title": "章节标题",
      "level": 1,
      "objective": "章节目标",
      "content_points": ["要点1", "要点2"],
      "estimated_length": "预期字数",
      "subsections": [
        {{
          "title": "子章节标题",
          "level": 2,
          "content_points": ["子要点1"]
        }}
      ]
    }}
  ]
}}
```
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a professional research report writing expert. Please design a detailed report outline for the following research topic.

Research Topic: {research_topic}
Research Objective: {research_objective}
Research Iterations: {iterations_count}
Collected Information Count: {results_count}

Research findings summary:
{findings_summary}

Please design a structured report outline, including:

1. **Report Title**: A title that accurately reflects the research content
2. **Abstract Structure**: Key elements that the abstract should contain
3. **Main Sections**: Detailed section structure, each section including:
   - Section title
   - Section objective
   - Main content points
   - Expected length

The report should follow academic writing standards, with clear logic and distinct levels.

Please output the outline in JSON format:
```json
{
  "title": "Report Title",
  "abstract_elements": ["Abstract Element 1", "Abstract Element 2"],
  "sections": [
    {
      "title": "Section Title",
      "level": 1,
      "objective": "Section Objective",
      "content_points": ["Point 1", "Point 2"],
      "estimated_length": "Expected Word Count",
      "subsections": [
        {
          "title": "Subsection Title",
          "level": 2,
          "content_points": ["Sub-point 1"]
        }
      ]
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
                iterations_count=len(context.iterations),
                results_count=len(all_results),
                findings_summary=findings_summary
            ),
            sender=self.name,
            message_type="outline_generation"
        )
        
        response = self.llm.generate(message.content)
        
        try:
            outline = self._extract_json_from_response(response)
            return outline
        except Exception as e:
            self.logger.error(f"Failed to parse report outline: {e}")
            return self._create_default_outline(context)
    
    def write_abstract(self, context: ResearchContext, outline: Dict[str, Any]) -> str:
        """Write report abstract"""
        key_findings = self._extract_key_findings(context)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位专业的学术写作专家。请为以下研究撰写简洁而全面的摘要。

研究主题: {research_topic}
研究目标: {research_objective}

摘要应包含的要素:
{abstract_elements}

关键研究发现:
{key_findings}

请撰写200-300字的摘要，包括：
1. 研究背景和目标
2. 研究方法概述
3. 主要发现
4. 结论和意义

摘要应准确、简洁、自包含，让读者能够快速理解研究的核心内容。
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a professional academic writing expert. Please write a concise and comprehensive abstract for the following research.

Research Topic: {research_topic}
Research Objective: {research_objective}

Elements that the abstract should contain:
{abstract_elements}

Key research findings:
{key_findings}

Please write a 200-300 word abstract, including:
1. Research background and objectives
2. Research methodology overview
3. Main findings
4. Conclusions and significance

The abstract should be accurate, concise, and self-contained, allowing readers to quickly understand the core content of the research.
                """
            )
        
        message = Message(
            content=prompt.format(
                research_topic=context.research_topic,
                research_objective=context.research_objective,
                abstract_elements="\n".join(outline.get("abstract_elements", [])),
                key_findings=key_findings
            ),
            sender=self.name,
            message_type="abstract_writing"
        )
        
        response = self.llm.generate(message.content)
        return response.strip()
    
    def write_section(self, context: ResearchContext, section_spec: Dict[str, Any], 
                     relevant_results: List[SearchResult]) -> ReportSection:
        """Write report section"""
        citations = self._create_citations_for_results(relevant_results)
        
        # Detect language and generate appropriate prompt
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            prompt = PromptTemplate(
                template="""
您是一位专业的学术写作专家。请撰写报告的章节内容。

章节标题: {section_title}
章节目标: {section_objective}
章节要点: {content_points}
预期长度: {estimated_length}

相关信息源:
{relevant_sources}

请按照以下要求撰写此章节的内容：

1. **结构清晰**: 使用适当的子标题组织内容
2. **内容丰富**: 基于提供的信息源，进行深入分析和讨论
3. **逻辑严谨**: 确保清晰的论证逻辑，连贯流畅
4. **标准引用**: 在适当位置标记引用（使用[数字]格式）
5. **专业语言**: 使用学术语言表达

章节内容应完整独立，能够充分阐述本章节的主题。
                """
            )
        else:
            prompt = PromptTemplate(
                template="""
You are a professional academic writing expert. Please write a section of the report.

Section Title: {section_title}
Section Objective: {section_objective}
Section Key Points: {content_points}
Expected Length: {estimated_length}

Relevant information sources:
{relevant_sources}

Please write the content of this section with the following requirements:

1. **Clear Structure**: Use appropriate subheadings to organize content
2. **Rich Content**: Based on the provided information sources, conduct in-depth analysis and discussion
3. **Rigorous Logic**: Ensure clear argumentation logic with coherent flow
4. **Standardized Citations**: Mark citations at appropriate positions (using [number] format)
5. **Professional Language**: Use academic language expression

The section content should be complete and independent, able to fully elaborate on the theme of this section.
                """
            )
        
        message = Message(
            content=prompt.format(
                section_title=section_spec.get("title", ""),
                section_objective=section_spec.get("objective", ""),
                content_points="\n".join(section_spec.get("content_points", [])),
                estimated_length=section_spec.get("estimated_length", "适中"),
                relevant_sources=self._format_sources_for_writing(relevant_results)
            ),
            sender=self.name,
            message_type="section_writing"
        )
        
        response = self.llm.generate(message.content)
        
        # Create section object
        section = ReportSection(
            title=section_spec.get("title", ""),
            content=response.strip(),
            level=section_spec.get("level", 1),
            citations=citations
        )
        
        # Process subsections
        for subsection_spec in section_spec.get("subsections", []):
            subsection = self.write_section(context, subsection_spec, relevant_results)
            section.subsections.append(subsection)
        
        return section
    
    def generate_complete_report(self, context: ResearchContext) -> ResearchReport:
        """Generate complete report"""
        # 1. Generate outline
        outline = self.generate_report_outline(context)
        
        # 2. Write abstract
        abstract = self.write_abstract(context, outline)
        
        # 3. Write each section
        sections = []
        all_results = context.get_all_search_results()
        
        for section_spec in outline.get("sections", []):
            # Filter relevant search results for each section
            relevant_results = self._filter_relevant_results(
                all_results, section_spec.get("title", "")
            )
            
            section = self.write_section(context, section_spec, relevant_results)
            sections.append(section)
        
        # 4. Collect all citations
        all_citations = self._collect_all_citations(sections, all_results)
        
        # 5. Create complete report
        report = ResearchReport(
            title=outline.get("title", f"{context.research_topic} - Research Report"),
            abstract=abstract,
            sections=sections,
            citations=all_citations,
            metadata={
                "research_topic": context.research_topic,
                "research_objective": context.research_objective,
                "iterations_count": len(context.iterations),
                "sources_count": len(all_results),
                "generated_by": self.name
            }
        )
        
        return report
    
    def _summarize_findings(self, context: ResearchContext) -> str:
        """Summarize research findings"""
        findings = []
        for iteration in context.iterations:
            if iteration.analysis_summary:
                findings.append(f"Round {iteration.iteration_id}: {iteration.analysis_summary}")
        
        if context.overall_findings:
            findings.append(f"Overall findings: {context.overall_findings}")
        
        return "\n".join(findings) if findings else "No specific findings recorded"
    
    def _extract_key_findings(self, context: ResearchContext) -> str:
        """Extract key findings"""
        all_results = context.get_all_search_results()
        
        # Simple key findings extraction logic
        key_points = []
        
        # Extract key information from search results
        for result in all_results[:10]:  # Take the first 10 results
            if result.snippet:
                key_points.append(f"• {result.title}: {result.snippet[:100]}...")
        
        return "\n".join(key_points) if key_points else "No key findings"
    
    def _create_citations_for_results(self, results: List[SearchResult]) -> List[Citation]:
        """Create citations for search results"""
        citations = []
        for result in results:
            citation = Citation(
                source_url=result.url,
                title=result.title,
                access_date=result.timestamp
            )
            citations.append(citation)
        return citations
    
    def _format_sources_for_writing(self, results: List[SearchResult]) -> str:
        """Format information sources for writing"""
        if not results:
            return "No relevant information sources"
        
        formatted = []
        for i, result in enumerate(results, 1):
            formatted.append(
                f"[{i}] {result.title}\n"
                f"    Source: {result.url}\n"
                f"    Summary: {result.snippet}\n"
            )
        
        return "\n".join(formatted)
    
    def _filter_relevant_results(self, results: List[SearchResult], section_title: str) -> List[SearchResult]:
        """Filter search results relevant to the section"""
        # Simple relevance filtering logic
        # More complex relevance algorithms can be implemented as needed
        relevant = []
        
        section_keywords = section_title.lower().split()
        
        for result in results:
            # Check if title and summary contain section keywords
            text = (result.title + " " + result.snippet).lower()
            relevance_score = sum(1 for keyword in section_keywords if keyword in text)
            
            if relevance_score > 0:
                result.relevance_score = relevance_score
                relevant.append(result)
        
        # Sort by relevance
        relevant.sort(key=lambda x: x.relevance_score or 0, reverse=True)
        
        return relevant[:10]  # Return the 10 most relevant results
    
    def _collect_all_citations(self, sections: List[ReportSection], 
                              all_results: List[SearchResult]) -> List[Citation]:
        """Collect all citations"""
        citations = []
        seen_urls = set()
        
        # Collect citations from sections
        def collect_from_section(section: ReportSection):
            for citation in section.citations:
                if citation.source_url not in seen_urls:
                    citations.append(citation)
                    seen_urls.add(citation.source_url)
            
            for subsection in section.subsections:
                collect_from_section(subsection)
        
        for section in sections:
            collect_from_section(section)
        
        # Create citations for all search results (if not already created)
        for result in all_results:
            if result.url not in seen_urls:
                citation = Citation(
                    source_url=result.url,
                    title=result.title,
                    access_date=result.timestamp
                )
                citations.append(citation)
                seen_urls.add(result.url)
        
        return citations
    
    def _create_default_outline(self, context: ResearchContext) -> Dict[str, Any]:
        """Create default outline"""
        # Detect language and generate appropriate content
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            return {
                "title": f"{context.research_topic} - 研究报告",
                "abstract_elements": [
                    "研究背景", "研究目标", "主要发现", "结论"
                ],
                "sections": [
                    {
                        "title": "引言",
                        "level": 1,
                        "objective": "介绍研究背景和目标",
                        "content_points": ["研究背景", "研究问题", "研究目标"],
                        "estimated_length": "300-500字",
                        "subsections": []
                    },
                    {
                        "title": "研究发现",
                        "level": 1,
                        "objective": "详细阐述研究发现",
                        "content_points": ["主要发现", "关键见解", "数据分析"],
                        "estimated_length": "800-1200字",
                        "subsections": []
                    },
                    {
                        "title": "讨论与分析",
                        "level": 1,
                        "objective": "深入研究结果",
                        "content_points": ["结果解释", "影响分析", "局限性"],
                        "estimated_length": "600-800字",
                        "subsections": []
                    },
                    {
                        "title": "结论",
                        "level": 1,
                        "objective": "总结研究成果",
                        "content_points": ["主要结论", "实际意义", "未来方向"],
                        "estimated_length": "300-400字",
                        "subsections": []
                    }
                ]
            }
        else:
            return {
                "title": f"{context.research_topic} - Research Report",
                "abstract_elements": [
                    "Research Background", "Research Objectives", "Main Findings", "Conclusions"
                ],
                "sections": [
                    {
                        "title": "Introduction",
                        "level": 1,
                        "objective": "Introduce research background and objectives",
                        "content_points": ["Research Background", "Research Questions", "Research Objectives"],
                        "estimated_length": "300-500 words",
                        "subsections": []
                    },
                    {
                        "title": "Research Findings",
                        "level": 1,
                        "objective": "Elaborate on research findings in detail",
                        "content_points": ["Main Findings", "Key Insights", "Data Analysis"],
                        "estimated_length": "800-1200 words",
                        "subsections": []
                    },
                    {
                        "title": "Discussion and Analysis",
                        "level": 1,
                        "objective": "In-depth analysis of research results",
                        "content_points": ["Results Interpretation", "Impact Analysis", "Limitations"],
                        "estimated_length": "600-800 words",
                        "subsections": []
                    },
                    {
                        "title": "Conclusion",
                        "level": 1,
                        "objective": "Summarize research achievements",
                        "content_points": ["Main Conclusions", "Practical Implications", "Future Directions"],
                        "estimated_length": "300-400 words",
                        "subsections": []
                    }
                ]
            }
    
    def _extract_json_from_response(self, response: str) -> Any:
        """Extract JSON from response"""
        import re
        json_pattern = r'```json\s*([\s\S]*?)\s*```'
        match = re.search(json_pattern, response)
        
        if match:
            json_str = match.group(1)
        else:
            json_str = response
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            json_str = json_str.strip()
            if not json_str.startswith(('{', '[')):
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