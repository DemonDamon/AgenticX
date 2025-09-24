"""
AgenticX Tool Marketplace

This module provides a comprehensive tool marketplace system for discovering,
publishing, installing, and managing tools in the AgenticX ecosystem.
"""

import json
import logging
import os
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Callable
from urllib.parse import urlparse
import requests
import yaml

from .tool_v2 import BaseTool, ToolMetadata
from .registry import ToolRegistry
from .security import SecurityManager, Permission, check_permission


class ToolStatus(str, Enum):
    """Tool status enumeration."""
    DRAFT = "draft"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class ToolCategory(str, Enum):
    """Tool category enumeration."""
    DATA_PROCESSING = "data_processing"
    WEB_SCRAPING = "web_scraping"
    API_INTEGRATION = "api_integration"
    MACHINE_LEARNING = "machine_learning"
    AUTOMATION = "automation"
    COMMUNICATION = "communication"
    DEVELOPMENT = "development"
    SECURITY = "security"
    ANALYTICS = "analytics"
    CUSTOM = "custom"


@dataclass
class ToolManifest:
    """Tool manifest containing metadata and configuration."""
    name: str
    version: str
    description: str
    author: str
    author_email: str
    category: ToolCategory
    tags: List[str] = field(default_factory=list)
    requirements: List[str] = field(default_factory=list)
    dependencies: Dict[str, str] = field(default_factory=dict)
    parameters: Dict[str, Any] = field(default_factory=dict)
    examples: List[Dict[str, Any]] = field(default_factory=list)
    documentation: str = ""
    license: str = "MIT"
    homepage: str = ""
    repository: str = ""
    documentation_url: str = ""
    icon: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "author_email": self.author_email,
            "category": self.category.value,
            "tags": self.tags,
            "requirements": self.requirements,
            "dependencies": self.dependencies,
            "parameters": self.parameters,
            "examples": self.examples,
            "documentation": self.documentation,
            "license": self.license,
            "homepage": self.homepage,
            "repository": self.repository,
            "documentation_url": self.documentation_url,
            "icon": self.icon
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ToolManifest':
        """Create from dictionary."""
        return cls(
            name=data["name"],
            version=data["version"],
            description=data["description"],
            author=data["author"],
            author_email=data["author_email"],
            category=ToolCategory(data["category"]),
            tags=data.get("tags", []),
            requirements=data.get("requirements", []),
            dependencies=data.get("dependencies", {}),
            parameters=data.get("parameters", {}),
            examples=data.get("examples", []),
            documentation=data.get("documentation", ""),
            license=data.get("license", "MIT"),
            homepage=data.get("homepage", ""),
            repository=data.get("repository", ""),
            documentation_url=data.get("documentation_url", ""),
            icon=data.get("icon", "")
        )


@dataclass
class ToolListing:
    """Tool listing in marketplace."""
    manifest: ToolManifest
    status: ToolStatus
    published_at: datetime
    updated_at: datetime
    downloads: int
    rating: float
    review_count: int
    verified: bool
    publisher_id: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "manifest": self.manifest.to_dict(),
            "status": self.status.value,
            "published_at": self.published_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "downloads": self.downloads,
            "rating": self.rating,
            "review_count": self.review_count,
            "verified": self.verified,
            "publisher_id": self.publisher_id
        }


@dataclass
class ToolReview:
    """Tool review and rating."""
    tool_name: str
    user_id: str
    rating: int  # 1-5 stars
    comment: str
    created_at: datetime
    helpful_votes: int = 0
    verified: bool = False


class MarketplaceException(Exception):
    """Base marketplace exception."""
    pass


class ToolNotFoundException(MarketplaceException):
    """Tool not found exception."""
    pass


class ToolAlreadyExistsException(MarketplaceException):
    """Tool already exists exception."""
    pass


class PermissionDeniedException(MarketplaceException):
    """Permission denied exception."""
    pass


class ToolMarketplace:
    """
    AgenticX Tool Marketplace
    
    Provides functionality for tool discovery, publishing, installation,
    and management in the AgenticX ecosystem.
    """
    
    def __init__(self, marketplace_dir: str = "~/.agenticx/marketplace",
                 registry: Optional[ToolRegistry] = None,
                 security_manager: Optional[SecurityManager] = None):
        self._logger = logging.getLogger("agenticx.marketplace")
        self._marketplace_dir = Path(marketplace_dir).expanduser()
        self._registry = registry
        self._security_manager = security_manager
        
        # Create marketplace directories
        self._marketplace_dir.mkdir(parents=True, exist_ok=True)
        (self._marketplace_dir / "tools").mkdir(exist_ok=True)
        (self._marketplace_dir / "installed").mkdir(exist_ok=True)
        (self._marketplace_dir / "cache").mkdir(exist_ok=True)
        
        # Data storage
        self._listings: Dict[str, ToolListing] = {}
        self._reviews: Dict[str, List[ToolReview]] = {}
        self._installed_tools: Dict[str, ToolManifest] = {}
        
        # Thread safety
        self._lock = threading.RLock()
        
        # Load existing data
        self._load_data()
    
    def publish_tool(self, manifest: ToolManifest, tool_code: str,
                    publisher_id: str, force: bool = False) -> str:
        """
        Publish a tool to the marketplace.
        
        Args:
            manifest: Tool manifest
            tool_code: Tool implementation code
            publisher_id: Publisher user ID
            force: Force publish even if tool exists
            
        Returns:
            Tool ID
            
        Raises:
            PermissionDeniedException: If user lacks permission
            ToolAlreadyExistsException: If tool already exists and force=False
        """
        # Check permissions
        if not check_permission(publisher_id, Permission.TOOL_REGISTER):
            raise PermissionDeniedException("User lacks permission to publish tools")
        
        tool_id = f"{manifest.name}@{manifest.version}"
        
        with self._lock:
            # Check if tool already exists
            if tool_id in self._listings and not force:
                raise ToolAlreadyExistsException(f"Tool {tool_id} already exists")
            
            # Create tool listing
            listing = ToolListing(
                manifest=manifest,
                status=ToolStatus.PUBLISHED,
                published_at=datetime.now(),
                updated_at=datetime.now(),
                downloads=0,
                rating=0.0,
                review_count=0,
                verified=False,
                publisher_id=publisher_id
            )
            
            # Save tool code
            tool_dir = self._marketplace_dir / "tools" / manifest.name
            tool_dir.mkdir(exist_ok=True)
            
            # Save manifest
            manifest_file = tool_dir / "manifest.yaml"
            with open(manifest_file, 'w') as f:
                yaml.dump(manifest.to_dict(), f)
            
            # Save tool code
            code_file = tool_dir / "tool.py"
            with open(code_file, 'w') as f:
                f.write(tool_code)
            
            # Save listing
            self._listings[tool_id] = listing
            self._reviews[tool_id] = []
            
            self._save_data()
            
            self._logger.info(f"Published tool: {tool_id} by {publisher_id}")
            return tool_id
    
    def search_tools(self, query: str = "", category: Optional[ToolCategory] = None,
                    tags: Optional[List[str]] = None, verified_only: bool = False,
                    min_rating: float = 0.0, limit: int = 50) -> List[ToolListing]:
        """
        Search for tools in the marketplace.
        
        Args:
            query: Search query
            category: Filter by category
            tags: Filter by tags
            verified_only: Show only verified tools
            min_rating: Minimum rating filter
            limit: Maximum number of results
            
        Returns:
            List of tool listings
        """
        with self._lock:
            results = []
            
            for listing in self._listings.values():
                # Skip non-published tools
                if listing.status != ToolStatus.PUBLISHED:
                    continue
                
                # Apply filters
                if verified_only and not listing.verified:
                    continue
                
                if category and listing.manifest.category != category:
                    continue
                
                if min_rating > 0 and listing.rating < min_rating:
                    continue
                
                if tags and not any(tag in listing.manifest.tags for tag in tags):
                    continue
                
                # Text search
                if query:
                    search_text = f"{listing.manifest.name} {listing.manifest.description} {' '.join(listing.manifest.tags)}"
                    if query.lower() not in search_text.lower():
                        continue
                
                results.append(listing)
            
            # Sort by rating and downloads
            results.sort(key=lambda x: (x.rating, x.downloads), reverse=True)
            
            return results[:limit]
    
    def get_tool(self, tool_name: str, version: Optional[str] = None) -> Optional[ToolListing]:
        """
        Get a specific tool listing.
        
        Args:
            tool_name: Tool name
            version: Tool version (latest if None)
            
        Returns:
            Tool listing or None if not found
        """
        with self._lock:
            if version:
                tool_id = f"{tool_name}@{version}"
                return self._listings.get(tool_id)
            else:
                # Find latest version
                latest = None
                for tool_id, listing in self._listings.items():
                    if tool_id.startswith(f"{tool_name}@") and listing.status == ToolStatus.PUBLISHED:
                        if latest is None or listing.updated_at > latest.updated_at:
                            latest = listing
                return latest
    
    def install_tool(self, tool_name: str, user_id: str,
                    version: Optional[str] = None) -> str:
        """
        Install a tool from the marketplace.
        
        Args:
            tool_name: Tool name
            user_id: User ID
            version: Tool version (latest if None)
            
        Returns:
            Installation ID
            
        Raises:
            ToolNotFoundException: If tool not found
            PermissionDeniedException: If user lacks permission
        """
        # Check permissions
        if not check_permission(user_id, Permission.TOOL_EXECUTE):
            raise PermissionDeniedException("User lacks permission to install tools")
        
        listing = self.get_tool(tool_name, version)
        if not listing:
            raise ToolNotFoundException(f"Tool {tool_name} not found")
        
        if listing.status != ToolStatus.PUBLISHED:
            raise ToolNotFoundException(f"Tool {tool_name} is not available")
        
        tool_id = f"{listing.manifest.name}@{listing.manifest.version}"
        
        with self._lock:
            # Load tool code
            tool_dir = self._marketplace_dir / "tools" / tool_name
            code_file = tool_dir / "tool.py"
            
            if not code_file.exists():
                raise ToolNotFoundException(f"Tool code not found for {tool_name}")
            
            with open(code_file, 'r') as f:
                tool_code = f.read()
            
            # Install to user directory
            user_dir = self._marketplace_dir / "installed" / user_id
            user_dir.mkdir(parents=True, exist_ok=True)
            
            install_dir = user_dir / tool_name
            install_dir.mkdir(exist_ok=True)
            
            # Save tool code
            install_code_file = install_dir / "tool.py"
            with open(install_code_file, 'w') as f:
                f.write(tool_code)
            
            # Save manifest
            install_manifest_file = install_dir / "manifest.yaml"
            with open(install_manifest_file, 'w') as f:
                yaml.dump(listing.manifest.to_dict(), f)
            
            # Track installation
            self._installed_tools[f"{user_id}:{tool_id}"] = listing.manifest
            
            # Update download count
            listing.downloads += 1
            listing.updated_at = datetime.now()
            
            self._save_data()
            
            self._logger.info(f"Installed tool {tool_id} for user {user_id}")
            return f"{user_id}:{tool_id}"
    
    def uninstall_tool(self, tool_name: str, user_id: str,
                      version: Optional[str] = None) -> bool:
        """
        Uninstall a tool.
        
        Args:
            tool_name: Tool name
            user_id: User ID
            version: Tool version
            
        Returns:
            True if uninstalled, False if not found
        """
        listing = self.get_tool(tool_name, version)
        if not listing:
            return False
        
        tool_id = f"{listing.manifest.name}@{listing.manifest.version}"
        install_id = f"{user_id}:{tool_id}"
        
        with self._lock:
            if install_id not in self._installed_tools:
                return False
            
            # Remove installation directory
            user_dir = self._marketplace_dir / "installed" / user_id / tool_name
            if user_dir.exists():
                shutil.rmtree(user_dir)
            
            # Remove from tracking
            del self._installed_tools[install_id]
            
            self._save_data()
            
            self._logger.info(f"Uninstalled tool {tool_id} for user {user_id}")
            return True
    
    def list_installed_tools(self, user_id: str) -> List[ToolManifest]:
        """
        List tools installed by a user.
        
        Args:
            user_id: User ID
            
        Returns:
            List of installed tool manifests
        """
        with self._lock:
            installed = []
            prefix = f"{user_id}:"
            
            for install_id, manifest in self._installed_tools.items():
                if install_id.startswith(prefix):
                    installed.append(manifest)
            
            return installed
    
    def add_review(self, tool_name: str, user_id: str, rating: int,
                  comment: str = "") -> bool:
        """
        Add a review for a tool.
        
        Args:
            tool_name: Tool name
            user_id: User ID
            rating: Rating (1-5)
            comment: Review comment
            
        Returns:
            True if review added
            
        Raises:
            ValueError: If rating is invalid
        """
        if not 1 <= rating <= 5:
            raise ValueError("Rating must be between 1 and 5")
        
        listing = self.get_tool(tool_name)
        if not listing:
            return False
        
        tool_id = f"{listing.manifest.name}@{listing.manifest.version}"
        
        review = ToolReview(
            tool_name=tool_name,
            user_id=user_id,
            rating=rating,
            comment=comment,
            created_at=datetime.now()
        )
        
        with self._lock:
            if tool_id not in self._reviews:
                self._reviews[tool_id] = []
            
            self._reviews[tool_id].append(review)
            
            # Update tool rating
            reviews = self._reviews[tool_id]
            listing.rating = sum(r.rating for r in reviews) / len(reviews)
            listing.review_count = len(reviews)
            
            self._save_data()
            
            self._logger.info(f"Added review for {tool_name} by {user_id}: {rating}/5")
            return True
    
    def get_reviews(self, tool_name: str, limit: int = 50) -> List[ToolReview]:
        """
        Get reviews for a tool.
        
        Args:
            tool_name: Tool name
            limit: Maximum number of reviews
            
        Returns:
            List of reviews
        """
        listing = self.get_tool(tool_name)
        if not listing:
            return []
        
        tool_id = f"{listing.manifest.name}@{listing.manifest.version}"
        
        with self._lock:
            reviews = self._reviews.get(tool_id, [])
            # Sort by date (newest first)
            reviews.sort(key=lambda x: x.created_at, reverse=True)
            return reviews[:limit]
    
    def _load_data(self):
        """Load marketplace data from disk."""
        try:
            # Load listings
            listings_file = self._marketplace_dir / "listings.json"
            if listings_file.exists():
                with open(listings_file, 'r') as f:
                    data = json.load(f)
                    for tool_id, listing_data in data.items():
                        manifest = ToolManifest.from_dict(listing_data["manifest"])
                        listing = ToolListing(
                            manifest=manifest,
                            status=ToolStatus(listing_data["status"]),
                            published_at=datetime.fromisoformat(listing_data["published_at"]),
                            updated_at=datetime.fromisoformat(listing_data["updated_at"]),
                            downloads=listing_data["downloads"],
                            rating=listing_data["rating"],
                            review_count=listing_data["review_count"],
                            verified=listing_data["verified"],
                            publisher_id=listing_data["publisher_id"]
                        )
                        self._listings[tool_id] = listing
            
            # Load installed tools
            installed_file = self._marketplace_dir / "installed.json"
            if installed_file.exists():
                with open(installed_file, 'r') as f:
                    data = json.load(f)
                    for install_id, manifest_data in data.items():
                        self._installed_tools[install_id] = ToolManifest.from_dict(manifest_data)
            
            self._logger.info(f"Loaded {len(self._listings)} tool listings")
            
        except Exception as e:
            self._logger.error(f"Failed to load marketplace data: {e}")
    
    def _save_data(self):
        """Save marketplace data to disk."""
        try:
            # Save listings
            listings_file = self._marketplace_dir / "listings.json"
            with open(listings_file, 'w') as f:
                data = {tool_id: listing.to_dict() for tool_id, listing in self._listings.items()}
                json.dump(data, f, indent=2)
            
            # Save installed tools
            installed_file = self._marketplace_dir / "installed.json"
            with open(installed_file, 'w') as f:
                data = {install_id: manifest.to_dict() for install_id, manifest in self._installed_tools.items()}
                json.dump(data, f, indent=2)
            
        except Exception as e:
            self._logger.error(f"Failed to save marketplace data: {e}")


# Remote Marketplace Client

class RemoteMarketplaceClient:
    """Client for remote tool marketplace."""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self._logger = logging.getLogger("agenticx.marketplace.remote")
        self._base_url = base_url.rstrip('/')
        self._api_key = api_key
        self._session = requests.Session()
        
        if api_key:
            self._session.headers.update({"Authorization": f"Bearer {api_key}"})
    
    def search_tools(self, query: str = "", **kwargs) -> List[Dict[str, Any]]:
        """Search tools on remote marketplace."""
        params = {"query": query, **kwargs}
        
        try:
            response = self._session.get(f"{self._base_url}/api/tools/search", params=params)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            self._logger.error(f"Failed to search remote tools: {e}")
            return []
    
    def get_tool(self, tool_name: str, version: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get tool from remote marketplace."""
        try:
            url = f"{self._base_url}/api/tools/{tool_name}"
            if version:
                url += f"/{version}"
            
            response = self._session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise
        except Exception as e:
            self._logger.error(f"Failed to get remote tool {tool_name}: {e}")
            return None
    
    def download_tool(self, tool_name: str, version: str,
                     download_dir: str) -> bool:
        """Download tool from remote marketplace."""
        try:
            url = f"{self._base_url}/api/tools/{tool_name}/{version}/download"
            response = self._session.get(url, stream=True)
            response.raise_for_status()
            
            # Save to temporary file
            temp_file = tempfile.NamedTemporaryFile(delete=False)
            for chunk in response.iter_content(chunk_size=8192):
                temp_file.write(chunk)
            temp_file.close()
            
            # Extract to download directory
            download_path = Path(download_dir)
            download_path.mkdir(parents=True, exist_ok=True)
            
            # For simplicity, assume it's a zip file
            import zipfile
            with zipfile.ZipFile(temp_file.name, 'r') as zip_ref:
                zip_ref.extractall(download_path)
            
            # Clean up temp file
            os.unlink(temp_file.name)
            
            self._logger.info(f"Downloaded tool {tool_name}@{version}")
            return True
            
        except Exception as e:
            self._logger.error(f"Failed to download tool {tool_name}: {e}")
            return False


# Global marketplace instance
_global_marketplace = None


def get_marketplace(marketplace_dir: str = "~/.agenticx/marketplace",
                   registry: Optional[ToolRegistry] = None,
                   security_manager: Optional[SecurityManager] = None) -> ToolMarketplace:
    """Get the global marketplace instance."""
    global _global_marketplace
    
    if _global_marketplace is None:
        _global_marketplace = ToolMarketplace(
            marketplace_dir=marketplace_dir,
            registry=registry,
            security_manager=security_manager
        )
    
    return _global_marketplace