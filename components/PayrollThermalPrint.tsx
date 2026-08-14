import type { Employee, EmployeeBenefit } from '../types.ts';

interface PayrollEntry {
    employee: Employee;
    benefit: EmployeeBenefit;
    daysWorked: number;
    hoursWorked: number;
    grossPay: number;
    sssDeduction: number;
    philhealthDeduction: number;
    pagibigDeduction: number;
    totalDeductions: number;
    netPay: number;
    regularHours: number;
    overtimeHours: number;
    regularPay: number;
    overtimePay: number;
    otHourlyRate: number;
    holidayPay: number;
    holidayDays: number;
    totalPay: number;
}

interface ThermalPrintParams {
    entries: PayrollEntry[];
    periodStart: string;
    periodEnd: string;
}

const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Build the payslip body for a single employee (reused for both copies)
const buildPayslipBody = (entry: PayrollEntry, periodStart: string, periodEnd: string) => {
    const rateLabel = entry.employee.salaryType === 'daily'
        ? `${fmt(entry.employee.rate)}/day` : `${fmt(entry.employee.rate)}/mo`;

    return `
        <div class="receipt">
            <div class="hdr">${entry.employee.fullName}</div>
            <div class="sub">${entry.employee.role || 'N/A'} &mdash; ${rateLabel}</div>
            <div class="sep">----------------------------------------</div>
            <div class="row"><span>Period</span><span>${periodStart} to ${periodEnd}</span></div>
            <div class="row"><span>Days Worked</span><span>${entry.daysWorked}</span></div>
            <div class="row"><span>Regular Hours</span><span>${entry.regularHours.toFixed(1)} hrs</span></div>
            ${entry.overtimeHours > 0 ? `
            <div class="row"><span>OT Hours (${fmt(entry.otHourlyRate)}/hr)</span><span>${entry.overtimeHours.toFixed(1)} hrs</span></div>
            <div class="row amt"><span>OT Pay</span><span>+${fmt(entry.overtimePay)}</span></div>` : ''}
            ${entry.holidayDays > 0 ? `
            <div class="row"><span>Holiday (${entry.holidayDays}d)</span><span>+${fmt(entry.holidayPay)}</span></div>` : ''}
            <div class="sep">----------------------------------------</div>
            <div class="row amt"><span><b>Gross Pay</b></span><span><b>${fmt(entry.grossPay)}</b></span></div>
            ${entry.benefit.sss ? `<div class="row ded"><span>SSS</span><span>-${fmt(entry.sssDeduction)}</span></div>` : ''}
            ${entry.benefit.philhealth ? `<div class="row ded"><span>PhilHealth</span><span>-${fmt(entry.philhealthDeduction)}</span></div>` : ''}
            ${entry.benefit.pagibig ? `<div class="row ded"><span>Pag-IBIG</span><span>-${fmt(entry.pagibigDeduction)}</span></div>` : ''}
            ${(entry.benefit.sss || entry.benefit.philhealth || entry.benefit.pagibig) ? `
            <div class="row ded"><span>Total Deductions</span><span>-${fmt(entry.totalDeductions)}</span></div>` : ''}
            <div class="sep">========================================</div>
            <div class="net"><span>NET PAY</span><span>${fmt(entry.netPay)}</span></div>
        </div>`;
};

export const printPayrollThermal = ({ entries, periodStart, periodEnd }: ThermalPrintParams) => {
    if (entries.length === 0) return;
    const win = window.open('', '_blank');
    if (!win) return;

    const generated = new Date().toLocaleString('en-PH');

    // Generate 2 pages per employee: Company Copy + Employee Copy
    let pagesHtml = '';
    entries.forEach((entry, idx) => {
        const body = buildPayslipBody(entry, periodStart, periodEnd);
        const isLast = idx === entries.length - 1;

        // Page 1: Company Copy
        pagesHtml += `
        <div class="page${isLast ? '' : ' page-break'}">
            <div class="page-hdr">
                <h2>PAYSLIP</h2>
                <div class="copy-label">Company Copy</div>
                <p>${periodStart} to ${periodEnd}</p>
            </div>
            ${body}
            <div class="sig">
                <div><div class="sig-line">Payroll Officer / HR</div></div>
                <div><div class="sig-line">Employee Signature</div></div>
            </div>
            <div class="footer">--- COMPANY COPY ---</div>
        </div>`;

        // Page 2: Employee Copy (same content, different title)
        pagesHtml += `
        <div class="page${isLast ? ' last' : ' page-break'}">
            <div class="page-hdr">
                <h2>PAYSLIP</h2>
                <div class="copy-label">Employee Copy</div>
                <p>${periodStart} to ${periodEnd}</p>
            </div>
            ${body}
            <div class="sig">
                <div><div class="sig-line">Payroll Officer / HR</div></div>
                <div><div class="sig-line">Employee Signature</div></div>
            </div>
            <div class="footer">--- EMPLOYEE COPY ---</div>
        </div>`;
    });

    const html = `<!DOCTYPE html>
<html><head><title>Payslip - ${periodStart} to ${periodEnd}</title>
<style>
    @page { size: 80mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    html, body {
        width: 76mm; margin: 0; padding: 0;
        font-family: 'Courier New', Courier, monospace;
        font-size: 10px; color: #000; background: #fff;
    }
    .page {
        break-after: always;
        page-break-after: always;
    }
    .page.last {
        break-after: auto;
        page-break-after: auto;
    }
    .page-hdr {
        text-align: center; padding-bottom: 4px;
        border-bottom: 2px solid #000; margin-bottom: 6px;
    }
    .page-hdr h2 { font-size: 14px; margin: 0 0 2px 0; font-family: Arial, sans-serif; }
    .page-hdr .copy-label {
        font-size: 11px; font-weight: bold; margin: 2px 0;
        letter-spacing: 1px; text-transform: uppercase;
    }
    .page-hdr p { font-size: 10px; margin: 0; }
    .receipt { padding: 6px 0; break-inside: avoid; page-break-inside: avoid; }
    .hdr { font-size: 12px; font-weight: bold; text-align: center; margin-bottom: 1px; }
    .sub { font-size: 9px; text-align: center; margin-bottom: 4px; }
    .sep { text-align: center; line-height: 1; margin: 3px 0; font-size: 10px; letter-spacing: -0.5px; }
    .row { display: flex; justify-content: space-between; padding: 1px 0; }
    .row.amt span:last-child { font-weight: bold; }
    .row.ded { font-size: 9px; padding: 0.5px 0; }
    .row.ded span:last-child { font-weight: bold; }
    .net {
        display: flex; justify-content: space-between;
        font-size: 14px; font-weight: bold; padding: 4px 0;
        font-family: Arial, sans-serif;
    }
    .footer { margin-top: 12px; text-align: center; font-size: 8px; }
    .sig { margin-top: 20px; display: flex; justify-content: space-around; font-size: 9px; }
    .sig div { text-align: center; width: 45%; }
    .sig-line { border-top: 1px solid #000; margin-bottom: 2px; padding-top: 2px; }
    .sig-single { margin-top: 24px; text-align: center; font-size: 9px; }
    .sig-single .sig-line { width: 60%; margin: 0 auto 2px auto; }
    @media print {
        body, html { width: 76mm; }
        svg, .no-print { display: none !important; }
        * { background: transparent !important; }
    }
</style>
</head>
<body>
${pagesHtml}
    <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}};<\/script>
</body></html>`;

    win.document.write(html);
    win.document.close();
    win.focus();
};
