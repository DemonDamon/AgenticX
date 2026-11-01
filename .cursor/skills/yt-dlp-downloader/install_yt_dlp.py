#!/usr/bin/env python3
"""
yt-dlp 自动安装脚本
检测环境并自动安装 yt-dlp 和 FFmpeg（可选）
"""

import sys
import platform
import subprocess
import shutil
import os
import socket
from typing import Dict, Tuple, Optional, List


def detect_environment() -> Dict:
    """检测当前环境"""
    os_name = platform.system()
    os_version = platform.release()
    python_version = sys.version_info
    
    is_mac = os_name == "Darwin"
    is_linux = os_name == "Linux"
    is_windows = os_name == "Windows"
    
    # 检测包管理器
    has_brew = shutil.which("brew") is not None
    has_apt = shutil.which("apt-get") is not None
    has_pip = shutil.which("pip") is not None
    has_pip3 = shutil.which("pip3") is not None
    
    return {
        "os": os_name,
        "os_version": os_version,
        "python_version": f"{python_version.major}.{python_version.minor}.{python_version.micro}",
        "is_mac": is_mac,
        "is_linux": is_linux,
        "is_windows": is_windows,
        "has_brew": has_brew,
        "has_apt": has_apt,
        "has_pip": has_pip,
        "has_pip3": has_pip3,
    }


def check_yt_dlp_installed() -> Tuple[bool, Optional[str]]:
    """检查 yt-dlp 是否已安装"""
    try:
        result = subprocess.run(
            ["yt-dlp", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, None


def install_yt_dlp(env_info: Dict) -> bool:
    """根据环境安装 yt-dlp"""
    # 优先使用 pip3，其次 pip
    pip_cmd = None
    if env_info["has_pip3"]:
        pip_cmd = "pip3"
    elif env_info["has_pip"]:
        pip_cmd = "pip"
    else:
        print("❌ 错误: 未找到 pip 或 pip3，请先安装 Python 包管理器")
        return False
    
    print(f"📦 使用 {pip_cmd} 安装 yt-dlp...")
    try:
        result = subprocess.run(
            [pip_cmd, "install", "yt-dlp"],
            check=True,
            capture_output=True,
            text=True
        )
        print("✅ yt-dlp 安装成功！")
        
        # 验证安装
        is_installed, version = check_yt_dlp_installed()
        if is_installed:
            print(f"   版本: {version}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ 安装失败: {e.stderr}")
        return False


def check_ffmpeg_installed() -> bool:
    """检查 FFmpeg 是否已安装"""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def detect_proxy_config(env_info: Dict) -> Dict:
    """检测代理配置"""
    proxy_info = {
        "has_env_proxy": False,
        "env_proxy": None,
        "has_system_proxy": False,
        "system_proxy": None,
        "common_ports": [],
        "working_proxy": None,
    }
    
    # 检测环境变量中的代理
    http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    all_proxy = os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
    
    if http_proxy or https_proxy or all_proxy:
        proxy_info["has_env_proxy"] = True
        proxy_info["env_proxy"] = http_proxy or https_proxy or all_proxy
    
    # 检测 macOS 系统代理（需要权限）
    if env_info["is_mac"]:
        try:
            # 尝试读取系统代理设置（可能需要权限）
            result = subprocess.run(
                ["networksetup", "-getwebproxy", "Wi-Fi"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0 and "Enabled: Yes" in result.stdout:
                # 解析代理信息
                lines = result.stdout.split("\n")
                for line in lines:
                    if "Server:" in line:
                        server = line.split("Server:")[1].strip()
                    if "Port:" in line:
                        port = line.split("Port:")[1].strip()
                        if server and port:
                            proxy_info["has_system_proxy"] = True
                            proxy_info["system_proxy"] = f"http://{server}:{port}"
        except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
            pass
    
    # 检测常见代理端口
    common_ports = [33210, 7890, 10808, 1080, 8080, 8888]
    for port in common_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex(("127.0.0.1", port))
            sock.close()
            if result == 0:
                proxy_info["common_ports"].append(port)
        except:
            pass
    
    return proxy_info


def test_proxy_connection(proxy_url: str) -> bool:
    """测试代理连接"""
    try:
        # 简单的连接测试
        import urllib.request
        proxy_handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        opener = urllib.request.build_opener(proxy_handler)
        opener.open("http://www.google.com", timeout=3)
        return True
    except:
        return False


def check_network_connectivity() -> bool:
    """检查网络连接（测试 YouTube）"""
    try:
        import urllib.request
        urllib.request.urlopen("https://www.youtube.com", timeout=5)
        return True
    except:
        return False


def install_ffmpeg(env_info: Dict) -> bool:
    """根据环境安装 FFmpeg"""
    if env_info["is_mac"] and env_info["has_brew"]:
        print("📦 使用 Homebrew 安装 FFmpeg...")
        try:
            subprocess.run(["brew", "install", "ffmpeg"], check=True)
            print("✅ FFmpeg 安装成功！")
            return True
        except subprocess.CalledProcessError:
            print("❌ FFmpeg 安装失败")
            return False
    elif env_info["is_linux"] and env_info["has_apt"]:
        print("📦 使用 apt-get 安装 FFmpeg...")
        try:
            subprocess.run(["sudo", "apt-get", "update"], check=True)
            subprocess.run(["sudo", "apt-get", "install", "-y", "ffmpeg"], check=True)
            print("✅ FFmpeg 安装成功！")
            return True
        except subprocess.CalledProcessError:
            print("❌ FFmpeg 安装失败")
            return False
    elif env_info["is_windows"]:
        print("⚠️  Windows 请手动安装 FFmpeg:")
        print("   1. 访问 https://www.gyan.dev/ffmpeg/builds")
        print("   2. 下载并解压")
        print("   3. 将 bin 目录添加到 PATH 环境变量")
        return False
    else:
        print("⚠️  无法自动安装 FFmpeg，请手动安装")
        return False


def main():
    """主函数"""
    print("=" * 60)
    print("yt-dlp 自动安装脚本")
    print("=" * 60)
    
    # 1. 检测环境
    print("\n🔍 检测环境...")
    env = detect_environment()
    print(f"   操作系统: {env['os']} {env['os_version']}")
    print(f"   Python 版本: {env['python_version']}")
    print(f"   包管理器: ", end="")
    if env["has_brew"]:
        print("Homebrew ✓", end=" ")
    if env["has_apt"]:
        print("apt-get ✓", end=" ")
    if env["has_pip3"]:
        print("pip3 ✓", end=" ")
    if env["has_pip"]:
        print("pip ✓", end=" ")
    print()
    
    # 2. 检查 yt-dlp
    print("\n🔍 检查 yt-dlp...")
    is_installed, version = check_yt_dlp_installed()
    if is_installed:
        print(f"✅ yt-dlp 已安装，版本: {version}")
    else:
        print("❌ yt-dlp 未安装")
        install_choice = input("   是否安装 yt-dlp? (Y/n): ").strip().lower()
        if install_choice != 'n':
            if not install_yt_dlp(env):
                sys.exit(1)
        else:
            print("   跳过 yt-dlp 安装")
    
    # 3. 检查 FFmpeg（可选）
    print("\n🔍 检查 FFmpeg（可选，但推荐）...")
    if check_ffmpeg_installed():
        print("✅ FFmpeg 已安装")
    else:
        print("❌ FFmpeg 未安装")
        install_choice = input("   是否安装 FFmpeg? (y/N): ").strip().lower()
        if install_choice == 'y':
            install_ffmpeg(env)
        else:
            print("   跳过 FFmpeg 安装")
    
    # 4. 检测代理配置
    print("\n🔍 检测代理配置...")
    proxy_info = detect_proxy_config(env)
    
    if proxy_info["has_env_proxy"]:
        print(f"✅ 检测到环境变量代理: {proxy_info['env_proxy']}")
    
    if proxy_info["has_system_proxy"]:
        print(f"✅ 检测到系统代理: {proxy_info['system_proxy']}")
    
    if proxy_info["common_ports"]:
        print(f"✅ 检测到本地代理端口: {', '.join(map(str, proxy_info['common_ports']))}")
        print("   提示: 可以使用 --proxy 参数指定代理")
    
    if not proxy_info["has_env_proxy"] and not proxy_info["has_system_proxy"] and not proxy_info["common_ports"]:
        print("⚠️  未检测到代理配置")
        print("   如果无法访问 YouTube，可能需要配置代理")
    
    # 5. 测试网络连接
    print("\n🔍 测试网络连接...")
    if check_network_connectivity():
        print("✅ 网络连接正常，可以直接访问 YouTube")
    else:
        print("⚠️  无法直接访问 YouTube，可能需要:")
        print("   1. 配置代理: yt-dlp --proxy <proxy_url> <URL>")
        print("   2. 使用 cookies: yt-dlp --cookies cookies.txt <URL>")
        print("   3. 配置系统代理（macOS: 系统设置 → 网络 → 代理）")
    
    print("\n" + "=" * 60)
    print("✅ 安装检查完成！")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  用户取消安装")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 发生错误: {e}")
        sys.exit(1)
