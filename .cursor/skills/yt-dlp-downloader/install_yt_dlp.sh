#!/bin/bash
# yt-dlp 自动安装脚本 (Shell 版本)
# 检测环境并自动安装 yt-dlp 和 FFmpeg（可选）

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "============================================================"
echo "yt-dlp 自动安装脚本"
echo "============================================================"

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
    echo -e "\n${BLUE}🔍 检测环境...${NC}"
    echo "   操作系统: $MACHINE"
    
    HAS_BREW=false
    HAS_APT=false
    HAS_PIP3=false
    HAS_PIP=false
    
    if command -v brew &> /dev/null; then
        HAS_BREW=true
        echo "   Homebrew: ✓"
    fi
    
    if command -v apt-get &> /dev/null; then
        HAS_APT=true
        echo "   apt-get: ✓"
    fi
    
    if command -v pip3 &> /dev/null; then
        HAS_PIP3=true
        echo "   pip3: ✓"
    fi
    
    if command -v pip &> /dev/null; then
        HAS_PIP=true
        echo "   pip: ✓"
    fi
}

# 检查 yt-dlp 是否安装
check_yt_dlp() {
    echo -e "\n${BLUE}🔍 检查 yt-dlp...${NC}"
    if command -v yt-dlp &> /dev/null; then
        VERSION=$(yt-dlp --version)
        echo -e "${GREEN}✅ yt-dlp 已安装，版本: $VERSION${NC}"
        return 0
    else
        echo -e "${RED}❌ yt-dlp 未安装${NC}"
        return 1
    fi
}

# 安装 yt-dlp
install_yt_dlp() {
    echo -e "\n${BLUE}📦 开始安装 yt-dlp...${NC}"
    
    # 优先使用 pip3
    if [ "$HAS_PIP3" = true ]; then
        echo "   使用 pip3 安装..."
        pip3 install yt-dlp
    elif [ "$HAS_PIP" = true ]; then
        echo "   使用 pip 安装..."
        pip install yt-dlp
    else
        echo -e "${RED}❌ 错误: 未找到 pip 或 pip3${NC}"
        exit 1
    fi
    
    # 验证安装
    if check_yt_dlp; then
        echo -e "${GREEN}✅ yt-dlp 安装成功！${NC}"
    else
        echo -e "${RED}❌ yt-dlp 安装失败${NC}"
        exit 1
    fi
}

# 检查 FFmpeg
check_ffmpeg() {
    echo -e "\n${BLUE}🔍 检查 FFmpeg（可选，但推荐）...${NC}"
    if command -v ffmpeg &> /dev/null; then
        echo -e "${GREEN}✅ FFmpeg 已安装${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  FFmpeg 未安装${NC}"
        return 1
    fi
}

# 安装 FFmpeg
install_ffmpeg() {
    echo -e "\n${BLUE}📦 开始安装 FFmpeg...${NC}"
    
    case "${MACHINE}" in
        Mac)
            if [ "$HAS_BREW" = true ]; then
                echo "   使用 Homebrew 安装..."
                brew install ffmpeg
                echo -e "${GREEN}✅ FFmpeg 安装成功！${NC}"
            else
                echo -e "${YELLOW}⚠️  请先安装 Homebrew: https://brew.sh${NC}"
            fi
            ;;
        Linux)
            if [ "$HAS_APT" = true ]; then
                echo "   使用 apt-get 安装..."
                sudo apt-get update
                sudo apt-get install -y ffmpeg
                echo -e "${GREEN}✅ FFmpeg 安装成功！${NC}"
            else
                echo -e "${YELLOW}⚠️  请使用系统包管理器安装 FFmpeg${NC}"
            fi
            ;;
        *)
            echo -e "${YELLOW}⚠️  请手动安装 FFmpeg${NC}"
            ;;
    esac
}

# 主流程
main() {
    detect_env
    
    if ! check_yt_dlp; then
        read -p "   是否安装 yt-dlp? (Y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            install_yt_dlp
        else
            echo "   跳过 yt-dlp 安装"
        fi
    fi
    
    if ! check_ffmpeg; then
        read -p "   是否安装 FFmpeg? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            install_ffmpeg
        else
            echo "   跳过 FFmpeg 安装"
        fi
    fi
    
    echo ""
    echo "============================================================"
    echo -e "${GREEN}✅ 安装检查完成！${NC}"
    echo "============================================================"
}

# 运行主函数
main
