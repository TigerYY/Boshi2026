import { useEffect, useState, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchKnowledgeGraph } from '../../api/client';

interface Props {
    timelineTo: Date | null;
}

export default function KnowledgeGraphView({ timelineTo }: Props) {
    const [rawGraphData, setRawGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
    const [lookbackDays, setLookbackDays] = useState(7);
    const [interpretation, setInterpretation] = useState(true);
    const [loading, setLoading] = useState(true);
    const fgRef = useRef<any>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        // 预取最近 30 天的数据（根据研判模式动态切换）
        fetchKnowledgeGraph(30, interpretation).then(data => {
            if (mounted) {
                setRawGraphData(data);
                setLoading(false);
            }
        }).catch(err => {
            console.error("Failed to load knowledge graph", err);
            if (mounted) setLoading(false);
        });
        return () => { mounted = false; };
    }, [interpretation]);

    const colorMap: Record<string, string> = useMemo(() => ({
        event: '#ff4444',
        news: '#44aaff',
        location: '#44ffaa',
        report: '#ffcc00',
        tag: '#aaffff',
        thread: '#bf00ff' // 紫色代表叙事聚合枢纽
    }), []);

    // ── 时间轴联动核心逻辑 (引入滑动窗口衰减) ──────────────────────────────────
    const displayData = useMemo(() => {
        const now = timelineTo ? timelineTo.getTime() : Date.now();
        const cutoffUpper = now;
        const LOOKBACK_MS = lookbackDays * 24 * 60 * 60 * 1000;
        const cutoffLower = cutoffUpper - LOOKBACK_MS;

        if (!rawGraphData.nodes || rawGraphData.nodes.length === 0) return { nodes: [], links: [] };

        // 1. 预过滤核心动态节点 (基于时间的事件/新闻)
        const dynamicNodes = rawGraphData.nodes.filter(node => {
            // 地理节点和核心关键词不参与第一轮基于时间的“动态过滤”
            if (node.group === 'location' || node.group === 'tag') return false;
            // 叙事枢纽 (thread) 在 AI 模式下由关联的动态节点拉起，不直接决定窗口
            if (node.group === 'thread') return false;
            
            // 解析节点时间 (使用 ISO 字符串)
            if (!node.time) return true; // 若无时间属性则默认显示（如通用研判报告）
            
            const nodeTime = new Date(node.time).getTime();
            if (isNaN(nodeTime)) return true;

            if (nodeTime > cutoffUpper) return false;
            // 核心修复点：基于 lookbackDays 的滑动窗口过滤
            if (nodeTime < cutoffLower) return false;

            return true;
        });

        const dynamicNodeIds = new Set(dynamicNodes.map(n => n.id));

        // 2. 识别此时活跃的连结线
        const activeLinks = rawGraphData.links.filter(link => {
            const sid = typeof link.source === 'object' ? link.source.id : link.source;
            const tid = typeof link.target === 'object' ? link.target.id : link.target;
            return dynamicNodeIds.has(sid) || dynamicNodeIds.has(tid);
        });

        // 3. 确定最终可见的节点集
        const linkedStaticNodeIds = new Set<string>();
        activeLinks.forEach(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            if (!dynamicNodeIds.has(sid)) linkedStaticNodeIds.add(sid);
            if (!dynamicNodeIds.has(tid)) linkedStaticNodeIds.add(tid);
        });

        const visibleNodes = rawGraphData.nodes.filter(n => 
            dynamicNodeIds.has(n.id) || linkedStaticNodeIds.has(n.id)
        );

        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const finalLinks = activeLinks.filter(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return visibleNodeIds.has(sid) && visibleNodeIds.has(tid);
        });

        return { nodes: visibleNodes, links: finalLinks };
    }, [rawGraphData, timelineTo, lookbackDays]);

    return (
        <div style={{ width: '100%', height: '100%', background: '#0a0e14', position: 'relative' }}>
            <ForceGraph2D
                ref={fgRef}
                graphData={displayData}
                nodeAutoColorBy="group"
                onEngineStop={() => fgRef.current?.zoomToFit(400, 50)}
                nodeLabel={(node: any) => `
                  <div style="background: rgba(0,0,0,0.85); color: #fff; padding: 10px; border: 1px solid #1e2d40; border-radius: 4px; font-size: 12px; max-width: 320px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
                        <strong style="color: ${colorMap[node.group] || '#00d4ff'}; text-transform: uppercase; font-size: 10px; letter-spacing: 1px;">[ ${node.group_zh || node.group} ]</strong>
                        ${node.time ? `<span style="color: #556677; font-size: 10px;">${new Date(node.time).toLocaleDateString()}</span>` : ''}
                    </div>
                    <div style="color: #e0e0e0; font-weight: 600; line-height: 1.4; border-left: 2px solid ${colorMap[node.group] || '#00d4ff'}; padding-left: 8px;">${node.title || node.label}</div>
                    ${node.desc ? `<div style="margin-top: 8px; color: #8b9ab0; font-size: 11px; font-style: italic;">"${node.desc}"</div>` : ''}
                    ${node.impact_score ? `<div style="margin-top: 8px; font-size: 10px; color: #ffcc00;">影响力权重: ${node.impact_score}</div>` : ''}
                  </div>
                `}
                nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = node.label || '';
                    const fontSize = Math.max(12 / globalScale, 2);
                    
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

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
                    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - r - bckgDimensions[1] - 2, bckgDimensions[0], bckgDimensions[1]);

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
                linkDirectionalArrowLength={(link: any) => link.type === 'causal' ? 4 : 2}
                linkDirectionalArrowRelPos={1}
                linkCurvature={(link: any) => link.curvature || 0}
                linkColor={(link: any) => link.dashed ? 'rgba(30, 45, 64, 0.3)' : (link.color || '#1e2d40')}
                linkLineDash={(link: any) => link.dashed ? [2, 2] : null}
                linkCanvasObjectMode={() => 'after'}
                linkCanvasObject={(link: any, ctx, globalScale) => {
                    if (!link.label || globalScale < 1.2) return; 
                    const start = link.source;
                    const end = link.target;
                    if (typeof start !== 'object' || typeof end !== 'object') return;
                    if (start.x === undefined || end.x === undefined) return;

                    const textPos = {
                        x: start.x + (end.x - start.x) / 2,
                        y: start.y + (end.y - start.y) / 2
                    };

                    const fontSize = Math.max(8 / globalScale, 1.5);
                    ctx.font = `${fontSize}px Sans-Serif`;
                    
                    ctx.fillStyle = link.type === 'causal' ? '#ffaa00' : 'rgba(255, 255, 255, 0.4)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(link.label, textPos.x, textPos.y);
                }}
            />
            {/* Loading & Empty State Overlays */}
            {loading && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    color: '#00d4ff', fontSize: '14px', textAlign: 'center', zIndex: 10,
                    background: 'rgba(0,0,0,0.7)', padding: '20px', borderRadius: '8px', border: '1px solid #00d4ff44'
                }}>
                    <div className="live-dot" style={{ margin: '0 auto 10px' }} />
                    正在调取态势神经元...
                </div>
            )}
            
            {!loading && displayData.nodes.length === 0 && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    color: '#ff4444', fontSize: '14px', textAlign: 'center', zIndex: 10,
                    background: 'rgba(0,0,0,0.7)', padding: '20px', borderRadius: '8px', border: '1px solid #ff444444'
                }}>
                    ⚠️ 当前窗口无匹配情报<br/>
                    <span style={{ fontSize: '11px', color: '#8b9ab0', marginTop: '5px', display: 'block' }}>请尝试调整底部时间轴或左上角追溯深度</span>
                </div>
            )}

            {/* Overlay hint & Quick Controls */}
            <div style={{
                position: 'absolute', top: 20, left: 20, 
                color: '#8b9ab0', fontSize: '12px', background: 'rgba(8, 12, 18, 0.85)', 
                backdropFilter: 'blur(10px)',
                padding: '15px', borderRadius: '8px', border: '1px solid #1e2d40',
                fontFamily: 'monospace',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                minWidth: '280px'
            }}>
                <div style={{ color: '#00d4ff', marginBottom: '16px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                    <span>[ OSINT 态势导图 ]</span>
                    <span style={{ fontSize: '10px', opacity: 0.6 }}>BOSHI V1.3</span>
                </div>

                {/* AI Interpretation Toggle */}
                <div style={{ 
                    marginBottom: '15px', 
                    padding: '8px 12px', 
                    background: 'rgba(0,212,255,0.05)', 
                    borderRadius: '4px',
                    border: '1px solid rgba(0,212,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: interpretation ? '#00d4ff' : '#8b9ab0' }}>
                        {interpretation ? 'AI 研判模式: 逻辑激活' : 'AI 研判模式: 原始情报'}
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
                            border: `1px solid ${interpretation ? '#00d4ff' : '#30475e'}`
                        }}
                    >
                        <div style={{
                            width: '14px',
                            height: '14px',
                            background: interpretation ? '#00d4ff' : '#8b9ab0',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: '2px',
                            left: interpretation ? '22px' : '2px',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: interpretation ? '0 0 8px #00d4ff' : 'none'
                        }} />
                    </div>
                </div>
                
                {/* Local Lookback Slider */}
                <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '10px' }}>
                        <span>历史追溯深度</span>
                        <span style={{ color: '#00d4ff' }}>{lookbackDays} 天</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" 
                        max="30" 
                        value={lookbackDays} 
                        onChange={(e) => setLookbackDays(parseInt(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#00d4ff' }}
                    />
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
                </div>

                <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #ffffff11', fontSize: '9px', color: '#445566', fontStyle: 'italic' }}>
                    {interpretation 
                        ? '* 紫色枢纽自动聚合逻辑线索，琥珀色箭头代表因果推演。'
                        : '* 虚线连接代表地理或主题上的实地关联(隐性关联)。'
                    }
                </div>
            </div>
        </div>
    );
}
