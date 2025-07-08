#!/usr/bin/env python3
"""
AgenticX LLM Chat Example

一个使用 AgenticX LLM 模块的聊天示例脚本，支持：
- 单次补全模式
- 交互式对话模式
- 可配置的模型选择
- 环境变量配置支持
"""

import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.llms import LiteLLMProvider


class AgenticXChatClient:
    """AgenticX 聊天客户端"""
    
    def __init__(self, model: str = "gpt-4o-mini"):
        """
        初始化聊天客户端
        
        Args:
            model: 要使用的模型名称
        """
        self.model = model
        self.provider = None
        self._setup_provider()
    
    def _setup_provider(self):
        """设置 LLM 提供商"""
        # 加载环境变量 - 首先尝试脚本同级目录的 .env 文件
        script_dir = Path(__file__).parent
        env_file = script_dir / ".env"
        
        if env_file.exists():
            load_dotenv(env_file, override=True)
            print(f"✅ 从 {env_file} 加载环境变量")
        else:
            # 如果脚本同级目录没有 .env 文件，尝试当前工作目录
            load_dotenv(override=True)
            print("✅ 从当前工作目录加载环境变量")
        
        # 根据模型名称获取对应的环境变量
        api_key = None
        base_url = None
        
        if self.model.startswith("deepseek/"):
            api_key = os.getenv("DEEPSEEK_API_KEY")
            base_url = os.getenv("DEEPSEEK_API_BASE")
            key_name = "DEEPSEEK_API_KEY"
        elif self.model.startswith("claude-") or self.model.startswith("anthropic/"):
            api_key = os.getenv("ANTHROPIC_API_KEY")
            base_url = os.getenv("ANTHROPIC_API_BASE")
            key_name = "ANTHROPIC_API_KEY"
        elif self.model.startswith("gemini/"):
            api_key = os.getenv("GOOGLE_API_KEY")
            base_url = os.getenv("GOOGLE_API_BASE")
            key_name = "GOOGLE_API_KEY"
        else:
            # 默认使用 OpenAI 配置
            api_key = os.getenv("OPENAI_API_KEY")
            base_url = os.getenv("OPENAI_API_BASE")
            key_name = "OPENAI_API_KEY"
        
        if not api_key:
            print(f"❌ 错误: 请在 .env 文件中设置 {key_name}")
            print(f"💡 请确保在以下位置之一创建 .env 文件:")
            print(f"   1. 脚本同级目录: {script_dir / '.env'}")
            print(f"   2. 当前工作目录: {Path.cwd() / '.env'}")
            print("   并设置以下变量:")
            print(f"   {key_name}=your_api_key_here")
            if key_name == "DEEPSEEK_API_KEY":
                print("   DEEPSEEK_API_BASE=your_base_url_here  # 可选，用于代理")
            elif key_name == "ANTHROPIC_API_KEY":
                print("   ANTHROPIC_API_BASE=your_base_url_here  # 可选，用于代理")
            elif key_name == "GOOGLE_API_KEY":
                print("   GOOGLE_API_BASE=your_base_url_here  # 可选，用于代理")
            else:
                print("   OPENAI_API_BASE=your_base_url_here  # 可选，用于代理")
            sys.exit(1)
        
        print(f"🌍 使用 API Base URL: {base_url or '默认 OpenAI URL'}")
        print(f"🤖 使用模型: {self.model}")
        
        # 创建 LLM 提供商
        self.provider = LiteLLMProvider(
            model=self.model,
            api_key=api_key,
            base_url=base_url
        )
    
    def completion(self, prompt: str) -> str:
        """
        单次补全
        
        Args:
            prompt: 输入提示
            
        Returns:
            模型的回复
        """
        try:
            messages = [{"role": "user", "content": prompt}]
            response = self.provider.invoke(messages)
            return response.content
        except Exception as e:
            print(f"❌ 补全失败: {e}")
            return ""
    
    def stream_completion(self, messages: list):
        """
        流式补全生成器
        
        Args:
            messages: 消息列表
            
        Yields:
            响应的文本块
        """
        try:
            for chunk in self.provider.stream(messages):
                if chunk:
                    yield chunk
        except Exception as e:
            print(f"❌ 流式补全失败: {e}")
            return
    
    def interactive_chat(self):
        """交互式对话模式"""
        messages = []
        print(f"\n🚀 欢迎使用 AgenticX {self.model} 聊天！")
        print("💡 输入 'quit' 退出, 输入 'clear' 清空对话历史, 输入 'info' 查看当前配置")
        print("=" * 60)
        
        while True:
            try:
                user_input = input("\n👤 你: ").strip()
                
                if user_input.lower() == 'quit':
                    print("\n👋 再见！")
                    break
                elif user_input.lower() == 'clear':
                    messages = []
                    print("🧹 对话历史已清空")
                    continue
                elif user_input.lower() == 'info':
                    self._show_info(messages)
                    continue
                elif not user_input:
                    print("⚠️ 请输入有效内容")
                    continue
                
                # 添加用户消息
                messages.append({"role": "user", "content": user_input})
                
                # 获取并显示助手回复
                print("\n🤖 助手: ", end="", flush=True)
                assistant_message = ""
                
                for chunk in self.stream_completion(messages):
                    if chunk:
                        print(chunk, end="", flush=True)
                        assistant_message += chunk
                
                print()  # 换行
                
                # 添加助手回复到历史
                if assistant_message:
                    messages.append({"role": "assistant", "content": assistant_message})
                
            except KeyboardInterrupt:
                print("\n\n👋 用户中断，再见！")
                break
            except Exception as e:
                print(f"\n❌ 发生错误: {e}")
    
    def _show_info(self, messages: list):
        """显示当前配置信息"""
        print("\n📊 当前配置信息:")
        print(f"   模型: {self.model}")
        print(f"   API Base: {os.getenv('OPENAI_API_BASE', '默认')}")
        print(f"   对话轮数: {len(messages) // 2}")
        print(f"   总消息数: {len(messages)}")


def single_completion_mode(client: AgenticXChatClient):
    """单次补全模式"""
    print(f"\n🔍 单次补全模式 (模型: {client.model})")
    print("💡 输入您的问题，按回车获取回复")
    print("=" * 50)
    
    while True:
        try:
            prompt = input("\n❓ 请输入您的问题 (输入 'quit' 退出): ").strip()
            
            if prompt.lower() == 'quit':
                print("👋 再见！")
                break
            elif not prompt:
                print("⚠️ 请输入有效内容")
                continue
            
            print("\n🤖 正在思考...")
            response = client.completion(prompt)
            
            if response:
                print(f"\n💬 回复:\n{response}")
            else:
                print("❌ 未能获取回复")
                
        except KeyboardInterrupt:
            print("\n\n👋 用户中断，再见！")
            break
        except Exception as e:
            print(f"\n❌ 发生错误: {e}")


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="AgenticX LLM 聊天示例",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  python llm_chat_example.py                          # 默认交互式对话，使用 gpt-4o-mini
  python llm_chat_example.py -m gpt-4                 # 使用 gpt-4 进行交互式对话
  python llm_chat_example.py -t completion            # 单次补全模式
        """
    )
    
    parser.add_argument(
        "-m", "--model",
        default="gpt-4o-mini",
        help="要使用的模型名称 (默认: gpt-4o-mini)"
    )
    
    parser.add_argument(
        "-t", "--task-type",
        choices=["chat", "completion"],
        default="chat",
        help="任务类型: chat=交互式对话, completion=单次补全 (默认: chat)"
    )
    
    parser.add_argument(
        "--list-models",
        action="store_true",
        help="显示常用模型列表"
    )
    
    args = parser.parse_args()
    
    # 显示模型列表
    if args.list_models:
        print("\n🤖 常用模型列表:")
        models = [
            "gpt-4o-mini (推荐，快速且经济)",
            "gpt-4o (最新 GPT-4)",
            "gpt-4-turbo (GPT-4 Turbo)",
            "gpt-3.5-turbo (经济选择)",
            "gemini/gemini-pro (Google Gemini Pro)",
            "ollama/llama3 (本地 Ollama)",
            "deepseek/deepseek-chat (DeepSeek)",
        ]
        for model in models:
            print(f"  • {model}")
        print("\n💡 使用 -m 参数指定模型，例如: -m gpt-4o")
        return
    
    print("🚀 AgenticX LLM 聊天示例启动中...")
    
    # 创建聊天客户端（环境变量检查在 _setup_provider 中进行）
    try:
        client = AgenticXChatClient(model=args.model)
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        sys.exit(1)
    
    # 根据任务类型执行相应模式
    if args.task_type == "chat":
        client.interactive_chat()
    else:
        single_completion_mode(client)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 程序被用户中断")
    except Exception as e:
        print(f"\n❌ 程序异常: {e}")
        import traceback
        traceback.print_exc()
