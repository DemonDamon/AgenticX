"""
MinerU MCP 服务与工具组 (M1)

提供统一的 MinerU 解析工具，支持本地和远程模式，包含完整的错误处理、
回调验证、结果获取和工件管理功能。
"""

import os
import json
import time
import asyncio
import hashlib
import zipfile
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Literal
from urllib.parse import urlparse
from dataclasses import dataclass, field
from enum import Enum

import httpx
from pydantic import BaseModel, Field, validator

from .remote import RemoteTool, MCPServerConfig
from .adapters.base import ParsedArtifacts, DocumentAdapter
from .adapters.mineru import MinerUAdapter

logger = logging.getLogger(__name__)


class ParseMode(str, Enum):
    """解析模式枚举"""
    LOCAL = "local"
    REMOTE_API = "remote_api"
    REMOTE_MCP = "remote_mcp"


class TaskStatus(str, Enum):
    """任务状态枚举"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ArtifactIndex:
    """工件索引模型"""
    task_id: str
    source_files: List[str]
    output_dir: str
    artifacts: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    
    @classmethod
    def from_outputs(cls, outputs_dir: Path, task_id: str) -> "ArtifactIndex":
        """从输出目录构建工件索引"""
        artifacts = {}
        source_files = []
        
        # 查找常见输出文件
        common_files = {
            "markdown": "*.md",
            "model_json": "model.json",
            "middle_json": "middle.json", 
            "content_list_json": "content_list.json",
            "layout_pdf": "*_layout.pdf",
            "spans_pdf": "*_spans.pdf"
        }
        
        for key, pattern in common_files.items():
            files = list(outputs_dir.glob(pattern))
            if files:
                artifacts[key] = [str(f.relative_to(outputs_dir)) for f in files]
        
        # 查找图片文件
        image_files = []
        for ext in [".png", ".jpg", ".jpeg", ".gif", ".bmp"]:
            image_files.extend(outputs_dir.glob(f"**/*{ext}"))
        if image_files:
            artifacts["images"] = [str(f.relative_to(outputs_dir)) for f in image_files]
        
        # 尝试从 content_list.json 获取源文件信息
        content_list_path = outputs_dir / "content_list.json"
        if content_list_path.exists():
            try:
                with open(content_list_path, 'r', encoding='utf-8') as f:
                    content_data = json.load(f)
                    if isinstance(content_data, list) and content_data:
                        # 从第一个条目获取源文件信息
                        first_item = content_data[0]
                        if isinstance(first_item, dict) and "file_name" in first_item:
                            source_files.append(first_item["file_name"])
            except Exception as e:
                logger.warning(f"解析 content_list.json 失败: {e}")
        
        return cls(
            task_id=task_id,
            source_files=source_files,
            output_dir=str(outputs_dir),
            artifacts=artifacts,
            metadata={
                "total_files": len(list(outputs_dir.iterdir())),
                "size_bytes": sum(f.stat().st_size for f in outputs_dir.rglob("*") if f.is_file()),
                "created_at": time.time()
            }
        )


class MinerUParseArgs(BaseModel):
    """MinerU 解析参数模型"""
    file_sources: Union[str, List[str]] = Field(
        description="文件路径、URL或文件列表，支持本地文件、远程URL和批量输入"
    )
    language: str = Field(default="auto", description="OCR语言，支持 auto/zh/en/ja 等")
    enable_formula: bool = Field(default=True, description="是否启用公式识别")
    enable_table: bool = Field(default=True, description="是否启用表格识别")
    page_ranges: Optional[str] = Field(default=None, description="页码范围，如 '1-5,8,10-12'")
    mode: ParseMode = Field(default=ParseMode.LOCAL, description="解析模式：local/remote_api/remote_mcp")
    
    # 远程API参数
    api_base: Optional[str] = Field(default=None, description="远程API基础URL")
    api_token: Optional[str] = Field(default=None, description="API认证令牌")
    callback_url: Optional[str] = Field(default=None, description="回调URL")
    callback_secret: Optional[str] = Field(default=None, description="回调密钥")
    
    # 本地后端参数
    backend: str = Field(default="pipeline", description="本地后端类型：pipeline/vlm-http")
    method: str = Field(default="auto", description="解析方法：auto/ocr/txt")
    device: str = Field(default="auto", description="设备类型：auto/cuda/cpu/mps")
    
    @validator('file_sources')
    def validate_file_sources(cls, v):
        if isinstance(v, str):
            return [v]
        return v


class MinerUOCRLanguagesArgs(BaseModel):
    """OCR语言查询参数"""
    mode: ParseMode = Field(default=ParseMode.LOCAL, description="查询模式")
    api_base: Optional[str] = Field(default=None, description="远程API基础URL")
    api_token: Optional[str] = Field(default=None, description="API认证令牌")


class MinerUBatchArgs(BaseModel):
    """MinerU 批量处理参数"""
    file_paths: List[str] = Field(description="要处理的文件路径列表")
    output_dir: str = Field(default="./outputs", description="输出目录")
    language: str = Field(default="auto", description="OCR语言，支持 auto/zh/en/ja 等")
    enable_formula: bool = Field(default=True, description="是否启用公式识别")
    enable_table: bool = Field(default=True, description="是否启用表格识别")
    page_ranges: Optional[str] = Field(default=None, description="页码范围，如 '1-5,8,10-12'")
    
    # 批量处理特有参数
    max_concurrent: int = Field(default=3, description="最大并发处理数")
    callback_url: Optional[str] = Field(default=None, description="批量处理完成后的回调URL")
    callback_secret: Optional[str] = Field(default=None, description="回调密钥")
    
    # 远程API参数
    api_base: Optional[str] = Field(default=None, description="远程API基础URL")
    api_token: Optional[str] = Field(default=None, description="API认证令牌")
    
    @validator('file_paths')
    def validate_file_paths(cls, v):
        if not v:
            raise ValueError("file_paths cannot be empty")
        return v
    
    @validator('max_concurrent')
    def validate_max_concurrent(cls, v):
        if v < 1 or v > 10:
            raise ValueError("max_concurrent must be between 1 and 10")
        return v


class CallbackVerifier:
    """回调验证器"""
    
    @staticmethod
    def verify_signature(payload: Dict[str, Any], seed: str, signature: str) -> bool:
        """
        验证回调签名
        
        Args:
            payload: 回调数据
            seed: 密钥种子
            signature: 签名
            
        Returns:
            签名是否有效
        """
        try:
            # 构建待签名字符串
            content = json.dumps(payload, sort_keys=True, separators=(',', ':'))
            expected_signature = hashlib.sha256(f"{content}{seed}".encode()).hexdigest()
            return signature == expected_signature
        except Exception as e:
            logger.error(f"签名验证失败: {e}")
            return False


class ResultFetcher:
    """结果获取器"""
    
    def __init__(self, api_base: str, api_token: str, timeout: float = 30.0):
        self.api_base = api_base.rstrip('/')
        self.api_token = api_token
        self.client = httpx.AsyncClient(timeout=timeout)
    
    async def poll_task(self, task_id: str, interval_s: int = 3, max_attempts: int = 100) -> Dict[str, Any]:
        """
        轮询任务状态
        
        Args:
            task_id: 任务ID
            interval_s: 轮询间隔（秒）
            max_attempts: 最大尝试次数
            
        Returns:
            任务状态信息
        """
        for attempt in range(max_attempts):
            try:
                response = await self.client.get(
                    f"{self.api_base}/extract_progress",
                    params={"task_id": task_id},
                    headers={"Authorization": f"Bearer {self.api_token}"}
                )
                response.raise_for_status()
                
                data = response.json()
                status = data.get("status")
                
                if status in ["completed", "failed"]:
                    return data
                
                logger.info(f"任务 {task_id} 状态: {status}, 进度: {data.get('progress', 0)}%")
                await asyncio.sleep(interval_s)
                
            except Exception as e:
                logger.error(f"轮询任务状态失败 (尝试 {attempt + 1}): {e}")
                if attempt == max_attempts - 1:
                    raise
                await asyncio.sleep(interval_s)
        
        raise TimeoutError(f"任务 {task_id} 轮询超时")
    
    async def fetch_batch(self, batch_id: str) -> Dict[str, Any]:
        """
        获取批量任务状态
        
        Args:
            batch_id: 批量任务ID
            
        Returns:
            批量任务状态
        """
        try:
            response = await self.client.get(
                f"{self.api_base}/batch_extract_progress",
                params={"batch_id": batch_id},
                headers={"Authorization": f"Bearer {self.api_token}"}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"获取批量任务状态失败: {e}")
            raise
    
    async def download_zip(self, zip_url: str, dst_dir: Path) -> Path:
        """
        下载ZIP文件
        
        Args:
            zip_url: ZIP文件URL
            dst_dir: 目标目录
            
        Returns:
            下载的ZIP文件路径
        """
        dst_dir.mkdir(parents=True, exist_ok=True)
        zip_filename = f"result_{int(time.time())}.zip"
        zip_path = dst_dir / zip_filename
        
        try:
            async with self.client.stream("GET", zip_url) as response:
                response.raise_for_status()
                
                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0
                
                with open(zip_path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            logger.debug(f"下载进度: {progress:.1f}%")
            
            logger.info(f"ZIP文件下载完成: {zip_path} ({downloaded} bytes)")
            return zip_path
            
        except Exception as e:
            logger.error(f"ZIP文件下载失败: {e}")
            # 清理失败的下载文件
            if zip_path.exists():
                zip_path.unlink()
            raise
    
    async def close(self):
        """关闭HTTP客户端"""
        await self.client.aclose()


class ZipExtractor:
    """ZIP解压器"""
    
    @staticmethod
    def extract(zip_path: Union[str, Path], dst_dir: Union[str, Path], task_id: Optional[str] = None) -> ArtifactIndex:
        """
        解压ZIP文件并构建工件索引
        
        Args:
            zip_path: ZIP文件路径
            dst_dir: 目标目录
            task_id: 任务ID，如果为None则从zip文件名生成
            
        Returns:
            工件索引
        """
        # 确保路径是 Path 对象
        zip_path = Path(zip_path)
        dst_dir = Path(dst_dir)
        
        dst_dir.mkdir(parents=True, exist_ok=True)
        
        if task_id is None:
            task_id = zip_path.stem
        
        try:
            # 验证ZIP文件
            if not zipfile.is_zipfile(zip_path):
                raise ValueError(f"无效的ZIP文件: {zip_path}")
            
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                # 检查ZIP文件内容
                file_list = zip_ref.namelist()
                logger.info(f"ZIP文件包含 {len(file_list)} 个文件")
                
                # 解压所有文件
                zip_ref.extractall(dst_dir)
                
                # 验证解压结果
                extracted_files = list(dst_dir.rglob("*"))
                logger.info(f"成功解压 {len(extracted_files)} 个文件到 {dst_dir}")
            
            # 构建工件索引
            index = ArtifactIndex.from_outputs(dst_dir, task_id)
            
            # 清理ZIP文件（可选）
            try:
                zip_path.unlink()
                logger.debug(f"已清理ZIP文件: {zip_path}")
            except Exception as e:
                logger.warning(f"清理ZIP文件失败: {e}")
            
            return index
            
        except Exception as e:
            logger.error(f"ZIP文件解压失败: {e}")
            raise
    
    @staticmethod
    def validate_extracted_content(dst_dir: Path) -> Dict[str, Any]:
        """
        验证解压内容的完整性
        
        Args:
            dst_dir: 解压目录
            
        Returns:
            验证结果
        """
        validation_result = {
            "valid": True,
            "errors": [],
            "warnings": [],
            "files_found": {}
        }
        
        # 检查必需文件
        required_files = ["model.json", "content_list.json"]
        for required_file in required_files:
            file_path = dst_dir / required_file
            if file_path.exists():
                validation_result["files_found"][required_file] = True
                # 验证JSON文件格式
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        json.load(f)
                except json.JSONDecodeError as e:
                    validation_result["errors"].append(f"{required_file} 格式错误: {e}")
                    validation_result["valid"] = False
            else:
                validation_result["warnings"].append(f"缺少推荐文件: {required_file}")
        
        # 检查Markdown文件
        md_files = list(dst_dir.glob("*.md"))
        if md_files:
            validation_result["files_found"]["markdown"] = len(md_files)
        else:
            validation_result["warnings"].append("未找到Markdown文件")
        
        return validation_result


class RetryPolicy:
    """重试策略"""
    
    def __init__(self, max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 60.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
    
    def should_retry(self, attempt: int, exception: Exception) -> bool:
        """判断是否应该重试"""
        if attempt >= self.max_retries:
            return False
        
        # 网络相关错误可以重试
        if isinstance(exception, (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError)):
            return True
        
        # HTTP 5xx 错误可以重试
        if isinstance(exception, httpx.HTTPStatusError):
            return 500 <= exception.response.status_code < 600
        
        return False
    
    def get_delay(self, attempt: int) -> float:
        """获取重试延迟时间（指数退避）"""
        delay = self.base_delay * (2 ** attempt)
        return min(delay, self.max_delay)


class ParseDocumentsTool:
    """文档解析工具"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.output_base_dir = Path(self.config.get("output_dir", "outputs"))
        self.retry_policy = RetryPolicy(
            max_retries=self.config.get("max_retries", 3),
            base_delay=self.config.get("base_delay", 1.0),
            max_delay=self.config.get("max_delay", 60.0)
        )
        
    async def parse(self, args: MinerUParseArgs) -> Dict[str, Any]:
        """
        解析文档
        
        Args:
            args: 解析参数
            
        Returns:
            解析结果
        """
        try:
            if args.mode == ParseMode.LOCAL:
                return await self._parse_local(args)
            elif args.mode == ParseMode.REMOTE_API:
                return await self._parse_remote_api(args)
            elif args.mode == ParseMode.REMOTE_MCP:
                return await self._parse_remote_mcp(args)
            else:
                raise ValueError(f"不支持的解析模式: {args.mode}")
                
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "task_id": None,
                "artifacts": None
            }
    
    async def _parse_local(self, args: MinerUParseArgs) -> Dict[str, Any]:
        """本地解析"""
        # 创建适配器
        adapter = MinerUAdapter(
            backend_type=args.backend,
            debug=self.config.get("debug", False)
        )
        
        results = []
        errors = []
        
        for file_source in args.file_sources:
            try:
                file_path = Path(file_source)
                if not file_path.exists():
                    error_msg = f"文件不存在: {file_path}"
                    logger.error(error_msg)
                    errors.append(error_msg)
                    continue
                
                # 生成任务ID
                task_id = self._generate_task_id(file_path)
                output_dir = self.output_base_dir / task_id
                
                # 执行解析（带重试）
                artifacts = await self._parse_with_retry(
                    adapter, file_path, output_dir, args
                )
                
                # 构建索引
                index = ArtifactIndex.from_outputs(output_dir, task_id)
                
                # 验证解压内容
                validation = ZipExtractor.validate_extracted_content(output_dir)
                
                results.append({
                    "task_id": task_id,
                    "source_file": str(file_path),
                    "artifacts": index,
                    "validation": validation,
                    "success": True
                })
                
            except Exception as e:
                error_msg = f"解析文件 {file_source} 失败: {e}"
                logger.error(error_msg)
                errors.append(error_msg)
        
        return {
            "success": len(results) > 0,
            "mode": "local",
            "results": results,
            "errors": errors,
            "total_files": len(args.file_sources),
            "successful_files": len(results),
            "failed_files": len(errors)
        }
    
    async def _parse_with_retry(self, adapter, file_path, output_dir, args):
        """带重试的解析"""
        for attempt in range(self.retry_policy.max_retries + 1):
            try:
                return await adapter.parse(
                    file_path=file_path,
                    output_dir=output_dir,
                    language=args.language,
                    enable_formula=args.enable_formula,
                    enable_table=args.enable_table,
                    page_ranges=args.page_ranges
                )
            except Exception as e:
                if not self.retry_policy.should_retry(attempt, e):
                    raise
                
                if attempt < self.retry_policy.max_retries:
                    delay = self.retry_policy.get_delay(attempt)
                    logger.warning(f"解析失败，{delay}秒后重试 (尝试 {attempt + 1}/{self.retry_policy.max_retries}): {e}")
                    await asyncio.sleep(delay)
                else:
                    raise
    
    async def _parse_remote_api(self, args: MinerUParseArgs) -> Dict[str, Any]:
        """远程API解析"""
        if not args.api_base or not args.api_token:
            raise ValueError("远程API模式需要提供 api_base 和 api_token")
        
        fetcher = ResultFetcher(args.api_base, args.api_token)
        
        try:
            # 提交解析任务（带重试）
            task_data = await self._submit_remote_task_with_retry(args, fetcher)
            task_id = task_data["task_id"]
            
            # 轮询任务状态
            result = await fetcher.poll_task(task_id)
            
            if result["status"] == "completed":
                # 下载结果
                zip_url = result["full_zip_url"]
                output_dir = self.output_base_dir / task_id
                zip_path = await fetcher.download_zip(zip_url, output_dir)
                
                # 解压并构建索引
                index = ZipExtractor.extract(zip_path, output_dir, task_id)
                
                # 验证解压内容
                validation = ZipExtractor.validate_extracted_content(output_dir)
                
                return {
                    "success": True,
                    "mode": "remote_api",
                    "task_id": task_id,
                    "artifacts": index,
                    "validation": validation,
                    "output_dir": str(output_dir)
                }
            else:
                return {
                    "success": False,
                    "mode": "remote_api",
                    "task_id": task_id,
                    "error": result.get("error", "任务失败"),
                    "status": result.get("status")
                }
                
        finally:
            await fetcher.close()
    
    async def _submit_remote_task_with_retry(self, args: MinerUParseArgs, fetcher: ResultFetcher) -> Dict[str, Any]:
        """带重试的远程任务提交"""
        for attempt in range(self.retry_policy.max_retries + 1):
            try:
                return await self._submit_remote_task(args, fetcher)
            except Exception as e:
                if not self.retry_policy.should_retry(attempt, e):
                    raise
                
                if attempt < self.retry_policy.max_retries:
                    delay = self.retry_policy.get_delay(attempt)
                    logger.warning(f"提交任务失败，{delay}秒后重试 (尝试 {attempt + 1}/{self.retry_policy.max_retries}): {e}")
                    await asyncio.sleep(delay)
                else:
                    raise
    
    async def _parse_remote_mcp(self, args: MinerUParseArgs) -> Dict[str, Any]:
        """远程MCP解析"""
        # TODO: 实现MCP远程解析
        raise NotImplementedError("MCP远程解析功能待实现")
    
    async def _submit_remote_task(self, args: MinerUParseArgs, fetcher: ResultFetcher) -> Dict[str, Any]:
        """提交远程解析任务"""
        # 构建请求数据
        request_data = {
            "file_sources": args.file_sources,
            "language": args.language,
            "enable_formula": args.enable_formula,
            "enable_table": args.enable_table,
            "page_ranges": args.page_ranges
        }
        
        if args.callback_url:
            request_data["callback_url"] = args.callback_url
            request_data["callback_secret"] = args.callback_secret
        
        # 提交任务
        response = await fetcher.client.post(
            f"{fetcher.api_base}/extract",
            json=request_data,
            headers={"Authorization": f"Bearer {fetcher.api_token}"}
        )
        response.raise_for_status()
        
        return response.json()
    
    def _generate_task_id(self, file_path: Path) -> str:
        """生成任务ID"""
        content = f"{file_path.name}_{int(time.time() * 1000)}"
        return hashlib.md5(content.encode()).hexdigest()[:12]


class GetOCRLanguagesTool:
    """OCR语言查询工具"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.retry_policy = RetryPolicy(max_retries=2, base_delay=0.5)
    
    async def get_languages(self, args: MinerUOCRLanguagesArgs) -> Dict[str, Any]:
        """
        获取支持的OCR语言列表
        
        Args:
            args: 查询参数
            
        Returns:
            语言列表
        """
        try:
            if args.mode == ParseMode.LOCAL:
                return self._get_local_languages()
            elif args.mode == ParseMode.REMOTE_API:
                return await self._get_remote_languages_with_retry(args)
            else:
                return self._get_local_languages()
                
        except Exception as e:
            logger.error(f"获取OCR语言列表失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "languages": []
            }
    
    def _get_local_languages(self) -> Dict[str, Any]:
        """获取本地支持的语言"""
        languages = [
            {"code": "auto", "name": "自动检测", "description": "自动检测文档语言"},
            {"code": "zh", "name": "中文", "description": "简体中文"},
            {"code": "en", "name": "English", "description": "英语"},
            {"code": "ja", "name": "日本語", "description": "日语"},
            {"code": "ko", "name": "한국어", "description": "韩语"},
            {"code": "fr", "name": "Français", "description": "法语"},
            {"code": "de", "name": "Deutsch", "description": "德语"},
            {"code": "es", "name": "Español", "description": "西班牙语"},
            {"code": "ru", "name": "Русский", "description": "俄语"},
            {"code": "ar", "name": "العربية", "description": "阿拉伯语"},
            {"code": "hi", "name": "हिन्दी", "description": "印地语"},
            {"code": "pt", "name": "Português", "description": "葡萄牙语"},
            {"code": "it", "name": "Italiano", "description": "意大利语"}
        ]
        
        return {
            "success": True,
            "mode": "local",
            "languages": languages,
            "total": len(languages)
        }
    
    async def _get_remote_languages_with_retry(self, args: MinerUOCRLanguagesArgs) -> Dict[str, Any]:
        """带重试的远程语言查询"""
        for attempt in range(self.retry_policy.max_retries + 1):
            try:
                return await self._get_remote_languages(args)
            except Exception as e:
                if not self.retry_policy.should_retry(attempt, e):
                    logger.warning(f"远程语言查询失败，回退到本地列表: {e}")
                    return self._get_local_languages()
                
                if attempt < self.retry_policy.max_retries:
                    delay = self.retry_policy.get_delay(attempt)
                    logger.warning(f"远程语言查询失败，{delay}秒后重试: {e}")
                    await asyncio.sleep(delay)
                else:
                    logger.warning(f"远程语言查询最终失败，回退到本地列表: {e}")
                    return self._get_local_languages()
    
    async def _get_remote_languages(self, args: MinerUOCRLanguagesArgs) -> Dict[str, Any]:
        """获取远程支持的语言"""
        if not args.api_base or not args.api_token:
            return self._get_local_languages()
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{args.api_base.rstrip('/')}/ocr_languages",
                    headers={"Authorization": f"Bearer {args.api_token}"}
                )
                response.raise_for_status()
                
                data = response.json()
                return {
                    "success": True,
                    "mode": "remote_api",
                    "languages": data.get("languages", []),
                    "total": len(data.get("languages", []))
                }
                
        except Exception as e:
            logger.error(f"获取远程OCR语言列表失败: {e}")
            raise


# 工厂函数
def create_mineru_parse_tool(
    server_config: Union[MCPServerConfig, Dict[str, Any]],
    name: str = "mineru_parse_documents",
    organization_id: Optional[str] = None,
) -> RemoteTool:
    """
    创建MinerU文档解析工具
    
    Args:
        server_config: MCP服务器配置
        name: 工具名称
        organization_id: 组织ID
        
    Returns:
        RemoteTool实例
    """
    return RemoteTool(
        server_config=server_config,
        tool_name="parse_documents",
        name=name,
        description="使用 MinerU 服务解析文档（PDF、PPT、DOC等）并转换为结构化格式，支持本地和远程模式",
        args_schema=MinerUParseArgs,
        organization_id=organization_id,
    )


def create_mineru_ocr_languages_tool(
    server_config: Union[MCPServerConfig, Dict[str, Any]],
    name: str = "mineru_ocr_languages",
    organization_id: Optional[str] = None,
) -> RemoteTool:
    """
    创建MinerU OCR语言查询工具
    
    Args:
        server_config: MCP服务器配置
        name: 工具名称
        organization_id: 组织ID
        
    Returns:
        RemoteTool实例
    """
    return RemoteTool(
        server_config=server_config,
        tool_name="get_ocr_languages",
        name=name,
        description="获取 MinerU 支持的 OCR 语言列表，支持本地和远程查询",
        args_schema=MinerUOCRLanguagesArgs,
        organization_id=organization_id,
    )


def create_mineru_tools(
    server_config: Union[MCPServerConfig, Dict[str, Any]],
    organization_id: Optional[str] = None,
) -> List[RemoteTool]:
    """
    创建完整的MinerU工具集
    
    Args:
        server_config: MCP服务器配置
        organization_id: 组织ID
        
    Returns:
        MinerU工具列表
    """
    return [
        create_mineru_parse_tool(server_config, organization_id=organization_id),
        create_mineru_ocr_languages_tool(server_config, organization_id=organization_id)
    ]