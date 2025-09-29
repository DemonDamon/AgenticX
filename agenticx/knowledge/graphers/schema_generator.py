"""Schema生成器

基于文档内容分析，生成定制化的知识图谱Schema
"""

import json
import os
from typing import Any, Dict, List, Optional
from loguru import logger


class SchemaGenerator:
    """Schema生成器，分析文档生成定制schema"""
    
    def __init__(self, llm_client=None, strong_llm_client=None, prompt_manager=None, base_schema_path: Optional[str] = None):
        self.llm_client = llm_client  # 默认LLM客户端
        self.strong_llm_client = strong_llm_client or llm_client  # 强模型客户端，用于复杂分析
        self.prompt_manager = prompt_manager
        
        # 加载基础schema
        if base_schema_path and os.path.exists(base_schema_path):
            with open(base_schema_path, 'r', encoding='utf-8') as f:
                self.base_schema = json.load(f)
        else:
            # 默认基础schema
            self.base_schema = {
                "Nodes": ["person", "organization", "location", "event", "concept"],
                "Relations": ["related_to", "part_of", "located_in", "works_for", "created_by"],
                "Attributes": ["name", "description", "type", "date", "status"]
            }
        
        logger.info("Schema生成器初始化完成")
    
    def analyze_documents(self, documents: List[str]) -> Dict[str, Any]:
        """分析文档内容，生成文档分析报告
        
        Args:
            documents: 文档内容列表
            
        Returns:
            文档分析结果
        """
        logger.info(f"开始分析 {len(documents)} 个文档")
        
        if not self.strong_llm_client or not self.prompt_manager:
            logger.error("❌ 缺少LLM客户端或提示词管理器")
            return {}
        
        # 智能文档内容处理
        combined_content = self._prepare_documents_for_analysis(documents)
        
        try:
            # 使用文档分析提示词
            prompt = self.prompt_manager.format_prompt(
                "document_analysis",
                document_content=combined_content
            )
            
            logger.debug("调用强模型进行文档分析")
            logger.info(f"分析内容长度: {len(combined_content)} 字符")
            response = self.strong_llm_client.call(prompt)
            
            # 解析响应
            analysis_result = self._parse_analysis_response(response)
            
            logger.success(f"✅ 文档分析完成: {analysis_result.get('category', '未知类别')}")
            
            return analysis_result
            
        except Exception as e:
            logger.error(f"❌ 文档分析失败: {e}")
            return {}
    
    def _prepare_documents_for_analysis(self, documents: List[str]) -> str:
        """智能准备文档内容用于分析，充分利用128k上下文"""
        logger.info(f"准备文档内容，充分利用128k上下文能力")
        
        # 估算token数量 (粗略估算：1 token ≈ 0.75个英文单词 ≈ 1.5个中文字符)
        max_chars = 120000  # 预留8k tokens给提示词和响应
        
        # 策略1：如果文档总量不大，全部使用
        total_length = sum(len(doc) for doc in documents)
        if total_length <= max_chars:
            logger.info(f"文档总长度 {total_length} 字符，全部用于分析")
            return "\n\n".join(documents)
        
        # 策略2：智能采样 - 确保覆盖所有文档
        logger.info(f"文档总长度 {total_length} 字符，使用智能采样策略")
        
        # 为每个文档分配空间
        doc_count = len(documents)
        chars_per_doc = max_chars // doc_count
        
        sampled_docs = []
        for i, doc in enumerate(documents):
            if len(doc) <= chars_per_doc:
                # 短文档全部使用
                sampled_docs.append(doc)
                logger.debug(f"文档 {i+1}: 完整使用 ({len(doc)} 字符)")
            else:
                # 长文档采样：开头 + 中间 + 结尾
                start_size = chars_per_doc // 3
                middle_size = chars_per_doc // 3
                end_size = chars_per_doc - start_size - middle_size
                
                start_part = doc[:start_size]
                middle_start = len(doc) // 2 - middle_size // 2
                middle_part = doc[middle_start:middle_start + middle_size]
                end_part = doc[-end_size:]
                
                sampled_doc = f"{start_part}\n...[中间内容]...\n{middle_part}\n...[后续内容]...\n{end_part}"
                sampled_docs.append(sampled_doc)
                logger.debug(f"文档 {i+1}: 智能采样 ({len(sampled_doc)} 字符，原长度 {len(doc)})")
        
        combined_content = "\n\n=== 文档分隔 ===\n\n".join(sampled_docs)
        logger.info(f"✅ 文档准备完成: {len(combined_content)} 字符，覆盖 {len(documents)} 个文档")
        
        return combined_content
    
    def generate_custom_schema_from_documents(self, documents: List[str]) -> Dict[str, Any]:
        """直接基于完整文档内容生成定制schema（推荐方法）
        
        Args:
            documents: 完整文档内容列表
            
        Returns:
            定制化的schema
        """
        logger.info("开始基于完整文档生成定制Schema")
        
        if not self.strong_llm_client or not self.prompt_manager:
            logger.error("❌ 缺少LLM客户端或提示词管理器")
            return self.base_schema
        
        try:
            # 智能文档内容处理，充分利用128k上下文
            combined_content = self._prepare_documents_for_analysis(documents)
            
            # 使用完整文档内容生成schema
            prompt = self.prompt_manager.format_prompt(
                "schema_generation",
                base_schema=json.dumps(self.base_schema, ensure_ascii=False, indent=2),
                document_content=combined_content,
                document_category="学术论文",  # 可以从文档分析中获取
                document_tags="AI, 基准测试, 未来预测"  # 可以从文档分析中获取
            )
            
            logger.debug("调用强模型基于完整文档生成定制Schema")
            response = self.strong_llm_client.call(prompt)
            
            # 解析响应
            custom_schema = self._parse_schema_response(response)
            
            # 验证和优化schema
            validated_schema = self._validate_schema(custom_schema)
            
            logger.success(f"✅ 基于完整文档的定制Schema生成完成")
            logger.debug(f"📋 实体类型: {len(validated_schema.get('Nodes', []))}")
            logger.debug(f"📋 关系类型: {len(validated_schema.get('Relations', []))}")
            logger.debug(f"📋 属性类型: {len(validated_schema.get('Attributes', []))}")
            
            # 打印生成的Schema详情
            logger.info("生成的定制Schema:")
            logger.info(f"📋 实体类型 ({len(validated_schema.get('Nodes', []))}): {validated_schema.get('Nodes', [])}")
            logger.info(f"🔗 关系类型 ({len(validated_schema.get('Relations', []))}): {validated_schema.get('Relations', [])}")
            logger.info(f"属性类型 ({len(validated_schema.get('Attributes', []))}): {validated_schema.get('Attributes', [])}")
            
            if 'domain_info' in validated_schema:
                domain_info = validated_schema['domain_info']
                logger.info(f"领域信息: {domain_info.get('primary_domain', '未知')}")
                logger.info(f"核心概念: {domain_info.get('key_concepts', [])}")
            
            return validated_schema
            
        except Exception as e:
            logger.error(f"❌ Schema生成失败: {e}")
            logger.warning("🔄 回退到基础Schema")
            return self.base_schema

    def generate_custom_schema(self, analysis_result: Dict[str, Any]) -> Dict[str, Any]:
        """基于文档分析结果生成定制schema（兼容旧方法）
        
        Args:
            analysis_result: 文档分析结果
            
        Returns:
            定制化的schema
        """
        logger.warning("⚠️ 使用基于摘要的Schema生成方法，建议使用generate_custom_schema_from_documents")
        
        if not self.strong_llm_client or not self.prompt_manager:
            logger.error("❌ 缺少LLM客户端或提示词管理器")
            return self.base_schema
        
        try:
            # 准备schema生成的输入
            document_summary = analysis_result.get('summary', '')
            document_category = analysis_result.get('category', '通用文档')
            document_tags = ', '.join(analysis_result.get('tags', []))
            
            # 使用schema生成提示词
            prompt = self.prompt_manager.format_prompt(
                "schema_generation",
                base_schema=json.dumps(self.base_schema, ensure_ascii=False, indent=2),
                document_content=document_summary,  # 改为使用document_content参数
                document_category=document_category,
                document_tags=document_tags
            )
            
            logger.debug("调用强模型生成定制Schema")
            response = self.strong_llm_client.call(prompt)
            
            # 解析响应
            custom_schema = self._parse_schema_response(response)
            
            # 验证和优化schema
            validated_schema = self._validate_schema(custom_schema)
            
            logger.success(f"✅ 定制Schema生成完成")
            logger.debug(f"📋 实体类型: {len(validated_schema.get('Nodes', []))}")
            logger.debug(f"📋 关系类型: {len(validated_schema.get('Relations', []))}")
            logger.debug(f"📋 属性类型: {len(validated_schema.get('Attributes', []))}")
            
            # 打印生成的Schema详情
            logger.info("生成的定制Schema:")
            logger.info(f"📋 实体类型 ({len(validated_schema.get('Nodes', []))}): {validated_schema.get('Nodes', [])}")
            logger.info(f"🔗 关系类型 ({len(validated_schema.get('Relations', []))}): {validated_schema.get('Relations', [])}")
            logger.info(f"属性类型 ({len(validated_schema.get('Attributes', []))}): {validated_schema.get('Attributes', [])}")
            
            if 'domain_info' in validated_schema:
                domain_info = validated_schema['domain_info']
                logger.info(f"领域信息: {domain_info.get('primary_domain', '未知')}")
                logger.info(f"核心概念: {domain_info.get('key_concepts', [])}")
            
            return validated_schema
            
        except Exception as e:
            logger.error(f"❌ Schema生成失败: {e}")
            logger.warning("🔄 回退到基础Schema")
            return self.base_schema
    
    def _parse_analysis_response(self, response: str) -> Dict[str, Any]:
        """解析文档分析响应"""
        try:
            cleaned_response = self._clean_llm_response(response)
            analysis_data = json.loads(cleaned_response)
            
            # 验证必要字段
            required_fields = ['summary', 'category', 'domain']
            for field in required_fields:
                if field not in analysis_data:
                    logger.warning(f"⚠️ 缺少分析字段: {field}")
                    analysis_data[field] = "未知"
            
            return analysis_data
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ 文档分析JSON解析失败: {e}")
            return {
                "summary": "文档分析失败",
                "category": "通用文档",
                "domain": "通用",
                "tags": [],
                "key_concepts": []
            }
    
    def _parse_schema_response(self, response: str) -> Dict[str, Any]:
        """解析schema生成响应"""
        try:
            cleaned_response = self._clean_llm_response(response)
            schema_data = json.loads(cleaned_response)
            
            # 验证必要字段
            required_fields = ['Nodes', 'Relations', 'Attributes']
            for field in required_fields:
                if field not in schema_data:
                    logger.warning(f"⚠️ 缺少Schema字段: {field}")
                    schema_data[field] = self.base_schema.get(field, [])
            
            return schema_data
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ Schema JSON解析失败: {e}")
            return self.base_schema
    
    def _clean_llm_response(self, response: str) -> str:
        """清理LLM响应，提取JSON内容"""
        response = response.strip()
        
        # 移除markdown代码块
        if response.startswith('```json'):
            response = response[7:]
        elif response.startswith('```'):
            response = response[3:]
        if response.endswith('```'):
            response = response[:-3]
        
        # 查找JSON内容
        start_idx = response.find('{')
        end_idx = response.rfind('}')
        
        if start_idx != -1 and end_idx != -1:
            response = response[start_idx:end_idx+1]
        
        return response.strip()
    
    def _validate_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """验证和优化schema"""
        validated_schema = {
            "Nodes": [],
            "Relations": [],
            "Attributes": []
        }
        
        # 验证并合并实体类型
        base_nodes = set(self.base_schema.get('Nodes', []))
        custom_nodes = set(schema.get('Nodes', []))
        validated_schema['Nodes'] = list(base_nodes | custom_nodes)
        
        # 验证并合并关系类型
        base_relations = set(self.base_schema.get('Relations', []))
        custom_relations = set(schema.get('Relations', []))
        validated_schema['Relations'] = list(base_relations | custom_relations)
        
        # 验证并合并属性类型
        base_attributes = set(self.base_schema.get('Attributes', []))
        custom_attributes = set(schema.get('Attributes', []))
        validated_schema['Attributes'] = list(base_attributes | custom_attributes)
        
        # 保留领域信息
        if 'domain_info' in schema:
            validated_schema['domain_info'] = schema['domain_info']
        
        logger.debug(f"Schema验证完成: {len(validated_schema['Nodes'])} 实体类型, {len(validated_schema['Relations'])} 关系类型")
        
        return validated_schema
    
    def save_custom_schema(self, schema: Dict[str, Any], file_path: str) -> bool:
        """保存定制schema到文件
        
        Args:
            schema: 定制schema
            file_path: 保存路径
            
        Returns:
            是否保存成功
        """
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(schema, f, ensure_ascii=False, indent=2)
            
            logger.info(f"定制Schema已保存: {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"❌ 保存Schema失败: {e}")
            return False