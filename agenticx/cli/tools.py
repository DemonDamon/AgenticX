"""
AgenticX CLI 工具命令模块

提供各种工具命令，包括 MinerU 文档解析等功能。
"""

import os
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any
import typer
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.text import Text

# 创建 tools 子应用
tools_app = typer.Typer(
    name="tools",
    help="工具命令集合",
    no_args_is_help=True,
    rich_markup_mode="rich"
)

console = Console()


def _get_mineru_adapter():
    """延迟导入 MinerU 适配器"""
    try:
        from agenticx.tools.adapters.mineru import MinerUAdapter
        return MinerUAdapter
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 无法导入 MinerU 适配器: {e}")
        console.print("[yellow]提示:[/yellow] 请确保已安装 MinerU 相关依赖")
        raise typer.Exit(1)


def _get_artifact_registry():
    """延迟导入工件注册器"""
    try:
        from agenticx.storage.mineru import ArtifactRegistry
        return ArtifactRegistry
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 无法导入工件注册器: {e}")
        raise typer.Exit(1)


def _get_validator():
    """延迟导入验证器"""
    try:
        from agenticx.storage.mineru import StructuredOutputValidator
        return StructuredOutputValidator
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 无法导入验证器: {e}")
        raise typer.Exit(1)


def _get_renderer():
    """延迟导入渲染器"""
    try:
        from agenticx.storage.mineru import MarkdownRenderer
        return MarkdownRenderer
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 无法导入渲染器: {e}")
        raise typer.Exit(1)


def _get_health_check():
    """延迟导入健康检查"""
    try:
        from agenticx.observability.mineru import get_health_check
        return get_health_check
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 无法导入健康检查: {e}")
        raise typer.Exit(1)


@tools_app.command("mineru-parse")
def mineru_parse(
    input_path: str = typer.Argument(..., help="输入文档路径 (PDF/图片文件或目录)"),
    output_dir: Optional[str] = typer.Option(None, "--output", "-o", help="输出目录 (默认: ./output)"),
    backend: str = typer.Option("pipeline", "--backend", "-b", help="解析后端 (pipeline/vlm-http)"),
    pages: Optional[str] = typer.Option(None, "--pages", "-p", help="页码范围 (如: 1-5,8,10-12)"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="配置文件路径"),
    validate: bool = typer.Option(True, "--validate/--no-validate", help="是否验证输出"),
    render: bool = typer.Option(True, "--render/--no-render", help="是否渲染 Markdown"),
    render_format: str = typer.Option("enhanced", "--render-format", "-f", help="渲染格式 (standard/enhanced/structured/minimal)"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出"),
    debug: bool = typer.Option(False, "--debug", "-d", help="调试模式"),
    health_check: bool = typer.Option(True, "--health-check/--no-health-check", help="是否执行健康检查")
):
    """
    使用 MinerU 解析文档
    
    支持解析 PDF 文件和图片文件，输出结构化的 Markdown 和 JSON 数据。
    
    示例:
        agx tools mineru-parse document.pdf
        agx tools mineru-parse document.pdf -o ./results --pages 1-5
        agx tools mineru-parse images/ --backend vlm-http
    """
    
    # 验证输入路径
    input_path_obj = Path(input_path)
    if not input_path_obj.exists():
        console.print(f"[bold red]错误:[/bold red] 输入路径不存在: {input_path}")
        raise typer.Exit(1)
    
    # 设置输出目录
    if output_dir is None:
        output_dir = "./output"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    console.print(f"[bold blue]MinerU 文档解析[/bold blue]")
    console.print(f"输入: {input_path}")
    console.print(f"输出: {output_dir}")
    console.print(f"后端: {backend}")
    if pages:
        console.print(f"页码: {pages}")
    
    # 健康检查
    if health_check:
        console.print("\n[bold yellow]执行健康检查...[/bold yellow]")
        try:
            get_health_check = _get_health_check()
            health_checker = get_health_check()
            
            # 注册默认检查器
            health_checker.register_default_checkers()
            
            # 执行异步健康检查
            import asyncio
            health_report = asyncio.run(health_checker.check_all())
            
            if health_report.overall_status.value != "healthy":
                console.print(f"[bold yellow]警告:[/bold yellow] 系统健康状态: {health_report.overall_status.value}")
                if verbose:
                    for component_name, component_health in health_report.components.items():
                        status_color = "green" if component_health.status.value == "healthy" else "yellow"
                        console.print(f"  - {component_name}: [{status_color}]{component_health.status.value}[/{status_color}]")
            else:
                console.print("[bold green]✓ 系统健康检查通过[/bold green]")
        except Exception as e:
            console.print(f"[bold yellow]警告:[/bold yellow] 健康检查失败: {e}")
    
    # 开始解析
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
        transient=True
    ) as progress:
        
        # 初始化适配器
        task = progress.add_task("初始化 MinerU 适配器...", total=None)
        try:
            MinerUAdapter = _get_mineru_adapter()
            adapter = MinerUAdapter(
                backend_type=backend,
                config_path=config
            )
            progress.update(task, description="✓ 适配器初始化完成")
        except Exception as e:
            progress.stop()
            console.print(f"[bold red]错误:[/bold red] 适配器初始化失败: {e}")
            raise typer.Exit(1)
        
        # 解析文档
        progress.update(task, description="解析文档中...")
        try:
            parse_result = adapter.parse_document(
                input_path=str(input_path_obj),
                output_dir=str(output_path),
                pages=pages
            )
            progress.update(task, description="✓ 文档解析完成")
        except Exception as e:
            progress.stop()
            console.print(f"[bold red]错误:[/bold red] 文档解析失败: {e}")
            if debug:
                import traceback
                console.print(traceback.format_exc())
            raise typer.Exit(1)
        
        # 注册工件
        progress.update(task, description="注册解析工件...")
        try:
            ArtifactRegistry = _get_artifact_registry()
            registry = ArtifactRegistry(base_output_dir=output_path)
            # 这里需要从 parse_result 创建 ParsedArtifacts 对象
            # 暂时跳过工件注册，因为需要更多的集成工作
            artifacts = None
            progress.update(task, description="✓ 工件注册跳过")
        except Exception as e:
            progress.stop()
            console.print(f"[bold yellow]警告:[/bold yellow] 工件注册失败: {e}")
            artifacts = None
        
        # 验证输出
        if validate and artifacts:
            progress.update(task, description="验证解析结果...")
            try:
                StructuredOutputValidator = _get_validator()
                validator = StructuredOutputValidator()
                validation_report = validator.validate_artifacts(artifacts)
                progress.update(task, description="✓ 验证完成")
                
                if validation_report.status.value != "valid":
                    console.print(f"[bold yellow]警告:[/bold yellow] 验证发现问题: {len(validation_report.issues)} 个")
                    if verbose:
                        for issue in validation_report.issues[:5]:  # 只显示前5个问题
                            console.print(f"  - {issue.level.value}: {issue.message}")
                        if len(validation_report.issues) > 5:
                            console.print(f"  ... 还有 {len(validation_report.issues) - 5} 个问题")
            except Exception as e:
                progress.stop()
                console.print(f"[bold yellow]警告:[/bold yellow] 验证失败: {e}")
        
        # 渲染 Markdown
        if render and artifacts:
            progress.update(task, description="渲染 Markdown...")
            try:
                MarkdownRenderer = _get_renderer()
                renderer = MarkdownRenderer()
                
                # 渲染到输出目录
                rendered_path = output_path / f"rendered_{render_format}.md"
                rendered_content = renderer.render(artifacts, format_type=render_format)
                
                with open(rendered_path, 'w', encoding='utf-8') as f:
                    f.write(rendered_content)
                
                progress.update(task, description="✓ Markdown 渲染完成")
            except Exception as e:
                progress.stop()
                console.print(f"[bold yellow]警告:[/bold yellow] Markdown 渲染失败: {e}")
    
    # 显示结果摘要
    console.print(f"\n[bold green]✓ 解析完成![/bold green]")
    console.print(f"输出目录: {output_path.absolute()}")
    
    # 列出输出文件
    if output_path.exists():
        output_files = list(output_path.rglob("*"))
        if output_files:
            console.print(f"\n[bold blue]输出文件 ({len(output_files)} 个):[/bold blue]")
            
            # 创建文件表格
            file_table = Table(show_header=True, header_style="bold magenta")
            file_table.add_column("文件", style="cyan")
            file_table.add_column("大小", style="white")
            file_table.add_column("类型", style="yellow")
            
            for file_path in sorted(output_files):
                if file_path.is_file():
                    file_size = file_path.stat().st_size
                    if file_size < 1024:
                        size_str = f"{file_size} B"
                    elif file_size < 1024 * 1024:
                        size_str = f"{file_size / 1024:.1f} KB"
                    else:
                        size_str = f"{file_size / (1024 * 1024):.1f} MB"
                    
                    file_type = file_path.suffix.upper() or "FILE"
                    relative_path = file_path.relative_to(output_path)
                    
                    file_table.add_row(str(relative_path), size_str, file_type)
            
            console.print(file_table)
    
    if verbose and parse_result:
        console.print(f"\n[bold blue]解析统计:[/bold blue]")
        console.print(f"处理时间: {getattr(parse_result, 'processing_time', '未知')}")
        console.print(f"页面数量: {getattr(parse_result, 'page_count', '未知')}")
        console.print(f"内容块数: {getattr(parse_result, 'content_blocks', '未知')}")


@tools_app.command("mineru-batch")
def mineru_batch(
    input_dir: str = typer.Argument(..., help="输入目录路径"),
    output_dir: Optional[str] = typer.Option(None, "--output", "-o", help="输出目录 (默认: ./batch_output)"),
    patterns: Optional[List[str]] = typer.Option(["*.pdf", "*.png", "*.jpg", "*.jpeg"], "--pattern", "-p", help="文件匹配模式"),
    max_concurrent: int = typer.Option(3, "--concurrent", "-c", help="最大并发处理数 (1-10)"),
    backend: str = typer.Option("pipeline", "--backend", "-b", help="解析后端 (pipeline/vlm-http)"),
    language: str = typer.Option("auto", "--language", "-l", help="OCR语言 (auto/zh/en/ja等)"),
    enable_formula: bool = typer.Option(True, "--formula/--no-formula", help="是否启用公式识别"),
    enable_table: bool = typer.Option(True, "--table/--no-table", help="是否启用表格识别"),
    pages: Optional[str] = typer.Option(None, "--pages", help="页码范围 (如: 1-5,8,10-12)"),
    mode: str = typer.Option("local", "--mode", "-m", help="处理模式 (local/remote)"),
    api_base: Optional[str] = typer.Option(None, "--api-base", help="远程API基础URL"),
    api_token: Optional[str] = typer.Option(None, "--api-token", help="API认证令牌"),
    callback_url: Optional[str] = typer.Option(None, "--callback-url", help="批量处理完成后的回调URL"),
    config: Optional[str] = typer.Option(None, "--config", help="配置文件路径"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出"),
    debug: bool = typer.Option(False, "--debug", "-d", help="调试模式"),
    dry_run: bool = typer.Option(False, "--dry-run", help="仅显示将要处理的文件，不执行实际处理")
):
    """
    批量处理目录中的文档文件
    
    支持批量解析目录中的 PDF 文件和图片文件，提供进度跟踪和并发控制。
    
    示例:
        agx tools mineru-batch ./documents/
        agx tools mineru-batch ./docs/ -o ./results --concurrent 5
        agx tools mineru-batch ./pdfs/ --pattern "*.pdf" --mode remote --api-base https://api.mineru.com
    """
    import asyncio
    from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn, TimeRemainingColumn
    from rich.live import Live
    from rich.layout import Layout
    from rich.panel import Panel
    
    # 验证输入目录
    input_path = Path(input_dir)
    if not input_path.exists():
        console.print(f"[bold red]错误:[/bold red] 输入目录不存在: {input_dir}")
        raise typer.Exit(1)
    
    if not input_path.is_dir():
        console.print(f"[bold red]错误:[/bold red] 输入路径不是目录: {input_dir}")
        raise typer.Exit(1)
    
    # 设置输出目录
    if output_dir is None:
        output_dir = "./batch_output"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # 验证参数
    if max_concurrent < 1 or max_concurrent > 10:
        console.print(f"[bold red]错误:[/bold red] 并发数必须在 1-10 之间，当前值: {max_concurrent}")
        raise typer.Exit(1)
    
    if mode not in ["local", "remote"]:
        console.print(f"[bold red]错误:[/bold red] 模式必须是 'local' 或 'remote'，当前值: {mode}")
        raise typer.Exit(1)
    
    if mode == "remote" and (not api_base or not api_token):
        console.print(f"[bold red]错误:[/bold red] 远程模式需要提供 --api-base 和 --api-token")
        raise typer.Exit(1)
    
    # 收集文件
    console.print(f"[bold blue]MinerU 批量文档解析[/bold blue]")
    console.print(f"输入目录: {input_dir}")
    console.print(f"输出目录: {output_dir}")
    console.print(f"处理模式: {mode}")
    console.print(f"最大并发: {max_concurrent}")
    console.print(f"文件模式: {', '.join(patterns)}")
    
    files_to_process = []
    for pattern in patterns:
        files_to_process.extend(input_path.glob(pattern))
    
    # 递归搜索子目录
    for pattern in patterns:
        files_to_process.extend(input_path.rglob(pattern))
    
    # 去重并排序
    files_to_process = sorted(list(set(files_to_process)))
    
    if not files_to_process:
        console.print(f"[bold yellow]警告:[/bold yellow] 在目录 {input_dir} 中未找到匹配的文件")
        console.print(f"搜索模式: {patterns}")
        raise typer.Exit(0)
    
    console.print(f"\n[bold green]找到 {len(files_to_process)} 个文件待处理[/bold green]")
    
    # 显示文件列表
    if verbose or dry_run:
        file_table = Table(show_header=True, header_style="bold magenta")
        file_table.add_column("序号", style="cyan", width=6)
        file_table.add_column("文件路径", style="white")
        file_table.add_column("大小", style="yellow", width=10)
        
        for i, file_path in enumerate(files_to_process, 1):
            file_size = file_path.stat().st_size
            if file_size < 1024:
                size_str = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_str = f"{file_size / 1024:.1f} KB"
            else:
                size_str = f"{file_size / (1024 * 1024):.1f} MB"
            
            relative_path = file_path.relative_to(input_path)
            file_table.add_row(str(i), str(relative_path), size_str)
        
        console.print(file_table)
    
    if dry_run:
        console.print(f"\n[bold yellow]干运行模式 - 未执行实际处理[/bold yellow]")
        return
    
    # 确认处理
    if not typer.confirm(f"\n确认处理这 {len(files_to_process)} 个文件吗？"):
        console.print("[yellow]操作已取消[/yellow]")
        raise typer.Exit(0)
    
    # 执行批量处理
    async def run_batch_processing():
        try:
            if mode == "local":
                return await _run_local_batch_processing(
                    files_to_process, output_path, max_concurrent,
                    backend, language, enable_formula, enable_table, pages, config, verbose, debug
                )
            else:
                return await _run_remote_batch_processing(
                    files_to_process, output_path, max_concurrent,
                    api_base, api_token, language, enable_formula, enable_table, 
                    pages, callback_url, verbose, debug
                )
        except Exception as e:
            console.print(f"[bold red]批量处理失败:[/bold red] {e}")
            if debug:
                import traceback
                console.print(traceback.format_exc())
            raise typer.Exit(1)
    
    # 运行异步处理
    try:
        result = asyncio.run(run_batch_processing())
        
        # 显示处理结果摘要
        console.print(f"\n[bold green]✓ 批量处理完成![/bold green]")
        console.print(f"总文件数: {len(files_to_process)}")
        console.print(f"成功处理: {result.get('success_count', 0)}")
        console.print(f"失败文件: {result.get('failure_count', 0)}")
        console.print(f"输出目录: {output_path.absolute()}")
        
        if result.get('failed_files'):
            console.print(f"\n[bold red]失败文件列表:[/bold red]")
            for failed_file in result['failed_files']:
                console.print(f"  - {failed_file['file']}: {failed_file['error']}")
        
    except KeyboardInterrupt:
        console.print(f"\n[bold yellow]处理被用户中断[/bold yellow]")
        raise typer.Exit(1)


async def _run_local_batch_processing(
    files: List[Path], output_dir: Path, max_concurrent: int,
    backend: str, language: str, enable_formula: bool, enable_table: bool,
    pages: Optional[str], config: Optional[str], verbose: bool, debug: bool
) -> Dict[str, Any]:
    """执行本地批量处理"""
    from agenticx.tools.mineru import ParseDocumentsTool, MinerUParseArgs, ParseMode
    
    # 创建解析工具
    parse_tool = ParseDocumentsTool(config={
        "output_dir": str(output_dir),
        "max_retries": 3,
        "debug": debug
    })
    
    # 准备参数
    args = MinerUParseArgs(
        file_sources=[str(f) for f in files],
        language=language,
        enable_formula=enable_formula,
        enable_table=enable_table,
        page_ranges=pages,
        mode=ParseMode.LOCAL,
        backend=backend
    )
    
    # 创建进度显示
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TextColumn("({task.completed}/{task.total})"),
        TimeElapsedColumn(),
        TimeRemainingColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("处理文件中...", total=len(files))
        
        # 执行解析
        result = await parse_tool.parse(args)
        
        progress.update(task, completed=len(files))
        
        return {
            "success_count": result.get("successful_files", 0),
            "failure_count": result.get("failed_files", 0),
            "failed_files": result.get("errors", []),
            "results": result.get("results", [])
        }


async def _run_remote_batch_processing(
    files: List[Path], output_dir: Path, max_concurrent: int,
    api_base: str, api_token: str, language: str, enable_formula: bool, enable_table: bool,
    pages: Optional[str], callback_url: Optional[str], verbose: bool, debug: bool
) -> Dict[str, Any]:
    """执行远程批量处理"""
    from agenticx.tools.remote import MinerUBatchProcessor, MinerUConfig
    
    # 创建配置
    config = MinerUConfig(
        api_key=api_token,
        base_url=api_base,
        timeout=300.0,
        max_retries=3
    )
    
    # 创建批量处理器
    processor = MinerUBatchProcessor(config)
    
    # 进度回调函数
    progress_data = {"current_stage": "", "progress": 0, "message": ""}
    
    def progress_callback(stage: str, progress_pct: float, message: str):
        progress_data.update({
            "current_stage": stage,
            "progress": progress_pct,
            "message": message
        })
        console.print(f"[{stage}] {progress_pct:.1f}% - {message}")
    
    # 创建进度显示
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("远程批量处理中...", total=100)
        
        # 执行远程批量处理
        result = await processor.process_files_with_progress(
            file_paths=[str(f) for f in files],
            output_dir=str(output_dir),
            progress_callback=progress_callback,
            language=language,
            enable_formula=enable_formula,
            enable_table=enable_table,
            page_ranges=pages,
            callback_url=callback_url
        )
        
        progress.update(task, completed=100)
        
        return {
            "success_count": len(files) if result.get("success") else 0,
            "failure_count": 0 if result.get("success") else len(files),
            "failed_files": [] if result.get("success") else [{"file": str(f), "error": "Remote processing failed"} for f in files],
            "task_id": result.get("task_id"),
            "result_path": result.get("result_path")
        }


@tools_app.command("list")
def list_tools():
    """列出所有可用的工具命令"""
    console.print("[bold blue]可用工具命令:[/bold blue]")
    
    tools_table = Table(show_header=True, header_style="bold magenta")
    tools_table.add_column("命令", style="cyan")
    tools_table.add_column("描述", style="white")
    
    tools_table.add_row("mineru-parse", "使用 MinerU 解析单个文档 (PDF/图片)")
    tools_table.add_row("mineru-batch", "批量处理目录中的文档文件")
    tools_table.add_row("list", "列出所有可用的工具命令")
    
    console.print(tools_table)
    
    console.print(f"\n[bold yellow]使用方法:[/bold yellow]")
    console.print("  agx tools <命令> --help  # 查看具体命令的帮助信息")
    console.print("  agx tools mineru-parse document.pdf  # 解析单个 PDF 文档")
    console.print("  agx tools mineru-batch ./documents/  # 批量处理目录中的文档")


@tools_app.callback(invoke_without_command=True)
def tools_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """工具命令集合回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()