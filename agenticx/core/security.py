"""
AgenticX Security Management System

This module provides comprehensive security features for the AgenticX tool system,
including permission management, audit logging, credential handling, and security policies.
"""

import hashlib
import json
import logging
import os
import secrets
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Union, Callable
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64


class SecurityLevel(str, Enum):
    """Security level enumeration."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Permission(str, Enum):
    """Permission enumeration."""
    # Tool execution permissions
    TOOL_EXECUTE = "tool:execute"
    TOOL_EXECUTE_ADMIN = "tool:execute:admin"
    TOOL_EXECUTE_SYSTEM = "tool:execute:system"
    
    # Tool management permissions
    TOOL_REGISTER = "tool:register"
    TOOL_UNREGISTER = "tool:unregister"
    TOOL_UPDATE = "tool:update"
    TOOL_DELETE = "tool:delete"
    
    # Registry permissions
    REGISTRY_READ = "registry:read"
    REGISTRY_WRITE = "registry:write"
    REGISTRY_ADMIN = "registry:admin"
    
    # Security permissions
    SECURITY_READ = "security:read"
    SECURITY_WRITE = "security:write"
    SECURITY_ADMIN = "security:admin"
    
    # Audit permissions
    AUDIT_READ = "audit:read"
    AUDIT_WRITE = "audit:write"
    AUDIT_ADMIN = "audit:admin"
    
    # Credential permissions
    CREDENTIAL_READ = "credential:read"
    CREDENTIAL_WRITE = "credential:write"
    CREDENTIAL_ADMIN = "credential:admin"


@dataclass
class SecurityPolicy:
    """Security policy configuration."""
    name: str
    description: str
    security_level: SecurityLevel
    allowed_permissions: Set[Permission]
    denied_permissions: Set[Permission] = field(default_factory=set)
    rate_limits: Dict[str, int] = field(default_factory=dict)
    constraints: Dict[str, Any] = field(default_factory=dict)
    
    def allows_permission(self, permission: Permission) -> bool:
        """Check if permission is allowed."""
        if permission in self.denied_permissions:
            return False
        return permission in self.allowed_permissions
    
    def get_rate_limit(self, action: str) -> Optional[int]:
        """Get rate limit for an action."""
        return self.rate_limits.get(action)


@dataclass
class AuditLogEntry:
    """Audit log entry."""
    timestamp: datetime
    action: str
    user_id: Optional[str]
    tool_name: Optional[str]
    execution_id: Optional[str]
    result: str
    details: Dict[str, Any] = field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "action": self.action,
            "user_id": self.user_id,
            "tool_name": self.tool_name,
            "execution_id": self.execution_id,
            "result": self.result,
            "details": self.details,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent
        }


class SecurityException(Exception):
    """Base security exception."""
    pass


class PermissionDeniedException(SecurityException):
    """Permission denied exception."""
    pass


class RateLimitExceededException(SecurityException):
    """Rate limit exceeded exception."""
    pass


class AuthenticationException(SecurityException):
    """Authentication exception."""
    pass


class AuthorizationException(SecurityException):
    """Authorization exception."""
    pass


class SecurityManager:
    """
    Central security manager for the AgenticX tool system.
    
    Manages permissions, security policies, audit logging, and access control.
    """
    
    def __init__(self, master_key: Optional[str] = None):
        self._logger = logging.getLogger("agenticx.security")
        self._policies: Dict[str, SecurityPolicy] = {}
        self._audit_log: List[AuditLogEntry] = []
        self._rate_limiter = RateLimiter()
        self._credential_store = CredentialStore(master_key)
        self._security_policies = SecurityPolicyEngine()
        
        # Thread safety
        self._lock = threading.RLock()
        
        # Audit log size limit
        self._max_audit_entries = 10000
        
        # Default policies
        self._setup_default_policies()
    
    def shutdown(self):
        """Shutdown security manager."""
        self._logger.info("Shutting down security manager")
        # Cleanup resources if needed
    
    def _setup_default_policies(self):
        """Setup default security policies."""
        # Guest policy
        guest_policy = SecurityPolicy(
            name="guest",
            description="Guest user policy with minimal permissions",
            security_level=SecurityLevel.LOW,
            allowed_permissions={Permission.REGISTRY_READ}
        )
        self.add_policy(guest_policy)
        
        # User policy
        user_policy = SecurityPolicy(
            name="user",
            description="Standard user policy",
            security_level=SecurityLevel.MEDIUM,
            allowed_permissions={
                Permission.TOOL_EXECUTE,
                Permission.REGISTRY_READ,
                Permission.AUDIT_READ
            },
            rate_limits={"tool_execute": 100, "tool_register": 10}
        )
        self.add_policy(user_policy)
        
        # Admin policy
        admin_policy = SecurityPolicy(
            name="admin",
            description="Administrator policy with full permissions",
            security_level=SecurityLevel.HIGH,
            allowed_permissions=set(Permission),
            rate_limits={"tool_execute": 1000, "tool_register": 100}
        )
        self.add_policy(admin_policy)
    
    def add_policy(self, policy: SecurityPolicy) -> None:
        """Add a security policy."""
        with self._lock:
            self._policies[policy.name] = policy
            self._logger.info(f"Added security policy: {policy.name}")
    
    def get_policy(self, policy_name: str) -> Optional[SecurityPolicy]:
        """Get a security policy by name."""
        with self._lock:
            return self._policies.get(policy_name)
    
    def list_policies(self) -> List[str]:
        """List all policy names."""
        with self._lock:
            return list(self._policies.keys())
    
    def check_permission(self, user_id: str, permission: Permission, 
                        context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Check if user has a specific permission.
        
        Args:
            user_id: User identifier
            permission: Permission to check
            context: Additional context
            
        Returns:
            True if permission is granted, False otherwise
        """
        try:
            user_policy = self._get_user_policy(user_id)
            if not user_policy:
                self._logger.warning(f"No policy found for user: {user_id}")
                return False
            
            allowed = user_policy.allows_permission(permission)
            
            # Log permission check
            self._log_audit(
                action="permission_check",
                user_id=user_id,
                result="granted" if allowed else "denied",
                details={"permission": permission.value}
            )
            
            return allowed
            
        except Exception as e:
            self._logger.error(f"Error checking permission for user {user_id}: {e}")
            return False
    
    def authorize_action(self, user_id: str, action: str, 
                         resource: str, context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Authorize an action on a resource.
        
        Args:
            user_id: User identifier
            action: Action to authorize
            resource: Resource to access
            context: Additional context
            
        Returns:
            True if authorized, False otherwise
            
        Raises:
            AuthorizationException: If authorization fails
        """
        try:
            # Map action to permission
            permission = self._map_action_to_permission(action, resource)
            
            # Check rate limits
            if not self._check_rate_limit(user_id, action):
                raise RateLimitExceededException(f"Rate limit exceeded for action: {action}")
            
            # Check permission
            if not self.check_permission(user_id, permission, context):
                raise PermissionDeniedException(f"Permission denied for action: {action}")
            
            # Additional security checks
            if not self._security_policies.evaluate(user_id, action, resource, context):
                raise AuthorizationException(f"Security policy denied action: {action}")
            
            return True
            
        except (PermissionDeniedException, RateLimitExceededException, AuthorizationException):
            raise
        except Exception as e:
            self._logger.error(f"Authorization error for user {user_id}: {e}")
            raise AuthorizationException(f"Authorization failed: {e}")
    
    def _get_user_policy(self, user_id: str) -> Optional[SecurityPolicy]:
        """Get policy for a user."""
        # This is a simplified implementation
        # In a real system, this would look up user roles and map to policies
        
        if user_id.startswith("admin_"):
            return self._policies.get("admin")
        elif user_id.startswith("guest_"):
            return self._policies.get("guest")
        else:
            return self._policies.get("user")
    
    def _map_action_to_permission(self, action: str, resource: str) -> Permission:
        """Map an action to a permission."""
        action_map = {
            "execute": Permission.TOOL_EXECUTE,
            "register": Permission.TOOL_REGISTER,
            "unregister": Permission.TOOL_UNREGISTER,
            "update": Permission.TOOL_UPDATE,
            "delete": Permission.TOOL_DELETE,
            "read": Permission.REGISTRY_READ,
            "write": Permission.REGISTRY_WRITE,
        }
        
        return action_map.get(action, Permission.TOOL_EXECUTE)
    
    def _check_rate_limit(self, user_id: str, action: str) -> bool:
        """Check rate limits for an action."""
        user_policy = self._get_user_policy(user_id)
        if not user_policy:
            return True  # No policy, no limit
        
        rate_limit = user_policy.get_rate_limit(action)
        if rate_limit is None:
            return True  # No rate limit
        
        return self._rate_limiter.check_limit(user_id, action, rate_limit)
    
    def _log_audit(self, action: str, user_id: Optional[str] = None,
                   tool_name: Optional[str] = None, execution_id: Optional[str] = None,
                   result: str = "success", details: Optional[Dict[str, Any]] = None,
                   ip_address: Optional[str] = None, user_agent: Optional[str] = None):
        """Log an audit entry."""
        with self._lock:
            entry = AuditLogEntry(
                timestamp=datetime.now(),
                action=action,
                user_id=user_id,
                tool_name=tool_name,
                execution_id=execution_id,
                result=result,
                details=details or {},
                ip_address=ip_address,
                user_agent=user_agent
            )
            
            self._audit_log.append(entry)
            
            # Maintain log size limit
            if len(self._audit_log) > self._max_audit_entries:
                self._audit_log = self._audit_log[-self._max_audit_entries:]
            
            # Log to system logger
            self._logger.info(f"AUDIT: {action} by {user_id} - {result}")
    
    def get_audit_log(self, user_id: Optional[str] = None,
                     action: Optional[str] = None,
                     start_time: Optional[datetime] = None,
                     end_time: Optional[datetime] = None,
                     limit: int = 100) -> List[AuditLogEntry]:
        """Get audit log entries with filtering."""
        with self._lock:
            entries = self._audit_log
            
            # Apply filters
            if user_id:
                entries = [e for e in entries if e.user_id == user_id]
            
            if action:
                entries = [e for e in entries if e.action == action]
            
            if start_time:
                entries = [e for e in entries if e.timestamp >= start_time]
            
            if end_time:
                entries = [e for e in entries if e.timestamp <= end_time]
            
            # Sort by timestamp (newest first) and limit
            entries.sort(key=lambda x: x.timestamp, reverse=True)
            return entries[:limit]
    
    def export_audit_log(self, file_path: str, **kwargs) -> None:
        """Export audit log to file."""
        entries = self.get_audit_log(**kwargs)
        
        with open(file_path, 'w') as f:
            for entry in entries:
                json.dump(entry.to_dict(), f)
                f.write('\n')
        
        self._logger.info(f"Exported {len(entries)} audit entries to {file_path}")
    
    def clear_audit_log(self) -> None:
        """Clear audit log."""
        with self._lock:
            self._audit_log.clear()
            self._logger.info("Cleared audit log")
    
    def get_credential_store(self) -> 'CredentialStore':
        """Get the credential store."""
        return self._credential_store


class RateLimiter:
    """Rate limiter for security."""
    
    def __init__(self):
        self._requests: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
    
    def check_limit(self, user_id: str, action: str, limit: int, 
                   window_seconds: int = 60) -> bool:
        """
        Check if rate limit is exceeded.
        
        Args:
            user_id: User identifier
            action: Action name
            limit: Maximum requests allowed
            window_seconds: Time window in seconds
            
        Returns:
            True if within limits, False if exceeded
        """
        key = f"{user_id}:{action}"
        current_time = time.time()
        
        with self._lock:
            # Get or create request list
            if key not in self._requests:
                self._requests[key] = []
            
            requests = self._requests[key]
            
            # Remove old requests outside the window
            cutoff_time = current_time - window_seconds
            self._requests[key] = [req_time for req_time in requests if req_time > cutoff_time]
            
            # Check if limit is exceeded
            if len(self._requests[key]) >= limit:
                return False
            
            # Add current request
            self._requests[key].append(current_time)
            return True
    
    def reset_limits(self, user_id: Optional[str] = None) -> None:
        """Reset rate limits."""
        with self._lock:
            if user_id:
                # Reset for specific user
                keys_to_remove = [key for key in self._requests.keys() if key.startswith(f"{user_id}:")]
                for key in keys_to_remove:
                    del self._requests[key]
            else:
                # Reset all
                self._requests.clear()


class SecurityPolicyEngine:
    """Security policy evaluation engine."""
    
    def __init__(self):
        self._policies: List[Callable] = []
        self._logger = logging.getLogger("agenticx.security.policy")
    
    def add_policy(self, policy_func: Callable) -> None:
        """Add a security policy function."""
        self._policies.append(policy_func)
    
    def evaluate(self, user_id: str, action: str, resource: str, 
                context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Evaluate all security policies.
        
        Args:
            user_id: User identifier
            action: Action being performed
            resource: Resource being accessed
            context: Additional context
            
        Returns:
            True if all policies pass, False otherwise
        """
        context = context or {}
        
        for policy_func in self._policies:
            try:
                if not policy_func(user_id, action, resource, context):
                    self._logger.warning(f"Policy denied: {policy_func.__name__}")
                    return False
            except Exception as e:
                self._logger.error(f"Policy evaluation error: {e}")
                return False
        
        return True


class CredentialStore:
    """Secure credential storage and management."""
    
    def __init__(self, master_key: Optional[str] = None):
        self._logger = logging.getLogger("agenticx.security.credentials")
        self._credentials: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        
        # Initialize encryption
        if master_key:
            self._cipher = self._create_cipher(master_key)
        else:
            # Generate a random key if none provided
            self._cipher = Fernet(Fernet.generate_key())
    
    def _create_cipher(self, master_key: str) -> Fernet:
        """Create encryption cipher from master key."""
        # Use PBKDF2 to derive a key from the master key
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'agenticx_salt',  # In production, use random salt
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(master_key.encode()))
        return Fernet(key)
    
    def store_credential(self, user_id: str, credential_name: str, 
                        credential_data: Dict[str, Any], 
                        metadata: Optional[Dict[str, Any]] = None) -> str:
        """
        Store a credential securely.
        
        Args:
            user_id: User identifier
            credential_name: Name of the credential
            credential_data: Credential data to store
            metadata: Optional metadata
            
        Returns:
            Credential ID
        """
        with self._lock:
            # Encrypt credential data
            encrypted_data = self._cipher.encrypt(
                json.dumps(credential_data).encode()
            ).decode()
            
            credential_id = self._generate_credential_id(user_id, credential_name)
            
            self._credentials[credential_id] = {
                "user_id": user_id,
                "credential_name": credential_name,
                "encrypted_data": encrypted_data,
                "metadata": metadata or {},
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            }
            
            self._logger.info(f"Stored credential for user {user_id}: {credential_name}")
            return credential_id
    
    def get_credential(self, user_id: str, credential_name: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a credential.
        
        Args:
            user_id: User identifier
            credential_name: Name of the credential
            
        Returns:
            Decrypted credential data or None if not found
        """
        with self._lock:
            credential_id = self._generate_credential_id(user_id, credential_name)
            
            if credential_id not in self._credentials:
                return None
            
            credential = self._credentials[credential_id]
            
            # Verify user ownership
            if credential["user_id"] != user_id:
                self._logger.warning(f"Unauthorized credential access attempt by user {user_id}")
                return None
            
            # Decrypt credential data
            try:
                encrypted_data = credential["encrypted_data"].encode()
                decrypted_data = self._cipher.decrypt(encrypted_data)
                return json.loads(decrypted_data.decode())
            except Exception as e:
                self._logger.error(f"Failed to decrypt credential: {e}")
                return None
    
    def delete_credential(self, user_id: str, credential_name: str) -> bool:
        """
        Delete a credential.
        
        Args:
            user_id: User identifier
            credential_name: Name of the credential
            
        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            credential_id = self._generate_credential_id(user_id, credential_name)
            
            if credential_id not in self._credentials:
                return False
            
            # Verify user ownership
            if self._credentials[credential_id]["user_id"] != user_id:
                self._logger.warning(f"Unauthorized credential deletion attempt by user {user_id}")
                return False
            
            del self._credentials[credential_id]
            self._logger.info(f"Deleted credential for user {user_id}: {credential_name}")
            return True
    
    def list_credentials(self, user_id: str) -> List[str]:
        """
        List credential names for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of credential names
        """
        with self._lock:
            return [
                cred["credential_name"]
                for cred in self._credentials.values()
                if cred["user_id"] == user_id
            ]
    
    def _generate_credential_id(self, user_id: str, credential_name: str) -> str:
        """Generate a unique credential ID."""
        data = f"{user_id}:{credential_name}"
        return hashlib.sha256(data.encode()).hexdigest()


# Global security manager instance
_global_security_manager = None


def get_security_manager(master_key: Optional[str] = None) -> SecurityManager:
    """Get the global security manager."""
    global _global_security_manager
    
    if _global_security_manager is None:
        _global_security_manager = SecurityManager(master_key)
    
    return _global_security_manager


def check_permission(user_id: str, permission: Permission, **kwargs) -> bool:
    """Convenience function to check permission."""
    manager = get_security_manager()
    return manager.check_permission(user_id, permission, **kwargs)


def authorize_action(user_id: str, action: str, resource: str, **kwargs) -> bool:
    """Convenience function to authorize an action."""
    manager = get_security_manager()
    return manager.authorize_action(user_id, action, resource, **kwargs)


def log_audit(action: str, **kwargs) -> None:
    """Convenience function to log audit entry."""
    manager = get_security_manager()
    manager._log_audit(action, **kwargs)