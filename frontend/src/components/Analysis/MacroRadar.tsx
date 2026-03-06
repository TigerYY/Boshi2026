import {
    AreaChart, Area, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { AnalysisReport } from '../../api/types';

interface MacroRadarProps {
    report: AnalysisReport | null;
    financeData: { symbol: string; price: number; change: number } | null;
}

export default function MacroRadar({ report, financeData }: MacroRadarProps) {
    // Determine prob locally or default to 50 if missing
    const prob = report?.escalation_probability ?? 50;
    const isHighRisk = prob >= 70;
    const isMediumRisk = prob >= 30 && prob < 70;

    const accentColor = isHighRisk ? '#ff2244' : isMediumRisk ? '#ffdd00' : '#00ff88';

    // Dummy sparkline data for BTC if we just have one point, normally we'd store historical array
    // We'll just build a small visual aesthetic line based on 24h change
    const buildSparkline = () => {
        if (!financeData) return [];
        const base = financeData.price;
        const changeVal = (base * financeData.change) / 100;
        const startObj = base - changeVal;

        // Create a smooth curve to current price for visuals
        return [
            { time: '24h ago', value: startObj },
            { time: '12h ago', value: startObj + (changeVal * 0.3) },
            { time: '6h ago', value: startObj + (changeVal * 0.8) },
            { time: 'Now', value: base },
        ];
    };

    const btcTrend = buildSparkline();

    return (
        <div style={{
            marginTop: '20px',
            padding: '12px',
            background: 'linear-gradient(180deg, rgba(16,22,30,1) 0%, rgba(10,14,20,1) 100%)',
            border: `1px solid ${isHighRisk ? '#ff224444' : '#1e2d40'}`,
            borderRadius: '4px',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Background radial glow */}
            <div style={{
                position: 'absolute', top: '-50%', right: '-20%', width: '150px', height: '150px',
                background: `radial-gradient(circle, ${accentColor}11 0%, transparent 70%)`,
                zIndex: 0
            }} />

            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', color: '#8b9ab0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Macro Radar <span style={{ color: accentColor }}>●</span>
                    </div>
                    {financeData && (
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#e6edf3', fontFamily: 'monospace' }}>
                                {financeData.symbol} ${financeData.price.toLocaleString()}
                            </div>
                            <div style={{ fontSize: '10px', color: financeData.change >= 0 ? '#00ff88' : '#ff6b35' }}>
                                {financeData.change > 0 ? '+' : ''}{financeData.change.toFixed(2)}%
                            </div>
                        </div>
                    )}
                </div>

                {/* Escalation Probability Dial */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                    <div style={{
                        width: '60px', height: '60px', borderRadius: '50%',
                        border: `3px solid ${accentColor}44`,
                        borderTopColor: accentColor,
                        borderRightColor: prob > 25 ? accentColor : `${accentColor}44`,
                        borderBottomColor: prob > 50 ? accentColor : `${accentColor}44`,
                        borderLeftColor: prob > 75 ? accentColor : `${accentColor}44`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        transform: 'rotate(-45deg)',
                        boxShadow: `0 0 15px ${accentColor}22`
                    }}>
                        <div style={{ transform: 'rotate(45deg)', textAlign: 'center' }}>
                            <span style={{ fontSize: '18px', fontWeight: '900', color: accentColor, fontFamily: 'monospace' }}>
                                {prob}%
                            </span>
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '11px', color: '#ffffff', fontWeight: '600', marginBottom: '4px' }}>
                            未来 48 小时升级概率
                        </div>
                        <div style={{ fontSize: '10px', color: '#8b9ab0', lineHeight: 1.4 }}>
                            系统监测到该冲突存在 <span style={{ color: accentColor }}>{isHighRisk ? '极高危险' : isMediumRisk ? '扩散风险' : '有限影响'}</span>。
                        </div>
                    </div>
                </div>

                {/* Market Correlation AI Report */}
                <div style={{
                    marginTop: '12px', padding: '8px',
                    background: 'rgba(0, 212, 255, 0.05)',
                    borderLeft: '2px solid #00d4ff',
                    fontSize: '10px', color: '#a1b3c6', lineHeight: 1.5
                }}>
                    <strong style={{ color: '#00d4ff', display: 'block', marginBottom: '4px' }}>AI 避险资产联动推演:</strong>
                    {report?.market_correlation || "数据采集中...等待分析引擎获取下一个行情周期进行联动研判。"}
                </div>

                {/* BTC Mini Sparkline */}
                {financeData && btcTrend.length > 0 && (
                    <div style={{ marginTop: '16px', height: '40px', width: '100%', opacity: 0.8 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={btcTrend}>
                                <defs>
                                    <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={financeData.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={financeData.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <YAxis domain={['dataMin', 'dataMax']} hide />
                                <Tooltip
                                    contentStyle={{ background: '#0a0e14', border: 'none', fontSize: '9px', padding: '4px' }}
                                    itemStyle={{ color: '#fff' }}
                                    labelStyle={{ display: 'none' }}
                                />
                                <Area
                                    type="monotone" dataKey="value"
                                    stroke={financeData.change >= 0 ? '#00ff88' : '#ff6b35'}
                                    fill="url(#btcGrad)" strokeWidth={1.5}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
