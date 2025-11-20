import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { TrafficHistoryPoint } from '../types.ts';

interface ChartProps {
    trafficHistory: TrafficHistoryPoint[];
}

const formatBps = (bps: number): string => {
    if (typeof bps !== 'number' || !isFinite(bps) || bps < 0) return '0 bps';
    if (bps < 1000) return `${bps.toFixed(0)} bps`;
    if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(1)} Kbps`;
    if (bps < 1000 * 1000 * 1000) return `${(bps / (1000 * 1000)).toFixed(1)} Mbps`;
    return `${(bps / (1000 * 1000 * 1000)).toFixed(1)} Gbps`;
};

const CustomTooltip: React.FC<any> = ({ active, payload }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-lg text-xs">
                <p className="text-green-600 dark:text-green-400 font-semibold">{`RX: ${formatBps(payload[0].value)}`}</p>
                <p className="text-sky-600 dark:text-sky-400 font-semibold">{`TX: ${formatBps(payload[1].value)}`}</p>
            </div>
        );
    }
    return null;
};

export const Chart: React.FC<ChartProps> = ({ trafficHistory }) => {
    const data = trafficHistory.length > 0 ? trafficHistory : [{ name: '', rx: 0, tx: 0 }];
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart
                data={data}
                margin={{
                    top: 5,
                    right: 0,
                    left: 0,
                    bottom: 5,
                }}
            >
                <defs>
                    <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="opacity-10 dark:opacity-20" />
                <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
                <YAxis 
                    tickFormatter={formatBps} 
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    className="text-slate-500 dark:text-slate-400"
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-in-out"
                    type="monotone" 
                    dataKey="rx" 
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorRx)" 
                    strokeWidth={2}
                />
                <Area 
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-in-out"
                    type="monotone" 
                    dataKey="tx" 
                    stroke="#0ea5e9" 
                    fillOpacity={1} 
                    fill="url(#colorTx)"
                    strokeWidth={2}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
};
