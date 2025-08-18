# 测试文件运行指南

本目录包含了意图识别系统的各个模块测试文件。以下是各个测试文件的运行命令：

## 测试文件列表

### 1. 基础测试 (test_basic.py)
测试AgenticX框架的基础功能

```bash
# 运行基础测试
python -m pytest tests/test_basic.py -v

# 或者直接运行
python tests/test_basic.py
```

### 2. M1模块 - 意图识别Agent测试 (test_m1_intent_agents.py)
测试IntentRecognitionAgent、GeneralIntentAgent、SearchIntentAgent和FunctionIntentAgent的功能

```bash
# 运行M1模块测试
python -m pytest tests/test_m1_intent_agents.py -v

# 或者直接运行
python tests/test_m1_intent_agents.py
```

### 3. M2模块 - 实体抽取测试 (test_m2_entity_extraction.py)
测试实体抽取相关的工具和功能

```bash
# 运行M2模块测试
python -m pytest tests/test_m2_entity_extraction.py -v

# 运行特定测试类
python -m pytest tests/test_m2_entity_extraction.py::TestUIEExtractor -v
python -m pytest tests/test_m2_entity_extraction.py::TestLLMExtractor -v
python -m pytest tests/test_m2_entity_extraction.py::TestRuleExtractor -v
python -m pytest tests/test_m2_entity_extraction.py::TestHybridExtractor -v
```

### 4. M3模块 - 规则匹配测试 (test_m3_rule_matching.py)
测试规则匹配工具的各种功能

```bash
# 运行M3模块测试
python -m pytest tests/test_m3_rule_matching.py -v

# 运行特定测试类
python -m pytest tests/test_m3_rule_matching.py::TestRuleMatchingTool -v
python -m pytest tests/test_m3_rule_matching.py::TestRuleMatchingIntegration -v
```

### 5. M4模块 - 工作流测试 (test_m4_workflows.py)
测试意图处理工作流的功能

```bash
# 运行M4模块测试
python -m pytest tests/test_m4_workflows.py -v

# 运行特定测试类
python -m pytest tests/test_m4_workflows.py::TestIntentRecognitionWorkflow -v
python -m pytest tests/test_m4_workflows.py::TestGeneralIntentWorkflow -v
python -m pytest tests/test_m4_workflows.py::TestSearchIntentWorkflow -v
python -m pytest tests/test_m4_workflows.py::TestFunctionIntentWorkflow -v
```

### 6. M5模块 - 后处理测试 (test_m5_post_processing.py)
测试后处理工具的各项功能

```bash
# 运行M5模块测试
python -m pytest tests/test_m5_post_processing.py -v

# 运行特定测试类
python -m pytest tests/test_m5_post_processing.py::TestConfidenceAdjustmentTool -v
python -m pytest tests/test_m5_post_processing.py::TestResultValidationTool -v
python -m pytest tests/test_m5_post_processing.py::TestConflictResolutionTool -v
python -m pytest tests/test_m5_post_processing.py::TestEntityOptimizationTool -v
python -m pytest tests/test_m5_post_processing.py::TestIntentRefinementTool -v
python -m pytest tests/test_m5_post_processing.py::TestPostProcessingTool -v

# 运行特定测试方法（例如类型标准化测试）
python -m pytest tests/test_m5_post_processing.py::TestEntityOptimizationTool::test_type_standardization -v
```

### 7. M6模块 - 数据管理测试 (test_m6_data_management.py)
测试M6数据管理模块的各个组件功能

```bash
# 运行M6数据管理模块测试
python -m pytest tests/test_m6_data_management.py -v

# 运行特定测试类
python -m pytest tests/test_m6_data_management.py::TestDataModels -v
python -m pytest tests/test_m6_data_management.py::TestDataLoaderTool -v
python -m pytest tests/test_m6_data_management.py::TestDataValidatorTool -v

# 运行特定测试方法
python -m pytest tests/test_m6_data_management.py::TestDataModels::test_training_example_creation -v
python -m pytest tests/test_m6_data_management.py::TestDataLoaderTool::test_json_data_loading -v
python -m pytest tests/test_m6_data_management.py::TestDataValidatorTool::test_valid_data_validation -v
```

### 8. M6模块 - 简化数据管理测试 (test_m6_simple.py)
测试M6数据管理模块的简化功能

```bash
# 运行M6简化测试
python -m pytest tests/test_m6_simple.py -v

# 或者直接运行
python tests/test_m6_simple.py

# 运行特定测试方法
python -m pytest tests/test_m6_simple.py::TestM6Simple::test_data_loader_tool -v
python -m pytest tests/test_m6_simple.py::TestM6Simple::test_data_validation_tool -v
python -m pytest tests/test_m6_simple.py::TestM6Simple::test_data_manager -v
python -m pytest tests/test_m6_simple.py::TestM6Simple::test_data_import_workflow -v
```

### 9. M8模块 - API服务层测试 (test_m8_api_service.py)
测试M8 API服务层的集成测试

```bash
# 运行M8 API服务层测试
python -m pytest tests/test_m8_api_service.py -v

# 运行特定测试类
python -m pytest tests/test_m8_api_service.py::TestM8APIService -v

# 运行特定测试方法
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_intent_recognition_endpoint -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_batch_intent_recognition_endpoint -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_entity_extraction_endpoint -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_health_check_endpoint -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_cors_headers -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_invalid_request_validation -v

# 运行异步测试
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_intent_service_gateway -v
python -m pytest tests/test_m8_api_service.py::TestM8APIService::test_concurrent_requests -v
```

## 批量运行测试

### 运行所有测试
```bash
# 运行tests目录下的所有测试
python -m pytest tests/ -v

# 运行所有测试并显示覆盖率
python -m pytest tests/ --cov=tools --cov=agents --cov=workflows -v
```

### 运行特定模块的所有测试
```bash
# 运行所有M1-M5模块测试
python -m pytest tests/test_m1_intent_agents.py tests/test_m2_entity_extraction.py tests/test_m3_rule_matching.py tests/test_m4_workflows.py tests/test_m5_post_processing.py -v

# 运行所有M6模块测试
python -m pytest tests/test_m6_data_management.py tests/test_m6_simple.py -v

# 运行M8模块测试
python -m pytest tests/test_m8_api_service.py -v

# 运行所有模块测试
python -m pytest tests/test_m1_intent_agents.py tests/test_m2_entity_extraction.py tests/test_m3_rule_matching.py tests/test_m4_workflows.py tests/test_m5_post_processing.py tests/test_m6_data_management.py tests/test_m6_simple.py tests/test_m8_api_service.py -v
```

### 并行运行测试（需要安装pytest-xdist）
```bash
# 安装pytest-xdist
pip install pytest-xdist

# 并行运行测试
python -m pytest tests/ -n auto -v
```

## 测试输出选项

```bash
# 详细输出
python -m pytest tests/ -v

# 简洁输出
python -m pytest tests/ -q

# 显示测试覆盖率
python -m pytest tests/ --cov=tools --cov=agents --cov=workflows

# 生成HTML覆盖率报告
python -m pytest tests/ --cov=tools --cov=agents --cov=workflows --cov-report=html

# 只运行失败的测试
python -m pytest tests/ --lf

# 在第一个失败时停止
python -m pytest tests/ -x
```

## 环境要求

运行测试前请确保：

1. 已安装所有依赖包：
   ```bash
   pip install -r requirements.txt
   ```

2. 设置环境变量（如果需要）：
   ```bash
   # 设置API密钥等环境变量
   export KIMI_API_KEY="your_api_key"
   export KIMI_API_BASE="https://api.moonshot.cn/v1"
   ```

3. 确保在项目根目录运行测试命令，以避免模块导入错误。

## 故障排除

如果遇到 `ModuleNotFoundError: No module named 'tools'` 错误：

1. 确保在项目根目录运行测试
2. 使用 `python -m pytest` 而不是直接运行 `python tests/test_xxx.py`
3. 检查PYTHONPATH设置

```bash
# 正确的运行方式
cd d:\myWorks\AgenticX\examples\agenticx-for-intent-recognition
python -m pytest tests/test_m5_post_processing.py -v
```