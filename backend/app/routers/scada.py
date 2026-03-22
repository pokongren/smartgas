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

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session, engine
from app.scada_models import ScadaStation, ScadaHistory

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


@router.post("/import-excel")
def import_excel(session: Session = Depends(get_session)):
    """
    导入甪直站 Excel 数据到 scada_history 表。
    解析 PI tag 列，提取西一线/西二线/中俄线的压力和温度时序数据。
    """
    import openpyxl

    excel_path = r'C:\Users\Administrator\Downloads\甪直站20262311-0312.xlsx'
    wb = openpyxl.load_workbook(excel_path)
    ws = wb.active

    # 先清除旧数据
    old = session.exec(select(ScadaHistory).where(ScadaHistory.station_name == "甪直分输站")).all()
    for row in old:
        session.delete(row)
    session.commit()

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
                recorded_at=recorded,
                value=float(value),
            )
            session.add(record)
            count += 1

    session.commit()

    # 重置回放指针
    _playback_index["甪直分输站"] = 0

    return {"msg": f"甪直站导入完成：{count} 条历史记录", "count": count, "rows": ws.max_row - 2}


@router.post("/playback/{station_name}")
def playback_next(station_name: str, session: Session = Depends(get_session)):
    """
    回放一步：从历史记录中取下一个时间点的数据，
    更新 scada_stations 表的实时值，模拟数据变化。
    """
    # 获取该站所有历史时间点（去重+排序）
    all_records = session.exec(
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
                session: Session = Depends(get_session)):
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
