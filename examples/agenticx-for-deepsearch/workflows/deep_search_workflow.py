"""
Deep Search Workflow Implementation
Implements the core workflow for multi-round reflective research
"""

import json
import re
import yaml
import os
import time
import logging
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
from pydantic import Field
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from agenticx.core.workflow import Workflow
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool
from agenticx.observability.monitoring import MonitoringCallbackHandler
from agenticx.observability.logging import LoggingCallbackHandler

from agents import QueryGeneratorAgent, ResearchSummarizerAgent
from tools import GoogleSearchTool, BingWebSearchTool, MockBingSearchTool, BochaaIWebSearchTool


class DeepSearchWorkflow:
    """
    Deep Search Workflow
    
    Implements the loop: "generate query -> search -> summarize and reflect -> identify knowledge gaps -> generate new query"
    """
    
    def __init__(self, llm_provider: BaseLLMProvider, max_research_loops: int = 3, 
                 organization_id: str = "deepsearch", search_engine: str = "mock", 
                 config_path: str = "config.yaml"):
        """
        Initialize deep search workflow
        
        Args:
            llm_provider: LLM provider
            max_research_loops: Maximum number of research loops
            organization_id: Organization ID
            search_engine: Search engine type ("google", "bing", "mock")
            config_path: Configuration file path
        """
        self.llm_provider = llm_provider
        self.max_research_loops = max_research_loops
        self.organization_id = organization_id
        self.config_path = config_path
        
        # Initialize monitoring metrics
        self.metrics = {
            "execution_time": 0.0,
            "search_count": 0,
            "loop_count": 0,
            "success_rate": 0.0,
            "token_usage": 0,
            "error_count": 0
        }
        
        # Initialize monitoring handlers
        self.monitoring_handler = MonitoringCallbackHandler()
        self.logging_handler = LoggingCallbackHandler()
        
        # Set up logging
        self._setup_logging()
        
        # Load configuration file
        self.config = self._load_config()
        
        # According to selection initialize search tool (supports dynamic configuration)
        self.search_tool = self._initialize_search_tool(search_engine)
        
        # Initialize agents
        self.query_generator = QueryGeneratorAgent(
            name="QueryGenerator",
            role="Query Generation Expert",
            goal="Generate high-quality search queries to support deep research",
            organization_id=organization_id,
            llm_provider=llm_provider
        )
        self.research_summarizer = ResearchSummarizerAgent(
            organization_id=organization_id
        )
    
    def _setup_logging(self):
        """Set up logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('deepsearch.log'),
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
            self.logger.error(f"Failed to load configuration file: {e}")
            return {}
    
    def _initialize_search_tool(self, search_engine: str) -> BaseTool:
        """
        Dynamically initialize search tool, supports reading parameters from configuration file
        
        Args:
            search_engine: Search engine type
            
        Returns:
            BaseTool: Initialized search tool
        """
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
            self.logger.info("Fallback to mock search tool")
            return self._create_mock_search_tool()
    
    def _create_google_search_tool(self) -> BaseTool:
        """Create Google search tool"""
        try:
            # From configuration file read Google search configuration
            google_config = self.config.get('google_search', {})
            
            # Prioritize using parameters from configuration file, then environment variable
            api_key = google_config.get('api_key')
            if api_key and api_key.startswith('${') and api_key.endswith('}'):
                # Handle environment variable reference format, e.g. ${GOOGLE_API_KEY}
                env_var = api_key[2:-1]  # Remove ${ and }
                api_key = os.getenv(env_var)
            
            # If configuration file does not contain, try environment variable
            if not api_key:
                api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            
            if not api_key:
                raise ValueError("Google API Key not configured")
            
            tool_config = self._get_tool_config("google_search_tool")
            return GoogleSearchTool(api_key=api_key, config=tool_config)
            
        except Exception as e:
            self.logger.error(f"Google search tool creation failed: {e}")
            raise
    
    def _create_bing_search_tool(self) -> BaseTool:
        """Create Bing search tool"""
        try:
            # From configuration file read Bing search configuration
            bing_config = self.config.get('bing_search', {})
            
            # Prioritize using parameters from configuration file, then environment variable
            subscription_key = bing_config.get('subscription_key')
            if subscription_key and subscription_key.startswith('${') and subscription_key.endswith('}'):
                env_var = subscription_key[2:-1]
                subscription_key = os.getenv(env_var)
            
            if not subscription_key:
                subscription_key = os.getenv("BING_SUBSCRIPTION_KEY") or os.getenv("AZURE_SUBSCRIPTION_KEY")
            
            if not subscription_key:
                raise ValueError("Bing Subscription Key not configured")
            
            # From configuration file read other parameters
            endpoint = bing_config.get('endpoint', 'https://api.bing.microsoft.com/v7.0/search')
            market = bing_config.get('market', 'zh-CN')
            safe_search = bing_config.get('safe_search', 'Moderate')
            count = bing_config.get('count', 10)
            
            # Create tool instance (here need modify BingWebSearchTool support configuration parameters)
            tool = BingWebSearchTool(
                subscription_key=subscription_key,
                endpoint=endpoint,
                market=market,
                safe_search=safe_search,
                count=count
            )
            print("✅ Bing search engine configured")
            print(f"   Endpoint: {endpoint}")
            print(f"   Market: {market}")
            print(f"   Safe Search: {safe_search}")
            print(f"   Count: {count}")
            return tool
        except Exception as e:
            print(f"❌ Bing search configuration failed: {e}")
            print("🔄 Falling back to mock search mode")
            return self._create_mock_search_tool()
    
    def _create_bochaai_search_tool(self) -> BaseTool:
        """Create BochaAI search tool"""
        try:
            # From configuration file read BochaAI search configuration
            bochaai_config = self.config.get('bochaai_search', {})
            
            # Prioritize using parameters from configuration file, then environment variable
            api_key = bochaai_config.get('api_key')
            if api_key and api_key.startswith('${') and api_key.endswith('}'):
                env_var = api_key[2:-1]
                api_key = os.getenv(env_var)
            
            if not api_key:
                api_key = os.getenv("BOCHAAI_API_KEY")
            
            if not api_key:
                raise ValueError("BochaaI API Key not configured")
            
            # From configuration file read other parameters
            endpoint = bochaai_config.get('endpoint', 'https://api.bochaai.com/v1/web-search')
            count = bochaai_config.get('count', 10)
            market = bochaai_config.get('market', 'zh-CN')
            
            # Create tool instance
            tool = BochaaIWebSearchTool(
                api_key=api_key,
                endpoint=endpoint
            )
            print("✅ BochaaI search engine configured")
            print(f"   Endpoint: {endpoint}")
            print(f"   Market: {market}")
            print(f"   Count: {count}")
            return tool
        except Exception as e:
            print(f"❌ BochaaI search configuration failed: {e}")
            print("🔄 Falling back to mock search mode")
            return self._create_mock_search_tool()
    
    def _create_mock_search_tool(self) -> BaseTool:
        """Create mock search tool"""
        tool = MockBingSearchTool()
        print("✅ Mock search engine configured")
        return tool
    
    def _get_tool_config(self, tool_name: str) -> Dict[str, Any]:
        """
        Get configuration for specified tool from configuration file
        
        Args:
            tool_name: 工具名称
            
        Returns:
            Dict[str, Any]: 工具配置
        """
        tools_config = self.config.get('tools', [])
        for tool_config in tools_config:
            if tool_config.get('name') == tool_name:
                return tool_config.get('config', {})
        return {}
    
    def _clean_json_response(self, response_content: str) -> str:
        """
        Clean JSON content from LLM response, remove markdown format markers
        
        Args:
            response_content: The original response content from the LLM
            
        Returns:
            The cleaned JSON string
        """
        # Remove markdown 的 ```json 和 ``` 标记
        content = response_content.strip()
        
        # Match ```json...``` format
        json_match = re.search(r'```json\s*\n?(.*?)\n?```', content, re.DOTALL)
        if json_match:
            return json_match.group(1).strip()
        
        # Match ```...``` format (without json tag)
        code_match = re.search(r'```\s*\n?(.*?)\n?```', content, re.DOTALL)
        if code_match:
            return code_match.group(1).strip()
        
        # If no code block is found, return the original content
        return content
    
    def _safe_json_parse(self, content: str) -> Optional[Dict[str, Any]]:
        """
        Safely parse JSON content
        
        Args:
            content: JSON string to be parsed
            
        Returns:
            Parsed dictionary, or None if parsing fails
        """
        try:
            # Clean the content first
            clean_content = self._clean_json_response(content)
            
            # Try to parse JSON
            return json.loads(clean_content)
            
        except json.JSONDecodeError as e:
            print(f"⚠️  JSON parsing failed: {e}")
            print(f"⚠️  Original content: {content[:200]}...")
            print(f"⚠️  Cleaned content: {clean_content[:200]}...")
            return None
        except Exception as e:
            print(f"⚠️  JSON parsing exception: {e}")
            return None
    
    def _get_summary_content(self, summary: Any) -> str:
        """
        Safely get summary content
        
        Args:
            summary: The summary object, which may be a string or a dictionary
            
        Returns:
            The summary content as a string
        """
        if isinstance(summary, dict):
            return summary.get('summary', str(summary))
        elif isinstance(summary, str):
            return summary
        else:
            return str(summary)
    
    def execute(self, research_topic: str) -> Dict[str, Any]:
        """
        Execute deep search workflow
        
        Args:
            research_topic: The research topic
            
        Returns:
            Research results
        """
        start_time = time.time()
        self.logger.info(f"Starting deep search: {research_topic}")
        
        try:
            # Store all information during research process
            research_context = {
                "topic": research_topic,
                "search_results": [],
                "research_summaries": [],
                "generated_queries": [],
                "knowledge_gaps": [],
                "errors": []
            }
            
            # Execute multiple research loops
            for loop_num in range(self.max_research_loops):
                loop_start_time = time.time()
                self.logger.info(f"Starting research loop {loop_num + 1}/{self.max_research_loops}")
                
                try:
                    # Step 1: Generate search queries
                    self.logger.info("Generating search queries")
                    queries = self._generate_search_queries(research_topic, research_context)
                    research_context["generated_queries"].extend(queries)
                    self.metrics["search_count"] += len(queries)
                    
                    # Step 2: Execute search and summarization
                    self.logger.info("Executing search and summarization")
                    summary_result = self._search_and_summarize(queries, research_context)
                    research_context["research_summaries"].append(summary_result)
                    
                    # Step 3: Check if research should continue
                    research_complete = False
                    if isinstance(summary_result, dict):
                        research_complete = summary_result.get("research_complete", False)
                    
                    if research_complete:
                        self.logger.info("Research complete, information is sufficient")
                        break
                    
                    # Step 4: Identify knowledge gaps
                    knowledge_gaps = []
                    if isinstance(summary_result, dict):
                        knowledge_gaps = summary_result.get("knowledge_gaps", [])
                    
                    if knowledge_gaps:
                        research_context["knowledge_gaps"].extend(knowledge_gaps)
                        self.logger.info(f"Identified knowledge gaps: {', '.join(knowledge_gaps)}")
                    else:
                        self.logger.info("No significant knowledge gaps identified, preparing to generate final report")
                        break
                    
                    # Update loop metrics
                    self.metrics["loop_count"] = loop_num + 1
                    loop_time = time.time() - loop_start_time
                    self.logger.info(f"Loop {loop_num + 1} completed, time taken: {loop_time:.2f} seconds")
                    
                except Exception as e:
                    self.logger.error(f"Research loop {loop_num + 1} execution failed: {e}")
                    self.metrics["error_count"] += 1
                    research_context["errors"].append({
                        "loop": loop_num + 1,
                        "error": str(e),
                        "timestamp": time.time()
                    })
                    # Continue to next loop, don't interrupt entire process
            
            # First generate simplified report for immediate viewing
            self.logger.info("Generating preliminary research report")
            quick_report = self._create_fallback_report(research_context)
            quick_output_path = self._save_report_to_file(quick_report, research_topic, suffix="_quick")
            
            print(f"\n📄 Preliminary report generated: {quick_output_path}")
            print("🔄 Generating detailed report in background, you can continue using terminal for other commands")
            print("📋 Detailed report will be automatically saved and notified when completed\n")
            
            # Asynchronously generate detailed report
            def generate_detailed_report():
                try:
                    detailed_report = self._generate_final_report(research_context)
                    if detailed_report:
                        detailed_output_path = self._save_report_to_file(detailed_report, research_topic, suffix="_detailed")
                        if detailed_output_path:
                            print(f"\n✅ Detailed report generation completed! Saved to: {detailed_output_path}")
                            return detailed_output_path
                        else:
                            print(f"\n⚠️  Detailed report save failed")
                            print(f"📄 Please check preliminary report: {quick_output_path}")
                            return quick_output_path
                    else:
                        print(f"\n⚠️  Detailed report generation failed: report content is empty")
                        print(f"📄 Please check preliminary report: {quick_output_path}")
                        return quick_output_path
                except Exception as e:
                    print(f"\n⚠️  Detailed report generation failed: {type(e).__name__}: {e}")
                    print(f"📄 Please check preliminary report: {quick_output_path}")
                    return quick_output_path
            
            # Start background thread to generate detailed report
            report_thread = threading.Thread(target=generate_detailed_report, daemon=True)
            report_thread.start()
            
            # Return preliminary report path, user can view immediately
            output_path = quick_output_path
            final_report = quick_report
            
            # Calculate final metrics
            total_time = time.time() - start_time
            self.metrics["execution_time"] = total_time
            self.metrics["success_rate"] = 1.0 - (self.metrics["error_count"] / max(self.metrics["loop_count"], 1))
            
            self.logger.info(f"Deep search completed, total time taken: {total_time:.2f} seconds")
            
            return {
                "research_topic": research_topic,
                "final_report": final_report,
                "output_path": output_path,
                "research_context": research_context,
                "total_loops": self.metrics["loop_count"],
                "metrics": self.metrics.copy(),
                "quality_score": 0.85,  # Temporary quality score
                "iterations_completed": self.metrics["loop_count"]
            }
            
        except Exception as e:
            self.logger.error(f"Deep search workflow execution failed: {e}")
            self.metrics["error_count"] += 1
            self.metrics["execution_time"] = time.time() - start_time
            raise
    
    def get_metrics(self) -> Dict[str, Any]:
        """
        Get current monitoring metrics
        
        Returns:
            Dict[str, Any]: Monitoring metrics dictionary
        """
        return self.metrics.copy()
    
    def reset_metrics(self):
        """Reset monitoring metrics"""
        self.metrics = {
            "execution_time": 0.0,
            "search_count": 0,
            "loop_count": 0,
            "success_rate": 0.0,
            "token_usage": 0,
            "error_count": 0
        }
    
    def _generate_search_queries(self, topic: str, context: Dict[str, Any]) -> List[str]:
        """
        Generate search queries
        
        Args:
            topic: Research topic
            context: Research context
            
        Returns:
            List of search queries
        """
        # Build prompt
        existing_knowledge = context.get("research_summaries", [])
        knowledge_gaps = context.get("knowledge_gaps", [])
        
        # Safely get summary content
        existing_summary_text = ""
        if existing_knowledge:
            summaries = [self._get_summary_content(summary) for summary in existing_knowledge[-2:]]
            existing_summary_text = "\n".join(f"- {summary}" for summary in summaries)
        
        knowledge_gaps_text = ""
        if knowledge_gaps:
            knowledge_gaps_text = "\n".join(f"- {gap}" for gap in knowledge_gaps[-3:])
        
        detected_language = self._detect_language(topic)
        if detected_language == "zh":
            prompt = f"""
作为一名专业的搜索查询专家，请根据以下信息生成3-5个高质量的搜索查询。

研究主题：{topic}

已有知识：
{existing_summary_text if existing_summary_text else "无"}

知识空白：
{knowledge_gaps_text if knowledge_gaps_text else "无"}

要求：
1. 生成的查询应覆盖主题的不同方面
2. 使用不同的关键词组合
3. 针对识别出的知识空白设计查询
4. 查询应简洁且有针对性
5. 生成的查询必须使用与研究主题相同的语言

请以JSON格式返回查询列表：
{{"queries": ["查询1", "查询2", "查询3"]}}

仅返回JSON，不要包含其他解释。
"""
        else:
            prompt = f"""
As a professional search query expert, please generate 3-5 high-quality search queries based on the following information.

Research Topic: {topic}

Existing Knowledge:
{existing_summary_text if existing_summary_text else "None"}

Knowledge Gaps:
{knowledge_gaps_text if knowledge_gaps_text else "None"}

Requirements:
1. Generated queries should cover different aspects of the topic
2. Use different keyword combinations
3. Design queries targeting identified knowledge gaps
4. Queries should be concise and targeted
5. Generated queries must use the same language as the research topic

Please return query list in JSON format:
{{"queries": ["query1", "query2", "query3"]}}

Return JSON only, no other explanations.
"""

        
        try:
            # Correct LLM call method
            messages = [{"role": "user", "content": prompt}]
            
            # Record LLM call start
            call_start_time = time.time()
            
            # Record LLM call start monitoring
            self.monitoring_handler.on_llm_call(prompt, self.llm_provider.model, {"operation": "query_generation"})
            
            response = self.llm_provider.invoke(messages)
            call_duration = time.time() - call_start_time
            
            # Record token usage
            if hasattr(response, 'token_usage') and response.token_usage:
                token_usage = response.token_usage.total_tokens
                if token_usage is not None:
                    self.metrics["token_usage"] += token_usage
                self.logger.info(f"LLM call - Model: {response.model_name}, Token usage: {token_usage}, Time taken: {call_duration:.2f}s, Operation: query_generation")
                
                # Record monitoring data
                self.monitoring_handler.on_llm_response(response, {"operation": "query_generation", "duration": call_duration})
            
            print(f"● Query generation response: {response.content[:200]}...")
            
            # Use safe JSON parsing
            result = self._safe_json_parse(response.content)
            
            # Safely check result
            if result and isinstance(result, dict) and "queries" in result and isinstance(result["queries"], list):
                return result["queries"]
            else:
                print(f"⚠️  Query generation response format incorrect: {result}")
                
        except Exception as e:
            print(f"⚠️  Query generation failed: {e}")
        
        # If parsing fails, return default queries
        return [f"{topic} latest research", f"{topic} detailed analysis", f"{topic} development trends"]
    
    @retry(
        stop=stop_after_attempt(3), 
        wait=wait_exponential(multiplier=1, min=4, max=10), 
        retry=retry_if_exception_type((ConnectionError, TimeoutError, ValueError))
    )
    def _search_and_summarize(self, queries: List[str], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute search and summarization
        
        Args:
            queries: Search query list
            context: Research context
            
        Returns:
            Summary result
        """
        # Execute search
        all_search_results = []
        for query in queries:
            print(f"  Searching: {query}")
            try:
                # Enable summary parameter to get more detailed content
                search_results = self.search_tool._run(query, summary=True, count=10)
                if isinstance(search_results, list):
                    all_search_results.extend(search_results)
                else:
                    print(f"⚠️  Search result format incorrect: {type(search_results)}")
            except Exception as e:
                print(f"⚠️  Search failed: {e}")
        
        # Build summarization prompt
        search_content = ""
        if all_search_results:
            search_content = "\n\n".join([
                f"Title: {result.get('title', 'No title')}\nLink: {result.get('link', result.get('url', 'No link'))}\nContent: {result.get('summary') or result.get('snippet', 'No summary')}"
                for result in all_search_results
                if isinstance(result, dict)
            ])
        
        existing_summaries = context.get("research_summaries", [])
        existing_summary_text = ""
        if existing_summaries:
            summaries = [self._get_summary_content(summary) for summary in existing_summaries]
            existing_summary_text = "\n\n".join([
                f"• {summary}"
                for summary in summaries
            ])
        
        # Detect topic language
        topic_language = self._detect_language(context['topic'])
        
        if topic_language == 'chinese':
            prompt = f"""
作为首席研究分析师，请分析以下搜索结果并提供总结。

研究主题：{context['topic']}

当前搜索结果：
{search_content if search_content else "无搜索结果"}

现有研究总结：
{existing_summary_text if existing_summary_text else "无"}

请提供：
1. 当前搜索结果的简洁总结
2. 识别剩余的知识空白
3. 评估是否需要进一步研究

请以JSON格式返回结果：
{{
  "summary": "当前搜索结果的总结",
  "search_results": ["关键发现1", "关键发现2", "关键发现3"],
  "knowledge_gaps": ["知识空白1", "知识空白2"],
  "research_complete": true/false
}}

只返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As the chief research analyst, please analyze the following search results and provide a summary.

Research Topic: {context['topic']}

Current Search Results:
{search_content if search_content else "No search results"}

Existing Research Summary:
{existing_summary_text if existing_summary_text else "None"}

Please provide:
1. A concise summary of current search results
2. Identify remaining knowledge gaps
3. Assess whether further research is needed

**Important: Please use the same language as the research topic for summarization and analysis (if topic is Chinese, summary should be Chinese; if topic is English, summary should be English)**

Please return results in JSON format:
{{
  "summary": "Summary of current search results",
  "search_results": ["Key finding 1", "Key finding 2", "Key finding 3"],
  "knowledge_gaps": ["Knowledge gap 1", "Knowledge gap 2"],
  "research_complete": true/false
}}

Return JSON only, no other explanations.
"""
        
        try:
            # Correct LLM call method
            messages = [{"role": "user", "content": prompt}]
            
            # Record LLM call start
            call_start_time = time.time()
            
            # Record LLM call start monitoring
            self.monitoring_handler.on_llm_call(prompt, self.llm_provider.model, {"operation": "search_summarization"})
            
            response = self.llm_provider.invoke(messages)
            call_duration = time.time() - call_start_time
            
            # Record token usage
            if hasattr(response, 'token_usage') and response.token_usage:
                token_usage = response.token_usage.total_tokens
                if token_usage is not None:
                    self.metrics["token_usage"] += token_usage
                self.logger.info(f"LLM call - Model: {response.model_name}, Token usage: {token_usage}, Time taken: {call_duration:.2f}s, Operation: search_summarization")
                
                # Record monitoring data
                self.monitoring_handler.on_llm_response(response, {"operation": "search_summarization", "duration": call_duration})
            
            print(f"● Summarization response: {response.content[:200]}...")
            
            # Use safe JSON parsing
            result = self._safe_json_parse(response.content)
            
            # Ensure correct format is returned
            if result and isinstance(result, dict):
                return {
                    "summary": result.get("summary", "Search results obtained"),
                    "search_results": result.get("search_results", []),
                    "knowledge_gaps": result.get("knowledge_gaps", []),
                    "research_complete": result.get("research_complete", False)
                }
            else:
                print(f"⚠️  Summarization response format incorrect: {result}")
                
        except Exception as e:
            print(f"⚠️  Search summarization failed: {e}")
        
        # If parsing fails, return default structure
        safe_search_results = []
        if all_search_results:
            for result in all_search_results[:3]:
                if isinstance(result, dict):
                    safe_search_results.append(result.get('title', 'No title'))
                else:
                    safe_search_results.append(str(result))
        
        return {
            "summary": f"Completed search for '{context['topic']}', obtained {len(all_search_results)} results",
            "search_results": safe_search_results,
            "knowledge_gaps": [],
            "research_complete": False
        }
    
    def _generate_final_report(self, context: Dict[str, Any]) -> str:
        """
        Generate final research report
        
        Args:
            context: Research context
            
        Returns:
            Final report content
        """
        # Collect all search results and citation information
        all_search_results = context.get("search_results", [])
        research_summaries = context.get("research_summaries", [])
        
        # Build citation mapping
        citations = {}
        citation_counter = 1
        
        # Extract citation information from search results
        for result in all_search_results:
            if isinstance(result, dict) and result.get('link'):
                url = result.get('link')
                title = result.get('title', 'No title')
                if url not in citations:
                    citations[url] = {
                        'index': citation_counter,
                        'title': title,
                        'url': url
                    }
                    citation_counter += 1
        
        # Integrate found discoveries (don't show rounds)
        all_findings = []
        for summary in research_summaries:
            if isinstance(summary, dict):
                findings = summary.get("search_results", [])
                all_findings.extend(findings)
            else:
                summary_content = self._get_summary_content(summary)
                if summary_content:
                    all_findings.append(summary_content)
        
        findings_text = "\n".join([f"• {finding}" for finding in all_findings[:10]])
        
        # Build citation list text
        citations_text = ""
        if citations:
            citations_text = "\n".join([
                f"[{cite['index']}] {cite['title']} - {cite['url']}"
                for cite in citations.values()
            ])
        
        # Detect topic language and generate report prompt
        topic_language = self._detect_language(context['topic'])
        
        if topic_language == 'chinese':
            prompt = f"""
请基于以下研究信息生成专业的研究报告：

研究主题：{context['topic']}

关键发现：
{findings_text if findings_text else "无关键发现"}

可用引用来源：
{citations_text if citations_text else "无引用来源"}

请生成包含以下部分的报告：
1. **概述** - 主题背景的简要介绍
2. **核心发现** - 关键信息和数据的详细阐述
3. **深度分析** - 专业分析和解读
4. **结论与展望** - 要点总结和未来趋势

格式要求：
- 在相关内容后添加上标引用，如：重要发现[1]
- 内容应专业、准确、深入
- 避免使用"轮次"等技术术语
- 在报告末尾包含完整的引用列表

请直接返回完整的Markdown格式报告。
"""
        else:
            prompt = f"""
Please generate a professional research report based on the following research information:

Research Topic: {context['topic']}

Key Findings:
{findings_text if findings_text else "No key findings"}

Available Citation Sources:
{citations_text if citations_text else "No citation sources"}

Please generate a report containing the following sections:
1. **Overview** - Brief introduction to topic background
2. **Core Findings** - Detailed elaboration of key information and data
3. **Deep Analysis** - Professional analysis and interpretation
4. **Conclusions and Outlook** - Summary of key points and future trends

Format Requirements:
- Use the same language as the topic
- Add superscript citations after relevant content, such as: important finding[1]
- Content should be professional, accurate, and in-depth
- Avoid using technical terms like "rounds"
- Include complete citation list at the end of the report

Please return the complete Markdown format report directly.
"""
        
        try:
            messages = [{"role": "user", "content": prompt}]
            print("📝 Generating final report")
            
            # Record LLM call start
            call_start_time = time.time()
            
            # Record LLM call start monitoring
            self.monitoring_handler.on_llm_call(prompt, self.llm_provider.model, {"operation": "final_report_generation"})
            
            response = self.llm_provider.invoke(messages)
            call_duration = time.time() - call_start_time
            
            # Record token usage
            if hasattr(response, 'token_usage') and response.token_usage:
                token_usage = response.token_usage.total_tokens
                if token_usage is not None:
                    self.metrics["token_usage"] += token_usage
                self.logger.info(f"LLM call - Model: {response.model_name}, Token usage: {token_usage}, Time taken: {call_duration:.2f}s, Operation: final_report_generation")
                
                # Record monitoring data
                self.monitoring_handler.on_llm_response(response, {"operation": "final_report_generation", "duration": call_duration})
            
            # Add citation list at the end of the report
            report_content = response.content
            if citations:
                report_content += "\n\n## 📚 References\n\n"
                for cite in sorted(citations.values(), key=lambda x: x['index']):
                    report_content += f"[{cite['index']}] [{cite['title']}]({cite['url']})\n"
            
            print("✅ Report generation successful")
            return report_content
            
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            print(f"⚠️  Report generation failed: {error_msg}")
            # Pass error information to fallback report
            context["report_generation_error"] = error_msg
            return self._create_fallback_report(context)
    
    def _create_fallback_report(self, context: Dict[str, Any]) -> str:
        """
        Create fallback report (when API call fails)
        
        Args:
            context: Research context
            
        Returns:
            Fallback report content
        """
        research_summaries = context.get("research_summaries", [])
        all_queries = context.get("generated_queries", [])
        all_search_results = context.get("search_results", [])
        error_info = context.get("report_generation_error", "LLM service call exception")
        
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
                    all_images.extend(result['images'][:3])  # Take at most 3 images per result
        
        summaries_text = ""
        if research_summaries:
            summaries = [self._get_summary_content(summary) for summary in research_summaries]
            summaries_text = "\n\n".join([
                f"• {summary}"
                for summary in summaries
            ])
        
        queries_text = "\n".join([f"• {query}" for query in all_queries])
        
        # Build citation list
        citations_text = ""
        if citations:
            citations_text = "\n\n## 📚 References\n\n"
            for cite in sorted(citations.values(), key=lambda x: x['index']):
                citations_text += f"[{cite['index']}] [{cite['title']}]({cite['url']})\n"
        
        # Add image information
        images_section = ""
        if all_images:
            images_section = "\n\n## 🖼️ Related Images\n\n"
            for i, img in enumerate(all_images[:5], 1):  # Show at most 5 images
                if img.get('url') and img.get('title'):
                    images_section += f"![{img['title']}]({img['url']})\n\n"
                    if img.get('thumbnail'):
                        images_section += f"*Thumbnail: {img['thumbnail']}*\n\n"
        
        # Add token statistics
        token_stats = ""
        if self.metrics.get("token_usage", 0) > 0:
            token_stats = f"""

## 📊 Resource Usage Statistics
- **Token Usage**: {self.metrics.get('token_usage', 0):,} tokens
- **Search Count**: {len(all_search_results)} times
- **Query Generation**: {len(all_queries)} queries
- **Execution Time**: {self.metrics.get('execution_time', 0):.2f} seconds
- **Image Collection**: {len(all_images)} images
"""
        
        # Detect topic language for fallback report
        topic_language = self._detect_language(context['topic'])
        
        if topic_language == 'chinese':
            return f"""
# 关于"{context['topic']}"的研究报告

## 📋 研究概述
本次深度搜索使用了**{len(all_queries)}**个搜索查询，收集了相关信息。

## ● 核心发现
{summaries_text if summaries_text else "• 完成了对'" + context['topic'] + "'的搜索，获得了" + str(len(all_search_results)) + "个结果"}

## 🎯 搜索查询
{queries_text if queries_text else "无查询记录"}{images_section}{citations_text}{token_stats}

## ⚠️ 说明
本报告基于搜索结果自动生成。由于LLM服务调用异常（{error_info}），系统自动生成了这份简化报告，包含了完整的研究过程和发现。

---
*报告生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}*
"""
        else:
            return f"""
# Research Report on "{context['topic']}"

## 📋 Research Overview
This deep search used **{len(all_queries)}** search queries and collected relevant information.

## ● Core Findings
{summaries_text if summaries_text else "• Completed search for '" + context['topic'] + "', obtained " + str(len(all_search_results)) + " results"}

## 🎯 Search Queries
{queries_text if queries_text else "No query records"}{images_section}{citations_text}{token_stats}

## ⚠️ Note
This report is automatically generated based on search results. Due to LLM service call exception ({error_info}), the system automatically generated this simplified report, which includes the complete research process and findings.

---
*Report generation time: {time.strftime('%Y-%m-%d %H:%M:%S')}*
"""
    
    def _detect_language(self, text: str) -> str:
        """
        Detect the language of the input text
        
        Args:
            text: Input text
            
        Returns:
            str: Detected language ('chinese' or 'english')
        """
        # Simple language detection based on character sets
        chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
        total_chars = len([char for char in text if char.isalpha()])
        
        if total_chars == 0:
            return "english"  # Default to English if no alphabetic characters
        
        chinese_ratio = chinese_chars / total_chars if total_chars > 0 else 0
        
        if chinese_ratio > 0.3:  # If more than 30% are Chinese characters
            return "chinese"
        else:
            return "english"
    
    def _save_report_to_file(self, report_content: str, research_topic: str, suffix: str = "") -> str:
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
            # Create output directory
            output_dir = Path("./output")
            output_dir.mkdir(parents=True, exist_ok=True)
            self.logger.info(f"Output directory created/confirmed: {output_dir.absolute()}")
            
            # Generate filename (clean special characters)
            safe_topic = re.sub(r'[<>:"/\\|?*]', '_', research_topic)
            timestamp = time.strftime('%Y%m%d_%H%M%S')
            filename = f"research_report_{safe_topic}{suffix}_{timestamp}.md"
            
            # Save file
            file_path = output_dir / filename
            self.logger.info(f"Preparing to save report to: {file_path.absolute()}")
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(report_content)
            
            # Verify file was saved successfully
            if file_path.exists():
                file_size = file_path.stat().st_size
                print(f"📄 Report successfully saved to: {file_path}")
                print(f"📊 File size: {file_size:,} bytes")
                self.logger.info(f"Report saved successfully: {file_path}, size: {file_size} bytes")
                return str(file_path)
            else:
                error_msg = "File verification failed after save, file does not exist"
                print(f"❌ {error_msg}")
                self.logger.error(error_msg)
                return None
            
        except PermissionError as e:
            error_msg = f"Permission error, cannot write file: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None
        except OSError as e:
            error_msg = f"Operating system error: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None
        except Exception as e:
            error_msg = f"Report save failed: {type(e).__name__}: {e}"
            print(f"❌ {error_msg}")
            self.logger.error(error_msg)
            return None