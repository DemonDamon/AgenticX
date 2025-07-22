#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试Kimi Provider导入和基本功能
"""

try:
    print("正在测试AgenticX Kimi Provider...")
    
    import sys
    import os

    # 添加项目根目录到 Python 路径
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

    # 测试导入
    from agenticx.llms import KimiProvider, MoonshotProvider
    print("✅ 成功导入 KimiProvider 和 MoonshotProvider")
    
    # 测试基本初始化（不需要真实API Key）
    provider = KimiProvider(
        model="kimi-k2-0711-preview",
        api_key="test_key",
        base_url="https://api.moonshot.cn/v1"
    )
    print("✅ 成功创建 KimiProvider 实例")
    
    # 测试MoonshotProvider
    moonshot_provider = MoonshotProvider(
        model="kimi-k2-0711-preview",
        api_key="test_key"
    )
    print("✅ 成功创建 MoonshotProvider 实例")
    
    print("\n🎉 所有测试通过！Kimi Provider 已成功集成到 AgenticX 中。")
    
except ImportError as e:
    print(f"❌ 导入错误: {e}")
except Exception as e:
    print(f"❌ 其他错误: {e}")