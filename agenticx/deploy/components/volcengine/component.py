#!/usr/bin/env python3
"""
AgenticX VolcEngine Deployment Component

Integrates ConfigGenerator, DockerfileGenerator, and AgentWrapper to produce
deployment artifacts for the Volcengine AgentKit platform.

MVP scope: Generates deployment artifacts (wrapper.py, agentkit.yaml, Dockerfile,
requirements.txt) without actually calling Volcengine APIs.

Author: Damon Li
"""

import logging
import os
from typing import Dict, Any, List
from datetime import datetime
from pathlib import Path

from ...base import DeploymentComponent
from ...types import (
    DeploymentConfig,
    DeploymentResult,
    RemoveResult,
    StatusResult,
    DeploymentStatus,
)
from .config_generator import generate_agentkit_yaml, save_agentkit_yaml
from .dockerfile_generator import (
    generate_dockerfile,
    save_dockerfile,
    generate_requirements,
)

logger = logging.getLogger(__name__)


class VolcEngineComponent(DeploymentComponent):
    """
    VolcEngine AgentKit deployment component.

    Generates deployment artifacts for publishing AgenticX Agents
    to the Volcengine AgentKit platform. In MVP stage, this component
    produces local files without calling Volcengine cloud APIs.

    Required props:
        agent_name: Name of the agent (str)
        agent_module: Python module path for the agent (str)
        agent_var: Variable name of the agent in the module (str)

    Optional props:
        strategy: Deployment strategy - "local", "hybrid", "cloud" (default: "hybrid")
        region: Volcengine region (default: "cn-beijing")
        python_version: Python version (default: "3.12")
        base_image: Custom Docker base image (default: None, uses AgentKit default)
        streaming: Enable SSE streaming mode (default: False)
        extra_envs: Additional environment variables dict (default: {})
        extra_deps: Additional pip dependencies list (default: [])
        output_dir: Output directory for artifacts (default: "./deploy_output")
        dependencies_file: Requirements file name (default: "requirements.txt")

    Example:
        >>> config = DeploymentConfig(
        ...     name="my-agent-deploy",
        ...     component="volcengine",
        ...     props={
        ...         "agent_name": "my-agent",
        ...         "agent_module": "my_agent",
        ...         "agent_var": "agent",
        ...     },
        ... )
        >>> component = VolcEngineComponent()
        >>> result = await component.deploy(config)
    """

    @property
    def name(self) -> str:
        return "volcengine"

    @property
    def version(self) -> str:
        return "0.1.0"

    @property
    def description(self) -> str:
        return "Volcengine AgentKit deployment adapter"

    def get_required_props(self) -> List[str]:
        return ["agent_name", "agent_module", "agent_var"]

    def get_optional_props(self) -> Dict[str, Any]:
        return {
            "strategy": "hybrid",
            "region": "cn-beijing",
            "python_version": "3.12",
            "base_image": None,
            "streaming": False,
            "extra_envs": {},
            "extra_deps": [],
            "output_dir": "./deploy_output",
            "dependencies_file": "requirements.txt",
        }

    async def validate(self, config: DeploymentConfig) -> List[str]:
        """
        Validate deployment configuration.

        Checks that all required props are present and valid.

        Args:
            config: Deployment configuration

        Returns:
            List of error messages, empty if valid
        """
        errors = await super().validate(config)

        # Check required props
        for prop in self.get_required_props():
            if prop not in config.props or not config.props[prop]:
                errors.append(f"Required property '{prop}' is missing or empty")

        # Validate strategy if provided
        strategy = config.props.get("strategy", "hybrid")
        valid_strategies = ["local", "hybrid", "cloud"]
        if strategy not in valid_strategies:
            errors.append(
                f"Invalid strategy '{strategy}'. Must be one of: {valid_strategies}"
            )

        return errors

    async def deploy(self, config: DeploymentConfig) -> DeploymentResult:
        """
        Generate deployment artifacts for Volcengine AgentKit.

        In MVP stage, this creates local files:
        - wrapper.py: AgentKit-compatible wrapper for the agent
        - agentkit.yaml: Deployment configuration
        - Dockerfile: Container build instructions
        - requirements.txt: Python dependencies

        Args:
            config: Deployment configuration with volcengine-specific props

        Returns:
            DeploymentResult with generated artifact paths in metadata
        """
        # Validate first
        errors = await self.validate(config)
        if errors:
            return DeploymentResult(
                success=False,
                status=DeploymentStatus.FAILED,
                message=f"Validation failed: {'; '.join(errors)}",
            )

        await self.pre_deploy(config)

        props = config.props
        agent_name = props["agent_name"]
        agent_module = props["agent_module"]
        agent_var = props["agent_var"]
        strategy = props.get("strategy", "hybrid")
        region = props.get("region", "cn-beijing")
        python_version = props.get("python_version", "3.12")
        base_image = props.get("base_image")
        streaming = props.get("streaming", False)
        extra_envs = props.get("extra_envs", {})
        extra_deps = props.get("extra_deps", [])
        output_dir = props.get("output_dir", "./deploy_output")
        dependencies_file = props.get("dependencies_file", "requirements.txt")

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        generated_files = []

        try:
            # 1. Generate wrapper.py
            from .wrapper import AgenticXAgentWrapper

            # We need a dummy agent+llm to use generate_wrapper_file
            # In deploy context, we generate the file from templates directly
            wrapper_content = self._generate_wrapper_content(
                agent_module=agent_module,
                agent_var=agent_var,
                streaming=streaming,
            )
            wrapper_path = output_path / "wrapper.py"
            wrapper_path.write_text(wrapper_content, encoding="utf-8")
            generated_files.append(str(wrapper_path))
            logger.info(f"Generated wrapper: {wrapper_path}")

            # 2. Generate agentkit.yaml
            yaml_config = generate_agentkit_yaml(
                agent_name=agent_name,
                strategy=strategy,
                region=region,
                entry_point="wrapper",
                runtime_envs=extra_envs,
                python_version=python_version,
                dependencies_file=dependencies_file,
            )
            yaml_path = save_agentkit_yaml(
                yaml_config, str(output_path / "agentkit.yaml")
            )
            generated_files.append(str(yaml_path))

            # 3. Generate Dockerfile
            dockerfile_content = generate_dockerfile(
                entry_point="wrapper",
                python_version=python_version,
                base_image=base_image,
                dependencies_file=dependencies_file,
                extra_envs=extra_envs,
            )
            dockerfile_path = save_dockerfile(
                dockerfile_content, str(output_path / "Dockerfile")
            )
            generated_files.append(str(dockerfile_path))

            # 4. Generate requirements.txt
            requirements_content = generate_requirements(extra_deps=extra_deps)
            requirements_path = output_path / dependencies_file
            requirements_path.write_text(requirements_content, encoding="utf-8")
            generated_files.append(str(requirements_path))
            logger.info(f"Generated requirements: {requirements_path}")

            result = DeploymentResult(
                success=True,
                deployment_id=f"volcengine-{agent_name}",
                status=DeploymentStatus.PENDING,
                message=(
                    f"Deployment artifacts generated in {output_dir}. "
                    f"Use 'agentkit deploy' to publish to Volcengine."
                ),
                started_at=datetime.now(),
                metadata={
                    "output_dir": str(output_path.resolve()),
                    "generated_files": generated_files,
                    "strategy": strategy,
                    "agent_name": agent_name,
                },
            )

        except Exception as e:
            logger.exception(f"Failed to generate deployment artifacts: {e}")
            result = DeploymentResult(
                success=False,
                deployment_id=f"volcengine-{agent_name}",
                status=DeploymentStatus.FAILED,
                message=f"Artifact generation failed: {str(e)}",
            )

        await self.post_deploy(config, result)
        return result

    async def remove(self, config: DeploymentConfig) -> RemoveResult:
        """
        Remove deployment.

        MVP stage: Returns NotImplemented hint. Future versions will
        call Volcengine API to undeploy the agent.

        Args:
            config: Deployment configuration

        Returns:
            RemoveResult indicating not implemented
        """
        return RemoveResult(
            success=False,
            message=(
                "VolcEngine remove is not implemented in MVP stage. "
                "Use Volcengine console or 'agentkit remove' CLI to undeploy."
            ),
        )

    async def status(self, config: DeploymentConfig) -> StatusResult:
        """
        Query deployment status.

        MVP stage: Returns UNKNOWN. Future versions will call Volcengine
        API to check runtime status.

        Args:
            config: Deployment configuration

        Returns:
            StatusResult with UNKNOWN status
        """
        agent_name = config.props.get("agent_name", config.name)
        return StatusResult(
            deployment_id=f"volcengine-{agent_name}",
            status=DeploymentStatus.UNKNOWN,
        )

    def _generate_wrapper_content(
        self,
        agent_module: str,
        agent_var: str,
        streaming: bool = False,
    ) -> str:
        """
        Generate wrapper.py content from templates.

        Uses the same templates as AgenticXAgentWrapper.generate_wrapper_file()
        but without requiring an actual Agent instance.

        Args:
            agent_module: Python module path for the agent
            agent_var: Variable name of the agent
            streaming: Whether to use streaming template

        Returns:
            Wrapper file content string
        """
        from .wrapper import WRAPPER_TEMPLATE_BASIC, WRAPPER_TEMPLATE_STREAMING
        from string import Template

        template_str = (
            WRAPPER_TEMPLATE_STREAMING if streaming else WRAPPER_TEMPLATE_BASIC
        )
        template = Template(template_str)
        return template.substitute(
            agent_module_name=agent_module,
            agent_var_name=agent_var,
            agent_file_name=f"{agent_module}.py",
        )
