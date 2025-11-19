import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouterConfigWithId, InterfaceWithHistory, Interface, TrafficHistoryPoint } from '../types.ts';
import { getInterfaceStats } from '../services/mikrotikService.ts';
import { Chart } from './chart.tsx';

const MAX_HISTORY_POINTS = 30;
const POLL_INTERVAL_MS = 2000;

const formatBps = (bps: number): string => {
  if (typeof bps !== 'number' || !isFinite(bps) || isNaN(bps)) return '0 bps';
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(2)} Kbps`;
  if (bps < 1000 * 1000 * 1000) return `${(bps / (1000 * 1000)).toFixed(2)} Mbps`;
  return `${(bps / (1000 * 1000 * 1000)).toFixed(2)} Gbps`;
};

type Props = {
  selectedRouter: RouterConfigWithId | null;
  title?: string;
};

export const LiveTrafficCard: React.FC<Props> = ({ selectedRouter, title = 'Live Interface Traffic' }) => {
  const [interfaces, setInterfaces] = useState<InterfaceWithHistory[]>([]);
  const [selectedInterface, setSelectedInterface] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  const previousInterfacesRef = useRef<{ timestamp: number; interfaces: Interface[] } | null>(null);

  const selectableInterfaces = useMemo(
    () => interfaces.filter(i => i.type.startsWith('ether') || i.type === 'bridge' || i.type === 'vlan' || i.type === 'wlan'),
    [interfaces]
  );

  const chartData = useMemo(() => interfaces.find(i => i.name === selectedInterface), [interfaces, selectedInterface]);

  const fetchData = useCallback(async (isInitial = false) => {
    if (!selectedRouter) {
      if (isInitial) setIsLoading(false);
      setInterfaces([]);
      previousInterfacesRef.current = null;
      return;
    }

    if (isInitial) {
      setIsLoading(true);
      setError(null);
      setInterfaces([]);
      setSelectedInterface(null);
      previousInterfacesRef.current = null;
    }

    try {
      const currentInterfacesData: Interface[] = await getInterfaceStats(selectedRouter);
      const now = Date.now();
      setInterfaces(prev => {
        const prevState = previousInterfacesRef.current;
        previousInterfacesRef.current = { timestamp: now, interfaces: currentInterfacesData };

        if (!Array.isArray(currentInterfacesData)) return prev;

        const dt = prevState ? (now - prevState.timestamp) / 1000 : 0;

        const updated = currentInterfacesData.map((iface: Interface) => {
          const existing = prev.find(p => p.name === iface.name);
          const prevIface = prevState?.interfaces.find(p => p.name === iface.name);

          let rxRate = 0;
          let txRate = 0;

          if (prevIface && dt > 0.1) {
            const i = iface as any;
            const p = prevIface as any;
            const currRx = Number(i['rx-byte'] ?? i['bytes-in'] ?? i['rx-bytes'] ?? 0);
            const prevRx = Number(p['rx-byte'] ?? p['bytes-in'] ?? p['rx-bytes'] ?? 0);
            const currTx = Number(i['tx-byte'] ?? i['bytes-out'] ?? i['tx-bytes'] ?? 0);
            const prevTx = Number(p['tx-byte'] ?? p['bytes-out'] ?? p['tx-bytes'] ?? 0);
            let dRx = currRx - prevRx;
            let dTx = currTx - prevTx;
            if (dRx < 0) dRx = currRx;
            if (dTx < 0) dTx = currTx;
            rxRate = Math.round((dRx * 8) / dt);
            txRate = Math.round((dTx * 8) / dt);
            if (isNaN(rxRate)) rxRate = 0;
            if (isNaN(txRate)) txRate = 0;
          }

          const point: TrafficHistoryPoint = { name: new Date().toLocaleTimeString(), rx: rxRate, tx: txRate };
          let history = existing ? [...existing.trafficHistory, point] : [point];
          if (history.length > MAX_HISTORY_POINTS) history = history.slice(history.length - MAX_HISTORY_POINTS);
          return { ...iface, rxRate, txRate, trafficHistory: history } as InterfaceWithHistory;
        });
        return updated;
      });

      if (error) setError(null);
    } catch (e) {
      setError('Failed to fetch interface traffic data.');
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, [selectedRouter, error]);

  useEffect(() => {
    if (selectableInterfaces.length > 0) {
      if (!selectedInterface || !selectableInterfaces.some(i => i.name === selectedInterface)) {
        const def = selectableInterfaces.find(i => i.name.toLowerCase().includes('wan') || i.name === 'ether1') || selectableInterfaces[0];
        setSelectedInterface(def.name);
      }
    }
  }, [selectableInterfaces, selectedInterface]);

  useEffect(() => {
    if (selectedRouter) {
      fetchData(true);
      intervalRef.current = window.setInterval(() => fetchData(false), POLL_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedRouter, fetchData]);

  return (
    <div className="bg-white dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{title}</h4>
        <select
          value={selectedInterface || ''}
          onChange={(e) => setSelectedInterface(e.target.value)}
          className="mt-2 sm:mt-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
          aria-label="Select interface to view traffic"
        >
          {selectableInterfaces.map(iface => (
            <option key={iface.name} value={iface.name}>{iface.name}</option>
          ))}
        </select>
      </div>
      {isLoading && <div className="h-64 flex items-center justify-center"><span className="text-slate-500">Loading...</span></div>}
      {!isLoading && chartData && (
        <div>
          <div className="flex justify-between text-sm mb-2">
            <p>RX: <span className="font-semibold text-green-600 dark:text-green-400">{formatBps(chartData.rxRate)}</span></p>
            <p>TX: <span className="font-semibold text-sky-600 dark:text-sky-400">{formatBps(chartData.txRate)}</span></p>
          </div>
          <div className="h-64">
            <Chart trafficHistory={chartData.trafficHistory} />
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-yellow-600 dark:text-yellow-400">{error}</p>}
    </div>
  );
};

