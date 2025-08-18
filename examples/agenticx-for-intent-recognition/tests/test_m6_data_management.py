"""Tests for M6 Data Management Module

测试M6数据管理模块的各个组件功能。
"""

import unittest
import tempfile
import json
from pathlib import Path

from models.data_models import (
    TrainingExample, EntityAnnotation
)
from agents.models import IntentType
from tools.data_management.data_loader import DataLoaderTool
from tools.data_management.data_validation import DataValidationTool


class TestDataModels(unittest.TestCase):
    """测试数据模型"""
    
    def test_training_example_creation(self):
        """测试训练样本创建"""
        entity = EntityAnnotation(
            text="John",
            label="PERSON",
            start=0,
            end=4
        )
        
        example = TrainingExample(
            id="test1",
            text="John wants to book a flight",
            intent=IntentType.FUNCTION.value,
            entities=[entity]
        )
        
        self.assertEqual(example.text, "John wants to book a flight")
        self.assertEqual(example.intent, IntentType.FUNCTION.value)
        self.assertEqual(len(example.entities), 1)
        self.assertEqual(example.entities[0].label, "PERSON")
    
    def test_entity_annotation_validation(self):
        """测试实体标注验证"""
        # 有效的实体标注
        entity = EntityAnnotation(
            text="Paris",
            label="LOCATION",
            start=10,
            end=15
        )
        self.assertEqual(entity.label, "LOCATION")
        self.assertEqual(entity.start, 10)
        self.assertEqual(entity.end, 15)
        
        # 测试无效的位置
        with self.assertRaises(ValueError):
            EntityAnnotation(
                text="Paris",
                label="LOCATION",
                start=15,
                end=10,  # end < start
            )


class TestDataLoaderTool(unittest.TestCase):
    """测试数据加载工具"""
    
    def setUp(self):
        """设置测试环境"""
        self.loader = DataLoaderTool()
        self.temp_dir = tempfile.mkdtemp()
    
    def test_json_data_loading(self):
        """测试JSON数据加载"""
        # 创建测试JSON文件
        test_data = [
            {
                "id": "1",
                "text": "I want to book a flight",
                "intent": "FUNCTION",
                "entities": [
                    {
                        "text": "book",
                        "label": "ACTION",
                        "start": 9,
                        "end": 13
                    }
                ]
            },
            {
                "id": "2",
                "text": "Cancel my reservation",
                "intent": "FUNCTION",
                "entities": []
            }
        ]
        
        json_file = Path(self.temp_dir) / "test_data.json"
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(test_data, f)
        
        # 测试加载
        result = self.loader._run(file_path=str(json_file))
        
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].text, "I want to book a flight")
    
    def test_data_filtering(self):
        """测试数据过滤"""
        # 创建测试数据
        test_data = [
            {"id": "1", "text": "Book flight", "intent": "FUNCTION", "entities": []},
            {"id": "2", "text": "Cancel booking", "intent": "FUNCTION", "entities": []},
            {"id": "3", "text": "Check status", "intent": "GENERAL", "entities": []}
        ]
        
        json_file = Path(self.temp_dir) / "filter_test.json"
        with open(json_file, 'w') as f:
            json.dump(test_data, f)
        
        result = self.loader._run(file_path=str(json_file))
        
        self.assertEqual(len(result), 3)
    
    def test_invalid_file_handling(self):
        """测试无效文件处理"""
        with self.assertRaises(FileNotFoundError):
            self.loader._run(file_path="/nonexistent/file.json")


class TestDataValidatorTool(unittest.TestCase):
    """测试数据验证工具"""
    
    def setUp(self):
        """设置测试环境"""
        self.validator = DataValidationTool()
    
    def test_valid_data_validation(self):
        """测试有效数据验证"""
        samples = [
            TrainingExample(
                id="1",
                text="Book a flight to Paris",
                intent=IntentType.FUNCTION.value,
                entities=[
                    EntityAnnotation(text="Paris", label="LOCATION", start=17, end=22)
                ]
            ),
            TrainingExample(
                id="2",
                text="Cancel my booking",
                intent=IntentType.FUNCTION.value,
                entities=[]
            )
        ]
        
        result = self.validator._run(examples=[s.model_dump() for s in samples])
        
        self.assertTrue(result["is_valid"])
        self.assertEqual(result["total_samples"], 2)
    
    def test_duplicate_detection(self):
        """测试重复检测"""
        samples = [
            TrainingExample(
                id="1",
                text="Book a flight",
                intent=IntentType.FUNCTION.value,
                entities=[]
            ),
            TrainingExample(
                id="2",
                text="Book a flight",
                intent=IntentType.FUNCTION.value,
                entities=[]
            )
        ]
        
        result = self.validator._run(examples=[s.model_dump() for s in samples])
        
        self.assertFalse(result["is_valid"])
        self.assertIn("Found 1 duplicate samples", result["issues"][0])