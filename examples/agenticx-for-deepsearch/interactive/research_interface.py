"""Interactive Research Interface based on AgenticX

This module implements InteractiveResearchInterface, based on agenticx.observability
to provide real-time interaction and monitoring capabilities, strictly following 
the observability design of the AgenticX framework.
"""

from typing import Dict, List, Any, Optional, Callable, AsyncGenerator
from datetime import datetime
import asyncio
import json
from dataclasses import dataclass, asdict
from enum import Enum
from agenticx.observability import BaseCallbackHandler, CallbackManager
from agenticx.core.workflow import Workflow
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from models import ResearchContext, ResearchIteration, SearchResult, KnowledgeGap
from workflows.deep_search_workflow import DeepSearchWorkflow


class InterfaceEvent(Enum):
    """Interface event types"""
    RESEARCH_STARTED = "research_started"
    ITERATION_STARTED = "iteration_started"
    ITERATION_COMPLETED = "iteration_completed"
    SEARCH_COMPLETED = "search_completed"
    ANALYSIS_COMPLETED = "analysis_completed"
    REPORT_GENERATED = "report_generated"
    ERROR_OCCURRED = "error_occurred"
    USER_INPUT_RECEIVED = "user_input_received"
    PROGRESS_UPDATED = "progress_updated"


@dataclass
class UserInteraction:
    """User interaction data"""
    interaction_id: str
    timestamp: datetime
    interaction_type: str
    content: Dict[str, Any]
    response: Optional[Dict[str, Any]] = None
    status: str = "pending"


@dataclass
class ResearchProgress:
    """Research progress data"""
    current_iteration: int
    total_iterations: int
    completed_searches: int
    total_searches: int
    current_phase: str
    progress_percentage: float
    estimated_completion: Optional[datetime] = None
    last_update: datetime = None


class InteractiveResearchInterface(BaseCallbackHandler):
    """Interactive Research Interface
    
    Based on agenticx.observability.BaseCallbackHandler implementation, provides:
    1. Real-time research progress monitoring
    2. User interaction handling
    3. Dynamic parameter adjustment
    4. Real-time result display
    """
    
    def __init__(self, workflow: Optional[DeepSearchWorkflow] = None, **kwargs):
        super().__init__(**kwargs)
        self.workflow = workflow
        self.research_context: Optional[ResearchContext] = None
        self.user_interactions: List[UserInteraction] = []
        self.progress: Optional[ResearchProgress] = None
        self.event_handlers: Dict[str, List[Callable]] = {}
        self.is_active = False
        self.real_time_updates = True
        
        # Register default event handlers
        self._register_default_handlers()
    
    async def start_research_session(self, research_topic: str, 
                                   research_objective: str = "",
                                   config: Optional[Dict[str, Any]] = None) -> str:
        """Start research session"""
        session_id = f"research_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Initialize research context
        self.research_context = ResearchContext(
            research_topic=research_topic,
            research_objective=research_objective or f"Deep research on {research_topic} related content",
            start_time=datetime.now()
        )
        
        # Initialize progress tracking
        self.progress = ResearchProgress(
            current_iteration=0,
            total_iterations=config.get("max_iterations", 3) if config else 3,
            completed_searches=0,
            total_searches=0,
            current_phase="Initialization",
            progress_percentage=0.0,
            last_update=datetime.now()
        )
        
        self.is_active = True
        
        # Send research start event
        await self._emit_event(InterfaceEvent.RESEARCH_STARTED, {
            "session_id": session_id,
            "research_topic": research_topic,
            "research_objective": research_objective,
            "config": config or {}
        })
        
        return session_id
    
    async def handle_user_input(self, input_type: str, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle user input"""
        interaction = UserInteraction(
            interaction_id=f"input_{len(self.user_interactions) + 1}",
            timestamp=datetime.now(),
            interaction_type=input_type,
            content=content
        )
        
        self.user_interactions.append(interaction)
        
        # Send user input event
        await self._emit_event(InterfaceEvent.USER_INPUT_RECEIVED, {
            "interaction": asdict(interaction)
        })
        
        # Handle different types of user input
        if input_type == "adjust_parameters":
            response = await self._handle_parameter_adjustment(content)
        elif input_type == "add_search_query":
            response = await self._handle_additional_query(content)
        elif input_type == "request_analysis":
            response = await self._handle_analysis_request(content)
        elif input_type == "stop_research":
            response = await self._handle_stop_request(content)
        elif input_type == "export_results":
            response = await self._handle_export_request(content)
        else:
            response = {"status": "error", "message": f"Unsupported input type: {input_type}"}
        
        # Update interaction record
        interaction.response = response
        interaction.status = "completed"
        
        return response
    
    async def get_real_time_updates(self) -> AsyncGenerator[Dict[str, Any], None]:
        """Get real-time update stream"""
        while self.is_active:
            if self.real_time_updates:
                # Generate current status update
                update = {
                    "timestamp": datetime.now().isoformat(),
                    "progress": asdict(self.progress) if self.progress else None,
                    "current_context": self._get_context_summary(),
                    "recent_results": self._get_recent_results(),
                    "active_phase": self.progress.current_phase if self.progress else "Unknown"
                }
                
                yield update
            
            await asyncio.sleep(1)  # Update every second
    
    async def get_research_summary(self) -> Dict[str, Any]:
        """Get research summary"""
        if not self.research_context:
            return {"error": "No active research session"}
        
        summary = {
            "research_topic": self.research_context.research_topic,
            "research_objective": self.research_context.research_objective,
            "start_time": self.research_context.start_time.isoformat(),
            "duration": self._calculate_duration(),
            "progress": asdict(self.progress) if self.progress else None,
            "iterations_completed": len(self.research_context.iterations),
            "total_search_results": len(self.research_context.get_all_search_results()),
            "knowledge_gaps_identified": len(self.research_context.get_all_knowledge_gaps()),
            "user_interactions": len(self.user_interactions),
            "current_status": "In Progress" if self.is_active else "Completed"
        }
        
        return summary
    
    async def export_session_data(self, format_type: str = "json") -> Dict[str, Any]:
        """Export session data"""
        if not self.research_context:
            return {"error": "No active research session"}
        
        session_data = {
            "session_info": await self.get_research_summary(),
            "research_context": self.research_context.to_dict(),
            "user_interactions": [asdict(interaction) for interaction in self.user_interactions],
            "progress_history": self._get_progress_history(),
            "export_timestamp": datetime.now().isoformat(),
            "export_format": format_type
        }
        
        if format_type == "json":
            return session_data
        elif format_type == "summary":
            return self._generate_session_summary(session_data)
        else:
            return {"error": f"Unsupported export format: {format_type}"}
    
    # BaseCallbackHandler interface implementation
    async def on_agent_start(self, agent_name: str, **kwargs) -> None:
        """Handle agent start event"""
        if not self.is_active:
            return
        
        if self.progress:
            self.progress.current_phase = f"Executing {agent_name}"
            self.progress.last_update = datetime.now()
    
    async def on_agent_end(self, agent_name: str, result: Any = None, **kwargs) -> None:
        """Handle agent completion event"""
        if not self.is_active:
            return
        
        # Check if it's a search completion
        if "search" in agent_name.lower():
            await self._emit_event(InterfaceEvent.SEARCH_COMPLETED, {
                "agent_name": agent_name,
                "results": result or []
            })
        elif "analysis" in agent_name.lower():
            await self._emit_event(InterfaceEvent.ANALYSIS_COMPLETED, {
                "agent_name": agent_name,
                "analysis": result or {}
            })
    
    async def on_task_start(self, task_name: str, **kwargs) -> None:
        """Handle task start event"""
        if not self.is_active:
            return
        
        if self.progress:
            self.progress.current_phase = f"Executing {task_name}"
            self.progress.last_update = datetime.now()
    
    async def on_task_end(self, task_name: str, result: Any = None, **kwargs) -> None:
        """Handle task completion event"""
        if not self.is_active:
            return
        
        # Update completed task count
        if self.progress:
            self.progress.completed_searches += 1
            self._update_progress_percentage()
    
    async def on_error(self, error: Exception, **kwargs) -> None:
        """Handle error event"""
        await self._emit_event(InterfaceEvent.ERROR_OCCURRED, {
            "error_message": str(error),
            "timestamp": datetime.now().isoformat()
        })
    
    # Workflow control methods
    async def start_research(self, workflow_id: str = None) -> None:
        """Start research"""
        if self.progress:
            self.progress.current_phase = "Workflow Execution"
            self.progress.last_update = datetime.now()
        
        await self._emit_event(InterfaceEvent.RESEARCH_STARTED, {
            "workflow_id": workflow_id or "default",
            "start_time": datetime.now().isoformat()
        })
    
    async def complete_research(self, workflow_id: str = None, results: Any = None) -> None:
        """Complete research"""
        if self.progress:
            self.progress.current_phase = "Completed"
            self.progress.progress_percentage = 100.0
            self.progress.last_update = datetime.now()
        
        self.is_active = False
        
        await self._emit_event(InterfaceEvent.REPORT_GENERATED, {
            "workflow_id": workflow_id or "default",
            "completion_time": datetime.now().isoformat(),
            "final_results": results
        })
    
    # User input handling methods
    async def _handle_parameter_adjustment(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle parameter adjustment"""
        try:
            parameters = content.get("parameters", {})
            
            # Update workflow parameters
            if self.workflow:
                for key, value in parameters.items():
                    if hasattr(self.workflow, key):
                        setattr(self.workflow, key, value)
            
            return {
                "status": "success",
                "message": "Parameters updated",
                "updated_parameters": parameters
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Parameter update failed: {str(e)}"
            }
    
    async def _handle_additional_query(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle additional query request"""
        try:
            query = content.get("query", "")
            
            if not query:
                return {
                    "status": "error",
                    "message": "Query content cannot be empty"
                }
            
            # Here you can trigger additional searches
            # Actual implementation needs to integrate with workflow
            
            return {
                "status": "success",
                "message": "Additional query added",
                "query": query
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Query addition failed: {str(e)}"
            }
    
    async def _handle_analysis_request(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle analysis request"""
        try:
            analysis_type = content.get("analysis_type", "summary")
            
            if analysis_type == "summary":
                result = await self.get_research_summary()
            elif analysis_type == "progress":
                result = asdict(self.progress) if self.progress else {}
            elif analysis_type == "results":
                result = self._get_recent_results()
            else:
                return {
                    "status": "error",
                    "message": f"Unsupported analysis type: {analysis_type}"
                }
            
            return {
                "status": "success",
                "analysis_type": analysis_type,
                "result": result
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Analysis request failed: {str(e)}"
            }
    
    async def _handle_stop_request(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle stop request"""
        try:
            reason = content.get("reason", "User request")
            
            self.is_active = False
            
            if self.progress:
                self.progress.current_phase = "Stopped"
                self.progress.last_update = datetime.now()
            
            return {
                "status": "success",
                "message": "Research stopped",
                "reason": reason,
                "stop_time": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Stop request failed: {str(e)}"
            }
    
    async def _handle_export_request(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """Handle export request"""
        try:
            format_type = content.get("format", "json")
            
            export_data = await self.export_session_data(format_type)
            
            return {
                "status": "success",
                "message": "Data export successful",
                "format": format_type,
                "data": export_data
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Export failed: {str(e)}"
            }
    
    # Helper methods
    async def _emit_event(self, event_type: InterfaceEvent, data: Dict[str, Any]) -> None:
        """Emit interface event"""
        # Call registered event handlers
        handlers = self.event_handlers.get(event_type.value, [])
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event_type, data)
                else:
                    handler(event_type, data)
            except Exception as e:
                print(f"Event handler execution failed: {e}")
    
    def register_event_handler(self, event_type: InterfaceEvent, 
                             handler: Callable) -> None:
        """Register event handler"""
        if event_type.value not in self.event_handlers:
            self.event_handlers[event_type.value] = []
        self.event_handlers[event_type.value].append(handler)
    
    def _register_default_handlers(self) -> None:
        """Register default event handlers"""
        # Here you can register some default event handling logic
        pass
    
    async def update_progress(self, phase: str = None) -> None:
        """Update progress"""
        if not self.progress:
            return
        
        if phase:
            self.progress.current_phase = phase
        
        self.progress.last_update = datetime.now()
        self._update_progress_percentage()
        
        # Send progress update event
        await self._emit_event(InterfaceEvent.PROGRESS_UPDATED, {
            "progress": asdict(self.progress)
        })
    
    def _update_progress_percentage(self) -> None:
        """Update progress percentage"""
        if not self.progress:
            return
        
        # Simplified progress calculation
        iteration_progress = (self.progress.current_iteration / self.progress.total_iterations) * 80
        search_progress = (self.progress.completed_searches / max(self.progress.total_searches, 1)) * 20
        
        self.progress.progress_percentage = min(iteration_progress + search_progress, 100.0)
    
    def _get_context_summary(self) -> Dict[str, Any]:
        """Get context summary"""
        if not self.research_context:
            return {}
        
        return {
            "research_topic": self.research_context.research_topic,
            "iterations_count": len(self.research_context.iterations),
            "total_results": len(self.research_context.get_all_search_results()),
            "knowledge_gaps": len(self.research_context.get_all_knowledge_gaps())
        }
    
    def _get_recent_results(self, limit: int = 5) -> List[Dict[str, Any]]:
        """Get recent results"""
        if not self.research_context:
            return []
        
        all_results = self.research_context.get_all_search_results()
        recent_results = sorted(all_results, key=lambda x: x.timestamp, reverse=True)[:limit]
        
        return [{
            "title": result.title,
            "url": result.url,
            "snippet": result.snippet[:200] + "..." if len(result.snippet) > 200 else result.snippet,
            "source": result.source.value,
            "timestamp": result.timestamp.isoformat()
        } for result in recent_results]
    
    def _calculate_duration(self) -> str:
        """Calculate research duration"""
        if not self.research_context:
            return "0 minutes"
        
        start_time = self.research_context.start_time
        end_time = self.research_context.end_time or datetime.now()
        duration = end_time - start_time
        
        hours = duration.seconds // 3600
        minutes = (duration.seconds % 3600) // 60
        
        if hours > 0:
            return f"{hours} hours {minutes} minutes"
        else:
            return f"{minutes} minutes"
    
    def _get_progress_history(self) -> List[Dict[str, Any]]:
        """Get progress history"""
        # Here you can implement progress history recording
        # Simplified implementation, return current progress
        if self.progress:
            return [asdict(self.progress)]
        return []
    
    def _generate_session_summary(self, session_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate session summary"""
        session_info = session_data.get("session_info", {})
        
        summary = {
            "Research Topic": session_info.get("research_topic", "Unknown"),
            "Research Duration": session_info.get("duration", "Unknown"),
            "Completed Iterations": session_info.get("iterations_completed", 0),
            "Search Results Count": session_info.get("total_search_results", 0),
            "Identified Knowledge Gaps": session_info.get("knowledge_gaps_identified", 0),
            "User Interactions Count": session_info.get("user_interactions", 0),
            "Current Status": session_info.get("current_status", "Unknown")
        }
        
        return summary