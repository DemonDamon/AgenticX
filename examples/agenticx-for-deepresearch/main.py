#!/usr/bin/env python3
"""
AgenticX 深度搜索系统
智能研究助手 - 深度分析任何主题
"""

import argparse
import logging
import os
import sys
import yaml
import time
from typing import Dict, Any, Optional
from pathlib import Path
from utils import clean_input_text

# 导入美化库
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.table import Table
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich.layout import Layout
    from rich.align import Align
    from rich.rule import Rule
    from rich import box
    from pyboxen import boxen
except ImportError:
    # 如果导入失败，使用基础版本
    Console = None
    Panel = None
    boxen = None

# # 添加项目根目录到 Python 路径
# project_root = Path(__file__).parent.parent.parent
# sys.path.insert(0, str(project_root))
# sys.path.append(str(Path(__file__).parent))

# # 确保能找到agenticx模块
# if str(project_root) not in sys.path:
#     sys.path.insert(0, str(project_root))

# 加载环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()  # 加载 .env 文件
except ImportError:
    pass
except Exception as e:
    pass

# 创建Rich Console实例
console = Console() if Console else None

# ANSI 颜色代码（保留作为后备）
class Colors:
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    
    # 基础颜色
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    
    # 亮色
    BRIGHT_BLACK = '\033[90m'
    BRIGHT_RED = '\033[91m'
    BRIGHT_GREEN = '\033[92m'
    BRIGHT_YELLOW = '\033[93m'
    BRIGHT_BLUE = '\033[94m'
    BRIGHT_MAGENTA = '\033[95m'
    BRIGHT_CYAN = '\033[96m'
    BRIGHT_WHITE = '\033[97m'

def print_thinking(message: str):
    """显示AI思考过程（白色点）"""
    if console:
        console.print(f"● {message}", style="white dim")
    else:
        print(f"{Colors.WHITE}● {Colors.DIM}{message}{Colors.RESET}")

def print_action(message: str):
    """显示工具调用（绿色点）"""
    if console:
        console.print(f"● {message}", style="green")
    else:
        print(f"{Colors.BRIGHT_GREEN}● {message}{Colors.RESET}")

def print_error(message: str):
    """显示错误信息（红色）"""
    if console:
        console.print(f"● {message}", style="bright_red bold")
    else:
        print(f"{Colors.BRIGHT_RED}● {message}{Colors.RESET}")

def print_success(message: str):
    """显示成功信息（绿色点）"""
    if console:
        console.print(f"● {message}", style="bright_green bold")
    else:
        print(f"{Colors.BRIGHT_GREEN}● {message}{Colors.RESET}")

def print_info(message: str):
    """显示信息（白色点）"""
    if console:
        console.print(f"● {message}", style="white")
    else:
        print(f"{Colors.WHITE}● {message}{Colors.RESET}")

def print_mode_selection(message: str):
    """显示模式选择（橙色点）"""
    if console:
        console.print(f"● {message}", style="bright_yellow bold")
    else:
        print(f"{Colors.BRIGHT_YELLOW}● {message}{Colors.RESET}")

def print_welcome():
    """显示欢迎界面"""
    # AgenticX ASCII Logo - 简洁风格
    agenticx_logo = """

 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗ ██████╗██╗  ██╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██╔════╝╚██╗██╔╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║      ╚███╔╝ 
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║      ██╔██╗ 
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║╚██████╗██╔╝ ██╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝
                                                                
    """
    
    if console and Panel:
        # # 使用Rich显示橙色主题的logo和信息
        # # console.print(agenticx_logo, style="bold #FF6B35")
        
        # # 环境配置信息
        # api_key = os.getenv('KIMI_API_KEY', 'sk-***')
        # api_key_display = f"{api_key[:8]}..." if len(api_key) > 8 else api_key
        
        # welcome_text = Text()
        # welcome_text.append(agenticx_logo, style="bold #FF6B35")
        # # welcome_text.append("🚀 Welcome to AgenticX Deep Research Platform! 🚀\n\n", style="bold #FF6B35")
        # welcome_text.append("\nQuick Commands:\n", style="bold #FF8C42")
        # welcome_text.append("● /help for help, /clear to clear\n", style="#FFA366")
        # welcome_text.append("● /exit to quit, /mode to select mode\n\n", style="#FFA366")
        
        # welcome_text.append("Environment Configuration:\n", style="bold #FF8C42")
        # welcome_text.append(f"● API Key: {api_key_display}\n", style="white")
        # welcome_text.append(f"● API Base: {os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1')}\n", style="white")
        # welcome_text.append(f"● Search Engine: {os.getenv('SEARCH_ENGINE', 'bochaai')}\n", style="white")
        # welcome_text.append(f"● Working Directory: {os.getcwd()}", style="dim")
        
        # panel = Panel(
        #     welcome_text,
        #     # title="[bold #FF6B35]🔥 AgenticX Control Center[/bold #FF6B35]",
        #     border_style="#FF6B35",
        #     box=box.ROUNDED,
        #     padding=(1, 2)
        # )
        # console.print(panel)

        # 使用Rich显示橙色主题的logo和信息
        console.print(agenticx_logo, style="bold #FF6B35")
        
        # 环境配置信息
        api_key = os.getenv('KIMI_API_KEY', 'sk-***')
        api_key_display = f"{api_key[:8]}..." if len(api_key) > 8 else api_key
        
        # console.print("● Quick Commands:", style="bold #FF6B35")
        # console.print("  ⎿  /help for help, /clear to clear", style="dim")
        # console.print("  ⎿  /exit to quit, /mode to select mode\n", style="dim")
        
        console.print("● Environment Configuration:", style="bold #FF6B35")
        console.print(f"  ⎿  API Key: {api_key_display}", style="dim")
        console.print(f"  ⎿  API Base: {os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1')}", style="dim")
        console.print(f"  ⎿  Search Engine: {os.getenv('SEARCH_ENGINE', 'bochaai')}", style="dim")
        console.print(f"  ⎿  Working Directory: {os.getcwd()}\n", style="dim")

    elif boxen:
        # 使用pyboxen创建框框
        print(agenticx_logo)
        content = (
            "🚀 Welcome to AgenticX Deep Research Platform! 🚀\n\n"
            "Quick Commands:\n"
            "● /help for help, /clear to clear\n"
            "● /exit to quit, /mode to select mode\n\n"
            "Environment Configuration:\n"
            f"● API Key: {os.getenv('KIMI_API_KEY', 'sk-***')[:8]}...\n"
            f"● API Base: {os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1')}\n"
            f"● Search Engine: {os.getenv('SEARCH_ENGINE', 'bochaai')}\n"
            f"● Working Directory: {os.getcwd()}"
        )
        print(boxen(
            content,
            # title="🔥 AgenticX Control Center",
            title_alignment="center",
            style="rounded",
            color="orange",
            padding=1
        ))
    else:
        # 后备方案：使用原始的ASCII艺术
        print(agenticx_logo)
        print(f"""
┌─────────────────────────────────────────────────────────────┐
│ 🚀 Welcome to AgenticX Deep Research Platform!             │
│                                                             │
│ /help for help, /clear to clear, /exit to quit, /mode to   │
│ select mode                                                 │
│                                                             │
│ cwd: {os.getcwd():<51} │
│                                                             │
│ Environment Configuration:                                  │
│ ● API Key: {os.getenv('KIMI_API_KEY', 'sk-***')[:8]}...{' ' * (43 - len(os.getenv('KIMI_API_KEY', 'sk-***')[:8]))} │
│ ● API Base URL: {os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1'):<39} │
│ ● Search Engine: {os.getenv('SEARCH_ENGINE', 'bochaai'):<42} │
└─────────────────────────────────────────────────────────────┘
""")

def print_help():
    """显示帮助信息"""
    if console and Table:
        # 使用Rich创建美观的帮助表格
        table = Table(title="[bold cyan]Available Commands[/bold cyan]", box=box.ROUNDED)
        table.add_column("Command", style="bold yellow", width=12)
        table.add_column("Description", style="white")
        
        table.add_row("/help", "Show this help information")
        table.add_row("/clear", "Clear screen")
        table.add_row("/mode", "Select workflow mode")
        table.add_row("/exit", "Exit program")
        table.add_row("", "")
        table.add_row("[dim]Direct input[/dim]", "[dim]Input research topic to start deep search[/dim]")
        
        console.print(table)
    elif boxen:
        # 使用pyboxen创建帮助框
        content = (
            "Available Commands:\n\n"
            "/help     Show this help information\n"
            "/clear    Clear screen\n"
            "/mode     Select workflow mode\n"
            "/exit     Exit program\n\n"
            "Directly input research topic to start deep search"
        )
        print(boxen(
            content,
            title="Help",
            style="rounded",
            color="yellow",
            padding=1
        ))
    else:
        # 后备方案
        print(f"""
{Colors.BOLD}Available Commands:{Colors.RESET}

/help     Show this help information
/clear    Clear screen
/mode     Select workflow mode
/exit     Exit program

Directly input research topic to start deep search
""")

def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """加载配置文件"""
    if not os.path.exists(config_path):
        return {}
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except Exception as e:
        print_error(f"配置文件加载失败: {e}")
        return {}



def select_workflow_mode() -> str:
    """选择工作流模式 - 使用InquirerPy的现代交互界面"""
    try:
        from InquirerPy import inquirer
        from rich.console import Console
        
        console = Console()
        
        mode = inquirer.select(
            message="● Select research strategy:",
            choices=[
                {"name": "Basic Mode - Direct deep search", "value": "basic"},
                {"name": "Interactive Mode - Search then clarify", "value": "interactive"},
                {"name": "Advanced Mode - Multi-round iteration", "value": "advanced"}
            ],
            default="basic",
            qmark="",
            amark="",
            pointer="  >"
        ).execute()
        
        # 清除可能的残留输出和多余的问号
        sys.stdout.write('\r')
        sys.stdout.flush()
        # 清除当前行的内容
        sys.stdout.write('\033[K')
        sys.stdout.flush()

        return mode
        
    except ImportError:
        # 如果InquirerPy不可用，回退到原始的Rich界面
        if console and Panel:
            mode_text = Text()
            mode_text.append("1. Basic Mode", style="bold green")
            mode_text.append(" - Direct deep search\n", style="white")
            mode_text.append("   Suitable: Clear requirements, quick results\n", style="dim")
            
            mode_text.append("2. Interactive Mode", style="bold blue")
            mode_text.append(" - Search then clarify questions\n", style="white")
            mode_text.append("   Suitable: Needs AI assistance to focus research\n", style="dim")
            
            mode_text.append("3. Advanced Mode", style="bold magenta")
            mode_text.append(" - Multi-round iteration\n", style="white")
            mode_text.append("   Suitable: Complex topics requiring deep exploration\n", style="dim")
            
            panel = Panel(
                mode_text,
                title="Select Research Workflow Mode",
                border_style="yellow",
                box=box.ROUNDED,
                padding=(1, 2)
            )
            console.print(panel)
        elif boxen:
            content = (
                "Select Research Workflow Mode:\n\n"
                "1. Basic Mode - Direct deep search\n"
                "   Suitable: Clear requirements, quick results\n\n"
                "2. Interactive Mode - Search then clarify questions\n"
                "   Suitable: Needs AI assistance to focus research\n\n"
                "3. Advanced Mode - Multi-round iteration\n"
                "   Suitable: Complex topics requiring deep exploration"
            )
            print(boxen(
                content,
                title="Research Mode Selection",
                style="rounded",
                color="yellow",
                padding=1
            ))
        else:
            print("""
Select Research Workflow Mode:

1. Basic Mode - Direct deep search
   Suitable: Clear requirements, quick results

2. Interactive Mode - Search then clarify questions  
   Suitable: Needs AI assistance to focus research

3. Advanced Mode - Multi-round iteration
   Suitable: Complex topics requiring deep exploration
""")
        
        while True:
            try:
                choice = input("\nSelect mode (1-3): ").strip()
                if choice == '1' or choice == '':
                    return 'basic'
                elif choice == '2':
                    return 'interactive'
                elif choice == '3':
                    return 'advanced'
                else:
                    print("请输入 1、2 或 3")
            except (EOFError, KeyboardInterrupt):
                return 'basic'

def run_deep_search(topic: str, config: Dict[str, Any], workflow_mode: str = 'basic'):
    """运行深度搜索"""
    try:
        # 设置日志级别为ERROR，减少输出
        logging.getLogger().setLevel(logging.ERROR)
        logging.getLogger('httpx').setLevel(logging.ERROR)
        logging.getLogger('urllib3').setLevel(logging.ERROR)
        
        # 清理输入主题
        topic = clean_input_text(topic)
        if not topic:
            print("Invalid or empty input topic")
            return
            
        # 延迟导入，避免启动时的导入问题
        try:
            from agenticx.llms.kimi_provider import KimiProvider
            from workflows.unified_research_workflow import UnifiedResearchWorkflow, WorkflowMode
        except ImportError as e:
            print(f"Module import failed: {e}")
            print("Please ensure all dependencies are properly installed")
            return
        
        # 设置 LLM 提供者 - 直接使用KimiProvider避免litellm问题
        llm_config = config.get('llm', {})
        
        # 处理环境变量引用
        def resolve_env_var(value):
            if isinstance(value, str) and value.startswith('${') and value.endswith('}'):
                env_var = value[2:-1]  # 去掉 ${ 和 }
                return os.getenv(env_var, value)
            return value
        
        # 解析配置中的环境变量
        resolved_config = {}
        for key, value in llm_config.items():
            resolved_config[key] = resolve_env_var(value)
        
        # 始终使用KimiProvider来避免litellm兼容性问题
        api_key = resolved_config.get('api_key') or os.getenv('KIMI_API_KEY')
        if not api_key:
            api_key = os.getenv('OPENAI_API_KEY')  # 回退到OPENAI_API_KEY
        
        kimi_config = {
            'model': resolved_config.get('model', 'kimi-k2-0711-preview'),
            'api_key': api_key,
            'base_url': resolved_config.get('base_url', 'https://api.moonshot.cn/v1'),
            'temperature': resolved_config.get('temperature', 0.7),
            'timeout': resolved_config.get('timeout', 30.0),
            'max_retries': resolved_config.get('max_retries', 3)
        }
        llm_provider = KimiProvider(**kimi_config)
        
        # 获取配置参数
        deep_search_config = config.get('deep_search', {})
        max_research_loops = deep_search_config.get('max_research_loops', 5)
        search_engine = deep_search_config.get('search_engine', 'bochaai')

        # 根据选择的模式设置工作流模式
        if workflow_mode == "basic":
            mode = WorkflowMode.BASIC
        elif workflow_mode == "interactive":
            mode = WorkflowMode.INTERACTIVE
        elif workflow_mode == "advanced":
            mode = WorkflowMode.ADVANCED
        else:
            mode = WorkflowMode.BASIC  # 默认使用基础模式
        
        # 创建统一工作流
        workflow = UnifiedResearchWorkflow(
            llm_provider=llm_provider,
            mode=mode,
            max_research_loops=max_research_loops,
            search_engine=search_engine
        )
        
        # # 显示搜索引擎启动信息
        # print(f"Start using {search_engine} search engine")
        
        # 运行工作流
        result = workflow.execute(topic)
        
        # # 显示结果
        # if console and Panel:
        #     console.print(Panel(
        #         "[bold green]Deep Search Completed Successfully! 🎉[/bold green]",
        #         title="[bold cyan]Search Results[/bold cyan]",
        #         border_style="green",
        #         box=box.ROUNDED
        #     ))
        # elif boxen:
        #     print(boxen(
        #         "Deep Search Completed Successfully! 🎉",
        #         title="Search Results",
        #         style="rounded",
        #         color="green",
        #         padding=1
        #     ))
        # else:
        #     print("\n┌─────────────────────────────────────────────────────────────┐")
        #     print("│ Deep Search Completed                                       │")
        #     print("└─────────────────────────────────────────────────────────────┘")
        print(f"● Deep Search Completed Successfully! 🎉")

        # 显示最终研究报告
        if isinstance(result, dict) and 'final_report' in result:
            if console and Panel:
                console.print(Panel(
                    result['final_report'],
                    title="[bold magenta]📊 Research Report[/bold magenta]",
                    border_style="magenta",
                    box=box.ROUNDED,
                    padding=(1, 2)
                ))
            elif boxen:
                print(boxen(
                    result['final_report'],
                    title="📊 Research Report",
                    style="rounded",
                    color="magenta",
                    padding=1
                ))
            else:
                print("\n┌─────────────────────────────────────────────────────────────┐")
                print("│ Research Report                                             │")
                print("└─────────────────────────────────────────────────────────────┘")
                print(result['final_report'])
        else:
            if console and Panel:
                console.print(Panel(
                    str(result),
                    title="[bold cyan]Research Results[/bold cyan]",
                    border_style="cyan",
                    box=box.ROUNDED,
                    padding=(1, 2)
                ))
            elif boxen:
                print(boxen(
                    str(result),
                    title="📋 Research Results",
                    style="rounded",
                    color="cyan",
                    padding=1
                ))
            else:
                print("\nResearch Results:")
                print(result)
        
        # 显示监控指标
        if isinstance(result, dict) and 'metrics' in result:
            metrics = result['metrics']
            if console and Table:
                # 使用Rich创建美观的指标表格
                metrics_table = Table(title="[bold blue]Execution Metrics[/bold blue]", box=box.ROUNDED)
                metrics_table.add_column("Metric", style="bold yellow", width=18)
                metrics_table.add_column("Value", style="cyan", justify="right")
                
                metrics_table.add_row("Total Time", f"{metrics.get('execution_time', 0):.2f}s")
                metrics_table.add_row("Search Count", str(metrics.get('search_count', 0)))
                metrics_table.add_row("Research Loops", str(metrics.get('loop_count', 0)))
                metrics_table.add_row("Clarifications", f"{metrics.get('clarification_count', 0)} times")
                metrics_table.add_row("Thinking Steps", f"{metrics.get('thinking_steps', 0)} times")
                metrics_table.add_row("Success Rate", f"{metrics.get('success_rate', 0):.2%}")
                
                console.print(metrics_table)
            elif boxen:
                # 使用pyboxen创建指标框
                metrics_content = (
                    f"Total time: {metrics.get('execution_time', 0):.2f}s\n"
                    f"Search count: {metrics.get('search_count', 0)}\n"
                    f"Research loops: {metrics.get('loop_count', 0)}\n"
                    f"Clarifications: {metrics.get('clarification_count', 0)} times\n"
                    f"Thinking steps: {metrics.get('thinking_steps', 0)} times\n"
                    f"Success rate: {metrics.get('success_rate', 0):.2%}"
                )
                print(boxen(
                    metrics_content,
                    title="Execution Metrics",
                    style="rounded",
                    color="blue",
                    padding=1
                ))
            else:
                # 后备方案
                print("\nExecution Metrics:")
                print(f"   Total time: {metrics.get('execution_time', 0):.2f}s")
                print(f"   Search count: {metrics.get('search_count', 0)}")
                print(f"   Research loops: {metrics.get('loop_count', 0)}")
                print(f"   Clarifications: {metrics.get('clarification_count', 0)} times")
                print(f"   Thinking steps: {metrics.get('thinking_steps', 0)} times")
                print(f"   Success rate: {metrics.get('success_rate', 0):.2%}")
        
        # 显示研究重点
        if isinstance(result, dict) and 'research_focus' in result:
            focus_areas = result['research_focus']
            if focus_areas and isinstance(focus_areas, dict):
                # 提取用户回答的具体内容，过滤掉"未回答"的项目
                actual_focus = [answer for answer in focus_areas.values() if answer and answer != "未回答"]
                if actual_focus:
                    print(f"\nResearch Focus: {', '.join(actual_focus)}")
            elif focus_areas and isinstance(focus_areas, list):
                # 兼容列表格式
                print(f"\nResearch Focus: {', '.join(focus_areas)}")
        
        # 显示错误信息（如果有）
        if isinstance(result, dict) and 'research_context' in result:
            errors = result['research_context'].get('errors', [])
            if errors:
                print(f"\nEncountered {len(errors)} errors during execution:")
                for error in errors:
                    print(f"   {error.get('error', 'Unknown error')}")
        
        # 显示完成提示
        # if console and Panel:
        #     console.print(Panel(
        #         "[bold green]✨ Research completed! ✨[/bold green]\n\n"
        #         "[white]● Input new topic to continue[/white]\n"
        #         "[white]● Type [bold yellow]/exit[/bold yellow] to quit[/white]",
        #         title="[bold cyan]🎉 All Done![/bold cyan]",
        #         border_style="green",
        #         box=box.ROUNDED,
        #         padding=(1, 2)
        #     ))
        # elif boxen:
        #     print(boxen(
        #         "✨ Research completed! ✨\n\n"
        #         "● Input new topic to continue\n"
        #         "● Type /exit to quit",
        #         title="🎉 All Done!",
        #         style="rounded",
        #         color="green",
        #         padding=1
        #     ))
        # else:
        #     print("\n┌─────────────────────────────────────────────────────────────┐")
        #     print("│ Research completed! Input new topic to continue or /exit   │")
        #     print("└─────────────────────────────────────────────────────────────┘")
        print(f"\n● Research completed! ✨\n")
    
    except KeyboardInterrupt:
        print("\n\nUser interrupted the search process")
    except Exception as e:
        print(f"Workflow execution failed: {e}")
        import traceback
        print(traceback.format_exc())


def interactive_mode(config: Dict[str, Any]):
    """交互模式主循环"""
    # 获取工作流模式配置
    deep_search_config = config.get('deep_search', {})
    workflow_mode = deep_search_config.get('workflow_mode', 'basic')

    mode_names = {
        "basic": "Basic Mode",
        "interactive": "Interactive Mode", 
        "advanced": "Advanced Mode"
    }
    
    while True:
        try:
            # 首先选择工作流模式
            workflow_mode = select_workflow_mode()
            config['deep_search']['workflow_mode'] = workflow_mode
            mode_name = mode_names.get(workflow_mode, "Basic Mode")
            
            # if console and Panel:
            #     console.print(Panel(
            #         f"[bold #FF6B35]Selected Mode:[/bold #FF6B35] [bold #FF8C42]{mode_name}[/bold #FF8C42]\n\n"
            #         "[white]💡 Please enter your research topic to start, or type [bold #FF6B35]/[/bold #FF6B35] to view quick commands[/white]",
            #         # title="[bold #FF6B35]🔥 Interactive Mode[/bold #FF6B35]",
            #         border_style="#FF6B35",
            #         box=box.ROUNDED,
            #         padding=(1, 2)
            #     ))
            # elif boxen:
            #     print(boxen(
            #         f"Selected Mode: {mode_name}\n\n"
            #         "💡 Please enter your research topic to start, or type / to view quick commands",
            #         # title="🔥 Interactive Mode",
            #         style="rounded",
            #         color="orange",
            #         padding=1
            #     ))
            # else:
            #     print(f"\nUsing workflow mode: {mode_name}")
            #     print("┌─────────────────────────────────────────────────────────────┐")
            #     print("│ Please enter your research topic to start, or input / to   │")
            #     print("│ view quick commands                                         │")
            #     print("└─────────────────────────────────────────────────────────────┘")
            
            # 获取用户输入 - 使用InquirerPy的现代输入界面
            try:
                from InquirerPy import inquirer
                user_input = inquirer.text(
                    message="\n● Type your research topic:",
                    qmark="",
                    amark=""
                ).execute()

                # 清除可能的残留输出和多余的问号
                sys.stdout.write('\r')
                sys.stdout.flush()
                # 清除当前行的内容
                sys.stdout.write('\033[K')
                sys.stdout.flush()
            
            except ImportError:
                # 回退到传统输入
                if console and Panel:
                    raw_input = input(" > Type your research topic: ")
                elif boxen:
                    input_box = boxen(
                        "> Type your research topic",
                        style="rounded",
                        color="orange",
                        padding=(0, 1)
                    )
                    print(input_box)
                    raw_input = input("")
                else:
                    print("\n┌─────────────────────────────────────────────────────────────┐")
                    print("│ > Type your research topic                                  │")
                    print("└─────────────────────────────────────────────────────────────┘")
                    raw_input = input("")
                user_input = clean_input_text(raw_input)
            
            if not user_input:
                continue
            
            # 处理命令
            if user_input.startswith('/'):
                command = user_input[1:].lower()
                
                if command == '' or command == '/':
                    # 显示快捷命令列表
                    print("\nQuick Commands:")
                    print("/help or /h     Show help information")
                    print("/clear or /c    Clear screen")
                    print("/mode or /m     Select workflow mode")
                    print("/exit or /q     Exit program")
                    print("\nDirectly input research topic to start deep search")
                elif command == 'help' or command == 'h':
                    print_help()
                elif command == 'clear' or command == 'c':
                    os.system('cls' if os.name == 'nt' else 'clear')
                    print_welcome()
                elif command == 'mode' or command == 'm':
                    # 选择新的工作流模式
                    new_mode = select_workflow_mode()
                    workflow_mode = new_mode
                    config['deep_search']['workflow_mode'] = new_mode
                    mode_name = mode_names.get(workflow_mode, "Basic Mode")
                    print(f"\nSwitched to: {mode_name}")
                elif command == 'exit' or command == 'quit' or command == 'q':
                    print("\nThank you for using AgenticX Deep Search System!")
                    break
                else:
                    print(f"Unknown command: /{command}")
                    print("Input /help to view available commands")
            else:
                # 执行深度搜索
                run_deep_search(user_input, config, workflow_mode)
                
        except (EOFError, KeyboardInterrupt):
            print("\n\nThank you for using AgenticX Deep Search System!")
            break
        except Exception as e:
            print(f"Error occurred: {e}")

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='AgenticX 深度搜索系统')
    parser.add_argument('topic', nargs='?', help='研究主题')
    parser.add_argument('--config', '-c', default='config.yaml', help='配置文件路径')
    parser.add_argument('--mode', choices=['basic', 'interactive', 'advanced'], 
                       default='basic', help='工作流模式')
    parser.add_argument('--max_research_loops', '-i', type=int, default=5, help='最大深度研究迭代次数')
    parser.add_argument('--verbose', '-v', action='store_true', help='详细输出')
    
    args = parser.parse_args()
    
    # 显示欢迎界面
    print_welcome()
    
    # 加载配置
    config = load_config(args.config)
    
    # 更新配置
    if 'deep_search' not in config:
        config['deep_search'] = {}
        config['deep_search']['workflow_mode'] = args.mode
        config['deep_search']['max_research_loops'] = args.max_research_loops
    
    if args.topic:
        # 直接执行搜索
        run_deep_search(args.topic, config, args.mode)
    else:
        # 直接进入交互模式，等待用户输入
        interactive_mode(config)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nGoodbye!")
    except Exception as e:
        print(f"System error: {e}")
        sys.exit(1)