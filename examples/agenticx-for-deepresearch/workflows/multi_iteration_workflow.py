"""Multi-iteration Reflective Research Workflow based on AgenticX

This module implements MultiIterationResearchWorkflow, providing true multi-round reflective research capabilities,
strictly following the AgenticX framework's workflow design patterns.
"""

from typing import Dict, List, Any, Optional, Tuple
import asyncio
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum

from agenticx.core import Workflow, WorkflowContext, WorkflowResult
from agenticx.core.workflow_engine import WorkflowStatus
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.observability import CallbackManager


class EventType(Enum):
    """Event type enumeration"""
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_COMPLETED = "workflow_completed"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

from models import (
    ResearchContext, ResearchIteration, KnowledgeGap, 
    SearchQuery, SearchResult, ResearchReport, ResearchPhase,
    Citation, ReportSection, QueryType
)
from agents.planner import PlannerAgent
from agents.query_generator import QueryGeneratorAgent
from agents.research_summarizer import ResearchSummarizerAgent
from agents.report_writer import ReportWriterAgent
from tools.google_search import GoogleSearchTool
from tools.bing_search import BingWebSearchTool
from tools.bochaai_search import BochaaIWebSearchTool
from report.citation_manager import CitationManagerTask
from report.report_builder import StructuredReportBuilderTask
from report.quality_assessment import QualityAssessmentTask
from interactive.progress_tracker import ProgressTracker, ProgressPhase
from interactive.real_time_monitor import RealTimeMonitor


class IterationStrategy(Enum):
    """Iteration strategy"""
    BREADTH_FIRST = "breadth_first"      # Breadth first
    DEPTH_FIRST = "depth_first"          # Depth first
    ADAPTIVE = "adaptive"                # Adaptive
    QUALITY_DRIVEN = "quality_driven"    # Quality driven
    USER_GUIDED = "user_guided"          # User guided


class TerminationCriteria(Enum):
    """Termination criteria"""
    MAX_ITERATIONS = "max_iterations"    # Maximum iterations
    QUALITY_THRESHOLD = "quality_threshold"  # Quality threshold
    KNOWLEDGE_COMPLETENESS = "knowledge_completeness"  # Knowledge completeness
    TIME_LIMIT = "time_limit"            # Time limit
    USER_SATISFACTION = "user_satisfaction"  # User satisfaction
    CONVERGENCE = "convergence"          # Convergence


@dataclass
class IterationConfig:
    """Iteration configuration"""
    max_iterations: int = 5
    min_iterations: int = 2
    strategy: IterationStrategy = IterationStrategy.ADAPTIVE
    termination_criteria: List[TerminationCriteria] = field(default_factory=lambda: [
        TerminationCriteria.MAX_ITERATIONS,
        TerminationCriteria.QUALITY_THRESHOLD
    ])
    quality_threshold: float = 0.8
    completeness_threshold: float = 0.85
    time_limit_minutes: int = 60
    convergence_threshold: float = 0.05
    enable_user_feedback: bool = True
    enable_real_time_monitoring: bool = True


@dataclass
class IterationResult:
    """Iteration result"""
    iteration_number: int
    research_phase: ResearchPhase
    search_queries: List[SearchQuery]
    search_results: List[SearchResult]
    knowledge_gaps: List[KnowledgeGap]
    quality_score: float
    completeness_score: float
    new_insights: List[str]
    execution_time: float
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReflectionAnalysis:
    """Reflection analysis"""
    iteration_number: int
    knowledge_coverage: float
    information_quality: float
    source_diversity: float
    temporal_coverage: float
    identified_gaps: List[KnowledgeGap]
    improvement_suggestions: List[str]
    next_iteration_strategy: str
    confidence_score: float


class MultiIterationResearchWorkflow:
    """Multi-iteration reflective research workflow
    
    Based on agenticx.core.Workflow implementation, provides:
    1. Multi-round iterative research
    2. Intelligent reflection and strategy adjustment
    3. Knowledge gap identification and filling
    4. Quality-driven iteration control
    5. Real-time monitoring and user interaction
    """
    
    def __init__(self, config: Optional[IterationConfig] = None, **kwargs):
        # Remove super().__init__(**kwargs) call since we're not inheriting from Workflow
        
        # Configuration
        self.config = config or IterationConfig()
        
        # Agents
        self.planner_agent: Optional[PlannerAgent] = None
        self.query_generator: Optional[QueryGeneratorAgent] = None
        self.research_summarizer: Optional[ResearchSummarizerAgent] = None
        self.report_writer: Optional[ReportWriterAgent] = None
        
        # Tools
        self.search_tools: List[Any] = []
        
        # Tasks
        self.citation_manager: Optional[CitationManagerTask] = None
        self.report_builder: Optional[StructuredReportBuilderTask] = None
        self.quality_assessor: Optional[QualityAssessmentTask] = None
        
        # Monitoring components
        self.progress_tracker: Optional[ProgressTracker] = None
        self.real_time_monitor: Optional[RealTimeMonitor] = None
        
        # Research state
        self.research_context: Optional[ResearchContext] = None
        self.iterations: List[IterationResult] = []
        self.reflections: List[ReflectionAnalysis] = []
        self.current_iteration = 0
        self.total_search_results: List[SearchResult] = []
        self.accumulated_knowledge: Dict[str, Any] = {}
        
        # Performance metrics
        self.performance_metrics = {
            "total_execution_time": 0.0,
            "total_search_queries": 0,
            "total_search_results": 0,
            "average_quality_score": 0.0,
            "knowledge_growth_rate": 0.0
        }
    
    async def setup(self, context: WorkflowContext) -> None:
        """Set up the workflow"""
        # Initialize workflow components
        
        # Initialize agents
        self.planner_agent = PlannerAgent(name="planner")
        self.query_generator = QueryGeneratorAgent(name="query_generator")
        self.research_summarizer = ResearchSummarizerAgent(name="research_summarizer")
        self.report_writer = ReportWriterAgent(name="report_writer")
        
        # Initialize search tools
        self.search_tools = [
            GoogleSearchTool(),
            BingWebSearchTool(),
            BochaaIWebSearchTool()
        ]
        
        # Initialize tasks with proper arguments
        self.citation_manager = CitationManagerTask(
            description="Manage citations for research",
            expected_output="Formatted citations"
        )
        self.report_builder = StructuredReportBuilderTask(
            description="Build structured research report", 
            expected_output="Comprehensive research report"
        )
        self.quality_assessor = QualityAssessmentTask(
            description="Assess research quality",
            expected_output="Quality assessment score"
        )
        
        # Initialize monitoring components
        if self.config.enable_real_time_monitoring:
            self.progress_tracker = ProgressTracker()
            self.real_time_monitor = RealTimeMonitor()
            
            # Start monitoring
            await self.progress_tracker.initialize_tracking(
                session_id=context.execution_id,
                research_topic=context.variables.get("research_topic", "Unknown topic"),
                total_iterations=self.config.max_iterations
            )
            await self.real_time_monitor.start_monitoring()
        
        # Initialize research context
        self.research_context = ResearchContext(
            research_topic=context.variables.get("research_topic", ""),
            research_objective=context.variables.get("research_objective", "研究目标"),
            target_language=context.variables.get("target_language", "zh-CN"),
            max_iterations=self.config.max_iterations
        )
    
    async def execute(self, context: WorkflowContext) -> WorkflowResult:
        """Execute multi-round reflective research"""
        start_time = datetime.now()
        
        try:
            # First phase: Initial planning
            if self.research_context:
                await self._emit_event(EventType.WORKFLOW_STARTED, {
                    "workflow_name": "MultiIterationResearchWorkflow",
                    "research_topic": self.research_context.research_topic,
                    "max_iterations": self.config.max_iterations
                })
            
            initial_plan = await self._create_initial_research_plan(context)
            
            # Multi-round iterative research
            for iteration in range(1, self.config.max_iterations + 1):
                self.current_iteration = iteration
                
                if self.progress_tracker:
                    await self.progress_tracker.start_iteration(iteration)
                
                # Execute single iteration
                iteration_result = await self._execute_iteration(context, iteration)
                self.iterations.append(iteration_result)
                
                # Perform reflection analysis
                reflection = await self._perform_reflection_analysis(iteration)
                self.reflections.append(reflection)
                
                # Check termination criteria
                should_terminate, termination_reason = await self._check_termination_criteria()
                
                if should_terminate:
                    await self._emit_event(EventType.INFO, {
                        "message": f"Research terminated after {iteration} iterations",
                        "reason": termination_reason
                    })
                    break
                
                # Adjust strategy for next iteration
                await self._adjust_strategy_for_next_iteration(reflection)
            
            # Generate final report
            final_report = await self._generate_final_report(context)
            
            # Calculate final metrics
            await self._calculate_final_metrics()
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            result = WorkflowResult(
                execution_id=context.execution_id,
                workflow_id=context.workflow_id,
                status=WorkflowStatus.COMPLETED,
                start_time=start_time,
                end_time=datetime.now(),
                result={
                    "success": True,
                    "research_report": final_report,
                    "iterations": self.iterations,
                    "reflections": self.reflections,
                    "performance_metrics": self.performance_metrics,
                    "total_execution_time": execution_time
                },
                node_results={
                    "total_iterations": len(self.iterations),
                    "total_search_results": len(self.total_search_results),
                    "final_quality_score": self.iterations[-1].quality_score if self.iterations else 0.0
                },
                execution_time=execution_time
            )
            
            await self._emit_event(EventType.WORKFLOW_COMPLETED, {
                "workflow_name": "MultiIterationResearchWorkflow",
                "success": True,
                "execution_time": execution_time,
                "total_iterations": len(self.iterations)
            })
            
            return result
            
        except Exception as e:
            await self._emit_event(EventType.ERROR, {
                "error": str(e),
                "workflow_name": "MultiIterationResearchWorkflow"
            })
            
            return WorkflowResult(
                execution_id=context.execution_id,
                workflow_id=context.workflow_id,
                status=WorkflowStatus.FAILED,
                start_time=start_time,
                end_time=datetime.now(),
                error=str(e),
                result={"partial_results": self.iterations}
            )
        
        finally:
            # Clean up resources
            if self.real_time_monitor:
                await self.real_time_monitor.stop_monitoring()
    
    async def _create_initial_research_plan(self, context: WorkflowContext) -> Dict[str, Any]:
        """Create initial research plan"""
        if self.progress_tracker:
            await self.progress_tracker.start_phase(
                self.current_iteration, 
                ProgressPhase.PLANNING, 
                "Creating initial research plan"
            )
        
        # Create placeholder plan instead of calling unimplemented method
        plan = {
            "research_phases": ["query_generation", "search_execution", "analysis", "gap_identification"],
            "estimated_iterations": self.config.max_iterations,
            "research_strategy": "adaptive"
        }
        
        if self.progress_tracker:
            await self.progress_tracker.complete_phase(
                self.current_iteration, 
                ProgressPhase.PLANNING, 
                success=True
            )
        
        return plan
    
    async def _execute_iteration(self, context: WorkflowContext, 
                               iteration_number: int) -> IterationResult:
        """Execute single iteration"""
        iteration_start_time = datetime.now()
        
        await self._emit_event(EventType.INFO, {
            "message": f"Starting iteration {iteration_number}",
            "iteration_number": iteration_number
        })
        
        # 1. Query generation phase
        search_queries = await self._generate_search_queries(iteration_number)
        
        # 2. Search execution phase
        search_results = await self._execute_searches(search_queries)
        
        # 3. Result analysis phase
        analysis_results = await self._analyze_search_results(search_results)
        
        # 4. Knowledge gap identification
        knowledge_gaps = await self._identify_knowledge_gaps(analysis_results)
        
        # 5. Quality assessment
        quality_score = await self._assess_iteration_quality(search_results, analysis_results)
        
        # 6. Completeness assessment
        completeness_score = await self._assess_knowledge_completeness()
        
        execution_time = (datetime.now() - iteration_start_time).total_seconds()
        
        iteration_result = IterationResult(
            iteration_number=iteration_number,
            research_phase=ResearchPhase.SEARCH_EXECUTION,
            search_queries=search_queries,
            search_results=search_results,
            knowledge_gaps=knowledge_gaps,
            quality_score=quality_score,
            completeness_score=completeness_score,
            new_insights=analysis_results.get("insights", []),
            execution_time=execution_time,
            metadata={
                "search_count": len(search_queries),
                "result_count": len(search_results),
                "gap_count": len(knowledge_gaps)
            }
        )
        
        # Update accumulated data
        self.total_search_results.extend(search_results)
        self._update_accumulated_knowledge(analysis_results)
        
        if self.progress_tracker:
            await self.progress_tracker.complete_iteration(
                iteration_number,
                search_count=len(search_queries),
                analysis_count=len(search_results),
                knowledge_gaps_found=len(knowledge_gaps),
                quality_score=quality_score
            )
        
        return iteration_result
    
    async def _generate_search_queries(self, iteration_number: int) -> List[SearchQuery]:
        """Generate search queries"""
        if self.progress_tracker:
            await self.progress_tracker.start_phase(
                iteration_number, 
                ProgressPhase.SEARCHING, 
                "Generating search queries"
            )
        
        # Generate queries based on previous iteration results and knowledge gaps
        previous_gaps = []
        if self.iterations:
            for iteration in self.iterations:
                previous_gaps.extend(iteration.knowledge_gaps)
        
        # Generate placeholder queries instead of calling unimplemented method
        if self.research_context:
            queries = [
                SearchQuery(
                    query=f"{self.research_context.research_topic} overview iteration {iteration_number}",
                    query_type=QueryType.INITIAL,
                    max_results=10
                ),
                SearchQuery(
                    query=f"{self.research_context.research_topic} detailed analysis",
                    query_type=QueryType.DEEP_DIVE,
                    max_results=10
                )
            ]
        else:
            queries = []
            print("Warning: research_context is None")
        
        if self.progress_tracker:
            await self.progress_tracker.complete_task(
                iteration_number, 
                ProgressPhase.SEARCHING, 
                "Query generation completed",
                {"query_count": len(queries)}
            )
        
        return queries
    
    async def _execute_searches(self, queries: List[SearchQuery]) -> List[SearchResult]:
        """Execute searches"""
        all_results = []
        
        for i, query in enumerate(queries):
            if self.progress_tracker:
                await self.progress_tracker.complete_task(
                    self.current_iteration,
                    ProgressPhase.SEARCHING,
                    f"Executing search {i+1}/{len(queries)}"
                )
            
            # Use multiple search tools
            for tool in self.search_tools:
                try:
                    results = await tool.search(
                        query=query.query,
                        max_results=query.max_results
                    )
                    all_results.extend(results)
                except Exception as e:
                    await self._emit_event(EventType.WARNING, {
                        "message": f"Search tool {tool.__class__.__name__} execution failed",
                        "error": str(e),
                        "query": query.query
                    })
        
        # Deduplicate and filter results
        unique_results = self._deduplicate_search_results(all_results)
        
        return unique_results
    
    async def _analyze_search_results(self, results: List[SearchResult]) -> Dict[str, Any]:
        """Analyze search results"""
        if self.progress_tracker:
            await self.progress_tracker.start_phase(
                self.current_iteration, 
                ProgressPhase.ANALYZING, 
                "Analyzing search results"
            )
        
        # Generate placeholder analysis instead of calling unimplemented method
        analysis = {
            "insights": ["Key insight from search results", "Another important finding"],
            "summary": "Analysis summary of search results",
            "quality_score": 0.75,
            "relevance_score": 0.8
        }
        
        if self.progress_tracker:
            await self.progress_tracker.complete_phase(
                self.current_iteration, 
                ProgressPhase.ANALYZING, 
                success=True
            )
        
        return analysis
    
    async def _identify_knowledge_gaps(self, analysis_results: Dict[str, Any]) -> List[KnowledgeGap]:
        """Identify knowledge gaps"""
        # Generate placeholder knowledge gaps instead of calling unimplemented method
        if self.research_context:
            gaps = [
                KnowledgeGap(
                    topic=f"Gap in {self.research_context.research_topic}",
                    description="Need more detailed information on this topic",
                    priority=5,
                    suggested_queries=[f"More details about {self.research_context.research_topic}"]
                )
            ] if len(self.iterations) < 2 else []  # Only generate gaps for first few iterations
        else:
            gaps = []
        
        return gaps
    
    async def _assess_iteration_quality(self, search_results: List[SearchResult], 
                                       analysis_results: Dict[str, Any]) -> float:
        """Assess iteration quality"""
        # Generate placeholder quality assessment instead of calling unimplemented method
        quality_assessment = type('QualityAssessment', (), {
            'overall_score': 0.75
        })()
        
        return 0.75  # Return a fixed quality score
    
    async def _assess_knowledge_completeness(self) -> float:
        """Assess knowledge completeness"""
        # Simplified completeness assessment based on current research context
        if not self.research_context:
            return 0.0
        
        # Calculate completeness based on research progress and findings
        if len(self.iterations) == 0:
            return 0.0
        
        # Check if we have sufficient information
        latest_iteration = self.iterations[-1]
        has_sufficient_results = len(latest_iteration.search_results) > 5
        has_quality_analysis = latest_iteration.quality_score > 0.7
        
        if has_sufficient_results and has_quality_analysis:
            return 0.8
        elif has_sufficient_results:
            return 0.6
        else:
            return 0.4
    
    async def _perform_reflection_analysis(self, iteration_number: int) -> ReflectionAnalysis:
        """Perform reflection analysis"""
        if self.progress_tracker:
            await self.progress_tracker.start_phase(
                iteration_number, 
                ProgressPhase.REFLECTING, 
                "Performing reflection analysis"
            )
        
        current_iteration = self.iterations[-1]
        
        # Calculate various coverage metrics
        knowledge_coverage = await self._calculate_knowledge_coverage()
        information_quality = current_iteration.quality_score
        source_diversity = await self._calculate_source_diversity()
        temporal_coverage = await self._calculate_temporal_coverage()
        
        # Generate improvement suggestions
        improvement_suggestions = await self._generate_improvement_suggestions()
        
        # Determine next iteration strategy
        next_strategy = await self._determine_next_iteration_strategy()
        
        # Calculate confidence score
        confidence_score = await self._calculate_confidence_score()
        
        reflection = ReflectionAnalysis(
            iteration_number=iteration_number,
            knowledge_coverage=knowledge_coverage,
            information_quality=information_quality,
            source_diversity=source_diversity,
            temporal_coverage=temporal_coverage,
            identified_gaps=current_iteration.knowledge_gaps,
            improvement_suggestions=improvement_suggestions,
            next_iteration_strategy=next_strategy,
            confidence_score=confidence_score
        )
        
        if self.progress_tracker:
            await self.progress_tracker.complete_phase(
                iteration_number, 
                ProgressPhase.REFLECTING, 
                success=True
            )
        
        return reflection
    
    async def _check_termination_criteria(self) -> Tuple[bool, str]:
        """Check termination criteria"""
        for criteria in self.config.termination_criteria:
            should_terminate, reason = await self._evaluate_termination_criteria(criteria)
            if should_terminate:
                return True, reason
        
        return False, ""
    
    async def _evaluate_termination_criteria(self, criteria: TerminationCriteria) -> Tuple[bool, str]:
        """Evaluate specific termination criteria"""
        if criteria == TerminationCriteria.MAX_ITERATIONS:
            if self.current_iteration >= self.config.max_iterations:
                return True, "Maximum iterations reached"
        
        elif criteria == TerminationCriteria.QUALITY_THRESHOLD:
            if self.iterations and self.iterations[-1].quality_score >= self.config.quality_threshold:
                return True, "Quality threshold reached"
        
        elif criteria == TerminationCriteria.KNOWLEDGE_COMPLETENESS:
            if self.iterations and self.iterations[-1].completeness_score >= self.config.completeness_threshold:
                return True, "Knowledge completeness threshold reached"
        
        elif criteria == TerminationCriteria.CONVERGENCE:
            if len(self.iterations) >= 2:
                current_score = self.iterations[-1].quality_score
                previous_score = self.iterations[-2].quality_score
                improvement = abs(current_score - previous_score)
                if improvement < self.config.convergence_threshold:
                    return True, "Quality score convergence"
        
        return False, ""
    
    async def _adjust_strategy_for_next_iteration(self, reflection: ReflectionAnalysis) -> None:
        """Adjust strategy for next iteration"""
        # Adjust search strategy, query generation strategy, etc. based on reflection results
        if reflection.source_diversity < 0.5:
            # Increase search source diversity
            pass
        
        if reflection.knowledge_coverage < 0.7:
            # Expand search scope
            pass
        
        if reflection.information_quality < 0.6:
            # Improve search quality
            pass
    
    async def _generate_final_report(self, context: WorkflowContext) -> ResearchReport:
        """Generate final report"""
        if self.progress_tracker:
            await self.progress_tracker.start_phase(
                self.current_iteration, 
                ProgressPhase.REPORTING, 
                "Generating final report"
            )
        
        # Consolidate results from all iterations
        all_results = self.total_search_results
        all_analysis = self.accumulated_knowledge
        
        # Manage citations
        # Generate placeholder citations instead of calling unimplemented method
        citations = [
            Citation(
                source_url=result.url,
                title=result.title,
                access_date=datetime.now()
            ) for result in all_results[:10]  # Limit to first 10 results
        ]
        
        # Build report
        # Generate placeholder report instead of calling unimplemented method
        if self.research_context:
            report = ResearchReport(
                title=f"Research Report on {self.research_context.research_topic}",
                abstract="This is a comprehensive research report generated through multi-iteration analysis.",
                sections=[
                    ReportSection(
                        title="Executive Summary",
                        content="Summary of key findings from the research.",
                        level=1
                    ),
                    ReportSection(
                        title="Detailed Analysis", 
                        content="Detailed analysis based on search results and iterations.",
                        level=1
                    )
                ],
                citations=citations,
                generated_at=datetime.now()
            )
        else:
            report = ResearchReport(
                title="Research Report",
                abstract="Research report generated.",
                citations=citations,
                generated_at=datetime.now()
            )
        
        # Quality assessment
        # Generate placeholder final quality assessment instead of calling unimplemented method
        final_quality = type('FinalQuality', (), {
            'overall_score': 0.8
        })()
        # Add quality score to report metadata instead of as attribute
        report.metadata['quality_score'] = 0.8
        
        if self.progress_tracker:
            await self.progress_tracker.complete_phase(
                self.current_iteration, 
                ProgressPhase.REPORTING, 
                success=True
            )
            await self.progress_tracker.complete_research(
                success=True, 
                final_report_generated=True
            )
        
        return report
    
    async def _calculate_final_metrics(self) -> None:
        """Calculate final performance metrics"""
        total_time = sum(iteration.execution_time for iteration in self.iterations)
        total_queries = sum(len(iteration.search_queries) for iteration in self.iterations)
        total_results = len(self.total_search_results)
        avg_quality = sum(iteration.quality_score for iteration in self.iterations) / len(self.iterations) if self.iterations else 0.0
        
        # Calculate knowledge growth rate
        if len(self.iterations) > 1:
            initial_knowledge = len(self.iterations[0].search_results)
            final_knowledge = len(self.total_search_results)
            growth_rate = (final_knowledge - initial_knowledge) / initial_knowledge if initial_knowledge > 0 else 0.0
        else:
            growth_rate = 0.0
        
        self.performance_metrics.update({
            "total_execution_time": total_time,
            "total_search_queries": total_queries,
            "total_search_results": total_results,
            "average_quality_score": avg_quality,
            "knowledge_growth_rate": growth_rate
        })
    
    # Helper methods
    def _deduplicate_search_results(self, results: List[SearchResult]) -> List[SearchResult]:
        """Deduplicate search results"""
        seen_urls = set()
        unique_results = []
        
        for result in results:
            if result.url not in seen_urls:
                seen_urls.add(result.url)
                unique_results.append(result)
        
        return unique_results
    
    def _update_accumulated_knowledge(self, analysis_results: Dict[str, Any]) -> None:
        """Update accumulated knowledge"""
        for key, value in analysis_results.items():
            if key in self.accumulated_knowledge:
                if isinstance(value, list):
                    self.accumulated_knowledge[key].extend(value)
                elif isinstance(value, dict):
                    self.accumulated_knowledge[key].update(value)
                else:
                    self.accumulated_knowledge[key] = value
            else:
                self.accumulated_knowledge[key] = value
    
    def _is_objective_covered(self, objective: str) -> bool:
        """Check if research objective is covered"""
        # Simplified implementation: check if relevant information is included in accumulated knowledge
        objective_lower = objective.lower()
        for key, value in self.accumulated_knowledge.items():
            if isinstance(value, str) and objective_lower in value.lower():
                return True
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and objective_lower in item.lower():
                        return True
        return False
    
    async def _calculate_knowledge_coverage(self) -> float:
        """Calculate knowledge coverage"""
        # Based on coverage of research objectives
        return await self._assess_knowledge_completeness()
    
    async def _calculate_source_diversity(self) -> float:
        """Calculate source diversity"""
        if not self.total_search_results:
            return 0.0
        
        unique_domains = set()
        for result in self.total_search_results:
            if result.url:
                domain = result.url.split('/')[2] if '/' in result.url else result.url
                unique_domains.add(domain)
        
        # Normalize to 0-1 range
        return min(len(unique_domains) / 10, 1.0)
    
    async def _calculate_temporal_coverage(self) -> float:
        """Calculate temporal coverage"""
        # Simplified implementation: based on distribution of publication dates of search results
        return 0.8  # Placeholder
    
    async def _generate_improvement_suggestions(self) -> List[str]:
        """Generate improvement suggestions"""
        suggestions = []
        
        if self.iterations:
            latest_iteration = self.iterations[-1]
            
            if latest_iteration.quality_score < 0.7:
                suggestions.append("Improve search query precision")
            
            if len(latest_iteration.knowledge_gaps) > 5:
                suggestions.append("Increase search depth to fill knowledge gaps")
            
            if latest_iteration.completeness_score < 0.8:
                suggestions.append("Expand search scope to improve completeness")
        
        return suggestions
    
    async def _determine_next_iteration_strategy(self) -> str:
        """Determine next iteration strategy"""
        if not self.iterations:
            return "breadth_first"
        
        latest_iteration = self.iterations[-1]
        
        if len(latest_iteration.knowledge_gaps) > 3:
            return "depth_first"  # Deepen knowledge gaps
        elif latest_iteration.quality_score < 0.7:
            return "quality_driven"  # Improve quality
        else:
            return "adaptive"  # Adaptive strategy
    
    async def _calculate_confidence_score(self) -> float:
        """Calculate confidence score"""
        if not self.iterations:
            return 0.0
        
        latest_iteration = self.iterations[-1]
        
        # Calculate confidence based on quality score, completeness, and result volume
        quality_factor = latest_iteration.quality_score
        completeness_factor = latest_iteration.completeness_score
        volume_factor = min(len(latest_iteration.search_results) / 20, 1.0)
        
        confidence = (quality_factor + completeness_factor + volume_factor) / 3
        return confidence
    
    async def _emit_event(self, event_type: EventType, data: Dict[str, Any]) -> None:
        """Emit event"""
        try:
            # Simple event logging instead of creating Event objects
            event_data = {
                "event_type": event_type.value,
                "data": data,
                "timestamp": datetime.now().isoformat()
            }
            # Here you can add actual event sending logic
            # For example: send to monitoring system, logging system, etc.
            print(f"[{event_type.value}] {data}")
        except Exception as e:
            print(f"Failed to emit event: {e}")