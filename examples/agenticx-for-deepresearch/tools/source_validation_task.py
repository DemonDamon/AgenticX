"""AgenticX-based source validation task

This module implements SourceValidationTask, responsible for validating the credibility of search result sources,
strictly following the AgenticX framework's Task abstraction.
"""

from typing import List, Dict, Any, Optional
from pydantic import Field
from agenticx.core.task import Task
from agenticx.core.message import Message
from models import SearchResult
import re
from urllib.parse import urlparse


class SourceValidationTask(Task):
    """Source validation task
    
    Based on agenticx.core.Task implementation, responsible for:
    1. Validating the credibility of search result sources
    2. Checking domain authority
    3. Assessing content quality metrics
    4. Identifying potential bias or misleading information
    """
    
    llm_provider: Optional[Any] = Field(default=None, description="LLM provider")
    trusted_domains: Dict[str, List[str]] = Field(default_factory=dict, description="Authoritative domain list")
    suspicious_patterns: List[str] = Field(default_factory=list, description="Suspicious domain patterns")
    
    def __init__(self, description: str, expected_output: str, llm_provider=None, **kwargs):
        # Set default values
        trusted_domains = {
            'academic': ['edu', 'ac.uk', 'ac.cn', 'scholar.google.com', 'researchgate.net', 'arxiv.org'],
            'government': ['gov', 'gov.cn', 'europa.eu', 'un.org'],
            'news': ['bbc.com', 'reuters.com', 'ap.org', 'cnn.com', 'xinhuanet.com'],
            'reference': ['wikipedia.org', 'britannica.com', 'merriam-webster.com']
        }
        
        suspicious_patterns = [
            r'.*\.tk$', r'.*\.ml$', r'.*\.ga$',  # Free domains
            r'.*blog.*', r'.*forum.*',  # Personal blogs and forums
            r'.*fake.*', r'.*spam.*'  # Obvious spam sites
        ]
        
        super().__init__(
            description=description, 
            expected_output=expected_output, 
            llm_provider=llm_provider,
            trusted_domains=trusted_domains,
            suspicious_patterns=suspicious_patterns,
            **kwargs
        )
    
    def _detect_language(self, text: str) -> str:
        """Detect the language of input text"""
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "en"  # Default to English
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # More than 30% Chinese characters
            return "zh"
        else:
            return "en"
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute source validation task"""
        action = kwargs.get("action", "validate_sources")
        
        if action == "validate_sources":
            return await self._validate_search_results(kwargs)
        elif action == "check_domain_authority":
            return await self._check_domain_authority(kwargs)
        elif action == "assess_content_quality":
            return await self._assess_content_quality(kwargs)
        elif action == "detect_bias":
            return await self._detect_bias(kwargs)
        else:
            raise ValueError(f"Unsupported operation: {action}")
    
    async def _validate_search_results(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Validate search result sources"""
        search_results = kwargs.get("search_results", [])
        
        if not search_results:
            return {"validations": [], "summary": "No search results to validate"}
        
        validations = []
        
        for result in search_results:
            validation = await self._validate_single_source(result)
            validations.append(validation)
        
        # Generate validation summary
        summary = self._generate_validation_summary(validations)
        
        return {
            "validations": validations,
            "summary": summary,
            "total_validated": len(validations)
        }
    
    async def _validate_single_source(self, result: SearchResult) -> Dict[str, Any]:
        """Validate a single source"""
        validation = {
            "url": result.url,
            "title": result.title,
            "domain_authority": self._check_domain_authority_score(result.url),
            "content_quality": self._assess_content_quality_score(result),
            "credibility_indicators": self._check_credibility_indicators(result),
            "risk_factors": self._identify_risk_factors(result),
            "overall_score": 0.0,
            "recommendation": ""
        }
        
        # Calculate overall score
        validation["overall_score"] = self._calculate_overall_score(validation)
        
        # Generate recommendation
        validation["recommendation"] = self._generate_recommendation(validation)
        
        return validation
    
    def _check_domain_authority_score(self, url: str) -> Dict[str, Any]:
        """Check domain authority score"""
        try:
            parsed_url = urlparse(url)
            domain = parsed_url.netloc.lower()
            
            authority_info = {
                "domain": domain,
                "category": "unknown",
                "score": 5.0,  # Default medium score
                "reasons": []
            }
            
            # Check if it's an authoritative domain
            for category, domains in self.trusted_domains.items():
                for trusted_domain in domains:
                    if trusted_domain in domain:
                        authority_info["category"] = category
                        authority_info["score"] = 9.0
                        authority_info["reasons"].append(f"Belongs to authoritative domain in {category} category")
                        return authority_info
            
            # Check suspicious patterns
            for pattern in self.suspicious_patterns:
                if re.match(pattern, domain):
                    authority_info["score"] = 2.0
                    authority_info["reasons"].append("Suspicious domain pattern")
                    return authority_info
            
            # Basic domain check
            if domain.endswith('.com') or domain.endswith('.org'):
                authority_info["score"] = 6.0
                authority_info["reasons"].append("Common commercial or organizational domain")
            elif domain.endswith('.net'):
                authority_info["score"] = 5.5
                authority_info["reasons"].append("Network service domain")
            
            return authority_info
            
        except Exception as e:
            return {
                "domain": "Parsing failed",
                "category": "error",
                "score": 1.0,
                "reasons": [f"URL parsing error: {str(e)}"]
            }
    
    def _assess_content_quality_score(self, result: SearchResult) -> Dict[str, Any]:
        """Assess content quality score"""
        content = result.content or result.snippet or ""
        title = result.title or ""
        
        # Detect language for content quality assessment
        detected_language = self._detect_language(content + " " + title)
        
        quality_info = {
            "score": 5.0,
            "factors": [],
            "issues": []
        }
        
        # Content length check
        if len(content) > 500:
            quality_info["score"] += 1.0
            quality_info["factors"].append("Detailed content")
        elif len(content) < 100:
            quality_info["score"] -= 1.0
            quality_info["issues"].append("Content too short")
        
        # Title quality check
        if len(title) > 10 and len(title) < 100:
            quality_info["score"] += 0.5
            quality_info["factors"].append("Appropriate title length")
        
        # Check for numbers and specific information
        if re.search(r'\d+', content):
            quality_info["score"] += 0.5
            quality_info["factors"].append("Contains specific data")
        
        # Check language quality based on detected language
        if detected_language == "zh":
            # Chinese content quality checks
            if content.count('。') > 2:  # Contains multiple sentences
                quality_info["score"] += 0.5
                quality_info["factors"].append("Structured content")
            
            # Check for potential quality issues in Chinese
            if '广告' in content or 'AD' in content.upper():
                quality_info["score"] -= 1.0
                quality_info["issues"].append("May contain ads")
        else:
            # English content quality checks
            if content.count('.') > 2:  # Contains multiple sentences
                quality_info["score"] += 0.5
                quality_info["factors"].append("Structured content")
            
            # Check for potential quality issues in English
            if 'advertisement' in content.lower() or 'ad' in content.lower():
                quality_info["score"] -= 1.0
                quality_info["issues"].append("May contain ads")
        
        # Check for excessive punctuation
        if content.count('!') > 5:
            quality_info["score"] -= 0.5
            quality_info["issues"].append("Excessive exclamation marks")
        
        # Ensure score is within a reasonable range
        quality_info["score"] = max(1.0, min(10.0, quality_info["score"]))
        
        return quality_info
    
    def _check_credibility_indicators(self, result: SearchResult) -> List[str]:
        """Check credibility indicators"""
        indicators = []
        content = (result.content or result.snippet or "").lower()
        
        # Detect language for credibility indicators
        detected_language = self._detect_language(content)
        
        if detected_language == "zh":
            # Chinese credibility indicators
            positive_indicators = [
                ('引用', 'Contains reference information'),
                ('研究', 'Mentions research'),
                ('数据', 'Contains data'),
                ('专家', 'Cites expert opinions'),
                ('报告', 'Based on reports'),
                ('调查', 'Based on surveys')
            ]
        else:
            # English credibility indicators
            positive_indicators = [
                ('citation', 'Contains reference information'),
                ('research', 'Mentions research'),
                ('data', 'Contains data'),
                ('expert', 'Cites expert opinions'),
                ('report', 'Based on reports'),
                ('survey', 'Based on surveys'),
                ('study', 'Based on studies'),
                ('analysis', 'Contains analysis')
            ]
        
        for keyword, indicator in positive_indicators:
            if keyword in content:
                indicators.append(indicator)
        
        return indicators
    
    def _identify_risk_factors(self, result: SearchResult) -> List[str]:
        """Identify risk factors"""
        risk_factors = []
        content = (result.content or result.snippet or "").lower()
        title = (result.title or "").lower()
        
        # Detect language for risk factor identification
        detected_language = self._detect_language(content + " " + title)
        
        if detected_language == "zh":
            # Chinese risk keywords
            risk_keywords = [
                ('点击', 'Clickbait'),
                ('震惊', 'Emotional headline'),
                ('秘密', 'Potentially false information'),
                ('独家', 'Unverified exclusive news'),
                ('爆料', 'Potentially false rumors'),
                ('内幕', 'Potentially unverified information')
            ]
        else:
            # English risk keywords
            risk_keywords = [
                ('click', 'Clickbait'),
                ('shocking', 'Emotional headline'),
                ('secret', 'Potentially false information'),
                ('exclusive', 'Unverified exclusive news'),
                ('breaking', 'Potentially false rumors'),
                ('insider', 'Potentially unverified information'),
                ('amazing', 'Emotional headline'),
                ('incredible', 'Emotional headline')
            ]
        
        for keyword, risk in risk_keywords:
            if keyword in title or keyword in content:
                risk_factors.append(risk)
        
        # Check URL risks
        if 'bit.ly' in result.url or 'tinyurl' in result.url:
            risk_factors.append('Using shortened links')
        
        return risk_factors
    
    def _calculate_overall_score(self, validation: Dict[str, Any]) -> float:
        """Calculate overall score"""
        domain_score = validation["domain_authority"]["score"]
        content_score = validation["content_quality"]["score"]
        
        # Weight allocation
        overall_score = (domain_score * 0.6 + content_score * 0.4)
        
        # Risk factors deduction
        risk_penalty = len(validation["risk_factors"]) * 0.5
        overall_score = max(1.0, overall_score - risk_penalty)
        
        # Credibility indicators bonus
        credibility_bonus = min(len(validation["credibility_indicators"]) * 0.2, 1.0)
        overall_score = min(10.0, overall_score + credibility_bonus)
        
        return round(overall_score, 1)
    
    def _generate_recommendation(self, validation: Dict[str, Any]) -> str:
        """Generate recommendation"""
        score = validation["overall_score"]
        
        if score >= 8.0:
            return "High credibility source, recommend using"
        elif score >= 6.0:
            return "Medium credibility source, recommend cross-verification"
        elif score >= 4.0:
            return "Low credibility source, use with caution"
        else:
            return "Do not recommend this source"
    
    async def _check_domain_authority(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Check domain authority"""
        url = kwargs.get("url", "")
        
        if not url:
            return {"error": "URL parameter missing"}
        
        authority_info = self._check_domain_authority_score(url)
        return authority_info
    
    async def _assess_content_quality(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Assess content quality"""
        content = kwargs.get("content", "")
        title = kwargs.get("title", "")
        
        # Create a temporary SearchResult object
        temp_result = SearchResult(
            title=title,
            url="",
            snippet="",
            content=content
        )
        
        quality_info = self._assess_content_quality_score(temp_result)
        return quality_info
    
    async def _detect_bias(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Detect bias"""
        content = kwargs.get("content", "")
        
        if not content:
            return {"bias_indicators": [], "bias_score": 0}
        
        bias_indicators = []
        content_lower = content.lower()
        
        # Detect language for bias detection
        detected_language = self._detect_language(content)
        
        if detected_language == "zh":
            # Chinese emotional bias detection
            emotional_words = ['愤怒', '震惊', '可怕', '令人发指', '不可思议']
            for word in emotional_words:
                if word in content_lower:
                    bias_indicators.append(f"Emotional word: {word}")
            
            # Chinese absolute expression detection
            absolute_words = ['绝对', '完全', '从来', '永远', '所有']
            for word in absolute_words:
                if word in content_lower:
                    bias_indicators.append(f"Absolute expression: {word}")
        else:
            # English emotional bias detection
            emotional_words = ['angry', 'shocking', 'terrible', 'outrageous', 'incredible']
            for word in emotional_words:
                if word in content_lower:
                    bias_indicators.append(f"Emotional word: {word}")
            
            # English absolute expression detection
            absolute_words = ['absolutely', 'completely', 'never', 'always', 'all']
            for word in absolute_words:
                if word in content_lower:
                    bias_indicators.append(f"Absolute expression: {word}")
        
        bias_score = min(len(bias_indicators), 10)
        
        return {
            "bias_indicators": bias_indicators,
            "bias_score": bias_score,
            "assessment": "High bias" if bias_score > 5 else "Medium bias" if bias_score > 2 else "Low bias"
        }
    
    def _generate_validation_summary(self, validations: List[Dict[str, Any]]) -> str:
        """Generate validation summary"""
        if not validations:
            return "No validation results"
        
        total = len(validations)
        high_credibility = sum(1 for v in validations if v["overall_score"] >= 8.0)
        medium_credibility = sum(1 for v in validations if 6.0 <= v["overall_score"] < 8.0)
        low_credibility = sum(1 for v in validations if v["overall_score"] < 6.0)
        
        return f"Validated {total} sources: {high_credibility} high credibility, {medium_credibility} medium credibility, {low_credibility} low credibility."