"""
适配器工具类
"""

import re
from typing import List, Set
import logging

logger = logging.getLogger(__name__)


class PageRangeParser:
    """页码范围解析器"""
    
    @staticmethod
    def parse(page_ranges: str) -> List[int]:
        """
        解析页码范围字符串
        
        Args:
            page_ranges: 页码范围字符串，如 "1-5,10,15-20"
            
        Returns:
            页码列表（从1开始）
            
        Raises:
            ValueError: 页码范围格式错误
        """
        if not page_ranges or not page_ranges.strip():
            return []
        
        pages: Set[int] = set()
        
        try:
            # 分割逗号分隔的部分
            parts = [part.strip() for part in page_ranges.split(',')]
            
            for part in parts:
                if not part:
                    continue
                
                if '-' in part:
                    # 处理范围，如 "1-5"
                    start_str, end_str = part.split('-', 1)
                    start = int(start_str.strip())
                    end = int(end_str.strip())
                    
                    if start < 1 or end < 1:
                        raise ValueError(f"页码必须大于0: {part}")
                    
                    if start > end:
                        raise ValueError(f"起始页码不能大于结束页码: {part}")
                    
                    pages.update(range(start, end + 1))
                else:
                    # 处理单个页码
                    page = int(part)
                    if page < 1:
                        raise ValueError(f"页码必须大于0: {page}")
                    pages.add(page)
        
        except ValueError as e:
            if "invalid literal for int()" in str(e):
                raise ValueError(f"页码范围格式错误: {page_ranges}")
            raise
        
        return sorted(list(pages))
    
    @staticmethod
    def validate(page_ranges: str, max_pages: int = None) -> bool:
        """
        验证页码范围是否有效
        
        Args:
            page_ranges: 页码范围字符串
            max_pages: 最大页数（可选）
            
        Returns:
            是否有效
        """
        try:
            pages = PageRangeParser.parse(page_ranges)
            
            if max_pages is not None and pages:
                max_page = max(pages)
                if max_page > max_pages:
                    logger.warning(f"页码 {max_page} 超出文档最大页数 {max_pages}")
                    return False
            
            return True
        except ValueError as e:
            logger.error(f"页码范围验证失败: {e}")
            return False
    
    @staticmethod
    def normalize(page_ranges: str) -> str:
        """
        规范化页码范围字符串
        
        Args:
            page_ranges: 原始页码范围字符串
            
        Returns:
            规范化后的页码范围字符串
        """
        try:
            pages = PageRangeParser.parse(page_ranges)
            if not pages:
                return ""
            
            # 将连续的页码合并为范围
            ranges = []
            start = pages[0]
            end = pages[0]
            
            for i in range(1, len(pages)):
                if pages[i] == end + 1:
                    end = pages[i]
                else:
                    # 添加当前范围
                    if start == end:
                        ranges.append(str(start))
                    else:
                        ranges.append(f"{start}-{end}")
                    
                    start = pages[i]
                    end = pages[i]
            
            # 添加最后一个范围
            if start == end:
                ranges.append(str(start))
            else:
                ranges.append(f"{start}-{end}")
            
            return ",".join(ranges)
        
        except ValueError:
            return page_ranges  # 返回原始字符串


class CoordinateConverter:
    """坐标系转换器"""
    
    @staticmethod
    def poly_to_bbox(poly: List[List[float]], image_width: int, image_height: int) -> List[float]:
        """
        将多边形坐标转换为边界框坐标
        
        Args:
            poly: 多边形坐标 [[x1,y1], [x2,y2], ...]
            image_width: 图像宽度
            image_height: 图像高度
            
        Returns:
            归一化边界框坐标 [x_min, y_min, x_max, y_max] (0-1)
        """
        if not poly:
            return [0.0, 0.0, 0.0, 0.0]
        
        x_coords = [point[0] for point in poly]
        y_coords = [point[1] for point in poly]
        
        x_min = min(x_coords) / image_width
        y_min = min(y_coords) / image_height
        x_max = max(x_coords) / image_width
        y_max = max(y_coords) / image_height
        
        return [x_min, y_min, x_max, y_max]
    
    @staticmethod
    def bbox_to_poly(bbox: List[float], image_width: int, image_height: int) -> List[List[float]]:
        """
        将边界框坐标转换为多边形坐标
        
        Args:
            bbox: 归一化边界框坐标 [x_min, y_min, x_max, y_max] (0-1)
            image_width: 图像宽度
            image_height: 图像高度
            
        Returns:
            多边形坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        """
        x_min, y_min, x_max, y_max = bbox
        
        # 转换为像素坐标
        x1 = x_min * image_width
        y1 = y_min * image_height
        x2 = x_max * image_width
        y2 = y_max * image_height
        
        # 返回矩形的四个顶点
        return [
            [x1, y1],  # 左上
            [x2, y1],  # 右上
            [x2, y2],  # 右下
            [x1, y2]   # 左下
        ]