import {
    AreaChart, Area, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { AnalysisReport } from '../../api/types';

interface MacroRadarProps {
    report: AnalysisReport | null;
    financeData: Record<string, { symbol: string; price: number; change: number }> | null;
}

export default function MacroRadar({ report, financeData }: MacroRadarProps) {
    // Determine prob locally or default to 50 if missing
    const prob = report?.escalation_probability ?? 50;
    const isHighRisk = prob >= 70;
    const isMediumRisk = prob >= 30 && prob < 70;

    const accentColor = isHighRisk ? '#ff2244' : isMediumRisk ? '#ffdd00' : '#00ff88';

    // Helper to build a small visual aesthetic line based on 24h change
    const buildSparkline = (data: { price: number; change: number } | undefined) => {
        if (!data) return [];
        const base = data.price;
        const changeVal = (base * data.change) / 100;
        const startObj = base - changeVal;
        return [
            { time: '24h ago', value: startObj },
            { time: '12h ago', value: startObj + (changeVal * 0.3) },
            { time: '6h ago', value: startObj + (changeVal * 0.8) },
            { time: 'Now', value: base },
        ];
    };

    const btc = financeData?.["BTC"];
    const oil = financeData?.["OIL"];

    const btcTrend = buildSparkline(btc);
    const oilTrend = buildSparkline(oil);

    return (
        <div style={{
            marginTop: '20px',
            padding: '12px',
            background: 'linear-gradient(180deg, rgba(16,22,30,1) 0%, rgba(10,14,20,1) 100%)',
            border: `1px solid ${isHighRisk ? '#ff224444' : '#1e2d40'}`,
            borderRadius: '4px',
            position: 'relative',
            overflow: 'visible'
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
                            当前冲突升级概率
                        </div>
                        <div style={{ fontSize: '10px', color: '#8b9ab0', lineHeight: 1.4 }}>
                            系统监测到该冲突存在 <span style={{ color: accentColor }}>{isHighRisk ? '极高危险' : isMediumRisk ? '扩散风险' : '有限影响'}</span>。
                        </div>
                    </div>
                </div>

                {/* Escalation Forecast Chart (Phase 3) */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '10px', color: '#445566', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>72小时深度推演预测区间</span>
                        <span style={{ color: accentColor, opacity: 0.8 }}>AI 推演引擎 v3</span>
                    </div>
                    <div style={{ height: '60px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', padding: '8px 4px 0 4px', border: '1px solid #1e2d40' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={[
                                { time: 'NOW', prob: prob },
                                { time: '+24H', prob: report?.forecast_data?.['24h'] || prob },
                                { time: '+48H', prob: report?.forecast_data?.['48h'] || prob },
                                { time: '+72H', prob: report?.forecast_data?.['72h'] || prob },
                            ]}>
                                <defs>
                                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={accentColor} stopOpacity={0.4} />
                                        <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <Tooltip
                                    contentStyle={{ background: '#0a0e14', border: '1px solid #30363d', fontSize: '10px', padding: '4px' }}
                                    itemStyle={{ color: accentColor }}
                                    labelStyle={{ color: '#8b9ab0', marginBottom: '2px' }}
                                />
                                <Area
                                    type="monotone" dataKey="prob"
                                    stroke={accentColor}
                                    fill="url(#forecastGrad)" strokeWidth={2}
                                    dot={{ r: 3, fill: accentColor, strokeWidth: 0 }}
                                    activeDot={{ r: 4, stroke: '#fff', strokeWidth: 1 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', padding: '0 4px', fontSize: '9px', color: '#556677', fontFamily: 'monospace' }}>
                        <span>T+0</span>
                        <span>T+24H</span>
                        <span>T+48H</span>
                        <span>T+72H</span>
                    </div>
                </div>

                {/* --- Abu Dhabi Risk Module --- */}
                {report && (
                    <div style={{
                        marginTop: '16px', padding: '10px',
                        background: 'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(20,28,40,0.6) 100%)',
                        borderLeft: `2px solid ${(report.abu_dhabi_risk || 0) > 30 ? '#ff6b35' : '#00d4ff'}`,
                        borderRadius: '0 4px 4px 0'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ fontSize: '11px', color: '#e6edf3', fontWeight: 'bold' }}>
                                🇦🇪 阿布扎比本土安全预警指数
                            </div>
                            <div style={{
                                fontSize: '12px', fontWeight: '900', fontFamily: 'monospace',
                                color: (report.abu_dhabi_risk || 0) > 50 ? '#ff2244' : (report.abu_dhabi_risk || 0) > 30 ? '#ffdd00' : '#00ff88',
                                animation: (report.abu_dhabi_risk || 0) > 50 ? 'pulse 1.5s infinite' : 'none',
                                textShadow: (report.abu_dhabi_risk || 0) > 50 ? '0 0 10px #ff2244aa' : 'none'
                            }}>
                                {(report.abu_dhabi_risk || 0).toFixed(1)} / 100
                            </div>
                        </div>
                        <div style={{ fontSize: '10px', color: '#8b9ab0', marginTop: '6px', lineHeight: 1.4 }}>
                            <strong style={{ color: (report.abu_dhabi_risk || 0) > 30 ? '#ff6b35' : '#00d4ff' }}>AI 评级:</strong> {report.abu_dhabi_status || "安全雷达持续监测中。"}
                        </div>
                    </div>
                )}

                {/* Market Correlation AI Report */}
                <div style={{
                    marginTop: '16px', padding: '8px',
                    background: 'rgba(0, 212, 255, 0.05)',
                    borderLeft: '2px solid #00d4ff',
                    fontSize: '10px', color: '#a1b3c6', lineHeight: 1.5
                }}>
                    <strong style={{ color: '#00d4ff', display: 'block', marginBottom: '4px' }}>AI 避险资产联动推演:</strong>
                    {report?.market_correlation || "数据采集中...等待分析引擎获取下一个行情周期进行联动研判。"}
                </div>

                {/* Dual Asset Track Container */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    {/* BTC Mini Sparkline */}
                    {btc && btcTrend.length > 0 && (
                        <div style={{ flex: 1, height: '50px', position: 'relative', background: 'rgba(0,0,0,0.2)', border: '1px solid #1e2d40', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 2 }}>
                                <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#e6edf3', fontFamily: 'monospace' }}>
                                    {btc.symbol} ${btc.price.toLocaleString()}
                                </div>
                                <div style={{ fontSize: '8px', color: btc.change >= 0 ? '#00ff88' : '#ff6b35' }}>
                                    {btc.change > 0 ? '+' : ''}{btc.change.toFixed(2)}%
                                </div>
                            </div>
                            <div style={{ width: '100%', height: '100%', opacity: 0.8, paddingTop: '15px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={btcTrend}>
                                        <defs>
                                            <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={btc.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={btc.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0} />
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
                                            stroke={btc.change >= 0 ? '#00ff88' : '#ff6b35'}
                                            fill="url(#btcGrad)" strokeWidth={1.5}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* OIL Mini Sparkline */}
                    {oil && oilTrend.length > 0 && (
                        <div style={{ flex: 1, height: '50px', position: 'relative', background: 'rgba(0,0,0,0.2)', border: '1px solid #1e2d40', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 2 }}>
                                <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#e6edf3', fontFamily: 'monospace' }}>
                                    {oil.symbol} ${oil.price.toLocaleString()}
                                </div>
                                <div style={{ fontSize: '8px', color: oil.change >= 0 ? '#00ff88' : '#ff6b35' }}>
                                    {oil.change > 0 ? '+' : ''}{oil.change.toFixed(2)}%
                                </div>
                            </div>
                            <div style={{ width: '100%', height: '100%', opacity: 0.8, paddingTop: '15px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={oilTrend}>
                                        <defs>
                                            <linearGradient id="oilGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={oil.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={oil.change >= 0 ? '#00ff88' : '#ff6b35'} stopOpacity={0} />
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
                                            stroke={oil.change >= 0 ? '#00ff88' : '#ff6b35'}
                                            fill="url(#oilGrad)" strokeWidth={1.5}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
