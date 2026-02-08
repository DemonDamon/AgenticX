#!/usr/bin/env python3
"""
Smoke tests for AgentKit Dockerfile Generator.

Tests the generation of Dockerfiles and requirements.txt for AgentKit deployment.

Author: Damon Li
"""

import pytest
from pathlib import Path


def test_generate_dockerfile_default():
    """Test generating Dockerfile with default parameters."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    content = generate_dockerfile()

    # Check essential Dockerfile instructions
    assert "FROM " in content
    assert "ENV UV_SYSTEM_PYTHON=1" in content
    assert "EXPOSE 8000" in content
    assert "WORKDIR /app" in content
    assert "COPY . ." in content
    assert 'CMD ["python", "-m", "wrapper"]' in content

    # Check default base image includes python version
    assert "python3.12" in content

    # Check dependencies section
    assert "COPY requirements.txt" in content
    assert "uv pip install -r requirements.txt" in content


def test_generate_dockerfile_custom_base_image():
    """Test generating Dockerfile with custom base image."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    content = generate_dockerfile(base_image="python:3.11-slim")

    assert "FROM python:3.11-slim" in content
    # Should not contain default AgentKit image
    assert "agentkit-prod-public" not in content


def test_generate_dockerfile_custom_python_version():
    """Test generating Dockerfile with custom Python version."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    content = generate_dockerfile(python_version="3.11")

    assert "python3.11" in content


def test_generate_dockerfile_custom_entry_point():
    """Test generating Dockerfile with custom entry point."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    content = generate_dockerfile(entry_point="my_agent.main")

    assert 'CMD ["python", "-m", "my_agent.main"]' in content


def test_generate_dockerfile_extra_envs():
    """Test generating Dockerfile with extra environment variables."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    extra_envs = {"API_KEY": "test-key", "DEBUG": "true"}
    content = generate_dockerfile(extra_envs=extra_envs)

    assert "ENV API_KEY=test-key" in content
    assert "ENV DEBUG=true" in content


def test_generate_dockerfile_with_build_script():
    """Test generating Dockerfile with build script."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    content = generate_dockerfile(build_script="setup.sh")

    assert "COPY setup.sh /tmp/build_script.sh" in content
    assert "chmod +x /tmp/build_script.sh" in content


def test_generate_dockerfile_empty_entry_point():
    """Test that empty entry_point raises ValueError."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
    )

    with pytest.raises(ValueError, match="entry_point cannot be empty"):
        generate_dockerfile(entry_point="")

    with pytest.raises(ValueError, match="entry_point cannot be empty"):
        generate_dockerfile(entry_point="   ")


def test_save_dockerfile(tmp_path):
    """Test saving Dockerfile to disk."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
        save_dockerfile,
    )

    content = generate_dockerfile()
    output_path = tmp_path / "Dockerfile"
    result_path = save_dockerfile(content, str(output_path))

    # Check file was created
    assert output_path.exists()
    assert result_path == output_path

    # Check content was written correctly
    saved_content = output_path.read_text()
    assert "FROM " in saved_content
    assert "EXPOSE 8000" in saved_content


def test_save_dockerfile_creates_parent_dirs(tmp_path):
    """Test that save_dockerfile creates parent directories."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_dockerfile,
        save_dockerfile,
    )

    content = generate_dockerfile()
    output_path = tmp_path / "nested" / "build" / "Dockerfile"
    save_dockerfile(content, str(output_path))

    assert output_path.exists()
    assert output_path.parent.exists()


def test_generate_requirements_default():
    """Test generating requirements.txt with default settings."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_requirements,
    )

    content = generate_requirements()

    assert "agenticx" in content
    # Should end with newline
    assert content.endswith("\n")


def test_generate_requirements_with_version():
    """Test generating requirements.txt with version pin."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_requirements,
    )

    content = generate_requirements(agenticx_version=">=0.1.0")

    assert "agenticx>=0.1.0" in content


def test_generate_requirements_with_extra_deps():
    """Test generating requirements.txt with extra dependencies."""
    from agenticx.deploy.components.volcengine.dockerfile_generator import (
        generate_requirements,
    )

    extra_deps = ["flask>=2.0", "requests", "pydantic>=2.0"]
    content = generate_requirements(extra_deps=extra_deps)

    assert "agenticx" in content
    assert "flask>=2.0" in content
    assert "requests" in content
    assert "pydantic>=2.0" in content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
