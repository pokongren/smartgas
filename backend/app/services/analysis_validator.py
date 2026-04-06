from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field


ValidationLevel = Literal["warning", "error"]


class ValidationIssue(BaseModel):
    code: str
    level: ValidationLevel
    message: str


class ValidationReport(BaseModel):
    passed: bool = True
    requires_revision: bool = False
    issues: list[ValidationIssue] = Field(default_factory=list)


class AnalysisValidator:
    """Validate assistant drafts before they are returned to the client."""

    def validate(
        self,
        *,
        user_message: str,
        reply: str,
        tool_name: str | None = None,
        tool_result: str | None = None,
        context_summary: str | None = None,
    ) -> ValidationReport:
        issues: list[ValidationIssue] = []
        content = (reply or "").strip()

        if not content:
            issues.append(
                ValidationIssue(
                    code="empty_reply",
                    level="error",
                    message="AI returned an empty reply.",
                )
            )

        if "<think>" in content or "</think>" in content:
            issues.append(
                ValidationIssue(
                    code="leaked_think_tags",
                    level="error",
                    message="Internal reasoning tags leaked into the reply.",
                )
            )

        if self._looks_like_tool_call(content):
            issues.append(
                ValidationIssue(
                    code="raw_tool_call",
                    level="error",
                    message="Reply still looks like a raw tool-call payload.",
                )
            )

        if tool_name and tool_result and len(content) < 12:
            issues.append(
                ValidationIssue(
                    code="tool_reply_too_short",
                    level="warning",
                    message="Reply after tool execution is too short to be useful.",
                )
            )

        if context_summary and user_message.strip() and len(content) < 4:
            issues.append(
                ValidationIssue(
                    code="context_reply_too_short",
                    level="warning",
                    message="Context-aware reply is unexpectedly short.",
                )
            )

        has_error = any(issue.level == "error" for issue in issues)
        return ValidationReport(
            passed=not has_error,
            requires_revision=has_error,
            issues=issues,
        )

    def _looks_like_tool_call(self, content: str) -> bool:
        if not content:
            return False

        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            payload = None

        if isinstance(payload, dict) and "tool" in payload:
            return True

        return '"tool"' in content and content.lstrip().startswith("{")
