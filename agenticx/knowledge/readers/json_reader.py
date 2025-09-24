"""JSON file reader for AgenticX Knowledge Management System"""

import asyncio
import json
import logging
from pathlib import Path
from typing import List, Optional, Union, Any, Dict

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class JSONReader(BaseReader):
    """Reader for JSON files with structured data extraction"""
    
    def __init__(
        self,
        flatten_nested: bool = True,
        max_depth: int = 10,
        array_handling: str = "separate",  # "separate", "combine", "index"
        **kwargs
    ):
        """
        Initialize JSONReader
        
        Args:
            flatten_nested: Whether to flatten nested objects
            max_depth: Maximum depth for nested object processing
            array_handling: How to handle arrays ("separate", "combine", "index")
            **kwargs: Additional configuration
        """
        super().__init__()
        self.flatten_nested = flatten_nested
        self.max_depth = max_depth
        self.array_handling = array_handling
        self.config = kwargs
    
    async def read(self, source: Union[str, Path]) -> List[Document]:
        """Read JSON file and return documents
        
        Args:
            source: File path to read
            
        Returns:
            List of documents (one per JSON object or array item)
            
        Raises:
            FileNotFoundError: If file doesn't exist
            json.JSONDecodeError: If JSON is invalid
        """
        
        file_path = Path(source)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")
        
        # Read and parse JSON
        try:
            content = await self._read_file_async(file_path)
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in {file_path}: {e}")
            raise
        
        # Process JSON data into documents
        documents = await self._process_json_data(data, file_path)
        
        logger.debug(f"Read JSON file: {file_path} -> {len(documents)} documents")
        return documents
    
    async def read_async(self, source: Union[str, Path], **kwargs) -> List[Document]:
        """Asynchronously read JSON file"""
        return await self.read(source)
    
    async def _read_file_async(self, file_path: Path) -> str:
        """Read file content asynchronously"""
        def _read_file():
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _read_file)
    
    async def _process_json_data(self, data: Any, file_path: Path) -> List[Document]:
        """Process JSON data into documents"""
        documents = []
        
        if isinstance(data, dict):
            # Single JSON object
            doc = await self._create_document_from_object(data, file_path)
            documents.append(doc)
            
        elif isinstance(data, list):
            # JSON array
            if self.array_handling == "separate":
                # Create separate document for each array item
                for i, item in enumerate(data):
                    doc = await self._create_document_from_object(
                        item, file_path, array_index=i
                    )
                    documents.append(doc)
            
            elif self.array_handling == "combine":
                # Combine all array items into single document
                combined_content = self._format_array_content(data)
                metadata = DocumentMetadata(
                    name=f"{file_path.stem}_combined",
                    source=str(file_path),
                    source_type='file',
                    content_type='application/json',
                    reader_name=self.__class__.__name__
                )
                metadata.custom.update({
                    'json_type': 'array',
                    'array_length': len(data),
                    'processing_mode': 'combined'
                })
                
                doc = Document(content=combined_content, metadata=metadata)
                documents.append(doc)
            
            elif self.array_handling == "index":
                # Create indexed documents
                for i, item in enumerate(data):
                    doc = await self._create_document_from_object(
                        item, file_path, array_index=i, use_index_in_name=True
                    )
                    documents.append(doc)
        
        else:
            # Primitive value
            content = json.dumps(data, indent=2, ensure_ascii=False)
            metadata = DocumentMetadata(
                name=file_path.stem,
                source=str(file_path),
                source_type='file',
                content_type='application/json',
                reader_name=self.__class__.__name__
            )
            metadata.custom.update({
                'json_type': type(data).__name__,
                'is_primitive': True
            })
            
            doc = Document(content=content, metadata=metadata)
            documents.append(doc)
        
        return documents
    
    async def _create_document_from_object(
        self,
        obj: Any,
        file_path: Path,
        array_index: Optional[int] = None,
        use_index_in_name: bool = False
    ) -> Document:
        """Create document from JSON object"""
        
        # Generate content
        if isinstance(obj, dict):
            if self.flatten_nested:
                content = self._flatten_object(obj)
            else:
                content = json.dumps(obj, indent=2, ensure_ascii=False)
        else:
            content = json.dumps(obj, indent=2, ensure_ascii=False)
        
        # Create metadata
        name = file_path.stem
        if array_index is not None:
            if use_index_in_name:
                name = f"{name}_{array_index:04d}"
            else:
                name = f"{name}_item_{array_index}"
        
        metadata = DocumentMetadata(
            name=name,
            source=str(file_path),
            source_type='file',
            content_type='application/json',
            reader_name=self.__class__.__name__
        )
        
        # Add JSON-specific metadata
        metadata.custom.update({
            'json_type': type(obj).__name__,
            'array_index': array_index,
            'flattened': self.flatten_nested if isinstance(obj, dict) else False
        })
        
        if isinstance(obj, dict):
            metadata.custom.update({
                'key_count': len(obj),
                'keys': list(obj.keys())[:20],  # First 20 keys
                'nested_levels': self._count_nested_levels(obj)
            })
        elif isinstance(obj, list):
            metadata.custom.update({
                'array_length': len(obj),
                'item_types': list(set(type(item).__name__ for item in obj[:100]))
            })
        
        return Document(content=content, metadata=metadata)
    
    def _flatten_object(self, obj: Dict[str, Any], prefix: str = "", depth: int = 0) -> str:
        """Flatten nested JSON object into readable text"""
        if depth > self.max_depth:
            return f"{prefix}: [Max depth reached]"
        
        lines = []
        
        for key, value in obj.items():
            current_key = f"{prefix}.{key}" if prefix else key
            
            if isinstance(value, dict):
                lines.append(f"{current_key}:")
                nested_content = self._flatten_object(value, current_key, depth + 1)
                lines.append(nested_content)
            
            elif isinstance(value, list):
                lines.append(f"{current_key}: [Array with {len(value)} items]")
                for i, item in enumerate(value[:5]):  # Show first 5 items
                    if isinstance(item, dict):
                        item_content = self._flatten_object(item, f"{current_key}[{i}]", depth + 1)
                        lines.append(item_content)
                    else:
                        lines.append(f"{current_key}[{i}]: {item}")
                
                if len(value) > 5:
                    lines.append(f"{current_key}: ... and {len(value) - 5} more items")
            
            else:
                lines.append(f"{current_key}: {value}")
        
        return "\n".join(lines)
    
    def _format_array_content(self, data: List[Any]) -> str:
        """Format array content for combined document"""
        lines = [f"JSON Array with {len(data)} items:", ""]
        
        for i, item in enumerate(data):
            lines.append(f"Item {i + 1}:")
            if isinstance(item, dict):
                if self.flatten_nested:
                    lines.append(self._flatten_object(item))
                else:
                    lines.append(json.dumps(item, indent=2, ensure_ascii=False))
            else:
                lines.append(str(item))
            lines.append("")  # Empty line between items
        
        return "\n".join(lines)
    
    def _count_nested_levels(self, obj: Any, current_level: int = 0) -> int:
        """Count maximum nesting levels in object"""
        if not isinstance(obj, (dict, list)):
            return current_level
        
        max_level = current_level
        
        if isinstance(obj, dict):
            for value in obj.values():
                level = self._count_nested_levels(value, current_level + 1)
                max_level = max(max_level, level)
        
        elif isinstance(obj, list):
            for item in obj:
                level = self._count_nested_levels(item, current_level + 1)
                max_level = max(max_level, level)
        
        return max_level
    
    def supports_source(self, source: Union[str, Path]) -> bool:
        """Check if this reader supports the given source"""
        if isinstance(source, (str, Path)):
            file_path = Path(source)
            
            if not file_path.exists() or not file_path.is_file():
                return False
            
            # Check file extension
            return file_path.suffix.lower() == '.json'
        
        return False
    
    def get_supported_extensions(self) -> List[str]:
        """Get list of supported file extensions"""
        return ['.json']
    
    def __str__(self) -> str:
        return f"JSONReader(flatten={self.flatten_nested}, array_handling={self.array_handling})"