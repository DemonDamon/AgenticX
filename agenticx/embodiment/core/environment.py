"""AgenticX M16.1: GUI环境抽象基类

本模块定义GUI环境的抽象基类，提供统一的环境接口：
- GUIEnvironment: GUI环境抽象基类
- 环境状态管理
- 动作执行接口
- 观察获取接口
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Tuple, Union
import time
import logging
from dataclasses import dataclass, field

from .models import (
    ScreenState,
    GUIAction,
    ActionSpace,
    ActionType,
    InteractionElement,
    ElementTree,
    PlatformAction
)


@dataclass
class EnvironmentConfig:
    """环境配置数据类"""
    platform: str  # 平台类型
    device_id: Optional[str] = None  # 设备ID
    app_package: Optional[str] = None  # 应用包名
    timeout: float = 30.0  # 操作超时时间
    screenshot_format: str = "png"  # 截图格式
    screenshot_quality: int = 80  # 截图质量
    auto_screenshot: bool = True  # 是否自动截图
    element_detection_timeout: float = 10.0  # 元素检测超时
    action_delay: float = 0.5  # 动作间延迟
    retry_count: int = 3  # 重试次数
    debug_mode: bool = False  # 调试模式
    custom_settings: Dict[str, Any] = field(default_factory=dict)  # 自定义设置


@dataclass
class EnvironmentState:
    """环境状态数据类"""
    is_connected: bool = False  # 是否已连接
    current_screen: Optional[ScreenState] = None  # 当前屏幕状态
    last_action: Optional[GUIAction] = None  # 最后执行的动作
    action_history: List[GUIAction] = field(default_factory=list)  # 动作历史
    error_count: int = 0  # 错误计数
    session_start_time: Optional[float] = None  # 会话开始时间
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据


class GUIEnvironment(ABC):
    """GUI环境抽象基类
    
    定义GUI环境的统一接口，包括：
    - 环境连接和断开
    - 屏幕状态获取
    - 动作执行
    - 动作空间定义
    """
    
    def __init__(self, config: EnvironmentConfig):
        """初始化GUI环境
        
        Args:
            config: 环境配置
        """
        self.config = config
        self.state = EnvironmentState()
        self.action_space = self._create_action_space()
        self.logger = logging.getLogger(f"{self.__class__.__name__}")
        
        # 设置日志级别
        if config.debug_mode:
            self.logger.setLevel(logging.DEBUG)
        else:
            self.logger.setLevel(logging.INFO)
    
    @abstractmethod
    def _create_action_space(self) -> ActionSpace:
        """创建动作空间
        
        Returns:
            ActionSpace: 动作空间对象
        """
        pass
    
    @abstractmethod
    async def connect(self) -> bool:
        """连接到GUI环境
        
        Returns:
            bool: 连接是否成功
        """
        pass
    
    @abstractmethod
    async def disconnect(self) -> bool:
        """断开GUI环境连接
        
        Returns:
            bool: 断开是否成功
        """
        pass
    
    @abstractmethod
    async def get_screen_state(self, include_screenshot: bool = True) -> ScreenState:
        """获取当前屏幕状态
        
        Args:
            include_screenshot: 是否包含截图
            
        Returns:
            ScreenState: 屏幕状态对象
        """
        pass
    
    @abstractmethod
    async def execute_action(self, action: GUIAction) -> Dict[str, Any]:
        """执行GUI动作
        
        Args:
            action: 要执行的GUI动作
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        pass
    
    @abstractmethod
    async def take_screenshot(self, save_path: Optional[str] = None) -> str:
        """截取屏幕截图
        
        Args:
            save_path: 保存路径，如果为None则自动生成
            
        Returns:
            str: 截图文件路径
        """
        pass
    
    @abstractmethod
    async def find_elements(self, **criteria) -> List[InteractionElement]:
        """查找GUI元素
        
        Args:
            **criteria: 查找条件
            
        Returns:
            List[InteractionElement]: 找到的元素列表
        """
        pass
    
    @abstractmethod
    async def wait_for_element(self, element_id: str, timeout: Optional[float] = None) -> Optional[InteractionElement]:
        """等待元素出现
        
        Args:
            element_id: 元素ID
            timeout: 超时时间
            
        Returns:
            Optional[InteractionElement]: 找到的元素，超时返回None
        """
        pass
    
    @abstractmethod
    def is_element_visible(self, element: InteractionElement) -> bool:
        """检查元素是否可见
        
        Args:
            element: 要检查的元素
            
        Returns:
            bool: 元素是否可见
        """
        pass
    
    @abstractmethod
    async def get_device_info(self) -> Dict[str, Any]:
        """获取设备信息
        
        Returns:
            Dict[str, Any]: 设备信息
        """
        pass
    
    # 通用方法实现
    
    def get_action_space(self) -> ActionSpace:
        """获取动作空间
        
        Returns:
            ActionSpace: 动作空间对象
        """
        return self.action_space
    
    def is_connected(self) -> bool:
        """检查是否已连接
        
        Returns:
            bool: 是否已连接
        """
        return self.state.is_connected
    
    def get_current_screen(self) -> Optional[ScreenState]:
        """获取当前屏幕状态
        
        Returns:
            Optional[ScreenState]: 当前屏幕状态
        """
        return self.state.current_screen
    
    def get_last_action(self) -> Optional[GUIAction]:
        """获取最后执行的动作
        
        Returns:
            Optional[GUIAction]: 最后执行的动作
        """
        return self.state.last_action
    
    def get_action_history(self) -> List[GUIAction]:
        """获取动作历史
        
        Returns:
            List[GUIAction]: 动作历史列表
        """
        return self.state.action_history.copy()
    
    def clear_action_history(self):
        """清空动作历史"""
        self.state.action_history.clear()
        self.logger.info("Action history cleared")
    
    def get_session_duration(self) -> Optional[float]:
        """获取会话持续时间
        
        Returns:
            Optional[float]: 会话持续时间（秒），如果会话未开始返回None
        """
        if self.state.session_start_time is None:
            return None
        return time.time() - self.state.session_start_time
    
    def validate_action(self, action: GUIAction) -> Tuple[bool, str]:
        """验证动作是否有效
        
        Args:
            action: 要验证的动作
            
        Returns:
            Tuple[bool, str]: (是否有效, 错误信息)
        """
        # 检查动作类型是否支持
        if not self.action_space.is_action_supported(action.action_type):
            return False, f"Action type {action.action_type.value} is not supported"
        
        # 检查动作参数是否有效
        if not action.validate():
            return False, "Action parameters are invalid"
        
        # 检查目标元素是否存在（如果指定了）
        if action.target_element_id and self.state.current_screen:
            element = self.state.current_screen.element_tree.get_element(action.target_element_id)
            if not element:
                return False, f"Target element {action.target_element_id} not found"
            
            # 检查元素是否可交互
            if not element.is_interactable():
                return False, f"Target element {action.target_element_id} is not interactable"
        
        return True, ""
    
    async def execute_action_safe(self, action: GUIAction) -> Dict[str, Any]:
        """安全执行动作（包含验证和错误处理）
        
        Args:
            action: 要执行的动作
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        # 验证动作
        is_valid, error_msg = self.validate_action(action)
        if not is_valid:
            self.logger.error(f"Action validation failed: {error_msg}")
            return {
                "success": False,
                "error": error_msg,
                "action": action.to_dict()
            }
        
        try:
            # 执行动作
            self.logger.info(f"Executing action: {action.action_type.value}")
            result = await self.execute_action(action)
            
            # 更新状态
            self.state.last_action = action
            self.state.action_history.append(action)
            
            # 添加动作延迟
            if self.config.action_delay > 0:
                await self._sleep(self.config.action_delay)
            
            # 自动更新屏幕状态
            if self.config.auto_screenshot and action.action_type != ActionType.SCREENSHOT:
                try:
                    self.state.current_screen = await self.get_screen_state()
                except Exception as e:
                    self.logger.warning(f"Failed to update screen state after action: {e}")
            
            self.logger.info(f"Action executed successfully: {action.action_type.value}")
            return result
            
        except Exception as e:
            self.state.error_count += 1
            self.logger.error(f"Action execution failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "action": action.to_dict()
            }
    
    async def execute_action_sequence(self, actions: List[GUIAction]) -> List[Dict[str, Any]]:
        """执行动作序列
        
        Args:
            actions: 动作列表
            
        Returns:
            List[Dict[str, Any]]: 执行结果列表
        """
        results = []
        
        for i, action in enumerate(actions):
            self.logger.info(f"Executing action {i+1}/{len(actions)}: {action.action_type.value}")
            result = await self.execute_action_safe(action)
            results.append(result)
            
            # 如果动作失败，根据配置决定是否继续
            if not result.get("success", False):
                self.logger.error(f"Action {i+1} failed, stopping sequence")
                break
        
        return results
    
    async def reset(self) -> bool:
        """重置环境状态
        
        Returns:
            bool: 重置是否成功
        """
        try:
            # 清空状态
            self.state.current_screen = None
            self.state.last_action = None
            self.state.action_history.clear()
            self.state.error_count = 0
            self.state.metadata.clear()
            
            # 重新获取屏幕状态
            if self.state.is_connected:
                self.state.current_screen = await self.get_screen_state()
            
            self.logger.info("Environment reset successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"Environment reset failed: {e}")
            return False
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取环境统计信息
        
        Returns:
            Dict[str, Any]: 统计信息
        """
        return {
            "is_connected": self.state.is_connected,
            "total_actions": len(self.state.action_history),
            "error_count": self.state.error_count,
            "session_duration": self.get_session_duration(),
            "last_action_type": self.state.last_action.action_type.value if self.state.last_action else None,
            "current_app": self.state.current_screen.app_package if self.state.current_screen else None,
            "platform": self.config.platform
        }
    
    async def _sleep(self, duration: float):
        """异步睡眠
        
        Args:
            duration: 睡眠时间（秒）
        """
        import asyncio
        await asyncio.sleep(duration)
    
    def __enter__(self):
        """上下文管理器入口"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        # 在同步上下文中，我们只能记录，不能执行异步断开
        if self.state.is_connected:
            self.logger.warning("Environment still connected when exiting context. Please call disconnect() explicitly.")
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口"""
        if self.state.is_connected:
            await self.disconnect()