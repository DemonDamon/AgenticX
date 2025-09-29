# Test.PyPI.org 发布指南

## 问题说明

当从test.pypi.org安装AgenticX时，会遇到依赖问题，主要原因是：

1. **pydantic版本不兼容**: test.pypi.org上只有pydantic 1.4a1和1.5a1版本，没有2.x版本
2. **许多AI/ML包不可用**: 大多数AI相关的包（如litellm、openai、anthropic等）在test.pypi.org上不可用

## 解决方案

我们提供了两种解决方案：

### 方案1: 使用最小依赖构建 (推荐)

1. **设置环境变量构建**:
   ```bash
   python build_for_testpypi.py
   ```

2. **上传到test.pypi.org**:
   ```bash
   twine upload --repository testpypi dist/*
   ```

3. **安装测试**:
   ```bash
   pip install -i https://test.pypi.org/simple/ agenticx
   ```

### 方案2: 混合安装

从test.pypi.org安装核心包，然后从正式PyPI安装其他依赖：

```bash
# 1. 从test.pypi.org安装核心包
pip install -i https://test.pypi.org/simple/ agenticx

# 2. 从正式PyPI安装完整依赖
pip install -r requirements.txt
```

## 文件说明

- `requirements-testpypi.txt`: test.pypi.org兼容的最小依赖
- `build_for_testpypi.py`: 专用构建脚本
- `setup.py`: 已修改支持环境变量控制依赖

## 环境变量

- `USE_TESTPYPI_DEPS=true`: 使用test.pypi.org兼容的最小依赖

## 注意事项

⚠️ **重要**: test.pypi.org版本只包含核心功能，以下功能将不可用：
- LLM集成 (OpenAI, Anthropic, Ollama等)
- 向量数据库 (ChromaDB, Qdrant等)
- 监控和可观测性
- 完整的工具集成

如需完整功能，请从正式PyPI安装：
```bash
pip install agenticx
```

## 测试安装命令

```bash
# 测试最小安装
pip install -i https://test.pypi.org/simple/ agenticx==0.2.3

# 如果遇到依赖问题，可以跳过依赖检查
pip install -i https://test.pypi.org/simple/ --no-deps agenticx==0.2.3
```