#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 文档生成器
支持自动生成API文档和用户文档
"""

import os
import json
import shutil
import subprocess
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
import http.server
import socketserver
import threading
import webbrowser

from rich.console import Console

console = Console()


class DocGenerator:
    """文档生成器"""
    
    def __init__(self):
        self.supported_formats = ["html", "markdown", "pdf", "json"]
        self.output_dir = Path("docs")
    
    def generate_docs(
        self,
        source: str = ".",
        output: str = "docs",
        format: str = "html"
    ) -> str:
        """生成文档"""
        if format not in self.supported_formats:
            raise ValueError(f"不支持的格式: {format}")
        
        console.print(f"[bold blue]生成文档:[/bold blue] {source} -> {output} ({format})")
        
        source_path = Path(source)
        output_path = Path(output)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # 生成基础文档
        self._create_basic_docs(source_path, output_path, format)
        
        console.print(f"[green]文档生成完成:[/green] {output_path}")
        return str(output_path)
    
    def _create_basic_docs(self, source_path: Path, output_path: Path, format: str):
        """创建基础文档"""
        if format == "html":
            # 创建HTML文档
            index_content = self._get_html_template()
            (output_path / "index.html").write_text(index_content, encoding='utf-8')
        elif format == "markdown":
            # 创建Markdown文档
            readme_content = self._get_markdown_template()
            (output_path / "README.md").write_text(readme_content, encoding='utf-8')
        elif format == "json":
            # 创建JSON文档
            docs_data = {
                "generated_at": datetime.now().isoformat(),
                "source_path": str(source_path)
            }
            (output_path / "docs.json").write_text(json.dumps(docs_data, indent=2), encoding='utf-8')
    
    def _get_html_template(self) -> str:
        """获取HTML模板"""
        return """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>AgenticX 文档</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .section { margin-bottom: 30px; }
        .card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        .code { background: #f8f9fa; padding: 15px; border-radius: 4px; font-family: monospace; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AgenticX 文档</h1>
            <p>统一的多智能体框架文档</p>
        </div>
        
        <div class="section">
            <h2>概述</h2>
            <div class="card">
                <p>AgenticX 是一个统一的多智能体框架，提供了从简单自动化助手到复杂协作式智能体系统的全部能力。</p>
            </div>
        </div>
        
        <div class="section">
            <h2>快速开始</h2>
            <div class="card">
                <div class="code">
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

# 创建智能体
agent = Agent(
    id="assistant",
    name="AI助手",
    role="助手",
    goal="帮助用户完成任务"
)

# 创建任务
task = Task(
    id="greeting",
    description="向用户问候",
    expected_output="友好的问候语"
)

# 执行任务
executor = AgentExecutor(agent=agent, llm=OpenAIProvider())
result = executor.run(task)
                </div>
            </div>
        </div>
    </div>
</body>
</html>"""
    
    def _get_markdown_template(self) -> str:
        """获取Markdown模板"""
        return f"""# AgenticX 文档

生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 概述

AgenticX 是一个统一的多智能体框架，提供了从简单自动化助手到复杂协作式智能体系统的全部能力。

## 安装

```bash
pip install agenticx
```

## 快速开始

```python
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

# 创建智能体
agent = Agent(
    id="assistant",
    name="AI助手",
    role="助手",
    goal="帮助用户完成任务"
)

# 创建任务
task = Task(
    id="greeting",
    description="向用户问候",
    expected_output="友好的问候语"
)

# 执行任务
executor = AgentExecutor(agent=agent, llm=OpenAIProvider())
result = executor.run(task)
```

## 支持

如果您在使用过程中遇到问题，请查看文档或提交Issue。
"""
    
    def serve_docs(self, docs_path: str = "docs", port: int = 8000):
        """启动文档服务器"""
        docs_dir = Path(docs_path)
        if not docs_dir.exists():
            raise ValueError(f"文档目录不存在: {docs_path}")
        
        console.print(f"[bold blue]启动文档服务器:[/bold blue] http://localhost:{port}")
        
        # 启动HTTP服务器
        def start_server():
            os.chdir(docs_dir)
            with socketserver.TCPServer(("", port), http.server.SimpleHTTPRequestHandler) as httpd:
                console.print(f"[green]文档服务器已启动:[/green] http://localhost:{port}")
                try:
                    httpd.serve_forever()
                except KeyboardInterrupt:
                    console.print("\n[yellow]文档服务器已停止[/yellow]")
        
        # 在新线程中启动服务器
        server_thread = threading.Thread(target=start_server)
        server_thread.daemon = True
        server_thread.start()
        
        # 打开浏览器
        webbrowser.open(f"http://localhost:{port}")
        
        try:
            # 保持主线程运行
            while True:
                import time
                time.sleep(1)
        except KeyboardInterrupt:
            console.print("\n[yellow]文档服务器已停止[/yellow]")