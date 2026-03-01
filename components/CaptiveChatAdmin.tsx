import React, { useEffect, useMemo, useState } from 'react';
import { getAuthHeader } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { ChatBubbleLeftRightIcon, PaperAirplaneIcon } from '../constants.tsx';

type CaptiveNotif = {
  id: string;
  type: 'client-chat' | 'admin-reply';
  message: string;
  is_read: 0 | 1;
  timestamp: string;
  context_json?: string;
};

export const CaptiveChatAdmin: React.FC = () => {
  const [messages, setMessages] = useState<CaptiveNotif[]>([]);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const fetchMessages = async () => {
    setIsLoading(true);
    try {
      const resp = await fetch('/api/db/notifications', { headers: getAuthHeader() });
      const data: CaptiveNotif[] = await resp.json();
      const filtered = data.filter(n => n.type === 'client-chat' || n.type === 'admin-reply');
      setMessages(filtered.reverse());
    } catch (e) {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  const threads = useMemo(() => {
    const map = new Map<string, CaptiveNotif[]>();
    for (const m of messages) {
      let ip = '';
      let meta: { name?: string; account?: string; channel?: string } = {};
      try {
        const ctx = JSON.parse(m.context_json || '{}');
        ip = ctx.ip || '';
        meta = { name: ctx.name, account: ctx.account, channel: ctx.channel };
      } catch (_) {}
      if (!ip) continue;
      if (!map.has(ip)) map.set(ip, []);
      map.get(ip)!.push(m);
    }
    return Array.from(map.entries()).map(([ip, msgs]) => {
      let name: string | undefined;
      let account: string | undefined;
      let channel: string | undefined;
      for (const m of msgs) {
        try {
          const ctx = JSON.parse(m.context_json || '{}');
          name = name || ctx.name;
          account = account || ctx.account;
          channel = channel || ctx.channel;
        } catch {}
      }
      return { ip, msgs, name, account, channel };
    });
  }, [messages]);

  const selectedThread = threads.find(t => t.ip === selectedIp) || null;

  const handleReply = async () => {
    if (!selectedIp || !input.trim()) return;
    setIsSending(true);
    try {
      const resp = await fetch('/api/captive-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ ip: selectedIp, message: input.trim() })
      });
      if (resp.ok) {
        setInput('');
        await fetchMessages();
      }
    } catch (_) {
      // ignore
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <ChatBubbleLeftRightIcon className="w-8 h-8 text-[--color-primary-500]" />
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Captive Chat (Admin)</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Threads</div>
          <div className="max-h-[60vh] overflow-auto">
            {isLoading ? (
              <div className="p-6 flex justify-center"><Loader /></div>
            ) : threads.length === 0 ? (
              <div className="p-6 text-slate-500">No captive messages.</div>
            ) : (
              <ul>
                {threads.map(t => (
                  <li key={t.ip}>
                    <button
                      onClick={() => setSelectedIp(t.ip)}
                      className={`w-full text-left px-4 py-3 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${selectedIp === t.ip ? 'bg-slate-100 dark:bg-slate-700/60' : ''}`}
                    >
                      <div className="font-mono">{t.ip}</div>
                      {(t.name || t.account || t.channel) && (
                        <div className="text-xs text-slate-500">
                          {(t.name || '').toString()} {(t.account ? `• ${t.account}` : '')} {(t.channel ? `• ${t.channel}` : '')}
                        </div>
                      )}
                      <div className="text-xs text-slate-500">{t.msgs.length} message(s)</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow flex flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold">Conversation</div>
          <div className="flex-1 p-4 space-y-3 max-h-[50vh] overflow-auto">
            {selectedThread ? (
              selectedThread.msgs.map(m => {
                const isAdmin = m.type === 'admin-reply';
                return (
                  <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-lg p-3 rounded-md ${isAdmin ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-200'}`}>
                      <div className="text-xs opacity-80">{new Date(m.timestamp).toLocaleString()}</div>
                      <div className="text-sm whitespace-pre-wrap">{m.message}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-slate-500">Select a thread to view messages.</div>
            )}
          </div>
          <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedIp ? `Reply to ${selectedIp}...` : 'Select a thread to reply'}
              className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-200 dark:border-slate-600"
              disabled={!selectedIp || isSending}
            />
            <button
              onClick={handleReply}
              disabled={!selectedIp || isSending || !input.trim()}
              className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white rounded-md disabled:opacity-50 flex items-center gap-2"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
