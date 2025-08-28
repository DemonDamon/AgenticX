#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bailian (Dashscope) Chat Example

这个示例展示了如何使用AgenticX框架与百炼（阿里云百炼/Dashscope）模型进行对话。
百炼是由阿里云开发的大型语言模型服务，支持多模态能力。

使用前请确保：
1. 已安装AgenticX: pip install agenticx
2. 已设置环境变量: BAILIAN_API_KEY
3. 可选设置: BAILIAN_API_BASE, BAILIAN_CHAT_MODEL
"""

import os
import sys
import asyncio
import base64
from pathlib import Path

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

from agenticx.llms import BailianProvider

def load_environment():
    """加载环境变量配置"""
    # 从环境变量获取配置
    api_key = os.getenv("BAILIAN_API_KEY")
    if not api_key:
        raise ValueError(
            "请设置BAILIAN_API_KEY环境变量。\n"
            "获取API Key: https://dashscope.console.aliyun.com/"
        )
    
    api_base = os.getenv("BAILIAN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    model_name = os.getenv("BAILIAN_CHAT_MODEL", "qwen-plus")
    
    return {
        "api_key": api_key,
        "base_url": api_base,
        "model": model_name
    }

def create_bailian_provider() -> BailianProvider:
    """创建百炼提供者实例"""
    config = load_environment()
    
    provider = BailianProvider(
        model=config["model"],
        api_key=config["api_key"],
        base_url=config["base_url"],
        temperature=0.6,
        timeout=60.0,
        max_retries=3
    )
    
    print(f"✅ Bailian Provider 初始化成功")
    print(f"   模型: {config['model']}")
    print(f"   API Base: {config['base_url']}")
    
    return provider


def demo_basic_chat():
    """基础对话示例"""
    print("\n🚀 基础对话示例")
    print("=" * 50)
    
    try:
        # 创建提供者
        provider = create_bailian_provider()
        
        # 准备消息
        messages = [
            {"role": "system", "content": "你是通义千问，由阿里云开发的AI助手。你擅长中文和英文的对话，会为用户提供安全、有帮助、准确的回答。"},
            {"role": "user", "content": "你好，我是用户，1+1等于多少？"}
        ]
        
        print("\n📤 发送消息: 你好，我是用户，1+1等于多少？")
        print("⏳ 等待百炼回复...")
        
        # 调用模型
        response = provider.invoke(messages)
        
        print(f"\n📥 百炼回复: {response.content}")
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
        provider = create_bailian_provider()
        
        messages = [
            {"role": "system", "content": "你是通义千问，由阿里云开发的AI助手。"},
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
        provider = create_bailian_provider()
        
        messages = [
            {"role": "system", "content": "你是通义千问，由阿里云开发的AI助手。"},
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


def demo_multimodal_chat():
    """多模态对话示例"""
    print("\n🖼️ 多模态对话示例")
    print("=" * 50)

    try:
        config = load_environment()
        # 强制使用支持视觉功能的模型
        config["model"] = "qwen-vl-plus"
        
        provider = BailianProvider(
            model=config["model"],
            api_key=config["api_key"],
            base_url=config["base_url"],
            temperature=0.6,
            timeout=120.0,  # 增加超时以处理图片上传
            max_retries=2
        )
        
        print(f"✅ 多模态Bailian Provider 初始化成功")
        print(f"   模型: {config['model']}")

        # --- 图片URL分析示例 ---
        print("\n🔗 图片URL分析示例...")
        # 使用阿里云官方示例图片
        image_url = "http://e.hiphotos.baidu.com/image/pic/item/a1ec08fa513d2697e542494057fbb2fb4316d81e.jpg"
        
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请详细描述这张图片里的内容。"},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ]
        
        try:
            print(f"📤 发送图片URL: {image_url}")
            print("⏳ 等待模型分析图片...")
            response = provider.invoke(messages)
            print(f"📥 图片分析结果: {response.content}")
            print(f"📊 Token使用情况: {response.token_usage}")
        except Exception as e:
            print(f"❌ 图片URL分析失败: {e}")

        # --- 本地图片分析示例 ---
        print("\n📁 本地图片分析示例...")
        # 使用相对路径定位示例图片
        sample_image_path = project_root / "assets" / "agenticx-logo.png"
        
        if sample_image_path.exists():
            try:
                # 读取图片并进行Base64编码
                with open(sample_image_path, "rb") as image_file:
                    image_base64 = base64.b64encode(image_file.read()).decode('utf-8')
                
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "这张图片展示了什么？请详细描述图中的内容和结构。"},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{image_base64}"
                                }
                            },
                        ],
                    }
                ]
                
                print(f"📤 发送本地图片: {sample_image_path}")
                print("⏳ 等待模型分析图片...")
                response = provider.invoke(messages)
                print(f"📥 本地图片分析结果: {response.content}")

            except Exception as e:
                print(f"❌ 本地图片分析失败: {e}")
        else:
            print(f"⚠️  示例图片 {sample_image_path} 不存在，跳过本地图片分析。")
            
    except Exception as e:
        print(f"❌ 多模态对话失败: {e}")


def main():
    """主函数"""
    print("🚀 AgenticX Bailian Chat 示例")
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
        demo_multimodal_chat()
        
        # 运行异步示例
        print("\n🔄 运行异步示例...")
        asyncio.run(demo_async_chat())
        
    except Exception as e:
        print(f"❌ 程序执行失败: {e}")
        print("\n💡 请检查:")
        print("   1. 是否在.env文件中或系统环境中设置了 BAILIAN_API_KEY")
        print("   2. API Key是否有效且有足够额度")
        print("   3. 网络连接是否可以访问百炼API服务")
        print("   4. 是否已安装所需依赖: pip install -r requirements.txt")


if __name__ == "__main__":
    main()