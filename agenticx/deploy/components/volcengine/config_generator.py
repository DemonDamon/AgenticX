#!/usr/bin/env python3
"""
AgentKit YAML Configuration Generator

Generates agentkit.yaml configuration files for deploying AgenticX Agents
to Volcengine AgentKit platform.

Author: Damon Li
"""

import logging
from typing import Dict, Any, Optional
from pathlib import Path
import yaml

logger = logging.getLogger(__name__)


def generate_agentkit_yaml(
    agent_name: str,
    strategy: str = "hybrid",
    region: str = "cn-beijing",
    entry_point: str = "wrapper.py",
    runtime_envs: Optional[Dict[str, str]] = None,
    python_version: str = "3.12",
    dependencies_file: str = "requirements.txt",
) -> Dict[str, Any]:
    """
    Generate agentkit.yaml configuration dict.
    
    Aligns with upstream strategy_configs.py (LocalStrategyConfig, 
    HybridStrategyConfig, CloudStrategyConfig).
    
    Args:
        agent_name: Name of the agent/project
        strategy: Deployment strategy - "local", "hybrid", or "cloud"
        region: Volcengine region (e.g., "cn-beijing", "cn-shanghai")
        entry_point: Python module path for entry point (e.g., "wrapper.py")
        runtime_envs: Runtime environment variables dict
        python_version: Python version (e.g., "3.12")
        dependencies_file: Requirements file name
        
    Returns:
        Configuration dict ready for YAML serialization
        
    Raises:
        ValueError: If agent_name is empty or strategy is invalid
    """
    if not agent_name or not agent_name.strip():
        raise ValueError("agent_name cannot be empty")
    
    valid_strategies = ["local", "hybrid", "cloud"]
    if strategy not in valid_strategies:
        raise ValueError(
            f"Invalid strategy '{strategy}'. Must be one of: {valid_strategies}"
        )
    
    runtime_envs = runtime_envs or {}
    
    # Common configuration
    config = {
        "common": {
            "agent_name": agent_name,
            "entry_point": entry_point,
            "language": "Python",
            "language_version": python_version,
            "dependencies_file": dependencies_file,
            "launch_type": strategy,
            "runtime_envs": runtime_envs,
        },
        "launch_types": {}
    }
    
    # Strategy-specific configuration
    if strategy == "local":
        config["launch_types"]["local"] = {
            "image_tag": "latest",
            "invoke_port": 8000,
            "container_name": agent_name,
            "ports": ["8000:8000"],
            "restart_policy": "unless-stopped",
            "memory_limit": "1g",
            "cpu_limit": "1",
        }
    
    elif strategy == "hybrid":
        config["launch_types"]["hybrid"] = {
            "region": region,
            "image_tag": "{{timestamp}}",
            "cr_instance_name": "Auto",
            "cr_namespace_name": "agenticx",
            "cr_repo_name": agent_name,
            "runtime_name": f"{agent_name}-runtime",
            "runtime_auth_type": "key_auth",
        }
    
    elif strategy == "cloud":
        config["launch_types"]["cloud"] = {
            "region": region,
            "image_tag": "{{timestamp}}",
            "tos_bucket": "Auto",
            "tos_prefix": "agentkit-builds",
            "cr_instance_name": "Auto",
            "cr_namespace_name": "agenticx",
            "cr_repo_name": agent_name,
            "runtime_name": f"{agent_name}-runtime",
            "runtime_auth_type": "key_auth",
            "build_timeout": 3600,
        }
    
    return config


def save_agentkit_yaml(
    config: Dict[str, Any],
    output_path: str
) -> Path:
    """
    Save agentkit.yaml configuration to file.
    
    Args:
        config: Configuration dict from generate_agentkit_yaml()
        output_path: Path to write the YAML file
        
    Returns:
        Path object of the written file
    """
    output_path = Path(output_path)
    
    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write YAML
    with open(output_path, 'w', encoding='utf-8') as f:
        yaml.dump(
            config,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False
        )
    
    logger.info(f"Generated agentkit.yaml: {output_path}")
    return output_path
