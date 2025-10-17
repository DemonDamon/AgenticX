"""
远程 VLM HTTP 客户端适配器
"""

import asyncio
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Any
import aiohttp
import logging

from .base import DocumentAdapter, ParsedArtifacts
from .utils import PageRangeParser, CoordinateConverter

logger = logging.getLogger(__name__)


class VLMHttpClientAdapter(DocumentAdapter):
    """远程 VLM HTTP 客户端适配器"""
    
    SUPPORTED_FORMATS = [".pdf", ".png", ".jpg", ".jpeg"]
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        初始化 VLM HTTP 客户端适配器
        
        Args:
            config: 配置字典，包含以下必需项：
                - api_base: API 基础URL
                - api_token: API 令牌（可选）
                - model_version: 模型版本
                - timeout: 请求超时时间（秒）
                - max_retries: 最大重试次数
        """
        super().__init__(config)
        
        # 必需配置
        self.api_base = self.config.get("api_base")
        if not self.api_base:
            raise ValueError("api_base 是必需的配置项")
        
        # 可选配置
        self.api_token = self.config.get("api_token")
        self.model_version = self.config.get("model_version", "latest")
        self.timeout = self.config.get("timeout", 300)  # 5分钟
        self.max_retries = self.config.get("max_retries", 3)
        
        # 确保 API 基础URL 以斜杠结尾
        if not self.api_base.endswith("/"):
            self.api_base += "/"
    
    async def parse(
        self,
        file_path: Path,
        output_dir: Path,
        language: str = "auto",
        enable_formula: bool = True,
        enable_table: bool = True,
        page_ranges: Optional[str] = None,
        **kwargs
    ) -> ParsedArtifacts:
        """
        使用远程 VLM HTTP 客户端解析文档
        
        Args:
            file_path: 输入文件路径
            output_dir: 输出目录
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            page_ranges: 页码范围
            **kwargs: 其他参数，包括：
                - is_ocr: 是否使用OCR模式
                - callback: 回调URL
                - callback_secret: 回调密钥
            
        Returns:
            ParsedArtifacts: 解析结果
        """
        start_time = time.time()
        
        # 验证输入
        if not self._validate_file(file_path):
            raise ValueError(f"无效的输入文件: {file_path}")
        
        # 生成任务ID
        task_id = self._generate_task_id(file_path)
        
        # 准备输出目录
        actual_output_dir = self._prepare_output_dir(output_dir, task_id)
        
        # 解析页码范围
        pages = []
        if page_ranges:
            try:
                pages = PageRangeParser.parse(page_ranges)
                self.logger.info(f"解析页码范围: {page_ranges} -> {pages}")
            except ValueError as e:
                self.logger.error(f"页码范围解析失败: {e}")
                raise
        
        try:
            # 执行远程解析
            self.logger.info(f"开始远程解析文档: {file_path}")
            result = await self._parse_remote(
                file_path=file_path,
                output_dir=actual_output_dir,
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                pages=pages,
                **kwargs
            )
            
            processing_time = time.time() - start_time
            
            # 构建结果
            artifacts = ParsedArtifacts(
                task_id=task_id,
                source_file=file_path,
                output_dir=actual_output_dir,
                markdown_file=result.get("markdown_file"),
                model_json=result.get("model_json"),
                middle_json=result.get("middle_json"),
                content_list_json=result.get("content_list_json"),
                page_count=result.get("page_count"),
                processing_time=processing_time,
                backend_type="vlm",
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                page_ranges=page_ranges,
                errors=result.get("errors", []),
                warnings=result.get("warnings", [])
            )
            
            self.logger.info(f"远程文档解析完成，耗时: {processing_time:.2f}秒")
            return artifacts
            
        except Exception as e:
            self.logger.error(f"远程文档解析失败: {e}")
            raise
    
    async def _parse_remote(
        self,
        file_path: Path,
        output_dir: Path,
        language: str,
        enable_formula: bool,
        enable_table: bool,
        pages: List[int],
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行远程解析
        
        Args:
            file_path: 输入文件
            output_dir: 输出目录
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            pages: 页码列表
            **kwargs: 其他参数
            
        Returns:
            解析结果字典
        """
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
            
            # 1. 上传文件
            upload_url = await self._upload_file(session, file_path)
            
            # 2. 提交解析任务
            task_id = await self._submit_parse_task(
                session=session,
                file_url=upload_url,
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                pages=pages,
                **kwargs
            )
            
            # 3. 轮询任务状态
            result_url = await self._poll_task_status(session, task_id)
            
            # 4. 下载并处理结果
            return await self._download_and_process_result(session, result_url, output_dir)
    
    async def _upload_file(self, session: aiohttp.ClientSession, file_path: Path) -> str:
        """
        上传文件到远程服务器
        
        Args:
            session: HTTP 会话
            file_path: 文件路径
            
        Returns:
            上传后的文件URL
        """
        upload_url = f"{self.api_base}upload"
        
        headers = {}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        
        with open(file_path, 'rb') as f:
            data = aiohttp.FormData()
            data.add_field('file', f, filename=file_path.name)
            
            async with session.post(upload_url, data=data, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise RuntimeError(f"文件上传失败: {response.status} - {error_text}")
                
                result = await response.json()
                return result["file_url"]
    
    async def _submit_parse_task(
        self,
        session: aiohttp.ClientSession,
        file_url: str,
        language: str,
        enable_formula: bool,
        enable_table: bool,
        pages: List[int],
        **kwargs
    ) -> str:
        """
        提交解析任务
        
        Args:
            session: HTTP 会话
            file_url: 文件URL
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            pages: 页码列表
            **kwargs: 其他参数
            
        Returns:
            任务ID
        """
        parse_url = f"{self.api_base}parse"
        
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        
        payload = {
            "file_url": file_url,
            "model_version": self.model_version,
            "language": language,
            "is_ocr": kwargs.get("is_ocr", True),
            "enable_formula": enable_formula,
            "enable_table": enable_table
        }
        
        if pages:
            payload["page_ranges"] = ",".join(map(str, pages))
        
        # 添加可选参数
        if "callback" in kwargs:
            payload["callback"] = kwargs["callback"]
        if "callback_secret" in kwargs:
            payload["callback_secret"] = kwargs["callback_secret"]
        
        async with session.post(parse_url, json=payload, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                raise RuntimeError(f"任务提交失败: {response.status} - {error_text}")
            
            result = await response.json()
            return result["task_id"]
    
    async def _poll_task_status(self, session: aiohttp.ClientSession, task_id: str) -> str:
        """
        轮询任务状态直到完成
        
        Args:
            session: HTTP 会话
            task_id: 任务ID
            
        Returns:
            结果下载URL
        """
        status_url = f"{self.api_base}status/{task_id}"
        
        headers = {}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        
        retry_count = 0
        while retry_count < self.max_retries:
            try:
                async with session.get(status_url, headers=headers) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise RuntimeError(f"状态查询失败: {response.status} - {error_text}")
                    
                    result = await response.json()
                    status = result["status"]
                    
                    if status == "completed":
                        return result["result_url"]
                    elif status == "failed":
                        error_msg = result.get("error", "未知错误")
                        raise RuntimeError(f"任务执行失败: {error_msg}")
                    elif status in ["pending", "processing"]:
                        # 等待一段时间后重试
                        await asyncio.sleep(5)
                        continue
                    else:
                        raise RuntimeError(f"未知任务状态: {status}")
            
            except asyncio.TimeoutError:
                retry_count += 1
                if retry_count >= self.max_retries:
                    raise RuntimeError(f"任务状态轮询超时，重试次数已达上限: {self.max_retries}")
                
                self.logger.warning(f"状态查询超时，重试 {retry_count}/{self.max_retries}")
                await asyncio.sleep(10)
        
        raise RuntimeError("任务状态轮询失败")
    
    async def _download_and_process_result(
        self,
        session: aiohttp.ClientSession,
        result_url: str,
        output_dir: Path
    ) -> Dict[str, Any]:
        """
        下载并处理解析结果
        
        Args:
            session: HTTP 会话
            result_url: 结果下载URL
            output_dir: 输出目录
            
        Returns:
            处理后的结果字典
        """
        headers = {}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        
        async with session.get(result_url, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                raise RuntimeError(f"结果下载失败: {response.status} - {error_text}")
            
            # 假设返回的是 JSON 格式的结果
            result_data = await response.json()
            
            # 处理结果并保存到本地文件
            return await self._process_vlm_result(result_data, output_dir)
    
    async def _process_vlm_result(self, result_data: Dict[str, Any], output_dir: Path) -> Dict[str, Any]:
        """
        处理 VLM 解析结果
        
        Args:
            result_data: 原始结果数据
            output_dir: 输出目录
            
        Returns:
            处理后的结果字典
        """
        file_stem = "document"  # 可以从结果中获取原始文件名
        
        # 创建输出文件
        markdown_file = output_dir / f"{file_stem}.md"
        model_json = output_dir / f"{file_stem}_model.json"
        middle_json = output_dir / f"{file_stem}_middle.json"
        content_list_json = output_dir / f"{file_stem}_content_list.json"
        
        # 处理 Markdown 内容
        if "markdown" in result_data:
            markdown_file.write_text(result_data["markdown"], encoding="utf-8")
        
        # 处理模型数据（需要坐标系转换）
        if "model" in result_data:
            model_data = self._convert_vlm_coordinates(result_data["model"])
            model_json.write_text(json.dumps(model_data, ensure_ascii=False, indent=2))
        
        # 处理中间数据
        if "middle" in result_data:
            middle_json.write_text(json.dumps(result_data["middle"], ensure_ascii=False, indent=2))
        
        # 处理内容列表
        if "content_list" in result_data:
            content_list_json.write_text(json.dumps(result_data["content_list"], ensure_ascii=False, indent=2))
        
        return {
            "markdown_file": markdown_file if markdown_file.exists() else None,
            "model_json": model_json if model_json.exists() else None,
            "middle_json": middle_json if middle_json.exists() else None,
            "content_list_json": content_list_json if content_list_json.exists() else None,
            "page_count": result_data.get("page_count", 0),
            "errors": result_data.get("errors", []),
            "warnings": result_data.get("warnings", [])
        }
    
    def _convert_vlm_coordinates(self, model_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        转换 VLM 坐标系到统一格式
        
        Args:
            model_data: 原始模型数据
            
        Returns:
            转换后的模型数据
        """
        # VLM 使用归一化的 bbox 坐标 (0-1)
        # 这里可以根据需要进行坐标系转换
        # 目前直接返回原始数据
        return model_data
    
    def get_supported_formats(self) -> List[str]:
        """获取支持的文件格式"""
        return self.SUPPORTED_FORMATS.copy()
    
    def validate_config(self) -> bool:
        """验证配置是否有效"""
        try:
            # 检查必需配置
            if not self.api_base:
                self.logger.error("api_base 是必需的配置项")
                return False
            
            # 检查URL格式
            if not self.api_base.startswith(("http://", "https://")):
                self.logger.error(f"无效的 API 基础URL: {self.api_base}")
                return False
            
            # 检查超时时间
            if not isinstance(self.timeout, (int, float)) or self.timeout <= 0:
                self.logger.error(f"无效的超时时间: {self.timeout}")
                return False
            
            # 检查重试次数
            if not isinstance(self.max_retries, int) or self.max_retries < 0:
                self.logger.error(f"无效的最大重试次数: {self.max_retries}")
                return False
            
            return True
            
        except Exception as e:
            self.logger.error(f"配置验证失败: {e}")
            return False