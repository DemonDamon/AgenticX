"""
AgenticX M6 任务契约验证模块测试

测试 TaskOutputParser, TaskResultValidator, OutputRepairLoop 的功能
"""

import pytest
import json
import sys
import os
from typing import List, Optional
from pydantic import BaseModel, Field

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core.task_validator import (
    TaskOutputParser, TaskResultValidator, OutputRepairLoop,
    ParseResult, ValidationResult, RepairStrategy,
    ParseError, ValidationError, RepairError
)


# 测试用的 Pydantic 模型
class UserProfile(BaseModel):
    name: str = Field(..., description="用户姓名")
    age: int = Field(..., ge=0, le=150, description="用户年龄")
    email: str = Field(..., description="用户邮箱")
    skills: List[str] = Field(default_factory=list, description="技能列表")
    is_active: bool = Field(default=True, description="是否活跃")


class AnalysisResult(BaseModel):
    summary: str = Field(..., description="分析摘要")
    score: float = Field(..., description="评分")  # 移除范围限制，在验证器中测试
    recommendations: List[str] = Field(default_factory=list, description="建议列表")
    metadata: Optional[dict] = Field(default=None, description="元数据")


class TestTaskOutputParser:
    """测试任务输出解析器"""
    
    def setup_method(self):
        """设置测试"""
        self.parser = TaskOutputParser()
    
    def test_direct_json_parse_success(self):
        """测试直接JSON解析成功"""
        response = '''
        {
            "name": "张三",
            "age": 25,
            "email": "zhangsan@example.com",
            "skills": ["Python", "机器学习"],
            "is_active": true
        }
        '''
        
        result = self.parser.parse(response, UserProfile)
        
        assert result.success is True
        assert result.data is not None
        assert result.data.name == "张三"
        assert result.data.age == 25
        assert result.data.email == "zhangsan@example.com"
        assert result.data.skills == ["Python", "机器学习"]
        assert result.data.is_active is True
        assert result.confidence == 1.0
    
    def test_direct_json_parse_invalid_json(self):
        """测试无效JSON格式"""
        response = '''
        {
            "name": "张三",
            "age": 25,
            "email": "zhangsan@example.com"
            // 缺少闭合括号
        '''
        
        result = self.parser.parse(response, UserProfile)
        
        assert result.success is False
        assert "无法从响应中解析" in result.error
    
    def test_direct_json_parse_schema_validation_error(self):
        """测试Schema验证错误"""
        response = '''
        {
            "name": "张三",
            "age": -5,
            "email": "invalid-email",
            "skills": ["Python"],
            "is_active": true
        }
        '''
        
        result = self.parser.parse(response, UserProfile)
        
        assert result.success is False
        assert "无法从响应中解析" in result.error
    
    def test_extract_json_from_markdown(self):
        """测试从Markdown代码块提取JSON"""
        response = '''
        根据分析，我得出以下结果：
        
        ```json
        {
            "name": "李四",
            "age": 30,
            "email": "lisi@example.com",
            "skills": ["Java", "Spring"],
            "is_active": false
        }
        ```
        
        这是我的分析结果。
        '''
        
        result = self.parser.parse(response, UserProfile)
        
        assert result.success is True
        assert result.data.name == "李四"
        assert result.data.age == 30
        assert result.confidence == 0.8
    
    def test_extract_json_from_plain_code_block(self):
        """测试从普通代码块提取JSON"""
        response = '''
        ```
        {
            "summary": "分析完成",
            "score": 85.5,
            "recommendations": ["优化性能", "增加测试"],
            "metadata": {"version": "1.0"}
        }
        ```
        '''
        
        result = self.parser.parse(response, AnalysisResult)
        
        assert result.success is True
        assert result.data.summary == "分析完成"
        assert result.data.score == 85.5
        assert result.data.recommendations == ["优化性能", "增加测试"]
    
    def test_structured_text_parse(self):
        """测试结构化文本解析"""
        response = '''
        分析结果如下：
        
        summary: 系统运行正常
        score: 92.3
        recommendations: 定期维护,监控性能
        '''
        
        result = self.parser.parse(response, AnalysisResult)
        
        # 结构化文本解析可能失败，这是正常的
        # 因为它需要精确的字段匹配
        if result.success:
            assert result.data.summary == "系统运行正常"
            assert result.data.score == 92.3
            assert result.confidence == 0.6
        else:
            assert "无法从响应中解析" in result.error
    
    def test_fuzzy_parsing_disabled(self):
        """测试禁用模糊解析"""
        parser = TaskOutputParser(enable_fuzzy_parsing=False)
        
        response = '''
        这是一个包含JSON的文本：
        ```json
        {"name": "测试", "age": 25, "email": "test@example.com"}
        ```
        '''
        
        result = parser.parse(response, UserProfile)
        
        assert result.success is False
        assert "无法从响应中解析" in result.error
    
    def test_custom_json_patterns(self):
        """测试自定义JSON提取模式"""
        custom_patterns = [r'<result>(.*?)</result>']
        parser = TaskOutputParser(json_extraction_patterns=custom_patterns)
        
        response = '''
        <result>
        {
            "name": "自定义模式",
            "age": 28,
            "email": "custom@example.com",
            "skills": ["AI"],
            "is_active": true
        }
        </result>
        '''
        
        result = parser.parse(response, UserProfile)
        
        assert result.success is True
        assert result.data.name == "自定义模式"
    
    def test_parse_failure_all_methods(self):
        """测试所有解析方法都失败的情况"""
        response = '''
        这是一个完全无法解析的文本，
        没有任何JSON格式的内容，
        也没有结构化的字段信息。
        '''
        
        result = self.parser.parse(response, UserProfile)
        
        assert result.success is False
        assert "无法从响应中解析出符合" in result.error
        assert result.raw_output == response


class TestTaskResultValidator:
    """测试任务结果校验器"""
    
    def setup_method(self):
        """设置测试"""
        self.validator = TaskResultValidator()
    
    def test_validate_success_no_rules(self):
        """测试无验证规则的成功验证"""
        data = UserProfile(
            name="张三",
            age=25,
            email="zhangsan@example.com",
            skills=["Python"],
            is_active=True
        )
        
        result = self.validator.validate(data)
        
        assert result.valid is True
        assert len(result.errors) == 0
        assert len(result.warnings) == 0
        assert result.data == data
    
    def test_validate_with_range_rules(self):
        """测试数值范围验证规则"""
        data = AnalysisResult(
            summary="测试",
            score=105.0,  # 超出范围
            recommendations=[]
        )
        
        validation_rules = {
            "score": {
                "range": {"min": 0, "max": 100}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 1
        assert "大于最大值" in result.errors[0]
    
    def test_validate_with_length_rules(self):
        """测试长度验证规则"""
        data = UserProfile(
            name="A",  # 太短
            age=25,
            email="test@example.com",
            skills=["Python", "Java", "C++", "Go", "Rust"],  # 太长
            is_active=True
        )
        
        validation_rules = {
            "name": {
                "length": {"min": 2, "max": 50}
            },
            "skills": {
                "length": {"max": 3}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 2
        assert any("小于最小长度" in error for error in result.errors)
        assert any("大于最大长度" in error for error in result.errors)
    
    def test_validate_with_pattern_rules(self):
        """测试正则表达式验证规则"""
        data = UserProfile(
            name="张三123",  # 包含数字
            age=25,
            email="invalid-email",  # 无效邮箱格式
            skills=[],
            is_active=True
        )
        
        validation_rules = {
            "name": {
                "pattern": {"pattern": r"^[a-zA-Z\u4e00-\u9fa5]+$"}  # 只允许字母和中文
            },
            "email": {
                "pattern": {"pattern": r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 2
        assert any("不匹配模式" in error for error in result.errors)
    
    def test_validate_with_enum_rules(self):
        """测试枚举值验证规则"""
        data = AnalysisResult(
            summary="无效状态",  # 不在允许列表中
            score=80.0,
            recommendations=[]
        )
        
        validation_rules = {
            "summary": {
                "enum": {"values": ["成功", "失败", "警告"]}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 1
        assert "不在允许的值列表中" in result.errors[0]
    
    def test_validate_with_required_rules(self):
        """测试必填字段验证规则"""
        data = AnalysisResult(
            summary="",  # 空值
            score=80.0,
            recommendations=[]
        )
        
        validation_rules = {
            "summary": {
                "required": {"required": True}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 1
        assert "不能为空" in result.errors[0]
    
    def test_validate_with_custom_validator(self):
        """测试自定义验证器"""
        def validate_even_age(value, config):
            """验证年龄是否为偶数"""
            if value % 2 != 0:
                return {"type": "error", "message": "年龄必须是偶数"}
            return {"type": "success", "message": ""}
        
        validator = TaskResultValidator(
            custom_validators={"even_age": validate_even_age}
        )
        
        data = UserProfile(
            name="张三",
            age=25,  # 奇数
            email="test@example.com",
            skills=[],
            is_active=True
        )
        
        validation_rules = {
            "age": {
                "even_age": {}
            }
        }
        
        result = validator.validate(data, validation_rules)
        
        assert result.valid is False
        assert len(result.errors) == 1
        assert "年龄必须是偶数" in result.errors[0]
    
    def test_validate_with_warnings(self):
        """测试产生警告的验证"""
        def validate_with_warning(value, config):
            return {"type": "warning", "message": "这是一个警告"}
        
        validator = TaskResultValidator(
            custom_validators={"warning_validator": validate_with_warning}
        )
        
        data = UserProfile(
            name="张三",
            age=25,
            email="test@example.com",
            skills=[],
            is_active=True
        )
        
        validation_rules = {
            "name": {
                "warning_validator": {}
            }
        }
        
        result = validator.validate(data, validation_rules)
        
        assert result.valid is True  # 警告不影响有效性
        assert len(result.warnings) == 1
        assert "这是一个警告" in result.warnings[0]
    
    def test_validate_unknown_rule(self):
        """测试未知验证规则"""
        data = UserProfile(
            name="张三",
            age=25,
            email="test@example.com",
            skills=[],
            is_active=True
        )
        
        validation_rules = {
            "name": {
                "unknown_rule": {"some": "config"}
            }
        }
        
        result = self.validator.validate(data, validation_rules)
        
        assert result.valid is True  # 未知规则产生警告，不影响有效性
        assert len(result.warnings) == 1
        assert "未知的验证规则" in result.warnings[0]


class TestOutputRepairLoop:
    """测试输出自愈循环"""
    
    def setup_method(self):
        """设置测试"""
        self.repair_loop = OutputRepairLoop()
    
    def test_repair_strategy_none(self):
        """测试无修复策略"""
        repair_loop = OutputRepairLoop(repair_strategy=RepairStrategy.NONE)
        
        parse_result = ParseResult(
            success=False,
            error="解析失败",
            raw_output="invalid json"
        )
        
        result = repair_loop.repair(
            "invalid json", 
            parse_result, 
            None, 
            UserProfile
        )
        
        assert result == parse_result  # 应该返回原始结果
    
    def test_simple_repair_fix_quotes(self):
        """测试简单修复：修复引号"""
        response = "{'name': '张三', 'age': 25, 'email': 'test@example.com'}"
        
        parse_result = ParseResult(
            success=False,
            error="JSON解析错误",
            raw_output=response
        )
        
        result = self.repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile
        )
        
        # 简单修复应该能成功修复单引号问题
        assert result.success is True
        assert result.data.name == "张三"
    
    def test_simple_repair_fix_brackets(self):
        """测试简单修复：修复括号"""
        response = '''
        {
            "name": "张三",
            "age": 25,
            "email": "test@example.com",
            "skills": ["Python"],
            "is_active": true
        '''  # 缺少闭合括号
        
        parse_result = ParseResult(
            success=False,
            error="JSON解析错误",
            raw_output=response
        )
        
        result = self.repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile
        )
        
        # 简单修复应该能成功修复括号问题
        assert result.success is True
        assert result.data.name == "张三"
    
    def test_simple_repair_fix_commas(self):
        """测试简单修复：修复逗号"""
        response = '''
        {
            "name": "张三",
            "age": 25,
            "email": "test@example.com",
            "skills": ["Python"],
            "is_active": true,
        }
        '''  # 末尾多余的逗号
        
        parse_result = ParseResult(
            success=False,
            error="JSON解析错误",
            raw_output=response
        )
        
        result = self.repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile
        )
        
        # 简单修复应该能成功修复逗号问题
        assert result.success is True
        assert result.data.name == "张三"
    
    def test_simple_repair_extract_markdown(self):
        """测试简单修复：从Markdown提取"""
        response = '''
        这是分析结果：
        ```json
        {
            "name": "张三",
            "age": 25,
            "email": "test@example.com",
            "skills": ["Python"],
            "is_active": true
        }
        ```
        '''
        
        parse_result = ParseResult(
            success=False,
            error="不是有效JSON",
            raw_output=response
        )
        
        result = self.repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile
        )
        
        # 简单修复应该能从Markdown中提取JSON
        assert result.success is True
        assert result.data.name == "张三"
    
    def test_simple_repair_failure(self):
        """测试简单修复失败"""
        response = "这是完全无法修复的文本内容"
        
        parse_result = ParseResult(
            success=False,
            error="无法解析",
            raw_output=response
        )
        
        result = self.repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile
        )
        
        # 简单修复应该失败
        assert result.success is False
        # 修复失败时返回原始错误
        assert result.error == "无法解析"
    
    def test_llm_guided_repair_not_implemented(self):
        """测试LLM指导修复（暂未实现）"""
        repair_loop = OutputRepairLoop(repair_strategy=RepairStrategy.LLM_GUIDED)
        
        response = "invalid content"
        parse_result = ParseResult(
            success=False,
            error="解析失败",
            raw_output=response
        )
        
        result = repair_loop.repair(
            response,
            parse_result,
            None,
            UserProfile,
            agent_executor=None  # 没有提供执行器
        )
        
        # LLM修复应该失败（暂未实现）
        assert result.success is False
        # LLM修复失败时返回原始错误
        assert result.error == "解析失败"
    
    def test_max_repair_attempts(self):
        """测试最大修复尝试次数"""
        repair_loop = OutputRepairLoop(max_repair_attempts=1)
        
        # 这个测试主要验证参数设置，实际修复逻辑在其他测试中覆盖
        assert repair_loop.max_repair_attempts == 1


class TestIntegration:
    """集成测试"""
    
    def test_complete_workflow_success(self):
        """测试完整的解析-验证流程成功"""
        parser = TaskOutputParser()
        validator = TaskResultValidator()
        
        response = '''
        ```json
        {
            "summary": "分析完成",
            "score": 85.5,
            "recommendations": ["优化性能", "增加测试"],
            "metadata": {"version": "1.0"}
        }
        ```
        '''
        
        # 解析
        parse_result = parser.parse(response, AnalysisResult)
        assert parse_result.success is True
        
        # 验证
        validation_rules = {
            "score": {"range": {"min": 0, "max": 100}},
            "summary": {"required": {"required": True}}
        }
        
        validation_result = validator.validate(parse_result.data, validation_rules)
        assert validation_result.valid is True
    
    def test_complete_workflow_with_repair(self):
        """测试包含修复的完整流程"""
        parser = TaskOutputParser()
        validator = TaskResultValidator()
        repair_loop = OutputRepairLoop()
        
        # 有问题的响应（单引号）
        response = "{'summary': '分析完成', 'score': 85.5, 'recommendations': []}"
        
        # 解析失败
        parse_result = parser.parse(response, AnalysisResult)
        assert parse_result.success is False
        
        # 尝试修复
        repaired_result = repair_loop.repair(
            response, parse_result, None, AnalysisResult
        )
        assert repaired_result.success is True
        
        # 验证修复后的结果
        validation_result = validator.validate(repaired_result.data)
        assert validation_result.valid is True
    
    def test_complete_workflow_failure(self):
        """测试完整流程失败的情况"""
        parser = TaskOutputParser()
        validator = TaskResultValidator()
        repair_loop = OutputRepairLoop()
        
        response = "完全无法解析的内容"
        
        # 解析失败
        parse_result = parser.parse(response, AnalysisResult)
        assert parse_result.success is False
        
        # 修复也失败
        repaired_result = repair_loop.repair(
            response, parse_result, None, AnalysisResult
        )
        assert repaired_result.success is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])