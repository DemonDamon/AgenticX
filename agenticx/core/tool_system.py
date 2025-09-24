"""
工具系统整合模块

提供统一的工具系统接口，整合所有工具相关组件。
"""

import asyncio
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from .tool_v2 import BaseTool, ToolMetadata, ToolParameter, ToolResult, ToolContext
from uuid import uuid4
from .registry import ToolRegistry, ToolFactory, get_registry as get_tool_registry, get_factory as get_tool_factory
from .executor import ToolExecutor, ExecutionConfig, get_executor as get_tool_executor
from .security import SecurityManager, get_security_manager
from .adapters import ProtocolAdapter, create_multi_protocol_adapter
from .marketplace import ToolMarketplace, get_marketplace


@dataclass
class ToolSystemConfig:
    """工具系统配置"""
    enable_security: bool = True
    enable_marketplace: bool = True
    enable_protocol_adapters: bool = True
    enable_sandbox: bool = True
    max_concurrent_executions: int = 10
    execution_timeout: float = 30.0
    security_level: str = "medium"


class ToolSystem:
    """统一的工具系统管理器"""
    
    def __init__(self, config: Optional[ToolSystemConfig] = None):
        self.config = config or ToolSystemConfig()
        
        # 初始化核心组件
        self.registry = get_tool_registry()
        self.factory = get_tool_factory()
        self.executor = get_tool_executor()
        
        if self.config.enable_security:
            self.security_manager = get_security_manager()
        else:
            self.security_manager = None
            
        if self.config.enable_marketplace:
            self.marketplace = get_marketplace()
        else:
            self.marketplace = None
            
        if self.config.enable_protocol_adapters:
            self.protocol_adapter = create_multi_protocol_adapter()
        else:
            self.protocol_adapter = None
    
    def register_tool(self, tool: BaseTool) -> bool:
        """注册工具"""
        return self.registry.register_tool(tool)
    
    def unregister_tool(self, tool_name: str) -> bool:
        """注销工具"""
        return self.registry.unregister(tool_name)
    
    def get_tool(self, tool_name: str) -> Optional[BaseTool]:
        """获取工具"""
        return self.registry.get_tool(tool_name)
    
    def list_tools(self, category: Optional[str] = None) -> List[ToolMetadata]:
        """列出工具"""
        return self.registry.list_tools(category)
    
    def execute_tool(self, tool_name: str, parameters: Dict[str, Any], 
                    context: Optional[ToolContext] = None) -> ToolResult:
        """执行工具"""
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        return self.executor.execute(tool, parameters, context)
    
    async def execute_tool_async(self, tool_name: str, parameters: Dict[str, Any],
                                context: Optional[ToolContext] = None) -> ToolResult:
        """异步执行工具"""
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        # 如果没有提供上下文，创建默认上下文
        if context is None:
            context = ToolContext(execution_id=str(uuid4()))
        
        # 如果执行器没有异步方法，使用同步方法并在异步上下文中执行
        try:
            return await self.executor.execute_async(tool, parameters, context)
        except AttributeError:
            # 降级到同步执行
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self.executor.execute, tool, parameters, context)
    
    def check_security(self, tool_name: str, action: str, 
                      context: Optional[ToolContext] = None) -> bool:
        """检查安全权限"""
        if not self.security_manager:
            return True
        
        return self.security_manager.check_permission(tool_name, action, context)
    
    def install_tool_from_marketplace(self, tool_id: str, 
                                     version: Optional[str] = None) -> bool:
        """从市场安装工具"""
        if not self.marketplace:
            raise RuntimeError("Marketplace is not enabled")
        
        return self.marketplace.install_tool(tool_id, version)
    
    def publish_tool_to_marketplace(self, tool: BaseTool, 
                                   metadata: Optional[Dict[str, Any]] = None) -> bool:
        """发布工具到市场"""
        if not self.marketplace:
            raise RuntimeError("Marketplace is not enabled")
        
        return self.marketplace.publish_tool(tool, metadata)
    
    def get_tool_info(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """获取工具信息"""
        tool_info = self.registry.get_tool_info(tool_name)
        if not tool_info:
            return None
        
        metadata = tool_info.metadata
        
        info = {
            "name": metadata.name,
            "description": metadata.description,
            "category": metadata.category.value,
            "version": metadata.version,
            "parameters": {
                name: {
                    "type": param.type.value,
                    "description": param.description,
                    "required": param.required,
                    "default": param.default,
                    "enum": param.enum,
                    "min": param.min,
                    "max": param.max,
                    "pattern": param.pattern
                }
                for name, param in tool_info.tool_class().parameters.items()
            }
        }
        
        # 添加执行统计信息
        try:
            stats = self.executor.get_execution_stats(tool_name)
            if stats:
                info["execution_stats"] = stats
        except AttributeError:
            # 如果执行器没有统计功能，跳过
            pass
        
        return info
    
    def search_tools(self, query: str, category: Optional[str] = None,
                    tags: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """搜索工具"""
        results = []
        
        # 搜索本地注册表
        local_tools = self.registry.search_tools(query, category, tags)
        for metadata in local_tools:
            results.append({
                "name": metadata["name"],
                "description": metadata["description"],
                "category": metadata["category"],
                "tags": metadata["tags"],
                "source": "local",
                "installed": True
            })
        
        # 搜索市场（如果启用）
        if self.marketplace:
            try:
                marketplace_tools = self.marketplace.search_tools(query, category, tags)
                for listing in marketplace_tools:
                    # 避免重复
                    if not any(r["name"] == listing.manifest.name for r in results):
                        results.append({
                            "name": listing.manifest.name,
                            "description": listing.manifest.description,
                            "category": listing.manifest.category,
                            "tags": listing.manifest.tags,
                            "source": "marketplace",
                            "installed": False,
                            "rating": listing.rating,
                            "download_count": listing.download_count
                        })
            except Exception:
                # 市场搜索失败时不影响本地搜索结果
                pass
        
        return results
    
    def _create_executor(self) -> 'ToolExecutor':
        """Create tool executor based on config."""
        from .executor import ToolExecutor, ExecutionConfig
        
        return ToolExecutor(config=ExecutionConfig(**self.config.executor_config), registry=self.registry)
    
    def get_system_status(self) -> Dict[str, Any]:
        """获取系统状态"""
        executor_stats = self.executor.get_statistics()
        status = {
            "registry": {
                "total_tools": len(self.registry.list_tools()),
                "categories": len(self.registry.get_categories()),
                "status": "active"
            },
            "executor": {
                "active_executions": executor_stats.get("active_executions", 0),
                "total_executions": executor_stats.get("total_executions", 0),
                "status": "active"
            }
        }
        
        if self.security_manager:
            status["security"] = {
                "level": self.config.security_level,
                "total_policies": len(self.security_manager.list_policies()),
                "audit_log_size": len(self.security_manager._audit_log),
                "status": "active"
            }
        
        if self.marketplace:
            status["marketplace"] = {
                "installed_tools": len(self.marketplace.list_installed_tools()),
                "status": "active"
            }
        
        return status
    
    def shutdown(self):
        """关闭系统"""
        if self.executor:
            self.executor.shutdown()
        
        if self.security_manager:
            self.security_manager.shutdown()
        
        if self.marketplace:
            self.marketplace.shutdown()


# 全局工具系统实例
_global_tool_system: Optional[ToolSystem] = None


def create_tool_system(config: Optional[ToolSystemConfig] = None) -> ToolSystem:
    """创建工具系统实例"""
    global _global_tool_system
    _global_tool_system = ToolSystem(config)
    return _global_tool_system


def get_tool_system() -> ToolSystem:
    """获取全局工具系统实例"""
    global _global_tool_system
    if _global_tool_system is None:
        _global_tool_system = ToolSystem()
    return _global_tool_system


def shutdown_tool_system():
    """关闭全局工具系统"""
    global _global_tool_system
    if _global_tool_system:
        _global_tool_system.shutdown()
        _global_tool_system = None