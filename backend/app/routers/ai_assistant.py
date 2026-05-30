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
from app.models import (
    CompressorDetail,
    DistributionPointDetail,
    JunctionGroup,
    Pipeline,
    PipelineSystem,
    Station,
)
from app.scada_models import ScadaHistory
from app.services.ai_analysis_orchestrator import AiAnalysisOrchestrator, AssistantContext
from app.services.ai_client import AiServiceError, ai_client
from app.services.ai_sim_evaluator import evaluate_simulation_result
from app.services.assistant_intent_config import (
    COMMON_METRIC_TERM_CORRECTIONS,
    DEWPOINT_QUERY_KEYWORDS,
    HISTORY_STATION_REFERENCE_KEYWORDS,
    PRESSURE_KEYWORDS,
    TEMPERATURE_KEYWORDS,
)
from app.services.assistant_tools import build_tools_description, execute_tool
from app.services.junction_groups import load_runtime_junction_groups
from app.services.raw_excel_ai_direct import (
    try_direct_count_reply as try_raw_excel_direct_count_reply,
    try_direct_entity_lookup as try_raw_excel_direct_entity_lookup,
    try_direct_list_reply as try_raw_excel_direct_list_reply,
)
from app.services.raw_excel_ai_index import raw_excel_ai_index
from app.services.topology import TopologyService
from app.services.we1_result_snapshot_service import get_snapshot
from app.services.multi_source.orchestrator import multi_source_orchestrator
from app.services.simulation_scenarios import DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS
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
DEWPOINT_RISK_POINT_C = 0.0
DEFAULT_STATION_DESIGN_PRESSURE_MPA = 10.0
LUZHI_PILOT_ENV_KEY = "SMARTGAS_LUZHI_PILOT_ENABLED"
LUZHI_TRACE_PATH = Path(__file__).resolve().parents[2] / "data" / "ai_traces" / "luzhi_pilot_trace.jsonl"
DATA_ANALYSIS_ENTER_COMMAND = "/数据分析"
DATA_ANALYSIS_EXIT_COMMAND = "/退出数据分析"
DEWPOINT_COMPARE_KEYWORDS = ("对比", "比较", "差异", "对照")
DATA_ANALYSIS_ENTER_PATTERN = re.compile(r"^\s*/数据分析(?:\s+(?P<payload>.+))?\s*$", re.IGNORECASE)
DATA_ANALYSIS_EXIT_PATTERN = re.compile(r"^\s*/退出数据分析\s*$", re.IGNORECASE)
SUBAGENT_ENTER_PATTERN = re.compile(r"^\s*/subagent(?:\s+.+)?\s*$", re.IGNORECASE)
SUBAGENT_EXIT_PATTERN = re.compile(r"^\s*/退出subagent\s*$", re.IGNORECASE)
MCP_DEMO_PATTERN = re.compile(r"^\s*/(?:mcp演示|mcpdemo|mcp-demo)(?:\s+.+)?\s*$", re.IGNORECASE)
RAG_SEARCH_DIRECT_PATTERN = re.compile(
    r"^\s*/(?:RAG检索|rag检索|RAG搜索|rag搜索|向量检索|知识库检索|知识库搜索|搜RAG|搜rag)"
    r"(?:\s+(?P<payload>.+))?\s*$",
    re.IGNORECASE,
)
OPERATION_PROCEDURE_DIRECT_PATTERN = re.compile(
    r"^\s*/(?:规程查询|操作规程|查规程|procedure)(?:\s+(?P<payload>.+))?\s*$",
    re.IGNORECASE,
)
MULTI_SOURCE_DIRECT_PATTERN = re.compile(
    r"^\s*/(?:三库查询|三库分析|多库查询|多库分析|跨库查询|multi-source|multisource)"
    r"(?:\s+(?P<payload>.+))?\s*$",
    re.IGNORECASE,
)
STATION_PAIR_PATTERN = re.compile(
    r"(?P<left>[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)?)"
    r"(?:和|与|跟)"
    r"(?P<right>[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)?)"
)
STATION_SUFFIXES = ("分输联络站", "分输压气站", "分输清管站", "分输站", "压气站", "清管站", "站")

MULTI_STATION_COMPARE_KEYWORDS = ("对比", "比较", "差异", "对照", "横向", "对比分析")
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
    "超压",
    "低压",
    "保护",
    "定值",
    "设定值",
    "报警值",
    "停车",
    "启停",
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
    if OPERATION_PROCEDURE_DIRECT_PATTERN.match(text):
        return True
    compact = re.sub(r"\s+", "", text)
    if any(prefix in compact for prefix in ("查操作规程", "查询操作规程", "查规程", "规程查询")):
        return True
    if "应急" in compact or "预案" in compact or "处置" in compact:
        return True
    if "规程" in compact:
        return True
    action_hit = any(keyword in compact for keyword in OPERATION_PROCEDURE_KEYWORDS)
    ask_hit = any(keyword in compact for keyword in ("怎么", "如何", "步骤", "流程", "注意", "要求", "风险", "禁止"))
    asset_hit = any(keyword in compact for keyword in ("站", "管线", "管道", "阀", "机组", "压缩机", "分输", "清管", "天然气"))
    return action_hit and (ask_hit or asset_hit)


def _is_direct_rag_search_query(message: str) -> bool:
    return bool(RAG_SEARCH_DIRECT_PATTERN.match(str(message or "").strip()))


def _should_default_to_rag_search(message: str) -> bool:
    text = str(message or "").strip()
    if not text:
        return False
    # Slash commands are explicit modes; let their own handlers decide.
    if text.startswith("/"):
        return False
    return True


def _looks_like_pipeline_material_query(message: str) -> bool:
    text = re.sub(r"\s+", "", str(message or "").replace("棺材", "管材"))
    if not text:
        return False
    material_hit = any(term in text for term in ("管材", "材质", "钢级", "钢管", "用管", "材料"))
    pipeline_hit = any(
        term in text
        for term in (
            "管线",
            "管道",
            "干线",
            "支线",
            "联络线",
            "西一线",
            "西二线",
            "西三线",
            "西气东输",
            "中俄东线",
            "中贵线",
            "陕京",
            "涩宁兰",
            "忠武",
            "泰青威",
            "川气东送",
            "冀宁",
            "中缅",
            "榆济",
            "兰银",
        )
    )
    material_question_hit = any(term in text for term in ("哪些管材", "哪些材质", "什么管材", "什么材质", "使用", "用了", "采用"))
    return material_hit and (pipeline_hit or material_question_hit)


def _looks_like_station_material_query(message: str) -> bool:
    text = re.sub(r"\s+", "", str(message or "").replace("棺材", "管材"))
    if not text:
        return False
    material_hit = any(term in text for term in ("管材", "材质", "钢级", "钢管", "用管", "材料"))
    station_hit = any(term in text for term in ("站", "枢纽", "联络", "分输", "压气", "清管"))
    return material_hit and station_hit


def _strip_rag_search_prefix(message: str) -> str:
    text = str(message or "").strip()
    match = RAG_SEARCH_DIRECT_PATTERN.match(text)
    if match:
        payload = (match.group("payload") or "").strip()
        return payload or text
    return text


def _strip_operation_procedure_prefix(message: str) -> str:
    text = str(message or "").strip()
    match = OPERATION_PROCEDURE_DIRECT_PATTERN.match(text)
    if match:
        payload = (match.group("payload") or "").strip()
        return payload or text

    stripped = re.sub(
        r"^\s*(?:请)?(?:查|查询|检索|搜索)?(?:一下)?(?:操作规程|运行规程|工艺规程|规程)[：:，,\s]*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return stripped or text


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


STATION_OVERVIEW_KEYWORDS = (
    "大概情况",
    "基本情况",
    "整体情况",
    "概览",
    "概况",
    "介绍",
    "简介",
    "是什么站",
    "什么站",
    "干什么的",
)

STATION_NAME_CORRECTIONS = {
    "由直": "甪直",
    "角直": "甪直",
    "用直": "甪直",
}


def _looks_like_station_overview_query(message: str) -> bool:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text:
        return False
    if not any(keyword in text for keyword in STATION_OVERVIEW_KEYWORDS):
        return False
    return any(token in text for token in ("站", "枢纽", "压气", "分输", "输气", "阀室", "联络"))


def _extract_station_overview_name(message: str) -> str:
    text = re.sub(r"[？?。！，,\s]+", "", str(message or ""))
    for wrong, right in STATION_NAME_CORRECTIONS.items():
        text = text.replace(wrong, right)
    text = re.sub(r"^(?:帮我|麻烦|请|查询|查一下|查下|搜索|搜一下|看一下|看看|说一下|说说|介绍一下|介绍下)+", "", text)
    text = re.sub(
        r"(?:的大概情况|大概情况|的基本情况|基本情况|的整体情况|整体情况|概况|简介|介绍|是什么站|什么站|是干什么的|干什么的)$",
        "",
        text,
    )
    return text.strip()


def _station_overview_root(name: str) -> str:
    text = str(name or "").strip()
    for suffix in ("分输联络站", "分输压气站", "压气站", "分输站", "联络站", "清管站", "枢纽站", "枢纽", "阀室", "站"):
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)]
    return text


def _station_overview_key(value: Any) -> str:
    return re.sub(r"[\s\-_/()（）【】\[\]<>《》,，.。:：;；“”\"'‘’·#]+", "", str(value or "")).lower()


def _filter_station_overview_raw_matches(entity_name: str, matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    root = _station_overview_root(entity_name)
    keys = {
        _station_overview_key(entity_name),
        _station_overview_key(root),
    }
    keys = {key for key in keys if len(key) >= 2}
    if not keys:
        return []

    filtered: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in matches:
        # 概况查询问的是站场对象，不能把地址里的村镇名当成站名兜底命中。
        haystack = _station_overview_key(
            " ".join(
                [
                    str(item.get("name") or ""),
                    str(item.get("scope_name") or ""),
                    " ".join(str(system) for system in item.get("systems") or []),
                    " ".join(str(branch) for branch in item.get("branches") or []),
                    " ".join(str(alias) for alias in item.get("aliases") or []),
                ]
            )
        )
        if not any(key in haystack for key in keys):
            continue
        item_id = str(item.get("id") or item.get("name") or "")
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        filtered.append(item)
    return filtered


def _station_overview_type_label(station_type: str | None) -> str:
    return {
        "source": "气源站",
        "compressor": "压气站",
        "distribution": "输气/分输站",
        "valve": "阀室",
        "storage": "储气库",
        "other": "站场",
    }.get(station_type or "", station_type or "站场")


def _station_overview_unique(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        cleaned.append(text)
    return cleaned


def _is_public_pipeline_display_name(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    compact = re.sub(r"\s+", "", text)
    # 例如 we1-b10 是内部编码/数据键，不是可展示给业务人员的管道名称。
    if re.fullmatch(r"[a-z]{1,5}\d?[-_][a-z]\d+", compact, flags=re.IGNORECASE):
        return False
    if re.fullmatch(r"[a-z]{1,5}\d?[-_](?:line|branch|pipe|seg|edge)\d+", compact, flags=re.IGNORECASE):
        return False
    if re.fullmatch(r"[a-z]{1,5}\d?[-_]?\d+", compact, flags=re.IGNORECASE):
        return False
    return True


def _station_overview_public_pipeline_names(values: list[Any]) -> list[str]:
    return [
        item
        for item in _station_overview_unique(values)
        if _is_public_pipeline_display_name(item)
    ]


def _station_overview_sql_candidates(entity_name: str, session: Session) -> list[Station]:
    root = _station_overview_root(entity_name)
    variants = _station_overview_unique([
        entity_name,
        root,
        f"{root}压气站",
        f"{root}分输站",
        f"{root}联络站",
        f"{root}枢纽站",
        f"{root}站",
    ])
    stations: list[Station] = []
    seen: set[str] = set()
    for variant in variants:
        for station in session.exec(select(Station).where(Station.name == variant)).all():
            if station.id not in seen:
                stations.append(station)
                seen.add(station.id)
    for variant in variants:
        if not variant or len(variant) < 2:
            continue
        for station in session.exec(select(Station).where(Station.name.contains(variant))).all():
            if station.id not in seen:
                stations.append(station)
                seen.add(station.id)
    return stations


def _match_station_overview_junction(entity_name: str, stations: list[Station], session: Session) -> dict[str, Any] | None:
    root = _station_overview_root(entity_name)
    station_ids = {station.id for station in stations}
    station_roots = {_station_overview_root(station.name) for station in stations}
    for group in load_runtime_junction_groups(session):
        group_name = str(group.get("name") or "")
        group_root = _station_overview_root(group_name)
        group_station_ids = set(group.get("station_ids") or [])
        if (
            root
            and (root in group_name or group_root == root or group_root in station_roots)
        ) or (station_ids and station_ids.intersection(group_station_ids)):
            return group
    return None


def _station_overview_system_names(system_ids: list[str], raw_matches: list[dict[str, Any]], session: Session) -> list[str]:
    system_map = {
        str(system.id): system.name
        for system in session.exec(select(PipelineSystem)).all()
    }
    names = [system_map.get(str(system_id), str(system_id)) for system_id in system_ids]
    for item in raw_matches:
        names.extend(item.get("systems") or [])
        names.extend(item.get("branches") or [])
    return _station_overview_public_pipeline_names(names)


def _station_overview_connected_pipelines(member_ids: list[str], session: Session) -> list[Pipeline]:
    if not member_ids:
        return []
    pipelines: list[Pipeline] = []
    seen: set[str] = set()
    for station_id in member_ids:
        rows = session.exec(
            select(Pipeline).where(
                (Pipeline.start_station_id == station_id) | (Pipeline.end_station_id == station_id)
            )
        ).all()
        for pipeline in rows:
            if pipeline.id not in seen:
                seen.add(pipeline.id)
                pipelines.append(pipeline)
    return pipelines


def _station_overview_user_hits(entity_name: str, raw_matches: list[dict[str, Any]], session: Session) -> list[str]:
    root = _station_overview_root(entity_name)
    terms = _station_overview_unique([root, entity_name, *[item.get("name") for item in raw_matches]])
    users: list[str] = []
    for term in terms:
        if not term:
            continue
        users.extend([item.get("name") for item in raw_excel_ai_index.query_distributions(keyword=term)[:20]])
        for row in session.exec(select(DistributionPointDetail).where(DistributionPointDetail.name.contains(term))).all():
            users.append(row.name)
        for row in session.exec(select(DistributionPointDetail).where(DistributionPointDetail.station_abbr.contains(term))).all():
            users.append(row.name)
        for row in session.exec(select(DistributionPointDetail).where(DistributionPointDetail.node_link.contains(term))).all():
            users.append(row.name)
    return _station_overview_unique(users)


def _station_overview_compressor_info(entity_name: str, raw_matches: list[dict[str, Any]], session: Session) -> tuple[int, list[str]]:
    terms = _station_overview_unique([_station_overview_root(entity_name), entity_name, *[item.get("name") for item in raw_matches]])
    raw_units = 0
    configs: list[str] = []
    for item in raw_matches:
        try:
            raw_units += int(item.get("compressor_unit_count") or 0)
        except (TypeError, ValueError):
            pass
        configs.extend(item.get("compressor_configs") or [])

    sql_unit_ids: set[str] = set()
    for term in terms:
        if not term:
            continue
        for row in session.exec(select(CompressorDetail).where(CompressorDetail.station_name.contains(term))).all():
            if row.unit_id:
                sql_unit_ids.add(row.unit_id)
            if row.unit_config:
                configs.append(row.unit_config)

    return max(raw_units, len(sql_unit_ids)), _station_overview_unique(configs)


def _station_overview_networkx_context(group: dict[str, Any] | None, station: Station | None, session: Session) -> dict[str, Any]:
    context: dict[str, Any] = {"connected": False, "node_id": "", "degree": 0, "neighbors": [], "edge_count": 0}
    try:
        topo = TopologyService(session)
        graph_obj = topo.get_computation_graph(directed=True)
        graph = graph_obj.graph
        node_id = f"JUNC_{group['id']}" if group else (station.id if station else "")
        if not node_id or node_id not in graph:
            return context

        if hasattr(graph, "successors"):
            neighbors = set(graph.successors(node_id)) | set(graph.predecessors(node_id))
            edge_count = len(list(graph.out_edges(node_id))) + len(list(graph.in_edges(node_id)))
        else:
            neighbors = set(graph.neighbors(node_id))
            edge_count = len(list(graph.edges(node_id)))

        neighbor_names = []
        for neighbor_id in neighbors:
            node = graph_obj.get_node(neighbor_id)
            neighbor_names.append(node.name if node else str(neighbor_id))

        context.update({
            "connected": True,
            "node_id": node_id,
            "degree": len(neighbors),
            "neighbors": _station_overview_unique(neighbor_names)[:8],
            "edge_count": edge_count,
        })
    except Exception as exc:
        context["error"] = str(exc)
    return context


def _build_station_overview_reply(message: str, session: Session) -> str:
    entity_name = _extract_station_overview_name(message)
    if not entity_name:
        return _append_completeness_hint(
            "结论：这句话像是在查站场概况，但我没识别出具体站名。请用“中卫站大概情况”“甪直站概况”这种说法再问一次。",
            message,
            is_complete=False,
            reason="未识别到具体站名。",
        )

    raw_excel_ai_index.ensure_loaded()
    raw_matches = _filter_station_overview_raw_matches(
        entity_name,
        raw_excel_ai_index.find_station_candidates(entity_name, limit=16),
    )
    sql_stations = _station_overview_sql_candidates(entity_name, session)
    junction = _match_station_overview_junction(entity_name, sql_stations, session)

    member_ids = list(junction.get("station_ids") or []) if junction else []
    if not member_ids and sql_stations:
        member_ids = [sql_stations[0].id]
    member_stations = (
        session.exec(select(Station).where(Station.id.in_(member_ids))).all()
        if member_ids
        else []
    )
    primary_station = member_stations[0] if member_stations else (sql_stations[0] if sql_stations else None)

    if not primary_station and not raw_matches:
        return _append_completeness_hint(
            "\n".join([
                "结论：",
                f"没找到“{entity_name}”对应的可靠站场记录。",
                "",
                "说明：",
                "SQL业务库和 NetworkX拓扑库都查过了，没命中可定位站点；详细检索过程放在 AI 处理过程里。",
                "",
                "建议：",
                "换完整站名或常用简称再试，比如“中卫压气站大概情况”“甪直联络站概况”。",
            ]),
            message,
            is_complete=True,
            reason="已按 SQL 业务库和 NetworkX 拓扑库检索，但未命中该站场。",
        )

    connected_pipelines = _station_overview_connected_pipelines(member_ids, session)
    users = _station_overview_user_hits(entity_name, raw_matches, session)
    compressor_units, compressor_configs = _station_overview_compressor_info(entity_name, raw_matches, session)
    system_names = _station_overview_system_names(
        list(junction.get("system_ids") or []) if junction else [],
        raw_matches,
        session,
    )
    networkx_context = _station_overview_networkx_context(junction, primary_station, session)
    capacity_values = [station.capacity for station in member_stations if station.capacity is not None]
    total_capacity = sum(float(value) for value in capacity_values)

    member_names = _station_overview_unique([station.name for station in member_stations])
    connected_pipeline_names = _station_overview_public_pipeline_names([pipeline.name for pipeline in connected_pipelines])
    station_type = "枢纽站" if junction and len(member_ids) > 1 else _station_overview_type_label(primary_station.type if primary_station else raw_matches[0].get("type_code"))
    display_name = str(junction.get("name") if junction else (primary_station.name if primary_station else raw_matches[0].get("name"))).strip()
    system_text = "、".join(system_names[:6]) or "暂未识别到明确管道系统"
    member_text = "、".join(member_names[:8]) or "暂无分站清单"
    pipeline_text = "、".join(connected_pipeline_names[:6]) or "暂无直接管段清单"
    user_count = len(users)
    user_text = f"{user_count} 个用户/分输口" if user_count else "当前库未命中直接用户/分输口"
    compressor_text = (
        f"{compressor_units} 套压缩机"
        if compressor_units
        else "当前库未命中压缩机组记录"
    )
    equipment_note = (
        f"设备规模：{compressor_text}；已连接管段 {len(connected_pipelines)} 条；{user_text}。"
        if compressor_units or connected_pipelines or user_count
        else "设备规模：当前只接入站场/管线/用户索引，完整“台套设备”台账还没入库，不能硬编设备数。"
    )
    capacity_text = f"SQL登记处理能力合计约 {total_capacity:.1f} 万方/天。" if total_capacity else "SQL库暂无可汇总的处理能力字段。"
    networkx_text = (
        f"NetworkX有向拓扑命中节点 {networkx_context['node_id']}，相邻节点 {networkx_context['degree']} 个，关联边 {networkx_context['edge_count']} 条。"
        if networkx_context.get("connected")
        else "NetworkX拓扑库已连接，但当前站点未映射到图节点。"
    )
    neighbor_text = "、".join(networkx_context.get("neighbors") or []) or "暂无可展示邻接点"

    role_line = (
        f"{display_name}更适合按“{station_type}”来讲。"
        if station_type == "枢纽站"
        else f"{display_name}是当前库里登记的“{station_type}”。"
    )
    if station_type == "枢纽站":
        summary = (
            f"它由 {len(member_names)} 个分站/站点合并展示：{member_text}；"
            f"主要连接 {system_text}。"
        )
    elif "压气站" in station_type:
        summary = (
            f"它承担压缩增压和干线输送组织作用；{compressor_text}，{user_text}，{capacity_text}"
        )
    else:
        summary = (
            f"它承担分输/联络/输气组织作用；{user_text}，{capacity_text}"
        )

    lines = [
        "结论：",
        f"{role_line}{summary}",
        "",
        "站场类型：",
        f"- 类型判断：{station_type}",
        f"- 分站/成员：{member_text}" if station_type == "枢纽站" else f"- 站点ID：{primary_station.id if primary_station else raw_matches[0].get('id')}",
        f"- 连接管道：{system_text}",
        "",
        "规模与对象：",
        f"- {equipment_note}",
        f"- 直接连接管段：{len(connected_pipelines)} 条；示例：{pipeline_text}",
        f"- 大致规模：{capacity_text}",
        "",
        "拓扑关系：",
        f"- {networkx_text}",
        f"- 邻接对象：{neighbor_text}",
        "",
        "数据连接：",
        f"- SQL业务库：已连接，命中 stations {len(sql_stations)} 条、junction_groups {1 if junction else 0} 条、pipelines {len(connected_pipelines)} 条、users {user_count} 条。",
        f"- NetworkX拓扑库：已连接，使用有向图判断上下游/邻接关系。",
        "",
        "待确认项：",
        "- 如果要精确到“xx台套设备”，需要接入完整设备台账；当前能严谨确认的是压缩机组记录、连接管段、用户/分输口和处理能力字段。",
    ]
    if compressor_configs:
        lines.insert(lines.index("拓扑关系："), f"- 机组配置记录：{'、'.join(compressor_configs[:6])}")

    return _append_completeness_hint(
        "\n".join(lines),
        message,
        is_complete=True,
        reason="已按 SQL 业务库、raw_excel 静态索引和 NetworkX 拓扑库完成站场概况检索。",
    )


async def _station_overview_event_generator(message: str, session: Session):
    yield "[TOOL] SQL业务库\n"
    yield f"[THINK] {json.dumps('SQL业务库：读取 stations、junction_groups、pipelines、users、compressor 明细。', ensure_ascii=False)}\n"
    yield "[TOOL] NetworkX拓扑库\n"
    yield f"[THINK] {json.dumps('NetworkX拓扑库：构建有向图，检查目标站点或枢纽节点的邻接关系。', ensure_ascii=False)}\n"
    try:
        reply_text = _apply_yuqian_style(_build_station_overview_reply(message, session))
        yield f"[LOG] SQL业务库, NetworkX拓扑库, raw_excel_index\n"
        yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"
    except Exception as exc:
        logger.exception("Station overview generation failed: %s", exc)
        fallback = _append_completeness_hint(
            f"结论：站场概况查询链路出错了。\n\n待确认项：{exc}",
            message,
            is_complete=False,
            reason="SQL/NetworkX 概况查询过程中发生异常。",
        )
        yield f"[REPLY] {json.dumps(fallback, ensure_ascii=False)}\n"


async def _yield_progressive_think_steps(steps: list[str], *, delay_seconds: float = 0.45):
    for step in steps:
        yield f"[THINK] {json.dumps(step, ensure_ascii=False)}\n"
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)


def _split_reply_for_progressive_stream(reply_text: str) -> list[str]:
    blocks = re.split(r"(\n\s*\n)", reply_text or "")
    chunks: list[str] = []
    buffer = ""
    for block in blocks:
        if block == "":
            continue
        buffer += block
        if "\n\n" in block or len(buffer) >= 180:
            chunks.append(buffer)
            buffer = ""
    if buffer:
        chunks.append(buffer)
    return chunks or [reply_text]


async def _yield_progressive_reply(reply_text: str, *, delay_seconds: float = 0.18):
    for chunk in _split_reply_for_progressive_stream(reply_text):
        yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)


def _build_data_analysis_think_steps(message: str) -> list[str]:
    metric_names = "压力/温度/水露点"
    metric_types = _detect_metric_analysis_types(re.sub(r"\s+", "", _normalize_common_metric_terms(message)).lower())
    if metric_types:
        metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)

    station_name = _extract_station_name_for_dewpoint(_normalize_common_metric_terms(message), None) or "目标站点"
    return [
        f"识别意图：站点={station_name}，指标={metric_names}，进入 SCADA 时序分析链路。",
        "读取数据：优先取页面历史快照；快照缺失时回查 SCADA 历史库最近时间窗口。",
        "计算指标：当前值取窗口最后一点；6小时变化=最后一点-第一个点；波动幅度=最大值-最小值；均值=所有点平均。",
        f"风险判级：压力先对照 {DEFAULT_STATION_DESIGN_PRESSURE_MPA:g}MPa 设计压力边界；水露点先对照 {DEWPOINT_RISK_POINT_C:.0f}°C 风险点；未越界时再按波动和短时变化判级，综合风险取最高项。",
        "组织输出：先给结论性判断，再给计算过程、指标明细和历史曲线入口。",
    ]


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

    if (
        request.analysis_mode == "subagents"
        or _mentions_subagent(msg_clean)
        or _looks_like_subagent_cutoff_response_query(msg_clean)
        or _looks_like_subagent_simulation_showcase_query(msg_clean)
    ):
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
            yield "[TOOL] SCADA时序库\n"
            async for _event in _yield_progressive_think_steps(_build_data_analysis_think_steps(msg_clean)):
                yield _event
            # 先把规则计算结果按段落流式输出，避免整段结论一次糊到屏幕上。
            async for _event in _yield_progressive_reply(_da_reply_text):
                yield _event
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

    if _is_explicit_multi_source_query(msg_clean):
        return StreamingResponse(
            _multi_source_event_generator(request=request),
            media_type="text/event-stream",
        )

    if _is_direct_rag_search_query(msg_clean):
        rag_query = _strip_rag_search_prefix(msg_clean)
        return StreamingResponse(
            _rag_search_event_generator(message=rag_query, session=session),
            media_type="text/event-stream",
        )

    if OPERATION_PROCEDURE_DIRECT_PATTERN.match(msg_clean):
        procedure_query = _strip_operation_procedure_prefix(msg_clean)
        return StreamingResponse(
            _operation_procedure_event_generator(message=procedure_query, session=session),
            media_type="text/event-stream",
        )

    if _looks_like_station_overview_query(msg_clean):
        return StreamingResponse(
            _station_overview_event_generator(message=msg_clean, session=session),
            media_type="text/event-stream",
        )

    topology_pair = _extract_topology_relation_pair(msg_clean)
    if topology_pair:
        return StreamingResponse(
            _topology_relation_event_generator(message=msg_clean, station_pair=topology_pair, session=session),
            media_type="text/event-stream",
        )

    if _looks_like_station_material_query(msg_clean):
        return StreamingResponse(
            _station_material_event_generator(message=msg_clean, session=session),
            media_type="text/event-stream",
        )

    if _looks_like_pipeline_material_query(msg_clean):
        return StreamingResponse(
            _rag_answer_event_generator(message=msg_clean, session=session),
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
            _rag_answer_event_generator(message=msg_clean, session=session),
            media_type="text/event-stream",
        )

    luzhi_pilot_reply = try_luzhi_pilot_reply(request.context, msg_clean)
    if luzhi_pilot_reply:

        async def luzhi_pilot_gen():
            yield "[TOOL] SCADA时序库\n"
            async for _event in _yield_progressive_think_steps(_build_data_analysis_think_steps(msg_clean)):
                yield _event
            async for _event in _yield_progressive_reply(_apply_yuqian_style(luzhi_pilot_reply)):
                yield _event

        return StreamingResponse(luzhi_pilot_gen(), media_type="text/event-stream")

    # === 多库并行交叉分析 ===
    if _should_use_multi_source(msg_clean):
        return StreamingResponse(
            _multi_source_event_generator(request=request),
            media_type="text/event-stream",
        )

    if _should_default_to_rag_search(msg_clean):
        return StreamingResponse(
            _rag_answer_event_generator(message=msg_clean, session=session),
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

    query_message = _strip_multi_source_prefix(request.message)
    result = await multi_source_orchestrator.analyze(query_message)
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
            "已进入数据分析状态。你可以直接说“甪直站风险分析”“中卫站风险分析”“甪直水露点”，或“甲站和乙站水露点对比”。",
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
    text = re.sub(
        r"^(?:请|帮我|麻烦|给我|做一下|做个|看一下|查看|查询|搜索|分析一下|分析|横向对比|纵向对比|对比|比较|差异|对照)+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\d{1,3}(?:小时|h|hour)", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"(压力|温度|水?露点|dewpoint|对比|比较|差异|对照|分析|趋势|并行|报告)+$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = text.strip("，。；;：:,")
    return text


def _compact_topology_station_ref(fragment: str) -> str:
    text = _clean_station_fragment(fragment)
    text = re.sub(
        r"(上下游|影响范围|影响|路径|链路|线路|流向|拓扑|情况|关系|查询|查看|展示|分析|怎么走|怎么连|连接)+$",
        "",
        text,
    )
    text = text.strip("，。；;：:,")
    if "中卫" in text:
        return "中卫"
    if "靖边" in text:
        return "靖边"
    if "甪直" in text:
        return "甪直"
    text = _strip_pipeline_prefix(text)
    if text.startswith("西一") and len(text) > 2:
        text = text[2:]
    if text.startswith("西二") and len(text) > 2:
        text = text[2:]
    return _strip_station_suffix(text) or text


def _extract_topology_relation_pair(message: str) -> tuple[str, str | None] | None:
    compact = re.sub(r"\s+", "", str(message or ""))
    if not compact:
        return None
    if not any(keyword in compact for keyword in ("上下游", "路径", "链路", "流向", "拓扑", "影响范围", "怎么走", "怎么连")):
        return None

    for connector in ("到", "至", "->", "→"):
        if connector not in compact:
            continue
        left_part, right_part = compact.split(connector, 1)
        left = _extract_station_name_from_fragment(left_part, prefer_tail=True)
        right = _extract_station_name_from_fragment(right_part, prefer_tail=False)
        if left and right:
            return _compact_topology_station_ref(left), _compact_topology_station_ref(right)

    station_tokens = re.findall(
        r"[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)",
        compact,
    )
    if len(station_tokens) >= 2:
        return _compact_topology_station_ref(station_tokens[0]), _compact_topology_station_ref(station_tokens[1])
    if len(station_tokens) == 1:
        return _compact_topology_station_ref(station_tokens[0]), None

    for left_key, left_ref in (("中卫", "中卫"), ("靖边", "靖边"), ("甪直", "甪直")):
        if left_key not in compact:
            continue
        right_ref = None
        for right_key, candidate in (("靖边", "靖边"), ("中卫", "中卫"), ("甪直", "甪直")):
            if right_key in compact and candidate != left_ref:
                right_ref = candidate
                break
        return left_ref, right_ref
    return None


def _extract_json_payload_from_tool_result(tool_result: str) -> dict[str, Any]:
    text = str(tool_result or "")
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        return json.loads(text[start:end + 1])
    except Exception as exc:
        logger.warning("parse topology tool result json failed: %s", exc)
        return {}


def _format_topology_relation_reply(message: str, tool_result: str) -> str:
    payload = _extract_json_payload_from_tool_result(tool_result)
    if not payload.get("found"):
        return "\n".join([
            "结论：这次没找到明确的拓扑对象，不能硬说上下游。",
            "",
            f"依据：{payload.get('message') or tool_result}",
            "",
            "建议：把站名写成数据库里的常用名，比如“中卫压气站到西一靖边压气站上下游情况”。",
        ])

    station = payload.get("station") or {}
    upstream = payload.get("upstream_edges") or []
    downstream = payload.get("downstream_edges") or []
    path = payload.get("path") or {}
    station_name = station.get("name") or station.get("id") or "目标站"

    lines: list[str] = []
    if path.get("node_names"):
        target_name = path["node_names"][-1]
        lines.append(f"结论：找到了，{station_name} 到 {target_name} 有明确拓扑路径。")
    else:
        lines.append(f"结论：找到了，{station_name} 的上下游关系可查；暂未形成两站完整路径。")
    lines.append("")

    lines.append("上下游：")
    if upstream:
        for edge in upstream:
            lines.append(
                f"- 上游：{edge.get('neighbor_station_name') or edge.get('start_station_name')} → {station_name}"
                f"（{edge.get('name') or edge.get('id')}，{edge.get('length_km')} km）"
            )
    else:
        lines.append("- 上游：当前 scope 内未命中。")
    if downstream:
        for edge in downstream:
            lines.append(
                f"- 下游：{station_name} → {edge.get('neighbor_station_name') or edge.get('end_station_name')}"
                f"（{edge.get('name') or edge.get('id')}，{edge.get('length_km')} km）"
            )
    else:
        lines.append("- 下游：当前 scope 内未命中。")

    if path.get("node_names"):
        node_names = path.get("node_names") or []
        edge_ids = path.get("edge_ids") or []
        preview_nodes = node_names if len(node_names) <= 18 else node_names[:8] + ["..."] + node_names[-5:]
        lines.extend([
            "",
            "路径分析：",
            f"- 路径：{' → '.join(preview_nodes)}",
            f"- 管段：{len(edge_ids)} 段",
            f"- 总长度：{path.get('total_length_km')} km",
        ])

    lines.extend([
        "",
        "气流方向：",
        "- 这里展示的是拓扑录入方向/路径方向。若要判断实时气流方向，需要再查管段流向或仿真快照。",
        "",
        "依据：",
        f"- {payload.get('basis') or '拓扑关系库'}",
    ])
    gaps = payload.get("data_gaps") or []
    if gaps:
        lines.extend(["", "待复核项：", *[f"- {item}" for item in gaps]])
    lines.append("")
    lines.append("完整性提示：是，已按 WE1 拓扑关系库返回上下游和两站路径；实时流向需另查仿真或 SCADA。")
    return "\n".join(lines)


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

    if "中卫" in compact or "zhongwei" in compact.lower():
        return "中卫"

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
    return _analyze_station_metrics(snapshot, ["dewpoint"])


def _analyze_station_metrics(snapshot: dict[str, Any], metric_types: list[str]) -> dict[str, Any] | None:
    metrics: list[dict[str, Any]] = snapshot.get("metrics") or []
    wanted_types = {str(metric_type) for metric_type in metric_types if metric_type}
    target_metrics = [metric for metric in metrics if str(metric.get("type")) in wanted_types]
    if not target_metrics:
        return None
    available_types = {str(metric.get("type")) for metric in target_metrics if str(metric.get("type"))}
    missing_metric_types = sorted(wanted_types - available_types)

    evaluated_items: list[dict[str, Any]] = []
    for metric in target_metrics:
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
        "metric_types": sorted(wanted_types),
        "available_metric_types": sorted(available_types),
        "missing_metric_types": missing_metric_types,
    }


def _build_station_metric_conclusion(analysis: dict[str, Any], metric_types: list[str]) -> str:
    strongest_metric = analysis["strongest_metric"]
    overall_risk = str(analysis["overall_risk"])
    metric_label = str(strongest_metric["label"])
    metric_delta = _format_signed_value(float(strongest_metric["delta6h"]), str(strongest_metric["unit"]))
    metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)

    if overall_risk == "高":
        return f"{metric_names}波动偏高，重点关注{metric_label}，近6小时变化{metric_delta}。"
    if overall_risk == "中":
        return f"{metric_names}存在中等波动，重点关注{metric_label}，近6小时变化{metric_delta}。"
    if overall_risk == "低":
        return f"{metric_names}整体可控，有轻微波动，重点项是{metric_label}。"
    return f"{metric_names}整体平稳，当前主要观测项是{metric_label}。"


def _metric_risk_rank(item: dict[str, Any]) -> int:
    return LUZHI_RISK_ORDER.get(str(item.get("risk_level") or "正常"), 0)


def _metric_type_items(analysis: dict[str, Any], metric_type: str) -> list[dict[str, Any]]:
    return [
        item
        for item in analysis.get("items", [])
        if str(item.get("type") or "") == metric_type
    ]


def _strongest_metric_reason(item: dict[str, Any]) -> str:
    return (
        f"{item.get('label')}：当前{_format_metric_value(float(item.get('latest') or 0), str(item.get('unit') or ''))}，"
        f"6小时变化{_format_signed_value(float(item.get('delta6h') or 0), str(item.get('unit') or ''))}，"
        f"波动幅度{_format_metric_value(float(item.get('swing') or 0), str(item.get('unit') or ''))}，"
        f"风险{item.get('risk_level')}。"
    )


def _build_station_metric_key_evidence(analysis: dict[str, Any]) -> list[str]:
    items = list(analysis.get("items") or [])
    strongest = analysis.get("strongest_metric") or (items[0] if items else None)
    lines: list[str] = []
    if strongest:
        lines.append(f"主导风险项是{_strongest_metric_reason(strongest)}")

    pressure_items = _metric_type_items(analysis, "pressure")
    if pressure_items:
        closest_current = min(pressure_items, key=lambda item: DEFAULT_STATION_DESIGN_PRESSURE_MPA - float(item.get("latest") or 0))
        closest_max = min(pressure_items, key=lambda item: DEFAULT_STATION_DESIGN_PRESSURE_MPA - float(item.get("max") or 0))
        current_margin = DEFAULT_STATION_DESIGN_PRESSURE_MPA - float(closest_current.get("latest") or 0)
        max_margin = DEFAULT_STATION_DESIGN_PRESSURE_MPA - float(closest_max.get("max") or 0)
        if current_margin <= 0 or max_margin <= 0:
            lines.append(
                f"压力已触及设计压力边界：{closest_current.get('label')} 当前距10MPa边界{_format_signed_value(current_margin, 'MPa')}，需按超限风险处置。"
            )
        else:
            lines.append(
                f"压力未触及10MPa硬边界：当前最近边界的是{closest_current.get('label')}，距边界{_format_metric_value(current_margin, 'MPa')}；窗口最高点距边界{_format_metric_value(max_margin, 'MPa')}。"
            )

    dewpoint_items = _metric_type_items(analysis, "dewpoint")
    if dewpoint_items:
        closest_dewpoint = max(dewpoint_items, key=lambda item: float(item.get("latest") or -999))
        dewpoint_margin = DEWPOINT_RISK_POINT_C - float(closest_dewpoint.get("latest") or 0)
        max_dewpoint = max(float(item.get("max") or 0) for item in dewpoint_items)
        max_margin = DEWPOINT_RISK_POINT_C - max_dewpoint
        if dewpoint_margin <= 0 or max_margin <= 0:
            lines.append(
                f"水露点触及0°C风险点：{closest_dewpoint.get('label')} 当前{_format_metric_value(float(closest_dewpoint.get('latest') or 0), '°C')}，需复核气质与脱水工况。"
            )
        else:
            lines.append(
                f"水露点未触及0°C风险点：当前最近边界的是{closest_dewpoint.get('label')}，距0°C仍有{_format_metric_value(dewpoint_margin, '°C')}；窗口最高点距0°C为{_format_metric_value(max_margin, '°C')}。"
            )

    temperature_items = _metric_type_items(analysis, "temperature")
    if temperature_items:
        max_temp_swing = max(temperature_items, key=lambda item: float(item.get("swing") or 0))
        temp_watch_count = sum(1 for item in temperature_items if _metric_risk_rank(item) >= LUZHI_RISK_ORDER["中"])
        lines.append(
            f"温度复核：{max_temp_swing.get('label')}波动最大，幅度{_format_metric_value(float(max_temp_swing.get('swing') or 0), str(max_temp_swing.get('unit') or '°C'))}；达到中高风险阈值的温度测点{temp_watch_count}个。"
        )

    missing = analysis.get("missing_metric_types") or []
    if missing:
        missing_names = "、".join(_metric_display_name(metric_type) for metric_type in missing)
        lines.append(f"数据缺口：本次缺少{missing_names}历史点，综合风险已按现有数据保守表达，不能把缺失项当作正常。")

    return lines


def _build_station_metric_watch_items(analysis: dict[str, Any], limit: int = 3) -> list[str]:
    watch_items = [
        item
        for item in analysis.get("items", [])
        if _metric_risk_rank(item) > 0
    ]
    if not watch_items:
        watch_items = list(analysis.get("items", []))
    return [
        f"{idx}. {_strongest_metric_reason(item)}触发原因：{item.get('trigger_reason')}；建议：{item.get('action_hint')}"
        for idx, item in enumerate(watch_items[:limit], start=1)
    ]


def _build_single_station_metric_reply(
    station_name: str,
    snapshot: dict[str, Any],
    analysis: dict[str, Any],
    metric_types: list[str],
) -> str:
    metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)
    available_metric_names = "、".join(_metric_display_name(metric_type) for metric_type in analysis.get("available_metric_types", [])) or "无"
    missing_metric_names = "、".join(_metric_display_name(metric_type) for metric_type in analysis.get("missing_metric_types", [])) or "无"
    conclusion = _build_station_metric_conclusion(analysis, metric_types)
    key_evidence = _build_station_metric_key_evidence(analysis)
    watch_items = _build_station_metric_watch_items(analysis)
    lines: list[str] = [
        f"{station_name}{metric_names}结论：{conclusion}",
        "",
        f"风险等级：{analysis['overall_risk']}（置信度 {analysis['overall_confidence']:.0%}）",
        f"分析窗口：{_format_time_window(snapshot)}",
        "",
        "关键判断：",
        *key_evidence,
        "",
        "重点监测：",
        *watch_items,
        "",
        "处置建议：",
        "1. 先盯主导风险项对应曲线，确认是持续性异常还是窗口内短时波动。",
        "2. 压力项同时核对上下游计划量、调压阀开度和站间压差；接近10MPa时按硬边界升级处置。",
        "3. 水露点项以0°C为风险点，若趋势继续上行或波动扩大，优先复核脱水装置、气质化验和相关报警记录。",
        "4. 温度项结合环境温度、换热状态和伴随压力变化复核，避免把温度扰动误判为单一压力风险。",
        "",
        "数据覆盖：",
        f"已分析指标：{available_metric_names}；缺少指标：{missing_metric_names}。",
        "",
        "风险边界：",
        f"压力按设计压力 {DEFAULT_STATION_DESIGN_PRESSURE_MPA:g}MPa 作为硬边界；水露点达到或超过 {DEWPOINT_RISK_POINT_C:.0f}°C 作为风险点；温度按波动幅度和短时变化阈值复核。",
        "",
        "计算过程：",
        "1. 按目标站点和指标类型读取最近历史点，分测点/管线分组。",
        "2. 对每个测点计算：当前值 = 窗口最后一个值；6小时变化 = 当前值 - 窗口首值；波动区间 = 最大值 - 最小值；均值 = 窗口平均值。",
        f"3. 按风险边界判级：压力先对照 {DEFAULT_STATION_DESIGN_PRESSURE_MPA:g}MPa 设计压力；水露点先对照 {DEWPOINT_RISK_POINT_C:.0f}°C 风险点；未越界时再按波动幅度和短时变化判级。",
        "4. 综合风险取所有测点中的最高风险，置信度按测点波动强度和风险等级折算。",
        "",
        f"{metric_names}指标明细：",
    ]

    for idx, item in enumerate(analysis["items"], start=1):
        swing = float(item.get("swing") or (float(item["max"]) - float(item["min"])))
        lines.append(
            "{index}. {label} 当前{latest}，6小时变化{delta6h}，区间{range_text}，波动幅度{swing}，均值{avg}，风险{risk}，触发原因：{trigger}；建议：{action}".format(
                index=idx,
                label=item["label"],
                latest=_format_metric_value(float(item["latest"]), str(item["unit"])),
                delta6h=_format_signed_value(float(item["delta6h"]), str(item["unit"])),
                range_text=f"{_format_metric_number(float(item['min']))} ~ {_format_metric_number(float(item['max']))} {item['unit']}".strip(),
                swing=_format_metric_value(swing, str(item["unit"])),
                avg=_format_metric_value(float(item["avg"]), str(item["unit"])),
                risk=item["risk_level"],
                trigger=f"{item['trigger_reason']}；边界：{item.get('risk_boundary') or '未配置'}",
                action=item["action_hint"],
            )
        )

    strongest_metric = analysis.get("strongest_metric")
    if strongest_metric:
        action_target = _infer_luzhi_action_target(snapshot, strongest_metric)
        view = str(strongest_metric.get("type") or metric_types[0] or "pressure")
        if view not in {"pressure", "temperature", "dewpoint"}:
            view = "pressure"
        action_target["view"] = view
        action_target["metric"] = _metric_display_name(view)
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
    lines.append("风险边界：水露点达到或超过 0°C 判为风险点；未越界时再看波动幅度和短时变化。")
    lines.append("1. 露点指标明细")

    for idx, item in enumerate(analysis["items"], start=1):
        lines.append(
            "{index}. {label} 当前{latest}，6小时变化{delta6h}，区间{range_text}，风险{risk}，触发原因：{trigger}；建议{action}".format(
                index=idx,
                label=item["label"],
                latest=_format_metric_value(float(item["latest"]), str(item["unit"])),
                delta6h=_format_signed_value(float(item["delta6h"]), str(item["unit"])),
                range_text=f"{_format_metric_number(float(item['min']))} ~ {_format_metric_number(float(item['max']))} {item['unit']}".strip(),
                risk=item["risk_level"],
                trigger=f"{item['trigger_reason']}；边界：{item.get('risk_boundary') or '未配置'}",
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
    has_hour_window = bool(re.search(r"\d{1,3}(?:小时|h|hour)", compact, re.IGNORECASE))
    has_analysis_intent = "分析" in compact or "研判" in compact
    has_station_ref = any(token in compact for token in HISTORY_STATION_REFERENCE_KEYWORDS)
    return has_metric and (has_curve_intent or has_hour_window or (has_analysis_intent and has_station_ref))


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


def _detect_metric_analysis_types(message: str) -> list[str]:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    metric_types: list[str] = []
    if any(kw.lower() in compact for kw in PRESSURE_KEYWORDS):
        metric_types.append("pressure")
    if any(kw.lower() in compact for kw in TEMPERATURE_KEYWORDS):
        metric_types.append("temperature")
    if any(kw.lower() in compact for kw in DEWPOINT_QUERY_KEYWORDS):
        metric_types.append("dewpoint")
    if not metric_types and _looks_like_station_risk_analysis_query(compact):
        return ["pressure", "temperature", "dewpoint"]
    return metric_types or [_detect_history_metric_type(compact)]


def _looks_like_station_risk_analysis_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    has_station_ref = any(token in compact for token in HISTORY_STATION_REFERENCE_KEYWORDS)
    has_risk_intent = any(keyword in compact for keyword in ("风险分析", "风险评估", "风险研判", "综合风险", "风险情况"))
    return has_station_ref and has_risk_intent


def _looks_like_metric_analysis_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    has_metric = (
        any(kw.lower() in compact for kw in PRESSURE_KEYWORDS)
        or any(kw.lower() in compact for kw in TEMPERATURE_KEYWORDS)
        or any(kw.lower() in compact for kw in DEWPOINT_QUERY_KEYWORDS)
    )
    has_analysis_intent = any(keyword in compact for keyword in ("分析", "研判", "判断", "情况", "异常", "风险", "波动", "评估"))
    has_station_ref = any(token in compact for token in HISTORY_STATION_REFERENCE_KEYWORDS)
    return (has_metric or _looks_like_station_risk_analysis_query(compact)) and has_analysis_intent and has_station_ref


def _metric_display_name(metric_type: str) -> str:
    if metric_type == "pressure":
        return "压力"
    if metric_type == "temperature":
        return "温度"
    if metric_type == "dewpoint":
        return "水露点"
    return "指标"


def _metric_default_unit(metric_type: str) -> str:
    if metric_type == "pressure":
        return "MPa"
    if metric_type in {"temperature", "dewpoint"}:
        return "°C"
    return ""


def _extract_history_hours(message: str, default: int = 12) -> int:
    compact = re.sub(r"\s+", "", str(message or ""))
    match = re.search(r"(\d{1,3})(?:小时|h|hour)", compact, re.IGNORECASE)
    if not match:
        return default
    try:
        hours = int(match.group(1))
    except ValueError:
        return default
    return min(max(hours, 1), 168)


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


def _build_history_curve_action_token(station_name: str, metric_type: str, hours: int = 12) -> str:
    view = "pressure"
    metric_label = "压力"
    if metric_type == "temperature":
        view = "temperature"
        metric_label = "温度"
    elif metric_type == "dewpoint":
        view = "dewpoint"
        metric_label = "水露点"
    elif metric_type == "overview":
        view = "overview"
        metric_label = "压力/水露点"

    station_token = _sanitize_action_token_text(station_name)
    metric_token = _sanitize_action_token_text(metric_label)
    return (
        "[ACTION:OPEN_HISTORY_PANEL"
        f"|station={station_token}"
        f"|view={view}"
        f"|hours={hours}"
        "|time_start="
        "|time_end="
        f"|metric={metric_token}]"
    )


def _build_history_curve_action_reply(station_name: str, metric_type: str, hours: int = 12) -> str:
    metric_label = "压力"
    if metric_type == "temperature":
        metric_label = "温度"
    elif metric_type == "dewpoint":
        metric_label = "水露点"
    elif metric_type == "overview":
        metric_label = "压力/水露点"

    return (
        f"{station_name}{metric_label}历史曲线已就位，点下面按钮直接开图看趋势。\n\n"
        f"{_build_history_curve_action_token(station_name, metric_type, hours)}\n\n"
    )


def _build_locate_station_action_reply(station_name: str) -> str:
    station_token = _sanitize_action_token_text(station_name)
    return (
        f"拓扑分析已定位到{station_name}，地图会把视角切到该站，方便看上下游关系。\n\n"
        "[ACTION:LOCATE_STATION"
        f"|station={station_token}"
        "|auto=1]\n\n"
    )


def _build_zhongwei_multi_scenario_action_reply() -> str:
    return (
        "仿真 Agent 已准备好三工况演示：3000 万方/天、2000 万方/天、截断。请点击下面按钮开始，完成后主 Agent 再统一输出结论。\n\n"
        f"[ACTION:START_MULTI_SCENARIO_AI|scenario_ids={','.join(DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS)}|auto=0]\n\n"
    )


def _build_subagent_step_action_reply(
    *,
    step: str,
    status: str,
    title: str,
    message: str,
) -> str:
    step_token = _sanitize_action_token_text(step)
    status_token = _sanitize_action_token_text(status)
    title_token = _sanitize_action_token_text(title)
    message_token = _sanitize_action_token_text(re.sub(r"\s+", " ", message).strip()[:96])
    return (
        "[ACTION:SUBAGENT_STEP"
        f"|step={step_token}"
        f"|status={status_token}"
        f"|title={title_token}"
        f"|message={message_token}]"
    )


def _build_multi_station_compare_reply(compare_result: str, station_list: list[str], metric_type: str, hours: int) -> str:
    metric_label_map = {
        "pressure": "压力",
        "temperature": "温度",
        "dewpoint": "水露点",
        "all": "综合指标",
    }
    metric_label = metric_label_map.get(metric_type, "综合指标")
    lines = [
        f"结论：已生成{len(station_list)}站{hours}小时{metric_label}横向比对报告。",
        "",
        "比对报告：",
        compare_result.strip(),
    ]

    action_metric = metric_type if metric_type in {"pressure", "temperature", "dewpoint"} else "pressure"
    action_lines: list[str] = []
    for station in station_list:
        resolved_station, has_metric_data = _resolve_station_for_history_metric(station, action_metric)
        if has_metric_data:
            action_lines.append(_build_history_curve_action_token(resolved_station, action_metric, hours))

    if action_lines:
        lines.extend(["", "曲线入口："])
        for action_line in action_lines:
            lines.extend(["", action_line])

    return "\n".join(lines).strip() + "\n"


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
            "已进入数据分析状态。你可以直接说“甪直站风险分析”“中卫站风险分析”“甪直水露点”，或“甲站和乙站水露点对比”。",
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

    # 多站横向对比优先于单站历史曲线，否则“中卫站、甪直站12小时压力”会被截成单站动作。
    if _looks_like_multi_station_compare(normalized_message):
        station_list = _extract_multi_station_list(target_message)
        if len(station_list) >= 2:
            compare_metric = _detect_compare_metric(normalized_message)
            hours = _extract_history_hours(normalized_message, default=24)
            stations_arg = ','.join(station_list)
            try:
                from app.services.assistant_tools import TOOL_HANDLERS
                from app.database import get_session
                with next(get_session()) as db_session:
                    compare_result = TOOL_HANDLERS['compare_stations'](
                        {'stations': stations_arg, 'metric': compare_metric, 'hours': hours},
                        db_session
                    )
                compare_reply = _build_multi_station_compare_reply(
                    compare_result,
                    station_list,
                    compare_metric,
                    hours,
                )
                return with_term_correction(_append_completeness_hint(
                    compare_reply,
                    request.message,
                    is_complete=True,
                    reason=f'已完成{len(station_list)}站{hours}小时{compare_metric}横向比对报告，并生成曲线入口。',
                ))
            except Exception as _exc:
                logger.warning('多站对比工具调用失败: %s', _exc)
                # 失败时降级继续走后续意图识别

    if _looks_like_metric_analysis_query(normalized_message):
        metric_types = _detect_metric_analysis_types(normalized_message)
        station_name_input = _extract_station_name_for_dewpoint(target_message, request.context)
        if not station_name_input:
            return with_term_correction(_append_completeness_hint(
                "我识别到你要做指标分析，但这句里没抓到站名。请带上站名再发一次，比如“甪直站压力和温度情况”。",
                request.message,
                is_complete=False,
                reason="指标分析缺少站名。",
            ))

        hours = _extract_history_hours(normalized_message, default=12)
        snapshot_index, alias_index = _collect_station_snapshots(request.context)
        resolved_station_name, resolved_snapshot = _resolve_station_snapshot(station_name_input, snapshot_index, alias_index)
        station_analysis = _analyze_station_metrics(resolved_snapshot, metric_types) if resolved_snapshot else None

        if station_analysis is None:
            resolved_station_name, resolved_snapshot = _ensure_station_metric_snapshot_from_db(
                resolved_station_name or station_name_input,
                metric_types,
                snapshot_index,
                alias_index,
                lookback_hours=hours,
            )
            station_analysis = _analyze_station_metrics(resolved_snapshot, metric_types) if resolved_snapshot else None

        if resolved_snapshot is None:
            metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)
            return with_term_correction(_append_completeness_hint(
                f"{station_name_input}目前没有可用的{metric_names}历史数据，先导入该指标后就能分析。",
                request.message,
                is_complete=False,
                reason=f"目标站点缺少{','.join(metric_types)}时序数据。",
            ))

        if station_analysis is None:
            metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)
            return with_term_correction(_append_completeness_hint(
                f"{resolved_station_name}当前快照没有{metric_names}指标，暂时无法分析。",
                request.message,
                is_complete=False,
                reason=f"站点快照缺少{','.join(metric_types)}指标。",
            ))

        metric_reply = _build_single_station_metric_reply(
            resolved_station_name,
            resolved_snapshot,
            station_analysis,
            metric_types,
        )
        metric_names = "、".join(_metric_display_name(metric_type) for metric_type in metric_types)
        return with_term_correction(_append_completeness_hint(
            metric_reply,
            request.message,
            is_complete=True,
            reason=f"已完成{resolved_station_name}{metric_names}指标计算分析，并生成历史曲线入口。",
        ))

    if _looks_like_history_curve_query(normalized_message):
        metric_type = _detect_history_metric_type(normalized_message)
        station_name_input = _extract_station_name_for_dewpoint(target_message, request.context)
        if not station_name_input:
            return with_term_correction(_append_completeness_hint(
                "我识别到你要查历史曲线了，但这句里没抓到站名。请带上站名再发一次，比如“中卫站12小时压力分析”。",
                request.message,
                is_complete=False,
                reason="历史曲线查询缺少站名。",
            ))

        resolved_station, has_metric_data = _resolve_station_for_history_metric(station_name_input, metric_type)
        if not has_metric_data:
            metric_label = "压力" if metric_type == "pressure" else ("温度" if metric_type == "temperature" else "水露点")
            return with_term_correction(_append_completeness_hint(
                f"{station_name_input}目前没有可用的{metric_label}历史数据，先导入该指标后就能出曲线。",
                request.message,
                is_complete=False,
                reason=f"目标站点缺少{metric_type}时序数据。",
            ))

        hours = _extract_history_hours(normalized_message, default=12)
        history_reply = _build_history_curve_action_reply(resolved_station, metric_type, hours)
        return with_term_correction(_append_completeness_hint(
            history_reply,
            request.message,
            is_complete=True,
            reason=f"已识别{resolved_station}{hours}小时{metric_type}历史曲线查询并生成动作。",
        ))

    if not (mode_active_before or command == "enter" or _looks_like_dewpoint_query(normalized_message)):
        return None

    if not _looks_like_dewpoint_query(normalized_message):
        return None

    snapshot_index, alias_index = _collect_station_snapshots(request.context)

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


def _ensure_station_metric_snapshot_from_db(
    station_name: str,
    metric_types: list[str],
    station_snapshots: dict[str, dict[str, Any]],
    alias_index: dict[str, str],
    *,
    lookback_hours: int = 24,
) -> tuple[str, dict[str, Any] | None]:
    db_station_name, db_snapshot = _load_station_metric_snapshot_from_scada_history(
        station_name,
        metric_types=metric_types,
        lookback_hours=lookback_hours,
    )
    if db_snapshot is None:
        return station_name, None
    _register_station_snapshot(station_snapshots, alias_index, db_snapshot)
    return _resolve_station_snapshot(db_station_name, station_snapshots, alias_index)


def _load_station_snapshot_from_scada_history(
    station_name: str,
    *,
    lookback_hours: int = 24,
) -> tuple[str, dict[str, Any] | None]:
    return _load_station_metric_snapshot_from_scada_history(
        station_name,
        metric_types=["dewpoint"],
        lookback_hours=lookback_hours,
    )


def _load_station_metric_snapshot_from_scada_history(
    station_name: str,
    *,
    metric_types: list[str],
    lookback_hours: int = 24,
) -> tuple[str, dict[str, Any] | None]:
    requested = str(station_name or "").strip()
    if not requested:
        return "", None
    wanted_types = [metric_type for metric_type in dict.fromkeys(metric_types) if metric_type in {"pressure", "temperature", "dewpoint"}]
    if not wanted_types:
        return requested, None

    try:
        with Session(scada_history_engine) as history_session:
            available_rows = history_session.exec(
                select(ScadaHistory.station_name).where(ScadaHistory.metric_type.in_(wanted_types))
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
                    ScadaHistory.metric_type.in_(wanted_types),
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
                    ScadaHistory.metric_type.in_(wanted_types),
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
                            ScadaHistory.metric_type.in_(wanted_types),
                        )
                        .order_by(ScadaHistory.recorded_at)
                    ).all()
                ]
            if not rows:
                return resolved_station, None

    except Exception as exc:
        logger.warning("load metric snapshot from scada_history failed: %s", exc)
        return requested, None

    snapshot = _build_metric_snapshot_from_history_rows(
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
    return _build_metric_snapshot_from_history_rows(station_name=station_name, rows=rows)


def _build_metric_snapshot_from_history_rows(
    *,
    station_name: str,
    rows: list[ScadaHistory],
) -> dict[str, Any] | None:
    if not rows:
        return None

    grouped: dict[tuple[str, str, str], list[ScadaHistory]] = {}
    for row in rows:
        metric_type = str(row.metric_type or "").strip()
        pipeline_id = str(row.pipeline_id or "").strip()
        tag_name = str(row.tag_name or "").strip()
        grouped.setdefault((metric_type, pipeline_id, tag_name), []).append(row)

    metrics: list[dict[str, Any]] = []
    time_start = rows[0].recorded_at
    time_end = rows[-1].recorded_at

    for (metric_type, pipeline_id, tag_name), metric_rows in grouped.items():
        if not metric_rows:
            continue
        metric_rows.sort(key=lambda item: item.recorded_at)
        values = [float(item.value) for item in metric_rows]
        latest_value = values[-1]
        earliest_value = values[0]
        min_value = min(values)
        max_value = max(values)
        avg_value = sum(values) / len(values)
        metric_label = _build_history_metric_label(metric_type, pipeline_id, tag_name)
        metrics.append(
            {
                "label": metric_label,
                "pipeline": pipeline_id.upper() or metric_label,
                "type": metric_type or "unknown",
                "unit": _metric_default_unit(metric_type),
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


def _build_history_metric_label(metric_type: str, pipeline_id: str, tag_name: str) -> str:
    pipeline_map = {
        "we1": "西一线",
        "we2": "西二线",
        "cred": "中俄线",
        "pt": "普唐线",
    }
    pipeline_key = str(pipeline_id or "").strip().lower()
    pipeline_label = pipeline_map.get(pipeline_key) or str(pipeline_id or "").upper() or "未知管线"
    metric_label = _metric_display_name(metric_type)
    if tag_name:
        return f"{pipeline_label} {metric_label} ({tag_name})"
    return f"{pipeline_label} {metric_label}"


def _build_dewpoint_metric_label(pipeline_id: str, tag_name: str) -> str:
    return _build_history_metric_label("dewpoint", pipeline_id, tag_name)


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
                trigger=f"{metric_eval['trigger_reason']}；{metric_eval.get('risk_boundary') or '边界未配置'}",
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
        "风险边界：压力按管线设计压力作为硬边界；水露点达到或超过 0°C 判为风险点。",
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


def _metric_numeric_field(metric: dict[str, Any], *field_names: str) -> float | None:
    for field_name in field_names:
        value = _to_float(metric.get(field_name))
        if value is not None and value > 0:
            return value
    return None


def _metric_pipeline_lookup_refs(metric: dict[str, Any]) -> list[str]:
    raw_refs = [
        str(metric.get("pipeline") or ""),
        str(metric.get("pipeline_id") or ""),
        str(metric.get("pipelineId") or ""),
        str(metric.get("label") or ""),
    ]
    alias_map = {
        "we1": ["西气东输一线", "西一线", "WE1"],
        "we2": ["西气东输二线", "西二线", "WE2"],
        "cred": ["中俄东线", "中俄线", "CRED"],
        "pt": ["普唐线", "PT"],
    }
    refs: list[str] = []
    for raw_ref in raw_refs:
        ref = raw_ref.strip()
        if not ref:
            continue
        refs.append(ref)
        refs.extend(alias_map.get(ref.lower(), []))
        for token in ("西一线", "西二线", "中俄线", "中俄东线", "普唐线"):
            if token in ref:
                refs.append(token)
    return list(dict.fromkeys(refs))


def _resolve_metric_pressure_boundary(metric: dict[str, Any]) -> tuple[float | None, str]:
    direct_boundary = _metric_numeric_field(
        metric,
        "design_pressure_mpa",
        "designPressureMpa",
        "designPressure",
        "design_pressure",
        "pressure_boundary_mpa",
        "pressureBoundaryMpa",
        "max_pressure_mpa",
        "maxPressureMpa",
    )
    if direct_boundary is not None:
        return direct_boundary, "指标快照"

    for ref in _metric_pipeline_lookup_refs(metric):
        try:
            pipeline = raw_excel_ai_index.get_pipeline(ref)
        except Exception as exc:
            logger.debug("resolve pipeline design pressure failed for %s: %s", ref, exc)
            pipeline = None
        boundary = _to_float((pipeline or {}).get("design_pressure_mpa"))
        if boundary is not None and boundary > 0:
            return boundary, str((pipeline or {}).get("name") or ref)

    return DEFAULT_STATION_DESIGN_PRESSURE_MPA, "站场风险分析默认边界"

def _evaluate_luzhi_metric(metric: dict[str, Any]) -> dict[str, Any]:
    swing = max(float(metric["max"]) - float(metric["min"]), 0.0)
    delta6h = float(metric["delta6h"])
    abs_delta = abs(delta6h)
    metric_type = str(metric.get("type") or "unknown")
    latest = float(metric["latest"])
    maximum = float(metric["max"])

    if abs_delta < 1e-4:
        trend = "基本持平"
    elif delta6h > 0:
        trend = "上升"
    else:
        trend = "下降"

    risk_level, trigger_reason, boundary_text = _grade_metric_risk(metric_type, swing, abs_delta, latest, maximum, metric)
    action_hint = _build_metric_action_hint(metric_type, risk_level)
    confidence = _estimate_metric_confidence(metric_type, risk_level, swing, abs_delta)

    return {
        "trend": trend,
        "swing": swing,
        "risk_level": risk_level,
        "trigger_reason": trigger_reason,
        "risk_boundary": boundary_text,
        "action_hint": action_hint,
        "confidence": confidence,
    }


def _grade_metric_risk(
    metric_type: str,
    swing: float,
    abs_delta: float,
    latest: float,
    maximum: float,
    metric: dict[str, Any],
) -> tuple[str, str, str]:
    if metric_type == "pressure":
        boundary, boundary_source = _resolve_metric_pressure_boundary(metric)
        if boundary is not None:
            boundary_text = f"压力边界=管线设计压力 {boundary:g} MPa（来源：{boundary_source}）"
            if latest >= boundary:
                return "高", f"当前压力已达到或超过管线设计压力边界 {boundary:g} MPa", boundary_text
            if maximum >= boundary:
                return "高", f"窗口内最高压力已达到或超过管线设计压力边界 {boundary:g} MPa", boundary_text
        else:
            boundary_text = "压力边界=管线设计压力（当前指标未命中可用设计压力，暂按波动阈值复核）"

        if swing >= 0.45 or abs_delta >= 0.22:
            return "高", "压力波动较大（幅度或短时变化超高风险阈值）", boundary_text
        if swing >= 0.30 or abs_delta >= 0.15:
            return "中", "压力波动偏大（达到中风险阈值）", boundary_text
        if swing >= 0.20 or abs_delta >= 0.10:
            return "低", "压力有轻微波动（达到低风险阈值）", boundary_text
        return "正常", "压力变化在稳态区间", boundary_text

    if metric_type == "temperature":
        boundary_text = "温度边界=按温度波动和短时变化阈值复核"
        if swing >= 8.0 or abs_delta >= 4.0:
            return "高", "温度变化过快（幅度或短时变化超高风险阈值）", boundary_text
        if swing >= 5.0 or abs_delta >= 2.5:
            return "中", "温度波动偏大（达到中风险阈值）", boundary_text
        if swing >= 3.0 or abs_delta >= 1.5:
            return "低", "温度有可见波动（达到低风险阈值）", boundary_text
        return "正常", "温度变化在稳态区间", boundary_text

    if metric_type == "dewpoint":
        boundary_text = f"水露点风险点={DEWPOINT_RISK_POINT_C:g}°C"
        if latest >= DEWPOINT_RISK_POINT_C:
            return "高", f"当前水露点已达到或超过 {DEWPOINT_RISK_POINT_C:g}°C 风险点", boundary_text
        if maximum >= DEWPOINT_RISK_POINT_C:
            return "高", f"窗口内水露点曾达到或超过 {DEWPOINT_RISK_POINT_C:g}°C 风险点", boundary_text
        if swing >= 6.0 or abs_delta >= 3.0:
            return "高", "露点变化较大（幅度或短时变化超高风险阈值）", boundary_text
        if swing >= 4.0 or abs_delta >= 2.0:
            return "中", "露点波动偏大（达到中风险阈值）", boundary_text
        if swing >= 2.5 or abs_delta >= 1.2:
            return "低", "露点有可见波动（达到低风险阈值）", boundary_text
        return "正常", "露点变化在稳态区间", boundary_text

    boundary_text = "通用指标边界=按波动阈值复核"
    if swing >= 2.0 or abs_delta >= 1.0:
        return "中", "通用指标波动偏大", boundary_text
    if swing >= 1.0 or abs_delta >= 0.5:
        return "低", "通用指标存在波动", boundary_text
    return "正常", "通用指标变化稳定", boundary_text


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
_MULTI_SOURCE_DIRECT_HINTS = (
    "三库", "多库", "跨库", "多源", "三源", "交叉查询", "交叉分析", "交叉验证",
)


def _is_explicit_multi_source_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", message)
    if MULTI_SOURCE_DIRECT_PATTERN.match(message):
        return True
    return any(hint in compact for hint in _MULTI_SOURCE_DIRECT_HINTS)


def _strip_multi_source_prefix(message: str) -> str:
    text = str(message or "").strip()
    match = MULTI_SOURCE_DIRECT_PATTERN.match(text)
    if match:
        payload = (match.group("payload") or "").strip()
        return payload or text

    stripped = re.sub(
        r"^\s*(?:请)?(?:用AI|用ai|让AI|让ai)?(?:直接)?(?:结合|调用|使用)?"
        r"(?:三库|多库|多源|三源|跨库)(?:并行)?"
        r"(?:查询|分析|交叉查询|交叉分析|交叉验证|查一下|看一下)?[：:，,\s]*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return stripped or text


def _should_use_multi_source(message: str) -> bool:
    """
    判断用户问题是否适合使用多库并行交叉分析
    触发条件：包含站名 + 包含分析/对比/为什么等关键词 + 包含指标词
    """
    if _is_explicit_multi_source_query(message):
        return True

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

        query_message = _strip_multi_source_prefix(request.message)
        yield f"[TOOL] {json.dumps('multi-source-query', ensure_ascii=False)}\n"
        yield f"[THINK] {json.dumps('已启动三库/多库并行查询：主业务与原始资料、SCADA 时序、规程向量；涉及仿真时会追加仿真快照。', ensure_ascii=False)}\n"

        result = await multi_source_orchestrator.analyze(query_message)

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
            query_message,
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
    yield f"[REPLY] {_subagent_block(payload)}\n"


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

    if any(word in compact for word in ("截断", "停输", "断供", "关断", "处置")):
        task_type = "截断处置推演"
    elif any(word in compact for word in ("仿真", "模拟", "推演", "如果", "假设", "限流", "下降")):
        task_type = "仿真推演"
    elif any(word in compact for word in ("曲线", "历史", "趋势", "压力", "露点", "温度")):
        task_type = "历史曲线分析"
    else:
        task_type = "综合风险分析"
    return task_type, targets


def _looks_like_zhongwei_simulation_request(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    if "中卫" not in compact:
        return False
    return any(
        word in compact
        for word in (
            "仿真",
            "模拟",
            "推演",
            "演示",
            "接入",
            "风险",
            "影响",
            "分析",
            "限流",
            "下降",
            "截断",
        )
    )


def _count_knowledge_hits(tool_result: str) -> int:
    match = re.search(r"命中片段数：\s*(\d+)", tool_result or "")
    if match:
        return int(match.group(1))
    if "未检索到足够相关" in (tool_result or "") or "执行出错" in (tool_result or ""):
        return 0
    return len(re.findall(r"\d+\.\s*来源：", tool_result or ""))


def _collect_subagent_scada_summary(targets: list[str]) -> dict[str, Any]:
    summary: dict[str, Any] = {"connected": False, "records": [], "total_count": 0}
    metric_types = ("pressure", "temperature", "dewpoint")
    try:
        with Session(scada_history_engine) as history_session:
            summary["connected"] = True
            for target in targets:
                for metric_type in metric_types:
                    resolved_station, has_metric_data = _resolve_station_for_history_metric(target, metric_type)
                    if not has_metric_data or not resolved_station:
                        continue
                    rows = history_session.exec(
                        select(ScadaHistory)
                        .where(
                            ScadaHistory.station_name == resolved_station,
                            ScadaHistory.metric_type == metric_type,
                        )
                        .order_by(ScadaHistory.recorded_at.desc())
                        .limit(720)
                    ).all()
                    if not rows:
                        continue
                    latest = rows[0]
                    snapshot = _build_metric_snapshot_from_history_rows(station_name=resolved_station, rows=list(rows))
                    if snapshot:
                        for metric in snapshot.get("metrics", []):
                            metric_eval = _evaluate_luzhi_metric(metric)
                            summary["records"].append({
                                "target": target,
                                "station": resolved_station,
                                "metric": metric.get("type") or metric_type,
                                "label": metric.get("label") or _metric_display_name(metric_type),
                                "pipeline": metric.get("pipeline") or "",
                                "count": len(rows),
                                "latest_value": metric.get("latest"),
                                "min": metric.get("min"),
                                "max": metric.get("max"),
                                "avg": metric.get("avg"),
                                "delta6h": metric.get("delta6h"),
                                "unit": metric.get("unit") or latest.unit,
                                "latest_time": latest.recorded_at.isoformat() if latest.recorded_at else "",
                                "risk_level": metric_eval.get("risk_level"),
                                "trigger_reason": metric_eval.get("trigger_reason"),
                                "risk_boundary": metric_eval.get("risk_boundary"),
                                "trend": metric_eval.get("trend"),
                                "confidence": metric_eval.get("confidence"),
                            })
                    else:
                        summary["records"].append({
                            "target": target,
                            "station": resolved_station,
                            "metric": metric_type,
                            "label": _metric_display_name(metric_type),
                            "count": len(rows),
                            "latest_value": latest.value,
                            "unit": latest.unit,
                            "latest_time": latest.recorded_at.isoformat() if latest.recorded_at else "",
                        })
                    summary["total_count"] += len(rows)
    except Exception as exc:
        logger.warning("collect subagent scada evidence failed: %s", exc)
        summary["error"] = str(exc)
    return summary


def _collect_subagent_knowledge_summary(message: str, targets: list[str], session: Session) -> dict[str, Any]:
    target_text = "、".join(targets) or "目标站"
    query = f"{target_text} 截断 站场失效 应急处置 调度处置"
    if "规程" in message or "预案" in message or "应急" in message:
        query = message
    summary: dict[str, Any] = {"connected": True, "query": query, "hit_count": 0, "sources": []}
    try:
        tool_result = execute_tool("search_knowledge_base", {"query": query, "limit": 5}, session)
        summary["hit_count"] = _count_knowledge_hits(tool_result)
        source_lines = re.findall(r"\d+\.\s*来源：([^\n]+)", tool_result or "")
        cleaned_sources: list[str] = []
        for source in source_lines[:5]:
            text = re.sub(r"\s*/\s*chunk\s*#\S+", "", source, flags=re.IGNORECASE).strip()
            if text and text not in cleaned_sources:
                cleaned_sources.append(text)
        summary["sources"] = cleaned_sources
    except Exception as exc:
        logger.warning("collect subagent knowledge evidence failed: %s", exc)
        summary.update({"connected": False, "error": str(exc)})
    return summary


def _collect_subagent_simulation_summary(message: str, session: Session) -> dict[str, Any]:
    compact = re.sub(r"\s+", "", message or "")
    is_zhongwei_auto_demo = _looks_like_zhongwei_simulation_request(message)
    should_run_model = is_zhongwei_auto_demo or any(word in compact for word in ("仿真", "模拟", "推演", "限流", "下降", "截断", "三库一模", "一模"))
    summary: dict[str, Any] = {
        "connected": should_run_model,
        "tool": "run_steady_sim",
        "pilot_id": "zhongwei_shanghai_baihe",
        "scenario_id": "steady_base",
        "status": "not_required",
        "auto_demo": is_zhongwei_auto_demo,
        "demo_action": "START_MULTI_SCENARIO_AI" if is_zhongwei_auto_demo else "",
        "selected_scenario_ids": DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS if is_zhongwei_auto_demo else [],
    }
    if not should_run_model:
        return summary
    try:
        tool_result = execute_tool(
            "run_steady_sim",
            {"pilot_id": "zhongwei_shanghai_baihe", "scenario_id": "steady_base"},
            session,
        )
        status_match = re.search(r"状态：([^，\n]+)", tool_result)
        supply_match = re.search(r"总供气：([0-9.]+)\s*万方/天", tool_result)
        unserved_match = re.search(r"未满足需求：([0-9.]+)\s*万方/天", tool_result)
        risk_match = re.search(r"风险等级：([A-Za-z0-9_\u4e00-\u9fa5-]+)", tool_result)
        run_id_match = re.search(r"稳态仿真已完成：([^\s，\n]+)", tool_result)
        summary.update({
            "run_id": run_id_match.group(1).strip() if run_id_match else "",
            "status": status_match.group(1).strip() if status_match else "returned",
            "total_supply": float(supply_match.group(1)) if supply_match else None,
            "unserved_demand": float(unserved_match.group(1)) if unserved_match else None,
            "risk_level": risk_match.group(1).strip() if risk_match else "",
        })
    except Exception as exc:
        logger.warning("collect subagent simulation evidence failed: %s", exc)
        summary.update({"status": "error", "error": str(exc)})
    return summary


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


def _looks_like_subagent_cutoff_response_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", message or "")
    if not any(target in compact for target in ("中卫", "靖边", "甪直", "榆林", "站")):
        return False
    has_cutoff = any(word in compact for word in ("截断", "停输", "断供", "关断", "站场失效"))
    has_response = any(word in compact for word in ("处置", "怎么办", "怎么处理", "怎么应对", "风险", "影响", "分析", "研判"))
    return has_cutoff and has_response


def _looks_like_subagent_simulation_showcase_query(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or "")).lower()
    return _looks_like_zhongwei_simulation_request(compact) and (
        "subagent" in compact
        or "agent" in compact
        or "专家组" in compact
        or "自动演示" in compact
        or "自动开启" in compact
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
    except Exception as exc:
        logger.warning("collect subagent pipeline count failed: %s", exc)

    evidence["sql_summary"] = {
        "connected": True,
        "junction_count": len(evidence.get("junctions", [])),
        "station_count": len(evidence.get("stations", [])),
        "pipeline_count": evidence.get("pipeline_count", 0),
    }
    evidence["scada_summary"] = _collect_subagent_scada_summary(targets)
    evidence["knowledge_summary"] = _collect_subagent_knowledge_summary(message, targets, session)
    evidence["simulation_summary"] = _collect_subagent_simulation_summary(message, session)

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
    scada_summary = evidence.get("scada_summary") or {}
    knowledge_summary = evidence.get("knowledge_summary") or {}
    simulation_summary = evidence.get("simulation_summary") or {}
    scada_count = int(scada_summary.get("total_count") or 0)
    knowledge_hits = int(knowledge_summary.get("hit_count") or 0)
    sim_status = str(simulation_summary.get("status") or "未运行")

    fallback_map = {
        "主控 Agent": (
            f"结论：本次按“{evidence.get('task_type', '综合风险分析')}”编排，目标锁定 {targets}。"
            "依据：需要同时调 SQL业务库、SCADA时序库、规程知识库和稳态仿真模型。"
        ),
        "历史曲线 Agent": (
            f"结论：已触发自动调曲线流程，SCADA时序库当前命中 {scada_count} 条相关压力/温度/水露点记录。"
            "依据：处置前必须先看趋势，不能只凭单点数值判断截断影响。"
        ),
        "拓扑分析 Agent": (
            f"结论：已把 {targets} 放到运行时拓扑里检查，当前命中枢纽 {junction_count} 个、站点 {station_count} 个。"
            "依据：影响范围要按 NetworkX 有向拓扑判断上下游和可能绕行路径。"
        ),
        "规程处置 Agent": (
            f"结论：已检索规程/预案库，当前命中 {knowledge_hits} 条相关片段。"
            "依据：没有明确命中的专站卡片时，不能把通用应急处置说成中卫专属操作票。"
        ),
        "仿真推演 Agent": (
            f"结论：稳态仿真模型已进入演示推演，当前模型状态为 {sim_status}。"
            "依据：生产级计算还需要真实截断量、边界压力和下游需求，缺数据时只能标注为演示推演。"
        ),
        "中卫稳态仿真 Agent": (
            f"结论：中卫已接入稳态仿真工具，当前模型状态为 {sim_status}。"
            "依据：本轮按中卫-上海白鹤样板调用 run_steady_sim，并准备联动全国一张网三工况自动演示。"
        ),
        "风险复核 Agent": (
            "结论：复核重点是防止把演示推演说成真实未来。"
            "依据：压力边界按管线设计压力，水露点风险点按 0°C，风险等级、安全阈值和调度建议必须绑定实时数据或明确假设。"
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
    if re.search(r"(critic|critique|足够|缺乏足够|风险仿)\s*$", cleaned, flags=re.IGNORECASE):
        return _fallback_subagent_brief(agent_title, evidence)
    if re.search(r"(基于|依据|结论|建议|说明)[:：]?\s*$", cleaned):
        return _fallback_subagent_brief(agent_title, evidence)
    return cleaned


def _subagent_metric_records(
    scada_summary: dict[str, Any],
    wanted_types: set[str] | None = None,
) -> list[dict[str, Any]]:
    raw_records = scada_summary.get("records") if isinstance(scada_summary, dict) else None
    if not isinstance(raw_records, list):
        return []

    records: list[dict[str, Any]] = []
    for raw_record in raw_records:
        if not isinstance(raw_record, dict):
            continue
        metric_type = str(raw_record.get("metric") or "").strip().lower()
        if wanted_types and metric_type not in wanted_types:
            continue
        latest = _to_float(raw_record.get("latest_value"))
        if latest is None:
            continue
        record = dict(raw_record)
        record["metric"] = metric_type
        record["latest_value"] = latest
        for key in ("min", "max", "avg", "delta6h"):
            numeric_value = _to_float(record.get(key))
            if numeric_value is not None:
                record[key] = numeric_value
        records.append(record)

    order = {"pressure": 0, "dewpoint": 1, "temperature": 2}
    records.sort(key=lambda item: (order.get(str(item.get("metric") or ""), 9), str(item.get("label") or "")))
    return records


def _build_subagent_metric_trend_digest(scada_summary: dict[str, Any]) -> dict[str, Any] | None:
    records = _subagent_metric_records(scada_summary, {"pressure", "dewpoint"})
    if not records:
        return None

    risk_levels = [str(item.get("risk_level") or "正常") for item in records]
    overall_risk = max(risk_levels, key=lambda level: LUZHI_RISK_ORDER.get(level, 0), default="正常")
    pressure_items = [item for item in records if item.get("metric") == "pressure"]
    dewpoint_items = [item for item in records if item.get("metric") == "dewpoint"]
    pressure_risk_items = [item for item in pressure_items if str(item.get("risk_level") or "正常") in {"中", "高"}]
    dewpoint_risk_items = [item for item in dewpoint_items if str(item.get("risk_level") or "正常") in {"中", "高"}]
    pressure_boundary_crossed = any(
        "达到或超过管线设计压力边界" in str(item.get("trigger_reason") or "")
        for item in pressure_items
    )
    dewpoint_boundary_crossed = any(
        _to_float(item.get("latest_value")) is not None
        and _to_float(item.get("latest_value")) >= DEWPOINT_RISK_POINT_C
        for item in dewpoint_items
    )
    dewpoint_window_crossed = any(
        _to_float(item.get("max")) is not None
        and _to_float(item.get("max")) >= DEWPOINT_RISK_POINT_C
        for item in dewpoint_items
    )

    def describe_item(item: dict[str, Any]) -> str:
        unit = str(item.get("unit") or "")
        latest = _format_metric_value(float(item["latest_value"]), unit)
        delta = _format_signed_value(float(item.get("delta6h") or 0), unit) if "delta6h" in item else "暂无"
        minimum = _to_float(item.get("min"))
        maximum = _to_float(item.get("max"))
        average = _to_float(item.get("avg"))
        range_text = (
            f"{_format_metric_number(minimum)} ~ {_format_metric_number(maximum)} {unit}".strip()
            if minimum is not None and maximum is not None
            else "暂无"
        )
        avg_text = _format_metric_value(average, unit) if average is not None else "暂无"
        risk = str(item.get("risk_level") or "正常")
        reason = str(item.get("trigger_reason") or "按风险边界与波动阈值复核")
        boundary = str(item.get("risk_boundary") or "边界待补充")
        return (
            f"- {item.get('label') or _metric_display_name(str(item.get('metric') or ''))}："
            f"当前 {latest}，6小时变化 {delta}，波动 {range_text}，均值 {avg_text}，"
            f"风险 {risk}（{reason}；{boundary}）。"
        )

    def report_label(item: dict[str, Any]) -> str:
        label = str(item.get("label") or _metric_display_name(str(item.get("metric") or "")))
        label = re.sub(r"\s*\([^)]*\)", "", label)
        return re.sub(r"\s+", "", label)

    current_parts = [
        f"{report_label(item)}为 {_format_metric_value(float(item['latest_value']), str(item.get('unit') or ''))}"
        for item in records[:4]
    ]

    if overall_risk == "正常":
        conclusion = (
            "未发现压力或水露点越界异常。压力按对应管线设计压力复核，水露点按 0°C 风险点复核，"
            "当前命中指标均未触发高风险边界。"
        )
    elif dewpoint_risk_items and not pressure_risk_items:
        conclusion = "存在水露点风险信号，压力暂未触发设计压力边界；建议优先复核气质、脱水工况和露点仪状态。"
    elif pressure_risk_items and not dewpoint_risk_items:
        conclusion = "存在压力风险信号，水露点暂未触发 0°C 风险点；建议优先核对上下游压力边界和调压阀状态。"
    else:
        conclusion = "压力和水露点均存在需关注信号，建议按站场风险流程复核上下游边界、气质和现场仪表。"

    return {
        "overall_risk": overall_risk,
        "conclusion": conclusion,
        "current_text": "；".join(current_parts),
        "detail_lines": [describe_item(item) for item in records[:6]],
        "pressure_count": len(pressure_items),
        "dewpoint_count": len(dewpoint_items),
        "pressure_risk_labels": [str(item.get("label") or "压力指标") for item in pressure_risk_items],
        "dewpoint_risk_labels": [str(item.get("label") or "水露点指标") for item in dewpoint_risk_items],
        "pressure_boundary_crossed": pressure_boundary_crossed,
        "dewpoint_boundary_crossed": dewpoint_boundary_crossed,
        "dewpoint_window_crossed": dewpoint_window_crossed,
    }


def _build_actual_metric_debate_lines(
    *,
    metric_trend_digest: dict[str, Any],
    scada_summary: dict[str, Any],
    knowledge_summary: dict[str, Any],
) -> list[str]:
    pressure_labels = [str(item) for item in metric_trend_digest.get("pressure_risk_labels") or [] if str(item).strip()]
    dewpoint_labels = [str(item) for item in metric_trend_digest.get("dewpoint_risk_labels") or [] if str(item).strip()]
    pressure_focus = "、".join(pressure_labels[:3]) if pressure_labels else "未触发中高风险压力项"
    dewpoint_focus = "、".join(dewpoint_labels[:2]) if dewpoint_labels else "未触发中高风险水露点项"
    pressure_crossed = bool(metric_trend_digest.get("pressure_boundary_crossed"))
    dewpoint_crossed = bool(metric_trend_digest.get("dewpoint_boundary_crossed"))
    dewpoint_window_crossed = bool(metric_trend_digest.get("dewpoint_window_crossed"))
    knowledge_hits = int(knowledge_summary.get("hit_count") or 0) if isinstance(knowledge_summary, dict) else 0

    pressure_correction = (
        f"风险复核 Agent 复核后确认：{pressure_focus} 已达到或超过对应管线设计压力边界，压力口径按越界风险表达。"
        if pressure_crossed
        else f"风险复核 Agent 复核后纠正：{pressure_focus} 的风险来自波动/短时变化，不是当前压力越过设计压力。"
    )
    if dewpoint_crossed:
        dewpoint_correction = (
            f"水露点复核结果：{dewpoint_focus} 当前已达到或超过 0°C，按水露点风险点处理。"
        )
    elif dewpoint_window_crossed:
        dewpoint_correction = (
            f"水露点复核结果：{dewpoint_focus} 窗口内曾达到或超过 0°C，需要按曾越界记录复核。"
        )
    else:
        dewpoint_correction = (
            f"水露点复核结果：{dewpoint_focus} 当前和窗口最高值均未达到 0°C，不能说成水露点越界，只能说趋势波动需复核。"
        )

    procedure_line = (
        f"规程处置 Agent 回证：规程知识库命中 {knowledge_hits} 条片段，可引用命中依据约束处置动作。"
        if knowledge_hits > 0
        else "规程处置 Agent 反驳：本轮未命中专站规程片段，所以不能把分析结果写成调度命令。"
    )

    return [
        (
            "1. 主控 Agent 校验历史曲线 Agent：不能只按站名下判断，必须拿本轮 SCADA 证据。"
            f"历史曲线 Agent 回证：已命中 {scada_summary.get('total_count', 0)} 条记录，并现场计算当前值、6h变化、波动幅度和均值。"
        ),
        (
            "2. 历史曲线 Agent 提出风险信号后，风险复核 Agent 按实际边界改口径："
            f"{pressure_correction}{dewpoint_correction}"
        ),
        (
            "3. 拓扑分析 Agent 追问历史曲线 Agent：这些波动是单站仪表跳变，还是上下游工况传导？"
            "因此最终建议要求把上游来气压力、下游出站压力、调压阀开度放到同一时间轴比对。"
        ),
        (
            "4. 规程处置 Agent 校验可执行边界："
            f"{procedure_line}业务表达复核 Agent 接受这个约束，只输出趋势复核单、证据清单和边界说明。"
        ),
        (
            "5. 业务表达复核 Agent 对全体结论收口：最终风险等级采用历史曲线 Agent 的计算结果，"
            "但生产动作必须等拓扑传导、仪表核验和规程依据补齐后再定。"
        ),
    ]


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
    scada_summary = evidence.get("scada_summary") or {}
    knowledge_summary = evidence.get("knowledge_summary") or {}
    simulation_summary_data = evidence.get("simulation_summary") or {}
    system_ids = sorted({
        str(system_id)
        for junction in junctions
        for system_id in (junction.get("system_ids") or [])
        if str(system_id).strip()
    })
    system_text = "、".join(system_ids) if system_ids else "待运行时拓扑补齐"
    has_target_match = bool(junctions or stations)
    has_scada = int(scada_summary.get("total_count") or 0) > 0
    has_knowledge = int(knowledge_summary.get("hit_count") or 0) > 0
    sim_status = str(simulation_summary_data.get("status") or "")
    has_sim = sim_status not in ("", "not_required", "error")
    is_zhongwei_auto_sim = bool(simulation_summary_data.get("auto_demo"))
    metric_trend_digest = _build_subagent_metric_trend_digest(scada_summary)

    compact = re.sub(r"\s+", "", user_message)
    is_metric_trend_query = bool(metric_trend_digest) and any(
        word in compact for word in ("压力", "水露点", "露点", "dewpoint", "趋势", "波动", "温度")
    )
    is_flow_limit = any(word in compact for word in ("限流", "降量", "降输", "下降", "截断"))
    is_cutoff_response = any(word in compact for word in ("截断", "停输", "断供", "关断", "处置"))
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
    three_db_one_model_line = (
        f"三库一模取证：SQL业务库{'已命中' if has_target_match else '未命中目标对象'}；"
        f"SCADA时序库{'已命中 ' + str(scada_summary.get('total_count')) + ' 条历史指标' if has_scada else '未命中足够时序'}；"
        f"规程知识库{'命中 ' + str(knowledge_summary.get('hit_count')) + ' 条片段' if has_knowledge else '未命中专站处置片段'}；"
        f"稳态仿真模型{'已返回 ' + sim_status if has_sim else '未形成可用于生产定级的结果'}。"
    )
    risk_boundary_line = "风险边界口径：压力上边界按对应管线设计压力；水露点达到或超过 0°C 即作为风险点。"

    if has_scada and is_metric_trend_query and metric_trend_digest:
        overall_risk = str(metric_trend_digest.get("overall_risk") or "正常")
        current_text = str(metric_trend_digest.get("current_text") or "已命中压力/水露点历史指标")
        conclusion_text = (
            "【AI 风险诊断报告】\n"
            f"系统检测到{target_text}相关压力和水露点历史数据存在波动信号，"
            f"综合评估风险等级为【{overall_risk}】。\n\n"
            f"后端时序数据显示：{current_text}。\n\n"
            "依据站场风险核查口径，建议立即进入站场风险核查程序，"
            "针对上下游物理边界、进站气质组分以及现场一、二次仪表进行全面闭环复核。"
        )
        business_judgement = (
            "这次不是大模型凭空判断，而是 SubAgent 调 SCADA 历史库后现场计算。"
            "当前值取时间窗口最后一个点，6小时变化取最后点减最早点，波动幅度取最大值减最小值，均值取窗口均值；"
            "风险先看压力设计压力边界和水露点 0°C 风险点，未越界再按波动阈值复核。"
        )
        if is_zhongwei_auto_sim:
            simulation_summary = (
                "- 仿真推演：中卫 3000 万方/天、2000 万方/天、截断三工况已作为仿真 Agent 的人工确认步骤。"
                "仿真用于量化工况调整后的压力、流量和告警变化；风险定级仍需由 SCADA 实时趋势、设计边界和规程依据共同复核。"
            )
            next_action_line = (
                "演示时先对比 3000、2000、截断三组工况的压力、流量和告警差异，再回看近 12-24 小时趋势窗口；"
                "若压力接近设计压力或水露点接近 0°C，再触发调度复核和现场仪表校验。"
            )
        else:
            simulation_summary = "- 仿真推演：本问题以站场历史趋势为主，不需要把稳态仿真结果作为风险定级依据。"
            next_action_line = "继续保留近 12-24 小时趋势窗口，若压力接近设计压力或水露点接近 0°C，再触发调度复核和现场仪表校验。"
    elif has_target_match and is_cutoff_response:
        sim_extra = ""
        if has_sim:
            total_supply = simulation_summary_data.get("total_supply")
            unserved = simulation_summary_data.get("unserved_demand")
            risk_level = simulation_summary_data.get("risk_level") or "未定级"
            sim_extra = (
                f"一模返回基线/演示场景状态 {sim_status}"
                + (f"，总供气 {total_supply:.1f} 万方/天" if isinstance(total_supply, (int, float)) else "")
                + (f"，未满足需求 {unserved:.1f} 万方/天" if isinstance(unserved, (int, float)) else "")
                + f"，模型评价风险标记为 {risk_level}。"
            )
        conclusion_text = (
            f"{target_text}截断处置不能直接给“马上关断/马上恢复”这种硬指令。当前正确口径是：先按站场失效/截断事件进入应急研判，"
            "同步确认上下游压力、流量和阀门状态；若确认需要隔离，再按调度授权执行关断、切换或绕供。"
            f"{sim_extra}"
        )
        business_judgement = (
            f"影响链条先看中卫压气站的出站能力，再看下游路径和关键分输点。{target_text}若发生截断，"
            "风险不是只在站内，重点在下游压力余量、可供流量、替代路径是否可用。"
            "当前系统能做流程级处置建议，但真实执行必须由调度票令、实时SCADA和现场反馈共同确认。"
        )
        simulation_summary = (
            f"- 仿真推演：稳态模型已{'返回 ' + sim_status if has_sim else '进入准备'}；真实截断量、边界压力和下游需求仍需补齐，不能把演示结果当生产定级。"
        )
    elif has_target_match and is_zhongwei_auto_sim and not is_flow_limit and not is_cutoff_response:
        total_supply = simulation_summary_data.get("total_supply")
        unserved = simulation_summary_data.get("unserved_demand")
        run_id = str(simulation_summary_data.get("run_id") or "")
        sim_tail = (
            f"模型已返回 {sim_status}"
            + (f"，run_id={run_id}" if run_id else "")
            + (f"，总供气 {total_supply:.1f} 万方/天" if isinstance(total_supply, (int, float)) else "")
            + (f"，未满足需求 {unserved:.1f} 万方/天" if isinstance(unserved, (int, float)) else "")
            + "。"
            if has_sim
            else "模型已进入演示准备，真实定级仍需补齐边界条件。"
        )
        conclusion_text = (
            "【中卫仿真 SubAgent 接入报告】\n"
            "中卫压气站已挂接“中卫稳态仿真 Agent”，可自动调用 run_steady_sim，并联动全国一张网播放三组演示工况："
            "中卫 3000 万方/天、中卫 2000 万方/天、中卫截断。"
            f"{sim_tail}"
        )
        business_judgement = (
            "这条链路的定位是演示和研判：主控 Agent 识别中卫对象，拓扑 Agent 锁定样板主干，"
            "仿真 Agent 调模型拿返回，风险复核 Agent 再提醒仿真结果必须标注场景，不能直接写成生产调度命令。"
        )
        simulation_summary = (
            "- 仿真推演：中卫稳态仿真 Agent 已接入 run_steady_sim；点击开始后，前端会按中卫 3000、2000、截断三工况播放，并生成中卫-上海白鹤压力/流量曲线。"
        )
        next_action_line = "演示时先看三工况结果差异，再回看 SCADA 和设计边界；若用于生产研判，必须补实时压力、流量、压缩机状态和下游需求。"
    elif has_target_match and is_flow_limit:
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
    if has_scada and is_metric_trend_query and metric_trend_digest:
        suggestion_lines = [
            f"1. 值班员先点“打开历史曲线”，把{target_text}压力曲线与水露点曲线固定在同一 12h 窗口，先看当前值、6小时变化和最大最小波动。",
            "2. 对压力项做两步核对：先按管线台账确认对应设计压力，再把本站压力与上游来气压力、下游出站压力、调压阀开度放到同一时间轴；若上下游同步波动，按工况传导记录，若只有本站单点跳变，转仪表核验。",
            "3. 对水露点单独处理：若当前水露点低于 0°C 风险点，不按越界处置；但若 6h 变化和波动幅度较大，需比对相邻采样点/化验记录，并安排露点仪零点、取样管伴热和过滤器状态复核。",
            f"4. 设置下一轮触发条件：下一 6h 内若压力波动仍达到当前高风险阈值，或水露点继续上行并接近 -5°C，生成“{target_text}趋势复核单”，通知调度、气质和仪表三方确认。",
            "5. 复核单必须带四项证据：当前值、6h 变化、最大-最小波动、风险边界来源；没有设计压力台账或相邻点佐证时，只能写“趋势关注”，不能写成生产调度指令。",
        ]
    elif has_target_match and is_cutoff_response:
        suggestion_lines = [
            "1. 先确认事件性质：是站内故障、计划截断、阀门误关，还是上下游来气变化；没有确认前，不下生产指令。",
            "2. 立刻看 SCADA：中卫出站压力、进出站流量、压缩机状态、关键阀门开度和下游站压力是否同步变化。",
            "3. 用 NetworkX/拓扑先圈影响范围：标出截断前路径、截断点、停流方向和可能绕行路径。",
            "4. 用稳态仿真模型复算边界：输入截断量、压力上下限和下游需求，确认是否出现未满足需求或低压告警。",
            "5. 处置顺序建议：先稳压保供，再压减非关键需求，最后按票令执行隔离/绕供/恢复；安全阈值和阀门动作必须走调度确认。",
        ]
    elif has_target_match and is_zhongwei_auto_sim and not is_flow_limit and not is_cutoff_response:
        suggestion_lines = [
            "1. 演示入口自动触发三组工况：中卫 3000 万方/天作为基准，中卫 2000 万方/天看降量传导，中卫截断看极端边界。",
            "2. 重点看四个输出：总供气、未满足需求、最低进站压力、平均利用率；这些是答辩时最容易讲清楚的指标。",
            "3. 仿真 Agent 的结论只标注为“仿真场景”，再由风险复核 Agent 对照 SCADA、规程和设计压力边界复核后才能进入生产口径。",
        ]
    elif has_target_match and is_flow_limit:
        suggestion_lines = [
            "1. 演示时先采用默认场景：中卫侧供气能力下调至 80%，观察靖边入口压力和下游可供量变化。",
            "2. 重点看三条曲线：中卫出口压力、靖边入口压力、靖边下游分输流量；若三者同步走弱，说明限流影响正在传导。",
            "3. 调度动作建议按“先保压力、再调流量、最后切路径”排序：先稳靖边入口压力，再压减非关键分输需求，必要时启用替代供气路径。",
        ]
    elif has_target_match:
        suggestion_lines = [
            "1. 先读取目标站点近 12-24 小时压力、流量、温度、水露点和压缩机工况数据。",
            "2. 对照上下游拓扑和历史基线，确认异常是单站波动还是沿线传导。",
            "3. 明确仿真边界条件，再让仿真 Agent 输出压降、流量和供气缺口曲线。",
        ]
    else:
        suggestion_lines = [
            "1. 先补齐目标站点或管段的唯一标识，避免站名泛化导致误判。",
            "2. 接入近 12-24 小时压力、流量、温度、水露点和压缩机工况数据。",
            "3. 明确仿真边界条件，再让仿真 Agent 输出压降、流量和供气缺口曲线。",
        ]

    risk_review_summary = (
        f"- 风险复核：已按压力=管线设计压力、水露点=0°C 的边界复核；本轮综合风险为 {metric_trend_digest.get('overall_risk')}。"
        if metric_trend_digest and is_metric_trend_query
        else "- 风险复核：当前只给“重点关注”判断，不给真实风险等级，避免把演示推演说成生产事实。"
    )
    agent_summary = [
        f"- 主控：已识别“{task_type}”任务，并把目标锁定到 {target_text}。",
        f"- 历史曲线：SCADA时序库{'已命中 ' + str(scada_summary.get('total_count')) + ' 条指标记录' if has_scada else '未命中足够指标'}；生产级分析要继续核对压力、流量、温度、水露点和压缩机状态。",
        topology_summary,
        f"- 规程处置：规程知识库{'已命中 ' + str(knowledge_summary.get('hit_count')) + ' 条片段' if has_knowledge else '未命中专站片段'}；没有证据的阈值、步骤和责任主体不硬编。",
        simulation_summary,
        risk_review_summary,
        "- 业务表达复核：已按统一格式收口，避免缺依据、过度自信和把仿真推演说成生产事实。",
    ]
    metric_detail_lines = (
        list(metric_trend_digest.get("detail_lines") or [])
        if metric_trend_digest and is_metric_trend_query
        else []
    )
    if metric_trend_digest and is_metric_trend_query:
        debate_lines = _build_actual_metric_debate_lines(
            metric_trend_digest=metric_trend_digest,
            scada_summary=scada_summary,
            knowledge_summary=knowledge_summary,
        )
    else:
        debate_lines = [
            "1. 主控 Agent 先校验数据来源，要求各专业 Agent 只能基于已命中的业务库、SCADA、规程和仿真证据发言。",
            "2. 风险复核 Agent 对前序结论做保守化处理：缺实时边界、缺规程依据或缺仿真返回时，不允许直接给生产调度指令。",
            "3. 业务表达复核 Agent 最后统一口径：把可确认事实、推演假设和待复核项分开输出。",
        ]
    reply_sections = [
        "结论：",
        conclusion_text,
        "",
        "依据：",
        f"平台已将问题拆成主控编排、历史曲线、拓扑分析、规程处置、仿真推演、风险复核和业务表达复核七步。{evidence_line}{three_db_one_model_line}{risk_boundary_line}",
        *(["", "指标明细：", *metric_detail_lines] if metric_detail_lines else []),
        "",
        "影响：",
        business_judgement,
        "",
        "Agent证据互证链（编排校验）：",
        *debate_lines,
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
            (
                "中卫三工况仿真由仿真 Agent 准备，点击开始后会依次播放 3000 万方/天、2000 万方/天、截断三组工况；最终结论应在三组仿真完成后再展示。"
                if is_zhongwei_auto_sim
                else "历史曲线入口已在历史曲线 Agent 后生成，评审时可直接点击按钮打开；这里不重复输出动作标记。"
            ),
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
    if str(evidence.get("task_type") or "") == "截断处置推演":
        return _fallback_subagent_brief(agent_title, evidence)

    messages = [
        {
            "role": "system",
            "content": (
                f"你是 SmartGas Grid 的{agent_title}。"
                "你只输出可展示给用户看的工作结论，不输出隐藏推理。"
                "必须基于给定证据说话；没有数据就明确说缺什么。"
                "用中文，1-2 句，先结论后依据。不要输出 Markdown 标题、表格或项目符号。"
                "这是评审演示模式：可以说流程已触发，但不能把缺数据的演示推演说成真实生产结论。"
                "风险边界必须统一：压力边界为对应管线设计压力，水露点风险点为 0°C。"
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


def _build_subagent_collaboration_payload(
    *,
    agent: dict[str, Any],
    evidence: dict[str, Any],
    prior_results: list[dict[str, str]],
    summary: str,
) -> dict[str, Any]:
    agent_id = str(agent.get("id") or "")
    targets = "、".join(str(item) for item in evidence.get("targets", [])) or "目标站点"
    scada_summary = evidence.get("scada_summary") or {}
    knowledge_summary = evidence.get("knowledge_summary") or {}
    simulation_summary = evidence.get("simulation_summary") or {}
    has_scada = int(scada_summary.get("total_count") or 0) > 0
    has_knowledge = int(knowledge_summary.get("hit_count") or 0) > 0
    sim_status = str(simulation_summary.get("status") or "not_required")
    sim_auto_demo = bool(simulation_summary.get("auto_demo"))
    sim_run_id = str(simulation_summary.get("run_id") or "")
    prior_title = prior_results[-1]["agent"] if prior_results else "主控输入"

    payload_map: dict[str, dict[str, Any]] = {
        "controller": {
            "claims": [
                f"任务已拆成历史曲线、拓扑、规程、仿真、风险复核和业务表达，目标={targets}。",
                "共享证据板已创建，后续 Agent 只能在证据板上补充或纠正。",
                "工作输出：生成 Agent 执行清单，明确哪些库、哪些模型、哪些边界需要参与。",
            ],
            "reviews": [],
            "corrections": [],
        },
        "history": {
            "claims": [
                f"SCADA 时序库{'命中 ' + str(scada_summary.get('total_count')) + ' 条压力/温度/水露点记录' if has_scada else '未命中足够历史指标'}。",
                "历史判断只负责说明趋势和计算结果，不直接下生产处置指令。",
                "工作输出：调出目标站历史曲线，计算当前值、6小时变化、波动幅度和均值。",
            ],
            "reviews": [
                {
                    "from_agent": "历史曲线 Agent",
                    "to_agent": prior_title,
                    "result": "补证",
                    "message": "已把 SCADA 命中情况补到共享证据板，供风险边界和复核 Agent 使用。",
                }
            ],
            "corrections": [] if has_scada else [
                {
                    "target": "风险定级",
                    "before": "按默认趋势直接定级",
                    "after": "历史指标不足，只能提示需补数据，不能给真实风险等级",
                    "status": "已采纳",
                }
            ],
        },
        "topology": {
            "claims": [
                f"拓扑匹配结果：枢纽 {len(evidence.get('junctions', []))} 个，站点 {len(evidence.get('stations', []))} 个。",
                "影响范围必须由运行时拓扑确认，不能只按站名泛化判断。",
                "工作输出：确认目标站上下游关系，约束仿真影响范围和截断方向。",
            ],
            "reviews": [
                {
                    "from_agent": "拓扑分析 Agent",
                    "to_agent": "历史曲线 Agent",
                    "result": "约束",
                    "message": "历史曲线只能证明目标站趋势，影响范围还要看上下游拓扑。",
                }
            ],
            "corrections": [],
        },
        "procedure": {
            "claims": [
                f"规程知识库{'命中 ' + str(knowledge_summary.get('hit_count')) + ' 条片段' if has_knowledge else '未命中专站处置片段'}。",
                "没有规程证据的阈值、步骤、责任主体不补、不猜。",
                "工作输出：给出规程证据边界，防止把 AI 建议说成调度指令。",
            ],
            "reviews": [
                {
                    "from_agent": "规程处置 Agent",
                    "to_agent": "拓扑分析 Agent",
                    "result": "复核",
                    "message": "处置动作必须落到规程或调度票令，拓扑影响不能直接等同操作步骤。",
                }
            ],
            "corrections": [] if has_knowledge else [
                {
                    "target": "处置建议",
                    "before": "给出专站操作票式动作",
                    "after": "改为通用应急研判建议，并标注需调度确认",
                    "status": "已采纳",
                }
            ],
        },
        "simulation": {
            "claims": [
                f"稳态仿真工具 run_steady_sim 状态={sim_status}" + (f"，run_id={sim_run_id}" if sim_run_id else "") + "。",
                (
                    "中卫三工况自动演示已挂接：3000 万方/天、2000 万方/天、截断三组会依次落到全国一张网。"
                    if sim_auto_demo
                    else "仿真结果只在边界条件明确时用于计算压降、流量和供气缺口。"
                ),
                "工作输出：把业务问题转成工况对比，输出压力、流量、告警变化的复核依据。",
            ],
            "reviews": [
                {
                    "from_agent": "仿真推演 Agent",
                    "to_agent": "规程处置 Agent",
                    "result": "边界确认",
                    "message": "仿真能给趋势和量化结果，但不能替代规程授权和现场确认。",
                }
            ],
            "corrections": [
                {
                    "target": "仿真口径",
                    "before": "把演示推演说成真实未来",
                    "after": "统一改为演示场景/待复核结果，真实生产需补边界条件",
                    "status": "已采纳",
                }
            ] if sim_status in {"not_required", "error"} else [],
        },
        "review": {
            "claims": [
                "风险边界统一：压力按对应管线设计压力，水露点风险点为 0°C。",
                "缺少实时边界、设计压力或规程依据时，风险等级必须保守表达。",
                "工作输出：检查 SCADA、拓扑、规程、仿真之间是否相互支撑，标出不能下结论的部分。",
            ],
            "reviews": [
                {
                    "from_agent": "风险复核 Agent",
                    "to_agent": "全部前序 Agent",
                    "result": "纠偏",
                    "message": "把“异常/高风险”等绝对表述统一改成有边界、有证据的风险提示。",
                }
            ],
            "corrections": [
                {
                    "target": "风险等级",
                    "before": "仅凭波动或演示推演定真实风险",
                    "after": "先查设计压力和 0°C 露点边界，未越界再按波动规则复核",
                    "status": "已采纳",
                }
            ],
        },
        "business_expression": {
            "claims": [
                "最终答复只采用共享证据板中已复核的结论。",
                "输出顺序固定为结论、依据、影响、建议、待复核项、边界说明。",
                "工作输出：把专业 Agent 的计算结果整理成评审能看懂的业务判断。",
            ],
            "reviews": [
                {
                    "from_agent": "业务表达复核 Agent",
                    "to_agent": "风险复核 Agent",
                    "result": "采纳",
                    "message": "已采纳风险边界和缺数据提示，避免把 AI 分析说成调度指令。",
                }
            ],
            "corrections": [
                {
                    "target": "表达口径",
                    "before": "过程太长、结论靠后",
                    "after": "先给结论，再展示过程和证据，详细项折叠为待复核说明",
                    "status": "已采纳",
                }
            ],
        },
    }

    payload = payload_map.get(agent_id, {"claims": [summary], "reviews": [], "corrections": []})
    payload["shared_board"] = [
        f"目标：{targets}",
        f"SCADA：{'已命中 ' + str(scada_summary.get('total_count')) + ' 条' if has_scada else '未命中足够时序'}",
        "风险边界：压力=管线设计压力；水露点=0°C",
        f"规程：{'命中 ' + str(knowledge_summary.get('hit_count')) + ' 条' if has_knowledge else '待补充专站依据'}",
        f"仿真：{'已接入中卫自动演示' if sim_auto_demo else sim_status}",
    ]
    return payload


async def _subagent_showcase_event_generator(request: ChatRequest, session: Session):
    """
    在 AI 窗口内演绎 SubAgent 协作过程。
    这里展示的是可审计工作轨迹：任务、工具动作、证据和结论，不暴露模型隐藏推理。
    """
    user_message = request.message.strip()
    evidence = _collect_subagent_evidence(user_message, session)
    task_type = evidence.get("task_type", "综合风险分析")
    targets = evidence.get("targets", [])
    simulation_summary = evidence.get("simulation_summary") or {}
    zhongwei_auto_sim = bool(simulation_summary.get("auto_demo"))
    compact_message = re.sub(r"\s+", "", user_message)

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
            "id": "procedure",
            "title": "规程处置 Agent",
            "icon": "rule",
            "tool": "规程知识库/RAG 检索",
            "instruction": "检索截断、站场失效和应急处置相关规程依据，说明哪些处置动作只能作为建议，哪些必须由调度票令确认。",
            "steps": ["检索规程知识库", "提取站场失效/截断处置依据", "标注禁止硬编的阈值和步骤"],
        },
        {
            "id": "simulation",
            "title": "中卫稳态仿真 Agent" if zhongwei_auto_sim else "仿真推演 Agent",
            "icon": "science",
            "tool": "MCP稳态仿真 run_steady_sim" if zhongwei_auto_sim else "稳态仿真场景选择",
            "instruction": (
                "说明中卫稳态仿真已接入 run_steady_sim，并准备触发全国一张网三工况自动演示；必须标注这是演示/仿真结果，不替代生产调度。"
                if zhongwei_auto_sim
                else "按评审演示口径说明已进入自动仿真演示流程，同时说明真实计算需要哪些输入、输出和不能编造的边界。"
            ),
            "steps": (
                ["绑定中卫边界", "调用 run_steady_sim", "触发三工况自动演示"]
                if zhongwei_auto_sim
                else ["识别仿真场景", "准备边界条件", "等待稳态模型返回压降/流量结果"]
            ),
            "action": "自动演示：中卫3000/2000/截断三工况" if zhongwei_auto_sim else "自动开启仿真演示",
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
        running_message = f"{agent['title']}启动，正在处理{agent['tool']}。"
        yield f"[REPLY] {json.dumps(_build_subagent_step_action_reply(step=agent['id'], status='running', title=agent['title'], message=running_message), ensure_ascii=False)}\n"
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

        await asyncio.sleep(0.65)
        summary = await _call_subagent_brief(
            agent_title=agent["title"],
            user_message=user_message,
            evidence=evidence,
            instruction=agent["instruction"],
            prior_results=results,
        )
        results.append({"agent": agent["title"], "summary": summary})
        collaboration_payload = _build_subagent_collaboration_payload(
            agent=agent,
            evidence=evidence,
            prior_results=results[:-1],
            summary=summary,
        )
        extra_evidence: list[str] = []
        if agent["id"] == "controller":
            sql_summary = evidence.get("sql_summary") or {}
            extra_evidence.append(
                f"SQL业务库：枢纽 {sql_summary.get('junction_count', 0)} 个，站点 {sql_summary.get('station_count', 0)} 个，管线 {sql_summary.get('pipeline_count', 0)} 条"
            )
        elif agent["id"] == "history":
            scada_summary = evidence.get("scada_summary") or {}
            extra_evidence.append(
                f"SCADA时序库：{'已连接' if scada_summary.get('connected') else '未连接'}，命中 {scada_summary.get('total_count', 0)} 条指标记录"
            )
        elif agent["id"] == "topology":
            extra_evidence.append("NetworkX拓扑：由业务库构建有向拓扑，用于判断上下游与影响范围")
        elif agent["id"] == "procedure":
            knowledge_summary = evidence.get("knowledge_summary") or {}
            extra_evidence.append(
                f"规程知识库：{'已连接' if knowledge_summary.get('connected') else '未连接'}，命中 {knowledge_summary.get('hit_count', 0)} 条片段"
            )
        elif agent["id"] == "simulation":
            sim_summary = evidence.get("simulation_summary") or {}
            extra_evidence.append(
                f"稳态仿真模型：{sim_summary.get('tool', 'run_steady_sim')}，状态 {sim_summary.get('status', '未知')}"
            )
            if sim_summary.get("run_id"):
                extra_evidence.append(f"仿真快照：run_id={sim_summary.get('run_id')}")
            if sim_summary.get("auto_demo"):
                extra_evidence.append("前端演示：已准备启动中卫 3000/2000/截断三工况")

        completed_status = "warning" if "暂时不可用" in summary else "completed"
        step_message = summary
        if agent["id"] == "simulation" and zhongwei_auto_sim:
            completed_status = "running"
            step_message = "仿真 Agent 已完成边界准备，等待人工点击开始三工况仿真。"
        yield f"[REPLY] {json.dumps(_build_subagent_step_action_reply(step=agent['id'], status=completed_status, title=agent['title'], message=step_message), ensure_ascii=False)}\n"
        async for event in _yield_subagent_event({
            "agent": agent["id"],
            "title": agent["title"],
            "icon": agent["icon"],
            "status": completed_status,
            "tool": agent["tool"],
            "message": step_message,
            "steps": agent["steps"],
            "evidence": [
                f"目标：{'、'.join(str(item) for item in targets)}",
                f"枢纽命中：{len(evidence.get('junctions', []))} 个",
                f"站点命中：{len(evidence.get('stations', []))} 个",
                *extra_evidence,
            ],
            "claims": collaboration_payload.get("claims", []),
            "reviews": collaboration_payload.get("reviews", []),
            "corrections": collaboration_payload.get("corrections", []),
            "shared_board": collaboration_payload.get("shared_board", []),
            "action": agent.get("action"),
        }):
            yield event

        if agent["id"] == "history" and targets:
            history_metric = (
                "overview"
                if ("压力" in compact_message and ("水露点" in compact_message or "露点" in compact_message))
                else "pressure"
            )
            history_action_reply = _build_history_curve_action_reply(str(targets[0]), history_metric)
            yield f"[REPLY] {json.dumps(chr(10) + chr(10) + history_action_reply, ensure_ascii=False)}\n"
        elif agent["id"] == "topology" and targets:
            locate_action_reply = _build_locate_station_action_reply(str(targets[0]))
            yield f"[REPLY] {json.dumps(chr(10) + chr(10) + locate_action_reply, ensure_ascii=False)}\n"
        elif agent["id"] == "simulation" and zhongwei_auto_sim:
            simulation_action_reply = _build_zhongwei_multi_scenario_action_reply()
            yield f"[REPLY] {json.dumps(chr(10) + chr(10) + simulation_action_reply, ensure_ascii=False)}\n"

        await asyncio.sleep(0.35)

    scada_summary = evidence.get("scada_summary") or {}
    knowledge_summary = evidence.get("knowledge_summary") or {}
    sim_summary = evidence.get("simulation_summary") or {}
    metric_digest = _build_subagent_metric_trend_digest(scada_summary)
    main_claims = [
        f"历史曲线 Agent：已查 SCADA，命中 {scada_summary.get('total_count', 0)} 条记录，并调出目标站曲线。",
        f"拓扑分析 Agent：已确认枢纽 {len(evidence.get('junctions', []))} 个、站点 {len(evidence.get('stations', []))} 个，用于约束影响范围。",
        f"规程处置 Agent：规程知识库命中 {knowledge_summary.get('hit_count', 0)} 条片段，用于约束处置边界。",
        (
            "仿真推演 Agent：已准备中卫 3000/2000/截断三工况，等待人工点击后运行。"
            if sim_summary.get("auto_demo")
            else f"仿真推演 Agent：模型状态 {sim_summary.get('status', '未触发')}，需补边界后用于量化。"
        ),
        (
            f"风险复核 Agent：综合风险按历史趋势计算为 {metric_digest.get('overall_risk')}，但不替代调度指令。"
            if metric_digest
            else "风险复核 Agent：当前证据不足以给生产风险等级，只能作为关注提示。"
        ),
    ]
    yield f"[REPLY] {json.dumps(_build_subagent_step_action_reply(step='main_summary', status='running', title='主 Agent 汇总', message='正在收口各 SubAgent 的曲线、拓扑、规程和仿真结果。'), ensure_ascii=False)}\n"
    async for event in _yield_subagent_event({
        "agent": "main_summary",
        "title": "主 Agent 汇总",
        "icon": "summarize",
        "status": "completed",
        "tool": "证据汇总与最终判断",
        "message": "主 Agent 已完成收口：各 SubAgent 的证据已经汇总到同一张证据板，下面输出最终判断。",
        "steps": ["收集各 Agent 证据", "检查冲突和缺口", "形成最终汇总"],
        "evidence": [
            f"目标：{'、'.join(str(item) for item in targets) if targets else '当前关注站点'}",
            f"SCADA记录：{scada_summary.get('total_count', 0)} 条",
            f"规程命中：{knowledge_summary.get('hit_count', 0)} 条",
            f"仿真状态：{sim_summary.get('status', '未触发')}",
        ],
        "claims": main_claims,
        "reviews": [
            {
                "from_agent": "主 Agent",
                "to_agent": "全部 SubAgent",
                "result": "汇总",
                "message": "只采用已命中的数据、已触发的仿真和已复核的边界，不新增无依据结论。",
            }
        ],
        "corrections": [
            {
                "target": "最终口径",
                "before": "各 Agent 分散输出，评审不容易看出协同",
                "after": "由主 Agent 按证据链统一汇总，明确每个 Agent 的工作贡献",
                "status": "已采纳",
            }
        ],
        "shared_board": [
            f"目标：{'、'.join(str(item) for item in targets) if targets else '当前关注站点'}",
            f"SCADA：{'已命中 ' + str(scada_summary.get('total_count')) + ' 条' if scada_summary.get('total_count') else '未命中足够时序'}",
            "拓扑：已参与影响范围约束",
            f"规程：{'命中 ' + str(knowledge_summary.get('hit_count')) + ' 条' if knowledge_summary.get('hit_count') else '待补充专站依据'}",
            f"仿真：{'中卫三工况等待点击运行' if sim_summary.get('auto_demo') else sim_summary.get('status', '未触发')}",
        ],
        "action": "主 Agent 汇总",
    }):
        yield event
    yield f"[REPLY] {json.dumps(_build_subagent_step_action_reply(step='main_summary', status='completed', title='主 Agent 汇总', message='主 Agent 已完成汇总，最终结论按证据链输出。'), ensure_ascii=False)}\n"

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
    payload = _extract_json_payload_from_tool_result(tool_result)
    if payload:
        hit_summary = payload.get("hit_summary") or {}
        missed_sources = payload.get("missed_sources") or []
        yield f"[THINK] {json.dumps(_format_universal_search_process_note(hit_summary, missed_sources), ensure_ascii=False)}\n"

        structured_sources = (
            "raw_excel_stations",
            "raw_excel_pipelines",
            "raw_excel_users",
            "smartgas_stations",
            "smartgas_pipelines",
            "pipeline_systems",
            "scada_history",
        )
        structured_hits = sum(int(hit_summary.get(source) or 0) for source in structured_sources)
        total_hits = int(payload.get("total_hits") or 0)
        knowledge_hits = int(hit_summary.get("knowledge_base") or 0)
        if structured_hits == 0:
            reply_text = _format_no_search_hit_reply(
                message=message,
                total_hits=total_hits,
                knowledge_hits=knowledge_hits,
            )
            yield f"[LOG] {', '.join(str(source) for source in missed_sources[:8])}\n"
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"
            yield "[DONE]\n"
            return

    prompt = (
        "用户的问题先被 raw_excel 快速索引判定为未命中，所以系统改用全域检索。"
        "下面是全域检索结果，请用中文人话回答用户。"
        "要求：先说结论；只展开命中的关键业务信息；未命中来源不要在最终回答里逐项展开，"
        "只用一句话说明“详细检索过程已放在 AI 处理过程”。不要输出原始 JSON。\n\n"
        f"用户原话：{message}\n\n"
        f"{tool_result}"
    )
    try:
        async for chunk in ai_client.chat_stream(prompt=prompt, temperature=0.45, max_tokens=1200):
            yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
    except Exception as exc:
        logger.warning("Universal search AI summary failed: %s", exc)
        yield f"[REPLY] {json.dumps(tool_result, ensure_ascii=False)}\n"


def _format_universal_search_process_note(hit_summary: dict[str, Any], missed_sources: list[Any]) -> str:
    source_labels = {
        "raw_excel_stations": "raw_excel 站场索引",
        "raw_excel_pipelines": "raw_excel 管线索引",
        "raw_excel_users": "raw_excel 用户/分输口索引",
        "smartgas_stations": "SQL stations",
        "smartgas_pipelines": "SQL pipelines",
        "pipeline_systems": "SQL pipeline_systems",
        "scada_history": "SCADA history",
        "knowledge_base": "规程/预案知识库",
    }
    hit_parts = [
        f"{source_labels.get(str(source), str(source))}={count}"
        for source, count in hit_summary.items()
        if int(count or 0) > 0
    ]
    missed_parts = [
        source_labels.get(str(source), str(source))
        for source in missed_sources[:8]
    ]
    lines = [
        "全域检索：已连接业务 SQL 库、raw_excel_index、SCADA 历史库、知识库。",
        f"命中摘要：{'、'.join(hit_parts) if hit_parts else '业务数据 0 命中'}。",
    ]
    if missed_parts:
        lines.append(f"未命中来源：{'、'.join(missed_parts)}。")
    return "\n".join(lines)


def _format_no_search_hit_reply(*, message: str, total_hits: int, knowledge_hits: int) -> str:
    suffix = ""
    if knowledge_hits and total_hits == knowledge_hits:
        suffix = "知识库可能有零散相近片段，但没有命中可确认的站场、管线、用户或时序对象。"
    else:
        suffix = "当前业务数据源没有命中可确认对象。"

    reply = "\n".join([
        "结论：",
        f"没找到“{message}”对应的可靠业务记录。",
        "",
        "说明：",
        f"{suffix}详细检索过程我放在上面的 AI 处理过程里，不在结果区刷一大串未命中清单。",
        "",
        "建议：",
        "换完整站名、管线名或常用简称再搜；比如带上“压气站/分输站/联络站/干线名称”。",
    ])
    return _append_completeness_hint(
        reply,
        message,
        is_complete=True,
        reason="已完成全域检索；结果区只保留短结论，未命中细节已折叠到 AI 处理过程。",
    )


async def _topology_relation_event_generator(
    message: str,
    station_pair: tuple[str, str | None],
    session: Session,
):
    station_ref, target_ref = station_pair
    yield "[TOOL] query_topology_relation\n"
    tool_result = execute_tool(
        "query_topology_relation",
        {
            "station_ref": station_ref,
            "target_ref": target_ref or "",
            "scope": "we1",
            "depth": 20,
        },
        session,
    )
    payload = _extract_json_payload_from_tool_result(tool_result)
    path = payload.get("path") or {}
    think_lines = [
        f"拓扑工具：query_topology_relation",
        f"查询对象：{station_ref}" + (f" → {target_ref}" if target_ref else ""),
        "范围：WE1 拓扑关系库",
    ]
    if path.get("edge_ids"):
        think_lines.append(f"路径证据：{len(path.get('edge_ids') or [])} 段，{path.get('total_length_km')} km")
    if payload.get("basis"):
        think_lines.append(f"数据依据：{payload.get('basis')}")
    yield f"[THINK] {json.dumps(chr(10).join(think_lines), ensure_ascii=False)}\n"
    reply_text = _format_topology_relation_reply(message, tool_result)
    yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"
    yield "[DONE]\n"


async def _rag_search_event_generator(message: str, session: Session):
    normalized_message = str(message or "").replace("棺材", "管材").strip()
    yield "[TOOL] search_knowledge_base\n"
    tool_result = execute_tool(
        "search_knowledge_base",
        {"query": normalized_message or message, "limit": 10},
        session,
    )

    no_hit = "未检索到足够相关" in tool_result or "执行出错" in tool_result
    if no_hit:
        reply_text = "\n".join([
            "结论：RAG 库没有检索到足够相关的片段。",
            "",
            f"搜索问题：{normalized_message or message}",
            "",
            "建议：",
            "- 换成文件里更可能出现的关键词，比如管线全称、站场全称、作业名称。",
            "- 如果你要查的是具体数值，优先带上“附录、保护定值、设定值、表B”等词。",
            "- 如果仍然没有命中，大概率是该资料还没有入库或 OCR/解析质量不够。",
        ])
        reply_text = _append_completeness_hint(
            reply_text,
            message,
            is_complete=False,
            reason="RAG 库未命中足够相关片段。",
        )
        yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
        yield "[DONE]\n"
        return

    raw_result = re.sub(
        r"\n【回答要求】.*$",
        "",
        tool_result,
        flags=re.S,
    ).strip()
    raw_result = raw_result.replace(
        "知识库命中结果（供 AI 归纳，必须基于以下证据回答）：",
        "RAG 库命中结果：",
    )
    reply_text = "\n".join([
        "结论：以下是 RAG 库按你的问题直接检索到的原始命中片段。",
        "",
        raw_result,
        "",
        "说明：这里不做业务归纳，只展示 RAG 命中文档、chunk 和摘要；如果命中不对，就说明需要换关键词或补充入库资料。",
    ])
    reply_text = _append_completeness_hint(
        reply_text,
        message,
        is_complete=True,
        reason="已完成 RAG 库直接检索并返回命中文档片段。",
    )
    yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
    yield "[DONE]\n"


def _format_pipeline_material_reply_from_rag(message: str, raw_result: str) -> str:
    blocks = re.findall(
        r"\d+\.\s*来源：(?P<type>[^/\n]+)\s*/\s*(?P<source>[^/\n]+)\s*/\s*chunk\s*#(?P<chunk>[^\s，,]+).*?摘要：(?P<excerpt>.*?)(?=\n\d+\.\s*来源：|\Z)",
        raw_result,
        flags=re.S,
    )
    rows: list[tuple[str, str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    known_pipeline_terms = (
        "西气东输一线",
        "西一线",
        "西气东输二线",
        "西二线",
        "西气东输三线",
        "西三线",
        "中俄东线",
        "中俄",
        "中贵线",
        "陕京",
        "涩宁兰",
        "忠武",
        "泰青威",
        "川气东送",
        "冀宁",
        "中缅",
        "榆济",
        "兰银",
        "广南",
        "广深",
        "长宁",
        "古河",
    )
    target_terms = tuple(term for term in known_pipeline_terms if term in message)

    def classify_scope(name: str, explicit_scope: str) -> str:
        text = f"{name}{explicit_scope}"
        if "联络线" in text or "互联互通" in text:
            return "联络线"
        if "支线" in text:
            return "支线"
        if any(term in text for term in ("干线", "复线", "一线", "二线", "三线")):
            return "干线"
        if "管道" in text:
            return "支线"
        return "未分类"

    for _hit_type, source, chunk, excerpt in blocks:
        source_ref = f"{source.strip()} / chunk #{chunk.strip()}"
        text = re.sub(r"\s+", "", excerpt)
        material_section = text
        if "管材" in text:
            material_start = text.find("管材")
            material_section = text[max(0, material_start - 24) :]
        material_section = re.split(r"A\.?3|附录A\.3|管道沿线站场阀室|线路信息", material_section, maxsplit=1)[0]
        sentences = [item for item in re.split(r"[；;。]", material_section) if item]
        for sentence in sentences:
            sentence = sentence.lstrip("管材：:")
            if not any(term in sentence for term in ("使用", "采用", "为")):
                continue
            if not any(term in sentence for term in ("管材", "材质", "钢级", "钢管", "L", "X")):
                continue
            matches = re.finditer(
                r"(?P<name>[\u4e00-\u9fa5A-Za-z0-9\-（）()·]+?)(?P<scope>干线|支线|联络线|复线|一线|二线|三线)?(?:管道)?(?:全线)?(?:管材|材质|钢级)?(?:使用|采用|为)(?P<material>[A-Za-z0-9（）()/]+(?:PSL2)?(?:直缝埋弧焊管|螺旋焊缝管)?)",
                sentence,
            )
            for match in matches:
                name = match.group("name").strip("，,、：:")
                scope = match.group("scope") or ""
                material = match.group("material").strip("，,、：:")
                if not name or not material:
                    continue
                if not re.search(r"(?:[LX]\d|X\d)", material, flags=re.IGNORECASE):
                    continue
                name = re.sub(r"^(?:A\.?2)?(?:管材)+", "", name)
                if len(name) > 24:
                    name = re.sub(r"^.*?(?=[\u4e00-\u9fa5A-Za-z0-9\-（）()·]{2,}(?:干线|支线|联络线|复线|一线|二线|三线))", "", name)
                display_name = f"{name}{scope}" if scope and not name.endswith(scope) else name
                display_name = display_name.replace("管道干线", "").replace("管材", "")
                display_name = re.sub(r"^(?:A\.?)?\d+", "", display_name)
                display_name = display_name.replace("管道基本技术参数", "")
                if target_terms:
                    other_terms = [term for term in known_pipeline_terms if term not in target_terms and term in display_name]
                    if other_terms:
                        continue
                row_scope = classify_scope(display_name, scope)
                key = (row_scope, display_name, material)
                if key in seen:
                    continue
                seen.add(key)
                rows.append((row_scope, display_name, material, source_ref))

        table_patterns = [
            rf"(?P<num>\d{{1,2}})(?P<name>[\u4e00-\u9fa5A-Za-z0-9\-（）()·]+?(?:干线|支线|复线|管道|联络线))(?P<material>{MATERIAL_TOKEN_PATTERN}(?:及{MATERIAL_TOKEN_PATTERN})?)",
            rf"\|(?P<num>\d{{1,2}})\|(?P<name>[^|]+)\|(?P<material>{MATERIAL_TOKEN_PATTERN}(?:及{MATERIAL_TOKEN_PATTERN})?)\|",
        ]
        for pattern in table_patterns:
            for match in re.finditer(pattern, material_section, flags=re.IGNORECASE):
                name = re.sub(r"^(?:名称|管材|序号)+", "", match.group("name")).strip("，,、：:|")
                material = match.group("material").strip("，,、：:|")
                if "管材" in name:
                    name = re.sub(r"^.*?管材\d*", "", name)
                name = re.sub(r"^.*?（续）\d*", "", name)
                name = re.sub(r"^\d+", "", name)
                if "西气东输干线" in name:
                    name = name[name.rfind("西气东输干线") :]
                name = name.strip("，,、：:|")
                if not name or not material:
                    continue
                if name in {"管道", "名称"} or any(skip in name for skip in ("长度", "管径", "设计输量", "站场", "阀室")):
                    continue
                row_scope = classify_scope(name, "")
                key = (row_scope, name, material)
                if key in seen:
                    continue
                seen.add(key)
                rows.append((row_scope, name, material, source_ref))

    if not rows:
        return ""

    has_branch = any(row[0] == "支线" for row in rows)
    table = [
        "| 范围 | 管段/支线 | 管材/钢级 | 来源 |",
        "| --- | --- | --- | --- |",
    ]
    for scope, name, material, source_ref in rows:
        table.append(f"| {scope} | {name} | {material} | {source_ref} |")
    if "支线" in message and not has_branch:
        table.append("| 支线 | 未命中 | 未命中 | - |")

    return "\n".join([
        "结论：RAG 命中片段中能确认的干线、支线管材如下。",
        "",
        *table,
        "",
        "说明：表里只列 RAG 命中片段明确出现的管材/钢级；没有出现的支线不补、不猜。",
    ])


def _station_material_anchor(message: str) -> str:
    text = str(message or "").replace("棺材", "管材")
    text = re.sub(r"[？?。！，,\s]+", "", text)
    text = re.sub(
        r"(用|用了|采用|使用|属于|连接|连通|涉及|经过|哪几条|哪些|什么|几条|的|本身|具体|站内|站场|枢纽站|枢纽|联络站|分输站|压气站|清管站|站|管材|材质|钢级|钢管|材料|分别|多少|是|有)+",
        "",
        text,
    )
    return text.strip()


def _station_material_candidate_matches(anchor: str, station: dict[str, Any]) -> bool:
    if not anchor:
        return True
    names = [station.get("name") or "", *(station.get("aliases") or [])]
    normalized_anchor = re.sub(r"\s+", "", anchor)
    return any(normalized_anchor and normalized_anchor in re.sub(r"\s+", "", str(name or "")) for name in names)


def _collect_station_connected_pipelines(message: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_excel_ai_index.ensure_loaded()
    anchor = _station_material_anchor(message)
    candidates = raw_excel_ai_index.find_station_candidates(anchor or message, limit=16)
    station_candidates = [
        item for item in candidates
        if _station_material_candidate_matches(anchor, item)
    ] or candidates[:3]

    pipelines_by_key: dict[str, dict[str, Any]] = {}

    def add_pipeline(name: str, *, trunk_name: str = "", station_name: str = "", relation: str = "") -> None:
        clean_name = str(name or "").strip()
        if not clean_name:
            return
        key = re.sub(r"\s+", "", clean_name)
        if not key:
            return
        existing = pipelines_by_key.get(key, {})
        pipelines_by_key[key] = {
            **existing,
            "name": clean_name,
            "trunk_name": trunk_name or existing.get("trunk_name") or "",
            "station_name": station_name or existing.get("station_name") or "",
            "relation": relation or existing.get("relation") or "",
        }

    for station in station_candidates:
        station_name = str(station.get("name") or "")
        for branch in station.get("branches") or []:
            add_pipeline(branch, trunk_name=", ".join(station.get("systems") or []), station_name=station_name, relation="站场关联支线/管段")
        for system in station.get("systems") or []:
            if not station.get("branches"):
                add_pipeline(system, trunk_name=system, station_name=station_name, relation="站场所属干线")
        for lookup in [station_name, *(station.get("aliases") or [])]:
            for pipeline in raw_excel_ai_index.query_pipelines(keyword=lookup)[:12]:
                add_pipeline(
                    str(pipeline.get("name") or ""),
                    trunk_name=str(pipeline.get("trunk_name") or pipeline.get("scope_name") or ""),
                    station_name=station_name,
                    relation=f"{pipeline.get('start_station') or '未知'} -> {pipeline.get('end_station') or '未知'}",
                )

    return station_candidates, list(pipelines_by_key.values())


MATERIAL_TOKEN_PATTERN = r"(?:(?:L(?:245|290|360|415|450|457|485|555)M?)|(?:X(?:42|52|56|60|64|65|70|80)))(?:（X(?:42|52|56|60|64|65|70|80)）|\(X(?:42|52|56|60|64|65|70|80)\))?(?:/[LΧX]\d{2,3}M?)*(?:\s*PSL2)?(?:直缝埋弧焊管|螺旋焊缝管|管材)?"


def _extract_first_rag_source(raw_result: str) -> str:
    match = re.search(r"来源：[^/]+/\s*(?P<source>[^/\n]+)\s*/\s*chunk\s*#(?P<chunk>[^\s，,]+)", raw_result)
    if not match:
        return "-"
    return f"{match.group('source').strip()} / chunk #{match.group('chunk').strip()}"


def _material_query_variants_for_connected_pipeline(pipeline: dict[str, Any]) -> list[str]:
    name = str(pipeline.get("name") or "").strip()
    trunk = str(pipeline.get("trunk_name") or "").strip()
    variants = []
    if trunk and name:
        variants.append(f"{trunk} {name} 管材")
    if name:
        variants.append(f"{name} 管材")
    if "甪宝支线" in name:
        variants.append("西气东输一线 甪宝支线 管材")
    if "西一线干线" in name or "西气东输一线" in trunk:
        variants.append("西气东输一线 西气东输干线 管材")
    if "中俄东线" in name or "中俄东线" in trunk:
        variants.append("中俄东线干线 管材")
    if "西二" in name or "西气东输二线" in trunk:
        variants.append("西气东输二线 支干线 管材")
    return list(dict.fromkeys(item for item in variants if item.strip()))


def _extract_material_for_connected_pipeline(pipeline: dict[str, Any], raw_result: str) -> tuple[str, str]:
    name = str(pipeline.get("name") or "").strip()
    trunk = str(pipeline.get("trunk_name") or "").strip()
    blocks = re.findall(
        r"\d+\.\s*来源：(?P<type>[^/\n]+)\s*/\s*(?P<source>[^/\n]+)\s*/\s*chunk\s*#(?P<chunk>[^\s，,]+).*?摘要：(?P<excerpt>.*?)(?=\n\d+\.\s*来源：|\n【回答要求】|\Z)",
        raw_result,
        flags=re.S,
    )
    search_units = [
        (
            re.sub(r"\s+", "", excerpt),
            f"{source.strip()} / chunk #{chunk.strip()}",
        )
        for _hit_type, source, chunk, excerpt in blocks
    ] or [(re.sub(r"\s+", "", raw_result), _extract_first_rag_source(raw_result))]
    candidate_names = [name]
    if "（" in name:
        candidate_names.append(re.sub(r"（.*?）", "", name))
    if "甪宝支线" in name:
        candidate_names.append("甪宝支线")
    if "西一线干线" in name or "西气东输一线" in trunk:
        candidate_names.extend(["西气东输干线", "西一线干线"])
    if "中俄东线" in name or "中俄东线" in trunk:
        candidate_names.extend(["中俄东线干线", "中俄东线"])
    if "西二" in name or "西气东输二线" in trunk:
        candidate_names.extend(["支干线", "西气东输二线支干线"])

    def clean_material(value: str) -> str:
        return str(value or "").replace("管材", "").strip()

    for compact, source in search_units:
        for candidate in sorted({item for item in candidate_names if item}, key=len, reverse=True):
            key = re.escape(re.sub(r"\s+", "", candidate))
            patterns = [
                rf"{key}(?:管材|材质|钢级)?(?:使用|采用|为)(?P<material>{MATERIAL_TOKEN_PATTERN})",
                rf"{key}(?P<material>{MATERIAL_TOKEN_PATTERN})",
            ]
            for pattern in patterns:
                match = re.search(pattern, compact, flags=re.IGNORECASE)
                if match:
                    return clean_material(match.group("material")), source

    generic_patterns = []
    if "中俄东线" in name or "中俄东线" in trunk:
        generic_patterns.append(rf"中俄东线干线(?:使用|采用|为)(?P<material>{MATERIAL_TOKEN_PATTERN})")
    if "西气东输一线" in trunk or "西一线" in name:
        generic_patterns.append(rf"西气东输干线(?P<material>{MATERIAL_TOKEN_PATTERN})")
    if "西气东输二线" in trunk or "西二" in name:
        generic_patterns.append(rf"支干线全部采用(?P<material>{MATERIAL_TOKEN_PATTERN})")

    for compact, source in search_units:
        for pattern in generic_patterns:
            match = re.search(pattern, compact, flags=re.IGNORECASE)
            if match:
                return clean_material(match.group("material")), source

    return "未命中", "-"


async def _station_material_event_generator(message: str, session: Session):
    normalized_message = str(message or "").replace("棺材", "管材").strip()
    yield "[TOOL] raw_excel_station_connections\n"
    station_candidates, connected_pipelines = _collect_station_connected_pipelines(normalized_message)

    if not connected_pipelines:
        reply_text = "\n".join([
            "结论：没有在索引里找到这个站场连通的管线，不能直接回答管材。",
            "",
            f"我识别的问题：{normalized_message}",
            "",
            "建议：把站名补全，比如“甪直分输站”“甪直联络站”，或者直接问某条连通管线的管材。",
        ])
        reply_text = _append_completeness_hint(reply_text, message, is_complete=False, reason="站场连通管线未命中。")
        yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
        yield "[DONE]\n"
        return

    yield "[TOOL] search_knowledge_base\n"
    rows = []
    for pipeline in connected_pipelines[:12]:
        material = "未命中"
        source = "-"
        used_query = ""
        for query in _material_query_variants_for_connected_pipeline(pipeline):
            used_query = query
            tool_result = execute_tool("search_knowledge_base", {"query": query, "limit": 6}, session)
            if "未检索到足够相关" in tool_result or "执行出错" in tool_result:
                continue
            material, source = _extract_material_for_connected_pipeline(pipeline, tool_result)
            if material != "未命中":
                break
        rows.append({
            "station": pipeline.get("station_name") or "",
            "pipeline": pipeline.get("name") or "",
            "trunk": pipeline.get("trunk_name") or "",
            "relation": pipeline.get("relation") or "",
            "material": material,
            "source": source,
            "query": used_query,
        })

    station_names = "、".join(dict.fromkeys(str(item.get("name") or "") for item in station_candidates[:6] if item.get("name")))
    table = [
        "| 枢纽/站场记录 | 连通管线 | 所属系统 | 管材/钢级 | 来源 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        table.append(
            f"| {row['station'] or station_names or '识别站场'} | {row['pipeline']} | {row['trunk'] or '-'} | {row['material']} | {row['source']} |"
        )

    reply_text = "\n".join([
        "结论：甪直这类问题应按“枢纽/站场连通管线”查管材，不是查甪直站本体的管材。",
        "",
        f"识别到的站场记录：{station_names or '未明确'}",
        "",
        *table,
        "",
        "说明：表里先用站场索引确定连通管线，再用 RAG 规程库查各管线管材；未命中的管线不补、不猜。",
    ])
    reply_text = _append_completeness_hint(
        reply_text,
        message,
        is_complete=True,
        reason="已按站场/枢纽连通管线查询管材。",
    )
    yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
    yield "[DONE]\n"


async def _rag_answer_event_generator(message: str, session: Session):
    normalized_message = str(message or "").replace("棺材", "管材").strip()
    is_material_query = _looks_like_pipeline_material_query(normalized_message)
    yield "[TOOL] search_knowledge_base\n"
    tool_result = execute_tool(
        "search_knowledge_base",
        {"query": normalized_message, "limit": 8},
        session,
    )

    no_hit = "未检索到足够相关" in tool_result or "执行出错" in tool_result
    if no_hit:
        reply_text = "\n".join([
            "结论：RAG 库里没有搜到足够相关的资料，不能硬答。",
            "",
            f"我检索的问题：{normalized_message or message}",
            "",
            "你可以换一种问法：",
            "- 带上管线全称、站场全称或文件里的正式名称。",
            "- 查具体参数时，加上“附录、表、设计压力、保护定值、管材、规格”等关键词。",
            "- 如果还搜不到，说明资料可能没入库，或者 PDF/OCR 解析质量需要补。",
        ])
        reply_text = _append_completeness_hint(
            reply_text,
            message,
            is_complete=False,
            reason="默认 RAG 检索未命中足够相关片段。",
        )
        yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
        yield "[DONE]\n"
        return

    raw_result = re.sub(
        r"\n【回答要求】.*$",
        "",
        tool_result,
        flags=re.S,
    ).strip()

    yield f"[THINK] {json.dumps('默认模式：已先检索 RAG 库，再基于命中片段整理回答。需要看原始 chunk 时可输入 /RAG检索 + 问题。', ensure_ascii=False)}\n"

    if is_material_query:
        material_reply = _format_pipeline_material_reply_from_rag(normalized_message or message, raw_result)
        if material_reply:
            material_reply = _append_completeness_hint(
                material_reply,
                message,
                is_complete=True,
                reason="已按材料类问题从 RAG 命中片段抽取干线/支线管材表。",
            )
            yield f"[REPLY] {json.dumps(_apply_yuqian_style(material_reply), ensure_ascii=False)}\n"
            yield "[DONE]\n"
            return

    prompt = "\n".join([
        "你是天然气管网资料检索助手。用户普通提问时，系统已先检索 RAG 知识库。",
        "请只依据下面的 RAG 命中片段回答，不要编造未出现的参数、材质、标准号或结论。",
        "如果命中片段不能直接回答用户问题，第一句明确说“当前 RAG 命中片段不足以直接回答”，再列出搜到了哪些相近依据。",
        "输出要求：",
        "1. 先给“结论：”。",
        "2. 再给 2-4 条“依据：”，每条尽量短，带来源文件名和 chunk 编号。",
        "3. 最后给“下一步：”，说明要换什么关键词或补什么资料。",
        "4. 不要输出大段原始 chunk，不要输出“RAG 库命中结果”清单。",
        "5. 如果用户问管材、材质、钢级、钢管，必须优先按“干线/支线”分组回答，并且结论后立刻给 Markdown 表格。",
        "6. 管材类问题的表格列固定为：范围、管段/支线、管材/钢级、来源。不能只说“支线分别用了不同等级”，必须把命中片段里能确认的干线、支线、联络线逐项列出来。",
        "7. 管材类问题严禁列出命中片段里没有出现的支线名称；如果某类范围没有命中，只写一行“支线 / 未命中 / 未命中 / -”，不要自己补支线清单。",
        "",
        "本题必须按管材表格回答。" if is_material_query else "",
        "",
        f"用户问题：{normalized_message or message}",
        "",
        "RAG 命中片段：",
        raw_result,
    ])

    try:
        reply_text = await ai_client.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "你回答要简洁、证据优先、不能脱离 RAG 命中片段。安全和参数类问题必须保守。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=900,
        )
    except Exception as exc:
        logger.warning("Default RAG answer generation failed: %s", exc)
        reply_text = "\n".join([
            "结论：RAG 库已命中资料，但整理回答时 AI 归纳失败了。",
            "",
            "你可以输入 `/RAG检索 当前问题` 查看原始命中片段。",
            "",
            f"错误：{exc}",
        ])

    if not str(reply_text or "").strip():
        reply_text = "\n".join([
            "结论：RAG 库已命中资料，但 AI 归纳结果为空。",
            "",
            "你可以输入 `/RAG检索 当前问题` 查看原始命中片段。",
        ])

    reply_text = _append_completeness_hint(
        _strip_think_tags(reply_text),
        message,
        is_complete=True,
        reason="已完成默认 RAG 检索，并基于命中片段生成可读回答。",
    )
    yield f"[REPLY] {json.dumps(_apply_yuqian_style(reply_text), ensure_ascii=False)}\n"
    yield "[DONE]\n"


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
