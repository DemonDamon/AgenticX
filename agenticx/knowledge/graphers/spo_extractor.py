"""SPO (Subject-Predicate-Object) Extractor for Knowledge Graph Construction

This module provides a unified SPO extraction approach with custom schema support,
extracting entities, relationships, and attributes in a single LLM call.
"""

import json
import os
from typing import Any, Dict, List, Optional, Tuple
from loguru import logger

from .models import Entity, EntityType, Relationship, RelationType


class SPOExtractor:
    """Unified SPO extractor with custom schema and prompt template support"""
    
    def __init__(self, llm_client=None, prompt_manager=None, custom_schema: Optional[Dict[str, Any]] = None, config: Optional[Dict[str, Any]] = None):
        self.llm_client = llm_client
        self.prompt_manager = prompt_manager
        self.config = config or {}
        
        # Use custom schema if provided, otherwise use default
        if custom_schema:
            self.schema = custom_schema
            logger.info("使用定制Schema")
        else:
            # Default schema
            self.schema = {
                "Nodes": ["person", "organization", "location", "event", "concept", "technology", "product"],
                "Relations": ["related_to", "part_of", "located_in", "works_for", "created_by", "influences", "depends_on"],
                "Attributes": ["name", "description", "type", "status", "date", "profession", "title"]
            }
            logger.info("📋 使用默认Schema")
        
        # 提取领域信息
        self.domain_info = self.schema.get('domain_info', {})
        self.primary_domain = self.domain_info.get('primary_domain', '通用')
        self.key_concepts = ', '.join(self.domain_info.get('key_concepts', []))
        
        logger.info(f"SPO抽取器初始化: {len(self.schema['Nodes'])}实体类型, {len(self.schema['Relations'])}关系类型, {len(self.schema['Attributes'])}属性类型")
        logger.debug(f"主要领域: {self.primary_domain}")
    
    def extract(self, text: str, **kwargs) -> Tuple[List[Entity], List[Relationship]]:
        """Extract entities and relationships in a single call
        
        Args:
            text: Text to extract from
            **kwargs: Additional parameters
            
        Returns:
            Tuple of (entities, relationships)
        """
        logger.info(f"开始SPO抽取，文本长度: {len(text)} 字符")
        
        if not self.llm_client:
            raise ValueError("LLM client is required for SPO extraction")
        
        try:
            # Build prompt
            logger.debug("构建SPO抽取提示词...")
            prompt = self._build_spo_prompt(text)
            
            # Call LLM
            logger.debug("调用LLM进行SPO抽取")
            response = self.llm_client.call(prompt)
            logger.debug(f"LLM响应长度: {len(response)} 字符")
            
            # Parse response
            logger.debug("解析LLM响应...")
            spo_data = self._parse_spo_response(response)
            logger.debug(f"解析结果: {len(spo_data.get('entity_types', {}))} 个实体类型, {len(spo_data.get('triples', []))} 个三元组")
            
            # Convert to entities and relationships
            logger.debug("🔄 转换为实体和关系对象...")
            entities, relationships = self._convert_spo_to_objects(spo_data, text, **kwargs)
            
            logger.success(f"✅ SPO抽取完成: {len(entities)} 个实体, {len(relationships)} 个关系")
            
            return entities, relationships
            
        except Exception as e:
            logger.error(f"❌ SPO抽取失败: {e}")
            logger.debug(f"❌ 错误详情: {type(e).__name__}: {str(e)}")
            import traceback
            logger.debug(f"❌ 错误堆栈: {traceback.format_exc()}")
            return [], []
    
    async def extract_batch(self, texts: List[str], batch_size: int = 1, **kwargs) -> Tuple[List[Entity], List[Relationship]]:
        """批处理SPO抽取，显著提高性能
        
        Args:
            texts: 文本列表
            batch_size: 批处理大小
            **kwargs: 额外参数
            
        Returns:
            Tuple of (all_entities, all_relationships)
        """
        # 计算文本统计信息
        total_chars = sum(len(text) for text in texts)
        avg_chars = total_chars / len(texts) if texts else 0
        
        logger.info(f"开始批处理SPO抽取，总文本数: {len(texts)}, 批大小: {batch_size}")
        logger.info(f"文本统计: 总字符数={total_chars}, 平均字符数={avg_chars:.0f}/文本")
        
        all_entities = []
        all_relationships = []
        
        # 分批处理
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(texts) + batch_size - 1) // batch_size
            
            # 计算当前批次的字符数统计
            batch_chars = sum(len(text) for text in batch_texts)
            batch_avg_chars = batch_chars / len(batch_texts) if batch_texts else 0
            
            logger.info(f"处理批次 {batch_num}/{total_batches} ({len(batch_texts)}个文本, {batch_chars}字符, 平均{batch_avg_chars:.0f}字符/文本)")
            
            try:
                # 构建批处理提示词
                batch_prompt = self._build_batch_spo_prompt(batch_texts)
                
                # 调用LLM
                logger.debug("调用LLM进行批处理SPO抽取")
                response = self.llm_client.call(batch_prompt)
                
                # 解析批处理响应
                batch_entities, batch_relationships = self._parse_batch_spo_response(response, batch_texts, i, **kwargs)
                
                all_entities.extend(batch_entities)
                all_relationships.extend(batch_relationships)
                
                logger.info(f"✅ 批次 {batch_num} 完成: {len(batch_entities)} 个实体, {len(batch_relationships)} 个关系")
                
            except Exception as e:
                logger.error(f"❌ 批次 {batch_num} 处理失败: {e}")
                # 回退到单个处理
                for j, text in enumerate(batch_texts):
                    try:
                        entities, relationships = self.extract(text, chunk_id=f"chunk_{i+j}", **kwargs)
                        all_entities.extend(entities)
                        all_relationships.extend(relationships)
                    except Exception as single_e:
                        logger.error(f"❌ 单个文本处理也失败: {single_e}")
        
        logger.success(f"🎉 批处理SPO抽取完成: 总计 {len(all_entities)} 个实体, {len(all_relationships)} 个关系")
        return all_entities, all_relationships
    
    def _build_batch_spo_prompt(self, texts: List[str]) -> str:
        """构建批处理SPO抽取提示词"""
        schema_str = json.dumps(self.schema, ensure_ascii=False, indent=2)
        
        # 构建批处理文本
        batch_content = ""
        for i, text in enumerate(texts):
            batch_content += f"\n=== 文档片段 {i+1} ===\n{text}\n"
        
        prompt = f"""你是专业的知识图谱构建专家。请从以下文档片段中抽取实体、关系和属性。

领域：{self.primary_domain}
核心概念：{self.key_concepts}

可用的实体类型：{', '.join(self.schema.get('Nodes', []))}
可用的关系类型：{', '.join(self.schema.get('Relations', []))}

文档片段：
{batch_content}

请严格按照以下JSON格式返回，确保JSON语法正确：

{{
    "entity_types": {{
        "实体名称": {{
            "type": "实体类型",
            "description": "实体描述",
            "attributes": {{"属性名": "属性值"}},
            "source_chunks": ["chunk_0"]
        }}
    }},
    "triples": [
        {{
            "subject": "主体实体",
            "predicate": "关系类型",
            "object": "客体实体",
            "description": "关系描述",
            "confidence": 0.8,
            "source_chunks": ["chunk_0"]
        }}
    ]
}}

要求：
1. 抽取尽可能多的实体和关系
2. 使用Schema中定义的类型
3. 确保JSON格式正确，注意逗号和引号
4. 只返回JSON，不要其他文字"""
        
        return prompt
    
    def _parse_batch_spo_response(self, response: str, texts: List[str], start_index: int, **kwargs) -> Tuple[List[Entity], List[Relationship]]:
        """解析批处理SPO响应"""
        try:
            # 清理和解析响应
            cleaned_response = self._clean_llm_response(response)
            logger.debug(f"清理后的响应长度: {len(cleaned_response)}")
            
            try:
                spo_data = json.loads(cleaned_response)
            except json.JSONDecodeError as json_error:
                logger.warning(f"⚠️ JSON解析失败: {json_error}")
                logger.debug(f"问题JSON片段: {cleaned_response[:200]}...")
                
                # 尝试更激进的修复
                fixed_response = self._aggressive_json_fix(cleaned_response)
                try:
                    spo_data = json.loads(fixed_response)
                    logger.info("✅ 激进修复成功")
                except:
                    logger.error("❌ 激进修复也失败，返回空结果")
                    return [], []
            
            # 转换为实体和关系对象
            entities, relationships = self._convert_spo_to_objects(spo_data, "\n".join(texts), **kwargs)
            
            # 更新chunk_id映射
            for entity in entities:
                if hasattr(entity, 'source_chunks'):
                    # 将相对chunk编号转换为绝对编号
                    updated_chunks = set()
                    for chunk_ref in entity.source_chunks:
                        if chunk_ref.startswith('chunk_'):
                            chunk_num = int(chunk_ref.split('_')[1])
                            updated_chunks.add(f"chunk_{start_index + chunk_num}")
                        else:
                            updated_chunks.add(chunk_ref)
                    entity.source_chunks = updated_chunks
            
            for relationship in relationships:
                if hasattr(relationship, 'source_chunks'):
                    # 将相对chunk编号转换为绝对编号
                    updated_chunks = set()
                    for chunk_ref in relationship.source_chunks:
                        if chunk_ref.startswith('chunk_'):
                            chunk_num = int(chunk_ref.split('_')[1])
                            updated_chunks.add(f"chunk_{start_index + chunk_num}")
                        else:
                            updated_chunks.add(chunk_ref)
                    relationship.source_chunks = updated_chunks
            
            return entities, relationships
            
        except Exception as e:
            logger.error(f"❌ 批处理响应解析失败: {e}")
            return [], []
    
    def _find_entity_id(self, entity_name: str, entity_id_map: Dict[str, str]) -> Optional[str]:
        """查找实体ID，支持智能模糊匹配"""
        # 1. 精确匹配
        if entity_name in entity_id_map:
            return entity_id_map[entity_name]
        
        # 2. 标准化名称匹配
        normalized_target = self._normalize_entity_name(entity_name)
        for name, entity_id in entity_id_map.items():
            if self._normalize_entity_name(name) == normalized_target:
                logger.debug(f"标准化匹配成功: '{entity_name}' -> '{name}'")
                return entity_id
        
        # 3. 相似度匹配（处理复合词、缩写等）
        best_match = None
        best_score = 0.0
        
        for name, entity_id in entity_id_map.items():
            score = self._calculate_similarity(entity_name, name)
            if score > best_score and score >= 0.8:  # 相似度阈值
                best_score = score
                best_match = (name, entity_id)
        
        if best_match:
            logger.debug(f"相似度匹配成功: '{entity_name}' -> '{best_match[0]}' (相似度: {best_score:.2f})")
            return best_match[1]
        
        # 4. 包含关系匹配（降低优先级）
        for name, entity_id in entity_id_map.items():
            if len(normalized_target) > 3:  # 避免短词误匹配
                if normalized_target in self._normalize_entity_name(name) or self._normalize_entity_name(name) in normalized_target:
                    logger.debug(f"包含匹配成功: '{entity_name}' -> '{name}'")
                    return entity_id
        
        return None
    
    def _normalize_entity_name(self, name: str) -> str:
        """标准化实体名称"""
        import re
        # 转换为小写
        normalized = name.lower().strip()
        # 替换连字符和下划线为空格
        normalized = re.sub(r'[-_]', ' ', normalized)
        # 移除标点符号（保留字母数字和空格）
        normalized = re.sub(r'[^\w\s]', '', normalized)
        # 合并多个空格为单个空格
        normalized = re.sub(r'\s+', ' ', normalized)
        return normalized.strip()
    
    def _select_template(self, text: str) -> str:
        """智能选择SPO抽取模板"""
        text_length = len(text)
        
        # 1. 根据文本长度选择
        if text_length < 500:
            logger.debug(f"📏 文本较短({text_length}字符)，选择简化模板")
            return "simple_template"
        
        # 2. 根据领域信息选择领域特定模板
        if hasattr(self, 'primary_domain') and self.primary_domain:
            domain_lower = self.primary_domain.lower()
            
            # 技术领域
            if any(keyword in domain_lower for keyword in ['技术', '科技', '人工智能', 'ai', 'technology', 'tech']):
                logger.debug(f"检测到技术领域: {self.primary_domain}")
                return "domain_templates.technology"
            
            # 商业领域
            elif any(keyword in domain_lower for keyword in ['商业', '业务', '管理', 'business', 'management']):
                logger.debug(f"💼 检测到商业领域: {self.primary_domain}")
                return "domain_templates.business"
            
            # 学术领域
            elif any(keyword in domain_lower for keyword in ['学术', '研究', '科学', 'academic', 'research', 'science']):
                logger.debug(f"🎓 检测到学术领域: {self.primary_domain}")
                return "domain_templates.academic"
        
        # 3. 根据文本内容特征选择
        text_lower = text.lower()
        
        # 技术文档特征
        tech_keywords = ['算法', '模型', '框架', '系统', '代码', 'algorithm', 'model', 'framework', 'system']
        if any(keyword in text_lower for keyword in tech_keywords):
            logger.debug("根据内容特征选择技术模板")
            return "domain_templates.technology"
        
        # 商业文档特征
        business_keywords = ['公司', '市场', '销售', '客户', '业绩', 'company', 'market', 'sales', 'customer']
        if any(keyword in text_lower for keyword in business_keywords):
            logger.debug("💼 根据内容特征选择商业模板")
            return "domain_templates.business"
        
        # 学术文档特征
        academic_keywords = ['论文', '研究', '实验', '理论', 'paper', 'research', 'experiment', 'theory']
        if any(keyword in text_lower for keyword in academic_keywords):
            logger.debug("🎓 根据内容特征选择学术模板")
            return "domain_templates.academic"
        
        # 4. 默认使用主模板
        logger.debug("使用默认主模板")
        return "template"
    
    def _calculate_similarity(self, name1: str, name2: str) -> float:
        """计算两个实体名称的相似度"""
        # 标准化名称
        norm1 = self._normalize_entity_name(name1)
        norm2 = self._normalize_entity_name(name2)
        
        # 如果完全相同
        if norm1 == norm2:
            return 1.0
        
        # 分词处理
        words1 = set(norm1.split())
        words2 = set(norm2.split())
        
        # 如果其中一个是另一个的子集
        if words1.issubset(words2) or words2.issubset(words1):
            return 0.9
        
        # 计算Jaccard相似度
        intersection = len(words1.intersection(words2))
        union = len(words1.union(words2))
        
        if union == 0:
            return 0.0
        
        jaccard_score = intersection / union
        
        # 处理缩写情况（如 LLMs vs Large Language Models）
        if self._is_abbreviation_match(norm1, norm2):
            jaccard_score = max(jaccard_score, 0.85)
        
        # 处理编辑距离
        edit_distance_score = self._calculate_edit_distance_similarity(norm1, norm2)
        
        # 综合评分
        final_score = max(jaccard_score, edit_distance_score * 0.8)
        
        return final_score
    
    def _is_abbreviation_match(self, name1: str, name2: str) -> bool:
        """检查是否为缩写匹配"""
        words1 = name1.split()
        words2 = name2.split()
        
        # 检查一个是否为另一个的首字母缩写
        if len(words1) == 1 and len(words2) > 1:
            abbrev = ''.join([w[0] for w in words2 if w])
            return words1[0].replace('s', '') == abbrev.lower()  # 处理复数形式
        elif len(words2) == 1 and len(words1) > 1:
            abbrev = ''.join([w[0] for w in words1 if w])
            return words2[0].replace('s', '') == abbrev.lower()
        
        return False
    
    def _calculate_edit_distance_similarity(self, s1: str, s2: str) -> float:
        """计算编辑距离相似度"""
        if len(s1) == 0 or len(s2) == 0:
            return 0.0
        
        # 简化的编辑距离计算
        max_len = max(len(s1), len(s2))
        if max_len == 0:
            return 1.0
        
        # 计算公共子序列长度
        common_chars = 0
        for char in set(s1):
            common_chars += min(s1.count(char), s2.count(char))
        
        return common_chars / max_len
    
    def _create_missing_entity(self, entity_name: str, entities: List, entity_id_map: Dict[str, str], source_text: str = "") -> Optional[str]:
        """动态创建缺失的实体，从原文中提取描述"""
        import uuid
        import re
        from .models import Entity, EntityType
        
        # 过滤掉过短或无意义的实体名称
        if len(entity_name.strip()) < 2:
            return None
        
        # 过滤掉常见的无意义词汇
        meaningless_words = {
            'information', 'data', 'system', 'method', 'approach', 'way', 'means',
            'process', 'technique', 'strategy', 'solution', 'result', 'output'
        }
        
        normalized_name = self._normalize_entity_name(entity_name)
        if normalized_name in meaningless_words:
            return None
        
        # 生成新的实体ID
        entity_id = str(uuid.uuid4())
        
        # 推断实体类型（简单的启发式规则）
        try:
            entity_type = self._infer_entity_type(entity_name)
            logger.debug(f"推断实体类型: {entity_name} -> {entity_type.value}")
        except Exception as e:
            logger.warning(f"⚠️ 实体类型推断失败: {e}，使用默认类型")
            from .models import EntityType
            entity_type = EntityType.CONCEPT
        
        # 从原文中提取实体描述
        entity_description = self._extract_entity_description_from_text(entity_name, source_text)
        
        # 创建新实体
        try:
            new_entity = Entity(
                id=entity_id,
                name=entity_name,
                entity_type=entity_type,
                description=entity_description,
                confidence=0.7  # 动态创建的实体置信度较低
            )
            logger.debug(f"✅ 成功创建实体: {entity_name} ({entity_type.value}) - {entity_description[:50]}...")
        except Exception as e:
            logger.error(f"❌ 创建实体失败: {e}")
            return None
        
        # 添加到实体列表和映射
        entities.append(new_entity)
        entity_id_map[entity_name] = entity_id
        
        return entity_id
    
    def _infer_entity_type(self, entity_name: str) -> 'EntityType':
        """推断实体类型"""
        from .models import EntityType
        
        name_lower = entity_name.lower()
        
        # 人员相关
        if any(word in name_lower for word in ['人', '者', '员', 'person', 'researcher', 'author', 'developer']):
            return EntityType.PERSON
        
        # 组织相关
        if any(word in name_lower for word in ['公司', '组织', '机构', 'company', 'organization', 'institution']):
            return EntityType.ORGANIZATION
        
        # 地点相关
        if any(word in name_lower for word in ['地', '市', '国', 'location', 'city', 'country', 'place']):
            return EntityType.LOCATION
        
        # 事件相关
        if any(word in name_lower for word in ['过程', '流程', '操作', '任务', 'process', 'procedure', 'operation', 'task', 'event']):
            return EntityType.EVENT
        
        # 对象相关（技术产品、工具等）
        if any(word in name_lower for word in ['系统', '平台', '工具', '软件', '模型', 'system', 'platform', 'tool', 'software', 'model']):
            return EntityType.OBJECT
        
        # 时间相关
        if any(word in name_lower for word in ['时间', '日期', '年', '月', 'time', 'date', 'year', 'month']):
            return EntityType.TIME
        
        # 概念相关（算法、方法、理论等）
        if any(word in name_lower for word in ['算法', '方法', '技术', '理论', '概念', 'algorithm', 'method', 'technique', 'theory', 'concept', 'approach']):
            return EntityType.CONCEPT
        
        # 默认返回概念类型
        return EntityType.CONCEPT
    
    def _extract_entity_description_from_text(self, entity_name: str, source_text: str) -> str:
        """从原文中提取实体的描述信息"""
        import re
        
        if not source_text or not entity_name:
            return f"实体: {entity_name}"
        
        # 尝试多种模式提取实体描述
        patterns = [
            # 模式1: "实体名称是/为/指..."
            rf"{re.escape(entity_name)}(?:是|为|指|表示|代表)([^。，；！？\n]+)",
            # 模式2: "实体名称，描述..."
            rf"{re.escape(entity_name)}，([^。，；！？\n]+)",
            # 模式3: "实体名称：描述..."
            rf"{re.escape(entity_name)}：([^。，；！？\n]+)",
            # 模式4: "实体名称 - 描述..."
            rf"{re.escape(entity_name)}\s*-\s*([^。，；！？\n]+)",
            # 模式5: "实体名称(描述)"
            rf"{re.escape(entity_name)}\s*\(([^)]+)\)",
            # 模式6: 英文模式 "EntityName is/are..."
            rf"{re.escape(entity_name)}\s+(?:is|are|refers to|represents?)\s+([^.;,!?\n]+)",
            # 模式7: 前后文描述
            rf"([^。，；！？\n]*{re.escape(entity_name)}[^。，；！？\n]*)"
        ]
        
        best_description = ""
        max_length = 0
        
        for pattern in patterns:
            try:
                matches = re.finditer(pattern, source_text, re.IGNORECASE)
                for match in matches:
                    if len(match.groups()) > 0:
                        desc = match.group(1).strip()
                        # 过滤掉过短或无意义的描述
                        if len(desc) > max_length and len(desc) > 5:
                            # 清理描述文本
                            desc = re.sub(r'\s+', ' ', desc)  # 规范化空白字符
                            desc = desc.strip('，。；！？.,;!?')  # 移除标点符号
                            if desc and not desc.lower() in ['是', 'is', 'are', 'the', 'a', 'an']:
                                best_description = desc
                                max_length = len(desc)
            except Exception as e:
                logger.debug(f"模式匹配失败: {pattern}, 错误: {e}")
                continue
        
        # 如果没有找到好的描述，尝试提取实体周围的上下文
        if not best_description and source_text:
            try:
                # 查找实体在文本中的位置
                entity_pos = source_text.lower().find(entity_name.lower())
                if entity_pos != -1:
                    # 提取前后各50个字符作为上下文
                    start = max(0, entity_pos - 50)
                    end = min(len(source_text), entity_pos + len(entity_name) + 50)
                    context = source_text[start:end].strip()
                    
                    # 清理上下文
                    context = re.sub(r'\s+', ' ', context)
                    if len(context) > 20:
                        best_description = f"上下文: {context}"
            except Exception as e:
                logger.debug(f"上下文提取失败: {e}")
        
        # 如果仍然没有描述，使用实体名称本身
        if not best_description:
            best_description = f"实体: {entity_name}"
        
        return best_description
    
    def _build_spo_prompt(self, text: str) -> str:
        """Build SPO extraction prompt using prompt manager and custom schema"""
        
        if self.prompt_manager:
            # 使用提示词管理器，智能选择模板
            try:
                custom_schema_str = json.dumps(self.schema, ensure_ascii=False, indent=2)
                
                # 智能选择模板
                template_name = self._select_template(text)
                logger.info(f"选择模板: {template_name}")
                
                # 处理领域模板路径
                if template_name.startswith("domain_templates."):
                    domain_type = template_name.split(".")[-1]
                    prompt = self.prompt_manager.format_prompt(
                        "spo_extraction",
                        template_key=f"domain_templates.{domain_type}.template",
                        custom_schema=custom_schema_str,
                        node_types=', '.join(self.schema.get('Nodes', [])),
                        relation_types=', '.join(self.schema.get('Relations', [])),
                        attribute_types=', '.join(self.schema.get('Attributes', [])),
                        primary_domain=self.primary_domain,
                        key_concepts=self.key_concepts,
                        text=text
                    )
                else:
                    prompt = self.prompt_manager.format_prompt(
                        "spo_extraction",
                        template_key=template_name,
                        custom_schema=custom_schema_str,
                        node_types=', '.join(self.schema.get('Nodes', [])),
                        relation_types=', '.join(self.schema.get('Relations', [])),
                        attribute_types=', '.join(self.schema.get('Attributes', [])),
                        primary_domain=self.primary_domain,
                        key_concepts=self.key_concepts,
                        text=text
                    )
                
                if prompt:
                    logger.debug(f"使用{template_name}模板生成SPO抽取提示词")
                    return prompt
                else:
                    logger.warning("⚠️ 提示词模板加载失败，使用默认提示词")
                    
            except Exception as e:
                logger.error(f"❌ 提示词模板处理失败: {e}")
                logger.warning("🔄 回退到默认提示词")
        
        # 回退到默认提示词
        schema_str = json.dumps(self.schema, ensure_ascii=False, indent=2)
        
        prompt = f"""你是专业的知识图谱构建专家。请基于定制Schema分析文本，抽取尽可能多的有价值实体、属性和关系，以结构化JSON格式返回。

定制Schema：
```json
{schema_str}
```

领域信息：
- 主要领域：{self.primary_domain}
- 核心概念：{self.key_concepts}

文本内容：
```
{text}
```

抽取指导：
1. **优先使用定制Schema**：严格按照上述Schema中的类型进行抽取
2. **完整性**：不遗漏文本中的重要信息
3. **准确性**：确保抽取的实体和关系准确无误
4. **简洁性**：避免冗余和重复信息
5. **一致性**：实体名称在整个抽取过程中保持一致

输出格式：
```json
{{
  "attributes": {{
    "实体名称": ["属性1: 值1", "属性2: 值2"]
  }},
  "triples": [
    ["实体1", "关系", "实体2"]
  ],
  "entity_types": {{
    "实体名称": "实体类型"
  }}
}}
```

只返回JSON，无其他内容。"""
        
        return prompt.strip()
    
    def _parse_spo_response(self, response: str) -> Dict[str, Any]:
        """Parse LLM response into SPO data"""
        try:
            # Clean response
            cleaned_response = self._clean_llm_response(response)
            
            # Parse JSON
            spo_data = json.loads(cleaned_response)
            
            # Validate required fields
            required_fields = ['attributes', 'triples', 'entity_types']
            for field in required_fields:
                if field not in spo_data:
                    logger.warning(f"⚠️ 缺少字段: {field}")
                    spo_data[field] = {} if field != 'triples' else []
            
            return spo_data
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON解析失败: {e}")
            logger.debug(f"原始响应: {response}")
            return {"attributes": {}, "triples": [], "entity_types": {}}
    
    def _clean_llm_response(self, response: str) -> str:
        """Clean LLM response to extract valid JSON with enhanced error handling"""
        import re
        
        # Remove markdown code blocks
        response = response.strip()
        if response.startswith('```json'):
            response = response[7:]
        elif response.startswith('```'):
            response = response[3:]
        if response.endswith('```'):
            response = response[:-3]
        
        # Find JSON content - look for the first complete JSON object
        start_idx = response.find('{')
        if start_idx == -1:
            return '{"entity_types": {}, "triples": []}'
        
        # Find the matching closing brace
        brace_count = 0
        end_idx = start_idx
        
        for i in range(start_idx, len(response)):
            if response[i] == '{':
                brace_count += 1
            elif response[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    end_idx = i
                    break
        
        if brace_count == 0:
            json_content = response[start_idx:end_idx+1]
        else:
            # Fallback to original method
            end_idx = response.rfind('}')
            if end_idx > start_idx:
                json_content = response[start_idx:end_idx+1]
            else:
                json_content = '{"entity_types": {}, "triples": []}'
        
        # 尝试修复常见的JSON错误
        json_content = self._fix_json_errors(json_content)
        
        return json_content.strip()
    
    def _fix_json_errors(self, json_str: str) -> str:
        """修复常见的JSON格式错误"""
        import re
        
        # 修复尾随逗号
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        
        # 修复缺少逗号的问题
        json_str = re.sub(r'"\s*\n\s*"', '",\n"', json_str)
        json_str = re.sub(r'}\s*\n\s*"', '},\n"', json_str)
        json_str = re.sub(r']\s*\n\s*"', '],\n"', json_str)
        
        # 修复单引号为双引号
        json_str = re.sub(r"'([^']*)':", r'"\1":', json_str)
        
        # 确保基本结构存在
        if '"entity_types"' not in json_str:
            json_str = json_str.replace('{', '{"entity_types": {},', 1)
        if '"triples"' not in json_str:
            json_str = json_str.replace('}', ', "triples": []}', 1)
        
        return json_str
    
    def _aggressive_json_fix(self, json_str: str) -> str:
        """更激进的JSON修复方法，处理复杂的格式错误"""
        import re
        
        # 移除所有注释
        json_str = re.sub(r'//.*?\n', '\n', json_str)
        json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
        
        # 修复属性名没有双引号的问题
        json_str = re.sub(r'(\w+)(\s*:)', r'"\1"\2', json_str)
        
        # 修复字符串值没有双引号的问题（但要避免数字和布尔值）
        json_str = re.sub(r':\s*([^"\d\[\{][^,\}\]]*?)([,\}\]])', r': "\1"\2', json_str)
        
        # 修复多余的逗号
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        
        # 修复缺少逗号的问题
        json_str = re.sub(r'([}\]"])\s*\n\s*(["\[{])', r'\1,\n\2', json_str)
        
        # 确保基本结构
        if not json_str.strip().startswith('{'):
            json_str = '{' + json_str
        if not json_str.strip().endswith('}'):
            json_str = json_str + '}'
        
        # 如果还是有问题，返回最小有效JSON
        try:
            json.loads(json_str)
            return json_str
        except:
            logger.warning("返回最小有效JSON结构")
            return '{"entity_types": {}, "triples": []}'
    
    def _convert_spo_to_objects(self, spo_data: Dict[str, Any], source_text: str, **kwargs) -> Tuple[List[Entity], List[Relationship]]:
        """Convert SPO data to Entity and Relationship objects"""
        entities = []
        relationships = []
        entity_id_map = {}  # name -> id mapping
        
        # Create entities
        entity_types = spo_data.get('entity_types', {})
        attributes = spo_data.get('attributes', {})
        
        for entity_name, entity_data in entity_types.items():
            # Generate unique ID
            entity_id = f"entity_{len(entities) + 1}"
            entity_id_map[entity_name] = entity_id
            
            # 处理不同的数据格式
            if isinstance(entity_data, dict):
                # 新的批处理格式
                entity_type = entity_data.get('type', 'concept')
                entity_description = entity_data.get('description', '')
                entity_attrs = entity_data.get('attributes', {})
                
                # 转换属性格式
                attr_dict = entity_attrs if isinstance(entity_attrs, dict) else {}
                description_parts = [entity_description] if entity_description else []
            else:
                # 旧的简单格式
                entity_type = entity_data
                entity_attrs = attributes.get(entity_name, [])
                attr_dict = {}
                description_parts = []
                
                for attr in entity_attrs:
                    if ':' in str(attr):
                        key, value = str(attr).split(':', 1)
                        attr_dict[key.strip()] = value.strip()
                        description_parts.append(str(attr))
                    else:
                        description_parts.append(str(attr))
            
            # Create entity
            try:
                # 确保entity_type是字符串
                if isinstance(entity_type, dict):
                    entity_type = entity_type.get('type', 'concept')
                entity_type_str = str(entity_type).lower()
                entity_type_enum = EntityType(entity_type_str)
            except (ValueError, AttributeError):
                entity_type_enum = EntityType.CONCEPT  # Default fallback
            
            entity = Entity(
                id=entity_id,
                name=entity_name,
                entity_type=entity_type_enum,
                description='; '.join(description_parts),
                confidence=0.8,  # Default confidence
                attributes=attr_dict,
                source_chunks={kwargs.get('chunk_id', 'unknown')}
            )
            
            entities.append(entity)
            logger.debug(f"📍 创建实体: {entity_name} ({entity_type}) -> {entity_id}")
        
        # Create relationships
        triples = spo_data.get('triples', [])
        
        for triple in triples:
            # 处理不同的三元组格式
            if isinstance(triple, dict):
                # 新的批处理格式
                source_name = triple.get('subject', '')
                relation = triple.get('predicate', '')
                target_name = triple.get('object', '')
            elif isinstance(triple, (list, tuple)) and len(triple) == 3:
                # 旧的简单格式
                source_name, relation, target_name = triple
            else:
                logger.warning(f"⚠️ 跳过无效三元组格式: {triple}")
                continue
            
            # 确保所有字段都是字符串
            source_name = str(source_name).strip()
            target_name = str(target_name).strip()
            
            if not source_name or not target_name:
                logger.warning(f"⚠️ 跳过空实体名称的三元组: {triple}")
                continue
            
            # Get entity IDs with fuzzy matching
            source_id = self._find_entity_id(source_name, entity_id_map)
            target_id = self._find_entity_id(target_name, entity_id_map)
            
            if not source_id:
                # 动态创建缺失的源实体
                source_id = self._create_missing_entity(source_name, entities, entity_id_map, source_text)
                if not source_id:
                    logger.warning(f"⚠️ 源实体未找到且无法创建: {source_name}")
                    continue
                else:
                    logger.info(f"动态创建源实体: {source_name}")
                    
            if not target_id:
                # 动态创建缺失的目标实体
                target_id = self._create_missing_entity(target_name, entities, entity_id_map, source_text)
                if not target_id:
                    logger.warning(f"⚠️ 目标实体未找到且无法创建: {target_name}")
                    continue
                else:
                    logger.info(f"动态创建目标实体: {target_name}")
            
            # Create relationship
            try:
                # 确保relation是字符串
                if isinstance(relation, dict):
                    relation = relation.get('type', 'related_to')
                relation_str = str(relation).lower().replace(' ', '_')
                relation_type_enum = RelationType(relation_str)
            except (ValueError, AttributeError):
                relation_type_enum = RelationType.RELATED_TO  # Default fallback
            
            relationship = Relationship(
                source_entity_id=source_id,
                target_entity_id=target_id,
                relation_type=relation_type_enum,
                description=f"{source_name} {relation} {target_name}",
                confidence=0.8,  # Default confidence
                source_chunks={kwargs.get('chunk_id', 'unknown')}
            )
            
            relationships.append(relationship)
            logger.debug(f"🔗 创建关系: {source_name} --[{relation}]--> {target_name}")
        
        return entities, relationships