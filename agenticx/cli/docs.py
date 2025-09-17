#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 文档生成器
支持自动生成API文档和用户文档
"""

import os
import shutil
import sys
from pathlib import Path
import http.server
import socketserver
import threading
import webbrowser
import yaml
import typer
import warnings

# 过滤掉 litellm 的 DeprecationWarning
warnings.filterwarnings("ignore", category=DeprecationWarning, module="litellm")

from rich.console import Console

console = Console()


class DocGenerator:
    """文档生成器"""

    def __init__(self, output_dir: str = None):
        """初始化文档生成器
        
        Args:
            output_dir: 可选的输出目录路径，如果不指定则根据当前工作目录决定生成位置
        """
        self._check_dependencies()
        self.root_dir = self._find_project_root()
        current_dir = Path.cwd().resolve()
        
        if output_dir:
            # 如果指定了输出目录，使用指定的目录作为site输出
            self.output_dir = Path(output_dir).resolve()
            # 在指定目录的同级创建临时 docs 目录用于存放源文档
            self.docs_dir = self.output_dir.parent / f"{self.output_dir.name}_docs_temp"
            self._custom_output_dir = True
        elif current_dir != self.root_dir:
            # 如果当前目录不是项目根目录，在当前目录生成文档
            self.output_dir = current_dir / "site"
            self.docs_dir = current_dir / "docs"
            self._custom_output_dir = True
        else:
            # 默认行为：在项目根目录下生成
            self.output_dir = self.root_dir / "site"
            self.docs_dir = self.root_dir / "docs"
            self._custom_output_dir = False
            
        self.source_dir = self.root_dir / "agenticx" # Python 源码

    def _check_dependencies(self):
        """检查文档生成所需的依赖是否已安装。"""
        try:
            # 检查 pydoc-markdown
            from pydoc_markdown import PydocMarkdown
            # 检查 mkdocs
            import mkdocs.commands.build
            import mkdocs.config
        except ImportError as e:
            console.print("[bold red]错误：缺少文档生成依赖。[/bold red]")
            console.print("请将 `pydoc-markdown`, `mkdocs`, `mkdocs-material` 添加到您的项目依赖中。")
            console.print("例如，在 `pyproject.toml` 的 `dependencies` 部分添加它们，然后重新安装。")
            console.print(f"具体错误: {e}")
            raise typer.Exit(1)

    def _find_project_root(self, current_path: Path = None) -> Path:
        """向上查找项目根目录（包含 pyproject.toml 的目录）。"""
        if current_path is None:
            current_path = Path.cwd().resolve()
        
        if (current_path / "pyproject.toml").exists():
            return current_path
        
        if current_path.parent == current_path:
            console.print("[bold red]错误:[/bold red] 无法找到项目根目录 (pyproject.toml)。")
            console.print("请确保您在 AgenticX 项目目录或其子目录中运行此命令。")
            raise typer.Exit(1)
            
        return self._find_project_root(current_path.parent)



    def generate_docs(self):
        """生成文档"""
        console.print("[bold blue]📚 生成文档[/bold blue]")

        # 确保文档目录存在
        self.docs_dir.mkdir(parents=True, exist_ok=True)

        # 用于存放生成的 API 文档的目录
        api_docs_dir = self.docs_dir / "api"

        # 1. 使用 pydoc-markdown 从源代码生成 markdown
        self._generate_markdown(api_docs_dir)

        # 2. 如果需要，在 `docs` 中创建默认的 index.md
        self._create_index_md_if_needed()

        # 3. 在项目根目录创建 mkdocs.yml（在所有文档生成完毕后）
        self._create_mkdocs_config()

        # 4. 使用 mkdocs 构建文档
        self._build_docs()

        console.print(f"[green]✅ 文档已生成到:[/green] [cyan]{self.output_dir}[/cyan]")
        return str(self.output_dir)

    def _generate_markdown(self, api_docs_dir: Path):
        """使用 pydoc-markdown 生成 API 文档的 markdown 文件"""
        package_name = "agenticx"
        
        # 确保 API 文档目录存在
        api_docs_dir.mkdir(parents=True, exist_ok=True)

        # 使用 pydoc-markdown 的 Python API
        try:
            from pydoc_markdown import PydocMarkdown
            from pydoc_markdown.contrib.loaders.python import PythonLoader
            from pydoc_markdown.contrib.processors.filter import FilterProcessor
            from pydoc_markdown.contrib.processors.smart import SmartProcessor
            from pydoc_markdown.contrib.processors.crossref import CrossrefProcessor
            from pydoc_markdown.contrib.renderers.markdown import MarkdownRenderer
            
            # 静默生成 API 文档

            # 创建 PydocMarkdown 实例
            pydoc_markdown = PydocMarkdown()
            
            # 配置 loaders
            python_loader = PythonLoader()
            python_loader.search_path = [str(self.root_dir)]
            python_loader.modules = [package_name]
            pydoc_markdown.loaders = [python_loader]
            
            # 配置 processors
            pydoc_markdown.processors = [
                FilterProcessor(),
                SmartProcessor(),
                CrossrefProcessor()
            ]
            
            # 配置 renderer
            markdown_renderer = MarkdownRenderer()
            markdown_renderer.filename = str(api_docs_dir / "api.md")
            pydoc_markdown.renderer = markdown_renderer
            
            # 执行文档生成
            modules = pydoc_markdown.load_modules()
            pydoc_markdown.process(modules)
            pydoc_markdown.render(modules)
            
        except Exception as e:
            console.print("[bold red]Markdown 文档生成失败。[/bold red]")
            console.print(f"错误: {e}")
            import traceback
            console.print(traceback.format_exc())
            raise typer.Exit(1)

        # API 文档生成完成

    def _create_mkdocs_config(self):
        """创建 mkdocs.yml。"""
        # 静默创建配置文件

        # 扫描用户文档并添加到导航栏
        nav = []
        
        # 只有在docs目录存在时才扫描用户文档
        if self.docs_dir.exists():
            # 只有在index.md存在时才添加主页
            index_file = self.docs_dir / "index.md"
            if index_file.exists():
                nav.append({'主页': 'index.md'})
            # 添加存在的用户文档
            user_docs = []
            for path in sorted(self.docs_dir.glob("*.md")):
                if path.name not in ["index.md", "README.md"]:
                    # 只添加实际存在的文件
                    if path.exists():
                        user_docs.append({path.stem.replace('_', ' ').title(): path.name})
            
            if user_docs:
                nav.extend(user_docs)

            # 添加生成的 API 文档到导航栏
            api_dir = self.docs_dir / "api"
            if api_dir.exists():
                # 查找实际存在的 API 文档文件
                api_files = sorted(api_dir.glob("**/*.md"))
                if api_files:
                    # 使用第一个找到的 API 文件
                    first_api_file = api_files[0].relative_to(self.docs_dir)
                    nav.append({"API 参考": str(first_api_file)})

        # 根据是否使用自定义输出目录来设置路径
        if self._custom_output_dir:
            # 使用相对路径，相对于 mkdocs.yml 文件的位置
            site_dir = self.output_dir.name
            docs_dir = self.docs_dir.name
        else:
            # 默认情况下使用相对路径
            site_dir = str(self.output_dir.relative_to(self.root_dir))
            docs_dir = str(self.docs_dir.relative_to(self.root_dir))
            
        mkdocs_config = {
            "site_name": "AgenticX",
            "site_dir": site_dir,
            "docs_dir": docs_dir,
            "theme": {
                "name": "material",
                "features": [
                    "navigation.tabs",
                    "navigation.sections",
                    "navigation.expand",
                    "search.highlight"
                ]
            },
            "nav": nav,
            "plugins": [
                "search"
            ],
            "markdown_extensions": [
                "codehilite",
                "admonition",
                "toc"
            ]
        }

        # 如果指定了输出目录，将 mkdocs.yml 放在输出目录的父目录
        if hasattr(self, '_custom_output_dir') and self._custom_output_dir:
            config_path = self.output_dir.parent / "mkdocs.yml"
        else:
            config_path = self.root_dir / "mkdocs.yml"
            
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(mkdocs_config, f, allow_unicode=True, default_flow_style=False)

    def _create_index_md_if_needed(self):
        """如果主 index.md 文件不存在，则创建它。"""
        index_path = self.docs_dir / "index.md"
        if not index_path.exists():
            # 检查实际存在的 API 文档
            api_link = ""
            api_dir = self.docs_dir / "api"
            if api_dir.exists():
                api_files = sorted(api_dir.glob("**/*.md"))
                if api_files:
                    first_api_file = api_files[0].relative_to(self.docs_dir)
                    api_link = f"- 要浏览API，请访问 [API 参考]({first_api_file})。\n"
            
            # 检查是否存在快速开始文档
            quickstart_link = ""
            if (self.docs_dir / "quickstart.md").exists():
                quickstart_link = "- 要开始使用，请查看 [快速开始](quickstart.md)。\n"
            
            index_content = f"""# 欢迎来到 AgenticX 文档

AgenticX 是一个统一、可扩展、生产就绪的多智能体应用开发框架。

{quickstart_link}{api_link}"""
            
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(index_content)

    def _build_docs(self):
        """使用 mkdocs 构建文档。"""
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)

        # 使用与 _create_mkdocs_config 相同的逻辑确定配置文件路径
        if self._custom_output_dir:
            config_path = self.output_dir.parent / "mkdocs.yml"
            work_dir = self.output_dir.parent
        else:
            config_path = self.root_dir / "mkdocs.yml"
            work_dir = self.root_dir
            
        try:
            import mkdocs.commands.build
            import mkdocs.config
            
            # 切换工作目录以确保 mkdocs 能正确找到所有路径
            original_cwd = os.getcwd()
            os.chdir(work_dir)
            
            config = mkdocs.config.load_config(config_file=str(config_path))
            mkdocs.commands.build.build(config)

        except Exception as e:
            console.print("[bold red]MkDocs 构建失败。[/bold red]")
            console.print(f"错误: {e}")
            import traceback
            console.print(traceback.format_exc())
            raise typer.Exit(1)
        finally:
            # 恢复原始工作目录
            if 'original_cwd' in locals():
                os.chdir(original_cwd)
            # 清理 mkdocs.yml
            if config_path.exists():
                config_path.unlink()
            # 清理临时docs目录
            if self._custom_output_dir and self.docs_dir.exists():
                shutil.rmtree(self.docs_dir)

        # 文档构建完成


    def serve_docs(self, port: int = 8000):
        """启动文档服务器"""
        # 检查当前目录是否包含生成的文档文件
        current_dir = Path.cwd()
        if (current_dir / "index.html").exists() and (current_dir / "assets").exists():
            # 当前目录就是生成的文档目录
            docs_dir = current_dir
        else:
            # 使用默认的输出目录
            docs_dir = self.output_dir
            if not docs_dir.exists():
                console.print(f"[bold red]错误:[/bold red] 文档目录 '{docs_dir.name}' 不存在。")
                console.print("请先运行 [bold cyan]agenticx docs generate[/bold cyan] 来生成文档。")
                raise typer.Exit(1)

        console.print(f"[bold blue]启动文档服务器于:[/bold blue] http://localhost:{port}")
        console.print(f"服务目录: {docs_dir.resolve()}")

        # 使用 mkdocs serve，因为它提供更好的体验（如热重载）
        # 但为了简单起见，我们继续使用 SimpleHTTPServer
        # 如果要用 mkdocs serve, 需要在另一个进程中运行
        
        def start_server():
            # chdir 到 site 目录
            os.chdir(str(docs_dir.resolve()))
            with socketserver.TCPServer(("", port), http.server.SimpleHTTPRequestHandler) as httpd:
                console.print("[green]文档服务器已启动。按 Ctrl+C 停止。[/green]")
                try:
                    httpd.serve_forever()
                except KeyboardInterrupt:
                    pass
                finally:
                    httpd.server_close()


        server_thread = threading.Thread(target=start_server)
        server_thread.daemon = True
        server_thread.start()

        try:
            webbrowser.open(f"http://localhost:{port}")
        except webbrowser.Error:
            console.print(f"[yellow]无法自动打开浏览器。请手动访问 http://localhost:{port}[/yellow]")


        try:
            # 等待线程结束（例如通过 KeyboardInterrupt）
            server_thread.join()
        except KeyboardInterrupt:
            console.print("\n[yellow]正在停止文档服务器...[/yellow]")