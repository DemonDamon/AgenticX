#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据目录分析脚本
用于完整遍历和分析intent-recognition项目的data目录结构和文件内容
"""

import os
import json
import pandas as pd
from pathlib import Path
import chardet

def detect_encoding(file_path):
    """检测文件编码"""
    try:
        with open(file_path, 'rb') as f:
            raw_data = f.read(10000)  # 读取前10KB来检测编码
            result = chardet.detect(raw_data)
            return result['encoding'] if result['encoding'] else 'utf-8'
    except:
        return 'utf-8'

def read_file_content(file_path, max_lines=50):
    """安全读取文件内容"""
    try:
        encoding = detect_encoding(file_path)
        with open(file_path, 'r', encoding=encoding, errors='ignore') as f:
            lines = f.readlines()
            if len(lines) > max_lines:
                content = ''.join(lines[:max_lines]) + f'\n... (文件共{len(lines)}行，仅显示前{max_lines}行)'
            else:
                content = ''.join(lines)
            return content
    except Exception as e:
        return f"读取文件失败: {str(e)}"

def analyze_json_file(file_path):
    """分析JSON文件"""
    try:
        encoding = detect_encoding(file_path)
        with open(file_path, 'r', encoding=encoding, errors='ignore') as f:
            data = json.load(f)
            
        if isinstance(data, list):
            summary = f"JSON数组，包含{len(data)}个元素"
            if len(data) > 0:
                first_item = data[0]
                if isinstance(first_item, dict):
                    keys = list(first_item.keys())
                    summary += f"，每个元素包含字段: {', '.join(keys[:5])}"
                    if len(keys) > 5:
                        summary += "等"
        elif isinstance(data, dict):
            keys = list(data.keys())
            summary = f"JSON对象，包含字段: {', '.join(keys[:10])}"
            if len(keys) > 10:
                summary += "等"
        else:
            summary = f"JSON数据类型: {type(data).__name__}"
            
        return summary
    except Exception as e:
        return f"JSON解析失败: {str(e)}"

def analyze_python_file(file_path):
    """分析Python文件"""
    content = read_file_content(file_path, 30)
    lines = content.split('\n')
    
    classes = []
    functions = []
    imports = []
    
    for line in lines:
        line = line.strip()
        if line.startswith('class '):
            class_name = line.split('(')[0].replace('class ', '').strip(':')
            classes.append(class_name)
        elif line.startswith('def '):
            func_name = line.split('(')[0].replace('def ', '')
            functions.append(func_name)
        elif line.startswith('import ') or line.startswith('from '):
            imports.append(line)
    
    summary = "Python脚本"
    if classes:
        summary += f"，定义类: {', '.join(classes)}"
    if functions:
        summary += f"，定义函数: {', '.join(functions[:5])}"
        if len(functions) > 5:
            summary += "等"
    if imports:
        summary += f"，导入{len(imports)}个模块"
    
    return summary

def analyze_excel_file(file_path):
    """分析Excel文件"""
    try:
        df = pd.read_excel(file_path)
        summary = f"Excel文件，{df.shape[0]}行{df.shape[1]}列"
        if len(df.columns) > 0:
            summary += f"，列名: {', '.join(df.columns[:5].tolist())}"
            if len(df.columns) > 5:
                summary += "等"
        return summary
    except Exception as e:
        return f"Excel文件分析失败: {str(e)}"

def analyze_text_file(file_path):
    """分析文本文件"""
    content = read_file_content(file_path, 20)
    lines = content.split('\n')
    non_empty_lines = [line for line in lines if line.strip()]
    
    summary = f"文本文件，共{len(lines)}行"
    if non_empty_lines:
        summary += f"，非空行{len(non_empty_lines)}行"
        # 显示前几行内容作为预览
        preview_lines = [line.strip() for line in non_empty_lines[:3] if line.strip()]
        if preview_lines:
            summary += f"，内容预览: {' | '.join(preview_lines)}"
    
    return summary

def get_file_summary(file_path):
    """根据文件类型获取文件摘要"""
    file_ext = Path(file_path).suffix.lower()
    file_size = os.path.getsize(file_path)
    
    base_info = f"({file_size} bytes)"
    
    if file_ext == '.json':
        return analyze_json_file(file_path) + " " + base_info
    elif file_ext == '.py':
        return analyze_python_file(file_path) + " " + base_info
    elif file_ext in ['.xlsx', '.xls']:
        return analyze_excel_file(file_path) + " " + base_info
    elif file_ext in ['.txt', '.md']:
        return analyze_text_file(file_path) + " " + base_info
    else:
        return f"文件类型: {file_ext} " + base_info

def generate_tree_structure(root_path, prefix="", is_last=True, max_depth=10, current_depth=0):
    """生成目录树结构"""
    if current_depth >= max_depth:
        return []
    
    items = []
    root = Path(root_path)
    
    if not root.exists():
        return [f"{prefix}目录不存在: {root_path}"]
    
    try:
        # 获取所有子项并排序（目录在前，文件在后）
        all_items = list(root.iterdir())
        dirs = sorted([item for item in all_items if item.is_dir()])
        files = sorted([item for item in all_items if item.is_file()])
        all_sorted = dirs + files
        
        for i, item in enumerate(all_sorted):
            is_last_item = (i == len(all_sorted) - 1)
            
            if item.is_dir():
                # 目录
                connector = "└── " if is_last_item else "├── "
                items.append(f"{prefix}{connector}{item.name}/")
                
                # 递归处理子目录
                extension = "    " if is_last_item else "│   "
                sub_items = generate_tree_structure(
                    item, 
                    prefix + extension, 
                    is_last_item, 
                    max_depth, 
                    current_depth + 1
                )
                items.extend(sub_items)
            else:
                # 文件
                connector = "└── " if is_last_item else "├── "
                file_summary = get_file_summary(item)
                items.append(f"{prefix}{connector}{item.name} # {file_summary}")
    
    except PermissionError:
        items.append(f"{prefix}权限不足，无法访问")
    except Exception as e:
        items.append(f"{prefix}错误: {str(e)}")
    
    return items

def main():
    """主函数"""
    data_dir = r"d:\myWorks\AgenticX\examples\agenticx-for-intent-recognition\intent-recognition\src\business\mcloud\data"
    output_file = r"d:\myWorks\AgenticX\examples\agenticx-for-intent-recognition\data_analysis_result.txt"
    
    print(f"开始分析目录: {data_dir}")
    
    # 生成目录树结构
    tree_lines = generate_tree_structure(data_dir)
    
    # 准备输出内容
    output_lines = [
        "# 意图识别项目数据目录完整分析报告",
        "",
        f"## 目录路径: {data_dir}",
        "",
        "## 完整目录结构和文件摘要",
        "",
        "```",
        "data/"
    ]
    
    # 添加树结构
    for line in tree_lines:
        if line.strip():  # 跳过空行
            output_lines.append(line)
    
    output_lines.append("```")
    output_lines.append("")
    output_lines.append("## 分析完成")
    output_lines.append(f"总计扫描文件和目录数量: {len(tree_lines)}")
    
    # 写入结果文件
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(output_lines))
        print(f"分析结果已保存到: {output_file}")
    except Exception as e:
        print(f"保存文件失败: {str(e)}")
        # 如果保存失败，直接打印结果
        print("\n分析结果:")
        for line in output_lines:
            print(line)

if __name__ == "__main__":
    main()