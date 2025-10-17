"""
工件注册器 - 统一管理 outputs/ 路径与归档策略
"""

import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging
import json

from .models import ArtifactIndex, ParsedArtifacts, ProcessingStatus, ArtifactType

logger = logging.getLogger(__name__)


class ArtifactRegistry:
    """工件注册器"""
    
    def __init__(self, base_output_dir: Path, config: Optional[Dict[str, Any]] = None):
        """
        初始化工件注册器
        
        Args:
            base_output_dir: 基础输出目录（通常是 outputs/）
            config: 配置字典，包含以下可选项：
                - max_storage_days: 最大存储天数（默认30天）
                - auto_cleanup: 是否自动清理过期文件（默认True）
                - index_file_name: 索引文件名（默认 artifact_index.json）
                - backup_enabled: 是否启用备份（默认False）
                - backup_dir: 备份目录
        """
        self.base_output_dir = Path(base_output_dir)
        self.config = config or {}
        
        # 配置参数
        self.max_storage_days = self.config.get("max_storage_days", 30)
        self.auto_cleanup = self.config.get("auto_cleanup", True)
        self.index_file_name = self.config.get("index_file_name", "artifact_index.json")
        self.backup_enabled = self.config.get("backup_enabled", False)
        self.backup_dir = self.config.get("backup_dir")
        
        # 确保基础目录存在
        self.base_output_dir.mkdir(parents=True, exist_ok=True)
        
        # 全局索引文件
        self.global_index_file = self.base_output_dir / "global_index.json"
        
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    def register(self, artifacts: ParsedArtifacts) -> ArtifactIndex:
        """
        注册解析工件
        
        Args:
            artifacts: 解析后的工件集合
            
        Returns:
            ArtifactIndex: 工件索引
        """
        try:
            # 转换为 ArtifactIndex
            artifact_index = artifacts.to_artifact_index()
            
            # 确保输出目录在基础目录下
            if not artifact_index.output_dir.is_relative_to(self.base_output_dir):
                # 移动到标准位置
                new_output_dir = self.base_output_dir / artifact_index.task_id
                artifact_index = self._move_artifacts(artifact_index, new_output_dir)
            
            # 保存索引文件
            index_file = artifact_index.output_dir / self.index_file_name
            artifact_index.save_index(index_file)
            
            # 更新全局索引
            self._update_global_index(artifact_index)
            
            # 执行自动清理
            if self.auto_cleanup:
                self._cleanup_expired_artifacts()
            
            # 创建备份
            if self.backup_enabled:
                self._create_backup(artifact_index)
            
            self.logger.info(f"工件注册成功: {artifact_index.task_id}")
            return artifact_index
            
        except Exception as e:
            self.logger.error(f"工件注册失败: {e}")
            raise
    
    def get_artifact(self, task_id: str) -> Optional[ArtifactIndex]:
        """
        获取指定任务的工件索引
        
        Args:
            task_id: 任务ID
            
        Returns:
            ArtifactIndex 或 None
        """
        try:
            task_dir = self.base_output_dir / task_id
            index_file = task_dir / self.index_file_name
            
            if index_file.exists():
                return ArtifactIndex.load_index(index_file)
            
            return None
            
        except Exception as e:
            self.logger.error(f"获取工件失败: {e}")
            return None
    
    def list_artifacts(
        self, 
        limit: Optional[int] = None,
        offset: int = 0,
        status_filter: Optional[ProcessingStatus] = None,
        backend_filter: Optional[str] = None
    ) -> List[ArtifactIndex]:
        """
        列出工件索引
        
        Args:
            limit: 限制数量
            offset: 偏移量
            status_filter: 状态过滤器
            backend_filter: 后端类型过滤器
            
        Returns:
            工件索引列表
        """
        try:
            artifacts = []
            
            # 扫描所有任务目录
            for task_dir in self.base_output_dir.iterdir():
                if task_dir.is_dir():
                    index_file = task_dir / self.index_file_name
                    if index_file.exists():
                        try:
                            artifact_index = ArtifactIndex.load_index(index_file)
                            
                            # 应用过滤器
                            if status_filter and artifact_index.processing_status != status_filter:
                                continue
                            if backend_filter and artifact_index.backend_type.value != backend_filter:
                                continue
                            
                            artifacts.append(artifact_index)
                        except Exception as e:
                            self.logger.warning(f"加载索引失败: {index_file} - {e}")
            
            # 按创建时间排序（最新的在前）
            artifacts.sort(key=lambda x: x.created_at or datetime.min, reverse=True)
            
            # 应用分页
            if offset > 0:
                artifacts = artifacts[offset:]
            if limit is not None:
                artifacts = artifacts[:limit]
            
            return artifacts
            
        except Exception as e:
            self.logger.error(f"列出工件失败: {e}")
            return []
    
    def delete_artifact(self, task_id: str, backup: bool = True) -> bool:
        """
        删除指定任务的工件
        
        Args:
            task_id: 任务ID
            backup: 是否在删除前创建备份
            
        Returns:
            是否删除成功
        """
        try:
            task_dir = self.base_output_dir / task_id
            
            if not task_dir.exists():
                self.logger.warning(f"任务目录不存在: {task_id}")
                return False
            
            # 创建备份
            if backup and self.backup_enabled:
                artifact_index = self.get_artifact(task_id)
                if artifact_index:
                    self._create_backup(artifact_index)
            
            # 删除目录
            shutil.rmtree(task_dir)
            
            # 更新全局索引
            self._remove_from_global_index(task_id)
            
            self.logger.info(f"工件删除成功: {task_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"工件删除失败: {e}")
            return False
    
    def get_storage_stats(self) -> Dict[str, Any]:
        """
        获取存储统计信息
        
        Returns:
            存储统计字典
        """
        try:
            stats = {
                "total_artifacts": 0,
                "total_size_bytes": 0,
                "by_status": {},
                "by_backend": {},
                "oldest_artifact": None,
                "newest_artifact": None
            }
            
            artifacts = self.list_artifacts()
            stats["total_artifacts"] = len(artifacts)
            
            for artifact in artifacts:
                # 统计状态
                status = artifact.processing_status.value
                stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
                
                # 统计后端类型
                backend = artifact.backend_type.value
                stats["by_backend"][backend] = stats["by_backend"].get(backend, 0) + 1
                
                # 计算大小
                for artifact_type in ArtifactType:
                    size = artifact.get_file_size(artifact_type)
                    if size:
                        stats["total_size_bytes"] += size
                
                # 更新时间范围
                if artifact.created_at:
                    if stats["oldest_artifact"] is None or artifact.created_at < stats["oldest_artifact"]:
                        stats["oldest_artifact"] = artifact.created_at
                    if stats["newest_artifact"] is None or artifact.created_at > stats["newest_artifact"]:
                        stats["newest_artifact"] = artifact.created_at
            
            return stats
            
        except Exception as e:
            self.logger.error(f"获取存储统计失败: {e}")
            return {}
    
    def _move_artifacts(self, artifact_index: ArtifactIndex, new_output_dir: Path) -> ArtifactIndex:
        """
        移动工件到新目录
        
        Args:
            artifact_index: 原工件索引
            new_output_dir: 新输出目录
            
        Returns:
            更新后的工件索引
        """
        old_output_dir = artifact_index.output_dir
        
        # 创建新目录
        new_output_dir.mkdir(parents=True, exist_ok=True)
        
        # 移动文件并更新路径
        new_artifacts = {}
        for artifact_type, old_path in artifact_index.artifacts.items():
            if old_path and old_path.exists():
                new_path = new_output_dir / old_path.name
                shutil.move(str(old_path), str(new_path))
                new_artifacts[artifact_type] = new_path
            else:
                new_artifacts[artifact_type] = old_path
        
        # 删除旧目录（如果为空）
        try:
            if old_output_dir.exists() and not any(old_output_dir.iterdir()):
                old_output_dir.rmdir()
        except OSError:
            pass  # 目录不为空或其他错误，忽略
        
        # 更新索引
        artifact_index.output_dir = new_output_dir
        artifact_index.artifacts = new_artifacts
        artifact_index.updated_at = datetime.now()
        
        return artifact_index
    
    def _update_global_index(self, artifact_index: ArtifactIndex):
        """更新全局索引"""
        try:
            # 加载现有全局索引
            global_index = {}
            if self.global_index_file.exists():
                with open(self.global_index_file, 'r', encoding='utf-8') as f:
                    global_index = json.load(f)
            
            # 添加或更新条目
            global_index[artifact_index.task_id] = {
                "task_id": artifact_index.task_id,
                "source_file": str(artifact_index.source_file),
                "output_dir": str(artifact_index.output_dir),
                "backend_type": artifact_index.backend_type.value,
                "processing_status": artifact_index.processing_status.value,
                "created_at": artifact_index.created_at.isoformat() if artifact_index.created_at else None,
                "updated_at": artifact_index.updated_at.isoformat() if artifact_index.updated_at else None
            }
            
            # 保存全局索引
            with open(self.global_index_file, 'w', encoding='utf-8') as f:
                json.dump(global_index, f, ensure_ascii=False, indent=2)
                
        except Exception as e:
            self.logger.warning(f"更新全局索引失败: {e}")
    
    def _remove_from_global_index(self, task_id: str):
        """从全局索引中移除条目"""
        try:
            if self.global_index_file.exists():
                with open(self.global_index_file, 'r', encoding='utf-8') as f:
                    global_index = json.load(f)
                
                if task_id in global_index:
                    del global_index[task_id]
                    
                    with open(self.global_index_file, 'w', encoding='utf-8') as f:
                        json.dump(global_index, f, ensure_ascii=False, indent=2)
                        
        except Exception as e:
            self.logger.warning(f"从全局索引移除条目失败: {e}")
    
    def _cleanup_expired_artifacts(self):
        """清理过期工件"""
        try:
            cutoff_date = datetime.now() - timedelta(days=self.max_storage_days)
            
            artifacts = self.list_artifacts()
            for artifact in artifacts:
                if artifact.created_at and artifact.created_at < cutoff_date:
                    self.logger.info(f"清理过期工件: {artifact.task_id}")
                    self.delete_artifact(artifact.task_id, backup=True)
                    
        except Exception as e:
            self.logger.warning(f"清理过期工件失败: {e}")
    
    def _create_backup(self, artifact_index: ArtifactIndex):
        """创建工件备份"""
        if not self.backup_dir:
            return
        
        try:
            backup_dir = Path(self.backup_dir)
            backup_dir.mkdir(parents=True, exist_ok=True)
            
            # 创建备份文件名（包含时间戳）
            timestamp = int(time.time())
            backup_file = backup_dir / f"{artifact_index.task_id}_{timestamp}.tar.gz"
            
            # 创建压缩包
            import tarfile
            with tarfile.open(backup_file, 'w:gz') as tar:
                tar.add(artifact_index.output_dir, arcname=artifact_index.task_id)
            
            self.logger.info(f"备份创建成功: {backup_file}")
            
        except Exception as e:
            self.logger.warning(f"创建备份失败: {e}")