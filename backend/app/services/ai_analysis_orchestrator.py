from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.services.analysis_validator import AnalysisValidator, ValidationReport
from app.services.fix_task_router import FixTaskRouter


class AnalysisMode(str, Enum):
    DEFAULT = "default"
    SUBAGENTS = "subagents"
    CONTEXTUAL = "contextual"


class AssistantContext(BaseModel):
    page: str | None = None
    route: str | None = None
    title: str | None = None
    module: str | None = None
    summary: str | None = None
    selection: dict[str, Any] = Field(default_factory=dict)
    filters: dict[str, Any] = Field(default_factory=dict)


class OrchestratorPromptBundle(BaseModel):
    system_prompt: str
    messages: list[dict[str, str]] = Field(default_factory=list)
    context_summary: str | None = None
    use_orchestration: bool = False


class AiAnalysisOrchestrator:
    def __init__(
        self,
        validator: AnalysisValidator | None = None,
        fix_router: FixTaskRouter | None = None,
    ):
        self.validator = validator or AnalysisValidator()
        self.fix_router = fix_router or FixTaskRouter()

    def should_use_orchestration(
        self,
        context: AssistantContext | None,
        analysis_mode: str | AnalysisMode | None,
    ) -> bool:
        if isinstance(analysis_mode, AnalysisMode):
            return analysis_mode in {AnalysisMode.SUBAGENTS, AnalysisMode.CONTEXTUAL}

        if isinstance(analysis_mode, str):
            normalized_mode = analysis_mode.strip().lower()
            if normalized_mode in {AnalysisMode.SUBAGENTS.value, AnalysisMode.CONTEXTUAL.value}:
                return True

        return context is not None and bool(self.summarize_context(context))

    def prepare_messages(
        self,
        *,
        system_prompt_template: str,
        tools_description: str,
        history: list[Any],
        message: str,
        context: AssistantContext | None = None,
        analysis_mode: str | AnalysisMode | None = None,
    ) -> OrchestratorPromptBundle:
        context_summary = self.summarize_context(context)
        use_orchestration = self.should_use_orchestration(context, analysis_mode)
        system_prompt = system_prompt_template.format(tools_description=tools_description)

        if use_orchestration:
            system_prompt = (
                f"{system_prompt}\n\n"
                "Subagent workflow:\n"
                "- Main agent: own the final answer and tool decisions.\n"
                "- Scout: inspect the active page context before answering.\n"
                "- Verifier: check the draft against the user question and evidence.\n"
                "- Fix agent: revise the draft if validation fails.\n"
                "Keep this workflow internal and answer the user in natural Chinese."
            )

            if context_summary:
                system_prompt = (
                    f"{system_prompt}\n"
                    "Current page context:\n"
                    f"{context_summary}\n"
                    "If the question is related to the active page, anchor the answer to this context.\n"
                )

        messages = [{"role": "system", "content": system_prompt}]
        for item in history[-10:]:
            messages.append({"role": item.role, "content": item.content})

        user_content = message
        if use_orchestration and context_summary:
            user_content = f"{message}\n\n[Current page context]\n{context_summary}"

        messages.append({"role": "user", "content": user_content})

        return OrchestratorPromptBundle(
            system_prompt=system_prompt,
            messages=messages,
            context_summary=context_summary,
            use_orchestration=use_orchestration,
        )

    def build_tool_result_follow_up(
        self,
        *,
        tool_name: str,
        tool_result: str,
        context_summary: str | None = None,
    ) -> str:
        context_block = f"\nCurrent page context:\n{context_summary}\n" if context_summary else ""
        return (
            f"Tool {tool_name} returned the following result:\n\n{tool_result}\n"
            f"{context_block}\n"
            "Please answer the user in concise natural Chinese. Lead with the conclusion, then add key support. "
            "Do not output JSON or hidden reasoning. "
            "If the user asked for a list, output the full list with line breaks instead of summarizing. "
            "Do not tell the user to ask again for the full version. "
            "End with one line: 完整性提示：是/否 + reason."
        )

    def validate_reply(
        self,
        *,
        user_message: str,
        reply: str,
        tool_name: str | None = None,
        tool_result: str | None = None,
        context_summary: str | None = None,
    ) -> ValidationReport:
        return self.validator.validate(
            user_message=user_message,
            reply=reply,
            tool_name=tool_name,
            tool_result=tool_result,
            context_summary=context_summary,
        )

    def build_repair_prompt(
        self,
        *,
        original_question: str,
        draft_reply: str,
        validation_report: ValidationReport,
    ) -> str:
        return self.fix_router.build_revision_prompt(
            original_question=original_question,
            draft_reply=draft_reply,
            validation_report=validation_report,
        )

    def summarize_context(self, context: AssistantContext | None) -> str | None:
        if context is None:
            return None

        lines: list[str] = []
        if context.page:
            lines.append(f"- page: {context.page}")
        if context.route:
            lines.append(f"- route: {context.route}")
        if context.title:
            lines.append(f"- title: {context.title}")
        if context.module:
            lines.append(f"- module: {context.module}")
        if context.summary:
            lines.append(f"- summary: {context.summary}")
        if context.selection:
            lines.append(f"- selection: {self._format_mapping(context.selection)}")
        if context.filters:
            lines.append(f"- filters: {self._format_mapping(context.filters)}")

        return "\n".join(lines) if lines else None

    def _format_mapping(self, payload: dict[str, Any]) -> str:
        items = [f"{key}={value}" for key, value in payload.items() if value is not None]
        return ", ".join(items) if items else "none"
