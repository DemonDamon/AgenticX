#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Setup script for AgenticX
"""

import os
import re
import sys
from setuptools import setup, find_packages

# 当前目录
here = os.path.abspath(os.path.dirname(__file__))

# 读取README文件
def read_readme():
    with open(os.path.join(here, 'README.md'), encoding='utf-8') as f:
        return f.read()

# 读取requirements.txt
def read_requirements():
    # 检查是否为TestPyPI构建
    use_testpypi = os.environ.get('USE_TESTPYPI_DEPS', 'false').lower() == 'true'
    
    if use_testpypi:
        requirements_path = os.path.join(here, 'requirements-testpypi.txt')
        print("使用TestPyPI兼容的最小依赖")
    else:
        requirements_path = os.path.join(here, 'requirements.txt')
        print("使用完整依赖")
    
    with open(requirements_path, encoding='utf-8') as f:
        requirements = []
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                requirements.append(line)
        return requirements

# 从__init__.py读取版本号
def read_version():
    version_file = os.path.join(here, 'agenticx', '__init__.py')
    with open(version_file, encoding='utf-8') as f:
        version_match = re.search(r"^__version__ = ['\"]([^'\"]*)['\"]", f.read(), re.M)
        if version_match:
            return version_match.group(1)
        raise RuntimeError("Unable to find version string.")

# 长描述
long_description = read_readme()

# 版本号
version = read_version()

# 基本依赖 - 从requirements.txt读取
install_requires = read_requirements()

# 额外依赖
extras_require = {
    "dev": [
        "pytest>=7.0.0",
        "pytest-asyncio>=0.21.0",
        "pytest-cov>=4.0.0",
        "black>=23.0.0",
        "flake8>=6.0.0",
        "mypy>=1.0.0",
        "pre-commit>=3.0.0",
        "twine>=4.0.0",
        "build>=0.10.0",
    ],
    "docs": [
        "mkdocs>=1.5.0",
        "mkdocs-material>=9.0.0",
        "mkdocstrings>=0.22.0",
        "mkdocs-autorefs>=0.4.0",
    ],
    # OpenTelemetry 集成（可选）
    # 内化来源: alibaba/loongsuite-python-agent
    "otel": [
        "opentelemetry-api>=1.20.0",
        "opentelemetry-sdk>=1.20.0",
        "opentelemetry-exporter-otlp>=1.20.0",
        "opentelemetry-semantic-conventions>=0.42b0",
    ],
    "all": [
        "pytest>=7.0.0",
        "pytest-asyncio>=0.21.0",
        "pytest-cov>=4.0.0",
        "black>=23.0.0",
        "flake8>=6.0.0",
        "mypy>=1.0.0",
        "pre-commit>=3.0.0",
        "twine>=4.0.0",
        "build>=0.10.0",
        "mkdocs>=1.5.0",
        "mkdocs-material>=9.0.0",
        "mkdocstrings>=0.22.0",
        "mkdocs-autorefs>=0.4.0",
        # OpenTelemetry
        "opentelemetry-api>=1.20.0",
        "opentelemetry-sdk>=1.20.0",
        "opentelemetry-exporter-otlp>=1.20.0",
        "opentelemetry-semantic-conventions>=0.42b0",
    ],
}

setup(
    name="agenticx",
    version=version,
    description="A unified, scalable, production-ready multi-agent application development framework",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Ziran Li",
    author_email="bingzhenli@hotmail.com",
    url="https://github.com/DemonDamon/AgenticX",
    project_urls={
        "Documentation": "https://agenticx.ai/docs",
        "Source": "https://github.com/DemonDamon/AgenticX",
        "Tracker": "https://github.com/DemonDamon/AgenticX/issues",
        "Discussions": "https://github.com/DemonDamon/AgenticX/discussions",
    },
    packages=find_packages(exclude=["tests*", "examples*", "docs*"]),
    include_package_data=True,
    zip_safe=False,
    python_requires=">=3.8",
    install_requires=install_requires,
    extras_require=extras_require,
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "Topic :: Internet :: WWW/HTTP :: Dynamic Content",
        "Topic :: System :: Distributed Computing",
    ],
    keywords="ai, agents, multi-agent, framework, automation, llm, workflow, orchestration",
    entry_points={
        "console_scripts": [
            "agenticx=agenticx.cli.main:main",
            "agx=agenticx.cli.main:main",
        ],
    },
    package_data={
        "agenticx": [
            "*.yaml",
            "*.yml",
            "*.json",
            "*.toml",
            "**/*.yaml",
            "**/*.yml", 
            "**/*.json",
            "**/*.toml",
        ],
    },
)