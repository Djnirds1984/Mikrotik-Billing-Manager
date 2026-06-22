import React, { useState } from 'react';
import { HotspotPlanManager } from './HotspotPlanManager.tsx';
import { HotspotVoucherManager } from './HotspotVoucherManager.tsx';
import { EspDeviceManager } from './EspDeviceManager.tsx';
import { HotspotSessionMonitor } from './HotspotSessionMonitor.tsx';

type SubTab = 'sessions' | 'plans' | 'vouchers' | 'esp';

const SubTabButton: React.FC<{ label: string; isActive: boolean; onClick: () => void }> = ({ label, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isActive
                ? 'bg-[--color-primary-600] text-white shadow-md'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
        }`}
    >
        {label}
    </button>
);

interface Props {
    routerId: string;
}

export const HotspotControllerTab: React.FC<Props> = ({ routerId }) => {
    const [subTab, setSubTab] = useState<SubTab>('sessions');

    return (
        <div className="space-y-4">
            <div className="flex gap-2 flex-wrap border-b border-slate-200 dark:border-slate-700 pb-3">
                <SubTabButton label="Sessions" isActive={subTab === 'sessions'} onClick={() => setSubTab('sessions')} />
                <SubTabButton label="Plans" isActive={subTab === 'plans'} onClick={() => setSubTab('plans')} />
                <SubTabButton label="Vouchers" isActive={subTab === 'vouchers'} onClick={() => setSubTab('vouchers')} />
                <SubTabButton label="ESP Devices" isActive={subTab === 'esp'} onClick={() => setSubTab('esp')} />
            </div>

            <div>
                {subTab === 'sessions' && <HotspotSessionMonitor routerId={routerId} />}
                {subTab === 'plans' && <HotspotPlanManager routerId={routerId} />}
                {subTab === 'vouchers' && <HotspotVoucherManager routerId={routerId} />}
                {subTab === 'esp' && <EspDeviceManager routerId={routerId} />}
            </div>
        </div>
    );
};
