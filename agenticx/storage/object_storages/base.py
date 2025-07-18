"""
AgenticX Object Storage Base Class

参考camel设计，提供统一的对象存储抽象接口。
"""

from abc import ABC, abstractmethod
from pathlib import Path, PurePath
from typing import Tuple, Optional, Any, List, Dict


class File:
    """文件对象模型
    
    用于对象存储的文件抽象。
    """
    
    def __init__(self, content: bytes, filename: str):
        self.content = content
        self.filename = filename


class BaseObjectStorage(ABC):
    """对象存储抽象基类
    
    参考camel设计，提供统一的对象存储接口。
    """

    def object_exists(self, file_path: PurePath) -> bool:
        """检查对象是否存在于存储中
        
        Args:
            file_path: 存储中对象的路径
            
        Returns:
            如果对象存在返回True，否则返回False
        """
        file_key, _ = self.canonicalize_path(file_path)
        return self._object_exists(file_key)

    @staticmethod
    @abstractmethod
    def canonicalize_path(file_path: PurePath) -> Tuple[str, str]:
        """规范化文件路径
        
        Args:
            file_path: 文件路径
            
        Returns:
            (file_key, filename) 元组
        """
        pass

    def put_file(self, file_path: PurePath, file: File) -> None:
        """将文件放入对象存储
        
        Args:
            file_path: 存储中对象的路径
            file: 要放入的文件
        """
        file_key, _ = self.canonicalize_path(file_path)
        self._put_file(file_key, file)

    def get_file(self, file_path: PurePath) -> File:
        """从对象存储获取文件
        
        Args:
            file_path: 存储中对象的路径
            
        Returns:
            从存储中获取的文件对象
        """
        file_key, filename = self.canonicalize_path(file_path)
        return self._get_file(file_key, filename)

    def upload_file(
        self, local_file_path: Path, remote_file_path: PurePath
    ) -> None:
        """将本地文件上传到对象存储
        
        Args:
            local_file_path: 要上传的本地文件路径
            remote_file_path: 存储中对象的路径
        """
        file_key, _ = self.canonicalize_path(remote_file_path)
        # 检查本地文件是否存在
        if not local_file_path.exists():
            raise FileNotFoundError(
                f"本地文件 {local_file_path} 不存在。"
            )
        self._upload_file(local_file_path, file_key)

    def download_file(
        self, local_file_path: Path, remote_file_path: PurePath
    ) -> None:
        """从对象存储下载文件到本地系统
        
        Args:
            local_file_path: 要保存的本地文件路径
            remote_file_path: 存储中对象的路径
        """
        file_key, _ = self.canonicalize_path(remote_file_path)
        self._download_file(local_file_path, file_key)

    def list_objects(self, prefix: str = "") -> List[str]:
        """列出存储中的对象
        
        Args:
            prefix: 对象前缀，默认为空字符串
            
        Returns:
            对象键列表
        """
        return self._list_objects(prefix)

    def delete_object(self, file_path: PurePath) -> bool:
        """删除存储中的对象
        
        Args:
            file_path: 存储中对象的路径
            
        Returns:
            是否删除成功
        """
        file_key, _ = self.canonicalize_path(file_path)
        return self._delete_object(file_key)

    def get_object_url(self, file_path: PurePath, expires_in: int = 3600) -> str:
        """获取对象的预签名URL
        
        Args:
            file_path: 存储中对象的路径
            expires_in: URL过期时间（秒），默认1小时
            
        Returns:
            预签名URL
        """
        file_key, _ = self.canonicalize_path(file_path)
        return self._get_object_url(file_key, expires_in)

    def get_object_size(self, file_path: PurePath) -> int:
        """获取对象大小
        
        Args:
            file_path: 存储中对象的路径
            
        Returns:
            对象大小（字节）
        """
        file_key, _ = self.canonicalize_path(file_path)
        return self._get_object_size(file_key)

    def get_object_metadata(self, file_path: PurePath) -> Dict[str, Any]:
        """获取对象元数据
        
        Args:
            file_path: 存储中对象的路径
            
        Returns:
            对象元数据字典
        """
        file_key, _ = self.canonicalize_path(file_path)
        return self._get_object_metadata(file_key)

    @abstractmethod
    def _put_file(self, file_key: str, file: File) -> None:
        """内部方法：将文件放入存储"""
        pass

    @abstractmethod
    def _get_file(self, file_key: str, filename: str) -> File:
        """内部方法：从存储获取文件"""
        pass

    @abstractmethod
    def _object_exists(self, file_key: str) -> bool:
        """内部方法：检查对象是否存在"""
        pass

    @abstractmethod
    def _upload_file(
        self, local_file_path: Path, remote_file_key: str
    ) -> None:
        """内部方法：上传文件"""
        pass

    @abstractmethod
    def _download_file(
        self,
        local_file_path: Path,
        remote_file_key: str,
    ) -> None:
        """内部方法：下载文件"""
        pass

    @abstractmethod
    def _list_objects(self, prefix: str) -> List[str]:
        """内部方法：列出对象"""
        pass

    @abstractmethod
    def _delete_object(self, file_key: str) -> bool:
        """内部方法：删除对象"""
        pass

    @abstractmethod
    def _get_object_url(self, file_key: str, expires_in: int) -> str:
        """内部方法：获取对象URL"""
        pass

    @abstractmethod
    def _get_object_size(self, file_key: str) -> int:
        """内部方法：获取对象大小"""
        pass

    @abstractmethod
    def _get_object_metadata(self, file_key: str) -> Dict[str, Any]:
        """内部方法：获取对象元数据"""
        pass

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close()

    def close(self) -> None:
        """关闭对象存储连接"""
        pass 