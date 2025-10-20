#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AgenticX 文档解析器 Demo

基于AgenticX框架和MinerU工具的单智能体文档解析演示程序。
支持解析PDF、Word、PPT等多种文档格式，提供友好的交互界面。
"""

import os
import sys
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, Optional

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# 导入必要的模块
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Prompt, Confirm
from rich.markdown import Markdown
from dotenv import load_dotenv

# 导入AgenticX核心模块
from agenticx.core.agent import Agent
from agenticx.llms.base import BaseLLMProvider

# 导入AgenticX MinerU工具
from agenticx.tools.mineru import (
    ParseDocumentsTool,
    GetOCRLanguagesTool,
    MinerUParseArgs,
    MinerUOCRLanguagesArgs,
    ParseMode
)

# 导入本地模块
from agents.document_parser import DocumentParserAgent

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('docparser.log'),
        logging.StreamHandler()
    ]
)

# 隐藏第三方库的详细日志
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logging.getLogger('requests').setLevel(logging.WARNING)
logging.getLogger('aiohttp').setLevel(logging.WARNING)
logging.getLogger('litellm').setLevel(logging.WARNING)
logging.getLogger('openai').setLevel(logging.WARNING)
logging.getLogger('anthropic').setLevel(logging.WARNING)
logging.getLogger('dashscope').setLevel(logging.WARNING)
logging.getLogger('agenticx.llms').setLevel(logging.WARNING)
logging.getLogger('agenticx.tools.adapters').setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# 创建控制台对象
console = Console()


class DocumentParserDemo:
    """文档解析器演示应用"""
    
    def __init__(self, config_path: str = "config.yaml"):
        """初始化演示应用"""
        # 加载环境变量
        load_dotenv()
        
        # 加载配置
        self.config = self._load_config(config_path)
        
        # 初始化组件
        self._initialize_components()
        
        logger.info("DocumentParserDemo 初始化完成")
    
    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """加载配置文件"""
        try:
            config_file = Path(config_path)
            if not config_file.exists():
                raise FileNotFoundError(f"配置文件不存在: {config_path}")
            
            with open(config_file, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            # 递归替换配置中的环境变量占位符
            config = self._replace_env_variables(config)
            
            logger.info(f"配置文件加载成功: {config_path}")
            return config
            
        except Exception as e:
            logger.error(f"配置文件加载失败: {e}")
            raise
    
    def _replace_env_variables(self, obj: Any) -> Any:
        """递归替换配置中的环境变量占位符"""
        import re
        
        if isinstance(obj, dict):
            return {key: self._replace_env_variables(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [self._replace_env_variables(item) for item in obj]
        elif isinstance(obj, str):
            # 匹配 ${VAR_NAME} 格式的环境变量占位符
            pattern = r'\$\{([^}]+)\}'
            
            def replace_var(match):
                var_name = match.group(1)
                env_value = os.getenv(var_name)
                
                if env_value is not None:
                    logger.debug(f"替换环境变量 ${{{var_name}}} -> {env_value[:10]}...")
                    return env_value
                else:
                    logger.warning(f"环境变量 {var_name} 未设置，保持原始值")
                    return match.group(0)  # 保持原始占位符
            
            return re.sub(pattern, replace_var, obj)
        else:
            return obj
    
    def _initialize_components(self):
        """初始化组件"""
        try:
            # 获取配置
            mineru_config = self.config.get("mineru", {})
            
            # 显示MinerU服务状态
            self._display_mineru_status(mineru_config)
            
            # 初始化MinerU工具
            self.parse_tool = ParseDocumentsTool(mineru_config)
            self.ocr_languages_tool = GetOCRLanguagesTool(mineru_config)
            
            # 初始化智能体
            self.agent = DocumentParserAgent(self.config)
            
            logger.info("组件初始化完成")
            
        except Exception as e:
            logger.error(f"组件初始化失败: {e}")
            raise
    
    def _display_mineru_status(self, mineru_config: Dict[str, Any]):
        """显示MinerU服务状态"""
        default_mode = mineru_config.get("default_mode", "remote_api")
        api_config = mineru_config.get("api", {})
        mcp_config = mineru_config.get("mcp", {})
        
        status_table = Table(title="🔧 MinerU 服务状态", show_header=True, header_style="bold magenta")
        status_table.add_column("配置项", style="cyan", no_wrap=True)
        status_table.add_column("值", style="green")
        status_table.add_column("状态", style="yellow")
        
        # 显示解析模式
        mode_display = {
            "local": "本地解析",
            "remote_api": "远程API服务",
            "remote_mcp": "远程MCP服务"
        }
        status_table.add_row(
            "解析模式",
            mode_display.get(default_mode, default_mode),
            "✅ 已配置" if default_mode else "❌ 未配置"
        )
        
        # 如果是远程API模式，显示API配置
        if default_mode == "remote_api":
            api_base = api_config.get("base", "")
            api_token = os.getenv("MINERU_API_KEY", "")
            
            status_table.add_row(
                "API 端点",
                api_base if api_base else "未配置",
                "✅ 已配置" if api_base else "❌ 未配置"
            )
            
            status_table.add_row(
                "API 密钥",
                "已设置" if api_token else "未设置",
                "✅ 已配置" if api_token else "❌ 未配置"
            )
            
            if api_base and api_token:
                status_table.add_row(
                    "服务状态",
                    "使用官方远程API服务",
                    "🌐 在线"
                )
            else:
                status_table.add_row(
                    "服务状态",
                    "配置不完整",
                    "⚠️ 警告"
                )
        
        # 如果是远程MCP模式，显示MCP配置
        elif default_mode == "remote_mcp":
            server_config = mcp_config.get("server", {})
            command = server_config.get("command", "")
            args = server_config.get("args", [])
            env_config = server_config.get("env", {})
            api_token = os.getenv("MINERU_API_KEY", "")
            
            # 显示MCP服务器命令
            mcp_command = f"{command} {' '.join(args)}" if command and args else "未配置"
            status_table.add_row(
                "MCP 服务器",
                mcp_command,
                "✅ 已配置" if command and args else "❌ 未配置"
            )
            
            # 显示API端点
            api_base = env_config.get("MINERU_API_BASE", "")
            status_table.add_row(
                "API 端点",
                api_base if api_base else "未配置",
                "✅ 已配置" if api_base else "❌ 未配置"
            )
            
            # 显示API密钥
            status_table.add_row(
                "API 密钥",
                "已设置" if api_token else "未设置",
                "✅ 已配置" if api_token else "❌ 未配置"
            )
            
            # 显示输出目录
            output_dir = env_config.get("OUTPUT_DIR", "")
            status_table.add_row(
                "输出目录",
                output_dir if output_dir else "未配置",
                "✅ 已配置" if output_dir else "❌ 未配置"
            )
            
            # 显示服务状态
            if command and args and api_base and api_token:
                status_table.add_row(
                    "服务状态",
                    "使用MCP协议连接远程服务",
                    "🔗 MCP"
                )
            else:
                status_table.add_row(
                    "服务状态",
                    "配置不完整",
                    "⚠️ 警告"
                )
        
        # 如果是本地模式，显示本地配置
        elif default_mode == "local":
            local_config = mineru_config.get("local", {})
            backend = local_config.get("backend", "")
            device = local_config.get("device", "")
            
            status_table.add_row(
                "后端引擎",
                backend if backend else "未配置",
                "✅ 已配置" if backend else "❌ 未配置"
            )
            
            status_table.add_row(
                "计算设备",
                device if device else "未配置",
                "✅ 已配置" if device else "❌ 未配置"
            )
            
            if backend and device:
                status_table.add_row(
                    "服务状态",
                    "使用本地解析引擎",
                    "💻 本地"
                )
            else:
                status_table.add_row(
                    "服务状态",
                    "配置不完整",
                    "⚠️ 警告"
                )
        
        console.print(status_table)
        console.print()
    
    def print_welcome(self):
        """打印欢迎信息"""
        welcome_text = Text()
        welcome_text.append("🤖 AgenticX 文档解析器 Demo\n", style="bold blue")
        welcome_text.append("基于 MinerU 的智能文档解析助手\n", style="cyan")
        welcome_text.append("支持 PDF、Word、PPT 多种格式", style="green")
        
        panel = Panel(
            welcome_text,
            title="欢迎使用",
            border_style="blue",
            padding=(1, 2)
        )
        console.print(panel)
    
    def print_menu(self):
        """打印主菜单"""
        table = Table(title="功能菜单", show_header=True, header_style="bold magenta")
        table.add_column("选项", style="cyan", width=8)
        table.add_column("功能", style="green")
        table.add_column("描述", style="yellow")
        
        table.add_row("1", "解析单个文档", "解析指定的PDF、Word或PPT文档")
        table.add_row("2", "解析示例PDF", "解析内置的example.pdf文件")
        table.add_row("3", "查看支持语言", "查看OCR支持的语言列表")
        table.add_row("4", "智能体对话", "与文档解析智能体进行对话")
        table.add_row("0", "退出程序", "退出文档解析器")
        
        console.print(table)
    
    async def parse_single_document(self):
        """解析单个文档"""
        try:
            # 获取文件路径
            file_path = Prompt.ask("请输入文档文件路径")
            
            if not file_path or not Path(file_path).exists():
                console.print("❌ 文件不存在，请检查路径", style="red")
                return
            
            # 获取解析选项
            console.print("\n📋 解析选项配置:")
            
            # 解析模式
            mode_options = ["local", "remote_api", "remote_mcp"]
            mode = Prompt.ask(
                "选择解析模式",
                choices=mode_options,
                default="remote_api"
            )
            
            # OCR语言
            language = Prompt.ask(
                "OCR语言 (auto/zh/en等)",
                default="auto"
            )
            
            # 其他选项
            enable_formula = Confirm.ask("启用公式识别?", default=True)
            enable_table = Confirm.ask("启用表格识别?", default=True)
            
            # 页码范围（可选）
            page_ranges = Prompt.ask(
                "页码范围 (如: 1-5,10-15，留空表示全部)",
                default=""
            )
            
            # 构建解析参数
            parse_args = MinerUParseArgs(
                file_sources=[file_path],
                mode=ParseMode(mode),
                language=language,
                enable_formula=enable_formula,
                enable_table=enable_table,
                page_ranges=page_ranges if page_ranges else None
            )
            
            # 根据模式添加相应配置
            if mode == "remote_api":
                mineru_config = self.config.get("mineru", {})
                api_config = mineru_config.get("api", {})
                
                api_base = api_config.get("base")
                api_token = os.getenv("MINERU_API_KEY")
                
                if not api_base:
                    console.print("❌ 配置中缺少 API base URL", style="red")
                    return
                    
                if not api_token:
                    console.print("❌ 环境变量中缺少 MINERU_API_KEY", style="red")
                    return
                
                parse_args.api_base = api_base
                parse_args.api_token = api_token
                
                console.print(f"🌐 使用远程 API 服务: {api_base}", style="blue")
                
            elif mode == "remote_mcp":
                mineru_config = self.config.get("mineru", {})
                mcp_config = mineru_config.get("mcp", {})
                
                api_token = os.getenv("MINERU_API_KEY")
                
                if not mcp_config:
                    console.print("❌ 配置中缺少 MCP 配置", style="red")
                    return
                    
                if not api_token:
                    console.print("❌ 环境变量中缺少 MINERU_API_KEY", style="red")
                    return
                
                # MCP模式下，配置信息会从配置文件中读取
                console.print("🔗 使用远程 MCP 服务", style="blue")
            
            # 开始解析
            console.print(f"\n🚀 开始解析文档: {file_path}")
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console
            ) as progress:
                if mode == "remote_api":
                    # 远程API模式的详细状态显示
                    task = progress.add_task("📤 提交解析任务到远程API...", total=None)
                    
                    result = await self.parse_tool.parse(parse_args)
                    
                    progress.update(task, description="✅ 解析完成")
                    progress.update(task, completed=True)
                    
                    # 显示远程API处理信息
                    if result.get("success"):
                        console.print("🌐 远程API处理成功", style="green")
                        if "task_id" in result:
                            console.print(f"📋 任务ID: {result['task_id']}", style="cyan")
                        if "output_dir" in result:
                            console.print(f"📁 输出目录: {result['output_dir']}", style="cyan")
                            
                elif mode == "remote_mcp":
                    # 远程MCP模式的详细状态显示
                    task = progress.add_task("🔗 启动MCP服务器连接...", total=None)
                    
                    progress.update(task, description="📤 通过MCP协议提交解析任务...")
                    
                    result = await self.parse_tool.parse(parse_args)
                    
                    progress.update(task, description="✅ MCP解析完成")
                    progress.update(task, completed=True)
                    
                    # 显示MCP处理信息
                    if result.get("success"):
                        console.print("🔗 MCP协议处理成功", style="green")
                        if "output_dir" in result:
                            console.print(f"📁 输出目录: {result['output_dir']}", style="cyan")
                        if "artifacts" in result:
                            console.print(f"📄 解析文件数: {len(result['artifacts'])}", style="cyan")
                            
                else:
                    # 本地模式
                    task = progress.add_task("🔧 本地解析处理中...", total=None)
                    
                    result = await self.parse_tool.parse(parse_args)
                    
                    progress.update(task, completed=True)
            
            # 显示结果
            self._display_parse_result(result)
            
        except Exception as e:
            console.print(f"❌ 解析过程中发生错误: {e}", style="red")
            logger.error(f"解析单个文档失败: {e}")
    
    async def parse_example_pdf(self):
        """解析示例PDF文件"""
        example_pdf = Path(__file__).parent / "example.pdf"
        
        if not example_pdf.exists():
            console.print("❌ 示例PDF文件不存在", style="red")
            return
        
        console.print(f"📄 解析示例文件: {example_pdf.name}")
        
        # 获取默认解析模式
        mineru_config = self.config.get("mineru", {})
        default_mode = mineru_config.get("default_mode", "local")
        
        # 构建解析参数 - 无论什么模式都使用本地的 DINOv3 license.pdf 文件
        parse_args = MinerUParseArgs(
            file_sources=[str(example_pdf)],
            mode=ParseMode(default_mode),
            language="auto",
            enable_formula=True,
            enable_table=True
        )
        
        # 如果是远程API模式，需要配置API参数
        if default_mode == "remote_api":
            api_config = mineru_config.get("api", {})
            
            api_base = api_config.get("base")
            api_token = os.getenv("MINERU_API_KEY")
            
            if not api_base:
                console.print("❌ 配置中缺少 API base URL", style="red")
                return
                
            if not api_token:
                console.print("❌ 环境变量中缺少 MINERU_API_KEY", style="red")
                return
            
            console.print(f"🌐 使用远程 API 服务: {api_base}", style="blue")
            console.print(f"📄 解析本地文件: {example_pdf.name}", style="yellow")
            
            # 设置API配置
            parse_args.api_base = api_base
            parse_args.api_token = api_token
        else:
            console.print(f"🏠 使用本地模式解析: {example_pdf.name}", style="blue")
        
        # 使用默认配置解析
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("正在解析示例PDF...", total=None)
            
            result = await self.parse_tool.parse(parse_args)
            
            progress.update(task, completed=True)
        
        # 显示结果
        self._display_parse_result(result)
    
    async def show_supported_languages(self):
        """显示支持的OCR语言"""
        try:
            console.print("🌐 获取支持的OCR语言列表...")
            
            # 构建查询参数
            lang_args = MinerUOCRLanguagesArgs(mode=ParseMode.LOCAL)
            
            result = await self.ocr_languages_tool.get_languages(lang_args)
            
            if result.get("success", False):
                languages = result.get("languages", [])
                
                if languages:
                    table = Table(title="支持的OCR语言", show_header=True)
                    table.add_column("语言代码", style="cyan")
                    table.add_column("语言名称", style="green")
                    table.add_column("描述", style="yellow")
                    
                    for lang in languages:
                        # 处理两种数据格式：字典格式和字符串格式
                        if isinstance(lang, dict):
                            # 新格式：字典包含 code, name, description
                            code = lang.get("code", "unknown")
                            name = lang.get("name", "未知语言")
                            description = lang.get("description", "")
                            table.add_row(code, name, description)
                        else:
                            # 旧格式：简单字符串
                            # 语言代码映射（向后兼容）
                            lang_map = {
                                "auto": "自动检测",
                                "zh": "中文",
                                "en": "英文",
                                "ja": "日文",
                                "ko": "韩文",
                                "fr": "法文",
                                "de": "德文",
                                "es": "西班牙文",
                                "ru": "俄文"
                            }
                            description = lang_map.get(lang, "其他语言")
                            table.add_row(lang, description, "")
                    
                    console.print(table)
                else:
                    console.print("❌ 没有获取到语言列表", style="red")
            else:
                console.print(f"❌ 获取语言列表失败: {result.get('error', '未知错误')}", style="red")
                
        except Exception as e:
            console.print(f"❌ 获取语言列表失败: {e}", style="red")
            logger.error(f"获取支持语言失败: {e}")
    
    async def chat_with_agent(self):
        """与智能体对话"""
        try:
            console.print("💬 进入智能体对话模式")
            console.print("您可以询问关于文档解析的任何问题，输入 'quit' 退出对话\n")
            
            while True:
                # 获取用户输入
                user_input = Prompt.ask("您")
                
                if user_input.lower() in ['quit', 'exit', '退出']:
                    console.print("👋 退出对话模式")
                    break
                
                # 智能体流式处理请求
                console.print("🤖 智能体: ", end="")
                
                try:
                    # 检查是否有流式方法
                    if hasattr(self.agent, 'process_document_request_stream'):
                        async for chunk in self.agent.process_document_request_stream(user_input):
                            console.print(chunk, end="", style="green")
                    else:
                        # 回退到非流式方法
                        response = await self.agent.process_document_request(user_input)
                        console.print(response, style="green")
                except Exception as e:
                    logger.error(f"流式处理失败，回退到非流式: {e}")
                    response = await self.agent.process_document_request(user_input)
                    console.print(response, style="green")
                
                console.print("\n")  # 换行
                
        except Exception as e:
            console.print(f"❌ 对话过程中发生错误: {e}", style="red")
            logger.error(f"智能体对话失败: {e}")
    
    def _display_parse_result(self, result: Dict[str, Any]):
        """显示解析结果"""
        if result.get("success", False):
            # 成功结果
            console.print("✅ 文档解析成功!", style="green bold")
            
            # 创建结果表格
            table = Table(title="解析结果", show_header=True)
            table.add_column("项目", style="cyan")
            table.add_column("值", style="green")
            
            table.add_row("任务ID", result.get("task_id", ""))
            table.add_row("解析模式", result.get("mode", ""))
            table.add_row("输出目录", result.get("output_dir", ""))
            
            processing_time = result.get("processing_time", 0)
            if processing_time > 0:
                table.add_row("处理时间", f"{processing_time:.2f}秒")
            
            console.print(table)
            
            # 显示生成的文件
            artifacts = result.get("artifacts", {})
            if artifacts:
                console.print("\n📄 生成的文件:")
                
                # 检查 artifacts 的类型并正确处理
                if hasattr(artifacts, 'artifacts'):
                    # 如果是 ArtifactIndex 对象，访问其 artifacts 属性
                    artifacts_dict = artifacts.artifacts
                elif isinstance(artifacts, dict):
                    # 如果是字典，直接使用
                    artifacts_dict = artifacts
                else:
                    # 其他情况，尝试转换为字符串显示
                    console.print(f"  • 未知格式的 artifacts: {str(artifacts)}")
                    artifacts_dict = {}
                
                # 遍历并显示文件
                for artifact_type, artifact_info in artifacts_dict.items():
                    if isinstance(artifact_info, dict):
                        artifact_path = artifact_info.get("path", "")
                    else:
                        artifact_path = str(artifact_info)
                    console.print(f"  • {artifact_type}: {artifact_path}")
            
            # 显示元数据
            metadata = result.get("metadata", {})
            if metadata:
                console.print("\n📊 文档元数据:")
                for key, value in metadata.items():
                    console.print(f"  • {key}: {value}")
        
        else:
            # 失败结果
            console.print("❌ 文档解析失败!", style="red bold")
            console.print(f"错误信息: {result.get('error', '未知错误')}", style="red")
            
            details = result.get("details", {})
            if details:
                console.print("详细信息:", style="yellow")
                for key, value in details.items():
                    console.print(f"  • {key}: {value}")
    
    async def run(self):
        """运行演示应用"""
        try:
            # 打印欢迎信息
            self.print_welcome()
            
            while True:
                # 打印菜单
                console.print()
                self.print_menu()
                
                # 获取用户选择
                choice = Prompt.ask("\n请选择功能", choices=["0", "1", "2", "3", "4"])
                
                console.print()
                
                if choice == "0":
                    console.print("👋 感谢使用 AgenticX 文档解析器!", style="blue")
                    break
                elif choice == "1":
                    await self.parse_single_document()
                elif choice == "2":
                    await self.parse_example_pdf()
                elif choice == "3":
                    await self.show_supported_languages()
                elif choice == "4":
                    await self.chat_with_agent()
                
                # 等待用户按键继续
                console.print()
                Prompt.ask("按回车键继续", default="")
                
        except KeyboardInterrupt:
            console.print("\n👋 程序被用户中断", style="yellow")
        except Exception as e:
            console.print(f"\n❌ 程序运行异常: {e}", style="red")
            logger.error(f"程序运行异常: {e}")


def main():
    """主函数"""
    try:
        # 创建并运行演示应用
        demo = DocumentParserDemo()
        asyncio.run(demo.run())
        
    except Exception as e:
        console.print(f"❌ 程序启动失败: {e}", style="red")
        logger.error(f"程序启动失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()