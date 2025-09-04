#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Interactive Deep Search Workflow Implementation
"""

import json
import re
import yaml
import os
import time
import logging
from typing import List, Dict, Any, Optional, Union
from pydantic import Field
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from agenticx.core.workflow import Workflow
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool

import sys
import os

# Add parent directory to sys.path to enable importing from sibling directories
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

# Direct imports from specific modules
from agents.query_generator import QueryGeneratorAgent
from agents.research_summarizer import ResearchSummarizerAgent
from tools.google_search import GoogleSearchTool
from tools.bing_search import BingWebSearchTool, MockBingSearchTool
from tools.bochaai_search import BochaaIWebSearchTool
from utils import clean_input_text


class InteractiveDeepSearchWorkflow:
    """
    Interactive Deep Search Workflow
    
    1. Question clarification phase
    2. Thinking process display
    3. Tool invocation and continuous thinking
    4. Professional report generation
    """
    
    def __init__(self, llm_provider: BaseLLMProvider, max_research_loops: int = 5, 
                 organization_id: str = "deepsearch", search_engine: str = "bochaai", 
                 config_path: str = "config.yaml", clarification_mode: str = "one_shot"):
        """
        Initialize interactive deep search workflow
        
        Args:
            llm_provider: LLM provider
            max_research_loops: Maximum research loop count
            organization_id: Organization ID
            search_engine: Search engine type
            config_path: Configuration file path
            clarification_mode: Clarification mode ("one_shot" or "progressive")
        """
        self.llm_provider = llm_provider
        self.max_research_loops = max_research_loops
        self.organization_id = organization_id
        self.config_path = config_path
        self.clarification_mode = clarification_mode
        
        # Initialize monitoring metrics
        self.metrics = {
            "execution_time": 0.0,
            "search_count": 0,
            "loop_count": 0,
            "success_rate": 0.0,
            "token_usage": 0,
            "error_count": 0,
            "clarification_count": 0,
            "thinking_steps": 0
        }
        
        # Setup logging
        self._setup_logging()
        
        # Load configuration file
        self.config = self._load_config()
        
        # Initialize search tool based on selection
        self.search_tool = self._initialize_search_tool(search_engine)
        
        # Initialize agents
        self.query_generator = QueryGeneratorAgent(organization_id=organization_id)
        self.research_summarizer = ResearchSummarizerAgent(organization_id=organization_id)
        
        # Research context
        self.research_context = {
            "original_topic": "",
            "clarified_topic": "",
            "research_focus": [],
            "thinking_process": [],
            "search_results": [],
            "research_summaries": [],
            "generated_queries": [],
            "knowledge_gaps": [],
            "errors": []
        }
    
    def _setup_logging(self):
        """Setup logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('interactive_deepsearch.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration file"""
        if not os.path.exists(self.config_path):
            self.logger.warning(f"Configuration file {self.config_path} does not exist, using default configuration")
            return {}
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
                self.logger.info(f"Successfully loaded configuration file: {self.config_path}")
                return config
        except Exception as e:
            self.logger.error(f"Configuration file loading failed: {e}")
            return {}
    
    def _initialize_search_tool(self, search_engine: str) -> BaseTool:
        """Initialize search tool"""
        try:
            if search_engine == "google":
                return self._create_google_search_tool()
            elif search_engine == "bing":
                return self._create_bing_search_tool()
            elif search_engine == "bochaai":
                return self._create_bochaai_search_tool()
            else:
                return self._create_mock_search_tool()
        except Exception as e:
            self.logger.error(f"Search tool initialization failed: {e}")
            self.logger.info("Falling back to BochaaI search tool")
            return self._create_bochaai_search_tool()
    
    def _create_bochaai_search_tool(self) -> BaseTool:
        """Create BochaaI search tool"""
        try:
            bochaai_config = self.config.get('bochaai_search', {})
            api_key = bochaai_config.get('api_key')
            if api_key and api_key.startswith('${') and api_key.endswith('}'):
                env_var = api_key[2:-1]
                api_key = os.getenv(env_var)
            
            if not api_key:
                api_key = os.getenv("BOCHAAI_API_KEY")
            
            if not api_key:
                raise ValueError("BochaaI API Key not configured")
            
            endpoint = bochaai_config.get('endpoint', 'https://api.bochaai.com/v1/web-search')
            tool = BochaaIWebSearchTool(api_key=api_key, endpoint=endpoint)
            print("✅ BochaaI search engine configured")
            return tool
        except Exception as e:
            print(f"❌ BochaaI search configuration failed: {e}")
            return self._create_mock_search_tool()
    
    def _create_google_search_tool(self) -> BaseTool:
        """Create Google search tool"""
        google_config = self.config.get('google_search', {})
        api_key = google_config.get('api_key')
        if api_key and api_key.startswith('${') and api_key.endswith('}'):
            env_var = api_key[2:-1]
            api_key = os.getenv(env_var)
        
        if not api_key:
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        
        if not api_key:
            raise ValueError("Google API Key not configured")
        
        return GoogleSearchTool(api_key=api_key)
    
    def _create_bing_search_tool(self) -> BaseTool:
        """Create Bing search tool"""
        bing_config = self.config.get('bing_search', {})
        subscription_key = bing_config.get('subscription_key')
        if subscription_key and subscription_key.startswith('${') and subscription_key.endswith('}'):
            env_var = subscription_key[2:-1]
            subscription_key = os.getenv(env_var)
        
        if not subscription_key:
            subscription_key = os.getenv("BING_SUBSCRIPTION_KEY")
        
        if not subscription_key:
            raise ValueError("Bing Subscription Key not configured")
        
        return BingWebSearchTool(subscription_key=subscription_key)
    
    def _create_mock_search_tool(self) -> BaseTool:
        """Create mock search tool"""
        return MockBingSearchTool()
    
    def _safe_json_parse(self, content: str) -> Optional[Dict[str, Any]]:
        """Safely parse JSON content"""
        try:
            # Try direct parsing
            return json.loads(content)
        except json.JSONDecodeError:
            try:
                # Try extracting JSON part
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                return None
            except Exception as e:
                self.logger.error(f"JSON parsing failed: {e}")
                return None
    
    def clarify_research_topic_one_shot_with_context(self, original_topic: str, reflection_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Clarify research topic based on preliminary reflection results - one-shot mode
        
        Args:
            original_topic: Original research topic
            reflection_result: Preliminary reflection results
            
        Returns:
            Clarification results
        """
        print("\n🤔 Based on preliminary search results, providing more precise research directions")
        
        # Clean input text to prevent Unicode encoding errors
        cleaned_topic = clean_input_text(original_topic)
        if not cleaned_topic:
            self.logger.error("Topic clarification failed: topic is empty or contains invalid characters")
            return {
                "analysis": "Cannot analyze empty topic",
                "core_questions": []
            }
        
        # Extract information from reflection results
        key_aspects = reflection_result.get("key_aspects", [])
        potential_interests = reflection_result.get("potential_interests", [])
        suggested_clarifications = reflection_result.get("suggested_clarifications", [])
        
        clarification_prompt = f"""
As a professional research consultant, based on preliminary search analysis, I need to help users clarify their research needs.

User's original question: {cleaned_topic}

Key aspects found in preliminary analysis: {', '.join(key_aspects) if key_aspects else 'None'}
Questions users might be concerned about: {', '.join(potential_interests) if potential_interests else 'None'}
Suggested clarification directions: {', '.join(suggested_clarifications) if suggested_clarifications else 'None'}

Based on this information, please propose 1-3 core clarification questions that should:
1. Directly impact the direction and focus of research
2. Help determine the specific scope and depth of research
3. Clarify users' real needs and application scenarios
4. Combine key aspects found in preliminary analysis

Note:
- Only propose the most critical questions, avoid too many options
- Questions should be specific and clear, easy for users to answer
- Based on user answers, I will directly start targeted research

Please return in JSON format:
{{
  "analysis": "Analysis results based on preliminary search (within 50 characters)",
  "core_questions": [
    "Core clarification question 1",
    "Core clarification question 2",
    "Core clarification question 3"
  ]
}}

Return only JSON, no other explanations.
"""
        
        try:
            response = self.llm_provider.invoke(clarification_prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                self.metrics["clarification_count"] += 1
                return result
            else:
                # If parsing fails, return default structure
                return {
                    "analysis": f"Based on preliminary search, you want to learn about '{original_topic}'",
                    "core_questions": [
                        f"Which specific aspects of {original_topic} would you like to understand?",
                        f"Do you have particular interest in application scenarios of {original_topic}?",
                        f"Do you need technical details or overview information about {original_topic}?"
                    ]
                }
        except Exception as e:
            self.logger.error(f"Question clarification failed: {e}")
            return {
                "analysis": f"Based on preliminary search, you want to learn about '{original_topic}'",
                "core_questions": []
            }
    
    def clarify_research_topic_one_shot(self, original_topic: str) -> Dict[str, Any]:
        """
        Clarify research topic - question clarification phase
        
        Args:
            original_topic: Original research topic
            
        Returns:
            Clarification result
        """
        print("\n🤔 Analyzing your question to provide more precise research direction")
        
        # Clean input text to prevent Unicode encoding errors
        cleaned_topic = clean_input_text(original_topic)
        if not cleaned_topic:
            self.logger.error("Topic clarification failed: Topic is empty or contains invalid characters")
            return {
                "analysis": "Cannot analyze empty topic",
                "core_questions": []
            }
        
        clarification_prompt = f"""
As a professional research consultant, I need to help users clarify their research needs.

User's original question: {cleaned_topic}

Please analyze this question and propose 1-3 core clarification questions that should:
1. Directly affect the direction and focus of research
2. Help determine the specific scope and depth of research
3. Clarify the user's real needs and application scenarios

Note:
- Only propose the most critical questions, avoid too many options
- Questions should be specific and clear, easy for users to answer
- Based on user responses, I will directly start targeted research

Please return in JSON format:
{{
  "analysis": "Brief analysis of the original question (within 50 characters)",
  "core_questions": [
    "Core clarification question 1",
    "Core clarification question 2",
    "Core clarification question 3"
  ]
}}

Return JSON only, no other explanations.
"""
        
        try:
            response = self.llm_provider.invoke(clarification_prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                self.metrics["clarification_count"] += 1
                return result
            else:
                # If parsing fails, return default structure
                return {
                    "analysis": f"You want to learn about '{original_topic}'",
                    "core_questions": [
                        f"What specific aspects of {original_topic} do you want to understand?",
                        f"Do you have particular interest in the application scenarios of {original_topic}?",
                        f"Do you need technical details or overview information about {original_topic}?"
                    ]
                }
        except Exception as e:
            self.logger.error(f"Question clarification failed: {e}")
            return {
                "analysis": f"You want to learn about '{original_topic}'",
                "core_questions": []
            }
    
    def display_clarification_one_shot(self, clarification_result: Dict[str, Any]) -> Dict[str, str]:
        """
        Display all clarification questions at once and get user feedback
        
        Args:
            clarification_result: Clarification result
            
        Returns:
            User's answer dictionary
        """
        print("\n💡 Analysis result:")
        print(f"   {clarification_result.get('analysis', '')}")
        
        questions = clarification_result.get('core_questions', [])
        user_answers = {}
        
        if questions:
            print("\n❓ To provide more precise research, please answer all the following questions at once:")
            print("   (You can answer line by line, each line corresponding to one question, separated by Enter)")
            print("\n" + "="*50)
            
            # Display all questions at once
            for i, question in enumerate(questions, 1):
                print(f"{i}. {question}")
            
            print("="*50)
            print("\nPlease enter your answers in order (one answer per line, press Enter twice to finish):")
            
            answers = []
            empty_line_count = 0
            
            try:
                while len(answers) < len(questions):
                    try:
                        raw_answer = input(f"Answer {len(answers)+1}: ").strip()
                        if raw_answer:
                            cleaned_answer = clean_input_text(raw_answer)
                            answers.append(cleaned_answer if cleaned_answer else "No answer")
                            empty_line_count = 0
                        else:
                            empty_line_count += 1
                            if empty_line_count >= 2 or len(answers) == 0:
                                # If two consecutive empty lines or first line is empty, end input
                                break
                            answers.append("No answer")
                    except (EOFError, KeyboardInterrupt):
                        break
                
                # Map answers to questions
                for i, answer in enumerate(answers):
                    user_answers[f"question_{i+1}"] = answer
                
                # If insufficient answers, fill with default values
                for i in range(len(answers), len(questions)):
                    user_answers[f"question_{i+1}"] = "Comprehensive research"
                    
            except Exception as e:
                print(f"\n[Auto mode] Input exception, will conduct comprehensive research: {e}")
                for i in range(len(questions)):
                    user_answers[f"question_{i+1}"] = "Comprehensive research"
        
        return user_answers
    
    def clarify_research_topic_progressive_with_context(self, original_topic: str, reflection_result: Dict[str, Any]) -> Dict[str, str]:
        """
        Progressive clarification of research topic based on initial reflection results - 3-5 rounds of progressive in-depth dialogue
        
        Args:
            original_topic: Original research topic
            reflection_result: Initial reflection result
            
        Returns:
            User answer dictionary
        """
        print("\n🤔 Based on preliminary search results, will conduct several rounds of dialogue to precisely understand your needs")
        
        # Clean input text to prevent Unicode encoding errors
        cleaned_topic = clean_input_text(original_topic)
        if not cleaned_topic:
            self.logger.error("Topic clarification failed: Topic is empty or contains invalid characters")
            return {}
        
        user_answers = {}
        conversation_history = []
        
        # Extract information from reflection results
        key_aspects = reflection_result.get("key_aspects", [])
        potential_interests = reflection_result.get("potential_interests", [])
        
        # Round 1: Understanding based on key aspects
        print("\n📋 Round 1: Basic understanding")
        print(f"Based on preliminary search, we found that '{cleaned_topic}' involves the following key aspects: {', '.join(key_aspects[:3]) if key_aspects else 'multiple dimensions'}")
        
        first_question = f"Which aspect of {cleaned_topic} do you most want to understand in depth?"
        if key_aspects:
            first_question += f" (e.g., {', '.join(key_aspects[:3])}, etc.)"
        
        print(f"\n❓ {first_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["focus_area"] = cleaned_answer
                conversation_history.append(f"Focus area: {cleaned_answer}")
            else:
                user_answers["focus_area"] = "Comprehensive understanding"
                conversation_history.append("Focus area: Comprehensive understanding")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will conduct comprehensive research")
            user_answers["focus_area"] = "Comprehensive understanding"
            conversation_history.append("Focus area: Comprehensive understanding")
        
        # Round 2: Depth requirements based on potential interests
        print("\n📋 Round 2: Depth requirements")
        focus_area = user_answers.get("focus_area", "Comprehensive understanding")
        
        second_question = f"Regarding {focus_area}, what level of information do you hope to obtain?"
        if potential_interests:
            second_question += f" (We found users typically care about: {', '.join(potential_interests[:2])})"
        
        print(f"\n❓ {second_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["depth_level"] = cleaned_answer
                conversation_history.append(f"Depth level: {cleaned_answer}")
            else:
                user_answers["depth_level"] = "Professional analysis"
                conversation_history.append("Depth level: Professional analysis")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will provide professional analysis")
            user_answers["depth_level"] = "Professional analysis"
            conversation_history.append("Depth level: Professional analysis")
        
        # Round 3: Application scenarios
        print("\n📋 Round 3: Application scenarios")
        
        third_question = f"What is your purpose for understanding {cleaned_topic}? (e.g., academic research, work application, personal interest, decision reference, etc.)"
        print(f"\n❓ {third_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["purpose"] = cleaned_answer
                conversation_history.append(f"Usage purpose: {cleaned_answer}")
            else:
                user_answers["purpose"] = "Comprehensive understanding"
                conversation_history.append("Usage purpose: Comprehensive understanding")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will provide comprehensive understanding")
            user_answers["purpose"] = "Comprehensive understanding"
            conversation_history.append("Usage purpose: Comprehensive understanding")
        
        # Round 4: Specific focus points (optional)
        print("\n📋 Round 4: Specific focus points")
        
        fourth_question = f"Regarding {cleaned_topic}, do you have any specific questions or focus points you want to understand? (Optional, press Enter to skip)"
        print(f"\n❓ {fourth_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["specific_interest"] = cleaned_answer
                conversation_history.append(f"Specific focus: {cleaned_answer}")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Skip specific focus points")
        
        # Round 5: Confirmation and supplementation (optional)
        if len(user_answers) >= 3:
            print("\n📋 Round 5: Confirmation and supplementation")
            print("\n📝 Based on your answers, I understand you hope for:")
            for item in conversation_history:
                print(f"   • {item}")
            
            fifth_question = "Is there anything else that needs to be added or corrected? (Optional, press Enter to continue)"
            print(f"\n❓ {fifth_question}")
            
            try:
                raw_answer = input("   Your answer: ").strip()
                cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
                if cleaned_answer:
                    user_answers["additional_notes"] = cleaned_answer
                    conversation_history.append(f"Additional notes: {cleaned_answer}")
            except (EOFError, KeyboardInterrupt):
                print("\n[Auto mode] No additional notes")
        
        print("\n✅ Clarification complete! Now starting targeted research")
        self.metrics["clarification_count"] += 1
        
        return user_answers
    
    def clarify_research_topic_progressive(self, original_topic: str) -> Dict[str, str]:
        """
        Progressive clarification of research topic - 3-5 rounds of progressive in-depth dialogue
        
        Args:
            original_topic: Original research topic
            
        Returns:
            User answer dictionary
        """
        print("\n🤔 Analyzing your question, will conduct several rounds of dialogue to precisely understand your needs")
        
        # Clean input text to prevent Unicode encoding errors
        cleaned_topic = clean_input_text(original_topic)
        if not cleaned_topic:
            self.logger.error("Topic clarification failed: Topic is empty or contains invalid characters")
            return {}
        
        user_answers = {}
        conversation_history = []
        
        # Round 1: Basic understanding
        print("\n📋 Round 1: Basic understanding")
        print(f"You want to learn about '{cleaned_topic}'.")
        
        first_question = f"First, which aspect of {cleaned_topic} do you want to understand? (e.g., basic concepts, technical details, application scenarios, development trends, etc.)"
        print(f"\n❓ {first_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["focus_area"] = cleaned_answer
                conversation_history.append(f"Focus area: {cleaned_answer}")
            else:
                user_answers["focus_area"] = "Comprehensive understanding"
                conversation_history.append("Focus area: Comprehensive understanding")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will conduct comprehensive research")
            user_answers["focus_area"] = "Comprehensive understanding"
            conversation_history.append("Focus area: Comprehensive understanding")
        
        # Round 2: Depth requirements
        print("\n📋 Round 2: Depth requirements")
        focus_area = user_answers.get("focus_area", "Comprehensive understanding")
        
        second_question = f"Based on your focus on {focus_area}, what level of information do you hope to obtain? (e.g., introductory overview, professional analysis, practical guidance, cutting-edge research, etc.)"
        print(f"\n❓ {second_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["depth_level"] = cleaned_answer
                conversation_history.append(f"Depth level: {cleaned_answer}")
            else:
                user_answers["depth_level"] = "Professional analysis"
                conversation_history.append("Depth level: Professional analysis")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will provide professional analysis")
            user_answers["depth_level"] = "Professional analysis"
            conversation_history.append("Depth level: Professional analysis")
        
        # Round 3: Application scenarios
        print("\n📋 Round 3: Application scenarios")
        
        third_question = f"What is your purpose for understanding {cleaned_topic}? (e.g., academic research, work application, personal interest, decision reference, etc.)"
        print(f"\n❓ {third_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["purpose"] = cleaned_answer
                conversation_history.append(f"Usage purpose: {cleaned_answer}")
            else:
                user_answers["purpose"] = "Comprehensive understanding"
                conversation_history.append("Usage purpose: Comprehensive understanding")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Will provide comprehensive understanding")
            user_answers["purpose"] = "Comprehensive understanding"
            conversation_history.append("Usage purpose: Comprehensive understanding")
        
        # Round 4: Specific focus points (optional)
        print("\n📋 Round 4: Specific focus points")
        
        fourth_question = f"Regarding {cleaned_topic}, do you have any specific questions or focus points you want to understand? (Optional, press Enter to skip)"
        print(f"\n❓ {fourth_question}")
        
        try:
            raw_answer = input("   Your answer: ").strip()
            cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
            if cleaned_answer:
                user_answers["specific_interest"] = cleaned_answer
                conversation_history.append(f"Specific focus: {cleaned_answer}")
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Skip specific focus points")
        
        # Round 5: Confirmation and supplementation (optional)
        if len(user_answers) >= 3:
            print("\n📋 Round 5: Confirmation and supplementation")
            print("\n📝 Based on your answers, I understand you hope for:")
            for item in conversation_history:
                print(f"   • {item}")
            
            fifth_question = "Is there anything else that needs to be added or corrected? (Optional, press Enter to continue)"
            print(f"\n❓ {fifth_question}")
            
            try:
                raw_answer = input("   Your answer: ").strip()
                cleaned_answer = clean_input_text(raw_answer) if raw_answer else ""
                if cleaned_answer:
                    user_answers["additional_notes"] = cleaned_answer
                    conversation_history.append(f"Additional notes: {cleaned_answer}")
            except (EOFError, KeyboardInterrupt):
                print("\n[Auto mode] No additional notes")
        
        print("\n✅ Clarification complete! Now starting targeted research")
        self.metrics["clarification_count"] += 1
        
        return user_answers
    
    def generate_thinking_process(self, topic: str, user_answers: Dict[str, str]) -> str:
        """
        Generate thinking process - thinking display
        
        Args:
            topic: Research topic
            user_answers: User answer dictionary
            
        Returns:
            Thinking process description
        """
        # Clean input text to prevent Unicode encoding errors
        cleaned_topic = clean_input_text(topic)
        if not cleaned_topic:
            self.logger.error("Failed to generate thinking process: Topic is empty or contains invalid characters")
            return "Systematically organizing the core information of the research topic to present you with comprehensive and precise research results."
        
        # Clean Unicode characters in user answers
        cleaned_answers = {}
        if user_answers:
            for k, v in user_answers.items():
                cleaned_v = clean_input_text(v) if v != "未回答" else v
                if cleaned_v:
                    cleaned_answers[k] = cleaned_v
        
        answers_text = "; ".join([f"{k}: {v}" for k, v in cleaned_answers.items() if v != "未回答"]) if cleaned_answers else "Based on the original topic"
        
        # Detect language and generate appropriate prompt
        language = self._detect_language(cleaned_topic)
        
        if language == "zh":
            thinking_prompt = f"""
作为专业的研究分析师，请为以下研究任务生成清晰的思考过程。

研究主题：{cleaned_topic}
用户澄清信息：{answers_text}

请生成简洁而专业的思考过程描述，说明您将如何系统性地研究这个主题。
思考过程应体现：
1. 基于用户澄清的研究策略
2. 信息收集的关键维度
3. 分析的核心方向

请直接返回思考过程的描述，不要使用JSON格式，控制在100-150字以内。
"""
        else:
            thinking_prompt = f"""
As a professional research analyst, please generate a clear thinking process for the following research task.

Research topic: {cleaned_topic}
User clarification information: {answers_text}

Please generate a concise but professional description of the thinking process, explaining how you will systematically research this topic.
The thinking process should reflect:
1. Research strategy based on user clarification
2. Key dimensions of information collection
3. Core directions of analysis

Please return the description of the thinking process directly, not in JSON format, and keep it within 100-150 words.
"""
        
        try:
            response = self.llm_provider.invoke(thinking_prompt)
            self.metrics["thinking_steps"] += 1
            return response.content.strip()
        except Exception as e:
            self.logger.error(f"Failed to generate thinking process: {e}")
            return f"Systematically organizing the core information of {topic}, conducting in-depth analysis based on your needs, and presenting you with comprehensive and precise research results."
    
    def execute_search_with_thinking(self, queries: List[str]) -> List[Dict[str, Any]]:
        """
        Execute search and display thinking process
        
        Args:
            queries: List of search queries
            
        Returns:
            List of search results
        """
        all_results = []
        
        for i, query in enumerate(queries, 1):
            print(f"\n● Searching: {query}")
            
            try:
                # Enable summary parameter to get more detailed content
                search_results = self.search_tool._run(query=query, summary=True, count=10)
                if isinstance(search_results, list):
                    all_results.extend(search_results)
                    print(f"   ✅ Obtained {len(search_results)} results")
                else:
                    print(f"   ⚠️ Abnormal search result format")
                
                # Short thinking process
                if i < len(queries):
                    thinking = self._generate_mini_thinking(query, len(search_results) if isinstance(search_results, list) else 0)
                    if thinking:
                        print(f"   💭 {thinking}")
                        self.research_context["thinking_process"].append(thinking)
                
                self.metrics["search_count"] += 1
                
            except Exception as e:
                self.logger.error(f"Search failed: {e}")
                self.metrics["error_count"] += 1
        
        return all_results
    
    def _generate_mini_thinking(self, query: str, result_count: int) -> str:
        """
        Generate a brief thinking process
        
        Args:
            query: Search query
            result_count: Number of results
            
        Returns:
            Brief thinking description
        """
        if result_count > 0:
            thinking_templates = [
                f"Valuable information obtained by searching '{query}', analyzing key points",
                f"Rich search results for '{query}', extracting core viewpoints",
                f"Important clues found in '{query}', continuing to dig deeper"
            ]
            import random
            return random.choice(thinking_templates)
        else:
            return f"Limited search results for '{query}', need to adjust search strategy"
    
    def execute(self, research_topic: str, interactive: bool = True) -> Dict[str, Any]:
        """
        Execute interactive deep search workflow
        
        Args:
            research_topic: Research topic
            interactive: Whether to enable interactive mode
            
        Returns:
            Research results
        """
        start_time = time.time()
        self.logger.info(f"Starting interactive deep search: {research_topic}")
        
        try:
            # Initialize research context
            self.research_context["original_topic"] = research_topic
            
            # Phase 1: Initial search and reflection
            print("\n" + "="*60)
            print("● Phase 1: Initial search and reflection")
            print("="*60)
            
            # Perform initial search to understand the basic situation of the topic
            print(f"\n● Performing initial search for '{research_topic}'")
            initial_queries = [f"{research_topic} overview", f"{research_topic} basic introduction"]
            initial_search_results = self.execute_search_with_thinking(initial_queries)
            self.research_context["initial_search_results"] = initial_search_results
            
            # Reflect based on initial search results
            reflection_result = self._reflect_on_initial_search(research_topic, initial_search_results)
            self.research_context["initial_reflection"] = reflection_result
            
            print(f"\n💭 Initial reflection: {reflection_result.get('reflection', 'Initial understanding completed')}")
            
            # Phase 2: Clarification based on reflection
            if interactive:
                print("\n" + "="*60)
                print("🎯 Phase 2: Question clarification")
                print("="*60)
                
                if self.clarification_mode == "one_shot":
                    # One-shot clarification mode: propose all key questions based on initial search results
                    clarification_result = self.clarify_research_topic_one_shot_with_context(research_topic, reflection_result)
                    user_answers = self.display_clarification_one_shot(clarification_result)
                elif self.clarification_mode == "progressive":
                    # Progressive clarification mode: 3-5 rounds of progressive in-depth dialogue
                    user_answers = self.clarify_research_topic_progressive_with_context(research_topic, reflection_result)
                else:
                    # Default to one-shot clarification
                    clarification_result = self.clarify_research_topic_one_shot_with_context(research_topic, reflection_result)
                    user_answers = self.display_clarification_one_shot(clarification_result)
                
                self.research_context["research_focus"] = user_answers
                
                # Generate clarified topic
                if user_answers:
                    clarified_topic = f"{research_topic} (Key focus: {', '.join(user_answers.values())})"
                else:
                    clarified_topic = research_topic
                self.research_context["clarified_topic"] = clarified_topic
            else:
                clarified_topic = research_topic
                user_answers = {}
                self.research_context["clarified_topic"] = clarified_topic
                self.research_context["research_focus"] = user_answers
            
            # Phase 3: Display thinking process
            print("\n" + "="*60)
            print("🧠 Phase 3: Research thinking")
            print("="*60)
            
            thinking_process = self.generate_thinking_process(research_topic, user_answers)
            print(f"\n💭 Thinking process: {thinking_process}")
            self.research_context["thinking_process"].append(thinking_process)
            
            # Phase 4: Deep search loop
            print("\n" + "="*60)
            print("● Phase 4: Deep search")
            print("="*60)
            
            # Perform multiple research loops
            for loop_num in range(self.max_research_loops):
                loop_start_time = time.time()
                print(f"\n--- Search round {loop_num + 1} ---")
                
                try:
                    # Generate search queries
                    queries = self._generate_search_queries(clarified_topic, self.research_context)
                    self.research_context["generated_queries"].extend(queries)
                    
                    # Execute search and display thinking
                    search_results = self.execute_search_with_thinking(queries)
                    self.research_context["search_results"].extend(search_results)
                    
                    # Generate summary and analysis
                    summary_result = self._search_and_summarize(queries, search_results, self.research_context)
                    self.research_context["research_summaries"].append(summary_result)
                    
                    # Display findings of the current round
                    if isinstance(summary_result, dict):
                        current_findings = summary_result.get("search_results", [])
                        if current_findings:
                            print(f"\n📋 Key findings of this round:")
                            for finding in current_findings[:3]:  # Only show the first 3
                                print(f"   • {finding}")
                    
                    # Check if research should continue
                    research_complete = False
                    if isinstance(summary_result, dict):
                        research_complete = summary_result.get("research_complete", False)
                    
                    if research_complete:
                        print("\n✅ Research information is sufficient, preparing to generate the final report")
                        break
                    
                    # Identify knowledge gaps
                    knowledge_gaps = []
                    if isinstance(summary_result, dict):
                        knowledge_gaps = summary_result.get("knowledge_gaps", [])
                    
                    if knowledge_gaps:
                        self.research_context["knowledge_gaps"].extend(knowledge_gaps)
                        print(f"\n● Directions for further research found: {', '.join(knowledge_gaps[:2])}")
                    else:
                        print("\n✅ Current research direction is sufficient")
                        break
                    
                    self.metrics["loop_count"] = loop_num + 1
                    
                except Exception as e:
                    self.logger.error(f"Search loop {loop_num + 1} failed: {e}")
                    self.metrics["error_count"] += 1
                    continue
            
            # Phase 5: Generate final report
            print("\n" + "="*60)
            print("📊 Phase 5: Generate research report")
            print("="*60)
            
            print("\n📝 Integrating research results, generating professional report")
            final_report = self._generate_comprehensive_report(self.research_context)
            
            # Save report to file
            if final_report:
                saved_path = self._save_report_to_file(final_report, research_topic, "_interactive")
                if saved_path:
                    self.research_context["saved_report_path"] = saved_path
            
            # Calculate final metrics
            total_time = time.time() - start_time
            self.metrics["execution_time"] = total_time
            self.metrics["success_rate"] = 1.0 - (self.metrics["error_count"] / max(self.metrics["loop_count"], 1))
            
            self.logger.info(f"Interactive deep search completed, total time: {total_time:.2f}s")
            
            return {
                "research_topic": research_topic,
                "clarified_topic": clarified_topic,
                "research_focus": user_answers,
                "final_report": final_report,
                "research_context": self.research_context,
                "total_loops": self.metrics["loop_count"],
                "metrics": self.metrics.copy(),
                "saved_report_path": self.research_context.get("saved_report_path")
            }
            
        except Exception as e:
            self.logger.error(f"Interactive deep search workflow execution failed: {e}")
            self.metrics["error_count"] += 1
            self.metrics["execution_time"] = time.time() - start_time
            raise
    
    def _generate_search_queries(self, topic: str, context: Dict[str, Any]) -> List[str]:
        """Generate search queries"""
        existing_knowledge = context.get("research_summaries", [])
        knowledge_gaps = context.get("knowledge_gaps", [])
        focus_areas = context.get("research_focus", [])
        
        existing_summary_text = ""
        if existing_knowledge:
            summaries = [self._get_summary_content(summary) for summary in existing_knowledge[-2:]]
            existing_summary_text = "\n".join(f"- {summary}" for summary in summaries)
        
        knowledge_gaps_text = ""
        if knowledge_gaps:
            knowledge_gaps_text = "\n".join(f"- {gap}" for gap in knowledge_gaps[-3:])
        
        focus_areas_text = ""
        if focus_areas:
            focus_areas_text = "\n".join(f"- {area}" for area in focus_areas)
        
        detected_language = self._detect_language(topic)
        if detected_language == "zh":
            prompt = f"""
作为专业的搜索策略专家，请根据以下信息生成3-4个高质量的搜索查询。

研究主题：{topic}

关注领域：
{focus_areas_text if focus_areas_text else "无特定关注点"}

已有知识：
{existing_summary_text if existing_summary_text else "无"}

知识空白：
{knowledge_gaps_text if knowledge_gaps_text else "无"}

要求：
1. 查询应高度针对性，覆盖不同视角
2. 优先填补已识别的知识空白
3. 结合用户感兴趣的领域
4. 使用与研究主题相同的语言
5. 查询应简洁且具体

请以JSON格式返回：
{{"queries": ["查询1", "查询2", "查询3"]}}

仅返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As a professional search strategy expert, please generate 3-4 high-quality search queries based on the following information.

Research topic: {topic}

Focus areas:
{focus_areas_text if focus_areas_text else "No specific focus"}

Existing knowledge:
{existing_summary_text if existing_summary_text else "None"}

Knowledge gaps:
{knowledge_gaps_text if knowledge_gaps_text else "None"}

Requirements:
1. Queries should be highly targeted and cover different perspectives
2. Prioritize filling identified knowledge gaps
3. Combine with areas of interest for users
4. Use the same language as the research topic
5. Queries should be concise and specific

Please return in JSON format:
{{"queries": ["Query 1", "Query 2", "Query 3"]}}

Only return JSON, no other explanations.
"""
        
        try:
            response = self.llm_provider.invoke(prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict) and "queries" in result:
                return result["queries"]
        except Exception as e:
            self.logger.error(f"Query generation failed: {e}")
        
        # Fallback queries
        return [f"{topic} detailed introduction", f"{topic} latest developments", f"{topic} application cases"]
    
    def _search_and_summarize(self, queries: List[str], search_results: List[Dict[str, Any]], context: Dict[str, Any]) -> Dict[str, Any]:
        """Search and summarize"""
        search_content = ""
        if search_results:
            search_content = "\n\n".join([
                f"Title: {result.get('title', 'No title')}\nLink: {result.get('link', result.get('url', 'No link'))}\nContent: {result.get('summary') or result.get('snippet', 'No summary')}"
                for result in search_results[-10:]  # Only use the last 10 results
                if isinstance(result, dict)
            ])
        
        existing_summaries = context.get("research_summaries", [])
        existing_summary_text = ""
        if existing_summaries:
            summaries = [self._get_summary_content(summary) for summary in existing_summaries]
            existing_summary_text = "\n\n".join(summaries)
        
        detected_language = self._detect_language(context['clarified_topic'])
        if detected_language == "zh":
            prompt = f"""
作为首席研究分析师，请分析以下搜索结果并提供专业总结。

研究主题：{context['clarified_topic']}

当前搜索结果：
{search_content if search_content else "无搜索结果"}

已有研究结果：
{existing_summary_text if existing_summary_text else "无"}

请提供：
1. 对当前搜索结果的专业总结
2. 提取的关键发现和要点
3. 仍需深入研究的方向
4. 对当前研究完整性的评估

请使用与研究主题相同的语言进行分析。

请以JSON格式返回：
{{
  "summary": "对当前搜索结果的专业总结",
  "search_results": ["关键发现1", "关键发现2", "关键发现3"],
  "knowledge_gaps": ["需进一步研究的方向1", "需进一步研究的方向2"],
  "research_complete": true/false
}}

仅返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As the chief research analyst, please analyze the following search results and provide a professional summary.

Research topic: {context['clarified_topic']}

Current search results:
{search_content if search_content else "No search results"}

Existing research results:
{existing_summary_text if existing_summary_text else "None"}

Please provide:
1. A professional summary of the current search results
2. Key findings and points extracted
3. Directions still needing in-depth research
4. Assessment of the completeness of the current research

Please analyze using the same language as the research topic.

Please return in JSON format:
{{
  "summary": "Professional summary of current search results",
  "search_results": ["Key finding 1", "Key finding 2", "Key finding 3"],
  "knowledge_gaps": ["Direction 1 for further research", "Direction 2 for further research"],
  "research_complete": true/false
}}

Only return JSON, no other explanations.
"""
        
        try:
            response = self.llm_provider.invoke(prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                return {
                    "summary": result.get("summary", "Search results obtained"),
                    "search_results": result.get("search_results", []),
                    "knowledge_gaps": result.get("knowledge_gaps", []),
                    "research_complete": result.get("research_complete", False)
                }
        except Exception as e:
            self.logger.error(f"Search summary failed: {e}")
        
        # Fallback result
        return {
            "summary": f"Completed search analysis for '{context['clarified_topic']}'",
            "search_results": ["Relevant information obtained", "Important data collected", "Key points identified"],
            "knowledge_gaps": [],
            "research_complete": False
        }
    
    def _generate_comprehensive_report(self, context: Dict[str, Any]) -> str:
        """Generate comprehensive research report"""
        research_summaries = context.get("research_summaries", [])
        all_queries = context.get("generated_queries", [])
        focus_areas = context.get("research_focus", [])
        thinking_process = context.get("thinking_process", [])
        all_search_results = context.get("search_results", [])
        
        # Collect citation information and image information
        citations = {}
        citation_counter = 1
        all_images = []
        
        for result in all_search_results:
            if isinstance(result, dict):
                # Process citation information
                if result.get('link'):
                    url = result.get('link')
                    title = result.get('title', 'No title')
                    if url not in citations:
                        citations[url] = {
                            'index': citation_counter,
                            'title': title,
                            'url': url
                        }
                        citation_counter += 1
                
                # Collect image information
                if result.get('images'):
                    all_images.extend(result['images'][:3])  # Each result takes up to 3 images
        
        # Organize findings
        all_findings = []
        for summary in research_summaries:
            if isinstance(summary, dict):
                findings = summary.get("search_results", [])
                all_findings.extend(findings)
        
        summaries_text = ""
        if research_summaries:
            summaries = [self._get_summary_content(summary) for summary in research_summaries]
            summaries_text = "\n\n".join(summaries)
        
        focus_areas_text = "、".join(focus_areas) if focus_areas else "Comprehensive analysis"
        findings_text = "\n".join([f"• {finding}" for finding in all_findings[:10]])  # Max 10 findings
        
        # Build citation list text
        citations_text = ""
        if citations:
            citations_list = sorted(citations.values(), key=lambda x: x['index'])
            citations_text = "\n".join([
                f"[{cite['index']}] {cite['title']} - {cite['url']}"
                for cite in citations_list
            ])
        
        # Add image information to prompt
        images_info = ""
        if all_images:
            images_info = f"\n\nAvailable image resources: {len(all_images)} related images"
        
        detected_language = self._detect_language(context['original_topic'])
        if detected_language == "zh":
            prompt = f"""
作为首席研究分析师，请基于以下深度研究过程生成一份专业、全面的研究报告。

研究主题：{context['original_topic']}
研究重点：{focus_areas_text}

研究过程总结：
{summaries_text if summaries_text else "无详细总结"}

关键发现：
{findings_text if findings_text else "无关键发现"}

可用引用来源：
{citations_text if citations_text else "无引用来源"}{images_info}

请生成一份结构化、详细的专业研究报告，包括：

1. **研究概述** - 简要介绍研究主题和目标
2. **核心发现** - 详细阐述关键发现和重要信息
3. **深度分析** - 对发现进行专业分析和解读
4. **趋势洞察** - 分析发展趋势和未来方向
5. **结论与建议** - 总结要点并提供专业建议

要求：
- 使用与研究主题相同的语言撰写
- 内容必须专业、准确、深入
- 结构化、逻辑清晰
- 避免使用"轮次"等技术术语
- 报告应完整且实用
- 如有图片资源，可在适当位置说明相关图片信息

请直接返回完整的报告内容，不要JSON格式。
"""
        else:
            prompt = f"""
As the chief research analyst, please generate a professional, comprehensive research report based on the following deep research process.

Research topic: {context['original_topic']}
Research focus: {focus_areas_text}

Research process summary:
{summaries_text if summaries_text else "No detailed summary"}

Key findings:
{findings_text if findings_text else "No key findings"}

Available citation sources:
{citations_text if citations_text else "No citation sources"}{images_info}

Please generate a structured, detailed professional research report, including:

1. **Research Overview** - Briefly introduce the research topic and objectives
2. **Core Findings** - Elaborate on key findings and important information
3. **Deep Analysis** - Professional analysis and interpretation of findings
4. **Trend Insights** - Analyze development trends and future directions
5. **Conclusion and Suggestions** - Summarize key points and provide professional suggestions

Requirements:
- Write using the same language as the research topic
- Content must be professional, accurate, and in-depth
- Structured, logical
- Avoid using "rounds" and other technical terms
- The report should be complete and practical
- If image resources are available, you can explain related image information in the appropriate place

Please return the complete report content directly, without JSON format.
"""
        
        try:
            response = self.llm_provider.invoke(prompt)
            return response.content
        except Exception as e:
            self.logger.error(f"Report generation failed: {e}")
            return self._generate_fallback_report(context)
    
    def _generate_fallback_report(self, context: Dict[str, Any]) -> str:
        """Generate fallback report"""
        topic = context.get('original_topic', 'Unknown topic')
        focus_areas = context.get('research_focus', [])
        research_summaries = context.get('research_summaries', [])
        all_search_results = context.get('search_results', [])
        
        focus_text = "、".join(focus_areas) if focus_areas else "multiple dimensions"
        
        # Collect image information
        all_images = []
        for result in all_search_results:
            if isinstance(result, dict) and result.get('images'):
                all_images.extend(result['images'][:3])
        
        # Add image information
        images_section = ""
        if all_images:
            images_section = "\n\n## 🖼️ Related Images\n\n"
            for i, img in enumerate(all_images[:5], 1):  # Max 5 images
                if img.get('url') and img.get('title'):
                    images_section += f"![{img['title']}]({img['url']})\n\n"
                    if img.get('thumbnail'):
                        images_section += f"*Thumbnail: {img['thumbnail']}*\n\n"
        
        detected_language = self._detect_language(topic)
        if detected_language == "zh":
            report = f"""
# {topic} 研究报告

## 研究概述
本次研究聚焦于"{topic}"，重点关注{focus_text}，通过系统性的信息收集和分析，为您提供全面的研究结果。

## 研究过程
本次研究进行了{len(research_summaries)}轮深度搜索和分析，收集了大量相关信息。

## 主要发现
通过深度研究，我们获得了关于{topic}的重要信息和见解。{images_section}
## 结论
{topic}是一个值得深入关注的领域，具有重要的研究价值和应用前景。

---
*注：由于技术限制，此报告为简化版本，建议进一步补充具体研究内容。*
"""
        else:
            report = f"""
# {topic} Research Report

## Research Overview
This research focused on "{topic}", with a focus on {focus_text}, through systematic information collection and analysis, providing you with comprehensive research results.

## Research Process
This research involved {len(research_summaries)} rounds of deep search and analysis, collecting a large amount of relevant information.

## Main Findings
Through deep research, we obtained important information and insights about {topic}.{images_section}
## Conclusion
{topic} is a field worth in-depth attention, with important research value and application prospects.

---
*Note: Due to technical limitations, this report is a simplified version. It is recommended to further supplement specific research content.*
"""
        return report
    
    def _get_summary_content(self, summary: Any) -> str:
        """Safely get summary content"""
        if isinstance(summary, dict):
            return summary.get('summary', str(summary))
        elif isinstance(summary, str):
            return summary
        else:
            return str(summary)
    
    def _reflect_on_initial_search(self, topic: str, search_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Reflect on initial search results"""
        search_content = ""
        if search_results:
            search_content = "\n\n".join([
                f"Title: {result.get('title', 'No title')}\nSummary: {result.get('snippet', 'No summary')}"
                for result in search_results[:5]  # Only use the first 5 results
                if isinstance(result, dict)
            ])
        
        detected_language = self._detect_language(topic)
        if detected_language == "zh":
            prompt = f"""
作为研究专家，请基于以下初步搜索结果分析研究主题。

研究主题：{topic}

初步搜索结果：
{search_content if search_content else "无搜索结果"}

请分析：
1. 该主题的核心概念和关键方面
2. 可能需要深入了解的具体方向
3. 用户可能关心的兴趣领域
4. 建议的澄清问题类型

请以JSON格式返回：
{{
  "reflection": "对主题的整体反思",
  "key_aspects": ["关键方面1", "关键方面2", "关键方面3"],
  "potential_interests": ["用户可能关心的问题1", "用户可能关心的问题2"],
  "suggested_clarifications": ["建议澄清方向1", "建议澄清方向2"]
}}

仅返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As a research expert, please analyze the research topic based on the following initial search results.

Research topic: {topic}

Initial search results:
{search_content if search_content else "No search results"}

Please analyze:
1. The core concepts and key aspects of this topic
2. Specific directions that may need in-depth understanding
3. Areas of interest that users may be concerned about
4. Types of suggested clarification questions

Please return in JSON format:
{{
  "reflection": "Overall reflection on the topic",
  "key_aspects": ["Key aspect 1", "Key aspect 2", "Key aspect 3"],
  "potential_interests": ["Question user might be concerned about 1", "Question user might be concerned about 2"],
  "suggested_clarifications": ["Suggested clarification direction 1", "Suggested clarification direction 2"]
}}

Only return JSON, no other explanations.
"""
        
        try:
            response = self.llm_provider.invoke(prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                return result
        except Exception as e:
            self.logger.error(f"Initial reflection failed: {e}")
        
        # Fallback result
        return {
            "reflection": f"Initial understanding of '{topic}' completed",
            "key_aspects": ["Basic concepts", "Development history", "Application areas"],
            "potential_interests": ["Latest developments", "Practical applications"],
            "suggested_clarifications": ["Specific focus direction", "Depth requirement"]
        }
    
    def _detect_language(self, text: str) -> str:
        """
        Detect the language of the text
        
        Args:
            text: Text to detect language for
            
        Returns:
            Language code ('zh' for Chinese, 'en' for English)
        """
        if not text:
            return "en"
        
        # Count Chinese characters
        chinese_chars = 0
        total_chars = 0
        
        for char in text:
            if char.strip():  # Ignore whitespace
                total_chars += 1
                # Check if character is Chinese (including punctuation)
                if '\u4e00' <= char <= '\u9fff' or '\u3400' <= char <= '\u4dbf' or '\uf900' <= char <= '\ufaff':
                    chinese_chars += 1
        
        if total_chars == 0:
            return "en"
        
        # If more than 30% are Chinese characters, consider it Chinese
        chinese_ratio = chinese_chars / total_chars
        return "zh" if chinese_ratio > 0.3 else "en"
    
    def _save_report_to_file(self, report_content: str, research_topic: str, suffix: str = "") -> Optional[str]:
        """
        Save report to file
        
        Args:
            report_content: Report content
            research_topic: Research topic
            suffix: File name suffix
            
        Returns:
            Saved file path
        """
        try:
            from pathlib import Path
            import re
            import time
            
            # Create output directory
            output_dir = Path("./output")
            output_dir.mkdir(parents=True, exist_ok=True)
            self.logger.info(f"Output directory created/confirmed: {output_dir.absolute()}")
            
            # Generate file name (clean special characters)
            safe_topic = re.sub(r'[<>:"/\\|?*]', '_', research_topic)
            timestamp = time.strftime('%Y%m%d_%H%M%S')
            filename = f"interactive_report_{safe_topic}{suffix}_{timestamp}.md"
            
            # Save file
            file_path = output_dir / filename
            self.logger.info(f"Preparing to save interactive report to: {file_path.absolute()}")
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(report_content)
            
            # Verify if file was saved successfully
            if file_path.exists():
                file_size = file_path.stat().st_size
                print(f"📄 Interactive report successfully saved to: {file_path}")
                print(f"📊 File size: {file_size:,} bytes")
                self.logger.info(f"Interactive report saved successfully: {file_path}, size: {file_size} bytes")
                return str(file_path)
            else:
                error_msg = "File save verification failed, file does not exist"
                print(f"❌ {error_msg}")
                self.logger.error(error_msg)
                return None
            
        except PermissionError as e:
            error_msg = f"Permission error, unable to write file: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None
        except OSError as e:
            error_msg = f"OS error: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None
        except Exception as e:
            error_msg = f"Failed to save interactive report: {type(e).__name__}: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get monitoring metrics"""
        return self.metrics.copy()
    
    def reset_metrics(self):
        """Reset monitoring metrics"""
        self.metrics = {
            "execution_time": 0.0,
            "search_count": 0,
            "loop_count": 0,
            "success_rate": 0.0,
            "token_usage": 0,
            "error_count": 0,
            "clarification_count": 0,
            "thinking_steps": 0
        }
        
        # Reset research context
        self.research_context = {
            "original_topic": "",
            "clarified_topic": "",
            "research_focus": [],
            "thinking_process": [],
            "search_results": [],
            "research_summaries": [],
            "generated_queries": [],
            "knowledge_gaps": [],
            "errors": []
        }