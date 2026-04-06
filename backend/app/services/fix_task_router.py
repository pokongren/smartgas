from __future__ import annotations

from app.services.analysis_validator import ValidationReport


class FixTaskRouter:
    """Build a minimal repair prompt when validation fails."""

    def build_revision_prompt(
        self,
        *,
        original_question: str,
        draft_reply: str,
        validation_report: ValidationReport,
    ) -> str:
        issue_lines = [f"- {issue.code}: {issue.message}" for issue in validation_report.issues]
        issue_block = "\n".join(issue_lines) if issue_lines else "- draft did not pass validation"

        return (
            "Please revise the draft below and output the final user-facing Chinese answer only.\n"
            "Do not output JSON, do not output tool calls, and do not include <think> tags.\n\n"
            f"Original user question:\n{original_question}\n\n"
            f"Current draft:\n{draft_reply}\n\n"
            f"Issues to fix:\n{issue_block}\n\n"
            "Keep the valid conclusion, fill the missing parts, and return a concise but complete natural Chinese answer.\n"
            "If the user asked for a list, return the full list with line breaks.\n"
            "End with one line: 完整性提示：是/否 + reason."
        )
