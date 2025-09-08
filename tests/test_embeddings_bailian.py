#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百炼Embedding全面测试
包含文本embedding、多模态embedding等所有官方示例
"""

import os
import sys
import asyncio
import pytest
import json
from pathlib import Path
from typing import List, Dict, Any

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

# 加载环境变量
from dotenv import load_dotenv
test_dir = Path(__file__).parent
env_path = test_dir / '.env'
load_dotenv(env_path)

# 导入AgenticX embedding模块
try:
    from agenticx.embeddings.bailian import BailianEmbeddingProvider
    from agenticx.embeddings.base import EmbeddingError
except ImportError as e:
    print(f"Warning: AgenticX embeddings模块导入失败: {e}")
    BailianEmbeddingProvider = None
    EmbeddingError = Exception

# 导入OpenAI客户端（用于对比测试）
try:
    from openai import OpenAI, AsyncOpenAI
except ImportError:
    OpenAI = None
    AsyncOpenAI = None

# 导入dashscope SDK（用于多模态测试）
try:
    import dashscope
    from http import HTTPStatus
except ImportError:
    dashscope = None
    HTTPStatus = None


class TestBailianEmbedding:
    """百炼Embedding测试类"""
    
    @classmethod
    def setup_class(cls):
        """测试类初始化"""
        cls.api_key = os.getenv('BAILIAN_API_KEY') or os.getenv('DASHSCOPE_API_KEY')
        cls.base_url = os.getenv('BAILIAN_API_BASE', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
        cls.model = 'text-embedding-v4'
        cls.multimodal_model = 'multimodal-embedding-v1'
        
        print(f"\n🔧 测试环境配置:")
        print(f"API Key: {cls.api_key[:10] + '***' if cls.api_key else 'N/A'}")
        print(f"Base URL: {cls.base_url}")
        print(f"Text Model: {cls.model}")
        print(f"Multimodal Model: {cls.multimodal_model}")
        
        # 初始化dashscope（如果可用）
        if dashscope and cls.api_key:
            dashscope.api_key = cls.api_key
    
    def test_environment_setup(self):
        """测试环境配置"""
        assert self.api_key, "BAILIAN_API_KEY或DASHSCOPE_API_KEY环境变量未设置"
        assert self.base_url, "BAILIAN_API_BASE环境变量未设置"
        print("✅ 环境配置验证通过")
    
    @pytest.mark.skipif(BailianEmbeddingProvider is None, reason="AgenticX embeddings模块不可用")
    def test_agenticx_provider_creation(self):
        """测试AgenticX BailianEmbeddingProvider创建"""
        provider = BailianEmbeddingProvider(
            api_key=self.api_key,
            api_url=self.base_url,
            model=self.model,
            dimension=1536
        )
        
        assert provider.api_key == self.api_key
        assert provider.api_url == self.base_url
        assert provider.model == self.model
        assert provider.dimension == 1536
        print("✅ AgenticX BailianEmbeddingProvider创建成功")
    
    @pytest.mark.skipif(BailianEmbeddingProvider is None, reason="AgenticX embeddings模块不可用")
    @pytest.mark.asyncio
    async def test_agenticx_single_text_embedding(self):
        """测试AgenticX单个文本embedding"""
        provider = BailianEmbeddingProvider(
            api_key=self.api_key,
            api_url=self.base_url,
            model=self.model,
            dimension=1536
        )
        
        try:
            test_text = "衣服的质量杠杠的，很漂亮，不枉我等了这么久啊，喜欢，以后还来这里买"
            embeddings = await provider.aembed([test_text])
            
            assert len(embeddings) == 1
            assert len(embeddings[0]) == 1536
            assert all(isinstance(x, float) for x in embeddings[0])
            
            print(f"✅ 单个文本embedding成功")
            print(f"   文本: {test_text[:30]}...")
            print(f"   向量维度: {len(embeddings[0])}")
            print(f"   向量前5个值: {embeddings[0][:5]}")
            
        finally:
            await provider.close()
    
    @pytest.mark.skipif(BailianEmbeddingProvider is None, reason="AgenticX embeddings模块不可用")
    @pytest.mark.asyncio
    async def test_agenticx_batch_text_embedding(self):
        """测试AgenticX批量文本embedding"""
        provider = BailianEmbeddingProvider(
            api_key=self.api_key,
            api_url=self.base_url,
            model=self.model,
            dimension=1536
        )
        
        try:
            test_texts = [
                '风急天高猿啸哀',
                '渚清沙白鸟飞回',
                '无边落木萧萧下',
                '不尽长江滚滚来'
            ]
            
            embeddings = await provider.aembed(test_texts)
            
            assert len(embeddings) == len(test_texts)
            for i, embedding in enumerate(embeddings):
                assert len(embedding) == 1536
                assert all(isinstance(x, float) for x in embedding)
            
            print(f"✅ 批量文本embedding成功")
            print(f"   文本数量: {len(test_texts)}")
            print(f"   向量维度: {len(embeddings[0])}")
            print(f"   第一个向量前5个值: {embeddings[0][:5]}")
            
        finally:
            await provider.close()
    
    @pytest.mark.skipif(OpenAI is None, reason="OpenAI客户端不可用")
    def test_openai_client_single_text(self):
        """测试OpenAI客户端单个文本embedding（官方示例1.1）"""
        client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        completion = client.embeddings.create(
            model=self.model,
            input='衣服的质量杠杠的，很漂亮，不枉我等了这么久啊，喜欢，以后还来这里买',
            dimensions=1024,
            encoding_format="float"
        )
        
        assert len(completion.data) == 1
        assert len(completion.data[0].embedding) == 1024
        assert completion.model == self.model
        
        print(f"✅ OpenAI客户端单个文本embedding成功")
        print(f"   模型: {completion.model}")
        print(f"   向量维度: {len(completion.data[0].embedding)}")
        print(f"   Token使用: {completion.usage.total_tokens}")
    
    @pytest.mark.skipif(OpenAI is None, reason="OpenAI客户端不可用")
    def test_openai_client_batch_text(self):
        """测试OpenAI客户端批量文本embedding（官方示例1.2）"""
        client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        completion = client.embeddings.create(
            model=self.model,
            input=['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来'],
            dimensions=1024,
            encoding_format="float"
        )
        
        assert len(completion.data) == 4
        for item in completion.data:
            assert len(item.embedding) == 1024
        assert completion.model == self.model
        
        print(f"✅ OpenAI客户端批量文本embedding成功")
        print(f"   文本数量: {len(completion.data)}")
        print(f"   向量维度: {len(completion.data[0].embedding)}")
        print(f"   Token使用: {completion.usage.total_tokens}")
    
    @pytest.mark.skipif(AsyncOpenAI is None, reason="AsyncOpenAI客户端不可用")
    @pytest.mark.asyncio
    async def test_async_openai_client(self):
        """测试异步OpenAI客户端"""
        client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        completion = await client.embeddings.create(
            model=self.model,
            input="这是一个异步测试文本",
            dimensions=1536,
            encoding_format="float"
        )
        
        assert len(completion.data) == 1
        assert len(completion.data[0].embedding) == 1536
        
        print(f"✅ 异步OpenAI客户端embedding成功")
        print(f"   向量维度: {len(completion.data[0].embedding)}")
        
        await client.close()
    
    @pytest.mark.skipif(dashscope is None, reason="dashscope SDK不可用")
    def test_dashscope_multimodal_text(self):
        """测试dashscope多模态文本embedding（官方示例2.1）"""
        text = "通用多模态表征模型示例"
        input_data = [{'text': text}]
        
        resp = dashscope.MultiModalEmbedding.call(
            model=self.multimodal_model,
            input=input_data
        )
        
        assert resp.status_code == HTTPStatus.OK
        assert 'embeddings' in resp.output
        assert len(resp.output['embeddings']) == 1
        assert 'embedding' in resp.output['embeddings'][0]
        
        embedding = resp.output['embeddings'][0]['embedding']
        assert isinstance(embedding, list)
        assert len(embedding) > 0
        assert all(isinstance(x, (int, float)) for x in embedding)
        
        print(f"✅ dashscope多模态文本embedding成功")
        print(f"   文本: {text}")
        print(f"   向量维度: {len(embedding)}")
        print(f"   向量前5个值: {embedding[:5]}")
    
    @pytest.mark.skipif(dashscope is None, reason="dashscope SDK不可用")
    def test_dashscope_multimodal_image(self):
        """测试dashscope多模态图片embedding（官方示例2.2）"""
        image_url = "https://dashscope.oss-cn-beijing.aliyuncs.com/images/256_1.png"
        input_data = [{'image': image_url}]
        
        resp = dashscope.MultiModalEmbedding.call(
            model=self.multimodal_model,
            input=input_data
        )
        
        assert resp.status_code == HTTPStatus.OK
        assert 'embeddings' in resp.output
        assert len(resp.output['embeddings']) == 1
        
        embedding_info = resp.output['embeddings'][0]
        assert 'embedding' in embedding_info
        assert embedding_info.get('type') == 'image'
        
        embedding = embedding_info['embedding']
        assert isinstance(embedding, list)
        assert len(embedding) > 0
        
        print(f"✅ dashscope多模态图片embedding成功")
        print(f"   图片URL: {image_url}")
        print(f"   向量维度: {len(embedding)}")
        print(f"   向量类型: {embedding_info.get('type')}")
        print(f"   图片数量: {resp.usage.get('image_count', 0)}")
    
    def test_different_dimensions(self):
        """测试不同维度参数"""
        if OpenAI is None:
            pytest.skip("OpenAI客户端不可用")
        
        client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        test_text = "测试不同维度的向量"
        dimensions_to_test = [512, 1024, 1536]
        
        for dim in dimensions_to_test:
            completion = client.embeddings.create(
                model=self.model,
                input=test_text,
                dimensions=dim,
                encoding_format="float"
            )
            
            assert len(completion.data[0].embedding) == dim
            print(f"✅ 维度 {dim} 测试通过")
    
    def test_error_handling(self):
        """测试错误处理"""
        if BailianEmbeddingProvider is None:
            pytest.skip("AgenticX embeddings模块不可用")
        
        # 测试无效API密钥
        provider = BailianEmbeddingProvider(
            api_key="invalid_key",
            api_url=self.base_url,
            model=self.model
        )
        
        async def test_invalid_key():
            try:
                await provider.aembed(["测试文本"])
                assert False, "应该抛出异常"
            except Exception as e:
                assert "401" in str(e) or "Unauthorized" in str(e) or "API" in str(e)
                print(f"✅ 无效API密钥错误处理正确: {type(e).__name__}")
            finally:
                await provider.close()
        
        asyncio.run(test_invalid_key())
    
    def test_performance_benchmark(self):
        """性能基准测试"""
        if BailianEmbeddingProvider is None:
            pytest.skip("AgenticX embeddings模块不可用")
        
        import time
        
        async def benchmark():
            provider = BailianEmbeddingProvider(
                api_key=self.api_key,
                api_url=self.base_url,
                model=self.model,
                dimension=1536
            )
            
            try:
                # 单个文本性能测试
                start_time = time.time()
                await provider.aembed(["性能测试文本"])
                single_time = time.time() - start_time
                
                # 批量文本性能测试
                batch_texts = [f"批量测试文本 {i}" for i in range(10)]
                start_time = time.time()
                await provider.aembed(batch_texts)
                batch_time = time.time() - start_time
                
                print(f"✅ 性能基准测试完成")
                print(f"   单个文本耗时: {single_time:.3f}秒")
                print(f"   批量文本(10个)耗时: {batch_time:.3f}秒")
                print(f"   平均每个文本耗时: {batch_time/10:.3f}秒")
                
                # 性能断言
                assert single_time < 10.0, "单个文本embedding耗时过长"
                assert batch_time < 30.0, "批量文本embedding耗时过长"
                
            finally:
                await provider.close()
        
        asyncio.run(benchmark())


if __name__ == "__main__":
    print("\n" + "="*60)
    print("🚀 百炼Embedding全面测试")
    print("="*60)
    
    # 运行所有测试
    pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "-s"  # 显示print输出
    ])