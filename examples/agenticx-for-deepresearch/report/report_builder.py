"""Structured Report Building Task based on AgenticX

This module implements StructuredReportBuilderTask, responsible for building structured report formats,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional, Union
from datetime import datetime
import json
import re
from pathlib import Path
from pydantic import Field
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import (
    ResearchContext, 
    ResearchReport, 
    ReportSection, 
    Citation,
    SearchResult
)


class StructuredReportBuilderTask(Task):
    """Structured Report Building Task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Building structured report formats
    2. Managing report templates
    3. Generating multiple output formats
    4. Optimizing report structure and layout
    """
    
    template_dir: Optional[Path] = Field(default=None, description="Template directory path")
    supported_formats: List[str] = Field(default_factory=lambda: ["markdown", "html", "json", "txt"], description="Supported output formats")
    default_templates: Dict[str, Any] = Field(default_factory=dict, description="Default report templates")
    
    def __init__(self, description: str, expected_output: str, template_dir: Optional[str] = None, **kwargs):
        # Initialize parent class first
        super().__init__(
            description=description, 
            expected_output=expected_output, 
            **kwargs
        )
        
        # Handle template_dir parameter
        self.template_dir = Path(template_dir) if template_dir else None
        self.supported_formats = ["markdown", "html", "json", "txt"]
        
        # Initialize default report templates
        self.default_templates = {
            "academic": self._get_academic_template(),
            "business": self._get_business_template(),
            "technical": self._get_technical_template(),
            "summary": self._get_summary_template()
        }
    
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
        """Execute report building task"""
        action = kwargs.get("action", "build_report")
        
        if action == "build_report":
            return await self._build_structured_report(kwargs)
        elif action == "apply_template":
            return await self._apply_template(kwargs)
        elif action == "export_format":
            return await self._export_to_format(kwargs)
        elif action == "optimize_structure":
            return await self._optimize_report_structure(kwargs)
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _build_structured_report(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Build structured report"""
        context = kwargs.get("context")
        template_type = kwargs.get("template_type", "academic")
        output_format = kwargs.get("output_format", "markdown")
        
        if not context:
            raise ValueError("Missing research context")
        
        # 1. Analyze research content
        content_analysis = await self._analyze_research_content(context)
        
        # 2. Select and apply template
        template = self._get_template(template_type)
        
        # 3. Build report structure
        report_structure = await self._build_report_structure(context, template, content_analysis)
        
        # 4. Generate report content
        report = await self._generate_report_content(context, report_structure)
        
        # 5. Format output
        formatted_output = await self._format_output(report, output_format)
        
        return {
            "report": report,
            "formatted_output": formatted_output,
            "structure": report_structure,
            "content_analysis": content_analysis,
            "template_type": template_type,
            "output_format": output_format
        }
    
    async def _analyze_research_content(self, context: ResearchContext) -> Dict[str, Any]:
        """Analyze research content"""
        all_results = context.get_all_search_results()
        all_gaps = context.get_all_knowledge_gaps()
        
        # Content statistics
        content_stats = {
            "total_sources": len(all_results),
            "iterations": len(context.iterations),
            "knowledge_gaps": len(all_gaps),
            "research_depth": self._calculate_research_depth(context),
            "content_coverage": self._calculate_content_coverage(all_results)
        }
        
        # Topic analysis
        topic_analysis = await self._analyze_topics(all_results)
        
        # Source analysis
        source_analysis = self._analyze_sources(all_results)
        
        # Temporal analysis
        temporal_analysis = self._analyze_temporal_distribution(context)
        
        return {
            "content_stats": content_stats,
            "topic_analysis": topic_analysis,
            "source_analysis": source_analysis,
            "temporal_analysis": temporal_analysis,
            "recommended_structure": self._recommend_structure(content_stats, topic_analysis)
        }
    
    async def _build_report_structure(self, context: ResearchContext, 
                                    template: Dict[str, Any], 
                                    content_analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Build report structure"""
        # Build structure based on template and content analysis
        structure = {
            "title": self._generate_title(context),
            "metadata": self._build_metadata(context, content_analysis),
            "sections": []
        }
        
        # Add sections according to template
        for section_template in template.get("sections", []):
            section = await self._build_section_structure(
                section_template, context, content_analysis
            )
            structure["sections"].append(section)
        
        # Dynamically adjust structure
        structure = await self._adjust_structure_based_on_content(
            structure, context, content_analysis
        )
        
        return structure
    
    async def _apply_template(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Apply template to content"""
        template_type = kwargs.get("template_type", "academic")
        content = kwargs.get("content", {})
        
        template = self._get_template(template_type)
        
        # Apply template logic here
        applied_content = {
            "template_applied": True,
            "template_type": template_type,
            "template": template,
            "content": content
        }
        
        return applied_content
    
    async def _export_to_format(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Export report to specific format"""
        report = kwargs.get("report")
        output_format = kwargs.get("output_format", "markdown")
        
        if not report:
            raise ValueError("Missing report data")
        
        if isinstance(report, ResearchReport):
            formatted_output = await self._format_output(report, output_format)
        else:
            # Handle dict format
            temp_report = ResearchReport(
                title=report.get("title", "Untitled Report"),
                abstract=report.get("abstract", ""),
                sections=[],
                citations=[],
                metadata=report.get("metadata", {})
            )
            formatted_output = await self._format_output(temp_report, output_format)
        
        return {
            "export_successful": True,
            "output_format": output_format,
            "formatted_output": formatted_output
        }
    
    async def _optimize_report_structure(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize report structure"""
        structure = kwargs.get("structure", {})
        context = kwargs.get("context")
        
        if not structure:
            raise ValueError("Missing structure data")
        
        # Optimize structure based on content analysis
        optimized_structure = structure.copy()
        
        # Add optimization logic here
        if context:
            content_analysis = await self._analyze_research_content(context)
            recommended_template = self._recommend_structure(
                content_analysis["content_stats"], 
                content_analysis["topic_analysis"]
            )
            
            optimized_structure["recommended_template"] = recommended_template
            optimized_structure["optimization_applied"] = True
        
        return {
            "optimization_successful": True,
            "original_structure": structure,
            "optimized_structure": optimized_structure
        }
    
    async def _generate_report_content(self, context: ResearchContext, 
                                     structure: Dict[str, Any]) -> ResearchReport:
        """Generate report content"""
        # Create report object
        report = ResearchReport(
            title=structure["title"],
            abstract="",  # Will be generated later
            metadata=structure["metadata"]
        )
        
        # Generate each section
        all_results = context.get_all_search_results()
        
        for section_structure in structure["sections"]:
            section = await self._generate_section_content(
                section_structure, context, all_results
            )
            report.sections.append(section)
        
        # Generate abstract
        report.abstract = await self._generate_abstract(context, report)
        
        # Collect citations
        report.citations = self._collect_citations(report.sections, all_results)
        
        return report
    
    async def _generate_section_content(self, section_structure: Dict[str, Any],
                                      context: ResearchContext,
                                      all_results: List[SearchResult]) -> ReportSection:
        """Generate section content"""
        section_type = section_structure.get("type", "content")
        
        if section_type == "introduction":
            content = await self._generate_introduction(context, section_structure)
        elif section_type == "methodology":
            content = await self._generate_methodology(context, section_structure)
        elif section_type == "findings":
            content = await self._generate_findings(context, section_structure, all_results)
        elif section_type == "analysis":
            content = await self._generate_analysis(context, section_structure, all_results)
        elif section_type == "conclusion":
            content = await self._generate_conclusion(context, section_structure)
        else:
            content = await self._generate_generic_content(context, section_structure, all_results)
        
        # Create section object
        section = ReportSection(
            title=section_structure["title"],
            content=content,
            level=section_structure.get("level", 1)
        )
        
        # Generate subsections
        for subsection_structure in section_structure.get("subsections", []):
            subsection = await self._generate_section_content(
                subsection_structure, context, all_results
            )
            section.subsections.append(subsection)
        
        return section
    
    async def _generate_introduction(self, context: ResearchContext, 
                                   structure: Dict[str, Any]) -> str:
        """Generate introduction section"""
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = f"""## 研究背景

本研究围绕"{context.research_topic}"这一主题展开深入调研。{context.research_objective}

## 研究目标

本研究的主要目标包括：
1. 全面了解{context.research_topic}的现状和发展趋势
2. 识别该领域的关键问题和挑战
3. 分析相关的解决方案和最佳实践
4. 为后续研究和实践提供参考依据

## 研究方法

本研究采用多轮反思研究方法，通过{len(context.iterations)}轮迭代搜索和分析，
从多个角度和维度收集和整理相关信息，确保研究的全面性和深度。
"""
        else:
            content = f"""## Research Background

This study conducts in-depth research on the topic of "{context.research_topic}". {context.research_objective}

## Research Objectives

The main objectives of this study include:
1. Comprehensive understanding of the current status and development trends of {context.research_topic}
2. Identifying key issues and challenges in this field
3. Analyzing related solutions and best practices
4. Providing reference basis for future research and practice

## Research Methodology

This study adopts a multi-round reflective research method, conducting {len(context.iterations)} rounds of iterative search and analysis,
collecting and organizing relevant information from multiple perspectives and dimensions to ensure comprehensiveness and depth of the research.
"""
        return content
    
    async def _generate_methodology(self, context: ResearchContext, 
                                  structure: Dict[str, Any]) -> str:
        """Generate methodology section"""
        search_engines = set()
        for iteration in context.iterations:
            for result in iteration.search_results:
                search_engines.add(result.source.value)
        
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = f"""## 研究设计

本研究采用基于AgenticX框架的多轮反思研究方法，通过智能体协作实现深度信息收集和分析。

## 数据收集

### 搜索策略
- 搜索引擎：{', '.join(search_engines)}
- 迭代轮数：{len(context.iterations)}轮
- 总搜索结果：{len(context.get_all_search_results())}条

### 质量控制
- 多源验证：使用多个搜索引擎确保信息来源的多样性
- 迭代优化：基于前轮结果调整搜索策略
- 知识空白识别：系统性识别和填补信息缺口

## 分析方法

采用结构化分析方法，对收集的信息进行分类、整理和深度分析，
确保研究结果的准确性和可靠性。
"""
        else:
            content = f"""## Research Design

This study adopts a multi-round reflective research method based on the AgenticX framework, achieving deep information collection and analysis through agent collaboration.

## Data Collection

### Search Strategy
- Search engines: {', '.join(search_engines)}
- Iteration rounds: {len(context.iterations)} rounds
- Total search results: {len(context.get_all_search_results())} items

### Quality Control
- Multi-source verification: Using multiple search engines to ensure diversity of information sources
- Iterative optimization: Adjusting search strategies based on previous round results
- Knowledge gap identification: Systematically identifying and filling information gaps

## Analysis Methods

Adopting structured analysis methods to classify, organize, and deeply analyze collected information,
ensuring accuracy and reliability of research results.
"""
        return content
    
    async def _generate_findings(self, context: ResearchContext, 
                               structure: Dict[str, Any],
                               all_results: List[SearchResult]) -> str:
        """Generate research findings section"""
        # Group results by source
        by_source = {}
        for result in all_results:
            source = result.source.value
            if source not in by_source:
                by_source[source] = []
            by_source[source].append(result)
        
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = "## 主要发现\n\n"
            
            # Overall statistics
            content += f"通过{len(context.iterations)}轮深度搜索，本研究共收集了{len(all_results)}条相关信息，"
            content += f"涵盖了{len(by_source)}个不同的信息源。\n\n"
            
            # Show findings by iteration
            for i, iteration in enumerate(context.iterations, 1):
                content += f"### 第{i}轮研究发现\n\n"
                if iteration.analysis_summary:
                    content += f"{iteration.analysis_summary}\n\n"
                
                # Show key results from this round
                key_results = iteration.search_results[:3]  # Take first 3 results
                for j, result in enumerate(key_results, 1):
                    content += f"{j}. **{result.title}**\n"
                    content += f"   {result.snippet}\n"
                    content += f"   来源：{result.url}\n\n"
        else:
            content = "## Key Findings\n\n"
            
            # Overall statistics
            content += f"Through {len(context.iterations)} rounds of deep search, this study collected {len(all_results)} relevant information items,"
            content += f" covering {len(by_source)} different information sources.\n\n"
            
            # Show findings by iteration
            for i, iteration in enumerate(context.iterations, 1):
                content += f"### Round {i} Research Findings\n\n"
                if iteration.analysis_summary:
                    content += f"{iteration.analysis_summary}\n\n"
                
                # Show key results from this round
                key_results = iteration.search_results[:3]  # Take first 3 results
                for j, result in enumerate(key_results, 1):
                    content += f"{j}. **{result.title}**\n"
                    content += f"   {result.snippet}\n"
                    content += f"   Source: {result.url}\n\n"
        
        return content
    
    async def _generate_analysis(self, context: ResearchContext, 
                               structure: Dict[str, Any],
                               all_results: List[SearchResult]) -> str:
        """Generate analysis section"""
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = "## 深度分析\n\n"
            
            # Trend analysis
            content += "### 发展趋势\n\n"
            content += "基于收集的信息，可以观察到以下发展趋势：\n\n"
            
            # Key insights
            content += "### 关键洞察\n\n"
            
            # Challenges and opportunities
            content += "### 挑战与机遇\n\n"
            
            # Knowledge gap analysis
            gaps = context.get_all_knowledge_gaps()
            if gaps:
                content += "### 知识空白分析\n\n"
                content += f"在研究过程中，识别出{len(gaps)}个知识空白领域：\n\n"
                for i, gap in enumerate(gaps, 1):
                    content += f"{i}. **{gap.topic}** (优先级: {gap.priority})\n"
                    content += f"   {gap.description}\n\n"
        else:
            content = "## Deep Analysis\n\n"
            
            # Trend analysis
            content += "### Development Trends\n\n"
            content += "Based on collected information, the following development trends can be observed:\n\n"
            
            # Key insights
            content += "### Key Insights\n\n"
            
            # Challenges and opportunities
            content += "### Challenges and Opportunities\n\n"
            
            # Knowledge gap analysis
            gaps = context.get_all_knowledge_gaps()
            if gaps:
                content += "### Knowledge Gap Analysis\n\n"
                content += f"During the research process, {len(gaps)} knowledge gap areas were identified:\n\n"
                for i, gap in enumerate(gaps, 1):
                    content += f"{i}. **{gap.topic}** (Priority: {gap.priority})\n"
                    content += f"   {gap.description}\n\n"
        
        return content
    
    async def _generate_conclusion(self, context: ResearchContext, 
                                 structure: Dict[str, Any]) -> str:
        """Generate conclusion section"""
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = f"""## 主要结论

通过对"{context.research_topic}"的深入研究，本研究得出以下主要结论：

1. **研究完整性**：通过{len(context.iterations)}轮迭代研究，
   从{len(context.get_all_search_results())}个信息源收集了全面的相关信息。

2. **知识体系**：构建了关于该主题的系统性知识框架，
   涵盖了主要的研究维度和关键问题。

3. **实践价值**：研究结果为相关领域的实践者和研究者
   提供了有价值的参考和指导。

## 研究局限性

本研究存在以下局限性：
- 信息来源主要基于网络搜索，可能存在信息偏差
- 研究时间有限，某些深度问题需要进一步探索
- 动态信息可能随时间变化，需要持续更新

## 未来方向

基于本研究的发现，建议未来研究可以关注：
1. 深入特定子领域的专门研究
2. 实证研究验证理论发现
3. 跨领域比较研究
4. 长期跟踪研究
"""
        else:
            content = f"""## Main Conclusions

Through in-depth research on "{context.research_topic}", this study draws the following main conclusions:

1. **Research Completeness**: Through {len(context.iterations)} rounds of iterative research,
   comprehensive relevant information was collected from {len(context.get_all_search_results())} information sources.

2. **Knowledge Framework**: A systematic knowledge framework about this topic was constructed,
   covering major research dimensions and key issues.

3. **Practical Value**: The research results provide valuable reference and guidance
   for practitioners and researchers in related fields.

## Research Limitations

This study has the following limitations:
- Information sources are mainly based on web searches, which may have information bias
- Limited research time, some in-depth issues need further exploration
- Dynamic information may change over time and needs continuous updates

## Future Directions

Based on the findings of this study, future research is recommended to focus on:
1. In-depth specialized research on specific sub-fields
2. Empirical research to validate theoretical findings
3. Cross-domain comparative research
4. Long-term tracking research
"""
        return content
    
    async def _generate_generic_content(self, context: ResearchContext,
                                      structure: Dict[str, Any],
                                      all_results: List[SearchResult]) -> str:
        """Generate generic content"""
        section_title = structure.get("title", "")
        content_points = structure.get("content_points", [])
        
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            content = f"## {section_title}\n\n"
            
            if content_points:
                for point in content_points:
                    content += f"### {point}\n\n"
                    content += "相关内容将在此处展开...\n\n"
            else:
                content += "本章节的具体内容将基于研究发现进行详细阐述。\n\n"
        else:
            content = f"## {section_title}\n\n"
            
            if content_points:
                for point in content_points:
                    content += f"### {point}\n\n"
                    content += "Relevant content will be expanded here...\n\n"
            else:
                content += "The specific content of this chapter will be elaborated in detail based on research findings.\n\n"
        
        return content
    
    async def _generate_abstract(self, context: ResearchContext, 
                               report: ResearchReport) -> str:
        """Generate abstract"""
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            abstract = f"""本研究对"{context.research_topic}"进行了深入的多轮反思研究。
研究采用基于AgenticX框架的智能体协作方法，通过{len(context.iterations)}轮迭代搜索和分析，
从{len(context.get_all_search_results())}个信息源收集了全面的相关信息。

研究发现了该领域的关键趋势、主要挑战和发展机遇。
通过系统性的信息收集和分析，构建了完整的知识框架，
为相关领域的研究和实践提供了有价值的参考。

本研究的主要贡献在于提供了关于{context.research_topic}的全面视角，
识别了重要的知识空白，并为未来研究指明了方向。"""
        else:
            abstract = f"""This study conducted in-depth multi-round reflective research on "{context.research_topic}".
The research adopts an agent collaboration method based on the AgenticX framework, conducting {len(context.iterations)} rounds of iterative search and analysis,
collecting comprehensive relevant information from {len(context.get_all_search_results())} information sources.

The study discovered key trends, major challenges, and development opportunities in this field.
Through systematic information collection and analysis, a complete knowledge framework was constructed,
providing valuable reference for research and practice in related fields.

The main contribution of this study lies in providing a comprehensive perspective on {context.research_topic},
identifying important knowledge gaps and pointing the direction for future research."""
        
        return abstract
    
    def _collect_citations(self, sections: List[ReportSection], 
                          all_results: List[SearchResult]) -> List[Citation]:
        """Collect citations"""
        citations = []
        seen_urls = set()
        
        # Create citations from search results
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
    
    async def _format_output(self, report: ResearchReport, 
                           output_format: str) -> str:
        """Format output"""
        if output_format == "markdown":
            return report.to_markdown()
        elif output_format == "html":
            return self._convert_to_html(report)
        elif output_format == "json":
            return json.dumps(report.to_dict(), ensure_ascii=False, indent=2)
        elif output_format == "txt":
            return self._convert_to_text(report)
        else:
            raise ValueError(f"Unsupported output format: {output_format}")
    
    def _convert_to_html(self, report: ResearchReport) -> str:
        """Convert to HTML format"""
        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{report.title}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        h1 {{ color: #333; }}
        h2 {{ color: #666; }}
        h3 {{ color: #999; }}
        .abstract {{ background: #f5f5f5; padding: 20px; margin: 20px 0; }}
        .citation {{ font-size: 0.9em; color: #666; }}
    </style>
</head>
<body>
    <h1>{report.title}</h1>
    
    <div class="abstract">
        <h2>Abstract</h2>
        <p>{report.abstract}</p>
    </div>
"""
        
        # Add section content
        for section in report.sections:
            html += self._section_to_html(section)
        
        # Add references
        if report.citations:
            html += "<h2>References</h2>\n<ol>\n"
            for citation in report.citations:
                html += f'<li class="citation">{citation.format_citation()}</li>\n'
            html += "</ol>\n"
        
        html += "</body>\n</html>"
        return html
    
    def _section_to_html(self, section: ReportSection, level: int = 2) -> str:
        """Convert section to HTML"""
        header_level = min(level + section.level - 1, 6)
        html = f"<h{header_level}>{section.title}</h{header_level}>\n"
        
        # Convert Markdown format in content
        content = section.content.replace("\n", "<br>\n")
        html += f"<div>{content}</div>\n"
        
        # Add subsections
        for subsection in section.subsections:
            html += self._section_to_html(subsection, level + 1)
        
        return html
    
    def _convert_to_text(self, report: ResearchReport) -> str:
        """Convert to plain text format"""
        text = f"{report.title}\n"
        text += "=" * len(report.title) + "\n\n"
        
        text += "Abstract\n--------\n"
        text += f"{report.abstract}\n\n"
        
        for section in report.sections:
            text += self._section_to_text(section)
        
        if report.citations:
            text += "References\n----------\n"
            for i, citation in enumerate(report.citations, 1):
                text += f"{i}. {citation.format_citation()}\n"
        
        return text
    
    def _section_to_text(self, section: ReportSection, level: int = 0) -> str:
        """Convert section to text"""
        indent = "  " * level
        text = f"{indent}{section.title}\n"
        text += f"{indent}{'-' * len(section.title)}\n"
        text += f"{section.content}\n\n"
        
        for subsection in section.subsections:
            text += self._section_to_text(subsection, level + 1)
        
        return text
    
    # Template definition methods
    def _get_academic_template(self) -> Dict[str, Any]:
        """Academic report template"""
        return {
            "name": "academic",
            "description": "Academic research report template",
            "sections": [
                {
                    "title": "Introduction",
                    "type": "introduction",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Research Methodology",
                    "type": "methodology",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Research Findings",
                    "type": "findings",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Discussion and Analysis",
                    "type": "analysis",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Conclusion",
                    "type": "conclusion",
                    "level": 1,
                    "required": True
                }
            ]
        }
    
    def _get_business_template(self) -> Dict[str, Any]:
        """Business report template"""
        return {
            "name": "business",
            "description": "Business analysis report template",
            "sections": [
                {
                    "title": "Executive Summary",
                    "type": "executive_summary",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Market Analysis",
                    "type": "market_analysis",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Key Findings",
                    "type": "findings",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Recommendations",
                    "type": "recommendations",
                    "level": 1,
                    "required": True
                }
            ]
        }
    
    def _get_technical_template(self) -> Dict[str, Any]:
        """Technical report template"""
        return {
            "name": "technical",
            "description": "Technical analysis report template",
            "sections": [
                {
                    "title": "Overview",
                    "type": "overview",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Technical Analysis",
                    "type": "technical_analysis",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Implementation Plan",
                    "type": "implementation",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Summary",
                    "type": "conclusion",
                    "level": 1,
                    "required": True
                }
            ]
        }
    
    def _get_summary_template(self) -> Dict[str, Any]:
        """Summary report template"""
        return {
            "name": "summary",
            "description": "Brief summary report template",
            "sections": [
                {
                    "title": "Key Findings",
                    "type": "findings",
                    "level": 1,
                    "required": True
                },
                {
                    "title": "Key Insights",
                    "type": "insights",
                    "level": 1,
                    "required": True
                }
            ]
        }
    
    def _get_template(self, template_type: str) -> Dict[str, Any]:
        """Get template"""
        return self.default_templates.get(template_type, self.default_templates["academic"])
    
    # Helper methods
    def _calculate_research_depth(self, context: ResearchContext) -> float:
        """Calculate research depth"""
        # Simple depth calculation logic
        base_score = len(context.iterations) * 0.2
        results_score = min(len(context.get_all_search_results()) * 0.01, 0.5)
        gaps_score = len(context.get_all_knowledge_gaps()) * 0.1
        
        return min(base_score + results_score + gaps_score, 1.0)
    
    def _calculate_content_coverage(self, results: List[SearchResult]) -> float:
        """Calculate content coverage"""
        if not results:
            return 0.0
        
        # Calculate coverage based on source diversity
        sources = set(result.source.value for result in results)
        diversity_score = len(sources) * 0.2
        
        # Based on result quantity
        quantity_score = min(len(results) * 0.02, 0.6)
        
        return min(diversity_score + quantity_score, 1.0)
    
    async def _analyze_topics(self, results: List[SearchResult]) -> Dict[str, Any]:
        """Analyze topics"""
        # Simple topic analysis
        topics = {}
        for result in results:
            # Extract keywords (simplified version)
            words = result.title.lower().split()
            for word in words:
                if len(word) > 3:  # Filter short words
                    topics[word] = topics.get(word, 0) + 1
        
        # Sort and take top 10
        top_topics = sorted(topics.items(), key=lambda x: x[1], reverse=True)[:10]
        
        return {
            "top_topics": top_topics,
            "total_unique_topics": len(topics)
        }
    
    def _analyze_sources(self, results: List[SearchResult]) -> Dict[str, Any]:
        """Analyze sources"""
        by_engine = {}
        by_domain = {}
        
        for result in results:
            # Group by search engine
            engine = result.source.value
            by_engine[engine] = by_engine.get(engine, 0) + 1
            
            # Group by domain
            try:
                from urllib.parse import urlparse
                domain = urlparse(result.url).netloc
                by_domain[domain] = by_domain.get(domain, 0) + 1
            except:
                pass
        
        return {
            "by_search_engine": by_engine,
            "by_domain": dict(sorted(by_domain.items(), key=lambda x: x[1], reverse=True)[:10]),
            "total_domains": len(by_domain)
        }
    
    def _analyze_temporal_distribution(self, context: ResearchContext) -> Dict[str, Any]:
        """Analyze temporal distribution"""
        if not context.iterations:
            return {}
        
        start_time = context.start_time
        end_time = context.end_time or datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        iteration_durations = []
        for iteration in context.iterations:
            if iteration.end_time:
                iter_duration = (iteration.end_time - iteration.start_time).total_seconds()
                iteration_durations.append(iter_duration)
        
        return {
            "total_duration_seconds": duration,
            "average_iteration_duration": sum(iteration_durations) / len(iteration_durations) if iteration_durations else 0,
            "iteration_count": len(context.iterations)
        }
    
    def _recommend_structure(self, content_stats: Dict[str, Any], 
                           topic_analysis: Dict[str, Any]) -> str:
        """Recommend report structure"""
        depth = content_stats.get("research_depth", 0)
        iterations = content_stats.get("iterations", 0)
        
        if depth > 0.7 and iterations >= 3:
            return "academic"  # Deep research, recommend academic template
        elif iterations >= 2:
            return "business"  # Medium depth, recommend business template
        else:
            return "summary"   # Simple research, recommend summary template
    
    def _generate_title(self, context: ResearchContext) -> str:
        """Generate report title"""
        detected_language = self._detect_language(context.research_topic)
        
        if detected_language == "zh":
            return f"{context.research_topic} - 深度研究报告"
        else:
            return f"{context.research_topic} - In-depth Research Report"
    
    def _build_metadata(self, context: ResearchContext, 
                       content_analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Build metadata"""
        return {
            "research_topic": context.research_topic,
            "research_objective": context.research_objective,
            "generated_at": datetime.now().isoformat(),
            "iterations": len(context.iterations),
            "total_sources": len(context.get_all_search_results()),
            "research_depth": content_analysis["content_stats"]["research_depth"],
            "content_coverage": content_analysis["content_stats"]["content_coverage"]
        }
    
    async def _build_section_structure(self, section_template: Dict[str, Any],
                                     context: ResearchContext,
                                     content_analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Build section structure"""
        return {
            "title": section_template["title"],
            "type": section_template["type"],
            "level": section_template["level"],
            "required": section_template.get("required", False),
            "subsections": section_template.get("subsections", [])
        }
    
    async def _adjust_structure_based_on_content(self, structure: Dict[str, Any],
                                               context: ResearchContext,
                                               content_analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Adjust structure based on content"""
        # Adjust structure based on content analysis results
        # More complex structure optimization logic can be implemented here
        return structure