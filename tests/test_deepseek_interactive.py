#!/usr/bin/env python3
"""
AgenticX DeepSeek Interactive Test

交互式测试 DeepSeek 模型的非流式和流式调用功能。
"""

import sys
import os
import asyncio
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def load_env_file():
    """加载 .env 文件中的环境变量"""
    env_file = Path(__file__).parent / '.env'
    
    if not env_file.exists():
        print(f"❌ 未找到 .env 文件: {env_file}")
        print("请根据 env_template.txt 创建 .env 文件并填入 API 密钥")
        return False
    
    try:
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    if value:  # 只设置非空值
                        os.environ[key] = value
                        print(f"✅ 加载环境变量: {key}")
        return True
    except Exception as e:
        print(f"❌ 读取 .env 文件失败: {e}")
        return False

def test_deepseek_sync():
    """测试 DeepSeek 非流式调用"""
    try:
        from agenticx.llms import LiteLLMProvider
        
        print("\n=== DeepSeek 非流式调用测试 ===")
        
        # 获取用户输入
        user_input = input("请输入要发送给 DeepSeek 的消息 (按 Enter 使用默认消息): ").strip()
        if not user_input:
            user_input = "你好，请介绍一下你自己。"
        
        print(f"\n发送消息: {user_input}")
        print("正在调用 DeepSeek API...")
        
        # 创建 DeepSeek 提供商
        provider = LiteLLMProvider(model="deepseek/deepseek-chat")
        
        # 调用模型
        response = provider.invoke(user_input)
        
        print(f"\n✅ 调用成功!")
        print(f"模型: {response.model_name}")
        print(f"响应 ID: {response.id}")
        print(f"Token 使用: {response.token_usage.total_tokens} (输入: {response.token_usage.prompt_tokens}, 输出: {response.token_usage.completion_tokens})")
        print(f"成本: ${response.cost:.6f}")
        print(f"\n📝 DeepSeek 回复:")
        print("-" * 50)
        print(response.content)
        print("-" * 50)
        
        return True
        
    except Exception as e:
        print(f"❌ DeepSeek 非流式调用失败: {e}")
        return False

def test_deepseek_stream():
    """测试 DeepSeek 流式调用"""
    try:
        from agenticx.llms import LiteLLMProvider
        
        print("\n=== DeepSeek 流式调用测试 ===")
        
        # 获取用户输入
        user_input = input("请输入要发送给 DeepSeek 的消息 (按 Enter 使用默认消息): ").strip()
        if not user_input:
            user_input = "请写一首关于人工智能的短诗。"
        
        print(f"\n发送消息: {user_input}")
        print("正在流式调用 DeepSeek API...")
        print("\n📝 DeepSeek 流式回复:")
        print("-" * 50)
        
        # 创建 DeepSeek 提供商
        provider = LiteLLMProvider(model="deepseek/deepseek-chat")
        
        # 流式调用模型
        full_response = ""
        for chunk in provider.stream(user_input):
            if chunk:
                print(chunk, end='', flush=True)
                full_response += chunk
        
        print("\n" + "-" * 50)
        print(f"✅ 流式调用完成! 总字符数: {len(full_response)}")
        
        return True
        
    except Exception as e:
        print(f"❌ DeepSeek 流式调用失败: {e}")
        return False

async def test_deepseek_async():
    """测试 DeepSeek 异步调用"""
    try:
        from agenticx.llms import LiteLLMProvider
        
        print("\n=== DeepSeek 异步调用测试 ===")
        
        # 获取用户输入
        user_input = input("请输入要发送给 DeepSeek 的消息 (按 Enter 使用默认消息): ").strip()
        if not user_input:
            user_input = "请解释一下什么是大语言模型。"
        
        print(f"\n发送消息: {user_input}")
        print("正在异步调用 DeepSeek API...")
        
        # 创建 DeepSeek 提供商
        provider = LiteLLMProvider(model="deepseek/deepseek-chat")
        
        # 异步调用模型
        response = await provider.ainvoke(user_input)
        
        print(f"\n✅ 异步调用成功!")
        print(f"模型: {response.model_name}")
        print(f"Token 使用: {response.token_usage.total_tokens}")
        print(f"成本: ${response.cost:.6f}")
        print(f"\n📝 DeepSeek 回复:")
        print("-" * 50)
        print(response.content)
        print("-" * 50)
        
        return True
        
    except Exception as e:
        print(f"❌ DeepSeek 异步调用失败: {e}")
        return False

async def test_deepseek_async_stream():
    """测试 DeepSeek 异步流式调用"""
    try:
        from agenticx.llms import LiteLLMProvider
        
        print("\n=== DeepSeek 异步流式调用测试 ===")
        
        # 获取用户输入
        user_input = input("请输入要发送给 DeepSeek 的消息 (按 Enter 使用默认消息): ").strip()
        if not user_input:
            user_input = "请用代码示例解释什么是递归。"
        
        print(f"\n发送消息: {user_input}")
        print("正在异步流式调用 DeepSeek API...")
        print("\n📝 DeepSeek 异步流式回复:")
        print("-" * 50)
        
        # 创建 DeepSeek 提供商
        provider = LiteLLMProvider(model="deepseek/deepseek-chat")
        
        # 异步流式调用模型
        full_response = ""
        async for chunk in provider.astream(user_input):
            if chunk:
                print(chunk, end='', flush=True)
                full_response += chunk
        
        print("\n" + "-" * 50)
        print(f"✅ 异步流式调用完成! 总字符数: {len(full_response)}")
        
        return True
        
    except Exception as e:
        print(f"❌ DeepSeek 异步流式调用失败: {e}")
        return False

def test_deepseek_reasoner():
    """测试 DeepSeek Reasoner 模型"""
    try:
        from agenticx.llms import LiteLLMProvider
        
        print("\n=== DeepSeek Reasoner 测试 ===")
        
        # 获取用户输入
        user_input = input("请输入需要推理的问题 (按 Enter 使用默认问题): ").strip()
        if not user_input:
            user_input = "如果一个房间里有3只猫，每只猫能抓2只老鼠，但有1只猫生病了不能抓老鼠，那么总共能抓多少只老鼠？"
        
        print(f"\n发送问题: {user_input}")
        print("正在调用 DeepSeek Reasoner...")
        
        # 创建 DeepSeek Reasoner 提供商
        provider = LiteLLMProvider(model="deepseek/deepseek-reasoner")
        
        # 调用模型
        response = provider.invoke(user_input)
        
        print(f"\n✅ Reasoner 调用成功!")
        print(f"模型: {response.model_name}")
        print(f"Token 使用: {response.token_usage.total_tokens}")
        
        # 检查是否有推理内容
        if hasattr(response, 'reasoning_content') and response.reasoning_content:
            print(f"\n🧠 推理过程:")
            print("-" * 50)
            print(response.reasoning_content)
            print("-" * 50)
        
        print(f"\n📝 最终回答:")
        print("-" * 50)
        print(response.content)
        print("-" * 50)
        
        return True
        
    except Exception as e:
        print(f"❌ DeepSeek Reasoner 调用失败: {e}")
        print("注意: DeepSeek Reasoner 可能需要特殊权限或不同的 API 密钥")
        return False

def main():
    """主函数 - 交互式菜单"""
    print("🚀 AgenticX DeepSeek 交互式测试")
    print("=" * 50)
    
    # 加载环境变量
    if not load_env_file():
        return
    
    # 检查 API 密钥
    if not os.getenv('DEEPSEEK_API_KEY'):
        print("❌ 未找到 DEEPSEEK_API_KEY 环境变量")
        print("请在 tests/.env 文件中设置 DEEPSEEK_API_KEY")
        return
    
    print(f"✅ DeepSeek API 密钥已加载")
    
    while True:
        print("\n" + "=" * 50)
        print("请选择测试类型:")
        print("1. 非流式调用 (同步)")
        print("2. 流式调用 (同步)")
        print("3. 异步调用")
        print("4. 异步流式调用")
        print("5. DeepSeek Reasoner 测试")
        print("6. 退出")
        print("=" * 50)
        
        choice = input("请输入选择 (1-6): ").strip()
        
        if choice == '1':
            test_deepseek_sync()
        elif choice == '2':
            test_deepseek_stream()
        elif choice == '3':
            asyncio.run(test_deepseek_async())
        elif choice == '4':
            asyncio.run(test_deepseek_async_stream())
        elif choice == '5':
            test_deepseek_reasoner()
        elif choice == '6':
            print("\n👋 测试结束，再见！")
            break
        else:
            print("❌ 无效选择，请输入 1-6")
        
        # 询问是否继续
        if choice in ['1', '2', '3', '4', '5']:
            continue_test = input("\n是否继续测试其他功能？(y/n): ").strip().lower()
            if continue_test not in ['y', 'yes', '是']:
                print("\n👋 测试结束，再见！")
                break

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 用户中断，测试结束！")
    except Exception as e:
        print(f"\n❌ 程序异常: {e}")
        import traceback
        traceback.print_exc() 