"""
数据导入 Skill 路由
提供 AI 解析原始数据 → 结构化 JSON → 写入数据库的两步接口
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session
from typing import Optional

from app.database import get_session
from app.models import Station, Pipeline
from app.services.ai_client import ai_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skill/data-import", tags=["数据导入技能"])


# ============ 请求/响应模型 ============

class ParseRequest(BaseModel):
    """AI 解析请求"""
    raw_text: str


class StationData(BaseModel):
    """解析出的站场数据"""
    id: str
    name: str
    type: str = "distribution"
    longitude: float = 0.0
    latitude: float = 0.0
    design_pressure: Optional[float] = 10.0


class PipelineData(BaseModel):
    """解析出的管线数据"""
    id: str
    name: str
    start_station_id: str
    end_station_id: str
    diameter_mm: Optional[float] = None
    length_km: float = 0.0
    design_pressure_mpa: Optional[float] = 10.0
    category: str = "branch"


class ParseResult(BaseModel):
    """AI 解析结果"""
    stations: list[StationData] = []
    pipelines: list[PipelineData] = []


class ExecuteRequest(BaseModel):
    """写入数据库请求（用户确认后提交）"""
    stations: list[StationData] = []
    pipelines: list[PipelineData] = []


class ExecuteResult(BaseModel):
    """写入结果"""
    stations_created: int = 0
    stations_skipped: int = 0
    pipelines_created: int = 0
    pipelines_skipped: int = 0
    errors: list[str] = []


# ============ 预置的系统 Prompt ============

# NOTE: 系统 Prompt 指导 AI 严格按照数据库 schema 输出 JSON
PARSE_SYSTEM_PROMPT = """你是天然气管网数据解析专家。你的任务是从用户提供的原始文本（可以是自然语言描述、CSV、表格数据等任意格式）中提取站场和管线信息。

必须严格输出以下 JSON 格式（不要输出任何其他内容，只输出纯 JSON）：

{
  "stations": [
    {
      "id": "自动生成的唯一ID，格式为 node-XXX",
      "name": "站场名称",
      "type": "站场类型: source(气源/首站) / compressor(压气站) / distribution(分输站) / valve(阀室)",
      "longitude": 0.0,
      "latitude": 0.0,
      "design_pressure": 10.0
    }
  ],
  "pipelines": [
    {
      "id": "自动生成的唯一ID，格式为 line-XXX",
      "name": "管线名称（如 起点-终点段）",
      "start_station_id": "起点站场ID（对应 stations 中的 id）",
      "end_station_id": "终点站场ID（对应 stations 中的 id）",
      "diameter_mm": 1016,
      "length_km": 100.0,
      "design_pressure_mpa": 10.0,
      "category": "管线类别: trunk(干线，管径>=813mm) / branch(支线)"
    }
  ]
}

规则：
1. ID 必须唯一，站场用 node-001, node-002... 管线用 line-001, line-002...
2. 管线的 start_station_id 和 end_station_id 必须引用 stations 中已有的 id
3. 如果文本中没有提到经纬度，longitude 和 latitude 填 0。
4. 如果管径 >= 813mm，category 填 "trunk"，否则填 "branch"
5. 根据上下文推断站场类型：首站/气源站 → source，压气站 → compressor，分输站 → distribution，阀室 → valve
6. 如果文本中某些字段信息缺失，使用合理的默认值
7. 只输出 JSON，不要输出任何解释文字"""


# ============ API 端点 ============

@router.post("/parse", response_model=ParseResult)
async def parse_raw_data(data: ParseRequest):
    """
    第一步：AI 解析原始数据为结构化 JSON
    用户可在前端预览和修正解析结果
    """
    if not data.raw_text.strip():
        raise HTTPException(status_code=400, detail="原始数据不能为空")

    logger.info(f"开始 AI 解析，原始数据长度: {len(data.raw_text)}")

    try:
        # 拼接系统 Prompt + 用户输入
        full_prompt = f"{PARSE_SYSTEM_PROMPT}\n\n用户输入的原始数据：\n{data.raw_text}"

        # 调用 AI API，使用低温度确保输出稳定
        ai_response = await ai_client.chat_completion(
            prompt=full_prompt,
            temperature=0.1,
            max_tokens=4000,
        )

        # 尝试从 AI 响应中提取 JSON
        parsed = _extract_json(ai_response)

        result = ParseResult(
            stations=[StationData(**s) for s in parsed.get("stations", [])],
            pipelines=[PipelineData(**p) for p in parsed.get("pipelines", [])],
        )

        logger.info(f"AI 解析完成: {len(result.stations)} 个站场, {len(result.pipelines)} 条管线")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"AI 返回的内容无法解析为 JSON: {e}")
        raise HTTPException(
            status_code=422,
            detail=f"AI 返回的内容无法解析为有效 JSON，请尝试调整输入数据格式。原始响应片段: {ai_response[:200]}"
        )
    except Exception as e:
        logger.error(f"AI 解析失败: {e}")
        raise HTTPException(status_code=500, detail=f"AI 解析失败: {str(e)}")


@router.post("/execute", response_model=ExecuteResult)
def execute_import(
    data: ExecuteRequest,
    session: Session = Depends(get_session),
):
    """
    第二步：将用户确认的结构化数据写入数据库
    跳过已存在的 ID（幂等操作）
    """
    result = ExecuteResult()

    # 写入站场
    for s in data.stations:
        try:
            existing = session.get(Station, s.id)
            if existing:
                result.stations_skipped += 1
                continue

            station = Station(
                id=s.id,
                name=s.name,
                type=s.type,
                longitude=s.longitude,
                latitude=s.latitude,
                design_pressure=s.design_pressure,
            )
            session.add(station)
            result.stations_created += 1
        except Exception as e:
            result.errors.append(f"站场 {s.name} 写入失败: {str(e)}")

    # 先提交站场，确保管线引用有效
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"站场写入失败: {str(e)}")

    # 写入管线
    for p in data.pipelines:
        try:
            existing = session.get(Pipeline, p.id)
            if existing:
                result.pipelines_skipped += 1
                continue

            pipeline = Pipeline(
                id=p.id,
                name=p.name,
                start_station_id=p.start_station_id,
                end_station_id=p.end_station_id,
                diameter_mm=p.diameter_mm,
                length_km=p.length_km,
                design_pressure_mpa=p.design_pressure_mpa,
                category=p.category,
            )
            session.add(pipeline)
            result.pipelines_created += 1
        except Exception as e:
            result.errors.append(f"管线 {p.name} 写入失败: {str(e)}")

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"管线写入失败: {str(e)}")

    logger.info(
        f"数据导入完成: 站场 {result.stations_created} 创建 / {result.stations_skipped} 跳过, "
        f"管线 {result.pipelines_created} 创建 / {result.pipelines_skipped} 跳过"
    )
    return result


def _extract_json(text: str) -> dict:
    """
    从 AI 响应中提取 JSON
    处理 AI 可能在 JSON 外层包裹 markdown 代码块的情况
    """
    cleaned = text.strip()

    # 去除 markdown 代码块标记
    if cleaned.startswith("```"):
        # 找到第一个换行符后的内容
        first_newline = cleaned.index("\n")
        # 找到最后一个 ``` 的位置
        last_fence = cleaned.rfind("```")
        if last_fence > first_newline:
            cleaned = cleaned[first_newline + 1:last_fence].strip()

    return json.loads(cleaned)
