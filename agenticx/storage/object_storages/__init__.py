"""
AgenticX Object Storage Module

对象存储抽象层，支持AWS S3、Google Cloud Storage、Azure Blob等。
参考camel设计，提供统一的对象存储接口。
"""

from .base import BaseObjectStorage
from .s3 import S3Storage
from .gcs import GCSStorage
from .azure import AzureStorage

__all__ = [
    "BaseObjectStorage",
    "S3Storage",
    "GCSStorage",
    "AzureStorage",
] 