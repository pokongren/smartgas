from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "docs" / "automation" / "ai-query-iteration"
STATE_PATH = REPORT_DIR / "runs.jsonl"

CORE_FILES = [
    "backend/app/routers/ai_assistant.py",
    "backend/app/services/assistant_tools.py",
    "backend/app/services/raw_excel_ai_direct.py",
    "backend/app/services/raw_excel_ai_index.py",
    "backend/app/routers/scada.py",
    "src/components/ai-assistant/AiAssistant.tsx",
    "src/components/scada/StationHistoryPanel.tsx",
    "src/views/GlobalPipelineView.tsx",
]

DEFAULT_SAMPLE_QUERIES = [
    "压缩机参数列表",
    "鼓浪压缩机参数列表",
    "古浪压气站是什么站",
    "甪直水露点",
    "甪直和中卫水露点对比",
    "中卫压力曲线",
    "压缩机故障应急处置步骤",
]

DEFAULT_DATA_ANALYSIS_QUERIES = [
    "/数据分析 甪直水露点",
    "/数据分析 甪直和中卫水露点对比",
    "/数据分析 中卫压力曲线",
]

CONFIG_PATH = ROOT / "tools" / "ai_query_iteration_config.json"

CAPABILITY_PATTERNS = {
    "universal_search": r"universal_search|_handle_universal_search",
    "data_analysis_mode": r"/数据分析|DATA_ANALYSIS_ENTER|try_data_analysis_skill",
    "dewpoint_analysis": r"dewpoint|水露点|露点",
    "history_curve": r"history|曲线|StationHistoryPanel|ScadaHistoryChart",
    "station_compare": r"compare_stations|对比|比较",
    "scada_history": r"scada_history|ScadaHistory",
    "raw_excel_index": r"raw_excel_index|RawExcelAiIndex",
}


def run_command(args: list[str], *, timeout: int = 60, env: dict[str, str] | None = None) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            args,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=timeout,
            env=env,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        }
    except Exception as exc:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": str(exc)}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"config_error": str(exc)}


def get_sample_queries(config: dict[str, Any]) -> list[str]:
    queries = config.get("sample_queries") if isinstance(config, dict) else None
    if isinstance(queries, list) and all(isinstance(item, str) for item in queries):
        return queries
    return DEFAULT_SAMPLE_QUERIES


def get_data_analysis_queries(config: dict[str, Any]) -> list[str]:
    queries = config.get("data_analysis_queries") if isinstance(config, dict) else None
    if isinstance(queries, list) and all(isinstance(item, str) for item in queries):
        return queries
    return DEFAULT_DATA_ANALYSIS_QUERIES


def is_negative_reply(reply: str | None) -> bool:
    text = (reply or "").strip()
    if not text:
        return True
    negative_markers = (
        "当前没找到",
        "没找到",
        "没有露点快照",
        "暂时无法分析",
        "无法分析",
        "未命中",
        "缺少对应站点",
        "缺少可解析",
        '"total_hits": 0',
        "'total_hits': 0",
    )
    return any(marker in text for marker in negative_markers)


def scan_capabilities() -> dict[str, Any]:
    results: dict[str, Any] = {}
    for name, pattern in CAPABILITY_PATTERNS.items():
        hits: list[dict[str, Any]] = []
        regex = re.compile(pattern, re.IGNORECASE)
        for rel in CORE_FILES:
            path = ROOT / rel
            text = read_text(path)
            if not text:
                continue
            count = len(regex.findall(text))
            if count:
                hits.append({"file": rel, "count": count})
        results[name] = {
            "hit_count": sum(item["count"] for item in hits),
            "files": hits,
        }
    return results


def run_sample_queries(sample_queries: list[str], data_analysis_queries: list[str]) -> list[dict[str, Any]]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "backend")
    snippet = r'''
import json
from sqlmodel import Session
from app.database import engine
from app.routers.ai_assistant import ChatRequest, try_data_analysis_skill_reply_v2
from app.services.assistant_tools import _handle_universal_search
from app.services.raw_excel_ai_direct import (
    try_direct_count_reply,
    try_direct_entity_lookup,
    try_direct_list_reply,
)

queries = %s
data_analysis_queries = %s
rows = []
with Session(engine) as session:
    for query in queries:
        direct = (
            try_direct_count_reply(query)
            or try_direct_list_reply(query)
            or try_direct_entity_lookup(query)
            or ""
        )
        universal = _handle_universal_search({"query": query, "limit": 5}, session)
        rows.append({
            "query": query,
            "kind": "general",
            "direct_hit": bool(direct) and not (%s)(direct),
            "direct_preview": direct[:240],
            "universal_hit": bool(universal) and not (%s)(universal),
            "universal_preview": universal[:360],
        })
    for query in data_analysis_queries:
        reply = try_data_analysis_skill_reply_v2(ChatRequest(message=query))
        rows.append({
            "query": query,
            "kind": "data_analysis",
            "direct_hit": False,
            "direct_preview": "",
            "universal_hit": False,
            "universal_preview": "",
            "data_analysis_hit": bool(reply) and not (%s)(reply),
            "data_analysis_preview": (reply or "")[:360],
        })
print(json.dumps(rows, ensure_ascii=False))
''' % (
        json.dumps(sample_queries, ensure_ascii=False),
        json.dumps(data_analysis_queries, ensure_ascii=False),
        "lambda text: any(marker in (text or '') for marker in ['当前没找到', '没找到', '没有露点快照', '暂时无法分析', '无法分析', '未命中', '缺少对应站点', '缺少可解析', '\"total_hits\": 0'])",
        "lambda text: any(marker in (text or '') for marker in ['当前没找到', '没找到', '没有露点快照', '暂时无法分析', '无法分析', '未命中', '缺少对应站点', '缺少可解析', '\"total_hits\": 0'])",
        "lambda text: any(marker in (text or '') for marker in ['当前没找到', '没找到', '没有露点快照', '暂时无法分析', '无法分析', '未命中', '缺少对应站点', '缺少可解析', '\"total_hits\": 0'])",
    )
    result = run_command([sys.executable, "-c", snippet], timeout=90, env=env)
    if not result["ok"]:
        return [{
            "query": "__runner__",
            "direct_hit": False,
            "universal_hit": False,
            "error": (result["stderr"] or result["stdout"])[:800],
        }]
    try:
        return json.loads(result["stdout"])
    except Exception as exc:
        return [{
            "query": "__parse__",
            "direct_hit": False,
            "universal_hit": False,
            "error": f"{exc}: {result['stdout'][:800]}",
        }]


def build_recommendations(capabilities: dict[str, Any], samples: list[dict[str, Any]]) -> list[str]:
    recommendations: list[str] = []
    missed = [
        item for item in samples
        if not item.get("direct_hit") and not item.get("universal_hit") and not item.get("data_analysis_hit")
    ]
    weak_direct = [
        item for item in samples
        if item.get("kind") == "general" and not item.get("direct_hit") and item.get("universal_hit")
    ]
    weak_data_analysis = [
        item for item in samples
        if item.get("kind") == "data_analysis" and not item.get("data_analysis_hit")
    ]

    if missed:
        names = "、".join(str(item.get("query")) for item in missed[:3])
        recommendations.append(f"补充未命中样例的别名与意图识别：{names}。")
    if weak_direct:
        names = "、".join(str(item.get("query")) for item in weak_direct[:3])
        recommendations.append(f"把全域能命中但直连没命中的问题前移到直连链路：{names}。")
    if weak_data_analysis:
        names = "、".join(str(item.get("query")) for item in weak_data_analysis[:3])
        recommendations.append(f"修补数据分析 Skill 的意图入口或数据兜底：{names}。")
    if capabilities.get("station_compare", {}).get("hit_count", 0) < 8:
        recommendations.append("增强多站对比能力：压力、温度、水露点统一走同一套指标对齐和风险分级。")
    if capabilities.get("history_curve", {}).get("hit_count", 0) < 8:
        recommendations.append("增强历史曲线能力：支持“最近6小时/12小时/全天”的自然语言时间窗口。")
    if not recommendations:
        recommendations.append("当前基础检索链路正常，下一轮优先扩展数据分析口径：趋势、波动、阈值、站间对比。")
    return recommendations


def write_report(payload: dict[str, Any]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = payload["timestamp"]
    report_path = REPORT_DIR / f"{timestamp}.md"

    lines = [
        "# AI查询与数据分析自动巡检报告",
        "",
        "一、结论",
        "",
        payload["summary"],
        "",
        "二、验证结果",
        "",
        f"1. Python编译：{'通过' if payload['py_compile']['ok'] else '失败'}。",
        f"2. 工作区状态：{payload['git_status_summary']}。",
        f"3. 样例总数：{len(payload['samples'])}，有效命中：{sum(1 for item in payload['samples'] if item.get('direct_hit') or item.get('universal_hit') or item.get('data_analysis_hit'))}。",
        "",
        "三、样例检索",
        "",
        "| 问题 | 类型 | 直连 | 全域 | 数据分析 | 观察 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for item in payload["samples"]:
        preview = str(
            item.get("data_analysis_preview")
            or item.get("direct_preview")
            or item.get("universal_preview")
            or item.get("error")
            or ""
        )
        preview = preview.replace("\n", " ").replace("|", "/")[:80]
        lines.append(
            f"| {item.get('query')} | {item.get('kind', 'general')} | "
            f"{'是' if item.get('direct_hit') else '否'} | "
            f"{'是' if item.get('universal_hit') else '否'} | "
            f"{'是' if item.get('data_analysis_hit') else '否'} | {preview} |"
        )

    lines.extend([
        "",
        "四、能力覆盖",
        "",
        "| 能力 | 命中次数 | 文件数 |",
        "| --- | ---: | ---: |",
    ])
    for name, info in payload["capabilities"].items():
        lines.append(f"| {name} | {info.get('hit_count', 0)} | {len(info.get('files', []))} |")

    lines.extend([
        "",
        "五、下一轮建议",
        "",
    ])
    for index, item in enumerate(payload["recommendations"], start=1):
        lines.append(f"{index}. {item}")

    lines.extend([
        "",
        "六、原始校验摘要",
        "",
        "```text",
        (payload["py_compile"].get("stderr") or payload["py_compile"].get("stdout") or "py_compile ok")[:1200],
        "```",
    ])

    report_path.write_text("\n".join(lines), encoding="utf-8")
    latest_path = REPORT_DIR / "latest.md"
    latest_path.write_text("\n".join(lines), encoding="utf-8")
    with STATE_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return report_path


def main() -> int:
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    config = load_config()
    sample_queries = get_sample_queries(config)
    data_analysis_queries = get_data_analysis_queries(config)
    git_status = run_command(["git", "status", "--short"], timeout=30)
    py_compile = run_command([
        sys.executable,
        "-m",
        "py_compile",
        "backend/app/routers/ai_assistant.py",
        "backend/app/services/assistant_tools.py",
        "backend/app/services/raw_excel_ai_direct.py",
        "backend/app/services/raw_excel_ai_index.py",
    ], timeout=60)
    capabilities = scan_capabilities()
    samples = run_sample_queries(sample_queries, data_analysis_queries)
    recommendations = build_recommendations(capabilities, samples)

    payload = {
        "timestamp": timestamp,
        "summary": "自动巡检已完成：检索核心文件、样例查询和数据分析入口均已检查，报告用于下一轮人工或低风险自动迭代。",
        "config": config,
        "git_status_summary": "干净" if not git_status["stdout"] else f"{len(git_status['stdout'].splitlines())}项变更",
        "git_status": git_status,
        "py_compile": py_compile,
        "capabilities": capabilities,
        "samples": samples,
        "recommendations": recommendations,
    }
    report_path = write_report(payload)
    print(str(report_path))
    return 0 if py_compile["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
