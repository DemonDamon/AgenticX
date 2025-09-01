"""Core GUI interaction tools."""

from typing import Optional, Dict, Any, List
import asyncio
from datetime import datetime

from agenticx.core.component import Component
from .base import GUIActionTool, ToolResult
from .models import ClickArgs, TypeArgs, ScrollArgs, WaitArgs
from .adapters import BasePlatformAdapter
from agenticx.embodiment.core.models import ScreenState, InteractionElement


class ClickTool(GUIActionTool):
    """Tool for performing click operations on GUI elements.
    
    Supports different types of clicks (left, right, double) and can target
    elements by ID or natural language description.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "click"
        self.description = "Perform click operations on GUI elements"
    
    async def _execute_action(self, args: ClickArgs) -> ToolResult:
        """Execute click operation.
        
        Args:
            args: Click operation arguments
            
        Returns:
            ToolResult with operation status and details
        """
        start_time = datetime.now()
        
        try:
            # Validate arguments
            if not args.element_id and not args.element_query:
                return ToolResult(
                    success=False,
                    message="Either element_id or element_query must be provided",
                    execution_time=(datetime.now() - start_time).total_seconds()
                )
            
            # Wait for element if specified
            if args.wait_for_element:
                element_found = await self.platform_adapter.wait_for_element(
                    args.element_query or args.element_id,
                    timeout=args.timeout,
                    condition="clickable"
                )
                
                if not element_found:
                    return ToolResult(
                        success=False,
                        message=f"Element not found or not clickable within {args.timeout}s: {args.element_query or args.element_id}",
                        execution_time=(datetime.now() - start_time).total_seconds()
                    )
            
            # Perform click operation
            await self.platform_adapter.click(
                element_id=args.element_id,
                element_query=args.element_query,
                click_type=args.click_type
            )
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            return ToolResult(
                success=True,
                message=f"Successfully performed {args.click_type} click on element",
                execution_time=execution_time,
                data={
                    "element_id": args.element_id,
                    "element_query": args.element_query,
                    "click_type": args.click_type
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Click operation failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class TypeTool(GUIActionTool):
    """Tool for typing text into GUI elements.
    
    Supports typing into specific elements or the currently focused element,
    with options to clear existing content first.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "type"
        self.description = "Type text into GUI elements"
    
    async def _execute_action(self, args: TypeArgs) -> ToolResult:
        """Execute text typing operation.
        
        Args:
            args: Type operation arguments
            
        Returns:
            ToolResult with operation status and details
        """
        start_time = datetime.now()
        
        try:
            # Validate arguments
            if not args.text:
                return ToolResult(
                    success=False,
                    message="Text to type cannot be empty",
                    execution_time=(datetime.now() - start_time).total_seconds()
                )
            
            # Wait for element if specified
            if args.wait_for_element and (args.element_id or args.element_query):
                element_found = await self.platform_adapter.wait_for_element(
                    args.element_query or args.element_id,
                    timeout=args.timeout,
                    condition="visible"
                )
                
                if not element_found:
                    return ToolResult(
                        success=False,
                        message=f"Element not found within {args.timeout}s: {args.element_query or args.element_id}",
                        execution_time=(datetime.now() - start_time).total_seconds()
                    )
            
            # Perform type operation
            await self.platform_adapter.type_text(
                text=args.text,
                element_id=args.element_id,
                element_query=args.element_query,
                clear_first=args.clear_first
            )
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            return ToolResult(
                success=True,
                message=f"Successfully typed text: '{args.text[:50]}{'...' if len(args.text) > 50 else ''}'",
                execution_time=execution_time,
                data={
                    "text": args.text,
                    "element_id": args.element_id,
                    "element_query": args.element_query,
                    "clear_first": args.clear_first,
                    "text_length": len(args.text)
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Type operation failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class ScrollTool(GUIActionTool):
    """Tool for performing scroll operations.
    
    Supports scrolling in different directions with configurable amounts,
    either on specific elements or the entire screen.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "scroll"
        self.description = "Perform scroll operations on GUI elements or screen"
    
    async def _execute_action(self, args: ScrollArgs) -> ToolResult:
        """Execute scroll operation.
        
        Args:
            args: Scroll operation arguments
            
        Returns:
            ToolResult with operation status and details
        """
        start_time = datetime.now()
        
        try:
            # Validate direction
            valid_directions = ["up", "down", "left", "right"]
            if args.direction not in valid_directions:
                return ToolResult(
                    success=False,
                    message=f"Invalid scroll direction: {args.direction}. Must be one of {valid_directions}",
                    execution_time=(datetime.now() - start_time).total_seconds()
                )
            
            # Wait for element if specified
            if args.wait_for_element and (args.element_id or args.element_query):
                element_found = await self.platform_adapter.wait_for_element(
                    args.element_query or args.element_id,
                    timeout=args.timeout,
                    condition="visible"
                )
                
                if not element_found:
                    return ToolResult(
                        success=False,
                        message=f"Element not found within {args.timeout}s: {args.element_query or args.element_id}",
                        execution_time=(datetime.now() - start_time).total_seconds()
                    )
            
            # Perform scroll operation
            await self.platform_adapter.scroll(
                direction=args.direction,
                element_id=args.element_id,
                element_query=args.element_query,
                amount=args.amount
            )
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            return ToolResult(
                success=True,
                message=f"Successfully scrolled {args.direction} by {args.amount} units",
                execution_time=execution_time,
                data={
                    "direction": args.direction,
                    "amount": args.amount,
                    "element_id": args.element_id,
                    "element_query": args.element_query
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Scroll operation failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class ScreenshotTool(GUIActionTool):
    """Tool for taking screenshots of the current screen.
    
    Captures the current state of the screen and returns it as a base64
    encoded image for analysis or debugging purposes.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "screenshot"
        self.description = "Take a screenshot of the current screen"
    
    async def _execute_action(self, args: Optional[Dict[str, Any]] = None) -> ToolResult:
        """Execute screenshot operation.
        
        Args:
            args: Optional arguments (not used for screenshot)
            
        Returns:
            ToolResult with screenshot data
        """
        start_time = datetime.now()
        
        try:
            # Take screenshot
            screenshot_data = await self.platform_adapter.take_screenshot()
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            return ToolResult(
                success=True,
                message="Successfully captured screenshot",
                execution_time=execution_time,
                data={
                    "screenshot": screenshot_data,
                    "format": "base64_png",
                    "timestamp": datetime.now().isoformat()
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Screenshot operation failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class GetElementTreeTool(GUIActionTool):
    """Tool for retrieving the current UI element hierarchy.
    
    Analyzes the current screen and returns a structured representation
    of all interactive elements for navigation and interaction planning.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "get_element_tree"
        self.description = "Get the current UI element hierarchy"
    
    async def _execute_action(self, args: Optional[Dict[str, Any]] = None) -> ToolResult:
        """Execute element tree retrieval operation.
        
        Args:
            args: Optional arguments (not used for element tree)
            
        Returns:
            ToolResult with element tree data
        """
        start_time = datetime.now()
        
        try:
            # Get element tree
            elements = await self.platform_adapter.get_element_tree()
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            # Convert elements to serializable format
            element_data = []
            for element in elements:
                element_data.append({
                    "element_id": element.element_id,
                    "element_type": element.element_type,
                    "text_content": element.text_content,
                    "bounds": element.bounds,
                    "attributes": element.attributes
                })
            
            return ToolResult(
                success=True,
                message=f"Successfully retrieved {len(elements)} interactive elements",
                execution_time=execution_time,
                data={
                    "elements": element_data,
                    "element_count": len(elements),
                    "timestamp": datetime.now().isoformat()
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Element tree retrieval failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class WaitTool(GUIActionTool):
    """Tool for waiting for specific conditions or elements.
    
    Provides flexible waiting capabilities for element visibility,
    clickability, or custom conditions with configurable timeouts.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "wait"
        self.description = "Wait for specific conditions or elements"
    
    async def _execute_action(self, args: WaitArgs) -> ToolResult:
        """Execute wait operation.
        
        Args:
            args: Wait operation arguments
            
        Returns:
            ToolResult with wait operation status
        """
        start_time = datetime.now()
        
        try:
            if args.element_query:
                # Wait for specific element condition
                success = await self.platform_adapter.wait_for_element(
                    args.element_query,
                    timeout=args.timeout,
                    condition=args.condition
                )
                
                execution_time = (datetime.now() - start_time).total_seconds()
                
                if success:
                    return ToolResult(
                        success=True,
                        message=f"Element condition '{args.condition}' met for: {args.element_query}",
                        execution_time=execution_time,
                        data={
                            "element_query": args.element_query,
                            "condition": args.condition,
                            "timeout": args.timeout
                        }
                    )
                else:
                    return ToolResult(
                        success=False,
                        message=f"Element condition '{args.condition}' not met within {args.timeout}s: {args.element_query}",
                        execution_time=execution_time
                    )
            else:
                # Simple time-based wait
                await asyncio.sleep(args.timeout)
                execution_time = (datetime.now() - start_time).total_seconds()
                
                return ToolResult(
                    success=True,
                    message=f"Waited for {args.timeout} seconds",
                    execution_time=execution_time,
                    data={"wait_time": args.timeout}
                )
                
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Wait operation failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )


class GetScreenStateTool(GUIActionTool):
    """Tool for getting comprehensive screen state information.
    
    Combines screenshot and element tree data to provide a complete
    view of the current screen state for analysis and decision making.
    """
    
    def __init__(self, platform_adapter: BasePlatformAdapter):
        super().__init__(platform_adapter)
        self.platform_adapter = platform_adapter
        self.name = "get_screen_state"
        self.description = "Get comprehensive screen state information"
    
    async def _execute_action(self, args: Optional[Dict[str, Any]] = None) -> ToolResult:
        """Execute screen state retrieval operation.
        
        Args:
            args: Optional arguments (not used for screen state)
            
        Returns:
            ToolResult with complete screen state data
        """
        start_time = datetime.now()
        
        try:
            # Get complete screen state
            screen_state = await self.platform_adapter.get_current_screen_state()
            
            execution_time = (datetime.now() - start_time).total_seconds()
            
            # Convert to serializable format
            element_data = []
            for element in screen_state.interactive_elements:
                element_data.append({
                    "element_id": element.element_id,
                    "element_type": element.element_type,
                    "text_content": element.text_content,
                    "bounds": element.bounds,
                    "attributes": element.attributes
                })
            
            return ToolResult(
                success=True,
                message=f"Successfully retrieved screen state with {len(screen_state.interactive_elements)} elements",
                execution_time=execution_time,
                data={
                    "screenshot": screen_state.screenshot,
                    "elements": element_data,
                    "metadata": screen_state.metadata,
                    "timestamp": datetime.now().isoformat()
                }
            )
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return ToolResult(
                success=False,
                message=f"Screen state retrieval failed: {str(e)}",
                execution_time=execution_time,
                error=str(e)
            )