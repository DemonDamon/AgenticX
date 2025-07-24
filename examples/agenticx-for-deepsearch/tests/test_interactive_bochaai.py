#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
博查AI搜索工具交互式测试脚本
用于测试和调试博查AI搜索功能
"""

import os
import sys
import json
from typing import Dict, Any, List
from dotenv import load_dotenv

# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
sys.path.insert(0, os.path.join(project_root, 'tools'))

# 加载.env文件
load_dotenv(os.path.join(project_root, '.env'))

# 简化的BaseTool类定义
class BaseTool:
    def __init__(self, name: str, description: str, args_schema=None):
        self.name = name
        self.description = description
        self.args_schema = args_schema
    
    def _run(self, *args, **kwargs):
        raise NotImplementedError
    
    async def _arun(self, *args, **kwargs):
        return self._run(*args, **kwargs)

# 临时替换agenticx.tools.base模块
sys.modules['agenticx'] = type('MockModule', (), {})()
sys.modules['agenticx.tools'] = type('MockModule', (), {})()
sys.modules['agenticx.tools.base'] = type('MockModule', (), {'BaseTool': BaseTool})()

# 导入博查AI搜索工具
from bochaai_search import BochaaIWebSearchTool, MockBochaaISearchTool

# def test_api_connection(api_key: str):
#     """测试API连接"""
#     print(f"\n=== 测试API连接 ===")
#     print(f"API Key: {api_key[:10]}...{api_key[-4:]}")
#     
#     try:
#         # 创建搜索工具
#         tool = BochaaIWebSearchTool(api_key=api_key)
#         
#         # 测试简单查询
#         query = "hello"
#         print(f"\n测试查询: {query}")
#         
#         results = tool._run(query)
#         
#         if results:
#             print(f"✅ API连接成功，返回 {len(results)} 个结果")
#             for i, result in enumerate(results[:2], 1):
#                 print(f"\n结果 {i}:")
#                 print(f"  标题: {result.get('title', 'N/A')}")
#                 print(f"  链接: {result.get('url', 'N/A')}")
#                 print(f"  摘要: {result.get('snippet', 'N/A')[:100]}...")
#         else:
#             print("❌ API连接失败或无结果返回")
#             
#     except Exception as e:
#         print(f"❌ API连接测试失败: {e}")

# def test_different_queries(api_key: str):
#     """测试不同类型的查询"""
#     print(f"\n=== 测试不同查询 ===")
#     
#     queries = [
#         "北京天气",
#         "Python编程",
#         "人工智能发展",
#         "2024年科技趋势"
#     ]
#     
#     try:
#         tool = BochaaIWebSearchTool(api_key=api_key)
#         
#         for query in queries:
#             print(f"\n查询: {query}")
#             results = tool._run(query)
#             print(f"结果数量: {len(results)}")
#             
#             if results:
#                 print(f"首个结果: {results[0].get('title', 'N/A')}")
#             
#     except Exception as e:
#         print(f"❌ 查询测试失败: {e}")

# def test_search_with_count(api_key: str):
#     """测试指定数量的搜索结果"""
#     print(f"\n=== 测试指定数量搜索 ===")
#     
#     query = "人工智能发展"
#     
#     try:
#         tool = BochaaIWebSearchTool(api_key=api_key)
#         
#         # 测试不同数量的搜索结果
#         for count in [5, 10, 15]:
#             print(f"\n搜索 {count} 个结果: {query}")
#             results = tool._run(query, count=count)
#             print(f"实际返回结果数量: {len(results)}")
#             
#             if results:
#                 print(f"首个结果: {results[0].get('title', 'N/A')}")
#                 
#     except Exception as e:
#         print(f"❌ 指定数量搜索失败: {e}")

def main():
    """主函数"""
    print("博查AI搜索工具交互式测试")
    print("=" * 50)
    
    # 获取API密钥
    api_key = os.getenv('BOCHA_API_KEY')
    
    if not api_key:
        print("❌ 未在.env文件中找到BOCHA_API_KEY")
        print("请在项目根目录的.env文件中设置: BOCHA_API_KEY=your_api_key")
        return
    
    print(f"使用API密钥: {api_key[:10]}...{api_key[-4:]}")
    
    # 运行测试（已注释掉自动化测试）
    # test_api_connection(api_key)
    # test_different_queries(api_key)
    # test_search_with_count(api_key)
    
    print("\n" + "=" * 50)
    print("开始交互式测试")
    
    # 交互式查询
    print("\n=== 交互式查询模式 ===")
    print("输入查询内容（输入 'quit' 退出）:")
    
    try:
        tool = BochaaIWebSearchTool(api_key=api_key)
        
        while True:
            query = input("\n> ").strip()
            
            if query.lower() in ['quit', 'exit', 'q']:
                break
                
            if not query:
                continue
            
            # 询问用户需要多少个结果
            while True:
                try:
                    count_input = input("需要多少个搜索结果？(默认10个，最多50个): ").strip()
                    if not count_input:
                        count = 10
                        break
                    count = int(count_input)
                    if 1 <= count <= 50:
                        break
                    else:
                        print("请输入1-50之间的数字")
                except ValueError:
                    print("请输入有效的数字")
                    
            print(f"搜索: {query} (获取{count}个结果)")
            results = tool._run(query, count=count)
            
            if results:
                print(f"\n找到 {len(results)} 个结果:")
                for i, result in enumerate(results, 1):
                    print(f"\n{i}. {result.get('title', 'N/A')}")
                    print(f"   链接: {result.get('url', 'N/A')}")
                    print(f"   摘要: {result.get('snippet', 'N/A')[:200]}...")
                    if 'summary' in result:
                        print(f"   详细摘要: {result.get('summary', 'N/A')[:150]}...")
            else:
                print("未找到结果")
                
    except KeyboardInterrupt:
        print("\n用户中断")
    except Exception as e:
        print(f"❌ 交互式查询失败: {e}")
    
    print("\n再见！")

if __name__ == "__main__":
    main()