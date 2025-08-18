#!/usr/bin/env python3
"""测试Kimi API连接"""

import os
import sys
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 添加AgenticX到路径
sys.path.append('../../..')

from agenticx.llms import KimiProvider

def test_kimi_connection():
    """测试Kimi API连接"""
    print("测试Kimi API连接...")
    
    # 获取环境变量
    api_key = os.getenv("KIMI_API_KEY")
    base_url = os.getenv("KIMI_API_BASE")
    model_name = os.getenv("KIMI_MODEL_NAME")
    
    print(f"API Key: {api_key[:10]}..." if api_key else "API Key: None")
    print(f"Base URL: {base_url}")
    print(f"Model: {model_name}")
    
    if not api_key:
        print("❌ 未找到KIMI_API_KEY环境变量")
        return False
    
    try:
        # 创建Kimi Provider
        provider = KimiProvider(
            model=model_name,
            api_key=api_key,
            base_url=base_url
        )
        
        print(f"\n使用模型: {provider.model}")
        
        # 测试简单调用
        messages = [
            {"role": "user", "content": "你好，请简单回复一下"}
        ]
        
        print("\n发送测试消息...")
        response = provider.invoke(messages)
        
        print(f"✅ API调用成功!")
        print(f"响应内容: {response.content}")
        print(f"Token使用: {response.token_usage.total_tokens}")
        
        return True
        
    except Exception as e:
        print(f"❌ API调用失败: {e}")
        return False

def test_generate_method():
    """测试generate方法"""
    print("\n测试generate方法...")
    
    api_key = os.getenv("KIMI_API_KEY")
    base_url = os.getenv("KIMI_API_BASE")
    model_name = os.getenv("KIMI_MODEL_NAME")
    
    try:
        provider = KimiProvider(
            model=model_name,
            api_key=api_key,
            base_url=base_url
        )
        
        # 测试generate方法
        result = provider.generate("请用一句话介绍人工智能")
        print(f"✅ generate方法调用成功!")
        print(f"生成内容: {result}")
        
        return True
        
    except Exception as e:
        print(f"❌ generate方法调用失败: {e}")
        return False

def main():
    """主函数"""
    print("Kimi API连接测试")
    print("=" * 40)
    
    success1 = test_kimi_connection()
    success2 = test_generate_method()
    
    print("\n" + "=" * 40)
    if success1 and success2:
        print("🎉 所有测试通过！Kimi API配置正确")
    else:
        print("❌ 测试失败，请检查配置")

if __name__ == "__main__":
    main()