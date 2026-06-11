import React, { useState } from 'react';
import { ShieldCheckIcon, ServerIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

// Download Icon Component
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

export const NtcCompliance: React.FC = () => {
  const [complianceData, setComplianceData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runComplianceCheck = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ntc-compliance-check');
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[NTC] Non-JSON response:', text.substring(0, 200));
        throw new Error(`Server returned HTML instead of JSON. Is the backend running on port 3002?`);
      }
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Compliance check failed');
      }
      
      const data = await response.json();
      setComplianceData(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadPdfReport = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch('/api/admin/ntc-report/download');
      if (!response.ok) throw new Error('PDF download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'NTC_Compliance_Report.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">NTC Compliance & Security Audit</h2>
            <p className="text-blue-100 mt-1">RA 12234 - Konektadong Pinoy Act Framework</p>
          </div>
          <ShieldCheckIcon className="w-16 h-16 opacity-80" />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={runComplianceCheck}
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
        >
          {isLoading ? <Loader /> : <ServerIcon className="w-5 h-5" />}
          Run Compliance Check
        </button>
        <button
          onClick={downloadPdfReport}
          disabled={isDownloading || !complianceData}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
        >
          {isDownloading ? <Loader /> : <DownloadIcon className="w-5 h-5" />}
          Download PDF Report
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 p-4 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Compliance Results */}
      {complianceData && (
        <div className="space-y-6">
          {/* Overall Status Badge */}
          <div className={`p-6 rounded-lg border-2 ${
            complianceData.overallStatus === 'COMPLIANT' 
              ? 'bg-green-50 dark:bg-green-900/20 border-green-500' 
              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
          }`}>
            <div className="flex items-center gap-4">
              <ShieldCheckIcon className={`w-12 h-12 ${
                complianceData.overallStatus === 'COMPLIANT' ? 'text-green-600' : 'text-yellow-600'
              }`} />
              <div>
                <h3 className="text-xl font-bold">Overall Status: {complianceData.overallStatus}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {complianceData.totalRoutersChecked} routers inspected | Generated: {complianceData.generatedAtManila}
                </p>
              </div>
            </div>
          </div>

          {/* Compliance Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Control Plane Hardening */}
            <ComplianceCard
              title="Control Plane Hardening"
              status={complianceData.compliance.controlPlane.overallStatus}
              icon={<ServerIcon className="w-6 h-6" />}
              details={complianceData.compliance.controlPlane.routers.map((r: any) => (
                <div key={r.name} className="text-sm">
                  <p className="font-semibold">{r.name}</p>
                  <p>Telnet: {r.telnet} | FTP: {r.ftp} | WinBox: {r.winbox}</p>
                </div>
              ))}
            />

            {/* Network Isolation */}
            <ComplianceCard
              title="Network Isolation (PPPoE)"
              status={complianceData.compliance.networkIsolation.overallStatus}
              icon={<ShieldCheckIcon className="w-6 h-6" />}
              details={complianceData.compliance.networkIsolation.routers.map((r: any) => (
                <div key={r.name} className="text-sm">
                  <p className="font-semibold">{r.name}</p>
                  <p>Profiles: {r.profilesChecked} | Isolated: {r.isolated ? 'Yes' : 'No'}</p>
                </div>
              ))}
            />

            {/* Encryption Matrix */}
            <ComplianceCard
              title="Encryption Matrix (TLS 1.3)"
              status={complianceData.compliance.encryption.status}
              icon={<ShieldCheckIcon className="w-6 h-6" />}
              details={
                <div className="text-sm">
                  <p>Cloudflare Tunnel: {complianceData.compliance.encryption.tunnelActive ? 'Active' : 'Inactive'}</p>
                  <p>TLS Version: {complianceData.compliance.encryption.tlsVersion}</p>
                </div>
              }
            />

            {/* Data Privacy Vector */}
            <ComplianceCard
              title="Data Privacy (PSID Cryptography)"
              status={complianceData.compliance.dataPrivacy.status}
              icon={<ShieldCheckIcon className="w-6 h-6" />}
              details={
                <div className="text-sm">
                  <p>PSID Encrypted: {complianceData.compliance.dataPrivacy.psidEncrypted ? 'Yes' : 'No'}</p>
                  <p>Facebook Bot: {complianceData.compliance.dataPrivacy.botConfigured ? 'Configured' : 'Not Configured'}</p>
                </div>
              }
            />
          </div>

          {/* Warnings */}
          {complianceData.warnings.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 p-4 rounded-lg">
              <h4 className="font-bold text-yellow-800 dark:text-yellow-300 mb-2">Warnings</h4>
              <ul className="list-disc list-inside space-y-1">
                {complianceData.warnings.map((w: string, idx: number) => (
                  <li key={idx} className="text-sm text-yellow-700 dark:text-yellow-400">{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Reusable Compliance Card Component
const ComplianceCard: React.FC<{
  title: string;
  status: 'COMPLIANT' | 'WARNING';
  icon: React.ReactNode;
  details: React.ReactNode;
}> = ({ title, status, icon, details }) => (
  <div className={`p-4 rounded-lg border-2 ${
    status === 'COMPLIANT' 
      ? 'bg-green-50 dark:bg-green-900/20 border-green-400' 
      : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400'
  }`}>
    <div className="flex items-center gap-3 mb-3">
      <div className={status === 'COMPLIANT' ? 'text-green-600' : 'text-yellow-600'}>
        {icon}
      </div>
      <h4 className="font-bold text-lg">{title}</h4>
      <span className={`ml-auto px-3 py-1 rounded-full text-xs font-bold ${
        status === 'COMPLIANT' 
          ? 'bg-green-200 text-green-800' 
          : 'bg-yellow-200 text-yellow-800'
      }`}>
        {status}
      </span>
    </div>
    <div className="space-y-2">{details}</div>
  </div>
);
