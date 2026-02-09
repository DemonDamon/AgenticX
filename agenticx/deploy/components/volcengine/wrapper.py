#!/usr/bin/env python3
"""
AgenticX Agent Wrapper for AgentKit Deployment

Wraps AgenticX Agent to be compatible with AgentKit SimpleApp protocol.

Author: Damon Li
"""

import json
import logging
from typing import Dict, Any, Optional, AsyncGenerator
from string import Template

logger = logging.getLogger(__name__)


class AgenticXAgentWrapper:
    """
    Wraps an AgenticX Agent for deployment to AgentKit platform.
    
    Adapts AgentKit's /invoke protocol (payload dict, headers dict -> str)
    to AgenticX's execution model (Agent + Task -> result).
    
    Key design principles:
    - Does NOT depend on agentkit-sdk-python (pure AgenticX implementation)
    - Constructs AgentExecutor and Task internally
    - Handles AgentKit headers (user_id, session_id)
    - Converts exceptions to AgentKit error format
    
    Example:
        >>> from agenticx.core import Agent
        >>> from agenticx.llms import LiteLLMProvider
        >>> 
        >>> agent = Agent(name="assistant", role="helper", goal="answer questions")
        >>> llm = LiteLLMProvider(model="gpt-3.5-turbo")
        >>> wrapper = AgenticXAgentWrapper(agent, llm)
        >>> 
        >>> result = wrapper.handle_invoke(
        ...     payload={"prompt": "Hello"},
        ...     headers={"user_id": "user1", "session_id": "sess1"}
        ... )
    """
    
    def __init__(self, agent, llm_provider=None):
        """Initialize the wrapper.

        Args:
            agent: AgenticX Agent instance.
            llm_provider: Optional BaseLLMProvider. If None, will try to use
                agent.llm, then auto-detect from environment variables.
        """
        self.agent = agent
        self.llm_provider = llm_provider or getattr(agent, 'llm', None)

        # Auto-detect from AgentKit environment as last resort
        if not self.llm_provider:
            import os
            if os.getenv("MODEL_AGENT_NAME"):
                try:
                    from agenticx.llms import ArkLLMProvider
                    self.llm_provider = ArkLLMProvider.from_agentkit_env()
                    logger.info("Auto-detected ArkLLMProvider from environment")
                except Exception as e:
                    logger.warning(f"Failed to auto-detect LLM provider: {e}")

        if not self.llm_provider:
            raise ValueError(
                "llm_provider must be provided, agent must have an llm attribute, "
                "or MODEL_AGENT_NAME environment variable must be set"
            )
        
        # Lazy import to avoid circular dependency
        from agenticx.core.agent_executor import AgentExecutor
        from agenticx.core.task import Task
        
        self.AgentExecutor = AgentExecutor
        self.Task = Task
        self.executor = None  # Created on first use
    
    def _get_executor(self):
        """Lazy initialization of executor."""
        if self.executor is None:
            self.executor = self.AgentExecutor(
                llm_provider=self.llm_provider,
                tools=[]  # Tools will be resolved from agent
            )
        return self.executor
    
    def handle_invoke(self, payload: Dict[str, Any], headers: Dict[str, str]) -> str:
        """
        Handle AgentKit /invoke request (sync version).
        
        Converts AgentKit protocol to AgenticX execution:
        - Extracts prompt from payload
        - Extracts user_id/session_id from headers
        - Creates Task with context
        - Executes via AgentExecutor
        - Returns string result or error JSON
        
        Args:
            payload: Request payload dict, must contain "prompt"
            headers: Request headers dict, may contain "user_id", "session_id"
            
        Returns:
            String result from agent execution or JSON error message
        """
        try:
            # Extract request data
            prompt = payload.get("prompt")
            if not prompt:
                return self._format_error("Missing 'prompt' field in payload", "BadRequest")
            
            user_id = headers.get("user_id", "anonymous")
            session_id = headers.get("session_id", "default")
            
            logger.info(
                f"Agent {self.agent.name} handling invoke: "
                f"prompt='{prompt[:50]}...', user_id={user_id}, session_id={session_id}"
            )
            
            # Create task with context
            task = self.Task(
                description=prompt,
                expected_output="Response to user query",
                context={
                    "user_id": user_id,
                    "session_id": session_id,
                    "headers": headers,
                }
            )
            
            # Execute
            executor = self._get_executor()
            result = executor.run(self.agent, task, session_key=session_id)
            
            # Extract output
            if isinstance(result, dict):
                output = result.get("result", str(result))
            else:
                output = str(result)
            
            logger.info(f"Agent {self.agent.name} execution completed")
            return output
            
        except Exception as e:
            logger.exception(f"Error in handle_invoke: {e}")
            return self._format_error(
                f"Agent execution failed: {str(e)}",
                type(e).__name__
            )
    
    async def handle_invoke_stream(
        self,
        payload: Dict[str, Any],
        headers: Dict[str, str],
    ) -> AsyncGenerator[str, None]:
        """Handle AgentKit /invoke request with streaming (async generator).

        Streams token-level output and intermediate steps from the agent
        execution pipeline. Falls back to single-event output when the
        executor does not support ``run_stream``.

        Args:
            payload: Request payload dict, must contain "prompt".
            headers: Request headers dict, may contain "user_id", "session_id".

        Yields:
            SSE-formatted string events.
        """
        try:
            prompt = payload.get("prompt")
            if not prompt:
                yield self._convert_to_sse({
                    "type": "error",
                    "content": "Missing 'prompt' field in payload",
                })
                return

            user_id = headers.get("user_id", "anonymous")
            session_id = headers.get("session_id", "default")

            task = self.Task(
                description=prompt,
                expected_output="Response to user query",
                context={
                    "user_id": user_id,
                    "session_id": session_id,
                    "headers": headers,
                },
            )

            executor = self._get_executor()

            # Use run_stream if available for real streaming
            if hasattr(executor, "run_stream"):
                async for event in executor.run_stream(
                    self.agent, task, session_key=session_id
                ):
                    yield self._convert_to_sse(event)
            else:
                # Fallback to sync execution wrapped as single SSE event
                result = self.handle_invoke(payload, headers)
                yield self._convert_to_sse({"content": result, "type": "final"})

        except Exception as e:
            logger.exception(f"Error in handle_invoke_stream: {e}")
            yield self._convert_to_sse({
                "type": "error",
                "content": str(e),
                "error_type": type(e).__name__,
            })
    
    def ping(self) -> str:
        """
        Health check endpoint.
        
        Returns:
            "pong!" string
        """
        return "pong!"
    
    def _format_error(self, message: str, error_type: str) -> str:
        """
        Format error in AgentKit standard format.
        
        Args:
            message: Error message
            error_type: Error type name
            
        Returns:
            JSON string with error structure
        """
        error_obj = {
            "error": {
                "message": message,
                "type": error_type
            }
        }
        return json.dumps(error_obj)
    
    def _convert_to_sse(self, obj: Any) -> str:
        """
        Convert object to SSE (Server-Sent Events) format.
        
        Args:
            obj: Object to convert (will be JSON serialized)
            
        Returns:
            SSE-formatted string: "data: {json}\\n\\n"
        """
        if isinstance(obj, str):
            json_str = obj
        else:
            json_str = json.dumps(obj)
        return f"data: {json_str}\n\n"
    
    def generate_wrapper_file(
        self,
        output_path: str,
        agent_module: str,
        agent_var: str,
        streaming: bool = False
    ) -> str:
        """
        Generate a standalone wrapper.py file for AgentKit deployment.
        
        This creates a Python file that:
        - Imports the user's Agent definition
        - Creates AgentkitSimpleApp instance
        - Registers entrypoint and ping handlers
        - Can be run as: python -m wrapper
        
        Args:
            output_path: Path to write wrapper.py
            agent_module: Python module path (e.g., "my_agent")
            agent_var: Variable name of the agent (e.g., "my_agent")
            streaming: Whether to enable streaming mode
            
        Returns:
            Path to generated file
        """
        if streaming:
            template_str = WRAPPER_TEMPLATE_STREAMING
        else:
            template_str = WRAPPER_TEMPLATE_BASIC
        
        template = Template(template_str)
        content = template.substitute(
            agent_module_name=agent_module,
            agent_var_name=agent_var,
            agent_file_name=f"{agent_module}.py"
        )
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        logger.info(f"Generated wrapper file: {output_path}")
        return output_path


# Wrapper templates (aligned with upstream wrapper_basic.py.jinja2 and wrapper_stream.py.jinja2)

WRAPPER_TEMPLATE_BASIC = """#!/usr/bin/env python3
'''
AgentKit Wrapper for AgenticX Agent

This file wraps your Agent definition ($agent_file_name) for AgentKit deployment.

Your Agent is imported from: $agent_module_name
Agent variable: $agent_var_name

Author: Damon Li
'''
import os
import logging

# Import user's Agent definition
from $agent_module_name import $agent_var_name

from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
from agentkit.apps import AgentkitSimpleApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Auto-detect Volcengine Ark model from AgentKit platform environment
_ark_llm = None
if os.getenv("MODEL_AGENT_NAME"):
    try:
        from agenticx.llms import ArkLLMProvider
        _ark_llm = ArkLLMProvider(
            endpoint_id=os.getenv("MODEL_AGENT_NAME"),
            api_key=os.getenv("MODEL_AGENT_API_KEY"),
        )
        # Inject into agent if it does not already have an LLM configured
        if not getattr($agent_var_name, 'llm', None):
            $agent_var_name.llm = _ark_llm
            logger.info("Auto-injected ArkLLMProvider from AgentKit environment")
    except Exception as e:
        logger.warning(f"Failed to auto-inject ArkLLMProvider: {e}")


app = AgentkitSimpleApp()

# Create wrapper for AgenticX Agent
wrapper = AgenticXAgentWrapper(agent=$agent_var_name, llm_provider=_ark_llm)


@app.entrypoint
def run(payload: dict, headers: dict) -> str:
    \"\"\"
    Main entrypoint for the Agent.
    
    Handles AgentKit request/response protocol and delegates to AgenticX Agent.
    \"\"\"
    return wrapper.handle_invoke(payload, headers)


@app.ping
def ping() -> str:
    \"\"\"Health check endpoint.\"\"\"
    return wrapper.ping()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
"""

WRAPPER_TEMPLATE_STREAMING = """#!/usr/bin/env python3
'''
AgentKit Streaming Wrapper for AgenticX Agent

This file wraps your Agent definition ($agent_file_name) for AgentKit deployment
with SSE streaming support.

Your Agent is imported from: $agent_module_name
Agent variable: $agent_var_name

Author: Damon Li
'''
import os
import logging

# Import user's Agent definition
from $agent_module_name import $agent_var_name

from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
from agentkit.apps import AgentkitSimpleApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Auto-detect Volcengine Ark model from AgentKit platform environment
_ark_llm = None
if os.getenv("MODEL_AGENT_NAME"):
    try:
        from agenticx.llms import ArkLLMProvider
        _ark_llm = ArkLLMProvider(
            endpoint_id=os.getenv("MODEL_AGENT_NAME"),
            api_key=os.getenv("MODEL_AGENT_API_KEY"),
        )
        # Inject into agent if it does not already have an LLM configured
        if not getattr($agent_var_name, 'llm', None):
            $agent_var_name.llm = _ark_llm
            logger.info("Auto-injected ArkLLMProvider from AgentKit environment")
    except Exception as e:
        logger.warning(f"Failed to auto-inject ArkLLMProvider: {e}")


app = AgentkitSimpleApp()

# Create wrapper for AgenticX Agent
wrapper = AgenticXAgentWrapper(agent=$agent_var_name, llm_provider=_ark_llm)


@app.entrypoint
async def run(payload: dict, headers: dict):
    \"\"\"
    Main entrypoint for the Agent with streaming support.
    
    Handles AgentKit request/response protocol with SSE streaming.
    \"\"\"
    async for event in wrapper.handle_invoke_stream(payload, headers):
        yield event


@app.ping
def ping() -> str:
    \"\"\"Health check endpoint.\"\"\"
    return wrapper.ping()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
"""
