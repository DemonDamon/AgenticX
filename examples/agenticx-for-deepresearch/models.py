"""基于AgenticX的深度搜索数据模型

本模块定义了深度搜索系统中使用的核心数据结构，
严格遵循AgenticX框架的数据模型设计原则。
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class SearchEngine(Enum):
    """支持的搜索引擎类型"""
    GOOGLE = "google"
    BING = "bing"
    BOCHAAI = "bochaai"
    MOCK = "mock"


class ResearchPhase(Enum):
    """研究阶段枚举"""
    INITIALIZATION = "initialization"
    QUERY_GENERATION = "query_generation"
    SEARCH_EXECUTION = "search_execution"
    RESULT_ANALYSIS = "result_analysis"
    GAP_IDENTIFICATION = "gap_identification"
    REFLECTION = "reflection"
    REPORT_GENERATION = "report_generation"
    QUALITY_ASSESSMENT = "quality_assessment"
    COMPLETED = "completed"


class QueryType(Enum):
    """查询类型枚举"""
    INITIAL = "initial"
    FOLLOWUP = "followup"
    CLARIFICATION = "clarification"
    DEEP_DIVE = "deep_dive"


@dataclass
class SearchResult:
    """搜索结果数据模型"""
    title: str
    url: str
    snippet: str
    source: SearchEngine
    timestamp: datetime = field(default_factory=datetime.now)
    relevance_score: Optional[float] = None
    content: Optional[str] = None  # 完整网页内容（如果抓取）
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source": self.source.value,
            "timestamp": self.timestamp.isoformat(),
            "relevance_score": self.relevance_score,
            "content": self.content,
            "metadata": self.metadata
        }


@dataclass
class SearchQuery:
    """搜索查询数据模型"""
    query: str
    query_type: QueryType
    language: str = "zh-CN"
    max_results: int = 10
    search_engines: List[SearchEngine] = field(default_factory=lambda: [SearchEngine.BOCHAAI])
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "query": self.query,
            "query_type": self.query_type.value,
            "language": self.language,
            "max_results": self.max_results,
            "search_engines": [engine.value for engine in self.search_engines],
            "metadata": self.metadata
        }


@dataclass
class KnowledgeItem:
    """知识项数据模型"""
    content: str
    type: str  # fact, concept, relationship, timeline, opinion等
    confidence: float = 5.0  # 置信度 1-10
    source: str = ""  # 来源URL或标识
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "content": self.content,
            "type": self.type,
            "confidence": self.confidence,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata
        }


@dataclass
class KnowledgeGap:
    """知识空白数据模型"""
    topic: str
    description: str
    priority: int  # 1-10，10为最高优先级
    suggested_queries: List[str] = field(default_factory=list)
    identified_by: str = ""  # 识别此空白的智能体
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "topic": self.topic,
            "description": self.description,
            "priority": self.priority,
            "suggested_queries": self.suggested_queries,
            "identified_by": self.identified_by,
            "timestamp": self.timestamp.isoformat()
        }


@dataclass
class ResearchIteration:
    """研究迭代数据模型"""
    iteration_id: int
    queries: List[SearchQuery]
    search_results: List[SearchResult]
    analysis_summary: str
    identified_gaps: List[KnowledgeGap]
    phase: ResearchPhase
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "iteration_id": self.iteration_id,
            "queries": [q.to_dict() for q in self.queries],
            "search_results": [r.to_dict() for r in self.search_results],
            "analysis_summary": self.analysis_summary,
            "identified_gaps": [g.to_dict() for g in self.identified_gaps],
            "phase": self.phase.value,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "metadata": self.metadata
        }


@dataclass
class Citation:
    """引用数据模型"""
    source_url: str
    title: str
    author: Optional[str] = None
    publication_date: Optional[datetime] = None
    access_date: datetime = field(default_factory=datetime.now)
    citation_format: str = "APA"  # APA, MLA, Chicago等
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "source_url": self.source_url,
            "title": self.title,
            "author": self.author,
            "publication_date": self.publication_date.isoformat() if self.publication_date else None,
            "access_date": self.access_date.isoformat(),
            "citation_format": self.citation_format
        }
    
    def format_citation(self) -> str:
        """格式化引用"""
        if self.citation_format == "APA":
            author_part = f"{self.author}. " if self.author else ""
            date_part = f"({self.publication_date.year}). " if self.publication_date else ""
            return f"{author_part}{date_part}{self.title}. Retrieved from {self.source_url}"
        else:
            # 默认简单格式
            return f"{self.title}. {self.source_url}"


@dataclass
class ResearchContext:
    """研究上下文数据模型"""
    research_topic: str
    research_objective: str
    target_language: str = "zh-CN"
    max_iterations: int = 5
    current_iteration: int = 0
    iterations: List[ResearchIteration] = field(default_factory=list)
    overall_findings: str = ""
    final_report: str = ""
    citations: List[Citation] = field(default_factory=list)
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    status: ResearchPhase = ResearchPhase.INITIALIZATION
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def add_iteration(self, iteration: ResearchIteration) -> None:
        """添加研究迭代"""
        self.iterations.append(iteration)
        self.current_iteration = len(self.iterations)
    
    def get_current_iteration(self) -> Optional[ResearchIteration]:
        """获取当前迭代"""
        return self.iterations[-1] if self.iterations else None
    
    def get_all_search_results(self) -> List[SearchResult]:
        """获取所有搜索结果"""
        all_results = []
        for iteration in self.iterations:
            all_results.extend(iteration.search_results)
        return all_results
    
    def get_all_knowledge_gaps(self) -> List[KnowledgeGap]:
        """获取所有知识空白"""
        all_gaps = []
        for iteration in self.iterations:
            all_gaps.extend(iteration.identified_gaps)
        return all_gaps
    
    def should_continue(self) -> bool:
        """判断是否应该继续研究"""
        if self.current_iteration >= self.max_iterations:
            return False
        
        # 如果最近一轮没有发现新的知识空白，可以考虑结束
        current_iter = self.get_current_iteration()
        if current_iter and not current_iter.identified_gaps:
            return False
        
        return True
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "research_topic": self.research_topic,
            "research_objective": self.research_objective,
            "target_language": self.target_language,
            "max_iterations": self.max_iterations,
            "current_iteration": self.current_iteration,
            "iterations": [iter.to_dict() for iter in self.iterations],
            "overall_findings": self.overall_findings,
            "final_report": self.final_report,
            "citations": [c.to_dict() for c in self.citations],
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "status": self.status.value,
            "metadata": self.metadata
        }


@dataclass
class ReportSection:
    """报告章节数据模型"""
    title: str
    content: str
    level: int = 1  # 标题级别 1-6
    citations: List[Citation] = field(default_factory=list)
    subsections: List['ReportSection'] = field(default_factory=list)
    
    def to_markdown(self, base_level: int = 1) -> str:
        """转换为Markdown格式"""
        level = min(base_level + self.level - 1, 6)
        header = "#" * level + " " + self.title + "\n\n"
        content = self.content + "\n\n"
        
        # 添加子章节
        for subsection in self.subsections:
            content += subsection.to_markdown(base_level + 1)
        
        return header + content


@dataclass
class ResearchReport:
    """研究报告数据模型"""
    title: str
    abstract: str
    sections: List[ReportSection] = field(default_factory=list)
    citations: List[Citation] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    generated_at: datetime = field(default_factory=datetime.now)
    
    def to_markdown(self) -> str:
        """转换为完整的Markdown报告"""
        report = f"# {self.title}\n\n"
        report += f"## 摘要\n\n{self.abstract}\n\n"
        
        for section in self.sections:
            report += section.to_markdown(2)
        
        # 添加参考文献
        if self.citations:
            report += "## 参考文献\n\n"
            for i, citation in enumerate(self.citations, 1):
                report += f"{i}. {citation.format_citation()}\n"
        
        return report
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "title": self.title,
            "abstract": self.abstract,
            "sections": [section.__dict__ for section in self.sections],
            "citations": [c.to_dict() for c in self.citations],
            "metadata": self.metadata,
            "generated_at": self.generated_at.isoformat()
        }