
import React from 'react';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import type { TrafficHistoryPoint } from '../types.ts';

interface TrafficChartProps {
    data: TrafficHistoryPoint[];
    height?: number;
    showXAxis?: boolean;
}

const formatBits = (bits: number): string => {
    if (bits === 0) return '0 bps';
    if (bits < 1000) return `${bits.toFixed(0)} bps`;
    const k = 1000;
    const sizes = ['Kbps', 'Mbps', 'Gbps', 'Tbps'];
    const i = Math.floor(Math.log(bits) / Math.log(k));
    return `${(bits / Math.pow(k, i)).toFixed(1)} ${sizes[i - 1] || 'Kbps'}`;
};

const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900/95 backdrop-blur border border-slate-700 p-3 rounded-lg shadow-2xl text-xs z-50">
                <p className="text-slate-400 mb-1 font-mono">{label}</p>
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-slate-300">Download:</span>
                    <span className="font-bold text-emerald-400 font-mono">{formatBits(payload[0].value)}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-sky-500"></div>
                    <span className="text-slate-300">Upload:</span>
                    <span className="font-bold text-sky-400 font-mono">{formatBits(payload[1].value)}</span>
                </div>
            </div>
        );
    }
    return null;
};

export const TrafficChart: React.FC<TrafficChartProps> = ({ data, height = 300, showXAxis = true }) => {
    // If no data, show a placeholder skeleton
    if (!data || data.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
                <p className="text-slate-400 animate-pulse">Waiting for telemetry...</p>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: height }}>
            <ResponsiveContainer>
                <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    
                    <CartesianGrid 
                        strokeDasharray="3 3" 
                        vertical={false} 
                        stroke="currentColor" 
                        className="text-slate-200 dark:text-slate-700" 
                        opacity={0.5}
                    />
                    
                    <XAxis 
                        dataKey="name" 
                        hide={!showXAxis}
                        tick={{ fontSize: 10, fill: '#94a3b8' }} 
                        axisLine={false}
                        tickLine={false}
                        minTickGap={30}
                    />
                    
                    <YAxis 
                        tickFormatter={formatBits} 
                        width={70}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#64748b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    
                    <Area
                        type="monotone"
                        dataKey="rx"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#colorRx)"
                        isAnimationActive={false} // Disable for smoother realtime updates
                    />
                    <Area
                        type="monotone"
                        dataKey="tx"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        fill="url(#colorTx)"
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
