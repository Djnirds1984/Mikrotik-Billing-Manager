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
        <div className="thermal-receipt" style={{ 
            width: '280px', 
            padding: '8px', 
            fontFamily: 'monospace', 
            fontSize: '12px', 
            lineHeight: '1.2',
            margin: '0 auto',
            backgroundColor: 'white',
            color: 'black'
        }}>
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>
                    {companySettings.companyName || 'Your Company'}
                </div>
                {companySettings.address && <div style={{ fontSize: '10px', marginBottom: '2px' }}>{companySettings.address}</div>}
                {companySettings.contactNumber && <div style={{ fontSize: '10px', marginBottom: '2px' }}>{companySettings.contactNumber}</div>}
                {companySettings.email && <div style={{ fontSize: '10px' }}>{companySettings.email}</div>}
            </div>
            
            <div style={{ borderTop: '1px solid black', margin: '8px 0' }} />
            
            <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>Receipt:</span><span>{receiptId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>Date:</span><span>{dateStr}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Client:</span><span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sale.clientName}</span>
                </div>
            </div>
            
            <div style={{ borderTop: '1px solid black', margin: '8px 0' }} />
            
            <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span>{sale.planName}</span>
                    <span>{formatCurrency(sale.planPrice)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Discount</span>
                    <span>-{formatCurrency(sale.discountAmount)}</span>
                </div>
            </div>
            
            <div style={{ borderTop: '1px solid black', margin: '8px 0' }} />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}>
                <span>Total</span>
                <span>{formatCurrency(sale.finalAmount)}</span>
            </div>
            
            <div style={{ textAlign: 'center', fontSize: '10px' }}>
                <div>Thank you for your payment!</div>
            </div>
        </div>
    );
};

