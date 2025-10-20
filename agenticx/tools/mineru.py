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
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Literal
from urllib.parse import urlparse
from dataclasses import dataclass, field
from enum import Enum

import httpx
from pydantic import BaseModel, Field, validator

from .remote import RemoteTool, MCPServerConfig, MCPClient
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
            "model_json": "*_model.json",
            "middle_json": "*_middle.json", 
            "content_list_json": "*_content_list.json",
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
        content_list_files = list(outputs_dir.glob("*_content_list.json"))
        if content_list_files:
            content_list_path = content_list_files[0]
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
        # 配置更宽松的httpx客户端
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=60.0, read=60.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            follow_redirects=True,
            verify=False  # 暂时禁用SSL验证以排除SSL问题
        )
    
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
                    f"{self.api_base}/extract/task/{task_id}",
                    headers={
                        "Authorization": f"Bearer {self.api_token}",
                        "Content-Type": "application/json",
                        "Accept": "*/*"
                    }
                )
                response.raise_for_status()
                
                data = response.json()
                logger.debug(f"轮询响应数据: {data}")
                
                # 处理官方API的响应格式
                if data.get("code") == 0 and "data" in data:
                    task_data = data["data"]
                    state = task_data.get("state", "").lower()
                    logger.debug(f"任务状态: {state}, 完整数据: {task_data}")
                    
                    if state == "done":
                        # 任务完成，返回完整的任务数据
                        full_zip_url = task_data.get("full_zip_url")
                        logger.info(f"任务完成，ZIP URL: {full_zip_url}")
                        return {
                            "status": "completed",
                            "task_id": task_id,
                            "full_zip_url": full_zip_url,
                            "markdown_url": task_data.get("markdown_url"),
                            "data": task_data
                        }
                    elif state == "failed":
                        # 任务失败
                        return {
                            "status": "failed",
                            "task_id": task_id,
                            "error": task_data.get("error", "任务失败"),
                            "data": task_data
                        }
                    elif state in ["pending", "running", "converting"]:
                        # 任务进行中
                        logger.info(f"任务 {task_id} 状态: {state}")
                        await asyncio.sleep(interval_s)
                        continue
                    else:
                        # 未知状态，继续等待
                        logger.warning(f"任务 {task_id} 未知状态: {state}")
                        await asyncio.sleep(interval_s)
                        continue
                else:
                    # API调用失败
                    error_msg = data.get("msg", "API调用失败")
                    raise ValueError(f"API响应错误: {error_msg}")
                
            except Exception as e:
                logger.error(f"轮询任务状态失败 (尝试 {attempt + 1}): {e}")
                if attempt == max_attempts - 1:
                    raise
                await asyncio.sleep(interval_s)
        
        raise TimeoutError(f"任务 {task_id} 轮询超时")
    
    async def poll_batch_task(self, batch_id: str, interval_s: int = 3, max_attempts: int = 100) -> Dict[str, Any]:
        """
        轮询批量任务状态
        
        Args:
            batch_id: 批量任务ID
            interval_s: 轮询间隔（秒）
            max_attempts: 最大尝试次数
            
        Returns:
            批量任务状态信息
        """
        for attempt in range(max_attempts):
            try:
                response = await self.client.get(
                    f"{self.api_base}/extract-results/batch/{batch_id}",
                    headers={
                        "Authorization": f"Bearer {self.api_token}",
                        "Content-Type": "application/json",
                        "Accept": "*/*"
                    }
                )
                response.raise_for_status()
                
                data = response.json()
                logger.debug(f"批量任务轮询响应数据: {data}")
                
                # 处理批量任务API的响应格式
                if data.get("code") == 0 and "data" in data:
                    extract_results = data["data"].get("extract_result", [])
                    if not extract_results:
                        logger.warning(f"批量任务 {batch_id} 暂无结果，继续等待")
                        await asyncio.sleep(interval_s)
                        continue
                    
                    # 获取第一个文件的解析结果
                    result = extract_results[0]
                    state = result.get("state", "").lower()
                    logger.debug(f"批量任务状态: {state}, 完整数据: {result}")
                    
                    if state == "done":
                        # 批量任务完成，返回完整的任务数据
                        full_zip_url = result.get("full_zip_url")
                        logger.info(f"批量任务完成，ZIP URL: {full_zip_url}")
                        return {
                            "status": "completed",
                            "task_id": batch_id,
                            "full_zip_url": full_zip_url,
                            "data": result
                        }
                    elif state == "failed":
                        # 批量任务失败
                        error_msg = result.get("err_msg", "批量任务失败")
                        return {
                            "status": "failed",
                            "task_id": batch_id,
                            "error": error_msg,
                            "data": result
                        }
                    elif state in ["pending", "running", "converting"]:
                        # 批量任务进行中
                        progress = result.get("extract_progress", {})
                        extracted_pages = progress.get("extracted_pages", 0)
                        total_pages = progress.get("total_pages", 0)
                        logger.info(f"批量任务 {batch_id} 状态: {state}, 进度: {extracted_pages}/{total_pages}")
                        await asyncio.sleep(interval_s)
                        continue
                    else:
                        # 未知状态，继续等待
                        logger.warning(f"批量任务 {batch_id} 未知状态: {state}")
                        await asyncio.sleep(interval_s)
                        continue
                else:
                    # API调用失败
                    error_msg = data.get("msg", "批量任务API调用失败")
                    raise ValueError(f"批量任务API响应错误: {error_msg}")
                
            except Exception as e:
                logger.error(f"轮询批量任务状态失败 (尝试 {attempt + 1}): {e}")
                if attempt == max_attempts - 1:
                    raise
                await asyncio.sleep(interval_s)
        
        raise TimeoutError(f"批量任务 {batch_id} 轮询超时")
    
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
                f"{self.api_base}/extract-results/batch/{batch_id}",
                headers={"Authorization": f"Bearer {self.api_token}"}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"获取批量任务状态失败: {e}")
            raise
    
    async def download_zip_with_curl(self, zip_url: str, dst_dir: Path) -> Path:
        """
        使用curl命令下载ZIP文件
        """
        import subprocess
        
        dst_dir.mkdir(parents=True, exist_ok=True)
        zip_filename = f"result_{int(time.time())}.zip"
        zip_path = dst_dir / zip_filename
        
        logger.info(f"开始下载ZIP文件（使用curl）: {zip_url}")
        try:
            # 使用curl命令下载文件
            cmd = [
                'curl',
                '-L',  # 跟随重定向
                '-k',  # 忽略SSL证书错误
                '--connect-timeout', '60',
                '--max-time', '300',
                '-o', str(zip_path),
                zip_url
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            if result.returncode != 0:
                raise Exception(f"curl命令失败: {result.stderr}")
            
            if not zip_path.exists():
                raise Exception("下载的文件不存在")
            
            file_size = zip_path.stat().st_size
            logger.info(f"ZIP文件下载完成: {zip_path} ({file_size} bytes)")
            return zip_path
            
        except Exception as e:
            logger.error(f"ZIP文件下载失败: {e}")
            logger.error(f"异常类型: {type(e).__name__}")
            logger.error(f"异常详情: {str(e)}")
            logger.error(f"堆栈跟踪: {traceback.format_exc()}")
            logger.error(f"ZIP URL: {zip_url}")
            logger.error(f"目标路径: {zip_path}")
            # 清理失败的下载文件
            if zip_path.exists():
                zip_path.unlink()
            raise

    async def download_zip_with_urllib(self, zip_url: str, dst_dir: Path) -> Path:
        """
        使用urllib下载ZIP文件（同步方式）
        """
        import urllib.request
        import urllib.error
        import ssl
        
        dst_dir.mkdir(parents=True, exist_ok=True)
        zip_filename = f"result_{int(time.time())}.zip"
        zip_path = dst_dir / zip_filename
        
        logger.info(f"开始下载ZIP文件（使用urllib）: {zip_url}")
        try:
            # 创建不验证SSL的上下文
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            # 创建请求
            req = urllib.request.Request(
                zip_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            )
            
            with urllib.request.urlopen(req, context=ssl_context, timeout=60) as response:
                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0
                logger.info(f"文件大小: {total_size} bytes")
                
                with open(zip_path, "wb") as f:
                    while True:
                        chunk = response.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            logger.debug(f"下载进度: {progress:.1f}%")
            
            logger.info(f"ZIP文件下载完成: {zip_path} ({downloaded} bytes)")
            return zip_path
            
        except Exception as e:
            logger.error(f"ZIP文件下载失败: {e}")
            logger.error(f"异常类型: {type(e).__name__}")
            logger.error(f"异常详情: {str(e)}")
            logger.error(f"堆栈跟踪: {traceback.format_exc()}")
            logger.error(f"ZIP URL: {zip_url}")
            logger.error(f"目标路径: {zip_path}")
            # 清理失败的下载文件
            if zip_path.exists():
                zip_path.unlink()
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
        
        logger.info(f"开始下载ZIP文件: {zip_url}")
        try:
            logger.debug(f"发起HTTP请求到: {zip_url}")
            async with self.client.stream("GET", zip_url) as response:
                logger.info(f"HTTP响应状态: {response.status_code}")
                response.raise_for_status()
                
                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0
                logger.info(f"文件大小: {total_size} bytes")
                
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
            logger.error(f"异常类型: {type(e).__name__}")
            logger.error(f"异常详情: {str(e)}")
            logger.error(f"堆栈跟踪: {traceback.format_exc()}")
            logger.error(f"ZIP URL: {zip_url}")
            logger.error(f"目标路径: {zip_path}")
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
                
                # 生成任务ID和输出目录名
                task_id = self._generate_task_id(file_path)
                output_dir_name = self._generate_output_dir_name(file_path)
                output_dir = self.output_base_dir / output_dir_name
                
                # 执行解析（带重试）
                parse_result = await self._parse_with_retry(
                    adapter, file_path, output_dir, args
                )
                
                # 处理ParseResult对象
                if hasattr(parse_result, 'success'):
                    # 这是一个ParseResult对象
                    if not parse_result.success:
                        error_msg = f"解析文件 {file_source} 失败: {parse_result.error_message}"
                        logger.error(error_msg)
                        errors.append(error_msg)
                        continue
                    
                    # 使用ParseResult中的实际输出目录
                    actual_output_dir = Path(parse_result.output_dir)
                    
                    # 检查是否有子目录（MinerUAdapter可能创建子目录）
                    if actual_output_dir.exists():
                        subdirs = [d for d in actual_output_dir.iterdir() if d.is_dir()]
                        if len(subdirs) == 1:
                            # 如果只有一个子目录，使用子目录作为实际的输出目录
                            actual_output_dir = subdirs[0]
                    
                    # 构建索引
                    index = ArtifactIndex.from_outputs(actual_output_dir, task_id)
                    
                    # 验证解压内容
                    validation = ZipExtractor.validate_extracted_content(actual_output_dir)
                    
                    results.append({
                        "task_id": task_id,
                        "source_file": str(file_path),
                        "output_dir": str(actual_output_dir),
                        "artifacts": index,
                        "validation": validation,
                        "success": True
                    })
                else:
                    # 这是一个字典结果（旧格式）
                    # 检查是否有子目录（MinerUAdapter可能创建子目录）
                    actual_output_dir = output_dir
                    if output_dir.exists():
                        # 查找可能的子目录
                        subdirs = [d for d in output_dir.iterdir() if d.is_dir()]
                        if len(subdirs) == 1:
                            actual_output_dir = subdirs[0]
                    
                    # 构建索引
                    index = ArtifactIndex.from_outputs(actual_output_dir, task_id)
                    
                    # 验证解压内容
                    validation = ZipExtractor.validate_extracted_content(actual_output_dir)
                    
                    results.append({
                        "task_id": task_id,
                        "source_file": str(file_path),
                        "output_dir": str(actual_output_dir),
                        "artifacts": index,
                        "validation": validation,
                        "success": True
                    })
                
            except Exception as e:
                error_msg = f"解析文件 {file_source} 失败: {e}"
                logger.error(error_msg)
                errors.append(error_msg)
        
        # 如果只有一个文件，返回简化的结果格式
        if len(args.file_sources) == 1:
            if len(results) == 1:
                # 解析成功
                result = results[0]
                return {
                    "success": True,
                    "mode": "local",
                    "task_id": result["task_id"],
                    "output_dir": result.get("output_dir", str(self.output_base_dir / self._generate_output_dir_name(Path(args.file_sources[0])))),
                    "artifacts": result["artifacts"].artifacts if hasattr(result["artifacts"], 'artifacts') else {},
                    "metadata": result["artifacts"].metadata if hasattr(result["artifacts"], 'metadata') else {},
                    "source_file": result["source_file"],
                    "validation": result["validation"]
                }
            else:
                # 解析失败
                error_msg = errors[0] if errors else "解析失败"
                return {
                    "success": False,
                    "mode": "local",
                    "error": error_msg,
                    "task_id": None,
                    "artifacts": None
                }
        
        # 多文件情况返回完整结果
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
            logger.info(f"任务提交响应: {task_data}")
            
            # 安全地获取task_id
            if "task_id" not in task_data:
                logger.error(f"API响应中缺少task_id: {task_data}")
                raise ValueError(f"API响应格式错误，缺少task_id: {task_data}")
            
            task_id = task_data["task_id"]
            is_batch = task_data.get("is_batch", False)
            
            # 轮询任务状态（根据是否为批量任务选择不同的轮询方法）
            if is_batch:
                result = await fetcher.poll_batch_task(task_id)
            else:
                result = await fetcher.poll_task(task_id)
            
            if result["status"] == "completed":
                # 下载结果
                zip_url = result["full_zip_url"]
                if not zip_url:
                    raise ValueError(f"API返回的ZIP URL为空: {result}")
                # 为远程API生成带文件名的输出目录
                if args.file_sources:
                    first_file = Path(args.file_sources[0] if isinstance(args.file_sources, list) else args.file_sources)
                    output_dir_name = self._generate_output_dir_name(first_file)
                    output_dir = self.output_base_dir / output_dir_name
                else:
                    output_dir = self.output_base_dir / task_id
                zip_path = await fetcher.download_zip_with_curl(zip_url, output_dir)
                
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
        try:
            # 从配置中获取MCP服务器配置
            mcp_config = self.config.get("mcp", {})
            server_config_dict = mcp_config.get("server", {})
            
            # 如果配置中没有MCP配置，使用默认配置
            if not server_config_dict:
                logger.warning("配置中未找到MCP服务器配置，使用默认配置")
                server_config_dict = {
                    "command": "mineru-mcp",
                    "args": ["--transport", "stdio"],
                    "timeout": 300.0,
                    "env": {}
                }
            
            # 构建环境变量
            env_config = server_config_dict.get("env", {})
            env_vars = {
                "MINERU_API_BASE": env_config.get("MINERU_API_BASE", args.api_base or "https://mineru.net"),
                "MINERU_API_KEY": env_config.get("MINERU_API_KEY", args.api_token or os.environ.get("MINERU_API_TOKEN", "")),
                "OUTPUT_DIR": env_config.get("OUTPUT_DIR", str(self.output_base_dir))
            }
            
            # 添加其他环境变量
            for key, value in env_config.items():
                if key not in env_vars:
                    env_vars[key] = value
            
            # 创建 MCP 服务器配置
            server_config = MCPServerConfig(
                name=server_config_dict.get("name", "mineru-mcp"),
                command=server_config_dict.get("command", "python"),
                args=server_config_dict.get("args", ["-m", "mineru.cli", "--transport", "stdio"]),
                env=env_vars,
                timeout=server_config_dict.get("timeout", args.timeout if hasattr(args, 'timeout') else 300.0)
            )
            
            # 创建 MCP 客户端
            from .remote import MCPClient
            client = MCPClient(server_config)
            
            # 创建 parse_documents 工具
            parse_tool = await client.create_tool("parse_documents")
            
            # 准备调用参数
            file_sources_str = args.file_sources
            if isinstance(args.file_sources, list):
                file_sources_str = ", ".join(args.file_sources)
            
            mcp_params = {
                "file_sources": file_sources_str,
                "enable_ocr": True,  # MCP 服务器默认启用 OCR
                "language": args.language,
            }
            
            # 添加页码范围参数（如果提供）
            if args.page_ranges:
                mcp_params["page_ranges"] = args.page_ranges
            
            logger.info(f"准备调用 MCP parse_documents 工具")
            logger.info(f"MCP 服务器配置: {server_config}")
            logger.info(f"解析工具对象: {parse_tool}")
            logger.info(f"调用 MCP parse_documents 工具，参数: {mcp_params}")
            
            # 调用 MCP 工具
            logger.info(f"开始执行 MCP 工具调用...")
            start_time = time.time()
            try:
                # 添加超时控制
                timeout = getattr(server_config, 'timeout', 300.0)
                mcp_result = await asyncio.wait_for(
                    parse_tool._arun(**mcp_params),
                    timeout=timeout
                )
                end_time = time.time()
                logger.info(f"MCP 工具调用完成，耗时: {end_time - start_time:.2f}秒")
            except asyncio.TimeoutError:
                end_time = time.time()
                logger.error(f"MCP 工具调用超时，耗时: {end_time - start_time:.2f}秒")
                
                # 检查是否有输出文件生成（即使超时）
                if args.file_sources:
                    first_file = Path(args.file_sources[0] if isinstance(args.file_sources, list) else args.file_sources)
                    task_id = self._generate_task_id(first_file)
                    output_dir_name = self._generate_output_dir_name(first_file)
                    output_dir = self.output_base_dir / output_dir_name
                    
                    if output_dir.exists() and any(output_dir.iterdir()):
                        logger.info(f"检测到输出文件已生成，尝试恢复结果: {output_dir}")
                        try:
                            # 尝试从输出目录恢复结果
                            index = ArtifactIndex.from_outputs(output_dir, task_id)
                            validation = ZipExtractor.validate_extracted_content(output_dir)
                            
                            return {
                                "success": True,
                                "mode": "remote_mcp",
                                "task_id": task_id,
                                "artifacts": index,
                                "validation": validation,
                                "output_dir": str(output_dir),
                                "warning": "MCP工具调用超时，但已从输出文件恢复结果"
                            }
                        except Exception as recovery_error:
                            logger.error(f"从输出文件恢复结果失败: {recovery_error}")
                
                raise Exception(f"MCP 工具调用超时 ({timeout}秒)")
            except Exception as call_error:
                end_time = time.time()
                logger.error(f"MCP 工具调用异常，耗时: {end_time - start_time:.2f}秒")
                logger.error(f"调用异常详情: {call_error}")
                logger.error(f"异常类型: {type(call_error).__name__}")
                
                # 检查是否有输出文件生成（即使异常）
                if args.file_sources:
                    first_file = Path(args.file_sources[0] if isinstance(args.file_sources, list) else args.file_sources)
                    task_id = self._generate_task_id(first_file)
                    output_dir_name = self._generate_output_dir_name(first_file)
                    output_dir = self.output_base_dir / output_dir_name
                    
                    if output_dir.exists() and any(output_dir.iterdir()):
                        logger.info(f"检测到输出文件已生成，尝试恢复结果: {output_dir}")
                        try:
                            # 尝试从输出目录恢复结果
                            index = ArtifactIndex.from_outputs(output_dir, task_id)
                            validation = ZipExtractor.validate_extracted_content(output_dir)
                            
                            return {
                                "success": True,
                                "mode": "remote_mcp",
                                "task_id": task_id,
                                "artifacts": index,
                                "validation": validation,
                                "output_dir": str(output_dir),
                                "warning": f"MCP工具调用异常({type(call_error).__name__})，但已从输出文件恢复结果"
                            }
                        except Exception as recovery_error:
                            logger.error(f"从输出文件恢复结果失败: {recovery_error}")
                
                raise call_error
            
            logger.info(f"MCP 工具调用结果: {mcp_result}")
            
            # 检查 MCP 调用结果
            if not mcp_result or mcp_result.get("status") != "success":
                error_msg = mcp_result.get("error", "MCP 调用失败") if mcp_result else "MCP 调用返回空结果"
                return {
                    "success": False,
                    "mode": "remote_mcp",
                    "error": error_msg,
                    "mcp_result": mcp_result
                }
            
            # 生成任务 ID
            if args.file_sources:
                first_file = Path(args.file_sources[0] if isinstance(args.file_sources, list) else args.file_sources)
                task_id = self._generate_task_id(first_file)
                output_dir_name = self._generate_output_dir_name(first_file)
                output_dir = self.output_base_dir / output_dir_name
            else:
                task_id = f"mcp_{int(time.time())}"
                output_dir = self.output_base_dir / task_id
            
            # 确保输出目录存在
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # 处理 MCP 返回的结果
            if "content" in mcp_result:
                # 单文件结果，直接保存内容
                content = mcp_result["content"]
                
                # 保存 Markdown 文件
                md_file = output_dir / f"{task_id}.md"
                with open(md_file, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                # 创建工件索引
                artifacts = {
                    "markdown": [str(md_file.relative_to(output_dir))],
                    "content": content
                }
                
                index = ArtifactIndex(
                    task_id=task_id,
                    source_files=[file_sources_str],
                    output_dir=str(output_dir),
                    artifacts=artifacts,
                    metadata={
                        "mode": "remote_mcp",
                        "language": args.language,
                        "enable_formula": args.enable_formula,
                        "enable_table": args.enable_table,
                        "page_ranges": args.page_ranges
                    }
                )
                
            elif "results" in mcp_result:
                # 多文件结果
                results = mcp_result["results"]
                artifacts = {"markdown": [], "results": results}
                
                # 保存每个文件的结果
                for i, result in enumerate(results):
                    if result.get("status") == "success" and "content" in result:
                        md_file = output_dir / f"{task_id}_file_{i+1}.md"
                        with open(md_file, 'w', encoding='utf-8') as f:
                            f.write(result["content"])
                        artifacts["markdown"].append(str(md_file.relative_to(output_dir)))
                
                index = ArtifactIndex(
                    task_id=task_id,
                    source_files=[file_sources_str],
                    output_dir=str(output_dir),
                    artifacts=artifacts,
                    metadata={
                        "mode": "remote_mcp",
                        "language": args.language,
                        "enable_formula": args.enable_formula,
                        "enable_table": args.enable_table,
                        "page_ranges": args.page_ranges,
                        "file_count": len(results)
                    }
                )
            else:
                # 未知结果格式
                return {
                    "success": False,
                    "mode": "remote_mcp",
                    "error": "MCP 返回的结果格式不支持",
                    "mcp_result": mcp_result
                }
            
            # 验证输出内容
            validation = ZipExtractor.validate_extracted_content(output_dir)
            
            return {
                "success": True,
                "mode": "remote_mcp",
                "task_id": task_id,
                "artifacts": index,
                "validation": validation,
                "output_dir": str(output_dir),
                "mcp_result": mcp_result
            }
            
        except Exception as e:
            logger.error(f"MCP 远程解析失败: {e}")
            logger.error(f"异常类型: {type(e).__name__}")
            logger.error(f"异常模块: {e.__class__.__module__}")
            logger.error(f"错误详情: {traceback.format_exc()}")
            
            # 检查是否是特定类型的异常
            if "timeout" in str(e).lower():
                logger.error("检测到超时异常，可能是MCP服务器响应超时")
            elif "connection" in str(e).lower():
                logger.error("检测到连接异常，可能是MCP服务器连接问题")
            elif "json" in str(e).lower():
                logger.error("检测到JSON解析异常，可能是MCP服务器返回格式问题")
            
            return {
                "success": False,
                "mode": "remote_mcp",
                "error": f"MCP 远程解析异常: {str(e)}",
                "error_type": type(e).__name__,
                "error_module": e.__class__.__module__
            }
    
    async def _submit_remote_task(self, args: MinerUParseArgs, fetcher: ResultFetcher) -> Dict[str, Any]:
        """提交远程解析任务 - 支持URL和本地文件上传"""
        # 获取第一个文件源（官方API一次只能处理一个文件）
        file_source = args.file_sources[0] if isinstance(args.file_sources, list) else args.file_sources
        
        # 判断是本地文件还是URL
        if self._is_url(file_source):
            # 直接使用URL提交单文件解析任务
            return await self._submit_url_task(file_source, args, fetcher)
        else:
            # 本地文件使用批量文件上传API
            return await self._upload_local_file(file_source, args, fetcher)
    
    async def _submit_url_task(self, file_url: str, args: MinerUParseArgs, fetcher: ResultFetcher) -> Dict[str, Any]:
        """提交URL文件解析任务"""
        # 构建符合官方API格式的请求数据
        request_data = {
            "url": file_url,  # 官方API使用 "url" 字段
            "is_ocr": True,   # 启用OCR
            "enable_formula": args.enable_formula,
            "enable_table": args.enable_table
        }
        
        # 添加语言参数（如果不是auto）
        if args.language and args.language != "auto":
            request_data["language"] = args.language
            
        # 添加页码范围（如果指定）
        if args.page_ranges:
            request_data["page_ranges"] = args.page_ranges
        
        logger.info(f"提交URL解析任务，请求数据: {request_data}")
        
        # 提交任务到正确的端点
        response = await fetcher.client.post(
            f"{fetcher.api_base}/extract/task",
            json=request_data,
            headers={
                "Authorization": f"Bearer {fetcher.api_token}",
                "Content-Type": "application/json",
                "Accept": "*/*"
            }
        )
        response.raise_for_status()
        
        data = response.json()
        logger.info(f"API响应数据: {data}")
        
        # 处理官方API的响应格式
        if data.get("code") == 0 and "data" in data:
            task_id = data["data"].get("task_id")
            if task_id:
                return {"task_id": task_id}
            else:
                raise ValueError(f"API响应中缺少task_id: {data}")
        else:
            raise ValueError(f"API请求失败: {data}")
    
    async def _upload_local_file(self, file_path: str, args: MinerUParseArgs, fetcher: ResultFetcher) -> Dict[str, Any]:
        """上传本地文件并提交解析任务"""
        from pathlib import Path
        
        file_path_obj = Path(file_path)
        if not file_path_obj.exists():
            raise ValueError(f"文件不存在: {file_path}")
        
        # 1. 获取文件上传URL
        upload_request = {
            "files": [
                {
                    "name": file_path_obj.name,
                    "is_ocr": True,
                    "data_id": f"upload_{int(time.time())}"
                }
            ],
            "enable_formula": args.enable_formula,
            "enable_table": args.enable_table
        }
        
        # 添加语言参数（如果不是auto）
        if args.language and args.language != "auto":
            upload_request["language"] = args.language
            
        # 添加页码范围（如果指定）
        if args.page_ranges:
            upload_request["page_ranges"] = args.page_ranges
        
        logger.info(f"请求文件上传URL，数据: {upload_request}")
        
        response = await fetcher.client.post(
            f"{fetcher.api_base}/file-urls/batch",
            json=upload_request,
            headers={
                "Authorization": f"Bearer {fetcher.api_token}",
                "Content-Type": "application/json",
                "Accept": "*/*"
            }
        )
        response.raise_for_status()
        
        upload_data = response.json()
        logger.info(f"上传URL响应: {upload_data}")
        
        if upload_data.get("code") != 0 or "data" not in upload_data:
            raise ValueError(f"获取上传URL失败: {upload_data}")
        
        batch_data = upload_data["data"]
        batch_id = batch_data.get("batch_id")
        file_urls = batch_data.get("file_urls", [])
        
        if not batch_id or not file_urls:
            raise ValueError(f"响应中缺少batch_id或file_urls: {batch_data}")
        
        # 2. 上传文件到获取的URL
        upload_url = file_urls[0]  # file_urls 是字符串列表，不是字典列表
        logger.info(f"上传文件到: {upload_url}")
        
        with open(file_path, 'rb') as f:
            file_content = f.read()
        
        upload_response = await fetcher.client.put(
            upload_url,
            content=file_content,
            headers={
                # 不设置Content-Type，让系统自动检测
            }
        )
        upload_response.raise_for_status()
        
        logger.info(f"文件上传成功，batch_id: {batch_id}")
        
        # 返回batch_id作为task_id，用于后续状态查询
        return {"task_id": batch_id, "is_batch": True}
    
    def _is_url(self, path: str) -> bool:
        """判断是否为URL"""
        return path.startswith(('http://', 'https://'))
    

    
    def _generate_task_id(self, file_path: Path) -> str:
        """生成任务ID"""
        content = f"{file_path.name}_{int(time.time() * 1000)}"
        return hashlib.md5(content.encode()).hexdigest()[:12]
    
    def _generate_output_dir_name(self, file_path: Path) -> str:
        """生成输出目录名称，格式为：文件名-UUID"""
        # 获取文件名（不含扩展名）
        file_stem = file_path.stem
        # 生成UUID
        task_id = self._generate_task_id(file_path)
        # 清理文件名中的特殊字符，确保目录名有效
        safe_filename = "".join(c for c in file_stem if c.isalnum() or c in (' ', '-', '_', '.')).strip()
        # 替换空格为下划线
        safe_filename = safe_filename.replace(' ', '_')
        # 组合文件名和UUID
        return f"{safe_filename}-{task_id}"


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