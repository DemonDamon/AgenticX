from agenticx.tools.base import BaseTool
from models.data_models import TrainingExample
from typing import List, Dict
from pydantic import BaseModel
from collections import Counter

class DataValidationToolInput(BaseModel):
    examples: List[Dict]

class DataValidationTool(BaseTool):
    def __init__(self):
        super().__init__(
            name="data_validation_tool",
            description="Validates a list of training examples.",
            args_schema=DataValidationToolInput
        )

    def _run(self, examples: List[Dict]) -> Dict:
        issues = []
        
        # Check for duplicates
        texts = [e['text'] for e in examples]
        text_counts = Counter(texts)
        num_duplicates = len([t for t, c in text_counts.items() if c > 1])
        if num_duplicates > 0:
            issues.append(f"Found {num_duplicates} duplicate samples")

        for ex in examples:
            try:
                TrainingExample(**ex)
            except Exception as e:
                issues.append(f"Validation error for example {ex.get('id', 'N/A')}: {e}")

        return {
            "is_valid": len(issues) == 0,
            "issues": issues,
            "total_samples": len(examples)
        }