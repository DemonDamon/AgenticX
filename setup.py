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
    # 检查是否使用test.pypi.org的最小依赖
    use_testpypi = os.getenv('USE_TESTPYPI_DEPS', '').lower() in ('true', '1', 'yes')
    
    if use_testpypi:
        # 使用test.pypi.org兼容的最小依赖
        requirements_file = 'requirements-testpypi.txt'
    else:
        # 使用完整的requirements.txt
        requirements_file = 'requirements.txt'
    
    requirements_path = os.path.join(here, requirements_file)
    if not os.path.exists(requirements_path):
        # 如果test.pypi.org文件不存在，回退到主文件但过滤不兼容的包
        requirements_path = os.path.join(here, 'requirements.txt')
        use_testpypi = True
    
    with open(requirements_path, encoding='utf-8') as f:
        requirements = []
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if use_testpypi and requirements_file == 'requirements.txt':
                    # 过滤掉test.pypi.org上不可用的包
                    skip_packages = [
                        'litellm', 'openai', 'anthropic', 'ollama', 'mcp',
                        'mem0ai', 'chromadb', 'qdrant-client', 'redis',
                        'prometheus-client', 'opentelemetry-api', 'opentelemetry-sdk',
                        'pandas', 'numpy', 'networkx', 'neo4j', 'cdlib',
                        'mkdocs', 'mkdocs-material', 'pydoc-markdown',
                        'fastapi', 'uvicorn', 'httpx', 'aiohttp', 'websockets',
                        'asyncio-mqtt', 'typer'
                    ]
                    package_name = line.split('>=')[0].split('==')[0].split('<')[0]
                    if any(skip in package_name for skip in skip_packages):
                        continue
                    # 调整pydantic版本
                    if line.startswith('pydantic>=2.0.0'):
                        requirements.append('pydantic>=1.4,<2.0')
                        continue
                
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
    python_requires=">=3.10",
    install_requires=install_requires,
    extras_require=extras_require,
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
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