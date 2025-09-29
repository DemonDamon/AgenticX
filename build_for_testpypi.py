#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
构建脚本用于test.pypi.org发布
这个脚本会设置环境变量来使用最小依赖集
"""

import os
import sys
import subprocess
import shutil

def main():
    """构建用于test.pypi.org的包"""
    
    # 设置环境变量使用test.pypi.org兼容的依赖
    os.environ['USE_TESTPYPI_DEPS'] = 'true'
    
    print("🔧 正在为test.pypi.org构建包...")
    print("📦 使用最小依赖集以确保兼容性")
    
    # 清理之前的构建
    build_dirs = ['build', 'dist', 'agenticx.egg-info']
    for build_dir in build_dirs:
        if os.path.exists(build_dir):
            print(f"🧹 清理 {build_dir}")
            shutil.rmtree(build_dir)
    
    try:
        # 构建包
        print("🏗️  构建源码包和wheel包...")
        subprocess.run([sys.executable, 'setup.py', 'sdist', 'bdist_wheel'], 
                      check=True)
        
        print("✅ 构建完成!")
        print("\n📋 接下来的步骤:")
        print("1. 检查构建的包:")
        print("   twine check dist/*")
        print("\n2. 上传到test.pypi.org:")
        print("   twine upload --repository testpypi dist/*")
        print("\n3. 测试安装:")
        print("   pip install -i https://test.pypi.org/simple/ agenticx")
        print("\n⚠️  注意: test.pypi.org版本只包含核心功能，")
        print("   完整功能请从正式PyPI安装")
        
    except subprocess.CalledProcessError as e:
        print(f"❌ 构建失败: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()