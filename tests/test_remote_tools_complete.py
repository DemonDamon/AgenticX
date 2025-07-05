"""
RemoteTool RAGAS.pdf 解析测试

专门测试 RemoteTool 解析真实 PDF 文档的功能
"""

import asyncio
import json
import logging
import sys
import os
from pathlib import Path
from typing import Dict, Any

# 启用调试日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.tools import (
    create_mineru_parse_tool
)


def load_mcp_config() -> Dict[str, Any]:
    """加载 MCP 配置, 兼容嵌套结构"""
    config_path = Path.home() / ".cursor" / "mcp.json"
    
    if not config_path.exists():
        print(f"ℹ️  未找到 MCP 配置文件: {config_path}")
        print("⚠️  将使用默认配置。")
        return {
            "name": "mineru-mcp",
            "command": "uvx",
            "args": ["mineru-mcp"],
            "env": {
                "MINERU_API_BASE": "https://mineru.net",
                "MINERU_API_KEY": "demo-key",
                "OUTPUT_DIR": "./mineru-files"
            }
        }

    print(f"✅ 找到配置文件: {config_path}")
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config_data = json.load(f)

        mcp_config = None

        # 1. 检查配置是否在顶层
        if isinstance(config_data, dict) and "mineru-mcp" in config_data:
            mcp_config = config_data["mineru-mcp"]
        
        # 2. 如果不在顶层, 检查其是否被包裹在另一层字典中
        elif isinstance(config_data, dict):
            for key, value in config_data.items():
                if isinstance(value, dict) and "mineru-mcp" in value:
                    print(f"✅ 在 '{key}' 键下找到 'mineru-mcp' 配置。")
                    mcp_config = value["mineru-mcp"]
                    break

        if mcp_config:
            mcp_config["name"] = "mineru-mcp"
            print("✅ 成功加载并解析 MCP 配置。")
            return mcp_config
        else:
            print("⚠️  在配置文件中未能定位到 'mineru-mcp' 的有效配置。")
            if isinstance(config_data, dict):
                print(f"  配置文件顶层键为: {list(config_data.keys())}")

    except json.JSONDecodeError as e:
        print(f"⚠️  JSON 解析失败: {e}")
    except Exception as e:
        print(f"⚠️  配置文件读取或处理时发生异常: {e}")

    print("⚠️  未加载到有效配置，将使用默认配置。")
    return {
        "name": "mineru-mcp",
        "command": "uvx",
        "args": ["mineru-mcp"],
        "env": {
            "MINERU_API_BASE": "https://mineru.net",
            "MINERU_API_KEY": "demo-key",
            "OUTPUT_DIR": "./mineru-files"
        }
    }


async def test_ragas_pdf_parsing():
    """测试解析 RAGAS.pdf 文件"""
    print("🚀 RAGAS.pdf 解析测试")
    print("=" * 50)
    
    # 加载配置
    config = load_mcp_config()
    parse_tool = create_mineru_parse_tool(config)
    
    # 检查 PDF 文件
    pdf_path = Path(__file__).parent / "RAGAS.pdf"
    if not pdf_path.exists():
        print(f"❌ 找不到文件: {pdf_path}")
        return False
    
    print(f"📁 找到文件: {pdf_path}")
    print(f"📊 文件大小: {pdf_path.stat().st_size / 1024:.1f} KB")
    
    try:
        print("🔄 开始解析 RAGAS.pdf...")
        
        # 解析 PDF 文件
        result = await parse_tool.arun(
            file_sources=str(pdf_path),
            language="en",
            enable_ocr=False,  # 先不启用 OCR，避免大响应问题
        )
        
        print(f"✅ 解析完成！")
        print(f"📄 响应类型: {type(result)}")
        
        # 尝试解析响应内容
        if isinstance(result, dict):
            if 'content' in result:
                content_items = result['content']
                if isinstance(content_items, list) and len(content_items) > 0:
                    first_item = content_items[0]
                    if isinstance(first_item, dict) and 'text' in first_item:
                        text_content = first_item['text']
                        try:
                            # 尝试解析为 JSON
                            parsed_content = json.loads(text_content)
                            if parsed_content.get('status') == 'success':
                                content = parsed_content.get('content', '')
                                print(f"📝 解析成功，内容长度: {len(content):,} 字符")
                                
                                # 保存解析结果
                                output_file = Path(__file__).parent / "RAGAS_parsed.md"
                                with open(output_file, 'w', encoding='utf-8') as f:
                                    f.write(f"# RAGAS.pdf 解析结果\n\n{content}")
                                print(f"💾 解析结果已保存到: {output_file}")
                                
                                # 显示前 500 个字符作为预览
                                preview = content[:500] + "..." if len(content) > 500 else content
                                print(f"\n📖 内容预览:\n{preview}")
                                
                                return True
                            else:
                                error_msg = parsed_content.get('error_message', 'Unknown error')
                                print(f"❌ 解析失败: {error_msg}")
                                return False
                        except json.JSONDecodeError:
                            # 如果不是 JSON，直接显示文本内容
                            print(f"📝 解析结果 (文本格式): {text_content[:500]}...")
                            return True
            
            # 检查 structuredContent
            if 'structuredContent' in result:
                structured = result['structuredContent']
                if structured.get('status') == 'success':
                    content = structured.get('content', '')
                    print(f"📝 结构化内容解析成功，长度: {len(content):,} 字符")
                    return True
                else:
                    error_msg = structured.get('error_message', 'Unknown error')
                    print(f"❌ 结构化内容解析失败: {error_msg}")
                    return False
        
        # 如果以上都不匹配，显示原始响应
        print(f"📄 原始响应: {result}")
        return True
        
    except Exception as e:
        print(f"❌ 解析过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """主函数"""
    try:
        result = asyncio.run(test_ragas_pdf_parsing())
        print(f"\n{'🎉 测试成功！' if result else '💥 测试失败！'}")
    except KeyboardInterrupt:
        print("\n⏹️  测试被用户中断")
    except Exception as e:
        print(f"\n💥 测试过程中发生严重错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()