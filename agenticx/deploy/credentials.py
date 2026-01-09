"""
AgenticX Deploy Credentials

凭证管理，安全存储和访问部署凭证。
"""

import os
import json
from typing import Optional, Dict, Any, List
from pathlib import Path
from dataclasses import dataclass, field
import logging
import base64

logger = logging.getLogger(__name__)

# 凭证目录
CREDENTIALS_DIR = Path.home() / ".agenticx" / "credentials"


@dataclass
class Credential:
    """
    凭证
    
    存储访问云服务或其他服务的凭证信息。
    """
    
    name: str
    """凭证名称"""
    
    type: str = "generic"
    """凭证类型: generic, docker, aws, gcp, azure, aliyun"""
    
    data: Dict[str, str] = field(default_factory=dict)
    """凭证数据"""
    
    description: str = ""
    """描述"""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "data": self.data,
            "description": self.description,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Credential":
        return cls(
            name=data.get("name", ""),
            type=data.get("type", "generic"),
            data=data.get("data", {}),
            description=data.get("description", ""),
        )
    
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """获取凭证数据"""
        return self.data.get(key, default)
    
    def set(self, key: str, value: str) -> None:
        """设置凭证数据"""
        self.data[key] = value


class CredentialManager:
    """
    凭证管理器
    
    管理所有部署凭证的存储和访问。
    
    凭证存储在 ~/.agenticx/credentials/ 目录下，
    每个凭证一个 JSON 文件。
    
    注意：当前实现使用简单的文件存储，
    生产环境建议使用更安全的方案（如加密存储、Vault 等）。
    
    Example:
        >>> manager = CredentialManager()
        >>> 
        >>> # 添加凭证
        >>> cred = Credential(
        ...     name="docker-hub",
        ...     type="docker",
        ...     data={"username": "user", "password": "pass"},
        ... )
        >>> manager.save(cred)
        >>> 
        >>> # 获取凭证
        >>> cred = manager.get("docker-hub")
        >>> print(cred.get("username"))
    """
    
    def __init__(self, credentials_dir: Optional[Path] = None):
        """
        初始化凭证管理器
        
        Args:
            credentials_dir: 凭证目录
        """
        self._credentials_dir = credentials_dir or CREDENTIALS_DIR
        self._credentials_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_credential_path(self, name: str) -> Path:
        """获取凭证文件路径"""
        return self._credentials_dir / f"{name}.json"
    
    def save(self, credential: Credential) -> None:
        """
        保存凭证
        
        Args:
            credential: 凭证
        """
        path = self._get_credential_path(credential.name)
        
        # 简单的 base64 编码（非加密，仅混淆）
        data = credential.to_dict()
        encoded_data = {}
        for key, value in data.get("data", {}).items():
            encoded_data[key] = base64.b64encode(value.encode()).decode()
        data["data"] = encoded_data
        
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        
        # 设置文件权限（仅所有者可读写）
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
        
        logger.info(f"Credential '{credential.name}' saved")
    
    def get(self, name: str) -> Optional[Credential]:
        """
        获取凭证
        
        Args:
            name: 凭证名称
            
        Returns:
            凭证，如果不存在则返回 None
        """
        path = self._get_credential_path(name)
        
        if not path.exists():
            return None
        
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # 解码数据
        decoded_data = {}
        for key, value in data.get("data", {}).items():
            try:
                decoded_data[key] = base64.b64decode(value.encode()).decode()
            except Exception:
                decoded_data[key] = value
        data["data"] = decoded_data
        
        return Credential.from_dict(data)
    
    def delete(self, name: str) -> bool:
        """
        删除凭证
        
        Args:
            name: 凭证名称
            
        Returns:
            是否删除成功
        """
        path = self._get_credential_path(name)
        
        if not path.exists():
            return False
        
        path.unlink()
        logger.info(f"Credential '{name}' deleted")
        return True
    
    def list(self) -> List[str]:
        """
        列出所有凭证
        
        Returns:
            凭证名称列表
        """
        credentials = []
        for path in self._credentials_dir.glob("*.json"):
            credentials.append(path.stem)
        return sorted(credentials)
    
    def exists(self, name: str) -> bool:
        """
        检查凭证是否存在
        
        Args:
            name: 凭证名称
            
        Returns:
            是否存在
        """
        return self._get_credential_path(name).exists()
    
    def get_or_env(
        self,
        name: str,
        env_mapping: Optional[Dict[str, str]] = None,
    ) -> Optional[Credential]:
        """
        获取凭证或从环境变量创建
        
        如果凭证不存在，尝试从环境变量创建。
        
        Args:
            name: 凭证名称
            env_mapping: 环境变量映射 {凭证键: 环境变量名}
            
        Returns:
            凭证
        """
        credential = self.get(name)
        if credential:
            return credential
        
        if not env_mapping:
            return None
        
        # 从环境变量创建
        data = {}
        for cred_key, env_var in env_mapping.items():
            value = os.environ.get(env_var)
            if value:
                data[cred_key] = value
        
        if data:
            return Credential(name=name, type="env", data=data)
        
        return None


# 默认凭证管理器
_default_manager: Optional[CredentialManager] = None


def get_credential_manager() -> CredentialManager:
    """获取默认凭证管理器"""
    global _default_manager
    if _default_manager is None:
        _default_manager = CredentialManager()
    return _default_manager


def get_credential(name: str) -> Optional[Credential]:
    """获取凭证的便捷函数"""
    return get_credential_manager().get(name)


def save_credential(credential: Credential) -> None:
    """保存凭证的便捷函数"""
    get_credential_manager().save(credential)
