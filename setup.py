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
    with open(os.path.join(here, 'requirements.txt'), encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip() and not line.startswith('#')]

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

# 基本依赖
install_requires = [
    # 核心依赖
    "pydantic>=2.0.0,<3.0.0",
    "typing-extensions>=4.0.0",
    "loguru>=0.7.0",
    "rich>=13.0.0",
    "aiohttp>=3.8.0",
    "asyncio-mqtt>=0.13.0",
    "websockets>=11.0.0",
    
    # LLM依赖
    "litellm>=1.40.0",
    "openai>=1.0.0",
    "anthropic>=0.25.0",
    "ollama>=0.2.0",
    
    # 工具依赖
    "mcp>=1.0.0",
    "httpx>=0.25.0",
    "requests>=2.31.0",
    
    # 记忆依赖
    "mem0ai>=0.1.0",
    "chromadb>=0.4.0",
    "qdrant-client>=1.7.0",
    
    # 监控依赖
    "prometheus-client>=0.18.0",
    "opentelemetry-api>=1.20.0",
    "opentelemetry-sdk>=1.20.0",
    
    # 数据处理
    "pandas>=2.0.0",
    "numpy>=1.24.0",
    
    # 实用工具
    "python-dotenv>=1.0.0",
    "click>=8.0.0",
    "PyYAML>=6.0.0",
    "jinja2>=3.0.0",
]

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
    ],
}

setup(
    name="agenticx",
    version=version,
    description="A unified, scalable, production-ready multi-agent application development framework",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="AgenticX Team",
    author_email="team@agenticx.ai",
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
    python_requires=">=3.10",
    install_requires=install_requires,
    extras_require=extras_require,
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
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