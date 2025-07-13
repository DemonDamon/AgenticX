import json
import subprocess
import os

def test_openmemory_direct():
    # 设置环境变量
    env = dict(os.environ)
    env.update({
        "OPENMEMORY_API_KEY": "om-v47yq572lgpjbadx9gvpot73v657n35w",
        "CLIENT_NAME": "cursor"
    })
    
    # 构造请求
    request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "clientInfo": {"name": "DirectTest", "version": "1.0.0"}
        }
    }
    
    # 执行命令
    result = subprocess.run(
        ["npx", "-y", "openmemory"],
        input=json.dumps(request).encode('utf-8'),
        capture_output=True,
        env=env,
        shell=True  # 在 Windows 上需要 shell=True
    )
    
    # 打印结果
    print("=== OpenMemory 直接调用测试 ===")
    print(f"返回码: {result.returncode}")
    print(f"stdout: {result.stdout.decode('utf-8', 'ignore')}")
    print(f"stderr: {result.stderr.decode('utf-8', 'ignore')}")

if __name__ == "__main__":
    test_openmemory_direct() 