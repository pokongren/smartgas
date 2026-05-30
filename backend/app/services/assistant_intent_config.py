from __future__ import annotations


COMMON_METRIC_TERM_CORRECTIONS = {
    "水路点": "水露点",
    "水漏点": "水露点",
    "水落点": "水露点",
    "水陆点": "水露点",
}

DEWPOINT_QUERY_KEYWORDS = ("水露点", "露点", "dewpoint", *COMMON_METRIC_TERM_CORRECTIONS.keys())
PRESSURE_KEYWORDS = ("压力", "pressure", "MPa", "mpa")
TEMPERATURE_KEYWORDS = ("温度", "温层", "temperature")
HISTORY_STATION_REFERENCE_KEYWORDS = ("站", "中卫", "甪直", "压气", "分输", "联络")
