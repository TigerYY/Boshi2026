import { useEffect, useState, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchKnowledgeGraph } from '../../api/client';

interface Props {
    timelineTo: Date | null;
}

export default function KnowledgeGraphView({ timelineTo }: Props) {
    const [rawGraphData, setRawGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
    const fgRef = useRef<any>(null);

    useEffect(() => {
        let mounted = true;
        // 预取最近 30 天的数据，以配合时间轴的深度回溯
        fetchKnowledgeGraph(30).then(data => {
            if (mounted) setRawGraphData(data);
        }).catch(err => console.error("Failed to load knowledge graph", err));
        return () => { mounted = false; };
    }, []);

    // ── 时间轴联动核心逻辑 (引入滑动窗口衰减) ──────────────────────────────────
    const displayData = useMemo(() => {
        if (!timelineTo) return rawGraphData;
        
        const cutoffUpper = timelineTo.getTime();
        // 定义“活跃窗口”：新闻类停留 3 天，重要事件停留 7 天
        const NEWS_WINDOW = 3 * 24 * 60 * 60 * 1000;
        const EVENT_WINDOW = 7 * 24 * 60 * 60 * 1000;
        
        // 1. 预过滤除地理/特征外的核心动态节点 (事件/新闻/研判)
        const dynamicNodes = rawGraphData.nodes.filter(node => {
            if (node.group === 'location' || node.group === 'tag') return false;
            if (!node.time) return true;
            
            const nodeTime = new Date(node.time).getTime();
            // 它是未来的节点 -> 不可见
            if (nodeTime > cutoffUpper) return false;

            // 它是过去的节点 -> 检查是否在滑动窗口内
            const age = cutoffUpper - nodeTime;
            if (node.group === 'event') return age <= EVENT_WINDOW;
            if (node.group === 'news' || node.group === 'report') return age <= NEWS_WINDOW;
            
            return true;
        });

        const dynamicNodeIds = new Set(dynamicNodes.map(n => n.id));

        // 2. 识别此时活跃的连线
        const activeLinks = rawGraphData.links.filter(link => {
            const sid = typeof link.source === 'object' ? link.source.id : link.source;
            const tid = typeof link.target === 'object' ? link.target.id : link.target;
            return dynamicNodeIds.has(sid) || dynamicNodeIds.has(tid);
        });

        // 3. 确定最终可见的节点集 (可见动态节点 + 它们连接到的地理/特征节点)
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

        // 最终过滤连线
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const finalLinks = activeLinks.filter(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return visibleNodeIds.has(sid) && visibleNodeIds.has(tid);
        });

        return { nodes: visibleNodes, links: finalLinks };
    }, [rawGraphData, timelineTo]);

    // Helper map to colorize nodes by group
    const colorMap: Record<string, string> = useMemo(() => ({
        event: '#ff4444',
        news: '#44aaff',
        location: '#44ffaa',
        report: '#ffcc00',
        tag: '#aaffff'
    }), []);

    return (
        <div style={{ width: '100%', height: '100%', background: '#0a0e14', position: 'relative' }}>
            <ForceGraph2D
                ref={fgRef}
                graphData={displayData}
                nodeAutoColorBy="group"
                onEngineStop={() => fgRef.current?.zoomToFit(400)}
                nodeLabel={(node: any) => `
                  <div style="background: rgba(0,0,0,0.8); color: #fff; padding: 8px; border: 1px solid #1e2d40; border-radius: 4px; font-size: 12px; max-width: 300px;">
                    <strong style="color: #00d4ff">${node.group_zh || node.group}</strong><br/>
                    <div style="margin-top: 4px; line-height: 1.4;">${node.title || node.label}</div>
                    ${node.desc ? `<div style="margin-top: 6px; color: #8b9ab0; font-size: 11px;">${node.desc}</div>` : ''}
                  </div>
                `}
                nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = node.label || '';
                    const fontSize = Math.max(12 / globalScale, 2);
                    
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

                    const r = Math.sqrt(Math.max(node.val || 1, 1)) * 2;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fillStyle = colorMap[node.group] || node.color;
                    ctx.fill();
                    
                    // Text background
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - r - bckgDimensions[1] - 2, bckgDimensions[0], bckgDimensions[1]);

                    // Text
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(label, node.x, node.y - r - bckgDimensions[1] / 2 - 2);
                }}
                nodePointerAreaPaint={(node, color, ctx) => {
                    const r = Math.sqrt(Math.max(node.val || 1, 1)) * 2;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false); // +4 increases hit area
                    ctx.fill();
                }}
                linkDirectionalArrowLength={3.5}
                linkDirectionalArrowRelPos={1}
                linkCurvature={0.25}
                linkColor={() => '#1e2d40'}
                // Render link text
                linkCanvasObjectMode={() => 'after'}
                linkCanvasObject={(link, ctx, globalScale) => {
                    if (!link.label) return;
                    const start = link.source;
                    const end = link.target;

                    // Only render text if coordinates are ready
                    if (typeof start !== 'object' || typeof end !== 'object') return;
                    if (start.x === undefined || end.x === undefined) return;

                    const textPos = Object.assign({}, start);
                    textPos.x = start.x + (end.x - start.x) / 2;
                    textPos.y = start.y + (end.y - start.y) / 2;

                    const fontSize = Math.max(8 / globalScale, 1.5);
                    ctx.font = `${fontSize}px Sans-Serif`;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(link.label, textPos.x, textPos.y);
                }}
            />
            {/* Overlay hint */}
            <div style={{
                position: 'absolute', top: 20, left: 20, 
                color: '#8b9ab0', fontSize: '12px', background: 'rgba(0,0,0,0.6)', 
                padding: '10px', borderRadius: '4px', border: '1px solid #1e2d40',
                pointerEvents: 'none',
                fontFamily: 'monospace'
            }}>
                <div style={{ color: '#00d4ff', marginBottom: '8px', fontWeight: 'bold' }}>[ OSINT 动态演进图谱 ]</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <span style={{ color: colorMap.event }}>● 战事事件</span>
                    <span style={{ color: colorMap.news }}>● 新闻情报</span>
                    <span style={{ color: colorMap.report }}>● 战报推演</span>
                    <span style={{ color: colorMap.location }}>● 地理实体</span>
                </div>
            </div>
        </div>
    );
}
