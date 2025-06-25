# FastMCP 计算器服务示例

本项目展示了如何使用 FastMCP 框架构建一个简单的计算器服务，包括服务端和客户端实现。

## 安装依赖

首先需要安装 FastMCP 框架：

```bash
pip install fastmcp
```

## 项目文件说明

- `calculator.py`：计算器服务端，提供加减乘除数学运算工具和PI常量资源
- `http_client.py`：计算器客户端，连接服务器并测试各项功能

## 运行服务端

### 方法一：直接运行服务端

```bash
python calculator.py
```

这将在 http://127.0.0.1:8001 启动一个使用 SSE 传输的 FastMCP 服务器。

### 方法二：使用官方 MCP 命令行工具运行

#### Windows 系统：

```powershell
# 无认证模式（开发测试用）
$env:DANGEROUSLY_OMIT_AUTH="true"; mcp dev calculator.py

# 有认证模式
mcp dev calculator.py
```

#### Linux/Mac 系统：

```bash
# 无认证模式（开发测试用）
DANGEROUSLY_OMIT_AUTH=true mcp dev calculator.py

# 有认证模式
mcp dev calculator.py
```

## 运行客户端

在另一个终端中运行客户端：

```bash
python http_client.py
```

客户端将连接到服务器并测试所有可用的计算工具。

## 支持的功能

- 加法：`add(a, b)`
- 减法：`subtract(a, b)`
- 乘法：`multiply(a, b)`
- 除法：`divide(a, b)`
- PI常量：`constants://pi`

## FastMCP 优势

与官方 MCP SDK 相比，FastMCP 提供了：

1. 更简洁的 API 设计
2. 更高的开发效率
3. 更强的可扩展性
4. 支持多种传输模式（Stdio、SSE、内存）
5. 客户端开发成本极低（一行代码创建客户端）

