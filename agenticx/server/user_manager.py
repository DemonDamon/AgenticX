"""
用户管理模块

提供用户注册、登录验证和权限管理功能。
使用 SQLite 存储用户数据。
"""

import logging
import sqlite3
import hashlib
import secrets
import json
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class UserManager:
    """用户管理器
    
    负责用户注册、登录验证和权限管理。
    使用 SQLite 数据库存储用户信息。
    """
    
    def __init__(self, db_path: str = "users.db"):
        """初始化用户管理器
        
        Args:
            db_path: SQLite 数据库文件路径
        """
        self.db_path = db_path
        self._init_database()
    
    def _init_database(self) -> None:
        """初始化数据库表结构"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 用户表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                roles TEXT DEFAULT 'user',
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT
            )
        """)
        
        # 权限表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                resource TEXT NOT NULL,
                action TEXT NOT NULL,
                granted INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, resource, action)
            )
        """)
        
        conn.commit()
        conn.close()
        logger.info(f"[UserManager] Database initialized at {self.db_path}")
    
    def _hash_password(self, password: str) -> str:
        """对密码进行哈希处理
        
        Args:
            password: 原始密码
            
        Returns:
            哈希后的密码
        """
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return f"{salt}:{password_hash.hex()}"
    
    def _verify_password(self, password: str, password_hash: str) -> bool:
        """验证密码
        
        Args:
            password: 原始密码
            password_hash: 存储的哈希密码
            
        Returns:
            密码是否正确
        """
        try:
            salt, stored_hash = password_hash.split(':')
            password_hash_check = hashlib.pbkdf2_hmac(
                'sha256',
                password.encode('utf-8'),
                salt.encode('utf-8'),
                100000
            )
            return password_hash_check.hex() == stored_hash
        except Exception as e:
            logger.error(f"[UserManager] Password verification error: {e}")
            return False
    
    def register_user(
        self,
        email: str,
        password: str,
        username: Optional[str] = None,
        roles: List[str] = None
    ) -> Dict[str, Any]:
        """注册新用户
        
        Args:
            email: 用户邮箱
            password: 用户密码
            username: 用户名（可选，默认为邮箱前缀）
            roles: 用户角色列表（可选，默认为 ['user']）
            
        Returns:
            用户信息字典
            
        Raises:
            ValueError: 如果邮箱已存在或参数无效
        """
        if not email or not password:
            raise ValueError("Email and password are required")
        
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters")
        
        if username is None:
            username = email.split("@")[0]
        
        if roles is None:
            roles = ['user']
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 检查邮箱是否已存在
            cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
            if cursor.fetchone():
                raise ValueError("Email already exists")
            
            # 创建用户
            password_hash = self._hash_password(password)
            created_at = datetime.now(timezone.utc).isoformat()
            
            cursor.execute("""
                INSERT INTO users (email, username, password_hash, roles, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (email, username, password_hash, json.dumps(roles), created_at))
            
            user_id = cursor.lastrowid
            
            # 设置默认权限
            self._set_default_permissions(cursor, user_id, roles)
            
            conn.commit()
            
            logger.info(f"[UserManager] User registered: {email}")
            
            return {
                "id": user_id,
                "email": email,
                "username": username,
                "roles": roles,
                "is_active": True,
                "created_at": created_at,
            }
        except sqlite3.IntegrityError as e:
            conn.rollback()
            raise ValueError("Email already exists") from e
        except Exception as e:
            conn.rollback()
            logger.error(f"[UserManager] Registration error: {e}")
            raise
        finally:
            conn.close()
    
    def _set_default_permissions(
        self,
        cursor: sqlite3.Cursor,
        user_id: int,
        roles: List[str]
    ) -> None:
        """设置用户默认权限
        
        Args:
            cursor: 数据库游标
            user_id: 用户ID
            roles: 用户角色列表
        """
        # 默认权限：所有用户都可以访问自己的资源
        default_permissions = [
            ("projects", "read"),
            ("projects", "write"),
            ("chat", "read"),
            ("chat", "write"),
        ]
        
        # 管理员权限
        if "admin" in roles:
            admin_permissions = [
                ("users", "read"),
                ("users", "write"),
                ("system", "read"),
                ("system", "write"),
            ]
            default_permissions.extend(admin_permissions)
        
        for resource, action in default_permissions:
            cursor.execute("""
                INSERT OR IGNORE INTO permissions (user_id, resource, action, granted)
                VALUES (?, ?, ?, ?)
            """, (user_id, resource, action, 1))
    
    def authenticate_user(self, email: str, password: str) -> Optional[Dict[str, Any]]:
        """验证用户登录
        
        Args:
            email: 用户邮箱
            password: 用户密码
            
        Returns:
            用户信息字典，如果验证失败返回 None
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT id, email, username, password_hash, roles, is_active
                FROM users
                WHERE email = ?
            """, (email,))
            
            row = cursor.fetchone()
            if not row:
                logger.warning(f"[UserManager] Login failed: email not found - {email}")
                return None
            
            user_id, db_email, username, password_hash, roles_json, is_active = row
            
            if not is_active:
                logger.warning(f"[UserManager] Login failed: user inactive - {email}")
                return None
            
            if not self._verify_password(password, password_hash):
                logger.warning(f"[UserManager] Login failed: invalid password - {email}")
                return None
            
            roles = json.loads(roles_json) if roles_json else ['user']
            
            logger.info(f"[UserManager] User authenticated: {email}")
            
            return {
                "id": user_id,
                "email": db_email,
                "username": username,
                "roles": roles,
                "is_active": True,
            }
        except Exception as e:
            logger.error(f"[UserManager] Authentication error: {e}")
            return None
        finally:
            conn.close()
    
    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        """获取用户信息
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户信息字典，如果不存在返回 None
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT id, email, username, roles, is_active, created_at
                FROM users
                WHERE id = ?
            """, (user_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            user_id, email, username, roles_json, is_active, created_at = row
            roles = json.loads(roles_json) if roles_json else ['user']
            
            return {
                "id": user_id,
                "email": email,
                "username": username,
                "roles": roles,
                "is_active": bool(is_active),
                "created_at": created_at,
            }
        except Exception as e:
            logger.error(f"[UserManager] Get user error: {e}")
            return None
        finally:
            conn.close()
    
    def check_permission(
        self,
        user_id: int,
        resource: str,
        action: str
    ) -> bool:
        """检查用户权限
        
        Args:
            user_id: 用户ID
            resource: 资源名称
            action: 操作名称
            
        Returns:
            是否有权限
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 检查用户角色
            cursor.execute("SELECT roles FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            if not row:
                return False
            
            roles = json.loads(row[0]) if row[0] else []
            
            # 管理员拥有所有权限
            if "admin" in roles:
                return True
            
            # 检查具体权限
            cursor.execute("""
                SELECT granted FROM permissions
                WHERE user_id = ? AND resource = ? AND action = ?
            """, (user_id, resource, action))
            
            row = cursor.fetchone()
            if row:
                return bool(row[0])
            
            return False
        except Exception as e:
            logger.error(f"[UserManager] Permission check error: {e}")
            return False
        finally:
            conn.close()
    
    def set_permission(
        self,
        user_id: int,
        resource: str,
        action: str,
        granted: bool = True
    ) -> bool:
        """设置用户权限
        
        Args:
            user_id: 用户ID
            resource: 资源名称
            action: 操作名称
            granted: 是否授予权限
            
        Returns:
            是否成功
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO permissions (user_id, resource, action, granted)
                VALUES (?, ?, ?, ?)
            """, (user_id, resource, action, 1 if granted else 0))
            
            conn.commit()
            logger.info(f"[UserManager] Permission set: user={user_id}, resource={resource}, action={action}, granted={granted}")
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"[UserManager] Set permission error: {e}")
            return False
        finally:
            conn.close()
    
    def update_user_roles(self, user_id: int, roles: List[str]) -> bool:
        """更新用户角色
        
        Args:
            user_id: 用户ID
            roles: 新的角色列表
            
        Returns:
            是否成功
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            updated_at = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                UPDATE users
                SET roles = ?, updated_at = ?
                WHERE id = ?
            """, (json.dumps(roles), updated_at, user_id))
            
            conn.commit()
            logger.info(f"[UserManager] User roles updated: user={user_id}, roles={roles}")
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"[UserManager] Update roles error: {e}")
            return False
        finally:
            conn.close()


# 全局用户管理器实例
_user_manager: Optional[UserManager] = None


def get_user_manager(db_path: str = "users.db") -> UserManager:
    """获取用户管理器实例（单例模式）
    
    Args:
        db_path: 数据库文件路径
        
    Returns:
        UserManager 实例
    """
    global _user_manager
    if _user_manager is None:
        _user_manager = UserManager(db_path)
    return _user_manager
