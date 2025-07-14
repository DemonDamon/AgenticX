# AgenticX 包构建和发布指南

## 📦 文件结构

现在您的项目已经具备了完整的Python包发布结构：

```
AgenticX/
├── agenticx/                    # 主包目录
│   ├── __init__.py             # 包初始化文件（包含版本号）
│   ├── cli.py                  # CLI命令行界面
│   └── ...                     # 其他模块
├── tests/                      # 测试目录
├── examples/                   # 示例目录
├── setup.py                    # 传统的包配置文件
├── pyproject.toml             # 现代Python包配置文件
├── requirements.txt           # 依赖列表
├── MANIFEST.in               # 包含文件清单
├── LICENSE                   # 许可证文件
├── README.md                 # 英文文档
├── README_ZN.md              # 中文文档
├── build_and_publish.py      # 构建和发布脚本
└── PACKAGING.md              # 本文档
```

## 🔧 环境准备

### 1. 安装构建工具

```bash
pip install build twine wheel
```

### 2. 配置PyPI账户

#### 注册账户
- 正式PyPI: https://pypi.org/account/register/
- 测试PyPI: https://test.pypi.org/account/register/

#### 配置认证
创建 `~/.pypirc` 文件：

```ini
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-你的API令牌

[testpypi]
repository = https://test.pypi.org/legacy/
username = __token__
password = pypi-你的测试API令牌
```

## 🚀 构建和发布流程

### 方法1：使用自动化脚本

```bash
# 完整流程（推荐）
python build_and_publish.py --all

# 或者分步执行
python build_and_publish.py --clean    # 清理构建目录
python build_and_publish.py --build    # 构建包
python build_and_publish.py --check    # 检查包
python build_and_publish.py --test-pypi # 发布到测试PyPI
python build_and_publish.py --pypi     # 发布到正式PyPI
```

### 方法2：手动执行

#### 1. 清理构建目录
```bash
rm -rf build/ dist/ agenticx.egg-info/
```

#### 2. 构建包
```bash
python -m build
```

#### 3. 检查包
```bash
python -m twine check dist/*
```

#### 4. 发布到测试PyPI
```bash
python -m twine upload --repository testpypi dist/*
```

#### 5. 测试安装
```bash
pip install --index-url https://test.pypi.org/simple/ agenticx
```

#### 6. 发布到正式PyPI
```bash
python -m twine upload dist/*
```

## 📝 发布前检查清单

### 代码质量
- [ ] 所有测试通过
- [ ] 代码覆盖率满足要求
- [ ] 代码风格检查通过
- [ ] 文档更新完整

### 版本管理
- [ ] 更新 `agenticx/__init__.py` 中的版本号
- [ ] 更新 `README.md` 中的版本信息
- [ ] 创建Git标签: `git tag v0.1.0`
- [ ] 推送标签: `git push origin v0.1.0`

### 依赖管理
- [ ] 检查 `requirements.txt` 中的依赖版本
- [ ] 确保所有依赖都可以正常安装
- [ ] 检查依赖冲突

### 文档完整性
- [ ] README.md 内容完整
- [ ] 示例代码可以正常运行
- [ ] API文档更新
- [ ] 变更日志更新

## 🎯 版本管理策略

### 语义化版本控制
- `MAJOR.MINOR.PATCH` (例如: 1.2.3)
- `MAJOR`: 不兼容的API修改
- `MINOR`: 向后兼容的功能性新增
- `PATCH`: 向后兼容的问题修正

### 版本号更新
在 `agenticx/__init__.py` 中修改：
```python
__version__ = "0.1.0"  # 修改这里
```

## 🧪 测试发布

### 1. 发布到测试PyPI
```bash
python -m twine upload --repository testpypi dist/*
```

### 2. 测试安装
```bash
# 创建新的虚拟环境
python -m venv test_env
source test_env/bin/activate  # Linux/Mac
# 或
test_env\Scripts\activate     # Windows

# 从测试PyPI安装
pip install --index-url https://test.pypi.org/simple/ agenticx

# 测试导入
python -c "import agenticx; print(agenticx.__version__)"

# 测试CLI
agenticx --help
```

## 📊 发布后维护

### 监控和反馈
- 关注PyPI下载统计
- 处理用户反馈和Issues
- 定期更新依赖版本

### 持续集成
建议设置GitHub Actions自动化：
```yaml
name: Publish to PyPI

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.10'
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install build twine
    - name: Build package
      run: python -m build
    - name: Publish to PyPI
      uses: pypa/gh-action-pypi-publish@release/v1
      with:
        password: ${{ secrets.PYPI_API_TOKEN }}
```

## 🔍 常见问题

### 1. 包名冲突
如果包名已被占用，需要修改 `setup.py` 和 `pyproject.toml` 中的包名。

### 2. 依赖版本冲突
检查 `requirements.txt` 中的版本约束，确保兼容性。

### 3. 上传失败
- 检查网络连接
- 验证API令牌是否正确
- 确保版本号没有重复

### 4. 导入失败
- 检查包结构是否正确
- 确保 `__init__.py` 文件存在
- 验证模块导入路径

## 📚 参考资源

- [Python打包指南](https://packaging.python.org/)
- [PyPI用户指南](https://pypi.org/help/)
- [setuptools文档](https://setuptools.pypa.io/)
- [twine文档](https://twine.readthedocs.io/)

## 🎉 恭喜！

完成这些步骤后，您的AgenticX包就可以通过以下方式安装：

```bash
pip install agenticx
```

用户可以使用：
```python
import agenticx
from agenticx import Agent, Task, LLM

# 或者使用CLI
agenticx --help
```

祝您发布成功！🚀 