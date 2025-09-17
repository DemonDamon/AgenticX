#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX CLI 主程序
基于 Typer 的命令行工具套件
"""

import typer
from typing import Optional
import sys
import os
from pathlib import Path
from rich.console import Console
from rich.table import Table

from agenticx import __version__

# 延迟导入以提高启动速度
def _get_client():
    from .client import AgenticXClient
    return AgenticXClient

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
project_app = typer.Typer(name="project", help="项目管理命令")
agent_app = typer.Typer(name="agent", help="智能体管理命令")
workflow_app = typer.Typer(name="workflow", help="工作流管理命令")
deploy_app = typer.Typer(name="deploy", help="部署相关命令")
monitor_app = typer.Typer(name="monitor", help="监控相关命令")
docs_app = typer.Typer(
    name="docs", 
    help="""
    文档生成与服务。
    
    请按照以下步骤操作：
    
    1. **生成文档**: `agenticx docs generate`
    2. **启动服务**: `agenticx docs serve`
    """,
    rich_help_panel="Commands",
    add_completion=False
)

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


def main():
    """主入口函数"""
    app()


if __name__ == "__main__":
    main()