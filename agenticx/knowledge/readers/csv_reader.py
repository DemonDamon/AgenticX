"""CSV file reader for AgenticX Knowledge Management System"""

import asyncio
import csv
import logging
from io import StringIO
from pathlib import Path
from typing import List, Optional, Union, Any, Dict

from ..base import BaseReader
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class CSVReader(BaseReader):
    """Reader for CSV files with tabular data extraction"""
    
    def __init__(
        self,
        delimiter: str = ",",
        quotechar: str = '"',
        encoding: str = "utf-8",
        has_header: Optional[bool] = None,  # Auto-detect if None
        row_handling: str = "separate",  # "separate", "combine", "structured"
        max_rows: Optional[int] = None,
        **kwargs
    ):
        """
        Initialize CSVReader
        
        Args:
            delimiter: Field delimiter character
            quotechar: Quote character for fields
            encoding: File encoding
            has_header: Whether CSV has header row (auto-detect if None)
            row_handling: How to handle rows ("separate", "combine", "structured")
            max_rows: Maximum number of rows to process
            **kwargs: Additional configuration
        """
        super().__init__()
        self.delimiter = delimiter
        self.quotechar = quotechar
        self.encoding = encoding
        self.has_header = has_header
        self.row_handling = row_handling
        self.max_rows = max_rows
        self.config = kwargs
    
    async def read(self, source: Union[str, Path]) -> List[Document]:
        """Read CSV file and return documents
        
        Args:
            source: File path to read
            
        Returns:
            List of documents (based on row_handling strategy)
            
        Raises:
            FileNotFoundError: If file doesn't exist
            csv.Error: If CSV parsing fails
        """
        
        file_path = Path(source)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")
        
        # Read and parse CSV
        try:
            content = await self._read_file_async(file_path)
            rows, headers = await self._parse_csv_content(content)
        except Exception as e:
            logger.error(f"Failed to parse CSV {file_path}: {e}")
            raise
        
        # Process CSV data into documents
        documents = await self._process_csv_data(rows, headers, file_path)
        
        logger.debug(f"Read CSV file: {file_path} -> {len(documents)} documents")
        return documents
    
    async def read_async(self, source: Union[str, Path], **kwargs) -> List[Document]:
        """Asynchronously read CSV file"""
        return await self.read(source)
    
    async def _read_file_async(self, file_path: Path) -> str:
        """Read file content asynchronously"""
        def _read_file():
            with open(file_path, 'r', encoding=self.encoding) as f:
                return f.read()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _read_file)
    
    async def _parse_csv_content(self, content: str) -> tuple[List[List[str]], Optional[List[str]]]:
        """Parse CSV content and return rows and headers"""
        
        # Detect delimiter if not specified
        delimiter = self.delimiter
        if delimiter == "auto":
            sniffer = csv.Sniffer()
            delimiter = sniffer.sniff(content[:1024]).delimiter
        
        # Parse CSV
        reader = csv.reader(
            StringIO(content),
            delimiter=delimiter,
            quotechar=self.quotechar
        )
        
        rows = list(reader)
        
        if not rows:
            return [], None
        
        # Detect header
        headers = None
        data_rows = rows
        
        if self.has_header is None:
            # Auto-detect header
            if len(rows) > 1:
                # Simple heuristic: if first row has different data types than second
                first_row = rows[0]
                second_row = rows[1]
                
                # Check if first row looks like headers (mostly strings, no numbers)
                first_row_numeric = sum(1 for cell in first_row if self._is_numeric(cell))
                second_row_numeric = sum(1 for cell in second_row if self._is_numeric(cell))
                
                if first_row_numeric < second_row_numeric:
                    headers = first_row
                    data_rows = rows[1:]
        
        elif self.has_header:
            headers = rows[0]
            data_rows = rows[1:]
        
        # Limit rows if specified
        if self.max_rows:
            data_rows = data_rows[:self.max_rows]
        
        return data_rows, headers
    
    async def _process_csv_data(
        self,
        rows: List[List[str]],
        headers: Optional[List[str]],
        file_path: Path
    ) -> List[Document]:
        """Process CSV data into documents"""
        
        documents = []
        
        if self.row_handling == "separate":
            # Create separate document for each row
            for i, row in enumerate(rows):
                doc = await self._create_document_from_row(
                    row, headers, file_path, row_index=i
                )
                documents.append(doc)
        
        elif self.row_handling == "combine":
            # Combine all rows into single document
            content = self._format_combined_content(rows, headers)
            metadata = DocumentMetadata(
                name=f"{file_path.stem}_combined",
                source=str(file_path),
                source_type='file',
                content_type='text/csv',
                reader_name=self.__class__.__name__
            )
            metadata.custom.update({
                'csv_rows': len(rows),
                'csv_columns': len(headers) if headers else len(rows[0]) if rows else 0,
                'has_header': headers is not None,
                'processing_mode': 'combined'
            })
            
            doc = Document(content=content, metadata=metadata)
            documents.append(doc)
        
        elif self.row_handling == "structured":
            # Create structured representation
            content = self._format_structured_content(rows, headers)
            metadata = DocumentMetadata(
                name=f"{file_path.stem}_structured",
                source=str(file_path),
                source_type='file',
                content_type='text/csv',
                reader_name=self.__class__.__name__
            )
            metadata.custom.update({
                'csv_rows': len(rows),
                'csv_columns': len(headers) if headers else len(rows[0]) if rows else 0,
                'has_header': headers is not None,
                'processing_mode': 'structured',
                'headers': headers
            })
            
            doc = Document(content=content, metadata=metadata)
            documents.append(doc)
        
        return documents
    
    async def _create_document_from_row(
        self,
        row: List[str],
        headers: Optional[List[str]],
        file_path: Path,
        row_index: int
    ) -> Document:
        """Create document from CSV row"""
        
        # Generate content
        if headers and len(headers) == len(row):
            # Use headers as field names
            content_lines = []
            for header, value in zip(headers, row):
                content_lines.append(f"{header}: {value}")
            content = "\n".join(content_lines)
        else:
            # Use column indices
            content_lines = []
            for i, value in enumerate(row):
                content_lines.append(f"Column {i + 1}: {value}")
            content = "\n".join(content_lines)
        
        # Create metadata
        metadata = DocumentMetadata(
            name=f"{file_path.stem}_row_{row_index + 1:04d}",
            source=str(file_path),
            source_type='file',
            content_type='text/csv',
            reader_name=self.__class__.__name__
        )
        
        # Add CSV-specific metadata
        metadata.custom.update({
            'csv_row_index': row_index,
            'csv_column_count': len(row),
            'has_header': headers is not None,
            'row_data': row,
            'headers': headers
        })
        
        # Analyze row data
        numeric_columns = sum(1 for cell in row if self._is_numeric(cell))
        empty_columns = sum(1 for cell in row if not cell.strip())
        
        metadata.custom.update({
            'numeric_columns': numeric_columns,
            'empty_columns': empty_columns,
            'data_density': (len(row) - empty_columns) / len(row) if row else 0
        })
        
        return Document(content=content, metadata=metadata)
    
    def _format_combined_content(
        self,
        rows: List[List[str]],
        headers: Optional[List[str]]
    ) -> str:
        """Format all rows into combined content"""
        
        lines = []
        
        if headers:
            lines.append("Headers:")
            lines.append(" | ".join(headers))
            lines.append("-" * 50)
            lines.append("")
        
        lines.append(f"Data ({len(rows)} rows):")
        lines.append("")
        
        for i, row in enumerate(rows):
            if headers and len(headers) == len(row):
                row_content = []
                for header, value in zip(headers, row):
                    row_content.append(f"{header}: {value}")
                lines.append(f"Row {i + 1}:")
                lines.append("  " + "\n  ".join(row_content))
            else:
                lines.append(f"Row {i + 1}: {' | '.join(row)}")
            
            lines.append("")
        
        return "\n".join(lines)
    
    def _format_structured_content(
        self,
        rows: List[List[str]],
        headers: Optional[List[str]]
    ) -> str:
        """Format CSV data in structured format"""
        
        lines = []
        
        # Summary
        lines.append(f"CSV Data Summary:")
        lines.append(f"- Rows: {len(rows)}")
        lines.append(f"- Columns: {len(headers) if headers else len(rows[0]) if rows else 0}")
        lines.append(f"- Has Header: {headers is not None}")
        lines.append("")
        
        if headers:
            lines.append("Column Headers:")
            for i, header in enumerate(headers):
                lines.append(f"  {i + 1}. {header}")
            lines.append("")
        
        # Sample data
        sample_size = min(5, len(rows))
        if sample_size > 0:
            lines.append(f"Sample Data (first {sample_size} rows):")
            lines.append("")
            
            for i in range(sample_size):
                row = rows[i]
                lines.append(f"Row {i + 1}:")
                
                if headers and len(headers) == len(row):
                    for header, value in zip(headers, row):
                        lines.append(f"  {header}: {value}")
                else:
                    for j, value in enumerate(row):
                        lines.append(f"  Column {j + 1}: {value}")
                
                lines.append("")
        
        # Data analysis
        if rows:
            lines.append("Data Analysis:")
            
            # Column statistics
            if headers:
                for i, header in enumerate(headers):
                    column_data = [row[i] if i < len(row) else "" for row in rows]
                    numeric_count = sum(1 for cell in column_data if self._is_numeric(cell))
                    empty_count = sum(1 for cell in column_data if not cell.strip())
                    
                    lines.append(f"  {header}:")
                    lines.append(f"    - Numeric values: {numeric_count}/{len(column_data)}")
                    lines.append(f"    - Empty values: {empty_count}/{len(column_data)}")
                    
                    if numeric_count > 0:
                        numeric_values = [float(cell) for cell in column_data if self._is_numeric(cell)]
                        lines.append(f"    - Min: {min(numeric_values)}")
                        lines.append(f"    - Max: {max(numeric_values)}")
                        lines.append(f"    - Avg: {sum(numeric_values) / len(numeric_values):.2f}")
        
        return "\n".join(lines)
    
    def _is_numeric(self, value: str) -> bool:
        """Check if string value is numeric"""
        try:
            float(value.strip())
            return True
        except (ValueError, AttributeError):
            return False
    
    def supports_source(self, source: Union[str, Path]) -> bool:
        """Check if this reader supports the given source"""
        if isinstance(source, (str, Path)):
            file_path = Path(source)
            
            if not file_path.exists() or not file_path.is_file():
                return False
            
            # Check file extension
            return file_path.suffix.lower() in ['.csv', '.tsv']
        
        return False
    
    def get_supported_extensions(self) -> List[str]:
        """Get list of supported file extensions"""
        return ['.csv', '.tsv']
    
    def __str__(self) -> str:
        return f"CSVReader(delimiter='{self.delimiter}', row_handling={self.row_handling})"