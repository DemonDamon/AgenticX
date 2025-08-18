import pandas as pd
from agenticx.tools.base import BaseTool
from models.data_models import TrainingExample
from typing import List
from pydantic import BaseModel
import json

class DataLoaderToolInput(BaseModel):
    file_path: str

class DataLoaderTool(BaseTool):
    def __init__(self):
        super().__init__(
            name="data_loader_tool",
            description="Loads training data from a CSV or JSON file.",
            args_schema=DataLoaderToolInput
        )

    def _run(self, file_path: str) -> List[TrainingExample]:
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
            examples = []
            for _, row in df.iterrows():
                examples.append(
                    TrainingExample(
                        id=str(row["id"]),
                        text=row["text"],
                        intent=row["intent"],
                        entities=[]
                    )
                )
            return examples
        elif file_path.endswith('.json'):
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            examples = [TrainingExample(**item) for item in data]
            return examples
        else:
            raise ValueError("Unsupported file format. Please use CSV or JSON.")