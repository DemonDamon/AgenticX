#!/usr/bin/env python3
"""
Smoke tests for VolcEngineComponent deployment component.

Tests the end-to-end artifact generation for Volcengine AgentKit deployment.

Author: Damon Li
"""

import pytest
from pathlib import Path

from agenticx.deploy.types import DeploymentConfig, DeploymentStatus


def _make_config(tmp_path, **overrides):
    """Create a DeploymentConfig for testing."""
    props = {
        "agent_name": "test-agent",
        "agent_module": "my_agent",
        "agent_var": "agent",
        "output_dir": str(tmp_path / "deploy_output"),
    }
    props.update(overrides)
    return DeploymentConfig(
        name="test-deploy",
        component="volcengine",
        props=props,
    )


@pytest.mark.asyncio
async def test_component_name():
    """Test component name property."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    assert component.name == "volcengine"
    assert component.version == "0.1.0"


@pytest.mark.asyncio
async def test_component_deploy_generates_artifacts(tmp_path):
    """Test that deploy generates all required artifacts."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path)

    result = await component.deploy(config)

    # Should succeed
    assert result.success is True
    assert result.status == DeploymentStatus.PENDING
    assert "generated" in result.message.lower() or "artifact" in result.message.lower()

    # Check generated files
    output_dir = Path(config.props["output_dir"])
    assert (output_dir / "wrapper.py").exists()
    assert (output_dir / "agentkit.yaml").exists()
    assert (output_dir / "Dockerfile").exists()
    assert (output_dir / "requirements.txt").exists()

    # Check metadata
    assert "generated_files" in result.metadata
    assert len(result.metadata["generated_files"]) == 4
    assert result.metadata["agent_name"] == "test-agent"


@pytest.mark.asyncio
async def test_component_deploy_wrapper_content(tmp_path):
    """Test that generated wrapper.py has correct content."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path)

    await component.deploy(config)

    output_dir = Path(config.props["output_dir"])
    wrapper_content = (output_dir / "wrapper.py").read_text()

    assert "from my_agent import agent" in wrapper_content
    assert "AgentkitSimpleApp" in wrapper_content
    assert "app.entrypoint" in wrapper_content


@pytest.mark.asyncio
async def test_component_deploy_streaming_wrapper(tmp_path):
    """Test that streaming mode generates async wrapper."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path, streaming=True)

    await component.deploy(config)

    output_dir = Path(config.props["output_dir"])
    wrapper_content = (output_dir / "wrapper.py").read_text()

    assert "async def run" in wrapper_content
    assert "yield event" in wrapper_content


@pytest.mark.asyncio
async def test_component_deploy_dockerfile_content(tmp_path):
    """Test that generated Dockerfile has correct content."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path, python_version="3.11")

    await component.deploy(config)

    output_dir = Path(config.props["output_dir"])
    dockerfile_content = (output_dir / "Dockerfile").read_text()

    assert "FROM " in dockerfile_content
    assert "python3.11" in dockerfile_content
    assert "EXPOSE 8000" in dockerfile_content


@pytest.mark.asyncio
async def test_component_deploy_agentkit_yaml_content(tmp_path):
    """Test that generated agentkit.yaml has correct content."""
    import yaml
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path, strategy="local")

    await component.deploy(config)

    output_dir = Path(config.props["output_dir"])
    with open(output_dir / "agentkit.yaml", "r") as f:
        yaml_content = yaml.safe_load(f)

    assert yaml_content["common"]["agent_name"] == "test-agent"
    assert yaml_content["common"]["launch_type"] == "local"
    assert "local" in yaml_content["launch_types"]


@pytest.mark.asyncio
async def test_component_deploy_requirements_content(tmp_path):
    """Test that generated requirements.txt includes agenticx."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path, extra_deps=["flask>=2.0", "requests"])

    await component.deploy(config)

    output_dir = Path(config.props["output_dir"])
    requirements_content = (output_dir / "requirements.txt").read_text()

    assert "agenticx" in requirements_content
    assert "flask>=2.0" in requirements_content
    assert "requests" in requirements_content


@pytest.mark.asyncio
async def test_component_validate_missing_required_props(tmp_path):
    """Test validate catches missing required properties."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()

    # Config with missing required props
    config = DeploymentConfig(
        name="test-deploy",
        component="volcengine",
        props={"output_dir": str(tmp_path)},
    )

    errors = await component.validate(config)
    assert len(errors) > 0
    # Should mention missing agent_name, agent_module, agent_var
    error_text = " ".join(errors)
    assert "agent_name" in error_text
    assert "agent_module" in error_text
    assert "agent_var" in error_text


@pytest.mark.asyncio
async def test_component_validate_invalid_strategy(tmp_path):
    """Test validate catches invalid strategy."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path, strategy="invalid_strategy")

    errors = await component.validate(config)
    assert any("strategy" in e.lower() for e in errors)


@pytest.mark.asyncio
async def test_component_deploy_fails_on_validation_error(tmp_path):
    """Test that deploy returns failure when validation fails."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()

    # Missing required props
    config = DeploymentConfig(
        name="test-deploy",
        component="volcengine",
        props={},
    )

    result = await component.deploy(config)
    assert result.success is False
    assert result.status == DeploymentStatus.FAILED
    assert "validation" in result.message.lower()


@pytest.mark.asyncio
async def test_component_status_returns_unknown(tmp_path):
    """Test that status returns UNKNOWN in MVP stage."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path)

    result = await component.status(config)
    assert result.status == DeploymentStatus.UNKNOWN
    assert "volcengine-test-agent" in result.deployment_id


@pytest.mark.asyncio
async def test_component_remove_not_implemented(tmp_path):
    """Test that remove returns not-implemented message in MVP stage."""
    from agenticx.deploy.components.volcengine.component import VolcEngineComponent

    component = VolcEngineComponent()
    config = _make_config(tmp_path)

    result = await component.remove(config)
    assert result.success is False
    # Message changed from "not implemented" to "not installed" when agentkit CLI absent
    assert "not installed" in result.message.lower() or "not implemented" in result.message.lower()


@pytest.mark.asyncio
async def test_component_registered_in_components():
    """Test that VolcEngineComponent is registered in components registry."""
    from agenticx.deploy.components import get_component

    component_cls = get_component("volcengine")
    # Should be available (registered via __init__.py try/import)
    assert component_cls is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
