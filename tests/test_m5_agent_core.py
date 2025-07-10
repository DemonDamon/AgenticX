"""
AgenticX M5 Agent Core Module Tests

测试 M5 智能体核心模块的所有组件：
- 事件系统 (Event System)
- 提示管理 (Prompt Management) 
- 错误处理 (Error Handling)
- 通信接口 (Communication Interface)
- 智能体执行器 (Agent Executor)
"""

import pytest
import asyncio
import json
import sys
import os
from unittest.mock import Mock, patch

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    # Core abstractions
    Agent, Task, BaseTool, FunctionTool, tool,
    # M5 Components
    Event, EventLog, AnyEvent, TaskStartEvent, TaskEndEvent, 
    ToolCallEvent, ToolResultEvent, ErrorEvent, LLMCallEvent, 
    LLMResponseEvent, HumanRequestEvent, HumanResponseEvent, FinishTaskEvent,
    PromptManager, ContextRenderer, XMLContextRenderer, PromptTemplate,
    ErrorHandler, ErrorClassifier, CircuitBreaker, CircuitBreakerOpenError,
    CommunicationInterface, BroadcastCommunication, AsyncCommunicationInterface,
    AgentExecutor, ToolRegistry, ActionParser
)
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, TokenUsage


class MockLLMProvider(BaseLLMProvider):
    """Mock LLM provider for testing."""
    
    def __init__(self, responses=None):
        super().__init__(model="mock-model")
        # Use object.__setattr__ to bypass Pydantic validation
        object.__setattr__(self, 'responses', responses or [])
        object.__setattr__(self, 'call_count', 0)
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        if self.call_count < len(self.responses):
            content = self.responses[self.call_count]
        else:
            content = '{"action": "finish_task", "result": "mock result", "reasoning": "mock reasoning"}'
        
        # Use object.__setattr__ to bypass Pydantic validation
        object.__setattr__(self, 'call_count', self.call_count + 1)
        
        return LLMResponse(
            id=f"mock-response-{self.call_count}",
            model_name=self.model,
            created=1234567890,
            content=content,
            choices=[],
            token_usage=TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
            cost=0.001
        )
    
    async def ainvoke(self, prompt: str, **kwargs) -> LLMResponse:
        return self.invoke(prompt, **kwargs)
    
    def stream(self, prompt: str, **kwargs):
        response = self.invoke(prompt, **kwargs)
        yield response.content
    
    async def astream(self, prompt: str, **kwargs):
        response = await self.ainvoke(prompt, **kwargs)
        yield response.content


class TestEventSystem:
    """测试事件系统"""
    
    def test_event_creation(self):
        """测试基本事件创建"""
        event = Event(type="test_event", data={"key": "value"})
        
        assert event.type == "test_event"
        assert event.data["key"] == "value"
        assert event.agent_id is None
        assert event.task_id is None
        assert len(event.id) > 0
        assert event.timestamp is not None
    
    def test_specific_event_types(self):
        """测试特定事件类型"""
        # Task start event
        start_event = TaskStartEvent(
            task_description="Test task",
            agent_id="agent_1",
            task_id="task_1"
        )
        assert start_event.type == "task_start"
        assert start_event.task_description == "Test task"
        
        # Tool call event
        tool_event = ToolCallEvent(
            tool_name="test_tool",
            tool_args={"param": "value"},
            intent="testing",
            agent_id="agent_1"
        )
        assert tool_event.type == "tool_call"
        assert tool_event.tool_name == "test_tool"
        assert tool_event.intent == "testing"
        
        # Error event
        error_event = ErrorEvent(
            error_type="test_error",
            error_message="Something went wrong",
            recoverable=True
        )
        assert error_event.type == "error"
        assert error_event.recoverable is True
    
    def test_event_log(self):
        """测试事件日志功能"""
        event_log = EventLog(agent_id="agent_1", task_id="task_1")
        
        # Add events
        start_event = TaskStartEvent(task_description="Test", agent_id="agent_1", task_id="task_1")
        tool_event = ToolCallEvent(tool_name="test", tool_args={}, intent="test", agent_id="agent_1")
        
        event_log.append(start_event)
        event_log.append(tool_event)
        
        assert len(event_log.events) == 2
        assert event_log.get_last_event() == tool_event
        
        # Test state derivation
        state = event_log.get_current_state()
        assert state["status"] == "executing_tool"
        assert state["step_count"] == 2
        
        # Test event filtering
        tool_events = event_log.get_events_by_type("tool_call")
        assert len(tool_events) == 1
        assert tool_events[0] == tool_event
    
    def test_event_log_state_transitions(self):
        """测试事件日志状态转换"""
        event_log = EventLog()
        
        # Initial state
        assert event_log.get_current_state()["status"] == "initialized"
        assert event_log.can_continue() is False
        assert event_log.is_complete() is False
        
        # Add start event
        start_event = TaskStartEvent(task_description="Test")
        event_log.append(start_event)
        assert event_log.get_current_state()["status"] == "running"
        assert event_log.can_continue() is True
        
        # Add human request
        human_event = HumanRequestEvent(question="Need help?")
        event_log.append(human_event)
        assert event_log.get_current_state()["status"] == "waiting_for_human"
        assert event_log.needs_human_input() is True
        assert event_log.can_continue() is False
        
        # Add finish event
        finish_event = FinishTaskEvent(final_result="Done")
        event_log.append(finish_event)
        assert event_log.get_current_state()["status"] == "completed"
        assert event_log.is_complete() is True


class TestPromptManagement:
    """测试提示管理系统"""
    
    def test_xml_context_renderer(self):
        """测试XML上下文渲染器"""
        renderer = XMLContextRenderer()
        
        # Create test data
        agent = Agent(name="test_agent", role="tester", goal="test", organization_id="org")
        task = Task(description="Test task", expected_output="Result")
        event_log = EventLog()
        
        # Add some events
        tool_event = ToolCallEvent(tool_name="test_tool", tool_args={"x": 1}, intent="testing")
        result_event = ToolResultEvent(tool_name="test_tool", success=True, result="success")
        event_log.append(tool_event)
        event_log.append(result_event)
        
        # Render context
        context = renderer.render(event_log, agent, task)
        
        assert "<agent_context>" in context
        assert "<agent_name>test_agent</agent_name>" in context
        assert "<role>tester</role>" in context
        assert "<task_context>" in context
        assert "<description>Test task</description>" in context
        assert "<execution_history>" in context
        assert "tool_call" in context
        assert "tool_result" in context
        assert "<current_state>" in context
    
    def test_prompt_manager(self):
        """测试提示管理器"""
        manager = PromptManager()
        
        # Test template registration
        custom_template = "Hello {agent_name}, your goal is {goal}. Context: {context}"
        manager.register_template("custom", custom_template)
        
        template = manager.get_template("custom")
        assert template is not None
        assert template.name == "custom"
        
        # Test prompt building
        agent = Agent(name="test_agent", role="tester", goal="test things", organization_id="org")
        task = Task(description="Test task", expected_output="Result")
        event_log = EventLog()
        
        prompt = manager.build_prompt("react", event_log, agent, task)
        
        assert "test_agent" in prompt
        assert "tester" in prompt
        assert "test things" in prompt
        assert "JSON object" in prompt  # From the react template
    
    def test_error_recovery_prompt(self):
        """测试错误恢复提示"""
        manager = PromptManager()
        
        agent = Agent(name="test_agent", role="tester", goal="test", organization_id="org")
        task = Task(description="Test task", expected_output="Result")
        event_log = EventLog()
        
        error_prompt = manager.build_error_recovery_prompt(
            event_log, agent, task, "Tool execution failed"
        )
        
        assert "error" in error_prompt.lower()
        assert "Tool execution failed" in error_prompt
        assert "recovery" in error_prompt.lower()
        assert "test_agent" in error_prompt


class TestErrorHandling:
    """测试错误处理系统"""
    
    def test_error_classifier(self):
        """测试错误分类器"""
        classifier = ErrorClassifier()
        
        # Test different error types
        tool_error = ValueError("Tool execution failed")
        assert classifier.classify(tool_error) == "tool_error"
        
        json_error = json.JSONDecodeError("Invalid JSON", "", 0)
        assert classifier.classify(json_error) == "parsing_error"
        
        # Test recoverability
        assert classifier.is_recoverable(tool_error) is True
        
        permission_error = PermissionError("Access denied")
        assert classifier.classify(permission_error) == "permission_error"
        assert classifier.is_recoverable(permission_error) is False
    
    def test_circuit_breaker(self):
        """测试断路器"""
        breaker = CircuitBreaker(failure_threshold=2, recovery_timeout=1)
        
        def failing_function():
            raise ValueError("Always fails")
        
        def success_function():
            return "success"
        
        # Test normal operation
        result = breaker.call(success_function)
        assert result == "success"
        assert breaker.state == "closed"
        
        # Test failure handling
        with pytest.raises(ValueError):
            breaker.call(failing_function)
        assert breaker.failure_count == 1
        assert breaker.state == "closed"
        
        # Second failure should open circuit
        with pytest.raises(ValueError):
            breaker.call(failing_function)
        assert breaker.failure_count == 2
        assert breaker.state == "open"
        
        # Further calls should raise CircuitBreakerOpenError
        with pytest.raises(CircuitBreakerOpenError):
            breaker.call(failing_function)
    
    def test_error_handler(self):
        """测试错误处理器"""
        handler = ErrorHandler(max_consecutive_errors=2)
        
        # Test error handling
        test_error = ValueError("Test error")
        error_event = handler.handle(test_error, {"context": "test"})
        
        assert isinstance(error_event, ErrorEvent)
        assert error_event.error_type == "validation_error"  # ValueError maps to validation_error
        assert "Test error" in error_event.error_message
        assert error_event.recoverable is True
        
        # Test consecutive errors
        assert handler.consecutive_errors == 1
        assert handler.should_request_human_help() is False
        
        # Second error
        handler.handle(test_error)
        assert handler.consecutive_errors == 2
        assert handler.should_request_human_help() is True
        
        # Test human help request creation
        recent_errors = handler.error_history[-2:]
        help_request = handler.create_human_help_request(recent_errors)
        assert isinstance(help_request, HumanRequestEvent)
        assert "stuck" in help_request.question.lower()


class TestCommunication:
    """测试通信接口"""
    
    def test_basic_communication(self):
        """测试基本通信功能"""
        comm = CommunicationInterface("agent_1")
        
        # Test sending
        message = comm.send("agent_2", "Hello", "greeting")
        assert message.sender_id == "agent_1"
        assert message.recipient_id == "agent_2"
        assert message.content == "Hello"
        assert message.metadata["message_type"] == "greeting"
        
        # Test message delivery
        comm.deliver_message(message)
        assert comm.has_pending_messages() is True
        
        # Test receiving
        received = comm.receive()
        assert received is not None
        assert received.content == "Hello"
        
        # Test stats
        stats = comm.get_message_stats()
        assert stats["sent_count"] == 1
        assert stats["received_count"] == 1
        assert stats["pending_count"] == 0
    
    def test_message_handlers(self):
        """测试消息处理器"""
        comm = CommunicationInterface("agent_1")
        
        # Register handler
        def greeting_handler(message):
            return comm.send(
                message.sender_id,
                f"Hello back, {message.content}!",
                "greeting_response"
            )
        
        comm.register_message_handler("greeting", greeting_handler)
        
        # Create and deliver message
        from agenticx.core import Message
        message = Message(
            sender_id="agent_2",
            recipient_id="agent_1",
            content="friend",
            metadata={"message_type": "greeting"}
        )
        
        comm.deliver_message(message)
        
        # Process messages
        responses = comm.process_messages()
        assert len(responses) == 1
        assert "Hello back, friend!" in responses[0].content
    
    def test_broadcast_communication(self):
        """测试广播通信"""
        broadcast_comm = BroadcastCommunication("agent_1")
        
        # Join group
        broadcast_comm.join_group("team_a")
        assert "agent_1" in broadcast_comm.broadcast_groups["team_a"]
        
        # Simulate other agents in group
        broadcast_comm.broadcast_groups["team_a"].extend(["agent_2", "agent_3"])
        
        # Broadcast message
        messages = broadcast_comm.broadcast("team_a", "Hello team!", "announcement")
        assert len(messages) == 2  # Doesn't send to self
        assert all(msg.metadata["broadcast_group"] == "team_a" for msg in messages)
    
    @pytest.mark.asyncio
    async def test_async_communication(self):
        """测试异步通信"""
        async_comm = AsyncCommunicationInterface("agent_1")
        
        # Test async sending
        message = await async_comm.asend("agent_2", "Async hello")
        assert message.content == "Async hello"
        
        # Register async handler
        async def async_handler(message):
            await asyncio.sleep(0.01)  # Simulate async work
            return async_comm.send(message.sender_id, "Async response")
        
        async_comm.register_async_handler("async_test", async_handler)
        
        # Test async message processing
        from agenticx.core import Message
        test_message = Message(
            sender_id="agent_2",
            recipient_id="agent_1", 
            content="test",
            metadata={"message_type": "async_test"}
        )
        
        async_comm.deliver_message(test_message)
        responses = await async_comm.aprocess_messages()
        assert len(responses) == 1
        assert responses[0].content == "Async response"


class TestAgentExecutor:
    """测试智能体执行器"""
    
    def test_tool_registry(self):
        """测试工具注册表"""
        registry = ToolRegistry()
        
        @tool()
        def test_tool(x: int) -> int:
            return x * 2
        
        registry.register(test_tool)
        
        assert "test_tool" in registry.list_tools()
        retrieved_tool = registry.get("test_tool")
        assert retrieved_tool is not None
        assert retrieved_tool.name == "test_tool"
    
    def test_action_parser(self):
        """测试动作解析器"""
        parser = ActionParser()
        
        # Test valid JSON
        valid_json = '{"action": "tool_call", "tool": "test_tool", "args": {"x": 5}}'
        action = parser.parse_action(valid_json)
        assert action["action"] == "tool_call"
        assert action["tool"] == "test_tool"
        assert action["args"]["x"] == 5
        
        # Test JSON embedded in text
        text_with_json = 'I need to call a tool: {"action": "finish_task", "result": "done"}'
        action = parser.parse_action(text_with_json)
        assert action["action"] == "finish_task"
        assert action["result"] == "done"
        
        # Test invalid JSON (should fallback to finish_task)
        invalid_json = "This is not JSON at all"
        action = parser.parse_action(invalid_json)
        assert action["action"] == "finish_task"
        assert action["result"] == invalid_json
    
    def test_agent_executor_basic(self):
        """测试智能体执行器基本功能"""
        # Create mock LLM that returns a finish_task action
        mock_llm = MockLLMProvider([
            '{"action": "finish_task", "result": "Task completed successfully", "reasoning": "All done"}'
        ])
        
        # Create test tool
        @tool()
        def simple_tool(x: int) -> int:
            return x + 1
        
        # Create executor
        executor = AgentExecutor(
            llm_provider=mock_llm,
            tools=[simple_tool],
            max_iterations=10
        )
        
        # Create test agent and task
        agent = Agent(name="test_agent", role="tester", goal="test", organization_id="org")
        task = Task(description="Simple test task", expected_output="A result")
        
        # Execute
        result = executor.run(agent, task)
        
        assert result["success"] is True
        assert result["result"] == "Task completed successfully"
        assert "event_log" in result
        assert "stats" in result
        
        # Check event log
        event_log = result["event_log"]
        assert len(event_log.events) > 0
        assert event_log.events[0].type == "task_start"
        assert event_log.events[-1].type == "task_end"
    
    def test_agent_executor_with_tool_calls(self):
        """测试智能体执行器工具调用"""
        # Create mock LLM that first calls a tool, then finishes
        mock_llm = MockLLMProvider([
            '{"action": "tool_call", "tool": "math_tool", "args": {"x": 5}, "reasoning": "Need to calculate"}',
            '{"action": "finish_task", "result": "Calculation result is 6", "reasoning": "Tool returned 6"}'
        ])
        
        # Create test tool
        @tool()
        def math_tool(x: int) -> int:
            return x + 1
        
        # Create executor
        executor = AgentExecutor(
            llm_provider=mock_llm,
            tools=[math_tool],
            max_iterations=10
        )
        
        # Create test agent and task
        agent = Agent(name="math_agent", role="calculator", goal="calculate", organization_id="org")
        task = Task(description="Calculate x + 1 where x = 5", expected_output="6")
        
        # Execute
        result = executor.run(agent, task)
        
        assert result["success"] is True
        assert "Calculation result is 6" in result["result"]
        
        # Check that tool was called
        event_log = result["event_log"]
        tool_calls = event_log.get_events_by_type("tool_call")
        tool_results = event_log.get_events_by_type("tool_result")
        
        assert len(tool_calls) == 1
        assert len(tool_results) == 1
        assert tool_calls[0].tool_name == "math_tool"
        assert tool_results[0].success is True
        assert tool_results[0].result == 6
    
    def test_agent_executor_error_handling(self):
        """测试智能体执行器错误处理"""
        # Create mock LLM that tries to call a non-existent tool, then tries to finish
        mock_llm = MockLLMProvider([
            '{"action": "tool_call", "tool": "nonexistent_tool", "args": {}, "reasoning": "This will fail"}',
            '{"action": "finish_task", "result": "Failed to complete task due to missing tool", "reasoning": "Tool not found"}'
        ])
        
        # Create executor (no tools registered)
        executor = AgentExecutor(
            llm_provider=mock_llm,
            max_iterations=5
        )
        
        # Create test agent and task
        agent = Agent(name="test_agent", role="tester", goal="test", organization_id="org")
        task = Task(description="Try to use nonexistent tool", expected_output="Should fail")
        
        # Execute
        result = executor.run(agent, task)
        
        # The execution should succeed but with error events recorded
        assert result["success"] is True  # Changed expectation
        
        # Check error was recorded
        event_log = result["event_log"]
        tool_results = event_log.get_events_by_type("tool_result")
        failed_tools = [tr for tr in tool_results if not tr.success]
        assert len(failed_tools) > 0
        assert "nonexistent_tool" in failed_tools[0].error


class TestIntegration:
    """M5 模块集成测试"""
    
    def test_complete_agent_workflow(self):
        """测试完整的智能体工作流"""
        # Create tools
        @tool()
        def add_numbers(a: int, b: int) -> int:
            """Add two numbers together."""
            return a + b
        
        @tool()
        def multiply_numbers(a: int, b: int) -> int:
            """Multiply two numbers."""
            return a * b
        
        # Create mock LLM with a complex workflow
        mock_llm = MockLLMProvider([
            '{"action": "tool_call", "tool": "add_numbers", "args": {"a": 5, "b": 3}, "reasoning": "First add 5 + 3"}',
            '{"action": "tool_call", "tool": "multiply_numbers", "args": {"a": 8, "b": 2}, "reasoning": "Then multiply result by 2"}',
            '{"action": "finish_task", "result": "Final calculation: (5 + 3) * 2 = 16", "reasoning": "Completed the calculation"}'
        ])
        
        # Create executor with custom components
        prompt_manager = PromptManager()
        error_handler = ErrorHandler(max_consecutive_errors=3)
        communication = CommunicationInterface("math_agent")
        
        executor = AgentExecutor(
            llm_provider=mock_llm,
            tools=[add_numbers, multiply_numbers],
            prompt_manager=prompt_manager,
            error_handler=error_handler,
            communication=communication,
            max_iterations=20
        )
        
        # Create agent and task
        agent = Agent(
            name="math_agent",
            role="mathematician", 
            goal="perform complex calculations",
            backstory="I am an expert at mathematical operations",
            organization_id="math_org"
        )
        
        task = Task(
            description="Calculate (5 + 3) * 2 using the available tools",
            expected_output="16",
            context={"operation": "multi_step_calculation"}
        )
        
        # Execute
        result = executor.run(agent, task)
        
        # Verify success
        assert result["success"] is True
        assert "16" in result["result"]
        
        # Verify event log
        event_log = result["event_log"]
        assert len(event_log.events) > 6  # start, llm_call, llm_response, tool_call, tool_result x2, finish, end
        
        # Verify tool calls
        tool_calls = event_log.get_events_by_type("tool_call")
        assert len(tool_calls) == 2
        assert tool_calls[0].tool_name == "add_numbers"
        assert tool_calls[1].tool_name == "multiply_numbers"
        
        # Verify tool results
        tool_results = event_log.get_events_by_type("tool_result")
        assert len(tool_results) == 2
        assert tool_results[0].result == 8  # 5 + 3
        assert tool_results[1].result == 16  # 8 * 2
        
        # Verify statistics
        stats = result["stats"]
        assert stats["tool_calls"] == 2
        assert stats["llm_calls"] == 3
        assert stats["errors"] == 0
        assert stats["final_state"]["status"] == "completed"
        assert stats["token_usage"] > 0
        assert stats["estimated_cost"] > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 