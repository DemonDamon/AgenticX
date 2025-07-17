"""
M9 A2A Protocol Demo

This example demonstrates the Agent-to-Agent (A2A) protocol implementation
from the M9 module, showing how agents can discover and collaborate with
each other through standardized communication.

The demo creates two agents:
1. Calculator Agent - Provides mathematical operations
2. Coordinator Agent - Orchestrates tasks and uses the Calculator Agent

Run this demo to see:
- Agent service discovery via /.well-known/agent.json
- Task creation and execution through A2A protocol
- Remote skill invocation as local tools
"""

import os
import sys
import asyncio
import logging
from typing import Dict, Any

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# AgenticX imports
from agenticx.protocols import (
    A2AWebServiceWrapper, A2AClient, A2ASkillTool, A2ASkillToolFactory,
    InMemoryTaskStore, AgentCard, Skill
)
from agenticx.tools.base import BaseTool
from agenticx.tools.function_tool import FunctionTool
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.litellm_provider import LiteLLMProvider

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Filter out the CancelledError from uvicorn
class CancelledErrorFilter(logging.Filter):
    def filter(self, record):
        return not (record.levelname == 'ERROR' and 'CancelledError' in record.getMessage())

# Apply filter to uvicorn logger
uvicorn_logger = logging.getLogger('uvicorn.error')
uvicorn_logger.addFilter(CancelledErrorFilter())


class CalculatorTool(BaseTool):
    """A simple calculator tool for demonstration."""
    
    def __init__(self, operation: str):
        super().__init__(
            name=f"calculate_{operation}",
            description=f"Perform {operation} operation on two numbers"
        )
        self.operation = operation
    
    def _run(self, a: float, b: float) -> str:
        """Perform the calculation (synchronous implementation)."""
        if self.operation == "add":
            result = a + b
        elif self.operation == "subtract":
            result = a - b
        elif self.operation == "multiply":
            result = a * b
        elif self.operation == "divide":
            if b == 0:
                return "Error: Division by zero"
            result = a / b
        else:
            return f"Error: Unknown operation {self.operation}"
        
        return f"Result: {result}"


class CalculatorAgent:
    """Agent that provides mathematical calculation services."""
    
    def __init__(self, port: int = 8001):
        self.port = port
        self.agent_id = "calculator_agent"
        self.agent_name = "Calculator Agent"
        self.agent_description = "Provides mathematical calculation services"
        
        # Create LLM provider (not used in this demo but required by AgentExecutor)
        self.llm_provider = LiteLLMProvider(model="gpt-3.5-turbo")
        
        # Create tools
        self.tools = [
            CalculatorTool("add"),
            CalculatorTool("subtract"),
            CalculatorTool("multiply"),
            CalculatorTool("divide")
        ]
        
        # Create AgentExecutor
        self.agent_executor = AgentExecutor(
            llm_provider=self.llm_provider,
            tools=self.tools
        )
        
        # Create task store
        self.task_store = InMemoryTaskStore()
        
        # Create A2A web service
        self.web_service = A2AWebServiceWrapper(
            agent_executor=self.agent_executor,
            task_store=self.task_store,
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            agent_description=self.agent_description,
            base_url=f"http://localhost:{port}"
        )
    
    async def start(self):
        """Start the calculator agent service."""
        logger.info(f"Starting Calculator Agent on port {self.port}")
        await self.web_service.start_server(port=self.port)
    
    async def stop(self):
        """Stop the calculator agent service."""
        logger.info("Stopping Calculator Agent...")
        # Add any cleanup logic here if needed


class CoordinatorAgent:
    """Agent that coordinates tasks and uses other agents."""
    
    def __init__(self, calculator_endpoint: str = "http://localhost:8001"):
        self.agent_id = "coordinator_agent"
        self.calculator_endpoint = calculator_endpoint
        self.remote_tools = {}
    
    async def discover_calculator_agent(self):
        """Discover and connect to the calculator agent."""
        logger.info(f"Discovering calculator agent at {self.calculator_endpoint}")
        
        try:
            # Create A2A client
            client = await A2AClient.from_endpoint(self.calculator_endpoint)
            
            # Get agent card
            agent_card = client.target_agent_card
            logger.info(f"Discovered agent: {agent_card.name}")
            logger.info(f"Available skills: {[skill.name for skill in agent_card.skills]}")
            
            # Create tools for each skill
            for skill in agent_card.skills:
                tool = A2ASkillTool(
                    client=client,
                    skill=skill,
                    issuer_agent_id=self.agent_id
                )
                self.remote_tools[tool.name] = tool
                logger.info(f"Created remote tool: {tool.name}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to discover calculator agent: {e}")
            return False
    
    async def perform_calculations(self):
        """Perform a series of calculations using the remote calculator agent."""
        logger.info("Starting calculation tasks...")
        
        # Test addition
        try:
            add_tool = self.remote_tools["Calculator Agent/calculate_add"]
            result = await add_tool.arun(a=10, b=5)
            logger.info(f"Addition result: {result}")
        except Exception as e:
            logger.error(f"Addition failed: {e}")
        
        # Test subtraction
        try:
            subtract_tool = self.remote_tools["Calculator Agent/calculate_subtract"]
            result = await subtract_tool.arun(a=10, b=3)
            logger.info(f"Subtraction result: {result}")
        except Exception as e:
            logger.error(f"Subtraction failed: {e}")
        
        # Test multiplication
        try:
            multiply_tool = self.remote_tools["Calculator Agent/calculate_multiply"]
            result = await multiply_tool.arun(a=4, b=7)
            logger.info(f"Multiplication result: {result}")
        except Exception as e:
            logger.error(f"Multiplication failed: {e}")
        
        # Test division
        try:
            divide_tool = self.remote_tools["Calculator Agent/calculate_divide"]
            result = await divide_tool.arun(a=20, b=4)
            logger.info(f"Division result: {result}")
        except Exception as e:
            logger.error(f"Division failed: {e}")
        
        # Test division by zero
        try:
            divide_tool = self.remote_tools["Calculator Agent/calculate_divide"]
            result = await divide_tool.arun(a=10, b=0)
            logger.info(f"Division by zero result: {result}")
        except Exception as e:
            logger.error(f"Division by zero failed: {e}")
    
    async def cleanup(self):
        """Clean up resources."""
        logger.info("Cleaning up coordinator agent...")
        for tool in self.remote_tools.values():
            await tool.close()


async def run_demo():
    """Run the complete A2A protocol demo."""
    logger.info("=== M9 A2A Protocol Demo ===")
    
    # Create calculator agent
    calculator_agent = CalculatorAgent()
    
    # Start calculator agent in background
    calculator_task = asyncio.create_task(calculator_agent.start())
    
    # Wait a bit for the service to start
    await asyncio.sleep(2)
    
    # Create coordinator agent
    coordinator_agent = CoordinatorAgent()
    
    try:
        # Discover calculator agent
        if await coordinator_agent.discover_calculator_agent():
            # Perform calculations
            await coordinator_agent.perform_calculations()
        else:
            logger.error("Failed to discover calculator agent")
    
    except Exception as e:
        logger.error(f"Demo failed: {e}")
    
    finally:
        # Cleanup
        await coordinator_agent.cleanup()
        
        # More graceful shutdown of calculator agent
        if not calculator_task.done():
            calculator_task.cancel()
            try:
                await calculator_task
            except asyncio.CancelledError:
                logger.info("Calculator agent stopped")
            except Exception as e:
                logger.warning(f"Error stopping calculator agent: {e}")
    
    logger.info("=== Demo Complete ===")


def main():
    """Main entry point."""
    try:
        asyncio.run(run_demo())
    except KeyboardInterrupt:
        logger.info("Demo interrupted by user")
    except Exception as e:
        logger.error(f"Demo failed: {e}")


if __name__ == "__main__":
    main() 