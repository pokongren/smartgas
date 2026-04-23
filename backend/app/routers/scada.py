"""
SCADA 数据 API

提供站场实时监测数据的查询接口和数据模拟器。
所有前端视图（表格、坡降线、拓扑图）共用这些接口。
"""
import random
import asyncio
import logging
from datetime import datetime
from typing import Optional
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.database import get_scada_history_session, get_session
from app.models import Station
from app.services.junction_groups import load_runtime_junction_groups
from app.scada_models import ScadaStation, ScadaHistory, ScadaIngestBatch, ScadaMetricCatalog

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/scada")

# ============ 告警规则 ============

ALERT_RULES = [
    {"field": "in_pressure",  "op": "<",  "val": 5.0,  "level": "warning", "tpl": "进站压力{v:.3f}MPa，低于5.0"},
    {"field": "out_pressure", "op": ">",  "val": 10.5, "level": "danger",  "tpl": "出站压力{v:.3f}MPa，超过10.5"},
]


def check_alert(station: ScadaStation) -> Optional[dict]:
    """检查站场是否存在告警"""
    for rule in ALERT_RULES:
        val = getattr(station, rule["field"], None)
        if val is None:
            continue
        if rule["op"] == "<" and val < rule["val"]:
            return {"level": rule["level"], "msg": rule["tpl"].format(v=val)}
        if rule["op"] == ">" and val > rule["val"]:
            return {"level": rule["level"], "msg": rule["tpl"].format(v=val)}
    return None


# ============ 管线元信息 ============

PIPELINE_META = {
    "we1":      {"name": "西气东输一线",       "color": "#10b981"},
    "we2":      {"name": "西气东输二线",       "color": "#3b82f6"},
    "we1_west": {"name": "西气东输一线（西段）", "color": "#f59e0b"},
    "cred":     {"name": "中俄东线",           "color": "#ec4899"},
    "pt":       {"name": "平泰支干线",         "color": "#a855f7"},
}

METRIC_TYPE_ALIASES = {
    "pressure": "pressure",
    "压力": "pressure",
    "temperature": "temperature",
    "temp": "temperature",
    "温度": "temperature",
    "dewpoint": "dewpoint",
    "水露点": "dewpoint",
    "露点": "dewpoint",
    "h2s": "h2s",
    "硫化氢": "h2s",
    "hydrogen_sulfide": "h2s",
}

METRIC_DEFAULT_UNITS = {
    "pressure": "MPa",
    "temperature": "℃",
    "dewpoint": "℃",
    "h2s": "ppm",
}


def _normalize_metric_type(raw_metric: str) -> str:
    metric = str(raw_metric or "").strip().lower()
    return METRIC_TYPE_ALIASES.get(metric, metric or "pressure")


# ============ API 端点 ============

@router.get("/pipelines")
def list_pipelines(session: Session = Depends(get_session)):
    """获取所有管线列表及站场数量"""
    result = []
    for pid, meta in PIPELINE_META.items():
        count = len(session.exec(select(ScadaStation).where(ScadaStation.pipeline_id == pid)).all())
        result.append({"id": pid, "name": meta["name"], "color": meta["color"], "stationCount": count})
    return result


@router.get("/full/{pipeline_id}")
def get_full_pipeline(pipeline_id: str, session: Session = Depends(get_session)):
    """
    获取管线所有视图需要的完整数据（表格+坡降线+告警+统计）
    一个接口，三个视图共用。
    """
    meta = PIPELINE_META.get(pipeline_id, {"name": pipeline_id, "color": "#94a3b8"})

    stations_db = session.exec(
        select(ScadaStation)
        .where(ScadaStation.pipeline_id == pipeline_id)
        .order_by(ScadaStation.seq_order)
    ).all()

    stations = []
    alert_count = 0
    pressures = []

    for s in stations_db:
        alert = check_alert(s)
        if alert:
            alert_count += 1

        station_dict = {
            "name": s.name,
            "type": s.type,
            "seqOrder": s.seq_order,
            "inP": round(s.in_pressure, 3) if s.in_pressure else 0,
            "outP": round(s.out_pressure, 3) if s.out_pressure else 0,
            "inT": round(s.in_temp, 1) if s.in_temp else None,
            "outT": round(s.out_temp, 1) if s.out_temp else None,
            "alert": alert,
            "updatedAt": s.updated_at.isoformat() if s.updated_at else None,
        }
        stations.append(station_dict)

        if s.in_pressure and s.in_pressure > 0.1:
            pressures.append(s.in_pressure)
        if s.out_pressure and s.out_pressure > 0.1:
            pressures.append(s.out_pressure)

    stats = {
        "totalStations": len(stations),
        "compressorCount": sum(1 for s in stations if s["type"] == "compressor"),
        "maxPressure": round(max(pressures), 3) if pressures else 0,
        "minPressure": round(min(pressures), 3) if pressures else 0,
        "avgPressure": round(sum(pressures) / len(pressures), 3) if pressures else 0,
        "alertCount": alert_count,
    }

    return {
        "pipeline": {"id": pipeline_id, "name": meta["name"], "color": meta["color"]},
        "stations": stations,
        "stats": stats,
    }


@router.post("/simulate")
def simulate_once(session: Session = Depends(get_session)):
    """
    手动触发一次模拟：在基准值上加随机波动，更新 scada_stations 表。
    用于演示"改数据库 → 前端自动变"的效果。
    """
    stations = session.exec(select(ScadaStation)).all()
    updated = 0
    for s in stations:
        if s.base_in_pressure is not None:
            s.in_pressure = round(s.base_in_pressure + random.uniform(-0.15, 0.15), 3)
        if s.base_out_pressure is not None:
            s.out_pressure = round(s.base_out_pressure + random.uniform(-0.1, 0.1), 3)
        if s.base_in_temp is not None:
            s.in_temp = round(s.base_in_temp + random.uniform(-0.5, 0.5), 1)
        if s.base_out_temp is not None:
            s.out_temp = round(s.base_out_temp + random.uniform(-0.3, 0.3), 1)
        s.updated_at = datetime.now()
        session.add(s)
        updated += 1
    session.commit()
    return {"msg": f"已更新 {updated} 个站场的模拟数据", "updated": updated}


# ============ 数据初始化 ============

@router.post("/init")
def init_scada_data(session: Session = Depends(get_session)):
    """
    初始化 SCADA 数据：将中卫压气站的基准数据写入数据库。
    仅用于首次使用，后续可扩展导入更多站场。
    """
    # 先检查是否已有数据
    existing = session.exec(select(ScadaStation).where(ScadaStation.pipeline_id == "we1")).all()
    if existing:
        return {"msg": f"数据已存在（{len(existing)}条），跳过初始化", "count": len(existing)}

    # 西一线东段真实基准数据（从前端硬编码中提取）
    we1_data = [
        ("中卫压气站",   "compressor",    1, 6.391, 7.856, 7.7,  30.8),
        ("盐池压气站",   "compressor",    2, 7.133, 7.092, 10.3, 10.2),
        ("靖边压气站",   "compressor",    3, 6.681, 8.947, 5.7,  34.9),
        ("子长分输站",   "distribution",  4, 8.098, 8.098, 19.9, 19.9),
        ("延川压气站",   "compressor",    5, 7.880, 9.175, 21.4, 31.9),
        ("沁水压气站",   "compressor",    6, 6.889, 8.762, 18.0, 39.4),
        ("阳城清管站",   "distribution",  7, 7.936, 7.912, 16.4, 16.4),
        ("博爱分输站",   "distribution",  8, 7.118, 7.126, None, 26.2),
        ("郑州压气站",   "compressor",    9, 6.166, 7.830, 20.1, 41.9),
        ("薛店分输站",   "distribution", 10, 7.273, 7.273, None, 34.8),
        ("淮阳压气站",   "compressor",   11, 5.726, 7.766, 18.4, 45.0),
        ("利辛分输站",   "distribution", 12, 6.354, 6.232, 21.6, 16.9),
        ("定远压气站",   "compressor",   13, 4.818, 6.245, 12.8, 35.0),
        ("龙池分输站",   "distribution", 14, 6.005, 6.002, None, 19.3),
        ("龙源分输站",   "distribution", 15, 5.971, 5.590, None, 20.4),
        ("镇江分输站",   "distribution", 16, 5.573, 5.575, None, 14.9),
        ("常州分输站",   "distribution", 17, 5.255, 5.248, None, 13.4),
        ("芙蓉分输站",   "distribution", 18, 5.167, 5.162, 15.9, 5.2),
        ("无锡分输站",   "distribution", 19, 4.244, 5.101, None, 12.2),
        ("东桥分输站",   "distribution", 20, 5.092, 5.087, None, 12.7),
        ("苏州分输站",   "distribution", 21, 5.078, 5.089, None, 15.5),
        ("甪直分输站",   "distribution", 22, 5.094, 5.106, None, 7.9),
        ("昆山分输站",   "distribution", 23, 5.073, 5.065, None, 12.4),
        ("上海白鹤末站", "distribution", 24, 5.050, 5.050, None, 13.7),
    ]

    count = 0
    for name, stype, seq, inp, outp, int_, outt in we1_data:
        station = ScadaStation(
            pipeline_id="we1",
            name=name,
            type=stype,
            seq_order=seq,
            in_pressure=inp,
            out_pressure=outp,
            in_temp=int_,
            out_temp=outt,
            base_in_pressure=inp,
            base_out_pressure=outp,
            base_in_temp=int_,
            base_out_temp=outt,
        )
        session.add(station)
        count += 1

    session.commit()
    return {"msg": f"已初始化 {count} 个站场", "count": count}


# ============ Excel 导入 + 历史回放 ============

# 回放指针（记录当前回放到第几行）
_playback_index: dict[str, int] = {}


def _read_excel_time_series_points(
    file_path: str,
    *,
    sheet_name: str | int | None = None,
) -> list[tuple[datetime, float]]:
    """
    读取 PI 图形导出的两列时序文件（x轴时间 + y轴数值），支持 xls/xlsx。
    """
    try:
        import pandas as pd
    except Exception as exc:
        raise RuntimeError("缺少 pandas 依赖，无法读取 Excel。") from exc

    source = Path(file_path).expanduser()
    if not source.exists():
        raise FileNotFoundError(f"未找到 Excel 文件: {source}")

    ext = source.suffix.lower()
    engine = None
    if ext == ".xls":
        engine = "xlrd"
    elif ext in {".xlsx", ".xlsm"}:
        engine = "openpyxl"

    selected_sheet: str | int = 0
    if sheet_name is not None and str(sheet_name).strip():
        raw_sheet = str(sheet_name).strip()
        selected_sheet = int(raw_sheet) if raw_sheet.isdigit() else raw_sheet

    try:
        raw_df = pd.read_excel(source, sheet_name=selected_sheet, header=None, engine=engine)
    except ImportError as exc:
        if ext == ".xls":
            raise RuntimeError("读取 .xls 需要安装 xlrd>=2.0.1。") from exc
        raise RuntimeError(f"读取 Excel 失败，缺少依赖: {exc}") from exc
    except Exception as exc:
        raise RuntimeError(f"读取 Excel 失败: {exc}") from exc

    if raw_df.empty:
        raise ValueError("Excel 内容为空。")
    if raw_df.shape[1] < 2:
        raise ValueError("Excel 至少需要两列：时间列和值列。")

    raw_time_series = raw_df.iloc[:, 0].astype(str).str.strip()
    time_series = pd.to_datetime(raw_time_series, format="%Y-%m-%d %H:%M:%S.%f", errors="coerce")
    missing_time_mask = time_series.isna()
    if missing_time_mask.any():
        # 兜底兼容其它时间格式，避免因单一格式导致全量丢失。
        time_series.loc[missing_time_mask] = pd.to_datetime(
            raw_time_series[missing_time_mask],
            errors="coerce",
        )
    value_series = pd.to_numeric(raw_df.iloc[:, 1], errors="coerce")

    normalized_df = pd.DataFrame({"recorded_at": time_series, "value": value_series}).dropna()
    if normalized_df.empty:
        raise ValueError("未识别到有效时序点（时间或数值列为空）。")

    normalized_df = normalized_df.drop_duplicates(subset=["recorded_at"], keep="last").sort_values("recorded_at")
    points: list[tuple[datetime, float]] = []
    for row in normalized_df.itertuples(index=False):
        points.append((row.recorded_at.to_pydatetime(), float(row.value)))
    return points


def _import_history_points(
    *,
    history_session: Session,
    station_name: str,
    station_id: Optional[str],
    pipeline_id: str,
    metric_type: str,
    metric_code: str,
    unit: Optional[str],
    tag_name: str,
    points: list[tuple[datetime, float]],
    replace_existing: bool,
    source_system: Optional[str],
    source_file: Optional[str],
    quality_code: Optional[int],
    ingest_batch_id: Optional[str],
) -> dict:
    cleared = 0
    if replace_existing:
        old_records = history_session.exec(
            select(ScadaHistory).where(
                ScadaHistory.station_name == station_name,
                ScadaHistory.pipeline_id == pipeline_id,
                ScadaHistory.metric_type == metric_type,
            )
        ).all()
        cleared = len(old_records)
        for record in old_records:
            history_session.delete(record)
        history_session.flush()

    for recorded_at, value in points:
        history_session.add(
            ScadaHistory(
                station_name=station_name,
                station_id=station_id,
                pipeline_id=pipeline_id,
                tag_name=tag_name,
                metric_type=metric_type,
                metric_code=metric_code,
                unit=unit,
                quality_code=quality_code,
                source_system=source_system,
                source_file=source_file,
                ingest_batch_id=ingest_batch_id,
                recorded_at=recorded_at,
                value=float(value),
            )
        )

    if ingest_batch_id:
        history_session.add(
            ScadaIngestBatch(
                batch_id=ingest_batch_id,
                station_name=station_name,
                pipeline_id=pipeline_id,
                metric_type=metric_type,
                source_system=source_system,
                source_file=source_file,
                row_count=len(points),
                status="success",
            )
        )

    history_session.commit()
    _playback_index[station_name] = 0

    return {
        "station": station_name,
        "pipeline": pipeline_id,
        "metric": metric_type,
        "imported": len(points),
        "cleared": cleared,
        "batchId": ingest_batch_id,
        "timeRange": {
            "from": points[0][0].isoformat() if points else None,
            "to": points[-1][0].isoformat() if points else None,
        },
    }


@router.post("/import-history-file")
def import_history_file(
    file_path: str = Query(..., description="Excel 文件绝对路径，支持 .xls / .xlsx"),
    station_name: str = Query(..., description="站名，如：中卫压气站"),
    station_id: Optional[str] = Query(None, description="站场ID，可选"),
    pipeline_id: str = Query("we1", description="管线ID，如 we1/we2/cred"),
    metric_type: str = Query("pressure", description="pressure/temperature/dewpoint/h2s/自定义"),
    metric_code: Optional[str] = Query(None, description="统一指标编码，默认同 metric_type"),
    unit: Optional[str] = Query(None, description="单位，不传则按指标默认单位"),
    tag_name: Optional[str] = Query(None, description="PI Tag 名，不传则自动生成"),
    sheet_name: Optional[str] = Query(None, description="工作表名或下标（从0开始）"),
    replace_existing: bool = Query(True, description="是否先清空同站同管线同指标历史"),
    source_system: str = Query("excel", description="来源系统标识"),
    quality_code: Optional[int] = Query(0, description="质量码，0为正常"),
    ingest_batch_id: Optional[str] = Query(None, description="导入批次ID，不传自动生成"),
    history_session: Session = Depends(get_scada_history_session),
):
    metric = _normalize_metric_type(metric_type)
    metric_code_value = (metric_code or metric).strip().lower()
    if not metric_code_value:
        raise HTTPException(status_code=400, detail="metric_code 不能为空")

    station = (station_name or "").strip()
    if not station:
        raise HTTPException(status_code=400, detail="station_name 不能为空")

    pipeline = (pipeline_id or "").strip().lower()
    if not pipeline:
        raise HTTPException(status_code=400, detail="pipeline_id 不能为空")

    parsed_tag = (tag_name or f"{pipeline.upper()}_{station}_{metric}").strip()
    parsed_station_id = (station_id or "").strip() or None
    parsed_unit = (unit or METRIC_DEFAULT_UNITS.get(metric) or "").strip() or None
    parsed_source_system = (source_system or "excel").strip() or "excel"
    parsed_batch_id = (ingest_batch_id or "").strip() or uuid.uuid4().hex
    try:
        points = _read_excel_time_series_points(file_path, sheet_name=sheet_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not points:
        raise HTTPException(status_code=400, detail="未读取到有效时序数据点")

    result = _import_history_points(
        history_session=history_session,
        station_name=station,
        station_id=parsed_station_id,
        pipeline_id=pipeline,
        metric_type=metric,
        metric_code=metric_code_value,
        unit=parsed_unit,
        tag_name=parsed_tag,
        points=points,
        replace_existing=replace_existing,
        source_system=parsed_source_system,
        source_file=str(Path(file_path)),
        quality_code=quality_code,
        ingest_batch_id=parsed_batch_id,
    )
    result["sourceFile"] = str(Path(file_path))
    result["sheet"] = sheet_name if sheet_name is not None else 0
    return result


@router.post("/import-excel")
def import_excel(
    session: Session = Depends(get_session),
    history_session: Session = Depends(get_scada_history_session),
):
    """
    导入甪直站 Excel 数据到 scada_history 表。
    解析 PI tag 列，提取西一线/西二线/中俄线的压力和温度时序数据。
    """
    import openpyxl

    excel_path = r'C:\Users\jushixio\Downloads\甪直站20262311-0312.xlsx'
    wb = openpyxl.load_workbook(excel_path)
    ws = wb.active

    # 先清除旧数据
    old = history_session.exec(select(ScadaHistory).where(ScadaHistory.station_name == "甪直分输站")).all()
    for row in old:
        history_session.delete(row)
    history_session.commit()

    # 列映射：(date_col, time_col, value_col, pipeline_id, tag_name, metric_type)
    col_map = [
        (10, 11, 12, "we1",  "XDX_02C006_PI1201.PV", "pressure"),    # 西一线压力
        (15, 16, 17, "we1",  "XDX_02C006_TI1201.PV", "temperature"),  # 西一线温度
        (20, 21, 22, "we2",  "XDE_02C006_PT1102.PV", "pressure"),    # 西二线压力
        (25, 26, 27, "we2",  "XDE_02C006_TT1101.PV", "temperature"),  # 西二线温度
        (30, 31, 32, "cred", "ZE_PT1101.PV",         "pressure"),    # 中俄线压力
        (34, 35, 36, "cred", "ZE_TT1201.PV",         "temperature"),  # 中俄线温度
    ]

    count = 0
    for row_idx in range(3, ws.max_row + 1):  # 从第3行开始（跳过表头）
        for date_col, time_col, val_col, pid, tag, mtype in col_map:
            date_val = ws.cell(row_idx, date_col).value
            time_val = ws.cell(row_idx, time_col).value
            value = ws.cell(row_idx, val_col).value

            if date_val is None or value is None:
                continue

            # 合并日期+时间
            if hasattr(time_val, 'hour'):
                recorded = datetime(
                    date_val.year, date_val.month, date_val.day,
                    time_val.hour, time_val.minute, time_val.second
                )
            else:
                recorded = date_val

            record = ScadaHistory(
                station_name="甪直分输站",
                pipeline_id=pid,
                tag_name=tag,
                metric_type=mtype,
                metric_code=mtype,
                unit=METRIC_DEFAULT_UNITS.get(mtype),
                source_system="excel",
                source_file=excel_path,
                recorded_at=recorded,
                value=float(value),
            )
            history_session.add(record)
            count += 1

    history_session.commit()

    # 重置回放指针
    _playback_index["甪直分输站"] = 0

    return {"msg": f"甪直站导入完成：{count} 条历史记录", "count": count, "rows": ws.max_row - 2}


@router.get("/history-schema")
def get_history_schema():
    """返回时序库结构说明，便于前端/AI 分析模块做参数适配。"""
    return {
        "table": "scada_history",
        "description": "多站点、多管线、多指标统一时序表（支持压力/温度/水露点/硫化氢扩展）",
        "columns": [
            {"name": "id", "type": "INTEGER", "nullable": False, "primaryKey": True},
            {"name": "station_id", "type": "VARCHAR", "nullable": True, "index": True, "description": "站场ID，可选"},
            {"name": "station_name", "type": "VARCHAR", "nullable": False, "index": True, "description": "站名"},
            {"name": "pipeline_id", "type": "VARCHAR", "nullable": False, "index": True, "description": "管线ID"},
            {"name": "tag_name", "type": "VARCHAR", "nullable": False, "description": "测点Tag"},
            {"name": "metric_type", "type": "VARCHAR", "nullable": False, "description": "业务指标类型，示例 pressure/temperature/dewpoint/h2s"},
            {"name": "metric_code", "type": "VARCHAR", "nullable": True, "index": True, "description": "统一指标编码"},
            {"name": "unit", "type": "VARCHAR", "nullable": True, "description": "单位"},
            {"name": "quality_code", "type": "INTEGER", "nullable": True, "description": "质量码"},
            {"name": "source_system", "type": "VARCHAR", "nullable": True, "description": "来源系统"},
            {"name": "source_file", "type": "VARCHAR", "nullable": True, "description": "来源文件"},
            {"name": "ingest_batch_id", "type": "VARCHAR", "nullable": True, "index": True, "description": "导入批次"},
            {"name": "extra_json", "type": "TEXT", "nullable": True, "description": "扩展字段JSON"},
            {"name": "recorded_at", "type": "DATETIME", "nullable": False, "index": True, "description": "采样时间"},
            {"name": "value", "type": "FLOAT", "nullable": False, "description": "测量值"},
        ],
        "indexes": [
            "idx_scada_history_station_metric_time(station_name, metric_type, recorded_at)",
            "idx_scada_history_station_pipeline_metric_time(station_name, pipeline_id, metric_type, recorded_at)",
            "idx_scada_history_metric_code_time(metric_code, recorded_at)",
            "idx_scada_history_ingest_batch(ingest_batch_id)",
        ],
        "analysisReady": {
            "predict_trend": True,
            "analyze_correlation_requires": ["pressure", "temperature"],
            "multi_station_supported": True,
        },
        "recommendedApis": {
            "import": "/api/scada/import-history-file",
            "metrics": "/api/scada/history-metrics",
            "stations": "/api/scada/history-stations",
            "timeseries": "/api/scada/history/{station_name}",
        },
    }


@router.get("/history-metrics")
def list_history_metrics(history_session: Session = Depends(get_scada_history_session)):
    """列出时序库当前已入库的指标及样本数量。"""
    rows = history_session.exec(
        select(
            ScadaHistory.metric_type,
            ScadaHistory.metric_code,
            func.count(ScadaHistory.id),
        )
        .group_by(ScadaHistory.metric_type, ScadaHistory.metric_code)
        .order_by(ScadaHistory.metric_type)
    ).all()

    catalog_rows = history_session.exec(
        select(ScadaMetricCatalog).where(ScadaMetricCatalog.enabled.is_(True)).order_by(ScadaMetricCatalog.metric_code)
    ).all()
    catalog_map = {item.metric_code: item for item in catalog_rows}

    result = []
    for metric_type, metric_code, count in rows:
        mt = str(metric_type or "")
        mc = str(metric_code or metric_type or "")
        catalog = catalog_map.get(mc)
        result.append(
            {
                "metricType": mt,
                "metricCode": mc,
                "metricName": catalog.metric_name if catalog else mc,
                "defaultUnit": catalog.default_unit if catalog else METRIC_DEFAULT_UNITS.get(mt),
                "count": int(count or 0),
            }
        )
    return {"metrics": result, "count": len(result)}


@router.get("/history-stations")
def list_history_stations(history_session: Session = Depends(get_scada_history_session)):
    """列出时序库已有数据的站点（用于分析引导和前端选择器）。"""
    rows = history_session.exec(
        select(ScadaHistory.station_name)
        .distinct()
        .order_by(ScadaHistory.station_name)
    ).all()
    station_names = [str(name).strip() for name in rows if str(name).strip()]
    return {"stations": station_names, "count": len(station_names)}


@router.get("/history-guide")
def get_history_guide():
    """给前端和运维的时序库使用引导。"""
    return {
        "goal": "统一接入多站场多指标时序数据，支持 AI 分析",
        "steps": [
            "1. 调用 /api/scada/import-history-file 导入一个站点一个指标的时序文件",
            "2. 调用 /api/scada/history-metrics 确认指标已入库",
            "3. 调用 /api/scada/history-stations 确认站点已可检索",
            "4. 调用 /api/scada/history/{station_name} 拉取曲线并联动 AI 分析",
        ],
    }


@router.post("/playback/{station_name}")
def playback_next(
    station_name: str,
    session: Session = Depends(get_session),
    history_session: Session = Depends(get_scada_history_session),
):
    """
    回放一步：从历史记录中取下一个时间点的数据，
    更新 scada_stations 表的实时值，模拟数据变化。
    """
    # 获取该站所有历史时间点（去重+排序）
    all_records = history_session.exec(
        select(ScadaHistory)
        .where(ScadaHistory.station_name == station_name)
        .order_by(ScadaHistory.recorded_at.desc())  # 从最新到最旧（Excel顺序）
    ).all()

    if not all_records:
        return {"msg": f"没有 {station_name} 的历史数据，请先调用 import-excel", "error": True}

    # 找出所有不重复的时间点
    time_points = sorted(set(r.recorded_at for r in all_records))

    # 获取当前回放位置
    idx = _playback_index.get(station_name, 0)
    if idx >= len(time_points):
        idx = 0  # 循环回放
    current_time = time_points[idx]

    # 取该时间点的所有测量值
    current_data = [r for r in all_records if r.recorded_at == current_time]

    # 整理成 {pipeline_id: {pressure: x, temperature: y}}
    updates = {}
    for r in current_data:
        if r.pipeline_id not in updates:
            updates[r.pipeline_id] = {}
        updates[r.pipeline_id][r.metric_type] = r.value

    # 更新 scada_stations 表中甪直站的实时值
    station = session.exec(
        select(ScadaStation).where(ScadaStation.name == station_name)
    ).first()

    result_data = {"time": current_time.isoformat(), "step": idx + 1, "total": len(time_points)}

    if station and "we1" in updates:
        we1 = updates["we1"]
        if "pressure" in we1:
            station.in_pressure = we1["pressure"]
        if "temperature" in we1:
            station.in_temp = we1["temperature"]
        station.updated_at = current_time
        session.add(station)
        result_data["we1_pressure"] = we1.get("pressure")
        result_data["we1_temp"] = we1.get("temperature")

    # 返回所有管线的数据
    for pid, vals in updates.items():
        result_data[f"{pid}_pressure"] = vals.get("pressure")
        result_data[f"{pid}_temp"] = vals.get("temperature")

    session.commit()

    # 推进回放指针
    _playback_index[station_name] = idx + 1

    return {"msg": f"回放至 {current_time.strftime('%m-%d %H:%M')}", **result_data}


@router.get("/history/{station_name}")
def get_history(station_name: str, pipeline_id: str = "we1", metric_type: str = "pressure",
                session: Session = Depends(get_scada_history_session)):
    """获取指定站场的历史时序数据（前端画趋势曲线用）"""
    records = session.exec(
        select(ScadaHistory)
        .where(
            ScadaHistory.station_name == station_name,
            ScadaHistory.pipeline_id == pipeline_id,
            ScadaHistory.metric_type == metric_type,
        )
        .order_by(ScadaHistory.recorded_at)
    ).all()

    return {
        "station": station_name,
        "pipeline": pipeline_id,
        "metric": metric_type,
        "count": len(records),
        "data": [
            {"time": r.recorded_at.isoformat(), "value": r.value}
            for r in records
        ],
    }


@router.get("/history-by-id")
def get_history_by_id(
    station_id: Optional[str] = Query(None, description="站场名称或站场ID"),
    junction_id: Optional[str] = Query(None, description="枢纽ID，支持 17 或 JUNCTION-17"),
    hours: int = 6,
    session: Session = Depends(get_scada_history_session),
    main_session: Session = Depends(get_session),
):
    """
    通用历史时序查询（供 AI 工具和前端 ECharts 使用）。
    按 station_name 和时间范围查询，返回所有指标的合并数据。
    
    参数：
    - station_id: 单站查询，支持站场名称或站场 ID
    - junction_id: 枢纽查询，返回枢纽内各物理站多条曲线
    - hours: 回溯小时数，默认 6
    """
    from datetime import timedelta

    if not station_id and not junction_id:
        return {
            "station": None,
            "hours": hours,
            "count": 0,
            "series": {},
            "seriesMeta": {},
            "targetType": "unknown",
        }

    # 计算时间范围
    now = datetime.now()
    since = now - timedelta(hours=hours)

    def _normalize_junction_id(raw_id: str) -> Optional[int]:
        raw = str(raw_id).strip()
        if not raw:
            return None
        if raw.upper().startswith("JUNCTION-"):
            raw = raw.split("-", 1)[1]
        try:
            return int(raw)
        except Exception:
            return None

    target_station_names: List[str] = []
    target_label = station_id or junction_id or ""
    target_type = "station"

    if junction_id:
        normalized_junction_id = _normalize_junction_id(junction_id)
        groups = load_runtime_junction_groups(main_session)
        group = next((item for item in groups if item["id"] == normalized_junction_id), None)
        if group:
            target_type = "junction"
            target_label = group["name"]
            station_ids = group["station_ids"]
            station_rows = main_session.exec(select(Station).where(Station.id.in_(station_ids))).all() if station_ids else []
            station_name_map = {row.id: row.name for row in station_rows}
            target_station_names = [station_name_map[sid] for sid in station_ids if sid in station_name_map]

    if not target_station_names and station_id:
        station_row = main_session.get(Station, station_id)
        if station_row:
            target_station_names = [station_row.name]
            target_label = station_row.name
        else:
            target_station_names = [station_id]

    records = []
    if target_station_names:
        records = session.exec(
            select(ScadaHistory)
            .where(
                ScadaHistory.station_name.in_(target_station_names),
                ScadaHistory.recorded_at >= since,
            )
            .order_by(ScadaHistory.recorded_at)
        ).all()

        if not records:
            records = session.exec(
                select(ScadaHistory)
                .where(ScadaHistory.station_name.in_(target_station_names))
                .order_by(ScadaHistory.recorded_at)
            ).all()

    if not records:
        return {
            "station": target_label,
            "hours": hours,
            "count": 0,
            "series": {},
            "seriesMeta": {},
            "targetType": target_type,
        }

    series: dict[str, list] = {}
    series_meta: dict[str, dict] = {}
    for r in records:
        key = f"{r.station_name}__{r.pipeline_id}_{r.metric_type}"
        if key not in series:
            series[key] = []
            series_meta[key] = {
                "label": f"{r.station_name} · {r.pipeline_id.upper()} · {r.metric_type}",
                "stationName": r.station_name,
                "pipelineId": r.pipeline_id,
                "metricType": r.metric_type,
            }
        series[key].append({
            "time": r.recorded_at.isoformat(),
            "value": r.value,
        })

    return {
        "station": target_label,
        "hours": hours,
        "count": len(records),
        "series": series,
        "seriesMeta": series_meta,
        "targetType": target_type,
    }
