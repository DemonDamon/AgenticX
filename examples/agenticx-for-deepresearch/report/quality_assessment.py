"""Quality Assessment Task based on AgenticX

This module implements QualityAssessmentTask, responsible for evaluating report quality and completeness,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import re
import json
from dataclasses import dataclass
from enum import Enum
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


class QualityDimension(Enum):
    """Quality assessment dimensions"""
    COMPLETENESS = "completeness"  # Completeness
    ACCURACY = "accuracy"          # Accuracy
    RELEVANCE = "relevance"        # Relevance
    COHERENCE = "coherence"        # Coherence
    DEPTH = "depth"                # Depth
    OBJECTIVITY = "objectivity"    # Objectivity
    CITATION = "citation"          # Citation quality
    STRUCTURE = "structure"        # Structure quality


class QualityLevel(Enum):
    """Quality levels"""
    EXCELLENT = "excellent"  # Excellent (90-100)
    GOOD = "good"            # Good (80-89)
    FAIR = "fair"            # Fair (70-79)
    POOR = "poor"            # Poor (60-69)
    INADEQUATE = "inadequate" # Inadequate (<60)


@dataclass
class QualityMetric:
    """Quality metric"""
    dimension: QualityDimension
    score: float  # 0-100
    level: QualityLevel
    feedback: str
    suggestions: List[str]
    evidence: List[str]


@dataclass
class QualityAssessmentResult:
    """Quality assessment result"""
    overall_score: float
    overall_level: QualityLevel
    metrics: List[QualityMetric]
    strengths: List[str]
    weaknesses: List[str]
    recommendations: List[str]
    assessment_summary: str
    timestamp: datetime


class QualityAssessmentTask(Task):
    """Quality Assessment Task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Evaluating report quality and completeness
    2. Providing multi-dimensional quality analysis
    3. Generating improvement suggestions
    4. Supporting quality benchmarks and standards
    """
    
    quality_standards: Dict[str, Any] = Field(default_factory=dict, description="Quality standards configuration")
    assessment_weights: Dict[str, float] = Field(default_factory=dict, description="Assessment weights configuration")
    
    def __init__(self, description: str, expected_output: str, quality_standards: Optional[Dict[str, Any]] = None, **kwargs):
        # 调用基类初始化方法
        super().__init__(
            description=description, 
            expected_output=expected_output, 
            **kwargs
        )
        
        # 初始化质量标准和评估权重
        self.quality_standards = quality_standards or self._get_default_standards()
        self.assessment_weights = self._get_assessment_weights()
        
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
        """Execute quality assessment task"""
        action = kwargs.get("action", "assess_quality")
        
        if action == "assess_quality":
            return await self._assess_report_quality(kwargs)
        elif action == "assess_research_process":
            return await self._assess_research_process(kwargs)
        elif action == "validate_citations":
            return await self._validate_citations(kwargs)
        elif action == "check_completeness":
            return await self._check_completeness(kwargs)
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _assess_report_quality(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Assess report quality"""
        report = kwargs.get("report")
        context = kwargs.get("context")
        
        if not report:
            raise ValueError("Missing report object")
        
        # 1. Multi-dimensional quality assessment
        metrics = await self._evaluate_all_dimensions(report, context)
        
        # 2. Calculate overall score
        overall_score = self._calculate_overall_score(metrics)
        overall_level = self._score_to_level(overall_score)
        
        # 3. Analyze strengths and weaknesses
        strengths, weaknesses = self._analyze_strengths_weaknesses(metrics)
        
        # 4. Generate improvement recommendations
        recommendations = await self._generate_recommendations(metrics, report, context)
        
        # 5. Generate assessment summary
        assessment_summary = self._generate_assessment_summary(
            overall_score, overall_level, metrics, strengths, weaknesses
        )
        
        # Create assessment result
        result = QualityAssessmentResult(
            overall_score=overall_score,
            overall_level=overall_level,
            metrics=metrics,
            strengths=strengths,
            weaknesses=weaknesses,
            recommendations=recommendations,
            assessment_summary=assessment_summary,
            timestamp=datetime.now()
        )
        
        return {
            "assessment_result": result,
            "detailed_metrics": {metric.dimension.value: metric for metric in metrics},
            "quality_report": self._generate_quality_report(result),
            "actionable_items": self._extract_actionable_items(result)
        }
    
    async def _evaluate_all_dimensions(self, report: ResearchReport, 
                                     context: Optional[ResearchContext]) -> List[QualityMetric]:
        """Evaluate all quality dimensions"""
        metrics = []
        
        # Completeness assessment
        completeness_metric = await self._assess_completeness(report, context)
        metrics.append(completeness_metric)
        
        # Accuracy assessment
        accuracy_metric = await self._assess_accuracy(report, context)
        metrics.append(accuracy_metric)
        
        # Relevance assessment
        relevance_metric = await self._assess_relevance(report, context)
        metrics.append(relevance_metric)
        
        # Coherence assessment
        coherence_metric = await self._assess_coherence(report)
        metrics.append(coherence_metric)
        
        # Depth assessment
        depth_metric = await self._assess_depth(report, context)
        metrics.append(depth_metric)
        
        # Objectivity assessment
        objectivity_metric = await self._assess_objectivity(report)
        metrics.append(objectivity_metric)
        
        # Citation quality assessment
        citation_metric = await self._assess_citation_quality(report)
        metrics.append(citation_metric)
        
        # Structure quality assessment
        structure_metric = await self._assess_structure_quality(report)
        metrics.append(structure_metric)
        
        return metrics
    
    async def _assess_completeness(self, report: ResearchReport, 
                                 context: Optional[ResearchContext]) -> QualityMetric:
        """Assess completeness"""
        score = 0.0
        evidence = []
        suggestions = []
        
        # Check basic components
        if report.title:
            score += 10
            evidence.append("Contains title")
        else:
            suggestions.append("Add report title")
        
        if report.abstract:
            score += 15
            evidence.append("Contains abstract")
        else:
            suggestions.append("Add report abstract")
        
        if report.sections:
            score += 30
            evidence.append(f"Contains {len(report.sections)} main sections")
            
            # Check section content
            content_sections = [s for s in report.sections if s.content.strip()]
            if content_sections:
                score += 20
                evidence.append(f"{len(content_sections)} sections have substantive content")
            else:
                suggestions.append("Add substantive content to sections")
        else:
            suggestions.append("Add report sections")
        
        if report.citations:
            score += 15
            evidence.append(f"Contains {len(report.citations)} citations")
        else:
            suggestions.append("Add references")
        
        # Check research coverage
        if context:
            expected_topics = self._extract_expected_topics(context.research_topic)
            covered_topics = self._extract_covered_topics(report)
            coverage_ratio = len(covered_topics.intersection(expected_topics)) / len(expected_topics) if expected_topics else 1.0
            score += coverage_ratio * 10
            evidence.append(f"Topic coverage: {coverage_ratio:.1%}")
        
        level = self._score_to_level(score)
        feedback = self._generate_completeness_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.COMPLETENESS,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_accuracy(self, report: ResearchReport, 
                             context: Optional[ResearchContext]) -> QualityMetric:
        """Assess accuracy"""
        score = 75.0  # Base score, assuming most content is accurate
        evidence = []
        suggestions = []
        
        # Check citation validity
        if report.citations:
            valid_citations = self._validate_citation_urls(report.citations)
            citation_accuracy = len(valid_citations) / len(report.citations)
            score += citation_accuracy * 15
            evidence.append(f"Citation validity: {citation_accuracy:.1%}")
            
            if citation_accuracy < 0.8:
                suggestions.append("Check and fix invalid citation links")
        
        # Check content consistency
        consistency_score = self._check_content_consistency(report)
        score += consistency_score * 10
        evidence.append(f"Content consistency: {consistency_score:.1%}")
        
        if consistency_score < 0.8:
            suggestions.append("Check and fix contradictions or inconsistencies in content")
        
        level = self._score_to_level(score)
        feedback = self._generate_accuracy_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.ACCURACY,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_relevance(self, report: ResearchReport, 
                              context: Optional[ResearchContext]) -> QualityMetric:
        """Assess relevance"""
        score = 0.0
        evidence = []
        suggestions = []
        
        if not context:
            # Give a medium score when no context
            score = 70.0
            evidence.append("Cannot obtain research context, giving medium relevance score")
        else:
            # Check title relevance
            title_relevance = self._calculate_text_relevance(
                report.title, context.research_topic
            )
            score += title_relevance * 20
            evidence.append(f"Title relevance: {title_relevance:.1%}")
            
            # Check abstract relevance
            abstract_relevance = 0.0
            if report.abstract:
                abstract_relevance = self._calculate_text_relevance(
                    report.abstract, context.research_topic
                )
                score += abstract_relevance * 25
                evidence.append(f"Abstract relevance: {abstract_relevance:.1%}")
            
            # Check content relevance
            content_relevance = self._calculate_content_relevance(report, context)
            score += content_relevance * 35
            evidence.append(f"Content relevance: {content_relevance:.1%}")
            
            # Check objective alignment
            objective_alignment = self._calculate_objective_alignment(report, context)
            score += objective_alignment * 20
            evidence.append(f"Objective alignment: {objective_alignment:.1%}")
            
            # Generate improvement suggestions
            if title_relevance < 0.7:
                suggestions.append("Adjust report title to better reflect research topic")
            if abstract_relevance < 0.7:
                suggestions.append("Modify abstract to be more tightly aligned with research topic")
            if content_relevance < 0.7:
                suggestions.append("Increase content directly related to research topic")
        
        level = self._score_to_level(score)
        feedback = self._generate_relevance_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.RELEVANCE,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_coherence(self, report: ResearchReport) -> QualityMetric:
        """Assess coherence"""
        score = 0.0
        evidence = []
        suggestions = []
        
        # Check structural logic
        structure_score = self._assess_logical_structure(report)
        score += structure_score * 30
        evidence.append(f"Structural logic: {structure_score:.1%}")
        
        # Check section transitions
        transition_score = self._assess_section_transitions(report)
        score += transition_score * 25
        evidence.append(f"Section transitions: {transition_score:.1%}")
        
        # Check content flow
        flow_score = self._assess_content_flow(report)
        score += flow_score * 25
        evidence.append(f"Content flow: {flow_score:.1%}")
        
        # Check terminology consistency
        terminology_score = self._assess_terminology_consistency(report)
        score += terminology_score * 20
        evidence.append(f"Terminology consistency: {terminology_score:.1%}")
        
        # Generate improvement suggestions
        if structure_score < 0.7:
            suggestions.append("Reorganize report structure for better logic")
        if transition_score < 0.7:
            suggestions.append("Improve transitions and connections between sections")
        if flow_score < 0.7:
            suggestions.append("Optimize content expression for better flow")
        if terminology_score < 0.7:
            suggestions.append("Unify terminology usage for consistency")
        
        level = self._score_to_level(score)
        feedback = self._generate_coherence_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.COHERENCE,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_depth(self, report: ResearchReport, 
                          context: Optional[ResearchContext]) -> QualityMetric:
        """Assess depth"""
        score = 0.0
        evidence = []
        suggestions = []
        
        # Check content length and detail
        content_length = self._calculate_total_content_length(report)
        length_score = min(content_length / 5000, 1.0) * 20  # Assume 5000 words is full score
        score += length_score
        evidence.append(f"Content length: {content_length} characters")
        
        # Check analysis depth
        analysis_depth = self._assess_analysis_depth(report)
        score += analysis_depth * 30
        evidence.append(f"Analysis depth: {analysis_depth:.1%}")
        
        # Check multi-perspective coverage
        perspective_coverage = self._assess_perspective_coverage(report)
        score += perspective_coverage * 25
        evidence.append(f"Perspective coverage: {perspective_coverage:.1%}")
        
        # Check research iteration depth
        if context:
            iteration_depth = len(context.iterations) / 5.0  # Assume 5 rounds is full score
            iteration_score = min(iteration_depth, 1.0) * 25
            score += iteration_score
            evidence.append(f"Research iteration: {len(context.iterations)} rounds")
        else:
            score += 15  # Give medium score when no context
        
        # Generate improvement suggestions
        if length_score < 15:
            suggestions.append("Increase content detail and depth")
        if analysis_depth < 0.7:
            suggestions.append("Strengthen analysis and explanation depth")
        if perspective_coverage < 0.7:
            suggestions.append("Analyze problems from more angles and dimensions")
        
        level = self._score_to_level(score)
        feedback = self._generate_depth_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.DEPTH,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_objectivity(self, report: ResearchReport) -> QualityMetric:
        """Assess objectivity"""
        score = 80.0  # Base score, assuming most content is objective
        evidence = []
        suggestions = []
        
        # Check subjective language
        subjectivity_score = self._detect_subjective_language(report)
        score -= subjectivity_score * 20
        evidence.append(f"Subjective language detection: {subjectivity_score:.1%}")
        
        # Check balance
        balance_score = self._assess_content_balance(report)
        score += balance_score * 15
        evidence.append(f"Content balance: {balance_score:.1%}")
        
        # Check evidence support
        evidence_support = self._assess_evidence_support(report)
        score += evidence_support * 5
        evidence.append(f"Evidence support: {evidence_support:.1%}")
        
        # Generate improvement suggestions
        if subjectivity_score > 0.3:
            suggestions.append("Reduce subjective expression, use more objective language")
        if balance_score < 0.7:
            suggestions.append("Present different perspectives and angles in a balanced manner")
        if evidence_support < 0.7:
            suggestions.append("Provide more evidence support for opinions and conclusions")
        
        level = self._score_to_level(score)
        feedback = self._generate_objectivity_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.OBJECTIVITY,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_citation_quality(self, report: ResearchReport) -> QualityMetric:
        """Assess citation quality"""
        score = 0.0
        evidence = []
        suggestions = []
        
        if not report.citations:
            suggestions.append("Add references and citations")
            feedback = "Report lacks references and citations"
            return QualityMetric(
                dimension=QualityDimension.CITATION,
                score=0.0,
                level=QualityLevel.INADEQUATE,
                feedback=feedback,
                suggestions=suggestions,
                evidence=evidence
            )
        
        # Check citation count
        citation_count = len(report.citations)
        count_score = min(citation_count / 10, 1.0) * 20  # Assume 10 citations is full score
        score += count_score
        evidence.append(f"Citation count: {citation_count} citations")
        
        # Check citation format
        format_score = self._assess_citation_format(report.citations)
        score += format_score * 25
        evidence.append(f"Format consistency: {format_score:.1%}")
        
        # Check citation diversity
        diversity_score = self._assess_citation_diversity(report.citations)
        score += diversity_score * 25
        evidence.append(f"Source diversity: {diversity_score:.1%}")
        
        # Check citation timeliness
        timeliness_score = self._assess_citation_timeliness(report.citations)
        score += timeliness_score * 15
        evidence.append(f"Timeliness: {timeliness_score:.1%}")
        
        # Check citation accessibility
        accessibility_score = self._assess_citation_accessibility(report.citations)
        score += accessibility_score * 15
        evidence.append(f"Accessibility: {accessibility_score:.1%}")
        
        # Generate improvement suggestions
        if count_score < 15:
            suggestions.append("Add more relevant references and citations")
        if format_score < 0.7:
            suggestions.append("Standardize citation format")
        if diversity_score < 0.7:
            suggestions.append("Increase citation source diversity")
        if timeliness_score < 0.7:
            suggestions.append("Use more recent materials and literature")
        if accessibility_score < 0.7:
            suggestions.append("Ensure validity of citation links")
        
        level = self._score_to_level(score)
        feedback = self._generate_citation_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.CITATION,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    async def _assess_structure_quality(self, report: ResearchReport) -> QualityMetric:
        """Assess structure quality"""
        score = 0.0
        evidence = []
        suggestions = []
        
        # Check basic structure completeness
        structure_completeness = self._assess_structure_completeness(report)
        score += structure_completeness * 30
        evidence.append(f"Structure completeness: {structure_completeness:.1%}")
        
        # Check hierarchy
        hierarchy_score = self._assess_hierarchy_structure(report)
        score += hierarchy_score * 25
        evidence.append(f"Hierarchy: {hierarchy_score:.1%}")
        
        # Check section balance
        balance_score = self._assess_section_balance(report)
        score += balance_score * 20
        evidence.append(f"Section balance: {balance_score:.1%}")
        
        # Check navigation
        navigation_score = self._assess_navigation_quality(report)
        score += navigation_score * 15
        evidence.append(f"Navigation: {navigation_score:.1%}")
        
        # Check formatting consistency
        formatting_score = self._assess_formatting_consistency(report)
        score += formatting_score * 10
        evidence.append(f"Formatting consistency: {formatting_score:.1%}")
        
        # Generate improvement suggestions
        if structure_completeness < 0.7:
            suggestions.append("Improve basic structure components of the report")
        if hierarchy_score < 0.7:
            suggestions.append("Optimize section hierarchy")
        if balance_score < 0.7:
            suggestions.append("Balance content length across sections")
        if navigation_score < 0.7:
            suggestions.append("Improve report navigation and indexing")
        if formatting_score < 0.7:
            suggestions.append("Unify formatting and style")
        
        level = self._score_to_level(score)
        feedback = self._generate_structure_feedback(score, evidence, suggestions)
        
        return QualityMetric(
            dimension=QualityDimension.STRUCTURE,
            score=score,
            level=level,
            feedback=feedback,
            suggestions=suggestions,
            evidence=evidence
        )
    
    def _calculate_overall_score(self, metrics: List[QualityMetric]) -> float:
        """Calculate overall score"""
        weighted_sum = 0.0
        total_weight = 0.0
        
        for metric in metrics:
            weight = self.assessment_weights.get(metric.dimension.value, 1.0)
            weighted_sum += metric.score * weight
            total_weight += weight
        
        return weighted_sum / total_weight if total_weight > 0 else 0.0
    
    def _score_to_level(self, score: float) -> QualityLevel:
        """Convert score to quality level"""
        if score >= 90:
            return QualityLevel.EXCELLENT
        elif score >= 80:
            return QualityLevel.GOOD
        elif score >= 70:
            return QualityLevel.FAIR
        elif score >= 60:
            return QualityLevel.POOR
        else:
            return QualityLevel.INADEQUATE
    
    def _analyze_strengths_weaknesses(self, metrics: List[QualityMetric]) -> Tuple[List[str], List[str]]:
        """Analyze strengths and weaknesses"""
        strengths = []
        weaknesses = []
        
        for metric in metrics:
            if metric.score >= 80:
                strengths.append(f"{metric.dimension.value}: {metric.feedback}")
            elif metric.score < 70:
                weaknesses.append(f"{metric.dimension.value}: {metric.feedback}")
        
        return strengths, weaknesses
    
    async def _generate_recommendations(self, metrics: List[QualityMetric],
                                      report: ResearchReport,
                                      context: Optional[ResearchContext]) -> List[str]:
        """Generate improvement suggestions"""
        recommendations = []
        
        # Collect all suggestions
        all_suggestions = []
        for metric in metrics:
            all_suggestions.extend(metric.suggestions)
        
        # Prioritize suggestions
        priority_suggestions = self._prioritize_suggestions(all_suggestions, metrics)
        
        # Generate specific improvement suggestions
        for suggestion in priority_suggestions[:10]:  # Take top 10 suggestions
            recommendations.append(suggestion)
        
        return recommendations
    
    def _generate_assessment_summary(self, overall_score: float, 
                                   overall_level: QualityLevel,
                                   metrics: List[QualityMetric],
                                   strengths: List[str],
                                   weaknesses: List[str]) -> str:
        """Generate assessment summary"""
        summary = f"""## Quality Assessment Summary

**Overall Score**: {overall_score:.1f}/100 ({overall_level.value})

### Strengths
{chr(10).join(f'- {strength}' for strength in strengths[:5])}

### Weaknesses
{chr(10).join(f'- {weakness}' for weakness in weaknesses[:5])}

### Dimension Scores
{chr(10).join(f'- {metric.dimension.value}: {metric.score:.1f}/100 ({metric.level.value})' for metric in metrics)}

### Overall Evaluation
{self._generate_overall_evaluation(overall_score, overall_level)}
"""
        return summary
    
    def _generate_quality_report(self, result: QualityAssessmentResult) -> str:
        """Generate quality report"""
        report = f"""# Report Quality Assessment

**Assessment Time**: {result.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
**Overall Score**: {result.overall_score:.1f}/100
**Quality Level**: {result.overall_level.value}

## Detailed Assessment

{result.assessment_summary}

## Improvement Recommendations

{chr(10).join(f'{i+1}. {rec}' for i, rec in enumerate(result.recommendations))}

## Detailed Metrics

{chr(10).join(self._format_metric_detail(metric) for metric in result.metrics)}
"""
        return report
    
    def _format_metric_detail(self, metric: QualityMetric) -> str:
        """Format metric details"""
        detail = f"""### {metric.dimension.value.title()}

**Score**: {metric.score:.1f}/100 ({metric.level.value})
**Feedback**: {metric.feedback}

**Evidence**:
{chr(10).join(f'- {evidence}' for evidence in metric.evidence)}

**Suggestions**:
{chr(10).join(f'- {suggestion}' for suggestion in metric.suggestions)}
"""
        return detail
    
    def _extract_actionable_items(self, result: QualityAssessmentResult) -> List[Dict[str, Any]]:
        """Extract actionable items"""
        items = []
        
        for metric in result.metrics:
            if metric.score < 80:  # Dimensions requiring improvement
                for suggestion in metric.suggestions:
                    items.append({
                        "dimension": metric.dimension.value,
                        "priority": self._calculate_priority(metric.score),
                        "action": suggestion,
                        "current_score": metric.score,
                        "target_score": min(metric.score + 20, 100)
                    })
        
        # Sort by priority
        items.sort(key=lambda x: x["priority"], reverse=True)
        
        return items
    
    def _calculate_priority(self, score: float) -> int:
        """Calculate priority"""
        if score < 60:
            return 3  # High priority
        elif score < 75:
            return 2  # Medium priority
        else:
            return 1  # Low priority
    
    # Helper assessment methods
    def _extract_expected_topics(self, research_topic: str) -> set:
        """Extract expected topics"""
        # Simplified topic extraction logic
        words = research_topic.lower().split()
        return set(word for word in words if len(word) > 3)
    
    def _extract_covered_topics(self, report: ResearchReport) -> set:
        """Extract covered topics"""
        topics = set()
        
        # Extract from title
        if report.title:
            topics.update(word.lower() for word in report.title.split() if len(word) > 3)
        
        # Extract from section titles
        for section in report.sections:
            topics.update(word.lower() for word in section.title.split() if len(word) > 3)
        
        return topics
    
    def _validate_citation_urls(self, citations: List[Citation]) -> List[Citation]:
        """Validate citation URLs"""
        # Simplified URL validation logic
        valid_citations = []
        for citation in citations:
            if citation.source_url and citation.source_url.startswith(('http://', 'https://')):
                valid_citations.append(citation)
        return valid_citations
    
    def _check_content_consistency(self, report: ResearchReport) -> float:
        """Check content consistency"""
        # Simplified consistency check
        return 0.85  # Assume 85% consistency
    
    def _calculate_text_relevance(self, text: str, topic: str) -> float:
        """Calculate text relevance"""
        if not text or not topic:
            return 0.0
        
        text_words = set(text.lower().split())
        topic_words = set(topic.lower().split())
        
        if not topic_words:
            return 0.0
        
        intersection = text_words.intersection(topic_words)
        return len(intersection) / len(topic_words)
    
    def _calculate_content_relevance(self, report: ResearchReport, 
                                   context: ResearchContext) -> float:
        """Calculate content relevance"""
        total_relevance = 0.0
        section_count = 0
        
        for section in report.sections:
            if section.content:
                relevance = self._calculate_text_relevance(
                    section.content, context.research_topic
                )
                total_relevance += relevance
                section_count += 1
        
        return total_relevance / section_count if section_count > 0 else 0.0
    
    def _calculate_objective_alignment(self, report: ResearchReport, 
                                     context: ResearchContext) -> float:
        """Calculate objective alignment"""
        if not context.research_objective:
            return 0.7  # Default value
        
        # Check abstract alignment with objective
        if report.abstract:
            return self._calculate_text_relevance(
                report.abstract, context.research_objective
            )
        
        return 0.5
    
    def _assess_logical_structure(self, report: ResearchReport) -> float:
        """Assess logical structure"""
        if not report.sections:
            return 0.0
        
        # Check for basic structure of introduction, body, conclusion
        section_titles = [s.title.lower() for s in report.sections]
        
        has_intro = any('introduction' in title or 'overview' in title or 'introduction' in title for title in section_titles)
        has_conclusion = any('conclusion' in title or 'summary' in title for title in section_titles)
        has_body = len(report.sections) >= 3
        
        structure_score = 0.0
        if has_intro:
            structure_score += 0.3
        if has_conclusion:
            structure_score += 0.3
        if has_body:
            structure_score += 0.4
        
        return structure_score
    
    def _assess_section_transitions(self, report: ResearchReport) -> float:
        """Assess section transitions"""
        # Simplified transition assessment
        return 0.8  # Assume 80% transition quality
    
    def _assess_content_flow(self, report: ResearchReport) -> float:
        """Assess content flow"""
        # Simplified fluency assessment
        return 0.75  # Assume 75% fluency
    
    def _assess_terminology_consistency(self, report: ResearchReport) -> float:
        """Assess terminology consistency"""
        # Simplified terminology consistency assessment
        return 0.85  # Assume 85% consistency
    
    def _calculate_total_content_length(self, report: ResearchReport) -> int:
        """Calculate total content length"""
        total_length = 0
        
        if report.abstract:
            total_length += len(report.abstract)
        
        for section in report.sections:
            total_length += len(section.content)
            for subsection in section.subsections:
                total_length += len(subsection.content)
        
        return total_length
    
    def _assess_analysis_depth(self, report: ResearchReport) -> float:
        """Assess analysis depth"""
        # Check for use of analytical vocabulary
        analysis_keywords = ['analysis', 'research', 'findings', 'show', 'demonstrate', 'prove', 'explain', 'therefore', 'because', 'cause']
        
        total_analysis_count = 0
        total_content_length = 0
        
        for section in report.sections:
            content = section.content.lower()
            total_content_length += len(content)
            
            for keyword in analysis_keywords:
                total_analysis_count += content.count(keyword)
        
        if total_content_length == 0:
            return 0.0
        
        analysis_density = total_analysis_count / (total_content_length / 1000)  # Analysis words per 1000 characters
        return min(analysis_density / 5, 1.0)  # Assume 5 analysis words/1000 characters is full score
    
    def _assess_perspective_coverage(self, report: ResearchReport) -> float:
        """Assess perspective coverage"""
        # Check for multi-perspective analysis indicators
        perspective_keywords = ['on the other hand', 'in contrast', 'however', 'but', 'simultaneously', 'furthermore', 'on the other hand', 'on the contrary']
        
        perspective_count = 0
        for section in report.sections:
            content = section.content.lower()
            for keyword in perspective_keywords:
                if keyword in content:
                    perspective_count += 1
        
        return min(perspective_count / 10, 1.0)  # Assume 10 perspective words is full score
    
    def _detect_subjective_language(self, report: ResearchReport) -> float:
        """Detect subjective language"""
        subjective_keywords = ['i believe', 'i feel', 'obviously', 'undoubtedly', 'absolutely', 'certainly', 'must', 'have to']
        
        subjective_count = 0
        total_content_length = 0
        
        for section in report.sections:
            content = section.content.lower()
            total_content_length += len(content)
            
            for keyword in subjective_keywords:
                subjective_count += content.count(keyword)
        
        if total_content_length == 0:
            return 0.0
        
        subjectivity_ratio = subjective_count / (total_content_length / 1000)
        return min(subjectivity_ratio / 2, 1.0)  # Assume 2 subjective words/1000 characters is high subjectivity
    
    def _assess_content_balance(self, report: ResearchReport) -> float:
        """Assess content balance"""
        # Simplified balance assessment
        return 0.8  # Assume 80% balance
    
    def _assess_evidence_support(self, report: ResearchReport) -> float:
        """Assess evidence support"""
        # Check for use of citations and evidence
        citation_count = len(report.citations) if report.citations else 0
        section_count = len(report.sections)
        
        if section_count == 0:
            return 0.0
        
        citation_ratio = citation_count / section_count
        return min(citation_ratio / 2, 1.0)  # Assume 2 citations per section is full score
    
    def _assess_citation_format(self, citations: List[Citation]) -> float:
        """Assess citation format"""
        if not citations:
            return 0.0
        
        formatted_count = 0
        for citation in citations:
            if citation.title and citation.source_url:
                formatted_count += 1
        
        return formatted_count / len(citations)
    
    def _assess_citation_diversity(self, citations: List[Citation]) -> float:
        """Assess citation diversity"""
        if not citations:
            return 0.0
        
        domains = set()
        for citation in citations:
            if citation.source_url:
                try:
                    from urllib.parse import urlparse
                    domain = urlparse(citation.source_url).netloc
                    domains.add(domain)
                except:
                    pass
        
        diversity_ratio = len(domains) / len(citations)
        return min(diversity_ratio * 2, 1.0)  # Assume 50% domain diversity is full score
    
    def _assess_citation_timeliness(self, citations: List[Citation]) -> float:
        """Assess citation timeliness"""
        # Simplified timeliness assessment
        return 0.8  # Assume 80% timeliness
    
    def _assess_citation_accessibility(self, citations: List[Citation]) -> float:
        """Assess citation accessibility"""
        if not citations:
            return 0.0
        
        accessible_count = 0
        for citation in citations:
            if citation.source_url and citation.source_url.startswith(('http://', 'https://')):
                accessible_count += 1
        
        return accessible_count / len(citations)
    
    def _assess_structure_completeness(self, report: ResearchReport) -> float:
        """Assess structure completeness"""
        completeness = 0.0
        
        if report.title:
            completeness += 0.2
        if report.abstract:
            completeness += 0.2
        if report.sections:
            completeness += 0.4
        if report.citations:
            completeness += 0.2
        
        return completeness
    
    def _assess_hierarchy_structure(self, report: ResearchReport) -> float:
        """Assess hierarchy"""
        if not report.sections:
            return 0.0
        
        # Check for reasonable hierarchy
        has_subsections = any(section.subsections for section in report.sections)
        level_variety = len(set(section.level for section in report.sections))
        
        hierarchy_score = 0.0
        if has_subsections:
            hierarchy_score += 0.5
        if level_variety > 1:
            hierarchy_score += 0.5
        
        return hierarchy_score
    
    def _assess_section_balance(self, report: ResearchReport) -> float:
        """Assess section balance"""
        if not report.sections:
            return 0.0
        
        section_lengths = [len(section.content) for section in report.sections]
        if not section_lengths:
            return 0.0
        
        avg_length = sum(section_lengths) / len(section_lengths)
        variance = sum((length - avg_length) ** 2 for length in section_lengths) / len(section_lengths)
        coefficient_of_variation = (variance ** 0.5) / avg_length if avg_length > 0 else 1.0
        
        # Smaller coefficient of variation means better balance
        balance_score = max(0, 1 - coefficient_of_variation)
        return balance_score
    
    def _assess_navigation_quality(self, report: ResearchReport) -> float:
        """Assess navigation quality"""
        # Simplified navigation quality assessment
        navigation_score = 0.0
        
        if report.sections:
            navigation_score += 0.5  # Has section structure
        
        # Check for table of contents
        has_toc = any('table of contents' in section.title or 'contents' in section.title.lower() 
                     for section in report.sections)
        if has_toc:
            navigation_score += 0.5
        
        return navigation_score
    
    def _assess_formatting_consistency(self, report: ResearchReport) -> float:
        """Assess formatting consistency"""
        # Simplified formatting consistency assessment
        return 0.85  # Assume 85% formatting consistency
    
    def _prioritize_suggestions(self, suggestions: List[str], 
                              metrics: List[QualityMetric]) -> List[str]:
        """Prioritize suggestions"""
        # Simplified priority sorting
        suggestion_priority = {}
        
        for metric in metrics:
            priority_weight = 100 - metric.score  # Lower score means higher priority
            for suggestion in metric.suggestions:
                suggestion_priority[suggestion] = suggestion_priority.get(suggestion, 0) + priority_weight
        
        # Sort by priority
        sorted_suggestions = sorted(suggestion_priority.items(), key=lambda x: x[1], reverse=True)
        return [suggestion for suggestion, _ in sorted_suggestions]
    
    def _generate_overall_evaluation(self, score: float, level: QualityLevel) -> str:
        """Generate overall evaluation"""
        if level == QualityLevel.EXCELLENT:
            return "Report quality is excellent, with excellent performance across all aspects, serving as an exemplary high-quality research report."
        elif level == QualityLevel.GOOD:
            return "Report quality is good, with good performance in most aspects, but some aspects can be improved."
        elif level == QualityLevel.FAIR:
            return "Report quality is fair, meeting basic requirements, but many aspects need to be improved."
        elif level == QualityLevel.POOR:
            return "Report quality is poor, with obvious deficiencies, requiring significant improvement."
        else:
            return "Report quality is inadequate, with serious issues, requiring re-writing."
    
    # Feedback generation methods
    def _generate_completeness_feedback(self, score: float, evidence: List[str], 
                                      suggestions: List[str]) -> str:
        """Generate completeness feedback"""
        if score >= 80:
            return "Report structure is complete, including necessary components."
        elif score >= 60:
            return "Report is basically complete, but lacks some important components."
        else:
            return "Report completeness is inadequate, missing multiple key components."
    
    def _generate_accuracy_feedback(self, score: float, evidence: List[str], 
                                  suggestions: List[str]) -> str:
        """Generate accuracy feedback"""
        if score >= 80:
            return "Report content is accurate and reliable, with valid citations and data."
        elif score >= 60:
            return "Report content is basically accurate, but contains some information that needs verification."
        else:
            return "Report accuracy needs to be improved, requiring verification and correction of multiple information."
    
    def _generate_relevance_feedback(self, score: float, evidence: List[str], 
                                   suggestions: List[str]) -> str:
        """Generate relevance feedback"""
        if score >= 80:
            return "Report content is highly relevant to the research topic, tightly aligned with research objectives."
        elif score >= 60:
            return "Report content is basically relevant to the research topic, but has some deviations."
        else:
            return "Report content is insufficiently relevant to the research topic, needs to be refocused."
    
    def _generate_coherence_feedback(self, score: float, evidence: List[str], 
                                   suggestions: List[str]) -> str:
        """Generate coherence feedback"""
        if score >= 80:
            return "Report logic is clear, structure is coherent, and expression is fluent."
        elif score >= 60:
            return "Report is basically coherent, but lacks effective connections between some sections."
        else:
            return "Report coherence is inadequate, logical structure needs to be reorganized."
    
    def _generate_depth_feedback(self, score: float, evidence: List[str], 
                               suggestions: List[str]) -> str:
        """Generate depth feedback"""
        if score >= 80:
            return "Report analysis is in-depth, content is detailed, and covers research topics from multiple perspectives."
        elif score >= 60:
            return "Report has a certain depth, but analysis can be more in-depth."
        else:
            return "Report depth is inadequate, needs to increase analysis breadth and depth."
    
    def _generate_objectivity_feedback(self, score: float, evidence: List[str], 
                                     suggestions: List[str]) -> str:
        """Generate objectivity feedback"""
        if score >= 80:
            return "Report is objective and neutral, analyzing based on facts and evidence."
        elif score >= 60:
            return "Report is basically objective, but contains some subjective expressions."
        else:
            return "Report objectivity is inadequate, needs to reduce subjective judgment and bias."
    
    def _generate_citation_feedback(self, score: float, evidence: List[str], 
                                  suggestions: List[str]) -> str:
        """Generate citation feedback"""
        if score >= 80:
            return "Citations are complete and diverse, with strong support."
        elif score >= 60:
            return "Citations are basically complete, but need to increase quantity and diversity."
        else:
            return "Citation quality is inadequate, needs to improve citation format and increase sources."
    
    def _generate_structure_feedback(self, score: float, evidence: List[str], 
                                   suggestions: List[str]) -> str:
        """Generate structure feedback"""
        if score >= 80:
            return "Report structure is clear and reasonable, with a clear hierarchy, easy to read."
        elif score >= 60:
            return "Report structure is basically reasonable, but needs optimization of hierarchy and balance."
        else:
            return "Report structure needs to be redesigned, improving organization and readability."
    
    def _get_default_standards(self) -> Dict[str, Any]:
        """Get default quality standards"""
        return {
            "minimum_score": 60,
            "target_score": 80,
            "excellence_score": 90,
            "required_sections": ["Introduction", "Body", "Conclusion"],
            "minimum_citations": 5,
            "minimum_content_length": 2000
        }
    
    def _get_assessment_weights(self) -> Dict[str, float]:
        """Get assessment weights"""
        return {
            "completeness": 1.2,
            "accuracy": 1.3,
            "relevance": 1.3,
            "coherence": 1.1,
            "depth": 1.0,
            "objectivity": 0.9,
            "citation": 1.0,
            "structure": 0.8
        }
    
    async def _assess_research_process(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """评估研究过程质量"""
        context = kwargs.get("context")
        
        if not context:
            raise ValueError("研究过程评估需要上下文信息")
        
        process_metrics = {
            "iteration_count": len(context.iterations) if hasattr(context, 'iterations') else 0,
            "depth_score": self._assess_research_depth(context),
            "methodology_score": self._assess_research_methodology(context),
            "coverage_score": self._assess_topic_coverage(context)
        }
        
        overall_process_score = sum(process_metrics.values()) / len(process_metrics)
        
        return {
            "process_score": overall_process_score,
            "metrics": process_metrics,
            "recommendations": self._generate_process_recommendations(process_metrics)
        }
    
    async def _validate_citations(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """验证引用质量"""
        report = kwargs.get("report")
        
        if not report or not report.citations:
            return {
                "validation_result": "no_citations",
                "valid_citations": [],
                "invalid_citations": [],
                "validation_summary": "报告缺少引用"
            }
        
        valid_citations = []
        invalid_citations = []
        
        for citation in report.citations:
            if self._is_valid_citation(citation):
                valid_citations.append(citation)
            else:
                invalid_citations.append(citation)
        
        validity_rate = len(valid_citations) / len(report.citations)
        
        return {
            "validation_result": "completed",
            "valid_citations": valid_citations,
            "invalid_citations": invalid_citations,
            "validity_rate": validity_rate,
            "validation_summary": f"引用验证完成，有效率: {validity_rate:.1%}"
        }
    
    async def _check_completeness(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """检查报告完整性"""
        report = kwargs.get("report")
        
        if not report:
            raise ValueError("缺少报告对象")
        
        completeness_checks = {
            "has_title": bool(report.title),
            "has_abstract": bool(report.abstract),
            "has_sections": bool(report.sections),
            "has_citations": bool(report.citations),
            "section_content_complete": self._check_section_content_completeness(report),
            "minimum_content_length": self._check_minimum_content_length(report)
        }
        
        completeness_score = sum(completeness_checks.values()) / len(completeness_checks)
        
        missing_items = [item for item, status in completeness_checks.items() if not status]
        
        return {
            "completeness_score": completeness_score,
            "checks": completeness_checks,
            "missing_items": missing_items,
            "recommendations": self._generate_completeness_recommendations(missing_items)
        }
    
    def _assess_research_depth(self, context) -> float:
        """评估研究深度"""
        if not hasattr(context, 'iterations'):
            return 0.5
        
        iteration_count = len(context.iterations)
        # 假设5轮迭代为满分
        return min(iteration_count / 5.0, 1.0)
    
    def _assess_research_methodology(self, context) -> float:
        """评估研究方法"""
        # 简化的方法评估
        return 0.8  # 假设80%的方法质量
    
    def _assess_topic_coverage(self, context) -> float:
        """评估主题覆盖度"""
        # 简化的覆盖度评估
        return 0.85  # 假设85%的覆盖度
    
    def _generate_process_recommendations(self, metrics: Dict[str, float]) -> List[str]:
        """生成过程改进建议"""
        recommendations = []
        
        if metrics.get("iteration_count", 0) < 3:
            recommendations.append("增加研究迭代轮数以提高深度")
        
        if metrics.get("methodology_score", 0) < 0.7:
            recommendations.append("改进研究方法和策略")
        
        if metrics.get("coverage_score", 0) < 0.8:
            recommendations.append("扩大主题覆盖范围")
        
        return recommendations
    
    def _is_valid_citation(self, citation) -> bool:
        """检查引用是否有效"""
        if not citation.source_url:
            return False
        
        if not citation.source_url.startswith(('http://', 'https://')):
            return False
        
        if not citation.title:
            return False
        
        return True
    
    def _check_section_content_completeness(self, report) -> bool:
        """检查章节内容完整性"""
        if not report.sections:
            return False
        
        content_sections = [s for s in report.sections if s.content.strip()]
        return len(content_sections) >= len(report.sections) * 0.8  # 80%的章节有内容
    
    def _check_minimum_content_length(self, report) -> bool:
        """检查最小内容长度"""
        total_length = self._calculate_total_content_length(report)
        return total_length >= self.quality_standards.get("minimum_content_length", 2000)
    
    def _generate_completeness_recommendations(self, missing_items: List[str]) -> List[str]:
        """生成完整性改进建议"""
        recommendations = []
        
        item_mapping = {
            "has_title": "添加报告标题",
            "has_abstract": "添加报告摘要",
            "has_sections": "添加报告章节",
            "has_citations": "添加参考文献",
            "section_content_complete": "完善章节内容",
            "minimum_content_length": "增加报告内容长度"
        }
        
        for item in missing_items:
            if item in item_mapping:
                recommendations.append(item_mapping[item])
        
        return recommendations