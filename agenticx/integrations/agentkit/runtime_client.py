#!/usr/bin/env python3
"""AgentKit Runtime Client for AgenticX.

Provides programmatic access to AgentKit Runtime service for managing
deployed agent instances, checking status, and performing lifecycle operations.

Author: Damon Li
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class AgentkitRuntimeClient:
    """Client for AgentKit Runtime service operations.

    Provides methods to create, query, list, and destroy runtime instances
    on the Volcengine AgentKit platform.

    Example:
        >>> client = AgentkitRuntimeClient()
        >>> status = await client.get_runtime_status("my-agent-runtime")
        >>> runtimes = await client.list_runtimes()
    """

    def __init__(self, api_config: Optional[Dict[str, Any]] = None):
        """Initialize the runtime client.

        Args:
            api_config: Optional API configuration for AgentkitRuntime SDK client.
        """
        self.api_config = api_config or {}
        self._client = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        """Lazily initialize the AgentKit runtime client."""
        if self._initialized:
            return

        try:
            from agentkit.sdk.runtime import AgentkitRuntime

            self._client = AgentkitRuntime(**self.api_config)
            self._initialized = True
            logger.info("AgentKit runtime client initialized")
        except ImportError:
            logger.warning(
                "agentkit-sdk-python not installed. "
                "Runtime operations will be unavailable."
            )
            self._initialized = True
        except Exception as e:
            logger.error(f"Failed to init AgentKit runtime client: {e}")
            self._initialized = True

    async def create_runtime(
        self,
        runtime_name: str,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new runtime instance.

        Args:
            runtime_name: Name for the runtime instance.
            config: Optional runtime configuration.

        Returns:
            Runtime creation result with runtime_id and status.
        """
        await self._ensure_initialized()

        if not self._client:
            raise RuntimeError(
                "AgentKit runtime client not available. "
                "Install agentkit-sdk-python."
            )

        try:
            result = self._client.create_runtime(
                name=runtime_name,
                config=config or {},
            )
            logger.info(f"Runtime created: {runtime_name}")
            return result
        except Exception as e:
            logger.error(f"Failed to create runtime: {e}")
            raise

    async def get_runtime_status(self, runtime_name: str) -> Dict[str, Any]:
        """Get the status of a runtime instance.

        Args:
            runtime_name: Name of the runtime.

        Returns:
            Status dictionary with state, health, and metadata.
        """
        await self._ensure_initialized()

        if not self._client:
            return {
                "name": runtime_name,
                "status": "unknown",
                "message": "Runtime client not available",
            }

        try:
            status = self._client.get_runtime_status(runtime_name)
            return status
        except Exception as e:
            logger.error(f"Failed to get runtime status: {e}")
            return {
                "name": runtime_name,
                "status": "error",
                "error": str(e),
            }

    async def list_runtimes(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List all runtime instances.

        Args:
            limit: Maximum number of runtimes to return.
            offset: Offset for pagination.

        Returns:
            List of runtime information dictionaries.
        """
        await self._ensure_initialized()

        if not self._client:
            return []

        try:
            runtimes = self._client.list_runtimes(limit=limit, offset=offset)
            return runtimes or []
        except Exception as e:
            logger.error(f"Failed to list runtimes: {e}")
            return []

    async def destroy_runtime(self, runtime_name: str) -> bool:
        """Destroy a runtime instance and clean up resources.

        Args:
            runtime_name: Name of the runtime to destroy.

        Returns:
            True if destruction succeeded.
        """
        await self._ensure_initialized()

        if not self._client:
            logger.warning("Runtime client not available")
            return False

        try:
            self._client.destroy_runtime(runtime_name)
            logger.info(f"Runtime destroyed: {runtime_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to destroy runtime: {e}")
            return False

    async def restart_runtime(self, runtime_name: str) -> bool:
        """Restart a runtime instance.

        Args:
            runtime_name: Name of the runtime to restart.

        Returns:
            True if restart succeeded.
        """
        await self._ensure_initialized()

        if not self._client:
            return False

        try:
            self._client.restart_runtime(runtime_name)
            logger.info(f"Runtime restarted: {runtime_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to restart runtime: {e}")
            return False
