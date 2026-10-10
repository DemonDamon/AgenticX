"""让测试能 import context_service。

这个服务不装成包（镜像里是直接拷源码进 /app），所以测试自己把服务根目录放进
sys.path，与 skill-registry 的约定一致。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
