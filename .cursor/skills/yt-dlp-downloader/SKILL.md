---
name: yt-dlp-downloader
description: Download videos and audio from YouTube and 1000+ websites using yt-dlp. Use when the user provides a video URL, asks to download videos, or mentions downloading content from video platforms like YouTube, Bilibili, Vimeo, etc.
---

# yt-dlp Video Downloader

Download videos and audio from YouTube, Bilibili, Vimeo, and 1000+ other websites using yt-dlp.

## Quick Start

When the user provides a video URL, automatically:

1. **检测环境**
   - 检测操作系统（macOS/Linux/Windows）
   - 检测 Python 和 pip 是否可用
   - 检测包管理器（brew/apt-get 等）

2. **检查 yt-dlp 是否已安装**
   ```bash
   yt-dlp --version
   ```
   如果已安装，会显示版本号；如果未安装，继续下一步。

3. **如果未安装，根据环境自动安装**
   ```bash
   # macOS/Linux: 优先使用 pip3
   pip3 install yt-dlp
   
   # 如果没有 pip3，使用 pip
   pip install yt-dlp
   
   # macOS 也可以使用 Homebrew
   brew install yt-dlp
   ```

4. **（可选）检查并安装 FFmpeg**
   ```bash
   # 检查 FFmpeg
   ffmpeg -version
   
   # macOS
   brew install ffmpeg
   
   # Linux (Debian/Ubuntu)
   sudo apt-get install ffmpeg
   ```

5. **检测代理配置（如果需要）**
   ```bash
   # 安装脚本会自动检测代理
   python3 .cursor/skills/yt-dlp-downloader/install_yt_dlp.py
   
   # 或手动检测
   echo $HTTP_PROXY  # 检查环境变量
   networksetup -getwebproxy Wi-Fi  # macOS 系统代理
   ```

6. **下载视频**
   ```bash
   # 基本下载
   yt-dlp <视频URL>
   
   # 如果需要代理
   yt-dlp --proxy http://127.0.0.1:33210 <视频URL>
   
   # 如果需要 cookies
   yt-dlp --cookies cookies.txt <视频URL>
   
   # 代理 + cookies
   yt-dlp --proxy http://127.0.0.1:33210 --cookies cookies.txt <视频URL>
   ```

**完整自动化流程示例：**

```python
# 1. 检测环境
import platform
import subprocess
import shutil

os_name = platform.system()
has_pip3 = shutil.which("pip3") is not None
has_pip = shutil.which("pip") is not None

# 2. 检查安装
try:
    version = subprocess.check_output(["yt-dlp", "--version"], text=True).strip()
    print(f"yt-dlp 已安装: {version}")
except FileNotFoundError:
    # 3. 自动安装
    pip_cmd = "pip3" if has_pip3 else "pip"
    subprocess.run([pip_cmd, "install", "yt-dlp"], check=True)
    print("yt-dlp 安装完成")

# 4. 下载视频
subprocess.run(["yt-dlp", video_url])
```

## Installation

### 快速安装（推荐）

**使用提供的安装脚本：**

```bash
# Python 脚本（跨平台）
python3 .cursor/skills/yt-dlp-downloader/install_yt_dlp.py

# Shell 脚本（macOS/Linux）
bash .cursor/skills/yt-dlp-downloader/install_yt_dlp.sh
# 或
chmod +x .cursor/skills/yt-dlp-downloader/install_yt_dlp.sh
./.cursor/skills/yt-dlp-downloader/install_yt_dlp.sh
```

安装脚本会自动：
1. 检测操作系统和 Python 环境
2. 检查 yt-dlp 是否已安装
3. 如果未安装，根据环境自动选择安装方式
4. 可选：检查并安装 FFmpeg

### 环境检测和自动安装流程

在使用 yt-dlp 之前，应该：

1. **检测操作系统和 Python 环境**
2. **检查 yt-dlp 是否已安装**
3. **如果未安装，根据环境自动安装**
4. **检查并安装 FFmpeg（可选但推荐）**

### 环境检测脚本

**Python 脚本示例：**

```python
import sys
import platform
import subprocess
import shutil

def detect_environment():
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

def check_yt_dlp_installed():
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

def install_yt_dlp(env_info):
    """根据环境安装 yt-dlp"""
    # 优先使用 pip3，其次 pip
    pip_cmd = "pip3" if env_info["has_pip3"] else "pip"
    
    if not env_info["has_pip"] and not env_info["has_pip3"]:
        raise RuntimeError("未找到 pip 或 pip3，请先安装 Python 包管理器")
    
    print(f"使用 {pip_cmd} 安装 yt-dlp...")
    result = subprocess.run(
        [pip_cmd, "install", "yt-dlp"],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("yt-dlp 安装成功！")
        return True
    else:
        print(f"安装失败: {result.stderr}")
        return False

def check_ffmpeg_installed():
    """检查 FFmpeg 是否已安装"""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return True
        return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

def install_ffmpeg(env_info):
    """根据环境安装 FFmpeg"""
    if env_info["is_mac"] and env_info["has_brew"]:
        print("使用 Homebrew 安装 FFmpeg...")
        subprocess.run(["brew", "install", "ffmpeg"])
    elif env_info["is_linux"] and env_info["has_apt"]:
        print("使用 apt-get 安装 FFmpeg...")
        subprocess.run(["sudo", "apt-get", "update"])
        subprocess.run(["sudo", "apt-get", "install", "-y", "ffmpeg"])
    elif env_info["is_windows"]:
        print("Windows 请手动安装 FFmpeg:")
        print("1. 访问 https://www.gyan.dev/ffmpeg/builds")
        print("2. 下载并解压")
        print("3. 将 bin 目录添加到 PATH 环境变量")
    else:
        print("无法自动安装 FFmpeg，请手动安装")

# 使用示例
if __name__ == "__main__":
    # 1. 检测环境
    env = detect_environment()
    print(f"操作系统: {env['os']} {env['os_version']}")
    print(f"Python 版本: {env['python_version']}")
    
    # 2. 检查 yt-dlp
    is_installed, version = check_yt_dlp_installed()
    if is_installed:
        print(f"yt-dlp 已安装，版本: {version}")
    else:
        print("yt-dlp 未安装，开始安装...")
        install_yt_dlp(env)
    
    # 3. 检查 FFmpeg（可选）
    if check_ffmpeg_installed():
        print("FFmpeg 已安装")
    else:
        print("FFmpeg 未安装（可选，但推荐安装）")
        install_ffmpeg(env)
```

**Shell 脚本示例（bash/zsh）：**

```bash
#!/bin/bash

# 检测环境
detect_env() {
    OS="$(uname -s)"
    case "${OS}" in
        Linux*)     MACHINE=Linux;;
        Darwin*)    MACHINE=Mac;;
        CYGWIN*)    MACHINE=Cygwin;;
        MINGW*)     MACHINE=MinGW;;
        *)          MACHINE="UNKNOWN:${OS}"
    esac
    echo "检测到操作系统: $MACHINE"
}

# 检查 yt-dlp 是否安装
check_yt_dlp() {
    if command -v yt-dlp &> /dev/null; then
        VERSION=$(yt-dlp --version)
        echo "yt-dlp 已安装，版本: $VERSION"
        return 0
    else
        echo "yt-dlp 未安装"
        return 1
    fi
}

# 安装 yt-dlp
install_yt_dlp() {
    echo "开始安装 yt-dlp..."
    
    # 优先使用 pip3
    if command -v pip3 &> /dev/null; then
        pip3 install yt-dlp
    elif command -v pip &> /dev/null; then
        pip install yt-dlp
    else
        echo "错误: 未找到 pip 或 pip3"
        exit 1
    fi
}

# 检查 FFmpeg
check_ffmpeg() {
    if command -v ffmpeg &> /dev/null; then
        echo "FFmpeg 已安装"
        return 0
    else
        echo "FFmpeg 未安装（可选）"
        return 1
    fi
}

# 安装 FFmpeg
install_ffmpeg() {
    case "${MACHINE}" in
        Mac)
            if command -v brew &> /dev/null; then
                echo "使用 Homebrew 安装 FFmpeg..."
                brew install ffmpeg
            else
                echo "请先安装 Homebrew: https://brew.sh"
            fi
            ;;
        Linux)
            if command -v apt-get &> /dev/null; then
                echo "使用 apt-get 安装 FFmpeg..."
                sudo apt-get update
                sudo apt-get install -y ffmpeg
            else
                echo "请使用系统包管理器安装 FFmpeg"
            fi
            ;;
        *)
            echo "请手动安装 FFmpeg"
            ;;
    esac
}

# 主流程
detect_env
if ! check_yt_dlp; then
    install_yt_dlp
fi

if ! check_ffmpeg; then
    read -p "是否安装 FFmpeg? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_ffmpeg
    fi
fi
```

### 手动安装方法

#### Check Installation
```bash
yt-dlp --version
```

#### Install via pip (recommended)
```bash
# 优先使用 pip3
pip3 install yt-dlp

# 如果没有 pip3，使用 pip
pip install yt-dlp

# 如果使用 Python 虚拟环境
python3 -m pip install yt-dlp
```

#### Install via Homebrew (macOS)
```bash
brew install yt-dlp
```

#### Install FFmpeg (strongly recommended)
Required for merging video/audio and format conversion.

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Linux (Fedora/RHEL):**
```bash
sudo dnf install ffmpeg
```

**Windows:**
1. 访问 https://www.gyan.dev/ffmpeg/builds
2. 下载 FFmpeg 构建版本
3. 解压到目录（如 `C:\ffmpeg`）
4. 将 `bin` 目录添加到系统 PATH 环境变量
5. 重启终端验证：`ffmpeg -version`

## Common Usage Patterns

### Download Best Quality Video
```bash
yt-dlp <URL>
```

### Download Specific Format
```bash
# List available formats
yt-dlp -F <URL>

# Download specific format ID
yt-dlp -f <format_id> <URL>
```

### Download Audio Only
```bash
# Extract audio as MP3
yt-dlp -x --audio-format mp3 <URL>

# Best audio quality
yt-dlp -x --audio-format mp3 --audio-quality 0 <URL>
```

### Download with Subtitles
```bash
# Download video with Chinese subtitles
yt-dlp --write-subs --sub-langs zh-Hans <URL>

# Download subtitles only
yt-dlp --write-subs --skip-download <URL>
```

### Download Playlist
```bash
yt-dlp <playlist_URL>
```

### Use Proxy
```bash
yt-dlp --proxy socks5://127.0.0.1:1080 <URL>
```

### Use Browser Cookies (for login-required content)
```bash
yt-dlp --cookies-from-browser chrome <URL>
```

## Python API Usage

When integrating into Python code:

```python
import yt_dlp

url = '<视频URL>'

# Basic download
ydl_opts = {
    'format': 'bestvideo+bestaudio/best',
    'outtmpl': '%(title)s.%(ext)s',
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
```

### Extract Info Without Downloading
```python
import yt_dlp
import json

ydl_opts = {}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    print(json.dumps(ydl.sanitize_info(info), indent=2))
```

## Output Format Options

### Save to Specific Directory
```bash
yt-dlp -o "~/Downloads/%(title)s.%(ext)s" <URL>
```

### Merge as MP4
```bash
yt-dlp --merge-output-format mp4 <URL>
```

## Supported Sites

yt-dlp supports 1000+ sites including:
- YouTube
- Bilibili
- Vimeo
- TikTok
- Instagram
- Twitter
- Twitch
- SoundCloud
- And many more...

## Cookies 使用指南

### ⚠️ 安全警告

**重要：不要分享你的 cookies.txt 文件！**

- Cookies 包含你的登录凭证和会话信息，相当于你的账户密码
- 泄露 cookies 可能导致账户被盗用、隐私泄露
- 每个用户必须使用自己的 cookies，不能共享
- 本 skill 中的 `cookies-example.txt` 仅为格式示例，不能直接使用
- 请将 `cookies.txt` 添加到 `.gitignore`，避免误提交到代码仓库

### 为什么需要 Cookies？

- 访问需要登录的内容
- 绕过 "Sign in to confirm you're not a bot" 错误
- 下载年龄限制的视频
- 访问订阅内容

### 导出 Cookies（推荐方法）

**方法1：使用浏览器扩展（最简单）**

1. **安装扩展**：
   - Chrome/Edge: 访问 `chrome://extensions/`
   - 搜索并安装 "Get cookies.txt LOCALLY"
   - 扩展地址：https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

2. **导出 Cookies**：
   - 在 YouTube 页面确保已登录
   - 点击扩展图标
   - 点击 "Export" 或 "Copy"
   - 将内容保存为 `cookies.txt` 文件

3. **使用 Cookies 下载**：
   ```bash
   yt-dlp --cookies cookies.txt <URL>
   ```

**方法2：从浏览器开发者工具手动导出**

1. 打开 Chrome 开发者工具（F12）
2. 切换到 "Application" 标签页
3. 左侧找到 "Storage" → "Cookies" → `https://www.youtube.com`
4. 查看所有 cookies（关键 cookies：`LOGIN_INFO`、`VISITOR_INFO1_LIVE`、`YSC` 等）
5. 使用扩展导出（推荐）或手动创建 cookies.txt 文件

**方法3：使用 yt-dlp 直接从浏览器读取（macOS 可能失败）**

```bash
# Chrome (macOS 上可能无法解密 cookies)
yt-dlp --cookies-from-browser chrome <URL>

# Firefox
yt-dlp --cookies-from-browser firefox <URL>
```

**注意**：macOS 上 Chrome 的 cookies 是加密存储的，`--cookies-from-browser chrome` 可能失败并提示 "cannot decrypt v10 cookies"。此时必须使用扩展导出。

### Cookies 文件格式

Cookies.txt 使用 Netscape 格式：
```
# Netscape HTTP Cookie File
# This file is generated by yt-dlp.  Do not edit.

域名	标志	路径	安全标志	过期时间	名称	值
```

示例：
```
.youtube.com	TRUE	/	TRUE	1802063871	LOGIN_INFO	AFmmF2swRQIhALvq...
.youtube.com	TRUE	/	TRUE	1784781038	VISITOR_INFO1_LIVE	KYjZnvuRYg8
```

### Cookies 文件位置

常见存放位置（按优先级）：
1. **Near 全局搜索「引用至当前对话」**：用户 @ 引用的 cookies 文件会以**绝对路径**注入 `context_files`（系统提示中的 `--- /path/to/file ---` 块）。**直接使用该绝对路径**，禁止对仅文件名做 `find`/`mdfind` 全局搜索。
2. **浏览器扩展导出默认目录**：macOS 常见为 `~/Downloads/`（如 `~/Downloads/www.youtube.com_cookies.txt`）
3. 当前工作目录：`./cookies.txt`
4. 项目目录：`/path/to/project/cookies.txt`
5. 用户目录：`~/cookies.txt`
6. 配置文件目录：`~/.config/yt-dlp/cookies.txt`

**路径解析规则（Near / Machi Desktop）：**
- 用户消息里可能显示 `@cookies.txt · ~/Downloads`，发送后会改写为 `@/Users/.../Downloads/cookies.txt`
- 执行 `yt-dlp --cookies` 时**必须**使用 `context_files` 中的完整绝对路径，不要假设文件在当前 workspace 或项目根目录
- 若用户已 @ 引用 cookies 文件，**不要**再运行 `find / -name ...` 或 `mdfind` 定位

## 网络和代理配置

### 代理检测和自动配置

**使用代理检测脚本**：
```bash
# 独立的代理检测工具
python3 .cursor/skills/yt-dlp-downloader/check_proxy.py
```

**使用安装脚本自动检测代理**（包含代理检测）：
```bash
python3 .cursor/skills/yt-dlp-downloader/install_yt_dlp.py
```

安装脚本会自动检测：
1. 环境变量中的代理配置（`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`）
2. macOS 系统代理设置
3. 本地常见代理端口（33210, 7890, 10808, 1080, 8080, 8888）
4. 网络连接测试（测试是否能访问 YouTube）

**Python 代码检测代理**：

```python
import os
import socket
import subprocess
import platform

def detect_proxy():
    """检测代理配置"""
    proxy_info = {
        "env_proxy": None,
        "system_proxy": None,
        "common_ports": [],
    }
    
    # 1. 检测环境变量
    http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    all_proxy = os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
    
    if http_proxy or https_proxy or all_proxy:
        proxy_info["env_proxy"] = http_proxy or https_proxy or all_proxy
        print(f"检测到环境变量代理: {proxy_info['env_proxy']}")
    
    # 2. 检测 macOS 系统代理
    if platform.system() == "Darwin":
        try:
            result = subprocess.run(
                ["networksetup", "-getwebproxy", "Wi-Fi"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0 and "Enabled: Yes" in result.stdout:
                # 解析代理信息
                lines = result.stdout.split("\n")
                server = port = None
                for line in lines:
                    if "Server:" in line:
                        server = line.split("Server:")[1].strip()
                    if "Port:" in line:
                        port = line.split("Port:")[1].strip()
                if server and port:
                    proxy_info["system_proxy"] = f"http://{server}:{port}"
                    print(f"检测到系统代理: {proxy_info['system_proxy']}")
        except:
            pass
    
    # 3. 检测常见代理端口
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
    
    if proxy_info["common_ports"]:
        print(f"检测到本地代理端口: {proxy_info['common_ports']}")
    
    return proxy_info

# 使用示例
proxy_info = detect_proxy()
if proxy_info["env_proxy"]:
    proxy_url = proxy_info["env_proxy"]
elif proxy_info["system_proxy"]:
    proxy_url = proxy_info["system_proxy"]
elif proxy_info["common_ports"]:
    proxy_url = f"http://127.0.0.1:{proxy_info['common_ports'][0]}"
else:
    proxy_url = None
```

**Shell 脚本检测代理**：

```bash
#!/bin/bash

# 检测环境变量代理
if [ -n "$HTTP_PROXY" ] || [ -n "$HTTPS_PROXY" ] || [ -n "$ALL_PROXY" ]; then
    PROXY="${HTTP_PROXY:-${HTTPS_PROXY:-$ALL_PROXY}}"
    echo "检测到环境变量代理: $PROXY"
fi

# 检测 macOS 系统代理
if [[ "$OSTYPE" == "darwin"* ]]; then
    SYSTEM_PROXY=$(networksetup -getwebproxy Wi-Fi 2>/dev/null | grep "Server:" | awk '{print $2}')
    SYSTEM_PORT=$(networksetup -getwebproxy Wi-Fi 2>/dev/null | grep "Port:" | awk '{print $2}')
    if [ -n "$SYSTEM_PROXY" ] && [ -n "$SYSTEM_PORT" ]; then
        echo "检测到系统代理: http://$SYSTEM_PROXY:$SYSTEM_PORT"
    fi
fi

# 检测常见代理端口
COMMON_PORTS=(33210 7890 10808 1080 8080 8888)
for port in "${COMMON_PORTS[@]}"; do
    if timeout 0.5 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null; then
        echo "检测到本地代理端口: $port"
    fi
done
```

### 代理设置

**使用代理下载**：
```bash
yt-dlp --proxy http://127.0.0.1:33210 --cookies cookies.txt <URL>
```

**代理类型**：
- HTTP: `--proxy http://127.0.0.1:33210`
- HTTPS: `--proxy https://127.0.0.1:33210`
- SOCKS5: `--proxy socks5://127.0.0.1:1080`

**自动选择代理**：

```python
import subprocess
import os

def download_with_auto_proxy(url, cookies_file=None):
    """自动检测并使用代理下载"""
    # 检测代理
    proxy_url = None
    
    # 1. 优先使用环境变量
    proxy_url = os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY")
    
    # 2. 如果没有，尝试常见端口
    if not proxy_url:
        common_ports = [33210, 7890, 10808, 1080]
        for port in common_ports:
            # 简单测试端口是否开放
            try:
                import socket
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.5)
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    proxy_url = f"http://127.0.0.1:{port}"
                    break
                sock.close()
            except:
                continue
    
    # 构建命令
    cmd = ["yt-dlp"]
    if proxy_url:
        cmd.extend(["--proxy", proxy_url])
    if cookies_file:
        cmd.extend(["--cookies", cookies_file])
    cmd.append(url)
    
    # 执行下载
    subprocess.run(cmd)
```

### macOS 系统代理配置

如果命令行工具无法直接连接代理，配置系统代理：

1. 系统设置 → 网络 → Wi-Fi/Ethernet → 高级
2. 代理标签页
3. 配置 HTTP/HTTPS 代理：
   - 服务器：`127.0.0.1`
   - 端口：`33210`（或你的代理端口）
4. 保存后，yt-dlp 会自动使用系统代理

**注意**：配置系统代理后，所有应用都会使用代理，包括浏览器。如果只想让 yt-dlp 使用代理，建议使用 `--proxy` 参数。

### 配置文件方式

创建 `~/.config/yt-dlp/config` 文件：
```
--proxy http://127.0.0.1:33210
--cookies /path/to/cookies.txt
```

**自动检测并写入配置文件**：

```python
import os
from pathlib import Path

def setup_yt_dlp_config(proxy_url=None, cookies_path=None):
    """设置 yt-dlp 配置文件"""
    config_dir = Path.home() / ".config" / "yt-dlp"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_file = config_dir / "config"
    
    lines = []
    if proxy_url:
        lines.append(f"--proxy {proxy_url}")
    if cookies_path:
        lines.append(f"--cookies {cookies_path}")
    
    if lines:
        config_file.write_text("\n".join(lines))
        print(f"配置文件已创建: {config_file}")
    else:
        print("无需创建配置文件")
```

## Error Handling

### Common Issues

**"yt-dlp: command not found"**
- Install yt-dlp: `pip install yt-dlp` 或 `brew install yt-dlp`
- Check PATH if using binary

**"Sign in to confirm you're not a bot"**
- Use cookies: `yt-dlp --cookies cookies.txt <URL>`
- Export cookies using browser extension

**"cannot decrypt v10 cookies" (macOS Chrome)**
- macOS 上 Chrome cookies 是加密的，无法直接读取
- **解决方案**：使用 "Get cookies.txt LOCALLY" 扩展导出 cookies.txt 文件
- 然后使用：`yt-dlp --cookies cookies.txt <URL>`

**"Failed to resolve 'www.youtube.com'"**
- 网络连接问题，需要配置代理
- **排查步骤**：
  1. 运行安装脚本检测代理：`python3 install_yt_dlp.py`
  2. 检查环境变量：`echo $HTTP_PROXY $HTTPS_PROXY`
  3. 检查代理服务是否运行（查看代理软件状态）
  4. 测试代理端口是否开放：
     ```python
     import socket
     sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
     result = sock.connect_ex(("127.0.0.1", 33210))
     print("端口开放" if result == 0 else "端口关闭")
     ```
  5. 配置系统代理或使用 `--proxy` 参数
  6. 如果使用代理仍失败，尝试配置系统代理（macOS）

**"Operation not permitted" (代理连接失败)**
- 代理服务可能只接受特定应用的连接
- **排查步骤**：
  1. 检查代理服务是否允许命令行工具连接
  2. 尝试配置 macOS 系统代理（系统设置 → 网络 → 代理）
  3. 检查代理端口和类型是否正确：
     ```bash
     # 测试 HTTP 代理
     curl --proxy http://127.0.0.1:33210 https://www.google.com
     
     # 测试 SOCKS5 代理
     curl --proxy socks5://127.0.0.1:1080 https://www.google.com
     ```
  4. 如果代理需要认证，检查代理配置
  5. **解决方案**：配置 macOS 系统代理（见上方），这样所有应用都会使用代理

**代理检测和故障排除脚本**：

```python
import os
import socket
import subprocess
import platform

def diagnose_proxy_issues():
    """诊断代理问题"""
    print("=" * 60)
    print("代理诊断工具")
    print("=" * 60)
    
    # 1. 检查环境变量
    print("\n1. 检查环境变量代理:")
    http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if http_proxy:
        print(f"   HTTP_PROXY: {http_proxy}")
    if https_proxy:
        print(f"   HTTPS_PROXY: {https_proxy}")
    if not http_proxy and not https_proxy:
        print("   未设置环境变量代理")
    
    # 2. 检查 macOS 系统代理
    if platform.system() == "Darwin":
        print("\n2. 检查 macOS 系统代理:")
        try:
            result = subprocess.run(
                ["networksetup", "-getwebproxy", "Wi-Fi"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if "Enabled: Yes" in result.stdout:
                print("   系统代理已启用")
                print(f"   {result.stdout}")
            else:
                print("   系统代理未启用")
        except Exception as e:
            print(f"   无法读取系统代理: {e}")
    
    # 3. 检查常见代理端口
    print("\n3. 检查本地代理端口:")
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
                print(f"   端口 {port}: ✓ 开放")
            else:
                print(f"   端口 {port}: ✗ 关闭")
        except Exception as e:
            print(f"   端口 {port}: ✗ 检查失败 ({e})")
    
    # 4. 测试网络连接
    print("\n4. 测试网络连接:")
    try:
        import urllib.request
        urllib.request.urlopen("https://www.youtube.com", timeout=5)
        print("   ✓ 可以直接访问 YouTube")
    except Exception as e:
        print(f"   ✗ 无法直接访问 YouTube: {e}")
        print("   建议: 配置代理或使用 cookies")
    
    # 5. 建议
    print("\n5. 建议:")
    if open_ports:
        print(f"   检测到代理端口: {open_ports}")
        print(f"   可以使用: yt-dlp --proxy http://127.0.0.1:{open_ports[0]} <URL>")
    elif http_proxy or https_proxy:
        print("   环境变量已设置代理，yt-dlp 应该会自动使用")
    else:
        print("   未检测到代理配置")
        print("   如果无法访问 YouTube，请:")
        print("   1. 配置代理: yt-dlp --proxy <proxy_url> <URL>")
        print("   2. 配置系统代理（macOS: 系统设置 → 网络 → 代理）")
        print("   3. 使用 cookies: yt-dlp --cookies cookies.txt <URL>")

if __name__ == "__main__":
    diagnose_proxy_issues()
```

**"No video formats found"**
- Check if video is available
- Try with cookies if login required
- Check if site is supported: `yt-dlp --list-extractors`

**Slow download speed**
- Use concurrent fragments: `yt-dlp --concurrent-fragments 8 <URL>`
- Use external downloader: `yt-dlp --downloader aria2c <URL>`

## Workflow

When user provides a video URL:

1. **Detect the URL** - Identify if it's a video URL from supported sites

2. **检测环境并检查安装**
   - 检测操作系统（macOS/Linux/Windows）
   - 检测 Python 和包管理器（pip/pip3/brew/apt-get）
   - 检查 yt-dlp 是否已安装：`yt-dlp --version`
   - 如果未安装，根据环境自动安装：
     - macOS/Linux: `pip3 install yt-dlp` 或 `pip install yt-dlp`
     - macOS (可选): `brew install yt-dlp`
   - （可选）检查 FFmpeg：`ffmpeg -version`

3. **检测网络和代理配置**
   - 检测环境变量中的代理（`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`）
   - 检测 macOS 系统代理设置（如果适用）
   - 检测本地常见代理端口（33210, 7890, 10808, 1080, 8080, 8888）
   - 测试网络连接（测试是否能访问 YouTube）
   - 若用户已 @ 引用 cookies 或系统提示 `context_files` 含绝对路径，直接使用该路径；否则再按「Cookies 文件位置」节查找（含 `~/Downloads/`，**禁止**全局 `find`/`mdfind`）
   - 根据检测结果自动选择代理配置

4. **Determine user intent**:
   - Video only? → Use default format
   - Audio only? → Use `-x --audio-format mp3`
   - Specific quality? → List formats first with `-F`
   - With subtitles? → Add `--write-subs`

5. **Execute download** - Run appropriate yt-dlp command
   - 基本下载：`yt-dlp <URL>`
   - 如果需要 cookies：`yt-dlp --cookies cookies.txt <URL>`
   - 如果需要代理：`yt-dlp --proxy <proxy_url> --cookies cookies.txt <URL>`
   - If network error → Try with cookies: `yt-dlp --cookies cookies.txt <URL>`
   - If still fails → Check proxy configuration

6. **Handle errors** - Provide helpful error messages and solutions
   - 如果安装失败，提供环境检测和安装脚本
   - 如果网络失败，提示配置代理或 cookies
   - 如果下载失败，提供错误排查建议

## 调试经验和最佳实践

### 成功案例：YouTube 视频下载

**场景**：macOS 环境，需要代理和 cookies

**步骤**：
1. 安装 yt-dlp：`brew install yt-dlp`
2. 导出 cookies：
   - 安装 "Get cookies.txt LOCALLY" 扩展
   - 在 YouTube 页面导出 cookies
   - 保存为 `cookies.txt`
3. 配置系统代理（如果代理无法直接连接）
4. 下载视频：
   ```bash
   yt-dlp --cookies cookies.txt "https://www.youtube.com/watch?v=XXX"
   ```

**关键点**：
- macOS 上 Chrome cookies 无法直接读取，必须使用扩展导出
- 如果代理连接失败，配置系统代理更可靠
- Cookies 文件格式必须正确（Netscape 格式）

### 常见问题排查流程

1. **检查安装**：
   ```bash
   yt-dlp --version
   ```

2. **测试网络连接**：
   ```bash
   curl -I https://www.youtube.com
   ```

3. **如果网络失败，尝试 cookies**：
   ```bash
   yt-dlp --cookies cookies.txt <URL>
   ```

4. **如果 cookies 失败，检查文件格式**：
   - 确保是 Netscape 格式
   - 检查文件路径是否正确
   - 确保 cookies 未过期

5. **如果代理失败**：
   - 检查代理服务是否运行
   - 尝试配置系统代理
   - 检查代理端口和类型

### 最佳实践

1. **Cookies 管理**：
   - 定期更新 cookies（通常有效期较长）
   - 将 cookies.txt 放在项目目录便于管理
   - 不要将 cookies.txt 提交到 Git（添加到 .gitignore）

2. **代理配置**：
   - 优先使用系统代理（更稳定）
   - 如果必须使用命令行代理，确保代理服务支持命令行工具
   - 记录代理配置到配置文件

3. **下载选项**：
   - 使用 `--merge-output-format mp4` 确保输出格式
   - 使用 `-o` 指定输出路径和文件名模板
   - 使用 `--write-subs` 同时下载字幕

4. **错误处理**：
   - 遇到错误先检查网络和 cookies
   - 查看详细错误信息：`yt-dlp -v <URL>`
   - 记录成功配置以便复用

## Examples

**Example 1: Simple download**
```
User: "下载这个视频 https://www.youtube.com/watch?v=xxx"
→ yt-dlp https://www.youtube.com/watch?v=xxx
```

**Example 2: Audio only**
```
User: "提取这个视频的音频 https://www.youtube.com/watch?v=xxx"
→ yt-dlp -x --audio-format mp3 https://www.youtube.com/watch?v=xxx
```

**Example 3: With subtitles**
```
User: "下载这个视频和字幕 https://www.youtube.com/watch?v=xxx"
→ yt-dlp --write-subs --sub-langs zh-Hans https://www.youtube.com/watch?v=xxx
```

**Example 4: Specific quality**
```
User: "下载1080p版本 https://www.youtube.com/watch?v=xxx"
→ yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" https://www.youtube.com/watch?v=xxx
```

**Example 5: With cookies (most common for YouTube)**
```
User: "下载这个视频 https://www.youtube.com/watch?v=xxx"
→ yt-dlp --cookies cookies.txt "https://www.youtube.com/watch?v=xxx"
```

**Example 6: With proxy and cookies**
```
User: "下载这个视频 https://www.youtube.com/watch?v=xxx" (需要代理)
→ yt-dlp --proxy http://127.0.0.1:33210 --cookies cookies.txt "https://www.youtube.com/watch?v=xxx"
```

## 实际调试案例

### 案例：macOS 下载 YouTube 视频

**问题**：
- 网络连接失败："Failed to resolve 'www.youtube.com'"
- Chrome cookies 无法读取："cannot decrypt v10 cookies"

**解决步骤**：
1. 安装 "Get cookies.txt LOCALLY" 扩展
2. 在 YouTube 页面导出 cookies 为 cookies.txt
3. 配置 macOS 系统代理（如果代理无法直接连接）
4. 使用 cookies 下载：
   ```bash
   yt-dlp --cookies cookies.txt "https://www.youtube.com/watch?v=XXX"
   ```

**成功输出示例**：
```
[youtube] Extracting URL: https://www.youtube.com/watch?v=XXX
[youtube] XXX: Downloading webpage
[youtube] [jsc:deno] Solving JS challenges using deno
[youtube] XXX: Downloading m3u8 information
[info] XXX: Downloading 1 format(s): 399+251
[download] Destination: video_title [XXX].f399.mp4
[download] 100% of 17.85MiB in 00:00:03 at 4.67MiB/s
[download] Destination: video_title [XXX].f251.webm
[download] 100% of 1.31MiB in 00:00:00 at 3.85MiB/s
[Merger] Merging formats into "video_title [XXX].webm"
```

**关键要点**：
- Cookies.txt 文件格式必须正确（Netscape 格式）
- macOS 上必须使用扩展导出 cookies
- 系统代理配置比命令行代理更可靠
- yt-dlp 会自动使用 deno 解决 JS challenges

## 快速参考

### 最常用命令

**基本下载（使用 cookies）**：
```bash
yt-dlp --cookies cookies.txt "https://www.youtube.com/watch?v=XXX"
```

**下载并转换为 MP4**：
```bash
yt-dlp --cookies cookies.txt --merge-output-format mp4 "https://www.youtube.com/watch?v=XXX"
```

**下载音频为 MP3**：
```bash
yt-dlp --cookies cookies.txt -x --audio-format mp3 "https://www.youtube.com/watch?v=XXX"
```

**下载视频和字幕**：
```bash
yt-dlp --cookies cookies.txt --write-subs --sub-langs zh-Hans "https://www.youtube.com/watch?v=XXX"
```

**使用代理和 cookies**：
```bash
yt-dlp --proxy http://127.0.0.1:33210 --cookies cookies.txt "https://www.youtube.com/watch?v=XXX"
```

### Cookies 文件位置

默认查找位置（按优先级）：
1. **Near 对话 @ 引用 / context_files 绝对路径**（最高优先级，禁止全局 find）
2. macOS 浏览器扩展导出：`~/Downloads/`（如 `www.youtube.com_cookies.txt`）
3. 当前目录：`./cookies.txt`
4. 项目目录：`/path/to/project/cookies.txt`
5. 用户目录：`~/cookies.txt`
6. 配置文件目录：`~/.config/yt-dlp/cookies.txt`

### 配置文件位置

- macOS/Linux: `~/.config/yt-dlp/config`
- Windows: `%APPDATA%/yt-dlp/config`

配置文件示例：
```
--proxy http://127.0.0.1:33210
--cookies cookies.txt
--merge-output-format mp4
-o ~/Downloads/%(title)s.%(ext)s
```
