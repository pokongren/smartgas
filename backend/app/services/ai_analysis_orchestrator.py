from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.services.analysis_validator import AnalysisValidator, ValidationReport
from app.services.fix_task_router import FixTaskRouter

YUQIAN_STYLE_INSTRUCTION = (
    "Persona style requirement:\n"
    "Use a relaxed and witty 'Yu Qian' cross-talk tone in Chinese.\n"
    "Lead with the conclusion, then explain the reason in plain language.\n"
    "Keep one or two light punchlines only when suitable, and stay respectful.\n"
    "Never joke with safety facts, numbers, units, thresholds, or risk levels.\n"
    "Do not alter tool facts; keep the final line format: 完整性提示：是/否 + 原因."
)
YUQIAN_SKILL_PATH = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "yuqian-style" / "SKILL.md"
_YUQIAN_SKILL_HINT_CACHE: str | None = None


def _load_yuqian_skill_hint() -> str:
    global _YUQIAN_SKILL_HINT_CACHE
    if _YUQIAN_SKILL_HINT_CACHE is not None:
        return _YUQIAN_SKILL_HINT_CACHE
    try:
        text = YUQIAN_SKILL_PATH.read_text(encoding="utf-8")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        picked: list[str] = []
        for line in lines:
            if line.startswith("1. 先给结论") or line.startswith("2. 语气要") or line.startswith("4. 涉及安全"):
                picked.append(line)
        if picked:
            _YUQIAN_SKILL_HINT_CACHE = "Skill(yuqian-style)规则：" + "；".join(picked)
        else:
            _YUQIAN_SKILL_HINT_CACHE = "Skill(yuqian-style)规则：先结论后依据，口语化但保持严谨。"
    except Exception:
        _YUQIAN_SKILL_HINT_CACHE = "Skill(yuqian-style)规则：先结论后依据，口语化但保持严谨。"
    return _YUQIAN_SKILL_HINT_CACHE


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
        system_prompt = f"{system_prompt}\n\n{YUQIAN_STYLE_INSTRUCTION}\n{_load_yuqian_skill_hint()}\n"

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
            "Use the same Yu Qian style persona: relaxed, witty, and respectful. "
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
        prompt = self.fix_router.build_revision_prompt(
            original_question=original_question,
            draft_reply=draft_reply,
            validation_report=validation_report,
        )
        return (
            f"{prompt}\n\n"
            "Style guard:\n"
            "Keep the final answer in Yu Qian style Chinese: relaxed, witty, concise, and respectful.\n"
            "Do not change factual numbers, units, thresholds, or risk statements.\n"
        )

    def build_yuqian_rebuttal_prompt(
        self,
        *,
        original_question: str,
        candidate_reply: str,
        tool_name: str | None = None,
        tool_result: str | None = None,
        context_summary: str | None = None,
    ) -> str:
        context_block = f"\n页面上下文:\n{context_summary}\n" if context_summary else ""
        tool_block = ""
        if tool_name and tool_result:
            tool_block = f"\n已调用工具: {tool_name}\n工具结果:\n{tool_result}\n"
        return (
            "你现在扮演“辩驳子代理”，口吻保持于谦式：松弛、机灵、说人话，但必须尊重事实。\n"
            "任务：对候选答复做一轮抬杠式复核，专找最可能误导用户的点。\n"
            f"用户问题:\n{original_question}\n"
            f"{context_block}"
            f"{tool_block}"
            f"\n候选答复:\n{candidate_reply}\n\n"
            "输出要求（仅输出这三段）：\n"
            "1) 结论：这版答复最核心的问题是什么（没有问题就写“通过”）。\n"
            "2) 质疑点：最多3条，必须具体到事实、逻辑、完整性。\n"
            "3) 修正建议：给出可直接落地的改写建议。\n"
            "禁止改动工具事实、数字、单位、阈值、风险等级。"
        )

    def build_post_rebuttal_finalize_prompt(
        self,
        *,
        original_question: str,
        candidate_reply: str,
        rebuttal_reply: str,
    ) -> str:
        return (
            "你现在扮演“最终输出子代理”。\n"
            "请根据用户问题、候选答复和辩驳意见，产出最终答复。\n"
            "要求：先结论后说明，口吻为于谦式中文；允许轻微机灵，但不影响严谨性。\n"
            "若辩驳意见成立就修正；若不成立就说明为何保持原结论。\n"
            "如果用户要列表，必须给完整列表。\n"
            "末尾保留一行：完整性提示：是/否 + 原因。\n\n"
            f"用户问题:\n{original_question}\n\n"
            f"候选答复:\n{candidate_reply}\n\n"
            f"辩驳意见:\n{rebuttal_reply}\n"
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
