import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { PrinterIcon, PlusIcon, XMarkIcon, TrashIcon, EditIcon, EyeIcon } from '../constants.tsx';

// ─── Types ───────────────────────────────────────────────────────────────────
interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface JobOrder {
  id: string;
  job_order_number: string;
  client_name: string;
  client_contact: string;
  client_address: string;
  router_node_id: string;
  service_type: string;
  status: string;
  description: string;
  assigned_technician: string;
  items: string; // JSON string
  subtotal: number;
  discount: number;
  tax_amount: number;
  grand_total: number;
  payment_status: string;
  amount_paid: number;
  balance: number;
  estimated_at: string | null;
  completed_at: string | null;
  invoiced_at: string | null;
  created_at: string;
  updated_at: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SERVICE_TYPES = [
  'PisoWiFi Repair',
  'Fiber/PPPoE Installation',
  'Hardware Setup',
  'Antenna Realignment',
  'Maintenance',
  'Other',
];

const STATUSES = ['Pending', 'Estimated', 'In Progress', 'Job Done', 'Invoiced', 'Paid', 'Cancelled'];
const PAYMENT_STATUSES = ['Unpaid', 'Partial', 'Paid'];

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('authToken')}`,
});

const formatCurrency = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const getStatusBadge = (status: string) => {
  const map: Record<string, string> = {
    Pending: 'bg-slate-100 dark:bg-slate-600/30 text-slate-700 dark:text-slate-300',
    Estimated: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400',
    'In Progress': 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
    'Job Done': 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
    Invoiced: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400',
    Paid: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
    Cancelled: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
  };
  return map[status] || 'bg-slate-100 dark:bg-slate-600/30 text-slate-700 dark:text-slate-300';
};

const getPaymentBadge = (ps: string) => {
  const map: Record<string, string> = {
    Unpaid: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
    Partial: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
    Paid: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
  };
  return map[ps] || 'bg-slate-100 dark:bg-slate-600/30 text-slate-700 dark:text-slate-300';
};

const numberToWords = (num: number): string => {
  if (num === 0) return 'Zero Pesos';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const scales = ['', 'Thousand', 'Million', 'Billion'];
  const convertChunk = (n: number): string => {
    let s = '';
    if (n >= 100) { s += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
    if (n >= 20) { s += tens[Math.floor(n / 10)] + ' '; n %= 10; }
    if (n > 0) s += ones[n] + ' ';
    return s;
  };
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  let result = '';
  let scaleIdx = 0;
  let chunk = intPart;
  while (chunk > 0) {
    const c = chunk % 1000;
    if (c !== 0) result = convertChunk(c) + scales[scaleIdx] + ' ' + result;
    chunk = Math.floor(chunk / 1000);
    scaleIdx++;
  }
  result = result.trim() + ' Pesos';
  if (decPart > 0) result += ' and ' + convertChunk(decPart).trim() + ' Centavos';
  return result;
};

// ─── Print Document Component ────────────────────────────────────────────────
type DocType = 'estimate' | 'invoice' | 'jobdone' | 'receipt';

const PrintDocument: React.FC<{
  docType: DocType;
  job: JobOrder;
  companySettings: any;
  onClose: () => void;
}> = ({ docType, job, companySettings, onClose }) => {
  const printRef = useRef<HTMLDivElement>(null);
  const items: LineItem[] = (() => { try { return JSON.parse(job.items || '[]'); } catch { return []; } })();

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${docType === 'estimate' ? 'Estimate' : docType === 'invoice' ? 'Invoice' : docType === 'jobdone' ? 'Job Completion Certificate' : 'Acknowledgement Receipt'}</title><style>
      @page { size: A4; margin: 15mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; padding: 20px; }
      .header { text-align: center; border-bottom: 3px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px; }
      .header h1 { font-size: 20pt; color: #1e40af; margin-bottom: 4px; }
      .header p { font-size: 9pt; color: #64748b; }
      .doc-title { text-align: center; font-size: 16pt; font-weight: 700; color: #1e40af; margin: 15px 0; text-transform: uppercase; letter-spacing: 2px; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
      .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
      .info-box h3 { font-size: 9pt; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
      .info-box p { font-size: 10pt; margin-bottom: 3px; }
      table { width: 100%; border-collapse: collapse; margin: 15px 0; }
      th { background: #1e40af; color: white; padding: 8px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; }
      td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 10pt; }
      tr:nth-child(even) td { background: #f8fafc; }
      .totals { margin-left: auto; width: 280px; margin-top: 10px; }
      .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 10pt; }
      .totals .row.grand { border-top: 2px solid #1e40af; font-weight: 700; font-size: 12pt; padding-top: 8px; margin-top: 4px; color: #1e40af; }
      .disclaimer { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 10px; margin-top: 15px; font-size: 9pt; color: #92400e; }
      .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
      .sig-line { border-top: 1px solid #334155; padding-top: 6px; text-align: center; font-size: 9pt; color: #64748b; }
      .receipt-box { background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px; padding: 15px; margin: 15px 0; }
      .receipt-box h3 { color: #166534; font-size: 12pt; margin-bottom: 8px; }
      .amount-words { font-style: italic; color: #166534; font-weight: 600; }
      .footer { text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; }
      @media print { .no-print { display: none !important; } body { padding: 0; } }
    </style></head><body>`);

    const companyName = companySettings?.companyName || 'CITYCONNECT';
    const companyAddress = companySettings?.address || '';
    const companyContact = companySettings?.contactNumber || '';
    const companyEmail = companySettings?.email || '';

    let body = '';

    // Header for all docs
    const headerHtml = `
      <div class="header">
        <h1>${companyName}</h1>
        <p>${companyAddress}${companyContact ? ' | ' + companyContact : ''}${companyEmail ? ' | ' + companyEmail : ''}</p>
        <p style="font-size:8pt; color:#94a3b8;">Powered by AJC Softwares</p>
      </div>
      <div class="doc-title">${docType === 'estimate' ? 'Estimate / Quotation' : docType === 'invoice' ? 'Invoice' : docType === 'jobdone' ? 'Job Completion Certificate' : 'Acknowledgement Receipt'}</div>
    `;

    const infoHtml = `
      <div class="info-grid">
        <div class="info-box">
          <h3>Job Order Details</h3>
          <p><strong>JO #:</strong> ${job.job_order_number}</p>
          <p><strong>Date Created:</strong> ${formatDate(job.created_at)}</p>
          <p><strong>Service Type:</strong> ${job.service_type}</p>
          <p><strong>Status:</strong> ${job.status}</p>
          ${job.assigned_technician ? `<p><strong>Technician:</strong> ${job.assigned_technician}</p>` : ''}
        </div>
        <div class="info-box">
          <h3>Client Information</h3>
          <p><strong>Name:</strong> ${job.client_name}</p>
          ${job.client_contact ? `<p><strong>Contact:</strong> ${job.client_contact}</p>` : ''}
          ${job.client_address ? `<p><strong>Address:</strong> ${job.client_address}</p>` : ''}
          ${job.router_node_id ? `<p><strong>Node/Location:</strong> ${job.router_node_id}</p>` : ''}
        </div>
      </div>
    `;

    const itemsTableHtml = `
      <table>
        <thead><tr><th>#</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${items.map((item, i) => `<tr><td>${i + 1}</td><td>${item.description}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${formatCurrency(item.unit_price)}</td><td style="text-align:right">${formatCurrency(item.total)}</td></tr>`).join('')}</tbody>
      </table>
    `;

    const totalsHtml = `
      <div class="totals">
        <div class="row"><span>Subtotal:</span><span>${formatCurrency(job.subtotal)}</span></div>
        ${job.discount > 0 ? `<div class="row"><span>Discount:</span><span>-${formatCurrency(job.discount)}</span></div>` : ''}
        ${job.tax_amount > 0 ? `<div class="row"><span>Tax:</span><span>${formatCurrency(job.tax_amount)}</span></div>` : ''}
        <div class="row grand"><span>Grand Total:</span><span>${formatCurrency(job.grand_total)}</span></div>
      </div>
    `;

    if (docType === 'estimate') {
      body = headerHtml + infoHtml +
        (job.description ? `<div class="info-box" style="margin-bottom:15px"><h3>Scope of Work / Description</h3><p>${job.description}</p></div>` : '') +
        itemsTableHtml + totalsHtml +
        `<div class="disclaimer"><strong>Disclaimer:</strong> This is an estimate / quotation, not an official invoice. Valid for 15 days from the date issued. Prices and scope may change upon actual assessment.</div>` +
        `<div class="footer"><p>Thank you for your business!</p></div>`;
    } else if (docType === 'invoice') {
      body = headerHtml + infoHtml +
        (job.invoiced_at ? `<p style="text-align:right;font-size:9pt;color:#64748b;">Invoice Date: ${formatDate(job.invoiced_at)}</p>` : '') +
        itemsTableHtml + totalsHtml +
        `<div style="margin-top:20px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
          <p style="font-size:10pt;"><strong>Payment Terms:</strong> Due upon receipt unless otherwise agreed.</p>
          <p style="font-size:10pt;margin-top:6px;"><strong>Amount Due:</strong> <span style="color:#dc2626;font-weight:700;">${formatCurrency(job.balance)}</span></p>
          ${job.amount_paid > 0 ? `<p style="font-size:10pt;">Amount Paid: ${formatCurrency(job.amount_paid)}</p>` : ''}
        </div>` +
        `<div class="footer"><p>Thank you for your business!</p></div>`;
    } else if (docType === 'jobdone') {
      body = headerHtml + infoHtml +
        (job.description ? `<div class="info-box" style="margin-bottom:15px"><h3>Work Performed</h3><p>${job.description}</p></div>` : '') +
        itemsTableHtml +
        `<div style="margin:20px 0;padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;">
          <p style="font-size:10pt;color:#166534;"><strong>Completion Date:</strong> ${formatDate(job.completed_at)}</p>
          <p style="font-size:10pt;color:#166534;"><strong>Technician:</strong> ${job.assigned_technician || 'N/A'}</p>
        </div>` +
        `<p style="margin:15px 0;font-size:10pt;">This certifies that the above-described work has been completed satisfactorily. The client acknowledges acceptance of the completed job.</p>` +
        `<div class="signatures">
          <div><div style="height:50px"></div><div class="sig-line">Technician Signature<br/><strong>${job.assigned_technician || 'N/A'}</strong></div></div>
          <div><div style="height:50px"></div><div class="sig-line">Client Acceptance Signature<br/><strong>${job.client_name}</strong></div></div>
        </div>` +
        `<div class="footer"><p>Thank you for your business!</p></div>`;
    } else {
      // Receipt
      body = headerHtml + infoHtml +
        `<div class="receipt-box">
          <h3>Payment Received</h3>
          <p style="font-size:11pt;">Received from <strong>${job.client_name}</strong> the sum of</p>
          <p class="amount-words" style="font-size:12pt;margin:8px 0;">${numberToWords(job.amount_paid)}</p>
          <p style="font-size:14pt;font-weight:700;color:#166534;margin:8px 0;">${formatCurrency(job.amount_paid)}</p>
          <p style="font-size:10pt;">Payment Method: Cash / GCash / Bank Transfer</p>
          <p style="font-size:10pt;margin-top:6px;">For Job Order: <strong>${job.job_order_number}</strong></p>
        </div>` +
        `<div class="totals">
          <div class="row"><span>Job Total:</span><span>${formatCurrency(job.grand_total)}</span></div>
          <div class="row"><span>Amount Paid:</span><span>${formatCurrency(job.amount_paid)}</span></div>
          <div class="row grand"><span>Remaining Balance:</span><span>${formatCurrency(job.balance)}</span></div>
        </div>` +
        `<div class="signatures" style="margin-top:40px;">
          <div></div>
          <div><div style="height:50px"></div><div class="sig-line">Authorized Signature</div></div>
        </div>` +
        `<div class="footer"><p>Official Receipt — ${companyName}</p></div>`;
    }

    printWindow.document.write(body + '</body></html>');
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 400);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
            {docType === 'estimate' ? 'Estimate / Quotation' : docType === 'invoice' ? 'Invoice' : docType === 'jobdone' ? 'Job Completion Certificate' : 'Acknowledgement Receipt'}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
              <PrinterIcon className="w-4 h-4" /> Print
            </button>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><XMarkIcon className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6" ref={printRef}>
          <PrintPreview docType={docType} job={job} items={items} companySettings={companySettings} />
        </div>
      </div>
    </div>
  );
};

// ─── Print Preview (on-screen) ───────────────────────────────────────────────
const PrintPreview: React.FC<{ docType: DocType; job: JobOrder; items: LineItem[]; companySettings: any }> = ({ docType, job, items, companySettings }) => {
  const companyName = companySettings?.companyName || 'CITYCONNECT';
  return (
    <div className="max-w-xl mx-auto text-sm text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="text-center border-b-2 border-blue-600 pb-4 mb-4">
        <h1 className="text-xl font-bold text-blue-800 dark:text-blue-400">{companyName}</h1>
        <p className="text-xs text-slate-500">{companySettings?.address || ''} {companySettings?.contactNumber ? '| ' + companySettings.contactNumber : ''}</p>
        <p className="text-xs text-slate-400">Powered by AJC Softwares</p>
      </div>
      <div className="text-center text-base font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400 mb-4">
        {docType === 'estimate' ? 'Estimate / Quotation' : docType === 'invoice' ? 'Invoice' : docType === 'jobdone' ? 'Job Completion Certificate' : 'Acknowledgement Receipt'}
      </div>
      {/* Info */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3 border border-slate-200 dark:border-slate-600">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Job Order</p>
          <p><strong>{job.job_order_number}</strong></p>
          <p className="text-xs">Date: {formatDate(job.created_at)}</p>
          <p className="text-xs">Type: {job.service_type}</p>
          {job.assigned_technician && <p className="text-xs">Tech: {job.assigned_technician}</p>}
        </div>
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3 border border-slate-200 dark:border-slate-600">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Client</p>
          <p><strong>{job.client_name}</strong></p>
          {job.client_contact && <p className="text-xs">{job.client_contact}</p>}
          {job.client_address && <p className="text-xs">{job.client_address}</p>}
        </div>
      </div>
      {/* Items table */}
      <table className="w-full text-xs mb-3">
        <thead><tr className="bg-blue-700 text-white"><th className="p-2 text-left">#</th><th className="p-2 text-left">Description</th><th className="p-2 text-center">Qty</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Total</th></tr></thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-700/30'}>
              <td className="p-2">{i + 1}</td><td className="p-2">{item.description}</td><td className="p-2 text-center">{item.quantity}</td><td className="p-2 text-right">{formatCurrency(item.unit_price)}</td><td className="p-2 text-right">{formatCurrency(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Totals */}
      <div className="flex justify-end mb-4">
        <div className="w-64 space-y-1 text-xs">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(job.subtotal)}</span></div>
          {job.discount > 0 && <div className="flex justify-between"><span>Discount:</span><span>-{formatCurrency(job.discount)}</span></div>}
          {job.tax_amount > 0 && <div className="flex justify-between"><span>Tax:</span><span>{formatCurrency(job.tax_amount)}</span></div>}
          <div className="flex justify-between font-bold text-sm border-t-2 border-blue-700 pt-1 text-blue-700 dark:text-blue-400"><span>Grand Total:</span><span>{formatCurrency(job.grand_total)}</span></div>
        </div>
      </div>
      {/* Doc-specific content */}
      {docType === 'estimate' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded p-3 text-xs text-amber-800 dark:text-amber-300">
          <strong>Disclaimer:</strong> This is an estimate, not an official invoice. Valid for 15 days.
        </div>
      )}
      {docType === 'invoice' && (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-3 text-xs border border-slate-200 dark:border-slate-600">
          <p><strong>Payment Terms:</strong> Due upon receipt.</p>
          <p className="text-red-600 font-bold mt-1">Amount Due: {formatCurrency(job.balance)}</p>
        </div>
      )}
      {docType === 'jobdone' && (
        <div className="mt-4">
          <div className="bg-green-50 dark:bg-green-900/20 rounded p-3 text-xs border border-green-300 dark:border-green-700 mb-4">
            <p><strong>Completed:</strong> {formatDate(job.completed_at)}</p>
            <p><strong>Technician:</strong> {job.assigned_technician || 'N/A'}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 mt-6">
            <div className="text-center"><div className="border-t border-slate-400 pt-1 text-xs text-slate-500">Technician Signature</div></div>
            <div className="text-center"><div className="border-t border-slate-400 pt-1 text-xs text-slate-500">Client Acceptance</div></div>
          </div>
        </div>
      )}
      {docType === 'receipt' && (
        <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-500 rounded p-4 mt-3">
          <p className="font-bold text-green-800 dark:text-green-300 mb-1">Payment Received</p>
          <p className="text-xs">Received from <strong>{job.client_name}</strong></p>
          <p className="italic text-green-700 dark:text-green-400 text-xs my-1">{numberToWords(job.amount_paid)}</p>
          <p className="text-lg font-bold text-green-800 dark:text-green-300">{formatCurrency(job.amount_paid)}</p>
          <p className="text-xs mt-1">Balance: {formatCurrency(job.balance)}</p>
        </div>
      )}
    </div>
  );
};

// ─── Job Order Form Modal ────────────────────────────────────────────────────
const emptyForm = {
  client_name: '', client_contact: '', client_address: '', router_node_id: '',
  service_type: 'Maintenance', description: '', assigned_technician: '',
  items: [] as LineItem[], discount: 0, tax_amount: 0,
};

const JobOrderFormModal: React.FC<{
  job: JobOrder | null;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}> = ({ job, onClose, onSave }) => {
  const [form, setForm] = useState(() => {
    if (job) {
      let parsedItems: LineItem[] = [];
      try { parsedItems = JSON.parse(job.items || '[]'); } catch { parsedItems = []; }
      return {
        client_name: job.client_name, client_contact: job.client_contact, client_address: job.client_address,
        router_node_id: job.router_node_id, service_type: job.service_type, description: job.description,
        assigned_technician: job.assigned_technician, items: parsedItems, discount: job.discount, tax_amount: job.tax_amount,
      };
    }
    return { ...emptyForm, items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }] };
  });
  const [saving, setSaving] = useState(false);

  const subtotal = form.items.reduce((s, it) => s + it.total, 0);
  const grandTotal = subtotal - form.discount + form.tax_amount;

  const updateItem = (idx: number, field: keyof LineItem, value: any) => {
    const newItems = [...form.items];
    (newItems[idx] as any)[field] = value;
    newItems[idx].total = newItems[idx].quantity * newItems[idx].unit_price;
    setForm({ ...form, items: newItems });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0, total: 0 }] });
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const handleSubmit = async () => {
    if (!form.client_name.trim()) { alert('Client name is required'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, subtotal, grand_total: grandTotal });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{job ? `Edit ${job.job_order_number}` : 'New Job Order'}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Client Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Client Name *</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Contact</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.client_contact} onChange={e => setForm({ ...form, client_contact: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Address</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.client_address} onChange={e => setForm({ ...form, client_address: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Router Node / Location</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.router_node_id} onChange={e => setForm({ ...form, router_node_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Service Type</label>
              <select className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.service_type} onChange={e => setForm({ ...form, service_type: e.target.value })}>
                {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Assigned Technician</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.assigned_technician} onChange={e => setForm({ ...form, assigned_technician: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Description / Scope of Work</label>
            <textarea rows={2} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Line Items</h4>
              <button onClick={addItem} className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"><PlusIcon className="w-3 h-3" /> Add Item</button>
            </div>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input className="col-span-5 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" placeholder="Description" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                  <input type="number" min={1} className="col-span-2 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-center" placeholder="Qty" value={item.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} />
                  <input type="number" min={0} step={0.01} className="col-span-2 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-right" placeholder="Price" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', Number(e.target.value))} />
                  <div className="col-span-2 text-xs text-right font-medium text-slate-700 dark:text-slate-300">{formatCurrency(item.total)}</div>
                  <button onClick={() => removeItem(idx)} className="col-span-1 p-1 text-red-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            {/* Totals */}
            <div className="flex justify-end mt-3">
              <div className="w-64 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal:</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Discount:</span>
                  <input type="number" min={0} step={0.01} className="w-24 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-right" value={form.discount} onChange={e => setForm({ ...form, discount: Number(e.target.value) })} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Tax:</span>
                  <input type="number" min={0} step={0.01} className="w-24 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-right" value={form.tax_amount} onChange={e => setForm({ ...form, tax_amount: Number(e.target.value) })} />
                </div>
                <div className="flex justify-between font-bold text-sm border-t pt-1 text-blue-700 dark:text-blue-400"><span>Grand Total:</span><span>{formatCurrency(grandTotal)}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? 'Saving...' : job ? 'Update Job Order' : 'Create Job Order'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
export const JobOrders: React.FC = () => {
  const { settings: companySettings } = useCompanySettings();
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobOrder | null>(null);
  const [printDoc, setPrintDoc] = useState<{ type: DocType; job: JobOrder } | null>(null);
  const [viewJob, setViewJob] = useState<JobOrder | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (search) params.set('search', search);
      const res = await fetch(`/api/job-orders?${params}`, { headers: authHeaders() });
      if (res.ok) setJobs(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filterStatus, search]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleSave = async (data: any) => {
    try {
      if (editingJob) {
        const res = await fetch(`/api/job-orders/${editingJob.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) });
        if (!res.ok) throw new Error('Failed to update');
      } else {
        const res = await fetch('/api/job-orders', { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) });
        if (!res.ok) throw new Error('Failed to create');
      }
      setShowForm(false);
      setEditingJob(null);
      fetchJobs();
    } catch (e: any) { alert(e.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this job order?')) return;
    try {
      await fetch(`/api/job-orders/${id}`, { method: 'DELETE', headers: authHeaders() });
      fetchJobs();
    } catch (e) { console.error(e); }
  };

  const handleStatusChange = async (job: JobOrder, newStatus: string) => {
    try {
      const res = await fetch(`/api/job-orders/${job.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: newStatus }) });
      if (!res.ok) throw new Error('Failed to update status');
      fetchJobs();
    } catch (e: any) { alert(e.message); }
  };

  const handlePayment = async (job: JobOrder) => {
    const amount = prompt('Enter payment amount:', String(job.balance));
    if (!amount || isNaN(Number(amount))) return;
    const paid = Number(amount);
    const newTotalPaid = job.amount_paid + paid;
    const newPaymentStatus = newTotalPaid >= job.grand_total ? 'Paid' : newTotalPaid > 0 ? 'Partial' : 'Unpaid';
    const newStatus = newPaymentStatus === 'Paid' ? 'Paid' : job.status;
    try {
      await fetch(`/api/job-orders/${job.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ amount_paid: newTotalPaid, payment_status: newPaymentStatus, status: newStatus })
      });
      fetchJobs();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by JO # or Client..."
          className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 w-64"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => { setEditingJob(null); setShowForm(true); }} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <PlusIcon className="w-4 h-4" /> New Job Order
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading job orders...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">No job orders found. Click "New Job Order" to create one.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">JO #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Client</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Service</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Payment</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Created</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {jobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">{job.job_order_number}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{job.client_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{job.service_type}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(job.status)}`}>{job.status}</span></td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-slate-200">{formatCurrency(job.grand_total)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPaymentBadge(job.payment_status)}`}>{job.payment_status}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(job.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button onClick={() => setViewJob(job)} title="View" className="p-1 text-slate-400 hover:text-blue-600"><EyeIcon className="w-4 h-4" /></button>
                      <button onClick={() => { setEditingJob(job); setShowForm(true); }} title="Edit" className="p-1 text-slate-400 hover:text-amber-600"><EditIcon className="w-4 h-4" /></button>
                      {/* Quick actions */}
                      {job.status === 'Pending' && <button onClick={() => handleStatusChange(job, 'Estimated')} title="Generate Estimate" className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200">Estimate</button>}
                      {(job.status === 'Estimated' || job.status === 'Pending') && <button onClick={() => handleStatusChange(job, 'In Progress')} title="Start Job" className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200">Start</button>}
                      {job.status === 'In Progress' && <button onClick={() => handleStatusChange(job, 'Job Done')} title="Mark Job Done" className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded hover:bg-green-200">Done</button>}
                      {job.status === 'Job Done' && <button onClick={() => handleStatusChange(job, 'Invoiced')} title="Generate Invoice" className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded hover:bg-purple-200">Invoice</button>}
                      {job.status !== 'Cancelled' && job.status !== 'Paid' && <button onClick={() => handlePayment(job)} title="Record Payment" className="px-2 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-200">Pay</button>}
                      <button onClick={() => handleDelete(job.id)} title="Delete" className="p-1 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      {showForm && <JobOrderFormModal job={editingJob} onClose={() => { setShowForm(false); setEditingJob(null); }} onSave={handleSave} />}

      {/* View Detail Modal */}
      {viewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{viewJob.job_order_number}</h3>
              <button onClick={() => setViewJob(null)} className="p-1 text-slate-400 hover:text-slate-600"><XMarkIcon className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Client:</span> <strong>{viewJob.client_name}</strong></div>
                <div><span className="text-slate-500">Contact:</span> {viewJob.client_contact || '—'}</div>
                <div><span className="text-slate-500">Address:</span> {viewJob.client_address || '—'}</div>
                <div><span className="text-slate-500">Node:</span> {viewJob.router_node_id || '—'}</div>
                <div><span className="text-slate-500">Service:</span> {viewJob.service_type}</div>
                <div><span className="text-slate-500">Technician:</span> {viewJob.assigned_technician || '—'}</div>
                <div><span className="text-slate-500">Status:</span> <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(viewJob.status)}`}>{viewJob.status}</span></div>
                <div><span className="text-slate-500">Payment:</span> <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPaymentBadge(viewJob.payment_status)}`}>{viewJob.payment_status}</span></div>
              </div>
              {viewJob.description && <div className="text-sm"><span className="text-slate-500">Description:</span><p className="mt-1 text-slate-700 dark:text-slate-300">{viewJob.description}</p></div>}
              {/* Print Actions */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button onClick={() => setPrintDoc({ type: 'estimate', job: viewJob })} className="flex items-center gap-1 px-3 py-2 text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-200"><PrinterIcon className="w-3 h-3" /> Print Estimate</button>
                <button onClick={() => setPrintDoc({ type: 'invoice', job: viewJob })} className="flex items-center gap-1 px-3 py-2 text-xs bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-200"><PrinterIcon className="w-3 h-3" /> Print Invoice</button>
                <button onClick={() => setPrintDoc({ type: 'jobdone', job: viewJob })} className="flex items-center gap-1 px-3 py-2 text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200"><PrinterIcon className="w-3 h-3" /> Print Job Certificate</button>
                <button onClick={() => setPrintDoc({ type: 'receipt', job: viewJob })} className="flex items-center gap-1 px-3 py-2 text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-200"><PrinterIcon className="w-3 h-3" /> Print Receipt</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Document Modal */}
      {printDoc && <PrintDocument docType={printDoc.type} job={printDoc.job} companySettings={companySettings} onClose={() => setPrintDoc(null)} />}
    </div>
  );
};

export default JobOrders;
