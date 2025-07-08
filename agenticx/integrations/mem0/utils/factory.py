import importlib
from typing import Optional

from agenticx.integrations.mem0.configs.embeddings.base import BaseEmbedderConfig
from agenticx.integrations.mem0.configs.llms.base import BaseLlmConfig
from agenticx.integrations.mem0.embeddings.mock import MockEmbeddings
from agenticx.integrations.mem0.llms.groq import GroqLLM
from agenticx.integrations.mem0.llms.langchain import LangchainLLM
from agenticx.integrations.mem0.llms.litellm import LiteLLM
from agenticx.integrations.mem0.llms.lmstudio import LMStudioLLM
from agenticx.integrations.mem0.llms.ollama import OllamaLLM
from agenticx.integrations.mem0.llms.openai import OpenAI
from agenticx.integrations.mem0.llms.openai_structured import OpenAIStructured
from agenticx.integrations.mem0.llms.sarvam import SarvamAI
from agenticx.integrations.mem0.llms.together import TogetherLLM
from agenticx.integrations.mem0.llms.vllm import VllmLLM
from agenticx.integrations.mem0.llms.xai import XaiLLM
from agenticx.integrations.mem0.llms.agenticx_llm import AgenticXLLM


def load_class(class_type):
    module_path, class_name = class_type.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


class LlmFactory:
    provider_to_class = {
        "ollama": "agenticx.integrations.mem0.llms.ollama.OllamaLLM",
        "openai": "agenticx.integrations.mem0.llms.openai.OpenAILLM",
        "groq": "agenticx.integrations.mem0.llms.groq.GroqLLM",
        "together": "agenticx.integrations.mem0.llms.together.TogetherLLM",
        "aws_bedrock": "agenticx.integrations.mem0.llms.aws_bedrock.AWSBedrockLLM",
        "litellm": "agenticx.integrations.mem0.llms.litellm.LiteLLM",
        "azure_openai": "agenticx.integrations.mem0.llms.azure_openai.AzureOpenAILLM",
        "openai_structured": "agenticx.integrations.mem0.llms.openai_structured.OpenAIStructuredLLM",
        "anthropic": "agenticx.integrations.mem0.llms.anthropic.AnthropicLLM",
        "azure_openai_structured": "agenticx.integrations.mem0.llms.azure_openai_structured.AzureOpenAIStructuredLLM",
        "gemini": "agenticx.integrations.mem0.llms.gemini.GeminiLLM",
        "deepseek": "agenticx.integrations.mem0.llms.deepseek.DeepSeekLLM",
        "xai": "agenticx.integrations.mem0.llms.xai.XAILLM",
        "sarvam": "agenticx.integrations.mem0.llms.sarvam.SarvamLLM",
        "lmstudio": "agenticx.integrations.mem0.llms.lmstudio.LMStudioLLM",
        "vllm": "agenticx.integrations.mem0.llms.vllm.VllmLLM",
        "langchain": "agenticx.integrations.mem0.llms.langchain.LangchainLLM",
        "agenticx": "agenticx.integrations.mem0.llms.agenticx_llm.AgenticXLLM",
    }

    @classmethod
    def create(cls, provider_name, config):
        class_type = cls.provider_to_class.get(provider_name)
        if class_type:
            llm_instance = load_class(class_type)
            base_config = BaseLlmConfig(**config)
            if provider_name == "agenticx":
                if "llm_instance" not in config.params:
                    raise ValueError("LlmFactory: llm_instance must be provided in config for agenticx provider")
                return AgenticXLLM(llm_instance=config.params["llm_instance"], config=config)
            return llm_instance(base_config)
        else:
            raise ValueError(f"Unsupported Llm provider: {provider_name}")


class EmbedderFactory:
    provider_to_class = {
        "openai": "agenticx.integrations.mem0.embeddings.openai.OpenAIEmbedding",
        "ollama": "agenticx.integrations.mem0.embeddings.ollama.OllamaEmbedding",
        "huggingface": "agenticx.integrations.mem0.embeddings.huggingface.HuggingFaceEmbedding",
        "azure_openai": "agenticx.integrations.mem0.embeddings.azure_openai.AzureOpenAIEmbedding",
        "gemini": "agenticx.integrations.mem0.embeddings.gemini.GoogleGenAIEmbedding",
        "vertexai": "agenticx.integrations.mem0.embeddings.vertexai.VertexAIEmbedding",
        "together": "agenticx.integrations.mem0.embeddings.together.TogetherEmbedding",
        "lmstudio": "agenticx.integrations.mem0.embeddings.lmstudio.LMStudioEmbedding",
        "langchain": "agenticx.integrations.mem0.embeddings.langchain.LangchainEmbedding",
        "aws_bedrock": "agenticx.integrations.mem0.embeddings.aws_bedrock.AWSBedrockEmbedding",
    }

    @classmethod
    def create(cls, provider_name, config, vector_config: Optional[dict]):
        if provider_name == "upstash_vector" and vector_config and vector_config.enable_embeddings:
            return MockEmbeddings()
        class_type = cls.provider_to_class.get(provider_name)
        if class_type:
            embedder_instance = load_class(class_type)
            base_config = BaseEmbedderConfig(**config)
            return embedder_instance(base_config)
        else:
            raise ValueError(f"Unsupported Embedder provider: {provider_name}")


class VectorStoreFactory:
    provider_to_class = {
        "qdrant": "agenticx.integrations.mem0.vector_stores.qdrant.Qdrant",
        "chroma": "agenticx.integrations.mem0.vector_stores.chroma.ChromaDB",
        "pgvector": "agenticx.integrations.mem0.vector_stores.pgvector.PGVector",
        "milvus": "agenticx.integrations.mem0.vector_stores.milvus.MilvusDB",
        "upstash_vector": "agenticx.integrations.mem0.vector_stores.upstash_vector.UpstashVector",
        "azure_ai_search": "agenticx.integrations.mem0.vector_stores.azure_ai_search.AzureAISearch",
        "pinecone": "agenticx.integrations.mem0.vector_stores.pinecone.PineconeDB",
        "mongodb": "agenticx.integrations.mem0.vector_stores.mongodb.MongoDB",
        "redis": "agenticx.integrations.mem0.vector_stores.redis.RedisDB",
        "elasticsearch": "agenticx.integrations.mem0.vector_stores.elasticsearch.ElasticsearchDB",
        "vertex_ai_vector_search": "agenticx.integrations.mem0.vector_stores.vertex_ai_vector_search.GoogleMatchingEngine",
        "opensearch": "agenticx.integrations.mem0.vector_stores.opensearch.OpenSearchDB",
        "supabase": "agenticx.integrations.mem0.vector_stores.supabase.Supabase",
        "weaviate": "agenticx.integrations.mem0.vector_stores.weaviate.Weaviate",
        "faiss": "agenticx.integrations.mem0.vector_stores.faiss.FAISS",
        "langchain": "agenticx.integrations.mem0.vector_stores.langchain.Langchain",
    }

    @classmethod
    def create(cls, provider_name, config):
        class_type = cls.provider_to_class.get(provider_name)
        if class_type:
            if not isinstance(config, dict):
                config = config.model_dump()
            vector_store_instance = load_class(class_type)
            return vector_store_instance(**config)
        else:
            raise ValueError(f"Unsupported VectorStore provider: {provider_name}")

    @classmethod
    def reset(cls, instance):
        instance.reset()
        return instance
