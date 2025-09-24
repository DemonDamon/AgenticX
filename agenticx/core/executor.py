"""
AgenticX Tool Execution Engine

This module provides the execution engine for running tools with safety,
performance, and reliability features including sandboxing, retry logic,
and comprehensive error handling.
"""

import asyncio
import concurrent.futures
import contextlib
import logging
import signal
import threading
import time
import traceback
from typing import Any, Dict, List, Optional, Callable, Union, Type
from dataclasses import dataclass, field
from datetime import datetime
import os
import sys
import resource
import subprocess
import tempfile
import json

from .tool_v2 import BaseTool, ToolResult, ToolContext, ToolStatus
from .registry import ToolRegistry


class ExecutionError(Exception):
    """Base execution error."""
    pass


class TimeoutError(ExecutionError):
    """Execution timeout error."""
    pass


class SandboxingError(ExecutionError):
    """Sandboxing error."""
    pass


class ResourceLimitError(ExecutionError):
    """Resource limit exceeded error."""
    pass


@dataclass
class ExecutionConfig:
    """Execution configuration."""
    timeout: int = 30  # seconds
    max_retries: int = 3
    retry_delay: float = 1.0
    enable_sandbox: bool = True
    enable_resource_limits: bool = True
    max_memory_mb: int = 512  # MB
    max_cpu_time: float = 60.0  # seconds
    enable_network_isolation: bool = False
    allowed_imports: List[str] = field(default_factory=lambda: ['math', 'json', 'datetime'])
    blocked_imports: List[str] = field(default_factory=lambda: ['os', 'sys', 'subprocess'])
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'timeout': self.timeout,
            'max_retries': self.max_retries,
            'retry_delay': self.retry_delay,
            'enable_sandbox': self.enable_sandbox,
            'enable_resource_limits': self.enable_resource_limits,
            'max_memory_mb': self.max_memory_mb,
            'max_cpu_time': self.max_cpu_time,
            'enable_network_isolation': self.enable_network_isolation,
            'allowed_imports': self.allowed_imports,
            'blocked_imports': self.blocked_imports
        }


@dataclass
class ExecutionMetrics:
    """Execution metrics."""
    execution_time: float = 0.0
    cpu_time: float = 0.0
    memory_usage: int = 0
    retry_count: int = 0
    queue_time: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'execution_time': self.execution_time,
            'cpu_time': self.cpu_time,
            'memory_usage': self.memory_usage,
            'retry_count': self.retry_count,
            'queue_time': self.queue_time
        }


class ResourceMonitor:
    """Monitors resource usage during execution."""
    
    def __init__(self, config: ExecutionConfig):
        self.config = config
        self.start_time = 0.0
        self.start_memory = 0
        self.peak_memory = 0
        self.cpu_time_start = 0.0
        self._monitoring = False
        self._thread = None
        self._stop_event = threading.Event()
    
    def start_monitoring(self):
        """Start resource monitoring."""
        if not self.config.enable_resource_limits:
            return
        
        self.start_time = time.time()
        self.start_memory = self._get_memory_usage()
        self.peak_memory = self.start_memory
        self.cpu_time_start = time.process_time()
        self._monitoring = True
        self._stop_event.clear()
        
        # Start monitoring thread
        self._thread = threading.Thread(target=self._monitor_loop)
        self._thread.daemon = True
        self._thread.start()
    
    def stop_monitoring(self) -> ExecutionMetrics:
        """Stop monitoring and return metrics."""
        if not self._monitoring:
            return ExecutionMetrics()
        
        self._monitoring = False
        self._stop_event.set()
        
        if self._thread:
            self._thread.join(timeout=1.0)
        
        end_time = time.time()
        end_cpu_time = time.process_time()
        
        metrics = ExecutionMetrics(
            execution_time=end_time - self.start_time,
            cpu_time=end_cpu_time - self.cpu_time_start,
            memory_usage=self.peak_memory - self.start_memory
        )
        
        return metrics
    
    def _monitor_loop(self):
        """Monitoring loop."""
        while self._monitoring and not self._stop_event.is_set():
            try:
                current_memory = self._get_memory_usage()
                self.peak_memory = max(self.peak_memory, current_memory)
                
                # Check memory limit
                memory_usage_mb = (current_memory - self.start_memory) / 1024 / 1024
                if memory_usage_mb > self.config.max_memory_mb:
                    raise ResourceLimitError(f"Memory limit exceeded: {memory_usage_mb:.1f}MB > {self.config.max_memory_mb}MB")
                
                # Check CPU time limit
                cpu_time = time.process_time() - self.cpu_time_start
                if cpu_time > self.config.max_cpu_time:
                    raise ResourceLimitError(f"CPU time limit exceeded: {cpu_time:.1f}s > {self.config.max_cpu_time}s")
                
                time.sleep(0.1)  # Check every 100ms
                
            except Exception as e:
                self._logger = logging.getLogger("agenticx.executor.monitor")
                self._logger.error(f"Monitoring error: {e}")
                break
    
    def _get_memory_usage(self) -> int:
        """Get current memory usage."""
        try:
            import psutil
            process = psutil.Process()
            return process.memory_info().rss
        except ImportError:
            # Fallback for systems without psutil
            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024


class SandboxedEnvironment:
    """Provides sandboxed execution environment."""
    
    def __init__(self, config: ExecutionConfig):
        self.config = config
        self._logger = logging.getLogger("agenticx.executor.sandbox")
        self._temp_dir = None
    
    def __enter__(self):
        """Enter sandbox context."""
        if not self.config.enable_sandbox:
            return self
        
        # Create temporary directory
        self._temp_dir = tempfile.mkdtemp(prefix="agenticx_sandbox_")
        
        # Set up resource limits
        if self.config.enable_resource_limits:
            self._setup_resource_limits()
        
        self._logger.info(f"Entered sandbox environment: {self._temp_dir}")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit sandbox context."""
        if not self.config.enable_sandbox:
            return
        
        # Clean up temporary directory
        if self._temp_dir and os.path.exists(self._temp_dir):
            import shutil
            shutil.rmtree(self._temp_dir, ignore_errors=True)
        
        self._logger.info("Exited sandbox environment")
    
    def _setup_resource_limits(self):
        """Set up resource limits."""
        try:
            # Memory limit
            memory_bytes = self.config.max_memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            
            # CPU time limit
            resource.setrlimit(resource.RLIMIT_CPU, (int(self.config.max_cpu_time), int(self.config.max_cpu_time)))
            
            # File descriptor limit
            resource.setrlimit(resource.RLIMIT_NOFILE, (1024, 1024))
            
        except (resource.error, ValueError) as e:
            self._logger.warning(f"Failed to set resource limits: {e}")
    
    def execute_code(self, code: str, globals_dict: Optional[Dict[str, Any]] = None) -> Any:
        """Execute code in sandboxed environment."""
        if not self.config.enable_sandbox:
            # Execute directly without sandbox
            exec_globals = globals_dict or {}
            exec_locals = {}
            exec(code, exec_globals, exec_locals)
            return exec_locals
        
        # Create restricted globals
        safe_globals = {
            '__builtins__': self._get_safe_builtins(),
            '__name__': '__sandbox__',
            '__file__': '<sandbox>',
            '__package__': None,
        }
        
        if globals_dict:
            safe_globals.update(globals_dict)
        
        safe_locals = {}
        
        try:
            exec(code, safe_globals, safe_locals)
            return safe_locals
        except Exception as e:
            raise SandboxingError(f"Sandboxed execution failed: {e}")
    
    def _get_safe_builtins(self) -> Dict[str, Any]:
        """Get safe built-ins for sandboxed execution."""
        safe_builtins = {
            'len': len,
            'range': range,
            'enumerate': enumerate,
            'zip': zip,
            'map': map,
            'filter': filter,
            'sum': sum,
            'min': min,
            'max': max,
            'abs': abs,
            'round': round,
            'pow': pow,
            'bool': bool,
            'int': int,
            'float': float,
            'str': str,
            'list': list,
            'dict': dict,
            'tuple': tuple,
            'set': set,
            'type': type,
            'isinstance': isinstance,
            'issubclass': issubclass,
            'print': print,
            'repr': repr,
            'sorted': sorted,
            'reversed': reversed,
            'all': all,
            'any': any,
            'next': next,
            'iter': iter,
            'Exception': Exception,
            'ValueError': ValueError,
            'TypeError': TypeError,
            'KeyError': KeyError,
            'IndexError': IndexError,
            'AttributeError': AttributeError,
        }
        
        return safe_builtins


class ToolExecutor:
    """
    Tool execution engine with safety, performance, and reliability features.
    """
    
    def __init__(self, registry: ToolRegistry, config: Optional[ExecutionConfig] = None):
        self.registry = registry
        self.config = config or ExecutionConfig()
        self._logger = logging.getLogger("agenticx.executor")
        self._execution_stats = {
            'total_executions': 0,
            'successful_executions': 0,
            'failed_executions': 0,
            'timeout_executions': 0,
            'sandbox_violations': 0,
            'resource_limit_violations': 0
        }
        self._stats_lock = threading.Lock()
    
    def shutdown(self):
        """Shutdown the executor."""
        self._logger.info("Shutting down tool executor")
        # Cleanup resources if needed
    
    def execute(self, tool_name: str, parameters: Dict[str, Any], 
               context: ToolContext, config_override: Optional[ExecutionConfig] = None) -> ToolResult:
        """
        Execute a tool synchronously.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Tool parameters
            context: Execution context
            config_override: Optional execution configuration override
            
        Returns:
            Tool execution result
        """
        config = config_override or self.config
        execution_id = context.execution_id
        
        self._logger.info(f"Starting synchronous execution of '{tool_name}' (ID: {execution_id})")
        
        start_time = time.time()
        
        try:
            # Get tool from registry
            tool = self.registry.get_tool(tool_name)
            if not tool:
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=f"Tool '{tool_name}' not found",
                    metadata={"tool_name": tool_name}
                )
            
            # Validate parameters
            try:
                validated_params = tool.validate_parameters(parameters)
            except ValueError as e:
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=f"Parameter validation failed: {e}",
                    metadata={"tool_name": tool_name}
                )
            
            # Execute with retry logic
            result = self._execute_with_retry(tool, validated_params, context, config)
            
            # Update statistics
            self._update_statistics(result.status)
            
            execution_time = time.time() - start_time
            result.execution_time = execution_time
            result.end_time = datetime.now()
            
            self._logger.info(f"Completed execution of '{tool_name}' in {execution_time:.2f}s with status {result.status}")
            
            return result
            
        except Exception as e:
            self._logger.error(f"Unexpected error executing '{tool_name}': {e}")
            self._update_statistics(ToolStatus.FAILED)
            
            return ToolResult(
                status=ToolStatus.FAILED,
                error=f"Unexpected error: {str(e)}",
                metadata={"tool_name": tool_name, "traceback": traceback.format_exc()}
            )
    
    async def aexecute(self, tool_name: str, parameters: Dict[str, Any],
                       context: ToolContext, config_override: Optional[ExecutionConfig] = None) -> ToolResult:
        """
        Execute a tool asynchronously.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Tool parameters
            context: Execution context
            config_override: Optional execution configuration override
            
        Returns:
            Tool execution result
        """
        config = config_override or self.config
        execution_id = context.execution_id
        
        self._logger.info(f"Starting asynchronous execution of '{tool_name}' (ID: {execution_id})")
        
        start_time = time.time()
        
        try:
            # Get tool from registry
            tool = self.registry.get_tool(tool_name)
            if not tool:
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=f"Tool '{tool_name}' not found",
                    metadata={"tool_name": tool_name}
                )
            
            # Validate parameters asynchronously
            try:
                validated_params = await tool.validate_parameters_async(parameters)
            except ValueError as e:
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=f"Parameter validation failed: {e}",
                    metadata={"tool_name": tool_name}
                )
            
            # Execute with retry logic
            result = await self._aexecute_with_retry(tool, validated_params, context, config)
            
            # Update statistics
            self._update_statistics(result.status)
            
            execution_time = time.time() - start_time
            result.execution_time = execution_time
            result.end_time = datetime.now()
            
            self._logger.info(f"Completed async execution of '{tool_name}' in {execution_time:.2f}s with status {result.status}")
            
            return result
            
        except Exception as e:
            self._logger.error(f"Unexpected error in async execution of '{tool_name}': {e}")
            self._update_statistics(ToolStatus.FAILED)
            
            return ToolResult(
                status=ToolStatus.FAILED,
                error=f"Unexpected error: {str(e)}",
                metadata={"tool_name": tool_name, "traceback": traceback.format_exc()}
            )
    
    def _execute_with_retry(self, tool: BaseTool, parameters: Dict[str, Any],
                           context: ToolContext, config: ExecutionConfig) -> ToolResult:
        """Execute tool with retry logic."""
        last_error = None
        
        for attempt in range(config.max_retries + 1):
            try:
                # Execute in sandbox if required
                if config.enable_sandbox or tool.metadata.sandbox_required:
                    result = self._execute_in_sandbox(tool, parameters, context, config)
                else:
                    result = self._execute_direct(tool, parameters, context, config)
                
                # Update retry count in result
                if hasattr(result, 'metadata'):
                    result.metadata['retry_count'] = attempt
                
                return result
                
            except (TimeoutError, ResourceLimitError, SandboxingError) as e:
                # Don't retry on these errors
                self._logger.warning(f"Non-retryable error on attempt {attempt + 1}: {e}")
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=str(e),
                    metadata={"retry_count": attempt, "error_type": type(e).__name__}
                )
                
            except Exception as e:
                last_error = e
                self._logger.warning(f"Attempt {attempt + 1} failed: {e}")
                
                if attempt < config.max_retries:
                    time.sleep(config.retry_delay * (2 ** attempt))  # Exponential backoff
                else:
                    break
        
        # All retries exhausted
        return ToolResult(
            status=ToolStatus.FAILED,
            error=f"All retry attempts failed. Last error: {last_error}",
            metadata={"retry_count": config.max_retries}
        )
    
    async def _aexecute_with_retry(self, tool: BaseTool, parameters: Dict[str, Any],
                                  context: ToolContext, config: ExecutionConfig) -> ToolResult:
        """Execute tool asynchronously with retry logic."""
        last_error = None
        
        for attempt in range(config.max_retries + 1):
            try:
                # Execute asynchronously
                result = await self._execute_async_direct(tool, parameters, context, config)
                
                # Update retry count in result
                if hasattr(result, 'metadata'):
                    result.metadata['retry_count'] = attempt
                
                return result
                
            except (TimeoutError, ResourceLimitError, SandboxingError) as e:
                # Don't retry on these errors
                self._logger.warning(f"Non-retryable error on async attempt {attempt + 1}: {e}")
                return ToolResult(
                    status=ToolStatus.FAILED,
                    error=str(e),
                    metadata={"retry_count": attempt, "error_type": type(e).__name__}
                )
                
            except Exception as e:
                last_error = e
                self._logger.warning(f"Async attempt {attempt + 1} failed: {e}")
                
                if attempt < config.max_retries:
                    await asyncio.sleep(config.retry_delay * (2 ** attempt))  # Exponential backoff
                else:
                    break
        
        # All retries exhausted
        return ToolResult(
            status=ToolStatus.FAILED,
            error=f"All async retry attempts failed. Last error: {last_error}",
            metadata={"retry_count": config.max_retries}
        )
    
    def _execute_direct(self, tool: BaseTool, parameters: Dict[str, Any],
                       context: ToolContext, config: ExecutionConfig) -> ToolResult:
        """Execute tool directly without sandbox."""
        monitor = ResourceMonitor(config)
        
        try:
            monitor.start_monitoring()
            
            # Execute with timeout
            with self._timeout_context(config.timeout):
                result = tool.execute(parameters, context)
            
            # Stop monitoring and get metrics
            metrics = monitor.stop_monitoring()
            result.metadata.update(metrics.to_dict())
            
            return result
            
        except TimeoutError as e:
            monitor.stop_monitoring()
            self._update_timeout_stats()
            return ToolResult(
                status=ToolStatus.TIMEOUT,
                error=str(e),
                metadata={"timeout": config.timeout}
            )
            
        except ResourceLimitError as e:
            monitor.stop_monitoring()
            self._update_resource_limit_stats()
            return ToolResult(
                status=ToolStatus.FAILED,
                error=str(e),
                metadata={"resource_limit_exceeded": True}
            )
            
        except Exception as e:
            monitor.stop_monitoring()
            return ToolResult(
                status=ToolStatus.FAILED,
                error=f"Execution failed: {str(e)}",
                metadata={"traceback": traceback.format_exc()}
            )
    
    def _execute_in_sandbox(self, tool: BaseTool, parameters: Dict[str, Any],
                           context: ToolContext, config: ExecutionConfig) -> ToolResult:
        """Execute tool in sandboxed environment."""
        with SandboxedEnvironment(config) as sandbox:
            # For now, delegate to direct execution
            # In a full implementation, this would isolate the tool execution
            return self._execute_direct(tool, parameters, context, config)
    
    async def _execute_async_direct(self, tool: BaseTool, parameters: Dict[str, Any],
                                   context: ToolContext, config: ExecutionConfig) -> ToolResult:
        """Execute tool asynchronously."""
        # For async execution, we use the sync version but run it in a thread pool
        loop = asyncio.get_event_loop()
        
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = loop.run_in_executor(
                executor,
                self._execute_direct,
                tool, parameters, context, config
            )
            
            try:
                result = await asyncio.wait_for(future, timeout=config.timeout)
                return result
            except asyncio.TimeoutError:
                return ToolResult(
                    status=ToolStatus.TIMEOUT,
                    error=f"Async execution timeout after {config.timeout}s",
                    metadata={"timeout": config.timeout}
                )
    
    @contextlib.contextmanager
    def _timeout_context(self, timeout: int):
        """Context manager for execution timeout."""
        def timeout_handler(signum, frame):
            raise TimeoutError(f"Execution timeout after {timeout}s")
        
        # Set up signal handler (Unix only)
        if hasattr(signal, 'SIGALRM'):
            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(timeout)
            
            try:
                yield
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
        else:
            # Fallback for non-Unix systems
            start_time = time.time()
            yield
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Execution timeout after {timeout}s")
    
    def _update_statistics(self, status: ToolStatus):
        """Update execution statistics."""
        with self._stats_lock:
            self._execution_stats['total_executions'] += 1
            
            if status == ToolStatus.SUCCESS:
                self._execution_stats['successful_executions'] += 1
            elif status == ToolStatus.FAILED:
                self._execution_stats['failed_executions'] += 1
            elif status == ToolStatus.TIMEOUT:
                self._execution_stats['timeout_executions'] += 1
    
    def _update_timeout_stats(self):
        """Update timeout statistics."""
        with self._stats_lock:
            self._execution_stats['timeout_executions'] += 1
    
    def _update_resource_limit_stats(self):
        """Update resource limit statistics."""
        with self._stats_lock:
            self._execution_stats['resource_limit_violations'] += 1
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get execution statistics."""
        with self._stats_lock:
            return self._execution_stats.copy()
    
    def reset_statistics(self):
        """Reset execution statistics."""
        with self._stats_lock:
            for key in self._execution_stats:
                self._execution_stats[key] = 0


# Global executor instance
_global_executor = None


def get_executor(registry: Optional[ToolRegistry] = None, 
                config: Optional[ExecutionConfig] = None) -> ToolExecutor:
    """Get the global tool executor."""
    global _global_executor
    
    if _global_executor is None:
        from .registry import get_registry
        reg = registry or get_registry()
        _global_executor = ToolExecutor(reg, config)
    
    return _global_executor


def execute_tool(tool_name: str, parameters: Dict[str, Any], 
                context: ToolContext, **kwargs) -> ToolResult:
    """Convenience function to execute a tool."""
    executor = get_executor()
    return executor.execute(tool_name, parameters, context, **kwargs)


async def aexecute_tool(tool_name: str, parameters: Dict[str, Any],
                         context: ToolContext, **kwargs) -> ToolResult:
    """Convenience function to execute a tool asynchronously."""
    executor = get_executor()
    return await executor.aexecute(tool_name, parameters, context, **kwargs)