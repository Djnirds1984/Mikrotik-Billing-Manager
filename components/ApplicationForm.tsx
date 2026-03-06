import React, { useEffect, useState } from 'react';
import { dbApi } from '../services/databaseService.ts';
import { deleteApplication } from '../services/applicationService.ts';
import type { Application } from '../types.ts';

export const ApplicationForm: React.FC = () => {
  const [items, setItems] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState<string>('');
  
  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const rows = await dbApi.get<Application[]>('/applications');
      setItems(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sigurado ka ba na gusto mong tanggalin ang application na ito?')) return;
    
    setIsDeleting(id);
    setError('');
    try {
      await deleteApplication(id);
      await load(); // Refresh the list
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsDeleting('');
    }
  };
  
  useEffect(() => { load(); }, []);
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Application Form</h2>
        <button className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={load}>Refresh</button>
      </div>
      {error && <div className="p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200">{error}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800 text-left">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">PDF</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-4 py-4" colSpan={7}>Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-4" colSpan={7}>Wala pang applications.</td></tr>
            ) : (
              items.map(a => (
                <tr key={a.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-4 py-3">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{a.name}</td>
                  <td className="px-4 py-3">{a.email}</td>
                  <td className="px-4 py-3">{a.phone}</td>
                  <td className="px-4 py-3">{a.planName}</td>
                  <td className="px-4 py-3">
                    {a.pdfPath ? <a className="text-[--color-primary-500]" href={a.pdfPath} target="_blank" rel="noreferrer">Download</a> : 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(a.id)}
                      disabled={isDeleting === a.id}
                      className="px-2 py-1 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeleting === a.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
