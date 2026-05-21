"""
AI assistant chat router.
"""

from __future__ import annotations

import json
import logging
import os
import re
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session, scada_history_engine
from app.models import Pipeline, PipelineSystem, Station
from app.scada_models import ScadaHistory
from app.services.ai_analysis_orchestrator import AiAnalysisOrchestrator, AssistantContext
from app.services.ai_client import AiServiceError, ai_client
from app.services.ai_sim_evaluator import evaluate_simulation_result
from app.services.assistant_tools import build_tools_description, execute_tool
from app.services.raw_excel_ai_direct import (
    try_direct_count_reply as try_raw_excel_direct_count_reply,
    try_direct_entity_lookup as try_raw_excel_direct_entity_lookup,
    try_direct_list_reply as try_raw_excel_direct_list_reply,
)
from app.services.we1_result_snapshot_service import get_snapshot
from app.services.multi_source.orchestrator import multi_source_orchestrator
from app.mcp.tools import run_steady_sim

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-assistant", tags=["AI 对话助手"])
ai_analysis_orchestrator = AiAnalysisOrchestrator()

LUZHI_PILOT_STATION = "甪直分输站"
LUZHI_ANALYSIS_KEYWORDS = (
    "分析",
    "异常",
    "趋势",
    "建议",
    "诊断",
    "评估",
    "波动",
    "风险",
    "压力",
    "温度",
    "露点",
    "变化",
    "判断",
)

LUZHI_RISK_ORDER = {"正常": 0, "低": 1, "中": 2, "高": 3}
LUZHI_PILOT_ENV_KEY = "SMARTGAS_LUZHI_PILOT_ENABLED"
LUZHI_TRACE_PATH = Path(__file__).resolve().parents[2] / "data" / "ai_traces" / "luzhi_pilot_trace.jsonl"
DATA_ANALYSIS_ENTER_COMMAND = "/数据分析"
DATA_ANALYSIS_EXIT_COMMAND = "/退出数据分析"
COMMON_METRIC_TERM_CORRECTIONS = {
    "水路点": "水露点",
    "水漏点": "水露点",
    "水落点": "水露点",
    "水陆点": "水露点",
}
DEWPOINT_QUERY_KEYWORDS = ("水露点", "露点", "dewpoint", *COMMON_METRIC_TERM_CORRECTIONS.keys())
DEWPOINT_COMPARE_KEYWORDS = ("对比", "比较", "差异", "对照")
DATA_ANALYSIS_ENTER_PATTERN = re.compile(r"^\s*/数据分析(?:\s+(?P<payload>.+))?\s*$", re.IGNORECASE)
DATA_ANALYSIS_EXIT_PATTERN = re.compile(r"^\s*/退出数据分析\s*$", re.IGNORECASE)
SUBAGENT_ENTER_PATTERN = re.compile(r"^\s*/subagent(?:\s+.+)?\s*$", re.IGNORECASE)
SUBAGENT_EXIT_PATTERN = re.compile(r"^\s*/退出subagent\s*$", re.IGNORECASE)
MCP_DEMO_PATTERN = re.compile(r"^\s*/(?:mcp演示|mcpdemo|mcp-demo)(?:\s+.+)?\s*$", re.IGNORECASE)
STATION_PAIR_PATTERN = re.compile(
    r"(?P<left>[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)?)"
    r"(?:和|与|跟)"
    r"(?P<right>[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)?)"
)
STATION_SUFFIXES = ("分输联络站", "分输压气站", "分输清管站", "分输站", "压气站", "清管站", "站")

MULTI_STATION_COMPARE_KEYWORDS = ("对比", "比较", "差异", "对照", "横向", "对比分析")
PRESSURE_KEYWORDS = ("压力", "pressure", "MPa", "mpa")
TEMPERATURE_KEYWORDS = ("温度", "温层", "temperature")
HISTORY_CURVE_KEYWORDS = ("历史", "曲线", "趋势", "查询", "query", "trend", "history", "chart")
OPERATION_PROCEDURE_KEYWORDS = (
    "操作规程",
    "规程",
    "运行规程",
    "工艺规程",
    "作业",
    "操作",
    "步骤",
    "流程",
    "怎么做",
    "如何",
    "投产",
    "启输",
    "停输",
    "放空",
    "排污",
    "置换",
    "清管",
    "内检测",
    "阀门",
    "开阀",
    "关阀",
    "倒流程",
    "切换",
    "联锁",
    "ESD",
    "esd",
)


def _mentions_subagent(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    return "subagent" in compact or "专家组" in compact or "多agent" in compact or "多智能体" in compact


def _looks_like_operation_procedure_query(message: str) -> bool:
    text = str(message or "").strip()
    if not text:
        return False
    compact = re.sub(r"\s+", "", text)
    if "应急" in compact or "预案" in compact or "处置" in compact:
        return True
    if "规程" in compact:
        return True
    action_hit = any(keyword in compact for keyword in OPERATION_PROCEDURE_KEYWORDS)
    ask_hit = any(keyword in compact for keyword in ("怎么", "如何", "步骤", "流程", "注意", "要求", "风险", "禁止"))
    asset_hit = any(keyword in compact for keyword in ("站", "管线", "管道", "阀", "机组", "压缩机", "分输", "清管", "天然气"))
    return action_hit and (ask_hit or asset_hit)


def _detect_knowledge_doc_type(message: str) -> str:
    compact = re.sub(r"\s+", "", str(message or ""))
    if "应急" in compact or "预案" in compact or "处置" in compact:
        return "应急预案"
    return "操作规程"


def _detect_operation_action(message: str) -> str:
    compact = re.sub(r"\s+", "", str(message or ""))
    for action in ("失效", "放空", "排污", "置换", "清管", "投产", "启输", "停输", "切换", "阀门", "联锁", "ESD", "esd"):
        if action in compact:
            return "ESD" if action.lower() == "esd" else action
    return "操作"


def _extract_knowledge_sources(tool_result: str, limit: int = 4) -> list[str]:
    sources: list[str] = []
    for match in re.finditer(r"\d+\.\s*来源：(.+?)/(.*?)/\s*chunk\s*#([^\s，]+)", tool_result or ""):
        doc_type = match.group(1).strip()
        filename = match.group(2).strip()
        item = f"{doc_type} / {filename}"
        if item not in sources:
            sources.append(item)
        if len(sources) >= limit:
            break
    return sources


def _extract_knowledge_excerpts(tool_result: str) -> list[str]:
    excerpts: list[str] = []
    for match in re.finditer(r"摘要：(.+?)(?=\n\d+\.\s*来源：|\n\n【回答要求】|$)", tool_result or "", flags=re.S):
        excerpt = re.sub(r"\s+", " ", match.group(1)).strip()
        if excerpt:
            excerpts.append(excerpt)
    return excerpts


def _extract_action_steps_from_excerpts(action: str, excerpts: list[str]) -> list[str]:
    joined = " ".join(excerpts)
    if not joined:
        return []

    if action == "失效" and ("管网关键站场失效" in joined or "站场失效" in joined or "功能失效" in joined):
        return [
            "信息接报后做好事件记录，确认管道或站场受影响程度。",
            "通过 SCADA 发现站场进气、增压、转供等功能失效或全站失效时，立即联系现场确认情况。",
            "向值班调度长汇报事件相关情况。",
            "如果关键站场 ESD 触发，要求站场排查触发原因；无异常事件时尽快恢复工艺流程。",
            "如果发生泄漏、火灾、爆炸，转入管道或站场泄漏、火灾、爆炸应急处置卡。",
            "如果接气、转供站场短时间无法恢复，调整上下游运行并匹配管道输量；压气站短时间无法恢复时，通知站场导通越站流程，并根据工况启动上下游可替代压气站。",
        ]

    section = ""
    if action and action != "操作":
        pattern = rf"(?:\d+(?:\.\d+)?\s*)?{re.escape(action)}\s*(.*?)(?=\s\d+(?:\.\d+)?\s*[\u4e00-\u9fa5]{{2,}}|\s[ABC]\.\d|\s附\s*录|$)"
        match = re.search(pattern, joined)
        if match:
            section = match.group(1)
    source_text = section or joined
    raw_items = re.findall(r"（\d+）\s*(.*?)(?=（\d+）|$)", source_text)
    steps: list[str] = []
    for item in raw_items:
        cleaned = re.sub(r"\s+", " ", item).strip(" 。；;")
        if not cleaned:
            continue
        if action != "操作" and action not in cleaned and not steps and action not in source_text[:80]:
            continue
        steps.append(cleaned + "。")
        if len(steps) >= 6:
            break

    if steps:
        return steps

    sentences = re.split(r"[。；;]", source_text)
    for sentence in sentences:
        cleaned = re.sub(r"\s+", " ", sentence).strip()
        if not cleaned:
            continue
        if action == "操作" or action in cleaned:
            steps.append(cleaned + "。")
        if len(steps) >= 5:
            break
    return steps


def _format_operation_procedure_result(message: str, tool_result: str, doc_type: str) -> str:
    action = _detect_operation_action(message)
    sources = _extract_knowledge_sources(tool_result)
    excerpts = _extract_knowledge_excerpts(tool_result)
    steps = _extract_action_steps_from_excerpts(action, excerpts)

    if not steps and "放空" in message:
        steps = [
            "放空操作应经中心调度同意。",
            "放空时先全开球阀，再用节流截止放空阀或旋塞阀控制放空流量。",
            "放空结束后，先关闭节流截止放空阀或旋塞阀，再关闭球阀。",
            "具备热放空条件的站场宜采用热放空。",
            "除自动放空逻辑测试等特殊情况外，自动放空阀上游及安全阀上下游的手动球阀应保持常开。",
        ]

    if not steps:
        steps = ["已命中规程证据，但片段里没有形成可直接照搬的完整操作步骤；需要结合具体站场、作业票和调度指令复核。"]

    risk_items = [
        "没有中心调度同意、现场作业票或明确站场边界时，不能把这里的规程摘要当成直接操作指令。",
    ]
    if action == "失效":
        risk_items.extend([
            "“永清站”没有在命中片段中作为专站预案出现，本次依据是“管网关键站场失效应急处置卡”，属于通用处置口径。",
            "如果现场伴随泄漏、火灾、爆炸，不能只按“站场失效”处理，应切换到泄漏、火灾、爆炸应急处置卡。",
            "压气站失效和接气/转供站失效的调度动作不同，必须先确认永清站在当前工况里的功能角色。",
        ])
    if action == "放空":
        risk_items.extend([
            "放空流量需要通过节流截止放空阀或旋塞阀控制，不能简单理解成阀门全开后不管。",
            "自动放空阀、安全阀相关手动球阀的常开要求不能随意改动，除非属于规程允许的特殊测试场景。",
        ])
    if any("ESD" in excerpt or "SHUT DOWN" in excerpt for excerpt in excerpts):
        risk_items.append("命中片段包含 ESD/SHUT DOWN 保护定值，联锁和停车相关动作必须按站控/调度权限执行。")

    pending_items = [
        "确认具体站场、管段和作业类型是否就是本次问题对象。",
        "确认现场阀门状态、压力边界、放空/排污设施可用状态。",
        "确认是否已有调度指令、操作票、监护和警戒安排。",
    ]
    if action == "失效":
        pending_items = [
            "确认永清站当前是压气、接气、转供还是联络节点，按实际功能选择处置分支。",
            "确认是否为 ESD 触发、进气/增压/转供功能失效，还是全站失效。",
            "确认上下游压力、流量、可替代压气站和可调配路径。",
            "确认是否伴随泄漏、火灾、爆炸等升级事件。",
        ]

    source_lines = sources or ["已命中规程库，但来源字段解析不完整，需回看知识库证据。"]
    reply = [
        "结论：",
        f"已命中{doc_type}证据，可以按规程做“{action}”类回答；但这只能作为规程摘要，不能替代现场操作票和调度指令。",
        "",
        "适用场景：",
        f"适用于用户提到的“{message}”这类规程查询。若实际对象不是命中文件覆盖的管线/站场，只能作为相近规程参考。",
        "",
        "操作要点：",
        *[f"{idx}. {step}" for idx, step in enumerate(steps[:6], 1)],
        "",
        "风险与禁止项：",
        *[f"- {item}" for item in risk_items],
        "",
        "待确认项：",
        *[f"- {item}" for item in pending_items],
        "",
        "来源：",
        *[f"- {item}" for item in source_lines],
    ]
    return "\n".join(reply)


def _normalize_common_metric_terms(text: str) -> str:
    normalized = str(text or "")
    for wrong, right in COMMON_METRIC_TERM_CORRECTIONS.items():
        normalized = normalized.replace(wrong, right)
    return normalized


def _build_metric_term_correction_note(raw_text: str, normalized_text: str) -> str:
    if raw_text == normalized_text:
        return ""
    corrected_terms = [
        f"“{wrong}”应为“{right}”"
        for wrong, right in COMMON_METRIC_TERM_CORRECTIONS.items()
        if wrong in str(raw_text or "")
    ]
    if not corrected_terms:
        return ""
    return f"术语纠错：已识别常见错字，{'、'.join(corrected_terms)}，本次按“水露点”处理。"


CANONICAL_STATION_SUFFIXES = (
    "\u5206\u8f93\u8054\u7edc\u7ad9",
    "\u5206\u8f93\u538b\u6c14\u7ad9",
    "\u5206\u8f93\u6e05\u7ba1\u7ad9",
    "\u5206\u8f93\u7ad9",
    "\u538b\u6c14\u7ad9",
    "\u6e05\u7ba1\u7ad9",
    "\u67a2\u7ebd\u7ad9",
    "\u67a2\u7ebd",
    "\u7ad9",
)
CANONICAL_PIPELINE_PREFIXES = (
    "\u897f\u6c14\u4e1c\u8f93\u4e00\u7ebf",
    "\u897f\u6c14\u4e1c\u8f93\u4e8c\u7ebf",
    "\u897f\u6c14\u4e1c\u8f93",
    "\u897f\u4e00\u7ebf",
    "\u897f\u4e8c\u7ebf",
    "\u4e2d\u4fc4",
    "\u4e2d\u7f05",
    "\u4e2d\u4e9a",
    "\u5ddd\u6c14\u4e1c\u9001",
    "\u9655\u4eac",
    "\u5fe0\u6b66",
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    context: AssistantContext | None = None
    analysis_mode: str | None = None


class ToolCallInfo(BaseModel):
    tool_name: str
    tool_args: dict
    tool_result: str


class ChatResponse(BaseModel):
    reply: str
    tool_calls: list[ToolCallInfo] = Field(default_factory=list)
    retrieval_log: list[str] = Field(default_factory=list)


class SimulationEvaluationRequest(BaseModel):
    overlay: dict[str, Any] | None = None
    baseline_overlay: dict[str, Any] | None = None
    run_id: str | None = None
    pilot_id: str | None = None
    baseline_run_id: str | None = None


SYSTEM_PROMPT = """你是 SmartGas Grid 的智能调度助手，既懂天然气管网业务，也会像一个靠谱同事那样和用户交流。
回复要求：
1. 全程使用自然、口语化但专业的中文，优先说人话，少用官话、套话、模板腔。
2. 先直接回答用户最关心的问题，再补充必要依据；不要一上来长篇铺垫。
3. 如果问题简单，也不要只给一句过短结论；要把当前能确认的关键信息一次说完整。
4. 除非用户明确要求，不要自我介绍，不要反复说“作为 AI 助手”。
5. 能明确判断用户意图时，直接执行或回答，不要机械追问。
6. 如果需要调用工具，请优先输出工具调用 JSON；拿到工具结果后，用自然、友好的语言总结，不要把原始推理过程暴露给用户。
7. 如果信息不足，直接指出缺什么；如果结论有前提，也要说清楚，不要装得很确定。
8. 用户明确要“列表/清单/全部/所有”时，直接给完整列表，用换行列表展示，不要只摘前几条，也不要说“要完整列表可以告诉我”。
9. 回答末尾补一行“完整性提示：是/否”，明确说明这次回答是不是完整回答；如果不是，要直接说原因。
表达风格：
- 多用短句，少用公文式表达。
- 尽量贴近用户原话风格；用户随意一点，你也可以自然一点。
- 避免“您好，您可以……”“根据您提供的信息……”这类生硬客服腔。
- 结尾只在合适时补一句下一步建议，不要每次都问候或反问。
{tools_description}
"""

YUQIAN_STYLE_PROMPT = """
额外人格要求：
1. 统一使用“于谦式”说话风格：松弛、机灵、接地气，但不油腻、不冒犯。
2. 先给结论，再给依据；能短就短，别端着。
3. 可以有一两句轻微包袱，但安全结论、数字、阈值、单位必须严谨，不能拿来开玩笑。
4. 如果用户要清单，必须给完整清单，不打马虎眼。
"""


def _apply_yuqian_style(reply: str) -> str:
    text = (reply or "").strip()
    if not text:
        return reply

    # 长文本或结构化输出不再强行加前缀，避免“模板腔”干扰阅读。
    if len(text) >= 90 or text.count("\n") >= 2 or "|" in text:
        return text

    prefixes = (
        "要我说，先给准话：",
        "咱先把结论放这儿：",
    )
    if text.startswith(prefixes):
        return text

    return f"{prefixes[0]}{text}"


def _is_raw_excel_negative_lookup(reply: str | None) -> bool:
    text = (reply or "").strip()
    return "当前没找到" in text and "AI 索引库" in text


@router.post("/chat")
async def chat(
    request: ChatRequest,
    session: Session = Depends(get_session),
):
    msg_clean = request.message.strip()
    if not msg_clean:
        raise HTTPException(status_code=400, detail="消息不能为空")

    greetings = {"你好", "您好", "hello", "hi", "在吗", "早上好", "中午好", "下午好", "晚上好"}
    if msg_clean.lower() in greetings:

        async def quick_gen():
            reply_text = _apply_yuqian_style("你好，我在。你直接说想查什么、分析什么，或者哪里看着不对，我帮你一起看。")
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"

        return StreamingResponse(quick_gen(), media_type="text/event-stream")

    if SUBAGENT_ENTER_PATTERN.match(msg_clean):

        async def subagent_enter_gen():
            reply_text = _apply_yuqian_style(
                _append_completeness_hint(
                    "已进入 SubAgent 协作模式。推荐先跑“中卫-靖边限流”“中卫单站风险”或“甪直露点趋势”。统计、列举这类确定性查询会自动直出，不硬走完整专家组。",
                    msg_clean,
                    is_complete=True,
                    reason="已执行 subagent 进入命令。",
                )
            )
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"

        return StreamingResponse(subagent_enter_gen(), media_type="text/event-stream")

    if SUBAGENT_EXIT_PATTERN.match(msg_clean):

        async def subagent_exit_gen():
            reply_text = _apply_yuqian_style(
                _append_completeness_hint(
                    "已退出 SubAgent 协作模式，回到常规问答。",
                    msg_clean,
                    is_complete=True,
                    reason="已执行 subagent 退出命令。",
                )
            )
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"

        return StreamingResponse(subagent_exit_gen(), media_type="text/event-stream")

    if MCP_DEMO_PATTERN.match(msg_clean):

        async def mcp_demo_gen():
            yield "[TOOL] mcp.run_steady_sim\n"
            try:
                tool_result = await asyncio.to_thread(
                    run_steady_sim,
                    "zhongwei_shanghai_baihe",
                    "steady_base",
                    "",
                )
                reply_text = "\n".join([
                    "MCP 演示调用完成。",
                    "",
                    "这次不是让前端直接跑固定流程，而是调用后端已注册的 MCP 工具：`run_steady_sim`。",
                    "",
                    "调用参数：",
                    "- pilot_id: zhongwei_shanghai_baihe",
                    "- scenario_id: steady_base",
                    "",
                    "工具返回：",
                    tool_result,
                    "",
                    "答辩口径：业务 API 负责稳定页面流程，MCP 负责把仿真能力封装成 AI 可发现、可调用、可复用的标准工具。",
                    "",
                    "完整性提示：是。本次已完成一次 MCP 工具调用闭环。",
                ])
            except Exception as exc:
                logger.exception("MCP demo failed")
                reply_text = "\n".join([
                    "MCP 演示调用失败。",
                    "",
                    f"错误：{exc}",
                    "",
                    "完整性提示：否。MCP 工具已触发，但工具执行阶段报错，需要检查仿真种子或后端日志。",
                ])

            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"

        return StreamingResponse(mcp_demo_gen(), media_type="text/event-stream")

    logger.info("AI assistant received message: %s", msg_clean[:100])

    if request.analysis_mode == "subagents" or _mentions_subagent(msg_clean):
        if _is_deterministic_lookup_message(msg_clean):
            return StreamingResponse(
                _deterministic_lookup_event_generator(request=request, session=session),
                media_type="text/event-stream",
            )
        return StreamingResponse(
            _subagent_showcase_event_generator(request=request, session=session),
            media_type="text/event-stream",
        )

    data_analysis_skill_reply = try_data_analysis_skill_reply_v2(request)
    if data_analysis_skill_reply:
        _AI_INTERP_PREFIX = '__NEEDS_AI_INTERP__'
        _needs_ai_interp = data_analysis_skill_reply.startswith(_AI_INTERP_PREFIX)
        _da_reply_text = _apply_yuqian_style(
            data_analysis_skill_reply[len(_AI_INTERP_PREFIX):] if _needs_ai_interp else data_analysis_skill_reply
        )

        async def data_analysis_gen():
            # 先把数据表原文流式输出
            yield f"[REPLY] {json.dumps(_da_reply_text, ensure_ascii=False)}\n"
            if not _needs_ai_interp:
                return
            # 二次 AI 诊断：把数据表喂给大模型，流式输出诊断段落
            _ai_prompt = (
                '你是一名天然气长输管道调度专家，精通压力管理、露点控制和多站指标对比诊断。\n'
                '用户刚刚在系统内查询了多个站场的实时运行数据，对比结果如下：\n\n'
                + _da_reply_text
                + '\n\n---\n'
                '请根据以上数据，用于谦式中文给出 AI 辅助诊断：\n'
                '【格式要求】\n'
                '- 先给一句结论：最需要关注哪个站，风险等级（正常/低/中/高）\n'
                '- 再分析 2~3 个关键异常点（每条对应一个数据指标，说清楚为什么异常）\n'
                '- 最后给 1~2 条可操作的调度建议（具体到动作，不要说"关注"）\n'
                '【风格要求】先结论后分析，口语化，松弛机灵；安全数字不开玩笑；\n'
                '禁止照抄数据表，禁止说废话，直接给诊断意见。'
            )
            _ai_interp_parts: list[str] = []
            try:
                yield f"[REPLY] {json.dumps(chr(10) + chr(10) + '---' + chr(10) + '**AI 诊断分析**' + chr(10), ensure_ascii=False)}\n"
                async for _chunk in ai_client.chat_stream(
                    prompt=_ai_prompt,
                    temperature=0.6,
                    max_tokens=800,
                ):
                    _ai_interp_parts.append(_chunk)
                    yield f"[REPLY] {json.dumps(_chunk, ensure_ascii=False)}\n"
            except Exception as _ai_exc:
                logger.warning('AI interp for data analysis failed: %s', _ai_exc)

        return StreamingResponse(data_analysis_gen(), media_type="text/event-stream")

    if _looks_like_operation_procedure_query(msg_clean):
        return StreamingResponse(
            _operation_procedure_event_generator(message=msg_clean, session=session),
            media_type="text/event-stream",
        )

    direct_count_reply = try_raw_excel_direct_count_reply(msg_clean)
    if direct_count_reply:

        async def direct_count_gen():
            yield f"[REPLY] {json.dumps(_apply_yuqian_style(direct_count_reply), ensure_ascii=False)}\n"

        return StreamingResponse(direct_count_gen(), media_type="text/event-stream")

    direct_list_reply = try_raw_excel_direct_list_reply(msg_clean)
    if direct_list_reply:

        async def direct_list_gen():
            yield f"[REPLY] {json.dumps(_apply_yuqian_style(direct_list_reply), ensure_ascii=False)}\n"

        return StreamingResponse(direct_list_gen(), media_type="text/event-stream")

    direct_lookup_reply = try_raw_excel_direct_entity_lookup(msg_clean)
    if direct_lookup_reply and not _is_raw_excel_negative_lookup(direct_lookup_reply):

        async def direct_gen():
            yield f"[REPLY] {json.dumps(_apply_yuqian_style(direct_lookup_reply), ensure_ascii=False)}\n"

        return StreamingResponse(direct_gen(), media_type="text/event-stream")
    if _is_raw_excel_negative_lookup(direct_lookup_reply):
        return StreamingResponse(
            _universal_search_event_generator(message=msg_clean, session=session),
            media_type="text/event-stream",
        )

    luzhi_pilot_reply = try_luzhi_pilot_reply(request.context, msg_clean)
    if luzhi_pilot_reply:

        async def luzhi_pilot_gen():
            yield f"[REPLY] {json.dumps(_apply_yuqian_style(luzhi_pilot_reply), ensure_ascii=False)}\n"

        return StreamingResponse(luzhi_pilot_gen(), media_type="text/event-stream")

    # === 多库并行交叉分析 ===
    if _should_use_multi_source(msg_clean):
        return StreamingResponse(
            _multi_source_event_generator(request=request),
            media_type="text/event-stream",
        )

    if ai_analysis_orchestrator.should_use_orchestration(request.context, request.analysis_mode):
        return StreamingResponse(
            _orchestrated_event_generator(request=request, session=session),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        _legacy_event_generator(request=request, session=session),
        media_type="text/event-stream",
    )


@router.post("/chat/multi-source")
async def chat_multi_source(
    request: ChatRequest,
    session: Session = Depends(get_session),
):
    """
    多库并行交叉分析接口（非流式）
    直接返回结构化 JSON，包含结论、证据、冲突、建议
    """
    from app.services.multi_source.orchestrator import multi_source_orchestrator

    result = await multi_source_orchestrator.analyze(request.message)
    return {
        "reply": result.conclusion,
        "evidence": [
            {
                "source": ev.source.value,
                "entity": ev.matched_entity,
                "metric": ev.metric,
                "value": ev.value,
                "trend": ev.trend,
                "confidence": ev.confidence,
                "text": ev.evidence_text,
                "is_simulation": ev.is_simulation,
            }
            for ev in result.evidence_list
            if ev.confidence > 0.3
        ],
        "conflicts": result.conflict_warnings,
        "risk_level": result.risk_level,
        "suggestions": result.suggestions,
        "data_sources": result.data_sources,
        "missing_sources": result.missing_sources,
        "is_complete": result.is_complete,
        "completeness_reason": result.completeness_reason,
        "response_time_ms": result.response_time_ms,
    }


@router.get("/luzhi-pilot/trace")
async def get_luzhi_pilot_trace(
    limit: int = Query(default=20, ge=1, le=200),
):
    trace_items, total_lines = _load_luzhi_pilot_trace(limit=limit)
    return {
        "pilot_enabled": _is_luzhi_pilot_globally_enabled(),
        "env_key": LUZHI_PILOT_ENV_KEY,
        "trace_path": str(LUZHI_TRACE_PATH),
        "trace_total": total_lines,
        "items": trace_items,
    }


@router.get("/luzhi-pilot/summary")
async def get_luzhi_pilot_summary(
    days: int = Query(default=7, ge=1, le=30),
    scan_limit: int = Query(default=800, ge=50, le=5000),
):
    trace_items, _ = _load_luzhi_pilot_trace(limit=scan_limit)
    summary = _build_luzhi_trace_summary(trace_items, days=days)
    return {
        "pilot_enabled": _is_luzhi_pilot_globally_enabled(),
        "window_days": days,
        **summary,
    }


@router.get("/luzhi-pilot/report")
async def get_luzhi_pilot_report(
    days: int = Query(default=7, ge=1, le=30),
    scan_limit: int = Query(default=1000, ge=50, le=5000),
    recent_limit: int = Query(default=20, ge=5, le=200),
):
    trace_items, _ = _load_luzhi_pilot_trace(limit=scan_limit)
    summary = _build_luzhi_trace_summary(trace_items, days=days)
    report_markdown = _build_luzhi_trace_report_markdown(
        items=trace_items,
        summary=summary,
        days=days,
        recent_limit=recent_limit,
    )
    generated_at = datetime.now(timezone.utc).isoformat()
    date_text = datetime.now(timezone.utc).strftime("%Y%m%d")
    return {
        "pilot_enabled": _is_luzhi_pilot_globally_enabled(),
        "window_days": days,
        "scan_limit": scan_limit,
        "recent_limit": recent_limit,
        "generated_at": generated_at,
        "report_filename": f"luzhi-pilot-review-{date_text}.md",
        "summary": summary,
        "report_markdown": report_markdown,
    }


async def generate_chat_response(request: ChatRequest, session: Session) -> ChatResponse:
    """
    给非流式入口复用 AI 助手能力。
    典型场景：飞书机器人、定时任务、外部 webhook。
    """
    msg_clean = request.message.strip()
    if not msg_clean:
        raise HTTPException(status_code=400, detail="消息不能为空")

    data_analysis_skill_reply = try_data_analysis_skill_reply_v2(request)
    if data_analysis_skill_reply is not None:
        return ChatResponse(reply=_apply_yuqian_style(data_analysis_skill_reply))

    direct_reply = _resolve_direct_reply(msg_clean)
    if direct_reply is not None:
        return ChatResponse(reply=direct_reply)

    luzhi_pilot_reply = try_luzhi_pilot_reply(request.context, msg_clean)
    if luzhi_pilot_reply is not None:
        return ChatResponse(reply=luzhi_pilot_reply)

    if ai_analysis_orchestrator.should_use_orchestration(request.context, request.analysis_mode):
        event_generator = _orchestrated_event_generator(request=request, session=session)
    else:
        event_generator = _legacy_event_generator(request=request, session=session)

    return await _collect_chat_response(event_generator)


def _resolve_direct_reply(message: str) -> str | None:
    msg_clean = message.strip()
    greetings = {"你好", "您好", "hello", "hi", "在吗", "早上好", "中午好", "下午好", "晚上好"}
    if msg_clean.lower() in greetings:
        return _apply_yuqian_style("你好，我在。你直接说想查什么、分析什么，或者哪里看着不对，我帮你一起看。")

    if SUBAGENT_ENTER_PATTERN.match(msg_clean):
        return _apply_yuqian_style(
            _append_completeness_hint(
                "已进入 SubAgent 协作模式。推荐先跑“中卫-靖边限流”“中卫单站风险”或“甪直露点趋势”。统计、列举这类确定性查询会自动直出，不硬走完整专家组。",
                message,
                is_complete=True,
                reason="已执行 subagent 进入命令。",
            )
        )
    if SUBAGENT_EXIT_PATTERN.match(msg_clean):
        return _apply_yuqian_style(
            _append_completeness_hint(
                "已退出 SubAgent 协作模式，回到常规问答。",
                message,
                is_complete=True,
                reason="已执行 subagent 退出命令。",
            )
        )

    direct_count_reply = try_raw_excel_direct_count_reply(msg_clean)
    if direct_count_reply:
        return _apply_yuqian_style(direct_count_reply)

    direct_list_reply = try_raw_excel_direct_list_reply(msg_clean)
    if direct_list_reply:
        return _apply_yuqian_style(direct_list_reply)

    direct_lookup_reply = try_raw_excel_direct_entity_lookup(msg_clean)
    if direct_lookup_reply and not _is_raw_excel_negative_lookup(direct_lookup_reply):
        return _apply_yuqian_style(direct_lookup_reply)

    return None


def try_data_analysis_skill_reply(request: ChatRequest) -> str | None:
    command, payload = _parse_data_analysis_command(request.message)
    mode_active_before = _is_data_analysis_mode_active(request.history)

    if command == "exit":
        return _append_completeness_hint(
            "已退出数据分析状态。后续会回到常规问答模式。",
            request.message,
            is_complete=True,
            reason="已执行退出命令。",
        )

    if command == "enter" and not payload:
        return _append_completeness_hint(
            "已进入数据分析状态。你可以直接说“甪直水露点”，或“甲站和乙站水露点对比”。",
            request.message,
            is_complete=True,
            reason="已执行进入命令。",
        )

    if not (mode_active_before or command == "enter"):
        return None

    target_message = payload if command == "enter" else request.message.strip()
    normalized_message = re.sub(r"\s+", "", target_message).lower()

    if _looks_like_history_curve_query(normalized_message):
        metric_type = _detect_history_metric_type(normalized_message)
        station_name_input = _extract_station_name_for_dewpoint(target_message, request.context)
        if not station_name_input:
            return _append_completeness_hint(
                "我识别到你要查历史曲线了，但这句里没抓到站名。请带上站名再发一次，比如“中卫站压力曲线”。",
                request.message,
                is_complete=False,
                reason="历史曲线查询缺少站名。",
            )

        resolved_station, has_metric_data = _resolve_station_for_history_metric(station_name_input, metric_type)
        if not has_metric_data:
            metric_label = "压力" if metric_type == "pressure" else ("温度" if metric_type == "temperature" else "水露点")
            return _append_completeness_hint(
                f"{station_name_input}目前没有可用的{metric_label}历史数据，先导入该指标后就能出曲线。",
                request.message,
                is_complete=False,
                reason=f"目标站点缺少{metric_type}时序数据。",
            )

        history_reply = _build_history_curve_action_reply(resolved_station, metric_type)
        return _append_completeness_hint(
            history_reply,
            request.message,
            is_complete=True,
            reason=f"已识别{resolved_station}{metric_type}历史曲线查询并生成动作。",
        )

    if not _looks_like_dewpoint_query(normalized_message):
        return None

    snapshot_index, alias_index = _collect_station_snapshots(request.context)
    if not snapshot_index:
        return _append_completeness_hint(
            "当前没有可用的露点快照，先打开甪直历史面板再发起分析。",
            request.message,
            is_complete=False,
            reason="上下文缺少 station snapshot。",
        )

    if _looks_like_dewpoint_compare_query(normalized_message):
        station_pair = _extract_station_pair_for_compare(target_message)
        if not station_pair:
            return _append_completeness_hint(
                "你这句里我没识别出两个站名。请按“甲站和乙站水露点对比”再发一次。",
                request.message,
                is_complete=False,
                reason="双站对比缺少可解析的站名。",
            )

        left_station_input, right_station_input = station_pair
        left_station_name, left_snapshot = _resolve_station_snapshot(left_station_input, snapshot_index, alias_index)
        right_station_name, right_snapshot = _resolve_station_snapshot(right_station_input, snapshot_index, alias_index)

        missing_stations: list[str] = []
        if left_snapshot is None:
            missing_stations.append(left_station_input)
        if right_snapshot is None:
            missing_stations.append(right_station_input)
        if missing_stations:
            available = sorted(snapshot_index.keys())
            return _append_completeness_hint(
                _build_missing_station_snapshot_reply(missing_stations, available),
                request.message,
                is_complete=False,
                reason="目标站缺少露点快照。",
            )

        left_analysis = _analyze_station_dewpoint(left_snapshot)
        right_analysis = _analyze_station_dewpoint(right_snapshot)
        if left_analysis is None or right_analysis is None:
            available = sorted(snapshot_index.keys())
            return _append_completeness_hint(
                f"站点已命中，但露点指标为空。当前可分析站：{'、'.join(available) if available else '无'}。",
                request.message,
                is_complete=False,
                reason="快照存在但无 dewpoint 指标。",
            )

        compare_reply = _build_dewpoint_compare_reply(
            left_station_name,
            right_station_name,
            left_snapshot,
            right_snapshot,
            left_analysis,
            right_analysis,
        )
        return _append_completeness_hint(
            compare_reply,
            request.message,
            is_complete=True,
            reason="已完成双站露点并行分析和对比。",
        )

    station_name_input = _extract_station_name_for_dewpoint(target_message, request.context)
    resolved_station_name, resolved_snapshot = _resolve_station_snapshot(station_name_input, snapshot_index, alias_index)
    if resolved_snapshot is None:
        available = sorted(snapshot_index.keys())
        query_station_text = station_name_input or "目标站"
        return _append_completeness_hint(
            f"{query_station_text}没有露点快照。当前可分析站：{'、'.join(available) if available else '无'}。",
            request.message,
            is_complete=False,
            reason="单站请求缺少对应站点快照。",
        )

    station_analysis = _analyze_station_dewpoint(resolved_snapshot)
    if station_analysis is None:
        return _append_completeness_hint(
            f"{resolved_station_name}当前快照没有露点指标，暂时无法分析。",
            request.message,
            is_complete=False,
            reason="站点快照缺少 dewpoint 指标。",
        )

    single_station_reply = _build_single_station_dewpoint_reply(
        resolved_station_name,
        resolved_snapshot,
        station_analysis,
    )
    return _append_completeness_hint(
        single_station_reply,
        request.message,
        is_complete=True,
        reason="已完成单站露点分析。",
    )


def _parse_data_analysis_command(message: str) -> tuple[str | None, str]:
    raw_message = (message or "").strip()
    exit_match = DATA_ANALYSIS_EXIT_PATTERN.match(raw_message)
    if exit_match:
        return "exit", ""

    enter_match = DATA_ANALYSIS_ENTER_PATTERN.match(raw_message)
    if enter_match:
        payload = str(enter_match.group("payload") or "").strip()
        return "enter", payload

    return None, ""


def _is_data_analysis_mode_active(history: list[ChatMessage] | None) -> bool:
    if not history:
        return False

    mode_active = False
    for item in history:
        if str(getattr(item, "role", "")).strip().lower() != "user":
            continue
        command, _ = _parse_data_analysis_command(str(getattr(item, "content", "")))
        if command == "enter":
            mode_active = True
        elif command == "exit":
            mode_active = False
    return mode_active


def _looks_like_dewpoint_query(normalized_message: str) -> bool:
    return any(keyword in normalized_message for keyword in DEWPOINT_QUERY_KEYWORDS)


def _looks_like_dewpoint_compare_query(normalized_message: str) -> bool:
    if not _looks_like_dewpoint_query(normalized_message):
        return False
    return any(keyword in normalized_message for keyword in DEWPOINT_COMPARE_KEYWORDS)


def _collect_station_snapshots(
    context: AssistantContext | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    station_snapshots: dict[str, dict[str, Any]] = {}
    alias_index: dict[str, str] = {}

    single_snapshot = _extract_luzhi_snapshot(context)
    if single_snapshot:
        _register_station_snapshot(station_snapshots, alias_index, single_snapshot)

    if context is None or not context.selection:
        return station_snapshots, alias_index

    raw_sources = (
        context.selection.get("station_snapshots"),
        context.selection.get("luzhi_station_snapshots"),
    )
    for raw_source in raw_sources:
        if isinstance(raw_source, dict):
            iterator = raw_source.values()
        elif isinstance(raw_source, list):
            iterator = raw_source
        else:
            continue

        for raw_snapshot in iterator:
            if not isinstance(raw_snapshot, dict):
                continue
            normalized_snapshot = _normalize_station_snapshot(raw_snapshot, fallback_station_name="")
            if not normalized_snapshot:
                continue
            _register_station_snapshot(station_snapshots, alias_index, normalized_snapshot)

    return station_snapshots, alias_index


def _register_station_snapshot(
    station_snapshots: dict[str, dict[str, Any]],
    alias_index: dict[str, str],
    snapshot: dict[str, Any],
) -> None:
    station_name = str(snapshot.get("station_name") or "").strip()
    if not station_name:
        return

    station_snapshots[station_name] = snapshot
    alias_index[station_name] = station_name
    normalized_station_name = _normalize_station_name_v2(station_name)
    if normalized_station_name:
        alias_index[normalized_station_name] = station_name

    if "甪直" in station_name:
        alias_index["甪直"] = station_name
        alias_index["甪直站"] = station_name
        alias_index[_normalize_station_name_v2("甪直分输站")] = station_name


def _normalize_station_name(raw_name: str) -> str:
    station_name = re.sub(r"[（(][^()（）]*[)）]", "", str(raw_name or ""))
    station_name = re.sub(r"\s+", "", station_name)
    for suffix in STATION_SUFFIXES:
        if station_name.endswith(suffix) and len(station_name) > len(suffix):
            station_name = station_name[: -len(suffix)]
            break
    return station_name.lower()


def _normalize_station_name_v2(raw_name: str) -> str:
    station_name = re.sub(r"[（(][^()（）]*[)）]", "", str(raw_name or ""))
    station_name = re.sub(r"\s+", "", station_name)
    station_name = _strip_pipeline_prefix(station_name)
    station_name = _strip_station_suffix(station_name)
    return station_name.lower()


def _strip_station_suffix(station_name: str) -> str:
    text = str(station_name or "")
    for suffix in CANONICAL_STATION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)]
    return text


def _strip_pipeline_prefix(station_name: str) -> str:
    text = str(station_name or "")
    if not text:
        return text

    changed = True
    while changed:
        changed = False
        for prefix in CANONICAL_PIPELINE_PREFIXES:
            if text.startswith(prefix) and len(text) > len(prefix):
                text = text[len(prefix):]
                changed = True
                break
    return text


def _has_pipeline_prefix(station_name: str) -> bool:
    text = re.sub(r"\s+", "", str(station_name or ""))
    return any(text.startswith(prefix) for prefix in CANONICAL_PIPELINE_PREFIXES)


def _extract_station_pair_for_compare(message: str) -> tuple[str, str] | None:
    compact = re.sub(r"\s+", "", (message or ""))
    match = STATION_PAIR_PATTERN.search(compact)
    if match:
        left = _clean_station_fragment(match.group("left"))
        right = _clean_station_fragment(match.group("right"))
        if left and right:
            return left, right

    for connector in ("和", "与", "跟"):
        if connector not in compact:
            continue
        left_part, right_part = compact.split(connector, 1)
        left = _extract_station_name_from_fragment(left_part, prefer_tail=True)
        right = _extract_station_name_from_fragment(right_part, prefer_tail=False)
        if left and right:
            return left, right
    return None


def _extract_station_name_from_fragment(fragment: str, *, prefer_tail: bool) -> str | None:
    tokens = re.findall(
        r"[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)",
        fragment,
    )
    if tokens:
        selected = tokens[-1] if prefer_tail else tokens[0]
        cleaned = _clean_station_fragment(selected)
        if cleaned:
            return cleaned

    cleaned_fragment = _clean_station_fragment(fragment)
    if not cleaned_fragment:
        return None

    if "甪直" in cleaned_fragment:
        return "甪直"

    if re.search(r"[\u4e00-\u9fa5A-Za-z]", cleaned_fragment):
        return cleaned_fragment

    return None


def _clean_station_fragment(fragment: str) -> str:
    text = re.sub(r"\s+", "", str(fragment or ""))
    text = _normalize_common_metric_terms(text)
    text = re.sub(r"(水?露点|dewpoint|对比|比较|差异|对照|分析|趋势|并行)+$", "", text, flags=re.IGNORECASE)
    text = text.strip("，。；;：:,")
    return text


def _extract_station_name_for_dewpoint(
    message: str,
    context: AssistantContext | None,
) -> str:
    compact = re.sub(r"\s+", "", _normalize_common_metric_terms(message or ""))
    tokens = re.findall(
        r"[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)",
        compact,
    )
    if tokens:
        station = _clean_station_fragment(tokens[-1])
        if station:
            return station

    if "甪直" in compact or "luzhi" in compact.lower():
        return "甪直"

    if context and context.selection:
        history_target = str(context.selection.get("history_target_station") or "").strip()
        if history_target:
            return history_target

    return ""


def _resolve_station_snapshot(
    station_name: str,
    station_snapshots: dict[str, dict[str, Any]],
    alias_index: dict[str, str],
) -> tuple[str, dict[str, Any] | None]:
    requested = str(station_name or "").strip()
    if not requested:
        if LUZHI_PILOT_STATION in station_snapshots:
            return LUZHI_PILOT_STATION, station_snapshots.get(LUZHI_PILOT_STATION)
        if station_snapshots:
            first_name = next(iter(station_snapshots))
            return first_name, station_snapshots.get(first_name)
        return "", None

    if requested in station_snapshots:
        return requested, station_snapshots[requested]

    normalized_requested = _normalize_station_name_v2(requested)
    mapped_name = alias_index.get(requested) or alias_index.get(normalized_requested)
    if mapped_name and mapped_name in station_snapshots:
        return mapped_name, station_snapshots[mapped_name]

    return requested, None


def _build_missing_station_snapshot_reply(missing_stations: list[str], available_stations: list[str]) -> str:
    missing_text = "、".join(dict.fromkeys(station for station in missing_stations if station))
    available_text = "、".join(available_stations) if available_stations else "无"
    return f"未找到这些站的露点快照：{missing_text}。当前可分析站：{available_text}。"


def _analyze_station_dewpoint(snapshot: dict[str, Any]) -> dict[str, Any] | None:
    metrics: list[dict[str, Any]] = snapshot.get("metrics") or []
    dewpoint_metrics = [metric for metric in metrics if str(metric.get("type")) == "dewpoint"]
    if not dewpoint_metrics:
        return None

    evaluated_items: list[dict[str, Any]] = []
    for metric in dewpoint_metrics:
        metric_eval = _evaluate_luzhi_metric(metric)
        evaluated_items.append(metric | metric_eval)

    evaluated_items.sort(
        key=lambda item: (
            LUZHI_RISK_ORDER.get(str(item.get("risk_level") or "正常"), 0),
            abs(float(item.get("delta6h") or 0.0)),
            str(item.get("label") or ""),
        ),
        reverse=True,
    )
    strongest_metric = evaluated_items[0]
    overall_risk = _choose_overall_risk(evaluated_items)
    overall_confidence = _aggregate_confidence(evaluated_items)
    avg_latest = sum(float(item.get("latest") or 0.0) for item in evaluated_items) / len(evaluated_items)

    return {
        "overall_risk": overall_risk,
        "overall_confidence": overall_confidence,
        "strongest_metric": strongest_metric,
        "avg_latest": avg_latest,
        "items": evaluated_items,
    }


def _build_station_dewpoint_conclusion(analysis: dict[str, Any]) -> str:
    strongest_metric = analysis["strongest_metric"]
    overall_risk = str(analysis["overall_risk"])
    metric_label = str(strongest_metric["label"])
    metric_delta = _format_signed_value(float(strongest_metric["delta6h"]), str(strongest_metric["unit"]))

    if overall_risk == "高":
        return f"露点波动偏高，重点关注{metric_label}，近6小时变化{metric_delta}。"
    if overall_risk == "中":
        return f"露点存在中等波动，重点关注{metric_label}，近6小时变化{metric_delta}。"
    if overall_risk == "低":
        return f"露点整体可控，有轻微波动，重点项是{metric_label}。"
    return f"露点整体平稳，当前主要观测项是{metric_label}。"


def _build_single_station_dewpoint_reply(
    station_name: str,
    snapshot: dict[str, Any],
    analysis: dict[str, Any],
) -> str:
    lines: list[str] = []
    conclusion = _build_station_dewpoint_conclusion(analysis)
    lines.append(f"{station_name}水露点结论：{conclusion}")
    lines.append(f"风险等级：{analysis['overall_risk']}（置信度 {analysis['overall_confidence']:.0%}）")
    lines.append(f"分析窗口：{_format_time_window(snapshot)}")
    lines.append("1. 露点指标明细")

    for idx, item in enumerate(analysis["items"], start=1):
        lines.append(
            "{index}. {label} 当前{latest}，6小时变化{delta6h}，区间{range_text}，风险{risk}，建议{action}".format(
                index=idx,
                label=item["label"],
                latest=_format_metric_value(float(item["latest"]), str(item["unit"])),
                delta6h=_format_signed_value(float(item["delta6h"]), str(item["unit"])),
                range_text=f"{_format_metric_number(float(item['min']))} ~ {_format_metric_number(float(item['max']))} {item['unit']}".strip(),
                risk=item["risk_level"],
                action=item["action_hint"],
            )
        )

    strongest_metric = analysis.get("strongest_metric")
    if strongest_metric:
        action_target = _infer_luzhi_action_target(snapshot, strongest_metric)
        action_target["view"] = "dewpoint"
        lines.extend(
            [
                "",
                (
                    "[ACTION:OPEN_HISTORY_PANEL"
                    f"|station={action_target['station']}"
                    f"|view={action_target['view']}"
                    f"|hours={action_target['hours']}"
                    f"|time_start={action_target['time_start']}"
                    f"|time_end={action_target['time_end']}"
                    f"|metric={action_target['metric']}]"
                ),
            ]
        )

    return "\n".join(lines)


def _build_dewpoint_compare_reply(
    left_station_name: str,
    right_station_name: str,
    left_snapshot: dict[str, Any],
    right_snapshot: dict[str, Any],
    left_analysis: dict[str, Any],
    right_analysis: dict[str, Any],
) -> str:
    left_conclusion = _build_station_dewpoint_conclusion(left_analysis)
    right_conclusion = _build_station_dewpoint_conclusion(right_analysis)
    left_risk = str(left_analysis["overall_risk"])
    right_risk = str(right_analysis["overall_risk"])
    risk_delta = LUZHI_RISK_ORDER.get(left_risk, 0) - LUZHI_RISK_ORDER.get(right_risk, 0)

    if risk_delta > 0:
        overall_conclusion = f"{left_station_name}风险高于{right_station_name}，优先处理{left_station_name}。"
    elif risk_delta < 0:
        overall_conclusion = f"{right_station_name}风险高于{left_station_name}，优先处理{right_station_name}。"
    else:
        overall_conclusion = "两站风险等级一致，建议按波动幅度排序处置。"

    lines: list[str] = [
        f"{left_station_name}和{right_station_name}水露点对比结论：{overall_conclusion}",
        f"1. 并行分析A（{left_station_name}）：{left_conclusion}",
        f"2. 并行分析B（{right_station_name}）：{right_conclusion}",
    ]

    left_by_pipeline = {str(item.get("pipeline") or item["label"]): item for item in left_analysis["items"]}
    right_by_pipeline = {str(item.get("pipeline") or item["label"]): item for item in right_analysis["items"]}
    common_pipelines = sorted(set(left_by_pipeline.keys()) & set(right_by_pipeline.keys()))

    if common_pipelines:
        lines.append("3. 同管线露点差值（A-B）")
        for idx, pipeline in enumerate(common_pipelines, start=1):
            left_item = left_by_pipeline[pipeline]
            right_item = right_by_pipeline[pipeline]
            unit = str(left_item.get("unit") or right_item.get("unit") or "")
            latest_diff = float(left_item["latest"]) - float(right_item["latest"])
            delta6h_diff = float(left_item["delta6h"]) - float(right_item["delta6h"])
            lines.append(
                f"{idx}. {pipeline} 当前差值{_format_signed_value(latest_diff, unit)}，6小时变化差{_format_signed_value(delta6h_diff, unit)}。"
            )
    else:
        left_unit = str(left_analysis["strongest_metric"].get("unit") or "")
        average_diff = float(left_analysis["avg_latest"]) - float(right_analysis["avg_latest"])
        lines.append("3. 同名管线不足，改用站级平均露点对比")
        lines.append(f"1. 站级平均露点差值（A-B）{_format_signed_value(average_diff, left_unit)}。")

    if left_analysis.get("strongest_metric"):
        action_target = _infer_luzhi_action_target(left_snapshot, left_analysis["strongest_metric"])
        action_target["view"] = "dewpoint"
        lines.extend(
            [
                "",
                (
                    "[ACTION:OPEN_HISTORY_PANEL"
                    f"|station={action_target['station']}"
                    f"|view={action_target['view']}"
                    f"|hours={action_target['hours']}"
                    f"|time_start={action_target['time_start']}"
                    f"|time_end={action_target['time_end']}"
                    f"|metric={action_target['metric']}]"
                ),
            ]
        )

    return "\n".join(lines)



def _looks_like_multi_station_compare(msg: str) -> bool:
    """判断是否是多站横向对比意图（压力/温度/水露点）"""
    if not any(kw in msg for kw in MULTI_STATION_COMPARE_KEYWORDS):
        return False
    # 包含连接词（和/与/跟）或多个站名匹配
    has_connector = any(c in msg for c in ('和', '与', '跟', '、', ',', '，'))
    return has_connector


def _detect_compare_metric(msg: str) -> str:
    """识别对比的指标类型。返回 pressure / temperature / dewpoint / all"""
    has_pressure = any(kw in msg for kw in PRESSURE_KEYWORDS)
    has_temperature = any(kw in msg for kw in TEMPERATURE_KEYWORDS)
    has_dewpoint = any(kw in msg for kw in DEWPOINT_QUERY_KEYWORDS)
    if has_pressure and not has_temperature and not has_dewpoint:
        return 'pressure'
    if has_temperature and not has_pressure and not has_dewpoint:
        return 'temperature'
    if has_dewpoint and not has_pressure and not has_temperature:
        return 'dewpoint'
    return 'all'


def _extract_multi_station_list(message: str) -> list[str]:
    """从消息中提取多个站场名称，支持逗号/顿号/和/与分隔"""
    compact = re.sub(r'\s+', '', (message or ''))
    # 先尝试按分隔符分割
    parts: list[str] = re.split(r'[,，、和与跟]', compact)
    station_names: list[str] = []
    for part in parts:
        # 尝试匹配站名（含站后缀）
        matches = re.findall(
            r'[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)',
            part
        )
        if matches:
            sname = _clean_station_fragment(matches[-1])
            if sname:
                station_names.append(sname)
        else:
            cleaned = _clean_station_fragment(part)
            if cleaned and re.search(r'[\u4e00-\u9fa5]', cleaned):
                station_names.append(cleaned)
    # 去重并保持顺序
    seen: set[str] = set()
    unique: list[str] = []
    for s in station_names:
        if s and s not in seen:
            seen.add(s)
            unique.append(s)
    return unique[:5]


def _looks_like_history_curve_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    has_metric = (
        any(kw.lower() in compact for kw in PRESSURE_KEYWORDS)
        or any(kw.lower() in compact for kw in TEMPERATURE_KEYWORDS)
        or any(kw.lower() in compact for kw in DEWPOINT_QUERY_KEYWORDS)
    )
    has_curve_intent = any(kw.lower() in compact for kw in HISTORY_CURVE_KEYWORDS)
    return has_metric and has_curve_intent


def _detect_history_metric_type(message: str) -> str:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    has_pressure = any(kw.lower() in compact for kw in PRESSURE_KEYWORDS)
    has_temperature = any(kw.lower() in compact for kw in TEMPERATURE_KEYWORDS)
    has_dewpoint = any(kw.lower() in compact for kw in DEWPOINT_QUERY_KEYWORDS)
    if has_temperature and not has_pressure and not has_dewpoint:
        return "temperature"
    if has_dewpoint and not has_pressure and not has_temperature:
        return "dewpoint"
    return "pressure"


def _resolve_station_for_history_metric(requested_station: str, metric_type: str) -> tuple[str, bool]:
    requested = str(requested_station or "").strip()
    if not requested:
        return "", False

    try:
        with Session(scada_history_engine) as history_session:
            available_rows = history_session.exec(
                select(ScadaHistory.station_name).where(ScadaHistory.metric_type == metric_type)
            ).all()
            available_names = sorted({str(name).strip() for name in available_rows if str(name).strip()})
    except Exception as exc:
        logger.warning("load station names from scada_history failed: %s", exc)
        return requested, False

    if not available_names:
        return requested, False

    resolved = _resolve_db_station_name_for_dewpoint_v2(requested, available_names)
    if not resolved:
        return requested, False
    return resolved, True


def _build_history_curve_action_reply(station_name: str, metric_type: str) -> str:
    view = "pressure"
    metric_label = "压力"
    if metric_type == "temperature":
        view = "temperature"
        metric_label = "温度"
    elif metric_type == "dewpoint":
        view = "dewpoint"
        metric_label = "水露点"

    station_token = _sanitize_action_token_text(station_name)
    metric_token = _sanitize_action_token_text(metric_label)
    return (
        f"{station_name}{metric_label}历史曲线已就位，点下面按钮直接开图看趋势。\n\n"
        "[ACTION:OPEN_HISTORY_PANEL"
        f"|station={station_token}"
        f"|view={view}"
        "|hours=12"
        "|time_start="
        "|time_end="
        f"|metric={metric_token}]\n\n"
    )


def try_data_analysis_skill_reply_v2(request: ChatRequest) -> str | None:
    command, payload = _parse_data_analysis_command(request.message)
    mode_active_before = _is_data_analysis_mode_active(request.history)

    if command == "exit":
        return _append_completeness_hint(
            "已退出数据分析状态。后续会回到常规问答模式。",
            request.message,
            is_complete=True,
            reason="已执行退出命令。",
        )

    if command == "enter" and not payload:
        return _append_completeness_hint(
            "已进入数据分析状态。你可以直接说“甪直水露点”，或“甲站和乙站水露点对比”。",
            request.message,
            is_complete=True,
            reason="已执行进入命令。",
        )

    target_message_raw = payload if command == "enter" else request.message.strip()
    target_message = _normalize_common_metric_terms(target_message_raw)
    term_correction_note = _build_metric_term_correction_note(target_message_raw, target_message)

    def with_term_correction(reply: str | None) -> str | None:
        if not reply or not term_correction_note:
            return reply
        return f"{term_correction_note}\n\n{reply}"

    normalized_message = re.sub(r"\s+", "", target_message).lower()
    if not (mode_active_before or command == "enter" or _looks_like_dewpoint_query(normalized_message)):
        return None

    if not _looks_like_dewpoint_query(normalized_message):
        return None

    snapshot_index, alias_index = _collect_station_snapshots(request.context)

    # —— 多站横向对比：压力 / 温度 / 水露点 ——
    if _looks_like_multi_station_compare(normalized_message):
        station_list = _extract_multi_station_list(target_message)
        if len(station_list) >= 2:
            compare_metric = _detect_compare_metric(normalized_message)
            stations_arg = ','.join(station_list)
            try:
                from app.services.assistant_tools import TOOL_HANDLERS
                from app.database import get_session
                with next(get_session()) as db_session:
                    compare_result = TOOL_HANDLERS['compare_stations'](
                        {'stations': stations_arg, 'metric': compare_metric, 'hours': 24},
                        db_session
                    )
                # 加前缀标记，通知下游生成器需要触发 AI 二次解读
                _compare_hint = _append_completeness_hint(
                    compare_result,
                    request.message,
                    is_complete=True,
                    reason=f'已完成{len(station_list)}站{compare_metric}横向对比分析。',
                )
                return '__NEEDS_AI_INTERP__' + (with_term_correction(_compare_hint) or _compare_hint)
            except Exception as _exc:
                logger.warning('多站对比工具调用失败: %s', _exc)
                # 失败时降级继续

    if _looks_like_dewpoint_compare_query(normalized_message):
        station_pair = _extract_station_pair_for_compare(target_message)
        if not station_pair:
            return with_term_correction(_append_completeness_hint(
                "你这句里我没识别出两个站名。请按“甲站和乙站水露点对比”再发一次。",
                request.message,
                is_complete=False,
                reason="双站对比缺少可解析的站名。",
            ))

        left_station_input, right_station_input = station_pair
        left_station_name, left_snapshot = _resolve_station_snapshot(left_station_input, snapshot_index, alias_index)
        right_station_name, right_snapshot = _resolve_station_snapshot(right_station_input, snapshot_index, alias_index)

        if left_snapshot is None:
            left_station_name, left_snapshot = _ensure_station_snapshot_from_db(
                left_station_name or left_station_input,
                snapshot_index,
                alias_index,
            )
        if right_snapshot is None:
            right_station_name, right_snapshot = _ensure_station_snapshot_from_db(
                right_station_name or right_station_input,
                snapshot_index,
                alias_index,
            )

        missing_stations: list[str] = []
        if left_snapshot is None:
            missing_stations.append(left_station_input)
        if right_snapshot is None:
            missing_stations.append(right_station_input)
        if missing_stations:
            available = sorted(snapshot_index.keys())
            return with_term_correction(_append_completeness_hint(
                _build_missing_station_snapshot_reply(missing_stations, available),
                request.message,
                is_complete=False,
                reason="目标站缺少露点快照。",
            ))

        left_analysis = _analyze_station_dewpoint(left_snapshot)
        right_analysis = _analyze_station_dewpoint(right_snapshot)
        if left_analysis is None or right_analysis is None:
            available = sorted(snapshot_index.keys())
            return with_term_correction(_append_completeness_hint(
                f"站点已命中，但露点指标为空。当前可分析站：{'、'.join(available) if available else '无'}。",
                request.message,
                is_complete=False,
                reason="快照存在但无 dewpoint 指标。",
            ))

        compare_reply = _build_dewpoint_compare_reply(
            left_station_name,
            right_station_name,
            left_snapshot,
            right_snapshot,
            left_analysis,
            right_analysis,
        )
        return with_term_correction(_append_completeness_hint(
            compare_reply,
            request.message,
            is_complete=True,
            reason="已完成双站露点并行分析和对比。",
        ))

    station_name_input = _extract_station_name_for_dewpoint(target_message, request.context)
    resolved_station_name, resolved_snapshot = _resolve_station_snapshot(station_name_input, snapshot_index, alias_index)
    if resolved_snapshot is None:
        resolved_station_name, resolved_snapshot = _ensure_station_snapshot_from_db(
            resolved_station_name or station_name_input,
            snapshot_index,
            alias_index,
        )

    if resolved_snapshot is None:
        available = sorted(snapshot_index.keys())
        query_station_text = station_name_input or "目标站"
        return with_term_correction(_append_completeness_hint(
            f"{query_station_text}没有露点快照。当前可分析站：{'、'.join(available) if available else '无'}。",
            request.message,
            is_complete=False,
            reason="单站请求缺少对应站点快照，且数据库无可用露点历史。",
        ))

    station_analysis = _analyze_station_dewpoint(resolved_snapshot)
    if station_analysis is None:
        return with_term_correction(_append_completeness_hint(
            f"{resolved_station_name}当前快照没有露点指标，暂时无法分析。",
            request.message,
            is_complete=False,
            reason="站点快照缺少 dewpoint 指标。",
        ))

    single_station_reply = _build_single_station_dewpoint_reply(
        resolved_station_name,
        resolved_snapshot,
        station_analysis,
    )
    return with_term_correction(_append_completeness_hint(
        single_station_reply,
        request.message,
        is_complete=True,
        reason="已完成单站露点分析。",
    ))


def _ensure_station_snapshot_from_db(
    station_name: str,
    station_snapshots: dict[str, dict[str, Any]],
    alias_index: dict[str, str],
) -> tuple[str, dict[str, Any] | None]:
    db_station_name, db_snapshot = _load_station_snapshot_from_scada_history(station_name)
    if db_snapshot is None:
        return station_name, None
    _register_station_snapshot(station_snapshots, alias_index, db_snapshot)
    return _resolve_station_snapshot(db_station_name, station_snapshots, alias_index)


def _load_station_snapshot_from_scada_history(
    station_name: str,
    *,
    lookback_hours: int = 24,
) -> tuple[str, dict[str, Any] | None]:
    requested = str(station_name or "").strip()
    if not requested:
        return "", None

    try:
        with Session(scada_history_engine) as history_session:
            available_rows = history_session.exec(
                select(ScadaHistory.station_name).where(ScadaHistory.metric_type == "dewpoint")
            ).all()
            available_names = sorted({str(name).strip() for name in available_rows if str(name).strip()})
            if not available_names:
                return requested, None

            resolved_station = _resolve_db_station_name_for_dewpoint_v2(requested, available_names)
            if not resolved_station:
                return requested, None

            latest_record = history_session.exec(
                select(ScadaHistory)
                .where(
                    ScadaHistory.station_name == resolved_station,
                    ScadaHistory.metric_type == "dewpoint",
                )
                .order_by(ScadaHistory.recorded_at.desc())
            ).first()
            if latest_record is None:
                return resolved_station, None

            cutoff = latest_record.recorded_at - timedelta(hours=max(lookback_hours, 1))
            candidate_rows = history_session.exec(
                select(ScadaHistory)
                .where(
                    ScadaHistory.station_name == resolved_station,
                    ScadaHistory.metric_type == "dewpoint",
                    ScadaHistory.recorded_at >= cutoff,
                )
                .order_by(ScadaHistory.recorded_at)
            ).all()
            rows = list(candidate_rows)
            if not rows:
                rows = [
                    row
                    for row in history_session.exec(
                        select(ScadaHistory)
                        .where(
                            ScadaHistory.station_name == resolved_station,
                            ScadaHistory.metric_type == "dewpoint",
                        )
                        .order_by(ScadaHistory.recorded_at)
                    ).all()
                ]
            if not rows:
                return resolved_station, None

    except Exception as exc:
        logger.warning("load dewpoint snapshot from scada_history failed: %s", exc)
        return requested, None

    snapshot = _build_dewpoint_snapshot_from_history_rows(
        station_name=resolved_station,
        rows=rows,
    )
    return resolved_station, snapshot


def _resolve_db_station_name_for_dewpoint(requested: str, available_names: list[str]) -> str | None:
    requested_text = str(requested or "").strip()
    if not requested_text:
        return None
    if requested_text in available_names:
        return requested_text

    requested_norm = _normalize_station_name(requested_text)
    normalized_map: dict[str, list[str]] = {}
    for name in available_names:
        norm = _normalize_station_name(name)
        if not norm:
            continue
        normalized_map.setdefault(norm, []).append(name)
    if requested_norm in normalized_map:
        return normalized_map[requested_norm][0]

    if "甪直" in requested_text:
        for name in available_names:
            if "甪直" in name:
                return name

    fuzzy_candidates: list[tuple[int, str]] = []
    for name in available_names:
        norm = _normalize_station_name(name)
        if not norm:
            continue
        score = 0
        if requested_norm and requested_norm in norm:
            score += 2
        if requested_norm and norm in requested_norm:
            score += 1
        if requested_text in name:
            score += 1
        if score > 0:
            fuzzy_candidates.append((score, name))
    if not fuzzy_candidates:
        return None
    fuzzy_candidates.sort(key=lambda item: (item[0], -len(item[1])), reverse=True)
    return fuzzy_candidates[0][1]


def _resolve_db_station_name_for_dewpoint_v2(requested: str, available_names: list[str]) -> str | None:
    requested_text = str(requested or "").strip()
    if not requested_text:
        return None
    if requested_text in available_names and not _has_pipeline_prefix(requested_text):
        return requested_text

    requested_norm = _normalize_station_name_v2(requested_text)
    if not requested_norm:
        return None

    same_key_candidates = [name for name in available_names if _normalize_station_name_v2(name) == requested_norm]
    if same_key_candidates:
        return _pick_canonical_station_name(requested_text, same_key_candidates)

    fuzzy_candidates: list[tuple[int, str]] = []
    for name in available_names:
        norm = _normalize_station_name_v2(name)
        if not norm:
            continue
        score = 0
        if requested_norm in norm:
            score += 3
        if norm in requested_norm:
            score += 2
        if requested_text in name:
            score += 1
        if score > 0:
            fuzzy_candidates.append((score, name))

    if not fuzzy_candidates:
        return None

    fuzzy_candidates.sort(
        key=lambda item: (
            item[0],
            _station_name_rank(item[1], requested_text),
        ),
        reverse=True,
    )
    best_score = fuzzy_candidates[0][0]
    best_names = [name for score, name in fuzzy_candidates if score == best_score]
    return _pick_canonical_station_name(requested_text, best_names)


def _station_name_rank(candidate_name: str, requested_name: str) -> tuple[int, int, int]:
    candidate = str(candidate_name or "").strip()
    requested = str(requested_name or "").strip()
    exact_match = 1 if candidate == requested else 0
    no_pipeline_prefix = 1 if not _has_pipeline_prefix(candidate) else 0
    length_score = -abs(len(candidate) - len(requested))
    return no_pipeline_prefix, exact_match, length_score


def _pick_canonical_station_name(requested_name: str, candidate_names: list[str]) -> str | None:
    if not candidate_names:
        return None
    preferred = sorted(
        candidate_names,
        key=lambda name: (
            _station_name_rank(name, requested_name),
            -len(name),
        ),
        reverse=True,
    )
    return preferred[0]


def _build_dewpoint_snapshot_from_history_rows(
    *,
    station_name: str,
    rows: list[ScadaHistory],
) -> dict[str, Any] | None:
    if not rows:
        return None

    grouped: dict[tuple[str, str], list[ScadaHistory]] = {}
    for row in rows:
        pipeline_id = str(row.pipeline_id or "").strip()
        tag_name = str(row.tag_name or "").strip()
        grouped.setdefault((pipeline_id, tag_name), []).append(row)

    metrics: list[dict[str, Any]] = []
    time_start = rows[0].recorded_at
    time_end = rows[-1].recorded_at

    for (pipeline_id, tag_name), metric_rows in grouped.items():
        if not metric_rows:
            continue
        metric_rows.sort(key=lambda item: item.recorded_at)
        values = [float(item.value) for item in metric_rows]
        latest_value = values[-1]
        earliest_value = values[0]
        min_value = min(values)
        max_value = max(values)
        avg_value = sum(values) / len(values)
        metric_label = _build_dewpoint_metric_label(pipeline_id, tag_name)
        metrics.append(
            {
                "label": metric_label,
                "pipeline": pipeline_id.upper() or metric_label,
                "type": "dewpoint",
                "unit": "°C",
                "latest": round(latest_value, 4),
                "min": round(min_value, 4),
                "max": round(max_value, 4),
                "avg": round(avg_value, 4),
                "delta6h": round(latest_value - earliest_value, 4),
            }
        )

    if not metrics:
        return None

    return {
        "station_name": station_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "time_start": time_start.isoformat(),
        "time_end": time_end.isoformat(),
        "metrics": metrics,
    }


def _build_dewpoint_metric_label(pipeline_id: str, tag_name: str) -> str:
    pipeline_map = {
        "we1": "西一线",
        "we2": "西二线",
        "cred": "中俄线",
        "pt": "普唐线",
    }
    pipeline_key = str(pipeline_id or "").strip().lower()
    pipeline_label = pipeline_map.get(pipeline_key) or str(pipeline_id or "").upper() or "未知管线"
    if tag_name:
        return f"{pipeline_label} 水露点 ({tag_name})"
    return f"{pipeline_label} 水露点"


def try_luzhi_pilot_reply(context: AssistantContext | None, user_message: str) -> str | None:
    if not _is_luzhi_pilot_context(context):
        return None

    normalized_message = re.sub(r"\s+", "", (user_message or "")).lower()
    if not _looks_like_luzhi_analysis_query(normalized_message):
        return None

    snapshot = _extract_luzhi_snapshot(context)
    if not snapshot:
        return _apply_yuqian_style(
            _append_completeness_hint(
                "甪直试点已命中，但当前上下文里没有可分析的历史快照。请先打开“甪直历史”面板后再提问。",
                user_message,
                is_complete=False,
                reason="当前请求缺少甪直快照数据，暂时不能给出完整分析。",
            )
        )

    report, report_meta = _build_luzhi_pilot_report(snapshot)
    final_reply = _append_completeness_hint(
        report,
        user_message,
        is_complete=True,
        reason="已基于甪直历史快照生成结构化分析。",
    )
    _persist_luzhi_pilot_trace(
        user_message=user_message,
        snapshot=snapshot,
        report_meta=report_meta,
    )
    return _apply_yuqian_style(final_reply)


def _is_luzhi_pilot_context(context: AssistantContext | None) -> bool:
    if not _is_luzhi_pilot_globally_enabled():
        return False

    if context is None or not context.selection:
        return False

    station_name = str(context.selection.get("pilot_station_name") or "").strip()
    if station_name != LUZHI_PILOT_STATION:
        return False

    pilot_enabled = context.selection.get("pilot_enabled")
    return bool(pilot_enabled) if isinstance(pilot_enabled, bool) else True


def _is_luzhi_pilot_globally_enabled() -> bool:
    raw = os.getenv(LUZHI_PILOT_ENV_KEY, "1").strip().lower()
    return raw not in {"0", "false", "off", "no"}


def _looks_like_luzhi_analysis_query(normalized_message: str) -> bool:
    if not normalized_message:
        return False

    if "甪直" in normalized_message or "luzhi" in normalized_message:
        return True

    return any(keyword in normalized_message for keyword in LUZHI_ANALYSIS_KEYWORDS)


def _extract_luzhi_snapshot(context: AssistantContext | None) -> dict[str, Any] | None:
    if context is None or not context.selection:
        return None

    raw_snapshot = context.selection.get("luzhi_snapshot")
    if not isinstance(raw_snapshot, dict):
        return None

    return _normalize_station_snapshot(raw_snapshot, fallback_station_name=LUZHI_PILOT_STATION)


def _normalize_station_snapshot(
    raw_snapshot: dict[str, Any],
    *,
    fallback_station_name: str,
) -> dict[str, Any] | None:
    raw_metrics = raw_snapshot.get("metrics")
    if not isinstance(raw_metrics, list):
        return None

    metrics: list[dict[str, Any]] = []
    for raw_metric in raw_metrics:
        if not isinstance(raw_metric, dict):
            continue

        latest = _to_float(raw_metric.get("latest"))
        minimum = _to_float(raw_metric.get("min"))
        maximum = _to_float(raw_metric.get("max"))
        average = _to_float(raw_metric.get("avg"))
        delta6h = _to_float(raw_metric.get("delta6h"))
        if None in {latest, minimum, maximum, average, delta6h}:
            continue

        metrics.append(
            {
                "label": str(raw_metric.get("label") or raw_metric.get("key") or "未命名指标"),
                "pipeline": str(raw_metric.get("pipeline") or ""),
                "type": str(raw_metric.get("type") or "unknown"),
                "unit": str(raw_metric.get("unit") or ""),
                "latest": latest,
                "min": minimum,
                "max": maximum,
                "avg": average,
                "delta6h": delta6h,
            }
        )

    if not metrics:
        return None

    time_range = raw_snapshot.get("timeRange")
    if not isinstance(time_range, dict):
        time_range = {}

    return {
        "station_name": str(raw_snapshot.get("stationName") or fallback_station_name or LUZHI_PILOT_STATION),
        "generated_at": str(raw_snapshot.get("generatedAt") or ""),
        "time_start": str(time_range.get("start") or ""),
        "time_end": str(time_range.get("end") or ""),
        "metrics": metrics,
    }


def _build_luzhi_pilot_report(snapshot: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    metrics: list[dict[str, Any]] = snapshot["metrics"]

    table_rows: list[str] = []
    evaluated_items: list[dict[str, Any]] = []
    pressure_risk_items: list[str] = []
    strongest_metric: dict[str, Any] | None = None
    strongest_score = -1.0

    for metric in metrics:
        metric_eval = _evaluate_luzhi_metric(metric)
        evaluated = metric | metric_eval
        evaluated_items.append(evaluated)

        if metric["type"] == "pressure" and metric_eval["risk_level"] in {"中", "高"}:
            pressure_risk_items.append(metric["label"])

        score = abs(metric["delta6h"]) + metric_eval["swing"] + (LUZHI_RISK_ORDER.get(metric_eval["risk_level"], 0) * 0.3)
        if score > strongest_score:
            strongest_score = score
            strongest_metric = evaluated

        table_rows.append(
            "| {label} | {latest} | {delta6h} | {range_text} | {avg} | {risk} | {confidence} | {trigger} | {action} |".format(
                label=metric["label"],
                latest=_format_metric_value(metric["latest"], metric["unit"]),
                delta6h=_format_signed_value(metric["delta6h"], metric["unit"]),
                range_text=f"{_format_metric_number(metric['min'])} ~ {_format_metric_number(metric['max'])} {metric['unit']}".strip(),
                avg=_format_metric_value(metric["avg"], metric["unit"]),
                risk=metric_eval["risk_level"],
                confidence=f"{metric_eval['confidence']:.0%}",
                trigger=metric_eval["trigger_reason"],
                action=metric_eval["action_hint"],
            )
        )

    overall_risk = _choose_overall_risk(evaluated_items)
    overall_confidence = _aggregate_confidence(evaluated_items)
    conclusion = _build_luzhi_conclusion(overall_risk, pressure_risk_items, evaluated_items)
    strongest_desc = "无明显单项波动。"
    if strongest_metric is not None:
        strongest_desc = (
            f"{strongest_metric['label']}近6小时{strongest_metric['trend']}，"
            f"变化{_format_signed_value(strongest_metric['delta6h'], strongest_metric['unit'])}，"
            f"风险{strongest_metric['risk_level']}。"
        )

    schedule_suggestion, inspection_suggestion, alarm_suggestion = _build_luzhi_action_templates(overall_risk, evaluated_items)
    action_target = _infer_luzhi_action_target(snapshot, strongest_metric)
    time_window = _format_time_window(snapshot)

    lines = [
        f"甪直分输站试点结论：{conclusion}",
        "",
        f"总体风险等级：{overall_risk}（置信度 {overall_confidence:.0%}）",
        f"分析窗口：{time_window}",
        f"最大变化项：{strongest_desc}",
        "",
        "证据表（快照）",
        "",
        "| 指标 | 最新值 | 6小时变化 | 波动区间 | 均值 | 风险等级 | 置信度 | 触发原因 | 建议动作 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        *table_rows,
        "",
        "动作建议（模板）：",
        f"- 调度建议：{schedule_suggestion}",
        f"- 巡检建议：{inspection_suggestion}",
        f"- 告警建议：{alarm_suggestion}",
        "",
        "回链操作：",
        (
            "[ACTION:OPEN_HISTORY_PANEL"
            f"|station={action_target['station']}"
            f"|view={action_target['view']}"
            f"|hours={action_target['hours']}"
            f"|time_start={action_target['time_start']}"
            f"|time_end={action_target['time_end']}"
            f"|metric={action_target['metric']}]"
        ),
        "",
        "说明：本次结果基于甪直历史快照规则判级，建议结合当班调度计划做最终确认。",
    ]
    report_meta = {
        "overall_risk": overall_risk,
        "overall_confidence": overall_confidence,
        "time_window": time_window,
        "action_target": action_target,
        "focused_metric": strongest_metric.get("label") if strongest_metric else "",
        "focused_metric_risk": strongest_metric.get("risk_level") if strongest_metric else "",
    }
    return "\n".join(lines), report_meta


def _evaluate_luzhi_metric(metric: dict[str, Any]) -> dict[str, Any]:
    swing = max(float(metric["max"]) - float(metric["min"]), 0.0)
    delta6h = float(metric["delta6h"])
    abs_delta = abs(delta6h)
    metric_type = str(metric.get("type") or "unknown")

    if abs_delta < 1e-4:
        trend = "基本持平"
    elif delta6h > 0:
        trend = "上升"
    else:
        trend = "下降"

    risk_level, trigger_reason = _grade_metric_risk(metric_type, swing, abs_delta)
    action_hint = _build_metric_action_hint(metric_type, risk_level)
    confidence = _estimate_metric_confidence(metric_type, risk_level, swing, abs_delta)

    return {
        "trend": trend,
        "swing": swing,
        "risk_level": risk_level,
        "trigger_reason": trigger_reason,
        "action_hint": action_hint,
        "confidence": confidence,
    }


def _grade_metric_risk(metric_type: str, swing: float, abs_delta: float) -> tuple[str, str]:
    if metric_type == "pressure":
        if swing >= 0.45 or abs_delta >= 0.22:
            return "高", "压力波动较大（幅度或短时变化超高风险阈值）"
        if swing >= 0.30 or abs_delta >= 0.15:
            return "中", "压力波动偏大（达到中风险阈值）"
        if swing >= 0.20 or abs_delta >= 0.10:
            return "低", "压力有轻微波动（达到低风险阈值）"
        return "正常", "压力变化在稳态区间"

    if metric_type == "temperature":
        if swing >= 8.0 or abs_delta >= 4.0:
            return "高", "温度变化过快（幅度或短时变化超高风险阈值）"
        if swing >= 5.0 or abs_delta >= 2.5:
            return "中", "温度波动偏大（达到中风险阈值）"
        if swing >= 3.0 or abs_delta >= 1.5:
            return "低", "温度有可见波动（达到低风险阈值）"
        return "正常", "温度变化在稳态区间"

    if metric_type == "dewpoint":
        if swing >= 6.0 or abs_delta >= 3.0:
            return "高", "露点变化较大（幅度或短时变化超高风险阈值）"
        if swing >= 4.0 or abs_delta >= 2.0:
            return "中", "露点波动偏大（达到中风险阈值）"
        if swing >= 2.5 or abs_delta >= 1.2:
            return "低", "露点有可见波动（达到低风险阈值）"
        return "正常", "露点变化在稳态区间"

    if swing >= 2.0 or abs_delta >= 1.0:
        return "中", "通用指标波动偏大"
    if swing >= 1.0 or abs_delta >= 0.5:
        return "低", "通用指标存在波动"
    return "正常", "通用指标变化稳定"


def _build_metric_action_hint(metric_type: str, risk_level: str) -> str:
    if risk_level == "正常":
        return "维持当前策略，持续观测"

    if metric_type == "pressure":
        return "核对上下游计划与调压阀开度"
    if metric_type == "temperature":
        return "复核换热与环境温度影响"
    if metric_type == "dewpoint":
        return "复核气质与脱水工况"
    return "复核现场工况并持续跟踪"


def _estimate_metric_confidence(metric_type: str, risk_level: str, swing: float, abs_delta: float) -> float:
    base = 0.72
    base += min(swing * 0.08, 0.12)
    base += min(abs_delta * 0.10, 0.10)

    if risk_level == "低":
        base += 0.03
    elif risk_level == "中":
        base += 0.06
    elif risk_level == "高":
        base += 0.09

    if metric_type == "pressure":
        base += 0.02
    return max(0.60, min(base, 0.95))


def _choose_overall_risk(evaluated_items: list[dict[str, Any]]) -> str:
    if not evaluated_items:
        return "正常"
    return max(
        (str(item.get("risk_level") or "正常") for item in evaluated_items),
        key=lambda risk: LUZHI_RISK_ORDER.get(risk, 0),
    )


def _aggregate_confidence(evaluated_items: list[dict[str, Any]]) -> float:
    if not evaluated_items:
        return 0.65
    total = 0.0
    for item in evaluated_items:
        total += float(item.get("confidence") or 0.0)
    return max(0.60, min(total / len(evaluated_items), 0.95))


def _build_luzhi_conclusion(overall_risk: str, pressure_risk_items: list[str], evaluated_items: list[dict[str, Any]]) -> str:
    watched_items = [str(item["label"]) for item in evaluated_items if str(item.get("risk_level")) in {"低", "中", "高"}]
    if overall_risk == "高":
        if pressure_risk_items:
            return f"甪直分输站存在高风险波动，压力重点项：{'、'.join(pressure_risk_items)}。建议优先调度处置。"
        return "甪直分输站存在高风险波动，建议立即组织调度与现场联合复核。"
    if overall_risk == "中":
        if pressure_risk_items:
            return f"甪直分输站存在中风险波动，压力关注项：{'、'.join(pressure_risk_items)}。建议当班重点跟踪。"
        return f"甪直分输站存在中风险波动，关注项：{'、'.join(watched_items) if watched_items else '无'}。"
    if overall_risk == "低":
        return f"甪直分输站整体可控，存在低风险波动项：{'、'.join(watched_items) if watched_items else '无'}。"
    return "甪直分输站关键指标整体平稳，未发现明显异常抬升或突降。"


def _build_luzhi_action_templates(overall_risk: str, evaluated_items: list[dict[str, Any]]) -> tuple[str, str, str]:
    pressure_items = [str(item["label"]) for item in evaluated_items if item.get("type") == "pressure" and item.get("risk_level") in {"中", "高"}]
    dewpoint_items = [str(item["label"]) for item in evaluated_items if item.get("type") == "dewpoint" and item.get("risk_level") in {"中", "高"}]

    if overall_risk == "高":
        schedule = "30分钟内复核上下游输量计划，必要时执行限幅调压。"
        inspection = "优先巡检调压阀、过滤分离及关键测点，确认设备状态。"
        alarm = "触发站级高优先告警并要求值班人员闭环反馈。"
        return schedule, inspection, alarm

    if overall_risk == "中":
        schedule = "当班内复核计划与实时偏差，按小时跟踪波动项。"
        inspection = "按关注项做专项巡检，重点核对压力/露点测点漂移。"
        alarm = "触发中优先告警，连续两次升级则转高优先处理。"
        return schedule, inspection, alarm

    if pressure_items or dewpoint_items:
        schedule = "保持现有调度策略，补充一次短周期复测。"
        inspection = "按低风险项安排例行复核，确认无持续放大趋势。"
        alarm = "保持观察告警，不做升级。"
        return schedule, inspection, alarm

    return "维持当前调度策略。", "按常规频次巡检。", "维持常规告警策略。"


def _infer_luzhi_action_target(snapshot: dict[str, Any], strongest_metric: dict[str, Any] | None) -> dict[str, str]:
    metric_type = str((strongest_metric or {}).get("type") or "pressure")
    if metric_type == "temperature":
        view = "temperature"
    elif metric_type == "dewpoint":
        view = "dewpoint"
    else:
        view = "pressure"

    return {
        "station": _sanitize_action_token_text(str(snapshot.get("station_name") or LUZHI_PILOT_STATION)),
        "view": view,
        "hours": "6",
        "time_start": _sanitize_action_token_text(str(snapshot.get("time_start") or "")),
        "time_end": _sanitize_action_token_text(str(snapshot.get("time_end") or "")),
        "metric": _sanitize_action_token_text(str((strongest_metric or {}).get("label") or "")),
    }


def _persist_luzhi_pilot_trace(
    *,
    user_message: str,
    snapshot: dict[str, Any],
    report_meta: dict[str, Any],
) -> None:
    try:
        LUZHI_TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
        trace_payload = {
            "trace_time": datetime.now(timezone.utc).isoformat(),
            "pilot_enabled_env": os.getenv(LUZHI_PILOT_ENV_KEY, "1"),
            "station": snapshot.get("station_name"),
            "time_start": snapshot.get("time_start"),
            "time_end": snapshot.get("time_end"),
            "user_message": user_message,
            "metric_count": len(snapshot.get("metrics") or []),
            "overall_risk": report_meta.get("overall_risk"),
            "overall_confidence": report_meta.get("overall_confidence"),
            "focused_metric": report_meta.get("focused_metric"),
            "focused_metric_risk": report_meta.get("focused_metric_risk"),
            "action_target": report_meta.get("action_target"),
        }
        with LUZHI_TRACE_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(trace_payload, ensure_ascii=False))
            handle.write("\n")
    except Exception as exc:
        logger.warning("Failed to persist luzhi pilot trace: %s", exc)


def _load_luzhi_pilot_trace(*, limit: int) -> tuple[list[dict[str, Any]], int]:
    if not LUZHI_TRACE_PATH.exists():
        return [], 0

    try:
        raw_lines = LUZHI_TRACE_PATH.read_text(encoding="utf-8").splitlines()
    except Exception as exc:
        logger.warning("Failed to read luzhi pilot trace file: %s", exc)
        return [], 0

    valid_items: list[dict[str, Any]] = []
    for raw_line in raw_lines:
        if not raw_line.strip():
            continue
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            valid_items.append(payload)

    if limit > 0:
        valid_items = valid_items[-limit:]
    valid_items.reverse()
    return valid_items, len(raw_lines)


def _build_luzhi_trace_summary(items: list[dict[str, Any]], *, days: int) -> dict[str, Any]:
    risk_distribution = {"正常": 0, "低": 0, "中": 0, "高": 0}
    metric_counter: dict[str, int] = {}
    metric_risk_counter: dict[str, dict[str, int]] = {}
    metric_latest_risk: dict[str, dict[str, str]] = {}
    confidence_total = 0.0
    confidence_count = 0
    latest_trace_time: str | None = None

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    in_window_items: list[dict[str, Any]] = []

    for item in items:
        trace_dt = _parse_trace_datetime(item.get("trace_time"))
        if trace_dt is None or trace_dt < cutoff:
            continue
        in_window_items.append(item)

        risk = str(item.get("overall_risk") or "").strip()
        if risk in risk_distribution:
            risk_distribution[risk] += 1

        confidence = item.get("overall_confidence")
        if isinstance(confidence, (int, float)):
            confidence_total += float(confidence)
            confidence_count += 1

        metric = str(item.get("focused_metric") or "").strip()
        if metric:
            metric_counter[metric] = metric_counter.get(metric, 0) + 1
            metric_risk = str(item.get("focused_metric_risk") or "").strip()
            metric_risk_bucket = metric_risk_counter.setdefault(metric, {})
            metric_risk_bucket[metric_risk] = metric_risk_bucket.get(metric_risk, 0) + 1

            trace_time_text = str(item.get("trace_time") or "")
            current_latest = metric_latest_risk.get(metric)
            if (
                trace_time_text
                and (
                    current_latest is None
                    or trace_time_text > current_latest.get("latest_trace_time", "")
                )
            ):
                metric_latest_risk[metric] = {
                    "latest_trace_time": trace_time_text,
                    "latest_risk": metric_risk,
                }

        trace_time_text = str(item.get("trace_time") or "")
        if trace_time_text and (latest_trace_time is None or trace_time_text > latest_trace_time):
            latest_trace_time = trace_time_text

    top_metrics = sorted(
        ({"metric": metric, "count": count} for metric, count in metric_counter.items()),
        key=lambda row: row["count"],
        reverse=True,
    )[:5]
    hotspots = _build_luzhi_hotspots(
        metric_counter=metric_counter,
        metric_risk_counter=metric_risk_counter,
        metric_latest_risk=metric_latest_risk,
    )
    continuous_alerts = _build_luzhi_continuous_alerts(in_window_items)

    avg_confidence = (confidence_total / confidence_count) if confidence_count else None
    return {
        "total_in_window": len(in_window_items),
        "risk_distribution": risk_distribution,
        "avg_confidence": avg_confidence,
        "top_metrics": top_metrics,
        "hotspots": hotspots,
        "continuous_alerts": continuous_alerts,
        "latest_trace_time": latest_trace_time,
    }


def _build_luzhi_hotspots(
    *,
    metric_counter: dict[str, int],
    metric_risk_counter: dict[str, dict[str, int]],
    metric_latest_risk: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for metric, count in metric_counter.items():
        risk_counter = metric_risk_counter.get(metric) or {}
        high_risk_count = int(risk_counter.get("高", 0) + risk_counter.get("中", 0))
        latest_meta = metric_latest_risk.get(metric) or {}
        dominant_risk = max(
            risk_counter.items(),
            key=lambda item: (item[1], _risk_rank(item[0])),
            default=("", 0),
        )[0]
        rows.append(
            {
                "metric": metric,
                "count": count,
                "high_risk_count": high_risk_count,
                "high_risk_ratio": round((high_risk_count / count), 4) if count > 0 else 0.0,
                "dominant_risk": dominant_risk,
                "latest_risk": latest_meta.get("latest_risk", ""),
                "latest_trace_time": latest_meta.get("latest_trace_time", ""),
            }
        )

    rows.sort(
        key=lambda row: (
            int(row.get("high_risk_count") or 0),
            int(row.get("count") or 0),
            _risk_rank(str(row.get("latest_risk") or "")),
        ),
        reverse=True,
    )
    return rows[:5]


def _build_luzhi_continuous_alerts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    metric_histories: dict[str, list[tuple[str, str]]] = {}
    for item in items:
        metric = str(item.get("focused_metric") or "").strip()
        if not metric:
            continue
        trace_time_text = str(item.get("trace_time") or "").strip()
        if not trace_time_text:
            continue
        risk = str(item.get("focused_metric_risk") or "").strip()
        metric_histories.setdefault(metric, []).append((trace_time_text, risk))

    alert_rows: list[dict[str, Any]] = []
    for metric, history in metric_histories.items():
        history.sort(key=lambda row: row[0])
        streak = 0
        streak_last_seen = ""
        streak_peak_risk = ""
        for trace_time_text, risk in reversed(history):
            if risk not in {"中", "高"}:
                break
            streak += 1
            if not streak_last_seen:
                streak_last_seen = trace_time_text
            if _risk_rank(risk) > _risk_rank(streak_peak_risk):
                streak_peak_risk = risk

        if streak >= 2:
            alert_rows.append(
                {
                    "metric": metric,
                    "streak": streak,
                    "risk": streak_peak_risk or "中",
                    "last_seen": streak_last_seen,
                }
            )

    alert_rows.sort(
        key=lambda row: (
            int(row.get("streak") or 0),
            _risk_rank(str(row.get("risk") or "")),
            str(row.get("last_seen") or ""),
        ),
        reverse=True,
    )
    return alert_rows[:5]


def _build_luzhi_trace_report_markdown(
    *,
    items: list[dict[str, Any]],
    summary: dict[str, Any],
    days: int,
    recent_limit: int,
) -> str:
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    risk_distribution = summary.get("risk_distribution") if isinstance(summary.get("risk_distribution"), dict) else {}
    avg_confidence = summary.get("avg_confidence")
    avg_confidence_text = f"{float(avg_confidence):.0%}" if isinstance(avg_confidence, (int, float)) else "--"
    total_in_window = int(summary.get("total_in_window") or 0)
    latest_trace_time = _format_time_text(summary.get("latest_trace_time")) or "--"
    top_metrics = summary.get("top_metrics") if isinstance(summary.get("top_metrics"), list) else []
    hotspots = summary.get("hotspots") if isinstance(summary.get("hotspots"), list) else []
    continuous_alerts = summary.get("continuous_alerts") if isinstance(summary.get("continuous_alerts"), list) else []

    top_metrics_text = "、".join(
        f"{_markdown_cell(str(row.get('metric') or '--'))}({int(row.get('count') or 0)})"
        for row in top_metrics
        if isinstance(row, dict)
    ) or "无"
    hotspot_text = "、".join(
        (
            f"{_markdown_cell(str(row.get('metric') or '--'))}"
            f"(中高风险 {int(row.get('high_risk_count') or 0)}/{int(row.get('count') or 0)})"
        )
        for row in hotspots
        if isinstance(row, dict)
    ) or "无"

    lines = [
        "# 甪直站AI试点复盘报告",
        "",
        f"- 生成时间：{generated_at}",
        f"- 统计窗口：最近 {days} 天",
        f"- 纳入记录：{total_in_window}",
        f"- 平均置信度：{avg_confidence_text}",
        f"- 最近分析时间：{latest_trace_time}",
        f"- 高频指标：{top_metrics_text}",
        f"- 异常热点：{hotspot_text}",
        "",
        "## 风险分布",
        "",
        "| 级别 | 次数 |",
        "| --- | ---: |",
        f"| 正常 | {int(risk_distribution.get('正常') or 0)} |",
        f"| 低 | {int(risk_distribution.get('低') or 0)} |",
        f"| 中 | {int(risk_distribution.get('中') or 0)} |",
        f"| 高 | {int(risk_distribution.get('高') or 0)} |",
        "",
        "## 异常热点（按中高风险频次）",
        "",
        "| 指标 | 记录次数 | 中高风险次数 | 占比 | 当前风险 | 最近出现 |",
        "| --- | ---: | ---: | ---: | --- | --- |",
    ]
    if hotspots:
        for row in hotspots:
            if not isinstance(row, dict):
                continue
            ratio = float(row.get("high_risk_ratio") or 0.0)
            lines.append(
                "| {metric} | {count} | {high_risk_count} | {ratio:.0%} | {latest_risk} | {latest_time} |".format(
                    metric=_markdown_cell(str(row.get("metric") or "--")),
                    count=int(row.get("count") or 0),
                    high_risk_count=int(row.get("high_risk_count") or 0),
                    ratio=ratio,
                    latest_risk=_markdown_cell(str(row.get("latest_risk") or "--")),
                    latest_time=_markdown_cell(_format_time_text(row.get("latest_trace_time")) or "--"),
                )
            )
    else:
        lines.append("| -- | 0 | 0 | 0% | -- | -- |")

    lines.extend(
        [
            "",
            "## 连续告警（仅列出连续 >=2 次的指标）",
            "",
            "| 指标 | 连续次数 | 风险峰值 | 最近一次 |",
            "| --- | ---: | --- | --- |",
        ]
    )
    if continuous_alerts:
        for row in continuous_alerts:
            if not isinstance(row, dict):
                continue
            lines.append(
                "| {metric} | {streak} | {risk} | {last_seen} |".format(
                    metric=_markdown_cell(str(row.get("metric") or "--")),
                    streak=int(row.get("streak") or 0),
                    risk=_markdown_cell(str(row.get("risk") or "--")),
                    last_seen=_markdown_cell(_format_time_text(row.get("last_seen")) or "--"),
                )
            )
    else:
        lines.append("| -- | 0 | -- | -- |")

    recent_items = items[: max(1, recent_limit)]
    lines.extend(
        [
            "",
            f"## 最近分析明细（最新 {len(recent_items)} 条）",
            "",
            "| 时间 | 总体风险 | 置信度 | 聚焦指标 | 指标风险 | 用户问题 | 回链动作 |",
            "| --- | --- | ---: | --- | --- | --- | --- |",
        ]
    )
    for item in recent_items:
        if not isinstance(item, dict):
            continue
        confidence = item.get("overall_confidence")
        confidence_text = f"{float(confidence):.0%}" if isinstance(confidence, (int, float)) else "--"
        action_target = item.get("action_target")
        if isinstance(action_target, dict):
            action_text = "/".join(
                part
                for part in [
                    str(action_target.get("view") or "").strip(),
                    str(action_target.get("metric") or "").strip(),
                ]
                if part
            )
        else:
            action_text = ""
        lines.append(
            "| {trace_time} | {overall_risk} | {confidence} | {focused_metric} | {focused_metric_risk} | {user_message} | {action_text} |".format(
                trace_time=_markdown_cell(_format_time_text(item.get("trace_time")) or "--"),
                overall_risk=_markdown_cell(str(item.get("overall_risk") or "--")),
                confidence=confidence_text,
                focused_metric=_markdown_cell(str(item.get("focused_metric") or "--")),
                focused_metric_risk=_markdown_cell(str(item.get("focused_metric_risk") or "--")),
                user_message=_markdown_cell(str(item.get("user_message") or "").replace("\n", " ").strip() or "--"),
                action_text=_markdown_cell(action_text or "--"),
            )
        )

    return "\n".join(lines).strip() + "\n"


def _markdown_cell(raw_text: str) -> str:
    return raw_text.replace("|", "/").replace("\n", " ").strip()


def _risk_rank(risk: str) -> int:
    risk_text = str(risk or "").strip()
    local_order = {"正常": 0, "低": 1, "中": 2, "高": 3}
    if risk_text in local_order:
        return local_order[risk_text]
    return int(LUZHI_RISK_ORDER.get(risk_text, -1))


def _parse_trace_datetime(raw_time: Any) -> datetime | None:
    text = str(raw_time or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _sanitize_action_token_text(raw: str) -> str:
    return raw.replace("|", "/").replace("]", "")


def _format_time_window(snapshot: dict[str, Any]) -> str:
    start = _format_time_text(snapshot.get("time_start"))
    end = _format_time_text(snapshot.get("time_end"))
    if start and end:
        return f"{start} ~ {end}"
    generated_at = _format_time_text(snapshot.get("generated_at"))
    return generated_at or "未提供时间范围"


def _format_time_text(raw_time: Any) -> str:
    text = str(raw_time or "").strip()
    if not text:
        return ""
    return text.replace("T", " ")[:16]


def _format_metric_number(value: float) -> str:
    if abs(value) >= 100:
        return f"{value:.1f}"
    if abs(value) >= 10:
        return f"{value:.2f}"
    return f"{value:.3f}"


def _format_metric_value(value: float, unit: str) -> str:
    return f"{_format_metric_number(value)} {unit}".strip()


def _format_signed_value(value: float, unit: str) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{_format_metric_number(value)} {unit}".strip()


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


async def _collect_chat_response(event_generator) -> ChatResponse:
    reply_parts: list[str] = []
    retrieval_log: list[str] = []

    async for raw_event in event_generator:
        event = raw_event.strip()
        if not event:
            continue

        if event.startswith("[REPLY] "):
            payload = event[8:]
            try:
                parsed = json.loads(payload)
                reply_parts.append(parsed if isinstance(parsed, str) else payload)
            except json.JSONDecodeError:
                reply_parts.append(payload)
            continue

        if event.startswith("[LOG] "):
            retrieval_log.extend(part for part in event[6:].split(", ") if part)

    return ChatResponse(
        reply="".join(reply_parts).strip(),
        retrieval_log=retrieval_log,
    )


async def _legacy_event_generator(request: ChatRequest, session: Session):
    tools_desc = build_tools_description()
    system_prompt = f"{SYSTEM_PROMPT.format(tools_description=tools_desc)}\n{YUQIAN_STYLE_PROMPT}"

    messages = [{"role": "system", "content": system_prompt}]
    for msg in request.history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        full_first_response = ""
        is_tool_call_likely = False
        has_started_replying = False

        async for chunk in ai_client.chat_stream(
            messages=messages,
            temperature=0.7,
        ):
            full_first_response += chunk

            if not has_started_replying and not is_tool_call_likely:
                stripped = full_first_response.strip()
                if "{" in stripped or "```json" in stripped:
                    is_tool_call_likely = True
                else:
                    yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
                    has_started_replying = True
            elif has_started_replying:
                yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"

        tool_call = _extract_tool_call(full_first_response)

        from app.services.pipeline_data_service import pipeline_data_service

        if tool_call:
            tool_name = tool_call["tool"]
            tool_args = tool_call.get("args", {})

            yield f"[TOOL] {tool_name}\n"

            logger.info("Executing assistant tool: %s", tool_name)
            tool_result = execute_tool(tool_name, tool_args, session)

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

            messages.append({"role": "assistant", "content": full_first_response})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"工具 {tool_name} 的执行结果如下：\n\n{tool_result}\n\n"
                        "请根据以上结果，用自然、友好的语言回答用户的原始问题。"
                        "先给结论，再补充必要说明；避免客服腔和模板腔。"
                        "全程保持于谦式口吻：松弛、机灵、尊重用户。"
                        "如果用户要列表，就直接给完整列表。"
                        "最后补一行“完整性提示：是/否 + 原因”。"
                    ),
                }
            )

            full_second_response = ""
            async for chunk in ai_client.chat_stream(
                messages=messages,
                temperature=0.75,
            ):
                full_second_response += chunk
                yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"

            suffix = _build_completeness_suffix(
                reply=full_second_response,
                user_message=request.message,
            )
            if suffix:
                yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"
        else:
            if not has_started_replying:
                cleaned = _strip_think_tags(full_first_response)
                yield f"[REPLY] {json.dumps(cleaned, ensure_ascii=False)}\n"
                suffix = _build_completeness_suffix(
                    reply=cleaned,
                    user_message=request.message,
                )
                if suffix:
                    yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"
            else:
                suffix = _build_completeness_suffix(
                    reply=full_first_response,
                    user_message=request.message,
                )
                if suffix:
                    yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

    except AiServiceError as exc:
        logger.warning("Legacy AI stream service error: %s", exc.message)
        yield f"[REPLY] {json.dumps(exc.message, ensure_ascii=False)}\n"
    except Exception as exc:
        logger.error("Legacy AI stream failed: %s", exc, exc_info=True)
        err_text = f"处理出错：{exc}"
        yield f"[REPLY] {json.dumps(err_text, ensure_ascii=False)}\n"


# ========== 多库并行交叉分析 ==========

_MULTI_SOURCE_KEYWORDS = (
    "为什么", "怎么回事", "对比", "比较", "差异", "可信", "验证",
    "上下游", "拓扑", "仿真", "模拟", "如果", "假设",
    "分析", "诊断", "评估", "综合",
)
_MULTI_SOURCE_METRICS = (
    "压力", "温度", "水露点", "露点", "流量", "输量",
)


def _should_use_multi_source(message: str) -> bool:
    """
    判断用户问题是否适合使用多库并行交叉分析
    触发条件：包含站名 + 包含分析/对比/为什么等关键词 + 包含指标词
    """
    compact = re.sub(r"\s+", "", message)
    # 必须包含指标词
    has_metric = any(kw in compact for kw in _MULTI_SOURCE_METRICS)
    # 必须包含分析类关键词
    has_keyword = any(kw in compact for kw in _MULTI_SOURCE_KEYWORDS)
    # 必须包含站名（简单判断：包含常见站名或"站"字）
    has_station = "站" in compact or any(
        name in compact for name in (
            "中卫", "甪直", "古浪", "上海", "西气东输",
        )
    )
    # 仿真类问题也需要
    has_simulation = any(kw in compact for kw in ("仿真", "模拟", "snapshot", "场景"))
    return (has_metric and has_keyword and has_station) or has_simulation


async def _multi_source_event_generator(request: ChatRequest):
    """
    多库并行交叉分析流式生成器
    输出格式与现有 AI 助手一致：[REPLY] ...\n
    """
    try:
        from app.services.multi_source.orchestrator import multi_source_orchestrator

        result = await multi_source_orchestrator.analyze(request.message)

        # 构建结构化回复
        lines: list[str] = []
        lines.append("## 多库并行分析结论")
        lines.append("")
        lines.append(result.conclusion)
        lines.append("")

        # 证据卡片
        if result.evidence_list:
            lines.append("### 证据来源")
            for ev in result.evidence_list:
                if ev.confidence < 0.3:
                    continue  # 跳过低置信度/失败的证据
                source_label = {
                    "smartgas_db": "主业务库",
                    "scada_history": "时序库",
                    "raw_excel": "Excel索引库",
                    "chroma_db": "规程向量库",
                    "simulation": "仿真快照库",
                }.get(ev.source.value, ev.source.value)
                lines.append(f"- **{source_label}**：{ev.evidence_text}")
            lines.append("")

        # 冲突提示
        if result.conflict_warnings:
            lines.append("### ⚠️ 交叉验证提示")
            for warning in result.conflict_warnings:
                lines.append(f"- {warning}")
            lines.append("")

        # 建议
        if result.suggestions:
            lines.append("### 建议")
            for suggestion in result.suggestions:
                lines.append(f"- {suggestion}")
            lines.append("")

        # 数据来源与缺失
        lines.append("### 数据覆盖")
        if result.data_sources:
            lines.append(f"- 已查询：{', '.join(result.data_sources)}")
        if result.missing_sources:
            lines.append(f"- 未命中：{', '.join(result.missing_sources)}")
        lines.append("")

        # 响应时间
        lines.append(f"*分析耗时：{result.response_time_ms}ms*")

        full_reply = "\n".join(lines)
        full_reply = _append_completeness_hint(
            full_reply,
            request.message,
            is_complete=result.is_complete,
            reason=result.completeness_reason,
        )
        full_reply = _apply_yuqian_style(full_reply)

        yield f"[REPLY] {json.dumps(full_reply, ensure_ascii=False)}\n"

    except Exception as exc:
        logger.error("Multi-source analysis failed: %s", exc, exc_info=True)
        err_text = f"多库并行分析出错：{exc}"
        yield f"[REPLY] {json.dumps(_append_completeness_hint(err_text, request.message), ensure_ascii=False)}\n"


def _subagent_block(payload: dict[str, Any]) -> str:
    return f"[SUBAGENT:{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}]"


async def _yield_subagent_event(payload: dict[str, Any]):
    yield f"[REPLY] {json.dumps(_subagent_block(payload) + chr(10) + chr(10), ensure_ascii=False)}\n"


def _detect_subagent_demo_target(message: str) -> tuple[str, list[str]]:
    compact = re.sub(r"\s+", "", message)
    targets: list[str] = []
    if "甪直" in compact:
        targets.append("甪直联络站")
    if "靖边" in compact:
        targets.append("靖边压气站")
    if "榆林" in compact:
        targets.append("榆林压气站")
    if "中卫" in compact:
        targets.append("中卫压气站")
    if not targets:
        targets.append("当前关注站点")

    if any(word in compact for word in ("仿真", "模拟", "推演", "如果", "假设", "限流", "下降")):
        task_type = "仿真推演"
    elif any(word in compact for word in ("曲线", "历史", "趋势", "压力", "露点", "温度")):
        task_type = "历史曲线分析"
    else:
        task_type = "综合风险分析"
    return task_type, targets


def _is_deterministic_lookup_message(message: str) -> bool:
    compact = re.sub(r"\s+", "", message)
    lookup_patterns = (
        r"有多少",
        r"多少个",
        r"统计",
        r"数量",
        r"列出",
        r"按类型",
        r"分类",
        r"全网概况",
        r"基础设施",
        r"压气站数量",
        r"干线管线",
    )
    risk_patterns = (
        r"风险",
        r"仿真",
        r"推演",
        r"预测",
        r"限流",
        r"异常",
        r"是否存在风险",
        r"需不需要关注",
        r"需要关注",
    )
    return any(re.search(pattern, compact) for pattern in lookup_patterns) and not any(
        re.search(pattern, compact) for pattern in risk_patterns
    )


def _collect_subagent_evidence(message: str, session: Session) -> dict[str, Any]:
    task_type, targets = _detect_subagent_demo_target(message)
    evidence: dict[str, Any] = {
        "task_type": task_type,
        "targets": targets,
        "demo_mode": True,
        "junctions": [],
        "stations": [],
        "pipeline_count": 0,
    }

    try:
        from app.services.junction_groups import load_runtime_junction_groups

        junctions = load_runtime_junction_groups(session)
        target_keywords = {target.replace("压气站", "").replace("联络站", "").replace("站", "") for target in targets}
        for group in junctions:
            name = str(group.get("name") or "")
            if any(keyword and keyword in name for keyword in target_keywords):
                evidence["junctions"].append({
                    "name": name,
                    "station_ids": group.get("station_ids", []),
                    "system_ids": group.get("system_ids", []),
                    "member_count": group.get("member_count", 0),
                    "junction_kind": group.get("junction_kind", "junction"),
                })
    except Exception as exc:
        logger.warning("collect subagent junction evidence failed: %s", exc)

    try:
        station_rows = session.exec(select(Station)).all()
        target_keywords = {target.replace("压气站", "").replace("联络站", "").replace("站", "") for target in targets}
        for station in station_rows:
            if any(keyword and keyword in station.name for keyword in target_keywords):
                evidence["stations"].append({
                    "id": station.id,
                    "name": station.name,
                    "type": station.type,
                    "longitude": station.longitude,
                    "latitude": station.latitude,
                })
    except Exception as exc:
        logger.warning("collect subagent station evidence failed: %s", exc)

    try:
        evidence["pipeline_count"] = len(session.exec(select(Pipeline)).all())
    except Exception:
        pass

    return evidence


async def _deterministic_lookup_event_generator(request: ChatRequest, session: Session):
    direct_count_reply = try_raw_excel_direct_count_reply(request.message.strip())
    direct_list_reply = try_raw_excel_direct_list_reply(request.message.strip())
    direct_lookup_reply = try_raw_excel_direct_entity_lookup(request.message.strip())
    if _is_raw_excel_negative_lookup(direct_lookup_reply):
        direct_lookup_reply = None

    reply_text = direct_count_reply or direct_list_reply or direct_lookup_reply or ""
    if not reply_text:
        reply_text = "当前命中的是确定性查询，但暂时没有取到直出结果。"

    reply_text = _apply_yuqian_style(
        _append_completeness_hint(
            reply_text,
            request.message,
            is_complete=True,
            reason="确定性查询已直接走数据库口径，不进入完整 SubAgent 专家组。",
        )
    )

    targets: list[str] = []
    for keyword, label in (
        ("中卫", "中卫压气站"),
        ("靖边", "靖边压气站"),
        ("甪直", "甪直联络站"),
        ("白鹤", "白鹤末站"),
        ("压气站", "压气站"),
    ):
        if keyword in request.message and label not in targets:
            targets.append(label)
    if not targets:
        targets.append("确定性查询对象")

    async for event in _yield_subagent_event({
        "agent": "deterministic-lookup",
        "title": "确定性查询 Agent",
        "icon": "database",
        "status": "completed",
        "tool": "raw_excel_index",
        "message": "已按数据库口径直出结果，不进入完整专家组。",
        "steps": [
            "识别这是确定性查询",
            "调用原始索引或站点统计",
            "直接返回数据库口径",
        ],
        "evidence": [
            f"目标：{'、'.join(targets)}",
            "枢纽命中：0 个",
            "站点命中：0 个",
        ],
        "action": "直出结果",
    }):
        yield event

    yield f"[REPLY] {json.dumps(chr(10) + reply_text, ensure_ascii=False)}\n"
    yield "[DONE]\n"


def _fallback_subagent_brief(agent_title: str, evidence: dict[str, Any]) -> str:
    targets = "、".join(str(item) for item in evidence.get("targets", [])) or "当前关注站点"
    junction_count = len(evidence.get("junctions", []))
    station_count = len(evidence.get("stations", []))

    fallback_map = {
        "主控 Agent": (
            f"结论：本次按“{evidence.get('task_type', '综合风险分析')}”编排，目标锁定 {targets}。"
            "依据：需要同时看历史曲线、拓扑关系、仿真场景和复核意见。"
        ),
        "历史曲线 Agent": (
            f"结论：已触发自动调曲线流程，优先读取 {targets} 的压力、流量和温度趋势。"
            "依据：真实曲线数据不足时，只展示取数动作和待补指标，不硬判异常。"
        ),
        "拓扑分析 Agent": (
            f"结论：已把 {targets} 放到运行时拓扑里检查，当前命中枢纽 {junction_count} 个、站点 {station_count} 个。"
            "依据：影响范围要按上下游连接关系判断。"
        ),
        "仿真推演 Agent": (
            "结论：演示流程已进入自动仿真场景，准备做压力下降/供气路径变化推演。"
            "依据：生产级计算还需要实时压力、流量和边界条件，缺数据时只标注为演示推演。"
        ),
        "风险复核 Agent": (
            "结论：复核重点是防止把演示推演说成真实未来。"
            "依据：风险等级、安全阈值和调度建议必须绑定实时数据或明确假设。"
        ),
        "业务表达复核 Agent": (
            "结论：已把前面 Agent 的结果统一成业务口径。"
            "依据：最终答复按“结论、依据、影响、建议、待复核项、边界说明”收口，数据不足处必须明说。"
        ),
    }
    return fallback_map.get(agent_title, "结论：本 Agent 已完成阶段检查；依据：当前只展示公开工作轨迹和可审计证据。")


def _sanitize_subagent_brief(text: str, agent_title: str, evidence: dict[str, Any]) -> str:
    cleaned = _strip_think_tags(text or "").strip()
    cleaned = re.sub(r"^```(?:text|markdown)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE).strip()
    if not cleaned:
        return _fallback_subagent_brief(agent_title, evidence)

    lines = [line.strip(" -*#\t") for line in cleaned.splitlines()]
    lines = [line for line in lines if line]
    cleaned = " ".join(lines).strip()
    if not cleaned:
        return _fallback_subagent_brief(agent_title, evidence)
    cleaned = cleaned.replace("**", "").replace("demo_mode=true", "演示模式")
    if len(cleaned) > 180:
        cleaned = cleaned[:177].rstrip("，。；、 ") + "..."
    cleaned = re.sub(r"(依据|结论|建议|说明)[:：]?\s*(?:\.\.\.)?$", "", cleaned).strip()
    return cleaned


def _build_subagent_showcase_final_reply(
    *,
    user_message: str,
    evidence: dict[str, Any],
    results: list[dict[str, str]],
) -> str:
    task_type = str(evidence.get("task_type") or "综合风险分析")
    targets = [str(item) for item in evidence.get("targets", []) if str(item).strip()]
    target_text = "、".join(targets) or "当前关注站点"
    junctions = evidence.get("junctions", []) or []
    stations = evidence.get("stations", []) or []
    pipeline_count = int(evidence.get("pipeline_count") or 0)
    system_ids = sorted({
        str(system_id)
        for junction in junctions
        for system_id in (junction.get("system_ids") or [])
        if str(system_id).strip()
    })
    system_text = "、".join(system_ids) if system_ids else "待运行时拓扑补齐"
    has_target_match = bool(junctions or stations)

    compact = re.sub(r"\s+", "", user_message)
    is_flow_limit = any(word in compact for word in ("限流", "降量", "降输", "下降", "截断"))
    scenario_name = "中卫-靖边限流推演" if ("中卫" in compact and "靖边" in compact) else f"{target_text}{task_type}"
    next_action_line = (
        "补充限流比例、压力边界和下游需求后，可重新触发仿真并生成曲线。"
        if is_flow_limit
        else "补充目标站点、实时边界条件和历史曲线后，可重新生成可计算分析结果。"
    )
    evidence_line = (
        f"已命中 {len(junctions)} 个枢纽、{len(stations)} 个站点、{pipeline_count} 条管线，涉及系统：{system_text}。"
        if has_target_match
        else f"未命中与“{target_text}”直接对应的枢纽或站点；当前仅能读取全网管线规模 {pipeline_count} 条，尚不能确认该对象的上下游影响范围。"
    )
    if has_target_match and is_flow_limit:
        conclusion_text = (
            f"{scenario_name}已完成演示分析。按默认演示边界“中卫侧供气能力下调至 80%”理解，"
            "当前应判为“重点关注、需复核后再定级”：中卫侧是上游压气与输送能力约束点，靖边侧关联多系统分输，"
            "限流影响更可能表现为靖边入口压力余量收紧、下游分输可用量下降和跨系统调配压力上升。"
        )
        business_judgement = (
            "影响链条可以这么看：中卫侧先出现输送能力收缩，随后沿中卫至靖边方向传导；"
            "靖边作为多系统节点，会把压力和流量缺口继续分摊到相关下游路径。"
            "当前没有实时压力、限流比例、压缩机边界和下游需求，所以这里给的是演示场景判断，不是生产风险等级。"
        )
        simulation_summary = (
            "- 仿真推演：已按演示边界进入场景推演；默认关注中卫出口压力、靖边入口压力、下游可供流量和供气缺口曲线。"
        )
    else:
        conclusion_text = (
            f"{target_text}需要作为重点关注对象。依据是：目标对象已进入运行时拓扑匹配，且关联多系统、多站点关系；若发生限流或边界变化，影响可能沿上下游扩散。当前仍缺少实时压力、流量、限流比例和压缩机边界，所以不能直接给真实“高/中/低”风险定级。"
            if has_target_match
            else f"当前不能对{target_text}给出风险等级。原因很直接：系统没有命中具体枢纽或站点，缺少可定位对象、实时压力、流量、限流比例和上下游边界，不能把全网管线规模当成该站风险依据。"
        )
        business_judgement = conclusion_text
        simulation_summary = "- 仿真推演：已进入场景准备；真实压降、流量和供气缺口必须由仿真模型按边界条件计算。"
    topology_summary = (
        f"- 拓扑分析：已命中 {len(junctions)} 个枢纽、{len(stations)} 个站点，目标对象已进入运行时拓扑。"
        if has_target_match
        else "- 拓扑分析：未命中具体枢纽或站点，影响范围暂不能确认。"
    )
    if has_target_match and is_flow_limit:
        suggestion_lines = [
            "1. 演示时先采用默认场景：中卫侧供气能力下调至 80%，观察靖边入口压力和下游可供量变化。",
            "2. 重点看三条曲线：中卫出口压力、靖边入口压力、靖边下游分输流量；若三者同步走弱，说明限流影响正在传导。",
            "3. 调度动作建议按“先保压力、再调流量、最后切路径”排序：先稳靖边入口压力，再压减非关键分输需求，必要时启用替代供气路径。",
        ]
    elif has_target_match:
        suggestion_lines = [
            "1. 先读取目标站点近 12-24 小时压力、流量、温度和压缩机工况数据。",
            "2. 对照上下游拓扑和历史基线，确认异常是单站波动还是沿线传导。",
            "3. 明确仿真边界条件，再让仿真 Agent 输出压降、流量和供气缺口曲线。",
        ]
    else:
        suggestion_lines = [
            "1. 先补齐目标站点或管段的唯一标识，避免站名泛化导致误判。",
            "2. 接入近 12-24 小时压力、流量、温度和压缩机工况数据。",
            "3. 明确仿真边界条件，再让仿真 Agent 输出压降、流量和供气缺口曲线。",
        ]

    agent_summary = [
        f"- 主控：已识别“{task_type}”任务，并把目标锁定到 {target_text}。",
        "- 历史曲线：已触发自动调曲线动作；生产级分析还要接入压力、流量、温度等时序数据。",
        topology_summary,
        simulation_summary,
        "- 风险复核：当前只给“重点关注”判断，不给真实风险等级，避免把演示推演说成生产事实。",
        "- 业务表达复核：已按统一格式收口，避免缺依据、过度自信和把仿真推演说成生产事实。",
    ]
    reply_sections = [
        "结论：",
        conclusion_text,
        "",
        "依据：",
        f"平台已将问题拆成主控编排、历史曲线、拓扑分析、仿真推演、风险复核和业务表达复核六步。{evidence_line}",
        "",
        "影响：",
        business_judgement,
        "",
        "建议：",
        *suggestion_lines,
        "",
        "待复核项：",
        *agent_summary,
        "",
    ]
    if targets:
        reply_sections.extend([
            "可视化动作：",
            "历史曲线入口已在历史曲线 Agent 后生成，评审时可直接点击按钮打开；这里不重复输出动作标记。",
            "",
        ])

    reply_sections.extend([
        "边界说明：",
        f"{next_action_line}在这些数据补齐前，当前结论只能作为分析流程结果和风险关注提示，不能作为真实调度指令。",
    ])
    return "\n".join(reply_sections)


async def _call_subagent_brief(
    agent_title: str,
    user_message: str,
    evidence: dict[str, Any],
    instruction: str,
    prior_results: list[dict[str, str]] | None = None,
) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                f"你是 SmartGas Grid 的{agent_title}。"
                "你只输出可展示给用户看的工作结论，不输出隐藏推理。"
                "必须基于给定证据说话；没有数据就明确说缺什么。"
                "用中文，1-2 句，先结论后依据。不要输出 Markdown 标题、表格或项目符号。"
                "这是评审演示模式：可以说流程已触发，但不能把缺数据的演示推演说成真实生产结论。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"用户问题：{user_message}\n"
                f"当前证据：{json.dumps(evidence, ensure_ascii=False)}\n"
                f"前序 Agent 结果：{json.dumps(prior_results or [], ensure_ascii=False)}\n"
                f"你的任务：{instruction}"
            ),
        },
    ]
    try:
        result = await ai_client.chat_completion(messages=messages, temperature=0.35, max_tokens=320)
        return _sanitize_subagent_brief(result, agent_title, evidence)
    except Exception as exc:
        logger.warning("subagent %s failed: %s", agent_title, exc)
        return _fallback_subagent_brief(agent_title, evidence)


async def _subagent_showcase_event_generator(request: ChatRequest, session: Session):
    """
    在 AI 窗口内演绎 SubAgent 协作过程。
    这里展示的是可审计工作轨迹：任务、工具动作、证据和结论，不暴露模型隐藏推理。
    """
    user_message = request.message.strip()
    evidence = _collect_subagent_evidence(user_message, session)
    task_type = evidence.get("task_type", "综合风险分析")
    targets = evidence.get("targets", [])

    intro = (
        f"先撂准话：我按 SubAgent 专家组来跑这次“{task_type}”。"
        "下面能看到每个 Agent 的任务、动作和阶段结果；仿真由模型/接口算，最后由业务表达复核 Agent 统一口径。\n\n"
    )
    yield f"[REPLY] {json.dumps(intro, ensure_ascii=False)}\n"

    agents = [
        {
            "id": "controller",
            "title": "主控 Agent",
            "icon": "account_tree",
            "tool": "任务识别与编排",
            "instruction": "判断这个问题要调哪些专业 Agent，指出目标站点和任务类型。",
            "steps": ["识别用户意图", "拆分专业任务", "分配历史、拓扑、仿真、复核和表达 Agent"],
        },
        {
            "id": "history",
            "title": "历史曲线 Agent",
            "icon": "show_chart",
            "tool": "历史曲线/SCADA 查询",
            "instruction": "判断是否需要调曲线，并说明会读取哪些历史指标。",
            "steps": ["定位目标站点", "准备读取 12-24h 历史曲线", "对比历史基线与当前状态"],
            "action": "自动调曲线",
        },
        {
            "id": "topology",
            "title": "拓扑分析 Agent",
            "icon": "hub",
            "tool": "运行时枢纽与上下游拓扑",
            "instruction": "基于站点、枢纽和管线证据，说明目标节点关联哪些系统和影响范围。",
            "steps": ["读取运行时枢纽", "展开成员站点", "识别关联管线和上下游"],
        },
        {
            "id": "simulation",
            "title": "仿真推演 Agent",
            "icon": "science",
            "tool": "稳态仿真场景选择",
            "instruction": "按评审演示口径说明已进入自动仿真演示流程，同时说明真实计算需要哪些输入、输出和不能编造的边界。",
            "steps": ["识别仿真场景", "准备边界条件", "等待稳态模型返回压降/流量结果"],
            "action": "自动开启仿真演示",
        },
        {
            "id": "review",
            "title": "风险复核 Agent",
            "icon": "fact_check",
            "tool": "一致性与不确定性检查",
            "instruction": "复核前面 Agent 的结论，指出数据缺口、仿真假设和不能下绝对结论的地方。",
            "steps": ["检查数据缺口", "检查曲线与拓扑是否冲突", "标注仿真假设"],
        },
        {
            "id": "business_expression",
            "title": "业务表达复核 Agent",
            "icon": "record_voice_over",
            "tool": "Skill 统一业务表达",
            "instruction": "作为最后一个 SubAgent，基于前序结果统一业务口径：先说结论，再给依据、影响、建议、待复核项和边界说明；不得新增事实，不把仿真推演说成真实未来。",
            "steps": ["汇总前序 Agent 结果", "压住过度判断", "转换成业务可执行语言"],
            "action": "统一口径",
        },
    ]

    results: list[dict[str, str]] = []
    for agent in agents:
        async for event in _yield_subagent_event({
            "agent": agent["id"],
            "title": agent["title"],
            "icon": agent["icon"],
            "status": "running",
            "tool": agent["tool"],
            "message": f"{agent['title']}已启动，正在处理：{agent['tool']}。",
            "steps": agent["steps"],
            "action": agent.get("action"),
        }):
            yield event

        await asyncio.sleep(0.18)
        summary = await _call_subagent_brief(
            agent_title=agent["title"],
            user_message=user_message,
            evidence=evidence,
            instruction=agent["instruction"],
            prior_results=results,
        )
        results.append({"agent": agent["title"], "summary": summary})

        async for event in _yield_subagent_event({
            "agent": agent["id"],
            "title": agent["title"],
            "icon": agent["icon"],
            "status": "completed" if "暂时不可用" not in summary else "warning",
            "tool": agent["tool"],
            "message": summary,
            "steps": agent["steps"],
            "evidence": [
                f"目标：{'、'.join(str(item) for item in targets)}",
                f"枢纽命中：{len(evidence.get('junctions', []))} 个",
                f"站点命中：{len(evidence.get('stations', []))} 个",
            ],
            "action": agent.get("action"),
        }):
            yield event

        if agent["id"] == "history" and targets:
            history_action_reply = _build_history_curve_action_reply(str(targets[0]), "pressure")
            yield f"[REPLY] {json.dumps(chr(10) + chr(10) + history_action_reply, ensure_ascii=False)}\n"

        await asyncio.sleep(0.12)

    final_reply = _build_subagent_showcase_final_reply(
        user_message=user_message,
        evidence=evidence,
        results=results,
    )

    final_reply = _append_completeness_hint(
        final_reply,
        request.message,
        is_complete=True,
        reason="已完成 SubAgent 分工演示、工具证据整理和最终汇总。",
    )
    yield f"[REPLY] {json.dumps(chr(10) + final_reply, ensure_ascii=False)}\n"
    yield "[DONE]\n"


async def _universal_search_event_generator(message: str, session: Session):
    yield "[TOOL] universal_search\n"
    tool_result = execute_tool(
        "universal_search",
        {"query": message, "limit": 10, "include_knowledge": True},
        session,
    )
    prompt = (
        "用户的问题先被 raw_excel 快速索引判定为未命中，所以系统改用全域检索。"
        "下面是全域检索结果，请用中文人话回答用户。"
        "要求：先说结论；说明哪些库命中了；如果没命中，要说已经查过哪些来源；"
        "不要说成系统没有，除非所有来源都没命中。\n\n"
        f"用户原话：{message}\n\n"
        f"{tool_result}"
    )
    try:
        async for chunk in ai_client.chat_stream(prompt=prompt, temperature=0.45, max_tokens=1200):
            yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
    except Exception as exc:
        logger.warning("Universal search AI summary failed: %s", exc)
        yield f"[REPLY] {json.dumps(tool_result, ensure_ascii=False)}\n"


async def _operation_procedure_event_generator(message: str, session: Session):
    doc_type = _detect_knowledge_doc_type(message)
    yield "[TOOL] search_knowledge_base\n"
    tool_result = execute_tool(
        "search_knowledge_base",
        {"query": message, "limit": 8, "doc_type": doc_type},
        session,
    )

    no_hit = "未检索到足够相关" in tool_result or "执行出错" in tool_result
    if no_hit:
        reply_text = "\n".join([
            "结论：当前规程库没有命中足够可靠的依据，不能硬编操作步骤。",
            "",
            "已查询：",
            f"- 文档类型：{doc_type}",
            f"- 查询问题：{message}",
            "",
            "建议补充：管线名称、站场名称、作业类型，比如“西三线 中卫站 放空操作规程”。",
        ])
        reply_text = _append_completeness_hint(
            reply_text,
            message,
            is_complete=False,
            reason="规程库未命中足够证据，已给出补充检索条件。",
        )
        yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
        yield "[DONE]\n"
        return

    structured_reply = _format_operation_procedure_result(message, tool_result, doc_type)
    structured_reply = _append_completeness_hint(
        structured_reply,
        message,
        is_complete=True,
        reason="已完成规程库命中、关键词重排和结构化收口。",
    )
    yield f"[REPLY] {json.dumps(_apply_yuqian_style(structured_reply), ensure_ascii=False)}\n"
    yield "[DONE]\n"


async def _orchestrated_event_generator(request: ChatRequest, session: Session):
    tools_desc = build_tools_description()
    prompt_bundle = ai_analysis_orchestrator.prepare_messages(
        system_prompt_template=SYSTEM_PROMPT,
        tools_description=tools_desc,
        history=request.history,
        message=request.message,
        context=request.context,
        analysis_mode=request.analysis_mode,
    )

    from app.services.pipeline_data_service import pipeline_data_service

    try:
        conversation_messages = list(prompt_bundle.messages)
        first_response = await ai_client.chat_completion(
            messages=conversation_messages,
            temperature=0.7,
            max_tokens=2000,
        )

        tool_call = _extract_tool_call(first_response)
        tool_name: str | None = None
        tool_result: str | None = None

        if tool_call:
            tool_name = tool_call["tool"]
            tool_args = tool_call.get("args", {})
            yield f"[TOOL] {tool_name}\n"

            logger.info("Executing orchestrated assistant tool: %s", tool_name)
            tool_result = execute_tool(tool_name, tool_args, session)

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

            conversation_messages.append({"role": "assistant", "content": first_response})
            conversation_messages.append(
                {
                    "role": "user",
                    "content": ai_analysis_orchestrator.build_tool_result_follow_up(
                        tool_name=tool_name,
                        tool_result=tool_result,
                        context_summary=prompt_bundle.context_summary,
                    ),
                }
            )
            draft_reply = await ai_client.chat_completion(
                messages=conversation_messages,
                temperature=0.75,
                max_tokens=2000,
            )
        else:
            draft_reply = _strip_think_tags(first_response)
            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

        validation_report = ai_analysis_orchestrator.validate_reply(
            user_message=request.message,
            reply=draft_reply,
            tool_name=tool_name,
            tool_result=tool_result,
            context_summary=prompt_bundle.context_summary,
        )

        final_reply = _salvage_user_facing_reply(draft_reply, first_response) or _strip_think_tags(draft_reply)
        can_run_rebuttal = bool(prompt_bundle.use_orchestration)
        if validation_report.requires_revision:
            conversation_messages.append({"role": "assistant", "content": draft_reply})
            conversation_messages.append(
                {
                    "role": "user",
                    "content": ai_analysis_orchestrator.build_repair_prompt(
                        original_question=request.message,
                        draft_reply=draft_reply,
                        validation_report=validation_report,
                    ),
                }
            )
            repaired_reply = await ai_client.chat_completion(
                messages=conversation_messages,
                temperature=0.45,
                max_tokens=2000,
            )
            repaired_validation = ai_analysis_orchestrator.validate_reply(
                user_message=request.message,
                reply=repaired_reply,
                tool_name=tool_name,
                tool_result=tool_result,
                context_summary=prompt_bundle.context_summary,
            )

            if repaired_validation.requires_revision:
                logger.warning("Orchestrated repair reply still failed validation")
                final_reply = _salvage_user_facing_reply(repaired_reply, draft_reply, first_response) or (
                    "抱歉，这次结果还不够稳定。"
                    "我先没法给你一个可靠结论。"
                    "你可以换个问法，或者告诉我当前页面和对象，我再重新分析。"
                )
                can_run_rebuttal = False
            else:
                final_reply = _salvage_user_facing_reply(repaired_reply, draft_reply) or _strip_think_tags(repaired_reply)

        if can_run_rebuttal:
            try:
                debate_messages = list(conversation_messages)
                debate_messages.append({"role": "assistant", "content": final_reply})
                debate_messages.append(
                    {
                        "role": "user",
                        "content": ai_analysis_orchestrator.build_yuqian_rebuttal_prompt(
                            original_question=request.message,
                            candidate_reply=final_reply,
                        ),
                    }
                )
                rebuttal_reply = await ai_client.chat_completion(
                    messages=debate_messages,
                    temperature=0.45,
                    max_tokens=1200,
                )
                debate_messages.append({"role": "assistant", "content": rebuttal_reply})
                debate_messages.append(
                    {
                        "role": "user",
                        "content": ai_analysis_orchestrator.build_post_rebuttal_finalize_prompt(
                            original_question=request.message,
                            candidate_reply=final_reply,
                            rebuttal_reply=rebuttal_reply,
                        ),
                    }
                )
                debated_final_reply = await ai_client.chat_completion(
                    messages=debate_messages,
                    temperature=0.45,
                    max_tokens=2000,
                )
                debated_candidate = _salvage_user_facing_reply(debated_final_reply, final_reply) or _strip_think_tags(debated_final_reply)
                debated_validation = ai_analysis_orchestrator.validate_reply(
                    user_message=request.message,
                    reply=debated_candidate,
                    tool_name=tool_name,
                    tool_result=tool_result,
                    context_summary=prompt_bundle.context_summary,
                )
                if debated_validation.requires_revision:
                    logger.warning("Orchestrated rebuttal reply failed validation, fallback to pre-rebuttal answer")
                else:
                    final_reply = debated_candidate
            except Exception as debate_exc:
                logger.warning("Orchestrated rebuttal stage skipped: %s", debate_exc)

        final_reply = _append_completeness_hint(final_reply, request.message)
        final_reply = _apply_yuqian_style(final_reply)
        yield f"[REPLY] {json.dumps(final_reply, ensure_ascii=False)}\n"
    except AiServiceError as exc:
        logger.warning("Orchestrated AI flow service error: %s", exc.message)
        yield f"[REPLY] {json.dumps(_append_completeness_hint(exc.message, request.message), ensure_ascii=False)}\n"
    except Exception as exc:
        logger.error("Orchestrated AI flow failed: %s", exc, exc_info=True)
        err_text = f"处理出错：{exc}"
        yield f"[REPLY] {json.dumps(_append_completeness_hint(err_text, request.message), ensure_ascii=False)}\n"


def _messages_to_prompt(messages: list[dict]) -> str:
    prompt_parts = []
    for msg in messages:
        role_label = {"system": "[系统]", "user": "[用户]", "assistant": "[助手]"}.get(msg["role"], "")
        prompt_parts.append(f"{role_label} {msg['content']}")
    return "\n\n".join(prompt_parts)


async def _call_ai(messages: list[dict]) -> str:
    result = await ai_client.chat_completion(
        messages=messages,
        temperature=0.7,
        max_tokens=2000,
    )
    return result.strip()


def _extract_tool_call(response: str) -> dict | None:
    text = response.strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict) and "tool" in data:
            return data
    except json.JSONDecodeError:
        pass

    if "```" in text:
        try:
            start = text.index("```")
            content_start = text.index("\n", start) + 1
            end = text.index("```", content_start)
            json_str = text[content_start:end].strip()
            data = json.loads(json_str)
            if isinstance(data, dict) and "tool" in data:
                return data
        except (ValueError, json.JSONDecodeError):
            pass

    pattern = r'\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}'
    match = re.search(pattern, text)
    if match:
        try:
            data = json.loads(match.group())
            if "tool" in data:
                return data
        except json.JSONDecodeError:
            pass

    return None


def _strip_think_tags(text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    return cleaned.strip()


def _salvage_user_facing_reply(*candidates: str | None) -> str | None:
    for candidate in candidates:
        cleaned = _clean_model_reply(candidate)
        if _is_usable_user_reply(cleaned):
            return cleaned
    return None


def _clean_model_reply(text: str | None) -> str:
    if not text:
        return ""

    cleaned = _strip_think_tags(text)
    cleaned = re.sub(
        r"```(?:json)?\s*([\s\S]*?)```",
        lambda match: _strip_tool_block(match.group(1)),
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\{[\s\S]*?\"tool\"\s*:\s*\"[^\"]+\"[\s\S]*?\}", "", cleaned)

    filtered_lines: list[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            filtered_lines.append("")
            continue

        if _looks_like_tool_payload_fragment(line):
            continue

        filtered_lines.append(raw_line)

    cleaned = "\n".join(filtered_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip("` \n\t")


def _strip_tool_block(block: str) -> str:
    content = block.strip()
    if _looks_like_raw_tool_payload(content):
        return ""
    return content


def _looks_like_tool_payload_fragment(line: str) -> bool:
    stripped = line.strip().strip(",")
    if not stripped:
        return False

    fragment_markers = (
        '"tool"',
        '"args"',
        "```json",
        "```",
        "调用工具",
        "工具调用",
        "call_tool",
    )
    if any(marker in stripped for marker in fragment_markers):
        return True

    return stripped in {"{", "}", "[", "]"}


def _is_usable_user_reply(text: str) -> bool:
    if not text or len(text) < 6:
        return False
    if "<think>" in text or "</think>" in text:
        return False
    if _looks_like_raw_tool_payload(text):
        return False

    meta_only_patterns = (
        "我来调用",
        "先调用",
        "让我调用",
        "我先查一下",
        "正在调用",
    )
    return not any(pattern in text and len(text) <= 18 for pattern in meta_only_patterns)


def _looks_like_raw_tool_payload(text: str) -> bool:
    content = (text or "").strip()
    if not content:
        return False

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, dict) and "tool" in payload:
        return True

    return '"tool"' in content and content.lstrip().startswith("{")


def _append_completeness_hint(
    reply: str,
    user_message: str,
    *,
    is_complete: bool | None = None,
    reason: str | None = None,
) -> str:
    if not reply:
        return reply
    if "完整性提示：" in reply:
        return reply

    resolved_is_complete = is_complete
    resolved_reason = reason
    if resolved_is_complete is None:
        resolved_is_complete, resolved_reason = _infer_completeness(reply, user_message)

    status = "是" if resolved_is_complete else "否"
    detail = resolved_reason or ("已给出完整回答。" if resolved_is_complete else "当前回答还不够完整。")
    return f"{reply.rstrip()}\n\n完整性提示：{status}，{detail}"


def _build_completeness_suffix(reply: str, user_message: str) -> str:
    if not reply or "完整性提示：" in reply:
        return ""
    is_complete, reason = _infer_completeness(reply, user_message)
    status = "是" if is_complete else "否"
    return f"\n\n完整性提示：{status}，{reason}"


def _infer_completeness(reply: str, user_message: str) -> tuple[bool, str]:
    content = (reply or "").strip()
    if not content:
        return False, "当前没有生成有效内容。"

    incomplete_markers = (
        "抱歉，这次结果还不够稳定",
        "我先没法给你一个可靠结论",
        "要完整列表可以告诉我",
        "只显示前",
        "仅显示前",
        "还有 ",
        "未显示",
        "可以继续往下查",
        "可以继续补充",
        "你如果说的是其中一个",
    )
    if any(marker in content for marker in incomplete_markers):
        return False, "当前回复里仍有省略或待补充项。"

    if _user_asks_for_list(user_message) and not _reply_has_list(content):
        return False, "你这次问的是列表，但回复里没有按列表完整展开。"

    if "AI 服务" in content or "处理出错" in content:
        return False, "当前链路报错，没法确认回答完整。"

    return True, "按当前数据和上下文，未检测到明显缺项。"


def _user_asks_for_list(message: str) -> bool:
    text = re.sub(r"\s+", "", message or "")
    if not text:
        return False
    keywords = ("列表", "清单", "列出", "全部", "所有", "有哪些")
    return any(keyword in text for keyword in keywords)


def _user_asks_for_count(message: str) -> bool:
    text = re.sub(r"\s+", "", message or "")
    if not text:
        return False
    keywords = ("多少", "几座", "几个", "几条", "几处")
    return any(keyword in text for keyword in keywords)


def _reply_has_list(reply: str) -> bool:
    lines = [line.strip() for line in (reply or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    return any(
        re.match(r"^(?:[-*•]\s+|\d+\.\s+)", line)
        for line in lines
    )


def _try_direct_count_reply(message: str, session: Session) -> str | None:
    count_request = _parse_direct_collection_request(message, session)
    if not count_request or not _user_asks_for_count(message):
        return None

    if count_request["kind"] == "stations":
        stations = _query_station_collection(session, count_request)
        return _format_station_count_reply(
            stations=stations,
            label=count_request["label"],
            scope_label=count_request.get("scope_label"),
            user_message=message,
        )

    pipelines = _query_pipeline_collection(session, count_request)
    return _format_pipeline_count_reply(
        pipelines=pipelines,
        label=count_request["label"],
        scope_label=count_request.get("scope_label"),
        session=session,
        user_message=message,
    )


def _try_direct_list_reply(message: str, session: Session) -> str | None:
    list_request = _parse_direct_collection_request(message, session)
    if not list_request:
        return None

    kind = list_request["kind"]
    label = list_request["label"]

    if kind == "stations":
        stations = _query_station_collection(session, list_request)
        return _format_station_list_reply(
            stations=stations,
            label=label,
            include_type=list_request.get("station_type") is None,
            scope_label=list_request.get("scope_label"),
            user_message=message,
        )

    pipelines = _query_pipeline_collection(session, list_request)
    return _format_pipeline_list_reply(
        pipelines=pipelines,
        label=label,
        session=session,
        scope_label=list_request.get("scope_label"),
        user_message=message,
    )


def _parse_direct_collection_request(message: str, session: Session) -> dict[str, str] | None:
    if not (_user_asks_for_list(message) or _user_asks_for_count(message)):
        return None

    normalized = re.sub(r"\s+", "", message or "")
    scope = _extract_pipeline_scope(normalized, session)

    station_patterns = [
        ("compressor", "压气站"),
        ("distribution", "分输站"),
        ("source", "气源站"),
        ("valve", "阀室"),
    ]
    for station_type, label in station_patterns:
        if label in normalized:
            request = {"kind": "stations", "station_type": station_type, "label": label}
            if scope:
                request.update(scope)
            return request

    if "站场" in normalized or "站点" in normalized:
        request = {"kind": "stations", "label": "站场"}
        if scope:
            request.update(scope)
        return request

    pipeline_patterns = [
        ("trunk", "干线"),
        ("branch", "支线"),
    ]
    for category, label in pipeline_patterns:
        if label in normalized:
            request = {"kind": "pipelines", "category": category, "label": label}
            if scope:
                request.update(scope)
            return request

    if "管线" in normalized or "管道" in normalized:
        request = {"kind": "pipelines", "label": "管线"}
        if scope:
            request.update(scope)
        return request

    return None


def _format_station_list_reply(
    *,
    stations: list[Station],
    label: str,
    include_type: bool,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"当前业务库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    type_map = {
        "source": "气源站",
        "compressor": "压气站",
        "distribution": "分输站",
        "valve": "阀室",
        "other": "站场",
    }
    lines = [f"{scoped_label}完整列表如下，共 {len(stations)} 座：", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 设计压力(MPa) |")
    lines.append("| --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        type_label = type_map.get(station.type, station.type)
        pressure = f"{station.design_pressure:.2f}" if station.design_pressure is not None else "未知"
        lines.append(f"| {index} | {station.name} | {station.id} | {type_label if include_type else label} | {pressure} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整列表，共 {len(stations)} 座。",
    )


def _format_pipeline_list_reply(
    *,
    pipelines: list[Pipeline],
    label: str,
    session: Session,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"当前业务库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    station_ids = {pipeline.start_station_id for pipeline in pipelines} | {pipeline.end_station_id for pipeline in pipelines}
    station_map = {
        station.id: station.name
        for station in session.exec(select(Station).where(Station.id.in_(station_ids))).all()
    }
    lines = [f"{scoped_label}完整列表如下，共 {len(pipelines)} 条：", ""]
    lines.append("| 序号 | 名称 | ID | 连接关系 | 长度(km) | 管径(mm) |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        start_name = station_map.get(pipeline.start_station_id, pipeline.start_station_id)
        end_name = station_map.get(pipeline.end_station_id, pipeline.end_station_id)
        length = f"{pipeline.length_km:.2f}" if pipeline.length_km else "未知"
        diameter = pipeline.diameter_mm or pipeline.diameter
        diameter_text = f"{float(diameter):.0f}" if diameter else "未知"
        lines.append(
            f"| {index} | {pipeline.name} | {pipeline.id} | {start_name} -> {end_name} | {length} | {diameter_text} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整列表，共 {len(pipelines)} 条。",
    )


def _format_station_count_reply(
    *,
    stations: list[Station],
    label: str,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"{scoped_label}共 0 座，当前业务库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}共 {len(stations)} 座。", ""]
    lines.append("| 序号 | 名称 | ID | 设计压力(MPa) |")
    lines.append("| --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        pressure = f"{station.design_pressure:.2f}" if station.design_pressure is not None else "未知"
        lines.append(f"| {index} | {station.name} | {station.id} | {pressure} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整统计和明细，共 {len(stations)} 座。",
    )


def _format_pipeline_count_reply(
    *,
    pipelines: list[Pipeline],
    label: str,
    scope_label: str | None,
    session: Session,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"{scoped_label}共 0 条，当前业务库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    station_ids = {pipeline.start_station_id for pipeline in pipelines} | {pipeline.end_station_id for pipeline in pipelines}
    station_map = {
        station.id: station.name
        for station in session.exec(select(Station).where(Station.id.in_(station_ids))).all()
    }
    lines = [f"{scoped_label}共 {len(pipelines)} 条。", ""]
    lines.append("| 序号 | 名称 | ID | 连接关系 |")
    lines.append("| --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        start_name = station_map.get(pipeline.start_station_id, pipeline.start_station_id)
        end_name = station_map.get(pipeline.end_station_id, pipeline.end_station_id)
        lines.append(f"| {index} | {pipeline.name} | {pipeline.id} | {start_name} -> {end_name} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整统计和明细，共 {len(pipelines)} 条。",
    )


def _extract_pipeline_scope(normalized_message: str, session: Session) -> dict[str, str] | None:
    system = _match_pipeline_system(normalized_message, session)
    if not system:
        return None

    return {
        "system_id": str(system["id"]),
        "scope_label": str(system["name"]),
        "system_prefixes": ",".join(str(prefix) for prefix in system["prefixes"]),
    }


def _match_pipeline_system(normalized_message: str, session: Session) -> dict[str, str | list[str]] | None:
    message = normalized_message.replace("线", "线")
    systems = session.exec(select(PipelineSystem).order_by(PipelineSystem.sort_order)).all()
    best_match: dict[str, str | list[str]] | None = None
    best_score = -1

    for system in systems:
        candidate_names = {
            re.sub(r"\s+", "", system.name or ""),
            re.sub(r"\s+", "", (system.id or "").upper()),
        }

        for alias in _build_pipeline_system_aliases(system):
            candidate_names.add(alias)

        matching_names = [candidate for candidate in candidate_names if candidate and candidate in message]
        if not matching_names:
            continue

        longest_match = max(len(name) for name in matching_names)
        if longest_match <= best_score:
            continue

        best_score = longest_match
        best_match = {
            "id": system.id,
            "name": system.name,
            "prefixes": _extract_pipeline_prefixes(system),
        }

    return best_match


def _build_pipeline_system_aliases(system: PipelineSystem) -> set[str]:
    aliases = {re.sub(r"\s+", "", system.name or "")}
    normalized_name = re.sub(r"\s+", "", system.name or "")

    replacements = {
        "西气东输一线": {"西一线", "西气东输1线"},
        "西气东输二线": {"西二线", "西气东输2线"},
        "西气东输三线": {"西三线", "西气东输3线"},
        "陕京二线": {"陕二线", "陕京2线"},
        "陕京三线": {"陕三线", "陕京3线"},
        "陕京四线": {"陕四线", "陕京4线"},
    }
    aliases.update(replacements.get(normalized_name, set()))
    return aliases


def _extract_pipeline_prefixes(system: PipelineSystem) -> list[str]:
    prefixes: list[str] = []
    if system.layers_config:
        try:
            payload = json.loads(system.layers_config)
        except json.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            for item in payload:
                prefix = str(item.get("id_prefix", "")).strip() if isinstance(item, dict) else ""
                if prefix:
                    prefixes.append(prefix)

    if not prefixes:
        prefixes.append(system.id.upper())

    return list(dict.fromkeys(prefixes))


def _query_station_collection(session: Session, request: dict[str, str]) -> list[Station]:
    stmt = select(Station)
    station_type = request.get("station_type")
    if station_type:
        stmt = stmt.where(Station.type == station_type)

    stations = session.exec(stmt).all()
    prefixes = _resolve_scope_prefixes(request)
    if prefixes:
        stations = [station for station in stations if _matches_prefixes(station.id, prefixes)]

    return sorted(stations, key=lambda station: _natural_sort_key(station.id))


def _query_pipeline_collection(session: Session, request: dict[str, str]) -> list[Pipeline]:
    stmt = select(Pipeline)
    category = request.get("category")
    if category:
        stmt = stmt.where(Pipeline.category == category)

    pipelines = session.exec(stmt).all()
    prefixes = _resolve_scope_prefixes(request)
    if prefixes:
        pipelines = [pipeline for pipeline in pipelines if _matches_prefixes(pipeline.id, prefixes)]

    return sorted(pipelines, key=lambda pipeline: _natural_sort_key(pipeline.id))


def _resolve_scope_prefixes(request: dict[str, str]) -> list[str]:
    raw_prefixes = request.get("system_prefixes")
    if raw_prefixes:
        return [prefix.strip() for prefix in raw_prefixes.split(",") if prefix.strip()]

    system_id = request.get("system_id")
    if system_id:
        return [system_id.upper()]

    return []


def _matches_prefixes(identifier: str, prefixes: list[str]) -> bool:
    normalized_identifier = (identifier or "").upper()
    return any(normalized_identifier.startswith(f"{prefix.upper()}-") for prefix in prefixes)


def _natural_sort_key(value: str) -> list[object]:
    parts = re.split(r"(\d+)", value or "")
    key: list[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return key


def _try_direct_entity_lookup(message: str, session: Session) -> str | None:
    entity_name = _extract_entity_lookup_name(message)
    if not entity_name:
        return None

    stations = _find_station_candidates(entity_name, session)
    if stations:
        best_station = _pick_best_station_candidate(entity_name, stations)
        if best_station:
            return _append_completeness_hint(
                _build_station_lookup_reply(best_station),
                message,
                is_complete=True,
                reason="已按当前业务库返回该对象的完整基础信息。",
            )
        names = "、".join(station.name for station in stations[:5])
        return _append_completeness_hint(
            f"我先查了本地业务库，和“{entity_name}”接近的站场有：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一个。",
        )

    pipelines = _find_pipeline_candidates(entity_name, session)
    if pipelines:
        if len(pipelines) == 1:
            return _append_completeness_hint(
                _build_pipeline_lookup_reply(pipelines[0]),
                message,
                is_complete=True,
                reason="已按当前业务库返回该对象的完整基础信息。",
            )
        names = "、".join(pipeline.name for pipeline in pipelines[:5])
        return _append_completeness_hint(
            f"我查到几个接近的管线名称：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一条。",
        )

    return _append_completeness_hint(
        f"我先查了本地业务库，当前没找到“{entity_name}”对应的站场或管线。"
        "如果你说的是简称、别名，或者少了“分输站/压气站”这类后缀，可以发完整名称我再查。",
        message,
        is_complete=True,
        reason="已按当前业务库完整检索，但没有找到匹配对象。",
    )


def _extract_entity_lookup_name(message: str) -> str | None:
    normalized = re.sub(r"[？?。！，,\s]+", "", message or "")
    if not normalized or len(normalized) > 24:
        return None

    prefix_pattern = r"^(?:帮我)?(?:看下|看看|查下|查查|说说|介绍下|介绍一下|请问)?"
    core = re.sub(prefix_pattern, "", normalized)

    patterns = [
        r"^(?P<name>.+?)(?:是什么站|是什么|是啥|啥意思|做什么的|是干什么的)$",
        r"^(?:介绍下|介绍一下|说说)(?P<name>.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, core)
        if match:
            name = match.group("name")
            return _normalize_entity_name(name)

    return None


def _normalize_entity_name(name: str) -> str:
    normalized = re.sub(r"(的情况|这个|这个站)$", "", name.strip())
    generic_names = {"站", "站场", "分输站", "压气站", "阀室", "清管站", "天然气站"}
    if normalized in generic_names:
        return ""
    return normalized


def _find_station_candidates(entity_name: str, session: Session) -> list[Station]:
    variants = _build_station_name_variants(entity_name)
    stations: list[Station] = []
    seen_ids: set[str] = set()

    for variant in variants:
        for station in session.exec(select(Station).where(Station.name == variant)).all():
            if station.id not in seen_ids:
                seen_ids.add(station.id)
                stations.append(station)

    for variant in variants:
        stmt = select(Station).where(Station.name.contains(variant))
        for station in session.exec(stmt).all():
            if station.id not in seen_ids:
                seen_ids.add(station.id)
                stations.append(station)
            if len(stations) >= 5:
                return stations

    return stations


def _build_station_name_variants(entity_name: str) -> list[str]:
    base = entity_name.strip()
    if not base:
        return []

    variants = [base]
    suffixes = ["分输站", "压气站", "清管站", "阀室", "站场", "站"]
    root = base
    for suffix in suffixes:
        if base.endswith(suffix) and len(base) > len(suffix):
            root = base[: -len(suffix)]
            variants.append(root)
            break

    for prefix in dict.fromkeys([base, root]):
        for suffix in suffixes:
            if not prefix.endswith(suffix):
                variants.append(f"{prefix}{suffix}")

    return list(dict.fromkeys(filter(None, variants)))


def _pick_best_station_candidate(entity_name: str, stations: list[Station]) -> Station | None:
    if not stations:
        return None
    if len(stations) == 1:
        return stations[0]

    ranked = sorted(stations, key=lambda station: _score_station_candidate(entity_name, station))
    if len(ranked) == 1:
        return ranked[0]

    best_score = _score_station_candidate(entity_name, ranked[0])
    second_score = _score_station_candidate(entity_name, ranked[1])
    return ranked[0] if best_score < second_score else None


def _score_station_candidate(entity_name: str, station: Station) -> tuple[int, int, int]:
    lookup_key = _entity_lookup_key(entity_name)
    station_key = _entity_lookup_key(station.name)

    if station_key == lookup_key:
        name_score = 0
    elif station.name.startswith(lookup_key):
        name_score = 1
    elif lookup_key in station.name:
        name_score = 2
    else:
        name_score = 3

    type_priority = {"distribution": 0, "compressor": 0, "source": 0, "other": 1, "valve": 2}
    return (name_score, type_priority.get(station.type, 1), len(station.name))


def _entity_lookup_key(name: str) -> str:
    key = name.strip()
    for suffix in ["分输站", "压气站", "清管站", "阀室", "联络站", "站场", "站"]:
        if key.endswith(suffix) and len(key) > len(suffix):
            return key[: -len(suffix)]
    return key


def _build_station_lookup_reply(station: Station) -> str:
    type_map = {
        "source": "气源站",
        "compressor": "压气站",
        "distribution": "分输站",
        "valve": "阀室",
        "other": "站场",
    }
    station_type = type_map.get(station.type, station.type or "站场")
    details: list[str] = [
        f"{station.name}是库里登记的一个{station_type}。",
        f"站点 ID 是 {station.id}。",
    ]

    if station.design_pressure is not None:
        details.append(f"设计压力 {station.design_pressure:.2f} MPa。")

    if station.operating_pressure_in is not None or station.operating_pressure_out is not None:
        in_pressure = _format_optional_number(station.operating_pressure_in, "MPa")
        out_pressure = _format_optional_number(station.operating_pressure_out, "MPa")
        details.append(f"当前静态资料里的进出站压力分别是 {in_pressure} / {out_pressure}。")

    if station.capacity is not None:
        details.append(f"处理能力 {station.capacity:.2f} 万方/天。")

    details.append(f"坐标在 ({station.longitude:.4f}, {station.latitude:.4f})。")
    return "".join(details)


def _find_pipeline_candidates(entity_name: str, session: Session) -> list[Pipeline]:
    pipelines = session.exec(
        select(Pipeline).where(Pipeline.name.contains(entity_name))
    ).all()
    return pipelines[:5]


def _build_pipeline_lookup_reply(pipeline: Pipeline) -> str:
    category_map = {"trunk": "干线", "branch": "支线"}
    category = category_map.get(pipeline.category, pipeline.category or "管线")
    details = [f"{pipeline.name}是库里登记的一条{category}。", f"管线 ID 是 {pipeline.id}。"]

    if pipeline.length_km:
        details.append(f"长度约 {pipeline.length_km:.2f} km。")

    diameter = pipeline.diameter_mm or pipeline.diameter
    if diameter:
        details.append(f"管径约 {float(diameter):.0f} mm。")

    details.append(f"连接站点是 {pipeline.start_station_id} -> {pipeline.end_station_id}。")
    return "".join(details)


def _format_optional_number(value: float | None, unit: str) -> str:
    if value is None:
        return f"未知{unit}"
    return f"{value:.2f} {unit}"


@router.post("/simulation/evaluate")
def evaluate_simulation_api(req: SimulationEvaluationRequest) -> dict[str, Any]:
    result_data: dict[str, Any] | None = req.overlay
    baseline_data: dict[str, Any] | None = req.baseline_overlay

    if result_data is None and req.run_id:
        snapshot = get_snapshot(req.run_id, pilot_id=req.pilot_id)
        result_data = snapshot.get("result") or snapshot

    if baseline_data is None and req.baseline_run_id:
        try:
            baseline_snapshot = get_snapshot(req.baseline_run_id, pilot_id=req.pilot_id)
            baseline_data = baseline_snapshot.get("result") or baseline_snapshot
        except Exception:
            baseline_data = None

    if result_data is None:
        raise HTTPException(status_code=400, detail="overlay 或 run_id 至少提供一个")

    evaluation = evaluate_simulation_result(result_data, baseline_data)
    return {
        "evaluation": evaluation,
        "text": evaluation.get("text", ""),
    }
