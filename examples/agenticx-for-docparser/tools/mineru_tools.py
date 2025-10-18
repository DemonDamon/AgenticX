#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
MinerU 文档解析工具封装

基于AgenticX的MinerU工具模块，提供简化的文档解析接口。
这个模块主要作为demo项目的工具层，直接使用AgenticX的现有MinerU工具。
"""

import logging
from typing import Dict, Any, List, Optional

# 导入AgenticX的MinerU工具
from agenticx.tools.mineru import (
    ParseDocumentsTool,
    GetOCRLanguagesTool,
    MinerUParseArgs,
    MinerUOCRLanguagesArgs,
    ParseMode
)

logger = logging.getLogger(__name__)


class MinerUDocumentParser:
    """
    MinerU文档解析器封装类
    
    这是一个简化的封装类，主要用于demo项目。
    实际功能由AgenticX的MinerU工具提供。
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        初始化MinerU文档解析器
        
        Args:
            config: MinerU配置字典
        """
        self.config = config
        self.default_mode = ParseMode(config.get("default_mode", "local"))
        
        # 初始化AgenticX的MinerU工具
        self.parse_tool = ParseDocumentsTool(config)
        self.ocr_languages_tool = GetOCRLanguagesTool(config)
        
        logger.info(f"MinerU文档解析器初始化完成，默认模式: {self.default_mode}")
    
    async def parse_document(
        self,
        file_path: str,
        mode: Optional[str] = None,
        language: Optional[str] = None,
        enable_formula: Optional[bool] = None,
        enable_table: Optional[bool] = None,
        page_ranges: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        解析单个文档
        
        Args:
            file_path: 文档文件路径
            mode: 解析模式 (local/remote_api/remote_mcp)
            language: OCR语言
            enable_formula: 是否启用公式识别
            enable_table: 是否启用表格识别
            page_ranges: 页码范围
            **kwargs: 其他参数
            
        Returns:
            解析结果字典
        """
        try:
            # 确定解析模式
            parse_mode = ParseMode(mode) if mode else self.default_mode
            
            # 构建解析参数
            parse_args = MinerUParseArgs(
                file_sources=[file_path],
                mode=parse_mode,
                language=language or "auto",
                enable_formula=enable_formula if enable_formula is not None else True,
                enable_table=enable_table if enable_table is not None else True,
                page_ranges=page_ranges
            )
            
            logger.info(f"开始解析文档: {file_path}, 模式: {parse_mode}")
            
            # 调用AgenticX的解析工具
            result = await self.parse_tool.parse(parse_args)
            
            logger.info(f"文档解析完成: {file_path}")
            return result
            
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "file_path": file_path
            }
    
    async def get_supported_languages(self, mode: Optional[str] = None) -> List[str]:
        """
        获取支持的OCR语言列表
        
        Args:
            mode: 查询模式
            
        Returns:
            语言列表
        """
        try:
            # 确定查询模式
            query_mode = ParseMode(mode) if mode else self.default_mode
            
            # 构建查询参数
            lang_args = MinerUOCRLanguagesArgs(mode=query_mode)
            
            logger.info(f"获取支持的OCR语言列表，模式: {query_mode}")
            
            # 调用AgenticX的语言查询工具
            result = await self.ocr_languages_tool.get_languages(lang_args)
            
            if result.get("success", False):
                languages = result.get("languages", [])
                logger.info(f"获取到 {len(languages)} 种支持的语言")
                return languages
            else:
                logger.error(f"获取语言列表失败: {result.get('error', '未知错误')}")
                return []
                
        except Exception as e:
            logger.error(f"获取支持语言失败: {e}")
            return []
    
    def get_config(self) -> Dict[str, Any]:
        """获取当前配置"""
        return self.config.copy()
    
    def get_default_mode(self) -> str:
        """获取默认解析模式"""
        return self.default_mode.value


# 为了保持向后兼容性，提供一些便捷函数
async def parse_document_simple(
    file_path: str,
    config: Optional[Dict[str, Any]] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    简单的文档解析函数
    
    Args:
        file_path: 文档文件路径
        config: 配置字典
        **kwargs: 其他解析参数
        
    Returns:
        解析结果
    """
    parser = MinerUDocumentParser(config or {})
    return await parser.parse_document(file_path, **kwargs)


async def get_supported_languages_simple(
    config: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None
) -> List[str]:
    """
    简单的语言查询函数
    
    Args:
        config: 配置字典
        mode: 查询模式
        
    Returns:
        支持的语言列表
    """
    parser = MinerUDocumentParser(config or {})
    return await parser.get_supported_languages(mode)


# 导出主要类和函数
__all__ = [
    "MinerUDocumentParser",
    "parse_document_simple",
    "get_supported_languages_simple"
]