
import React from 'react';
import type { SaleRecord, CompanySettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface PrintableReceiptProps {
    sale: SaleRecord | null;
    companySettings: CompanySettings;
}

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({ sale, companySettings }) => {
    const { formatCurrency } = useLocalization();
    
    if (!sale) return null;

    return (
        <div className="p-8 font-sans text-black bg-white">
            <header className="flex justify-between items-start pb-4 border-b-2 border-black">
                <div className="w-2/3">
                    <h1 className="text-3xl font-bold">{companySettings.companyName || 'Your Company'}</h1>
                    <p className="text-sm">{companySettings.address}</p>
                    <p className="text-sm">{companySettings.contactNumber}</p>
                    <p className="text-sm">{companySettings.email}</p>
                </div>
                {companySettings.logoBase64 && (
                    <div className="w-1/3 flex justify-end">
                        <img src={companySettings.logoBase64} alt="Company Logo" className="h-16 w-auto object-contain" />
                    </div>
                )}
            </header>

            <div className="mt-4 text-center font-bold uppercase">ACKNOWLEDGMENT RECEIPT ONLY</div>

            <section className="my-6">
                <div className="flex justify-between">
                    <div>
                        <h2 className="font-bold">BILLED TO:</h2>
                        <p className="text-sm">Full Name: {sale.clientName || ''}</p>
                        <p className="text-sm">Address: {sale.clientAddress || ''}</p>
                        <p className="text-sm">Contact Number: {sale.clientContact || ''}</p>
                    </div>
                    <div className="text-right">
                        <h2 className="font-bold">RECEIPT #: {sale.id.slice(-6).toUpperCase()}</h2>
                        <p>Date: {new Date(sale.date).toLocaleDateString()}</p>
                    </div>
                </div>
            </section>

            <table className="w-full text-left border-collapse">
                <thead className="bg-gray-200">
                    <tr>
                        <th className="p-2 border border-black">DESCRIPTION</th>
                        <th className="p-2 border border-black text-right">AMOUNT</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td className="p-2 border border-black">
                            <p className="font-semibold">{sale.planName}</p>
                            <p className="text-xs text-gray-600">Internet Plan Subscription</p>
                        </td>
                        <td className="p-2 border border-black text-right">{formatCurrency(sale.planPrice)}</td>
                    </tr>
                </tbody>
            </table>

            <section className="my-6 flex justify-end">
                <div className="w-1/2">
                    <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>{formatCurrency(sale.planPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Discount:</span>
                        <span>- {formatCurrency(sale.discountAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-xl mt-2 pt-2 border-t-2 border-black">
                        <span>TOTAL:</span>
                        <span>{formatCurrency(sale.finalAmount)}</span>
                    </div>

                </div>
            </section>
            
            <footer className="mt-8 pt-4 border-t-2 border-dashed border-black text-center">
                <p className="font-bold">Thank you for your payment!</p>
                <p className="text-xs mt-2">This is acknowledgement receipt only.</p>
            </footer>
        </div>
    );
};
