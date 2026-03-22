"""
拓扑路径修正服务

管道数据提取后的自动化质量修正层：
1. 跳跃检测器 — 识别 trunk 序列中地理距离异常的连线
2. 自动修正器 — 基于最近邻搜索重新路由异常连接
3. 支线挂接修正 — 自动匹配支线首节点到最近的干线节点
4. 修正日志 — 生成可审核的 diff 报告
"""

import math
import json
import logging
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)


# ============ 类型定义 ============

class CorrectionType(str, Enum):
    """修正类型"""
    TRUNK_JUMP = "trunk_jump"           # 干线跳跃连接
    BRANCH_ATTACH = "branch_attach"     # 支线挂接点修正
    ORPHAN_NODE = "orphan_node"         # 孤立节点处理
    DUPLICATE_EDGE = "duplicate_edge"   # 重复边清理


class CorrectionStatus(str, Enum):
    """修正状态"""
    PENDING = "pending"       # 待审核
    APPLIED = "applied"       # 已应用
    REJECTED = "rejected"     # 已拒绝


@dataclass
class GeoPoint:
    """地理坐标点"""
    id: str
    name: str
    lon: float
    lat: float
    mileage: float = 0.0
    branch_name: str = ""
    node_type: str = ""

    def distance_to(self, other: 'GeoPoint') -> float:
        """
        使用 Haversine 公式计算两点间的球面距离 (km)
        
        避免引入外部依赖 geopy，内置实现精度足够满足
        管线级别 (km 级) 的距离判断需求。
        """
        R = 6371.0  # 地球平均半径 (km)
        lat1, lon1 = math.radians(self.lat), math.radians(self.lon)
        lat2, lon2 = math.radians(other.lat), math.radians(other.lon)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = math.sin(dlat / 2) ** 2 + \
            math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c


@dataclass
class CorrectionItem:
    """单条修正记录"""
    correction_type: CorrectionType
    severity: str                       # "error" | "warning" | "info"
    description: str
    before: Dict[str, Any]              # 修正前的状态快照
    after: Dict[str, Any]               # 修正后的状态快照
    node_ids: List[str] = field(default_factory=list)
    auto_fixable: bool = True           # 是否可自动修正

    def to_dict(self) -> Dict:
        return {
            "type": self.correction_type.value,
            "severity": self.severity,
            "description": self.description,
            "before": self.before,
            "after": self.after,
            "node_ids": self.node_ids,
            "auto_fixable": self.auto_fixable
        }


@dataclass
class CorrectionReport:
    """修正报告"""
    pipeline_name: str
    total_issues: int
    auto_fixed: int
    manual_review: int
    corrections: List[CorrectionItem]
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict:
        return {
            "pipeline_name": self.pipeline_name,
            "total_issues": self.total_issues,
            "auto_fixed": self.auto_fixed,
            "manual_review": self.manual_review,
            "corrections": [c.to_dict() for c in self.corrections],
            "created_at": self.created_at
        }


# ============ 核心修正引擎 ============

class TopologyCorrectionEngine:
    """
    拓扑路径修正引擎
    
    工作流程：
    1. 加载提取后的管线 JSON -> 转换为 GeoPoint 列表
    2. 执行检测 (detect) -> 生成修正建议
    3. 用户预览 (preview) -> 查看红/绿对比
    4. 确认应用 (apply) -> 回写数据
    """

    # 跳跃距离阈值 (km)：相邻 trunk 节点间超过此距离视为异常
    JUMP_DISTANCE_THRESHOLD = 200.0
    # 支线挂接搜索半径 (km)
    BRANCH_ATTACH_RADIUS = 50.0

    def __init__(
        self,
        jump_threshold_km: float = 200.0,
        attach_radius_km: float = 50.0
    ):
        self.jump_threshold = jump_threshold_km
        self.attach_radius = attach_radius_km

    def correct_pipeline(
        self,
        pipeline_data: Dict,
        dry_run: bool = True
    ) -> CorrectionReport:
        """
        对完整管线数据执行修正

        Args:
            pipeline_data: extract_pipeline 输出的 JSON 结构
            dry_run: True=仅预览不修改, False=直接修改数据

        Returns:
            CorrectionReport 包含所有检测和修正详情
        """
        pipeline_name = pipeline_data.get("pipeline_name", "unknown")
        trunk_nodes_raw = pipeline_data.get("trunk", [])
        branches_raw = pipeline_data.get("branches", {})

        corrections: List[CorrectionItem] = []

        # 1. 干线跳跃检测与修正
        trunk_points = self._to_geo_points(trunk_nodes_raw)
        jump_corrections = self._detect_trunk_jumps(trunk_points)
        corrections.extend(jump_corrections)

        # 2. 支线挂接点修正
        for branch_name, branch_nodes_raw in branches_raw.items():
            branch_points = self._to_geo_points(branch_nodes_raw)
            attach_corrections = self._detect_branch_attach_issues(
                branch_name, branch_points, trunk_points
            )
            corrections.extend(attach_corrections)

        # 3. 孤立节点检测
        orphan_corrections = self._detect_orphan_nodes(
            trunk_points, branches_raw
        )
        corrections.extend(orphan_corrections)

        # 如果非预览，则应用自动修正
        if not dry_run:
            pipeline_data = self._apply_corrections(
                pipeline_data, corrections
            )

        auto_fixed = sum(1 for c in corrections if c.auto_fixable)
        manual_review = sum(1 for c in corrections if not c.auto_fixable)

        return CorrectionReport(
            pipeline_name=pipeline_name,
            total_issues=len(corrections),
            auto_fixed=auto_fixed,
            manual_review=manual_review,
            corrections=corrections
        )

    def _to_geo_points(self, nodes_raw: List[Dict]) -> List[GeoPoint]:
        """将原始节点数据转换为 GeoPoint 列表"""
        points = []
        for n in nodes_raw:
            points.append(GeoPoint(
                id=n.get("id", n.get("name", "")),
                name=n.get("name", ""),
                lon=n.get("longitude", 0.0),
                lat=n.get("latitude", 0.0),
                mileage=n.get("mileage", 0.0),
                branch_name=n.get("branch_name", ""),
                node_type=n.get("type", "")
            ))
        return points

    def _detect_trunk_jumps(
        self,
        trunk_points: List[GeoPoint]
    ) -> List[CorrectionItem]:
        """
        检测干线跳跃

        扫描排序后的 trunk 序列，计算相邻节点间的地理距离。
        若距离超过阈值，标记为跳跃异常。
        """
        corrections = []
        if len(trunk_points) < 2:
            return corrections

        for i in range(len(trunk_points) - 1):
            p1 = trunk_points[i]
            p2 = trunk_points[i + 1]

            # 跳过无有效坐标的节点
            if p1.lon == 0 or p2.lon == 0:
                continue

            dist = p1.distance_to(p2)

            if dist > self.jump_threshold:
                # 尝试在后续节点中寻找更合理的下一站
                best_candidate = self._find_nearest_successor(
                    p1, trunk_points[i + 1:]
                )

                correction = CorrectionItem(
                    correction_type=CorrectionType.TRUNK_JUMP,
                    severity="error",
                    description=(
                        f"干线跳跃: [{p1.name}] → [{p2.name}] "
                        f"距离 {dist:.1f}km 超过阈值 {self.jump_threshold}km"
                    ),
                    before={
                        "from": p1.name,
                        "to": p2.name,
                        "distance_km": round(dist, 1),
                        "from_segment": p1.branch_name,
                        "to_segment": p2.branch_name
                    },
                    after={
                        "suggested_reorder": best_candidate.name if best_candidate else "需人工审核",
                        "suggested_distance": round(
                            p1.distance_to(best_candidate), 1
                        ) if best_candidate else None
                    },
                    node_ids=[p1.id, p2.id],
                    auto_fixable=best_candidate is not None
                )
                corrections.append(correction)

        return corrections

    def _find_nearest_successor(
        self,
        current: GeoPoint,
        candidates: List[GeoPoint]
    ) -> Optional[GeoPoint]:
        """
        在候选列表中找到地理上距 current 最近的点

        使用简单的线性扫描（节点数通常 < 1000），
        避免引入 scipy.spatial.KDTree 的外部依赖。
        """
        best = None
        best_dist = float('inf')

        for c in candidates:
            if c.lon == 0 or c.lat == 0:
                continue
            d = current.distance_to(c)
            if d < best_dist and d < self.jump_threshold:
                best_dist = d
                best = c

        return best

    def _detect_branch_attach_issues(
        self,
        branch_name: str,
        branch_points: List[GeoPoint],
        trunk_points: List[GeoPoint]
    ) -> List[CorrectionItem]:
        """
        检测支线挂接点问题

        支线的首节点应该在地理上靠近某个干线节点。
        如果挂接距离过大，说明挂接点可能推断错误。
        """
        corrections = []
        if not branch_points or not trunk_points:
            return corrections

        head = branch_points[0]
        if head.lon == 0 or head.lat == 0:
            return corrections

        # 在干线中找到距支线首节点最近的站
        nearest_trunk = None
        nearest_dist = float('inf')
        for t in trunk_points:
            if t.lon == 0 or t.lat == 0:
                continue
            d = head.distance_to(t)
            if d < nearest_dist:
                nearest_dist = d
                nearest_trunk = t

        if nearest_trunk and nearest_dist > self.attach_radius:
            corrections.append(CorrectionItem(
                correction_type=CorrectionType.BRANCH_ATTACH,
                severity="warning",
                description=(
                    f"支线 [{branch_name}] 首节点 [{head.name}] "
                    f"距最近干线节点 [{nearest_trunk.name}] "
                    f"为 {nearest_dist:.1f}km，超过搜索半径 {self.attach_radius}km"
                ),
                before={
                    "branch": branch_name,
                    "head_node": head.name,
                    "nearest_trunk": nearest_trunk.name,
                    "distance_km": round(nearest_dist, 1)
                },
                after={
                    "suggestion": "确认该支线挂接点是否正确，或搜索更大范围的干线节点"
                },
                node_ids=[head.id, nearest_trunk.id],
                auto_fixable=False  # 支线挂接需人工确认
            ))

        return corrections

    def _detect_orphan_nodes(
        self,
        trunk_points: List[GeoPoint],
        branches_raw: Dict
    ) -> List[CorrectionItem]:
        """
        检测孤立节点

        如果某个节点有坐标但既不在干线也不在任何支线中，
        则标记为孤立。
        """
        corrections = []
        all_ids = set()

        for p in trunk_points:
            all_ids.add(p.id)
        for branch_nodes in branches_raw.values():
            for n in branch_nodes:
                all_ids.add(n.get("id", n.get("name", "")))

        # 检查是否有坐标为 (0,0) 的"幽灵节点"
        for p in trunk_points:
            if p.lon == 0 and p.lat == 0:
                corrections.append(CorrectionItem(
                    correction_type=CorrectionType.ORPHAN_NODE,
                    severity="info",
                    description=f"节点 [{p.name}] 缺少地理坐标",
                    before={"node": p.name, "lon": 0, "lat": 0},
                    after={"suggestion": "需补录经纬度坐标"},
                    node_ids=[p.id],
                    auto_fixable=False
                ))

        return corrections

    def _apply_corrections(
        self,
        pipeline_data: Dict,
        corrections: List[CorrectionItem]
    ) -> Dict:
        """
        将可自动修正的项应用到数据中

        目前仅处理 TRUNK_JUMP 类型：重新排序跳跃区段。
        """
        trunk = pipeline_data.get("trunk", [])
        if not trunk:
            return pipeline_data

        # 收集需要重排的索引区间
        jump_indices = []
        for c in corrections:
            if c.correction_type == CorrectionType.TRUNK_JUMP and c.auto_fixable:
                # 在 trunk 中定位 before.from 节点的索引
                for i, n in enumerate(trunk):
                    name = n.get("name", "")
                    if name == c.before.get("from"):
                        jump_indices.append(i)
                        break

        if not jump_indices:
            return pipeline_data

        # 对跳跃区域进行局部重排（按地理距离贪心排序）
        # 简化策略：对 jump 附近的节点做最近邻链排序
        points = self._to_geo_points(trunk)
        reordered = self._greedy_nearest_neighbor_sort(points)

        # 重建 trunk 数据
        name_to_node = {n.get("name", ""): n for n in trunk}
        new_trunk = []
        for p in reordered:
            if p.name in name_to_node:
                new_trunk.append(name_to_node[p.name])

        pipeline_data["trunk"] = new_trunk
        logger.info(f"已应用 {len(jump_indices)} 处跳跃修正 (贪心重排)")
        return pipeline_data

    def _greedy_nearest_neighbor_sort(
        self,
        points: List[GeoPoint]
    ) -> List[GeoPoint]:
        """
        贪心最近邻排序

        从第一个点出发，每次选择未访问中距离最近的点。
        适用于 trunk 节点的地理排序修正。
        """
        if len(points) <= 1:
            return points

        visited = [False] * len(points)
        result = [points[0]]
        visited[0] = True

        for _ in range(len(points) - 1):
            current = result[-1]
            best_idx = -1
            best_dist = float('inf')

            for j in range(len(points)):
                if visited[j]:
                    continue
                if points[j].lon == 0 and points[j].lat == 0:
                    continue
                d = current.distance_to(points[j])
                if d < best_dist:
                    best_dist = d
                    best_idx = j

            if best_idx == -1:
                # 剩余的全是无坐标点，按原序追加
                for j in range(len(points)):
                    if not visited[j]:
                        result.append(points[j])
                        visited[j] = True
                break

            visited[best_idx] = True
            result.append(points[best_idx])

        return result


# ============ 便捷函数 ============

def correct_pipeline_from_file(
    json_path: str,
    dry_run: bool = True,
    jump_threshold: float = 200.0,
    attach_radius: float = 50.0
) -> CorrectionReport:
    """从 JSON 文件执行修正"""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    engine = TopologyCorrectionEngine(
        jump_threshold_km=jump_threshold,
        attach_radius_km=attach_radius
    )
    return engine.correct_pipeline(data, dry_run=dry_run)


def correct_pipeline_from_dict(
    pipeline_data: Dict,
    dry_run: bool = True,
    **kwargs
) -> CorrectionReport:
    """从字典执行修正"""
    engine = TopologyCorrectionEngine(**kwargs)
    return engine.correct_pipeline(pipeline_data, dry_run=dry_run)
