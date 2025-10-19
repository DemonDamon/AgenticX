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
import zipfile
import tempfile
import shutil

import aiohttp

# 导入AgenticX核心模块
from agenticx.core.agent import Agent, AgentContext, AgentResult
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool

logger = logging.getLogger(__name__)


class ParseDocumentTool(BaseTool):
    """文档解析工具"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(
            name="parse_document",
            description="解析PDF、Word、PPT等文档，提取文本、表格、公式等内容"
        )
        self.config = config
        self.api_config = config.get("api", {})
        self.api_base = self.api_config.get("base", "https://mineru.net/api/v4")
        self.api_token = self.api_config.get("token", "")
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行文档解析"""
        import asyncio
        return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs) -> Dict[str, Any]:
        """异步执行文档解析"""
        try:
            file_path = kwargs.get("file_path")
            language = kwargs.get("language", "ch")
            enable_ocr = kwargs.get("enable_ocr", True)
            page_ranges = kwargs.get("page_ranges")
            
            # 检查文件是否存在
            if not os.path.exists(file_path):
                return {
                    "success": False,
                    "error": f"文件不存在: {file_path}"
                }
            
            # 直接调用 MinerU API
            result = await self._call_mineru_api(
                file_path=file_path,
                language=language,
                enable_ocr=enable_ocr,
                page_ranges=page_ranges
            )
            return result
            
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def _call_mineru_api(self, file_path: str, language: str, enable_ocr: bool, page_ranges: Optional[str]) -> Dict[str, Any]:
        """调用 MinerU API 上传并解析文件"""
        import aiohttp
        import time
        from pathlib import Path
        
        try:
            # 检查 API 配置
            if not self.api_token:
                return {
                    "success": False,
                    "error": "MinerU API Token 未配置"
                }
            
            # 检查文件是否存在
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return {
                    "success": False,
                    "error": f"文件不存在: {file_path}"
                }
            
            logger.info(f"开始上传文件: {file_path}")
            
            async with aiohttp.ClientSession() as session:
                # 1. 获取文件上传URL
                upload_result = await self._get_upload_url(session, file_path_obj, language, enable_ocr, page_ranges)
                if not upload_result["success"]:
                    return upload_result
                
                batch_id = upload_result["batch_id"]
                upload_url = upload_result["upload_url"]
                
                # 2. 上传文件
                upload_file_result = await self._upload_file(session, file_path_obj, upload_url)
                if not upload_file_result["success"]:
                    return upload_file_result
                
                logger.info(f"文件上传成功，batch_id: {batch_id}")
                
                # 3. 轮询任务状态
                return await self._poll_batch_task_status(session, batch_id)
                        
        except Exception as e:
            logger.error(f"MinerU API 调用异常: {e}")
            return {
                "success": False,
                "error": f"API 调用异常: {str(e)}"
            }
    
    async def _get_upload_url(self, session, file_path_obj: Path, language: str, enable_ocr: bool, page_ranges: Optional[str]) -> Dict[str, Any]:
        """获取文件上传URL"""
        import time
        
        # 准备上传请求
        upload_request = {
            "files": [
                {
                    "name": file_path_obj.name,
                    "is_ocr": enable_ocr,
                    "data_id": f"upload_{int(time.time())}"
                }
            ],
            "enable_formula": True,  # 启用公式识别
            "enable_table": True     # 启用表格识别
        }
        
        # 添加语言参数（如果不是auto）
        if language and language != "auto":
            upload_request["language"] = language
            
        # 添加页码范围（如果指定）
        if page_ranges:
            upload_request["page_ranges"] = page_ranges
        
        logger.info(f"请求文件上传URL，数据: {upload_request}")
        
        try:
            async with session.post(
                f"{self.api_base}/file-urls/batch",
                json=upload_request,
                headers={
                    "Authorization": f"Bearer {self.api_token}",
                    "Content-Type": "application/json",
                    "Accept": "*/*"
                },
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status == 200:
                    upload_data = await response.json()
                    logger.info(f"上传URL响应: {upload_data}")
                    
                    if upload_data.get("code") != 0 or "data" not in upload_data:
                        return {
                            "success": False,
                            "error": f"获取上传URL失败: {upload_data}"
                        }
                    
                    batch_data = upload_data["data"]
                    batch_id = batch_data.get("batch_id")
                    file_urls = batch_data.get("file_urls", [])
                    
                    if not batch_id or not file_urls:
                        return {
                            "success": False,
                            "error": f"响应中缺少batch_id或file_urls: {batch_data}"
                        }
                    
                    return {
                        "success": True,
                        "batch_id": batch_id,
                        "upload_url": file_urls[0]  # file_urls 是字符串列表
                    }
                else:
                    error_text = await response.text()
                    return {
                        "success": False,
                        "error": f"获取上传URL失败 (状态码: {response.status}): {error_text}"
                    }
        except Exception as e:
            return {
                "success": False,
                "error": f"获取上传URL异常: {str(e)}"
            }
    
    async def _upload_file(self, session, file_path_obj: Path, upload_url: str) -> Dict[str, Any]:
        """上传文件到指定URL"""
        import httpx
        
        try:
            logger.info(f"上传文件到: {upload_url}")
            
            with open(file_path_obj, 'rb') as f:
                file_content = f.read()
            
            # 使用httpx客户端，匹配原始MinerU工具的实现
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    upload_url,
                    content=file_content,
                    headers={
                        # 不设置Content-Type，让系统自动检测
                    },
                    timeout=60.0  # 上传可能需要更长时间
                )
                
                if response.status_code in [200, 201]:
                    logger.info("文件上传成功")
                    return {"success": True}
                else:
                    error_text = response.text
                    return {
                        "success": False,
                        "error": f"文件上传失败 (状态码: {response.status_code}): {error_text}"
                    }
        except Exception as e:
            return {
                "success": False,
                "error": f"文件上传异常: {str(e)}"
            }
    
    async def _poll_task_status(self, session, task_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
        """轮询单个任务状态"""
        import asyncio
        
        max_attempts = 60  # 最多轮询60次
        interval = 5  # 每5秒轮询一次
        
        for attempt in range(max_attempts):
            try:
                async with session.get(
                    f"{self.api_base}/extract/task/{task_id}",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        if result.get("code") == 0 and "data" in result:
                            task_data = result["data"]
                            state = task_data.get("state", "").lower()
                            
                            if state == "done":
                                return {
                                    "success": True,
                                    "content": task_data.get("markdown_url", ""),
                                    "full_zip_url": task_data.get("full_zip_url", ""),
                                    "task_id": task_id
                                }
                            elif state == "failed":
                                return {
                                    "success": False,
                                    "error": task_data.get("error", "任务失败")
                                }
                            elif state in ["pending", "running", "converting"]:
                                logger.info(f"任务 {task_id} 状态: {state}，继续等待...")
                                await asyncio.sleep(interval)
                                continue
                        else:
                            return {
                                "success": False,
                                "error": f"API响应格式错误: {result}"
                            }
                    else:
                        return {
                            "success": False,
                            "error": f"查询任务状态失败 (状态码: {response.status})"
                        }
            except Exception as e:
                return {
                    "success": False,
                    "error": f"查询任务状态异常: {str(e)}"
                }
        
        return {
            "success": False,
            "error": "任务超时，请稍后重试"
        }
    
    async def _poll_batch_task_status(self, session, batch_id: str) -> Dict[str, Any]:
        """轮询批量任务状态"""
        import asyncio
        
        max_attempts = 100  # 最多轮询100次
        interval = 3  # 每3秒轮询一次
        
        logger.info(f"开始轮询批量任务状态，batch_id: {batch_id}")
        
        for attempt in range(max_attempts):
            try:
                async with session.get(
                    f"{self.api_base}/extract-results/batch/{batch_id}",
                    headers={
                        "Authorization": f"Bearer {self.api_token}",
                        "Content-Type": "application/json",
                        "Accept": "*/*"
                    },
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.debug(f"批量任务轮询响应数据: {data}")
                        
                        # 处理批量任务API的响应格式
                        if data.get("code") == 0 and "data" in data:
                            extract_results = data["data"].get("extract_result", [])
                            if not extract_results:
                                logger.info(f"批量任务 {batch_id} 暂无结果，继续等待...")
                                await asyncio.sleep(interval)
                                continue
                            
                            # 获取第一个文件的解析结果
                            result = extract_results[0]
                            state = result.get("state", "").lower()
                            logger.debug(f"批量任务状态: {state}, 完整数据: {result}")
                            
                            if state == "done":
                                # 批量任务完成，返回完整的任务数据
                                full_zip_url = result.get("full_zip_url")
                                markdown_url = result.get("markdown_url")
                                logger.info(f"批量任务完成，ZIP URL: {full_zip_url}")
                                return {
                                    "success": True,
                                    "content": markdown_url or "",
                                    "full_zip_url": full_zip_url or "",
                                    "task_id": batch_id,
                                    "data": result
                                }
                            elif state == "failed":
                                # 批量任务失败
                                error_msg = result.get("err_msg", "批量任务失败")
                                return {
                                    "success": False,
                                    "error": error_msg,
                                    "task_id": batch_id
                                }
                            elif state in ["pending", "running", "converting"]:
                                # 批量任务进行中
                                progress = result.get("extract_progress", {})
                                extracted_pages = progress.get("extracted_pages", 0)
                                total_pages = progress.get("total_pages", 0)
                                logger.info(f"批量任务 {batch_id} 状态: {state}, 进度: {extracted_pages}/{total_pages}")
                                await asyncio.sleep(interval)
                                continue
                            else:
                                # 未知状态，继续等待
                                logger.warning(f"批量任务 {batch_id} 未知状态: {state}")
                                await asyncio.sleep(interval)
                                continue
                        else:
                            # API调用失败
                            error_msg = data.get("msg", "批量任务API调用失败")
                            return {
                                "success": False,
                                "error": f"批量任务API响应错误: {error_msg}"
                            }
                    else:
                        error_text = await response.text()
                        return {
                            "success": False,
                            "error": f"查询批量任务状态失败 (状态码: {response.status}): {error_text}"
                        }
                        
            except Exception as e:
                logger.error(f"轮询批量任务状态失败 (尝试 {attempt + 1}): {e}")
                if attempt == max_attempts - 1:
                    return {
                        "success": False,
                        "error": f"轮询批量任务状态异常: {str(e)}"
                    }
                await asyncio.sleep(interval)
        
        return {
            "success": False,
            "error": f"批量任务 {batch_id} 轮询超时"
        }


class GetSupportedLanguagesTool(BaseTool):
    """获取支持的OCR语言列表工具"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(
            name="get_supported_languages",
            description="获取MinerU支持的OCR语言列表"
        )
        self.config = config
        self.api_config = config.get("api", {})
        self.api_base = self.api_config.get("base", "https://mineru.net/api/v4")
        self.api_token = self.api_config.get("token", "")
    
    def _run(self, **kwargs) -> List[str]:
        """同步获取支持的语言列表"""
        import asyncio
        return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs) -> List[str]:
        """异步获取支持的语言列表"""
        try:
            result = await self._call_languages_api()
            return result
        except Exception as e:
            logger.error(f"获取支持的语言列表失败: {e}")
            return ["ch", "en", "auto"]
    
    async def _call_languages_api(self) -> List[str]:
        """调用 MinerU API 获取支持的语言列表"""
        import aiohttp
        
        try:
            # 如果没有配置 API，返回默认语言列表
            if not self.api_token:
                return ["ch", "en", "auto"]
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Bearer {self.api_token}'
                }
                
                async with session.get(
                    f"{self.api_base}/api/languages",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        if isinstance(result, list):
                            return result
                        elif isinstance(result, dict) and "languages" in result:
                            return result["languages"]
                        else:
                            return ["ch", "en", "auto"]
                    else:
                        logger.warning(f"获取语言列表 API 调用失败 (状态码: {response.status})")
                        return ["ch", "en", "auto"]
                        
        except Exception as e:
            logger.warning(f"获取语言列表 API 调用异常: {e}")
            return ["ch", "en", "auto"]


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
            "tools": {},
            "conversation_state": {
                'stage': 'initial',  # initial, waiting_for_file, parsing, completed
                'current_file_path': None,
                'parse_request': None,
                'has_introduced': False
            }
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
    
    @property
    def conversation_state(self) -> Dict[str, Any]:
        """获取对话状态"""
        return self.memory_config.get("conversation_state", {})
    
    def update_conversation_state(self, **kwargs):
        """更新对话状态"""
        if "conversation_state" not in self.memory_config:
            self.memory_config["conversation_state"] = {}
        self.memory_config["conversation_state"].update(kwargs)
    
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
            mode: 解析模式 (已弃用，现在总是使用远程API)
            language: OCR语言
            enable_formula: 是否启用公式识别 (已弃用)
            enable_table: 是否启用表格识别 (已弃用)
            page_ranges: 页码范围
            
        Returns:
            解析结果
        """
        tool = self.memory_config["tools"]["parse_document_tool"]
        
        return await tool._arun(
            file_path=file_path,
            language=language or "ch",
            enable_ocr=True,
            page_ranges=page_ranges
        )
    
    async def get_supported_languages(self, mode: Optional[str] = None) -> List[str]:
        """
        获取支持的OCR语言列表
        
        Args:
            mode: 查询模式 (已弃用)
            
        Returns:
            语言列表
        """
        tool = self.memory_config["tools"]["get_languages_tool"]
        
        return await tool._arun()
    
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
    
    async def process_document_request(self, user_input: str) -> str:
        """
        处理用户的文档解析请求，支持状态管理和真正的文档解析
        
        Args:
            user_input: 用户输入的文本
            
        Returns:
            str: 智能体的回复
        """
        try:
            user_input_lower = user_input.lower().strip()
            
            # 检测文件路径
            detected_file_path = self._detect_file_path(user_input)
            
            # 检测解析意图
            parse_keywords = ['解析', 'parse', '处理', 'process', '分析', 'analyze', '提取', 'extract']
            has_parse_intent = any(keyword in user_input_lower for keyword in parse_keywords)
            
            # 状态机处理
            if self.conversation_state['stage'] == 'initial':
                if detected_file_path:
                    # 用户直接提供了文件路径
                    return await self._handle_file_path_provided(detected_file_path)
                elif has_parse_intent or any(word in user_input_lower for word in ['文档', 'pdf', 'word', 'ppt']):
                    # 用户表达了解析意图但没有提供路径
                    self.update_conversation_state(stage='waiting_for_file', has_introduced=True)
                    return """好的！我来帮您解析文档。

请提供您要解析的文件路径，例如：
• `/Users/用户名/Desktop/文档.pdf`
• `C:\\Users\\用户名\\Documents\\文档.docx`

我支持解析 PDF、Word、PowerPoint 等格式的文档，可以提取文本、表格、公式等内容。"""
                else:
                    # 首次问候或其他询问
                    if not self.conversation_state.get('has_introduced', False):
                        self.update_conversation_state(has_introduced=True)
                        return self._get_introduction_response(user_input)
                    else:
                        return self._get_contextual_response(user_input)
            
            elif self.conversation_state['stage'] == 'waiting_for_file':
                if detected_file_path:
                    # 用户提供了文件路径
                    return await self._handle_file_path_provided(detected_file_path)
                else:
                    return """请提供您要解析的文件路径。

例如：
• `/Users/damon/Desktop/dinov3_paper.pdf`
• `C:\\Documents\\报告.docx`

或者您可以输入 'quit' 退出对话。"""
            
            elif self.conversation_state['stage'] == 'parsing':
                return "文档正在解析中，请耐心等待..."
            
            elif self.conversation_state['stage'] == 'completed':
                if detected_file_path:
                    # 用户想解析新文件
                    return await self._handle_file_path_provided(detected_file_path)
                else:
                    # 检查用户是否有解析意图
                    if has_parse_intent or any(word in user_input_lower for word in ['文档', 'pdf', 'word', 'ppt', '解析', '处理']):
                        # 用户想要解析新文档但没有提供路径
                        return """好的！我来帮您解析新的文档。

请提供您要解析的文件路径，例如：
• `/Users/用户名/Desktop/文档.pdf`
• `C:\\Users\\用户名\\Documents\\文档.docx`

或者您可以输入 'quit' 退出对话。"""
                    else:
                        # 用户询问其他问题，使用智能回复
                        return self._get_contextual_response(user_input)
            
            return self._get_contextual_response(user_input)
            
        except Exception as e:
            logger.error(f"处理用户请求失败: {e}")
            return f"抱歉，处理您的请求时出现错误：{str(e)}"
    
    def _detect_file_path(self, user_input: str) -> Optional[str]:
        """检测用户输入中的文件路径"""
        import re
        
        # 检测文件路径模式（支持包含空格的路径）
        file_path_patterns = [
            r"'([^']+\.[a-zA-Z0-9]+)'",  # 单引号包围的路径 '/path/to/file.ext'
            r'"([^"]+\.[a-zA-Z0-9]+)"',  # 双引号包围的路径 "/path/to/file.ext"
            r'\.?/[^/\n]+(?:/[^/\n]+)*\.[a-zA-Z0-9]+',  # Unix路径 /path/to/file.ext 或 ./path/to/file.ext
            r'[A-Za-z]:\\[^\\:\n]+(?:\\[^\\:\n]+)*\.[a-zA-Z0-9]+',  # Windows路径 C:\path\to\file.ext
            r'[^\s/\\\n]+\.[a-zA-Z0-9]+',  # 简单文件名 file.ext
        ]
        
        for i, pattern in enumerate(file_path_patterns):
            match = re.search(pattern, user_input)
            if match:
                # 前两个模式（引号包围）有分组，使用group(1)，其他使用group(0)
                if i < 2:  # 引号包围的模式
                    return match.group(1)
                else:
                    return match.group(0)
        return None
    
    async def _handle_file_path_provided(self, file_path: str) -> str:
        """处理用户提供的文件路径"""
        # 转换为绝对路径
        file_path = os.path.abspath(file_path)
        
        # 验证文件是否存在
        if not os.path.exists(file_path):
            return f"""❌ 文件不存在：`{file_path}`

请检查：
• 文件路径是否正确
• 文件是否存在
• 是否有访问权限

请提供正确的文件路径，或输入 'quit' 退出对话。"""
        
        # 检查文件格式
        supported_extensions = ['.pdf', '.docx', '.pptx', '.doc', '.ppt']
        file_ext = os.path.splitext(file_path)[1].lower()
        if file_ext not in supported_extensions:
            return f"""❌ 不支持的文件格式：`{file_ext}`

支持的格式：
• PDF (.pdf)
• Word (.docx, .doc)  
• PowerPoint (.pptx, .ppt)

请提供支持的文件格式，或输入 'quit' 退出对话。"""
        
        # 开始解析
        self.update_conversation_state(stage='parsing', current_file_path=file_path)
        
        try:
            # 显示开始解析的消息
            logger.info(f"开始解析文档: {file_path}")
            
            # 返回开始解析的消息，然后在后台进行解析
            import asyncio
            
            # 创建一个异步任务来处理解析，同时提供进度反馈
            async def parse_with_progress():
                # 模拟进度反馈
                await asyncio.sleep(1)  # 模拟初始化时间
                logger.info("正在连接 MinerU 服务...")
                
                await asyncio.sleep(1)  # 模拟连接时间
                logger.info("正在上传文档...")
                
                await asyncio.sleep(2)  # 模拟上传时间
                logger.info("正在解析文档内容...")
                
                # 调用实际的解析方法
                result = await self.parse_document(file_path)
                return result
            
            # 执行解析
            result = await parse_with_progress()
            
            if result.get('success', False):
                # 下载并解压解析结果
                output_path = await self._download_and_extract_results(file_path, result)
                
                self.update_conversation_state(stage='completed')
                
                return f"""✅ 文档解析完成！

📄 **原文件**: `{file_path}`
📁 **结果文件夹**: `{output_path}`

📊 **解析内容**:
• 完整的Markdown文档 (full.md)
• 提取的图片文件夹 (images/)
• 布局信息文件 (layout.json)
• 原始PDF文件

您可以：
• 提供新的文件路径继续解析其他文档
• 输入 'quit' 退出对话"""
            else:
                self.conversation_state['stage'] = 'initial'
                error_msg = result.get('error', '未知错误')
                return f"""❌ 文档解析失败：{error_msg}

请检查：
• 文件是否损坏
• 文件是否加密
• 网络连接是否正常

您可以重新提供文件路径，或输入 'quit' 退出对话。"""
                
        except Exception as e:
            self.update_conversation_state(stage='initial')
            logger.error(f"解析文档时出错: {e}")
            return f"""❌ 解析过程中出现错误：{str(e)}

请重新提供文件路径，或输入 'quit' 退出对话。"""
    
    async def _download_and_extract_results(self, original_file_path: str, result: Dict[str, Any]) -> str:
        """下载并解压MinerU返回的ZIP文件"""
        try:
            # 获取ZIP下载链接
            full_zip_url = result.get('full_zip_url')
            if not full_zip_url:
                logger.error("未找到ZIP下载链接")
                return await self._save_parse_result(original_file_path, result)
            
            # 创建输出目录
            output_dir = Path("./outputs")
            output_dir.mkdir(exist_ok=True)
            
            # 生成输出文件夹名
            original_name = Path(original_file_path).stem
            task_id = result.get('task_id', '')
            if task_id:
                # 使用类似 dinov3_paper-2f2e3594f64f 的格式
                folder_name = f"{original_name}-{task_id[:12]}"
            else:
                # 如果没有task_id，使用时间戳
                timestamp = __import__('datetime').datetime.now().strftime("%Y%m%d_%H%M%S")
                folder_name = f"{original_name}_{timestamp}"
            
            output_folder = output_dir / folder_name
            
            # 如果文件夹已存在，删除它
            if output_folder.exists():
                shutil.rmtree(output_folder)
            
            # 创建临时文件来下载ZIP
            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_file:
                temp_zip_path = temp_file.name
                
                # 下载ZIP文件
                logger.info(f"正在下载ZIP文件: {full_zip_url}")
                async with aiohttp.ClientSession() as session:
                    async with session.get(full_zip_url) as response:
                        if response.status == 200:
                            content = await response.read()
                            temp_file.write(content)
                        else:
                            logger.error(f"下载ZIP文件失败，状态码: {response.status}")
                            return await self._save_parse_result(original_file_path, result)
            
            # 解压ZIP文件
            logger.info(f"正在解压ZIP文件到: {output_folder}")
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(output_folder)
            
            # 清理临时文件
            os.unlink(temp_zip_path)
            
            logger.info(f"ZIP文件解压完成: {output_folder}")
            return str(output_folder)
            
        except Exception as e:
            logger.error(f"下载解压ZIP文件失败: {e}")
            # 如果下载解压失败，回退到原来的保存方式
            return await self._save_parse_result(original_file_path, result)

    async def _save_parse_result(self, original_file_path: str, result: Dict[str, Any]) -> str:
        """保存解析结果到本地"""
        # 创建输出目录
        output_dir = Path("./outputs")
        output_dir.mkdir(exist_ok=True)
        
        # 生成输出文件名
        original_name = Path(original_file_path).stem
        timestamp = __import__('datetime').datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = output_dir / f"{original_name}_parsed_{timestamp}.txt"
        
        # 构建输出内容
        content_lines = []
        content_lines.append(f"文档解析结果")
        content_lines.append(f"原文件: {original_file_path}")
        content_lines.append(f"解析时间: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        content_lines.append("=" * 50)
        content_lines.append("")
        
        # 添加文本内容
        if result.get('text'):
            content_lines.append("📄 提取的文本内容:")
            content_lines.append("-" * 30)
            content_lines.append(result['text'])
            content_lines.append("")
        
        # 添加表格内容
        if result.get('tables'):
            content_lines.append("📊 提取的表格:")
            content_lines.append("-" * 30)
            for i, table in enumerate(result['tables'], 1):
                content_lines.append(f"表格 {i}:")
                content_lines.append(str(table))
                content_lines.append("")
        
        # 添加公式内容
        if result.get('formulas'):
            content_lines.append("🧮 提取的公式:")
            content_lines.append("-" * 30)
            for i, formula in enumerate(result['formulas'], 1):
                content_lines.append(f"公式 {i}: {formula}")
            content_lines.append("")
        
        # 写入文件
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(content_lines))
        
        return str(output_file)
    
    def _get_introduction_response(self, user_input: str) -> str:
        """首次介绍响应"""
        user_input_lower = user_input.lower().strip()
        
        if any(greeting in user_input_lower for greeting in ['你好', 'hello', 'hi', '您好']):
            return """你好！我是专业的文档解析助手 📄

我可以帮您解析 PDF、Word、PowerPoint 等格式的文档，提取其中的文本、表格、公式等内容。

请告诉我您要解析什么文档，或直接提供文件路径！"""
        else:
            return """我是专业的文档解析助手，可以帮您解析各种格式的文档。

请提供您要解析的文件路径，我会为您提取文档中的内容。"""
    
    def _get_contextual_response(self, user_input: str) -> str:
        """基于上下文的响应"""
        user_input_lower = user_input.lower().strip()
        
        if any(word in user_input_lower for word in ['功能', '能做什么', 'help', '帮助']):
            return """我可以帮您：

📄 **文档解析**
• 支持 PDF、Word、PowerPoint 格式
• 提取文本、表格、公式内容
• 保持原始文档结构

🚀 **使用方法**
直接提供文件路径即可，例如：
`/Users/用户名/Desktop/文档.pdf`

💾 **结果保存**
解析结果会自动保存到 `./outputs/` 目录"""
        
        elif any(word in user_input_lower for word in ['支持', '格式', 'format']):
            return """📋 **支持的文件格式**

• PDF (.pdf) - 包括扫描版PDF的OCR识别
• Word (.docx, .doc) - 提取文本和表格
• PowerPoint (.pptx, .ppt) - 提取幻灯片内容

🌍 **多语言支持**
• 中文（简体/繁体）
• 英文、日文、韩文等"""
        
        else:
            return """请提供您要解析的文件路径，例如：
• `/Users/用户名/Desktop/文档.pdf`
• `C:\\Documents\\报告.docx`

或者您可以询问我的功能和支持的格式。"""
    
    def _get_fallback_response(self, user_input: str) -> str:
        """
        当LLM不可用时的回退响应，增强了文件路径和意图识别
        
        Args:
            user_input: 用户输入
            
        Returns:
            str: 回退响应
        """
        import re
        
        user_input_lower = user_input.lower().strip()
        
        # 检测文件路径模式（支持包含空格的路径）
        file_path_patterns = [
            r"'([^']+\.[a-zA-Z0-9]+)'",  # 单引号包围的路径 '/path/to/file.ext'
            r'"([^"]+\.[a-zA-Z0-9]+)"',  # 双引号包围的路径 "/path/to/file.ext"
            r'/[^/\n]+(?:/[^/\n]+)*\.[a-zA-Z0-9]+',  # Unix路径 /path/to/file.ext
            r'[A-Za-z]:\\[^\\:\n]+(?:\\[^\\:\n]+)*\.[a-zA-Z0-9]+',  # Windows路径 C:\path\to\file.ext
            r'[^\s/\\\n]+\.[a-zA-Z0-9]+',  # 简单文件名 file.ext
        ]
        
        detected_file_path = None
        for i, pattern in enumerate(file_path_patterns):
            match = re.search(pattern, user_input)
            if match:
                # 前两个模式（引号包围）有分组，使用group(1)，其他使用group(0)
                if i < 2:  # 引号包围的模式
                    detected_file_path = match.group(1)
                else:
                    detected_file_path = match.group(0)
                break
        
        # 检测文件扩展名
        supported_extensions = ['.pdf', '.docx', '.pptx', '.doc', '.ppt']
        detected_extension = None
        for ext in supported_extensions:
            if ext in user_input_lower:
                detected_extension = ext
                break
        
        # 检测解析相关关键词
        parse_keywords = ['解析', 'parse', '处理', 'process', '分析', 'analyze', '提取', 'extract']
        has_parse_intent = any(keyword in user_input_lower for keyword in parse_keywords)
        
        # 如果检测到具体文件路径，提供针对性指导
        if detected_file_path:
            file_type = "文档"
            if detected_extension:
                if detected_extension == '.pdf':
                    file_type = "PDF文档"
                elif detected_extension in ['.docx', '.doc']:
                    file_type = "Word文档"
                elif detected_extension in ['.pptx', '.ppt']:
                    file_type = "PowerPoint演示文稿"
            
            return f"""我看到您想要解析这个{file_type}：
📄 **文件路径**: `{detected_file_path}`

🎯 **操作指导**
要解析您的文档，请按以下步骤操作：

1️⃣ **返回主菜单**
   输入 'q' 或 'quit' 退出当前对话

2️⃣ **选择解析功能**
   在主菜单中选择 "1" - 解析单个文档

3️⃣ **输入文件路径**
   当系统提示时，输入您的文件路径：
   `{detected_file_path}`

4️⃣ **确认文件信息**
   • 确保文件路径正确无误
   • 确认文件存在且可访问
   • 支持的格式：PDF、Word(.docx)、PowerPoint(.pptx)

💡 **提示**
• 如果路径包含空格，请确保路径格式正确
• 系统会自动检测文档语言并进行OCR识别
• 解析完成后会显示提取的文本、表格等内容

🔧 **故障排除**
如果遇到问题，请检查：
• 文件路径是否正确
• 文件是否存在
• 文件格式是否支持
• 文件是否损坏或加密"""

        # 问候语
        elif any(greeting in user_input_lower for greeting in ['你好', 'hello', 'hi', '您好']):
            return """你好！我是专业的文档解析助手 📄

我可以帮助您：
• 解析PDF、Word、PPT等文档
• 提取文本、表格、公式和图片
• 分析文档结构和元数据
• 查询支持的OCR语言

请返回主菜单选择相应功能，或者告诉我您想要解析什么类型的文档！"""

        # 功能询问
        elif any(word in user_input_lower for word in ['能做什么', '功能', '帮助', 'help', '做什么']):
            return """我是专业的文档解析助手，具备以下功能：

🔍 **文档解析**
• 支持PDF、Word、PPT等格式
• 智能提取文本、表格、公式
• 保持原始文档结构

📊 **内容分析**
• 文档结构分析
• 元数据提取
• 多语言OCR支持

💡 **使用建议**
请返回主菜单选择功能选项：
1️⃣ 解析单个文档
2️⃣ 解析示例PDF
3️⃣ 查看支持语言"""

        # 文档解析相关（但没有具体文件路径）
        elif has_parse_intent or any(word in user_input_lower for word in ['pdf', 'word', 'ppt', '文档']):
            return """我可以帮您解析各种格式的文档！📄

🎯 **支持格式**
• PDF文档 (.pdf)
• Word文档 (.docx, .doc)
• PowerPoint演示文稿 (.pptx, .ppt)

🚀 **快速开始**
1️⃣ **有具体文件要解析？**
   返回主菜单选择"选项1：解析单个文档"
   然后输入您的文件路径

2️⃣ **想先试用功能？**
   返回主菜单选择"选项2：解析示例PDF"

💡 **使用提示**
• 支持中英文等多语言OCR
• 自动提取文本、表格、公式
• 保持原始文档结构和格式
• 可指定页面范围进行解析

📝 **文件路径格式示例**
• macOS/Linux: `/Users/用户名/Documents/文件.pdf`
• Windows: `C:\\Users\\用户名\\Documents\\文件.pdf`"""

        # 语言支持询问
        elif any(word in user_input_lower for word in ['语言', 'language', '支持', 'ocr']):
            return """我支持多种语言的OCR识别！🌍

📝 **主要支持语言**
• 中文（简体/繁体）
• 英文
• 日文
• 韩文
• 以及更多语言...

🔍 **查看完整列表**
请返回主菜单选择"选项3：查看支持语言"获取详细的语言支持列表。

💡 **自动检测**：系统会自动检测文档语言，您也可以手动指定。"""

        # 默认回复
        else:
            return """感谢您的提问！我是专业的文档解析助手 🤖

我可以帮助您处理各种文档解析需求。如果您想了解具体功能，请返回主菜单选择相应的选项：

📋 **功能菜单**
1️⃣ 解析单个文档
2️⃣ 解析示例PDF  
3️⃣ 查看支持语言

💡 **智能提示**
如果您有具体的文件要解析，可以直接告诉我文件路径，我会为您提供详细的操作指导！

例如：
• "我想解析 /Users/用户名/Documents/报告.pdf"
• "请帮我处理这个文件：C:\\Documents\\presentation.pptx"

我会根据您的具体需求提供针对性的帮助！"""
    
    def _initialize_llm(self):
        """初始化LLM"""
        try:
            from agenticx.llms.bailian_provider import BailianProvider
            from agenticx.llms.kimi_provider import KimiProvider
            
            # 获取LLM配置
            config = self.memory_config.get("config", {})
            llm_config = config.get("llm", {})
            
            provider = llm_config.get("provider", "bailian")
            
            if provider == "bailian":
                self._llm = BailianProvider(
                    model=llm_config.get("model", "qwen3-max"),
                    api_key=llm_config.get("api_key"),
                    base_url=llm_config.get("base_url"),
                    temperature=llm_config.get("temperature", 0.7),
                    max_tokens=llm_config.get("max_tokens", 4000)
                )
            elif provider == "kimi":
                self._llm = KimiProvider(
                    model=llm_config.get("model", "moonshot-v1-8k"),
                    api_key=llm_config.get("api_key"),
                    temperature=llm_config.get("temperature", 0.7),
                    max_tokens=llm_config.get("max_tokens", 4000)
                )
            else:
                raise ValueError(f"不支持的LLM提供商: {provider}")
            
            logger.info(f"LLM初始化完成，使用提供商: {provider}")
            
        except Exception as e:
            logger.error(f"LLM初始化失败: {e}")
            # 创建一个简单的回退LLM
            self._llm = self._create_fallback_llm()
    
    def _create_fallback_llm(self):
        """创建回退LLM（简单的规则响应）"""
        class FallbackLLM:
            async def achat(self, messages):
                user_message = messages[-1]["content"].lower()
                
                if any(keyword in user_message for keyword in ["你好", "hello", "hi"]):
                    return type('Response', (), {'content': "您好！我是文档解析助手，很高兴为您服务！我可以帮您解析PDF、Word、PPT等文档，提取其中的文本、表格、公式和图片。请问有什么可以帮助您的吗？"})()
                elif any(keyword in user_message for keyword in ["解析", "parse", "文档", "document"]):
                    return type('Response', (), {'content': "我可以帮您解析各种格式的文档！请选择主菜单中的\"解析单个文档\"或\"解析示例PDF\"功能，我会引导您完成整个解析过程。"})()
                elif any(keyword in user_message for keyword in ["支持", "语言", "language"]):
                    return type('Response', (), {'content': "我支持多种OCR语言，包括中文、英文、日文、韩文等。您可以选择主菜单中的\"查看支持语言\"功能来查看完整的语言列表。"})()
                elif any(keyword in user_message for keyword in ["帮助", "help", "功能"]):
                    return type('Response', (), {'content': "我提供以下主要功能：\n1. 解析PDF、Word、PPT等文档\n2. 提取文本、表格、公式和图片\n3. 分析文档结构\n4. 获取文档元数据\n5. 支持多种OCR语言\n\n请返回主菜单选择相应的功能选项！"})()
                else:
                    return type('Response', (), {'content': "感谢您的提问！我是专业的文档解析助手，可以帮您处理各种文档解析需求。如果您想了解具体功能，请返回主菜单选择相应的选项，或者直接告诉我您想要解析什么类型的文档。"})()
        
        return FallbackLLM()


# 导出主要类
__all__ = [
    "DocumentParserAgent",
    "ParseDocumentTool",
    "GetSupportedLanguagesTool",
    "AnalyzeDocumentStructureTool",
    "ExtractDocumentMetadataTool"
]