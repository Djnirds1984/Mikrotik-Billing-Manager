import React from 'react';
import type { SaleRecord, CompanySettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface PrintableThermalReceiptProps {
    sale: SaleRecord | null;
    companySettings: CompanySettings;
}

export const PrintableThermalReceipt: React.FC<PrintableThermalReceiptProps> = ({ sale, companySettings }) => {
    const { formatCurrency } = useLocalization();
    if (!sale) return null;

    const receiptId = sale.id.slice(-6).toUpperCase();
    const dateStr = new Date(sale.date).toLocaleDateString();

    return (
        <div style={{ width: 280, padding: 8 }} className="font-mono text-black bg-white">
            <div className="text-center">
                <div className="text-sm font-bold uppercase">{companySettings.companyName || 'Your Company'}</div>
                {companySettings.address && <div className="text-xs">{companySettings.address}</div>}
                {companySettings.contactNumber && <div className="text-xs">{companySettings.contactNumber}</div>}
                {companySettings.email && <div className="text-xs">{companySettings.email}</div>}
            </div>
            <div className="mt-2 border-t border-black" />
            <div className="mt-2 text-xs">
                <div className="flex justify-between"><span>Receipt:</span><span>{receiptId}</span></div>
                <div className="flex justify-between"><span>Date:</span><span>{dateStr}</span></div>
                <div className="flex justify-between"><span>Client:</span><span className="truncate max-w-[160px]">{sale.clientName}</span></div>
            </div>
            <div className="mt-2 border-t border-black" />
            <div className="mt-2 text-xs">
                <div className="flex justify-between">
                    <span>{sale.planName}</span>
                    <span>{formatCurrency(sale.planPrice)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Discount</span>
                    <span>-{formatCurrency(sale.discountAmount)}</span>
                </div>
            </div>
            <div className="mt-2 border-t border-black" />
            <div className="mt-2 text-sm font-bold flex justify-between">
                <span>Total</span>
                <span>{formatCurrency(sale.finalAmount)}</span>
            </div>
            <div className="mt-2 text-center text-xs">
                <div>Thank you for your payment!</div>
            </div>
        </div>
    );
};

