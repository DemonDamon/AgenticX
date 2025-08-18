import unittest
import os
import sys
import pandas as pd

# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from models.data_models import TrainingExample, EntityAnnotation, Dataset
from storage.manager import DataManager
from tools.data_management.data_loader import DataLoaderTool
from tools.data_management.data_validation import DataValidationTool
from workflows.data_processing.data_import import DataImportWorkflow

class TestM6Simple(unittest.TestCase):

    def setUp(self):
        self.db_path = "test_db.sqlite"
        self.data_manager = DataManager(self.db_path)
        self.csv_path = "test_data.csv"

        # Create a dummy CSV for testing
        data = {
            "id": ["1", "2"],
            "text": ["hello world", "goodbye world"],
            "intent": ["greeting", "farewell"]
        }
        df = pd.DataFrame(data)
        df.to_csv(self.csv_path, index=False)

    def tearDown(self):
        self.data_manager.unified_manager.kv_storage.close()
        if os.path.exists(self.db_path):
            os.remove(self.db_path)
        if os.path.exists(self.csv_path):
            os.remove(self.csv_path)

    def test_data_loader_tool(self):
        data_loader = DataLoaderTool()
        examples = data_loader._run(file_path=self.csv_path)
        self.assertEqual(len(examples), 2)
        self.assertEqual(examples[0].text, "hello world")

    def test_data_validation_tool(self):
        data_validation = DataValidationTool()
        examples = [{"id": "1", "text": "test", "intent": "test"}]
        result = data_validation._run(examples=examples)
        self.assertTrue(result["is_valid"])

    def test_data_manager(self):
        example = TrainingExample(id="1", text="test", intent="test", entities=[])
        self.data_manager.save_training_example(example)
        retrieved_dataset = self.data_manager.get_dataset_by_version("v1")
        self.assertEqual(len(retrieved_dataset.examples), 1)
        self.assertEqual(retrieved_dataset.examples[0].text, "test")

    def test_data_import_workflow(self):
        workflow = DataImportWorkflow()
        result = workflow._run(file_path=self.csv_path)
        self.assertTrue(result["validate_data"]["is_valid"])

if __name__ == '__main__':
    unittest.main()