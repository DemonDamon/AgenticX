#!/usr/bin/env python3
"""
AgenticX Embeddings Demo

演示不同 embedding 模型的能力，计算中文句子的余弦相似度。
支持 SiliconFlow、Bailian、OpenAI、LiteLLM 等多种 embedding 服务。
"""

import os
import sys
import numpy as np
from typing import List, Dict, Any, Tuple
from dotenv import load_dotenv

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from agenticx.embeddings import (
    SiliconFlowEmbeddingProvider,
    OpenAIEmbeddingProvider,
    LiteLLMEmbeddingProvider,
    EmbeddingRouter,
    EmbeddingError
)

# 加载环境变量
load_dotenv()


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """计算两个向量的余弦相似度"""
    vec1 = np.array(vec1)
    vec2 = np.array(vec2)
    
    dot_product = np.dot(vec1, vec2)
    norm1 = np.linalg.norm(vec1)
    norm2 = np.linalg.norm(vec2)
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
    
    return dot_product / (norm1 * norm2)


class MockEmbeddingProvider:
    """Mock embedding provider 用于演示"""
    def __init__(self, name: str, dimension: int = 768):
        self.name = name
        self.dimension = dimension
    
    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """生成模拟的 embeddings"""
        embeddings = []
        for i, text in enumerate(texts):
            # 基于文本内容生成一致的向量
            np.random.seed(hash(text) % 2**32)
            embedding = np.random.normal(0, 1, self.dimension)
            # 归一化
            embedding = embedding / np.linalg.norm(embedding)
            embeddings.append(embedding.tolist())
        return embeddings


class EmbeddingModelTester:
    """测试不同 embedding 模型的能力"""
    
    def __init__(self):
        self.test_sentences = [
            "今天天气很好",
            "今天天气不错", 
            "今天天气很差",
            "我喜欢吃苹果",
            "我爱吃苹果",
            "苹果公司发布了新产品",
            "人工智能技术发展迅速",
            "AI技术正在快速发展",
            "机器学习是人工智能的一个分支",
            "深度学习是机器学习的一种方法"
        ]
        
        self.similarity_pairs = [
            ("今天天气很好", "今天天气不错"),
            ("今天天气很好", "今天天气很差"),
            ("我喜欢吃苹果", "我爱吃苹果"),
            ("我喜欢吃苹果", "苹果公司发布了新产品"),
            ("人工智能技术发展迅速", "AI技术正在快速发展"),
            ("机器学习是人工智能的一个分支", "深度学习是机器学习的一种方法")
        ]
    
    def create_providers(self) -> Dict[str, Any]:
        """创建各种 embedding provider"""
        providers = {}
        
        # SiliconFlow Provider
        siliconflow_key = os.getenv('SILICONFLOW_API_KEY')
        if siliconflow_key and siliconflow_key != 'your_siliconflow_api_key_here':
            providers['SiliconFlow'] = {
                'provider': SiliconFlowEmbeddingProvider(
                    api_key=siliconflow_key,
                    model=os.getenv('SILICONFLOW_DEFAULT_MODEL', 'BAAI/bge-large-zh-v1.5')
                ),
                'models': [
                    'BAAI/bge-large-zh-v1.5',
                    'BAAI/bge-large-en-v1.5', 
                    'BAAI/bge-m3',
                    'Qwen/Qwen3-Embedding-8B',
                    'Qwen/Qwen3-Embedding-4B',
                    'Qwen/Qwen3-Embedding-0.6B',
                    'netease-youdao/bce-embedding-base_v1'
                ]
            }
        
        # OpenAI Provider
        openai_key = os.getenv('OPENAI_API_KEY')
        if openai_key:
            providers['OpenAI'] = {
                'provider': OpenAIEmbeddingProvider(
                    api_key=openai_key,
                    model='text-embedding-ada-002'
                ),
                'models': [
                    'text-embedding-ada-002',
                    'text-embedding-3-small',
                    'text-embedding-3-large'
                ]
            }
        
        # LiteLLM Provider (支持多种模型)
        litellm_key = os.getenv('OPENAI_API_KEY')  # 使用 OpenAI key 作为示例
        if litellm_key:
            providers['LiteLLM'] = {
                'provider': LiteLLMEmbeddingProvider(
                    model='text-embedding-ada-002',
                    api_key=litellm_key
                ),
                'models': [
                    'text-embedding-ada-002',
                    'text-embedding-3-small',
                    'text-embedding-3-large'
                ]
            }
        
        # 如果没有真实的 provider，使用 mock
        if not providers:
            print("⚠️  未找到真实的 API Key，使用 Mock Provider 进行演示")
            providers['Mock'] = {
                'provider': MockEmbeddingProvider("Mock-BGE", 768),
                'models': [
                    'Mock-BGE-768',
                    'Mock-OpenAI-1536',
                    'Mock-Qwen-1024'
                ]
            }
        
        return providers
    
    def test_model(self, provider: Any, model_name: str, sentences: List[str]) -> Dict[str, Any]:
        """测试单个模型"""
        print(f"\n🔍 测试模型: {model_name}")
        print("-" * 50)
        
        try:
            # 更新模型（如果 provider 支持）
            if hasattr(provider, 'model'):
                provider.model = model_name
            
            # 获取 embeddings
            embeddings = provider.embed(sentences)
            
            print(f"✅ 成功获取 {len(embeddings)} 个向量")
            print(f"📏 向量维度: {len(embeddings[0]) if embeddings else 0}")
            
            # 计算相似度
            similarity_results = []
            for pair in self.similarity_pairs:
                idx1 = sentences.index(pair[0])
                idx2 = sentences.index(pair[1])
                
                sim = cosine_similarity(embeddings[idx1], embeddings[idx2])
                similarity_results.append({
                    'pair': pair,
                    'similarity': sim
                })
                
                print(f"  '{pair[0]}' vs '{pair[1]}': {sim:.4f}")
            
            return {
                'model': model_name,
                'success': True,
                'embeddings_count': len(embeddings),
                'vector_dimension': len(embeddings[0]) if embeddings else 0,
                'similarity_results': similarity_results
            }
            
        except Exception as e:
            print(f"❌ 模型 {model_name} 测试失败: {str(e)}")
            return {
                'model': model_name,
                'success': False,
                'error': str(e)
            }
    
    def run_comprehensive_test(self):
        """运行全面的模型测试"""
        print("🚀 AgenticX Embeddings 模型能力测试")
        print("=" * 60)
        
        providers = self.create_providers()
        
        all_results = []
        
        for provider_name, provider_info in providers.items():
            print(f"\n📊 测试 Provider: {provider_name}")
            print("=" * 40)
            
            provider = provider_info['provider']
            models = provider_info['models']
            
            for model in models:
                result = self.test_model(provider, model, self.test_sentences)
                all_results.append(result)
        
        # 生成测试报告
        self.generate_report(all_results)
    
    def generate_report(self, results: List[Dict[str, Any]]):
        """生成测试报告"""
        print("\n" + "=" * 60)
        print("📋 测试报告")
        print("=" * 60)
        
        successful_models = [r for r in results if r['success']]
        failed_models = [r for r in results if not r['success']]
        
        print(f"✅ 成功测试的模型: {len(successful_models)}")
        print(f"❌ 失败的模型: {len(failed_models)}")
        
        if successful_models:
            print("\n🎯 模型性能对比:")
            print("-" * 40)
            
            # 按相似度排序，找出表现最好的模型
            for pair_idx, pair in enumerate(self.similarity_pairs):
                print(f"\n句子对 {pair_idx + 1}: '{pair[0]}' vs '{pair[1]}'")
                
                pair_results = []
                for result in successful_models:
                    if 'similarity_results' in result:
                        sim = result['similarity_results'][pair_idx]['similarity']
                        pair_results.append((result['model'], sim))
                
                # 按相似度排序
                pair_results.sort(key=lambda x: x[1], reverse=True)
                
                for model, sim in pair_results:
                    print(f"  {model}: {sim:.4f}")
        
        if failed_models:
            print("\n❌ 失败的模型:")
            print("-" * 20)
            for result in failed_models:
                print(f"  {result['model']}: {result['error']}")
    
    def test_router_fallback(self):
        """测试路由器的 fallback 功能"""
        print("\n🔄 测试 EmbeddingRouter Fallback 功能")
        print("-" * 50)
        
        # 创建多个 provider
        providers = []
        
        # 添加一个会失败的 provider
        class FailingProvider:
            def embed(self, texts, **kwargs):
                raise Exception("模拟失败")
        
        providers.append(FailingProvider())
        
        # 添加 mock provider
        providers.append(MockEmbeddingProvider("Mock-Fallback", 768))
        
        router = EmbeddingRouter(providers)
        try:
            embeddings = router.embed(["测试文本"])
            print("✅ Router fallback 测试成功")
            print(f"   获取到 {len(embeddings)} 个向量")
            print(f"   向量维度: {len(embeddings[0]) if embeddings else 0}")
        except Exception as e:
            print(f"❌ Router fallback 测试失败: {e}")
    
    def demonstrate_usage(self):
        """演示基本用法"""
        print("\n💡 基本用法演示")
        print("-" * 30)
        
        # 创建 provider
        provider = MockEmbeddingProvider("Demo", 768)
        
        # 单个文本 embedding
        text = "这是一个测试句子"
        embedding = provider.embed([text])[0]
        print(f"文本: '{text}'")
        print(f"向量维度: {len(embedding)}")
        print(f"向量前5个值: {embedding[:5]}")
        
        # 批量 embedding
        texts = ["句子1", "句子2", "句子3"]
        embeddings = provider.embed(texts)
        print(f"\n批量处理 {len(texts)} 个文本")
        print(f"获得 {len(embeddings)} 个向量")
        
        # 计算相似度
        sim = cosine_similarity(embeddings[0], embeddings[1])
        print(f"'{texts[0]}' 和 '{texts[1]}' 的相似度: {sim:.4f}")


def main():
    """主函数"""
    tester = EmbeddingModelTester()
    
    # 演示基本用法
    tester.demonstrate_usage()
    
    # 运行全面测试
    tester.run_comprehensive_test()
    
    # 测试路由器 fallback
    tester.test_router_fallback()
    
    print("\n✅ 测试完成！")
    print("\n💡 使用建议:")
    print("  1. 对于中文文本，推荐使用 SiliconFlow 的 BAAI/bge-large-zh-v1.5")
    print("  2. 对于英文文本，推荐使用 OpenAI 的 text-embedding-3-large")
    print("  3. 对于多语言场景，推荐使用 Qwen3-Embedding 系列")
    print("  4. 使用 EmbeddingRouter 可以实现自动 fallback")
    print("\n🔧 配置说明:")
    print("  1. 复制 examples/env_template.txt 为 .env")
    print("  2. 填入您的 API Key")
    print("  3. 重新运行此脚本")


if __name__ == "__main__":
    main()