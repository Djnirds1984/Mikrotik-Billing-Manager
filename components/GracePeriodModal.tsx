import React, { useState, useEffect } from 'react';

interface GracePeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: { comment?: string } | null;
  onSave: (params: { graceDays: number }) => Promise<boolean> | boolean;
}

export const GracePeriodModal: React.FC<GracePeriodModalProps> = ({ isOpen, onClose, subject, onSave }) => {
  const [graceDays, setGraceDays] = useState<number>(0);
  const [dueDate, setDueDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setGraceDays(0);
    setDueDate('');
    if (subject?.comment) {
      try {
        const parsed = JSON.parse(subject.comment);
        if (parsed?.dueDate) {
          setDueDate(parsed.dueDate);
        }
      } catch (_) {
        // ignore malformed comment
      }
    }
  }, [secret, isOpen]);

  if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subject) return;
    if (!Number.isFinite(graceDays) || graceDays <= 0) {
      setError('Please enter a valid number of days (> 0).');
      return;
    }
    setIsSubmitting(true);
    try {
      const ok = await onSave({ graceDays });
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
          <h3 className="text-lg font-semibold">Grant Grace Period</h3>
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