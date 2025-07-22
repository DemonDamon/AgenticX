#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kimi (Moonshot AI) Chat Example

这个示例展示了如何使用AgenticX框架与Kimi-K2模型进行对话。
Kimi-K2是由Moonshot AI开发的大型语言模型，具有强大的中英文对话能力。

使用前请确保：
1. 已安装AgenticX: pip install agenticx
2. 已设置环境变量: KIMI_API_KEY
3. 可选设置: KIMI_API_BASE, KIMI_MODEL_NAME
"""

import os
import sys
import asyncio
from pathlib import Path
from typing import List, Dict

# 尝试加载.env文件
try:
    from dotenv import load_dotenv
    # 加载当前目录下的.env文件
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✅ 已加载环境变量文件: {env_path}")
    else:
        print(f"⚠️  未找到.env文件: {env_path}")
except ImportError:
    print("⚠️  未安装python-dotenv库，将使用系统环境变量")
    print("   安装命令: pip install python-dotenv")

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.llms import KimiProvider, MoonshotProvider

def load_environment():
    """加载环境变量配置"""
    # 从环境变量获取配置
    api_key = os.getenv("KIMI_API_KEY")
    if not api_key:
        raise ValueError(
            "请设置KIMI_API_KEY环境变量。\n"
            "获取API Key: https://platform.moonshot.cn/console/api-keys"
        )
    
    api_base = os.getenv("KIMI_API_BASE", "https://api.moonshot.cn/v1")
    model_name = os.getenv("KIMI_MODEL_NAME", "kimi-k2-0711-preview")
    
    return {
        "api_key": api_key,
        "base_url": api_base,
        "model": model_name
    }

def create_kimi_provider() -> KimiProvider:
    """创建Kimi提供者实例"""
    config = load_environment()
    
    provider = KimiProvider(
        model=config["model"],
        api_key=config["api_key"],
        base_url=config["base_url"],
        temperature=0.6,
        timeout=30.0,
        max_retries=3
    )
    
    print(f"✅ Kimi Provider 初始化成功")
    print(f"   模型: {config['model']}")
    print(f"   API Base: {config['base_url']}")
    
    return provider

def demo_basic_chat():
    """基础对话示例"""
    print("\n🚀 基础对话示例")
    print("=" * 50)
    
    try:
        # 创建提供者
        provider = create_kimi_provider()
        
        # 准备消息
        messages = [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"},
            {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ]
        
        print("\n📤 发送消息: 你好，我叫李雷，1+1等于多少？")
        print("⏳ 等待Kimi回复...")
        
        # 调用模型
        response = provider.invoke(messages)
        
        print(f"\n📥 Kimi回复: {response.content}")
        print(f"\n📊 Token使用情况:")
        print(f"   输入Token: {response.token_usage.prompt_tokens}")
        print(f"   输出Token: {response.token_usage.completion_tokens}")
        print(f"   总Token: {response.token_usage.total_tokens}")
        
    except Exception as e:
        print(f"❌ 基础对话失败: {e}")

def demo_streaming_chat():
    """流式对话示例"""
    print("\n🌊 流式对话示例")
    print("=" * 50)
    
    try:
        provider = create_kimi_provider()
        
        messages = [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手。"},
            {"role": "user", "content": "请写一首关于人工智能的短诗，要求有韵律感。"}
        ]
        
        print("\n📤 发送消息: 请写一首关于人工智能的短诗，要求有韵律感。")
        print("🌊 流式回复:")
        print("-" * 30)
        
        # 流式调用
        full_response = ""
        for chunk in provider.stream(messages):
            print(chunk, end="", flush=True)
            full_response += chunk
        
        print("\n" + "-" * 30)
        print(f"✅ 流式回复完成，总长度: {len(full_response)} 字符")
        
    except Exception as e:
        print(f"❌ 流式对话失败: {e}")

async def demo_async_chat():
    """异步对话示例"""
    print("\n⚡ 异步对话示例")
    print("=" * 50)
    
    try:
        provider = create_kimi_provider()
        
        messages = [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手。"},
            {"role": "user", "content": "请解释一下什么是大语言模型？"}
        ]
        
        print("\n📤 发送消息: 请解释一下什么是大语言模型？")
        print("⏳ 异步等待回复...")
        
        # 异步调用
        response = await provider.ainvoke(messages)
        
        print(f"\n📥 异步回复: {response.content}")
        print(f"📊 Token使用: {response.token_usage.total_tokens}")
        
    except Exception as e:
        print(f"❌ 异步对话失败: {e}")

def main():
    """主函数"""
    print("🚀 AgenticX Kimi Chat 示例")
    print("=" * 60)
    
    try:
        # 检查环境变量
        config = load_environment()
        print(f"✅ 环境配置检查通过")
        print(f"   API Key: {config['api_key'][:10]}...")
        print(f"   Model: {config['model']}")
        
        # 运行各种示例
        demo_basic_chat()
        demo_streaming_chat()
        
        # 运行异步示例
        print("\n🔄 运行异步示例...")
        asyncio.run(demo_async_chat())
        
    except Exception as e:
        print(f"❌ 程序执行失败: {e}")
        print("\n💡 请检查:")
        print("   1. 是否设置了KIMI_API_KEY环境变量")
        print("   2. API Key是否有效")
        print("   3. 网络连接是否正常")
        print("   4. 是否安装了所需依赖: pip install openai")

if __name__ == "__main__":
    main()