"""
CredentialStore: 安全的凭据管理器

提供加密存储和检索 API 密钥等敏感信息的功能，支持多租户隔离。
"""

import json
import logging
import os
from typing import Any, Dict, Optional
from pathlib import Path

try:
    from cryptography.fernet import Fernet
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logger = logging.getLogger(__name__)


class CredentialError(Exception):
    """凭据相关错误的基类"""
    pass


class CredentialStore:
    """
    安全的凭据管理器
    
    支持加密存储 API 密钥等敏感信息，并提供多租户隔离
    """
    
    def __init__(
        self,
        storage_path: Optional[str] = None,
        encryption_key: Optional[str] = None,
        enable_encryption: bool = True,
    ):
        """
        初始化凭据存储
        
        Args:
            storage_path: 存储文件路径，默认为用户目录下的 .agenticx/credentials
            encryption_key: 加密密钥，如果为 None 则自动生成
            enable_encryption: 是否启用加密
        """
        # 设置存储路径
        if storage_path is None:
            storage_path_str = str(Path.home() / ".agenticx" / "credentials")
        else:
            storage_path_str = storage_path
        
        self.storage_path = Path(storage_path_str)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 设置加密
        self.enable_encryption = enable_encryption and CRYPTO_AVAILABLE
        if self.enable_encryption:
            self._setup_encryption(encryption_key)
        elif enable_encryption and not CRYPTO_AVAILABLE:
            logger.warning(
                "Encryption requested but cryptography library not available. "
                "Install with: pip install cryptography"
            )
        
        # 加载现有凭据
        self._credentials = self._load_credentials()
    
    def _setup_encryption(self, encryption_key: Optional[str] = None):
        """设置加密"""
        # 检查加密是否可用
        if not CRYPTO_AVAILABLE:
            raise CredentialError("Encryption is not available. Please install the cryptography library.")
        
        key_file = self.storage_path.parent / "encryption.key"
        
        if encryption_key:
            # 使用提供的密钥
            self._fernet = Fernet(encryption_key.encode())  # type: ignore
        elif key_file.exists():
            # 加载现有密钥
            with open(key_file, "rb") as f:
                key = f.read()
            self._fernet = Fernet(key)  # type: ignore
        else:
            # 生成新密钥
            key = Fernet.generate_key()  # type: ignore
            with open(key_file, "wb") as f:
                f.write(key)
            # 设置文件权限（仅所有者可读写）
            os.chmod(key_file, 0o600)
            self._fernet = Fernet(key)  # type: ignore
            
            logger.info(f"Generated new encryption key: {key_file}")
    
    def _encrypt_data(self, data: str) -> str:
        """加密数据"""
        if not self.enable_encryption:
            return data
        
        return self._fernet.encrypt(data.encode()).decode()
    
    def _decrypt_data(self, encrypted_data: str) -> str:
        """解密数据"""
        if not self.enable_encryption:
            return encrypted_data
        
        try:
            return self._fernet.decrypt(encrypted_data.encode()).decode()
        except Exception as e:
            raise CredentialError(f"Failed to decrypt data: {e}")
    
    def _load_credentials(self) -> Dict[str, Dict[str, Any]]:
        """加载凭据文件"""
        if not self.storage_path.exists():
            return {}
        
        try:
            with open(self.storage_path, "r") as f:
                data = f.read()
            
            if self.enable_encryption and data:
                data = self._decrypt_data(data)
            
            return json.loads(data) if data else {}
        except Exception as e:
            logger.error(f"Failed to load credentials: {e}")
            return {}
    
    def _save_credentials(self):
        """保存凭据文件"""
        try:
            data = json.dumps(self._credentials, indent=2)
            
            if self.enable_encryption:
                data = self._encrypt_data(data)
            
            with open(self.storage_path, "w") as f:
                f.write(data)
            
            # 设置文件权限（仅所有者可读写）
            os.chmod(self.storage_path, 0o600)
            
        except Exception as e:
            raise CredentialError(f"Failed to save credentials: {e}")
    
    def set_credential(
        self,
        organization_id: str,
        tool_name: str,
        credential_data: Dict[str, Any]
    ):
        """
        设置凭据
        
        Args:
            organization_id: 组织 ID
            tool_name: 工具名称
            credential_data: 凭据数据（如 API 密钥、用户名密码等）
        """
        if organization_id not in self._credentials:
            self._credentials[organization_id] = {}
        
        self._credentials[organization_id][tool_name] = credential_data
        self._save_credentials()
        
        logger.info(f"Set credential for {organization_id}/{tool_name}")
    
    def get_credential(
        self,
        organization_id: str,
        tool_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        获取凭据
        
        Args:
            organization_id: 组织 ID
            tool_name: 工具名称
            
        Returns:
            凭据数据，如果不存在则返回 None
        """
        org_credentials = self._credentials.get(organization_id, {})
        return org_credentials.get(tool_name)
    
    def delete_credential(
        self,
        organization_id: str,
        tool_name: str
    ) -> bool:
        """
        删除凭据
        
        Args:
            organization_id: 组织 ID
            tool_name: 工具名称
            
        Returns:
            是否成功删除
        """
        if organization_id not in self._credentials:
            return False
        
        if tool_name not in self._credentials[organization_id]:
            return False
        
        del self._credentials[organization_id][tool_name]
        
        # 如果组织下没有凭据了，删除组织
        if not self._credentials[organization_id]:
            del self._credentials[organization_id]
        
        self._save_credentials()
        logger.info(f"Deleted credential for {organization_id}/{tool_name}")
        return True
    
    def list_credentials(
        self,
        organization_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        列出凭据
        
        Args:
            organization_id: 组织 ID，如果为 None 则列出所有组织
            
        Returns:
            凭据列表（不包含敏感数据）
        """
        if organization_id:
            org_credentials = self._credentials.get(organization_id, {})
            return {
                tool_name: {
                    "has_credentials": True,
                    "keys": list(cred_data.keys()) if isinstance(cred_data, dict) else []
                }
                for tool_name, cred_data in org_credentials.items()
            }
        else:
            return {
                org_id: {
                    tool_name: {
                        "has_credentials": True,
                        "keys": list(cred_data.keys()) if isinstance(cred_data, dict) else []
                    }
                    for tool_name, cred_data in org_credentials.items()
                }
                for org_id, org_credentials in self._credentials.items()
            }
    
    def has_credential(
        self,
        organization_id: str,
        tool_name: str
    ) -> bool:
        """
        检查是否存在凭据
        
        Args:
            organization_id: 组织 ID
            tool_name: 工具名称
            
        Returns:
            是否存在凭据
        """
        return (
            organization_id in self._credentials and
            tool_name in self._credentials[organization_id]
        )
    
    def clear_all_credentials(self, organization_id: Optional[str] = None):
        """
        清除凭据
        
        Args:
            organization_id: 组织 ID，如果为 None 则清除所有凭据
        """
        if organization_id:
            if organization_id in self._credentials:
                del self._credentials[organization_id]
                logger.info(f"Cleared all credentials for organization {organization_id}")
        else:
            self._credentials.clear()
            logger.info("Cleared all credentials")
        
        self._save_credentials()
    
    def export_credentials(
        self,
        export_path: str,
        organization_id: Optional[str] = None,
        include_sensitive: bool = False
    ):
        """
        导出凭据
        
        Args:
            export_path: 导出文件路径
            organization_id: 组织 ID，如果为 None 则导出所有
            include_sensitive: 是否包含敏感数据
        """
        if include_sensitive:
            # 导出完整数据（需要额外确认）
            if organization_id:
                data = {organization_id: self._credentials.get(organization_id, {})}
            else:
                data = self._credentials
        else:
            # 只导出结构信息
            data = self.list_credentials(organization_id)
        
        with open(export_path, "w") as f:
            json.dump(data, f, indent=2)
        
        logger.info(f"Exported credentials to {export_path}")
    
    def import_credentials(
        self,
        import_path: str,
        organization_id: Optional[str] = None,
        overwrite: bool = False
    ):
        """
        导入凭据
        
        Args:
            import_path: 导入文件路径
            organization_id: 目标组织 ID，如果为 None 则使用文件中的组织 ID
            overwrite: 是否覆盖现有凭据
        """
        with open(import_path, "r") as f:
            imported_data = json.load(f)
        
        if organization_id:
            # 导入到指定组织
            if organization_id not in self._credentials:
                self._credentials[organization_id] = {}
            
            for tool_name, cred_data in imported_data.items():
                if not overwrite and tool_name in self._credentials[organization_id]:
                    continue
                self._credentials[organization_id][tool_name] = cred_data
        else:
            # 按文件中的组织结构导入
            for org_id, org_credentials in imported_data.items():
                if org_id not in self._credentials:
                    self._credentials[org_id] = {}
                
                for tool_name, cred_data in org_credentials.items():
                    if not overwrite and tool_name in self._credentials[org_id]:
                        continue
                    self._credentials[org_id][tool_name] = cred_data
        
        self._save_credentials()
        logger.info(f"Imported credentials from {import_path}")


# 全局默认凭据存储实例
_default_store = None


def get_default_credential_store() -> CredentialStore:
    """获取默认的凭据存储实例"""
    global _default_store
    if _default_store is None:
        _default_store = CredentialStore()
    return _default_store


def set_credential(organization_id: str, tool_name: str, credential_data: Dict[str, Any]):
    """便捷函数：设置凭据"""
    store = get_default_credential_store()
    store.set_credential(organization_id, tool_name, credential_data)


def get_credential(organization_id: str, tool_name: str) -> Optional[Dict[str, Any]]:
    """便捷函数：获取凭据"""
    store = get_default_credential_store()
    return store.get_credential(organization_id, tool_name)