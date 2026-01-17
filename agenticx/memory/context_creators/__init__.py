"""
Context Creators for Memory Management

This module provides context creation strategies inspired by CAMEL-AI's context creators,
including ScoreBasedContextCreator for intelligent message selection and automatic summarization.
"""

from .score_based import ScoreBasedContextCreator

__all__ = ["ScoreBasedContextCreator"]
