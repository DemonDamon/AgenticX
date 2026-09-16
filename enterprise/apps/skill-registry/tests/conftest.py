"""让测试能 import skill_registry。

这个服务不装成包（镜像里是直接拷源码进 /app），所以测试自己把服务根目录放进 sys.path，
而不是要求先 pip install -e 一遍。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
