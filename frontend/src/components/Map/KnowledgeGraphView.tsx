import { useEffect, useState, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchKnowledgeGraph, type KnowledgeGraphMeta } from '../../api/client';

const DEBOUNCE_MS = 400;
/** 实时锚点下按该粒度拉取，避免每 10s 推进导致重复请求与力导图重排 */
const UNTIL_BUCKET_MS = 5 * 60 * 1000;
/** 实时模式下锚点桶跨越 ≥ 该值（×5min）才再次 zoomToFit */
const ZOOM_LIVE_BUCKET_DELTA = 12;
const REPORT_FAIL_PATTERN = /(分析生成失败，请稍后重试。?|研判暂不可用|暂无法生成研判)/;

function sanitizeGraphText(text: unknown, group?: string): string {
    const s = String(text ?? '').trim();
    if (!s) return '';
    if (group === 'report' && REPORT_FAIL_PATTERN.test(s)) return '研判暂不可用';
    return s;
}

function graphPayloadSignature(nodes: any[], links: any[]): string {
    const nodeIds = nodes.map((n) => String(n.id)).sort().join('\0');
    const linkKeys = links
        .map((l) => {
            const s = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
            const t = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
            return `${s}->${t}`;
        })
        .sort()
        .join('\0');
    return `n${nodes.length}|l${links.length}\n${nodeIds}\n${linkKeys}`;
}

function buildKnowledgeGraphDisplay(
    rawGraphData: { nodes: any[]; links: any[] },
    interpretation: boolean,
    opts:
        | { backendWindowed: true }
        | { backendWindowed: false; timelineTo: Date | null; lookbackDays: number }
): { nodes: any[]; links: any[] } {
    if (!rawGraphData.nodes || rawGraphData.nodes.length === 0) return { nodes: [], links: [] };

    let dynamicNodeIds: Set<string>;

    if (opts.backendWindowed) {
        const dynamicNodes = rawGraphData.nodes.filter(
            (node) => node.group !== 'location' && node.group !== 'tag'
        );
        dynamicNodeIds = new Set(dynamicNodes.map((n) => n.id));
    } else {
        const now = opts.timelineTo ? opts.timelineTo.getTime() : Date.now();
        const cutoffUpper = now;
        const LOOKBACK_MS = opts.lookbackDays * 24 * 60 * 60 * 1000;
        const cutoffLower = cutoffUpper - LOOKBACK_MS;
        const dynamicNodes = rawGraphData.nodes.filter((node) => {
            if (node.group === 'location' || node.group === 'tag') return false;
            if (node.group === 'thread' || node.group === 'report') return false;
            if (!node.time) return true;
            const nodeTime = new Date(node.time).getTime();
            if (isNaN(nodeTime)) return true;
            if (nodeTime > cutoffUpper || nodeTime < cutoffLower) return false;
            return true;
        });
        dynamicNodeIds = new Set(dynamicNodes.map((n) => n.id));
    }

    const activeLinks = rawGraphData.links.filter((link) => {
        const sid = typeof link.source === 'object' ? link.source.id : link.source;
        const tid = typeof link.target === 'object' ? link.target.id : link.target;
        return dynamicNodeIds.has(sid) || dynamicNodeIds.has(tid);
    });

    const linkedStaticNodeIds = new Set<string>();
    activeLinks.forEach((l) => {
        const sid = typeof l.source === 'object' ? l.source.id : l.source;
        const tid = typeof l.target === 'object' ? l.target.id : l.target;
        if (!dynamicNodeIds.has(sid)) linkedStaticNodeIds.add(sid);
        if (!dynamicNodeIds.has(tid)) linkedStaticNodeIds.add(tid);
    });

    let visibleNodes = rawGraphData.nodes.filter(
        (n) => dynamicNodeIds.has(n.id) || linkedStaticNodeIds.has(n.id)
    );

    let visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    let finalLinks = activeLinks.filter((l) => {
        const sid = typeof l.source === 'object' ? l.source.id : l.source;
        const tid = typeof l.target === 'object' ? l.target.id : l.target;
        return visibleNodeIds.has(sid) && visibleNodeIds.has(tid);
    });

    if (interpretation) {
        const nodeIdsWithLinks = new Set<string>();
        finalLinks.forEach((l) => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            nodeIdsWithLinks.add(sid);
            nodeIdsWithLinks.add(tid);
        });
        visibleNodes = visibleNodes.filter(
            (n) => nodeIdsWithLinks.has(n.id) || n.group === 'thread' || n.group === 'report'
        );
        visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
        finalLinks = finalLinks.filter((l) => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return visibleNodeIds.has(sid) && visibleNodeIds.has(tid);
        });
    }

    return { nodes: visibleNodes, links: finalLinks };
}

interface Props {
    timelineTo: Date | null;
    /** 为 true 时按 5 分钟桶拉取并冻结前端窗口锚点，减轻 Live  tick 抖动 */
    timelineLive?: boolean;
}

export default function KnowledgeGraphView({ timelineTo, timelineLive = false }: Props) {
    const [rawGraphData, setRawGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
    const [graphMeta, setGraphMeta] = useState<KnowledgeGraphMeta | null>(null);
    const [lookbackDays, setLookbackDays] = useState(7);
    const [interpretation, setInterpretation] = useState(true);
    const [loading, setLoading] = useState(true);
    const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    /** 实时模式下用于前端过滤的 until，与最近一次成功请求的锚点对齐，避免每 10s 变引用触发重排 */
    const [liveDisplayUntilMs, setLiveDisplayUntilMs] = useState<number | null>(null);

    const fgRef = useRef<any>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);
    const requestSeqRef = useRef(0);
    const hasLoadedOnceRef = useRef(false);
    const lastAppliedSigRef = useRef('');
    const lastZoomBucketRef = useRef<number>(-999999);
    const forceZoomNextFetchRef = useRef(true);
    const pendingZoomToFitRef = useRef(false);

    const anchorDate = timelineTo ?? new Date();
    const untilBucketKey = Math.floor(anchorDate.getTime() / UNTIL_BUCKET_MS);
    const timelineFetchDep = timelineLive ? untilBucketKey : anchorDate.getTime();

    const fetchParamsRef = useRef({
        interpretation,
        lookbackDays,
        timelineTo,
        timelineLive,
    });
    fetchParamsRef.current = { interpretation, lookbackDays, timelineTo, timelineLive };

    const effectiveFilterUntil: Date | null = useMemo(() => {
        if (timelineLive && liveDisplayUntilMs != null) return new Date(liveDisplayUntilMs);
        if (timelineLive) {
            return new Date((untilBucketKey + 1) * UNTIL_BUCKET_MS - 1);
        }
        return timelineTo;
    }, [timelineLive, liveDisplayUntilMs, timelineTo, untilBucketKey]);

    useEffect(() => {
        forceZoomNextFetchRef.current = true;
    }, [interpretation, lookbackDays]);

    useEffect(() => {
        if (!timelineLive) setLiveDisplayUntilMs(null);
    }, [timelineLive]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            const { interpretation: interp, lookbackDays: daysLb, timelineTo: to, timelineLive: live } =
                fetchParamsRef.current;
            const days = Math.max(1, Math.min(365, daysLb));
            const until = to ?? new Date();

            if (fetchAbortRef.current) fetchAbortRef.current.abort();
            const controller = new AbortController();
            fetchAbortRef.current = controller;
            const seq = ++requestSeqRef.current;

            const isFirstLoad = !hasLoadedOnceRef.current;
            if (isFirstLoad) setLoading(true);
            else setBackgroundRefreshing(true);

            fetchKnowledgeGraph(days, interp, false, until, controller.signal)
                .then((data) => {
                    if (seq !== requestSeqRef.current) return;
                    const nodes = data.nodes ?? [];
                    const links = data.links ?? [];
                    setGraphMeta(data.meta ?? null);

                    const sig = graphPayloadSignature(nodes, links);
                    if (sig !== lastAppliedSigRef.current) {
                        lastAppliedSigRef.current = sig;
                        setRawGraphData({ nodes, links });
                    }

                    if (live) setLiveDisplayUntilMs(until.getTime());

                    const bucket = Math.floor(until.getTime() / UNTIL_BUCKET_MS);
                    let shouldZoom = false;
                    if (forceZoomNextFetchRef.current) {
                        shouldZoom = true;
                        forceZoomNextFetchRef.current = false;
                    } else if (isFirstLoad && nodes.length > 0) {
                        shouldZoom = true;
                    } else if (!live) {
                        shouldZoom = nodes.length > 0;
                    } else if (Math.abs(bucket - lastZoomBucketRef.current) >= ZOOM_LIVE_BUCKET_DELTA) {
                        shouldZoom = nodes.length > 0;
                    }

                    if (shouldZoom && nodes.length > 0) {
                        lastZoomBucketRef.current = bucket;
                        pendingZoomToFitRef.current = true;
                    }

                    hasLoadedOnceRef.current = true;
                    setLoading(false);
                    setBackgroundRefreshing(false);
                    setLastUpdated(new Date());
                })
                .catch((err: { name?: string; code?: string; message?: string }) => {
                    const canceled =
                        err?.name === 'CanceledError' ||
                        err?.code === 'ERR_CANCELED' ||
                        (typeof err?.message === 'string' && err.message.toLowerCase().includes('cancel'));
                    if (canceled) return;
                    console.error('Failed to load knowledge graph', err);
                    if (seq === requestSeqRef.current) {
                        setLoading(false);
                        setBackgroundRefreshing(false);
                    }
                });
        }, DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [interpretation, lookbackDays, timelineFetchDep, timelineLive]);

    useEffect(() => {
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, []);

    const colorMap: Record<string, string> = useMemo(
        () => ({
            event: '#ff4444',
            news: '#44aaff',
            location: '#44ffaa',
            report: '#ffcc00',
            tag: '#aaffff',
            thread: '#bf00ff',
        }),
        []
    );

    const ws = graphMeta?.window_start ?? '';
    const we = graphMeta?.window_end ?? '';
    const hasBackendWindow = !!(ws && we);

    const displayWindowed = useMemo(
        () => buildKnowledgeGraphDisplay(rawGraphData, interpretation, { backendWindowed: true }),
        [rawGraphData, interpretation, ws, we]
    );

    const displayLegacy = useMemo(
        () =>
            buildKnowledgeGraphDisplay(rawGraphData, interpretation, {
                backendWindowed: false,
                timelineTo: effectiveFilterUntil,
                lookbackDays,
            }),
        [rawGraphData, interpretation, effectiveFilterUntil, lookbackDays]
    );

    const displayData = hasBackendWindow ? displayWindowed : displayLegacy;

    const untilKeyLabel = `${untilBucketKey}`;

    return (
        <div style={{ width: '100%', height: '100%', background: '#0a0e14', position: 'relative' }}>
            <ForceGraph2D
                ref={fgRef}
                graphData={displayData}
                nodeAutoColorBy="group"
                onEngineStop={() => {
                    if (loading) return;
                    if (!pendingZoomToFitRef.current) return;
                    pendingZoomToFitRef.current = false;
                    requestAnimationFrame(() => {
                        try {
                            fgRef.current?.zoomToFit(400, 50);
                        } catch {
                            /* ignore */
                        }
                    });
                }}
                nodeLabel={(node: any) => `
                  <div style="background: rgba(0,0,0,0.85); color: #fff; padding: 10px; border: 1px solid #1e2d40; border-radius: 4px; font-size: 12px; max-width: 320px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
                        <strong style="color: ${colorMap[node.group] || '#00d4ff'}; text-transform: uppercase; font-size: 10px; letter-spacing: 1px;">[ ${node.group_zh || node.group} ]</strong>
                        ${node.time ? `<span style="color: #556677; font-size: 10px;">${new Date(node.time).toLocaleDateString()}</span>` : ''}
                    </div>
                    <div style="color: #e0e0e0; font-weight: 600; line-height: 1.4; border-left: 2px solid ${colorMap[node.group] || '#00d4ff'}; padding-left: 8px;">${sanitizeGraphText(node.title || node.label, node.group)}</div>
                    ${sanitizeGraphText(node.desc, node.group) ? `<div style="margin-top: 8px; color: #8b9ab0; font-size: 11px; font-style: italic;">"${sanitizeGraphText(node.desc, node.group)}"</div>` : ''}
                    ${node.impact_score ? `<div style="margin-top: 8px; font-size: 10px; color: #ffcc00;">影响力权重: ${node.impact_score}</div>` : ''}
                  </div>
                `}
                nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = sanitizeGraphText(node.label || '', (node as any).group);
                    const fontSize = Math.max(12 / globalScale, 2);

                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map((n) => n + fontSize * 0.2);

                    const baseR = Math.sqrt(Math.max(node.val || 1, 1)) * 2;
                    const r = node.group === 'thread' ? baseR * 1.5 : baseR;

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fillStyle = colorMap[node.group] || node.color;
                    ctx.fill();

                    if (node.group === 'thread') {
                        ctx.strokeStyle = '#bf00ff88';
                        ctx.lineWidth = 2 / globalScale;
                        ctx.stroke();
                    }

                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(
                        node.x - bckgDimensions[0] / 2,
                        node.y - r - bckgDimensions[1] - 2,
                        bckgDimensions[0],
                        bckgDimensions[1]
                    );

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(label, node.x, node.y - r - bckgDimensions[1] / 2 - 2);
                }}
                nodePointerAreaPaint={(node, color, ctx) => {
                    const r = Math.sqrt(Math.max(node.val || 1, 1)) * 2;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false);
                    ctx.fill();
                }}
                linkDirectionalArrowLength={(link: any) => (link.type === 'causal' ? 4 : 2)}
                linkDirectionalArrowRelPos={1}
                linkCurvature={(link: any) => link.curvature || 0}
                linkColor={(link: any) => {
                    if (!interpretation && link.dashed) return 'rgba(255,255,255,0.26)';
                    return link.color ? link.color : link.dashed ? 'rgba(30, 45, 64, 0.3)' : '#1e2d40';
                }}
                linkLineDash={(link: any) => (link.dashed ? [2, 2] : null)}
                linkCanvasObjectMode={() => 'after'}
                linkCanvasObject={(link: any, ctx, globalScale) => {
                    if (!link.label || globalScale < 1.2) return;
                    const start = link.source;
                    const end = link.target;
                    if (typeof start !== 'object' || typeof end !== 'object') return;
                    if (start.x === undefined || end.x === undefined) return;

                    const textPos = {
                        x: start.x + (end.x - start.x) / 2,
                        y: start.y + (end.y - start.y) / 2,
                    };

                    const fontSize = Math.max(8 / globalScale, 1.5);
                    ctx.font = `${fontSize}px Sans-Serif`;

                    ctx.fillStyle = link.type === 'causal' ? '#ffaa00' : 'rgba(255, 255, 255, 0.4)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(link.label, textPos.x, textPos.y);
                }}
            />
            {loading && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#00d4ff',
                        fontSize: '14px',
                        textAlign: 'center',
                        zIndex: 10,
                        background: 'rgba(0,0,0,0.7)',
                        padding: '20px',
                        borderRadius: '8px',
                        border: '1px solid #00d4ff44',
                    }}
                >
                    <div className="live-dot" style={{ margin: '0 auto 10px' }} />
                    正在调取态势神经元...
                </div>
            )}

            {backgroundRefreshing && !loading && (
                <div
                    style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        zIndex: 10,
                        fontSize: '10px',
                        color: '#00d4ff',
                        background: 'rgba(0,0,0,0.65)',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #00d4ff44',
                    }}
                >
                    后台同步中…
                </div>
            )}

            {!loading && displayData.nodes.length === 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#ff4444',
                        fontSize: '14px',
                        textAlign: 'center',
                        zIndex: 10,
                        background: 'rgba(0,0,0,0.7)',
                        padding: '20px',
                        borderRadius: '8px',
                        border: '1px solid #ff444444',
                    }}
                >
                    ⚠️ 当前窗口无匹配情报
                    <br />
                    <span
                        style={{ fontSize: '11px', color: '#8b9ab0', marginTop: '5px', display: 'block' }}
                    >
                        请尝试调整底部时间轴（锚点）或左上角窗口宽度（天）
                    </span>
                    <span
                        style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', display: 'block' }}
                    >
                        超出数据覆盖范围部分无数据
                    </span>
                </div>
            )}

            <div
                style={{
                    position: 'absolute',
                    top: 20,
                    left: 20,
                    color: '#8b9ab0',
                    fontSize: '12px',
                    background: 'rgba(8, 12, 18, 0.85)',
                    backdropFilter: 'blur(10px)',
                    padding: '15px',
                    borderRadius: '8px',
                    border: '1px solid #1e2d40',
                    fontFamily: 'monospace',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    minWidth: '280px',
                }}
            >
                <div
                    style={{
                        color: '#00d4ff',
                        marginBottom: '16px',
                        fontWeight: 'bold',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <span>[ OSINT 态势导图 ]</span>
                    <span style={{ fontSize: '10px', opacity: 0.6 }}>
                        {timelineTo ? '锚点·时间轴' : '锚点·实时'}
                    </span>
                </div>

                <div
                    style={{
                        marginBottom: '12px',
                        fontSize: '9px',
                        color: '#556677',
                        lineHeight: 1.5,
                        borderBottom: '1px solid #ffffff11',
                        paddingBottom: '10px',
                    }}
                >
                    <div>
                        刷新粒度：{timelineLive ? `实时·5min 桶 #${untilKeyLabel}` : '锚点随动'}
                    </div>
                    <div>
                        最近更新：
                        {lastUpdated
                            ? lastUpdated.toLocaleTimeString('zh-CN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                              })
                            : '—'}
                    </div>
                    {backgroundRefreshing && !loading ? <div style={{ color: '#00d4ff' }}>状态：后台刷新</div> : null}
                </div>

                <div
                    style={{
                        marginBottom: '15px',
                        padding: '8px 12px',
                        background: 'rgba(0,212,255,0.05)',
                        borderRadius: '4px',
                        border: '1px solid rgba(0,212,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span
                        style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: interpretation ? '#00d4ff' : '#8b9ab0',
                        }}
                    >
                        {interpretation ? 'AI 研判模式（聚合）' : '原始情报模式（纷杂）'}
                    </span>
                    <div
                        onClick={() => setInterpretation(!interpretation)}
                        style={{
                            width: '40px',
                            height: '20px',
                            background: interpretation ? 'rgba(0, 212, 255, 0.4)' : '#1e2d40',
                            borderRadius: '10px',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            border: `1px solid ${interpretation ? '#00d4ff' : '#30475e'}`,
                        }}
                    >
                        <div
                            style={{
                                width: '14px',
                                height: '14px',
                                background: interpretation ? '#00d4ff' : '#8b9ab0',
                                borderRadius: '50%',
                                position: 'absolute',
                                top: '2px',
                                left: interpretation ? '22px' : '2px',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: interpretation ? '0 0 8px #00d4ff' : 'none',
                            }}
                        />
                    </div>
                </div>

                <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '10px' }}>
                        <span>窗口宽度（天）</span>
                        <span style={{ color: '#00d4ff' }}>{lookbackDays} 天</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="30"
                        value={lookbackDays}
                        onChange={(e) => setLookbackDays(parseInt(e.target.value, 10))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#00d4ff' }}
                    />
                    {graphMeta && (
                        <div style={{ marginTop: '8px', fontSize: '9px', color: '#556677' }}>
                            当前窗口：
                            {new Date(graphMeta.window_start).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}{' '}
                            ~{' '}
                            {new Date(graphMeta.window_end).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                            {interpretation ? (
                                <div style={{ marginTop: '4px' }}>
                                    研判报告：有效 {graphMeta.report_valid ?? 0} / 总计 {graphMeta.report_total ?? 0}
                                    {(graphMeta.report_filtered_failed ?? 0) > 0
                                        ? `（已过滤失败 ${graphMeta.report_filtered_failed}）`
                                        : ''}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.event }} />
                        <span>战事事件</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.news }} />
                        <span>新闻情报</span>
                    </div>
                    {interpretation ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.thread }} />
                            <span>叙事脉络</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: 8, borderBottom: '2px dashed rgba(255,255,255,0.4)', height: 0 }} />
                            <span>语义关联</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.tag }} />
                        <span>核心关键词</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.location }} />
                        <span>地理实体</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colorMap.report }} />
                        <span>分析研判</span>
                    </div>
                </div>

                <div
                    style={{
                        marginTop: '12px',
                        paddingTop: '8px',
                        borderTop: '1px solid #ffffff11',
                        fontSize: '9px',
                        color: '#445566',
                        fontStyle: 'italic',
                    }}
                >
                    {interpretation
                        ? '* 紫色枢纽自动聚合逻辑线索，琥珀色箭头代表因果推演。'
                        : '* 原始情报模式：虚线为地理/主题隐性关联，呈现纷杂态势。'}
                </div>
            </div>
        </div>
    );
}
