"""
文档路由逻辑

根据文件扩展名路由到不同的文档处理器。
参考：OWL 的 DocumentProcessingToolkit 路由机制
"""

import os
import json
import logging
from typing import Tuple, Optional, Dict, Type, Callable
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


class DocumentRouter:
    """文档路由器
    
    根据文件扩展名或 URL 类型路由到不同的处理器。
    """
    
    def __init__(self):
        """初始化路由器"""
        self._processors: Dict[Tuple[str, ...], Callable] = {}
        self._fallback_processor: Optional[Callable] = None
    
    def register_processor(
        self,
        extensions: Tuple[str, ...],
        processor: Callable[[str], Tuple[bool, str]]
    ):
        """
        注册文档处理器
        
        Args:
            extensions: 文件扩展名元组（如 (".pdf", ".docx")）
            processor: 处理器函数，接受文件路径，返回 (success, content)
        """
        self._processors[extensions] = processor
        logger.debug(f"Registered processor for extensions: {extensions}")
    
    def set_fallback_processor(self, processor: Callable[[str], Tuple[bool, str]]):
        """
        设置降级处理器
        
        Args:
            processor: 降级处理器函数
        """
        self._fallback_processor = processor
    
    def route(self, path: str) -> Tuple[bool, str]:
        """
        路由文档到对应的处理器
        
        Args:
            path: 文档路径（本地路径或 URL）
            
        Returns:
            (success, content) 元组
        """
        # 检查是否是网页
        if self._is_webpage(path):
            return self._route_webpage(path)
        
        # 获取文件扩展名
        ext = Path(path).suffix.lower()
        
        # 查找匹配的处理器
        for extensions, processor in self._processors.items():
            if ext in extensions:
                try:
                    logger.debug(f"Routing {path} to processor for {extensions}")
                    return processor(path)
                except Exception as e:
                    logger.warning(f"Processor for {extensions} failed: {e}")
                    # 继续尝试下一个处理器或降级
        
        # 如果没有找到匹配的处理器，使用降级处理器
        if self._fallback_processor:
            logger.debug(f"Using fallback processor for {path}")
            try:
                return self._fallback_processor(path)
            except Exception as e:
                logger.error(f"Fallback processor failed: {e}")
                return False, f"Failed to process document: {e}"
        
        return False, f"No processor found for extension: {ext}"
    
    def _is_webpage(self, url: str) -> bool:
        """判断是否是网页 URL"""
        try:
            parsed_url = urlparse(url)
            return bool(parsed_url.scheme and parsed_url.netloc)
        except Exception:
            return False
    
    def _route_webpage(self, url: str) -> Tuple[bool, str]:
        """路由网页 URL"""
        # 查找网页处理器
        for extensions, processor in self._processors.items():
            if "http" in extensions or "https" in extensions or "url" in extensions:
                try:
                    return processor(url)
                except Exception as e:
                    logger.warning(f"Webpage processor failed: {e}")
        
        # 如果没有专门的网页处理器，使用降级处理器
        if self._fallback_processor:
            return self._fallback_processor(url)
        
        return False, "No webpage processor available"


# 默认处理器实现

def process_json_file(path: str) -> Tuple[bool, str]:
    """处理 JSON 文件"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = json.load(f)
        return True, json.dumps(content, ensure_ascii=False, indent=2)
    except Exception as e:
        return False, f"Failed to read JSON file: {e}"


def process_python_file(path: str) -> Tuple[bool, str]:
    """处理 Python 文件"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return True, content
    except Exception as e:
        return False, f"Failed to read Python file: {e}"


def process_xml_file(path: str) -> Tuple[bool, str]:
    """处理 XML 文件"""
    try:
        import xmltodict
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        try:
            data = xmltodict.parse(content)
            return True, json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            # 如果解析失败，返回原始内容
            return True, content
    except ImportError:
        # 如果没有 xmltodict，返回原始内容
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return True, content
        except Exception as e:
            return False, f"Failed to read XML file: {e}"
    except Exception as e:
        return False, f"Failed to process XML file: {e}"


def process_zip_file(path: str) -> Tuple[bool, str]:
    """处理 ZIP 文件"""
    try:
        import zipfile
        extracted_files = []
        with zipfile.ZipFile(path, 'r') as zip_ref:
            for file_info in zip_ref.namelist():
                extracted_files.append(file_info)
        return True, f"The extracted files are: {', '.join(extracted_files)}"
    except Exception as e:
        return False, f"Failed to extract ZIP file: {e}"


def create_default_router() -> DocumentRouter:
    """创建默认的路由器（包含基本处理器）"""
    router = DocumentRouter()
    
    # 注册基本处理器
    router.register_processor((".json", ".jsonl", ".jsonld"), process_json_file)
    router.register_processor((".py",), process_python_file)
    router.register_processor((".xml",), process_xml_file)
    router.register_processor((".zip",), process_zip_file)
    
    return router
