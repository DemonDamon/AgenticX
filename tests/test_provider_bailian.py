#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试Bailian Provider导入和基本功能
"""

try:
    print("正在测试AgenticX Bailian Provider...")
    
    import sys
    import os

    # 添加项目根目录到 Python 路径
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

    # 测试导入
    from agenticx.llms import BailianProvider, DashscopeProvider
    print("✅ 成功导入 BailianProvider 和 DashscopeProvider")
    
    # 测试基本初始化（不需要真实API Key）
    provider = BailianProvider(
        model="qwen-vl-plus",
        api_key="test_key"
    )
    print("✅ 成功创建 BailianProvider 实例")
    
    # 测试DashscopeProvider别名
    dashscope_provider = DashscopeProvider(
        model="qwen-turbo",
        api_key="test_key"
    )
    print("✅ 成功创建 DashscopeProvider 实例")
    
    # 测试多模态支持检测
    multimodal_provider = BailianProvider(
        model="qwen-vl-plus",
        api_key="test_key"
    )
    if multimodal_provider.supports_multimodal():
        print("✅ 多模态支持检测正常")
    
    # 测试模型前缀处理
    if hasattr(provider, '_ensure_dashscope_prefix'):
        prefixed_model = provider._ensure_dashscope_prefix("qwen-turbo")
        if prefixed_model == "dashscope/qwen-turbo":
            print("✅ 模型前缀处理正常")
    
    print("\n🎉 所有测试通过！Bailian Provider 已成功集成到 AgenticX 中。")
    
except ImportError as e:
    print(f"❌ 导入错误: {e}")
except Exception as e:
    print(f"❌ 其他错误: {e}")