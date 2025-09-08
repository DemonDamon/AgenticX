"""Platform adapters for GUI operations."""

from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
import asyncio
import base64
from io import BytesIO

from agenticx.embodiment.core.models import ScreenState, InteractionElement, ElementType


class BasePlatformAdapter(ABC):
    """Abstract base class for platform-specific GUI operation adapters.
    
    This class defines the interface that all platform adapters must implement
    to support GUI operations across different platforms (Web, Desktop, Mobile).
    """
    
    @abstractmethod
    async def click(self, element_id: Optional[str] = None, element_query: Optional[str] = None, 
                   click_type: str = "left") -> None:
        """Perform a click operation.
        
        Args:
            element_id: Direct element identifier
            element_query: Natural language element description
            click_type: Type of click (left, right, double)
        """
        pass
    
    @abstractmethod
    async def type_text(self, text: str, element_id: Optional[str] = None, 
                       element_query: Optional[str] = None, clear_first: bool = False) -> None:
        """Type text into an element.
        
        Args:
            text: Text to type
            element_id: Direct element identifier
            element_query: Natural language element description
            clear_first: Whether to clear existing content first
        """
        pass
    
    @abstractmethod
    async def scroll(self, direction: str, element_id: Optional[str] = None,
                    element_query: Optional[str] = None, amount: int = 3) -> None:
        """Perform scroll operation.
        
        Args:
            direction: Scroll direction (up, down, left, right)
            element_id: Direct element identifier
            element_query: Natural language element description
            amount: Scroll amount
        """
        pass
    
    @abstractmethod
    async def take_screenshot(self) -> str:
        """Take a screenshot of the current screen.
        
        Returns:
            Base64 encoded screenshot image
        """
        pass
    
    @abstractmethod
    async def get_element_tree(self) -> List[InteractionElement]:
        """Get the current UI element hierarchy.
        
        Returns:
            List of InteractionElement objects representing the UI structure
        """
        pass
    
    @abstractmethod
    async def find_element(self, element_query: Optional[str]) -> Optional[str]:
        """Find an element by natural language description.
        
        Args:
            element_query: Natural language description of the element
            
        Returns:
            Element ID if found, None otherwise
        """
        pass
    
    @abstractmethod
    async def wait_for_element(self, element_query: Optional[str], timeout: float = 10.0,
                              condition: str = "visible") -> bool:
        """Wait for an element to meet a condition.
        
        Args:
            element_query: Element description
            timeout: Maximum wait time in seconds
            condition: Condition to wait for (visible, clickable, invisible)
            
        Returns:
            True if condition met within timeout, False otherwise
        """
        pass
    
    @abstractmethod
    async def get_current_screen_state(self) -> ScreenState:
        """Get the current screen state.
        
        Returns:
            ScreenState object representing current screen
        """
        pass


class WebPlatformAdapter(BasePlatformAdapter):
    """Platform adapter for web-based GUI operations using Playwright.
    
    This adapter implements web-specific GUI operations and can be extended
    to support different web automation frameworks.
    """
    
    def __init__(self, page=None, browser_context=None):
        """Initialize the web platform adapter.
        
        Args:
            page: Playwright page object (optional for testing)
            browser_context: Browser context for managing sessions
        """
        self.page = page
        self.browser_context = browser_context
        self._element_cache = {}
    
    async def click(self, element_id: Optional[str] = None, element_query: Optional[str] = None,
                   click_type: str = "left") -> None:
        """Perform click operation on web element."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        # Find element by ID or query
        target_element = None
        if element_id:
            target_element = element_id
        elif element_query:
            target_element = await self.find_element(element_query)
        
        if not target_element:
            raise ValueError(f"Could not find element: {element_query or element_id}")
        
        # Perform click based on type
        if click_type == "left":
            await self.page.click(target_element)
        elif click_type == "right":
            await self.page.click(target_element, button="right")
        elif click_type == "double":
            await self.page.dblclick(target_element)
        else:
            raise ValueError(f"Unsupported click type: {click_type}")
    
    async def type_text(self, text: str, element_id: Optional[str] = None,
                       element_query: Optional[str] = None, clear_first: bool = False) -> None:
        """Type text into web element."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        # Find target element
        target_element = None
        if element_id:
            target_element = element_id
        elif element_query:
            target_element = await self.find_element(element_query)
        
        if target_element:
            if clear_first:
                await self.page.fill(target_element, "")
            await self.page.type(target_element, text)
        else:
            # Type into currently focused element
            await self.page.keyboard.type(text)
    
    async def scroll(self, direction: str, element_id: Optional[str] = None,
                    element_query: Optional[str] = None, amount: int = 3) -> None:
        """Perform scroll operation."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        # Calculate scroll delta
        delta_map = {
            "up": (0, -100 * amount),
            "down": (0, 100 * amount),
            "left": (-100 * amount, 0),
            "right": (100 * amount, 0)
        }
        
        if direction not in delta_map:
            raise ValueError(f"Unsupported scroll direction: {direction}")
        
        delta_x, delta_y = delta_map[direction]
        
        # Scroll specific element or entire page
        if element_id or element_query:
            target_element = element_id
            if not target_element and element_query:
                target_element = await self.find_element(element_query)
            if target_element:
                await self.page.hover(target_element)
        
        await self.page.mouse.wheel(delta_x, delta_y)
    
    async def take_screenshot(self) -> str:
        """Take screenshot of current page."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        screenshot_bytes = await self.page.screenshot()
        return base64.b64encode(screenshot_bytes).decode('utf-8')
    
    async def get_element_tree(self) -> List[InteractionElement]:
        """Get web page element hierarchy."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        # This is a simplified implementation
        # In practice, you'd extract detailed element information
        elements = []
        
        # Get all interactive elements
        interactive_selectors = [
            'button', 'input', 'select', 'textarea', 'a[href]',
            '[onclick]', '[role="button"]', '[tabindex]'
        ]
        
        for selector in interactive_selectors:
            try:
                element_handles = await self.page.query_selector_all(selector)
                for i, handle in enumerate(element_handles):
                    try:
                        # Get element properties
                        tag_name = await handle.evaluate('el => el.tagName.toLowerCase()')
                        text_content = await handle.evaluate('el => el.textContent?.trim() || ""')
                        element_id = await handle.evaluate('el => el.id || ""')
                        class_name = await handle.evaluate('el => el.className || ""')
                        
                        # Get bounding box
                        box = await handle.bounding_box()
                        bounds = (box['x'], box['y'], box['width'], box['height']) if box else (0, 0, 0, 0)
                        
                        element = InteractionElement(
                            element_id=element_id or f"{tag_name}_{i}",
                            element_type=tag_name,
                            text_content=text_content,
                            bounds=bounds,
                            attributes={
                                'class': class_name,
                                'selector': selector,
                                'is_interactive': True
                            }
                        )
                        elements.append(element)
                    except Exception:
                        # Skip elements that can't be processed
                        continue
            except Exception:
                # Skip selectors that fail
                continue
        
        return elements
    
    async def find_element(self, element_query: Optional[str]) -> Optional[str]:
        """Find element by natural language description.
        
        This is a simplified implementation. In practice, you'd use
        more sophisticated element matching algorithms.
        """
        if not self.page or not element_query:
            return None
        
        # Simple text-based matching
        try:
            # Try to find by text content
            element = await self.page.query_selector(f'text="{element_query}"')
            if element:
                return f'text="{element_query}"'
            
            # Try partial text match
            element = await self.page.query_selector(f'text*="{element_query}"')
            if element:
                return f'text*="{element_query}"'
            
            # Try placeholder text
            element = await self.page.query_selector(f'[placeholder*="{element_query}"]')
            if element:
                return f'[placeholder*="{element_query}"]'
            
            # Try aria-label
            element = await self.page.query_selector(f'[aria-label*="{element_query}"]')
            if element:
                return f'[aria-label*="{element_query}"]'
            
        except Exception:
            pass
        
        return None
    
    async def wait_for_element(self, element_query: Optional[str], timeout: float = 10.0,
                              condition: str = "visible") -> bool:
        """Wait for element to meet condition."""
        if not self.page or not element_query:
            return False
        
        try:
            selector = await self.find_element(element_query)
            if not selector:
                return False
            
            if condition == "visible":
                await self.page.wait_for_selector(selector, state="visible", timeout=timeout * 1000)
            elif condition == "clickable":
                await self.page.wait_for_selector(selector, state="attached", timeout=timeout * 1000)
            elif condition == "invisible":
                await self.page.wait_for_selector(selector, state="hidden", timeout=timeout * 1000)
            
            return True
        except Exception:
            return False
    
    async def get_current_screen_state(self) -> ScreenState:
        """Get current web page state."""
        if not self.page:
            raise RuntimeError("No page context available for web operations")
        
        # Get screenshot
        screenshot = await self.take_screenshot()
        
        # Get element tree
        elements = await self.get_element_tree()
        
        # Get page info
        url = self.page.url
        title = await self.page.title()
        
        return ScreenState(
            agent_id="web_agent",
            screenshot=screenshot,
            interactive_elements=elements,
            metadata={
                'url': url,
                'title': title,
                'platform': 'web'
            }
        )


class MockPlatformAdapter(BasePlatformAdapter):
    """Mock platform adapter for testing purposes."""
    
    def __init__(self):
        self.actions_performed = []
        self.mock_elements = [
            InteractionElement(
                element_id="button_1",
                element_type=ElementType.BUTTON,
                text_content="Click me",
                bounds=(100, 100, 80, 30),
                attributes={'is_interactive': True}
            )
        ]
    
    async def click(self, element_id: Optional[str] = None, element_query: Optional[str] = None,
                   click_type: str = "left") -> None:
        await asyncio.sleep(0.001)  # Simulate operation time
        self.actions_performed.append({
            'action': 'click',
            'element_id': element_id,
            'element_query': element_query,
            'click_type': click_type
        })
    
    async def type_text(self, text: str, element_id: Optional[str] = None,
                       element_query: Optional[str] = None, clear_first: bool = False) -> None:
        self.actions_performed.append({
            'action': 'type',
            'text': text,
            'element_id': element_id,
            'element_query': element_query,
            'clear_first': clear_first
        })
    
    async def scroll(self, direction: str, element_id: Optional[str] = None,
                    element_query: Optional[str] = None, amount: int = 3) -> None:
        self.actions_performed.append({
            'action': 'scroll',
            'direction': direction,
            'element_id': element_id,
            'element_query': element_query,
            'amount': amount
        })
    
    async def take_screenshot(self) -> str:
        # Return a mock base64 image
        return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    
    async def get_element_tree(self) -> List[InteractionElement]:
        return self.mock_elements
    
    async def find_element(self, element_query: Optional[str]) -> Optional[str]:
        # Simple mock implementation
        if element_query and "button" in element_query.lower():
            return "button_1"
        return None
    
    async def wait_for_element(self, element_query: Optional[str], timeout: float = 10.0,
                              condition: str = "visible") -> bool:
        # Mock always succeeds
        if element_query is None:
            return False
        await asyncio.sleep(0.1)  # Simulate wait time
        return True
    
    async def get_current_screen_state(self) -> ScreenState:
        return ScreenState(
            agent_id="mock_agent",
            screenshot=await self.take_screenshot(),
            interactive_elements=self.mock_elements,
            metadata={'platform': 'mock'}
        )