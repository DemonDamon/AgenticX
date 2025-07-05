"""
即将弃用：MinerU-specific remote tools and configurations.
"""
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field
from .remote import RemoteTool, MCPServerConfig

class MinerUParseArgs(BaseModel):
    file_sources: str = Field(description="文件路径或URL，支持多个文件用逗号分隔")
    language: str = Field(default="ch", description="文档语言，默认中文")
    enable_ocr: bool = Field(default=False, description="是否启用OCR识别")
    page_ranges: Optional[str] = Field(default=None, description="指定页码范围，如'2,4-6'")

class MinerUOCRLanguagesArgs(BaseModel):
    random_string: str = Field(default="dummy", description="占位参数")

def create_mineru_parse_tool(
    server_config: Union[MCPServerConfig, Dict[str, Any]],
    name: str = "mineru_parse_documents",
    organization_id: Optional[str] = None,
) -> RemoteTool:
    return RemoteTool(
        server_config=server_config,
        tool_name="parse_documents",
        name=name,
        description="使用 MinerU 服务解析文档（PDF、PPT、DOC等）并转换为 Markdown 格式",
        args_schema=MinerUParseArgs,
        organization_id=organization_id,
    )

def create_mineru_ocr_languages_tool(
    server_config: Union[MCPServerConfig, Dict[str, Any]],
    name: str = "mineru_ocr_languages",
    organization_id: Optional[str] = None,
) -> RemoteTool:
    return RemoteTool(
        server_config=server_config,
        tool_name="get_ocr_languages",
        name=name,
        description="获取 MinerU 支持的 OCR 语言列表",
        args_schema=MinerUOCRLanguagesArgs,
        organization_id=organization_id,
    )