from typing import Dict, Any

class EmbeddingConfig:
    """嵌入服务配置模型"""
    def __init__(self, providers: Dict[str, Any]):
        self.providers = providers 