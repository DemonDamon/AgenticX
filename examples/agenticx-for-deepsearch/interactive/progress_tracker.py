"""Progress Tracker based on AgenticX

This module implements ProgressTracker, responsible for tracking research progress and status,
strictly following AgenticX framework's observability design.
"""

from typing import Dict, List, Any, Optional, Callable
from datetime import datetime, timedelta
import asyncio
from dataclasses import dataclass, field
from enum import Enum
import json
from agenticx.observability import BaseCallbackHandler, CallbackManager
from models import ResearchContext, ResearchIteration


class ProgressPhase(Enum):
    """Progress phases"""
    INITIALIZING = "initializing"      # Initialization
    PLANNING = "planning"              # Planning phase
    SEARCHING = "searching"            # Search phase
    ANALYZING = "analyzing"            # Analysis phase
    REFLECTING = "reflecting"          # Reflection phase
    REPORTING = "reporting"            # Report generation
    COMPLETED = "completed"            # Completed
    ERROR = "error"                    # Error status
    PAUSED = "paused"                  # Paused status


class ProgressStatus(Enum):
    """Progress status"""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class PhaseProgress:
    """Phase progress"""
    phase: ProgressPhase
    status: ProgressStatus
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    progress_percentage: float = 0.0
    current_task: str = ""
    completed_tasks: List[str] = field(default_factory=list)
    total_tasks: int = 0
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IterationProgress:
    """Iteration progress"""
    iteration_number: int
    status: ProgressStatus
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    phases: Dict[ProgressPhase, PhaseProgress] = field(default_factory=dict)
    search_count: int = 0
    analysis_count: int = 0
    knowledge_gaps_found: int = 0
    quality_score: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OverallProgress:
    """Overall progress"""
    session_id: str
    research_topic: str
    start_time: datetime
    end_time: Optional[datetime] = None
    current_iteration: int = 0
    total_iterations: int = 0
    current_phase: ProgressPhase = ProgressPhase.INITIALIZING
    overall_status: ProgressStatus = ProgressStatus.NOT_STARTED
    overall_percentage: float = 0.0
    iterations: Dict[int, IterationProgress] = field(default_factory=dict)
    total_search_results: int = 0
    total_knowledge_gaps: int = 0
    estimated_completion: Optional[datetime] = None
    performance_metrics: Dict[str, Any] = field(default_factory=dict)


class ProgressTracker(BaseCallbackHandler):
    """Progress Tracker
    
    Based on agenticx.observability.BaseCallbackHandler implementation, provides:
    1. Real-time progress tracking
    2. Phase status management
    3. Performance metrics collection
    4. Progress prediction and estimation
    """
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.progress: Optional[OverallProgress] = None
        self.progress_history: List[Dict[str, Any]] = []
        self.progress_callbacks: List[Callable] = []
        self.update_interval = 1.0  # Update interval (seconds)
        self.last_update_time = datetime.now()
        self.performance_data: Dict[str, List[float]] = {
            "search_times": [],
            "analysis_times": [],
            "iteration_times": []
        }
    
    async def initialize_tracking(self, session_id: str, research_topic: str, 
                                total_iterations: int = 3) -> None:
        """Initialize progress tracking"""
        self.progress = OverallProgress(
            session_id=session_id,
            research_topic=research_topic,
            start_time=datetime.now(),
            total_iterations=total_iterations,
            current_phase=ProgressPhase.INITIALIZING,
            overall_status=ProgressStatus.IN_PROGRESS
        )
        
        # Initialize progress structure for all iterations
        for i in range(1, total_iterations + 1):
            self.progress.iterations[i] = IterationProgress(
                iteration_number=i,
                status=ProgressStatus.NOT_STARTED
            )
        
        await self._notify_progress_update("tracking_initialized")
    
    async def start_iteration(self, iteration_number: int) -> None:
        """Start a new iteration"""
        if not self.progress:
            raise ValueError("Progress tracking not initialized")
        
        self.progress.current_iteration = iteration_number
        
        if iteration_number not in self.progress.iterations:
            self.progress.iterations[iteration_number] = IterationProgress(
                iteration_number=iteration_number,
                status=ProgressStatus.NOT_STARTED
            )
        
        iteration_progress = self.progress.iterations[iteration_number]
        iteration_progress.status = ProgressStatus.IN_PROGRESS
        iteration_progress.start_time = datetime.now()
        
        # Initialize phase progress
        phases = [ProgressPhase.PLANNING, ProgressPhase.SEARCHING, 
                 ProgressPhase.ANALYZING, ProgressPhase.REFLECTING]
        
        for phase in phases:
            iteration_progress.phases[phase] = PhaseProgress(
                phase=phase,
                status=ProgressStatus.NOT_STARTED,
                total_tasks=self._estimate_phase_tasks(phase)
            )
        
        await self._update_overall_progress()
        await self._notify_progress_update("iteration_started", {
            "iteration_number": iteration_number
        })
    
    async def start_phase(self, iteration_number: int, phase: ProgressPhase, 
                         task_description: str = "") -> None:
        """Start a new phase"""
        if not self.progress or iteration_number not in self.progress.iterations:
            return
        
        self.progress.current_phase = phase
        iteration_progress = self.progress.iterations[iteration_number]
        
        if phase not in iteration_progress.phases:
            iteration_progress.phases[phase] = PhaseProgress(
                phase=phase,
                status=ProgressStatus.NOT_STARTED,
                total_tasks=self._estimate_phase_tasks(phase)
            )
        
        phase_progress = iteration_progress.phases[phase]
        phase_progress.status = ProgressStatus.IN_PROGRESS
        phase_progress.start_time = datetime.now()
        phase_progress.current_task = task_description
        
        await self._update_overall_progress()
        await self._notify_progress_update("phase_started", {
            "iteration_number": iteration_number,
            "phase": phase.value,
            "task_description": task_description
        })
    
    async def complete_task(self, iteration_number: int, phase: ProgressPhase, 
                          task_name: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Complete a task"""
        if not self.progress or iteration_number not in self.progress.iterations:
            return
        
        iteration_progress = self.progress.iterations[iteration_number]
        
        if phase not in iteration_progress.phases:
            return
        
        phase_progress = iteration_progress.phases[phase]
        phase_progress.completed_tasks.append(task_name)
        
        if metadata:
            phase_progress.metadata.update(metadata)
        
        # Update phase progress percentage
        if phase_progress.total_tasks > 0:
            phase_progress.progress_percentage = (
                len(phase_progress.completed_tasks) / phase_progress.total_tasks * 100
            )
        
        # Collect performance data
        await self._collect_performance_data(phase, metadata or {})
        
        await self._update_overall_progress()
        await self._notify_progress_update("task_completed", {
            "iteration_number": iteration_number,
            "phase": phase.value,
            "task_name": task_name,
            "progress_percentage": phase_progress.progress_percentage
        })
    
    async def complete_phase(self, iteration_number: int, phase: ProgressPhase, 
                           success: bool = True, error_message: Optional[str] = None) -> None:
        """Complete a phase"""
        if not self.progress or iteration_number not in self.progress.iterations:
            return
        
        iteration_progress = self.progress.iterations[iteration_number]
        
        if phase not in iteration_progress.phases:
            return
        
        phase_progress = iteration_progress.phases[phase]
        phase_progress.end_time = datetime.now()
        phase_progress.status = ProgressStatus.COMPLETED if success else ProgressStatus.FAILED
        phase_progress.progress_percentage = 100.0 if success else phase_progress.progress_percentage
        
        if error_message:
            phase_progress.error_message = error_message
        
        await self._update_overall_progress()
        await self._notify_progress_update("phase_completed", {
            "iteration_number": iteration_number,
            "phase": phase.value,
            "success": success,
            "error_message": error_message
        })
    
    async def complete_iteration(self, iteration_number: int, 
                               search_count: int = 0, analysis_count: int = 0,
                               knowledge_gaps_found: int = 0, 
                               quality_score: Optional[float] = None) -> None:
        """Complete an iteration"""
        if not self.progress or iteration_number not in self.progress.iterations:
            return
        
        iteration_progress = self.progress.iterations[iteration_number]
        iteration_progress.end_time = datetime.now()
        iteration_progress.status = ProgressStatus.COMPLETED
        iteration_progress.search_count = search_count
        iteration_progress.analysis_count = analysis_count
        iteration_progress.knowledge_gaps_found = knowledge_gaps_found
        iteration_progress.quality_score = quality_score
        
        # Update overall statistics
        self.progress.total_search_results += search_count
        self.progress.total_knowledge_gaps += knowledge_gaps_found
        
        # Collect iteration performance data
        if iteration_progress.start_time and iteration_progress.end_time:
            iteration_time = (iteration_progress.end_time - iteration_progress.start_time).total_seconds()
            self.performance_data["iteration_times"].append(iteration_time)
        
        await self._update_overall_progress()
        await self._estimate_completion_time()
        await self._notify_progress_update("iteration_completed", {
            "iteration_number": iteration_number,
            "search_count": search_count,
            "analysis_count": analysis_count,
            "knowledge_gaps_found": knowledge_gaps_found,
            "quality_score": quality_score
        })
    
    async def complete_research(self, success: bool = True, 
                              final_report_generated: bool = False) -> None:
        """Complete research"""
        if not self.progress:
            return
        
        self.progress.end_time = datetime.now()
        self.progress.overall_status = ProgressStatus.COMPLETED if success else ProgressStatus.FAILED
        self.progress.current_phase = ProgressPhase.COMPLETED
        self.progress.overall_percentage = 100.0
        
        # Update performance metrics
        await self._calculate_final_metrics()
        
        await self._notify_progress_update("research_completed", {
            "success": success,
            "final_report_generated": final_report_generated,
            "total_duration": self._calculate_total_duration(),
            "performance_metrics": self.progress.performance_metrics
        })
    
    async def handle_error(self, iteration_number: Optional[int], 
                         phase: Optional[ProgressPhase], 
                         error_message: str, recoverable: bool = True) -> None:
        """Handle errors"""
        if not self.progress:
            return
        
        if not recoverable:
            self.progress.overall_status = ProgressStatus.FAILED
            self.progress.current_phase = ProgressPhase.ERROR
        
        error_data = {
            "error_message": error_message,
            "recoverable": recoverable,
            "timestamp": datetime.now().isoformat()
        }
        
        if iteration_number and iteration_number in self.progress.iterations:
            iteration_progress = self.progress.iterations[iteration_number]
            if phase and phase in iteration_progress.phases:
                iteration_progress.phases[phase].error_message = error_message
                iteration_progress.phases[phase].status = ProgressStatus.FAILED
        
        await self._notify_progress_update("error_occurred", error_data)
    
    async def pause_research(self) -> None:
        """Pause research"""
        if not self.progress:
            return
        
        self.progress.current_phase = ProgressPhase.PAUSED
        
        await self._notify_progress_update("research_paused", {
            "pause_time": datetime.now().isoformat()
        })
    
    async def resume_research(self) -> None:
        """Resume research"""
        if not self.progress:
            return
        
        # Resume to previous phase
        # This needs to be determined based on actual situation
        
        await self._notify_progress_update("research_resumed", {
            "resume_time": datetime.now().isoformat()
        })
    
    def get_current_progress(self) -> Optional[Dict[str, Any]]:
        """Get current progress"""
        if not self.progress:
            return None
        
        return {
            "session_id": self.progress.session_id,
            "research_topic": self.progress.research_topic,
            "overall_percentage": self.progress.overall_percentage,
            "current_iteration": self.progress.current_iteration,
            "total_iterations": self.progress.total_iterations,
            "current_phase": self.progress.current_phase.value,
            "overall_status": self.progress.overall_status.value,
            "start_time": self.progress.start_time.isoformat(),
            "estimated_completion": self.progress.estimated_completion.isoformat() if self.progress.estimated_completion else None,
            "total_search_results": self.progress.total_search_results,
            "total_knowledge_gaps": self.progress.total_knowledge_gaps,
            "performance_metrics": self.progress.performance_metrics
        }
    
    def get_iteration_progress(self, iteration_number: int) -> Optional[Dict[str, Any]]:
        """Get progress for a specific iteration"""
        if not self.progress or iteration_number not in self.progress.iterations:
            return None
        
        iteration = self.progress.iterations[iteration_number]
        
        return {
            "iteration_number": iteration.iteration_number,
            "status": iteration.status.value,
            "start_time": iteration.start_time.isoformat() if iteration.start_time else None,
            "end_time": iteration.end_time.isoformat() if iteration.end_time else None,
            "search_count": iteration.search_count,
            "analysis_count": iteration.analysis_count,
            "knowledge_gaps_found": iteration.knowledge_gaps_found,
            "quality_score": iteration.quality_score,
            "phases": {phase.value: {
                "status": progress.status.value,
                "progress_percentage": progress.progress_percentage,
                "current_task": progress.current_task,
                "completed_tasks": progress.completed_tasks,
                "total_tasks": progress.total_tasks,
                "error_message": progress.error_message
            } for phase, progress in iteration.phases.items()}
        }
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get performance summary"""
        summary = {
            "average_search_time": self._calculate_average(self.performance_data["search_times"]),
            "average_analysis_time": self._calculate_average(self.performance_data["analysis_times"]),
            "average_iteration_time": self._calculate_average(self.performance_data["iteration_times"]),
            "total_operations": sum(len(times) for times in self.performance_data.values()),
            "efficiency_score": self._calculate_efficiency_score()
        }
        
        if self.progress:
            summary.update(self.progress.performance_metrics)
        
        return summary
    
    def register_progress_callback(self, callback: Callable) -> None:
        """Register progress callback function"""
        self.progress_callbacks.append(callback)
    
    # BaseCallbackHandler interface implementation
    async def on_agent_start(self, agent_name: str, **kwargs) -> None:
        """Handle agent start event"""
        if not self.progress:
            return
        
        # Can infer current phase based on agent name
        if "search" in agent_name.lower():
            await self.start_phase(self.progress.current_iteration, ProgressPhase.SEARCHING, f"Executing {agent_name}")
        elif "analysis" in agent_name.lower():
            await self.start_phase(self.progress.current_iteration, ProgressPhase.ANALYZING, f"Executing {agent_name}")
    
    async def on_agent_end(self, agent_name: str, result: Any = None, **kwargs) -> None:
        """Handle agent completion event"""
        if not self.progress:
            return
        
        # Complete corresponding tasks based on agent type
        if "search" in agent_name.lower():
            await self.complete_task(self.progress.current_iteration, ProgressPhase.SEARCHING, agent_name)
        elif "analysis" in agent_name.lower():
            await self.complete_task(self.progress.current_iteration, ProgressPhase.ANALYZING, agent_name)
    
    async def on_task_start(self, task_name: str, **kwargs) -> None:
        """Handle task start event"""
        if not self.progress:
            return
        
        # Update current task description
        current_phase = self.progress.current_phase
        if self.progress.current_iteration in self.progress.iterations:
            iteration = self.progress.iterations[self.progress.current_iteration]
            if current_phase in iteration.phases:
                iteration.phases[current_phase].current_task = task_name
    
    async def on_task_end(self, task_name: str, result: Any = None, **kwargs) -> None:
        """Handle task completion event"""
        if not self.progress:
            return
        
        await self.complete_task(self.progress.current_iteration, self.progress.current_phase, task_name)
    
    async def on_error(self, error: Exception, **kwargs) -> None:
        """Handle error event"""
        if not self.progress:
            return
        
        # Mark current phase as failed
        if self.progress.current_iteration in self.progress.iterations:
            iteration = self.progress.iterations[self.progress.current_iteration]
            if self.progress.current_phase in iteration.phases:
                await self.complete_phase(self.progress.current_iteration, self.progress.current_phase, False, str(error))
    
    # Private methods
    async def _update_overall_progress(self) -> None:
        """Update overall progress"""
        if not self.progress:
            return
        
        # Calculate overall progress percentage
        total_progress = 0.0
        completed_iterations = 0
        
        for iteration in self.progress.iterations.values():
            if iteration.status == ProgressStatus.COMPLETED:
                total_progress += 100.0
                completed_iterations += 1
            elif iteration.status == ProgressStatus.IN_PROGRESS:
                # Calculate current iteration progress
                iteration_progress = 0.0
                phase_count = len(iteration.phases)
                
                for phase_progress in iteration.phases.values():
                    if phase_progress.status == ProgressStatus.COMPLETED:
                        iteration_progress += 100.0 / phase_count
                    elif phase_progress.status == ProgressStatus.IN_PROGRESS:
                        iteration_progress += phase_progress.progress_percentage / phase_count
                
                total_progress += iteration_progress
        
        if self.progress.total_iterations > 0:
            self.progress.overall_percentage = total_progress / self.progress.total_iterations
    
    async def _estimate_completion_time(self) -> None:
        """Estimate completion time"""
        if not self.progress or not self.performance_data["iteration_times"]:
            return
        
        avg_iteration_time = self._calculate_average(self.performance_data["iteration_times"])
        remaining_iterations = self.progress.total_iterations - self.progress.current_iteration
        
        if remaining_iterations > 0:
            estimated_seconds = avg_iteration_time * remaining_iterations
            self.progress.estimated_completion = datetime.now() + timedelta(seconds=estimated_seconds)
    
    async def _collect_performance_data(self, phase: ProgressPhase, metadata: Dict[str, Any]) -> None:
        """Collect performance data"""
        if "execution_time" in metadata:
            execution_time = metadata["execution_time"]
            
            if phase == ProgressPhase.SEARCHING:
                self.performance_data["search_times"].append(execution_time)
            elif phase == ProgressPhase.ANALYZING:
                self.performance_data["analysis_times"].append(execution_time)
    
    async def _calculate_final_metrics(self) -> None:
        """Calculate final metrics"""
        if not self.progress:
            return
        
        total_duration = self._calculate_total_duration()
        
        self.progress.performance_metrics = {
            "total_duration_seconds": total_duration,
            "average_iteration_time": self._calculate_average(self.performance_data["iteration_times"]),
            "search_efficiency": self._calculate_search_efficiency(),
            "analysis_efficiency": self._calculate_analysis_efficiency(),
            "overall_efficiency": self._calculate_efficiency_score(),
            "completion_rate": self._calculate_completion_rate()
        }
    
    def _calculate_total_duration(self) -> float:
        """Calculate total duration"""
        if not self.progress or not self.progress.end_time:
            return 0.0
        
        return (self.progress.end_time - self.progress.start_time).total_seconds()
    
    def _calculate_average(self, values: List[float]) -> float:
        """Calculate average"""
        return sum(values) / len(values) if values else 0.0
    
    def _calculate_search_efficiency(self) -> float:
        """Calculate search efficiency"""
        if not self.performance_data["search_times"] or not self.progress:
            return 0.0
        
        avg_search_time = self._calculate_average(self.performance_data["search_times"])
        results_per_second = self.progress.total_search_results / (avg_search_time * len(self.performance_data["search_times"]))
        
        return results_per_second
    
    def _calculate_analysis_efficiency(self) -> float:
        """Calculate analysis efficiency"""
        if not self.performance_data["analysis_times"] or not self.progress:
            return 0.0
        
        avg_analysis_time = self._calculate_average(self.performance_data["analysis_times"])
        gaps_per_second = self.progress.total_knowledge_gaps / (avg_analysis_time * len(self.performance_data["analysis_times"]))
        
        return gaps_per_second
    
    def _calculate_efficiency_score(self) -> float:
        """Calculate efficiency score"""
        if not self.progress:
            return 0.0
        
        # Simplified efficiency calculation
        total_duration = self._calculate_total_duration()
        if total_duration == 0:
            return 0.0
        
        results_per_minute = (self.progress.total_search_results + self.progress.total_knowledge_gaps) / (total_duration / 60)
        
        # Normalize to 0-100 score
        return min(results_per_minute * 10, 100.0)
    
    def _calculate_completion_rate(self) -> float:
        """Calculate completion rate"""
        if not self.progress:
            return 0.0
        
        completed_iterations = sum(1 for iteration in self.progress.iterations.values() 
                                 if iteration.status == ProgressStatus.COMPLETED)
        
        return (completed_iterations / self.progress.total_iterations) * 100 if self.progress.total_iterations > 0 else 0.0
    
    def _estimate_phase_tasks(self, phase: ProgressPhase) -> int:
        """Estimate number of phase tasks"""
        task_estimates = {
            ProgressPhase.PLANNING: 3,
            ProgressPhase.SEARCHING: 5,
            ProgressPhase.ANALYZING: 4,
            ProgressPhase.REFLECTING: 2,
            ProgressPhase.REPORTING: 3
        }
        
        return task_estimates.get(phase, 1)
    
    async def _notify_progress_update(self, update_type: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Notify progress update"""
        update_data = {
            "update_type": update_type,
            "timestamp": datetime.now().isoformat(),
            "current_progress": self.get_current_progress(),
            "data": data or {}
        }
        
        # Add to history
        self.progress_history.append(update_data)
        
        # Call registered callback functions
        for callback in self.progress_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(update_data)
                else:
                    callback(update_data)
            except Exception as e:
                print(f"Progress callback execution failed: {e}")
    
    # Helper mapping methods
    
    def _map_agent_to_phase(self, agent_name: str) -> Optional[ProgressPhase]:
        """Map agent to phase"""
        agent_phase_map = {
            "planner": ProgressPhase.PLANNING,
            "query_generator": ProgressPhase.SEARCHING,
            "research_summarizer": ProgressPhase.ANALYZING,
            "report_writer": ProgressPhase.REPORTING
        }
        
        for key, phase in agent_phase_map.items():
            if key in agent_name.lower():
                return phase
        
        return None
    
    def _map_task_to_phase(self, task_name: str) -> Optional[ProgressPhase]:
        """Map task to phase"""
        task_phase_map = {
            "search": ProgressPhase.SEARCHING,
            "analysis": ProgressPhase.ANALYZING,
            "citation": ProgressPhase.REPORTING,
            "report": ProgressPhase.REPORTING,
            "quality": ProgressPhase.REPORTING
        }
        
        for key, phase in task_phase_map.items():
            if key in task_name.lower():
                return phase
        
        return None