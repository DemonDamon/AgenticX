#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX CLI 主程序
基于 Typer 的命令行工具套件
"""

import typer
from typing import Optional, List
import sys
import os
import asyncio
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.panel import Panel

from agenticx import __version__

# 延迟导入函数
def _get_client():
    """延迟导入客户端"""
    try:
        from agenticx.cli.client import AgenticXClient
        return AgenticXClient
    except ImportError:
        console.print("[bold red]错误:[/bold red] 无法导入 AgenticXClient")
        raise typer.Exit(1)

def _get_scaffolder():
    from .scaffold import ProjectScaffolder
    return ProjectScaffolder

def _get_debug_server():
    from .debug import DebugServer
    return DebugServer

def _get_doc_generator():
    from .docs import DocGenerator
    return DocGenerator

def _get_deploy_manager():
    from .deploy import DeployManager
    return DeployManager

# 创建主应用
app = typer.Typer(
    name="agenticx",
    help="AgenticX: 统一的多智能体框架 - 开发者工具套件",
    add_completion=False
)

# 添加版本回调函数
def version_callback(value: bool):
    if value:
        typer.echo(f"AgenticX {__version__}")
        raise typer.Exit()

# 添加全局 --version 选项
# 添加帮助回调函数
def help_callback(value: bool):
    """帮助回调函数"""
    if value:
        import click
        ctx = click.get_current_context()
        click.echo(ctx.get_help())
        raise typer.Exit()


def run_help_callback(value: bool):
    """run 命令帮助回调函数"""
    if value:
        from rich.panel import Panel
        from rich.table import Table
        
        # 创建选项表格
        options_table = Table(show_header=False, box=None, padding=(0, 1))
        options_table.add_column("Option", style="cyan")
        options_table.add_column("Description")
        options_table.add_row("--config    -c  TEXT", "配置文件路径")
        options_table.add_row("--verbose   -v", "详细输出")
        options_table.add_row("--debug     -d", "调试模式")
        options_table.add_row("--help      -h", "显示帮助信息")
        
        console.print("\n[bold yellow]Usage:[/bold yellow] agx run [OPTIONS] FILE\n")
        console.print("执行工作流文件\n")
        console.print(Panel(options_table, title="Options", title_align="left"))
        raise typer.Exit()


def validate_help_callback(value: bool):
    """validate 命令帮助回调函数"""
    if value:
        from rich.panel import Panel
        from rich.table import Table
        
        # 创建选项表格
        options_table = Table(show_header=False, box=None, padding=(0, 1))
        options_table.add_column("Option", style="cyan")
        options_table.add_column("Description")
        options_table.add_row("--schema    -s  TEXT", "验证模式")
        options_table.add_row("--help      -h", "显示帮助信息")
        
        console.print("\n[bold yellow]Usage:[/bold yellow] agx validate [OPTIONS] CONFIG\n")
        console.print("验证配置文件\n")
        console.print(Panel(options_table, title="Options", title_align="left"))
        raise typer.Exit()


def test_help_callback(value: bool):
    """test 命令帮助回调函数"""
    if value:
        from rich.panel import Panel
        from rich.table import Table
        
        # 创建选项表格
        options_table = Table(show_header=False, box=None, padding=(0, 1))
        options_table.add_column("Option", style="cyan")
        options_table.add_column("Description")
        options_table.add_row("--pattern   -p  TEXT", "测试文件匹配模式")
        options_table.add_row("--verbose   -v", "详细输出")
        options_table.add_row("--help      -h", "显示帮助信息")
        
        console.print("\n[bold yellow]Usage:[/bold yellow] agx test [OPTIONS] [SUITE]\n")
        console.print("运行测试套件\n")
        console.print(Panel(options_table, title="Options", title_align="left"))
        raise typer.Exit()

@app.callback()
def main_callback(
    version: Optional[bool] = typer.Option(
        None, "--version", "-v", 
        callback=version_callback,
        is_eager=True,
        help="显示版本信息并退出"
    ),
    help_flag: Optional[bool] = typer.Option(
        None, "--help", "-h",
        callback=help_callback,
        is_eager=True,
        help="显示帮助信息并退出"
    )
):
    """AgenticX: 统一的多智能体框架 - 开发者工具套件"""
    pass

# 创建子命令组
project_app = typer.Typer(name="project", help="项目管理命令", no_args_is_help=True)
agent_app = typer.Typer(name="agent", help="智能体管理命令", no_args_is_help=True)
workflow_app = typer.Typer(name="workflow", help="工作流管理命令", no_args_is_help=True)
deploy_app = typer.Typer(name="deploy", help="部署相关命令", no_args_is_help=True)
monitor_app = typer.Typer(name="monitor", help="监控相关命令", no_args_is_help=True)
docs_app = typer.Typer(name="docs", help="文档生成命令", no_args_is_help=True)
mineru_app = typer.Typer(name="mineru", help="MinerU 文档解析命令", no_args_is_help=True)

# 导入 tools 子应用
def _get_tools_app():
    """延迟导入 tools 子应用"""
    try:
        from agenticx.cli.tools import tools_app
        return tools_app
    except ImportError:
        console.print("[bold red]错误:[/bold red] 无法导入 tools 模块")
        raise typer.Exit(1)

@project_app.callback(invoke_without_command=True)
def project_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """项目管理命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


@agent_app.callback(invoke_without_command=True)
def agent_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """智能体管理命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


@workflow_app.callback(invoke_without_command=True)
def workflow_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """工作流管理命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


@deploy_app.callback(invoke_without_command=True)
def deploy_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """部署相关命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


@monitor_app.callback(invoke_without_command=True)
def monitor_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """监控相关命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


@docs_app.callback(invoke_without_command=True)
def docs_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """文档命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()

# 注册子命令
app.add_typer(project_app)
app.add_typer(agent_app)
app.add_typer(workflow_app)
app.add_typer(deploy_app)
app.add_typer(monitor_app)
app.add_typer(docs_app)
app.add_typer(mineru_app)

# 注册 tools 子命令 (延迟加载)
try:
    tools_app = _get_tools_app()
    app.add_typer(tools_app)
except Exception:
    # 如果 tools 模块加载失败，不影响其他功能
    pass

console = Console()


@app.command()
def version():
    """显示版本信息"""
    console.print(f"[bold blue]AgenticX[/bold blue] {__version__}")


@app.command()
def run(
    file: str = typer.Argument(..., help="要执行的工作流文件"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="配置文件路径"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出"),
    debug: bool = typer.Option(False, "--debug", "-d", help="调试模式"),
    help_flag: bool = typer.Option(False, "--help", "-h", help="显示帮助信息", callback=lambda value: run_help_callback(value) if value else None, is_eager=True)
):
    """执行工作流文件"""
    console.print(f"[bold blue]执行工作流:[/bold blue] {file}")
    
    if not os.path.exists(file):
        console.print(f"[bold red]错误:[/bold red] 文件不存在: {file}")
        raise typer.Exit(1)
    
    # 延迟导入和创建客户端
    AgenticXClient = _get_client()
    client = AgenticXClient(config_path=config, verbose=verbose, debug=debug)
    
    try:
        # 执行工作流
        result = client.run_workflow_file(file)
        console.print(f"[bold green]执行完成![/bold green]")
        if verbose:
            console.print(f"结果: {result}")
    except Exception as e:
        console.print(f"[bold red]执行失败:[/bold red] {e}")
        raise typer.Exit(1)


@app.command()
def validate(
    config: str = typer.Argument(..., help="要验证的配置文件"),
    schema: Optional[str] = typer.Option(None, "--schema", "-s", help="验证模式"),
    help_flag: bool = typer.Option(False, "--help", "-h", help="显示帮助信息", callback=lambda value: validate_help_callback(value) if value else None, is_eager=True)
):
    """验证配置文件"""
    console.print(f"[bold blue]验证配置文件:[/bold blue] {config}")
    
    if not os.path.exists(config):
        console.print(f"[bold red]错误:[/bold red] 配置文件不存在: {config}")
        raise typer.Exit(1)
    
    AgenticXClient = _get_client()
    client = AgenticXClient()
    try:
        result = client.validate_config(config, schema)
        if result.is_valid:
            console.print(f"[bold green]✓ 配置文件验证通过![/bold green]")
        else:
            console.print(f"[bold red]✗ 配置文件验证失败:[/bold red]")
            for error in result.errors:
                console.print(f"  - {error}")
            raise typer.Exit(1)
    except Exception as e:
        console.print(f"[bold red]验证失败:[/bold red] {e}")
        raise typer.Exit(1)


@app.command()
def test(
    suite: Optional[str] = typer.Argument(None, help="测试套件名称"),
    pattern: Optional[str] = typer.Option(None, "--pattern", "-p", help="测试文件匹配模式"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出"),
    help_flag: bool = typer.Option(False, "--help", "-h", help="显示帮助信息", callback=lambda value: test_help_callback(value) if value else None, is_eager=True)
):
    """运行测试套件"""
    console.print(f"[bold blue]运行测试套件:[/bold blue] {suite or '所有测试'}")
    
    AgenticXClient = _get_client()
    client = AgenticXClient()
    try:
        result = client.run_tests(suite, pattern, verbose)
        if result.success:
            console.print(f"[bold green]✓ 测试通过![/bold green]")
            console.print(f"执行: {result.tests_run}个测试, 失败: {result.failures}个")
        else:
            console.print(f"[bold red]✗ 测试失败![/bold red]")
            for failure in result.failure_details:
                console.print(f"  - {failure}")
            raise typer.Exit(1)
    except Exception as e:
        console.print(f"[bold red]测试失败:[/bold red] {e}")
        raise typer.Exit(1)


# === 项目管理命令 ===
@project_app.command("create")
def create_project(
    name: str = typer.Argument(..., help="项目名称"),
    template: str = typer.Option("basic", "--template", "-t", help="项目模板"),
    directory: Optional[str] = typer.Option(None, "--dir", "-d", help="项目目录")
):
    """创建新项目"""
    console.print(f"[bold blue]创建项目:[/bold blue] {name}")
    
    ProjectScaffolder = _get_scaffolder()
    scaffolder = ProjectScaffolder()
    try:
        project_path = scaffolder.create_project(name, template, directory)
        console.print(f"[bold green]✓ 项目创建成功![/bold green]")
        console.print(f"项目路径: {project_path}")
    except Exception as e:
        console.print(f"[bold red]项目创建失败:[/bold red] {e}")
        raise typer.Exit(1)


@project_app.command("info")
def project_info():
    """显示项目信息"""
    console.print("[bold blue]项目信息:[/bold blue]")
    
    # 检查是否在项目目录中
    if not os.path.exists("config.yaml"):
        console.print("[yellow]当前目录不是 AgenticX 项目[/yellow]")
        return
    
    # 显示项目信息
    console.print("✓ 这是一个 AgenticX 项目")


# === 智能体管理命令 ===
@agent_app.command("create")
def create_agent(
    name: str = typer.Argument(..., help="智能体名称"),
    role: str = typer.Option("Assistant", "--role", "-r", help="智能体角色"),
    template: str = typer.Option("basic", "--template", "-t", help="智能体模板"),
    interactive: bool = typer.Option(False, "--interactive", "-i", help="交互式创建")
):
    """创建新的智能体"""
    console.print(f"[bold blue]创建智能体:[/bold blue] {name}")
    
    ProjectScaffolder = _get_scaffolder()
    scaffolder = ProjectScaffolder()
    try:
        agent_path = scaffolder.create_agent(name, role, template, interactive)
        console.print(f"[bold green]✓ 智能体创建成功![/bold green]")
        console.print(f"智能体文件: {agent_path}")
    except Exception as e:
        console.print(f"[bold red]智能体创建失败:[/bold red] {e}")
        raise typer.Exit(1)


@agent_app.command("list")
def list_agents():
    """列出当前项目的智能体"""
    console.print("[bold blue]当前项目的智能体:[/bold blue]")
    
    AgenticXClient = _get_client()
    client = AgenticXClient()
    try:
        agents = client.list_agents()
        
        if not agents:
            console.print("[yellow]当前项目没有智能体[/yellow]")
            return
            
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("智能体ID", style="cyan")
        table.add_column("名称", style="white")
        table.add_column("角色", style="yellow")
        table.add_column("状态", style="green")
        
        for agent in agents:
            table.add_row(agent.id, agent.name, agent.role, agent.status)
        
        console.print(table)
    except Exception as e:
        console.print(f"[bold red]获取智能体列表失败:[/bold red] {e}")
        raise typer.Exit(1)


# === 工作流管理命令 ===
@workflow_app.command("create")
def create_workflow(
    name: str = typer.Argument(..., help="工作流名称"),
    template: str = typer.Option("sequential", "--template", "-t", help="工作流模板"),
    agents: Optional[str] = typer.Option(None, "--agents", "-a", help="智能体列表(逗号分隔)"),
    interactive: bool = typer.Option(False, "--interactive", "-i", help="交互式创建")
):
    """创建新的工作流"""
    console.print(f"[bold blue]创建工作流:[/bold blue] {name}")
    
    ProjectScaffolder = _get_scaffolder()
    scaffolder = ProjectScaffolder()
    try:
        workflow_path = scaffolder.create_workflow(name, template, interactive)
        console.print(f"[bold green]✓ 工作流创建成功![/bold green]")
        console.print(f"工作流文件: {workflow_path}")
    except Exception as e:
        console.print(f"[bold red]工作流创建失败:[/bold red] {e}")
        raise typer.Exit(1)


@workflow_app.command("list")
def list_workflows():
    """列出当前项目的工作流"""
    console.print("[bold blue]当前项目的工作流:[/bold blue]")
    
    AgenticXClient = _get_client()
    client = AgenticXClient()
    try:
        workflows = client.list_workflows()
        
        if not workflows:
            console.print("[yellow]当前项目没有工作流[/yellow]")
            return
            
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("工作流ID", style="cyan")
        table.add_column("名称", style="white")
        table.add_column("类型", style="yellow")
        table.add_column("状态", style="green")
        
        for workflow in workflows:
            table.add_row(workflow.id, workflow.name, str(workflow.node_count), workflow.status)
        
        console.print(table)
    except Exception as e:
        console.print(f"[bold red]获取工作流列表失败:[/bold red] {e}")
        raise typer.Exit(1)


# === 部署相关命令 ===
@deploy_app.command("prepare")
def prepare_deploy(
    target: str = typer.Argument(..., help="部署目标目录"),
    platform: str = typer.Option("docker", "--platform", "-p", help="部署平台"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="部署配置文件")
):
    """准备部署包"""
    console.print(f"[bold blue]准备部署:[/bold blue] {target}")
    
    DeployManager = _get_deploy_manager()
    deploy_manager = DeployManager()
    try:
        deploy_path = deploy_manager.prepare_deployment(target, platform, config)
        console.print(f"[bold green]✓ 部署包准备完成![/bold green]")
        console.print(f"部署目录: {deploy_path}")
    except Exception as e:
        console.print(f"[bold red]部署准备失败:[/bold red] {e}")
        raise typer.Exit(1)


@deploy_app.command("docker")
def deploy_docker(
    target: str = typer.Argument(..., help="部署目标目录"),
    tag: str = typer.Option("latest", "--tag", "-t", help="Docker 镜像标签"),
    push: bool = typer.Option(False, "--push", "-p", help="是否推送到远程仓库")
):
    """Docker 部署"""
    console.print(f"[bold blue]Docker 部署:[/bold blue] {target}")
    
    DeployManager = _get_deploy_manager()
    deploy_manager = DeployManager()
    try:
        result = deploy_manager.deploy_docker(target, tag, push)
        console.print(f"[bold green]✓ Docker 部署完成![/bold green]")
        if push:
            console.print(f"镜像已推送: {result}")
    except Exception as e:
        console.print(f"[bold red]Docker 部署失败:[/bold red] {e}")
        raise typer.Exit(1)


@deploy_app.command("k8s")
def deploy_kubernetes(
    target: str = typer.Argument(..., help="部署目标目录"),
    namespace: str = typer.Option("default", "--namespace", "-n", help="Kubernetes 命名空间"),
    apply: bool = typer.Option(False, "--apply", "-a", help="是否直接应用到集群")
):
    """Kubernetes 部署"""
    console.print(f"[bold blue]Kubernetes 部署:[/bold blue] {target}")
    
    DeployManager = _get_deploy_manager()
    deploy_manager = DeployManager()
    try:
        result = deploy_manager.deploy_kubernetes(namespace)  # 修复参数
        console.print(f"[bold green]✓ Kubernetes 部署完成![/bold green]")
        if apply:
            console.print(f"应用已部署到命名空间: {result}")
    except Exception as e:
        console.print(f"[bold red]Kubernetes 部署失败:[/bold red] {e}")
        raise typer.Exit(1)


# === 监控相关命令 ===
@monitor_app.command("start")
def start_monitor(
    port: int = typer.Option(8080, "--port", "-p", help="监控端口"),
    host: str = typer.Option("0.0.0.0", "--host", "-h", help="监控地址")
):
    """启动监控服务"""
    console.print(f"[bold blue]启动监控服务:[/bold blue] {host}:{port}")
    
    DebugServer = _get_debug_server()
    debug_server = DebugServer()
    try:
        debug_server.start_monitoring(host, port)  # 修复方法名
        console.print(f"[bold green]✓ 监控服务启动成功![/bold green]")
        console.print(f"访问地址: http://{host}:{port}")
    except Exception as e:
        console.print(f"[bold red]监控服务启动失败:[/bold red] {e}")
        raise typer.Exit(1)


@monitor_app.command("status")
def monitor_status():
    """查看监控状态"""
    console.print("[bold blue]监控状态:[/bold blue]")
    
    DebugServer = _get_debug_server()
    debug_server = DebugServer()
    try:
        # 修复方法调用
        if debug_server.is_running:
            console.print("服务状态: 运行中")
        else:
            console.print("服务状态: 已停止")
        console.print(f"运行时间: 未知")  # 简化实现
        console.print(f"请求数: 未知")    # 简化实现
    except Exception as e:
        console.print(f"[bold red]获取状态失败:[/bold red] {e}")
        raise typer.Exit(1)


# === 文档生成命令 ===
@docs_app.command("generate")
def generate_docs(
    output_dir: Optional[str] = typer.Option(
        None, "--output-dir", "-o", 
        help="指定文档生成的输出目录，如果不指定则使用项目根目录下的 site 目录"
    ),
    help_flag: bool = typer.Option(
        False, "-h", "--help",
        help="显示帮助信息"
    )
):
    """生成文档"""
    if help_flag:
        from rich.panel import Panel
        from rich.table import Table
        
        # 创建选项表格
        options_table = Table(show_header=False, box=None, padding=(0, 1))
        options_table.add_column("Option", style="cyan")
        options_table.add_column("Description")
        options_table.add_row("--output-dir  -o  TEXT", "指定文档生成的输出目录，如果不指定则使用项目根目录下的 site 目录")
        options_table.add_row("--help        -h", "显示帮助信息")
        
        console.print("\n[bold yellow]Usage:[/bold yellow] agx docs generate [OPTIONS]\n")
        console.print("生成文档\n")
        console.print(Panel(options_table, title="Options", title_align="left"))
        raise typer.Exit()
    
    DocGenerator = _get_doc_generator()
    doc_generator = DocGenerator(output_dir=output_dir)
    try:
        doc_path = doc_generator.generate_docs()
    except Exception as e:
        console.print(f"[bold red]❌ 文档生成失败:[/bold red] {e}")
        raise typer.Exit(1)


@docs_app.command("serve")
def serve_docs(
    port: int = typer.Option(8000, "--port", "-p", help="服务端口"),
    help_flag: bool = typer.Option(
        False, "-h", "--help",
        help="显示帮助信息"
    )
):
    """启动文档服务器"""
    if help_flag:
        from rich.panel import Panel
        from rich.table import Table
        
        # 创建选项表格
        options_table = Table(show_header=False, box=None, padding=(0, 1))
        options_table.add_column("Option", style="cyan")
        options_table.add_column("Description")
        options_table.add_row("--port  -p  INTEGER", "服务端口 [default: 8000]")
        options_table.add_row("--help  -h", "显示帮助信息")
        
        console.print("\n[bold yellow]Usage:[/bold yellow] agx docs serve [OPTIONS]\n")
        console.print("启动文档服务器\n")
        console.print(Panel(options_table, title="Options", title_align="left"))
        raise typer.Exit()
    
    console.print(f"[bold blue]启动文档服务器:[/bold blue]")
    
    DocGenerator = _get_doc_generator()
    doc_generator = DocGenerator()
    try:
        doc_generator.serve_docs(port=port)
        console.print(f"[bold green]✓ 文档服务器启动成功![/bold green]")
        console.print(f"访问地址: http://localhost:{port}")
    except Exception as e:
        console.print(f"[bold red]文档服务器启动失败:[/bold red] {e}")
        raise typer.Exit(1)


@mineru_app.callback(invoke_without_command=True)
def mineru_callback(
    ctx: typer.Context,
    help_flag: bool = typer.Option(
        False, "-h", "--help", 
        help="显示帮助信息"
    )
):
    """MinerU 文档解析命令回调函数，支持 -h 选项"""
    if help_flag or ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


# ==================== MinerU 命令实现 ====================

@mineru_app.command("parse")
def mineru_parse(
    files: List[str] = typer.Argument(..., help="要解析的文档文件路径"),
    output_dir: Optional[str] = typer.Option(None, "--output", "-o", help="输出目录"),
    mode: str = typer.Option("local", "--mode", "-m", help="解析模式: local, remote_api, remote_mcp"),
    language: str = typer.Option("auto", "--language", "-l", help="OCR 语言"),
    api_base: Optional[str] = typer.Option(None, "--api-base", help="远程 API 基础 URL"),
    api_token: Optional[str] = typer.Option(None, "--api-token", help="远程 API 令牌"),
    backend: str = typer.Option("PIPELINE", "--backend", "-b", help="后端类型: PIPELINE, VLM_HTTP"),
    enable_formula: bool = typer.Option(True, "--formula/--no-formula", help="启用公式识别"),
    enable_table: bool = typer.Option(True, "--table/--no-table", help="启用表格识别"),
    page_ranges: Optional[str] = typer.Option(None, "--pages", "-p", help="页面范围，如 '1-5,10,15-20'"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="配置文件路径"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出")
):
    """解析文档文件（PDF、PPT、DOC等）并转换为结构化格式"""
    
    console.print(f"[bold blue]MinerU 文档解析[/bold blue]")
    console.print(f"模式: {mode}")
    console.print(f"文件数量: {len(files)}")
    
    # 验证文件存在
    missing_files = []
    for file_path in files:
        if not Path(file_path).exists():
            missing_files.append(file_path)
    
    if missing_files:
        console.print(f"[bold red]错误:[/bold red] 以下文件不存在:")
        for file_path in missing_files:
            console.print(f"  - {file_path}")
        raise typer.Exit(1)
    
    # 设置输出目录
    if not output_dir:
        output_dir = Path.cwd() / "mineru_outputs"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # 导入并执行解析
        result = asyncio.run(_run_mineru_parse(
            files=files,
            output_dir=str(output_path),
            mode=mode,
            language=language,
            api_base=api_base,
            api_token=api_token,
            backend=backend,
            enable_formula=enable_formula,
            enable_table=enable_table,
            page_ranges=page_ranges,
            config=config,
            verbose=verbose
        ))
        
        # 显示结果
        _display_parse_results(result, verbose)
        
    except Exception as e:
        console.print(f"[bold red]解析失败:[/bold red] {e}")
        if verbose:
            import traceback
            console.print(traceback.format_exc())
        raise typer.Exit(1)


@mineru_app.command("batch")
def mineru_batch(
    input_dir: str = typer.Argument(..., help="输入目录路径"),
    output_dir: Optional[str] = typer.Option(None, "--output", "-o", help="输出目录"),
    patterns: Optional[str] = typer.Option("*.pdf,*.png,*.jpg,*.jpeg", "--patterns", help="文件匹配模式（逗号分隔）"),
    mode: str = typer.Option("local", "--mode", "-m", help="解析模式: local, remote_api"),
    language: str = typer.Option("auto", "--language", "-l", help="OCR 语言"),
    api_base: Optional[str] = typer.Option(None, "--api-base", help="远程 API 基础 URL"),
    api_token: Optional[str] = typer.Option(None, "--api-token", help="远程 API 令牌"),
    backend: str = typer.Option("PIPELINE", "--backend", "-b", help="后端类型: PIPELINE, VLM_HTTP"),
    enable_formula: bool = typer.Option(True, "--formula/--no-formula", help="启用公式识别"),
    enable_table: bool = typer.Option(True, "--table/--no-table", help="启用表格识别"),
    max_concurrent: int = typer.Option(3, "--max-concurrent", help="最大并发数"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="配置文件路径"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="详细输出")
):
    """批量处理目录中的文档文件"""
    
    console.print(f"[bold blue]MinerU 批量文档解析[/bold blue]")
    
    # 验证输入目录
    input_path = Path(input_dir)
    if not input_path.exists():
        console.print(f"[bold red]错误:[/bold red] 输入目录不存在: {input_dir}")
        raise typer.Exit(1)
    
    if not input_path.is_dir():
        console.print(f"[bold red]错误:[/bold red] 输入路径不是目录: {input_dir}")
        raise typer.Exit(1)
    
    # 设置输出目录
    if not output_dir:
        output_dir = input_path / "mineru_batch_outputs"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # 执行批量处理
        result = asyncio.run(_run_mineru_batch(
            input_dir=str(input_path),
            output_dir=str(output_path),
            patterns=patterns.split(",") if patterns else ["*.pdf", "*.png", "*.jpg", "*.jpeg"],
            mode=mode,
            language=language,
            api_base=api_base,
            api_token=api_token,
            backend=backend,
            enable_formula=enable_formula,
            enable_table=enable_table,
            max_concurrent=max_concurrent,
            config=config,
            verbose=verbose
        ))
        
        # 显示结果
        _display_batch_results(result, verbose)
        
    except Exception as e:
        console.print(f"[bold red]批量处理失败:[/bold red] {e}")
        if verbose:
            import traceback
            console.print(traceback.format_exc())
        raise typer.Exit(1)


@mineru_app.command("languages")
def mineru_languages(
    mode: str = typer.Option("local", "--mode", "-m", help="查询模式: local, remote_api"),
    api_base: Optional[str] = typer.Option(None, "--api-base", help="远程 API 基础 URL"),
    api_token: Optional[str] = typer.Option(None, "--api-token", help="远程 API 令牌"),
    config: Optional[str] = typer.Option(None, "--config", "-c", help="配置文件路径")
):
    """获取支持的 OCR 语言列表"""
    
    console.print(f"[bold blue]MinerU 支持的 OCR 语言[/bold blue]")
    
    try:
        # 执行语言查询
        result = asyncio.run(_run_mineru_languages(
            mode=mode,
            api_base=api_base,
            api_token=api_token,
            config=config
        ))
        
        # 显示结果
        _display_languages_results(result)
        
    except Exception as e:
        console.print(f"[bold red]语言查询失败:[/bold red] {e}")
        raise typer.Exit(1)


# ==================== MinerU 辅助函数 ====================

async def _run_mineru_parse(**kwargs) -> dict:
    """执行 MinerU 解析"""
    from agenticx.tools.mineru import ParseDocumentsTool, MinerUParseArgs, ParseMode
    
    # 构建参数
    mode_map = {
        "local": ParseMode.LOCAL,
        "remote_api": ParseMode.REMOTE_API,
        "remote_mcp": ParseMode.REMOTE_MCP
    }
    
    args = MinerUParseArgs(
        file_sources=kwargs["files"],
        mode=mode_map.get(kwargs["mode"], ParseMode.LOCAL),
        language=kwargs["language"],
        api_base=kwargs.get("api_base"),
        api_token=kwargs.get("api_token"),
        backend=kwargs["backend"],
        enable_formula=kwargs["enable_formula"],
        enable_table=kwargs["enable_table"],
        page_ranges=kwargs.get("page_ranges")
    )
    
    # 创建工具并执行
    config = _load_mineru_config(kwargs.get("config"))
    tool = ParseDocumentsTool(config)
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("解析文档中...", total=len(kwargs["files"]))
        
        result = await tool.parse(args)
        progress.update(task, completed=len(kwargs["files"]))
    
    return result


async def _run_mineru_batch(**kwargs) -> dict:
    """执行 MinerU 批量处理"""
    from agenticx.tools.remote import MinerUBatchProcessor
    
    # 加载配置
    config = _load_mineru_config(kwargs.get("config"))
    processor = MinerUBatchProcessor(config)
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("批量处理中...", total=None)
        
        result = await processor.process_directory(
            input_dir=kwargs["input_dir"],
            output_dir=kwargs["output_dir"],
            file_patterns=kwargs["patterns"],
            language=kwargs["language"],
            enable_formula=kwargs["enable_formula"],
            enable_table=kwargs["enable_table"]
        )
        
        progress.update(task, completed=1)
    
    return result


async def _run_mineru_languages(**kwargs) -> dict:
    """执行 MinerU 语言查询"""
    from agenticx.tools.mineru import GetOCRLanguagesTool, MinerUOCRLanguagesArgs, ParseMode
    
    # 构建参数
    mode_map = {
        "local": ParseMode.LOCAL,
        "remote_api": ParseMode.REMOTE_API
    }
    
    args = MinerUOCRLanguagesArgs(
        mode=mode_map.get(kwargs["mode"], ParseMode.LOCAL),
        api_base=kwargs.get("api_base"),
        api_token=kwargs.get("api_token")
    )
    
    # 创建工具并执行
    config = _load_mineru_config(kwargs.get("config"))
    tool = GetOCRLanguagesTool(config)
    
    return await tool.get_languages(args)


def _load_mineru_config(config_path: Optional[str]):
    """加载 MinerU 配置"""
    from agenticx.tools.remote import MinerUConfig
    
    config_data = {}
    
    if config_path:
        config_file = Path(config_path)
        if config_file.exists():
            import json
            with open(config_file, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
    
    # 从环境变量补充配置
    if not config_data.get("api_key"):
        config_data["api_key"] = os.getenv("MINERU_API_KEY")
    if not config_data.get("base_url"):
        config_data["base_url"] = os.getenv("MINERU_BASE_URL")
    
    # 创建 MinerUConfig 对象
    return MinerUConfig(**config_data) if config_data else MinerUConfig.from_env()


def _display_parse_results(result: dict, verbose: bool = False):
    """显示解析结果"""
    if result.get("success"):
        console.print(f"[bold green]✓ 解析完成![/bold green]")
        
        if result.get("mode") == "local":
            results = result.get("results", [])
            console.print(f"成功解析: {len(results)} 个文件")
            
            if verbose and results:
                table = Table(show_header=True, header_style="bold magenta")
                table.add_column("文件", style="cyan")
                table.add_column("任务ID", style="yellow")
                table.add_column("输出文件数", style="green")
                
                for res in results:
                    artifacts = res.get("artifacts", {})
                    file_count = len(artifacts.get("markdown_files", []))
                    table.add_row(
                        Path(res["source_file"]).name,
                        res["task_id"],
                        str(file_count)
                    )
                
                console.print(table)
        
        elif result.get("mode") == "remote_api":
            console.print(f"任务ID: {result.get('task_id')}")
            console.print(f"输出目录: {result.get('output_dir')}")
    
    else:
        console.print(f"[bold red]✗ 解析失败![/bold red]")
        if result.get("error"):
            console.print(f"错误: {result['error']}")


def _display_batch_results(result: dict, verbose: bool = False):
    """显示批量处理结果"""
    console.print(f"[bold green]✓ 批量处理完成![/bold green]")
    console.print(f"任务ID: {result.get('task_id')}")
    console.print(f"输出目录: {result.get('output_dir')}")
    
    upload_summary = result.get("upload_summary", {})
    console.print(f"文件上传: {upload_summary.get('success_count', 0)}/{upload_summary.get('total_files', 0)}")
    
    if verbose and upload_summary.get("failed_files"):
        console.print("\n[yellow]上传失败的文件:[/yellow]")
        for failed in upload_summary["failed_files"]:
            console.print(f"  - {failed['file']}: {failed['error']}")


def _display_languages_results(result: dict):
    """显示语言查询结果"""
    if result.get("success"):
        languages = result.get("languages", [])
        console.print(f"[bold green]✓ 查询成功![/bold green]")
        console.print(f"支持的语言数量: {len(languages)}")
        
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("代码", style="cyan")
        table.add_column("名称", style="white")
        table.add_column("描述", style="yellow")
        
        for lang in languages:
            if isinstance(lang, dict):
                table.add_row(
                    lang.get("code", ""),
                    lang.get("name", ""),
                    lang.get("description", "")
                )
            else:
                table.add_row(str(lang), "", "")
        
        console.print(table)
    else:
        console.print(f"[bold red]✗ 查询失败![/bold red]")
        if result.get("error"):
            console.print(f"错误: {result['error']}")


def _show_parse_help():
    """显示解析命令帮助"""
    options_table = Table(show_header=False, box=None, padding=(0, 1))
    options_table.add_column("Option", style="cyan")
    options_table.add_column("Description")
    options_table.add_row("--output      -o  TEXT", "输出目录")
    options_table.add_row("--mode        -m  TEXT", "解析模式: local, remote_api, remote_mcp [default: local]")
    options_table.add_row("--language    -l  TEXT", "OCR 语言 [default: auto]")
    options_table.add_row("--api-base        TEXT", "远程 API 基础 URL")
    options_table.add_row("--api-token       TEXT", "远程 API 令牌")
    options_table.add_row("--backend     -b  TEXT", "后端类型: PIPELINE, VLM_HTTP [default: PIPELINE]")
    options_table.add_row("--formula/--no-formula", "启用/禁用公式识别 [default: formula]")
    options_table.add_row("--table/--no-table", "启用/禁用表格识别 [default: table]")
    options_table.add_row("--pages       -p  TEXT", "页面范围，如 '1-5,10,15-20'")
    options_table.add_row("--config      -c  TEXT", "配置文件路径")
    options_table.add_row("--verbose     -v", "详细输出")
    options_table.add_row("--help        -h", "显示帮助信息")
    
    console.print("\n[bold yellow]Usage:[/bold yellow] agx mineru parse [OPTIONS] FILES...\n")
    console.print("解析文档文件（PDF、PPT、DOC等）并转换为结构化格式\n")
    console.print(Panel(options_table, title="Options", title_align="left"))


def _show_batch_help():
    """显示批量处理命令帮助"""
    options_table = Table(show_header=False, box=None, padding=(0, 1))
    options_table.add_column("Option", style="cyan")
    options_table.add_column("Description")
    options_table.add_row("--output      -o  TEXT", "输出目录")
    options_table.add_row("--patterns        TEXT", "文件匹配模式（逗号分隔） [default: *.pdf,*.png,*.jpg,*.jpeg]")
    options_table.add_row("--mode        -m  TEXT", "解析模式: local, remote_api [default: local]")
    options_table.add_row("--language    -l  TEXT", "OCR 语言 [default: auto]")
    options_table.add_row("--api-base        TEXT", "远程 API 基础 URL")
    options_table.add_row("--api-token       TEXT", "远程 API 令牌")
    options_table.add_row("--backend     -b  TEXT", "后端类型: PIPELINE, VLM_HTTP [default: PIPELINE]")
    options_table.add_row("--formula/--no-formula", "启用/禁用公式识别 [default: formula]")
    options_table.add_row("--table/--no-table", "启用/禁用表格识别 [default: table]")
    options_table.add_row("--max-concurrent  INTEGER", "最大并发数 [default: 3]")
    options_table.add_row("--config      -c  TEXT", "配置文件路径")
    options_table.add_row("--verbose     -v", "详细输出")
    options_table.add_row("--help        -h", "显示帮助信息")
    
    console.print("\n[bold yellow]Usage:[/bold yellow] agx mineru batch [OPTIONS] INPUT_DIR\n")
    console.print("批量处理目录中的文档文件\n")
    console.print(Panel(options_table, title="Options", title_align="left"))


def _show_languages_help():
    """显示语言查询命令帮助"""
    options_table = Table(show_header=False, box=None, padding=(0, 1))
    options_table.add_column("Option", style="cyan")
    options_table.add_column("Description")
    options_table.add_row("--mode        -m  TEXT", "查询模式: local, remote_api [default: local]")
    options_table.add_row("--api-base        TEXT", "远程 API 基础 URL")
    options_table.add_row("--api-token       TEXT", "远程 API 令牌")
    options_table.add_row("--config      -c  TEXT", "配置文件路径")
    options_table.add_row("--help        -h", "显示帮助信息")
    
    console.print("\n[bold yellow]Usage:[/bold yellow] agx mineru languages [OPTIONS]\n")
    console.print("获取支持的 OCR 语言列表\n")
    console.print(Panel(options_table, title="Options", title_align="left"))


def main():
    """主入口函数"""
    app()


if __name__ == "__main__":
    main()