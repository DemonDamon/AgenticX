"""
Unified Research Workflow Implementation

Merges three workflow modes:
1. Basic Deep Search Mode (Basic Mode)
2. Interactive Clarification Mode (Interactive Mode) 
3. Advanced Multi-iteration Mode (Advanced Mode)

Supports switching between modes via parameters
"""

import json
import re
import yaml
import os
import time
import logging
import itertools
import sys
import threading
import asyncio
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
from enum import Enum
from pydantic import Field
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from agenticx.core.workflow import Workflow
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool
from agenticx.observability.monitoring import MonitoringCallbackHandler
from agenticx.observability.logging import LoggingCallbackHandler

from ..agents import QueryGeneratorAgent, ResearchSummarizerAgent
from ..tools import GoogleSearchTool, BingWebSearchTool, MockBingSearchTool, BochaaIWebSearchTool
from ..utils import clean_input_text


class WorkflowMode(Enum):
    """Workflow execution modes"""
    BASIC = "basic"           # Basic mode - similar to deep_search_workflow
    INTERACTIVE = "interactive"  # Interactive mode - similar to interactive_deep_search_workflow
    ADVANCED = "advanced"     # Advanced mode - similar to multi_iteration_workflow


class UnifiedResearchWorkflow:
    """
    Unified Research Workflow
    
    Supports three modes:
    1. Basic Mode: Simple multi-round search loop
    2. Interactive Mode: Kimi-style question clarification and interaction
    3. Advanced Mode: AgenticX-based multi-iteration research
    """
    
    def __init__(self, 
                 llm_provider: BaseLLMProvider, 
                 mode: WorkflowMode = WorkflowMode.BASIC,
                 max_research_loops: int = 3,
                 organization_id: str = "deepsearch", 
                 search_engine: str = "mock",
                 config_path: str = "config.yaml",
                 clarification_mode: str = "one_shot",
                 **kwargs):
        """
        Initialize unified research workflow
        
        Args:
            llm_provider: LLM provider
            mode: Workflow mode (basic, interactive, advanced)
            max_research_loops: Maximum research loop count
            organization_id: Organization ID
            search_engine: Search engine type
            config_path: Configuration file path
            **kwargs: Additional configuration parameters
        """
        self.llm_provider = llm_provider
        self.mode = mode
        self.max_research_loops = max_research_loops
        self.organization_id = organization_id
        self.config_path = config_path
        self.clarification_mode = clarification_mode  # "one_shot" or "progressive"
        self.language = "en"  # Default language
        self.kwargs = kwargs
        
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
        
        # Initialize monitoring handlers
        self.monitoring_handler = MonitoringCallbackHandler()
        self.logging_handler = LoggingCallbackHandler()
        
        # Set up logging
        self._setup_logging()
        
        # Load configuration file
        self.config = self._load_config()
        
        # Initialize search tool based on selection (supports dynamic configuration)
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
        
        # Research context
        self.research_context = self._get_initial_research_context()
        
        # Advanced mode specific initialization
        if mode == WorkflowMode.ADVANCED:
            self._initialize_advanced_mode()
    
    def _setup_logging(self):
        """Setup logging configuration"""
        log_filename = f"{self.mode.value}_research.log"
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_filename),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration file"""
        if not os.path.exists(self.config_path):
            return {}
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
                return config
        except Exception as e:
            return {}
    
    def _initialize_search_tool(self, search_engine: str) -> BaseTool:
        """Dynamically initialize search tool"""
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
            return self._create_mock_search_tool()
    
    def _create_google_search_tool(self) -> BaseTool:
        """Create Google search tool"""
        try:
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
        except Exception as e:
            raise
    
    def _create_bing_search_tool(self) -> BaseTool:
        """Create Bing search tool"""
        try:
            bing_config = self.config.get('bing_search', {})
            subscription_key = bing_config.get('subscription_key')
            if subscription_key and subscription_key.startswith('${') and subscription_key.endswith('}'):
                env_var = subscription_key[2:-1]
                subscription_key = os.getenv(env_var)
            
            if not subscription_key:
                subscription_key = os.getenv("BING_SUBSCRIPTION_KEY") or os.getenv("AZURE_SUBSCRIPTION_KEY")
            
            if not subscription_key:
                raise ValueError("Bing Subscription Key not configured")
            
            return BingWebSearchTool(subscription_key=subscription_key)
        except Exception as e:
            raise
    
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
            
            return BochaaIWebSearchTool(api_key=api_key)
        except Exception as e:
            raise
    
    def _create_mock_search_tool(self) -> BaseTool:
        """Create mock search tool"""
        return MockBingSearchTool()
    
    def _initialize_advanced_mode(self):
        """Initialize advanced mode specific components"""
        # Advanced mode specific initialization can be added here
        pass
    
    def execute(self, research_topic: str, research_objective: str = "") -> Dict[str, Any]:
        """
        Execute research workflow based on selected mode
        
        Args:
            research_topic: Research topic
            research_objective: Research objective
            
        Returns:
            Dict: Research results
        """
        start_time = time.time()
        
        try:
            # Detect language and set it for the current execution
            self.language = self._detect_language(research_topic)

            # Initialize research context
            self.research_context["topic"] = research_topic
            self.research_context["objective"] = research_objective
            self.research_context["current_iteration"] = 0
            
            # Execute multi-round research loop
            if self.mode == WorkflowMode.BASIC:
                result = self._execute_basic_mode(research_topic, research_objective)
            elif self.mode == WorkflowMode.INTERACTIVE:
                result = self._execute_interactive_mode(research_topic, research_objective)
            elif self.mode == WorkflowMode.ADVANCED:
                result = self._execute_advanced_mode(research_topic, research_objective)
            else:
                # Default to basic mode
                result = self._execute_basic_mode(research_topic, research_objective)
            
            # Calculate final metrics
            execution_time = time.time() - start_time
            self.metrics["execution_time"] = execution_time
            self.metrics["success_rate"] = 1.0 if result.get("success", False) else 0.0
            
            return result
            
        except Exception as e:
            self.logger.error(f"Workflow execution failed: {e}")
            self.metrics["error_count"] += 1
            return {
                "success": False,
                "error": str(e),
                "metrics": self.metrics
            }
    
    def _execute_basic_mode(self, research_topic: str, research_objective: str) -> Dict[str, Any]:
        """Execute basic research mode"""
        # Initialize research context
        self.research_context["current_iteration"] = 0
        
        # Execute multi-round research loop
        for iteration in range(self.max_research_loops):
            self.research_context["current_iteration"] = iteration + 1
            self.metrics["loop_count"] = iteration + 1
            
            # Show thinking process: analyze current research status
            print(f"\n● Round {iteration + 1}/{self.max_research_loops}")
            
            # Generate search queries with loading animation
            max_queries = self.config.get('deep_search', {}).get('max_generated_search_query_per_research_loop', 5)
            done_generating = threading.Event()
            spinner_generating = threading.Thread(target=self._spinner, args=(done_generating, f"  ✦ Generating {max_queries} search query ..."))
            spinner_generating.start()
            try:
                queries = self._generate_search_queries(research_topic, self.research_context)
            finally:
                done_generating.set()
                spinner_generating.join()
            print(f"  ✦ Finished generating {max_queries} search query")

            if isinstance(queries, list):
                for query in queries:
                    print(f"  | \033[2m{query}\033[0m")
            
            # Execute search and summarization
            search_results = self._search_and_summarize(queries, self.research_context)

            self.research_context["research_summaries"].extend(search_results.get("findings_summary", []))
            self.research_context["citations"].extend(search_results.get("citations", []))

            # Update research context with thinking process
            if "thinking_process" not in self.research_context:
                self.research_context["thinking_process"] = []
            self.research_context["thinking_process"].extend(search_results.get("thinking_process", []))
            
            # Update thinking steps count
            self.metrics["thinking_steps"] += len(search_results.get("thinking_process", []))
            
            # Show thinking process: analyze search results
            # print(f"\n● Analyzing search results...")
            
            # Check if research should continue
            if not self._should_continue_research(self.research_context):
                print(f"● Searching Loop completed in {iteration + 1} rounds\n")
                break
        
        # Generate final report with loading animation
        done = threading.Event()
        spinner = threading.Thread(target=self._spinner, args=(done, "● Preparing final report, it will takes a few minutes ..."))
        spinner.start()

        try:
            final_report = self._generate_final_report(self.research_context)
        finally:
            done.set()
            spinner.join()
        
        return {
            "success": True,
            "final_report": final_report,
            "metrics": self.metrics,
            "research_context": self.research_context
        }
    
    def _spinner(self, done: threading.Event, message: str = "Loading..."):
        """Display a spinner animation."""
        for char in itertools.cycle(['|', '/', '-', '\\']):
            if done.is_set():
                break
            sys.stdout.write(f'\r{message} {char}')
            sys.stdout.flush()
            time.sleep(0.1)
        sys.stdout.write('\r' + ' ' * (len(message) + 2) + '\r')  # Clear the line
        sys.stdout.flush()

    def _execute_interactive_mode(self, research_topic: str, research_objective: str) -> Dict[str, Any]:
        """Execute interactive research mode"""
        try:
            # Phase 1: Initial search and understanding
            print(f"\n● Initial search and understanding")
            initial_queries = self._generate_search_queries(research_topic, self.research_context)
            initial_search_results = self._search_and_summarize(initial_queries, self.research_context)
            
            # Update research context with thinking process
            if "thinking_process" not in self.research_context:
                self.research_context["thinking_process"] = []
            self.research_context["thinking_process"].extend(initial_search_results.get("thinking_process", []))
            
            # Convert search results to list format for reflection analysis
            results_list = initial_search_results.get("results", [])
            if not isinstance(results_list, list):
                results_list = []
            
            # Phase 2: Reflection based on initial search results
            print(f"● Reflection and analysis")
            done_analyzing = threading.Event()
            spinner_analyzing = threading.Thread(target=self._spinner, args=(done_analyzing, "  ✦ Analyzing initial search results ..."))
            spinner_analyzing.start()
            try:
                reflection_result = self._perform_reflection_analysis(research_topic, results_list)
            finally:
                done_analyzing.set()
                spinner_analyzing.join()

            print("\r  ✦ Finished analyzing initial search results")
            if isinstance(reflection_result, dict):
                for key, value in reflection_result.items():
                    print(f"     ✦ {key.replace('_', ' ').title()}")
                    if isinstance(value, list):
                        for item in value:
                            print(f"     | \033[2m{item}\033[0m")
                    else:
                        print(f"     | \033[2m{value}\033[0m")
            else:
                print(f"     | {reflection_result}")
            
            # Phase 3: Question clarification
            print(f"\n● Topic clarification")
            clarification_result = self._clarify_research_topic(research_topic, reflection_result)
            
            # Update clarification count
            if clarification_result.get("clarification_success", False):
                self.metrics["clarification_count"] += 1
            
            clarified_topic = clarification_result.get("clarified_topic", research_topic)
            user_answers = clarification_result.get("user_answers", {})
            clarification_success = clarification_result.get("clarification_success", False)
            
            # Phase 4: Continue research with clarified topic
            if clarification_success and clarified_topic != research_topic:
                print(f"\n● Updated research focus: \033[36m{clarified_topic}\033[0m")
                final_research_result = self._continue_research_with_clarified_topic(clarified_topic, user_answers)
                
                return {
                    "success": True,
                    "mode": "interactive",
                    "original_topic": research_topic,
                    "clarified_topic": clarified_topic,
                    "user_answers": user_answers,
                    "final_report": final_research_result.get("final_report", ""),
                    "report_path": final_research_result.get("report_path", ""),
                    "research_results": final_research_result.get("research_results", []),
                    "metrics": self.metrics,
                    "reflection_result": reflection_result,
                    "clarification_result": clarification_result
                }
            else:
                # If clarification failed or user chose original topic, continue with basic research
                print(f"\n● Continuing with original topic")
                
                # Update research context with initial findings
                self.research_context.update({
                    "topic": research_topic,
                    "findings": initial_search_results.get("findings", []),
                    "knowledge_gaps": initial_search_results.get("knowledge_gaps", []),
                    "thinking_process": initial_search_results.get("thinking_process", [])
                })
                
                # Continue with remaining research iterations
                for iteration in range(1, self.max_research_loops):
                    print(f"\n● Research iteration {iteration + 1}/{self.max_research_loops}")
                    self.research_context["current_iteration"] = iteration
                    self.metrics["loop_count"] = iteration + 1
                    
                    queries = self._generate_search_queries(research_topic, self.research_context)
                    search_results = self._search_and_summarize(queries, self.research_context)
                    
                    # Update research context with thinking process
                    if "thinking_process" not in self.research_context:
                        self.research_context["thinking_process"] = []
                    self.research_context["thinking_process"].extend(search_results.get("thinking_process", []))
                    
                    # Update thinking steps count
                    self.metrics["thinking_steps"] += len(search_results.get("thinking_process", []))
                    
                    if not self._should_continue_research(self.research_context):
                        break
                
                # Generate final report
                final_report = self._generate_final_report(self.research_context)
                report_path = self._save_report_to_file(final_report, research_topic, "_interactive")
                
                return {
                    "success": True,
                    "mode": "interactive",
                    "original_topic": research_topic,
                    "clarified_topic": research_topic,
                    "user_answers": user_answers,
                    "final_report": final_report,
                    "report_path": report_path,
                    "metrics": self.metrics,
                    "reflection_result": reflection_result,
                    "clarification_result": clarification_result
                }
            
        except Exception as e:
            # Fallback to basic mode
            self.logger.error(f"Interactive mode failed, falling back to basic mode: {e}")
            self.metrics["error_count"] += 1
            return self._execute_basic_mode(research_topic, research_objective)
    
    def _execute_advanced_mode(self, research_topic: str, research_objective: str) -> Dict[str, Any]:
        """Execute advanced research mode - Multi-iteration research"""
        try:
            # print(f"\n{'='*60}")
            # print(f"🚀 Advanced Research Mode: {research_topic}")
            # print(f"{'='*60}")
            
            # Initialize advanced mode configuration
            max_iterations = self.kwargs.get('max_iterations', 3)
            quality_threshold = self.kwargs.get('quality_threshold', 0.8)
            
            # Store all iteration results
            all_iterations = []
            accumulated_knowledge = {}
            total_search_results = []
            
            # Execute multi-round iterations
            for iteration in range(1, max_iterations + 1):
                print(f"\n● Iteration {iteration}/{max_iterations}")
                self.metrics["loop_count"] = iteration
                
                # Execute single iteration
                iteration_result = self._execute_single_iteration(
                    research_topic, iteration, accumulated_knowledge, research_objective
                )
                
                all_iterations.append(iteration_result)
                total_search_results.extend(iteration_result.get('search_results', []))
                
                # Update thinking steps count
                if "thinking_process" in self.research_context:
                    self.metrics["thinking_steps"] += len(self.research_context["thinking_process"])
                
                # Update accumulated knowledge
                self._update_accumulated_knowledge(accumulated_knowledge, iteration_result)
                
                # Perform reflection analysis
                reflection = self._perform_iteration_reflection(
                    iteration, iteration_result, accumulated_knowledge
                )
                
                # Check termination criteria
                should_terminate, reason = self._check_advanced_termination(
                    iteration, iteration_result, quality_threshold, max_iterations
                )
                
                if should_terminate:
                    print(f"● Research terminated: {reason}")
                    break
                    
                # Adjust strategy for next iteration
                if iteration < max_iterations:
                    self._adjust_next_iteration_strategy(reflection, accumulated_knowledge)
            
            # Generate final report
            final_report = self._generate_advanced_final_report(
                research_topic, all_iterations, accumulated_knowledge, total_search_results
            )
            
            return {
                'success': True,
                'mode': 'advanced',
                'research_topic': research_topic,
                'total_iterations': len(all_iterations),
                'iterations': all_iterations,
                'final_report': final_report,
                'total_search_results': len(total_search_results),
                'accumulated_knowledge': accumulated_knowledge,
                'execution_status': 'completed',
                'metrics': self.metrics
            }
            
        except Exception as e:
            self.logger.error(f"Advanced mode failed: {e}")
            print(f"● Advanced mode execution failed: {e}")
            print("● Falling back to basic mode")
            return self._execute_basic_mode(research_topic, research_objective)
    
    def _generate_search_queries(self, topic: str, context: Dict[str, Any]) -> List[str]:
        """Generate search queries"""
        existing_knowledge = context.get("research_summaries", [])
        knowledge_gaps = context.get("knowledge_gaps", [])
        thinking_insights = context.get("thinking_insights", [])
        
        existing_summary_text = ""
        if existing_knowledge:
            summaries = [self._get_summary_content(summary) for summary in existing_knowledge[-2:]]
            existing_summary_text = "\n".join(f"- {summary}" for summary in summaries)
        
        knowledge_gaps_text = ""
        if knowledge_gaps:
            knowledge_gaps_text = "\n".join(f"- {gap}" for gap in knowledge_gaps[-3:])
        
        # Add thinking insights from LLM analysis
        thinking_insights_text = ""
        if thinking_insights:
            # Flatten insights from all thinking processes
            all_insights = []
            for insight_list in thinking_insights[-2:]:  # Last 2 thinking processes
                if isinstance(insight_list, list):
                    all_insights.extend(insight_list)
            if all_insights:
                thinking_insights_text = "\n".join(f"- {insight}" for insight in all_insights[-5:])  # Last 5 insights
        
        # Generate prompt based on the language of the current execution
        
        # Get max_generated_search_query_per_research_loop from config
        max_queries = self.config.get('deep_search', {}).get('max_generated_search_query_per_research_loop', 3)

        if self.language == "zh":
            prompt = f"""
作为专业的搜索策略专家，请根据以下信息严格生成{max_queries}个高质量的搜索查询。

研究主题：{topic}

已有知识：
{existing_summary_text if existing_summary_text else "无"}

知识缺口：
{knowledge_gaps_text if knowledge_gaps_text else "无"}

思考见解：
{thinking_insights_text if thinking_insights_text else "无"}

要求：
1. 生成的查询应覆盖主题的不同方面
2. 使用不同的关键词组合
3. 针对已识别的知识缺口设计查询
4. 基于思考见解深化搜索方向
5. 查询应简洁且有针对性

请以JSON格式返回查询列表, 数组长度必须为 {max_queries}：
{{"queries": ["查询1", ...]}}

只返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As a professional search strategy expert, please strictly generate {max_queries} high-quality search queries based on the following information.

Research Topic: {topic}

Existing Knowledge:
{existing_summary_text if existing_summary_text else "None"}

Knowledge Gaps:
{knowledge_gaps_text if knowledge_gaps_text else "None"}

Thinking Insights:
{thinking_insights_text if thinking_insights_text else "None"}

Requirements:
1. Generated queries should cover different aspects of the topic
2. Use different keyword combinations
3. Design queries targeting identified knowledge gaps
4. Deepen search directions based on thinking insights
5. Queries should be concise and targeted
6. Use the same language as the research topic

Please return query list in JSON format, the length of array must be {max_queries}:
{{"queries": ["query1", ...]}}

Return only JSON, no other explanations.
"""
        
        try:
            messages = [{"role": "user", "content": prompt}]
            response = self.llm_provider.invoke(prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict) and "queries" in result and isinstance(result["queries"], list):
                queries = result["queries"][:max_queries]
                return queries
        except Exception as e:
            self.logger.error(f"Query generation failed: {e}")
        
        # Fallback queries
        return [f"{topic} latest research", f"{topic} detailed analysis", f"{topic} development trends"]
    
    def _search_and_summarize(self, queries: List[str], context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute search and summarization with thinking process"""
        all_results = []
        thinking_process = []
        
        for i, query in enumerate(queries, 1):
            print(f"  ✦ Searching: \033[36m{query}\033[0m")
            
            try:
                # Execute search - Different tools have different interfaces
                max_search_results = self.config.get('deep_search', {}).get('max_search_results', 10)
                
                # Initialize search_results
                search_results = []
                
                # Check tool type and call accordingly
                if hasattr(self.search_tool, 'name') and 'bochaai' in self.search_tool.name.lower():
                    # BochaaI tool supports additional parameters
                    search_results = self.search_tool.run(query=query, summary=True, count=max_search_results)
                else:
                    # For Bing and Google tools - they only accept query parameter
                    search_results = self.search_tool.run(query=query)
                    
                if isinstance(search_results, list):
                    all_results.extend(search_results)
            except Exception as e:
                print(f"\n\033[31mAn error occurred during search: {e}\033[0m")
                search_results = []  # Initialize on error

            try:
                # Use ResearchSummarizerAgent for thinking summary
                if search_results:
                    # Start thinking animation
                    done = threading.Event()
                    thinking_spinner = threading.Thread(target=self._spinner, args=(done, "  ✦ Thinking ..."))
                    thinking_spinner.start()
                    
                    try:
                        # Real agent thinking process using LLM
                        thinking_result = self._perform_search_analysis_thinking(query, search_results, context)
                        thinking_process.append(thinking_result["thinking"])
                    finally:
                        done.set()
                        thinking_spinner.join()

                    print(f"  ✦ Thinking: {thinking_result['thinking']}\n")
                    
                    # Update context with thinking insights for next query generation
                    if "thinking_insights" not in context:
                        context["thinking_insights"] = []
                    context["thinking_insights"].append(thinking_result["insights"])
                
                self.metrics["search_count"] += 1
                
            except Exception as e:
                self.logger.error(f"Search failed: {e}")
                self.metrics["error_count"] += 1

        # Fallback results
        if not all_results:
            print("   ● No search results obtained, using fallback")
            all_results = [{"title": "No results", "content": "Search failed to return results"}]
        
        # Collect citation information
        citations = []
        for result in all_results:
            if isinstance(result, dict):
                url = result.get('url', '')
                title = result.get('title', '')
                if url and title:
                    citations.append(f"[{title}]({url})")
        
        # Integrate research findings
        findings_summary = []
        for result in all_results:  # Take all results for summary
            # for result in all_results[:5]:  # Take first 5 results for summary
            content = result.get('content', '') or result.get('summary', '')
            if content:
                # findings_summary.append(content[:200])
                findings_summary.append(content)

        return {
            "search_results": all_results,
            "findings_summary": findings_summary,
            "citations": citations,
            "thinking_process": thinking_process
        }
    
    def _generate_final_report(self, context: Dict[str, Any]) -> str:
        """Generate final research report"""
        try:
            # Use ResearchSummarizerAgent to create final report prompt
            final_report_prompt = self.research_summarizer.create_final_report_prompt(
                research_topic=context.get("topic", ""),
                all_summaries=context.get("research_summaries", []),
                citations=context.get("citations", [])
            )
            
            # Add thinking process information
            thinking_process = context.get("thinking_process", [])
            thinking_text = "\n".join([f"• {thinking}" for thinking in thinking_process[-5:]])  # Last 5 thinking processes
            
            # Detect language and build complete report generation prompt
            language = self._detect_language(context.get("topic", ""))
            
            if language == "zh":
                complete_prompt = f"""
{final_report_prompt}

研究思考过程：
{thinking_text}

请基于以上信息生成一份全面的研究报告。
"""
            else:
                complete_prompt = f"""
{final_report_prompt}

Research Thinking Process:
{thinking_text}

Please generate a comprehensive research report based on the above information.
"""
            
            messages = [{"role": "user", "content": complete_prompt}]
            response = self.llm_provider.invoke(complete_prompt)
            
            # Add citation list and thinking process at the end of the report
            report_content = response.content
            
            # # Add thinking process section
            # if thinking_process:
            #     report_content += f"\n\n## Research Thinking Process\n\n"
            #     for i, thinking in enumerate(thinking_process, 1):
            #         report_content += f"{i}. {thinking}\n"
            
            return report_content
            
        except Exception as e:
            self.logger.error(f"Final report generation failed: {e}")
            return self._create_fallback_report(context)
    
    def _create_fallback_report(self, context: Dict[str, Any]) -> str:
        """Create fallback report when final report generation fails"""
        topic = context.get("topic", "Unknown Topic")
        
        # Detect language and generate appropriate fallback report
        language = self._detect_language(topic)
        
        if language == "zh":
            fallback_report = f"""
# 研究报告：{topic}

## 执行摘要
本报告展示了我们对{topic}的研究发现。

## 研究过程
研究采用系统性方法，通过多次搜索迭代进行。

## 主要发现
基于所进行的研究，已识别出几个关键发现。

## 结论
研究为{topic}提供了有价值的见解。

## 研究局限性
本报告基于可获得的搜索结果，在覆盖范围上可能存在局限性。

---
*报告生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}*
"""
        else:
            fallback_report = f"""
# Research Report: {topic}

## Executive Summary
This report presents the findings from our research on {topic}.

## Research Process
The research was conducted using a systematic approach with multiple search iterations.

## Key Findings
Based on the research conducted, several key findings have been identified.

## Conclusions
The research provides valuable insights into {topic}.

## Research Limitations
This report is based on available search results and may have limitations in coverage.

---
*Report generated on {time.strftime('%Y-%m-%d %H:%M:%S')}*
"""
        
        return fallback_report
    
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
    
    def _save_report_to_file(self, report_content: str, research_topic: str, suffix: str = "") -> str:
        """Save report to file"""
        try:
            # Create output directory
            output_dir = Path("./output")
            output_dir.mkdir(parents=True, exist_ok=True)
            # self.logger.info(f"Output directory created/confirmed: {output_dir.absolute()}")
            
            # Generate filename (clean special characters)
            safe_topic = re.sub(r'[^\w\s-]', '', research_topic)[:50]
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"research_report_{safe_topic}_{timestamp}{suffix}.md"
            file_path = output_dir / filename
            
            # Save file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(report_content)
            
            # Verify file was saved successfully
            if file_path.exists():
                file_size = file_path.stat().st_size
                print(f"\n● Report successfully saved to: {file_path}")
                print(f"\n● File size: {file_size:,} bytes\n")
                # self.logger.info(f"Report saved successfully: {file_path}, size: {file_size} bytes")
                return str(file_path)
            else:
                print(f"● Failed to save report file")
                return ""
                
        except Exception as e:
            self.logger.error(f"Failed to save report: {e}")
            return ""
    
    def _clean_json_response(self, response_content: str) -> str:
        """Clean JSON response content"""
        # Clean content
        content = response_content.strip()
        
        # Match ```json``` format
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            return json_match.group(1).strip()
        
        # Match `````` format
        code_match = re.search(r'```\s*(.*?)\s*```', content, re.DOTALL)
        if code_match:
            return code_match.group(1).strip()
        
        # Try to extract JSON object from text
        json_object_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
        if json_object_match:
            return json_object_match.group(0).strip()
        
        # Direct parsing
        return content
    
    def _safe_json_parse(self, content: str) -> Optional[Dict[str, Any]]:
        """Safely parse JSON content"""
        try:
            cleaned_content = self._clean_json_response(content)
            return json.loads(cleaned_content)
        except json.JSONDecodeError as e:
            # print(f"● JSON parsing failed: {e}")
            # print(f"● Original content (first 300 chars): {content[:300]}...")
            # print(f"● Cleaned content (first 300 chars): {self._clean_json_response(content)[:300]}...")
            
            # Try to fix common JSON issues
            try:
                cleaned = self._clean_json_response(content)
                # Remove trailing commas
                fixed_content = re.sub(r',\s*}', '}', cleaned)
                fixed_content = re.sub(r',\s*]', ']', fixed_content)
                # Fix missing quotes around keys
                fixed_content = re.sub(r'(\w+):', r'"\1":', fixed_content)
                # Fix single quotes to double quotes
                fixed_content = re.sub(r"'", '"', fixed_content)
                return json.loads(fixed_content)
            except Exception as fix_error:
                # print(f"● JSON fix attempt failed: {fix_error}")
                pass
            
            return None
        except Exception as e:
            print(f"● JSON parsing exception: {e}")
            return None
    
    def _perform_reflection_analysis(self, research_topic: str, initial_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Perform reflection analysis on initial search results"""
        # print("\n🔍 Analyzing initial search results...")
        
        try:
            # Extract key information from search results
            key_findings = []
            potential_aspects = []
            
            for result in initial_results[:5]:  # Analyze top 5 results
                content = result.get('content', '') or result.get('summary', '')
                if content:
                    # Extract key phrases (simplified implementation)
                    sentences = content.split('.')[:3]  # First 3 sentences
                    key_findings.extend([s.strip() for s in sentences if len(s.strip()) > 10])
            
            # Generate reflection using LLM
            if self.language == "zh":
                reflection_prompt = f"""
作为一名研究分析师，请对以下主题的初步搜索结果进行分析：{research_topic}

初步搜索的关键发现：
{chr(10).join(key_findings[:10])}

请提供：
1. 值得进一步探索的关键方面
2. 基于该主题的潜在用户兴趣点
3. 建议的澄清方向

以JSON格式返回：
{{
  "key_aspects": ["方面1", "方面2", "方面3"],
  "potential_interests": ["兴趣点1", "兴趣点2", "兴趣点3"],
  "suggested_clarifications": ["澄清方向1", "澄清方向2"],
  "reflection": "简要反思总结"
}}

重要提示：仅返回有效的JSON格式，不要添加任何其他文本解释。
"""
            else:
                reflection_prompt = f"""
As a research analyst, please analyze the initial search results for the topic: {research_topic}

Key findings from initial search:
{chr(10).join(key_findings[:10])}

Please provide:
1. Key aspects that should be explored further
2. Potential user interests based on the topic
3. Suggested clarification directions

Return in JSON format:
{{
  "key_aspects": ["aspect1", "aspect2", "aspect3"],
  "potential_interests": ["interest1", "interest2", "interest3"],
  "suggested_clarifications": ["clarification1", "clarification2"],
  "reflection": "Brief reflection summary"
}}

IMPORTANT: Return only valid JSON format, do not add any other text explanations.
"""
            
            messages = [{"role": "user", "content": reflection_prompt}]
            response = self.llm_provider.invoke(reflection_prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                # print(f"✅ Reflection analysis completed")
                return result
            else:
                # Fallback reflection
                return {
                    "key_aspects": ["基本概念", "应用场景", "发展趋势"],
                    "potential_interests": ["实际应用", "技术细节", "未来发展"],
                    "suggested_clarifications": ["具体关注点", "应用领域"],
                    "reflection": f"已完成对{research_topic}的初步分析"
                }
                
        except Exception as e:
            self.logger.error(f"Reflection analysis failed: {e}")
            return {
                "key_aspects": ["基本概念", "应用场景"],
                "potential_interests": ["实际应用", "技术细节"],
                "suggested_clarifications": ["具体关注点"],
                "reflection": "初步分析完成"
            }
    
    def _clarify_research_topic(self, research_topic: str, reflection_result: Dict[str, Any]) -> Dict[str, Any]:
        """Clarify research topic based on reflection results"""
        print("  ✦ Preparing topic clarification questions")
        
        # Get clarification mode from config or default to one_shot
        clarification_mode = getattr(self, 'clarification_mode', 'one_shot')
        
        try:
            if clarification_mode == "progressive":
                return self._clarify_progressive(research_topic, reflection_result)
            else:
                return self._clarify_one_shot(research_topic, reflection_result)
        except Exception as e:
            self.logger.error(f"Topic clarification failed: {e}")
            return {
                "clarified_topic": research_topic,
                "user_answers": {},
                "clarification_success": False
            }
    
    def _clarify_one_shot(self, research_topic: str, reflection_result: Dict[str, Any]) -> Dict[str, Any]:
        """One-shot clarification mode"""
        # print("\n📋 One-shot clarification mode")
        
        # Extract information from reflection results
        key_aspects = reflection_result.get("key_aspects", [])
        potential_interests = reflection_result.get("potential_interests", [])
        suggested_clarifications = reflection_result.get("suggested_clarifications", [])
        
        # Generate clarification questions
        if self.language == "zh":
            clarification_prompt = f"""
作为一名专业的研究顾问，根据初步的搜索分析，我需要帮助用户澄清他们的研究需求。

用户的原始问题：{research_topic}

初步分析中发现的关键方面：{', '.join(key_aspects) if key_aspects else '无'}
用户可能关心的问题：{', '.join(potential_interests) if potential_interests else '无'}
建议的澄清方向：{', '.join(suggested_clarifications) if suggested_clarifications else '无'}

根据这些信息，请提出1-3个核心澄清问题，这些问题应：
1. 直接影响研究的方向和重点
2. 帮助确定研究的具体范围和深度
3. 澄清用户的真实需求和应用场景
4. 结合初步分析中发现的关键方面

以JSON格式返回：
{{
  "analysis": "基于初步搜索的分析结果（50字以内）",
  "core_questions": [
    "核心澄清问题1",
    "核心澄清问题2",
    "核心澄清问题3"
  ]
}}

重要提示：仅返回有效的JSON格式，不要添加任何其他文本解释。
"""
        else:
            clarification_prompt = f"""
As a professional research consultant, based on preliminary search analysis, I need to help users clarify their research needs.

User's original question: {research_topic}

Key aspects found in preliminary analysis: {', '.join(key_aspects) if key_aspects else 'None'}
Questions users might be concerned about: {', '.join(potential_interests) if potential_interests else 'None'}
Suggested clarification directions: {', '.join(suggested_clarifications) if suggested_clarifications else 'None'}

Based on this information, please propose 1-3 core clarification questions that should:
1. Directly impact the direction and focus of research
2. Help determine the specific scope and depth of research
3. Clarify users' real needs and application scenarios
4. Combine key aspects found in preliminary analysis

Return in JSON format:
{{
  "analysis": "Analysis results based on preliminary search (within 50 characters)",
  "core_questions": [
    "Core clarification question 1",
    "Core clarification question 2",
    "Core clarification question 3"
  ]
}}

IMPORTANT: Return only valid JSON format, do not add any other text explanations.
"""
        
        try:
            messages = [{"role": "user", "content": clarification_prompt}]
            response = self.llm_provider.invoke(clarification_prompt)
            clarification_result = self._safe_json_parse(response.content)
            
            if clarification_result and isinstance(clarification_result, dict):
                questions = clarification_result.get("core_questions", [])
                user_answers = self._display_clarification_questions(questions)
                
                return {
                    "clarified_topic": self._generate_clarified_topic(research_topic, user_answers),
                    "user_answers": user_answers,
                    "clarification_success": True,
                    "clarification_result": clarification_result
                }
            else:
                # Fallback to original topic
                return {
                    "clarified_topic": research_topic,
                    "user_answers": {},
                    "clarification_success": False
                }
                
        except Exception as e:
            self.logger.error(f"One-shot clarification failed: {e}")
            return {
                "clarified_topic": research_topic,
                "user_answers": {},
                "clarification_success": False
            }
    
    def _clarify_progressive(self, research_topic: str, reflection_result: Dict[str, Any]) -> Dict[str, Any]:
        """Progressive clarification mode (3-5 rounds)"""
        print("\n📋 Progressive clarification mode")
        
        user_answers = {}
        key_aspects = reflection_result.get("key_aspects", [])
        
        try:
            # Round 1: Focus area
            print(f"\n📋 Round 1: Understanding focus")
            print(f"Based on preliminary search, '{research_topic}' involves: {', '.join(key_aspects[:3]) if key_aspects else 'multiple dimensions'}")
            
            question1 = f"Which aspect of {research_topic} do you most want to understand?"
            if key_aspects:
                question1 += f" (e.g., {', '.join(key_aspects[:3])}, etc.)"
            
            print(f"\n❓ {question1}")
            answer1 = input("   Your answer: ").strip() or "Comprehensive understanding"
            user_answers["focus_area"] = answer1
            
            # Round 2: Depth requirements
            print(f"\n📋 Round 2: Depth requirements")
            question2 = f"Based on your focus on {answer1}, what level of information do you hope to obtain? (e.g., introductory overview, professional analysis, practical guidance, cutting-edge research, etc.)"
            print(f"\n❓ {question2}")
            answer2 = input("   Your answer: ").strip() or "Professional analysis"
            user_answers["depth_level"] = answer2
            
            # Round 3: Application scenario
            print(f"\n📋 Round 3: Application scenario")
            question3 = f"What is your main purpose for learning about {research_topic}? (e.g., academic research, work application, personal interest, decision making, etc.)"
            print(f"\n❓ {question3}")
            answer3 = input("   Your answer: ").strip() or "General learning"
            user_answers["purpose"] = answer3
            
            return {
                "clarified_topic": self._generate_clarified_topic(research_topic, user_answers),
                "user_answers": user_answers,
                "clarification_success": True
            }
            
        except (EOFError, KeyboardInterrupt):
            print("\n[Auto mode] Using original topic")
            return {
                "clarified_topic": research_topic,
                "user_answers": user_answers,
                "clarification_success": False
            }
    
    def _display_clarification_questions(self, questions: List[str]) -> Dict[str, str]:
        """Display clarification questions and collect answers"""
        user_answers = {}
        
        if not questions:
            return user_answers
        
        print(f"  ✦ Please answer the following {len(questions)} questions to help us provide more targeted research:")
        
        for i, question in enumerate(questions, 1):
            print(f"  | ❓ Question {i}: {question}")
            try:
                answer = input("  | 💭 Your answer: ").strip()
                if answer:
                    user_answers[f"question_{i}"] = answer
                else:
                    user_answers[f"question_{i}"] = "No specific preference"
            except (EOFError, KeyboardInterrupt):
                # print("\n[Auto mode] Using default answers")
                user_answers[f"question_{i}"] = "No specific preference"
        
        return user_answers
    
    def _generate_clarified_topic(self, original_topic: str, user_answers: Dict[str, str]) -> str:
        """Generate clarified topic based on user answers using LLM."""
        if not user_answers:
            return original_topic

        answers_text = "\n".join(f"- {q}: {a}" for q, a in user_answers.items())

        if self.language == "zh":
            prompt = f"""
作为一名专业的研究助理，请根据用户的原始研究主题和他们对澄清问题的回答，生成一个新的、更精确、更聚焦的研究主题。

原始主题：{original_topic}

用户的回答：
{answers_text}

请综合以上信息，提炼出一个不超过20个字的精炼研究主题，确保新主题能准确反映用户的具体兴趣点。

例如，如果原始主题是“人工智能”，用户的回答指向“在医疗领域的应用”和“图像识别技术”，那么一个好的新主题可以是“医疗影像中人工智能图像识别技术的应用研究”。

请直接返回新的研究主题，不要包含任何解释或多余的文字。
"""
        else:
            prompt = f"""
As a professional research assistant, please generate a new, more precise, and focused research topic based on the user's original topic and their answers to the clarification questions.

Original Topic: {original_topic}

User's Answers:
{answers_text}

Please synthesize the above information to refine a concise research topic of no more than 30 words, ensuring the new topic accurately reflects the user's specific interests.

For example, if the original topic is "Artificial Intelligence" and the user's answers point to "applications in the medical field" and "image recognition technology," a good new topic could be "Research on the Application of AI Image Recognition Technology in Medical Imaging."

Please return only the new research topic, without any explanation or extraneous text.
"""

        try:
            messages = [{"role": "user", "content": prompt}]
            response = self.llm_provider.invoke(prompt)
            clarified_topic = response.content.strip()
            # self.logger.info(f"Generated clarified topic: {clarified_topic}")
            return clarified_topic
        except Exception as e:
            # self.logger.error(f"Failed to generate clarified topic with LLM: {e}")
            # Fallback to simple concatenation if LLM fails
            clarifications = [v for v in user_answers.values() if v and v != "No specific preference"]
            if clarifications:
                return f"{original_topic} - {', '.join(clarifications[:2])}"
            else:
                return original_topic
    
    def _continue_research_with_clarified_topic(self, clarified_topic: str, user_answers: Dict[str, str]) -> Dict[str, Any]:
        """Continue research with clarified topic"""
        
        try:
            # Initialize research context for clarified topic
            research_context = {
                "topic": clarified_topic,
                "original_topic": self.research_context.get("original_topic", clarified_topic),
                "user_preferences": user_answers,
                "current_iteration": 0,
                "max_iterations": self.max_research_loops,
                "search_history": [],
                "research_summaries": [],
                "knowledge_gaps": [],
                "thinking_process": [],
                "citations": []
            }
            
            # Generate targeted search queries with loading animation
            done_generating_targeted = threading.Event()
            spinner_generating_targeted = threading.Thread(target=self._spinner, args=(done_generating_targeted, "  ✦ Start generated queries based on clarified topic"))
            spinner_generating_targeted.start()
            try:
                targeted_queries = self._generate_targeted_queries(clarified_topic, user_answers)
            finally:
                done_generating_targeted.set()
                spinner_generating_targeted.join()

            print(f"  ✦ Generated {len(targeted_queries)} targeted queries based on your preferences")
            for _ in targeted_queries:
                print(f"  | \033[2m{_}\033[0m")
            
            # Execute multi-round research similar to basic mode but with targeted focus
            all_results = []
            
            for iteration in range(self.max_research_loops):
                print(f"\n● Research iteration {iteration + 1}/{self.max_research_loops}")
                research_context["current_iteration"] = iteration
                
                # Use targeted queries for first iteration, then generate new ones
                if iteration == 0:
                    current_queries = targeted_queries
                else:
                    # Generate new queries based on previous findings
                    current_queries = self._generate_search_queries(
                        clarified_topic,
                        research_context
                    )
                
                # Execute search and summarization
                search_results = self._search_and_summarize(current_queries, research_context)
                all_results.extend(search_results.get("results", []))
                
                # Update research context
                research_context["search_history"].extend(current_queries)
                research_context["knowledge_gaps"] = search_results.get("knowledge_gaps", [])
                research_context["thinking_process"].extend(search_results.get("thinking_process", []))
                research_context["research_summaries"].extend(search_results.get("findings_summary", []))
                research_context["citations"].extend(search_results.get("citations", []))
                
                # Check if we should continue
                if not self._should_continue_research(research_context):
                    break
                
                # Brief pause between iterations
                time.sleep(1)
            
            # Generate final report with loading animation
            done_generating_report = threading.Event()
            spinner_generating_report = threading.Thread(target=self._spinner, args=(done_generating_report, " ● Generating final research report"))
            spinner_generating_report.start()
            try:
                final_report = self._generate_final_report(research_context)
            finally:
                done_generating_report.set()
                spinner_generating_report.join()
            
            # Save report
            report_path = self._save_report_to_file(
                final_report, 
                clarified_topic, 
                "_clarified"
            )
            
            return {
                "success": True,
                "clarified_topic": clarified_topic,
                "user_answers": user_answers,
                "research_results": all_results,
                "final_report": final_report,
                "report_path": report_path,
                "metrics": self.metrics,
                "research_context": research_context
            }
            
        except Exception as e:
            self.logger.error(f"Clarified research failed: {e}")
            self.metrics["error_count"] += 1
            return {
                "success": False,
                "error": str(e),
                "clarified_topic": clarified_topic,
                "user_answers": user_answers
            }
    
    def _generate_targeted_queries(self, clarified_topic: str, user_answers: Dict[str, str]) -> List[str]:
        """Generate targeted search queries based on clarified topic and user preferences using LLM."""
        language = self._detect_language(clarified_topic)
        preferences = "\n".join([f"- {key}: {value}" for key, value in user_answers.items() if value and value != "No specific preference"])

        if language == "zh":
            prompt = f"""
作为专业的搜索策略专家，请根据以下研究主题和用户偏好，生成5个高质量且有针对性的搜索查询。

研究主题：{clarified_topic}

用户偏好：
{preferences}

要求：
1. 查询必须紧密围绕研究主题和用户偏好。
2. 生成的查询应具有多样性，能从不同角度探索主题。
3. 查询应简洁、清晰，适合搜索引擎。

请以JSON格式返回查询列表：
{{"queries": ["查询1", "查询2", ...]}}

只返回JSON，不要其他解释。
"""
        else:
            prompt = f"""
As a professional search strategy expert, please generate 5 high-quality, targeted search queries based on the following research topic and user preferences.

Research Topic: {clarified_topic}

User Preferences:
{preferences}

Requirements:
1. Queries must be closely related to the research topic and user preferences.
2. The generated queries should be diverse to explore the topic from different angles.
3. Queries should be concise, clear, and suitable for search engines.

Please return the list of queries in JSON format:
{{"queries": ["query1", "query2", ...]}}

Return only JSON, no other explanations.
"""

        try:
            messages = [{"role": "user", "content": prompt}]
            response = self.llm_provider.invoke(prompt)
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict) and "queries" in result and isinstance(result["queries"], list):
                unique_queries = list(dict.fromkeys(result["queries"]))[:5]

                return unique_queries
        except Exception as e:
            self.logger.error(f"Targeted query generation failed: {e}")

        # Fallback to a simple query if LLM fails
        return [clarified_topic]
    
    def _should_continue_research(self, context: Dict[str, Any]) -> bool:
        """Determine if research should continue"""
        current_iteration = context.get("current_iteration", 0)
        max_iterations = context.get("max_iterations", self.max_research_loops)
        
        return current_iteration < max_iterations
    
    def _get_summary_content(self, summary: Any) -> str:
        """Safely get summary content"""
        if isinstance(summary, dict):
            return summary.get('summary', str(summary))
        elif isinstance(summary, str):
            return summary
        else:
            return str(summary)
    
    def _get_initial_research_context(self):
        """Returns the initial structure for the research context."""
        return {
            "topic": "",
            "objective": "",
            "current_iteration": 0,
            "max_iterations": self.max_research_loops,
            "search_history": [],
            "findings": [],
            "knowledge_gaps": [],
            "thinking_process": [],
            "citations": [],
            "research_summaries": [],
            "original_topic": "",
            "clarified_topic": "",
            "research_focus": [],
            "search_results": [],
            "generated_queries": [],
            "errors": []
        }

    def reset_research_context(self):
        """Reset research context"""
        self.research_context = self._get_initial_research_context()
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
    
    # ===== Advanced Mode Helper Methods =====
    
    def _execute_single_iteration(self, research_topic: str, iteration: int, 
                                accumulated_knowledge: Dict[str, Any], 
                                research_objective: str) -> Dict[str, Any]:
        """Execute a single iteration in advanced mode"""
        print(f"● Starting iteration {iteration}")
        
        # Generate queries based on accumulated knowledge and gaps
        queries = self._generate_iteration_queries(research_topic, iteration, accumulated_knowledge)
        
        # Execute search and summarization
        search_results = self._search_and_summarize(queries, self.research_context)
        
        # Update research context with thinking process
        if "thinking_process" not in self.research_context:
            self.research_context["thinking_process"] = []
        self.research_context["thinking_process"].extend(search_results.get("thinking_process", []))
        
        # Analyze results for this iteration
        analysis = self._analyze_iteration_results(search_results, accumulated_knowledge)
        
        # Calculate quality score for this iteration
        quality_score = self._calculate_iteration_quality(search_results, analysis)
        
        return {
            'iteration': iteration,
            'queries': queries,
            'search_results': search_results.get('results', []),
            'analysis': analysis,
            'quality_score': quality_score,
            'new_insights': analysis.get('insights', []),
            'knowledge_gaps': analysis.get('gaps', [])
        }
    
    def _generate_iteration_queries(self, research_topic: str, iteration: int, 
                                  accumulated_knowledge: Dict[str, Any]) -> List[str]:
        """Generate queries for current iteration based on accumulated knowledge"""
        if iteration == 1:
            # First iteration: broad exploration
            return self._generate_search_queries(research_topic, self.research_context)
        else:
            # Subsequent iterations: focus on knowledge gaps
            gaps = accumulated_knowledge.get('knowledge_gaps', [])
            if gaps:
                gap_queries = []
                for gap in gaps[:3]:  # Focus on top 3 gaps
                    gap_query = f"{research_topic} {gap}"
                    gap_queries.append(gap_query)
                return gap_queries
            else:
                # If no specific gaps, generate deeper queries
                return self._generate_deeper_queries(research_topic, accumulated_knowledge)
    
    def _generate_deeper_queries(self, research_topic: str, 
                               accumulated_knowledge: Dict[str, Any]) -> List[str]:
        """Generate deeper, more specific queries"""
        base_queries = [
            f"{research_topic} latest developments 2024",
            f"{research_topic} case studies examples",
            f"{research_topic} challenges limitations",
            f"{research_topic} future trends predictions"
        ]
        return base_queries[:2]  # Return 2 deeper queries
    
    def _analyze_iteration_results(self, search_results: Dict[str, Any], 
                                 accumulated_knowledge: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze results from current iteration"""
        results = search_results.get('results', [])
        
        # Extract new insights
        insights = []
        for result in results:
            if isinstance(result, dict) and 'snippet' in result:
                insights.append(result['snippet'][:200])  # First 200 chars as insight
        
        # Identify knowledge gaps (simplified)
        gaps = []
        if len(results) < 3:
            gaps.append("insufficient information coverage")
        
        # Check for diversity
        sources = set()
        for result in results:
            if isinstance(result, dict) and 'url' in result:
                domain = result['url'].split('/')[2] if '/' in result['url'] else result['url']
                sources.add(domain)
        
        if len(sources) < 2:
            gaps.append("limited source diversity")
        
        return {
            'insights': insights,
            'gaps': gaps,
            'source_count': len(sources),
            'result_count': len(results)
        }
    
    def _calculate_iteration_quality(self, search_results: Dict[str, Any], 
                                   analysis: Dict[str, Any]) -> float:
        """Calculate quality score for current iteration"""
        results = search_results.get('results', [])
        
        # Base score from result count
        result_score = min(len(results) / 5.0, 1.0)  # Max score when 5+ results
        
        # Source diversity score
        source_score = min(analysis.get('source_count', 0) / 3.0, 1.0)  # Max score when 3+ sources
        
        # Content quality score (simplified)
        content_score = 0.8 if analysis.get('insights') else 0.3
        
        # Weighted average
        quality_score = (result_score * 0.4 + source_score * 0.3 + content_score * 0.3)
        
        return round(quality_score, 2)
    
    def _perform_iteration_reflection(self, iteration: int, iteration_result: Dict[str, Any], 
                                    accumulated_knowledge: Dict[str, Any]) -> Dict[str, Any]:
        """Perform reflection analysis for current iteration"""
        quality_score = iteration_result.get('quality_score', 0.0)
        gaps = iteration_result.get('knowledge_gaps', [])
        
        # Determine next strategy based on current results
        if quality_score >= 0.8:
            next_strategy = "maintain_current_approach"
        elif quality_score >= 0.6:
            next_strategy = "expand_search_scope"
        else:
            next_strategy = "change_search_strategy"
        
        return {
            'iteration': iteration,
            'quality_assessment': quality_score,
            'identified_gaps': gaps,
            'next_strategy': next_strategy,
            'confidence_level': 'high' if quality_score >= 0.7 else 'medium' if quality_score >= 0.5 else 'low'
        }
    
    def _check_advanced_termination(self, iteration: int, iteration_result: Dict[str, Any], 
                                  quality_threshold: float, max_iterations: int) -> tuple:
        """Check if advanced mode should terminate"""
        # Check max iterations
        if iteration >= max_iterations:
            return True, "Maximum iterations reached"
        
        # Check quality threshold
        quality_score = iteration_result.get('quality_score', 0.0)
        if quality_score >= quality_threshold:
            return True, f"Quality threshold ({quality_threshold}) achieved"
        
        # Check if no new information is being found
        if iteration > 1 and len(iteration_result.get('search_results', [])) == 0:
            return True, "No new information found"
        
        return False, ""
    
    def _adjust_next_iteration_strategy(self, reflection: Dict[str, Any], 
                                      accumulated_knowledge: Dict[str, Any]) -> None:
        """Adjust strategy for next iteration based on reflection"""
        strategy = reflection.get('next_strategy', 'maintain_current_approach')
        
        if strategy == "expand_search_scope":
            print("● Strategy: Expanding search scope for next iteration")
        elif strategy == "change_search_strategy":
            print("● Strategy: Changing search approach for next iteration")
        else:
            print("● Strategy: Maintaining current approach")
    
    def _update_accumulated_knowledge(self, accumulated_knowledge: Dict[str, Any], 
                                    iteration_result: Dict[str, Any]) -> None:
        """Update accumulated knowledge with iteration results"""
        # Add new insights
        if 'insights' not in accumulated_knowledge:
            accumulated_knowledge['insights'] = []
        accumulated_knowledge['insights'].extend(iteration_result.get('new_insights', []))
        
        # Update knowledge gaps
        accumulated_knowledge['knowledge_gaps'] = iteration_result.get('knowledge_gaps', [])
        
        # Track quality progression
        if 'quality_scores' not in accumulated_knowledge:
            accumulated_knowledge['quality_scores'] = []
        accumulated_knowledge['quality_scores'].append(iteration_result.get('quality_score', 0.0))
    
    def _generate_advanced_final_report(self, research_topic: str, all_iterations: List[Dict[str, Any]], 
                                      accumulated_knowledge: Dict[str, Any], 
                                      total_search_results: List[Any]) -> str:
        """Generate final report for advanced mode"""
        report_lines = [
            f"# Advanced Research Report: {research_topic}",
            f"\n## Research Summary",
            f"- Total iterations: {len(all_iterations)}",
            f"- Total search results: {len(total_search_results)}",
            f"- Final quality score: {accumulated_knowledge.get('quality_scores', [0])[-1] if accumulated_knowledge.get('quality_scores') else 0}",
            f"\n## Key Insights"
        ]
        
        # Add insights from all iterations
        insights = accumulated_knowledge.get('insights', [])
        for i, insight in enumerate(insights[:10], 1):  # Top 10 insights
            report_lines.append(f"{i}. {insight}")
        
        # Add iteration summary
        report_lines.append(f"\n## Iteration Summary")
        for iteration in all_iterations:
            iteration_num = iteration.get('iteration', 0)
            quality = iteration.get('quality_score', 0.0)
            result_count = len(iteration.get('search_results', []))
            report_lines.append(f"- Iteration {iteration_num}: Quality {quality}, {result_count} results")
        
        return "\n".join(report_lines)
    
    def _perform_search_analysis_thinking(self, query: str, search_results: List[Dict], context: Dict[str, Any]) -> Dict[str, Any]:
        """Perform real LLM-based analysis of search results"""
        try:
            # Build search results summary for analysis
            results_summary = ""
            for i, result in enumerate(search_results, 1):
                # for i, result in enumerate(search_results[:3], 1):  # Analyze top 3 results
                title = result.get('title', 'No title')
                content = result.get('content', '') or result.get('summary', '')
                url = result.get('url', '')
                
                results_summary += f"{i}. {title}\n"
                if content:
                    results_summary += f"   Content: {content[:200]}...\n"
                if url:
                    results_summary += f"   URL: {url}\n"
                results_summary += "\n"
            
            # Get existing knowledge context
            research_topic = context.get("topic", "")
            existing_insights = context.get("thinking_insights", [])
            knowledge_gaps = context.get("knowledge_gaps", [])
            
            # Detect language for appropriate prompt
            language = self._detect_language(research_topic)
            
            if language == "zh":
                analysis_prompt = f"""
作为专业的研究分析专家，请分析以下搜索结果并提供深入的思考过程。

研究主题：{research_topic}
搜索查询：{query}

搜索结果：
{results_summary}

已有见解：
{chr(10).join([f"- {insight}" for insight in existing_insights[-3:]]) if existing_insights else "无"}

当前知识缺口：
{chr(10).join([f"- {gap}" for gap in knowledge_gaps[-3:]]) if knowledge_gaps else "无"}

请提供：
1. 对这些搜索结果的分析思考过程（简洁明了）
2. 从结果中提取的关键见解
3. 识别出的新的知识缺口或需要进一步探索的方向

请以JSON格式返回：
{{
  "thinking": "你的分析思考过程",
  "insights": ["见解1", "见解2", "见解3"],
  "knowledge_gaps": ["缺口1", "缺口2"]
}}

重要：只返回有效的JSON格式，不要添加任何其他文字说明。
"""
            else:
                analysis_prompt = f"""
As a professional research analysis expert, please analyze the following search results and provide in-depth thinking process.

Research Topic: {research_topic}
Search Query: {query}

Search Results:
{results_summary}

Existing Insights:
{chr(10).join([f"- {insight}" for insight in existing_insights[-3:]]) if existing_insights else "None"}

Current Knowledge Gaps:
{chr(10).join([f"- {gap}" for gap in knowledge_gaps[-3:]]) if knowledge_gaps else "None"}

Please provide:
1. Analysis thinking process of these search results (concise and clear)
2. Key insights extracted from the results
3. Identified new knowledge gaps or directions for further exploration

Please return in JSON format:
{{
  "thinking": "Your analysis thinking process",
  "insights": ["insight1", "insight2", "insight3"],
  "knowledge_gaps": ["gap1", "gap2"]
}}

IMPORTANT: Return only valid JSON format, do not add any other text explanations.
"""
            
            # Call LLM for analysis
            messages = [{"role": "user", "content": analysis_prompt}]
            response = self.llm_provider.invoke(analysis_prompt)
            
            # Parse LLM response
            result = self._safe_json_parse(response.content)
            
            if result and isinstance(result, dict):
                # Validate required fields
                thinking = result.get("thinking", f"Analyzed {len(search_results)} search results for '{query}'")
                insights = result.get("insights", [])
                new_gaps = result.get("knowledge_gaps", [])
                
                # Update context with new knowledge gaps
                if new_gaps:
                    if "knowledge_gaps" not in context:
                        context["knowledge_gaps"] = []
                    context["knowledge_gaps"].extend(new_gaps)
                
                return {
                    "thinking": thinking,
                    "insights": insights,
                    "knowledge_gaps": new_gaps
                }
            else:
                # Fallback if JSON parsing fails
                return {
                    "thinking": f"Analyzed {len(search_results)} search results for '{query}': Found relevant sources, extracting key insights",
                    "insights": [f"Search results for {query} provide valuable information"],
                    "knowledge_gaps": []
                }
                
        except Exception as e:
            self.logger.error(f"LLM thinking analysis failed: {e}")
            # Fallback to simple analysis
            return {
                "thinking": f"Analyzed {len(search_results)} search results for '{query}': Found {len(search_results)} relevant sources",
                "insights": [f"Search results for {query} provide information on the topic"],
                "knowledge_gaps": []
            }


# Usage example
if __name__ == "__main__":
    # Example configuration
    config = {
        "llm_provider": "openai",
        "api_key": "your-api-key",
        "search_engine": "mock"
    }
    
    # Initialize LLM provider
    # llm_provider = BaseLLMProvider.from_config(config)  # This would need proper LLM provider initialization
    llm_provider = None  # Placeholder - needs actual LLM provider
    
    # Create workflows in different modes
    # NOTE: This example code is commented out because it requires proper LLM provider initialization
    
    # Basic mode
    # basic_workflow = UnifiedResearchWorkflow(
    #     llm_provider=llm_provider,
    #     mode=WorkflowMode.BASIC,
    #     max_research_loops=3,
    #     search_engine="mock"
    # )
    
    # Interactive mode
    # interactive_workflow = UnifiedResearchWorkflow(
    #     llm_provider=llm_provider,
    #     mode=WorkflowMode.INTERACTIVE,
    #     max_research_loops=3,
    #     search_engine="mock"
    # )
    
    # Advanced mode
    # advanced_workflow = UnifiedResearchWorkflow(
    #     llm_provider=llm_provider,
    #     mode=WorkflowMode.ADVANCED,
    #     max_research_loops=5,
    #     search_engine="mock"
    # )
    
    # Execute research
    # result = basic_workflow.execute("The development trends of artificial intelligence")
    # print(f"Research results: {result}")