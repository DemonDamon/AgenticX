#!/bin/bash

# MinerU MCP服务器启动脚本
# 使用方法: ./start_mcp_server.sh
# 
# 环境变量配置:
# - MINERU_API_KEY: MinerU API密钥 (必需)
# - MINERU_API_BASE: MinerU API基础URL (可选，默认: https://mineru.net)
#
# 配置方式:
# 1. 直接设置环境变量: export MINERU_API_KEY="your_key_here"
# 2. 创建.env文件并在其中设置变量

echo "🚀 启动MinerU MCP服务器..."

# 函数：从.env文件加载环境变量
load_env_file() {
    local env_file=".env"
    if [ -f "$env_file" ]; then
        echo "📄 发现.env文件，正在加载环境变量..."
        # 读取.env文件并导出变量（忽略注释和空行）
        while IFS= read -r line || [ -n "$line" ]; do
            # 跳过注释和空行
            if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
                continue
            fi
            # 导出变量
            if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
                export "${BASH_REMATCH[1]}"="${BASH_REMATCH[2]}"
            fi
        done < "$env_file"
    fi
}

# 尝试从.env文件加载环境变量
load_env_file

# 设置默认的API基础URL
if [ -z "$MINERU_API_BASE" ]; then
    export MINERU_API_BASE="https://mineru.net"
fi

# 检查必需的API密钥
if [ -z "$MINERU_API_KEY" ]; then
    echo "❌ 错误: 未找到MINERU_API_KEY环境变量"
    echo ""
    echo "请通过以下方式之一配置API密钥:"
    echo "1. 设置环境变量:"
    echo "   export MINERU_API_KEY=\"your_api_key_here\""
    echo "   ./start_mcp_server.sh"
    echo ""
    echo "2. 创建.env文件:"
    echo "   echo 'MINERU_API_KEY=your_api_key_here' > .env"
    echo "   ./start_mcp_server.sh"
    echo ""
    echo "3. 临时设置并运行:"
    echo "   MINERU_API_KEY=\"your_api_key_here\" ./start_mcp_server.sh"
    echo ""
    exit 1
fi

echo "✅ 环境变量已配置"
echo "🔗 API Base: $MINERU_API_BASE"
echo "🔑 API Key: ${MINERU_API_KEY:0:20}..." # 只显示前20个字符
echo "📡 启动MCP服务器 (STDIO模式)..."
echo "💡 提示: 服务器启动后，请在另一个终端运行 python main.py"
echo "🛑 按 Ctrl+C 停止服务器"
echo ""

# 启动MCP服务器
mineru-mcp --transport stdio --output-dir ./outputs