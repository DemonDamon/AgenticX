from typing import Dict, List, Optional, Any, Callable
from abc import ABC, abstractmethod
from .event import EventLog, AnyEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent, HumanRequestEvent, HumanResponseEvent
from .agent import Agent
from .task import Task


class ContextRenderer(ABC):
    """
    Abstract base class for context renderers.
    Different renderers can implement different formatting strategies.
    """
    
    @abstractmethod
    def render(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Render the event log into a context string.
        
        Args:
            event_log: The event log to render
            agent: The agent context
            task: The task context
            
        Returns:
            A formatted context string
        """
        pass


class XMLContextRenderer(ContextRenderer):
    """
    Context renderer that uses XML-like tags for high information density.
    This implements the "Own Your Context Window" principle from 12-Factor Agents.
    """
    
    def render(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Render context using XML-like structured format for maximum information density.
        """
        context_parts = []
        
        # Add agent context
        context_parts.append(f"<agent_context>")
        context_parts.append(f"  <agent_id>{agent.id}</agent_id>")
        context_parts.append(f"  <agent_name>{agent.name}</agent_name>")
        context_parts.append(f"  <role>{agent.role}</role>")
        context_parts.append(f"  <goal>{agent.goal}</goal>")
        if agent.backstory:
            context_parts.append(f"  <backstory>{agent.backstory}</backstory>")
        context_parts.append(f"</agent_context>")
        
        # Add task context
        context_parts.append(f"<task_context>")
        context_parts.append(f"  <task_id>{task.id}</task_id>")
        context_parts.append(f"  <description>{task.description}</description>")
        context_parts.append(f"  <expected_output>{task.expected_output}</expected_output>")
        if task.context:
            context_parts.append(f"  <additional_context>{task.context}</additional_context>")
        context_parts.append(f"</task_context>")
        
        # Add execution history
        if event_log.events:
            context_parts.append(f"<execution_history>")
            for event in event_log.events:
                context_parts.append(self._render_event(event))
            context_parts.append(f"</execution_history>")
        
        # Add current state
        current_state = event_log.get_current_state()
        context_parts.append(f"<current_state>")
        context_parts.append(f"  <status>{current_state['status']}</status>")
        context_parts.append(f"  <step_count>{current_state['step_count']}</step_count>")
        context_parts.append(f"</current_state>")
        
        return "\n".join(context_parts)
    
    def _render_event(self, event: AnyEvent) -> str:
        """Render a single event in XML format."""
        if isinstance(event, ToolCallEvent):
            return f"  <tool_call intent='{event.intent}' tool='{event.tool_name}' args='{event.tool_args}' />"
        elif isinstance(event, ToolResultEvent):
            status = "success" if event.success else "error"
            result = event.result if event.success else event.error
            return f"  <tool_result tool='{event.tool_name}' status='{status}' result='{result}' />"
        elif isinstance(event, ErrorEvent):
            return f"  <error type='{event.error_type}' recoverable='{event.recoverable}'>{event.error_message}</error>"
        elif isinstance(event, HumanRequestEvent):
            return f"  <human_request urgency='{event.urgency}'>{event.question}</human_request>"
        elif isinstance(event, HumanResponseEvent):
            return f"  <human_response>{event.response}</human_response>"
        else:
            # Generic event rendering
            return f"  <event type='{event.type}' data='{event.data}' />"


class PromptTemplate:
    """
    A template for generating prompts with placeholders.
    """
    
    def __init__(self, template: str, name: str = "default"):
        self.template = template
        self.name = name
    
    def format(self, **kwargs) -> str:
        """Format the template with provided variables."""
        return self.template.format(**kwargs)


class PromptManager:
    """
    Core component for context engineering and prompt management.
    Implements the "Own Your Prompts" and "Own Your Context Window" principles.
    """
    
    def __init__(self, context_renderer: Optional[ContextRenderer] = None):
        self.context_renderer = context_renderer or XMLContextRenderer()
        self.prompt_templates: Dict[str, PromptTemplate] = {}
        self._register_default_templates()
    
    def _register_default_templates(self):
        """Register default prompt templates."""
        
        # Default ReAct-style template
        react_template = """You are {agent_name}, a {role}.

Your goal: {goal}

{context}

You must respond with a JSON object containing your next action. Choose from these options:
1. Call a tool: {{"action": "tool_call", "tool": "tool_name", "args": {{}}, "reasoning": "why you chose this tool"}}
2. Request human help: {{"action": "human_request", "question": "what you need help with", "context": "additional context", "urgency": "low|medium|high"}}
3. Finish the task: {{"action": "finish_task", "result": "your final result", "reasoning": "why the task is complete"}}

Think step by step and choose the most appropriate action based on the current situation."""
        
        self.register_template("react", react_template)
        
        # Error recovery template
        error_recovery_template = """You are {agent_name}, a {role}.

Your goal: {goal}

{context}

IMPORTANT: Your last action resulted in an error. You need to analyze the error and decide how to recover.

Error details: {error_message}

You must respond with a JSON object containing your recovery action:
1. Try a different approach: {{"action": "tool_call", "tool": "tool_name", "args": {{}}, "reasoning": "how this approach differs from the failed one"}}
2. Request human help: {{"action": "human_request", "question": "what you need help with", "context": "include the error details", "urgency": "medium|high"}}
3. Finish with partial result: {{"action": "finish_task", "result": "best result you can provide", "reasoning": "why you cannot complete fully"}}

Analyze the error carefully and choose the best recovery strategy."""
        
        self.register_template("error_recovery", error_recovery_template)
    
    def register_template(self, name: str, template: str):
        """Register a new prompt template."""
        self.prompt_templates[name] = PromptTemplate(template, name)
    
    def get_template(self, name: str) -> Optional[PromptTemplate]:
        """Get a prompt template by name."""
        return self.prompt_templates.get(name)
    
    def build_context(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Build high-density context from event log.
        This is the core of context engineering.
        """
        return self.context_renderer.render(event_log, agent, task)
    
    def build_prompt(
        self, 
        template_name: str, 
        event_log: EventLog, 
        agent: Agent, 
        task: Task,
        **extra_vars
    ) -> str:
        """
        Build a complete prompt using a template and context.
        
        Args:
            template_name: Name of the template to use
            event_log: Event log for context
            agent: Agent context
            task: Task context
            **extra_vars: Additional variables for the template
            
        Returns:
            Complete formatted prompt
        """
        template = self.get_template(template_name)
        if not template:
            raise ValueError(f"Template '{template_name}' not found")
        
        # Build context
        context = self.build_context(event_log, agent, task)
        
        # Prepare template variables
        template_vars = {
            "agent_name": agent.name,
            "role": agent.role,
            "goal": agent.goal,
            "context": context,
            **extra_vars
        }
        
        return template.format(**template_vars)
    
    def build_error_recovery_prompt(
        self,
        event_log: EventLog,
        agent: Agent,
        task: Task,
        error_message: str
    ) -> str:
        """
        Build a specialized prompt for error recovery.
        """
        return self.build_prompt(
            "error_recovery",
            event_log,
            agent,
            task,
            error_message=error_message
        )
    
    def set_context_renderer(self, renderer: ContextRenderer):
        """Set a custom context renderer."""
        self.context_renderer = renderer 