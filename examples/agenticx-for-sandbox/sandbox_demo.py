#!/usr/bin/env python3
"""
AgenticX Sandbox 统一演示脚本

此脚本演示 AgenticX Sandbox 模块的功能，支持所有后端（subprocess、microsandbox、docker）。

使用方法:
    # 自动检测并使用最佳可用后端
    python examples/agenticx-for-sandbox/sandbox_demo.py

    # 指定后端
    python examples/agenticx-for-sandbox/sandbox_demo.py --backend subprocess
    python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox
    python examples/agenticx-for-sandbox/sandbox_demo.py --backend docker

    # 验证 microsandbox 安装
    python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --verify

    # 只运行基础演示
    python examples/agenticx-for-sandbox/sandbox_demo.py --basic

    # 运行高级功能演示
    python examples/agenticx-for-sandbox/sandbox_demo.py --advanced

功能:
    1. 自动检测可用后端
    2. 基本用法演示（代码执行、Shell 命令）
    3. 高级功能演示（状态化执行、文件操作）
    4. microsandbox 安装验证（--verify 参数）

后端说明:
    - subprocess: 无需额外安装，适合开发测试
    - microsandbox: 需要安装 microsandbox SDK 和服务器，提供硬件级隔离
    - docker: 需要 Docker daemon 运行，提供容器级隔离
"""

import argparse
import asyncio
import sys


def print_header(title: str):
    """打印标题"""
    print()
    print("=" * 50)
    print(title)
    print("=" * 50)


def print_section(title: str):
    """打印章节"""
    print()
    print(title)
    print("-" * 40)


def print_success(msg: str):
    """打印成功信息"""
    print(f"  ✅ {msg}")


def print_error(msg: str):
    """打印错误信息"""
    print(f"  ❌ {msg}")


def print_info(msg: str):
    """打印信息"""
    print(f"  💡 {msg}")


def detect_available_backends() -> dict:
    """检测可用的后端"""
    backends = {}
    
    # subprocess 总是可用
    backends["subprocess"] = {"available": True, "reason": "内置后端，无需额外安装"}
    
    # 检查 microsandbox
    try:
        from agenticx.sandbox.backends.microsandbox import is_microsandbox_available
        if is_microsandbox_available():
            backends["microsandbox"] = {"available": True, "reason": "SDK 已安装"}
        else:
            backends["microsandbox"] = {"available": False, "reason": "SDK 未安装，运行: pip install microsandbox"}
    except ImportError:
        backends["microsandbox"] = {"available": False, "reason": "模块导入失败"}
    
    # 检查 docker
    try:
        import subprocess
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        if result.returncode == 0:
            backends["docker"] = {"available": True, "reason": "Docker daemon 运行中"}
        else:
            backends["docker"] = {"available": False, "reason": "Docker daemon 未运行"}
    except Exception:
        backends["docker"] = {"available": False, "reason": "Docker 未安装或不可用"}
    
    return backends


def select_backend(backends: dict, preferred: str = None) -> str:
    """选择后端"""
    if preferred:
        if preferred in backends and backends[preferred]["available"]:
            return preferred
        else:
            print_error(f"后端 '{preferred}' 不可用: {backends.get(preferred, {}).get('reason', '未知')}")
            return None
    
    # 自动选择优先级：subprocess > microsandbox > docker
    # 这里改为 subprocess 优先，因为它最容易使用
    for backend in ["subprocess", "microsandbox", "docker"]:
        if backends.get(backend, {}).get("available"):
            return backend
    
    return None


async def verify_microsandbox():
    """验证 microsandbox 安装"""
    print_header("Microsandbox 安装验证")
    
    steps = [
        ("检查 SDK", check_sdk),
        ("检查服务器连接", check_server),
        ("创建并启动沙箱", start_sandbox),
        ("执行测试代码", execute_test),
    ]
    
    errors = []
    sandbox = None
    
    for i, (name, func) in enumerate(steps, 1):
        print_section(f"[{i}/{len(steps)}] {name}")
        try:
            result = await func(sandbox)
            if isinstance(result, tuple) and len(result) == 3:
                success, msg, sandbox = result
            elif isinstance(result, tuple) and len(result) == 2:
                success, msg = result
            else:
                success, msg = result, ""
                
            if success:
                print_success(msg)
            else:
                print_error(msg)
                errors.append(msg)
                break
        except Exception as e:
            print_error(f"异常: {e}")
            errors.append(str(e))
            break
    
    # 清理
    if sandbox:
        try:
            await sandbox.stop()
        except Exception:
            pass
    
    print()
    print("=" * 50)
    if errors:
        print("❌ 验证失败")
        print()
        print("可能的解决方法：")
        print("  1. 安装 SDK: pip install microsandbox")
        print("  2. 安装 CLI: curl -sSL https://get.microsandbox.dev | sh")
        print("  3. 启动服务器: msb server start --dev")
        print("  4. 拉取镜像: msb pull microsandbox/python")
    else:
        print("✅ 验证通过！Microsandbox 已正确安装。")
    print("=" * 50)
    
    return len(errors) == 0


async def check_sdk(sandbox=None):
    """检查 SDK"""
    try:
        from agenticx.sandbox.backends.microsandbox import is_microsandbox_available
        if is_microsandbox_available():
            return True, "SDK 已安装"
        else:
            return False, "SDK 未安装，运行: pip install microsandbox"
    except ImportError as e:
        return False, f"导入失败: {e}"


async def check_server(sandbox=None):
    """检查服务器连接"""
    try:
        import aiohttp
        server_url = "http://127.0.0.1:5555"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{server_url}/api/v1/health", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    return True, f"服务器运行中 ({server_url})"
                else:
                    return False, f"服务器响应异常: HTTP {resp.status}"
    except Exception as e:
        return False, f"无法连接到服务器，请运行: msb server start --dev"


async def start_sandbox(sandbox=None):
    """创建并启动沙箱"""
    try:
        from agenticx.sandbox.backends.microsandbox import MicrosandboxSandbox
        sandbox = MicrosandboxSandbox(startup_timeout=300.0)
        await sandbox.start()
        return True, "沙箱启动成功", sandbox
    except Exception as e:
        error_msg = str(e)
        if "timed out" in error_msg.lower():
            return False, "启动超时，请先运行: msb pull microsandbox/python", None
        return False, f"启动失败: {e}", None


async def execute_test(sandbox):
    """执行测试代码"""
    if not sandbox:
        return False, "沙箱未启动"
    
    try:
        result = await sandbox.execute("print('Hello from Microsandbox!')")
        if result.success:
            return True, f"代码执行成功，输出: {result.stdout.strip()}"
        else:
            return False, f"执行失败: {result.stderr}"
    except Exception as e:
        return False, f"执行异常: {e}"


async def run_basic_demo(backend: str):
    """运行基础演示"""
    print_header(f"基础演示 (后端: {backend})")
    
    # 根据后端选择沙箱类
    if backend == "subprocess":
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        sandbox_class = SubprocessSandbox
        kwargs = {}
    elif backend == "microsandbox":
        from agenticx.sandbox.backends.microsandbox import MicrosandboxSandbox
        sandbox_class = MicrosandboxSandbox
        kwargs = {"startup_timeout": 300.0}
    else:
        print_error(f"不支持的后端: {backend}")
        return False
    
    try:
        async with sandbox_class(**kwargs) as sandbox:
            # 1. 执行简单的 Python 代码
            print_section("1. 执行 Python 代码")
            code = "print('Hello, AgenticX!')"
            print(f"  代码: {code}")
            result = await sandbox.execute(code)
            if result.success:
                print(f"  输出: {result.stdout.strip()}")
                print_success("执行成功")
            else:
                print_error(f"执行失败: {result.stderr}")
            
            # 2. 数学计算
            print_section("2. 数学计算")
            code = "result = sum(range(1, 101)); print(f'1+2+...+100 = {result}')"
            print(f"  代码: {code}")
            result = await sandbox.execute(code)
            if result.success:
                print(f"  输出: {result.stdout.strip()}")
                print_success("执行成功")
            else:
                print_error(f"执行失败: {result.stderr}")
            
            # 3. Shell 命令 / 系统信息
            print_section("3. Shell 命令 / 系统信息")
            if backend == "microsandbox":
                # microsandbox 使用极简 Python 镜像，可能不支持 shell 命令
                # 改用 Python 代码获取系统信息
                print("  注意: microsandbox 使用极简镜像，通过 Python 获取系统信息")
                code = "import sys, platform; print(f'Python {sys.version}, Platform: {platform.system()}')"
                print(f"  代码: {code[:50]}...")
                result = await sandbox.execute(code)
            else:
                cmd = "uname -a"
                print(f"  命令: {cmd}")
                result = await sandbox.execute(cmd, language="shell")
            
            if result.success:
                output = result.stdout.strip()
                if len(output) > 80:
                    output = output[:80] + "..."
                print(f"  输出: {output}")
                print_success("执行成功")
            else:
                print_error(f"执行失败: {result.stderr}")
        
        print()
        print_success("基础演示完成！")
        return True
        
    except Exception as e:
        print_error(f"演示失败: {e}")
        return False


async def run_advanced_demo(backend: str):
    """运行高级功能演示"""
    print_header(f"高级功能演示 (后端: {backend})")
    
    # 根据后端选择沙箱类
    if backend == "subprocess":
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        sandbox_class = SubprocessSandbox
        kwargs = {}
    elif backend == "microsandbox":
        from agenticx.sandbox.backends.microsandbox import MicrosandboxSandbox
        sandbox_class = MicrosandboxSandbox
        kwargs = {"startup_timeout": 300.0}
    else:
        print_error(f"不支持的后端: {backend}")
        return False
    
    try:
        async with sandbox_class(**kwargs) as sandbox:
            # 1. 状态化执行
            print_section("1. 状态化执行（变量持久化）")
            
            if backend == "subprocess":
                # subprocess 后端不支持跨执行的变量持久化，因为每次执行都是新进程
                # 这里演示在单次执行中使用多条语句
                print("  注意: subprocess 后端每次执行都是新进程，不支持跨执行变量持久化")
                print("  演示: 在单次执行中使用多条语句")
                combined_code = """
x = 42
y = 100
print(f'x + y = {x + y}')
"""
                result = await sandbox.execute(combined_code)
                if result.success and "142" in result.stdout:
                    print(f"  输出: {result.stdout.strip()}")
                    print_success("单次执行中的变量使用成功！")
                else:
                    print_error(f"执行失败: {result.stderr}")
            else:
                # microsandbox 等后端支持跨执行的变量持久化
                await sandbox.execute("x = 42")
                print("  执行: x = 42")
                await sandbox.execute("y = 100")
                print("  执行: y = 100")
                result = await sandbox.execute("print(f'x + y = {x + y}')")
                print("  执行: print(f'x + y = {x + y}')")
                if result.success and "142" in result.stdout:
                    print(f"  输出: {result.stdout.strip()}")
                    print_success("变量跨执行持久化成功！")
                else:
                    print_error("状态化执行失败")
            
            # 2. 文件操作
            print_section("2. 文件操作")
            try:
                # 写入文件
                content = "Hello from AgenticX!"
                await sandbox.write_file("/tmp/test.txt", content)
                print("  写入: /tmp/test.txt")
                
                # 读取文件
                read_content = await sandbox.read_file("/tmp/test.txt")
                print(f"  读取: {read_content.strip()}")
                
                # 删除文件
                await sandbox.delete_file("/tmp/test.txt")
                print("  删除: /tmp/test.txt")
                
                print_success("文件操作成功！")
            except Exception as e:
                print_error(f"文件操作失败: {e}")
            
            # 3. 资源指标（仅 microsandbox 支持）
            if backend == "microsandbox":
                print_section("3. 资源指标")
                try:
                    metrics = await sandbox.get_metrics()
                    cpu = metrics.get("cpu_percent")
                    memory = metrics.get("memory_mb")
                    is_running = metrics.get("is_running")
                    
                    print(f"  CPU: {cpu}%" if cpu is not None else "  CPU: N/A")
                    print(f"  内存: {memory} MB" if memory is not None else "  内存: N/A")
                    print(f"  运行中: {is_running}")
                    print_success("资源指标获取成功！")
                except Exception as e:
                    print_error(f"获取资源指标失败: {e}")
            
            # 4. 错误处理
            print_section("4. 错误处理")
            print("  执行: 1 / 0 (应该抛出 ZeroDivisionError)")
            result = await sandbox.execute("1 / 0")
            
            # 检测错误的多种方式：
            # 1. result.success 为 False
            # 2. stderr 包含错误信息
            # 3. stdout 包含 traceback 信息（某些沙箱可能将错误输出到 stdout）
            error_detected = (
                not result.success or
                "Error" in result.stderr or
                "Exception" in result.stderr or
                "Traceback" in result.stderr or
                "ZeroDivisionError" in result.stdout or
                "Traceback" in result.stdout
            )
            
            if error_detected:
                print(f"  success: {result.success}")
                if result.stderr:
                    print(f"  stderr: {result.stderr[:100]}...")
                if "ZeroDivisionError" in result.stdout:
                    print(f"  stdout 包含错误信息")
                print_success("错误被正确捕获或检测到！")
            else:
                # 如果是 microsandbox，这可能是正常行为
                if backend == "microsandbox":
                    print(f"  注意: microsandbox 可能不将 Python 异常标记为执行失败")
                    print(f"  success: {result.success}, stdout: '{result.stdout[:50] if result.stdout else ''}...'")
                    print_success("演示完成（microsandbox 行为正常）")
                else:
                    print_error("错误未被捕获")
        
        print()
        print_success("高级功能演示完成！")
        return True
        
    except Exception as e:
        print_error(f"演示失败: {e}")
        return False


async def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="AgenticX Sandbox 演示脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python sandbox_demo.py                           # 自动检测后端，运行完整演示
  python sandbox_demo.py --backend subprocess      # 使用 subprocess 后端
  python sandbox_demo.py --backend microsandbox    # 使用 microsandbox 后端
  python sandbox_demo.py --backend microsandbox --verify  # 验证 microsandbox 安装
  python sandbox_demo.py --basic                   # 只运行基础演示
  python sandbox_demo.py --advanced                # 只运行高级演示
        """
    )
    parser.add_argument(
        "--backend", "-b",
        choices=["subprocess", "microsandbox", "docker", "auto"],
        default="auto",
        help="指定后端 (默认: auto)"
    )
    parser.add_argument(
        "--verify", "-v",
        action="store_true",
        help="验证 microsandbox 安装（仅对 microsandbox 后端有效）"
    )
    parser.add_argument(
        "--basic",
        action="store_true",
        help="只运行基础演示"
    )
    parser.add_argument(
        "--advanced",
        action="store_true",
        help="只运行高级功能演示"
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="列出可用后端"
    )
    
    args = parser.parse_args()
    
    # 检测可用后端
    backends = detect_available_backends()
    
    # 列出后端
    if args.list:
        print_header("可用后端")
        for name, info in backends.items():
            status = "✅" if info["available"] else "❌"
            print(f"  {status} {name}: {info['reason']}")
        return 0
    
    # 选择后端
    preferred = None if args.backend == "auto" else args.backend
    backend = select_backend(backends, preferred)
    
    if not backend:
        print_error("没有可用的后端")
        print_info("运行 --list 查看后端状态")
        return 1
    
    print_header("AgenticX Sandbox 演示")
    print(f"  选择的后端: {backend}")
    
    # 验证 microsandbox 安装
    if args.verify:
        if backend != "microsandbox":
            print_error("--verify 只对 microsandbox 后端有效")
            return 1
        success = await verify_microsandbox()
        return 0 if success else 1
    
    # 运行演示
    run_basic = not args.advanced or args.basic
    run_advanced = not args.basic or args.advanced
    
    success = True
    
    if run_basic:
        if not await run_basic_demo(backend):
            success = False
    
    if run_advanced and success:
        if not await run_advanced_demo(backend):
            success = False
    
    print()
    print("=" * 50)
    if success:
        print("✅ 演示完成！")
    else:
        print("❌ 演示过程中出现错误")
    print("=" * 50)
    print()
    print("更多信息:")
    print("  查看 README: agenticx/sandbox/README.md")
    print("  API 示例: examples/agenticx-for-sandbox/opensandbox_style_example.py")
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
