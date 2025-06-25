from fastmcp import FastMCP

# 1. 实例化 FastMCP
mcp = FastMCP(name="CalculatorServer")

# 2. 定义一个加法工具
@mcp.tool()
def add(a: float, b: float) -> float:
    """将两个数字相加。
    
    参数:
    a: 第一个数字
    b: 第二个数字
    
    返回:
    两数之和
    """
    return a + b

# 3. 定义一个减法工具
@mcp.tool()
def subtract(a: float, b: float) -> float:
    """将两个数字相减。
    
    参数:
    a: 第一个数字
    b: 第二个数字
    
    返回:
    两数之差 (a - b)
    """
    return a - b

# 4. 定义一个乘法工具
@mcp.tool()
def multiply(a: float, b: float) -> float:
    """乘法运算
    
    参数:
    a: 第一个数字
    b: 第二个数字
    
    返回:
    两数之积
    """
    return a * b

# 5. 定义一个除法工具
@mcp.tool()
def divide(a: float, b: float) -> float:
    """除法运算
    
    参数:
    a: 被除数
    b: 除数
    
    返回:
    两数之商 (a / b)
    
    异常:
    ValueError: 当除数为零时
    """
    if b == 0:
        raise ValueError("除数不能为零")
    return a / b

# 定义一个常量资源
@mcp.resource("constants://pi")
def get_pi() -> float:
    """提供 PI 的值。"""
    return 3.1415926535

if __name__ == "__main__":
    # 使用 FastMCP 的 run 方法启动服务器
    mcp.run(transport='sse', host="127.0.0.1", port=8001)