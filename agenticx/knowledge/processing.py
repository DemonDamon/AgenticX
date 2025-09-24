"""Document processing framework for AgenticX Knowledge Management System

This module provides a unified document processing framework inspired by MinerU's
multi-backend architecture, designed to be lightweight yet extensible.
"""

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Callable
from datetime import datetime

from .base import BaseReader, ReaderError
from .document import Document, DocumentMetadata
from .readers import get_reader

logger = logging.getLogger(__name__)


class ComplexityLevel(Enum):
    """Document complexity levels for backend selection"""
    LOW = "low"           # Simple text files
    MEDIUM = "medium"     # Structured documents (PDF, HTML)
    HIGH = "high"         # Complex layouts requiring VLM analysis
    AUTO = "auto"         # Auto-detect complexity


class ProcessingBackend(Enum):
    """Available processing backends"""
    SIMPLE_TEXT = "simple_text"      # Lightweight text processing
    STRUCTURED = "structured"        # Structured document processing
    VLM_LAYOUT = "vlm_layout"        # VLM-based layout analysis
    AUTO = "auto"                    # Auto-select backend


@dataclass
class ProcessingOptions:
    """Processing options configuration"""
    language: Optional[str] = None           # Document language
    precision_mode: str = "balanced"         # "fast", "balanced", "accurate"
    speed_mode: str = "normal"              # "fast", "normal", "thorough"
    extract_images: bool = False            # Extract embedded images
    extract_tables: bool = True             # Extract table structures
    extract_metadata: bool = True           # Extract document metadata
    preserve_formatting: bool = False       # Preserve original formatting
    ocr_enabled: bool = False              # Enable OCR for scanned documents
    layout_analysis: bool = False          # Enable layout analysis
    formula_recognition: bool = False       # Enable formula recognition


@dataclass
class BackendConfig:
    """Backend-specific configuration"""
    model_path: Optional[str] = None        # Path to model files
    api_key: Optional[str] = None          # API key for cloud services
    endpoint: Optional[str] = None         # Custom endpoint URL
    timeout: int = 300                     # Processing timeout in seconds
    max_retries: int = 3                   # Maximum retry attempts
    batch_size: int = 10                   # Batch processing size
    custom_params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FeatureFlags:
    """Feature flags for processing capabilities"""
    ocr_enabled: bool = False
    layout_analysis_enabled: bool = False
    formula_recognition_enabled: bool = False
    table_extraction_enabled: bool = True
    image_extraction_enabled: bool = False
    metadata_extraction_enabled: bool = True


@dataclass
class ProcessingConfig:
    """Complete processing configuration"""
    backend: ProcessingBackend = ProcessingBackend.AUTO
    complexity: ComplexityLevel = ComplexityLevel.AUTO
    options: ProcessingOptions = field(default_factory=ProcessingOptions)
    backend_config: BackendConfig = field(default_factory=BackendConfig)
    features: FeatureFlags = field(default_factory=FeatureFlags)


@dataclass
class ProcessingMetrics:
    """Processing performance metrics"""
    total_documents: int = 0
    successful_documents: int = 0
    failed_documents: int = 0
    total_processing_time: float = 0.0
    average_processing_time: float = 0.0
    backend_usage: Dict[str, int] = field(default_factory=dict)
    error_counts: Dict[str, int] = field(default_factory=dict)
    
    def update(self, backend: str, processing_time: float, success: bool, error: Optional[str] = None):
        """Update metrics with processing result"""
        self.total_documents += 1
        self.total_processing_time += processing_time
        
        if success:
            self.successful_documents += 1
        else:
            self.failed_documents += 1
            if error:
                self.error_counts[error] = self.error_counts.get(error, 0) + 1
        
        self.backend_usage[backend] = self.backend_usage.get(backend, 0) + 1
        self.average_processing_time = self.total_processing_time / self.total_documents


@dataclass
class ProcessingResult:
    """Result of document processing"""
    success: bool
    documents: List[Document] = field(default_factory=list)
    backend_used: Optional[str] = None
    processing_time: float = 0.0
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def document_count(self) -> int:
        """Number of documents processed"""
        return len(self.documents)


class BaseProcessingBackend(ABC):
    """Abstract base class for processing backends"""
    
    def __init__(self, config: BackendConfig):
        self.config = config
        self.name = self.__class__.__name__
    
    @abstractmethod
    async def process_document(
        self,
        input_path: Union[str, Path],
        options: ProcessingOptions
    ) -> ProcessingResult:
        """Process a document using this backend
        
        Args:
            input_path: Path to input document
            options: Processing options
            
        Returns:
            Processing result
        """
        pass
    
    @abstractmethod
    def supports_complexity(self, complexity: ComplexityLevel) -> bool:
        """Check if backend supports given complexity level
        
        Args:
            complexity: Complexity level to check
            
        Returns:
            True if supported
        """
        pass
    
    @abstractmethod
    def estimate_processing_time(self, input_path: Union[str, Path]) -> float:
        """Estimate processing time for document
        
        Args:
            input_path: Path to input document
            
        Returns:
            Estimated processing time in seconds
        """
        pass


class SimpleTextBackend(BaseProcessingBackend):
    """Simple text processing backend for lightweight documents"""
    
    def __init__(self, config: BackendConfig):
        super().__init__(config)
    
    async def process_document(
        self,
        input_path: Union[str, Path],
        options: ProcessingOptions
    ) -> ProcessingResult:
        """Process document using simple text extraction"""
        start_time = time.time()
        
        try:
            # Use text reader for processing
            reader = get_reader(input_path, "text")
            documents = await reader.read(input_path)
            
            # Apply basic processing options
            for doc in documents:
                if options.extract_metadata:
                    doc.metadata.custom.update({
                        'processed_by': self.name,
                        'processing_options': options.__dict__
                    })
            
            processing_time = time.time() - start_time
            
            return ProcessingResult(
                success=True,
                documents=documents,
                backend_used=self.name,
                processing_time=processing_time
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"SimpleTextBackend failed to process {input_path}: {e}")
            
            return ProcessingResult(
                success=False,
                backend_used=self.name,
                processing_time=processing_time,
                error=str(e)
            )
    
    def supports_complexity(self, complexity: ComplexityLevel) -> bool:
        """Simple backend supports only low complexity documents"""
        return complexity in [ComplexityLevel.LOW, ComplexityLevel.AUTO]
    
    def estimate_processing_time(self, input_path: Union[str, Path]) -> float:
        """Estimate processing time based on file size"""
        try:
            file_size = Path(input_path).stat().st_size
            # Estimate ~1MB per second for text processing
            return max(0.1, file_size / (1024 * 1024))
        except:
            return 1.0  # Default estimate


class StructuredBackend(BaseProcessingBackend):
    """Structured document processing backend for medium complexity documents"""
    
    def __init__(self, config: BackendConfig):
        super().__init__(config)
    
    async def process_document(
        self,
        input_path: Union[str, Path],
        options: ProcessingOptions
    ) -> ProcessingResult:
        """Process document using structured extraction"""
        start_time = time.time()
        
        try:
            # Auto-detect appropriate reader
            reader = get_reader(input_path)
            documents = await reader.read(input_path)
            
            # Apply structured processing
            for doc in documents:
                if options.extract_metadata:
                    doc.metadata.custom.update({
                        'processed_by': self.name,
                        'processing_options': options.__dict__,
                        'structure_analyzed': True
                    })
                
                # Add structure analysis if enabled
                if options.layout_analysis:
                    doc.metadata.custom['layout_analyzed'] = True
            
            processing_time = time.time() - start_time
            
            return ProcessingResult(
                success=True,
                documents=documents,
                backend_used=self.name,
                processing_time=processing_time
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"StructuredBackend failed to process {input_path}: {e}")
            
            return ProcessingResult(
                success=False,
                backend_used=self.name,
                processing_time=processing_time,
                error=str(e)
            )
    
    def supports_complexity(self, complexity: ComplexityLevel) -> bool:
        """Structured backend supports low to medium complexity"""
        return complexity in [ComplexityLevel.LOW, ComplexityLevel.MEDIUM, ComplexityLevel.AUTO]
    
    def estimate_processing_time(self, input_path: Union[str, Path]) -> float:
        """Estimate processing time for structured documents"""
        try:
            file_size = Path(input_path).stat().st_size
            # Estimate ~500KB per second for structured processing
            return max(0.5, file_size / (512 * 1024))
        except:
            return 2.0  # Default estimate


class VLMLayoutBackend(BaseProcessingBackend):
    """VLM-based layout analysis backend for high complexity documents"""
    
    def __init__(self, config: BackendConfig):
        super().__init__(config)
    
    async def process_document(
        self,
        input_path: Union[str, Path],
        options: ProcessingOptions
    ) -> ProcessingResult:
        """Process document using VLM layout analysis"""
        start_time = time.time()
        
        try:
            # For now, fallback to structured processing
            # TODO: Implement actual VLM integration
            logger.warning("VLM backend not fully implemented, falling back to structured processing")
            
            structured_backend = StructuredBackend(self.config)
            result = await structured_backend.process_document(input_path, options)
            
            # Mark as VLM processed
            for doc in result.documents:
                doc.metadata.custom.update({
                    'vlm_processed': True,
                    'layout_analysis_attempted': True
                })
            
            result.backend_used = self.name
            return result
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"VLMLayoutBackend failed to process {input_path}: {e}")
            
            return ProcessingResult(
                success=False,
                backend_used=self.name,
                processing_time=processing_time,
                error=str(e)
            )
    
    def supports_complexity(self, complexity: ComplexityLevel) -> bool:
        """VLM backend supports all complexity levels"""
        return True
    
    def estimate_processing_time(self, input_path: Union[str, Path]) -> float:
        """Estimate processing time for VLM analysis"""
        try:
            file_size = Path(input_path).stat().st_size
            # Estimate ~100KB per second for VLM processing (slower)
            return max(2.0, file_size / (100 * 1024))
        except:
            return 10.0  # Default estimate


class DocumentProcessor:
    """Unified document processor with multi-backend support
    
    Inspired by MinerU's architecture but designed for AgenticX's modular framework.
    Provides intelligent backend selection and performance optimization.
    """
    
    def __init__(self, config: Optional[ProcessingConfig] = None):
        """Initialize DocumentProcessor
        
        Args:
            config: Processing configuration
        """
        self.config = config or ProcessingConfig()
        self.metrics = ProcessingMetrics()
        self._backends: Dict[ProcessingBackend, BaseProcessingBackend] = {}
        self._historical_data: List[ProcessingResult] = []
        
        # Initialize backends
        self._initialize_backends()
        
        logger.info(f"Initialized DocumentProcessor with {len(self._backends)} backends")
    
    def _initialize_backends(self):
        """Initialize available processing backends"""
        backend_config = self.config.backend_config
        
        # Always initialize basic backends
        self._backends[ProcessingBackend.SIMPLE_TEXT] = SimpleTextBackend(backend_config)
        self._backends[ProcessingBackend.STRUCTURED] = StructuredBackend(backend_config)
        
        # Initialize VLM backend if configured
        if self.config.features.layout_analysis_enabled:
            self._backends[ProcessingBackend.VLM_LAYOUT] = VLMLayoutBackend(backend_config)
    
    async def process_document(
        self,
        input_path: Union[str, Path],
        backend: ProcessingBackend = ProcessingBackend.AUTO
    ) -> ProcessingResult:
        """Process a single document
        
        Args:
            input_path: Path to input document
            backend: Processing backend to use
            
        Returns:
            Processing result
        """
        input_path = Path(input_path)
        
        if not input_path.exists():
            return ProcessingResult(
                success=False,
                error=f"File not found: {input_path}"
            )
        
        # Select backend
        selected_backend = self.select_backend(
            str(input_path),
            self._detect_complexity(input_path)
        ) if backend == ProcessingBackend.AUTO else backend
        
        if selected_backend not in self._backends:
            return ProcessingResult(
                success=False,
                error=f"Backend not available: {selected_backend}"
            )
        
        # Process document
        backend_instance = self._backends[selected_backend]
        result = await backend_instance.process_document(input_path, self.config.options)
        
        # Update metrics
        self.metrics.update(
            backend=selected_backend.value,
            processing_time=result.processing_time,
            success=result.success,
            error=result.error
        )
        
        # Store historical data for optimization
        self._historical_data.append(result)
        if len(self._historical_data) > 1000:  # Keep last 1000 results
            self._historical_data = self._historical_data[-1000:]
        
        return result
    
    async def process_document_async(
        self,
        input_path: Union[str, Path]
    ) -> ProcessingResult:
        """Process document asynchronously with optimized backend selection
        
        Args:
            input_path: Path to input document
            
        Returns:
            Processing result
        """
        return await self.process_document(input_path, ProcessingBackend.AUTO)
    
    def select_backend(
        self,
        document_type: str,
        complexity: ComplexityLevel
    ) -> ProcessingBackend:
        """Select optimal backend for document processing
        
        Args:
            document_type: Type/path of document
            complexity: Document complexity level
            
        Returns:
            Selected backend
        """
        # Auto-detect complexity if needed
        if complexity == ComplexityLevel.AUTO:
            complexity = self._detect_complexity(document_type)
        
        # Select backend based on complexity and availability
        if complexity == ComplexityLevel.LOW:
            return ProcessingBackend.SIMPLE_TEXT
        elif complexity == ComplexityLevel.MEDIUM:
            return ProcessingBackend.STRUCTURED
        elif complexity == ComplexityLevel.HIGH:
            if ProcessingBackend.VLM_LAYOUT in self._backends:
                return ProcessingBackend.VLM_LAYOUT
            else:
                return ProcessingBackend.STRUCTURED
        
        # Default fallback
        return ProcessingBackend.STRUCTURED
    
    def optimize_backend_selection(
        self,
        historical_data: Optional[List[ProcessingResult]] = None
    ) -> Dict[str, Any]:
        """Optimize backend selection based on historical performance data
        
        Args:
            historical_data: Historical processing results
            
        Returns:
            Optimization report
        """
        data = historical_data or self._historical_data
        
        if not data:
            return {"message": "No historical data available for optimization"}
        
        # Analyze performance by backend
        backend_performance = {}
        for result in data:
            if result.backend_used:
                if result.backend_used not in backend_performance:
                    backend_performance[result.backend_used] = {
                        'total_time': 0.0,
                        'success_count': 0,
                        'total_count': 0,
                        'avg_time': 0.0,
                        'success_rate': 0.0
                    }
                
                perf = backend_performance[result.backend_used]
                perf['total_time'] += result.processing_time
                perf['total_count'] += 1
                if result.success:
                    perf['success_count'] += 1
        
        # Calculate metrics
        for backend, perf in backend_performance.items():
            perf['avg_time'] = perf['total_time'] / perf['total_count']
            perf['success_rate'] = perf['success_count'] / perf['total_count']
        
        return {
            'backend_performance': backend_performance,
            'total_documents_analyzed': len(data),
            'optimization_suggestions': self._generate_optimization_suggestions(backend_performance)
        }
    
    def configure_processing(self, options: ProcessingOptions) -> ProcessingConfig:
        """Configure processing options
        
        Args:
            options: Processing options to apply
            
        Returns:
            Updated processing configuration
        """
        self.config.options = options
        return self.config
    
    def monitor_processing_performance(self) -> ProcessingMetrics:
        """Get current processing performance metrics
        
        Returns:
            Current processing metrics
        """
        return self.metrics
    
    def _detect_complexity(self, document_path: Union[str, Path]) -> ComplexityLevel:
        """Detect document complexity level
        
        Args:
            document_path: Path to document
            
        Returns:
            Detected complexity level
        """
        path = Path(document_path)
        extension = path.suffix.lower()
        
        # Simple text files
        if extension in ['.txt', '.md', '.log', '.csv']:
            return ComplexityLevel.LOW
        
        # Structured documents
        elif extension in ['.pdf', '.html', '.xml', '.json']:
            return ComplexityLevel.MEDIUM
        
        # Complex documents (would benefit from VLM)
        elif extension in ['.docx', '.pptx', '.xlsx']:
            return ComplexityLevel.HIGH
        
        # Default to medium complexity
        return ComplexityLevel.MEDIUM
    
    def _generate_optimization_suggestions(
        self,
        backend_performance: Dict[str, Dict[str, float]]
    ) -> List[str]:
        """Generate optimization suggestions based on performance data
        
        Args:
            backend_performance: Performance data by backend
            
        Returns:
            List of optimization suggestions
        """
        suggestions = []
        
        # Find best performing backend
        best_backend = None
        best_score = 0.0
        
        for backend, perf in backend_performance.items():
            # Score based on success rate and speed (inverse of avg_time)
            score = perf['success_rate'] * (1.0 / max(perf['avg_time'], 0.1))
            if score > best_score:
                best_score = score
                best_backend = backend
        
        if best_backend:
            suggestions.append(f"Consider using {best_backend} as default backend for better performance")
        
        # Check for backends with low success rates
        for backend, perf in backend_performance.items():
            if perf['success_rate'] < 0.8:
                suggestions.append(f"Backend {backend} has low success rate ({perf['success_rate']:.1%}), consider configuration review")
        
        return suggestions