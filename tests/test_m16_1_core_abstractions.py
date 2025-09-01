"""Test suite for M16.1 Core Abstractions.

This module tests the core abstractions for GUI automation agents,
including GUIAgent, GUITask, GUIAgentContext, and related data models.
"""

import pytest
import asyncio
from datetime import datetime
from typing import Dict, Any

# Import the core abstractions
from agenticx.embodiment.core import (
    GUIAgent,
    GUITask,
    GUIAgentContext,
    ScreenState,
    InteractionElement,
    GUIAgentResult
)
from agenticx.embodiment.core.models import TaskStatus, ElementType


class TestScreenState:
    """Test cases for ScreenState model."""
    
    def test_screen_state_creation(self):
        """Test basic ScreenState creation."""
        screen_state = ScreenState(
            agent_id="test_agent_001",
            screenshot="base64_encoded_screenshot",
            ocr_text="Sample OCR text"
        )
        
        assert screen_state.agent_id == "test_agent_001"
        assert screen_state.screenshot == "base64_encoded_screenshot"
        assert screen_state.ocr_text == "Sample OCR text"
        assert isinstance(screen_state.timestamp, datetime)
        assert screen_state.element_tree == {}
        assert screen_state.interactive_elements == []
    
    def test_screen_state_with_elements(self):
        """Test ScreenState with interactive elements."""
        element1 = InteractionElement(
            element_id="btn_submit",
            bounds=(100, 200, 80, 30),
            element_type=ElementType.BUTTON,
            text_content="Submit"
        )
        
        element2 = InteractionElement(
            element_id="input_username",
            bounds=(100, 150, 200, 25),
            element_type=ElementType.TEXT_INPUT,
            text_content="",
            attributes={"placeholder": "Enter username"}
        )
        
        screen_state = ScreenState(
            agent_id="test_agent_001",
            interactive_elements=[element1, element2]
        )
        
        assert len(screen_state.interactive_elements) == 2
        
        # Test get_element_by_id
        found_element = screen_state.get_element_by_id("btn_submit")
        assert found_element is not None
        assert found_element.text_content == "Submit"
        
        # Test get_elements_by_type
        buttons = screen_state.get_elements_by_type(ElementType.BUTTON)
        assert len(buttons) == 1
        assert buttons[0].element_id == "btn_submit"
        
        text_inputs = screen_state.get_elements_by_type(ElementType.TEXT_INPUT)
        assert len(text_inputs) == 1
        assert text_inputs[0].element_id == "input_username"


class TestInteractionElement:
    """Test cases for InteractionElement model."""
    
    def test_interaction_element_creation(self):
        """Test basic InteractionElement creation."""
        element = InteractionElement(
            element_id="test_button",
            bounds=(10, 20, 100, 30),
            element_type=ElementType.BUTTON,
            text_content="Click Me",
            attributes={"enabled": True, "visible": True}
        )
        
        assert element.element_id == "test_button"
        assert element.bounds == (10, 20, 100, 30)
        assert element.element_type == ElementType.BUTTON
        assert element.text_content == "Click Me"
        assert element.attributes["enabled"] is True
        assert element.attributes["visible"] is True


class TestGUITask:
    """Test cases for GUITask model."""
    
    def test_gui_task_creation(self):
        """Test basic GUITask creation."""
        task = GUITask(
            description="Automate login process",
            expected_output="User successfully logged in",
            app_name="TestApp",
            automation_type="desktop"
        )
        
        assert task.description == "Automate login process"
        assert task.expected_output == "User successfully logged in"
        assert task.app_name == "TestApp"
        assert task.automation_type == "desktop"
        assert task.max_execution_time == 300  # default value
        assert task.screenshot_on_failure is True  # default value
    
    def test_gui_task_web_automation(self):
        """Test GUITask for web automation."""
        task = GUITask(
            description="Navigate to website and fill form",
            expected_output="Form submitted successfully",
            initial_url="https://example.com",
            automation_type="web"
        )
        
        assert task.is_web_automation() is True
        assert task.is_desktop_automation() is False
        assert task.is_mobile_automation() is False
        
        target_info = task.get_target_info()
        assert target_info["initial_url"] == "https://example.com"
        assert target_info["automation_type"] == "web"
    
    def test_gui_task_desktop_automation(self):
        """Test GUITask for desktop automation."""
        task = GUITask(
            description="Automate desktop application",
            expected_output="Task completed",
            app_name="Calculator",
            automation_type="desktop"
        )
        
        assert task.is_desktop_automation() is True
        assert task.is_web_automation() is False
        assert task.is_mobile_automation() is False


class TestGUIAgentContext:
    """Test cases for GUIAgentContext model."""
    
    def test_gui_agent_context_creation(self):
        """Test basic GUIAgentContext creation."""
        context = GUIAgentContext(
            agent_id="test_agent_001",
            task_id="test_task_001"
        )
        
        assert context.agent_id == "test_agent_001"
        assert context.task_id == "test_task_001"
        assert context.screen_history == []
        assert context.action_history == []
        assert context.current_app_name is None
        assert context.current_workflow_state == {}
    
    def test_screen_state_management(self):
        """Test screen state management in context."""
        context = GUIAgentContext(
            agent_id="test_agent_001",
            task_id="test_task_001"
        )
        
        # Add screen states
        for i in range(5):
            screen_state = ScreenState(
                agent_id="test_agent_001",
                ocr_text=f"Screen {i}"
            )
            context.add_screen_state(screen_state)
        
        assert len(context.screen_history) == 5
        
        # Test get_current_screen_state
        current_screen = context.get_current_screen_state()
        assert current_screen is not None
        assert current_screen.ocr_text == "Screen 4"
    
    def test_action_management(self):
        """Test action management in context."""
        context = GUIAgentContext(
            agent_id="test_agent_001",
            task_id="test_task_001"
        )
        
        # Add actions
        for i in range(3):
            action = {
                "type": "click",
                "element_id": f"button_{i}",
                "timestamp": datetime.utcnow().isoformat()
            }
            context.add_action(action)
        
        assert len(context.action_history) == 3
        
        # Test get_last_action
        last_action = context.get_last_action()
        assert last_action is not None
        assert last_action["element_id"] == "button_2"
    
    def test_workflow_state_management(self):
        """Test workflow state management."""
        context = GUIAgentContext(
            agent_id="test_agent_001",
            task_id="test_task_001"
        )
        
        # Update workflow state
        context.update_workflow_state("current_step", "login")
        context.update_workflow_state("progress", 0.5)
        
        assert context.get_workflow_state("current_step") == "login"
        assert context.get_workflow_state("progress") == 0.5
        assert context.get_workflow_state("nonexistent", "default") == "default"
    
    def test_application_management(self):
        """Test application management."""
        context = GUIAgentContext(
            agent_id="test_agent_001",
            task_id="test_task_001"
        )
        
        context.set_active_application("TestApp", "Main Window")
        
        assert context.current_app_name == "TestApp"
        assert context.active_window_title == "Main Window"


class TestGUIAgentResult:
    """Test cases for GUIAgentResult model."""
    
    def test_successful_result(self):
        """Test successful task result."""
        result = GUIAgentResult(
            task_id="test_task_001",
            status=TaskStatus.COMPLETED,
            summary="Task completed successfully",
            output={"result": "success"},
            execution_time=5.2
        )
        
        assert result.task_id == "test_task_001"
        assert result.status == TaskStatus.COMPLETED
        assert result.is_successful() is True
        assert result.has_error() is False
        assert result.execution_time == 5.2
    
    def test_failed_result(self):
        """Test failed task result."""
        result = GUIAgentResult(
            task_id="test_task_001",
            status=TaskStatus.FAILED,
            summary="Task failed",
            error_message="Element not found",
            execution_time=2.1
        )
        
        assert result.task_id == "test_task_001"
        assert result.status == TaskStatus.FAILED
        assert result.is_successful() is False
        assert result.has_error() is True
        assert result.error_message == "Element not found"


class TestGUIAgent:
    """Test cases for GUIAgent class."""
    
    def test_gui_agent_creation(self):
        """Test basic GUIAgent creation."""
        agent = GUIAgent(
            id="gui_agent_001",
            name="Test GUI Agent",
            role="automation",
            goal="Automate GUI tasks",
            organization_id="test_org"
        )
        
        assert agent.id == "gui_agent_001"
        assert agent.name == "Test GUI Agent"
        assert agent.role == "automation"
        assert agent.goal == "Automate GUI tasks"
        assert agent.screen_capture_enabled is True
        assert agent.max_retry_attempts == 3
        assert agent.action_delay == 1.0
    
    def test_memory_management(self):
        """Test agent memory management."""
        agent = GUIAgent(
            id="gui_agent_001",
            name="Test GUI Agent",
            role="automation",
            goal="Automate GUI tasks",
            organization_id="test_org"
        )
        
        # Test memory operations
        agent.update_memory("last_action", "click_button")
        agent.update_memory("retry_count", 2)
        
        assert agent.get_memory("last_action") == "click_button"
        assert agent.get_memory("retry_count") == 2
        assert agent.get_memory("nonexistent", "default") == "default"
        
        # Test clear memory
        agent.clear_memory()
        assert agent.get_memory("last_action") is None
    
    def test_learning_components(self):
        """Test learning components management."""
        agent = GUIAgent(
            id="gui_agent_001",
            name="Test GUI Agent",
            role="automation",
            goal="Automate GUI tasks",
            organization_id="test_org"
        )
        
        # Mock learning component
        mock_component = {"type": "pattern_recognition", "version": "1.0"}
        
        agent.add_learning_component("pattern_recognizer", mock_component)
        
        retrieved_component = agent.get_learning_component("pattern_recognizer")
        assert retrieved_component == mock_component
        assert agent.get_learning_component("nonexistent") is None
    
    @pytest.mark.asyncio
    async def test_gui_agent_task_execution(self):
        """Test GUI agent task execution."""
        agent = GUIAgent(
            id="gui_agent_001",
            name="Test GUI Agent",
            role="automation",
            goal="Automate GUI tasks",
            organization_id="test_org"
        )
        
        task = GUITask(
            description="Test automation task",
            expected_output="Task completed",
            app_name="TestApp",
            automation_type="desktop"
        )
        
        context = GUIAgentContext(
            agent_id=agent.id,
            task_id=task.id
        )
        
        # Execute the task
        result = await agent.arun(task, context)
        
        assert isinstance(result, GUIAgentResult)
        assert result.task_id == task.id
        assert result.status == TaskStatus.COMPLETED
        assert result.is_successful() is True
        assert result.execution_time is not None
        assert result.execution_time > 0
        
        # Check that actions were recorded in context
        assert len(context.action_history) > 0
        assert context.current_app_name == "TestApp"
    
    @pytest.mark.asyncio
    async def test_gui_agent_web_task_execution(self):
        """Test GUI agent web task execution."""
        agent = GUIAgent(
            id="gui_agent_001",
            name="Test GUI Agent",
            role="automation",
            goal="Automate web tasks",
            organization_id="test_org"
        )
        
        task = GUITask(
            description="Navigate to website",
            expected_output="Page loaded",
            initial_url="https://example.com",
            automation_type="web"
        )
        
        # Execute the task
        result = await agent.arun(task)
        
        assert isinstance(result, GUIAgentResult)
        assert result.task_id == task.id
        assert result.status == TaskStatus.COMPLETED
        assert result.is_successful() is True


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])