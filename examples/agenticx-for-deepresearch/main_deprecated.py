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

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))
sys.path.append(str(Path(__file__).parent))

# 确保能找到agenticx模块
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# 加载环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()  # 加载 .env 文件
except ImportError:
    pass
except Exception as e:
    pass

# ANSI 颜色代码
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
    print(f"{Colors.WHITE}● {Colors.DIM}{message}{Colors.RESET}")

def print_action(message: str):
    """显示工具调用（绿色点）"""
    print(f"{Colors.GREEN}● {message}{Colors.RESET}")

def print_error(message: str):
    """显示错误信息（红色）"""
    print(f"{Colors.RED}✗ {message}{Colors.RESET}")

def print_success(message: str):
    """显示成功信息（绿色）"""
    print(f"{Colors.GREEN}✓ {message}{Colors.RESET}")

def print_info(message: str):
    """显示信息（蓝色）"""
    print(f"{Colors.BLUE}ℹ {message}{Colors.RESET}")

def print_welcome():
    """显示欢迎界面"""
    print(f"""
{Colors.BOLD}{Colors.BRIGHT_CYAN}╭─────────────────────────────────────────────────────────────────╮
│                                                                 │
│  {Colors.BRIGHT_WHITE}🚀 AgenticX 深度研究{Colors.BRIGHT_CYAN}                                           │
│  {Colors.DIM}智能研究助手 - 深度分析任何主题{Colors.BRIGHT_CYAN}                                │
│                                                                 │
╰─────────────────────────────────────────────────────────────────╯{Colors.RESET}

{Colors.DIM}/help 查看帮助, /clear 清屏, /exit 退出{Colors.RESET}

{Colors.BRIGHT_WHITE}cwd: {os.getcwd()}{Colors.RESET}

{Colors.DIM}─────────────────────────────────────────────────────────────────{Colors.RESET}

{Colors.DIM}环境配置 (via env):{Colors.RESET}
{Colors.GREEN}• API Key: {Colors.DIM}{os.getenv('KIMI_API_KEY', 'sk-***')[:8]}...{Colors.RESET}
{Colors.GREEN}• API Base URL: {Colors.DIM}{os.getenv('KIMI_API_BASE', 'https://api.moonshot.cn/v1')}{Colors.RESET}
""")

def print_help():
    """显示帮助信息"""
    print(f"""
{Colors.BOLD}可用命令:{Colors.RESET}

{Colors.BRIGHT_GREEN}/help{Colors.RESET}     显示此帮助信息
{Colors.BRIGHT_GREEN}/clear{Colors.RESET}    清屏
{Colors.BRIGHT_GREEN}/exit{Colors.RESET}     退出程序

{Colors.DIM}直接输入研究主题开始深度搜索{Colors.RESET}
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

def get_clarification_mode(config: Dict[str, Any]) -> str:
    """获取澄清模式"""
    deep_search_config = config.get('deep_search', {})
    return deep_search_config.get('clarification_mode', 'one_shot')

def select_clarification_mode() -> str:
    """选择澄清提问模式"""
    print(f"""
{Colors.BOLD}选择澄清提问模式:{Colors.RESET}

{Colors.BRIGHT_GREEN}1.{Colors.RESET} {Colors.BOLD}一次性澄清{Colors.RESET} - 一轮对话提出所有关键问题 {Colors.DIM}(推荐，类似Kimi官方){Colors.RESET}
{Colors.BRIGHT_GREEN}2.{Colors.RESET} {Colors.BOLD}递进式澄清{Colors.RESET} - 3-5轮渐进式深入对话
""")
    
    while True:
        try:
            choice = input(f"{Colors.BRIGHT_WHITE}请选择模式 (1-2): {Colors.RESET}").strip()
            if choice == '1' or choice == '':
                return 'one_shot'
            elif choice == '2':
                return 'progressive'
            else:
                print_error("请输入 1 或 2")
        except (EOFError, KeyboardInterrupt):
            return 'one_shot'

def run_deep_search(topic: str, config: Dict[str, Any], clarification_mode: str = 'one_shot'):
    """运行深度搜索"""
    try:
        # 清理输入主题
        topic = clean_input_text(topic)
        if not topic:
            print_error("输入主题无效或为空")
            return
            
        print_thinking("初始化深度搜索系统")
        
        # 延迟导入，避免启动时的导入问题
        try:
            from agenticx.llms import LiteLLMProvider, KimiProvider
            from workflows.interactive_deep_search_workflow import InteractiveDeepSearchWorkflow
        except ImportError as e:
            print_error(f"模块导入失败: {e}")
            print_info("请确保已正确安装所有依赖")
            return
        
        print_action("模块导入成功")
        
        # 设置 LLM 提供者
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
        
        # 根据provider类型选择对应的提供者
        provider_type = resolved_config.get('provider', 'openai')
        
        if provider_type == 'kimi':
            # 使用KimiProvider
            kimi_config = {
                'model': resolved_config.get('model', 'kimi-k2-0711-preview'),
                'api_key': resolved_config.get('api_key'),
                'base_url': resolved_config.get('base_url', 'https://api.moonshot.cn/v1'),
                'temperature': resolved_config.get('temperature', 0.7),
                'timeout': resolved_config.get('timeout', 30.0),
                'max_retries': resolved_config.get('max_retries', 3)
            }
            llm_provider = KimiProvider(**kimi_config)
        else:
            # 使用LiteLLMProvider (默认)
            llm_provider = LiteLLMProvider(**resolved_config)
        
        print_action("LLM 提供者初始化完成")
        
        # 获取配置参数
        deep_search_config = config.get('deep_search', {})
        max_research_loops = deep_search_config.get('max_research_loops', 5)
        search_engine = deep_search_config.get('search_engine', 'bochaai')
        
        print_action(f"使用搜索引擎: {search_engine}")
        
        # 创建工作流
        workflow = InteractiveDeepSearchWorkflow(
            llm_provider=llm_provider,
            max_research_loops=max_research_loops,
            search_engine=search_engine,
            config_path="config.yaml",
            clarification_mode=clarification_mode
        )
        
        print_thinking(f"开始深度研究: {topic}")
        
        # 根据澄清模式显示不同的信息
        if clarification_mode == "progressive":
            print_info(f"澄清模式: 递进式澄清 (3-5轮对话), 最大研究轮次: {max_research_loops}")
        else:
            print_info(f"澄清模式: 一次性澄清, 最大研究轮次: {max_research_loops}")
        
        # 运行工作流
        result = workflow.execute(topic, interactive=True)
        
        # 显示结果
        print(f"\n{Colors.BOLD}{Colors.BRIGHT_GREEN}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.BRIGHT_GREEN}🎉 深度搜索完成！{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.BRIGHT_GREEN}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
        
        # 显示监控指标
        if isinstance(result, dict) and 'metrics' in result:
            metrics = result['metrics']
            print(f"\n{Colors.BOLD}📊 执行指标:{Colors.RESET}")
            print(f"   总耗时: {metrics.get('execution_time', 0):.2f}秒")
            print(f"   搜索次数: {metrics.get('search_count', 0)}")
            print(f"   研究循环: {metrics.get('loop_count', 0)}")
            print(f"   问题澄清: {metrics.get('clarification_count', 0)}次")
            print(f"   思考步骤: {metrics.get('thinking_steps', 0)}次")
            print(f"   成功率: {metrics.get('success_rate', 0):.2%}")
        
        # 显示最终研究报告
        if isinstance(result, dict) and 'final_report' in result:
            print(f"\n{Colors.BOLD}{Colors.BRIGHT_CYAN}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
            print(f"{Colors.BOLD}{Colors.BRIGHT_CYAN}📋 研究报告{Colors.RESET}")
            print(f"{Colors.BOLD}{Colors.BRIGHT_CYAN}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
            print(result['final_report'])
        else:
            print(f"\n{Colors.BOLD}📋 研究结果:{Colors.RESET}")
            print(result)
        
        # 显示研究重点
        if isinstance(result, dict) and 'research_focus' in result:
            focus_areas = result['research_focus']
            if focus_areas and isinstance(focus_areas, dict):
                # 提取用户回答的具体内容，过滤掉"未回答"的项目
                actual_focus = [answer for answer in focus_areas.values() if answer and answer != "未回答"]
                if actual_focus:
                    print(f"\n{Colors.BOLD}🎯 研究重点:{Colors.RESET} {', '.join(actual_focus)}")
            elif focus_areas and isinstance(focus_areas, list):
                # 兼容列表格式
                print(f"\n{Colors.BOLD}🎯 研究重点:{Colors.RESET} {', '.join(focus_areas)}")
        
        # 显示错误信息（如果有）
        if isinstance(result, dict) and 'research_context' in result:
            errors = result['research_context'].get('errors', [])
            if errors:
                print(f"\n{Colors.YELLOW}⚠️  执行过程中遇到 {len(errors)} 个错误:{Colors.RESET}")
                for error in errors:
                    print(f"   {error.get('error', 'Unknown error')}")
        
        print(f"\n{Colors.DIM}─────────────────────────────────────────────────────────────────{Colors.RESET}")
        print_success("研究完成！输入新的主题继续研究，或输入 /exit 退出")
            
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}⚠️  用户中断了搜索过程{Colors.RESET}")
    except Exception as e:
        print_error(f"工作流执行失败: {e}")
        import traceback
        print(f"{Colors.DIM}{traceback.format_exc()}{Colors.RESET}")



def interactive_mode(config: Dict[str, Any]):
    """交互模式主循环"""
    clarification_mode = get_clarification_mode(config)
    
    # 如果配置中没有指定澄清模式，让用户选择
    if clarification_mode == 'one_shot' and not config.get('deep_search', {}).get('clarification_mode'):
        clarification_mode = select_clarification_mode()
    
    print(f"\n{Colors.DIM}使用澄清模式: {clarification_mode}{Colors.RESET}")
    print(f"{Colors.DIM}─────────────────────────────────────────────────────────────────{Colors.RESET}")
    print(f"{Colors.DIM}输入 / 查看快速命令{Colors.RESET}")
    
    while True:
        try:
            # 获取用户输入并清理
            raw_input = input(f"\n{Colors.BRIGHT_WHITE}> {Colors.RESET}")
            user_input = clean_input_text(raw_input)
            
            if not user_input:
                continue
            
            # 处理命令
            if user_input.startswith('/'):
                command = user_input[1:].lower()
                
                if command == '' or command == '/':
                    # 显示快捷命令列表
                    print(f"\n{Colors.BOLD}快捷命令:{Colors.RESET}")
                    print(f"{Colors.BRIGHT_GREEN}/help{Colors.RESET} 或 {Colors.BRIGHT_GREEN}/h{Colors.RESET}     显示帮助信息")
                    print(f"{Colors.BRIGHT_GREEN}/clear{Colors.RESET} 或 {Colors.BRIGHT_GREEN}/c{Colors.RESET}    清屏")
                    print(f"{Colors.BRIGHT_GREEN}/exit{Colors.RESET} 或 {Colors.BRIGHT_GREEN}/q{Colors.RESET}     退出程序")
                    print(f"\n{Colors.DIM}直接输入研究主题开始深度搜索{Colors.RESET}")
                elif command == 'help' or command == 'h':
                    print_help()
                elif command == 'clear' or command == 'c':
                    os.system('cls' if os.name == 'nt' else 'clear')
                    print_welcome()
                elif command == 'exit' or command == 'quit' or command == 'q':
                    print(f"\n{Colors.BRIGHT_CYAN}感谢使用 AgenticX 深度搜索系统！{Colors.RESET}")
                    break
                else:
                    print_error(f"未知命令: /{command}")
                    print_info("输入 /help 查看可用命令")
            else:
                # 执行深度搜索
                run_deep_search(user_input, config, clarification_mode)
                
        except (EOFError, KeyboardInterrupt):
            print(f"\n\n{Colors.BRIGHT_CYAN}感谢使用 AgenticX 深度搜索系统！{Colors.RESET}")
            break
        except Exception as e:
            print_error(f"发生错误: {e}")

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='AgenticX 深度搜索系统')
    parser.add_argument('topic', nargs='?', help='研究主题')
    parser.add_argument('--config', '-c', default='config.yaml', help='配置文件路径')
    parser.add_argument('--mode', choices=['one_shot', 'progressive'], 
                       default='one_shot', help='澄清提问模式')
    parser.add_argument('--iterations', '-i', type=int, default=5, help='最大迭代次数')
    parser.add_argument('--verbose', '-v', action='store_true', help='详细输出')
    
    args = parser.parse_args()
    
    # 显示欢迎界面
    print_welcome()
    
    # 加载配置
    config = load_config(args.config)
    
    # 更新配置
    if 'deep_search' not in config:
        config['deep_search'] = {}
    config['deep_search']['clarification_mode'] = args.mode
    config['deep_search']['max_research_loops'] = args.iterations
    
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
        print(f"\n{Colors.BRIGHT_CYAN}再见！{Colors.RESET}")
    except Exception as e:
        print_error(f"系统错误: {e}")
        sys.exit(1)