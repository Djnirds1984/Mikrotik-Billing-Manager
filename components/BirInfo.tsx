import React from 'react';
import type { CompanySettings } from '../types.ts';

/**
 * Shared BIR (Bureau of Internal Revenue) info helpers used across all
 * printable documents (receipts, invoices, billing statements, SOA).
 * Everything renders conditionally — empty fields show nothing.
 */

export const formatVatType = (vatType?: string): string => {
    if (!vatType) return '';
    if (vatType === 'VAT') return 'VAT-Registered';
    if (vatType === 'NON-VAT') return 'Non-VAT Registered';
    if (vatType === 'EXEMPT') return 'VAT-Exempt';
    return vatType;
};

/** Multi-line BIR block for A4-size printed documents (receipts / invoices). */
export const BirInfoBlock: React.FC<{ companySettings: CompanySettings | null | undefined }> = ({ companySettings }) => {
    if (!companySettings) return null;
    const cs = companySettings as CompanySettings;
    const lines: string[] = [];
    if (cs.registeredBusinessName) lines.push(`Registered Name: ${cs.registeredBusinessName}`);
    if (cs.tinNumber) lines.push(`TIN: ${cs.tinNumber}`);
    if (cs.businessStyleName) lines.push(`Business Style: ${cs.businessStyleName}`);
    if (cs.dtiSecRegNo) lines.push(`${cs.dtiSecRegNo.startsWith('SEC') ? 'SEC Reg. No.' : 'DTI Reg. No.'}: ${cs.dtiSecRegNo}`);
    if (cs.businessPermitNo) lines.push(`Business Permit No.: ${cs.businessPermitNo}`);
    const vat = formatVatType(cs.vatType);
    if (vat) lines.push(vat);
    if (!lines.length && !cs.birStatement) return null;
    return (
        <div className="text-xs text-gray-700 print:text-gray-700 mt-1">
            {lines.map((l, i) => <div key={i}>{l}</div>)}
            {cs.birStatement && <div className="italic mt-0.5">{cs.birStatement}</div>}
        </div>
    );
};

/** Compact single BIR line for thermal (58mm) receipts. */
export const birThermalLine = (companySettings: CompanySettings | null | undefined): string => {
    if (!companySettings) return '';
    const parts: string[] = [];
    if (companySettings.tinNumber) parts.push(`TIN: ${companySettings.tinNumber}`);
    const vat = formatVatType(companySettings.vatType);
    if (vat) parts.push(vat);
    if (companySettings.businessPermitNo) parts.push(`Permit#: ${companySettings.businessPermitNo}`);
    return parts.join(' | ');
};

/** HTML string snippet (already escaped parts) for print-window documents. */
export const birHtmlLine = (companySettings: any): string => {
    if (!companySettings) return '';
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts: string[] = [];
    if (companySettings.registeredBusinessName) parts.push(`Registered Name: ${esc(companySettings.registeredBusinessName)}`);
    if (companySettings.tinNumber) parts.push(`TIN: ${esc(companySettings.tinNumber)}`);
    if (companySettings.businessStyleName) parts.push(`Business Style: ${esc(companySettings.businessStyleName)}`);
    if (companySettings.dtiSecRegNo) parts.push(`${String(companySettings.dtiSecRegNo).startsWith('SEC') ? 'SEC Reg. No.' : 'DTI Reg. No.'}: ${esc(companySettings.dtiSecRegNo)}`);
    if (companySettings.businessPermitNo) parts.push(`Business Permit No.: ${esc(companySettings.businessPermitNo)}`);
    const vat = formatVatType(companySettings.vatType);
    if (vat) parts.push(vat);
    if (companySettings.birStatement) parts.push(esc(companySettings.birStatement));
    return parts.join(' &bull; ');
};