
import React from 'react';
import type { TrafficHistoryPoint } from '../types.ts';

interface ChartProps {
    trafficHistory: TrafficHistoryPoint[];
}

export const Chart: React.FC<ChartProps> = ({ trafficHistory }) => {
    const width = 300;
    const height = 150;
    const margin = { top: 5, right: 0, bottom: 5, left: 0 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    if (trafficHistory.length < 2) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm">
                Collecting traffic data...
            </div>
        );
    }

    const maxRx = Math.max(...trafficHistory.map(d => d.rx), 0);
    const maxTx = Math.max(...trafficHistory.map(d => d.tx), 0);
    const maxVal = Math.max(maxRx, maxTx, 1); // Ensure not zero to avoid division by zero

    const xScale = (index: number) => (index / (trafficHistory.length - 1)) * chartWidth;
    const yScale = (value: number) => chartHeight - (value / maxVal) * chartHeight;

    const createPath = (dataKey: 'rx' | 'tx') => {
        let path = `M ${xScale(0)},${yScale(trafficHistory[0][dataKey])}`;
        for (let i = 1; i < trafficHistory.length; i++) {
            path += ` L ${xScale(i)},${yScale(trafficHistory[i][dataKey])}`;
        }
        return path;
    };
    
    const rxPath = createPath('rx');
    const txPath = createPath('tx');

    const formatBps = (bps: number): string => {
        if (bps < 1000) return `${bps.toFixed(0)} bps`;
        if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(1)}K`;
        if (bps < 1000 * 1000 * 1000) return `${(bps / (1000 * 1000)).toFixed(1)}M`;
        return `${(bps / (1000 * 1000 * 1000)).toFixed(1)}G`;
    };

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
            <g transform={`translate(${margin.left}, ${margin.top})`}>
                {/* Y-axis labels */}
                <text x={5} y={12} className="text-xs fill-current text-slate-400">{formatBps(maxVal)}</text>
                <text x={5} y={chartHeight - 2} className="text-xs fill-current text-slate-400">0 bps</text>

                {/* Grid lines */}
                <line x1="0" y1={yScale(maxVal * 0.75)} x2={chartWidth} y2={yScale(maxVal * 0.75)} className="stroke-current text-slate-200 dark:text-slate-700" strokeWidth="0.5" strokeDasharray="2,2" />
                <line x1="0" y1={yScale(maxVal * 0.5)} x2={chartWidth} y2={yScale(maxVal * 0.5)} className="stroke-current text-slate-200 dark:text-slate-700" strokeWidth="0.5" strokeDasharray="2,2" />
                <line x1="0" y1={yScale(maxVal * 0.25)} x2={chartWidth} y2={yScale(maxVal * 0.25)} className="stroke-current text-slate-200 dark:text-slate-700" strokeWidth="0.5" strokeDasharray="2,2" />
                
                {/* TX Path (blue/sky) */}
                <path d={txPath} fill="none" className="stroke-sky-500" strokeWidth="2" />
                
                {/* RX Path (green) */}
                <path d={rxPath} fill="none" className="stroke-green-500" strokeWidth="2" />
            </g>
        </svg>
    );
};
