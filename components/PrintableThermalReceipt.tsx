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
            fontFamily: 'monospace',
            lineHeight: '1.2',
            margin: '0 auto',
            backgroundColor: 'white',
            color: 'black',
            width: '58mm',
            maxWidth: '58mm',
            padding: '4mm 3mm',
            fontSize: '11px',
            boxSizing: 'border-box' as const
        }}>
            <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '3px' }}>
                    {companySettings.companyName || 'Your Company'}
                </div>
                {companySettings.address && <div style={{ fontSize: '9px', marginBottom: '1px', wordWrap: 'break-word' }}>{companySettings.address}</div>}
                {companySettings.contactNumber && <div style={{ fontSize: '9px', marginBottom: '1px' }}>{companySettings.contactNumber}</div>}
                {companySettings.email && <div style={{ fontSize: '9px' }}>{companySettings.email}</div>}
            </div>
            <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>ACKNOWLEDGEMENT RECEIPT ONLY</div>
            
            <div style={{ borderTop: '1px dashed black', margin: '4px 0' }} />
            
            <div style={{ marginBottom: '4px', fontSize: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span>AR#:</span><span>{receiptId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span>Date:</span><span>{dateStr}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span>Type:</span><span style={{ textTransform: 'uppercase' }}>{(sale.planType || 'prepaid')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span>Month:</span><span style={{ fontSize: '9px' }}>{sale.coveredMonth || new Date(sale.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', overflow: 'hidden' }}>
                    <span style={{ flexShrink: 0 }}>Name:</span><span style={{ maxWidth: '35mm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{sale.clientName || ''}</span>
                </div>
                {sale.clientAddress && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', overflow: 'hidden' }}>
                        <span style={{ flexShrink: 0 }}>Addr:</span><span style={{ maxWidth: '35mm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{sale.clientAddress}</span>
                    </div>
                )}
                {sale.clientContact && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Contact:</span><span>{sale.clientContact}</span>
                    </div>
                )}
            </div>
            
            <div style={{ borderTop: '1px dashed black', margin: '4px 0' }} />
            
            <div style={{ marginBottom: '4px', fontSize: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '35mm' }}>{sale.planName}</span>
                    <span style={{ flexShrink: 0 }}>{formatCurrency(sale.planPrice)}</span>
                </div>
                {sale.discountAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Discount</span>
                        <span>-{formatCurrency(sale.discountAmount)}</span>
                    </div>
                )}
            </div>
            
            <div style={{ borderTop: '1px dashed black', margin: '4px 0' }} />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>
                <span>TOTAL</span>
                <span>{formatCurrency(sale.finalAmount)}</span>
            </div>
            
            <div style={{ borderTop: '1px dashed black', margin: '4px 0' }} />
            
            <div style={{ textAlign: 'center', fontSize: '9px', marginTop: '4px' }}>
                <div>Thank you for your payment!</div>
            </div>
        </div>
    );
};
