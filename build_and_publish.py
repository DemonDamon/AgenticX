#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
构建和发布脚本
用于构建和发布AgenticX包到PyPI
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path


def run_command(cmd, check=True):
    """运行命令并打印输出"""
    print(f"Running: {cmd}")
    try:
        result = subprocess.run(cmd, shell=True, check=check, capture_output=False)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"Error: {e}")
        return False


def clean_build():
    """清理构建目录"""
    print("🧹 清理构建目录...")
    
    dirs_to_clean = ['build', 'dist', 'agenticx.egg-info']
    for dir_name in dirs_to_clean:
        if os.path.exists(dir_name):
            shutil.rmtree(dir_name)
            print(f"已删除 {dir_name}/")
    
    # 清理__pycache__
    for root, dirs, files in os.walk('.'):
        for dir_name in dirs:
            if dir_name == '__pycache__':
                shutil.rmtree(os.path.join(root, dir_name))
                print(f"已删除 {os.path.join(root, dir_name)}")


def check_requirements():
    """检查构建所需的依赖"""
    print("🔍 检查构建依赖...")
    
    required_packages = ['build', 'twine', 'wheel']
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print(f"❌ 缺少以下依赖: {', '.join(missing_packages)}")
        print("请运行以下命令安装:")
        print(f"pip install {' '.join(missing_packages)}")
        return False
    
    print("✅ 所有构建依赖已满足")
    return True


def run_tests():
    """运行测试"""
    print("🧪 运行测试...")
    
    if not os.path.exists('tests'):
        print("⚠️  未找到测试目录，跳过测试")
        return True
    
    return run_command("python -m pytest tests/ -v", check=False)


def build_package(no_isolation=False):
    """构建包"""
    print("📦 构建包...")
    
    # 构建命令
    build_cmd = "python -m build"
    if no_isolation:
        build_cmd += " --no-isolation"
        print("🔧 使用 --no-isolation 模式")
    
    if not run_command(build_cmd):
        print("❌ 构建失败")
        return False
    
    # 检查构建产物大小
    dist_dir = Path("dist")
    if dist_dir.exists():
        print("\n📊 构建产物信息:")
        for file in dist_dir.glob("*"):
            size_mb = file.stat().st_size / (1024 * 1024)
            print(f"  {file.name}: {size_mb:.2f} MB")
    
    print("✅ 构建完成")
    return True


def check_package():
    """检查包"""
    print("🔍 检查包...")
    
    if not run_command("python -m twine check dist/*"):
        print("❌ 包检查失败")
        return False
    
    print("✅ 包检查通过")
    return True


def publish_to_test_pypi():
    """发布到测试PyPI"""
    print("🚀 发布到测试PyPI...")
    
    cmd = "python -m twine upload --repository testpypi dist/*"
    if not run_command(cmd):
        print("❌ 发布到测试PyPI失败")
        return False
    
    print("✅ 成功发布到测试PyPI")
    print("可以通过以下命令测试安装:")
    print("pip install --index-url https://test.pypi.org/simple/ agenticx")
    return True


def publish_to_pypi():
    """发布到PyPI"""
    print("🚀 发布到PyPI...")
    
    # 确认发布
    response = input("确定要发布到PyPI吗? (y/N): ")
    if response.lower() != 'y':
        print("取消发布")
        return False
    
    cmd = "python -m twine upload dist/*"
    if not run_command(cmd):
        print("❌ 发布到PyPI失败")
        return False
    
    print("🎉 成功发布到PyPI!")
    print("可以通过以下命令安装:")
    print("pip install agenticx")
    return True


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="构建和发布AgenticX包")
    parser.add_argument("--clean", action="store_true", help="清理构建目录")
    parser.add_argument("--build", action="store_true", help="构建包")
    parser.add_argument("--no-isolation", action="store_true", help="构建时使用 --no-isolation 模式")
    parser.add_argument("--test", action="store_true", help="运行测试")
    parser.add_argument("--check", action="store_true", help="检查包")
    parser.add_argument("--test-pypi", action="store_true", help="发布到测试PyPI")
    parser.add_argument("--pypi", action="store_true", help="发布到PyPI")
    parser.add_argument("--all", action="store_true", help="执行完整的构建和发布流程")
    
    args = parser.parse_args()
    
    # 如果没有指定任何参数，显示帮助
    if not any(vars(args).values()):
        parser.print_help()
        return
    
    # 确保在项目根目录
    if not os.path.exists('agenticx'):
        print("❌ 请在项目根目录运行此脚本")
        return
    
    success = True
    
    # 清理
    if args.clean or args.all:
        clean_build()
    
    # 检查依赖
    if args.build or args.all:
        if not check_requirements():
            return
    
    # 运行测试
    if args.test or args.all:
        if not run_tests():
            print("⚠️  测试失败，但继续构建")
    
    # 构建包
    if args.build or args.all:
        if not build_package(no_isolation=args.no_isolation):
            success = False
    
    # 检查包
    if args.check or args.all:
        if not check_package():
            success = False
    
    # 发布到测试PyPI
    if args.test_pypi or args.all:
        if success and not publish_to_test_pypi():
            success = False
    
    # 发布到PyPI
    if args.pypi:
        if success and not publish_to_pypi():
            success = False
    
    if success:
        print("🎉 所有操作完成!")
    else:
        print("❌ 部分操作失败")


if __name__ == "__main__":
    main()