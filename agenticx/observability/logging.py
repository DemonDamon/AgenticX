"""
AgenticX M9: 日志记录系统 (Logging System)

本模块实现了结构化日志记录功能，将执行事件转换为可读的日志输出。
支持多种日志格式和级别，为调试和监控提供重要信息。
"""

import json
import logging
from typing import Dict, Any, Optional, Union, TextIO
from enum import Enum
from datetime import datetime, UTC
from pathlib import Path
import sys

from .callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..core.event import AnyEvent, ErrorEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent
from ..core.agent import Agent
from ..core.task import Task
from ..core.workflow import Workflow
from ..llms.response import LLMResponse


def get_logger(name=None):
    """
    获取日志记录器
    
    Args:
        name: 日志记录器名称
        
    Returns:
        logging.Logger: 配置好的日志记录器
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = ColoredFormatter()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


class ColoredFormatter(logging.Formatter):
    """彩色日志格式化器"""

    COLORS = {
        'DEBUG': '\033[36m',      # 青色
        'INFO': '\033[32m',       # 绿色
        'WARNING': '\033[33m',    # 黄色
        'ERROR': '\033[31m',      # 红色
        'CRITICAL': '\033[35m',   # 紫色
        'RESET': '\033[0m',       # 重置
        'TIMESTAMP': '\033[36m',  # 青色
        'MODULE': '\033[35m',     # 粉色
        'MESSAGE': '\033[37m',    # 白色
    }

    def __init__(self):
        super().__init__(
            fmt='[%(asctime)s][%(levelname)s][%(name)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

    def format(self, record):
        original = super().format(record)
        # 添加颜色
        colored = original.replace(
            '[', f'{self.COLORS["TIMESTAMP"]}['
        ).replace(
            ']', f']{self.COLORS["RESET"]}'
        )
        # 为不同级别添加颜色
        level_color = self.COLORS.get(record.levelname, self.COLORS['INFO'])
        colored = colored.replace(
            f'[{record.levelname}]', 
            f'{level_color}[{record.levelname}]{self.COLORS["RESET"]}'
        )
        # 为模块名添加颜色
        if record.name:
            colored = colored.replace(
                f'[{record.name}]', 
                f'{self.COLORS["MODULE"]}[{record.name}]{self.COLORS["RESET"]}'
            )
        return colored


class LogLevel(Enum):
    """日志级别"""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class LogFormat(Enum):
    """日志格式"""
    PLAIN = "plain"        # 纯文本格式
    JSON = "json"          # JSON格式
    STRUCTURED = "structured"  # 结构化格式
    XML = "xml"            # XML格式


class StructuredLogger:
    """
    结构化日志记录器
    
    提供统一的日志记录接口，支持多种输出格式。
    """
    
    def __init__(self, 
                 name: str = "agenticx",
                 level: LogLevel = LogLevel.INFO,
                 format_type: LogFormat = LogFormat.STRUCTURED,
                 output_file: Optional[str] = None,
                 console_output: bool = True):
        self.name = name
        self.level = level
        self.format_type = format_type
        self.output_file = output_file
        self.console_output = console_output
        
        # 创建Python logger
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.value))
        
        # 配置处理器
        self._setup_handlers()
        
    def _setup_handlers(self):
        """设置日志处理器"""
        # 清除现有处理器
        self.logger.handlers.clear()
        
        # 创建格式化器
        formatter = self._create_formatter()
        
        # 控制台处理器
        if self.console_output:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setFormatter(formatter)
            self.logger.addHandler(console_handler)
        
        # 文件处理器
        if self.output_file:
            file_handler = logging.FileHandler(self.output_file)
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)
    
    def _create_formatter(self) -> logging.Formatter:
        """创建日志格式化器"""
        if self.format_type == LogFormat.JSON:
            return JsonFormatter()
        elif self.format_type == LogFormat.STRUCTURED:
            return StructuredFormatter()
        elif self.format_type == LogFormat.XML:
            return XmlFormatter()
        else:
            return logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
    
    def log(self, level: LogLevel, message: str, data: Optional[Dict[str, Any]] = None):
        """记录日志"""
        log_data = {
            "message": message,
            "timestamp": datetime.now(UTC).isoformat(),
            "level": level.value,
            "logger": self.name
        }
        
        if data:
            log_data.update(data)
        
        # 根据级别调用对应的方法 (修复：使用extra参数传递额外数据)
        if level == LogLevel.DEBUG:
            self.logger.debug(message, extra=log_data)
        elif level == LogLevel.INFO:
            self.logger.info(message, extra=log_data)
        elif level == LogLevel.WARNING:
            self.logger.warning(message, extra=log_data)
        elif level == LogLevel.ERROR:
            self.logger.error(message, extra=log_data)
        elif level == LogLevel.CRITICAL:
            self.logger.critical(message, extra=log_data)
    
    def debug(self, message: str, data: Optional[Dict[str, Any]] = None):
        """记录调试日志"""
        self.log(LogLevel.DEBUG, message, data)
    
    def info(self, message: str, data: Optional[Dict[str, Any]] = None):
        """记录信息日志"""
        self.log(LogLevel.INFO, message, data)
    
    def warning(self, message: str, data: Optional[Dict[str, Any]] = None):
        """记录警告日志"""
        self.log(LogLevel.WARNING, message, data)
    
    def error(self, message: str, data: Optional[Dict[str, Any]] = None):
        """记录错误日志"""
        self.log(LogLevel.ERROR, message, data)
    
    def critical(self, message: str, data: Optional[Dict[str, Any]] = None):
        """记录严重错误日志"""
        self.log(LogLevel.CRITICAL, message, data)


class JsonFormatter(logging.Formatter):
    """JSON格式化器"""
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno
        }
        
        # 添加额外数据 (修复：正确访问extra参数传递的数据)
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'levelname', 'levelno', 'pathname', 
                          'filename', 'module', 'lineno', 'funcName', 'created', 
                          'msecs', 'relativeCreated', 'thread', 'threadName', 
                          'processName', 'process', 'getMessage', 'exc_info', 
                          'exc_text', 'stack_info', 'formatter']:
                log_data[key] = value
        
        return json.dumps(log_data, ensure_ascii=False, indent=2)


class StructuredFormatter(logging.Formatter):
    """结构化格式化器"""
    
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        
        # 基础信息
        message = f"[{timestamp}] {record.levelname} - {record.getMessage()}"
        
        # 添加额外数据 (修复：正确访问extra参数传递的数据)
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'levelname', 'levelno', 'pathname', 
                          'filename', 'module', 'lineno', 'funcName', 'created', 
                          'msecs', 'relativeCreated', 'thread', 'threadName', 
                          'processName', 'process', 'getMessage', 'exc_info', 
                          'exc_text', 'stack_info', 'formatter']:
                if key == 'event_type':
                    message += f" | Event: {value}"
                elif key == 'agent_id':
                    message += f" | Agent: {value}"
                elif key == 'task_id':
                    message += f" | Task: {value}"
                elif key == 'tool_name':
                    message += f" | Tool: {value}"
                elif key == 'execution_time':
                    message += f" | Time: {value:.3f}s"
        
        return message


class XmlFormatter(logging.Formatter):
    """XML格式化器"""
    
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now(UTC).isoformat()
        
        xml_parts = [
            f'<log>',
            f'  <timestamp>{timestamp}</timestamp>',
            f'  <level>{record.levelname}</level>',
            f'  <logger>{record.name}</logger>',
            f'  <message>{record.getMessage()}</message>',
            f'  <module>{record.module}</module>',
            f'  <line>{record.lineno}</line>'
        ]
        
        # 添加额外数据 (修复：正确访问extra参数传递的数据)
        extra_data = {}
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'levelname', 'levelno', 'pathname', 
                          'filename', 'module', 'lineno', 'funcName', 'created', 
                          'msecs', 'relativeCreated', 'thread', 'threadName', 
                          'processName', 'process', 'getMessage', 'exc_info', 
                          'exc_text', 'stack_info', 'formatter']:
                extra_data[key] = value
        
        if extra_data:
            xml_parts.append('  <data>')
            for key, value in extra_data.items():
                xml_parts.append(f'    <{key}>{value}</{key}>')
            xml_parts.append('  </data>')
        
        xml_parts.append('</log>')
        
        return '\n'.join(xml_parts)


class LoggingCallbackHandler(BaseCallbackHandler):
    """
    日志记录回调处理器
    
    将执行事件转换为结构化日志输出，支持多种日志格式。
    """
    
    def __init__(self, 
                 logger: Optional[StructuredLogger] = None,
                 log_level: LogLevel = LogLevel.INFO,
                 log_format: LogFormat = LogFormat.STRUCTURED,
                 output_file: Optional[str] = None,
                 console_output: bool = True,
                 include_event_data: bool = True,
                 config: Optional[CallbackHandlerConfig] = None):
        super().__init__(config)
        
        self.logger = logger or StructuredLogger(
            name="agenticx.observability",
            level=log_level,
            format_type=log_format,
            output_file=output_file,
            console_output=console_output
        )
        
        self.include_event_data = include_event_data
        self.log_level = log_level
        
        # 事件计数器
        self.event_counts = {
            "task_start": 0,
            "task_end": 0,
            "tool_call": 0,
            "tool_result": 0,
            "error": 0,
            "llm_call": 0,
            "llm_response": 0,
            "human_request": 0,
            "human_response": 0,
            "finish_task": 0
        }
    
    def on_workflow_start(self, workflow: Workflow, inputs: Dict[str, Any]):
        """工作流开始时的日志记录"""
        self.logger.info(
            f"工作流开始: {workflow.name}",
            {
                "event_type": "workflow_start",
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "inputs": inputs if self.include_event_data else "..."
            }
        )
    
    def on_workflow_end(self, workflow: Workflow, result: Dict[str, Any]):
        """工作流结束时的日志记录"""
        success = result.get("success", False)
        level = LogLevel.INFO if success else LogLevel.ERROR
        
        self.logger.log(
            level,
            f"工作流结束: {workflow.name} - {'成功' if success else '失败'}",
            {
                "event_type": "workflow_end",
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "success": success,
                "result": result if self.include_event_data else "..."
            }
        )
    
    def on_task_start(self, agent: Agent, task: Task):
        """任务开始时的日志记录"""
        self.event_counts["task_start"] += 1
        
        self.logger.info(
            f"任务开始: {task.description[:50]}...",
            {
                "event_type": "task_start",
                "task_id": task.id,
                "task_description": task.description,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "agent_role": agent.role
            }
        )
    
    def on_task_end(self, agent: Agent, task: Task, result: Dict[str, Any]):
        """任务结束时的日志记录"""
        self.event_counts["task_end"] += 1
        
        success = result.get("success", False)
        level = LogLevel.INFO if success else LogLevel.ERROR
        
        self.logger.log(
            level,
            f"任务结束: {task.description[:50]}... - {'成功' if success else '失败'}",
            {
                "event_type": "task_end",
                "task_id": task.id,
                "agent_id": agent.id,
                "success": success,
                "result": result if self.include_event_data else "...",
                "execution_time": result.get("execution_time", 0)
            }
        )
    
    def on_tool_start(self, tool_name: str, tool_args: Dict[str, Any]):
        """工具开始执行时的日志记录"""
        self.event_counts["tool_call"] += 1
        
        self.logger.debug(
            f"工具调用: {tool_name}",
            {
                "event_type": "tool_start",
                "tool_name": tool_name,
                "tool_args": tool_args if self.include_event_data else "..."
            }
        )
    
    def on_tool_end(self, tool_name: str, result: Any, success: bool):
        """工具执行结束时的日志记录"""
        self.event_counts["tool_result"] += 1
        
        level = LogLevel.DEBUG if success else LogLevel.WARNING
        
        self.logger.log(
            level,
            f"工具结果: {tool_name} - {'成功' if success else '失败'}",
            {
                "event_type": "tool_end",
                "tool_name": tool_name,
                "success": success,
                "result": str(result)[:200] if self.include_event_data else "..."
            }
        )
    
    def on_llm_call(self, prompt: str, model: str, metadata: Dict[str, Any]):
        """LLM调用时的日志记录"""
        self.event_counts["llm_call"] += 1
        
        self.logger.debug(
            f"LLM调用: {model}",
            {
                "event_type": "llm_call",
                "model": model,
                "prompt_length": len(prompt),
                "prompt": prompt[:100] + "..." if len(prompt) > 100 and self.include_event_data else "...",
                "metadata": metadata if self.include_event_data else "..."
            }
        )
    
    def on_llm_response(self, response: LLMResponse, metadata: Dict[str, Any]):
        """LLM响应时的日志记录"""
        self.event_counts["llm_response"] += 1
        
        self.logger.debug(
            f"LLM响应: {response.model_name}",
            {
                "event_type": "llm_response",
                "model": response.model_name,
                "response_length": len(response.content),
                "response": response.content[:100] + "..." if len(response.content) > 100 and self.include_event_data else "...",
                "token_usage": response.token_usage,
                "cost": response.cost
            }
        )
    
    def on_error(self, error: Exception, context: Dict[str, Any]):
        """错误发生时的日志记录"""
        self.event_counts["error"] += 1
        
        self.logger.error(
            f"执行错误: {str(error)}",
            {
                "event_type": "error",
                "error_type": type(error).__name__,
                "error_message": str(error),
                "context": context if self.include_event_data else "...",
                "recoverable": context.get("recoverable", True)
            }
        )
    
    def on_human_request(self, request: Dict[str, Any]):
        """人工请求时的日志记录"""
        self.event_counts["human_request"] += 1
        
        self.logger.info(
            f"人工请求: {request.get('type', 'unknown')}",
            {
                "event_type": "human_request",
                "request": request if self.include_event_data else "..."
            }
        )
    
    def on_human_response(self, response: Dict[str, Any]):
        """人工响应时的日志记录"""
        self.event_counts["human_response"] += 1
        
        self.logger.info(
            f"人工响应: {response.get('type', 'unknown')}",
            {
                "event_type": "human_response",
                "response": response if self.include_event_data else "..."
            }
        )
    
    def _handle_finish_task_event(self, event):
        """处理任务完成事件"""
        self.event_counts["finish_task"] += 1
        
        self.logger.info(
            f"任务完成: {event.data.get('task_id', 'unknown')}",
            {
                "event_type": "finish_task",
                "task_id": event.data.get("task_id"),
                "final_result": event.final_result if self.include_event_data else "..."
            }
        )
    
    def get_event_stats(self) -> Dict[str, Any]:
        """获取事件统计信息"""
        total_events = sum(self.event_counts.values())
        
        return {
            "total_events": total_events,
            "event_counts": self.event_counts.copy(),
            "event_percentages": {
                event_type: (count / total_events * 100) if total_events > 0 else 0
                for event_type, count in self.event_counts.items()
            }
        }
    
    def reset_stats(self):
        """重置统计信息"""
        for key in self.event_counts:
            self.event_counts[key] = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """获取处理器统计信息"""
        stats = super().get_stats()
        stats.update({
            "log_level": self.log_level.value,
            "output_file": self.logger.output_file,
            "console_output": self.logger.console_output,
            "include_event_data": self.include_event_data,
            "event_stats": self.get_event_stats()
        })
        return stats 