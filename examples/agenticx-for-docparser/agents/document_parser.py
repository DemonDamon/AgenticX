#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
文档解析智能体

基于AgenticX框架的文档解析智能体，集成MinerU工具进行PDF文档解析。
支持多种解析模式和参数配置，提供智能化的文档处理能力。
"""

import os
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

# 导入AgenticX核心模块
from agenticx.core.agent import Agent, AgentContext, AgentResult
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool

# 导入MinerU工具
from agenticx.tools.mineru import (
    ParseDocumentsTool,
    GetOCRLanguagesTool,
    MinerUParseArgs,
    MinerUOCRLanguagesArgs,
    ParseMode
)

logger = logging.getLogger(__name__)


class ParseDocumentTool(BaseTool):
    """文档解析工具"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(
            name="parse_document",
            description="解析PDF、Word、PPT等文档，提取文本、表格、公式等内容"
        )
        self.config = config
        self.parse_tool = ParseDocumentsTool(config)
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行文档解析"""
        import asyncio
        return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs) -> Dict[str, Any]:
        """异步执行文档解析"""
        try:
            file_path = kwargs.get("file_path")
            mode = kwargs.get("mode", "local")
            language = kwargs.get("language", "auto")
            enable_formula = kwargs.get("enable_formula", True)
            enable_table = kwargs.get("enable_table", True)
            page_ranges = kwargs.get("page_ranges")
            
            # 检查文件是否存在
            if not os.path.exists(file_path):
                return {
                    "success": False,
                    "error": f"文件不存在: {file_path}"
                }
            
            # 构建解析参数
            parse_args = MinerUParseArgs(
                file_sources=[file_path],
                mode=ParseMode(mode),
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                page_ranges=page_ranges
            )
            
            # 执行解析
            result = await self.parse_tool.parse(parse_args)
            return result
            
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }


class GetSupportedLanguagesTool(BaseTool):
    """获取支持语言工具"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(
            name="get_supported_languages",
            description="获取MinerU支持的OCR语言列表"
        )
        self.config = config
        self.ocr_languages_tool = GetOCRLanguagesTool(config)
    
    def _run(self, **kwargs) -> List[str]:
        """同步获取支持的语言列表"""
        import asyncio
        return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs) -> List[str]:
        """异步获取支持的语言列表"""
        try:
            mode = kwargs.get("mode", "local")
            
            # 构建查询参数
            lang_args = MinerUOCRLanguagesArgs(mode=ParseMode(mode))
            
            # 获取语言列表
            result = await self.ocr_languages_tool.get_languages(lang_args)
            
            if result.get("success", False):
                return result.get("languages", [])
            else:
                logger.error(f"获取语言列表失败: {result.get('error', '未知错误')}")
                return []
                
        except Exception as e:
            logger.error(f"获取支持语言失败: {e}")
            return []


class AnalyzeDocumentStructureTool(BaseTool):
    """文档结构分析工具"""
    
    def __init__(self):
        super().__init__(
            name="analyze_document_structure",
            description="分析文档的基本结构信息，包括文件大小、类型、页数等"
        )
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """分析文档结构"""
        try:
            file_path = kwargs.get("file_path")
            
            if not os.path.exists(file_path):
                return {
                    "success": False,
                    "error": f"文件不存在: {file_path}"
                }
            
            file_path_obj = Path(file_path)
            file_size = file_path_obj.stat().st_size
            file_type = file_path_obj.suffix.lower()
            
            # 估算页数（简单估算）
            estimated_pages = max(1, file_size // (1024 * 100))  # 假设每页约100KB
            
            return {
                "success": True,
                "file_name": file_path_obj.name,
                "file_size": file_size,
                "file_type": file_type,
                "estimated_pages": estimated_pages,
                "supported_features": self._get_supported_features(file_type)
            }
            
        except Exception as e:
            logger.error(f"文档结构分析失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _get_supported_features(self, file_type: str) -> List[str]:
        """获取文件类型支持的功能"""
        features = ["文本提取"]
        
        if file_type in [".pdf", ".docx", ".pptx"]:
            features.extend(["表格识别", "公式识别", "图片提取"])
        
        return features


class ExtractDocumentMetadataTool(BaseTool):
    """文档元数据提取工具"""
    
    def __init__(self):
        super().__init__(
            name="extract_document_metadata",
            description="提取文档的元数据信息，包括文件名、大小、创建时间等"
        )
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """提取文档元数据"""
        try:
            file_path = kwargs.get("file_path")
            
            if not os.path.exists(file_path):
                return {
                    "success": False,
                    "error": f"文件不存在: {file_path}"
                }
            
            file_path_obj = Path(file_path)
            stat = file_path_obj.stat()
            
            return {
                "success": True,
                "file_name": file_path_obj.name,
                "file_size": stat.st_size,
                "file_type": file_path_obj.suffix.lower(),
                "created_time": stat.st_ctime,
                "modified_time": stat.st_mtime,
                "absolute_path": str(file_path_obj.absolute())
            }
            
        except Exception as e:
            logger.error(f"元数据提取失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }


class DocumentParserAgent(Agent):
    """
    文档解析智能体
    
    基于AgenticX框架的智能体，专门用于文档解析任务。
    集成MinerU工具，支持多种文档格式的解析和处理。
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        初始化文档解析智能体
        
        Args:
            config: 配置字典，包含LLM和MinerU配置
        """
        # 从配置中提取智能体信息
        agent_config = config.get("agent", {})
        
        # 将配置存储在memory_config中，避免Pydantic字段冲突
        memory_config = {
            "config": config,
            "mineru_config": config.get("mineru", {}),
            "tools": {}
        }
        
        super().__init__(
            name=agent_config.get("name", "DocumentParser"),
            role=agent_config.get("role", "文档解析专家"),
            goal=agent_config.get("goal", "高效准确地解析各种格式的文档"),
            backstory=agent_config.get("backstory", "我是一个专业的文档解析助手"),
            organization_id="default",
            memory_config=memory_config
        )
        
        # 初始化工具
        self._initialize_tools()
        
        logger.info(f"文档解析智能体 {self.name} 初始化完成")
    
    def _initialize_tools(self):
        """初始化工具"""
        try:
            mineru_config = self.memory_config["mineru_config"]
            
            # 初始化MinerU工具
            self.memory_config["tools"]["parse_document_tool"] = ParseDocumentTool(mineru_config)
            self.memory_config["tools"]["get_languages_tool"] = GetSupportedLanguagesTool(mineru_config)
            self.memory_config["tools"]["analyze_structure_tool"] = AnalyzeDocumentStructureTool()
            self.memory_config["tools"]["extract_metadata_tool"] = ExtractDocumentMetadataTool()
            
            logger.info("工具初始化完成")
            
        except Exception as e:
            logger.error(f"工具初始化失败: {e}")
            raise
    
    async def parse_document(
        self,
        file_path: str,
        mode: Optional[str] = None,
        language: Optional[str] = None,
        enable_formula: Optional[bool] = None,
        enable_table: Optional[bool] = None,
        page_ranges: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        解析文档
        
        Args:
            file_path: 文档文件路径
            mode: 解析模式
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            page_ranges: 页码范围
            
        Returns:
            解析结果
        """
        tool = self.memory_config["tools"]["parse_document_tool"]
        mineru_config = self.memory_config["mineru_config"]
        
        return await tool._arun(
            file_path=file_path,
            mode=mode or mineru_config.get("default_mode", "local"),
            language=language or "auto",
            enable_formula=enable_formula if enable_formula is not None else True,
            enable_table=enable_table if enable_table is not None else True,
            page_ranges=page_ranges
        )
    
    async def get_supported_languages(self, mode: Optional[str] = None) -> List[str]:
        """
        获取支持的OCR语言列表
        
        Args:
            mode: 查询模式
            
        Returns:
            语言列表
        """
        tool = self.memory_config["tools"]["get_languages_tool"]
        mineru_config = self.memory_config["mineru_config"]
        
        return await tool._arun(
            mode=mode or mineru_config.get("default_mode", "local")
        )
    
    def analyze_document_structure(self, file_path: str) -> Dict[str, Any]:
        """
        分析文档结构
        
        Args:
            file_path: 文档文件路径
            
        Returns:
            文档结构信息
        """
        tool = self.memory_config["tools"]["analyze_structure_tool"]
        return tool._run(file_path=file_path)
    
    def extract_document_metadata(self, file_path: str) -> Dict[str, Any]:
        """
        提取文档元数据
        
        Args:
            file_path: 文档文件路径
            
        Returns:
            文档元数据
        """
        tool = self.memory_config["tools"]["extract_metadata_tool"]
        return tool._run(file_path=file_path)
    
    def execute(self, task: Task, context: AgentContext) -> AgentResult:
        """
        执行任务（AgenticX Agent接口方法）
        
        Args:
            task: 执行任务
            context: Agent上下文
            
        Returns:
            AgentResult: 执行结果
        """
        try:
            task_type = task.context.get("task_type", "parse_document")
            
            if task_type == "parse_document":
                result = self._handle_parse_document_task(task)
            elif task_type == "get_languages":
                result = self._handle_get_languages_task(task)
            elif task_type == "analyze_structure":
                result = self._handle_analyze_structure_task(task)
            elif task_type == "extract_metadata":
                result = self._handle_extract_metadata_task(task)
            else:
                raise ValueError(f"不支持的任务类型: {task_type}")
            
            return AgentResult(
                agent_id=self.id,
                task_id=task.id,
                success=True,
                output=result,
                metadata={"task_type": task_type}
            )
            
        except Exception as e:
            logger.error(f"任务执行失败: {e}")
            return AgentResult(
                agent_id=self.id,
                task_id=task.id,
                success=False,
                error=str(e),
                metadata={"task_type": task.context.get("task_type", "unknown")}
            )
    
    def _handle_parse_document_task(self, task: Task) -> Dict[str, Any]:
        """处理文档解析任务"""
        import asyncio
        
        file_path = task.context.get("file_path")
        if not file_path:
            raise ValueError("缺少文件路径参数")
        
        return asyncio.run(self.parse_document(
            file_path=file_path,
            mode=task.context.get("mode"),
            language=task.context.get("language"),
            enable_formula=task.context.get("enable_formula"),
            enable_table=task.context.get("enable_table"),
            page_ranges=task.context.get("page_ranges")
        ))
    
    def _handle_get_languages_task(self, task: Task) -> List[str]:
        """处理获取语言列表任务"""
        import asyncio
        
        return asyncio.run(self.get_supported_languages(
            mode=task.context.get("mode")
        ))
    
    def _handle_analyze_structure_task(self, task: Task) -> Dict[str, Any]:
        """处理文档结构分析任务"""
        file_path = task.context.get("file_path")
        if not file_path:
            raise ValueError("缺少文件路径参数")
        
        return self.analyze_document_structure(file_path)
    
    def _handle_extract_metadata_task(self, task: Task) -> Dict[str, Any]:
        """处理元数据提取任务"""
        file_path = task.context.get("file_path")
        if not file_path:
            raise ValueError("缺少文件路径参数")
        
        return self.extract_document_metadata(file_path)


# 导出主要类
__all__ = [
    "DocumentParserAgent",
    "ParseDocumentTool",
    "GetSupportedLanguagesTool",
    "AnalyzeDocumentStructureTool",
    "ExtractDocumentMetadataTool"
]