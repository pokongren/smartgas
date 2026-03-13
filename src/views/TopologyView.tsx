import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import '../styles/topology-view.css';
import { ALL_PIPELINES } from '@/data/pipelines';

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

const NODE_RADIUS = 16;
const CRITICAL_RADIUS = 22;

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
    selectedNodeId: string | null,
    searchMatchIds: Set<string>,
    width: number,
    height: number,
    zoom: number,
    panX: number,
    panY: number,
): void {
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

        const color = EDGE_COLORS[edge.category] || EDGE_COLORS.default;
        ctx.strokeStyle = color;
        ctx.lineWidth = (edge.category === 'trunk' ? 3 : 1.5) / zoom;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();

        // 箭头
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        const arrowLen = 8 / zoom;
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(midX + arrowLen * Math.cos(angle), midY + arrowLen * Math.sin(angle));
        ctx.lineTo(midX + arrowLen * Math.cos(angle + 2.5), midY + arrowLen * Math.sin(angle + 2.5));
        ctx.lineTo(midX + arrowLen * Math.cos(angle - 2.5), midY + arrowLen * Math.sin(angle - 2.5));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // 画节点
    for (const node of nodes) {
        const isCritical = criticalSet.has(node.id);
        const isHovered = hoveredNodeId === node.id;
        const isSelected = selectedNodeId === node.id;
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

        // SCADA 实时参数挂载渲染（如果有数据则始终显示在节点正上方）
        const scadaData = REAL_SCADA_DATA[node.name];
        if (scadaData) {
            const inText = `入 P:${scadaData.inP.toFixed(2)} ${scadaData.inT ? `T:${scadaData.inT}` : ''}`;
            const outText = `出 P:${scadaData.outP.toFixed(2)} ${scadaData.outT ? `T:${scadaData.outT}` : ''}`;

            ctx.textAlign = 'center';
            ctx.font = `${9 / zoom}px Inter, sans-serif`;

            // 绘制上方第一行：进站参数 (绿)
            ctx.fillStyle = '#10b981';
            ctx.fillText(inText, node.x, node.y - radius - 14 / zoom);

            // 绘制上方第二行：出站参数 (蓝)
            ctx.fillStyle = '#3b82f6';
            ctx.fillText(outText, node.x, node.y - radius - 4 / zoom);
        }
    }

    ctx.restore();
}

// ============ 主组件 ============

const TopologyView: React.FC = () => {
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
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [draggingNode, setDraggingNode] = useState<TopoNode | null>(null);

    // 缩放与平移
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const criticalSetRef = useRef(new Set<string>());

    // ============ 获取数据 ============
    useEffect(() => {
        fetch('http://localhost:8000/api/topology/graph')
            .then(r => {
                if (!r.ok) throw new Error(`API Error: ${r.status}`);
                return r.json();
            })
            .then((json: TopoData) => {
                console.log('[Topology] Data loaded:', json.nodes?.length, 'nodes,', json.edges?.length, 'edges');
                console.log('[Topology] Sample node:', json.nodes?.[0]);
                console.log('[Topology] Node types:', [...new Set(json.nodes?.map(n => n.type) || [])]);
                setRawData(json);
                criticalSetRef.current = new Set(json.criticalNodes);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch topology data:', err);
                setLoading(false);
            });
    }, []);

    // ============ 构建前端硬编码管线与节点的映射 ============
    // nodeName -> Set of Package Names
    const nodePackagesMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        ALL_PIPELINES.forEach(pkg => {
            pkg.layers.forEach(layer => {
                layer.nodes.forEach(n => {
                    if (!map.has(n.name)) map.set(n.name, new Set());
                    map.get(n.name)!.add(pkg.name);
                });
            });
        });
        return map;
    }, []);

    // 管线选择器列表
    const pipelinePackages = useMemo(() => ALL_PIPELINES, []);

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

    // ============ 过滤变化时重新初始化布局 ============
    useEffect(() => {
        if (!rawData || loading) return;
        const canvas = canvasRef.current;
        const w = canvas?.width ? canvas.width / (window.devicePixelRatio || 1) : window.innerWidth;
        const h = canvas?.height ? canvas.height / (window.devicePixelRatio || 1) : window.innerHeight;

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
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setSelectedNodeId(null);
        setHoveredNodeId(null);
    }, [filteredNodes, filteredEdges, loading, rawData]);

    // ============ Canvas 尺寸 ============
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            const ctx = canvas.getContext('2d');
            ctx?.scale(dpr, dpr);
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);

    // ============ 动画循环 ============
    useEffect(() => {
        if (loading) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const animate = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (alphaRef.current > 0.005) {
                simulateForces(nodesRef.current, edgesRef.current, w, h, alphaRef.current);
                alphaRef.current *= 0.995;
            }
            drawGraph(ctx, nodesRef.current, edgesRef.current, criticalSetRef.current,
                hoveredNodeId, selectedNodeId, searchMatchIds, w, h, zoom, pan.x, pan.y);
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animFrameRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [loading, hoveredNodeId, selectedNodeId, searchMatchIds, zoom, pan]);

    // ============ 鼠标坐标转换（考虑缩放和平移） ============
    const screenToWorld = useCallback((sx: number, sy: number) => {
        return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
    }, [zoom, pan]);

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
            setPan({
                x: panStartRef.current.panX + (sx - panStartRef.current.x),
                y: panStartRef.current.panY + (sy - panStartRef.current.y),
            });
            return;
        }

        if (draggingNode) {
            const { x, y } = screenToWorld(sx, sy);
            draggingNode.fx = x;
            draggingNode.fy = y;
            alphaRef.current = Math.max(alphaRef.current, 0.1);
            return;
        }

        const { x, y } = screenToWorld(sx, sy);
        const node = findNodeAt(x, y);
        setHoveredNodeId(node?.id || null);
        if (canvasRef.current) {
            canvasRef.current.style.cursor = node ? 'pointer' : 'grab';
        }
    }, [draggingNode, findNodeAt, screenToWorld]);

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
            setDraggingNode(node);
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        } else {
            // 开始平移
            isPanningRef.current = true;
            panStartRef.current = { x: sx, y: sy, panX: pan.x, panY: pan.y };
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        }
    }, [findNodeAt, screenToWorld, pan]);

    const handleMouseUp = useCallback(() => {
        if (draggingNode) {
            draggingNode.fx = null;
            draggingNode.fy = null;
            setDraggingNode(null);
        }
        isPanningRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    }, [draggingNode]);

    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const node = findNodeAt(x, y);
        setSelectedNodeId(node?.id || null);
    }, [findNodeAt, screenToWorld]);

    // 滚轮缩放
    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, zoom * factor));

        // 以鼠标位置为缩放中心
        const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
        const newPanY = my - (my - pan.y) * (newZoom / zoom);

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    }, [zoom, pan]);

    // 搜索定位
    const handleSearchLocate = useCallback(() => {
        if (searchMatchIds.size === 0) return;
        const firstId = [...searchMatchIds][0];
        const node = nodesRef.current.find(n => n.id === firstId);
        if (!node) return;
        // 居中到该节点
        const w = window.innerWidth;
        const h = window.innerHeight;
        setZoom(1.5);
        setPan({ x: w / 2 - node.x * 1.5, y: h / 2 - node.y * 1.5 });
        setSelectedNodeId(firstId);
    }, [searchMatchIds]);

    // 重置视图
    const handleReset = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        alphaRef.current = 1;
        for (const n of nodesRef.current) {
            n.vx = (Math.random() - 0.5) * 5;
            n.vy = (Math.random() - 0.5) * 5;
            n.fx = null;
            n.fy = null;
        }
    }, []);

    // 获取选中节点的连接管线
    const getNodeConnections = useCallback((nodeId: string) => {
        if (!rawData) return [];
        return rawData.edges.filter(e => e.source === nodeId || e.target === nodeId);
    }, [rawData]);

    const selectedNode = selectedNodeId
        ? nodesRef.current.find(n => n.id === selectedNodeId) || null
        : null;

    return (
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
                onWheel={handleWheel}
            />

            {/* ====== 底部工具栏 ====== */}
            <div className="topology-toolbar">
                <button className="toolbar-btn" onClick={() => setZoom(z => Math.min(5, z * 1.3))}>
                    <span className="material-symbols-outlined">zoom_in</span>
                </button>
                <button className="toolbar-btn" onClick={() => setZoom(z => Math.max(0.1, z * 0.7))}>
                    <span className="material-symbols-outlined">zoom_out</span>
                </button>
                <button className="toolbar-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
                    <span className="material-symbols-outlined">fit_screen</span>
                </button>
                <span className="toolbar-divider" />
                <button className="toolbar-btn" onClick={handleReset}>
                    <span className="material-symbols-outlined">refresh</span>
                    重置
                </button>
                <span className="toolbar-zoom">{Math.round(zoom * 100)}%</span>
            </div>

            {/* ====== 西一线 SCADA 浮动参数表（新版） ====== */}
            <div style={{
                position: 'absolute',
                left: '24px',
                bottom: '80px',
                width: '480px',
                height: '295px',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 100,
                pointerEvents: 'auto',
                userSelect: 'none',
                background: 'linear-gradient(135deg, rgba(10,20,30,0.92) 0%, rgba(15,30,20,0.92) 100%)',
                backdropFilter: 'blur(12px)',
                borderRadius: '10px',
                border: '1px solid rgba(16,185,129,0.3)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                overflow: 'hidden',
            }}>
                {/* 顶部装饰条 */}
                <div style={{ height: '3px', background: 'linear-gradient(90deg, #10b981, #059669, #10b981)', borderRadius: '10px 10px 0 0' }} />
                <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#10b981' }}>sensors</span>
                    <span style={{ fontWeight: 'bold', color: '#a7f3d0', fontSize: '13px' }}>西气东输一线</span>
                    <span style={{ color: '#10b981', fontSize: '10px', background: 'rgba(16,185,129,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(16,185,129,0.3)' }}>SCADA 实时</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px', scrollbarWidth: 'thin', scrollbarColor: '#10b98140 transparent' } as React.CSSProperties}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: '12px' }}>
                        <thead>
                            <tr style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                                <th style={{ padding: '2px 6px', textAlign: 'left', fontWeight: 600 }}>站名</th>
                                <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>类型</th>
                                <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>进站压力</th>
                                <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>进温</th>
                                <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>出站压力</th>
                                <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>出温</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(REAL_SCADA_DATA).map(([name, data]) => {
                                const isCompressor = /压气站/.test(name);
                                const typeBadge = isCompressor ? '压' : '分';
                                const rowBg = isCompressor ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,0.03)';
                                const pColor = (p: number) => p < 6 ? '#f97316' : p > 10 ? '#ef4444' : '#34d399';
                                return (
                                    <tr key={name} style={{ background: rowBg }}>
                                        <td style={{ padding: '5px 6px', borderRadius: '6px 0 0 6px', fontWeight: isCompressor ? 600 : 400, color: '#e2e8f0', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</td>
                                        <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                                            <span style={{ fontSize: '10px', background: isCompressor ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)', color: isCompressor ? '#10b981' : '#94a3b8', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>{typeBadge}</span>
                                        </td>
                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: pColor(data.inP), fontWeight: 600 }}>{data.inP.toFixed(3)}</td>
                                        <td style={{ padding: '5px 4px', textAlign: 'center', color: '#f97316', fontSize: '11px' }}>{data.inT != null ? `${data.inT}°` : '—'}</td>
                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: pColor(data.outP), fontWeight: 600 }}>{data.outP.toFixed(3)}</td>
                                        <td style={{ padding: '5px 4px', textAlign: 'center', color: '#fb923c', fontSize: '11px', borderRadius: '0 6px 6px 0' }}>{data.outT != null ? `${data.outT}°` : '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ====== 节点详情侧边栏 ====== */}
            <div className={`topology-detail-panel ${selectedNode ? 'open' : ''}`}>
                {selectedNode && (
                    <>
                        <button className="detail-close" onClick={() => setSelectedNodeId(null)}>
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
                    </>
                )}
            </div>
        </div>
    );
};

export default TopologyView;
