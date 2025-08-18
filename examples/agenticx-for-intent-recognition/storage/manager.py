from agenticx.storage.unified_manager import UnifiedStorageManager
from agenticx.storage.key_value_storages.sqlite import SQLiteStorage
from models.data_models import TrainingExample, EntityAnnotation, Dataset
from typing import List

class DataManager:
    def __init__(self, db_path: str):
        self.unified_manager = UnifiedStorageManager(kv_storage=SQLiteStorage(db_path=db_path))

    def save_training_example(self, example: TrainingExample):
        key = f"training_example:{example.id}"
        self.unified_manager.kv_set(key, example.dict())

    def get_dataset_by_version(self, version: str) -> Dataset:
        # This is a simplified implementation. A real implementation would involve
        # more complex versioning logic.
        all_keys = self.unified_manager.kv_storage.keys()
        example_keys = [k for k in all_keys if k.startswith("training_example:")]
        examples = []
        for key in example_keys:
            example_data = self.unified_manager.kv_get(key)
            if example_data:
                examples.append(TrainingExample(**example_data))
        return Dataset(version=version, examples=examples)

    def get_badcases(self, min_count: int) -> List[TrainingExample]:
        # This is a placeholder for more complex bad case detection logic.
        return []

    def add_entity_annotation(self, example_id: str, annotation: EntityAnnotation):
        key = f"training_example:{example_id}"
        example_data = self.unified_manager.kv_get(key)
        if example_data:
            example = TrainingExample(**example_data)
            example.entities.append(annotation)
            self.save_training_example(example)