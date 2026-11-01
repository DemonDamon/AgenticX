#!/usr/bin/env python3
"""
代理检测和诊断工具
自动检测代理配置并测试连接
"""

import os
import socket
import subprocess
import platform
import sys
from typing import Dict, List, Optional


def check_env_proxy() -> Dict:
    """检查环境变量中的代理"""
    http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    all_proxy = os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
    
    return {
        "has_proxy": bool(http_proxy or https_proxy or all_proxy),
        "http_proxy": http_proxy,
        "https_proxy": https_proxy,
        "all_proxy": all_proxy,
    }


def check_system_proxy() -> Optional[str]:
    """检查 macOS 系统代理"""
    if platform.system() != "Darwin":
        return None
    
    try:
        result = subprocess.run(
            ["networksetup", "-getwebproxy", "Wi-Fi"],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0 and "Enabled: Yes" in result.stdout:
            lines = result.stdout.split("\n")
            server = port = None
            for line in lines:
                if "Server:" in line:
                    server = line.split("Server:")[1].strip()
                if "Port:" in line:
                    port = line.split("Port:")[1].strip()
            if server and port:
                return f"http://{server}:{port}"
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
        pass
    
    return None


def check_local_proxy_ports() -> List[int]:
    """检查本地常见代理端口"""
    common_ports = [33210, 7890, 10808, 1080, 8080, 8888]
    open_ports = []
    
    for port in common_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex(("127.0.0.1", port))
            sock.close()
            if result == 0:
                open_ports.append(port)
        except:
            pass
    
    return open_ports


def test_network_connectivity() -> bool:
    """测试网络连接（测试 YouTube）"""
    try:
        import urllib.request
        urllib.request.urlopen("https://www.youtube.com", timeout=5)
        return True
    except:
        return False


def test_proxy_connection(proxy_url: str) -> bool:
    """测试代理连接"""
    try:
        import urllib.request
        proxy_handler = urllib.request.ProxyHandler({
            "http": proxy_url,
            "https": proxy_url
        })
        opener = urllib.request.build_opener(proxy_handler)
        opener.open("http://www.google.com", timeout=5)
        return True
    except:
        return False


def diagnose_proxy_issues():
    """诊断代理问题"""
    print("=" * 60)
    print("代理诊断工具")
    print("=" * 60)
    
    # 1. 检查环境变量
    print("\n1. 检查环境变量代理:")
    env_proxy = check_env_proxy()
    if env_proxy["has_proxy"]:
        if env_proxy["http_proxy"]:
            print(f"   HTTP_PROXY: {env_proxy['http_proxy']}")
        if env_proxy["https_proxy"]:
            print(f"   HTTPS_PROXY: {env_proxy['https_proxy']}")
        if env_proxy["all_proxy"]:
            print(f"   ALL_PROXY: {env_proxy['all_proxy']}")
    else:
        print("   未设置环境变量代理")
    
    # 2. 检查 macOS 系统代理
    print("\n2. 检查系统代理:")
    system_proxy = check_system_proxy()
    if system_proxy:
        print(f"   检测到系统代理: {system_proxy}")
        # 测试系统代理
        if test_proxy_connection(system_proxy):
            print("   ✓ 系统代理连接正常")
        else:
            print("   ✗ 系统代理连接失败")
    else:
        print("   未检测到系统代理")
    
    # 3. 检查常见代理端口
    print("\n3. 检查本地代理端口:")
    open_ports = check_local_proxy_ports()
    if open_ports:
        for port in open_ports:
            proxy_url = f"http://127.0.0.1:{port}"
            print(f"   端口 {port}: ✓ 开放", end="")
            if test_proxy_connection(proxy_url):
                print(" (连接正常)")
            else:
                print(" (连接失败)")
    else:
        print("   未检测到开放的代理端口")
    
    # 4. 测试网络连接
    print("\n4. 测试网络连接:")
    if test_network_connectivity():
        print("   ✓ 可以直接访问 YouTube")
        can_access = True
    else:
        print("   ✗ 无法直接访问 YouTube")
        can_access = False
    
    # 5. 建议
    print("\n5. 建议:")
    recommended_proxy = None
    
    if env_proxy["has_proxy"]:
        recommended_proxy = env_proxy["http_proxy"] or env_proxy["https_proxy"] or env_proxy["all_proxy"]
        print(f"   环境变量已设置代理: {recommended_proxy}")
        print(f"   使用: yt-dlp --proxy {recommended_proxy} <URL>")
    elif system_proxy:
        recommended_proxy = system_proxy
        print(f"   系统代理已配置: {system_proxy}")
        print("   yt-dlp 会自动使用系统代理")
    elif open_ports:
        recommended_proxy = f"http://127.0.0.1:{open_ports[0]}"
        print(f"   检测到代理端口: {open_ports[0]}")
        print(f"   使用: yt-dlp --proxy {recommended_proxy} <URL>")
    else:
        print("   未检测到代理配置")
        if not can_access:
            print("\n   如果无法访问 YouTube，请:")
            print("   1. 配置代理: yt-dlp --proxy <proxy_url> <URL>")
            print("   2. 配置系统代理（macOS: 系统设置 → 网络 → 代理）")
            print("   3. 使用 cookies: yt-dlp --cookies cookies.txt <URL>")
    
    return recommended_proxy


def main():
    """主函数"""
    try:
        recommended_proxy = diagnose_proxy_issues()
        print("\n" + "=" * 60)
        if recommended_proxy:
            print(f"✅ 推荐使用代理: {recommended_proxy}")
        else:
            print("⚠️  未检测到代理，可能需要手动配置")
        print("=" * 60)
    except KeyboardInterrupt:
        print("\n\n⚠️  用户取消")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 发生错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
