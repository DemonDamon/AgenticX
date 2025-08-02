#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AgenticX Deep Search System - 交互式界面版本
重新设计的交互流程：先选择模式，再输入研究问题
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import Dict, Any, Optional
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.markdown import Markdown
from rich.prompt import Prompt, Confirm
from rich.table import Table
from rich import print as rprint
from rich.align import Align

# 导入现有的工作流和配置
from workflows.unified_research_workflow import UnifiedResearchWorkflow
from utils import load_config, clean_input_text


class InteractiveSearchApp:
    """交互式 AgenticX Deep Search 应用"""
    
    def __init__(self):
        self.console = Console()
        self.config = load_config()
        self.workflow = None
        self.current_mode = None
        self.modes = {
            "1": {"key": "basic", "name": "基础模式", "desc": "快速概览和基本信息收集"},
            "2": {"key": "interactive", "name": "交互模式", "desc": "深入分析和多轮对话"},
            "3": {"key": "advanced", "name": "高级模式", "desc": "全面研究和详细报告"}
        }
        self.is_running = True
        
    def init_workflow(self):
        """初始化工作流"""
        try:
            self.workflow = UnifiedResearchWorkflow(self.config)
            self.console.print("[green]✓ 工作流初始化成功[/green]")
            return True
        except Exception as e:
            self.console.print(f"[red]✗ 工作流初始化失败: {e}[/red]")
            return False
    
    def show_welcome(self):
        """显示欢迎信息"""
        self.console.clear()
        
        welcome_text = Text()
        welcome_text.append("🚀 AgenticX Deep Search System\n", style="bold #ff6b35")
        welcome_text.append("智能研究助手 - 交互式版本\n\n", style="white")
        welcome_text.append("让我们开始您的研究之旅！", style="bold cyan")
        
        welcome_panel = Panel(
            Align.center(welcome_text),
            title="[bold cyan]欢迎使用[/bold cyan]",
            border_style="#ff6b35",
            padding=(2, 4)
        )
        self.console.print(welcome_panel)
        self.console.print()
    
    def show_mode_selection(self):
        """显示模式选择界面"""
        mode_table = Table(show_header=True, header_style="bold cyan", box=None)
        mode_table.add_column("选项", style="bold yellow", width=6)
        mode_table.add_column("模式名称", style="bold white", width=15)
        mode_table.add_column("说明", style="dim white")
        
        for key, mode_info in self.modes.items():
            mode_table.add_row(
                f"[{key}]",
                mode_info["name"],
                mode_info["desc"]
            )
        
        mode_panel = Panel(
            mode_table,
            title="[bold blue]🎯 请选择研究模式[/bold blue]",
            border_style="blue",
            padding=(1, 2)
        )
        self.console.print(mode_panel)
        self.console.print()
    
    def select_mode(self):
        """模式选择流程"""
        while True:
            self.show_mode_selection()
            
            choice = Prompt.ask(
                "[bold cyan]请输入您的选择[/bold cyan]",
                choices=["1", "2", "3", "q"],
                default="1",
                console=self.console
            )
            
            if choice == "q":
                self.console.print("[yellow]👋 感谢使用 AgenticX Deep Search![/yellow]")
                return False
            
            if choice in self.modes:
                self.current_mode = self.modes[choice]["key"]
                mode_name = self.modes[choice]["name"]
                
                # 显示选择确认
                confirm_panel = Panel(
                    f"[bold green]✓ 已选择: {mode_name}[/bold green]\n\n"
                    f"[white]{self.modes[choice]['desc']}[/white]",
                    title="[bold green]模式确认[/bold green]",
                    border_style="green"
                )
                self.console.print(confirm_panel)
                self.console.print()
                return True
    
    def get_research_topic(self):
        """获取研究主题"""
        topic_panel = Panel(
            "[bold yellow]💡 请输入您想要研究的主题[/bold yellow]\n\n"
            "[white]• 可以是任何您感兴趣的话题[/white]\n"
            "[white]• 使用 @文件路径 可以包含特定文件[/white]\n"
            "[white]• 输入 'back' 返回模式选择[/white]\n"
            "[white]• 输入 'quit' 退出程序[/white]",
            title="[bold blue]● 研究主题[/bold blue]",
            border_style="blue",
            padding=(1, 2)
        )
        self.console.print(topic_panel)
        
        while True:
            # 获取当前模式名称
            current_mode_name = next(m['name'] for m in self.modes.values() if m['key'] == self.current_mode)
            
            topic = Prompt.ask(
                f"[bold cyan][{current_mode_name}] 研究主题[/bold cyan]",
                console=self.console
            ).strip()
            
            if not topic:
                self.console.print("[red]请输入有效的研究主题[/red]")
                continue
            
            if topic.lower() == 'quit':
                return None, False
            
            if topic.lower() == 'back':
                return None, True
            
            # 确认研究主题
            mode_name = next(m['name'] for m in self.modes.values() if m['key'] == self.current_mode)
            
            confirm_text = f"[bold white]研究主题:[/bold white] {topic}\n"
            confirm_text += f"[bold white]研究模式:[/bold white] {mode_name}\n\n"
            confirm_text += "[dim]确认开始研究吗？[/dim]"
            
            confirm_panel = Panel(
                confirm_text,
                title="[bold yellow]🚀 确认研究[/bold yellow]",
                border_style="yellow"
            )
            self.console.print(confirm_panel)
            
            if Confirm.ask("[bold green]开始研究[/bold green]", default=True, console=self.console):
                return topic, True
            else:
                self.console.print("[dim]请重新输入研究主题[/dim]\n")
    
    async def perform_search(self, topic: str):
        """执行搜索"""
        mode_name = next(m['name'] for m in self.modes.values() if m['key'] == self.current_mode)
        
        # 显示搜索开始信息
        start_panel = Panel(
            f"[bold green]🚀 开始研究[/bold green]\n\n"
            f"[white]主题:[/white] [bold]{topic}[/bold]\n"
            f"[white]模式:[/white] [bold]{mode_name}[/bold]\n\n"
            f"[dim]正在为您收集和分析相关信息[/dim]",
            title="[bold blue]研究进行中[/bold blue]",
            border_style="green"
        )
        self.console.print(start_panel)
        
        try:
            if not self.workflow:
                if not self.init_workflow():
                    return False
            
            # 显示进度
            with self.console.status("[bold green]正在深度分析", spinner="dots"):
                # 执行搜索
                result = await asyncio.to_thread(
                    self.workflow.run,
                    topic,
                    mode=self.current_mode
                )
            
            # 显示结果
            if isinstance(result, dict) and 'final_report' in result:
                report = result['final_report']
                if isinstance(report, str):
                    markdown = Markdown(report)
                    result_panel = Panel(
                        markdown,
                        title="[bold green]📊 研究报告[/bold green]",
                        border_style="green",
                        padding=(1, 2)
                    )
                    self.console.print(result_panel)
                else:
                    self.console.print(f"[yellow]结果: {result}[/yellow]")
            else:
                self.console.print(f"[yellow]结果: {result}[/yellow]")
            
            # 显示完成信息和选项
            completion_panel = Panel(
                "[bold green]✨ 研究完成![/bold green]\n\n"
                "[white]接下来您可以:[/white]\n"
                "[white]• 输入 'new' 开始新的研究[/white]\n"
                "[white]• 输入 'mode' 重新选择模式[/white]\n"
                "[white]• 输入 'quit' 退出程序[/white]",
                title="[bold cyan]🎉 研究完成![/bold cyan]",
                border_style="green"
            )
            self.console.print(completion_panel)
            
            return True
            
        except Exception as e:
            error_panel = Panel(
                f"[bold red]❌ 研究过程中发生错误[/bold red]\n\n{str(e)}\n\n"
                f"[dim]请检查网络连接或稍后重试[/dim]",
                title="[bold red]错误[/bold red]",
                border_style="red"
            )
            self.console.print(error_panel)
            return False
    
    def handle_post_search_action(self):
        """处理搜索后的用户操作"""
        while True:
            action = Prompt.ask(
                "[bold cyan]请选择下一步操作[/bold cyan]",
                choices=["new", "mode", "quit"],
                default="new",
                console=self.console
            )
            
            if action == "quit":
                return False
            elif action == "mode":
                return "mode"
            elif action == "new":
                return "new"
    
    async def run(self):
        """运行主循环"""
        # 显示欢迎信息
        self.show_welcome()
        
        # 初始化工作流
        if not self.init_workflow():
            self.console.print("[red]初始化失败，程序退出[/red]")
            return
        
        # 主循环
        while self.is_running:
            try:
                # 步骤1: 选择模式
                if not self.select_mode():
                    break
                
                # 步骤2: 获取研究主题并执行搜索
                while True:
                    topic, continue_flag = self.get_research_topic()
                    
                    if not continue_flag:  # 用户选择退出
                        self.is_running = False
                        break
                    
                    if topic is None:  # 用户选择返回模式选择
                        break
                    
                    # 执行搜索
                    search_success = await self.perform_search(topic)
                    
                    if search_success:
                        # 处理搜索后的操作
                        next_action = self.handle_post_search_action()
                        
                        if next_action == False:  # 退出
                            self.is_running = False
                            break
                        elif next_action == "mode":  # 重新选择模式
                            break
                        elif next_action == "new":  # 继续当前模式下的新研究
                            continue
                    else:
                        # 搜索失败，询问是否重试
                        if not Confirm.ask("[yellow]是否重试？[/yellow]", default=True, console=self.console):
                            break
                
            except KeyboardInterrupt:
                self.console.print("\n[yellow]👋 感谢使用 AgenticX Deep Search![/yellow]")
                break
            except EOFError:
                break
            except Exception as e:
                self.console.print(f"[red]✗ 发生错误: {e}[/red]")
                if not Confirm.ask("[yellow]是否继续？[/yellow]", default=True, console=self.console):
                    break
        
        self.console.print("\n[bold cyan]感谢使用 AgenticX Deep Search System![/bold cyan]")


def main():
    """主函数"""
    app = InteractiveSearchApp()
    asyncio.run(app.run())


if __name__ == "__main__":
    main()