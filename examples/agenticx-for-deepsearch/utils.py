#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
工具函数模块
提供通用的工具函数，包括字符清理等功能
"""

import re
import unicodedata
import yaml
import os
from typing import Dict, Any

def clean_input_text(text: str) -> str:
    """
    清理输入文本，移除无效的Unicode字符
    
    Args:
        text: 输入文本
        
    Returns:
        清理后的文本
    """
    if not text or not isinstance(text, str):
        return ""
    
    try:
        # 移除代理字符（surrogates）
        # 这些字符在UTF-8编码中会导致错误
        text = text.encode('utf-8', 'ignore').decode('utf-8')
        
        # 移除控制字符，但保留换行符和制表符
        text = ''.join(char for char in text 
                      if unicodedata.category(char)[0] != 'C' 
                      or char in '\n\t')
        
        # 去除首尾空白字符
        text = text.strip()
        
        return text
        
    except Exception:
        # 如果清理失败，返回空字符串
        return ""

def safe_encode_for_logging(text: str) -> str:
    """
    安全编码文本用于日志记录
    
    Args:
        text: 输入文本
        
    Returns:
        安全编码后的文本
    """
    if not text or not isinstance(text, str):
        return ""
        
    try:
        # 确保文本可以安全编码为UTF-8
        return text.encode('utf-8', 'replace').decode('utf-8')
    except Exception:
        return "[编码错误的文本]"

def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """
    加载配置文件
    
    Args:
        config_path: 配置文件路径
        
    Returns:
        配置字典
    """
    try:
        if not os.path.exists(config_path):
            # 如果配置文件不存在，返回默认配置
            return {
                "llm": {
                    "provider": "kimi",
                    "model": "kimi-k2-0711-preview",
                    "temperature": 0.7,
                    "max_tokens": 4000
                },
                "search": {
                    "provider": "bochaai",
                    "max_results": 10
                },
                "deep_search": {
                    "max_iterations": 10,
                    "quality_threshold": 0.8
                }
            }
            
        with open(config_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file)
            
        # 处理环境变量替换
        config = _expand_env_vars(config)
        
        return config
        
    except Exception as e:
        print(f"加载配置文件失败: {e}")
        # 返回默认配置
        return {
            "llm": {
                "provider": "kimi",
                "model": "kimi-k2-0711-preview",
                "temperature": 0.7,
                "max_tokens": 4000
            },
            "search": {
                "provider": "bochaai",
                "max_results": 10
            },
            "deep_search": {
                "max_iterations": 10,
                "quality_threshold": 0.8
            }
        }

def _expand_env_vars(obj: Any) -> Any:
    """
    递归展开配置中的环境变量
    
    Args:
        obj: 配置对象
        
    Returns:
        展开环境变量后的配置对象
    """
    if isinstance(obj, dict):
        return {key: _expand_env_vars(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [_expand_env_vars(item) for item in obj]
    elif isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        # 提取环境变量名
        env_var = obj[2:-1]
        return os.getenv(env_var, obj)  # 如果环境变量不存在，返回原值
    else:
        return obj