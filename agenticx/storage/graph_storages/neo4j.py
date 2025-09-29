"""
AgenticX Neo4j Graph Storage

Neo4j图存储实现，支持图数据库操作。
"""

from typing import Any, Dict, List, Optional
import logging
import warnings
from .base import BaseGraphStorage

try:
    from neo4j import GraphDatabase
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False
    GraphDatabase = None

logger = logging.getLogger(__name__)

# 过滤Neo4j相关的弃用警告
warnings.filterwarnings("ignore", category=DeprecationWarning, module="neo4j")
warnings.filterwarnings("ignore", message=".*session.*")


class Neo4jStorage(BaseGraphStorage):
    """Neo4j图存储实现
    
    使用Neo4j进行图数据库存储。
    """

    def __init__(self, uri: str = "bolt://localhost:7687", username: str = "neo4j", password: str = "password"):
        """初始化Neo4j存储
        
        Args:
            uri: Neo4j连接URI
            username: 用户名
            password: 密码
        """
        self.uri = uri
        self.username = username
        self.password = password
        self._client = None
        self._schema = ""
        self._structured_schema: Dict[str, Any] = {}
        
        if not NEO4J_AVAILABLE:
            logger.warning("⚠️  Neo4j驱动未安装，使用内存存储模拟。请运行: pip install neo4j")
            return
            
        try:
            logger.info(f"🔗 尝试连接到Neo4j: {uri}")
            logger.info(f"   用户名: {username}")
            logger.info(f"   密码: {'*' * len(password) if password else 'None'}")
            
            self._client = GraphDatabase.driver(uri, auth=(username, password))
            # 测试连接
            with self._client.session() as session:
                result = session.run("RETURN 1 as test")
                test_result = result.single()["test"]
                logger.info(f"✅ Neo4j连接测试成功，返回值: {test_result}")
            logger.info("✅ Successfully connected to Neo4j")
        except Exception as e:
            logger.error(f"❌ Neo4j连接失败: {e}")
            logger.warning("⚠️ 使用模拟模式")
            self._client = None

    @property
    def get_client(self) -> Any:
        """获取底层图存储客户端"""
        return self._client

    @property
    def get_schema(self) -> str:
        """获取图存储的schema"""
        return self._schema

    @property
    def get_structured_schema(self) -> Dict[str, Any]:
        """获取图存储的结构化schema"""
        return self._structured_schema

    def refresh_schema(self) -> None:
        """刷新图schema信息"""
        if not self._client:
            logger.info("✅ 模拟刷新Neo4j schema信息")
            return
            
        try:
            with self._client.session() as session:
                # 获取节点标签
                result = session.run("CALL db.labels()")
                labels = [record["label"] for record in result]
                
                # 获取关系类型
                result = session.run("CALL db.relationshipTypes()")
                rel_types = [record["relationshipType"] for record in result]
                
                self._schema = f"Labels: {labels}, Relationships: {rel_types}"
                self._structured_schema = {"labels": labels, "relationships": rel_types}
                logger.info("✅ 刷新Neo4j schema信息成功")
        except Exception as e:
            logger.error(f"❌ 刷新Neo4j schema失败: {e}")

    def add_triplet(self, subj: str, obj: str, rel: str) -> None:
        """在数据库中添加两个实体之间的关系（三元组）
        
        Args:
            subj: 主体实体的标识符
            obj: 客体实体的标识符
            rel: 主体和客体之间的关系
        """
        if not self._client:
            logger.info(f"✅ 模拟添加三元组 {subj} -[{rel}]-> {obj} 到Neo4j")
            return
            
        try:
            with self._client.session() as session:
                # 使用关系类型作为Neo4j关系标签
                relation_label = rel.upper().replace(' ', '_')
                query = f"""
                MERGE (s:Entity {{id: $subj}})
                MERGE (o:Entity {{id: $obj}})
                MERGE (s)-[r:{relation_label}]->(o)
                """
                session.run(query, subj=subj, obj=obj)
                logger.info(f"✅ 添加三元组 {subj} -[{rel}]-> {obj} 到Neo4j成功")
        except Exception as e:
            logger.error(f"❌ 添加三元组到Neo4j失败: {e}")

    def delete_triplet(self, subj: str, obj: str, rel: str) -> None:
        """从图中删除特定的三元组，包括主体、客体和关系
        
        Args:
            subj: 主体实体的标识符
            obj: 客体实体的标识符
            rel: 主体和客体之间的关系
        """
        # TODO: 实现Neo4j三元组删除逻辑
        print(f"✅ 模拟删除三元组 {subj} -[{rel}]-> {obj} 从Neo4j")

    def add_node(self, node_id: str, properties: Optional[Dict[str, Any]] = None, **kwargs: Any) -> None:
        """添加节点
        
        Args:
            node_id: 节点ID
            properties: 节点属性
            **kwargs: 额外参数
        """
        if not self._client:
            logger.info(f"✅ 模拟添加节点 {node_id} 到Neo4j")
            return
            
        try:
            with self._client.session() as session:
                props = properties or {}
                props['id'] = node_id
                
                # 构建属性字符串
                prop_str = ', '.join([f"{k}: ${k}" for k in props.keys()])
                query = f"MERGE (n:Entity {{{prop_str}}})"
                
                session.run(query, **props)
                logger.info(f"✅ 添加节点 {node_id} 到Neo4j成功")
        except Exception as e:
            logger.error(f"❌ 添加节点到Neo4j失败: {e}")

    def add_edge(self, from_node: str, to_node: str, edge_type: str, properties: Optional[Dict[str, Any]] = None, **kwargs: Any) -> None:
        """添加边
        
        Args:
            from_node: 源节点ID
            to_node: 目标节点ID
            edge_type: 边类型
            properties: 边属性
            **kwargs: 额外参数
        """
        if not self._client:
            logger.info(f"✅ 模拟添加边 {from_node} -> {to_node} 到Neo4j")
            return
            
        try:
            with self._client.session() as session:
                props = properties or {}
                props['type'] = edge_type
                
                # 构建属性字符串
                prop_str = ', '.join([f"{k}: ${k}" for k in props.keys()])
                query = f"""
                MERGE (a:Entity {{id: $from_node}})
                MERGE (b:Entity {{id: $to_node}})
                MERGE (a)-[r:RELATION {{{prop_str}}}]->(b)
                """
                
                session.run(query, from_node=from_node, to_node=to_node, **props)
                logger.info(f"✅ 添加边 {from_node} -> {to_node} 到Neo4j成功")
        except Exception as e:
            logger.error(f"❌ 添加边到Neo4j失败: {e}")

    def get_node(self, node_id: str, **kwargs: Any) -> Optional[Dict[str, Any]]:
        """获取节点
        
        Args:
            node_id: 节点ID
            **kwargs: 额外参数
            
        Returns:
            节点数据
        """
        # TODO: 实现Neo4j节点获取逻辑
        print(f"✅ 模拟从Neo4j获取节点 {node_id}")
        return None

    def get_neighbors(self, node_id: str) -> List[Dict[str, Any]]:
        """获取节点的邻居
        
        Args:
            node_id: 节点ID
            
        Returns:
            邻居节点列表
        """
        # TODO: 实现Neo4j邻居获取逻辑
        print(f"✅ 模拟从Neo4j获取节点 {node_id} 的邻居")
        return []

    def get_path(self, from_node: str, to_node: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        """获取两个节点之间的路径
        
        Args:
            from_node: 起始节点ID
            to_node: 目标节点ID
            max_depth: 最大路径深度
            
        Returns:
            路径信息列表
        """
        # TODO: 实现Neo4j路径获取逻辑
        print(f"✅ 模拟从Neo4j获取节点 {from_node} 到 {to_node} 的路径")
        return []

    def query(self, query: str, params: Optional[Dict[str, Any]] = None, **kwargs: Any) -> List[Dict[str, Any]]:
        """执行Cypher查询
        
        Args:
            query: Cypher查询语句
            params: 查询参数
            **kwargs: 额外参数
            
        Returns:
            查询结果
        """
        if not self._client:
            logger.info(f"✅ 模拟执行Neo4j查询: {query}")
            return []
            
        try:
            with self._client.session() as session:
                result = session.run(query, params or {})
                records = []
                for record in result:
                    records.append(dict(record))
                logger.info(f"✅ 执行Neo4j查询成功，返回 {len(records)} 条记录")
                return records
        except Exception as e:
            logger.error(f"❌ 执行Neo4j查询失败: {e}")
            return []

    def delete_node(self, node_id: str, **kwargs: Any) -> None:
        """删除节点
        
        Args:
            node_id: 节点ID
            **kwargs: 额外参数
        """
        # TODO: 实现Neo4j节点删除逻辑
        print(f"✅ 模拟从Neo4j删除节点 {node_id}")

    def delete_edge(self, from_node: str, to_node: str, edge_type: str, **kwargs: Any) -> None:
        """删除边
        
        Args:
            from_node: 源节点ID
            to_node: 目标节点ID
            edge_type: 边类型
            **kwargs: 额外参数
        """
        # TODO: 实现Neo4j边删除逻辑
        print(f"✅ 模拟从Neo4j删除边 {from_node} -> {to_node}")

    def clear(self) -> None:
        """清空图数据库"""
        # TODO: 实现Neo4j清空逻辑
        print("✅ 模拟清空Neo4j图数据库")

    @property
    def client(self) -> Any:
        """提供对底层图数据库客户端的访问"""
        return self._client

    def store_graph(self, knowledge_graph, clear_existing: bool = True) -> None:
        """存储知识图谱到Neo4j数据库
        
        Args:
            knowledge_graph: 知识图谱对象
            clear_existing: 是否在存储前清空现有数据
        """
        if not self._client:
            logger.info("✅ 模拟存储知识图谱到Neo4j")
            return
            
        try:
            logger.info(f"🚀 开始存储知识图谱到Neo4j: {len(knowledge_graph.entities)} 个实体, {len(knowledge_graph.relationships)} 个关系")
            
            with self._client.session() as session:
                if clear_existing:
                    logger.info("🧹 清空现有Neo4j数据...")
                    session.run("MATCH (n) DETACH DELETE n")
                    logger.info("✅ 现有数据已清空")
                
                # 存储实体
                logger.info("开始存储实体...")
                entity_count = 0
                for i, entity in enumerate(knowledge_graph.entities.values()):
                    query = """
                    MERGE (e:Entity {id: $id})
                    SET e.name = $name,
                        e.type = $type,
                        e.description = $description,
                        e.confidence = $confidence
                    """
                    params = {
                        'id': entity.id,
                        'name': entity.name,
                        'type': entity.entity_type.value,
                        'description': entity.description or "",
                        'confidence': entity.confidence
                    }
                    
                    logger.debug(f"  插入实体 {i+1}: {entity.name} (ID: {entity.id}, 类型: {entity.entity_type.value})")
                    result = session.run(query, **params)
                    result.consume()  # 确保查询执行完成
                    entity_count += 1
                    
                    if (i + 1) % 5 == 0:
                        logger.info(f"  已存储 {i + 1}/{len(knowledge_graph.entities)} 个实体")
                
                logger.info(f"✅ 实体存储完成，共存储 {entity_count} 个实体")
                
                # 存储关系
                logger.info("🔗 开始存储关系...")
                relationship_count = 0
                for i, relationship in enumerate(knowledge_graph.relationships.values()):
                    # 获取源实体和目标实体名称用于日志
                    source_entity = knowledge_graph.get_entity(relationship.source_entity_id)
                    target_entity = knowledge_graph.get_entity(relationship.target_entity_id)
                    source_name = source_entity.name if source_entity else relationship.source_entity_id
                    target_name = target_entity.name if target_entity else relationship.target_entity_id
                    
                    # 检查关系是否已存在（使用更通用的查询避免警告）
                    relation_label = relationship.relation_type.value.upper().replace(' ', '_')
                    check_query = """
                    MATCH (source:Entity {id: $source_id})-[r]->(target:Entity {id: $target_id})
                    WHERE r.id = $rel_id
                    RETURN count(r) as count
                    """
                    check_result = session.run(check_query, 
                        source_id=relationship.source_entity_id,
                        target_id=relationship.target_entity_id,
                        rel_id=relationship.id
                    )
                    existing_count = check_result.single()["count"]
                    
                    if existing_count > 0:
                        logger.warning(f"⚠️ 关系已存在，跳过: {source_name} -[{relationship.relation_type.value}]-> {target_name} (ID: {relationship.id})")
                        continue
                    
                    # 使用关系类型作为Neo4j关系标签
                    query = f"""
                    MATCH (source:Entity {{id: $source_id}})
                    MATCH (target:Entity {{id: $target_id}})
                    MERGE (source)-[r:{relation_label} {{id: $rel_id}}]->(target)
                    ON CREATE SET
                        r.description = $description,
                        r.confidence = $confidence
                    ON MATCH SET
                        r.description = $description,
                        r.confidence = $confidence
                    """
                    params = {
                        'source_id': relationship.source_entity_id,
                        'target_id': relationship.target_entity_id,
                        'rel_id': relationship.id,
                        'description': relationship.description or "",
                        'confidence': relationship.confidence
                    }
                    
                    logger.debug(f"  插入关系 {i+1}: {source_name} -[{relationship.relation_type.value}]-> {target_name} (ID: {relationship.id})")
                    result = session.run(query, **params)
                    result.consume()  # 确保查询执行完成
                    relationship_count += 1
                    
                    if (i + 1) % 5 == 0:
                        logger.info(f"  已存储 {i + 1}/{len(knowledge_graph.relationships)} 个关系")
                
                logger.info(f"✅ 关系存储完成，共存储 {relationship_count} 个关系")
                
                # 验证数据是否真的插入了
                logger.info("验证数据插入...")
                try:
                    # 查询实体数量
                    entity_result = session.run("MATCH (n:Entity) RETURN count(n) as count")
                    entity_db_count = entity_result.single()["count"]
                    
                    # 查询关系数量
                    rel_result = session.run("MATCH ()-[r]-() RETURN count(r) as count")
                    rel_db_count = rel_result.single()["count"]
                    
                    logger.info(f"数据库验证结果:")
                    logger.info(f"  - 实体数量: {entity_db_count} (预期: {entity_count})")
                    logger.info(f"  - 关系数量: {rel_db_count} (预期: {relationship_count})")
                    
                    if entity_db_count == entity_count and rel_db_count == relationship_count:
                        logger.info("✅ 数据验证成功，所有数据已正确插入")
                    else:
                        logger.warning("⚠️ 数据验证失败，插入的数据数量不匹配")
                        # 深入调试
                        if entity_db_count != entity_count:
                            logger.warning(f"实体数量不匹配。预期: {entity_count}, 实际: {entity_db_count}")
                            # 找出缺失的实体
                            kg_entity_ids = {e.id for e in knowledge_graph.entities.values()}
                            db_entity_ids_result = session.run("MATCH (n:Entity) RETURN n.id as id")
                            db_entity_ids = {record['id'] for record in db_entity_ids_result}
                            missing_ids = kg_entity_ids - db_entity_ids
                            if missing_ids:
                                logger.warning(f"  - 确认缺失的实体ID: {missing_ids}")
                        
                        if rel_db_count != relationship_count:
                            logger.warning(f"关系数量不匹配。预期: {relationship_count}, 实际: {rel_db_count}")
                            # 找出缺失的关系
                            kg_rel_ids = {r.id for r in knowledge_graph.relationships.values()}
                            db_rel_ids_result = session.run("MATCH ()-[r]->() RETURN r.id as id")
                            db_rel_ids = {record['id'] for record in db_rel_ids_result}
                            missing_rel_ids = kg_rel_ids - db_rel_ids
                            if missing_rel_ids:
                                logger.warning(f"  - 确认缺失的关系ID: {missing_rel_ids}")

                    # 显示一些示例数据
                    logger.info("📋 数据库中的示例实体:")
                    sample_entities = session.run("MATCH (n:Entity) RETURN n.name, n.type, n.id LIMIT 5")
                    for record in sample_entities:
                        logger.info(f"  - {record['n.name']} ({record['n.type']}) [ID: {record['n.id']}]")
                        
                    logger.info("📋 数据库中的示例关系:")
                    sample_rels = session.run("""
                        MATCH (a:Entity)-[r]->(b:Entity) 
                        RETURN a.name, type(r) as rel_type, b.name 
                        LIMIT 5
                    """)
                    for record in sample_rels:
                        logger.info(f"  - {record['a.name']} -[{record['rel_type']}]-> {record['b.name']}")
                        
                except Exception as e:
                    logger.error(f"❌ 数据验证失败: {e}")
                
                logger.info("✅ 知识图谱存储到Neo4j成功")
                
        except Exception as e:
            logger.error(f"❌ 存储知识图谱到Neo4j失败: {e}")
            raise

    def execute_query(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """执行自定义Cypher查询
        
        Args:
            query: Cypher查询语句
            parameters: 查询参数
            
        Returns:
            查询结果列表
        """
        if not self._client:
            logger.info(f"✅ 模拟执行查询: {query}")
            return []
            
        try:
            with self._client.session() as session:
                result = session.run(query, parameters or {})
                records = []
                for record in result:
                    records.append(dict(record))
                logger.info(f"✅ 执行查询成功，返回 {len(records)} 条记录")
                return records
        except Exception as e:
            logger.error(f"❌ 执行查询失败: {e}")
            return []

    def close(self) -> None:
        """关闭Neo4j连接"""
        if self._client:
            try:
                self._client.close()
                logger.info("✅ 关闭Neo4j连接成功")
            except Exception as e:
                logger.error(f"❌ 关闭Neo4j连接失败: {e}")
            finally:
                self._client = None