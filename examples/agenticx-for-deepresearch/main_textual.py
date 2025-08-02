#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgenticX Deep Search System - Textual UI Version
使用Textual框架实现的现代化交互界面
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Dict, Any, Optional

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Header, Footer, Input, Static, Button, 
    RichLog, Select, ProgressBar, Label
)
from textual.reactive import reactive
from textual.message import Message
from textual.binding import Binding
from textual import events
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.markdown import Markdown
from rich.syntax import Syntax
from InquirerPy import inquirer

# 导入现有的工作流和配置
from workflows.unified_research_workflow import UnifiedResearchWorkflow
from utils import load_config, clean_input_text


class SearchResultDisplay(RichLog):
    """搜索结果显示组件"""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auto_scroll = True
        self.highlight = True
        self.markup = True

    def add_welcome_message(self):
        """添加欢迎信息"""
        welcome_panel = Panel(
            "[bold #FF6B35]🔥 AgenticX Deep Search System[/bold #FF6B35]\n\n"
            "[white]💡 Enter your research topic in the input box below[/white]\n"
            "[white]📁 Use @path/to/file to include specific files[/white]\n"
            "[white]⚙️ Press Ctrl+M to change workflow mode[/white]\n\n"
            "[bold yellow]💡 Quick Commands:[/bold yellow]\n"
            "[white]/help or /h     Show help information[/white]\n"
            "[white]/clear or /c    Clear screen[/white]\n"
            "[white]/mode or /m     Select workflow mode[/white]\n"
            "[white]/exit or /q     Exit program[/white]\n\n"
            "[white]Directly input research topic to start deep search[/white]",
            title="[bold cyan]Welcome[/bold cyan]",
            border_style="#FF6B35",
            padding=(1, 2)
        )
        self.write(welcome_panel)

    def add_search_start(self, topic: str, mode: str):
        """添加搜索开始信息"""
        start_panel = Panel(
            f"[bold green]🚀 Starting Research[/bold green]\n\n"
            f"[white]Topic:[/white] [bold]{topic}[/bold]\n"
            f"[white]Mode:[/white] [bold]{mode}[/bold]",
            title="[bold blue]Research Started[/bold blue]",
            border_style="green"
        )
        self.write(start_panel)

    def add_progress_update(self, message: str):
        """添加进度更新"""
        self.write(f"[dim]⏳ {message}[/dim]")

    def add_result(self, result: Dict[str, Any]):
        """添加搜索结果"""
        if isinstance(result, dict) and 'final_report' in result:
            report = result['final_report']
            if isinstance(report, str):
                # 使用Markdown渲染报告
                markdown = Markdown(report)
                result_panel = Panel(
                    markdown,
                    title="[bold green]📊 Research Report[/bold green]",
                    border_style="green",
                    padding=(1, 2)
                )
                self.write(result_panel)
            else:
                self.write(f"[yellow]Result: {result}[/yellow]")
        else:
            self.write(f"[yellow]Result: {result}[/yellow]")

    def add_error(self, error: str):
        """添加错误信息"""
        error_panel = Panel(
            f"[bold red]❌ Error[/bold red]\n\n{error}",
            title="[bold red]Error[/bold red]",
            border_style="red"
        )
        self.write(error_panel)

    def add_completion(self):
        """添加完成信息"""
        completion_panel = Panel(
            "[bold green]✨ Research completed![/bold green]\n\n"
            "[white]• Enter a new topic to continue[/white]\n"
            "[white]• Press Ctrl+Q to quit[/white]",
            title="[bold cyan]🎉 All Done![/bold cyan]",
            border_style="green"
        )
        self.write(completion_panel)


class WorkflowModeSelect(Select):
    """工作流模式选择组件"""
    
    def __init__(self, **kwargs):
        self.options = [
            ("Basic Mode", "basic"),
            ("Interactive Mode", "interactive"),
            ("Advanced Mode", "advanced")
        ]
        super().__init__(self.options, value="basic", **kwargs)


class SearchInput(Input):
    """搜索输入框组件"""
    
    def __init__(self, **kwargs):
        super().__init__(
            placeholder="Type your research topic or @path/to/file",
            **kwargs
        )


class DeepSearchApp(App):
    """AgenticX Deep Search 主应用"""
    
    CSS = """
    Screen {
        background: $background;
    }
    
    .header {
        dock: top;
        height: 3;
        background: $primary;
        color: $text;
    }
    
    .footer {
        dock: bottom;
        height: 3;
        background: $primary;
        color: $text;
    }
    
    .main-container {
        height: 1fr;
        margin: 1;
    }
    
    .input-container {
        height: 5;
        margin: 1 0;
    }
    
    .search-input {
        border: round $accent;
        height: 3;
        margin: 0 1;
    }
    
    .mode-select {
        width: 20;
        margin: 0 1;
    }
    
    .search-button {
        width: 12;
        margin: 0 1;
        background: $accent;
    }
    
    .result-display {
        border: round $primary;
        height: 1fr;
        margin: 1 0;
        scrollbar-gutter: stable;
    }
    
    .status-bar {
        height: 1;
        background: $surface;
        color: $text;
        text-align: center;
    }
    """
    
    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+m", "toggle_mode", "Mode"),
        Binding("ctrl+c", "clear_screen", "Clear"),
        Binding("enter", "handle_enter", "Enter", show=False),
        Binding("escape", "cancel_confirmation", "Cancel", show=False),
    ]
    
    # 响应式状态
    current_mode = reactive("basic")
    is_searching = reactive(False)
    awaiting_confirmation = reactive(False)
    
    def __init__(self, config_path: str = "config.yaml", **kwargs):
        super().__init__(**kwargs)
        self.config_path = config_path
        self.config = {}
        self.workflow = None
        
    def compose(self) -> ComposeResult:
        """构建UI组件"""
        yield Header(show_clock=True)
        
        with Container(classes="main-container"):
            # 结果显示区域
            yield SearchResultDisplay(id="result_display", classes="result-display")
            
            # 状态栏
            yield Static("", id="status_bar", classes="status-bar")
            
            # 输入区域 - 移到底部
            with Container(classes="input-container"):
                with Horizontal():
                    yield SearchInput(id="search_input", classes="search-input")
                    yield WorkflowModeSelect(id="mode_select", classes="mode-select")
                    yield Button("● Search", id="search_button", classes="search-button")
        
        yield Footer()
    
    def on_mount(self) -> None:
        """应用启动时的初始化"""
        self.title = "DeepSearchApp"
        self.sub_title = "AgenticX Deep Search System"
        
        self.load_configuration()
        self.setup_workflow()
        
        # 显示欢迎信息 - 参考原main.py
        result_display = self.query_one("#result_display", SearchResultDisplay)
        result_display.add_welcome_message()
        
        # 设置焦点到输入框
        search_input = self.query_one("#search_input", SearchInput)
        search_input.focus()
        
        # 更新状态栏
        self.update_status("Ready - Enter your research topic")
    
    def load_configuration(self):
        """加载配置"""
        try:
            self.config = load_config(self.config_path)
            if 'deep_search' not in self.config:
                self.config['deep_search'] = {}
        except Exception as e:
            self.config = {'deep_search': {}}
            result_display = self.query_one("#result_display", SearchResultDisplay)
            result_display.add_error(f"Failed to load config: {e}")
    
    def setup_workflow(self):
        """设置工作流"""
        try:
            # 导入必要的模块
            from workflows.unified_research_workflow import WorkflowMode
            from agenticx.llms.kimi_provider import KimiProvider
            
            # 获取工作流模式
            mode_str = self.config.get('deep_search', {}).get('workflow_mode', 'basic')
            if mode_str == 'interactive':
                mode = WorkflowMode.INTERACTIVE
            elif mode_str == 'advanced':
                mode = WorkflowMode.ADVANCED
            else:
                mode = WorkflowMode.BASIC
            
            # 初始化LLM提供者
            llm_config = self.config.get('llm', {})
            
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
            
            # 获取API密钥
            api_key = resolved_config.get('api_key') or os.getenv('KIMI_API_KEY')
            if not api_key:
                api_key = os.getenv('OPENAI_API_KEY')  # 回退到OPENAI_API_KEY
            
            if not api_key:
                raise ValueError("No API key found. Please set KIMI_API_KEY or OPENAI_API_KEY environment variable.")
            
            # 创建KimiProvider
            kimi_config = {
                'model': resolved_config.get('model', 'kimi-k2-0711-preview'),
                'api_key': api_key,
                'base_url': resolved_config.get('base_url', 'https://api.moonshot.cn/v1'),
                'temperature': resolved_config.get('temperature', 0.7),
                'timeout': resolved_config.get('timeout', 30.0),
                'max_retries': resolved_config.get('max_retries', 3)
            }
            llm_provider = KimiProvider(**kimi_config)
            
            # 创建工作流
            self.workflow = UnifiedResearchWorkflow(
                llm_provider=llm_provider,
                mode=mode,
                config_path=self.config_path
            )
            
            self.update_status("Workflow initialized successfully")
            
        except Exception as e:
            result_display = self.query_one("#result_display", SearchResultDisplay)
            result_display.add_error(f"Failed to setup workflow: {e}")
            self.update_status(f"Workflow setup failed: {e}")
    
    def update_status(self, message: str):
        """更新状态栏"""
        status_bar = self.query_one("#status_bar", Static)
        status_bar.update(message)
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        """处理按钮点击"""
        if event.button.id == "search_button":
            self.start_search()
    
    def on_input_submitted(self, event: Input.Submitted) -> None:
        """处理输入框回车"""
        if event.input.id == "search_input":
            query = event.input.value.strip()
            if query.startswith('/'):
                self.handle_command(query)
            else:
                self.start_search()
    
    def on_select_changed(self, event: Select.Changed) -> None:
        """处理模式选择变化"""
        if event.select.id == "mode_select":
            self.current_mode = event.value
            self.config['deep_search']['workflow_mode'] = event.value
            self.update_status(f"Mode changed to: {event.value}")
            
            # 如果正在等待确认，重新显示确认界面
            if self.awaiting_confirmation and hasattr(self, 'pending_topic'):
                self.show_mode_confirmation(self.pending_topic)
    
    def action_toggle_mode(self) -> None:
        """切换工作流模式"""
        mode_select = self.query_one("#mode_select", WorkflowModeSelect)
        # 获取当前选中值对应的索引
        current_value = mode_select.value
        current_index = 0
        for i, (label, value) in enumerate(mode_select.options):
            if value == current_value:
                current_index = i
                break
        
        next_index = (current_index + 1) % len(mode_select.options)
        mode_select.value = mode_select.options[next_index][1]
        
        # 如果正在等待确认，重新显示确认界面
        if self.awaiting_confirmation and hasattr(self, 'pending_topic'):
            self.show_mode_confirmation(self.pending_topic)
    
    def action_clear_screen(self) -> None:
        """清空结果显示"""
        result_display = self.query_one("#result_display", SearchResultDisplay)
        result_display.clear()
        # 重新显示欢迎信息
        result_display.add_welcome_message()
        self.update_status("Screen cleared")
    
    def action_handle_enter(self) -> None:
        """处理回车键"""
        if self.awaiting_confirmation:
            self.confirm_and_start_search()
        else:
            self.start_search()
    
    def action_cancel_confirmation(self) -> None:
        """取消确认"""
        if self.awaiting_confirmation:
            self.awaiting_confirmation = False
            if hasattr(self, 'pending_topic'):
                delattr(self, 'pending_topic')
            self.update_status("Search cancelled. Enter a new research topic.")
            # 重新聚焦到输入框
            search_input = self.query_one("#search_input", SearchInput)
            search_input.focus()
    
    def handle_command(self, command: str) -> None:
        """处理命令"""
        search_input = self.query_one("#search_input", SearchInput)
        search_input.value = ""
        
        # 添加调试信息
        self.update_status(f"Processing command: {command}")
        
        if command in ['/mode', '/m']:
            self.action_toggle_mode()
            self.update_status("Mode toggled")
        elif command in ['/clear', '/c']:
            self.action_clear_screen()
        elif command in ['/help', '/h']:
            self.show_help()
        elif command in ['/exit', '/q']:
            self.exit()
        else:
            self.update_status(f"Unknown command: {command}")
    
    def show_help(self) -> None:
        """显示帮助信息"""
        result_display = self.query_one("#result_display", SearchResultDisplay)
        help_text = """
💡 Quick Commands:
/help or /h     Show help information
/clear or /c    Clear screen
/mode or /m     Select workflow mode
/exit or /q     Exit program

Directly input research topic to start deep search
        """
        result_display.write(help_text)
        self.update_status("Help displayed")
    
    def start_search(self) -> None:
        """开始搜索流程"""
        if self.is_searching:
            self.update_status("Search already in progress")
            return
        
        search_input = self.query_one("#search_input", SearchInput)
        topic = clean_input_text(search_input.value.strip())
        
        if not topic:
            self.update_status("Please enter a research topic")
            return
        
        # 清空输入框
        search_input.value = ""
        
        # 使用 InquirerPy 进行交互式模式选择
        self.run_worker(self.interactive_mode_selection(topic), exclusive=True)
    
    async def interactive_mode_selection(self, topic: str) -> None:
        """使用 InquirerPy 进行交互式模式选择"""
        try:
            # 暂时退出 Textual 应用进行交互式选择
            self.exit()
            
            # 使用 InquirerPy 进行模式选择
            from InquirerPy import inquirer
            from rich.console import Console
            from rich.panel import Panel
            import asyncio
            
            console = Console()
            console.print("\n[bold blue]● AgenticX 深度搜索系统[/bold blue]")
            console.print(f"[green]📝 研究主题: {topic}[/green]\n")
            
            mode_choices = [
                {"name": "🚀 Basic Mode - 基础模式：快速搜索和总结", "value": "basic"},
                {"name": "● Interactive Mode - 交互模式：深度分析和多轮对话", "value": "interactive"},
                {"name": "⚡ Advanced Mode - 高级模式：全面研究和详细报告", "value": "advanced"}
            ]
            
            selected_mode = inquirer.select(
                message="请选择工作流模式 (使用上下键选择，回车确认):",
                choices=mode_choices,
                default=self.current_mode
            ).execute()
            
            # 确认选择
            confirm = inquirer.confirm(
                message=f"确认开始研究 '{topic}' 使用 {selected_mode} 模式?",
                default=True
            ).execute()
            
            if confirm:
                console.print(f"\n[green]✅ 已选择模式: {selected_mode}[/green]")
                console.print("[yellow]🔄 正在启动搜索工作流[/yellow]\n")
                
                # 更新配置
                self.current_mode = selected_mode
                self.config['deep_search']['workflow_mode'] = selected_mode
                
                # 重新设置工作流
                self.setup_workflow()
                
                # 执行搜索
                if self.workflow:
                    result = await asyncio.to_thread(
                        self.workflow.execute,
                        topic
                    )
                    
                    # 显示结果
                    console.print("[bold green]🎉 搜索完成！[/bold green]")
                    if isinstance(result, dict) and 'final_report' in result:
                        report = result['final_report']
                        if isinstance(report, str):
                            console.print(Panel(
                                report,
                                title="[bold green]📊 Research Report[/bold green]",
                                border_style="green"
                            ))
                        else:
                            console.print(f"Result: {result}")
                    else:
                        console.print(f"Result: {result}")
                else:
                    console.print("[red]❌ 工作流初始化失败[/red]")
            else:
                console.print("\n[yellow]⚠️ 用户取消操作[/yellow]")
                
        except KeyboardInterrupt:
            console.print("\n[yellow]⚠️ 用户中断操作[/yellow]")
        except Exception as e:
            console.print(f"\n[red]❌ 错误: {str(e)}[/red]")
        finally:
            console.print("\n[dim]按任意键退出[/dim]")
            input()
    
    def confirm_and_start_search(self) -> None:
        """确认并开始搜索"""
        if hasattr(self, 'pending_topic') and self.awaiting_confirmation:
            topic = self.pending_topic
            self.awaiting_confirmation = False
            delattr(self, 'pending_topic')
            
            # 开始异步搜索
            self.run_worker(self.perform_search(topic), exclusive=True)
        else:
            self.update_status("No pending search to confirm")
    
    async def perform_search(self, topic: str) -> None:
        """执行搜索任务"""
        self.is_searching = True
        result_display = self.query_one("#result_display", SearchResultDisplay)
        
        try:
            # 显示搜索开始信息
            mode_names = {
                "basic": "Basic Mode",
                "interactive": "Interactive Mode", 
                "advanced": "Advanced Mode"
            }
            mode_name = mode_names.get(self.current_mode, "Basic Mode")
            result_display.add_search_start(topic, mode_name)
            
            self.update_status(f"Searching: {topic}")
            
            # 更新配置
            self.config['deep_search']['workflow_mode'] = self.current_mode
            
            # 执行搜索
            if self.workflow:
                # 添加进度更新
                result_display.add_progress_update("Initializing search workflow")
                
                # 执行工作流
                result = await asyncio.to_thread(
                    self.workflow.execute,
                    topic
                )
                
                # 显示结果
                result_display.add_result(result)
                result_display.add_completion()
                
                self.update_status("Search completed successfully")
            else:
                result_display.add_error("Workflow not initialized")
                self.update_status("Search failed - workflow error")
                
        except Exception as e:
            result_display.add_error(f"Search failed: {str(e)}")
            self.update_status(f"Search failed: {str(e)}")
        
        finally:
            self.is_searching = False
            # 重新聚焦到输入框
            search_input = self.query_one("#search_input", SearchInput)
            search_input.focus()


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='AgenticX Deep Search System - Textual UI')
    parser.add_argument('--config', '-c', default='config.yaml', help='配置文件路径')
    parser.add_argument('--mode', choices=['basic', 'interactive', 'advanced'], 
                       default='basic', help='工作流模式')
    
    args = parser.parse_args()
    
    # 创建并运行应用
    app = DeepSearchApp(config_path=args.config)
    app.run()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nGoodbye!")
    except Exception as e:
        print(f"System error: {e}")
        sys.exit(1)