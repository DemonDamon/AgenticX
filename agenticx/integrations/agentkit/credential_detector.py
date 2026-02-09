#!/usr/bin/env python3
"""Credential Auto-Detection for AgentKit Runtime.

Automatically detects and injects credentials from AgentKit platform
environment variables when running in cloud mode, and provides helpful
guidance for local mode configuration.

Author: Damon Li
"""

import os
import logging
from typing import Dict, Optional, Tuple, List

logger = logging.getLogger(__name__)


class CredentialDetector:
    """Detects and manages credentials for AgentKit deployments.

    Automatically detects whether running in AgentKit Runtime environment
    and extracts credentials from environment variables. Provides fallback
    guidance for local development.

    Example:
        >>> detector = CredentialDetector()
        >>> is_cloud, creds = detector.detect()
        >>> if is_cloud:
        ...     print("Running in AgentKit cloud environment")
        ...     print(f"Model: {creds.get('model_endpoint_id')}")
    """

    # Environment variables checked for cloud mode detection
    CLOUD_MODE_INDICATORS = [
        "AGENTKIT_RUNTIME_ID",
        "AGENTKIT_ENVIRONMENT",
        "VOLCENGINE_RUNTIME_ID",
    ]

    # Credential environment variables
    MODEL_AGENT_NAME_ENV = "MODEL_AGENT_NAME"
    MODEL_AGENT_API_KEY_ENV = "MODEL_AGENT_API_KEY"
    VOLCENGINE_ACCESS_KEY_ENV = "VOLCENGINE_ACCESS_KEY"
    VOLCENGINE_SECRET_KEY_ENV = "VOLCENGINE_SECRET_KEY"

    def __init__(self) -> None:
        """Initialize the credential detector."""
        self._cached_result: Optional[Tuple[bool, Dict[str, str]]] = None

    def is_cloud_mode(self) -> bool:
        """Check if running in AgentKit cloud runtime environment.

        Returns:
            True if any cloud mode indicator environment variable is set.
        """
        return any(
            os.getenv(indicator) for indicator in self.CLOUD_MODE_INDICATORS
        )

    def detect(self) -> Tuple[bool, Dict[str, Optional[str]]]:
        """Detect credentials and runtime mode.

        Returns:
            Tuple of (is_cloud_mode, credentials_dict).
            credentials_dict contains:
                - model_endpoint_id: MODEL_AGENT_NAME value
                - model_api_key: MODEL_AGENT_API_KEY value
                - volcengine_access_key: VOLCENGINE_ACCESS_KEY value
                - volcengine_secret_key: VOLCENGINE_SECRET_KEY value
        """
        if self._cached_result is not None:
            return self._cached_result

        is_cloud = self.is_cloud_mode()

        credentials = {
            "model_endpoint_id": os.getenv(self.MODEL_AGENT_NAME_ENV),
            "model_api_key": os.getenv(self.MODEL_AGENT_API_KEY_ENV),
            "volcengine_access_key": os.getenv(
                self.VOLCENGINE_ACCESS_KEY_ENV
            ),
            "volcengine_secret_key": os.getenv(
                self.VOLCENGINE_SECRET_KEY_ENV
            ),
        }

        self._cached_result = (is_cloud, credentials)

        if is_cloud:
            logger.info(
                "Detected AgentKit cloud runtime environment. "
                "Using platform-injected credentials."
            )
        else:
            logger.info(
                "Running in local mode. "
                "Configure credentials via environment variables or CLI."
            )

        return self._cached_result

    def get_model_credentials(
        self,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Get model endpoint ID and API key.

        Returns:
            Tuple of (endpoint_id, api_key).
        """
        _, creds = self.detect()
        return (
            creds.get("model_endpoint_id"),
            creds.get("model_api_key"),
        )

    def get_volcengine_credentials(
        self,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Get Volcengine AK/SK credentials.

        Returns:
            Tuple of (access_key, secret_key).
        """
        _, creds = self.detect()
        return (
            creds.get("volcengine_access_key"),
            creds.get("volcengine_secret_key"),
        )

    def validate_credentials(
        self, required: Optional[List[str]] = None
    ) -> Tuple[bool, List[str]]:
        """Validate that required credentials are present.

        Args:
            required: List of required credential keys.
                     Default: ["model_endpoint_id", "model_api_key"].

        Returns:
            Tuple of (is_valid, missing_keys_list).
        """
        if required is None:
            required = ["model_endpoint_id", "model_api_key"]

        _, creds = self.detect()

        missing = []
        for key in required:
            if not creds.get(key):
                missing.append(key)

        return len(missing) == 0, missing

    def get_configuration_help(self) -> str:
        """Get help text for configuring credentials in local mode.

        Returns:
            Helpful configuration instructions.
        """
        is_cloud, creds = self.detect()

        if is_cloud:
            return (
                "Running in AgentKit cloud environment. "
                "Credentials are automatically injected by the platform."
            )

        help_text = [
            "Local mode detected. Configure credentials:",
            "",
            "Option 1: Environment variables",
            f"  export {self.MODEL_AGENT_NAME_ENV}=ep-xxxxx",
            f"  export {self.MODEL_AGENT_API_KEY_ENV}=your-api-key",
            "",
            "Option 2: Via CLI",
            "  agx volcengine config --model ep-xxxxx --api-key your-key",
            "",
            "Option 3: In agentkit.yaml",
            "  runtime_envs:",
            f"    {self.MODEL_AGENT_NAME_ENV}: ep-xxxxx",
            f"    {self.MODEL_AGENT_API_KEY_ENV}: your-api-key",
        ]

        missing, _ = self.validate_credentials()
        if not missing:
            help_text.append("\n[green]All required credentials are configured.[/green]")
        else:
            help_text.append("\n[yellow]Some credentials are missing.[/yellow]")

        return "\n".join(help_text)
