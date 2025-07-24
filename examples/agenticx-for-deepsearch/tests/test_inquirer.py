#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 InquirerPy 交互功能
"""

import asyncio
from InquirerPy import inquirer
from rich.console import Console
from rich.panel import Panel

def test_inquirer_interaction():
    """测试 InquirerPy 交互"""
    console = Console()
    
    try:
        console.print("[bold blue]欢迎使用 AgenticX 深度搜索系统！[/bold blue]")
        
        # 获取研究主题
        topic = inquirer.text(
            message="请输入你的研究主题:",
            validate=lambda x: len(x.strip()) > 0 or "请输入有效的研究主题"
        ).execute()
        
        # 模式选择
        mode_choices = [
            {"name": "🚀 Basic Mode - 基础模式：快速搜索和总结", "value": "basic"},
            {"name": "● Interactive Mode - 交互模式：深度分析和多轮对话", "value": "interactive"},
            {"name": "⚡ Advanced Mode - 高级模式：全面研究和详细报告", "value": "advanced"}
        ]
        
        selected_mode = inquirer.select(
            message="请选择工作流模式 (使用上下键选择，回车确认):",
            choices=mode_choices,
            default="basic"
        ).execute()
        
        # 确认选择
        confirm = inquirer.confirm(
            message=f"确认开始研究 '{topic}' 使用 {selected_mode} 模式?",
            default=True
        ).execute()
        
        if confirm:
            console.print(f"[green]✅ 已选择模式: {selected_mode}[/green]")
            console.print(f"[green]📝 研究主题: {topic}[/green]")
            console.print("[yellow]🔄 正在启动搜索工作流...[/yellow]")
            
            # 模拟搜索过程
            import time
            for i in range(3):
                console.print(f"[dim]⏳ 搜索进度: {(i+1)*33}%[/dim]")
                time.sleep(1)
            
            # 显示模拟结果
            result_panel = Panel(
                f"关于 '{topic}' 的研究报告\n\n"
                f"模式: {selected_mode}\n"
                f"状态: 搜索完成\n\n"
                f"这是一个模拟的搜索结果。在实际应用中，这里会显示详细的研究报告。",
                title="[bold green]📊 Research Report[/bold green]",
                border_style="green"
            )
            console.print(result_panel)
            
        else:
            console.print("[yellow]⚠️ 用户取消操作[/yellow]")
            
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️ 用户中断操作[/yellow]")
    except Exception as e:
        console.print(f"[red]❌ 错误: {str(e)}[/red]")
    finally:
        console.print("\n[dim]测试完成，按任意键退出...[/dim]")
        input()

if __name__ == '__main__':
    test_inquirer_interaction()