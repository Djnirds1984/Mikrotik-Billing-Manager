import React, { useState, useEffect } from 'react';

interface GracePeriodModalDhcpProps {
  isOpen: boolean;
  onClose: () => void;
  subject: { comment?: string } | null;
  onSave: (params: { graceDays: number; graceTime: string }) => Promise<boolean> | boolean;
}

export const GracePeriodModalDhcp: React.FC<GracePeriodModalDhcpProps> = ({ isOpen, onClose, subject, onSave }) => {
  const [graceDays, setGraceDays] = useState<number>(0);
  const [dueDate, setDueDate] = useState<string>('');
  const [graceTime, setGraceTime] = useState<string>('23:59');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setGraceDays(0);
    setGraceTime('23:59');
    setDueDate('');
    if (subject?.comment) {
      try {
        const parsed = JSON.parse(subject.comment);
        if (parsed?.dueDateTime) {
          const dt = new Date(parsed.dueDateTime);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const d = String(dt.getDate()).padStart(2, '0');
          const hh = String(dt.getHours()).padStart(2, '0');
          const mm = String(dt.getMinutes()).padStart(2, '0');
          setDueDate(`${y}-${m}-${d} ${hh}:${mm}`);
        } else if (parsed?.dueDate) {
          setDueDate(`${parsed.dueDate} 23:59`);
        }
      } catch {}
    }
  }, [subject, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(graceDays) || graceDays <= 0) {
      setError('Please enter a valid number of days (> 0).');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(graceTime)) {
      setError('Please set a valid time (HH:MM).');
      return;
    }
    setIsSubmitting(true);
    try {
      const ok = await onSave({ graceDays, graceTime });
      if (ok) onClose();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to grant grace period.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-md">
        <div className="px-4 py-3 border-b dark:border-slate-700">
          <h3 className="text-lg font-semibold">Grant Grace Period (DHCP)</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Current Due Date</label>
            <input type="text" value={dueDate || 'No Info'} readOnly className="w-full px-3 py-2 border rounded-md bg-slate-50 dark:bg-slate-900/50" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Grace Days</label>
            <input
              type="number"
              min={1}
              value={graceDays}
              onChange={(e) => setGraceDays(parseInt(e.target.value || '0', 10))}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="e.g. 3"
              required
            />
            <p className="text-xs text-slate-500 mt-1">Extends the due date by the given number of days.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Grace End Time</label>
            <input
              type="time"
              value={graceTime}
              onChange={(e) => setGraceTime(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-md border">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-3 py-2 rounded-md bg-[--color-primary-600] text-white disabled:opacity-50">
              {isSubmitting ? 'Saving…' : 'Grant Grace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};