"""
GuideRails: Post-output validation and correction pipeline.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Protocol, Union
import logging

from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger(__name__)


class GuideRailsAction(str, Enum):
    """GuideRails decision outcome."""

    PASS = "pass"
    MODIFY = "modify"
    ABORT = "abort"


class GuideRailsResult(BaseModel):
    """Result from a single GuideRails validator."""

    action: GuideRailsAction = GuideRailsAction.PASS
    output: Any = None
    reason: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @classmethod
    def allow(cls, output: Any = None, reason: Optional[str] = None) -> "GuideRailsResult":
        return cls(action=GuideRailsAction.PASS, output=output, reason=reason)

    @classmethod
    def modify(cls, output: Any, reason: Optional[str] = None) -> "GuideRailsResult":
        return cls(action=GuideRailsAction.MODIFY, output=output, reason=reason)

    @classmethod
    def abort(cls, reason: Optional[str] = None) -> "GuideRailsResult":
        return cls(action=GuideRailsAction.ABORT, output=None, reason=reason)


class GuideRailsConfig(BaseModel):
    """Configuration for GuideRails execution."""

    enabled: bool = Field(default=True, description="Whether GuideRails is enabled.")
    allow_modify: bool = Field(default=True, description="Allow output modifications.")
    stop_on_first_abort: bool = Field(default=True, description="Stop when an abort is returned.")
    max_modifications: int = Field(default=5, description="Maximum number of modifications allowed.")


class GuideRailsContext(BaseModel):
    """Context passed to GuideRails validators."""

    agent_id: Optional[str] = Field(default=None, description="Agent identifier.")
    task_id: Optional[str] = Field(default=None, description="Task identifier.")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional context.")


class GuideRailsAbortError(RuntimeError):
    """Raised when GuideRails aborts the output."""


class GuideRailsRunResult(BaseModel):
    """Result of running a GuideRails chain."""

    action: GuideRailsAction
    output: Any
    reasons: List[str] = Field(default_factory=list)
    validator_count: int = 0
    modified: bool = False

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def summary(self) -> str:
        if not self.reasons:
            return f"GuideRails action={self.action.value}"
        return f"GuideRails action={self.action.value}; reasons={'; '.join(self.reasons)}"


class GuideRailsValidator(Protocol):
    """Protocol for GuideRails validators."""

    def __call__(self, output: Any, context: GuideRailsContext) -> Optional[GuideRailsResult]:
        ...


class BaseGuideRailsValidator(ABC):
    """Base class for GuideRails validators."""

    @abstractmethod
    def validate(self, output: Any, context: GuideRailsContext) -> Optional[GuideRailsResult]:
        raise NotImplementedError


ValidatorType = Union[GuideRailsValidator, BaseGuideRailsValidator, Callable[[Any, GuideRailsContext], Any]]


class GuideRails:
    """Runs a chain of output validators for an agent."""

    def __init__(
        self,
        validators: Optional[List[ValidatorType]] = None,
        config: Optional[GuideRailsConfig] = None,
    ) -> None:
        self.validators = validators or []
        self.config = config or GuideRailsConfig()

    def run(
        self,
        output: Any,
        context: GuideRailsContext,
        config: Optional[GuideRailsConfig] = None,
    ) -> GuideRailsRunResult:
        active_config = config or self.config
        if not active_config.enabled or not self.validators:
            return GuideRailsRunResult(
                action=GuideRailsAction.PASS,
                output=output,
                validator_count=len(self.validators),
            )

        current_output = output
        reasons: List[str] = []
        modified = False
        modifications = 0

        for validator in self.validators:
            result = self._execute_validator(validator, current_output, context)
            if result is None:
                continue

            if result.reason:
                reasons.append(result.reason)

            if result.action == GuideRailsAction.MODIFY:
                if not active_config.allow_modify:
                    return GuideRailsRunResult(
                        action=GuideRailsAction.ABORT,
                        output=current_output,
                        reasons=reasons,
                        validator_count=len(self.validators),
                        modified=modified,
                    )
                current_output = result.output if result.output is not None else current_output
                modified = True
                modifications += 1
                if modifications >= active_config.max_modifications:
                    logger.warning("GuideRails reached max_modifications=%s", active_config.max_modifications)
                    break

            if result.action == GuideRailsAction.ABORT:
                return GuideRailsRunResult(
                    action=GuideRailsAction.ABORT,
                    output=current_output,
                    reasons=reasons,
                    validator_count=len(self.validators),
                    modified=modified,
                )

        final_action = GuideRailsAction.MODIFY if modified else GuideRailsAction.PASS
        return GuideRailsRunResult(
            action=final_action,
            output=current_output,
            reasons=reasons,
            validator_count=len(self.validators),
            modified=modified,
        )

    def _execute_validator(
        self,
        validator: ValidatorType,
        output: Any,
        context: GuideRailsContext,
    ) -> Optional[GuideRailsResult]:
        if isinstance(validator, BaseGuideRailsValidator):
            result = validator.validate(output, context)
        else:
            result = validator(output, context)

        if result is None:
            return None
        if isinstance(result, GuideRailsResult):
            return result
        if isinstance(result, bool):
            return GuideRailsResult.allow(output) if result else GuideRailsResult.abort()

        raise TypeError("GuideRails validator must return GuideRailsResult, bool, or None.")


__all__ = [
    "GuideRailsAction",
    "GuideRailsResult",
    "GuideRailsConfig",
    "GuideRailsContext",
    "GuideRailsAbortError",
    "GuideRailsRunResult",
    "GuideRailsValidator",
    "BaseGuideRailsValidator",
    "GuideRails",
]
