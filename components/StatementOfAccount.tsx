import React, { useState, useEffect, useMemo } from 'react';
import { dbApi, getAuthHeader } from '../services/databaseService.ts';
import type { RouterConfigWithId } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { PrinterIcon } from '../constants.tsx';

// Simple inline icons
const MagnifyingGlassIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

const UserIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

interface StatementOfAccountProps {
  selectedRouter: RouterConfigWithId | null;
}

export const StatementOfAccount: React.FC<StatementOfAccountProps> = ({ selectedRouter }) => {
  const { t, formatCurrency } = useLocalization();
  const [searchQuery, setSearchQuery] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatingSOA, setGeneratingSOA] = useState(false);

  // Load clients when router changes
  useEffect(() => {
    if (selectedRouter?.id) {
      loadClients(selectedRouter.id);
    } else {
      setClients([]);
    }
  }, [selectedRouter?.id]);

  const loadClients = async (routerId: string) => {
    try {
      setIsLoading(true);
      // Load PPPoE clients from client_users table
      const pppoeRes = await fetch('/api/client-portal/users', { 
        headers: getAuthHeader() 
      });
      const pppoeUsers = await pppoeRes.json();
      
      // Load DHCP clients
      const dhcpClients = await dbApi.get<any[]>(`/dhcp_clients?routerId=${routerId}`);
      
      // Combine both types
      const combined = [
        ...(Array.isArray(pppoeUsers) ? pppoeUsers.filter((u: any) => u.router_id === routerId) : []).map((u: any) => ({
          id: u.id,
          type: 'pppoe',
          name: u.username,
          accountNumber: u.account_number,
          contactNumber: u.contact_number || '',
          email: u.email || '',
          routerId: u.router_id
        })),
        ...(Array.isArray(dhcpClients) ? dhcpClients : []).map((c: any) => ({
          id: c.id || c.macAddress,
          type: 'dhcp',
          name: c.customerInfo || c.hostName || c.macAddress,
          accountNumber: c.accountNumber || '',
          contactNumber: c.contactNumber || '',
          email: c.email || '',
          routerId: c.routerId,
          macAddress: c.macAddress
        }))
      ];
      
      setClients(combined);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Search filter
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return clients.filter(client => 
      client.name.toLowerCase().includes(query) ||
      client.accountNumber?.toLowerCase().includes(query) ||
      client.contactNumber?.includes(query)
    );
  }, [searchQuery, clients]);

  // Generate SOA for selected client
  const generateSOA = async (client: any) => {
    if (!selectedRouter?.id) return;
    
    setGeneratingSOA(true);
    setSelectedClient(client);
    
    try {
      // Load invoices for this client
      let invoiceData: any[] = [];
      
      if (client.type === 'pppoe') {
        // Use public API for PPPoE client invoices
        const res = await fetch(
          `/api/public/client/invoices?routerId=${selectedRouter.id}&username=${encodeURIComponent(client.name)}`
        );
        invoiceData = await res.json();
      } else {
        // For DHCP, query client_invoices by routerId and username (lowercase name)
        const allInvoices = await dbApi.get<any[]>('/client-invoices');
        invoiceData = (Array.isArray(allInvoices) ? allInvoices : []).filter(
          inv => inv.routerId === selectedRouter.id && 
                 inv.source === 'dhcp' &&
                 (inv.username === client.name.toLowerCase() || 
                  inv.accountNumber === client.accountNumber)
        );
      }
      
      setInvoices(Array.isArray(invoiceData) ? invoiceData : []);
      
      // Load payment history from sales_records
      const allSales = await dbApi.get<any[]>('/sales');
      const clientPayments = (Array.isArray(allSales) ? allSales : []).filter(
        sale => sale.routerId === selectedRouter.id &&
                (sale.clientName?.toLowerCase() === client.name.toLowerCase() ||
                 sale.clientName === client.accountNumber)
      );
      
      setPayments(clientPayments);
    } catch (error) {
      console.error('Failed to generate SOA:', error);
      alert('Failed to generate Statement of Account');
    } finally {
      setGeneratingSOA(false);
    }
  };

  // Calculate account summary
  const accountSummary = useMemo(() => {
    const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const totalPaid = invoices
      .filter(inv => inv.status === 'PAID')
      .reduce((sum, inv) => sum + (inv.amount || 0), 0);
    
    // Also count payments from sales records
    const totalPaymentsFromSales = payments.reduce(
      (sum, p) => sum + (p.finalAmount || p.planPrice || 0), 0
    );
    
    const outstandingBalance = totalInvoiced - totalPaid - totalPaymentsFromSales;
    
    const pendingInvoices = invoices.filter(inv => inv.status === 'PENDING').length;
    const paidInvoices = invoices.filter(inv => inv.status === 'PAID').length;
    
    return {
      totalInvoiced,
      totalPaid: totalPaid + totalPaymentsFromSales,
      outstandingBalance: Math.max(0, outstandingBalance),
      pendingInvoices,
      paidInvoices,
      totalTransactions: invoices.length + payments.length
    };
  }, [invoices, payments]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
          Statement of Account
        </h2>
      </div>

      {/* Router Selection Warning */}
      {!selectedRouter && (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
          <p className="text-yellow-800 dark:text-yellow-300">
            Please select a router to view Statement of Account
          </p>
        </div>
      )}

      {selectedRouter && (
        <>
          {/* Client Search */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold mb-4">Search Client</h3>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by client name or account number..."
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 disabled:opacity-50"
              />
            </div>

            {/* Search Results Dropdown */}
            {searchQuery && filteredClients.length > 0 && (
              <div className="mt-2 max-h-60 overflow-y-auto border rounded-md divide-y dark:border-slate-700">
                {filteredClients.map(client => (
                  <button
                    key={client.id}
                    onClick={() => {
                      generateSOA(client);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3"
                  >
                    <UserIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
                    <div>
                      <div className="font-medium">{client.name}</div>
                      <div className="text-sm text-slate-500">
                        {client.accountNumber && `Account: ${client.accountNumber}`}
                        <span className="mx-2">|</span>
                        <span className="uppercase">{client.type}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="mt-4 flex justify-center">
                <Loader />
              </div>
            )}
          </div>

          {/* SOA Display - Only show when client is selected */}
          {selectedClient && (
            <>
              {generatingSOA ? (
                <div className="flex justify-center p-12">
                  <Loader />
                </div>
              ) : (
                <>
                  {/* Print-only header */}
                  <div className="hidden print:block mb-8">
                    <h1 className="text-3xl font-bold">Statement of Account</h1>
                    <p className="text-sm text-slate-500">Generated: {new Date().toLocaleString()}</p>
                    <div className="mt-4">
                      <p><strong>Client:</strong> {selectedClient.name}</p>
                      {selectedClient.accountNumber && <p><strong>Account Number:</strong> {selectedClient.accountNumber}</p>}
                      {selectedClient.contactNumber && <p><strong>Contact:</strong> {selectedClient.contactNumber}</p>}
                    </div>
                  </div>

                  {/* Account Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Total Invoiced</p>
                      <p className="text-2xl font-bold">{formatCurrency(accountSummary.totalInvoiced)}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Total Paid</p>
                      <p className="text-2xl font-bold text-green-600">{formatCurrency(accountSummary.totalPaid)}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Outstanding Balance</p>
                      <p className="text-2xl font-bold text-red-600">{formatCurrency(accountSummary.outstandingBalance)}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Pending Invoices</p>
                      <p className="text-2xl font-bold">{accountSummary.pendingInvoices}</p>
                    </div>
                  </div>

                  {/* Invoices Section */}
                  <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <h3 className="text-xl font-bold">Invoices</h3>
                      <button
                        onClick={() => window.print()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-2 no-print"
                      >
                        <PrinterIcon className="h-5 w-5" />
                        Print SOA
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Invoice #</th>
                            <th className="px-6 py-3">Plan</th>
                            <th className="px-6 py-3">Due Date</th>
                            <th className="px-6 py-3">Amount</th>
                            <th className="px-6 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map((inv) => (
                            <tr key={inv.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                              <td className="px-6 py-4">
                                {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-6 py-4 font-mono">{inv.id.slice(-8).toUpperCase()}</td>
                              <td className="px-6 py-4">{inv.planName || '—'}</td>
                              <td className="px-6 py-4">
                                {inv.dueDateTime ? new Date(inv.dueDateTime).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-6 py-4 font-semibold">
                                {formatCurrency(inv.amount || 0)}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                  inv.status === 'PAID' 
                                    ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                                }`}>
                                  {inv.status || 'PENDING'}
                                </span>
                              </td>
                            </tr>
                          ))}
                          {invoices.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                                No invoices found
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Payment History Section */}
                  <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      <h3 className="text-xl font-bold">Payment History</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Plan</th>
                            <th className="px-6 py-3">Amount</th>
                            <th className="px-6 py-3">Final Amount</th>
                            <th className="px-6 py-3">Discount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((payment) => (
                            <tr key={payment.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                              <td className="px-6 py-4">
                                {payment.date ? new Date(payment.date).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-6 py-4">{payment.planName || '—'}</td>
                              <td className="px-6 py-4">{formatCurrency(payment.planPrice || 0)}</td>
                              <td className="px-6 py-4 font-semibold text-green-600">
                                {formatCurrency(payment.finalAmount || payment.planPrice || 0)}
                              </td>
                              <td className="px-6 py-4 text-red-600">
                                {payment.discountAmount > 0 ? `- ${formatCurrency(payment.discountAmount)}` : '—'}
                              </td>
                            </tr>
                          ))}
                          {payments.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                                No payment history found
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
