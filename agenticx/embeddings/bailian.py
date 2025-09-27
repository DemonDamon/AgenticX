import asyncio
import aiohttp
import json
import time
from typing import List, Optional, Dict, Any
from .base import BaseEmbeddingProvider, EmbeddingError

try:
    import dashscope
    from http import HTTPStatus
    DASHSCOPE_AVAILABLE = True
except ImportError:
    DASHSCOPE_AVAILABLE = False
    dashscope = None
    HTTPStatus = None

try:
    from openai import AsyncOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    AsyncOpenAI = None

class BailianEmbeddingProvider(BaseEmbeddingProvider):
    """阿里云百炼Embedding提供者"""
    
    MODEL_DIMENSIONS = {
        "text-embedding-v1": 1536,
        "text-embedding-v2": 1024,
        "text-embedding-v4": 1536,  # 默认模型
        "multimodal-embedding-v1": 1536,
    }

    def __init__(
        self, 
        api_key: str, 
        model: str = "text-embedding-v4", 
        api_url: Optional[str] = None,  # 修复：使用Optional[str]而不是str = None
        max_tokens: int = 8192,
        batch_size: int = 100,
        timeout: int = 30,
        retry_count: int = 3,
        retry_delay: float = 1.0,
        use_dashscope_sdk: bool = True,  # 优先使用dashscope SDK
        multimodal_model: str = "multimodal-embedding-v1",
        **kwargs
    ):
        super().__init__(kwargs or {})  # 修复：确保传入的是一个字典而不是None
        self.api_key = api_key
        self.model = model
        self.dimensions = kwargs.get('dimensions', self.MODEL_DIMENSIONS.get(model, 1536))

    def get_embedding_dim(self) -> int:
        """获取嵌入维度"""
        return self.dimensions
        # 根据官方文档，使用base_url格式，OpenAI客户端会自动添加/embeddings
        if api_url:
            # 如果传入的是完整的embeddings URL，提取base_url
            if api_url.endswith('/embeddings'):
                self.api_url = api_url[:-11]  # 移除'/embeddings'
            else:
                self.api_url = api_url
        else:
            self.api_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        
        # 动态设置维度
        custom_dimension = kwargs.get("dimensions") or kwargs.get("dimension")
        if custom_dimension:
            self.dimension = int(custom_dimension)
        else:
            self.dimension = self.MODEL_DIMENSIONS.get(self.model, 1536)

        self.max_tokens = max_tokens
        self.batch_size = batch_size
        self.timeout = timeout
        self.retry_count = retry_count
        self.retry_delay = retry_delay
        self.use_dashscope_sdk = use_dashscope_sdk and DASHSCOPE_AVAILABLE
        self.multimodal_model = multimodal_model
        
        # HTTP会话管理
        self._session = None
        
        # OpenAI客户端（用于兼容接口）
        self._openai_client = None
        if OPENAI_AVAILABLE and AsyncOpenAI:
            self._openai_client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.api_url
            )
        
        # 初始化dashscope
        if self.use_dashscope_sdk and dashscope:
            dashscope.api_key = self.api_key
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """获取HTTP会话"""
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(
                limit=10,
                limit_per_host=5,
                keepalive_timeout=30
            )
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            self._session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout
            )
        return self._session
    
    def embed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """同步embedding接口"""
        return asyncio.run(self.aembed(texts, **kwargs))
    
    async def aembed(self, texts: List[str], **kwargs) -> List[List[float]]:
        """异步embedding接口"""
        if not texts:
            return []
        
        # 分批处理
        all_embeddings = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            batch_embeddings = await self._embed_batch(batch, **kwargs)
            all_embeddings.extend(batch_embeddings)
        
        return all_embeddings
    
    async def aembed_multimodal(self, inputs: List[Dict[str, Any]], **kwargs) -> List[List[float]]:
        """多模态异步embedding接口
        
        Args:
            inputs: 多模态输入列表，每个元素可以包含:
                   - {'text': 'text content'} 文本输入
                   - {'image': 'image_url'} 图片输入
                   - {'video': 'video_url'} 视频输入
        """
        if not inputs:
            return []
        
        try:
            if self.use_dashscope_sdk and dashscope:
                # 使用官方dashscope SDK（推荐方式）
                return await self._embed_multimodal_with_sdk(inputs, **kwargs)
            else:
                # 降级到HTTP API调用
                return await self._embed_multimodal_with_http(inputs, **kwargs)
                
        except Exception as e:
            raise EmbeddingError(f"多模态embedding处理错误: {e}")
    
    async def _embed_multimodal_with_sdk(self, inputs: List[Dict[str, Any]], **kwargs) -> List[List[float]]:
        """使用dashscope SDK进行多模态embedding"""
        # 修复：添加对dashscope是否可用的检查
        if not DASHSCOPE_AVAILABLE or not dashscope or not HTTPStatus:
            raise EmbeddingError("dashscope SDK不可用，无法进行多模态embedding")
            
        try:
            # 直接使用完整的输入列表
            resp = dashscope.MultiModalEmbedding.call(
                model=self.multimodal_model,
                input=inputs,  # type: ignore
                **kwargs
            )
            
            # 修复：添加对HTTPStatus是否可用的检查
            if HTTPStatus and resp.status_code == HTTPStatus.OK:
                return self._extract_multimodal_embeddings_sdk(resp.output)
            else:
                raise EmbeddingError(
                    f"多模态embedding SDK错误: {resp.status_code}, {resp.message}"
                )
            
        except Exception as e:
            raise EmbeddingError(f"SDK多模态embedding失败: {e}")
    
    async def _embed_multimodal_with_http(self, inputs: List[Dict[str, Any]], **kwargs) -> List[List[float]]:
        """使用HTTP API进行多模态embedding（降级方案）"""
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": self.multimodal_model,
                "input": inputs,
                **kwargs
            }
            
            session = await self._get_session()
            async with session.post(
                f"{self.api_url}/embeddings",
                headers=headers,
                json=payload
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return self._extract_multimodal_embeddings_http(result)
                else:
                    error_text = await response.text()
                    raise EmbeddingError(f"多模态embedding HTTP API错误: {response.status} - {error_text}")
                    
        except Exception as e:
            raise EmbeddingError(f"HTTP多模态embedding失败: {e}")
    
    def _extract_multimodal_embeddings_sdk(self, output: Dict[str, Any]) -> List[List[float]]:
        """从dashscope SDK响应中提取embedding向量"""
        try:
            # 优先支持OpenAI兼容格式
            if "data" in output:
                embeddings = output["data"]
                return [item["embedding"] for item in embeddings]
            # 兼容原生百炼格式
            elif "embeddings" in output:
                embeddings = output["embeddings"]
                return [item["embedding"] for item in embeddings]
            else:
                raise EmbeddingError(f"无法解析SDK多模态响应格式: {output}")
        except (KeyError, TypeError) as e:
            raise EmbeddingError(f"SDK多模态响应格式错误: {e}")
    
    def _extract_multimodal_embeddings_http(self, result: Dict[str, Any]) -> List[List[float]]:
        """从HTTP API响应中提取embedding向量"""
        try:
            # 优先支持OpenAI兼容格式
            if "data" in result:
                embeddings = result["data"]
                return [item["embedding"] for item in embeddings]
            # 兼容原生百炼格式
            elif "output" in result and "embeddings" in result["output"]:
                embeddings = result["output"]["embeddings"]
                return [item["embedding"] for item in embeddings]
            else:
                raise EmbeddingError(f"无法解析HTTP多模态API响应格式: {result}")
        except (KeyError, TypeError) as e:
            raise EmbeddingError(f"HTTP多模态API响应格式错误: {e}")
    
    async def _embed_batch(self, texts: List[str], **kwargs) -> List[List[float]]:
        """处理单个批次的embedding"""
        # 优先使用OpenAI客户端（兼容接口）
        if self._openai_client:
            try:
                # 准备参数
                embed_kwargs = {
                    "model": self.model,
                    "input": texts,
                    "encoding_format": "float",
                    **kwargs
                }
                
                # 如果支持维度参数
                if self.dimension:
                    embed_kwargs["dimensions"] = self.dimension
                
                # print(f"\n🔍 百炼API请求详情 (OpenAI客户端):")
                # print(f"Base URL: {self.api_url}")
                # print(f"Model: {self.model}")
                # print(f"Input: {texts}")
                # print(f"Kwargs: {embed_kwargs}")
                
                # 调用OpenAI客户端
                response = await self._openai_client.embeddings.create(**embed_kwargs)
                
                # 提取embedding向量
                embeddings = [item.embedding for item in response.data]
                return embeddings
                
            except Exception as e:
                print(f"❌ OpenAI客户端调用失败: {e}")
                # 降级到原始HTTP请求
                pass
        
        # 原始HTTP请求方式（备用）
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # 修复：确保api_url不为None
        api_url = self.api_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        
        payload = {
            "model": self.model,
            "input": texts,  # 直接传递文本列表，兼容OpenAI格式
            "encoding_format": "float",
            **kwargs
        }
        
        # 如果支持维度参数（text-embedding-v3及以上）
        if self.model in ["text-embedding-v3", "text-embedding-v4"] and self.dimension:
            payload["dimensions"] = self.dimension
        
        # # 添加详细的请求日志
        # print(f"\n🔍 百炼API请求详情 (HTTP):")
        # print(f"URL: {api_url}/embeddings")
        # print(f"Headers: {headers}")
        # print(f"Payload: {payload}")
        # print(f"Texts count: {len(texts)}")
        # print(f"First text preview: {texts[0][:100] if texts else 'N/A'}...")
        
        for attempt in range(self.retry_count + 1):
            try:
                session = await self._get_session()
                async with session.post(
                    api_url,  # 修复：使用确保不为None的api_url
                    headers=headers,
                    json=payload
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        return self._extract_embeddings(result)
                    elif response.status == 429:  # Rate limit
                        if attempt < self.retry_count:
                            await asyncio.sleep(self.retry_delay * (2 ** attempt))
                            continue
                        else:
                            raise EmbeddingError(f"百炼API速率限制: {response.status}")
                    else:
                        error_text = await response.text()
                        raise EmbeddingError(f"百炼API错误: {response.status} - {error_text}")
            
            except aiohttp.ClientError as e:
                if attempt < self.retry_count:
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    continue
                else:
                    raise EmbeddingError(f"百炼API连接错误: {e}")
            
            except Exception as e:
                if attempt < self.retry_count:
                    await asyncio.sleep(self.retry_delay)
                    continue
                else:
                    raise EmbeddingError(f"百炼embedding处理错误: {e}")
        
        raise EmbeddingError("百炼embedding请求失败，已达到最大重试次数")
    
    def _extract_embeddings(self, result: Dict[str, Any]) -> List[List[float]]:
        """从API响应中提取embedding向量"""
        try:
            # 优先支持OpenAI兼容格式
            if "data" in result:
                embeddings = result["data"]
                return [item["embedding"] for item in embeddings]
            # 兼容原生百炼格式
            elif "output" in result and "embeddings" in result["output"]:
                embeddings = result["output"]["embeddings"]
                return [item["embedding"] for item in embeddings]
            else:
                raise EmbeddingError(f"无法解析百炼API响应格式: {result}")
        except (KeyError, TypeError) as e:
            raise EmbeddingError(f"百炼API响应格式错误: {e}")
    
    async def close(self):
        """关闭HTTP会话"""
        if self._session and not self._session.closed:
            await self._session.close()
    
    def __del__(self):
        """析构函数"""
        if self._session and not self._session.closed:
            asyncio.create_task(self.close())