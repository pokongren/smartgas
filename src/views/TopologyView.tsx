import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import '../styles/topology-view.css';
import { loadAllPipelines } from '@/data/pipelines';
import type { PipelinePackage } from '@/data/pipelines/types';
import { resolveApiPath } from '@/services/apiBase';
import { findIsolatedNodes, computeBetweennessCentrality, countComponents } from '@/utils/topology-validator';
import { useSimulation } from '@/hooks/useSimulation';
import { SimPanel } from '@/components/topology/SimPanel';
import {
    DEFAULT_WE1_PILOT_ID,
    resolveSimulationPilotConfig,
} from '@/types/simulation';
import type { SimulationOverlay } from '@/types/simulation';
import { readSimulationShowcaseSyncContext } from '@/utils/simulationShowcaseSync';
import { useLocation, useNavigate } from 'react-router-dom';

// ============ 类型定义 ============

interface TopoNode {
    id: string;
    name: string;
    type: string;
    longitude: number;
    latitude: number;
    designPressure: number | null;
    capacity: number | null;
    hasConnection: boolean;
    // 力导向布局运行时属性
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null;
    fy: number | null;
    properties?: Record<string, any> | null;
}

interface TopoEdge {
    id: string;
    name: string;
    source: string;
    target: string;
    category: string;
    diameterMm: number | null;
    lengthKm: number;
}

interface TopoData {
    nodes: TopoNode[];
    edges: TopoEdge[];
    isolatedNodes: string[];
    criticalNodes: string[];
    stats: {
        nodeCount: number;
        edgeCount: number;
        isolatedCount: number;
        componentCount: number;
    };
}

interface CanvasPoint {
    x: number;
    y: number;
}

const INTERNAL_TOPOLOGY_DEBUG_KEY = 'smartgas-grid:topology-internal-debug';

interface ViewportState {
    zoom: number;
    pan: CanvasPoint;
}

type TouchGestureState =
    | { mode: 'none' }
    | { mode: 'pan'; touchId: number; startTouch: CanvasPoint; startPan: CanvasPoint }
    | { mode: 'drag-node'; touchId: number; node: TopoNode }
    | {
        mode: 'pinch';
        touchIds: [number, number];
        startZoom: number;
        anchorWorld: CanvasPoint;
        startDistance: number;
    };

// ============ 常量 ============

// 从监控系统截图中提取的西一线真实 SCADA 运行基准数据
const REAL_SCADA_DATA: Record<string, { inP: number, outP: number, inT?: number, outT?: number }> = {
    '中卫压气站': { inP: 6.391, outP: 7.856, inT: 7.7, outT: 30.8 },
    '盐池压气站': { inP: 7.133, outP: 7.092, inT: 10.3, outT: 10.2 },
    '靖边压气站': { inP: 6.681, outP: 8.947, inT: 5.7, outT: 34.9 },
    '子长分输站': { inP: 8.098, outP: 8.098, inT: 19.9, outT: 19.9 },
    '延川压气站': { inP: 7.880, outP: 9.175, inT: 21.4, outT: 31.9 },
    '沁水压气站': { inP: 6.889, outP: 8.762, inT: 18.0, outT: 39.4 },
    '阳城清管站': { inP: 7.936, outP: 7.912, inT: 16.4, outT: 16.4 },
    '博爱分输站': { inP: 7.118, outP: 7.126, outT: 26.2 },
    '郑州压气站': { inP: 6.166, outP: 7.830, inT: 20.1, outT: 41.9 },
    '薛店分输站': { inP: 7.273, outP: 7.273, outT: 34.8 },
    '淮阳压气站': { inP: 5.726, outP: 7.766, inT: 18.4, outT: 45.0 },
    '利辛分输站': { inP: 6.354, outP: 6.232, inT: 21.6, outT: 16.9 },
    '定远压气站': { inP: 4.818, outP: 6.245, inT: 12.8, outT: 35.0 },
    '龙池分输站': { inP: 6.005, outP: 6.002, outT: 19.3 },
    '龙源分输站': { inP: 5.971, outP: 5.590, outT: 20.4 },
    '镇江分输站': { inP: 5.573, outP: 5.575, outT: 14.9 },
    '常州分输站': { inP: 5.255, outP: 5.248, outT: 13.4 },
    '芙蓉分输站': { inP: 5.167, outP: 5.162, inT: 15.9, outT: 5.2 },
    '徐霞客分输站': { inP: 0.000, outP: 0.001, inT: 19.0, outT: 18.4 },
    '无锡分输站': { inP: 4.244, outP: 5.101, outT: 12.2 },
    '东桥分输站': { inP: 5.092, outP: 5.087, outT: 12.7 },
    '苏州分输站': { inP: 5.078, outP: 5.089, outT: 15.5 },
    '甪直分输站': { inP: 5.094, outP: 5.106, outT: 7.9 },
    '昆山分输站': { inP: 5.073, outP: 5.065, outT: 12.4 },
    '上海白鹤末站': { inP: 5.050, outP: 5.050, outT: 13.7 },
}

function estimateNodeTemperatureC(pressureMpa: number): number {
    return Number((13 + pressureMpa * 1.7).toFixed(1));
}

const NODE_COLORS: Record<string, string> = {
    compressor: '#f97316',
    distribution: '#3b82f6',
    valve: '#6b7280',
    other: '#a855f7',
    source: '#ef4444',
    shared: '#8b5cf6',
    default: '#a3a3a3',
};

const NODE_TYPE_LABELS: Record<string, string> = {
    compressor: '压气站',
    distribution: '分输站',
    valve: '阀室',
    other: '其他',
    source: '气源站',
    shared: '转供站',
};

const EDGE_COLORS: Record<string, string> = {
    trunk: '#34d399',
    branch: '#60a5fa',
    default: '#475569',
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const NODE_RADIUS = 16;
const CRITICAL_RADIUS = 22;

function clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function getCanvasDisplaySize(canvas: HTMLCanvasElement | null): { width: number; height: number } {
    if (!canvas) {
        return { width: window.innerWidth, height: window.innerHeight };
    }

    const rect = canvas.getBoundingClientRect();
    return {
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight,
    };
}

function getTouchPoint(touch: Touch, rect: DOMRect): CanvasPoint {
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
    };
}

function getTouchMetrics(touches: TouchList, rect: DOMRect): { center: CanvasPoint; distance: number } | null {
    if (touches.length < 2) return null;

    const first = getTouchPoint(touches[0], rect);
    const second = getTouchPoint(touches[1], rect);

    return {
        center: {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        },
        distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
}

function screenToWorldWithViewport(
    sx: number,
    sy: number,
    zoom: number,
    pan: CanvasPoint,
): CanvasPoint {
    return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
}

// ============ 力导向布局引擎 ============

function simulateForces(
    nodes: TopoNode[],
    edges: TopoEdge[],
    width: number,
    height: number,
    alpha: number
): void {
    const repulsion = 6000;
    const springLength = 100;
    const springStrength = 0.005;
    const gravity = 0.03;
    const damping = 0.85;

    // 排斥力
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const distSq = dx * dx + dy * dy + 1;
            const force = (repulsion * alpha) / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
        }
    }

    // 弹簧力
    const nodeMap = new Map<string, TopoNode>();
    for (const n of nodes) nodeMap.set(n.id, n);
    for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - springLength) * springStrength * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
    }

    // 中心引力
    const cx = width / 2;
    const cy = height / 2;
    for (const n of nodes) {
        n.vx += (cx - n.x) * gravity * alpha;
        n.vy += (cy - n.y) * gravity * alpha;
    }

    // 更新位置
    for (const n of nodes) {
        if (n.fx !== null) {
            n.x = n.fx;
            n.y = n.fy!;
            n.vx = 0;
            n.vy = 0;
        } else {
            n.vx *= damping;
            n.vy *= damping;
            n.x += n.vx;
            n.y += n.vy;
            n.x = Math.max(30, Math.min(width - 30, n.x));
            n.y = Math.max(80, Math.min(height - 30, n.y));
        }
    }
}

// ============ Canvas 绘制 ============

function drawGraph(
    ctx: CanvasRenderingContext2D,
    nodes: TopoNode[],
    edges: TopoEdge[],
    criticalSet: Set<string>,
    hoveredNodeId: string | null,
    selectedNodeIds: Set<string>,
    searchMatchIds: Set<string>,
    width: number,
    height: number,
    zoom: number,
    panX: number,
    panY: number,
    simOverlay?: SimulationOverlay | null,
    animationMs = 0,
): void {
    const simEdgeMap = new Map(simOverlay?.edges.map(e => [e.id, e]) ?? []);
    const simNodeMap = new Map(simOverlay?.nodes.map(n => [n.id, n]) ?? []);
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // 应用缩放和平移
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // 背景网格
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.05)';
    ctx.lineWidth = 1 / zoom;
    const gridSize = 50;
    const startX = -panX / zoom;
    const startY = -panY / zoom;
    const endX = startX + width / zoom;
    const endY = startY + height / zoom;
    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }

    const nodeMap = new Map<string, TopoNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // 画边
    for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        const simEdge = simEdgeMap.get(edge.id);
        const color = simEdge ? simEdge.color : (EDGE_COLORS[edge.category] || EDGE_COLORS.default);
        const baseW = edge.category === 'trunk' ? 3 : 1.5;
        const isRev = simEdge?.direction === 'reverse';
        const flowStart = isRev ? target : source;
        const flowEnd = isRev ? source : target;
        const flowDx = flowEnd.x - flowStart.x;
        const flowDy = flowEnd.y - flowStart.y;
        const flowLen = Math.hypot(flowDx, flowDy);
        ctx.strokeStyle = color;
        ctx.lineWidth = (simEdge ? baseW * simEdge.width_factor : baseW) / zoom;
        ctx.globalAlpha = simEdge ? 0.85 : 0.6;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        const angle = isRev
            ? Math.atan2(source.y - target.y, source.x - target.x)
            : Math.atan2(target.y - source.y, target.x - source.x);
        const arrowLen = 8 / zoom;
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        if (simEdge && simEdge.flow_rate > 0 && flowLen > 1) {
            const speed = 0.18 + Math.min(simEdge.utilization, 1) * 0.45;
            const pulseT = (animationMs / 1000) * speed;
            const tracerRadius = (edge.category === 'trunk' ? 3.6 : 2.6) / zoom;
            const tracerOffsets = [pulseT % 1, (pulseT + 0.45) % 1];
            ctx.save();
            tracerOffsets.forEach((offset, index) => {
                const tx = flowStart.x + flowDx * offset;
                const ty = flowStart.y + flowDy * offset;
                const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, tracerRadius * 3.6);
                glow.addColorStop(0, `${color}ee`);
                glow.addColorStop(0.4, `${color}88`);
                glow.addColorStop(1, `${color}00`);
                ctx.fillStyle = glow;
                ctx.globalAlpha = index === 0 ? 0.92 : 0.56;
                ctx.beginPath();
                ctx.arc(tx, ty, tracerRadius * 3.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#f8fafc';
                ctx.globalAlpha = index === 0 ? 0.95 : 0.72;
                ctx.beginPath();
                ctx.arc(tx, ty, tracerRadius, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(midX + arrowLen * Math.cos(angle), midY + arrowLen * Math.sin(angle));
        ctx.lineTo(midX + arrowLen * Math.cos(angle + 2.5), midY + arrowLen * Math.sin(angle + 2.5));
        ctx.lineTo(midX + arrowLen * Math.cos(angle - 2.5), midY + arrowLen * Math.sin(angle - 2.5));
        ctx.closePath();
        ctx.fill();
        if (simEdge && simEdge.flow_rate > 0 && zoom > 0.8) {
            ctx.font = `${8 / zoom}px Inter, sans-serif`;
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.9;
            ctx.textAlign = 'center';
            ctx.fillText(`${simEdge.flow_rate.toFixed(0)}`, midX, midY - 8 / zoom);
        }
        ctx.globalAlpha = 1;
    }

    // 画节点
    for (const node of nodes) {
        const isCritical = criticalSet.has(node.id);
        const isHovered = hoveredNodeId === node.id;
        const isSelected = selectedNodeIds.has(node.id);
        const isSearchMatch = searchMatchIds.has(node.id);
        const baseColor = NODE_COLORS[node.type] || NODE_COLORS.default;
        const radius = isCritical ? CRITICAL_RADIUS : NODE_RADIUS;
        const isIsolated = !node.hasConnection;

        // 搜索高亮光圈
        if (isSearchMatch) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 10, 0, Math.PI * 2);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 3 / zoom;
            ctx.setLineDash([]);
            ctx.stroke();
            const g = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, radius + 18);
            g.addColorStop(0, 'rgba(34, 211, 238, 0.2)');
            g.addColorStop(1, 'rgba(34, 211, 238, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 18, 0, Math.PI * 2);
            ctx.fill();
        }

        // 关键节点金色外圈
        if (isCritical) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5 / zoom;
            ctx.setLineDash([]);
            ctx.stroke();
        }

        // 孤立节点红色虚线圈
        if (isIsolated) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#f87171';
            ctx.lineWidth = 1.5 / zoom;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 选中/hover 高亮
        if (isSelected || isHovered) {
            const g = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, radius + 10);
            g.addColorStop(0, `${baseColor}55`);
            g.addColorStop(1, `${baseColor}00`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 10, 0, Math.PI * 2);
            ctx.fill();
        }

        // 节点主体
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isSelected ? '#ffffff' : `${baseColor}88`;
        ctx.lineWidth = (isSelected ? 2.5 : 1) / zoom;
        ctx.setLineDash([]);
        ctx.stroke();

        // 类型首字
        const typeChar = NODE_TYPE_LABELS[node.type]?.[0] || '?';
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${(isCritical ? 12 : 10) / zoom}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(typeChar, node.x, node.y);

        // 名称（hover/选中/搜索匹配/关键节点时显示）
        if (isHovered || isSelected || isSearchMatch || isCritical) {
            ctx.fillStyle = isSearchMatch ? '#22d3ee' : '#e2e8f0';
            ctx.font = `${11 / zoom}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(node.name, node.x, node.y + radius + 12 / zoom);
        }

        // 仿真压力标签 / SCADA 历史数据（互斥显示）
        const simNode = simNodeMap.get(node.id);
        if (simNode) {
            if (simNode.alert_level !== 'normal') {
                const ac = simNode.alert_level === 'critical' ? '#ef4444' : '#f97316';
                const pulse = (Math.sin(animationMs / (simNode.alert_level === 'critical' ? 180 : 260)) + 1) / 2;
                const alertRadius = radius + 6 + (simNode.alert_level === 'critical' ? 4 : 2.5) * pulse;
                const alertGlow = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, alertRadius + 7);
                alertGlow.addColorStop(0, `${ac}22`);
                alertGlow.addColorStop(0.55, `${ac}${simNode.alert_level === 'critical' ? '30' : '22'}`);
                alertGlow.addColorStop(1, `${ac}00`);
                ctx.fillStyle = alertGlow;
                ctx.globalAlpha = simNode.alert_level === 'critical' ? 0.72 : 0.5;
                ctx.beginPath();
                ctx.arc(node.x, node.y, alertRadius + 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(node.x, node.y, alertRadius, 0, Math.PI * 2);
                ctx.strokeStyle = ac;
                ctx.lineWidth = (simNode.alert_level === 'critical' ? 2.4 : 1.8) / zoom;
                ctx.setLineDash(simNode.alert_level === 'critical' ? [2, 2] : [3, 2]);
                ctx.globalAlpha = 0.6 + pulse * 0.35;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            }
            const pc = simNode.alert_level === 'critical' ? '#f87171' : simNode.alert_level === 'warning' ? '#fdba74' : '#34d399';
            const pressureIn = simNode.pressure_in_mpa ?? simNode.pressure_mpa;
            const pressureOut = simNode.pressure_mpa;
            const pressureDelta = pressureOut - pressureIn;
            ctx.textAlign = 'center';
            ctx.font = `bold ${9 / zoom}px Inter, sans-serif`;
            ctx.fillStyle = pc;
            ctx.fillText(`进:${pressureIn.toFixed(2)} 出:${pressureOut.toFixed(2)}`, node.x, node.y - radius - 24 / zoom);
            ctx.font = `${8 / zoom}px Inter, sans-serif`;
            ctx.fillText(`Δ:${pressureDelta >= 0 ? '+' : ''}${pressureDelta.toFixed(2)} MPa`, node.x, node.y - radius - 14 / zoom);
            const nodeTemp = simNode.temperature_c ?? estimateNodeTemperatureC(pressureOut);
            ctx.font = `${8 / zoom}px Inter, sans-serif`;
            ctx.fillStyle = '#93c5fd';
            ctx.fillText(`T:${nodeTemp.toFixed(1)}°C`, node.x, node.y - radius - 4 / zoom);
        } else {
            const scadaData = REAL_SCADA_DATA[node.name];
            if (scadaData) {
                const inText = `入 P:${scadaData.inP.toFixed(2)} ${scadaData.inT ? `T:${scadaData.inT}` : ''}`;
                const outText = `出 P:${scadaData.outP.toFixed(2)} ${scadaData.outT ? `T:${scadaData.outT}` : ''}`;
                ctx.textAlign = 'center';
                ctx.font = `${9 / zoom}px Inter, sans-serif`;
                ctx.fillStyle = '#10b981';
                ctx.fillText(inText, node.x, node.y - radius - 14 / zoom);
                ctx.fillStyle = '#3b82f6';
                ctx.fillText(outText, node.x, node.y - radius - 4 / zoom);
            }
        }
    }

    ctx.restore();
}

// ============ 主组件 ============

const TopologyView: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const queryPilotId = useMemo(() => {
        return new URLSearchParams(location.search).get('pilotId') || DEFAULT_WE1_PILOT_ID;
    }, [location.search]);
    const activePilot = useMemo(() => resolveSimulationPilotConfig(queryPilotId), [queryPilotId]);
    const pilotId = activePilot.id;
    const scenarioOptions = activePilot.scenarios;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const nodesRef = useRef<TopoNode[]>([]);
    const edgesRef = useRef<TopoEdge[]>([]);
    const alphaRef = useRef(1);

    // 全量数据
    const [rawData, setRawData] = useState<TopoData | null>(null);
    const [loading, setLoading] = useState(true);

    // 过滤状态
    const [showCompressor, setShowCompressor] = useState(true);
    const [showDistribution, setShowDistribution] = useState(true);
    const [showValve, setShowValve] = useState(false);
    const [showOther, setShowOther] = useState(false);
    const [showIsolated, setShowIsolated] = useState(false);

    // 管线选择器
    const [selectedPipeline, setSelectedPipeline] = useState<string>('__all__');

    // 搜索
    const [searchText, setSearchText] = useState('');

    // 交互
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const selectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const [contextMenu, setContextMenu] = useState<{screenX: number, screenY: number} | null>(null);
    const [draggingNode, setDraggingNode] = useState<TopoNode | null>(null);

    // 缩放与平移
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const viewportRef = useRef<ViewportState>({ zoom: 1, pan: { x: 0, y: 0 } });
    const viewportSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });
    const hoveredNodeIdRef = useRef<string | null>(null);
    const selectedNodeIdsRef = useRef<Set<string>>(new Set());
    const searchMatchIdsRef = useRef<Set<string>>(new Set());
    const draggingNodeRef = useRef<TopoNode | null>(null);
    const touchGestureRef = useRef<TouchGestureState>({ mode: 'none' });
    const suppressClickUntilRef = useRef(0);
    const hasInitializedViewportRef = useRef(false);

    const criticalSetRef = useRef(new Set<string>());

    // ============ 获取数据（从后端 API） ============
    useEffect(() => {
        const fetchTopologyData = async () => {
            try {
                console.log('[Topology] 从后端 API 获取拓扑数据...');
                const response = await fetch(resolveApiPath('/api/topology/graph'));
                if (!response.ok) {
                    throw new Error(`API 请求失败: ${response.status}`);
                }
                const data = await response.json();

                const rawNodes: TopoNode[] = (data.nodes || []).map((n: any) => ({
                    id: n.id,
                    name: n.name,
                    type: n.type || 'other',
                    longitude: n.longitude || 0,
                    latitude: n.latitude || 0,
                    designPressure: n.designPressure || null,
                    capacity: n.capacity || null,
                    hasConnection: n.hasConnection ?? false,
                    properties: n.properties || null,
                    x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
                }));

                const rawEdges: TopoEdge[] = (data.edges || []).map((e: any) => ({
                    id: e.id,
                    name: e.name || '',
                    source: e.source,
                    target: e.target,
                    category: e.category || 'branch',
                    diameterMm: e.diameterMm || null,
                    lengthKm: e.lengthKm || 0,
                }));

                const isolatedNodes: string[] = data.isolatedNodes || [];
                const criticalNodes: string[] = data.criticalNodes || [];

                console.log(`[Topology] 从 API 获取: ${rawNodes.length} 节点, ${rawEdges.length} 边`);

                setRawData({
                    nodes: rawNodes,
                    edges: rawEdges,
                    isolatedNodes,
                    criticalNodes,
                    stats: data.stats || {
                        nodeCount: rawNodes.length,
                        edgeCount: rawEdges.length,
                        isolatedCount: isolatedNodes.length,
                        componentCount: 1,
                    },
                });
                criticalSetRef.current = new Set(criticalNodes);
                setLoading(false);
            } catch (err) {
                console.error('[Topology] API 获取失败，回退到异步加载前端数据:', err);
                // 回退逻辑：通过 loadAllPipelines 加载前端缓存数据
                fallbackToFrontendData();
            }
        };

        // 回退到前端数据的逻辑（API 失败时使用）
        const fallbackToFrontendData = async () => {
            try {
                const pipelinePackages = await loadAllPipelines()
                const rawNodes: TopoNode[] = [];
                const rawEdges: TopoEdge[] = [];
                const seenNodes = new Set<string>();
                const seenEdges = new Set<string>();

                pipelinePackages.forEach(pkg => {
                    pkg.layers.forEach(layer => {
                        layer.nodes.forEach((n: any) => {
                            if (!seenNodes.has(n.id)) {
                                seenNodes.add(n.id);
                                rawNodes.push({
                                    id: n.id,
                                    name: n.name,
                                    type: n.type || 'other',
                                    longitude: n.coordinate?.longitude || 0,
                                    latitude: n.coordinate?.latitude || 0,
                                    designPressure: n.designPressure || null,
                                    capacity: null,
                                    hasConnection: false,
                                    x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null
                                });
                            }
                        });
                        layer.lines.forEach((l: any) => {
                            const edgeIdStr = [l.startNodeId, l.endNodeId].sort().join('-');
                            if (!seenEdges.has(edgeIdStr)) {
                                seenEdges.add(edgeIdStr);
                                rawEdges.push({
                                    id: l.id || edgeIdStr,
                                    name: l.name || layer.name,
                                    source: l.startNodeId,
                                    target: l.endNodeId,
                                    category: layer.type || 'branch',
                                    diameterMm: l.diameter || null,
                                    lengthKm: l.length || 0,
                                });
                            }
                        });
                    });
                });

                // 标记连接关系
                const connectedIds = new Set<string>();
                rawEdges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
                rawNodes.forEach(n => { n.hasConnection = connectedIds.has(n.id); });

                const gNodes = rawNodes.map(n => ({ id: n.id, name: n.name, type: n.type }));
                const gEdges = rawEdges.map(e => ({ id: e.id, startNodeId: e.source, endNodeId: e.target }));
                const isolated = findIsolatedNodes(gNodes, gEdges);
                const centralityMap = computeBetweennessCentrality(gNodes, gEdges);
                const compCount = countComponents(gNodes, gEdges);
                const criticalNodes = Array.from(centralityMap.entries())
                    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(entry => entry[0]);

                setRawData({
                    nodes: rawNodes,
                    edges: rawEdges,
                    isolatedNodes: isolated,
                    criticalNodes,
                    stats: {
                        nodeCount: rawNodes.length,
                        edgeCount: rawEdges.length,
                        isolatedCount: isolated.length,
                        componentCount: compCount
                    }
                });
                criticalSetRef.current = new Set(criticalNodes);
                setLoading(false);
            } catch (err) {
                console.error('前端数据回退也失败:', err);
                setLoading(false);
            }
        };

        fetchTopologyData();
    }, []);

    // ============ 构建管线与节点的映射（异步加载） ============
    // nodeName -> Set of Package Names
    const [pipelinePackages, setPipelinePackages] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelinePackages(data))
            .catch(() => {}) // 加载失败静默处理，节点过滤会显示全部
    }, [])

    const nodePackagesMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        pipelinePackages.forEach(pkg => {
            pkg.layers.forEach(layer => {
                layer.nodes.forEach(n => {
                    if (!map.has(n.name)) map.set(n.name, new Set());
                    map.get(n.name)!.add(pkg.name);
                });
            });
        });
        return map;
    }, [pipelinePackages]);

    // 管线选择器列表（使用异步加载的数据）

    // ============ 过滤逻辑 ============
    const { filteredNodes, filteredEdges, visibleStats } = useMemo(() => {
        if (!rawData) return { filteredNodes: [], filteredEdges: [], visibleStats: { total: 0, connected: 0, isolated: 0 } };

        const typeFilter = new Set<string>();
        if (showCompressor) typeFilter.add('compressor');
        if (showDistribution) typeFilter.add('distribution');
        if (showValve) typeFilter.add('valve');
        if (showOther) typeFilter.add('other');
        // 始终显示 source 和 shared
        typeFilter.add('source');
        typeFilter.add('shared');

        let edges = rawData.edges || [];
        let relevantNodeIds: Set<string> | null = null;

        // 管线过滤
        if (selectedPipeline !== '__all__') {
            edges = rawData.edges.filter(e => e.name === selectedPipeline);
            relevantNodeIds = new Set<string>();
            for (const e of edges) {
                relevantNodeIds.add(e.source);
                relevantNodeIds.add(e.target);
            }
        }

        let dropByNotDrawn = 0;
        let dropByPipeline = 0;
        let dropByType = 0;
        let dropByIsolated = 0;

        console.log(`[Filter Debug] Initial nodes: ${rawData.nodes?.length}, selectedPipeline: "${selectedPipeline}"`);

        // 节点过滤
        const nodes = (rawData.nodes || []).filter(n => {
            // 核心需求：只显示在 ALL_PIPELINES 中存在的节点 (即"已画"的节点)
            const packages = nodePackagesMap.get(n.name);
            if (!packages) {
                dropByNotDrawn++;
                return false;
            }

            // 管线选择器过滤 (前端目录匹配)
            if (selectedPipeline !== '__all__' && !packages.has(selectedPipeline)) {
                dropByPipeline++;
                return false;
            }

            // 类型过滤
            if (!typeFilter.has(n.type)) {
                dropByType++;
                return false;
            }
            // 孤立节点过滤
            if (!showIsolated && !n.hasConnection) {
                dropByIsolated++;
                return false;
            }
            return true;
        });

        console.log(`[Filter Debug] Dropped by Not Drawn: ${dropByNotDrawn}`);
        console.log(`[Filter Debug] Dropped by Pipeline: ${dropByPipeline}`);
        console.log(`[Filter Debug] Dropped by Type: ${dropByType}`);
        console.log(`[Filter Debug] Dropped by Isolated: ${dropByIsolated}`);
        console.log(`[Filter Debug] Final nodes: ${nodes.length}`);

        const visibleNodeIds = new Set(nodes.map(n => n.id));

        // 只要源和目标都在可见节点列表中，就显示该边
        const visibleEdges = (rawData.edges || []).filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));

        return {
            filteredNodes: nodes,
            filteredEdges: visibleEdges,
            visibleStats: {
                total: nodes.length,
                connected: nodes.filter(n => n.hasConnection).length,
                isolated: nodes.filter(n => !n.hasConnection).length,
            }
        };
    }, [rawData, showCompressor, showDistribution, showValve, showOther, showIsolated, selectedPipeline, nodePackagesMap]);

    // ============ 搜索匹配 ============
    const searchMatchIds = useMemo(() => {
        if (!searchText.trim() || !rawData) return new Set<string>();
        const kw = searchText.trim().toLowerCase();
        return new Set(rawData.nodes.filter(n => n.name.toLowerCase().includes(kw)).map(n => n.id));
    }, [searchText, rawData]);

    useEffect(() => {
        viewportRef.current = { zoom, pan };
    }, [zoom, pan]);

    useEffect(() => {
        hoveredNodeIdRef.current = hoveredNodeId;
    }, [hoveredNodeId]);

    useEffect(() => {
        selectedNodeIdsRef.current = selectedNodeIds;
    }, [selectedNodeIds]);

    useEffect(() => {
        searchMatchIdsRef.current = searchMatchIds;
    }, [searchMatchIds]);

    useEffect(() => {
        draggingNodeRef.current = draggingNode;
    }, [draggingNode]);

    const applyViewport = useCallback((nextZoom: number, nextPan: CanvasPoint) => {
        const clampedZoom = clampZoom(nextZoom);
        viewportRef.current = {
            zoom: clampedZoom,
            pan: nextPan,
        };
        setZoom(clampedZoom);
        setPan(nextPan);
    }, []);

    const applyPan = useCallback((nextPan: CanvasPoint) => {
        viewportRef.current = {
            ...viewportRef.current,
            pan: nextPan,
        };
        setPan(nextPan);
    }, []);

    const getViewportSize = useCallback(() => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            return { width: rect.width, height: rect.height };
        }
        return viewportSizeRef.current;
    }, []);

    const zoomAroundScreenPoint = useCallback((screenPoint: CanvasPoint, nextZoom: number) => {
        const currentViewport = viewportRef.current;
        const clampedZoom = clampZoom(nextZoom);
        const anchorWorld = screenToWorldWithViewport(
            screenPoint.x,
            screenPoint.y,
            currentViewport.zoom,
            currentViewport.pan,
        );
        applyViewport(clampedZoom, {
            x: screenPoint.x - anchorWorld.x * clampedZoom,
            y: screenPoint.y - anchorWorld.y * clampedZoom,
        });
    }, [applyViewport]);

    const zoomFromViewportCenter = useCallback((factor: number) => {
        const { width, height } = getViewportSize();
        zoomAroundScreenPoint(
            { x: width / 2, y: height / 2 },
            viewportRef.current.zoom * factor,
        );
    }, [getViewportSize, zoomAroundScreenPoint]);

    const releaseDraggingNode = useCallback(() => {
        const activeNode = draggingNodeRef.current;
        if (activeNode) {
            activeNode.fx = null;
            activeNode.fy = null;
            draggingNodeRef.current = null;
        }
        setDraggingNode(null);
    }, []);

    // ============ 过滤变化时重新初始化布局 ============
    useEffect(() => {
        if (!rawData || loading) return;
        const { width: w, height: h } = getViewportSize();

        // 地理坐标映射
        const lons = filteredNodes.map(n => n.longitude).filter(v => v !== 0);
        const lats = filteredNodes.map(n => n.latitude).filter(v => v !== 0);
        let minLon = 0, maxLon = 1, minLat = 0, maxLat = 1;
        if (lons.length > 1) {
            minLon = Math.min(...lons);
            maxLon = Math.max(...lons);
            minLat = Math.min(...lats);
            maxLat = Math.max(...lats);
        }
        const lonRange = maxLon - minLon || 1;
        const latRange = maxLat - minLat || 1;
        const pad = 120;

        const nodes: TopoNode[] = filteredNodes.map(n => {
            let x: number, y: number;
            if (n.longitude !== 0 && n.latitude !== 0) {
                x = pad + ((n.longitude - minLon) / lonRange) * (w - 2 * pad);
                y = pad + ((maxLat - n.latitude) / latRange) * (h - 2 * pad);
            } else {
                x = pad + Math.random() * (w - 2 * pad);
                y = pad + Math.random() * (h - 2 * pad);
            }
            return { ...n, x, y, vx: 0, vy: 0, fx: null, fy: null };
        });

        nodesRef.current = nodes;
        edgesRef.current = filteredEdges;
        alphaRef.current = 1;
        touchGestureRef.current = { mode: 'none' };
        isPanningRef.current = false;
        if (!hasInitializedViewportRef.current) {
            applyViewport(1, { x: 0, y: 0 });
            hasInitializedViewportRef.current = true;
        }
        setSelectedNodeIds(new Set()); setContextMenu(null);
        setHoveredNodeId(null);
        releaseDraggingNode();
    }, [applyViewport, filteredNodes, filteredEdges, getViewportSize, loading, rawData, releaseDraggingNode]);

    // ============ Canvas 尺寸 ============
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const resize = () => {
            const prevSize = viewportSizeRef.current;
            const currentViewport = viewportRef.current;
            const centerWorld = prevSize.width > 0 && prevSize.height > 0
                ? screenToWorldWithViewport(
                    prevSize.width / 2,
                    prevSize.height / 2,
                    currentViewport.zoom,
                    currentViewport.pan,
                )
                : null;
            const dpr = window.devicePixelRatio || 1;
            const { width, height } = getCanvasDisplaySize(canvas);
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            viewportSizeRef.current = {
                width,
                height,
            };
            const ctx = canvas.getContext('2d');
            ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (centerWorld) {
                applyViewport(currentViewport.zoom, {
                    x: width / 2 - centerWorld.x * currentViewport.zoom,
                    y: height / 2 - centerWorld.y * currentViewport.zoom,
                });
            }
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [applyViewport]);

    // ============ 仿真覆盖层 ============
    const simOverlayRef = useRef<SimulationOverlay | null>(null);
    const {
        overlay,
        isLoading: simLoading,
        error: simError,
        currentScenario,
        snapshots,
        snapshotLoading,
        baselineSnapshotLoading,
        snapshotError,
        selectedSnapshotRunId,
        baselineSnapshotRunId,
        trialRunScenarioId,
        bulkTrialRunActive,
        comparison,
        trialRunItems,
        setScenario,
        setSelectedSnapshotRunId,
        setBaselineSnapshotRunId,
        runSimulation,
        saveSnapshot,
        refreshSnapshots,
        loadSelectedSnapshot,
        loadSnapshotByRunId,
        runTrialScenario,
        runMissingTrialScenarios,
        hydrateFromContext,
        clearOverlay,
    } =
        useSimulation({ pilotId, scenarios: scenarioOptions });
    useEffect(() => { simOverlayRef.current = overlay; }, [overlay]);
    const showcaseSyncAppliedRef = useRef(false);
    const [showcaseSyncUpdatedAt, setShowcaseSyncUpdatedAt] = useState<string | null>(null);

    // ============ 动画循环 ============
    useEffect(() => {
        if (loading) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const animate = () => {
            const { width: w, height: h } = viewportSizeRef.current;
            if (alphaRef.current > 0.005) {
                simulateForces(nodesRef.current, edgesRef.current, w, h, alphaRef.current);
                alphaRef.current *= 0.995;
            }
            const currentViewport = viewportRef.current;
            drawGraph(ctx, nodesRef.current, edgesRef.current, criticalSetRef.current,
                hoveredNodeIdRef.current,
                selectedNodeIdsRef.current,
                searchMatchIdsRef.current,
                w,
                h,
                currentViewport.zoom,
                currentViewport.pan.x,
                currentViewport.pan.y,
                simOverlayRef.current,
                performance.now(),
            );
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animFrameRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [loading]);

    // ============ 鼠标坐标转换（考虑缩放和平移） ============
    const screenToWorld = useCallback((sx: number, sy: number) => {
        const currentViewport = viewportRef.current;
        return screenToWorldWithViewport(sx, sy, currentViewport.zoom, currentViewport.pan);
    }, []);

    const findNodeAt = useCallback((wx: number, wy: number): TopoNode | null => {
        for (let i = nodesRef.current.length - 1; i >= 0; i--) {
            const n = nodesRef.current[i];
            const r = criticalSetRef.current.has(n.id) ? CRITICAL_RADIUS : NODE_RADIUS;
            const dx = wx - n.x;
            const dy = wy - n.y;
            if (dx * dx + dy * dy <= r * r) return n;
        }
        return null;
    }, []);

    // ============ 鼠标事件 ============
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // 平移画布
        if (isPanningRef.current) {
            applyViewport(viewportRef.current.zoom, {
                x: panStartRef.current.panX + (sx - panStartRef.current.x),
                y: panStartRef.current.panY + (sy - panStartRef.current.y),
            });
            return;
        }

        if (draggingNodeRef.current) {
            const { x, y } = screenToWorld(sx, sy);
            draggingNodeRef.current.fx = x;
            draggingNodeRef.current.fy = y;
            alphaRef.current = Math.max(alphaRef.current, 0.1);
            return;
        }

        const { x, y } = screenToWorld(sx, sy);
        const node = findNodeAt(x, y);
        setHoveredNodeId(node?.id || null);
        if (canvasRef.current) {
            canvasRef.current.style.cursor = node ? 'pointer' : 'grab';
        }
    }, [applyViewport, findNodeAt, screenToWorld]);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { x, y } = screenToWorld(sx, sy);
        const node = findNodeAt(x, y);

        if (node) {
            node.fx = x;
            node.fy = y;
            draggingNodeRef.current = node;
            setDraggingNode(node);
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        } else {
            // 开始平移
            isPanningRef.current = true;
            panStartRef.current = {
                x: sx,
                y: sy,
                panX: viewportRef.current.pan.x,
                panY: viewportRef.current.pan.y,
            };
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        }
    }, [findNodeAt, screenToWorld]);

    const handleMouseUp = useCallback(() => {
        releaseDraggingNode();
        isPanningRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    }, [releaseDraggingNode]);

    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (Date.now() < suppressClickUntilRef.current) return;
        setContextMenu(null); // click closes menu
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const node = findNodeAt(x, y);
        
        setSelectedNodeIds(prev => {
            const next = new Set(prev);
            if (e.shiftKey) {
                if (node) {
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                }
            } else {
                next.clear();
                if (node) next.add(node.id);
            }
            return next;
        });
    }, [findNodeAt, screenToWorld]);

    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        setContextMenu(null);

        if (e.touches.length >= 2) {
            const metrics = getTouchMetrics(e.touches, rect);
            if (!metrics) return;
            e.preventDefault();
            releaseDraggingNode();
            touchGestureRef.current = {
                mode: 'pinch',
                touchIds: [e.touches[0].identifier, e.touches[1].identifier],
                startZoom: viewportRef.current.zoom,
                anchorWorld: screenToWorld(metrics.center.x, metrics.center.y),
                startDistance: Math.max(metrics.distance, 1),
            };
            suppressClickUntilRef.current = Date.now() + 350;
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
            return;
        }

        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const point = getTouchPoint(touch, rect);
        const world = screenToWorld(point.x, point.y);
        const node = findNodeAt(world.x, world.y);

        if (node) {
            node.fx = world.x;
            node.fy = world.y;
            draggingNodeRef.current = node;
            setDraggingNode(node);
            touchGestureRef.current = {
                mode: 'drag-node',
                touchId: touch.identifier,
                node,
            };
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
            return;
        }

        isPanningRef.current = true;
        touchGestureRef.current = {
            mode: 'pan',
            touchId: touch.identifier,
            startTouch: point,
            startPan: viewportRef.current.pan,
        };
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    }, [findNodeAt, releaseDraggingNode, screenToWorld]);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (e.touches.length >= 2) {
            const metrics = getTouchMetrics(e.touches, rect);
            if (!metrics) return;
            e.preventDefault();

            const gesture = touchGestureRef.current;
            if (gesture.mode !== 'pinch') {
                releaseDraggingNode();
                isPanningRef.current = false;
                touchGestureRef.current = {
                    mode: 'pinch',
                    touchIds: [e.touches[0].identifier, e.touches[1].identifier],
                    startZoom: viewportRef.current.zoom,
                    anchorWorld: screenToWorld(metrics.center.x, metrics.center.y),
                    startDistance: Math.max(metrics.distance, 1),
                };
                suppressClickUntilRef.current = Date.now() + 350;
                return;
            }

            const nextZoom = clampZoom(gesture.startZoom * (metrics.distance / Math.max(gesture.startDistance, 1)));
            applyViewport(nextZoom, {
                x: metrics.center.x - gesture.anchorWorld.x * nextZoom,
                y: metrics.center.y - gesture.anchorWorld.y * nextZoom,
            });
            suppressClickUntilRef.current = Date.now() + 350;
            return;
        }

        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const point = getTouchPoint(touch, rect);
        const gesture = touchGestureRef.current;

        if (gesture.mode === 'pinch') {
            isPanningRef.current = true;
            touchGestureRef.current = {
                mode: 'pan',
                touchId: touch.identifier,
                startTouch: point,
                startPan: viewportRef.current.pan,
            };
            suppressClickUntilRef.current = Date.now() + 350;
            return;
        }

        if (gesture.mode === 'drag-node' && gesture.touchId === touch.identifier) {
            e.preventDefault();
            const world = screenToWorld(point.x, point.y);
            gesture.node.fx = world.x;
            gesture.node.fy = world.y;
            alphaRef.current = Math.max(alphaRef.current, 0.1);
            suppressClickUntilRef.current = Date.now() + 350;
            return;
        }

        if (gesture.mode === 'pan' && gesture.touchId === touch.identifier) {
            e.preventDefault();
            applyPan({
                x: gesture.startPan.x + (point.x - gesture.startTouch.x),
                y: gesture.startPan.y + (point.y - gesture.startTouch.y),
            });
            suppressClickUntilRef.current = Date.now() + 350;
        }
    }, [applyPan, applyViewport, releaseDraggingNode, screenToWorld]);

    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        const gesture = touchGestureRef.current;

        if (e.touches.length >= 2) {
            if (!rect) return;
            const metrics = getTouchMetrics(e.touches, rect);
            if (!metrics) return;
            touchGestureRef.current = {
                mode: 'pinch',
                touchIds: [e.touches[0].identifier, e.touches[1].identifier],
                startZoom: viewportRef.current.zoom,
                anchorWorld: screenToWorld(metrics.center.x, metrics.center.y),
                startDistance: Math.max(metrics.distance, 1),
            };
            suppressClickUntilRef.current = Date.now() + 350;
            return;
        }

        if (e.touches.length === 1 && rect) {
            const touch = e.touches[0];
            isPanningRef.current = true;
            touchGestureRef.current = {
                mode: 'pan',
                touchId: touch.identifier,
                startTouch: getTouchPoint(touch, rect),
                startPan: viewportRef.current.pan,
            };
            suppressClickUntilRef.current = Date.now() + 350;
            return;
        }

        touchGestureRef.current = { mode: 'none' };
        isPanningRef.current = false;
        suppressClickUntilRef.current = Date.now() + 350;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';

        if (gesture.mode === 'drag-node') {
            releaseDraggingNode();
            return;
        }

        if (gesture.mode === 'pan' && rect && e.changedTouches.length === 1) {
            const changed = e.changedTouches[0];
            const point = getTouchPoint(changed, rect);
            const dx = point.x - gesture.startTouch.x;
            const dy = point.y - gesture.startTouch.y;
            if (Math.hypot(dx, dy) < 6) {
                const world = screenToWorld(point.x, point.y);
                const node = findNodeAt(world.x, world.y);
                setSelectedNodeIds(node ? new Set([node.id]) : new Set());
            }
        }
    }, [findNodeAt, releaseDraggingNode, screenToWorld]);

    const handleTouchCancel = useCallback(() => {
        touchGestureRef.current = { mode: 'none' };
        isPanningRef.current = false;
        suppressClickUntilRef.current = Date.now() + 350;
        releaseDraggingNode();
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    }, [releaseDraggingNode]);

    const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        if (selectedNodeIds.size > 1) {
            setContextMenu({ screenX: e.clientX, screenY: e.clientY });
            return;
        }
        setContextMenu(null);
    }, [selectedNodeIds]);


    // 滚轮缩放
    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoomAroundScreenPoint({ x: mx, y: my }, viewportRef.current.zoom * factor);

        // 以鼠标位置为缩放中心
    }, [zoomAroundScreenPoint]);

    // 搜索定位
    const handleSearchLocate = useCallback(() => {
        if (searchMatchIds.size === 0) return;
        const firstId = [...searchMatchIds][0];
        const node = nodesRef.current.find(n => n.id === firstId);
        if (!node) return;
        // 居中到该节点
        const { width: w, height: h } = getViewportSize();
        applyViewport(1.5, { x: w / 2 - node.x * 1.5, y: h / 2 - node.y * 1.5 });
        setSelectedNodeIds(new Set([firstId]));
    }, [applyViewport, getViewportSize, searchMatchIds]);

    // 重置视图
    const handleReset = useCallback(() => {
        applyViewport(1, { x: 0, y: 0 });
        alphaRef.current = 1;
        for (const n of nodesRef.current) {
            n.vx = (Math.random() - 0.5) * 5;
            n.vy = (Math.random() - 0.5) * 5;
            n.fx = null;
            n.fy = null;
        }
        touchGestureRef.current = { mode: 'none' };
        releaseDraggingNode();
    }, [applyViewport, releaseDraggingNode]);

    // 获取选中节点的连接管线
    const getNodeConnections = useCallback((nodeId: string) => {
        if (!rawData) return [];
        return rawData.edges.filter(e => e.source === nodeId || e.target === nodeId);
    }, [rawData]);

    const selectedNode = selectedNodeId
        ? nodesRef.current.find(n => n.id === selectedNodeId) || null
        : null;
    const selectedSimulationNode = useMemo(() => {
        if (!selectedNode || !overlay) return null;
        return overlay.nodes.find(item => item.id === selectedNode.id) ?? null;
    }, [overlay, selectedNode]);
    const internalDebugEnabled = useMemo(() => {
        if (import.meta.env.DEV) return true;
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(INTERNAL_TOPOLOGY_DEBUG_KEY) === '1';
    }, []);
    const debugActionsEnabled = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return internalDebugEnabled && params.get('debugActions') === '1';
    }, [internalDebugEnabled, location.search]);
    useEffect(() => {
        if (showcaseSyncAppliedRef.current) return;

        const syncedContext = readSimulationShowcaseSyncContext(pilotId);
        if (!syncedContext) return;

        showcaseSyncAppliedRef.current = true;
        hydrateFromContext({
            scenarioId: syncedContext.scenarioId,
            selectedSnapshotRunId: syncedContext.selectedSnapshotRunId,
            baselineSnapshotRunId: syncedContext.baselineSnapshotRunId,
            overlay: syncedContext.overlay,
        });
        setShowcaseSyncUpdatedAt(syncedContext.updatedAt || null);

        if (syncedContext.selectedSnapshotRunId) {
            void loadSnapshotByRunId(syncedContext.selectedSnapshotRunId).catch(() => {
                // Keep the hydrated overlay as a fallback if snapshot reload fails.
            });
        }
    }, [hydrateFromContext, loadSnapshotByRunId, pilotId]);
    const currentScenarioOption = useMemo(() => {
        return scenarioOptions.find(item => item.id === currentScenario) || null;
    }, [currentScenario, scenarioOptions]);
    const selectedSnapshotSummary = useMemo(() => {
        if (!selectedSnapshotRunId) return null;
        return snapshots.find(item => item.run_id === selectedSnapshotRunId) || null;
    }, [selectedSnapshotRunId, snapshots]);
    const selectedBaselineSnapshotSummary = useMemo(() => {
        if (!baselineSnapshotRunId) return null;
        return snapshots.find(item => item.run_id === baselineSnapshotRunId) || null;
    }, [baselineSnapshotRunId, snapshots]);
    const latestSnapshotSummary = useMemo(() => {
        return [...snapshots]
            .sort((left, right) => (right.saved_at || '').localeCompare(left.saved_at || ''))[0] || null;
    }, [snapshots]);
    const simulationStatusTone = simLoading
        ? {
            dot: '#fbbf24',
            text: '#fde68a',
            border: 'rgba(251, 191, 36, 0.35)',
            background: 'rgba(251, 191, 36, 0.12)',
            label: '求解中',
        }
        : overlay?.solver_status === 'converged'
            ? {
                dot: '#34d399',
                text: '#bbf7d0',
                border: 'rgba(52, 211, 153, 0.35)',
                background: 'rgba(52, 211, 153, 0.12)',
                label: '已收敛',
            }
            : overlay?.solver_status === 'max_iter'
                ? {
                    dot: '#fbbf24',
                    text: '#fde68a',
                    border: 'rgba(251, 191, 36, 0.35)',
                    background: 'rgba(251, 191, 36, 0.12)',
                    label: '达到迭代上限',
                }
                : overlay?.solver_status === 'error' || simError
                    ? {
                        dot: '#f87171',
                        text: '#fecaca',
                        border: 'rgba(248, 113, 113, 0.35)',
                        background: 'rgba(248, 113, 113, 0.12)',
                        label: '仿真失败',
                    }
                    : {
                        dot: '#22d3ee',
                        text: '#bae6fd',
                        border: 'rgba(34, 211, 238, 0.35)',
                        background: 'rgba(34, 211, 238, 0.12)',
                        label: '等待结果',
                    };
    const simulationShowcaseCards = overlay
        ? [
            { label: '当前场景', value: currentScenarioOption?.label || overlay.scenario_id, accent: '#67e8f9' },
            { label: '运行编号', value: overlay.run_id.slice(0, 12), accent: '#c4b5fd' },
            { label: '平均利用率', value: overlay.summary.avg_utilization.toFixed(3), accent: '#86efac' },
            { label: '告警数', value: String(overlay.summary.alert_count), accent: '#fcd34d' },
        ]
        : [
            { label: '当前场景', value: currentScenarioOption?.label || currentScenario, accent: '#67e8f9' },
            { label: '快照数量', value: `${snapshots.length} 条`, accent: '#93c5fd' },
            { label: '基线快照', value: selectedBaselineSnapshotSummary?.scenario_id || '未选择', accent: '#c4b5fd' },
            { label: '最近留档', value: latestSnapshotSummary ? latestSnapshotSummary.scenario_id : '暂无', accent: '#86efac' },
        ];
    const simulationShowcaseSummary = overlay
        ? `当前展示 ${currentScenarioOption?.label || overlay.scenario_id}，生成时间 ${new Date(overlay.generated_at).toLocaleString('zh-CN', { hour12: false })}。`
        : debugActionsEnabled
            ? '当前还没有正式结果，先用调试操作面跑一条场景，再回到这里看展示效果。'
            : '当前只展示仿真专页骨架，正式运行入口仍在第一张图主仿真页。';
    const showcaseModeText = debugActionsEnabled ? '当前处于调试模式' : '当前处于正式展示模式';
    const showcaseSyncText = showcaseSyncUpdatedAt
        ? `已同步第一张图主仿真上下文 · ${new Date(showcaseSyncUpdatedAt).toLocaleString('zh-CN', { hour12: false })} · 联动上下文 2 小时内有效`
        : `${showcaseModeText} · 联动上下文 2 小时内有效`;
    const simulationMotionState = simLoading
        ? 'loading'
        : overlay?.solver_status === 'error' || simError
            ? 'error'
            : overlay?.solver_status === 'converged'
                ? 'ready'
                : 'idle';

    return (
        <>
        <div className="topology-view">
            {loading && (
                <div className="topology-loading">
                    <div className="spinner" />
                    <span>正在加载拓扑数据...</span>
                </div>
            )}

            {/* ====== 顶部控制栏 ====== */}
            <div className="topology-control-bar">
                {/* 第一层：管线选择器 */}
                <div className="control-row">
                    <span className="control-label">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>route</span>
                        管线
                    </span>
                    <select
                        className="pipeline-selector"
                        value={selectedPipeline}
                        onChange={e => setSelectedPipeline(e.target.value)}
                    >
                        <option value="__all__">全部管线 (仅显示已画线)</option>
                        <optgroup label="前端管线目录">
                            {pipelinePackages.map(pkg => (
                                <option key={pkg.name} value={pkg.name}>{pkg.name}</option>
                            ))}
                        </optgroup>
                    </select>
                </div>

                {/* 第二层：类型过滤 */}
                <div className="control-row">
                    <span className="control-label">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>filter_alt</span>
                        过滤
                    </span>
                    <div className="filter-chips">
                        <label className={`filter-chip ${showCompressor ? 'active' : ''}`}
                            style={{ '--chip-color': NODE_COLORS.compressor } as React.CSSProperties}>
                            <input type="checkbox" checked={showCompressor} onChange={e => setShowCompressor(e.target.checked)} />
                            压气站
                        </label>
                        <label className={`filter-chip ${showDistribution ? 'active' : ''}`}
                            style={{ '--chip-color': NODE_COLORS.distribution } as React.CSSProperties}>
                            <input type="checkbox" checked={showDistribution} onChange={e => setShowDistribution(e.target.checked)} />
                            分输站
                        </label>
                        <label className={`filter-chip ${showValve ? 'active' : ''}`}
                            style={{ '--chip-color': NODE_COLORS.valve } as React.CSSProperties}>
                            <input type="checkbox" checked={showValve} onChange={e => setShowValve(e.target.checked)} />
                            阀室
                        </label>
                        <label className={`filter-chip ${showOther ? 'active' : ''}`}
                            style={{ '--chip-color': NODE_COLORS.other } as React.CSSProperties}>
                            <input type="checkbox" checked={showOther} onChange={e => setShowOther(e.target.checked)} />
                            其他
                        </label>
                        <span className="filter-divider" />
                        <label className={`filter-chip ${showIsolated ? 'active' : ''}`}
                            style={{ '--chip-color': '#f87171' } as React.CSSProperties}>
                            <input type="checkbox" checked={showIsolated} onChange={e => setShowIsolated(e.target.checked)} />
                            孤立节点
                        </label>
                    </div>
                </div>

                {/* 第三层：搜索 */}
                <div className="control-row">
                    <span className="control-label">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
                        搜索
                    </span>
                    <input
                        className="search-input"
                        type="text"
                        placeholder="输入站场名称..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearchLocate()}
                    />
                    {searchText && (
                        <span className="search-result-count">
                            {searchMatchIds.size > 0 ? `${searchMatchIds.size} 个匹配` : '无结果'}
                        </span>
                    )}
                    <button className="control-btn" onClick={handleSearchLocate} disabled={searchMatchIds.size === 0}>
                        定位
                    </button>
                    <button className="control-btn" onClick={() => { setSearchText(''); }}>
                        清空
                    </button>
                </div>
            </div>

            <div
                className={`topology-sim-showcase topology-sim-showcase--${simulationMotionState}`}
                style={{
                    position: 'fixed',
                    top: 132,
                    left: 24,
                    zIndex: 140,
                    width: '420px',
                    color: '#e2e8f0',
                    ['--sim-accent' as any]: simulationStatusTone.dot,
                    ['--sim-border' as any]: simulationStatusTone.border,
                    ['--sim-badge-bg' as any]: simulationStatusTone.background,
                    ['--sim-badge-text' as any]: simulationStatusTone.text,
                } as React.CSSProperties}
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="topology-sim-kicker">
                            Simulation Showcase
                        </div>
                        <div className="topology-sim-title">
                            WE1 第三张图仿真展示专页
                        </div>
                    </div>
                    <div className="topology-sim-badge">
                        <span className={`topology-sim-dot ${simulationMotionState === 'loading' ? 'is-pulsing' : ''}`} />
                        {simulationStatusTone.label}
                    </div>
                </div>
                <div className="topology-sim-chip-row">
                    <span className="topology-sim-chip">
                        场景：{currentScenarioOption?.label || currentScenario}
                    </span>
                    <span className="topology-sim-chip">
                        run_id：{overlay ? overlay.run_id.slice(0, 12) : '未运行'}
                    </span>
                    <span className="topology-sim-chip">
                        快照：{snapshots.length} 条
                    </span>
                    <span className="topology-sim-chip">
                        已选快照：{selectedSnapshotSummary ? selectedSnapshotSummary.scenario_id : '未选择'}
                    </span>
                </div>
                <div className="topology-sim-summary" style={{ marginTop: 10, color: debugActionsEnabled ? '#fde68a' : '#cbd5e1' }}>
                    {showcaseModeText}
                </div>
                {showcaseSyncText && (
                    <div className="topology-sim-summary" style={{ marginTop: 10, color: '#bae6fd' }}>
                        {showcaseSyncText}
                    </div>
                )}
                <div className="topology-sim-summary">
                    {simulationShowcaseSummary}
                </div>
                <div className="topology-sim-card-grid">
                    {simulationShowcaseCards.map((item, index) => (
                        <div
                            key={`showcase-card-${item.label}`}
                            className={`topology-sim-card topology-sim-card--${simulationMotionState}`}
                            style={{ ['--card-accent' as any]: item.accent, animationDelay: `${index * 120}ms` } as React.CSSProperties}
                        >
                            <div className="topology-sim-card-label">
                                {item.label}
                            </div>
                            <div className="topology-sim-card-value">
                                {item.value}
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                        className="control-btn"
                        onClick={() => navigate(`/map-topology?pilotId=${pilotId}`)}
                    >
                        返回第一张图主仿真入口
                    </button>
                    {debugActionsEnabled ? (
                        <button
                            className="control-btn"
                            onClick={() => navigate(`/topology?pilotId=${pilotId}`)}
                        >
                            收起调试操作面
                        </button>
                    ) : null}
                </div>
            </div>

            {/* ====== 右侧统计 ====== */}
            <div className="topology-stats">
                <div className="stat-card">
                    <div className="stat-icon nodes">
                        <span className="material-symbols-outlined">visibility</span>
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{visibleStats.total}</span>
                        <span className="stat-label">当前显示</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon edges">
                        <span className="material-symbols-outlined">timeline</span>
                    </div>
                    <div className="stat-info">
                        <span className="stat-value">{filteredEdges.length}</span>
                        <span className="stat-label">管线连接</span>
                    </div>
                </div>
                {rawData && (
                    <div className="stat-card">
                        <div className="stat-icon components">
                            <span className="material-symbols-outlined">database</span>
                        </div>
                        <div className="stat-info">
                            <span className="stat-value">{rawData.stats.nodeCount}</span>
                            <span className="stat-label">全部站场</span>
                        </div>
                    </div>
                )}
                <div className={`stat-card topology-sim-stat-card topology-sim-stat-card--${simulationMotionState}`}>
                    <div className="stat-icon" style={{ background: simulationStatusTone.background, color: simulationStatusTone.dot }}>
                        <span className="material-symbols-outlined">science</span>
                    </div>
                    <div className="stat-info">
                        <span className="stat-value" style={{ fontSize: 14, color: simulationStatusTone.text }}>{simulationStatusTone.label}</span>
                        <span className="stat-label">仿真状态</span>
                    </div>
                </div>
                <div className={`stat-card topology-sim-stat-card ${overlay ? 'topology-sim-stat-card--active' : ''}`}>
                    <div className="stat-icon" style={{ background: 'rgba(96, 165, 250, 0.15)', color: '#93c5fd' }}>
                        <span className="material-symbols-outlined">inventory_2</span>
                    </div>
                    <div className="stat-info">
                        <span className="stat-value" style={{ fontSize: 14 }}>{overlay ? overlay.run_id.slice(0, 8) : `${snapshots.length}`}</span>
                        <span className="stat-label">{overlay ? '当前 run' : '历史快照'}</span>
                    </div>
                </div>
            </div>

            {/* ====== 图例（简化版） ====== */}
            <div className="topology-legend-mini">
                <div className="legend-item"><div className="legend-dot" style={{ background: NODE_COLORS.compressor }} />压</div>
                <div className="legend-item"><div className="legend-dot" style={{ background: NODE_COLORS.distribution }} />分</div>
                <div className="legend-item"><div className="legend-dot" style={{ background: NODE_COLORS.valve }} />阀</div>
                <div className="legend-item"><div className="legend-line" style={{ background: EDGE_COLORS.trunk }} />干</div>
                <div className="legend-item"><div className="legend-line" style={{ background: EDGE_COLORS.branch }} />支</div>
            </div>

            {/* ====== Canvas 画布 ====== */}
            <canvas
                ref={canvasRef}
                className="topology-canvas"
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                onWheel={handleWheel}
                onContextMenu={handleContextMenu}
            />

            {/* ====== 右键菜单 ====== */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{
                        position: 'fixed',
                        left: contextMenu.screenX,
                        top: contextMenu.screenY,
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: '120px'
                    }}
                >
                    <div
                        style={{
                            color: '#e2e8f0',
                            padding: '8px 12px',
                            textAlign: 'left',
                            fontSize: '14px',
                        }}
                    >
                        <div style={{ fontWeight: 600, marginBottom: '6px' }}>运行时枢纽只读说明</div>
                        <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.5 }}>
                            当前选中了 {selectedNodeIds.size} 个节点。枢纽关系现在由后台按交汇规则实时重编，这个页面不再支持手工“合并为大枢纽”。
                        </div>
                        <button
                            onClick={() => setContextMenu(null)}
                            style={{
                                marginTop: '10px',
                                width: '100%',
                                background: '#334155',
                                border: 'none',
                                color: '#e2e8f0',
                                padding: '8px 12px',
                                textAlign: 'center',
                                cursor: 'pointer',
                                fontSize: '13px',
                                borderRadius: '4px'
                            }}
                        >
                            知道了
                        </button>
                    </div>
                </div>
            )}

            {/* ====== 底部工具栏 ====== */}
            <div className="topology-toolbar">
                <button className="toolbar-btn" onClick={() => zoomFromViewportCenter(1.3)}>
                    <span className="material-symbols-outlined">zoom_in</span>
                </button>
                <button className="toolbar-btn" onClick={() => zoomFromViewportCenter(0.7)}>
                    <span className="material-symbols-outlined">zoom_out</span>
                </button>
                <button className="toolbar-btn" onClick={() => applyViewport(1, { x: 0, y: 0 })}>
                    <span className="material-symbols-outlined">fit_screen</span>
                </button>
                <span className="toolbar-divider" />
                <button className="toolbar-btn" onClick={handleReset}>
                    <span className="material-symbols-outlined">refresh</span>
                    重置
                </button>
                <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
            </div>


            {/* ====== 节点详情侧边栏 ====== */}
            <div className={`topology-detail-panel ${selectedNode ? 'open' : ''}`}>
                {selectedNode && (
                    <>
                        <button className="detail-close" onClick={() => setSelectedNodeIds(new Set())}>
                            <span className="material-symbols-outlined">close</span>
                        </button>
                        <div className="detail-header">
                            <h2>{selectedNode.name}</h2>
                            <span className="detail-type" style={{
                                background: `${NODE_COLORS[selectedNode.type] || NODE_COLORS.default}22`,
                                color: NODE_COLORS[selectedNode.type] || NODE_COLORS.default,
                            }}>
                                {NODE_TYPE_LABELS[selectedNode.type] || selectedNode.type}
                            </span>
                        </div>
                        <div className="detail-section">
                            <h4>基本信息</h4>
                            <div className="detail-row"><span className="label">ID</span><span className="value">{selectedNode.id}</span></div>
                            <div className="detail-row"><span className="label">经度</span><span className="value">{selectedNode.longitude.toFixed(4)}</span></div>
                            <div className="detail-row"><span className="label">纬度</span><span className="value">{selectedNode.latitude.toFixed(4)}</span></div>
                            <div className="detail-row"><span className="label">设计压力</span><span className="value">{selectedNode.designPressure ? `${selectedNode.designPressure} MPa` : '—'}</span></div>
                            <div className="detail-row"><span className="label">处理能力</span><span className="value">{selectedNode.capacity ? `${selectedNode.capacity} 万m³/天` : '—'}</span></div>
                        </div>
                        <div className="detail-section">
                            <h4>仿真状态</h4>
                            <div className="detail-row">
                                <span className="label">进站压力</span>
                                <span className="value">
                                    {selectedSimulationNode
                                        ? `${(selectedSimulationNode.pressure_in_mpa ?? selectedSimulationNode.pressure_mpa).toFixed(2)} MPa`
                                        : '未运行仿真'}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="label">出站压力</span>
                                <span className="value">{selectedSimulationNode ? `${selectedSimulationNode.pressure_mpa.toFixed(2)} MPa` : '未运行仿真'}</span>
                            </div>
                            <div className="detail-row">
                                <span className="label">站内压差</span>
                                <span className="value">
                                    {selectedSimulationNode
                                        ? `${(selectedSimulationNode.pressure_mpa - (selectedSimulationNode.pressure_in_mpa ?? selectedSimulationNode.pressure_mpa)).toFixed(2)} MPa`
                                        : '未运行仿真'}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="label">当前温度</span>
                                <span className="value">
                                    {selectedSimulationNode
                                        ? `${(selectedSimulationNode.temperature_c ?? estimateNodeTemperatureC(selectedSimulationNode.pressure_mpa)).toFixed(1)}°C${selectedSimulationNode.temperature_c == null ? '（估算）' : ''}`
                                        : '未运行仿真'}
                                </span>
                            </div>
                        </div>
                        <div className="detail-section">
                            <h4>拓扑状态</h4>
                            <div className="detail-row">
                                <span className="label">连接状态</span>
                                <span className="value" style={{ color: selectedNode.hasConnection ? '#34d399' : '#f87171' }}>
                                    {selectedNode.hasConnection ? '✓ 已连接' : '✗ 孤立'}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="label">关键节点</span>
                                <span className="value" style={{ color: criticalSetRef.current.has(selectedNode.id) ? '#fbbf24' : '#94a3b8' }}>
                                    {criticalSetRef.current.has(selectedNode.id) ? '★ 是' : '否'}
                                </span>
                            </div>
                        </div>
                        <div className="detail-section">
                            <h4>管线连接 ({getNodeConnections(selectedNode.id).length})</h4>
                            <ul className="detail-connections">
                                {getNodeConnections(selectedNode.id).map(conn => {
                                    const otherId = conn.source === selectedNode.id ? conn.target : conn.source;
                                    const otherNode = rawData?.nodes.find(n => n.id === otherId);
                                    const dir = conn.source === selectedNode.id ? '→' : '←';
                                    return (
                                        <li key={conn.id}>
                                            <span className="material-symbols-outlined">{conn.category === 'trunk' ? 'route' : 'alt_route'}</span>
                                            {dir} {otherNode?.name || otherId}
                                            <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>{conn.lengthKm}km</span>
                                        </li>
                                    );
                                })}
                                {getNodeConnections(selectedNode.id).length === 0 && (
                                    <li style={{ color: '#f87171' }}>
                                        <span className="material-symbols-outlined">link_off</span>
                                        无管线连接
                                    </li>
                                )}
                            </ul>
                        </div>
                        {/* 新增：枢纽内部分量展示 */}
                        {selectedNode.properties?.is_super_junction && (
                            <div className="detail-section">
                                <h4>调度分量配比 (基于管径权重)</h4>
                                {(() => {
                                    const conns = getNodeConnections(selectedNode.id);
                                    const inflows = conns.filter(c => c.target === selectedNode.id);
                                    const outflows = conns.filter(c => c.source === selectedNode.id);
                                    const totalInWeight = inflows.reduce((sum, c) => sum + Math.pow(c.diameterMm || 600, 2), 0) || 1;
                                    const totalOutWeight = outflows.reduce((sum, c) => sum + Math.pow(c.diameterMm || 600, 2), 0) || 1;
                                    
                                    return (
                                        <div className="dispatch-components">
                                            {/* 进气流向区域 */}
                                            <div style={{marginBottom: 10}}>
                                                <div style={{fontSize: 12, color: '#94a3b8', marginBottom: 4}}>进气配比 (Inflow)</div>
                                                {inflows.map(c => {
                                                    const w = Math.pow(c.diameterMm || 600, 2);
                                                    const pct = ((w / totalInWeight) * 100).toFixed(1);
                                                    return (
                                                        <div key={c.id} style={{display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: 11}}>
                                                            <div style={{width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4, color: '#10b981'}} title={c.name}>{c.name}</div>
                                                            <div style={{flex: 1, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden', marginRight: 8}}>
                                                                <div style={{width: `${pct}%`, height: '100%', background: '#10b981'}} />
                                                            </div>
                                                            <div style={{width: 35, textAlign: 'right'}}>{pct}%</div>
                                                        </div>
                                                    );
                                                })}
                                                {inflows.length === 0 && <div style={{fontSize: 11, color: '#64748b'}}>无进气管线</div>}
                                            </div>
                                            {/* 出气流向区域 */}
                                            <div>
                                                <div style={{fontSize: 12, color: '#94a3b8', marginBottom: 4}}>出气配比 (Outflow)</div>
                                                {outflows.map(c => {
                                                    const w = Math.pow(c.diameterMm || 600, 2);
                                                    const pct = ((w / totalOutWeight) * 100).toFixed(1);
                                                    return (
                                                        <div key={c.id} style={{display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: 11}}>
                                                            <div style={{width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4, color: '#3b82f6'}} title={c.name}>{c.name}</div>
                                                            <div style={{flex: 1, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden', marginRight: 8}}>
                                                                <div style={{width: `${pct}%`, height: '100%', background: '#3b82f6'}} />
                                                            </div>
                                                            <div style={{width: 35, textAlign: 'right'}}>{pct}%</div>
                                                        </div>
                                                    );
                                                })}
                                                {outflows.length === 0 && <div style={{fontSize: 11, color: '#64748b'}}>无出气管线</div>}
                                            </div>
                                            {/* 内部原节点列表 */}
                                            <div style={{marginTop: 8, fontSize: 11, color: '#64748b', background: '#0f172a', padding: 6, borderRadius: 4}}>
                                                <strong>内部合并站场:</strong> {selectedNode.properties.original_stations?.join(', ') || '未知'}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
        {debugActionsEnabled && (
            <SimPanel
                scenarioId={currentScenario}
                scenarios={scenarioOptions}
                isLoading={simLoading}
                snapshotLoading={snapshotLoading}
                baselineSnapshotLoading={baselineSnapshotLoading}
                error={simError}
                snapshotError={snapshotError}
                overlay={overlay}
                snapshots={snapshots}
                selectedSnapshotRunId={selectedSnapshotRunId}
                baselineSnapshotRunId={baselineSnapshotRunId}
                trialRunScenarioId={trialRunScenarioId}
                bulkTrialRunActive={bulkTrialRunActive}
                comparison={comparison}
                trialRunItems={trialRunItems}
                onScenarioChange={setScenario}
                onSnapshotSelect={setSelectedSnapshotRunId}
                onBaselineSnapshotSelect={setBaselineSnapshotRunId}
                onRun={runSimulation}
                onSaveSnapshot={saveSnapshot}
                onRefreshSnapshots={refreshSnapshots}
                onLoadSnapshot={loadSelectedSnapshot}
                onRunTrialScenario={runTrialScenario}
                onRunMissingTrialScenarios={runMissingTrialScenarios}
                onClear={clearOverlay}
            />
        )}
        </>
    );
};

export default TopologyView;
